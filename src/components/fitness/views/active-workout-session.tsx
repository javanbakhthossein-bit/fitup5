"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  Timer,
  Dumbbell,
  Flame,
  Trophy,
  Volume2,
  AlertTriangle,
  PartyPopper,
  Info,
  Zap,
  Repeat,
  Clock,
  Play,
  Lock,
  Loader2,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
// v169 — هشدار فیلترشکن زیر ویدیوهای یوتیوب (دیرکتیو مالک)
import { YoutubeVpnNote } from "@/components/fitness/youtube-vpn-note";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canAccess, toPersianDigits, type PlanExercise } from "@/lib/fitness/types";
import {
  groupExercises,
  groupTypeLabel,
  groupMemberLabel,
  groupMaxRounds,
  memberSetFor,
  groupRoundRestSec,
  isGroupRoundDone,
  type GroupedExercise,
} from "@/lib/fitness/workout-groups";
import { GymWorkoutCelebration } from "@/components/fitness/gym-workout-celebration";
import { toast } from "sonner";
import { reportDailyStatus } from "@/components/fitness/daily-medal";
import { formatSetsSummary, formatSetGoal } from "@/lib/fitness/workout-display";
import { resolveExerciseVideoSrc } from "@/lib/fitness/exercise-video";
// v171 — کش مشترک بانک حرکات: پیش‌واکشی دسته‌ای ids در شروع جلسه + جستجوی کش‌شده
import { getExercisesByIds, getExerciseById, searchExerciseLibWithFallback, pickBestLibMatch } from "@/lib/fitness/exercise-lib-cache";

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

/* ═══════════════════════════════════════════════════════════════════
 * v118 — ویدیوی درون‌خطی کارت حرکت در جلسهٔ تمرین (درخواست مالک):
 * «همونجا که آیکون دمبل هست ویدیو رو نشون بده و دکمهٔ توضیحات فقط توضیحات
 * رو نشون بده» — قبلاً دکمهٔ «توضیحات و ویدیو» یک Sheet (z-50) زیر صفحهٔ
 * تمام‌صفحهٔ جلسه (z-100) باز می‌شد + قفل pointer-events بدنه → کاربر
 * هیچ‌چیز نمی‌دید و کل صفحه هنگ می‌کرد.
 * حالا: ویدیو مستقیم داخل جعبهٔ تصویر کارت رندر می‌شود (بدون هیچ لایهٔ
 * اورلی) و دکمهٔ «توضیحات» فقط پنل توضیحات/نکات را درون کارت باز می‌کند.
 * ═══════════════════════════════════════════════════════════════════ */

/** ردیف بانک حرکات که کارت جلسه لازم دارد (ویدیو + توضیحات + نکات) */
interface ExerciseLibInfo {
  name?: string;
  description?: string;
  tips?: string;
  videoUrl?: string;
  videoPosterUrl?: string;
  youtubeUrl?: string;
  youtubeEnabled?: boolean | null;
}

/** کش ماژول‌سطح — ناوبری بین حرکات جلسه دوباره fetch نمی‌زند */
const EXERCISE_LIB_CACHE = new Map<string, ExerciseLibInfo | null>();

/**
 * واکشی اطلاعات بانک حرکات برای یک حرکت برنامه (v118).
 * استراتژی: ۱) ارجاع دقیق با exerciseId ۲) جستجوی نام ۳) فازی کلیدواژه‌ای —
 * همان استراتژی اورلی جزئیات حرکت (exercise-detail-overlay).
 *
 * v171 — هر دو مسیر از کش مشترک exercise-lib-cache می‌گذرند:
 *  • مسیر id: پیش‌واکشی دسته‌ای شروع جلسه (یک درخواست ?ids=a,b,c برای همهٔ
 *    حرکات روز) اینجا را «صفر شبکه» می‌کند — قبلاً هر کارت وسط تمرین
 *    درخواست تکی + زنجیرهٔ کلمه‌به‌کلمهٔ sequential می‌زد (آبشار N+1).
 *  • مسیر نام: جستجوی کش‌شدهٔ مشترک بین جلسه/اورلی/برنامه‌ها.
 */
function useExerciseLibInfo(exercise: PlanExercise): ExerciseLibInfo | null {
  // نتیجهٔ واکشی — فقط وقتی نامش با حرکت فعلی یکی باشد اعمال می‌شود (ضد race)
  const [fetched, setFetched] = useState<{ name: string; info: ExerciseLibInfo | null } | null>(null);

  // v171 — رندر مشتق: کش ماژول‌سطح (ناوبری بین حرکات) بدون setState همگام
  // داخل effect خوانده می‌شود (قانون react-hooks/set-state-in-effect)
  const info = useMemo(() => {
    const cached = EXERCISE_LIB_CACHE.get(exercise.name);
    if (cached !== undefined) return cached;
    return fetched && fetched.name === exercise.name ? fetched.info : null;
  }, [exercise.name, fetched]);

  useEffect(() => {
    // کش‌خورده → صفر کار و صفر setState
    if (EXERCISE_LIB_CACHE.get(exercise.name) !== undefined) return;
    let cancelled = false;
    (async () => {
      let found: ExerciseLibInfo | null = null;
      try {
        // ۱) ارجاع دقیق بانک (برنامه‌های جدید exerciseId دارند) — از کش دسته‌ای مشترک
        if (exercise.exerciseId) {
          const row = await getExerciseById(exercise.exerciseId);
          if (row) found = row;
        }
        // ۲) جستجوی نام + ۳) فازی کلیدواژه‌ای — از جستجوی کش‌شدهٔ مشترک
        if (!found) {
          const list = await searchExerciseLibWithFallback(exercise.name);
          if (list.length > 0) {
            // بهترین تطبیق بر اساس اشتراک کلمات (دقیق = همیشه برتر)
            found = pickBestLibMatch(exercise.name, list);
          }
        }
      } catch {
        // ignore — فال‌بک به دادهٔ خود حرکت برنامه
      }
      EXERCISE_LIB_CACHE.set(exercise.name, found);
      if (!cancelled) setFetched({ name: exercise.name, info: found });
    })();
    return () => {
      cancelled = true;
    };
  }, [exercise.name, exercise.exerciseId]);

  return info;
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
 *
 * v168 — شمارندهٔ استراحت هوشمند (درخواست مالک: «شمارنده استراحت باید خیلی
 * هوشمند باشه — بدونن حرکت بعدی چیه، بدونن ست چندمیم، بدونن آخرین حرکت»):
 *  • nextLabel — چی حرکتی/دوری بعد از استراحت منتظرته («ست ۲ — پرس سینه دمبل»
 *    یا «دور ۲ از ۴ — سوپرست»)
 *  • isFinal — آخرین استراحت تمرین است؛ پیام ویژهٔ نزدیکی جشن
 *  • دکمهٔ «+۳۰ ثانیه» (هم‌تراز تایمر حالت باشگاه) + حلقهٔ پیشرفت با گرادیان
 */
const RestTimerOverlay = memo(function RestTimerOverlay({
  initialSeconds,
  nextLabel,
  isFinal,
  onDone,
  onSkip,
}: {
  initialSeconds: number;
  nextLabel?: string;
  isFinal?: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const [total, setTotal] = useState(initialSeconds);
  const beepedRef = useRef(false);
  const gradId = `session-rest-ring-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const finished = remaining <= 0;

  // 🩹 v169 — فیکس «یک ثانیه کم می‌کند و قفل می‌کند» (گزارش مالک در هر دو حالت):
  // شمارش و پایان حالا دو افکت جدا هستند. باگ قبلی: افکت شمارش فقط به
  // [finished, onDone] وابسته بود و هرگز دوباره مسلح نمی‌شد → بعد از اولین
  // تیک، timeout جدید ساخته نمی‌شد و تایمر میخکوب می‌ماند. حالا الگویِ
  // درستِ GymRestTimer: افکت شمارش به [remaining] وابسته است و هر ثانیه
  // دوباره مسلح می‌شود؛ افکت پایان فقط به [finished] گوش می‌دهد.
  useEffect(() => {
    if (finished) return;
    const t = setTimeout(() => setRemaining((p) => Math.max(0, p - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, finished]);

  useEffect(() => {
    if (!finished) return;
    if (beepedRef.current) return;
    beepedRef.current = true;
    beep();
    const t = setTimeout(onDone, 600);
    return () => clearTimeout(t);
  }, [finished, onDone]);

  const CIRC = 2 * Math.PI * 15;
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{ duration: 0.18 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[110] w-[90%] max-w-sm"
      role="timer"
      aria-live="polite"
    >
      <div
        className="rounded-3xl p-5 shadow-2xl border bg-white"
        style={{
          borderColor: finished ? "rgba(16,185,129,0.4)" : "rgba(244,197,66,0.5)",
          boxShadow: finished
            ? "0 18px 50px -12px rgba(16,185,129,0.45)"
            : "0 18px 50px -12px rgba(244,197,66,0.4)",
        }}
      >
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <defs>
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={finished ? "#34d399" : "#F4C542"} />
                  <stop offset="100%" stopColor={finished ? "#10b981" : "#f97316"} />
                </linearGradient>
              </defs>
              <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
              <circle
                cx="18" cy="18" r="15" fill="none" stroke={`url(#${gradId})`} strokeWidth="3"
                strokeDasharray={`${frac * CIRC} ${CIRC}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 0.95s linear", filter: "drop-shadow(0 0 4px #F4C54280)" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg font-black">
              {toPersianDigits(remaining)}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-primary" />
              {finished ? "پایان استراحت! 💪" : "زمان استراحت"}
            </p>
            <p className={`text-xs mt-0.5 leading-relaxed ${isFinal && !finished ? "font-bold text-primary" : "text-muted-foreground"}`}>
              {finished
                ? "آمادهٔ ست بعدی باش"
                : isFinal
                  ? "آخرین استراحت تمرین — بعدش جشن داریم! 🎉"
                  : nextLabel
                    ? `بعدی: ${nextLabel}`
                    : "نفس بکش و آماده ست بعدی شو"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onSkip} className="rounded-xl shrink-0">
            رد کردن
          </Button>
        </div>
        {/* +۳۰ ثانیه — هم‌تراز حالت باشگاه */}
        <button
          type="button"
          onClick={() => {
            setRemaining((r) => r + 30);
            setTotal((t) => t + 30);
          }}
          className="w-full mt-3 min-h-[40px] rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-black hover:bg-primary/15 active:scale-[0.98] transition"
        >
          +۳۰ ثانیه
        </button>
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
    setCaloriesBurned,
  } = useAppStore();
  // استراحت — فقط شروع/پایان در والد state می‌سازد؛ شمارش داخل RestTimerOverlay
  // v168 — nextLabel/isFinal: برچسب هوشمند «بعدی» برای شمارندهٔ استراحت
  const [rest, setRest] = useState<{
    seconds: number;
    token: number;
    nextLabel?: string;
    isFinal?: boolean;
  } | null>(null);
  // آمار تمرینِ تمام‌شده — جشن بزرگ مشترک با حالت باشگاه (v168)
  const [finishedStats, setFinishedStats] = useState<{
    minutes: number;
    burned: number;
    setsDone: number;
    volume: number | null;
    bestWeight: number | null;
  } | null>(null);
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

  // ─── v171 — پیش‌واکشی دسته‌ای بانک حرکات در شروع جلسه (ضد آبشار N+1) ───
  // دیرکتیو مالک: جلسهٔ تمرین باید مثل اپ نصب‌شده فوری باشد. قبلاً هر کارت
  // حرکت وسط تمرین زنجیرهٔ sequential می‌زد (id → نام → کلمه‌به‌کلمه)؛ حالا
  // «همهٔ حرکات روز با یک درخواست ?ids=a,b,c» در لحظهٔ شروع جلسه کش می‌شوند
  // (حرکات بدون id در کارت خودشان از زنجیرهٔ جستجوی کش‌شدهٔ مشترک می‌گذرند).
  useEffect(() => {
    if (!exercises) return;
    const ids = exercises
      .map((e) => (e as { exerciseId?: string }).exerciseId)
      .filter(Boolean) as string[];
    if (ids.length === 0) return;
    void getExercisesByIds(ids);
  }, [exercises]);

  // callbacks ایزوله — identity ثابت تا memo(ExerciseCard) کار کند
  const handleRestEnd = useCallback(() => setRest(null), []);
  const handleRestSkip = useCallback(() => setRest(null), []);

  /**
   * v168 — محاسبهٔ «بعدی» برای شمارندهٔ هوشمند استراحت: بعد از ثبت ست N از
   * گام stepIdx، اولین ستِ انجام‌نشدهٔ کل روز پیدا می‌شود (دور بعدی گروه /
   * ست بعدی حرکت / اولین ست حرکت بعد) — و اگر هیچی نماند isFinal=true.
   * loggedSets از استور زنده خوانده می‌شود (logSet sync است).
   */
  const computeNextUp = useCallback(
    (afterStepIdx: number, afterSetNumber: number): { label: string; isFinal: boolean } => {
      const session = useAppStore.getState().activeSession;
      const isDone = (exId: string, n: number) => !!session?.loggedSets?.[exId]?.[n - 1]?.done;
      for (let si = afterStepIdx; si < steps.length; si++) {
        const st = steps[si];
        const fromSet = si === afterStepIdx ? afterSetNumber + 1 : 1;
        if (st.type === "group") {
          const maxR = groupMaxRounds(st);
          for (let n = fromSet; n <= maxR; n++) {
            if (!isGroupRoundDone(st, n, isDone)) {
              return {
                label: `دور ${toPersianDigits(n)} از ${toPersianDigits(maxR)} — ${groupTypeLabel(st.groupType)}`,
                isFinal: false,
              };
            }
          }
        } else {
          const ex = st.exercise;
          const totalSets = ex.sets?.length ?? 0;
          for (let n = fromSet; n <= totalSets; n++) {
            if (!isDone(ex.id, n)) {
              return { label: `ست ${toPersianDigits(n)} — ${ex.name}`, isFinal: false };
            }
          }
        }
      }
      return { label: "آخرین ست تمرین!", isFinal: true };
    },
    [steps]
  );

  /** ایندکس گامِ یک حرکت تخت (برای computeNextUp در تیک‌های تک‌حرکتی) */
  const flatStepIndexOf = useCallback(
    (flatIdx: number): number => {
      let acc = 0;
      for (let si = 0; si < steps.length; si++) {
        const st = steps[si];
        const size = st.type === "group" ? st.exercises.length : 1;
        if (flatIdx < acc + size) return si;
        acc += size;
      }
      return Math.max(0, steps.length - 1);
    },
    [steps]
  );

  // ─── t8b-4: ثبت ست + منطق استراحت گروه (حرکات تکی) ───
  const handleCompleteSet = useCallback(
    (ex: PlanExercise, setNumber: number, restSec: number, weight: number, reps: number) => {
      logSet(ex.id, setNumber, weight || 0, reps || 0);
      // v168 — شمارندهٔ استراحت هوشمند: «بعدی چیست؟ ست چندم است؟ آخرین حرکت است؟»
      const session = useAppStore.getState().activeSession;
      const flatIdx = Math.min(
        Math.max(0, session?.currentExerciseIdx ?? 0),
        Math.max(0, (exercises?.length ?? 1) - 1)
      );
      const next = computeNextUp(flatStepIndexOf(flatIdx), setNumber);
      // استراحت گروه: وقتی آخرین ستِ آخرین عضوِ گروه ثبت شد →
      // restBetweenRounds (اگر تعریف شده) وگرنه restSec همان ست.
      // (مسیر گروه‌ها حالا عمدتاً از handleCompleteGroupRound می‌گذرد؛ این
      // شاخه برای سازگاری با داده‌های قدیمی حفظ شده است.)
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
        setRest((r) => ({
          seconds: restDuration,
          token: (r?.token ?? 0) + 1,
          nextLabel: next.label,
          isFinal: next.isFinal,
        }));
      } else {
        beep();
      }
      toast.success(`ست ${toPersianDigits(setNumber)} تکمیل شد! 💪`);
    },
    [logSet, steps, exercises, computeNextUp, flatStepIndexOf]
  );

  /**
   * v168 — تکمیل یک «دور» کامل گروه با یک تیک (درخواست مالک):
   * «بالاسینه هالتر و پرس سینه دمبل … با پر کردن جفتشون یک تیک زده بشه و
   * بره برای استراحت» — همهٔ اعضای دارای ست N ثبت می‌شوند، بعد استراحتِ دور
   * (restBetweenRounds یا restSec عضو آخر) شروع می‌شود با برچسب هوشمند بعدی.
   */
  const handleCompleteGroupRound = useCallback(
    (
      step: Extract<GroupedExercise, { type: "group" }>,
      setNumber: number,
      entries: Array<{ ex: PlanExercise; weight: number; reps: number }>
    ) => {
      for (const en of entries) {
        if (!memberSetFor(en.ex, setNumber)) continue;
        logSet(en.ex.id, setNumber, en.weight || 0, en.reps || 0);
      }
      const stepIdx = Math.max(
        0,
        steps.findIndex((st) => st.type === "group" && st.group === step.group)
      );
      const next = computeNextUp(stepIdx, setNumber);
      const restDuration = groupRoundRestSec(step, setNumber);
      if (restDuration > 0) {
        setRest((r) => ({
          seconds: restDuration,
          token: (r?.token ?? 0) + 1,
          nextLabel: next.label,
          isFinal: next.isFinal,
        }));
      } else {
        beep();
      }
      toast.success(`ست ${toPersianDigits(setNumber)} گروه تکمیل شد! 💪`);
    },
    [logSet, steps, computeNextUp]
  );

  // v118 — دکمهٔ «توضیحات و ویدیو» حذف شد: ویدیو مستقیم داخل جعبهٔ تصویر کارت
  // رندر می‌شود و «توضیحات» پنل درون‌کارت دارد (رفع هنگ z-100/z-50 — گزارش مالک)

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
    // تعداد ست‌های انجام‌شده‌ی این جلسه + حجم کل (وزنه×تکرار) + بهترین ست
    // (v168 — جشن بزرگ مشترک با حالت باشگاه)
    const session = useAppStore.getState().activeSession;
    let setsDone = 0;
    let volume = 0;
    let hasVolume = false;
    let bestWeight: number | null = null;
    for (const ex of exs) {
      const entries = session?.loggedSets[ex.id] ?? [];
      for (const s of entries) {
        if (!s?.done) continue;
        setsDone++;
        if (s.weight > 0 && s.reps > 0) {
          volume += s.weight * s.reps;
          hasVolume = true;
        }
        if (s.weight > 0 && (bestWeight === null || s.weight > bestWeight)) {
          bestWeight = s.weight;
        }
      }
    }
    // جشن بزرگ — جلسه فعلاً باز می‌ماند تا کاربر آمار را ببیند؛
    // با دکمهٔ پایانی، جلسه بسته می‌شود (endSession).
    setFinishedStats({ minutes, burned, setsDone, volume: hasVolume ? volume : null, bestWeight });

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
                onCompleteRound={handleCompleteGroupRound}
              />
            ) : (
              <ExerciseCard
                exercise={currentStep.exercise}
                loggedSets={activeSession.loggedSets[currentStep.exercise.id] ?? EMPTY_SETS}
                canViewVideos={canViewVideos}
                draftsRef={draftsRef}
                onCompleteSet={handleCompleteSet}
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

      {/* ─── v168 — جشن بزرگ پایان تمرین — همان جشن جذاب حالت باشگاه، مشترک و
          شخصی‌سازی‌شده (درخواست مالک: «جشن پایان تمرین قسمت تمرین امروز هم مثل
          حالت باشگاه جذاب بشه و شخصی‌سازی‌تر بشه و تکمیل‌تر») ─── */}
      <GymWorkoutCelebration
        open={!!finishedStats}
        onClose={closeCelebration}
        totalSets={finishedStats?.setsDone ?? 0}
        totalVolume={finishedStats?.volume ?? null}
        durationMin={finishedStats?.minutes ?? null}
        calories={finishedStats?.burned ?? null}
        bestWeightKg={finishedStats?.bestWeight ?? null}
        userName={user?.name ?? null}
        dayTitle={dayTitle}
        exerciseCount={exs.length}
      />

      {/* Rest timer — کامپوننت ایزوله؛ شمارش هر ثانیه والد را re-render نمی‌کند
          v168 — برچسب هوشمند «بعدی» + حالت «آخرین استراحت تمرین» */}
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

/**
 * گام سوپرست/تری‌ست/جاینت‌ست — v168 بازطراحی کامل (درخواست مالک):
 *
 * «حرکات سوپرست و تریست جدا نوشته شدن و هر کدوم رو که می‌زنیم حالت استراحت
 * میاد… در حرکات سوپرست و تریست باید اینجوری نوشته شه: ست اول، پایینش
 * بالاسینه هالتر محل قرار دادن عدد وزنه و تعداد تکرار، پایینش پرس سینه دمبل
 * — که با پر کردن جفتشون یک تیک زده بشه و بره برای استراحت.»
 *
 * پس واحد نمایش/تیک دیگر «هر عضو» نیست؛ «دور» است (ست N همهٔ اعضا با هم):
 *   ┌ کارت دور: ست N از M ────────────────┐
 *   │ A1 بالاسینه هالتر   [وزنه] [تکرار]  │
 *   │ A2 پرس سینه دمبل    [وزنه] [تکرار]  │
 *   │ [ ✓ تکمیل ست N گروه → استراحت ]     │
 *   └──────────────────────────────────────┘
 * ویدیو + توضیحات هر عضو سر جایش است (دکمهٔ «ویدیو و توضیحات» داخل هر ردیف).
 */
function GroupStepView({
  step,
  loggedSets,
  canViewVideos,
  draftsRef,
  onCompleteRound,
}: {
  step: Extract<GroupedExercise, { type: "group" }>;
  loggedSets: Record<string, LoggedSetEntry[]>;
  canViewVideos: boolean;
  draftsRef: DraftsStore;
  onCompleteRound: (
    step: Extract<GroupedExercise, { type: "group" }>,
    setNumber: number,
    entries: Array<{ ex: PlanExercise; weight: number; reps: number }>
  ) => void;
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
    ? "سیرکویت — همهٔ حرکات پشت سر هم"
    : step.groupType === "triset"
      ? "۳ حرکت پشت سر هم — یک تیک برای هر ست"
      : "۲ حرکت پشت سر هم — یک تیک برای هر ست";

  const maxRounds = groupMaxRounds(step);

  const isDone = useCallback(
    (exId: string, n: number) => !!loggedSets[exId]?.[n - 1]?.done,
    [loggedSets]
  );

  // دور فعال: اولین دورِ ناتمام (خودکار) — یا دور انتخابی کاربر (چیپ‌ها)
  const firstIncomplete = useMemo(() => {
    for (let n = 1; n <= maxRounds; n++) {
      if (!isGroupRoundDone(step, n, isDone)) return n;
    }
    return maxRounds;
  }, [step, maxRounds, isDone]);
  const [manualRound, setManualRound] = useState<number | null>(null);
  const activeRound = Math.min(manualRound ?? firstIncomplete, maxRounds);

  // ورودی‌های وزنه/تکرار دور فعال — کلید: `${ex.id}:${setNumber}` —
  // از پیش‌نویس والد hydrate می‌شود تا با ناوبری از دست نرود (همان قرارداد draftsRef)
  const [inputs, setInputs] = useState<Record<string, { w?: string; r?: string }>>({});
  useEffect(() => {
    const next = hydrateRoundDrafts(step, activeRound, draftsRef);
    if (Object.keys(next).length > 0) setInputs((p) => ({ ...p, ...next }));
  }, [step, activeRound, draftsRef]);

  const writeInput = (exId: string, field: "w" | "r", value: string) => {
    const key = `${exId}:${activeRound}`;
    setInputs((p) => ({ ...p, [key]: { ...p[key], [field]: value } }));
    draftsRef.current[key] = { ...draftsRef.current[key], [field]: value };
  };

  const roundDone = isGroupRoundDone(step, activeRound, isDone);
  const doneRounds = useMemo(() => {
    let c = 0;
    for (let n = 1; n <= maxRounds; n++) if (isGroupRoundDone(step, n, isDone)) c++;
    return c;
  }, [step, maxRounds, isDone]);

  const completeRound = () => {
    if (roundDone) return;
    const entries = step.exercises
      .filter((ex) => memberSetFor(ex, activeRound))
      .map((ex) => ({
        ex,
        weight: Number(inputs[`${ex.id}:${activeRound}`]?.w || 0),
        reps: Number(inputs[`${ex.id}:${activeRound}`]?.r || 0),
      }));
    onCompleteRound(step, activeRound, entries);
  };

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
          {toPersianDigits(step.exercises.length)} حرکت • {toPersianDigits(maxRounds)} ست
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

      {/* چیپ‌های دور — دور انجام‌شده تیک دارد؛ کاربر می‌تواند دور قبلی را ببیند */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Array.from({ length: maxRounds }, (_, i) => i + 1).map((n) => {
          const nDone = isGroupRoundDone(step, n, isDone);
          const isActive = n === activeRound;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setManualRound(n)}
              aria-pressed={isActive}
              className={`h-8 min-w-8 px-2.5 rounded-xl text-xs font-black transition border-2 flex items-center gap-1 ${
                isActive
                  ? isGiant
                    ? "border-rose-500 bg-rose-500 text-white"
                    : "border-purple-500 bg-purple-500 text-white"
                  : nDone
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-border bg-white text-muted-foreground"
              }`}
            >
              {nDone && !isActive ? <Check className="w-3 h-3" strokeWidth={3} /> : null}
              ست {toPersianDigits(n)}
            </button>
          );
        })}
        <span className="text-[10px] text-muted-foreground mr-auto flex items-center gap-1">
          <Check className="w-3 h-3 text-emerald-500" />
          {toPersianDigits(doneRounds)} از {toPersianDigits(maxRounds)} دور ثبت شده
        </span>
      </div>

      {/* کارت دور فعال — همهٔ اعضا پشت سر هم + یک تیک برای کل دور */}
      <div
        className={`rounded-3xl border-2 overflow-hidden ${roundDone ? "border-emerald-200 bg-emerald-50/40" : "bg-white"}`}
        style={roundDone ? undefined : { borderColor: connectorColor }}
      >
        {/* هدر دور */}
        <div
          className={`px-4 py-2.5 flex items-center justify-between border-b ${
            roundDone ? "border-emerald-100 bg-emerald-50" : "bg-muted/40 border-border/60"
          }`}
        >
          <span className="font-black text-sm">
            {roundDone ? "ثبت شد" : "محل ثبت وزنه و تکرار"} — ست {toPersianDigits(activeRound)} از{" "}
            {toPersianDigits(maxRounds)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            هر دو را پر کن، بعد یک تیک
          </span>
        </div>

        {/* ردیف اعضا — دقیقاً مثل درخواست مالک: حرکت اول، زیرش حرکت دوم */}
        <div className="p-3 space-y-2.5">
          {step.exercises.map((ex, mi) => {
            const setDef = memberSetFor(ex, activeRound);
            const key = `${ex.id}:${activeRound}`;
            const done = isDone(ex.id, activeRound);
            return (
              <div
                key={ex.id}
                className={`rounded-2xl border p-2.5 ${done ? "border-primary/40 bg-primary/5" : "border-border"}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    dir="ltr"
                    className={`text-[10px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${memberAccentCls}`}
                  >
                    {groupMemberLabel(step.group, mi)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{ex.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {ex.muscle}
                      {setDef ? ` • ${formatSetGoal(setDef)}` : ""}
                    </p>
                  </div>
                  {done && <Check className="w-4 h-4 text-primary shrink-0" strokeWidth={3} />}
                </div>
                {setDef ? (
                  <>
                    <ExerciseMediaBlock exercise={ex} canViewVideos={canViewVideos} variant="row" />
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">وزنه (kg)</label>
                        <Input
                          type="number"
                          dir="ltr"
                          inputMode="decimal"
                          placeholder={done ? toPersianDigits(loggedSets[ex.id]?.[activeRound - 1]?.weight || 0) : "مثلاً ۲۰"}
                          value={inputs[key]?.w ?? ""}
                          onChange={(e) => writeInput(ex.id, "w", e.target.value)}
                          disabled={done}
                          className="h-9 rounded-lg text-center text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">تکرار واقعی</label>
                        <Input
                          type="number"
                          dir="ltr"
                          inputMode="numeric"
                          placeholder={done ? toPersianDigits(loggedSets[ex.id]?.[activeRound - 1]?.reps || 0) : "مثلاً ۱۲"}
                          value={inputs[key]?.r ?? ""}
                          onChange={(e) => writeInput(ex.id, "r", e.target.value)}
                          disabled={done}
                          className="h-9 rounded-lg text-center text-sm"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-muted-foreground py-1.5">
                    این حرکت در ست {toPersianDigits(activeRound)} ست ندارد — فقط حرکت بالا را ثبت کن
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* تیک واحد دور → استراحت */}
        <div className="px-3 pb-3">
          {roundDone ? (
            <div className="w-full h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center gap-2 text-sm font-black">
              <Check className="w-4 h-4" strokeWidth={3} />
              ست {toPersianDigits(activeRound)} هر دو حرکت ثبت شد
            </div>
          ) : (
            <Button
              className="w-full h-11 rounded-xl bg-gradient-to-l from-primary to-amber-500 text-primary-foreground font-black"
              onClick={completeRound}
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              تکمیل ست {toPersianDigits(activeRound)} گروه
            </Button>
          )}
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

/** v168 — hydrate پیش‌نویس‌های «یک دور کامل گروه» (الگوی hydrateDrafts) */
function hydrateRoundDrafts(
  step: Extract<GroupedExercise, { type: "group" }>,
  round: number,
  draftsRef: DraftsStore
): Record<string, { w?: string; r?: string }> {
  const out: Record<string, { w?: string; r?: string }> = {};
  for (const ex of step.exercises) {
    if (!memberSetFor(ex, round)) continue;
    const d = draftsRef.current[`${ex.id}:${round}`];
    if (d && (d.w != null || d.r != null)) out[`${ex.id}:${round}`] = d;
  }
  return out;
}

/**
 * v168 — بلوک رسانهٔ حرکت (ویدیو + توضیحات + نکات) — مشترک بین کارت تکی و
 * ردیف‌های عضو گروه. درخواست مالک: «با این تغییر همچنان باید ویدیو و توضیحات
 * وجود داشته باشه».
 *  • variant="full": نمایش قبلی کارت تکی — جعبهٔ ویدیو همیشه باز + دکمهٔ «توضیحات»
 *  • variant="row": ردیف عضو گروه — جمع‌شده با دکمهٔ «ویدیو و توضیحات»؛ با باز
 *    شدن، همان ویدیو/توضیحات/نکات داخل ردیف رندر می‌شود (بدون هیچ اورلی)
 */
function ExerciseMediaBlock({
  exercise,
  canViewVideos,
  variant,
}: {
  exercise: PlanExercise;
  canViewVideos: boolean;
  variant: "full" | "row";
}) {
  const libInfo = useExerciseLibInfo(exercise);
  const resolvedVideo = canViewVideos ? resolveExerciseVideoSrc(libInfo) : null;
  const [open, setOpen] = useState(variant === "full");
  const [showInfo, setShowInfo] = useState(false);

  if (variant === "row" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-600 hover:bg-orange-100 active:scale-[0.98] transition text-[10px] font-black"
      >
        <Play className="w-3 h-3" />
        ویدیو و توضیحات
        <ChevronDown className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className={variant === "row" ? "space-y-2" : undefined}>
      {variant === "row" && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground transition"
        >
          <ChevronDown className="w-3 h-3 rotate-180" />
          بستن ویدیو و توضیحات
        </button>
      )}

      {/* ویدیو — v118: مستقیم داخل جعبهٔ تصویر (بدون اورلی) */}
      <div
        className={`relative rounded-3xl bg-orange-50 border border-orange-100 overflow-hidden ${
          variant === "full" ? "h-44 mb-4" : "h-36"
        }`}
      >
        {resolvedVideo?.kind === "file" ? (
          <video
            src={`${resolvedVideo.src}#t=0.1`}
            poster={resolvedVideo.poster || undefined}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover bg-black"
          />
        ) : resolvedVideo?.kind === "youtube" ? (
          <iframe
            src={resolvedVideo.src}
            title={`ویدیو آموزشی ${exercise.name}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 w-full h-full bg-black"
          />
        ) : (
          <>
            {/* فال‌بک: دمبل (لودینگ / بدون ویدیو / قفل پلن) */}
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-4 right-4 w-24 h-24 rounded-full bg-primary/40 blur-2xl" />
              <div className="absolute bottom-4 left-4 w-20 h-20 rounded-full bg-amber-500/40 blur-2xl" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-amber-500 flex items-center justify-center shadow-2xl">
                <Dumbbell className="w-10 h-10 text-primary-foreground" />
              </div>
            </div>
            {!canViewVideos ? (
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/70 text-white text-[10px]">
                <Lock className="w-3 h-3" />
                ویدیو با پلن پیشرفته
              </div>
            ) : libInfo === null ? (
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 text-[10px]">
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                در حال بارگذاری ویدیو…
              </div>
            ) : (
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 text-[10px]">
                <Play className="w-3 h-3 text-primary" />
                ویدیو به‌زودی
              </div>
            )}
          </>
        )}
        {/* عضله — روی ویدیو */}
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 text-[10px]">
          <Flame className="w-3 h-3 text-primary" />
          {exercise.muscle}
        </div>
        {/* دکمهٔ توضیحات — فقط توضیحات (v118 — درخواست مالک) */}
        <button
          onClick={() => setShowInfo((v) => !v)}
          aria-expanded={showInfo}
          className={`absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-[11px] font-bold shadow-lg transition ${
            showInfo ? "bg-slate-800 hover:bg-slate-900" : "bg-orange-500 hover:bg-orange-600"
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          توضیحات
        </button>
      </div>

      {/* v169 — هشدار فیلترشکن زیر ویدیوی یوتیوب (دیرکتیو مالک) */}
      {resolvedVideo?.kind === "youtube" && <YoutubeVpnNote variant="inline" />}

      {/* پنل توضیحات درون‌کارت (نحوهٔ انجام + نکات ایمنی از بانک حرکات) */}
      {showInfo && (
        <div className={`${variant === "full" ? "mb-4" : ""} space-y-2`}>
          <div className="p-3 rounded-2xl bg-card border border-border">
            <p className="text-xs font-bold text-foreground mb-1 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-primary" />
              نحوه انجام
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {libInfo?.description || exercise.description || "توضیحاتی برای این حرکت ثبت نشده است."}
            </p>
          </div>
          {(libInfo?.tips || exercise.tips) && (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                نکات ایمنی
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                {libInfo?.tips || exercise.tips}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ExerciseCard = memo(function ExerciseCard({
  exercise,
  loggedSets,
  canViewVideos,
  draftsRef,
  onCompleteSet,
}: {
  exercise: PlanExercise;
  loggedSets: LoggedSetEntry[];
  canViewVideos: boolean;
  draftsRef: DraftsStore;
  onCompleteSet: (exercise: PlanExercise, setNumber: number, restSec: number, weight: number, reps: number) => void;
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
      {/* v168 — ویدیو + توضیحات (مشترک با ردیف‌های گروه — ExerciseMediaBlock) */}
      <ExerciseMediaBlock exercise={exercise} canViewVideos={canViewVideos} variant="full" />

      <div className="flex items-center gap-2 mb-1">
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
