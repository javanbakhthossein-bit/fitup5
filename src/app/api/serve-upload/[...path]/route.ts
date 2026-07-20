import { NextRequest } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { UPLOADS_ROOT } from "@/lib/fitness/uploads-config";

/**
 * GET /api/serve-upload/[...path]
 *
 * سرو کردن فایل‌های آپلودشده از مسیر `uploads/` (در ریشه پروژه).
 *
 * مهم: این API route از `uploads-config.ts` استفاده می‌کند (نه `image-processing.ts`)
 * تا `sharp` بارگذاری نشود. `sharp` یک native module است که در standalone ممکن است
 * مشکل داشته باشد (libvips موجود نیست).
 *
 * در `next.config.ts` یک rewrite وجود دارد که `/uploads/*` را به این API هدایت می‌کند.
 *
 * امنیت: فقط فایل‌های داخل `uploads/` قابل دسترسی هستند (path traversal مسدود است).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: pathParts } = await params;
    const requestedPath = pathParts.join("/");

    // امنیت: جلوگیری از path traversal (.. یا absolute paths)
    if (requestedPath.includes("..") || path.isAbsolute(requestedPath)) {
      return new Response("Forbidden", { status: 403 });
    }

    const filePath = path.join(UPLOADS_ROOT, requestedPath);

    // بررسی اینکه filePath واقعاً داخل UPLOADS_ROOT است (path traversal نهایی)
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(UPLOADS_ROOT);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
      return new Response("Forbidden", { status: 403 });
    }

    // بررسی وجود فایل
    try {
      const s = await stat(filePath);
      if (!s.isFile()) {
        return new Response("Not found", { status: 404 });
      }
    } catch {
      return new Response("Not found", { status: 404 });
    }

    // خواندن فایل
    const buffer = await readFile(filePath);

    // تشخیص content-type از پسوند فایل
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".webp": "image/webp",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".avif": "image/avif",
      ".svg": "image/svg+xml",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    // Cache headers — عکس‌ها immutable هستند (URL شامل hash یا timestamp است)
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    console.error("[serve-upload] Error:", e);
    return new Response("Internal server error", { status: 500 });
  }
}
