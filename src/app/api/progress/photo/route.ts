import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";

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
    const formData = await req.formData();
    const image = formData.get("image") as File | null;
    const type = (formData.get("type") as string) || "front";
    const note = (formData.get("note") as string) || "";

    if (!image) {
      return NextResponse.json({ error: "عکس ارسال نشده." }, { status: 400 });
    }

    if (!["front", "side", "back"].includes(type)) {
      return NextResponse.json({ error: "نوع عکس نامعتبر است." }, { status: 400 });
    }

    if (image.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "حجم عکس بیش از ۱۰ مگابایت است." }, { status: 400 });
    }

    // فشرده‌سازی عکس با sharp
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(await image.arrayBuffer());
    const processed = await sharp(buffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    // ذخیره فایل
    const fileName = `progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "progress");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, processed);

    const imageUrl = `/uploads/progress/${fileName}`;

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

    // حذف فایل از دیسک
    try {
      const filePath = path.join(process.cwd(), "public", photo.imageUrl);
      await unlink(filePath).catch(() => {});
    } catch {}

    await db.progressPhoto.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
