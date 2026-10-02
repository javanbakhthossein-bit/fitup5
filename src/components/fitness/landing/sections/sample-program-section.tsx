"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Dumbbell,
  Salad,
  Pill,
  Timer,
  Flame,
  ChevronLeft,
  Repeat,
  Beef,
  Crown,
  ArrowLeftRight,
  Check,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { smartNavigate } from "@/lib/fitness/navigation";
import {
  SAMPLE_PROGRAM,
  NUTRITION_PROGRAM_FEATURES,
  WORKOUT_PROGRAM_FEATURES,
} from "@/lib/fitness/sample-program";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * SampleProgramSection — ویترین «نمونهٔ برنامه» در لندینگ (Task 5-c)
 *
 * کاربر قبل از خرید باید دقیقاً ببیند چه چیزی دریافت می‌کند. محتوا کاملاً
 * ایستا و حرفه‌ای است (از SAMPLE_PROGRAM — بدون هزینهٔ AI). سه تب
 * تمرین/تغذیه/مکمل با انیمیشن نرم + CTA ثبت‌نام (همان الگوی سایر سکشن‌ها).
 */

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

type TabId = "workout" | "nutrition" | "supplements";

const TABS: { id: TabId; label: string; icon: typeof Dumbbell }[] = [
  { id: "workout", label: "تمرین", icon: Dumbbell },
  { id: "nutrition", label: "تغذیه", icon: Salad },
  { id: "supplements", label: "مکمل", icon: Pill },
];

export function SampleProgramSection() {
  const { user, setScreen } = useAppStore();
  const [tab, setTab] = useState<TabId>("workout");

  return (
    <section id="sample-program" className="py-20 sm:py-28 bg-white relative overflow-hidden scroll-mt-20">
      {/* پس‌زمینهٔ ملایم طلایی — هم‌سو با بقیهٔ سکشن‌ها */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-10 -left-24 w-96 h-96 rounded-full bg-amber-200/25 blur-3xl" />
        <div className="absolute bottom-10 -right-24 w-80 h-80 rounded-full bg-orange-200/20 blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* ─── سربرگ سکشن ─── */}
        <div className="animate-fade-in-up text-center mb-10">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-4"
            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}
          >
            <Sparkles className="w-4 h-4" />
            نمونهٔ واقعی از برنامهٔ تولیدی هوش مصنوعی
          </div>
          <h2 className="text-3xl sm:text-4xl font-black mb-4 text-slate-900">
            قبل از خرید،{" "}
            <span
              style={{
                background: goldGradient,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              دقیقاً ببین
            </span>{" "}
            چه چیزی می‌گیری
          </h2>
          <p className="text-slate-500 max-w-2xl mx-auto leading-relaxed">
            این یک نمونهٔ واقعی از خروجی فیتاپ است — نه عکس قلابی، نه وعدهٔ توخالی.
            برنامهٔ تو هم دقیقاً با همین کیفیت و مخصوص بدن، هدف و تجهیزات خودت ساخته می‌شود.
          </p>
        </div>

        {/* ─── کارت اصلی ویترین ─── */}
        <div className="animate-fade-in-up max-w-4xl mx-auto" style={{ animationDelay: "0.1s" }}>
          <div className="relative bg-white rounded-[2rem] sm:rounded-[2.5rem] border-2 border-orange-200 shadow-2xl shadow-orange-500/10 overflow-hidden">
            {/* هدر گرادیانی کارت */}
            <div
              className="relative px-5 sm:px-8 py-5 text-white overflow-hidden"
              style={{ background: goldGradient }}
            >
              {/* shimmer ظریف — همان الگوی CtaSection */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)",
                  backgroundSize: "200% 100%",
                  animation: "gold-shimmer 4s infinite linear",
                }}
              />
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
              <div className="relative flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                    <Dumbbell className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-black text-base sm:text-lg leading-tight">
                      {SAMPLE_PROGRAM.workout.dayLabel}
                    </p>
                    <p className="text-xs text-white/85 mt-0.5">
                      فاز فعلی: {SAMPLE_PROGRAM.workout.focus} · جلسهٔ {toPersianDigits(1)} از {toPersianDigits(4)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-xs font-bold">
                    <Flame className="w-3.5 h-3.5" />
                    {SAMPLE_PROGRAM.nutrition.calories} کالری
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-xs font-bold">
                    <Beef className="w-3.5 h-3.5" />
                    {SAMPLE_PROGRAM.nutrition.protein}
                  </span>
                </div>
              </div>
            </div>

            {/* ─── سوییچر تب‌ها ─── */}
            <div className="px-4 sm:px-8 pt-5">
              <div
                className="inline-flex w-full sm:w-auto p-1 rounded-2xl bg-orange-50 border border-orange-100 gap-1"
                role="tablist"
                aria-label="بخش‌های برنامهٔ نمونه"
              >
                {TABS.map((t) => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.id)}
                      className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all ${
                        active
                          ? "text-white shadow-md shadow-orange-500/25"
                          : "text-orange-700/70 hover:text-orange-700"
                      }`}
                      style={active ? { background: goldGradient } : undefined}
                    >
                      <t.icon className="w-4 h-4" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ─── محتوای تب‌ها ─── */}
            <div className="px-4 sm:px-8 py-5 sm:py-6 min-h-[380px] sm:min-h-[340px]">
              <AnimatePresence mode="wait">
                {tab === "workout" && (
                  <motion.div
                    key="workout"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-2.5"
                  >
                    {SAMPLE_PROGRAM.workout.exercises.map((ex, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 p-3.5 rounded-2xl border border-orange-100 bg-gradient-to-l from-orange-50/40 to-transparent hover:border-orange-300 hover:shadow-sm transition-all"
                      >
                        {/* شمارهٔ حرکت */}
                        <span
                          className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-white shrink-0"
                          style={{ background: goldGradient }}
                        >
                          {toPersianDigits(i + 1)}
                        </span>
                        <div className="flex-1 min-w-[130px]">
                          <p className="text-sm font-bold text-slate-900">{ex.name}</p>
                          {ex.note && (
                            <p className="text-[10px] text-amber-700 flex items-center gap-1 mt-0.5">
                              <Repeat className="w-3 h-3 shrink-0" />
                              {ex.note}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-center">
                          <span className="px-2.5 py-1 rounded-lg bg-orange-50 text-[11px] font-black text-orange-700 whitespace-nowrap">
                            {toPersianDigits(ex.sets)} ست
                          </span>
                          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-[11px] font-black text-amber-700 whitespace-nowrap">
                            {toPersianDigits(ex.reps)} تکرار
                          </span>
                          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 text-[11px] font-bold text-slate-600 whitespace-nowrap">
                            <Timer className="w-3 h-3" />
                            {ex.rest}
                          </span>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}

                {tab === "nutrition" && (
                  <motion.div
                    key="nutrition"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25 }}
                  >
                    {/* کالری هدف */}
                    <div
                      className="relative rounded-2xl p-4 sm:p-5 mb-4 text-center overflow-hidden"
                      style={{ background: "linear-gradient(135deg, #fff7ed, #fffbeb)", border: "1px solid #fed7aa" }}
                    >
                      <p className="text-[11px] text-slate-500 mb-1">کالری هدف روزانه</p>
                      <p className="text-3xl sm:text-4xl font-black font-stat text-orange-600 leading-none">
                        {SAMPLE_PROGRAM.nutrition.calories}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1.5">
                        {SAMPLE_PROGRAM.nutrition.protein} · تقسیم‌شده روی {toPersianDigits(SAMPLE_PROGRAM.nutrition.meals.length)} وعده
                      </p>
                    </div>
                    {/* وعده‌ها — v87: هر وعده با ۲ وعدهٔ جایگزین (مثل برنامهٔ واقعی) */}
                    <div className="grid sm:grid-cols-2 gap-2.5">
                      {SAMPLE_PROGRAM.nutrition.meals.map((meal, i) => (
                        <div
                          key={i}
                          className="p-3.5 rounded-2xl border border-orange-100 bg-white hover:border-orange-300 hover:shadow-sm transition-all flex flex-col"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                              style={{ background: goldGradient }}
                            >
                              <Salad className="w-3.5 h-3.5" />
                            </span>
                            <p className="text-xs font-black text-slate-900">{meal.name}</p>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">{meal.items}</p>
                          {/* ─── v87 — وعده‌های جایگزین (۲ گزینه — مثل برنامهٔ واقعی) ─── */}
                          {meal.alternatives.length > 0 && (
                            <div className="mt-2.5 rounded-xl bg-violet-50/60 border border-violet-100 p-2.5">
                              <p className="text-[10px] font-black text-violet-700 flex items-center gap-1 mb-1.5">
                                <ArrowLeftRight className="w-3 h-3 shrink-0" />
                                ۲ وعدهٔ جایگزین — هرکدام را دوست داشتی جایگزین کن:
                              </p>
                              <div className="space-y-1">
                                {meal.alternatives.map((alt, ai) => (
                                  <div
                                    key={ai}
                                    className="flex items-start gap-1.5 p-1.5 rounded-lg bg-white border border-violet-100"
                                  >
                                    <span className="text-[9px] font-black text-white bg-violet-500 rounded-md px-1.5 py-0.5 shrink-0 mt-0.5">
                                      گزینهٔ {toPersianDigits(ai + 1)}
                                    </span>
                                    <p className="text-[10.5px] text-violet-800 leading-relaxed min-w-0">{alt}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* ─── v87 — امکانات برنامهٔ تغذیهٔ کامل (بیشتر از آنچه در نمونه دیدی) ─── */}
                    <div
                      className="mt-4 rounded-2xl p-3.5 sm:p-4"
                      style={{ background: "linear-gradient(135deg, #fff7ed, #fffbeb)", border: "1px solid #fed7aa" }}
                    >
                      <p className="text-[11px] font-black text-orange-700 flex items-center gap-1.5 mb-2">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        برنامهٔ تغذیهٔ تو علاوه بر این‌ها چه دارد؟
                      </p>
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {NUTRITION_PROGRAM_FEATURES.map((f, i) => (
                          <p key={i} className="text-[10.5px] text-slate-600 flex items-start gap-1.5 leading-relaxed">
                            <Check className="w-3 h-3 text-orange-500 shrink-0 mt-0.5" strokeWidth={3} />
                            {f}
                          </p>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {tab === "supplements" && (
                  <motion.div
                    key="supplements"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-2.5"
                  >
                    {SAMPLE_PROGRAM.supplements.map((sup, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3.5 p-3.5 rounded-2xl border border-orange-100 bg-gradient-to-l from-orange-50/40 to-transparent hover:border-orange-300 hover:shadow-sm transition-all"
                      >
                        <span
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                          style={{ background: goldGradient }}
                        >
                          <Pill className="w-5 h-5" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-slate-900">{sup.name}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">زمان مصرف: {sup.when}</p>
                        </div>
                        <span className="px-3 py-1.5 rounded-xl bg-amber-50 text-xs font-black text-amber-700 whitespace-nowrap">
                          {sup.dose}
                        </span>
                      </div>
                    ))}
                    {/* ─── v87 — امکانات برنامهٔ تمرینی کامل (درب تمرین) ─── */}
                    <div
                      className="rounded-2xl p-3.5 sm:p-4"
                      style={{ background: "linear-gradient(135deg, #fff7ed, #fffbeb)", border: "1px solid #fed7aa" }}
                    >
                      <p className="text-[11px] font-black text-orange-700 flex items-center gap-1.5 mb-2">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        برنامهٔ تمرینی تو علاوه بر این‌ها چه دارد؟
                      </p>
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {WORKOUT_PROGRAM_FEATURES.map((f, i) => (
                          <p key={i} className="text-[10.5px] text-slate-600 flex items-start gap-1.5 leading-relaxed">
                            <Check className="w-3 h-3 text-orange-500 shrink-0 mt-0.5" strokeWidth={3} />
                            {f}
                          </p>
                        ))}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed pt-1 px-1">
                      مکمل‌ها اجباری نیستند — فیتاپ بر اساس بودجه و سلیقهٔ شما برنامه را تنظیم می‌کند.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ─── CTA پایین کارت ─── */}
            <div className="px-4 sm:px-8 pb-6 sm:pb-8">
              <div
                className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3"
                style={{ background: "linear-gradient(135deg, #fff7ed, #fffbeb)", border: "1px solid #fed7aa" }}
              >
                <div className="text-center sm:text-right">
                  <p className="text-sm font-black text-slate-900 flex items-center justify-center sm:justify-start gap-1.5">
                    <Crown className="w-4 h-4 text-orange-500" />
                    برنامهٔ تو حتی کامل‌تر از این است
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    برای هر وعده ۲ گزینهٔ جایگزین · تحلیل ویدیویی فرم بدن · آنالیز عکس غذا و آزمایش خون
                  </p>
                </div>
                <button
                  onClick={() => smartNavigate(!!user, setScreen, user?.onboardingDone)}
                  className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 h-12 px-6 font-black text-white rounded-2xl shadow-lg shadow-orange-500/30 hover:scale-[1.02] hover:shadow-xl hover:shadow-orange-500/40 transition-all duration-200"
                  style={{ background: goldGradient }}
                >
                  برنامهٔ اختصاصی من را بساز
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
