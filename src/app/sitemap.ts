import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

// ─── force-dynamic: sitemap در هر درخواست از دیتابیس خوانده شود ───
// بدون این، Next.js در زمان build sitemap را prerender می‌کند.
// اگر دیتابیس در زمان build در دسترس نباشد، فقط صفحات ثابت را می‌بیند.
// با force-dynamic، sitemap در هر درخواست از دیتابیس فعلی خوانده می‌شود.
export const dynamic = "force-dynamic";
export const revalidate = 3600; // cache برای ۱ ساعت

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

/**
 * Dynamic Next.js 16 sitemap.
 *
 * شامل:
 *  - صفحه اصلی
 *  - ابزارهای رایگان (TDEE، بانک حرکات، کالری غذاها)
 *  - صفحه مجله مقالات
 *  - صفحه قوانین
 *  - مقالات منتشرشده (با slug یکتا)
 *  - دسته‌بندی‌های مقالات
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // ─── صفحات ثابت ───
  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    // ابزارهای رایگان
    {
      url: `${SITE_URL}/?tool=tdee`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/?tool=exercises`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/?tool=foods`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    // صفحه مجله مقالات
    {
      url: `${SITE_URL}/?screen=articles`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    // صفحه قوانین
    {
      url: `${SITE_URL}/?screen=terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    // صفحه تماس با ما
    {
      url: `${SITE_URL}/?screen=contact`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // ─── مقالات منتشرشده ───
  try {
    const articles = await db.article.findMany({
      where: { status: "published" },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { slug: true, updatedAt: true, category: true },
    });

    for (const a of articles) {
      entries.push({
        url: `${SITE_URL}/?article=${encodeURIComponent(a.slug)}`,
        lastModified: a.updatedAt,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }

    // ─── دسته‌بندی‌های مقالات ───
    // نکته: در XML، & باید به‌صورت &amp; نوشته شود
    const categories = [...new Set(articles.map((a) => a.category))];
    for (const cat of categories) {
      if (cat) {
        entries.push({
          url: `${SITE_URL}/?screen=articles&amp;category=${encodeURIComponent(cat)}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }

    // ─── صفحات اختصاصی هر حرکت ورزشی (SEO) ───
    const exercises = await db.exerciseLibrary.findMany({
      orderBy: { name: "asc" },
      take: 1000,
      select: { id: true, name: true, updatedAt: true },
    });
    for (const ex of exercises) {
      entries.push({
        url: `${SITE_URL}/?exercise=${encodeURIComponent(ex.id)}`,
        lastModified: ex.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.7,
      });
    }

    // ─── صفحات اختصاصی هر غذا (SEO) ───
    const foods = await db.foodLibrary.findMany({
      orderBy: { name: "asc" },
      take: 1000,
      select: { id: true, name: true, updatedAt: true },
    });
    for (const f of foods) {
      entries.push({
        url: `${SITE_URL}/?food=${encodeURIComponent(f.id)}`,
        lastModified: f.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.6,
      });
    }
  } catch (err) {
    // خطا را لاگ کن تا بفهمیم مشکل چیست
    console.error("[sitemap] DB error:", err instanceof Error ? err.message : String(err));
  }

  return entries;
}
