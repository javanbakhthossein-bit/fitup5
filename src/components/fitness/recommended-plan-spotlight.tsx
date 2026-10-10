"use client";

/**
 * RecommendedPlanSpotlight — ویترین «پلن پیشنهادی اختصاصی تو»
 *
 * v137 — بازطراحی «نارنجی سازمانی» (دیرکتیو مالک):
 * پس‌زمینهٔ کارت به نارنجی سازمانی فیتاپ تغییر کرد تا بیشتر تو چشم باشد،
 * متن روی کارت با کنتراست بالا (سفید/کهربایی روی نارنجی) کاملاً خوانا است،
 * و عنوان با نام کوچک کاربر شخصی‌سازی می‌شود («برای حسین جان»).
 * CTA همان PurchaseModal رسمی اپ را باز می‌کند (مسیر پرداخت واحد v135).
 *
 * v145 — دیرکتیو مالک: فهرست کامل موارد پلن با نمایش ۵ مورد اول + دکمهٔ «همه موارد».
 *
 * v199 — دیرکتیو مالک:
 *  ① ردیف «دلایل» (مثل «چت نامحدود ۲۴ ساعته با فیتاپ…») حذف شد — فقط امکانات پلن.
 *  ② متن فهرست: «با این پلن همه این امکانات را دریافت می‌کنید».
 *  ③ متن دکمه: «همین پلن را انتخاب می‌کنم».
 *  ④ «همه موارد» حالا در «هر دو جهت» کاملاً نرم و بدون لگ باز/بسته می‌شود:
 *     به‌جای حذف/نصب ناگهانی آیتم‌ها (AnimatePresence — علت لگ و پرش هنگام بستن)،
 *     موارد اضافی همیشه در DOM می‌مانند و با گذار «grid-template-rows: 0fr↔1fr»
 *     به‌صورت شتاب‌گرفته از GPU باز و بسته می‌شوند (fallback مرورگر قدیمی: snap تمیز).
 *  ⑤ memo — رندر مجدد کارت فقط با تغییر واقعی props (باز/بستن مدال خرید و
 *     تیک‌های دیگر صفحه دیگر کارت‌ها را دوباره رندر نمی‌کند — صفحه روان‌تر).
 */

import { memo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, CheckCircle2, Zap, ChevronDown, Crown, ListChecks } from "lucide-react";
import {
  toPersianDigits,
  formatToman,
  type SubscriptionPlan,
  // v198 — گسترش صریح امکانات پلن (به‌جای «تمام امکانات پلن قبلی»)
  expandPlanFeatures,
  orderPlanHighlights,
} from "@/lib/fitness/types";

/** نام کوچک کاربر از نام کامل («حسین رضایی» → «حسین») */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** v145 — تعداد مواردِ پلن که بدون باز کردن «همه موارد» نمایش داده می‌شود */
const VISIBLE_FEATURES = 5;

function RecommendedPlanSpotlightBase({
  plan,
  onBuy,
  userName,
  discountPercent = 0,
}: {
  plan: SubscriptionPlan;
  /** باز کردن PurchaseModal همان پلن (مسیر پرداخت رسمی اپ) */
  onBuy: () => void;
  /** نام کامل کاربر برای شخصی‌سازی («حسین جان») */
  userName?: string | null;
  /** v198 — درصد تخفیف صفحهٔ تحلیل (نمایش قیمت تخفیف‌خورده روی کارت) */
  discountPercent?: number;
}) {
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  const scrollToVitrine = () => {
    document.getElementById("plans-vitrine")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const firstName = firstNameOf(userName);

  // v198 — امکانات صریح: متن «تمام امکانات پلن قبلی» با فهرست کامل همان پلن
  // گسترش می‌شود و ۵ موردِ اول با چیدمان قوی‌ترین‌ها نمایش داده می‌شود.
  const features = orderPlanHighlights(expandPlanFeatures(plan));
  const firstFeatures = features.slice(0, VISIBLE_FEATURES);
  const extraFeatures = features.slice(VISIBLE_FEATURES);
  // قیمت تخفیف‌خورده — نمایشی؛ مبلغ نهایی همیشه در checkout سرور قطعی می‌شود
  const discountedPrice =
    discountPercent > 0
      ? Math.max(0, Math.round((plan.price * (100 - discountPercent)) / 100))
      : plan.price;
  const hasDiscount = discountPercent > 0 && discountedPrice < plan.price;

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
                {firstName ? `${firstName} جان، این پلن مخصوص شماست` : "این پلن مخصوص شماست"}
              </p>
              <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-1.5 leading-tight">
                <Crown className="w-4 h-4 shrink-0 text-amber-200" />
                پلن {plan.label}
                <span className="text-[9.5px] sm:text-[10px] font-bold text-amber-100/80 font-normal">
                  · {toPersianDigits(plan.durationDays)} روزه
                </span>
              </h3>
            </div>
            <div
              className="text-center rounded-xl px-3 py-2 shrink-0"
              style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.32)", backdropFilter: "blur(4px)" }}
            >
              {/* v198 — قیمت تخفیف‌خوردهٔ صفحهٔ تحلیل: قیمت قبلی خط‌خورده + قیمت جدید
                  (v199 — با انقضای تخفیف، زنده و بی‌درنگ به قیمت واقعی برمی‌گردد) */}
              {hasDiscount && (
                <p className="text-[10px] text-amber-100/80 font-bold font-stat leading-none line-through decoration-rose-200/80">
                  {toPersianDigits(formatToman(plan.price))}
                </p>
              )}
              <p className="text-base sm:text-lg font-black font-stat text-white leading-none whitespace-nowrap mt-0.5">
                {toPersianDigits(formatToman(discountedPrice))}
              </p>
              <p className="text-[8.5px] text-amber-100 mt-0.5 font-bold">
                {hasDiscount ? (
                  <span className="text-rose-100">تومان · {toPersianDigits(discountPercent)}٪ تخفیف</span>
                ) : (
                  "تومان"
                )}
              </p>
            </div>
          </div>

          {/* v199 — فهرست کامل موارد پلن: کاربر باید بداند دقیقاً چه می‌خرد.
              (ردیف «دلایل» طبق دیرکتیو مالک حذف شد — فقط امکانات پلن.) */}
          {features.length > 0 && (
            <div className="relative mt-3 rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.24)" }}>
              <p className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-amber-100 mb-2">
                <ListChecks className="w-3.5 h-3.5" />
                با این پلن همه این امکانات را دریافت می‌کنید
              </p>
              <ul className="space-y-1.5">
                {firstFeatures.map((f, i) => (
                  <li
                    key={`${f}-${i}`}
                    className="flex items-start gap-1.5 text-[10.5px] sm:text-[11.5px] font-bold text-white leading-snug"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-200 shrink-0 mt-[1px]" />
                    <span className="min-w-0">{f}</span>
                  </li>
                ))}
              </ul>
              {/* v199 — بازوبستن نرم «همه موارد»: گذار grid-template-rows (0fr↔1fr).
                  آیتم‌ها هرگز unmount نمی‌شوند ⇒ هیچ پرش/لگی در بستن نیست. */}
              {extraFeatures.length > 0 && (
                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ gridTemplateRows: showAllFeatures ? "1fr" : "0fr" }}
                  aria-hidden={!showAllFeatures}
                >
                  <div className="overflow-hidden min-h-0">
                    <ul
                      className="space-y-1.5 pt-1.5"
                      inert={!showAllFeatures}
                    >
                      {extraFeatures.map((f, i) => (
                        <li
                          key={`${f}-${i + VISIBLE_FEATURES}`}
                          className="flex items-start gap-1.5 text-[10.5px] sm:text-[11.5px] font-bold text-white leading-snug"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-200 shrink-0 mt-[1px]" />
                          <span className="min-w-0">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {extraFeatures.length > 0 && (
                <button
                  onClick={() => setShowAllFeatures((v) => !v)}
                  aria-expanded={showAllFeatures}
                  className="mt-2.5 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] sm:text-[11px] font-black text-orange-700 bg-white/90 hover:bg-white transition shadow-sm"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showAllFeatures ? "rotate-180" : ""}`} />
                  {showAllFeatures ? "بستن فهرست" : `همه موارد (${toPersianDigits(features.length)} مورد)`}
                </button>
              )}
            </div>
          )}

          {/* ردیف ۴: دکمهٔ خرید کوتاه + لینک پلن‌های دیگر */}
          <div className="relative mt-3.5 flex items-center gap-2">
            <motion.button
              onClick={onBuy}
              whileTap={{ scale: 0.98 }}
              whileHover={{ scale: 1.01 }}
              className="flex-1 h-11 rounded-xl bg-white font-black text-orange-700 text-[12px] sm:text-[13px] flex items-center justify-center gap-1.5 shadow-lg shadow-orange-950/25"
              aria-label={`انتخاب پلن ${plan.label}`}
            >
              <Zap className="w-4 h-4" />
              همین پلن را انتخاب می‌کنم
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

/** v199 — memo: رندر مجدد فقط با تغییر واقعی props (plan/onBuy پایدار از والد) */
export const RecommendedPlanSpotlight = memo(RecommendedPlanSpotlightBase);
