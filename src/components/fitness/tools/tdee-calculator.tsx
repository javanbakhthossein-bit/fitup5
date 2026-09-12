"use client";

/**
 * محاسبه‌گر کالری و TDEE فیتاپ — نسخهٔ حرفه‌ای
 * داشبورد نتیجه با ۳ هدف قابل انتخاب، نمودار دونات درشت‌مغذی با اسلایدر،
 * گیج BMI، تبدیل واحدهای متریک/امپریال، چاپ/کپی نتیجه و ابزارهای تکمیلی.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  Calculator,
  Flame,
  Beef,
  Wheat,
  Droplet,
  Save,
  RefreshCw,
  Target,
  Activity,
  Printer,
  Copy,
  Ruler,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { TdeeExtraTools } from "./tdee-extra-tools";
import { toPersianDigits } from "@/lib/fitness/types";
import { toast } from "sonner";

type Gender = "male" | "female";
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
type Goal = "burn" | "maintain" | "gain";
type Units = "metric" | "imperial";
type MacroKey = "protein" | "carbs" | "fat";

const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "بی‌تحرک (کار پشت میز)", light: "کم‌تحرک (۱-۳ روز ورزش)", moderate: "متوسط (۳-۵ روز ورزش)", active: "فعال (۶-۷ روز ورزش)", very_active: "بسیار فعال (ورزشکار حرفه‌ای)",
};

// ─── سه هدف قابل انتخاب در داشبورد ───
const GOAL_FACTORS: Record<Goal, number> = {
  burn: 0.8,    // چربی‌سوزی: −۲۰٪
  maintain: 1,  // تثبیت وزن
  gain: 1.15,   // عضله‌سازی: +۱۵٪
};

const GOALS: { id: Goal; label: string; sub: string; emoji: string }[] = [
  { id: "burn", label: "چربی‌سوزی", sub: "−۲۰٪ کالری", emoji: "🔥" },
  { id: "maintain", label: "تثبیت وزن", sub: "همان TDEE", emoji: "⚖️" },
  { id: "gain", label: "عضله‌سازی (حجم)", sub: "+۱۵٪ کالری", emoji: "💪" },
];

const GOAL_MACRO_DEFAULTS: Record<Goal, Record<MacroKey, number>> = {
  burn: { protein: 40, carbs: 30, fat: 30 },
  maintain: { protein: 30, carbs: 40, fat: 30 },
  gain: { protein: 30, carbs: 45, fat: 25 },
};

const MACRO_META: { key: MacroKey; label: string; color: string; kcalPerGram: number }[] = [
  { key: "protein", label: "پروتئین", color: "#f59e0b", kcalPerGram: 4 },
  { key: "carbs", label: "کربوهیدرات", color: "#06b6d4", kcalPerGram: 4 },
  { key: "fat", label: "چربی", color: "#a855f7", kcalPerGram: 9 },
];

// BMI categories — Persian label + color
function getBmiCategory(bmi: number): { label: string; hexColor: string; bg: string; desc: string } {
  if (bmi < 18.5) return { label: "کم‌وزن", hexColor: "#06b6d4", bg: "rgba(6,182,212,0.12)", desc: "وزن شما کمتر از بازهٔ سالم است — با تغذیهٔ پرمایه و تمرین قدرتی وزن سالم بگیرید." };
  if (bmi < 25) return { label: "وزن نرمال", hexColor: "#10b981", bg: "rgba(16,185,129,0.12)", desc: "آفرین! وزن شما در بازهٔ سالم است — با تغذیهٔ درست و ورزش منظم همین‌طور نگهش دارید." };
  if (bmi < 30) return { label: "اضافه‌وزن", hexColor: "#f59e0b", bg: "rgba(245,158,11,0.12)", desc: "کمی بالاتر از بازهٔ سالم هستید — کسری کالری ملایم همراه با فعالیت روزانه نتیجهٔ خوبی می‌دهد." };
  return { label: "چاق", hexColor: "#ef4444", bg: "rgba(239,68,68,0.12)", desc: "کاهش تدریجی وزن ریسک بیماری‌ها را پایین می‌آورد — از کسری کالری ۲۰ درصدی و پیاده‌روی روزانه شروع کنید." };
}

// ─── تبدیل واحدها ───
function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return { ft, inch };
}

// ─── استایل چاپ ───
const PRINT_CSS = `
@media print {
  body { background: #fff !important; }
  header, .tdee-no-print { display: none !important; }
  .tdee-result-print { border: 1px solid #e2e8f0 !important; box-shadow: none !important; }
}
`;

// ─── سوالات متداول (منبع JSON-LD + آکاردئون) ───
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "چگونه کالری روزانه خود را محاسبه کنم؟",
    a: "برای محاسبه کالری روزانه، ابتدا BMR (متابولیسم پایه) را با فرمول هریس-بندیکت بر اساس سن، جنسیت، قد و وزن به‌دست آورید، سپس آن را در ضریب فعالیت روزانه ضرب کنید تا TDEE به‌دست آید. این مقدار همان کالری روزانه شما برای تثبیت وزن است. سپس بر اساس هدف (حجم، کات یا تثبیت) ۱۵ تا ۲۰ درصد به آن اضافه یا کم کنید.",
  },
  {
    q: "TDEE چیست و چه چیزی آن را تعیین می‌کند؟",
    a: "TDEE یا Total Daily Energy Expenditure یعنی کل کالری‌ای که بدن شما در یک شبانه‌روز می‌سوزاند؛ ترکیبی از متابولیسم پایه (حدود ۶۰ تا ۷۰٪)، حرکت روزانه، ورزش و اثر گرمایی غذا. سن، جنسیت، وزن، قد و سطح فعالیت شما این عدد را تعیین می‌کنند و همین عدد، نقطهٔ شروع هر برنامه غذایی برای رژیم لاغری یا حجم است.",
  },
  {
    q: "برای عضله‌سازی چند کالری نیاز دارم؟",
    a: "برای عضله‌سازی و افزایش حجم عضلانی، باید حدود ۱۵ درصد (تقریباً ۳۰۰ تا ۵۰۰ کالری) بیشتر از TDEE مصرف کنید (Calorie Surplus). دریافت پروتئین باید بین ۱.۶ تا ۲.۲ گرم به ازای هر کیلوگرم وزن بدن باشد. این مازاد کالری به همراه برنامه تمرینی بدنسازی اصولی، شرط اصلی رشد عضلانی است.",
  },
  {
    q: "برای کاهش وزن و رژیم لاغری چقدر کالری کم بخورم؟",
    a: "برای رژیم لاغری و چربی‌سوزی پایدار، کسری کالری ۱۵ تا ۲۰ درصد (حدود ۲۵۰ تا ۵۰۰ کالری در روز) پیشنهاد می‌شود — معادل کاهش ۰.۲۵ تا ۰.۵ کیلوگرم در هفته. کسری بیش از حد باعث تحلیل عضلانی، افت انرژی و کاهش متابولیسم می‌شود. در دوره کات، دریافت پروتئین را بالا نگه دارید تا عضلات حفظ شوند.",
  },
  {
    q: "تفاوت BMR و TDEE چیست؟",
    a: "BMR (Basal Metabolic Rate) کالری مصرفی بدن در حالت استراحت کامل برای حفظ عملکردهای حیاتی مثل تنفس، ضربان قلب و فعالیت مغز است. TDEE برابر BMR ضرب در ضریب فعالیت روزانه است و کل کالری مصرفی شما را در طول روز نشان می‌دهد. TDEE همیشه بیشتر از BMR است و مبنای محاسبه کالری مورد نیاز بدن است.",
  },
  {
    q: "درشت‌مغذی‌ها (پروتئین، کربوهیدرات، چربی) چگونه محاسبه می‌شوند؟",
    a: "درشت‌مغذی‌ها سه جزء اصلی هر برنامه غذایی هستند. برای محاسبه، ابتدا کالری هدف را تعیین کنید، سپس درصد هر یک را تنظیم کنید: برای دوره حجم حدود ۳۰٪ پروتئین، ۴۵٪ کربوهیدرات، ۲۵٪ چربی؛ برای دوره کات حدود ۴۰٪ پروتئین، ۳۰٪ کربوهیدرات، ۳۰٪ چربی. هر گرم پروتئین و کربوهیدرات ۴ کالری و هر گرم چربی ۹ کالری دارد. در همین صفحه می‌توانید درصدها را با اسلایدر تغییر دهید و گرم‌ها را ببینید.",
  },
  {
    q: "شاخص BMI چیست و چگونه تفسیر می‌شود؟",
    a: "BMI یا شاخص توده بدنی، وزن (کیلوگرم) تقسیم بر مجذور قد (متر) است: کمتر از ۱۸.۵ کم‌وزن، ۱۸.۵ تا ۲۴.۹ نرمال، ۲۵ تا ۲۹.۹ اضافه‌وزن و ۳۰ به بالا چاقی. BMI فقط یک غربالگری اولیه است و ترکیب بدن را نشان نمی‌دهد؛ ورزشکاران عضلانی ممکن است BMI بالایی داشته باشند بدون آنکه چربی بالایی داشته باشند — برای همین درصد چربی بدن را هم در ابزارهای همین صفحه محاسبه کنید.",
  },
  {
    q: "روزانه چقدر آب باید بنوشم و وزن ایده‌آل چگونه محاسبه می‌شود؟",
    a: "نیاز آب بدن تقریباً ۳۳ میلی‌لیتر به‌ازای هر کیلوگرم وزن است؛ مثلاً فرد ۷۵ کیلویی حدود ۲.۵ لیتر در روز نیاز دارد که با ورزش و هوای گرم بیشتر می‌شود. وزن ایده‌آل هم معمولاً با فرمول‌های Devine و Hamwi (بر اساس قد و جنسیت) محاسبه می‌شود و بازهٔ سالم BMI یعنی ۱۸.۵ تا ۲۴.۹ معیار تکمیلی آن است — هر دو ابزار در همین صفحه در دسترس شماست.",
  },
];

export function TdeeCalculator() {
  // Initialize state from localStorage using lazy initializers
  const savedData = typeof window !== "undefined" ? (() => {
    try {
      const saved = localStorage.getItem("fitap_tdee_data");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  })() : null;

  const savedGoal: Goal = ["burn", "maintain", "gain"].includes(savedData?.goal) ? savedData.goal : "maintain";

  const [units, setUnits] = useState<Units>(savedData?.units === "imperial" ? "imperial" : "metric");
  const [age, setAge] = useState(savedData?.age || "");
  // مقادیر مرجع همیشه متریک (cm/kg) است
  const [height, setHeight] = useState(savedData?.height || "");
  const [weight, setWeight] = useState(savedData?.weight || "");
  // فیلدهای نمایش امپریال (ft/in/lb) — اگر کاربر با واحد امپریال ذخیره کرده، همان‌جا مقداردهی می‌شود
  const [heightFt, setHeightFt] = useState(() => (savedData?.units === "imperial" && savedData?.height ? String(cmToFtIn(Number(savedData.height)).ft) : ""));
  const [heightIn, setHeightIn] = useState(() => (savedData?.units === "imperial" && savedData?.height ? String(cmToFtIn(Number(savedData.height)).inch) : ""));
  const [weightLb, setWeightLb] = useState(() => (savedData?.units === "imperial" && savedData?.weight ? String(Math.round(Number(savedData.weight) * 2.20462)) : ""));

  const [gender, setGender] = useState<Gender>(savedData?.gender || "male");
  const [activity, setActivity] = useState<ActivityLevel>(savedData?.activity || "moderate");
  const [goal, setGoal] = useState<Goal>(savedGoal);
  const [macroSplit, setMacroSplit] = useState<Record<MacroKey, number>>(GOAL_MACRO_DEFAULTS[savedGoal]);
  const [result, setResult] = useState<{ bmr: number; tdee: number; bmi: number } | null>(null);

  const heightNum = Number(height);
  const weightNum = Number(weight);
  const ageNum = Number(age);
  const validHeight = heightNum >= 100 && heightNum <= 250;
  const validWeight = weightNum >= 30 && weightNum <= 300;
  const validAge = ageNum >= 10 && ageNum <= 100;

  // کالری هدف از روی هدف انتخابی به‌صورت زنده محاسبه می‌شود
  const targetCal = result ? Math.round(result.tdee * GOAL_FACTORS[goal]) : 0;
  const macroGrams = {
    protein: Math.round((targetCal * macroSplit.protein) / 100 / 4),
    carbs: Math.round((targetCal * macroSplit.carbs) / 100 / 4),
    fat: Math.round((targetCal * macroSplit.fat) / 100 / 9),
  };
  const dailyDiff = result ? targetCal - result.tdee : null;

  // ─── تغییر واحد با تبدیل فوری ───
  function switchUnits(next: Units) {
    if (next === units) return;
    if (next === "imperial") {
      if (validHeight) {
        const { ft, inch } = cmToFtIn(heightNum);
        setHeightFt(String(ft));
        setHeightIn(String(inch));
      }
      if (validWeight) setWeightLb(String(Math.round(weightNum * 2.20462)));
    } else {
      const ft = Number(heightFt), inch = Number(heightIn) || 0, lb = Number(weightLb);
      if (ft > 0 || inch > 0) setHeight(String(Math.round((ft * 12 + inch) * 2.54)));
      if (lb > 0) setWeight(String(Math.round((lb / 2.20462) * 10) / 10));
    }
    setUnits(next);
  }

  function handleFtChange(v: string) {
    setHeightFt(v);
    const ft = Number(v), inch = Number(heightIn) || 0;
    if (ft > 0 || inch > 0) setHeight(String(Math.round((ft * 12 + inch) * 2.54)));
  }

  function handleInchChange(v: string) {
    setHeightIn(v);
    const ft = Number(heightFt), inch = Number(v) || 0;
    if (ft > 0 || inch > 0) setHeight(String(Math.round((ft * 12 + inch) * 2.54)));
  }

  function handleLbChange(v: string) {
    setWeightLb(v);
    const lb = Number(v);
    if (lb > 0) setWeight(String(Math.round((lb / 2.20462) * 10) / 10));
  }

  function calculate() {
    if (!validAge || !validHeight || !validWeight) {
      toast.error("لطفاً اطلاعات معتبر وارد کنید (قد ۱۰۰-۲۵۰ سانتی‌متر، وزن ۳۰-۳۰۰ کیلوگرم، سن ۱۰-۱۰۰ سال)");
      return;
    }

    // Harris-Benedict formula
    let bmr: number;
    if (gender === "male") {
      bmr = 88.362 + (13.397 * weightNum) + (4.799 * heightNum) - (5.677 * ageNum);
    } else {
      bmr = 447.593 + (9.247 * weightNum) + (3.098 * heightNum) - (4.330 * ageNum);
    }

    const tdee = Math.round(bmr * ACTIVITY_FACTORS[activity]);

    // BMI: weight (kg) / (height (m))^2
    const heightM = heightNum / 100;
    const bmi = Math.round((weightNum / (heightM * heightM)) * 10) / 10;

    setResult({ bmr: Math.round(bmr), tdee, bmi });

    // Save to localStorage
    try {
      localStorage.setItem("fitap_tdee_data", JSON.stringify({ age, height, weight, gender, activity, goal, units }));
    } catch {}
    // v59 — گارد storage: حالت خصوصی، خطا به مرز خطا نرود
    toast.success("محاسبه انجام شد! 💪");
    // در محاسبهٔ مجدد، اسلایدرها با پیش‌فرض هدف هم‌گام می‌شوند اگر کاربر هنوز دستکاری‌اشان نکرده باشد
  }

  function reset() {
    setAge(""); setHeight(""); setWeight("");
    setHeightFt(""); setHeightIn(""); setWeightLb("");
    setResult(null);
    try {
      localStorage.removeItem("fitap_tdee_data");
    } catch {}
  }

  function selectGoal(g: Goal) {
    setGoal(g);
    setMacroSplit(GOAL_MACRO_DEFAULTS[g]);
  }

  // ─── اسلایدر درشت‌مغذی: تغییر یکی، بقیه متناسب تنظیم می‌شوند (جمع همیشه ۱۰۰) ───
  function updateMacro(key: MacroKey, val: number) {
    setMacroSplit(prev => {
      const v = Math.max(5, Math.min(85, Math.round(val)));
      const others = (["protein", "carbs", "fat"] as const).filter(k => k !== key);
      const rest = 100 - v;
      const sum = prev[others[0]] + prev[others[1]];
      let a: number, b: number;
      if (sum <= 0) {
        a = Math.round(rest / 2);
        b = rest - a;
      } else {
        a = Math.round((rest * prev[others[0]]) / sum);
        b = rest - a;
      }
      return { ...prev, [key]: v, [others[0]]: a, [others[1]]: b };
    });
  }

  // ─── چاپ و کپی خلاصهٔ نتیجه ───
  function buildSummary(): string {
    if (!result) return "";
    const bmiCat = getBmiCategory(result.bmi);
    return [
      "🔥 نتیجهٔ محاسبه‌گر کالری فیتاپ",
      `TDEE (کالری روزانه): ${toPersianDigits(result.tdee.toLocaleString("en-US"))} کیلوکالری`,
      `BMR (متابولیسم پایه): ${toPersianDigits(result.bmr.toLocaleString("en-US"))} کیلوکالری`,
      `هدف (${GOALS.find(g => g.id === goal)?.label}): ${toPersianDigits(targetCal.toLocaleString("en-US"))} کیلوکالری`,
      `پروتئین: ${toPersianDigits(macroGrams.protein)} گرم | کربوهیدرات: ${toPersianDigits(macroGrams.carbs)} گرم | چربی: ${toPersianDigits(macroGrams.fat)} گرم`,
      `BMI: ${toPersianDigits(result.bmi.toFixed(1))} (${bmiCat.label})`,
      "— محاسبه آنلاین رایگان: https://fittup.ir/?tool=tdee",
    ].join("\n");
  }

  async function copySummary() {
    const text = buildSummary();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("خلاصهٔ نتیجه در کلیپ‌بورد کپی شد ✅");
    } catch {
      toast.error("کپی ناموفق بود — مرورگر شما اجازهٔ دسترسی به کلیپ‌بورد را نمی‌دهد");
    }
  }

  // ─── SEO ───
  useEffect(() => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";
    const pageUrl = `${siteUrl}/?tool=tdee`;
    const title = "محاسبه کالری روزانه و TDEE | محاسبه‌گر کالری، BMR و BMI | فیتاپ";
    const description =
      "محاسبه کالری روزانه با محاسبه‌گر حرفه‌ای و رایگان فیتاپ: TDEE، BMR، شاخص BMI، درشت‌مغذی‌ها (پروتئین، کربوهیدرات، چربی)، وزن ایده‌آل، درصد چربی بدن، آب مورد نیاز بدن و کالری سوخت‌شدهٔ فعالیت‌ها. ابزار فارسی مبتنی بر فرمول علمی هریس-بندیکت برای رژیم لاغری، چربی‌سوزی و عضله‌سازی.";
    const keywords =
      "محاسبه کالری روزانه، TDEE، BMR، کالری نیاز بدن، رژیم لاغری، عضله‌سازی، محاسبه‌گر کالری، ماشین حساب TDEE، متابولیسم پایه، BMI، درصد چربی بدن، وزن ایده‌آل، کالری سوخته ورزش، درشت‌مغذی، فیتاپ";
    const ogImage = `${siteUrl}/fitup-logo.png`;

    document.title = title;
    setMetaTag("description", description);
    setMetaTag("keywords", keywords);
    setMetaTag("robots", "index,follow");
    setLinkTag("canonical", pageUrl);

    setMetaProp("og:title", title);
    setMetaProp("og:description", description);
    setMetaProp("og:type", "website");
    setMetaProp("og:locale", "fa_IR");
    setMetaProp("og:url", pageUrl);
    setMetaProp("og:image", ogImage);
    setMetaProp("og:site_name", "فیتاپ");

    setMetaProp("twitter:card", "summary_large_image");
    setMetaProp("twitter:title", title);
    setMetaProp("twitter:description", description);
    setMetaProp("twitter:image", ogImage);

    // BreadcrumbList schema
    setJsonLd("breadcrumb-schema", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "فیتاپ", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "محاسبه‌گر کالری روزانه", item: pageUrl },
      ],
    });

    // FAQPage schema — هم‌گام با آکاردئون ۸ سوالی
    setJsonLd("faq-schema", {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map(item => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });

    // WebApplication schema
    setJsonLd("webapp-schema", {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "فیتاپ محاسبه‌گر کالری روزانه",
      alternateName: "FitUp TDEE & Calorie Calculator",
      url: pageUrl,
      applicationCategory: "HealthApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      inLanguage: "fa",
      description: "محاسبه‌گر آنلاین و رایگان کالری روزانه (TDEE و BMR) با داشبورد درشت‌مغذی‌ها، BMI، وزن ایده‌آل، درصد چربی بدن، آب مورد نیاز و کالری‌سنج فعالیت‌های ورزشی.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "IRR" },
      creator: { "@type": "Organization", name: "فیتاپ", url: siteUrl },
      featureList: [
        "محاسبه کالری روزانه (TDEE) با فرمول هریس-بندیکت",
        "محاسبه متابولیسم پایه (BMR)",
        "داشبورد سه هدف: چربی‌سوزی، تثبیت وزن، عضله‌سازی",
        "نمودار درشت‌مغذی‌ها با اسلایدر تنظیم",
        "شاخص توده بدنی (BMI) با گیج رنگی",
        "محاسبه وزن ایده‌آل (Devine و Hamwi)",
        "تخمین درصد چربی بدن (US Navy)",
        "محاسبه آب مورد نیاز بدن",
        "کالری‌سنج فعالیت‌های ورزشی (MET)",
        "پیش‌بینی روند وزن بر اساس کسری/مازاد کالری",
      ],
    });

    return () => {
      ["breadcrumb-schema", "faq-schema", "webapp-schema"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      document.title =
        "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه با AI";
    };
  }, []);

  const donutData = [
    { name: "پروتئین", value: macroGrams.protein, color: "#f59e0b" },
    { name: "کربوهیدرات", value: macroGrams.carbs, color: "#06b6d4" },
    { name: "چربی", value: macroGrams.fat, color: "#a855f7" },
  ];

  return (
    <div className="min-h-screen bg-white pt-28 sm:pt-20 pb-12">
      {/* استایل چاپ: فقط داشبورد نتیجه چاپ می‌شود */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-8 tdee-no-print">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-200" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <Calculator className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">محاسبه‌گر کالری و TDEE</h1>
          <p className="text-sm text-slate-500">با فرمول علمی هریس-بندیکت، کالری روزانه، درشت‌مغذی‌ها، BMI و ۵ ابزار حرفه‌ای دیگر — رایگان</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Form */}
          <Card className="p-5 bg-white border-2 rounded-3xl tdee-no-print" style={{ borderColor: "#fed7aa" }}>
            <h2 className="font-bold text-slate-900 mb-4">اطلاعات خود را وارد کنید</h2>
            <div className="space-y-4">
              {/* Unit toggle */}
              <div>
                <Label className="mb-2 block text-slate-700 flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5 text-orange-500" /> واحد اندازه‌گیری
                </Label>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-orange-50 border-2 border-orange-100">
                  {([["metric", "متریک (cm/kg)"], ["imperial", "امپریال (ft/lb)"]] as const).map(([u, label]) => (
                    <button
                      key={u}
                      onClick={() => switchUnits(u)}
                      className={`min-h-[44px] rounded-xl text-xs font-bold transition ${
                        units === u ? "text-white shadow-md" : "text-slate-600 hover:text-orange-600"
                      }`}
                      style={units === u ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Gender */}
              <div>
                <Label className="mb-2 block text-slate-700">جنسیت</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["male", "female"] as const).map(g => (
                    <button key={g} onClick={() => setGender(g)} className={`min-h-[44px] p-3 rounded-xl border-2 transition font-bold text-sm ${gender === g ? "border-orange-500 bg-orange-50 text-orange-600" : "border-slate-200 text-slate-600"}`}>
                      {g === "male" ? "👨 آقا" : "👩 خانم"}
                    </button>
                  ))}
                </div>
              </div>
              {/* Age */}
              <div>
                <Label className="mb-2 block text-slate-700">سن (سال)</Label>
                <Input type="number" inputMode="numeric" value={age} onChange={e => setAge(e.target.value)} placeholder="۲۵" className="rounded-xl text-center font-stat text-lg" />
              </div>
              {/* Height + Weight */}
              {units === "metric" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="mb-2 block text-slate-700">قد (cm)</Label>
                    <Input type="number" inputMode="numeric" value={height} onChange={e => setHeight(e.target.value)} placeholder="۱۷۵" className="rounded-xl text-center font-stat text-lg" />
                  </div>
                  <div>
                    <Label className="mb-2 block text-slate-700">وزن (kg)</Label>
                    <Input type="number" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} placeholder="۷۵" className="rounded-xl text-center font-stat text-lg" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <Label className="mb-2 block text-slate-700">قد (فوت / اینچ)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" inputMode="numeric" value={heightFt} onChange={e => handleFtChange(e.target.value)} placeholder="فوت — ۵" className="rounded-xl text-center font-stat text-lg" />
                      <Input type="number" inputMode="numeric" value={heightIn} onChange={e => handleInchChange(e.target.value)} placeholder="اینچ — ۹" className="rounded-xl text-center font-stat text-lg" />
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-slate-700">وزن (lb)</Label>
                    <Input type="number" inputMode="decimal" value={weightLb} onChange={e => handleLbChange(e.target.value)} placeholder="۱۶۵" className="rounded-xl text-center font-stat text-lg" />
                  </div>
                </div>
              )}
              {/* Activity */}
              <div>
                <Label className="mb-2 block text-slate-700">سطح فعالیت روزانه</Label>
                <div className="space-y-1.5">
                  {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map(a => (
                    <button key={a} onClick={() => setActivity(a)} className={`w-full min-h-[44px] p-2.5 rounded-xl border-2 text-xs text-right transition ${activity === a ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}>
                      <span className="font-bold text-slate-900">{ACTIVITY_LABELS[a]}</span>
                      <span className="text-slate-400 mr-2">×{toPersianDigits(ACTIVITY_FACTORS[a])}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={calculate} className="flex-1 min-h-[44px] rounded-xl text-white font-bold" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                  <Flame className="w-4 h-4" /> محاسبه
                </Button>
                <Button onClick={reset} variant="outline" className="min-h-[44px] rounded-xl" aria-label="پاک کردن فرم">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>

          {/* Result dashboard */}
          <div>
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div key="result" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 tdee-result-print">
                  {/* Big TDEE */}
                  <Card className="p-5 text-white rounded-3xl" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                    <div className="flex items-center gap-2 mb-2"><Flame className="w-5 h-5" /><span className="text-sm font-bold">کالری روزانه (TDEE)</span></div>
                    <p className="text-5xl font-black font-stat leading-tight"><AnimatedNumber value={result.tdee} /></p>
                    <p className="text-xs opacity-80 mt-1">کیلوکالری در روز — کالری تثبیت وزن</p>
                    <div className="mt-3 pt-3 border-t border-white/25 flex items-center justify-between text-sm">
                      <span className="opacity-90">BMR (متابولیسم پایه)</span>
                      <span className="font-black font-stat">{toPersianDigits(result.bmr.toLocaleString("en-US"))}</span>
                    </div>
                  </Card>

                  {/* ۳ هدف قابل انتخاب */}
                  <div>
                    <p className="text-xs font-bold text-slate-500 mb-2">هدف خود را انتخاب کن — کالری و درشت‌مغذی‌ها فوراً به‌روز می‌شوند:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {GOALS.map(g => {
                        const active = goal === g.id;
                        const gCal = Math.round(result.tdee * GOAL_FACTORS[g.id]);
                        return (
                          <button
                            key={g.id}
                            onClick={() => selectGoal(g.id)}
                            aria-pressed={active}
                            className={`p-3 rounded-2xl border-2 text-center transition ${active ? "border-transparent text-white shadow-lg shadow-orange-200" : "border-orange-100 bg-white hover:border-orange-300"}`}
                            style={active ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
                          >
                            <span className="block text-lg leading-none mb-1">{g.emoji}</span>
                            <span className={`block text-[11px] font-black ${active ? "text-white" : "text-slate-800"}`}>{g.label}</span>
                            <span className={`block text-[10px] mt-0.5 ${active ? "text-white/85" : "text-slate-400"}`}>{g.sub}</span>
                            <span className={`block text-sm font-black font-stat mt-1.5 ${active ? "text-white" : "text-orange-600"}`}>
                              {toPersianDigits(gCal.toLocaleString("en-US"))}
                            </span>
                            <span className={`block text-[9px] ${active ? "text-white/75" : "text-slate-400"}`}>کیلوکالری</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Macros: donut + sliders */}
                  <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2"><Target className="w-4 h-4 text-orange-500" /> درشت‌مغذی‌های هدف روزانه</h3>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <div className="relative w-44 h-44 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={donutData}
                              dataKey="value"
                              innerRadius={52}
                              outerRadius={72}
                              paddingAngle={3}
                              strokeWidth={0}
                              startAngle={90}
                              endAngle={-270}
                            >
                              {donutData.map(d => (
                                <Cell key={d.name} fill={d.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-xl font-black font-stat text-slate-900">{toPersianDigits(targetCal.toLocaleString("en-US"))}</span>
                          <span className="text-[9px] text-slate-400">کیلوکالری هدف</span>
                        </div>
                      </div>
                      <div className="flex-1 w-full space-y-3">
                        {MACRO_META.map(m => (
                          <div key={m.key}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: m.color }} />
                                {m.label}
                              </span>
                              <span className="text-xs font-black font-stat text-slate-900">
                                {toPersianDigits(macroGrams[m.key])}<span className="text-[10px] text-slate-400 font-normal"> گرم · {toPersianDigits(macroSplit[m.key])}٪</span>
                              </span>
                            </div>
                            <Slider
                              value={[macroSplit[m.key]]}
                              onValueChange={(vals) => updateMacro(m.key, vals[0])}
                              min={5}
                              max={85}
                              step={1}
                              aria-label={`درصد ${m.label}`}
                              className="[&_[data-slot=slider-range]]:bg-current [&_[data-slot=slider-thumb]]:border-current"
                              style={{ color: m.color }}
                            />
                          </div>
                        ))}
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          اسلایدرها را جابه‌جا کنید تا نسبت پروتئین/کربوهیدرات/چربی شخصی‌سازی شود — جمع درصدها همیشه ۱۰۰٪ نگه داشته می‌شود.
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* BMI */}
                  <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-orange-500" /> شاخص توده بدنی (BMI)
                    </h3>
                    <BmiDisplay bmi={result.bmi} />
                  </Card>

                  {/* Print / copy actions */}
                  <div className="flex gap-2 tdee-no-print">
                    <Button
                      onClick={() => window.print()}
                      variant="outline"
                      className="flex-1 min-h-[44px] rounded-xl border-orange-200 text-orange-600 hover:bg-orange-50 font-bold"
                    >
                      <Printer className="w-4 h-4" /> چاپ نتیجه
                    </Button>
                    <Button
                      onClick={copySummary}
                      variant="outline"
                      className="flex-1 min-h-[44px] rounded-xl border-orange-200 text-orange-600 hover:bg-orange-50 font-bold"
                    >
                      <Copy className="w-4 h-4" /> کپی خلاصه
                    </Button>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 p-2 tdee-no-print">
                    <Save className="w-3.5 h-3.5" />
                    اطلاعات شما فقط در مرورگر خودتان ذخیره می‌شود
                  </div>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
                  <Flame className="w-16 h-16 text-slate-200 mb-3" />
                  <p className="text-sm text-slate-400">اطلاعات خود را وارد کن و روی «محاسبه» کلیک کن</p>
                  <p className="text-xs text-slate-300 mt-1">داشبورد کالری، درشت‌مغذی‌ها، BMI و ۵ ابزار حرفه‌ای در انتظار توست 🔥</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── ابزارهای تکمیلی ── */}
        <div className="tdee-no-print">
          <TdeeExtraTools
            weightKg={validWeight ? weightNum : null}
            heightCm={validHeight ? heightNum : null}
            age={validAge ? ageNum : null}
            gender={gender}
            activity={activity}
            hasResult={!!result}
            dailyDiff={dailyDiff}
          />
        </div>

        {/* ── SEO Content Section ── */}
        <section className="mt-16 space-y-8 tdee-no-print">
          <div className="space-y-4 text-sm leading-relaxed text-slate-700">
            <h2 className="text-2xl font-black text-slate-900">
              محاسبه‌گر کالری و TDEE فیتاپ
            </h2>
            <p>
              محاسبه‌گر کالری و TDEE فیتاپ یکی از کامل‌ترین ابزارهای رایگان برای طراحی{" "}
              <strong>برنامه غذایی بدنسازی</strong> و <strong>رژیم لاغری</strong> هدفمند است.{" "}
              TDEE (Total Daily Energy Expenditure) نشان‌دهنده کل <strong>کالری مورد نیاز بدن</strong> شما در طول یک روز است و پایه طراحی هر{" "}
              <strong>برنامه حجمی</strong> یا <strong>برنامه کات (چربی‌سوزی)</strong> به‌شمار می‌رود. با دانستن دقیق کالری روزانه، می‌توانید برای{" "}
              <strong>افزایش حجم عضلانی</strong> در دوره حجم یا <strong>کاهش وزن</strong> و{" "}
              <strong>خشک کردن بدن</strong> در دوره کات برنامه‌ریزی دقیق داشته باشید.
            </p>

            <h2 className="text-2xl font-black text-slate-900 pt-2">
              TDEE چیست و چگونه محاسبه می‌شود؟
            </h2>
            <p>
              <strong>TDEE</strong> یا کل انرژی مصرفی روزانه، عددی است که می‌گوید بدن شما در ۲۴ ساعت چند کیلوکالری می‌سوزاند. حدود ۶۰ تا ۷۰ درصد آن مربوط به متابولیسم پایه است و باقی آن از حرکت روزانه، ورزش و فرایند هضم غذا می‌آید. اگر کالری دریافتی‌تان برابر TDEE باشد وزن‌تان تثبیت می‌شود؛ کمتر از آن، بدن چربی ذخیره‌شده را می‌سوزاند (رژیم لاغری) و بیشتر از آن، مازاد به عضله‌سازی یا ذخیره چربی می‌رسد. فرمول رایج محاسبه، <strong>هریس-بندیکت (Harris-Benedict)</strong> است: ابتدا BMR از روی سن، جنسیت، قد و وزن به‌دست می‌آید و سپس در ضریب فعالیت (۱.۲ برای بی‌تحرک تا ۱.۹ برای ورزشکار حرفه‌ای) ضرب می‌شود.
            </p>

            <h2 className="text-2xl font-black text-slate-900 pt-2">
              BMR چیست و چه چیزی روی آن اثر می‌گذارد؟
            </h2>
            <p>
              <strong>BMR</strong> (نرخ متابولیسم پایه) کالری‌ای است که بدن در حالت استراحت کامل — فقط برای تنفس، ضربان قلب، فعالیت مغز و ترمیم سلول‌ها — مصرف می‌کند. هرچه <strong>توده عضلانی</strong> بیشتر، <strong>سن</strong> کمتر و <strong>وزن و قد</strong> بیشتر باشد، BMR بالاتر است. عضله‌سازی و تمرین قدرتی منظم، بهترین راه طبیعی برای بالا بردن متابولیسم پایه و افزایش کالری نیاز بدن در طول روز است.
            </p>

            <h3 className="text-xl font-bold text-slate-900 pt-2">
              کالری برای افزایش حجم عضلانی (Calorie Surplus)
            </h3>
            <p>
              برای <strong>عضله‌سازی</strong> و <strong>افزایش حجم عضلانی</strong> در دوره حجم (Bulking)، باید کالری دریافتی خود را حدود {toPersianDigits("۳۰۰")} تا {toPersianDigits("۵۰۰")} کالری بیشتر از TDEE مصرف کنید. این مازاد کالری به همراه <strong>برنامه تمرینی بدنسازی</strong> اصولی و دریافت کافی <strong>پروتئین</strong>، شرط اصلی رشد عضلانی است. توجه کنید که مازاد بیش از حد به جای عضله، چربی ذخیره می‌کند — هدف +۱۵٪ در داشبورد همین صفحه، نقطهٔ شروع امنی است.
            </p>

            <h3 className="text-xl font-bold text-slate-900 pt-2">
              کالری برای چربی‌سوزی و رژیم لاغری (Calorie Deficit)
            </h3>
            <p>
              برای <strong>چربی‌سوزی</strong>، <strong>رژیم لاغری</strong> و <strong>خشک کردن بدن</strong> در دوره کات (Cutting)، باید کالری دریافتی خود را {toPersianDigits("۲۵۰")} تا {toPersianDigits("۵۰۰")} کالری کمتر از TDEE مصرف کنید — یعنی همان هدف −۲۰٪ داشبورد بالا. این کسری کالری باعث می‌شود بدن به ذخایر چربی رجوع کند. حفظ دریافت پروتئین بالا در این دوره، از تحلیل رفتن عضلات جلوگیری می‌کند و کیفیت <strong>بدنسازی طبیعی</strong> را بالا می‌برد.
            </p>

            <h3 className="text-xl font-bold text-slate-900 pt-2">
              درشت‌مغذی‌ها (Macros): پروتئین، کربوهیدرات، چربی
            </h3>
            <p>
              <strong>درشت‌مغذی‌ها</strong> سه جزء اصلی هر <strong>برنامه غذایی بدنسازی</strong> هستند:
            </p>
            <ul className="list-disc pr-5 space-y-1.5">
              <li>
                <strong>پروتئین</strong> ({toPersianDigits("۴")} کالری در هر گرم): بلوک سازنده عضله — برای عضله‌سازی و جلوگیری از تحلیل عضلانی در دوره کات ضروری است.
              </li>
              <li>
                <strong>کربوهیدرات</strong> ({toPersianDigits("۴")} کالری در هر گرم): سوخت اصلی تمرین بدنسازی و بازسازی ذخایر گلیکوژن عضلانی.
              </li>
              <li>
                <strong>چربی</strong> ({toPersianDigits("۹")} کالری در هر گرم): تنظیم‌کننده هورمون‌ها از جمله تستوسترون — حیاتی برای سلامتی و رشد عضلانی.
              </li>
            </ul>
            <p>
              با محاسبه کالری هدف و تعیین نسبت درشت‌مغذی‌ها، می‌توانید بهترین <strong>برنامه غذایی بدنسازی</strong> را برای هدف خود — چه حجم، چه کات و چه تثبیت وزن — طراحی کنید. نمودار دونات بالای صفحه با اسلایدر تنظیم، این کار را برایتان ساده کرده است.
            </p>

            <h3 className="text-xl font-bold text-slate-900 pt-2">
              ابزارهای کمکی همین صفحه: وزن ایده‌آل، درصد چربی بدن، آب و کالری فعالیت‌ها
            </h3>
            <p>
              در بخش «ابزارهای تکمیلی» همین صفحه می‌توانید <strong>وزن ایده‌آل</strong> را با فرمول‌های Devine و Hamwi، <strong>درصد چربی بدن</strong> را با روش نیروی دریایی آمریکا (US Navy)، <strong>آب مورد نیاز بدن</strong> را بر اساس وزن و فعالیت، و <strong>کالری سوخت‌شدهٔ فعالیت‌های ورزشی</strong> (پیاده‌روی، دویدن، طناب، وزنه، شنا و دوچرخه) را با ضریب MET محاسبه کنید. ابزار «پیش‌بینی وزن» هم نشان می‌دهد با کسری یا مازاد کالری فعلی، در چه زمانی به وزن هدف می‌رسید.
            </p>
          </div>

          {/* FAQ */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">
              سوالات متداول درباره محاسبه کالری روزانه و TDEE
            </h2>
            <Accordion
              type="single"
              collapsible
              className="w-full bg-white rounded-2xl border-2 px-4"
              style={{ borderColor: "#fed7aa" }}
            >
              {FAQ_ITEMS.map((item, i) => (
                <AccordionItem key={i} value={`q${i + 1}`}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── عدد انیمیشنی شمارنده ───
function AnimatedNumber({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{toPersianDigits(display.toLocaleString("en-US"))}</>;
}

function BmiDisplay({ bmi }: { bmi: number }) {
  const cat = getBmiCategory(bmi);
  // BMI scale: 15 to 40 mapped to 0-100%
  const scalePct = Math.max(0, Math.min(100, ((bmi - 15) / (40 - 15)) * 100));
  return (
    <div>
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-3xl font-black font-stat text-slate-900">{toPersianDigits(bmi.toFixed(1))}</p>
          <p className="text-[10px] text-slate-400">kg/m²</p>
        </div>
        <div
          className="px-3 py-1.5 rounded-full text-xs font-bold"
          style={{ background: cat.bg, color: cat.hexColor }}
        >
          {cat.label}
        </div>
      </div>
      {/* BMI scale bar */}
      <div className="relative h-2.5 rounded-full overflow-hidden" style={{
        background: "linear-gradient(to left, #06b6d4 0%, #06b6d4 14%, #10b981 14%, #10b981 40%, #f59e0b 40%, #f59e0b 60%, #ef4444 60%, #ef4444 100%)"
      }}>
        {/* Marker for current BMI */}
        <motion.div
          initial={{ left: "0%" }}
          animate={{ left: `${scalePct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-800 shadow-md"
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-2">
        <span>کم‌وزن &lt; ۱۸.۵</span>
        <span>نرمال ۱۸.۵-۲۵</span>
        <span>اضافه‌وزن ۲۵-۳۰</span>
        <span>چاق &gt; ۳۰</span>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: cat.hexColor }}>
        {cat.desc}
      </p>
    </div>
  );
}

// ─── SEO helper functions ───
function setMetaTag(name: string, content: string) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaProp(prop: string, content: string) {
  if (!content) return;
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", prop);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLinkTag(rel: string, href: string) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setJsonLd(id: string, data: any) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}
