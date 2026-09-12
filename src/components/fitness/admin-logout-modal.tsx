"use client";

import { useState } from "react";
import { LogOut, Loader2, AlertTriangle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useScrollLock } from "@/hooks/use-scroll-lock";

/**
 * مودال تأیید خروج از پنل مدیریت (v32 — درخواست مالک: خروج دیگر آنی نیست).
 *
 * الگوی بصری از مودال خروج کاربر (logout-button.tsx) گرفته شده ولی با
 * زبان پرمیوم تیرهٔ پنل ادمین: شیشهٔ تیرهٔ zinc-900 + گرادیان قرمز/نارنجی.
 * z-[100] بالای اورلی ادمین (z-50) و همهٔ لایه‌ها باز می‌شود.
 *
 * onConfirm منطق خروج (fetch /api/auth/logout + reset) را اجرا می‌کند —
 * همان handleLogout قبلی admin-overlay.
 */
export function AdminLogoutModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(false);
  // ─── قفل اسکرول پشت مودال (همان الگوی logout-button) ───
  useScrollLock(open);

  async function confirmLogout() {
    if (loading) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      // اورلی بعد از خروج unmount می‌شود؛ این فقط حالت خطا را پوشش می‌دهد
      setLoading(false);
    }
  }

  const gradientStyle = { background: "linear-gradient(135deg, #ef4444, #f97316)" };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          dir="rtl"
          onClick={() => !loading && onClose()}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative bg-zinc-900 border border-white/10 rounded-3xl max-w-sm w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* دکمه بستن */}
            <button
              onClick={() => !loading && onClose()}
              className="absolute top-4 left-4 p-1.5 rounded-full hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition"
              aria-label="بستن"
            >
              <X className="w-5 h-5" />
            </button>

            {/* آیکون هشدار — گرادیان قرمز/نارنجی مثل مودال خروج کاربر */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={gradientStyle}>
              <AlertTriangle className="w-7 h-7 text-white" />
            </div>

            <h3 className="text-lg font-black text-white text-center mb-2">خروج از پنل مدیریت</h3>
            <p className="text-sm text-zinc-400 text-center leading-relaxed mb-6">
              آیا مطمئن هستید که می‌خواهید از پنل مدیریت فیتاپ خارج شوید؟
              <br />
              برای ورود مجدد باید شماره موبایل و کد تأیید را دوباره وارد کنید.
            </p>

            <div className="flex gap-2">
              {/* دکمه‌ها min-h-[44px] — هدف لمسی استاندارد */}
              <button
                onClick={onClose}
                disabled={loading}
                className="flex-1 h-11 rounded-xl border border-white/15 text-zinc-300 font-bold hover:bg-white/5 transition disabled:opacity-50"
              >
                انصراف
              </button>
              <button
                onClick={confirmLogout}
                disabled={loading}
                className="flex-1 h-11 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-lg"
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
                    خروج
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
