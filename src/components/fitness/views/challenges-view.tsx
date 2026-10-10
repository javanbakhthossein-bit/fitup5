"use client";

/**
 * v183 — صفحهٔ «چالش‌های فیتاپ» — هاب + جزئیات (یک تب ایزوله در پنل) — v189 بازطراحی
 *
 * دیرکتیوهای مالک که اینجا پیاده شده‌اند:
 *  • تفکیک جنسیتی سفت: کاربر فقط چالش‌های جنسیت خودش را می‌بیند (دیتای
 *    جنسیت مقابل اصلاً import نمی‌شود — نه نمایش، نه دانلود)
 *  • رایگان برای همه (بدون گیت پلن)
 *  • v189 — کارت چالش‌ها = دقیقاً همان کارتِ خلوت داشبورد (ChallengeMiniCard مشترک)
 *  • v189 — بهینه‌سازی سرعت صفحه: تامب‌نیل WebP سبک به‌جای عکس کامل در گریدها
 *  • v189 — بنر: بدون «چالش‌های آقایان/خانم‌ها» و «۱۷ چالش فعال» و «بدون نیاز به باشگاه»
 *    — فقط «رایگان برای همه» + بقیهٔ موارد
 *  • v189 — دکمهٔ «شروع از اول» (ریست) برای چالشِ شروع‌شده
 *  • روزهای هر چالش با برنامهٔ ثابت جنسیتی + پیش‌نمایش هر روز
 *  • CTAهای جذاب فروش برنامهٔ شخصی‌سازی‌شده همه‌جا (بدون مسدود کردن)
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  Trophy,
  Flame,
  CalendarDays,
  Clock,
  Dumbbell,
  Check,
  Play,
  Sparkles,
  Zap,
  Target,
  Crown,
  UserCheck,
  ArrowRight,
  Lock,
  Medal,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";
import { useAppStore } from "@/lib/fitness/store";
import {
  useChallenges,
  type ChallengesBundle,
} from "@/lib/fitness/use-challenges";
import {
  CH_DIFFICULTY_LABELS,
  CHALLENGE_CTAS,
  challengePercent,
  buildChallengeDay,
  coverThumb,
  type ChallengeCta,
  type ChallengeDef,
} from "@/lib/fitness/challenges-data";
import { challengeRich } from "@/lib/fitness/challenges-rich-text";
import { ChallengeMiniCard } from "@/components/fitness/challenges-dashboard";

const CTA_ICONS = { sparkles: Sparkles, target: Target, zap: Zap, crown: Crown, flame: Flame, "user-check": UserCheck } as const;

/* ─────────────────────────────────────────────────────────────
 * بلوک CTA مشترک (بانک CTA — در هاب/جزئیات/پایان)
 * ───────────────────────────────────────────────────────────── */
export function ChallengeCtaBlock({
  cta,
  variant = "full",
  seed = 0,
}: {
  cta?: ChallengeCta;
  variant?: "full" | "compact";
  seed?: number;
}) {
  const setMainTab = useAppStore((s) => s.setMainTab);
  const c = cta ?? CHALLENGE_CTAS[seed % CHALLENGE_CTAS.length];
  const Icon = CTA_ICONS[c.icon] ?? Sparkles;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-3xl p-[1.5px] shadow-lg shadow-orange-500/15"
      style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.9), rgba(251,191,36,0.6), rgba(234,88,12,0.85))" }}
    >
      <div className="relative rounded-[22px] bg-gradient-to-br from-stone-900 via-stone-900 to-stone-800 p-4 sm:p-5 overflow-hidden">
        <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-orange-500/20 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-12 -right-8 w-36 h-36 rounded-full bg-amber-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-sm sm:text-base text-white leading-snug">{c.headline}</h3>
            {variant === "full" && <p className="text-[11px] sm:text-xs text-amber-100/75 leading-relaxed mt-1.5">{c.body}</p>}
            <button
              onClick={() => setMainTab("plans")}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white shadow-lg active:scale-95 transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {c.button}
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * v189 — کارت چالش حذف شد: کارت مشترک ChallengeMiniCard (دقیقاً کارت داشبورد)
 * ───────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────
 * ویو اصلی — هاب و جزئیات
 * ───────────────────────────────────────────────────────────── */
export function ChallengesView() {
  const { bundle, progress, loading, error, startChallenge, resetChallenge } = useChallenges();

  // v190 — slug جزئیات به store منتقل شد (به‌جای state محلی) تا «back گوشی»
  // بتواند دقیقاً همین ویو را restore کند (push/pop در خود setter انجام می‌شود)
  const selectedSlug = useAppStore((s) => s.selectedChallengeSlug);
  const setSelectedSlug = useAppStore((s) => s.setSelectedChallengeSlug);
  const [previewDay, setPreviewDay] = useState<number | null>(null);

  // جلسهٔ چالش سراسری در main-app رندر می‌شود (ChallengeSessionGlobal) —
  // حین تمرین این ویو زیرش می‌ماند و مونت نمی‌شود (گارد main-app).

  if (loading && !bundle) {
    return (
      <div className="px-4 py-4 space-y-4 max-w-5xl mx-auto lg:px-6">
        <div className="h-44 rounded-3xl bg-gradient-to-l from-orange-100 to-amber-50 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Trophy className="w-10 h-10 text-orange-300 mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>تلاش مجدد</Button>
        </div>
      </div>
    );
  }

  return <ChallengesHub bundle={bundle} progress={progress} onOpenChallenge={setSelectedSlug} onStartChallenge={startChallenge} onResetChallenge={resetChallenge} selectedSlug={selectedSlug} setSelectedSlug={setSelectedSlug} previewDay={previewDay} setPreviewDay={setPreviewDay} />;
}

function ChallengesHub({
  bundle,
  progress,
  onOpenChallenge,
  onStartChallenge,
  onResetChallenge,
  selectedSlug,
  setSelectedSlug,
  previewDay,
  setPreviewDay,
}: {
  bundle: ChallengesBundle | null;
  progress: ReturnType<typeof useChallenges>["progress"];
  onOpenChallenge: (slug: string) => void;
  onStartChallenge: (slug: string) => Promise<void>;
  onResetChallenge: (slug: string) => Promise<void>;
  selectedSlug: string | null;
  setSelectedSlug: (s: string | null) => void;
  previewDay: number | null;
  setPreviewDay: (d: number | null) => void;
}) {
  if (!bundle) return null;
  const { challenges, gender } = bundle;
  const selected = challenges.find((c) => c.slug === selectedSlug) ?? null;

  if (selected) {
    return (
      <ChallengeDetailView
        challenge={selected}
        progressEntry={progress[selected.slug]}
        onBack={() => {
          setSelectedSlug(null);
          setPreviewDay(null);
        }}
        onStartChallenge={onStartChallenge}
        onResetChallenge={onResetChallenge}
        previewDay={previewDay}
        setPreviewDay={setPreviewDay}
      />
    );
  }

  const inProgressList = challenges.filter((c) => {
    const p = progress[c.slug];
    return p && !p.completedAt && (p.completedDays?.length ?? 0) > 0;
  });
  // v189 — بنر با تامب‌نیل ۹۶۰px WebP (بهینه‌سازی لگ — همان کیفیت در عرض‌های معمول)
  const heroSrc = gender === "men" ? coverThumb("/images/challenges/men/m-hero.jpg") : coverThumb("/images/challenges/women/w-hero.jpg");
  const heroAlt = gender === "men" ? "چالش‌های آقایان فیتاپ" : "چالش‌های خانم‌ها فیتاپ";

  return (
    <div className="px-4 py-4 space-y-4 max-w-5xl mx-auto lg:px-6">
        {/* ─── هیرو ─── v189: فقط «رایگان برای همه» — بدون چیپ جنسیت/آمار (دیرکتیو مالک) ─── */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative rounded-3xl overflow-hidden shadow-xl shadow-orange-500/10"
          aria-label="چالش‌های فیتاپ"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroSrc} alt={heroAlt} className="absolute inset-0 w-full h-full object-cover object-left" onError={(e) => {
            // v215 — fallback گرادیانی به‌جای ۴۰۴ (عکس‌های چالش روی سرور دستی است)
            const img = e.currentTarget;
            if (img.dataset.fallback === "1") return;
            img.dataset.fallback = "1";
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs><rect width="960" height="360" fill="url(#g)"/></svg>`;
            img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
          }} />
          {/* v188 — گرادیان: چپ (عکس/شخصیت) شفاف، راست (متن) تیره — متن روی فضای خالی سمت راست */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(28,25,23,0.10) 0%, rgba(28,25,23,0.55) 42%, rgba(28,25,23,0.85) 68%, rgba(28,25,23,0.95) 100%)" }} />
          <div className="relative p-5 sm:p-6 min-h-[168px] flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black text-emerald-700 bg-emerald-300/90">
                <Check className="w-3 h-3" strokeWidth={4} />
                رایگان برای همه
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white leading-snug">
              {toPersianDigits(challenges.length)} چالش جذاب،
              <br className="hidden sm:block" /> یک بدن متفاوت
            </h1>
            <p className="text-[11px] sm:text-xs text-amber-100/80 leading-relaxed mt-1.5 max-w-md">
              هر چالش یک برنامهٔ روزانهٔ ثابت و حرفه‌ای دارد — روزبه‌روز پیشرفت کن، نقشهٔ تمرینت آماده است. موزیک گوشی‌ات را اضافه کن و بترکون!
            </p>
          </div>
        </motion.section>

        {/* ─── ادامه بده ─── v189: کارت مشترک داشبورد */}
        {inProgressList.length > 0 && (
          <section aria-label="چالش‌های در حال اجرا" className="space-y-2.5">
            <h2 className="font-black text-sm sm:text-base text-slate-900 flex items-center gap-2 px-1">
              <Zap className="w-5 h-5 text-orange-500" />
              ادامه بده، وسط راه نمان!
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {inProgressList.map((c) => (
                <ChallengeMiniCard
                  key={c.slug}
                  challenge={c}
                  progressPercent={challengePercent(progress[c.slug], c)}
                  done={!!progress[c.slug]?.completedAt}
                  inProgress
                  onClick={() => onOpenChallenge(c.slug)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ─── همهٔ چالش‌ها ─── v189: کارت مشترک داشبورد */}
        <section aria-label="همهٔ چالش‌ها" className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-black text-sm sm:text-base text-slate-900 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-orange-500" />
              همهٔ چالش‌های فیتاپ
            </h2>
            <span className="text-[10px] text-muted-foreground font-bold">{toPersianDigits(challenges.length)} چالش</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {challenges.map((c) => {
              const p = progress[c.slug];
              return (
                <ChallengeMiniCard
                  key={c.slug}
                  challenge={c}
                  progressPercent={challengePercent(p, c)}
                  done={!!p?.completedAt}
                  inProgress={!!p && !p.completedAt}
                  onClick={() => onOpenChallenge(c.slug)}
                />
              );
            })}
          </div>
        </section>

        {/* ─── CTA ─── */}
        <ChallengeCtaBlock variant="full" seed={new Date().getDate()} />

        {/* پانویس — تفکیک جنسیتی + ثبات محتوا */}
        <p className="text-center text-[10px] text-muted-foreground leading-relaxed pb-2">
          چالش‌های این صفحه مخصوص {gender === "men" ? "آقایان" : "خانم‌ها"} طراحی شده‌اند و برای همهٔ کاربران رایگان‌اند.
          <br />
          برنامهٔ «شخصی‌سازی‌شده» (ساخته‌شده فقط برای بدن خودت) بخشی از پلن‌های فیتاپ است.
        </p>
      </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * جزئیات چالش — کاور + توضیح + شبکهٔ روزها + پیش‌نمایش روز
 * ───────────────────────────────────────────────────────────── */
function ChallengeDetailView({
  challenge,
  progressEntry,
  onBack,
  onStartChallenge,
  onResetChallenge,
  previewDay,
  setPreviewDay,
}: {
  challenge: ChallengeDef;
  progressEntry: ReturnType<typeof useChallenges>["progress"][string] | undefined;
  onBack: () => void;
  onStartChallenge: (slug: string) => Promise<void>;
  onResetChallenge: (slug: string) => Promise<void>;
  previewDay: number | null;
  setPreviewDay: (d: number | null) => void;
}) {
  const { from, to } = challenge.accent;
  const rich = challengeRich(challenge.slug, challenge);
  const doneDays = progressEntry?.completedDays ?? [];
  const completedAll = !!progressEntry?.completedAt || doneDays.length >= challenge.durationDays;
  const nextDay = Math.min(challenge.durationDays, (doneDays.length > 0 ? Math.max(...doneDays) : 0) + 1);

  // ─── v190 — فیکس اسکرول: تپ روی کارت‌های پایین لیست هاب، جزئیات را از همان
  // پایین صفحه باز می‌کرد — با مونت جزئیات، یک‌بار به بالای پنل برمی‌گردیم
  // (همان الگوی اسکرول‌توپ تب‌ها در main-app: instant + تکرار پس از انیمیشن) ───
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    const t = setTimeout(() => window.scrollTo(0, 0), 200);
    return () => clearTimeout(t);
  }, []);

  const startOrContinue = async () => {
    if (completedAll) {
      toast.success("این چالش را فتح کردی! 🎉 می‌توانی دوباره از روز ۱ شروع کنی.");
    }
    await onStartChallenge(challenge.slug);
    // v183 فیکس — دکمهٔ اصلی باید مستقیم جلسهٔ روزِ بعدی را باز کند
    const launchDay = completedAll ? 1 : nextDay;
    setPreviewDay(launchDay);
    useAppStore.getState().startChallengeSession(challenge.slug, launchDay);
  };

  const launchDay = async (day: number) => {
    await onStartChallenge(challenge.slug);
    setPreviewDay(day);
    // شروع جلسه — از store
    useAppStore.getState().startChallengeSession(challenge.slug, day);
  };

  // v189 — ریست چالش: دو مرحله‌ای (تأیید درون‌خطی) + بازگشت به روز ۱
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const handleReset = async () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetting(true);
    try {
      await onResetChallenge(challenge.slug);
      setPreviewDay(null);
      toast.success("چالش ریست شد — از روز ۱ شروع کن 💪");
      setResetArmed(false);
    } finally {
      setResetting(false);
    }
  };

  const previewBuilt = previewDay ? buildChallengeDay(challenge, previewDay) : null;

  return (
    <div className="px-4 py-4 space-y-4 max-w-3xl mx-auto lg:px-6">
        {/* دکمهٔ بازگشت */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-orange-600 transition"
          aria-label="بازگشت به چالش‌ها"
        >
          <ArrowRight className="w-4 h-4" />
          همهٔ چالش‌ها
        </button>

        {/* کاور */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl overflow-hidden shadow-xl"
          style={{ boxShadow: `0 18px 44px -18px ${from}77` }}
        >
          <div className="relative aspect-[16/10] sm:aspect-[16/8] w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={challenge.cover} alt={`کاور چالش ${challenge.title}`} className="absolute inset-0 w-full h-full object-cover" onError={(e) => {
              // v215 — fallback گرادیانی به‌جای ۴۰۴
              const img = e.currentTarget;
              if (img.dataset.fallback === "1") return;
              img.dataset.fallback = "1";
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/></svg>`;
              img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
            }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.05) 20%, ${to}CC 75%, ${to} 100%)` }} />
          </div>
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-lg">{challenge.emoji}</span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white bg-white/15 border border-white/20 backdrop-blur-sm">
                {challenge.disciplineLabel}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-emerald-800 bg-emerald-300/90">
                رایگان
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-black text-white leading-snug">{challenge.title}</h1>
            <p className="text-[11px] sm:text-xs text-white/80 mt-1">{challenge.tagline}</p>
          </div>
        </motion.section>

        {/* متا چیپ‌ها */}
        <section className="grid grid-cols-4 gap-2" aria-label="مشخصات چالش">
          {[
            { icon: CalendarDays, label: "مدت", value: `${toPersianDigits(challenge.durationDays)} روز` },
            { icon: Dumbbell, label: "هفته", value: `${toPersianDigits(challenge.daysPerWeek)} روز` },
            { icon: Clock, label: "هر جلسه", value: `${toPersianDigits(challenge.minutesPerDay)} دقیقه` },
            { icon: Flame, label: "سطح", value: CH_DIFFICULTY_LABELS[challenge.difficulty] },
          ].map((m) => (
            <div key={m.label} className="rounded-2xl bg-white border border-orange-100 p-2.5 text-center shadow-sm">
              <m.icon className="w-4 h-4 mx-auto mb-1" style={{ color: from }} />
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
              <p className="text-xs font-black text-slate-800">{m.value}</p>
            </div>
          ))}
        </section>

        {/* پیشرفت */}
        {progressEntry && (
          <section className="rounded-2xl bg-white border border-orange-100 p-4 shadow-sm" aria-label="پیشرفت تو">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                <Target className="w-4 h-4" style={{ color: from }} />
                پیشرفت تو
              </h3>
              <span className="text-xs font-black" style={{ color: from }}>
                {toPersianDigits(doneDays.length)} از {toPersianDigits(challenge.durationDays)} روز
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${challengePercent(progressEntry, challenge)}%`, background: `linear-gradient(90deg, ${from}, ${to})` }}
              />
            </div>
            {completedAll && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-black">
                <Medal className="w-4 h-4" />
                این چالش را کامل فتح کردی! قهرمانِ واقعی 💪
              </div>
            )}
            {/* v189 — ریست چالش (دیرکتیو مالک: برای کسی که شروع کرده و می‌خواهد از اول شروع کند) */}
            <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
              {resetArmed ? (
                <>
                  <span className="text-[10.5px] font-bold text-amber-700">همهٔ روزهای ثبت‌شدهٔ این چالش پاک می‌شود. مطمئنی؟</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={resetting}
                      onClick={handleReset}
                      className="h-8 rounded-lg text-[11px] font-black px-3"
                    >
                      {resetting ? "…" : "بله، ریست کن"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resetting}
                      onClick={() => setResetArmed(false)}
                      className="h-8 rounded-lg text-[11px] font-bold px-3"
                    >
                      انصراف
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-[10px] text-slate-400">می‌خواهی از اول شروع کنی؟</span>
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 active:scale-95 transition"
                    aria-label="ریست چالش و شروع از اول"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    شروع از اول (ریست)
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* v188 — توضیحات غنی و اختصاصی چالش */}
        <section className="space-y-3" aria-label="توضیحات چالش">
          {/* دربارهٔ این چالش — متن اختصاصی دیتا */}
          <div className="rounded-2xl bg-gradient-to-br from-orange-50/70 to-amber-50/50 border border-orange-100 p-4">
            <h3 className="font-black text-sm text-slate-900 mb-1.5 flex items-center gap-1.5">
              <Trophy className="w-4 h-4" style={{ color: from }} />
              دربارهٔ این چالش
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">{challenge.description}</p>
          </div>

          {/* چرا این چالش؟ — روایت اختصاصی v188 */}
          <div
            className="relative overflow-hidden rounded-2xl p-4 text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
          >
            <div className="absolute -top-8 -left-8 w-28 h-28 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
            <h3 className="font-black text-sm mb-1.5 flex items-center gap-1.5 relative">
              <Flame className="w-4 h-4" />
              چرا این چالش؟
            </h3>
            <p className="text-xs leading-relaxed text-white/95 relative">{rich.why}</p>
          </div>

          {/* چه چیزی دستت می‌آید — ۴ نتیجهٔ ملموس */}
          <div className="rounded-2xl bg-white border border-orange-100 p-4 shadow-sm">
            <h3 className="font-black text-sm text-slate-900 mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" style={{ color: from }} />
              چه چیزی دستت می‌آید؟
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rich.gains.map((g) => (
                <div key={g} className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: `${from}1A` }}>
                    <Check className="w-3 h-3" strokeWidth={3.5} style={{ color: from }} />
                  </span>
                  <span className="text-[11px] font-bold text-slate-700 leading-snug">{g}</span>
                </div>
              ))}
            </div>
          </div>

          {/* مناسب توست اگر… */}
          <div className="rounded-2xl bg-amber-50/80 border border-amber-100 p-4">
            <h3 className="font-black text-sm text-slate-900 mb-1.5 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-amber-600" />
              مناسب توست اگر…
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">{rich.whoFor}</p>
            <p className="text-[10px] text-slate-500 mt-2.5 pt-2.5 border-t border-amber-200/60 flex items-center gap-1.5">
              <Dumbbell className="w-3.5 h-3.5 shrink-0" />
              تجهیزات لازم: {challenge.equipment}
            </p>
          </div>
        </section>

        {/* دکمهٔ شروع/ادامه */}
        <div className="flex gap-2">
          <Button
            className="flex-1 h-12 rounded-2xl text-sm font-black text-white shadow-lg hover:brightness-110 active:scale-[0.98] transition"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
            onClick={startOrContinue}
          >
            <Play className="w-5 h-5 fill-current" />
            {doneDays.length === 0 ? "شروع چالش" : completedAll ? "از روز ۱ شروع کن" : `ادامه از روز ${toPersianDigits(nextDay)}`}
          </Button>
        </div>

        {/* برنامهٔ روزانه — الگوی ثابت جنسیتی */}
        <section className="rounded-3xl bg-white border border-orange-100 p-4 shadow-sm" aria-label="برنامهٔ روزانه چالش">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-black text-sm text-slate-900 flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4" style={{ color: from }} />
              برنامهٔ روزانه ({toPersianDigits(challenge.durationDays)} روز)
            </h3>
            <span className="text-[9px] font-bold text-slate-400">الگوی ثابت {challenge.gender === "men" ? "آقایان" : "خانم‌ها"}</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
            روی هر روز بزن تا حرکاتش را ببینی — هر روز با یک تپ شروع می‌شود!
          </p>
          <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
            {Array.from({ length: challenge.durationDays }, (_, i) => i + 1).map((d) => {
              const isDone = doneDays.includes(d);
              const isNext = d === nextDay && !completedAll;
              const isPreview = previewDay === d;
              return (
                <motion.button
                  key={d}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setPreviewDay(isPreview ? null : d)}
                  aria-label={`روز ${toPersianDigits(d)}${isDone ? " — تکمیل شده" : ""}`}
                  aria-pressed={isPreview}
                  className={`relative aspect-square rounded-2xl flex flex-col items-center justify-center text-[11px] font-black transition border-2 ${
                    isDone
                      ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-500/25"
                      : isNext
                        ? "border-orange-400 bg-orange-50 text-orange-600 ring-2 ring-orange-300/50 animate-pulse"
                        : isPreview
                          ? "text-white border-transparent shadow-md"
                          : "bg-slate-50 border-slate-100 text-slate-500 hover:border-orange-200 hover:text-orange-500"
                  }`}
                  style={isPreview && !isDone ? { background: `linear-gradient(135deg, ${from}, ${to})` } : undefined}
                >
                  {isDone && <Check className="w-3.5 h-3.5 absolute top-1" strokeWidth={4} />}
                  <span className={isDone ? "mt-1.5" : ""}>{toPersianDigits(d)}</span>
                  {isNext && !isDone && <Play className="w-2.5 h-2.5 absolute bottom-1 fill-current" />}
                </motion.button>
              );
            })}
          </div>

          {/* پیش‌نمایش روز */}
          <AnimatePresence>
            {previewBuilt && (
              <motion.div
                key={previewBuilt.dayNumber}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="mt-3 rounded-2xl border-2 p-3.5" style={{ borderColor: `${from}55`, background: `${from}0A` }}>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 truncate">
                        روز {toPersianDigits(previewBuilt.dayNumber)} — {previewBuilt.templateTitle}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {previewBuilt.focus} • حدود {toPersianDigits(previewBuilt.estimatedMinutes)} دقیقه • هفتهٔ {toPersianDigits(previewBuilt.week)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="rounded-xl text-white text-xs font-black shrink-0 shadow"
                      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                      onClick={() => launchDay(previewBuilt.dayNumber)}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      شروع این روز
                    </Button>
                  </div>
                  <ul className="space-y-1.5">
                    {previewBuilt.exercises.map((ex) => (
                      <li key={ex.id} className="flex items-center gap-2 text-xs bg-white/80 rounded-xl px-2.5 py-2 border border-orange-100/60">
                        <span className="w-5 h-5 rounded-lg flex items-center justify-center text-[9px] font-black text-white shrink-0" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
                          {toPersianDigits(previewBuilt.exercises.indexOf(ex) + 1)}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-bold text-slate-700">{ex.name.split(" (")[0]}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {toPersianDigits(ex.sets.length)} × {ex.sets[0]?.reps?.endsWith("s") ? `${toPersianDigits(parseInt(ex.sets[0].reps))} ثانیه` : ex.sets[0]?.reps}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-slate-400 mt-2.5 flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    پیشرفت هفتگی خودکار: از هفتهٔ سوم، تکرارها و زمان‌ها به‌تدریج سخت‌تر می‌شوند
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* CTA برنامهٔ شخصی */}
        <ChallengeCtaBlock variant="full" seed={challenge.durationDays} />

        <p className="text-center text-[10px] text-muted-foreground pb-2">
          برنامهٔ روزانهٔ این چالش برای همهٔ {challenge.gender === "men" ? "آقایان" : "خانم‌ها"} یکسان است و رایگان اجرا می‌شود —
          برنامهٔ اختصاصی بدن خودت را می‌توانی از پلن‌های فیتاپ بسازی.
        </p>
      </div>
  );
}
