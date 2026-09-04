"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Smartphone,
  Apple,
  Share as ShareIcon,
  Plus,
  CheckCircle2,
  Bell,
  ChevronDown,
  Package,
  ShieldCheck,
  Zap,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toPersianDigits } from "@/lib/fitness/types";
import { isFitUpOwnApp, downloadOwnAppUpdate } from "@/lib/fitness/app-bridge";
import { toast } from "sonner";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

/* ═══════════════════════════════════════════════════════════════
   کارت‌های نصب اپ — مشترک بین تب «اپ موبایل» پنل و بخش «نصب اپلیکیشن» لندینگ

   طبق خواستهٔ مالک فقط این سه کارت وجود دارد (بدون پیشنهاد PWA کروم):
    ۱. دانلود اپ اندروید اختصاصی فیتاپ (APK مستقیم از خود سایت)
    ۲. راهنمای نصب وب‌اپ iOS (Add to Home Screen در سافاری)
    ۳. فعال‌سازی نوتیفیکیشن‌های iOS
   ═══════════════════════════════════════════════════════════════ */

interface LatestInfo {
  available: boolean;
  latestVersionName?: string;
  changelog?: string;
  fileSize?: number;
}

function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${toPersianDigits(kb)} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

function detectPlatform(): "android" | "ios" | "other" {
  if (typeof window === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

/* ═══════════ ۱) کارت دانلود اپ اندروید اختصاصی ═══════════ */

export function OwnApkDownloadCard({
  compact = false,
  recommended = false,
}: {
  compact?: boolean;
  recommended?: boolean;
}) {
  const [info, setInfo] = useState<LatestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/app/own/latest", { cache: "no-store" });
        if (!res.ok) return;
        const data: LatestInfo = await res.json();
        if (!cancelled) setInfo(data);
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sizeText = formatSize(info?.fileSize);
  const version = info?.latestVersionName || "";
  const changelogLines = (info?.changelog || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      className="h-full rounded-2xl bg-white border-2 border-orange-200 shadow-sm overflow-hidden"
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          {/* آیکون اپ */}
          <div
            className="w-14 h-14 rounded-2xl shrink-0 shadow-md overflow-hidden flex items-center justify-center"
            style={{ background: goldGradient }}
          >
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-slate-900 flex items-center gap-2 flex-wrap">
              اپ اندروید فیتاپ
              {version && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600">
                  نسخه {toPersianDigits(version)}
                </span>
              )}
              {recommended && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  پیشنهادی برای گوشی شما
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">
              برنامه رسمی فیتاپ برای اندروید — دانلود مستقیم از خود سایت، بدون نیاز به
              هیچ فروشگاه. همیشه هم‌نسخه با سایت و به‌روز.
            </p>
          </div>
        </div>

        {!compact && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-orange-50/60 border border-orange-100 py-2.5">
              <Package className="w-4 h-4 mx-auto text-orange-500 mb-1" />
              <p className="text-[10px] font-bold text-slate-600">{sizeText || "نصب سبک"}</p>
            </div>
            <div className="rounded-xl bg-orange-50/60 border border-orange-100 py-2.5">
              <ShieldCheck className="w-4 h-4 mx-auto text-emerald-500 mb-1" />
              <p className="text-[10px] font-bold text-slate-600">امن و امضاشده</p>
            </div>
            <div className="rounded-xl bg-orange-50/60 border border-orange-100 py-2.5">
              <Zap className="w-4 h-4 mx-auto text-amber-500 mb-1" />
              <p className="text-[10px] font-bold text-slate-600">اسکرول روان و سریع</p>
            </div>
          </div>
        )}

        {changelogLines.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowChangelog((v) => !v)}
              className="w-full flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              aria-expanded={showChangelog}
            >
              <span className="flex items-center gap-1.5">
                <ChevronDown
                  className={`w-4 h-4 text-orange-500 transition-transform ${showChangelog ? "rotate-180" : ""}`}
                />
                تغییرات آخرین نسخه
              </span>
              <span className="text-[10px] text-slate-400">{toPersianDigits(changelogLines.length)} مورد</span>
            </button>
            {showChangelog && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-2 space-y-1.5 overflow-hidden"
              >
                {changelogLines.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
                    <CheckCircle2 className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                    {line}
                  </li>
                ))}
              </motion.ul>
            )}
          </div>
        )}

        <a
          href="/api/app/own/download"
          download
          className="mt-4 flex items-center justify-center gap-2 h-12 rounded-2xl text-white font-black text-sm shadow-md transition hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: goldGradient }}
          onClick={(e) => {
            // داخل اپ اختصاصی: مسیر «همیشه-کار-کند» — پل نیتیو (v1.2.2+) یا
            // مرورگر بیرونی (اپ‌های قدیمی). لینک پیش‌فرض WebView به‌خاطر
            // باگ گیرندهٔ پایان-دانلود در اندروید ۱۴ هیچ نتیجه‌ای نمی‌داد.
            if (isFitUpOwnApp()) {
              e.preventDefault();
              const handoff = downloadOwnAppUpdate("/api/app/own/download");
              if (handoff === "browser-intent") {
                toast.info("مرورگر برای دانلود اپ فیتاپ باز شد — پس از اتمام دانلود، فایل را باز کنید و نصب را تأیید کنید 📥");
              } else if (handoff === "browser-link") {
                toast.success("دانلود اپ فیتاپ شروع شد 📥");
              }
              // handoff === "native" → اپ خودش توست دقیق می‌دهد
              return;
            }
            toast.success("دانلود اپ فیتاپ شروع شد 📥");
          }}
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          {loading ? "در حال دریافت اطلاعات…" : `دانلود اپ اندروید${sizeText ? ` (${sizeText})` : ""}`}
        </a>

        <p className="mt-2.5 text-[10px] text-slate-400 text-center leading-relaxed">
          بعد از دانلود، فایل APK را باز کنید و نصب را تأیید نمایید (اجازه نصب از این
          منبع لازم است).
        </p>
      </div>
    </motion.div>
  );
}

/* ═══════════ ۲) کارت راهنمای نصب وب‌اپ iOS ═══════════ */

export function IosInstallGuideCard({ recommended = false }: { recommended?: boolean }) {
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // بعد از mount (بدون setState همگام در effect — قاعدهٔ lint)
    Promise.resolve().then(() => {
      setIsStandalone(
        window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as any).standalone === true
      );
      setIsIos(detectPlatform() === "ios");
    });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      className="h-full rounded-2xl bg-white border-2 border-orange-100 shadow-sm p-5"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl shrink-0 bg-slate-50 border border-slate-200 flex items-center justify-center">
          <Apple className="w-6 h-6 text-slate-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-slate-900 flex items-center gap-2 flex-wrap">
            نصب روی آیفون (iOS)
            {recommended && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                پیشنهادی برای گوشی شما
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed mt-1">
            فیتاپ روی آیفون به‌صورت وب‌اپ نصب می‌شود — آیکون فیتاپ مثل یک اپ واقعی روی
            صفحه اصلی می‌نشیند و تمام‌صفحه باز می‌شود.
          </p>
        </div>
      </div>

      {isStandalone ? (
        <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <p className="text-xs font-bold text-emerald-700">
            فیتاپ روی آیفون شما نصب شده — همین‌ حالا داخل اپ هستید 🎉
          </p>
        </div>
      ) : (
        <ol className="mt-4 space-y-2.5">
          {[
            {
              icon: <ShareIcon className="w-4 h-4 text-orange-500" />,
              text: "در مرورگر سافاری، سایت فیتاپ را باز کنید",
            },
            {
              icon: <ShareIcon className="w-4 h-4 text-orange-500" />,
              text: "روی دکمه اشتراک‌گذاری (Share) در پایین صفحه بزنید",
            },
            {
              icon: <Plus className="w-4 h-4 text-orange-500" />,
              text: "گزینه «Add to Home Screen» را انتخاب کنید",
            },
            {
              icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
              text: "روی «Add» بزنید — فیتاپ روی صفحه اصلی نصب می‌شود",
            },
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                style={{ background: goldGradient }}
              >
                {toPersianDigits(i + 1)}
              </span>
              <span className="text-xs text-slate-600 leading-relaxed flex-1">{step.text}</span>
              <span className="shrink-0 mt-0.5">{step.icon}</span>
            </li>
          ))}
        </ol>
      )}
      {isIos && !isStandalone && (
        <p className="mt-3 text-[10px] text-slate-400 text-center">
          نکته: نصب فقط از مرورگر سافاری انجام می‌شود (نه کروم)
        </p>
      )}
    </motion.div>
  );
}

/* ═══════════ ۳) کارت فعال‌سازی نوتیف iOS ═══════════ */

export function IosNotificationsCard() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isIos, setIsIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // بعد از mount (بدون setState همگام در effect — قاعدهٔ lint)
    Promise.resolve().then(() => {
      setIsIos(detectPlatform() === "ios");
      if ("Notification" in window) setPermission(Notification.permission);
    });
  }, []);

  async function enable() {
    if (!("Notification" in window)) {
      toast.error("مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند");
      return;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === "granted") {
        toast.success("اعلان‌ها فعال شد! ✅");
        // push subscribe مثل mobile-app-view قدیمی
        try {
          if ("serviceWorker" in navigator && "PushManager" in window) {
            const reg = await navigator.serviceWorker.ready;
            const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (vapidKey && reg.pushManager) {
              const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
              });
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sub),
              });
            }
          }
        } catch {}
      } else if (perm === "denied") {
        setShowGuide(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      className="rounded-2xl bg-white border-2 border-orange-100 shadow-sm p-5"
    >
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center"
          style={{
            background:
              permission === "granted" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
          }}
        >
          <Bell
            className={`w-6 h-6 ${permission === "granted" ? "text-emerald-500" : "text-orange-500"}`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-slate-900">
            {permission === "granted" ? "اعلان‌های آیفون فعال است ✅" : "فعال‌سازی اعلان‌های آیفون"}
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed mt-1">
            یادآوری تمرین و تغذیه را حتی وقتی فیتاپ بسته است، روی آیفون خود دریافت کنید.
          </p>
        </div>
      </div>

      {permission === "granted" ? (
        <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <p className="text-xs font-bold text-emerald-700">
            اعلان‌ها فعال است — پیام‌های مربی و یادآوری‌ها را دریافت می‌کنید.
          </p>
        </div>
      ) : permission === "denied" ? (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-100 p-3.5">
          <p className="text-[11px] text-red-700 leading-relaxed">
            اعلان‌ها مسدود شده‌اند. برای فعال‌سازی: تنظیمات آیفون → Safari (یا PWA فیتاپ) →
            Notifications → اجازه دهید.
          </p>
        </div>
      ) : (
        <>
          <Button
            onClick={enable}
            disabled={busy}
            className="mt-4 w-full rounded-2xl h-12 font-black text-white gap-2"
            style={{ background: goldGradient }}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Bell className="w-5 h-5" />}
            فعال‌سازی اعلان‌ها
          </Button>
          {isIos && showGuide && (
            <p className="mt-2.5 text-[10px] text-slate-400 text-center leading-relaxed">
              اگر دیالوگ نمایش داده نشد: تنظیمات → Safari → Notifications را روشن کنید
              (نیازمند iOS 16.4 یا بالاتر برای وب‌اپ نصب‌شده).
            </p>
          )}
        </>
      )}
    </motion.div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/* ═══════════ برچسب تشخیص پلتفرم (کمکی) ═══════════ */

export function PlatformHint({ platform }: { platform: "android" | "ios" | "other" }) {
  if (platform === "ios")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
        <Apple className="w-3.5 h-3.5" />
        دستگاه شما: آیفون
      </span>
    );
  if (platform === "android")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
        <Smartphone className="w-3.5 h-3.5 text-orange-500" />
        دستگاه شما: اندروید
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
      <Smartphone className="w-3.5 h-3.5 text-slate-400" />
      راهنمای نصب موبایل
    </span>
  );
}
