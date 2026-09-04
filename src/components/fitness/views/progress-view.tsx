"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  TrendingDown,
  Camera,
  Target,
  Scale,
  Trophy,
  Ruler,
  Sparkles,
  Activity,
  Award,
  Zap,
  TrendingUp,
  Plus,
  Loader2,
  Trash2,
  Lock,
  Brain,
  Apple,
  Flame,
  RefreshCw,
  Dumbbell,
} from "lucide-react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toPersianDigits, canAccess, planTierRank } from "@/lib/fitness/types";
import { toast } from "sonner";
import { CheckupSection } from "./checkup-section";
import { MediaImage } from "@/components/fitness/media-image";

interface ProgressData {
  weights: { id: string; weight: number; note: string; loggedAt: string }[];
  photos: { id: string; imageUrl: string; type: string; note: string; takenAt: string }[];
  startWeight: number | null;
  targetWeight: number | null;
}

/**
 * پارس امن aiAnalysis (FE-M3) — JSON.parse بدون try/catch در render می‌توانست
 * با رشته خراب کل ویو (و اپ) را crash کند. حالا null برمی‌گرداند و رندر گارد می‌شود.
 */
function safeParseAiAnalysis(value: any): any | null {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? null;
  } catch {
    return null;
  }
}

export function ProgressView() {
  const { bodyMeasurements, setBodyMeasurements, user, setMainTab } = useAppStore();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  // FIX: خطای شبکه قبلاً بی‌صدا «هنوز عکسی ثبت نشده» نشان می‌داد (گمراه‌کننده!)
  // حالا خطا شفاف + دکمه تلاش مجدد
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [checkups, setCheckups] = useState<any[]>([]);
  const [mediaData, setMediaData] = useState<any>(null);

  useEffect(() => {
    load();
  }, []);

  // ─── v15: اسکرول به کارت چکاپ ───
  // نوتیف‌های چکاپ به «?tab=progress&section=checkup» لینک دارند — دو مسیر:
  //  ۱) لینک مستقیم از URL (با mount شدن تب پیشرفت)
  //  ۲) ایونت fitup:focus-checkup (کلیک نوتیف در همان تب — applyLink آن را dispatch می‌کند)
  useEffect(() => {
    const focusCheckup = () => {
      try {
        const el = document.getElementById("checkup-section");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}
    };
    try {
      if (new URLSearchParams(window.location.search).get("section") === "checkup") {
        setTimeout(focusCheckup, 600);
      }
    } catch {}
    window.addEventListener("fitup:focus-checkup", focusCheckup);
    return () => window.removeEventListener("fitup:focus-checkup", focusCheckup);
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [progressRes, checkupRes, mediaRes] = await Promise.all([
        fetch("/api/progress", { cache: "no-store" }),
        fetch("/api/checkup", { cache: "no-store" }),
        fetch("/api/user-media").catch(() => null),
      ]);
      if (!progressRes.ok) {
        // خطای واقعی (شبکه/401) — به‌جای حالت «خالی» گمراه‌کننده، خطا نشان بده
        throw new Error("خطا در دریافت اطلاعات پیشرفت — دوباره تلاش کن");
      }
      const d = await progressRes.json();
      setData(d);
      try {
        const c = await checkupRes.json();
        const checkupList: any[] = c.checkups || [];
        setCheckups(checkupList);

        // ─── FE-M7: hydrate اندازه‌های بدن از آخرین چکاپ دارای اندازه ───
        // قبلاً bodyMeasurements فقط در حافظه Zustand بود و با refresh پاک می‌شد؛
        // حالا از همان منبع ماندگار (چکاپ‌ها — همان که مودال عکس بدن با
        // /api/checkup/baseline-measurements در آن می‌نویسد) پر می‌شود.
        const hasLocal = Boolean(
          bodyMeasurements.waist || bodyMeasurements.arm || bodyMeasurements.chest || bodyMeasurements.hip
        );
        if (!hasLocal) {
          const src = checkupList.find(
            (ch: any) => ch.waistMeasurement || ch.armMeasurement || ch.chestMeasurement || ch.hipMeasurement
          );
          if (src) {
            setBodyMeasurements({
              waist: src.waistMeasurement ?? undefined,
              arm: src.armMeasurement ?? undefined,
              chest: src.chestMeasurement ?? undefined,
              hip: src.hipMeasurement ?? undefined,
            });
          }
        }

        // آخرین وزن شناخته‌شده — برای تخمین کالری تمرین (جایگزین ۷۵kg هاردکد)
        const progressWeights = Array.isArray(d?.weights) ? d.weights : [];
        const fromProgress = progressWeights.length > 0
          ? Number(progressWeights[progressWeights.length - 1].weight)
          : NaN;
        const fromCheckup = Number(checkupList.find((ch: any) => ch.weight)?.weight);
        const latestWeight = Number.isFinite(fromProgress) && fromProgress > 0
          ? fromProgress
          : fromCheckup;
        if (Number.isFinite(latestWeight) && latestWeight > 0) {
          useAppStore.getState().setLastKnownWeightKg(latestWeight);
        }
      } catch {}
      if (mediaRes) {
        try { setMediaData(await mediaRes.json()); } catch {}
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "خطا در بارگذاری");
    } finally {
      setLoading(false);
    }
  }

  const currentWeight = data?.weights[data.weights.length - 1]?.weight;
  const startWeight = data?.startWeight;
  const totalLost = startWeight && currentWeight ? (startWeight - currentWeight) : 0;

  // ─── C3: داده‌های نمودار بر اساس چکاپ‌ها (از اولین خرید پلن تاکنون) ───
  const checkupChart = (() => {
    // چکاپ‌ها از API نزولی می‌آیند — برای نمودار صعودی مرتب می‌کنیم
    const asc = [...checkups].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    if (asc.length === 0) return { points: [], hasBodyFat: false };

    // شروع بازه: planStartedAt → (planExpiresAt − ۴۵ روز) → earliest checkup
    const planStartMs = (() => {
      const started = (user as any)?.planStartedAt;
      if (started) return new Date(started).getTime();
      if (user?.planExpiresAt) {
        return new Date(user.planExpiresAt).getTime() - 45 * 24 * 60 * 60 * 1000;
      }
      return new Date(asc[0].createdAt).getTime();
    })();

    let inPlan = asc.filter((c) => new Date(c.createdAt).getTime() >= planStartMs);
    if (inPlan.length < 2) inPlan = asc; // fallback: همه چکاپ‌ها

    const hasBodyFat = inPlan.some((c) => c.bodyFatPercent != null);
    const points = inPlan.map((c) => ({
      date: new Date(c.createdAt).toLocaleDateString("fa-IR", {
        month: "short",
        day: "numeric",
      }),
      وزن: c.weight != null ? c.weight : undefined,
      چربی: c.bodyFatPercent != null ? c.bodyFatPercent : undefined,
    }));
    return { points, hasBodyFat };
  })();
  const chartData = checkupChart.points;

  // ─── C3: گیت نمودار — استاندارد و بالاتر (tier >= 2) ───
  const chartUnlocked = planTierRank(user?.planName) >= 2;

  return (
    <div className="px-4 py-4 space-y-4 max-w-md mx-auto">
      <div>
        <h2 className="text-2xl font-black">پیشرفت من</h2>
        <p className="text-sm text-muted-foreground">تحلیل جامع پیشرفت شما توسط فیتاپ هوشمند</p>
      </div>

      {/* FIX: خطای بارگذاری — شفاف + تلاش مجدد (قبلاً خطای شبکه «عکسی ثبت نشده» جعل می‌کرد) */}
      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-red-700 font-bold">{loadError}</p>
          <Button variant="outline" size="sm" onClick={load} className="shrink-0">
            تلاش مجدد
          </Button>
        </div>
      )}

      {/* ═══ چکاپ دوره‌ای — بالاترین قسمت ═══ */}
      <CheckupSection />

      {/* ═══ تحلیل جامع فیتاپ — v15: گزارش کامل هوش مصنوعی ═══ */}
      <ComprehensiveAnalysisCard
        lastCheckup={checkups[0] ?? null}
        currentWeight={currentWeight ?? null}
        startWeight={startWeight ?? null}
        totalLost={totalLost}
      />

      {/* ═══ دستاوردها ═══ */}
      {totalLost > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-2xl bg-gradient-to-l from-amber-500/20 to-orange-500/10 border border-amber-500/30 flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm">آفرین! {toPersianDigits(totalLost.toFixed(1))} کیلو کاهش وزن</p>
            <p className="text-xs text-muted-foreground">به مسیر موفقیت ادامه بده! 💪</p>
          </div>
        </motion.div>
      )}

      {/* ═══ نمودار پیشرفت بر اساس چکاپ‌ها (C3 — جایگزین نمودار WeightLog) ═══ */}
      <Card className="p-4 border-2 border-orange-100 bg-gradient-to-br from-orange-50/40 to-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-orange-500" />
            <h3 className="font-bold text-sm">روند پیشرفت بر اساس چکاپ‌ها</h3>
          </div>
          {/* راهنمای سریع سری‌های فعال */}
          {chartUnlocked && chartData.length >= 2 && (
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <span className="flex items-center gap-1 text-amber-600">
                <span className="w-2.5 h-0.5 rounded-full bg-amber-500 inline-block" /> وزن
              </span>
              {checkupChart.hasBodyFat && (
                <span className="flex items-center gap-1 text-rose-500">
                  <span className="w-2.5 inline-block border-t-2 border-dashed border-rose-500" /> چربی ٪
                </span>
              )}
            </div>
          )}
        </div>

        {!chartUnlocked ? (
          // ─── پلن اقتصادی: کارت قفل‌شده ───
          <div className="rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/60 p-5 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Lock className="w-6 h-6 text-white" />
            </div>
            <p className="text-sm font-bold text-slate-800 mb-1">
              نمودار پیشرفت چکاپ‌ها در پلن استاندارد و بالاتر فعال است
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              با ثبت چکاپ‌های دوره‌ای، روند وزن و درصد چربی بدن شما در این نمودار رسم می‌شود.
            </p>
            <Button
              size="sm"
              onClick={() => setMainTab("plans")}
              className="rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              مشاهده پلن‌ها
            </Button>
          </div>
        ) : loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : chartData.length < 2 ? (
          <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
            <Scale className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">هنوز چکاپ کافی برای نمودار نیست</p>
            <p className="text-[11px] mt-1">وزن و درصد چربی شما در چکاپ‌های دوره‌ای ثبت می‌شود</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -14, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted/30" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "currentColor" }} className="text-muted-foreground" reversed />
              <YAxis
                yAxisId="weight"
                orientation="right"
                tick={{ fontSize: 10, fill: "#d97706" }}
                className="text-muted-foreground"
                domain={["dataMin - 2", "dataMax + 2"]}
                width={38}
              />
              {checkupChart.hasBodyFat && (
                <YAxis
                  yAxisId="bodyFat"
                  orientation="left"
                  tick={{ fontSize: 10, fill: "#e11d48" }}
                  domain={["dataMin - 2", "dataMax + 2"]}
                  width={32}
                />
              )}
              <Tooltip content={<CheckupChartTooltip />} />
              <Line
                yAxisId="weight"
                type="monotone"
                dataKey="وزن"
                name="وزن"
                stroke="#f59e0b"
                strokeWidth={3}
                dot={{ fill: "#f59e0b", r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
              {checkupChart.hasBodyFat && (
                <Line
                  yAxisId="bodyFat"
                  type="monotone"
                  dataKey="چربی"
                  name="چربی بدن %"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ fill: "#f43f5e", r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ═══ اندازه‌های بدن ═══ */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Ruler className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">اندازه‌های بدن</h3>
          </div>
          <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={() => setShowMeasurements((v) => !v)}>
            {showMeasurements ? "بستن" : "ثبت اندازه"}
          </Button>
        </div>
        {showMeasurements ? (
          <BodyMeasurementsForm
            values={bodyMeasurements}
            onSave={async (m) => {
              setBodyMeasurements(m);
              setShowMeasurements(false);
              // ─── FE-M7: ذخیره ماندگار در سرور (همان API مودال عکس بدن) ───
              // قبلاً فقط Zustand memory-only بود و با refresh از بین می‌رفت.
              try {
                const payload: Record<string, number> = {};
                if (m.waist) payload.waistMeasurement = m.waist;
                if (m.arm) payload.armMeasurement = m.arm;
                if (m.chest) payload.chestMeasurement = m.chest;
                if (m.hip) payload.hipMeasurement = m.hip;
                if (Object.keys(payload).length > 0) {
                  const res = await fetch("/api/checkup/baseline-measurements", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) throw new Error();
                }
                toast.success("اندازه‌های بدن ثبت شد");
              } catch {
                toast.error("ذخیره اندازه‌ها در سرور ناموفق بود — دوباره تلاش کنید");
              }
            }}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MeasurementChip label="دور کمر" value={bodyMeasurements.waist} unit="cm" />
            <MeasurementChip label="دور بازو" value={bodyMeasurements.arm} unit="cm" />
            <MeasurementChip label="دور سینه" value={bodyMeasurements.chest} unit="cm" />
            <MeasurementChip label="دور باسن" value={bodyMeasurements.hip} unit="cm" />
          </div>
        )}
      </Card>

      {/* ═══ گالری پیشرفت ═══ */}
      <ProgressGallery photos={data?.photos || []} onRefresh={load} user={user} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  تحلیل جامع فیتاپ (v15) — گزارش کامل هوش مصنوعی (درخواست مالک:
//  «تحلیل جامع فیتاپ رو خیلی جذابتر و کاربردی‌تر کن — الان فقط یه وزن
//  نشون میده؛ با تحلیل کلی هوش مصنوعی جذابش کن»)
// ═══════════════════════════════════════════════════════════════
interface ComprehensiveReport {
  overallScore: number;
  summary: string;
  weightTrend: string;
  bodyFatTrend: string;
  strengths: string[];
  focusAreas: string[];
  training: string;
  nutrition: string;
  recommendations: string[];
  motivational: string;
}

function ComprehensiveAnalysisCard({
  lastCheckup,
  currentWeight,
  startWeight,
  totalLost,
}: {
  lastCheckup: any;
  currentWeight: number | null;
  startWeight: number | null;
  totalLost: number;
}) {
  const [report, setReport] = useState<ComprehensiveReport | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // GET آخرین گزارش ذخیره‌شده (بدون AI)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coach/comprehensive-analysis", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.report) {
          setReport(data.report);
          setGeneratedAt(data.generatedAt ?? null);
        }
      } catch {
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function generateReport() {
    setLoadingReport(true);
    setReportError(null);
    try {
      const res = await fetch("/api/coach/comprehensive-analysis", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "خطا در تولید تحلیل");
      setReport(data.report);
      setGeneratedAt(new Date().toISOString());
      toast.success("تحلیل جامع آماده شد! 🪄");
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "خطا در تولید تحلیل");
    } finally {
      setLoadingReport(false);
    }
  }

  // داده‌های لحظه‌ای از آخرین چکاپ (بدون AI)
  const lastAi = safeParseAiAnalysis(lastCheckup?.aiAnalysis);
  const bodyFatPercent = lastCheckup?.bodyFatPercent ?? null;
  const leanBodyMass = lastCheckup?.leanBodyMass ?? null;
  const checkupScore = lastAi?.bodyScore ?? null;

  const score = report?.overallScore ?? checkupScore ?? null;
  const scoreColor = score == null ? "#f59e0b" : score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <Card className="p-0 overflow-hidden border-2 border-orange-200 shadow-md">
      {/* هدر گرادیانی */}
      <div
        className="p-5 pb-4 text-white relative"
        style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
      >
        <div className="absolute top-3 left-3 opacity-20">
          <Sparkles className="w-16 h-16" />
        </div>
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">تحلیل جامع فیتاپ</h3>
              <p className="text-[11px] text-white/85">
                گزارش کامل مسیر شما توسط هوش مصنوعی
              </p>
            </div>
          </div>
          {/* امتیاز کلی */}
          {score != null && (
            <div className="text-center shrink-0 bg-white/15 rounded-2xl px-3 py-1.5 border border-white/25 backdrop-blur-sm">
              <p className="text-2xl font-black leading-none">{toPersianDigits(score)}</p>
              <p className="text-[9px] text-white/80">از ۱۰۰</p>
            </div>
          )}
        </div>
        {/* نوار امتیاز */}
        {score != null && (
          <div className="relative mt-3 h-1.5 rounded-full bg-white/25 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-white"
              initial={{ width: 0 }}
              animate={{ width: `${score}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </div>
        )}
      </div>

      <div className="p-4 space-y-3.5">
        {/* آمار کلیدی لحظه‌ای (از چکاپ/وزن‌ها — بدون AI) */}
        <div className="grid grid-cols-2 gap-2">
          {currentWeight != null && (
            <MetricCard icon={Scale} label="وزن فعلی" value={`${toPersianDigits(currentWeight)} kg`} color="text-orange-500" bg="bg-orange-50" />
          )}
          {bodyFatPercent != null && (
            <MetricCard icon={Activity} label="درصد چربی بدن" value={`${toPersianDigits(bodyFatPercent)}٪`} color="text-rose-500" bg="bg-rose-50" />
          )}
          {leanBodyMass != null && (
            <MetricCard icon={Zap} label="وزن عضلانی" value={`${toPersianDigits(leanBodyMass)} kg`} color="text-emerald-500" bg="bg-emerald-50" />
          )}
          {totalLost > 0 && (
            <MetricCard icon={TrendingDown} label="کاهش وزن" value={`${toPersianDigits(totalLost.toFixed(1))} kg`} color="text-cyan-500" bg="bg-cyan-50" />
          )}
          {startWeight == null && currentWeight == null && (
            <p className="col-span-2 text-[11px] text-slate-400 text-center py-2">
              برای شروع، اولین چکاپ یا وزن خود را ثبت کنید
            </p>
          )}
        </div>

        {/* گزارش AI */}
        {report ? (
          <div className="space-y-3">
            {/* خلاصه جامع */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-l from-amber-50 to-orange-50 border border-orange-200">
              <p className="text-[11px] font-bold text-orange-700 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> خلاصه تحلیل
              </p>
              <p className="text-xs text-slate-700 leading-relaxed">{report.summary}</p>
            </div>

            {/* روند وزن و چربی */}
            {(report.weightTrend || report.bodyFatTrend) && (
              <div className="grid grid-cols-2 gap-2">
                {report.weightTrend && (
                  <div className="p-2.5 rounded-xl bg-orange-50/70 border border-orange-100 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-orange-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[9px] text-slate-500 font-bold">روند وزن</p>
                      <p className="text-[10px] text-slate-700 leading-tight">{report.weightTrend}</p>
                    </div>
                  </div>
                )}
                {report.bodyFatTrend && (
                  <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-100 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-rose-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[9px] text-slate-500 font-bold">روند چربی بدن</p>
                      <p className="text-[10px] text-slate-700 leading-tight">{report.bodyFatTrend}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* نقاط قوت */}
            {report.strengths.length > 0 && (
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200">
                <p className="text-[11px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5" /> نقاط قوت شما
                </p>
                <ul className="space-y-1">
                  {report.strengths.map((s, i) => (
                    <li key={i} className="text-[11px] text-slate-700 flex items-start gap-1.5">
                      <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* نقاط تمرکز */}
            {report.focusAreas.length > 0 && (
              <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200">
                <p className="text-[11px] font-bold text-amber-700 mb-1.5 flex items-center gap-1">
                  <Target className="w-3.5 h-3.5" /> روی این‌ها تمرکز کن
                </p>
                <ul className="space-y-1">
                  {report.focusAreas.map((s, i) => (
                    <li key={i} className="text-[11px] text-slate-700 flex items-start gap-1.5">
                      <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* تمرین و تغذیه */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {report.training && (
                <div className="p-3 rounded-xl bg-violet-50/60 border border-violet-100">
                  <p className="text-[10px] font-bold text-violet-700 mb-1 flex items-center gap-1">
                    <Dumbbell className="w-3 h-3" /> تمرین
                  </p>
                  <p className="text-[11px] text-slate-700 leading-relaxed">{report.training}</p>
                </div>
              )}
              {report.nutrition && (
                <div className="p-3 rounded-xl bg-lime-50/60 border border-lime-100">
                  <p className="text-[10px] font-bold text-lime-700 mb-1 flex items-center gap-1">
                    <Apple className="w-3 h-3" /> تغذیه
                  </p>
                  <p className="text-[11px] text-slate-700 leading-relaxed">{report.nutrition}</p>
                </div>
              )}
            </div>

            {/* توصیه‌ها */}
            {report.recommendations.length > 0 && (
              <div className="p-3 rounded-2xl bg-white border-2 border-orange-100">
                <p className="text-[11px] font-bold text-orange-600 mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> توصیه‌های عملی فیتاپ
                </p>
                <ul className="space-y-1.5">
                  {report.recommendations.map((r, i) => (
                    <li key={i} className="text-[11px] text-slate-700 flex items-start gap-2">
                      <span
                        className="w-4 h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                      >
                        {toPersianDigits(i + 1)}
                      </span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* جمله انگیزشی */}
            {report.motivational && (
              <div
                className="p-3.5 rounded-2xl text-white relative overflow-hidden"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <Flame className="w-10 h-10 absolute -left-2 -bottom-2 opacity-20" />
                <p className="text-xs font-bold leading-relaxed relative">
                  🔥 {report.motivational}
                </p>
              </div>
            )}

            {/* به‌روزرسانی + تاریخ */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[9px] text-slate-400">
                {generatedAt
                  ? `آخرین تحلیل: ${new Date(generatedAt).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })} ${new Date(generatedAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={generateReport}
                disabled={loadingReport}
                className="rounded-xl text-[11px] gap-1 h-7 border-orange-200 text-orange-600 hover:bg-orange-50"
              >
                {loadingReport ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> در حال به‌روزرسانی...</>
                ) : (
                  <><RefreshCw className="w-3 h-3" /> تحلیل تازه</>
                )}
              </Button>
            </div>
          </div>
        ) : loadingReport ? (
          /* در حال تولید */
          <div className="py-8 flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                <Brain className="w-7 h-7 text-orange-500 animate-pulse" />
              </div>
              <Loader2 className="w-5 h-5 text-orange-600 animate-spin absolute -bottom-1 -left-1 bg-white rounded-full p-0.5" />
            </div>
            <p className="text-xs font-bold text-slate-700">هوش مصنوعی در حال تحلیل داده‌های شماست…</p>
            <p className="text-[10px] text-slate-400">پروفایل، چکاپ‌ها، وزن‌ها و عکس‌هایتان را با هم بررسی می‌کند</p>
          </div>
        ) : reportError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-center">
            <p className="text-[11px] text-red-700 font-bold mb-1">{reportError}</p>
            <Button size="sm" onClick={generateReport} className="rounded-xl text-white mt-1" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
              تلاش مجدد
            </Button>
          </div>
        ) : (
          /* هنوز گزارشی نیست — CTA */
          <div className="rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/50 p-5 text-center">
            <div
              className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center shadow-md"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Brain className="w-6 h-6 text-white" />
            </div>
            <p className="text-sm font-bold text-slate-800 mb-1">گزارش کامل با هوش مصنوعی</p>
            <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
              {checking
                ? "در حال بررسی تحلیل‌های قبلی…"
                : lastCheckup
                  ? "آمار بالا فقط بخشی از مسیر است — دکمه پایین را بزن تا هوش مصنوعی همه داده‌های شما (پروفایل، چکاپ‌ها، وزن‌ها، عکس‌ها) را کنار هم بگذارد و گزارش کامل پیشرفت، نقاط قوت و توصیه‌های اختصاصی‌ات را بنویسد."
                  : "هنوز چکاپی ثبت نکردی؛ با این حال هوش مصنوعی از پروفایل و داده‌های موجودت یک تحلیل اولیه می‌نویسد. برای تحلیل عمیق‌تر، چکاپ‌های دوره‌ای را ثبت کن."}
            </p>
            <Button
              onClick={generateReport}
              disabled={checking}
              className="rounded-xl text-white gap-2 shadow-md"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Sparkles className="w-4 h-4" /> تحلیل جامع با هوش مصنوعی
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ═══ گالری پیشرفت — با آپلود عکس + تحلیل پیشرفت بدن ═══
function ProgressGallery({ photos, onRefresh, user }: {
  photos: { id: string; imageUrl: string; type: string; note: string; takenAt: string }[];
  onRefresh: () => void;
  user: any;
}) {
  const { setMainTab } = useAppStore();
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<"front" | "side" | "back">("front");
  // C2: تب فیلتر گالری — «همه» + سه زاویه؛ انتخاب زاویه، هدف آپلود را هم عوض می‌کند
  const [activeTab, setActiveTab] = useState<"all" | "front" | "side" | "back">("all");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // حذف عکس با تأیید درون‌برنامه‌ای — confirm() مرورگر در WebView/iframe
  // مسدود است و همیشه false برمی‌گرداند → حذف عملاً غیرممکن بود
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // C4: گیت استاندارد+ (قابلیت جدید progressAnalysis) — به‌جای advanced/ultimate هاردکد
  const canAnalyze = canAccess(user?.planName, "progressAnalysis");
  // C4: سهمیه ۳ تحلیل در طول اشتراک — از GET همان route
  const [remaining, setRemaining] = useState<number | null>(null);

  const refreshRemaining = useCallback(async () => {
    try {
      const res = await fetch("/api/coach/analyze-body-progress", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      if (typeof d?.remaining === "number") setRemaining(d.remaining);
    } catch {}
  }, []);

  useEffect(() => {
    refreshRemaining();
  }, [refreshRemaining]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("type", selectedType);
      const res = await fetch("/api/progress/photo", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "خطا در آپلود");
      }
      toast.success("عکس پیشرفت ثبت شد ✓");
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در آپلود");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/progress/photo?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("خطا در حذف");
      toast.success("عکس حذف شد");
      onRefresh();
    } catch {
      toast.error("خطا در حذف");
    } finally {
      setDeleteTargetId(null);
    }
  }

  async function handleAnalyzeProgress() {
    if (photos.length < 2) {
      toast.error("برای تحلیل پیشرفت حداقل ۲ عکس نیاز است");
      return;
    }
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/coach/analyze-body-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // C4: تحلیل ۱۲ عکس آخر (قبلاً ۶)
        body: JSON.stringify({ photos: photos.slice(0, 12).map(p => ({ imageUrl: p.imageUrl, type: p.type, takenAt: p.takenAt })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 403 LIMIT_REACHED: پیام سرور (سهمیه ۳ تحلیلی) را مستقیم نشان بده
        throw new Error(data?.error || "خطا در تحلیل");
      }
      setAnalysisResult(data.analysis || "تحلیلی دریافت نشد.");
      refreshRemaining(); // سهمیه با هر تحلیل موفق کاهش می‌یابد
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "خطا در تحلیل پیشرفت");
      refreshRemaining();
    } finally {
      setAnalyzing(false);
    }
  }

  const typeLabel = (t: string) => t === "front" ? "جلو" : t === "side" ? "بغل" : t === "back" ? "پشت" : t === "custom" ? "آزاد" : t;

  // C2: فیلتر گالری — «همه» همه عکس‌ها (شامل custom از مسیر body-analysis)؛
  // تب زاویه فقط همان زاویه را نشان می‌دهد. عکس‌ها از API نزولی (جدید → قدیم) می‌آیند.
  const filteredPhotos = activeTab === "all" ? photos : photos.filter((p) => p.type === activeTab);

  // C2: انتخاب تب — زاویه انتخابی هم فیلتر است هم هدف آپلود؛ «همه» فقط فیلتر است
  // (آپلود با آخرین زاویه انتخاب‌شده — پیش‌فرض «جلو»).
  function selectTab(t: "all" | "front" | "side" | "back") {
    setActiveTab(t);
    if (t !== "all") setSelectedType(t);
  }

  return (
    <Card className="p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-orange-500" />
          <h3 className="font-bold text-sm">گالری پیشرفت</h3>
          {photos.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 font-bold">
              {toPersianDigits(photos.length)} عکس
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          🔒 خصوصی
        </span>
      </div>

      {/* توضیحات */}
      <div className="p-3 rounded-xl bg-orange-50/50 border border-orange-100 mb-3">
        <p className="text-[11px] text-slate-600 leading-relaxed">
          📸 <strong>ثبت پیشرفت با عکس:</strong> هر چند وقت یک‌بار از بدن خود در ۳ زاویه (جلو، بغل، پشت) عکس بگیرید و اینجا آپلود کنید. تغییرات بدنی که در آینه نمی‌بینید، در عکس‌ها مشخص می‌شوند.
        </p>
        {canAnalyze ? (
          <p className="text-[11px] text-emerald-600 mt-1.5 leading-relaxed">
            ✨ <strong>تحلیل هوشمند پیشرفت:</strong> فیتاپ عکس‌های شما را مقایسه می‌کند و نقاط پیشرفت و بهبود را مشخص می‌کند (۳ بار در طول اشتراک).
          </p>
        ) : (
          <p className="text-[11px] text-amber-700 mt-1.5 leading-relaxed">
            ✨ <strong>تحلیل هوشمند پیشرفت:</strong> در پلن استاندارد و بالاتر فعال است — عکس‌هایتان را همین حالا ثبت کنید تا با ارتقا آماده تحلیل باشند.
          </p>
        )}
      </div>

      {/* C2: تب‌های فیلتر (همه/جلو/بغل/پشت) + دکمه آپلود — تب زاویه = فیلتر + هدف آپلود */}
      <div className="mb-3">
        <div className="flex gap-2">
          <div className="flex-1 flex gap-1 p-1 rounded-xl bg-slate-100">
            {(["all", "front", "side", "back"] as const).map((t) => (
              <button
                key={t}
                onClick={() => selectTab(t)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === t
                    ? "bg-white text-orange-600 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {t === "all" ? "همه" : typeLabel(t)}
              </button>
            ))}
          </div>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-xl text-white gap-1.5 shrink-0"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> آپلود...</>
            ) : (
              <><Plus className="w-4 h-4" /> افزودن عکس</>
            )}
          </Button>
        </div>
        {activeTab === "all" && photos.length > 0 && (
          <p className="text-[10px] text-slate-400 mt-1.5">
            عکس جدید با زاویه «{typeLabel(selectedType)}» ثبت می‌شود — برای تغییر، تب زاویه را انتخاب کنید
          </p>
        )}
      </div>

      {/* گالری عکس‌ها — فیلترشده بر اساس تب فعال (۳ ستون، جدیدترین اول) */}
      {photos.length > 0 ? (
        filteredPhotos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {filteredPhotos.map((p) => (
              <div key={p.id} className="aspect-square rounded-xl overflow-hidden bg-slate-100 relative group">
                {/* v15: MediaImage — فایل گم‌شده به‌جای آیکون شکسته، placeholder شکیل نشان می‌دهد */}
                <MediaImage src={p.imageUrl} alt={p.type} className="w-full h-full" fallbackLabel="فایل حذف شده">
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                    <p className="text-[9px] text-white font-bold">{typeLabel(p.type)}</p>
                    <p className="text-[8px] text-white/80">
                      {new Date(p.takenAt).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                </MediaImage>
                <button
                  onClick={() => setDeleteTargetId(p.id)}
                  className="absolute top-1 left-1 w-6 h-6 rounded-full bg-red-500/90 text-white flex items-center justify-center opacity-60 md:opacity-0 md:group-hover:opacity-100 transition hover:bg-red-600 z-10"
                  aria-label="حذف عکس"
                  title="حذف عکس"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-slate-400">
            <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-xs">در زاویه «{typeLabel(activeTab)}» هنوز عکسی ثبت نشده</p>
            <p className="text-[10px] mt-1">تب «همه» را انتخاب کنید یا با دکمه «افزودن عکس» عکس این زاویه را اضافه کنید</p>
          </div>
        )
      ) : (
        <div className="py-8 text-center text-slate-400">
          <Camera className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-xs">هنوز عکسی ثبت نشده</p>
          <p className="text-[10px] mt-1">با دکمه «افزودن عکس» اولین عکس خود را اضافه کنید</p>
        </div>
      )}

      {/* دکمه تحلیل پیشرفت — C4: استاندارد+ باز؛ پلن اقتصادی دکمه قفل‌شده (upsell) */}
      {(!canAnalyze || photos.length >= 2) && (
        <div className="mt-3">
          {canAnalyze ? (
            <Button
              onClick={handleAnalyzeProgress}
              disabled={analyzing}
              className="w-full rounded-xl text-white gap-2"
              style={{ background: "linear-gradient(135deg, #10b981, #14b8a6)" }}
            >
              {analyzing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> در حال تحلیل پیشرفت...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> تحلیل هوشمند پیشرفت بدن</>
              )}
            </Button>
          ) : (
            <button
              onClick={() => {
                toast.info("تحلیل پیشرفت در پلن استاندارد و بالاتر فعال است");
                setMainTab("plans");
              }}
              className="w-full py-2.5 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 text-emerald-700 text-sm font-bold flex items-center justify-center gap-2 transition hover:bg-emerald-50"
            >
              <Lock className="w-4 h-4" /> تحلیل هوشمند پیشرفت بدن
            </button>
          )}
          {/* C4: سهمیه ۳ تحلیل در طول اشتراک + باقی‌مانده */}
          <p className="text-[10px] text-slate-400 mt-1.5 text-center">
            ۳ بار در طول اشتراک
            {remaining != null && ` — ${toPersianDigits(remaining)} تحلیل باقی‌مانده`}
          </p>
          {analysisResult && (
            <div className="mt-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <p className="text-xs font-bold text-emerald-700 mb-1">تحلیل پیشرفت شما:</p>
              <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap">{analysisResult}</p>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-400 mt-3 text-center">
        تصاویر پیشرفت کاملاً خصوصی هستند و فقط برای شما نمایش داده می‌شوند.
      </p>

      {/* تأیید حذف عکس — دیالوگ درون‌برنامه‌ای (جایگزین confirm) */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف عکس پیشرفت</AlertDialogTitle>
            <AlertDialogDescription>
              این عکس برای همیشه حذف می‌شود. مطمئن هستید؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row">
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={() => {
                if (deleteTargetId) handleDelete(deleteTargetId);
              }}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── کامپوننت‌های کمکی ───

/**
 * C3: تولتیپ سفارشی RTL نمودار چکاپ‌ها — گرد، فارسی، با رنگ سری.
 * recharts خودش active/payload/label را پاس می‌دهد.
 */
function CheckupChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      dir="rtl"
      className="rounded-xl border border-orange-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm"
    >
      <p className="text-[10px] font-bold text-slate-500 mb-1 border-b border-orange-100 pb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-[11px] leading-5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.stroke || p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-bold" style={{ color: p.stroke || p.color }}>
            {toPersianDigits(Math.round(Number(p.value) * 10) / 10)}
            {p.dataKey === "چربی" ? "٪" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`p-3 rounded-xl ${bg} text-center`}>
      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
      <p className="text-lg font-black text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

function MeasurementChip({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="p-2 rounded-xl bg-muted/40 text-center">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-bold">
        {value ? `${toPersianDigits(value)}` : "—"}
        {value && <span className="text-[10px] text-muted-foreground mr-0.5">{unit}</span>}
      </p>
    </div>
  );
}

function BodyMeasurementsForm({
  values,
  onSave,
}: {
  values: { waist?: number; arm?: number; chest?: number; hip?: number };
  onSave: (m: { waist?: number; arm?: number; chest?: number; hip?: number }) => void;
}) {
  const [waist, setWaist] = useState(values.waist?.toString() || "");
  const [arm, setArm] = useState(values.arm?.toString() || "");
  const [chest, setChest] = useState(values.chest?.toString() || "");
  const [hip, setHip] = useState(values.hip?.toString() || "");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs mb-1 block">دور کمر (cm)</Label>
          <Input type="number" value={waist} onChange={(e) => setWaist(e.target.value)} className="h-10 rounded-lg" inputMode="decimal" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">دور بازو (cm)</Label>
          <Input type="number" value={arm} onChange={(e) => setArm(e.target.value)} className="h-10 rounded-lg" inputMode="decimal" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">دور سینه (cm)</Label>
          <Input type="number" value={chest} onChange={(e) => setChest(e.target.value)} className="h-10 rounded-lg" inputMode="decimal" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">دور باسن (cm)</Label>
          <Input type="number" value={hip} onChange={(e) => setHip(e.target.value)} className="h-10 rounded-lg" inputMode="decimal" />
        </div>
      </div>
      <Button
        className="w-full rounded-xl"
        onClick={() => onSave({
          waist: waist ? Number(waist) : undefined,
          arm: arm ? Number(arm) : undefined,
          chest: chest ? Number(chest) : undefined,
          hip: hip ? Number(hip) : undefined,
        })}
      >
        ذخیره اندازه‌ها
      </Button>
    </div>
  );
}
