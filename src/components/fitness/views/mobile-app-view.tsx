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
 * نکته: داخل اپ نیتیو (بازار/اختصاصی) این تب کلاً پنهان است (main-app.tsx).
 */
import { Smartphone, Apple, Bell } from "lucide-react";
import {
  OwnApkDownloadCard,
  IosInstallGuideCard,
  IosNotificationsCard,
} from "./app-install-cards";

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

      {/* ۱) اپ اندروید اختصاصی — دانلود مستقیم APK از خود سایت */}
      <OwnApkDownloadCard />

      {/* ۲) راهنمای نصب وب‌اپ iOS */}
      <IosInstallGuideCard />

      {/* ۳) فعال‌سازی نوتیفیکیشن‌های iOS */}
      <IosNotificationsCard />
    </div>
  );
}
