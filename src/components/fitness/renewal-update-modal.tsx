"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Scale, Ruler, HeartPulse, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";

// ═══════════════════════════════════════════════════════════════
//  RenewalUpdateModal — v159 (دستور مالک)
//
//  «بعد از خرید تمدید توسط کاربر در همه پلن‌ها یک مدال برای وارد کردن
//   اطلاعات جدید الزامی بیار مثل وزن و اندازه‌های بدنی و هر چیزی که
//   لازمه ... و یک دکمه استفاده از آخرین اطلاعات هم بزار که کاربر اگر
//   نخواست پر کنه اونو بزنه.»
//
//  • الزامی: دکمهٔ بستن ندارد — یکی از دو دکمه باید انتخاب شود.
//  • پیش‌پرشده با آخرین اطلاعات پروفایل (GET همین مسیر).
//  • ثبت موفق → اقتصادی/استاندارد: تولید مجدد برنامه با اطلاعات تازه؛
//    پیشرفته/حرفه‌ای: ادامه به مرحلهٔ پیش‌نیازها (عکس بدن).
//  • احراز دوگانه: توکن تمدید (t) یا سشن عادی.
// ═══════════════════════════════════════════════════════════════

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "کم‌تحرک (کار پشت میز)" },
  { value: "light", label: "کم (۱-۲ روز فعالیت)" },
  { value: "moderate", label: "متوسط (۳-۴ روز فعالیت)" },
  { value: "active", label: "فعال (۵-۶ روز فعالیت)" },
  { value: "very_active", label: "بسیار فعال (هر روز)" },
];

const MEASURE_FIELDS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: "waistMeasurement", label: "دور کمر", min: 40, max: 200 },
  { key: "chestMeasurement", label: "دور سینه", min: 50, max: 200 },
  { key: "hipMeasurement", label: "دور باسن", min: 40, max: 200 },
  { key: "armMeasurement", label: "دور بازو", min: 15, max: 80 },
  { key: "thighMeasurement", label: "دور ران", min: 25, max: 120 },
  { key: "neckMeasurement", label: "دور گردن", min: 20, max: 70 },
  { key: "shoulderMeasurement", label: "دور شانه", min: 60, max: 200 },
  { key: "calfMeasurement", label: "دور ساق", min: 15, max: 80 },
];

interface FormState {
  weight: string;
  targetWeight: string;
  activityLevel: string;
  sleepHours: string;
  injuries: string;
  diseases: string;
  allergies: string;
  specialConditions: string;
  dislikedFoods: string;
  [key: string]: string;
}

export function RenewalUpdateModal({
  token,
  planId,
  onDone,
}: {
  /** توکن تمدید (صفحهٔ /renew) — اگر نباشد سشن عادی استفاده می‌شود */
  token?: string | null;
  /** شناسه پلن خریداری‌شده — برای پیام ادامهٔ مسیر */
  planId?: string | null;
  /** پس از تعیین تکلیف (saved=true یعنی اطلاعات جدید ثبت شد) */
  onDone: (result: { saved: boolean; generationStarted?: boolean; next?: string }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    weight: "", targetWeight: "", activityLevel: "", sleepHours: "",
    injuries: "", diseases: "", allergies: "", specialConditions: "", dislikedFoods: "",
  });
  const measures: Record<string, string> = {};
  const [measureVals, setMeasureVals] = useState<Record<string, string>>(measures);
  const [height, setHeight] = useState<number | null>(null);

  const isAdvanced = planId === "advanced" || planId === "ultimate";

  useEffect(() => {
    (async () => {
      try {
        const q = token ? `?t=${encodeURIComponent(token)}` : "";
        const res = await fetch(`/api/renew/update-metrics${q}`, { cache: "no-store" });
        const d = await res.json();
        if (d?.ok && d.profile) {
          const p = d.profile;
          setForm((f) => ({
            ...f,
            weight: p.weight != null ? String(p.weight) : "",
            targetWeight: p.targetWeight != null ? String(p.targetWeight) : "",
            activityLevel: p.activityLevel || "",
            sleepHours: p.sleepHours != null ? String(p.sleepHours) : "",
            injuries: p.injuries || "",
            diseases: p.diseases || "",
            allergies: p.allergies || "",
            specialConditions: p.specialConditions || "",
            dislikedFoods: p.dislikedFoods || "",
          }));
          const m: Record<string, string> = {};
          for (const f of MEASURE_FIELDS) {
            if (p[f.key] != null) m[f.key] = String(p[f.key]);
          }
          setMeasureVals(m);
          setHeight(p.height ?? null);
        }
      } catch {
        // پیش‌پرکردن اختیاری است — مدال با فرم خالی هم کار می‌کند
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /** اعتبارسنجی سبک — ورودی اشتباه کاربر را با پیام فارسی می‌گیرد */
  function validate(): string | null {
    const w = form.weight.trim() === "" ? null : Number(form.weight);
    if (w != null && (!Number.isFinite(w) || w < 30 || w > 300)) return "وزن فعلی باید بین ۳۰ تا ۳۰۰ کیلوگرم باشد.";
    const tw = form.targetWeight.trim() === "" ? null : Number(form.targetWeight);
    if (tw != null && (!Number.isFinite(tw) || tw < 30 || tw > 300)) return "وزن هدف باید بین ۳۰ تا ۳۰۰ کیلوگرم باشد.";
    for (const f of MEASURE_FIELDS) {
      const v = measureVals[f.key]?.trim() === "" ? null : Number(measureVals[f.key]);
      if (v != null && (!Number.isFinite(v) || v < f.min || v > f.max)) {
        return `${f.label} باید بین ${toPersianDigits(f.min)} تا ${toPersianDigits(f.max)} سانتی‌متر باشد.`;
      }
    }
    return null;
  }

  async function save() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      if (form.weight.trim() !== "") fields.weight = Number(form.weight);
      if (form.targetWeight.trim() !== "") fields.targetWeight = Number(form.targetWeight);
      if (form.activityLevel) fields.activityLevel = form.activityLevel;
      if (form.sleepHours.trim() !== "") fields.sleepHours = Number(form.sleepHours);
      if (form.injuries.trim()) fields.injuries = form.injuries;
      if (form.diseases.trim()) fields.diseases = form.diseases;
      if (form.allergies.trim()) fields.allergies = form.allergies;
      if (form.specialConditions.trim()) fields.specialConditions = form.specialConditions;
      if (form.dislikedFoods.trim()) fields.dislikedFoods = form.dislikedFoods;
      for (const f of MEASURE_FIELDS) {
        if (measureVals[f.key]?.trim() !== "") fields[f.key] = Number(measureVals[f.key]);
      }
      const res = await fetch("/api/renew/update-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(token ? { t: token } : {}), fields }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) throw new Error(d?.error || "ذخیره ناموفق بود.");
      toast.success("اطلاعات جدید شما ثبت شد ✅");
      onDone({ saved: true, generationStarted: !!d.generationStarted, next: d.next });
    } catch (e: any) {
      toast.error(e?.message || "خطا در ذخیره اطلاعات");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="w-full sm:max-w-lg bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* سربرگ برند */}
        <div className="shrink-0 p-5 text-white" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 shrink-0" />
            <h2 className="text-lg font-black">پلن شما تمدید شد — اطلاعات‌ات را به‌روز کن</h2>
          </div>
          <p className="text-xs mt-1.5 leading-relaxed text-orange-50">
            برای اینکه برنامهٔ جدید دقیقاً با بدن امروزِ تو ساخته شود، وزن و اندازه‌های فعلی‌ات را به‌روز کن. هر فیلدی را نخواستی خالی بگذار.
          </p>
        </div>

        {/* بدنه — اسکرول‌شونده */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* وزن */}
              <section className="rounded-2xl border border-border bg-slate-50/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-700 mb-2.5">
                  <Scale className="w-3.5 h-3.5 text-orange-500" />
                  وزن {height ? `(قد: ${toPersianDigits(height)} سانتی‌متر)` : ""}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-slate-500">وزن فعلی (کیلوگرم)</span>
                    <Input
                      type="number" inputMode="decimal" min={30} max={300}
                      value={form.weight}
                      onChange={(e) => set("weight", e.target.value)}
                      className="mt-1 h-9 rounded-xl text-sm font-stat"
                      placeholder="مثلاً ۸۲"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-500">وزن هدف (کیلوگرم)</span>
                    <Input
                      type="number" inputMode="decimal" min={30} max={300}
                      value={form.targetWeight}
                      onChange={(e) => set("targetWeight", e.target.value)}
                      className="mt-1 h-9 rounded-xl text-sm font-stat"
                      placeholder="مثلاً ۷۸"
                    />
                  </label>
                </div>
              </section>

              {/* اندازه‌های بدنی */}
              <section className="rounded-2xl border border-border bg-slate-50/60 p-3">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-700 mb-2.5">
                  <Ruler className="w-3.5 h-3.5 text-orange-500" />
                  اندازه‌های بدنی (سانتی‌متر — اختیاری)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MEASURE_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="text-[10px] text-slate-500">{f.label}</span>
                      <Input
                        type="number" inputMode="decimal" min={f.min} max={f.max}
                        value={measureVals[f.key] ?? ""}
                        onChange={(e) => setMeasureVals((m) => ({ ...m, [f.key]: e.target.value }))}
                        className="mt-1 h-9 rounded-xl text-sm font-stat"
                        placeholder="—"
                      />
                    </label>
                  ))}
                </div>
              </section>

              {/* تغییرات زندگی/سلامت */}
              <section className="rounded-2xl border border-border bg-slate-50/60 p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">
                  <HeartPulse className="w-3.5 h-3.5 text-orange-500" />
                  تغییرات زندگی و سلامت (اختیاری)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-slate-500">سطح فعالیت</span>
                    <select
                      value={form.activityLevel}
                      onChange={(e) => set("activityLevel", e.target.value)}
                      className="mt-1 h-9 w-full rounded-xl border border-border bg-white px-2 text-xs"
                    >
                      <option value="">بدون تغییر</option>
                      {ACTIVITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-500">خواب شبانه (ساعت)</span>
                    <Input
                      type="number" inputMode="numeric" min={4} max={12}
                      value={form.sleepHours}
                      onChange={(e) => set("sleepHours", e.target.value)}
                      className="mt-1 h-9 rounded-xl text-sm font-stat"
                      placeholder="مثلاً ۸"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] text-slate-500">آسیب‌دیدگی (مثل زانو درد، کمر درد)</span>
                  <Input
                    value={form.injuries}
                    onChange={(e) => set("injuries", e.target.value)}
                    className="mt-1 h-9 rounded-xl text-xs"
                    placeholder="اگر آسیب جدیدی داری بنویس — بی‌صدا نمی‌مانیم"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-500">بیماری / شرایط پزشکی</span>
                  <Input
                    value={form.diseases}
                    onChange={(e) => set("diseases", e.target.value)}
                    className="mt-1 h-9 rounded-xl text-xs"
                    placeholder="مثلاً فشار خون، تیروئید و ..."
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-500">حساسیت غذایی</span>
                  <Input
                    value={form.allergies}
                    onChange={(e) => set("allergies", e.target.value)}
                    className="mt-1 h-9 rounded-xl text-xs"
                    placeholder="مثلاً لبنیات، آجیل و ..."
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-500">توضیحات آزاد برای مربی هوشمند</span>
                  <textarea
                    value={form.specialConditions}
                    onChange={(e) => set("specialConditions", e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-border bg-white p-2 text-xs leading-relaxed resize-none"
                    placeholder="هر چیزی که فکر می‌کنی مربی باید بداند..."
                  />
                </label>
              </section>
            </>
          )}
        </div>

        {/* پابرگ — دو دکمه الزامی */}
        <div className="shrink-0 border-t border-border bg-white p-3 flex gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onDone({ saved: false })}
            className="flex-1 h-11 rounded-xl text-xs"
          >
            استفاده از آخرین اطلاعات
          </Button>
          <Button
            disabled={saving || loading}
            onClick={save}
            className="flex-[1.4] h-11 rounded-xl font-bold text-white text-xs"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            ثبت اطلاعات و ادامه
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
