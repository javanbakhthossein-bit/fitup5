import { db } from "@/lib/db";

/**
 * ─── v218 — فید RSS مقالات (/feed.xml) ───
 *
 * RSS 2.0 استاندارد: آخرین ۵۰ مقالهٔ منتشرشده به ترتیب publishedAt نزولی.
 * مصرف: خواننده‌های فید، تلگرام‌بات‌ها، و اعلان <link rel="alternate"
 * type="application/rss+xml"> در head سراسری (layout.tsx).
 *
 * XML صریحاً escape می‌شود (همان الگوی xmlEscape سitemap-builder.ts —
 * ریشهٔ باگ EntityRef سرچ کنسول)؛ هیچ محتوایی خام وارد XML نمی‌شود.
 * هدر کش: عمومی ۱۰ دقیقه — خواننده‌ها بار مکرر نمی‌زنند.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

// همان الگوی xmlEscape سitemap-builder.ts (کپی عمدی برای استقلال route)
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** تاریخ RFC-822/1123 استاندارد RSS (toUTCString همین قالب را می‌دهد) */
function rfc822(d: Date): string {
  return d.toUTCString();
}

export const dynamic = "force-dynamic";

export async function GET() {
  let items = "";
  try {
    const articles = await db.article.findMany({
      where: { status: "published" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        title: true,
        slug: true,
        excerpt: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    items = articles
      .map((a) => {
        const url = `${SITE_URL}/article/${encodeURIComponent(a.slug)}`;
        return [
          "    <item>",
          `      <title>${xmlEscape(a.title)}</title>`,
          `      <link>${xmlEscape(url)}</link>`,
          `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
          `      <description>${xmlEscape(a.excerpt || "")}</description>`,
          `      <pubDate>${rfc822(new Date(a.publishedAt || a.createdAt))}</pubDate>`,
          "    </item>",
        ].join("\n");
      })
      .join("\n");
  } catch (err) {
    // حتی در خطای DB فید معتبرِ خالی برمی‌گردد (هرگز XML خراب سرو نمی‌شود)
    console.error("[feed.xml] DB error:", err instanceof Error ? err.message : err);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>مجله فیتاپ</title>
    <link>${xmlEscape(`${SITE_URL}/articles`)}</link>
    <description>مقالات تخصصی بدنسازی، تغذیه، چربی‌سوزی، عضله‌سازی و مکمل‌های ورزشی به زبان فارسی — هر بدنی فیتاپ میخواد</description>
    <language>fa</language>
    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>
    <atom:link href="${xmlEscape(`${SITE_URL}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}
