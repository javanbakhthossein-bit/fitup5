"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Apple,
  TrendingUp,
  MessageCircle,
  Crown,
  ClipboardList,
  Dumbbell,
  Gift,
  Headphones,
  Smartphone,
  Loader2,
  Footprints,
} from "lucide-react";
import {
  useAppStore,
  restoreActiveSession,
  restorePlanCache,
  refreshUserIfNeeded,
  type MainTab,
} from "@/lib/fitness/store";
// Task 3-a — پالس ۳ ثانیه‌ای سراسری (تک‌اینترول ماژول-سینگلتون)
import { usePulse, requestPulseNow } from "@/lib/fitness/use-pulse";
import { fetchWithResilience } from "@/lib/payment/client-fetch";
// v118 — گارد «بستن دو مرحله‌ای» مدال توضیحات حرکت روی Sheet حالت باشگاه
import { wasExerciseModalJustClosed } from "@/lib/fitness/exercise-modal-guard";
import { isAppShellMode } from "@/lib/fitness/app-bridge";
import { isFitUpBazaarApp } from "@/lib/fitness/bazaar-bridge";
import { isFitUpOwnApp } from "@/lib/fitness/app-bridge";
// v104 — ردیابی «زمان مصرف اپ‌ها» (داشبورد مدیر: میانگین زمان مصرف ۲۴ ساعت)
import { useUsageTracker, setUsageScreen } from "@/lib/fitness/use-usage-tracker";
// v172 — زنده‌سازی پنل کاربر (SSE — سند real-time مالک)
import { startPanelRealtime } from "@/lib/fitness/panel-realtime";
import { ProgramsView } from "@/components/fitness/views/programs-view";
import { WorkoutsView } from "@/components/fitness/views/workouts-view";
import { NutritionView } from "@/components/fitness/views/nutrition-view";
import { PlansView } from "@/components/fitness/views/plans-view";
import { ReferralView } from "@/components/fitness/views/referral-view";
import { SupportView } from "@/components/fitness/views/support-view";
import { MobileAppView } from "@/components/fitness/views/mobile-app-view";
import { ViewErrorBoundary } from "@/components/fitness/view-error-boundary";
import { NotificationsOverlay } from "@/components/fitness/views/notifications-overlay";
import { ProfileOverlay } from "@/components/fitness/views/profile-overlay";
import { SubscriptionOverlay } from "@/components/fitness/views/subscription-overlay";
// v15: ویو قفل برای تب‌های نیازمند پلن (کاربر بدون پلن فعال)
import { PlanLockedView } from "@/components/fitness/views/plan-locked-view";
import { TopBar } from "@/components/fitness/top-bar";
import { Sidebar } from "@/components/fitness/sidebar";
// ─── تور راهنمای ورود اول (Task 3-c) — خودش با فلگ localStorage گیت می‌شود ───
import { PanelTour } from "@/components/fitness/panel-tour";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
// ─── Dialog وسط‌چین برای ویدیو/آزمایش خون (درخواست مالک v15) ───
// قبلاً این دو صفحه Sheet پایین‌چین (side="bottom") بودند که در موبایل به
// پایین صفحه «چسبیده» دیده می‌شدند. الان Dialog وسط صفحه‌اند — و Radix
// Dialog خودش اسکرول پشت مودال را قفل می‌کند.
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// ─── Lazy-load کامپوننت‌های سنگین (درخواست مالک: اپ نرم‌تر و سریع‌تر) ───
// این کامپوننت‌ها هزاران خط کد + recharts + markdown دارند ولی فقط در
// لحظه‌ی نیاز باز می‌شوند — با جدا کردنشان از باندل اصلی، اولین بارگذاری
// پنل برای همه کاربران (موبایل/WebView بازار) به‌طور محسوسی سبک‌تر می‌شود.
// Skeleton مشترک برای همه:
const ViewSkeleton = () => (
  <div className="flex flex-col items-center justify-center py-16 gap-2 h-full">
    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
    <p className="text-xs text-slate-400">در حال بارگذاری…</p>
  </div>
);

// تب‌های سنگین (نمودار/چت) — فقط با باز شدن تب لود می‌شوند
const DashboardView = dynamic(() => import("@/components/fitness/views/dashboard-view").then((m) => m.DashboardView), { ssr: false, loading: ViewSkeleton });

// v171 — پیش‌بارگذاری فوری چانک داشبورد (تب اول پنل):
// قبلاً داشبورد فقط در idle گرم می‌شد (panel-warmup) — دیر بود. page-client
// به‌محض دانستن اسکرین main این تابع را صدا می‌زند تا اولین رندر داشبورد
// هرگز منتظر دانلود چانک نماند (ایمپورت همان مسیر dynamic بالا است —
// webpack همان چانک را resolve می‌کند؛ هیچ دانلود اضافه‌ای ساخته نمی‌شود).
export function preloadDashboardView(): void {
  import("@/components/fitness/views/dashboard-view").catch(() => {
    // شکست preload بی‌اهمیت است — چانک در نیاز واقعی لود می‌شود
  });
}
// v139 — بانک‌های ایزوله داخل پنل (کداسپلیت — فقط با ورود به تب لود می‌شوند)
const ExerciseBankTab = dynamic(() => import("@/components/fitness/views/exercise-bank-tab").then((m) => m.ExerciseBankTab), { ssr: false, loading: ViewSkeleton });
const FoodBankTab = dynamic(() => import("@/components/fitness/views/food-bank-tab").then((m) => m.FoodBankTab), { ssr: false, loading: ViewSkeleton });
// v143 — مسیریاب پیاده‌روی/دویدن داخل پنل (کداسپلیت)
const ActivityTab = dynamic(() => import("@/components/fitness/views/activity-tab").then((m) => m.ActivityTab), { ssr: false, loading: ViewSkeleton });
const BankExerciseDetailPanel = dynamic(() => import("@/components/fitness/views/bank-exercise-detail-panel").then((m) => m.BankExerciseDetailPanel), { ssr: false, loading: ViewSkeleton });
const ProgressView = dynamic(() => import("@/components/fitness/views/progress-view").then((m) => m.ProgressView), { ssr: false, loading: ViewSkeleton });
const ChatView = dynamic(() => import("@/components/fitness/views/chat-view").then((m) => m.ChatView), { ssr: false, loading: ViewSkeleton });

// Overlayهای سنگین — ادمین (۹هزار خط!) فقط برای ادمین‌ها لود می‌شود
const AdminOverlay = dynamic(() => import("@/components/fitness/views/admin-overlay").then((m) => m.AdminOverlay), { ssr: false, loading: ViewSkeleton });
const GymModeView = dynamic(() => import("@/components/fitness/views/gym-mode-view").then((m) => m.GymModeView), { ssr: false, loading: ViewSkeleton });
const VideoAnalysisView = dynamic(() => import("@/components/fitness/views/video-analysis-view").then((m) => m.VideoAnalysisView), { ssr: false, loading: ViewSkeleton });
const BloodTestView = dynamic(() => import("@/components/fitness/views/blood-test-view").then((m) => m.BloodTestView), { ssr: false, loading: ViewSkeleton });
const SurveyOverlay = dynamic(() => import("@/components/fitness/views/survey-overlay").then((m) => m.SurveyOverlay), { ssr: false, loading: ViewSkeleton });
const ExerciseDetailOverlay = dynamic(() => import("@/components/fitness/views/exercise-detail-overlay").then((m) => m.ExerciseDetailOverlay), { ssr: false, loading: ViewSkeleton });
const ActiveWorkoutSession = dynamic(() => import("@/components/fitness/views/active-workout-session").then((m) => m.ActiveWorkoutSession), { ssr: false, loading: ViewSkeleton });
// صفحه تمدید — فقط وقتی کاربر بخواهد تمدید کند
const RenewalOverlay = dynamic(() => import("@/components/fitness/views/renewal-overlay").then((m) => m.RenewalOverlay), { ssr: false, loading: ViewSkeleton });

const NAV_ITEMS_ALL: { id: MainTab; label: string; icon: any }[] = [
  { id: "dashboard", label: "داشبورد", icon: LayoutDashboard },
  { id: "programs", label: "برنامه‌ها", icon: ClipboardList },
  { id: "workouts", label: "تمرین‌ها", icon: Dumbbell },
  { id: "nutrition", label: "دستیار تغذیه", icon: Apple },
  { id: "exercise-bank", label: "بانک حرکات", icon: Dumbbell },
  { id: "food-bank", label: "بانک غذاها", icon: Apple },
  // v143 (دیرکتیو مالک) — مسیریاب پیاده‌روی/دویدن داخل پنل
  { id: "activity", label: "پیاده‌روی و دویدن", icon: Footprints },
  { id: "progress", label: "پیشرفت", icon: TrendingUp },
  { id: "chat", label: "چت با فیتاپ", icon: MessageCircle },
  { id: "referral", label: "معرفی به دوست", icon: Gift },
  { id: "support", label: "پشتیبانی", icon: Headphones },
  { id: "mobileapp", label: "اپ موبایل", icon: Smartphone },
  { id: "plans", label: "پلن‌ها", icon: Crown },
];

// ═══ FE-M8: دکمه back اندروید/مرورگر اول overlay (Sheet) را می‌بندد ═══
// وقتی overlay (پروفایل/اعلان/اشتراک/...) باز است، popstate (back) فقط overlay
// را می‌بندد، نه خروج از پنل/landing.
// مهم: این listener در سطح module ثبت می‌شود تا قبل از popstate handler اصلی
// (page-client — که در useEffect بعد از mount ثبت می‌شود) اجرا شود؛ به این
// ترتیب stopImmediatePropagation مانع reset شدن تب/رفتن به landing/confirm
// خروج در PWA می‌شود. فلگ روی window از ثبت تکراری در HMR جلوگیری می‌کند.
if (typeof window !== "undefined" && !(window as any).__fitupOverlayBackGuard) {
  (window as any).__fitupOverlayBackGuard = true;
  window.addEventListener("popstate", (e: PopStateEvent) => {
    const st = useAppStore.getState();
    if (st.screen === "main" && st.overlay) {
      st.setOverlay(null);
      // یک entry دوباره push می‌کنیم تا back بعدی مستقیماً از پنل خارج نکند
      try {
        window.history.pushState({ fitupOverlay: true }, "", window.location.href);
      } catch {}
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });
}

export function MainApp() {
  // ─── v55 — subscription انتخابی (فیکس ریشه‌ای لگ ناوبری تمرین) ───
  // قبلاً useAppStore() بدون سلکتور کل store را subscribe می‌کرد؛ یعنی هر setState
  // (هر تپ «حرکت بعدی/قبلی»، هر «تکمیل ست»، هر تیک…) کل MainApp و تمام درختش
  // (TopBar/Sidebar/PanelTour/همهٔ Sheetها) را re-render می‌کرد.
  // حالا: activeSession به‌صورت بولی سلکت می‌شود تا در حین ناوبری جلسه (تغییر
  // currentExerciseIdx) شناسه‌اش تغییر نکند و MainApp اصلاً re-render نشود؛
  // فقط خود ActiveWorkoutSession (مشترکِ مستقل به activeSession) رندر می‌شود.
  const mainTab = useAppStore((s) => s.mainTab);
  const overlay = useAppStore((s) => s.overlay);
  const hasActiveSession = useAppStore((s) => !!s.activeSession);
  const user = useAppStore((s) => s.user);
  const setOverlay = useAppStore((s) => s.setOverlay);
  const setScreen = useAppStore((s) => s.setScreen);
  const setMainTab = useAppStore((s) => s.setMainTab);

  // ─── Task 3-a: پالس ۳ ثانیه‌ای (سینگلتون سراسری — داشبورد هم از همین استفاده می‌کند) ───
  // usePulse در main-app mount می‌شود تا پالس در «سراسر پنل» زنده بماند؛
  // dashboard-view و بقیه فقط snapshot مشترک را می‌خوانند (بدون interval دوم).
  const { unread } = usePulse();
  // مرجع واکشی اعلان‌ها — برای واکنش فوری به افزایش unread از مسیر پالس
  const loadNotificationsRef = useRef<(() => void) | null>(null);
  // baseline ناخوانده‌ها — فقط «افزایش» واکنش دارد (اولین پالس اسپم نمی‌کند)
  const prevPulseUnreadRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevPulseUnreadRef.current != null && unread > prevPulseUnreadRef.current) {
      // اعلان تازه از سرور (پالس ۳ ثانیه‌ای) → واکشی فوری لیست کامل
      loadNotificationsRef.current?.();
    }
    prevPulseUnreadRef.current = unread;
  }, [unread]);

  // ─── 🩹 v45: گارد کاربر شبح (باگ «بعد از خروج دکمهٔ شروع تا رفرش کار نمی‌کند») ───
  // اگر به هر دلیلی (race پاسخ async، خطای مسیر خروج قدیمی) MainApp بدون
  // user مونت شود، پنل خالی و مرده رندر می‌شد. حالا: رندر نمی‌شود و به
  // صفحهٔ ورود (اپ) یا لندینگ (مرورگر) برمی‌گردیم.
  useEffect(() => {
    if (!user) {
      setScreen(isAppShellMode() ? "auth" : "landing");
    }
  }, [user, setScreen]);

  // ─── v104 — ضربان‌سنج «زمان مصرف اپ‌ها» (سینگلتون سراسری؛ فقط فعالیت قابل‌مشاهده) ───
  useUsageTracker();
  useEffect(() => {
    setUsageScreen(mainTab);
  }, [mainTab]);

  // ─── v48: تازه‌سازی زندهٔ اطلاعات کاربر — ریشه‌کنی «چت قفل است تا رفرش کنم» ───
  // در WebView اپ‌ها و PWA اپ ممکن است ساعت‌ها باز بماند؛ اگر دادهٔ کاربر در
  // store کهنه/ناقص باشد، همهٔ گیت‌های پلن غلط «قفل» نشان می‌دهند. حالا هر بار
  // اپ mount می‌شود یا به foreground برمی‌گردد (visibilitychange/focus)،
  // اطلاعات کاربر بی‌صدا از /api/auth/me تازه می‌شود (throttle ۶۰s داخل lib).
  useEffect(() => {
    // v143 — ضد درخواست تکراری: doAuthCheck (page-client) بلافاصله در mount
    // /api/auth/me را می‌زند؛ فراخوانی همزمانِ دومِ همین endpoint هر رفرش را
    // دوبرابر سنگین می‌کرد (گزارش مالک: کندی رفرش داشبورد). ۲.۵ ثانیه بعد
    // تازه‌سازی مستقل انجام می‌شود — بعد از settle شدن auth-check اولیه.
    const t = setTimeout(() => {
      // v170 — اگر بوت همین الان (doAuthCheck در page-client) auth/me را گرفته
      // است، این تایمر دیگر auth/me دومِ همیشگیِ هر رفرش را نمی‌زند (مهر زمانی
      // در خود store است — گارد تک‌نسخه‌ای).
      const bootCheckedAt = useAppStore.getState().bootAuthCheckedAt ?? 0;
      if (Date.now() - bootCheckedAt < 60_000) return;
      void refreshUserIfNeeded(!useAppStore.getState().user);
    }, 2500);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshUserIfNeeded(!useAppStore.getState().user);
      }
    };
    const onFocus = () => void refreshUserIfNeeded(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // ─── v156 — زنده‌شدن درجا بعد از قطعی شبکه (تیکت مالک: «باید اپ را ببندیم و باز کنیم») ───
  // وقتی موتور خودترمیمی اعلام می‌کند اتصال برگشته (سوییچ VPN/IP، خروج از ایرلاین،
  // برکت سوکت‌های مرده)، کل پنل «بدون هیچ رفرش یا بستن اپی» خودش را به‌روز می‌کند:
  // ۱) اطلاعات کاربر (گیت‌های پلن/کیف پول/اشتراک) force رفرش می‌شود
  // ۲) پالس فوری می‌زند (داشبورد/وضعیت برنامه/ناخوانده‌ها)
  // ۳) لیست اعلان‌ها دوباره گرفته می‌شود
  useEffect(() => {
    const onConnectionRestored = () => {
      void refreshUserIfNeeded(true);
      requestPulseNow();
      loadNotificationsRef.current?.();
    };
    window.addEventListener("fitup:connection-restored", onConnectionRestored);
    return () => {
      window.removeEventListener("fitup:connection-restored", onConnectionRestored);
    };
  }, []);

  // ─── v172 — زنده‌سازی پنل (سند real-time مالک) ───
  // ۱) سینگلتون SSE + فال‌بک پولینگ + لیسنرهای refresh-section (پل اپ اندروید)
  //    فقط برای کاربر لاگین‌شده؛ idempotent — فراخوانی تکراری کاری نمی‌کند.
  // ۲) رویداد «fitup:notifications-refresh» از مسیر رویدادهای SSE می‌آید →
  //    لیست اعلان‌ها در لحظه (بدون صبر برای پولینگ ۳۰ ثانیه‌ای).
  useEffect(() => {
    if (!user) return;
    startPanelRealtime();
    const onNotifRefresh = () => {
      loadNotificationsRef.current?.();
    };
    window.addEventListener("fitup:notifications-refresh", onNotifRefresh);
    return () => {
      window.removeEventListener("fitup:notifications-refresh", onNotifRefresh);
    };
  }, [user]);

  // ─── v15: قفل تب‌های نیازمند پلن برای کاربر بدون پلن فعال (درخواست مالک) ───
  // برنامه‌ها / تمرین‌ها / پیشرفت / چت با فیتاپ — برای کاربری که «هیچ پلن فعالی
  // ندارد» قفل می‌شوند. v137 (دیرکتیو مالک): تب «دستیار تغذیه» برای همه باز شد —
  // ثبت غذا و دیدن کالری رایگان است (API از قبل فقط requireAuth دارد)؛ برنامهٔ
  // غذایی/مکمل‌ها در خود تب طبق الگوی خرید پلن می‌مانند. استثناها: ادمین +
  // کاربر pending (خرید کرده و در جریان تکمیل پیش‌نیازهاست).
  const PLAN_LOCKED_TABS = new Set<MainTab>(["programs", "workouts", "progress", "chat"]);
  const planLocked =
    !!user &&
    user.role !== "ADMIN" &&
    !user.hasActiveSubscription &&
    !user.hasPendingSubscription &&
    PLAN_LOCKED_TABS.has(mainTab);

  // ─── v51 (قانون کافه‌بازار + درخواست مالک): تب «اپ موبایل» فقط در اپ بازار پنهان است ───
  // بازار آپدیت را خودش مدیریت می‌کند و تبلیغ/دانلود APK داخل اپ بازار تخلف است
  // (قبلاً برخورد گرفته بود). در اپ اختصاصی خودمان این تب «باید» بماند —
  // مالک: «مدال دانلود نسخه جدید اندروید و همچنین اپ موبایل در برنامه خودمون…
  // باید به آخرین نسخه و نسخه درست اشاره کنند». در مرورگر/PWA هم مثل قبل هست.
  const [navItems, setNavItems] = useState(NAV_ITEMS_ALL);
  useEffect(() => {
    try {
      if (isFitUpBazaarApp()) {
        setNavItems(NAV_ITEMS_ALL.filter((n) => n.id !== "mobileapp"));
      }
    } catch {}
  }, []);

  // گارد رندر: اگر به هر روشی (URL عمیق/نوتیف قدیمی) تب mobileapp داخل اپ بازار
  // فعال شود، به داشبورد برمی‌گردیم — بخش اپ موبایل در نسخه بازار اصلاً وجود ندارد.
  useEffect(() => {
    try {
      if (mainTab === "mobileapp" && isFitUpBazaarApp()) {
        setMainTab("dashboard");
      }
    } catch {}
  }, [mainTab, setMainTab]);

  // ─── Polling نوتیف‌ها ───
  // وقتی overlay اعلانات باز است، polling سریع‌تر (هر ۱۰ ثانیه) می‌شود تا
  // حس real-time به کاربر بدهد. در حالت عادی هر ۳۰ ثانیه poll می‌کنیم تا
  // بار روی سرور کم باشد. وقتی نوتیف جدید می‌آید، setNotifications صدا
  // زده می‌شود که unreadCount را هم در-store به‌روز می‌کند و badge بلافاصله
  // آپدیت می‌شود.
  useEffect(() => {
    let cancelled = false;
    // ─── نوتیف native در اپ کافه‌بازار ───
    // web-push داخل WebView کار نمی‌کند؛ به‌جای آن پل JS اپ اندروید
    // (window.FitUpNative.showNotification) نوتیف سیستم اندروید را نشان می‌دهد.
    // فقط وقتی تعداد ناخوانده «افزایش» یافته و baseline قبلی موجود است
    // (اولین poll بعد از باز شدن اپ اسپم نمی‌کند).
    //
    // ─── چت/نیکا در اپ‌های نیتیو اعلان سیستم ندارد ───
    // درخواست صریح مالک: نوتیف‌های «چت» (نوع coach = پیام‌های چت ربات/مربی و
    // نیکا) در اپ‌های نیتیو (بازار + اختصاصی) نباید به‌صورت اعلان اندروید
    // نمایش داده شوند — تجربه چت داخل خود اپ کافی است.
    const CHAT_NOTIFICATION_TYPES = new Set(["coach"]);
    const nativeNotify = (items: any[]) => {
      try {
        const native = (window as any).FitUpNative;
        if (!native?.showNotification) return;
        // ─── اپ‌های نیتیو (بازار + اختصاصی): اعلان‌های چت فیلتر می‌شوند ───
        // تجربهٔ چت داخل خود اپ کافی است؛ اعلان سیستم برای پیام‌های چت/نیکا
        // آزاردهنده است (درخواست صریح مالک برای بازار — برای اپ اختصاصی هم
        // همان سیاست). PWA/مرورگر دست‌نخورده.
        if (isFitUpBazaarApp() || isFitUpOwnApp()) {
          const newestNonChat = items.find(
            (n: any) => !n?.read && !CHAT_NOTIFICATION_TYPES.has(n?.type)
          );
          if (newestNonChat?.title) {
            native.showNotification(
              String(newestNonChat.title),
              String(newestNonChat.body || "")
            );
          }
          return;
        }
        const newest = items.find((n: any) => !n?.read);
        if (newest?.title) native.showNotification(String(newest.title), String(newest.body || ""));
      } catch {}
    };

    const loadNotifications = async () => {
      // همیشه poll می‌کنیم — حتی وقتی overlay باز است.
      // store یکپارچه است و overlay از همان state می‌خواند، بنابراین
      // به‌روزرسانی‌های real-time مستقیماً در overlay و badge نمایش داده می‌شود.
      // 🩹 v139.2 — بازیابی همگام از کش سشن (قبل از اولین await): لیست اعلان‌ها
      // در رفرش/back اپ «همان لحظه» هست؛ بدون لیست خالی تا رسیدن poll اول.
      // v153 — کش سشن با TTL ۱۰ دقیقه (دیرکتیو مالک «کش موبایل = کش دسکتاپ»):
      // در WebView چندروزه اعلان‌های چندروزه دیگر first-paint نمی‌شوند.
      if (!useAppStore.getState().notifications.length) {
        try {
          const rawCache = sessionStorage.getItem("fitup_notifications_cache_v1");
          if (rawCache) {
            const parsedCache = JSON.parse(rawCache) as { savedAt?: number; items?: unknown[] } | unknown[];
            const withMeta = parsedCache as { savedAt?: number; items?: unknown[] };
            const fresh = typeof withMeta.savedAt === "number" && Date.now() - withMeta.savedAt < 10 * 60 * 1000;
            const cachedItems = Array.isArray(withMeta.items) ? withMeta.items : null;
            if (fresh && cachedItems && cachedItems.length) {
              useAppStore.getState().setNotifications(cachedItems as any);
            }
          }
        } catch {}
      }
      try {
        // v156 — transport تاب‌آور (تایم‌اوت ۱۰s + یک تلاش تازه): این poll قبلاً
        // fetch خام بود — روی سوکت مردهٔ سوییچ VPN آویزان می‌شد، صفِ زامبی می‌ساخت
        // و استخر اتصال را پر می‌کرد (ریشهٔ «کل اینترنت قطع شد»). حالا حداکثر
        // ۲۰ ثانیه بعد یا جواب دارد یا خطا — و شکستش به موتور خودترمیمی گزارش می‌شود.
        const res = await fetchWithResilience(
          "/api/notifications",
          { cache: "no-store" },
          { timeoutMs: 10_000, retries: 1 }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          // فقط اگر داده واقعاً تغییر کرده باشد، state را آپدیت کن (جلوگیری از flicker)
          // مهم: مقایسه با آخرین state از store (getState) انجام می‌شود نه closure
          // effect — قبلاً آرایه notifications از closure کهنه خوانده می‌شد و
          // مقایسه همیشه با snapshot قدیمی بود (stale closure / flicker).
          const newJson = JSON.stringify(data.notifications || []);
          const oldJson = JSON.stringify(useAppStore.getState().notifications);
          if (newJson !== oldJson) {
            const prevItems = useAppStore.getState().notifications;
            const prevUnread = prevItems.filter((n: any) => !n?.read).length;
            const nextItems: any[] = data.notifications || [];
            const nextUnread = nextItems.filter((n: any) => !n?.read).length;
            useAppStore.getState().setNotifications(nextItems);
            // v139.2 — نگه‌داری در کش سشن برای رندر فوری رفرش بعدی (v153: با savedAt برای TTL ۱۰ دقیقه‌ای)
            try { sessionStorage.setItem("fitup_notifications_cache_v1", JSON.stringify({ savedAt: Date.now(), items: nextItems })); } catch {}
            // ─── نوتیف سیستم اندروید (فقط اپ کافه‌بازار) ───
            // فقط وقتی ناخوانده‌ها «افزایش» یافته‌اند و baseline قبلی موجود است
            // (آرایه قبلی غیرخالی) — تا اولین poll بعد از باز شدن اپ اسپم نکند.
            if (nextUnread > prevUnread && prevItems.length > 0) {
              nativeNotify(nextItems);
            }
          }
        }
      } catch {}
    };
    // Task 3-a: مرجع واکشی برای واکنش فوری به افزایش unread از مسیر پالس
    loadNotificationsRef.current = loadNotifications;
    loadNotifications();
    // Polling تطبیقی: وقتی overlay اعلانات باز است، هر ۱۰ ثانیه؛ در غیر این
    // صورت هر ۳۰ ثانیه. فقط یک interval فعال است (نه دو interval همزمان).
    // (پالس ۳ ثانیه‌ای unread را می‌سنجد و فقط روی «افزایش» اینجا را صدا می‌زند؛
    //  این polling عمداً به‌عنوان پشتیبان باقی مانده — بی‌ضرر و ارزان.)
    const pollInterval = overlay === "notifications" ? 10000 : 30000;
    const interval = setInterval(loadNotifications, pollInterval);
    // وقتی کاربر به تب برمی‌گردد (بعد از tab switch یا minimize)، یک poll اجرا
    // می‌کنیم تا badge همیشه به‌روز باشد — v156: با ۱.۲ ثانیه تأخیر عمدی تا
    // طوفان fetchهای لحظهٔ رزوم (ریشهٔ «۳-۴ ثانیه دکمه‌ها کار نمی‌کند») پخش شود.
    let resumePollTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        if (resumePollTimer) clearTimeout(resumePollTimer);
        resumePollTimer = setTimeout(() => {
          resumePollTimer = null;
          loadNotifications();
        }, 1200);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    // ─── Real-time push listener ───
    // وقتی service worker یک push notification دریافت می‌کند (حتی اگر اپ باز
    // باشد)، یک پیام 'PUSH_RECEIVED' به صفحه ارسال می‌کند. این listener آن
    // پیام را می‌گیرد و فوراً نوتیف‌ها را از سرور refresh می‌کند — بدون
    // منتظر ماندن برای polling بعدی.
    const onControllerMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED" && !cancelled) {
        loadNotifications();
      }
    };
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", onControllerMessage);
    }
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (resumePollTimer) clearTimeout(resumePollTimer);
      loadNotificationsRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onControllerMessage);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // با باز شدن هر overlay یک history entry push می‌کنیم تا back آن را ببندد
  // (listener سطح module بالا در popstate آن را می‌بندد)
  useEffect(() => {
    if (overlay) {
      try {
        window.history.pushState({ fitupOverlay: true }, "", window.location.href);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // ─── FE-M9: sync تب فعلی در URL ───
  // با تغییر تب، URL با replaceState به‌روز می‌شود تا refresh/share تب را
  // نگه دارد. پارامترها با page-client هماهنگ‌اند: ?screen=panel&tab=X
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (useAppStore.getState().screen !== "main") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("screen", "panel");
      url.searchParams.set("tab", mainTab);
      window.history.replaceState(null, "", url.toString());
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  // ─── اسکرول به ابتدای صفحه با هر تغییر تب (درخواست مالک) ───
  // قبلاً فقط «screen» عوض می‌شد اسکرول بالا می‌رفت؛ تغییر تب داخل پنل
  // (مثلاً وسط داشبورد → دستیار تغذیه) صفحه را از همان وسط باز می‌کرد.
  // ⚠️ behavior باید «instant» باشد نه «auto»: چون html دارای
  // scroll-behavior:smooth است، behavior:"auto" به اسکرولِ انیمیشنی تبدیل
  // می‌شود — و انیمیشنِ smooth در موبایل/WebView با تغییر layout (خروج تب
  // قبلی + ورود تب جدید در AnimatePresence) وسط راه «لغو» می‌شود و صفحه
  // از وسط باز می‌ماند (باگ گزارش‌شده مالک برای دستیار تغذیه).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    // بعد از mount کامل تب جدید (پایان انیمیشن خروج ۱۵۰ms) دوباره مطمئن شویم
    const t = setTimeout(() => window.scrollTo(0, 0), 200);
    return () => clearTimeout(t);
  }, [mainTab]);

  // ─── FE-H7: بازیابی جلسه تمرین فعال بعد از refresh (<۲۴ ساعت) ───
  useEffect(() => {
    restoreActiveSession();
  }, []);

  // ─── ضد فلیکر رفرش: بازیابی پلن کش‌شده بلافاصله بعد از شناختن کاربر ───
  // در mount، user هنوز null است (پاسخ /api/auth/me نرسیده)؛ به‌محض رسیدن
  // userId، پلن کش‌شده (TTL ۲۴ ساعت) در store بازیابی می‌شود تا اولین رندرِ
  // داشبورد پلن را ببیند و از حالت «بی‌پلن» به «پلن فعال» فلیکر نکند.
  // (کش فقط وقتی بازیابی می‌شود که userId ذخیره‌شده با کاربر جاری یکی باشد)
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId) restorePlanCache(userId);
  }, [userId]);

  return (
    <div className="min-h-screen bg-white flex">
      {/* Desktop Sidebar */}
      <Sidebar navItems={navItems} />

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 lg:mr-72 bg-white">
        <TopBar />
        {/* تور راهنمای ورود اول — فقط بار اول (فلگ fitup_tour_seen_v1) و فقط
            وقتی این کامپوننت سوار است یعنی کاربر در پنل (screen=main) است؛
            اجرای دوباره از مرکز راهنما با رویداد fitup:replay-tour انجام می‌شود */}
        <PanelTour />

        <main className={`flex-1 overflow-hidden ${mainTab === "chat" ? "" : "pb-8"}`}>
          {/* ─── v48 فیکس لگ جابجایی تمرین‌ها (شکایت مکرر مالک) ───
              حین جلسهٔ تمرین (all-screen overlay)، محتوای تب زیرین مونت نمی‌شود.
              با پایان جلسه محتوا فوری برمی‌گردد (کش پلن ضد فلیکر). */}
          {/* ─── v135 — ریشه‌کنی فلیکر ناوبری (دیرکتیو مالک) ───
              قبلاً AnimatePresence mode="wait" با خروج+ورود (۰.۱۵×۲ ثانیه) بین
              هر دو تب «فلش سفید/خالی» می‌ساخت — همین جریان اصلی حس «لگ و فلیکر»
              در جابجایی منوها و بک‌زدن به داشبورد بود. حالا: تعویض تب = رندر
              مستقیم تب جدید با یک فید ۱۶۰ms فقط روی mount (بدون فاز خروج و
              بدون شکاف رندر) — ناوبری حس لحظه‌ای دارد. */}
          {!hasActiveSession && (
          <div key={mainTab} className="h-full animate-tab-in">
              {/* v15: کاربر بدون پلن فعال → ویوی قفل برای تب‌های پلن‌دار */}
              {planLocked ? (
                <ViewErrorBoundary viewName="قفل پلن" resetKey={mainTab}>
                  <PlanLockedView tab={mainTab} />
                </ViewErrorBoundary>
              ) : (
              <>
              {mainTab === "dashboard" && (
                <ViewErrorBoundary viewName="داشبورد" resetKey={mainTab}>
                  <DashboardView />
                </ViewErrorBoundary>
              )}
              {mainTab === "programs" && (
                <ViewErrorBoundary viewName="برنامه‌ها" resetKey={mainTab}>
                  <ProgramsView />
                </ViewErrorBoundary>
              )}
              {mainTab === "workouts" && (
                <ViewErrorBoundary viewName="تمرین‌ها" resetKey={mainTab}>
                  <WorkoutsView />
                </ViewErrorBoundary>
              )}
              {mainTab === "nutrition" && (
                <ViewErrorBoundary viewName="تغذیه" resetKey={mainTab}>
                  <NutritionView />
                </ViewErrorBoundary>
              )}
              {mainTab === "progress" && (
                <ViewErrorBoundary viewName="پیشرفت" resetKey={mainTab}>
                  <ProgressView />
                </ViewErrorBoundary>
              )}
              {mainTab === "chat" && (
                <ViewErrorBoundary viewName="چت با مربی" resetKey={mainTab}>
                  <ChatView />
                </ViewErrorBoundary>
              )}
              {mainTab === "referral" && (
                <ViewErrorBoundary viewName="معرفی دوستان" resetKey={mainTab}>
                  <ReferralView />
                </ViewErrorBoundary>
              )}
              {mainTab === "support" && (
                <ViewErrorBoundary viewName="پشتیبانی" resetKey={mainTab}>
                  <SupportView />
                </ViewErrorBoundary>
              )}
              {mainTab === "mobileapp" && (
                <ViewErrorBoundary viewName="اپلیکیشن" resetKey={mainTab}>
                  <MobileAppView />
                </ViewErrorBoundary>
              )}
              {mainTab === "plans" && (
                <ViewErrorBoundary viewName="اشتراک و پلن‌ها" resetKey={mainTab}>
                  <PlansView />
                </ViewErrorBoundary>
              )}
              {/* v139 — بانک‌های ایزولهٔ داخل پنل (رایگان برای همه حتی بدون پلن) */}
              {mainTab === "exercise-bank" && (
                <ViewErrorBoundary viewName="بانک حرکات" resetKey={mainTab}>
                  <ExerciseBankTab />
                </ViewErrorBoundary>
              )}
              {mainTab === "food-bank" && (
                <ViewErrorBoundary viewName="بانک غذاها" resetKey={mainTab}>
                  <FoodBankTab />
                </ViewErrorBoundary>
              )}
              {/* v143 (دیرکتیو مالک) — مسیریاب داخل پنل؛ رایگان برای همه */}
              {mainTab === "activity" && (
                <ViewErrorBoundary viewName="پیاده‌روی و دویدن" resetKey={mainTab}>
                  <ActivityTab />
                </ViewErrorBoundary>
              )}
              </>
              )}
          </div>
          )}
        </main>
      </div>

      {/* Active workout session overlay (full-screen) — با Error Boundary تا کرش رندر، کل اپ را سفید نکند */}
      <AnimatePresence>
        {hasActiveSession && (
          <ViewErrorBoundary viewName="جلسه تمرین">
            <ActiveWorkoutSession />
          </ViewErrorBoundary>
        )}
      </AnimatePresence>

      {/* Sheet overlays */}
      <Sheet open={overlay === "notifications"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[85vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">اعلان‌ها</SheetTitle>
          <NotificationsOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "profile"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">پروفایل</SheetTitle>
          <ProfileOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "subscription"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">ارتقای اشتراک</SheetTitle>
          <SubscriptionOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "admin"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[95vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">پنل مدیریت</SheetTitle>
          <AdminOverlay />
        </SheetContent>
      </Sheet>
      <Sheet open={overlay === "exerciseDetail"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[85vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">جزئیات حرکت</SheetTitle>
          <ExerciseDetailOverlay />
        </SheetContent>
      </Sheet>
      {/* v139 — جزئیات حرکت از «بانک حرکات داخل پنل» — ویدیو برای همه آزاد */}
      <Sheet open={overlay === "exerciseBankDetail"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[85vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">جزئیات حرکت — بانک حرکات</SheetTitle>
          <BankExerciseDetailPanel />
        </SheetContent>
      </Sheet>
      {/* v118 — گارد «بستن دو مرحله‌ای»: اگر مدال توضیحات حرکت (فرزند همین Sheet در GymModeView)
          همین الان بسته شده، این dismissِ تأخیریِ لمسی نادیده می‌ماند تا حالت باشگاه باز بماند */}
      <Sheet open={overlay === "gymMode"} onOpenChange={(o) => { if (!o && !wasExerciseModalJustClosed()) setOverlay(null); }}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[95vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">حالت باشگاه</SheetTitle>
          <GymModeView />
        </SheetContent>
      </Sheet>
      {/* ─── آنالیز ویدیویی/آزمایش خون: Dialog وسط‌چین (v15 — درخواست مالک) ───
          قبلاً Sheet پایین‌چین بود و به پایین صفحه می‌چسبید.
          🩹 v44 — فیکس «مودال اسکرول نمیشه»: DialogContent پایه grid است و
          ردیفِ auto با محتوا رشد می‌کند؛ h-full فرزند بی‌اثر می‌شود و انتهای
          محتوا زیر overflow-hidden گم می‌شد (تست واقعی: ۴۱۰px از ۱۱۵۳px
          قابل‌دیدن نبود). ردیف را دقیقاً به ارتفاع
          مودال قفل می‌کند تا اسکرول داخلی (flex-1 overflow-y-auto) کار کند. */}
      <Dialog open={overlay === "videoAnalysis"} onOpenChange={(o) => !o && setOverlay(null)}>
        <DialogContent
          showCloseButton={false}
          dir="rtl"
          style={{ gridTemplateRows: "minmax(0px, 1fr)" }}
          className="max-w-2xl h-[88vh] p-0 gap-0 overflow-hidden rounded-2xl sm:rounded-3xl [&>*]:min-w-0"
        >
          <DialogTitle className="sr-only">آنالیز ویدیویی</DialogTitle>
          <VideoAnalysisView />
        </DialogContent>
      </Dialog>
      <Dialog open={overlay === "bloodTest"} onOpenChange={(o) => !o && setOverlay(null)}>
        <DialogContent
          showCloseButton={false}
          dir="rtl"
          style={{ gridTemplateRows: "minmax(0px, 1fr)" }}
          className="max-w-2xl h-[88vh] p-0 gap-0 overflow-hidden rounded-2xl sm:rounded-3xl [&>*]:min-w-0"
        >
          <DialogTitle className="sr-only">تست خون</DialogTitle>
          <BloodTestView />
        </DialogContent>
      </Dialog>
      <Sheet open={overlay === "survey"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[90vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">نظرسنجی پایان پلن</SheetTitle>
          <SurveyOverlay />
        </SheetContent>
      </Sheet>
      {/* ─── تجربه تمدید اشتراک — صفحه اختصاصی زیبا برای نگه‌داشتن کاربر ─── */}
      <Sheet open={overlay === "renewal"} onOpenChange={(o) => !o && setOverlay(null)}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[92vh] p-0" dir="rtl">
          <SheetTitle className="sr-only">تمدید اشتراک</SheetTitle>
          <RenewalOverlay />
        </SheetContent>
      </Sheet>
    </div>
  );
}
