import type { Metadata } from "next";
import Link from "next/link";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { MacroCalculator } from "@/components/fitness/tools/macro-calculator";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { Home, ChevronLeft, Drumstick, Scale, Dumbbell, Flame, Apple, Sparkles } from "lucide-react";
// v249-seo — ارجاع کانونی Organization/WebSite با @id (بدون موجودیت تکراری)
import { fitupWebsiteRef, fitupOrgRef } from "@/lib/fitness/schema-org";
// Task 8-a — تعداد زندهٔ بانک غذا در باکس «ابزارهای رایگان دیگر» (قبلاً «بیش از ۱۰۰۰ غذا» هاردکد بود)
import { getFoodCountFa } from "@/lib/fitness/food-count";

/**
 * ─── Task 2-b — محاسبه‌گر ماکرو (/macro) — صفحهٔ SSR سئو ───
 *
 * ساختار عیناً هم‌سطح /tdee: ToolsNav بالای صفحه، محتوای متنی کامل در سرور
 * (H1 + توضیح + نقش درشت‌مغذی‌ها + جدول درصد پیشنهادی + FAQ)، ماشین‌حساب فقط
 * کلاینت (macro-calculator.tsx)، JSON-LD سمت سرور
 * (WebApplication + BreadcrumbList + FAQPage) و CTA به /#pricing و /tdee.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export async function generateMetadata(): Promise<Metadata> {
  return {
  title: { absolute: "محاسبه ماکرو و کالری روزانه | پروتئین، کربوهیدرات، چربی — فیتاپ" },
  description:
    "محاسبه آنلاین و رایگان ماکروهای روزانه: با فرمول علمی Mifflin-St Jeor کالری هدف، پروتئین (۱.۶ تا ۲.۲ گرم بر کیلوگرم)، کربوهیدرات و چربی مورد نیاز بدن شما برای کاهش وزن، حجم و نگهداری را دقیق حساب کنید.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/macro` },
  openGraph: {
    title: "محاسبه ماکرو و کالری روزانه | پروتئین، کربوهیدرات، چربی — فیتاپ",
    description:
      "ماشین‌حساب رایگان ماکروهای روزانه با فرمول Mifflin-St Jeor: کالری هدف، پروتئین، کربوهیدرات و چربی به گرم — برای کات، حجم و نگهداری.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/macro`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/og/og-default.png`, width: 1200, height: 630, alt: "محاسبه‌گر ماکرو فیتاپ" }],
  },
  };
}

// ─── سوالات متداول — منبع واحد JSON-LD و بخش FAQ قابل‌مشاهدهٔ صفحه (هم‌متن) ───
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "ماکرو (درشت‌مغذی) چیست؟",
    a: "درشت‌مغذی‌ها سه دسته اصلی کالری‌زای غذا هستند: پروتئین و کربوهیدرات هر کدام ۴ کالری در هر گرم و چربی ۹ کالری در هر گرم. کل کالری روزانهٔ شما از جمع همین سه ماکرو می‌آید؛ بنابراین «تعداد گرم» هر ماکرو عملاً همان برنامهٔ غذایی واقعی شماست — نه فقط عدد کالری.",
  },
  {
    q: "فرمول Mifflin-St Jeor چیست و چرا؟",
    a: "Mifflin-St Jeor دقیق‌ترین فرمول عمومی تخمین متابولیسم پایه (BMR) است: برای آقایان ۱۰ × وزن + ۶.۲۵ × قد − ۵ × سن + ۵ و برای خانم‌ها همان جمله منهای ۱۶۱. پژوهش‌ها آن را نسبت به هریس-بندیکت کم‌خطاتر نشان داده‌اند. سپس BMR در ضریب فعالیت (۱.۲ تا ۱.۹) ضرب می‌شود تا TDEE به‌دست آید.",
  },
  {
    q: "روزانه چند گرم پروتئین نیاز دارم؟",
    a: "بازهٔ علمی برای ورزشکاران ۱.۶ تا ۲.۲ گرم به‌ازای هر کیلوگرم وزن بدن است: در دورهٔ کات و کاهش وزن حدود ۲.۲ گرم برای حفظ عضله، در نگهداری حدود ۱.۸ گرم و در دورهٔ حجم حدود ۱.۶ گرم (چون مازاد کالری خودش حفاظت عضلانی ایجاد می‌کند). ماشین‌حساب همین صفحه بسته به هدف انتخابی‌تان، پروتئین را در همین بازه تنظیم می‌کند.",
  },
  {
    q: "برای کات (چربی‌سوزی) ماکروها چطور تنظیم می‌شوند؟",
    a: "در کات، کالری هدف حدود ۲۰٪ کمتر از TDEE است؛ پروتئین بالاتر از حد معمول (حدود ۲.۲ گرم بر کیلوگرم) گرفته می‌شود تا عضله حفظ شود، چربی حدود ۲۵٪ کالری نگه داشته می‌شود (برای هورمون‌ها) و باقی کالری به کربوهیدرات می‌رسد تا کیفیت تمرین افت نکند. کربوهیدرات را هرگز حذف نکنید — سوخت اصلی تمرین و مغز است.",
  },
  {
    q: "رابطهٔ ماکرو با کالری روزانه (TDEE) چیست؟",
    a: "TDEE کل کالری‌ای است که در شبانه‌روز می‌سوزانید و نقطهٔ شروع تعیین کالری هدف است (کسری برای کات، مازاد برای حجم). سپس همان کالری هدف بین سه ماکرو تقسیم می‌شود. برای دیدن جزئیات کامل TDEE، BMR و درصدهای فعالیت، ابزار «محاسبه‌گر کالری فیتاپ» را در کنار همین صفحه استفاده کنید.",
  },
];

// ─── درصد پیشنهادی ماکروها بر اساس هدف (هم‌متن با منطق ماشین‌حساب) ───
const GOAL_GUIDE: { goal: string; protein: string; fat: string; carbs: string; note: string; color: string }[] = [
  {
    goal: "کاهش وزن (کات)",
    protein: "≈ ۲.۲ گرم × وزن",
    fat: "≈ ۲۵٪ کالری",
    carbs: "بقیهٔ کالری",
    note: "کسری ۲۰٪ کالری + پروتئین بالا برای حفظ عضله",
    color: "#c2410c",
  },
  {
    goal: "نگهداری",
    protein: "≈ ۱.۸ گرم × وزن",
    fat: "≈ ۲۵٪ کالری",
    carbs: "بقیهٔ کالری",
    note: "تثبیت وزن و ترکیب بدن فعلی",
    color: "#047857",
  },
  {
    goal: "افزایش حجم",
    protein: "≈ ۱.۶ گرم × وزن",
    fat: "≈ ۲۵٪ کالری",
    carbs: "بقیهٔ کالری",
    note: "مازاد ۱۵٪ کالری برای رشد عضلانی کنترل‌شده",
    color: "#b45309",
  },
];

export default async function MacroPage() {
  // Task 8-a — شمارندهٔ پویای بانک غذا برای لینک داخلی /foods
  const foodFa = await getFoodCountFa();
  // ─── JSON-LD — الگوی /tdee + ارجاع کانونی @id (سمت سرور، هم‌متن با FAQ صفحه) ───
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "محاسبه‌گر ماکرو فیتاپ",
      alternateName: "FitUp Macro Calculator",
      url: `${SITE_URL}/macro`,
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: "fa",
      description:
        "محاسبه‌گر آنلاین و رایگان ماکروهای روزانه با فرمول Mifflin-St Jeor: کالری هدف، پروتئین (۱.۶ تا ۲.۲ گرم بر کیلوگرم)، کربوهیدرات و چربی به گرم — برای کاهش وزن، حجم و نگهداری.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "IRR" },
      creator: fitupOrgRef(),
      isPartOf: fitupWebsiteRef(),
      featureList: [
        "محاسبه BMR با فرمول علمی Mifflin-St Jeor",
        "محاسبه TDEE با ضریب فعالیت واقعی (۱.۲ تا ۱.۹)",
        "کالری هدف برای کات، نگهداری و حجم",
        "پروتئین ۱.۶ تا ۲.۲ گرم بر کیلوگرم بسته به هدف",
        "چربی ۲۵٪ کالری + کربوهیدرات باقی‌مانده به گرم",
        "کارت‌های رنگی تفکیک‌شده برای هر درشت‌مغذی",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "محاسبه ماکرو روزانه", item: `${SITE_URL}/macro` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_ITEMS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white" dir="rtl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* نوار واحد ابزارهای رایگان — هایلایت ماکرو */}
      <ToolsNav active="tool-macro" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24 pb-16">
        {/* Breadcrumb */}
        <nav aria-label="مسیر صفحه" className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center gap-1.5 text-xs text-slate-400 mb-5">
          <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
            <Home className="w-3.5 h-3.5" />
            خانه
          </Link>
          <ChevronLeft className="w-3 h-3" />
          <span className="text-slate-600">محاسبه ماکرو روزانه</span>
        </nav>

        {/* ─── معرفی SSR — محتوای متنی واقعی برای سئو ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mb-8">
          <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3">
            <Drumstick className="w-3.5 h-3.5" />
            ابزار رایگان فیتاپ
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3 leading-tight">
            محاسبه ماکرو و کالری روزانه
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            <strong>ماکروها</strong> یا درشت‌مغذی‌ها سه جزء کالری‌زای غذای شما هستند: <strong>پروتئین</strong>
            (بلوک سازندهٔ عضله — ۴ کالری در گرم)، <strong>کربوهیدرات</strong> (سوخت تمرین و مغز — ۴ کالری در
            گرم) و <strong>چربی</strong> (تنظیم هورمون‌ها مثل تستوسترون — ۹ کالری در گرم). کل کالری روزانهٔ
            شما از جمع همین سه می‌آید؛ پس «برنامهٔ غذایی» واقعی یعنی تعداد گرم هر ماکرو، نه فقط یک عدد کالری.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            ماشین‌حساب زیر ابتدا <strong>BMR</strong> را با دقیق‌ترین فرمول عمومی یعنی{" "}
            <strong>Mifflin-St Jeor</strong> حساب می‌کند، آن را در ضریب فعالیت شما ضرب می‌کند تا{" "}
            <strong>TDEE</strong> به‌دست آید و سپس بسته به هدف (کاهش وزن، نگهداری یا حجم) کالری هدف را
            بین سه ماکرو تقسیم می‌کند: پروتئین بین ۱.۶ تا ۲.۲ گرم به‌ازای هر کیلوگرم وزن بسته به هدف،
            چربی ۲۵٪ کالری و باقی کالری کربوهیدرات — همه به گرم و کاملاً رایگان.
          </p>

          {/* جدول درصد پیشنهادی بر اساس هدف */}
          <div className="mt-5 rounded-2xl border-2 border-slate-100 overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <caption className="text-right px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50">
                تقسیم پیشنهادی ماکروها بر اساس هدف
              </caption>
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th scope="col" className="text-right font-bold px-3 py-2">هدف</th>
                  <th scope="col" className="text-right font-bold px-3 py-2">پروتئین</th>
                  <th scope="col" className="text-right font-bold px-3 py-2">چربی</th>
                  <th scope="col" className="text-right font-bold px-3 py-2">کربوهیدرات</th>
                </tr>
              </thead>
              <tbody>
                {GOAL_GUIDE.map((row) => (
                  <tr key={row.goal} className="border-t border-slate-100">
                    <td className="px-3 py-2.5">
                      <span className="font-black" style={{ color: row.color }}>{row.goal}</span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">{row.note}</span>
                    </td>
                    <td className="px-3 py-2.5 font-stat font-bold text-slate-700">{row.protein}</td>
                    <td className="px-3 py-2.5 font-stat font-bold text-slate-700">{row.fat}</td>
                    <td className="px-3 py-2.5 font-stat font-bold text-slate-700">{row.carbs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            هر گرم پروتئین و کربوهیدرات ۴ کالری و هر گرم چربی ۹ کالری انرژی دارد؛ ماشین‌حساب زیر همین
            معادله را با اعداد شخصی شما حل می‌کند.
          </p>
        </section>

        {/* ─── ماشین‌حساب (کلاینت) ─── */}
        <MacroCalculator />

        {/* ─── FAQ — هم‌متن با JSON-LD ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10" aria-labelledby="macro-faq-title">
          <h2 id="macro-faq-title" className="text-xl font-black text-slate-900 mb-4">
            سوالات متداول درباره ماکروهای روزانه
          </h2>
          <div className="space-y-3">
            {FAQ_ITEMS.map((item) => (
              <div key={item.q} className="rounded-2xl border-2 border-slate-100 bg-slate-50/50 p-4">
                <h3 className="text-sm font-black text-slate-900 mb-1.5">{item.q}</h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── لینک‌سازی داخلی: ابزارهای دیگر + بانک حرکات و غذاها ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10" aria-labelledby="macro-tools-title">
          <h2 id="macro-tools-title" className="text-xl font-black text-slate-900 mb-4">
            ابزارهای رایگان دیگر فیتاپ
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { href: "/bmi", icon: Scale, title: "محاسبه BMI", desc: "شاخص توده بدنی با دسته‌بندی WHO و بازهٔ وزن ایده‌آل" },
              { href: "/1rm", icon: Dumbbell, title: "محاسبه 1RM", desc: "حداکثر وزنهٔ یک تکرار پرس، اسکوات و ددلیفت با فرمول‌های Epley و Brzycki" },
              { href: "/exercises", icon: Flame, title: "بانک حرکات بدنسازی", desc: "آموزش تصویری و فرم صحیح ده‌ها حرکت تمرینی" },
              { href: "/foods", icon: Apple, title: "کالری غذاها", desc: `جدول کالری و درشت‌مغذی بیش از ${foodFa} غذا برای رسیدن به ماکروها` },
            ].map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="group flex items-start gap-3 rounded-2xl border-2 border-slate-100 p-4 hover:border-orange-200 hover:bg-orange-50/40 transition"
              >
                <span className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 group-hover:bg-orange-200 transition">
                  <t.icon className="w-5 h-5 text-orange-600" />
                </span>
                <span>
                  <span className="block text-sm font-black text-slate-900">{t.title}</span>
                  <span className="block text-xs text-slate-500 mt-1 leading-relaxed">{t.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ─── CTA به /#pricing و /tdee ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10">
          <div className="relative overflow-hidden rounded-2xl p-6 text-center text-white" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/15 blur-2xl pointer-events-none" />
            <h2 className="text-lg sm:text-xl font-black mb-1 flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5" />
              ماکروها را می‌دانید — حالا برنامهٔ غذایی داشته باشید
            </h2>
            <p className="text-sm text-white/90 mb-4 leading-relaxed">
              فیتاپ همین اعداد را به رژیم غذایی واقعی با وعده‌ها، گرم‌ها و غذاهای ایرانی تبدیل می‌کند — با هوش مصنوعی و پشتیبانی مربیان.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link
                href="/#pricing"
                className="inline-flex items-center justify-center bg-white text-orange-600 hover:bg-white/90 rounded-xl font-black px-6 h-11 transition w-full sm:w-auto"
              >
                برنامهٔ اختصاصی خودم را می‌خواهم
              </Link>
              <Link
                href="/tdee"
                className="inline-flex items-center justify-center bg-white/15 backdrop-blur-sm border border-white/40 text-white hover:bg-white/25 rounded-xl font-bold px-6 h-11 transition w-full sm:w-auto"
              >
                محاسبه کالری روزانه (TDEE)
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* فوتر چسبان — هم‌تراز با بقیهٔ صفحات ابزار */}
      <SiteFooter />

      {/* سیاست نیکا: همه‌جای سایت به‌جز ورود/آنبوردینگ/پنل */}
      <NikaWidget context="public" />
    </div>
  );
}
