"use client";

// ─────────────────────────────────────────────────────────────────────────────
// صفحهٔ تحلیل آنبوردینگ — بازطراحی هنری v64 (دیریکتیو مالک)
//
// تغییر بزرگ این نسخه: «پلن پیشنهادی» تک‌قطنه حذف شد؛ به‌جای آن ۴ پلن
// (اقتصادی/استاندارد/پیشرفته/حرفه‌ای) با کارت‌های کوچک شیک، تفاوت‌ها و
// مزیت‌های هر کدام نمایش داده می‌شود و کاربر همان‌جا انتخاب و خرید می‌کند.
// چرا: خیلی از کاربران آنبوردینگ را کامل می‌کنند ولی به خرید نمی‌رسند —
// این صفحه ویترین فروش است و باید هنرمندانه، جذاب و کاملاً موبایل‌پسند باشد.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Dumbbell, Sparkles, ChevronRight, TrendingUp, Target,
  Activity, Crown, RefreshCw, Flame, Beef, Wheat, Droplet,
  Scale, Calendar, Ruler, Heart, Bot, CalendarDays,
  Zap, ShieldCheck, Infinity as InfinityIcon, Star,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  toPersianDigits,
  formatToman,
  type Plan,
  type SubscriptionPlan,
} from "@/lib/fitness/types";
import { usePlans } from "@/lib/fitness/use-plans";
import { PurchaseModal } from "@/components/fitness/landing/sections/purchase-modal";
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
// Macro ring — circular progress for protein/carbs/fat (pure SVG, no deps)
// ─────────────────────────────────────────────────────────────────────────────
function MacroRing({
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
  const size = 84;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fillFraction = 0.78; // visual fill — purely aesthetic

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={stroke}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - fillFraction) }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-slate-400">{icon}</span>
          <span className="text-base font-black font-stat text-slate-900 leading-none">
            {toPersianDigits(grams)}
          </span>
          <span className="text-[9px] text-slate-400">گرم</span>
        </div>
      </div>
      <p className="text-xs font-bold text-slate-700">{label}</p>
      <p className="text-[10px] text-slate-400">{toPersianDigits(calories)} کیلوکالری</p>
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
            <p className="text-[9px] sm:text-[10px] text-slate-400 truncate">{plan.tagline}</p>
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

        {/* Biometric cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3"
        >
          <Card className="p-4 text-center border-2 border-orange-100 shadow-sm">
            <p className="text-[10px] text-slate-500">شاخص BMI</p>
            <p className={`text-2xl font-black font-stat ${bmiColor}`}>{toPersianDigits(bmi.toFixed(1))}</p>
            <p className={`text-[10px] font-bold ${bmiColor}`}>{bmiCategory}</p>
          </Card>
          <Card className="p-4 text-center border-2 border-orange-100 shadow-sm">
            <p className="text-[10px] text-slate-500">متابولیسم (BMR)</p>
            <p className="text-2xl font-black font-stat text-slate-900">{toPersianDigits(data?.bmr ?? 0)}</p>
            <p className="text-[10px] text-slate-400">کیلوکالری</p>
          </Card>
          <Card className="p-4 text-center border-2 border-orange-100 shadow-sm">
            <p className="text-[10px] text-slate-500">کالری روزانه (TDEE)</p>
            <p className="text-2xl font-black font-stat text-slate-900">{toPersianDigits(data?.tdee ?? 0)}</p>
            <p className="text-[10px] text-slate-400">کیلوکالری</p>
          </Card>
        </motion.div>

        {/* 🆕 v64 — کالری هدف و درشت‌مغذی‌ها (حلقه‌های SVG) — قبلاً در API بود ولی نمایش داده نمی‌شد */}
        {data?.macros && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 }}
          >
            <Card className="p-5 border-2 border-orange-100 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Flame className="w-4 h-4 text-white" />
                </div>
                <h3 className="font-bold text-slate-900">کالری و درشت‌مغذی پیشنهادی</h3>
              </div>

              <div className="rounded-2xl p-4 mb-4 text-center relative overflow-hidden" style={{ background: "linear-gradient(135deg, #fff7ed, #fffbeb)", border: "1px solid #fed7aa" }}>
                <p className="text-[11px] text-slate-500 mb-1">کالری هدف روزانه</p>
                <p className="text-3xl font-black font-stat text-orange-600 leading-none">
                  {toPersianDigits(formatToman(data.macros.targetCalories))}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">کیلوکالری در روز</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MacroRing label="پروتئین" grams={data.macros.protein_g} calories={data.macros.protein_g * 4} color="#f97316" icon={<Beef className="w-3.5 h-3.5" />} />
                <MacroRing label="کربوهیدرات" grams={data.macros.carbs_g} calories={data.macros.carbs_g * 4} color="#f59e0b" icon={<Wheat className="w-3.5 h-3.5" />} />
                <MacroRing label="چربی" grams={data.macros.fat_g} calories={data.macros.fat_g * 9} color="#d97706" icon={<Droplet className="w-3.5 h-3.5" />} />
              </div>
            </Card>
          </motion.div>
        )}

        {/* Weight goal trajectory card */}
        {data?.trajectory && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
          >
            <Card className="p-5 border-2 border-orange-100 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Target className="w-4 h-4 text-white" />
                </div>
                <h3 className="font-bold text-slate-900">مسیر رسیدن به وزن هدف</h3>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 mb-1">وزن فعلی</p>
                  <p className="text-xl font-black font-stat text-slate-900">
                    {toPersianDigits(data.trajectory.currentWeight)}
                  </p>
                  <p className="text-[9px] text-slate-400">کیلوگرم</p>
                </div>

                {/* Progress bar */}
                <div className="flex-1 mx-3 relative">
                  <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, #f59e0b, #f97316)" }}
                    />
                  </div>
                  <div className="flex items-center justify-center mt-1">
                    <Scale className="w-3 h-3 text-orange-500" />
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-[10px] text-slate-500 mb-1">وزن هدف</p>
                  <p className="text-xl font-black font-stat text-orange-600">
                    {toPersianDigits(data.trajectory.targetWeight)}
                  </p>
                  <p className="text-[9px] text-slate-400">کیلوگرم</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-orange-50 p-3 text-center">
                  <Calendar className="w-4 h-4 text-orange-500 mx-auto mb-1" />
                  <p className="text-[10px] text-slate-500">زمان رسیدن به هدف</p>
                  <p className="text-sm font-black font-stat text-slate-900">
                    {toPersianDigits(data.trajectory.weeksToGoal)} هفته
                  </p>
                </div>
                <div className="rounded-xl bg-orange-50 p-3 text-center">
                  <TrendingUp className="w-4 h-4 text-orange-500 mx-auto mb-1" />
                  <p className="text-[10px] text-slate-500">نرخ هفتگی</p>
                  <p className="text-sm font-black font-stat text-slate-900">
                    {data.trajectory.weeklyRate > 0 ? "+" : ""}
                    {toPersianDigits(data.trajectory.weeklyRate.toFixed(2))} kg
                  </p>
                </div>
                <div className="rounded-xl bg-orange-50 p-3 text-center">
                  <Flame className="w-4 h-4 text-orange-500 mx-auto mb-1" />
                  <p className="text-[10px] text-slate-500">تنظیم کالری روزانه</p>
                  <p className="text-sm font-black font-stat text-slate-900">
                    {data.trajectory.weeklyCalorieAdjustment > 0 ? "+" : ""}
                    {toPersianDigits(data.trajectory.weeklyCalorieAdjustment)}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-slate-500 text-center leading-relaxed">
                این مسیر بر اساس نرخ ایمن{" "}
                {data.trajectory.weeklyRate < 0
                  ? `کاهش ${toPersianDigits(0.5)} کیلوگرم در هفته`
                  : `افزایش ${toPersianDigits(0.25)} کیلوگرم در هفته`}{" "}
                محاسبه شده است. روند تغییر وزن نرمال و پایدار است.
              </p>
            </Card>
          </motion.div>
        )}

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

        {/* ═══ v64 — ویترین ۴ پلن (بدون «پلن پیشنهادی» — دیریکتیو مالک) ═══ */}
        {/* کاربر باید همان‌جا پلنش را ببیند، مقایسه کند، انتخاب و خرید کند.
            کارت‌ها کوچک، شیک و هنرمندانه‌اند با هویت بصری مستقل برای هر پلن. */}
        {SUBSCRIPTION_PLANS.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            aria-label="انتخاب پلن"
            className="relative"
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
