"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v113 — تک‌نسخه‌سازی «بانک حرکات» — رندر مشترک همه‌ی مسیرهای ورود
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * تا v112 «دو» پیاده‌سازی موازی برای /exercises وجود داشت (اسکرین SPA با
 * pushState و صفحهٔ SSR) که با رفرش بین طراحی‌ها گیج می‌شد (گزارش مالک).
 * حالا این کامپوننت «تنها» رندرکنندهٔ بانک حرکات است — داده در سرور خوانده
 * و به‌عنوان prop تزریق می‌شود؛ جستجو/فیلتر سمت کلاینت روی همان داده انجام
 * می‌شود (بدون fetch) و هر کارت لینک واقعی /exercise/<id> است.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Dumbbell, Search, Filter, Youtube, Clapperboard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toPersianDigits, equipmentFa } from "@/lib/fitness/types";
import { exerciseMatchesSearch } from "@/lib/fitness/exercise-search";
import { trackToolUsage } from "@/lib/fitness/tool-funnel";

/** لینک واقعی Next با انیمیشن کارت (framer-motion 12: motion.create) */
const MotionLink = motion.create(Link);

export interface ExerciseBankItem {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  youtubeUrl: string; // v113 — پالایش‌شده در سرور (کلیدهای یوتیوب اعمال شده)
  videoUrl: string;
}

const MUSCLE_GROUPS = [
  { id: "all", label: "همه" },
  { id: "سینه", label: "سینه" },
  { id: "پشت", label: "پشت" },
  { id: "پا", label: "پا" },
  { id: "پا و باسن", label: "پا و باسن" },
  { id: "سرشانه", label: "سرشانه" },
  { id: "جلوبازو", label: "جلوبازو" },
  { id: "پشت‌بازو", label: "پشت‌بازو" },
  { id: "زیربغل", label: "زیربغل" },
  { id: "شکم", label: "شکم" },
  { id: "کمر و پشت", label: "کمر و پشت" },
  { id: "جلو ران", label: "جلو ران" },
  { id: "پشت ران", label: "پشت ران" },
  { id: "سینه و دست", label: "سینه و دست" },
];

const EQUIPMENT_FILTERS = [
  { id: "all", label: "همه تجهیزات" },
  { id: "dumbbell", label: "دمبل" },
  { id: "barbell", label: "هالتر" },
  { id: "machine", label: "دستگاه" },
  { id: "bodyweight", label: "وزن بدن" },
];

const DIFFICULTY_LABELS: Record<string, string> = { beginner: "مبتدی", intermediate: "متوسط", advanced: "پیشرفته" };
const DIFFICULTY_COLORS: Record<string, string> = { beginner: "bg-emerald-100 text-emerald-700", intermediate: "bg-amber-100 text-amber-700", advanced: "bg-red-100 text-red-700" };

export function ExerciseBankView({ exercises }: { exercises: ExerciseBankItem[] }) {
  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState("all");
  const [equipment, setEquipment] = useState("all");
  // قیف تبدیل (Task 5-e) — هر عبارت جستجوشده فقط یک‌بار ثبت می‌شود
  const trackedRef = useRef<Set<string>>(new Set<string>());

  const filtered = useMemo(() => {
    const q = search.trim();
    const baseOk = (ex: ExerciseBankItem) => {
      if (muscle !== "all" && ex.muscle !== muscle) return false;
      if (equipment !== "all" && !ex.equipment.includes(equipment)) return false;
      return true;
    };
    const matches = (ex: ExerciseBankItem, query: string) =>
      // v114 — جستجوی مترادف‌محور: «پرس زیر سینه» ← پرس سینه با شیب منفی،
      // «بایسپس» ← جلو بازو، «اینکلاین» ← بالاسینه، «اسکات» ← اسکوات و…
      exerciseMatchesSearch(
        { name: ex.name, muscle: ex.muscle, equipment: ex.equipment, description: null },
        query
      );
    let list = exercises.filter((ex) => baseOk(ex) && (!q || matches(ex, q)));
    // v116 — فالبک نام‌های بلند: «… با …» صفر نتیجه → حذف پسوند «با X» و تلاش دوباره
    // (تضمین درخواست مالک: هر حرکتی که در برنامهٔ ورزشکار آمده پیدا شود)
    if (q && list.length === 0) {
      const stripped = q.replace(/\s+با\s+\S+\s*$/u, "").trim();
      if (stripped && stripped !== q) {
        list = exercises.filter((ex) => baseOk(ex) && matches(ex, stripped));
      }
    }
    return list;
  }, [exercises, search, muscle, equipment]);

  function onSearchChange(value: string) {
    setSearch(value);
    const q = value.trim();
    if (q.length >= 2 && !trackedRef.current.has(q)) {
      trackedRef.current.add(q);
      const hits = exercises.filter((ex) => ex.name.includes(q)).length;
      if (hits > 0) trackToolUsage("exercises", q);
    }
  }

  return (
    <div>
      {/* جستجو + فیلترها */}
      <div className="space-y-3 mb-6">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="جستجوی حرکات..."
            className="pr-10 rounded-xl border-2"
            style={{ borderColor: "#fed7aa" }}
            aria-label="جستجوی حرکات"
          />
        </div>

        {/* گروه‌های عضلانی */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {MUSCLE_GROUPS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMuscle(m.id)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition ${muscle === m.id ? "text-white shadow-md" : "bg-slate-100 text-slate-600"}`}
              style={muscle === m.id ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* فیلتر تجهیزات */}
        <div className="flex gap-2 flex-wrap">
          {EQUIPMENT_FILTERS.map((e) => (
            <button
              key={e.id}
              onClick={() => setEquipment(e.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${equipment === e.id ? "bg-orange-100 text-orange-600 border border-orange-300" : "bg-slate-50 text-slate-500 border border-slate-200"}`}
            >
              <Filter className="w-3 h-3 inline ml-1" />
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* تعداد نتایج */}
      <p className="text-xs text-slate-400 mb-3" aria-live="polite">
        {toPersianDigits(filtered.length)} حرکت یافت شد
      </p>

      {/* گرید کارت‌ها */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Dumbbell className="w-16 h-16 mx-auto mb-3 text-slate-200" />
          <p className="text-sm text-slate-400">حرکتی با این فیلتر یافت نشد</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ex, i) => {
            const hasCustom = !!ex.videoUrl && ex.videoUrl.trim() !== "";
            const hasYoutube = !hasCustom && !!ex.youtubeUrl && ex.youtubeUrl.trim() !== "";
            return (
              <MotionLink
                key={ex.id}
                href={`/exercise/${encodeURIComponent(ex.id)}`}
                prefetch={false} /* v137: با ۵۸۱+ لینک، prefetch همه = انفجار RSC/لگ — کلیک کاربر راحت‌تر است */
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 12) * 0.03 }}
                whileHover={{ y: -4 }}
                className="block text-right bg-white rounded-2xl border-2 p-4 transition hover:shadow-lg"
                style={{ borderColor: "#fed7aa" }}
              >
                  {/* بج‌ها — ویدیو + سطح دشواری */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                      <Dumbbell className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* v113 — بج ویدیو: اختصاصی (سبز) اولویت دارد، یوتیوب (قرمز) فال‌بک */}
                      {hasCustom ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[9px] font-bold text-emerald-700 shrink-0">
                          <Clapperboard className="w-3 h-3" />
                          ویدیو
                        </span>
                      ) : hasYoutube ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[9px] font-bold text-red-600 shrink-0">
                          <Youtube className="w-3 h-3" />
                          ویدیو
                        </span>
                      ) : null}
                      <Badge className={`text-[9px] shrink-0 ${DIFFICULTY_COLORS[ex.difficulty] || "bg-slate-100 text-slate-600"}`}>
                        {DIFFICULTY_LABELS[ex.difficulty] || ex.difficulty}
                      </Badge>
                    </div>
                  </div>
                  <h3 className="font-bold text-sm text-slate-900 mb-1">{ex.name}</h3>
                  <p className="text-[11px] text-slate-500 mb-2">{ex.muscle}</p>
                  {ex.equipment && (
                    <div className="flex flex-wrap gap-1">
                      {ex.equipment.split(",").slice(0, 3).map((eq, j) => (
                        <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          {equipmentFa(eq.trim()) || eq.trim()}
                        </span>
                      ))}
                    </div>
                  )}
              </MotionLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
