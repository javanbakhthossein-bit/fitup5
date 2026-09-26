"use client";

import { recoverPendingPayments, shouldRecoverNow } from "@/lib/fitness/recover-payments-client";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { useAppStore, setHydrationSnapshot, clearHydrationSnapshot } from "@/lib/fitness/store";
import { isFitUpNativeApp, isFitUpOwnApp, requestBatteryOptimizationExemption, requestNativeNotificationPermission, syncNativeNotificationsNow } from "@/lib/fitness/app-bridge";
import { isFitUpBazaarApp } from "@/lib/fitness/bazaar-bridge";
import { installBazaarScrollGuard } from "@/lib/fitness/bazaar-scroll-guard";
import { installGalleryGate, showPermissionGate } from "@/lib/fitness/permission-gate";
import { PermissionGateModal } from "@/components/fitness/permission-gate-modal";
import { AppUpdateModal } from "@/components/fitness/app-update-modal";
import { SplashLoader } from "@/components/fitness/splash-loader";
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
  useEffect(() => {
    clearHydrationSnapshot();
    const st = useAppStore.getState();
    if (st.screen === "loading" && initial.screen !== "loading") {
      useAppStore.setState({
        screen: initial.screen as typeof st.screen,
        ...(initial.mainTab ? { mainTab: initial.mainTab as typeof st.mainTab } : {}),
      });
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
      const validTabs = ["dashboard", "programs", "workouts", "nutrition", "progress", "chat", "plans", "referral", "support", "mobileapp"];
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
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        if (useAppStore.getState().sessionEpoch !== epochAtStart) return;
        const data = await res.json();
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
        const res = await fetch("/api/auth/me", { cache: "no-store" });
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
          // ─── بازیابی خودکار پرداخت‌های معلق (باگ «در انتظار») ───
          // کاربری که در درگاه پرداخت کرده ولی به سایت برنگشته/سرور نیمه‌کاره مانده:
          // همینجا استعلام می‌کنیم؛ اگر پرداخت موفق بوده، پلن تحویل و کاربر به‌روز می‌شود.
          // FIX (مسابقهٔ verify/recover): در بازگشت از درگاه (pv) recover صدا زده
          // نمی‌شود — PaymentVerifyHandler مالک است؛ وگرنه claim همزمان باعث
          // «پرداخت معلق یافت نشد» روی صفحهٔ رسید می‌شد.
          if (!pv) recoverPendingPayments();
          if (data.user.role === "ADMIN") {
            setScreen("admin");
          } else {
            setScreen(data.user.onboardingDone ? "main" : "onboarding");
            // کاربر با لینک ?renewal=1 آمده و وارد پنل شد → صفحه تمدید
            if (wantsRenewal && data.user.onboardingDone) {
              setOverlay("renewal");
            }
          }
        } else {
          // کاربر لاگین نیست (پاسخ قطعی ۲۰۰ — رفرش هم مشکلی ندارد)
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
        // بعد از اتمام تلاش‌ها: رفتار قبلی (صفحهٔ مقصد بر اساس محیط)
        if (isStandalone && !forceLanding) {
          setScreen("auth");
        } else if (fallbackToAuth) {
          setScreen("auth");
        } else {
          showLanding();
        }
      }
    }
  };

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
    applyUrlToScreen();
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
          const res = await fetch(endpoint, {
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
          });
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
  if (paymentVerify)
    return <PaymentVerifyHandler onDone={() => setPaymentVerify(false)} />;
  if (screen === "loading") return <SplashLoader />;
  if (screen === "blocked") return <BlockedScreen />;
  if (screen === "referral-landing" && refCode) return <ReferralLanding refCode={refCode} />;
  if (screen === "landing") return (
    <>
      <LandingPage />
      <NikaWidget />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
  if (screen === "auth") return (
    <>
      <AuthScreen />
      <NikaWidget />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
  if (screen === "onboarding") return (
    <>
      <OnboardingScreen />
      <NikaWidget />
      <AppUpdateModal />
      <PermissionGateModal />
    </>
  );
  if (screen === "analysis") return <AnalysisScreen />;
  if (screen === "admin") {
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
          (باگ «بعد از خروج دکمه‌ها تا رفرش کار نمی‌کنند») */}
      {useAppStore.getState().user ? <MainApp /> : null}
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
