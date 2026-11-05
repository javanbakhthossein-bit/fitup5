"use client";

/**
 * v139.2 — نشانگر «کاربر اخیراً لاین بوده» (auth hint) — فیکس باگ مالک:
 * «بعضی وقتا که داشبورد رو رفرش می‌کنیم یه لحظه او تی پی میاد و بعد با رفرش
 * مجدد دوباره پنل کاربری میاد».
 *
 * ریشهٔ باگ: در رفرش، اگر /api/auth/me به هر دلیل گذرا (هیپ DB، سوئیچ IP/VPN،
 * خطای شبکهٔ چندثانیه‌ای اپ) شکست بخورد یا 503 برگرداند، بعد از ۳ تلاش doAuthCheck
 * کاربر را به صفحهٔ auth (OTP) پرت می‌کرد — درحالی‌که سشن سالم است و رفرش بعدی
 * پنل را نشان می‌داد.
 *
 * راه‌حل: با هر /api/auth/me موفق، زمان آخرین تأیید لاگین در localStorage ثبت
 * می‌شود. اگر در رفرش بعدی auth-check شکست گذرا خورد ولی این نشانگر تازه باشد
 * (۳۰ روز)، کلاینت به جای پرت‌شدن به OTP، روی همان صفحه (پنل — که SSR با سشن
 * سالم رندر کرده) می‌ماند و در پس‌زمینه دوباره تلاش می‌کند.
 *
 * امنیت: نشانگر هرگز جای «قطعیِ سرور» را نمی‌گیرد — پاسخ 200 {user:null}
 * (لاگ‌اوت واقعی، کوکی باطل، خروج دستی) همیشه نشانگر را پاک می‌کند و رفتار
 * قبلی (auth/landing) می‌ماند. فقط شکست‌های «بدون پاسخ قطعی» را نرم می‌کند.
 */

const AUTH_HINT_KEY = "fitup_auth_hint_v1";
const AUTH_HINT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // ۳۰ روز

/** با موفقیت /api/auth/me صدا زده می‌شود */
export function markAuthSuccess(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_HINT_KEY, String(Date.now()));
  } catch {
    // localStorage غیرفعال — بی‌اهمیت
  }
}

/** با پاسخ قطعی «لاگین نیست» (200 بدون user) و logout دستی صدا زده می‌شود */
export function clearAuthHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_HINT_KEY);
  } catch {}
}

/** آیا اخیراً (۳۰ روز) تأیید لاگین موفق داشته‌ایم؟ */
export function hasRecentAuthHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(AUTH_HINT_KEY);
    if (!raw) return false;
    const t = Number(raw);
    if (!Number.isFinite(t) || t <= 0) return false;
    return Date.now() - t < AUTH_HINT_MAX_AGE_MS;
  } catch {
    return false;
  }
}
