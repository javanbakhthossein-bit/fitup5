import { NextRequest } from "next/server";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { runChatMediaCleanup } from "@/lib/fitness/chat-media-cleanup";

/**
 * GET /api/cron/cleanup-media?secret=CRON_SECRET
 *
 * ═══════════════════════════════════════════════════════════════════
 *  سیاست نگهداری رسانه — v86 (دیرکتیو جدید مالک + حفظ قانون v53 برای بقیه)
 * ═══════════════════════════════════════════════════════════════════
 *
 * قانون مالک (v53): «فایل‌های کاربر هرگز نباید حذف شوند» — برای همهٔ
 * رسانه‌ها (عکس بدن، آزمایش خون، ویدیوی تحلیل فرم، عکس غذا، عکس پیشرفت،
 * آواتار، پیوست تیکت و رکوردهای AnalysisResult) همچنان پابرجاست و این روت
 * هیچ کاری با آن‌ها نمی‌کند.
 *
 * استثنای واحد (v86 — دیرکتیو جدید مالک، فقط رسانهٔ «چت با فیتاپ»):
 *   «عکس‌ها و ویدیوهایی که کاربر در چت با فیتاپ ارسال می‌کند بعد از سه روز
 *    نسخهٔ کم‌حجمش پاک شود ... ولی تحلیل‌هاش نگه داشته شود.»
 *
 * پس این روت حالا فقط این کار را انجام می‌دهد (منطق کامل در
 * src/lib/fitness/chat-media-cleanup.ts ← runChatMediaCleanup):
 *  ✅ حذف فایل‌های رسانهٔ چت زیر uploads/chat/ با عمر بیش از ۷۲ ساعت:
 *     عکس چت (chat-image-*)، ویدیوی چت (chat-video-*) و فریم‌های استخراج‌شده
 *     ویدیو (chat-vframe-* یا chat-frame-*)
 *  ✅ بعد از حذف هر فایل: null کردن mediaUrl ردیف‌های ChatMessage ارجاع‌دهنده
 *     و پاک‌کردن آن URL از آرایهٔ mediaFrames (آرایهٔ خالی → null)
 *  ❌ mediaAnalysis (تحلیل بینایی) ، mediaType و متن پیام هرگز دست نمی‌خورند
 *     — تحلیل‌ها برای همیشه محفوظ‌اند (دیرکتیو صریح مالک).
 *  ❌ هیچ رکورد AnalysisResult حذف نمی‌شود؛ هیچ رسانهٔ غیر-چتی حذف نمی‌شود.
 *  ❌ زیرپوشه‌های chat (مثل chat/tts — صوت پاسخ AI) دست‌نخورده‌اند.
 *
 * استثناهای قدیمی قانون v53 (بدون تغییر): نسخهٔ اصلی ویدیوی آپلودی فقط
 * بلافاصله بعد از تولید نسخهٔ فشردهٔ سالم جایگزین می‌شود
 * (src/lib/fitness/media-compress.ts ← compressVideoFileInPlace).
 *
 * اجرا: علاوه بر فراخوانی دستی/کرون خارجی با CRON_SECRET، جاروی داخلی
 * startChatMediaCleanupSweep در src/instrumentation-node.ts بعد از boot
 * (~۳ دقیقه) و سپس هر ۶ ساعت این روت را با loopback صدا می‌زند.
 *
 * یادآوری‌های حفاظتی دیگر (بدون تغییر):
 *  - serve-upload-handler: سرو رسانه خصوصی با auth/ownership.
 *  - canAccessPrivateMedia (private-media.ts): مالکیت فایل‌های کاربر.
 */

export async function GET(req: NextRequest) {
  // ─── Rate limit (per-IP) — ضد brute-force روی secret ───
  const rl = rateLimit(`cron-cleanup:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── v86 — پاک‌سازی رسانهٔ چت (retention ۷۲ ساعت — تحلیل‌ها محفوظ) ───
  // runChatMediaCleanup هرگز throw نمی‌کند — خطاها در summary.errors شمرده می‌شوند.
  const result = await runChatMediaCleanup();

  return Response.json({
    ok: result.ok,
    runAt: result.runAt,
    policy: result.policy,
    cutoffIso: result.cutoffIso,
    deletedFiles: result.deletedFiles,
    updatedMessages: result.updatedMessages,
    errors: result.errors,
    note: "رسانهٔ چت پس از ۷۲ ساعت حذف شد؛ تحلیل هر رسانه (mediaAnalysis) محفوظ ماند — بقیهٔ رسانه‌ها طبق قانون v53 همیشگی‌اند",
  });
}
