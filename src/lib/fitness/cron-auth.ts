/**
 * 🔒 ممیزی امنیتی F5 — گیت fail-secure برای مسیرهای /api/cron/**
 *
 * الگوی قبلی: «نبودن هدر پروکسی = اتصال محلی = مجاز» — fail-OPEN بود؛
 * هر درخواست مستقیم به پورت اپ (بدون هیچ هدری) بدون راز به کرون‌ها می‌رسید.
 *
 * الگوی جدید (fail-CLOSED) — درخواست فقط در دو حالت مجاز است:
 *  ۱. راز رسمی: ?secret= یا هدر x-fitup-cron-secret برابر CRON_SECRET (برای
 *     کرون خارجی روی خودِ سرور / اپراتور).
 *  ۲. توکن درون‌پردازه‌ای: هدر x-fitup-cron-token برابر توکن تصادفیِ تولیدشده
 *     در بوت همین پروسه (globalThis) — فقط کدهای همین پروسه (instrumentation)
 *     آن را می‌دانند؛ هیچ کلاینتی نمی‌تواند حدسش بزند.
 *
 * «تشخیص loopback» با هدرها اساساً غیرقابل‌اتکاست (route handler آدرس سوکت
 * ندارد) — پس کلاً حذف شد. حتی اگر CRON_SECRET تنظیم نشده باشد، جاروهای
 * داخلی با توکن بوت کار می‌کنند و هیچ مسیر بی‌رازی باقی نمی‌ماند.
 */
import { timingSafeEqual } from "crypto";

const g = globalThis as unknown as { __FITUP_CRON_BOOT_TOKEN?: string };

/** توکن تصادفی مخصوص این بوت — یک‌بار در عمر پروسه ساخته می‌شود */
export function getCronBootToken(): string {
  if (!g.__FITUP_CRON_BOOT_TOKEN) {
    g.__FITUP_CRON_BOOT_TOKEN = crypto.randomUUID();
  }
  return g.__FITUP_CRON_BOOT_TOKEN;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * تصمیم مجوز برای مسیرهای کرون.
 * @param req درخواست ورودی
 * @param url URL پارس‌شده (برای خواندن ?secret=)
 */
export function isAuthorizedCronRequest(req: Request, url: URL): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const provided =
    url.searchParams.get("secret") ||
    req.headers.get("x-fitup-cron-secret") ||
    "";

  // ۱) راز رسمی (کرون خارجی/اپراتور) — مقایسه timing-safe
  if (expected && provided && safeEqual(provided, expected)) return true;

  // ۲) توکن درون‌پردازه‌ای (جاروهای instrumentation — همیشه فعال، حتی بدون env)
  const bootToken = req.headers.get("x-fitup-cron-token") || "";
  if (bootToken && safeEqual(bootToken, getCronBootToken())) return true;

  return false;
}

/** هدرهای استاندارد برای فراخوانی داخلی کرون‌ها (instrumentation-node) */
export function internalCronHeaders(): Record<string, string> {
  return { "x-fitup-cron-token": getCronBootToken() };
}
