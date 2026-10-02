import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/fitness/types";
import { streamMultipartFile } from "@/lib/fitness/stream-upload";
import { absolutePathForUploadUrl } from "@/lib/fitness/private-media";
import { startVideoBodyAnalysis } from "@/lib/fitness/video-body-analysis";

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

    // ─── ممیزی 1-b#10 — گارد عملی رقابت count-then-write ───
    // شمارندهٔ videoAnalysisUsed فقط در تراکنشِ موفقِ موتور مشترک (video-body-analysis)
    // افزایش می‌یابد؛ claim اتمیکِ پیش از کال اینجا دوباره‌شماری می‌ساخت. پنجرهٔ
    // «یک شروع تحلیل در دقیقه» برای هر کاربر عملاً دو درخواست موازی را سریال
    // می‌کند (همان کلید در upload-complete هم چک می‌شود) — رفتار مسیر عادی
    // دست‌نخورده است.
    const startRl = rateLimit(`video-body-analysis-start:${userId}`, 1, 60_000);
    if (!startRl.ok) {
      return rateLimitResponse(
        startRl.retryAfterSec,
        "تحلیل قبلی هنوز در جریان است؛ چند لحظه بعد دوباره تلاش کنید."
      );
    }

    // ═══ v85 — پارس استریمی multipart (حافظهٔ ثابت — حتی ۵۰۰MB امن است) ═══
    // قبلاً req.formData + arrayBuffer کل فایل را در RAM بافر می‌کرد.
    const upload = await streamMultipartFile(req, {
      fieldName: "video",
      subDir: "videos",
      fileNameBuilder: (ext) => `video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
      maxBytes: MAX_VIDEO_BYTES,
      allowedExts: ALLOWED_VIDEO_EXTS,
      videoTypeOnly: true,
      errors: {
        notVideo: "فقط فایل ویدیویی مجاز است.",
        tooLarge: "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید.",
        invalidRequest: "درخواست باید multipart/form-data باشد.",
        noFile: "ویدیو ارسال نشده.",
      },
    });

    if (!upload.ok) {
      const codeMap: Record<string, string> = {
        INVALID_TYPE: "INVALID_TYPE",
        PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
        INVALID_FORMAT: "INVALID_FORMAT",
        NO_FILE: "NO_VIDEO",
        UPLOAD_FAILED: "UPLOAD_FAILED",
        SAVE_FAILED: "SAVE_FAILED",
      };
      return Response.json(
        { error: upload.error, code: upload.code ? codeMap[upload.code] ?? upload.code : "UPLOAD_FAILED" },
        { status: upload.status }
      );
    }

    const fileUrl = upload.url;
    // مسیر مطلق فایل ذخیره‌شده — برای فشرده‌سازی/تحلیل پس‌زمینه
    const filePath = absolutePathForUploadUrl(fileUrl);
    const userContextStr = upload.fields.userContext || "تحلیل فرم بدن و تکنیک حرکات ورزشی";

    // === v74: ثبت وضعیت فوری «در حال تحلیل» ===
    // videoStatus="analyzing" → GET فیلد analyzing=true را برمی‌گرداند و UI
    // وضعیت واقعی «در حال تحلیل» را نشان می‌دهد (حتی بعد از رفرش صفحه).
    await db.user.update({
      where: { id: userId },
      data: { videoStatus: "analyzing" },
    });

    // === v74/v90: فشرده‌سازی + تحلیل + ذخیره در پس‌زمینه (fire-and-forget) ===
    // الگوی اثبات‌شدهٔ program-generation.ts — بستن صفحه/قطع HTTP هیچ
    // اثری روی این زنجیره ندارد؛ نتیجه در DB می‌ماند و کلاینت با poll می‌گیرد.
    // v90 — منطق به video-body-analysis.ts منتقل شد (اشتراک با مسیر آپلود چانکی)
    startVideoBodyAnalysis({
      userId,
      filePath,
      fileUrl,
      userContext: userContextStr,
    });

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
