"use client";

import { useSyncExternalStore } from "react";
import { refreshUserIfNeeded } from "./store";
import { isFitUpNativeApp } from "./app-bridge";
import { isNetworkSuspect } from "./network-recovery";
import { shieldTimeoutSignal } from "./net-shield";

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

/** فاصلهٔ پالس — دیرکتیو مالک: حداکثر ~۳ ثانیه تأخیر در انعکاس تغییرات (وب) */
const PULSE_INTERVAL_MS = 3000;
/** v229 — در محیط اپ (WebView) پالس ۸ ثانیه‌ای: اعلان فوری از FCM/SSE می‌آید و
 *  پالس فقط پشتیبان است؛ کاهش بیداری رادیو/گرما/CPU روی گوشی ضعیف (دیرکتیو مالک:
 *  «برنامه هنگ می‌کنه»). وب همان ۳ ثانیهٔ دیرکتیو می‌ماند. */
const PULSE_INTERVAL_MS_APP = 8000;
function pulseIntervalMs(): number {
  try {
    return isFitUpNativeApp() ? PULSE_INTERVAL_MS_APP : PULSE_INTERVAL_MS;
  } catch {
    return PULSE_INTERVAL_MS;
  }
}

// ─────────────────────────────────────────────────────────────
//  وضعیت ماژول (سینگلتون) — خارج از React تا re-render نسازد
// ─────────────────────────────────────────────────────────────
const EMPTY_SNAPSHOT: PulseSnapshot = { pulse: null, programStatus: null, unread: 0 };

// v139.2 — ماندگاری snapshot در sessionStorage: داشبورد در رفرش «همان لحظه»
// با آخرین وضعیت شناخته‌شده (نام پلن/آن‌رید/وضعیت برنامه) رندر می‌شود — نه
// با null تا رسیدن اولین پالس شبکه (ضد فلیکر/ضد اسکلتون در رفرش و back اپ).
// v153 — دیرکتیو مالک «کش موبایل = کش دسکتاپ»: TTL ۲ دقیقه — در WebView
// چندروزهٔ اپ دیگر snapshot روزهای قبل first-paint نمی‌شود (اولین پالس ~۳s).
const PULSE_SNAPSHOT_KEY = "fitup_pulse_snapshot_v1";
const PULSE_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 1000;

function loadPersistedSnapshot(): PulseSnapshot {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  try {
    const raw = window.sessionStorage.getItem(PULSE_SNAPSHOT_KEY);
    if (!raw) return EMPTY_SNAPSHOT;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: PulseData } | PulseData;
    // v153 — شکل جدید {savedAt, data} با TTL؛ شکل قدیمی (بدون savedAt) منقضی حساب می‌شود
    const withMeta = parsed as { savedAt?: number; data?: PulseData };
    if (typeof withMeta.savedAt !== "number" || !withMeta.data) return EMPTY_SNAPSHOT;
    if (Date.now() - withMeta.savedAt > PULSE_SNAPSHOT_MAX_AGE_MS) return EMPTY_SNAPSHOT;
    const p = withMeta.data;
    if (!p?.ok || typeof p.serverTime !== "string") return EMPTY_SNAPSHOT;
    // دادهٔ ناقص → نادیده (فیلدهای کلیدی باید از سرور آمده باشند)
    if (p.hasActiveSubscription === undefined) return EMPTY_SNAPSHOT;
    return { pulse: p, programStatus: p.programStatus ?? null, unread: p.unreadNotifications ?? 0 };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function persistSnapshot(data: PulseData): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PULSE_SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // sessionStorage پر/غیرفعال — بی‌اهمیت
  }
}

let snapshot: PulseSnapshot = loadPersistedSnapshot();
let listeners = new Set<() => void>();
let subscriberCount = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
// v156 — ضد قفل ابدی: قبلاً فلگ boolean بود؛ یک fetch آویزان (سوکت مردهٔ سوییچ
// VPN) برای همیشه true می‌ماند و «کل پنل تا بازوبست کردن اپ» منجمد می‌شد.
// حالا زمان‌محور است — بیش از ۱۵ ثانیه معلق بماند خودش منقضی می‌شود.
let inflightSince = 0;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let restoredHandler: (() => void) | null = null;
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
    }, pulseIntervalMs());
  }
}

function stopInterval() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function fetchPulse() {
  const now = Date.now();
  // هیچ‌وقت دو درخواست هم‌زمان (اگر قبلی >۱۵ ثانیه معلق مانده، منقضی حساب می‌شود)
  if (inflightSince && now - inflightSince < 15_000) return;
  // v156 — مدارشکن: وقتی موتور خودترمیمی «شبکهٔ خراب» اعلام کرده، پالس جدید
  // نمی‌سازیم (تولید درخواست زامبی/طوفان روی استخر اتصال ممنوع). با رویداد
  // connection-restored همین‌جا پالس فوری می‌زنیم.
  if (isNetworkSuspect()) return;
  inflightSince = now;
  try {
    const signal = shieldTimeoutSignal(8_000);
    const res = await fetch("/api/dashboard/pulse", {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return; // ۴۰۱ (لاگ‌اوت) یا خطای سرور → بی‌صدا؛ پالس بعدی دوباره
    const data = (await res.json()) as PulseData;
    if (!data?.ok) return;
    applyPulse(data);
  } catch {
    // خطای شبکه — پالس بعدی دوباره تلاش می‌کند (سپر سراسری تایم‌اوت را تضمین می‌کند)
    // v156 — پالس پرتکرارترین poller است → اولین آشکارساز قطعی شبکه؛ گزارشش
    // به موتور خودترمیمی یعنی بازیابی سریع‌تر (آزادسازی زامبی‌ها + probe).
    import("./network-recovery")
      .then((m) => m.noteNetworkFailure())
      .catch(() => {});
  } finally {
    inflightSince = 0;
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

  // v153 — رویداد سراسری «برنامهٔ کاربر به‌روز شد»: ادمین برنامه را عوض کرد /
  // بازطراحی چت ثبت شد / پلن عوض شد → داشبورد و تب تمرین فوراً /api/coach/plan
  // را دوباره می‌گیرند (تا ~۳ ثانیه انعکاس تغییر — دیرکتیو مالک پالس).
  // قبلاً programUpdatedAt فقط در snapshot دیف می‌شد و هیچ رفرشی trigger نمی‌کرد.
  if (prev && prev.programUpdatedAt !== data.programUpdatedAt) {
    try {
      window.dispatchEvent(new CustomEvent("fitup-program-updated"));
    } catch {
      // رویداد هرگز جریان پالس را نمی‌شکند
    }
  }

  snapshot = {
    pulse: data,
    programStatus: data.programStatus ?? null,
    unread: data.unreadNotifications ?? 0,
  };
  persistSnapshot(data);
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
          // v156 — برگشت به تب: پالس فوری «با ۸۰۰ms تاخیر عمدی» — در لحظهٔ
          // رزوم، رادیو/سوکت‌ها هنوز بیدار نشده‌اند و طوفان fetch همزمانِ همهٔ
          // کامپوننت‌ها (ریشهٔ «۳-۴ ثانیه دکمه‌ها کار نمی‌کند») پخش زمانی می‌شود.
          startInterval();
          if (resumeTimer) clearTimeout(resumeTimer);
          resumeTimer = setTimeout(() => {
            resumeTimer = null;
            void fetchPulse();
          }, 800);
        } else {
          // مخفی شدن تب → صفر درخواست (دیرکتیو پرفورمنس)
          stopInterval();
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
      // v156 — بازیابی شبکه: موتور خودترمیمی اعلام «برگشت اتصال» کرد → پالس
      // فوری تا کل پنل درجا داده‌های تازه بگیرد (بدون رفرش دستی/بستن اپ).
      restoredHandler = () => {
        if (isDocumentVisible()) void fetchPulse();
      };
      window.addEventListener("fitup:connection-restored", restoredHandler);
      // اگر همین الان مخفی است (مثلاً subscribe در تب پس‌زمینه) interval را نگیر
      if (!isDocumentVisible()) stopInterval();
    }
  }
  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      stopInterval();
      if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      if (restoredHandler) {
        window.removeEventListener("fitup:connection-restored", restoredHandler);
        restoredHandler = null;
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
