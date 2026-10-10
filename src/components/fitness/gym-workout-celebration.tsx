"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  v148 — جشن بزرگ «تمرین امروز کامل شد» (مخصوص حالت باشگاه)
 * ═══════════════════════════════════════════════════════════════════════════
 *  دیرکتیو مالک: «وقتی آخرین تیک ست آخر زده شد یک مدل خیلی خیلی جذاب نشون بده»
 *
 *  • بک‌دراپ تیرهٔ گرم با بلور + گرادیان شعاعی
 *  • کانفتی چندموجی (نارنجی/کهربایی/زمرّدی/طلایی) با canvas-confetti
 *  • 🏆 با ورود فنری + هالهٔ نور + شنا‌ی آرام
 *  • آمار متحرک: تعداد کل ست‌ها، حجم کل (وزنه×تکرار)، مدت تقریبی
 *  • CTA «عالی بود! 💪» — بعد از بستنش، مدال روز کامل (DailyMedalCelebration)
 *    در والد باز می‌شود (زنجیرهٔ جشن، بدون هم‌پوشانی)
 *
 *  client-only — canvas-confetti به‌صورت داینامیک import می‌شود (کوچک‌تر بودن
 *  باندل اولیه، همان الگوی activity-client).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Crown } from "lucide-react";
import { toPersianDigits } from "@/lib/fitness/types";

const CONFETTI_COLORS = ["#f97316", "#f59e0b", "#fbbf24", "#10b981", "#fde68a", "#ffffff"];

/**
 * جمله‌های زیر تیتر — در هر مونت یکی انتخاب می‌شود
 * v168 — اگر نام کاربر/روز تمرین موجود باشد، جملهٔ شخصی‌سازی‌شده برنده است
 */
const MOTIVATIONAL_SUB_LINES = [
  "هر ست، یک قدم به نسخهٔ قوی‌تر خودت بود. افتخار می‌کنم! 🔥",
  "امروز رو تمام و کمال تمام کردی — بدنت همین حالا داره قوی‌تر می‌شه! 💯",
  "انضباط یعنی همین لحظه: آخرین ست هم زده شد. دست مریزاد! ⚡",
  "سخت‌ترین قسمت، تیک آخر بود — و تو زدیش. تو برندهٔ امروزی! 🏆",
  "ثباتِ هفته‌هاست که بدن رو عوض می‌کنه — و تو امروز یک قدم دیگه برداشتی. 🚀",
];

/** شمارندهٔ متحرک (ease-out cubic) برای آمار جشن */
function useCountUp(target: number, active: boolean, durationMs = 1300): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active || !Number.isFinite(target)) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, durationMs]);
  return active ? value : 0;
}

function formatGroupedPersian(n: number): string {
  const grouped = Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return toPersianDigits(grouped);
}

export function GymWorkoutCelebration({
  open,
  onClose,
  totalSets,
  totalVolume,
  durationMin,
  calories,
  bestWeightKg,
  userName,
  dayTitle,
  exerciseCount,
  planCta,
}: {
  open: boolean;
  onClose: () => void;
  /** تعداد کل ست‌های ثبت‌شدهٔ روز */
  totalSets: number;
  /** حجم کل وزنه×تکرار — null یعنی هیچ ورودی وزنه/تکراری موجود نبود → «—» */
  totalVolume: number | null;
  /** مدت تقریبی جلسه بر حسب دقیقه — null یعنی زمان شروع ثبت نشده → «—» */
  durationMin: number | null;
  /** v168 — کالری تخمینی (جشن جلسهٔ هدایت‌شده) — null یعنی موجود نیست */
  calories?: number | null;
  /** v168 — سنگین‌ترین وزنهٔ ثبت‌شدهٔ روز (بهترین ست) — null یعنی موجود نیست */
  bestWeightKg?: number | null;
  /** v168 — نام کوچک کاربر برای تیتر شخصی‌سازی‌شده */
  userName?: string | null;
  /** v168 — عنوان روز تمرین («پوش / پول — بالاتنه») */
  dayTitle?: string | null;
  /** v168 — تعداد حرکات روز */
  exerciseCount?: number | null;
  /**
   * v191 (دیرکتیو مالک) — CTA «خرید برنامهٔ اختصاصی» در جشن پایان چالش —
   * جذاب و تو‌چشم، بین آمار و دکمهٔ بستن. onClick والد ناوبری به پلن‌ها را انجام می‌دهد.
   */
  planCta?: {
    headline: string;
    body: string;
    button: string;
    onClick: () => void;
  } | null;
}) {
  const [subLine] = useState(
    () => MOTIVATIONAL_SUB_LINES[Math.floor(Math.random() * MOTIVATIONAL_SUB_LINES.length)]
  );
  // نام کوچک — فقط کلمهٔ اول نام («محمد رضایی» → «محمد»)
  const firstName = (userName ?? "").trim().split(/\s+/)[0] || null;

  const animatedSets = useCountUp(totalSets, open);
  const animatedVolume = useCountUp(totalVolume ?? 0, open);

  // ─── کانفتی چندموجی — فقط هنگام باز شدن ───
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      const burst = (opts: Parameters<typeof confetti>[0]) => {
        try {
          // zIndex بالاتر از اورلی جشن (z-[100]) و پایین‌تر از مدال (z-[120])
          confetti({ disableForReducedMotion: true, zIndex: 110, colors: CONFETTI_COLORS, ...opts });
        } catch {}
      };
      // موج ۱ — انفجار مرکزی
      burst({ particleCount: 130, spread: 100, startVelocity: 45, origin: { y: 0.4 } });
      // موج ۲ — بارش از بالا
      timers.push(
        setTimeout(() => {
          burst({ particleCount: 90, spread: 130, startVelocity: 35, origin: { y: 0.25 }, scalar: 1.1 });
        }, 450)
      );
      // موج ۳ — توپ‌های دو طرف (به سمت مرکز)
      timers.push(
        setTimeout(() => {
          burst({ particleCount: 60, angle: 60, spread: 65, startVelocity: 50, origin: { x: 0.02, y: 0.72 } });
          burst({ particleCount: 60, angle: 120, spread: 65, startVelocity: 50, origin: { x: 0.98, y: 0.72 } });
        }, 900)
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      try {
        void import("canvas-confetti").then(({ default: confetti }) => confetti.reset());
      } catch {}
    };
  }, [open]);

  // ─── Escape برای بستن ───
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="gym-finale"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="جشن تکمیل تمرین"
        >
          {/* بک‌دراپ تیرهٔ گرم + بلور */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(1100px 750px at 50% -12%, rgba(194,65,12,0.55), rgba(41,26,13,0.94) 55%, rgba(10,8,5,0.97))",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
            }}
          />

          {/* کارت جشن */}
          <motion.div
            initial={{ scale: 0.82, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="relative w-full max-w-sm rounded-[2rem] border border-amber-400/25 overflow-hidden text-center"
            style={{
              background: "linear-gradient(180deg, rgba(69,26,3,0.92), rgba(28,20,10,0.96) 60%, rgba(12,9,5,0.98))",
              boxShadow: "0 30px 80px -20px rgba(249,115,22,0.45), inset 0 1px 0 rgba(255,237,213,0.12)",
            }}
          >
            {/* هاله‌های تزئینی */}
            <div className="pointer-events-none absolute -top-16 -right-10 w-44 h-44 rounded-full bg-orange-500/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-14 -left-10 w-40 h-40 rounded-full bg-amber-400/20 blur-3xl" />

            <div className="relative p-6 pt-7">
              {/* 🏆 — ورود فنری + هالهٔ نور + شنا */}
              <motion.div
                initial={{ scale: 0, rotate: -35, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
                className="relative mx-auto w-fit"
              >
                <motion.div
                  animate={{ opacity: [0.45, 0.8, 0.45], scale: [1, 1.12, 1] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -inset-7 rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(251,191,36,0.4), transparent 70%)" }}
                />
                <motion.div
                  animate={{ y: [0, -9, 0], rotate: [-4, 4, -4] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                  className="relative text-7xl leading-none select-none"
                  style={{ filter: "drop-shadow(0 12px 28px rgba(251,191,36,0.55))" }}
                >
                  🏆
                </motion.div>
              </motion.div>

              {/* تیتر + زیرنویس — v168 شخصی‌سازی‌شده با نام کاربر */}
              <motion.h2
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, type: "spring", stiffness: 320, damping: 24 }}
                className="mt-4 text-2xl font-black text-white"
              >
                {firstName ? `ایول ${firstName}! تمرین امروز کامل شد 🎉` : "تمرین امروز کامل شد! 🎉"}
              </motion.h2>
              {/* چیپ روز تمرین — v168 */}
              {(dayTitle || (exerciseCount ?? 0) > 0) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.45 }}
                  className="mt-2.5 flex items-center justify-center gap-1.5 flex-wrap"
                >
                  {dayTitle && (
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-amber-100">
                      {dayTitle}
                    </span>
                  )}
                  {(exerciseCount ?? 0) > 0 && (
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-amber-100">
                      {toPersianDigits(exerciseCount ?? 0)} حرکت
                    </span>
                  )}
                </motion.div>
              )}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.4 }}
                className="mt-2.5 text-[13px] leading-relaxed text-amber-100/80"
              >
                {subLine}
              </motion.p>

              {/* آمار متحرک — v168: ۲×۲ (ست‌ها، حجم، مدت، کالری/بهترین ست) */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, type: "spring", stiffness: 280, damping: 24 }}
                className="mt-5 grid grid-cols-2 gap-2"
              >
                <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3">
                  <p className="text-xl font-black text-amber-300 leading-none tabular-nums">
                    {toPersianDigits(Math.round(animatedSets))}
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold text-amber-100/60">تعداد کل ست‌ها</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3">
                  <p className="text-xl font-black text-amber-300 leading-none tabular-nums">
                    {totalVolume === null ? "—" : formatGroupedPersian(animatedVolume)}
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold text-amber-100/60">حجم کل (کیلوگرم)</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3">
                  <p className="text-xl font-black text-amber-300 leading-none tabular-nums">
                    {durationMin === null ? "—" : toPersianDigits(durationMin)}
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold text-amber-100/60">مدت تقریبی (دقیقه)</p>
                </div>
                {calories != null ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3">
                    <p className="text-xl font-black text-amber-300 leading-none tabular-nums">
                      {toPersianDigits(calories)}
                    </p>
                    <p className="mt-1.5 text-[10px] font-bold text-amber-100/60">کالری سوزانده</p>
                  </div>
                ) : bestWeightKg != null ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3">
                    <p className="text-xl font-black text-amber-300 leading-none tabular-nums">
                      {toPersianDigits(bestWeightKg)}
                    </p>
                    <p className="mt-1.5 text-[10px] font-bold text-amber-100/60">بهترین ست (کیلوگرم)</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3">
                    <p className="text-xl font-black text-amber-300 leading-none">🔥</p>
                    <p className="mt-1.5 text-[10px] font-bold text-amber-100/60">عالی درخشیدی</p>
                  </div>
                )}
              </motion.div>

              {/* بهترین ست — v168 خط شخصی‌سازی (وقتی کالری جای آن را گرفته) */}
              {calories != null && bestWeightKg != null && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8 }}
                  className="mt-3 text-[11px] font-bold text-amber-200/90"
                >
                  🏋️ بهترین ست امروز: {toPersianDigits(bestWeightKg)} کیلوگرم
                </motion.p>
              )}

              {/* ─── v191 — CTA «خرید برنامهٔ اختصاصی» — جذاب و تو‌چشم (دیرکتیو مالک) ─── */}
              {planCta && (
                <motion.div
                  initial={{ opacity: 0, y: 18, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 1.05, type: "spring", stiffness: 240, damping: 20 }}
                  className="mt-5"
                >
                  {/* کارت با حاشیهٔ گرادیانی متحرک + هالهٔ نورانی */}
                  <div
                    className="relative rounded-3xl p-[2px] overflow-hidden"
                    style={{
                      background:
                        "linear-gradient(135deg, #fbbf24, #f97316, #fbbf24, #10b981, #fbbf24)",
                      backgroundSize: "300% 300%",
                      animation: "planCtaBorder 5s ease infinite",
                      boxShadow: "0 18px 44px -12px rgba(249, 115, 22, 0.65)",
                    }}
                  >
                    <div
                      className="relative rounded-[22px] px-4 py-4 text-right overflow-hidden"
                      style={{ background: "linear-gradient(160deg, rgba(28,20,10,0.98), rgba(69,26,3,0.94))" }}
                    >
                      {/* هاله‌های داخلی */}
                      <div className="pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full bg-amber-400/20 blur-2xl" />
                      <div className="pointer-events-none absolute -bottom-10 -left-6 w-24 h-24 rounded-full bg-orange-500/20 blur-2xl" />

                      <div className="relative flex items-start gap-3">
                        <motion.div
                          animate={{ scale: [1, 1.08, 1] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
                          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                        >
                          <Crown className="w-5 h-5 text-white" />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-[13px] sm:text-sm text-white leading-snug">
                            {planCta.headline}
                          </p>
                          <p className="text-[10.5px] text-amber-100/75 leading-relaxed mt-1">
                            {planCta.body}
                          </p>
                          <motion.button
                            type="button"
                            onClick={planCta.onClick}
                            whileTap={{ scale: 0.96 }}
                            animate={{
                              boxShadow: [
                                "0 10px 26px -8px rgba(251,191,36,0.7)",
                                "0 10px 34px -6px rgba(251,191,36,0.95)",
                                "0 10px 26px -8px rgba(251,191,36,0.7)",
                              ],
                            }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                            className="mt-3 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-black text-orange-950 active:scale-[0.98] transition"
                            style={{ background: "linear-gradient(135deg, #fde68a, #fbbf24)" }}
                          >
                            <Sparkles className="w-4 h-4" />
                            {planCta.button}
                          </motion.button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* CTA */}
              <motion.button
                type="button"
                onClick={onClose}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85, type: "spring", stiffness: 300, damping: 22 }}
                whileTap={{ scale: 0.96 }}
                className="mt-6 w-full min-h-[48px] rounded-2xl text-white text-sm font-black active:scale-[0.98] transition"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  boxShadow: "0 14px 34px -8px rgba(249, 115, 22, 0.6)",
                }}
              >
                عالی بود! 💪
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
