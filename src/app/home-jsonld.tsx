/**
 * ─── v178 — JSON-LD اختصاصی صفحهٔ اصلی (فقط /) ───
 *
 * ممیزی سئو v178: FAQPage / SoftwareApplication / Product+Review / BreadcrumbList
 * قبلاً در root layout سراسری بودند و در HTML «همهٔ» صفحات (مقالات، حرکات،
 * تماس و…) تزریق می‌شدند — یعنی structured data به صفحاتی می‌رسید که محتوای
 * آن‌ها در آنجا نمایش داده نمی‌شود (نقض دستورالعمل Google Rich Results؛
 * + BreadcrumbList تکراری در صفحات مقاله). حالا فقط در صفحهٔ اصلی رندر
 * می‌شوند — همان‌جایی که FAQ/قیمت‌ها/نظرات واقعاً دیده می‌شوند.
 *
 * Organization + WebSite سراسری می‌مانند (مفهوم سایت‌دهی هستند).
 */

import { LANDING_FAQS } from "@/lib/fitness/landing-faqs";
import { SUBSCRIPTION_PLANS } from "@/lib/fitness/types";
// v249-seo — ارجاع کانونی Organization (رفع هشدار «publisher کم دارد: url»)
import { fitupOrgRef } from "@/lib/fitness/schema-org";
// Task 8-a — تعداد زندهٔ بانک غذا در JSON-LD (دیرکتیو مالک: شمارندهٔ غذا پویا باشد)
import { getFoodCountFa } from "@/lib/fitness/food-count";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

// v218 — قیمت‌ها از همان منبع حقیقت بخش قیمت لندینگ خوانده می‌شوند
// (pricing-section.tsx → usePlans() که با SUBSCRIPTION_PLANS مقداردهی اولیه می‌شود؛
// types.ts ماژول خنثای server/client است و در کامپوننت سرور import می‌شود) —
// دیگر امکان دیرفت JSON-LD با قیمت‌های کارت‌ها وجود ندارد. دقت: overrides
// دیتابیسی پنل ادمین (پاسخ /api/payment/checkout) فقط سمت کلاینت اعمال می‌شوند؛
// JSON-LD سمت سرور همان مقادیر استاتیک مرجع را اعلام می‌کند.

// سوالات متداول (FAQPage) — محتوای همان بخش FAQ لندینگ
// v251-faq-sync — mainEntity از «همان» منبع بخش FAQ قابل‌مشاهدهٔ لندینگ ساخته
// می‌شود (src/lib/fitness/landing-faqs.ts) — قبلاً ۸ سوالِ دستیِ متفاوت با
// ۱۲ سوالِ صفحه بود و ریسک Manual Action گوگل داشت. حالا هم‌متنِ تضمینی است.
const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: LANDING_FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

// محصول و پلن‌ها — SoftwareApplication با offers (قیمت‌ها)
// v218 — aggregateRating جعلی (4.9 / 10000) حذف شد — ریسبک manual action
// گوگل (Structured data: reviews without evidence). هیچ reviewCount واقعی
// متصوری وجود ندارد؛ تا وقتی ریسایو واقعی جمع نشده، این فیلد برنمی‌گردد.
const planOffers = SUBSCRIPTION_PLANS.map((p) => ({
  "@type": "Offer",
  name: `پلن ${p.label}`,
  price: String(p.price),
  priceCurrency: "IRR",
  description: p.tagline,
  url: `${SITE_URL}/#pricing`,
  availability: "https://schema.org/InStock",
}));

export async function HomeJsonLd() {
  // Task 8-a — تعداد غذاها در featureList پویاست (قبلاً «۱۰۰۰+ غذای سالم» هاردکد بود)
  const foodsFa = await getFoodCountFa();

  const softwareAppLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "فیتاپ",
  alternateName: "FitUp",
  applicationCategory: "HealthAndFitnessApplication",
  operatingSystem: "Web, Android, iOS",
  description:
    "اپلیکیشن جامع تناسب اندام با هوش مصنوعی: برنامه تمرینی و غذایی شخصی‌سازی‌شده، چت هوشمند ورزشی، آنالیز ویدیویی و آزمایش خون. هر بدنی فیتاپ میخواد.",
  url: SITE_URL,
  downloadUrl: SITE_URL,
  screenshot: `${SITE_URL}/hero-fitup.webp`,
  softwareVersion: "3.0",
  datePublished: "2024-01-01",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "IRR",
    // v218 — lowPrice/highPrice/offerCount از همان SUBSCRIPTION_PLANS حساب می‌شوند
    lowPrice: String(Math.min(...SUBSCRIPTION_PLANS.map((p) => p.price))),
    highPrice: String(Math.max(...SUBSCRIPTION_PLANS.map((p) => p.price))),
    offerCount: SUBSCRIPTION_PLANS.length,
    offers: planOffers,
  },
  featureList: [
    "برنامه تمرینی هوشمند شخصی‌سازی‌شده با هوش مصنوعی",
    "برنامه غذایی و مکمل اختصاصی",
    "چت ۲۴ ساعته با مربی هوشمند (متن، عکس، ویدیو)",
    "آنالیز هوشمند وعده‌های غذایی با عکس",
    "آنالیز ویدیوی فرم بدن و آنالیز فرم حرکات",
    "تحلیل آزمایش خون (۴۷ ماده)",
    "پیگیری پیشرفت وزن و اندام‌ها با نمودار",
    "حالت باشگاه (Gym Mode) با تایمر استراحت",
    "دستیار تغذیه (Nutrition Companion)",
    "۲۶۰+ حرکت ورزشی با آموزش گام‌به‌گام",
    `${foodsFa}+ غذای سالم در بانک مواد غذایی`,
  ],
  brand: { "@type": "Brand", name: "فیتاپ" },
  // v249-seo — publisher با @id به Organization کانونی (url + logo کامل)
  publisher: fitupOrgRef(),
  inLanguage: "fa-IR",
  };

  return (
    <>
      {/* FAQPage — فقط لندینگ (بخش FAQ در همین صفحه دیده می‌شود) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      {/* SoftwareApplication با offers (بدون aggregateRating — v218) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppLd) }} />
    </>
  );
}
