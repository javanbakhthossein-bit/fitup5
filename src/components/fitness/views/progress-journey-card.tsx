"use client";

/**
 * ─── ProgressJourneyCard — «مسیر پیشرفت تو» (v137) ───
 *
 * دیرکتیو مالک: بالای بخش «امکانات ویژهٔ پلن شما» یک نمودار پیشرفت باشد؛
 * از اولین روز ثبت‌نام تا امروز، زیبا و با گیمیفایکشن جذاب، و از اطلاعات
 * مهم و کاربردی (چکاپ‌ها، تمرین‌ها، پلن‌ها، وزن) تغذیه شود.
 *
 * معماری:
 *  • داده از store (journey) — یک GET /api/dashboard/journey در mount داشبورد
 *    (loadJourney) — بدون fetch اضافه و بدون پولینگ.
 *  • ضد فلیکر: تا journeyLoaded اسکلت؛ خطا/دادهٔ خالی → خروج بی‌صدا (null)؛
 *    انیمیشن‌ها one-shot (بدون repeat:Infinity) — قانون ضد لگ داشبورد.
 *  • رایگان برای همهٔ کاربران حتی بدون پلن (API فقط requireAuth دارد).
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Flame, Dumbbell, Stethoscope, CalendarHeart, Medal, Target, Zap, Footprints, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useAppStore, type JourneyData } from "@/lib/fitness/store";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits } from "@/lib/fitness/types";

/** «۱۵ مهر» — برچسب کوتاه شمسی برای محور/تولتیپ */
function jalaliShort(d: string | Date): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Tehran",
    }).format(typeof d === "string" ? new Date(`${d}T00:00:00`) : d);
  } catch {
    return "";
  }
}

const fa = (n: number | string) => toPersianDigits(String(n));

/** چیپ آمار کوچک */
function StatChip({
  icon: Icon,
  value,
  label,
  hot,
}: {
  icon: typeof Flame;
  value: string;
  label: string;
  hot?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 border border-orange-100 bg-white/70 min-w-0"
      title={label}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${hot ? "text-orange-500" : "text-amber-500"}`} />
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] sm:text-xs font-black text-slate-900 whitespace-nowrap">{value}</p>
        <p className="text-[8.5px] text-slate-400 font-bold truncate">{label}</p>
      </div>
    </div>
  );
}

/** نشان افتخار (کسب‌شده / قفل) */
function Badge({ emoji, label, earned }: { emoji: string; label: string; earned: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
        earned
          ? "text-orange-700 border-orange-200"
          : "text-slate-400 border-slate-200 opacity-60"
      }`}
      style={earned ? { background: "linear-gradient(135deg, #fff7ed, #ffedd5)" } : { background: "#f8fafc" }}
      title={earned ? label : `${label} — هنوز کسب نشده`}
    >
      <span aria-hidden="true">{earned ? emoji : "🔒"}</span>
      {label}
    </span>
  );
}

/** تولتیپ سفارشی نمودار وزن — v143: با دلتا نسبت به نقطهٔ قبلی */
function JourneyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as { d: string; w: number; delta?: number } | undefined;
  if (!p) return null;
  const d = p.delta;
  const deltaTxt =
    d == null || Math.abs(d) < 0.05
      ? null
      : `${d < 0 ? "▼" : "▲"} ${toPersianDigits(Math.abs(d).toFixed(1).replace(".", "٫"))} نسبت به قبل`;
  return (
    <div
      className="rounded-xl px-3 py-2 text-white shadow-lg"
      style={{ background: "linear-gradient(135deg, #292524, #1c1917)" }}
    >
      <p className="text-sm font-black leading-none">
        {toPersianDigits(p.w.toFixed(1).replace(".", "٫"))} کیلوگرم
      </p>
      <p className="text-[10px] text-amber-200/80 mt-1 font-bold">{jalaliShort(p.d)}</p>
      {deltaTxt && <p className={`text-[10px] mt-0.5 font-black ${d != null && d < 0 ? "text-emerald-300" : "text-rose-300"}`}>{deltaTxt}</p>}
    </div>
  );
}

/**
 * v143 — نقطهٔ شروع/امروز: فقط اولین و آخرین نقطهٔ نمودار دایره دارند
 * (امروز: حلقهٔ سفید + هالهٔ نارنجی — بدون انیمیشن بی‌پایان، قانون ضد لگ)
 */
function JourneyDot(props: any) {
  const { cx, cy, index, payload } = props as { cx?: number; cy?: number; index?: number; payload?: { isFirst?: boolean; isLast?: boolean } };
  if (cx == null || cy == null || !payload) return null;
  if (payload.isLast) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={7.5} fill="#f97316" opacity={0.18} />
        <circle cx={cx} cy={cy} r={4.5} fill="#f97316" stroke="#fff" strokeWidth={2} />
      </g>
    );
  }
  if (payload.isFirst) {
    return <circle cx={cx} cy={cy} r={3.5} fill="#fff" stroke="#fbbf24" strokeWidth={2} />;
  }
  return null;
}

export function ProgressJourneyCard() {
  const journey = useAppStore((s) => s.journey);
  const journeyLoaded = useAppStore((s) => s.journeyLoaded);

  const chartData = useMemo(() => {
    if (!journey?.weightSeries) return [];
    const n = journey.weightSeries.length;
    return journey.weightSeries.map((p, i) => ({
      ...p,
      label: jalaliShort(p.d),
      isFirst: i === 0,
      isLast: i === n - 1,
      // دلتا نسبت به ثبت قبلی — برای تولتیپ
      delta: i > 0 ? +(p.w - journey.weightSeries[i - 1].w).toFixed(1) : undefined,
    }));
  }, [journey]);

  if (!journeyLoaded) {
    return <Skeleton className="h-60 w-full rounded-3xl" aria-hidden="true" />;
  }
  if (!journey) return null; // خطا/بدون داده — خروج بی‌صدا (ضد فلیکر)

  const j: JourneyData = journey;
  const goalLabel = j.goal?.label ?? null;

  // ─── پیشرفت وزنی نسبت به هدف (۰٪ شروع → ۱۰۰٪ هدف) ───
  let goalPct: number | null = null;
  if (
    j.targetWeight != null &&
    j.startWeight != null &&
    j.currentWeight != null &&
    Math.abs(j.startWeight - j.targetWeight) > 0.05
  ) {
    const done = Math.abs(j.startWeight - j.currentWeight);
    const total = Math.abs(j.startWeight - j.targetWeight);
    goalPct = Math.max(0, Math.min(1, done / total));
    // اگر از هدف رد شده → سقف ۱۰۰٪
  }
  const reachedGoal =
    j.targetWeight != null &&
    j.currentWeight != null &&
    Math.abs(j.currentWeight - j.targetWeight) <= 0.3;

  // ─── نشان‌های افتخار ───
  const badges = [
    { emoji: "🥇", label: "اولین تمرین", earned: j.workoutDays >= 1 },
    { emoji: "🔥", label: "زنجیرهٔ ۳ روزه", earned: j.bestStreak >= 3 },
    { emoji: "⚡", label: "زنجیرهٔ ۷ روزه", earned: j.bestStreak >= 7 },
    { emoji: "🩺", label: "اولین چکاپ", earned: j.checkupCount >= 1 },
    { emoji: "🏅", label: "چکاپ منظم", earned: j.checkupCount >= 3 },
    {
      emoji: reachedGoal ? "🏆" : "🎯",
      label: reachedGoal ? "رسیدن به هدف" : "نصف راه هدف",
      earned: reachedGoal || (goalPct != null && goalPct >= 0.5),
    },
  ];
  const earnedCount = badges.filter((b) => b.earned).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div
        className="rounded-3xl p-[1.5px] shadow-lg shadow-orange-500/10"
        style={{ background: "linear-gradient(135deg, rgba(234,88,12,0.8), rgba(251,191,36,0.55), rgba(249,115,22,0.75))" }}
      >
        <div
          className="relative overflow-hidden rounded-[22px] p-4 sm:p-5"
          style={{ background: "linear-gradient(165deg, #fffdf8 0%, #fff6e9 100%)" }}
        >
          {/* هالهٔ تزئینی */}
          <div className="pointer-events-none absolute -top-10 -left-10 w-32 h-32 rounded-full bg-amber-200/30 blur-3xl" />

          {/* ─── هدر: عنوان + بج سطح ─── */}
          <div className="relative flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h3 className="font-black text-sm sm:text-base text-slate-900 flex items-center gap-1.5 leading-tight">
                <Medal className="w-4 h-4 text-orange-500 shrink-0" />
                مسیر پیشرفت تو
              </h3>
              <p className="text-[10px] sm:text-[11px] text-slate-500 font-bold mt-0.5">
                از روز ثبت‌نام تا امروز — {fa(j.daysWithFitup)} روز با فیتاپ
              </p>
            </div>
            {/* بج سطح گیمیفایکشن */}
            <div
              className="shrink-0 flex items-center gap-2 rounded-2xl px-2.5 py-1.5 text-white shadow-md"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              title={`سطح ${j.level.name} — ${fa(j.xp)} امتیاز`}
            >
              <span className="text-lg leading-none" aria-hidden="true">{j.level.emoji}</span>
              <div className="leading-tight">
                <p className="text-[10px] sm:text-[11px] font-black whitespace-nowrap">{j.level.name}</p>
                <p className="text-[8.5px] text-amber-100 font-bold whitespace-nowrap">{fa(j.xp)} امتیاز</p>
              </div>
            </div>
          </div>

          {/* ─── نوار درس‌پیشرفت سطح ─── */}
          <div className="relative mb-3.5">
            <div className="h-2 rounded-full bg-orange-100/80 overflow-hidden" role="progressbar" aria-valuenow={Math.round(j.level.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #fbbf24, #f97316)" }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(j.level.progress * 100)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <p className="text-[9px] text-slate-400 font-bold mt-1 text-left">
              {j.level.next
                ? `${fa(j.level.next.min - j.xp)} امتیاز تا سطح «${j.level.next.name}»`
                : "بالاترین سطح فیتاپ — افتخار ما هستی! 👑"}
            </p>
          </div>

          {/* ─── v143 — نمودار وزن بازطراحی‌شده: خلاصهٔ بزرگ + منحنی پریمیوم ─── */}
          {chartData.length >= 2 ? (() => {
            // اعداد خلاصه: وزن فعلی / تغییر از شروع / فاصله تا هدف
            const first = chartData[0];
            const last = chartData[chartData.length - 1];
            const deltaFromStart = +(last.w - first.w).toFixed(1);
            const toGoal =
              j.targetWeight != null && j.currentWeight != null
                ? +(Math.abs(j.targetWeight - j.currentWeight)).toFixed(1)
                : null;
            const goalDir =
              j.targetWeight != null && j.startWeight != null
                ? Math.sign(j.targetWeight - j.startWeight)
                : 0;
            const movingRight =
              Math.abs(deltaFromStart) >= 0.1 && (goalDir === 0 || Math.sign(deltaFromStart) === goalDir);
            const atGoal = toGoal != null && toGoal <= 0.3;
            // دامنهٔ Y: وزن‌ها + هدف با حاشیهٔ تنفس
            const ws = chartData.map((p) => p.w);
            const yMin = Math.min(...ws, j.targetWeight ?? Infinity);
            const yMax = Math.max(...ws, j.targetWeight ?? -Infinity);
            const pad = Math.max(0.8, (yMax - yMin) * 0.18);
            const DeltaIcon = Math.abs(deltaFromStart) < 0.1 ? Minus : deltaFromStart < 0 ? TrendingDown : TrendingUp;
            const deltaGood = Math.abs(deltaFromStart) < 0.1 ? null : movingRight;
            return (
              <div className="relative rounded-2xl bg-white border border-orange-100 p-3 pt-3.5 mb-3 shadow-sm" dir="ltr">
                {/* خلاصهٔ بزرگ: وزن فعلی + دلتا + تا هدف */}
                <div className="flex items-end justify-between px-1 pb-2.5" dir="rtl">
                  <div className="leading-none">
                    <p className="text-[9px] font-black text-slate-400 mb-1">وزن فعلی</p>
                    <p className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums">
                      {toPersianDigits(j.currentWeight?.toFixed(1).replace(".", "٫") ?? last.w.toFixed(1).replace(".", "٫"))}
                      <span className="text-[10px] font-bold text-slate-400 mr-1">کیلوگرم</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Math.abs(deltaFromStart) >= 0.1 && (
                      <span
                        className={`flex items-center gap-1 text-[10px] font-black rounded-full px-2 py-1 ${
                          deltaGood ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
                        }`}
                      >
                        <DeltaIcon className="w-3 h-3" />
                        {toPersianDigits(Math.abs(deltaFromStart).toFixed(1).replace(".", "٫"))} از شروع
                      </span>
                    )}
                    {toGoal != null && !atGoal && (
                      <span className="flex items-center gap-1 text-[10px] font-black rounded-full px-2 py-1 bg-orange-50 text-orange-600">
                        <Target className="w-3 h-3" />
                        {toPersianDigits(toGoal.toFixed(1).replace(".", "٫"))} تا هدف
                      </span>
                    )}
                    {atGoal && (
                      <span className="flex items-center gap-1 text-[10px] font-black rounded-full px-2 py-1 bg-emerald-50 text-emerald-700">
                        🏆 به هدف رسیدی
                      </span>
                    )}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={168}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
                    <defs>
                      {/* پرکنندهٔ نرم دو-مرحله‌ای */}
                      <linearGradient id="journeyWeightFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.32} />
                        <stop offset="55%" stopColor="#fb923c" stopOpacity={0.12} />
                        <stop offset="100%" stopColor="#fdba74" stopOpacity={0.02} />
                      </linearGradient>
                      {/* هالهٔ زیر خط اصلی (سبک نمودارهای حرفه‌ای) */}
                      <linearGradient id="journeyWeightGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 6" stroke="#f5f0e6" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#a8a29e", fontWeight: 700 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={30}
                    />
                    <YAxis
                      domain={[Math.floor((yMin - pad) * 2) / 2, Math.ceil((yMax + pad) * 2) / 2]}
                      tick={{ fontSize: 9, fill: "#a8a29e", fontWeight: 700 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickCount={5}
                    />
                    {j.targetWeight != null && (
                      <ReferenceLine
                        y={j.targetWeight}
                        stroke="#10b981"
                        strokeDasharray="6 5"
                        strokeWidth={1.5}
                        strokeOpacity={0.85}
                        label={{
                          value: `هدف ${toPersianDigits(j.targetWeight.toFixed(1).replace(".", "٫"))}`,
                          position: "insideTopRight",
                          fontSize: 9,
                          fill: "#059669",
                          fontWeight: 900,
                        }}
                      />
                    )}
                    {j.startWeight != null && Math.abs((first?.w ?? 0) - j.startWeight) > 0.05 && (
                      <ReferenceLine y={j.startWeight} stroke="#fbbf24" strokeDasharray="2 6" strokeWidth={1} strokeOpacity={0.7} />
                    )}
                    <Tooltip
                      content={<JourneyTooltip />}
                      cursor={{ stroke: "#fdba74", strokeWidth: 1, strokeDasharray: "3 3" }}
                    />
                    {/* هالهٔ پهن زیر منحنی */}
                    <Area
                      type="monotone"
                      dataKey="w"
                      stroke="#fdba74"
                      strokeWidth={6}
                      strokeOpacity={0.35}
                      fill="none"
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                    {/* منحنی اصلی */}
                    <Area
                      type="monotone"
                      dataKey="w"
                      stroke="#f97316"
                      strokeWidth={2.75}
                      strokeLinecap="round"
                      fill="url(#journeyWeightFill)"
                      dot={<JourneyDot />}
                      activeDot={{ r: 5, fill: "#ea580c", stroke: "#fff", strokeWidth: 2.5 }}
                      isAnimationActive
                      animationDuration={900}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                {/* راهنمای کوچک: شروع → امروز */}
                <div className="flex items-center justify-between px-1 pt-1" dir="rtl">
                  <span className="text-[8.5px] font-bold text-amber-500">● شروع سفر</span>
                  <span className="text-[8.5px] font-bold text-orange-500">● امروز</span>
                </div>
              </div>
            );
          })() : (
            /* حالت خوش‌آمد — کاربر تازه یا بدون ثبت وزن */
            <div className="relative rounded-2xl bg-white border border-dashed border-orange-200 p-5 mb-3 text-center">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-2"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <CalendarHeart className="w-5 h-5 text-white" />
              </div>
              <p className="text-xs font-black text-slate-800">
                سفرت همین امروز شروع شد — {fa(j.daysWithFitup)} روز همراه فیتاپ 💪
              </p>
              <p className="text-[10px] text-slate-400 font-bold mt-1 leading-relaxed">
                با هر تمرین، غذای ثبت‌شده و وزن جدید، این نمودار قشنگ‌تر می‌شود و امتیاز می‌گیری.
              </p>
            </div>
          )}

          {/* ─── چیپ‌های آمار کاربردی ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
            <StatChip icon={CalendarHeart} value={`${fa(j.daysWithFitup)} روز`} label="همراهی با فیتاپ" />
            <StatChip icon={Dumbbell} value={`${fa(j.workoutDays)} تمرین`} label="تمرین ثبت‌شده" />
            <StatChip icon={Flame} value={`${fa(j.currentStreak)} روز`} label="پیوستگی فعلی" hot={j.currentStreak > 0} />
            {j.activity7d && j.activity7d.count > 0 ? (
              <StatChip
                icon={Footprints}
                value={`${fa(Math.round((j.activity7d.distanceM / 100) / 10))} کیلومتر`}
                label="پیاده‌روی/دویدن هفته"
              />
            ) : (
              <StatChip icon={Stethoscope} value={`${fa(j.checkupCount)} چکاپ`} label="چکاپ بدنسازی" />
            )}
            {j.activity7d && j.activity7d.count > 0 && (
              <StatChip icon={Stethoscope} value={`${fa(j.checkupCount)} چکاپ`} label="چکاپ بدنسازی" />
            )}
          </div>

          {/* ─── نوار پیشرفت وزنی تا هدف ─── */}
          {goalPct != null && (
            <div className="relative mb-3 rounded-2xl bg-white border border-orange-100 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black text-slate-700 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-orange-500" />
                  راه تا وزن هدف
                </span>
                <span className="text-[10px] font-black text-orange-600">
                  ٪{fa(Math.round(goalPct * 100))}
                  {reachedGoal ? " — رسیدی! 🏆" : ""}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-orange-100/80 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: reachedGoal ? "linear-gradient(90deg, #10b981, #059669)" : "linear-gradient(90deg, #fbbf24, #f97316)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(goalPct * 100)}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
              </div>
            </div>
          )}

          {/* ─── نشان‌های افتخار ─── */}
          <div className="relative flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] font-black text-slate-400 whitespace-nowrap">
              نشان‌ها: {fa(earnedCount)}/{fa(badges.length)}
            </span>
            {badges.map((b) => (
              <Badge key={b.label} emoji={b.emoji} label={b.label} earned={b.earned} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
