"use client";

/**
 * ابزارهای تکمیلی محاسبه‌گر کالری فیتاپ
 * ─ وزن ایده‌آل (Devine + Hamwi) ─ درصد چربی بدن (US Navy) ─ آب روزانه
 * ─ کالری سوخت‌شدهٔ فعالیت‌ها (MET) ─ پیش‌بینی وزن (کسری/مازاد کالری)
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Scale,
  Percent,
  Droplets,
  Zap,
  TrendingUp,
  Info,
  Calculator,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toPersianDigits } from "@/lib/fitness/types";
import { toast } from "sonner";

type Gender = "male" | "female";
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export interface TdeeExtraToolsProps {
  /** وزن (کیلوگرم) — null یعنی ورودی نامعتبر/خالی */
  weightKg: number | null;
  /** قد (سانتی‌متر) — null یعنی ورودی نامعتبر/خالی */
  heightCm: number | null;
  age: number | null;
  gender: Gender;
  activity: ActivityLevel;
  /** آیا محاسبهٔ اصلی انجام شده است (برای پیش‌بینی وزن) */
  hasResult: boolean;
  /** اختلاف کالری روزانه (هدف − TDEE) — منفی = کسری */
  dailyDiff: number | null;
}

// ─── سطوح فعالیت برای تعدیل آب ───
const WATER_ACTIVITY_BONUS: Record<ActivityLevel, number> = {
  sedentary: 0,
  light: 250,
  moderate: 500,
  active: 750,
  very_active: 1000,
};

const ACTIVITY_SHORT: Record<ActivityLevel, string> = {
  sedentary: "بی‌تحرک",
  light: "کم‌تحرک",
  moderate: "متوسط",
  active: "فعال",
  very_active: "بسیار فعال",
};

// ─── جدول MET فعالیت‌ها ───
const MET_ACTIVITIES: { id: string; label: string; emoji: string; met: number }[] = [
  { id: "walk", label: "پیاده‌روی تند", emoji: "🚶", met: 4.3 },
  { id: "jog", label: "دویدن آرام", emoji: "🏃", met: 8.3 },
  { id: "run", label: "دویدن سریع", emoji: "⚡", met: 11.0 },
  { id: "rope", label: "طناب زدن", emoji: "🪢", met: 12.3 },
  { id: "weights", label: "تمرین با وزنه", emoji: "🏋️", met: 5.0 },
  { id: "swim", label: "شنا", emoji: "🏊", met: 8.3 },
  { id: "bike", label: "دوچرخه", emoji: "🚴", met: 7.5 },
  { id: "hiit", label: "هوازی شدید", emoji: "🔥", met: 9.5 },
];

// ─── دسته‌های درصد چربی بدن ───
function bodyFatCategory(gender: Gender, bf: number): { label: string; color: string } {
  if (gender === "male") {
    if (bf < 6) return { label: "چربی ضروری", color: "#06b6d4" };
    if (bf < 14) return { label: "ورزشکار", color: "#10b981" };
    if (bf < 18) return { label: "تناسب اندام", color: "#22c55e" };
    if (bf < 25) return { label: "متوسط", color: "#f59e0b" };
    return { label: "چاقی", color: "#ef4444" };
  }
  if (bf < 14) return { label: "چربی ضروری", color: "#06b6d4" };
  if (bf < 21) return { label: "ورزشکار", color: "#10b981" };
  if (bf < 25) return { label: "تناسب اندام", color: "#22c55e" };
  if (bf < 32) return { label: "متوسط", color: "#f59e0b" };
  return { label: "چاقی", color: "#ef4444" };
}

const TABS = [
  { id: "ideal" as const, label: "وزن ایده‌آل", icon: Scale },
  { id: "bodyfat" as const, label: "درصد چربی", icon: Percent },
  { id: "water" as const, label: "آب روزانه", icon: Droplets },
  { id: "burn" as const, label: "کالری فعالیت‌ها", icon: Zap },
  { id: "forecast" as const, label: "پیش‌بینی وزن", icon: TrendingUp },
];

export function TdeeExtraTools({ weightKg, heightCm, age, gender, activity, hasResult, dailyDiff }: TdeeExtraToolsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("ideal");

  return (
    <section className="mt-10" aria-label="ابزارهای تکمیلی تناسب اندام">
      <div className="text-center mb-5">
        <h2 className="text-xl font-black text-slate-900 mb-1">ابزارهای تکمیلی تناسب اندام</h2>
        <p className="text-xs text-slate-500">پنج ابزار حرفه‌ای دیگر بر اساس داده‌های فرم بالا</p>
      </div>

      {/* تب‌ها */}
      <div className="flex sm:justify-center gap-1.5 pb-3 mb-4 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl border-2 text-xs font-bold transition ${
              tab === t.id
                ? "text-white border-transparent shadow-md"
                : "bg-white text-slate-600 border-orange-100 hover:border-orange-300"
            }`}
            style={tab === t.id ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "ideal" && <IdealWeightTab heightCm={heightCm} />}
          {tab === "bodyfat" && <BodyFatTab heightCm={heightCm} gender={gender} />}
          {tab === "water" && <WaterTab weightKg={weightKg} activity={activity} />}
          {tab === "burn" && <ActivityBurnTab weightKg={weightKg} />}
          {tab === "forecast" && <ForecastTab weightKg={weightKg} age={age} hasResult={hasResult} dailyDiff={dailyDiff} />}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

// ═══════════ ۱) وزن ایده‌آل — Devine + Hamwi + بازهٔ سالم ═══════════
function IdealWeightTab({ heightCm }: { heightCm: number | null }) {
  const data = useMemo(() => {
    if (!heightCm) return null;
    const inchesOver5ft = Math.max(0, heightCm / 2.54 - 60);
    const devineMale = 50 + 2.3 * inchesOver5ft;
    const devineFemale = 45.5 + 2.3 * inchesOver5ft;
    const hamwiMale = 48.0 + 2.7 * inchesOver5ft;
    const hamwiFemale = 45.5 + 2.2 * inchesOver5ft;
    const m = heightCm / 100;
    return {
      devineMale: Math.round(devineMale),
      devineFemale: Math.round(devineFemale),
      hamwiMale: Math.round(hamwiMale),
      hamwiFemale: Math.round(hamwiFemale),
      rangeMin: Math.round(18.5 * m * m),
      rangeMax: Math.round(24.9 * m * m),
    };
  }, [heightCm]);

  if (!data) {
    return <MissingInput text="برای محاسبهٔ وزن ایده‌آل، ابتدا قد خود را در فرم بالا وارد کنید." />;
  }

  return (
    <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
        <Scale className="w-4 h-4 text-orange-500" /> وزن ایده‌آل شما چقدر است؟
      </h3>
      <p className="text-[11px] text-slate-400 mb-4">ترکیب فرمول‌های علمی Devine و Hamwi + بازهٔ وزنی سالم بر اساس BMI</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat label="Devine (آقا)" value={`${toPersianDigits(data.devineMale)} کیلوگرم`} />
        <MiniStat label="Devine (خانم)" value={`${toPersianDigits(data.devineFemale)} کیلوگرم`} />
        <MiniStat label="Hamwi (آقا)" value={`${toPersianDigits(data.hamwiMale)} کیلوگرم`} />
        <MiniStat label="Hamwi (خانم)" value={`${toPersianDigits(data.hamwiFemale)} کیلوگرم`} />
      </div>
      <div className="mt-3 p-4 rounded-2xl text-white" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
        <p className="text-xs opacity-90 mb-1">بازهٔ وزن سالم (BMI بین ۱۸.۵ تا ۲۴.۹)</p>
        <p className="text-2xl font-black font-stat">
          {toPersianDigits(data.rangeMin)} تا {toPersianDigits(data.rangeMax)} <span className="text-sm font-bold">کیلوگرم</span>
        </p>
      </div>
      <InfoLine>
        فرمول Devine (۱۹۷۴) و Hamwi (۱۹۶۴) پرکاربردترین فرمول‌های محاسبهٔ وزن ایده‌آل در دنیای پزشکی و بدنسازی هستند. اگر وزن فعلی شما داخل بازهٔ سالم باشد، هدف اصلی‌تان باید حفظ عضله و کاهش چربی باشد نه کاهش وزن روی ترازو.
      </InfoLine>
    </Card>
  );
}

// ═══════════ ۲) درصد چربی بدن — فرمول نیروی دریایی آمریکا ═══════════
function BodyFatTab({ heightCm, gender }: { heightCm: number | null; gender: Gender }) {
  const [neck, setNeck] = useState("");
  const [waist, setWaist] = useState("");
  const [hip, setHip] = useState("");
  const [result, setResult] = useState<number | null>(null);

  function calc() {
    const n = Number(neck), w = Number(waist), h = heightCm;
    if (!n || !w || !h || n < 20 || n < w * 0.3) {
      toast.error("دور گردن و کمر را با متر به سانتی‌متر وارد کنید");
      return;
    }
    if (gender === "female") {
      const hp = Number(hip);
      if (!hp || hp < 40) {
        toast.error("برای خانم‌ها وارد کردن دور باسن الزامی است");
        return;
      }
      const bf = 495 / (1.29579 - 0.35004 * Math.log10(w + hp - n) + 0.221 * Math.log10(h)) - 450;
      if (!isFinite(bf) || bf <= 0 || bf > 70) {
        toast.error("اطلاعات واردشده منطقی نیست — اندازه‌ها را دوباره بررسی کنید");
        return;
      }
      setResult(Math.round(bf * 10) / 10);
    } else {
      if (w - n <= 0) {
        toast.error("دور کمر باید بیشتر از دور گردن باشد");
        return;
      }
      const bf = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
      if (!isFinite(bf) || bf <= 0 || bf > 70) {
        toast.error("اطلاعات واردشده منطقی نیست — اندازه‌ها را دوباره بررسی کنید");
        return;
      }
      setResult(Math.round(bf * 10) / 10);
    }
  }

  const cat = result !== null ? bodyFatCategory(gender, result) : null;

  return (
    <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
        <Percent className="w-4 h-4 text-orange-500" /> درصد چربی بدن (روش نیروی دریایی آمریکا)
      </h3>
      <p className="text-[11px] text-slate-400 mb-4">فقط با یک متر خیاطی: دور گردن، دور کمر {gender === "female" ? "و دور باسن" : ""} را به سانتی‌متر وارد کنید</p>
      <div className={`grid gap-3 ${gender === "female" ? "grid-cols-3" : "grid-cols-2"}`}>
        <div>
          <Label className="mb-1.5 block text-xs text-slate-600">دور گردن (cm)</Label>
          <Input type="number" inputMode="decimal" value={neck} onChange={e => setNeck(e.target.value)} placeholder="۳۸" className="rounded-xl text-center font-stat" />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs text-slate-600">دور کمر (cm)</Label>
          <Input type="number" inputMode="decimal" value={waist} onChange={e => setWaist(e.target.value)} placeholder="۸۵" className="rounded-xl text-center font-stat" />
        </div>
        {gender === "female" && (
          <div>
            <Label className="mb-1.5 block text-xs text-slate-600">دور باسن (cm)</Label>
            <Input type="number" inputMode="decimal" value={hip} onChange={e => setHip(e.target.value)} placeholder="۹۵" className="rounded-xl text-center font-stat" />
          </div>
        )}
      </div>
      <Button
        onClick={calc}
        className="w-full mt-4 min-h-[44px] rounded-xl text-white font-bold"
        style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
      >
        <Calculator className="w-4 h-4" /> محاسبهٔ درصد چربی
      </Button>

      {result !== null && cat && (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 flex items-center justify-between p-4 rounded-2xl" style={{ background: "rgba(245,158,11,0.08)" }}>
          <div>
            <p className="text-[11px] text-slate-500">درصد چربی بدن شما</p>
            <p className="text-3xl font-black font-stat text-slate-900">{toPersianDigits(result.toFixed(1))}٪</p>
          </div>
          <span className="px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: cat.color + "1f", color: cat.color }}>
            {cat.label}
          </span>
        </motion.div>
      )}
      <InfoLine>
        فرمول US Navy با خطای حدود ۳-۴٪ نزدیک‌ترین تخمین بدون کالیپر یا دستگاه است. برای آقایان ۱۰-۲۰٪ و برای خانم‌ها ۱۸-۲۸٪ محدودهٔ سالم و متناسب محسوب می‌شود؛ عدد پایین‌تر همیشه بهتر نیست.
      </InfoLine>
    </Card>
  );
}

// ═══════════ ۳) آب روزانه ═══════════
function WaterTab({ weightKg, activity }: { weightKg: number | null; activity: ActivityLevel }) {
  const data = useMemo(() => {
    if (!weightKg) return null;
    const bonus = WATER_ACTIVITY_BONUS[activity];
    const base = weightKg * 33;
    const total = base + bonus;
    return { base: Math.round(base), bonus, total: Math.round(total), liters: (total / 1000).toFixed(1), glasses: Math.round(total / 250) };
  }, [weightKg, activity]);

  if (!data) {
    return <MissingInput text="برای محاسبهٔ آب روزانه، ابتدا وزن خود را در فرم بالا وارد کنید." />;
  }

  return (
    <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
        <Droplets className="w-4 h-4 text-cyan-500" /> آب مورد نیاز بدن در روز
      </h3>
      <p className="text-[11px] text-slate-400 mb-4">فرمول استاندارد ۳۳ میلی‌لیتر به‌ازای هر کیلوگرم وزن + تعدیل سطح فعالیت</p>
      <div className="p-4 rounded-2xl text-white" style={{ background: "linear-gradient(135deg, #06b6d4, #0284c7)" }}>
        <p className="text-xs opacity-90 mb-1">نوشیدنی روزانهٔ پیشنهادی شما</p>
        <p className="text-3xl font-black font-stat">
          {toPersianDigits(data.liters)} <span className="text-sm font-bold">لیتر</span>
        </p>
        <p className="text-[11px] opacity-80 mt-1">
          حدود {toPersianDigits(data.glasses)} لیوان ۲۵۰ میلی‌لیتری — {toPersianDigits(data.total.toLocaleString("en-US"))} میلی‌لیتر
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <MiniStat label="پایه (وزن × ۳۳)" value={`${toPersianDigits(data.base.toLocaleString("en-US"))} میلی‌لیتر`} />
        <MiniStat label={`تعدیل فعالیت (${ACTIVITY_SHORT[activity]})`} value={`+ ${toPersianDigits(data.bonus)} میلی‌لیتر`} />
      </div>
      <InfoLine>
        آب نقش مستقیم در عملکرد عضله، سوزش چربی و کنترل اشتها دارد. در روزهای تمرین یا هوای گرم ۵۰۰ تا ۱۰۰۰ میلی‌لیتر به این مقدار اضافه کنید و هر لیوان آب، هم‌زمان با وعده‌های پروتئین‌دار اثر بهتری دارد.
      </InfoLine>
    </Card>
  );
}

// ═══════════ ۴) کالری سوخت‌شدهٔ فعالیت‌ها (MET) ═══════════
function ActivityBurnTab({ weightKg }: { weightKg: number | null }) {
  const [selected, setSelected] = useState(MET_ACTIVITIES[0].id);
  const [minutes, setMinutes] = useState("30");

  const act = MET_ACTIVITIES.find(a => a.id === selected) ?? MET_ACTIVITIES[0];
  const mins = Number(minutes);

  const burn = (met: number) => {
    if (!weightKg || !mins || mins <= 0 || mins > 600) return null;
    // kcal = MET × 3.5 × وزن(کیلوگرم) / 200 × دقیقه
    return Math.round((met * 3.5 * weightKg / 200) * mins);
  };

  const main = burn(act.met);

  return (
    <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
        <Zap className="w-4 h-4 text-orange-500" /> کالری‌سنج فعالیت‌های ورزشی
      </h3>
      <p className="text-[11px] text-slate-400 mb-4">
        بر اساس ضریب متابولیک (MET) {weightKg ? `برای وزن ${toPersianDigits(Math.round(weightKg))} کیلوگرم` : ""}
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {MET_ACTIVITIES.map(a => (
          <button
            key={a.id}
            onClick={() => setSelected(a.id)}
            className={`min-h-[44px] px-3 rounded-xl border-2 text-xs font-bold transition ${
              selected === a.id ? "border-orange-500 bg-orange-50 text-orange-600" : "border-slate-200 text-slate-600 hover:border-orange-200"
            }`}
          >
            {a.emoji} {a.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <Label className="mb-1.5 block text-xs text-slate-600">مدت فعالیت (دقیقه)</Label>
          <Input type="number" inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="۳۰" className="rounded-xl text-center font-stat" />
        </div>
        <div className="p-3.5 rounded-2xl text-white text-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
          <p className="text-[11px] opacity-90">{act.emoji} {act.label}</p>
          <p className="text-2xl font-black font-stat">
            {main !== null ? `${toPersianDigits(main.toLocaleString("en-US"))} kcal` : "—"}
          </p>
        </div>
      </div>

      {weightKg && (
        <div className="mt-4">
          <p className="text-[11px] font-bold text-slate-500 mb-2">
            مقایسهٔ سریع برای {toPersianDigits(mins || 0)} دقیقه فعالیت:
          </p>
          <div className="space-y-1.5">
            {MET_ACTIVITIES.map(a => {
              const b = burn(a.met);
              const pct = main && b ? Math.min(100, (b / main) * 100) : 0;
              return (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="w-24 sm:w-28 shrink-0 text-[11px] text-slate-600 truncate">{a.emoji} {a.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: a.id === selected ? "linear-gradient(90deg, #f59e0b, #f97316)" : "#cbd5e1" }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
                  </div>
                  <span className="w-16 text-left text-[11px] font-stat font-bold text-slate-700">{b !== null ? toPersianDigits(b.toLocaleString("en-US")) : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <InfoLine>
        ضریب MET شدت هر فعالیت را نسبت به حالت استراحت نشان می‌دهد: کالری هر دقیقه = MET × ۳٫۵ × وزن ÷ ۲۰۰. طناب زدن و دویدن سریع بالاترین سوزش را دارند، اما بهترین فعالیت فعلی است که بتوانید مداوم و بدون آسیب انجام دهید.
      </InfoLine>
    </Card>
  );
}

// ═══════════ ۵) پیش‌بینی وزن ═══════════
function ForecastTab({ weightKg, age, hasResult, dailyDiff }: { weightKg: number | null; age: number | null; hasResult: boolean; dailyDiff: number | null }) {
  const [targetWeight, setTargetWeight] = useState("");

  const weeklyKg = dailyDiff !== null ? (dailyDiff * 7) / 7700 : null; // ۷۷۰۰ کالری ≈ ۱ کیلوگرم چربی
  const current = weightKg;
  const target = Number(targetWeight);

  const forecast = useMemo(() => {
    if (!hasResult || dailyDiff === null || weeklyKg === null || !current || !target) return null;
    if (Math.abs(dailyDiff) < 20) return { mode: "maintain" as const };
    const diffKg = target - current;
    if (diffKg === 0) return { mode: "done" as const };
    if (Math.sign(diffKg) !== Math.sign(weeklyKg)) return { mode: "mismatch" as const };
    const weeks = Math.ceil(Math.abs(diffKg / weeklyKg));
    return {
      mode: "ok" as const,
      weeks,
      months: Math.round((weeks / 4.34) * 10) / 10,
      weeklyKg: Math.round(Math.abs(weeklyKg) * 100) / 100,
      dir: weeklyKg < 0 ? ("loss" as const) : ("gain" as const),
      diffKg: Math.round(Math.abs(diffKg) * 10) / 10,
    };
  }, [hasResult, dailyDiff, weeklyKg, current, target]);

  if (!hasResult || dailyDiff === null) {
    return <MissingInput text="برای پیش‌بینی وزن، ابتدا در فرم بالا «محاسبه» بزنید و یکی از اهداف (چربی‌سوزی / تثبیت / حجم) را انتخاب کنید." />;
  }

  return (
    <Card className="p-5 bg-white border-2 rounded-3xl" style={{ borderColor: "#fed7aa" }}>
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-orange-500" /> پیش‌بینی مسیر وزن
      </h3>
      <p className="text-[11px] text-slate-400 mb-4">با کسری/مازاد کالری انتخابی فعلی، چه زمانی به وزن هدف می‌رسی؟</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <MiniStat label="وزن فعلی" value={current ? `${toPersianDigits(Math.round(current))} کیلوگرم` : "—"} />
        <MiniStat
          label={dailyDiff < 0 ? "کسری کالری روزانه" : "مازاد کالری روزانه"}
          value={`${toPersianDigits(Math.abs(Math.round(dailyDiff)).toLocaleString("en-US"))} کیلوکالری`}
        />
      </div>

      <div>
        <Label className="mb-1.5 block text-xs text-slate-600">وزن هدف (کیلوگرم)</Label>
        <Input type="number" inputMode="decimal" value={targetWeight} onChange={e => setTargetWeight(e.target.value)} placeholder="مثلاً ۶۸" className="rounded-xl text-center font-stat text-lg" />
      </div>

      {forecast?.mode === "maintain" && (
        <p className="mt-4 p-4 rounded-2xl bg-cyan-50 text-cyan-700 text-xs font-bold">
          هدف فعلی شما تثبیت وزن است — برای پیش‌بینی، هدف «چربی‌سوزی» یا «حجم» را در داشبورد بالا انتخاب کنید.
        </p>
      )}
      {forecast?.mode === "done" && (
        <p className="mt-4 p-4 rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-bold">
          🎉 شما همین حالا روی وزن هدف هستید! وقت آن است که سراغ اهداف بعدی بروید.
        </p>
      )}
      {forecast?.mode === "mismatch" && (
        <p className="mt-4 p-4 rounded-2xl bg-amber-50 text-amber-700 text-xs font-bold">
          جهت هدف با کالری انتخابی نمی‌خواند — {dailyDiff < 0 ? "برای رسیدن به وزن کمتر، هدف «چربی‌سوزی»" : "برای رسیدن به وزن بیشتر، هدف «حجم»"} را انتخاب کنید.
        </p>
      )}
      {forecast?.mode === "ok" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <div className="p-4 rounded-2xl text-white" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <p className="text-sm font-bold leading-relaxed">
              با این {dailyDiff! < 0 ? "کسری" : "مازاد"} کالری، هفته‌ای حدود{" "}
              <strong className="font-stat">{toPersianDigits(forecast.weeklyKg)}</strong> کیلوگرم{" "}
              {forecast.dir === "loss" ? "کم می‌کنید" : "اضافه می‌کنید"} و در{" "}
              <strong className="font-stat">{toPersianDigits(forecast.weeks)}</strong> هفته{" "}
              ({toPersianDigits(forecast.months)} ماه) به وزن هدف{" "}
              <strong className="font-stat">{toPersianDigits(target)}</strong> کیلوگرم می‌رسید.
            </p>
          </div>
          {/* خط زمانی ساده */}
          <div className="mt-4 px-2">
            <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #f97316, #f59e0b)" }}
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 1, delay: 0.2 }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
              <span>امروز: {toPersianDigits(Math.round(current ?? 0))} کیلوگرم</span>
              <span>نیمهٔ راه ≈ هفتهٔ {toPersianDigits(Math.ceil(forecast.weeks / 2))}</span>
              <span>هدف: {toPersianDigits(target)} کیلوگرم</span>
            </div>
          </div>
          {age !== null && forecast.weeks > 60 && (
            <p className="mt-3 text-[11px] text-amber-600 font-bold">
              ⚠️ مسیر طولانی است — بهتر است آن را به چند مرحلهٔ ۸ تا ۱۲ هفته‌ای با دوره‌های تثبیت تقسیم کنید.
            </p>
          )}
        </motion.div>
      )}
      <InfoLine>
        پایهٔ محاسبه: هر کیلوگرم چربی بدن تقریباً ۷۷۰۰ کیلوکالری انرژی است؛ پس کسری ۵۰۰ کالری در روز، حدود نیم کیلوگرم کاهش وزن در هفته ایجاد می‌کند. وزن روی ترازو به‌خاطر آب و گلیکوژن نوسان دارد — روند هفتگی مهم است نه عدد روزانه.
      </InfoLine>
    </Card>
  );
}

// ═══════════ اجزای کمکی ═══════════
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-2xl bg-orange-50/60 border border-orange-100 text-center">
      <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-black font-stat text-slate-900">{value}</p>
    </div>
  );
}

function InfoLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-2 p-3 rounded-2xl bg-slate-50 text-[11px] leading-relaxed text-slate-500">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-orange-400" />
      <p>{children}</p>
    </div>
  );
}

function MissingInput({ text }: { text: string }) {
  return (
    <Card className="p-8 bg-white border-2 border-dashed rounded-3xl text-center" style={{ borderColor: "#fed7aa" }}>
      <p className="text-sm text-slate-400">{text}</p>
    </Card>
  );
}
