import { createHash, timingSafeEqual } from "crypto";

/**
 * v202 ممیزی (L1) — هش‌کردن کد OTP در دیتابیس:
 * قبلاً کد ۴رقمی خام در جدول OtpCode ذخیره می‌شد (هرکس DB را ببیند همهٔ کدهای
 * زنده را دارد). حالا فقط SHA-256 با salt ثابتِ داخلی ذخیره می‌شود؛ کد خام فقط
 * در حافظهٔ لحظهٔ ارسال (پیامک/bridge/devCode) زندگی می‌کند.
 *
 * سازگاری: ردیف‌های «عددی-سادهٔ» قدیمی (پیش از دیپلوی v202، TTL ۱۰ دقیقه‌ای)
 * با مقایسهٔ مستقیم پذیرفته می‌شوند تا هیچ کاربرِ در-میانهٔ ارسال کد لاگین نشکند.
 */
export function hashOtpCode(code: string): string {
  return createHash("sha256").update(`fitup-otp:${code}`).digest("hex");
}

/** مقایسهٔ کد ورودی با مقدار ذخیره‌شده (هش یا legacy-عددی) — timing-safe روی هش */
export function otpCodeMatches(stored: string, input: string): boolean {
  if (/^\d{4}$/.test(stored)) {
    // ردیف legacy پیش از v202 — پنجرهٔ کوتاه تا منقضی شدن کدهای قبلی
    return stored === input;
  }
  const a = Buffer.from(hashOtpCode(input));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
