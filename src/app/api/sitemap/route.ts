import { NextResponse } from "next/server";
import { getSitemapEntries, buildSitemapXml } from "@/lib/fitness/sitemap-builder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ─── /api/sitemap — ورودی قدیمی sitemap (با بیلدر مشترک v12.4) ───
 *
 * منطق ساخت entries در `src/lib/fitness/sitemap-builder.ts` و ساخت رشتهٔ
 * XML در `buildSitemapXml` (xmlEscape صریح — فیکس EntityRef v12.4) مشترک
 * است. ورودی اصلی و رسمی برای گوگل `/sitemap.xml` است که با route واقعی
 * `app/sitemap.xml/route.ts` سرو می‌شود. این endpoint برای سازگاری و
 * هدرهای سفارشی (X-Sitemap-*) نگه داشته شده است.
 */
export async function GET() {
  const { entries, count, fromCache } = await getSitemapEntries();
  const xml = buildSitemapXml(entries);

  const cacheable = fromCache === "hit" || fromCache === "miss";
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // کامل → کش عمومی ۱۰ دقیقه‌ای؛ ناقص → no-store تا درخواست بعدی دوباره بسازد
      "Cache-Control": cacheable ? "public, max-age=600, s-maxage=600" : "no-store",
      "X-Sitemap-Cache": fromCache,
      "X-Sitemap-Count": String(count),
    },
  });
}
