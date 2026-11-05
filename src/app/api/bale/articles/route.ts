import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /api/bale/articles — فید سبک مقاله‌های «منتشرشده» برای سرویس اتوپست کانال بله
 *
 * ─── دیرکتیو مالک (v244) ─────────────────────────────────────────────
 * «مقاله‌های منتشرشده فقط در اپ بله بیان؛ مقاله‌های در صف انتشار نباید بیان
 *  و مقاله‌های جدید منتشرشده باید بیان در این چرخه.»
 *
 * تا v243 سرویس بله لیست مقاله‌ها را از فایل ثابت articles.json می‌خواند —
 * مقالهٔ جدیدِ منتشرشده فقط با بازتولید دستی وارد چرخه می‌شد و مقاله‌ای که
 * به صف انتشار برمی‌گشت هم هنوز در فایل بود. از این پس سرویس بله لیست را
 * «زنده» از همین endpoint می‌خواند:
 *   ✅ فقط status = "published" (صف انتشار = draft با scheduledAt هرگز
 *      برنمی‌گردد — دیرکتیو صریح مالک)
 *   ✅ مرتب‌سازی بر اساس publishedAt نزولی → مقالهٔ تازه‌منتشرشده در
 *      نخستین اسلات ۱۷:۰۰ وارد چرخه می‌شود
 *   ✅ بدون محتوا (content حذف) — فقط متادیتای پست: slug/anchor/cat/cover/excerpt
 *
 * امنیت: عمومی است (متادیتای مقاله‌های منتشرشده روی خود سایت هم عمومی است —
 * هیچ فیلد خصوصی‌ای ندارد) + rate limit سبک ضد اسپم.
 * پیمان‌نامهٔ خروجی همان articles.json سرویس بله است (anchor/cat/cover/excerpt)
 * تا سرویس بدون تغییر ساختاری مصرفش کند.
 */

type Cat = "exercise" | "nutrition" | "fatloss" | "muscle" | "injury" | "cardio" | "habit" | "brand" | "any";

/** مپ دستهٔ فارسی مقاله → دسته‌های پست بله (همان شِمای articles.json v243) */
const CATEGORY_MAP: Record<string, Cat[]> = {
  "تمرین": ["exercise"],
  "حرکات": ["exercise"],
  "روش‌های-تمرینی": ["exercise"],
  "تغذیه": ["nutrition"],
  "مکمل": ["nutrition"],
  "بازیابی": ["injury"],
  "انگیزشی": ["habit"],
  "عمومی": ["brand", "habit"],
  "اندازه‌گیری": ["fatloss"],
  "ورزشکاران": ["muscle"],
  "آموزش-استروئیدها": ["muscle"],
  "اخبار": ["any"],
};

/** غنی‌سازی دسته با کلیدواژهٔ عنوان/برچسب — همان روح مپ دستی v243 */
function enrichCats(title: string, tags: string, base: Cat[]): Cat[] {
  const t = `${title} ${tags}`;
  const cats = new Set<Cat>(base);
  if (/عضله|قدرت|هیپرتروفی|بدنسازی|عضله‌سازی/.test(t)) cats.add("muscle");
  if (/کالری|چربی|لاغری|وزن|رژیم|چربی‌سوزی/.test(t)) cats.add("fatloss");
  if (/آسیب|فرم صحیح|پیشگیری|مفصل|گرم کردن|ریکاوری/.test(t)) cats.add("injury");
  if (!cats.size) cats.add("any");
  return [...cats];
}

export async function GET(req: NextRequest) {
  // ─── Rate limit (per-IP) — endpoint عمومی و سبک، ضد اسپم ───
  const rl = rateLimit(`bale-articles:${getClientIp(req)}`, 60, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    // دیرکتیو مالک: فقط مقاله‌های منتشرشده — صف انتشار (draft/scheduledAt) هرگز
    const articles = await db.article.findMany({
      where: { status: "published" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        slug: true,
        title: true,
        seoTitle: true,
        excerpt: true,
        category: true,
        tags: true,
        coverImage: true,
        publishedAt: true,
      },
    });

    return Response.json(
      {
        count: articles.length,
        generatedAt: new Date().toISOString(),
        articles: articles.map((a) => ({
          slug: a.slug,
          anchor: (a.seoTitle || "").trim() || a.title,
          cat: enrichCats(`${a.title} ${a.seoTitle || ""}`, a.tags || "", CATEGORY_MAP[a.category] || ["any"]),
          cover: a.coverImage || "",
          excerpt: a.excerpt || "",
        })),
      },
      // کش کوتاه سمت پروکسی/مرورگر — سرویس بله هر بار تازه می‌خواند ولی
      // پاسخ روی فشار تکراری سبک می‌ماند
      { headers: { "Cache-Control": "public, max-age=600" } }
    );
  } catch (e) {
    console.error("[bale/articles] error:", e);
    return Response.json({ error: "خطا در دریافت مقاله‌ها" }, { status: 500 });
  }
}
