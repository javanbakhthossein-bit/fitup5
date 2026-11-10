"use client";

import { isFitUpNativeApp } from "./app-bridge";

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
 *
 * v220 — گیتِ لندینگ (گزارش جانک اسکرول): قبلاً گرم‌کردن از لحظهٔ idleِ اول
 * (تا ۴ ثانیه) شروع می‌شد؛ یعنی دانلود+parse+eval ۱۳ چانک سنگین دقیقاً وسط
 * اسکرول اولیهٔ کاربر روی لندینگ اتفاق می‌افتاد → پرش فریم و لگ اسکرول.
 * حالا دو حالت داریم:
 *   • عادی (کاربر در پنل است): مثل قبل، فوری در idle.
 *   • deferUntilInteractive (لندینگ/احراز هویت): فقط بعد از اولین اینتنت واقعی
 *     کاربر (کلیک/لمس/کیبورد) یا آرام‌گرفتن اسکرول (۲.۵ ثانیه بی‌اسکرول) یا
 *     حداکثر ۲۰ ثانیه — هرکدام زودتر رخ داد. اسکرول اولیه هیچ‌وقت رقیب ندارد.
 */

let warmed = false;

/** v229 — تفکیک موج گرم‌کردن: ۳ چانک حیاتی (هستهٔ ورود به پنل) در برابر ۹ چانک
 *  باقی‌مانده. در محیط اپ (WebView) موج کامل ۱۲تایی با فاصلهٔ ۳۵۰ms دقیقاً روی
 *  اولین رندر داشبورد می‌افتاد → جانک روی گوشی ضعیف (دیرکتیو مالک: «برنامه هنگ
 *  می‌کنه»). حالا در اپ: هسته با فاصلهٔ ۹۰۰ms، بقیه ۱۰ ثانیه بعد با فاصلهٔ ۱۵۰۰ms.
 *  وب: رفتار قبلی عیناً حفظ می‌شود. */
const WARM_IMPORTS_CORE: Array<() => Promise<unknown>> = [
  // چانک پنل (MainApp — بزرگ‌ترین سوییچ رایج بعد از ورود)
  () => import("@/components/fitness/main-app"),
  // چانک آنبوردینگ (کاربران جدید/ناقص)
  () => import("@/components/fitness/onboarding-screen"),
  // چانک داشبورد (تب اول پنل — شامل view skeleton؛ بدون recharts که جدا شده)
  () => import("@/components/fitness/views/dashboard-view"),
];

const WARM_IMPORTS_LATER: Array<() => Promise<unknown>> = [
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
  // تسک 4-a — چانک اورلی پروفایل: بعد از dynamic شدن در main-app چانک مستقل شد —
  // گرم کردنش یعنی اولین باز شدن «پروفایل» هم مثل اپ نصب‌شده فوری است
  () => import("@/components/fitness/views/profile-overlay"),
];

function scheduleWarm() {
  const inApp = (() => {
    try {
      return isFitUpNativeApp();
    } catch {
      return false;
    }
  })();
  const runAll = () => {
    // پشت‌سرهم با فاصله — هیچ‌وقت با داده‌های بحرانی شبکه رقابت نکن
    const fire = (imp: () => Promise<unknown>) => {
      imp().catch(() => {
        // شکست warm-up بی‌اهمیت است — چانک در نیاز واقعی لود می‌شود
      });
    };
    if (inApp) {
      // v229 — محیط اپ: هسته اول (فاصلهٔ ۹۰۰ms)، بقیه بعد از ۱۰ ثانیه (فاصلهٔ ۱۵۰۰ms)
      WARM_IMPORTS_CORE.forEach((imp, i) => setTimeout(() => fire(imp), i * 900));
      WARM_IMPORTS_LATER.forEach((imp, i) => setTimeout(() => fire(imp), 10_000 + i * 1500));
    } else {
      [...WARM_IMPORTS_CORE, ...WARM_IMPORTS_LATER].forEach((imp, i) =>
        setTimeout(() => fire(imp), i * 350)
      );
    }
  };

  const idle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") {
    idle(runAll, { timeout: 4000 });
  } else {
    setTimeout(runAll, 1200);
  }
}

export function warmupPanelChunks(options?: { deferUntilInteractive?: boolean }): void {
  if (typeof window === "undefined") return;
  if (warmed) return;

  // ── حالت عادی (کاربر داخل پنل است) — رفتار v170 ──
  if (!options?.deferUntilInteractive) {
    warmed = true;
    scheduleWarm();
    return;
  }

  // ── حالت تعویق‌شده (لندینگ/احراز هویت) — v220 ──
  const kick = () => {
    if (warmed) return;
    warmed = true;
    cleanup();
    scheduleWarm();
  };

  const interactiveEvents: Array<[EventTarget, string]> = [
    [window, "pointerdown"],
    [window, "touchstart"],
    [window, "keydown"],
  ];

  let scrollTimer: number | undefined;
  let fallbackTimer: number | undefined;
  const onScroll = () => {
    // اسکرول آرام گرفت (۲.۵ ثانیه بی‌اسکرول) → گرم‌کردن آزاد است
    if (scrollTimer) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(kick, 2500);
  };
  const cleanup = () => {
    for (const [t, name] of interactiveEvents) t.removeEventListener(name, kick);
    window.removeEventListener("scroll", onScroll);
    if (scrollTimer) window.clearTimeout(scrollTimer);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
  };

  for (const [t, name] of interactiveEvents) {
    t.addEventListener(name, kick, { passive: true, once: true });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  fallbackTimer = window.setTimeout(kick, 20000);
}
