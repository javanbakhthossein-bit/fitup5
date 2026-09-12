"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
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
  AlertTriangle,
  PartyPopper,
  Info,
  Zap,
  Repeat,
  Clock,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canAccess, toPersianDigits, type PlanExercise } from "@/lib/fitness/types";
import {
  groupExercises,
  groupTypeLabel,
  groupMemberLabel,
  type GroupedExercise,
} from "@/lib/fitness/workout-groups";
import { toast } from "sonner";
import { reportDailyStatus } from "@/components/fitness/daily-medal";
import { formatSetsSummary, formatSetGoal } from "@/lib/fitness/workout-display";

type LoggedSetEntry = { weight: number; reps: number; done: boolean };

/** مرجع ثابت برای «هنوز هیچ ست ثبت نشده» — identity ثابت تا memo کار کند (t8c-3) */
const EMPTY_SETS: LoggedSetEntry[] = [];

/** پیش‌نویس ورودی‌ها (وزنه/تکرار) — در والد نگه داشته می‌شود تا با remount
 *  کارت‌ها (ناوبری بین حرکات) از دست نرود (t8c-2). کلید: `${exerciseId}:${setNumber}` */
interface DraftsStore {
  current: Record<string, { w?: string; r?: string }>;
}

/** بیپ — سطح ماژول (هم پلیر هم تایمر استراحت استفاده می‌کنند) */
function beep() {
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
}

/** t8c-1: اسلاید جهت‌دار RTL — «بعدی» از چپ وارد می‌شود، «قبلی» از راست
 *  (آینه‌ی جهت LTR؛ در RTL پیشروی یعنی حرکت به سمت چپ) */
const stepVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -24 : 24 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 24 : -24 }),
};

/** تایمر جلسه — کامپوننت ایزوله: تیکِ هر ثانیه فقط این خط را re-render می‌کند،
 *  نه کل صفحه تمرین. onElapsed فقط یک ref را به‌روز می‌کند (بدون re-render والد)
 *  تا در finish() مدت واقعی در دسترس باشد. */
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

/**
 * تایمر استراحت — کامپوننت ایزوله (t8c-4): شمارش معکوس فقط همین کامپوننت را
 * هر ثانیه re-render می‌کند؛ والد دیگر هر ثانیه re-render نمی‌شود (عامل لگ).
 * والد فقط initialSeconds را موقع شروع می‌دهد + onDone/onSkip — هر دو stable.
 * key={token} در والد باعث می‌شود هر استراحت جدید، شمارش تازه شروع کند.
 */
const RestTimerOverlay = memo(function RestTimerOverlay({
  initialSeconds,
  onDone,
  onSkip,
}: {
  initialSeconds: number;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const beepedRef = useRef(false);

  useEffect(() => {
    if (remaining <= 0) {
      if (!beepedRef.current) {
        beepedRef.current = true;
        beep();
        const t = setTimeout(onDone, 600);
        return () => clearTimeout(t);
      }
      return;
    }
    const t = setTimeout(() => setRemaining((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onDone]);

  return (
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
                strokeDasharray={`${Math.max(0, (remaining / initialSeconds) * 94.2)} 94.2`}
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 0 4px #F4C54280)" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-black">
              {toPersianDigits(remaining)}
            </div>
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-primary" />
              زمان استراحت
            </p>
            <p className="text-xs text-muted-foreground">نفس بکش و آماده ست بعدی شو</p>
          </div>
          <Button size="sm" variant="outline" onClick={onSkip} className="rounded-xl">
            رد کردن
          </Button>
        </div>
      </div>
    </motion.div>
  );
});

export function ActiveWorkoutSession() {
  const {
    activeSession,
    workoutPlan,
    endSession,
    logSet,
    setMainTab,
    user,
    setExerciseDetailId,
    setOverlay,
    setCaloriesBurned,
  } = useAppStore();
  // استراحت — فقط شروع/پایان در والد state می‌سازد؛ شمارش داخل RestTimerOverlay
  const [rest, setRest] = useState<{ seconds: number; token: number } | null>(null);
  // آمار تمرینِ تمام‌شده — تبریک وسط صفحه (درخواست مالک: نه toast بالای صفحه)
  const [finishedStats, setFinishedStats] = useState<{ minutes: number; burned: number; setsDone: number } | null>(null);
  // تأیید خروج با دیالوگ درون‌برنامه‌ای — confirm() مرورگر در WebView/PWA/iframe
  // مسدود است و کاربر عملاً گیر می‌کرد و نمی‌توانست از جلسه خارج شود.
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // t8c-2: پیش‌نویس وزنه/تکرار در والد — با ناوبری (remount کارت) حفظ می‌شود
  const draftsRef = useRef<Record<string, { w?: string; r?: string }>>({});
  // t8c-1: جهت ناوبری برای اسلاید جهت‌دار (state — در رندر خوانده می‌شود،
  // برخلاف ref که قانون react-hooks/refs اجازه‌ی خواندن در رندر نمی‌دهد)
  const [navDir, setNavDir] = useState(1);

  // مدت‌گذشته‌ی جلسه بدون re-render (برای محاسبه کالری در finish)
  const elapsedRef = useRef(0);
  const onElapsed = useState(() => (s: number) => { elapsedRef.current = s; })[0];

  // قفل اسکرول صفحه پشت جلسه‌ی تمام‌صفحه (iOS rubber-band / اسکرول پنهان)
  useScrollLock(!!activeSession);

  // User plan capabilities — fullExerciseLibrary requires Advanced+ plan
  const canViewVideos = canAccess(user?.planName ?? null, "fullExerciseLibrary");

  // ─── حرکات روز جلسه (identity ثابت تا steps هر logSet از نو ساخته نشود) ───
  const dayId = activeSession?.dayId ?? null;
  const exercises = useMemo(() => {
    if (!dayId || !workoutPlan) return null;
    const d = workoutPlan.days?.find((x) => x.day === dayId);
    return d && d.exercises?.length ? d.exercises : null;
  }, [dayId, workoutPlan]);
  const dayTitle = useMemo(
    () => (dayId && workoutPlan ? workoutPlan.days?.find((x) => x.day === dayId)?.title ?? "" : ""),
    [dayId, workoutPlan]
  );

  // ─── t8b-1: گام‌های جلسه — هر گام یا تک‌حرکت است یا یک گروه ───
  // (سوپرست/تری‌ست/جاینت‌ست از همان helper مشترک today-workout/gym-mode)
  const steps = useMemo<GroupedExercise[]>(() => (exercises ? groupExercises(exercises) : []), [exercises]);

  // callbacks ایزوله — identity ثابت تا memo(ExerciseCard) کار کند
  const handleRestEnd = useCallback(() => setRest(null), []);
  const handleRestSkip = useCallback(() => setRest(null), []);

  // ─── t8b-4: ثبت ست + منطق استراحت گروه ───
  const handleCompleteSet = useCallback(
    (ex: PlanExercise, setNumber: number, restSec: number, weight: number, reps: number) => {
      logSet(ex.id, setNumber, weight || 0, reps || 0);
      // استراحت گروه: وقتی آخرین ستِ آخرین عضوِ گروه ثبت شد →
      // restBetweenRounds (اگر تعریف شده) وگرنه restSec همان ست.
      // اعضای قبل از آخرین با restSec=0 هیچ استراحتی شروع نمی‌کنند
      // (رفتار قبلی: بیپ فوری — حفظ شده: استراحت صفر = skip).
      let restDuration = restSec;
      const groupStep = steps.find(
        (st) => st.type === "group" && st.exercises.some((m) => m.id === ex.id)
      );
      if (groupStep && groupStep.type === "group") {
        const lastMember = groupStep.exercises[groupStep.exercises.length - 1];
        const isLastMemberLastSet =
          ex.id === lastMember.id && setNumber >= (ex.sets.length ?? 0);
        if (isLastMemberLastSet) {
          restDuration =
            typeof groupStep.restBetweenRounds === "number"
              ? groupStep.restBetweenRounds
              : restSec;
        }
      }
      if (restDuration > 0) {
        setRest((r) => ({ seconds: restDuration, token: (r?.token ?? 0) + 1 }));
      } else {
        beep();
      }
      toast.success(`ست ${toPersianDigits(setNumber)} تکمیل شد! 💪`);
    },
    [logSet, steps]
  );

  const handleShowVideo = useCallback(
    (exerciseId: string) => {
      setExerciseDetailId(exerciseId);
      setOverlay("exerciseDetail");
    },
    [setExerciseDetailId, setOverlay]
  );

  if (!activeSession || !workoutPlan) return null;

  // ─── اعتبارسنجی جلسه در برابر برنامه فعلی ───
  // اگر برنامه regenerate شده و روز جلسه دیگر در آن نیست (یا بدون حرکت است)،
  // جلسه را می‌بندیم تا رندر کرش نکند — قبلاً exercises[idx] روی undefined
  // crash می‌کرد و «تلاش مجدد» در ViewErrorBoundary حلقه crash می‌ساخت.
  if (!exercises) {
    return <InvalidSessionCleanup onEnd={endSession} />;
  }
  const exs = exercises;
  // clamp ایندکس restore‌شده — برنامه جدید ممکن است حرکات کمتری داشته باشد
  // ⚠️ currentExerciseIdx = ایندکس تخت در day.exercises (سازگاری با progress
  // ذخیره‌شده) — گام فعلی از روی این ایندکس مشتق می‌شود (t8b-1)
  const idx = Math.min(Math.max(0, activeSession.currentExerciseIdx), exs.length - 1);

  // گام فعلی + ایندکس شروع آن در آرایه تخت
  let stepIndex = 0;
  {
    let acc = 0;
    for (let si = 0; si < steps.length; si++) {
      const st = steps[si];
      const size = st.type === "group" ? st.exercises.length : 1;
      if (idx < acc + size) {
        stepIndex = si;
        break;
      }
      acc += size;
    }
  }
  const stepStartIndexOf = (si: number): number => {
    let acc = 0;
    for (let i = 0; i < si && i < steps.length; i++) {
      const st = steps[i];
      acc += st.type === "group" ? st.exercises.length : 1;
    }
    return acc;
  };

  const currentStep = steps[stepIndex];
  const isLastStep = stepIndex >= steps.length - 1;

  /** ناوبری بین گام‌ها — currentExerciseIdx به اولین حرکتِ گامِ هدف پرش می‌کند
   *  (اعضای گروه skip می‌شوند) + جهت برای اسلاید ثبت می‌شود */
  const goToStep = (si: number) => {
    const clamped = Math.min(Math.max(0, si), steps.length - 1);
    setNavDir(clamped >= stepIndex ? 1 : -1);
    const target = Math.min(stepStartIndexOf(clamped), exs.length - 1);
    useAppStore.setState((s) => ({
      activeSession: s.activeSession
        ? { ...s.activeSession, currentExerciseIdx: target }
        : null,
    }));
  };

  // t8b-3: گام تمام‌شده = همه‌ی ست‌های همه‌ی اعضا ثبت شده باشد
  const allDone = steps.every((st) => {
    const members = st.type === "group" ? st.exercises : [st.exercise];
    return members.every((ex) => {
      const sets = activeSession.loggedSets[ex.id] ?? EMPTY_SETS;
      let doneCount = 0;
      for (const s of sets) if (s?.done) doneCount++;
      return doneCount >= ex.sets.length;
    });
  });

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
      ? exs.reduce(
          (sum, ex) => sum + ((session.loggedSets[ex.id] || []).filter((s) => s?.done).length),
          0
        )
      : 0;
    // تبریک وسط صفحه — جلسه فعلاً باز می‌ماند تا کاربر آمار را ببیند؛
    // با دکمه «بازگشت به داشبورد» جلسه بسته می‌شود (endSession).
    setFinishedStats({ minutes, burned, setsDone });

    // ─── Task 3-b: ثبت تمرین هدایت‌شده در «روز کامل» (سینک با تغذیه) ───
    // غیرمسدودی (keepalive) — جشن فعلی تمرین سر جایش است و تغییر نمی‌کند؛
    // اگر بعد از این ثبت، روز کامل شود، مدال مشترک در حالت باشگاه / تغذیه /
    // داشبورد دیده می‌شود (اینجا فقط رکورد DayCompletion ثبت می‌شود).
    void reportDailyStatus({ workout: { done: true, source: "guided_session" } });
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
          <p className="text-xs text-muted-foreground">{dayTitle}</p>
          <p className="font-bold text-sm flex items-center gap-1.5 justify-center font-stat">
            <SessionTimer startedAt={activeSession.startedAt} onElapsed={onElapsed} />
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">حرکت</p>
          <p className="font-bold text-sm">{toPersianDigits(stepIndex + 1)} / {toPersianDigits(steps.length)}</p>
        </div>
      </div>

      {/* Progress dots — تعداد گام‌ها (گروه = یک نقطه) */}
      <div className="flex gap-1.5 p-3 justify-center">
        {steps.map((_, si) => (
          <div
            key={si}
            className={`h-1.5 rounded-full transition-all ${
              si === stepIndex ? "w-8 bg-primary" : si < stepIndex ? "w-4 bg-primary/50" : "w-4 bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Exercise content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {/* t8c-1: mode=popLayout — خروج و ورود همزمان (بدون انتظار سریال
            mode=wait که ~۲۴۰ms مرده به هر ناوبری اضافه می‌کرد) + اسلاید
            جهت‌دار RTL کوتاه (۰.۱۸s) */}
        <AnimatePresence mode="popLayout" custom={navDir} initial={false}>
          <motion.div
            key={stepIndex}
            custom={navDir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="max-w-md mx-auto"
          >
            {currentStep.type === "group" ? (
              <GroupStepView
                step={currentStep}
                loggedSets={activeSession.loggedSets}
                canViewVideos={canViewVideos}
                draftsRef={draftsRef}
                onCompleteSet={handleCompleteSet}
                onShowVideo={handleShowVideo}
              />
            ) : (
              <ExerciseCard
                exercise={currentStep.exercise}
                loggedSets={activeSession.loggedSets[currentStep.exercise.id] ?? EMPTY_SETS}
                canViewVideos={canViewVideos}
                draftsRef={draftsRef}
                onCompleteSet={handleCompleteSet}
                onShowVideo={handleShowVideo}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav — پس‌زمینه solid (بدون backdrop-blur) */}
      <div className="p-4 bg-white border-t border-border/60 space-y-2">
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl flex-1"
            disabled={stepIndex === 0}
            onClick={() => goToStep(stepIndex - 1)}
          >
            <ChevronRight className="w-4 h-4" />
            قبلی
          </Button>
          {isLastStep ? (
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
              onClick={() => goToStep(stepIndex + 1)}
            >
              {currentStep.type === "group" ? "گروه بعدی" : "حرکت بعدی"}
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

      {/* Rest timer — کامپوننت ایزوله؛ شمارش هر ثانیه والد را re-render نمی‌کند */}
      <AnimatePresence>
        {rest && (
          <RestTimerOverlay
            key={rest.token}
            initialSeconds={rest.seconds}
            onDone={handleRestEnd}
            onSkip={handleRestSkip}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * هدر گروه + کارت اعضا برای گام سوپرست/تری‌ست/جاینت‌ست (t8b-2).
 * سبک است و عمداً از workouts-view import نمی‌کند (اجتناب از import سنگین) —
 * فقط هم‌قرارداد با SupersetGroupCard همان‌جاست (رنگ بنفش برای سوپرست/تری‌ست،
 * رز برای جاینت‌ست + خط‌چین اتصال اعضا).
 */
function GroupStepView({
  step,
  loggedSets,
  canViewVideos,
  draftsRef,
  onCompleteSet,
  onShowVideo,
}: {
  step: Extract<GroupedExercise, { type: "group" }>;
  loggedSets: Record<string, LoggedSetEntry[]>;
  canViewVideos: boolean;
  draftsRef: DraftsStore;
  onCompleteSet: (exercise: PlanExercise, setNumber: number, restSec: number, weight: number, reps: number) => void;
  onShowVideo: (exerciseId: string) => void;
}) {
  const isGiant = step.groupType === "giant";
  const headerCls = isGiant
    ? "bg-gradient-to-l from-rose-500 to-orange-500 text-white"
    : "bg-gradient-to-l from-purple-500 to-fuchsia-500 text-white";
  const connectorColor = isGiant ? "#fb7185" : "#c084fc";
  const memberAccentCls = isGiant
    ? "bg-rose-100 text-rose-700"
    : "bg-purple-100 text-purple-700";

  const typeHint = isGiant
    ? "۴ حرکت یا بیشتر — سیرکویت"
    : step.groupType === "triset"
      ? "۳ حرکت پشت سر هم"
      : "۲ حرکت پشت سر هم";

  return (
    <div className="space-y-3">
      {/* هدر گروه — نوع + حرف گروه (RTL-safe: حرف لاتین داخل dir=ltr) */}
      <div className={`${headerCls} rounded-2xl px-4 py-2.5 flex items-center gap-2 shadow-sm`}>
        <span className="text-sm leading-none">🔗</span>
        <span className="text-xs font-black">
          {groupTypeLabel(step.groupType)}{" "}
          <span dir="ltr" className="inline-block">{step.group}</span>
        </span>
        <span className="text-[10px] font-bold opacity-90 px-1.5 py-0.5 rounded-full bg-white/20">
          {toPersianDigits(step.exercises.length)} حرکت
        </span>
        <span className="text-[10px] opacity-95 mr-auto flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {typeHint}
        </span>
      </div>

      {/* اطلاعات ویژه جاینت‌ست: تعداد دورها + استراحت بین دورها */}
      {isGiant && (step.circuitRounds != null || step.restBetweenRounds != null) && (
        <div
          className={`flex items-center flex-wrap gap-x-3 gap-y-1 px-3 py-1.5 rounded-xl border text-[10px] ${
            isGiant ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-purple-50 border-purple-200 text-purple-700"
          }`}
        >
          {step.circuitRounds != null && (
            <span className="flex items-center gap-1 font-bold">
              <Repeat className="w-3 h-3" />
              {toPersianDigits(step.circuitRounds)} دور
            </span>
          )}
          {step.restBetweenRounds != null && step.restBetweenRounds > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              استراحت بین دورها: {toPersianDigits(step.restBetweenRounds)} ثانیه
            </span>
          )}
        </div>
      )}

      {/* اعضای گروه — هر عضو کارت کامل خودش را دارد + برچسب A1/A2/A3 */}
      <div className="relative pr-3">
        {/* خط‌چین اتصال اعضا (نماد سوپرست — مثل today-workout) */}
        <div
          className="absolute right-1 top-3 bottom-3 border-r-2 border-dashed opacity-40 pointer-events-none"
          style={{ borderColor: connectorColor }}
          aria-hidden="true"
        />
        <div className="space-y-4">
          {step.exercises.map((ex, mi) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              loggedSets={loggedSets[ex.id] ?? EMPTY_SETS}
              canViewVideos={canViewVideos}
              draftsRef={draftsRef}
              memberLabel={groupMemberLabel(step.group, mi)}
              memberAccentCls={memberAccentCls}
              onCompleteSet={onCompleteSet}
              onShowVideo={onShowVideo}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** hydrate اولیه‌ی پیش‌نویس‌ها از ref والد — فقط موقع mount (initializer useState) */
function hydrateDrafts(
  exercise: PlanExercise,
  draftsRef: DraftsStore,
  field: "w" | "r"
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const set of exercise.sets) {
    const v = draftsRef.current[`${exercise.id}:${set.setNumber}`]?.[field];
    if (v != null && v !== "") out[set.setNumber] = v;
  }
  return out;
}

const ExerciseCard = memo(function ExerciseCard({
  exercise,
  loggedSets,
  canViewVideos,
  draftsRef,
  memberLabel,
  memberAccentCls,
  onCompleteSet,
  onShowVideo,
}: {
  exercise: PlanExercise;
  loggedSets: LoggedSetEntry[];
  canViewVideos: boolean;
  draftsRef: DraftsStore;
  /** برچسب عضو گروه (A1/A2…) — فقط در گام‌های گروهی */
  memberLabel?: string;
  memberAccentCls?: string;
  onCompleteSet: (exercise: PlanExercise, setNumber: number, restSec: number, weight: number, reps: number) => void;
  onShowVideo: (exerciseId: string) => void;
}) {
  // t8c-2: پیش‌نویس وزنه/تکرار — خواندن ref فقط داخل effect مجاز است
  // (قانون react-hooks/refs: دسترسی به ref در رندر ممنوع)؛ اثر بعد از mount
  // مقادیر تایپ‌شده‌ی قبلی را برمی‌گرداند — در عمل همان لحظه است.
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [reps, setReps] = useState<Record<number, string>>({});

  useEffect(() => {
    const w = hydrateDrafts(exercise, draftsRef, "w");
    const r = hydrateDrafts(exercise, draftsRef, "r");
    if (Object.keys(w).length > 0) setWeights((p) => ({ ...p, ...w }));
    if (Object.keys(r).length > 0) setReps((p) => ({ ...p, ...r }));
  }, [exercise, draftsRef]);

  const writeDraft = (setNumber: number, field: "w" | "r", value: string) => {
    draftsRef.current[`${exercise.id}:${setNumber}`] = {
      ...draftsRef.current[`${exercise.id}:${setNumber}`],
      [field]: value,
    };
  };

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
            onClick={() => onShowVideo(exercise.id)}
            className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold shadow-lg transition"
          >
            <Video className="w-3.5 h-3.5" />
            توضیحات و ویدیو
          </button>
        ) : (
          <button
            onClick={() => onShowVideo(exercise.id)}
            title="توضیحات، نکات تکنیکی و تصاویر حرکت — رایگان برای همه پلن‌ها"
            className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-700/60 backdrop-blur text-white text-[11px] font-bold opacity-90 hover:opacity-100 transition"
          >
            <Info className="w-3.5 h-3.5" />
            توضیحات
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-1">
        {memberLabel && (
          <span
            dir="ltr"
            className={`text-[10px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${memberAccentCls ?? "bg-muted text-foreground"}`}
          >
            {memberLabel}
          </span>
        )}
        <h2 className="text-xl font-black">{exercise.name}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-1">{exercise.description}</p>

      {/* v55 — خلاصهٔ سینک ست/تکرار (همان فرمت مدال تمرینی/تمرین امروز/حالت باشگاه):
          درخواست مالک: باید فوراً معلوم باشد چند ست و چند تکرار است */}
      <div className="mb-4 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm font-black text-primary text-center">
        {formatSetsSummary(exercise.sets)}
      </div>

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
                <span className="font-bold text-sm">ست {toPersianDigits(set.setNumber)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatSetGoal(set)}
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
                    onChange={(e) => {
                      const v = e.target.value;
                      setWeights((w) => ({ ...w, [set.setNumber]: v }));
                      writeDraft(set.setNumber, "w", v);
                    }}
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
                    onChange={(e) => {
                      const v = e.target.value;
                      setReps((r) => ({ ...r, [set.setNumber]: v }));
                      writeDraft(set.setNumber, "r", v);
                    }}
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
                      exercise,
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
