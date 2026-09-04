"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Timer,
  Dumbbell,
  Flame,
  Trophy,
  Volume2,
  Video,
  Lock,
  AlertTriangle,
  PartyPopper,
  Info,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canAccess, toPersianDigits, PERSIAN_WEEKDAYS, type PlanExercise } from "@/lib/fitness/types";
import { toast } from "sonner";

/** تایمر جلسه — کامپوننت ایزوله: تیکِ هر ثانیه فقط این خط را re-render می‌کند،
 *  نه کل صفحه تمرین (عامل اصلی «لگ» در حالت فعال بود: هر ثانیه همه‌ی
 *  inputها و کارت‌ها دوباره رندر می‌شدند). onElapsed فقط یک ref را
 *  به‌روز می‌کند (بدون re-render والد) تا در finish() مدت واقعی در دسترس باشد. */
const SessionTimer = memo(function SessionTimer({
  startedAt,
  onElapsed,
}: {
  startedAt: string;
  onElapsed: (seconds: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      setElapsed(s);
      onElapsed(s);
    }, 1000);
    return () => clearInterval(t);
  }, [startedAt, onElapsed]);
  const m = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return (
    <>
      <Timer className="w-4 h-4 text-primary" />
      {toPersianDigits(m.toString().padStart(2, "0"))}:{toPersianDigits(sec.toString().padStart(2, "0"))}
    </>
  );
});

export function ActiveWorkoutSession() {
  const { activeSession, workoutPlan, endSession, logSet, setMainTab, user, setExerciseDetailId, setOverlay, setCaloriesBurned } = useAppStore();
  const [restTimer, setRestTimer] = useState<{ remaining: number; total: number } | null>(null);
  // آمار تمرینِ تمام‌شده — تبریک وسط صفحه (درخواست مالک: نه toast بالای صفحه)
  const [finishedStats, setFinishedStats] = useState<{ minutes: number; burned: number; setsDone: number } | null>(null);
  // تأیید خروج با دیالوگ درون‌برنامه‌ای — confirm() مرورگر در WebView/PWA/iframe
  // مسدود است و کاربر عملاً گیر می‌کرد و نمی‌توانست از جلسه خارج شود.
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // مدت‌گذشته‌ی جلسه بدون re-render (برای محاسبه کالری در finish)
  const elapsedRef = useRef(0);
  const onElapsed = useState(() => (s: number) => { elapsedRef.current = s; })[0];

  // قفل اسکرول صفحه پشت جلسه‌ی تمام‌صفحه (iOS rubber-band / اسکرول پنهان)
  useScrollLock(!!activeSession);

  // User plan capabilities — fullExerciseLibrary requires Advanced+ plan
  const canViewVideos = canAccess(user?.planName ?? null, "fullExerciseLibrary");

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  };

  // session timer — در کامپوننت ایزوله SessionTimer (بالا) تا هر ثانیه فقط
  // همان re-render شود؛ اینجا دیگر setInterval نداریم.

  // rest countdown
  useEffect(() => {
    if (!restTimer) return;
    if (restTimer.remaining <= 0) {
      beep();
      const t = setTimeout(() => setRestTimer(null), 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setRestTimer((p) => (p ? { ...p, remaining: p.remaining - 1 } : null));
    }, 1000);
    return () => clearTimeout(t);
  }, [restTimer]);

  if (!activeSession || !workoutPlan) return null;

  // ─── اعتبارسنجی جلسه در برابر برنامه فعلی ───
  // اگر برنامه regenerate شده و روز جلسه دیگر در آن نیست (یا بدون حرکت است)،
  // جلسه را می‌بندیم تا رندر کرش نکند — قبلاً exercises[idx] روی undefined
  // crash می‌کرد و «تلاش مجدد» در ViewErrorBoundary حلقه crash می‌ساخت.
  const sessionDay = workoutPlan.days?.find((d) => d.day === activeSession.dayId);
  if (!sessionDay || !sessionDay.exercises?.length) {
    return <InvalidSessionCleanup onEnd={endSession} />;
  }
  const day = sessionDay;
  const exercises = day.exercises;
  // clamp ایندکس restore‌شده — برنامه جدید ممکن است حرکات کمتری داشته باشد
  const idx = Math.min(Math.max(0, activeSession.currentExerciseIdx), exercises.length - 1);
  const exercise = exercises[idx];
  const isLast = idx >= exercises.length - 1;
  const allDone = exercises.every((_, i) => {
    const ex = exercises[i];
    const sets = activeSession.loggedSets[ex.id] || [];
    return sets.filter((s) => s?.done).length >= ex.sets.length;
  });

  function completeSet(setNumber: number, restSec: number, weight: number, reps: number) {
    logSet(exercise.id, setNumber, weight || 0, reps || 0);
    if (restSec > 0) {
      setRestTimer({ remaining: restSec, total: restSec });
    } else {
      beep();
    }
    toast.success(`ست ${toPersianDigits(setNumber)} تکمیل شد! 💪`);
  }

  function finish() {
    // Estimate calories burned: MET × weight × hours
    // Average weightlifting MET ≈ 6.0
    // وزن واقعی کاربر از store (FE-H7 — از داده‌های progress/checkup پر می‌شود)؛
    // فقط در نبود داده به ۷۵ کیلو fallback می‌کنیم (قبلاً ۷۵ هاردکد بود)
    const minutes = Math.max(1, Math.round(elapsedRef.current / 60));
    const weightKg = useAppStore.getState().lastKnownWeightKg ?? 75;
    const met = 6.0;
    const burned = Math.round(met * weightKg * (minutes / 60));
    setCaloriesBurned(burned);
    // تعداد ست‌های انجام‌شده‌ی این جلسه (برای نمایش در تبریک)
    const session = useAppStore.getState().activeSession;
    const setsDone = session
      ? exercises.reduce(
          (sum, ex) => sum + ((session.loggedSets[ex.id] || []).filter((s) => s?.done).length),
          0
        )
      : 0;
    // تبریک وسط صفحه — جلسه فعلاً باز می‌ماند تا کاربر آمار را ببیند؛
    // با دکمه «بازگشت به داشبورد» جلسه بسته می‌شود (endSession).
    setFinishedStats({ minutes, burned, setsDone });
  }

  /** بستن تبریک → پایان واقعی جلسه و بازگشت به داشبورد */
  function closeCelebration() {
    setFinishedStats(null);
    endSession();
    setMainTab("dashboard");
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background flex flex-col"
    >
      {/* Top bar — پس‌زمینه solid (بدون backdrop-blur: عامل لگ روی موبایل) */}
      <div className="flex items-center justify-between p-4 bg-white border-b border-border/60">
        <button
          onClick={() => setShowExitConfirm(true)}
          className="p-2 rounded-xl hover:bg-muted transition"
          aria-label="خروج از تمرین"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{day.title}</p>
          <p className="font-bold text-sm flex items-center gap-1.5 justify-center font-stat">
            <SessionTimer startedAt={activeSession.startedAt} onElapsed={onElapsed} />
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">حرکت</p>
          <p className="font-bold text-sm">{toPersianDigits(idx + 1)} / {toPersianDigits(exercises.length)}</p>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5 p-3 justify-center">
        {exercises.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? "w-8 bg-primary" : i < idx ? "w-4 bg-primary/50" : "w-4 bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Exercise content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            // ─── انیمیشن کوتاه (درخواست مالک: جابجایی بین حرکات لگ داشت) ───
            // قبلاً ۲۵۰ms×۲ (خروج+ورود با mode=wait) = ۵۰۰ms تأخیر محسوس.
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="max-w-md mx-auto"
          >
            <ExerciseCard
              exercise={exercise}
              loggedSets={activeSession.loggedSets[exercise.id] || []}
              canViewVideos={canViewVideos}
              onCompleteSet={(sn, rest, w, r) => completeSet(sn, rest, w, r)}
              onShowVideo={() => {
                setExerciseDetailId(exercise.id);
                setOverlay("exerciseDetail");
              }}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav — پس‌زمینه solid (بدون backdrop-blur) */}
      <div className="p-4 bg-white border-t border-border/60 space-y-2">
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl flex-1"
            disabled={idx === 0}
            onClick={() => useAppStore.setState((s) => ({
              activeSession: s.activeSession ? { ...s.activeSession, currentExerciseIdx: Math.max(0, idx - 1) } : null,
            }))}
          >
            <ChevronRight className="w-4 h-4" />
            قبلی
          </Button>
          {isLast ? (
            <Button
              className="rounded-xl flex-[2] bg-gradient-to-l from-primary to-amber-500 text-primary-foreground font-bold"
              onClick={finish}
            >
              <Trophy className="w-5 h-5" />
              پایان تمرین
            </Button>
          ) : (
            <Button
              className="rounded-xl flex-[2] bg-gradient-to-l from-primary to-amber-500 text-primary-foreground font-bold"
              onClick={() => useAppStore.setState((s) => ({
                activeSession: s.activeSession ? { ...s.activeSession, currentExerciseIdx: Math.min(exercises.length - 1, idx + 1) } : null,
              }))}
            >
              حرکت بعدی
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ─── تبریک پایان تمرین — وسط صفحه (درخواست مالک: نه toast بالای صفحه) ─── */}
      <AnimatePresence>
        {finishedStats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] flex items-center justify-center p-4"
            dir="rtl"
          >
            <div className="absolute inset-0 bg-black/60" />
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 16 }}
              transition={{ type: "spring", damping: 22, stiffness: 300 }}
              className="relative w-full max-w-sm rounded-3xl bg-white border border-orange-100 shadow-2xl p-6 text-center"
            >
              {/* نشان قهرمانی */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", damping: 12, stiffness: 260, delay: 0.1 }}
                className="w-20 h-20 mx-auto rounded-full flex items-center justify-center shadow-lg shadow-orange-500/30 mb-4"
                style={{ background: "linear-gradient(135deg, #fbbf24, #f59e0b, #f97316)" }}
              >
                <Trophy className="w-10 h-10 text-white" fill="currentColor" />
              </motion.div>
              <h3 className="text-xl font-black text-slate-900">تمرینت تموم شد، آفرین! 🎉</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                {toPersianDigits(finishedStats.setsDone)} ست انجام دادی — هر ست یک قدم به هدف نزدیک‌تر شد.
              </p>

              {/* آمار جلسه */}
              <div className="grid grid-cols-2 gap-2.5 mt-5">
                <div className="rounded-2xl bg-orange-50 border border-orange-100 p-3">
                  <Timer className="w-4 h-4 text-orange-500 mx-auto mb-1" />
                  <p className="text-sm font-black text-slate-900">{toPersianDigits(finishedStats.minutes)} دقیقه</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">مدت تمرین</p>
                </div>
                <div className="rounded-2xl bg-orange-50 border border-orange-100 p-3">
                  <Flame className="w-4 h-4 text-orange-500 mx-auto mb-1" fill="currentColor" />
                  <p className="text-sm font-black text-slate-900">{toPersianDigits(finishedStats.burned)} کالری</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">سوزانده شده</p>
                </div>
              </div>

              <Button
                onClick={closeCelebration}
                className="w-full mt-5 rounded-xl h-12 text-sm font-black bg-gradient-to-l from-primary to-amber-500 text-primary-foreground"
              >
                <PartyPopper className="w-4 h-4" />
                بازگشت به داشبورد
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* تأیید خروج — دیالوگ درون‌برنامه‌ای (جایگزین confirm) */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4"
            dir="rtl"
            onClick={() => setShowExitConfirm(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.92, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 16 }}
              transition={{ type: "spring", damping: 24, stiffness: 300 }}
              className="relative w-full max-w-sm rounded-3xl bg-background border border-border shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="exit-dialog-title"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 id="exit-dialog-title" className="font-black text-base">از تمرین خارج می‌شی؟</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    ست‌های ثبت‌شده این جلسه حذف می‌شن. (اگر صفحه رفرش شود، جلسه تا ۲۴ ساعت نگه داشته می‌شود)
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl flex-1"
                  onClick={() => setShowExitConfirm(false)}
                >
                  ادامه تمرین
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl flex-1"
                  onClick={() => {
                    setShowExitConfirm(false);
                    endSession();
                  }}
                >
                  خروج
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rest timer overlay */}
      <AnimatePresence>
        {restTimer && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[110] w-[90%] max-w-sm"
          >
            <div className="bg-white rounded-3xl p-5 shadow-2xl border border-primary/30">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 shrink-0">
                  <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
                    <circle
                      cx="18" cy="18" r="15" fill="none" stroke="#F4C542" strokeWidth="3"
                      strokeDasharray={`${(restTimer.remaining / restTimer.total) * 94.2} 94.2`}
                      strokeLinecap="round"
                      style={{ filter: "drop-shadow(0 0 4px #F4C54280)" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-lg font-black">
                    {toPersianDigits(restTimer.remaining)}
                  </div>
                </div>
                <div className="flex-1">
                  <p className="font-bold text-sm flex items-center gap-1.5">
                    <Volume2 className="w-4 h-4 text-primary" />
                    زمان استراحت
                  </p>
                  <p className="text-xs text-muted-foreground">نفس بکش و آماده ست بعدی شو</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setRestTimer(null)} className="rounded-xl">
                  رد کردن
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const ExerciseCard = memo(function ExerciseCard({
  exercise,
  loggedSets,
  canViewVideos,
  onCompleteSet,
  onShowVideo,
}: {
  exercise: PlanExercise;
  loggedSets: { weight: number; reps: number; done: boolean }[];
  canViewVideos: boolean;
  onCompleteSet: (setNumber: number, restSec: number, weight: number, reps: number) => void;
  onShowVideo: () => void;
}) {
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [reps, setReps] = useState<Record<number, string>>({});

  return (
    <div>
      {/* Exercise visual — بدون انیمیشن بی‌نهایت و بدون backdrop-blur
          (هر دو عامل لگ جدی روی موبایل بودند) */}
      <div className="relative h-44 rounded-3xl bg-orange-50 border border-orange-100 overflow-hidden flex items-center justify-center mb-4">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-4 right-4 w-24 h-24 rounded-full bg-primary/40 blur-2xl" />
          <div className="absolute bottom-4 left-4 w-20 h-20 rounded-full bg-amber-500/40 blur-2xl" />
        </div>
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-amber-500 flex items-center justify-center shadow-2xl">
          <Dumbbell className="w-10 h-10 text-primary-foreground" />
        </div>
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 text-[10px]">
          <Flame className="w-3 h-3 text-primary" />
          {exercise.muscle}
        </div>
        {/* دکمه توضیحات + ویدیو — v15: کلمه «توضیحات» روی دکمه (درخواست مالک) */}
        {canViewVideos ? (
          <button
            onClick={onShowVideo}
            className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold shadow-lg transition"
          >
            <Video className="w-3.5 h-3.5" />
            توضیحات و ویدیو
          </button>
        ) : (
          <button
            onClick={onShowVideo}
            title="توضیحات، نکات تکنیکی و تصاویر حرکت — رایگان برای همه پلن‌ها"
            className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-700/60 backdrop-blur text-white text-[11px] font-bold opacity-90 hover:opacity-100 transition"
          >
            <Info className="w-3.5 h-3.5" />
            توضیحات
          </button>
        )}
      </div>

      <h2 className="text-xl font-black mb-1">{exercise.name}</h2>
      <p className="text-xs text-muted-foreground mb-4">{exercise.description}</p>

      {/* Sets */}
      <div className="space-y-2.5">
        {exercise.sets.map((set) => {
          const logged = loggedSets[set.setNumber - 1];
          const done = logged?.done;
          return (
            <div
              key={set.setNumber}
              className={`p-3 rounded-2xl border-2 transition ${
                done ? "border-primary bg-primary/5" : "border-border glass"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">{toPersianDigits(set.setNumber)} ست</span>
                <span className="text-xs text-muted-foreground">
                  هدف: {toPersianDigits(set.reps)} • استراحت {toPersianDigits(set.restSec)} ثانیه
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">وزنه (kg)</label>
                  <Input
                    type="number"
                    dir="ltr"
                    placeholder={done ? toPersianDigits(logged?.weight || 0) : "مثلاً ۲۰"}
                    value={weights[set.setNumber] ?? ""}
                    onChange={(e) => setWeights((w) => ({ ...w, [set.setNumber]: e.target.value }))}
                    disabled={done}
                    className="h-9 rounded-lg text-center text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">تکرار واقعی</label>
                  <Input
                    type="number"
                    dir="ltr"
                    placeholder={done ? toPersianDigits(logged?.reps || 0) : "مثلاً ۱۲"}
                    value={reps[set.setNumber] ?? ""}
                    onChange={(e) => setReps((r) => ({ ...r, [set.setNumber]: e.target.value }))}
                    disabled={done}
                    className="h-9 rounded-lg text-center text-sm"
                  />
                </div>
              </div>
              {done ? (
                <div className="flex items-center justify-center gap-2 py-1.5 text-primary text-sm font-bold">
                  <Check className="w-4 h-4" strokeWidth={3} />
                  ثبت شد — {toPersianDigits(logged?.weight || 0)}kg × {toPersianDigits(logged?.reps || 0)}
                </div>
              ) : (
                <Button
                  size="sm"
                  className="w-full rounded-xl bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground"
                  onClick={() =>
                    onCompleteSet(
                      set.setNumber,
                      set.restSec,
                      Number(weights[set.setNumber] || 0),
                      Number(reps[set.setNumber] || 0)
                    )
                  }
                >
                  <Check className="w-4 h-4" />
                  تکمیل ست
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * جلسه restore‌شده‌ای که روزش دیگر در برنامه فعلی وجود ندارد (regenerate شده)
 * یا بدون حرکت است — بی‌صدا بسته می‌شود (setState در رندر مجاز نیست، پس یک
 * component کوچک با useEffect این کار را بعد از رندر انجام می‌دهد).
 */
function InvalidSessionCleanup({ onEnd }: { onEnd: () => void }) {
  useEffect(() => {
    onEnd();
  }, [onEnd]);
  return null;
}
