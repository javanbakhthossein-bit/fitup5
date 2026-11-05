"use client";

/**
 * تب «اپ موبایل» پنل ورزشکار — نسخهٔ جدید (درخواست مالک)
 *
 * طبق تصمیم مالک، این صفحه فقط شامل:
 *  ۱. دانلود اپ اندروید «اختصاصی» فیتاپ (APK مستقیم از خود سایت)
 *  ۲. راهنمای نصب وب‌اپ iOS (سافاری → Add to Home Screen)
 *  ۳. فعال‌سازی نوتیفیکیشن‌های iOS
 *
 * پیشنهادهای PWA کروم و «سایر مرورگرها» حذف شدند — مسیر رسمی اندروید،
 * دانلود مستقیم APK خود سایت است.
 *
 * نکته: داخل اپ نیتیو کافه‌بازار این تب کلاً پنهان است (main-app.tsx — قانون
 * بازار). در اپ اختصاصی وقتی نسخهٔ نصب‌شده ≥ آخرین نسخهٔ منتشرشده باشد، نوار
 * سبز «فیتاپ شما به روز است» بالای کارت دانلود نشان داده می‌شود (v202-B8)؛
 * نسخهٔ قدیمی‌تر → همان جریان آپدیت قبلی (بدون تغییر)؛ مرورگر/PWA → بدون تغییر.
 */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Smartphone, Apple, Bell, CheckCircle2 } from "lucide-react";
import { isFitUpOwnApp, getOwnAppVersionCode } from "@/lib/fitness/app-bridge";
import { isFitUpBazaarApp } from "@/lib/fitness/bazaar-bridge";
import {
  compareVersionNames,
  getInstalledBazaarVersionName,
  getInstalledOwnVersionName,
  BAZAAR_LATEST_VERSION_NAME,
} from "@/lib/fitness/app-version";
import {
  OwnApkDownloadCard,
  IosInstallGuideCard,
  IosNotificationsCard,
} from "./app-install-cards";

interface OwnLatestInfo {
  available: boolean;
  latestVersionName?: string;
  latestVersionCode?: number;
}

/**
 * نوار موفقیت «فیتاپ شما به روز است» (v202-B8 — درخواست مالک)
 *
 * فقط داخل اپ‌های نیتیو و فقط وقتی نسخهٔ نصب‌شده ≥ آخرین نسخهٔ موجود «همان
 * واریانت» دیده می‌شود:
 *  - اپ اختصاصی: نسخهٔ نصب‌شده (پل getAppVersionCode/getAppVersionName یا UA)
 *    در برابر آخرین نسخهٔ داینامیک ‎/api/app/own/latest (مدیریت اپ اختصاصی ادمین).
 *  - اپ بازار: نسخهٔ نصب‌شده (پل appVersion() یا UA) در برابر ثابت
 *    BAZAAR_LATEST_VERSION_NAME (منبع داینامیک بازار طبق قانون بازار ممنوع).
 *    عملی unreachable است چون خود تب در اپ بازار پنهان است (main-app.tsx).
 *  - مرورگر/PWA: هیچ (رفتار فعلی دست‌نخورده).
 * تشخیص کاملاً بعد از mount و به‌صورت async انجام می‌شود (بدون mismatch
 * هیدریشن) و هر شکست شبکه/پل → نوار مخفی (رفتار فعلی).
 */
function AppUpToDateBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const own = isFitUpOwnApp();
        const bazaar = !own && isFitUpBazaarApp();
        if (!own && !bazaar) return; // مرورگر/PWA — هیچ

        let upToDate = false;
        if (own) {
          const res = await fetch("/api/app/own/latest", { cache: "no-store" });
          if (!res.ok) return;
          const data: OwnLatestInfo = await res.json();
          if (!data?.available) return;
          const installedCode = getOwnAppVersionCode();
          const latestCode = Math.floor(Number(data.latestVersionCode)) || 0;
          if (installedCode > 0 && latestCode > 0) {
            // versionCode معتبرتر است (عدد صحیح صعودی BuildConfig)
            upToDate = installedCode >= latestCode;
          } else {
            const installed = getInstalledOwnVersionName();
            const latest = String(data.latestVersionName || "");
            if (!installed || !latest) return; // نسخه قابل تشخیص نیست → هیچ
            upToDate = compareVersionNames(installed, latest) >= 0;
          }
        } else {
          const installed = getInstalledBazaarVersionName();
          if (!installed) return;
          upToDate = compareVersionNames(installed, BAZAAR_LATEST_VERSION_NAME) >= 0;
        }
        if (!cancelled && upToDate) setVisible(true);
      } catch {
        // آفلاین/خطای پل → ساکت (هیچ رفتار فعلی‌ای تغییر نمی‌کند)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3.5 flex items-center gap-3"
      role="status"
    >
      <span className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
      </span>
      <p className="text-sm font-black text-emerald-700">فیتاپ شما به روز است</p>
    </motion.div>
  );
}

export function MobileAppView() {
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-orange-500/20"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <Smartphone className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900">اپ موبایل فیتاپ</h1>
          <p className="text-xs text-slate-500">دانلود اپ اندروید و راهنمای iOS</p>
        </div>
      </div>

      {/* خلاصهٔ سه مسیر */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Smartphone, label: "اپ اندروید", desc: "دانلود مستقیم" },
          { icon: Apple, label: "وب‌اپ iOS", desc: "نصب از سافاری" },
          { icon: Bell, label: "اعلان‌های iOS", desc: "یادآوری‌ها" },
        ].map((item, i) => (
          <div
            key={i}
            className="rounded-xl bg-orange-50/60 border border-orange-100 px-2 py-3 text-center"
          >
            <item.icon className="w-5 h-5 mx-auto text-orange-500 mb-1.5" />
            <p className="text-[11px] font-black text-slate-800 leading-tight">{item.label}</p>
            <p className="text-[9px] text-slate-500 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* ۱) اپ اندروید اختصاصی — دانلود مستقیم APK از خود سایت
          (داخل اپ نیتیوِ به‌روز → نوار سبز «فیتاپ شما به روز است» بالای کارت) */}
      <AppUpToDateBanner />
      <OwnApkDownloadCard />

      {/* ۲) راهنمای نصب وب‌اپ iOS */}
      <IosInstallGuideCard />

      {/* ۳) فعال‌سازی نوتیفیکیشن‌های iOS */}
      <IosNotificationsCard />
    </div>
  );
}
