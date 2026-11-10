/**
 * ─── v172 — زنده‌سازی پنل کاربر (Real-Time Panel Client) ───
 *
 * سند مالک «زنده‌سازی پنل کاربری» — بخش ۱/۳ (سمت سایت):
 *  • EventSource روی /api/panel/stream — رویدادها در لحظه (< ۲ ثانیه) می‌رسند.
 *  • با هر رویداد «فقط بخش مرتبط» به‌روز می‌شود (fetch هدفمند) — نه رفرش کل
 *    صفحه؛ موقعیت اسکرول کاربر چون reload نداریم همیشه حفظ است.
 *  • visibilitychange: تب مخفی → اتصال بسته (باتری/دیتا)؛ فعال → دوباره باز.
 *  • last-event-id: هر رویداد شناسه دارد؛ بعد از ری‌کانکت رویدادهای ازدست‌رفته
 *    ری‌پلی می‌شوند (سشن‌استوریج برای ادامه بعد از رفرش صفحه).
 *  • fallback polling ۳۰ ثانیه‌ای — فقط وقتی SSE فعال نیست (سند).
 *  • رویداد window «fitup:reconnect-sse» (از اپ اندروید — onResume) → ری‌کانکت.
 *  • رویداد window «refresh-section» (CustomEvent از پل JS اپ) → فقط همان
 *    بخش از سرور گرفته و آپدیت می‌شود.
 *
 * رویدادهای سرور: wallet_charged | wallet_updated | order_ready | plan_ready |
 * new_message | notification | status_changed | connected | idle
 */

import { useAppStore, refreshUserIfNeeded } from "@/lib/fitness/store";
import {
  fetchProgramHistoryCached,
  invalidateProgramHistoryCache,
  invalidateCoachPlanCache,
  fetchCoachPlanCached,
  invalidateBodyProgressCaches,
  fetchProgressSummaryCached,
} from "@/lib/fitness/panel-fetch";

const STREAM_URL = "/api/panel/stream";
const POLL_INTERVAL_MS = 30_000; // فال‌بک سند: ۳۰ ثانیه — فقط وقتی SSE فعال نیست
const RECONNECT_BACKOFF_MS = 5_000; // اگر EventSource بسته شد (CLOSED) — تلاش دوباره

// ─── state ماژول (سینگلتون — فقط یک اتصال در کل صفحه) ───
let evtSource: EventSource | null = null;
let sseActive = false;
let everConnected = false;
let lastEventId = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualClosed = false;
let started = false;

function loadLastEventId(): void {
  try {
    const raw = sessionStorage.getItem("fitup_panel_last_event_id");
    if (raw) lastEventId = Math.max(0, Number.parseInt(raw, 10) || 0);
  } catch {}
}

function saveLastEventId(id: number): void {
  if (!Number.isFinite(id) || id <= 0) return;
  lastEventId = id;
  try {
    sessionStorage.setItem("fitup_panel_last_event_id", String(id));
  } catch {}
}

// ────────────────────────── آپدیت‌های هدفمند بخش‌ها ──────────────────────────

/** آپدیت ساکت موجودی در store (بدون toast) */
function applyWalletBalance(balance: unknown): void {
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) return;
  const user = useAppStore.getState().user;
  if (user && user.walletBalance !== balance) {
    useAppStore.getState().setUser({ ...user, walletBalance: balance });
  }
}

/** بخش کیف پول/تراکنش‌ها — fetch هدفمند + اطلاع به لیسنرها (پروفایل و …) */
async function refreshWalletSection(): Promise<void> {
  try {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.walletBalance === "number") {
      applyWalletBalance(data.walletBalance);
    } else if (typeof data?.balance === "number") {
      applyWalletBalance(data.balance);
    }
    // پروفایل‌اورلی/هر لیسنر دیگری تراکنش‌ها را خودش دوباره می‌گیرد
    window.dispatchEvent(new CustomEvent("fitup:wallet-refresh", { detail: data }));
  } catch {
    // ساکت — پولینگ فال‌بک بعداً پوشش می‌دهد
  }
}

/** بخش داشبورد — journey + خلاصهٔ پیشرفت (بدون رفرش صفحه، بدون فلش) */
function refreshDashboardSection(): void {
  try {
    void useAppStore.getState().loadJourney();
  } catch {}
  invalidateBodyProgressCaches();
  void fetchProgressSummaryCached();
}

/** بخش برنامه‌ها — تاریخچهٔ برنامه + پلن فعال (کش SWR invalid + fetch تازه) */
async function refreshProgramsSection(): Promise<void> {
  invalidateProgramHistoryCache();
  invalidateCoachPlanCache();
  try {
    await Promise.allSettled([fetchProgramHistoryCached(), fetchCoachPlanCached()]);
  } catch {}
}

/** بخش پیام‌ها/تیکت‌ها — support-view لیسنر خودش را دارد */
function refreshMessagesSection(): void {
  window.dispatchEvent(new CustomEvent("fitup:messages-refresh"));
}

/** بخش اعلان‌ها — main-app لیسنر دارد (loadNotificationsRef) */
function refreshNotificationsSection(): void {
  window.dispatchEvent(new CustomEvent("fitup:notifications-refresh"));
}

/** اطلاعات کاربر (گیت‌های پلن/اشتراک) — force */
function refreshUserSection(): void {
  void refreshUserIfNeeded(true);
}

/** toast فقط وقتی صفحه قابل مشاهده است (بدون توست‌های انباشتهٔ پس‌زمینه) */
function liveToast(kind: "success" | "info", message: string): void {
  if (typeof document !== "undefined" && document.hidden) return;
  import("sonner").then(({ toast }) => {
    if (kind === "success") toast.success(message);
    else toast.info(message);
  }).catch(() => {});
}

// ────────────────────────── پردازش رویداد سرور ──────────────────────────

export function handlePanelEvent(raw: unknown): void {
  const data = (raw ?? {}) as Record<string, unknown>;
  const type = String(data.type || "");
  switch (type) {
    case "connected":
      sseActive = true;
      everConnected = true;
      stopPolling();
      break;

    // ─── شارژ کیف پول — سند: updateWalletSection(data.amount) ───
    case "wallet_charged": {
      applyWalletBalance(data.balance);
      void refreshWalletSection();
      const amount = typeof data.amount === "number" ? data.amount : null;
      if (amount != null && amount > 0) {
        liveToast("success", `کیف پول شما ${amount.toLocaleString("en-US")} تومان شارژ شد ✅`);
      }
      break;
    }

    // ─── خرج کیف پول (خرید با کیف پول) — بدون toast، فقط آپدیت ───
    case "wallet_updated": {
      applyWalletBalance(data.balance);
      void refreshWalletSection();
      break;
    }

    // ─── سفارش ثبت شد — سند: updateOrderSection(data.orderId) ───
    case "order_ready": {
      void refreshWalletSection(); // تراکنش‌های اخیر + خرید پلن
      refreshDashboardSection();
      refreshUserSection(); // گیت پلن/اشتراک
      const label = typeof data.planLabel === "string" ? data.planLabel : "";
      liveToast("success", label ? `پلن ${label} با موفقیت فعال شد 🎉` : "سفارش شما با موفقیت ثبت شد ✅");
      break;
    }

    // ─── برنامه آماده شد — سند: تغییر وضعیت ───
    case "plan_ready": {
      void refreshProgramsSection();
      refreshDashboardSection();
      liveToast("success", "برنامهٔ شما آماده شد! 🎯");
      break;
    }

    // ─── پیام جدید — سند: updateMessageSection(data.messageId) ───
    case "new_message": {
      refreshMessagesSection();
      const subject = typeof data.subject === "string" ? data.subject : "";
      liveToast("info", subject ? `پاسخ جدید به تیکت «${subject}» 💬` : "پیام جدید دارید 💬");
      break;
    }

    // ─── نوتیف تازه — لیست اعلان‌ها ساکت به‌روز می‌شود (بدون toast دوبله) ───
    case "notification": {
      refreshNotificationsSection();
      break;
    }

    // ─── تغییر وضعیت عمومی ───
    case "status_changed": {
      refreshDashboardSection();
      refreshUserSection();
      break;
    }

    case "idle":
      // سرور اتصال idle را بست — ری‌کانکت فوری
      reconnectSoon(300);
      break;

    default:
      break;
  }
}

// ────────────────────────── اتصال SSE ──────────────────────────

function openStream(): void {
  if (typeof window === "undefined") return;
  if (evtSource) {
    try {
      evtSource.close();
    } catch {}
    evtSource = null;
  }
  const user = useAppStore.getState().user;
  if (!user) return; // مهمان — هیچ اتصالی (سند: فقط لاگین‌شده)

  manualClosed = false;
  loadLastEventId();
  const url = lastEventId > 0 ? `${STREAM_URL}?lastEventId=${lastEventId}` : STREAM_URL;
  let es: EventSource;
  try {
    es = new EventSource(url);
  } catch {
    startPolling();
    return;
  }
  evtSource = es;

  es.onopen = () => {
    sseActive = true;
    everConnected = true;
    stopPolling();
  };

  // سند مالک: evtSource.onmessage → data.type → updateXSection(...)
  es.onmessage = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data);
      if (event.lastEventId) {
        const id = Number.parseInt(event.lastEventId, 10);
        if (Number.isFinite(id) && id > 0) saveLastEventId(id);
      }
      handlePanelEvent(parsed);
    } catch {
      // فریم خراب — ساکت رد می‌شود
    }
  };

  es.onerror = () => {
    sseActive = false;
    // EventSource خودش reconnect می‌کند (readyState CONNECTING)؛ اگر بستهٔ
    // قطعی شد (CLOSED) یا صفحه مخفی بود، پولینگ فال‌بک فعال می‌شود.
    try {
      if (es.readyState === 2 /* CLOSED */) {
        evtSource = null;
        reconnectSoon(RECONNECT_BACKOFF_MS);
      }
    } catch {}
    startPolling();
  };
}

function reconnectSoon(delayMs: number): void {
  if (reconnectTimer || manualClosed) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openStream();
  }, delayMs);
}

function closeStream(): void {
  manualClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (evtSource) {
    try {
      evtSource.close();
    } catch {}
    evtSource = null;
  }
  sseActive = false;
}

// ────────────────────────── فال‌بک پولینگ ۳۰ ثانیه‌ای ──────────────────────────

async function pollOnce(): Promise<void> {
  if (sseActive) return;
  try {
    const url = `${STREAM_URL}?poll=${lastEventId}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data?.events)) {
      for (const ev of data.events) {
        saveLastEventId(typeof ev?.id === "number" ? ev.id : lastEventId);
        handlePanelEvent(ev);
      }
    }
  } catch {
    // ساکت
  }
}

function startPolling(): void {
  if (pollTimer || typeof window === "undefined") return;
  // فال‌بک فقط وقتی SSE فعال نیست (سند) — و صفحه هم مخفی نباشد
  pollTimer = setInterval(() => {
    if (!sseActive && typeof document !== "undefined" && !document.hidden) {
      void pollOnce();
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ────────────────────────── refresh-section (پل اپ اندروید) ──────────────────────────

async function handleRefreshSection(section: string): Promise<void> {
  switch (section) {
    case "wallet":
    case "orders":
      await refreshWalletSection();
      break;
    case "dashboard":
      refreshDashboardSection();
      refreshUserSection();
      break;
    case "programs":
    case "plan":
      await refreshProgramsSection();
      break;
    case "messages":
      refreshMessagesSection();
      break;
    case "notifications":
      refreshNotificationsSection();
      break;
    case "subscription":
      refreshUserSection();
      refreshWalletSection();
      break;
    default:
      // بخش ناشناخته → آپدیت عمومی ساکت (بدون رفرش صفحه)
      refreshUserSection();
      refreshDashboardSection();
      break;
  }
}

// ────────────────────────── start (سینگلتون) ──────────────────────────

/**
 * راه‌اندازی زنده‌سازی پنل — یک‌بار از MainApp صدا زده می‌شود.
 * idempotent است؛ فراخوانی تکراری هیچ کاری نمی‌کند.
 */
export function startPanelRealtime(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  loadLastEventId();

  // ۱) اتصال اولیه (۱.۵ ثانیه بعد از mount — نه در بحبوبهٔ بار اول)
  setTimeout(() => {
    if (!manualClosed) openStream();
  }, 1500);

  // ۲) visibilitychange — سند: مخفی → بستن؛ فعال → اتصال دوباره
  document.addEventListener("visibilitychange", () => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      closeStream();
      stopPolling(); // باتری/دیتا — در پس‌زمینه هیچ ترافیکی نداریم
    } else {
      // برگشت به صفحه: اتصال دوباره + یک poll فوری برای رویدادهای سکوت
      manualClosed = false;
      openStream();
      void pollOnce();
    }
  });

  // ۳) اپ اندروید onResume → fitup:reconnect-sse (سند بخش ۲-الف)
  window.addEventListener("fitup:reconnect-sse", () => {
    manualClosed = false;
    closeStreamAndReopen();
  });

  // ۴) اپ اندروید refreshSection(section) → CustomEvent refresh-section (سند بخش ۲-ب)
  window.addEventListener("refresh-section", ((e: CustomEvent) => {
    const section = typeof e.detail === "string" ? e.detail : String(e.detail?.section ?? e.detail ?? "");
    if (section) void handleRefreshSection(section);
  }) as EventListener);

  // ۵) برگشت اتصال شبکه (netRescue/آنلاین شدن) → SSE دوباره وصل شود (سند بخش ۲-د)
  window.addEventListener("online", () => {
    manualClosed = false;
    closeStreamAndReopen();
  });

  // v205 — بازیابی خودترمیمی شبکه (fitup:connection-restored) → SSE دوباره وصل شود.
  // بعد از سوییچ VPN/شبکه، رویداد offline/online همیشه نمی‌آید؛ موتور خودترمیمی
  // «connection-restored» را پخش می‌کند — جریان زندهٔ پنل هم باید همان‌لحظه وصل شود.
  window.addEventListener("fitup:connection-restored", () => {
    manualClosed = false;
    closeStreamAndReopen();
  });
}

function closeStreamAndReopen(): void {
  if (evtSource) {
    try {
      evtSource.close();
    } catch {}
    evtSource = null;
  }
  sseActive = false;
  reconnectSoon(200);
}

/** وضعیت فعلی (برای دیباگ/ممیزی) */
export function panelRealtimeStatus(): { sseActive: boolean; everConnected: boolean; lastEventId: number } {
  return { sseActive, everConnected, lastEventId };
}
