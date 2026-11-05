"use client";

/**
 * محاسبه‌گر 1RM فیتاپ — Task 2-b
 *
 * وزنه (کیلوگرم) + تکرار (۱ تا ۱۲) → حداکثر وزنهٔ یک تکرار (One Rep Max)
 * با هر دو فرمول Epley و Brzycki + نمایش میانگین + جدول درصدی تمرین
 * (۹۵٪ تا ۷۰٪) با کاربرد هر درصد.
 * فقط ماشین‌حساب کلاینت است؛ محتوای متنی صفحه در src/app/1rm/page.tsx SSR است.
 *
 * ⚠ تبدیل اعداد فارسی فقط با toPersianDigits (دترمینیستیک) —
 * هرگز toLocaleString("fa-IR") (خطر hydration mismatch).
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, RotateCcw, Dumbbell, AlertCircle, Weight, TrendingUp, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToolResultCta } from "./tool-result-cta";
import { toPersianDigits } from "@/lib/fitness/types";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

// ─── حرکات اصلی پاورلیفتینگ (برای متن نتیجه) ───
type ExerciseKey = "bench" | "squat" | "deadlift" | "ohp" | "row";
const EXERCISES: { key: ExerciseKey; label: string }[] = [
  { key: "bench", label: "پرس سینه" },
  { key: "squat", label: "اسکوات" },
  { key: "deadlift", label: "ددلیفت" },
  { key: "ohp", label: "پرس سرشانه" },
  { key: "row", label: "زیربغل هالتر" },
];

// ─── جدول درصدی تمرین (چارت استاندارد NSCA بر پایهٔ فرمول‌های 1RM) ───
const PERCENT_ROWS: { pct: number; reps: string; use: string }[] = [
  { pct: 95, reps: "حدود ۲ تکرار", use: "تست قدرت و ست‌های بسیار سنگین" },
  { pct: 90, reps: "حدود ۴ تکرار", use: "ست‌های قدرتی برای افزایش 1RM" },
  { pct: 85, reps: "حدود ۶ تکرار", use: "ترکیب قدرت و حجم — ست‌های سنگین ۵×۵" },
  { pct: 80, reps: "حدود ۸ تکرار", use: "حجم و قدرت (مثلاً ۶ تکرار با ۸۰٪ برای هر ست اصلی)" },
  { pct: 75, reps: "حدود ۱۰ تکرار", use: "حجم‌سازی عضلانی با فرم تمیز" },
  { pct: 70, reps: "حدود ۱۲ تکرار", use: "حجم، پمپاژ خون و استقامت عضلانی" },
];

/** گرد کردن به نزدیک‌ترین ۰.۵ کیلوگرم (وزنهٔ واقعی باشگاه) */
function toHalfKg(n: number): number {
  return Math.round(n * 2) / 2;
}

/** نمایش عدد با اعشار فقط وقتی لازم است — خروجی فارسی دترمینیستیک */
function fmtWeight(n: number): string {
  return toPersianDigits(n % 1 === 0 ? String(n) : n.toFixed(1));
}

type OneRmResult = {
  epley: number;
  brzycki: number;
  average: number;
};

export function OneRmCalculator() {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState(5);
  const [exercise, setExercise] = useState<ExerciseKey>("bench");
  const [result, setResult] = useState<OneRmResult | null>(null);
  const [error, setError] = useState("");

  const weightNum = Number(weight);
  const validWeight = weightNum > 0 && weightNum <= 400;
  const validReps = Number.isInteger(reps) && reps >= 1 && reps <= 12;

  function calculate() {
    if (!validWeight) {
      setResult(null);
      setError("وزنه را درست وارد کنید — بین ۱ تا ۴۰۰ کیلوگرم.");
      return;
    }
    if (!validReps) {
      setResult(null);
      setError("تکرار باید عدد صحیح بین ۱ تا ۱۲ باشد — فرمول‌های 1RM برای تکرارهای بیشتر دقت کافی ندارند.");
      return;
    }
    setError("");
    // Epley: 1RM = w × (1 + r/30)
    const epley = weightNum * (1 + reps / 30);
    // Brzycki: 1RM = w × 36 / (37 − r)
    const brzycki = weightNum * (36 / (37 - reps));
    setResult({
      epley: toHalfKg(epley),
      brzycki: toHalfKg(brzycki),
      average: toHalfKg((epley + brzycki) / 2),
    });
  }

  function reset() {
    setWeight("");
    setReps(5);
    setResult(null);
    setError("");
  }

  const exerciseLabel = EXERCISES.find((e) => e.key === exercise)?.label ?? "";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6" id="one-rm-calculator">
      <Card className="p-4 sm:p-6 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
        {/* هدر ماشین‌حساب */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md shadow-orange-200" style={{ background: goldGradient }}>
            <Dumbbell className="w-6 h-6 text-white" />
          </div>
          <div>
            {/* h2: H1 اصلی صفحه در بخش SSR بالای صفحه است */}
            <h2 className="text-lg sm:text-xl font-black text-slate-900">ماشین‌حساب 1RM فیتاپ</h2>
            <p className="text-xs text-slate-500">وزنه و تکرار خود را وارد کنید — با فرمول‌های Epley و Brzycki</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* حرکت (RadioGroup — برای متن نتیجه) */}
          <div>
            <Label className="text-slate-700 font-bold mb-2 block">حرکت تمرینی</Label>
            <RadioGroup
              value={exercise}
              onValueChange={(v) => setExercise(v as ExerciseKey)}
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              aria-label="انتخاب حرکت تمرینی"
            >
              {EXERCISES.map((ex) => (
                <Label
                  key={ex.key}
                  htmlFor={`ex-${ex.key}`}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-bold cursor-pointer transition min-h-[44px] ${
                    exercise === ex.key ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600 hover:border-orange-200"
                  }`}
                >
                  <RadioGroupItem id={`ex-${ex.key}`} value={ex.key} className="sr-only" />
                  {ex.label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* وزنه */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="rm-weight" className="text-slate-700 flex items-center gap-1.5 font-bold">
                <Weight className="w-4 h-4 text-orange-500" />
                وزنهٔ جابجاشده (کیلوگرم)
              </Label>
              <span className="text-xs font-bold text-slate-400 font-stat">{toPersianDigits(weight || "—")}</span>
            </div>
            <Input
              id="rm-weight"
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="مثلاً ۸۰"
              className="rounded-xl text-center font-stat text-lg"
              min={1}
              max={400}
              aria-describedby="rm-weight-hint"
            />
            <p id="rm-weight-hint" className="text-[11px] text-slate-400 mt-1.5">
              وزنه‌ای که می‌توانید با فرم صحیح برای چند تکرار جابجا کنید — نه وزنهٔ حدакс
            </p>
            {!validWeight && weight !== "" && (
              <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> وزنه باید بین ۱ تا ۴۰۰ کیلوگرم باشد
              </p>
            )}
          </div>

          {/* تکرار — اسلایدر + نمایش */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="rm-reps" className="text-slate-700 flex items-center gap-1.5 font-bold">
                <TrendingUp className="w-4 h-4 text-orange-500" />
                تعداد تکرار انجام‌شده
              </Label>
              <span className="inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-lg bg-orange-50 border border-orange-200 font-stat font-black text-orange-700">
                {toPersianDigits(reps)}
              </span>
            </div>
            <Slider
              id="rm-reps"
              value={[reps]}
              onValueChange={(v) => setReps(v[0])}
              min={1}
              max={12}
              step={1}
              aria-label="تعداد تکرار انجام‌شده"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-stat">
              <span>۱</span>
              <span>۳</span>
              <span>۵</span>
              <span>۷</span>
              <span>۹</span>
              <span>۱۲</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">دقیق‌ترین تخمین: بین ۱ تا ۱۰ تکرار (تکرار ۱ یعنی همین وزنه 1RM شماست)</p>
          </div>

          {/* خطا + دکمه‌ها */}
          {error && (
            <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={calculate}
              className="flex-1 h-12 rounded-xl text-white font-black text-base shadow-md shadow-orange-500/25 hover:scale-[1.01] transition-all"
              style={{ background: goldGradient }}
            >
              <Calculator className="w-5 h-5 ml-1" />
              محاسبه 1RM
            </Button>
            <Button
              onClick={reset}
              variant="outline"
              className="h-12 px-4 rounded-xl border-2 text-slate-600 hover:bg-slate-50 min-h-[44px]"
              style={{ borderColor: "#fed7aa" }}
              aria-label="پاک کردن ورودی‌ها"
            >
              <RotateCcw className="w-4 h-4" />
              ریست
            </Button>
          </div>
        </div>

        {/* ─── نتیجه ─── */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="mt-6"
            >
              {/* کارت میانگین — عدد اصلی */}
              <div className="rounded-2xl p-[1.5px] shadow-lg shadow-orange-500/15" style={{ background: goldGradient }}>
                <div className="rounded-[calc(1rem-1px)] bg-white p-4 sm:p-5 text-center">
                  <p className="text-xs text-slate-500 mb-1">حداکثر وزنهٔ یک تکرار ({exerciseLabel}) شما تقریباً</p>
                  <p className="text-5xl font-black font-stat text-slate-900 leading-none">
                    {fmtWeight(result.average)}
                    <span className="text-base font-bold text-slate-400 mr-2">کیلوگرم</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">میانگین دو فرمول علمی Epley و Brzycki</p>
                </div>
              </div>

              {/* دو فرمول */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border-2 border-slate-100 bg-slate-50/60 p-3 text-center">
                  <p className="text-[11px] font-bold text-slate-500 mb-1">فرمول Epley</p>
                  <p className="text-2xl font-black font-stat text-slate-800">{fmtWeight(result.epley)}</p>
                  <p className="text-[10px] text-slate-400 font-stat mt-0.5">w × (1 + r/30)</p>
                </div>
                <div className="rounded-xl border-2 border-slate-100 bg-slate-50/60 p-3 text-center">
                  <p className="text-[11px] font-bold text-slate-500 mb-1">فرمول Brzycki</p>
                  <p className="text-2xl font-black font-stat text-slate-800">{fmtWeight(result.brzycki)}</p>
                  <p className="text-[10px] text-slate-400 font-stat mt-0.5">w × 36 / (37 − r)</p>
                </div>
              </div>

              {/* جدول درصدی */}
              <div className="mt-4 rounded-2xl border-2 border-slate-100 overflow-hidden">
                <table className="w-full text-xs sm:text-sm">
                  <caption className="sr-only">جدول درصدی تمرین بر اساس 1RM محاسبه‌شده</caption>
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      <th scope="col" className="text-right font-bold px-3 py-2">درصد 1RM</th>
                      <th scope="col" className="text-right font-bold px-3 py-2">وزنه (کیلوگرم)</th>
                      <th scope="col" className="text-right font-bold px-3 py-2">تکرار تقریبی</th>
                      <th scope="col" className="text-right font-bold px-3 py-2 hidden md:table-cell">کاربرد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERCENT_ROWS.map((row) => (
                      <tr key={row.pct} className="border-t border-slate-100">
                        <td className="px-3 py-2.5">
                          <span
                            className="inline-flex items-center justify-center min-w-11 px-2 py-1 rounded-lg font-black font-stat text-white"
                            style={{ background: row.pct >= 85 ? "#ea580c" : row.pct >= 75 ? "#f59e0b" : "#10b981" }}
                          >
                            {toPersianDigits(row.pct)}٪
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-stat font-black text-slate-900">{fmtWeight(toHalfKg((result.average * row.pct) / 100))}</td>
                        <td className="px-3 py-2.5 text-slate-600 font-bold">{row.reps}</td>
                        <td className="px-3 py-2.5 text-slate-500 hidden md:table-cell leading-relaxed">{row.use}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="md:hidden text-[11px] text-slate-400 mt-2">ستون «کاربرد» هر درصد در دسکتاپ نمایش داده می‌شود.</p>

              {/* CTA بعد از نتیجه — دقیقاً الگوی /tdee (Task 5-e) */}
              <div className="mt-5">
                <ToolResultCta tool="tdee" />
              </div>

              {/* قدم بعدی */}
              <a
                href="/macro"
                className="mt-3 flex items-center justify-between gap-2 rounded-xl border-2 border-amber-200 bg-amber-50/60 px-4 py-3 text-sm font-bold text-amber-800 hover:bg-amber-100 transition min-h-[44px]"
              >
                <span>قدم بعدی: ماکروهای روزانه (پروتئین، کربوهیدرات، چربی) خود را محاسبه کنید</span>
                <ArrowLeft className="w-4 h-4 shrink-0" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
