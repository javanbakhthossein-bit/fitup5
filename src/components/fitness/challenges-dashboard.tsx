"use client";

/**
 * v183 — یکپارچه‌سازی چالش‌ها در داشبورد — v189: کارت مشترک شد
 *
 * دیرکتیوهای مالک:
 *  • v189 — کارت چالش‌ها در «صفحهٔ چالش‌ها» دقیقاً همین کارتِ خلوت داشبورد است
 *    (ChallengeMiniCard مشترک شد — یک طراحی واحد در دو جا).
 *  • v189 — این بخش فقط برای کاربرانِ بدون پلن در داشبورد رندر می‌شود
 *    (گیت در dashboard-view با !user?.planName).
 *  • v189 — بهینه‌سازی سرعت: تامب‌نیل WebP (~۱۳KB) به‌جای عکس کامل (~۹۰KB)
 *    + حذف backdrop-blur از چیپ‌ها (عامل اصلی لگِ اسلاید روی موبایل).
 *  • تفکیک جنسیتی سفت: کاربر فقط چالش‌های جنسیت خودش را می‌بیند.
 */
import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Trophy, CalendarDays, Clock, Check, Play, ChevronLeft } from "lucide-react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { toPersianDigits } from "@/lib/fitness/types";
import { useAppStore } from "@/lib/fitness/store";
import { useChallenges } from "@/lib/fitness/use-challenges";
import {
  CH_DIFFICULTY_LABELS,
  challengePercent,
  coverThumb,
  type ChallengeDef,
} from "@/lib/fitness/challenges-data";

/** زیرکاروسل در داشبورد — بلافاصله زیر کارت مشکی */
export function ChallengesDashboardStrip() {
  const { bundle, progress, loading } = useChallenges();
  const setMainTab = useAppStore((s) => s.setMainTab);
  const challenges = bundle?.challenges ?? [];
  const genderLabel = bundle?.gender === "men" ? "آقایان" : "خانم‌ها";

  const sorted = useMemo(() => {
    // چالش‌های در حال اجرا اول، بعد بقیه
    return [...challenges].sort((a, b) => {
      const pa = progress[a.slug] ? 1 : 0;
      const pb = progress[b.slug] ? 1 : 0;
      return pb - pa;
    });
  }, [challenges, progress]);

  if (loading && challenges.length === 0) {
    return (
      <div className="rounded-3xl border border-orange-100 bg-gradient-to-l from-orange-50 to-amber-50 p-4 animate-pulse" aria-hidden="true">
        <div className="h-5 w-40 rounded bg-orange-200/70 mb-3" />
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="min-w-0 flex-[0_0_38%] sm:flex-[0_0_26%] aspect-[4/5] rounded-2xl bg-orange-100/80" />
          ))}
        </div>
      </div>
    );
  }

  if (challenges.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-3xl p-[1.5px] shadow-lg shadow-orange-500/10"
      style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.75), rgba(251,191,36,0.5), rgba(234,88,12,0.7))" }}
      aria-label={`چالش‌های ${genderLabel}`}
    >
      <div className="rounded-[22px] bg-gradient-to-b from-[#fffdf8] to-[#fff4e4] p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 shadow" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-sm text-slate-900 leading-tight">چالش‌های فیتاپ</h3>
              <p className="text-[10px] text-slate-500">مخصوص {genderLabel} — رایگان برای همه</p>
            </div>
          </div>
          <button
            onClick={() => setMainTab("challenges")}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black text-white shadow active:scale-95 transition hover:brightness-110"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            aria-label="مشاهده همهٔ چالش‌ها"
          >
            همه
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <Carousel opts={{ align: "start", dragFree: true, direction: "rtl" }} className="w-full">
          <CarouselContent className="-ml-2.5 py-0.5">
            {sorted.slice(0, 10).map((c) => (
              <CarouselItem key={c.slug} className="pl-2.5 basis-[44%] sm:basis-[30%] lg:basis-[24%]">
                <ChallengeMiniCard
                  challenge={c}
                  progressPercent={challengePercent(progress[c.slug], c)}
                  done={!!progress[c.slug]?.completedAt}
                  inProgress={!!progress[c.slug]}
                  onClick={() => setMainTab("challenges")}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </motion.section>
  );
}

/**
 * کارت مشترک چالش — v189: هم در کاروسل داشبورد هم در گرید صفحهٔ چالش‌ها.
 * خلوت: عکس + گرادیان + بج پیشرفت/اتمام + عنوان + ۲ چیپ + نوار پیشرفت.
 * تصویر: تامب‌نیل WebP سبک (بهینه‌سازی لگ — دیرکتیو مالک).
 *
 * v215 — نرم‌سازی اسلایدر (گزارش مالک: «اسلایدر لگ داره»):
 *  ① whileTap framer حذف شد — دو سیستم ژست (framer + embla drag) روی یک لمس
 *     با هم می‌جنگیدند و کارت وسط drag چروک می‌شد؛ بجایش CSS active:scale.
 *  ② زوم hover فقط برای موس (md:) — در تاچ، hover بعد از تپ می‌چسبید و
 *     انیمیشن ۵۰۰ms وسط drag اجرا می‌شد.
 *  ③ memo — re-render داشبورد (پالس) دیگر ۱۰ کارت کاروسل را reconcile نمی‌کند.
 *  ④ onError تصویر → placeholder گرادیانی (طوفان ۴۰۴ روی سرورهای فاقد عکس
 *     چالش‌ها = ده‌ها درخواست شکست ۸۴KB — عامل اصلی حس لگ).
 */
export const ChallengeMiniCard = memo(function ChallengeMiniCard({
  challenge,
  progressPercent,
  done,
  inProgress,
  onClick,
}: {
  challenge: ChallengeDef;
  progressPercent: number;
  done: boolean;
  inProgress: boolean;
  onClick: () => void;
}) {
  const { from, to } = challenge.accent;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full rounded-2xl overflow-hidden text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 active:scale-[0.97] transition-transform duration-150 will-change-transform"
      style={{ boxShadow: `0 10px 24px -12px ${from}55` }}
      aria-label={`چالش ${challenge.title}`}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-orange-100 to-amber-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverThumb(challenge.cover)}
          alt={`کارت چالش ${challenge.title}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover md:transition-transform md:duration-300 md:group-hover:scale-[1.06]"
          onError={(e) => {
            // v215 — عکس چالش روی سرور نیست (از v197 خارج زیپ است) → placeholder گرادیانی
            // به‌جای ۴۰۴ (۸۴KB HTML) — هم شبکه تمیز می‌ماند هم کارت همیشه قشنگ است.
            const img = e.currentTarget;
            if (img.dataset.fallback === "1") return;
            img.dataset.fallback = "1";
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/></svg>`;
            img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
          }}
        />
        {/* گرادیان تیره برای خوانایی متن روی عکس */}
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.14) 34%, rgba(0,0,0,0.5) 58%, ${to}F0 86%, ${to} 100%)` }} />
        {done ? (
          <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow">
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={4} />
          </span>
        ) : inProgress ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-black/40 text-[8px] font-black text-white">
            <Play className="w-2 h-2 fill-current" />
            {toPersianDigits(progressPercent)}٪
          </span>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="text-[11.5px] font-black text-white leading-snug line-clamp-2" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>
            {challenge.emoji} {challenge.title}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/35 text-[8.5px] font-bold text-white">
              <CalendarDays className="w-2.5 h-2.5" />
              {toPersianDigits(challenge.durationDays)} روز
            </span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/35 text-[8.5px] font-bold text-white">
              <Clock className="w-2.5 h-2.5" />
              {CH_DIFFICULTY_LABELS[challenge.difficulty]}
            </span>
          </div>
          {(inProgress || done) && (
            <div className="h-1 rounded-full bg-white/25 overflow-hidden mt-1.5">
              <div className="h-full rounded-full" style={{ width: `${progressPercent}%`, background: "linear-gradient(90deg, #fbbf24, #f97316)" }} />
            </div>
          )}
        </div>
      </div>
    </button>
  );
});
