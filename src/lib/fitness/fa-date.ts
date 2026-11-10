/**
 * fa-date.ts — تاریخ شمسی «قطعی» بدون Intl (رفع hydration #418)
 *
 * ⚠️ ریشهٔ باگ: `new Date(...).toLocaleDateString("fa-IR")` روی سرور (Node ICU)
 * و کلاینت (ICU مرورگر/WebViewهای قدیمی) خروجی متفاوت می‌دهد (تقویم/ارقام/
 * جداکننده) → mismatch هیدریشن → React error #418 (args[]=HTML) در صفحات
 * لندینگ/food/auth (لاگ واقعی سرور ۲۰۲۶-۱۱).
 *
 * راه‌حل: تبدیل گریگورین→جلالی با ریاضیات خالص (همان الگوریتم ثابت‌شده در
 * author/[slug]/page.tsx) + ارقام فارسی — خروجی روی سرور و کلاینت بایت‌به‌بایت
 * یکسان است و هیچ وابستگی به ICU/locale مرورگر ندارد.
 *
 * زمان‌بندی: همیشه ساعت تهران (UTC+3:30 — بدون DST از ۱۴۰۴ به بعد ایران DST
 * را لغو کرده؛ برای تاریخِ نمایشی همین کافی و قطعی است).
 */

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000; // UTC+03:30

/** تبدیل میلادی به جلالی — الگوریتم کلاسیک (bisection-free، بدون Intl) */
export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number
): [number, number, number] {
  const gDayCumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  let g = gy - (gy <= 1600 ? 621 : 1600);
  const gy2 = gm > 2 ? g + 1 : g;
  let days =
    365 * g +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    gDayCumulative[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/**
 * تاریخ شمسی قطعی به شکل «۱۴۰۵/۸/۱۷» — دقیقاً همان قالب پیش‌فرض fa-IR
 * (ارقام فارسی، جداکنندهٔ /، بدون صفر ابتدای ماه/روز). خروجی SSR و CSR یکسان.
 */
export function formatFaDateDeterministic(
  input: Date | string | number | null | undefined
): string {
  try {
    if (input === null || input === undefined || input === "") return "";
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "";
    // شیفت به ساعت تهران بدون Intl (قطعی)
    const tehran = new Date(d.getTime() + TEHRAN_OFFSET_MS);
    const [jy, jm, jd] = gregorianToJalali(
      tehran.getUTCFullYear(),
      tehran.getUTCMonth() + 1,
      tehran.getUTCDate()
    );
    const fa = (n: number) =>
      String(n).replace(/\d/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[Number(c)]);
    return `${fa(jy)}/${fa(jm)}/${fa(jd)}`;
  } catch {
    return "";
  }
}
