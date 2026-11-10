/**
 * ─── v249-seo — موجودیت‌های کانونی schema.org فیتاپ (سراسری) ───
 *
 * ممیزی سئو مالک (ابزارهای Rich-Result): «Organization/WebSite ۲ بار آمده؛
 * یکی را نگه دارید» + «publisher/creator/author کم دارد: url/logo».
 *
 * درمان ریشه‌ای: هر صفحه فقط «یک» Organization و «یک» WebSite کامل دارد
 * (در root layout) و همهٔ نقش‌های دیگر (publisher/creator/author/isPartOf)
 * با @id کانونی به همان گره ارجاع می‌دهند — الگوی رسمی گوگل برای پرهیز از
 * موجودیت تکراری؛ ابزارهای ممیزی هم با فیلدهای کامل (name/url/logo) رفرنس
 * هیدراته‌شده هیچ هشدار «کم دارد» نمی‌دهند.
 *
 * ماژول خنثای server/client — فقط تابع خالص و ثابت رشته‌ای (بدون وابستگی).
 */

export const FITUP_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

/** @id کانونی Organization فیتاپ — مرجع همهٔ publisher/creator/author */
export const FITUP_ORG_ID = `${FITUP_SITE_URL}/#organization`;

/** @id کانونی WebSite فیتاپ — مرجع همهٔ isPartOf/publisher صفحه‌ها */
export const FITUP_WEBSITE_ID = `${FITUP_SITE_URL}/#website`;

/** لوگوی رسمی فیتاپ — فقط همین فایل مرجع است (هرجا لوگو لازم بود) */
export const FITUP_LOGO_URL = `${FITUP_SITE_URL}/fitup-logo.png`;

/**
 * ارجاع هیدراته به Organization کانونی فیتاپ — با @id + فیلدهای کامل
 * (گوگل با @id ادغام می‌کند؛ ابزار ممیزی فیلدها را می‌بیند)
 */
export function fitupOrgRef(): {
  "@type": "Organization";
  "@id": string;
  name: string;
  url: string;
  logo: string;
} {
  return {
    "@type": "Organization",
    "@id": FITUP_ORG_ID,
    name: "فیتاپ",
    url: FITUP_SITE_URL,
    logo: FITUP_LOGO_URL,
  };
}

/** ارجاع کانونی به WebSite فیتاپ (برای isPartOf صفحات مجموعه) */
export function fitupWebsiteRef(): { "@type": "WebSite"; "@id": string; name: string; url: string } {
  return {
    "@type": "WebSite",
    "@id": FITUP_WEBSITE_ID,
    name: "فیتاپ",
    url: FITUP_SITE_URL,
  };
}

/**
 * v249-seo — توضیحات متای مشترک صفحهٔ /tdee — منبع حقیقت واحد برای «هم»
 * متادیتای SSR (src/app/tdee/page.tsx) «هم» افکت کلاینتی (tdee-calculator.tsx).
 * ابزار ممیزی مالک: «توضیحات متا ⚠ متفاوت (خام/رندرشده)» — ریشه: دو رشتهٔ
 * مستقل که با هیدریشن یکی جای دیگری را می‌گرفت. حالا یک رشتهٔ مشترک.
 */
export const TDEE_META_DESCRIPTION =
  "محاسبه کالری روزانه با محاسبه‌گر حرفه‌ای و رایگان فیتاپ: TDEE، BMR، شاخص BMI، درشت‌مغذی‌ها (پروتئین، کربوهیدرات، چربی)، وزن ایده‌آل، درصد چربی بدن، آب مورد نیاز بدن و کالری سوخت‌شدهٔ فعالیت‌ها. ابزار فارسی مبتنی بر فرمول علمی هریس-بندیکت برای رژیم لاغری، چربی‌سوزی و عضله‌سازی.";

/**
 * تبدیل مسیر نسبی تصویر به URL مطلق — برای JSON-LD (image/og:image)
 * هشدار ابزار ممیزی: «نشانی کامل نیست؛ با https:// بنویسید» (تصاویر
 * /uploads/… از دیتابیس نسبی می‌آیند).
 */
export function absoluteImageUrl(src?: string | null): string {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return `${FITUP_SITE_URL}${src}`;
  return `${FITUP_SITE_URL}/${src}`;
}
