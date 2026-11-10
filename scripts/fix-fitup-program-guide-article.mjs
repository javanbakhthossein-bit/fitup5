#!/usr/bin/env bun
/**
 * scripts/fix-fitup-program-guide-article.mjs — v246-seo-facts
 * ─────────────────────────────────────────────────────────────
 * اسکریپت یک‌بارهٔ اصلاح مقالهٔ منتشرشدهٔ «برنامه فیتاپ چطور کار می‌کند؟
 * راهنمای کامل شروع + مقایسه پلن‌ها» (slug: fitup-program-guide).
 *
 * مشکلاتی که اصلاح می‌کند (همهٔ ادعاها فقط از فکت‌های واقعی فیتاپ):
 *  ۱. جدول جعلی ۳ پلنه (پلن پایه / پلن حرفه‌ای / پلن کامل VIP) با ردیف‌های
 *     غیرواقعی (به‌روزرسانی ماهانه/هفتگی/روزانه، پشتیبانی انسانی ✅، گزارش نمودار)
 *     → جدول واقعی ۴ پلنه (اقتصادی/استاندارد/پیشرفته/حرفه‌ای) فقط با امکانات
 *     واقعی SUBSCRIPTION_PLANS — بدون هیچ قیمت عددی (قاعدهٔ مالک).
 *  ۲. ردیف «مربی هوشمند» غیرواقعی → دروازهٔ واقعی: اقتصادی/استاندارد ندارد،
 *     پیشرفته/حرفه‌ای بی‌نهایت.
 *  ۳. دو تصویر مارک‌داون دوبله (! [x]( ! [y](url) ) → یک تصویر سالم.
 *  ۴. لینک‌های فاصله‌دار «(/ ? tool=tdee)» → /tdee (و سایر نگاشت‌های ابزار/مقاله).
 *  ۵. ادعاهای ناسازگار با فکت‌ها: «هر هفته به‌روز می‌شود»، «برنامه هفته بعد تنظیم
 *     می‌شود»، چت/ویدیو بدون دروازهٔ پلن، «بیش از صدها حرکت» → چکاپ دوره‌ای
 *     روزهای ۱۵/۳۰/۴۰ (استاندارد به بالا) + دروازه‌های واقعی + ۵۷۳ حرکت.
 *
 * ایمنی:
 *  - قبل از هر تغییری یک ArticleRevision پشتیبان (عین الگوی content_refresh)
 *    می‌سازد — بازیابی توسط ادمین از پنل ممکن است.
 *  - Idempotent: اگر جدول واقعی ۴ پلنه (اقتصادی + حرفه‌ای در یک ردیف جدول)
 *    پیدا شود و هیچ الگوی خرابی باقی نمانده باشد، فقط گزارش می‌دهد و رد می‌شود.
 *  - عنوان/خلاصه/status دست نمی‌خورد (خلاصه بررسی شد — فکت غلطی ندارد).
 *
 * اجرا:
 *   bun scripts/fix-fitup-program-guide-article.mjs                          (dev DB پیش‌فرض)
 *   DATABASE_URL="file:/path/to/prod.db" bun scripts/fix-fitup-program-guide-article.mjs   (پروداکشن)
 *
 * ⚠️ دیتابیس پروداکشن سرور هنوز نسخهٔ قدیمی مقاله را دارد — مالک باید همین
 * اسکریپت را یک‌بار با DATABASE_URL پروداکشن اجرا کند.
 */

// ─── DATABASE_URL باید قبل از import PrismaClient ست شود (الگوی scripts دیگر) ───
process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

const SLUG = "fitup-program-guide";

/* ─── کمکی‌ها ─── */

const FIXES = []; // گزارش تفصیلی قبل/بعد برای خروجی diff-مانند

function reportFix(name, before, after) {
  FIXES.push({ name, before: String(before).trim().slice(0, 160), after: String(after).trim().slice(0, 160) });
}

/** جایگزینی امن: اگر متن قبل پیدا شد جایگزین کن و گزارش بده؛ وگرنه هشدار بده */
function replaceExact(content, before, after, name) {
  if (content.includes(before)) {
    reportFix(name, before, after);
    return content.split(before).join(after);
  }
  console.warn(`⚠️  الگوی «${name}» پیدا نشد — رد شد (احتمالاً قبلاً اصلاح شده)`);
  return content;
}

/* ─── محتوای واقعی جدول ۴ پلنه (فقط از SUBSCRIPTION_PLANS/capabilities — بدون قیمت) ─── */

const REAL_PLANS_TABLE = [
  "| ویژگی | اقتصادی | استاندارد | پیشرفته 🔥 | حرفه‌ای 👑 |",
  "|---|---|---|---|---|",
  "| برنامه تمرینی + برنامه غذایی اختصاصی (۴۵ روزه) | ✅ | ✅ | ✅ | ✅ |",
  "| برنامه مکمل‌های ورزشی | ❌ | ✅ | ✅ | ✅ |",
  "| چکاپ دوره‌ای و به‌روزرسانی برنامه در جای همان برنامه | ❌ | ۳ چکاپ (روزهای ۱۵/۳۰/۴۰) | ✅ | ✅ |",
  "| تحلیل پیشرفت و داشبورد پیشرفته | ❌ | ✅ | ✅ | ✅ |",
  "| مربی هوشمند (چت فیتاپ) | ❌ | ❌ | ✅ بی‌نهایت | ✅ بی‌نهایت (متن + عکس + ویدیو) |",
  "| آنالیز عکس غذا | ❌ | ❌ | ✅ | ✅ |",
  "| آنالیز عکس بدن | ❌ | ❌ | ✅ | ✅ |",
  "| کامپنیون تغذیه | ❌ | ❌ | ✅ | ✅ |",
  "| حالت باشگاه (Gym Mode) | ❌ | ❌ | ✅ | ✅ |",
  "| کتابخانه کامل حرکات متحرک | ❌ | ❌ | ✅ | ✅ |",
  "| آنالیز ویدیویی فرم بدن + اصلاح تکنیک با ویدیو | ❌ | ❌ | ❌ | ✅ (۱ بار) |",
  "| آنالیز آزمایش خون | ❌ | ❌ | ❌ | ✅ (۱ بار) |",
  "| نظارت مربی انسانی | ❌ | ❌ | ❌ | ✅ |",
  "| بانک حرکات/غذا و محاسبه‌گر TDEE | ✅ رایگان | ✅ رایگان | ✅ رایگان | ✅ رایگان |",
].join("\n");

const REAL_PLAN_GUIDE = [
  "**راهنمای انتخاب سریع:**",
  "",
  "- اگر تازه شروع کرده‌اید و می‌خواهید بدون هزینه زیاد شروع کنید → **پلن اقتصادی**",
  "- اگر برنامه مکمل، ۳ چکاپ دوره‌ای (روزهای ۱۵، ۳۰ و ۴۰) و تحلیل پیشرفت می‌خواهید → **پلن استاندارد**",
  "- اگر مربی هوشمند بی‌نهایت، آنالیز عکس غذا/بدن و حالت باشگاه (Gym Mode) می‌خواهید → **پلن پیشرفته** (پیشنهاد ویژهٔ فیتاپ)",
  "- اگر آنالیز ویدیویی فرم بدن، آزمایش خون و نظارت مربی انسانی می‌خواهید → **پلن حرفه‌ای** (کامل‌ترین)",
].join("\n");

/* ─── تبدیل‌های محتوا ─── */

function fixDoubledImages(content) {
  // «! [x](![y](url)» (پرانتز بیرونی هرگز بسته نشده) → «![x](url)»
  // alt توصیفی بیرونی (سئو-پسند) حفظ می‌شود؛ alt داخلی «تصویر N — …» فقط جای‌نگهدار بود.
  // ⚠️ انتهای الگو [ \t]* است نه \s* — تا newline خط بعد بلعیده نشود و تصویر به
  // «---» بعدی نچسبد (خطر setext-heading در مارک‌داون).
  const re = /^!\s*\[([^\]]+)\]\(!\[[^\]]*\]\(([^)]+)\)[ \t]*$/gm;
  let match;
  let count = 0;
  const fixed = content.replace(re, (_m, outerAlt, url) => {
    count++;
    return `![${outerAlt}](${url})`;
  });
  if (count > 0) reportFix("تصویر مارک‌داون دوبله", "!(x)( !(y)(url) )", `${count} تصویر → تک‌تصویر سالم با alt توصیفی`);
  return fixed;
}

function fixSpacedLinks(content) {
  // v246-seo-facts — نمونهٔ واقعی دیتابیس: «](/ ? tool=tdee)»
  let before = content;
  let fixed = content
    .replace(/\]\(\s*\/\s*\?/g, "](/?") // فاصله بین «(» و «/» و «?»
    .replace(/\]\(\/\?\s+/g, "](/?"); // فاصله بعد از «?»
  if (fixed !== before) {
    reportFix("لینک فاصله‌دار داخل هدف", "](/ ? tool=tdee)", "](/?tool=tdee)");
  }
  // نگاشت ابزار/مقاله به مسیر واقعی SSR (همان نگاشت‌های normalizeArticleLinks)
  before = fixed;
  fixed = fixed
    .replace(/\/?\?article=([a-zA-Z0-9_-]+)/g, "/article/$1")
    .replace(/\/?\?exercise=([a-zA-Z0-9_-]+)/g, "/exercise/$1")
    .replace(/\/?\?food=([a-zA-Z0-9_-]+)/g, "/food/$1")
    .replace(/\/?\?tool=tdee\b/g, "/tdee")
    .replace(/\/?\?tool=exercises\b/g, "/exercises")
    .replace(/\/?\?tool=foods\b/g, "/foods")
    .replace(/\/?\?screen=articles\b/g, "/articles");
  if (fixed !== before) {
    reportFix("لینک ابزار کوئری‌استایل", "/?tool=tdee", "/tdee (و همتاهای exercises/foods)");
  }
  return fixed;
}

function fixFakePlansTable(content) {
  // جدول جعلی: از هدر «| ویژگی | پلن پایه …» تا ردیف آخرِ جدول (فقط خطوط جدولی؛
  // newline انتهایی آخرین ردیف جزو تطبیق است تا خط خالی بعد از جدول سالم بماند)
  const fakeTableRe = /^\| ویژگی \| پلن پایه \|[^\n]*\n(?:^\|[^\n]*\|[ \t]*\n)+/gm;
  const m = fakeTableRe.exec(content);
  if (m) {
    reportFix("جدول جعلی ۳ پلنه (پایه/حرفه‌ای/VIP)", m[0].split("\n")[0], REAL_PLANS_TABLE.split("\n")[0]);
    // ⚠️ newlineِ انتهایی آخرین ردیف جزو تطبیق است → جایگزینی با "\n" پایانی تا
    // خط خالیِ بعد از جدول حفظ شود و پاراگراف بعدی به جدول نچسبد (GFM)
    content = content.slice(0, m.index) + REAL_PLANS_TABLE + "\n" + content.slice(m.index + m[0].length);
  } else {
    console.warn("⚠️  جدول جعلی ۳ پلنه پیدا نشد — رد شد (احتمالاً قبلاً اصلاح شده)");
  }

  // راهنمای انتخاب سریع جعلی (۳ گلولهٔ پلن پایه/حرفه‌ای/کامل)
  const fakeGuide =
    "**راهنمای انتخاب سریع:**\n\n" +
    "- اگر تازه شروع کرده‌اید و می‌خواهید بدون هزینه زیاد امتحان کنید → **پلن پایه**\n" +
    "- اگر جدی هستید، هفته‌ای ۳ تا ۵ روز تمرین می‌کنید و می‌خواهید برنامه هفتگی به‌روز شود → **پلن حرفه‌ای**\n" +
    "- اگر هدف مسابقه، فوتوشوت یا رسیدن به فیزیک حرفه‌ای است و می‌خواهید همه امکانات (تحلیل ویدیو، عکس غذا، پشتیبانی) را داشته باشید → **پلن کامل**";
  content = replaceExact(content, fakeGuide, REAL_PLAN_GUIDE, "راهنمای انتخاب سریع جعلی");

  // جملهٔ ارجاع به پلن‌ها — عین متن الزامی کار (v246-seo-facts)
  content = replaceExact(
    content,
    "برای دیدن جزئیات دقیق و قیمت هر پلن، به صفحه [مشاهده پلن‌ها](/?screen=plans) سر بزنید.",
    "برای مشاهدهٔ قیمت و تهیهٔ هر پلن به صفحهٔ [پلن‌های فیتاپ](/?screen=plans) سر بزنید.",
    "جملهٔ ارجاع به صفحهٔ پلن‌ها"
  );

  return content;
}

function fixFactualClaims(content) {
  const edits = [
    {
      name: "مقدمه: «هر هفته به‌روز می‌شود»",
      before: "ساخته می‌شود و هر هفته با پیشرفتتان به‌روز می‌شود.",
      after: "ساخته می‌شود و با چکاپ‌های دوره‌ای (روزهای ۱۵، ۳۰ و ۴۰ — پلن استاندارد به بالا) با پیشرفتتان به‌روز می‌شود.",
    },
    {
      name: "برنامه تمرینی پویا: «برنامه هفته بعد تنظیم می‌شود»",
      before: "اگر یک هفته ضعیف تمرین کردید، برنامه هفته بعد تنظیم می‌شود.",
      after: "با چکاپ‌های دوره‌ای (روزهای ۱۵، ۳۰ و ۴۰ دوره — پلن استاندارد به بالا)، برنامه در جای همان برنامه با پیشرفت شما به‌روز می‌شود.",
    },
    {
      name: "مربی هوشمند: دروازهٔ واقعی پلن",
      before: "هر زمان سؤال داشتید، مربی هوشمند فیتاپ پاسخ می‌دهد:",
      after: "در پلن‌های پیشرفته و حرفه‌ای، هر زمان سؤال داشتید، مربی هوشمند فیتاپ بی‌نهایت پاسخ می‌دهد (پلن اقتصادی و استاندارد مربی هوشمند ندارند):",
    },
    {
      name: "آنالیز عکس/ویدیو: دروازهٔ واقعی پلن",
      before: "می‌توانید عکس غذا بفرستید تا کالری تقریبی تخمین زده شود، یا ویدیوی اجرای حرکت را بفرستید تا فرم بدن‌تان بررسی شود.",
      after: "در پلن پیشرفته به بالا می‌توانید عکس غذا و عکس بدن بفرستید تا آنالیز هوشمند شوند، و در پلن حرفه‌ای ویدیوی اجرای حرکت را بفرستید تا فرم بدن‌تان بررسی شود (۱ بار در طول دوره).",
    },
    {
      name: "بخش مبتدی‌ها: گلولهٔ ویدیو بدون دروازه",
      before: "- امکان ارسال ویدیو و اصلاح فرم توسط مربی هوشمند",
      after: "- امکان آنالیز عکس غذا/بدن و اصلاح فرم با ارسال ویدیو (در پلن‌های پیشرفته و حرفه‌ای)",
    },
    {
      name: "بانک حرکات: عدد واقعی ۵۷۳",
      before: "بیش از صد‌ها حرکت با آموزش تصویری و نکات اجرا",
      after: "۵۷۳ حرکت با آموزش تصویری و نکات اجرا",
    },
    {
      name: "ارزش خرید: گلولهٔ «هر هفته به‌روز می‌شود»",
      before: "- **هر هفته به‌روز می‌شود**، نه هر چند ماه",
      after: "- **با چکاپ‌های دوره‌ای به‌روز می‌شود** (روزهای ۱۵، ۳۰ و ۴۰ — پلن استاندارد به بالا)، نه هر چند ماه",
    },
    {
      name: "گام ۵: «برنامه هفته بعد را تنظیم می‌کند»",
      before: "در صورت امکان ویدیوی حرکت بفرستید. مربی هوشمند فیتاپ بر اساس همین داده‌ها برنامه هفته بعد را تنظیم می‌کند.",
      after: "در پلن حرفه‌ای ویدیوی اجرای حرکت هم بفرستید. برنامه با چکاپ‌های دوره‌ای (روزهای ۱۵، ۳۰ و ۴۰ — پلن استاندارد به بالا) با پیشرفت شما به‌روز می‌شود.",
    },
    {
      name: "گام ۶: «برنامه به‌روز می‌شود» بدون مکانیزم",
      before: "هر ۲ تا ۴ هفته وزن، دور کمر و عکس پیشرفت را ثبت کنید. برنامه بر اساس همین داده‌ها به‌روز می‌شود.",
      after: "هر ۲ تا ۴ هفته وزن، دور کمر و عکس پیشرفت را ثبت کنید؛ با هر چکاپ دوره‌ای، برنامه در جای همان برنامه با پیشرفت شما به‌روز می‌شود.",
    },
    {
      name: "FAQ مبتدی: ویدیو فقط حرفه‌ای",
      before: "حتی می‌توانید ویدیوی اجرای خود را بفرستید تا فرم بدن‌تان اصلاح شود.",
      after: "در پلن حرفه‌ای حتی می‌توانید ویدیوی اجرای خود را بفرستید تا فرم بدن‌تان اصلاح شود.",
    },
    {
      name: "FAQ تفاوت پلن‌ها: «ماهانه در برابر هفتگی» غلط",
      before: "تفاوت اصلی در میزان شخصی‌سازی، به‌روزرسانی برنامه (ماهانه در برابر هفتگی) و امکانات تحلیلی مثل تحلیل عکس غذا و ویدیوی حرکت است. جدول مقایسه در همین مقاله همه تفاوت‌ها را نشان می‌دهد.",
      after: "تفاوت اصلی در امکانات هر پلن است: برنامه مکمل و ۳ چکاپ دوره‌ای (استاندارد به بالا)، مربی هوشمند بی‌نهایت و آنالیز عکس غذا/بدن و حالت باشگاه (پیشرفته به بالا) و آنالیز ویدیویی فرم بدن، آزمایش خون و نظارت مربی انسانی (فقط حرفه‌ای). جدول مقایسه در همین مقاله همه تفاوت‌ها را نشان می‌دهد.",
    },
    {
      name: "FAQ نتیجه‌گیری: «هر هفته تنظیم می‌شود»",
      before: "برنامه فیتاپ هر هفته با پیشرفت شما تنظیم می‌شود تا این روند سریع‌تر شود.",
      after: "برنامه فیتاپ با چکاپ‌های دوره‌ای (روزهای ۱۵، ۳۰ و ۴۰ — پلن استاندارد به بالا) با پیشرفت شما تنظیم می‌شود تا این روند سریع‌تر شود.",
    },
    {
      name: "FAQ ارزش خرید: «مربی ۲۴ ساعته» بدون دروازه",
      before: "شخصی‌سازی هوشمند، مربی ۲۴ ساعته، برنامه تمرین و تغذیه یکجا و تحلیل بدن/غذا/ویدیو،",
      after: "شخصی‌سازی هوشمند، مربی هوشمند ۲۴ ساعته (پیشرفته به بالا)، برنامه تمرین و تغذیه یکجا و تحلیل بدن/غذا/ویدیو،",
    },
  ];
  for (const e of edits) {
    content = replaceExact(content, e.before, e.after, e.name);
  }
  return content;
}

/* ─── تشخیص Idempotency ─── */

function isTableAlreadyFixed(content) {
  // جدول واقعی: ردیفی جدولی که هم «اقتصادی» و هم «حرفه‌ای» دارد (v246-seo-facts)
  return content.split("\n").some(
    (line) => line.trim().startsWith("|") && line.includes("اقتصادی") && line.includes("حرفه‌ای")
  );
}

function leftoverProblems(content) {
  const problems = [];
  if (/^\| ویژگی \| پلن پایه \|/m.test(content)) problems.push("جدول جعلی ۳ پلنه");
  if (/پلن کامل \(VIP\)|\*\*پلن کامل\*\*|پلن پایه\*\*/.test(content)) problems.push("نام پلن جعلی (پایه/VIP/کامل)");
  if (/^!\s*\[[^\]]+\]\(!\[/m.test(content)) problems.push("تصویر مارک‌داون دوبله");
  // فقط فاصلهٔ واقعاً معیوب داخل هدف لینک — لینک سالم «](/?screen=plans)» نباید فلاگ شود
  if (/\]\(\s+\/\s*\?|\]\(\/\s+\?|\]\(\/\?\s+/.test(content)) problems.push("لینک فاصله‌دار");
  if (/هر هفته (با پیشرفتتان )?به‌روز می‌شود/.test(content)) problems.push("ادعای به‌روزرسانی هفتگی");
  return problems;
}

/* ─── اجرای اصلی ─── */

async function main() {
  console.log("🔧 v246-seo-facts — اصلاح یک‌بارهٔ مقالهٔ fitup-program-guide");
  console.log(`📂 دیتابیس: ${process.env.DATABASE_URL.replace(/^file:/, "")}\n`);

  const article = await db.article.findUnique({ where: { slug: SLUG } });
  if (!article) {
    console.error(`❌ مقاله‌ای با slug «${SLUG}» پیدا نشد.`);
    process.exit(1);
  }
  console.log(`📄 مقاله: «${article.title}» (id: ${article.id}, status: ${article.status})`);
  console.log(`   طول محتوا: ${article.content.length} کاراکتر\n`);

  const alreadyFixed = isTableAlreadyFixed(article.content);
  const leftovers = leftoverProblems(article.content);

  if (alreadyFixed && leftovers.length === 0) {
    console.log("✅ جدول پلن‌ها قبلاً با جدول واقعی ۴ پلنه اصلاح شده و هیچ الگوی خرابی باقی نمانده — هیچ تغییری انجام نشد (idempotent).");
    await db.$disconnect();
    return;
  }
  if (alreadyFixed && leftovers.length > 0) {
    console.log(`ℹ️  جدول واقعی از قبل هست ولی این خرابی‌ها باقی مانده: ${leftovers.join("، ")} — فقط همان‌ها اصلاح می‌شود.\n`);
  }

  let content = article.content;
  content = fixFakePlansTable(content);
  content = fixDoubledImages(content);
  content = fixSpacedLinks(content);
  content = fixFactualClaims(content);

  if (content === article.content) {
    console.log("ℹ️  هیچ تغییری اعمال نشد (محتوای یکسان).");
    await db.$disconnect();
    return;
  }

  // ─── پشتیبان ArticleRevision — عین الگوی content_refresh.ts (ممیزی 2-c P1) ───
  const revision = await db.articleRevision.create({
    data: {
      articleId: article.id,
      title: article.title,
      excerpt: article.excerpt,
      content: article.content,
      seoTitle: article.seoTitle,
      seoDescription: article.seoDescription,
      metaKeywords: article.metaKeywords,
    },
  });
  console.log(`💾 پشتیبان ArticleRevision ساخته شد: ${revision.id}\n`);

  await db.article.update({
    where: { id: article.id },
    data: { content }, // فقط content — عنوان/خلاصه/status دست نمی‌خورد
  });

  /* ─── گزارش diff-مانند ─── */
  console.log("═══ خلاصهٔ تغییرات (قبل → بعد) ═══");
  for (const [i, f] of FIXES.entries()) {
    console.log(`\n✏️  [${i + 1}] ${f.name}`);
    console.log(`   قبل: ${f.before}`);
    console.log(`   بعد: ${f.after}`);
  }
  console.log(`\n📊 ${FIXES.length} بخش اصلاح شد — طول محتوا: ${article.content.length} → ${content.length} کاراکتر`);

  // ─── راستی‌آزمایی نهایی (بازخوانی از DB) ───
  const after = await db.article.findUnique({ where: { slug: SLUG } });
  const checks = {
    "جدول ۴ پلنه (اقتصادی+حرفه‌ای در ردیف جدول)": isTableAlreadyFixed(after.content),
    "بدون پلن جعلی VIP": !after.content.includes("پلن کامل (VIP)"),
    "بدون تصویر دوبله": !/^!\s*\[[^\]]+\]\(!\[/m.test(after.content),
    // فقط فاصلهٔ معیوب — لینک سالم «](/?screen=plans)» نباید فلاگ شود
    "بدون لینک فاصله‌دار": !/\]\(\s+\/\s*\?|\]\(\/\s+\?|\]\(\/\?\s+/.test(after.content),
    "دروازهٔ مربی هوشمند (اقتصادی/استاندارد ندارد)": after.content.includes("(پلن اقتصادی و استاندارد مربی هوشمند ندارند)"),
    "چکاپ دوره‌ای روزهای ۱۵/۳۰/۴۰": after.content.includes("روزهای ۱۵/۳۰/۴۰"),
    "بدون به‌روزرسانی هفتگی": !/هر هفته (با پیشرفتتان )?به‌روز می‌شود/.test(after.content),
  };
  console.log("\n═══ راستی‌آزمایی نهایی ═══");
  let allOk = true;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? "✅" : "❌"} ${k}`);
    if (!v) allOk = false;
  }
  console.log(allOk ? "\n🎉 اصلاح کامل و تأیید شد." : "\n⚠️  برخی بررسی‌ها رد شدند — خروجی بالا را بررسی کنید.");
  await db.$disconnect();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error("❌ خطا در اجرای اسکریپت:", e);
  await db.$disconnect().catch(() => null);
  process.exit(1);
});
