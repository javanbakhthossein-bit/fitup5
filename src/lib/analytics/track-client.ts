"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v198 — ترکر قیف فروش سمت کلاینت (دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 * ارسال رویدادهای مراحل خرید به /api/analytics/track — همیشه fire-and-forget:
 * هیچ خطای شبکه‌ای نباید فلوی خرید را حتی یک میلی‌ثانیه بلاک کند.
 *
 *  • sendBeacon (بهترین برای ناوبری/بستن تب) → fallback fetch keepalive
 *  • سشن ناشناس: localStorage (بدون کوکی — ساده و پایدار بین تب‌ها)
 *  • ددوپ ضداسپم: همان رویداد+پلن در پنجرهٔ کوتاه دوباره ارسال نمی‌شود
 *    (ری‌مانت‌های React نباید قیف را باد کنند)
 *  • سقف ایمنی سشن: ۴۰۰ رویداد در روز (v229 — قبلاً مادام‌العمر بود)
 *  • سشن قیف: ۳۰ دقیقه بی‌کنشی → سشن تازه (v229)
 */

const SESSION_KEY = "fitup_funnel_sid_v1";
const SESSION_TS_KEY = "fitup_funnel_sid_ts_v1";
const SENT_CAP_KEY = "fitup_funnel_sent_count_v1";
/** v229 — سقف رویداد از «مادام‌العمر» به «روزانه» تبدیل شد: سقف قبلی ۴۰۰
 *  مادام‌العمر بود و دستگاه‌های وفادار/پرکار (همان مشتریان واقعی) بعد از چند
 *  ماه بی‌صدا برای همیشه از قیف حذف می‌شدند (آندرکانت سیستماتیک). */
const DAILY_SESSION_CAP = 400;
const DEDUPE_WINDOW_MS = 4000;
const MAX_META_KEYS = 8;
/** v229 — سشن قیف همان معنای سشن واقعی را دارد: بیش از ۳۰ دقیقه بی‌کنشی
 *  → سشن تازه. قبلاً شناسه دائمی بود و «یکتا per-session» داشبورد عملاً
 *  «یکتا per-دستگاه» می‌شد. */
const SESSION_IDLE_ROTATE_MS = 30 * 60 * 1000;

function getSessionId(): string {
  try {
    const now = Date.now();
    let sid = localStorage.getItem(SESSION_KEY);
    const lastTs = Number(localStorage.getItem(SESSION_TS_KEY) || "0");
    if (!sid) {
      sid =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 24)
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`) +
        "";
      localStorage.setItem(SESSION_KEY, sid);
    } else if (lastTs && now - lastTs > SESSION_IDLE_ROTATE_MS) {
      // v229 — سشن منقضی (۳۰ دقیقه بی‌کنشی) → شناسهٔ تازه؛ رویدادهای بعدی
      // سشن جدید حساب می‌شوند (هم‌راستا با سشن مرورگر/GA)
      sid =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 24)
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`) +
        "";
      localStorage.setItem(SESSION_KEY, sid);
    }
    localStorage.setItem(SESSION_TS_KEY, String(now));
    return sid;
  } catch {
    // حالت خصوصی مرورگر / localStorage بسته — سشن پروازی
    return `eph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * v214 — شناسهٔ سشن ناشناس برای رویدادهای سروریِ مرتبط با خرید (checkout_created).
 * ممیزی قیف: رویدادهای سروری بدون سشن بودند و به رویدادهای کلاینتی (مدال باز/کلیک)
 * وصل نمی‌شدند — حالا مودال خرید همین شناسه را در بدنهٔ checkout می‌فرستد.
 */
export function getFunnelSessionId(): string {
  return getSessionId();
}

function bumpSentCount(): boolean {
  try {
    // v229 — پنجرهٔ روزانه (تاریخ محلی): با تعویض روز شمارنده صفر می‌شود.
    // شکل قدیمی (عدد خالی) هم پذیرفته می‌شود تا داده‌های نسخهٔ قبل بشکنند.
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem(SENT_CAP_KEY);
    let n = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { d?: string; n?: number };
        if (parsed?.d === today && typeof parsed.n === "number") n = parsed.n;
      } catch {
        n = Number(raw) || 0; // شکل قدیمی — در اولین ارسال امروز ریست می‌شود
      }
    }
    n += 1;
    if (n > DAILY_SESSION_CAP) return false;
    localStorage.setItem(SENT_CAP_KEY, JSON.stringify({ d: today, n }));
    return true;
  } catch {
    return true;
  }
}

/** ددوپ در-حافظه: event|planId → timestamp آخرین ارسال */
const lastSent = new Map<string, number>();

export interface FunnelTrackOptions {
  planId?: string;
  amount?: number;
  meta?: Record<string, string | number | boolean | null>;
  /** ددوپ را دور بزن (رویدادهای که عمداً تکراری معنادارند) */
  force?: boolean;
}

function payload(event: string, opts: FunnelTrackOptions | undefined) {
  const meta = opts?.meta;
  const cleanMeta =
    meta && Object.keys(meta).length > 0
      ? Object.fromEntries(Object.entries(meta).slice(0, MAX_META_KEYS))
      : undefined;
  return {
    events: [
      {
        event,
        sessionId: getSessionId(),
        path:
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "",
        planId: opts?.planId,
        amount: typeof opts?.amount === "number" ? Math.round(opts.amount) : undefined,
        meta: cleanMeta,
      },
    ],
  };
}

function send(body: string): void {
  try {
    // sendBeacon: صف‌شده توسط مرورگر — حتی هنگام بستن تب می‌رسد
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/analytics/track", blob)) return;
    }
  } catch {
    /* fallthrough */
  }
  try {
    // fallback: fetch با keepalive (نیز پس از navigation می‌رسد)
    void fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
  } catch {
    /* بی‌صدا — تحلیل هرگز خرید را نمی‌شکند */
  }
}

/**
 * ثبت یک رویداد قیف از کلاینت — همیشه بی‌صدا و غیربلاک‌کننده.
 * مثال: trackFunnelEvent("checkout_clicked", { planId: "standard", meta: { delivery: "gateway" } })
 */
export function trackFunnelEvent(event: string, opts?: FunnelTrackOptions): void {
  try {
    if (typeof window === "undefined") return;
    const key = `${event}|${opts?.planId ?? ""}`;
    const now = Date.now();
    if (!opts?.force) {
      const last = lastSent.get(key);
      if (last && now - last < DEDUPE_WINDOW_MS) return;
    }
    lastSent.set(key, now);
    // پاکسازی نگاشت — نشت حافظه نسازد
    if (lastSent.size > 120) {
      for (const [k, t] of lastSent) {
        if (now - t > 60_000) lastSent.delete(k);
      }
    }
    if (!bumpSentCount()) return;
    send(JSON.stringify(payload(event, opts)));
  } catch {
    /* بی‌صدا */
  }
}
