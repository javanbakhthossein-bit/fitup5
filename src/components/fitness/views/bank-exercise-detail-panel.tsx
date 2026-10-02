"use client";

import { useEffect, useMemo, useState } from "react";
import { Dumbbell, X, PlayCircle, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/fitness/store";
// v169 — هشدار فیلترشکن زیر ویدیوهای یوتیوب (دیرکتیو مالک)
import { YoutubeVpnNote } from "@/components/fitness/youtube-vpn-note";
import { resolveExerciseVideoSrc } from "@/lib/fitness/exercise-video";
// v171 — کش سشن + تک‌پرواز مشترک جزئیات حرکت بانک
import { getExerciseDetailById, peekExerciseDetail } from "@/lib/fitness/exercise-lib-cache";

/**
 * ─── v139 — پنل جزئیات حرکتِ «بانک حرکات داخل پنل» ───
 *
 * از store خوانده می‌شود (exerciseDetailId + overlay="exerciseBankDetail") —
 * یعنی بک مرورگر/اندروید فقط همین اورلی را می‌بندد (گارد FE-M8 در main-app)
 * و کاربر در تب بانک حرکات می‌ماند؛ هیچ ناوبری به مسیر عمومی انجام نمی‌شود.
 * ویدیوی بانک برای همهٔ کاربران آزاد است (تفاوت با اورلی برنامهٔ پلن‌دار).
 */

interface Detail {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  description: string;
  tips: string;
  youtubeUrl: string;
  videoUrl: string;
  videoPosterUrl: string;
  youtubeEnabled: boolean;
  related?: { id: string; name: string; muscle: string }[];
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "مبتدی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};

export function BankExerciseDetailPanel() {
  const exerciseDetailId = useAppStore((s) => s.exerciseDetailId);
  const setOverlay = useAppStore((s) => s.setOverlay);
  const setExerciseDetailId = useAppStore((s) => s.setExerciseDetailId);
  // نتیجهٔ واکشی — فقط وقتی idاش با حرکت فعلی یکی باشد اعمال می‌شود (ضد race)
  const [fetchResult, setFetchResult] = useState<{ id: string; detail: Detail | null } | null>(null);

  // v171 — رندر مشتق: کش سشن مشترک ماژول → حرکت باز‌شدهٔ قبلی «همان لحظه»
  // (بدون شبکه و بدون setState همگام داخل effect) نمایش داده می‌شود
  const detail: Detail | null = useMemo(() => {
    if (!exerciseDetailId) return null;
    const cached = peekExerciseDetail(exerciseDetailId);
    if (cached) return cached as unknown as Detail;
    return fetchResult && fetchResult.id === exerciseDetailId ? fetchResult.detail : null;
  }, [exerciseDetailId, fetchResult]);
  // loading هم مشتق است: id فعلی هست ولی هنوز نتیجه‌ای (حتی «یافت نشد») نرسیده
  const loading = !!exerciseDetailId && detail == null && fetchResult?.id !== exerciseDetailId;

  useEffect(() => {
    if (!exerciseDetailId) return;
    // کش سشن — بازکردن دوبارهٔ همان حرکت بدون شبکه (صفر setState همگام)
    if (peekExerciseDetail(exerciseDetailId)) return;
    let cancelled = false;
    // v171 — کش + تک‌پرواز به ماژول مشترک منتقل شد (قبلاً کش روی خودِ تابع
    // کامپوننت بود)؛ همان endpoint قبلی /api/exercises/[id] با related.
    getExerciseDetailById(exerciseDetailId).then((d) => {
      if (!cancelled) {
        setFetchResult({ id: exerciseDetailId, detail: (d ?? null) as Detail | null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [exerciseDetailId]);

  const video = useMemo(() => resolveExerciseVideoSrc(detail as never), [detail]);

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* هدر برند */}
      <div className="bg-gradient-to-l from-orange-600 to-amber-500 text-white p-4 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
          <Dumbbell className="w-5 h-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-base sm:text-lg leading-snug truncate">
            {loading ? "…" : detail?.name || "جزئیات حرکت"}
          </h2>
          {detail && (
            <p className="text-[11px] text-orange-100 mt-0.5">
              {detail.muscle} • {DIFFICULTY_LABELS[detail.difficulty] ?? detail.difficulty}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOverlay(null)}
          className="rounded-full text-white hover:bg-white/15 hover:text-white shrink-0"
          aria-label="بستن"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-4">
        {video.kind === "file" && (
          <video
            src={`${video.src}#t=0.1`}
            poster={video.poster || undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-2xl bg-black aspect-video"
          />
        )}
        {video.kind === "youtube" && (
          <div className="w-full rounded-2xl overflow-hidden aspect-video bg-black">
            <iframe
              src={video.src}
              title={`ویدیوی آموزش ${detail?.name ?? ""}`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
        {/* v169 — هشدار فیلترشکن زیر ویدیوی یوتیوب (دیرکتیو مالک) */}
        {video.kind === "youtube" && <YoutubeVpnNote variant="inline" />}
        {video.kind === "none" && detail && (
          <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400 font-bold">
            ویدیویی برای این حرکت ثبت نشده
          </div>
        )}

        {loading && (
          <div className="space-y-2.5" aria-busy>
            <div className="h-4 rounded-full bg-slate-100 animate-pulse w-3/4" />
            <div className="h-4 rounded-full bg-slate-100 animate-pulse w-full" />
            <div className="h-4 rounded-full bg-slate-100 animate-pulse w-5/6" />
          </div>
        )}

        {detail?.description && (
          <section>
            <h3 className="font-black text-sm text-slate-800 mb-1.5 flex items-center gap-1.5">
              <PlayCircle className="w-4 h-4 text-orange-500" aria-hidden /> نحوهٔ اجرا
            </h3>
            <p className="text-sm text-slate-600 leading-7 whitespace-pre-line">{detail.description}</p>
          </section>
        )}

        {detail?.tips && (
          <section className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5">
            <h3 className="font-black text-sm text-amber-800 mb-1 flex items-center gap-1.5">
              <Video className="w-4 h-4 text-amber-600" aria-hidden /> نکات ایمنی
            </h3>
            <p className="text-sm text-amber-700 leading-7 whitespace-pre-line">{detail.tips}</p>
          </section>
        )}

        {detail?.related && detail.related.length > 0 && (
          <section>
            <h3 className="font-black text-sm text-slate-800 mb-2">حرکات مرتبط</h3>
            <div className="flex flex-wrap gap-1.5">
              {detail.related.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setExerciseDetailId(r.id)}
                  className="px-3 h-8 rounded-full text-xs font-bold bg-slate-100 hover:bg-orange-50 hover:text-orange-600 text-slate-600 transition-colors"
                >
                  {r.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
