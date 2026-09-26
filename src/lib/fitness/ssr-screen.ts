import { cookies, headers } from "next/headers";
import { getCurrentUserWithMeta } from "@/lib/fitness/auth";

/**
 * محاسبه screen اولیه در سرور (SSR) — آینه‌ی منطق applyUrlToScreen در page-client.
 *
 * چرا: قبلاً store با screen="loading" شروع می‌شد و HTML اولیه فقط
 * SplashLoader بود؛ محتوای واقعی (لندینگ/مقالات/ابزارها) بعد از اجرای
 * JavaScript در مرورگر ظاهر می‌شد. برای سئو (crawler بدون JS)، پیش‌نمایش
 * شبکه‌های اجتماعی و LCP، HTML اولیه باید محتوای واقعی داشته باشد.
 *
 * حالا سرور بر اساس searchParams + سشن، screen اولیه را می‌سازد و
 * HomeClient قبل از اولین رندر آن را داخل store تزریق می‌کند —
 * خروجی سرور و کلاینت یکسان است (بدون hydration mismatch).
 */
export interface InitialScreen {
  screen: string;
  refCode?: string;
  mainTab?: string;
  paymentVerify?: boolean;
}

/** خواندن امن پارامتر تک‌مقداری از searchParams برجسته (Promise در Next.js 16) */
function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

const VALID_TABS = [
  "dashboard",
  "programs",
  "workouts",
  "nutrition",
  "progress",
  "chat",
  "plans",
  "referral",
  "support",
  "mobileapp",
];

const VALID_TOOLS = ["tdee", "exercises", "foods"]; // v119 — فقط برای proxy legacy (اینجا استفاده نمی‌شود)
void VALID_TOOLS;

/**
 * t9: تشخیص اپ‌های نیتیو (WebView اندروید) در سرور.
 *
 * هر دو اپ اندروید پسوند UA به WebView اضافه می‌کنند (MainActivity.kt):
 *   - اپ اختصاصی:  "… FitUpApp/{VERSION}"
 *   - اپ بازار:    "… FitUpBazaar/{VERSION}"
 *
 * چرا لازم است: در WebView همیشه matchMedia('(display-mode: standalone)')
 * false است، پس اسکریپت inline کوکی pwa_standalone را هرگز ست نمی‌کند و
 * SSR کاربر لاگین‌شده‌ی اپ را به‌جای پنل با «لندینگ» کش می‌داد — اولین
 * رندر بعد از refresh در اپ فلیکر لندینگ→پنل داشت. اپ نیتیو مثل PWA
 * standalone رفتار می‌کند: مسیر auth-check سرور می‌رود (پنل/آنبوردینگ/auth).
 * رفتار مرورگرهای معمولی بدون تغییر مانده (لندینگ برای بازدیدکننده سرد).
 */
async function isNativeAppWebView(): Promise<boolean> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    return ua.includes("FitUpApp/") || ua.includes("FitUpBazaar/");
  } catch {
    // در شرایط خاص (بدون دسترسی به هدرها) اپ نیست فرض کن — رفتار قبلی
    return false;
  }
}

/**
 * v51 (قانون کافه‌بازار): تشخیص اپ بازار در سرور — تب «اپ موبایل» در نسخه
 * بازار از SSR هم اعتبار حذف می‌شود تا با رفرش/دیپ‌لینک (?tab=mobileapp)
 * هرگز داخل اپ بازار باز نشود (تخلف تبلیغ نصب APK داخل بازار).
 */
async function isBazaarAppWebView(): Promise<boolean> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    return ua.includes("FitUpBazaar/");
  } catch {
    return false;
  }
}

export async function resolveInitialScreen(
  sp: Record<string, string | string[] | undefined>
): Promise<InitialScreen> {
  // v119 — پارامترهای legacy عمومی (?article= ?exercise= ?food= ?sport= ?tool=)
  // و ?screen=articles/terms/contact/about قبل از رسیدن به اینجا با 308 در
  // src/proxy.ts به مسیرهای واقعی SSR هدایت می‌شوند — اینجا فقط screenهای
  // داخلی اپ حل می‌شوند.

  const screenParam = pick(sp, "screen");
  const refCode = pick(sp, "ref")?.trim().toUpperCase() || undefined;
  const mainTabRaw = pick(sp, "tab");
  // v51 (قانون بازار): تب mobileapp در اپ کافه‌بازار معتبر نیست
  const bazaarWeb = await isBazaarAppWebView();
  const mainTabValid =
    !!mainTabRaw &&
    VALID_TABS.includes(mainTabRaw) &&
    !(mainTabRaw === "mobileapp" && bazaarWeb);
  const mainTab = mainTabValid ? mainTabRaw : undefined;
  const view = pick(sp, "view");
  const forceLanding = view === "landing";

  // v119 — صفحات عمومی استاتیک (articles/terms/contact/about) با 308 در proxy
  // به مسیرهای واقعی می‌روند — اینجا دیگر رندر نمی‌شوند.

  // ?view=landing → همیشه لندینگ
  if (forceLanding) {
    return { screen: refCode ? "referral-landing" : "landing", refCode };
  }

  const wantsAuth = screenParam === "auth";
  const wantsPanel = screenParam === "panel";
  // v32: دیپ‌لینک پنل مدیریت (?screen=admin&atab=...) — مثل panel/auth باید
  // auth-check سرور را رد کند وگرنه رفرش در تب تیکت‌ها همیشه لندینگ می‌شد
  // (گزارش مالک: «هر صفحه‌ای که بودم رفرش کردم باید همان بیاید بالا»)
  const wantsAdmin = screenParam === "admin";

  // تشخیص PWA standalone با کوکی (اسکریپت inline در layout ست می‌کند —
  // display-mode فقط سمت کلاینت قابل خواندن است) + اپ‌های نیتیو اندروید
  // (WebView آن‌ها هرگز standalone نیست ولی مثل PWA رفتار می‌کنند — t9)
  let isStandalone = false;
  try {
    const cookieStore = await cookies();
    isStandalone = cookieStore.get("pwa_standalone")?.value === "1";
  } catch {
    // در شرایط خاص (مثلاً generateMetadata) کوکی در دسترس نیست
  }
  if (!isStandalone) {
    isStandalone = await isNativeAppWebView();
  }

  // مرورگر معمولی + URL خالی → لندینگ
  if (!wantsPanel && !wantsAuth && !wantsAdmin && !isStandalone) {
    return {
      screen: refCode ? "referral-landing" : "landing",
      refCode,
      mainTab,
      paymentVerify: pick(sp, "payment_verify") === "1",
    };
  }

  // ─── نیاز به auth check (panel / auth / PWA) — سمت سرور با سشن ───
  // v49: تشخیص «خطای گذرا» از «لاگین‌نبودن واقعی» — باگ «تغییر VPN → رفرش →
  // لاگ‌اوت»: در لحظهٔ سوئیچ شبکه، db.cookie ممکن است موقتاً شکست بخورد؛
  // کوکی معتبر + خطای گذرا ≠ لاگین‌نبودن — خوش‌بینانه پنل را رندر می‌کنیم؛
  // doAuthCheck کلاینت بلافاصله تصحیحش می‌کند اگر واقعاً لاگین نبود.
  let user: Awaited<ReturnType<typeof getCurrentUserWithMeta>>["user"] = null;
  let transientAuthError = false;
  let blockedAuth = false;
  try {
    const meta = await getCurrentUserWithMeta();
    user = meta.user;
    transientAuthError = meta.transientError;
    blockedAuth = meta.blocked;
  } catch {
    user = null;
  }

  // v51 (مسدودسازی): کاربر مسدود → صفحهٔ اختصاصی «مسدود» (نه لندینگ نه پنل).
  // ?view=landing همچنان لندینگ را نشان می‌دهد (صفحهٔ عمومی).
  if (blockedAuth && !forceLanding) {
    return { screen: "blocked" };
  }

  if (user) {
    // same client logic
    if (user.role === "ADMIN") return { screen: "admin", mainTab };
    if (wantsAdmin) {
      // غیرادمین که دنبال پنل ادمین بود → مثل panel رفتار شود
      return { screen: user.onboardingDone ? "main" : "onboarding", mainTab };
    }
    return { screen: user.onboardingDone ? "main" : "onboarding", mainTab };
  }

  // v49: کوکی سشن معتبر ولی خطای گذرای زیرساخت → خوش‌بینانه پنل
  // (هیچ‌وقت به لندینگ/auth پرتاب نمی‌شویم؛ کلاینت اصلاح می‌کند)
  if (transientAuthError) {
    return { screen: "main", mainTab };
  }

  // کاربر لاگین نیست
  if (wantsAuth) return { screen: "auth" };
  if (isStandalone && !forceLanding) return { screen: "auth" };
  // ?screen=panel بدون لاگین در مرورگر → لندینگ (رفتار کلاینت)
  return {
    screen: refCode ? "referral-landing" : "landing",
    refCode,
    mainTab,
    paymentVerify: pick(sp, "payment_verify") === "1",
  };
}
