import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/cron/publish-scheduled?secret=CRON_SECRET
 *
 * انتشار مقالات زمان‌بندی‌شده.
 * مقالاتی که status="draft" و scheduledAt <= now هستند را منتشر می‌کند.
 *
 * این endpoint باید هر ساعت توسط یک cron job خارجی صدا زده شود:
 *   0 * * * * curl -s https://fittup.ir/api/cron/publish-scheduled?secret=fitup-cron-secret-2025
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET || "fitup-cron-secret-2025";

  if (secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  try {
    // پیدا کردن مقالاتی که زمان انتشارشان رسیده
    const scheduled = await db.article.findMany({
      where: {
        status: "draft",
        scheduledAt: { lte: now, not: null },
      },
      select: { id: true, title: true, slug: true },
    });

    if (scheduled.length === 0) {
      return Response.json({ ok: true, published: 0, message: "هیچ مقاله‌ای برای انتشار نیست" });
    }

    // انتشار مقالات
    // مهم: canonicalUrl را هم set می‌کنیم تا گوگل canonical درست را ببیند.
    // این کار از خطای «Alternative page with proper canonical tag» جلوگیری می‌کند.
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir").replace(/\/$/, "");
    const result = await db.article.updateMany({
      where: {
        id: { in: scheduled.map((a) => a.id) },
      },
      data: {
        status: "published",
        scheduledAt: null, // پاک کردن زمان‌بندی بعد از انتشار
      },
    });

    // set canonicalUrl برای هر مقاله (اگر خالی است)
    for (const a of scheduled) {
      const canonical = `${siteUrl}/?article=${a.slug}`;
      await db.article.update({
        where: { id: a.id },
        data: { canonicalUrl: canonical },
      });
    }

    return Response.json({
      ok: true,
      published: result.count,
      articles: scheduled.map((a) => ({ slug: a.slug, title: a.title })),
    });
  } catch (err) {
    console.error("[cron/publish-scheduled] error:", err);
    return Response.json({ error: "خطا در انتشار مقالات" }, { status: 500 });
  }
}
