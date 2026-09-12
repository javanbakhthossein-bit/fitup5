import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeBodyPhoto, analyzeVideoFromPath } from "@/lib/fitness/ai";
import { readFile } from "fs/promises";
import { savePrivateMediaFile } from "@/lib/fitness/private-media";
import { compressVideoFileInPlace, formatBytes } from "@/lib/fitness/media-compress";
import { toPersianDigits } from "@/lib/fitness/types";
import { checkPrerequisites } from "@/lib/fitness/prerequisites";
import { createNotification } from "@/lib/fitness/notifications";
import {
  startProgramGenerationInBackground,
  PROGRAM_PREPARING_MESSAGE,
} from "@/lib/fitness/program-generation";

/**
 * GET /api/coach/submit-body-analysis
 * بررسی وضعیت ارسال مدیای بدن برای کاربر فعلی.
 * پاسخ شامل:
 *  - needsBodyPhoto: آیا عکس بدن لازم است؟ (Advanced / Ultimate)
 *  - canSubmitVideo: آیا کاربر می‌تواند ویدیو ارسال کند؟ (Ultimate) — ویدیو اختیاری است
 *  - pendingStatus: وضعیت فعلی ProgramRequest (pending_body_photo / pending_body_media / ready / ...)
 *  - hasWorkoutPlan: آیا برنامه تمرینی فعال دارد؟
 *  - analyzing (v74): آیا تحلیل پس‌زمینهٔ عکس‌های بدن همین لحظه در جریان است؟
 *    (ردیف placeholder با status="processing" و عمر کمتر از ۱۵ دقیقه)
 */

/** v74 — سقف اعتبار وضعیت «در حال تحلیل»: اگر فرآیند پس‌زمینه به هر دلیل
 *  (کرش پروسه و…) رها شد، بعد از ۱۵ دقیقه UI دیگر منتظر نمی‌ماند. */
const BODY_ANALYSIS_PROCESSING_TTL_MS = 15 * 60 * 1000;

/**
 * تشخیص وضعیت «در حال تحلیل» (v74): آخرین ردیف AnalysisResult از نوع body_photo
 * اگر placeholder پردازش (result JSON با status="processing") باشد و عمرش
 * کمتر از TTL باشد → تحلیل پس‌زمینه در جریان است. بدون schema change.
 */
async function isBodyAnalysisProcessing(userId: string): Promise<boolean> {
  try {
    const latest = await db.analysisResult.findFirst({
      where: { userId, type: "body_photo" },
      orderBy: { createdAt: "desc" },
      select: { result: true, createdAt: true },
    });
    if (!latest) return false;
    if (Date.now() - latest.createdAt.getTime() > BODY_ANALYSIS_PROCESSING_TTL_MS) return false;
    try {
      const parsed = JSON.parse(latest.result);
      return parsed?.status === "processing";
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const { userId, planName } = await requirePlanCapability("bodyPhotoAnalysis");

    const needsBodyPhoto = planName === "advanced" || planName === "ultimate";
    // ویدیو برای Ultimate اختیاری است (نه الزامی)
    const canSubmitVideo = planName === "ultimate";

    const [latestReq, workout, analyzing] = await Promise.all([
      db.programRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      db.workoutPlan.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
      }),
      isBodyAnalysisProcessing(userId),
    ]);

    const pendingStatus = latestReq?.status ?? null;
    const hasWorkoutPlan = !!workout;

    // ─── بررسی پیش‌نیازها ───
    const prereqCheck = await checkPrerequisites(userId, planName as any);

    // بنر آپلود فقط زمانی نشان داده شود که عکس بدن واقعاً آپلود نشده
    // نه زمانی که برنامه در حال ساخت است (generating) یا ساخته شده (hasWorkoutPlan)
    const bodyPhotoPrereq = prereqCheck.prerequisites.find((p) => p.type === "body_photo");
    const bodyPhotoIncomplete = bodyPhotoPrereq && bodyPhotoPrereq.status !== "completed";
    const awaitingMedia =
      needsBodyPhoto &&
      !hasWorkoutPlan &&
      bodyPhotoIncomplete &&
      pendingStatus !== "generating" &&
      pendingStatus !== "ready";

    return Response.json({
      needsBodyPhoto,
      canSubmitVideo,
      pendingStatus,
      hasWorkoutPlan,
      awaitingMedia,
      // v74: تحلیل پس‌زمینهٔ عکس‌ها در جریان است (UI «فیتاپ هوشمند در حال تحلیل است ⏳»)
      analyzing,
      // اطلاعات پیش‌نیازها برای نمایش دانه‌دانه در UI
      prerequisites: prereqCheck.prerequisites,
      canGenerateProgram: prereqCheck.canGenerateProgram,
      blockingReason: prereqCheck.blockingReason,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/coach/submit-body-analysis
 * multipart/form-data:
 *   - bodyPhotos: File[] (۱ تا ۴ تصویر) — الزامی
 *   - bodyVideo: File (اختیاری — برای Ultimate کاربران می‌توانند ویدیو هم ارسال کنند)
 *
 * v74 (پردازش پس‌زمینه): گیت‌وی پروداکشن در ~۱۲۰ ثانیه اتصال HTTP را قطع می‌کند
 * ولی هندلر سرور ادامه می‌دهد — تحلیل VLMِ ۴ عکس (+ ویدیو) می‌تواند از این سقف
 * عبور کند. حالا همان الگوی اثبات‌شدهٔ program-generation.ts اعمال شد:
 *  ۱. فایل‌ها ذخیره + ردیف‌های ProgressPhoto فوراً ساخته می‌شوند (پیش‌نیاز
 *     «عکس بدن» همان لحظه سبز می‌شود — دیریکتیو مالک).
 *  ۲. یک ردیف AnalysisResult (type="body_photo") به‌عنوان placeholder با
 *     marker status="processing" ساخته می‌شود — راه درون‌همان-مدل برای وضعیت
 *     «در حال تحلیل» بدون schema change (GET فیلد analyzing را از همین marker
 *     می‌خواند؛ buildGenerationExtras هم ردیف بدون محتوای نهایی را نادیده می‌گیرد).
 *  ۳. پاسخ فوری {started:true, analyzing:true, photoCount} برمی‌گردد.
 *  ۴. در void(async) پس‌زمینه: تحلیل VLM عکس‌ها (Promise.allSettled) →
 *     به‌روزرسانی همان ردیف با نتیجهٔ واقعی → تحلیل ویدیو در صورت وجود →
 *     در پایان startProgramGenerationInBackground (تا برنامه خودکار شروع شود).
 *     catch: console.error + علامت‌گذاری placeholder به failed + نوتیف شکست
 *     به کاربر (الگوی createNotification همین فایل).
 *
 * (سابقاً تحلیل VLM سینکرون داخل همین request بود → تایم‌اوت گیت‌وی → خطای
 * «پاسخ سرور نامعتبر» در UI در حالی که سرور کار را ادامه می‌داد.)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, planName } = await requirePlanCapability("bodyPhotoAnalysis");

    // ویدیو برای Ultimate اختیاری است (هیچ پلنی برای ویدیو الزامی نیست)
    const canSubmitVideo = planName === "ultimate";

    const formData = await req.formData();
    const photoFiles = formData.getAll("bodyPhotos").filter(
      (f): f is File => f instanceof File && f.size > 0 && f.type.startsWith("image/")
    );
    const videoFile = formData.get("bodyVideo");
    const video = videoFile instanceof File && videoFile.size > 0 ? videoFile : null;

    // اعتبارسنجی حداقل‌ها
    if (photoFiles.length === 0) {
      return Response.json(
        { error: "حداقل یک عکس از بدن ارسال کنید." },
        { status: 400 }
      );
    }
    if (photoFiles.length > 4) {
      return Response.json(
        { error: "حداکثر ۴ عکس مجاز است." },
        { status: 400 }
      );
    }
    // ویدیو کاملاً اختیاری است — حتی برای Ultimate — هیچ الزامی وجود ندارد.
    // (اگر کاربر Ultimate ویدیو فرستاد، آن را تحلیل می‌کنیم؛ اگر نفرستاد، برنامه بدون آن ساخته می‌شود.)
    void canSubmitVideo; // for clarity — variable intentionally unused beyond documentation

    // گاردهای فنی حجم (نادر؛ ضد OOM/درخواست مخرب) — دیرکتیو مالک: سقف
    // کاربر-پسند حذف شد؛ عکس‌ها با sharp به ۱۰۲۴px و ویدیو با ffmpeg فشرده
    // می‌شوند و فقط نسخهٔ فشرده نگه داشته می‌شود.
    for (const f of photoFiles) {
      if (f.size > 100 * 1024 * 1024) {
        return Response.json({ error: "فایل تصویر بسیار بزرگ است." }, { status: 413 });
      }
    }
    if (video && video.size > 2 * 1024 * 1024 * 1024) {
      return Response.json({ error: "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید." }, { status: 413 });
    }
    // اعتبارسنجی MIME ویدیو — الگوی مشابه analyze-video:
    // بدون این بررسی، هر فایلی (PDF/ZIP و…) با نام .mp4 به‌عنوان ویدیو ذخیره می‌شد.
    if (video && !video.type.startsWith("video/")) {
      return Response.json({ error: "فقط فایل ویدیویی مجاز است." }, { status: 400 });
    }

    // ─── رفع باگ: دیگر ویدیو «خودکار رد» نمی‌شود ───
    // سابقاً وقتی کاربر فقط عکس بدن می‌فرستاد (بدون ویدیو)، videoStatus به
    // "skipped" تغییر می‌کرد — یعنی آنالیز ویدیویی بدون تصمیم کاربر رد شده
    // بود (باگ بزرگ گزارش‌شده توسط مالک). الان اینجا فقط در صورت ارسال
    // «واقعی» ویدیو، وضعیت uploaded ثبت می‌شود؛ تصمیم «آپلود نمی‌کنم» فقط
    // و فقط از صفحه آنالیز ویدیویی (video-status API) گرفته می‌شود.
    if (planName === "ultimate" && video) {
      const userRecord = await db.user.findUnique({
        where: { id: userId },
        select: { videoStatus: true },
      });
      if (userRecord?.videoStatus !== "uploaded") {
        await db.user.update({
          where: { id: userId },
          data: { videoStatus: "uploaded" },
        });
      }
    }

    // ذخیره فایل‌ها — در uploads/body-analysis/ (خارج از public؛ سرو با احراز هویت از طریق serve-upload)
    const savedPhotoUrls: string[] = [];
    const savedPhotoPaths: string[] = [];
    const savedPhotoMimeTypes: string[] = [];
    const photoTypes = ["front", "side", "back", "custom"];
    const photoAngleNames = ["جلو", "پهلو", "پشت", "سه‌چهارم"]; // برسی زاویه عکس برای پرامپت VLM

    // ─── بهینه‌سازی عکس‌ها با sharp: resize به 1024px + WebP q80 ───
    // این کار حجم عکس را به‌شدت کاهش می‌دهد و سرعت آپلود + تحلیل را بالا می‌برد.
    // 1024px برای ارزیابی فرم بدن توسط VLM کافی است و token کمتری مصرف می‌کند.
    //
    // FIX v37 (لاگ ۵۰۰ پنل مدیر — کاربر احسان قنبری): بعضی عکس‌های HEIC/HEIF
    // آیفون با محدودیت امنیتی libheif (ipma box / insufficient data) decode
    // نمی‌شوند و قبلاً کل درخواست ۵۰۰ می‌شد و همهٔ عکس‌ها از دست می‌رفت.
    // حالا هر عکس جداگانه try/catch می‌شود؛ عکس‌های سالم پردازش می‌شوند و فقط
    // عکس معیوب با پیام فارسی مشخص به کاربر برگردانده می‌شود.
    const sharp = (await import("sharp")).default;
    const failedPhotos: number[] = [];
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      let processed: Buffer;
      try {
        // کاهش حجم + resize به حداکثر 1024px + WebP (per FOOD-ANALYSIS-LOGGING spec)
        // FIX چرخش عکس: .rotate() = auto-orient از EXIF — قبل از resize (همان باگ گالری پیشرفت)
        processed = await sharp(buffer)
          .rotate()
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
      } catch (imgErr) {
        console.warn(
          `[submit-body-analysis] photo #${i + 1} decode failed (${file.type || "unknown"}):`,
          imgErr instanceof Error ? imgErr.message : imgErr
        );
        failedPhotos.push(i + 1);
        continue;
      }

      const fileName = `body-${userId}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.webp`;
      const { url, filePath } = await savePrivateMediaFile("body-analysis", fileName, processed);
      savedPhotoUrls.push(url);
      savedPhotoPaths.push(filePath);
      savedPhotoMimeTypes.push("image/webp");
    }

    // هیچ عکسی سالم نبود → خطای قابل‌فهم (۴۲۲) به‌جای ۵۰۰ بی‌صدا
    if (savedPhotoUrls.length === 0) {
      return Response.json(
        {
          error:
            "پردازش عکس‌ها ممکن نشد؛ فرمت عکس (احتمالاً HEIC آیفون) پشتیبانی نمی‌شود. لطفاً در تنظیمات دوربین گوشی، فرمت عکس را روی «سازگارتر / Most Compatible» بگذارید یا عکس‌ها را به‌صورت JPG/PNG ارسال کنید و دوباره تلاش کنید.",
          code: "IMAGE_DECODE_FAILED",
        },
        { status: 422 }
      );
    }

    let savedVideoUrl: string | null = null;
    let savedVideoPath: string | null = null;
    let savedVideoMimeType: string | null = null;
    if (video) {
      const allowedVidExts = ["mp4", "webm", "mov", "m4v", "mkv"];
      const vext = (video.name.split(".").pop() || "").toLowerCase();
      const finalVext = allowedVidExts.includes(vext) ? vext : "mp4";
      const vFileName = `body-video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${finalVext}`;
      const vBuffer = Buffer.from(await video.arrayBuffer());
      const { url: vUrl, filePath: vFilePath } = await savePrivateMediaFile("body-analysis", vFileName, vBuffer);
      savedVideoUrl = vUrl;
      savedVideoPath = vFilePath;
      savedVideoMimeType = video.type || "video/mp4";
    }

    const profile = await db.onboardingProfile.findUnique({ where: { userId } });
    if (!profile) {
      return Response.json({ error: "ابتدا آنبوردینگ را تکمیل کنید." }, { status: 400 });
    }

    // ─── v74: ردیف‌های ProgressPhoto فوراً ساخته می‌شوند (دیریکتیو مالک) ───
    // پیش‌نیاز «عکس بدن» (prerequisites.ts بر اساس ProgressPhoto است) همان
    // لحظه سبز می‌شود و کاربر بلافاصله بازخورد می‌گیرد. (قبلاً ردیف‌ها بعد
    // از تحلیل VLM ساخته می‌شدند تا «کامل شدن پیش‌نیاز» معادل «تحلیل ذخیره‌شده»
    // باشد — حالا تحلیل در پس‌زمینه انجام می‌شود و وضعیت آن با placeholder
    // processing در AnalysisResult + GET analyzing به UI گزارش می‌شود.)
    const progressPhotoRows = savedPhotoUrls.map((url, i) =>
      db.progressPhoto.create({
        data: {
          userId,
          imageUrl: url,
          type: photoTypes[i] ?? "custom",
          note: "آپلود برای طراحی برنامه (Body Analysis)",
        },
      })
    );
    await Promise.all(progressPhotoRows);

    // ─── v74: ردیف placeholder «در حال تحلیل» در AnalysisResult ───
    // marker درون-مدل (بدون schema change): result JSON با status="processing".
    // buildGenerationExtras ردیف بدون محتوای نهایی را به‌عنوان تحلیل معتبر
    // نمی‌خواند (گارد skip) و GET از همین marker فیلد analyzing را می‌سازد.
    const placeholder = await db.analysisResult.create({
      data: {
        userId,
        type: "body_photo",
        result: JSON.stringify({
          status: "processing",
          processingStartedAt: new Date().toISOString(),
          photoCount: savedPhotoUrls.length,
        }),
        mediaUrl: savedPhotoUrls[0] || null,
      },
    });

    // ─── v74: پاسخ فوری — گیت‌وی هرگز تایم‌اوت نمی‌خورد ───
    const responseBody = {
      ok: true,
      started: true,
      analyzing: true,
      photoCount: savedPhotoUrls.length,
      photos: savedPhotoUrls,
      video: savedVideoUrl,
    };

    // ─── زنجیرهٔ تحلیل در پس‌زمینه (fire-and-forget) — الگوی program-generation ───
    void (async () => {
      try {
        // ─── تحلیل هر عکس بدن با VLM — موازی برای سرعت بیشتر ───
        // هر عکس را از روی دیسک می‌خوانیم، به base64 تبدیل می‌کنیم و به
        // `analyzeBodyPhoto` می‌دهیم. اگر تحلیل یک عکس خطا دهد، آن را رد
        // می‌کنیم ولی به بقیه ادامه می‌دهیم.
        const bodyAnalyses: string[] = [];
        const analysisResults = await Promise.allSettled(
          savedPhotoPaths.map(async (photoPath, i) => {
            const buffer = await readFile(photoPath);
            const base64 = buffer.toString("base64");
            const mimeType = savedPhotoMimeTypes[i];
            const angleLabel = photoAngleNames[i] || "اضافی";
            const userContext = `این عکس زاویه ${angleLabel} از بدن ورزشکار است. هدف ورزشکار: ${profile.goal || "نامشخص"}. فرم بدن، تعادل عضلانی، نقاط ضعف و قوت را تحلیل کن.`;
            const analysis = await analyzeBodyPhoto(base64, mimeType, userContext);
            return `زاویه ${i + 1} (${angleLabel}):\nامتیاز فرم: ${toPersianDigits(analysis.bodyScore)} از ۱۰۰\nتحلیل: ${analysis.analysis}\nتوصیه‌ها: ${analysis.recommendations.join("، ")}`;
          })
        );
        analysisResults.forEach((res, i) => {
          if (res.status === "fulfilled") {
            bodyAnalyses.push(res.value);
          } else {
            console.error(`[submit-body-analysis] photo ${i + 1} analysis failed:`, res.reason);
            // ادامه حتی اگر یک عکس خطا دهد
          }
        });

        const combinedBodyAnalysis = bodyAnalyses.length > 0
          ? `تحلیل عکس‌های بدن ورزشکار (${toPersianDigits(bodyAnalyses.length)} عکس):\n\n${bodyAnalyses.join("\n\n")}`
          : "";

        // ─── persist کردن تحلیل عکس بدن — جایگزینی همان ردیف placeholder ───
        // marker «processing» حذف می‌شود (GET دیگر analyzing=true نمی‌دهد) و
        // buildGenerationExtras این تحلیل را برای تولید برنامه می‌خواند.
        if (combinedBodyAnalysis) {
          try {
            await db.analysisResult.update({
              where: { id: placeholder.id },
              data: {
                result: JSON.stringify({
                  analysis: combinedBodyAnalysis,
                  createdAt: new Date().toISOString(),
                  photoCount: bodyAnalyses.length,
                }),
              },
            });
          } catch (e) {
            console.error("[submit-body-analysis] failed to persist body photo analysis:", e);
          }
        } else {
          // هیچ تحلیلی موفق نشد → ردیف placeholder به وضعیت failed می‌رود
          // (تا مسیر تولید برنامه بدون تحلیل باز بماند و کاربر بتواند دوباره ارسال کند)
          try {
            await db.analysisResult.update({
              where: { id: placeholder.id },
              data: {
                result: JSON.stringify({
                  status: "failed",
                  failedAt: new Date().toISOString(),
                  photoCount: savedPhotoUrls.length,
                }),
              },
            });
          } catch (e) {
            console.error("[submit-body-analysis] failed to mark analysis as failed:", e);
          }
        }

        // ─── تحلیل ویدیو (اختیاری) ───
        // اگر ویدیو فرستاده شده باشد، آن را هم تحلیل می‌کنیم. خطای تحلیل ویدیو هرگز
        // نباید جلوی ادامه را بگیرد — این بخش کاملاً optional است.
        let videoAnalysisResult = "";
        if (video && savedVideoPath && savedVideoMimeType) {
          try {
            // ─── قانون مالک: فشرده‌سازی درجا قبل از هر چیز (مستقل از استخراج فریم) ───
            // هرگز throw نمی‌کند؛ در شکست نسخهٔ اصلی می‌ماند. تحلیل ویدیو روی
            // نسخهٔ فشرده انجام می‌شود و فقط نسخهٔ فشرده روی دیسک می‌ماند.
            try {
              const cmp = await compressVideoFileInPlace(savedVideoPath);
              if (cmp.compressed) {
                console.log(`[submit-body-analysis] video compressed: ${formatBytes(cmp.sizeBefore)} → ${formatBytes(cmp.sizeAfter)}`);
              }
            } catch (cmpErr) {
              console.error("[submit-body-analysis] compression step failed (keeping original):", cmpErr);
            }
            // تحلیل مستقیم از مسیر فایل ذخیره‌شده (بدون roundtrip base64 ~۶۷MB)
            const vResult = await analyzeVideoFromPath(savedVideoPath, "تحلیل فرم بدن و تکنیک حرکات ورزشی");
            videoAnalysisResult = `تحلیل ویدیوی فرم بدن:\nفرم و وضعیت بدن: ${vResult.posture}\nتقارن: ${toPersianDigits(vResult.symmetry)} از ۱۰۰\nامتیاز: ${toPersianDigits(vResult.score)} از ۱۰۰\nمشکلات: ${vResult.issues.join("، ")}\nتوصیه‌ها: ${vResult.recommendations.join("، ")}`;
          } catch (e) {
            console.error("[submit-body-analysis] video analysis failed:", e);
            // تحلیل ویدیو اختیاری است — بدون آن ادامه می‌دهیم
          }
        }

        if (videoAnalysisResult) {
          try {
            await db.analysisResult.create({
              data: {
                userId,
                type: "video_analysis",
                result: JSON.stringify({
                  analysis: videoAnalysisResult,
                  createdAt: new Date().toISOString(),
                }),
                mediaUrl: savedVideoUrl,
              },
            });
          } catch (e) {
            console.error("[submit-body-analysis] failed to persist video analysis:", e);
          }
        }

        // ─── پایان زنجیره: تولید برنامه در پس‌زمینه (اگر همه پیش‌نیازها تعیین تکلیف شده باشند) ───
        // این نقطه «همان task» پس‌زمینه است — در UI برنامه خودکار شروع می‌شود
        // (pendingStatus="generating" از طریق GET/program-history دیده می‌شود).
        const prereqCheck = await checkPrerequisites(userId, planName as any);
        if (!prereqCheck.canGenerateProgram) {
          // هنوز پیش‌نیاز باقی مانده (مثلاً تعیین تکلیف ویدیو/آزمایش خون برای Ultimate)
          const latestReq = await db.programRequest.findFirst({
            where: { userId },
            orderBy: { createdAt: "desc" },
          });
          if (latestReq) {
            await db.programRequest.update({
              where: { id: latestReq.id },
              data: { status: "pending_body_photo" },
            }).catch(() => {});
          }

          await createNotification(
            userId,
            "system",
            "عکس‌های بدن شما ذخیره و تحلیل شد 📸",
            `تحلیل ${toPersianDigits(savedPhotoUrls.length)} عکس بدن شما کامل شد. برای شروع ساخت برنامه، ${prereqCheck.blockingReason ?? "پیش‌نیازهای باقی‌مانده را تعیین تکلیف کنید"}.`,
            "?tab=dashboard"
          );
        } else {
          const genResult = await startProgramGenerationInBackground(userId);

          if (genResult.started || genResult.reason === "already_generating") {
            const analyzedPhotosNote = bodyAnalyses.length > 0
              ? `بر اساس ${toPersianDigits(bodyAnalyses.length)} عکس بدن شما${videoAnalysisResult ? " و ویدیوی فرم حرکات" : ""}`
              : "بر اساس اطلاعات شما";
            await createNotification(
              userId,
              "system",
              "برنامه شما در حال آماده‌سازی است ⏳",
              `${analyzedPhotosNote}، فیتاپ هوشمند طراحی برنامه تمرینی و غذایی شما را شروع کرد. پس از آماده‌سازی به شما اطلاع می‌دهیم.`,
              "?tab=programs"
            );
          } else {
            // تولید شروع نشد (مثلاً already_has_fresh_plan یا no_plan) — اطلاع‌رسانی وضعیت
            await createNotification(
              userId,
              "system",
              "عکس‌های بدن شما ذخیره و تحلیل شد 📸",
              "تحلیل عکس‌های بدن شما کامل شد. وضعیت برنامهٔ خود را از بخش «برنامه‌ها» بررسی کنید.",
              "?tab=programs"
            );
          }
        }
        console.log(`[submit-body-analysis] background chain completed for user ${userId}`);
      } catch (bgErr) {
        console.error("[submit-body-analysis] background processing failed:", bgErr);
        // علامت‌گذاری placeholder به failed — تا GET فوراً analyzing=false بدهد
        // (بدون این، سقف ۱۵ دقیقه‌ای TTL منتظر می‌ماند)
        try {
          await db.analysisResult.update({
            where: { id: placeholder.id },
            data: {
              result: JSON.stringify({
                status: "failed",
                failedAt: new Date().toISOString(),
              }),
            },
          });
        } catch (markErr) {
          console.error("[submit-body-analysis] failed to mark placeholder as failed:", markErr);
        }
        // نوتیف شکست به کاربر (الگوی createNotification موجود در فایل)
        try {
          await createNotification(
            userId,
            "system",
            "تحلیل عکس‌های بدن ناموفق بود ⚠️",
            "در پردازش تحلیل عکس‌های بدن شما مشکل موقتی پیش آمد. لطفاً از بخش «ارسال عکس بدن» دوباره تلاش کنید؛ اگر تکرار شد با پشتیبانی در تماس باشید.",
            "?tab=dashboard"
          );
        } catch (notifErr) {
          console.error("[submit-body-analysis] failed to create failure notification:", notifErr);
        }
      }
    })();

    // شروع زنجیرهٔ پس‌زمینه بعد از آماده‌شدن پاسخ — مرورگر بلافاصله جواب می‌گیرد
    // و بستن صفحه هیچ اثری روی زنجیره ندارد.
    return Response.json(responseBody);
  } catch (e) {
    return apiError(e);
  }
}
