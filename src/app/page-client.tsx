"use client";

import { recoverPendingPayments, shouldRecoverNow } from "@/lib/fitness/recover-payments-client";
// v178 — ثبت utm_source ورود (منبع ثبت‌نام: اینستاگرام/گوگل/…)
import { captureSignupUtm } from "@/lib/fitness/signup-capture";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppStore, setHydrationSnapshot, clearHydrationSnapshot, markUserFresh, type AppScreen } from "@/lib/fitness/store";
import { isFitUpNativeApp, isFitUpOwnApp, requestBatteryOptimizationExemption, requestNativeNotificationPermission, syncNativeNotificationsNow } from "@/lib/fitness/app-bridge";
import { isFitUpBazaarApp } from "@/lib/fitness/bazaar-bridge";
import { installBazaarScrollGuard } from "@/lib/fitness/bazaar-scroll-guard";
import { installGalleryGate, showPermissionGate } from "@/lib/fitness/permission-gate";
import { initNetworkRecovery } from "@/lib/fitness/network-recovery";
import { installNetShield } from "@/lib/fitness/net-shield";
import { fetchWithResilience } from "@/lib/payment/client-fetch";
import { markAuthSuccess, clearAuthHint } from "@/lib/fitness/auth-hint";
// v170 — گرم‌کردن چانک‌های سنگین پنل در idle (تجربهٔ «اپ نصب‌شده»)
import { warmupPanelChunks } from "@/lib/fitness/panel-warmup";
import { isAnalysisPhasePending, shouldRestoreAnalysisPhase } from "@/lib/fitness/analysis-phase";
import { PermissionGateModal } from "@/components/fitness/permission-gate-modal";
import { AppUpdateModal } from "@/components/fitness/app-update-modal";
import { SplashLoader, SplashFadeOut } from "@/components/fitness/splash-loader";
import { LandingPage } from "@/components/fitness/landing/landing-page";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { getScreenFromUrl, isPublicSsrPath } from "@/lib/fitness/navigation";
import type { InitialScreen } from "@/lib/fitness/ssr-screen";
import dynamic from "next/dynamic";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// v178 — ثبت utm_source ورود در اولین لندینگ (module-level: یک‌بار در هر بارگذاری کامل صفحه؛
// مقدار در sessionStorage می‌ماند تا هنگام verify-otp به سرور بفرستیم)
captureSignupUtm();

// ─── v125 — تفکیک کد صفحهٔ اصلی (Lighthouse موبایل ۴۷ → هدف +۹۴) ───
// قبلاً «کل اپ» (پنل ورزشکار + پنل ادمین + auth + آنبوردینگ + تحلیل + رسید
// پرداخت) در باندل صفحهٔ اصلی ایمپورت ایستا می‌شد — بازدیدکنندهٔ لندینگ ۲۲۰KB+
// جاوااسکریپتِ بلااستفاده را دانلود/پارس/اجرا می‌کرد (TBT ۱۲۳۰ms، main-thread
// ۹.۶s، LCP ۹.۹s). حالا هر اسکرین chunk خودش را دارد و فقط هنگام ورود به آن
// اسکرین لود می‌شود.
//
// ⚠️ همه با ssr پیش‌فرض (true): خروجی HTML سرور عیناً قبل است (این اسکرین‌ها
// فقط وقتی اسکرین فعلی باشند در SSR رندر می‌شوند) — سئو/پیش‌نمایش شبکهٔ اجتماعی
// و هیدریشن دست‌نخورده. fallback هم SplashLoader است (همان UI استاندارد بارگذاری اپ).
const AuthScreen = dynamic(
  () => import("@/components/fitness/auth-screen").then((m) => m.AuthScreen),
  { loading: () => <SplashLoader /> }
);
const OnboardingScreen = dynamic(
  () => import("@/components/fitness/onboarding-screen").then((m) => m.OnboardingScreen),
  { loading: () => <SplashLoader /> }
);
const MainApp = dynamic(
  () => import("@/components/fitness/main-app").then((m) => m.MainApp),
  { loading: () => <SplashLoader /> }
);
const AdminOverlay = dynamic(
  () => import("@/components/fitness/views/admin-overlay").then((m) => m.AdminOverlay),
  { loading: () => <SplashLoader /> }
);
const AnalysisScreen = dynamic(
  () => import("@/components/fitness/analysis-screen").then((m) => m.AnalysisScreen),
  { loading: () => <SplashLoader /> }
);
const ReferralLanding = dynamic(
  () => import("@/components/fitness/landing/referral-landing").then((m) => m.ReferralLanding),
  { loading: () => <SplashLoader /> }
);
const BlockedScreen = dynamic(
  () => import("@/components/fitness/blocked-screen").then((m) => m.BlockedScreen),
  { loading: () => <SplashLoader /> }
);
const PaymentVerifyHandler = dynamic(
  () => import("@/components/fitness/payment-verify-handler").then((m) => m.PaymentVerifyHandler),
  { loading: () => <SplashLoader /> }
);

// ─── تایتل‌های پویا برای هر صفحه ───
// v119 — همهٔ صفحات عمومی SSR شدند (تایتلشان از metadata سرور می‌آید) —
// فقط screenهای داخلی اپ اینجا هستند.
const PAGE_TITLES: Record<string, string> = {
  landing: "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه",
  auth: "ورود به فیتاپ | ثبت‌نام با شماره موبایل",
  onboarding: "تکمیل اطلاعات | فیتاپ",
  main: "پنل ورزشکار | فیتاپ",
  admin: "پنل مدیریت | فیتاپ",
  loading: "فیتاپ",
  "referral-landing": "دعوت دوستان | فیتاپ",
};

// ─── تزریق screen اولیهٔ محاسبه‌شده در سرور (SSR) ───
// منطق کامل: src/lib/fitness/ssr-screen.ts
function bootstrapStoreFromServer(initial: InitialScreen) {
  // ─── v120 — فیکس ریشه‌ای hydration mismatch (ارور «Recoverable Error» مالک) ───
  // ریشه: در سرور، store ماژول‌سطحی zustand بین «همهٔ درخواست‌های SSR» مشترک است.
  // قبلاً فلگ ssrBootstrapped + گارد «screen !== loading» باعث می‌شد از درخواست
  // دوم به بعد، سرور HTML اسکرینِ درخواستِ قبلی را رندر کند (اثبات‌شده با تست:
  // درخواست ?screen=auth → سرور لندینگ می‌فرستاد) → کلاینت اسکرین درست را رندر
  // می‌کرد → «Hydration failed because the server rendered HTML didn't match
  // the client». راه‌حل: در سرور «همیشه» حالت اولیهٔ همین درخواست اعمال می‌شود.
  //
  // ─── v122 — کلاینت دیگر هیچ کاری در فاز رندر انجام نمی‌دهد ───
  // قبلاً در کلاینت هم همین‌جا setState می‌شد → «Cannot update a component
  // (PwaRegister) while rendering a different component (HomeClient)».
  // حالا store کلاینت از ابتدای ساخت ماژول با window.__FITUP_INITIAL__ (تزریق
  // اسکریپت inline سرور در page.tsx — اجرا قبل از باندل‌ها) متولد می‌شود
  // (پیاده‌سازی در store.ts) — نه setState در رندر، نه mismatch.
  if (typeof window !== "undefined") return;
  // سرور — store مشترک است؛ بدون هیچ گاردی، حالت همین درخواست را ست کن
  const s = useAppStore.getState();
  useAppStore.setState({
    screen: initial.screen as typeof s.screen,
    ...(initial.mainTab ? { mainTab: initial.mainTab as typeof s.mainTab } : {}),
    // ─── 🩹 v167 — فیکس ریشه‌ای «فلش نام کاربر در دکمه شروع» + «نمایش اسم کاربر دیگر» ───
    // store ماژول‌سطحی سرور بین «همهٔ درخواست‌های SSR» مشترک است. قبلاً user و
    // ssrLandingUser فقط «شرطی» ست می‌شدند (فقط وقتی initial آنها را داشت) — یعنی
    // مقدار درخواستِ قبلی در store می‌ماند و به HTML درخواستِ بعدی نشت می‌کرد:
    //   • کاربر لاگ‌اوت + رفرش → SSR هویت ندارد ولی store هنوز user قبلی را دارد
    //     → HTML یک ثانیه اسم را نشان می‌داد تا کلاینت اصلاح کند به «شروع»
    //   • درخواست کاربر دیگر (لاگین/PWA) قبل از درخواست مهمان → HTML مهمان نام
    //     کاربر غریبه را می‌دید (نشت داده بین کاربران!)
    // راه‌حل: هر درخواست SSR «همیشه» هر دو فیلد را صریح تعیین می‌کند — نبودِ هویت
    // = null صریح، نه «به‌ارث‌گذاشتن» از درخواست قبلی. (undefined فقط معنای
    // کلاینت‌side دارد؛ سرور همیشه مقدار قطعی می‌گذارد.)
    user: ((initial.ssrUser ?? null) as typeof s.user),
    ssrLandingUser: ((initial.landingUser ?? null) as typeof s.ssrLandingUser),
  });
}

// ─── تأیید خروج از PWA با دکمه back (اندروید) ───
// confirm() مرورگر در WebView/iframe محدود همیشه false برمی‌گرداند و کاربر
// عملاً با دکمه back در PWA گیر می‌کرد — دیالوگ درون‌برنامه‌ای جایگزین شد.
function PwaExitConfirmDialog({ open, onStay, onExit }: { open: boolean; onStay: () => void; onExit: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onStay()}>
      <AlertDialogContent dir="rtl" className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>خروج از فیتاپ</AlertDialogTitle>
          <AlertDialogDescription>آیا از برنامه فیتاپ خارج می‌شوید؟</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row">
          <AlertDialogCancel onClick={onStay}>ماندن</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-500 text-white hover:bg-red-600"
            onClick={onExit}
          >
            خروج
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// v139.2 — سقف حلقهٔ تلاش پس‌زمینهٔ auth-check (ضدتکرار بی‌پایان هر ۵ ثانیه)
let authBgRetryRounds = 0;

// v171 — useLayoutEffect ایزومورفیک: هم‌ترازی store زنده باید «قبل از نقاشی»
// (paint) انجام شود، نه بعدش — وگرنه یک فریم SplashLoader روی HTML پنلِ سرور
// نقاشی می‌شود (فلش اسپلش روی رفرش پنل — باگ اصلی v171).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ─── v148 — screenهای «پوستهٔ SPA» که pull-to-refresh مرورگر باید در آن‌ها
// غیرفعال بماند (تداخل اسکرول سریع به بالای پنل با رفرش — گزارش v143 مالک).
// همهٔ screenهای اپ هستند به‌جز landing / referral-landing (صفحات عمومی).
// در CSS هم فقط وقتی کلاس panel-screen روی <html> باشد اعمال می‌شود
// (globals.css — بازگرداندن pull-to-refresh در صفحات عمومی SSR).
const PANEL_SHELL_SCREENS: ReadonlySet<AppScreen> = new Set<AppScreen>([
  "loading",
  "auth",
  "onboarding",
  "analysis",
  "main",
  "admin",
  "blocked",
]);


// ─── v171 — پیش‌بارگذاری «قبل از هیدریشن» (ضد فلش رفرش) ───
// به‌محض eval شدن این ماژول (قبل از اولین رندر) چانک پنل + داشبورد دانلود
// می‌شود؛ در رفرشِ پنل، اسکلتونِ «در حال بارگذاری» داشبورد عملاً حذف می‌شود
// (چانک کش‌شدهٔ مرورگر در همان تیک اول resolve می‌شود). فقط وقتی URL پنل است —
// لندینگ/روت‌های عمومی هیچ چانک اضافه‌ای دانلود نمی‌کنند.
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("screen") === "panel") {
  void import("@/components/fitness/main-app")
    .then((m) => m.preloadDashboardView())
    .catch(() => {});
}

export default function HomeClient({ initial }: { initial: InitialScreen }) {
  // v122 — کلاینت: اسنپ‌شاتِ هم‌تراز-با-سرور را «خالص» ست می‌کنیم (انتساب
  // متغیر ماژولی — بدون setState، بدون نوتیفیکیشن، بدون عارضهٔ جانبی) تا
  // hydration دقیقاً با HTML سرور یکی باشد و ارور «Cannot update a component
  // (PwaRegister) …» برای همیشه ریشه‌کن شود. سرور: bootstrapStoreFromServer
  // (پایین) state همان درخواست را در store می‌گذارد.
  setHydrationSnapshot(initial);
  bootstrapStoreFromServer(initial);
  const { screen, setScreen, setUser, setMainTab, setTermsUpdateRequired, setOverlay, user } = useAppStore();

  // ─── v122 — هم‌ترازی store واقعی بعد از hydration (خارج از فاز رندر) ───
  // اسنپ‌شات هیدریشن پاک می‌شود و اگر store هنوز «loading» است (حالت عادی)،
  // screen/mainTab سرور در store واقعی اعمال می‌شود — setState در effect
  // کاملاً مجاز است و چون UI از hydration همین اسکرین را رندر کرده، هیچ
  // پرش/فلشی دیده نمی‌شود.
  // ⭐ v171 — از useLayoutEffect (ایزومورفیک) استفاده می‌شود: قبلاً useEffect
  // «پسیو» بود و بعد از paint اجرا می‌شد → در فاصلهٔ بین hydration و effect،
  // useSyncExternalStore مغایرت store زنده (loading) با اسنپ‌شات را می‌دید و
  // رندر همگامِ SplashLoader را قبل از نقاشی تزریق می‌کرد (فلش روی رفرش پنل).
  // حالا هم‌ترازی «قبل از paint» انجام می‌شود و رندر همگامِ بعدی storeِ
  // هم‌ترازشده را می‌خواند — همان پنل، بدون هیچ فریم اسپلش.
  useIsomorphicLayoutEffect(() => {
    clearHydrationSnapshot();
    const st = useAppStore.getState();
    if (st.screen === "loading" && initial.screen !== "loading") {
      useAppStore.setState({
        screen: initial.screen as typeof st.screen,
        ...(initial.mainTab ? { mainTab: initial.mainTab as typeof st.mainTab } : {}),
      });
    }
    // v143 — هم‌ترازی کاربر سبک لندینگ با store واقعی بعد از hydration
    // (اگر هنوز null است — در سرور برای همین درخواست حل شده بود)
    if (initial.landingUser !== undefined && st.ssrLandingUser == null) {
      useAppStore.setState({ ssrLandingUser: initial.landingUser });
    }
    // v143 — DTO کامل کاربر پنل: اگر هنوز نیامده بود (فاز client-only)، همین حالا
    // از SSR تزریق می‌شود — داشبورد/کش پلن‌ها بدون انتظار برای /api/auth/me
    if (initial.ssrUser != null && st.user == null) {
      useAppStore.setState({ user: initial.ssrUser as unknown as typeof st.user });
    }
    // فقط یک‌بار بعد از mount — initial همان اسنپ‌شات سرورِ همین بارگذاری است
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── مقادیر اولیه از سرور (SSR) ───
  // این مقادیر حالا از props سرور مقداردهی اولیه می‌شوند (متناسب با SSR)
  // و بعداً applyUrlToScreen در mount دوباره آن‌ها را از URL اعمال می‌کند.
  const [paymentVerify, setPaymentVerify] = useState(initial.paymentVerify === true);
  const [refCode, setRefCode] = useState<string | null>(initial.refCode ?? null);
  // دیالوگ تأیید خروج از PWA (دکمه back در حالت standalone) — جایگزین confirm()
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // ═══════════════════════════════════════════════════════════════
  //  منطق اصلی: URL → screen
  //  اصل: URL همیشه منبع حقیقت است. هیچ state پیچیده‌ای نیست.
  // ═══════════════════════════════════════════════════════════════

  // ─── تابع اعمال screen از URL ───
  // این تابع در mount و popstate صدا زده می‌شود
  const applyUrlToScreen = async () => {
    if (typeof window === "undefined") return;

    // ─── v113/v118/v119 — گارد کل مسیرهای عمومی SSR (تک‌نسخه‌سازی کامل) ───
    // صفحات عمومی دیگر هیچ اسکرین SPA‌ای ندارند؛ اگر به هر دلیلی (تاریخچهٔ
    // قدیمی pushState / پارامتر legacy) روی مسیر عمومی هستیم، بارگذاری کامل
    // صفحهٔ واقعی انجام می‌شود — همان طراحی که با رفرش/لینک مقالات/گوگل دیده
    // می‌شود. این گارد جلوی هر گونه دو-طراحی را در کل سایت می‌گیرد.
    const legacyParams = new URLSearchParams(window.location.search);
    if (isPublicSsrPath(window.location.pathname)) {
      window.location.replace(window.location.pathname + window.location.search);
      return;
    }
    const exLegacyId = legacyParams.get("exercise");
    if (exLegacyId) {
      window.location.replace(`/exercise/${encodeURIComponent(exLegacyId)}`);
      return;
    }
    const foodLegacyId = legacyParams.get("food");
    if (foodLegacyId) {
      window.location.replace(`/food/${encodeURIComponent(foodLegacyId)}`);
      return;
    }
    const articleLegacySlug = legacyParams.get("article");
    if (articleLegacySlug) {
      window.location.replace(`/article/${encodeURIComponent(articleLegacySlug)}`);
      return;
    }
    const sportLegacySlug = legacyParams.get("sport");
    if (sportLegacySlug) {
      window.location.replace(`/sport/${encodeURIComponent(sportLegacySlug)}`);
      return;
    }

    // ذخیره کد معرفی
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      try { window.localStorage.setItem("fitap_referral_code", ref.trim().toUpperCase()); } catch {}
    }

    // tab از URL
    const tab = params.get("tab");
    if (tab) {
      // v51 (قانون بازار): تب mobileapp در اپ کافه‌بازار معتبر نیست — از هر
      // مسیری (لینک نوتیف قدیمی/URL دستی) بیاید به داشبورد برمی‌گردد.
      const validTabs = ["dashboard", "programs", "workouts", "nutrition", "progress", "chat", "plans", "referral", "support", "mobileapp", "exercise-bank", "food-bank", "activity"];
      const bazaar = isFitUpBazaarApp();
      const allowed = bazaar ? validTabs.filter((t) => t !== "mobileapp") : validTabs;
      if (allowed.includes(tab)) setMainTab(tab as any);
      else if (bazaar && tab === "mobileapp") setMainTab("dashboard");
    }

    // ─── ?renewal=1 → صفحه تمدید بعد از auth ───
    // لینک نوتیف‌های تمدید/انقضا (cron رفتاری) مستقیم به تجربه تمدید می‌رود:
    // رینگ روزها + آمار دوره + کد تخفیف + CTA. اگر کاربر لاگین نباشد، اول
    // auth و بعد صفحه تمدید باز می‌شود.
    const wantsRenewal = params.get("renewal") === "1";
    if (wantsRenewal) {
      // اگر همین الان در پنل است، مستقیم بازش کن
      if (useAppStore.getState().user && useAppStore.getState().screen === "main") {
        setOverlay("renewal");
      }
      // در غیر این صورت doAuthCheck بعد از ورود موفق بازش می‌کند
    }

    // v106: محل صریح پاس می‌شود — resolver حالا pathname (مسیرهای واقعی
    // /article/x، /tdee و…) را هم می‌خواند و کوئری قدیمی را اولویت می‌دهد.
    const urlScreen = getScreenFromUrl(window.location);
    // ─── حالت «برنامه»: PWA standalone یا اپ‌های نیتیو فیتاپ (بازار/اختصاصی) ───
    // اپ‌های نیتیو WebView هستند و display-mode:standalone ندارند — اما رفتارشان
    // باید مثل PWA باشد: URL خالی → auth check (نه لندینگ)، بک → خروج با تأیید.
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      isFitUpNativeApp();
    // ─── v123 — هش سکشن‌های لندینگ → همیشه لندینگ (درخواست مالک) ───
    // بردکرامب صفحات SSR (مثل «رشته‌های ورزشی» در /sport/<slug> → /#disciplines)
    // و CTA ابزارها (/#pricing) با بارگذاری کامل می‌آیند. قبلاً برای کاربر
    // لاگین‌شده (PWA/اپ) SSR به پنل/auth حل می‌شد و هش هرگز پیدا نمی‌شد —
    // حالا URL با هش سکشن لندینگ مثل ?view=landing رفتار می‌کند.
    const LANDING_SECTION_HASH_RE = /^#(features|tools|disciplines|ai-coach|sample-program|pricing|articles|install|faq)$/;
    const forceLanding =
      params.get("view") === "landing" || LANDING_SECTION_HASH_RE.test(window.location.hash);

    // ─── set payment_verify و refCode از URL (hydration-safe) ───
    // این مقادیر در useState با false/null شروع می‌شوند و اینجا set می‌شوند.
    const pv = params.get("payment_verify") === "1";
    setPaymentVerify(pv);
    const rawRef = params.get("ref");
    setRefCode(rawRef ? rawRef.trim().toUpperCase() : null);

    // ─── ۱. صفحات عمومی ───
    // v119 — همهٔ صفحات عمومی SSR شدند؛ گارد بالای تابع هر URL عمومی/legacy را
    // با بارگذاری کامل به مسیر واقعی می‌برد — اینجا فقط screenهای داخلی اپ می‌آیند.

    // ─── ۲. صفحات احتیاج به auth check ───
    // ?screen=panel → auth check → panel یا auth
    // ?screen=auth → auth check → panel یا auth
    // URL خالی → landing (مرورگر) یا auth check (PWA)
    const wantsPanel = urlScreen.screen === "main"; // ?screen=panel → getScreenFromUrl returns "main"
    const wantsAuth = urlScreen.screen === "auth";
    // v32: ?screen=admin → auth check → پنل مدیریت (رفع باگ «رفرش در تب ادمین می‌برد به داشبورد/لندینگ»)
    const wantsAdmin = urlScreen.screen === "admin";

    // در مرورگر معمولی:
    // - URL خالی → همیشه landing (حتی اگر لاگین است)
    // - ?screen=panel یا ?screen=auth → auth check
    // - ?view=landing → همیشه landing
    // - ادمین همیشه → پنل مدیریت
    if (!isStandalone || forceLanding) {
      if (!wantsPanel && !wantsAuth && !wantsAdmin && !wantsRenewal) {
        // URL خالی → landing
        showLanding();
        // auth check در background برای نمایش نام کاربر
        fetchAuthInBackground();
        return;
      }
      // ?screen=panel یا ?screen=auth یا ?screen=admin یا ?renewal=1 → auth check
      await doAuthCheck(wantsAuth);
      return;
    }

    // ─── PWA (standalone) ───
    // URL خالی → auth check → panel یا auth
    // ?screen=terms یا ?screen=contact → همان صفحه
    // ?view=landing → landing
    await doAuthCheck(false);

    // ─── توابع کمکی ───
    function showLanding() {
      if (ref) setScreen("referral-landing");
      else setScreen("landing");
    }

    /**
     * FIX (بازگشت درگاه بدون verify): بازیابی با throttle ۱۰ دقیقه‌ای.
     * قبلاً recover فقط در doAuthCheck (?screen=panel / PWA) صدا زده می‌شد —
     * کاربری که از بانک برنمی‌گشت و بعداً صرفاً صفحه اصلی را باز می‌کرد، هرگز
     * بازیابی نمی‌شد! حالا هر بازدید لاگین‌شده (حتی لندینگ) چک می‌شود.
     * (پیاده‌سازی مشترک: src/lib/fitness/recover-payments-client.ts)
     */

    async function fetchAuthInBackground() {
      // 🩹 v45: epoch در شروع — اگر وسط fetch کاربر logout کرد، پاسخ کهنه را نپذیر
      const epochAtStart = useAppStore.getState().sessionEpoch;
      try {
        // v156 — transport تاب‌آور: درخواست بوت دیگر هرگز روی سوکت مرده آویزان نمی‌ماند
        // 🩹 v166 — بوت سریع‌تر: ۶s×۱ به‌جای ۱۰s×۲ — بعد از سوییچ IP/بازکردن اپ،
        // داشبورد حداکثر ~۱۲ ثانیه‌ای کامل می‌شود نه ۳۰+ ثانیه (شکایت مالک:
        // «باز کردن مجدد اپ بعد از تغییر ای پی زمان زیادی میبره تا داشبورد بالا بیاد»).
        // SSR پنل را خوش‌بینانه رندر کرده؛ این fetch فقط داده را تازه می‌کند.
        const res = await fetchWithResilience(
          "/api/auth/me",
          { cache: "no-store" },
          { timeoutMs: 6_000, retries: 1 }
        );
        if (!res.ok) return;
        if (useAppStore.getState().sessionEpoch !== epochAtStart) return;
        const data = await res.json();
        // 🩹 v165 — خودترمیمی فلش «سشن قبلی» در هدر لندینگ (باگ مالک):
        // اگر به هر دلیلی HTML اولیه با نام کاربر رندر شده بود (کش کهنهٔ
        // مرورگر/WebView) ولی پاسخ قطعی سرور «لاگین نیست» باشد، همان لحظه
        // نام از استور پاک می‌شود و دکمهٔ «شروع» برمی‌گردد — بدون رفرش دستی.
        // (قبلاً این پاک‌سازی فقط در doAuthCheck مسیر پنل/PWA انجام می‌شد و
        // مسیر لندینگِ fetchAuthInBackground هیچ‌وقت HTML کهنه را تصحیح نمی‌کرد.)
        if (!data?.user) {
          useAppStore.setState({ ssrLandingUser: null });
        }
        if (data?.user) {
          if (useAppStore.getState().sessionEpoch !== epochAtStart) return;
          setUser(data.user);
          // ─── FIX (مسابقهٔ verify/recover — باگ «پرداخت معلق یافت نشد») ───
          // اگر همین حالا از درگاه برگشته‌ایم (payment_verify=1)،
          // PaymentVerifyHandler مالک verify است؛ recover پس‌زمینه نباید همزمان
          // پرداخت را claim کند و صفحهٔ رسید را با ۴۰۴ مواجه کند.
          if (!pv && shouldRecoverNow()) recoverPendingPayments();
        }
        if (data?.termsUpdateRequired) setTermsUpdateRequired(true);
      } catch {}
    }

    async function doAuthCheck(fallbackToAuth: boolean, attempt = 0) {
      try {
        // v156 — transport تاب‌آور (تایم‌اوت ۱۰s + ۱ ریتری): قبلاً fetch خام بود؛
        // روی سوکت مردهٔ سوییچ VPN آویزان می‌شد و تمام ریتری‌های پایین (که فقط
        // روی reject فعال‌اند) هرگز اجرا نمی‌شدند → اسپلش ابدی در PWA/اپ.
        // حالا آویزان‌شدن هم reject است → همهٔ تلاش‌ها واقعاً اجرا می‌شوند.
        // 🩹 v166 — تایم‌اوت بوت ۶s×۱ (بجای ۱۰s×۲) — جمع کل بدترین حالت ~۱۲s
        const res = await fetchWithResilience(
          "/api/auth/me",
          { cache: "no-store" },
          { timeoutMs: 6_000, retries: 1 }
        );
        // 🩹 v49 (باگ «تغییر VPN → رفرش → لاگ‌اوت»): خطای HTTP (۵۰۰ و…) هم مثل
        // خطای شبکه گذرا است — نه «لاگین‌نبودن». قبلاً res.ok چک نمی‌شد و بدنهٔ
        // خطا به‌جای user می‌خواند و کاربر به‌زور به لندینگ/auth پرت می‌شد.
        if (!res.ok) throw new Error(`auth/me HTTP ${res.status}`);
        const data = await res.json();
        if (data?.termsUpdateRequired) setTermsUpdateRequired(true);
        // v51 (مسدودسازی): کاربر مسدود → صفحهٔ زیبای «مسدود» — نه لندینگ نه لاگ‌اوت
        if (data?.blocked && !data?.user) {
          setUser(null);
          setScreen("blocked");
          return;
        }
        if (data?.user) {
          setUser(data.user);
          // 🩹 v170 — auth/me بوت همین الان اطلاعات کاربر را تازه کرد؛ تأخیر ۲.۵
          // ثانیه‌ایِ main-app دیگر auth/me دوم همیشگیِ هر رفرش را نمی‌زند
          // (in-request تکراری روی هر بوت — گزارش مالک: کندی رفرش داشبورد).
          markUserFresh();
          // 🩹 v139.2 — ثبت «آخرین تأیید لاگین موفق» برای ضدپرش به OTP در شکست‌های گذرای بعدی
          markAuthSuccess();
          authBgRetryRounds = 0;
          // ─── بازیابی خودکار پرداخت‌های معلق (باگ «در انتظار») ───
          // کاربری که در درگاه پرداخت کرده ولی به سایت برنگشته/سرور نیمه‌کاره مانده:
          // همینجا استعلام می‌کنیم؛ اگر پرداخت موفق بوده، پلن تحویل و کاربر به‌روز می‌شود.
          // FIX (مسابقهٔ verify/recover): در بازگشت از درگاه (pv) recover صدا زده
          // نمی‌شود — PaymentVerifyHandler مالک است؛ وگرنه claim همزمان باعث
          // «پرداخت معلق یافت نشد» روی صفحهٔ رسید می‌شد.
          if (!pv) recoverPendingPayments();
          if (data.user.role === "ADMIN") {
            setScreen("admin");
          } else if (shouldRestoreAnalysisPhase(data.user) && isAnalysisPhasePending()) {
            // v164 — کاربر وسط فاز تحلیل/خرید بود → دقیقاً همان‌جا برگردد (نه داشبورد).
            // دیرکتیو مالک: بعد از هر رفرش/سوییچ VPN باید «همون مدال خرید» بیاید بالا.
            setScreen("analysis");
            if (wantsRenewal) {
              setOverlay("renewal");
            }
          } else {
            setScreen(data.user.onboardingDone ? "main" : "onboarding");
            // کاربر با لینک ?renewal=1 آمده و وارد پنل شد → صفحه تمدید
            if (wantsRenewal && data.user.onboardingDone) {
              setOverlay("renewal");
            }
          }
        } else {
          // کاربر لاگین نیست (پاسخ قطعی ۲۰۰ — رفرش هم مشکلی ندارد)
          // 🩹 v139.2 — دفاع در برابر پاسخ گذرای سرور: 503/transient مثل خطای شبکه است
          if ((data as { transient?: boolean })?.transient) {
            throw new Error("auth/me transient");
          }
          // پاسخ قطعی «لاگین نیست» → نشانگر تازگی سشن دیگر معتبر نیست
          clearAuthHint();
          // v143 — نام SSR هدر لندینگ هم باید پاک شود تا کاربر لاگ‌اوت دوباره «شروع» ببیند
          useAppStore.setState({ ssrLandingUser: null });
          if (wantsRenewal) {
            // با لینک تمدید آمده — اول وارد شو؛ بعد از لاگین صفحه تمدید باز می‌شود
            try { window.sessionStorage.setItem("fitap_open_renewal", "1"); } catch {}
            setScreen("auth");
          } else if (isStandalone && !forceLanding) {
            setScreen("auth");
          } else if (fallbackToAuth) {
            setScreen("auth");
          } else {
            showLanding();
          }
        }
      } catch {
        // 🩹 v49: خطای شبکه/سرور ≠ خروج از حساب. وسط سوئیچ VPN چند ثانیه
        // قطعی/timeout طبیعی است — قبلاً همینجا کاربر لاگ‌اوت دیده می‌شد.
        // تا ۳ بار با فاصلهٔ فزاینده تلاش می‌کنیم (۸۰۰ms/۱۶۰۰ms/۲۴۰۰ms).
        if (attempt < 2) {
          window.setTimeout(() => { void doAuthCheck(fallbackToAuth, attempt + 1); }, 800 * (attempt + 1));
          return;
        }
        // 🩹 v139.2 (فیکس ریشه‌ای باگ «لحظه‌ای OTP/پرش به لندینگ در رفرش») —
        // بعد از اتمام تلاش‌ها هیچ پرشی نمی‌زنیم: «صفحه‌ای که SSR با سشن واقعی
        // حل کرده» معتبرترین حالت است (SSR کاربر لاگین را پنل می‌سازد، بی‌سشن را
        // auth/لندینگ). قبلاً fallback کلاینت (auth در PWA / لندینگ در مرورگر)
        // روی شکست گذرای شبکه اجرا می‌شد و کاربر سشن‌دار پرت می‌شد — حالا می‌مانیم
        // و در پس‌زمینه دوباره چک می‌کنیم. پاسخ «قطعی» سرور (200 بدون user) از
        // مسیر else بالا می‌گذرد و مثل قبل به auth/لندینگ می‌رود.
        if (authBgRetryRounds < 3) {
          authBgRetryRounds++;
          window.setTimeout(() => { void doAuthCheck(fallbackToAuth, 0); }, 5000);
        }
        return;
      }
    }
  };

  // ─── v170 — گرم‌کردن چانک‌های پنل در idle: اولین ورود به پنل هم مثل اپ
  // نصب‌شده فوری است (بدون SplashLoader وسط SPA transition) ───
  // v171 — چانک داشبورد (تب اول پنل) دیگر در idle گرم نمی‌شود؛ به‌محض دانستن
  // اسکرین main فوراً preload می‌شود (main-app خودش preloadDashboardView را
  // صادر می‌کند — ایمپورت داینامیک همان چانک داینامیک MainApp است، پس خودِ
  // چانک پنل هم یک‌جا گرم می‌شود؛ هیچ چانک اضافه‌ای برای لندینگ دانلود نمی‌شود).
  useEffect(() => {
    if (initial.screen === "main") {
      void import("@/components/fitness/main-app").then((m) => m.preloadDashboardView());
    }
    warmupPanelChunks();
    // initial همان اسنپ‌شات سرورِ همین بارگذاری است — عمداً فقط در mount
  }, []);

  // ─── mount: فقط auth check برای صفحات که نیاز دارند ───
  // صفحات عمومی از store اولیه نمایش داده می‌شوند (بدون صبر برای auth)
  useEffect(() => {
    if (typeof window === "undefined") return;
    // v106: فلگ مونت SPA — کامپوننت‌های بازاستفاده‌شده (ToolsNav/TermsPage/…)
    // با isSpaMounted() تشخیص می‌دهند که ناوبری SPA معتبر است یا باید
    // به روت‌های مستقل ناوبری واقعی بزنند (روت‌های /terms و… فلگ ندارند).
    (window as unknown as { __fitupSpaMounted?: boolean }).__fitupSpaMounted = true;
    // ─── گارد اسکرول اپ‌های نیتیو (بازار + اختصاصی — فیکس باگ رفرش با اسکرول به بالا) ───
    // داخل WebView های اندروید نصب می‌شود؛ در مرورگر/PWA بی‌اثر است.
    try {
      if (isFitUpNativeApp()) installBazaarScrollGuard();
    } catch {}
    // ─── دروازهٔ گالری در اپ اختصاصی (درخواست مالک): اولین انتخاب فایل →
    // مودال زیبای توضیح → بعد باز شدن گالری. فقط داخل اپ اختصاصی فعال است. ───
    try {
      if (isFitUpOwnApp()) installGalleryGate();
    } catch {}
    // ─── v139 — خودترمیمی شبکه در وب (تغییر IP/VPN → بدون خروج‌وورود) ───
    // v156 — سپر شبکهٔ سراسری: تایم‌اوت سخت برای هر fetch بی‌signal در کل اپ
    // (ریشه‌درمانی «خاموش کردن VPN → هیچ چیزی کار نمی‌کند»)
    try {
      installNetShield();
    } catch {}
    try {
      initNetworkRecovery();
    } catch {}
    // ─── v167 — گارد bfcache هدر لندینگ (فلش «سشن قبلی» — بار سوم گزارش مالک) ───
    // بازگشت به صفحه از کش back-forward مرورگر (دکمهٔ back / تعویض تب / بازیابی
    // سشن مرورگر) ممکن است DOM کهنهٔ دوران لاگین را با نام کاربر نشان دهد
    // (حتی با no-store — چون bfcache کل سند زندهٔ قبلی است، نه پاسخ HTTP).
    // در رویداد pageshow با persisted=true: نام SSR فوراً پاک می‌شود و یک
    // راستی‌آزمایی زندهٔ /api/auth/me اگر کاربر واقعاً لاگین بود همان را
    // برمی‌گرداند — در هر دو جهت فلشی دیده نمی‌شود.
    const onPageShow = (e: PageTransitionEvent) => {
      try {
        if (!(e as PageTransitionEvent & { persisted?: boolean }).persisted) return;
        const st = useAppStore.getState();
        if (st.screen !== "landing" || st.user) return;
        if (st.ssrLandingUser) useAppStore.setState({ ssrLandingUser: null });
        void (async () => {
          try {
            const res = await fetchWithResilience(
              "/api/auth/me",
              { cache: "no-store" },
              { timeoutMs: 6_000, retries: 1 }
            );
            if (!res.ok) return;
            const data = await res.json();
            if (data?.user) useAppStore.getState().setUser(data.user);
          } catch {}
        })();
      } catch {}
    };
    window.addEventListener("pageshow", onPageShow);
    applyUrlToScreen();
    return () => window.removeEventListener("pageshow", onPageShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── بازیابی خریدهای بازار (فقط داخل اپ اندروید) ───
  // اپ بعد از اتصال پولکی، خریدهای consume-نشده را از طریق
  // window.__fitupBazaarRestore(purchases) به سایت می‌دهد. هر خرید به
  // /api/payment/bazaar/purchase فرستاده می‌شود (idempotent — توکن مصرف‌شده
  // دوباره فعال نمی‌کند) و بعد از فعال‌سازی موفق consume می‌شود تا تمدید
  // بعدی ممکن باشد. سناریو: کرش اپ بین پرداخت و فعال‌سازی سرور.
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__fitupBazaarRestore = async (purchases: any[]) => {
      if (!Array.isArray(purchases) || purchases.length === 0) return;
      for (const p of purchases) {
        try {
          const productId = String(p?.productId || "");
          const purchaseToken = String(p?.purchaseToken || "");
          if (!productId || !purchaseToken) continue;
          // v102 — SKUهای شارژ کیف پول به مسیر اختصاصی کیف پول می‌روند
          // (قبلاً planId = "wallet_100000" ساخته می‌شد و مسیر پلن 400 می‌داد →
          // خرید هرگز consume نمی‌شد و restore هر بار تکرار می‌شد)
          const endpoint = productId.startsWith("fitup_wallet_")
            ? "/api/payment/bazaar/wallet"
            : "/api/payment/bazaar/purchase";
          const planId = String(p?.planId || productId.replace(/^fitup_/, ""));
          if (!planId && endpoint === "/api/payment/bazaar/purchase") continue;
          const res = await fetchWithResilience(
            endpoint,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(endpoint === "/api/payment/bazaar/purchase" ? { planId } : {}),
                productId,
                purchaseToken,
                orderId: p?.orderId || null,
                // v55 — امضای خرید برای مسیر پشتیبان RSA (وقتی API بازار در دسترس نیست)
                dataJson: p?.dataJson || undefined,
                signature: p?.signature || undefined,
              }),
            },
            // idempotent سمت سرور (توکن مصرف‌شده دوباره فعال نمی‌شود) — ریتری امن است
            { timeoutMs: 15_000, retries: 1 }
          );
          if (res.ok) {
            try {
              (window as any).FitUpNative?.consumePurchase?.(purchaseToken);
            } catch {}
          }
        } catch {}
      }
    };
    return () => {
      try {
        delete (window as any).__fitupBazaarRestore;
      } catch {}
    };
  }, []);

  // ─── اپ اندروید نیتیو (اختصاصی + بازار): مودال زیبای «فعال‌سازی اعلان‌ها» بعد از ورود ───
  // مجوز نوتیف (POST_NOTIFICATIONS اندروید ۱۳+) «در زمان خودش» گرفته می‌شود:
  // بعد از ورود موفق کاربر به پنل — نه در استارتاپ (درخواست مالک).
  // فقط یک‌بار در عمر نصب پرسیده می‌شود؛ تأیید → پل نیتیو + ثبت، رد → دیگر پرسیده نمی‌شود.
  // v31: بازار هم شامل شد (قبلاً فقط اپ اختصاصی بود → کاربران بازار هرگز پرسیده
  // نمی‌شدند و نوتیف‌ها روی اندروید ۱۳+ بی‌صدا no-op بود) + بعد از رضایت،
  // گارد بهینه‌سازی باتری + همگام‌سازی فوری اعلان‌های از-دست-رفته.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user || screen !== "main") return;
    if (!isFitUpNativeApp()) return;
    try {
      if (window.localStorage.getItem("fitup_perm_notifications_asked") === "1") return;
    } catch {}
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      try { window.localStorage.setItem("fitup_perm_notifications_asked", "1"); } catch {}
      const ok = await showPermissionGate("notifications");
      if (!cancelled && ok) {
        requestNativeNotificationPermission();
        // گارد باتری — فقط بعد از رضایت اعلان‌ها (دیالوگ نیتیو خودش یک‌بار-محور است)
        requestBatteryOptimizationExemption();
      }
      // همگام‌سازی فوری — هر ورود به پنل، اعلان‌های زمانِ بسته‌بودن را جبران می‌کند
      syncNativeNotificationsNow();
    }, 2600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, screen]);

  // ─── popstate: ساده! فقط URL را دوباره بخوان ───
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const store = useAppStore.getState();
      const currentScreen = store.screen;

      // ─── در پنل ورزشکار: بک اول → داشبورد، بک دوم → خروج از پنل ───
      if (currentScreen === "main") {
        const currentTab = store.mainTab;
        if (currentTab && currentTab !== "dashboard") {
          // بک اول: برگرد به داشبورد (URL هم همان لحظه تمیز می‌شود)
          store.setMainTab("dashboard");
          try {
            const url = new URL(window.location.origin + window.location.pathname);
            url.searchParams.set("screen", "panel");
            url.searchParams.set("tab", "dashboard");
            window.history.pushState(null, "", url.toString());
          } catch {
            window.history.pushState(null, "", window.location.href);
          }
          return;
        }
        // در dashboard — بک دوم: خروج از پنل
        // (PWA standalone یا اپ نیتیو — در مرورگر معمولی → لندینگ)
        const inAppShell =
          window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as any).standalone === true ||
          isFitUpNativeApp();
        if (inAppShell) {
          // PWA: دیالوگ درون‌برنامه‌ای به‌جای confirm() — در WebView محدود confirm
          // همیشه false برمی‌گرداند و کاربر با دکمه back گیر می‌کرد
          setShowExitConfirm(true);
          // یک entry دوباره push می‌کنیم تا back بعدی (وقتی دیالوگ باز است)
          // مستقیماً از برنامه خارج نکند
          window.history.pushState(null, "", window.location.href);
        } else {
          // مرورگر معمولی: به landing برگرد — با URL تمیز (بدون ?screen=panel
          // تا رفرش/بک بعدی دوباره وارد پنل نشود)
          store.setScreen("landing");
          try { window.history.replaceState(null, "", "/"); } catch {}
        }
        return;
      }

      // ─── ادمین: در PWA/اپ نیتیو اعلان خروج ───
      if (currentScreen === "admin") {
        const inAppShell =
          window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as any).standalone === true ||
          isFitUpNativeApp();
        if (inAppShell) {
          // دیالوگ درون‌برنامه‌ای به‌جای confirm() (همان مشکل WebView محدود)
          setShowExitConfirm(true);
          window.history.pushState(null, "", window.location.href);
        }
        return;
      }

      // ─── صفحات عمومی: URL را دوباره بخوان ───
      // مرورگر URL را تغییر داده، ما فقط آن را می‌خوانیم
      applyUrlToScreen();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── پل back اپ نیتیو (درخواست مالک): بک اول از هر قسمت به جز داشبورد → داشبورد؛
  // بک روی داشبورد → مودال تأیید خروج native (در MainActivity.kt).
  // MainActivity با evaluateJavascript این تابع را صدا می‌زند و بر اساس خروجی
  // ('overlay' | 'dashboard' | 'home') تصمیم می‌گیرد. ترتیب منطق:
  //   ۱) اورلی باز → فقط بستن اورلی
  //   ۲) تب/صفحه دیگر (تمرین/غذا/مقاله/ابزار/…) → پرش SPA به داشبورد (بدون رفرش)
  //   ۳) روی داشبورد → 'home' → native مودال خروج نشان می‌دهد
  useEffect(() => {
    (window as any).__fitupNativeBack = () => {
      try {
        const st = useAppStore.getState();
        // 🩹 v49 (باگ «بک در صفحهٔ نتیجهٔ پرداخت از برنامه خارج می‌کند»):
        // در بازگشت از درگاه (?payment_verify=1) بک باید به پنل/خانهٔ خود
        // سایت برگردد — نه دیالوگ خروج نیتیو. رویداد داخلی برای
        // PaymentVerifyHandler فرستاده می‌شود تا همان منطق finish/backHome را اجرا کند.
        if (new URLSearchParams(window.location.search).get("payment_verify") === "1") {
          window.dispatchEvent(new CustomEvent("fitup:payment-verify-back"));
          try { window.history.pushState(null, "", window.location.href); } catch {}
          return "overlay"; // هندل شد — نیتیو هیچ کاری نکند
        }
        // کاربر لاگین‌نکرده (auth/لندینگ) — داشبوردی وجود ندارد → مودال خروج
        if (!st.user) return "home";
        if (st.screen === "main" && st.overlay) {
          st.setOverlay(null);
          try { window.history.pushState(null, "", window.location.href); } catch {}
          return "overlay";
        }
        const atDashboard = st.screen === "main" && st.mainTab === "dashboard";
        if (!atDashboard) {
          st.setOverlay(null);
          st.setScreen("main");
          st.setMainTab("dashboard");
          try {
            const u = new URL(window.location.origin + window.location.pathname);
            u.searchParams.set("screen", "panel");
            u.searchParams.set("tab", "dashboard");
            window.history.pushState(null, "", u.toString());
          } catch {
            try { window.history.pushState(null, "", window.location.href); } catch {}
          }
          return "dashboard";
        }
        return "home";
      } catch {
        return "unknown";
      }
    };
    return () => {
      try { delete (window as any).__fitupNativeBack; } catch {}
    };
  }, []);

  // ─── خروج از PWA (تأییدشده با دیالوگ) ───
  // بستن پنجره در PWA نصب‌شده معمولاً توسط مرورگر مجاز نیست → تلاش می‌کنیم
  // و همیشه به لندینگ برمی‌گردیم (اگر close موفق باشد صفحه unload می‌شود و
  // setScreen عملاً اجرا نمی‌شود).
  function exitPwaApp() {
    setShowExitConfirm(false);
    try {
      window.close();
    } catch {}
    setScreen("landing");
  }

  // ─── تایتل پویا ───
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.title = PAGE_TITLES[screen] || "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه";
  }, [screen]);

  // ─── v148 — اسکوپِ غیرفعال‌سازی pull-to-refresh مرورگر ───
  // v143 روی html/body «سراسری» overscroll-behavior-y: contain گذاشته بود و
  // کشیدن-به-پایین (رفرش مرورگر) را در کل سایت خفه کرده بود. حالا CSS فقط
  // وقتی اعمال می‌شود که کلاس panel-screen روی <html> باشد؛ این effect کلاس
  // را دقیقاً داخل پوستهٔ SPA (پنل/احراز هویت/آنبردینگ/تحلیل/ادمین/…) ست
  // می‌کند و با خروج به لندینگ حذف می‌شود. روی صفحات عمومی SSR (مقالات/
  // tdee/حرکات/غذاها) این کامپوننت اصلاً مونت نیست → کلاس نیست → PTR کار
  // می‌کند. پاک‌سازی در unmount هم تضمین می‌کند کلاس بی‌صاحب نماند.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const inPanelShell = paymentVerify || PANEL_SHELL_SCREENS.has(screen);
    document.documentElement.classList.toggle("panel-screen", inPanelShell);
    return () => {
      document.documentElement.classList.remove("panel-screen");
    };
  }, [screen, paymentVerify]);

  // ─── v171 — کراس‌فید اسپلش → پنل (سوییچ خشک ممنوع) ───
  // هر جا اسپلش به محتوای واقعی تبدیل می‌شود (مثلاً پاسخ auth/me در مسیر
  // خوش‌بینانهٔ SSR رسید)، SplashLoader به‌جای unmount ناگهانی، ۲۲۰ms روی
  // محتوای جدید محو می‌شود (fixed روی همه‌چیز، بدون رخداد موس).
  const [splashFading, setSplashFading] = useState(false);
  const hideSplashFade = useCallback(() => setSplashFading(false), []);
  const splashNow = screen === "loading" || (screen === "main" && !user);
  const prevSplashRef = useRef(splashNow);
  useEffect(() => {
    if (prevSplashRef.current && !splashNow) {
      // همین لحظه اسپلش → محتوا شده — فید-اوت را روشن کن
      setSplashFading(true);
    }
    prevSplashRef.current = splashNow;
  }, [splashNow]);

  // ─── اسکرول: هر بار که screen تغییر می‌کند، به بالا برو ───
  // استثنا: landing — اسکرول حفظ می‌شود (مرورگر خودش مدیریت می‌کند)
  // این مشکل «لینک از وسط صفحه → صفحه جدید از وسط باز می‌شود» را حل می‌کند
  const prevScreenRef = useRef(screen);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // همه صفحات به‌جز landing — وقتی screen تغییر می‌کند، اسکرول به بالا
    // ⚠️ instant (نه auto): html دارای scroll-behavior:smooth است و auto به
    // انیمیشن تبدیل می‌شود که با تغییر layout می‌تواند وسط راه لغو شود.
    if (screen !== "loading" && screen !== prevScreenRef.current && screen !== "landing") {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    prevScreenRef.current = screen;
  }, [screen]);

  // ═══════════════════════════════════════════════════════════════
  //  رندر صفحه بر اساس screen
  // ═══════════════════════════════════════════════════════════════

  // FE-C1: onDone فلگ paymentVerify را ریست می‌کند تا کاربر بعد از خروج از
  // صفحهٔ نتیجهٔ پرداخت (موفق/ناموفق) در آن گیر نکند — قبلاً این فلگ فقط در
  // mount ست می‌شد و هیچ مسیری false‌اش نمی‌کرد (نجات فقط با reload).
  // ⭐ v171 — ضد فلش اسپلش روی رفرش پنل: تا وقتی store زنده هنوز «loading»
  // است (فاصلهٔ بین hydration و هم‌ترازی layout-effect)، به‌جای SplashLoader
  // «اسکرین اولیهٔ SSR» رندر می‌شود — یعنی دقیقاً همان چیزی که HTML سرور دارد.
  // اگر initial.screen === "main" باشد، کاربر همان پنل را می‌بیند (user در
  // شاخهٔ پایین از هوک می‌آید که در hydration = ssrUser سرور است — پس MainApp
  // عین HTML سرور رندر می‌شود، بدون mismatch و بدون فریم اسپلش).
  const view = (
    screen === "loading" && initial.screen !== "loading"
      ? (initial.screen as AppScreen)
      : screen
  ) as AppScreen;

  if (paymentVerify)
    return <PaymentVerifyHandler onDone={() => setPaymentVerify(false)} />;
  if (view === "loading") return <SplashLoader />;
  if (view === "blocked") return <BlockedScreen />;
  if (view === "referral-landing" && refCode) return <ReferralLanding refCode={refCode} />;
  if (view === "landing") return (
    <>
      <LandingPage />
      <NikaWidget />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
  if (view === "auth") return (
    <>
      <AuthScreen />
      <NikaWidget />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
  if (view === "onboarding") return (
    <>
      <OnboardingScreen />
      <NikaWidget />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
  if (view === "analysis") return <AnalysisScreen />;
  if (view === "admin") {
    return (
      <div className="fixed inset-0 bg-white">
        <AdminOverlay standalone />
        <PwaExitConfirmDialog
          open={showExitConfirm}
          onStay={() => setShowExitConfirm(false)}
          onExit={exitPwaApp}
        />
      </div>
    );
  }
  // v119 — شاخه‌های رندر صفحات عمومی (articles/article/tool-tdee/sport-detail/
  // terms/contact/about) حذف شدند — همه SSR هستند و گارد applyUrlToScreen
  // هر ورودی stale را به مسیر واقعی می‌برد.
  return (
    <>
      {/* 🩹 v45: گارد کاربر شبح — MainApp هرگز بدون user مونت نمی‌شود
          (باگ «بعد از خروج دکمه‌ها تا رفرش کار نمی‌کنند»)
          🩹 v170 — به‌جای null (صفحهٔ سفید مرده) SplashLoader استاندارد: اگر
          SSR کاربر را از دست داده باشد (buildUserDto خطا/شبکهٔ ضعیف)، کاربر
          حالا اسپلش تمیز می‌بیند تا auth/me بوت برمی‌گرداند — نه سفیدی.
          ⭐ v171 — user از هوک می‌آید نه getState(): در hydration هوک مقدار
          اسنپ‌شات (= ssrUser سرور) را می‌دهد → خروجی hydration با HTML سرور
          یکی می‌ماند (قبلاً getState() زنده null برمی‌گرداند و mismatch/
          فلش اسپلش می‌ساخت). */}
      {user ? <MainApp /> : <SplashLoader />}
      {/* v171 — فید-اوت ۲۲۰ms اسپلش روی پنل (بدون سوییچ خشک) */}
      {splashFading && <SplashFadeOut onDone={hideSplashFade} />}
      <PwaExitConfirmDialog
        open={showExitConfirm}
        onStay={() => setShowExitConfirm(false)}
        onExit={exitPwaApp}
      />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
}
