/**
 * ═══════════════════════════════════════════════════════════════
 *  Task 3-b — کمکی‌های مشترک «روز تهران»
 *
 *  مرز روز به‌وقت تهران (UTC+03:30 ثابت — ایران از ۲۰۲۲ DST ندارد).
 *  دقیقاً همان ریاضیِ آفستِ مسیرهای /api/nutrition/log و
 *  /api/workout-day-status — تا همهٔ سیستم‌ها (FoodLog، DayCompletion،
 *  کلیدهای localStorage جیم‌مود و…) روی یک مرز روز توافق داشته باشند.
 *
 *  فرمت en-CA خروجی ISO-like (YYYY-MM-DD) می‌دهد.
 * ═══════════════════════════════════════════════════════════════
 */

/** تاریخ «امروز» تهران به شکل YYYY-MM-DD (کلید روز مشترک کل اپ) */
export function getTehranDayKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
}

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * تبدیل رشتهٔ YYYY-MM-DD به نیمه‌شبِ همان روز به‌وقت تهران (به‌صورت Date جهانی).
 * ورودی نامعتبر → null (به‌جای پرتاب خطا — تماس‌گیرنده تصمیم می‌گیرد).
 */
export function tehranDayKeyToUtcMidnight(key: string): Date | null {
  const trimmed = (key ?? "").trim();
  if (!DAY_KEY_RE.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00+03:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
