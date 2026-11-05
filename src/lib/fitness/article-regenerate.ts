/**
 * ریجنریت کامل مقاله (Full Article Regeneration) — دکمهٔ «ریجنریت کامل» در پنل ادمین
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * هدف: ادمین روی یک مقالهٔ موجود دکمهٔ «ریجنریت کامل» می‌زند و کل مقاله از صفر
 * دوباره ساخته می‌شود:
 *   ۱. متن کاملاً جدید (۱۸۰۰+ کلمه، سئوشده، لینک‌سازی داخلی relevance-based)
 *   ۲. تصویر کاور جدید + تصاویر inline جدید
 *   ۳. فیلدهای سئوی جدید (seoTitle / seoDescription / metaKeywords)
 *
 * ⚠️ قواعد حفاظت از مقاله (مهم‌ترین بخش این ماژول):
 *   - slug/URL، status، publishedAt، views، authorId، category، tags و canonicalUrl
 *     هرگز دست نمی‌خورند — مقاله همان URL قبلی را با محتوای جدید نگه می‌دارد.
 *   - excerpt قدیمی عمداً حفظ می‌شود (بازتولید خلاصه ممکن است با متن جدید
 *     ناهماهنگ از آب دربیاید و خلاصهٔ فعلی توسط ادمین بازبینی شده است).
 *   - قبل از هر overwrite، نسخهٔ کامل قبلی به‌صورت ArticleRevision ذخیره می‌شود
 *     (قابل بازیابی توسط ادمین — همان الگوی content-refresh).
 *   - اگر فراخوانی اصلی LLM (متن مقاله) شکست بخورد، مقاله «دست‌نخورده» باقی
 *     می‌ماند و ok:false برمی‌گردد — هیچ‌وقت مقاله را نصفه/خراب نمی‌گذاریم.
 *   - شکست‌های تصویر به‌صورت تدریجی (graceful) مدیریت می‌شوند: کاور قدیمی حفظ
 *     می‌شود، placeholder خراب حذف می‌شود و فقط note ثبت می‌شود.
 *
 * تفاوت با content-refresh.ts: آن ماژول cron-driven است و بر اساس دادهٔ
 * Search Console مقالات «فرصت‌دار» را بازنویسی جزئی می‌کند؛ این ماژول یک
 * اکشن دستیِ per-article است که کل مقاله را از صفر می‌سازد.
 *
 * تفاوت با rebuild-images: آن route فقط تصاویر را ترمیم/بازسازی می‌کند و به
 * متن دست نمی‌زند؛ اینجا متن + تصاویر + سئو هر سه از صفر تولید می‌شوند.
 */
import { db } from "@/lib/db";
import {
  callLlm,
  extractJson,
  analyzeSite,
  buildLinkCandidates,
  renderLinkCandidates,
  // تایپ‌ها — RunContext فقط برای پاس دادن به analyzeSite (که log داخلی‌اش روی
  // db.seoAgentRun می‌نویسد؛ چون runId واقعی نداریم، آپدیت آن بی‌صدا fail می‌شود
  // و .catch دارد — بی‌ضرر است).
  type RunContext,
  type LinkCandidate,
} from "@/lib/fitness/seo-agent";
// v246-seo-facts — فکت‌های رسمی فیتاپ (پلن‌ها/تعداد غذاها و حرکات زنده) باید در
// پرامپت تولید محتوا تزریق شود تا مدل دربارهٔ پلن‌ها/امکانات فیتاپ تخیل نبندد.
import { buildSeoSiteFactsBlock } from "@/lib/fitness/seo-site-facts";
import { generateImage, type AspectRatio } from "@/lib/fitness/avalai-image";
import {
  processAndSaveArticleImage,
  processAndSaveInlineImage,
} from "@/lib/fitness/image-processing";
// v218 الگو — پینگ فوری IndexNow بعد از به‌روزرسانی مقالهٔ منتشرشده
import { submitToIndexNow } from "@/lib/fitness/indexnow";

// ─── شکل نتیجه — برگردانده‌شده به route و سپس به UI ادمین ───
export interface RegenerateResult {
  ok: boolean;
  slug: string;
  wordCount: number;
  coverUrl: string;
  inlineCount: number;
  revisionId: string | null;
  notes: string[];
}

/** گزینه‌های ریجنریت — onlyText=true فقط متن/سئو را بازتولید می‌کند (تصاویر دست‌نخورده) */
export interface RegenerateOptions {
  articleId: string;
  adminId: string;
  /** اگر true باشد، تولید تصویر (کاور + inline) کلاً skip می‌شود و کاور/تصاویر قدیمی حفظ می‌شوند */
  onlyText?: boolean;
}

/**
 * ریجنریت کامل یک مقاله از صفر — همان استاندارد کیفی generateArticle ایجنت سئو
 * با این تفاوت که مقاله از قبل وجود دارد: عنوان/slug/وضعیت حفظ می‌شوند و
 * نسخهٔ قبلی به‌عنوان revision پشتیبان گرفته می‌شود.
 */
export async function regenerateArticleFull(
  opts: RegenerateOptions
): Promise<RegenerateResult> {
  const notes: string[] = [];

  // ─── لاگگر کوچک خودمان (به‌جای log ایجنت سئو) ───
  // log ایجنت سئو به db.seoAgentRun می‌نویسد و رکورد run نداریم؛ این نسخهٔ
  // محلی فقط note جمع می‌کند و به کنسول سرور می‌رود تا در پاسخ API برگردد.
  const logR = (msg: string) => {
    notes.push(msg);
    console.log(`[ARTICLE-REGEN] ${msg}`);
  };

  // ─── ۱. بارگذاری مقاله + پلن سئوی اختیاری ───
  const article = await db.article.findUnique({ where: { id: opts.articleId } });
  if (!article) {
    return {
      ok: false,
      slug: "",
      wordCount: 0,
      coverUrl: "",
      inlineCount: 0,
      revisionId: null,
      notes: ["مقاله یافت نشد — هیچ تغییری اعمال نشد."],
    };
  }

  // پلن سئوی مرتبط (اگر مقاله با ایجنت سئو ساخته شده باشد) — برای
  // coverImagePrompt / inlineImagePrompts / keyword استفاده می‌شود.
  const seoPlan = await db.seoArticlePlan.findFirst({
    where: { articleId: article.id },
  });

  // ─── ۲. ساخت کلمات کلیدی: پلن سئو ← اولین تگ ← عنوان ───
  const tagList = (article.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const keyword = seoPlan?.keyword?.trim() || tagList[0] || article.title;
  // «بقیهٔ تگ‌ها» — اگر کلمهٔ اصلی از پلن سئو آمد، همهٔ تگ‌ها در دسترس‌اند؛
  // وگرنه تگ اول که خودش keyword شده حذف می‌شود. سقف ۶ مورد.
  const remainingTags = seoPlan?.keyword?.trim() ? tagList : tagList.slice(1);
  const secondaryKeywords = remainingTags.slice(0, 6);

  logR(
    `شروع ریجنریت کامل مقاله «${article.title}» (slug: ${article.slug}) — کلمه کلیدی: «${keyword}»${opts.onlyText ? " — حالت فقط-متن" : ""}`
  );

  // ─── ۳. RunContext حداقلی برای توابع مشترک با ایجنت سئو ───
  // analyzeSite فقط فیلدهای ctx را می‌خواند و log(ctx) داخلی‌اش روی
  // db.seoAgentRun با این runId جعلی بی‌صدا شکست می‌خورد (.catch دارد) — بی‌ضرر.
  const ctx = {
    runId: "manual-regen",
    mode: "content_refresh",
    count: 1,
    logs: [],
    adminId: opts.adminId,
    startedAt: Date.now(),
    successCount: 0,
    failCount: 0,
    articles: [],
    errors: [],
  } as RunContext;

  // ─── ۴. تحلیل سایت + کاندیدهای لینک داخلی relevance-based ───
  // همان الگوی generateArticle: ~۴۰ مقالهٔ مرتبط + ~۱۲ حرکت + ~۱۲ غذا + ۶ صفحهٔ کلیدی
  const site = await analyzeSite(ctx);
  let linkCandidates: LinkCandidate[] = buildLinkCandidates(site, [
    keyword,
    ...secondaryKeywords,
  ]);
  // ⚠️ مقالهٔ فعلی خودش در site.articles هست (منتشرشده است) — حذفش می‌کنیم تا
  // مدل اشتباهاً به خودش لینک ندهد (لینک به خود = سیگنال منفی سئو).
  linkCandidates = linkCandidates.filter((c) => c.slug !== article.slug);

  // ─── ۵. پرامپت تولید محتوا — همان قوانین generateArticle + دستور بازنویسی ───
  const contentSystem = `تو یک نویسنده حرفه‌ای محتوای ورزشی و تغذیه فارسی هستی. مقالات تو:
- حداقل ۱۸۰۰ کلمه هستند
- کاملاً سئوشده هستند (کلمه کلیدی اصلی در H1، پاراگراف اول، چند بار در متن، و در نتیجه‌گیری)
- ساختار حرفه‌ای دارند: H1، چند H2، چند H3، لیست‌ها، نقل‌قول‌های برجسته
- علمی، دقیق و کاربردی هستند (نه کلی‌گویی)
- لحن حرفه‌ای اما قابل فهم دارند
- شامل ایموجی‌های مرتبط برای خوانایی بهتر
- با فرمت Markdown هستند
- الزامی: شامل ۱ تا ۲ جای‌نگهدار تصویر داخل متن با فرمت دقیق ![توضیح فارسی تصویر حاوی کلمه کلیدی](IMAGE_PLACEHOLDER_1)
  • حتماً حداقل یک جای‌نگهدار تصویر با همین فرمت در میانه مقاله (بعد از بخش دوم H2) بگذار.
  • در مقالات خیلی طولانی می‌توانی تصویر دوم را با فرمت ![توضیح فارسی دیگر](IMAGE_PLACEHOLDER_2) در بخشی متفاوت اضافه کن.
  • مهم: alt text باید توصیفی، فارسی و حاوی کلمه کلیدی باشد (حداقل ۵ کلمه). مثال: ![جدول کالری غذاها و مواد مغذی](IMAGE_PLACEHOLDER_1)
  • تصویر inline باید موضوعی مکمل و متفاوت از کاور داشته باشد (مثلاً کاور صحنه کلی است؛ inline نمای نزدیک تکنیک، جزئیات اجرا یا مرحله‌ای از حرکت).
  • ⚠️ الزامی: جای‌نگهدار تصویر دقیقاً با همین ساختار ![...](IMAGE_PLACEHOLDER_1) باید در Markdown نهایی بیاید — هرگز آن را حذف نکن، جابه‌جا نکن یا به‌صورت متن ساده ننویس.
- شامل جدول مقایسه‌ای (Markdown table) حداقل در یک بخش
- شامل سؤالات متداول (FAQ) با ساختار H3 در انتها
- شامل نتیجه‌گیری انگیزشی

قوانین بسیار مهم (حتماً رعایت کن):
- هر مقاله حتماً باید یک H1 در ابتدا داشته باشد — و H1 باید «دقیقاً» همان عنوانی باشد که به تو داده شده است. هیچ‌گاه عنوان را تغییر نده، کوتاه نکن یا بازنویسی نکن.
- هیچ‌گاه دو تصویر را پشت سر هم قرار نده — همیشه حداقل یک پاراگراف متن بین دو تصویر باشد.
- هیچ‌گاه کلمات h1, h2, h3, H1, H2, H3 را به‌عنوان متن در heading‌ها ننویس. مثلاً ننویس '### h3 سوال' یا '### H3: سوال' — فقط بنویس '### سوال'.
- از جدول Markdown (table) برای مقایسه‌ها و داده‌های ساختاریافته استفاده کن — حداقل یک جدول در هر مقاله.

قوانین مهم لینک‌های داخلی (بسیار مهم):
لینک‌های داخلی فقط با این فرمت‌ها مجاز هستند:
۱. لینک به صفحه اصلی: [متن](/)
۲. لینک به ابزارها: [متن](/?tool=tdee) یا [متن](/?tool=exercises) یا [متن](/?tool=foods)
۳. لینک به مقاله دیگر: [متن](/article/slug) — slug را از لیست مقالات موجود انتخاب کن
۴. لینک به لیست مقالات: [متن](/articles)
۵. لینک به صفحه حرکت ورزشی: [متن](/exercise/آیدی) — آیدی را فقط از لیست «حرکات ورزشی موجود» بردار
۶. لینک به صفحه ماده غذایی: [متن](/food/آیدی) — آیدی را فقط از لیست «مواد غذایی موجود» بردار
(v105) همیشه از فرمت /article/slug استفاده کن — فرمت قدیمی /?article=slug دیگر استفاده نمی‌شود.
هیچ‌گاه از /blog استفاده نکن — این مسیر وجود ندارد. از /articles استفاده کن.
⚠️ فقط به مقالاتی که در لیست "مقالات موجود" هستند لینک بده. هرگز به مقاله‌ای که هنوز ساخته نشده لینک نده.
⚠️ آیدی exercise/food را هرگز از خودت نساز — فقط آیدی‌های موجود در لیست‌های «حرکات ورزشی/مواد غذایی موجود» معتبرند.
⚠️ هرگز به مقالهٔ خودِ همین نوشته لینک نده (slug آن: ${article.slug}).
💡 ۲-۳ لینک به صفحات پویا (حرکت ورزشی/ماده غذایی) هم در متن بگذار — لینک‌سازی داخلی قوی‌تر می‌شود و صفحات پویا هم رتبه می‌گیرند.

قوانین محتوایی فوق‌حرفه‌ای:
- مقاله باید کاملاً یونیک و اصلی باشد — نه کپی از سایت‌های دیگر
- محتوا باید بر اساس آخرین تحقیقات علمی و پزشکی باشد
- از آمار، اعداد و داده‌های علمی استفاده کن (با ذکر منبع در متن)
- لحن باید ترغیب‌کننده و فروش‌محور باشد — کاربر را به خرید برنامه بدنسازی تشویق کن
- در پایان مقاله، یک پاراگراف CTA (دعوت به اقدام) برای خرید برنامه فیتاپ اضافه کن
- از کلمات کلیدی سئو به‌صورت طبیعی در متن استفاده کن (keyword density 1-2٪)
- مقاله باید حداقل ۱۸۰۰ کلمه باشد
- شامل نکات عملی و کاربردی باشد که کاربر بلافاصله استفاده کند
- ⚠️ قاعدهٔ «قیمت هرگز در متن»: هرگز عدد/مبلغ قیمت پلن‌ها را در متن مقاله ننویس — فقط به صفحهٔ پلن‌ها لینک بده: [مشاهده پلن‌ها](/#pricing)

🎯 قواعد پوشش کلمات کلیدی (الزامی — برای چندبرابر شدن کلمات ثبت‌شده در سرچ کنسول):
- کلمه کلیدی اصلی حتماً در «۱۰۰ کلمهٔ اول» متن، در حداقل ۲ هدینگ H2 و در پاراگراف پایانی بیاید
- حداقل ۴ تا ۶ هدینگ H2/H3 «سوال‌محور» بنویس (همان سوالاتی که مردم در گوگل تایپ می‌کنند — مثل «چقدر …؟»، «بهترین … برای …؟»، «آیا …؟»، «… در خانه چطور؟») — هر سوال یک پرسش واقعی در سرچ کنسول را پوشش می‌دهد
- همهٔ کلمات کلیدی ثانویه را طبیعی و پخش‌شده در متن بگنجان (هر کدام حداقل یک‌بار — ترجیحاً داخل هدینگ یا پاراگراف اختصاصی خودش)
- یک بخش «سوالات متداول» با ۴ تا ۶ پرسش و پاسخ واقعی و مشخص (نه عمومی) بنویس — این بخش با ساختار FAQPage به گوگل معرفی می‌شود
- برای هر ادعای علمی، عدد/درصد/دوز مشخص بیاور تا مقاله برای جستجوهای عددی هم رتبه بگیرد`;

  // دستهٔ «آموزش استروئیدها» — همان محافظت generateArticle: لحن پزشکی، بدون CTA فروش
  const isSteroidsEducation =
    article.category === "steroids-education" || article.category === "آموزش-استروئیدها";

  // فکت‌های رسمی فیتاپ (کش ۶۰ ثانیه‌ای دارد) — الزامی طبق v246-seo-facts
  const siteFactsBlock = await buildSeoSiteFactsBlock();

  const contentUser = `یک مقاله کامل بنویس با مشخصات زیر:

⚠️ مهم‌ترین نکته — بازنویسی کامل، نه ویرایش:
این مقاله از قبل وجود داشته و اکنون به‌طور کامل بازنویسی می‌شود؛ عنوان: ${article.title}، موضوع: ${keyword}. محتوای کاملاً جدید، عمیق‌تر و به‌روز بنویس — بازنویسی سطحی یا خلاصه‌نویسی ممنوع. ساختار و زاویهٔ دید را هم نسبت به نسخهٔ قبلی تازه کن (مثلاً بخش‌های جدید، مثال‌های کاربردی تازه، جدول‌ها و مقایسه‌های متفاوت).

عنوان (H1 — دقیقاً همین باشد، تغییرش ممنوع): ${article.title}
کلمه کلیدی اصلی: ${keyword}
کلمات کلیدی ثانویه: ${secondaryKeywords.join("، ") || "—"}
دسته: ${article.category}
خلاصهٔ فعلی مقاله (برای هم‌راستایی موضوع — عیناً در خروجی نیاور): ${article.excerpt}

${siteFactsBlock}

${isSteroidsEducation ? `
⚠️ هشدار بسیار مهم برای این دسته:
این مقاله در دسته «آموزش آگاه‌سازی استروئیدها» است. هدف فقط و فقط آگاه‌سازی کاربران درباره عوارض، خطرات و پیامدهای مصرف استروئید است. در مقاله:
- هرگز به مصرف استروئید تشویق نکن
- عوارض کوتاه‌مدت و بلندمدت (مثل آسیب کبد، ناباروری، مشکلات قلبی، تغییرات هورمونی، ریزش مو، آکنه، نوسانات خلقی) را با جزئیات شرح بده
- مهم‌ترین بخش مقاله باید «راهکارهای جایگزین طبیعی» باشد — افزایش تستوسترون طبیعی، تغذیه، مکمل‌های قانونی، خواب، استرس
- در انتهای مقاله، یک هشدار جدی پزشکی اضافه کن: «مصرف استروئید بدون نسخه پزشک غیرقانونی و خطرناک است»
- CTA فروش‌محور استفاده نکن — به جای آن، کاربر را به مشاوره با مربی فیتاپ برای بدنسازی طبیعی دعوت کن
- لحن باید جدی، علمی و پزشکی باشد — نه ترغیب‌کننده و فروش‌محور
` : ""}

لینک‌های داخلی موجود برای لینک‌سازی (حتماً از این‌ها در متن استفاده کن):
${renderLinkCandidates(linkCandidates)}

یادآوری فرمت لینک‌ها:
- لینک به ابزار: [متن](/?tool=tdee) یا [متن](/?tool=exercises) یا [متن](/?tool=foods)
- لینک به مقاله: [متن](/article/slug)
- لینک به صفحه اصلی: [متن](/)
- لینک به لیست مقالات: [متن](/articles)
- لینک به صفحه حرکت ورزشی: [متن](/exercise/آیدی)
- لینک به صفحه ماده غذایی: [متن](/food/آیدی)

فقط محتوای Markdown بنویس. بدون توضیح اضافه در ابتدا یا انتها.`;

  // ─── ۶. فراخوانی اصلی LLM + زنجیرهٔ post-processing (همان الگوی generateArticle) ───
  let articleContent = "";
  try {
    articleContent = await callLlm(contentSystem, contentUser, 8000);
  } catch (e: any) {
    // ⚠️ شکست متن = شکست کل عملیات — مقاله باید دست‌نخورده بماند
    const msg = `خطا در تولید محتوای جدید: ${e?.message || e}`;
    logR(`❌ ${msg} — مقاله بدون تغییر ماند.`);
    return {
      ok: false,
      slug: article.slug,
      wordCount: 0,
      coverUrl: article.coverImage || "",
      inlineCount: 0,
      revisionId: null,
      notes,
    };
  }

  if (!articleContent || articleContent.trim().length < 500) {
    // پاسخ خیلی کوتاه = خروجی خراب مدل — بازنویسی نکن
    const msg = "خروجی مدل برای محتوای مقاله خیلی کوتاه/خالی بود — مقاله بدون تغییر ماند.";
    logR(`❌ ${msg}`);
    return {
      ok: false,
      slug: article.slug,
      wordCount: 0,
      coverUrl: article.coverImage || "",
      inlineCount: 0,
      revisionId: null,
      notes,
    };
  }

  // ۶-الف) حذف code fence ابتدا/انتها (مدل گاهی ```markdown می‌گذارد)
  articleContent = articleContent
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  // ۶-ب) پاک‌سازی h1/h2/h3 literal از heading‌ها («### h3 سوال» → «### سوال»)
  articleContent = articleContent.replace(
    /^(#{1,6})\s*[hH][1-6][:：\-\s]+/gm,
    "$1 "
  );

  // ۶-ج) نرمال‌سازی لینک‌های داخلی — همان ۶ قدم v105
  // 1) /article// (double slash) → /
  articleContent = articleContent.replace(/\/article\/\//g, "/");
  // 2) فرمت قدیمی ](/?article=slug) → ](/article/slug)
  articleContent = articleContent.replace(
    /\]\(\/\?article=([^)&]+)(?:&[^)]*)?\)/g,
    (_m, slug: string) => `](/article/${slug})`
  );
  // 2-b) لینک مقاله نباید کوئری داشته باشد: ](/article/slug?x=y) → ](/article/slug)
  articleContent = articleContent.replace(
    /\]\(\/article\/([^)?]+)\?[^)]*\)/g,
    (_m, slug: string) => `](/article/${slug})`
  );
  // 3) ](/blog) → ](/articles)
  articleContent = articleContent.replace(/\]\(\/blog\)/g, "](/articles)");
  // 4) ارجاعات مستقل /blog (خارج از markdown link)
  articleContent = articleContent.replace(/(^|[\s(])\/blog(?=[\s)]|$)/g, "$1/articles");
  // 5) فرمت قدیمی لیست مقالات ](/?screen=articles) → ](/articles)
  articleContent = articleContent.replace(
    /\]\(\/\?screen=articles(?:&[^)]*)?\)/g,
    "](/articles)"
  );
  // 6) صفحات پویا: ](/?exercise=ID) → ](/exercise/ID) و ](/?food=ID) → ](/food/ID)
  articleContent = articleContent.replace(
    /\]\(\/\?exercise=([^)&]+)(?:&[^)]*)?\)/g,
    (_m, id: string) => `](/exercise/${id})`
  );
  articleContent = articleContent.replace(
    /\]\(\/\?food=([^)&]+)(?:&[^)]*)?\)/g,
    (_m, id: string) => `](/food/${id})`
  );
  logR("🔗 نرمال‌سازی لینک‌های داخلی به routeهای واقعی انجام شد.");

  // ۶-د) نرمال‌سازی فرمت جای‌نگهدارهای تصویر
  // مدل گاهی ![alt](image_placeholder_1) یا IMAGE_PLACEHOLDER_1 خام می‌نویسد
  articleContent = articleContent.replace(
    /(!\[([^\]]*)\]\(\s*)?IMAGE[-_ ]?PLACEHOLDER[-_ ]?(\d+)(\s*\))?/gi,
    (_full: string, _prefix: string | undefined, alt: string | undefined, num: string) =>
      `![${alt && alt.trim() ? alt.trim() : `تصویر ${num} — ${keyword}`}](IMAGE_PLACEHOLDER_${num})`
  );

  // ۶-ه) فال‌بک: اگر مدل هیچ جای‌نگهداری نگذاشته بود، خودمان بعد از H2 دوم درج می‌کنیم
  if (!/!\[[^\]]*\]\(IMAGE_PLACEHOLDER_\d+\)/.test(articleContent)) {
    articleContent = insertFallbackInlinePlaceholder(articleContent, keyword);
    logR("🖼 هیچ جای‌نگهدار تصویری در متن نبود — یک placeholder خودکار درج شد.");
  }

  // ۶-و) شبکهٔ ایمنی: بین دو تصویر متوالی پاراگراف انتقالی درج کن
  articleContent = separateConsecutiveImages(articleContent);

  // ─── ۷. تولید تصویر کاور جدید (همیشه — seed یکتا برای صحنهٔ متفاوت) ───
  let coverUrl = article.coverImage || "";
  if (!opts.onlyText) {
    try {
      const uniqueSeed = `${article.slug}-${Date.now()}`;
      const coverPrompt = seoPlan?.coverImagePrompt
        ? `${seoPlan.coverImagePrompt}. Unique scene ID: ${uniqueSeed}`
        : `Professional fitness photograph of ${keyword}, natural bright daylight, modern gym environment, realistic colors, athletic person in natural pose, proper form, photorealistic, high quality, sharp focus, no text, no watermark, no weird anatomy, no extra limbs, no distorted faces, magazine editorial style. Unique scene ID: ${uniqueSeed}`;
      logR("🖼 تولید تصویر کاور جدید...");
      const coverImg = await generateImage({
        prompt: coverPrompt,
        aspectRatio: "16:9" as AspectRatio,
        timeoutMs: 120000,
      });
      const processed = await processAndSaveArticleImage({
        buffer: coverImg.buffer,
        articleSlug: article.slug,
        descriptiveName: keyword.replace(/\s+/g, "-").slice(0, 40),
      });
      coverUrl = processed.cover.url;
      logR(`✅ کاور جدید تولید شد: ${coverUrl}`);
    } catch (e: any) {
      // graceful: کاور قدیمی حفظ می‌شود — شکست کاور نباید کل ریجنریت را بیندازد
      logR(`⚠️ تولید تصویر کاور شکست خورد (${e?.message || e}) — کاور قبلی حفظ شد.`);
    }
  } else {
    logR("ℹ حالت فقط-متن — کاور قبلی حفظ شد.");
  }

  // ─── ۸. تولید تصاویر inline (تا ۳ تصویر) ───
  let inlineCount = 0;
  if (!opts.onlyText) {
    // پیدا کردن placeholderها (regex tolerant — دفاعی، مثل generateArticle)
    const placeholderRegex = /!\[([^\]]*)\]\(\s*IMAGE[_ ]?PLACEHOLDER[_ ]?(\d+)\s*\)/gi;
    const placeholders: { alt: string; index: number; fullMatch: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(articleContent)) !== null) {
      placeholders.push({
        alt: match[1],
        index: parseInt(match[2], 10),
        fullMatch: match[0],
      });
    }

    // پرامپت‌های inline از پلن سئو (در DB گاهی string JSON است، گاهی آرایه)
    const inlinePrompts = parseInlinePrompts(seoPlan?.inlineImagePrompts);
    const maxInlineImages = 3;

    for (let i = 0; i < Math.min(placeholders.length, maxInlineImages); i++) {
      const ph = placeholders[i];
      const prompt =
        inlinePrompts[i] ||
        `Photorealistic fitness photo showing: ${ph.alt || keyword}, natural bright daylight, gym or athletic setting, realistic human body in natural exercise pose, proper anatomy, correct proportions, photorealistic, high quality, sharp focus, no text, no watermark, no weird anatomy, no extra limbs, no distorted faces, magazine editorial style`;
      try {
        logR(`🖼 تولید تصویر داخل متن ${i + 1}/${Math.min(placeholders.length, maxInlineImages)}...`);
        const img = await generateImage({
          prompt,
          aspectRatio: "16:9" as AspectRatio,
          timeoutMs: 120000,
        });
        const processed = await processAndSaveInlineImage({
          buffer: img.buffer,
          articleSlug: article.slug,
          descriptiveName: ph.alt.slice(0, 40),
          index: ph.index,
        });
        articleContent = articleContent.replace(ph.fullMatch, `![${ph.alt}](${processed.url})`);
        inlineCount++;
        logR(`✅ تصویر داخل متن ${i + 1} جایگزین شد: ${processed.url}`);
      } catch (e: any) {
        // graceful: placeholder شکست‌خورده حذف می‌شود + note
        logR(`⚠️ تولید تصویر داخل متن ${i + 1} شکست خورد (${e?.message || e}) — placeholder حذف شد.`);
        articleContent = articleContent.replace(ph.fullMatch, "");
      }
    }

    // حذف placeholderهای باقی‌مانده (فقط متن خالی نگذاریم)
    articleContent = articleContent.replace(
      /!\[[^\]]*\]\(\s*IMAGE[_ ]?PLACEHOLDER[_ ]?\d+\s*\)/gi,
      ""
    );

    // حذف inline تکراری / inline هم‌URL با کاور (همان ممیزی generateArticle)
    {
      const inlineRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const inlineMatches: { alt: string; url: string; fullMatch: string }[] = [];
      let im: RegExpExecArray | null;
      while ((im = inlineRegex.exec(articleContent)) !== null) {
        if (im[2].startsWith("http") || im[2].includes("IMAGE_PLACEHOLDER")) continue;
        inlineMatches.push({ alt: im[1], url: im[2], fullMatch: im[0] });
      }
      const seenInlineUrls = new Set<string>();
      for (const im of inlineMatches) {
        if (coverUrl && im.url === coverUrl) {
          articleContent = articleContent.replace(im.fullMatch, "");
          continue;
        }
        if (seenInlineUrls.has(im.url)) {
          articleContent = articleContent.replace(im.fullMatch, "");
          continue;
        }
        seenInlineUrls.add(im.url);
      }
    }

    // نهایی: بعد از جایگزینی/حذف‌ها دوباره مطمئن شو دو تصویر پشت هم نیستند
    articleContent = separateConsecutiveImages(articleContent);
    logR(`🖼 پردازش تصاویر inline تمام شد — ${inlineCount} تصویر داخل متن تولید شد.`);
  } else {
    logR("ℹ حالت فقط-متن — تصاویر قدیمی داخل متن دست‌نخورده ماندند.");
  }

  // ─── ۹. تولید فیلدهای سئو (همان الگوی generateArticle — callLlm 500 توکن) ───
  const seoSystem = `تو متخصص سئو هستی. فیلدهای سئو برای یک مقاله ورزشی/تغذیه فارسی تولید کن. فقط JSON.
مهم: همه فیلدها باید فارسی و حاوی کلمه کلیدی اصلی یا ثانویه باشند.
seoTitle باید ترغیب‌کننده و قابل کلیک باشد (CTR بالا) و حداکثر ۶۰ کاراکتر باشد.
seoDescription باید در سرچ نتایج گوگل جذاب به‌نظر برسد و حداکثر ۱۶۰ کاراکتر باشد.
metaKeywords باید ۵ تا ۸ کلمه کلیدی مرتبط (با کاما جدا شود) باشد.
مهم: این مقاله بازنویسی کامل شده و عنوانش تغییری نکرده — seoTitle می‌تواند کمی متفاوت و جذاب‌تر از عنوان اصلی باشد ولی باید به همان موضوع بپردازد.`;
  const seoUser = `برای مقاله زیر فیلدهای سئو بنویس:
عنوان: ${article.title}
کلمه کلیدی اصلی: ${keyword}
کلمات کلیدی ثانویه: ${secondaryKeywords.join("، ") || "—"}
خلاصه: ${article.excerpt}

JSON:
{
  "seoTitle": "عنوان سئو حداکثر ۶۰ کاراکتر (شامل کلمه کلیدی)",
  "seoDescription": "توضیحات متا حداکثر ۱۶۰ کاراکتر (شامل کلمه کلیدی، ترغیب‌کننده)",
  "metaKeywords": "کلمه۱, کلمه۲, کلمه۳, کلمه۴, کلمه۵"
}`;

  let seo = { seoTitle: "", seoDescription: "", metaKeywords: "" };
  try {
    const seoContent = await callLlm(seoSystem, seoUser, 500);
    const parsed = extractJson(seoContent);
    if (parsed) seo = { ...seo, ...parsed };
  } catch {
    // فال‌بک: مقادیر فعلی مقاله حفظ می‌شوند (پایین‌تر)
    logR("⚠️ تولید فیلدهای سئو شکست خورد — مقادیر سئوی قبلی مقاله حفظ می‌شود.");
  }

  // اعمال محدودیت‌های سخت + فال‌بک‌ها
  // seoTitle: تولیدشده ← مقدار قبلی مقاله ← عنوان مقاله
  const finalSeoTitle = (seo.seoTitle?.trim() || article.seoTitle || article.title).slice(0, 60);
  // seoDescription: تولیدشده ← مقدار قبلی مقاله ← خلاصهٔ مقاله
  const finalSeoDescription = (
    seo.seoDescription?.trim() || article.seoDescription || article.excerpt || ""
  ).slice(0, 160);
  // metaKeywords: تولیدشده ← keyword + کلمات ثانویه — حداکثر ۸ مورد بدون تکرار
  const rawMetaKeywords = seo.metaKeywords?.trim() || [keyword, ...secondaryKeywords].join(", ");
  const seenKw = new Set<string>();
  const dedupKw: string[] = [];
  for (const k of rawMetaKeywords.split(",")) {
    const trimmed = k.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seenKw.has(lower)) {
      seenKw.add(lower);
      dedupKw.push(trimmed);
    }
  }
  const finalMetaKeywords = dedupKw.slice(0, 8).join(", ");

  // ─── فال‌بک FAQ (برای FAQPage JSON-LD در article-page) ───
  // همان الگوی generateArticle: اگر مدل بخش FAQ ننوشته بود، یکی اضافه می‌کنیم
  if (!/##\s+سوالات\s+متداول|##\s+پرسش.*متداول|##\s+FAQ/i.test(articleContent)) {
    const faqSection = `

## سوالات متداول

### ${keyword} چیست؟

${keyword} یکی از مفاهیم کلیدی در مسیر تناسب اندام و سلامتی است. در این مقاله به‌طور کامل توضیح دادیم که چرا برای رسیدن به هدف ورزشی شما اهمیت دارد و چطور می‌توانید آن را به‌درستی پیاده کنید.

### چطور می‌توانم ${keyword} را در برنامه تمرینی خود بگنجانم؟

با استفاده از اصولی که در این مقاله توضیح دادیم و با کمک مربی هوشمند فیتاپ، می‌توانید ${keyword} را به‌صورت شخصی‌سازی‌شده در برنامه خود داشته باشید. کافیست برنامه اختصاصی فیتاپ را تهیه کنید.

### آیا ${keyword} برای مبتدی‌ها مناسب است؟

بله — با رعایت نکات ایمنی و شروع تدریجی، ${keyword} برای ورزشکاران مبتدی هم مناسب است. توصیه می‌کنیم قبل از شروع، با مربی هوشمند فیتاپ مشورت کنید تا برنامه‌ای متناسب با سطح شما طراحی شود.
`;
    articleContent = articleContent.trimEnd() + "\n" + faqSection;
    logR("📋 بخش FAQ به مقاله اضافه شد (برای FAQPage JSON-LD).");
  }

  // ─── ۱۰. شمارش کلمات نهایی + زمان مطالعه ───
  const wordCount = articleContent.trim().split(/\s+/).length;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200));

  // ─── ۱۱. ذخیرهٔ نسخهٔ قبلی مقاله به‌عنوان Revision (قبل از هر overwrite) ───
  // اگر این ذخیره شکست بخورد، بازنویسی هم انجام نمی‌شود — محتوای قبلی هرگز
  // بدون پشتیبان از بین نمی‌رود (همان سیاست content-refresh).
  let revisionId: string | null = null;
  try {
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
    revisionId = revision.id;
    logR("💾 نسخهٔ قبلی مقاله به‌عنوان revision پشتیبان ذخیره شد.");
  } catch (e: any) {
    const msg = `خطا در ذخیرهٔ revision پشتیبان — بازنویسی انجام نشد: ${e?.message || e}`;
    logR(`❌ ${msg}`);
    return {
      ok: false,
      slug: article.slug,
      wordCount,
      coverUrl,
      inlineCount,
      revisionId: null,
      notes,
    };
  }

  // ─── ۱۲. به‌روزرسانی درجای مقاله — همان id/slug ───
  // ⚠️ عمداً دست‌نخورده: slug، status، publishedAt، views، authorId،
  //    category، tags، canonicalUrl (همان URL قبلی می‌ماند)، excerpt
  //    (خلاصهٔ فعلی توسط ادمین بازبینی شده و بازتولیدش ریسک ناهماهنگی دارد).
  try {
    await db.article.update({
      where: { id: article.id },
      data: {
        content: articleContent,
        coverImage: coverUrl,
        // ogImage = کاور (فقط وقتی کاور جدید آمد عوض می‌شود؛ در حالت فقط-متن
        // coverUrl همان کاور قبلی است پس ogImage هم عملاً ثابت می‌ماند)
        ogImage: coverUrl,
        seoTitle: finalSeoTitle,
        seoDescription: finalSeoDescription,
        metaKeywords: finalMetaKeywords,
        readingMinutes,
      },
    });
  } catch (e: any) {
    // ⚠️ اینجا revision ذخیره شده ولی update شکست خورده — مقاله سالم است
    // (چون update اتمیک شکست خورده) و پشتیبان هم داریم؛ خطا را گزارش کن.
    const msg = `خطا در ذخیرهٔ مقالهٔ بازنویسی‌شده: ${e?.message || e}`;
    logR(`❌ ${msg} — نسخهٔ قبلی در revision (id: ${revisionId}) قابل بازیابی است.`);
    return {
      ok: false,
      slug: article.slug,
      wordCount,
      coverUrl,
      inlineCount,
      revisionId,
      notes,
    };
  }

  // ─── ۱۳. پینگ IndexNow (fire-and-forget — هیچ خطایی جریان را متوقف نمی‌کند) ───
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir").replace(/\/$/, "");
  try {
    submitToIndexNow([`${siteUrl}/article/${encodeURIComponent(article.slug)}`]).catch(() => {});
  } catch {}

  logR(
    `✅ ریجنریت کامل شد: ${wordCount} کلمه، ${inlineCount} تصویر داخل متن، کاور ${coverUrl ? "جدید/موجود" : "ندارد"} — URL و وضعیت انتشار مقاله بدون تغییر ماند.`
  );

  // ─── ۱۴. نتیجه ───
  return {
    ok: true,
    slug: article.slug,
    wordCount,
    coverUrl,
    inlineCount,
    revisionId,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helperهای محلی post-processing — کپی از seo-agent (عمداً export نمی‌شوند تا
// ایجنت تولید مقاله دست‌نخورده بماند؛ تکرار در اینجا پذیرفتنی است).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * درج فال‌بک جای‌نگهدار تصویر — کپی insertFallbackInlinePlaceholder از seo-agent.
 * جای درج: اولین هدینگ بعد از کاراکتر ~۱۵۰۰ (تقریباً بعد از بخش دوم H2)،
 * سپس سومین هدینگ، و در نهایت انتهای مقاله.
 */
function insertFallbackInlinePlaceholder(content: string, keyword: string): string {
  const placeholder = `![${keyword} — تصویر آموزشی](IMAGE_PLACEHOLDER_1)`;

  // هدینگ‌های H2/H3 مقاله (اندیس هر کدام به «\n» قبل از ## اشاره دارد)
  const headingRegex = /\n#{2,3}\s/g;
  const headings: number[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headingRegex.exec(content)) !== null) {
    headings.push(hm.index);
  }

  // ۱) اولین هدینگ بعد از کاراکتر ~۱۵۰۰ (تقریباً پایان بخش دوم H2)
  const late = headings.find((p) => p >= 1500);
  if (late !== undefined) {
    return (
      content.slice(0, late).trimEnd() +
      "\n\n" +
      placeholder +
      "\n\n" +
      content.slice(late).trimStart()
    );
  }

  // ۲) سومین هدینگ (مقاله‌ای که بخش‌های کوتاهی دارد)
  if (headings.length >= 3) {
    const t = headings[2];
    return (
      content.slice(0, t).trimEnd() +
      "\n\n" +
      placeholder +
      "\n\n" +
      content.slice(t).trimStart()
    );
  }

  // ۳) فال‌بک نهایی: انتهای مقاله
  return content.trimEnd() + "\n\n" + placeholder + "\n";
}

/**
 * درج پاراگراف انتقالی بین تصاویر متوالی — کپی از generateArticle.
 * حلقه تا وقتی تکرار می‌شود که دیگر هیچ جفت تصویر متوالی‌ای نماند (تا ۱۰ بار).
 */
function separateConsecutiveImages(content: string): string {
  let result = content;
  let iterations = 0;
  while (iterations < 10) {
    const next = result.replace(
      /(!\[[^\]]*\]\([^\)]+\))[\s\n]+(!\[[^\]]*\]\([^\)]+\))/g,
      "$1\n\nبرای درک بهتر، تصویر زیر نکات کلیدی را نشان می‌دهد:\n\n$2"
    );
    if (next === result) break;
    result = next;
    iterations++;
  }
  return result;
}

/**
 * پارس پرامپت‌های inline از پلن سئو — در DB مقدار رشتهٔ JSON است ولی ممکن است
 * به هر دلیلی آرایه هم باشد؛ هر دو حالت پوشش داده می‌شود (الگوی rebuild-images).
 */
function parseInlinePrompts(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    return [];
  } catch {
    return [];
  }
}
