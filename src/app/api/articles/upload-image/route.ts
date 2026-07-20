import { NextRequest } from "next/server";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getArticlesDir } from "@/lib/fitness/image-processing";

/**
 * POST /api/articles/upload-image
 * Admin-only image upload for article content/cover.
 * Accepts multipart/form-data with field "image".
 * Returns { url: "/uploads/articles/xxx.jpg" }
 *
 * عکس‌ها در `uploads/articles/` (در ریشه پروژه) ذخیره می‌شوند — نه در public.
 * این کار از از دست رفتن عکس‌ها در زمان build جلوگیری می‌کند.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const formData = await req.formData();
    const file = formData.get("image");
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "فایلی ارسال نشده است." }, { status: 400 });
    }

    // Validate type
    if (!file.type.startsWith("image/")) {
      return Response.json({ error: "فقط فایل تصویری مجاز است." }, { status: 400 });
    }
    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ error: "حداکثر حجم فایل ۵ مگابایت است." }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const allowedExts = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
    const finalExt = allowedExts.includes(ext) ? ext : "jpg";
    const fileName = `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${finalExt}`;

    const uploadDir = getArticlesDir();
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return Response.json({
      url: `/uploads/articles/${fileName}`,
      size: file.size,
      type: file.type,
    });
  } catch (e) {
    return apiError(e);
  }
}
