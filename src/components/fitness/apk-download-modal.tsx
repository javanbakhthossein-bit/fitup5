"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  X,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Smartphone,
  ChevronDown,
} from "lucide-react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { toPersianDigits } from "@/lib/fitness/types";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

/**
 * v65 — مودال برند «دانلود اپ فیتاپ» (درخواست مالک):
 *
 * «اگر برای باز کردن یک لینک در گوشی کاربر یک مدال یا تایید می‌خوای بگیری
 * باید اون مدال یا تایید شخصی‌سازی‌شده و مربوط به سایت خودمون باشه و خیلی
 * زیبا نشون داده بشه.»
 *
 * قبل از شروع دانلود APK این مودال خودِ فیتاپ نمایش داده می‌شود تا:
 *  ۱) دانلود با رضایت آگاهانهٔ کاربر شروع شود (نه مستقیم و ناگهانی)؛
 *  ۲) هشدارهای عمومی اندروید از قبل «توضیح داده شده» باشند — یعنی کاربر
 *     هشدار «ممکن است فایل مضر باشد» یا «Play Protect اپ را مسدود کرد» را
 *     نمی‌بیند که بترسد؛ می‌بیند که فیتاپ خودش از قبل گفته با گزینهٔ
 *     «دانلود به هر حال» / «نصب هر حال (بدون تأیید)» ادامه بده — چون فایل
 *     رسمی و امضاشدهٔ خودِ فیتاپ است.
 *
 * ⚠️ مهم: هشدارهای گوگل/اندروید بیرون از کنترل وب هستند و هیچ سایتی نمی‌تواند
 * آن‌ها را حذف کند؛ ولی با این پیش‌راهنمای برندشده، کاربر دقیقاً می‌داند چه
 * بزند و تجربهٔ ترسناک نمی‌شود.
 *
 * استفاده:
 *   const [open, setOpen] = useState(false);
 *   <ApkDownloadModal open={open} onClose={...} onConfirm={startDownload}
 *                     versionName="1.3.1" fileSize={size} />
 */

export interface ApkDownloadModalProps {
  open: boolean;
  onClose: () => void;
  /** بعد از تأیید کاربر — شروع واقعی دانلود */
  onConfirm: () => void;
  versionName?: string;
  fileSize?: number;
}

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${toPersianDigits(kb)} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

export function ApkDownloadModal({
  open,
  onClose,
  onConfirm,
  versionName,
  fileSize,
}: ApkDownloadModalProps) {
  const [showDetails, setShowDetails] = useState(false);
  // مودال فقط بعد از کلیک کاربر باز می‌شود (open=false در رندر اول) —
  // پس مثل AppUpdateModal چک document کافی است؛ نیاز به state "mounted" نیست.
  useScrollLock(open);

  if (typeof document === "undefined") return null;

  const sizeText = formatSize(fileSize);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/55 backdrop-blur-[2px]"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="دانلود اپ فیتاپ"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ─── هدر برند ─── */}
            <div
              className="relative px-6 pt-6 pb-5 text-center overflow-hidden shrink-0"
              style={{ background: goldGradient }}
            >
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
              <div className="absolute -bottom-12 -left-8 w-36 h-36 rounded-full bg-white/10" />
              <button
                onClick={onClose}
                className="absolute top-3 left-3 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition z-10"
                aria-label="بستن"
              >
                <X className="w-4 h-4" />
              </button>

              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="w-16 h-16 mx-auto rounded-2xl bg-white shadow-lg flex items-center justify-center overflow-hidden mb-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
              </motion.div>

              <h3 className="text-lg font-black text-white">اپ رسمی فیتاپ</h3>
              <p className="mt-1 text-[11px] text-white/85">
                دانلود مستقیم و امن از سرور خودِ فیتاپ — بدون واسطه
              </p>

              <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                {versionName && (
                  <span className="inline-flex items-center gap-1 bg-white/20 backdrop-blur rounded-full px-3 py-1 text-white text-[11px] font-bold">
                    <Sparkles className="w-3 h-3" />
                    نسخه {toPersianDigits(versionName)}
                  </span>
                )}
                {sizeText && (
                  <span className="inline-flex items-center gap-1 bg-white/20 backdrop-blur rounded-full px-3 py-1 text-white text-[11px] font-bold">
                    <Download className="w-3 h-3" />
                    {sizeText}
                  </span>
                )}
              </div>
            </div>

            {/* ─── بدنه ─── */}
            <div className="px-5 py-4 overflow-y-auto custom-scrollbar">
              {/* تضمین اصالت */}
              <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-100 px-3.5 py-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-emerald-800">فایل رسمی، امضاشده و سالم</p>
                  <p className="text-[10px] text-emerald-600 leading-relaxed mt-0.5">
                    این APK با کلید رسمی فیتاپ امضا شده و مستقیم از سرور ما می‌آید
                  </p>
                </div>
              </div>

              {/* پیش‌راهنمای هشدارهای اندروید — ریشهٔ حذف ترس کاربر */}
              <div className="mt-3">
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 rounded-2xl bg-amber-50 border border-amber-100 px-3.5 py-3 text-right hover:bg-amber-100/60 transition"
                  aria-expanded={showDetails}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
                    <span className="text-xs font-bold text-amber-800 leading-snug">
                      اگر اندروید هشدار امنیتی نشان داد نترسید!
                    </span>
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-amber-500 shrink-0 transition-transform ${showDetails ? "rotate-180" : ""}`}
                  />
                </button>

                {showDetails && (
                  <motion.ul
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-2 space-y-2 overflow-hidden"
                  >
                    <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 font-stat">۱</span>
                      <span className="text-[11px] text-slate-600 leading-relaxed">
                        اگر هشدار <b>«ممکن است فایل مضر باشد»</b> آمد، روی{" "}
                        <b>«دانلود به هر حال»</b> (Download anyway) بزنید — این
                        هشدار عمومی اندروید برای همهٔ فایل‌های خارج از گوگل‌پلی است.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 font-stat">۲</span>
                      <span className="text-[11px] text-slate-600 leading-relaxed">
                        اگر موقع نصب <b>Play Protect</b> گفت «اپ مسدود شد»، روی{" "}
                        <b>«جزئیات بیشتر»</b> ← <b>«نصب هر حال (بدون تأیید)»</b> بزنید.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 font-stat">۳</span>
                      <span className="text-[11px] text-slate-600 leading-relaxed">
                        با اولین نصب‌های موفق دیگر کاربران، این هشدارها برای
                        فیتاپ برداشته می‌شوند — فایل کاملاً امن است.
                      </span>
                    </li>
                  </motion.ul>
                )}
              </div>
            </div>

            {/* ─── دکمه‌ها ─── */}
            <div className="px-5 pb-5 pt-2 border-t border-orange-50 bg-orange-50/30 flex gap-2 shrink-0">
              <button
                onClick={onClose}
                className="h-12 px-4 rounded-2xl border border-slate-200 bg-white text-slate-600 text-sm font-bold hover:bg-slate-50 transition min-w-[88px]"
              >
                انصراف
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 h-12 rounded-2xl text-white font-black text-sm shadow-lg flex items-center justify-center gap-2 transition hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: goldGradient }}
                aria-label="شروع دانلود اپ فیتاپ"
              >
                <Smartphone className="w-5 h-5" />
                دانلود اپ فیتاپ
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
