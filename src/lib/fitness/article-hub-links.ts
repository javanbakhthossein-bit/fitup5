/**
 * ─── v262 — هاب‌لینک‌های هوشمند مقالات (ممیزی سئو — دیرکتیو مالک) ───
 *
 * ممیزی سئو (دادهٔ واقعی سرچ‌کنسول + خزش صفحات) دو شکاف مشخص را نشان داد:
 *   ۱) صفحات لندینگ رشته‌ها — به‌ویژه /sport/bodybuilding («بادی بیلدینگ چیست»
 *      با ۲۹۴ نمایش و جایگاه ۶.۲) — صفر لینک داخلی از مقالات می‌گرفتند.
 *   ۲) خوشهٔ خرید («خرید برنامه بدنسازی» جایگاه ۱۳.۴ و نزولی؛ مقالات
 *      تعرفه/مربی) — قطب تبدیل سایت بدون سیگنال لینک داخلی کافی.
 *
 * این ماژول روی «هر» صفحهٔ مقاله، بر اساس هم‌پوشانی کلمات کلیدی مقاله با
 * هاب‌های حیاتی سایت، ۲ تا ۴ لینک داخلی مرتبط انتخاب می‌کند تا در SSR رندر
 * شوند — کاملاً server-side، بدون هیچ JS، کرال‌پذیر و بی‌اثر روی کاربر
 * (فقط یک سکشن لینک مفید زیر مقاله).
 *
 * قواعد سخت:
 *  • لینک به مقالهٔ خودِ مقاله هرگز انتخاب نمی‌شود (excludeSelf)
 *  • هاب‌های مقاله‌محور فقط وقتی رندر می‌شوند که آن مقاله واقعاً
 *    status=published باشد (اعتبارسنجی با DB در صفحهٔ مقاله — هیچ 404 داخلی)
 *  • حداکثر ۴ لینک — ضد اسپم لینک؛ کیفیت > کمیت
 */

import { DISCIPLINE_PAGE_SLUGS } from "@/lib/fitness/disciplines-data";

export interface HubLink {
  href: string;
  title: string;
  desc: string;
  emoji: string;
}

interface HubDef {
  href: string;
  title: string;
  desc: string;
  emoji: string;
  /** کلمات فعال‌ساز — روی «عنوان + تگ + دسته + خلاصه» مقاله تست می‌شود */
  match: RegExp;
  /** مقاله‌ای که خودش این هاب است — لینک به خود نداریم */
  selfSlugs?: string[];
}

/* ── هاب‌های مقاله‌ای (اعتبارسنجی published با DB قبل از رندر) ── */
const ARTICLE_HUB_DEFS: HubDef[] = [
  {
    href: "/article/buy-workout-program-guide",
    title: "راهنمای خرید برنامه بدنسازی",
    desc: "قبل از خرید برنامهٔ تمرینی چه چیزهایی را دقیق چک کنی؟ راهنمای انتخاب بدون ریسک",
    emoji: "🛒",
    // نیت خرید/قیمت/مربی — دقیقاً خوشه‌ای که GSC فرصتش را نشان داد
    match: /خرید|قیمت|تعرفه|هزینه|پلن|پلان|اشتراک|مربی|آنلاین|ثبت.?نام|انتخاب برنامه|بهترین برنامه/,
    selfSlugs: ["buy-workout-program-guide"],
  },
  {
    href: "/article/buy-online-bodybuilding-workout-plan",
    title: "خرید برنامه بدنسازی آنلاین",
    desc: "برنامهٔ آنلاین یا مربی حضوری؟ مقایسهٔ کامل + نکات انتخاب",
    emoji: "💻",
    match: /خرید|قیمت|تعرفه|آنلاین|برنامه بدنسازی|برنامه تمرینی/,
    selfSlugs: ["buy-online-bodybuilding-workout-plan"],
  },
  {
    href: "/article/fitness-program-pricing-guide",
    title: "تعرفه برنامه بدنسازی",
    desc: "قیمت برنامهٔ تمرینی چقدر است و چه چیزی آن را تعیین می‌کند؟",
    emoji: "💰",
    match: /قیمت|تعرفه|هزینه|خرید/,
    selfSlugs: ["fitness-program-pricing-guide"],
  },
  {
    href: "/article/bodybuilding-complete-guide",
    title: "بادی بیلدینگ چیست؟",
    desc: "راهنمای کامل عضله‌سازی — از مبانی تا برنامهٔ واقعی",
    emoji: "🏋️",
    match: /بدنسازی|بادی.?بیلدینگ|bodybuilding|عضله/,
    selfSlugs: ["bodybuilding-complete-guide"],
  },
];

/* ── هاب‌های مسیر ثابت (routeهای SSR — همیشه موجود، بدون نیاز به DB) ── */
const ROUTE_HUB_DEFS: HubDef[] = [
  {
    href: "/sport/bodybuilding",
    title: "راهنمای کامل بدنسازی",
    desc: "لندینگ اختصاصی بدنسازی فیتاپ — آموزش، فواید، حرکات و برنامهٔ تخصصی",
    emoji: "🏋️‍♂️",
    // دیرکتیو ممیزی: /sport/bodybuilding باید از مقالات بدنسازی/عضله‌سازی لینک بگیرد
    match: /بدنسازی|بادی.?بیلدینگ|bodybuilding|عضله.?سازی|حجم|پرس سینه|اسکوات|ددلیفت|جلو.?بازو|پشت.?بازو|سینه|قدرت/,
  },
  {
    href: "/sport/pilates",
    title: "راهنمای کامل پیلاتس",
    desc: "پیلاتس چیست؟ وال‌پیلاتس، حرکات پایه و برنامهٔ اختصاصی",
    emoji: "🧘‍♀️",
    match: /پیلاتس|pilates|کمر|قوز|انعطاف|فرم.?دهی/,
  },
  {
    href: "/sport/trx",
    title: "راهنمای کامل TRX",
    desc: "تمرین معلق با دو نوار — قدرت تمام‌بدن در هر جای خانه",
    emoji: "🪢",
    match: /trx|معلق|آویزان|کش.?مقاومتی|وزن.?بدن/,
  },
  {
    href: "/sport/wellness",
    title: "راهنمای کامل ولنس",
    desc: "تناسب اندام و سلامت پایدار — مسیر ولنس در فیتاپ",
    emoji: "🌿",
    match: /ولنس|wellness|سلامت|تناسب.?اندام|بیکینی|فیتنس|بانوان/,
  },
  {
    href: "/sport/bikini_fitness",
    title: "راهنمای کامل بیکینی فیتنس",
    desc: "فرم‌دهی زنانه، تمرین باسن و پا — مسیر بیکینی فیتنس",
    emoji: "🌸",
    // کوئری واقعی GSC: «تفاوت ولنس و بیکینی» — خوشهٔ زنانه را کامل لینک بده
    match: /بیکینی|bikini|با.?سن|فرم.?دهی|ولنس|بانوان|فیتنس/,
  },
  {
    href: "/sport/powerlifting",
    title: "راهنمای کامل پاورلیفتینگ",
    desc: "سه حرکت اصلی قدرت — اسکوات، پرس و ددلیفت در سطح قهرمانی",
    emoji: "🦾",
    match: /پاورلیفتینگ|powerlifting|قدرت|record|اسکوات|ددلیفت|پرس سینه/,
  },
  {
    href: "/sport/calisthenics",
    title: "راهنمای کامل کالستنیکس",
    desc: "قدرت با وزن بدن — از بارفیکس تا حرکات آزاد",
    emoji: "🤸",
    match: /کالستنیکس|calisthenics|بارفیکس|شنا|وزن.?بدن|خانه/,
  },
  {
    href: "/sport/hiit",
    title: "راهنمای کامل HIIT",
    desc: "تمرین تناوبی شدید — چربی‌سوزی در کمترین زمان",
    emoji: "⚡",
    match: /hiit|تناوبی|اینتروال|چربی.?سوز|کاردیو|لاغری/,
  },
  {
    href: "/tdee",
    title: "محاسبه‌گر کالری و TDEE",
    desc: "کالری نگهدارنده و هدف روزانهٔ تو را دقیق حساب کن",
    emoji: "🔥",
    match: /کالری|tdee|متابولیسم|چربی.?سوزی|لاغری|کاهش.?وزن|رژیم|وزن|کم.?کردن|تن.?رنج/,
  },
  {
    href: "/macro",
    title: "محاسبه‌گر ماکرو",
    desc: "پروتئین، کربوهیدرات و چربی روزانه — دقیق و هدف‌محور",
    emoji: "⚖️",
    match: /ماکرو|پروتئین|کربوهیدرات|چربی|درشت.?مغذی|diet|تغذیه/,
  },
  {
    href: "/exercises",
    title: "بانک حرکات بدنسازی",
    desc: "ده‌ها حرکت با ویدیو، فرم صحیح و نکات ایمنی",
    emoji: "💪",
    match: /حرکت|تمرین|اسکوات|پرس|ددلیفت|بارفیکس|سوپرست|عضله|باشگاه|وزنه/,
  },
  {
    href: "/foods",
    title: "جدول کالری غذاها",
    desc: "کالری و ماکرو بیش از ۲۰۰ غذای ایرانی و پرطرفدار",
    emoji: "🥗",
    match: /کالری|غذا|جدول|خوراک|ماده.?غذایی|مواد.?غذایی|nutrition|وعده/,
  },
  {
    href: "/free-programs",
    title: "برنامه‌های رایگان تمرینی",
    desc: "برنامه‌های آمادهٔ رایگان — از مبتدی تا پیشرفته",
    emoji: "🎁",
    match: /برنامه|روتین|تمرینی|رایگان|شروع|مبتدی/,
  },
  {
    href: "/articles",
    title: "مجلهٔ فیتاپ",
    desc: "همهٔ مقالات آموزشی تمرین، تغذیه و مکمل",
    emoji: "📚",
    match: /.*/, // همیشه کاندید — ولی فقط اگر هیچ هاب دیگری پر نکرده باشد
  },
];

/** نرمال‌سازی سبک متن برای تطبیق regex فارسی (نیم‌فاصله→فاصله، ی/ک) */
function faSoft(s: string): string {
  return (s || "")
    .replace(/[\u200c\u200f]/g, " ")
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .toLowerCase();
}

export interface HubLinkInput {
  slug: string;
  title: string;
  category: string;
  tags: string;
  excerpt: string;
}

/** slugهای مقاله‌محور که در DB باید published باشند (برای اعتبارسنجی صفحه) */
export const HUB_ARTICLE_SLUGS = ARTICLE_HUB_DEFS.map((h) =>
  h.href.replace("/article/", "")
);

/**
 * انتخاب ۲ تا ۴ هاب‌لینک مرتبط برای یک مقاله.
 *  • prioritized: هاب‌های مقاله‌ای (خرید/بدنسازی) اگر متن مقاله فعالشان کند
 *  • سپس هاب‌های مسیر (بدنسازی/تغذیه/حرکات/…) با ترتیب ثابت
 *  • /articles فقط به‌عنوان پرکنندهٔ آخر (اگر کمتر از ۲ لینک شد)
 *  • عدم تکرار href؛ لینک به خود مقاله ممنوع
 */
export function pickHubLinksForArticle(
  article: HubLinkInput,
  /** slugهای مقاله‌ای که واقعاً published هستند (خروجی DB از صفحهٔ مقاله) */
  liveArticleSlugs: string[]
): HubLink[] {
  const haystack = faSoft(
    `${article.title} ${article.tags} ${article.category} ${article.excerpt}`
  );
  const seen = new Set<string>([`/article/${article.slug}`]);
  const out: HubLink[] = [];

  const push = (def: HubDef) => {
    if (out.length >= 4) return;
    if (seen.has(def.href)) return;
    if (def.selfSlugs?.includes(article.slug)) return;
    seen.add(def.href);
    out.push({ href: def.href, title: def.title, desc: def.desc, emoji: def.emoji });
  };

  // ۱) هاب‌های مقاله‌ای — فقط اگر published (اعتبارسنجی DB از صفحهٔ مقاله)
  for (const def of ARTICLE_HUB_DEFS) {
    const slug = def.href.replace("/article/", "");
    if (!liveArticleSlugs.includes(slug)) continue;
    if (def.match.test(haystack)) push(def);
  }

  // ۲) هاب‌های مسیر — فقط وقتی متن مقاله فعالشان کند
  for (const def of ROUTE_HUB_DEFS) {
    if (def.href === "/articles") continue; // پرکنندهٔ آخر — جدا
    if (def.match.test(haystack)) push(def);
    if (out.length >= 4) break;
  }

  // ۳) پرکنندهٔ حداقلی: کمتر از ۲ لینک → مجلهٔ فیتاپ (همیشه موجود)
  if (out.length < 2) push(ROUTE_HUB_DEFS.find((d) => d.href === "/articles")!);

  return out;
}
