import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { stat } from "fs/promises";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { UPLOADS_ROOT } from "@/lib/fitness/uploads-config";

/**
 * مدیریت نسخه‌های اپ اندروید «اختصاصی» فیتاپ (فقط ادمین)
 *
 * GET  /api/app/own/releases   → لیست همه نسخه‌ها (جدیدترین اول)
 * POST /api/app/own/releases   → آپلود نسخه جدید (multipart/form-data)
 *      فیلدها: apk (فایل) + versionName + versionCode + changelog + forceUpdate
 *      فایل در uploads/apk/ ذخیره می‌شود و رکورد DB ساخته می‌شود.
 *
 * DELETE /api/app/own/releases/[id] → حذف نسخه (فایل + رکورد)
 */
const APK_MIME = "application/vnd.android.package-archive";
const MAX_APK_BYTES = 100 * 1024 * 1024; // ۱۰۰MB سقف اطمینان

export async function GET() {
  try {
    await requireAdmin();

    const releases = await db.ownAppRelease.findMany({
      orderBy: { versionCode: "desc" },
      select: {
        id: true,
        versionName: true,
        versionCode: true,
        changelog: true,
        fileSize: true,
        downloads: true,
        forceUpdate: true,
        isActive: true,
        createdAt: true,
      },
    });
    return Response.json({ releases }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const form = await req.formData();
    const apk = form.get("apk");
    const versionName = String(form.get("versionName") || "").trim();
    const versionCode = Math.floor(Number(form.get("versionCode")));
    const changelog = String(form.get("changelog") || "").trim();
    const forceUpdate = String(form.get("forceUpdate") || "") === "true";

    if (!versionName || !/^\d+(\.\d+){0,3}$/.test(versionName)) {
      return Response.json(
        { error: "نام نسخه معتبر نیست (مثال: 1.0.0)" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(versionCode) || versionCode < 1 || versionCode > 1_000_000) {
      return Response.json(
        { error: "کد نسخه باید عددی بین ۱ تا یک میلیون باشد" },
        { status: 400 }
      );
    }
    if (!(apk instanceof File) || apk.size === 0) {
      return Response.json({ error: "فایل APK ارسال نشده است" }, { status: 400 });
    }
    if (apk.size > MAX_APK_BYTES) {
      return Response.json({ error: "حجم فایل بیش از حد مجاز است" }, { status: 400 });
    }
    // فایل باید APK واقعی باشد — امضا/نوع
    const isApkName = apk.name.toLowerCase().endsWith(".apk");
    const isApkType =
      !apk.type ||
      apk.type === APK_MIME ||
      apk.type === "application/octet-stream" ||
      apk.type === "application/zip";
    if (!isApkName && !isApkType) {
      return Response.json(
        { error: "فایل ارسالی APK نیست (پسوند .apk الزامی است)" },
        { status: 400 }
      );
    }
    // جلوگیری از نسخه تکراری
    const dup = await db.ownAppRelease.findFirst({ where: { versionCode } });
    if (dup) {
      return Response.json(
        { error: `کد نسخه ${versionCode} قبلاً استفاده شده — کد بالاتر بدهید` },
        { status: 400 }
      );
    }

    // ذخیره فایل در uploads/apk
    const apkDir = path.join(UPLOADS_ROOT, "apk");
    await mkdir(apkDir, { recursive: true });
    const safeFile = `fitup-own-v${versionName}-${Date.now()}.apk`;
    const filePath = path.join(apkDir, safeFile);
    const buf = Buffer.from(await apk.arrayBuffer());
    await writeFile(filePath, buf);
    const st = await stat(filePath);

    // نسخه‌های قبلی که forceUpdate داشتند غیرفعال نمی‌شوند — فقط آخرین نسخه
    // «فعال» می‌ماند برای latest؛ نسخه‌های قدیمی را غیرفعال می‌کنیم تا latest
    // همیشه مشخص باشد (دانلود عمومی فقط از آخرین نسخه).
    await db.ownAppRelease.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    const release = await db.ownAppRelease.create({
      data: {
        versionName,
        versionCode,
        changelog,
        fileName: safeFile,
        fileSize: st.size,
        forceUpdate,
        isActive: true,
      },
    });

    return Response.json({
      ok: true,
      release: {
        id: release.id,
        versionName: release.versionName,
        versionCode: release.versionCode,
        fileSize: release.fileSize,
        downloads: release.downloads,
        forceUpdate: release.forceUpdate,
        isActive: release.isActive,
        changelog: release.changelog,
        createdAt: release.createdAt,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return Response.json({ error: "شناسه نسخه لازم است" }, { status: 400 });

    const release = await db.ownAppRelease.findUnique({ where: { id } });
    if (!release) return Response.json({ error: "نسخه یافت نشد" }, { status: 404 });

    // حذف فایل (اگر بود) — خطای حذف فایل مانع حذف رکورد نمی‌شود
    try {
      const apkDir = path.join(UPLOADS_ROOT, "apk");
      const safeName = path.basename(release.fileName);
      const filePath = path.resolve(apkDir, safeName);
      if (filePath.startsWith(path.resolve(apkDir))) {
        await unlink(filePath);
      }
    } catch {}

    await db.ownAppRelease.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
