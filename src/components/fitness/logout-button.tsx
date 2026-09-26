"use client";

import { useState } from "react";
import { LogOut, Loader2, AlertTriangle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { useAppStore } from "@/lib/fitness/store";
import { toast } from "sonner";

/* گرادیان مشترک دکمه‌های خروج (قرمز/نارنجی برند) */
const gradientStyle = { background: "linear-gradient(135deg, #ef4444, #f97316)" };

interface LogoutConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * مودال تأیید خروج — قابل استفاده مجدد (۳۲-B).
 *
 * جایی که «خروج از حساب» وجود دارد (دکمه خروج، اورلی پروفایل و...) از همین
 * کامپوننت استفاده می‌کند تا زبان بصری یکدست بماند: بک‌دراپ بلور، آیکون
 * هشدار گرادیانی، دکمه‌های «انصراف» / «بله، خارج می‌شوم» با لودر.
 *
 * state لودر داخل خود مودال است: onConfirm را await می‌کند و در پایان
 * مودال را می‌بندد؛ منطق واقعی خروج با فراخواننده است.
 *
 * modal با z-[100] بالای همه overlays (از جمله منوی موبایل z-[70]) باز می‌شود.
 */
export function LogoutConfirmModal({ open, onOpenChange, onConfirm }: LogoutConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  // ─── قفل اسکرول صفحه پشت مودال تأیید خروج ───
  useScrollLock(open);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      onOpenChange(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          dir="rtl"
          onClick={() => !loading && onOpenChange(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* دکمه بستن */}
            <button
              onClick={() => !loading && onOpenChange(false)}
              className="absolute top-4 left-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              aria-label="بستن"
            >
              <X className="w-5 h-5" />
            </button>

            {/* آیکون */}
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={gradientStyle}
            >
              <AlertTriangle className="w-7 h-7 text-white" />
            </div>

            <h3 className="text-lg font-black text-slate-900 text-center mb-2">
              خروج از حساب کاربری
            </h3>
            <p className="text-sm text-slate-500 text-center leading-relaxed mb-6">
              آیا مطمئن هستید که می‌خواهید از حساب خود خارج شوید؟
              <br />
              برای ورود مجدد، باید شماره موبایل خود را وارد کنید.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => onOpenChange(false)}
                disabled={loading}
                className="flex-1 h-11 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition disabled:opacity-50"
              >
                انصراف
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 h-11 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
                style={gradientStyle}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    در حال خروج...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    بله، خارج می‌شوم
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * دکمه خروج از حساب با طراحی جذاب (گرادیان قرمز/نارنجی) + modal تأیید.
 * از ۳۲-B منطق نمایش مودال به LogoutConfirmModal منتقل شد تا اورلی
 * پروفایل هم بتواند بدون تکرار کد، همان تأیید زیبا را نشان دهد.
 */
export function LogoutButton({ variant = "mobile" }: { variant?: "mobile" | "desktop" }) {
  const { reset, setOverlay } = useAppStore();
  const [open, setOpen] = useState(false);

  async function performLogout() {
    // 🩹 v45 (باگ «بعد از خروج دکمهٔ شروع تا رفرش کار نمی‌کند»): خروج حالا از
    // نسخهٔ سخت‌گیرانهٔ مشترک lib/fitness/logout.ts می‌رود — پاک‌کردن کش‌های
    // Service Worker + storage + reload با cache-buster. قبلاً خروجِ بدون
    // reload رها می‌کرد: پاسخ‌های stale /api/auth/me و state کهنه باعث
    // می‌شد لندینگ/پنل در وضعیت شبح بماند و دکمه‌ها بی‌عمل باشند.
    // (تأیید قبلاً با مودال زیبا گرفته شده → confirm: false)
    const { performLogout: sharedLogout } = await import("@/lib/fitness/logout");
    const ok = await sharedLogout({ confirm: false });
    if (!ok) return; // کاربر لغو کرده
    setOpen(false);
    setOverlay(null);
    // v52: reset() اینجا حذف شد — lib خودش reset + SplashLoader + ناوبری تمیز
    // انجام می‌دهد؛ reset دوم باعث «پرش مجدد» صفحه بعد از خروج می‌شد.
  }

  const buttonClass =
    variant === "mobile"
      ? "w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-white font-bold shadow-md hover:shadow-lg active:scale-[0.98] transition-all min-h-[48px]"
      : "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-bold shadow-md hover:shadow-lg active:scale-[0.98] transition-all";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass}
        style={gradientStyle}
        aria-label="خروج از حساب"
      >
        <LogOut className={variant === "mobile" ? "w-5 h-5 shrink-0" : "w-4 h-4 shrink-0"} />
        <span>خروج از حساب</span>
      </button>

      {/* Modal تأیید خروج — z-[100] بالای همه overlays */}
      <LogoutConfirmModal open={open} onOpenChange={setOpen} onConfirm={performLogout} />
    </>
  );
}
