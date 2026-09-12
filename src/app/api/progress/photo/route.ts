import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { savePrivateMediaFile } from "@/lib/fitness/private-media";

/**
 * POST /api/progress/photo
 * آپلود عکس پیشرفت بدن (front/side/back)
 * Body: multipart/form-data
 *   - image: File (عکس)
 *   - type: string ("front" | "side" | "back")
 *   - note: string (اختیاری)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    // v66 — دیریکتیو مالک: گالری پیشرفت برای کاربر بدون پلن غیرفعال است؛
    // از پلن اقتصادی (basic) به بالا — فعال یا در انتظار پیش‌نیاز — باز است.
    const now = new Date();
    const activeSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "active", endDate: { gt: now } },
      select: { id: true },
    });
    const pendingSub = !activeSub
      ? await db.subscription.findFirst({
          where: {
            userId: user.id,
            status: "pending",
            OR: [{ endDate: null }, { endDate: { gt: now } }],
          },
          select: { id: true },
        })
      : null;
    if (!activeSub && !pendingSub) {
      return NextResponse.json(
        {
          error:
            "گالری پیشرفت از پلن اقتصادی به بالا فعال است. برای آپلود عکس پیشرفت، ابتدا یک پلن فعال کنید.",
          code: "PLAN_REQUIRED",
        },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const imageField = formData.get("image");
    const image = imageField instanceof File ? imageField : null;
    const type = (formData.get("type") as string) || "front";
    const note = (formData.get("note") as string) || "";

    if (!image) {
      return NextResponse.json({ error: "عکس ارسال نشده." }, { status: 400 });
    }

    if (!["front", "side", "back"].includes(type)) {
      return NextResponse.json({ error: "نوع عکس نامعتبر است." }, { status: 400 });
    }

    // گارد فنی حجم (۱۰۰MB — نادر؛ ضد OOM/درخواست مخرب). دیرکتیو مالک: سقف
    // کاربر-پسند حذف شد — عکس با sharp به ۱۰۲۴px کاهش می‌یابد و فقط نسخهٔ
    // بهینه (webp) نگه داشته می‌شود.
    if (image.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "فایل تصویر بسیار بزرگ است." }, { status: 413 });
    }

    // اعتبارسنجی نوع فایل — بدون این بررسی، فایل غیرتصویری به sharp می‌رسد و
    // خطای خام انگلیسی libvips با status 500 به کاربر فارسی‌زبان نمایش داده می‌شد
    if (!image.type.startsWith("image/")) {
      return NextResponse.json({ error: "فقط فایل تصویری مجاز است." }, { status: 400 });
    }

    // فشرده‌سازی عکس با sharp
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(await image.arrayBuffer());
    let processed: Buffer;
    try {
      // FIX (گزارش مالک — چرخش عکس گالری پیشرفت): .rotate() بدون آرگومان =
      // خودترازی بر اساس EXIF گوشی. بدون این، sharp پیکسل خام حسگر را
      // وب‌پی می‌کند و تگ EXIF حذف می‌شود → عکس عمودی ۹۰-درجه-چرخیده نمایش
      // داده می‌شد. حتماً «قبل از» resize (resize به EXIF توجه نمی‌کند).
      processed = await sharp(buffer)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
    } catch (sharpErr) {
      // تصویر خراب (مثلاً header نامعتبر) — پیام عمومی فارسی به‌جای خطای خام sharp
      console.error("[progress/photo] sharp processing failed:", sharpErr);
      return NextResponse.json(
        { error: "پردازش تصویر ناموفق بود. لطفاً یک تصویر معتبر ارسال کنید." },
        { status: 500 }
      );
    }

    // ذخیره فایل — در uploads/progress/ (خارج از public؛ سرو با احراز هویت).
    // نام فایل شامل شناسه کاربر است تا مالکیت مستقیم تشخیص داده شود.
    const fileName = `progress-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const { url: imageUrl } = await savePrivateMediaFile("progress", fileName, processed);

    // ذخیره در دیتابیس
    const photo = await db.progressPhoto.create({
      data: { userId: user.id, imageUrl, type, note },
    });

    return NextResponse.json({
      id: photo.id,
      imageUrl: photo.imageUrl,
      type: photo.type,
      note: photo.note,
      takenAt: photo.takenAt.toISOString(),
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/progress/photo?id=<id>
 *
 * قانون مالک (v53): فایل‌های کاربر هرگز از دیسک حذف نمی‌شوند — فقط رکورد
 * دیتابیس حذف می‌شود تا عکس از گالری پنهان شود؛ خود فایل در uploads/progress/
 * برای همیشه باقی می‌ماند (استثنای واحد v53: نسخهٔ اصلی ویدیو بعد از فشرده‌سازی).
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID نیاز است." }, { status: 400 });
    }

    const photo = await db.progressPhoto.findFirst({
      where: { id, userId: user.id },
    });
    if (!photo) {
      return NextResponse.json({ error: "عکس یافت نشد." }, { status: 404 });
    }

    // v53: فایل روی دیسک دست‌نخورده می‌ماند — فقط رکورد حذف می‌شود
    await db.progressPhoto.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
