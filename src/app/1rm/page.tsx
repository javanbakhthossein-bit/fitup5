import type { Metadata } from "next";
import Link from "next/link";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { OneRmCalculator } from "@/components/fitness/tools/one-rm-calculator";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { Home, ChevronLeft, Dumbbell, Scale, Drumstick, Flame, Apple, Sparkles } from "lucide-react";
// v249-seo — ارجاع کانونی Organization/WebSite با @id (بدون موجودیت تکراری)
import { fitupWebsiteRef, fitupOrgRef } from "@/lib/fitness/schema-org";
// Task 8-a — تعداد زندهٔ بانک غذا در باکس «ابزارهای رایگان دیگر» (قبلاً «بیش از ۱۰۰۰ غذا» هاردکد بود)
import { getFoodCountFa } from "@/lib/fitness/food-count";
// v262 — ممیزی سئو: نوار راهنماها (خوشهٔ خرید + لندینگ رشته) — لینک‌سازی داخلی
import { GuidesStrip } from "@/components/fitness/articles/guides-strip";

/**
 * ─── Task 2-b — محاسبه‌گر 1RM (/1rm) — صفحهٔ SSR سئو ───
 *
 * ساختار عیناً هم‌سطح /tdee: ToolsNav بالای صفحه، محتوای متنی کامل در سرور
 * (H1 + توضیح + فرمول‌های Epley/Brzycki + جدول درصدی + FAQ)، ماشین‌حساب فقط
 * کلاینت (one-rm-calculator.tsx)، JSON-LD سمت سرور
 * (WebApplication + BreadcrumbList + FAQPage) و CTA به /#pricing و /tdee.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export async function generateMetadata(): Promise<Metadata> {
  return {
  title: { absolute: "محاسبه 1RM آنلاین | حداکثر یک تکرار (پرس/اسکوات/ددلیفت) — فیتاپ" },
  description:
    "محاسبه آنلاین و رایگان 1RM (حداکثر وزنهٔ یک تکرار) با فرمول‌های علمی Epley و Brzycki؛ وزنه و تکرار را وارد کنید تا حداکثر قدرت پرس سینه، اسکوات و ددلیفت شما به‌همراه جدول درصدی تمرین از ۹۵٪ تا ۷۰٪ محاسبه شود.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/1rm` },
  openGraph: {
    title: "محاسبه 1RM آنلاین | حداکثر یک تکرار (پرس/اسکوات/ددلیفت) — فیتاپ",
    description:
      "ماشین‌حساب رایگان حداکثر وزنهٔ یک تکرار (1RM) با فرمول‌های Epley و Brzycki + جدول درصدی تمرین از ۹۵٪ تا ۷۰٪ — فوری و بدون ثبت‌نام.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/1rm`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/og/og-default.png`, width: 1200, height: 630, alt: "محاسبه‌گر 1RM فیتاپ" }],
  },
  };
}

// ─── سوالات متداول — منبع واحد JSON-LD و بخش FAQ قابل‌مشاهدهٔ صفحه (هم‌متن) ───
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "1RM چیست و چرا مهم است؟",
    a: "1RM یا One Rep Max یعنی بیشترین وزنه‌ای که می‌توانید فقط «یک بار» با فرم صحیح جابجا کنید. این عدد معیار استاندارد سنجش قدرت بیشینه در پرس سینه، اسکوات و ددلیفت است و مبنای برنامه‌نویسی تمرین محسوب می‌شود؛ چون شدت تمرین همیشه بر حسب «درصدی از 1RM» تعیین می‌شود، نه وزنهٔ مطلق.",
  },
  {
    q: "فرمول Epley و Brzycki چه تفاوتی دارند؟",
    a: "هر دو فرمول، 1RM را از روی وزنهٔ جابجاشده و تعداد تکرار تخمین می‌زنند: Epley یعنی 1RM = وزنه × (۱ + تکرار ÷ ۳۰) و Brzycki یعنی 1RM = وزنه × ۳۶ ÷ (۳۷ − تکرار). Epley در تکرارهای بالا معمولاً عدد کمی بزرگ‌تر و Brzycki محافظه‌کارانه‌تر است. ماشین‌حساب فیتاپ میانگین هر دو را نمایش می‌دهد تا تخمین واقع‌بینانه‌تر باشد.",
  },
  {
    q: "چرا مستقیماً 1RM واقعی را تست نکنم؟",
    a: "تست مستقیم 1RM برای مبتدیان و حتی میان‌رده‌ها ریسک آسیب بالایی دارد و به گرم‌کردن حرفه‌ای و حامی تمرینی نیاز است. فرمول‌های تخمینی با ست‌هایی مثل ۵ تکرار با وزنهٔ سنگین، خطای حدود ۳ تا ۵ درصد دارند — یعنی همین ماشین‌حساب، جایگزین امن و دقیقی برای تست حدکشیدنی است. اگر خواستید تست واقعی انجام دهید، حتماً با مربی و پشتیبان باشید.",
  },
  {
    q: "هر درصد از 1RM برای چه هدفی مناسب است؟",
    a: "قاعدهٔ کلی برنامه‌نویسی قدرتی: ۹۰ تا ۱۰۰٪ برای قدرت بیشینه (۱ تا ۴ تکرار)، ۸۰ تا ۹۰٪ برای ترکیب قدرت و حجم (۵ تا ۸ تکرار)، ۷۰ تا ۸۰٪ برای حجم عضلانی (۸ تا ۱۲ تکرار) و ۵۰ تا ۷۰٪ برای استقامت عضلانی و اصلاح فرم. جدول درصدی همین صفحه، وزنهٔ دقیق هر درصد را برای شما محاسبه می‌کند.",
  },
  {
    q: "هر چند وقت یک بار باید 1RM خود را دوباره محاسبه کنم؟",
    a: "با پیشرفت تمرین، 1RM شما تغییر می‌کند؛ عملاً هر ۴ تا ۶ هفته یک‌بار وزنه و تکرار یک ست سنگین را دوباره وارد ماشین‌حساب کنید و برنامه را بر اساس عدد جدید به‌روزرسانی نمایید. اگر وزنه‌ای که قبلاً برای ۵ تکرار سنگین بود، حالا ۸ تکرار می‌رود، زمان تازه‌سازی اعداد رسیده است.",
  },
];

// ─── جدول درصدی مرجع (هم‌متن با جدول نتیجهٔ ماشین‌حساب) ───
const PERCENT_REFERENCE: { pct: string; reps: string; use: string }[] = [
  { pct: "۹۵٪", reps: "حدود ۲ تکرار", use: "تست قدرت و ست‌های بسیار سنگین" },
  { pct: "۹۰٪", reps: "حدود ۴ تکرار", use: "ست‌های قدرتی برای افزایش 1RM" },
  { pct: "۸۵٪", reps: "حدود ۶ تکرار", use: "ترکیب قدرت و حجم — ست‌های سنگین ۵×۵" },
  { pct: "۸۰٪", reps: "حدود ۸ تکرار", use: "حجم و قدرت (مثلاً ۶ تکرار با ۸۰٪)" },
  { pct: "۷۵٪", reps: "حدود ۱۰ تکرار", use: "حجم‌سازی عضلانی با فرم تمیز" },
  { pct: "۷۰٪", reps: "حدود ۱۲ تکرار", use: "حجم، پمپاژ خون و استقامت عضلانی" },
];

export default async function OneRmPage() {
  // Task 8-a — شمارندهٔ پویای بانک غذا برای لینک داخلی /foods
  const foodFa = await getFoodCountFa();
  // ─── JSON-LD — الگوی /tdee + ارجاع کانونی @id (سمت سرور، هم‌متن با FAQ صفحه) ───
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "محاسبه‌گر 1RM فیتاپ",
      alternateName: "FitUp One Rep Max Calculator",
      url: `${SITE_URL}/1rm`,
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: "fa",
      description:
        "محاسبه‌گر آنلاین و رایگان حداکثر وزنهٔ یک تکرار (1RM) با فرمول‌های Epley و Brzycki برای پرس سینه، اسکوات، ددلیفت و دیگر حرکات — همراه جدول درصدی تمرین ۹۵٪ تا ۷۰٪.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "IRR" },
      creator: fitupOrgRef(),
      isPartOf: fitupWebsiteRef(),
      featureList: [
        "تخمین 1RM با هر دو فرمول Epley و Brzycki و نمایش میانگین",
        "مناسب پرس سینه، اسکوات، ددلیفت، پرس سرشانه و زیربغل",
        "جدول درصدی تمرین از ۹۵٪ تا ۷۰٪ با کاربرد هر درصد",
        "گرد کردن وزنه‌ها به ۰.۵ کیلوگرم (وزنهٔ واقعی باشگاه)",
        "گارد ورودی: تکرار بین ۱ تا ۱۲ برای دقت فرمول‌ها",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "محاسبه 1RM", item: `${SITE_URL}/1rm` },
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

      {/* نوار واحد ابزارهای رایگان — هایلایت 1RM */}
      <ToolsNav active="tool-1rm" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24 pb-16">
        {/* Breadcrumb */}
        <nav aria-label="مسیر صفحه" className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center gap-1.5 text-xs text-slate-400 mb-5">
          <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
            <Home className="w-3.5 h-3.5" />
            خانه
          </Link>
          <ChevronLeft className="w-3 h-3" />
          <span className="text-slate-600">محاسبه 1RM</span>
        </nav>

        {/* ─── معرفی SSR — محتوای متنی واقعی برای سئو ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mb-8">
          <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3">
            <Dumbbell className="w-3.5 h-3.5" />
            ابزار رایگان فیتاپ
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3 leading-tight">
            محاسبه 1RM — حداکثر وزنهٔ یک تکرار
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            <strong>1RM</strong> یا One Rep Max یعنی بیشترین وزنه‌ای که می‌توانید فقط یک بار با فرم صحیح
            جابجا کنید — معیار طلایی سنجش <strong>قدرت بیشینه</strong> در پرس سینه، اسکوات و ددلیفت. چون
            شدت تمرینات قدرتی همیشه بر حسب «درصدی از 1RM» برنامه‌ریزی می‌شود، دانستن این عدد پیش‌نیاز هر
            برنامهٔ جدی قدرتی و حجمی است.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            تست مستقیم 1RM ریسک آسیب دارد؛ به همین دلیل مربیان از <strong>فرمول‌های تخمینی</strong> استفاده
            می‌کنند. دو معتبرترین فرمول جهان عبارت‌اند از:
          </p>

          {/* فرمول‌ها */}
          <div className="grid sm:grid-cols-2 gap-3 mb-2">
            <div className="rounded-2xl border-2 border-slate-100 bg-slate-50/60 p-4">
              <p className="text-sm font-black text-slate-900 mb-1">فرمول Epley (۱۹۹۶)</p>
              <p className="text-base font-black font-stat text-orange-700 mb-1.5" dir="ltr">
                1RM = w × (1 + r/30)
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                ساده و پرکاربرد؛ برای تکرارهای ۱ تا ۱۰ دقت بالایی دارد.
              </p>
            </div>
            <div className="rounded-2xl border-2 border-slate-100 bg-slate-50/60 p-4">
              <p className="text-sm font-black text-slate-900 mb-1">فرمول Brzycki (۱۹۹۳)</p>
              <p className="text-base font-black font-stat text-orange-700 mb-1.5" dir="ltr">
                1RM = w × 36 / (37 − r)
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                محافظه‌کارانه‌تر؛ در تکرارهای بالاتر عدد کمی کمتر از Epley می‌دهد.
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            (w = وزنه به کیلوگرم، r = تعداد تکرار) — ماشین‌حساب زیر هر دو فرمول را هم‌زمان محاسبه و
            <strong> میانگین</strong> آن‌ها را به‌عنوان تخمین نهایی نمایش می‌دهد؛ سپس جدول درصدی تمرین از
            ۹۵٪ تا ۷۰٪ را با کاربرد هر درصد می‌سازد. برای دقت بیشتر، ست ورودی را بین ۱ تا ۱۰ تکرار انتخاب کنید.
          </p>

          {/* جدول درصدی مرجع */}
          <div className="mt-5 rounded-2xl border-2 border-slate-100 overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <caption className="text-right px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50">
                جدول درصدی تمرین بر پایهٔ 1RM — مرجع چارت استاندارد قدرتی
              </caption>
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th scope="col" className="text-right font-bold px-3 py-2">درصد 1RM</th>
                  <th scope="col" className="text-right font-bold px-3 py-2">تکرار تقریبی</th>
                  <th scope="col" className="text-right font-bold px-3 py-2 hidden sm:table-cell">کاربرد</th>
                </tr>
              </thead>
              <tbody>
                {PERCENT_REFERENCE.map((row) => (
                  <tr key={row.pct} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 font-stat font-black text-slate-700">{row.pct}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-600">{row.reps}</td>
                    <td className="px-3 py-2.5 text-slate-500 hidden sm:table-cell">{row.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── ماشین‌حساب (کلاینت) ─── */}
        <OneRmCalculator />

        {/* ─── FAQ — هم‌متن با JSON-LD ─── */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10" aria-labelledby="rm-faq-title">
          <h2 id="rm-faq-title" className="text-xl font-black text-slate-900 mb-4">
            سوالات متداول درباره 1RM و محاسبه حداکثر قدرت
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
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-10" aria-labelledby="rm-tools-title">
          <h2 id="rm-tools-title" className="text-xl font-black text-slate-900 mb-4">
            ابزارهای رایگان دیگر فیتاپ
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { href: "/bmi", icon: Scale, title: "محاسبه BMI", desc: "شاخص توده بدنی با دسته‌بندی WHO و بازهٔ وزن ایده‌آل" },
              { href: "/macro", icon: Drumstick, title: "محاسبه ماکرو روزانه", desc: "پروتئین، کربوهیدرات و چربی مورد نیازتان بر اساس هدف" },
              { href: "/exercises", icon: Flame, title: "بانک حرکات بدنسازی", desc: "آموزش تصویری و فرم صحیح پرس، اسکوات، ددلیفت و ده‌ها حرکت دیگر" },
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
              قدرت را اندازه گرفتید — حالا چند برابرش کنید
            </h2>
            <p className="text-sm text-white/90 mb-4 leading-relaxed">
              برنامهٔ تمرینی اختصاصی فیتاپ با درصددهای دقیق 1RM، ست و تکرار و روند پیشرفت هفتگی ساخته می‌شود — با هوش مصنوعی و پشتیبانی مربیان.
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

        {/* v262 — ممیزی سئو: لینک‌سازی داخلی به پاورلیفتینگ/خوشهٔ خرید */}
        <GuidesStrip variant="strength" />
      </main>

      {/* فوتر چسبان — هم‌تراز با بقیهٔ صفحات ابزار */}
      <SiteFooter />

      {/* سیاست نیکا: همه‌جای سایت به‌جز ورود/آنبوردینگ/پنل */}
      <NikaWidget context="public" />
    </div>
  );
}
