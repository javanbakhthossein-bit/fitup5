"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Download,
  X,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { isFitUpOwnApp, getOwnAppVersionCode, downloadOwnAppUpdate } from "@/lib/fitness/app-bridge";
import { toPersianDigits } from "@/lib/fitness/types";
import { toast } from "sonner";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

interface LatestInfo {
  available: boolean;
  latestVersionName?: string;
  latestVersionCode?: number;
  changelog?: string;
  fileSize?: number;
  forceUpdate?: boolean;
  apkUrl?: string;
}

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${toPersianDigits(kb)} کیلوبایت`;
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `${toPersianDigits(mb)} مگابایت`;
}

/**
 * مودال آپدیت اپ اندروید اختصاصی فیتاپ (فقط داخل اپ اختصاصی)
 *
 * روی هر بارگذاری (و برگشت به اپ) نسخهٔ فعلی اپ (پل نیتیو) با آخرین نسخهٔ
 * منتشرشدهٔ سایت (/api/app/own/latest) مقایسه می‌شود:
 *  - نسخه قدیمی → مودال زیبا: نسخه جدید + لیست تغییرات + دکمه دانلود
 *  - forceUpdate → دکمه «بعداً» مخفی (آپدیت اجباری)
 *  - دانلود → پل نیتیو DownloadManager (فایل + اعلان + پرامپت نصب)
 *
 * تغییرات خود سایت هرگز این مودال را نمی‌سازند — سایت همیشه داخل WebView تازه
 * است؛ فقط تغییرات نیتیو (خود APK) نسخه جدید می‌خواهند و ادمین changelog را
 * از پنل مدیریت وارد می‌کند.
 */
export function AppUpdateModal() {
  const [info, setInfo] = useState<LatestInfo | null>(null);
  const [currentCode, setCurrentCode] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const check = useCallback(async () => {
    if (!isFitUpOwnApp()) return;
    const code = getOwnAppVersionCode();
    setCurrentCode(code);
    try {
      const res = await fetch("/api/app/own/latest", { cache: "no-store" });
      if (!res.ok) return;
      const data: LatestInfo = await res.json();
      setInfo(data);
    } catch {
      // آفلاین/خطا — ساکت
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isFitUpOwnApp()) return;
    // اولین چک با کمی تأخیر تا اپ کاملاً بالا بیاید (اسپلش + auth check)
    const t = setTimeout(check, 1500);
    // برگشت به اپ (resume) → چک مجدد
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [check]);

  const latestCode = info?.latestVersionCode ?? 0;
  const needsUpdate = !!info?.available && latestCode > currentCode && currentCode > 0;
  const forced = needsUpdate && !!info?.forceUpdate;
  const open = needsUpdate && !dismissed;
  // قفل اسکرول صفحه پشت مودال (بدون layout shift)
  useScrollLock(open);

  function handleDownload() {
    setDownloading(true);
    try {
      const handoff = downloadOwnAppUpdate(info?.apkUrl || "/api/app/own/download");
      if (handoff === "native") {
        // اپ v1.2.2+ — دانلود با DownloadManager نیتیو؛ اپ خودش توست دقیق
        // (شروع موفق/ناموفق) می‌دهد و بعد از اتمام دیالوگ نصب باز می‌کند.
      } else if (handoff === "browser-intent") {
        // اپ قدیمی — مرورگر بیرونی باز شد و دانلود را خودش انجام می‌دهد
        // (نوتیف پیشرفت/پایان کروم + پیشنهاد نصب) — مسیر «همیشه-کار-کند».
        toast.info("مرورگر برای دانلود نسخه جدید باز شد — پس از اتمام دانلود، فایل را باز کنید و نصب را تأیید کنید 📥");
      } else if (handoff === "browser-link") {
        toast.success("دانلود نسخه جدید شروع شد — بعد از اتمام، نصب را تأیید کنید ✅");
      }
    } catch {
      toast.error("خطا در شروع دانلود — لطفاً دوباره تلاش کنید");
    }
    // حالت دانلود را نگه می‌داریم تا کاربر دکمه را نبیند؛ بعداً رها می‌شود
    setTimeout(() => setDownloading(false), 4000);
  }

  const sizeText = formatSize(info?.fileSize);
  const changelogLines = (info?.changelog || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="نسخه جدید فیتاپ"
        >
          <motion.div
            initial={{ scale: 0.9, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="relative bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* هدر گرادیانی */}
            <div
              className="relative px-6 pt-6 pb-5 text-center overflow-hidden"
              style={{ background: goldGradient }}
            >
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
              <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-white/10" />
              {!forced && (
                <button
                  onClick={() => setDismissed(true)}
                  className="absolute top-3 left-3 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition"
                  aria-label="بستن"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <motion.div
                animate={{ rotate: [0, 8, -8, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="w-16 h-16 mx-auto rounded-2xl bg-white shadow-lg flex items-center justify-center overflow-hidden mb-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
              </motion.div>
              <h3 className="text-lg font-black text-white">نسخه جدید فیتاپ آماده است!</h3>
              <div className="mt-2 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur rounded-full px-3.5 py-1.5 text-white text-xs font-bold">
                <RefreshCw className="w-3.5 h-3.5" />
                نسخه {toPersianDigits(info?.latestVersionName || "")}
                <span className="opacity-60">•</span>
                <span className="font-stat">{toPersianDigits(String(latestCode))}</span>
              </div>
            </div>

            {/* بدنه */}
            <div className="px-5 py-5 max-h-[46vh] overflow-y-auto custom-scrollbar">
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                {forced
                  ? "برای ادامه استفاده از فیتاپ، لطفاً نسخه جدید را دانلود و نصب کنید."
                  : "با نسخه جدید، این موارد به فیتاپ اضافه شده است:"}
              </p>

              {changelogLines.length > 0 ? (
                <ul className="space-y-2">
                  {changelogLines.map((line, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 * i }}
                      className="flex items-start gap-2.5 rounded-xl bg-orange-50/70 border border-orange-100 px-3 py-2.5"
                    >
                      <CheckCircle2 className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                      <span className="text-xs text-slate-700 leading-relaxed flex-1">{line}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3 text-xs text-slate-500 leading-relaxed">
                  بهبود عملکرد، رفع اشکال و تجربه سریع‌تر و پایدارتر.
                </div>
              )}

              <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  امضاشده و امن
                </span>
                {sizeText && (
                  <span className="inline-flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    {sizeText}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                  دانلود مستقیم از فیتاپ
                </span>
              </div>
            </div>

            {/* دکمه‌ها */}
            <div className="px-5 pb-5 pt-1 border-t border-orange-50 bg-orange-50/30 flex gap-2">
              {!forced && (
                <button
                  onClick={() => setDismissed(true)}
                  className="h-12 px-4 rounded-2xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition min-w-[84px]"
                >
                  بعداً
                </button>
              )}
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex-1 h-12 rounded-2xl text-white font-black text-sm shadow-lg flex items-center justify-center gap-2 transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                style={{ background: goldGradient }}
              >
                <Download className="w-5 h-5" />
                {downloading ? "در حال شروع دانلود…" : "دانلود نسخه جدید"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
