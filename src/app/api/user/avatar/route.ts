import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { savePrivateMediaFile } from "@/lib/fitness/private-media";

/**
 * POST /api/user/avatar
 * آپلود عکس پروفایل کاربر (multipart/form-data → فیلد "image")
 *
 * - فقط image/* — گارد فنی ۱۰۰ مگابایت (نادر؛ دیرکتیو مالک: سقف کاربر-پسند حذف شد،
 *   کلاینت خودش به ۶۴۰px کوچک می‌کند و سرور sharp نهایی است)
 * - سرور: چرخش خودکار EXIF + برش مربعی ۳۲۰×۳۲۰ (sharp attention) + webp q82
 * - نسخه اصلی دور انداخته می‌شود — فقط webp کوچک ذخیره می‌شود
 * - فایل در uploads/avatar/ (خارج از public) ذخیره و با احراز هویت + مالکیت
 *   از طریق هندلر مشترک serve-upload سرو می‌شود (پیشوند avatar-{uid} در
 *   نام فایل = مالکیت).
 * - قانون مالک (v53): فایل‌های کاربر هرگز حذف نمی‌شوند — آواتار قبلی هم
 *   روی دیسک می‌ماند (فقط URL در DB عوض می‌شود). استثنای واحد v53:
 *   نسخهٔ اصلی ویدیو بعد از تولید نسخهٔ فشردهٔ سالم.
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

    // گارد فنی حجم (۱۰۰MB — نادر؛ ضد OOM). فقط نسخهٔ webp کوچک ذخیره می‌شود.
    if (image.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "فایل تصویر بسیار بزرگ است." }, { status: 413 });
    }

    // اعتبارسنجی نوع فایل — مثل progress/photo؛ بدون این، فایل غیرتصویری به
    // sharp می‌رسد و خطای خام libvips به کاربر فارسی‌زبان نمایش داده می‌شد
    if (!image.type.startsWith("image/")) {
      return NextResponse.json({ error: "فقط فایل تصویری مجاز است." }, { status: 400 });
    }

    // پردازش با sharp — .rotate() قبل از resize (خودترازی EXIF؛ resize به
    // EXIF توجه نمی‌کند) — همان فیکس چرخشِ progress/photo
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(await image.arrayBuffer());
    let processed: Buffer;
    try {
      processed = await sharp(buffer)
        .rotate()
        .resize(320, 320, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (sharpErr) {
      // تصویر خراب (header نامعتبر) — پیام عمومی فارسی به‌جای خطای خام sharp
      console.error("[user/avatar] sharp processing failed:", sharpErr);
      return NextResponse.json(
        { error: "پردازش تصویر ناموفق بود. لطفاً یک تصویر معتبر ارسال کنید." },
        { status: 500 }
      );
    }

    // نام فایل شامل شناسه کاربر — مالکیت در canAccessPrivateMedia از روی
    // پیشوند تشخیص داده می‌شود؛ timestamp هم کش‌باستینگ طبیعی است (هر آپلود
    // URL جدید می‌سازد)
    const fileName = `avatar-${user.id}-${Date.now()}.webp`;
    const { url: avatarUrl } = await savePrivateMediaFile("avatar", fileName, processed);

    // v53: آواتار قبلی روی دیسک حذف نمی‌شود — فقط URL در DB جایگزین می‌شود
    await db.user.update({ where: { id: user.id }, data: { avatarUrl } });

    return NextResponse.json({ ok: true, avatarUrl });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/user/avatar
 * حذف عکس پروفایل — قانون مالک (v53): فقط فیلد avatarUrl در DB null می‌شود؛
 * خود فایل برای همیشه روی دیسک می‌ماند (فایل‌های کاربر هرگز حذف نمی‌شوند).
 */
export async function DELETE() {
  try {
    const user = await requireAuth();
    await db.user.update({ where: { id: user.id }, data: { avatarUrl: null } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
