/**
 * v241 — گارد «ارتقای منصفانه» — ریشه‌یابی تیکت سلمان مقصودی (۱۴۰۵/۰۷/۲۴).
 *
 * باگ: کاربر نزدیکِ انقضا (حتی چند ساعت مانده) پلنِ بالاتر را با قیمتِ تقریباً کامل
 * می‌خرید (کسر اعتبار ارتقا چون پنجرهٔ باقی‌مانده < ۱ روز است عملاً صفر می‌شود)،
 * ولی v231 در ارتقا endDate را برابر «پایان دورهٔ قبلی» می‌گذاشت → ۴۵ روز پول،
 * چند ساعت اشتراک، و بعد از آن «پلن فعال نشد» (عین شکایت تیکت).
 *
 * قانون v241: پایان دورهٔ قبلی (سیاست v231: «مدت اشتراک در ارتقا ثابت می‌ماند»)
 * محترم است، ولی هرگز نباید از «روزهایی که پول کاربر به نرخ روزانهٔ پلن جدید
 * می‌خرد» کمتر شود. یعنی:
 *   guaranteedDays = round(مبلغ پرداختی ÷ نرخ روزانهٔ پلن جدید) با سقف durationDays
 *   endDate = max(پایان دورهٔ قبلی، now + guaranteedDays)
 * ارتقای میان‌دوره‌ای با اعتبار واقعی عملاً مثل قبل می‌ماند (پایان دورهٔ قبلی
 * معمولاً دورتر است)؛ ارتقای نزدیک انقضا حالا حداقل دوره‌ای می‌گیرد که پولش می‌خرد.
 *
 * این ماژول عمداً صفر وابستگی دارد (قابل تست مستقیم با bun/node).
 */

export function computeFairUpgradeEnd(params: {
  now: Date;
  oldEndDate: Date;
  paidAmount: number;
  /** قیمت مرجع پلن جدید (originalAmount پرداخت؛ صفر/منفی → گارد بی‌اثر) */
  referencePrice: number;
  durationDays: number;
}): Date {
  const refPrice = params.referencePrice > 0 ? params.referencePrice : 0;
  const dailyPrice = params.durationDays > 0 && refPrice > 0 ? refPrice / params.durationDays : 0;
  const daysCoveredByPayment =
    dailyPrice > 0 && params.paidAmount > 0 ? Math.round(params.paidAmount / dailyPrice) : 0;
  const guaranteedDays = Math.max(0, Math.min(params.durationDays, daysCoveredByPayment));
  const guaranteedEnd = new Date(
    params.now.getTime() + guaranteedDays * 24 * 60 * 60 * 1000
  );
  return guaranteedEnd.getTime() > params.oldEndDate.getTime() ? guaranteedEnd : params.oldEndDate;
}
