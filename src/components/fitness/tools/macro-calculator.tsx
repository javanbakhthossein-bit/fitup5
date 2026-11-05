"use client";

/**
 * محاسبه‌گر ماکروهای روزانه فیتاپ — Task 2-b
 *
 * قد/وزن/سن/جنسیت/سطح فعالیت/هدف → BMR (فرمول Mifflin-St Jeor) →
 * TDEE → کالری هدف → ماکرو به گرم:
 *   پروتئین ۱.۶ تا ۲.۲ گرم بر کیلوگرم بسته به هدف، چربی ۲۵٪ کالری،
 *   باقی کالری کربوهیدرات.
 * فقط ماشین‌حساب کلاینت است؛ محتوای متنی صفحه در src/app/macro/page.tsx SSR است.
 *
 * ⚠ تبدیل اعداد فارسی فقط با toPersianDigits (دترمینیستیک) —
 * هرگز toLocaleString("fa-IR") (خطر hydration mismatch).
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, RotateCcw, AlertCircle, Flame, Beef, Wheat, Droplet, Activity, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToolResultCta } from "./tool-result-cta";
import { toPersianDigits } from "@/lib/fitness/types";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

type Gender = "male" | "female";
type ActivityKey = "sedentary" | "light" | "moderate" | "active" | "athlete";
type GoalKey = "cut" | "maintain" | "bulk";

// ضریب فعالیت (TDEE = BMR × ضریب)
const ACTIVITY: { key: ActivityKey; label: string; hint: string; factor: number }[] = [
  { key: "sedentary", label: "کم‌تحرک", hint: "کار پشت میز، بدون ورزش منظم", factor: 1.2 },
  { key: "light", label: "فعالیت سبک", hint: "۱ تا ۳ جلسه ورزش در هفته", factor: 1.375 },
  { key: "moderate", label: "فعالیت متوسط", hint: "۳ تا ۵ جلسه ورزش در هفته", factor: 1.55 },
  { key: "active", label: "فعالیت زیاد", hint: "۶ تا ۷ جلسه ورزش در هفته", factor: 1.725 },
  { key: "athlete", label: "فعالیت خیلی زیاد", hint: "ورزش حرفه‌ای یا کار فیزیکی سنگین", factor: 1.9 },
];

// هدف: ضریب کالری + پروتئین بر کیلوگرم وزن (بازهٔ علمی ۱.۶ تا ۲.۲)
const GOALS: { key: GoalKey; label: string; factor: number; proteinPerKg: number; note: string }[] = [
  { key: "cut", label: "کاهش وزن (کات)", factor: 0.8, proteinPerKg: 2.2, note: "کسری ۲۰٪ کالری + پروتئین بالا برای حفظ عضله" },
  { key: "maintain", label: "نگهداری", factor: 1, proteinPerKg: 1.8, note: "تثبیت وزن و ترکیب بدن فعلی" },
  { key: "bulk", label: "افزایش حجم", factor: 1.15, proteinPerKg: 1.6, note: "مازاد ۱۵٪ کالری برای رشد عضلانی کنترل‌شده" },
];

type MacroResult = {
  bmr: number;
  tdee: number;
};

export function MacroCalculator() {
  const [gender, setGender] = useState<Gender>("male");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<ActivityKey>("moderate");
  const [goal, setGoal] = useState<GoalKey>("maintain");
  const [result, setResult] = useState<MacroResult | null>(null);
  const [error, setError] = useState("");

  const ageNum = Number(age);
  const heightNum = Number(height);
  const weightNum = Number(weight);
  const validAge = ageNum >= 10 && ageNum <= 100;
  const validHeight = heightNum >= 100 && heightNum <= 250;
  const validWeight = weightNum >= 30 && weightNum <= 300;

  const activityFactor = ACTIVITY.find((a) => a.key === activity)?.factor ?? 1.55;
  const goalInfo = GOALS.find((g) => g.key === goal) ?? GOALS[1];

  function calculate() {
    if (!validAge || !validHeight || !validWeight) {
      setResult(null);
      setError("لطفاً همهٔ فیلدها را معتبر وارد کنید — سن ۱۰ تا ۱۰۰ سال، قد ۱۰۰ تا ۲۵۰ سانتی‌متر و وزن ۳۰ تا ۳۰۰ کیلوگرم.");
      return;
    }
    setError("");
    // BMR — فرمول Mifflin-St Jeor
    const bmr = Math.round(10 * weightNum + 6.25 * heightNum - 5 * ageNum + (gender === "male" ? 5 : -161));
    const tdee = Math.round(bmr * activityFactor);
    setResult({ bmr, tdee });
  }

  // کالری هدف و ماکروها «زنده» از روی هدف/وزن فعلی محاسبه می‌شوند —
  // با تغییر تب هدف بعد از محاسبه، نتیجه فوری به‌روز می‌شود (الگوی داشبورد /tdee)
  const derived = (() => {
    if (!result) return null;
    const targetCal = Math.round(result.tdee * goalInfo.factor);
    // ماکروها: پروتئین بر اساس وزن، چربی ۲۵٪ کالری، بقیه کربوهیدرات
    const proteinG = Math.round(weightNum * goalInfo.proteinPerKg);
    const fatG = Math.round((targetCal * 0.25) / 9);
    const carbsG = Math.max(0, Math.round((targetCal - proteinG * 4 - fatG * 9) / 4));
    return { targetCal, proteinG, carbsG, fatG };
  })();

  function reset() {
    setAge("");
    setHeight("");
    setWeight("");
    setGender("male");
    setActivity("moderate");
    setGoal("maintain");
    setResult(null);
    setError("");
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6" id="macro-calculator">
      <Card className="p-4 sm:p-6 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
        {/* هدر ماشین‌حساب */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md shadow-orange-200" style={{ background: goldGradient }}>
            <Beef className="w-6 h-6 text-white" />
          </div>
          <div>
            {/* h2: H1 اصلی صفحه در بخش SSR بالای صفحه است */}
            <h2 className="text-lg sm:text-xl font-black text-slate-900">ماشین‌حساب ماکرو فیتاپ</h2>
            <p className="text-xs text-slate-500">کالری هدف، پروتئین، کربوهیدرات و چربی روزانه — با فرمول Mifflin-St Jeor</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* جنسیت */}
          <div>
            <Label className="text-slate-700 font-bold mb-2 block">جنسیت</Label>
            <RadioGroup
              value={gender}
              onValueChange={(v) => setGender(v as Gender)}
              className="grid grid-cols-2 gap-2"
              aria-label="انتخاب جنسیت"
            >
              {([["male", "👨 آقا"], ["female", "👩 خانم"]] as const).map(([g, label]) => (
                <Label
                  key={g}
                  htmlFor={`gender-${g}`}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-bold cursor-pointer transition min-h-[44px] ${
                    gender === g ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-600 hover:border-orange-200"
                  }`}
                >
                  <RadioGroupItem id={`gender-${g}`} value={g} className="sr-only" />
                  {label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* سن / قد / وزن */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="macro-age" className="text-slate-700 font-bold mb-2 block text-xs sm:text-sm">سن (سال)</Label>
              <Input
                id="macro-age"
                type="number"
                inputMode="numeric"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="۲۵"
                className="rounded-xl text-center font-stat text-lg"
                min={10}
                max={100}
              />
            </div>
            <div>
              <Label htmlFor="macro-height" className="text-slate-700 font-bold mb-2 block text-xs sm:text-sm">قد (cm)</Label>
              <Input
                id="macro-height"
                type="number"
                inputMode="numeric"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="۱۷۵"
                className="rounded-xl text-center font-stat text-lg"
                min={100}
                max={250}
              />
            </div>
            <div>
              <Label htmlFor="macro-weight" className="text-slate-700 font-bold mb-2 block text-xs sm:text-sm">وزن (kg)</Label>
              <Input
                id="macro-weight"
                type="number"
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="۷۵"
                className="rounded-xl text-center font-stat text-lg"
                min={30}
                max={300}
              />
            </div>
          </div>
          {((age !== "" && !validAge) || (height !== "" && !validHeight) || (weight !== "" && !validWeight)) && (
            <p className="text-[11px] text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> سن ۱۰ تا ۱۰۰ سال، قد ۱۰۰ تا ۲۵۰ سانتی‌متر و وزن ۳۰ تا ۳۰۰ کیلوگرم باشد
            </p>
          )}

          {/* سطح فعالیت */}
          <div>
            <Label className="text-slate-700 font-bold mb-2 block flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-orange-500" />
              سطح فعالیت روزانه
            </Label>
            <RadioGroup
              value={activity}
              onValueChange={(v) => setActivity(v as ActivityKey)}
              className="space-y-1.5"
              aria-label="انتخاب سطح فعالیت روزانه"
            >
              {ACTIVITY.map((a) => (
                <Label
                  key={a.key}
                  htmlFor={`act-${a.key}`}
                  className={`w-full flex items-start justify-between gap-2 rounded-xl border-2 px-3 py-2.5 cursor-pointer transition min-h-[44px] ${
                    activity === a.key ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-orange-200"
                  }`}
                >
                  <span className="flex flex-col">
                    <span className={`text-sm font-bold ${activity === a.key ? "text-orange-700" : "text-slate-900"}`}>{a.label}</span>
                    <span className="text-[11px] text-slate-400">{a.hint}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-stat">×{toPersianDigits(a.factor)}</span>
                    <RadioGroupItem id={`act-${a.key}`} value={a.key} />
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* هدف — Tabs */}
          <div>
            <Label className="text-slate-700 font-bold mb-2 block">هدف شما</Label>
            <Tabs value={goal} onValueChange={(v) => setGoal(v as GoalKey)}>
              <TabsList className="w-full h-11 bg-orange-50 border-2 border-orange-100 rounded-xl p-1">
                {GOALS.map((g) => (
                  <TabsTrigger
                    key={g.key}
                    value={g.key}
                    className="flex-1 h-9 rounded-lg text-xs sm:text-sm font-bold data-[state=active]:text-white data-[state=active]:shadow-md min-h-[44px] sm:min-h-0"
                    style={goal === g.key ? { background: goldGradient } : {}}
                  >
                    {g.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              {goalInfo.note} — پروتئین {toPersianDigits(goalInfo.proteinPerKg)} گرم به‌ازای هر کیلوگرم وزن
            </p>
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
              محاسبه ماکروها
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
          {result && derived && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="mt-6 space-y-3"
            >
              {/* کالری هدف */}
              <div className="rounded-2xl p-[1.5px] shadow-lg shadow-orange-500/15" style={{ background: goldGradient }}>
                <div className="rounded-[calc(1rem-1px)] bg-white p-4 sm:p-5">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">کالری هدف روزانه ({goalInfo.label})</p>
                      <p className="text-5xl font-black font-stat text-slate-900 leading-none">
                        {toPersianDigits(derived.targetCal.toLocaleString("en-US"))}
                        <span className="text-sm font-bold text-slate-400 mr-2">کیلوکالری</span>
                      </p>
                    </div>
                    <div className="text-left text-[11px] text-slate-400 font-stat leading-relaxed">
                      <p>BMR: {toPersianDigits(result.bmr.toLocaleString("en-US"))}</p>
                      <p>TDEE: {toPersianDigits(result.tdee.toLocaleString("en-US"))}</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-3 font-stat">
                    TDEE = BMR × {toPersianDigits(activityFactor)} — کالری هدف = TDEE × {toPersianDigits(goalInfo.factor)}
                  </p>
                </div>
              </div>

              {/* کارت‌های ماکرو */}
              <div className="grid sm:grid-cols-3 gap-3">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-2xl border-2 bg-emerald-50/60 p-4"
                  style={{ borderColor: "#6ee7b7" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                      <Beef className="w-[18px] h-[18px] text-white" />
                    </span>
                    <p className="text-sm font-black text-emerald-800">پروتئین</p>
                  </div>
                  <p className="text-3xl font-black font-stat text-emerald-900">
                    {toPersianDigits(derived.proteinG.toLocaleString("en-US"))}
                    <span className="text-xs font-bold text-emerald-600 mr-1">گرم</span>
                  </p>
                  <p className="text-[11px] text-emerald-700/80 mt-1.5 font-stat">
                    {toPersianDigits(goalInfo.proteinPerKg)} گرم × وزن — {toPersianDigits(Math.round((derived.proteinG * 4 * 100) / derived.targetCal))}٪ کالری
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  className="rounded-2xl border-2 bg-amber-50/60 p-4"
                  style={{ borderColor: "#fcd34d" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
                      <Wheat className="w-[18px] h-[18px] text-white" />
                    </span>
                    <p className="text-sm font-black text-amber-800">کربوهیدرات</p>
                  </div>
                  <p className="text-3xl font-black font-stat text-amber-900">
                    {toPersianDigits(derived.carbsG.toLocaleString("en-US"))}
                    <span className="text-xs font-bold text-amber-600 mr-1">گرم</span>
                  </p>
                  <p className="text-[11px] text-amber-700/80 mt-1.5 font-stat">
                    {toPersianDigits(Math.round((derived.carbsG * 4 * 100) / derived.targetCal))}٪ کالری — سوخت تمرین و مغز
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.26 }}
                  className="rounded-2xl border-2 bg-orange-50/60 p-4"
                  style={{ borderColor: "#fdba74" }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                      <Droplet className="w-[18px] h-[18px] text-white" />
                    </span>
                    <p className="text-sm font-black text-orange-800">چربی</p>
                  </div>
                  <p className="text-3xl font-black font-stat text-orange-900">
                    {toPersianDigits(derived.fatG.toLocaleString("en-US"))}
                    <span className="text-xs font-bold text-orange-600 mr-1">گرم</span>
                  </p>
                  <p className="text-[11px] text-orange-700/80 mt-1.5 font-stat">
                    ۲۵٪ کالری — هورمون‌ها و سلامت سلول
                  </p>
                </motion.div>
              </div>

              {/* یادداشت */}
              <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                این اعداد تخمین علمی هستند؛ برای دقیق‌شدن، وزن و ترکیب بدن را هر ۲ تا ۳ هفته بسنجید و کالری را ۵ تا ۱۰٪ تنظیم کنید.
              </p>

              {/* CTA بعد از نتیجه — دقیقاً الگوی /tdee (Task 5-e) */}
              <ToolResultCta tool="tdee" />

              {/* قدم بعدی */}
              <a
                href="/tdee"
                className="flex items-center justify-between gap-2 rounded-xl border-2 border-amber-200 bg-amber-50/60 px-4 py-3 text-sm font-bold text-amber-800 hover:bg-amber-100 transition min-h-[44px]"
              >
                <span>قدم بعدی: جزئیات کامل کالری روزانه (TDEE) را با داشبورد فیتاپ ببینید</span>
                <ArrowLeft className="w-4 h-4 shrink-0" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
