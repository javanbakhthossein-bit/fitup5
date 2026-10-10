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

import { SUBSCRIPTION_PLANS } from "@/lib/fitness/types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

// v218 — قیمت‌ها از همان منبع حقیقت بخش قیمت لندینگ خوانده می‌شوند
// (pricing-section.tsx → usePlans() که با SUBSCRIPTION_PLANS مقداردهی اولیه می‌شود؛
// types.ts ماژول خنثای server/client است و در کامپوننت سرور import می‌شود) —
// دیگر امکان دیرفت JSON-LD با قیمت‌های کارت‌ها وجود ندارد. دقت: overrides
// دیتابیسی پنل ادمین (پاسخ /api/payment/checkout) فقط سمت کلاینت اعمال می‌شوند؛
// JSON-LD سمت سرور همان مقادیر استاتیک مرجع را اعلام می‌کند.

// سوالات متداول (FAQPage) — محتوای همان بخش FAQ لندینگ
const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "آیا برنامه‌های فیتاپ علمی و معتبر هستند؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله! فیتاپ توسط بزرگترین مربیان بدنسازی دنیا طراحی شده است. هوش مصنوعی اختصاصی فیتاپ طبق الگوی آن‌ها آموزش دیده تا برنامه‌ای کاملاً علمی، ایمن و شخصی‌سازی‌شده برای شما بسازد — دقیقاً همان کیفیت یک مربی حرفه‌ای، اما سریع‌تر و ۲۴ ساعته در دسترس.",
      },
    },
    {
      "@type": "Question",
      name: "چگونه ثبت‌نام می‌کنم؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "ثبت‌نام با شماره موبایل و تأیید پیامک یک‌بارمصرف (OTP) انجام می‌شود. کد ۴ رقمی به شماره شما پیامک می‌شود و پس از تأیید، حساب شما ایجاد یا وارد می‌شود. ورود OTP یعنی پذیرش قوانین.",
      },
    },
    {
      "@type": "Question",
      name: "آیا برنامه تمرینی برای شرایط من مناسب است؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "برنامه کاملاً بر اساس اطلاعات آنبوردینگ شما (جنسیت، سن، قد، وزن، هدف، آسیب‌دیدگی‌ها، تجهیزات و رژیم غذایی) شخصی‌سازی می‌شود. اگر آسیب‌دیدگی دارید، هوش مصنوعی حرکات ایمن و جایگزین پیشنهاد می‌دهد.",
      },
    },
    {
      "@type": "Question",
      name: "پرداخت اشتراک چگونه انجام می‌شود؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "پرداخت از طریق درگاه امن زرین‌پال انجام می‌شود. پس از انتخاب اشتراک، به درگاه هدایت می‌شوید و پس از پرداخت موفق، اشتراک بلافاصله فعال می‌شود. رسید پرداخت در اپلیکیشن ذخیره می‌شود.",
      },
    },
    {
      "@type": "Question",
      name: "آیا می‌توانم برنامه‌ام را تغییر دهم؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله! هر زمان که بخواهید می‌توانید با چت با مربی هوشمند، جایگزین یک حرکت را بخواهید یا یک غذا را تعویض کنید. در چکاپ‌های دوره‌ای (پلن استاندارد به بالا) هم فیتاپ هوشمند برنامه‌های شما را بر اساس پیشرفت واقعی‌تان به‌روزرسانی می‌کند — برنامهٔ به‌روز در جای برنامهٔ قبلی می‌نشیند و تغییری در پلن و زمان اشتراک شما ایجاد نمی‌شود.",
      },
    },
    {
      "@type": "Question",
      name: "آیا اطلاعات و تصاویر من محرمانه می‌مانند؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله، حریم خصوصی شما برای ما مهم‌ترین اولویت است. تصاویر پیشرفت (Before/After) کاملاً خصوصی هستند و فقط برای خود شما نمایش داده می‌شوند. اطلاعات شما با هیچ شخص ثالثی به اشتراک گذاشته نمی‌شود.",
      },
    },
    {
      "@type": "Question",
      name: "آیا اپلیکیشن روی گوشی من کار می‌کند؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "بله! اپلیکیشن فیتاپ یک وب‌اپلیکیشن واکنش‌گرا (Responsive) است که روی همه گوشی‌های اندروید و iOS از طریق مرورگر کار می‌کند. نیازی به نصب نیست — فقط باز کنید و شروع کنید.",
      },
    },
    {
      "@type": "Question",
      name: "اگر اشتراکم منقضی شود چه می‌شود؟",
      acceptedAnswer: {
        "@type": "Answer",
        text: "پس از انقضای اشتراک، دسترسی به برنامه‌های جدید و چت محدود می‌شود، اما اطلاعات قبلی شما (وزن، پیشرفت، تصاویر) حفظ می‌شود. هر زمان که اشتراک را تمدید کنید، دوباره به همه امکانات دسترسی دارید.",
      },
    },
  ],
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
    "۱۰۰۰+ غذای سالم در بانک مواد غذایی",
  ],
  brand: { "@type": "Brand", name: "فیتاپ" },
  publisher: { "@type": "Organization", name: "فیتاپ", url: SITE_URL },
  inLanguage: "fa-IR",
};

export function HomeJsonLd() {
  return (
    <>
      {/* FAQPage — فقط لندینگ (بخش FAQ در همین صفحه دیده می‌شود) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      {/* SoftwareApplication با offers (بدون aggregateRating — v218) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppLd) }} />
    </>
  );
}
