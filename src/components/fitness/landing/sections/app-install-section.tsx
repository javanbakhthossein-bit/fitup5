"use client";

/**
 * بخش «نصب اپلیکیشن» صفحه اصلی — v179 (درخواست مالک)
 *
 * «در قسمت دانلود اپ اندروید می‌تونی دو قسمت کنید دانلود با لینک مستقیم که
 *  برنامه اپ خودمون دانلود بشه و دانلود کافه بازار که با این نشان»
 *
 * ۱. دانلود با لینک مستقیم — APK رسمی خود سایت (همیشه آخرین نسخه)
 * ۲. دانلود از کافه بازار — با نشان رسمی بازار (PNG محلی) → cafebazaar.ir/app/ir.fittup.app
 *    v180 (دیرکتیو مالک): باکس آیکون «هر دو» کارت = لوگوی خود فیتاپ؛ نشان PNG
 *    بازار فقط به‌عنوان دکمهٔ CTA «دریافت از بازار» باقی می‌ماند.
 * ۳. راهنمای نصب وب‌اپ iOS از سافاری
 *
 * ⚠️ طبق دیرکتیو مالک: نشان/کارت کافه بازار «فقط در صفحه اصلی» رندر می‌شود —
 * این بخش فقط در landing-page.tsx استفاده است و تب «اپ موبایل» پنل از این
 * کارت خبر ندارد (mobile-app-view.tsx دست‌نخورده ماند).
 *
 * «فعال‌سازی اعلان‌های آیفون» فقط در تب «اپ موبایل» پنل کاربری موجود است.
 *
 * ترتیب نمایش با تشخیص پلتفرم کاربر هوشمند می‌شود (اندروید/آیفون).
 */
import { Smartphone, Download, Apple, ExternalLink, ShieldCheck, Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  OwnApkDownloadCard,
  IosInstallGuideCard,
  PlatformHint,
} from "@/components/fitness/views/app-install-cards";
import { isFitUpNativeApp } from "@/lib/fitness/app-bridge";

/** لینک رسمی اپ فیتاپ در کافه بازار (مالک) */
const BAZAAR_APP_URL = "https://cafebazaar.ir/app/ir.fittup.app";

export function AppInstallSection() {
  const [platform, setPlatform] = useState<"android" | "ios" | "other">("other");
  // ─── v51 (قانون کافه‌بازار + اپ‌های نیتیو) ───
  // بخش «نصب اپلیکیشن» فقط برای مرورگر معنا دارد. داخل هر دو اپ (بازار/اختصاصی)
  // رندر نمی‌شود: در بازار تبلیغ نصب APK تخلف است و در اپ اختصاصی کاربر
  // همین حالا داخل اپ است. (لندینگ عادی در اپ‌ها اصلاً باز نمی‌شود؛ این
  // گارد برای مسیر استثنایی ?view=landing است.)
  const [inNativeApp, setInNativeApp] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // بدون setState همگام در effect — قاعدهٔ lint (الگوی Promise.resolve در کل ریپو)
    Promise.resolve().then(() => {
      try {
        setInNativeApp(isFitUpNativeApp());
      } catch {}
    });
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

  // گارد اپ نیتیو — داخل اپ‌ها هیچ بخش نصب اپی رندر نمی‌شود (قانون بازار)
  if (inNativeApp) return null;

  /* دو گزینهٔ اندروید — لینک مستقیم + کافه بازار (v179 مالک) */
  const androidOptions = (
    <>
      <div className="flex flex-col min-w-0">
        <OptionLabel icon={<Download className="w-3.5 h-3.5 text-orange-500" />} text="دانلود با لینک مستقیم" hint="همیشه آخرین نسخه — از خود فیتاپ" />
        <OwnApkDownloadCard recommended={androidRecommended} />
      </div>
      <div className="flex flex-col min-w-0">
        <OptionLabel icon={<ExternalLink className="w-3.5 h-3.5 text-emerald-600" />} text="دانلود کافه بازار" hint="نصب مستقیم از فروشگاه رسمی" />
        <BazaarDownloadCard />
      </div>
    </>
  );

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
            اپ اندروید فیتاپ را با لینک مستقیم از خود سایت دانلود کنید یا از کافه بازار
            نصب کنید؛ اگر آیفون دارید، فیتاپ را از سافاری مثل یک اپ واقعی نصب کنید.
          </p>
          <div className="mt-3 flex justify-center">
            <PlatformHint platform={platform} />
          </div>
        </div>

        {/* کارت‌ها — دو گزینهٔ اندروید کنار هم + راهنمای iOS تمام‌عرض (دسکتاپ) */}
        <div className="grid md:grid-cols-2 gap-5 md:items-stretch">
          {androidFirst ? (
            <>
              {androidOptions}
              <div className="md:col-span-2 min-w-0">
                <IosInstallGuideCard recommended={iosRecommended} />
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2 min-w-0">
                <IosInstallGuideCard recommended={iosRecommended} />
              </div>
              {androidOptions}
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
            اندروید: لینک مستقیم یا کافه بازار
          </span>
        </div>
      </div>
    </section>
  );
}

/* ───────────── v179 — برچسب گزینه (عنوان دو قسمت دانلود اندروید) ───────────── */

function OptionLabel({ icon, text, hint }: { icon: React.ReactNode; text: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 px-1">
      <span className="inline-flex items-center gap-1.5 text-xs font-black text-slate-700">
        {icon}
        {text}
      </span>
      <span className="text-[10px] text-slate-400">{hint}</span>
    </div>
  );
}

/* ───────────── v179 — کارت دانلود از کافه بازار (فقط صفحه اصلی) ───────────── */

function BazaarDownloadCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      className="h-full flex flex-col rounded-2xl bg-white border-2 border-emerald-100 shadow-sm overflow-hidden"
    >
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start gap-3">
          {/* v180 (دیرکتیو مالک): باکس آیکون = لوگوی خود فیتاپ (مثل کارت لینک
              مستقیم) — هر دو کارت همان اپ فیتاپ‌اند؛ یکی لینک مستقیم، یکی بازار.
              نشان رسمی بازار فقط روی دکمهٔ CTA پایین کارت می‌ماند. */}
          <div
            className="w-14 h-14 rounded-2xl shrink-0 shadow-md overflow-hidden flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <img
              src="/fitup-logo.png"
              alt="اپ فیتاپ"
              width={56}
              height={56}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-slate-900 flex items-center gap-2 flex-wrap">
              اپ فیتاپ در کافه بازار
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                فروشگاه رسمی
              </span>
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">
              نصب راحت از فروشگاه کافه بازار — بدون نیاز به اجازهٔ نصب از منابع ناشناس.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 py-2.5">
            <ShieldCheck className="w-4 h-4 mx-auto text-emerald-500 mb-1" />
            <p className="text-[10px] font-bold text-slate-600">نصب مطمئن فروشگاه</p>
          </div>
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 py-2.5">
            <Bell className="w-4 h-4 mx-auto text-emerald-500 mb-1" />
            <p className="text-[10px] font-bold text-slate-600">اعلان‌های کامل</p>
          </div>
        </div>

        {/* CTA اصلی — نشان رسمی «دریافت از بازار» (PNG محلی ۴۲۱×۱۲۵) */}
        <a
          href={BAZAAR_APP_URL}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="mt-auto pt-4 block"
          aria-label="دریافت اپلیکیشن فیتاپ از کافه بازار"
        >
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-center gap-3 transition hover:border-emerald-300 hover:bg-emerald-50/40 hover:scale-[1.01] active:scale-[0.99]">
            <img
              src="/images/bazaar-badge.png"
              alt="دریافت اپلیکیشن فیتاپ از کافه بازار"
              width={421}
              height={125}
              loading="lazy"
              className="h-12 w-auto rounded-lg"
            />
          </div>
        </a>

        <p className="mt-2.5 text-[10px] text-slate-400 text-center leading-relaxed">
          نسخهٔ بازار ممکن است چند روز عقب‌تر از نسخهٔ مستقیم باشد — برای همیشه‌آخرین
          نسخه از «دانلود با لینک مستقیم» استفاده کنید.
        </p>
      </div>
    </motion.div>
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
