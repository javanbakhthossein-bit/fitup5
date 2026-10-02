"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Music,
  Plus,
  Check,
  Dumbbell,
  Clock,
  Zap,
  ChevronLeft,
  Volume2,
  ListMusic,
  Trash2,
  Bot,
  Info,
  Repeat,
} from "lucide-react";
import { useAppStore, type GymTrack } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { toPersianDigits, PERSIAN_WEEKDAYS, type PlanExercise } from "@/lib/fitness/types";
import { formatSetsSummaryShort, formatSetGoal } from "@/lib/fitness/workout-display";
import {
  groupMaxRounds,
  memberSetFor,
  groupRoundRestSec,
  isGroupRoundDone,
  type GroupedExercise,
} from "@/lib/fitness/workout-groups";
import { toast } from "sonner";
import {
  saveTrackToDB,
  loadTracksFromDB,
  deleteTrackFromDB,
} from "@/lib/fitness/gym-playlist-db";
import { SmartCoachChatView } from "./smart-coach-chat-view";
import { groupExercises, groupTypeLabel } from "./workouts-view";
import { ExerciseDetailModal } from "./programs-view";
import { markExerciseModalJustClosed } from "@/lib/fitness/exercise-modal-guard";
import {
  DailyMedalBadge,
  DailyMedalCelebration,
  claimMedalCelebration,
  reportDailyStatus,
  useDailyStatusLoader,
} from "@/components/fitness/daily-medal";
import {
  useSetLogStore,
  dayLogKey,
  hydrateSetLogStore,
} from "@/lib/fitness/set-log-store";
import { GymWorkoutCelebration } from "@/components/fitness/gym-workout-celebration";

/** رکوردهای خالی پایدار — برای خروجی پیش‌فرض سلکتورهای store (بدون ساخت شیء جدید در هر رندر) */
const EMPTY_STR_RECORD: Record<string, string> = {};
const EMPTY_BOOL_RECORD: Record<string, boolean> = {};

/** بیپ — پایان شمارش معکوس استراحت (همان رویکرد active-workout-session) */
function gymBeep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
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

export function GymModeView() {
  const {
    setOverlay,
    workoutPlan,
    gymPlaylist,
    setGymPlaylist,
    dailyStatus,
    user,
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const [currentTrackIdx, setCurrentTrackIdx] = useState(0);
  const currentTrack = gymPlaylist[currentTrackIdx];
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);

  // ─── v148: state «ثبت ست» حالا از فروشگاه مشترک زوستند می‌آید (سینک دوطرفه) ───
  // دیرکتیو مالک: هرچه در جیم‌مود یا «تمرین امروز» ثبت شود باید در دیگری هم دیده شود.
  // کلید روز = «تاریخ تهران|نام روز» (dayLogKey) — هر دو نما با نام روز کلید می‌زنند.
  const activeDay = workoutPlan?.days?.[selectedDayIdx];
  const activeDayName = activeDay?.day ?? "";
  const activeDayKey = activeDayName ? dayLogKey(activeDayName) : "";
  const dayLog = useSetLogStore((s) => (activeDayKey ? s.days[activeDayKey] : undefined));
  const lastSync = useSetLogStore((s) => s.lastSync);
  const setWeights = dayLog?.weights ?? EMPTY_STR_RECORD;
  const setReps = dayLog?.reps ?? EMPTY_STR_RECORD;
  const doneSets = dayLog?.sets ?? EMPTY_BOOL_RECORD;
  const [chatOpen, setChatOpen] = useState(false);
  // v46: همپوشانی FAB چت با ورودی ست‌ها/تیک — وقتی کاربر نزدیک انتهای لیست است
  // (جایی که ردیف‌های وزنه/تکرار/تیک هستند) دکمهٔ چت محو می‌شود تا تیک و اینپوت‌ها
  // هرگز پوشانده نشوند؛ با اسکرول به بالا دوباره ظاهر می‌شود.
  const workoutScrollRef = useRef<HTMLDivElement>(null);
  const [fabHidden, setFabHidden] = useState(false);
  // حرکتی که جزئیات آن در modal نمایش داده می‌شود (Info icon)
  const [detailExercise, setDetailExercise] = useState<PlanExercise | null>(null);
  // ─── Task 3-b: مدال روز کامل — جشن و گارد یک‌بار بودن ───
  const [medalOpen, setMedalOpen] = useState(false);
  // گارد لوکال این mount: اگر مدال همین حالا باز شد، POST بعدی دوباره بازش نکند
  const medalCelebratedRef = useRef(false);
  // بارگذاری یک‌بارهٔ وضعیت «روز کامل» هنگام باز شدن حالت باشگاه
  useDailyStatusLoader();

  // ─── v148: تایمر استراحت جذاب بعد از تیک هر ست ───
  // token با هر تیک جدید زیاد می‌شود → key کامپوننت تایمر عوض → شمارش تازه (فقط یک تایمر)
  // v168 — nextLabel/isFinal: شمارندهٔ استراحت هوشمند (حرکت بعدی/ست چندم/آخرین حرکت)
  const [rest, setRest] = useState<{
    seconds: number;
    token: number;
    nextLabel?: string;
    isFinal?: boolean;
  } | null>(null);

  // ─── v148: جشن بزرگ «تمرین امروز کامل شد» — قبل از مدال روز کامل ───
  const [finaleOpen, setFinaleOpen] = useState(false);
  const [finaleStats, setFinaleStats] = useState<{
    totalSets: number;
    volume: number | null;
    durationMin: number | null;
    bestWeight: number | null;
  } | null>(null);
  // فلش بصری «از «تمرین امروز» ثبت شد ✓» در هدر
  const [syncFlash, setSyncFlash] = useState(false);

  // اولین تیک جلسه → محاسبهٔ «مدت تقریبی» در جشن پایانی
  const sessionStartRef = useRef<number | null>(null);
  // گارد جشن بزرگ: یک‌بار به‌ازای هر dayKey در این mount
  const finaleShownRef = useRef<string | null>(null);
  // ردیابی گذار «همهٔ ست‌ها انجام شد» به‌ازای هر روز (روزِ از-قبل-کامل جشن ندارد)
  const allDoneStateRef = useRef<{ key: string; value: boolean } | null>(null);
  // آینهٔ finaleOpen برای callbackهای async (گزارش سرور)
  const finaleOpenRef = useRef(false);
  // مدالی که باید بعد از بسته‌شدن جشن بزرگ باز شود
  const pendingMedalRef = useRef(false);
  // گارد مهاجرت یک‌بارهٔ دادهٔ legacy جیم‌مود
  const migratedPlanRef = useRef(false);

  // --- Ref برای ردیابی «قصد پخش» هنگام تغییر ترک ---
  // وقتی کاربر روی ترک جدید کلیک می‌کند یا next/prev را می‌زند، این ref روی true
  // قرار می‌گیرد تا رویداد onPause (که هنگام تعویض src صادر می‌شود) باعث توقف
  // نمایش حالت «در حال پخش» نشود. سپس هنگام بارگذاری metadata ترک جدید،
  // play() صدا زده می‌شود.
  const pendingPlayRef = useRef(false);

  // Default to today's day
  useEffect(() => {
    if (workoutPlan) {
      const dayIdx = new Date().getDay();
      const persianIdx = (dayIdx + 1) % 7;
      const todayName = PERSIAN_WEEKDAYS[persianIdx];
      const idx = workoutPlan.days?.findIndex((d) => d.day === todayName) ?? -1;
      if (idx >= 0) setSelectedDayIdx(idx);
    }
  }, [workoutPlan]);

  // ─── v148: تیک‌ها/وزنه‌ها دیگر در localStorage جداگانهٔ جیم‌مود ذخیره نمی‌شوند ───
  // همه در فروشگاه مشترک «ثبت ست» (fitup_set_log_v1) با کلید روز
  // «تاریخ تهران|نام روز» — ماندگاری و پاکسازی خودکار (>۳ روز) داخل خود store.

  // کلید legacy قدیمی جیم‌مود (برای مهاجرت یک‌باره به فروشگاه مشترک)
  // ⚠️ تاریخ «محلی دستگاه» نه UTC — قبلاً toISOString().slice(0,10) تاریخ UTC
  // می‌داد و تا ساعت ۰۳:۳۰ بامداد تهران (UTC+3:30) کلیدِ روز قبل لود می‌شد.
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })(); // YYYY-MM-DD محلی

  // ─── v148: هایدریت فروشگاه مشترک «ثبت ست» (ماندگاری خودکار داخل خود store است) ───
  useEffect(() => {
    hydrateSetLogStore();
  }, []);

  // ─── v148: مهاجرت یک‌بارهٔ دادهٔ legacy (کلیدهای gym_session_*) به فروشگاه مشترک ───
  // برای همهٔ روزهای برنامه: اگر کلید قدیمیِ امروزِِ آن روز داده داشت و store برای
  // همان dayLogKey خالی بود → importDayLog و بعد حذف کلید قدیمی. اگر store از قبل
  // (مثلاً از «تمرین امروز») داده داشت → دادهٔ store مقدس است و کلید قدیمی حذف می‌شود.
  useEffect(() => {
    if (!workoutPlan || migratedPlanRef.current) return;
    migratedPlanRef.current = true;
    try {
      workoutPlan.days?.forEach((d, i) => {
        const legacyKey = `gym_session_${todayKey}_day${i}`;
        const raw = localStorage.getItem(legacyKey);
        if (!raw) return;
        const storeKey = dayLogKey(d.day);
        const existing = useSetLogStore.getState().days[storeKey];
        const storeHasData =
          !!existing &&
          (Object.keys(existing.sets).length > 0 ||
            Object.keys(existing.weights).length > 0 ||
            Object.keys(existing.reps).length > 0);
        if (!storeHasData) {
          const parsed = JSON.parse(raw) as {
            weights?: Record<string, string>;
            reps?: Record<string, string>;
            done?: Record<string, boolean>;
          };
          const log = {
            sets: parsed.done ?? {},
            weights: parsed.weights ?? {},
            reps: parsed.reps ?? {},
          };
          if (
            Object.keys(log.sets).length > 0 ||
            Object.keys(log.weights).length > 0 ||
            Object.keys(log.reps).length > 0
          ) {
            useSetLogStore.getState().importDayLog(storeKey, log, "gym_mode");
          }
        }
        localStorage.removeItem(legacyKey);
      });
    } catch {
      // دادهٔ خراب — بی‌صدا رد شو
    }
  }, [workoutPlan, todayKey]);

  // ─── پاک‌سازی کلیدهای legacy قدیمی (بیش از ۲ روز) ───
  // (فروشگاه مشترک خودش داده‌های >۳ روز را prune می‌کند؛ این حلقه فقط کلیدهای
  //  قدیمی gym_session_* را جمع می‌کند تا localStorage شلوغ نماند)
  useEffect(() => {
    try {
      const keys = Object.keys(localStorage);
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      for (const key of keys) {
        if (key.startsWith("gym_session_")) {
          // تاریخ را از کلید استخراج کن
          const match = key.match(/gym_session_(\d{4}-\d{2}-\d{2})_day/);
          if (match && match[1] < twoDaysAgo) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch {}
  }, []);

  // ─── v148: فلش بصری «از «تمرین امروز» ثبت شد ✓» ───
  // وقتی نمای مقابل (تمرین امروز) برای همین روز چیزی ثبت کرد، چیپ انیمیشنی ۳ ثانیه
  // در هدر نمایش داده می‌شود و بعد خودکار مخفی می‌شود.
  useEffect(() => {
    if (!lastSync || lastSync.source !== "today_workout" || lastSync.dayKey !== activeDayKey) {
      setSyncFlash(false);
      return;
    }
    setSyncFlash(true);
    const t = setTimeout(() => setSyncFlash(false), 3000);
    return () => clearTimeout(t);
  }, [lastSync, activeDayKey]);

  // نشانگر همیشگی «همگام با تمرین امروز» — وقتی روزِ انتخابی هر داده‌ای در store دارد
  const dayHasData = useMemo(() => {
    if (!dayLog) return false;
    return (
      Object.keys(dayLog.sets).length > 0 ||
      Object.keys(dayLog.weights).length > 0 ||
      Object.keys(dayLog.reps).length > 0
    );
  }, [dayLog]);

  // ─── Hydrate playlist from IndexedDB on every mount ───
  // Object URLs are session-specific, so we always rebuild them from the
  // persisted Blobs stored in IndexedDB. Any stale URLs in the store are
  // revoked first to avoid memory leaks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadTracksFromDB();
      if (cancelled) return;
      // Revoke any stale URLs from a previous mount
      const stale = useAppStore.getState().gymPlaylist;
      stale.forEach((t) => {
        try { URL.revokeObjectURL(t.url); } catch {}
      });
      const tracks: GymTrack[] = stored.map((s) => ({
        id: s.id,
        name: s.name,
        url: URL.createObjectURL(s.blob),
        blob: s.blob,
      }));
      setGymPlaylist(tracks);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Revoke object URLs on unmount to avoid memory leaks ───
  // (the playlist itself persists in IndexedDB; URLs are re-created next mount)
  useEffect(() => {
    return () => {
      const tracks = useAppStore.getState().gymPlaylist;
      tracks.forEach((t) => {
        try {
          URL.revokeObjectURL(t.url);
        } catch {}
      });
    };
  }, []);

  // Audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => {
      setDuration(audio.duration || 0);
      // When a new track's metadata is loaded and we intend to play, start playback.
      // This is the reliable path: play() after metadata is loaded won't be blocked
      // by the browser's autoplay policy because it's triggered by user interaction.
      if (pendingPlayRef.current) {
        audio.play().catch(() => {});
      }
    };
    const onEnd = () => next();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIdx, gymPlaylist]);

  // ─── Explicitly start playback whenever the active track URL changes ───
  // changing `src` doesn't always honor the `autoPlay` attribute, especially
  // when the audio element was previously paused. So when isPlaying is true
  // and the current track URL changes (e.g. user clicked a different track),
  // we explicitly call play(). This effect also serves as a fallback for the
  // onLoadedMetadata handler below.
  useEffect(() => {
    if (!currentTrack?.url) return;
    // If we're switching tracks with intent to play, mark the ref so the
    // pause event fired during src reload doesn't reset isPlaying.
    // The actual play() call happens in onLoadedMetadata (when the new src
    // is ready) — but we also try play() here as a fallback.
    const audio = audioRef.current;
    if (!audio) return;
    if (pendingPlayRef.current) {
      // Try to play immediately; if it fails (src still loading), the
      // onLoadedMetadata handler will retry.
      audio.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const fileArr = Array.from(files).filter((f) => f.type.startsWith("audio/"));
    if (fileArr.length === 0) {
      toast.error("فقط فایل‌های صوتی پخش می‌شوند");
      return;
    }
    const tracks: GymTrack[] = fileArr.map((f) => ({
      id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: f.name.replace(/\.[^/.]+$/, ""),
      url: URL.createObjectURL(f),
      blob: f,
    }));
    setGymPlaylist([...gymPlaylist, ...tracks]);
    toast.success(`${toPersianDigits(tracks.length)} آهنگ به لیست اضافه شد 🎵`);
    e.target.value = "";
    // Persist to IndexedDB (fire-and-forget)
    await Promise.all(
      tracks.map((t) =>
        t.blob
          ? saveTrackToDB({ id: t.id, name: t.name, blob: t.blob })
          : Promise.resolve()
      )
    );
  }

  function togglePlay() {
    if (gymPlaylist.length === 0) {
      fileInputRef.current?.click();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      pendingPlayRef.current = false;
      audio.pause();
      setIsPlaying(false);
    } else {
      pendingPlayRef.current = true;
      audio.play().catch(() => {
        // If play() fails (e.g., src not loaded yet), onLoadedMetadata will retry.
      });
      setIsPlaying(true);
    }
  }

  function next() {
    if (gymPlaylist.length === 0) return;
    const idx = (currentTrackIdx + 1) % gymPlaylist.length;
    pendingPlayRef.current = true;
    setCurrentTrackIdx(idx);
    setProgress(0);
    setIsPlaying(true);
  }

  function prev() {
    if (gymPlaylist.length === 0) return;
    const idx = (currentTrackIdx - 1 + gymPlaylist.length) % gymPlaylist.length;
    pendingPlayRef.current = true;
    setCurrentTrackIdx(idx);
    setProgress(0);
    setIsPlaying(true);
  }

  function playTrack(idx: number) {
    if (idx === currentTrackIdx) {
      // کلیک روی ترک در حال پخش → toggle
      togglePlay();
      return;
    }
    // کلیک روی ترک متفاوت → آن را پخش کن
    pendingPlayRef.current = true;
    setCurrentTrackIdx(idx);
    setProgress(0);
    setIsPlaying(true);
  }

  function removeTrack(id: string) {
    const track = gymPlaylist.find((t) => t.id === id);
    if (track) URL.revokeObjectURL(track.url);
    const filtered = gymPlaylist.filter((t) => t.id !== id);
    setGymPlaylist(filtered);
    if (currentTrackIdx >= filtered.length) setCurrentTrackIdx(0);
    // Also delete from IndexedDB
    void deleteTrackFromDB(id);
  }

  // ─── Seek bar (mouse + touch) ───
  function seekFromClientX(clientX: number) {
    const el = progressBarRef.current;
    if (!el || !duration || !audioRef.current) return;
    const rect = el.getBoundingClientRect();
    // RTL-aware: in RTL the bar fills from right to left visually,
    // but the audio currentTime is always 0→duration left-to-right logically.
    // We compute the fraction from the left edge for both LTR and RTL.
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * duration;
    setProgress(pct * duration);
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    seekFromClientX(e.clientX);
  }

  function handleTouchSeek(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    seekFromClientX(touch.clientX);
    // Prevent the browser from scrolling while dragging the seek bar
    e.preventDefault();
  }

  // ─── v148: گروه‌بندی حرکات روز — برای منطق استراحت گروه و راهنمای «ست بعدی» ───
  const groupedSteps = useMemo(
    () => (activeDay?.exercises ? groupExercises(activeDay.exercises) : []),
    [activeDay]
  );

  /**
   * v168 — «بعدی» برای شمارندهٔ هوشمند استراحت: بعد از ثبت ست N از گام stepIdx،
   * اولین ستِ انجام‌نشدهٔ کل روز پیدا می‌شود (دور بعدی گروه / ست بعدی حرکت /
   * حرکت بعد) — و اگر هیچی نماند isFinal=true (بعدش جشن است).
   */
  function findNextUp(afterStepIdx: number, afterSetNumber: number): { label: string; isFinal: boolean } {
    const isDone = (exId: string, n: number) => !!doneSets[`${exId}_${n}`];
    for (let si = afterStepIdx; si < groupedSteps.length; si++) {
      const st = groupedSteps[si];
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
        const total = ex.sets?.length ?? 0;
        for (let n = fromSet; n <= total; n++) {
          if (!isDone(ex.id, n)) {
            return { label: `ست ${toPersianDigits(n)} — ${ex.name}`, isFinal: false };
          }
        }
      }
    }
    return { label: "آخرین ست تمرین!", isFinal: true };
  }

  /**
   * تکمیل یک ست در جیم‌مود — ثبت در فروشگاه مشترک «ثبت ست» (v148).
   *
   * نکته مهم: اینجا عمداً startSession/logSet (جلسه سراسری) صدا زده نمی‌شود.
   * قبلاً تیک زدن ست، صفحه «جلسه تمرین» (ActiveWorkoutSession) تمام‌صفحه را
   * روی جیم‌مود باز می‌کرد — صفحه‌ای با طراحی ناهماهنگ با جیم‌مود و دکمه خروج
   * مبتنی بر confirm() مرورگر که در WebView/PWA مسدود است و کاربر گیر می‌کرد.
   * جیم‌مود خودش ردیابی کامل دارد: ورودی وزنه/تکرار، تیک هر ست، ماندگاری خودکار
   * در فروشگاه مشترک (سینک دوطرفه با «تمرین امروز») و جشن پایان روز.
   * جلسه هدایت‌شده (با تایمر استراحت و تخمین کالری) از تب «تمرین‌ها» با دکمه
   * «شروع تمرین» به‌صورت آگاهانه شروع می‌شود — نه از داخل جیم‌مود.
   *
   * v148 — بعد از تیک:
   *  • تایمر استراحت جذاب با restSec همان ست شروع می‌شود (برای عضو آخر گروه در
   *    آخرین ستش، restBetweenRounds گروه — آینهٔ active-workout-session).
   *    restSec <= 0 → بدون تایمر. اگر همین تیک کل روز را کامل می‌کند → تایمر
   *    نمی‌آید (جشن بزرگ می‌آید).
   */
  function completeSet(exerciseId: string, setNumber: number) {
    if (!activeDayKey) return;
    const key = `${exerciseId}_${setNumber}`;
    if (doneSets[key]) return; // قبلاً ثبت شده (دکمه هم disabled است)
    const ex = activeDay?.exercises?.find((e) => e.id === exerciseId);
    if (!ex) return;

    // اولین تیک جلسه → ساعت شروع session برای «مدت تقریبی» جشن پایانی
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();

    // ثبت در فروشگاه مشترک — نمای «تمرین امروز» همزمان می‌بیند (سینک زنده)
    useSetLogStore.getState().toggleSet(activeDayKey, exerciseId, setNumber, true, "gym_mode");
    toast.success(`ست ${toPersianDigits(setNumber)} انجام شد! 💪`);

    // آخرین ستِ کل روز؟ → بدون تایمر استراحت — جشن بزرگ می‌آید
    const willCompleteDay = doneSetsActiveDay + 1 >= totalSetsActiveDay;
    if (willCompleteDay) return;

    // v168 — شمارندهٔ استراحت هوشمند: «بعدی چیست؟ ست چندم است؟ آخرین حرکت است؟»
    const stepIdx = Math.max(
      0,
      groupedSteps.findIndex(
        (st) => st.type === "single" ? st.exercise.id === exerciseId : st.exercises.some((m) => m.id === exerciseId)
      )
    );
    const next = findNextUp(stepIdx, setNumber);

    // استراحت: restSec همان ست (منطق گروه برای سازگاری داده‌های قدیمی حفظ شده —
    // مسیر اصلی گروه‌ها از completeGroupRound می‌گذرد)
    const setDef = ex.sets?.find((s) => s.setNumber === setNumber);
    let restSec = setDef?.restSec ?? 0;
    const groupStep = groupedSteps.find(
      (st) => st.type === "group" && st.exercises.some((m) => m.id === exerciseId)
    );
    if (groupStep && groupStep.type === "group") {
      const lastMember = groupStep.exercises[groupStep.exercises.length - 1];
      const isLastMemberLastSet =
        exerciseId === lastMember.id && setNumber >= (ex.sets?.length ?? 0);
      if (isLastMemberLastSet) {
        restSec =
          typeof groupStep.restBetweenRounds === "number"
            ? groupStep.restBetweenRounds
            : restSec;
      }
    }
    if (restSec > 0) {
      setRest((r) => ({
        seconds: restSec,
        token: (r?.token ?? 0) + 1,
        nextLabel: next.label,
        isFinal: next.isFinal,
      }));
    }
  }

  /**
   * v168 — تکمیل یک «دور» کامل گروه با یک تیک (درخواست مالک):
   * «بالاسینه هالتر و پرس سینه دمبل … با پر کردن جفتشون یک تیک زده بشه و
   * بره برای استراحت» — همهٔ اعضای دارای ست N ثبت می‌شوند؛ بعد استراحت دور
   * (restBetweenRounds یا restSec عضو آخر) با برچسب هوشمند بعدی شروع می‌شود.
   */
  function completeGroupRound(
    item: Extract<GroupedExercise, { type: "group" }>,
    setNumber: number
  ) {
    if (!activeDayKey) return;
    if (isGroupRoundDone(item, setNumber, (exId, n) => !!doneSets[`${exId}_${n}`])) return;

    // اولین تیک جلسه → ساعت شروع session برای «مدت تقریبی» جشن پایانی
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();

    let newCount = 0;
    for (const ex of item.exercises) {
      const setDef = memberSetFor(ex, setNumber);
      if (!setDef) continue; // عضو بدون ست N — در این دور نقش ندارد
      const key = `${ex.id}_${setNumber}`;
      if (doneSets[key]) continue;
      useSetLogStore.getState().toggleSet(activeDayKey, ex.id, setNumber, true, "gym_mode");
      newCount++;
    }
    if (newCount === 0) return;
    toast.success(`ست ${toPersianDigits(setNumber)} گروه انجام شد! 💪`);

    // آخرین ستِ کل روز؟ → بدون تایمر استراحت — جشن بزرگ می‌آید
    const willCompleteDay = doneSetsActiveDay + newCount >= totalSetsActiveDay;
    if (willCompleteDay) return;

    const stepIdx = Math.max(
      0,
      groupedSteps.findIndex((st) => st.type === "group" && st.group === item.group)
    );
    const next = findNextUp(stepIdx, setNumber);
    const restSec = groupRoundRestSec(item, setNumber);
    if (restSec > 0) {
      setRest((r) => ({
        seconds: restSec,
        token: (r?.token ?? 0) + 1,
        nextLabel: next.label,
        isFinal: next.isFinal,
      }));
    }
  }

  // ─── v148: ورودی وزنه/تکرار — نوشتن مستقیم در فروشگاه مشترک ───
  const handleWeightInput = useCallback(
    (exId: string, setNumber: number, value: string) => {
      if (!activeDayKey) return;
      useSetLogStore.getState().setWeight(activeDayKey, exId, setNumber, value, "gym_mode");
    },
    [activeDayKey]
  );
  const handleRepInput = useCallback(
    (exId: string, setNumber: number, value: string) => {
      if (!activeDayKey) return;
      useSetLogStore.getState().setRep(activeDayKey, exId, setNumber, value, "gym_mode");
    },
    [activeDayKey]
  );

  // ─── پیام انگیزشی + جشن بزرگ بعد از تکمیل همه ست‌های روز تمرین ───
  // محاسبه تعداد کل ست‌ها و ست‌های انجام‌شده در روز فعال.
  // v148: فقط گذار «ناکامل → کامل» جشن می‌گیرد (روزِ از-قبل-کامل جشن ندارد) و
  // جشن بزرگ یک‌بار به‌ازای هر dayKey نمایش داده می‌شود.
  const totalSetsActiveDay =
    activeDay?.exercises?.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0) ?? 0;
  const doneSetsActiveDay =
    activeDay?.exercises?.reduce((sum, ex) => {
      return (
        sum +
        (ex.sets?.filter((s) => doneSets[`${ex.id}_${s.setNumber}`]).length || 0)
      );
    }, 0) ?? 0;

  useEffect(() => {
    if (!activeDayKey || totalSetsActiveDay === 0) return;
    const allDoneNow = doneSetsActiveDay >= totalSetsActiveDay;
    const prev = allDoneStateRef.current;
    const sameDay = prev?.key === activeDayKey;
    const wasAllDone = sameDay ? (prev?.value ?? false) : null;
    allDoneStateRef.current = { key: activeDayKey, value: allDoneNow };

    if (wasAllDone === null) return; // اولین محاسبهٔ این روز — فقط ثبت (روزِ از-قبل-کامل جشن ندارد)
    if (!(allDoneNow && !wasAllDone)) return; // فقط گذار false→true جشن می‌گیرد
    if (finaleShownRef.current === activeDayKey) return; // همین mount قبلاً نشان داده شده
    finaleShownRef.current = activeDayKey;
    finaleOpenRef.current = true;
    setRest(null); // اگر تایمر استراحت باز است ببند — جشن اولویت دارد

    const MOTIVATIONAL_MESSAGES = [
      "آفرین! امروز عالی تمرین کردی! 💪🔥",
      "تو قهرمانی! هر ست رو با قدرت تمام کردی! 🏆",
      "بی‌نظیر بود! فردا هم همین‌طور ادامه بده! ⚡",
      "خوب بود! بدنت در حال تغییره — به خودت افتخار کن! 💯",
    ];
    const msg =
      MOTIVATIONAL_MESSAGES[
        Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)
      ];
    toast.success(msg, { duration: 6000 });

    // ─── آمار جشن بزرگ ───
    // تعداد کل ست‌ها، حجم کل (وزنه×تکرار فقط از ورودی‌های واقعیِ موجود —
    // پارس امن، خالی‌ها رد می‌شوند؛ هیچ ورودی → «—»)، مدت تقریبی از اولین تیک،
    // بهترین ست (v168 — سنگین‌ترین وزنهٔ ثبت‌شدهٔ روز برای شخصی‌سازی جشن)
    const log = useSetLogStore.getState().days[activeDayKey];
    let doneCount = 0;
    let volume = 0;
    let hasVolume = false;
    let bestWeight: number | null = null;
    for (const ex of activeDay?.exercises ?? []) {
      for (const s of ex.sets ?? []) {
        const k = `${ex.id}_${s.setNumber}`;
        if (!log?.sets[k]) continue;
        doneCount++;
        const w = parseFloat((log.weights[k] ?? "").replace(",", "."));
        const rMatch = /(\d+(?:\.\d+)?)/.exec(log.reps[k] ?? "");
        const r = rMatch ? parseFloat(rMatch[1]) : NaN;
        if (Number.isFinite(w) && w > 0) {
          if (bestWeight === null || w > bestWeight) bestWeight = w;
          if (Number.isFinite(r) && r > 0) {
            volume += w * r;
            hasVolume = true;
          }
        }
      }
    }
    const start = sessionStartRef.current;
    setFinaleStats({
      totalSets: doneCount,
      volume: hasVolume ? volume : null,
      durationMin: start ? Math.max(1, Math.round((Date.now() - start) / 60000)) : null,
      bestWeight,
    });
    setFinaleOpen(true);

    // ─── Task 3-b: ثبت تکمیل تمرین (گیم‌مود) در سرور → اگر روز کامل شد، مدال ───
    // ثبت سمت سرور یک‌بار در روز انجام می‌شود (DayCompletion)؛ سینک با
    // تغذیه خودکار است: اگر تغذیهٔ امروز کامل باشد، پاسخ dayComplete=true
    // می‌دهد. v148: مدال بلافاصله باز نمی‌شود — تا کاربر جشن بزرگ را ببندد
    // (زنجیرهٔ جشن، بدون هم‌پوشانی).
    void (async () => {
      const data = await reportDailyStatus({
        workout: { done: true, source: "gym_mode" },
      });
      if (!data) return;
      if (
        data.dayComplete &&
        !data.medalSeenAt &&
        !medalCelebratedRef.current &&
        claimMedalCelebration(data.date)
      ) {
        medalCelebratedRef.current = true;
        if (finaleOpenRef.current) {
          pendingMedalRef.current = true; // بعد از بسته‌شدن جشن بزرگ باز شود
        } else {
          setMedalOpen(true);
        }
      }
    })();
  }, [activeDayKey, totalSetsActiveDay, doneSetsActiveDay]);

  /** بستن جشن بزرگ → اگر مدال در انتظار بود، حالا باز شود (زنجیرهٔ جشن) */
  function handleFinaleClose() {
    finaleOpenRef.current = false;
    setFinaleOpen(false);
    if (pendingMedalRef.current) {
      pendingMedalRef.current = false;
      setMedalOpen(true);
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${toPersianDigits(m.toString().padStart(2, "0"))}:${toPersianDigits(sec.toString().padStart(2, "0"))}`;
  }

  return (
    <div
      className="flex flex-col h-full relative bg-gradient-to-b from-orange-50/40 via-white to-white"
      dir="rtl"
    >
      <input ref={fileInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={handleFileSelect} />
      <audio
        ref={audioRef}
        data-gym-music="true"
        src={currentTrack?.url}
        onPlay={() => {
          pendingPlayRef.current = false;
          setIsPlaying(true);
        }}
        onPause={() => {
          // هنگام تعویض src، رویداد pause به‌طور خودکار صادر می‌شود.
          // در این حالت نباید isPlaying را false کنیم چون قصد پخش داریم.
          if (!pendingPlayRef.current) {
            setIsPlaying(false);
          }
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setDuration(audio.duration || 0);
          // وقتی ترک جدید بارگذاری شد و قصد پخش داریم، پخش را شروع کن.
          // این زمانی critical است که play() در useEffect قبلی به‌دلیل
          // آماده‌نبودن src ناموفق بوده است.
          if (pendingPlayRef.current) {
            audio.play().catch(() => {
              pendingPlayRef.current = false;
            });
          }
        }}
      />

      {/* Header — clean white with orange accent */}
      <div className="flex items-center justify-between p-4 border-b border-orange-100 bg-white/95 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-md shrink-0 overflow-hidden"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-slate-900">حالت باشگاه</h2>
            <p className="text-[10px] text-slate-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              موزیک + برنامه تمرین روز
            </p>
          </div>
        </div>
        {/* ─── v148: سینک دوطرفه با «تمرین امروز» — فلش بصری + نشانگر همیشگی ─── */}
        <div className="flex-1 min-w-0 flex flex-col items-end gap-1">
          <AnimatePresence>
            {syncFlash && (
              <motion.span
                key="sync-flash"
                initial={{ opacity: 0, y: -8, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-700 text-[9px] font-black whitespace-nowrap shadow-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                از «تمرین امروز» ثبت شد ✓
              </motion.span>
            )}
          </AnimatePresence>
          {dayHasData && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-bold whitespace-nowrap">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
              همگام با تمرین امروز
            </span>
          )}
        </div>
        {/* ─── Task 3-b: بج مدال روز کامل — هدر مشترک تمرین/تغذیه ─── */}
        {dailyStatus.dayComplete && (
          <DailyMedalBadge size="sm" onClick={() => setMedalOpen(true)} />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOverlay(null)}
          className="rounded-full hover:bg-orange-50 text-slate-500 hover:text-orange-600"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Body: two columns on desktop (workout + chat), single column on mobile */}
      <div className="flex-1 flex min-h-0">
        {/* Main content: music player + workout program */}
        {/* v46: pb-28 فضای رزرو برای FAB چت — ردیف آخر ست‌ها دیگر زیر دکمه نمی‌رود؛
            onScroll نزدیکِ انتها FAB را مخفی می‌کند (ضد همپوشانی کامل) */}
        <div
          ref={workoutScrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const toBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setFabHidden(toBottom < 140);
          }}
          className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-28 space-y-4 max-w-5xl mx-auto w-full"
        >
        {/* MUSIC PLAYER */}
        <div className="bg-white rounded-3xl overflow-hidden border border-orange-100 shadow-sm">
          {/* Now playing visualizer */}
          <div className="relative h-32 bg-gradient-to-br from-orange-100 via-amber-50 to-orange-50 flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-2 right-4 w-24 h-24 rounded-full bg-orange-300/50 blur-3xl" />
              <div className="absolute bottom-2 left-4 w-20 h-20 rounded-full bg-amber-300/50 blur-3xl" />
            </div>
            <motion.div
              animate={isPlaying ? { scale: [1, 1.08, 1], rotate: [0, 4, -4, 0] } : {}}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="relative z-10"
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center shadow-xl"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  boxShadow: "0 10px 25px -5px rgba(249, 115, 22, 0.5)",
                }}
              >
                <Music className="w-8 h-8 text-white" strokeWidth={2.5} />
              </div>
            </motion.div>
            {/* Equalizer bars */}
            {isPlaying && (
              <div className="absolute bottom-3 left-4 flex items-end gap-0.5 h-6">
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 rounded-full"
                    style={{ background: "linear-gradient(180deg, #f59e0b, #f97316)" }}
                    animate={{ height: [6, 18, 10, 22, 8] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Track info + controls */}
          <div className="p-4">
            <div className="text-center mb-3">
              <p className="font-bold text-sm truncate text-slate-900">{currentTrack?.name || "هیچ آهنگی انتخاب نشده"}</p>
              <p className="text-[11px] text-slate-500">
                {gymPlaylist.length > 0
                  ? `آهنگ ${toPersianDigits(currentTrackIdx + 1)} از ${toPersianDigits(gymPlaylist.length)}`
                  : "از موسیقی‌های گوشیت اضافه کن"}
              </p>
            </div>

            {/* Progress bar (larger, touch-friendly, LTR-explicit for predictable seeking) */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-slate-500 font-mono shrink-0 w-10 text-center">{fmt(progress)}</span>
              <div
                ref={progressBarRef}
                dir="ltr"
                role="slider"
                aria-label="پیشرفت پخش"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration) || 0}
                aria-valuenow={Math.floor(progress) || 0}
                tabIndex={0}
                className="flex-1 h-3 bg-slate-100 rounded-full cursor-pointer relative touch-none select-none group"
                onClick={seek}
                onTouchStart={handleTouchSeek}
                onTouchMove={handleTouchSeek}
                onKeyDown={(e) => {
                  if (!duration || !audioRef.current) return;
                  if (e.key === "ArrowLeft") {
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                  } else if (e.key === "ArrowRight") {
                    audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
                  }
                }}
              >
                {/* Filled portion (LTR: grows from left to right) */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
                  style={{
                    width: `${duration ? (progress / duration) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #f59e0b, #f97316)",
                  }}
                />
                {/* Draggable thumb */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-full bg-white shadow-md border-2 border-orange-500 pointer-events-none opacity-90 group-hover:scale-110 transition"
                  style={{ left: `${duration ? (progress / duration) * 100 : 0}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 font-mono shrink-0 w-10 text-center">{fmt(duration)}</span>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4 mb-3">
              <button onClick={prev} disabled={gymPlaylist.length === 0} className="p-2 rounded-full hover:bg-orange-50 text-slate-700 transition disabled:opacity-30">
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={togglePlay}
                className="w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 transition"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  boxShadow: "0 10px 25px -5px rgba(249, 115, 22, 0.5)",
                }}
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current mr-0.5" />}
              </button>
              <button onClick={next} disabled={gymPlaylist.length === 0} className="p-2 rounded-full hover:bg-orange-50 text-slate-700 transition disabled:opacity-30">
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Volume + add music */}
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-slate-500" />
              <input
                type="range"
                dir="ltr"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="صدا"
                className="flex-1 accent-orange-500 h-1"
              />
              <Button size="sm" variant="outline" className="rounded-xl text-xs shrink-0 border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700" onClick={() => fileInputRef.current?.click()}>
                <Plus className="w-4 h-4" />
                افزودن موزیک
              </Button>
            </div>
          </div>

          {/* Playlist */}
          {gymPlaylist.length > 0 && (
            <div className="border-t border-orange-100 max-h-44 overflow-y-auto custom-scrollbar">
              <div className="flex items-center gap-1.5 px-4 py-2 text-[11px] text-slate-500 sticky top-0 bg-white/85 backdrop-blur">
                <ListMusic className="w-3.5 h-3.5" />
                لیست پخش ({toPersianDigits(gymPlaylist.length)})
              </div>
              {gymPlaylist.map((track, i) => (
                <div
                  key={track.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => playTrack(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      playTrack(i);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50/60 transition text-right group cursor-pointer ${
                    i === currentTrackIdx ? "bg-orange-50" : ""
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${i === currentTrackIdx ? "text-white" : "bg-slate-100 text-slate-600"}`} style={i === currentTrackIdx ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : undefined}>
                    {i === currentTrackIdx && isPlaying ? (
                      <div className="flex items-end gap-0.5 h-3">
                        {[0, 1, 2].map((j) => (
                          <motion.div key={j} className="w-0.5 bg-current rounded-full" animate={{ height: [3, 8, 3] }} transition={{ duration: 0.5, repeat: Infinity, delay: j * 0.1 }} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold">{toPersianDigits(i + 1)}</span>
                    )}
                  </div>
                  <span className={`flex-1 text-xs truncate ${i === currentTrackIdx ? "text-orange-600 font-bold" : "text-slate-700"}`}>{track.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-500 transition shrink-0"
                    aria-label="حذف آهنگ"
                    title="حذف از پلی‌لیست"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* DAY SELECTOR + WORKOUT PROGRAM */}
        <div className="bg-white rounded-3xl p-4 border border-orange-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm flex items-center gap-2 text-slate-900">
              <Dumbbell className="w-4 h-4 text-orange-500" />
              برنامه تمرین
            </h3>
            <span className="text-[11px] text-slate-500">روز را انتخاب کن</span>
          </div>

          {/* Day selector */}
          {workoutPlan && (
            <div
              className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-3"
              style={{
                touchAction: "pan-x pan-y",
                willChange: "scroll-position",
                overscrollBehaviorX: "contain",
                WebkitOverflowScrolling: "touch",
                scrollSnapType: "x proximity",
              } as CSSProperties}
            >
              {workoutPlan.days.map((day, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedDayIdx(i)}
                  style={{ scrollSnapAlign: "start" }}
                  className={`shrink-0 px-3 py-2 rounded-2xl border-2 transition text-center min-w-[80px] ${
                    selectedDayIdx === i
                      ? "border-orange-500 bg-orange-50"
                      : "border-slate-200 bg-white hover:border-orange-200"
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">{day.day}</div>
                  <div className="text-[9px] text-slate-500 truncate">{day.focus}</div>
                </button>
              ))}
            </div>
          )}

          {/* Active day info */}
          {activeDay ? (
            <>
              <div className="flex items-center justify-between mb-3 p-3 rounded-xl bg-orange-50/60 border border-orange-100">
                <div>
                  <p className="font-bold text-sm text-slate-900">{activeDay.title}</p>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{toPersianDigits(activeDay.estimatedMinutes)} دقیقه</span>
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3" />{toPersianDigits(activeDay.exercises?.length ?? 0)} حرکت</span>
                  </div>
                </div>
              </div>

              {/* Exercises with quick log — گروه‌بندی‌شده (سوپرست/تری‌ست/جاینت‌ست) */}
              <div className="space-y-2.5">
                {(() => {
                  // استفاده از groupExercises برای نمایش صحیح سوپرست/تری‌ست/جاینت‌ست
                  // (مشابه programs-view و workouts-view)
                  const grouped = groupExercises(activeDay.exercises);
                  let absIdx = 0;
                  let groupColorIdx = 0;
                  // پالت رنگ متمایز برای هر گروه (A=بنفش، B=آبی، ...)
                  const groupColors = [
                    { bg: "#f3e8ff", border: "#d8b4fe", tint: "rgba(168,85,247,0.08)", header: "linear-gradient(135deg,#a855f7,#d946ef)", text: "#7e22ce" },
                    { bg: "#dbeafe", border: "#93c5fd", tint: "rgba(59,130,246,0.08)", header: "linear-gradient(135deg,#3b82f6,#6366f1)", text: "#1d4ed8" },
                    { bg: "#dcfce7", border: "#86efac", tint: "rgba(34,197,94,0.08)", header: "linear-gradient(135deg,#22c55e,#10b981)", text: "#15803d" },
                    { bg: "#fef3c7", border: "#fcd34d", tint: "rgba(245,158,11,0.10)", header: "linear-gradient(135deg,#f59e0b,#f97316)", text: "#b45309" },
                    { bg: "#ffe4e6", border: "#fb7185", tint: "rgba(244,63,94,0.08)", header: "linear-gradient(135deg,#f43f5e,#fb7185)", text: "#9f1239" },
                    { bg: "#ccfbf1", border: "#5eead4", tint: "rgba(20,184,166,0.08)", header: "linear-gradient(135deg,#14b8a6,#2dd4bf)", text: "#0f766e" },
                  ];

                  return grouped.map((item, itemIdx) => {
                    if (item.type === "single") {
                      const ex = item.exercise;
                      const idx = absIdx++;
                      return (
                        <GymExerciseCard
                          key={ex.id}
                          ex={ex}
                          idx={idx}
                          setWeights={setWeights}
                          setReps={setReps}
                          doneSets={doneSets}
                          onSetWeight={handleWeightInput}
                          onSetReps={handleRepInput}
                          onComplete={(exId, sn) => completeSet(exId, sn)}
                          onShowDetail={() => setDetailExercise(ex)}
                        />
                      );
                    }

                    // گروه: سوپرست / تری‌ست / جاینت‌ست
                    const colors = groupColors[groupColorIdx++ % groupColors.length];
                    // v168 — حرکات گروه هم در شماره‌گذاری مطلق حساب می‌شوند (بعد از گروه)
                    absIdx += item.exercises.length;
                    const label = groupTypeLabel(item.groupType);
                    const isGiant = item.groupType === "giant";
                    const typeHint = isGiant
                      ? "۴ حرکت یا بیشتر — سیرکویت"
                      : item.groupType === "triset"
                        ? "۳ حرکت پشت سر هم"
                        : "۲ حرکت پشت سر هم";

                    return (
                      <div
                        key={`group-${item.group}-${itemIdx}`}
                        className="rounded-2xl border-2 p-2 space-y-1.5 shadow-sm"
                        style={{ borderColor: colors.border, background: colors.tint }}
                      >
                        {/* هدر گروه */}
                        <div
                          className="rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 shadow-sm"
                          style={{ background: colors.header, color: "#fff" }}
                        >
                          <span className="text-[12px] leading-none">🔗</span>
                          <span className="text-[11px] font-black">
                            {label} {item.group}
                          </span>
                          <span className="text-[9px] opacity-95 px-1.5 py-0.5 rounded-full bg-white/20 font-bold">
                            {toPersianDigits(item.exercises.length)} حرکت
                          </span>
                          <span className="text-[9px] opacity-95 mr-auto flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {typeHint}
                          </span>
                        </div>

                        {/* اطلاعات ویژه جاینت‌ست: تعداد دورها + استراحت بین دورها */}
                        {isGiant && (item.circuitRounds || item.restBetweenRounds) && (
                          <div
                            className="flex items-center flex-wrap gap-x-3 gap-y-1 px-2.5 py-1 rounded-lg text-[9px] font-bold"
                            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                          >
                            {item.circuitRounds ? (
                              <span className="flex items-center gap-1">
                                <Repeat className="w-3 h-3" />
                                {toPersianDigits(item.circuitRounds)} دور
                              </span>
                            ) : null}
                            {item.restBetweenRounds ? (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                استراحت بین دورها: {toPersianDigits(item.restBetweenRounds)} ثانیه
                              </span>
                            ) : null}
                          </div>
                        )}

                        {/* v168 — دورهای گروه: «ست N» همهٔ اعضا پشت سر هم + یک تیک
                            برای کل دور (درخواست مالک: بالاسینه هالتر و پرس سینه دمبل
                            با پر کردن جفتشون یک تیک بخورند و برود استراحت) */}
                        <div className="space-y-1.5">
                          {Array.from({ length: groupMaxRounds(item) }, (_, ri) => ri + 1).map((n) => {
                            const roundDone = isGroupRoundDone(item, n, (exId, sn) => !!doneSets[`${exId}_${sn}`]);
                            return (
                              <div
                                key={n}
                                className="rounded-xl border p-2 space-y-1"
                                style={{
                                  borderColor: roundDone ? "#a7f3d0" : colors.border,
                                  background: roundDone ? "#ecfdf5" : "#fff",
                                }}
                              >
                                {/* هدر دور + تیک واحد */}
                                <div className="flex items-center gap-2">
                                  <span
                                    className="text-[10px] font-black px-1.5 py-0.5 rounded-md"
                                    style={{ color: "#fff", background: roundDone ? "#10b981" : colors.header.replace("linear-gradient(135deg,", "").split(",")[0] }}
                                  >
                                    ست {toPersianDigits(n)}
                                  </span>
                                  {roundDone ? (
                                    <span className="text-[9px] font-black text-emerald-600 flex items-center gap-0.5">
                                      <Check className="w-3 h-3" strokeWidth={3} />
                                      ثبت شد
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-slate-400 hidden sm:inline">
                                      هر دو را پر کن، بعد یک تیک
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => completeGroupRound(item, n)}
                                    disabled={roundDone}
                                    aria-label={`تکمیل ست ${toPersianDigits(n)} گروه`}
                                    className={`mr-auto w-8 h-8 rounded-full flex items-center justify-center transition shrink-0 ${
                                      roundDone
                                        ? "text-white"
                                        : "bg-slate-200 text-slate-600 hover:text-white active:scale-90"
                                    }`}
                                    style={roundDone ? { background: "linear-gradient(135deg, #10b981, #059669)" } : undefined}
                                  >
                                    <Check className="w-4 h-4" strokeWidth={3} />
                                  </button>
                                </div>
                                {/* اعضای گروه در این دور — وزنه/تکرار جدا برای هر عضو */}
                                {item.exercises.map((ex, gi) => {
                                  const setDef = memberSetFor(ex, n);
                                  const rowKey = `${ex.id}_${n}`;
                                  const rowDone = !!doneSets[rowKey];
                                  if (!setDef) {
                                    return (
                                      <div key={ex.id} className="flex items-center gap-1.5 px-1 py-0.5">
                                        <span
                                          className="text-[9px] font-black shrink-0"
                                          style={{ color: colors.text }}
                                          dir="ltr"
                                        >
                                          {`${item.group}${gi + 1}`}
                                        </span>
                                        <span className="text-[10px] text-slate-400 truncate">
                                          {ex.name} — در این دور ست ندارد
                                        </span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div
                                      key={ex.id}
                                      className={`flex items-center gap-1.5 p-1.5 rounded-lg ${rowDone ? "bg-emerald-50/70" : "bg-slate-50"}`}
                                    >
                                      <span
                                        className="text-[9px] font-black w-6 shrink-0 text-center"
                                        style={{ color: colors.text }}
                                        dir="ltr"
                                      >
                                        {`${item.group}${gi + 1}`}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-[11px] font-bold truncate ${rowDone ? "text-emerald-700 line-through decoration-emerald-400" : "text-slate-800"}`}>
                                          {ex.name}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setDetailExercise(ex)}
                                        className="w-7 h-7 rounded-lg bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center shrink-0 hover:bg-orange-100 transition"
                                        aria-label={`توضیحات و ویدیوی ${ex.name}`}
                                        title="ویدیو و توضیحات"
                                      >
                                        <Info className="w-3.5 h-3.5" />
                                      </button>
                                      <input
                                        type="number"
                                        dir="ltr"
                                        placeholder="kg"
                                        value={setWeights[rowKey] ?? ""}
                                        onChange={(e) => handleWeightInput(ex.id, n, e.target.value)}
                                        disabled={rowDone}
                                        className="w-12 h-7 text-center text-[11px] rounded-md border border-slate-200 bg-white text-slate-700"
                                      />
                                      <input
                                        type="number"
                                        dir="ltr"
                                        placeholder="rep"
                                        value={setReps[rowKey] ?? ""}
                                        onChange={(e) => handleRepInput(ex.id, n, e.target.value)}
                                        disabled={rowDone}
                                        className="w-12 h-7 text-center text-[11px] rounded-md border border-slate-200 bg-white text-slate-700"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>

                        {/* فوتر: استراحت بعد از گروه */}
                        {(() => {
                          const lastEx = item.exercises[item.exercises.length - 1];
                          const restAfter = lastEx?.sets?.slice(-1)[0]?.restSec ?? 0;
                          return (
                            <div
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold"
                              style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                            >
                              <Clock className="w-3 h-3" />
                              {restAfter > 0 ? (
                                <>
                                  استراحت بعد از گروه: {toPersianDigits(restAfter)} ثانیه
                                  <span className="font-normal opacity-80 mr-auto">سپس گروه بعدی</span>
                                </>
                              ) : (
                                <span className="font-normal opacity-80 mr-auto">بدون استراحت — مستقیم گروه بعدی</span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          ) : (
            <div className="text-center py-6 text-slate-500 text-sm">
              برنامه تمرینی موجود نیست
            </div>
          )}
        </div>
        </div>

        {/* Desktop chat side panel حذف شد — چت به‌صورت modal باز می‌شود */}
      </div>

      {/* Chat modal — روی همه دستگاه‌ها (موبایل + دسکتاپ) به‌صورت modal باز می‌شود */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4"
            dir="rtl"
            onClick={() => setChatOpen(false)}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            {/* Modal container — روی موبایل full-screen، روی دسکتاپ centered modal */}
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "tween", duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="relative bg-white w-full h-full sm:w-[440px] sm:h-[85vh] sm:max-h-[85vh] sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top bar with close button */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-orange-100 bg-white shrink-0">
                <button
                  onClick={() => setChatOpen(false)}
                  className="flex items-center gap-1 text-orange-600 active:scale-95 transition font-medium"
                  aria-label="بستن چت"
                >
                  <ChevronLeft className="w-5 h-5 rotate-180" />
                  <span className="text-sm">بازگشت به تمرین</span>
                </button>
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  فیتاپ
                </span>
              </div>
              {/* Chat fills remaining space */}
              <div className="flex-1 min-h-0">
                <SmartCoachChatView variant="panel" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB to open chat — روی همه دستگاه‌ها (موبایل + دسکتاپ) */}
      {!chatOpen && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: fabHidden ? 0 : 1, opacity: fabHidden ? 0 : 1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.18 }}
          onClick={() => setChatOpen(true)}
          className="absolute bottom-5 left-5 z-30 flex items-center gap-2 pr-4 pl-2 py-2 rounded-full shadow-2xl text-white"
          style={{
            background: "linear-gradient(135deg, #f59e0b, #f97316)",
            boxShadow: "0 12px 30px -8px rgba(249, 115, 22, 0.5)",
            pointerEvents: fabHidden ? "none" : "auto",
          }}
          aria-label="باز کردن چت با فیتاپ"
          aria-hidden={fabHidden}
        >
          {/* Pulse ring animation */}
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              background: "rgba(249, 115, 22, 0.4)",
              animationDuration: "2s",
              animationIterationCount: "infinite",
            }}
          />
          <span className="relative flex items-center gap-2">
            <span className="text-xs font-bold whitespace-nowrap">چت با فیتاپ</span>
            <span className="relative w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
            </span>
          </span>
        </motion.button>
      )}

      {/* Modal جزئیات حرکت — دقیقاً همان ExerciseDetailModal از programs-view */}
      {detailExercise && (
        <ExerciseDetailModal
          exercise={detailExercise}
          onClose={() => {
            // v118 — مهر بستن عمدی؛ Sheet والد (main-app) در همان tap دوباره بسته نمی‌شود
            markExerciseModalJustClosed();
            setDetailExercise(null);
          }}
        />
      )}

      {/* ─── Task 3-b: جشن مدال روز کامل — portal تمام‌صفحه، الگوی ضدلگ ─── */}
      <DailyMedalCelebration open={medalOpen} onClose={() => setMedalOpen(false)} />

      {/* ─── v148: جشن بزرگ «تمرین امروز کامل شد» — قبل از مدال (زنجیرهٔ جشن)
          v168 — شخصی‌سازی‌تر: نام کاربر + روز تمرین + تعداد حرکت + بهترین ست ─── */}
      <GymWorkoutCelebration
        open={finaleOpen}
        onClose={handleFinaleClose}
        totalSets={finaleStats?.totalSets ?? 0}
        totalVolume={finaleStats?.volume ?? null}
        durationMin={finaleStats?.durationMin ?? null}
        bestWeightKg={finaleStats?.bestWeight ?? null}
        userName={user?.name ?? null}
        dayTitle={activeDay?.title ?? null}
        exerciseCount={activeDay?.exercises?.length ?? null}
      />

      {/* ─── v148: تایمر استراحت جذاب — کارت شناور پایین، فقط یک تایمر (key=token)
          v168 — شمارندهٔ هوشمند: برچسب «بعدی» + حالت «آخرین استراحت تمرین» ─── */}
      <AnimatePresence>
        {rest && (
          <GymRestTimer
            key={rest.token}
            initialSeconds={rest.seconds}
            nextLabel={rest.nextLabel}
            isFinal={rest.isFinal}
            onDone={() => setRest(null)}
            onSkip={() => setRest(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
   GymExerciseCard — کارت تک‌حرکت در جیم‌مود
   - شماره حرکت (یا برچسب گروه مثل A1، B2)
   - نام، عضله، تعداد ست
   - آیکون «جزئیات» (Info) برای باز کردن ExerciseDetailModal
   - ورودی‌های وزنه/تکرار برای هر ست + دکمه انجام
   - در صورت داخل گروه بودن، بج سوپرست مخفی می‌شود (hideSupersetBadge)
   ============================================================ */
function GymExerciseCard({
  ex,
  idx,
  groupLabel,
  groupColor,
  hideSupersetBadge,
  setWeights,
  setReps,
  doneSets,
  onSetWeight,
  onSetReps,
  onComplete,
  onShowDetail,
}: {
  ex: PlanExercise;
  idx: number;
  groupLabel?: string;
  groupColor?: string;
  hideSupersetBadge?: boolean;
  setWeights: Record<string, string>;
  setReps: Record<string, string>;
  doneSets: Record<string, boolean>;
  onSetWeight: (exId: string, setNumber: number, value: string) => void;
  onSetReps: (exId: string, setNumber: number, value: string) => void;
  onComplete: (exerciseId: string, setNumber: number) => void;
  onShowDetail: () => void;
}) {
  // شماره نمایشی: اگر داخل گروه است، groupLabel (مثل A1) نشان داده می‌شود
  // در غیر این صورت، شماره مطلق حرکت
  const displayNumber = groupLabel ?? toPersianDigits(idx + 1);

  return (
    <div className="rounded-2xl border border-orange-100 bg-orange-50/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="min-w-6 h-6 px-1 rounded-lg bg-orange-100 text-orange-600 text-[10px] font-bold flex items-center justify-center shrink-0"
          style={groupColor ? { color: groupColor, background: `${groupColor}15` } : undefined}
        >
          {displayNumber}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 truncate">{ex.name}</p>
          {/* v55 — خلاصهٔ سینک: «۴ ست × ۱۰-۱۲» (همان فرمت مدال تمرینی/تمرین امروز/شروع تمرین) */}
          <p className="text-[10px] text-slate-500">{ex.muscle} • <span className="font-bold text-orange-600">{formatSetsSummaryShort(ex.sets)}</span></p>
        </div>
        {/* بج سوپرست فقط اگر داخل گروه نیست و حرکت متعلق به یک گروه است */}
        {!hideSupersetBadge && ex.supersetGroup && ex.supersetType && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 shrink-0"
            title={`${groupTypeLabel(ex.supersetType)} — گروه ${ex.supersetGroup}`}
          >
            {groupTypeLabel(ex.supersetType)} {ex.supersetGroup}
          </span>
        )}
        {/* دکمه «توضیحات» حرکت — باز کردن ExerciseDetailModal */}
        {/* v15 (درخواست مالک): کلمه «توضیحات» کنار آیکون نوشته شود (نه فقط آیکون) */}
        <button
          type="button"
          onClick={onShowDetail}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-600 hover:text-orange-700 transition shrink-0"
          aria-label="توضیحات حرکت"
          title="نمایش توضیحات، نکات تکنیکی و ویدیوی حرکت"
        >
          <Info className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold">توضیحات</span>
        </button>
      </div>
      {/* توصیه کوتاه مربی — فقط در صورت وجود */}
      {ex.coachTip && (
        <div className="flex items-start gap-1 mb-2 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-100">
          <span className="text-[11px] leading-none shrink-0">💡</span>
          <p className="text-[10px] text-amber-800 leading-snug">{ex.coachTip}</p>
        </div>
      )}
      <div className="space-y-1.5">
        {ex.sets.map((set) => {
          const key = `${ex.id}_${set.setNumber}`;
          const done = doneSets[key];
          return (
            <div key={set.setNumber} className={`flex items-center gap-2 p-2 rounded-lg transition ${done ? "bg-orange-50" : "bg-slate-50"}`}>
              <span className="text-[10px] text-slate-500 w-8 shrink-0">ست {toPersianDigits(set.setNumber)}</span>
              {/* v55 — هدف سینک: «هدف: ۱۰-۱۲ تکرار • استراحت ۱ دقیقه» */}
              <span className="text-[10px] text-slate-500 flex-1 truncate">{formatSetGoal(set)}</span>
              <input
                type="number"
                dir="ltr"
                placeholder="kg"
                value={setWeights[key] ?? ""}
                onChange={(e) => onSetWeight(ex.id, set.setNumber, e.target.value)}
                disabled={done}
                className="w-12 h-7 text-center text-[11px] rounded-md border border-slate-200 bg-white text-slate-700"
              />
              <input
                type="number"
                dir="ltr"
                placeholder="rep"
                value={setReps[key] ?? ""}
                onChange={(e) => onSetReps(ex.id, set.setNumber, e.target.value)}
                disabled={done}
                className="w-12 h-7 text-center text-[11px] rounded-md border border-slate-200 bg-white text-slate-700"
              />
              <button
                onClick={() => onComplete(ex.id, set.setNumber)}
                disabled={done}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition shrink-0 ${
                  done ? "text-white" : "bg-slate-200 text-slate-600 hover:text-white"
                }`}
                style={done ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : undefined}
              >
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   GymRestTimer (v148/v168) — تایمر استراحت جذاب جیم‌مود
   - کارت شناور پایین‌وسط (بالاتر از FAB چت)، z-[60]
   - حلقهٔ SVG با گرادیان کهربایی→نارنجی؛ در پایان سبز فلش می‌زند
   - شمارش معکوس فقط این کامپوننت را re-render می‌کند (الگوی RestTimerCard)
   - «+۳۰ ثانیه» تمدید می‌کند، «رد کردن» می‌بندد
   - پایان: بیپ نرم + «پایان استراحت! 💪» + بستن خودکار بعد از ~۲ ثانیه
   - key={token} در والد → با هر تیک جدید شمارش از نو (فقط یک تایمر)
   - v168 — شمارندهٔ هوشمند: nextLabel (حرکت/دور بعدی + شماره ست)،
     isFinal (آخرین استراحت تمرین — پیام نزدیکی جشن)
   ============================================================ */
function GymRestTimer({
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
  // «پایان» مشتق‌شده است (نه state) — با +۳۰ ثانیه خودش false می‌شود
  const finished = remaining <= 0;
  const onDoneRef = useRef(onDone);
  // به‌روزرسانی ref در effect (نه حین رندر — قاعدهٔ react-hooks/refs)
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  // شناسهٔ یکتا برای گرادیان SVG (کاراکترهای نامعتبر id حذف می‌شوند)
  const gradId = `gym-rest-ring-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // شمارش معکوس — هر ثانیه یک تیک (فقط وقتی باقی‌مانده > ۰)
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((p) => Math.max(0, p - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  // پایان: بیپ نرم + فلش سبز + بستن خودکار بعد از ~۲ ثانیه
  useEffect(() => {
    if (!finished) return;
    gymBeep();
    const t = setTimeout(() => onDoneRef.current(), 2000);
    return () => clearTimeout(t);
  }, [finished]);

  const CIRC = 2 * Math.PI * 15.5;
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 64, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="fixed bottom-24 inset-x-0 mx-auto z-[60] w-[92%] max-w-sm"
      dir="rtl"
      role="timer"
      aria-live="polite"
      aria-label={finished ? "پایان استراحت" : `استراحت ${toPersianDigits(remaining)} ثانیه`}
    >
      <div
        className="rounded-3xl border bg-white/95 backdrop-blur-md p-4"
        style={{
          borderColor: finished ? "rgba(16,185,129,0.35)" : "rgba(251,146,60,0.35)",
          boxShadow: finished
            ? "0 18px 50px -12px rgba(16,185,129,0.45)"
            : "0 18px 50px -12px rgba(249,115,22,0.45)",
        }}
      >
        <div className="flex items-center gap-3.5">
          {/* حلقهٔ پیشرفت + عدد بزرگ فارسی */}
          <motion.div
            animate={finished ? { scale: [1, 1.14, 1] } : {}}
            transition={{ duration: 0.7, repeat: finished ? Infinity : 0, repeatDelay: 0.6 }}
            className="relative w-20 h-20 shrink-0"
          >
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" aria-hidden="true">
              <defs>
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={finished ? "#34d399" : "#f59e0b"} />
                  <stop offset="100%" stopColor={finished ? "#10b981" : "#f97316"} />
                </linearGradient>
              </defs>
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#ffedd5" strokeWidth="3.5" />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={`url(#${gradId})`}
                strokeWidth="3.5"
                strokeDasharray={`${frac * CIRC} ${CIRC}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 0.95s linear" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={`text-xl font-black leading-none tabular-nums ${
                  finished ? "text-emerald-600" : "text-slate-900"
                }`}
              >
                {toPersianDigits(remaining)}
              </span>
              <span className="text-[8px] text-slate-400 mt-0.5">ثانیه</span>
            </div>
          </motion.div>

          {/* برچسب + راهنمای ست بعدی */}
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm text-slate-900 flex items-center gap-1.5">
              {finished ? (
                <>پایان استراحت! 💪</>
              ) : (
                <>
                  استراحت ⏱
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "linear-gradient(135deg, #fef3c7, #ffedd5)", color: "#b45309" }}
                  >
                    {toPersianDigits(total)} ثانیه
                  </span>
                </>
              )}
            </p>
            <p className={`text-[11px] truncate mt-1 ${isFinal && !finished ? "font-black text-orange-600" : "text-slate-500"}`}>
              {finished
                ? "آمادهٔ ست بعدی باش"
                : isFinal
                  ? "آخرین استراحت تمرین — بعدش جشن داریم! 🎉"
                  : nextLabel
                    ? `بعدی: ${nextLabel}`
                    : "نفس عمیق بکش و آماده باش"}
            </p>
          </div>
        </div>

        {/* دکمه‌ها — هدف لمسی ۴۴px+ */}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => {
              setRemaining((r) => r + 30);
              setTotal((t) => t + 30);
            }}
            className="flex-1 min-h-[44px] rounded-xl bg-orange-50 border border-orange-200 text-orange-600 text-xs font-black hover:bg-orange-100 active:scale-[0.98] transition"
          >
            +۳۰ ثانیه
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 min-h-[44px] rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 active:scale-[0.98] transition"
          >
            رد کردن
          </button>
        </div>
      </div>
    </motion.div>
  );
}
