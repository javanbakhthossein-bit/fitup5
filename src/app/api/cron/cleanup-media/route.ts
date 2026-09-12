import { NextRequest } from "next/server";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /api/cron/cleanup-media?secret=CRON_SECRET
 *
 * ═══════════════════════════════════════════════════════════════════
 *  قانون مالک (v53): «فایل‌های کاربر هرگز نباید حذف شوند.»
 * ═══════════════════════════════════════════════════════════════════
 *
 * این روت قبلاً یک سیاست retention داشت (حذف فایل‌های قدیمی uploads/،
 * حذف AnalysisResultهای قدیمی و null کردن mediaUrl پیام‌های چت). از v53
 * به‌طور کامل بازنشسته شده است:
 *
 *  ❌ هیچ فایلی از uploads/ (یا هر جای دیگر) حذف نمی‌شود — عکس چت،
 *     عکس بدن، آزمایش خون، ویدیوی تحلیل، عکس غذا و عکس پیشرفت همه
 *     برای همیشه نگه داشته می‌شوند.
 *  ❌ هیچ رکورد AnalysisResult حذف نمی‌شود — تاریخچهٔ تحلیل‌ها ابدی است.
 *  ❌ هیچ ChatMessage/mediaUrl تغییر داده نمی‌شود — پیام‌ها با رسانه‌شان
 *     برای همیشه می‌مانند.
 *
 * استثنای واحد قانون v53: نسخهٔ اصلی ویدیوی آپلودی فقط بلافاصله بعد از
 * تولید نسخهٔ فشردهٔ سالم جایگزین می‌شود (src/lib/fitness/media-compress.ts
 * ← compressVideoFileInPlace در src/app/api/coach/analyze-video/route.ts).
 *
 * روت زنده می‌ماند (با همان گارد CRON_SECRET) تا:
 *  ۱) اگر instrumentation/cron بیرونی آن را صدا بزند خطا نبیند (no-op امن)،
 *  ۲) آمار صفر حذف را صادر کند تا در لاگ/مانیتورینگ «سیاست forever» دیده شود.
 *
 * یادآوری‌های حفاظتی دیگر (بدون تغییر باقی مانده‌اند):
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

  // ─── سیاست v53: نگهداری همیشگی — هیچ عملیات حذفی اجرا نمی‌شود ───
  // عمداً هیچ کوئری DB و هیچ عملیات فایلی انجام نمی‌شود؛ فقط آمار اعلام می‌گردد.
  const summary = {
    ok: true,
    runAt: new Date().toISOString(),
    policy: "forever" as const,
    deletedFiles: 0,
    deletedRecords: 0,
    note: "سیاست v53: نگهداری همیشگی رسانه‌های کاربر",
  };

  console.log(
    `[cleanup-media] run @ ${summary.runAt}: policy=forever, deletedFiles=0, deletedRecords=0 (v53 — فایل‌های کاربر هرگز حذف نمی‌شوند)`
  );

  return Response.json(summary);
}
