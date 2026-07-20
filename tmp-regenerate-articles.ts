/**
 * Regenerate 2 empty articles with full content + cover image + inline image.
 * Articles:
 *   1. beginner-3day-program — "برنامه تمرینی ۳ روزه برای مبتدیان"
 *   2. fat-loss-tips — "۵ نکته طلایی برای کاهش چربی شکم"
 *
 * Each article:
 *   - Generate full 1800+ word Persian content via AvalAI text model
 *   - Generate cover image via AvalAI image model (gemini-3.1-flash-lite-image)
 *   - Process image to 3 sizes (cover/thumb/full) as WebP
 *   - Generate 1 inline image and process it
 *   - Update DB with content, cover image, SEO fields, reading time
 *
 * Run: bun tmp-regenerate-articles.ts
 */
import { db } from "./src/lib/db";
import { avalaiClient, TEXT_MODEL } from "./src/lib/fitness/ai";
import { generateImage, type AspectRatio } from "./src/lib/fitness/avalai-image";
import {
  processAndSaveArticleImage,
  processAndSaveInlineImage,
} from "./src/lib/fitness/image-processing";

interface ArticleSpec {
  slug: string;
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  category: string;
  excerpt: string;
  coverPrompt: string;
  inlinePrompt: string;
  contentStructure: string;
}

const ARTICLES: ArticleSpec[] = [
  {
    slug: "beginner-3day-program",
    title: "برنامه تمرینی ۳ روزه برای مبتدیان: راهنمای کامل شروع بدنسازی",
    primaryKeyword: "برنامه تمرینی ۳ روزه مبتدیان",
    secondaryKeywords: [
      "برنامه بدنسازی مبتدی",
      "تمرین ۳ روز در هفته",
      "شروع بدنسازی",
      "برنامه push pull legs",
      "تمرین تمام بدن",
    ],
    category: "training",
    excerpt:
      "برنامه تمرینی ۳ روزه کامل برای مبتدیان بدنسازی — شامل روز بالاتنه (Push)، پایین‌تنه (Legs) و پشت‌تنه (Pull) با جدول هفتگی، نکات تغذیه و اشتباهات رایج.",
    coverPrompt:
      "Professional fitness photograph of a young beginner athlete in a modern gym, demonstrating a dumbbell exercise, natural lighting, photorealistic, athletic, motivational, no text, no watermark, 16:9 aspect ratio",
    inlinePrompt:
      "Photorealistic image of a person performing a barbell squat with proper form in a clean modern gym, side view, professional lighting, athletic, fitness, no text, no watermark",
    contentStructure: `ساختار مقاله:
- H1: برنامه تمرینی ۳ روزه برای مبتدیان: راهنمای کامل شروع بدنسازی
- مقدمه (چرا ۳ روز برای مبتدیان مناسب است)
- H2: چرا برنامه ۳ روزه برای مبتدیان مناسب است؟
- H2: اصول اولیه قبل از شروع تمرین
- H2: برنامه تمرینی ۳ روزه کامل
  - H3: روز ۱ - بالاتنه (Push)
  - H3: روز ۲ - پایین‌تنه (Legs)
  - H3: روز ۳ - پشت‌تنه (Pull)
  - جدول برنامه هفتگی (Markdown table)
- H2: نکات تغذیه برای مبتدیان
- H2: اشتباهات رایج مبتدیان
- H2: سوالات متداول
  - H3: سوال ۱ — چند بار در هفته باید تمرین کنم؟
  - H3: سوال ۲ — آیا برای شروع به مکمل نیاز دارم؟
  - H3: سوال ۳ — چقدر طول می‌کشد نتیجه ببینم؟
  - H3: سوال ۴ — اگر یک روز تمرین را جا انداختم چه کنم؟
- H2: نتیجه‌گیری`,
  },
  {
    slug: "fat-loss-tips",
    title: "۵ نکته طلایی برای کاهش چربی شکم: راهنمای علمی و عملی",
    primaryKeyword: "کاهش چربی شکم",
    secondaryKeywords: [
      "چربی‌سوزی شکم",
      "کاهش وزن موضعی",
      "تمرین هوازی",
      "نقص کالری",
      "تغذیه کاهش وزن",
    ],
    category: "nutrition",
    excerpt:
      "۵ نکته علمی و عملی برای کاهش چربی شکم — شامل نقص کالری، تمرینات هوازی و HIIT، تقویت Core، تغذیه مناسب و اهمیت خواب. همراه با جدول غذاهای مفید و مضر.",
    coverPrompt:
      "Professional fitness photograph of a fit athletic person with toned midsection, in a modern gym setting, motivational, natural lighting, photorealistic, no text, no watermark, 16:9 aspect ratio",
    inlinePrompt:
      "Photorealistic image of healthy fat-burning foods arranged on a wooden table — salmon, avocado, vegetables, eggs, nuts — bright natural lighting, top view, fitness nutrition, no text, no watermark",
    contentStructure: `ساختار مقاله:
- H1: ۵ نکته طلایی برای کاهش چربی شکم: راهنمای علمی و عملی
- مقدمه (چرا چربی شکم خطرناک است و چرا کاهش آن مهم است)
- H2: نکته ۱: ایجاد نقص کالری (Calorie Deficit)
- H2: نکته ۲: تمرینات هوازی و HIIT
- H2: نکته ۳: تقویت عضلات مرکزی (Core)
- H2: نکته ۴: تغذیه مناسب و کاهش قند
- H2: نکته ۵: خواب کافی و مدیریت استرس
- H2: جدول غذاهای مفید و مضر برای چربی شکم (Markdown table)
- H2: سوالات متداول
  - H3: سوال ۱ — آیا کاهش چربی موضعی ممکن است؟
  - H3: سوال ۲ — چقدر طول می‌کشد چربی شکم کاهش یابد؟
  - H3: سوال ۳ — آیا فقط با ورزش شکم می‌توان چربی سوزاند؟
  - H3: سوال ۴ — بهترین تمرین برای چربی‌سوزی شکم چیست؟
- H2: نتیجه‌گیری`,
  },
];

async function callLlm(system: string, user: string, maxTokens = 8000): Promise<string> {
  const completion = await avalaiClient.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
  } as any);
  return completion.choices[0]?.message?.content || "";
}

function extractJson(content: string): any | null {
  if (!content) return null;
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlock ? codeBlock[1].trim() : content.trim();
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === "{") depth++;
    else if (candidate[i] === "}") {
      depth--;
      if (depth === 0) {
        const jsonStr = candidate.slice(start, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch {
          try {
            return JSON.parse(
              jsonStr
                .replace(/,\s*}/g, "}")
                .replace(/,\s*]/g, "]")
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2018\u2019]/g, "'")
            );
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

// Post-process AI-generated content to fix common issues
function postProcess(content: string): string {
  // Strip code fences
  let out = content.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // Clean "h1/h2/h3/H1/H2/H3" literal text from headings
  out = out.replace(/^(#{1,6})\s*[hH][1-6][:：\-\s]+/gm, "$1 ");
  // Fix broken link patterns
  out = out.replace(/\/article\/\//g, "/");
  out = out.replace(/\]\(\/article\/([^)]+)\)/g, (match, rest: string) => {
    if (rest.includes("?")) {
      const [slug, query] = rest.split("?");
      return `](/?article=${slug}&${query})`;
    }
    return `](/?article=${rest})`;
  });
  out = out.replace(/\]\(\/blog\)/g, "](/?screen=articles)");
  out = out.replace(/(^|[\s(])\/blog(?=[\s)]|$)/g, "$1/?screen=articles");
  // Insert paragraph between consecutive images
  let iterations = 0;
  while (iterations < 10) {
    const next = out.replace(
      /(!\[[^\]]*\]\([^\)]+\))[\s\n]+(!\[[^\]]*\]\([^\)]+\))/g,
      "$1\n\nبرای درک بهتر، تصویر زیر نکات کلیدی را نشان می‌دهد:\n\n$2"
    );
    if (next === out) break;
    out = next;
    iterations++;
  }
  return out;
}

async function generateArticleContent(spec: ArticleSpec, existingArticles: { slug: string; title: string }[]): Promise<string> {
  const contentSystem = `تو یک نویسنده حرفه‌ای محتوای ورزشی و تغذیه فارسی هستی. مقالات تو:
- حداقل ۱۸۰۰ کلمه هستند
- کاملاً سئوشده هستند (کلمه کلیدی اصلی در H1، پاراگراف اول، چند بار در متن، و در نتیجه‌گیری)
- ساختار حرفه‌ای دارند: H1، چند H2، چند H3، لیست‌ها، نقل‌قول‌های برجسته
- علمی، دقیق و کاربردی هستند (نه کلی‌گویی)
- لحن حرفه‌ای اما قابل فهم دارند
- شامل ایموجی‌های مرتبط برای خوانایی بهتر
- با فرمت Markdown هستند
- شامل حداقل ۲ جای‌نگهدار تصویر با فرمت ![توضیح فارسی تصویر](IMAGE_PLACEHOLDER_1) و ![توضیح فارسی تصویر](IMAGE_PLACEHOLDER_2)
- شامل جدول مقایسه‌ای (Markdown table) حداقل در یک بخش
- شامل سؤالات متداول (FAQ) با ساختار H3 در انتها
- شامل نتیجه‌گیری انگیزشی

قوانین بسیار مهم (حتماً رعایت کن):
- هر مقاله حتماً باید یک H1 در ابتدا داشته باشد (عنوان مقاله).
- هیچ‌گاه دو تصویر را پشت سر هم قرار نده — همیشه حداقل یک پاراگراف متن بین دو تصویر باشد.
- هیچ‌گاه کلمات h1, h2, h3, H1, H2, H3 را به‌عنوان متن در heading‌ها ننویس.
- از جدول Markdown (table) برای مقایسه‌ها و داده‌های ساختاریافته استفاده کن — حداقل یک جدول در هر مقاله.

قوانین مهم لینک‌های داخلی (بسیار مهم):
لینک‌های داخلی فقط با این فرمت‌ها مجاز هستند:
۱. لینک به صفحه اصلی: [متن](/)
۲. لینک به ابزارها: [متن](/?tool=tdee) یا [متن](/?tool=exercises) یا [متن](/?tool=foods)
۳. لینک به مقاله دیگر: [متن](/?article=slug) — slug را از لیست مقالات موجود انتخاب کن
۴. لینک به لیست مقالات: [متن](/?screen=articles)
هیچ‌گاه از فرمت /article/slug استفاده نکن — این کار نمی‌کند. همیشه /?article=slug استفاده کن.
هیچ‌گاه از /blog استفاده نکن — این مسیر وجود ندارد. از /?screen=articles استفاده کن.`;

  const contentUser = `یک مقاله کامل بنویس با مشخصات زیر:

عنوان: ${spec.title}
کلمه کلیدی اصلی: ${spec.primaryKeyword}
کلمات کلیدی ثانویه: ${spec.secondaryKeywords.join("، ")}
دسته: ${spec.category}
خلاصه: ${spec.excerpt}

${spec.contentStructure}

سایر مقالات موجود برای لینک‌سازی داخلی (با فرمت /?article=slug لینک بزن):
${existingArticles
  .filter((a) => a.slug !== spec.slug)
  .map((a) => `- slug="${a.slug}" title="${a.title}"`)
  .join("\n")}

ابزارهای موجود (با فرمت /?tool=... لینک بزن):
- /?tool=tdee — محاسبه‌گر کالری و TDEE
- /?tool=exercises — بانک حرکات ورزشی
- /?tool=foods — جدول کالری غذاها

یادآوری:
- حداقل ۱۸۰۰ کلمه بنویس.
- حداقل ۲ تصویر با IMAGE_PLACEHOLDER_1 و IMAGE_PLACEHOLDER_2 در متن قرار بده.
- حداقل ۱ جدول Markdown در متن قرار بده.
- حداقل ۳ لینک داخلی به مقالات/ابزارهای موجود قرار بده.
- از فرمت صحیح لینک‌ها استفاده کن.

فقط محتوای Markdown بنویس. بدون توضیح اضافه در ابتدا یا انتها.`;

  return await callLlm(contentSystem, contentUser, 8000);
}

async function generateSeoFields(spec: ArticleSpec): Promise<{ seoTitle: string; seoDescription: string; metaKeywords: string }> {
  const seoSystem = `تو متخصص سئو هستی. فیلدهای سئو برای یک مقاله ورزشی/تغذیه فارسی تولید کن. فقط JSON.`;
  const seoUser = `برای مقاله زیر فیلدهای سئو بنویس:
عنوان: ${spec.title}
کلمه کلیدی: ${spec.primaryKeyword}
خلاصه: ${spec.excerpt}

JSON:
{
  "seoTitle": "عنوان سئو حداکثر ۶۰ کاراکتر (شامل کلمه کلیدی)",
  "seoDescription": "توضیحات متا حداکثر ۱۶۰ کاراکتر (شامل کلمه کلیدی، ترغیب‌کننده)",
  "metaKeywords": "کلمه۱, کلمه۲, کلمه۳, کلمه۴, کلمه۵"
}`;

  let seo = { seoTitle: "", seoDescription: "", metaKeywords: "" };
  try {
    const content = await callLlm(seoSystem, seoUser, 500);
    const parsed = extractJson(content);
    if (parsed) seo = { ...seo, ...parsed };
  } catch {
    // keep defaults
  }
  if (!seo.seoTitle) seo.seoTitle = spec.title.slice(0, 60);
  if (!seo.seoDescription) seo.seoDescription = spec.excerpt.slice(0, 160);
  if (!seo.metaKeywords) seo.metaKeywords = [spec.primaryKeyword, ...spec.secondaryKeywords.slice(0, 4)].join(", ");
  return seo;
}

async function regenerateArticle(spec: ArticleSpec, existingArticles: { slug: string; title: string }[]): Promise<void> {
  console.log(`\n=== Regenerating: ${spec.slug} ===`);
  console.log(`Title: ${spec.title}`);

  // 1. Generate content
  console.log("📝 Generating content...");
  let content = await generateArticleContent(spec, existingArticles);
  content = postProcess(content);
  const wordCount = content.trim().split(/\s+/).length;
  console.log(`✓ Content generated: ${wordCount} words`);

  // 2. Generate cover image
  console.log("🖼 Generating cover image...");
  let coverUrl = "";
  try {
    const coverImg = await generateImage({
      prompt: spec.coverPrompt,
      aspectRatio: "16:9" as AspectRatio,
      timeoutMs: 120000,
    });
    const processed = await processAndSaveArticleImage({
      buffer: coverImg.buffer,
      articleSlug: spec.slug,
      descriptiveName: spec.primaryKeyword.replace(/\s+/g, "-").slice(0, 40),
    });
    coverUrl = processed.cover.url;
    console.log(`✓ Cover image: ${coverUrl} (${Math.round(processed.cover.bytes / 1024)}KB)`);
  } catch (e: any) {
    console.error(`✗ Cover image generation failed: ${e.message}`);
  }

  // 3. Generate inline image (replace first placeholder)
  console.log("🖼 Generating inline image...");
  const placeholderRegex = /!\[([^\]]*)\]\(IMAGE_PLACEHOLDER_(\d+)\)/g;
  const placeholders: { alt: string; index: number; fullMatch: string }[] = [];
  let match;
  while ((match = placeholderRegex.exec(content)) !== null) {
    placeholders.push({
      alt: match[1],
      index: parseInt(match[2], 10),
      fullMatch: match[0],
    });
  }
  if (placeholders.length > 0) {
    const ph = placeholders[0];
    try {
      const img = await generateImage({
        prompt: spec.inlinePrompt,
        aspectRatio: "16:9" as AspectRatio,
        timeoutMs: 120000,
      });
      const processed = await processAndSaveInlineImage({
        buffer: img.buffer,
        articleSlug: spec.slug,
        descriptiveName: ph.alt.slice(0, 40) || spec.primaryKeyword.replace(/\s+/g, "-").slice(0, 40),
        index: ph.index,
      });
      content = content.replace(ph.fullMatch, `![${ph.alt}](${processed.url})`);
      console.log(`✓ Inline image: ${processed.url} (${Math.round(processed.bytes / 1024)}KB)`);
    } catch (e: any) {
      console.error(`✗ Inline image generation failed: ${e.message}`);
      content = content.replace(ph.fullMatch, "");
    }
    // Remove remaining placeholders
    content = content.replace(/!\[[^\]]*\]\(IMAGE_PLACEHOLDER_\d+\)/g, "");
  }

  // 4. Generate SEO fields
  console.log("🔍 Generating SEO fields...");
  const seo = await generateSeoFields(spec);
  console.log(`✓ SEO title: ${seo.seoTitle}`);

  // 5. Compute reading time
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200));

  // 6. Update article in DB
  console.log("💾 Updating article in DB...");
  const updated = await db.article.update({
    where: { slug: spec.slug },
    data: {
      title: spec.title,
      excerpt: spec.excerpt,
      content,
      category: spec.category,
      tags: [spec.primaryKeyword, ...spec.secondaryKeywords].slice(0, 8).join(", "),
      coverImage: coverUrl,
      ogImage: coverUrl,
      seoTitle: seo.seoTitle,
      seoDescription: seo.seoDescription,
      metaKeywords: seo.metaKeywords,
      readingMinutes,
      updatedAt: new Date(),
    },
  });
  console.log(`✓ Article updated: ${updated.id}`);
  console.log(`  - Words: ${wordCount}`);
  console.log(`  - Reading time: ${readingMinutes} min`);
  console.log(`  - Cover: ${coverUrl || "(none)"}`);
  console.log(`  - Tags: ${updated.tags}`);
}

async function main() {
  console.log("=== Article Regeneration Script ===");
  console.log(`Articles to regenerate: ${ARTICLES.length}`);

  // Fetch existing articles for internal linking context
  const existingArticles = await db.article.findMany({
    where: { status: "published" },
    select: { slug: true, title: true },
  });
  console.log(`Found ${existingArticles.length} existing articles for internal linking context`);

  for (const spec of ARTICLES) {
    try {
      await regenerateArticle(spec, existingArticles);
    } catch (e: any) {
      console.error(`✗ Failed to regenerate ${spec.slug}: ${e.message}`);
    }
  }

  // Verify
  console.log("\n=== Verification ===");
  for (const spec of ARTICLES) {
    const a = await db.article.findUnique({
      where: { slug: spec.slug },
      select: { slug: true, title: true, content: true, coverImage: true, readingMinutes: true, seoTitle: true },
    });
    if (a) {
      const wordCount = a.content.trim().split(/\s+/).length;
      console.log(`\n${a.slug}:`);
      console.log(`  Title: ${a.title}`);
      console.log(`  Words: ${wordCount}`);
      console.log(`  Reading: ${a.readingMinutes} min`);
      console.log(`  Cover: ${a.coverImage ? "✓" : "✗"}`);
      console.log(`  SEO title: ${a.seoTitle}`);
      const hasInternalLinks = /\?\article=/.test(a.content) || /\?tool=/.test(a.content) || /\?screen=/.test(a.content);
      console.log(`  Has internal links: ${hasInternalLinks ? "✓" : "✗"}`);
      const hasTable = /\|.*\|/.test(a.content) && /---/.test(a.content);
      console.log(`  Has Markdown table: ${hasTable ? "✓" : "✗"}`);
      const hasH1 = /^#\s/.test(a.content.trim());
      console.log(`  Has H1: ${hasH1 ? "✓" : "✗"}`);
      const brokenDoubleSlash = (a.content.match(/\/article\/\//g) || []).length;
      const brokenBlog = (a.content.match(/\(\/blog\)/g) || []).length;
      const wrongArticle = (a.content.match(/\]\(\/article\/[^)]+\)/g) || []).length;
      console.log(`  Broken links: doubleSlash=${brokenDoubleSlash}, /blog=${brokenBlog}, /article/slug=${wrongArticle}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
