"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Gift, Copy, Check, ChevronLeft, X } from "lucide-react";
import { toPersianDigits } from "@/lib/fitness/types";

// ═══════════════════════════════════════════════════════════════
// v216-B — کارت آپ‌سل با کد تخفیف شخصی (دیرکتیو مالک)
// v221 — تنها لحظهٔ مجاز: «برنامه آماده شد» (programs-view) — لحظهٔ
// «اولین عکس پیشرفت» با دیرکتیو مالک حذف شد.
// هرگز برای دارندگان پلن استاندارد/پیشرفته/حرفه‌ای.
//
// رفتار:
//  - X → بستن + ماندگاری در localStorage با کلید momentKey
//  - واکشی کد فقط وقتی قرار است نمایش داده شود (یک GET — بدون retry)
//  - ورود/هاور فقط transform (بدون انیمیشن layout) — بدون پرش صفحه
//  - کد نمایش‌داده‌شده از /api/panel/personal-discount می‌آید؛ اگر سرور
//    کد نداد (eligible=false — سپر صداقت سمت API)، کارت به نسخهٔ نرمِ
//    «بدون کد» برمی‌گردد و هیچ وعدهٔ تخفیفی نشان داده نمی‌شود.
// ═══════════════════════════════════════════════════════════════

/** پلن‌های «کامل» — کارت آپ‌سل هرگز برای این‌ها نمایش داده نمی‌شود (گیت دقیق دیرکتیو) */
const FULL_PLAN_NAMES: readonly string[] = ["standard", "advanced", "ultimate"];

export function isFullPlanName(planName: string | null | undefined): boolean {
  return !!planName && FULL_PLAN_NAMES.includes(planName);
}

/** پیش‌فرض تیتر یک‌خطی هر لحظه (محاوره‌ای — هم‌لحن بقیهٔ پنل) */
const DEFAULT_HEADLINES: Record<string, string> = {
  "upsell-program-ready": "برنامه‌ات آماده شد — این کد تخفیف شخصی برای قدم بعدی‌ات",
  // نسخهٔ نرم بدون کد (وقتی سرور کد نمی‌دهد — هیچ وعدهٔ تخفیفی نمی‌دهیم)
  "nudge:upsell-program-ready": "برنامه‌ات آماده شد — چت مربی و تحلیل هوشمند، قدم بعدی رشدت است",
};

interface PersonalUpsellCardProps {
  /** کلید لحظه — هم کلید ماندگاری بستن در localStorage (مثل "upsell-program-ready") */
  momentKey: string;
  /** ناوبری به تب پلن‌ها — با همان مکانیزم تب‌ناوِ خود ویو (setMainTab) */
  onGoToPlans: () => void;
  /** تیتر یک‌خطی دلخواه (اختیاری — پیش‌فرض بر اساس momentKey) */
  headline?: string;
}

type CardState =
  | { phase: "loading" }
  | { phase: "off" }
  | { phase: "nudge" }
  | { phase: "code"; code: string; value: number; validUntil: string | null };

export function PersonalUpsellCard({ momentKey, onGoToPlans, headline }: PersonalUpsellCardProps) {
  const [state, setState] = useState<CardState>({ phase: "loading" });
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    // بسته‌شدهٔ قبلی؟ → بدون هیچ درخواستی خاموش بماند
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(momentKey) === "1") {
        setState({ phase: "off" });
        return () => controller.abort();
      }
    } catch {
      // localStorage در دسترس نیست (حالت خصوصی) — مثل «بسته نشده» رفتار می‌کنیم
    }

    // یک GET تنبل — فقط وقتی قرار است نمایش داده شود
    (async () => {
      try {
        const res = await fetch("/api/panel/personal-discount", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("upsell-discount-fetch-failed");
        const data = await res.json();
        if (cancelled) return;
        if (data?.code && typeof data.code === "string") {
          setState({
            phase: "code",
            code: String(data.code),
            value: Number(data.value) > 0 ? Number(data.value) : 10,
            validUntil: typeof data.validUntil === "string" ? data.validUntil : null,
          });
        } else if (data?.eligible === false) {
          // سرور کد نداد (سپر صداقت) — نسخهٔ نرم بدون هیچ وعدهٔ تخفیف
          setState({ phase: "nudge" });
        } else {
          setState({ phase: "off" });
        }
      } catch {
        if (!cancelled) setState({ phase: "off" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [momentKey]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(momentKey, "1");
    } catch {
      // بی‌خیال ماندگاری — بستن همین نشست هم کافی است
    }
    setState({ phase: "off" });
  }, [momentKey]);

  const copyCode = useCallback(async () => {
    if (state.phase !== "code") return;
    const text = state.code;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("clipboard-unavailable");
      }
    } catch {
      // فال‌بک WebView (کافه‌بازار/اندروید قدیمی): execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        return; // کپی نشد — چیپ متن را نگه می‌دارد تا دستی کپی کند
      }
    }
    setCopied(true);
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  }, [state]);

  if (state.phase === "loading" || state.phase === "off") return null;

  const isCode = state.phase === "code";
  const title = headline ?? DEFAULT_HEADLINES[(isCode ? "" : "nudge:") + momentKey] ?? DEFAULT_HEADLINES[momentKey];

  // «۷ روز اعتبار» از مهلت واقعی کد (روز باقیمانده، حداقل ۱)
  const daysLeft = isCode && state.validUntil
    ? Math.max(1, Math.ceil((new Date(state.validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 7;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="relative rounded-2xl p-[1.5px] shadow-md"
      style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
      role="complementary"
      aria-label="پیشنهاد ویژه فیتاپ"
    >
      <div className="rounded-[14px] bg-white p-3.5">
        {/* هدر: آیکون + تیتر یک‌خطی + بستن */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Gift className="w-4 h-4 text-white" />
            </div>
            <p className="text-[13px] font-bold text-slate-800 leading-6 min-w-0">{title}</p>
          </div>
          <button
            onClick={dismiss}
            aria-label="بستن پیشنهاد"
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* کد قابل کپی + متن ارزش — فقط وقتی کد واقعی داریم */}
        {isCode && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              onClick={copyCode}
              aria-label={`کپی کد تخفیف ${state.code}`}
              className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 hover:bg-amber-100 active:scale-[0.98] transition"
            >
              <span dir="ltr" className="font-mono text-sm font-black text-amber-700 tracking-wider select-all">
                {state.code}
              </span>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} />
              ) : (
                <Copy className="w-3.5 h-3.5 text-amber-500" />
              )}
            </button>
            <span className="text-[11px] font-bold text-amber-600">
              {toPersianDigits(state.value)}٪ تخفیف شخصی — {toPersianDigits(daysLeft)} روز اعتبار
            </span>
            {copied && (
              <span className="text-[11px] font-bold text-emerald-600">کپی شد ✓</span>
            )}
          </div>
        )}

        {/* CTA — با همان مکانیزم تب‌ناوِ ویو میزبان */}
        <button
          onClick={onGoToPlans}
          className="mt-3 w-full h-10 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-1.5 shadow-sm hover:scale-[1.01] active:scale-[0.99] transition"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          مشاهدهٔ پلن‌ها
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
