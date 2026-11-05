"use client";

import Link from "next/link";
import { Calculator, Dumbbell, Apple, ChevronLeft, Sparkles, Wrench, Scale, Weight, Drumstick } from "lucide-react";
// v218 — navigateTo* حذف شد: کارت‌های ابزار حالا <Link> واقعی دارند (href خزیدنی
// برای گوگل + ناوبری سمت کلاینت + prefetch خودکار). قبلاً فقط onClick با
// window.location.assign بود — یعنی صفر لینک داخلی قابل خزش از لندینگ به /tdee و…
import { usePublicStats, formatFaCount } from "../use-public-stats";

const TOOLS = [
  {
    id: "tool-tdee" as const,
    href: "/tdee",
    icon: Calculator,
    title: "محاسبه‌گر کالری",
    desc: "میزان کالری روزانه (TDEE) و درشت‌مغذی‌های مورد نیازت را بر اساس فرمول هریس-بندیکت دقیق محاسبه کن — کاملاً رایگان و بدون ثبت‌نام.",
    points: ["محاسبه BMR", "کالری هدف", "درشت‌مغذی‌ها"],
    accent: "from-amber-500 to-orange-500",
  },
  {
    id: "tool-exercises" as const,
    href: "/exercises",
    icon: Dumbbell,
    title: "بانک حرکات ورزشی",
    // v94 — عدد پویا در رندر جایگزین می‌شود (حرکات رشته‌های ترند پیلاتس/TRX و…)
    desc: "EXERCISES_COUNT_DYN حرکت ورزشی را با فیلتر بر اساس عضله هدف و تجهیزات جستجو کن. شامل آموزش گام‌به‌گام و نکات ایمنی.",
    points: ["EXERCISES_COUNT_DYN حرکت", "فیلتر عضله", "آموزش گام‌به‌گام"],
    accent: "from-orange-500 to-red-500",
  },
  {
    id: "tool-foods" as const,
    href: "/foods",
    icon: Apple,
    title: "جدول کالری غذاها",
    // v137 — تعداد غذاها پویا شد (مثل حرکات) — با رشد بانک، عدد آپدیت می‌شود
    desc: "بانک FOODS_COUNT_DYN غذای ایرانی و بین‌المللی با محاسبه‌گر داینامیک ارزش غذایی — برای هر وزن، کالری و درشت‌مغذی‌ها را آنی ببین.",
    points: ["FOODS_COUNT_DYN غذا", "محاسبه داینامیک", "غذاهای ایرانی"],
    accent: "from-yellow-500 to-amber-500",
  },
];

export function ToolsSection() {
  // v94 — شمارندهٔ پویای حرکات (دیرکتیو مالک) — همان منبع مشترک TrustBar؛
  // تا رسیدن پاسخ، فال‌بک «۳۲۰+» (تعداد فعلی کتابخانه) نمایش داده می‌شود.
  const stats = usePublicStats();
  const countText = stats.exercises > 0 ? `${formatFaCount(stats.exercises)}+` : "۳۲۰+";
  // v137 — شمارندهٔ پویای غذاها (همان منبع مشترک TrustBar)
  // Task 8-a — فال‌بک عددی حذف شد (دیرکتیو مالک: هیچ عدد ثابت غذایی در UI نیست) —
  // فقط وقتی آمار واقعی نبود، عدد نمایش داده نمی‌شود و متن بدون عدد می‌ماند.
  const foodsText = stats.foods > 0 ? `${formatFaCount(stats.foods)}+` : "";
  // v161 — replaceAll حذف شد: String.prototype.replaceAll از Chrome 85/Safari 13.1
  // است؛ مرورگر Huawei 11 (Chrome/83) و WebViewهای قدیمی‌تر اینجا کرش error-boundary
  // می‌گرفتند («e.replaceAll is not a function» — تب پلن‌ها، لاگ مالک). الگوی
  // split/join در همهٔ موتورها بدون پالی‌فیل کار می‌کند.
  const injectCount = (s: string) =>
    s.split("EXERCISES_COUNT_DYN").join(countText).split("FOODS_COUNT_DYN").join(foodsText);

  return (
    <section id="tools" className="py-20 sm:py-28 bg-white relative overflow-hidden scroll-mt-20">
      {/* subtle background */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-20 right-0 w-80 h-80 rounded-full bg-amber-100/40 blur-3xl" />
        <div className="absolute bottom-20 left-0 w-80 h-80 rounded-full bg-orange-100/40 blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="animate-fade-in-up text-center mb-14">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-4"
            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}
          >
            <Wrench className="w-4 h-4" />
            ابزارهای رایگان فیتاپ
          </div>
          <h2 className="text-3xl sm:text-4xl font-black mb-4 text-slate-900">
            بدون ثبت‌نام هم{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #f59e0b, #f97316)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              از ابزارها استفاده کن
            </span>
          </h2>
          {/* v252 — دیرکتیو مالک: همهٔ ابزارها در صفحه اصلی + متن درست «هفت ابزار» */}
          <p className="text-slate-500 max-w-2xl mx-auto">
            هفت ابزار کاربردی کاملاً رایگان برای شروع مسیر تناسب اندام — بدون نیاز به ثبت‌نام. هر زمان خواستی کاملش کنی، ثبت‌نام کن و برنامه اختصاصی بگیر.
          </p>
        </div>

        {/* ─── v249-dom-fix — یک لیست واحد برای دسکتاپ/موبایل ───
            قبلاً همین ۳ کارت «دو بار» رندر می‌شد (گرید دسکتاپ + اسکرول موبایل؛
            هر دو همیشه در DOM با hideکردن CSS). حالا یک کانتینر: موبایل =
            اسکرول افقی، md+ = گرید ۳ستونه. ظاهر هر دو عیناً حفظ شده. */}
        <div
          className="-mx-4 px-4 md:mx-0 md:px-0 md:max-w-5xl flex gap-4 md:gap-6 overflow-x-auto no-scrollbar pb-3 md:pb-0 md:grid md:grid-cols-3 md:overflow-visible md:mx-auto"
        >
          {TOOLS.map((tool, i) => (
            <div
              key={tool.id}
              style={{ animationDelay: `${i * 0.1}s` }}
              className="animate-fade-in-up shrink-0 w-[85vw] max-w-[300px] md:w-auto md:max-w-none group relative bg-white rounded-3xl p-5 md:p-6 border-2 border-orange-100 hover:border-orange-300 hover:shadow-2xl hover:shadow-orange-500/10 transition-all overflow-hidden flex flex-col md:hover:-translate-y-2"
            >
              {/* shimmer on hover — فقط دسکتاپ (مثل قبل) */}
              <div className="hidden md:block absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div
                  className="absolute -inset-x-10 -top-10 h-20 blur-2xl rotate-12"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(245, 158, 11, 0.18), transparent)",
                  }}
                />
              </div>

              {/* آیکون گرادیانی — موبایل ۱۴، دسکتاپ ۱۶ (مثل قبل) */}
              <div
                className={`relative w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${tool.accent} flex items-center justify-center mb-3 md:mb-4 shadow-xl group-hover:scale-110 transition-transform`}
                style={{ boxShadow: "0 10px 24px -8px rgba(249, 115, 22, 0.5)" }}
              >
                <tool.icon className="w-7 h-7 md:w-8 md:h-8 text-white" strokeWidth={2.5} />
              </div>

              <h3 className="font-black text-base md:text-lg mb-2 text-slate-900">{tool.title}</h3>
              <p className="text-xs md:text-sm text-slate-500 leading-relaxed mb-3 md:mb-4 flex-1">{injectCount(tool.desc)}</p>

              <div className="flex flex-wrap gap-1.5 mb-4 md:mb-5">
                {tool.points.map((p, j) => (
                  <span
                    key={j}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-100"
                  >
                    {injectCount(p)}
                  </span>
                ))}
              </div>

              <Link
                href={tool.href}
                className="w-full rounded-2xl h-11 md:h-12 font-bold text-xs md:text-sm text-white transition hover:scale-[1.02] flex items-center justify-center gap-2 shadow-lg"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  boxShadow: "0 10px 22px -8px rgba(249, 115, 22, 0.45)",
                }}
              >
                <Sparkles className="w-4 h-4" />
                استفاده رایگان
                <ChevronLeft className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-[10px] text-slate-500 mt-1 md:hidden">← برای مشاهده بیشتر بکشید →</p>

        {/* ═══ v252 — سه محاسبه‌گر دیگر (BMI / 1RM / ماکرو) — دیرکتیو مالک:
            «همه ابزارها را در صفحه اصلی هم باید نشون بدی» — کارت‌های مینیمال
            زیر کارت‌های اصلی، هم‌زبان بصری با بقیه سایت ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mt-4 md:mt-6">
          {[
            {
              href: "/bmi",
              icon: Scale,
              title: "محاسبه BMI",
              desc: "شاخص توده بدنی و وضعیت وزن تو در یک لحظه",
            },
            {
              href: "/1rm",
              icon: Weight,
              title: "محاسبه 1RM",
              desc: "حداکثر وزنهٔ یک‌تکراری برای برنامه‌نویسی دقیق",
            },
            {
              href: "/macro",
              icon: Drumstick,
              title: "محاسبه ماکرو",
              desc: "پروتئین، کربوهیدرات و چربی روزانهٔ تو",
            },
          ].map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group flex items-center gap-3.5 rounded-2xl border-2 border-orange-100 bg-white p-4 hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/10 transition-all"
            >
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-md group-hover:scale-110 transition-transform"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <tool.icon className="w-5 h-5 text-white" strokeWidth={2.4} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-black text-sm text-slate-900 group-hover:text-orange-600 transition">{tool.title}</span>
                <span className="block text-[11px] text-slate-500 leading-relaxed truncate">{tool.desc}</span>
              </span>
              <ChevronLeft className="w-4 h-4 text-orange-400 shrink-0 group-hover:-translate-x-0.5 transition-transform" />
            </Link>
          ))}
        </div>

        {/* v246-free-programs — کارت ویژهٔ «برنامه‌های بدنسازی رایگان» (قیف جذب جدید)
            الگوی کارت‌های بالا با تصویر برند — در دسکتاپ و موبایل زیر گرید/اسکرولر */}
        <Link
          href="/free-programs"
          className="animate-fade-in group mt-6 relative flex flex-col md:flex-row rounded-3xl border-2 border-orange-100 bg-white overflow-hidden hover:border-orange-300 hover:shadow-2xl hover:shadow-orange-500/10 transition-all"
        >
          <div className="relative h-44 md:h-auto md:w-72 shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/free-programs/hero.jpg"
              alt="برنامه‌های بدنسازی رایگان فیتاپ — تمرین در باشگاه"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(15,23,42,0) 55%, rgba(15,23,42,0.55))" }} />
            {/* v251 — عدد واقعی کاتالوگ (۳۲ برنامه — free-programs-data.ts) جای «۱۶» قدیمی */}
            <span className="absolute top-3 right-3 text-[10px] font-black text-white px-2.5 py-1 rounded-full" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
              جدید — ۳۲ برنامهٔ کامل
            </span>
          </div>
          <div className="flex-1 p-6 flex flex-col">
            <h3 className="font-black text-lg mb-2 text-slate-900 group-hover:text-orange-600 transition">
              برنامه‌های بدنسازی رایگان
            </h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-3 flex-1">
              {/* v252 — دیرکتیو مالک: «۵ روزه و ۶ روزه را ننوشتی» — متن واقعی کاتالوگ (۳ تا ۶ روز) */}
              برنامه افزایش حجم، چربی‌سوزی، باسن و تمرین در خانه — جدا برای آقایان و بانوان، ۳ تا ۶ روز در هفته، با ست و تکرار دقیق هر حرکت و دانلود عکس برنامه. بدون ثبت‌نام.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {["حجم", "چربی‌سوزی", "باسن", "در خانه", "دانلود عکس"].map((p) => (
                <span key={p} className="text-[10px] px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-100">
                  {p}
                </span>
              ))}
            </div>
            <span className="w-full md:w-auto rounded-2xl h-12 px-8 font-bold text-sm text-white transition hover:scale-[1.02] inline-flex items-center justify-center gap-2 shadow-lg self-stretch md:self-start" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", boxShadow: "0 10px 22px -8px rgba(249, 115, 22, 0.45)" }}>
              <Sparkles className="w-4 h-4" />
              برنامهٔ رایگان بگیر
              <ChevronLeft className="w-4 h-4" />
            </span>
          </div>
        </Link>

        {/* Bottom note */}
        <div
          className="animate-fade-in text-center mt-10"
        >
          <p className="text-sm text-slate-500">
            ✨ این ابزارها برای همیشه رایگان هستند — بدون محدودیت و بدون نیاز به ثبت‌نام
          </p>
        </div>
      </div>
    </section>
  );
}
