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

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Dumbbell, Sparkles, ChevronRight, TrendingUp, Target,
  Activity, Crown, RefreshCw, Flame, Beef, Wheat, Droplet,
  Scale, Ruler, Heart, Bot, CalendarDays,
  Zap, ShieldCheck, Infinity as InfinityIcon, Star,
  ChevronDown, Salad, Pill, Camera, Video, Trophy,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  toPersianDigits,
  formatToman,
  type Plan,
  type Goal,
  type SubscriptionPlan,
  type OnboardingData,
} from "@/lib/fitness/types";
import { usePlans } from "@/lib/fitness/use-plans";
import {
  SAMPLE_PROGRAM,
  buildSampleProgram,
  type SampleProgram,
} from "@/lib/fitness/sample-program";
import { PurchaseModal } from "@/components/fitness/landing/sections/purchase-modal";
import { ProgressPathTable } from "@/components/fitness/progress-path-table";
import { RecommendedPlanSpotlight } from "@/components/fitness/recommended-plan-spotlight";
import { buildProgressPath, type ProgressPath } from "@/lib/fitness/progress-path";
import { toast } from "sonner";

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
// v68 — کارت پلن صفحهٔ تحلیل — بازطراحی وسواسی (دیریکتیو مالک)
// ساختار هم‌تراز: ردیف برچسب (ارتفاع ثابت) → نام+آیکون → کادر headline
// (min-height دوشن) → بلوک قیمت چسبیده به کف (mt-auto) → دکمهٔ CTA.
// نتیجه: برچسب هرگز روی نام نمی‌افتد، هر ۴ دکمه دقیقاً یک ردیف، کارت بلندتر.
// ─────────────────────────────────────────────────────────────────────────────
function PlanMiniCard({
  plan,
  index,
  onBuy,
}: {
  plan: SubscriptionPlan;
  index: number;
  onBuy: () => void;
}) {
  const v = PLAN_VISUALS[plan.id];
  const isPopular = plan.id === "advanced";
  const isUltimate = plan.id === "ultimate";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.06, type: "spring", stiffness: 130, damping: 17 }}
      className="relative h-full"
    >
      <div
        className={`relative h-full rounded-[1.4rem] bg-white overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
          isPopular ? "ring-2 ring-orange-300/80" : ""
        }`}
        style={{
          border: `1px solid ${isPopular ? "#fdba74" : v.border}`,
          boxShadow: isPopular
            ? "0 14px 30px -14px rgba(249, 115, 22, 0.35)"
            : "0 6px 18px -12px rgba(15, 23, 42, 0.12)",
        }}
      >
        {/* ردیف برچسب — ارتفاع ثابت روی هر ۴ کارت ⇒ برچسب هرگز روی نام نمی‌افتد */}
        <div className="flex items-center justify-center h-8 sm:h-9 pt-2.5 sm:pt-3 shrink-0">
          <span
            className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full leading-none"
            style={v.chipStyle}
          >
            {v.chipIcon}
            {v.chip}
          </span>
        </div>

        {/* نام پلن — v73.2 (درخواست مالک): شکل‌های تزئینی (گل/آتش/…) کنار نام پلن‌ها حذف شد؛ بقیهٔ طراحی دست‌نخورده */}
        <div className="px-3 sm:px-4 mt-2 flex items-center">
          <div className="min-w-0">
            <p className="font-black text-[14px] sm:text-base text-slate-900 leading-tight">
              پلن {plan.label}
            </p>
            <p className="text-[9px] sm:text-[10px] text-slate-400 leading-snug">{plan.tagline}</p>
          </div>
        </div>

        {/* headline — کادر ملایم با min-height دوشن ⇒ متن‌های ۴ کارت هم‌تراز */}
        <div
          className="mx-3 sm:mx-4 mt-2.5 rounded-xl px-2.5 py-2 min-h-[48px] sm:min-h-[52px] flex items-center"
          style={{ background: v.tint }}
        >
          <p className="text-[10px] sm:text-[11px] font-bold leading-snug text-start" style={{ color: v.accent }}>
            {v.headline}
          </p>
        </div>

        {/* بلوک قیمت — با mt-auto به کف کارت چسبیده ⇒ هم‌ترازی کامل کارت‌ها */}
        <div className="mt-auto px-3 sm:px-4 pt-3">
          <div className="border-t border-dashed border-slate-200 pt-2.5 flex flex-wrap items-end justify-between gap-x-1.5 gap-y-1.5">
            <div className="flex items-baseline gap-1">
              <span
                className="text-xl sm:text-2xl font-black font-stat leading-none"
                style={{ color: v.accent }}
              >
                {toPersianDigits(formatToman(plan.price))}
              </span>
              <span className="text-[10px] text-slate-400">تومان</span>
            </div>
            <span
              className="text-[9px] sm:text-[10px] font-black px-2 py-0.5 rounded-md shrink-0 mb-0.5"
              style={{ background: v.iconBg, color: v.accent }}
            >
              پکیج {toPersianDigits(plan.durationDays)} روزه
            </span>
          </div>
        </div>

        {/* CTA — آخرین ردیف همهٔ کارت‌ها ⇒ هر ۴ دکمه در یک ردیف */}
        <div className="px-3 sm:px-4 pb-3.5 sm:pb-4 pt-2.5">
          <button
            onClick={onBuy}
            className={`w-full h-10 sm:h-11 rounded-xl font-black text-[11px] sm:text-[13px] flex items-center justify-center gap-1.5 transition-all hover:scale-[1.03] active:scale-[0.98] ${
              isUltimate ? "text-amber-200" : "text-white"
            }`}
            style={
              isUltimate
                ? {
                    background: "linear-gradient(135deg, #1c1917, #292524)",
                    border: "1.5px solid rgba(217, 164, 65, 0.65)",
                    color: "#e9b949",
                    boxShadow: "0 8px 20px -10px rgba(217, 164, 65, 0.5)",
                  }
                : isPopular
                  ? {
                      background: "linear-gradient(135deg, #f59e0b, #f97316)",
                      boxShadow: "0 10px 22px -10px rgba(249, 115, 22, 0.55)",
                    }
                  : {
                      background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
                      border: `1px solid ${v.border}`,
                      color: v.accent,
                    }
            }
            aria-label={`خرید پلن ${plan.label}`}
          >
            <Zap className="w-3.5 h-3.5" />
            انتخاب و خرید
          </button>
        </div>
      </div>
    </motion.div>
  );
}

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
          لطفاً صبر کنید — این پردازش چند ثانیه طول می‌کشد
        </p>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
export function AnalysisScreen() {
  const { user, setScreen, setMainTab, pendingPlanId, setPendingPlanId } = useAppStore();
  const { plans: SUBSCRIPTION_PLANS } = usePlans();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purchasePlanId, setPurchasePlanId] = useState<Plan | null>(null);

  // ═══ 101-c — دیرکتیو مالک ═══
  // ① شمارندهٔ زندهٔ ثبت‌نام‌کنندگان (نزدیک CTA/خرید) — fetch بعد از mount،
  //   بدون بلوک رندر؛ در حالت خطا هیچ چیزی نشن نمی‌دهد (بی‌صدا).
  // ② برنامهٔ نمونهٔ شخصی‌سازی‌شده — دادهٔ آنبوردینگ همان کاربر از
  //   /api/onboarding/profile خوانده می‌شود و به buildSampleProgram پاس داده
  //   می‌شود؛ تا رسیدن پاسخ، فال‌بک تمپلیت عمومی نمایش داده می‌شود (بدون پرش لایه‌اوت).
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

  // برنامهٔ نمونه: شخصی‌شده با دادهٔ خود کاربر، وگرنه تمپلیت عمومی (رندر اولیه هرگز بلوک نمی‌شود)
  const sampleProgram: SampleProgram = profileData ? buildSampleProgram(profileData) : SAMPLE_PROGRAM;

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
  const spotlightReasons: string[] = planRec?.reasons?.length
    ? planRec.reasons
    : recommendedPlan
      ? recommendedPlan.features.slice(0, 3)
      : [];

  // v15: تاریخ عضویت در فیتاپ — از فیلد memberSince پاسخ API (user.createdAt)
  const memberSinceText = (() => {
    const since = (data as any)?.memberSince as string | null | undefined;
    if (!since) return null;
    try {
      return new Date(since).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
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

  async function loadAnalysis(force = false) {
    if (force) setRefreshing(true);
    try {
      const url = force ? "/api/onboarding/analysis?force=1" : "/api/onboarding/analysis";
      for (let attempt = 1; attempt <= ANALYSIS_MAX_ATTEMPTS; attempt++) {
        const { ok, permanentFail, json } = await fetchAnalysisOnce(url);
        if (ok) {
          setData(json as AnalysisResponse);
          return;
        }
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
    loadAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the pending plan object (if user came from landing)
  const pendingPlan = pendingPlanId
    ? SUBSCRIPTION_PLANS.find((p) => p.id === pendingPlanId) ?? null
    : null;

  const bmi = data?.bmi ?? 0;
  const bmiCategory = bmi < 18.5 ? "کم‌وزن" : bmi < 25 ? "وزن نرمال" : bmi < 30 ? "اضافه‌وزن" : "چاق";
  const bmiColor = bmi < 18.5 ? "text-cyan-500" : bmi < 25 ? "text-emerald-500" : bmi < 30 ? "text-amber-500" : "text-red-500";

  function openPurchase(planId: Plan) {
    setPurchasePlanId(planId);
  }

  function handlePurchaseClose() {
    setPurchasePlanId(null);
    // Clear pendingPlanId once the user has gone through the purchase flow
    setPendingPlanId(null);
  }

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
            onClick={() => setScreen("landing")}
          >
            بازگشت
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white overflow-y-auto relative">
      {/* ─── پس‌زمینهٔ تزئینی هنری (v64) ─── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-orange-50 via-amber-50/50 to-transparent" />
      <div className="pointer-events-none absolute -top-20 -right-24 w-72 h-72 rounded-full bg-orange-100/30 blur-3xl" />
      <div className="pointer-events-none absolute top-64 -left-28 w-80 h-80 rounded-full bg-amber-100/25 blur-3xl" />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/85 backdrop-blur-lg border-b border-orange-100/80 px-4 py-3 flex items-center justify-between">
        <button onClick={() => setScreen("landing")} className="p-2 rounded-lg hover:bg-orange-50 transition" aria-label="بازگشت">
          {/* در RTL جهت بازگشت به راست است */}
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden shadow-sm" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="font-black text-slate-900">فیتاپ</span>
        </div>
        <div className="w-9" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 py-6 space-y-5">
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

        {/* ═══ Task 5-d — تشویق‌کنندهٔ اسکرول: صفحه خیلی طولانی است؛ کاربر باید
            بداند در ادامه چه چیزی منتظرش است. بنر باریک با حاشیهٔ گرادیانی،
            پالس ملایم و نوار پیشرفت ظریف — کلیک = اسکرول نرم تا ویترین پلن. ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="animate-fade-in rounded-2xl p-[1.5px] shadow-md shadow-orange-500/10"
          style={{ background: "linear-gradient(120deg, #fbbf24, #f97316, #fbbf24)" }}
        >
          <motion.button
            type="button"
            aria-label="تا آخر صفحه اسکرول کن — تحلیل کامل، برنامهٔ نمونه و پلن‌های مخصوص تو در ادامه است"
            onClick={() => {
              document.getElementById("plans-vitrine")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            animate={{ scale: [1, 1.008, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="relative w-full bg-white rounded-[calc(1rem-1px)] px-3.5 py-2.5 flex items-center justify-center gap-2 overflow-hidden text-right"
          >
            {/* شاین ظریف روی پس‌زمینه — همان الگوی CtaSection ولی خیلی کم‌رنگ */}
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none opacity-40"
              style={{
                background: "linear-gradient(110deg, transparent 30%, rgba(249,115,22,0.10) 50%, transparent 70%)",
                backgroundSize: "200% 100%",
                animation: "gold-shimmer 3.2s infinite linear",
              }}
            />
            <motion.span
              aria-hidden="true"
              animate={{ y: [0, 3, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <ChevronDown className="w-3.5 h-3.5 text-white" />
            </motion.span>
            <span className="relative text-[11px] sm:text-xs font-black text-slate-700 leading-snug">
              👇 تحلیل کامل، برنامهٔ نمونه و پلن‌های مخصوص تو در ادامه‌ست — تا آخر اسکرول کن
            </span>
            {/* نوار پیشرفت ظریف — نشان می‌دهد هنوز مسیر ادامه دارد */}
            <motion.span
              aria-hidden="true"
              className="absolute bottom-0 right-0 h-[3px] rounded-full"
              style={{ background: "linear-gradient(90deg, #fbbf24, #f97316)" }}
              animate={{ width: ["18%", "72%", "18%"] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.button>
        </motion.div>

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

        {/* ═══ Task 5-c — باکس فشردهٔ «نمونهٔ برنامه» قبل از ویترین پلن‌ها:
            101-c — حالا محتوا با دادهٔ خود کاربر شخصی‌سازی می‌شود (روز اول واقعی
            از برنامهٔ او)؛ بدون هزینهٔ AI — محاسبات محلی ═══ */}
        <SampleProgramCompactBox program={sampleProgram} />

        {/* ═══ v132 — دیرکتیو مالک: ویترین «پلن پیشنهادی اختصاصی تو» — قبل از
            ۴ کارت پلن. یک پلن با دلایل درست و منطقی (از دادهٔ آنبوردینگ کاربر و
            ویژگی‌های واقعی پلن‌ها) پیشنهاد و دعوت به خرید می‌شود؛ CTA همان
            PurchaseModal رسمی اپ (درگاه امن زرین‌پال) را باز می‌کند. زیر کارت هم
            «پلن‌های دیگه هم داریم» با دکمهٔ اسکرول به ویترین ۴ کارت. ═══ */}
        {recommendedPlan && (
          <RecommendedPlanSpotlight
            plan={recommendedPlan}
            reasons={spotlightReasons}
            onBuy={() => openPurchase(recommendedPlan.id)}
            userName={user?.name}
          />
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

        {/* ═══ v132 — ویترین ۴ پلن (در ادامهٔ Spotlight پیشنهاد اختصاصی — دیرکتیو مالک) ═══ */}
        {/* کاربر پلن پیشنهادی خودش را بالاتر دیده؛ اینجا هر ۴ پلن برای مقایسه و
            انتخاب آزاد در دسترس است — کارت‌ها کوچک، شیک و هنرمندانه‌اند. */}
        {SUBSCRIPTION_PLANS.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            aria-label="انتخاب پلن"
            id="plans-vitrine"
            className="relative scroll-mt-16"
          >
            {/* سرصفحهٔ سادهٔ برند-محور (v66: قبلاً سه آیکون تزئینی بود — شلوغ) */}
            <div className="relative text-center pt-3 pb-2 mb-3 overflow-hidden rounded-[1.75rem]" style={{ background: "linear-gradient(150deg, #fffbeb 0%, #ffedd5 55%, #fee2cf22 100%)", border: "1px solid #fed7aa" }}>
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-orange-200/40 blur-2xl" />
              <div className="absolute -bottom-10 -left-8 w-28 h-28 rounded-full bg-amber-200/40 blur-2xl" />
              <div className="relative px-4 py-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl mb-1.5" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900">
                  پلنت رو انتخاب کن،{" "}
                  <span
                    style={{
                      background: "linear-gradient(135deg, #f59e0b, #f97316)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    بقیه‌ش با ما
                  </span>
                </h2>
                <p className="text-[11px] sm:text-xs text-orange-800/70 mt-1.5 max-w-md mx-auto leading-relaxed">
                  هر ۴ پلن شامل برنامهٔ تمرینی و غذایی کاملاً شخصی‌سازی‌شده بر اساس همین تحلیل است —
                  تفاوت در عمق امکانات و همراهی فیتاپ در طول مسیر است
                </p>
              </div>
            </div>

            {/* ۴ کارت پلن — ۲×۲ موبایل / ۴ ستون دسکتاپ */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 items-stretch pt-1">
              {SUBSCRIPTION_PLANS.map((plan, i) => (
                <PlanMiniCard
                  key={plan.id}
                  plan={plan}
                  index={i}
                  onBuy={() => openPurchase(plan.id)}
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

            {/* لینک مقایسهٔ کامل */}
            <button
              onClick={() => { setMainTab("plans"); setScreen("main"); }}
              className="mt-3 w-full py-3 rounded-2xl border-2 border-dashed border-orange-200 bg-white/60 text-orange-600 text-xs font-black flex items-center justify-center gap-1.5 hover:bg-orange-50 hover:border-orange-300 transition"
            >
              <Scale className="w-4 h-4" />
              مقایسهٔ کامل امکانات ۴ پلن
            </button>
          </motion.section>
        )}

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
              onClick={() => openPurchase(pendingPlan.id)}
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

          {/* Go to dashboard */}
          <button
            onClick={() => { setMainTab("dashboard"); setScreen("main"); }}
            className="w-full p-5 rounded-2xl border-2 border-slate-200 bg-white text-slate-700 shadow-sm transition hover:scale-[1.02] hover:border-slate-300 flex items-center gap-4"
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
      </div>

      {/* Purchase modal — user is already logged in at this point so checkout works */}
      {purchasePlanId && (() => {
        const plan = SUBSCRIPTION_PLANS.find((p) => p.id === purchasePlanId);
        return plan ? (
          <PurchaseModal
            plan={plan}
            onClose={handlePurchaseClose}
            onNeedLogin={() => handlePurchaseClose()}
          />
        ) : null;
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 5-c — باکس فشردهٔ «نمونهٔ برنامه» (قبل از ویترین پلن‌ها)
// 101-c — محتوا دیگر ایستا نیست: برنامهٔ نمونه از دادهٔ آنبوردینگ خود کاربر
// ساخته می‌شود (buildSampleProgram) — «روز اول واقعی از برنامهٔ همان کاربر»
// با تیتر شخصی (نام کاربر)، روز/تمرکز متناسب با هدف و رشته، کالری/پروتئین واقعی.
// سه مینی‌تب با ارتفاع کم (حداکثر ~⅓ viewport) تا صفحه طولانی نشود.
// ─────────────────────────────────────────────────────────────────────────────

type SampleTab = "workout" | "nutrition" | "supplements";

const SAMPLE_TABS: { id: SampleTab; label: string; icon: typeof Dumbbell }[] = [
  { id: "workout", label: "تمرین", icon: Dumbbell },
  { id: "nutrition", label: "تغذیه", icon: Salad },
  { id: "supplements", label: "مکمل", icon: Pill },
];

const goldGradientBox = "linear-gradient(135deg, #f59e0b, #f97316)";

function SampleProgramCompactBox({ program }: { program: SampleProgram }) {
  const [tab, setTab] = useState<SampleTab>("workout");
  const isPersonal = !!program.title;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.24 }}
    >
      <Card className="p-4 border-2 border-amber-200 relative overflow-hidden shadow-lg shadow-orange-500/5 rounded-3xl">
        {/* پس‌زمینهٔ تزئینی ملایم */}
        <div className="absolute -top-8 -left-8 w-28 h-28 rounded-full bg-amber-100/50 blur-2xl" />
        <div className="absolute -bottom-8 -right-8 w-28 h-28 rounded-full bg-orange-100/40 blur-2xl" />

        <div className="relative">
          {/* سربرگ فشرده — 101-c: با دادهٔ کاربر، تیتر شخصی‌سازی‌شده می‌شود */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                style={{ background: goldGradientBox }}
              >
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm text-slate-900 leading-snug">
                  {program.title ?? "نمونه‌ای از برنامه‌ای که می‌گیری"}
                </h3>
                <p className="text-[10px] text-slate-500 leading-snug">
                  {isPersonal
                    ? "بر اساس اطلاعات خودت — دقیقاً از برنامهٔ کامل تو"
                    : "خروجی واقعی موتور فیتاپ"}
                </p>
              </div>
            </div>
            {/* مینی‌تب‌ها */}
            <div className="inline-flex p-0.5 rounded-xl bg-amber-50 border border-amber-100 gap-0.5" role="tablist" aria-label="بخش‌های برنامهٔ نمونه">
              {SAMPLE_TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all flex items-center gap-1 ${
                      active ? "text-white shadow-sm" : "text-amber-700/70 hover:text-amber-800"
                    }`}
                    style={active ? { background: goldGradientBox } : undefined}
                  >
                    <t.icon className="w-3 h-3" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* محتوای فشردهٔ تب فعال */}
          <div className="rounded-2xl bg-gradient-to-br from-amber-50/60 to-orange-50/30 border border-amber-100/70 p-3">
            {tab === "workout" && (
              <div className="space-y-1.5">
                {/* 101-c — روز اول واقعی از برنامهٔ کاربر: برچسب روز + تمرکز (متناسب با هدف/رشتهٔ خودش) */}
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-dashed border-amber-200/80">
                  <span className="text-[10px] font-black text-amber-800 truncate">{program.workout.dayLabel}</span>
                  <span className="text-[9px] text-slate-500 truncate">{program.workout.focus}</span>
                </div>
                {program.workout.exercises.slice(0, 3).map((ex, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-md bg-white border border-amber-200 text-amber-700 text-[10px] font-black flex items-center justify-center shrink-0">
                      {toPersianDigits(i + 1)}
                    </span>
                    <span className="font-bold text-slate-800 flex-1 min-w-0 truncate">{ex.name}</span>
                    <span className="text-[10px] font-black text-orange-600 whitespace-nowrap">
                      {toPersianDigits(ex.sets)}×{toPersianDigits(ex.reps)}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-amber-700/80 pt-1 font-bold">
                  + {toPersianDigits(program.workout.exercises.length - 3)} حرکت دیگر با زمان استراحت دقیق در برنامهٔ کامل
                </p>
              </div>
            )}

            {tab === "nutrition" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-bold text-slate-500">کالری هدف روزانه</span>
                  <span className="font-black font-stat text-orange-600">{program.nutrition.calories}</span>
                </div>
                {program.nutrition.meals.slice(0, 1).map((meal, i) => (
                  <div key={i} className="text-xs space-y-1">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-black text-amber-700 bg-white border border-amber-200 rounded-md px-1.5 py-0.5 whitespace-nowrap shrink-0">
                        {meal.name}
                      </span>
                      <span className="text-slate-600 leading-relaxed min-w-0">{meal.items}</span>
                    </div>
                    {/* ─── v87 — وعده‌های جایگزین (مثل برنامهٔ واقعی — هر وعده ۲ گزینه) ─── */}
                    {meal.alternatives.slice(0, 2).map((alt, ai) => (
                      <div key={ai} className="flex items-start gap-2 pr-1">
                        <span className="text-[9px] font-black text-white bg-violet-500 rounded-md px-1.5 py-0.5 whitespace-nowrap shrink-0 mt-0.5">
                          گزینهٔ {toPersianDigits(ai + 1)}
                        </span>
                        <span className="text-[10.5px] text-violet-800 leading-relaxed min-w-0">{alt}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-[10px] text-amber-700/80 pt-1 font-bold leading-relaxed">
                  برای هر وعده ۲ وعدهٔ جایگزین + {toPersianDigits(program.nutrition.meals.length - 1)} وعدهٔ دیگر با گرم‌های دقیق
                </p>
              </div>
            )}

            {tab === "supplements" && (
              <div className="flex flex-wrap gap-1.5">
                {program.supplements.map((sup, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-amber-200 text-[11px] font-bold text-slate-700"
                  >
                    <Pill className="w-3 h-3 text-orange-500" />
                    {sup.name} · {sup.dose} · {sup.when}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* خط فیتاپ — عکس غذا و ویدیوی حرکت (v135: بدون «هوش مصنوعی») */}
          <div className="mt-3 flex items-center justify-center gap-2 text-[10.5px] sm:text-[11px] font-bold text-amber-800 bg-amber-50/80 border border-amber-200/70 rounded-full px-3 py-1.5 text-center leading-relaxed">
            <Camera className="w-3.5 h-3.5 shrink-0 text-orange-500" />
            <span>
              تحلیل عکس غذا 📷 و تحلیل ویدیوی حرکت 🎬 با فیتاپ — فرم درست یا غلط رو بهت می‌گیم
            </span>
            <Video className="w-3.5 h-3.5 shrink-0 text-orange-500" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
