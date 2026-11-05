import { NextRequest } from "next/server";
import { serveUploadGet } from "@/lib/fitness/serve-upload-handler";

/**
 * GET /api/serve-upload/[...path]
 *
 * سرو کردن فایل‌های آپلودشده از مسیر `uploads/` (در ریشه پروژه).
 *
 * ⚠️ v21: منطق این route به `src/lib/fitness/serve-upload-handler.ts` منتقل
 * شد تا route واقعی `app/uploads/[...path]/route.ts` هم از همان هندلر استفاده
 * کند. دلیل: rewrite های next.config در بیلد standalone پروداکشن اعمال
 * نمی‌شوند (۴۰۴ عکس‌های مقالات) — route واقعی مستقل از rewrite کار می‌کند.
 *
 * این مسیر همچنان معتبر است (فراخوانی مستقیم API، پنل ادمین، ابزارها) ولی
 * مرجع اصلی نمایش عکس‌ها از این پس route واقعی /uploads/... است.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return serveUploadGet(req, path);
}
