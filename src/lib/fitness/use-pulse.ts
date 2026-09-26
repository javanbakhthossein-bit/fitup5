"use client";

import { useSyncExternalStore } from "react";
import { refreshUserIfNeeded } from "./store";

/**
 * Task 3-a — usePulse: «پالس ۳ ثانیه‌ای» داشبورد/پنل کاربر (دیرکتیو مالک:
 * «داشبورد و پنل کاربر باید تا ۳ ثانیه هر تغییری را منعکس کند، بدون رفرش کامل»).
 *
 * معماری (تک‌اینترول سراسری — ضد polling تکراری):
 *  - یک ماژول-سینگلتون فقط «یک» interval ۳ ثانیه‌ای دارد؛ هر تعداد کامپوننت
 *    (main-app + داشبورد + …) از usePulse() استفاده کنند، درخواست‌ها ضرب نمی‌شوند.
 *  - شروع/توقف با شمارندهٔ subscriber: اولین مشترک interval را روشن می‌کند،
 *    با صفرشدن مشترک‌ها interval کامل بسته می‌شود.
 *  - فقط وقتی document.visibilityState === "visible" درخواست می‌زنیم؛ با مخفی‌شدن
 *    تب interval برداشته می‌شود (صفر درخواست در پس‌زمینه) و با برگشت به تب
 *    بلافاصله یک پالس فوری + interval از نو.
 *  - diff-guard: پاسخ با آخرین snapshot مقایسه می‌شود؛ اگر هیچ فیلدی تغییر
 *    نکرده باشد، هیچ رویدادی به React نمی‌رود (صفر re-render) و اگر فقط
 *    unread/programStatus عوض شده باشد هم فقط همان بخش اطلاع‌رسانی می‌شود.
 *  - تغییر فیلدهای پلن (planName/planExpiresAt/hasActiveSubscription/
 *    hasPendingSubscription) → refreshUserIfNeeded(true) (force — bypass
 *    throttle ۶۰ ثانیه‌ای store) تا کل پنل تا ~۳ ثانیه به پلن تازه فلپ کند.
 *
 * مصرف‌کنندگان:
 *  - main-app.tsx: افزایش unread → واکشی فوری لیست اعلان‌ها (poll ۳۰ ثانیه‌ای
 *    قبلی به‌عنوان پشتیبان باقی می‌ماند).
 *  - dashboard-view.tsx: programStatus → بنر وضعیت تولید + توست «برنامه آماده شد».
 */

export interface PulseData {
  ok: boolean;
  serverTime: string;
  planName: string | null;
  planStartedAt: string | null;
  planExpiresAt: string | null;
  hasActiveSubscription: boolean;
  hasPendingSubscription: boolean;
  programStatus: string | null;
  programUpdatedAt: string | null;
  unreadNotifications: number;
  planId: string | null;
}

/** snapshot ای که useSyncExternalStore به کامپوننت‌ها می‌دهد */
export interface PulseSnapshot {
  pulse: PulseData | null;
  programStatus: string | null;
  unread: number;
}

/** فاصلهٔ پالس — دیرکتیو مالک: حداکثر ~۳ ثانیه تأخیر در انعکاس تغییرات */
const PULSE_INTERVAL_MS = 3000;

// ─────────────────────────────────────────────────────────────
//  وضعیت ماژول (سینگلتون) — خارج از React تا re-render نسازد
// ─────────────────────────────────────────────────────────────
const EMPTY_SNAPSHOT: PulseSnapshot = { pulse: null, programStatus: null, unread: 0 };

let snapshot: PulseSnapshot = EMPTY_SNAPSHOT;
let listeners = new Set<() => void>();
let subscriberCount = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let visibilityHandler: (() => void) | null = null;

function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // شنوندهٔ خراب هرگز پالس سراسری را نمی‌شکند
    }
  }
}

/** نرخ‌محور: فقط وقتی تپ واقعاً دیده می‌شود درخواست بزن */
function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function startInterval() {
  if (intervalId == null && typeof window !== "undefined") {
    intervalId = setInterval(() => {
      if (!isDocumentVisible()) return; // گارد دوم — همیشه محافظت‌شده
      void fetchPulse();
    }, PULSE_INTERVAL_MS);
  }
}

function stopInterval() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function fetchPulse() {
  if (inflight) return; // هیچ‌وقت دو درخواست هم‌زمان
  inflight = true;
  try {
    const res = await fetch("/api/dashboard/pulse", { cache: "no-store" });
    if (!res.ok) return; // ۴۰۱ (لاگ‌اوت) یا خطای سرور → بی‌صدا؛ پالس بعدی دوباره
    const data = (await res.json()) as PulseData;
    if (!data?.ok) return;
    applyPulse(data);
  } catch {
    // خطای شبکه — پالس بعدی دوباره تلاش می‌کند
  } finally {
    inflight = false;
  }
}

/**
 * diff-guard هستهٔ پالس: فقط روی «تغییر واقعی» snapshot را عوض می‌کند
 * (useSyncExternalStore با تغییر identity اجرای کامپوننت‌ها را trigger می‌کند —
 * پس بدون تغییر، هیچ کامپوننتی re-render نمی‌شود).
 */
function applyPulse(data: PulseData) {
  const prev = snapshot.pulse;
  const changed =
    !prev ||
    prev.planName !== data.planName ||
    prev.planStartedAt !== data.planStartedAt ||
    prev.planExpiresAt !== data.planExpiresAt ||
    prev.hasActiveSubscription !== data.hasActiveSubscription ||
    prev.hasPendingSubscription !== data.hasPendingSubscription ||
    prev.programStatus !== data.programStatus ||
    prev.programUpdatedAt !== data.programUpdatedAt ||
    prev.unreadNotifications !== data.unreadNotifications ||
    prev.planId !== data.planId;
  if (!changed) return;

  // تغییر پلن → رفرش force کاربر (bypass throttle ۶۰s) تا DTO کامل (نام پلن،
  // انقضا، گیت‌ها، موجودی و…) در store تازه شود و کل پنل همان لحظه فلپ کند.
  // توجه: اولین پالس هر سشن (prev=null) عمداً force نمی‌زند — /api/auth/me
  // در همان لحظه در main-app خودش اجرا شده است.
  const planChanged =
    !!prev &&
    (prev.planName !== data.planName ||
      prev.planExpiresAt !== data.planExpiresAt ||
      prev.hasActiveSubscription !== data.hasActiveSubscription ||
      prev.hasPendingSubscription !== data.hasPendingSubscription);
  if (planChanged) {
    void refreshUserIfNeeded(true);
  }

  snapshot = {
    pulse: data,
    programStatus: data.programStatus ?? null,
    unread: data.unreadNotifications ?? 0,
  };
  emit();
}

/**
 * یک پالس فوری خارج از نوبت (مثلاً بعد از خرید/تغییر پلن در همین دستگاه)
 * تا تغییر محلی بدون منتظرماندن تا تیک بعدی ۳ ثانیه‌ای تأیید شود.
 */
export function requestPulseNow(): void {
  if (typeof window === "undefined") return;
  if (!isDocumentVisible()) return;
  void fetchPulse();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount++;
  if (subscriberCount === 1) {
    startInterval();
    // پالس اول بلافاصله (نه ۳ ثانیه بعد)
    if (isDocumentVisible()) void fetchPulse();
    if (visibilityHandler == null && typeof document !== "undefined") {
      visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          // برگشت به تب → پالس فوری + interval از نو (در مخفی بودن متوقف شده بود)
          startInterval();
          void fetchPulse();
        } else {
          // مخفی شدن تب → صفر درخواست (دیرکتیو پرفورمنس)
          stopInterval();
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
      // اگر همین الان مخفی است (مثلاً subscribe در تب پس‌زمینه) interval را نگیر
      if (!isDocumentVisible()) stopInterval();
    }
  }
  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      stopInterval();
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      // snapshot عمداً نگه داشته می‌شود: subscribe بعدی فوراً آخرین داده را دارد
      // و اولین رندر خود را با مقدار واقعی (نه null) می‌سازد.
    }
  };
}

function getSnapshot(): PulseSnapshot {
  return snapshot;
}

function getServerSnapshot(): PulseSnapshot {
  // SSR/hydration — هیچ پالسی سمت سرور وجود ندارد
  return EMPTY_SNAPSHOT;
}

/**
 * هوک اصلی — snapshot به‌اشتراک‌گذاشته‌شدهٔ پالس.
 * re-render فقط وقتی رخ می‌دهد که پالس واقعاً «تغییر» دیده باشد (diff-guard).
 */
export function usePulse(): PulseSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
