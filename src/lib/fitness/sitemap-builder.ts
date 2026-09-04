import { db } from "@/lib/db";

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
 */

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

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
  const now = new Date();
  const entries: SitemapEntry[] = [];

  // ─── صفحات ثابت ───
  entries.push({ url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1.0 });

  const staticPages: { qs: string; freq: SitemapEntry["changeFrequency"]; pri: number }[] = [
    { qs: "tool=tdee", freq: "monthly", pri: 0.8 },
    { qs: "tool=exercises", freq: "weekly", pri: 0.8 },
    { qs: "tool=foods", freq: "weekly", pri: 0.8 },
    { qs: "screen=articles", freq: "daily", pri: 0.7 },
    { qs: "screen=terms", freq: "yearly", pri: 0.3 },
    { qs: "screen=contact", freq: "yearly", pri: 0.3 },
  ];
  for (const p of staticPages) {
    entries.push({
      url: `${SITE_URL}/?${p.qs}`,
      lastModified: now,
      changeFrequency: p.freq,
      priority: p.pri,
    });
  }

  // ─── مقالات منتشرشده (تا ۱۰۰۰۰) ───
  const articles = await fetchSection("articles", () =>
    db.article.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 10000,
      select: { slug: true, updatedAt: true },
    })
  );
  if (articles) {
    for (const a of articles) {
      entries.push({
        url: `${SITE_URL}/?article=${encodeURIComponent(a.slug)}`,
        lastModified: a.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  // ─── دسته‌بندی‌های مقالات ───
  const categories = await fetchSection("categories", () =>
    db.article.groupBy({ by: ["category"], where: { status: "published" } })
  );
  if (categories) {
    for (const cat of categories) {
      if (cat.category) {
        entries.push({
          url: `${SITE_URL}/?screen=articles&category=${encodeURIComponent(cat.category)}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }
  }

  // ─── صفحات اختصاصی هر حرکت ورزشی (تا ۱۰۰۰۰) ───
  const exercises = await fetchSection("exercises", () =>
    db.exerciseLibrary.findMany({
      orderBy: { name: "asc" },
      take: 10000,
      select: { id: true, name: true, updatedAt: true },
    })
  );
  if (exercises) {
    for (const ex of exercises) {
      entries.push({
        url: `${SITE_URL}/?exercise=${encodeURIComponent(ex.id)}`,
        lastModified: ex.updatedAt ?? now,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  // ─── صفحات اختصاصی هر غذا (تا ۱۰۰۰۰) ───
  const foods = await fetchSection("foods", () =>
    db.foodLibrary.findMany({
      orderBy: { name: "asc" },
      take: 10000,
      select: { id: true, name: true, updatedAt: true },
    })
  );
  if (foods) {
    for (const f of foods) {
      entries.push({
        url: `${SITE_URL}/?food=${encodeURIComponent(f.id)}`,
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
      `[sitemap] ✅ کامل — ${entries.length} URL (مقالات=${articles?.length ?? 0}، دسته‌ها=${categories?.length ?? 0}، حرکات=${exercises?.length ?? 0}، غذاها=${foods?.length ?? 0})`
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
