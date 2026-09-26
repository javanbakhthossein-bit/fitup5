"use client";

/**
 * RecommendedPlanSpotlight — ویترین «پلن پیشنهادی اختصاصی تو»
 *
 * v137 — بازطراحی «نارنجی سازمانی» (دیرکتیو مالک):
 * پس‌زمینهٔ کارت به نارنجی سازمانی فیتاپ تغییر کرد تا بیشتر تو چشم باشد،
 * متن روی کارت با کنتراست بالا (سفید/کهربایی روی نارنجی) کاملاً خوانا است،
 * و عنوان با نام کوچک کاربر شخصی‌سازی می‌شود («برای حسین جان»).
 * ساختار فشردهٔ v135 حفظ شد: نام پلن + قیمت + حداکثر ۳ دلیل کوتاه + CTA کوتاه.
 * CTA همان PurchaseModal رسمی اپ را باز می‌کند (مسیر پرداخت واحد v135).
 */

import { motion } from "framer-motion";
import { Sparkles, CheckCircle2, Zap, ChevronDown, Crown } from "lucide-react";
import type { SubscriptionPlan } from "@/lib/fitness/types";
import { toPersianDigits, formatToman } from "@/lib/fitness/types";

/** حداکثر طول هر دلیل — کوتاه‌سازی ملایم (دیرکتیو مالک: بدون سه‌نقطهٔ وسط جمله) */
function clampReason(r: string): string {
  const t = r.trim();
  return t.length > 120 ? t.slice(0, 118).replace(/[\s،؛-]+$/, "") + "…" : t;
}

/** نام کوچک کاربر از نام کامل («حسین رضایی» → «حسین») */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function RecommendedPlanSpotlight({
  plan,
  reasons,
  onBuy,
  userName,
}: {
  plan: SubscriptionPlan;
  /** دلایل خط‌به‌خط از تحلیل آنبوردینگ (planRecommendation.reasons) */
  reasons: string[];
  /** باز کردن PurchaseModal همان پلن (مسیر پرداخت رسمی اپ) */
  onBuy: () => void;
  /** نام کامل کاربر برای شخصی‌سازی («حسین جان») */
  userName?: string | null;
}) {
  const scrollToVitrine = () => {
    document.getElementById("plans-vitrine")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const shortReasons = reasons.slice(0, 3).map(clampReason);
  const firstName = firstNameOf(userName);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.26 }}
      aria-label="پلن پیشنهادی اختصاصی شما"
      className="relative"
    >
      {/* قاب گرادیانی فشرده */}
      <div
        className="relative rounded-[1.6rem] p-[2px] shadow-xl shadow-orange-600/35"
        style={{ background: "linear-gradient(120deg, #fbbf24, #f97316, #fbbf24)" }}
      >
        {/* بدنهٔ نارنجی سازمانی — v137 (دیرکتیو مالک: تو چشم‌تر + متن کاملاً خوانا) */}
        <div
          className="relative rounded-[calc(1.6rem-2px)] overflow-hidden p-4 sm:p-5"
          style={{ background: "linear-gradient(140deg, #c2410c 0%, #ea580c 42%, #f97316 100%)" }}
        >
          {/* هاله‌های تزئینی گرم */}
          <div className="pointer-events-none absolute -top-12 -left-12 w-40 h-40 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -right-10 w-44 h-44 rounded-full bg-orange-400/25 blur-3xl" />

          {/* ردیف ۱: برچسب + قیمت */}
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-amber-100 mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                {firstName ? `پیشنهاد اختصاصی فیتاپ برای ${firstName} جان` : "پیشنهاد اختصاصی فیتاپ برای تو"}
              </p>
              <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-1.5 leading-tight">
                <Crown className="w-4 h-4 shrink-0 text-amber-200" />
                پلن {plan.label}
                <span className="text-[9.5px] sm:text-[10px] font-bold text-amber-100/80 font-normal">
                  · {toPersianDigits(plan.durationDays)} روزه
                </span>
              </h3>
              <p className="text-[10px] sm:text-[11px] text-amber-100/90 font-bold mt-0.5 leading-snug">{plan.tagline}</p>
            </div>
            <div
              className="text-center rounded-xl px-3 py-2 shrink-0"
              style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.32)", backdropFilter: "blur(4px)" }}
            >
              <p className="text-base sm:text-lg font-black font-stat text-white leading-none whitespace-nowrap">
                {toPersianDigits(formatToman(plan.price))}
              </p>
              <p className="text-[8.5px] text-amber-100 mt-0.5 font-bold">تومان</p>
            </div>
          </div>

          {/* ردیف ۲: حداکثر ۳ دلیل کوتاه — جمع‌وجور */}
          {shortReasons.length > 0 && (
            <div className="relative mt-3 space-y-1">
              {shortReasons.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10.5px] sm:text-[11.5px] font-bold text-orange-50 leading-snug">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                  <span className="min-w-0">{r}</span>
                </div>
              ))}
            </div>
          )}

          {/* ردیف ۳: دکمهٔ خرید کوتاه + لینک پلن‌های دیگر */}
          <div className="relative mt-3.5 flex items-center gap-2">
            <motion.button
              onClick={onBuy}
              whileTap={{ scale: 0.98 }}
              whileHover={{ scale: 1.01 }}
              className="flex-1 h-11 rounded-xl bg-white font-black text-orange-700 text-[12px] sm:text-[13px] flex items-center justify-center gap-1.5 shadow-lg shadow-orange-950/25"
              aria-label={`خرید پلن ${plan.label}`}
            >
              <Zap className="w-4 h-4" />
              همین را می‌خوام — شروع کن
            </motion.button>
            <button
              onClick={scrollToVitrine}
              className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-black text-white/90 hover:text-white transition whitespace-nowrap px-2"
              aria-label="مشاهدهٔ همهٔ پلن‌ها"
            >
              پلن‌های دیگه
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
