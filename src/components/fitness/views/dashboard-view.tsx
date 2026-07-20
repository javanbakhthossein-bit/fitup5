"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  ListChecks,
  Trophy,
  Zap,
  Clock,
  ChevronLeft,
  Dumbbell,
  Target,
  Lock,
  Music,
  TestTube,
  Video,
  Salad,
  Crown,
  Calendar,
  History,
  Sparkles,
  Loader2,
  ClipboardList,
  Activity,
  TrendingDown,
  Ruler,
  Camera,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  toPersianDigits,
  PERSIAN_WEEKDAYS,
  PLAN_LABELS,
  canAccess,
  type WorkoutPlanContent,
  type MealPlanContent,
} from "@/lib/fitness/types";
import { SmartNotificationsWidget } from "./smart-notifications-widget";
import { BodyAnalysisBanner } from "./body-analysis-banner";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

/** Format a JS Date as a Persian (Jalali) string with day-of-week + date + time */
function formatPersianDateTime(d: Date): string {
  try {
    const weekdayNames = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
    // Intl supports islamic-civil but for Persian (Jalali) use fa-IR with persian calendar
    const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).formatToParts(d);
    // Extract parts
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = get("weekday");
    const date = `${get("day")} ${get("month")} ${get("year")}`;
    // Time
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day}، ${date} - ${toPersianDigits(hh)}:${toPersianDigits(mm)}`;
  } catch {
    // Fallback if Intl calendar is unavailable
    const dayIdx = (d.getDay() + 1) % 7;
    const wd = PERSIAN_WEEKDAYS[dayIdx];
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${wd} - ${toPersianDigits(hh)}:${toPersianDigits(mm)}`;
  }
}

/** Estimate calories burned during a workout using MET × weight × hours */
function estimateCaloriesBurned(
  minutes: number,
  userWeightKg: number,
  metValue = 6.5
): number {
  const hours = minutes / 60;
  return Math.round(metValue * userWeightKg * hours);
}

export function DashboardView() {
  const {
    user,
    setMainTab,
    setOverlay,
    setBodyAnalysisOpen,
    workoutPlan,
    setWorkoutPlan,
    mealPlan,
    setMealPlan,
  } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState("");
  const [now, setNow] = useState<string>("");
  // آیا کاربر پلن advanced/ultimate دارد و هنوز عکس بدن خود را آپلود نکرده است؟
  // برای برجسته کردن دکمه «آپلود عکس بدن» با badge «الزامی» استفاده می‌شود.
  const [bodyPhotoAwaiting, setBodyPhotoAwaiting] = useState(false);

  // بررسی وضعیت awaitingMedia برای کاربران پلن پیشرفته/حرفه‌ای.
  // این fetch با fetch داخل BodyAnalysisBanner موازی است، اما برای به‌روزرسانی
  // badge «الزامی» لازم است و هزینهٔ کمی دارد.
  useEffect(() => {
    if (!user?.planName || (user.planName !== "advanced" && user.planName !== "ultimate")) {
      setBodyPhotoAwaiting(false);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const check = async () => {
      try {
        const res = await fetch("/api/coach/submit-body-analysis", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBodyPhotoAwaiting(Boolean(data?.awaitingMedia));
      } catch {
        // ignore
      }
    };
    check();
    // رفرش هر ۴۵ ثانیه تا badge به‌روز بماند
    interval = setInterval(check, 45000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [user?.planName]);

  // Live clock — update every second
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(formatPersianDateTime(d));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const dayIdx = new Date().getDay();
    const persianIdx = (dayIdx + 1) % 7;
    setToday(PERSIAN_WEEKDAYS[persianIdx]);

    let mounted = true;
    const loadPlans = async () => {
      try {
        const res = await fetch("/api/coach/plan", { cache: "no-store" });
        const data = await res.json();
        if (!mounted) return;
        // فقط اگر داده واقعاً تغییر کرده باشد، state را آپدیت کن (جلوگیری از flicker)
        if (data.workout) {
          const newJson = JSON.stringify(data.workout);
          const oldJson = workoutPlan ? JSON.stringify(workoutPlan) : "";
          if (newJson !== oldJson) {
            setWorkoutPlan(data.workout as WorkoutPlanContent);
          }
        }
        if (data.meal) {
          const newJson = JSON.stringify(data.meal);
          const oldJson = mealPlan ? JSON.stringify(mealPlan) : "";
          if (newJson !== oldJson) {
            setMealPlan(data.meal as MealPlanContent);
          }
        }
      } catch {
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadPlans();
    // Poll هر 60 ثانیه (به‌جای 30) برای کاهش flicker
    const interval = setInterval(loadPlans, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayWorkout = workoutPlan?.days.find((d) => d.day === today);

  // Estimated calories to burn during today's workout (MET-based)
  const userWeight = 75; // fallback if no profile
  const estimatedBurnCal = todayWorkout
    ? estimateCaloriesBurned(todayWorkout.estimatedMinutes, userWeight)
    : 0;

  const gymModeUnlocked = canAccess(user?.planName, "gymMode");

  return (
    <div className="px-4 py-4 space-y-4 max-w-5xl mx-auto lg:px-6">
      {/* Hero greeting with live date/time */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl p-5 bg-white border-2 border-orange-200 shadow-sm"
      >
        <div className="absolute -left-8 -top-8 w-40 h-40 rounded-full bg-orange-100 blur-3xl opacity-60" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Live date/time */}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1.5">
              <Calendar className="w-3.5 h-3.5 text-orange-500" />
              <span className="font-stat truncate">{now || "در حال بارگذاری..."}</span>
            </div>
            <h2 className="text-lg font-bold mb-1 truncate">
              {getGreeting()}، {user?.name || "ورزشکار"}!{" "}
              <span
                style={{
                  background: goldGradient,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                🔥
              </span>
            </h2>
            <p className="text-sm text-slate-500">
              {user?.planName
                ? `پلن ${PLAN_LABELS[user.planName]} فعال — امروز رو بترکون!`
                : "برای دسترسی کامل، پلن خودت رو فعال کن"}
            </p>
          </div>
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="text-5xl shrink-0"
          >
            💪
          </motion.div>
        </div>
      </motion.div>

      {/* Body analysis pending banner (Advanced/Ultimate) */}
      <BodyAnalysisBanner />

      {/* Today's workout + Quick actions */}
      <div className="grid grid-cols-1 gap-4">
        {/* Today's workout — Simple/Gym Mode split */}
        <Card className="p-5 bg-white border-2 border-orange-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(245,158,11,0.15)" }}
              >
                <Dumbbell className="w-4 h-4 text-orange-500" />
              </div>
              <h3 className="font-bold text-slate-900">مشاهده برنامه</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-orange-600 text-xs"
              onClick={() => setMainTab("programs")}
            >
              جزئیات
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
          {loading ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : user?.planName ? (
            <div>
              {/* کاربر پلن فعال دارد — دکمه مشاهده برنامه جاری */}
              <div className="grid grid-cols-1 gap-3">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ y: -2 }}
                  onClick={() => setMainTab("programs")}
                  className="relative overflow-hidden rounded-2xl text-white font-bold py-5 px-3 flex flex-col items-center justify-center gap-1.5 shadow-lg hover:shadow-xl transition-all"
                  style={{ background: goldGradient }}
                >
                  {/* shine effect */}
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-700" />
                  <ListChecks className="w-6 h-6 relative" strokeWidth={2.5} />
                  <span className="text-sm relative">مشاهده برنامه</span>
                  <span className="text-[10px] opacity-80 relative">برنامه تمرینی جاری</span>
                </motion.button>
              </div>
            </div>
          ) : (
            <div>
              {/* کاربر پلن فعال ندارد — پیام + دکمه خرید پلن + دکمه برنامه‌های قبلی */}
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 text-center">
                <p className="text-sm font-bold text-slate-700 mb-1">پلن فعالی ندارید</p>
                <p className="text-[11px] text-slate-500 mb-3">
                  برای دریافت برنامه تمرینی اختصاصی، یکی از پلن‌های فیتاپ را تهیه کنید.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    className="rounded-xl text-white font-bold text-xs"
                    style={{ background: goldGradient }}
                    onClick={() => setMainTab("plans")}
                  >
                    خرید پلن
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs"
                    onClick={() => setMainTab("programs")}
                  >
                    برنامه‌های قبلی
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Smart Notifications Widget */}
      <SmartNotificationsWidget />

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickAction
          icon={Dumbbell}
          label="مشاهده برنامه"
          onClick={() => {
            if (user?.planName) {
              setMainTab("programs");
            } else {
              toastInfo("پلن فعالی ندارید. برنامه‌های قبلی در تب برنامه‌ها قابل مشاهده هستند.");
              setMainTab("programs");
            }
          }}
        />
        <QuickAction icon={ClipboardList} label="برنامه‌ها" onClick={() => setMainTab("programs")} />
        <QuickAction icon={Target} label="تغذیه" onClick={() => setMainTab("nutrition")} />
        <QuickAction icon={Trophy} label="پیشرفت" onClick={() => setMainTab("progress")} />
      </div>

      {/* امکانات ویژه پلن — همه فعال */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-sm text-slate-900">امکانات ویژه پلن شما</h3>
          {user?.planName ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full text-orange-600 flex items-center gap-1" style={{ background: "rgba(245,158,11,0.12)" }}>
              <Crown className="w-3 h-3" /> پلن {PLAN_LABELS[user.planName]}
            </span>
          ) : (
            <button onClick={() => setMainTab("plans")} className="text-[11px] text-orange-600">خرید پلن ←</button>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* ─── آپلود عکس بدن (پیش‌نیاز همه برنامه‌های اختصاصی) ─── */}
          {/* این دکمه قبل از بقیه امکانات ویژه قرار می‌گیرد، چون بدون آپلود عکس بدن،
              هوش مصنوعی نمی‌تواند برنامه اختصاصی تولید کند. برای کاربران پلن
              پیشرفته/حرفه‌ای که هنوز عکس آپلود نکرده‌اند، badge «الزامی» نمایش
              داده می‌شود تا توجه آن‌ها جلب شود. */}
          <GatedFeature
            icon={Camera}
            label="آپلود عکس بدن"
            sub="برای برنامه اختصاصی"
            unlocked={canAccess(user?.planName, "bodyPhotoAnalysis")}
            badge={bodyPhotoAwaiting ? "الزامی" : undefined}
            highlight={bodyPhotoAwaiting}
            onClick={() => {
              if (canAccess(user?.planName, "bodyPhotoAnalysis")) {
                // باز کردن modal آپلود عکس بدن از طریق فلگ bodyAnalysisOpen
                // در store. BodyAnalysisBanner این فلگ را می‌خواند و modal را باز
                // می‌کند. این مکانیزم توسط programs-view نیز استفاده می‌شود.
                // اگر کاربر قبلاً عکس آپلود کرده (awaitingMedia=false)، modal
                // توسط BodyAnalysisBanner نمایش داده نمی‌شود؛ در این حالت یک
                // toast نمایش می‌دهیم.
                if (bodyPhotoAwaiting) {
                  setBodyAnalysisOpen(true);
                } else {
                  toastInfo("عکس بدن شما قبلاً آپلود شده ✓");
                }
              } else {
                toastInfo("آپلود عکس بدن نیازمند پلن پیشرفته است");
                setMainTab("plans");
              }
            }}
          />
          {/* حالت باشگاه — برای همه کاربران نمایش داده می‌شود (قفل برای بدون پلن) */}
          <GatedFeature
            icon={Dumbbell}
            label="حالت باشگاه"
            sub="تمرین با موسیقی و چت"
            unlocked={canAccess(user?.planName, "gymMode")}
            onClick={() => {
              if (canAccess(user?.planName, "gymMode")) {
                setOverlay("gymMode");
              } else {
                toastInfo("حالت باشگاه نیازمند پلن پیشرفته است");
                setMainTab("plans");
              }
            }}
          />
          <GatedFeature
            icon={Salad}
            label="دستیار تغذیه"
            sub="برنامه غذایی و مکمل اختصاصی"
            unlocked={canAccess(user?.planName, "nutritionCompanion")}
            onClick={() => {
              if (canAccess(user?.planName, "nutritionCompanion")) setMainTab("nutrition");
              else { toastInfo("دستیار تغذیه نیازمند پلن پیشرفته است"); setMainTab("plans"); }
            }}
          />
          <GatedFeature
            icon={Video}
            label="آنالیز ویدیویی"
            sub="بررسی فرم بدن"
            unlocked={canAccess(user?.planName, "videoBodyAnalysis")}
            onClick={() => {
              if (canAccess(user?.planName, "videoBodyAnalysis")) setOverlay("videoAnalysis");
              else { toastInfo("آنالیز ویدیویی نیازمند پلن حرفه‌ای است"); setMainTab("plans"); }
            }}
          />
          <GatedFeature
            icon={TestTube}
            label="آزمایش خون"
            sub="تحلیل تخصصی"
            unlocked={canAccess(user?.planName, "bloodTestAnalysis")}
            onClick={() => {
              if (canAccess(user?.planName, "bloodTestAnalysis")) setOverlay("bloodTest");
              else { toastInfo("تحلیل آزمایش خون نیازمند پلن حرفه‌ای است"); setMainTab("plans"); }
            }}
          />
        </div>
      </div>

      {/* ─── NEW (BODY-COMPOSITION-PRO): Body Progress Card ─── */}
      <BodyProgressCard />
    </div>
  );
}

/** کارت قابلیت با گیت پلن */
function GatedFeature({
  icon: Icon,
  label,
  sub,
  unlocked,
  onClick,
  badge,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  sub: string;
  unlocked: boolean;
  onClick: () => void;
  /** متن badge اختیاری (مثلاً «الزامی») — فقط وقتی unlocked=true نمایش داده می‌شود */
  badge?: string;
  /** برجسته کردن کارت (مثلاً وقتی پیش‌نیاز است و هنوز تکمیل نشده) */
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1.5 p-4 rounded-2xl border-2 transition text-center ${
        unlocked && highlight
          ? "bg-orange-50 border-orange-400 hover:border-orange-500 hover:shadow-lg ring-2 ring-orange-300/50 animate-pulse"
          : unlocked
            ? "bg-white border-orange-200 hover:border-orange-300 hover:shadow-md"
            : "bg-slate-50 border-slate-200 border-dashed opacity-70 hover:opacity-100"
      }`}
    >
      {!unlocked && (
        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
          <Lock className="w-3 h-3 text-slate-500" />
        </div>
      )}
      {unlocked && badge && (
        <span
          className="absolute top-2 left-2 text-[9px] px-2 py-0.5 rounded-full text-white font-bold flex items-center gap-1 shadow-sm"
          style={{ background: goldGradient }}
        >
          {badge}
        </span>
      )}
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center`}
        style={unlocked ? { background: "rgba(245,158,11,0.15)" } : undefined}
      >
        <Icon className={`w-5 h-5 ${unlocked ? "text-orange-500" : "text-slate-400"}`} />
      </div>
      <span className={`text-xs font-bold ${unlocked ? "text-slate-900" : "text-slate-500"}`}>{label}</span>
      <span className="text-[10px] text-slate-500">{unlocked ? sub : "قفل"}</span>
    </button>
  );
}

function toastInfo(msg: string) {
  import("sonner").then(({ toast }) => toast.info(msg));
}

/* ============ ACTIVITY RINGS (Apple-style SVG) ============ */
function ActivityRings({
  workout,
  calories,
  water,
}: {
  workout: number;
  calories: number;
  water: number;
}) {
  const rings = [
    { progress: workout, color: "#F4C542", radius: 52, label: "تمرین" },
    { progress: calories, color: "#10b981", radius: 40, label: "کالری" },
    { progress: water, color: "#06b6d4", radius: 28, label: "آب" },
  ];
  return (
    <div className="relative w-44 h-44 shrink-0">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        {rings.map((ring, i) => {
          const c = 2 * Math.PI * ring.radius;
          return (
            <g key={i}>
              <circle
                cx="60"
                cy="60"
                r={ring.radius}
                fill="none"
                stroke={ring.color}
                strokeWidth="9"
                strokeOpacity="0.15"
              />
              <motion.circle
                cx="60"
                cy="60"
                r={ring.radius}
                fill="none"
                stroke={ring.color}
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={c}
                initial={{ strokeDashoffset: c }}
                animate={{ strokeDashoffset: c * (1 - ring.progress) }}
                transition={{ duration: 1.2, delay: i * 0.15, ease: "easeOut" }}
                style={{ filter: `drop-shadow(0 0 4px ${ring.color}80)` }}
              />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <Flame className="w-6 h-6 text-orange-500 mx-auto mb-0.5" />
          <p className="text-[10px] text-slate-500">امروز</p>
        </div>
      </div>
    </div>
  );
}

function RingLegend({ color, label, value, sub }: { color: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}80` }} />
      <div className="flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-bold font-stat text-slate-900">{value} <span className="text-[10px] text-slate-500 font-normal">{sub}</span></p>
      </div>
    </div>
  );
}

/* ============ WATER GLASS — animated fill ============ */
function WaterGlass({ percentage, amount, goal }: { percentage: number; amount: number; goal: number }) {
  const glasses = Math.min(8, Math.floor(amount / 200));
  return (
    <div className="flex flex-col items-center">
      {/* Glass visual */}
      <div className="relative w-24 h-32 mx-auto mb-2">
        {/* Glass outline (trapezoid) */}
        <svg viewBox="0 0 80 110" className="w-full h-full" preserveAspectRatio="none">
          {/* Glass body — slightly tapered */}
          <defs>
            <clipPath id="glass-clip">
              <path d="M 12 6 L 68 6 L 62 104 L 18 104 Z" />
            </clipPath>
            <linearGradient id="water-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#67e8f9" />
              <stop offset="100%" stopColor="#0891b2" />
            </linearGradient>
          </defs>
          {/* Water fill */}
          <g clipPath="url(#glass-clip)">
            <motion.rect
              x="0"
              y={110 - 98 * percentage}
              width="80"
              height="110"
              fill="url(#water-grad)"
              initial={{ y: 110 }}
              animate={{ y: 110 - 98 * percentage }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
            {/* Wavy surface */}
            <motion.g
              animate={{ x: [0, -20, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg
                x="-10"
                y={110 - 98 * percentage - 4}
                width="100"
                height="8"
                viewBox="0 0 100 8"
                preserveAspectRatio="none"
              >
                <path d="M0,4 Q25,0 50,4 T100,4 L100,8 L0,8 Z" fill="white" fillOpacity="0.5" />
              </svg>
            </motion.g>
          </g>
          {/* Glass outline on top */}
          <path
            d="M 12 6 L 68 6 L 62 104 L 18 104 Z"
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2"
            strokeLinejoin="round"
            opacity="0.6"
          />
          {/* Glass shine */}
          <path d="M 18 12 L 22 12 L 26 96 L 22 96 Z" fill="white" fillOpacity="0.3" />
        </svg>
        {/* Amount text overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white font-bold pointer-events-none">
          <span className="text-base drop-shadow font-stat">{toPersianDigits(amount)}</span>
          <span className="text-[10px] opacity-90">سی‌سی</span>
        </div>
      </div>

      {/* Glasses row — 8 small glass icons for visual progress */}
      <div className="flex gap-1 flex-wrap justify-center max-w-[160px]">
        {Array.from({ length: 8 }, (_, i) => (
          <motion.div
            key={i}
            initial={false}
            animate={{ scale: i < glasses ? 1 : 0.85, opacity: i < glasses ? 1 : 0.4 }}
            className={`text-sm ${i < glasses ? "" : "grayscale"}`}
          >
            🥛
          </motion.div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-1">
        {toPersianDigits(glasses)} از {toPersianDigits(8)} لیوان
      </p>
    </div>
  );
}

/* ============ CALORIE FORMULA BAR ============ */
function CalorieFormulaBar({ target, consumed, burned, remaining }: { target: number; consumed: number; burned: number; remaining: number }) {
  const total = target + burned;
  const consumedPct = total > 0 ? (consumed / total) * 100 : 0;
  const burnedPct = total > 0 ? (burned / total) * 100 : 0;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs mb-3">
        <span className="px-2.5 py-1 rounded-lg bg-slate-100"><b className="text-cyan-600">{toPersianDigits(target)}</b> <span className="text-slate-600">هدف</span></span>
        <span className="text-slate-400">−</span>
        <span className="px-2.5 py-1 rounded-lg bg-slate-100"><b className="text-orange-500">{toPersianDigits(consumed)}</b> <span className="text-slate-600">مصرف</span></span>
        <span className="text-slate-400">+</span>
        <span className="px-2.5 py-1 rounded-lg bg-slate-100"><b className="text-emerald-500">{toPersianDigits(burned)}</b> <span className="text-slate-600">سوزانده</span></span>
        <span className="text-slate-400">=</span>
        <span className="px-2.5 py-1 rounded-lg" style={{ background: "rgba(245,158,11,0.12)" }}><b className="text-orange-600">{toPersianDigits(remaining)}</b> <span className="text-slate-600">باقی‌مانده</span></span>
      </div>
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
        <motion.div
          className="h-full bg-orange-400"
          initial={{ width: 0 }}
          animate={{ width: `${consumedPct}%` }}
          transition={{ duration: 0.8 }}
        />
        <motion.div
          className="h-full bg-emerald-400"
          initial={{ width: 0 }}
          animate={{ width: `${burnedPct}%` }}
          transition={{ duration: 0.8, delay: 0.2 }}
        />
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-2xl bg-white border-2 border-orange-200 hover:border-orange-300 hover:shadow-md transition text-right"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: "rgba(245,158,11,0.15)" }}
      >
        <Icon className="w-5 h-5 text-orange-500" />
      </div>
      <span className="text-sm font-medium text-slate-900">{label}</span>
    </button>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "صبح بخیر";
  if (h < 18) return "بعد از ظهر بخیر";
  return "شب بخیر";
}

/**
 * کارت مهم‌ترین رویداد نزدیک — بر اساس وضعیت کاربر، مهم‌ترین اقدام را نشان می‌دهد
 * - بدون پلن: «پلن خود را فعال کن» → خرید پلن
 * - پلن فعال، امروز تمرین دارد: «مشاهده برنامه» → تمرینات
 * - پلن فعال، امروز استراحت: «چکاپ دوره‌ای» یا «ثبت وزن»
 * - پلن منقضی‌شده: «اشتراک خود را تمدید کن» → اشتراک‌ها
 */
function PriorityActionCard() {
  const { user, setMainTab, setOverlay, workoutPlan } = useAppStore();

  // Determine the most important action
  let config: {
    icon: LucideIcon;
    title: string;
    subtitle: string;
    buttonText: string;
    onClick: () => void;
    gradient: string;
  };

  const now = new Date();
  const planExpires = user?.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const daysLeft = planExpires ? Math.ceil((planExpires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

  if (!user?.planName || !user?.hasActiveSubscription) {
    // No active plan → buy plan
    config = {
      icon: Crown,
      title: "پلن خود را فعال کن!",
      subtitle: "برای دریافت برنامه اختصاصی و چت با فیتاپ هوشمند، پلن مناسب خود را انتخاب کنید",
      buttonText: "انتخاب و خرید پلن",
      onClick: () => setMainTab("plans"),
      gradient: "linear-gradient(135deg, #f59e0b, #f97316)",
    };
  } else if (daysLeft > 0 && daysLeft <= 5) {
    // Plan expiring soon → renew
    config = {
      icon: Calendar,
      title: `اشتراک شما ${toPersianDigits(daysLeft)} روز دیگر منقضی می‌شود!`,
      subtitle: "برای تداوم برنامه تمرینی و دسترسی به امکانات، اشتراک خود را تمدید کنید",
      buttonText: "تمدید اشتراک",
      onClick: () => setMainTab("plans"),
      gradient: "linear-gradient(135deg, #ef4444, #f97316)",
    };
  } else {
    // Has active plan → check today's workout
    const dayIdx = new Date().getDay();
    const persianIdx = (dayIdx + 1) % 7;
    const todayName = PERSIAN_WEEKDAYS[persianIdx];
    const todayWorkout = workoutPlan?.days.find((d) => d.day === todayName);

    if (todayWorkout) {
      config = {
        icon: Dumbbell,
        title: `مشاهده برنامه: ${todayWorkout.title}`,
        subtitle: `${toPersianDigits(todayWorkout.exercises.length)} حرکت • ${toPersianDigits(todayWorkout.estimatedMinutes)} دقیقه`,
        buttonText: "شروع تمرین",
        onClick: () => setMainTab("programs"),
        gradient: "linear-gradient(135deg, #10b981, #059669)",
      };
    } else {
      // Rest day → log weight or check progress
      config = {
        icon: Trophy,
        title: "امروز روز استراحت شماست",
        subtitle: "از بدن خود مراقبت کنید! وزن خود را ثبت کنید یا پیشرفت را بررسی کنید",
        buttonText: "ثبت وزن و پیشرفت",
        onClick: () => setMainTab("progress"),
        gradient: "linear-gradient(135deg, #6366f1, #8b5cf6)",
      };
    }
  }

  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 text-white shadow-lg relative overflow-hidden"
      style={{ background: config.gradient }}
    >
      <div className="absolute -left-6 -top-6 w-24 h-24 rounded-full bg-white/10" />
      <div className="absolute -left-2 bottom-0 w-16 h-16 rounded-full bg-white/10" />

      <div className="relative flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center shrink-0 backdrop-blur-sm">
          <Icon className="w-7 h-7 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-base mb-0.5">{config.title}</h3>
          <p className="text-xs text-white/80 leading-snug">{config.subtitle}</p>
        </div>
      </div>

      <button
        onClick={config.onClick}
        className="w-full mt-4 py-3 rounded-xl bg-white/20 backdrop-blur-sm text-white font-bold text-sm hover:bg-white/30 transition flex items-center justify-center gap-2"
      >
        {config.buttonText}
        <ChevronLeft className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

/**
 * کارت تاریخچه برنامه‌های قبلی — برنامه‌های خریداری‌شده + تحلیل فیتاپ هوشمند
 */
function ProgramHistoryCard() {
  const { user } = useAppStore();
  const [history, setHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/coach/program-history");
        const data = await res.json();
        setHistory(data);
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  async function generateAnalysis() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/coach/program-history?analyze=1");
      const data = await res.json();
      setHistory(data);
    } catch {}
    finally { setAnalyzing(false); }
  }

  if (loading) return null;

  if (!history || !history.programs || history.totalPrograms === 0) {
    // کاربر بدون برنامه قبلی
    if (!user?.planName) {
      return (
        <Card className="p-5 border-2 border-orange-100 bg-white">
          <div className="flex items-center gap-2 mb-2">
            <History className="w-5 h-5 text-orange-500" />
            <h3 className="font-bold text-sm text-slate-900">تاریخچه برنامه‌ها</h3>
          </div>
          <p className="text-xs text-slate-500">هنوز برنامه‌ای خریداری نکرده‌اید. با خرید پلن، اولین برنامه اختصاصی شما توسط فیتاپ هوشمند ساخته می‌شود.</p>
        </Card>
      );
    }
    return null; // کاربر پلن دارد ولی برنامه هنوز ساخته نشده
  }

  return (
    <Card className="p-5 border-2 border-orange-100 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-orange-500" />
          <h3 className="font-bold text-sm text-slate-900">تاریخچه برنامه‌های شما</h3>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full text-orange-600" style={{ background: "rgba(245,158,11,0.12)" }}>
          {toPersianDigits(history.totalPrograms)} برنامه
        </span>
      </div>

      {/* لیست برنامه‌های قبلی */}
      <div className="space-y-2 mb-3">
        {(history.programs || []).slice(0, 3).map((p: any, i: number) => (
          <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl bg-orange-50/50 border border-orange-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                {toPersianDigits(i + 1)}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">
                  برنامه {toPersianDigits(i + 1)}
                  {p.active && <span className="text-emerald-500 mr-1">● فعال</span>}
                </p>
                <p className="text-[10px] text-slate-500">
                  {toPersianDigits(p.days)} روز • {toPersianDigits(p.exercises)} حرکت • {toPersianDigits(p.totalCalories)} کالری
                </p>
              </div>
            </div>
            <span className="text-[10px] text-slate-400">{new Date(p.createdAt).toLocaleDateString("fa-IR")}</span>
          </div>
        ))}
      </div>

      {/* تحلیل فیتاپ هوشمند */}
      {history.aiAnalysis ? (
        <div className="p-3 rounded-xl border border-orange-200 bg-orange-50/30 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <p className="text-xs font-bold text-orange-600">تحلیل فیتاپ هوشمند</p>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{history.aiAnalysis}</p>
        </div>
      ) : (
        <button
          onClick={generateAnalysis}
          disabled={analyzing}
          className="w-full py-2.5 rounded-xl text-white text-xs font-bold transition hover:scale-[1.02] flex items-center justify-center gap-2 mb-3"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          {analyzing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> فیتاپ هوشمند در حال تحلیل...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> تحلیل پیشرفت توسط فیتاپ هوشمند</>
          )}
        </button>
      )}

      {/* خلاصه آماری */}
      {history.weightLogs?.length > 0 && (
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50">
          <span className="text-[11px] text-slate-500">تغییر وزن کل:</span>
          <span className="text-xs font-bold text-slate-900">
            {history.weightLogs[0].weight} → {history.weightLogs[history.weightLogs.length - 1].weight} کیلوگرم
          </span>
        </div>
      )}
    </Card>
  );
}

/* ============ BODY PROGRESS CARD (BODY-COMPOSITION-PRO) ============ */
interface BodyCompHistoryItem {
  date: string; // YYYY-MM-DD
  weight: number;
  bodyFatPercent: number;
  leanBodyMass: number | null;
}

/** کارت پیشرفت بدنی — درصد چربی بدن + جرم خالص + نمودار پیشرفت */
function BodyProgressCard() {
  const { setMainTab } = useAppStore();
  const [history, setHistory] = useState<BodyCompHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/progress");
        const data = await res.json();
        setHistory(data.bodyCompositionHistory || []);
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return (
      <Card className="p-5 bg-white border-2 border-orange-200 shadow-sm">
        <Skeleton className="h-32 rounded-xl" />
      </Card>
    );
  }

  // اگر داده‌ای برای body composition نداریم، CTA نمایش می‌دهیم
  if (history.length === 0) {
    return (
      <Card className="p-5 bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-orange-200 shadow-sm">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Activity className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-sm text-slate-900 mb-1">پیشرفت بدنی</h3>
            <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
              با وارد کردن اندازه‌های بدن (دور کمر و گردن)، فیتاپ هوشمند درصد چربی بدن شما را با فرمول علمی US Navy محاسبه می‌کند و پیشرفت شما را در طول زمان نمایش می‌دهد.
            </p>
            <Button
              size="sm"
              className="rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              onClick={() => setMainTab("progress")}
            >
              <Ruler className="w-4 h-4" />
              اندازه‌های بدنی خود را وارد کنید
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const latest = history[history.length - 1];
  const first = history[0];

  // تبدیل تاریخ میلادی به شمسی کوتاه
  const toJalali = (iso: string): string => {
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        month: "short",
        day: "numeric",
      }).format(d);
    } catch {
      return iso;
    }
  };

  // تغییرات نسبت به baseline
  const fatChange = latest.bodyFatPercent - first.bodyFatPercent;
  const weightChange = latest.weight - first.weight;

  // داده‌های نمودار
  const chartData = history.map((h) => ({
    name: toJalali(h.date),
    bodyFat: h.bodyFatPercent,
    leanMass: h.leanBodyMass ?? null,
  }));

  return (
    <Card className="p-5 bg-white border-2 border-orange-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(245,158,11,0.15)" }}
          >
            <Activity className="w-4 h-4 text-orange-500" />
          </div>
          <h3 className="font-bold text-slate-900">پیشرفت بدنی</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-orange-600 text-xs"
          onClick={() => setMainTab("progress")}
        >
          جزئیات
          <ChevronLeft className="w-4 h-4" />
        </Button>
      </div>

      {/* Current body composition — 3 cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {/* Body fat % with circular indicator */}
        <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-orange-200 p-3 text-center">
          <BodyFatRing percent={latest.bodyFatPercent} />
          <p className="text-[10px] text-slate-500 mt-1">درصد چربی</p>
          <p className="text-[9px] text-orange-600 font-bold">
            {fatChange !== 0 ? `${fatChange > 0 ? "+" : ""}${toPersianDigits(fatChange.toFixed(1))}٪` : "—"}
          </p>
        </div>
        {/* Lean body mass */}
        <div className="rounded-2xl bg-white border-2 border-orange-100 p-3 text-center">
          <p className="text-[10px] text-slate-500 mb-1">جرم خالص</p>
          {latest.leanBodyMass != null ? (
            <>
              <p className="text-xl font-black font-stat text-slate-900 leading-none">
                {toPersianDigits(latest.leanBodyMass)}
              </p>
              <p className="text-[9px] text-slate-400 mt-0.5">کیلوگرم</p>
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-2">—</p>
          )}
        </div>
        {/* Weight */}
        <div className="rounded-2xl bg-white border-2 border-orange-100 p-3 text-center">
          <p className="text-[10px] text-slate-500 mb-1">وزن</p>
          <p className="text-xl font-black font-stat text-slate-900 leading-none">
            {toPersianDigits(latest.weight)}
          </p>
          <p className="text-[9px] text-slate-400 mt-0.5">کیلوگرم</p>
          {weightChange !== 0 && (
            <p className="text-[9px] mt-0.5 flex items-center justify-center gap-0.5"
              style={{ color: weightChange < 0 ? "#10b981" : "#f59e0b" }}
            >
              {weightChange < 0 ? <TrendingDown className="w-2.5 h-2.5" /> : null}
              {toPersianDigits(Math.abs(weightChange).toFixed(1))}
            </p>
          )}
        </div>
      </div>

      {/* Line chart — body fat % (orange) + lean mass (green) */}
      {history.length >= 1 && (
        <div className="rounded-xl bg-slate-50/50 p-3 border border-slate-100">
          <div className="flex items-center justify-between mb-2 text-[10px]">
            <span className="text-slate-600">روند تغییرات</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: "#f97316" }} />
                چربی بدن (٪)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: "#10b981" }} />
                جرم خالص (kg)
              </span>
            </div>
          </div>
          <div style={{ width: "100%", height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#cbd5e1" }}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#cbd5e1" }}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: "11px",
                    borderRadius: "8px",
                    border: "1px solid #fed7aa",
                    background: "#fffbeb",
                  }}
                  labelStyle={{ color: "#92400e" }}
                />
                <Line
                  type="monotone"
                  dataKey="bodyFat"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  dot={{ fill: "#f97316", r: 3 }}
                  activeDot={{ r: 5 }}
                  name="چربی بدن"
                />
                <Line
                  type="monotone"
                  dataKey="leanMass"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ fill: "#10b981", r: 3 }}
                  activeDot={{ r: 5 }}
                  name="جرم خالص"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Footer note */}
      <p className="text-[10px] text-slate-400 mt-2 text-center leading-relaxed">
        محاسبه بر اساس فرمول علمی US Navy (دور کمر، گردن و قد)
      </p>
    </Card>
  );
}

/** Circular progress indicator for body fat percentage */
function BodyFatRing({ percent }: { percent: number }) {
  const size = 56;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // درصد چربی را به فرکانس بصری (5-35) تبدیل می‌کنیم تا نمودار معنادار باشد
  const visualFraction = Math.min(1, Math.max(0.05, (percent - 3) / 35));
  const offset = circumference * (1 - visualFraction);
  const color = percent < 14 ? "#06b6d4" : percent < 21 ? "#10b981" : percent < 26 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
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
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-black font-stat text-slate-900 leading-none">
          {toPersianDigits(percent.toFixed(1))}
        </span>
      </div>
    </div>
  );
}
