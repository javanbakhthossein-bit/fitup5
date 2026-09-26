/**
 * ─── کتابخانهٔ مشترک مقالات (v105 — بازیابی سئوی مقالات) ───
 *
 * چرا این فایل وجود دارد:
 *  تا v104 محتوای مقالات فقط در کامپوننت کلاینت (ArticlePage) رندر می‌شد و
 *  گوگل آن را در HTML اولیه نمی‌دید. با اضافه‌شدن route واقعی
 *  /article/[slug] (SSR) و /articles، به سازه‌های مشترک بین کلاینت و سرور
 *  نیاز پیدا کردیم: برچسب/رنگ دسته‌ها، استخراج FAQ از Markdown و
 *  کامپوننت‌های رندر Markdown.
 *
 * این ماژول هیچ "use client" ندارد تا هم در سرور (RSC) و هم در کلاینت
 * قابل استفاده باشد — همهٔ خروجی‌ها pure هستند.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  // فارسی
  "تمرین": "تمرین", "تغذیه": "تغذیه", "مکمل": "مکمل", "بازیابی": "بازیابی",
  "انگیزشی": "انگیزشی", "عمومی": "عمومی", "حرکات": "حرکات", "اخبار": "اخبار",
  "روش‌های-تمرینی": "روش‌های تمرینی", "اندازه‌گیری": "اندازه‌گیری", "ورزشکاران": "ورزشکاران", "آموزش-استروئیدها": "آموزش استروئیدها",
  // انگلیسی (backward compat)
  general: "عمومی", nutrition: "تغذیه", training: "تمرین", motivation: "انگیزشی", news: "اخبار",
  supplement: "مکمل", recovery: "بازیابی", exercises: "حرکات", "training-methods": "روش‌های تمرینی",
  metrics: "اندازه‌گیری", athletes: "ورزشکاران", "steroids-education": "آموزش استروئیدها",
};

export const CATEGORY_COLORS: Record<string, string> = {
  // فارسی
  "عمومی": "bg-slate-100 text-slate-600",
  "تغذیه": "bg-emerald-100 text-emerald-700",
  "تمرین": "bg-orange-100 text-orange-700",
  "انگیزشی": "bg-purple-100 text-purple-700",
  "مکمل": "bg-amber-100 text-amber-700",
  "بازیابی": "bg-teal-100 text-teal-700",
  "حرکات": "bg-rose-100 text-rose-700",
  "اخبار": "bg-blue-100 text-blue-700",
  "روش‌های-تمرینی": "bg-indigo-100 text-indigo-700",
  "اندازه‌گیری": "bg-cyan-100 text-cyan-700",
  "ورزشکاران": "bg-pink-100 text-pink-700",
  "آموزش-استروئیدها": "bg-red-100 text-red-700",
  // انگلیسی (backward compat)
  general: "bg-slate-100 text-slate-600",
  nutrition: "bg-emerald-100 text-emerald-700",
  training: "bg-orange-100 text-orange-700",
  motivation: "bg-purple-100 text-purple-700",
  news: "bg-blue-100 text-blue-700",
  supplement: "bg-amber-100 text-amber-700",
  recovery: "bg-teal-100 text-teal-700",
  exercises: "bg-rose-100 text-rose-700",
};

/** دسته‌های مجاز مقالات — ترتیب نمایش در صفحهٔ /articles (فقط فارسی) */
export const ARTICLE_CATEGORY_ORDER = [
  "تمرین", "تغذیه", "مکمل", "بازیابی", "روش‌های-تمرینی", "حرکات",
  "انگیزشی", "اندازه‌گیری", "ورزشکاران", "اخبار", "آموزش-استروئیدها", "عمومی",
];

/** حداقل طول متن برای اینکه CTA وسطی معنا داشته باشد (کاراکتر) */
export const MID_CTA_MIN_CONTENT = 1200;

/**
 * ─── v106 — نرمال‌سازی لینک‌های داخلی مارک‌داون به URLهای واقعی ───
 *
 * محتوای قدیمی/تولیدی ممکن است هنوز لینک‌های کوئری‌استایل (?article=slug،
 * ?tool=tdee و…) داشته باشد؛ قبل از رندر (کلاینت و SSR) به مسیرهای واقعی
 * تبدیل می‌شوند تا هیچ href کوئری‌استایلی در HTML خروجی نرود.
 * جهت تبدیل در v105 برعکس بود (real → query) — اشتباه بود، الان درست است.
 */
export function normalizeArticleLinks(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .replace(/\/?\?article=([a-zA-Z0-9_-]+)/g, "/article/$1")
    .replace(/\/?\?exercise=([a-zA-Z0-9_-]+)/g, "/exercise/$1")
    .replace(/\/?\?food=([a-zA-Z0-9_-]+)/g, "/food/$1")
    .replace(/\/?\?tool=tdee\b/g, "/tdee")
    .replace(/\/?\?tool=exercises\b/g, "/exercises")
    .replace(/\/?\?tool=foods\b/g, "/foods")
    .replace(/\/?\?screen=articles\b/g, "/articles");
}

/**
 * استخراج سؤالات و پاسخ‌های متداول از محتوای Markdown مقاله.
 *
 * این تابع به‌دنبال بخش «سوالات متداول» یا «پرسش‌های متداول» یا «FAQ»
 * (با هر سطح heading از # تا ##) می‌گردد. سپس تمام سؤالات H3 (### ...)
 * که بعد از آن بخش می‌آیند را به‌همراه پاسخشان (متن بین این H3 و H3 بعدی)
 * استخراج می‌کند. کاربرد: تولید JSON-LD FAQPage برای مقالات.
 *
 * اگر هیچ بخش FAQ پیدا نشد، آرایه خالی برمی‌گرداند.
 */
export function extractFaqFromMarkdown(markdown: string): { question: string; answer: string }[] {
  if (!markdown) return [];

  // 1) پیدا کردن شروع بخش FAQ
  // الگوهای قابل قبول: «## سوالات متداول» یا «## پرسش‌های متداول» یا «## FAQ»
  // (با هر تعداد #)
  const faqHeaderRegex = /^(#{1,6})\s+(سوالات\s+متداول|پرسش(?:‌|\s)?های?\s+متداول|FAQ|سؤالات\s+متداول)\s*$/imu;
  const headerMatch = faqHeaderRegex.exec(markdown);
  if (!headerMatch) return [];

  // از پایان خط هدر به بعد را به‌عنوان بدنه FAQ در نظر می‌گیریم
  const faqBodyStart = headerMatch.index + headerMatch[0].length;
  let faqBody = markdown.slice(faqBodyStart);

  // 2) اگر بعد از بخش FAQ یک H2 دیگری شروع شد، آن را قطع کن
  const nextH2Match = /^#{1,2}\s+\S/m.exec(faqBody);
  if (nextH2Match) {
    faqBody = faqBody.slice(0, nextH2Match.index);
  }

  // 3) پیدا کردن همه سؤالات H3 (### ...)
  const questionRegex = /^###\s+(.+?)\s*$/gm;
  const items: { question: string; answer: string }[] = [];
  let qMatch: RegExpExecArray | null;
  const positions: { q: string; start: number; contentStart: number }[] = [];
  while ((qMatch = questionRegex.exec(faqBody)) !== null) {
    positions.push({
      q: qMatch[1].trim(),
      start: qMatch.index,
      contentStart: qMatch.index + qMatch[0].length,
    });
  }
  if (positions.length === 0) return [];

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    const answerEnd = next ? next.start : faqBody.length;
    let answer = faqBody.slice(cur.contentStart, answerEnd).trim();
    // 4) پاک‌سازی ساده Markdown از پاسخ (لینک‌ها، تصاویر، bold/italic، کد)
    answer = answer
      // حذف تصاویر ![alt](url) → alt
      .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "$1")
      // تبدیل لینک‌ها [text](url) → text
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
      // حذف bold/italic
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // حذف inline code
      .replace(/`([^`]+)`/g, "$1")
      // حذف code blocks
      .replace(/```[\s\S]*?```/g, "")
      // حذف heading markers باقی‌مانده
      .replace(/^#{1,6}\s+/gm, "")
      // حذف لیست مارکرها
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      // فشرده‌سازی whitespace و خطوط خالی
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // حذف علامت‌های سؤال/کولن اضافی از ابتدای سؤال
    const question = cur.q.replace(/^[:：\-\s]+/, "").trim();
    if (question && answer) {
      items.push({ question, answer });
    }
  }
  return items;
}

/**
 * تقسیم محتوای Markdown مقاله به دو نیم در مرز بلوک نزدیک ~۴۵٪ طول.
 * روی مرز بلوک‌ها (\n\n) برش می‌خورد — جدول/لیست هرگز نصفه نمی‌شود.
 * null یعنی متن کوتاه است و CTA وسطی لازم نیست.
 */
export function splitArticleContent(content: string): { top: string; bottom: string } | null {
  if (!content || content.length < MID_CTA_MIN_CONTENT) return null;
  const blocks = content.split(/\n\s*\n/);
  if (blocks.length < 4) return null; // متن کوتاه — تقسیم طبیعی ندارد
  const target = content.length * 0.45;
  let acc = 0;
  let splitIdx = -1;
  for (let i = 0; i < blocks.length - 1; i++) {
    acc += blocks[i].length + 2;
    // حداقل ۲ بلوک قبل از CTA و بعد آن هم حداقل ~۲۰٪ متن بماند
    if (acc >= target && i >= 1) {
      splitIdx = i;
      break;
    }
  }
  if (splitIdx < 0) return null;
  return {
    top: blocks.slice(0, splitIdx + 1).join("\n\n"),
    bottom: blocks.slice(splitIdx + 1).join("\n\n"),
  };
}

/**
 * کامپوننت‌های Markdown مقاله — مشترک بین صفحهٔ SSR (/article/[slug]) و
 * کامپوننت کلاینت (ArticlePage) تا هر دو دقیقاً همان استایل را بگیرند.
 * Note: h1, img, a are NOT overridden — in react-markdown v10, these break table parsing.
 * They are styled via CSS (.fitup-article h1/img/a)
 */
export const ARTICLE_MD_COMPONENTS = {
  h2: ({ node, ...p }: any) => <h2 className="text-xl font-black text-slate-900 mt-7 mb-3" {...p} />,
  h3: ({ node, ...p }: any) => <h3 className="text-lg font-bold text-slate-900 mt-6 mb-2" {...p} />,
  // ─── جدول‌ها در یک wrapper اسکرول‌پذیر قرار می‌گیرند ───
  // این مشکل «جدول بزرگ از کادر بیرون می‌زند» را در موبایل حل می‌کند.
  table: ({ node, ...p }: any) => (
    <div
      dir="rtl"
      style={{
        overflowX: "auto",
        margin: "1.5rem 0",
        WebkitOverflowScrolling: "touch",
        msOverflowStyle: "none",
        scrollbarWidth: "thin",
      }}
      className="fitup-table-wrapper"
    >
      <table dir="rtl" className="w-full text-sm" {...p} />
    </div>
  ),
  th: ({ node, ...p }: any) => <th dir="rtl" className="border border-slate-300 px-3 py-2.5 text-right font-bold text-slate-800 bg-orange-50 whitespace-nowrap" {...p} />,
  td: ({ node, ...p }: any) => <td dir="rtl" className="border border-slate-300 px-3 py-2.5 text-slate-700 text-right" {...p} />,
};
