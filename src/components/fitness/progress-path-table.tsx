"use client";

/**
 * ProgressPathTable — جدول «مسیر پیشرفت ۶برنامه‌ای» صفحهٔ تحلیل آنبوردینگ
 *
 * v135 — بازطراحی «خلاصه و واقعاً جدول» (دیرکتیو مالک):
 * نسخهٔ قبلی مفصل بود — هر ردیف چند خط متن زیر هم داشت و زیبا نبود.
 * حالا یک «جدول واقعی» فشرده با ۴ ستون است:
 *   برنامه | روزها | وزن پایان | اتفاق کلیدی (فقط یک جملهٔ کوتاه)
 * بدون لیست گلوله‌ای، بدون چیپ‌های جمع‌بندی اضافه، بدون پانویس طولانی.
 * ردیف رسیدن به هدف با گرادیان طلایی برجسته می‌شود.
 */

import { motion } from "framer-motion";
import { Target, Flag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toPersianDigits } from "@/lib/fitness/types";
import type { ProgressPath } from "@/lib/fitness/progress-path";

const GOLD_GRADIENT = "linear-gradient(135deg, #f59e0b, #f97316)";

/** وزن فشرده: «۸۳٫۰» — بدون واحد (واحد یک‌بار در سرستون) */
function faWeight(n: number): string {
  return toPersianDigits(n.toFixed(1).replace(".", "٫"));
}

export function ProgressPathTable({ path }: { path: ProgressPath }) {
  const hasWeights = path.programs.some((p) => p.startWeight != null && p.endWeight != null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.16 }}
    >
      <Card className="p-3.5 sm:p-4 border border-orange-100 shadow-sm relative overflow-hidden">
        {/* سربرگ فشرده — یک خط */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: GOLD_GRADIENT }}
            >
              <Target className="w-3.5 h-3.5 text-white" />
            </div>
            <h3 className="font-black text-slate-900 text-[13px] sm:text-sm leading-snug">
              مسیر پیشرفت تو — {toPersianDigits(path.programs.length)} برنامهٔ ۴۵ روزه
            </h3>
          </div>
          {path.targetWeight != null && (
            <span
              className="text-[10px] sm:text-[11px] font-black text-orange-700 whitespace-nowrap rounded-lg px-2 py-1"
              style={{ background: "linear-gradient(135deg, #fff7ed, #ffedd5)" }}
            >
              {faWeight(path.currentWeight)} ← {faWeight(path.targetWeight)} کیلوگرم
            </span>
          )}
        </div>

        {/* جدول واقعی و فشرده */}
        <div className="overflow-hidden rounded-xl border border-orange-100">
          <table className="w-full text-right border-collapse" dir="rtl">
            <thead>
              <tr className="bg-orange-50/80 text-[9.5px] sm:text-[10.5px] font-black text-slate-500">
                <th className="py-2 pr-2.5 pl-1 font-black">برنامه</th>
                {hasWeights && (
                  <th className="py-2 px-1.5 font-black text-center whitespace-nowrap">
                    وزن پایان
                    <span className="text-[8px] font-bold text-slate-400"> (کیلو)</span>
                  </th>
                )}
                <th className="py-2 px-1.5 font-black">اتفاق در پایان برنامه</th>
              </tr>
            </thead>
            <tbody>
              {path.programs.map((p) => {
                const goalRow = p.phase === "goal" && p.endWeight != null && path.targetWeight != null && p.endWeight === path.targetWeight;
                const highlighted = goalRow || p.isFinal;
                return (
                  <tr
                    key={p.index}
                    className={`border-t border-orange-100/70 ${highlighted ? "" : "bg-white"}`}
                    style={
                      highlighted
                        ? { background: "linear-gradient(135deg, #fffbeb, #fff7ed)" }
                        : undefined
                    }
                  >
                    {/* ستون برنامه — برچسب + بازه روز */}
                    <td className="py-2 pr-2.5 pl-1 align-middle whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[9.5px] sm:text-[10.5px] font-black px-1.5 py-0.5 rounded-full leading-none ${
                          highlighted
                            ? "text-white"
                            : p.phase === "post"
                              ? "text-teal-700 bg-teal-50 border border-teal-200"
                              : "text-orange-700 bg-orange-50 border border-orange-200"
                        }`}
                        style={highlighted ? { background: GOLD_GRADIENT } : undefined}
                      >
                        {goalRow && <Flag className="w-2.5 h-2.5" />}
                        {p.label}
                      </span>
                      <span className="block text-[8.5px] text-slate-400 font-bold mt-0.5">
                        روز {toPersianDigits(p.startDay)}–{toPersianDigits(p.endDay)}
                      </span>
                    </td>

                    {/* ستون وزن پایان */}
                    {hasWeights && (
                      <td className="py-2 px-1.5 align-middle text-center whitespace-nowrap">
                        {p.startWeight != null && p.endWeight != null ? (
                          <span className="text-[10.5px] sm:text-[12px] font-black font-stat text-slate-900 leading-none">
                            {faWeight(p.endWeight)}
                            {p.delta != null && p.delta !== 0 && (
                              <span
                                className={`text-[8.5px] font-black mr-1 ${
                                  (p.delta < 0) === path.weeklyRate! < 0 ? "text-emerald-600" : "text-orange-500"
                                }`}
                              >
                                ({p.delta > 0 ? "+" : "−"}{faWeight(Math.abs(p.delta))})
                              </span>
                            )}
                            {p.delta === 0 && (
                              <span className="text-[8.5px] font-black text-teal-600 mr-1">ثابت</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-bold">—</span>
                        )}
                      </td>
                    )}

                    {/* ستون اتفاق کلیدی — فقط یک جملهٔ کوتاه */}
                    <td className="py-2 px-1.5 sm:px-2.5 align-middle">
                      <p
                        className={`text-[10px] sm:text-[11.5px] font-bold leading-snug ${
                          goalRow ? "text-orange-700" : "text-slate-700"
                        }`}
                      >
                        {p.headline}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* پانویس کوتاه — یک خط */}
        <p className="mt-2 text-[9.5px] text-slate-400 text-center">
          هر برنامه ۴۵ روزه است و با چکاپ‌های دوره‌ای به‌روز می‌شود.
        </p>
      </Card>
    </motion.div>
  );
}
