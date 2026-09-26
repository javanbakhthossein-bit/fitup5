import { NextRequest } from "next/server";
import { serveUploadGet } from "@/lib/fitness/serve-upload-handler";

/**
 * GET /uploads/[...path]  —  route واقعی سرو فایل‌های آپلودشده (v21)
 *
 * ⚠️ چرا این route وجود دارد؟ (باگ حیاتی پروداکشن)
 *
 * قبلاً عکس‌ها فقط از طریق rewrite تعریف‌شده در next.config.ts سرو می‌شدند:
 *   source: "/uploads/:path*"  →  destination: "/api/serve-upload/:path*"
 *
 * روی سرور پروداکشن (بیلد standalone + pm2) این rewrite ها **اعمال نمی‌شوند**
 * — نتیجه: همهٔ عکس‌های مقالات ۴۰۴ با صفحهٔ HTML (تست مستقیم روی سایت زنده:
 * `/api/serve-upload/articles/...` → 200 image/webp ولی `/uploads/articles/...`
 * → 404). فایل‌ها و دیتابیس سالم‌اند؛ فقط لایهٔ rewrite مرده است.
 *
 * این route واقعی داخل خود اپ کامپایل می‌شود (مثل /api/articles و هر route
 * دیگر) و به routes-manifest / rewrite هیچ وابستگی‌ای ندارد. اولویت
 * مسیریابی Next.js: static public/ → filesystem routes (همین‌جا) →
 * afterFiles rewrites — پس مالکیت مسیر /uploads/* با این route است.
 *
 * چه چیزهایی از این مسیر سرو می‌شوند:
 *  - عکس‌های کاور/inline مقالات (public — بدون auth)
 *  - og:image برای گوگل/تلگرام/واتساپ (همان URL عمومی، حالا ۲۰۰)
 *  - رسانه‌های خصوصی کاربران (عکس بدن/چت/آزمایش خون) — همان auth و
 *    بررسی مالکیتِ قبل (هندلر مشترک serve-upload-handler.ts)
 *  - ویدیوها با HTTP Range (seek / پخش iOS)
 *
 * هندلر کامل با همهٔ جزئیات (امنیت، Range، کش) در
 * `src/lib/fitness/serve-upload-handler.ts` است.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return serveUploadGet(req, path);
}
