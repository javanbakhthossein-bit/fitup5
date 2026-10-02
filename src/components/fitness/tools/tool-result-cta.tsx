"use client";

import { motion } from "framer-motion";
import { Sparkles, ChevronLeft, ArrowLeft } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { pushScreen, replaceScreen, smartNavigate, isSpaMounted } from "@/lib/fitness/navigation";

/**
 * ToolResultCta — کارت CTA نازکِ بعد از نتیجهٔ ابزارهای رایگان (Task 5-e)
 *
 * دقیقاً بعد از نتیجهٔ موفق (محاسبهٔ TDEE / جستجوی غذا / جستجوی حرکت) نمایش
 * داده می‌شود و کاربر را به قیف «ثبت‌نام/برنامهٔ اختصاصی» می‌برد:
 *  - مهمان → دکمهٔ «رایگان ثبت‌نام کن و برنامه بگیر» → صفحهٔ auth
 *    (همان الگوی smartNavigate(false, …) که CTAهای لندینگ استفاده می‌کنند)
 *  - لاگین → دکمهٔ «برنامهٔ اختصاصی من را بساز» → لندینگ + اسکرول به #pricing
 *    (دقیقاً همان ناوبری tools/cta-section.tsx — بدون دوباره‌کاری)
 */

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

const TOOL_COPY: Record<string, { headline: string; sub: string }> = {
  tdee: {
    headline: "حالا که کالری‌ات را می‌دانی…",
    sub: "برنامهٔ کامل تمرین و تغذیهٔ اختصاصی بر اساس همین اعداد ساخته می‌شود",
  },
  foods: {
    headline: "کالری همهٔ غذاها را می‌دانی — وقت برنامه‌سازی است",
    sub: "فیتاپ همین غذاها را در یک برنامهٔ غذایی اختصاصی با گرم‌های دقیق برایت می‌چیند",
  },
  exercises: {
    headline: "حرکات را بلدی — حالا برنامه داشته باش",
    sub: "همین حرکات با ست/تکرار و استراحت دقیق، در برنامهٔ تمرینی اختصاصی بدن تو کنار هم قرار می‌گیرند",
  },
};

export function ToolResultCta({ tool }: { tool: "tdee" | "foods" | "exercises" }) {
  const { user, setScreen } = useAppStore();
  const copy = TOOL_COPY[tool];

  // مهمان → صفحهٔ auth (همان مسیری که دکمه‌های «شروع کنید» لندینگ می‌روند)
  function handleGuest() {
    // v106: بیرون از SPA (روت مستقل /tdee و…) ناوبری واقعی — اپ auth
    // کوئری‌استایل است و page-client با URL کار می‌کند
    if (!isSpaMounted()) {
      window.location.assign("/?screen=auth");
      return;
    }
    smartNavigate(false, setScreen, false);
  }

  // لاگین → لندینگ + اسکرول به بخش پلن‌ها (کپی ناوبری tools/cta-section.tsx)
  function handleAuthed() {
    // v106: بیرون از SPA ناوبری واقعی
    if (!isSpaMounted()) {
      window.location.assign("/#pricing");
      return;
    }
    setScreen("landing");
    replaceScreen("landing");
    setTimeout(() => {
      const pricingSection = document.getElementById("pricing");
      if (pricingSection) {
        pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 500);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl p-[1.5px] shadow-lg shadow-orange-500/15"
      style={{ background: goldGradient }}
    >
      <div className="relative rounded-[calc(1rem-1px)] bg-white p-4 sm:p-5 overflow-hidden">
        {/* هالهٔ تزئینی */}
        <div className="absolute -top-10 -left-10 w-28 h-28 rounded-full bg-amber-100/50 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-orange-500 shrink-0" />
              {copy.headline}
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{copy.sub}</p>
          </div>
          {user ? (
            <button
              onClick={handleAuthed}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl text-sm font-black text-white shadow-md shadow-orange-500/25 hover:scale-[1.02] transition-all"
              style={{ background: goldGradient }}
            >
              برنامهٔ اختصاصی من را بساز
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleGuest}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl text-sm font-black text-white shadow-md shadow-orange-500/25 hover:scale-[1.02] transition-all"
              style={{ background: goldGradient }}
            >
              رایگان ثبت‌نام کن و برنامه بگیر
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
