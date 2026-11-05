"use client";

/**
 * v103 — سکشن «رشته‌های ورزشی» لندینگ (دیرکتیو مالک):
 *
 *   «من برای بخش رشته‌های ورزشی در صفحه اصلی نگفتم فقط رشته‌های اصلی مثل
 *   تی‌آر‌ایکس و پیلاتس و اینجور چیزا رو بذار، گفتم همهٔ رشته‌های موجود در
 *   آنبردینگ مثل فیزیک آقایان، فیزیک بانوان، ولنس، بادی بیلدینگ، پاورلیفتینگ
 *   همه اینا رو … به تفکیک خانم و آقا بذار و تب اول آقایون باشه پیش‌فرض،
 *   بعد بانوان»
 *
 *   ۱) بج بالا فقط «رشته‌های ورزشی».
 *   ۲) دو تب «آقایان (پیش‌فرض) / بانوان» — کارت‌ها با getDisciplinesByGender
 *      فیلتر و به ترتیب آنبوردینگ (DISCIPLINE_ORDER) چیده می‌شوند — هر تب ۱۳ رشته.
 *   ۳) کارت هر رشته لینک واقعی و کرال‌پذیر به لندینگ اختصاصی است: /sport/<slug>
 */

import { useState } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { getDisciplinesByGender } from "@/lib/fitness/disciplines-data";

type GenderTab = "men" | "women";

const TABS: { key: GenderTab; label: string }[] = [
  { key: "men", label: "آقایان" },
  { key: "women", label: "بانوان" },
];

const ACCENTS: Record<string, string> = {
  pilates: "from-emerald-500 to-teal-500",
  trx: "from-slate-600 to-slate-800",
  hiit: "from-orange-500 to-red-500",
  functional: "from-amber-500 to-orange-600",
  balance: "from-cyan-600 to-teal-600",
  // v103 — رشته‌های جدید
  fitness: "from-orange-500 to-amber-600",
  bodybuilding: "from-red-600 to-rose-700",
  classic_physique: "from-amber-600 to-yellow-600",
  mens_physique: "from-stone-600 to-amber-700",
  powerlifting: "from-zinc-700 to-slate-900",
  crossfit: "from-lime-600 to-green-600",
  calisthenics: "from-teal-600 to-emerald-600",
  general: "from-slate-500 to-slate-700",
  wellness: "from-rose-500 to-pink-600",
  bikini_fitness: "from-pink-500 to-rose-500",
  womens_fitness: "from-fuchsia-600 to-rose-500",
  womens_physique: "from-red-500 to-orange-600",
};

export function DisciplinesSection() {
  // دیرکتیو مالک: تب پیش‌فرض و اول «آقایان» است، بعد «بانوان»
  const [tab, setTab] = useState<GenderTab>("men");
  const cards = getDisciplinesByGender(tab);

  return (
    <section id="disciplines" className="py-20 sm:py-24 bg-gradient-to-b from-white to-orange-50/50 relative overflow-hidden scroll-mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-4"
            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}
          >
            <Sparkles className="w-4 h-4" />
            رشته‌های ورزشی
          </div>
          <h2 className="text-3xl sm:text-4xl font-black mb-4 text-slate-900">
            حالا با{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #f59e0b, #f97316)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              رشتهٔ خودت
            </span>{" "}
            تمرین کن
          </h2>
          <p className="text-slate-500 max-w-2xl mx-auto leading-7">
            از فیزیک و بادی‌بیلدینگ تا پیلاتس و کراس‌فیت — هر رشته لندینگ اختصاصی و برنامهٔ رشته‌محور دارد.
            رشته‌ات را در آنبوردینگ انتخاب کن تا برنامهٔ هفتگی دقیقاً با همان سبک و حرکات تخصصی‌اش برایت ساخته شود.
          </p>

          {/* ─── تب آقایان / بانوان ─── */}
          <div
            className="inline-flex items-center gap-1 p-1.5 rounded-2xl mt-7 bg-white border border-orange-100 shadow-sm"
            role="tablist"
            aria-label="رشته‌های ورزشی بر اساس جنسیت"
          >
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`px-6 sm:px-10 py-2.5 rounded-xl text-sm font-black transition-all ${
                    active
                      ? "text-white shadow-md scale-[1.02]"
                      : "text-slate-500 hover:text-orange-600"
                  }`}
                  style={active ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : undefined}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── کارت‌های تب فعال — لینک واقعی به /sport/<slug> ─── */}
        {/* v113 — دیرکتیو مالک: ایموجی/شکلک رشته‌ها حذف شد — طراحی تمیز بدون آیکون */}
        <div key={tab} className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {cards.map((d) => (
            <a
              key={d.slug}
              href={`/sport/${d.slug}`}
              aria-label={`صفحهٔ رشتهٔ ${d.label}`}
              className="group relative bg-white rounded-2xl border-2 border-orange-100 hover:border-orange-300 p-4 pt-5 text-center transition-all hover:-translate-y-1.5 hover:shadow-xl hover:shadow-orange-500/10 overflow-hidden"
            >
              {/* نوار لهجهٔ رنگی رشته — جای ایموجی (بدون شکلک) */}
              <span
                aria-hidden
                className={`absolute top-0 right-4 left-4 h-1 rounded-b-full bg-gradient-to-l ${
                  ACCENTS[d.slug] || "from-orange-500 to-red-500"
                }`}
              />
              <p className="font-black text-sm text-slate-900">{d.label}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-4 line-clamp-2">{d.tagline}</p>
              <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-bold text-orange-600">
                بیشتر بدان
                <ChevronLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
