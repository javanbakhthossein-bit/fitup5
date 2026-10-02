/**
 * ─── v178 — تشخیص منبع ثبت‌نام کاربر (یک‌بار در لحظهٔ ساخت حساب) ───
 *
 * دیرکتیو مالک: «باید بدونم ثبت‌نام‌کننده‌ها و مشتری‌هام از اینستاگرام می‌آیند
 * یا گوگل یا کافه‌بازار» → داشبورد «منبع کاربران و فروش».
 *
 * الگوریتم تشخیص (اولویت‌بندی):
 *  ۱) UA اپ نیتیو: WebView اپ‌ها همیشه پسوند UA دارند (FitUpBazaar/ ، FitUpApp/)
 *     — این معتبرترین سیگنال است؛ کاربر کافه‌بازار حتی اگر لینکی با utm باز
 *     کرده باشد، «کافه‌بازار» می‌ماند.
 *  ۲) سیگنال سمت کلاینت (auth-screen): utm_source در URL ورود یا
 *     document.referrer (l.instagram.com → اینستاگرام، google.* → گوگل).
 *  ۳) پیش‌فرض: "web" (ورود مستقیم به سایت).
 *
 * مقدار فقط برای کاربر «تازه» ثبت می‌شود و هرگز تغییر نمی‌کند.
 * کاربران قدیمیِ قبل از v178 → null (در داشبورد: «نامشخص»).
 */

export const SIGNUP_SOURCES = [
  "instagram",
  "google",
  "cafebazaar",
  "app_panel",
  "web",
  "other",
] as const;

export type SignupSource = (typeof SIGNUP_SOURCES)[number];

/** نگاشت مقدار کلاینت به enum امن — مقادیر ناشناخته → other */
function normalizeClientSource(v: unknown): SignupSource | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "instagram" || s === "google") return s;
  if (s === "other") return "other";
  return null; // هر چیز دیگری از کلاینت پذیرفته نمی‌شود
}

export function resolveSignupSource(
  userAgent: string | null,
  clientSource: unknown,
  clientDetail: unknown
): { signupSource: SignupSource; signupSourceDetail: string | null } {
  const ua = (userAgent || "").toLowerCase();

  // ۱) اپ نیتیو — قوی‌ترین سیگنال
  if (ua.includes("fitupbazaar")) {
    return { signupSource: "cafebazaar", signupSourceDetail: "ua:FitUpBazaar" };
  }
  if (ua.includes("fitupapp")) {
    return { signupSource: "app_panel", signupSourceDetail: "ua:FitUpApp" };
  }

  // ۲) سیگنال کلاینت (utm/referrer که auth-screen تشخیص داده)
  const src = normalizeClientSource(clientSource);
  if (src) {
    const detail = String(clientDetail ?? "")
      .replace(/[\u0000-\u001f<>"]/g, "")
      .slice(0, 200)
      .trim();
    return { signupSource: src, signupSourceDetail: detail || null };
  }

  // ۳) پیش‌فرض
  return { signupSource: "web", signupSourceDetail: null };
}
