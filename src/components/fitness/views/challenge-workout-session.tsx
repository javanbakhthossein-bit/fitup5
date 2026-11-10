"use client";

/**
 * v189 — جلسهٔ تمرین هدایت‌شدهٔ «چالش‌های فیتاپ» (بازطراحی با دیرکتیو مالک)
 *
 * دیرکتیوهای مالک (پیام اکتبر ۱۴۰۵):
 *   ✓ ویدیوی حرکت — Muscle Wiki فشرده‌شدهٔ جنسیتی (مرد/زن — هر جنسیت ویدیوی خودش)
 *   ✓ حرکات بدون ویدیوی مناسب → همان انیمیشن دوفریمی قبلی
 *   ✓ هیچ ورود وزنه/تکرار — فقط به تعداد ست‌ها جای تیک (ست ۱، ست ۲، …)
 *   ✓ بعد از زدن هر تیک → استراحت
 *   ✓ ویدیو + توضیحات زیرش + حرکت بعدی/قبلی + موزیک پلیر
 *   ✓ جابجایی نرم بین حرکات (پیش‌بارگذاری ویدیوی حرکت بعدی + fade)
 *   ✓ تایمر استراحت هوشمند + بیپ + جشن پایان + پلیر موزیک کاربر
 *
 * معماری: store slice مستقل activeChallengeSession — صفر تداخل با
 * activeSession برنامهٔ پولی؛ سقوط/رفرش → بازیابی از localStorage.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Dumbbell,
  Flame,
  AlertTriangle,
  Timer,
  Trophy,
  Music,
  Zap,
  Loader2,
  Play,
  WifiOff,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { Button } from "@/components/ui/button";
import { toPersianDigits } from "@/lib/fitness/types";
import { GymWorkoutCelebration } from "@/components/fitness/gym-workout-celebration";
import { toast } from "sonner";
import { reportDailyStatus } from "@/components/fitness/daily-medal";
import {
  beep,
  EMPTY_SETS,
  RestTimerOverlay,
  SessionTimer,
  type LoggedSetEntry,
} from "@/components/fitness/views/active-workout-session";
import { TwoFrameAnimation } from "@/components/fitness/two-frame-animation";
import { WorkoutMusicPlayer } from "@/components/fitness/workout-music-player";
import {
  buildChallengeDay,
  type BuiltChallengeDay,
  type BuiltChallengeExercise,
  type ChallengeDef,
} from "@/lib/fitness/challenges-data";
import { CHALLENGE_VIDEOS } from "@/lib/fitness/challenge-videos";
import { invalidateChallengesCache, useChallenges } from "@/lib/fitness/use-challenges";
// v190 — گیت سراسری بانک (MW) + کپشن منبع Muscle Wiki (دیرکتیو مالک)
import { getBankGates } from "@/lib/fitness/exercise-lib-cache";
import { MwAttribution } from "@/components/fitness/mw-attribution";

const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -18 : 18 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 18 : -18 }),
};

/** نام انگلیسی حرکت از داخل پرانتز — «شنا (Push-Up)» → "Push-Up" */
function englishNameOf(fullName: string): string {
  const m = fullName.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

/**
 * v189 — مسیر ویدیوی جنسیتی Muscle Wiki برای حرکت چالش
 * دیرکتیو مالک: هر جنسیت ویدیوی خودش — بدون فال‌بک جنسیتی؛
 * حرکات بدون ویدیو → undefined → انیمیشن دوفریمی.
 */
function challengeVideoSrc(fullName: string, challengeGender: "men" | "women"): string | undefined {
  const en = englishNameOf(fullName);
  if (!en) return undefined;
  const entry = CHALLENGE_VIDEOS[en];
  if (!entry) return undefined;
  return challengeGender === "women" ? entry.f : entry.m;
}

/**
 * v183 — رندر سراسری جلسهٔ چالش (معادل ActiveWorkoutSession در main-app):
 * با هر refresh، جلسه از localStorage برمی‌گردد؛ چالش از کش مشترک useChallenges
 * پیدا می‌شود — حتی اگر کاربر حین تمرین تب عوض کند جلسه زنده می‌ماند.
 */
export function ChallengeSessionGlobal() {
  const active = useAppStore((s) => s.activeChallengeSession);
  const { bundle, reload } = useChallenges();
  // v215 — پایداری: بعد از ~۱۰ تلاش ناموفق، لودر بی‌نهایت جای پیام فارسی + دکمهٔ
  // تلاش مجدد/خروج را نمی‌گیرد (گزارش ممیزی پایداری — لودر بی‌پایان با شبکهٔ قطع)
  const [attempts, setAttempts] = useState(0);
  // derived state — بدون effect اضافه (الگوی React پیشنهادی)
  const giveUp = !bundle && attempts >= 10;

  // اگر باندل هنوز نرسیده (fetch اول شکست خورده/HMR)، هر ۲.۵ ثانیه تلاش مجدد —
  // جلسهٔ چالش هرگز نباید گیر لودر بماند
  useEffect(() => {
    if (!active || bundle) return;
    const t = setInterval(() => {
      setAttempts((a) => a + 1);
      reload();
    }, 2500);
    return () => clearInterval(t);
  }, [active, bundle, reload]);

  // برگشت باندل → شمارنده صفر (تلاش بعدی شبکهٔ ضعیف هم از نو شماره بگیرد)
  useEffect(() => {
    if (!bundle) return;
    Promise.resolve().then(() => setAttempts(0));
  }, [bundle]);

  if (!active) return null;
  if (!bundle) {
    if (giveUp) {
      return (
        <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center" dir="rtl">
          <div className="text-center space-y-4 px-6">
            <WifiOff className="w-9 h-9 text-muted-foreground mx-auto" aria-hidden="true" />
            <p className="text-sm font-bold text-foreground">بازگشت به جلسهٔ چالش ممکن نشد</p>
            <p className="text-xs text-muted-foreground leading-5">
              اتصال اینترنت را بررسی کنید — جلسهٔ شما محفوظ است و با وصل شدن اینترنت دقیقاً از همین‌جا ادامه پیدا می‌کند.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setAttempts(0);
                  reload();
                }}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-black active:scale-95 transition"
              >
                تلاش مجدد
              </button>
              <button
                type="button"
                onClick={() => useAppStore.getState().endChallengeSession()}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground active:scale-95 transition"
              >
                خروج از جلسه
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground">در حال بازگشت به جلسهٔ چالش…</p>
        </div>
      </div>
    );
  }
  const challenge = bundle.challenges.find((c) => c.slug === active.challengeSlug) ?? null;
  return <ChallengeWorkoutSession challenge={challenge} />;
}

export function ChallengeWorkoutSession({ challenge }: { challenge: ChallengeDef | null }) {
  const activeChallengeSession = useAppStore((s) => s.activeChallengeSession);
  const endChallengeSession = useAppStore((s) => s.endChallengeSession);
  const logChallengeSet = useAppStore((s) => s.logChallengeSet);
  const setMainTab = useAppStore((s) => s.setMainTab);
  const user = useAppStore((s) => s.user);
  const setCaloriesBurned = useAppStore((s) => s.setCaloriesBurned);

  const [rest, setRest] = useState<{ seconds: number; token: number; nextLabel?: string; isFinal?: boolean } | null>(null);
  const [finishedStats, setFinishedStats] = useState<{
    minutes: number;
    burned: number;
    setsDone: number;
    volume: number | null;
    bestWeight: number | null;
    daySaved: boolean;
  } | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [navDir, setNavDir] = useState(1);
  const elapsedRef = useRef(0);
  const onElapsed = useState(() => (s: number) => { elapsedRef.current = s; })[0];
  const daySavedRef = useRef(false);

  // ─── v190 — گیت سراسری Muscle Wiki برای چالش‌ها (دیرکتیو مالک) ───
  // «چالش‌ها هرگز نباید یوتیوب داشته باشند»؛ اگر گیت سراسری MW خاموش بود،
  // ویدیو کلاً نمایش داده نمی‌شود و انیمیشن دوفریمی جایگزین می‌شود.
  // null = پاسخ گیت هنوز نرسیده → رفتار فعلی حفظ می‌شود (ویدیو اگر موجود بود)
  const [mwGateOn, setMwGateOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void getBankGates().then((g) => {
      if (alive) setMwGateOn(g.muscleWikiEnabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  useScrollLock(!!activeChallengeSession);

  // ساخت روز جاری — رندر مشتق (بدون effect/state — صفر re-render اضافه)
  const dayBuilt = useMemo<BuiltChallengeDay | null>(() => {
    if (!activeChallengeSession || !challenge) return null;
    try {
      return buildChallengeDay(challenge, activeChallengeSession.dayNumber);
    } catch {
      return null;
    }
  }, [activeChallengeSession, challenge]);

  const exercises = dayBuilt?.exercises ?? null;

  const handleRestEnd = useCallback(() => setRest(null), []);
  const handleRestSkip = useCallback(() => setRest(null), []);

  const computeNextUp = useCallback(
    (stepIdx: number, afterSetNumber: number): { label: string; isFinal: boolean } => {
      const session = useAppStore.getState().activeChallengeSession;
      if (!exercises) return { label: "آخرین ست تمرین!", isFinal: true };
      const isDone = (exId: string, n: number) => !!session?.loggedSets?.[exId]?.[n - 1]?.done;
      for (let si = stepIdx; si < exercises.length; si++) {
        const ex = exercises[si];
        const fromSet = si === stepIdx ? afterSetNumber + 1 : 1;
        for (let n = fromSet; n <= ex.sets.length; n++) {
          if (!isDone(ex.id, n)) {
            return { label: `ست ${toPersianDigits(n)} — ${ex.name.split(" (")[0]}`, isFinal: false };
          }
        }
      }
      return { label: "آخرین ست تمرین!", isFinal: true };
    },
    [exercises]
  );

  /** v189 — تکمیل ست = فقط تیک؛ هیچ وزنه/تکراری وارد نمی‌شود */
  const handleCompleteSet = useCallback(
    (ex: BuiltChallengeExercise, setNumber: number, restSec: number) => {
      logChallengeSet(ex.id, setNumber, 0, 0);
      const session = useAppStore.getState().activeChallengeSession;
      const flatIdx = Math.min(
        Math.max(0, session?.currentStepIdx ?? 0),
        Math.max(0, (exercises?.length ?? 1) - 1)
      );
      const next = computeNextUp(flatIdx, setNumber);
      if (restSec > 0) {
        setRest((r) => ({
          seconds: restSec,
          token: (r?.token ?? 0) + 1,
          nextLabel: next.label,
          isFinal: next.isFinal,
        }));
      } else {
        beep();
      }
      toast.success(`ست ${toPersianDigits(setNumber)} تکمیل شد! 💪`);
    },
    [logChallengeSet, exercises, computeNextUp]
  );

  // v189 — پیش‌بارگذاری نرم: ویدیوی حرکت بعدی مخفیانه دانلود می‌شود تا جابجایی بدون لگ باشد
  // (hooks بالای early-return ها — قانون ترتیب ثابت hooks)
  const preloadedRef = useRef<Set<string>>(new Set());
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  // اندیس امن حرکت — قبل از early-return ها (برای hooks)
  const idxSafe = useMemo(() => {
    if (!exercises || exercises.length === 0) return 0;
    return Math.min(Math.max(0, activeChallengeSession?.currentStepIdx ?? 0), exercises.length - 1);
  }, [exercises, activeChallengeSession?.currentStepIdx]);
  const nextVideoSrc = useMemo(() => {
    if (mwGateOn === false) return undefined; // v190 — گیت MW خاموش → بدون پیش‌بارگذاری ویدیو
    if (!exercises || exercises.length === 0 || !challenge) return undefined;
    const total = exercises.length;
    const cur = exercises[idxSafe];
    const nxt = exercises[Math.min(idxSafe + 1, total - 1)];
    if (!cur || !nxt || nxt.id === cur.id) return undefined;
    return challengeVideoSrc(nxt.name, challenge.gender);
  }, [exercises, challenge, idxSafe, mwGateOn]);
  useEffect(() => {
    if (!nextVideoSrc) return;
    if (preloadedRef.current.has(nextVideoSrc)) return;
    preloadedRef.current.add(nextVideoSrc);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.src = nextVideoSrc;
    // پس از رسیدن داده (کش مرورگر)، عنصر موقت آزاد می‌شود — فایل در HTTP cache می‌ماند
    const release = () => {
      v.removeEventListener("loadeddata", release);
      v.removeEventListener("error", release);
      v.removeAttribute("src");
      v.load();
    };
    v.addEventListener("loadeddata", release, { once: true });
    v.addEventListener("error", release, { once: true });
  }, [nextVideoSrc]);

  // v189 — با تعویض حرکت، اسکرول به بالای کارت برمی‌گردد (ویدیو اول دیده شود)
  useEffect(() => {
    scrollBoxRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [idxSafe]);

  if (!activeChallengeSession) return null;
  if (!challenge || !exercises || exercises.length === 0) {
    return (
      <InvalidChallengeCleanup
        onEnd={() => {
          endChallengeSession();
        }}
      />
    );
  }

  const total = exercises.length;
  const idx = Math.min(Math.max(0, activeChallengeSession.currentStepIdx), total - 1);
  const currentEx = exercises[idx];
  const isLastStep = idx >= total - 1;

  // v189 — ویدیوی جنسیتی حرکت فعلی (هر جنسیت ویدیوی خودش)
  // v190 — گیت سراسری MW خاموش → بدون ویدیو (انیمیشن دوفریمی) — چالش هرگز یوتیوب ندارد
  const currentVideoSrc = mwGateOn === false ? undefined : challengeVideoSrc(currentEx.name, challenge.gender);

  const goToStep = (si: number) => {
    const clamped = Math.min(Math.max(0, si), total - 1);
    setNavDir(clamped >= idx ? 1 : -1);
    useAppStore.setState((s) =>
      s.activeChallengeSession
        ? { activeChallengeSession: { ...s.activeChallengeSession, currentStepIdx: clamped } }
        : {}
    );
  };

  const allDone = exercises.every((ex) => {
    const sets = activeChallengeSession.loggedSets[ex.id] ?? EMPTY_SETS;
    let done = 0;
    for (const s of sets) if (s?.done) done++;
    return done >= ex.sets.length;
  });

  function finish() {
    const minutes = Math.max(1, Math.round(elapsedRef.current / 60));
    const weightKg = useAppStore.getState().lastKnownWeightKg ?? 75;
    const met = 6.0;
    const burned = Math.round(met * weightKg * (minutes / 60));
    setCaloriesBurned(burned);
    const session = useAppStore.getState().activeChallengeSession;
    let setsDone = 0;
    let volume = 0;
    let hasVolume = false;
    let bestWeight: number | null = null;
    for (const ex of exercises!) {
      const entries = session?.loggedSets[ex.id] ?? [];
      for (const s of entries) {
        if (!s?.done) continue;
        setsDone++;
        if (s.weight > 0 && s.reps > 0) {
          volume += s.weight * s.reps;
          hasVolume = true;
        }
        if (s.weight > 0 && (bestWeight === null || s.weight > bestWeight)) bestWeight = s.weight;
      }
    }
    setFinishedStats({ minutes, burned, setsDone, volume: hasVolume ? volume : null, bestWeight, daySaved: false });

    // ثبت روز چالش (یک‌بار در هر جلسه) — غیرمسدودی
    if (!daySavedRef.current) {
      daySavedRef.current = true;
      const slug = useAppStore.getState().activeChallengeSession?.challengeSlug;
      const dayNumber = useAppStore.getState().activeChallengeSession?.dayNumber;
      if (slug && dayNumber) {
        void (async () => {
          try {
            await fetch("/api/challenges/progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug, action: "complete-day", day: dayNumber }),
              keepalive: true,
            });
            invalidateChallengesCache();
          } catch {}
        })();
      }
    }

    // ثبت در «روز کامل» مشترک تمرین/تغذیه
    void reportDailyStatus({ workout: { done: true, source: "guided_session" } });
  }

  function closeCelebration() {
    setFinishedStats(null);
    endChallengeSession();
    // v190 — رفتار قبلی حفظ شود: پایان چالش → هاب (جزئیات باز نمی‌ماند)
    // setter در store با استک بک پنل هماهنگ است (entry جزئیات مصرف می‌شود)
    useAppStore.getState().setSelectedChallengeSlug(null);
    setMainTab("challenges");
  }

  // ─── v191 — دکمهٔ «خرید برنامهٔ اختصاصی» در جشن پایان چالش (دیرکتیو مالک) ───
  // فقط برای کاربرِ بدون پلن فعال (کاربر پلن‌دار نیازی به خرید ندارد)
  function goPlanFromCelebration() {
    setFinishedStats(null);
    endChallengeSession();
    useAppStore.getState().setSelectedChallengeSlug(null);
    setMainTab("plans");
  }
  const showCelebrationPlanCta =
    !!user && !user.planName && !user.hasActiveSubscription && !user.hasPendingSubscription;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background flex flex-col"
      dir="rtl"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 bg-white border-b border-border/60">
        <button
          onClick={() => setShowExitConfirm(true)}
          className="p-2 rounded-xl hover:bg-muted transition"
          aria-label="خروج از تمرین چالش"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="text-center min-w-0 px-2">
          {/* v220 — بدون truncate: عنوان چالش + روزِ بلند کامل و چندخطی دیده شود */}
          <p className="text-xs text-muted-foreground leading-snug">
            {challenge.emoji} {challenge.title} — {dayBuilt?.title}
          </p>
          <p className="font-bold text-sm flex items-center gap-1.5 justify-center font-stat">
            <SessionTimer startedAt={activeChallengeSession.startedAt} onElapsed={onElapsed} />
          </p>
        </div>
        <div className="text-center shrink-0">
          <p className="text-xs text-muted-foreground">حرکت</p>
          <p className="font-bold text-sm">
            {toPersianDigits(idx + 1)} / {toPersianDigits(total)}
          </p>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5 p-3 justify-center">
        {exercises.map((_, si) => (
          <div
            key={si}
            className={`h-1.5 rounded-full transition-all ${
              si === idx ? "w-8 bg-primary" : si < idx ? "w-4 bg-primary/50" : "w-4 bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <div ref={scrollBoxRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-44">
        <AnimatePresence mode="popLayout" custom={navDir} initial={false}>
          <motion.div
            key={idx}
            custom={navDir}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="max-w-md mx-auto"
          >
            <ChallengeExerciseCard
              exercise={currentEx}
              videoSrc={currentVideoSrc}
              loggedSets={activeChallengeSession.loggedSets[currentEx.id] ?? EMPTY_SETS}
              accent={challenge.accent}
              onCompleteSet={handleCompleteSet}
            />
          </motion.div>
        </AnimatePresence>

        {/* CTA وسط جلسه — پس از تکمیل همهٔ ست‌های حرکت فعلی */}
        {allSetsOfCurrentDone(activeChallengeSession.loggedSets[currentEx.id], currentEx) && !isLastStep && (
          <div className="max-w-md mx-auto mt-4">
            <ChallengeInlineCta seed={idx} compact />
          </div>
        )}
      </div>

      {/* Bottom nav + موزیک */}
      <div className="absolute bottom-0 inset-x-0 bg-white border-t border-border/60 p-3 space-y-2 z-10">
        {/* پلیر موزیک — فایل‌های خود کاربر */}
        <WorkoutMusicPlayer variant="mini" />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl flex-1"
            disabled={idx === 0}
            onClick={() => goToStep(idx - 1)}
          >
            <ChevronRight className="w-4 h-4" />
            قبلی
          </Button>
          {isLastStep || allDone ? (
            <Button
              className="rounded-xl flex-[2] bg-gradient-to-l from-primary to-amber-500 text-primary-foreground font-bold"
              onClick={finish}
            >
              <Trophy className="w-5 h-5" />
              {allDone ? "پایان روز چالش" : "پایان تمرین"}
            </Button>
          ) : (
            <Button
              className="rounded-xl flex-[2] bg-gradient-to-l from-primary to-amber-500 text-primary-foreground font-bold"
              onClick={() => goToStep(idx + 1)}
            >
              حرکت بعدی
              <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Exit confirm */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4"
            onClick={() => setShowExitConfirm(false)}
          >
            <div className="absolute inset-0 bg-black/65" />
            <motion.div
              initial={{ scale: 0.92, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 16 }}
              transition={{ type: "spring", damping: 24, stiffness: 300 }}
              className="relative w-full max-w-sm rounded-3xl bg-background border border-border shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="ch-exit-title"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 id="ch-exit-title" className="font-black text-base">از چالش خارج می‌شی؟</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    پیشرفت این جلسه ثبت نمی‌شود. (اگر فقط رفرش کنی، جلسه تا ۲۴ ساعت برمی‌گردد)
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="rounded-xl flex-1" onClick={() => setShowExitConfirm(false)}>
                  ادامه تمرین
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl flex-1"
                  onClick={() => {
                    setShowExitConfirm(false);
                    endChallengeSession();
                  }}
                >
                  خروج
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* جشن پایان */}
      <GymWorkoutCelebration
        open={!!finishedStats}
        onClose={closeCelebration}
        totalSets={finishedStats?.setsDone ?? 0}
        totalVolume={finishedStats?.volume ?? null}
        durationMin={finishedStats?.minutes ?? null}
        calories={finishedStats?.burned ?? null}
        bestWeightKg={finishedStats?.bestWeight ?? null}
        userName={user?.name ?? null}
        dayTitle={`${challenge.emoji} چالش ${challenge.title} — ${dayBuilt?.title ?? ""}`}
        exerciseCount={exercises.length}
        // v191 — CTA خرید برنامهٔ اختصاصی، جذاب و تو‌چشم (دیرکتیو مالک)
        planCta={
          showCelebrationPlanCta
            ? {
                headline: "چالش رو تمام کردی — حالا نوبت برنامهٔ واقعیته!",
                body: "برنامهٔ تمرینی + غذایی اختصاصی، دقیقاً بر اساس بدن خودت — با هوش مصنوعی فیتاپ.",
                button: "خرید برنامهٔ اختصاصی",
                onClick: goPlanFromCelebration,
              }
            : null
        }
      />

      {/* تایمر استراحت */}
      <AnimatePresence>
        {rest && (
          <RestTimerOverlay
            key={rest.token}
            initialSeconds={rest.seconds}
            nextLabel={rest.nextLabel}
            isFinal={rest.isFinal}
            onDone={handleRestEnd}
            onSkip={handleRestSkip}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function allSetsOfCurrentDone(
  logged: LoggedSetEntry[] | undefined,
  ex: BuiltChallengeExercise
): boolean {
  if (!logged) return false;
  let done = 0;
  for (const s of logged) if (s?.done) done++;
  return done >= ex.sets.length;
}

/** جلسه‌ای که چالشش دیگر در دسترس نیست — بی‌صدا بسته می‌شود */
function InvalidChallengeCleanup({ onEnd }: { onEnd: () => void }) {
  useEffect(() => {
    const t = setTimeout(onEnd, 0);
    return () => clearTimeout(t);
  }, [onEnd]);
  return null;
}

/* ─────────────────────────────────────────────────────────────
 * کارت حرکت چالش — v189 (دیرکتیو مالک):
 *   ویدیوی جنسیتی Muscle Wiki (فال‌بک: انیمیشن دوفریمی) + توضیحات زیر ویدیو
 *   + فقط تیکِ ست‌ها — هیچ وزنه/تکراری وارد نمی‌شود
 * ───────────────────────────────────────────────────────────── */

const ChallengeExerciseCard = memo(function ChallengeExerciseCard({
  exercise,
  videoSrc,
  loggedSets,
  accent,
  onCompleteSet,
}: {
  exercise: BuiltChallengeExercise;
  /** v189 — مسیر ویدیوی جنسیتی Muscle Wiki — undefined = انیمیشن دوفریمی */
  videoSrc?: string;
  loggedSets: LoggedSetEntry[];
  accent: ChallengeDef["accent"];
  /** v189 — تکمیل ست فقط با تیک — بدون وزنه/تکرار */
  onCompleteSet: (ex: BuiltChallengeExercise, setNumber: number, restSec: number) => void;
}) {
  const hasAnim = !!exercise.animKey;
  const gradStyle = { background: `linear-gradient(135deg, ${accent.from}, ${accent.to})` };
  const shortName = exercise.name.split(" (")[0];
  const enName = exercise.name.includes("(") ? exercise.name.split("(")[1]?.replace(")", "").trim() : "";

  return (
    <div>
      {/* ─── بلوک رسانه: ویدیوی جنسیتی → انیمیشن دوفریمی → placeholder ─── */}
      <div
        className="relative rounded-3xl overflow-hidden border mb-4 aspect-video bg-stone-950"
        style={{ borderColor: `${accent.from}40`, boxShadow: `0 10px 30px -12px ${accent.from}30` }}
      >
        {videoSrc ? (
          <video
            key={videoSrc}
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 w-full h-full object-cover"
            aria-label={`ویدیوی آموزش ${shortName}`}
          />
        ) : hasAnim ? (
          <div className="absolute inset-0 bg-white">
            <TwoFrameAnimation animKey={exercise.animKey!} alt={`انیمیشن ${shortName}`} className="h-full w-full" intervalMs={650} />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center shadow-lg" style={gradStyle}>
                <Dumbbell className="w-8 h-8 text-white" />
              </div>
              <p className="text-xs font-bold text-slate-600">{shortName}</p>
            </div>
          </div>
        )}

        {/* نوع رسانه — چپ پایین */}
        {videoSrc ? (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] text-white shadow" style={gradStyle}>
            <Play className="w-3 h-3 fill-current" />
            ویدیو آموزشی
          </div>
        ) : hasAnim ? (
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] text-white shadow" style={gradStyle}>
            <Zap className="w-3 h-3" />
            انیمیشن آموزشی
          </div>
        ) : null}

        {/* عضله — راست پایین */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 text-[10px] shadow-sm">
          <Flame className="w-3 h-3 text-orange-500" />
          {exercise.muscle}
        </div>
      </div>

      {/* v190 — کپشن منبع: ویدیو متعلق به سایت Muscle Wiki است — فقط وقتی
          ویدیوی MW پخش می‌شود (انیمیشن دوفریمی کپشن ندارد) */}
      {videoSrc && <MwAttribution className="mb-3 -mt-2" />}

      {/* عنوان */}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xl font-black">{shortName}</h2>
        {enName && (
          <span dir="ltr" className="text-xs text-muted-foreground font-mono">
            {enName}
          </span>
        )}
      </div>

      {/* توضیحات — همیشه باز، بلافاصله زیر ویدیو (دیرکتیو مالک) */}
      <div className="mb-4 space-y-2">
        {/* هدف ست — فقط اطلاعات (هیچ ورودی‌ای نیست) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold text-white shadow-sm" style={gradStyle}>
            <Timer className="w-3 h-3" />
            {formatRepsFa(exercise.sets[0]?.reps ?? "")}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold text-slate-600 bg-slate-100">
            استراحت: {toPersianDigits(exercise.sets[0]?.restSec ?? 0)} ثانیه
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold text-slate-600 bg-slate-100">
            {toPersianDigits(exercise.sets.length)} ست
          </span>
        </div>
        <div className="p-3 rounded-2xl bg-card border border-border">
          <p className="text-[11px] font-black text-foreground mb-1">نحوه انجام</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{exercise.description}</p>
        </div>
        {exercise.tips && (
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-[11px] font-black text-amber-700 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              نکات ایمنی
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">{exercise.tips}</p>
          </div>
        )}
      </div>

      {/* ─── تیک ست‌ها — فقط «ست ۱، ست ۲، …» (دیرکتیو مالک: بدون وزنه/تکرار) ─── */}
      <div className="space-y-2">
        {exercise.sets.map((set) => {
          const done = !!loggedSets[set.setNumber - 1]?.done;
          return (
            <button
              key={set.setNumber}
              type="button"
              disabled={done}
              onClick={() => onCompleteSet(exercise, set.setNumber, set.restSec)}
              className={`w-full min-h-[52px] flex items-center justify-between px-4 py-3 rounded-2xl border-2 transition active:scale-[0.99] ${
                done
                  ? "border-emerald-300 bg-emerald-50 cursor-default"
                  : "border-border glass hover:border-orange-300"
              }`}
              aria-label={done ? `ست ${toPersianDigits(set.setNumber)} انجام شد` : `ثبت ست ${toPersianDigits(set.setNumber)}`}
            >
              <span className={`font-black text-sm ${done ? "text-emerald-700" : "text-foreground"}`}>
                ست {toPersianDigits(set.setNumber)}
              </span>
              {done ? (
                <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-black">
                  <Check className="w-5 h-5" strokeWidth={3} />
                  انجام شد
                </span>
              ) : (
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-md shrink-0"
                  style={gradStyle}
                  aria-hidden="true"
                >
                  <Check className="w-5 h-5" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground text-center mt-2.5">
        بعد از زدن هر تیک، استراحت شروع می‌شود
      </p>
    </div>
  );
});

/** نمایش هدف تکرار به فارسی — «12-15» → «۱۲ تا ۱۵» / «40s» → «۴۰ ثانیه» */
export function formatRepsFa(reps: string): string {
  const t = reps.trim();
  if (t.toLowerCase().endsWith("s")) {
    const n = parseInt(t, 10);
    if (!Number.isNaN(n)) return `${toPersianDigits(n)} ثانیه`;
  }
  const m = t.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return `${toPersianDigits(Number(m[1]))} تا ${toPersianDigits(Number(m[2]))} تکرار`;
  const n = parseInt(t, 10);
  if (!Number.isNaN(n)) return `${toPersianDigits(n)} تکرار`;
  return t;
}

/** CTA درون جلسه — جمع‌وجور */
const ChallengeInlineCta = memo(function ChallengeInlineCta({ seed, compact }: { seed: number; compact?: boolean }) {
  const setMainTab = useAppStore((s) => s.setMainTab);
  const messages = [
    { icon: Timer, text: "عالی بود! برنامهٔ شخصی‌سازی‌شدهٔ فیتاپ همین کیفیت را هفته‌به‌هفته برای «بدن تو» می‌سازد.", btn: "ساخت برنامهٔ من" },
    { icon: Music, text: "همین جا موزیک گوشیت را اضافه کن — و برای برنامهٔ اختصاصی، پلن فیتاپ را ببین.", btn: "دیدن پلن‌ها" },
    { icon: Zap, text: "قلبت تند می‌زند؟ این فقط شروع است — برنامهٔ حرفه‌ای نتیجه را چند برابر می‌کند.", btn: "ارتقا به حرفه‌ای" },
  ];
  const m = messages[seed % messages.length];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-4 text-white shadow-lg ${compact ? "" : ""}`}
      style={{ background: "linear-gradient(135deg, #1c1917, #292524)" }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
          <m.icon className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-relaxed text-amber-100/90">{m.text}</p>
          <button
            onClick={() => setMainTab("plans")}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-orange-400 hover:text-orange-300 transition"
          >
            {m.btn}
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
});
