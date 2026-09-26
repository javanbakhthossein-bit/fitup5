"use client";

import { useEffect } from "react";

/**
 * use-usage-tracker — ردیابی دقیق «زمان مصرف اپ‌ها» (v104 — درخواست مالک)
 *
 * الگوی معماری: همان سینگلتون use-pulse (یک interval سراسری مستقل از تعداد
 * مصرف‌کننده؛ شروع با اولین مشترک، توقف کامل با صفرشدن مشترک‌ها).
 *
 * دقت سنجش (دیرکتیو مالک: «باید یک چیز دقیق و درست پیاده‌سازی شود»):
 *  ۱) فقط «فعالیت واقعی» شمرده می‌شود — تیک هر ۵ ثانیه فقط وقتی
 *     document.visibilityState === "visible" زمان جمع می‌کند. تب پشت‌زمینه /
 *     صفحهٔ خاموش / اپ مینیمایز = صفر ثانیه.
 *  ۲) هر تیک فقط تا طول همان تیک (+۱s تلورانس) شمرده می‌شود — suspend/بیهوشی
 *     مرورگر هرگز به‌عنوان مصرف ثبت نمی‌شود.
 *  ۳) فلاش هر ۳۰ ثانیه: Δ جمع‌شده به POST /api/usage/heartbeat می‌رود
 *     (keepalive) — مرگ صفحه بین فلاش‌ها حداکثر ۳۰ ثانیه از دست می‌دهد.
 *  ۴) مخفی‌شدن تب (visibilitychange → hidden) فلاش فوریِ باقی‌مانده می‌زند.
 *  ۵) بستن اپ/تب (pagehide) با navigator.sendBeacon فلاش می‌شود تا آخرین
 *     بازه‌ها هم ثبت شوند (حتی اگر پروسه بلافاصله کشته شود).
 *  ۶) هر ردیف = حداکثر ۱۲۰ ثانیه (سرور هم سقف می‌زند) — دستکاری ورودی
 *     سقف‌دار است؛ اطمینان هویتی با کوکی سشن.
 *
 * پلتفرم (web / bazaar / own) سمت سرور از User-Agent تعیین می‌شود — کلاینت
 * فقط screen (تب فعال پنل) را می‌فرستد که MainApp با setUsageScreen ست می‌کند.
 */

const TICK_INTERVAL_MS = 5_000;
const FLUSH_INTERVAL_MS = 30_000;
/** سقف ثانیه در هر فلاش — هم‌سو با سقف سرور */
const MAX_SECONDS_PER_FLUSH = 120;
/** بازه‌های خیلی کوتاه‌تر از این نویز محسوب می‌شوند و ارسال نمی‌شوند */
const MIN_FLUSH_SECONDS = 5;

// ─────────────────────────────────────────────────────────────
//  وضعیت ماژول (سینگلتون) — خارج از React
// ─────────────────────────────────────────────────────────────
let subscriberCount = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastTickTs = 0;
let activeDeltaSec = 0;
let currentScreen = "app";
let visibilityHandler: (() => void) | null = null;
let pageHideHandler: (() => void) | null = null;
let inflight = false;

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/** ست‌کردن بخش فعال پنل — MainApp با تغییر mainTab صدا می‌زند */
export function setUsageScreen(screen: string): void {
  currentScreen = screen || "app";
}

/** یک تیک — جمع‌کردن زمان «قابل‌مشاهده» از آخرین تیک */
function tick(): void {
  const now = Date.now();
  const elapsedSec = (now - lastTickTs) / 1000;
  lastTickTs = now;
  if (!isDocumentVisible()) return; // پشت‌زمینه = صفر مصرف
  // سقف: طول همان تیک + ۱s تلورانس تایمر — suspend شمرده نمی‌شود
  activeDeltaSec += Math.min(elapsedSec, TICK_INTERVAL_MS / 1000 + 1);
}

async function flush(sendViaBeacon = false): Promise<void> {
  const secs = Math.min(Math.round(activeDeltaSec), MAX_SECONDS_PER_FLUSH);
  activeDeltaSec = 0;
  if (secs < MIN_FLUSH_SECONDS) return;
  const body = JSON.stringify({ seconds: secs, screen: currentScreen });

  // بستن صفحه — sendBeacon مستقل از عمر صفحه می‌فرستد
  if (
    sendViaBeacon &&
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/usage/heartbeat", blob)) return;
    } catch {
      // fallthrough به fetch
    }
  }

  if (inflight) return; // فلاش قبلی در جریان است — گم شدن این بازه ≤ ۳۰s و کم‌بسامد است
  inflight = true;
  try {
    const res = await fetch("/api/usage/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true, // حتی در حال بستن صفحه تلاش می‌شود
      cache: "no-store",
    });
    if (res.status === 401) {
      return; // کاربر لاگ‌اوت شده — چیزی برای ثبت نیست
    }
  } catch {
    // خطای شبکه — بازهٔ این فلاش گم می‌شود (کم‌بسامد؛ سقف خطا ≤ ۳۰s)
  } finally {
    inflight = false;
  }
}

function start(): void {
  if (tickTimer != null) return; // همان الگوی use-pulse — فقط یک interval
  if (typeof window === "undefined") return;
  lastTickTs = Date.now();
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  flushTimer = setInterval(() => void flush(false), FLUSH_INTERVAL_MS);

  visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      // مخفی‌شدن: فلاش فوری باقی‌مانده + توقف جمع‌کردن (تیک خودش gate دارد)
      tick(); // زمان از آخرین تیک تا همین لحظه (اگر visible بود)
      void flush(false);
    } else {
      // برگشت به تب — مبنا ریست تا زمان غیبت شمرده نشود
      lastTickTs = Date.now();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  pageHideHandler = () => {
    tick();
    void flush(true); // sendBeacon — مستقل از عمر صفحه
  };
  window.addEventListener("pagehide", pageHideHandler);
}

function stop(): void {
  if (tickTimer != null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (flushTimer != null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  if (pageHideHandler) {
    window.removeEventListener("pagehide", pageHideHandler);
    pageHideHandler = null;
  }
}

/**
 * هوک اصلی — در MainApp mount می‌شود (یک‌بار برای کل پنل).
 * هیچ state برنمی‌گرداند؛ فقط lifecycle سینگلتون را مدیریت می‌کند.
 * تب فعال با setUsageScreen(mainTab) ست می‌شود.
 */
export function useUsageTracker(): void {
  useEffect(() => {
    subscriberCount++;
    if (subscriberCount === 1) start();
    return () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) {
        // آخرین unmount (خروج از پنل/لاگ‌اوت) — فلاش نهایی باقی‌مانده
        tick();
        void flush(true);
        stop();
      }
    };
  }, []);
}
