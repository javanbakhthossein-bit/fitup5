import { db } from "@/lib/db";

/**
 * content-crosslinks — v251-seo
 *
 * لینک‌سازی متقابل محتوا↔محتوا (گزارش ممیزی سئو: غذا↔مقاله = ۰ و حرکت↔مقاله = ۰
 * — خوشه‌های موضوعی ناقص بودند). این هلپر با تطبیق توکن‌های «نام غذا/حرکت/عضله»
 * روی عنوان/تگ/چکیدهٔ مقالاتِ منتشرشده، مرتبط‌ترین مقالات را برمی‌گرداند.
 *
 * اصول:
 *  • فقط مقالات status=published (هرگز محتوای پیش‌نویس لینک نمی‌شود)
 *  • امتیازدهی شفاف: عنوان×۳ > تگ×۲ > چکیده×۱ — بدون هیچ ادعای هوشمند جعلی
 *  • خروجی محدود و سبک (حداکثر limit) — برای رندر SSR در صفحات عمومی
 *  • بانک مقالات ~۷۲ ردیف است؛ کوئری کامل + امتیازدهی درون-حافظه کاملاً ارزان است
 */

export type CrosslinkArticle = {
  id: string;
  slug: string;
  title: string;
  category: string;
  coverImage: string;
};

/** نرمال‌سازی توکن فارسی: نیم‌فاصله/ی/ک عربی و علائم — برای تطبیق بهتر */
function normalizeFa(s: string): string {
  return s
    .replace(/[\u200c\u0640]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[«»"'(),.;:!؟?]/g, " ")
    .trim();
}

export async function findRelatedArticles(
  keywords: string[],
  limit = 3,
  excludeSlug?: string
): Promise<CrosslinkArticle[]> {
  const cleaned = [...new Set(keywords.map((k) => normalizeFa(k)).filter((k) => k.length >= 3))];
  if (cleaned.length === 0) return [];

  try {
    const articles = await db.article.findMany({
      where: { status: "published" },
      select: { id: true, slug: true, title: true, category: true, coverImage: true, tags: true, excerpt: true },
    });

    const scored: { a: (typeof articles)[number]; score: number }[] = [];
    for (const a of articles) {
      if (excludeSlug && a.slug === excludeSlug) continue;
      const title = normalizeFa(a.title || "");
      const tags = normalizeFa(a.tags || "");
      const excerpt = normalizeFa(a.excerpt || "");
      let score = 0;
      for (const kw of cleaned) {
        if (title.includes(kw)) score += 3;
        if (tags.includes(kw)) score += 2;
        if (excerpt.includes(kw)) score += 1;
      }
      if (score > 0) scored.push({ a, score });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, limit).map(({ a }) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      category: a.category,
      coverImage: a.coverImage,
    }));
  } catch {
    // لینک‌سازی هرگز نباید رندر صفحه را بشکند
    return [];
  }
}
