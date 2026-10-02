"use client";

/**
 * v170 — گرم‌کردن چانک‌های سنگین پنل در idle (دیرکتیو مالک: «کاربر باید حس کند
 * با یک اپ سنگینِ کاملاً نصب‌شده کار می‌کند»).
 *
 * مشکل: MainApp/Onboarding/Dashboard چانک‌های dynamic هستند؛ اولین ورود به پنل
 * = دانلود چانک در همان لحظه → SplashLoader/اسکلت (حس «پریلودر بعدش خودش میاد»).
 * راه‌حل: بعد از paint اول (landing/auth آنبوردینگ)، در idle مرورگر چانک‌های
 * بعدی را بی‌صدا preload می‌کنیم — سوییچ بعدی فوری است، مثل اپ نصب‌شده.
 *
 * ایمن: requestIdleCallback (fallback setTimeout) + یک‌بار در هر سشن.
 */

let warmed = false;

const WARM_IMPORTS: Array<() => Promise<unknown>> = [
  // چانک پنل (MainApp — بزرگ‌ترین سوییچ رایج بعد از ورود)
  () => import("@/components/fitness/main-app"),
  // چانک آنبوردینگ (کاربران جدید/ناقص)
  () => import("@/components/fitness/onboarding-screen"),
  // چانک داشبورد (تب اول پنل — شامل view skeleton؛ بدون recharts که جدا شده)
  () => import("@/components/fitness/views/dashboard-view"),
  // ─── v171 — بقیهٔ چانک‌های سنگین پنل: اولین باز شدن هر تب/مودال هم باید
  // مثل اپ نصب‌شده فوری باشد (بدون ViewSkeleton). پشت‌سرهم با فاصله در idle.
  () => import("@/components/fitness/views/progress-view"),
  () => import("@/components/fitness/views/chat-view"),
  () => import("@/components/fitness/views/exercise-bank-tab"),
  () => import("@/components/fitness/views/food-bank-tab"),
  () => import("@/components/fitness/views/activity-tab"),
  () => import("@/components/fitness/views/exercise-detail-overlay"),
  () => import("@/components/fitness/views/gym-mode-view"),
  () => import("@/components/fitness/views/renewal-overlay"),
];

export function warmupPanelChunks(): void {
  if (typeof window === "undefined") return;
  if (warmed) return;
  warmed = true;

  const runAll = () => {
    // پشت‌سرهم با فاصله — هیچ‌وقت با داده‌های بحرانی شبکه رقابت نکن
    WARM_IMPORTS.forEach((imp, i) => {
      setTimeout(() => {
        imp().catch(() => {
          // شکست warm-up بی‌اهمیت است — چانک در نیاز واقعی لود می‌شود
        });
      }, i * 350);
    });
  };

  const idle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") {
    idle(runAll, { timeout: 4000 });
  } else {
    setTimeout(runAll, 1200);
  }
}
