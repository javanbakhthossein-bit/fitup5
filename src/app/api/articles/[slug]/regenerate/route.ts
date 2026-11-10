import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { regenerateArticleFull } from "@/lib/fitness/article-regenerate";

/**
 * POST /api/articles/[slug]/regenerate — «ریجنریت کامل مقاله»
 * ══════════════════════════════════════════════════════════════════════════
 *
 * بازتولید کامل یک مقالهٔ موجود از صفر توسط هوش مصنوعی:
 *   ۱. متن کاملاً جدید (۱۸۰۰+ کلمه، سئوشده، با لینک‌سازی داخلی و فکت‌های فیتاپ)
 *   ۲. تصویر کاور جدید + تصاویر inline جدید (به‌جز در حالت onlyText)
 *   ۳. فیلدهای سئوی جدید (seoTitle / seoDescription / metaKeywords)
 *
 * حفاظت‌ها:
 *   - slug/URL، status، publishedAt، views و author مقاله هرگز تغییر نمی‌کنند
 *   - نسخهٔ قبلی به‌صورت ArticleRevision پشتیبان‌گیری می‌شود (قابل بازیابی)
 *   - فقط ADMIN — requireAdmin
 *   - قفل in-memory ضد اجرای هم‌زمان روی یک slug (دابل‌کلیک/دو تب ادمین)
 *
 * body (optional):
 *   - onlyText: boolean → فقط متن و سئو بازتولید می‌شود؛ کاور و تصاویر
 *     قدیمی حفظ می‌شوند (برای وقتی تصاویر تازه نمی‌خواهیم).
 *
 * تولید متن + چند تصویر با AI زمان‌بر است — timeout ۵ دقیقه (الگوی rebuild-images)
 */
export const maxDuration = 300;

// ─── قفل in-memory ضد اجرای هم‌زمان ریجنریت یک مقاله ───
// سرور single-process است (self-hosted) پس Set در حافظه کافی است. کلید = slug.
// در خروجی نهایی همیشه delete می‌شود (finally) تا قفل نشتی نکند.
const running = new Set<string>();

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const admin = await requireAdmin();
    const { slug } = await params;

    // ─── قفل ضد دابل‌اجرای هم‌زمان روی همین مقاله ───
    if (running.has(slug)) {
      return Response.json(
        { error: "ریجنریت این مقاله از قبل در حال اجراست — لطفاً چند دقیقه صبر کنید و صفحه را رفرش کنید." },
        { status: 429 }
      );
    }

    const article = await db.article.findUnique({
      where: { slug },
      select: { id: true, title: true },
    });
    if (!article) {
      return Response.json({ error: "مقاله یافت نشد." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({} as any));
    const onlyText = Boolean((body as any)?.onlyText);

    running.add(slug);
    try {
      console.log(
        `[ARTICLE-REGEN] درخواست ریجنریت کامل مقاله «${article.title}» (slug: ${slug}) توسط ادمین ${admin.id}${onlyText ? " — فقط متن" : ""}`
      );

      const result = await regenerateArticleFull({
        articleId: article.id,
        adminId: admin.id,
        onlyText,
      });

      if (!result.ok) {
        // شکست کنترل‌شده — مقاله دست‌نخورده مانده؛ پیام فاندابال + نوت‌ها برای دیباگ
        return Response.json(
          {
            error: result.notes[result.notes.length - 1] || "ریجنریت کامل شکست خورد — مقاله بدون تغییر ماند.",
            notes: result.notes,
          },
          { status: 500 }
        );
      }

      return Response.json({
        ok: true,
        slug: result.slug,
        wordCount: result.wordCount,
        coverUrl: result.coverUrl,
        inlineCount: result.inlineCount,
        revisionId: result.revisionId,
        notes: result.notes,
      });
    } finally {
      // قفل همیشه آزاد شود — حتی در مسیر خطا
      running.delete(slug);
    }
  } catch (e) {
    return apiError(e);
  }
}
