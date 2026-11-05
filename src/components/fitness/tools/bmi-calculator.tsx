"use client";

/**
 * محاسبه‌گر BMI فیتاپ — Task 2-b
 *
 * قد (سانتی‌متر) + وزن (کیلوگرم) → شاخص توده بدنی با یک رقم اعشار،
 * دسته‌بندی رنگی (کم‌وزن / نرمال / اضافه‌وزن / چاقی)، گیج بصری،
 * بازهٔ وزن ایده‌آل و جدول بازه‌ها — فقط ماشین‌حساب کلاینت است؛
 * محتوای متنی صفحه در src/app/bmi/page.tsx به‌صورت SSR رندر می‌شود.
 *
 * ⚠ تبدیل اعداد فارسی فقط با toPersianDigits (دترمینیستیک) —
 * هرگز toLocaleString("fa-IR") (خطر hydration mismatch).
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, RotateCcw, Ruler, Weight, AlertCircle, Scale, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ToolResultCta } from "./tool-result-cta";
import { toPersianDigits } from "@/lib/fitness/types";

// ─── دسته‌بندی‌های BMI (استاندارد WHO + نکتهٔ جمعیت‌های آسیایی) ───
type BmiCat = {
  key: "under" | "normal" | "over" | "obese";
  label: string;
  color: string;
  bg: string;
  border: string;
  desc: string;
};

function bmiCategory(bmi: number): BmiCat {
  if (bmi < 18.5)
    return {
      key: "under",
      label: "کم‌وزن",
      color: "#b45309",
      bg: "#fef3c7",
      border: "#fcd34d",
      desc: "وزن شما کمتر از بازهٔ سالم است؛ دریافت کالری و پروتئین کافی برای جلوگیری از تحلیل عضلانی و افت ایمنی بدن اهمیت دارد.",
    };
  if (bmi < 25)
    return {
      key: "normal",
      label: "وزن نرمال",
      color: "#047857",
      bg: "#d1fae5",
      border: "#6ee7b7",
      desc: "وزن شما در بازهٔ سالم است؛ با تمرین قدرتی و تغذیهٔ درست همین وضعیت و ترکیب بدن را حفظ کنید.",
    };
  if (bmi < 30)
    return {
      key: "over",
      label: "اضافه‌وزن",
      color: "#c2410c",
      bg: "#ffedd5",
      border: "#fdba74",
      desc: "کاهش ملایم وزن (حدود ۵ تا ۱۰ درصد وزن فعلی) ریسک‌های متابولیک را به‌طور معنادار کم می‌کند؛ از کسری کالری کنترل‌شده شروع کنید.",
    };
  return {
    key: "obese",
    label: "چاقی",
    color: "#b91c1c",
    bg: "#fee2e2",
    border: "#fca5a5",
    desc: "با کسری کالری پایدار و تمرین منظم وزن را به بازهٔ سالم برگردانید؛ برای BMI بالای ۳۰ مشورت با پزشک یا متخصص تغذیه توصیه می‌شود.",
  };
}

// بازه‌های جدول — هم در نتیجهٔ ماشین‌حساب و هم هم‌متن با جدول SSR صفحه
const BMI_TABLE: { range: string; label: string; color: string; min: number; max: number }[] = [
  { range: "کمتر از ۱۸.۵", label: "کم‌وزن", color: "#b45309", min: 0, max: 18.5 },
  { range: "۱۸.۵ تا ۲۴.۹", label: "وزن نرمال", color: "#047857", min: 18.5, max: 25 },
  { range: "۲۵ تا ۲۹.۹", label: "اضافه‌وزن", color: "#c2410c", min: 25, max: 30 },
  { range: "۳۰ به بالا", label: "چاقی", color: "#b91c1c", min: 30, max: Infinity },
];

// گیج BMI: بازهٔ ۱۴ تا ۴۰ نگاشت به ۰ تا ۱۰۰٪ (مرزها: ۱۸.۵ / ۲۵ / ۳۰)
const GAUGE_MIN = 14;
const GAUGE_MAX = 40;
const gaugePct = (bmi: number) => ((Math.min(Math.max(bmi, GAUGE_MIN), GAUGE_MAX) - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100;
const GAUGE_BG =
  "linear-gradient(to left, #fbbf24 0%, #fbbf24 17.3%, #10b981 17.3%, #10b981 42.3%, #f97316 42.3%, #f97316 61.5%, #ef4444 61.5%, #ef4444 100%)";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

type BmiResult = { bmi: number; cat: BmiCat; idealMin: number; idealMax: number };

export function BmiCalculator() {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [result, setResult] = useState<BmiResult | null>(null);
  const [error, setError] = useState("");

  const heightNum = Number(height);
  const weightNum = Number(weight);
  const validHeight = heightNum >= 100 && heightNum <= 250;
  const validWeight = weightNum >= 30 && weightNum <= 300;

  // اسلایدرها همیشه مقدار عددی معتبر دارند (کلمپ‌شده) و با Input دوطرفه همگام‌اند
  const heightSlider = validHeight ? Math.round(heightNum) : 170;
  const weightSlider = validWeight ? Math.round(weightNum) : 70;

  function calculate() {
    if (!validHeight || !validWeight) {
      setResult(null);
      setError("لطفاً قد و وزن معتبر وارد کنید — قد بین ۱۰۰ تا ۲۵۰ سانتی‌متر و وزن بین ۳۰ تا ۳۰۰ کیلوگرم.");
      return;
    }
    setError("");
    const h = heightNum / 100; // متر
    const bmi = weightNum / (h * h);
    const rounded = Math.round(bmi * 10) / 10;
    setResult({
      bmi: rounded,
      cat: bmiCategory(rounded),
      idealMin: Math.round(18.5 * h * h),
      idealMax: Math.round(24.9 * h * h),
    });
  }

  function reset() {
    setHeight("");
    setWeight("");
    setResult(null);
    setError("");
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6" id="bmi-calculator">
      <Card className="p-4 sm:p-6 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
        {/* هدر ماشین‌حساب */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md shadow-orange-200" style={{ background: goldGradient }}>
            <Scale className="w-6 h-6 text-white" />
          </div>
          <div>
            {/* h2: H1 اصلی صفحه در بخش SSR بالای صفحه است */}
            <h2 className="text-lg sm:text-xl font-black text-slate-900">ماشین‌حساب BMI فیتاپ</h2>
            <p className="text-xs text-slate-500">قد و وزن را وارد کنید — نتیجه فوری و رایگان</p>
          </div>
        </div>

        {/* ─── فرم ورودی ─── */}
        <div className="space-y-5">
          {/* قد */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="bmi-height" className="text-slate-700 flex items-center gap-1.5 font-bold">
                <Ruler className="w-4 h-4 text-orange-500" />
                قد (سانتی‌متر)
              </Label>
              <span className="text-xs font-bold text-slate-400 font-stat">{toPersianDigits(height || "—")}</span>
            </div>
            <Input
              id="bmi-height"
              type="number"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="مثلاً ۱۷۵"
              className="rounded-xl text-center font-stat text-lg"
              min={100}
              max={250}
              aria-describedby="bmi-height-range"
            />
            <div id="bmi-height-range" className="sr-only">قد بین ۱۰۰ تا ۲۵۰ سانتی‌متر</div>
            <div className="mt-3 flex items-center gap-3">
              <Slider
                value={[heightSlider]}
                onValueChange={(v) => setHeight(String(v[0]))}
                min={100}
                max={250}
                step={1}
                aria-label="انتخاب قد با اسلایدر"
              />
              <span className="text-[11px] text-slate-400 shrink-0 font-stat">۱۰۰–۲۵۰</span>
            </div>
            {!validHeight && height !== "" && (
              <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> قد باید بین ۱۰۰ تا ۲۵۰ سانتی‌متر باشد
              </p>
            )}
          </div>

          {/* وزن */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="bmi-weight" className="text-slate-700 flex items-center gap-1.5 font-bold">
                <Weight className="w-4 h-4 text-orange-500" />
                وزن (کیلوگرم)
              </Label>
              <span className="text-xs font-bold text-slate-400 font-stat">{toPersianDigits(weight || "—")}</span>
            </div>
            <Input
              id="bmi-weight"
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="مثلاً ۷۰"
              className="rounded-xl text-center font-stat text-lg"
              min={30}
              max={300}
              aria-describedby="bmi-weight-range"
            />
            <div id="bmi-weight-range" className="sr-only">وزن بین ۳۰ تا ۳۰۰ کیلوگرم</div>
            <div className="mt-3 flex items-center gap-3">
              <Slider
                value={[weightSlider]}
                onValueChange={(v) => setWeight(String(v[0]))}
                min={30}
                max={300}
                step={1}
                aria-label="انتخاب وزن با اسلایدر"
              />
              <span className="text-[11px] text-slate-400 shrink-0 font-stat">۳۰–۳۰۰</span>
            </div>
            {!validWeight && weight !== "" && (
              <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> وزن باید بین ۳۰ تا ۳۰۰ کیلوگرم باشد
              </p>
            )}
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
              محاسبه BMI
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
              <div className="rounded-2xl border-2 p-4 sm:p-5" style={{ borderColor: result.cat.border, background: `${result.cat.bg}40` }}>
                {/* عدد BMI + دسته */}
                <div className="flex items-end justify-between gap-3 mb-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">شاخص توده بدنی شما</p>
                    <p className="text-5xl font-black font-stat text-slate-900 leading-none">
                      {toPersianDigits(result.bmi.toFixed(1))}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">kg/m² — وزن تقسیم بر مجذور قد</p>
                  </div>
                  <span
                    className="px-4 py-2 rounded-full text-sm font-black shadow-sm"
                    style={{ background: result.cat.bg, color: result.cat.color, border: `1px solid ${result.cat.border}` }}
                  >
                    {result.cat.label}
                  </span>
                </div>

                {/* گیج رنگی */}
                <div className="relative h-3 rounded-full overflow-hidden" style={{ background: GAUGE_BG }}>
                  <motion.div
                    initial={{ left: "0%" }}
                    animate={{ left: `${gaugePct(result.bmi)}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[18px] h-[18px] rounded-full bg-white border-2 border-slate-800 shadow-md"
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-2">
                  <span>کم‌وزن &lt; ۱۸.۵</span>
                  <span>نرمال ۱۸.۵–۲۴.۹</span>
                  <span>اضافه‌وزن ۲۵–۲۹.۹</span>
                  <span>چاقی ≥ ۳۰</span>
                </div>

                {/* توضیح دسته */}
                <p className="mt-3 text-xs sm:text-sm leading-relaxed" style={{ color: result.cat.color }}>
                  {result.cat.desc}
                </p>

                {/* وزن ایده‌آل */}
                <div className="mt-4 grid sm:grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white/80 border p-3" style={{ borderColor: result.cat.border }}>
                    <p className="text-[11px] text-slate-500 mb-0.5">بازهٔ وزن ایده‌آل برای قد {toPersianDigits(Math.round(heightNum))} سانتی‌متر</p>
                    <p className="text-lg font-black font-stat text-slate-900">
                      {toPersianDigits(result.idealMin)} تا {toPersianDigits(result.idealMax)}{" "}
                      <span className="text-xs font-bold text-slate-400">کیلوگرم</span>
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/80 border p-3" style={{ borderColor: result.cat.border }}>
                    <p className="text-[11px] text-slate-500 mb-0.5">نکتهٔ جمعیت‌های آسیایی (WHO)</p>
                    <p className="text-xs font-bold text-slate-700 leading-relaxed">
                      مرز نرمال در جمعیت‌های آسیایی ۲۳ است؛ BMI بین ۲۳ تا ۲۴.۹ ریسک افزایش‌یافته حساب می‌شود.
                    </p>
                  </div>
                </div>
              </div>

              {/* جدول بازه‌ها با هایلایت ردیف کاربر */}
              <div className="mt-4 rounded-2xl border-2 border-slate-100 overflow-hidden">
                <table className="w-full text-xs sm:text-sm">
                  <caption className="sr-only">جدول بازه‌های دسته‌بندی BMI بر اساس استاندارد WHO</caption>
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      <th scope="col" className="text-right font-bold px-3 py-2">بازهٔ BMI</th>
                      <th scope="col" className="text-right font-bold px-3 py-2">دسته‌بندی</th>
                      <th scope="col" className="text-right font-bold px-3 py-2 hidden sm:table-cell">وضعیت شما</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BMI_TABLE.map((row) => {
                      const mine = result.bmi >= row.min && result.bmi < row.max;
                      return (
                        <tr key={row.label} className={`border-t border-slate-100 ${mine ? "bg-amber-50/60" : ""}`}>
                          <td className="px-3 py-2.5 font-stat font-bold text-slate-700">{row.range}</td>
                          <td className="px-3 py-2.5 font-bold" style={{ color: row.color }}>{row.label}</td>
                          <td className="px-3 py-2.5 hidden sm:table-cell">
                            {mine ? (
                              <span className="inline-flex items-center gap-1 text-amber-700 font-black">
                                ★ همین بازه
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* CTA بعد از نتیجه — دقیقاً الگوی /tdee (Task 5-e) */}
              <div className="mt-5">
                <ToolResultCta tool="tdee" />
              </div>

              {/* قدم بعدی: محاسبه کالری */}
              <a
                href="/tdee"
                className="mt-3 flex items-center justify-between gap-2 rounded-xl border-2 border-amber-200 bg-amber-50/60 px-4 py-3 text-sm font-bold text-amber-800 hover:bg-amber-100 transition min-h-[44px]"
              >
                <span>قدم بعدی: کالری روزانه (TDEE) و ماکروهای خود را هم محاسبه کنید</span>
                <ArrowLeft className="w-4 h-4 shrink-0" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
