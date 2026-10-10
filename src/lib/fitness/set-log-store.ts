/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  v148 — فروشگاه مشترک «ثبت ست» (سینک دوطرفهٔ تمرین امروز ↔ حالت باشگاه)
 * ═══════════════════════════════════════════════════════════════════════════
 *  دیرکتیو مالک:
 *    «فرقی نداره کاربر از تمرین امروز استفاده می‌کنه یا حالت باشگاه — در هر کدوم
 *     هر اطلاعاتی ثبت شد در اون یکی هم باید خودکار ثبت بشه و از لحاظ بصری هم
 *     دیده بشه که ثبت شده.»
 *
 *  تا امروز هر دو نما state جداگانه داشتند (تمرین امروز: state زودگذر؛ جیم‌مود:
 *  localStorage کلید gym_session_*) — تیک یک ست در یکی در دیگری دیده نمی‌شد.
 *  حالا هر دو نما از همین zustand store می‌خوانند/می‌نویسند:
 *    • سینک زنده: هر دو کامپوننت هم‌زمان مونت می‌شوند (جیم‌مود overlay روی تب
 *      تمرین‌هاست) — تغییر در یکی بلافاصله در دیگری re-render می‌شود.
 *    • ماندگاری: localStorage با debounce ۳۰۰ms + flush روی pagehide — مثل
 *      الگوی fitup_active_session در store.ts.
 *    • کلید روز: «YYYY-MM-DD تهران|نام روز» — هر دو نما روز را با نام انتخاب
 *      می‌کنند (شنبه، یکشنبه، ...) پس کلید بین‌نما پایدار است.
 *    • فلش بصری: lastSync (منبع + کلید روز) — نمای مقابل می‌تواند نشان
 *      «ثبت خودکار شد» را انیمیت کند.
 *
 *  خالص و client-only — هیچ I/O شبکه‌ای ندارد.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { create } from "zustand";
import { getTehranDayKey } from "./day";

/** منبع ثبت — برای فلش بصری «ثبت شد در نمای دیگر» */
export type SetLogSource = "gym_mode" | "today_workout";

/** لاگ یک روز مشخص: تیک ست‌ها + وزن‌ها + تکرارها (کلید: `${exId}_${setNumber}`) */
export interface DaySetLog {
  sets: Record<string, boolean>;
  weights: Record<string, string>;
  reps: Record<string, string>;
}

function emptyDayLog(): DaySetLog {
  return { sets: {}, weights: {}, reps: {} };
}

/** کلید روز مشترک دو نما — تاریخ تهران + نام روز برنامه (شنبه/یکشنبه/...) */
export function dayLogKey(dayName: string, d: Date = new Date()): string {
  return `${getTehranDayKey(d)}|${dayName}`;
}

interface SetLogState {
  /** همهٔ لاگ‌ها بر اساس کلید روز */
  days: Record<string, DaySetLog>;
  /** آخرین ثبت بین‌نما — برای فلش بصری در نمای مقابل */
  lastSync: {
    source: SetLogSource;
    dayKey: string;
    exId: string;
    setNumber: number;
    at: number;
  } | null;
  toggleSet: (dayKey: string, exId: string, setNumber: number, done: boolean, source: SetLogSource) => void;
  setWeight: (dayKey: string, exId: string, setNumber: number, value: string, source: SetLogSource) => void;
  setRep: (dayKey: string, exId: string, setNumber: number, value: string, source: SetLogSource) => void;
  getDayLog: (dayKey: string) => DaySetLog;
  /** ثبت دسته‌ای (مهاجرت دادهٔ قدیمی جیم‌مود) */
  importDayLog: (dayKey: string, log: Partial<DaySetLog>, source: SetLogSource) => void;
  /** پاک‌سازی روز (شروع از نو) */
  resetDay: (dayKey: string) => void;
  /** نمای مقابل بعد از دیدن فلش صدا می‌زند */
  clearSyncFlash: () => void;
}

export const useSetLogStore = create<SetLogState>((set, get) => ({
  days: {},
  lastSync: null,

  toggleSet: (dayKey, exId, setNumber, done, source) =>
    set((state) => {
      const prev = state.days[dayKey] ?? emptyDayLog();
      const key = `${exId}_${setNumber}`;
      const nextSets = { ...prev.sets };
      if (done) nextSets[key] = true;
      else delete nextSets[key];
      return {
        days: { ...state.days, [dayKey]: { ...prev, sets: nextSets } },
        lastSync: { source, dayKey, exId, setNumber, at: Date.now() },
      };
    }),

  setWeight: (dayKey, exId, setNumber, value, source) =>
    set((state) => {
      const prev = state.days[dayKey] ?? emptyDayLog();
      const key = `${exId}_${setNumber}`;
      const nextWeights = { ...prev.weights };
      if (value && value.trim()) nextWeights[key] = value;
      else delete nextWeights[key];
      return {
        days: { ...state.days, [dayKey]: { ...prev, weights: nextWeights } },
        lastSync: { source, dayKey, exId, setNumber, at: Date.now() },
      };
    }),

  setRep: (dayKey, exId, setNumber, value, source) =>
    set((state) => {
      const prev = state.days[dayKey] ?? emptyDayLog();
      const key = `${exId}_${setNumber}`;
      const nextReps = { ...prev.reps };
      if (value && value.trim()) nextReps[key] = value;
      else delete nextReps[key];
      return {
        days: { ...state.days, [dayKey]: { ...prev, reps: nextReps } },
        lastSync: { source, dayKey, exId, setNumber, at: Date.now() },
      };
    }),

  getDayLog: (dayKey) => get().days[dayKey] ?? emptyDayLog(),

  importDayLog: (dayKey, log, source) =>
    set((state) => {
      const prev = state.days[dayKey] ?? emptyDayLog();
      return {
        days: {
          ...state.days,
          [dayKey]: {
            sets: { ...prev.sets, ...(log.sets ?? {}) },
            weights: { ...prev.weights, ...(log.weights ?? {}) },
            reps: { ...prev.reps, ...(log.reps ?? {}) },
          },
        },
        // مهاجرت دادهٔ قدیمی → فلش بصری نمی‌خواهد، lastSync را دست نمی‌زنیم
        // (فقط اگر واقعاً خالی بود تا UI قبل از مهاجرت خالی نماند)
        lastSync: state.lastSync,
      };
    }),

  resetDay: (dayKey) =>
    set((state) => {
      const next = { ...state.days };
      delete next[dayKey];
      return { days: next };
    }),

  clearSyncFlash: () => set((state) => ({ lastSync: null })),
}));

/* ─────────────── ماندگاری در localStorage (الگوی store.ts) ─────────────── */

const SET_LOG_STORAGE_KEY = "fitup_set_log_v1";
const SET_LOG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // ۳ روز نگه‌داری (مثل پاکسازی جیم‌مود)

function persistSetLog(days: Record<string, DaySetLog>): void {
  if (typeof window === "undefined") return;
  try {
    // پاکسازی روزهای قدیمی (>۳ روز) تا حافظه رشد نکند
    const todayKey = getTehranDayKey();
    const fresh: Record<string, DaySetLog> = {};
    for (const [k, v] of Object.entries(days)) {
      const dateKey = k.split("|")[0];
      const diff = (new Date(`${todayKey}T00:00:00`).getTime() - new Date(`${dateKey}T00:00:00`).getTime()) / 86_400_000;
      if (Number.isFinite(diff) && diff <= 3) fresh[k] = v;
    }
    window.localStorage.setItem(SET_LOG_STORAGE_KEY, JSON.stringify({ days: fresh, savedAt: Date.now() }));
  } catch {
    // localStorage پر است یا غیرفعال — بی‌صدا رد شو
  }
}

/** بازیابی از localStorage — در mount هر نما (تمرین امروز / جیم‌مود) صدا زده می‌شود */
export function hydrateSetLogStore(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SET_LOG_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { days?: Record<string, DaySetLog>; savedAt?: number };
    if (!parsed?.days || typeof parsed.days !== "object") return;
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > SET_LOG_MAX_AGE_MS) {
      window.localStorage.removeItem(SET_LOG_STORAGE_KEY);
      return;
    }
    const clean: Record<string, DaySetLog> = {};
    for (const [k, v] of Object.entries(parsed.days)) {
      if (v && typeof v === "object" && typeof v.sets === "object" && v.sets !== null) {
        clean[k] = {
          sets: v.sets ?? {},
          weights: v.weights ?? {},
          reps: v.reps ?? {},
        };
      }
    }
    useSetLogStore.setState({ days: clean });
  } catch {
    // دادهٔ خراب — بی‌صدا رد شو
  }
}

if (typeof window !== "undefined") {
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistSetLog(useSetLogStore.getState().days);
    }, 300);
  };

  const flushNow = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistSetLog(useSetLogStore.getState().days);
  };

  useSetLogStore.subscribe((state, prev) => {
    if (state.days !== prev.days) schedulePersist();
  });

  window.addEventListener("pagehide", flushNow);
  window.addEventListener("beforeunload", flushNow);

  /* ─────────── v215 — سینک ماندگار سرور (دیرکتیو مالک) ───────────
   * تا v215 وزنه‌ها فقط ۳ روز در localStorage می‌ماندند و «پیشرفت قدرتی
   * هر حرکت» برای پروندهٔ AI غیرقابل‌محاسبه بود. حالا هر تغییر، به‌صورت
   * debounce ۲s به /api/workout/set-log (batch-upsert idempotent) سینک
   * می‌شود — fire-and-forget: شکست شبکه هرگز تجربهٔ تمرین را نمی‌شکند و
   * ثبت بعدی دوباره همهٔ روزهای fresh را می‌فرستد (خودترمیم).
   */
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncInFlight = false;
  let hasPendingChanges = false;

  const collectFreshEntries = () => {
    const days = useSetLogStore.getState().days;
    const todayKey = getTehranDayKey();
    const out: Array<{ dayKey: string; entries: Array<{ exerciseId: string; setNumber: number; done: boolean; weight?: string; reps?: string }> }> = [];
    for (const [k, v] of Object.entries(days)) {
      const dateKey = k.split("|")[0];
      const diff = (new Date(`${todayKey}T00:00:00`).getTime() - new Date(`${dateKey}T00:00:00`).getTime()) / 86_400_000;
      if (!Number.isFinite(diff) || diff > 3) continue;
      const keys = new Set([...Object.keys(v.sets), ...Object.keys(v.weights), ...Object.keys(v.reps)]);
      const entries: Array<{ exerciseId: string; setNumber: number; done: boolean; weight?: string; reps?: string }> = [];
      for (const key of keys) {
        const idx = key.lastIndexOf("_");
        if (idx <= 0) continue;
        const exerciseId = key.slice(0, idx);
        const setNumber = Number(key.slice(idx + 1));
        if (!exerciseId || !Number.isFinite(setNumber) || setNumber < 1) continue;
        entries.push({
          exerciseId,
          setNumber,
          done: v.sets[key] === true,
          weight: v.weights[key],
          reps: v.reps[key],
        });
      }
      if (entries.length > 0) out.push({ dayKey: k, entries: entries.slice(0, 120) });
    }
    return out;
  };

  const pushSetLogToServer = async () => {
    if (syncInFlight) {
      hasPendingChanges = true;
      return;
    }
    syncInFlight = true;
    try {
      for (const chunk of collectFreshEntries()) {
        // fire-and-forget با timeout ۸s — خطا ساکت (ثبت بعدی خودترمیم می‌کند)
        await fetch("/api/workout/set-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(8000),
        }).catch(() => undefined);
      }
      hasPendingChanges = false;
    } finally {
      syncInFlight = false;
    }
  };

  const scheduleSync = () => {
    hasPendingChanges = true;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void pushSetLogToServer().then(() => {
        // اگر وسط سینک تغییر جدید آمد — یک دور دیگر
        if (hasPendingChanges) scheduleSync();
      });
    }, 2000);
  };

  useSetLogStore.subscribe((state, prev) => {
    if (state.days !== prev.days) scheduleSync();
  });

  // سینک روی خروج صفحه هم flush می‌شود (sendBeacon امن‌تر است؛ fallback fetch keepalive)
  const flushSyncNow = () => {
    if (!hasPendingChanges && !syncInFlight) {
      // اگر تغییر تازه‌ای نبود ولی دادهٔ unflushed محلی هست، باقی‌ماندهٔ debounce قبلی را هم بفرست
      if (!syncTimer) return;
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    try {
      const payload = collectFreshEntries();
      for (const chunk of payload) {
        const body = JSON.stringify(chunk);
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/workout/set-log", new Blob([body], { type: "application/json" }));
        } else {
          fetch("/api/workout/set-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body,
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    } catch {
      // ساکت — دفعهٔ بعد
    }
  };
  window.addEventListener("pagehide", flushSyncNow);
}
