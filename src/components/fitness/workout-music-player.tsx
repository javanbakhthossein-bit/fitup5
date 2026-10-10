"use client";

/**
 * v183 — پلیر موزیک مشترک فیتاپ (حالت باشگاه + چالش‌ها)
 *
 * دیرکتیوهای مالک:
 *  • فیتاپ «هیچ» موزیک خودش ندارد — فقط فایل‌های گوشیِ خود کاربر
 *  • بهترین روش پخش وب/PWA: HTML Audio + IndexedDB (ماندگاری پلی‌لیست)
 *    + MediaSession (کنترل قفل‌صفحه در مرورگرهای واقعی؛ در WebView بی‌اثر)
 *  • یک کد واحد برای هر دو محیط — «همه‌چیز مثل ساعت»
 *
 * variant="full"  → کارت کامل (ویژوالایزر + کنترل + پلی‌لیست)
 * variant="mini"  → نوار شناور جمع‌وجور داخل جلسهٔ تمرین
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Plus, Volume2, ListMusic, Trash2, Music, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";
import { useAppStore, type GymTrack } from "@/lib/fitness/store";
import {
  saveTrackToDB,
  loadTracksFromDB,
  deleteTrackFromDB,
} from "@/lib/fitness/gym-playlist-db";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${toPersianDigits(m.toString().padStart(2, "0"))}:${toPersianDigits(sec.toString().padStart(2, "0"))}`;
}

export const WorkoutMusicPlayer = memo(function WorkoutMusicPlayer({
  variant = "full",
  accentFrom = "#f59e0b",
  accentTo = "#f97316",
}: {
  variant?: "full" | "mini";
  accentFrom?: string;
  accentTo?: string;
}) {
  const gymPlaylist = useAppStore((s) => s.gymPlaylist);
  const setGymPlaylist = useAppStore((s) => s.setGymPlaylist);

  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const pendingPlayRef = useRef(false);
  // v188 — seek دقیق: درگ روی نوار + fallback مدت + ولوم iOS-safe (GainNode)
  const draggingRef = useRef(false);
  const gainRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [currentTrackIdxRaw, setCurrentTrackIdx] = useState(0);
  // v189 — clamp مشتق (بدون setState در effect): هرگز out-of-range نمی‌شود
  const currentTrackIdx = Math.min(currentTrackIdxRaw, Math.max(0, gymPlaylist.length - 1));
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [hydrated, setHydrated] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  // v218 — دیرکتیو مالک: پلیر کامل جیم‌مود هم مثل چالش‌ها جمع/باز شود و
  // «به صورت دیفالت حالت جمع شده باشد». (miniOpen = الگوی جلسهٔ چالش)
  const [fullOpen, setFullOpen] = useState(false);

  const currentTrack = gymPlaylist[currentTrackIdx];
  const accentStyle = { background: `linear-gradient(135deg, ${accentFrom}, ${accentTo})` };

  // ─── Hydrate پلی‌لیست از IndexedDB (هر مونت) ───
  // v189 — فیکس ریشه‌ای باگ «موزیک‌ها در لیست‌اند ولی پخش نمی‌شوند»:
  // هر ترکِ موجود در DB با object URL «تازه» بازسازی می‌شود (URLهای blob بعد از
  // رفرش/سوییچ می‌میرند) — ترک‌های تازه‌اضافهٔ همین سشن (که هنوز در DB ننشسته‌اند) حفظ می‌شوند.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadTracksFromDB();
      if (cancelled) return;
      const current = useAppStore.getState().gymPlaylist;
      const dbIds = new Set(stored.map((s) => s.id));
      // ترک‌های درون-سشن که هنوز در DB ذخیره نشده‌اند (نوشتن async در جریان است)
      const unsaved = current.filter((t) => !dbIds.has(t.id));
      const healed: GymTrack[] = stored.map((s) => ({
        id: s.id,
        name: s.name,
        url: URL.createObjectURL(s.blob),
        blob: s.blob,
      }));
      // فقط اگر چیزی عوض شده store را بنویس (بدون re-render بی‌دلیل)
      const currentIds = current.map((t) => t.id).join("\n");
      const nextIds = [...unsaved.map((t) => t.id), ...healed.map((t) => t.id)].join("\n");
      if (nextIds !== currentIds) {
        // URLهای قدیمی که دیگر در هیچ لیستی نیستند آزاد می‌شوند
        const nextIdsSet = new Set(nextIds.split("\n"));
        current.forEach((t) => {
          if (!nextIdsSet.has(t.id)) URL.revokeObjectURL(t.url);
        });
        setGymPlaylist([...unsaved, ...healed]);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [setGymPlaylist]);

  // v189 — دیگر هیچ revoke-on-unmount وجود ندارد: revoke باعث می‌شد URLهای ترک‌ها
  // هنگام بستن چالش/جیم‌مود بمیرند و در زمینهٔ بعدی «در لیست بود ولی پخش نمی‌شد».
  // پاک‌سازی URL فقط در حذف ترک (removeTrack) و تعویض هیدریت انجام می‌شود.

  // ─── Audio events ───
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => {
      setDuration(audio.duration || 0);
      if (pendingPlayRef.current) {
        audio.play().catch(() => {
          pendingPlayRef.current = false;
        });
      }
    };
    const onEnd = () => {
      const n = gymPlaylist.length;
      if (n <= 0) return;
      const next = (currentTrackIdx + 1) % n;
      setCurrentTrackIdx(next);
      if (next === currentTrackIdx) {
        // v189 — تک‌ترک: همان آهنگ از ابتدا پخش می‌شود (loop دستی)
        const audio = audioRef.current;
        if (audio) {
          try { audio.currentTime = 0; } catch {}
          audio.play().catch(() => {});
        }
      }
    };
    const onPlay = () => {
      pendingPlayRef.current = false;
      setIsPlaying(true);
    };
    const onPause = () => {
      // pause هنگام تعویض src طبیعی است — اگر قصد پخش داریم isPlaying را پایین نیاور
      if (!pendingPlayRef.current) setIsPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [currentTrackIdx, gymPlaylist]);

  // شروع پخش هنگام تعویض ترک با قصد پخش
  useEffect(() => {
    if (!isPlaying) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused && audio.src) {
      const p = audio.play();
      if (p) p.catch(() => {});
    }
  }, [currentTrackIdx, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.volume = volume;
      // iOS/Safari: audio.volume فقط‌خواندنی است — مقدار ست نمی‌شود؛
      // در این حالت یک‌بار WebAudio GainNode می‌سازیم و ولوم را آنجا اعمال می‌کنیم
      if (Math.abs(audio.volume - volume) > 0.001) {
        if (!audioCtxRef.current) {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) return;
          const ctx = new Ctx();
          const src = ctx.createMediaElementSource(audio);
          const gain = ctx.createGain();
          gain.gain.value = volume;
          src.connect(gain);
          gain.connect(ctx.destination);
          audioCtxRef.current = ctx;
          gainRef.current = gain;
          if (ctx.state === "suspended") ctx.resume().catch(() => {});
        } else if (gainRef.current) {
          gainRef.current.gain.value = volume;
        }
      } else if (gainRef.current) {
        gainRef.current.gain.value = volume;
      }
    } catch {
      // ولوم در این محیط پشتیبانی نمی‌شود — ساکت ادامه بده
    }
  }, [volume]);

  // ─── MediaSession — کنترل قفل صفحه (مرورگر/PWA؛ در WebView بی‌اثر) ───
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      if (currentTrack) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.name,
          artist: "پلی‌لیست شخصی من — فیتاپ",
        });
      }
      navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        if (gymPlaylist.length > 0) setCurrentTrackIdx((i) => (i + 1) % gymPlaylist.length);
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        if (gymPlaylist.length > 0) setCurrentTrackIdx((i) => (i - 1 + gymPlaylist.length) % gymPlaylist.length);
      });
    } catch {
      // MediaSession پشتیبانی نمی‌شود — بی‌صدا
    }
  }, [currentTrack, gymPlaylist]);

  // ─── Actions ───
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|wav|flac)$/i.test(f.name));
      if (files.length === 0) {
        toast.error("فایل موزیک معتبری انتخاب نشد");
        return;
      }
      const tracks: GymTrack[] = files.map((f) => ({
        id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: f.name.replace(/\.[^.]+$/, ""),
        url: URL.createObjectURL(f),
        blob: f,
      }));
      setGymPlaylist([...useAppStore.getState().gymPlaylist, ...tracks]);
      toast.success(`${toPersianDigits(tracks.length)} آهنگ به لیست اضافه شد 🎵`);
      for (const t of tracks) {
        if (t.blob) await saveTrackToDB({ id: t.id, name: t.name, blob: t.blob });
      }
      if (e.target) e.target.value = "";
    },
    [setGymPlaylist]
  );

  const togglePlay = useCallback(() => {
    if (useAppStore.getState().gymPlaylist.length === 0) {
      toast.info("اول از گوشیت آهنگ اضافه کن 🎵");
      fileInputRef.current?.click();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    // اگر ولوم از مسیر WebAudio است، context باید فعال باشد (نیازمند تعامل کاربر)
    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume().catch(() => {});
    if (isPlaying) {
      audio.pause();
    } else {
      pendingPlayRef.current = true;
      audio.play().catch(() => {
        // src هنوز آماده نیست — onLoadedmetadata پخش را ادامه می‌دهد
      });
    }
  }, [isPlaying]);

  const next = useCallback(() => {
    const list = useAppStore.getState().gymPlaylist;
    if (list.length === 0) return;
    setCurrentTrackIdx((i) => (i + 1) % list.length);
    if (isPlaying) pendingPlayRef.current = true;
  }, [isPlaying]);

  const prev = useCallback(() => {
    const list = useAppStore.getState().gymPlaylist;
    if (list.length === 0) return;
    setCurrentTrackIdx((i) => (i - 1 + list.length) % list.length);
    if (isPlaying) pendingPlayRef.current = true;
  }, [isPlaying]);

  const playTrack = useCallback((idx: number) => {
    setCurrentTrackIdx(idx);
    pendingPlayRef.current = true;
  }, []);

  const removeTrack = useCallback(
    async (id: string) => {
      const tracks = useAppStore.getState().gymPlaylist;
      const track = tracks.find((t) => t.id === id);
      if (track) URL.revokeObjectURL(track.url);
      const filtered = tracks.filter((t) => t.id !== id);
      setGymPlaylist(filtered);
      await deleteTrackFromDB(id);
      setCurrentTrackIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
    },
    [setGymPlaylist]
  );

  // v188 — seek دقیق: کلیک/درگ روی نوار = پرش به همان نقطه (با fallback مدت)
  const seek = useCallback((clientX: number) => {
    const el = progressBarRef.current;
    const audio = audioRef.current;
    if (!el || !audio) return;
    // مدت معتبر: state → audio.duration → seekable (برای فایل‌هایی که duration نامعتبر گزارش می‌شود)
    let d = duration || audio.duration || 0;
    if (!isFinite(d) || d <= 0) {
      try { d = audio.seekable.end(audio.seekable.length - 1); } catch { return; }
      if (!isFinite(d) || d <= 0) return;
    }
    const rect = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try {
      audio.currentTime = pct * d;
      setProgress(pct * d); // بازخورد فوری — بدون انتظار برای timeupdate بعدی
    } catch {
      // منبع هنوز آماده نیست — نادیده
    }
  }, [duration]);

  const onBarPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* بی‌اثر */ }
    seek(e.clientX);
  }, [seek]);

  const onBarPointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current) seek(e.clientX);
  }, [seek]);

  const onBarPointerEnd = useCallback(() => {
    draggingRef.current = false;
  }, []);

  // ─── MINI variant ───
  if (variant === "mini") {
    return (
      <div className="pointer-events-none" data-gym-music="true">
        <input ref={fileInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={handleFileSelect} />
        <audio
          ref={audioRef}
          src={currentTrack?.url}
          data-gym-music="true"
          preload="metadata"
        />
        {/* v222 — بدون layout (FLIP اضافی) و بدون backdrop-blur — کارت پایینی ثابت است */}
        <motion.div
          className="pointer-events-auto w-full max-w-md mx-auto rounded-2xl bg-white border border-orange-200/70 shadow-lg shadow-orange-500/10 overflow-hidden"
        >
          {!miniOpen ? (
            <div className="flex items-center gap-2 p-2 pl-3">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md active:scale-95 transition"
                style={accentStyle}
                aria-label={isPlaying ? "توقف موزیک" : "پخش موزیک"}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current mr-0.5" />}
              </button>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setMiniOpen(true)} role="button" aria-label="باز کردن پلیر">
                <p className="text-xs font-bold text-slate-800 truncate">
                  {currentTrack?.name || "موزیک خودت را اضافه کن"}
                </p>
                <p className="text-[10px] text-slate-400">
                  {gymPlaylist.length > 0
                    ? `${toPersianDigits(currentTrackIdx + 1)} از ${toPersianDigits(gymPlaylist.length)}`
                    : "پلی‌لیست شخصی تو — از حافظهٔ گوشیت"}
                </p>
              </div>
              {isPlaying && (
                <div className="flex items-end gap-0.5 h-4 shrink-0" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1 rounded-full h-full origin-bottom"
                      style={{ background: `linear-gradient(180deg, ${accentFrom}, ${accentTo})` }}
                      // v215 — انیمیشن scaleY (transform) به‌جای height (layout):
                      // height در هر فریم reflow می‌سازد — عامل لگ در جلسهٔ تمرین
                      animate={{ scaleY: [0.29, 0.86, 0.43, 1, 0.36] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                    />
                  ))}
                </div>
              )}
              <button onClick={next} disabled={gymPlaylist.length === 0} className="p-2 rounded-lg hover:bg-orange-50 text-slate-600 disabled:opacity-30 transition" aria-label="آهنگ بعدی">
                {/* v188 — در RTL «بعدی» رو به چپ است — آینه‌سازی آیکون */}
                <SkipForward className="w-4 h-4 scale-x-[-1]" />
              </button>
            </div>
          ) : (
            <div className="p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={accentStyle}>
                  <Music className="w-4 h-4" />
                </div>
                <p className="flex-1 min-w-0 text-xs font-bold text-slate-800 truncate">
                  {currentTrack?.name || "موزیک خودت را اضافه کن"}
                </p>
                <button onClick={() => setMiniOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition" aria-label="بستن">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {/* seek */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-400 font-mono w-9 text-center">{fmt(progress)}</span>
                <div
                  ref={progressBarRef}
                  dir="ltr"
                  role="slider"
                  aria-label="پیشرفت پخش"
                  aria-valuemin={0}
                  aria-valuemax={Math.floor(duration) || 0}
                  aria-valuenow={Math.floor(progress) || 0}
                  tabIndex={0}
                  className="flex-1 h-2.5 bg-slate-100 rounded-full relative cursor-pointer touch-none select-none"
                  onPointerDown={onBarPointerDown}
                  onPointerMove={onBarPointerMove}
                  onPointerUp={onBarPointerEnd}
                  onPointerCancel={onBarPointerEnd}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
                    style={{ width: `${duration ? (progress / duration) * 100 : 0}%`, background: `linear-gradient(90deg, ${accentFrom}, ${accentTo})` }}
                  />
                </div>
                <span className="text-[9px] text-slate-400 font-mono w-9 text-center">{fmt(duration)}</span>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button onClick={prev} disabled={gymPlaylist.length === 0} className="p-1.5 rounded-lg hover:bg-orange-50 text-slate-600 disabled:opacity-30" aria-label="آهنگ قبلی">
                  <SkipBack className="w-4 h-4 scale-x-[-1]" />
                </button>
                <button
                  onClick={togglePlay}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white shadow-md active:scale-95 transition"
                  style={accentStyle}
                  aria-label={isPlaying ? "توقف" : "پخش"}
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current mr-0.5" />}
                </button>
                <button onClick={next} disabled={gymPlaylist.length === 0} className="p-1.5 rounded-lg hover:bg-orange-50 text-slate-600 disabled:opacity-30" aria-label="بعدی">
                  <SkipForward className="w-4 h-4 scale-x-[-1]" />
                </button>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="range"
                    dir="ltr"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="صدا"
                    className="w-full accent-orange-500 h-1"
                  />
                </div>
                <Button size="sm" variant="outline" className="rounded-lg h-8 px-2 text-[10px] shrink-0 border-orange-200 text-orange-600 hover:bg-orange-50" onClick={() => fileInputRef.current?.click()}>
                  <Plus className="w-3.5 h-3.5" />
                  افزودن
                </Button>
              </div>
              {gymPlaylist.length > 0 && (
                <div className="max-h-28 overflow-y-auto custom-scrollbar rounded-xl border border-orange-100">
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
                      className={`flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-orange-50/60 transition ${i === currentTrackIdx ? "bg-orange-50 text-orange-600 font-bold" : "text-slate-600"}`}
                    >
                      <ListMusic className="w-3 h-3 shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{track.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTrack(track.id);
                        }}
                        className="p-1 rounded hover:bg-red-100 text-slate-300 hover:text-red-500 transition"
                        aria-label={`حذف ${track.name}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // ─── FULL variant ───
  return (
    <div className="bg-white rounded-3xl overflow-hidden border border-orange-100 shadow-sm" data-gym-music="true">
      <input ref={fileInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={handleFileSelect} />
      <audio
        ref={audioRef}
        src={currentTrack?.url}
        data-gym-music="true"
        preload="metadata"
      />

      {fullOpen ? (
        <>
      {/* Now playing visualizer */}
      <div className="relative h-28 bg-gradient-to-br from-orange-100 via-amber-50 to-orange-50 flex items-center justify-center overflow-hidden">
        {/* v218 — جمع‌کردن پلیر (مثل چالش‌ها) */}
        <button
          onClick={() => setFullOpen(false)}
          className="absolute top-3 left-3 z-10 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/85 text-slate-500 hover:bg-white hover:text-orange-600 transition text-[10px] font-bold shadow-sm min-h-[32px]"
          aria-label="جمع کردن پلیر موزیک"
          title="جمع کردن"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          جمع
        </button>
        <div className="absolute inset-0 opacity-30" aria-hidden="true">
          <div className="absolute top-2 right-4 w-24 h-24 rounded-full bg-orange-300/50 blur-3xl" />
          <div className="absolute bottom-2 left-4 w-20 h-20 rounded-full bg-amber-300/50 blur-3xl" />
        </div>
        <motion.div
          animate={isPlaying ? { scale: [1, 1.08, 1], rotate: [0, 4, -4, 0] } : {}}
          transition={{ duration: 0.8, repeat: Infinity }}
          className="relative z-10"
        >
          <div className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl" style={{ ...accentStyle, boxShadow: "0 10px 25px -5px rgba(249, 115, 22, 0.5)" }}>
            <Music className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
        </motion.div>
        {isPlaying && (
          <div className="absolute bottom-3 left-4 flex items-end gap-0.5 h-6" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="w-1 rounded-full h-full origin-bottom"
                style={{ background: `linear-gradient(180deg, ${accentFrom}, ${accentTo})` }}
                // v215 — scaleY (transform) به‌جای height (layout reflow)
                animate={{ scaleY: [0.27, 0.82, 0.45, 1, 0.36] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
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
              : hydrated
                ? "از موسیقی‌های گوشیت اضافه کن"
                : "در حال بارگذاری لیست…"}
          </p>
        </div>

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
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerEnd}
            onPointerCancel={onBarPointerEnd}
            onKeyDown={(e) => {
              if (!duration || !audioRef.current) return;
              if (e.key === "ArrowLeft") {
                audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
              } else if (e.key === "ArrowRight") {
                audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
              }
            }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full pointer-events-none"
              style={{ width: `${duration ? (progress / duration) * 100 : 0}%`, background: `linear-gradient(90deg, ${accentFrom}, ${accentTo})` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 rounded-full bg-white shadow-md border-2 border-orange-500 pointer-events-none opacity-90 group-hover:scale-110 transition"
              style={{ left: `${duration ? (progress / duration) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 font-mono shrink-0 w-10 text-center">{fmt(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-4 mb-3">
          <button onClick={prev} disabled={gymPlaylist.length === 0} className="p-2 rounded-full hover:bg-orange-50 text-slate-700 transition disabled:opacity-30" aria-label="آهنگ قبلی">
            <SkipBack className="w-5 h-5 scale-x-[-1]" />
          </button>
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 transition"
            style={{ ...accentStyle, boxShadow: "0 10px 25px -5px rgba(249, 115, 22, 0.5)" }}
            aria-label={isPlaying ? "توقف پخش" : "پخش"}
          >
            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current mr-0.5" />}
          </button>
          <button onClick={next} disabled={gymPlaylist.length === 0} className="p-2 rounded-full hover:bg-orange-50 text-slate-700 transition disabled:opacity-30" aria-label="آهنگ بعدی">
            <SkipForward className="w-5 h-5 scale-x-[-1]" />
          </button>
        </div>

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
          <div className="flex items-center gap-1.5 px-4 py-2 text-[11px] text-slate-500 sticky top-0 bg-white">
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
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${i === currentTrackIdx ? "text-white" : "bg-slate-100 text-slate-600"}`} style={i === currentTrackIdx ? accentStyle : undefined}>
                {i === currentTrackIdx && isPlaying ? (
                  <div className="flex items-end gap-0.5 h-3">
                    {[0, 1, 2].map((j) => (
                      <motion.div
                        key={j}
                        className="w-0.5 bg-current rounded-full h-full origin-bottom"
                        // v215 — scaleY (transform) به‌جای height (layout reflow)
                        animate={{ scaleY: [0.38, 1, 0.38] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: j * 0.1, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] font-bold">{toPersianDigits(i + 1)}</span>
                )}
              </div>
              <span className={`flex-1 text-xs truncate ${i === currentTrackIdx ? "text-orange-600 font-bold" : "text-slate-700"}`}>{track.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTrack(track.id);
                }}
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
        </>
      ) : (
        /* ─── v218 — حالت جمع‌شده (پیش‌فرض — دیرکتیو مالک: «دقیقاً مثل چالش‌ها») ───
            همان ردیف فشردهٔ جلسهٔ چالش: دکمهٔ پخش + نام ترک + ویژوالایزر + بعدی
            + فلش بازکردن — پخش در حالت جمع هم ادامه دارد. */
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={togglePlay}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md active:scale-95 transition"
            style={accentStyle}
            aria-label={isPlaying ? "توقف موزیک" : "پخش موزیک"}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current mr-0.5" />}
          </button>
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => setFullOpen(true)}
            role="button"
            tabIndex={0}
            aria-label="باز کردن پلیر موزیک"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFullOpen(true);
              }
            }}
          >
            <p className="text-sm font-bold text-slate-900 truncate">
              {currentTrack?.name || "موزیک خودت را اضافه کن"}
            </p>
            <p className="text-[10px] text-slate-500">
              {gymPlaylist.length > 0
                ? `آهنگ ${toPersianDigits(currentTrackIdx + 1)} از ${toPersianDigits(gymPlaylist.length)}`
                : hydrated
                  ? "از موسیقی‌های گوشیت اضافه کن"
                  : "در حال بارگذاری لیست…"}
            </p>
          </div>
          {isPlaying && (
            <div className="flex items-end gap-0.5 h-4 shrink-0" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-1 rounded-full h-full origin-bottom"
                  style={{ background: `linear-gradient(180deg, ${accentFrom}, ${accentTo})` }}
                  animate={{ scaleY: [0.29, 0.86, 0.43, 1, 0.36] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                />
              ))}
            </div>
          )}
          <button onClick={next} disabled={gymPlaylist.length === 0} className="p-2 rounded-lg hover:bg-orange-50 text-slate-600 disabled:opacity-30 transition" aria-label="آهنگ بعدی">
            {/* در RTL «بعدی» رو به چپ است — آینه‌سازی آیکون */}
            <SkipForward className="w-4 h-4 scale-x-[-1]" />
          </button>
          <button
            onClick={() => setFullOpen(true)}
            className="p-2 rounded-lg hover:bg-orange-50 text-slate-500 hover:text-orange-600 transition"
            aria-label="باز کردن پلیر موزیک"
            title="باز کردن پلیر"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
});
