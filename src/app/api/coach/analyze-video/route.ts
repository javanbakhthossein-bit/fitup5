import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeVideoFromPath } from "@/lib/fitness/ai";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/fitness/types";
import { savePrivateMediaFile } from "@/lib/fitness/private-media";
import { compressVideoFileInPlace, formatBytes } from "@/lib/fitness/media-compress";

/**
 * POST /api/coach/analyze-video
 *  - نیازمند پلن حرفه‌ای (Ultimate) — قابلیت videoBodyAnalysis (آلیاس videoAnalysis)
 *  - محدودیت پلن: videoAnalysisLimit (v78: فقط «یکبار» در پلن Ultimate — درخواست مالک)
 *  - پس از تحلیل موفق، نتیجه در AnalysisResult ذخیره می‌شود و شمارنده videoAnalysisUsed افزایش می‌یابد.
 *
 * multipart/form-data:
 *   - video: File (ویدیوی فرم بدن) — الزامی
 *   - userContext: string — اختیاری
 *
 * ۱. ویدیو در uploads/videos/ (خارج از public) ذخیره می‌شود (نه ارسال base64 خام)
 *    و فقط از طریق /api/serve-upload با احراز هویت سرو می‌شود.
 * ۱.۵ (v53) فشرده‌سازی درجا: بعد از ذخیره و قبل از تحلیل، ویدیو با ffmpeg
 *    فشرده می‌شود (maxHeight 720، crf 28) — تحلیل روی نسخهٔ فشرده انجام
 *    می‌شود و نسخهٔ اصلی جایگزین می‌گردد (استثنای واحد قانون «حذف فایل»).
 *    اگر فشرده‌سازی ناموفق/بی‌اثر بود، نسخهٔ اصلی دست‌نخورده می‌ماند و
 *    جریان ادامه پیدا می‌کند (compressVideoFileInPlace هرگز throw نمی‌کند).
 * ۲. مسیر فایل به `analyzeVideoFromPath` داده می‌شود:
 *    - ffmpeg فریم وسط ویدیو را استخراج می‌کند
 *    - فریم به VLM ارسال می‌شود (VLM از ویدیو پشتیبانی نمی‌کند، فقط عکس)
 * ۳. نتیجه در AnalysisResult با mediaUrl ویدیو ذخیره می‌شود.
 *
 * v74 (پردازش پس‌زمینه): گیت‌وی پروداکشن در ~۱۲۰ ثانیه اتصال HTTP را قطع می‌کند
 * ولی هندلر سرور به کارش ادامه می‌دهد — یعنی کاربر خطای «پاسخ نامعتبر» می‌دید
 * در حالی که تحلیل در پس‌زمینه ادامه داشت. حالا همان الگوی اثبات‌شدهٔ
 * program-generation.ts اعمال شد: ثبت وضعیت فوری (videoStatus="analyzing") +
 * پاسخ فوری {started:true, status:"analyzing"} + فشرده‌سازی/تحلیل/ذخیره در
 * void(async) پس‌زمینه. کلاینت با poll روی GET نتیجه را برمی‌دارد (حتی بعد
 * از بستن و بازکردن صفحه).
 *
 * GET /api/coach/analyze-video
 *  - آخرین نتیجه ذخیره‌شده کاربر را برمی‌گرداند (تا رفرش صفحه اطلاعات را از دست ندهد).
 *  - فیلد analyzing=true یعنی تحلیل پس‌زمینه همین لحظه در جریان است
 *    (videoStatus="analyzing") — کلاینت هر ۵ ثانیه poll می‌کند.
 */

// دیرکتیو مالک: هیچ سقف کاربر-پسند وجود ندارد — کاربر هر حجمی می‌فرستد و بعد از
// ذخیره، ویدیو با ffmpeg فشرده می‌شود و فقط نسخهٔ فشرده نگه داشته می‌شود.
// فقط یک گارد فنی ۲ گیگابایت باقی است (ضد OOM/درخواست مخرب؛ نادر).
// بعد از ذخیره، فشرده‌سازی ffmpeg حجم را عملاً به چند ده مگابایت می‌رساند.
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

// پسوندهای مجاز
const ALLOWED_VIDEO_EXTS = ["mp4", "webm", "mov", "m4v", "mkv"];

export async function POST(req: NextRequest) {
  try {
    const { userId, planName } = await requirePlanCapability("videoBodyAnalysis");

    // === اعمال محدودیت واقعی پلن ===
    const limit = getCapabilities(planName).videoAnalysisLimit;
    const user = await db.user.findUnique({ where: { id: userId }, select: { videoAnalysisUsed: true } });
    const used = user?.videoAnalysisUsed ?? 0;
    if (limit > 0 && used >= limit) {
      return Response.json(
        { error: "سقف استفاده از این قابلیت پر شده است.", code: "LIMIT_REACHED" },
        { status: 403 }
      );
    }

    // === خواندن FormData به‌جای JSON ===
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return Response.json(
        { error: "درخواست باید multipart/form-data باشد.", code: "INVALID_FORMAT" },
        { status: 400 }
      );
    }

    const videoField = formData.get("video");
    const userContext = formData.get("userContext");

    if (!videoField || !(videoField instanceof File) || videoField.size === 0) {
      return Response.json(
        { error: "ویدیو ارسال نشده.", code: "NO_VIDEO" },
        { status: 400 }
      );
    }

    const video = videoField as File;

    // === گارد فنی حجم (۲GB — نادر؛ پیام مهربان) ===
    if (video.size > MAX_VIDEO_BYTES) {
      return Response.json(
        {
          error: "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید.",
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    // === اعتبارسنجی نوع فایل ===
    if (!video.type.startsWith("video/")) {
      return Response.json(
        { error: "فقط فایل ویدیویی مجاز است.", code: "INVALID_TYPE" },
        { status: 400 }
      );
    }

    const userContextStr = typeof userContext === "string" ? userContext : "تحلیل فرم بدن و تکنیک حرکات ورزشی";

    // === ذخیره ویدیو در uploads/videos/ (خارج از public — سرو با احراز هویت) ===
    const originalExt = (video.name.split(".").pop() || "").toLowerCase();
    const finalExt = ALLOWED_VIDEO_EXTS.includes(originalExt) ? originalExt : "mp4";
    const fileName = `video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${finalExt}`;
    const buffer = Buffer.from(await video.arrayBuffer());
    const { url: fileUrl, filePath } = await savePrivateMediaFile("videos", fileName, buffer);

    // === v74: ثبت وضعیت فوری «در حال تحلیل» ===
    // videoStatus="analyzing" → GET فیلد analyzing=true را برمی‌گرداند و UI
    // وضعیت واقعی «در حال تحلیل» را نشان می‌دهد (حتی بعد از رفرش صفحه).
    await db.user.update({
      where: { id: userId },
      data: { videoStatus: "analyzing" },
    });

    // === v74: فشرده‌سازی + تحلیل + ذخیره در پس‌زمینه (fire-and-forget) ===
    // الگوی اثبات‌شدهٔ program-generation.ts:446 — بستن صفحه/قطع HTTP هیچ
    // اثری روی این زنجیره ندارد؛ نتیجه در DB می‌ماند و کلاینت با poll می‌گیرد.
    void (async () => {
      try {
        // فشرده‌سازی درجا (v53) — نسخهٔ فشردهٔ سالم جایگزین فایل اصلی می‌شود
        // (استثنای واحد حذف فایل). تحلیل AI روی همان مسیر انجام می‌شود؛
        // فریم‌های سبک‌تر = تحلیل سریع‌تر.
        const compressResult = await compressVideoFileInPlace(filePath, { maxHeight: 720, crf: 28 });
        console.log(
          `[analyze-video] compress: ${formatBytes(compressResult.sizeBefore)} → ${formatBytes(compressResult.sizeAfter)}` +
            ` (compressed=${compressResult.compressed}${compressResult.skipped ? `, skipped=${compressResult.skipped}` : ""})`
        );

        // تحلیل ویدیو (با استخراج فریم ffmpeg)
        // این تابع فریم وسط ویدیو را با ffmpeg استخراج می‌کند و آن را به VLM می‌دهد.
        // اگر ffmpeg نصب نباشد، پیام واضح برمی‌گرداند.
        const result = await analyzeVideoFromPath(filePath, userContextStr);

        // ذخیره نتیجه در DB + افزایش شمارنده استفاده
        await db.$transaction([
          db.analysisResult.create({
            data: {
              userId,
              type: "video_analysis",
              result: JSON.stringify(result),
              mediaUrl: fileUrl,
            },
          }),
          db.user.update({
            where: { id: userId },
            data: { videoAnalysisUsed: { increment: 1 } },
          }),
        ]);

        // پایان موفق — پیش‌نیاز ویدیو تعیین تکلیف شده حساب می‌شود
        await db.user.update({
          where: { id: userId },
          data: { videoStatus: "uploaded" },
        });
        console.log(`[analyze-video] background analysis completed for user ${userId}`);
      } catch (bgErr) {
        console.error("[analyze-video] background analysis failed:", bgErr);
        // videoStatus به "uploaded" برمی‌گردد تا کاربر بتواند دوباره تلاش کند
        // (فایل آپلود شده و سهمیه مصرف نشده — retry آزاد است؛ GET هم
        // analyzing=false می‌دهد و UI خطا + دکمهٔ تلاش مجدد نشان می‌دهد.)
        await db.user
          .update({ where: { id: userId }, data: { videoStatus: "uploaded" } })
          .catch((stErr) => {
            console.error("[analyze-video] failed to reset videoStatus after error:", stErr);
          });
      }
    })();

    // پاسخ فوری — گیت‌وی هرگز تایم‌اوت نمی‌خورد
    return Response.json({ started: true, status: "analyzing" });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET() {
  try {
    // ─── مشاهده نتیجه ذخیره‌شده فقط نیازمند لاگین است (باگ 2-b) ───
    // قبلاً GET هم قابلیت Ultimate می‌خواست → بعد از انقضای اشتراک، کاربر
    // دسترسی به نتیجه‌ای که قبلاً برایش پول داده بود را از دست می‌داد.
    // تحلیل جدید (POST) همچنان gated است — فقط «مشاهده» آزاد شد.
    const user = await requireAuth();
    const userId = user.id;
    const latest = await db.analysisResult.findFirst({
      where: { userId, type: "video_analysis" },
      orderBy: { createdAt: "desc" },
    });
    // v74: وضعیت تحلیل پس‌زمینه — true یعنی «در حال تحلیل» (کلاینت poll می‌کند)
    const analyzing = user.videoStatus === "analyzing";
    if (!latest) {
      return Response.json({ result: null, analyzing });
    }
    try {
      return Response.json({
        result: JSON.parse(latest.result),
        createdAt: latest.createdAt.toISOString(),
        analyzing,
      });
    } catch {
      return Response.json({ result: null, analyzing });
    }
  } catch (e) {
    return apiError(e);
  }
}
