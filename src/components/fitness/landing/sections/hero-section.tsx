"use client";

import { Sparkles, ChevronLeft, Zap, Users } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { pushScreen, smartNavigate } from "@/lib/fitness/navigation";
import { toPersianDigits } from "@/lib/fitness/types";
import { usePublicStats } from "../use-public-stats";

export function HeroSection() {
  const { user, setScreen } = useAppStore();
  const stats = usePublicStats(); // v86 — تعداد واقعی ثبت‌نام‌کنندگان

  return (
    <section className="relative pt-24 pb-20 sm:pt-32 sm:pb-24 overflow-hidden bg-white min-h-[88vh] sm:min-h-[auto] flex items-center">
      {/* Background effects — مینیمال روی موبایل */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-20 right-1/4 w-96 h-96 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-orange-200/40 blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Text */}
          <div className="text-center lg:text-right">
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-5"
              style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}
            >
              <Sparkles className="w-4 h-4" />
              اولین پلتفرم تخصصی طراحی برنامه بدنسازی
            </div>

            {/* v139 — بدون انیمیشن ورود: «both» در CSS باعث opacity:0 در فاز تأخیر
                می‌شد و LCP (عنوان/عکس هیرو) تا ۱ ثانیه بعد از هیدریشن رنگ نمی‌شد.
                هیرو باید لحظهٔ اول دیده شود؛ انیمیشن‌ها فقط روی المان‌های غیر-LCP. */}
            <h1
              className="text-2xl sm:text-3xl font-black leading-tight mb-4 text-slate-900"
            >
              برنامه بدنسازی آنلاین با{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                فیتاپ
              </span>
            </h1>

            <p
              className="text-sm sm:text-lg text-slate-600 leading-relaxed mb-6 max-w-xl mx-auto lg:mx-0"
            >
              <span className="sm:hidden">
                {/* v227 — دیرکتیو مالک: ادعای «نخبگان/بزرگترین مربیان» از صفحه اصلی حذف شد */}
                بهترین برنامه تمرینی و غذایی بدنسازی، کاملاً شخصی‌سازی‌شده برای بدن و هدف تو.
                خرید برنامه بدنسازی آنلاین.
              </span>
              <span className="hidden sm:inline">
                {/* v227 — دیرکتیو مالک: ادعای «نخبگان/بزرگترین مربیان» از صفحه اصلی حذف شد */}
                بهترین برنامه تمرینی و غذایی بدنسازی، کاملاً شخصی‌سازی‌شده برای بدن و هدف تو.
                هوش مصنوعی اختصاصی فیتاپ برنامه‌ای برای افزایش حجم، چربی‌سوزی و عضله‌سازی
                برای شما طراحی می‌کند.
                خرید برنامه بدنسازی آنلاین با پشتیبانی ۲۴ ساعته.
              </span>
            </p>

            <div
              className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8"
            >
              <button
                onClick={() => { const st = useAppStore.getState(); const u = st.user ?? st.ssrLandingUser; smartNavigate(!!u, setScreen, u?.onboardingDone); }}
                className="rounded-2xl h-14 px-8 text-base font-bold flex items-center justify-center gap-2 text-white shadow-xl transition hover:scale-[1.02]"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  boxShadow: "0 12px 30px -8px rgba(249, 115, 22, 0.5)",
                }}
              >
                <Zap className="w-5 h-5" />
                شروع کنید
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>

            {/* v86 — اثبات اجتماعی واقعی (دیرکتیو مالک): به‌جای «امتیاز رضایت
                ورزشکاران»، تعداد واقعی ثبت‌نام‌کنندگان از دیتابیس نمایش داده
                می‌شود — اعتماد با عدد واقعی ساخته می‌شود. */}
            <div
              className="animate-fade-in anim-delay-400 flex items-center gap-3 justify-center lg:justify-start"
            >
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
                <Users className="w-5 h-5 text-white" strokeWidth={2.5} />
              </div>
              <div className="text-sm text-slate-600">
                {/* v204 — دیرکتیو مالک: دیگر شمارندهٔ متحرک از صفر نیست — عدد واقعی
                    از SSR در HTML اولیه است (با اینترنت کند هم صفر دیده نمی‌شود) */}
                <span className="font-bold text-slate-900">{stats.usersFa}</span>
                <span> — ورزشکار به فیتاپ اعتماد کرده‌اند</span>
              </div>
            </div>
          </div>

          {/* Visual — hero image (بدون انیمیشن ورود — LCP لحظهٔ اول دیده می‌شود) */}
          <div
            className="relative"
          >
            <div className="relative mx-auto max-w-lg">
              {/* Hero image card — فقط تصویر اصلی، بدون المان‌های متحرک */}
              {/* v204 — عکس هیروی جدید (دیرکتیو مالک — لینک uploadkon) با پایپ‌لاین
                  AVIF+WebP: همهٔ واریانت‌ها زیر ۵۶KB هستند (PNG اصلی ۱.۱MB بود →
                  ~۲۰ برابر سبک‌تر) با کیفیت غیرقابل‌تشخیص (MAE<2.4/255).
                  <picture>: AVIF برای همهٔ مرورگرهای مدرن، WebP فال‌بک سافاری ۱۴/۱۵. */}
              <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border-4 border-white">
                <picture>
                  <source
                    type="image/avif"
                    srcSet="/hero-fitup-mobile.avif 500w, /hero-fitup-680.avif 680w, /hero-fitup-desktop.avif 800w, /hero-fitup.avif 886w"
                    sizes="(max-width: 768px) 90vw, (max-width: 1024px) 50vw, 600px"
                  />
                  <source
                    type="image/webp"
                    srcSet="/hero-fitup-mobile.webp 500w, /hero-fitup-680.webp 680w, /hero-fitup-desktop.webp 800w, /hero-fitup.webp 886w"
                    sizes="(max-width: 768px) 90vw, (max-width: 1024px) 50vw, 600px"
                  />
                  <img
                    src="/hero-fitup.webp"
                    alt="فیتاپ - اپلیکیشن تناسب اندام و بدنسازی"
                    width={886}
                    height={886}
                    className="w-full h-auto block"
                    loading="eager"
                    fetchPriority="high"
                  />
                </picture>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
