/**
 * ─── v178 — ثبت منبع ثبت‌نام سمت کلاینت (وب) ───
 *
 * کاربر وب از کجا آمده؟ (اینستاگرام / گوگل / سایر)
 *  - utm_source در URL ورود (مثلاً بایوی اینستاگرام: fittup.ir/?utm_source=instagram)
 *  - document.referrer (جستجوی ارگانیک گوگل → referrer=google.*؛ مرورگر
 *    درون‌اینستاگرامی → l.instagram.com)
 *
 * چون کاربر ممکن است چند صفحه بگردد و utm از URL پاک شود، utm در اولین
 * لندینگ (page-client) در sessionStorage ذخیره و هنگام verify-otp خوانده می‌شود.
 * اپ‌های نیتیو نیازی به این ماژول ندارند — سرور از روی UA آن‌ها را تشخیص می‌دهد.
 */

const UTM_KEY = "fitup_signup_utm";

/** یک‌بار در اولین لندینگ — utm_source ورود را ذخیره می‌کند */
export function captureSignupUtm(): void {
  try {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const utm = (params.get("utm_source") || params.get("ref_src") || "").trim();
    if (utm && !sessionStorage.getItem(UTM_KEY)) {
      sessionStorage.setItem(UTM_KEY, utm.slice(0, 100));
    }
  } catch {
    // sessionStorage ممکن است غیرفعال باشد — بی‌خطر
  }
}

export interface ClientSignupSignal {
  signupSource?: "instagram" | "google" | "other";
  signupSourceDetail?: string;
}

/**
 * در لحظهٔ verify-otp — تشخیص نهایی منبع وب:
 * اولویت: utm (ذخیره‌شده/فعلی) > referrer > هیچ
 */
export function detectClientSignupSource(): ClientSignupSignal {
  try {
    if (typeof window === "undefined") return {};

    let utm = "";
    try {
      utm = sessionStorage.getItem(UTM_KEY) || "";
    } catch {}
    if (!utm) {
      const params = new URLSearchParams(window.location.search);
      utm = (params.get("utm_source") || params.get("ref_src") || "").trim();
    }

    let refHost = "";
    try {
      if (document.referrer) refHost = new URL(document.referrer).hostname.toLowerCase();
    } catch {}

    // خود سایت نباید referrer حساب شود (ناوبری داخلی)
    const selfHost = window.location.hostname.toLowerCase();
    if (refHost === selfHost) refHost = "";

    const combined = `${utm} ${refHost}`;
    if (combined.includes("instagram")) {
      return { signupSource: "instagram", signupSourceDetail: utm || refHost };
    }
    if (combined.includes("google") || combined.includes("gclid")) {
      return { signupSource: "google", signupSourceDetail: utm || refHost };
    }
    if (utm) {
      return { signupSource: "other", signupSourceDetail: utm };
    }
    if (refHost) {
      return { signupSource: "other", signupSourceDetail: refHost };
    }
    return {};
  } catch {
    return {};
  }
}
