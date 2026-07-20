"use client";

import { useEffect, useState, useRef } from "react";
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
} from "lucide-react";
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
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits } from "@/lib/fitness/types";
import { toast } from "sonner";
import { CheckupSection } from "./checkup-section";

interface ProgressData {
  weights: { id: string; weight: number; note: string; loggedAt: string }[];
  photos: { id: string; imageUrl: string; type: string; note: string; takenAt: string }[];
  startWeight: number | null;
  targetWeight: number | null;
}

export function ProgressView() {
  const { bodyMeasurements, setBodyMeasurements, user } = useAppStore();
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [checkups, setCheckups] = useState<any[]>([]);
  const [mediaData, setMediaData] = useState<any>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [progressRes, checkupRes, mediaRes] = await Promise.all([
        fetch("/api/progress"),
        fetch("/api/checkup"),
        fetch("/api/user-media").catch(() => null),
      ]);
      const d = await progressRes.json();
      setData(d);
      try {
        const c = await checkupRes.json();
        setCheckups(c.checkups || []);
      } catch {}
      if (mediaRes) {
        try { setMediaData(await mediaRes.json()); } catch {}
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  const currentWeight = data?.weights[data.weights.length - 1]?.weight;
  const startWeight = data?.startWeight;
  const targetWeight = data?.targetWeight;
  const totalLost = startWeight && currentWeight ? (startWeight - currentWeight) : 0;

  // آخرین چکاپ برای نمایش درصد چربی و عضله
  const lastCheckup = checkups[0];
  const bodyFatPercent = lastCheckup?.bodyFatPercent;
  const leanBodyMass = lastCheckup?.leanBodyMass;
  const bodyScore = lastCheckup?.aiAnalysis ? (typeof lastCheckup.aiAnalysis === "string" ? JSON.parse(lastCheckup.aiAnalysis) : lastCheckup.aiAnalysis)?.bodyScore : null;

  // داده‌های نمودار
  const chartData = (data?.weights || []).map((w) => ({
    date: new Date(w.loggedAt).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }),
    وزن: w.weight,
  }));

  return (
    <div className="px-4 py-4 space-y-4 max-w-md mx-auto">
      <div>
        <h2 className="text-2xl font-black">پیشرفت من</h2>
        <p className="text-sm text-muted-foreground">تحلیل جامع پیشرفت شما توسط فیتاپ هوشمند</p>
      </div>

      {/* ═══ چکاپ دوره‌ای — بالاترین قسمت ═══ */}
      <CheckupSection />

      {/* ═══ تحلیل جامع پیشرفت ═══ */}
      <Card className="p-5 border-2 border-orange-100 bg-gradient-to-br from-orange-50/50 to-white">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <h3 className="font-bold text-sm">تحلیل جامع فیتاپ هوشمند</h3>
        </div>

        {/* اگر چکاپ دارد */}
        {lastCheckup ? (
          <div className="space-y-4">
            {/* Body Score */}
            {bodyScore != null && (
              <div className="text-center py-3 rounded-2xl bg-white border border-orange-100">
                <p className="text-[11px] text-slate-500 mb-1">امتیاز بدن شما</p>
                <p className="text-4xl font-black" style={{ color: bodyScore >= 70 ? "#10b981" : bodyScore >= 50 ? "#f59e0b" : "#ef4444" }}>
                  {toPersianDigits(bodyScore)}
                  <span className="text-lg text-slate-400">/۱۰۰</span>
                </p>
              </div>
            )}

            {/* آمار کلیدی */}
            <div className="grid grid-cols-2 gap-2">
              {bodyFatPercent != null && (
                <MetricCard icon={Activity} label="درصد چربی بدن" value={`${toPersianDigits(bodyFatPercent)}٪`} color="text-rose-500" bg="bg-rose-50" />
              )}
              {leanBodyMass != null && (
                <MetricCard icon={Zap} label="وزن عضلانی" value={`${toPersianDigits(leanBodyMass)} kg`} color="text-emerald-500" bg="bg-emerald-50" />
              )}
              {currentWeight && (
                <MetricCard icon={Scale} label="وزن فعلی" value={`${toPersianDigits(currentWeight)} kg`} color="text-orange-500" bg="bg-orange-50" />
              )}
              {totalLost > 0 && (
                <MetricCard icon={TrendingDown} label="کاهش وزن" value={`${toPersianDigits(totalLost.toFixed(1))} kg`} color="text-cyan-500" bg="bg-cyan-50" />
              )}
            </div>

            {/* تحلیل AI */}
            {lastCheckup.aiAnalysis && (
              <div className="p-3 rounded-xl bg-white border border-orange-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className="w-3.5 h-3.5 text-orange-500" />
                  <p className="text-xs font-bold text-orange-600">تحلیل هوش مصنوعی</p>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {typeof lastCheckup.aiAnalysis === "string"
                    ? (JSON.parse(lastCheckup.aiAnalysis)?.analysis || "")
                    : (lastCheckup.aiAnalysis?.analysis || "")}
                </p>
              </div>
            )}

            {/* توصیه‌ها */}
            {lastCheckup.aiAnalysis && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <Award className="w-3.5 h-3.5 text-amber-500" />
                  <p className="text-xs font-bold text-amber-600">توصیه‌های فیتاپ</p>
                </div>
                {(() => {
                  const analysis = typeof lastCheckup.aiAnalysis === "string"
                    ? JSON.parse(lastCheckup.aiAnalysis)
                    : lastCheckup.aiAnalysis;
                  const recs = analysis?.recommendations || [];
                  return recs.length > 0 ? (
                    <ul className="space-y-1">
                      {recs.slice(0, 3).map((r: string, i: number) => (
                        <li key={i} className="text-xs text-slate-600 flex gap-1.5">
                          <span className="text-amber-500 shrink-0">•</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6">
            <Activity className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-500">
              پس از انجام اولین چکاپ، تحلیل جامع پیشرفت شما در اینجا نمایش داده می‌شود
            </p>
          </div>
        )}
      </Card>

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

      {/* ═══ نمودار وزن ═══ */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">نمودار وزن</h3>
          <TrendingDown className="w-4 h-4 text-primary" />
        </div>
        {loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : chartData.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
            <Scale className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">هنوز وزنی ثبت نشده</p>
            <p className="text-[11px] mt-1">وزن شما در چکاپ‌ها ثبت می‌شود</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted/30" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "currentColor" }} className="text-muted-foreground" reversed />
              <YAxis tick={{ fontSize: 10, fill: "currentColor" }} className="text-muted-foreground" orientation="right" domain={["dataMin - 2", "dataMax + 2"]} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: "12px" }} labelStyle={{ color: "currentColor" }} />
              {targetWeight && <ReferenceLine y={targetWeight} stroke="#a855f7" strokeDasharray="5 5" label={{ value: "هدف", fontSize: 10, fill: "#a855f7" }} />}
              <Line type="monotone" dataKey="وزن" stroke="#F4C542" strokeWidth={3} dot={{ fill: "#F4C542", r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
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
            onSave={(m) => {
              setBodyMeasurements(m);
              setShowMeasurements(false);
              toast.success("اندازه‌های بدن ثبت شد");
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

// ═══ گالری پیشرفت — با آپلود عکس + تحلیل پیشرفت بدن ═══
function ProgressGallery({ photos, onRefresh, user }: {
  photos: { id: string; imageUrl: string; type: string; note: string; takenAt: string }[];
  onRefresh: () => void;
  user: any;
}) {
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<"front" | "side" | "back">("front");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAnalyze = user?.planName === "advanced" || user?.planName === "ultimate";

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
    if (!confirm("این عکس حذف شود؟")) return;
    try {
      const res = await fetch(`/api/progress/photo?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("خطا در حذف");
      toast.success("عکس حذف شد");
      onRefresh();
    } catch {
      toast.error("خطا در حذف");
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
        body: JSON.stringify({ photos: photos.slice(0, 6).map(p => ({ imageUrl: p.imageUrl, type: p.type, takenAt: p.takenAt })) }),
      });
      if (!res.ok) throw new Error("خطا در تحلیل");
      const data = await res.json();
      setAnalysisResult(data.analysis || "تحلیلی دریافت نشد.");
    } catch {
      toast.error("خطا در تحلیل پیشرفت");
    } finally {
      setAnalyzing(false);
    }
  }

  const typeLabel = (t: string) => t === "front" ? "جلو" : t === "side" ? "بغل" : t === "back" ? "پشت" : t;

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
        {canAnalyze && (
          <p className="text-[11px] text-emerald-600 mt-1.5 leading-relaxed">
            ✨ <strong>تحلیل هوشمند پیشرفت:</strong> با پلن {user?.planName === "ultimate" ? "حرفه‌ای" : "پیشرفته"} می‌توانید پیشرفت بدن خود را به‌صورت هوشمند تحلیل کنید. فیتاپ عکس‌های شما را مقایسه می‌کند و نقاط پیشرفت و بهبود را مشخص می‌کند.
          </p>
        )}
      </div>

      {/* انتخاب نوع عکس + دکمه آپلود */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 flex gap-1 p-1 rounded-xl bg-slate-100">
          {(["front", "side", "back"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                selectedType === t
                  ? "bg-white text-orange-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              {typeLabel(t)}
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

      {/* گالری عکس‌ها */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="aspect-square rounded-xl overflow-hidden bg-slate-100 relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.type} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                <p className="text-[9px] text-white font-bold">{typeLabel(p.type)}</p>
                <p className="text-[8px] text-white/80">
                  {new Date(p.takenAt).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })}
                </p>
              </div>
              <button
                onClick={() => handleDelete(p.id)}
                className="absolute top-1 left-1 w-6 h-6 rounded-full bg-red-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
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

      {/* دکمه تحلیل پیشرفت — فقط پلن پیشرفته/حرفه‌ای */}
      {canAnalyze && photos.length >= 2 && (
        <div className="mt-3">
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
    </Card>
  );
}

// ─── کامپوننت‌های کمکی ───

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
