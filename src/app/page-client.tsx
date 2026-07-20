"use client";

import { useEffect, useState, useRef } from "react";
import { useAppStore } from "@/lib/fitness/store";
import { AuthScreen } from "@/components/fitness/auth-screen";
import { OnboardingScreen } from "@/components/fitness/onboarding-screen";
import { MainApp } from "@/components/fitness/main-app";
import { SplashLoader } from "@/components/fitness/splash-loader";
import { LandingPage } from "@/components/fitness/landing/landing-page";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { getScreenFromUrl } from "@/lib/fitness/navigation";
import { TdeeCalculator } from "@/components/fitness/tools/tdee-calculator";
import { ExercisesDatabase } from "@/components/fitness/tools/exercises-database";
import { FoodCalorieIndex } from "@/components/fitness/tools/food-calorie-index";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { TermsPage } from "@/components/fitness/terms-page";
import { ContactPage } from "@/components/fitness/contact-page";
import { PaymentVerifyHandler } from "@/components/fitness/payment-verify-handler";
import { AnalysisScreen } from "@/components/fitness/analysis-screen";
import { AdminOverlay } from "@/components/fitness/views/admin-overlay";
import { ArticlesPage } from "@/components/fitness/articles/articles-page";
import { ArticlePage } from "@/components/fitness/articles/article-page";
import { ExerciseDetailPage } from "@/components/fitness/tools/exercise-detail-page";
import { FoodDetailPage } from "@/components/fitness/tools/food-detail-page";
import { ReferralLanding } from "@/components/fitness/landing/referral-landing";

// ─── تایتل‌های پویا برای هر صفحه ───
const PAGE_TITLES: Record<string, string> = {
  landing: "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه",
  auth: "ورود به فیتاپ | ثبت‌نام با شماره موبایل",
  onboarding: "تکمیل اطلاعات | فیتاپ",
  main: "پنل ورزشکار | فیتاپ",
  admin: "پنل مدیریت | فیتاپ",
  loading: "فیتاپ",
  "referral-landing": "دعوت دوستان | فیتاپ",
  articles: "مقالات بدنسازی و تناسب اندام | فیتاپ",
  article: "مقاله | فیتاپ",
  "tool-tdee": "محاسبه‌گر کالری روزانه TDEE | فیتاپ",
  "tool-exercises": "بانک حرکات بدنسازی | فیتاپ",
  "exercise-detail": "آموزش حرکت | فیتاپ",
  "tool-foods": "جدول کالری غذاها | فیتاپ",
  "food-detail": "کالری غذا | فیتاپ",
  terms: "قوانین و مقررات | فیتاپ",
  contact: "تماس با ما | فیتاپ",
};

export default function HomeClient() {
  const { screen, setScreen, setUser, setArticleSlug, setExerciseId, setFoodId, setMainTab, setTermsUpdateRequired } = useAppStore();

  // ─── مقادیر اولیه از URL (فقط هنگام mount) ───
  const [paymentVerify] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("payment_verify") === "1";
  });
  const [refCode] = useState(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("ref");
    return raw ? raw.trim().toUpperCase() : null;
  });

  // ═══════════════════════════════════════════════════════════════
  //  منطق اصلی: URL → screen
  //  اصل: URL همیشه منبع حقیقت است. هیچ state پیچیده‌ای نیست.
  // ═══════════════════════════════════════════════════════════════

  // ─── تابع اعمال screen از URL ───
  // این تابع در mount و popstate صدا زده می‌شود
  const applyUrlToScreen = async () => {
    if (typeof window === "undefined") return;

    // ذخیره کد معرفی
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      try { window.localStorage.setItem("fitap_referral_code", ref.trim().toUpperCase()); } catch {}
    }

    // tab از URL
    const tab = params.get("tab");
    if (tab) {
      const validTabs = ["dashboard", "programs", "nutrition", "progress", "chat", "plans", "referral", "support", "mobileapp"];
      if (validTabs.includes(tab)) setMainTab(tab as any);
    }

    const urlScreen = getScreenFromUrl();
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
    const forceLanding = params.get("view") === "landing";

    // ─── ۱. صفحات عمومی (مقالات، ابزارها، جزئیات) ───
    // این صفحات همیشه از URL خوانده می‌شوند — مهم نیست کاربر لاگین است یا نه
    if (urlScreen.screen === "article" && urlScreen.articleSlug) {
      setArticleSlug(urlScreen.articleSlug);
      setScreen("article");
      // auth check در background
      fetchAuthInBackground();
      return;
    }
    if (urlScreen.screen === "articles") {
      setScreen("articles");
      fetchAuthInBackground();
      return;
    }
    if (urlScreen.screen?.startsWith("tool-")) {
      setScreen(urlScreen.screen as any);
      fetchAuthInBackground();
      return;
    }
    if (urlScreen.screen === "exercise-detail" && urlScreen.exerciseId) {
      setExerciseId(urlScreen.exerciseId);
      setScreen("exercise-detail");
      fetchAuthInBackground();
      return;
    }
    if (urlScreen.screen === "food-detail" && urlScreen.foodId) {
      setFoodId(urlScreen.foodId);
      setScreen("food-detail");
      fetchAuthInBackground();
      return;
    }
    if (urlScreen.screen === "terms") {
      setScreen("terms");
      fetchAuthInBackground();
      return;
    }
    if (urlScreen.screen === "contact") {
      setScreen("contact");
      fetchAuthInBackground();
      return;
    }

    // ─── ۲. صفحات احتیاج به auth check ───
    // ?screen=panel → auth check → panel یا auth
    // ?screen=auth → auth check → panel یا auth
    // URL خالی → landing (مرورگر) یا auth check (PWA)
    const wantsPanel = urlScreen.screen === "main"; // ?screen=panel → getScreenFromUrl returns "main"
    const wantsAuth = urlScreen.screen === "auth";

    // در مرورگر معمولی:
    // - URL خالی → همیشه landing (حتی اگر لاگین است)
    // - ?screen=panel یا ?screen=auth → auth check
    // - ?view=landing → همیشه landing
    // - ادمین همیشه → پنل مدیریت
    if (!isStandalone || forceLanding) {
      if (!wantsPanel && !wantsAuth) {
        // URL خالی → landing
        showLanding();
        // auth check در background برای نمایش نام کاربر
        fetchAuthInBackground();
        return;
      }
      // ?screen=panel یا ?screen=auth → auth check
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

    async function fetchAuthInBackground() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.user) setUser(data.user);
        if (data?.termsUpdateRequired) setTermsUpdateRequired(true);
      } catch {}
    }

    async function doAuthCheck(fallbackToAuth: boolean) {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (data?.termsUpdateRequired) setTermsUpdateRequired(true);
        if (data?.user) {
          setUser(data.user);
          if (data.user.role === "ADMIN") {
            setScreen("admin");
          } else {
            setScreen(data.user.onboardingDone ? "main" : "onboarding");
          }
        } else {
          // کاربر لاگین نیست
          if (isStandalone && !forceLanding) {
            setScreen("auth");
          } else if (fallbackToAuth) {
            setScreen("auth");
          } else {
            showLanding();
          }
        }
      } catch {
        // timeout یا خطا
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
    applyUrlToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── popstate: ساده! فقط URL را دوباره بخوان ───
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const store = useAppStore.getState();
      const currentScreen = store.screen;

      // ─── در پنل ورزشکار: tab غیر dashboard → dashboard ───
      if (currentScreen === "main") {
        const currentTab = store.mainTab;
        if (currentTab && currentTab !== "dashboard") {
          store.setMainTab("dashboard");
          window.history.pushState(null, "", window.location.href);
          return;
        }
        // در dashboard
        const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
        if (isStandalone) {
          if (confirm("آیا از برنامه فیتاپ خارج می‌شوید؟")) {
            window.history.back();
          } else {
            window.history.pushState(null, "", window.location.href);
          }
        } else {
          // مرورگر معمولی: به landing برگرد
          store.setScreen("landing");
        }
        return;
      }

      // ─── ادمین: در PWA اعلان خروج ───
      if (currentScreen === "admin") {
        const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
        if (isStandalone) {
          if (confirm("آیا از برنامه فیتاپ خارج می‌شوید؟")) {
            window.history.back();
          } else {
            window.history.pushState(null, "", window.location.href);
          }
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
    if (screen !== "loading" && screen !== prevScreenRef.current && screen !== "landing") {
      window.scrollTo(0, 0);
    }
    prevScreenRef.current = screen;
  }, [screen]);

  // ═══════════════════════════════════════════════════════════════
  //  رندر صفحه بر اساس screen
  // ═══════════════════════════════════════════════════════════════

  if (paymentVerify) return <PaymentVerifyHandler />;
  if (screen === "loading") return <SplashLoader />;
  if (screen === "referral-landing" && refCode) return <ReferralLanding refCode={refCode} />;
  if (screen === "landing") return (
    <>
      <LandingPage />
      <NikaWidget />
    </>
  );
  if (screen === "auth") return (
    <>
      <AuthScreen />
      <NikaWidget />
    </>
  );
  if (screen === "onboarding") return (
    <>
      <OnboardingScreen />
      <NikaWidget />
    </>
  );
  if (screen === "analysis") return <AnalysisScreen />;
  if (screen === "admin") {
    return (
      <div className="fixed inset-0 bg-white">
        <AdminOverlay standalone />
      </div>
    );
  }
  if (screen === "tool-tdee" || screen === "tool-exercises" || screen === "tool-foods") {
    return (
      <>
        <ToolsNav />
        {screen === "tool-tdee" && <TdeeCalculator />}
        {screen === "tool-exercises" && <ExercisesDatabase />}
        {screen === "tool-foods" && <FoodCalorieIndex />}
        <NikaWidget />
      </>
    );
  }
  if (screen === "terms") return (
    <>
      <TermsPage />
      <NikaWidget />
    </>
  );
  if (screen === "contact") return (
    <>
      <ContactPage />
      <NikaWidget />
    </>
  );
  if (screen === "articles") return <ArticlesPage />;
  if (screen === "article") return <ArticlePage />;
  if (screen === "exercise-detail") return <ExerciseDetailPage />;
  if (screen === "food-detail") return <FoodDetailPage />;
  return <MainApp />;
}
