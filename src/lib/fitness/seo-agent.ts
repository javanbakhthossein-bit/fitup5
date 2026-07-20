/**
 * SEO Agent — Fully Automated, Self-Sustaining Agentic SEO System
 *
 * Pipeline:
 *  1. analyzeSite() — بررسی دقیق سایت: مقالات موجود، صفحات کلیدی، ساختار URL، کلمات کلیدی فعلی
 *  2. extractKeywords() — استخراج کلمات کلیدی متناسب با کسب‌وکار فیتاپ (با درنظرگرفتن کلمات موجود)
 *  3. generateStrategy() — نوشتن استراتژی جامع سئو: content pillars، کلاسترها، تقویم محتوا، نقشه لینک‌سازی
 *  4. planArticles() — برنامه‌ریزی N مقاله با عنوان، slug، کلمات کلیدی، لینک‌های داخلی، پرامپت تصویر
 *  5. generateArticle() — تولید محتوای کامل + تصاویر + انتشار
 *
 * Self-sustaining features:
 *  - استراتژی و نقشه سایت در DB ذخیره می‌شود
 *  - مقالات برنامه‌ریزی‌شده در صف (SeoArticlePlan) نگهداری می‌شوند
 *  - هر اجرا، قبل از تولید، سایت را دوباره تحلیل می‌کند تا لینک‌سازی همیشه به‌روز باشد
 *  - در صورت شکست تولید یک مقاله، بقیه مقالات ادامه می‌دهند
 *  - slug تکراری تولید نمی‌شود (چک در DB + plan)
 *  - تصاویر با نام SEO-friendly و در ۳ سایز (cover/thumb/full) ذخیره می‌شوند
 */
import { db } from "@/lib/db";
import { avalaiClient, getAvalaiClient, TEXT_MODEL } from "@/lib/fitness/ai";
import { generateImage, type AspectRatio } from "@/lib/fitness/avalai-image";
import {
  processAndSaveArticleImage,
  processAndSaveInlineImage,
} from "@/lib/fitness/image-processing";

// ─── Types ───
export interface SiteAnalysis {
  pages: { url: string; title: string; type: "landing" | "tool" | "list" }[];
  articles: {
    id: string;
    title: string;
    slug: string;
    category: string;
    tags: string;
    excerpt: string;
  }[];
  existingKeywords: string[];
  totalArticles: number;
  totalViews: number;
}

export interface SeoStrategyContent {
  brand: string;
  domain: string;
  market: string;
  contentPillars: { id: string; name: string; description: string }[];
  targetKeywords: {
    keyword: string;
    intent: "informational" | "transactional" | "navigational";
    difficulty: "low" | "medium" | "high";
    pillar: string;
  }[];
  clusters: { pillar: string; theme: string; keywords: string[] }[];
  contentCalendar: { week: number; topic: string; keyword: string }[];
  internalLinkMap: { from: string; to: string; anchor: string }[];
  competitiveNotes: string;
  sustainabilityPlan: string;
}

export interface ArticlePlan {
  id?: string;
  keyword: string;
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  pillar: string;
  secondaryKeywords: string[];
  internalLinks: { slug: string; title: string; anchor: string }[];
  coverImagePrompt: string;
  inlineImagePrompts: string[];
}

export interface RunProgress {
  level: "info" | "success" | "warn" | "error";
  msg: string;
  ts: number;
}

export interface RunContext {
  runId: string;
  mode: "full" | "continue" | "strategy_only";
  count: number;
  logs: RunProgress[];
  adminId: string;
  startedAt: number;
  successCount: number;
  failCount: number;
  articles: any[];
  errors: string[];
  /**
   * If true, generated articles are published immediately instead of being
   * scheduled for future publishing. Defaults to false (schedule articles).
   */
  publishImmediately?: boolean;
}

// ─── Logger helper ───
function log(
  ctx: RunContext,
  level: RunProgress["level"],
  msg: string
): void {
  const entry: RunProgress = { level, msg, ts: Date.now() };
  ctx.logs.push(entry);
  // Also print to server log for debugging
  const prefix =
    level === "error"
      ? "[SEO-AGENT:ERROR]"
      : level === "warn"
      ? "[SEO-AGENT:WARN]"
      : level === "success"
      ? "[SEO-AGENT:OK]"
      : "[SEO-AGENT]";
  console.log(`${prefix} ${msg}`);
  // Persist to DB every 5 logs or every 3 seconds — for live UI updates
  const now = Date.now();
  const lastPersist = (ctx as any)._lastPersist || 0;
  if (ctx.logs.length % 5 === 0 || now - lastPersist > 3000) {
    (ctx as any)._lastPersist = now;
    // fire-and-forget — don't block the agent
    db.seoAgentRun
      .update({
        where: { id: ctx.runId },
        data: {
          logs: JSON.stringify(ctx.logs.slice(-200)),
          successCount: ctx.successCount,
          failCount: ctx.failCount,
        },
      })
      .catch(() => null);
  }
}

// ─── JSON extraction helper ───
function extractJson(content: string): any | null {
  if (!content) return null;
  // Try code block first
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlock ? codeBlock[1].trim() : content.trim();
  // Find the first balanced { ... }
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
          // try to fix common issues
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

async function callLlm(system: string, user: string, maxTokens = 4000): Promise<string> {
  // timeout ۳ دقیقه — برای production که AI کندتر پاسخ می‌دهد
  const timeoutMs = 180000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // مهم: از avalaiClient (Proxy) استفاده می‌کنیم، نه getAvalaiClient() مستقیم.
    // Proxy به‌صورت خودکار پارامترهای مخصوص gemini-3.x را اضافه می‌کند
    // (thinkingConfig.thinkingLevel = "high" و انتقال max_tokens/temperature به generationConfig).
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      signal: controller.signal,
    } as any);
    return completion.choices[0]?.message?.content || "";
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error(`AI timeout after ${timeoutMs / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Step 1: Analyze site ───
export async function analyzeSite(ctx: RunContext): Promise<SiteAnalysis> {
  log(ctx, "info", "🔍 شروع تحلیل سایت — استخراج صفحات و مقالات موجود");
  // Static landing pages & tools (همیشه در سایت فیتاپ وجود دارند)
  // مهم: همه مسیرهای معتبر لینک داخلی در سایت فیتاپ. از این لیست برای لینک‌سازی استفاده کن.
  const pages = [
    { url: "/", title: "فیتاپ — مربی هوشمند بدنسازی و تغذیه", type: "landing" as const },
    { url: "/?screen=articles", title: "مقالات ورزشی و تغذیه فیتاپ", type: "list" as const },
    { url: "/?tool=tdee", title: "محاسبه‌گر کالری و TDEE", type: "tool" as const },
    { url: "/?tool=exercises", title: "بانک حرکات ورزشی", type: "tool" as const },
    { url: "/?tool=foods", title: "جدول کالری غذاها", type: "tool" as const },
    { url: "/?screen=auth", title: "ورود / ثبت‌نام فیتاپ", type: "landing" as const },
  ];

  const articles = await db.article.findMany({
    where: { status: "published" },
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
      tags: true,
      excerpt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Collect existing keywords from tags
  const existingKeywords = new Set<string>();
  for (const a of articles) {
    if (a.tags) {
      for (const t of a.tags.split(",").map((s) => s.trim()).filter(Boolean)) {
        existingKeywords.add(t);
      }
    }
  }

  const totalViewsAgg = await db.article.aggregate({
    where: { status: "published" },
    _sum: { views: true },
  });

  const result: SiteAnalysis = {
    pages,
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      category: a.category,
      tags: a.tags,
      excerpt: a.excerpt,
    })),
    existingKeywords: Array.from(existingKeywords),
    totalArticles: articles.length,
    totalViews: totalViewsAgg._sum.views || 0,
  };

  log(
    ctx,
    "success",
    `✅ تحلیل سایت کامل شد: ${result.pages.length} صفحه کلیدی، ${result.totalArticles} مقاله موجود، ${result.existingKeywords.length} کلمه کلیدی موجود، ${result.totalViews} بازدید کل`
  );
  return result;
}

// ─── Step 2 & 3: Generate strategy ───
export async function generateStrategy(
  ctx: RunContext,
  site: SiteAnalysis
): Promise<SeoStrategyContent> {
  log(ctx, "info", "🧠 شروع تولید استراتژی جامع سئو با هوش مصنوعی");

  const siteSummary = `
صفحات موجود در سایت:
${site.pages.map((p) => `- ${p.url} — ${p.title} (${p.type})`).join("\n")}

مقالات موجود (${site.totalArticles} مقاله):
${site.articles
  .slice(0, 30)
  .map((a, i) => `${i + 1}. "${a.title}" — slug: ${a.slug} — دسته: ${a.category}${a.tags ? ` — تگ‌ها: ${a.tags}` : ""}`)
  .join("\n")}

کلمات کلیدی موجود در سایت:
${site.existingKeywords.join("، ") || "(هیچ)"}
`.trim();

  const systemPrompt = `تو یک متخصص ارشد سئو (SEO Strategist) هستی که برای پلتفرم ایرانی فیتاپ (FitUp) کار می‌کنی.
فیتاپ یک پلتفرم هوشمند بدنسازی و تغذیه با هوش مصنوعی است که خدمات زیر را ارائه می‌دهد:
- ۴ پلن اشتراک: اقتصادی (۳۵۰هزار تومان/۴۵روز)، استاندارد (۸۰۰هزار)، پیشرفته (۱.۲ میلیون)، حرفه‌ای (۱.۸ میلیون)
- برنامه تمرینی هوشمند (شامل سوپرست و تری‌ست)
- برنامه غذایی شخصی‌سازی‌شده (با ترکیب و جایگزینی غذا)
- مکمل‌ها با دوز ایمن
- مربی هوشمند ۲۴ ساعته (چت)
- تحلیل عکس غذا، عکس بدن، ویدیو تمرین، آزمایش خون (۴۷ ماده)
- ۳ ابزار رایگان: محاسبه TDEE، بانک حرکات، جدول کالری غذاها
- سیستم معرفی دوست (۱۵۰هزار تومان پاداش برای هر دو نفر)
- مقالات ورزشی و تغذیه

بازار هدف: ایران، فارسی‌زبانان
دامنه: ${process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir"}

شما باید یک استراتژی سئوی جامع، حرفه‌ای و پایدار طراحی کنید که:
۱. کلمات کلیدی باارتفاع بالا و رقابت منطقی برای بازار ایران هدف‌گذاری کند
۲. بر اساس content pillars و topic clusters سازمان‌دهی شود
۳. نقشه لینک‌سازی داخلی دقیق بر اساس صفحات و مقالات موجود بسازد
۴. پایدار باشد — یعنی بعد از ۲ ماه هم کار کند و به‌روز باشد
۵. کلمات کلیدی موجود در سایت را گسترش دهد، نه تکرار کند

فقط و فقط با ساختار JSON زیر پاسخ بده. هیچ متن اضافه‌ای ننویس:
{
  "brand": "فیتاپ",
  "domain": process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir",
  "market": "ایران — فارسی",
  "contentPillars": [
    { "id": "training", "name": "تمرین و بدنسازی", "description": "..." },
    { "id": "nutrition", "name": "تغذیه و رژیم", "description": "..." },
    ...
  ],
  "targetKeywords": [
    { "keyword": "برنامه بدنسازی", "intent": "informational", "difficulty": "medium", "pillar": "training" },
    ...
  ],
  "clusters": [
    { "pillar": "training", "theme": "تمرینات قفسه سینه", "keywords": ["پرس سینه", "فلای سینه", "..."] },
    ...
  ],
  "contentCalendar": [
    { "week": 1, "topic": "...", "keyword": "..." },
    ...
  ],
  "internalLinkMap": [
    { "from": "new-article-slug", "to": "existing-article-slug-or-page-url", "anchor": "متن لینک" }
  ],
  "competitiveNotes": "نکات رقابتی و فرصت‌ها",
  "sustainabilityPlan": "برنامه پایداری — چگونه بعد از ۲ ماه هم کار کند"
}

مهم: حداقل ۸ content pillar، حداقل ۶۰ کلمه کلیدی هدف، حداقل ۲۰ کلاستر، حداقل ۲۴ هفته تقویم محتوا، حداقل ۲۰ لینک داخلی پیشنهادی.

موضوعاتی که حتماً باید پوشش داده شوند:
۱. مکمل‌های تخصصی (هر مکمل یک کلاستر جداگانه): کراتین مونوهیدرات، پروتئین وی، کازئین پروتئین، پروتئین ایزوله، گینر، BCAA، EAA، گلوتامین، آرژنین، سیترین، بتاآلانین، کافئین، ملاتونین، زینک، منیزیم، ویتامین D، B12، C، E، K، امگا ۳، فیش اویل، مولتی‌ویتامین، ZMA، ال-کارنیتین، تریبولوس، مک جا، اشواگاندا، گینسنگ، کلاژن، اسید هیالورونیک، MSM.
۱-ب) ویتامین‌ها به‌صورت تفکیک‌شده — هر ویتامین یک کلاستر جداگانه: ویتامین A، B1 (تیامین)، B2 (ریبوفلاوین)، B3 (نیاسین)، B5 (پانتوتنیک اسید)، B6 (پیریدوکسین)، B7 (بیوتین)، B9 (فولیک اسید)، B12 (کوبالامین)، C (اسید اسکوربیک)، D، E (توکوفرول)، K (کینون).
۱-ج) مکمل‌های گیاهی و آداپتوژن: جینسنگ قرمز کره‌ای، ماکا روت (پرویی)، اشواگاندا، تورین، شیلجیت (شیلاجیت)، تونکات علی، فنوگریک.
۱-د) مکمل‌های پیش‌تمرین (Pre-Workout): N.O. booster، آرژنین AKG (آلفا کتوگلوتارات)، سیترین مالات، کافئین، بتاآلانین.
۱-هـ) مکمل‌های ریکاوری: گلوتامین، کلاژن هیدرولیز شده، کراتین HCL (هیدروکلراید)، کراتین مونوهیدرات، امگا ۳، ZMA.
۲. استروئیدها و داروها (فقط جنبه آموزشی و هشدار — تشویق به بدنسازی طبیعی): تستوسترون انانتات، سیپیونات، پروپیونات، ناندولون، دکا دورابولین، ترنبالون، وینسترول، آناور، دیانابول، کلن بوترول، HGH، IGF-1، انسولین، PCT، کلومید، نولوادکس، آرمیدکس، پروویرون، HCG.
۲-ب) استروئیدهای بیشتر (فقط آموزشی): اکسی‌مثلون (آنادرول)، فلویوکسترون (هالوتستین)، مسترولون (پروویرون)، دروستانولون (مسترولون)، متندیلون، تورینابول، پارابولان.
۲-ج) SARMs (فقط آموزشی — هشدار): اوستارین (MK-2866)، لیناگولوتامید (Ligandrol)، رادارین (RAD-140)، آندارین (S4) — تأکید بر عوارض و قانونی نبودن.
۲-د) پروتکل‌های PCT (فقط آموزشی): کلومید + نولوادکس، HCG + آرمیدکس (آریمازول)، ترتیب مصرف، تایمینگ، دوز.
۳. حرکات تخصصی (هر حرکت یک کلاستر): پرس سینه، پرس بالاسینه، پرس زیرسینه، اسکوات، اسکوات جلو، ددلیفت، ددلیفت رومانیایی، لات پولدان، بارفیکس، پرس سرشانه، پرس نظامی، شنا، دیپ، لانگز، پرس پا، جلو ران، پشت ران، ساق پا، زیربغل قایقی، زیربغل دمبل، جلو بازو، پشت بازو، ساعد، کرانچ، پلانک، هایپراکستنشن، کشش، فوم رولر.
۳-ب) حرکات کلاژن و کور (Rotator Cuff / Prehab): face pull، external rotation (چرخش خارجی شانه)، internal rotation (چرخش داخلی شانه)، Y-Raise، T-Raise، روتاتور کاف.
۳-ج) حرکات کالیشتیک (Calisthenics): muscle up، front lever، back lever، human flag، planche، handstand، پارالترال.
۳-د) حرکات المپیکی (Olympic Lifts): clean and jerk، snatch، power clean، split jerk — تأکید بر تکنیک و ایمنی.
۴. روش‌های تمرینی: سوپرست، تری‌ست، جاینت‌ست، دراپ‌ست، رست پاز، فش با پول، تدریجی اضافه بار، RPE، RIR، volume training، intensity training، فرکانسی تمرین، دوره‌بندی خطی، دوره‌بندی موجی.
۴-ب) روش‌های تمرینی پیشرفته: German Volume Training (GVT)، 5/3/1 (Wendler)، Starting Strength، PPL (Push/Pull/Legs)، Upper/Lower، Bro Split، Blood Flow Restriction (BFR)، Compensatory Acceleration Training (CAT)، Pre-Exhaust، Post-Exhaust، Rest-Pause، Cluster Sets.
۵. تغذیه تخصصی: کالری مازاد، کالری نقصان، بولکینگ (تمیز و کثیف)، کاتینگ، رفلید، روز تقلب، سایکل کربوهیدرات، کتوژنیک، اینترمیتنت فاستینگ، پالئو، وگان بدنسازی، رژیم پروتئین بالا، رژیم کم کربوهیدرات، تایمینگ تغذیه، پری و پست ورک‌اوت.
۶. آنالیز و اندازه‌گیری: درصد چربی بدن، شاخص توده بدنی (BMI)، BMR، TDEE، متابولیسم پایه، اندازه‌گیری عضلات، پیشرفت ورزشی، رکورد شخصی، 1RM، تست استقامت، تست قدرت.
۷. مربیان و ورزشکاران بزرگ: هانی رامبد، هادی چوپان، کریس بامستد، رونال کلمن، جی کاتلر، فیل هیت، برنون رامبد، دکستر جکسون، مسابقات بدنسازی، المپیا، مستر المپیا.
۸. بیماری‌ها و مصدومیت‌های ورزشی: کمردرد ورزشی، آسیب شانه، کشیدگی عضله، التهاب تاندون، کف پای صافی، دیسک کمر، آسیب زانو، رباط صلیبی، تنگی نفس ورزشی، خستگی مزمن، overtraining، overreaching، ریکاوری ورزشی، استراحت فعال، روز استراحت.
۹. تعرفه و قیمت: تعرفه برنامه بدنسازی، قیمت برنامه بدنسازی، قیمت برنامه ورزشی، تعرفه برنامه تمرینی، قیمت برنامه تمرینی، تعرفه برنامه غذایی، هزینه برنامه بدنسازی، خرید برنامه بدنسازی، خرید برنامه ورزشی، قیمت برنامه بدنسازی آنلاین، تعرفه مربی بدنسازی.

⚠️ برای استروئیدها و SARMs فقط محتوای آموزشی و هشدار تولید کن — هرگز تشویق به مصرف نکن. هدف: آگاه‌سازی کاربران درباره عوارض و ترویج بدنسازی طبیعی.

مهم: در مقالات مربوط به تعرفه و قیمت، همیشه به صفحه پلن‌ها (/?screen=plans یا #pricing) لینک بده تا کاربر بتواند قیمت‌های به‌روز را ببیند. قیمت‌های عددی را در مقاله ننویس چون ممکن است تغییر کنند — به‌جای آن بنویس «برای مشاهده قیمت‌های به‌روز به صفحه پلن‌ها مراجعه کنید».`;

  const userPrompt = `سایت را تحلیل کن و استراتژی سئو بنویس:\n\n${siteSummary}`;

  let strategy: SeoStrategyContent | null = null;
  try {
    const content = await callLlm(systemPrompt, userPrompt, 8000);
    const parsed = extractJson(content);
    if (parsed) {
      strategy = parsed as SeoStrategyContent;
    }
  } catch (e: any) {
    log(ctx, "error", `خطا در تولید استراتژی: ${e.message}`);
  }

  if (!strategy) {
    // Fallback strategy — ensures sustainability even if AI fails
    log(ctx, "warn", "استفاده از استراتژی fallback (پیش‌فرض)");
    strategy = {
      brand: "فیتاپ",
      domain: process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir",
      market: "ایران — فارسی",
      contentPillars: [
        { id: "training", name: "تمرین و بدنسازی", description: "برنامه‌های تمرینی، حرکات، تکنیک‌ها، روش‌های تمرینی" },
        { id: "nutrition", name: "تغذیه و رژیم", description: "رژیم غذایی، درشت‌مغذی‌ها، کالری، بولکینگ، کاتینگ، رژیم‌های تخصصی" },
        { id: "supplement", name: "مکمل‌های ورزشی", description: "کراتین، پروتئین، ویتامین‌ها، آمینواسیدها، مکمل‌های طبیعی" },
        { id: "vitamins", name: "ویتامین‌ها و مواد معدنی (تفکیک‌شده)", description: "هر ویتامین به‌صورت جداگانه: A، B1-B12، C، D، E، K + منیزیم، زینک، کلسیم، آهن" },
        { id: "herbal", name: "مکمل‌های گیاهی و آداپتوژن", description: "جینسنگ قرمز، ماکا روت، اشواگاندا، تورین، شیلجیت، تونکات علی" },
        { id: "pre-workout", name: "مکمل‌های پیش‌تمرین", description: "N.O. booster، آرژنین AKG، سیترین مالات، کافئین، بتاآلانین" },
        { id: "recovery-supps", name: "مکمل‌های ریکاوری", description: "گلوتامین، کلاژن هیدرولیز شده، کراتین HCL، امگا ۳، ZMA" },
        { id: "exercises", name: "بانک حرکات تخصصی", description: "هر حرکت یک مقاله: پرس سینه، اسکوات، ددلیفت، بارفیکس و..." },
        { id: "calisthenics", name: "کالیشتیک و وزن بدن", description: "muscle up، front lever، back lever، human flag، planche، handstand" },
        { id: "olympic-lifts", name: "حرکات المپیکی", description: "clean and jerk، snatch، power clean — تکنیک و ایمنی" },
        { id: "prehab", name: "حرکات پیشگیرانه و روتاتور کاف", description: "face pull، external/internal rotation، Y/T-Raise — جلوگیری از آسیب شانه" },
        { id: "training-methods", name: "روش‌های تمرینی پیشرفته", description: "سوپرست، تری‌ست، GVT، 5/3/1، Starting Strength، PPL، BFR، Rest-Pause" },
        { id: "metrics", name: "آنالیز و اندازه‌گیری", description: "BMI، BMR، TDEE، درصد چربی بدن، 1RM، تست‌های قدرت و استقامت" },
        { id: "recovery", name: "بازیابی، استراحت و مصدومیت‌ها", description: "خواب، ریکاوری، جلوگیری از آسیب، درمان مصدومیت‌های ورزشی" },
        { id: "athletes", name: "مربیان و ورزشکاران بزرگ", description: "هادی چوپان، هانی رامبد، کریس بامستد، رونال کلمن، مستر المپیا" },
        { id: "steroids-education", name: "آموزش آگاه‌سازی استروئیدها و SARMs", description: "اطلاعات آموزشی درباره استروئیدها، SARMs، عوارض، PCT — فقط هشدار، نه تشویق" },
        { id: "motivation", name: "انگیزه و روان‌شناسی", description: "هدف‌گذاری، استمرار، روان‌شناسی ورزش" },
      ],
      targetKeywords: [
        // ─── تمرین و بدنسازی ───
        { keyword: "برنامه بدنسازی", intent: "informational", difficulty: "medium", pillar: "training" },
        { keyword: "برنامه غذایی کاهش وزن", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "تمرین پرس سینه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "اسکوات صحیح", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "کاهش چربی شکم", intent: "informational", difficulty: "high", pillar: "training" },
        { keyword: "افزایش عضله", intent: "informational", difficulty: "medium", pillar: "training" },
        { keyword: "برنامه عضله‌سازی", intent: "informational", difficulty: "medium", pillar: "training" },
        { keyword: "بادی بیلدینگ", intent: "informational", difficulty: "high", pillar: "training" },
        { keyword: "تناسب اندام", intent: "informational", difficulty: "high", pillar: "training" },
        // ─── مکمل‌ها ───
        { keyword: "کراتین چیست", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "پروتئین وی چیست", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "کراتین مونوهیدرات", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "پروتئین ایزوله", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "کازئین پروتئین", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "گینر وزن", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "BCAA چیست", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "EAA آمینو اسید", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "گلوتامین ورزشی", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "بتاآلانین", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "ویتامین D ورزشکاران", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "ZMA مکمل خواب", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "اشواگاندا ورزش", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "تریتین HCL", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "کلاژن مفاصل", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "ال-کارنیتین چربی سوز", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "مک جا تستوسترون", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "مولتی ویتامین ورزشی", intent: "informational", difficulty: "low", pillar: "supplement" },
        { keyword: "امگا ۳ ورزشکاران", intent: "informational", difficulty: "low", pillar: "supplement" },
        // ─── حرکات تخصصی ───
        { keyword: "آموزش پرس بالاسینه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "پرس زیرسینه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "اسکوات جلو", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "ددلیفت رومانیایی", intent: "informational", difficulty: "medium", pillar: "exercises" },
        { keyword: "ددلیفت صحیح", intent: "informational", difficulty: "medium", pillar: "exercises" },
        { keyword: "لات پولدان", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "بارفیکس آموزش", intent: "informational", difficulty: "medium", pillar: "exercises" },
        { keyword: "پرس سرشانه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "پرس نظامی", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "شنا سوئدی", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "دیپ سینه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "لانگز پا", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "پرس پا دستگاه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "جلو ران دستگاه", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "پشت ران پشت", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "ساق پا ایستاده", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "زیربغل قایقی", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "زیربغل دمبل", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "جلو بازو دمبل", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "پشت بازو سیم‌کش", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "ساعد بدنسازی", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "کرانچ شکم", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "پلانک کمری", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "هایپراکستنشن کمر", intent: "informational", difficulty: "low", pillar: "exercises" },
        { keyword: "فوم رولر ریکاوری", intent: "informational", difficulty: "low", pillar: "exercises" },
        // ─── روش‌های تمرینی ───
        { keyword: "سوپرست تمرین", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "تری‌ست بدنسازی", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "جاینت‌ست عضله", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "دراپ‌ست هایپرتروفی", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "رست پاز روش", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "فش با پول تمرین", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "تدریجی اضافه بار", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "RPE تمرین", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "RIR بدنسازی", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "دوره‌بندی موجی", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "دوره‌بندی خطی", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "فرکانسی تمرین عضله", intent: "informational", difficulty: "low", pillar: "training-methods" },
        // ─── تغذیه تخصصی ───
        { keyword: "بولکینگ تمیز", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "بولک کثیف", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "کاتینگ چربی سوزی", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "رفلید کربوهیدرات", intent: "informational", difficulty: "low", pillar: "nutrition" },
        { keyword: "روز تقلب رژیم", intent: "informational", difficulty: "low", pillar: "nutrition" },
        { keyword: "سایکل کربوهیدرات", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "رژیم کتوژنیک بدنسازی", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "اینترمیتنت فاستینگ", intent: "informational", difficulty: "low", pillar: "nutrition" },
        { keyword: "رژیم پالئو", intent: "informational", difficulty: "low", pillar: "nutrition" },
        { keyword: "وگان بدنسازی", intent: "informational", difficulty: "medium", pillar: "nutrition" },
        { keyword: "تغذیه قبل تمرین", intent: "informational", difficulty: "low", pillar: "nutrition" },
        { keyword: "تغذیه بعد تمرین", intent: "informational", difficulty: "low", pillar: "nutrition" },
        { keyword: "محاسبه BMR", intent: "informational", difficulty: "low", pillar: "metrics" },
        { keyword: "کالری روزانه", intent: "informational", difficulty: "low", pillar: "metrics" },
        { keyword: "محاسبه TDEE", intent: "informational", difficulty: "low", pillar: "metrics" },
        { keyword: "درصد چربی بدن", intent: "informational", difficulty: "low", pillar: "metrics" },
        { keyword: "شاخص توده بدنی BMI", intent: "informational", difficulty: "low", pillar: "metrics" },
        { keyword: "محاسبه 1RM", intent: "informational", difficulty: "low", pillar: "metrics" },
        // ─── بازیابی و مصدومیت ───
        { keyword: "خواب و ریکاوری عضله", intent: "informational", difficulty: "low", pillar: "recovery" },
        { keyword: "کمردرد ورزشی", intent: "informational", difficulty: "medium", pillar: "recovery" },
        { keyword: "آسیب شانه بدنسازی", intent: "informational", difficulty: "medium", pillar: "recovery" },
        { keyword: "کشیدگی عضله درمان", intent: "informational", difficulty: "low", pillar: "recovery" },
        { keyword: "التهاب تاندون ورزش", intent: "informational", difficulty: "low", pillar: "recovery" },
        { keyword: "دیسک کمر بدنسازی", intent: "informational", difficulty: "medium", pillar: "recovery" },
        { keyword: "آسیب زانو ورزشکار", intent: "informational", difficulty: "medium", pillar: "recovery" },
        { keyword: "رباط صلیبی آسیب", intent: "informational", difficulty: "medium", pillar: "recovery" },
        { keyword: "overtraining علائم", intent: "informational", difficulty: "low", pillar: "recovery" },
        { keyword: "استراحت فعال ریکاوری", intent: "informational", difficulty: "low", pillar: "recovery" },
        // ─── مربیان و ورزشکاران ───
        { keyword: "هادی چوپان زندگینامه", intent: "informational", difficulty: "low", pillar: "athletes" },
        { keyword: "هانی رامبد مربی", intent: "informational", difficulty: "low", pillar: "athletes" },
        { keyword: "کریس بامستد کلاسیک فیزیک", intent: "informational", difficulty: "low", pillar: "athletes" },
        { keyword: "رونال کلمن بدنساز", intent: "informational", difficulty: "low", pillar: "athletes" },
        { keyword: "جی کاتلر بدنسازی", intent: "informational", difficulty: "low", pillar: "athletes" },
        { keyword: "فیل هیت مستر المپیا", intent: "informational", difficulty: "low", pillar: "athletes" },
        { keyword: "مستر المپیا مسابقات", intent: "informational", difficulty: "low", pillar: "athletes" },
        // ─── استروئیدها (آموزشی) ───
        { keyword: "استروئید آنابولیک عوارض", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "تستوسترون انانتات آموزش", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "ناندولون دکا دورابولین", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "ترنبالون خطرات", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "وینسترول اطلاعات", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "دیانابول عوارض", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "HGH هورمون رشد انسانی", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "PCT درمان پس از دوره", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "کلومید نولوادکس", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "بدنسازی طبیعی بدون استروئید", intent: "informational", difficulty: "low", pillar: "steroids-education" },
        // ─── ویتامین‌ها به‌صورت تفکیک‌شده (Each Vitamin — Deep) ───
        { keyword: "ویتامین A ورزشکاران", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B1 تیامین", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B2 ریبوفلاوین", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B3 نیاسین", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B5 پانتوتنیک اسید", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B6 پیریدوکسین", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B7 بیوتین", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین B9 فولیک اسید", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین C اسید اسکوربیک", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین E توکوفرول", intent: "informational", difficulty: "low", pillar: "vitamins" },
        { keyword: "ویتامین K کینون", intent: "informational", difficulty: "low", pillar: "vitamins" },
        // ─── مکمل‌های گیاهی و آداپتوژن (Herbal — Deep) ───
        { keyword: "جینسنگ قرمز کره‌ای", intent: "informational", difficulty: "low", pillar: "herbal" },
        { keyword: "ماکا روت پرویی", intent: "informational", difficulty: "low", pillar: "herbal" },
        { keyword: "تورین مکمل", intent: "informational", difficulty: "low", pillar: "herbal" },
        { keyword: "شیلجیت شیلاجیت", intent: "informational", difficulty: "low", pillar: "herbal" },
        { keyword: "تونکات علی", intent: "informational", difficulty: "low", pillar: "herbal" },
        { keyword: "فنوگریک تستوسترون", intent: "informational", difficulty: "low", pillar: "herbal" },
        // ─── مکمل‌های پیش‌تمرین (Pre-Workout — Deep) ───
        { keyword: "N.O. booster نیتریک اکساید", intent: "informational", difficulty: "low", pillar: "pre-workout" },
        { keyword: "آرژنین AKG آلفا کتوگلوتارات", intent: "informational", difficulty: "low", pillar: "pre-workout" },
        { keyword: "سیترین مالات پمپ", intent: "informational", difficulty: "low", pillar: "pre-workout" },
        { keyword: "بهترین پیش تمرین", intent: "informational", difficulty: "medium", pillar: "pre-workout" },
        // ─── مکمل‌های ریکاوری (Recovery Supps — Deep) ───
        { keyword: "گلوتامین ریکاوری", intent: "informational", difficulty: "low", pillar: "recovery-supps" },
        { keyword: "کلاژن هیدرولیز شده", intent: "informational", difficulty: "low", pillar: "recovery-supps" },
        { keyword: "کراتین HCL هیدروکلراید", intent: "informational", difficulty: "low", pillar: "recovery-supps" },
        // ─── حرکات کلاژن و کور (Prehab/Rotator Cuff — Deep) ───
        { keyword: "face pull فیس پول", intent: "informational", difficulty: "low", pillar: "prehab" },
        { keyword: "external rotation چرخش خارجی شانه", intent: "informational", difficulty: "low", pillar: "prehab" },
        { keyword: "internal rotation چرخش داخلی شانه", intent: "informational", difficulty: "low", pillar: "prehab" },
        { keyword: "Y-Raise تمرین شانه", intent: "informational", difficulty: "low", pillar: "prehab" },
        { keyword: "T-Raise تمرین کتف", intent: "informational", difficulty: "low", pillar: "prehab" },
        { keyword: "rotator cuff روتاتور کاف", intent: "informational", difficulty: "medium", pillar: "prehab" },
        // ─── حرکات کالیشتیک (Calisthenics — Deep) ───
        { keyword: "muscle up ماسل آپ آموزش", intent: "informational", difficulty: "medium", pillar: "calisthenics" },
        { keyword: "front lever فرانت لور", intent: "informational", difficulty: "high", pillar: "calisthenics" },
        { keyword: "back lever بک لور", intent: "informational", difficulty: "high", pillar: "calisthenics" },
        { keyword: "human flag پرچم انسانی", intent: "informational", difficulty: "high", pillar: "calisthenics" },
        { keyword: "planche پلانش آموزش", intent: "informational", difficulty: "high", pillar: "calisthenics" },
        { keyword: "handstand هندستند", intent: "informational", difficulty: "medium", pillar: "calisthenics" },
        // ─── حرکات المپیکی (Olympic Lifts — Deep) ───
        { keyword: "clean and jerk کلین اند جِرک", intent: "informational", difficulty: "high", pillar: "olympic-lifts" },
        { keyword: "snatch اسنچ آموزش", intent: "informational", difficulty: "high", pillar: "olympic-lifts" },
        { keyword: "power clean پاور کلین", intent: "informational", difficulty: "medium", pillar: "olympic-lifts" },
        // ─── استروئیدهای بیشتر + SARMs + PCT (Steroids Deep) ───
        { keyword: "اکسی‌مثلون آنادرول", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "فلویوکسترون هالوتستین", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "دروستانولون مسترولون", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "متندیلون آموزش", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "اوستارین SARM", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "لیگاندرول SARM عوارض", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "رادارین RAD-140", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "آندارین S4 خطرات", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "پروتکل PCT کلومید نولوادکس", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        { keyword: "HCG و آرمیدکس PCT", intent: "informational", difficulty: "medium", pillar: "steroids-education" },
        // ─── روش‌های تمرینی پیشرفته (Training Methods — Deep) ───
        { keyword: "German Volume Training GVT", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "5/3/1 وندلر برنامه", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "Starting Strength برنامه", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "PPL Push Pull Legs", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "Upper/Lower اسپلیت", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "Bro Split بادی پارت", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "BFR Blood Flow Restriction", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "Compensatory Acceleration Training CAT", intent: "informational", difficulty: "medium", pillar: "training-methods" },
        { keyword: "Pre-Exhaust پیش تخلیه", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "Post-Exhaust پس تخلیه", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "Rest-Pause رست پاز", intent: "informational", difficulty: "low", pillar: "training-methods" },
        { keyword: "Cluster Sets کلاستر ست", intent: "informational", difficulty: "low", pillar: "training-methods" },
        // ─── انگیزه ───
        { keyword: "انگیزه ورزش", intent: "informational", difficulty: "low", pillar: "motivation" },
        { keyword: "هدف‌گذاری ورزشی", intent: "informational", difficulty: "low", pillar: "motivation" },
      ],
      clusters: [
        // ─── تمرین ───
        { pillar: "training", theme: "حرکات پایه بدنسازی", keywords: ["اسکوات", "ددلیفت", "پرس سینه", "پرس بالاسینه"] },
        { pillar: "training", theme: "تمرینات بازو", keywords: ["جلو بازو", "پشت بازو", "بازو با دمبل", "ساعد"] },
        { pillar: "training", theme: "تمرینات پا", keywords: ["اسکوات", "پرس پا", "جلو ران", "پشت ران", "ساق پا", "لانگز"] },
        { pillar: "training", theme: "تمرینات پشت", keywords: ["ددلیفت", "لات پولدان", "زیربغل قایقی", "زیربغل دمبل", "بارفیکس"] },
        { pillar: "training", theme: "تمرینات سرشانه", keywords: ["پرس سرشانه", "پرس نظامی", "نشر جانب", "نشر جلو"] },
        // ─── تغذیه ───
        { pillar: "nutrition", theme: "رژیم کاهش وزن", keywords: ["کالری دریافتی", "نقص کالری", "چربی‌سوزی", "کاتینگ"] },
        { pillar: "nutrition", theme: "رژیم عضله‌سازی", keywords: ["مازاد کالری", "پروتئین بالا", "کربو بالانس", "بولکینگ"] },
        { pillar: "nutrition", theme: "رژیم‌های تخصصی", keywords: ["کتوژنیک", "اینترمیتنت فاستینگ", "پالئو", "وگان بدنسازی", "سایکل کربوهیدرات"] },
        { pillar: "nutrition", theme: "تایمینگ تغذیه", keywords: ["پری ورک‌اوت", "پست ورک‌اوت", "تغذیه قبل تمرین", "تغذیه بعد تمرین", "رفلید"] },
        // ─── مکمل‌ها ───
        { pillar: "supplement", theme: "مکمل‌های پایه", keywords: ["کراتین", "پروتئین وی", "مولتی‌ویتامین", "امگا ۳"] },
        { pillar: "supplement", theme: "پروتئین‌ها", keywords: ["پروتئین ایزوله", "پروتئین کنسانتره", "کازئین پروتئین", "گینر"] },
        { pillar: "supplement", theme: "آمینواسیدها", keywords: ["BCAA", "EAA", "گلوتامین", "آرژنین", "سیترین"] },
        { pillar: "supplement", theme: "ویتامین‌ها و مواد معدنی", keywords: ["ویتامین D", "B12", "C", "E", "K", "زینک", "منیزیم", "کلسیم", "آهن"] },
        { pillar: "supplement", theme: "مکمل‌های طبیعی و گیاهی", keywords: ["اشواگاندا", "گینسنگ", "تریبولوس", "مک جا", "کلاژن"] },
        { pillar: "supplement", theme: "مکمل‌های تخصصی", keywords: ["بتاآلانین", "ZMA", "ال-کارنیتین", "اسید هیالورونیک", "MSM"] },
        // ─── حرکات تخصصی ───
        { pillar: "exercises", theme: "حرکات سینه", keywords: ["پرس سینه", "پرس بالاسینه", "پرس زیرسینه", "فلای سینه", "کراس‌اور"] },
        { pillar: "exercises", theme: "حرکات پا", keywords: ["اسکوات", "اسکوات جلو", "ددلیفت", "پرس پا", "لانگز", "جلو ران", "پشت ران", "ساق پا"] },
        { pillar: "exercises", theme: "حرکات پشت", keywords: ["ددلیفت رومانیایی", "لات پولدان", "بارفیکس", "زیربغل قایقی", "زیربغل دمبل"] },
        { pillar: "exercises", theme: "حرکات شانه", keywords: ["پرس سرشانه", "پرس نظامی", "نشر جانب دمبل", "نشر جلو"] },
        { pillar: "exercises", theme: "حرکات بازو", keywords: ["جلو بازو دمبل", "جلو بازو هالتر", "پشت بازو سیم‌کش", "پشت بازو دمبل", "ساعد"] },
        { pillar: "exercises", theme: "حرکات شکم و مرکز بدن", keywords: ["کرانچ", "پلانک", "نشستن چهارزانو", "هایپراکستنشن"] },
        { pillar: "exercises", theme: "حرکات بدنسازی با وزن بدن", keywords: ["شنا", "بارفیکس", "دیپ", "اسکوات با وزن بدن"] },
        { pillar: "exercises", theme: "ریکاوری و انعطاف", keywords: ["کشش", "فوم رولر", "حرکات انعطاف‌پذیری"] },
        // ─── روش‌های تمرینی ───
        { pillar: "training-methods", theme: "تکنیک‌های شدت", keywords: ["سوپرست", "تری‌ست", "جاینت‌ست", "دراپ‌ست", "رست پاز", "فش با پول"] },
        { pillar: "training-methods", theme: "اصول بارگذاری", keywords: ["تدریجی اضافه بار", "RPE", "RIR", "volume training", "intensity training"] },
        { pillar: "training-methods", theme: "دوره‌بندی تمرین", keywords: ["دوره‌بندی خطی", "دوره‌بندی موجی", "فرکانسی تمرین"] },
        // ─── آنالیز و اندازه‌گیری ───
        { pillar: "metrics", theme: "محاسبات بدنی", keywords: ["BMR", "TDEE", "BMI", "درصد چربی بدن", "متابولیسم پایه"] },
        { pillar: "metrics", theme: "تست‌های عملکردی", keywords: ["1RM", "رکورد شخصی", "تست استقامت", "تست قدرت", "پیشرفت ورزشی"] },
        // ─── ریکاوری و مصدومیت ───
        { pillar: "recovery", theme: "خواب و ریکاوری", keywords: ["خواب عمیق", "استراحت عضله", "ریکاوری فعال", "روز استراحت"] },
        { pillar: "recovery", theme: "مصدومیت‌های شایع", keywords: ["کمردرد ورزشی", "آسیب شانه", "کشیدگی عضله", "التهاب تاندون", "دیسک کمر", "آسیب زانو", "رباط صلیبی"] },
        { pillar: "recovery", theme: "استراحت و پیشگیری", keywords: ["overtraining", "overreaching", "استراحت فعال", "خستگی مزمن"] },
        // ─── مربیان و ورزشکاران ───
        { pillar: "athletes", theme: "قهرمانان ایرانی", keywords: ["هادی چوپان", "هانی رامبد", "برنون رامبد"] },
        { pillar: "athletes", theme: "قهرمانان جهانی", keywords: ["کریس بامستد", "رونال کلمن", "جی کاتلر", "فیل هیت", "دکستر جکسون"] },
        { pillar: "athletes", theme: "مسابقات بدنسازی", keywords: ["مستر المپیا", "المپیا", "مسابقات بدنسازی"] },
        // ─── استروئیدها (آموزشی) ───
        { pillar: "steroids-education", theme: "استروئیدهای آنابولیک", keywords: ["تستوسترون انانتات", "تستوسترون سیپیونات", "تستوسترون پروپیونات", "ناندولون", "دکا دورابولین", "ترنبالون", "وینسترول", "آناور", "دیانابول"] },
        { pillar: "steroids-education", theme: "هورمون‌ها و داروهای مرتبط", keywords: ["HGH", "IGF-1", "انسولین", "کلن بوترول"] },
        { pillar: "steroids-education", theme: "درمان پس از دوره (PCT)", keywords: ["PCT", "کلومید", "نولوادکس", "آرمیدکس", "پروویرون", "HCG", "آنتی استروژن"] },
        { pillar: "steroids-education", theme: "استروئیدهای پیشرفته (فقط آموزشی)", keywords: ["اکسی‌مثلون", "آنادرول", "فلویوکسترون", "هالوتستین", "مسترولون", "دروستانولون", "متندیلون", "تورینابول", "پارابولان"] },
        { pillar: "steroids-education", theme: "SARMs (فقط آموزشی — هشدار)", keywords: ["SARM", "SARMs", "اوستارین", "MK-2866", "لیناگولوتامید", "لیگاندرول", "رادارین", "RAD-140", "آندارین", "S4"] },
        { pillar: "steroids-education", theme: "پروتکل‌های PCT (فقط آموزشی)", keywords: ["پروتکل PCT", "کلومید و نولوادکس", "HCG و آرمیدکس", "تایمینگ PCT", "دوز PCT"] },
        { pillar: "steroids-education", theme: "بدنسازی طبیعی", keywords: ["بدنسازی طبیعی", "بدون استروئید", "جلوگیری از استروئید"] },
        // ─── ویتامین‌ها به‌صورت تفکیک‌شده (Each Vitamin) ───
        { pillar: "vitamins", theme: "ویتامین‌های گروه B", keywords: ["ویتامین B1", "تیامین", "ویتامین B2", "ریبوفلاوین", "ویتامین B3", "نیاسین", "ویتامین B5", "ویتامین B6", "پیریدوکسین", "ویتامین B7", "بیوتین", "ویتامین B9", "فولیک اسید", "ویتامین B12", "کوبالامین"] },
        { pillar: "vitamins", theme: "ویتامین‌های چرب‌محلول", keywords: ["ویتامین A", "ویتامین D", "ویتامین E", "توکوفرول", "ویتامین K", "کینون"] },
        { pillar: "vitamins", theme: "ویتامین C و آنتی‌اکسیدان‌ها", keywords: ["ویتامین C", "اسید اسکوربیک", "آنتی‌اکسیدان ورزشی"] },
        { pillar: "vitamins", theme: "مواد معدنی کلیدی", keywords: ["منیزیم", "زینک", "کلسیم", "آهن", "پتاسیم", "سلنیوم"] },
        // ─── مکمل‌های گیاهی و آداپتوژن ───
        { pillar: "herbal", theme: "آداپتوژن‌های کلاسیک", keywords: ["اشواگاندا", "آشواگاندا", "جینسنگ قرمز", "جینسنگ کره‌ای", "ماکا روت", "ماکا پرویی"] },
        { pillar: "herbal", theme: "گیاهان تقویتی تستوسترون", keywords: ["تریبولوس", "مک جا", "تونکات علی", "فنوگریک", "شیلجیت", "شیلاجیت"] },
        { pillar: "herbal", theme: "آمینواسیدهای ویژه", keywords: ["تورین", "ال-کارنیتین", "ال-تیروزین", "ال-سیستئین"] },
        // ─── مکمل‌های پیش‌تمرین ───
        { pillar: "pre-workout", theme: "پمپ و نیتریک اکساید", keywords: ["N.O. booster", "نیتریک اکساید بوستر", "آرژنین AKG", "آرژنین آلفا کتوگلوتارات", "سیترین مالات", "سیترین"] },
        { pillar: "pre-workout", theme: "انرژی و تمرکز پیش‌تمرین", keywords: ["کافئین پیش تمرین", "بتاآلانین", "بهترین پیش تمرین", "پری ورک‌اوت"] },
        // ─── مکمل‌های ریکاوری ───
        { pillar: "recovery-supps", theme: "ریکاوری عضلانی", keywords: ["گلوتامین ریکاوری", "کراتین HCL", "کراتین هیدروکلراید", "کراتین مونوهیدرات", "ZMA"] },
        { pillar: "recovery-supps", theme: "مفاصل و بافت همبند", keywords: ["کلاژن هیدرولیز شده", "کلاژن هیدرولیزاته", "اسید هیالورونیک", "MSM"] },
        // ─── حرکات پیشگیرانه و روتاتور کاف (Prehab) ───
        { pillar: "prehab", theme: "حرکات روتاتور کاف", keywords: ["face pull", "فیس پول", "external rotation", "چرخش خارجی شانه", "internal rotation", "چرخش داخلی شانه", "rotator cuff", "روتاتور کاف"] },
        { pillar: "prehab", theme: "حرکات اصلاحی کتف و شانه", keywords: ["Y-Raise", "Y ریز", "T-Raise", "T ریز", "حرکات کلاژن", "حرکات کور", "فرم اصلاحی"] },
        // ─── حرکات کالیشتیک ───
        { pillar: "calisthenics", theme: "حرکات پیشرفته کالیشتیک", keywords: ["muscle up", "ماسل آپ", "front lever", "فرانت لور", "back lever", "بک لور", "human flag", "پرچم انسانی", "planche", "پلانش"] },
        { pillar: "calisthenics", theme: "تعادل و هندستند", keywords: ["handstand", "هندستند", "پارالترال", "بارفیکس کالیشتیک", "کرن کالیشتیک", "کالیشتیک"] },
        // ─── حرکات المپیکی ───
        { pillar: "olympic-lifts", theme: "حرکات المپیکی پایه", keywords: ["clean and jerk", "کلین اند جِرک", "snatch", "اسنچ", "power clean", "پاور کلین", "split jerk", "وزنه‌برداری المپیکی", "حرکات المپیکی"] },
        // ─── روش‌های تمرینی پیشرفته ───
        { pillar: "training-methods", theme: "برنامه‌های معروف (Splits & Programs)", keywords: ["German Volume Training", "GVT", "5/3/1", "وندلر", "Starting Strength", "PPL", "Push Pull Legs", "Upper/Lower", "Bro Split"] },
        { pillar: "training-methods", theme: "تکنیک‌های پیشرفته شدت", keywords: ["BFR", "Blood Flow Restriction", "CAT", "Compensatory Acceleration Training", "Pre-Exhaust", "Post-Exhaust", "Rest-Pause", "Cluster Sets"] },
        // ─── انگیزه ───
        { pillar: "motivation", theme: "استمرار ورزش", keywords: ["انگیزه روزانه", "هدف‌گذاری ورزشی", "غلبه بر تنبلی"] },
      ],
      contentCalendar: [
        { week: 1, topic: "آماده‌سازی بدن برای شروع بدنسازی", keyword: "برنامه بدنسازی" },
        { week: 2, topic: "تغذیه قبل و بعد تمرین", keyword: "تغذیه قبل تمرین" },
        { week: 3, topic: "آموزش صحیح اسکوات", keyword: "اسکوات صحیح" },
        { week: 4, topic: "مکمل کراتین و نحوه مصرف", keyword: "کراتین چیست" },
        { week: 5, topic: "محاسبه کالری روزانه", keyword: "کالری روزانه" },
        { week: 6, topic: "تکنیک صحیح ددلیفت", keyword: "ددلیفت صحیح" },
        { week: 7, topic: "سوپرست تمرینی چیست", keyword: "سوپرست تمرین" },
        { week: 8, topic: "بولکینگ تمیز و کثیف", keyword: "بولکینگ تمیز" },
        { week: 9, topic: "پروتئین وی و انواع آن", keyword: "پروتئین وی چیست" },
        { week: 10, topic: "آموزش پرس سینه صحیح", keyword: "تمرین پرس سینه" },
        { week: 11, topic: "اینترمیتنت فاستینگ و بدنسازی", keyword: "اینترمیتنت فاستینگ" },
        { week: 12, topic: "محاسبه TDEE و BMR", keyword: "محاسبه TDEE" },
        { week: 13, topic: "آسیب شانه در بدنسازی و پیشگیری", keyword: "آسیب شانه بدنسازی" },
        { week: 14, topic: "overtraining و علائم آن", keyword: "overtraining علائم" },
        { week: 15, topic: "BCAA و EAA تفاوت و کاربرد", keyword: "BCAA چیست" },
        { week: 16, topic: "دوره‌بندی موجی تمرین", keyword: "دوره‌بندی موجی" },
        { week: 17, topic: "رژیم کتوژنیک برای بدنسازی", keyword: "رژیم کتوژنیک بدنسازی" },
        { week: 18, topic: "اشواگاندا و تاثیر بر تستوسترون", keyword: "اشواگاندا ورزش" },
        { week: 19, topic: "بارفیکس؛ آموزش گام‌به‌گام", keyword: "بارفیکس آموزش" },
        { week: 20, topic: "استروئید آنابولیک و عوارض آن", keyword: "استروئید آنابولیک عوارض" },
        { week: 21, topic: "هادی چوپان؛ مسیر قهرمانی", keyword: "هادی چوپان زندگینامه" },
        { week: 22, topic: "PCT درمان پس از دوره استروئید", keyword: "PCT درمان پس از دوره" },
        { week: 23, topic: "کلاژن و سلامت مفاصل", keyword: "کلاژن مفاصل" },
        { week: 24, topic: "بدنسازی طبیعی بدون استروئید", keyword: "بدنسازی طبیعی بدون استروئید" },
        // ─── هفته‌های اضافه‌شده — کلمات کلیدی جدید (COACH-TIP-GYM-SEO) ───
        { week: 25, topic: "ویتامین D ورزشکاران؛ اهمیت و دوز صحیح", keyword: "ویتامین D ورزشکاران" },
        { week: 26, topic: "ویتامین B12 برای انرژی ورزشکاران", keyword: "ویتامین B12" },
        { week: 27, topic: "جینسنگ قرمز کره‌ای؛ آداپتوژن قدرتمند", keyword: "جینسنگ قرمز کره‌ای" },
        { week: 28, topic: "ماکا روت؛ افزایش استقامت و انرژی", keyword: "ماکا روت پرویی" },
        { week: 29, topic: "سیترین مالات؛ بهترین پمپ پیش‌تمرین", keyword: "سیترین مالات پمپ" },
        { week: 30, topic: "N.O. booster چیست و چگونه کار می‌کند", keyword: "N.O. booster نیتریک اکساید" },
        { week: 31, topic: "کلاژن هیدرولیز شده برای مفاصل", keyword: "کلاژن هیدرولیز شده" },
        { week: 32, topic: "کراتین HCL یا مونوهیدرات؟", keyword: "کراتین HCL هیدروکلراید" },
        { week: 33, topic: "آموزش face pull؛ پیشگیری از آسیب شانه", keyword: "face pull فیس پول" },
        { week: 34, topic: "تمرینات روتاتور کاف برای شانه سالم", keyword: "rotator cuff روتاتور کاف" },
        { week: 35, topic: "ماسل آپ؛ آموزش گام‌به‌گام", keyword: "muscle up ماسل آپ آموزش" },
        { week: 36, topic: "پلانش؛ سخت‌ترین حرکت کالیشتیک", keyword: "planche پلانش آموزش" },
        { week: 37, topic: "clean and jerk؛ آموزش حرکت المپیکی", keyword: "clean and jerk کلین اند جِرک" },
        { week: 38, topic: "snatch؛ پادشاه حرکات المپیکی", keyword: "snatch اسنچ آموزش" },
        { week: 39, topic: "German Volume Training؛ ۱۰ ست ۱۰ تکرار", keyword: "German Volume Training GVT" },
        { week: 40, topic: "5/3/1 وندلر؛ برنامه قدرت ساده و موثر", keyword: "5/3/1 وندلر برنامه" },
        { week: 41, topic: "PPL اسپلیت؛ پوش پول پا", keyword: "PPL Push Pull Legs" },
        { week: 42, topic: "BFR تمرین با محدودیت جریان خون", keyword: "BFR Blood Flow Restriction" },
        { week: 43, topic: "Rest-Pause؛ تکنیک رست پاز برای هایپرتروفی", keyword: "Rest-Pause رست پاز" },
        { week: 44, topic: "SARMs عوارض و خطرات (آموزشی)", keyword: "اوستارین SARM" },
        { week: 45, topic: "پروتکل PCT کامل (آموزشی)", keyword: "پروتکل PCT کلومید نولوادکس" },
        { week: 46, topic: "اکسی‌مثلون (آنادرول)؛ عوارض و هشدار", keyword: "اکسی‌مثلون آنادرول" },
        { week: 47, topic: "Cluster Sets؛ تکنیک کلاستر ست برای قدرت", keyword: "Cluster Sets کلاستر ست" },
        { week: 48, topic: "Y-Raise و T-Raise؛ تقویت کتف فوقانی", keyword: "Y-Raise تمرین شانه" },
      ],
      internalLinkMap: [],
      competitiveNotes:
        "بازار ایران در حوزه فیتنس به شدت در حال رشد است. کلمات کلیدی فارسی رقابت کمتری نسبت به انگلیسی دارند. تمرکز روی long-tail keywords فارسی (مثل آموزش هر حرکت، هر مکمل، عوارض استروئیدها) مزیت رقابتی ایجاد می‌کند. پوشش گسترده موضوعات (مکمل، حرکات، روش‌های تمرینی، تغذیه تخصصی، مصدومیت‌ها، مربیان) فیتاپ را به مرجع کامل بدنسازی فارسی تبدیل می‌کند.",
      sustainabilityPlan:
        "هر هفته ۳ مقاله جدید تولید می‌شود. استراتژی هر ۲ ماه یک‌بار با تحلیل مقالات جدید و کلمات کلیدی در حال ظهور بازبینی می‌شود. صف planned articles همیشه حاوی حداقل ۲۰ ایده آماده تولید است. با داشتن ۱۷ content pillar و ۵۰+ کلاستر (شامل ویتامین‌های تفکیک‌شده، مکمل‌های گیاهی، پیش‌تمرین، ریکاوری، حرکات کالیشتیک، حرکات المپیکی، حرکات روتاتور کاف، SARMs و پروتکل‌های PCT)، حداقل ۲۴۰ مقاله قابل تولید است.",
    };
  }

  // Save strategy to DB
  const siteMap = JSON.stringify(site);
  const summary = `استراتژی سئو ${strategy.contentPillars?.length || 0} ستون محتوایی، ${
    strategy.targetKeywords?.length || 0
  } کلمه کلیدی هدف، ${strategy.clusters?.length || 0} کلاستر، ${
    strategy.contentCalendar?.length || 0
  } هفته تقویم محتوا.`;

  // Deactivate previous strategies, save new one
  await db.seoStrategy.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });
  const prev = await db.seoStrategy.findFirst({
    orderBy: { version: "desc" },
  });
  await db.seoStrategy.create({
    data: {
      version: (prev?.version || 0) + 1,
      isActive: true,
      content: JSON.stringify(strategy),
      summary,
      targetKeywords: (strategy.targetKeywords || [])
        .map((k) => k.keyword)
        .join(", "),
      siteMap,
      plannedCount: 0,
      autoMode: true,
      lastRunAt: new Date(),
    },
  });

  log(
    ctx,
    "success",
    `✅ استراتژی سئو ذخیره شد (نسخه ${(prev?.version || 0) + 1}): ${summary}`
  );
  return strategy;
}

// ─── Step 4: Plan articles ───
export async function planArticles(
  ctx: RunContext,
  strategy: SeoStrategyContent,
  site: SiteAnalysis,
  count: number
): Promise<ArticlePlan[]> {
  log(ctx, "info", `📅 برنامه‌ریزی ${count} مقاله جدید بر اساس استراتژی`);

  // Build list of existing slugs to avoid duplicates
  const existingSlugs = new Set(site.articles.map((a) => a.slug));
  const existingTitles = new Set(
    site.articles.map((a) => a.title.toLowerCase())
  );

  // Get already-planned articles (not yet published)
  const planned = await db.seoArticlePlan.findMany({
    where: { status: { in: ["planned", "queued", "generating"] } },
    select: { keyword: true, title: true, slug: true },
  });
  for (const p of planned) {
    existingSlugs.add(p.slug);
    existingTitles.add(p.title.toLowerCase());
  }

  // Pick top keywords not already covered (avoid duplicate keywords)
  const coveredKeywords = new Set([
    ...site.existingKeywords.map((k) => k.toLowerCase()),
    ...planned.map((p) => p.keyword.toLowerCase()),
  ]);

  const candidateKeywords = (strategy.targetKeywords || [])
    .filter((k) => !coveredKeywords.has(k.keyword.toLowerCase()))
    .slice(0, count * 2); // get extra in case some fail

  if (candidateKeywords.length < count) {
    // also consider cluster keywords
    for (const cluster of strategy.clusters || []) {
      for (const kw of cluster.keywords || []) {
        if (!coveredKeywords.has(kw.toLowerCase()) && candidateKeywords.length < count * 2) {
          candidateKeywords.push({
            keyword: kw,
            intent: "informational" as const,
            difficulty: "low" as const,
            pillar: cluster.pillar,
          });
        }
      }
    }
  }

  // Pick top N
  const selected = candidateKeywords.slice(0, count);

  const systemPrompt = `تو یک متخصص سئو و برنامه‌ریز محتوای فارسی هستی. برای هر کلمه کلیدی، یک ایده مقاله سئوشده با عنوان جذاب، slug انگلیسی مناسب، و خلاصه تولید کن.
همچنین برای هر مقاله:
- ۳-۵ کلمه کلیدی ثانویه مرتبط پیشنهاد بده
- ۲-۳ لینک داخلی به صفحات/مقالات موجود پیشنهاد بده (با anchor text مناسب)
- یک پرامپت حرفه‌ای به انگلیسی برای تولید تصویر کاور بنویس (photorealistic, fitness-related, no text in image, orange/white theme when applicable)
- ۱-۲ پرامپت انگلیسی برای تصاویر داخل مقاله

فقط با ساختار JSON زیر پاسخ بده:
{
  "articles": [
    {
      "keyword": "کلمه کلیدی",
      "title": "عنوان جذاب مقاله (شامل کلمه کلیدی)",
      "slug": "english-slug-with-dashes",
      "category": "training|nutrition|motivation|general|supplement|recovery|exercises|training-methods|metrics|athletes|steroids-education",
      "excerpt": "خلاصه ۱-۲ خطی",
      "pillar": "training|nutrition|...",
      "secondaryKeywords": ["کلمه ۱", "کلمه ۲"],
      "internalLinks": [
        { "slug": "existing-article-slug", "title": "عنوان مقاله هدف", "anchor": "متن لینک" }
      ],
      "coverImagePrompt": "English prompt for cover image",
      "inlineImagePrompts": ["English prompt 1", "English prompt 2"]
    }
  ]
}`;

  const existingForLinks = [...site.articles.slice(0, 15), ...site.pages.map((p) => ({
    id: "",
    title: p.title,
    slug: p.url,
    category: "page",
    tags: "",
    excerpt: "",
  }))];

  const userPrompt = `برای این ${selected.length} کلمه کلیدی، ایده مقاله تولید کن:
${selected
  .map(
    (k, i) =>
      `${i + 1}. "${k.keyword}" — ستون: ${k.pillar} — سختی: ${k.difficulty}`
  )
  .join("\n")}

صفحات/مقالات موجود برای لینک‌سازی داخلی (فقط به این‌ها لینک بده):
${existingForLinks
  .map((p) => `- slug="${p.slug}" title="${p.title}"`)
  .join("\n")}

قوانین مهم:
- slug باید انگلیسی، با dash، کوتاه و توصیفی باشد (مثلاً: bench-press-form-guide)
- عنوان باید جذاب، شامل کلمه کلیدی و قابل کلیک باشد
- category باید یکی از: training, nutrition, supplement, recovery, motivation, general, exercises, training-methods, metrics, athletes, steroids-education
- حداقل ۲ لینک داخلی به مقالات/صفحات موجود بساز
- ⚠️ فقط به مقالاتی که در لیست بالا هستند لینک بده. هرگز به مقاله‌ای که قرار است ساخته شود لینک نده.
- coverImagePrompt: باید یک پرامپت انگلیسی کوتاه و دقیق برای تولید عکس کاور باشد.
  سبک عکس: عکس ورزشی حرفه‌ای، نورپردازی طبیعی روشن (daylight)، پس‌زمینه باشگاه مدرن،
  رنگ‌های واقعی و زنده، شخص ورزشکار در حال تمرین با فرم صحیح.
  ❌ ممنوع: نورپردازی دراماتیک، پس‌زمینه تاریک، سبک سینمایی، تم نارنجی-طلایی غالب.
  ✅ الزامی: anatomically correct, proper proportions, natural pose, no weird anatomy, no extra limbs.
- inlineImagePrompts: هر کدام باید یک موضوع متفاوت از کاور و از همدیگر داشته باشند.
  مثلاً اگر کاور "bench press" است، inline ها می‌توانند "dumbbell fly" و "cable crossover" باشند.
  ❌ هرگز inline با موضوع مشابه کاور نسازید.`;

  let articles: ArticlePlan[] = [];
  try {
    const content = await callLlm(systemPrompt, userPrompt, 8000);
    const parsed = extractJson(content);
    if (parsed?.articles && Array.isArray(parsed.articles)) {
      articles = parsed.articles.filter(
        (a: any) =>
          a.keyword &&
          a.title &&
          a.slug &&
          !existingSlugs.has(a.slug) &&
          !existingTitles.has(a.title.toLowerCase())
      );
    }
  } catch (e: any) {
    log(ctx, "error", `خطا در برنامه‌ریزی مقالات: ${e.message}`);
  }

  // Save plans to DB
  const savedPlans: ArticlePlan[] = [];
  for (const plan of articles) {
    try {
      const dbPlan = await db.seoArticlePlan.create({
        data: {
          keyword: plan.keyword,
          title: plan.title,
          slug: plan.slug,
          category: plan.category || "general",
          excerpt: plan.excerpt || "",
          pillar: plan.pillar || "general",
          secondaryKeywords: (plan.secondaryKeywords || []).join(", "),
          internalLinks: JSON.stringify(plan.internalLinks || []),
          coverImagePrompt: plan.coverImagePrompt || "",
          status: "planned",
          priority: 50,
        },
      });
      savedPlans.push({ ...plan, id: dbPlan.id });
    } catch (e: any) {
      log(ctx, "warn", `ذخیره plan برای "${plan.title}" شکست خورد: ${e.message}`);
    }
  }

  log(
    ctx,
    "success",
    `✅ ${savedPlans.length} مقاله برنامه‌ریزی و در صف ذخیره شد`
  );

  // Update strategy planned count
  await db.seoStrategy.updateMany({
    where: { isActive: true },
    data: { plannedCount: savedPlans.length },
  });

  return savedPlans;
}

/**
 * Compute the scheduled publish date for a new article.
 *
 * Scheduling rules:
 *  1. If the strategy's contentCalendar has an entry whose keyword matches
 *     (case-insensitive substring) the article's plan keyword, the article is
 *     scheduled for `now + (week * 7 days)`. Week 1 = next week, week 2 = 2
 *     weeks from now, etc. — this spreads articles across the calendar as the
 *     strategy intends.
 *  2. Otherwise, the article is scheduled 7 days after the latest already-scheduled
 *     draft article (so articles never collide on the same day). If no draft is
 *     currently scheduled, it's scheduled 1 day from now as a sensible default.
 *  3. The returned date is always strictly in the future (>= now + 1 hour) so the
 *     cron publisher won't immediately fire on the same run.
 *
 * Returns null when `publishImmediately` is true (caller should publish now).
 */
export async function computeScheduledAt(
  plan: ArticlePlan,
  strategy: SeoStrategyContent | null | undefined,
  publishImmediately: boolean = false
): Promise<Date | null> {
  if (publishImmediately) return null;

  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  // 1) پیدا کردن آخرین مقاله زمان‌بندی‌شده (draft با scheduledAt)
  const latestScheduled = await db.article.findFirst({
    where: {
      status: "draft",
      scheduledAt: { not: null },
    },
    orderBy: { scheduledAt: "desc" },
    select: { scheduledAt: true },
  });

  // 2) محاسبه تاریخ پایه
  // اگر مقاله زمان‌بندی‌شده‌ای وجود دارد، از آن استفاده کن
  // در غیر این صورت، از امروز استفاده کن
  let baseDate = now;
  if (latestScheduled?.scheduledAt) {
    baseDate = new Date(latestScheduled.scheduledAt);
  }

  // 3) فاصله دقیقاً ۴ روز بین هر مقاله
  const gapDays = 4;

  const target = new Date(baseDate);
  target.setDate(target.getDate() + gapDays);
  // ساعت ۹ صبح به وقت تهران (UTC+3:30)
  // سرور ممکن است timezone متفاوتی داشته باشد، پس UTC را تنظیم می‌کنیم
  // ۹ صبح تهران = ۵:۳۰ UTC
  target.setUTCHours(5, 30, 0, 0);

  // 4) مطمئن شو که تاریخ در آینده است
  if (target.getTime() < oneHourFromNow.getTime()) {
    // اگر تاریخ محاسبه‌شده در گذشته است، فردا ساعت ۹ صبح تهران استفاده کن
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 1);
    fallback.setUTCHours(5, 30, 0, 0); // ۹ صبح تهران
    return fallback;
  }

  return target;
}

// ─── Step 5: Generate single article with images ───
export async function generateArticle(
  ctx: RunContext,
  plan: ArticlePlan,
  site: SiteAnalysis,
  strategy?: SeoStrategyContent | null
): Promise<{ articleId: string; coverUrl: string; wordCount: number; scheduledAt: Date | null }> {
  log(ctx, "info", `📝 شروع تولید مقاله: "${plan.title}" (slug: ${plan.slug})`);

  // Mark plan as generating
  if (plan.id) {
    await db.seoArticlePlan.update({
      where: { id: plan.id },
      data: { status: "generating", attempts: { increment: 1 } },
    });
  }

  // Build internal link context — existing articles for the AI to reference
  const existingForLinks = [...site.articles.slice(0, 20), ...site.pages.map((p) => ({
    slug: p.url,
    title: p.title,
  }))];

  // Generate full article content (2000+ words)
  const contentSystem = `تو یک نویسنده حرفه‌ای محتوای ورزشی و تغذیه فارسی هستی. مقالات تو:
- حداقل ۱۸۰۰ کلمه هستند
- کاملاً سئوشده هستند (کلمه کلیدی اصلی در H1، پاراگراف اول، چند بار در متن، و در نتیجه‌گیری)
- ساختار حرفه‌ای دارند: H1، چند H2، چند H3، لیست‌ها، نقل‌قول‌های برجسته
- علمی، دقیق و کاربردی هستند (نه کلی‌گویی)
- لحن حرفه‌ای اما قابل فهم دارند
- شامل ایموجی‌های مرتبط برای خوانایی بهتر
- با فرمت Markdown هستند
- شامل حداکثر ۱ جای‌نگهدار تصویر با فرمت ![توضیح فارسی تصویر](IMAGE_PLACEHOLDER_1)
  • مهم: alt text باید توصیفی، فارسی و حاوی کلمه کلیدی باشد (حداقل ۵ کلمه). مثال: ![جدول کالری غذاها و مواد مغذی](IMAGE_PLACEHOLDER_1)
  •⚠️ فقط یک تصویر inline کافی است. تصویر inline باید موضوع متفاوت از کاور داشته باشد.
  اگر موضوع متفاوتی نیست، اصلاً تصویر inline قرار نده — فقط کاور کافی است.
- شامل جدول مقایسه‌ای (Markdown table) حداقل در یک بخش
- شامل سؤالات متداول (FAQ) با ساختار H3 در انتها
- شامل نتیجه‌گیری انگیزشی

قوانین بسیار مهم (حتماً رعایت کن):
- هر مقاله حتماً باید یک H1 در ابتدا داشته باشد (عنوان مقاله).
- هیچ‌گاه دو تصویر را پشت سر هم قرار نده — همیشه حداقل یک پاراگراف متن بین دو تصویر باشد.
- هیچ‌گاه کلمات h1, h2, h3, H1, H2, H3 را به‌عنوان متن در heading‌ها ننویس. مثلاً ننویس '### h3 سوال' یا '### H3: سوال' — فقط بنویس '### سوال'.
- از جدول Markdown (table) برای مقایسه‌ها و داده‌های ساختاریافته استفاده کن — حداقل یک جدول در هر مقاله.

قوانین مهم لینک‌های داخلی (بسیار مهم):
لینک‌های داخلی فقط با این فرمت‌ها مجاز هستند:
۱. لینک به صفحه اصلی: [متن](/)
۲. لینک به ابزارها: [متن](/?tool=tdee) یا [متن](/?tool=exercises) یا [متن](/?tool=foods)
۳. لینک به مقاله دیگر: [متن](/?article=slug) — slug را از لیست مقالات موجود انتخاب کن
۴. لینک به لیست مقالات: [متن](/?screen=articles)
هیچ‌گاه از فرمت /article/slug استفاده نکن — این کار نمی‌کند. همیشه /?article=slug استفاده کن.
هیچ‌گاه از /blog استفاده نکن — این مسیر وجود ندارد. از /?screen=articles استفاده کن.
⚠️ فقط به مقالاتی که در لیست "مقالات موجود" هستند لینک بده. هرگز به مقاله‌ای که هنوز ساخته نشده لینک نده.

قوانین محتوایی فوق‌حرفه‌ای:
- مقاله باید کاملاً یونیک و اصلی باشد — نه کپی از سایت‌های دیگر
- محتوا باید بر اساس آخرین تحقیقات علمی و پزشکی باشد
- از آمار، اعداد و داده‌های علمی استفاده کن (با ذکر منبع در متن)
- لحن باید ترغیب‌کننده و فروش‌محور باشد — کاربر را به خرید برنامه بدنسازی تشویق کن
- در پایان مقاله، یک پاراگراف CTA (دعوت به اقدام) برای خرید برنامه فیتاپ اضافه کن
- از کلمات کلیدی سئو به‌صورت طبیعی در متن استفاده کن (keyword density 1-2٪)
- مقاله باید حداقل ۲۰۰۰ کلمه باشد
- شامل نکات عملی و کاربردی باشد که کاربر بلافاصله استفاده کند`;

  const contentUser = `یک مقاله کامل بنویس با مشخصات زیر:

عنوان: ${plan.title}
کلمه کلیدی اصلی: ${plan.keyword}
کلمات کلیدی ثانویه: ${plan.secondaryKeywords.join("، ")}
دسته: ${plan.category}
خلاصه: ${plan.excerpt}

${plan.category === "steroids-education" ? `
⚠️ هشدار بسیار مهم برای این دسته:
این مقاله در دسته «آموزش آگاه‌سازی استروئیدها» است. هدف فقط و فقط آگاه‌سازی کاربران درباره عوارض، خطرات و پیامدهای مصرف استروئید است. در مقاله:
- هرگز به مصرف استروئید تشویق نکن
- عوارض کوتاه‌مدت و بلندمدت (مثل آسیب کبد، ناباروری، مشکلات قلبی، تغییرات هورمونی، ریزش مو، آکنه، نوسانات خلقی) را با جزئیات شرح بده
- مهم‌ترین بخش مقاله باید «راهکارهای جایگزین طبیعی» باشد — افزایش تستوسترون طبیعی، تغذیه، مکمل‌های قانونی، خواب، استرس
- در انتهای مقاله، یک هشدار جدی پزشکی اضافه کن: «مصرف استروئید بدون نسخه پزشک غیرقانونی و خطرناک است»
- CTA فروش‌محور استفاده نکن — به جای آن، کاربر را به مشاوره با مربی فیتاپ برای بدنسازی طبیعی دعوت کن
- لحن باید جدی، علمی و پزشکی باشد — نه ترغیب‌کننده و فروش‌محور
` : ""}

لینک‌های داخلی پیشنهادی (حتماً در متن از این‌ها استفاده کن):
${plan.internalLinks
  .map((l) => `- [${l.anchor}](/?article=${l.slug}) — هدف: "${l.title}"`)
  .join("\n")}

سایر صفحات/مقالات موجود برای لینک‌سازی اضافی (به این‌ها هم با فرمت /?article=slug یا /?tool=... لینک بزن):
${existingForLinks
  .map((p) => `- slug="${p.slug}" title="${p.title}"`)
  .join("\n")}

یادآوری فرمت لینک‌ها:
- لینک به ابزار: [متن](/?tool=tdee) یا [متن](/?tool=exercises) یا [متن](/?tool=foods)
- لینک به مقاله: [متن](/?article=slug)
- لینک به صفحه اصلی: [متن](/)
- لینک به لیست مقالات: [متن](/?screen=articles)

فقط محتوای Markdown بنویس. بدون توضیح اضافه در ابتدا یا انتها.`;

  let articleContent = "";
  try {
    articleContent = await callLlm(contentSystem, contentUser, 8000);
  } catch (e: any) {
    throw new Error(`خطا در تولید محتوا: ${e.message}`);
  }

  // Strip code fences if present
  articleContent = articleContent.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```\s*$/i, "");

  // === Post-processing: clean "h1/h2/h3/H1/H2/H3" literal text from headings ===
  // The AI sometimes literally writes "### h3 سوال" or "### H3: سوال" instead of "### سوال".
  // این regex تمام موارد را تمیز می‌کند.
  const beforeClean = articleContent;
  articleContent = articleContent.replace(
    /^(#{1,6})\s*[hH][1-6][:：\-\s]+/gm,
    "$1 "
  );
  if (articleContent !== beforeClean) {
    log(ctx, "info", `🧹 پاک‌سازی h1/h2/h3 literal از heading‌ها انجام شد.`);
  }

  // === Post-processing: fix broken internal link patterns ===
  // AI گاهی از فرمت اشتباه /article/slug یا /article// یا /blog استفاده می‌کند.
  // این Step همه موارد را به فرمت صحیح تبدیل می‌کند.
  const beforeLinkFix = articleContent;
  // 1) /article// (double slash) → / (e.g. /article//?tool=tdee → /?tool=tdee)
  articleContent = articleContent.replace(/\/article\/\//g, "/");
  // 2) Markdown links ](/article/slug) → ](/?article=slug)
  articleContent = articleContent.replace(/\]\(\/article\/([^)]+)\)/g, (match, rest: string) => {
    if (rest.includes("?")) {
      const [slug, query] = rest.split("?");
      return `](/?article=${slug}&${query})`;
    }
    return `](/?article=${rest})`;
  });
  // 3) ](/blog) → ](/?screen=articles)
  articleContent = articleContent.replace(/\]\(\/blog\)/g, "](/?screen=articles)");
  // 4) standalone /blog references (not in markdown links)
  articleContent = articleContent.replace(/(^|[\s(])\/blog(?=[\s)]|$)/g, "$1/?screen=articles");
  if (articleContent !== beforeLinkFix) {
    log(ctx, "info", `🔗 اصلاح لینک‌های داخلی شکسته (double-slash, /article/slug, /blog) انجام شد.`);
  }

  // === Post-processing safety net: insert a paragraph between consecutive images ===
  // حتی اگر AI دستورالعمل «دو تصویر پشت سر هم نده» را نادیده بگیرد، این Step اطمینان می‌دهد
  // که هیچ دو تصویری بدون متن بینشان در خروجی نهایی نباشد.
  const beforeImgFix = articleContent;
  let iterations = 0;
  while (iterations < 10) {
    const next = articleContent.replace(
      /(!\[[^\]]*\]\([^\)]+\))[\s\n]+(!\[[^\]]*\]\([^\)]+\))/g,
      "$1\n\nبرای درک بهتر، تصویر زیر نکات کلیدی را نشان می‌دهد:\n\n$2"
    );
    if (next === articleContent) break;
    articleContent = next;
    iterations++;
  }
  if (articleContent !== beforeImgFix) {
    log(ctx, "info", `🖼 درج پاراگراف انتقالی بین ${iterations} جفت تصویر متوالی انجام شد.`);
  }

  const wordCount = articleContent.trim().split(/\s+/).length;
  log(ctx, "info", `📄 محتوای مقاله تولید شد (${wordCount} کلمه) — شروع تولید تصاویر`);

  // ─── Generate cover image ───
  // الگوی یکدست برای تمام کاورها: سبک طبیعی و واقع‌گرایانه
  let coverUrl = "";
  try {
    const coverPrompt =
      plan.coverImagePrompt ||
      `Professional fitness photograph of ${plan.keyword}, natural bright daylight, modern gym environment, realistic colors, athletic person in natural pose, proper form, photorealistic, high quality, sharp focus, no text, no watermark, no weird anatomy, no extra limbs, no distorted faces, magazine editorial style`;
    log(ctx, "info", `🖼 تولید تصویر کاور با الگوی طبیعی فیتاپ...`);
    const coverImg = await generateImage({
      prompt: coverPrompt,
      aspectRatio: "16:9" as AspectRatio,
      timeoutMs: 120000,
    });
    const processed = await processAndSaveArticleImage({
      buffer: coverImg.buffer,
      articleSlug: plan.slug,
      descriptiveName: plan.keyword.replace(/\s+/g, "-").slice(0, 40),
    });
    coverUrl = processed.cover.url;
    log(
      ctx,
      "success",
      `✅ تصویر کاور تولید و بهینه شد: ${coverUrl} (${Math.round(processed.cover.bytes / 1024)}KB)`
    );
  } catch (e: any) {
    log(ctx, "warn", `تولید تصویر کاور شکست خورد: ${e.message}`);
  }

  // ─── Generate inline images ───
  // Find IMAGE_PLACEHOLDER_N in content
  const placeholderRegex = /!\[([^\]]*)\]\(IMAGE_PLACEHOLDER_(\d+)\)/g;
  const placeholders: { alt: string; index: number; fullMatch: string }[] = [];
  let match;
  while ((match = placeholderRegex.exec(articleContent)) !== null) {
    placeholders.push({
      alt: match[1],
      index: parseInt(match[2], 10),
      fullMatch: match[0],
    });
  }

  // Generate inline images — فقط ۱ تصویر inline (بهینه‌سازی هزینه API)
  // مهم: برای صرفه‌جویی در هزینه API، فقط ۱ inline تولید می‌کنیم.
  // اگر placeholder ها بیشتر از ۱ باشند، بقیه حذف می‌شوند.
  const inlinePrompts = plan.inlineImagePrompts || [];
  const maxInlineImages = 1;
  for (let i = 0; i < Math.min(placeholders.length, maxInlineImages); i++) {
    const ph = placeholders[i];
    const prompt =
      inlinePrompts[i] ||
      `Photorealistic fitness photo showing: ${ph.alt || plan.keyword}, natural bright daylight, gym or athletic setting, realistic human body in natural exercise pose, proper anatomy, correct proportions, photorealistic, high quality, sharp focus, no text, no watermark, no weird anatomy, no extra limbs, no distorted faces, no backwards phone, magazine editorial style`;
    try {
      log(ctx, "info", `🖼 تولید تصویر داخل متن ${i + 1}/${placeholders.length}...`);
      const img = await generateImage({
        prompt,
        aspectRatio: "16:9" as AspectRatio,
        timeoutMs: 120000,
      });
      const processed = await processAndSaveInlineImage({
        buffer: img.buffer,
        articleSlug: plan.slug,
        descriptiveName: ph.alt.slice(0, 40),
        index: ph.index,
      });
      // Replace placeholder with actual image URL
      articleContent = articleContent.replace(
        ph.fullMatch,
        `![${ph.alt}](${processed.url})`
      );
      log(
        ctx,
        "success",
        `✅ تصویر داخل متن ${i + 1} تولید و جایگزین شد: ${processed.url}`
      );
    } catch (e: any) {
      log(ctx, "warn", `تولید تصویر داخل متن ${i + 1} شکست خورد: ${e.message}`);
      // Remove the placeholder on failure
      articleContent = articleContent.replace(ph.fullMatch, "");
    }
  }

  // Remove any remaining placeholders
  articleContent = articleContent.replace(
    /!\[[^\]]*\]\(IMAGE_PLACEHOLDER_\d+\)/g,
    ""
  );

  // ─── بررسی نهایی: حذف inline تکراری ───
  // اگر چند inline به یک URL اشاره کنند، فقط اولی را نگه می‌داریم.
  // همچنین اگر inline با cover یکی باشد (URL یکسان)، آن inline را حذف می‌کنیم.
  {
    const inlineRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const inlineMatches: { alt: string; url: string; fullMatch: string }[] = [];
    let im;
    while ((im = inlineRegex.exec(articleContent)) !== null) {
      if (im[2].startsWith("http") || im[2].includes("IMAGE_PLACEHOLDER")) continue;
      inlineMatches.push({ alt: im[1], url: im[2], fullMatch: im[0] });
    }

    const seenInlineUrls = new Set<string>();
    let inlineRemovedCount = 0;
    for (const im of inlineMatches) {
      // اگر inline با cover یکی است → حذف
      if (coverUrl && im.url === coverUrl) {
        articleContent = articleContent.replace(im.fullMatch, "");
        inlineRemovedCount++;
        continue;
      }
      // اگر inline قبلاً دیده شده → حذف
      if (seenInlineUrls.has(im.url)) {
        articleContent = articleContent.replace(im.fullMatch, "");
        inlineRemovedCount++;
        continue;
      }
      seenInlineUrls.add(im.url);
    }
    if (inlineRemovedCount > 0) {
      log(ctx, "info", `🧹 ${inlineRemovedCount} inline تکراری حذف شد (URL یکسان با cover یا تکراری).`);
    }
  }

  // ─── Generate SEO fields ───
  const seoSystem = `تو متخصص سئو هستی. فیلدهای سئو برای یک مقاله ورزشی/تغذیه فارسی تولید کن. فقط JSON.
مهم: همه فیلدها باید فارسی و حاوی کلمه کلیدی اصلی یا ثانویه باشند.
seoTitle باید ترغیب‌کننده و قابل کلیک باشد (CTR بالا) و حداکثر ۶۰ کاراکتر باشد.
seoDescription باید در سرچ نتایج گوگل جذاب به‌نظر برسد و حداکثر ۱۶۰ کاراکتر باشد.
metaKeywords باید ۵ تا ۸ کلمه کلیدی مرتبط (با کاما جدا شود) باشد.`;
  const seoUser = `برای مقاله زیر فیلدهای سئو بنویس:
عنوان: ${plan.title}
کلمه کلیدی اصلی: ${plan.keyword}
کلمات کلیدی ثانویه: ${plan.secondaryKeywords.join("، ")}
خلاصه: ${plan.excerpt}

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
    // keep defaults
  }

  // ─── اعمال محدودیت‌های سخت (hard limits) روی فیلدهای سئو ───
  // حتی اگر LLM مقدار طولانی‌تری برگرداند، آن را کوتاه می‌کنیم تا با
  // بهترین شیوه‌های گوگل هم‌خوانی داشته باشد.
  if (!seo.seoTitle) seo.seoTitle = plan.title;
  seo.seoTitle = seo.seoTitle.slice(0, 60);

  if (!seo.seoDescription) seo.seoDescription = plan.excerpt;
  seo.seoDescription = seo.seoDescription.slice(0, 160);

  if (!seo.metaKeywords) {
    seo.metaKeywords = [plan.keyword, ...plan.secondaryKeywords.slice(0, 4)].join(", ");
  }
  // محدود کردن metaKeywords به ۸ کلمه کلیدی (و حذف موارد خالی/تکراری)
  const kwList = seo.metaKeywords
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  // حذف تکراری‌ها (case-insensitive)
  const seenKw = new Set<string>();
  const dedupKw: string[] = [];
  for (const k of kwList) {
    const lower = k.toLowerCase();
    if (!seenKw.has(lower)) {
      seenKw.add(lower);
      dedupKw.push(k);
    }
  }
  seo.metaKeywords = dedupKw.slice(0, 8).join(", ");

  // ─── Ensure FAQ section exists in content (for FAQPage JSON-LD) ───
  // اگر مقاله FAQ نداشت، یک بخش FAQ با ۳-۴ سؤال متداول اضافه می‌کنیم
  // تا article-page.tsx بتواند FAQPage JSON-LD تولید کند.
  if (!/##\s+سوالات\s+متداول|##\s+پرسش.*متداول|##\s+FAQ/i.test(articleContent)) {
    const faqSection = `

## سوالات متداول

### ${plan.keyword} چیست؟

${plan.keyword} یکی از مفاهیم کلیدی در مسیر تناسب اندام و سلامتی است. در این مقاله به‌طور کامل توضیح دادیم که چرا برای رسیدن به هدف ورزشی شما اهمیت دارد و چطور می‌توانید آن را به‌درستی پیاده کنید.

### چطور می‌توانم ${plan.keyword} را در برنامه تمرینی خود بگنجانم؟

با استفاده از اصولی که در این مقاله توضیح دادیم و با کمک مربی هوشمند فیتاپ، می‌توانید ${plan.keyword} را به‌صورت شخصی‌سازی‌شده در برنامه خود داشته باشید. کافیست برنامه اختصاصی فیتاپ را تهیه کنید.

### آیا ${plan.keyword} برای مبتدی‌ها مناسب است؟

بله — با رعایت نکات ایمنی و شروع تدریجی، ${plan.keyword} برای ورزشکاران مبتدی هم مناسب است. توصیه می‌کنیم قبل از شروع، با مربی هوشمند فیتاپ مشورت کنید تا برنامه‌ای متناسب با سطح شما طراحی شود.
`;
    articleContent = articleContent.trimEnd() + "\n" + faqSection;
    log(ctx, "info", `📋 بخش FAQ به مقاله اضافه شد (برای FAQPage JSON-LD).`);
  }

  // ─── Compute reading time ───
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200));

  // ─── Compute scheduled publish date (space out over weeks per strategy calendar) ───
  // The article is saved as "draft" with a scheduledAt in the future. The
  // /api/cron/publish-scheduled endpoint will flip it to "published" when the
  // scheduledAt arrives. This gives a steady drip of fresh content rather than
  // dumping N articles on the same day.
  const scheduledAt = await computeScheduledAt(plan, strategy, ctx.publishImmediately === true);

  // ─── SEO fields: canonical URL, OG image, robots ───
  // canonical URL: همیشه مطلق (https://...) باشد تا گوگل آن را به‌عنوان canonical
  // صفحه قبول کند. در غیر این صورت، مقاله‌های تولیدشده canonical خالی دارند و
  // article-page.tsx به‌صورت fallback از ?article=slug استفاده می‌کند — اما
  // ذخیره URL مطلق در DB تمرین بهتری است و با مقاله‌های دستی هم‌خوانی دارد.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir").replace(/\/$/, "");
  const canonicalUrl = `${siteUrl}/?article=${plan.slug}`;
  const ogImage = coverUrl; // OG image همان تصویر کاور است
  const robots = "index,follow";

  // ─── Save article to DB ───
  const article = await db.article.create({
    data: {
      title: plan.title,
      slug: plan.slug,
      excerpt: plan.excerpt,
      content: articleContent,
      category: plan.category,
      tags: [plan.keyword, ...plan.secondaryKeywords].slice(0, 8).join(", "),
      // If a schedule was computed → keep draft + scheduledAt; otherwise publish now.
      status: scheduledAt ? "draft" : "published",
      scheduledAt: scheduledAt ?? undefined,
      authorId: ctx.adminId,
      coverImage: coverUrl,
      seoTitle: seo.seoTitle,
      seoDescription: seo.seoDescription,
      metaKeywords: seo.metaKeywords,
      ogImage,
      canonicalUrl,
      robots,
      readingMinutes,
    },
  });

  // Update plan as published
  if (plan.id) {
    await db.seoArticlePlan.update({
      where: { id: plan.id },
      data: { status: "published", articleId: article.id },
    });
  }

  if (scheduledAt) {
    log(
      ctx,
      "success",
      `🗓 مقاله زمان‌بندی شد: "${plan.title}" — ${wordCount} کلمه، ${readingMinutes} دقیقه مطالعه، ${coverUrl ? "با تصویر" : "بدون تصویر"} — انتشار: ${scheduledAt.toLocaleDateString("fa-IR")} ساعت ${scheduledAt.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`
    );
  } else {
    log(
      ctx,
      "success",
      `✅ مقاله منتشر شد: "${plan.title}" — ${wordCount} کلمه، ${readingMinutes} دقیقه مطالعه، ${coverUrl ? "با تصویر" : "بدون تصویر"}`
    );
  }

  return { articleId: article.id, coverUrl, wordCount, scheduledAt };
}

// ─── Main entry point: run the agent ───
export async function runSeoAgent(opts: {
  runId: string;
  adminId: string;
  mode: "full" | "continue" | "strategy_only";
  count: number;
  /**
   * If true, generated articles are published immediately instead of being
   * scheduled for future publishing. Defaults to false (schedule articles).
   */
  publishImmediately?: boolean;
}): Promise<RunContext> {
  const ctx: RunContext = {
    runId: opts.runId,
    mode: opts.mode,
    count: opts.count,
    logs: [],
    adminId: opts.adminId,
    startedAt: Date.now(),
    successCount: 0,
    failCount: 0,
    articles: [],
    errors: [],
    publishImmediately: opts.publishImmediately === true,
  };

  const startedRun = await db.seoAgentRun.update({
    where: { id: opts.runId },
    data: {
      status: "running",
      mode: opts.mode,
      requestedCount: opts.count,
      startedAt: new Date(),
    },
  }).catch(() => null);

  try {
    // Step 1: Always analyze site first (for accurate internal linking)
    const site = await analyzeSite(ctx);

    // Step 2: Generate/refresh strategy (in full mode) or load existing
    let strategy: SeoStrategyContent;
    if (opts.mode === "full") {
      strategy = await generateStrategy(ctx, site);
    } else {
      const existing = await db.seoStrategy.findFirst({
        where: { isActive: true },
        orderBy: { version: "desc" },
      });
      if (existing) {
        strategy = JSON.parse(existing.content) as SeoStrategyContent;
        log(ctx, "info", `📋 استفاده از استراتژی موجود (نسخه ${existing.version})`);
      } else {
        // No strategy yet — must generate
        log(ctx, "warn", "استراتژی موجود نیست — تولید استراتژی جدید");
        strategy = await generateStrategy(ctx, site);
      }
    }

    if (opts.mode === "strategy_only") {
      log(ctx, "success", "🏁 حالت strategy_only — استراتژی تولید شد، بدون تولید مقاله");
      await finishRun(ctx, "completed");
      return ctx;
    }

    // Step 3: Plan articles (or use existing planned ones)
    let plans: ArticlePlan[] = [];

    // First: use existing planned articles (continue mode)
    const existingPlans = await db.seoArticlePlan.findMany({
      where: { status: "planned" },
      orderBy: { priority: "desc" },
      take: opts.count,
    });

    if (existingPlans.length >= opts.count && opts.mode === "continue") {
      plans = existingPlans.map((p) => ({
        id: p.id,
        keyword: p.keyword,
        title: p.title,
        slug: p.slug,
        category: p.category,
        excerpt: p.excerpt,
        pillar: p.pillar,
        secondaryKeywords: p.secondaryKeywords.split(", ").filter(Boolean),
        internalLinks: JSON.parse(p.internalLinks || "[]"),
        coverImagePrompt: p.coverImagePrompt,
        inlineImagePrompts: [],
      }));
      log(ctx, "info", `📋 استفاده از ${plans.length} مقاله برنامه‌ریزی‌شده موجود در صف`);
    } else {
      // Plan new articles
      const needed = opts.count - existingPlans.length;
      if (needed > 0) {
        log(ctx, "info", `📅 نیاز به ${needed} مقاله جدید — برنامه‌ریزی...`);
        await planArticles(ctx, strategy, site, Math.max(needed, opts.count));
      }
      // Now fetch all planned
      const allPlanned = await db.seoArticlePlan.findMany({
        where: { status: "planned" },
        orderBy: { priority: "desc" },
        take: opts.count,
      });
      plans = allPlanned.map((p) => ({
        id: p.id,
        keyword: p.keyword,
        title: p.title,
        slug: p.slug,
        category: p.category,
        excerpt: p.excerpt,
        pillar: p.pillar,
        secondaryKeywords: p.secondaryKeywords.split(", ").filter(Boolean),
        internalLinks: JSON.parse(p.internalLinks || "[]"),
        coverImagePrompt: p.coverImagePrompt,
        inlineImagePrompts: [],
      }));
    }

    if (plans.length === 0) {
      log(ctx, "warn", "هیچ مقاله‌ای برای تولید یافت نشد");
      await finishRun(ctx, "completed");
      return ctx;
    }

    log(ctx, "info", `🚀 شروع تولید ${plans.length} مقاله`);

    // Step 4: Generate each article (sequentially to avoid rate limits)
    // Re-analyze site before each article to ensure accurate internal linking (new articles get added)
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      log(ctx, "info", `━━━ مقاله ${i + 1}/${plans.length} ━━━`);
      try {
        // Refresh site analysis (so newly-published articles can be linked)
        const freshSite = i === 0 ? site : await analyzeSite(ctx);
        const result = await generateArticle(ctx, plan, freshSite, strategy);
        ctx.articles.push({
          id: result.articleId,
          title: plan.title,
          slug: plan.slug,
          keyword: plan.keyword,
          coverImage: result.coverUrl ? "✓" : "✗",
          words: result.wordCount,
          scheduledAt: result.scheduledAt ? result.scheduledAt.toISOString() : null,
        });
        ctx.successCount++;
      } catch (e: any) {
        log(ctx, "error", `مقاله "${plan.title}" شکست خورد: ${e.message}`);
        ctx.errors.push(`${plan.title}: ${e.message}`);
        ctx.failCount++;
        if (plan.id) {
          await db.seoArticlePlan.update({
            where: { id: plan.id },
            data: { status: "failed", errorMessage: e.message.slice(0, 500) },
          }).catch(() => null);
        }
      }
      // Persist progress to DB after each article
      await persistRunProgress(ctx);
    }

    log(
      ctx,
      "success",
      `🏁 پایان اجرا — ${ctx.successCount} موفق، ${ctx.failCount} ناموفق`
    );

    await finishRun(ctx, ctx.failCount === 0 ? "completed" : "partial");
    return ctx;
  } catch (e: any) {
    log(ctx, "error", `خطای بحرانی در اجرای ایجنت: ${e.message}`);
    ctx.errors.push(`CRITICAL: ${e.message}`);
    await finishRun(ctx, "failed");
    return ctx;
  }
}

async function persistRunProgress(ctx: RunContext) {
  await db.seoAgentRun
    .update({
      where: { id: ctx.runId },
      data: {
        successCount: ctx.successCount,
        failCount: ctx.failCount,
        logs: JSON.stringify(ctx.logs.slice(-100)), // keep last 100 logs
        results: JSON.stringify({
          articles: ctx.articles,
          errors: ctx.errors,
        }),
      },
    })
    .catch(() => null);
}

async function finishRun(ctx: RunContext, status: string) {
  const durationMs = Date.now() - ctx.startedAt;
  await db.seoAgentRun
    .update({
      where: { id: ctx.runId },
      data: {
        status,
        successCount: ctx.successCount,
        failCount: ctx.failCount,
        logs: JSON.stringify(ctx.logs),
        results: JSON.stringify({
          articles: ctx.articles,
          errors: ctx.errors,
        }),
        durationMs,
        finishedAt: new Date(),
      },
    })
    .catch(() => null);
  // Update strategy lastRunAt
  await db.seoStrategy
    .updateMany({
      where: { isActive: true },
      data: { lastRunAt: new Date() },
    })
    .catch(() => null);
}

// ─── Background runner (in-memory) ───
// Track running status globally so we don't start concurrent runs
declare global {
  var __seoAgentRunning: boolean | undefined;
  var __seoAgentRunId: string | undefined;
}

export function isAgentRunning(): boolean {
  return !!globalThis.__seoAgentRunning;
}

export function getCurrentRunId(): string | undefined {
  return globalThis.__seoAgentRunId;
}

export async function startBackgroundRun(opts: {
  adminId: string;
  mode: "full" | "continue" | "strategy_only";
  count: number;
  publishImmediately?: boolean;
}): Promise<{ runId: string; alreadyRunning: boolean }> {
  if (isAgentRunning()) {
    return { runId: getCurrentRunId() || "", alreadyRunning: true };
  }
  // Create run record
  const run = await db.seoAgentRun.create({
    data: {
      mode: opts.mode,
      requestedCount: opts.count,
      status: "running",
      startedAt: new Date(),
    },
  });
  globalThis.__seoAgentRunning = true;
  globalThis.__seoAgentRunId = run.id;

  // Fire and forget — run in background
  runSeoAgent({
    runId: run.id,
    adminId: opts.adminId,
    mode: opts.mode,
    count: opts.count,
    publishImmediately: opts.publishImmediately,
  })
    .catch((e) => {
      console.error("[SEO-AGENT] background run crashed:", e);
    })
    .finally(() => {
      globalThis.__seoAgentRunning = false;
      globalThis.__seoAgentRunId = undefined;
    });

  return { runId: run.id, alreadyRunning: false };
}
