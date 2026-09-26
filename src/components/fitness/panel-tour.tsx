"use client";

/**
 * تور راهنمای ورود اول به پنل فیتاپ (Task 3-c)
 *
 * - فقط برای کاربری که هرگز پنل را ندیده باز می‌شود: فلگ localStorage
 *   `fitup_tour_seen_v1` = "1" — کاربر بازگشتی هیچ فلاشی نمی‌بیند (چک داخل
 *   تایمرد ~۱.۲ ثانیه بعد از mount انجام می‌شود، قبل از آن هیچ‌چیز رندر نمی‌شود).
 * - ۶ قدم: خوش‌آمد، داشبورد، تمرین‌ها، دستیار تغذیه، پیشرفت، چت با فیتاپ
 *   + معرفی دکمه پروفایل و زنگ اعلان‌ها در قدم آخر.
 * - کیبورد: ESC = رد کردن، Enter = قدم بعد؛ فوکوس‌ترپ داخل کارت؛ aria-modal.
 * - اجرای دوباره از مرکز راهنما (panel-help) با رویداد window
 *   «fitup:replay-tour» — بدون zustand، بدون state اضافه در TopBar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Dumbbell,
  LayoutDashboard,
  MessageCircle,
  Salad,
  Sparkles,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import { toPersianDigits } from "@/lib/fitness/types";

export const TOUR_SEEN_KEY = "fitup_tour_seen_v1";
const TOUR_EVENT = "fitup:replay-tour";
const OPEN_DELAY_MS = 1200;

/** آیا کاربر قبلاً تور را دیده؟ (سمت کلاینت فقط) */
export function isFitupTourSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** اجرای دوباره تور (از دکمه فوتر مرکز راهنما صدا زده می‌شود) */
export function replayFitupTour(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}

interface TourStep {
  icon: LucideIcon;
  emoji: string;
  title: string;
  body: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    icon: Sparkles,
    emoji: "👋",
    title: "به فیتاپ خوش آمدی!",
    body: "دستیار فیتنس شخصی تو اینجاست: برنامه تمرینی و غذایی اختصاصی، مربی هوشمند و پیگیری دقیق پیشرفت — همه در یک پنل ساده. فقط ۶۰ ثانیه وقت بگذار تا منوها را نشانت بدهیم.",
  },
  {
    icon: LayoutDashboard,
    emoji: "🏠",
    title: "داشبورد — خانه تو",
    body: "کارت پیشرفت پلن (نام پلن و روزهای باقی‌مانده) و باکس «برنامه شما» با سه دکمه سریع: مشاهده برنامه، تمرین امروز و حالت باشگاه. اگر پروفایلت ناقص باشد، جعبه «تکمیل آنبوردینگ» هم همین‌جاست.",
  },
  {
    icon: Dumbbell,
    emoji: "💪",
    title: "تمرین‌ها — جایی که عرق می‌ریزی",
    body: "چک‌لیست تمرین امروز با ست و تکرار آماده است. دکمه «شروع تمرین (حالت فعال)» جلسه تمام‌صفحه با تایمر استراحت و ثبت وزنه×تکرار می‌سازد؛ «حالت باشگاه» هم برای تمرین زنده زیر وزنه است (پلن پیشرفته و حرفه‌ای).",
  },
  {
    icon: Salad,
    emoji: "🥗",
    title: "دستیار تغذیه",
    body: "عکس غذایت را آپلود کن تا هوش مصنوعی کالری و درشت‌مغذی‌ها را تشخیص دهد، یا از بانک غذاها جستجو کن. کالری باقی‌مانده امروز و وعده‌هایت همین‌جا پیگیری می‌شود.",
  },
  {
    icon: TrendingUp,
    emoji: "📈",
    title: "پیشرفت — ثابت کن!",
    body: "هر ماه عکس پیشرفت در ۳ زاویه آپلود کن و وزن و چکاپ‌هایت را ثبت کن تا نمودارها رسم شوند؛ تغییراتی که در آینه نمی‌بینی، اینجا با داده می‌بینی.",
  },
  {
    icon: MessageCircle,
    emoji: "🤖",
    title: "چت با فیتاپ + ابزارهای بالای صفحه",
    body: "مربی هوشمند ۲۴ ساعته فیتاپ هر سوال ورزشی و تغذیه‌ای‌ات را جواب می‌دهد. بالای صفحه هم دو ابزار همیشگی داری: زنگ اعلان‌ها (یادآوری‌ها و پیام‌ها) و دکمه پروفایل (اطلاعات و کیف پول). آماده‌ای؟ بزن بریم!",
  },
];

export function PanelTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  // ─── ورود اول: بعد از ~۱.۲ ثانیه چک فلگ — کاربر بازگشتی هرگز فلاش نمی‌بیند ───
  useEffect(() => {
    const t = setTimeout(() => {
      if (!isFitupTourSeen()) {
        setStep(0);
        setOpen(true);
      }
    }, OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // ─── اجرای دوباره از مرکز راهنما (بدون توجه به فلگ) ───
  useEffect(() => {
    const onReplay = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_EVENT, onReplay);
  }, []);

  // ─── قفل اسکرول پشت تور ───
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ─── فوکوس اولیه روی کارت (برای کیبورد/اسکرین‌ریدر) ───
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  const finishTour = useCallback(() => {
    try {
      window.localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {}
    setOpen(false);
  }, []);

  const goNext = useCallback(() => {
    setStep((s) => {
      if (s >= TOUR_STEPS.length - 1) {
        finishTour();
        return s;
      }
      return s + 1;
    });
  }, [finishTour]);

  const goPrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  // ─── کیبورد: ESC = رد کردن | Enter = قدم بعد | Tab = فوکوس‌ترپ ───
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      finishTour();
      return;
    }
    // روی دکمه‌ها Enter را خود مرورگر مدیریت می‌کند (کلیک) — دست نمی‌زنیم
    const isOnButton = !!(e.target as HTMLElement).closest?.("button");
    if (e.key === "Enter" && !isOnButton) {
      e.preventDefault();
      goNext();
      return;
    }
    if (e.key === "Tab") {
      const card = cardRef.current;
      if (!card) return;
      const focusables = Array.from(
        card.querySelectorAll<HTMLElement>("button:not([disabled])")
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  const StepIcon = current.icon;

  // ─── v51 (درس باگ مدال دسترسی v50): تور می‌تواند همزمان با Sheet/Dialog
  // رادیکس بالا بیاید؛ بدون portal، pointer-events:none بدنه به ارث می‌رسد و
  // دکمه‌ها کور می‌شوند. حالا: createPortal(body) + pointerEvents صریح +
  // بدون backdrop-blur (قاتل GPU WebView).
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ pointerEvents: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-label="تور راهنمای پنل فیتاپ"
          onKeyDown={handleKeyDown}
        >
          {/* بک‌دراپ تیره — کلیک روی آن = رد کردن تور */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60"
            onClick={finishTour}
            aria-hidden
          />

          {/* کارت قدم — مرکز صفحه، max-w-sm و ریسپانسیو */}
          <motion.div
            ref={cardRef}
            tabIndex={-1}
            role="document"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "tween", duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden outline-none focus:outline-none"
          >
            {/* ─── تصویرسازی بالای کارت ─── */}
            <div
              className="relative h-36 flex items-center justify-center"
              style={{
                background: "linear-gradient(140deg, #f59e0b 0%, #f97316 60%, #ea580c 100%)",
              }}
            >
              {/* دایره‌های تزئینی */}
              <div aria-hidden className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/10" />
              <div aria-hidden className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-black/10" />

              {/* آیکون قدم */}
              <div className="relative w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center ring-4 ring-white/30 shadow-lg">
                <StepIcon className="w-10 h-10 text-white" strokeWidth={2} />
                {/* بج شکلک روی گوشه */}
                <span className="absolute -bottom-3 -left-3 w-9 h-9 rounded-full bg-white shadow-md flex items-center justify-center text-lg leading-none">
                  {current.emoji}
                </span>
              </div>

              {/* شمارنده قدم «۱ از ۶» */}
              <span
                className="absolute top-3 right-3 text-[11px] font-bold text-white/95 bg-black/20 backdrop-blur-sm px-2.5 py-1 rounded-full"
                aria-current="step"
              >
                {toPersianDigits(step + 1)} از {toPersianDigits(TOUR_STEPS.length)}
              </span>

              {/* رد کردن تور */}
              <button
                onClick={finishTour}
                className="absolute top-2.5 left-2.5 w-9 h-9 rounded-xl flex items-center justify-center text-white/85 hover:text-white hover:bg-white/15 transition"
                aria-label="رد کردن تور راهنما"
                title="رد کردن (ESC)"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* ─── متن قدم ─── */}
            <div className="px-5 pt-4 pb-5 text-center">
              <h2 className="text-lg font-black text-slate-900 leading-snug">{current.title}</h2>
              <p className="mt-2 text-[13px] text-slate-600 leading-relaxed min-h-[4.5rem]">
                {current.body}
              </p>

              {/* نقطه‌های پیشرفت */}
              <div className="flex items-center justify-center gap-1.5 mt-4" aria-hidden>
                {TOUR_STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      i === step
                        ? "w-5"
                        : i < step
                          ? "w-1.5 bg-amber-400"
                          : "w-1.5 bg-slate-200"
                    }`}
                    style={i === step ? { background: "linear-gradient(135deg, #f59e0b, #f97316)" } : {}}
                  />
                ))}
              </div>

              {/* دکمه‌ها */}
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={goPrev}
                  disabled={step === 0}
                  className="min-h-[44px] flex-1 rounded-xl border-2 border-orange-200 text-orange-600 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-orange-50 active:scale-[0.99] transition"
                  aria-label="قدم قبلی"
                >
                  قبلی
                </button>
                <button
                  onClick={goNext}
                  className="min-h-[44px] flex-[1.6] rounded-xl text-white text-sm font-black flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/25 hover:brightness-105 active:scale-[0.99] transition"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                  aria-label={isLast ? "پایان تور و شروع استفاده" : "قدم بعدی"}
                >
                  {isLast ? "شروع می‌کنم 💪" : "بعدی"}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
