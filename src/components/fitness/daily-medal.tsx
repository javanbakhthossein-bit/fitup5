"use client";

/**
 * ═══════════════════════════════════════════════════════════════
 *  Task 3-b — مدال مشترک «روز کامل» (تمرین + تغذیه)
 *
 *  یک سکشن مشترک برای هر دو مسیر: حالت باشگاه/جلسهٔ هدایت‌شده که تمرین را
 *  کامل می‌کند و کالری‌شمار که تغذیه را — تکمیلِ هر مسیر به‌طور خودکار در
 *  مسیر دیگر ثبت می‌شود (DayCompletion سمت سرور) و وقتی «روز کامل» شد،
 *  مدال طلایی روز در همهٔ بخش‌ها دیده می‌شود.
 *
 *  الگوی ضدلگ v50/v51 (مطابق app-update-modal):
 *   - createPortal روی document.body + pointerEvents:auto
 *   - بدون backdrop-blur و بدون repeat:Infinity (انیمیشن ذرات یک‌بار)
 *   - ورود spring و قفل اسکرول با useScrollLock
 * ═══════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, PartyPopper } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { useScrollLock } from "@/hooks/use-scroll-lock";

/** گرادیان طلایی — هم‌خانوادهٔ تبریک پایان تمرین (بدون آبی/ایندیگو) */
const GOLD_GRADIENT = "linear-gradient(135deg, #fbbf24, #f59e0b, #f97316)";

// ─────────────────────────────────────────────────────────────
//  کمکی‌های سینک سرور (مشترک بین جیم‌مود / جلسهٔ هدایت‌شده / تغذیه / داشبورد)
// ─────────────────────────────────────────────────────────────

export interface DailyStatusApiResponse {
  date: string;
  workoutDone: boolean;
  nutritionDone: boolean;
  workoutSource?: string | null;
  dayComplete: boolean;
  medalSeenAt: string | null;
  last7?: { date: string; workoutDone: boolean; nutritionDone: boolean; dayComplete: boolean }[];
}

export type DailyStatusPostBody =
  | { workout: { done: true; source: "gym_mode" | "guided_session" } }
  | { nutrition: { done: boolean; calories?: number; target?: number } }
  | { medalSeen: true }
  | { workout: { done: true; source: "gym_mode" | "guided_session" }; medalSeen: true }
  | { nutrition: { done: boolean; calories?: number; target?: number }; medalSeen: true };

/**
 * POST /api/daily-status — ثبت وضعیت روز + ادغام پاسخ در store.
 * هر خطا بی‌صدا null برمی‌گرداند (هیچ‌وقت تجربهٔ کاربر را خراب نمی‌کند).
 */
export async function reportDailyStatus(
  payload: DailyStatusPostBody
): Promise<DailyStatusApiResponse | null> {
  try {
    const r = await fetch("/api/daily-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (!r.ok) return null;
    const data = (await r.json()) as DailyStatusApiResponse;
    useAppStore.getState().applyDailyStatusUpdate({
      date: typeof data?.date === "string" ? data.date : null,
      workoutDone: !!data?.workoutDone,
      nutritionDone: !!data?.nutritionDone,
      dayComplete: !!data?.dayComplete,
      medalSeenAt: typeof data?.medalSeenAt === "string" ? data.medalSeenAt : null,
    });
    return data;
  } catch {
    return null;
  }
}

/** گارد ماژول‌سطح: مدالِ هر روز فقط یک‌بار به‌طور خودکار باز شود (حتی بین دو ویو) */
let medalAutoCelebratedDate: string | null = null;

/**
 * درخواست «باز کردن جشن مدال» — فقط اولین درخواستِ هر روز قبول می‌شود.
 * true → تماس‌گیرنده اجازه دارد جشن را باز کند.
 */
export function claimMedalCelebration(dateKey: string | null | undefined): boolean {
  const key = dateKey || "";
  if (!key || medalAutoCelebratedDate === key) return false;
  medalAutoCelebratedDate = key;
  return true;
}

/**
 * ثبت «مدال دیده شد» — از داخل DailyMedalCelebration هنگام بستن صدا زده می‌شود؛
 * گارد سمت کلاینت (dayComplete + medalSeenAt خالی) POSTهای بی‌مورد را حذف می‌کند.
 */
export function notifyMedalSeen(): void {
  void (async () => {
    const st = useAppStore.getState();
    if (!st.dailyStatus.dayComplete || st.dailyStatus.medalSeenAt) return;
    await reportDailyStatus({ medalSeen: true });
  })();
}

// ─────────────────────────────────────────────────────────────
//  بج کوچک مدال (اینلاین در هدر سکشن‌ها)
// ─────────────────────────────────────────────────────────────

export function DailyMedalBadge({
  size = "md",
  onClick,
}: {
  size?: "sm" | "md";
  onClick?: () => void;
}) {
  const isSm = size === "sm";
  return (
    <button
      type="button"
      onClick={onClick}
      title="امروز هم تمرینت رو کامل کردی و تغذیه‌ات در ریل هدفه 🏆"
      aria-label="مدال روز کامل — تمرین و تغذیه امروز کامل شده است"
      className={`group inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-gradient-to-l from-amber-50 via-white to-amber-50 shadow-sm hover:shadow-md active:scale-95 transition-all shrink-0 ${
        isSm ? "py-0.5 pl-2 pr-0.5" : "py-1 pl-2.5 pr-1"
      }`}
    >
      <span
        className={`rounded-full flex items-center justify-center shrink-0 shadow-inner ${
          isSm ? "w-5 h-5" : "w-6 h-6"
        }`}
        style={{ background: GOLD_GRADIENT }}
      >
        <Trophy
          className={isSm ? "w-3 h-3 text-white" : "w-3.5 h-3.5 text-white"}
          fill="currentColor"
        />
      </span>
      <span
        className={`font-black text-amber-700 whitespace-nowrap leading-none ${
          isSm ? "text-[10px]" : "text-xs"
        }`}
      >
        روز کامل ✨
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  مودال جشن مدال — تمام‌صفحه، portal روی body
// ─────────────────────────────────────────────────────────────

export function DailyMedalCelebration({
  open,
  onClose,
  stats,
}: {
  open: boolean;
  onClose: () => void;
  /** آمار اختیاری برای گرید کوچک زیر subtitle (مثلاً ست‌ها / کالری / مصرف امروز) */
  stats?: { label: string; value: string }[];
}) {
  useScrollLock(open);

  // ذرات جشن — یک‌بار به بیرون می‌پرند (بدون repeat:Infinity — قانون ضدلگ)
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.25;
        const dist = 90 + ((i * 37) % 60);
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          size: 5 + (i % 3) * 3,
          delay: 0.15 + (i % 5) * 0.05,
          color: i % 3 === 0 ? "#fbbf24" : i % 3 === 1 ? "#f59e0b" : "#f97316",
        };
      }),
    []
  );

  // فقط سمت کلاینت portal می‌سازیم (الگوی app-update-modal)
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          style={{ pointerEvents: "auto" }}
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="مدال روز کامل"
        >
          <div className="absolute inset-0 bg-black/60" />
          <motion.div
            initial={{ scale: 0.9, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 14, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 300 }}
            className="relative w-full max-w-sm rounded-3xl bg-white border border-amber-200 shadow-2xl p-6 text-center overflow-hidden"
          >
            {/* هالهٔ طلایی پس‌زمینه (استاتیک — بدون انیمیشن بی‌پایان) */}
            <div
              aria-hidden
              className="absolute -top-16 -right-14 w-44 h-44 rounded-full blur-3xl opacity-20"
              style={{ background: "#f59e0b" }}
            />
            <div
              aria-hidden
              className="absolute -bottom-16 -left-12 w-40 h-40 rounded-full blur-3xl opacity-15"
              style={{ background: "#f97316" }}
            />

            {/* مدال طلایی + ذرات جشن */}
            <div className="relative w-fit mx-auto mb-4">
              {/* ذرات — یک‌بار به بیرون انیمیت می‌شوند */}
              {particles.map((p) => (
                <motion.span
                  key={p.id}
                  aria-hidden
                  className="absolute rounded-full left-1/2 top-1/2 pointer-events-none"
                  style={{ width: p.size, height: p.size, background: p.color }}
                  initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
                  animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.9, delay: p.delay, ease: "easeOut" }}
                />
              ))}
              <motion.div
                initial={{ scale: 0, rotate: -14 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 11, stiffness: 240, delay: 0.08 }}
                className="w-24 h-24 mx-auto rounded-full flex items-center justify-center shadow-xl shadow-amber-500/40 ring-4 ring-amber-200/70"
                style={{ background: GOLD_GRADIENT }}
              >
                <Trophy className="w-12 h-12 text-white" fill="currentColor" />
              </motion.div>
            </div>

            <h3 className="text-xl font-black text-slate-900">مدال روز کامل گرفت! 🏆</h3>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
              هم تمرین امروزت رو کامل کردی هم تغذیه‌ات در ریل هدفه — عالی پیش می‌ری! 💪
            </p>

            {/* گرید آمار اختیاری */}
            {stats && stats.length > 0 && (
              <div
                className={`grid gap-2.5 mt-5 ${
                  stats.length >= 4 ? "grid-cols-2" : "grid-cols-2"
                }`}
              >
                {stats.slice(0, 4).map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl bg-amber-50 border border-amber-100 p-3"
                  >
                    <p className="text-sm font-black text-slate-900">{s.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                // ثبت «مدال دیده شد» — فقط برای روزِ کامل و فقط بار اول (گارد داخل)
                notifyMedalSeen();
              }}
              className="w-full mt-5 rounded-xl h-12 text-sm font-black text-white shadow-lg shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] transition inline-flex items-center justify-center gap-2"
              style={{ background: GOLD_GRADIENT }}
            >
              <PartyPopper className="w-4 h-4" />
              عالیه!
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** هوک کوچک: بارگذاری یک‌بارهٔ وضعیت روز (GET /api/daily-status) در mount */
export function useDailyStatusLoader(): void {
  useEffect(() => {
    const st = useAppStore.getState();
    if (!st.dailyStatus.loaded) void st.loadDailyStatus();
  }, []);
}
