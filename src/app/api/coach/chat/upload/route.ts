import { NextRequest } from "next/server";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { checkQuota } from "@/lib/fitness/quota";
import { streamMultipartFile } from "@/lib/fitness/stream-upload";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * POST /api/coach/chat/upload — آپلود multipart ویدیوی «چت با فیتاپ»
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ فیکس ریشه‌ای باگ مالک (ویدیوی ۸۶ مگابایتی → «تلاش ناموفق»):
 * فرانت‌اند چت از همیشه (Task 4-a) برای ویدیوهای بزرگ به همین مسیر POST می‌زد
 * ولی این روت سمت سرور هرگز ساخته نشده بود → ۴۰۴ → خطای آپلود برای «هر» ویدیوی
 * بزرگ‌تر از ۱۲MB. این روت با الگوی اثبات‌شدهٔ /api/coach/analyze-video
 * (مودال آنالیز فرم بدن که طبق تأیید مالک درست کار می‌کند) ساخته شد.
 *
 * v85 — بازنویسی با استریم (busboy): حافظهٔ ثابت — فایل هیچ‌وقت کامل در RAM
 * بافر نمی‌شود؛ مستقیم روی دیسک نوشته می‌شود → حتی ۵۰۰ مگابایت هم امن است
 * (دیرکتیو مالک: «حتی تا ۵۰۰ مگابایت — خودکار فشرده و تحلیل شود»).
 *
 * جریان کامل (هم‌سو با معماری دومرحله‌ای چت):
 *   ۱) کلاینت ویدیو را multipart به اینجا می‌فرستد (بدون سقف کاربر-پسند؛
 *      گارد فنی ۲ گیگابایت — هم‌خوان با کلاینت و آنالیز بدن)
 *   ۲) فایل استریمی در uploads/chat/ با نام chat-video-{userId}-… ذخیره می‌شود
 *      (اعتبارسنج مالکیت validateChatVideoUrl در /api/coach/chat دقیقاً همین
 *      الگو را می‌پذیرد — تغییر نام = شکستن زنجیره!)
 *   ۳) پاسخ فوری { mediaUrl, size } — بدون فشرده‌سازی/استخراج فریم؛ این کارها در
 *      کار پس‌زمینهٔ POST /api/coach/chat (runMediaAnalysisJob) انجام می‌شود
 *   ۴) کلاینت همان mediaUrl را در POST چت می‌فرستد → پیام کاربر + placeholder
 *      pending ساخته می‌شود → فشرده‌سازی ffmpeg + استخراج ۶ فریم + تحلیل بینایی
 *      در پس‌زمینه → پول کلاینت نتیجه را برمی‌دارد
 *
 * سهمیه (movement_video):
 *   - گارد اولیه اینجا (fail-fast — کاربر قبل از آپلود حجیم ۴۲۹ می‌گیرد)
 *   - مصرف واقعی (increment) فقط بعد از «تحلیل موفق» مدل بینایی در کار
 *     پس‌زمینهٔ POST چت انجام می‌شود (v85 — دیریکتیو مالک: اگر رسانه تحلیل
 *     نشد، هیچ سهمیه‌ای کم نمی‌شود)
 */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // گارد فنی ۲GB — ضد درخواست مخرب (نادر)
const ALLOWED_EXTS = ["mp4", "webm", "mov", "m4v", "mkv"];

export async function POST(req: NextRequest) {
  try {
    // گیت پلن: ارسال ویدیو در چت فقط برای پلن حرفه‌ای
    const { userId } = await requirePlanCapability("chatVideoUpload");

    // محدودیت نرخ — ۱۲ آپلود در دقیقه (تلاش‌های مجدد نباید گیر کند)
    const rl = rateLimit(`coach-chat-upload:${userId}`, 12, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    // ─── گارد اولیهٔ سهمیه (fail-fast) — مصرف واقعی در کار پس‌زمینهٔ چت ───
    const quota = await checkQuota(userId, "movement_video");
    if (!quota.allowed) {
      return Response.json(
        { error: quota.messageFa ?? "سهمیهٔ ارسال ویدیو تمام شده است.", code: quota.code },
        { status: 429 }
      );
    }

    // ─── پارس استریمی multipart و ذخیرهٔ مستقیم روی دیسک (حافظهٔ ثابت — v85) ───
    const result = await streamMultipartFile(req, {
      fieldName: "file",
      subDir: "chat",
      fileNameBuilder: (ext) =>
        `chat-video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
      maxBytes: MAX_VIDEO_BYTES,
      allowedExts: ALLOWED_EXTS,
      videoTypeOnly: true,
    });

    if (!result.ok) {
      return Response.json({ error: result.error, code: result.code }, { status: result.status });
    }

    // پاسخ فوری — فشرده‌سازی/فریم‌سازی/تحلیل/مصرف سهمیه همگی در پس‌زمینهٔ
    // POST چت ادامه می‌یابند (کاربر «در حال تحلیل و پاسخ…» را می‌بیند)
    return Response.json({ mediaUrl: result.url, size: result.size });
  } catch (e) {
    return apiError(e);
  }
}
