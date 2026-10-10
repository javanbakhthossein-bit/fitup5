"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Dumbbell, Info, AlertTriangle, Play, X, Lightbulb, Target, Lock, Youtube, Repeat, Layers, Clock, Subtitles, Wifi } from "lucide-react";
// v169 — هشدار فیلترشکن زیر ویدیوهای یوتیوب (دیرکتیو مالک)
import { YOUTUBE_VPN_MESSAGE } from "@/components/fitness/youtube-vpn-note";
import { resolveExerciseVideoSrc } from "@/lib/fitness/exercise-video";
// v190 — کپشن منبع ویدیوی Muscle Wiki (دیرکتیو مالک)
import { MwAttribution } from "@/components/fitness/mw-attribution";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { canAccess, toPersianDigits, type PlanExercise } from "@/lib/fitness/types";
import { formatSetsSummary, formatRestSec } from "@/lib/fitness/workout-display";
// v171 — جستجوی کش‌شدهٔ مشترک بانک حرکات (تک‌پرواز + کش ماژول‌سطح بین ویوها)
// v190 — getBankGates: کلیدهای سراسری یوتیوب/Muscle Wiki (کش ماژول‌سطح)
import { searchExerciseLibWithFallback, pickBestLibMatch, getBankGates, type BankGates } from "@/lib/fitness/exercise-lib-cache";

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "مبتدی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};

const CATEGORY_LABELS: Record<string, string> = {
  push: "فشار",
  pull: "کشش",
  legs: "پا",
  core: "مرکز بدن",
  cardio: "هوازی",
  fullbody: "بدن کامل",
};

/** برچسب فارسی نوع گروه (سوپرست/تری‌ست/جاینت‌ست) */
function groupTypeLabel(t?: string): string | null {
  if (t === "giant") return "جاینت‌ست";
  if (t === "triset") return "تری‌ست";
  if (t === "superset") return "سوپرست";
  return null;
}

export function ExerciseDetailOverlay() {
  // v229 — subscription انتخابی (الگوی main-app v55): کل-store → re-render اورلی
  // جزئیات حرکت با هر setState پنل (جانک گوشی ضعیف)
  const exerciseDetailId = useAppStore((s) => s.exerciseDetailId);
  const workoutPlan = useAppStore((s) => s.workoutPlan);
  const setOverlay = useAppStore((s) => s.setOverlay);
  const setExerciseDetailId = useAppStore((s) => s.setExerciseDetailId);
  const user = useAppStore((s) => s.user);
  const [exerciseData, setExerciseData] = useState<{
    youtubeUrl?: string;
    /** v190 — کلید تک‌حرکتی یوتیوب (resolver می‌خواند) */
    youtubeEnabled?: boolean | null;
    // v112 — ویدیوی اختصاصی فیتاپ (آپلود مدیر) — اولویت نمایش بالاتر از یوتیوب
    videoUrl?: string;
    videoPosterUrl?: string;
    /** v190 — ویدیوی Muscle Wiki (مرد/زن) + کلید تک‌حرکتی آن */
    mwVideoUrl?: string;
    mwVideoUrlFemale?: string;
    mwEnabled?: boolean | null;
    name?: string;
    muscle?: string;
    description?: string;
    tips?: string;
  } | null>(null);

  // v190 — گیت‌های سراسری بانک (یوتیوب/Muscle Wiki) — یک درخواست سبک، بعدش صفر شبکه
  const [gates, setGates] = useState<BankGates>({ youtubeEnabled: true, muscleWikiEnabled: true });
  useEffect(() => {
    let active = true;
    getBankGates().then((g) => {
      if (active) setGates(g);
    });
    return () => {
      active = false;
    };
  }, []);

  // User plan capabilities — fullExerciseLibrary requires Advanced+ plan
  const canViewVideos = canAccess(user?.planName ?? null, "fullExerciseLibrary");

  // Find exercise in plan (و حرکات خواهرخوانده در همان گروه سوپرست/تری‌ست/جاینت‌ست)
  let exercise: PlanExercise | null = null;
  let groupSiblings: { id: string; name: string }[] = [];
  if (workoutPlan && exerciseDetailId) {
    // v59 — گارد شکل داده (کش قدیمی): days/exercises هرگز undefined نباشند
    for (const day of workoutPlan.days ?? []) {
      const found = day.exercises?.find((e) => e.id === exerciseDetailId);
      if (found) {
        exercise = found;
        // اگر عضو گروه سوپرست/تری‌ست/جاینت‌ست است، حرکات هم‌گروه را جمع کن
        if (found.supersetGroup && found.supersetType) {
          groupSiblings = day.exercises
            .filter((e) => e.supersetGroup === found.supersetGroup && e.id !== found.id)
            .map((e) => ({ id: e.id, name: e.name }));
        }
        break;
      }
    }
  }

  // Always fetch the matching library exercise (for description + tips + youtubeUrl)
  // Description/tips are visible to all; youtubeUrl is gated by plan
  useEffect(() => {
    if (!exercise?.name) {
      queueMicrotask(() => setExerciseData(null));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Strategy: try exact search first, then fall back to keyword-based fuzzy search.
        // This handles cases where the AI generates a name like "نشر جانب دمبل" but the
        // library has "نشر از جانب" — we extract the most distinctive keyword and search.
        // v171 — همهٔ تلاش‌های جستجو از کش مشترک بانک حرکات می‌گذرند (همان زنجیرهٔ
        // فال‌بک کلمه‌به‌کلمهٔ قبلی، این‌بار بدون درخواست تکراری بین ویوها)
        const list = await searchExerciseLibWithFallback(exercise.name);

        // Score each result by similarity to find the best match
        const match = pickBestLibMatch(exercise.name, list);

        if (!cancelled && match) {
          setExerciseData({
            youtubeUrl: match.youtubeUrl || "",
            youtubeEnabled: match.youtubeEnabled,
            videoUrl: match.videoUrl || "",
            videoPosterUrl: match.videoPosterUrl || "",
            // v190 — فیلدهای Muscle Wiki ردیف بانک (API وقتی گیت سراسری خاموش باشد خالی می‌فرستد)
            mwVideoUrl: match.mwVideoUrl || "",
            mwVideoUrlFemale: match.mwVideoUrlFemale || "",
            mwEnabled: match.mwEnabled,
            name: match.name,
            muscle: match.muscle,
            description: match.description,
            tips: match.tips,
          });
        }
      } catch {
        // ignore — fall back to plan exercise data
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exercise?.name]);

  if (!exercise) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">حرکت یافت نشد.</p>
        <Button onClick={() => setOverlay(null)} className="mt-4">بستن</Button>
      </div>
    );
  }

  // v65 — زیرنویس فارسی پیش‌فرض روی embed یوتیوب حالا داخل خود resolver اعمال می‌شود

  // v112 — حل منبع ویدیو با اولویت: فایل اختصاصی → Muscle Wiki (v190) → یوتیوب → هیچ
  // (گیت پلن canViewVideos دست‌نخورده — فایل هم مثل یوتیوب فقط Advanced+)
  // v190 — با هر دو کلید سراسری بانک (یوتیوب/Muscle Wiki)
  const resolvedVideo = resolveExerciseVideoSrc(exerciseData, {
    youtubeEnabled: gates.youtubeEnabled,
    muscleWikiEnabled: gates.muscleWikiEnabled,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-bold">جزئیات حرکت</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOverlay(null)}
          className="rounded-full"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Video / Animation area */}
        <div className="relative bg-gradient-to-br from-primary/20 via-emerald-600/10 to-background overflow-hidden">
          {canViewVideos && resolvedVideo.kind === "file" ? (
            // v112 — ویدیوی محلی (اختصاصی یا Muscle Wiki — v190) — HTML5 video
            <div className="w-full">
              <div className="aspect-video w-full bg-black">
                <video
                  src={`${resolvedVideo.src}#t=0.1`}
                  poster={resolvedVideo.poster || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full h-full"
                />
              </div>
              {/* v190 — کپشن زیر ویدیو: اختصاصی = برچسب فیتاپ (بدون تغییر)، MW = منبع ماسل ویکی */}
              {resolvedVideo.source === "custom" ? (
                <div className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-50 border-t border-emerald-200">
                  <Play className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-[11px] text-emerald-700 font-medium">ویدیوی اختصاصی فیتاپ</span>
                </div>
              ) : (
                <div className="px-4 pt-2 pb-1">
                  <MwAttribution className="mt-1" />
                </div>
              )}
            </div>
          ) : canViewVideos && resolvedVideo.kind === "youtube" ? (
            // Advanced+ plan with available YouTube video — show iframe
            <div className="w-full">
              <div className="aspect-video w-full bg-black">
                <iframe
                  src={resolvedVideo.src}
                  title={`ویدیو آموزشی ${exercise.name}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              {/* YouTube disclaimer — v69: زیرنویس خودکار + ذکر منبع یوتیوب + v169 فیلترشکن */}
              <div className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-200 flex-wrap">
                <span className="flex items-center gap-1.5 min-w-0">
                  <Wifi className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-[11px] text-amber-800 font-bold">{YOUTUBE_VPN_MESSAGE}</span>
                </span>
                <span className="w-1 h-1 rounded-full bg-amber-300 shrink-0" aria-hidden />
                <span className="flex items-center gap-1.5 min-w-0">
                  <Subtitles className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-[11px] text-amber-700 font-medium">در صورتی که ویدیو انگلیسی است، از تنظیمات ویدیو زیرنویس فارسی را روشن کنید</span>
                </span>
                <span className="w-1 h-1 rounded-full bg-amber-300 shrink-0" aria-hidden />
                <span className="flex items-center gap-1.5 min-w-0">
                  <Youtube className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-[11px] text-slate-500 font-medium">ویدیو از یوتیوب</span>
                </span>
              </div>
            </div>
          ) : canViewVideos ? (
            // Advanced+ plan but no video available — fallback to animated icon
            <div className="relative h-56 flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-10 right-10 w-32 h-32 rounded-full bg-primary/40 blur-2xl" />
                <div className="absolute bottom-10 left-10 w-24 h-24 rounded-full bg-emerald-500/40 blur-2xl" />
              </div>
              <motion.div
                animate={{ y: [0, -12, 0], rotate: [0, -5, 5, 0] }}
                // v222 — حلقهٔ بی‌نهایت ممنوع؛ ورود یک‌باره (compositor-only)
                transition={{ duration: 2.5, ease: "easeInOut" }}
                className="relative"
              >
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center shadow-2xl">
                  <Dumbbell className="w-12 h-12 text-white" strokeWidth={2} />
                </div>
              </motion.div>
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur text-xs">
                <Play className="w-3.5 h-3.5 text-primary" />
                <span>انیمیشن آموزشی</span>
              </div>
              <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] text-amber-700 font-medium flex items-center gap-1">
                <Youtube className="w-3 h-3" />
                ویدیو به‌زودی
              </div>
              <div className="absolute bottom-3 inset-x-3 text-center">
                <p className="text-[11px] text-slate-500 font-medium leading-5">
                  این حرکت فعلاً ویدیوی آموزشی ندارد؛ به‌زودی در آپدیت‌های بعدی تکمیل می‌شود 🎬
                </p>
              </div>
            </div>
          ) : (
            // Basic/Standard plan — locked video
            <div className="relative h-56 flex flex-col items-center justify-center gap-3 px-6 text-center overflow-hidden">
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-10 right-10 w-32 h-32 rounded-full bg-primary/40 blur-2xl" />
                <div className="absolute bottom-10 left-10 w-24 h-24 rounded-full bg-emerald-500/40 blur-2xl" />
              </div>
              <div className="relative w-20 h-20 rounded-3xl bg-slate-200 flex items-center justify-center shadow-lg">
                <Lock className="w-10 h-10 text-slate-500" />
              </div>
              <div className="relative">
                <p className="font-bold text-slate-900 text-sm mb-1">ویدیو حرکت قفل است</p>
                <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                  برای مشاهده ویدیوهای آموزشی حرکات، پلن پیشرفته یا حرفه‌ای تهیه کنید.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <h3 className="text-xl font-black mb-1">{exercise.name}</h3>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary">{exercise.muscle}</Badge>
              <Badge variant="outline">{CATEGORY_LABELS[exercise.category] || exercise.category}</Badge>
              <Badge className="bg-primary/10 text-primary border border-primary/20">
                {DIFFICULTY_LABELS[exercise.difficulty] || exercise.difficulty}
              </Badge>
            </div>
          </div>

          {/* عضویت در گروه سوپرست/تری‌ست/جاینت‌ست */}
          {exercise.supersetGroup && exercise.supersetType && (() => {
            const label = groupTypeLabel(exercise.supersetType);
            if (!label) return null;
            const isGiant = exercise.supersetType === "giant";
            const containerCls = isGiant
              ? "bg-gradient-to-l from-rose-500/10 to-orange-500/5 border-rose-300"
              : "bg-gradient-to-l from-purple-500/10 to-fuchsia-500/5 border-purple-300";
            const iconCls = isGiant ? "text-rose-500" : "text-purple-500";
            const titleCls = isGiant ? "text-rose-700" : "text-purple-700";
            return (
              <div className={`p-3.5 rounded-2xl border ${containerCls}`}>
                <div className="flex items-center gap-2 mb-2">
                  {isGiant ? <Layers className={`w-4 h-4 ${iconCls}`} /> : <Repeat className={`w-4 h-4 ${iconCls}`} />}
                  <h4 className={`font-bold text-sm ${titleCls}`}>
                    این حرکت عضو {label} گروه {exercise.supersetGroup} است
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-1">
                  ⚡ بدون استراحت بین حرکات این گروه — حرکات را پشت‌سرهم اجرا کنید، سپس بین گروه‌ها (یا بین دورها در جاینت‌ست) استراحت کنید.
                </p>
                {isGiant && (exercise.circuitRounds || exercise.restBetweenRounds) && (
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
                    {exercise.circuitRounds ? (
                      <span className={`flex items-center gap-1 font-bold ${titleCls}`}>
                        <Repeat className="w-3 h-3" />
                        {toPersianDigits(exercise.circuitRounds)} دور
                      </span>
                    ) : null}
                    {exercise.restBetweenRounds ? (
                      <span className={`flex items-center gap-1 ${titleCls}`}>
                        <Clock className="w-3 h-3" />
                        استراحت بین دورها: {toPersianDigits(exercise.restBetweenRounds)} ثانیه
                      </span>
                    ) : null}
                  </div>
                )}
                {groupSiblings.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-current/10">
                    <p className="text-[11px] font-bold text-muted-foreground mb-1.5">حرکات هم‌گروه:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {groupSiblings.map((sib) => (
                        <button
                          key={sib.id}
                          onClick={() => setExerciseDetailId(sib.id)}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-background/80 border border-current/20 hover:bg-background transition"
                        >
                          {sib.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Description */}
          <div className="p-4 rounded-2xl bg-card border">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-primary" />
              <h4 className="font-bold text-sm">نحوه انجام</h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {exerciseData?.description || exercise.description || "توضیحات این حرکت به‌زودی اضافه خواهد شد."}
            </p>
          </div>

          {/* Tips */}
          {(exerciseData?.tips || exercise.tips) && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h4 className="font-bold text-sm">نکات ایمنی</h4>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{exerciseData?.tips || exercise.tips}</p>
            </div>
          )}

          {/* Sets overview — v55: خلاصهٔ سینک + ردیف ست‌ها با فرمت واحد سایت */}
          <div className="p-4 rounded-2xl bg-card border">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-primary" />
              <h4 className="font-bold text-sm">برنامه ست‌ها</h4>
            </div>
            {/* خلاصهٔ یک‌خطی واضح — همان فرمت تمرین امروز/شروع تمرین/حالت باشگاه */}
            <div className="mb-3 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm font-black text-primary text-center">
              {formatSetsSummary(exercise.sets)}
            </div>
            <div className="space-y-2">
              {exercise.sets.map((s) => (
                <div
                  key={s.setNumber}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40"
                >
                  <span className="text-sm font-medium">ست {toPersianDigits(s.setNumber)}</span>
                  <div className="flex gap-3 text-xs">
                    <span className="text-muted-foreground">
                      تکرار: <span className="font-bold text-foreground">{toPersianDigits(s.reps)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      استراحت: <span className="font-bold text-foreground">{formatRestSec(s.restSec)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Tip */}
          <div className="p-4 rounded-2xl bg-gradient-to-l from-primary/10 to-emerald-500/5 border border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              <h4 className="font-bold text-sm">نکته فیتاپ هوشمند</h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              روی فرم صحیح تمرکز کنید، نه روی وزنه سنگین. کیفیت حرکت از کمیت آن مهم‌تر است. اگر احساس درد داشتید، تمرین را متوقف کنید.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
