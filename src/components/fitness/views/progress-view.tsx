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
  // v53: تب ویدیوها + کارت آزمایش خون
  Video,
  Play,
  TestTube,
  ChevronLeft,
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
// v78 — گیت ترتیبی پیش‌نیازها (لایهٔ خالص مشترک با سرور — Task 3-a)
import {
  getSequenceBlocker,
  sequenceStepLabel,
  type PrereqSequenceStep,
} from "@/lib/fitness/prereq-sequence";
import { toast } from "sonner";
import { downscaleImage } from "@/lib/fitness/client-image";
import { CheckupSection } from "./checkup-section";
import { MediaImage } from "@/components/fitness/media-image";
// v53: لایت‌باکس مشترک — بزرگ‌نمایی عکس‌ها / پخش ویدیوهای گالری پیشرفت
import { MediaLightbox } from "@/components/fitness/media-lightbox";

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
    <div className="px-4 py-4 space-y-4 max-w-md lg:max-w-4xl mx-auto lg:px-6">
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

      {/* ═══ گالری پیشرفت — v53: mediaData برای تب ویدیوها + کارت آزمایش خون ═══ */}
      <ProgressGallery photos={data?.photos || []} onRefresh={load} user={user} mediaData={mediaData} />
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

// ═══ گالری پیشرفت — v53: گرید واحد عکس‌ها + تب ویدیوها (پلن حرفه‌ای) + کارت خون + لایت‌باکس ═══
function ProgressGallery({ photos, onRefresh, user, mediaData }: {
  photos: { id: string; imageUrl: string; type: string; note: string; takenAt: string }[];
  onRefresh: () => void;
  user: any;
  mediaData: any | null;
}) {
  const { setMainTab, setOverlay } = useAppStore();
  const [uploading, setUploading] = useState(false);
  // v56: انتخابگر زاویه حذف شد — نوع عکس جدید ثابت است (metadata داخلی برای تحلیل AI)
  const selectedType = "front";
  // v53: تب «عکس‌ها» / «ویدیوها» — فقط برای دارندگان پلن حرفه‌ای (ultimate) نمایش داده می‌شود
  const [mediaTab, setMediaTab] = useState<"photos" | "videos">("photos");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // حذف عکس با تأیید درون‌برنامه‌ای — confirm() مرورگر در WebView/iframe
  // مسدود است و همیشه false برمی‌گرداند → حذف عملاً غیرممکن بود
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // v53: لایت‌باکس — ایندکس باز روی لیست فعلی (عکس‌ها یا ویدیوها)؛ null = بسته
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // ─── v78 — گیت ترتیبی: دکمهٔ «آنالیز ویدیویی بدن» در گالری خالی هم باید
  // از زنجیرهٔ خون → ویدیو پیروی کند (یافتهٔ Task 3-a). مراحل از همان GET
  // موجود می‌آید؛ تا اولین پاسخ قفل (fail-closed)، بعد از آن طبق بلاکر.
  const canVideoAnalysis = canAccess(user?.planName, "videoBodyAnalysis");
  const [prereqSteps, setPrereqSteps] = useState<PrereqSequenceStep[] | null>(null);
  const refreshPrereqSteps = useCallback(async () => {
    if (!canVideoAnalysis) return;
    try {
      const res = await fetch("/api/coach/submit-body-analysis", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d?.prerequisites)) setPrereqSteps(d.prerequisites);
    } catch {
      // خطای شبکه → قفل می‌ماند (fail-closed)، سرور هم مستقل گیت دارد
    }
  }, [canVideoAnalysis]);

  useEffect(() => {
    refreshPrereqSteps();
    const onPrereqUpdated = () => {
      refreshPrereqSteps();
    };
    window.addEventListener("prereq-updated", onPrereqUpdated);
    return () => window.removeEventListener("prereq-updated", onPrereqUpdated);
  }, [refreshPrereqSteps]);

  function openVideoAnalysisGated() {
    if (canVideoAnalysis) {
      if (prereqSteps === null) {
        toast.info("چند لحظه صبر کنید...");
        return;
      }
      const blocker = getSequenceBlocker(prereqSteps, "video_body");
      if (blocker) {
        toast.info(`اول مرحلهٔ ${toPersianDigits(blocker.step)} (${sequenceStepLabel(blocker.type)}) را تکمیل کنید`);
        return;
      }
    }
    setOverlay("videoAnalysis");
  }

  // C4: گیت استاندارد+ (قابلیت جدید progressAnalysis) — به‌جای advanced/ultimate هاردکد
  const canAnalyze = canAccess(user?.planName, "progressAnalysis");
  // v53: پلن حرفه‌ای (ultimate = tier 4) — تب ویدیوها فقط برای این پلن
  const isPro = planTierRank(user?.planName) >= 4;
  // C4: سهمیه ۳ تحلیل در طول اشتراک — از GET همان route
  const [remaining, setRemaining] = useState<number | null>(null);

  // ─── v53: ویدیوها و آزمایش‌های خون از /api/user-media (در ProgressView لود می‌شود) ───
  const videos: { id: string; url: string; createdAt: string; source: "chat" | "video_analysis" }[] =
    Array.isArray(mediaData?.videos) ? mediaData.videos : [];
  const bloodTests: { id: string; mediaUrl: string | null; result: any; createdAt: string }[] =
    Array.isArray(mediaData?.bloodTests) ? mediaData.bloodTests : [];

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
      // دیرکتیو مالک: بدون سقف حجم کاربر-پسند — عکس بی‌صدا به حداکثر ۲۴۰۰px
      // کوچک می‌شود تا جزئیات فرم بدن حفظ شود (سرور هم sharp 1024 دارد)؛
      // اگر کوچک‌سازی شکست خورد، downscaleImage فایل اصلی را برمی‌گرداند.
      const processed = await downscaleImage(file, 2400, 0.85);
      const formData = new FormData();
      formData.append("image", processed);
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

  // v56: برچسب زاویه (جلو/بغل/پشت) از کل UI حذف شد — همهٔ عکس‌ها بدون برچسب در یک گالری مشترک‌اند

  // v53: همهٔ عکس‌ها باهم — مرتب نزولی بر اساس تاریخ (API نزولی می‌دهد؛ دفاعی دوباره مرتب می‌کنیم)
  const sortedPhotos = [...photos].sort(
    (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime()
  );

  // v53: آیتم‌های لایت‌باکس عکس‌ها — برای ناوبری چپ/راست بین همهٔ عکس‌ها
  // v56: بدون برچسب زاویه — فقط تاریخ (درخواست مالک: همهٔ عکس‌ها یکجا بدون برچسب)
  const photoLightboxItems = sortedPhotos.map((p) => ({
    type: "image" as const,
    url: p.imageUrl,
    title: new Date(p.takenAt).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" }),
  }));

  // v53: آیتم‌های لایت‌باکس ویدیوها — چت + آنالیز ویدیو
  const videoLightboxItems = videos.map((v) => ({
    type: "video" as const,
    url: v.url,
    title: `${v.source === "chat" ? "ویدیوی چت" : "آنالیز ویدیو"} — ${new Date(v.createdAt).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" })}`,
  }));

  const faDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fa-IR", { month: "short", day: "numeric" });

  /** خلاصهٔ کوتاه وضعیت یک آزمایش خون از result ذخیره‌شده */
  function bloodSummary(r: any): string {
    if (!r || typeof r !== "object") return "نتیجهٔ تحلیل موجود است";
    const parts: string[] = [];
    if (typeof r.score === "number") parts.push(`امتیاز ${toPersianDigits(r.score)}`);
    if (Array.isArray(r.markers) && r.markers.length > 0) {
      const high = r.markers.filter((m: any) => m?.status === "high").length;
      const low = r.markers.filter((m: any) => m?.status === "low").length;
      parts.push(`${toPersianDigits(r.markers.length)} نشانگر`);
      if (high > 0) parts.push(`${toPersianDigits(high)} بالا`);
      if (low > 0) parts.push(`${toPersianDigits(low)} پایین`);
    } else if (typeof r.overall === "string" && r.overall) {
      return r.overall.length > 60 ? r.overall.slice(0, 60) + "…" : r.overall;
    }
    return parts.length > 0 ? parts.join(" · ") : "نتیجهٔ تحلیل موجود است";
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
          {isPro && videos.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-bold">
              {toPersianDigits(videos.length)} ویدیو
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          🔒 خصوصی
        </span>
      </div>

      {/* توضیحات — v57: بدون اشاره به زوایای جلو/بغل/پشت (همهٔ عکس‌ها یکجا) */}
      <div className="p-3 rounded-xl bg-orange-50/50 border border-orange-100 mb-3">
        <p className="text-[11px] text-slate-600 leading-relaxed">
          📸 <strong>ثبت پیشرفت با عکس:</strong> هر چند وقت یک‌بار از بدن خود عکس بگیرید و اینجا آپلود کنید. همهٔ عکس‌ها یکجا در همین گالری نگه‌داری می‌شوند — تغییرات بدنی که در آینه نمی‌بینید، در عکس‌ها مشخص می‌شوند.
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

      {/* v53: تب عکس‌ها / ویدیوها — فقط پلن حرفه‌ای؛ پلن‌های پایین‌تر فقط عکس‌ها بدون تب */}
      {isPro && (
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 mb-3">
          <button
            onClick={() => setMediaTab("photos")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              mediaTab === "photos" ? "bg-white text-orange-600 shadow-sm" : "text-slate-500"
            }`}
          >
            <Camera className="w-3.5 h-3.5" /> عکس‌ها
          </button>
          <button
            onClick={() => setMediaTab("videos")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              mediaTab === "videos" ? "bg-white text-violet-600 shadow-sm" : "text-slate-500"
            }`}
          >
            <Video className="w-3.5 h-3.5" /> ویدیوها
          </button>
        </div>
      )}

      {mediaTab === "photos" ? (
        <>
          {/* v56: دکمهٔ آپلود — انتخابگر زاویهٔ (جلو/بغل/پشت) حذف شد؛ همهٔ عکس‌ها در یک گالری مشترک بدون برچسب */}
          <div className="mb-3 flex justify-start">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-xl text-white gap-1.5 shrink-0"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {uploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> آپلود...</>
              ) : (
                <><Plus className="w-4 h-4" /> افزودن عکس جدید</>
              )}
            </Button>
          </div>

          {/* v53: کارت جمع‌وجمع «آزمایش خون» بالای گالری — ۳ آزمایش آخر + مشاهدهٔ کامل */}
          {bloodTests.length > 0 && (
            <div className="mb-3 p-3 rounded-xl bg-rose-50/60 border border-rose-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <TestTube className="w-4 h-4 text-rose-500" />
                  <h4 className="text-xs font-bold text-slate-700">آزمایش خون</h4>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 font-bold">
                    {toPersianDigits(bloodTests.length)} تحلیل
                  </span>
                </div>
                <button
                  onClick={() => setOverlay("bloodTest")}
                  className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-0.5 active:scale-95 transition"
                >
                  مشاهدهٔ کامل <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                {bloodTests.slice(0, 3).map((bt) => (
                  <div
                    key={bt.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-white/80 border border-rose-100/70"
                  >
                    <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                      <TestTube className="w-3.5 h-3.5 text-rose-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-700 truncate">
                        {bloodSummary(bt.result)}
                      </p>
                      <p className="text-[9px] text-slate-400">{faDate(bt.createdAt)}</p>
                    </div>
                    <button
                      onClick={() => setOverlay("bloodTest")}
                      className="text-[10px] font-bold text-rose-500 shrink-0 active:scale-95 transition"
                    >
                      جزئیات
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* v53: گالری عکس‌ها — همهٔ زاویه‌ها باهم در گرید واکنش‌گرا (masonry ساده)، جدیدترین اول */}
          {sortedPhotos.length > 0 ? (
            <div className="columns-2 md:columns-3 gap-2">
              {sortedPhotos.map((p, i) => (
                <div key={p.id} className="mb-2 break-inside-avoid relative group">
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    aria-label="بزرگ‌نمایی عکس پیشرفت"
                    className="block w-full cursor-zoom-in"
                  >
                    {/* v15: MediaImage — فایل گم‌شده به‌جای آیکون شکسته، placeholder شکیل نشان می‌دهد */}
                    <MediaImage src={p.imageUrl} alt={p.type} className="w-full aspect-[3/4]" fallbackLabel="فایل حذف شده">
                      {/* v56: بج نوع (جلو/بغل/پشت) حذف شد — همهٔ عکس‌ها بدون برچسب در یک گالری */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                        <p className="text-[8px] text-white/80 text-right">
                          {faDate(p.takenAt)}
                        </p>
                      </div>
                    </MediaImage>
                  </button>
                  <button
                    onClick={() => setDeleteTargetId(p.id)}
                    className="absolute top-1 left-1 w-6 h-6 rounded-full bg-red-500/90 text-white flex items-center justify-center opacity-60 md:opacity-0 md:group-hover:opacity-100 transition hover:bg-red-600 z-20"
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
              <Camera className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-xs">هنوز عکسی ثبت نشده</p>
              <p className="text-[10px] mt-1">با دکمه «افزودن عکس» اولین عکس خود را اضافه کنید</p>
            </div>
          )}
        </>
      ) : (
        /* ─── v53: تب ویدیوها — ویدیوهای کاربر از همه‌جا (چت + آنالیز ویدیو) ─── */
        <div>
          <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
            🎬 همهٔ ویدیوهای شما اینجا جمع شده‌اند — ویدیوهایی که در چت فرستاده‌اید و ویدیوهای آنالیز فرم بدن.
          </p>
          {videos.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {videos.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  aria-label={`پخش ویدیو ${faDate(v.createdAt)}`}
                  className="relative aspect-square rounded-xl overflow-hidden bg-slate-900 cursor-pointer group text-right"
                >
                  <video
                    src={v.url}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition"
                    preload="metadata"
                    muted
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-10 h-10 rounded-full bg-white/25 group-hover:bg-white/40 transition flex items-center justify-center">
                      <Play className="w-5 h-5 text-white fill-white" />
                    </div>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent p-2 pointer-events-none">
                    <p className="text-[9px] font-bold text-white">
                      {v.source === "chat" ? "ویدیوی چت" : "آنالیز ویدیو"}
                    </p>
                    <p className="text-[8px] text-white/80">{faDate(v.createdAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400">
              <Video className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-xs">هنوز ویدیویی نداری</p>
              <p className="text-[10px] mt-1 mb-3">
                ویدیوهای چت و آنالیز ویدیویی بدن اینجا نمایش داده می‌شوند
              </p>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-xs"
                onClick={openVideoAnalysisGated}
              >
                <Video className="w-3.5 h-3.5" /> آنالیز ویدیویی بدن
              </Button>
            </div>
          )}
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

      {/* v53: لایت‌باکس مشترک — عکس‌ها (زوم + ناوبری) یا ویدیوها (پخش) */}
      {lightboxIndex !== null &&
        (mediaTab === "photos"
          ? photoLightboxItems[lightboxIndex] && (
              <MediaLightbox
                items={photoLightboxItems}
                index={lightboxIndex}
                onClose={() => setLightboxIndex(null)}
                onIndexChange={setLightboxIndex}
              />
            )
          : videoLightboxItems[lightboxIndex] && (
              <MediaLightbox
                items={videoLightboxItems}
                index={lightboxIndex}
                onClose={() => setLightboxIndex(null)}
                onIndexChange={setLightboxIndex}
              />
            ))}

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
