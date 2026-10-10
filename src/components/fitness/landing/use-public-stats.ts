"use client";

import { useSyncExternalStore } from "react";

/**
 * usePublicStats — هوک سبک اثبات اجتماعی (Task 5-b)
 *
 * تعداد واقعی کاربران ثبت‌نام‌شده (و پلن‌های فروخته‌شده و نصب‌های اپ) را از
 * /api/stats/public می‌گیرد. کش ماژول‌سطح دارد، پس اگر چند کامپوننت هم‌زمان
 * (TrustBar، HeroSection، PricingSection، ToolsSection) از آن استفاده کنند،
 * فقط «یک» درخواست در هر ۵ دقیقه زده می‌شود.
 *
 * v204 — دیرکتیو مالک: «با اینترنت کند کاربر فکر می‌کند آمار صفر است — عدد
 * واقعی باید از همان اول نوشته شده باشد». دو تغییر:
 *   ۱) seedPublicStats(initial): صفحهٔ اصلی (SSR) آمار را سمت سرور می‌خواند و
 *      قبل از اولین رندر تزریق می‌کند → عدد واقعی داخل HTML اولیه است (بدون
 *      صفرِ اولیه، بدون انیمیشن شمارش، بدون mismatch هیدریشن).
 *   ۲) فیلد appInstalls — مجموع نصب اپ موبایل (اختصاصی + بازار + وب‌اپ).
 *
 * دیگر هیچ CountUp/انیمیشنی وجود ندارد — همه‌جا رشتهٔ آمادهٔ فارسی مستقیم.
 */

export interface PublicStats {
  users: number;
  plansSold: number;
  /** v94 — تعداد کل حرکات کتابخانه (دیرکتیو مالک: شمارندهٔ صفحهٔ اصلی باید پویا باشد) */
  exercises: number;
  /** Task 7-d — تعداد کل غذاهای بانک غذا (شمارندهٔ «غذای سالم» لندینگ) */
  foods: number;
  /** v204 — مجموع نصب اپ موبایل: اپ اختصاصی + اپ کافه‌بازار + وب‌اپ (PWA) */
  appInstalls: number;
  /** آمادهٔ نمایش با رقم فارسی و «+» — مثال: «۲٬۵۰۰+» */
  usersFa: string;
  plansSoldFa: string;
  exercisesFa: string;
  foodsFa: string;
  /** v204 — مثال: «۱۲٬۳۴۵» (بدون + — زیرش «نصب اپ» نوشته می‌شود) */
  appInstallsFa: string;
}

/** فال‌بک صفر — فقط اگر SSR هم نتوانست آمار بخواند (خطای دیتابیس) */
const FALLBACK: PublicStats = {
  users: 0,
  plansSold: 0,
  exercises: 0,
  foods: 0,
  appInstalls: 0,
  usersFa: "۰+",
  plansSoldFa: "۰",
  exercisesFa: "۰+",
  foodsFa: "۰+",
  appInstallsFa: "۰",
};

const REFRESH_TTL_MS = 5 * 60 * 1000;

let snapshot: PublicStats = FALLBACK;
let fetching: Promise<void> | null = null;
let lastFetchedAt = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// v204 — تایپ seed آمار سرور (همان شکل داده‌ای که SSR می‌خواند)
export type PublicStatsSeed = {
  users: number;
  plansSold: number;
  exercises: number;
  foods: number;
  appInstalls: number;
};

/**
 * v204 — تزریق آمار سرور (SSR) به store ماژول‌سطح، قبل از اولین رندر.
 * هم در سرور (رندر RSC) و هم در کلاینت (هیدریشن با همان props) صدا زده
 * می‌شود → رندر اول هر دو «عدد واقعی» است — بدون mismatch و بدون صفر.
 *
 * ─── v207 — فیکس ریشه‌ای «Minified React error #418 (متن)» روی صفحه اصلی ───
 * قبلاً «فقط بار اول» seed می‌شد (snapshot !== FALLback → return). در سرورِ
 * طولانی‌عمر یعنی snapshot ماژول با دادهٔ «اولین درخواست بعد از ری‌استارت»
 * تا ابد منجمد می‌ماند (هیچ چیز دیگر آن را به‌روز نمی‌کند)، در حالی که prop
 * initialStats هر درخواست تازه است (کش ۱۰ دقیقه‌ای getPublicStatsData).
 * با اولین تغییر آمار (ثبت‌نام/نصب جدید)، HTML سمت سرور عدد «کهنه» و اولین
 * رندر کلاینت عدد «تازه» را می‌ساخت → mismatch هیدریشن → #418.
 *
 * رفتار جدید:
 *   • سرور (window undefined): هر رندر با دادهٔ «همان درخواست» بازنویسی
 *     می‌شود → HTML همیشه دقیقاً == prop همان درخواست.
 *   • کلاینت: فقط قبل از هیدریشن seed می‌کند (بعد از آن دادهٔ تازه فقط از
 *     fetch می‌آید — رفتار قبلی کلاینت یک byte هم عوض نمی‌شود).
 */
export function seedPublicStats(initial: PublicStatsSeed | null | undefined): void {
  if (!initial) return;
  if (
    typeof initial.users !== "number" ||
    typeof initial.appInstalls !== "number" ||
    initial.users <= 0
  ) {
    return;
  }
  if (typeof window !== "undefined" && snapshot !== FALLBACK) return;
  snapshot = {
    users: initial.users,
    plansSold: initial.plansSold,
    exercises: initial.exercises,
    foods: initial.foods,
    appInstalls: initial.appInstalls,
    usersFa: `${formatFaCount(initial.users)}+`,
    plansSoldFa: formatFaCount(initial.plansSold),
    exercisesFa: `${formatFaCount(initial.exercises)}+`,
    foodsFa: `${formatFaCount(initial.foods)}+`,
    appInstallsFa: formatFaCount(initial.appInstalls),
  };
}

function fetchOnce() {
  if (fetching) return fetching;
  fetching = (async () => {
    try {
      const res = await fetch("/api/stats/public", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Partial<PublicStats> & { ok?: boolean };
        if (data.ok && typeof data.users === "number" && data.users > 0 && typeof data.usersFa === "string") {
          snapshot = {
            users: data.users,
            plansSold: typeof data.plansSold === "number" ? data.plansSold : 0,
            exercises: typeof data.exercises === "number" ? data.exercises : 0,
            foods: typeof data.foods === "number" ? data.foods : 0,
            appInstalls: typeof data.appInstalls === "number" ? data.appInstalls : 0,
            usersFa: data.usersFa,
            plansSoldFa: typeof data.plansSoldFa === "string" ? data.plansSoldFa : FALLBACK.plansSoldFa,
            exercisesFa: typeof data.exercisesFa === "string" ? data.exercisesFa : FALLBACK.exercisesFa,
            foodsFa: typeof data.foodsFa === "string" ? data.foodsFa : FALLBACK.foodsFa,
            appInstallsFa:
              typeof data.appInstallsFa === "string" ? data.appInstallsFa : FALLBACK.appInstallsFa,
          };
          emit();
        }
      }
    } catch {
      // بی‌صدا — فال‌بکس می‌ماند
    } finally {
      lastFetchedAt = Date.now();
      fetching = null;
    }
  })();
  return fetching;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // اولین مشترک (یا رفرش منقضی‌شده) → درخواست — آمار «هر لحظه زنده» می‌ماند
  if (Date.now() - lastFetchedAt > REFRESH_TTL_MS) {
    void fetchOnce();
  }
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PublicStats {
  return snapshot;
}

/** تبدیل عدد به رقم فارسی با جداکنندهٔ هزارگان «٬» (برای خطوط اعتماد داخلی) */
export function formatFaCount(n: number): string {
  return n
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/**
 * هوک اثبات اجتماعی — خروجی در تمام کامپوننت‌های لندینگ یکسان است
 * (یک منبع حقیقت مشترک؛ بدون درخواست تکراری بین کامپوننت‌ها)
 */
export function usePublicStats(): PublicStats {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
