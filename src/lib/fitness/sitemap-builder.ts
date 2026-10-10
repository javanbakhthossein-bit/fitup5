import { db } from "@/lib/db";
import { DISCIPLINE_PAGE_SLUGS } from "./disciplines-data";
import { CATEGORY_LABELS } from "./article-shared";

/**
 * ─── بیلدر مشترک sitemap (v12.3 — فیکس ریشه‌ای ۴۰۴ سرچ کنسول) ───
 *
 * ریشه باگ: rewrite «/sitemap.xml → /api/sitemap» در next.config.ts روی
 * سرور پروداکشن (standalone) اجرا نمی‌شود — همان باگ اثبات‌شده v21 برای
 * rewrite های /uploads. نتیجه: /api/sitemap سالم (۱۴۰۰ URL) ولی
 * /sitemap.xml که گوگل می‌خواند 404 می‌داد (GSC: «Sitemap could not be
 * read — HTTP Error 404»).
 *
 * فیکس: منطق ساخت sitemap به این ماژول مشترک منتقل شد و دو ورودی دارد:
 *   ۱. /api/sitemap (route handler قدیمی — با هدرهای سفارشی X-Sitemap-*)
 *   ۲. app/sitemap.ts (route واقعیِ استاندارد Next.js — بدون نیاز به
 *      rewrite، در هر حالتی از دیپلوی کار می‌کند)
 *
 * route واقعی app/sitemap.ts با force-dynamic هیچ‌وقت در build-time
 * رندر یا کش نمی‌شود — هر درخواستِ گوگل همیشه از دیتابیس زنده خوانده
 * می‌شود. برای حفاظت از دیتابیس، کش حافظه‌ای ۱۰ دقیقه‌ای داریم (نه ISR).
 *
 * خودترمیمی: هر بخش (مقالات/دسته‌ها/حرکات/غذاها) try/catch جداگانه با
 * یک retry دارد؛ خطای یک بخش بقیه را از کار نمی‌اندازد.
 *
 * v216-SEO — دیرکتیو مالک «سایت‌مپ باید همه صفحات رو بخونه، هیچ صفحه‌ای جا نمونه»:
 *   ۱. سقف‌های take:10000 از مقالات/حرکات/غذاها حذف شد — همهٔ ردیف‌های منتشرشده
 *      بدون استثنا وارد سایت‌مپ می‌شوند.
 *   ۲. مقالات noindex (فیلد robots) حذف شدند — گوگل URLهای noindex داخل
 *      sitemap را خطا می‌گیرد؛ صفحهٔ /article/[slug] هم برای همین مقالات
 *      noindex می‌فرستد، پس sitemap و صفحه هم‌نظر شدند. Draftها هم از قبل
 *      با status:"published" خارج‌اند.
 *   ۳. صفحات صفحه‌بندی مجله اضافه شد: /articles/page/[2..N] و
 *      /articles/category/<cat>/page/[2..N] با همان PAGE_SIZE زندهٔ لیست (24)
 *      و همان فرمول Math.ceil — هیچ صفحهٔ صفحه‌بندی‌ای جا نمی‌ماند و هیچ
 *      صفحهٔ بیرون از محدوده (404) وارد سایت‌مپ نمی‌شود.
 *   ۴. گارد دی‌دابلیک با Set — هر URL دقیقاً یک‌بار.
 */

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

// ─── v218 — lastmod ثابت صفحات بدون تاریخ واقعی (ممیزی سئو) ───
// قبلاً صفحات ثابت/لندینگ/دسته‌ها/صفحه‌بندی در «هر درخواست» lastmod=now
// می‌گرفتند؛ گوگل تغییرات تاریخ ثابتِ بدون تغییر محتوا را نادیده می‌گیرد و
// سیگنال تازگی کل sitemap بی‌معنا می‌شد. حالا یک‌بار در زمانِ بالا آمدنِ
// پروسه محاسبه می‌شود (deپلوی = تاریخ جدید)؛ محتوای واقعی (مقاله/حرکت/غذا)
// همچنان updatedAt واقعی خودش را دارد. مجموعهٔ URLها تغییری نمی‌کند.
const STATIC_LASTMOD = new Date();

// v216-SEO — اندازهٔ صفحهٔ مجله: باید عیناً با ثابت زندهٔ لیست یکی باشد
// (ARTICLES_PAGE_SIZE در src/components/fitness/articles/articles-index.tsx — اکنون 24).
// اگر روزی لیست زنده تغییر کرد این عدد هم باید تغییر کند وگرنه صفحه‌بندی
// سایت‌مپ با صفحه‌بندی واقعی ناهم‌خوان می‌شود.
const ARTICLES_PAGE_SIZE = 24;

// ─── کش حافظه‌ای ۱۰ دقیقه‌ای (به‌جای ISR) ───
let cachedEntries: { entries: SitemapEntry[]; count: number; at: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchSection<T>(section: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      console.error(`[sitemap] ❌ بخش «${section}» خطا داد (تلاش ${attempt}/2): ${msg}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

export async function buildSitemapEntries(): Promise<{
  entries: SitemapEntry[];
  count: number;
  complete: boolean;
}> {
  const now = new Date(); // فقط برای فال‌بک ردیف‌های محتوایی بدون updatedAt
  const entries: SitemapEntry[] = [];
  // v216-SEO — گارد دی‌دابلیک: هر URL فقط یک‌بار (گوگل برای URL تکراری هشدار
  // «Duplicate URL» می‌دهد و اعتبار sitemap را پایین می‌آورد).
  const seenUrls = new Set<string>();
  const pushUnique = (e: SitemapEntry) => {
    if (seenUrls.has(e.url)) return;
    seenUrls.add(e.url);
    entries.push(e);
  };
  let paginationCount = 0; // فقط برای لاگ — تعداد URLهای صفحه‌بندی

  // ─── صفحات ثابت ───
  pushUnique({ url: `${SITE_URL}/`, lastModified: STATIC_LASTMOD, changeFrequency: "daily", priority: 1.0 });

  // v105: لیست مقالات حالا route واقعی /articles دارد (قبلاً ?screen=articles بود).
  pushUnique({ url: `${SITE_URL}/articles`, lastModified: STATIC_LASTMOD, changeFrequency: "daily", priority: 0.7 });

  // v106: ابزارها و صفحات ثابت حالا route واقعی دارند (قبلاً ۵ لینک
  // کوئری‌استایل /?tool=… و /?screen=… در سایت‌مپ بود — ایندکس‌نشدنی)
  const staticPages: { path: string; freq: SitemapEntry["changeFrequency"]; pri: number }[] = [
    { path: "/tdee", freq: "monthly", pri: 0.8 },
    { path: "/exercises", freq: "weekly", pri: 0.8 },
    { path: "/foods", freq: "weekly", pri: 0.8 },
    { path: "/terms", freq: "yearly", pri: 0.3 },
    { path: "/contact", freq: "yearly", pri: 0.3 },
    { path: "/about", freq: "yearly", pri: 0.3 },
  ];
  for (const p of staticPages) {
    pushUnique({
      url: `${SITE_URL}${p.path}`,
      lastModified: STATIC_LASTMOD,
      changeFrequency: p.freq,
      priority: p.pri,
    });
  }

  // ─── v101 — لندینگ‌های اختصاصی رشته‌های ورزشی (/sport/pilates و…) ───
  // قبلاً URL پویا (/?sport=…) در sitemap بود؛ حالا هر رشته route واقعی و
  // استاتیک /sport/<slug> دارد (src/app/sport/[slug]/page.tsx) و گوگل با
  // همین URL کامل آن‌ها را ایندکس می‌کند. priority 0.9 (مهم‌تر از بقیهٔ
  // صفحات داخلی، کمتر از صفحهٔ اصلی) + آپدیت هفتگی.
  for (const slug of DISCIPLINE_PAGE_SLUGS) {
    pushUnique({
      url: `${SITE_URL}/sport/${slug}`,
      lastModified: STATIC_LASTMOD,
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  // ─── مقالات منتشرشده (همه — بدون سقف) ───
  // v105: URL واقعی /article/<slug> — قبلاً ?article=<slug> بود که گوگل
  // آن را صفحهٔ مستقل حساب نمی‌کرد و ۱٬۴۰۰+ مقاله ایندکس نمی‌شدند.
  // v216-SEO: take حذف شد + noindex‌ها (فیلد robots هر مقداری شامل noindex)
  // مستثنا شدند — گوگل forbids noindex URLs in sitemaps.
  const articles = await fetchSection("articles", () =>
    db.article.findMany({
      where: { status: "published", robots: { not: { contains: "noindex" } } },
      orderBy: { publishedAt: "desc" },
      select: { slug: true, updatedAt: true },
    })
  );
  if (articles) {
    for (const a of articles) {
      pushUnique({
        url: `${SITE_URL}/article/${encodeURIComponent(a.slug)}`,
        lastModified: a.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  // ─── دسته‌بندی‌های مقالات ───
  // v105: آرشیو واقعی هر دسته (/articles/category/<cat>) به‌جای
  // ?screen=articles&category=<cat> که در XML هم مشکل EntityRef می‌ساخت.
  // v106: فقط دسته‌هایی که صفحهٔ SSR آن‌ها را می‌شناسد (کلیدهای CATEGORY_LABELS —
  // فارسی + انگلیسی قدیمی). دستهٔ ناشناخته در /articles/category/[cat] با 404
  // روبه‌رو می‌شود و سایت‌مپ هرگز نباید لینک 404 داشته باشد.
  // v216-SEO — شمارش هر دسته با همان where بخش مقالات (published + بدون noindex)
  // تا صفحه‌بندی آرشیو دسته دقیقاً با صفحهٔ زنده هم‌خوان باشد؛ دستهٔ «فقط-noindex»
  // اصلاً در گروه‌بندی نمی‌آید (چون همهٔ مقاله‌هایش از sitemap مستثناست).
  const categories = await fetchSection("categories", () =>
    db.article.groupBy({
      by: ["category"],
      where: { status: "published", robots: { not: { contains: "noindex" } } },
      _count: { _all: true },
    })
  );
  if (categories) {
    for (const cat of categories) {
      if (cat.category && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, cat.category)) {
        const categoryBase = `${SITE_URL}/articles/category/${encodeURIComponent(cat.category)}`;
        pushUnique({
          url: categoryBase,
          lastModified: STATIC_LASTMOD,
          changeFrequency: "weekly",
          priority: 0.5,
        });
        // v216-SEO — صفحه‌بندی آرشیو دسته: /articles/category/<cat>/page/[2..N]
        // (صفحهٔ ۱ ریدایرکت دائمی به base دارد — فقط ۲..N). N با همان فرمول
        // Math.ceil(total / PAGE_SIZE) صفحهٔ زنده حساب می‌شود — هیچ صفحهٔ 404‌ای
        // وارد sitemap نمی‌شود و هیچ صفحهٔ معتبری جا نمی‌ماند.
        const categoryTotalPages = Math.ceil(cat._count._all / ARTICLES_PAGE_SIZE);
        for (let n = 2; n <= categoryTotalPages; n++) {
          pushUnique({
            url: `${categoryBase}/page/${n}`,
            lastModified: STATIC_LASTMOD,
            changeFrequency: "weekly",
            priority: 0.4,
          });
          paginationCount++;
        }
      }
    }
  }

  // ─── v216-SEO — صفحه‌بندی کل مجله: /articles/page/[2..N] ───
  // همان ریاضی صفحهٔ زندهٔ /articles/page/[page] (totalPages از data.total با
  // ARTICLES_PAGE_SIZE). articles پس از حذف take، لیست «همهٔ» مقاله‌های
  // منتشرشدهٔ قابل‌ایندکس است — همان total صفحهٔ زنده.
  if (articles && articles.length > ARTICLES_PAGE_SIZE) {
    const totalArticlePages = Math.ceil(articles.length / ARTICLES_PAGE_SIZE);
    for (let n = 2; n <= totalArticlePages; n++) {
      pushUnique({
        url: `${SITE_URL}/articles/page/${n}`,
        lastModified: STATIC_LASTMOD,
        changeFrequency: "daily",
        priority: 0.5,
      });
      paginationCount++;
    }
  }

  // ─── صفحات اختصاصی هر حرکت ورزشی (همه — بدون سقف) ───
  // v105: URL واقعی /exercise/<id> به‌جای ?exercise=<id>
  // v216-SEO: take حذف شد. غیرفعال‌ها همچنان نیستند — صفحهٔ زنده برای
  // isActive=false noindex می‌فرستد (v135) و sitemap نباید noindex داشته باشد.
  const exercises = await fetchSection("exercises", () =>
    db.exerciseLibrary.findMany({
      where: { isActive: true }, // v135 — غیرفعال‌ها در sitemap نیستند
      orderBy: { name: "asc" },
      select: { id: true, name: true, updatedAt: true },
    })
  );
  if (exercises) {
    for (const ex of exercises) {
      pushUnique({
        url: `${SITE_URL}/exercise/${encodeURIComponent(ex.id)}`,
        lastModified: ex.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  // ─── صفحات اختصاصی هر غذا (همه — بدون سقف) ───
  // v105: URL واقعی /food/<id> به‌جای ?food=<id>
  // v216-SEO: take حذف شد — همهٔ بانک غذا (پس از سینک‌های v137) کامل می‌آید.
  const foods = await fetchSection("foods", () =>
    db.foodLibrary.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, updatedAt: true },
    })
  );
  if (foods) {
    for (const f of foods) {
      pushUnique({
        url: `${SITE_URL}/food/${encodeURIComponent(f.id)}`,
        lastModified: f.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  const failed = ["articles", "categories", "exercises", "foods"].filter(
    (s) =>
      (s === "articles" && !articles) ||
      (s === "categories" && !categories) ||
      (s === "exercises" && !exercises) ||
      (s === "foods" && !foods)
  );
  if (failed.length > 0) {
    console.error(
      `[sitemap] ⚠️ ${failed.length} بخش بعد از retry شکست خورد (${failed.join("، ")}) — فقط ${entries.length} URL برگشت (انتظار: ۱۳۰۰+).`
    );
  } else {
    console.log(
      `[sitemap] ✅ کامل — ${entries.length} URL (مقالات=${articles?.length ?? 0}، دسته‌ها=${categories?.length ?? 0}، حرکات=${exercises?.length ?? 0}، غذاها=${foods?.length ?? 0}، رشته‌ها=${DISCIPLINE_PAGE_SLUGS.length}، صفحه‌بندی=${paginationCount}، دی‌دابلیک=${seenUrls.size === entries.length ? "۰ تکراری" : "⚠️"})`
    );
  }

  // complete = همه‌ی بخش‌ها موفق و داده‌دار بودند (قابل کش)
  const complete =
    !!articles && !!categories && !!exercises && !!foods &&
    (articles.length > 0 || exercises.length > 0 || foods.length > 0);
  return { entries, count: entries.length, complete };
}

/**
 * ─── XML-escape استاندارد (v12.4 — فیکس EntityRef سرچ کنسول) ───
 *
 * ریشهٔ باگ: سریالایزر داخلی Next.js برای route متادیتای app/sitemap.ts
 * کاراکتر «&» را escape نمی‌کند → URLهایی مثل
 * «/?screen=articles&category=...» یک «&» خام وارد XML می‌کردند و پارسر
 * (و گوگل) خطای «error on line 322: EntityRef: expecting ';'» می‌داد و
 * کل سایت‌مپ را قابل خواندن نمی‌کرد.
 *
 * فیکس: از این به بعد رشتهٔ نهایی XML همیشه با این escape صریح ساخته
 * می‌شود — هم برای /sitemap.xml و هم /api/sitemap (یک منبع مشترک).
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * ساخت رشتهٔ نهایی sitemap.xml از روی entries — مشترک بین
 * app/sitemap.xml/route.ts و app/api/sitemap/route.ts
 * (app/sitemap.ts متادیتای قدیمی حذف شد — سریالایزر آن & را escape نمی‌کرد)
 */
export function buildSitemapXml(entries: SitemapEntry[]): string {
  const xmlParts = entries
    .map((e) => {
      const lastmod = e.lastModified.toISOString();
      const changefreq = e.changeFrequency;
      const priority = e.priority.toFixed(1);
      return `<url><loc>${xmlEscape(e.url)}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlParts}\n</urlset>`;
}

/**
 * گرفتن sitemap با کش + fallback به نسخهٔ کامل قبلی (هرگز ناقص کش نمی‌شود)
 */
export async function getSitemapEntries(): Promise<{
  entries: SitemapEntry[];
  count: number;
  fromCache: "hit" | "stale-fallback" | "miss" | "miss-incomplete";
}> {
  if (cachedEntries && Date.now() - cachedEntries.at < CACHE_TTL_MS) {
    return { entries: cachedEntries.entries, count: cachedEntries.count, fromCache: "hit" };
  }
  const { entries, count, complete } = await buildSitemapEntries();
  if (complete) {
    cachedEntries = { entries, count, at: Date.now() };
    return { entries, count, fromCache: "miss" };
  }
  if (cachedEntries) {
    // نسخه‌ی قبلیِ کامل موجود است؟ به‌جای ناقصِ تازه، همان را برگردان
    console.warn("[sitemap] بخش‌ها ناقص بود — نسخه‌ی کش‌شده‌ی قبلی (کامل) برگردانده شد");
    return {
      entries: cachedEntries.entries,
      count: cachedEntries.count,
      fromCache: "stale-fallback",
    };
  }
  return { entries, count, fromCache: "miss-incomplete" };
}
