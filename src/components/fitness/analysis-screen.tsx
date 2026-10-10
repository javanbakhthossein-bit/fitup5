"use client";

// ─────────────────────────────────────────────────────────────────────────────
// صفحهٔ تحلیل آنبوردینگ — v132 (دیریکتیو مالک)
//
// تغییرات v132:
//  ① بخش ماکروها خیلی کوچک‌تر و بهینه‌تر شد (چیپ کالری + کارت‌های فشرده —
//     بدون حلقه‌های SVG)
//  ② جدول «مسیر پیشرفت ۴۵ روزه» زیر ماکروها — برنامه اول/دوم/… تا هدف،
//     با دادهٔ واقعی آنبوردینگ (progress-path.ts + progress-path-table.tsx)
//  ③ ویترین «پلن پیشنهادی اختصاصی تو» بعد از نمونهٔ برنامه و قبل از ۴ کارت —
//     با دلایل شخصی‌سازی‌شده و CTA درگاه پرداخت (recommended-plan-spotlight.tsx)
//     قیف فروش جدید: تمرکز روی استاندارد ۸۰۰K و پیشرفته ۱.۲M (دیرکتیو مالک)
// کارت‌های ۴ پلن (v68) دست‌نخورده‌اند؛ کارت «مسیر رسیدن به وزن هدف» با جدول ادغام شد.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Dumbbell, Sparkles, ChevronRight, TrendingUp, Target,
  Activity, Crown, RefreshCw, Flame, Beef, Wheat, Droplet,
  Scale, Ruler, Heart, Bot, CalendarDays,
  Zap, ShieldCheck, Infinity as InfinityIcon, Star,
  ChevronDown, CheckCircle2, ListChecks, Trophy,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import {
  clearAnalysisPhase,
  forgetOpenPurchasePlan,
  peekOpenPurchasePlan,
  rememberOpenPurchasePlan,
} from "@/lib/fitness/analysis-phase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  toPersianDigits,
  formatToman,
  type Plan,
  type Goal,
  type SubscriptionPlan,
  type OnboardingData,
  // v198 — گسترش صریح امکانات پلن (به‌جای «تمام امکانات پلن قبلی»)
  expandPlanFeatures,
  orderPlanHighlights,
} from "@/lib/fitness/types";
import { usePlans } from "@/lib/fitness/use-plans";
import { PurchaseModal } from "@/components/fitness/landing/sections/purchase-modal";
import { ProgressPathTable } from "@/components/fitness/progress-path-table";
import { RecommendedPlanSpotlight } from "@/components/fitness/recommended-plan-spotlight";
import { ComparisonTable } from "@/components/fitness/plan-card-shared";
import { buildProgressPath, type ProgressPath } from "@/lib/fitness/progress-path";
import { toast } from "sonner";
// v198 — رویدادگذاری قیف فروش (دیرکتیو مالک)
import { trackFunnelEvent } from "@/lib/analytics/track-client";

// ─────────────────────────────────────────────────────────────────────────────
// Types returned by /api/onboarding/analysis
// ─────────────────────────────────────────────────────────────────────────────
interface MacroRec {
  targetCalories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  proteinPerKg: number;
  deficitPercent: number;
}

interface Trajectory {
  currentWeight: number;
  targetWeight: number;
  weeksToGoal: number;
  weeklyRate: number;
  weeklyCalorieAdjustment: number;
}

interface PlanRec {
  recommendedPlan: Plan;
  reason: string;
  /** v132 — دلایل خط‌به‌خط برای لیست «چرا این پلن برای توست؟» */
  reasons?: string[];
}

interface Measurements {
  chest?: number;
  arm?: number;
  waist?: number;
  hip?: number;
  thigh?: number;
  neck?: number;
}

interface BodyCompositionData {
  bodyFatPercent: number;
  leanBodyMass: number;
  fatMass: number;
  bodyFatCategory: string;
  bodyFatColor: string;
  muscleMassPercent: number | null;
  muscleMass: number | null;
}

interface AnalysisResponse {
  analysis: string;
  bmi: number;
  bmr: number;
  tdee: number;
  macros?: MacroRec;
  trajectory?: Trajectory | null;
  planRecommendation?: PlanRec;
  measurements?: Measurements;
  bodyComposition?: BodyCompositionData | null;
  fromCache?: boolean;
  /** v132 — فیلدهای آنبوردینگ برای ساخت مسیر پیشرفت در کلاینت */
  profile?: {
    weight: number;
    targetWeight?: number | null;
    goal: Goal;
    workoutDays?: number;
    workoutPlace?: string;
    discipline?: string | null;
    dietType?: string;
    injuries?: string | null;
    diseases?: string | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// هویت بصری هر پلن — v68 بازطراحی وسواسی (دیریکتیو مالک)
//
// مشکلات گزارش‌شده روی نسخهٔ v66: ① دکمه‌های «انتخاب و خرید» در یک ردیف
// نبودند ② کارت‌ها کم‌ارتفاع بودند ③ برچسب «محبوب‌ترین/کامل‌ترین» (absolute
// گوشهٔ کارت) روی کلمهٔ «پیشرفته/حرفه‌ای» می‌افتاد.
//
// راه‌حل ساختاری:
//  • برچسب هر پلن به یک «ردیف ثابت» در بالای کارت رفت — ارتفاع یکسان روی هر
//    ۴ کارت ⇒ دیگر هیچ برچسبی روی نام پلن نمی‌افتد و ردیف‌ها هم‌تراز می‌مانند
//  • بلوک قیمت + دکمهٔ CTA با mt-auto به کف کارت چسبیده ⇒ هر ۴ دکمه دقیقاً
//    در یک ردیف (در ۲×۲ موبایل و ۴ستونهٔ دسکتاپ)
//  • headline داخل کادر ملایم با min-height دوخطی ⇒ متن‌ها هم‌تراز
//  • padding عمودی بیشتر + خط‌چین جداکنندهٔ قیمت ⇒ کارت بلندتر و نفس‌دار
// ─────────────────────────────────────────────────────────────────────────────
const PLAN_VISUALS: Record<
  Plan,
  {
    accent: string; // رنگ اصلی پلن (قیمت/آیکون‌چیپ/متن headline)
    iconBg: string; // پس‌زمینهٔ چیپ آیکون
    tint: string; // پس‌زمینهٔ کادر headline
    border: string; // حاشیهٔ کارت
    headline: string; // تفاوت اصلی — یک جملهٔ فروشی
    chip: string; // برچسب ردیف بالای کارت (همیشه در جریان — ضد تداخل)
    chipIcon?: React.ReactNode; // آیکون کوچک داخل برچسب
    chipStyle: React.CSSProperties; // استایل برچسب
  }
> = {
  basic: {
    accent: "#64748b",
    iconBg: "linear-gradient(135deg, #f8fafc, #e2e8f0)",
    tint: "#f8fafc",
    border: "#e2e8f0",
    headline: "برنامهٔ تمرین و تغذیهٔ اختصاصی بر اساس تحلیل بدن شما",
    chip: "شروع هوشمند",
    chipStyle: {
      background: "#f8fafc",
      color: "#64748b",
      border: "1px solid #e2e8f0",
    },
  },
  standard: {
    accent: "#d97706",
    iconBg: "linear-gradient(135deg, #fef3c7, #fde68a)",
    tint: "#fffbeb",
    border: "#fde68a",
    headline: "مکمل اختصاصی، چکاپ دوره‌ای و داشبورد پیشرفته",
    chip: "بهترین ارزش",
    chipStyle: {
      background: "#fffbeb",
      color: "#b45309",
      border: "1px solid #fde68a",
    },
  },
  advanced: {
    accent: "#ea580c",
    iconBg: "linear-gradient(135deg, #ffedd5, #fed7aa)",
    tint: "#fff7ed",
    border: "#fed7aa",
    headline: "چت نامحدود با فیتاپ، حالت باشگاه و تحلیل عکس غذا و بدن",
    chip: "محبوب‌ترین",
    chipIcon: <Star className="w-2.5 h-2.5 fill-current" />,
    chipStyle: {
      background: "linear-gradient(135deg, #f59e0b, #f97316)",
      color: "#ffffff",
      boxShadow: "0 4px 12px -4px rgba(249, 115, 22, 0.5)",
    },
  },
  ultimate: {
    accent: "#b45309",
    iconBg: "linear-gradient(135deg, #fef9c3, #fde68a)",
    tint: "#fefce8",
    border: "#e9b949",
    headline: "آنالیز ویدیویی بدن، اصلاح تکنیک حرکات و تحلیل آزمایش خون",
    chip: "کامل‌ترین",
    chipIcon: <Crown className="w-2.5 h-2.5" />,
    chipStyle: {
      background: "linear-gradient(135deg, #1c1917, #292524)",
      color: "#e9b949",
      border: "1px solid rgba(217, 164, 65, 0.55)",
      boxShadow: "0 4px 12px -4px rgba(120, 84, 12, 0.45)",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// v132 — MacroStat — چیپ فشردهٔ درشت‌مغذی (جانشین حلقه‌های SVG MacroRing)
// دیرکتیو مالک: «بخش ماکروها خیلی کوچک‌تر و بهینه‌تر شود» — کالری هدف به یک
// چیپ در سربرگ رفت و هر درشت‌مغذی یک کارت کوچک یک‌خطی شد (بدون SVG و انیمیشن
// سنگین) — کل سکشن از ~۳۵۰px به ~۱۳۰px رسید.
// ─────────────────────────────────────────────────────────────────────────────
function MacroStat({
  label,
  grams,
  calories,
  color,
  icon,
}: {
  label: string;
  grams: number;
  calories: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border px-2 py-2 text-center"
      style={{ borderColor: color + "40", background: color + "0d" }}
    >
      <div className="flex items-center justify-center gap-1 mb-0.5" style={{ color }}>
        {icon}
        <span className="text-[9.5px] font-black">{label}</span>
      </div>
      <p className="text-base sm:text-lg font-black font-stat text-slate-900 leading-none">
        {toPersianDigits(grams)}
        <span className="text-[9px] text-slate-400 font-bold"> گرم</span>
      </p>
      <p className="text-[8.5px] sm:text-[9px] text-slate-400 mt-0.5">
        {toPersianDigits(calories)} کیلوکالری
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Measurement chip
// ─────────────────────────────────────────────────────────────────────────────
function MeasurementChip({ label, value, unit = "سانتی‌متر" }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-2xl border-2 border-orange-100 bg-white p-3 text-center">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-black font-stat text-slate-900 leading-none">
        {toPersianDigits(value)}
      </p>
      <p className="text-[9px] text-slate-400 mt-0.5">{unit}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// v145 — کارت «سایر پلن‌ها» — با همان حالتِ کارتِ پلن پیشنهادی (دیرکتیو مالک):
// قاب گرادیانی طلایی + فهرست کامل موارد پلن با دکمهٔ «همه موارد» — کاربر از
// روی هر کارت دقیقاً می‌داند چه می‌خرد. کارت‌های کوچک قبلی (PlanMiniCard) حذف شدند.
// v199 — memo + callback پایدار: رندر مجدد صفحه (باز/بستن مدال خرید و…) دیگر
// کارت‌ها را دوباره رندر نمی‌کند — صفحهٔ تحلیل روان‌تر و کم‌مصرف‌تر.
// ─────────────────────────────────────────────────────────────────────────────
const OtherPlanCard = memo(function OtherPlanCard({
  plan,
  index,
  onBuy,
  discountPercent = 0,
}: {
  plan: SubscriptionPlan;
  index: number;
  /** v199 — باز کردن مدال خرید برای این پلن (callback پایدار والد) */
  onBuy: (planId: Plan) => void;
  /** v198 — درصد تخفیف صفحهٔ تحلیل (نمایش قیمت تخفیف‌خورده) */
  discountPercent?: number;
}) {
  const v = PLAN_VISUALS[plan.id];
  const [showAll, setShowAll] = useState(false);

  // v198 (دیرکتیو مالک): ① امکانات «صریح» گسترش می‌شوند — دیگر متن تنبلِ
  // «تمام امکانات پلن قبلی» نیست؛ تک‌تک موارد نوشته می‌شود ② ۵ مورد اول با
  // چیدمان قوی‌ترین‌ها دیده می‌شود ③ بقیه با «همه موارد» باز می‌شوند.
  // v199 — بازوبستن نرم: آیتم‌های اضافی هرگز unmount نمی‌شوند؛ با گذار
  // grid-template-rows (0fr↔1fr) باز/بسته می‌شوند — بدون لگ و پرش هنگام بستن.
  const VISIBLE_FEATURES = 5;
  const features = orderPlanHighlights(expandPlanFeatures(plan));
  const firstFeatures = features.slice(0, VISIBLE_FEATURES);
  const extraFeatures = features.slice(VISIBLE_FEATURES);
  // قیمت تخفیف‌خورده — نمایشی؛ مبلغ نهایی همیشه در checkout سرور قطعی می‌شود
  const discountedPrice =
    discountPercent > 0
      ? Math.max(0, Math.round((plan.price * (100 - discountPercent)) / 100))
      : plan.price;
  const hasDiscount = discountPercent > 0 && discountedPrice < plan.price;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + index * 0.07, type: "spring", stiffness: 130, damping: 17 }}
      className="relative h-full"
    >
      {/* قاب گرادیانی طلایی — همان زبان بصری Spotlight */}
      <div
        className="relative h-full rounded-[1.6rem] p-[2px] shadow-lg shadow-orange-600/15 transition-transform duration-300 hover:-translate-y-1"
        style={{ background: "linear-gradient(120deg, #fbbf24, #f97316, #fbbf24)" }}
      >
        <div
          className="relative h-full rounded-[calc(1.6rem-2px)] overflow-hidden bg-white flex flex-col"
          aria-label={`پلن ${plan.label}`}
        >
          {/* نوار هدر رنگی پلن */}
          <div className="relative px-4 pt-3.5 pb-3" style={{ background: v.tint }}>
            <div className="pointer-events-none absolute -top-8 -left-8 w-24 h-24 rounded-full bg-orange-200/30 blur-2xl" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span
                  className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full leading-none mb-1.5"
                  style={v.chipStyle}
                >
                  {v.chipIcon}
                  {plan.badge ?? v.chip}
                </span>
                <p className="font-black text-[15px] sm:text-base text-slate-900 leading-tight flex items-center gap-1.5">
                  <span aria-hidden="true">{plan.icon}</span>
                  پلن {plan.label}
                </p>
                <p className="text-[9.5px] sm:text-[10.5px] text-slate-500 leading-snug mt-0.5">{plan.tagline}</p>
              </div>
              <div
                className="text-center rounded-xl px-2.5 py-1.5 shrink-0"
                style={{ background: "rgba(255,255,255,0.75)", border: `1px solid ${v.border}` }}
              >
                {/* v198 — قیمت تخفیف‌خوردهٔ صفحهٔ تحلیل: قیمت قبلی خط‌خورده + قیمت جدید */}
                {hasDiscount && (
                  <p className="text-[9px] text-slate-400 font-bold font-stat leading-none line-through decoration-rose-400/70">
                    {toPersianDigits(formatToman(plan.price))}
                  </p>
                )}
                <p className="text-sm sm:text-base font-black font-stat leading-none whitespace-nowrap mt-0.5" style={{ color: v.accent }}>
                  {toPersianDigits(formatToman(discountedPrice))}
                </p>
                <p className="text-[8px] text-slate-400 mt-0.5 font-bold">
                  {hasDiscount ? (
                    <span className="text-rose-500">تومان · {toPersianDigits(discountPercent)}٪ تخفیف</span>
                  ) : (
                    "تومان"
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* فهرست کامل موارد پلن + دکمهٔ «همه موارد» — همان الگوی Spotlight */}
          <div className="px-4 pt-3 flex-1">
            <p className="flex items-center gap-1.5 text-[9.5px] sm:text-[10.5px] font-black text-slate-500 mb-1.5">
              <ListChecks className="w-3.5 h-3.5" style={{ color: v.accent }} />
              با این پلن می‌گیرید:
            </p>
            <ul className="space-y-1.5">
              {firstFeatures.map((f, i) => (
                <li
                  key={`${f}-${i}`}
                  className="flex items-start gap-1.5 text-[10.5px] sm:text-[11px] font-bold text-slate-700 leading-snug"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-[1px]" style={{ color: v.accent }} />
                  <span className="min-w-0">{f}</span>
                </li>
              ))}
            </ul>
            {/* v199 — بازوبستن نرم «همه موارد»: گذار grid-template-rows (0fr↔1fr)
                — هر دو جهت کاملاً روان و بدون لگ؛ در مرورگرهای قدیمی snap تمیز */}
            {extraFeatures.length > 0 && (
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ gridTemplateRows: showAll ? "1fr" : "0fr" }}
                aria-hidden={!showAll}
              >
                <div className="overflow-hidden min-h-0">
                  <ul className="space-y-1.5 pt-1.5" inert={!showAll}>
                    {extraFeatures.map((f, i) => (
                      <li
                        key={`${f}-${i + VISIBLE_FEATURES}`}
                        className="flex items-start gap-1.5 text-[10.5px] sm:text-[11px] font-bold text-slate-700 leading-snug"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-[1px]" style={{ color: v.accent }} />
                        <span className="min-w-0">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {extraFeatures.length > 0 && (
              <button
                onClick={() => setShowAll((val) => !val)}
                aria-expanded={showAll}
                className="mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[9.5px] sm:text-[10.5px] font-black transition hover:brightness-105"
                style={{ background: v.tint, color: v.accent, border: `1px solid ${v.border}` }}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showAll ? "rotate-180" : ""}`} />
                {showAll ? "بستن فهرست" : `همه موارد (${toPersianDigits(features.length)} مورد)`}
              </button>
            )}
          </div>

          {/* ردیف قیمت/دوره + CTA — چسبیده به کف کارت */}
          <div className="px-4 pb-4 pt-3 mt-auto">
            <div className="border-t border-dashed border-slate-200 pt-2.5 flex items-center justify-between gap-1.5 mb-2.5">
              <span
                className="text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded-md"
                style={{ background: v.iconBg, color: v.accent }}
              >
                پکیج {toPersianDigits(plan.durationDays)} روزه
              </span>
              {plan.popular && (
                <span className="text-[9px] font-black text-orange-500">★ محبوب‌ترین انتخاب</span>
              )}
            </div>
            <button
              onClick={() => onBuy(plan.id)}
              className="w-full h-11 rounded-xl font-black text-[11.5px] sm:text-[12.5px] flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02] active:scale-[0.98] text-white shadow-lg shadow-orange-600/25"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              aria-label={`خرید پلن ${plan.label}`}
            >
              <Zap className="w-4 h-4" />
              انتخاب و خرید
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// صفحه انتظار جذاب و اختصاصی برای تحلیل هوشمند
// ─────────────────────────────────────────────────────────────────────────────
function AnalysisLoadingScreen({ userName }: { userName?: string | null }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: Scale, text: "تحلیل وزن و ترکیب بدن" },
    { icon: Target, text: "بررسی هدف و سطح فعالیت" },
    { icon: Activity, text: "محاسبه کالری و درشت‌مغذی‌ها" },
    { icon: Dumbbell, text: "طراحی برنامه تمرینی اختصاصی" },
    { icon: Sparkles, text: "تولید تحلیل هوشمند فیتاپ" },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => Math.min(s + 1, steps.length - 1));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-amber-50 flex flex-col items-center justify-center px-6">
      {/* لوگو با انیمیشن */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="mb-8"
      >
        <div
          className="w-24 h-24 rounded-3xl flex items-center justify-center overflow-hidden shadow-2xl"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" width={80} height={80} className="object-cover" style={{ width: 80, height: 80 }} />
          </motion.div>
        </div>
      </motion.div>

      {/* نام کاربر + پیام */}
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-xl font-black text-slate-900 mb-2 text-center"
      >
        {userName ? `${userName} عزیز` : "ورزشکار گرامی"}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-sm text-slate-500 mb-10 text-center max-w-xs"
      >
        فیتاپ هوشمند در حال تحلیل اطلاعات شما و طراحی برنامه اختصاصی شماست
      </motion.p>

      {/* مراحل تحلیل */}
      <div className="w-full max-w-sm space-y-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isDone = i < step;
          const isActive = i === step;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.15 }}
              className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${
                isActive
                  ? "bg-white shadow-lg border-2 border-orange-200"
                  : isDone
                  ? "bg-emerald-50 border border-emerald-100"
                  : "bg-white/50 border border-slate-100"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isDone
                    ? "bg-emerald-500"
                    : isActive
                    ? "bg-gradient-to-br from-amber-500 to-orange-500"
                    : "bg-slate-100"
                }`}
              >
                {isDone ? (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <Sparkles className="w-5 h-5 text-white" />
                  </motion.div>
                ) : (
                  <Icon className={`w-5 h-5 ${isActive ? "text-white" : "text-slate-400"}`} />
                )}
              </div>
              <span
                className={`text-sm font-medium transition-colors ${
                  isDone ? "text-emerald-700" : isActive ? "text-slate-900" : "text-slate-400"
                }`}
              >
                {s.text}
              </span>
              {isActive && (
                <motion.div
                  className="mr-auto"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <RefreshCw className="w-4 h-4 text-orange-500" />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* نوار پیشرفت */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="w-full max-w-xs mt-8"
      >
        <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #f59e0b, #f97316)" }}
            animate={{ width: `${((step + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <p className="text-[11px] text-slate-400 text-center mt-2">
          لطفاً صبر کنید — برای جلوگیری از اختلال در تحلیل، از این صفحه خارج نشوید
        </p>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
// v197 — بازطراحی طبق دیرکتیو مالک: «گزینهٔ سی رو دوست داشتم ولی تحلیل انالیز
// بدن کاربر وجود نداشت … میتونی اول تحلیل انالیز کاربر رو بذاری و بعد همین قسمت»
// ساختار دو بخشی با تم واقعی سایت (نارنجی/طلایی):
//   بخش ۱ — تحلیل و آنالیز بدن کاربر (تحلیل هوشمند + شاخص‌ها + ترکیب بدن +
//           اندازه‌ها + ماکروها + مسیر پیشرفت + نمونهٔ برنامه)
//   بخش ۲ — پلن‌های مخصوص تو (بنر تخفیف ۱۰٪ + ویترین پلن‌ها + مقایسه)
// بدون A/B — فقط همین یک طرح.
// ─────────────────────────────────────────────────────────────────────────────

/** v197 — سرصفحهٔ بخش‌ها با تم واقعی سایت */
function AnalysisSectionHeader({
  badge,
  title,
  highlight,
  icon,
}: {
  badge: string;
  title: string;
  highlight: string;
  icon: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="relative text-center pt-2 pb-1 mb-4 overflow-hidden rounded-[1.75rem]"
      style={{ background: "linear-gradient(150deg, #fffbeb 0%, #ffedd5 55%, #fee2cf22 100%)", border: "1px solid #fed7aa" }}
      aria-label={`${badge} — ${title} ${highlight}`}
    >
      <div className="pointer-events-none absolute -top-8 -right-8 w-28 h-28 rounded-full bg-orange-200/40 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-8 w-28 h-28 rounded-full bg-amber-200/40 blur-2xl" />
      <div className="relative px-4 py-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl mb-1.5 shadow-md shadow-orange-500/25" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
          {icon}
        </div>
        <p className="text-[10px] font-black text-orange-600 tracking-wide mb-0.5">{badge}</p>
        <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-snug">
          {title}{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #f59e0b, #f97316)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {highlight}
          </span>
        </h2>
      </div>
    </motion.div>
  );
}

/** v197 — بنر تخفیف ۱۰٪ صفحهٔ تحلیل — دقیقاً با متن دیرکتیو مالک + شمارش معکوس.
 *  توکن سمت سرور با خروج از صفحه باطل می‌شود؛ اینجا فقط نمایش وضعیت زنده است.
 *  v229 — کلیک‌پذیر شد (دیرکتیو مالک): کلیک/Enter → اسکرول نرم به کارت پلن پیشنهادی */
function AnalysisDiscountBanner({
  expiresAt,
  onGoToPlans,
}: {
  expiresAt: number;
  onGoToPlans?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remainMs = expiresAt - now;
  if (remainMs <= 0) return null;
  const mm = Math.floor(remainMs / 60000);
  const ss = Math.floor((remainMs % 60000) / 1000);
  const clock = `${toPersianDigits(String(mm).padStart(2, "0"))}:${toPersianDigits(String(ss).padStart(2, "0"))}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="animate-fade-in rounded-2xl p-[2px] shadow-lg shadow-orange-500/20 cursor-pointer select-none"
      style={{ background: "linear-gradient(120deg, #fbbf24, #f97316, #fbbf24)" }}
      role="button"
      tabIndex={0}
      aria-label="از خرید در همین صفحه ده درصد تخفیف بگیرید — مشاهدهٔ پلن پیشنهادی"
      title="مشاهدهٔ پلن پیشنهادی"
      onClick={() => onGoToPlans?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onGoToPlans?.();
        }
      }}
    >
      <div className="relative rounded-[calc(1rem-2px)] bg-white px-4 py-3 flex items-center justify-between gap-2 overflow-hidden">
        {/* شاین ظریف — همان زبان بصری CTA سایت */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-50"
          style={{
            background: "linear-gradient(110deg, transparent 30%, rgba(249,115,22,0.12) 50%, transparent 70%)",
            backgroundSize: "200% 100%",
            animation: "gold-shimmer 3.2s infinite linear",
          }}
        />
        <div className="relative flex items-center gap-2.5 min-w-0">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-md shadow-orange-500/25"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Sparkles className="w-4.5 h-4.5 text-white" />
          </span>
          <p className="text-[12.5px] sm:text-sm font-black text-slate-900 leading-snug">
            از خرید در همین صفحه{" "}
            <span className="text-orange-600">ده درصد تخفیف بگیرید</span>
          </p>
        </div>
        <span
          className="relative shrink-0 text-[10px] sm:text-[11px] font-black font-stat text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1"
          title="این تخفیف فقط تا خروج از همین صفحه معتبر است"
        >
          ⏳ {clock}
        </span>
      </div>
    </motion.div>
  );
}

export function AnalysisScreen() {
  // v229 — subscription انتخابی (الگوی main-app v55): قبلاً کل store subscribe
  // می‌شد و هر setState پنل، کل صفحهٔ تحلیل را re-render می‌کرد (جانک گوشی ضعیف).
  const user = useAppStore((s) => s.user);
  const setScreen = useAppStore((s) => s.setScreen);
  const setMainTab = useAppStore((s) => s.setMainTab);
  const pendingPlanId = useAppStore((s) => s.pendingPlanId);
  const setPendingPlanId = useAppStore((s) => s.setPendingPlanId);
  const { plans: SUBSCRIPTION_PLANS } = usePlans();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purchasePlanId, setPurchasePlanId] = useState<Plan | null>(null);

  // ═══ v198 — رویداد: مشاهدهٔ صفحهٔ تحلیل آنبوردینگ (مرحلهٔ پیش از خرید) ═══
  const analysisViewedTrackedRef = useRef(false);
  useEffect(() => {
    if (analysisViewedTrackedRef.current) return;
    analysisViewedTrackedRef.current = true;
    trackFunnelEvent("analysis_screen_viewed", { force: true });
  }, []);

  // ═══ v197 — تخفیف ۱۰٪ صفحهٔ تحلیل (دیرکتیو مالک) ═══
  // «از خرید در همین صفحه ده درصد تخفیف بگیرید» — برای همه؛ با خروج از صفحه
  // فوراً غیرفعال می‌شود (sendBeacon revoke + unmount revoke) و توکن TTL ۳۰
  // دقیقه‌ای هم گارد دوم است. مبلغ واقعی ۱۰۰٪ سمت سرور (checkout) اعمال می‌شود.
  //
  // ═══ v200 — دو فیکس ریشه‌ای (باگ گزارش مالک: «تخفیف در درگاه اعمال نشد») ═══
  // ① grant دیگر هنگام باز شدن «صفحهٔ انتظار» نیست — دقیقاً وقتی تحلیل آماده
  //    شد و کاربر صفحهٔ تحلیل را دید grant می‌شود ⇒ ۳۰ دقیقهٔ کامل مال کاربر
  //    است، نه اینکه بخشی‌اش در انتظارِ تحلیل بسوزد.
  // ② مسابقهٔ revoke-grant ریشه‌کنی شد: مرورگر درون‌اپی اینستاگرام موقع
  //    reload، beacon ابطالِ صفحهٔ قبلی را «دیر» می‌فرستد؛ اگر grant صفحهٔ
  //    جدید زودتر برسد، ابطالِ دیرهنگامِ «همه‌توکن‌ها» توکن تازه را هم می‌کشت
  //    (UI تخفیف نشان می‌داد، سرور مبلغ کامل می‌گرفت). حالا revoke فقط
  //    «توکنِ خودِ این صفحه» را می‌فرستد و سرور فقط همان را باطل می‌کند.
  const [analysisDiscount, setAnalysisDiscount] = useState<{
    token: string;
    percent: number;
    expiresAt: number;
  } | null>(null);
  // ref توکنِ زندهٔ این نمونه — revoke باید در لحظهٔ فراخوانی توکن همین صفحه
  // را بفرستد (حتی اگر pagehide/unmount بعد از grant صفحهٔ جدید اجرا شود)
  const analysisDiscountRef = useRef<{ token: string } | null>(null);

  // ابطال تخفیف — پایدار و مستقل از رندر (فقط توکنِ خودِ این صفحه)
  const revokeAnalysisDiscount = useCallback((useBeacon: boolean) => {
    try {
      const currentToken = analysisDiscountRef.current?.token ?? "";
      const payload = JSON.stringify({ action: "revoke", token: currentToken });
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/onboarding/analysis-discount",
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch("/api/onboarding/analysis-discount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {}
  }, []);

  // grant — یک‌بار، وقتی تحلیل واقعاً آماده شد (صفحهٔ انتظار توکن نمی‌گیرد)
  const analysisGrantDoneRef = useRef(false);
  useEffect(() => {
    if (!user?.id || !data || analysisGrantDoneRef.current) return;
    analysisGrantDoneRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/onboarding/analysis-discount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "grant" }),
        });
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.ok && json.token) {
          const d = {
            token: String(json.token),
            percent: json.percent ?? 10,
            expiresAt: new Date(json.expiresAt).getTime(),
          };
          analysisDiscountRef.current = d;
          setAnalysisDiscount(d);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, data]);

  // خروج از صفحهٔ تحلیل = غیرفعال شدن تخفیف (دیرکتیو صریح مالک) —
  // mount-scoped: pagehide → beacon ابطال توکنِ جاری، unmount → fetch ابطال
  useEffect(() => {
    const onPageHide = () => revokeAnalysisDiscount(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      revokeAnalysisDiscount(false);
    };
  }, [revokeAnalysisDiscount]);

  // ═══ v199 — انقضای زندهٔ تخفیف صفحهٔ تحلیل (دیرکتیو مالک) ═══
  // «به محض اینکه زمان تخفیف تموم شد قیمت‌های خط خورده هم تبدیل بشن به قیمت‌های واقعی»
  // — به‌جای خواندن Date.now() در زمانِ رندر (که فقط با رندر بعدی به‌روز می‌شد)،
  // یک تایمر دقیقاً روی لحظهٔ انقضا فعال می‌شود و درصد فعال صفر می‌شود ⇒ همهٔ
  // کارت‌ها همان لحظه قیمت واقعی را نشان می‌دهند و خط‌خورده‌ها محو می‌شوند.
  const [discountExpired, setDiscountExpired] = useState(false);
  useEffect(() => {
    setDiscountExpired(false);
    if (!analysisDiscount) return;
    const ms = analysisDiscount.expiresAt - Date.now();
    if (ms <= 0) {
      setDiscountExpired(true);
      return;
    }
    const t = setTimeout(() => setDiscountExpired(true), ms + 250);
    return () => clearTimeout(t);
  }, [analysisDiscount]);
  const activeDiscountPercent =
    analysisDiscount && !discountExpired ? analysisDiscount.percent : 0;

  // ═══ v199 — دکمهٔ بک گوشی/مرورگر (دیرکتیو مالک) ═══
  // ① صفحهٔ انتظار تحلیل: بک «قفل» است — کاربر تا رسیدن به صفحهٔ تحلیل می‌ماند
  //    («نباید دکمه بک کار بکنه و باید کاربر مجاب بمونه تا اون صفحه تموم بشه»).
  // ② صفحهٔ تحلیل: بک → پنل کاربری (داشبورد)، «نه به صفحهٔ اصلی سایت».
  // ③ اگر مدال خرید باز باشد، بک فقط مدال را می‌بندد (رفتار استاندارد مودال).
  //    (دیرکتیو: «آیکون بک هدر که به صفحهٔ اصلی می‌رفت هم کلاً حذف شد».)
  const analysisAnchorPushedRef = useRef(false);
  useEffect(() => {
    if (!analysisAnchorPushedRef.current) {
      analysisAnchorPushedRef.current = true;
      try {
        window.history.pushState({ fitupAnalysis: 1 }, "");
      } catch {}
    }
    const onPopState = (e: PopStateEvent) => {
      // v199 — این رویداد فقط باید منطق بک صفحهٔ تحلیل را اجرا کند؛ روتر Next
      // که لیسنر خودش را روی window دارد نباید موازی واکنش نشان دهد (رقابت
      // رفرش/ناوبری موازی می‌سازد). جریان بک کاملاً SPA-محور مدیریت می‌شود.
      e.stopImmediatePropagation();
      if (loading || !data) {
        // فاز انتظار تحلیل — بک قفل است
        try {
          window.history.pushState({ fitupAnalysisLock: 1 }, "");
        } catch {}
        toast.info("تحلیل شما در حال آماده‌سازی است — چند لحظه صبر کنید");
        return;
      }
      if (purchasePlanId) {
        // مدال خرید باز است — بک = بستن مدال (نه ترک صفحه)
        handlePurchaseClose();
        try {
          window.history.pushState({ fitupAnalysis: 1 }, "");
        } catch {}
        return;
      }
      // بک روی صفحهٔ تحلیل → پنل کاربری (نه صفحهٔ اصلی سایت)
      clearAnalysisPhase();
      setMainTab("dashboard");
      setScreen("main");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loading, data, purchasePlanId]);

  // ═══ v164 — بازیابی فاز تحلیل بعد از هر رفرش/سوییچ VPN (دیرکتیو مالک) ═══
  // ① self-heal: اگر کاربر از قبل اشتراک active/pending دارد، دیگر جای او اینجا
  //   نیست — فلگ فاز پاک و به داشبورد می‌رویم (بعد از خرید موفق هم همین‌طور).
  // ② مدال خرید باز بود → دقیقاً همان مدال با همان پلن دوباره باز می‌شود.
  useEffect(() => {
    if (user?.hasActiveSubscription || user?.hasPendingSubscription) {
      clearAnalysisPhase();
      setMainTab("dashboard");
      setScreen("main");
    }
  }, [user?.hasActiveSubscription, user?.hasPendingSubscription]);

  useEffect(() => {
    // فقط وقتی خودمان مستقیماً به تحلیل آمدیم (نه بعد از خرید) مدال باز برگردد
    if (user?.hasActiveSubscription || user?.hasPendingSubscription) return;
    const savedPlanId = peekOpenPurchasePlan();
    if (!savedPlanId) return;
    setPurchasePlanId(savedPlanId as Plan);
  }, []);

  // ═══ 101-c — دیرکتیو مالک ═══
  // شمارندهٔ زندهٔ ثبت‌نام‌کنندگان (نزدیک CTA/خرید) — fetch بعد از mount،
  //   بدون بلوک رندر؛ در حالت خطا هیچ چیزی نشن نمی‌دهد (بی‌صدا).
  //   (v198: نقش دوم قبلی این fetch — دادهٔ برنامهٔ نمونه — حذف شد؛ دادهٔ
  //   آنبوردینگ فقط برای «مسیر پیشرفت» خوانده می‌شود.)
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [profileData, setProfileData] = useState<OnboardingData | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/stats/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.ok) return;
        const n = Number(j.users);
        if (Number.isFinite(n) && n > 0) setUsersCount(n);
      })
      .catch(() => {
        /* بی‌صدا — دیرکتیو: در حالت خطا هیچ چیزی نشن نمی‌دهد */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/onboarding/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.ok || !j?.profile) return;
        const p = j.profile;
        // فقط فیلدهایی که سازندهٔ برنامهٔ نمونه لازم دارد — مقادیر نامعتبر فال‌بک می‌خورند
        setProfileData({
          firstName: typeof p.firstName === "string" ? p.firstName : undefined,
          gender: p.gender,
          age: p.age,
          height: p.height,
          weight: p.weight,
          targetWeight: p.targetWeight ?? undefined,
          goal: p.goal,
          activityLevel: p.activityLevel,
          workoutDays: p.workoutDays ?? 3,
          workoutPlace: p.workoutPlace,
          equipment: Array.isArray(p.equipment) ? p.equipment : [],
          diseases: p.diseases ?? "",
          injuries: p.injuries ?? "",
          allergies: p.allergies ?? "",
          dietType: p.dietType,
          trainingExperience: p.trainingExperience ?? undefined,
          discipline: p.discipline ?? undefined,
        } as OnboardingData);
      })
      .catch(() => {
        /* بی‌صدا — با خطا، فال‌بک تمپلیت عمومی می‌ماند */
      });
    return () => {
      alive = false;
    };
  }, []);

  // v198 — برنامهٔ نمونه حذف شد (دیرکتیو مالک) — اینجا فقط مسیر پیشرفت و پلن‌ها

  // ═══ v132 — دیرکتیو مالک ═══
  // ① جدول «مسیر پیشرفت ۴۵ روزه» — از trajectory + دادهٔ آنبوردینگ خود کاربر
  //   (قطعی و محلی — بدون هزینهٔ AI). اگر کاربر وزن هدف داشته باشد، تعداد
  //   برنامه‌ها = ceil(هفته‌های لازم × ۷ ÷ ۴۵) و جدول با «رسیدن به هدف» تمام می‌شود.
  // ② پلن پیشنهادی اختصاصی — از planRecommendation پاسخ API (قیف فروش جدید:
  //   تمرکز روی استاندارد ۸۰۰K / پیشرفته ۱.۲M). فال‌بک محلی هم دارد.
  const progressPath: ProgressPath | null = useMemo(() => {
    const prof = profileData;
    const p = data?.profile;
    const goal = (prof?.goal ?? p?.goal) as Goal | undefined;
    const currentWeight = prof?.weight ?? p?.weight;
    if (!goal || !currentWeight) return null;
    return buildProgressPath({
      goal,
      currentWeight,
      targetWeight: prof?.targetWeight ?? p?.targetWeight ?? null,
      weeklyRate: data?.trajectory?.weeklyRate ?? null,
      weeksToGoal: data?.trajectory?.weeksToGoal ?? null,
      weeklyCalorieAdjustment: data?.trajectory?.weeklyCalorieAdjustment ?? null,
      workoutDays: prof?.workoutDays ?? p?.workoutDays ?? null,
      workoutPlace: prof?.workoutPlace ?? p?.workoutPlace ?? null,
      discipline: prof?.discipline ?? p?.discipline ?? null,
      dietType: prof?.dietType ?? p?.dietType ?? null,
      hasInjuries: !!(prof?.injuries ?? p?.injuries),
      hasDiseases: !!(prof?.diseases ?? p?.diseases),
    });
  }, [profileData, data]);

  const planRec = data?.planRecommendation ?? null;
  const recommendedPlanId: Plan = planRec?.recommendedPlan ?? "advanced";
  const recommendedPlan: SubscriptionPlan | null =
    SUBSCRIPTION_PLANS.find((pl) => pl.id === recommendedPlanId) ?? null;
  // v199 — ردیف «دلایل» از کارت پلن پیشنهادی حذف شد (دیرکتیو مالک: فقط امکانات پلن)

  // v145 — دیرکتیو مالک: زیر پلن پیشنهادی، «سایر پلن‌ها» با همان حالت کارت
  // نمایش داده می‌شوند — پلنِ پیشنهادی از این فهرست حذف است (بالای صفحه است).
  const otherPlans: SubscriptionPlan[] = SUBSCRIPTION_PLANS.filter(
    (pl) => pl.id !== recommendedPlanId
  );

  // v15: تاریخ عضویت در فیتاپ — از فیلد memberSince پاسخ API (user.createdAt)
  const memberSinceText = (() => {
    const since = (data as any)?.memberSince as string | null | undefined;
    if (!since) return null;
    try {
      return new Date(since).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran",  year: "numeric", month: "long", day: "numeric" });
    } catch {
      return null;
    }
  })();

  // ═══ v63 — ضد باگ «تحلیل شما پیدا نشد» در مرورگر درون‌برنامه‌ای اینستاگرام ═══
  // ریشه: تولید تحلیل همگام داخل GET است (چند ثانیه تا چند دقیقه) و WebView
  // اینستا fetchهای طولانی را قطع می‌کند؛ قبلاً فقط «یک» fetch بی‌retry بود و
  // هر قطع‌شدن مستقیم به کارت خطا می‌رفت — کاربر باید چند بار دستی «تلاش مجدد»
  // می‌زد تا یکی از دورهای تولید کامل می‌شد.
  // حالا: timeout ۲۵ثانیه‌ای هر تلاش + auto-retry با مکث (تا ۱۰ دور ≈ چند
  // دقیقه صبر) — سمت سرور هم همهٔ درخواست‌های هم‌زمان به «یک» تولید در-جریان
  // می‌پیوندند (قفل مشترک) پس هر retry هزینهٔ AI اضافه ندارد و به‌محض
  // آماده‌شدن تحلیل، همان لحظه نمایش داده می‌شود — بدون هیچ لمسی.
  const ANALYSIS_MAX_ATTEMPTS = 10;
  const ANALYSIS_ATTEMPT_TIMEOUT_MS = 25_000;

  async function fetchAnalysisOnce(url: string): Promise<{ ok: boolean; permanentFail: boolean; json: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANALYSIS_ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.analysis) return { ok: true, permanentFail: false, json };
      // خطاهای دائمی — retry بی‌فایده است (پروفایل نبود / سشن نیست)
      if (res.status === 400 || res.status === 401) {
        return { ok: false, permanentFail: true, json };
      }
      return { ok: false, permanentFail: false, json };
    } catch {
      // abort / network — قابل‌retry
      return { ok: false, permanentFail: false, json: null };
    } finally {
      clearTimeout(timer);
    }
  }

  // v229 + ممیزی ۱۹-b#۱ — رویداد «دیدن نتیجه» فقط برای مونتِ زنده ثبت می‌شود
  // (late-retry بعد از unmount / self-heal / StrictMode دیده‌نشده را ثبت نکند)
  const loadAliveRef = useRef(true);

  async function loadAnalysis(force = false) {
    if (force) setRefreshing(true);
    try {
      const url = force ? "/api/onboarding/analysis?force=1" : "/api/onboarding/analysis";
      for (let attempt = 1; attempt <= ANALYSIS_MAX_ATTEMPTS; attempt++) {
        const { ok, permanentFail, json } = await fetchAnalysisOnce(url);
        if (ok) {
          setData(json as AnalysisResponse);
          // v229 — رویداد: نتیجهٔ تحلیل واقعاً دیده شد. قبلاً فقط analysis_screen_viewed
          // روی mount شلیک می‌شد و ریزشِ انتظارِ AI (۶۰-۱۲۰ثانیه) با ریزشِ محتوا قاطی بود.
          if (loadAliveRef.current) trackFunnelEvent("analysis_ready_viewed", { force: true });
          return;
        }
        if (!loadAliveRef.current) return; // unmount → حلقهٔ retry رها شود
        if (permanentFail) break;
        // مکث بین تلاش‌ها (backoff ملایم) — در طول retryها صفحهٔ «در حال تحلیل»
        // جذاب نشان داده می‌شود، نه کارت خطا
        if (attempt < ANALYSIS_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, attempt <= 4 ? 2_500 : 6_000));
        }
      }
      if (force) toast.error("خطا در بازخوانی تحلیل");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAliveRef.current = true;
    loadAnalysis();
    return () => {
      loadAliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the pending plan object (if user came from landing)
  const pendingPlan = pendingPlanId
    ? SUBSCRIPTION_PLANS.find((p) => p.id === pendingPlanId) ?? null
    : null;

  const bmi = data?.bmi ?? 0;
  const bmiCategory = bmi < 18.5 ? "کم‌وزن" : bmi < 25 ? "وزن نرمال" : bmi < 30 ? "اضافه‌وزن" : "چاق";
  const bmiColor = bmi < 18.5 ? "text-cyan-500" : bmi < 25 ? "text-emerald-500" : bmi < 30 ? "text-amber-500" : "text-red-500";

  // v199 — باز کردن مدال خرید: callback پایدار (memo کارت‌ها را مؤثر می‌کند)
  const buyPlan = useCallback(
    (planId: Plan) => {
      setPurchasePlanId(planId);
      // v164 — ثبت مدال باز: بعد از رفرش/سوییچ VPN دقیقاً همین مدال باز می‌شود
      rememberOpenPurchasePlan(planId);
    },
    []
  );

  // v199 — CTA پایدار کارت پلن پیشنهادی (memo Spotlight)
  const buyRecommended = useCallback(
    () => buyPlan(recommendedPlanId),
    [buyPlan, recommendedPlanId]
  );

  // ═══ v229 — نوار خرید چسبان پایین صفحهٔ تحلیل (دیرکتیو مالک) ═══
  // صفحهٔ تحلیل چندبرابرِ ارتفاع صفحه است؛ CTA/قیمت/تخفیف فقط در تهِ صفحه بود و
  // کاربرِ موبایلی بعد از خواندن تحلیل هیچ لمسِ خریدی در دید نداشت (بک = خروج).
  // پلن نوار: پلن انتخابی از لندینگ (اگر هست) وگرنه پلن پیشنهادی تحلیل.
  const stickyPlan = pendingPlan ?? recommendedPlan;
  const stickyPrice = stickyPlan
    ? activeDiscountPercent > 0
      ? Math.max(0, Math.round((stickyPlan.price * (100 - activeDiscountPercent)) / 100))
      : stickyPlan.price
    : 0;
  const buySticky = useCallback(() => {
    if (pendingPlan) buyPlan(pendingPlan.id);
    else buyRecommended();
  }, [pendingPlan, buyPlan, buyRecommended]);

  const handlePurchaseClose = useCallback(() => {
    setPurchasePlanId(null);
    // v164 — مدال بسته شد → کلید بازیابی مدال پاک (فلگ صفحهٔ تحلیل می‌ماند)
    forgetOpenPurchasePlan();
    // Clear pendingPlanId once the user has gone through the purchase flow
    setPendingPlanId(null);
  }, [setPendingPlanId]);

  if (loading && !data) {
    return <AnalysisLoadingScreen userName={user?.name} />;
  }

  // ─── FE-M4: گارد حالت خالی/خطا ───
  // قبلاً اگر fetch fail می‌شد یا analysis وجود نداشت، data=null ولی رندر
  // ادامه می‌یافت و BMI=0 به‌عنوان «کم‌وزن» با توصیه‌های غلط نمایش داده می‌شد.
  if (!data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(245,158,11,0.12)" }}
        >
          <Activity className="w-8 h-8 text-orange-500" />
        </div>
        <h2 className="text-lg font-black text-slate-900 mb-2">تحلیلی برای نمایش وجود ندارد</h2>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed max-w-xs">
          تحلیل شما پیدا نشد یا در دریافت آن خطایی رخ داد. لطفاً دوباره تلاش کنید.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setLoading(true);
              loadAnalysis();
            }}
          >
            <RefreshCw className="w-4 h-4" />
            تلاش مجدد
          </Button>
          <Button
            className="rounded-xl text-white"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            onClick={() => {
              // v164 — خروج از فاز تحلیل (فلگ پاک) و بازگشت به داشبورد — تا
              // کاربر در حلقهٔ «رفرش → تحلیلِ بدون داده» گیر نکند
              clearAnalysisPhase();
              setMainTab("dashboard");
              setScreen("main");
            }}
          >
            بازگشت
          </Button>
        </div>
      </div>
    );
  }

  return (
    /* v160 — فیکس ریشه‌ای اسکرول صفحهٔ تحلیل (گزارش مالک از اپ اندروید):
       قبلاً «overflow-y-auto» روی این wrapper باعث می‌شد overflow-x هم به auto
       محاسبه شود (قواعد CSS) و دایره‌های تزئینی با آفست منفی (-right-24 /
       -left-28) حدود ۱۱۲px سرریز افقی بسازند — نتیجه: در RTL اسکرول الکی به
       چپ + قفل‌شدن ژست عمودی لمس در پن افقی گودال خالی (اسکرول به پایین «خراب»).
       فیکس: overflow-x-clip — برش افقی بدون ساختن کانتینر اسکرول (sticky و
       اسکرول پنجره دست‌نخورده می‌مانند) + گارد جهانی html/body در globals.css.
       v229 — pb معادلِ ارتفاع نوار چسبان خرید: در پایین‌ترین نقطهٔ اسکرول هیچ
       محتوایی زیر نوار پنهان نمی‌ماند (دیرکتیو صریح مالک). */
    <div className="min-h-screen bg-white relative overflow-x-clip">
      {/* ─── پس‌زمینهٔ تزئینی هنری (v64) ─── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-orange-50 via-amber-50/50 to-transparent" />
      <div className="pointer-events-none absolute -top-20 -right-24 w-72 h-72 rounded-full bg-orange-100/30 blur-3xl" />
      <div className="pointer-events-none absolute top-64 -left-28 w-80 h-80 rounded-full bg-amber-100/25 blur-3xl" />

      {/* Header — v199: دیرکتیو مالک: آیکون بک هدر (که به صفحهٔ اصلی سایت می‌رفت)
          کلاً حذف شد؛ بک گوشی/مرورگر هم به پنل کاربری می‌رود نه صفحهٔ اصلی */}
      <div className="sticky top-0 z-10 bg-white/85 backdrop-blur-lg border-b border-orange-100/80 px-4 py-3 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden shadow-sm" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="font-black text-slate-900">فیتاپ</span>
        </div>
      </div>

      <div className="relative max-w-2xl mx-auto px-4 py-6 space-y-5 pb-[calc(96px+env(safe-area-inset-bottom))]">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 180, damping: 14 }}
            className="w-16 h-16 rounded-[1.4rem] flex items-center justify-center mx-auto mb-4 shadow-xl shadow-orange-500/25"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">
            تحلیل اختصاصی شما
          </h1>
          <p className="text-sm text-slate-500">
            {user?.name ? `${user.name} عزیز، ` : ""}فیتاپ هوشمند اطلاعات شما را تحلیل کرد
          </p>
          {/* v15: تاریخ عضویت در فیتاپ (درخواست مالک — آنبوردینگ باید کامل باشد) */}
          {memberSinceText && (
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-200 text-[11px] text-orange-700 font-bold">
              <CalendarDays className="w-3.5 h-3.5" />
              عضو فیتاپ از {memberSinceText}
            </div>
          )}
        </motion.div>

        {/* ═══ v198 — بنر «اسکرول به پایین» حذف شد (دیرکتیو مالک) — صفحه خودش
            روایت خطی دارد: تحلیل بدن → کارت‌های پلن، بدون دعوت‌نامهٔ اسکرول ═══ */}

        {/* ═══ v197 — بخش ۱: تحلیل و آنالیز بدن کاربر (دیرکتیو مالک) ═══ */}
        <AnalysisSectionHeader
          badge="گام ۱ — تحلیل و آنالیز بدن"
          title="بدن تو را دقیق"
          highlight="تحلیل کردیم"
          icon={<Activity className="w-5 h-5 text-white" aria-hidden />}
        />

        {/* تحلیل فیتاپ هوشمند (مربی) — در اول صفحه */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Card className="p-5 border-2 border-orange-200 relative overflow-hidden shadow-lg shadow-orange-500/5">
            {/* Background gradient */}
            <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-orange-100/40 blur-2xl" />
            <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-amber-100/40 blur-2xl" />

            <div className="relative">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">تحلیل فیتاپ هوشمند</h3>
                  <p className="text-[10px] text-slate-500">مربی هوشمند شما</p>
                </div>
              </div>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-3 bg-orange-100 rounded animate-pulse" style={{ width: `${90 - i * 10}%` }} />
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-gradient-to-br from-orange-50/50 to-amber-50/30 border border-orange-100/50">
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{data?.analysis}</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* Biometric cards — v135 (دیرکتیو مالک): کارت‌های BMI/BMR/TDEE کوچک و
            فشرده شدند — اعداد کوچک‌تر و کوتاه، padding کمتر؛ شکل یک ردیف جمع‌وجور */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-2"
        >
          <Card className="px-2 py-2.5 text-center border border-orange-100 shadow-sm">
            <p className="text-[9px] text-slate-500 mb-0.5">شاخص BMI</p>
            <p className={`text-base font-black font-stat leading-none ${bmiColor}`}>{toPersianDigits(bmi.toFixed(1))}</p>
            <p className={`text-[9px] font-bold mt-1 ${bmiColor}`}>{bmiCategory}</p>
          </Card>
          <Card className="px-2 py-2.5 text-center border border-orange-100 shadow-sm">
            <p className="text-[9px] text-slate-500 mb-0.5">متابولیسم (BMR)</p>
            <p className="text-base font-black font-stat text-slate-900 leading-none">{toPersianDigits(data?.bmr ?? 0)}</p>
            <p className="text-[9px] text-slate-400 mt-1">کیلوکالری</p>
          </Card>
          <Card className="px-2 py-2.5 text-center border border-orange-100 shadow-sm">
            <p className="text-[9px] text-slate-500 mb-0.5">کالری روزانه (TDEE)</p>
            <p className="text-base font-black font-stat text-slate-900 leading-none">{toPersianDigits(data?.tdee ?? 0)}</p>
            <p className="text-[9px] text-slate-400 mt-1">کیلوکالری</p>
          </Card>
        </motion.div>

        {/* ═══ v132 — دیرکتیو مالک: بخش ماکروها «خیلی کوچک‌تر و بهینه‌تر» شد.
            کالری هدف به چیپ سربرگ رفت؛ سه درشت‌مغذی کارت‌های فشردهٔ یک‌خطی شدند
            (حلقه‌های SVG حذف) — کل سکشن ~۱۳۰px به‌جای ~۳۵۰px. ═══ */}
        {data?.macros && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 }}
          >
            <Card className="p-3.5 border-2 border-orange-100 shadow-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                    <Flame className="w-3.5 h-3.5 text-white" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-[13px] sm:text-sm">کالری و درشت‌مغذی پیشنهادی</h3>
                </div>
                <div
                  className="inline-flex items-baseline gap-1.5 rounded-xl px-3 py-1.5"
                  style={{ background: "linear-gradient(135deg, #fff7ed, #fffbeb)", border: "1px solid #fed7aa" }}
                >
                  <span className="text-[9px] text-slate-400 font-bold">کالری هدف</span>
                  <span className="text-lg font-black font-stat text-orange-600 leading-none">
                    {toPersianDigits(formatToman(data.macros.targetCalories))}
                  </span>
                  <span className="text-[8.5px] text-slate-400 font-bold">کیلوکالری/روز</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MacroStat label="پروتئین" grams={data.macros.protein_g} calories={data.macros.protein_g * 4} color="#f97316" icon={<Beef className="w-3 h-3" />} />
                <MacroStat label="کربوهیدرات" grams={data.macros.carbs_g} calories={data.macros.carbs_g * 4} color="#f59e0b" icon={<Wheat className="w-3 h-3" />} />
                <MacroStat label="چربی" grams={data.macros.fat_g} calories={data.macros.fat_g * 9} color="#d97706" icon={<Droplet className="w-3 h-3" />} />
              </div>
            </Card>
          </motion.div>
        )}

        {/* ═══ v132 — دیرکتیو مالک: جدول «مسیر پیشرفت ۴۵ روزه» — در زیر ماکروها.
            «برنامهٔ اول این اتفاق‌ها، برنامهٔ دوم این اتفاق‌ها…» تا هر تعداد لازم —
            با دادهٔ واقعی آنبوردینگ (هدف/وزن/روزهای تمرین/رشته/رژیم/آسیب) و
            trajectory رسمی اپ. کارت قبلی «مسیر رسیدن به وزن هدف» با همین جدول
            ادغام شد (وزن فعلی→هدف، هفته‌ها، نرخ هفتگی همه در جمع‌بندی جدول هستند). ═══ */}
        {progressPath && <ProgressPathTable path={progressPath} />}

        {/* Body measurements card */}
        {data?.measurements && Object.keys(data.measurements).length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="p-5 border-2 border-orange-100 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Ruler className="w-4 h-4 text-white" />
                </div>
                <h3 className="font-bold text-slate-900">اندازه‌های بدن شما</h3>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {data.measurements.chest != null && (
                  <MeasurementChip label="دور سینه" value={data.measurements.chest} />
                )}
                {data.measurements.arm != null && (
                  <MeasurementChip label="دور بازو" value={data.measurements.arm} />
                )}
                {data.measurements.waist != null && (
                  <MeasurementChip label="دور کمر" value={data.measurements.waist} />
                )}
                {data.measurements.hip != null && (
                  <MeasurementChip label="دور باسن" value={data.measurements.hip} />
                )}
                {data.measurements.thigh != null && (
                  <MeasurementChip label="دور ران" value={data.measurements.thigh} />
                )}
                {data.measurements.neck != null && (
                  <MeasurementChip label="دور گردن" value={data.measurements.neck} />
                )}
              </div>
            </Card>
          </motion.div>
        )}

        {/* Body Composition card */}
        {data?.bodyComposition && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
          >
            <Card className="p-5 border-2 border-orange-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                    <Activity className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="font-bold text-slate-900">ترکیب بدن شما</h3>
                </div>
              </div>

              {/* 3 main stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {/* Body Fat % */}
                <div
                  className="rounded-2xl p-4 text-center border-2"
                  style={{
                    borderColor: data.bodyComposition.bodyFatColor + "60",
                    background: data.bodyComposition.bodyFatColor + "10",
                  }}
                >
                  <p className="text-[10px] text-slate-500 mb-1">درصد چربی بدن</p>
                  <p
                    className="text-3xl font-black font-stat leading-none"
                    style={{ color: data.bodyComposition.bodyFatColor }}
                  >
                    {toPersianDigits(data.bodyComposition.bodyFatPercent.toFixed(1))}
                    <span className="text-base">٪</span>
                  </p>
                  <p
                    className="text-[10px] font-bold mt-1.5"
                    style={{ color: data.bodyComposition.bodyFatColor }}
                  >
                    {data.bodyComposition.bodyFatCategory}
                  </p>
                </div>

                {/* Lean Body Mass */}
                <div className="rounded-2xl p-4 text-center border-2 border-orange-100 bg-white">
                  <p className="text-[10px] text-slate-500 mb-1">جرم بدون چربی</p>
                  <p className="text-3xl font-black font-stat text-slate-900 leading-none">
                    {toPersianDigits(data.bodyComposition.leanBodyMass)}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1.5">کیلوگرم</p>
                </div>

                {/* Fat Mass */}
                <div className="rounded-2xl p-4 text-center border-2 border-orange-100 bg-white">
                  <p className="text-[10px] text-slate-500 mb-1">جرم چربی</p>
                  <p className="text-3xl font-black font-stat text-slate-900 leading-none">
                    {toPersianDigits(data.bodyComposition.fatMass)}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1.5">کیلوگرم</p>
                </div>
              </div>

              {/* Muscle mass (estimated) */}
              {data.bodyComposition.muscleMass != null && (
                <div className="rounded-xl bg-orange-50/50 border border-orange-100 p-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-orange-500" />
                      <span className="text-xs font-bold text-slate-700">درصد عضله تقریبی</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-black font-stat text-orange-600">
                        {toPersianDigits(data.bodyComposition.muscleMassPercent?.toFixed(1) ?? "0")}
                      </span>
                      <span className="text-[10px] text-slate-500">٪</span>
                      <span className="text-[10px] text-slate-400 ml-2">
                        ({toPersianDigits(data.bodyComposition.muscleMass)} کیلوگرم)
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scientific note */}
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  محاسبه بر اساس <b>فرمول علمی US Navy</b> (Hodgdon & Beckett, 1984).
                  این روش با اندازه‌گیری دور کمر، گردن و قد، معتبرترین تخمین بدون‌دستگاه چربی بدن را ارائه می‌دهد.
                </p>
              </div>
            </Card>
          </motion.div>
        )}

        {/* ═══ v197 — بخش ۲: پلن‌های مخصوص تو — اول بنر تخفیف ۱۰٪ (متن دقیق
            دیرکتیو مالک)، بعد نمونهٔ برنامه و ویترین پلن‌ها (طرح C مورد علاقهٔ
            مالک با کارت‌های قاب طلایی) ═══ */}
        {/* ═══ v199 — دیرکتیو مالک: «اونجا که نوشته بر اساس تحلیل بدنت این‌ها را
            برایت ساخته‌ایم بنویس بر اساس تحلیل بدنت این پلن بهترین انتخاب برای
            توست و به جای این پلن نام پلنی که پیشنهاد شده رو بنویس» ═══ */}
        <AnalysisSectionHeader
          badge="گام ۲ — پلن‌های مخصوص تو"
          title="بر اساس تحلیل بدنت،"
          highlight={
            recommendedPlan
              ? `پلن ${recommendedPlan.label} بهترین انتخاب برای توست`
              : "بهترین پلن برای تو انتخاب شده است"
          }
          icon={<Crown className="w-5 h-5 text-white" aria-hidden />}
        />
        {analysisDiscount && (
          <AnalysisDiscountBanner
            expiresAt={analysisDiscount.expiresAt}
            // v229 — کلیک روی بنر → اسکرول نرم به کارت پلن پیشنهادی (بدون شلوغیِ المان تازه)
            onGoToPlans={() => {
              try {
                document.getElementById("plan-spotlight")?.scrollIntoView({ behavior: "smooth", block: "start" });
              } catch {}
            }}
          />
        )}

        {/* ═══ v198 — باکس «نمونهٔ برنامه» حذف شد (دیرکتیو مالک: «برنامه نمونه رو
            هم بردار که خلوت‌تر بشه») — صفحه حالا: تحلیل بدن → کارت‌های پلن ═══ */}

        {/* ═══ v132 — دیرکتیو مالک: ویترین «پلن پیشنهادی اختصاصی تو» — قبل از
            ۴ کارت پلن. یک پلن با دلایل درست و منطقی (از دادهٔ آنبوردینگ کاربر و
            ویژگی‌های واقعی پلن‌ها) پیشنهاد و دعوت به خرید می‌شود؛ CTA همان
            PurchaseModal رسمی اپ (درگاه امن زرین‌پال) را باز می‌کند. زیر کارت هم
            «پلن‌های دیگه هم داریم» با دکمهٔ اسکرول به ویترین ۴ کارت. ═══ */}
        {recommendedPlan && (
          <div id="plan-spotlight" className="scroll-mt-20">
            <RecommendedPlanSpotlight
              plan={recommendedPlan}
              onBuy={buyRecommended}
              userName={user?.name}
              // v198 — قیمت تخفیف‌خوردهٔ صفحهٔ تحلیل (۱۰٪) همان‌جا روی کارت دیده می‌شود
              // v199 — با انقضای تخفیف، زنده و بی‌درنگ به قیمت واقعی برمی‌گردد
              discountPercent={activeDiscountPercent}
            />
          </div>
        )}

        {/* ═══ 101-c — شمارندهٔ زندهٔ ثبت‌نام‌کنندگان (دیرکتیو مالک) —
            برجسته، نزدیک بخش CTA/خرید؛ فقط وقتی دادهٔ واقعی آمده باشد ═══ */}
        {usersCount != null && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26 }}
            className="rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 via-orange-50 to-amber-50 px-4 py-3 shadow-sm shadow-orange-500/5"
            role="status"
          >
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs sm:text-sm font-black text-orange-900 leading-relaxed">
              <span aria-hidden="true" className="text-base">🏆</span>
              <span>
                بیش از {toPersianDigits(usersCount.toLocaleString("en-US").replace(/,/g, "٬"))} ورزشکار برنامهٔ خود را از فیتاپ گرفته‌اند
              </span>
              <Trophy className="w-4 h-4 text-orange-500 shrink-0" aria-hidden="true" />
            </p>
          </motion.div>
        )}

        {/* ═══ v145 — سایر پلن‌ها با همان حالت کارتِ پلن پیشنهادی (دیرکتیو مالک):
            «در زیر پلن پیشنهادی سایر پلن‌ها بذاری و کارت بقیه پلن ها رو با همین
            حالت بسازی و نمایش کارتهای قبلی رو پاک کنی» — کارت‌های کوچک قبلی حذف و
            کارت‌های کامل (فهرست موارد + همه موارد) جایگزین شدند. ═══ */}
        {otherPlans.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            aria-label="سایر پلن‌ها"
            id="plans-vitrine"
            className="relative scroll-mt-16"
          >
            {/* سرصفحهٔ برند-محور */}
            <div className="relative text-center pt-3 pb-2 mb-3 overflow-hidden rounded-[1.75rem]" style={{ background: "linear-gradient(150deg, #fffbeb 0%, #ffedd5 55%, #fee2cf22 100%)", border: "1px solid #fed7aa" }}>
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-orange-200/40 blur-2xl" />
              <div className="absolute -bottom-10 -left-8 w-28 h-28 rounded-full bg-amber-200/40 blur-2xl" />
              <div className="relative px-4 py-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl mb-1.5" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900">
                  سایر پلن‌ها —{" "}
                  <span
                    style={{
                      background: "linear-gradient(135deg, #f59e0b, #f97316)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    انتخاب با توست
                  </span>
                </h2>
                <p className="text-[11px] sm:text-xs text-orange-800/70 mt-1.5 max-w-md mx-auto leading-relaxed">
                  کیفیت برنامهٔ تمرینی و غذایی در همهٔ پلن‌ها یکسان است — تفاوت در عمق امکانات و همراهی فیتاپ در طول مسیر است
                </p>
              </div>
            </div>

            {/* کارت‌های پلن — همان حالت Spotlight (قاب طلایی + فهرست کامل موارد) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 items-stretch pt-1">
              {otherPlans.map((plan, i) => (
                <OtherPlanCard
                  key={plan.id}
                  plan={plan}
                  index={i}
                  onBuy={buyPlan}
                  // v198 — قیمت تخفیف‌خوردهٔ صفحهٔ تحلیل (۱۰٪) روی هر کارت
                  // v199 — با انقضای تخفیف، زنده و بی‌درنگ به قیمت واقعی برمی‌گردد
                  discountPercent={activeDiscountPercent}
                />
              ))}
            </div>

            {/* چیپ‌های اعتماد */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4">
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                پرداخت امن زرین‌پال
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-bold">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                فعال‌سازی آنی پس از خرید
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-bold">
                <InfinityIcon className="w-3.5 h-3.5 text-orange-400" />
                پشتیبانی در تمام مسیر
              </span>
            </div>
          </motion.section>
        )}

        {/* ═══ v145 — دیرکتیو مالک: «در انتهای پلن‌ها هم جدول مقایسه‌ای که در صفحهٔ
            اصلی هست رو بذار و زیرش هم دکمهٔ رفتن به داشبورد» ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative"
        >
          <ComparisonTable />

          {/* v214 — دیرکتیو مالک: بالای «رفتن به داشبورد» متن دعوت به امکانات رایگان */}
          <p className="mt-5 text-center text-sm font-bold text-slate-600 leading-relaxed">
            از طریق داشبوردت می‌تونی از امکانات جذاب و رایگان فیتاپ استفاده کنی
          </p>

          {/* دکمهٔ رفتن به داشبورد — زیر جدول مقایسه */}
          <button
            onClick={() => { clearAnalysisPhase(); setMainTab("dashboard"); setScreen("main"); }}
            className="mt-3 w-full p-5 rounded-2xl border-2 border-slate-200 bg-white text-slate-700 shadow-sm transition hover:scale-[1.01] hover:border-slate-300 flex items-center gap-4"
          >
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
              <TrendingUp className="w-6 h-6 text-slate-500" />
            </div>
            <div className="flex-1 text-right">
              <p className="font-black text-base">رفتن به داشبورد</p>
              <p className="text-xs text-slate-500">از ابزارهای رایگان و امکانات پنل استفاده کنید</p>
            </div>
            <ChevronRight className="w-5 h-5 rotate-180 text-slate-400" />
          </button>
        </motion.div>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="space-y-3 pt-2"
        >
          <p className="text-center text-sm font-bold text-slate-700">مسیر بعدی شما؟</p>

          {/* Pending plan CTA — primary */}
          {pendingPlan && (
            <button
              onClick={() => buyPlan(pendingPlan.id)}
              className="w-full p-5 rounded-2xl text-white shadow-xl shadow-orange-500/30 transition hover:scale-[1.02] flex items-center gap-4"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Crown className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 text-right">
                <p className="font-black text-base">ادامه خرید پلن {pendingPlan.label}</p>
                <p className="text-xs opacity-90">
                  پلنی که انتخاب کردید — {toPersianDigits(formatToman(pendingPlan.price))} تومان
                </p>
              </div>
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
          )}

        </motion.div>
      </div>

      {/* ═══ v229 — نوار خرید چسبان پایین (مینیمال — یک ردیف کم‌ارتفاع تا صفحه اذیت‌کننده نشود؛
          حین باز بودن مدال خرید پنهان می‌شود؛ محتوا با padding معادل ارتفاعش محافظت شده). ═══ */}
      {stickyPlan && !purchasePlanId && (
        <div
          className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur-md border-t border-orange-100 shadow-[0_-6px_20px_rgba(249,115,22,0.10)] px-3 pt-2.5"
          style={{ paddingBottom: "calc(10px + env(safe-area-inset-bottom))" }}
        >
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <div className="flex-1 min-w-0 text-right leading-tight">
              <p className="text-[10.5px] font-bold text-orange-600 truncate">
                {activeDiscountPercent > 0
                  ? `⏳ تخفیف ${toPersianDigits(String(activeDiscountPercent))}٪ همین صفحه فعال است`
                  : "بهترین پلن برای بدن تو"}
              </p>
              <p className="text-[13px] sm:text-sm font-black text-slate-900 truncate">
                پلن {stickyPlan.label} — {toPersianDigits(formatToman(stickyPrice))} تومان
              </p>
            </div>
            <button
              onClick={buySticky}
              className="shrink-0 rounded-xl px-4 py-2.5 text-white text-[13px] font-black shadow-lg shadow-orange-500/30 transition hover:scale-[1.03] active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {activeDiscountPercent > 0 ? "خرید با تخفیف" : "مشاهده و خرید"}
            </button>
          </div>
        </div>
      )}

      {/* Purchase modal — user is already logged in at this point so checkout works */}
      {purchasePlanId && (() => {
        const plan = SUBSCRIPTION_PLANS.find((p) => p.id === purchasePlanId);
        return plan ? (
          <PurchaseModal
            plan={plan}
            onClose={handlePurchaseClose}
            onNeedLogin={() => handlePurchaseClose()}
            // v197 — تخفیف ۱۰٪ صفحهٔ تحلیل (فقط تا وقتی کاربر در صفحه است)
            // v199 — با انقضای تخفیف، مودال هم بی‌درنگ بدون تخفیف می‌شود (هم‌راستا با توکن سرور)
            analysisDiscount={
              activeDiscountPercent > 0 && analysisDiscount
                ? { token: analysisDiscount.token, percent: analysisDiscount.percent }
                : undefined
            }
          />
        ) : null;
      })()}
    </div>
  );
}
