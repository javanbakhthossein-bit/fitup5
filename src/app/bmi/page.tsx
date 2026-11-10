import type { Metadata } from "next";
import Link from "next/link";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { BmiCalculator } from "@/components/fitness/tools/bmi-calculator";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { Home, ChevronLeft, Scale, Flame, Drumstick, Dumbbell, Apple, Sparkles } from "lucide-react";
// v249-seo — ارجاع کانونی Organization/WebSite با @id (بدون موجودیت تکراری)
import { fitupWebsiteRef, fitupOrgRef } from "@/lib/fitness/schema-org";
// Task 8-a — تعداد زندهٔ بانک غذا در باکس «ابزارهای رایگان دیگر» (قبلاً «بیش از ۱۰۰۰ غذا» هاردکد بود)
import { getFoodCountFa } from "@/lib/fitness/food-count";
// v262 — ممیزی سئو: نوار راهنماها (خوشهٔ خرید + لندینگ رشته) — لینک‌سازی داخلی
import { GuidesStrip } from "@/components/fitness/articles/guides-strip";

/**
 * ─── Task 2-b — محاسبه‌گر BMI (/bmi) — صفحهٔ SSR سئو ───
 *
 * ساختار عیناً هم‌سطح /tdee: ToolsNav بالای صفحه، محتوای متنی کامل در سرور
 * (H1 + توضیح + جدول WHO + FAQ)، ماشین‌حساب فقط کلاینت
 * (bmi-calculator.tsx)، JSON-LD سمت سرور (WebApplication + BreadcrumbList + FAQPage)
 * و CTA به /#pricing و /tdee.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export async function generateMetadata(): Promise<Metadata> {
  return {
  title: { absolute: "محاسبه BMI آنلاین رایگان | شاخص توده بدنی — فیتاپ" },
  description:
    "محاسبه BMI آنلاین و رایگان با ماشین‌حساب شاخص توده بدنی فیتاپ؛ قد و وزن را وارد کنید تا شاخص BMI با دسته‌بندی سالم بودن وزن بر اساس استاندارد WHO (با مرزهای جمعیت‌های آسیایی)، گیج رنگی و بازهٔ وزن ایده‌آل شما فوراً محاسبه شود.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/bmi` },
  openGraph: {
    title: "محاسبه BMI آنلاین رایگان | شاخص توده بدنی — فیتاپ",
    description:
      "ماشین‌حساب رایگان شاخص توده بدنی (BMI): دسته‌بندی وزن بر اساس WHO، مرزهای آسیایی و بازهٔ وزن ایده‌آل — فوری و بدون ثبت‌نام.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/bmi`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/og/og-default.png`, width: 1200, height: 630, alt: "محاسبه‌گر BMI فیتاپ" }],
  },
  };
}

// ─── سوالات متداول — منبع واحد JSON-LD و بخش FAQ قابل‌مشاهدهٔ صفحه (هم‌متن) ───
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "شاخص BMI چگونه محاسبه می‌شود؟",
    a: "BMI یا شاخص توده بدنی از تقسیم وزن به کیلوگرم بر مجذور قد به متر به‌دست می‌آید: BMI = وزن ÷ (قد × قد). مثلاً فردی ۷۰ کیلوگرمی با قد ۱.۷۵ متر، BMI برابر ۲۲.۹ دارد که در بازهٔ وزن نرمال است. ماشین‌حساب همین صفحه این محاسبه را با یک رقم اعشار و به‌صورت لحظه‌ای انجام می‌دهد.",
  },
  {
    q: "بازهٔ سالم BMI چقدر است؟",
    a: "بر اساس استاندارد سازمان جهانی بهداشت (WHO): کمتر از ۱۸.۵ کم‌وزن، ۱۸.۵ تا ۲۴.۹ وزن نرمال و سالم، ۲۵ تا ۲۹.۹ اضافه‌وزن، ۳۰ تا ۳۴.۹ چاقی درجه یک، ۳۵ تا ۳۹.۹ چاقی درجه دو و ۴۰ به بالا چاقی درجه سه (بیمارگونه) است. برای جمعیت‌های آسیایی (از جمله ایران) مرز وزن نرمال ۲۳ توصیه شده و BMI بین ۲۳ تا ۲۴.۹ «افزایش ریسک» محسوب می‌شود.",
  },
  {
    q: "آیا BMI برای ورزشکاران دقیق است؟",
    a: "BMI فقط جرم بدن را می‌سنجد و عضله را از چربی تشخیص نمی‌دهد؛ ورزشکار عضلانی ممکن است به‌خاطر توده عضلانی زیاد BMI بالای ۲۵ داشته باشد در حالی که درصد چربی بدنش کاملاً سالم است. به همین دلیل برای ورزشکاران، درصد چربی بدن و دور کمر معیارهای دقیق‌تری هستند. BMI یک غربالگری سریع و عمومی است، نه تشخیص پزشکی.",
  },
  {
    q: "وزن ایده‌آل من بر اساس قد چقدر است؟",
    a: "بازهٔ وزن سالم شما از ضرب کردن مرزهای BMI سالم (۱۸.۵ تا ۲۴.۹) در مجذور قدتان به‌دست می‌آید. مثلاً برای قد ۱۷۵ سانتی‌متر، بازهٔ وزن ایده‌آل حدود ۵۷ تا ۷۶ کیلوگرم است. ماشین‌حساب همین صفحه این بازه را به‌صورت خودکار همراه با نتیجهٔ BMI نمایش می‌دهد.",
  },
  {
    q: "BMI من بالای ۲۵ است؛ از کجا شروع کنم؟",
    a: "هدف واقع‌بینانه اول، کاهش ۵ تا ۱۰ درصد وزن فعلی در ۳ تا ۶ ماه است که همین اندازه هم ریسک دیابت و فشار خون را به‌طور معنادار کم می‌کند. شروع عملی: کسری کالری ملایم ۱۵ تا ۲۰ درصد (با محاسبه‌گر کالری فیتاپ)، پروتئین کافی برای حفظ عضله، تمرین قدرتی به‌همراه هوازی ملایم. اگر بیماری زمینه‌ای دارید، پیش از شروع با پزشک مشورت کنید.",
  },
];

// ─── جدول بازه‌های BMI طبق WHO (هم‌متن با توضیحات FAQ) ───
const WHO_TABLE: { range: string; label: string; color: string; note?: string }[] = [
  { range: "کمتر از ۱۸.۵", label: "کم‌وزن", color: "#b45309", note: "ریسک کمبود مواد مغذی و تحلیل عضلانی" },
  { range: "۱۸.۵ تا ۲۴.۹", label: "وزن نرمال (سالم)", color: "#047857", note: "کم‌ترین ریسک مرتبط با وزن" },
  { range: "۲۵ تا ۲۹.۹", label: "اضافه‌وزن", color: "#c2410c", note: "در جمعیت‌های آسیایی: شروع چاقی (≥ ۲۵)" },
  { range: "۳۰ تا ۳۴.۹", label: "چاقی درجه ۱", color: "#ea580c" },
  { range: "۳۵ تا ۳۹.۹", label: "چاقی درجه ۲", color: "#dc2626" },
  { range: "۴۰ به بالا", label: "چاقی درجه ۳ (بیمارگونه)", color: "#b91c1c" },
];

export default async function BmiPage() {
  // Task 8-a — شمارندهٔ پویای بانک غذا برای لینک داخلی /foods
  const foodFa = await getFoodCountFa();
  // ─── JSON-LD — الگوی /tdee + ارجاع کانونی @id (سمت سرور، هم‌متن با FAQ صفحه) ───
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "محاسبه‌گر BMI فیتاپ",
      alternateName: "FitUp BMI Calculator",
      url: `${SITE_URL}/bmi`,
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: "fa",
      description:
        "محاسبه‌گر آنلاین و رایگان شاخص توده بدنی (BMI) با دسته‌بندی WHO، مرزهای جمعیت‌های آسیایی، گیج رنگی و بازهٔ وزن ایده‌آل بر اساس قد.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "IRR" },
      creator: fitupOrgRef(),
      isPartOf: fitupWebsiteRef(),
      featureList: [
        "محاسبه شاخص توده بدنی (BMI) با یک رقم اعشار",
        "دسته‌بندی کم‌وزن، نرمال، اضافه‌وزن و چاقی بر اساس WHO",
        "مرزهای آسیایی جمعیت‌ها (مرز نرمال ۲۳)",
        "بازهٔ وزن ایده‌آل بر اساس قد",
        "گیج رنگی موقعیت BMI",
        "جدول بازه‌های مرجع با هایلایت وضعیت کاربر",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "محاسبه BMI", item: `${SITE_URL}/bmi` },
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

      {/* نوار واحد ابزارهای رایگان — هایلایت BMI */}
      <ToolsNav active="tool-bmi" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24 pb-16">
        {/* Breadcrumb */}
        <nav aria-label="مسیر صفحه" className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center gap-1.5 text-xs text-slate-400 mb-5">
          <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
            <Home className="w-3.5 h-3.5" />
            خانه
          </Link>
          <ChevronLeft className="w-3 h-3" />
          <span className="text-slate-600">محاسبه BMI</span>
        </nav>

        {/* ─── معرفی SSR — محتوای متنی واقعی برای سئو ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mb-8">
          <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3">
            <Scale className="w-3.5 h-3.5" />
            ابزار رایگان فیتاپ
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3 leading-tight">
            محاسبه BMI آنلاین — شاخص توده بدنی
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            <strong>BMI</strong> یا «شاخص توده بدنی» سریع‌ترین معیار غربالگری برای بررسی سالم بودن وزن شماست؛
            عددی که از تقسیم وزن (کیلوگرم) بر مجذور قد (متر) به‌دست می‌آید و نشان می‌دهد وزن شما نسبت به
            قدتان در کدام بازه قرار دارد: کم‌وزن، نرمال، اضافه‌وزن یا چاقی. سازمان جهانی بهداشت (WHO)
            همین بازه‌ها را مبنای ارزیابی ریسک دیابت نوع ۲، فشار خون و بیماری‌های قلبی-عروقی قرار می‌دهد.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            ماشین‌حساب زیر علاوه بر عدد BMI با یک رقم اعشار، <strong>دسته‌بندی رنگی</strong>، موقعیت شما روی
            گیج BMI و <strong>بازهٔ وزن ایده‌آل متناسب با قدتان</strong> را هم حساب می‌کند — کاملاً رایگان و
            بدون ثبت‌نام. توجه داشته باشید BMI بین عضله و چربی تفکیک نمی‌کند؛ بنابراین برای ورزشکاران
            عضلانی، درصد چربی بدن و دور کمر معیار مکمل بهتری است.
          </p>

          {/* جدول بازه‌های BMI طبق WHO */}
          <div className="mt-5 rounded-2xl border-2 border-slate-100 overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <caption className="text-right px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50">
                جدول بازه‌های BMI بر اساس استاندارد WHO
              </caption>
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th scope="col" className="text-right font-bold px-3 py-2">بازهٔ BMI (kg/m²)</th>
                  <th scope="col" className="text-right font-bold px-3 py-2">دسته‌بندی</th>
                  <th scope="col" className="text-right font-bold px-3 py-2 hidden sm:table-cell">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {WHO_TABLE.map((row) => (
                  <tr key={row.label} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 font-stat font-bold text-slate-700">{row.range}</td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: row.color }}>{row.label}</td>
                    <td className="px-3 py-2.5 text-slate-500 hidden sm:table-cell">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            <strong className="text-amber-700">نکتهٔ جمعیت‌های آسیایی:</strong> پژوهش‌های WHO برای جمعیت‌های
            آسیایی (از جمله ایران) مرز وزن نرمال را ۲۳ و شروع ریسک اضافه‌وزن را ۲۳ تا ۲۴.۹ توصیه می‌کند؛
            ماشین‌حساب فیتاپ هر دو معیار را در نتیجه نمایش می‌دهد.
          </p>
        </section>

        {/* ─── ماشین‌حساب (کلاینت) ─── */}
        <BmiCalculator />

        {/* ─── FAQ — هم‌متن با JSON-LD ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10" aria-labelledby="bmi-faq-title">
          <h2 id="bmi-faq-title" className="text-xl font-black text-slate-900 mb-4">
            سوالات متداول درباره محاسبه BMI
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
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10" aria-labelledby="bmi-tools-title">
          <h2 id="bmi-tools-title" className="text-xl font-black text-slate-900 mb-4">
            ابزارهای رایگان دیگر فیتاپ
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { href: "/1rm", icon: Dumbbell, title: "محاسبه 1RM", desc: "حداکثر وزنهٔ یک تکرار پرس، اسکوات و ددلیفت با فرمول‌های Epley و Brzycki" },
              { href: "/macro", icon: Drumstick, title: "محاسبه ماکرو روزانه", desc: "پروتئین، کربوهیدرات و چربی مورد نیازتان بر اساس هدف" },
              { href: "/exercises", icon: Flame, title: "بانک حرکات بدنسازی", desc: "آموزش تصویری و فرم صحیح ده‌ها حرکت تمرینی" },
              { href: "/foods", icon: Apple, title: "کالری غذاها", desc: `جدول کالری و درشت‌مغذی بیش از ${foodFa} غذا` },
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
              BMI فقط شروع مسیر است
            </h2>
            <p className="text-sm text-white/90 mb-4 leading-relaxed">
              با برنامهٔ تمرینی و غذایی اختصاصی فیتاپ، وزن و ترکیب بدنتان را هدفمند تغییر دهید — ساخته‌شده با هوش مصنوعی و پشتیبانی مربیان.
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

        {/* v262 — ممیزی سئو: لینک‌سازی داخلی به خوشهٔ خرید/برنامه‌ها */}
        <GuidesStrip variant="fatloss" />
      </main>

      {/* فوتر چسبان — هم‌تراز با بقیهٔ صفحات ابزار */}
      <SiteFooter />

      {/* سیاست نیکا: همه‌جای سایت به‌جز ورود/آنبوردینگ/پنل */}
      <NikaWidget context="public" />
    </div>
  );
}
