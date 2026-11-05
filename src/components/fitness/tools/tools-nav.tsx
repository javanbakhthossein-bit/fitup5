"use client";

import { Dumbbell, Calculator, Apple, Home, Gift, Scale, Weight, Drumstick } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { pushScreen, replaceScreen, isSpaMounted, navigateToExercises, navigateToFoods, navigateToTdee } from "@/lib/fitness/navigation";

/**
 * v123 — هماهنگ‌سازی کامل ابزارهای رایگان (درخواست مالک):
 * صفحات SSR ابزارها (/tdee ، /exercises ، /foods و…) همه از همین ToolsNav
 * با دکمه‌های جابجایی بین ابزارها استفاده می‌کنند و با پراپ «active» ابزار
 * خودشان را در نوار هایلایت می‌کنند. بدون پراپ، هایلایت مثل قبل از store
 * خوانده می‌شود (زمینهٔ SPA).
 *
 * v252 — دیرکتیو مالک (دو فیکس مهم):
 *  ① ترتیب جدید نوار: بانک حرکات ← کالری غذاها ← برنامه‌های رایگان ←
 *    محاسبه‌گر کالری ← بقیه محاسبه‌گرها (BMI، 1RM، ماکرو).
 *  ② طراحی مینیمال و تک‌خطی: قبلاً ۷ دکمهٔ درشت در max-w-5xl جا نمی‌شدند و
 *    برچسب‌ها دوخطی می‌شدند («محاسبه» بالا و «ماکرو» پایین) و همه‌چیز
 *    توی‌هم‌ریخته بود. حالا: برچسب‌های کوتاه (ماکرو، BMI، 1RM، کالری)،
 *    whitespace-nowrap (تضمین تک‌خطی)، متن ۱۲px، پدینگ فشرده، کانتینر عریض‌تر
 *    (max-w-6xl) و حذف آیکون در دسکتاپ فقط برای دکمه فعال — نوار همیشه تک‌خطی
 *    و مرتب می‌ماند. در موبایل اسکرول افقی با برچسب کامل + آیکون (خواناتر).
 */
export type ToolNavActive = "tool-tdee" | "tool-exercises" | "tool-foods" | "tool-free-programs" | "tool-bmi" | "tool-1rm" | "tool-macro";

/**
 * v252 — ترتیب جدید (دیرکتیو مالک): بانک حرکات → کالری غذاها → برنامه‌های
 * رایگان → محاسبه کالری → بقیه محاسبه‌گرها.
 * shortLabel: نسخهٔ فشردهٔ تک‌خطی برای نوار دسکتاپ.
 */
const TOOLS: { id: string; label: string; shortLabel?: string; icon: typeof Dumbbell; url: string }[] = [
  { id: "tool-exercises", label: "بانک حرکات", icon: Dumbbell, url: "exercises" },
  { id: "tool-foods", label: "کالری غذاها", icon: Apple, url: "foods" },
  // v246-free-programs — قیف جذب «برنامه‌های بدنسازی رایگان» روی نوار واحد ابزارها
  { id: "tool-free-programs", label: "برنامه‌های رایگان", shortLabel: "برنامه‌ها", icon: Gift, url: "free-programs" },
  { id: "tool-tdee", label: "محاسبه‌گر کالری", shortLabel: "کالری", icon: Calculator, url: "tdee" },
  { id: "tool-bmi", label: "محاسبه BMI", shortLabel: "BMI", icon: Scale, url: "bmi" },
  { id: "tool-1rm", label: "محاسبه 1RM", shortLabel: "1RM", icon: Weight, url: "1rm" },
  { id: "tool-macro", label: "محاسبه ماکرو", shortLabel: "ماکرو", icon: Drumstick, url: "macro" },
];

export function ToolsNav({ active }: { active?: ToolNavActive }) {
  const { screen, setScreen } = useAppStore();
  // روی صفحات SSR، store مقدار پیش‌فرض دارد — پراپ active اولویت دارد
  const activeTool = active ?? screen;

  function goToTool(toolId: string, toolUrl: string) {
    // v113/v118/v119 — همهٔ ابزارها در هر زمینه‌ای (SPA یا SSR) به مسیر واقعی می‌روند
    if (toolUrl === "exercises") {
      navigateToExercises();
      return;
    }
    if (toolUrl === "foods") {
      navigateToFoods();
      return;
    }
    if (toolUrl === "tdee") {
      navigateToTdee();
      return;
    }
    // سایر مقصدها — ناوبری واقعی به مسیر خود ابزار
    // (v246-free-programs: "free-programs" هم با همین شاخه به /free-programs می‌رود)
    window.location.assign(`/${toolUrl}`);
  }

  function goHome() {
    if (!isSpaMounted()) {
      window.location.assign("/");
      return;
    }
    setScreen("landing");
    replaceScreen("landing");
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur-xl border-b shadow-sm" style={{ borderColor: "#fed7aa" }}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-2">
          {/* Right: logo + home */}
          <div className="flex items-center shrink-0">
            <button onClick={goHome} className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md overflow-hidden" style={{ background: "linear-gradient(135deg, #fb923c, #f97316)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
              </div>
              <span className="font-black text-base text-slate-900 hidden min-[420px]:inline">فیتاپ</span>
            </button>
          </div>

          {/* Center: tool links — v252 مینیمال تک‌خطی (whitespace-nowrap تضمین می‌کند
              هیچ برچسبی هرگز بشکند؛ حتی در عرض‌های باریک دسکتاپ) */}
          <nav className="hidden md:flex items-center gap-0.5 min-w-0 overflow-hidden">
            {TOOLS.map((t) => {
              const isActive = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => goToTool(t.id, t.url)}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-2 rounded-xl text-xs xl:text-[13px] font-bold whitespace-nowrap transition ${
                    isActive ? "text-white shadow-sm" : "text-slate-600 hover:bg-orange-50 hover:text-orange-600"
                  }`}
                  style={isActive ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
                >
                  <t.icon className="w-3.5 h-3.5 shrink-0" />
                  {/* برچسب فشرده در دسکتاپ باریک، کامل در xl */}
                  <span className="xl:hidden">{t.shortLabel ?? t.label}</span>
                  <span className="hidden xl:inline">{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Left: home */}
          <button onClick={goHome} className="p-2 rounded-lg hover:bg-slate-100 transition shrink-0" aria-label="صفحه اصلی فیتاپ">
            <Home className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Mobile tool links — اسکرول افقی تک‌خطی با برچسب کامل (v252: shrink-0 +
            whitespace-nowrap تا هیچ دکمه‌ای دوخطی نشود) */}
        <div className="flex md:hidden items-center gap-1.5 pb-2 overflow-x-auto no-scrollbar">
          {TOOLS.map((t) => {
            const isActive = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => goToTool(t.id, t.url)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
                  isActive ? "text-white shadow-sm" : "text-slate-600 bg-slate-100"
                }`}
                style={isActive ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
              >
                <t.icon className="w-3.5 h-3.5 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
