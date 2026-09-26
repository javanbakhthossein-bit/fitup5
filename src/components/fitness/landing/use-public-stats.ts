"use client";

import { useSyncExternalStore } from "react";

/**
 * usePublicStats — هوک سبک اثبات اجتماعی (Task 5-b + دیرکتیو مالک CountUp)
 *
 * تعداد واقعی کاربران ثبت‌نام‌شده (و پلن‌های فروخته‌شده) را از /api/stats/public
 * می‌گیرد. کش ماژول‌سطح دارد، پس اگر چند کامپوننت هم‌زمان (TrustBar، PricingSection،
 * PurchaseModal) از آن استفاده کنند، فقط «یک» درخواست در هر ۵ دقیقه زده می‌شود.
 *
 * دیرکتیو مالک: دیگر هیچ عدد جعلی‌ای (۲٬۵۰۰) نمایش داده نمی‌شود — فال‌بک «۰» است
 * و کامپوننت CountUp با باز شدن صفحه از صفر با انیمیشن نرم به عدد واقعی می‌رسد.
 */

interface PublicStats {
  users: number;
  plansSold: number;
  /** v94 — تعداد کل حرکات کتابخانه (دیرکتیو مالک: شمارندهٔ صفحهٔ اصلی باید پویا باشد) */
  exercises: number;
  /** Task 7-d — تعداد کل غذاهای بانک غذا (شمارندهٔ «غذای سالم» لندینگ) */
  foods: number;
  /** آمادهٔ نمایش با رقم فارسی و «+» — مثال: «۲٬۵۰۰+» */
  usersFa: string;
  plansSoldFa: string;
  exercisesFa: string;
  foodsFa: string;
}

/** فال‌بک صفر — تا اولین پاسخ موفق سرور، CountUp از صفر شمرده می‌شود (بدون عدد جعلی) */
const FALLBACK: PublicStats = {
  users: 0,
  plansSold: 0,
  exercises: 0,
  foods: 0,
  usersFa: "۰+",
  plansSoldFa: "۰",
  exercisesFa: "۰+",
  foodsFa: "۰+",
};

const REFRESH_TTL_MS = 5 * 60 * 1000;

let snapshot: PublicStats = FALLBACK;
let fetching: Promise<void> | null = null;
let lastFetchedAt = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
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
            usersFa: data.usersFa,
            plansSoldFa: typeof data.plansSoldFa === "string" ? data.plansSoldFa : FALLBACK.plansSoldFa,
            exercisesFa: typeof data.exercisesFa === "string" ? data.exercisesFa : FALLBACK.exercisesFa,
            foodsFa: typeof data.foodsFa === "string" ? data.foodsFa : FALLBACK.foodsFa,
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
  // اولین مشترک (یا رفرش منقضی‌شده) → درخواست
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

/** تبدیل عدد به رقم فارسی با جداکنندهٔ «٬» (برای خطوط اعتماد داخلی) */
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
