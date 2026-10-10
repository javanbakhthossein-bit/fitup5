import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { savePrivateMediaFile } from "@/lib/fitness/private-media";
import { randomBytes } from "crypto";

/**
 * ─── v138 — آپلود «عکس یادبود» جلسهٔ پیاده‌روی/دویدن ───
 *
 * POST /api/activity/photo  (multipart/form-data — field: "image")
 * → عکس با sharp به webp حداکثر ۱۴۳۹px تبدیل و در uploads/activity/ ذخیره می‌شود.
 *
 * قانون دسترسی: برای همهٔ کاربران لاگین‌شده رایگان است (ثبت فعالیت بدون پلن هم
 * کامل کار می‌کند — دیرکتیو مالک). عکس برمی‌گردد تا در فرم پایان جلسه ثبت شود.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const formData = await req.formData();
    const imageField = formData.get("image");
    const image = imageField instanceof File ? imageField : null;

    if (!image) {
      return NextResponse.json({ error: "عکس ارسال نشده." }, { status: 400 });
    }
    if (image.size > 30 * 1024 * 1024) {
      return NextResponse.json({ error: "فایل تصویر بسیار بزرگ است." }, { status: 413 });
    }
    if (!image.type.startsWith("image/")) {
      return NextResponse.json({ error: "فقط فایل تصویری مجاز است." }, { status: 400 });
    }

    // بهینه‌سازی مثل گالری پیشرفت: EXIF-rotate → resize → webp
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(await image.arrayBuffer());
    let processed: Buffer;
    try {
      processed = await sharp(buffer, { failOn: "none" })
        .rotate()
        .resize(1440, 1440, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { error: "پردازش عکس ممکن نشد — فرمت دیگری امتحان کن." },
        { status: 400 }
      );
    }

    const fileName = `activity-${user.id}-${Date.now()}-${randomBytes(4).toString("hex")}.webp`;
    const saved = await savePrivateMediaFile("activity", fileName, processed);

    return NextResponse.json({ ok: true, url: saved.url });
  } catch (e) {
    return apiError(e);
  }
}
