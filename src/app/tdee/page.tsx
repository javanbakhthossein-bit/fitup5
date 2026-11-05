import type { Metadata } from "next";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { db } from "@/lib/db";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { TdeeCalculator } from "@/components/fitness/tools/tdee-calculator";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { toPersianDigits } from "@/lib/fitness/types";
// v249-seo — توضیحات مشترک SSR/کلاینت (رفع «توضیحات متا متفاوت» ابزار ممیزی)
import { TDEE_META_DESCRIPTION, fitupOrgRef } from "@/lib/fitness/schema-org";
// v252-memorize — FAQ هم‌متن با آکاردئون کلاینت (JSON-LD سمت سرور مثل /bmi)
// — از ماژول خنثی مشترک (نه ماژول 'use client') تا client reference نشود
import { TDEE_FAQ_ITEMS } from "@/lib/fitness/tdee-faq";

/**
 * ─── v106 — محاسبه‌گر کالری (/tdee) — route واقعی SSR ───
 *
 * تا v105 محاسبه‌گر فقط اسکرین SPA (?tool=tdee) بود؛ حالا مسیر واقعی دارد و
 * ورودی‌های قدیمی با 308 به همین‌جا می‌آیند (src/proxy.ts).
 * کامپوننت محاسبه‌گر کاملاً self-contained است (بدون وابستگی به store SPA) —
 * فقط CTAهای بعد از نتیجه context-aware شدند (tool-result-cta.tsx).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "محاسبه کالری روزانه و TDEE | محاسبه‌گر کالری، BMR و BMI | فیتاپ" },
  // v249-seo — عیناً همان رشته‌ای که افکت کلاینتی می‌نویسد (TDEE_META_DESCRIPTION)
  // — توضیحات خام و رندرشده حالا یکسان‌اند
  description: TDEE_META_DESCRIPTION,
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/tdee` },
  openGraph: {
    title: "محاسبه کالری روزانه و TDEE | فیتاپ",
    description: TDEE_META_DESCRIPTION,
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/tdee`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/og/og-default.png`, width: 1200, height: 630, alt: "محاسبه‌گر کالری فیتاپ" }],
  },
};

async function getExerciseCount(): Promise<number> {
  try {
    return await db.exerciseLibrary.count();
  } catch {
    return 0;
  }
}

export default async function TdeePage() {
  // یک دادهٔ زنده برای پاراگراف معرفی (تقویت محتوایی هاب‌های داخلی)
  const exCount = await getExerciseCount();

  // v252-memorize — سه اسکیمای JSON-LD سمت سرور (قبلاً با JS کلاینتی تزریق
  // می‌شد — خزنده‌ها در HTML اولیه نمی‌دیدند). هم‌الگوی /bmi و /1rm و /macro.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";
  const pageUrl = `${siteUrl}/tdee`;
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "فیتاپ", item: siteUrl },
      { "@type": "ListItem", position: 2, name: "محاسبه‌گر کالری روزانه", item: pageUrl },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: TDEE_FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  const webAppLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "فیتاپ محاسبه‌گر کالری روزانه",
    alternateName: "FitUp TDEE & Calorie Calculator",
    url: pageUrl,
    applicationCategory: "HealthApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    inLanguage: "fa",
    description: "محاسبه‌گر آنلاین و رایگان کالری روزانه (TDEE و BMR) با داشبورد درشت‌مغذی‌ها، BMI، وزن ایده‌آل، درصد چربی بدن، آب مورد نیاز و کالری‌سنج فعالیت‌های ورزشی.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "IRR" },
    creator: fitupOrgRef(),
    featureList: [
      "محاسبه کالری روزانه (TDEE) با فرمول هریس-بندیکت",
      "محاسبه متابولیسم پایه (BMR)",
      "داشبورد سه هدف: چربی‌سوزی، تثبیت وزن، عضله‌سازی",
      "نمودار درشت‌مغذی‌ها با اسلایدر تنظیم",
      "شاخص توده بدنی (BMI) با گیج رنگی",
      "محاسبه وزن ایده‌آل (Devine و Hamwi)",
      "تخمین درصد چربی بدن (US Navy)",
      "محاسبه آب مورد نیاز بدن",
      "کالری‌سنج فعالیت‌های ورزشی (MET)",
      "پیش‌بینی روند وزن بر اساس کسری/مازاد کالری",
    ],
  };

  return (
    <div className="min-h-screen flex flex-col bg-white" dir="rtl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppLd) }}
      />
      {/* v123 — هایلایت ابزار فعلی روی نوار واحد ابزارهای رایگان */}
      <ToolsNav active="tool-tdee" />
      {/* v149 — فیکس موبایل: تیتر زیر تب‌های ToolsNav افتاده بود؛ هم‌تراز با
          /exercises و /foods (pt-[7.5rem] برای ردیف دومِ تب‌های موبایل ~۱۰۸px) */}
      <main className="pt-[7.5rem] sm:pt-24 pb-16">
        {/* معرفی SSR — محتوای متنی واقعی برای سئو (۲-۳ جمله دربارهٔ TDEE/BMR) */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mb-6">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3">
            محاسبه‌گر کالری روزانه (TDEE) فیتاپ
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-2">
            TDEE یا «کل انرژی روزانهٔ بدن» مجموع کالری‌ای است که بدن شما در یک شبانه‌روز می‌سوزاند؛
            یعنی متابولیسم پایه (BMR — انرژی لازم برای تنفس، گردش خون و بازسازی سلولی) به‌اضافهٔ
            کالری فعالیت‌ها و ورزش. این عدد مبنای هر برنامهٔ لاغری، چربی‌سوزی یا عضله‌سازی است:
            کمتر از TDEE بخورید تا وزن کم کنید و بیشتر از آن تا عضله بسازید.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            ماشین‌حساب زیر با فرمول علمی هریس-بندیکت و ضریب فعالیت واقعی شما، کالری روزانه،
            BMI و درشت‌مغذی‌های پیشنهادی (پروتئین، کربوهیدرات و چربی) را دقیق محاسبه می‌کند —
            کاملاً رایگان. بعد از نتیجه، می‌توانید از{" "}
            <a href="/exercises" className="text-orange-600 font-bold hover:text-orange-700 transition">
              بانک {exCount > 0 ? toPersianDigits(exCount.toLocaleString("en-US")) : ""} حرکت فیتاپ
            </a>{" "}
            برای شروع تمرین استفاده کنید.
          </p>
        </section>

        <TdeeCalculator />
      </main>

      {/* v243 — فوتر چسبان مثل بقیهٔ صفحات (ممیزی v243: این صفحه فوتر نداشت) */}
      <SiteFooter />

      {/* v211 — سیاست نیکا: همه‌جای سایت به‌جز ورود/آنبوردینگ/پنل */}
      <NikaWidget context="public" />
    </div>
  );
}
