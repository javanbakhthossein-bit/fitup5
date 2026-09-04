"use client";

/**
 * بخش «نصب اپلیکیشن» صفحه اصلی — بازطراحی‌شده (درخواست مالک)
 *
 * محتوای جدید (بدون پیشنهادهای PWA کروم/سایر مرورگرها):
 *  ۱. دانلود مستقیم اپ اندروید اختصاصی فیتاپ (همان APK خود سایت)
 *  ۲. راهنمای نصب وب‌اپ iOS از سافاری
 *
 * «فعال‌سازی اعلان‌های آیفون» از این بخش حذف شد (درخواست مالک) — آن کارت
 * فقط در تب «اپ موبایل» پنل کاربری (برای کاربران iOS لاگین‌کرده) موجود است.
 *
 * ترتیب نمایش با تشخیص پلتفرم کاربر هوشمند می‌شود (اندروید/آیفون).
 */
import { Smartphone, Download, Apple } from "lucide-react";
import { useEffect, useState } from "react";
import {
  OwnApkDownloadCard,
  IosInstallGuideCard,
  PlatformHint,
} from "@/components/fitness/views/app-install-cards";

export function AppInstallSection() {
  const [platform, setPlatform] = useState<"android" | "ios" | "other">("other");

  useEffect(() => {
    if (typeof window === "undefined") return;
    // تشخیص پلتفرم بعد از mount (بدون setState همگام در effect — قاعدهٔ lint)
    const detect = () => {
      const ua = navigator.userAgent.toLowerCase();
      const isIOS =
        /iphone|ipad|ipod/.test(ua) ||
        (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
      setPlatform(isIOS ? "ios" : /android/.test(ua) ? "android" : "other");
    };
    Promise.resolve().then(detect);
  }, []);

  const androidFirst = platform !== "ios";
  // بول‌ها را بیرون از شرط حساب می‌کنیم تا TypeScript داخل شاخه‌های ترتیب
  // (که نوع platform را محدود می‌کنند) خطای «مقایسهٔ غیرممکن» ندهد
  const androidRecommended = platform === "android";
  const iosRecommended = platform === "ios";

  return (
    <section id="install" className="py-16 bg-gradient-to-b from-orange-50/40 to-white relative overflow-hidden scroll-mt-16">
      {/* Background accents */}
      <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-orange-100/40 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-amber-100/40 blur-3xl" />

      <div className="max-w-5xl mx-auto px-4 relative">
        {/* Header */}
        <div className="animate-fade-in-up text-center mb-8">
          <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3">
            <Download className="w-3.5 h-3.5" />
            نصب اپلیکیشن
          </span>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 mb-2">
            فیتاپ را روی گوشی خود نصب کنید
          </h2>
          <p className="text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
            اپ اندروید فیتاپ را مستقیم از خود سایت دانلود کنید؛ یا اگر آیفون دارید،
            فیتاپ را از سافاری مثل یک اپ واقعی نصب کنید.
          </p>
          <div className="mt-3 flex justify-center">
            <PlatformHint platform={platform} />
          </div>
        </div>

        {/* کارت‌ها — دو ستون متقارن (دسکتاپ) / پشته (موبایل)؛ ترتیب بر اساس پلتفرم */}
        <div className="grid md:grid-cols-2 gap-5 md:items-stretch">
          {androidFirst ? (
            <>
              <OwnApkDownloadCard recommended={androidRecommended} />
              <IosInstallGuideCard recommended={iosRecommended} />
            </>
          ) : (
            <>
              <IosInstallGuideCard recommended={iosRecommended} />
              <OwnApkDownloadCard recommended={androidRecommended} />
            </>
          )}
        </div>

        {/* جمع‌بندی مزایا */}
        <div className="animate-fade-in-up mt-8 p-5 rounded-2xl border-2 border-orange-200 bg-orange-50/50">
          <h3 className="font-bold text-slate-900 mb-3 text-center text-sm flex items-center justify-center gap-2">
            <Smartphone className="w-4 h-4 text-orange-500" />
            چرا اپ فیتاپ را نصب کنم؟
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Benefit icon="🚀" text="دسترسی سریع با یک ضربه" />
            <Benefit icon="🔔" text="اعلان یادآوری تمرین و تغذیه" />
            <Benefit icon="📱" text="تجربه تمام‌صفحه بدون نوار مرورگر" />
            <Benefit icon="🔄" text="همیشه به‌روز، بدون آپدیت دستی" />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Apple className="w-3.5 h-3.5 text-slate-400" />
            iOS: نصب از سافاری
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-orange-500" />
            اندروید: دانلود مستقیم APK
          </span>
        </div>
      </div>
    </section>
  );
}

function Benefit({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl mb-1">{icon}</div>
      <p className="text-[11px] text-slate-600 leading-tight">{text}</p>
    </div>
  );
}
