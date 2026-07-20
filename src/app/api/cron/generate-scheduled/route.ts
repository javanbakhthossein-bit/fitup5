import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/cron/generate-scheduled?secret=CRON_SECRET
 *
 * تولید و انتشار مقاله‌ای که زمان انتشارش رسیده.
 *
 * این endpoint باید هر روز صدا زده شود:
 *   0 8 * * * curl -s https://fittup.ir/api/cron/generate-scheduled?secret=fitup-cron-secret-2025
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
    const scheduled = await db.article.findMany({
      where: {
        status: "draft",
        scheduledAt: { lte: now, not: null },
      },
      select: { id: true, title: true, slug: true, content: true },
      orderBy: { scheduledAt: "asc" },
      take: 1,
    });

    if (scheduled.length === 0) {
      return Response.json({ ok: true, published: 0 });
    }

    const article = scheduled[0];
    const needsGeneration = !article.content || article.content.trim().length < 100;

    if (needsGeneration) {
      return Response.json({
        ok: true,
        published: 0,
        message: `مقاله "${article.title}" نیاز به تولید دارد.`,
      });
    }

    await db.article.update({
      where: { id: article.id },
      data: { status: "published", scheduledAt: null },
    });

    return Response.json({
      ok: true,
      published: 1,
      article: { slug: article.slug, title: article.title },
    });
  } catch (err) {
    console.error("[cron/generate-scheduled] error:", err);
    return Response.json({ error: "خطا" }, { status: 500 });
  }
}
