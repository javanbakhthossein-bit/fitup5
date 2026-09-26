"use client";

import { Dumbbell, Calculator, Apple, Home } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { pushScreen, replaceScreen, isSpaMounted, navigateToExercises, navigateToFoods, navigateToTdee } from "@/lib/fitness/navigation";

/**
 * v123 — هماهنگ‌سازی کامل سه ابزار رایگان (درخواست مالک):
 * صفحات SSR ابزارها (/tdee ، /exercises ، /foods) حالا «همه» از همین
 * ToolsNav با دکمه‌های جابجایی بین ابزارها استفاده می‌کنند و با پراپ
 * «active» ابزار خودشان را در نوار هایلایت می‌کنند (قبلاً فقط /tdee این
 * نوار را داشت و بانک حرکات/غذاها هدر ساده — طراحی ناهماهنگ گزارش مالک).
 * بدون پراپ، هایلایت مثل قبل از store خوانده می‌شود (زمینهٔ SPA).
 */
export type ToolNavActive = "tool-tdee" | "tool-exercises" | "tool-foods";

const TOOLS: { id: string; label: string; icon: typeof Dumbbell; url: string }[] = [
  { id: "tool-tdee", label: "محاسبه‌گر کالری", icon: Calculator, url: "tdee" },
  // v113 — بانک حرکات فقط مسیر واقعی SSR دارد (navigateToExercises)
  { id: "tool-exercises", label: "بانک حرکات", icon: Dumbbell, url: "exercises" },
  { id: "tool-foods", label: "کالری غذاها", icon: Apple, url: "foods" },
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
    // سایر مقصدهای آینده — ناوبری واقعی به مسیر خود ابزار
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
    <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-xl border-b shadow-sm" style={{ borderColor: "#fed7aa" }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Right: logo + home */}
          <div className="flex items-center gap-2.5">
            <button onClick={goHome} className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md overflow-hidden" style={{ background: "linear-gradient(135deg, #fb923c, #f97316)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
              </div>
              <span className="font-black text-base text-slate-900">فیتاپ</span>
            </button>
          </div>

          {/* Center: tool links */}
          <nav className="hidden sm:flex items-center gap-1">
            {TOOLS.map(t => (
              <button
                key={t.id}
                onClick={() => goToTool(t.id, t.url)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition ${
                  activeTool === t.id ? "text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                style={activeTool === t.id ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </nav>

          {/* Left: home */}
          <button onClick={goHome} className="p-2 rounded-lg hover:bg-slate-100 transition">
            <Home className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Mobile tool links */}
        <div className="flex sm:hidden items-center gap-1 pb-2 overflow-x-auto no-scrollbar">
          {TOOLS.map(t => (
            <button
              key={t.id}
              onClick={() => goToTool(t.id, t.url)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTool === t.id ? "text-white" : "text-slate-600 bg-slate-100"
              }`}
              style={activeTool === t.id ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
