/**
 * ─── v172 — هاب رویدادهای زندهٔ پنل کاربر (Real-Time Panel) ───
 *
 * سند مالک «زنده‌سازی پنل کاربری» — بخش ۱:
 * کاربر نباید برای دیدن تغییرات (آماده شدن سفارش، شارژ کیف پول، پیام جدید،
 * تغییر وضعیت) رفرش دستی بزند. تغییرات باید در لحظه (< ۲ ثانیه) در پنل ظاهر شوند.
 *
 * معماری:
 *  • In-memory pub/sub — هر کاربر یک Set اتصال SSE زنده + بافر حلقه‌ای رویدادها
 *    (برای بازیابی last-event-id بعد از قطعی/ری‌کانکت).
 *  • publishPanelEvent(userId, type, data) — تنها APIای که مسیرهای موجود
 *    (تحویل پرداخت، تولید برنامه، نوتیف، پاسخ تیکت، شارژ ادمین) صدا می‌زنند.
 *    بدون subscriber = فقط نوشتن در بافر (ارزان — یک push به آرایه).
 *  • امنیت: هیچ داده‌ای خارج از این ماژول به اتصال‌ها نوشته نمی‌شود؛ اتصال
 *    فقط از route با requireAuth ساخته می‌شود؛ سقف اتصال همزمان هر کاربر ۳.
 *  • حافظه: بافر هر کاربر حداکثر ۱۰۰ رویداد با TTL ۱۵ دقیقه؛ state کاربر بدون
 *    اتصالِ زنده و بدون رویدادِ تازه پاکسازی دوره‌ای می‌شود (ضد نشت حافظه).
 *  • هرگز throw نمی‌کند — شکست نوشتن فقط اتصالِ همان مشتری را می‌بندد.
 *
 * فرمت فریم SSE (سازگار با نمونهٔ سند مالک — evtSource.onmessage):
 *   id: 42
 *   data: {"type":"wallet_charged","amount":500000,"balance":750000,...}
 *
 */

const MAX_EVENTS_PER_USER = 100;
const EVENT_TTL_MS = 15 * 60 * 1000; // بازیابی پیام‌های ازدست‌رفته تا ۱۵ دقیقه
const MAX_CONNECTIONS_PER_USER = 3; // سند: هر کاربر حداکثر ۳ اتصال همزمان
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

export interface PanelEvent {
  /** شناسهٔ یکنوایت صعودی در محدودهٔ هر کاربر — برای Last-Event-ID */
  id: number;
  type: string;
  data: Record<string, unknown>;
  ts: number;
}

export interface PanelConnection {
  id: number;
  /** یک فریم SSE بنویس؛ false = کانال مرده (اتصال حذف می‌شود) */
  write: (frame: string) => boolean;
}

interface UserState {
  connections: Map<number, PanelConnection>;
  nextConnId: number;
  nextEventId: number;
  buffer: PanelEvent[];
}

// globalThis — مقاوم به HMR/دوبار import بین مسیرها (سینگلتون واقعی)
const g = globalThis as unknown as { __fitupPanelHub?: PanelHubState };

interface PanelHubState {
  users: Map<string, UserState>;
  pruneTimer: ReturnType<typeof setInterval> | null;
}

function hub(): PanelHubState {
  if (!g.__fitupPanelHub) {
    const state: PanelHubState = { users: new Map(), pruneTimer: null };
    state.pruneTimer = setInterval(() => pruneStale(state), PRUNE_INTERVAL_MS);
    // در محیط‌های تست/سرور تایمر نباید پروسه را نگه دارد
    (state.pruneTimer as unknown as { unref?: () => void }).unref?.();
    g.__fitupPanelHub = state;
  }
  return g.__fitupPanelHub;
}

function getUserState(state: PanelHubState, userId: string, create: boolean): UserState | null {
  let s = state.users.get(userId);
  if (!s && create) {
    s = { connections: new Map(), nextConnId: 1, nextEventId: 0, buffer: [] };
    state.users.set(userId, s);
  }
  return s ?? null;
}

function pruneStale(state: PanelHubState): void {
  const now = Date.now();
  try {
    for (const [userId, s] of state.users) {
      if (s.connections.size === 0) {
        // فقط رویدادهای تازه نگه داشته می‌شوند
        s.buffer = s.buffer.filter((e) => now - e.ts < EVENT_TTL_MS);
        if (s.buffer.length === 0) {
          state.users.delete(userId);
        }
      } else if (s.buffer.length > MAX_EVENTS_PER_USER) {
        s.buffer.splice(0, s.buffer.length - MAX_EVENTS_PER_USER);
      }
    }
  } catch {
    // پاکسازی هرگز نباید سرویس را بشکند
  }
}

// ────────────────────────────── اتصال‌ها ──────────────────────────────

/** تعداد اتصال‌های زندهٔ SSE یک کاربر (سقف ۳ — سند بخش امنیت) */
export function panelConnectionCount(userId: string): number {
  try {
    return hub().users.get(userId)?.connections.size ?? 0;
  } catch {
    return 0;
  }
}

/** ثبت اتصال جدید؛ false = سقف اتصال پر است */
export function panelConnect(userId: string, conn: PanelConnection): boolean {
  try {
    const state = hub();
    const s = getUserState(state, userId, true)!;
    if (s.connections.size >= MAX_CONNECTIONS_PER_USER) return false;
    s.connections.set(conn.id, conn);
    return true;
  } catch {
    return false;
  }
}

/** حذف اتصال (قطع کلاینت/خطا/تایم‌اوت) */
export function panelDisconnect(userId: string, connId: number): void {
  try {
    const state = hub();
    const s = state.users.get(userId);
    if (!s) return;
    s.connections.delete(connId);
    if (s.connections.size === 0 && s.buffer.length === 0) {
      state.users.delete(userId);
    }
  } catch {
    // بی‌صدا
  }
}

// ────────────────────────────── انتشار رویداد ──────────────────────────────

/**
 * انتشار یک رویداد زنده برای «فقط همان کاربر».
 * همیشه در بافر نوشته می‌شود (برای ری‌پلی last-event-id) و به همهٔ اتصال‌های
 * زندهٔ همان کاربر فرستاده می‌شود. هرگز throw نمی‌کند.
 */
export function publishPanelEvent(
  userId: string,
  type: string,
  data: Record<string, unknown> = {}
): void {
  try {
    if (!userId || typeof userId !== "string") return;
    const state = hub();
    const s = getUserState(state, userId, true);
    if (!s) return;

    const event: PanelEvent = {
      id: ++s.nextEventId,
      type: String(type).slice(0, 64),
      data,
      ts: Date.now(),
    };

    s.buffer.push(event);
    if (s.buffer.length > MAX_EVENTS_PER_USER) {
      s.buffer.splice(0, s.buffer.length - MAX_EVENTS_PER_USER);
    }

    if (s.connections.size === 0) return;

    const frame = serializeEvent(event);
    for (const [connId, conn] of s.connections) {
      let alive = false;
      try {
        alive = conn.write(frame);
      } catch {
        alive = false;
      }
      if (!alive) {
        s.connections.delete(connId);
      }
    }
  } catch {
    // انتشار رویداد هرگز نباید مسیر اصلی (پرداخت/تولید/…) را بشکند
  }
}

/** فریم استاندارد SSE — بدون فیلد event تا evtSource.onmessage مشتری‌ها بگیرد */
function serializeEvent(e: PanelEvent): string {
  const payload = JSON.stringify({ type: e.type, ...e.data, ts: e.ts });
  return `id: ${e.id}\ndata: ${payload}\n\n`;
}

// ────────────────────────────── بازیابی (last-event-id) ──────────────────────

/** رویدادهای بعد از lastEventId (بافر ۱۵ دقیقه‌ای) — برای ری‌پلی/پولینگ */
export function panelEventsAfter(userId: string, lastEventId: number): PanelEvent[] {
  try {
    const s = hub().users.get(userId);
    if (!s) return [];
    const now = Date.now();
    return s.buffer.filter((e) => e.id > lastEventId && now - e.ts < EVENT_TTL_MS);
  } catch {
    return [];
  }
}

/** آخرین شناسهٔ رویداد شناخته‌شدهٔ سرور برای کاربر (۰ = هیچ) */
export function panelLastEventId(userId: string): number {
  try {
    const s = hub().users.get(userId);
    return s?.nextEventId ?? 0;
  } catch {
    return 0;
  }
}
