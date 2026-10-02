import { NextResponse } from "next/server";
import { getSitemapEntries, buildSitemapXml } from "@/lib/fitness/sitemap-builder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ─── /sitemap.xml — route واقعی (v12.4 — فیکس EntityRef سرچ کنسول) ───
 *
 * تاریخچه:
 *  - v12.3: rewrite «/sitemap.xml → /api/sitemap» در standalone کار نمی‌کرد
 *    (باگ v21) → گوگل 404 می‌گرفت. فیکس: app/sitemap.ts (متادیتای Next.js).
 *  - v12.4: ولی سریالایزر داخلی Next.js «&» را escape نمی‌کند → URLهای
 *    دسته‌بندی «/?screen=articles&category=...» باعث خطای
 *    «EntityRef: expecting ';'» شدند و گوگل کل سایت‌مپ را unreadable
 *    می‌گرفت (error on line 322).
 *
 * فیکس نهایی: /sitemap.xml حالا یک route handler واقعی است که XML را با
 * buildSitemapXml (xmlEscape صریح) می‌سازد — همان منبع مشترک /api/sitemap.
 * مزیت‌ها: بدون نیاز به rewrite در هر حالت دیپلوی (dev/standalone) کار
 * می‌کند، escape درست تضمین‌شده است، هدرهای Cache-Control و X-Sitemap-*
 * هم خروجی می‌روند. robots.txt همچنان به /sitemap.xml اشاره می‌کند.
 */
export async function GET() {
  const { entries, count, fromCache } = await getSitemapEntries();
  const xml = buildSitemapXml(entries);

  // کامل → کش عمومی ۱۰ دقیقه‌ای؛ ناقص → no-store تا درخواست بعدی دوباره بسازد
  // (هدر /sitemap.xml در next.config.ts هم public, max-age=3600 می‌دهد)
  const cacheable = fromCache === "hit" || fromCache === "miss";
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": cacheable ? "public, max-age=600, s-maxage=600" : "no-store",
      "X-Sitemap-Cache": fromCache,
      "X-Sitemap-Count": String(count),
    },
  });
}
