import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { db } from "@/lib/db";

/**
 * GET /api/app/own/latest — اطلاعات آخرین نسخهٔ اپ اندروید «اختصاصی» فیتاپ (عمومی)
 *
 * اپ اختصاصی (WebView پنل کاربری — فقط دانلود از خود سایت) در هر اجرا این
 * endpoint را صدا می‌زند:
 *  - وب‌سایت داخل WebView: اگر versionCode اپ < latestVersionCode → مودال زیبای
 *    «نسخه جدید موجود است» با changelog + دکمه دانلود مستقیم (DownloadManager نیتیو).
 *  - نیتیو (fallback): اگر forceUpdate فعال باشد و نسخه قدیمی → دیالوگ آپدیت اجباری.
 *
 * ─── fallback ضدخطا (v12.3 — فیکس «خطا در آماده‌سازی دانلود») ───
 * اگر رکورد فعال DB نبود، اطلاعات از فایل‌های همراه بستهٔ دیپلوی ساخته
 * می‌شود (public/downloads/fitup-own-version.txt + newest fitup-own-v*.apk)
 * تا کارت‌های دانلود سایت همیشه نسخه و حجم درست را نشان دهند و دانلود
 * از route اصلی (که همان fallback را دارد) همیشه کار کند.
 *
 * نسخه‌ها توسط ادمین (تنظیمات سایت → مدیریت اپ اختصاصی) آپلود می‌شوند.
 */
function bundledOwnAppInfo(): {
  versionName: string;
  versionCode: number;
  fileSize: number;
} | null {
  try {
    const dir = path.join(process.cwd(), "public", "downloads");
    // ─── version.txt: فرمت «1.1.0 2» (نام نسخه + کد نسخه) ───
    let versionName = "";
    let versionCode = 0;
    const txtPath = path.join(dir, "fitup-own-version.txt");
    if (existsSync(txtPath)) {
      const raw = readFileSync(txtPath, "utf8").trim().split(/\s+/);
      versionName = raw[0] || "";
      versionCode = Math.floor(Number(raw[1])) || 0;
    }
    // ─── جدیدترین APK اختصاصی همراه بسته ───
    const apks = readdirSync(dir)
      .filter((f) => /^fitup-own-v.*\.apk$/i.test(f))
      .sort();
    if (apks.length === 0) return null;
    const apkPath = path.join(dir, apks[apks.length - 1]);
    const fileSize = statSync(apkPath).size;
    // اگر version.txt نبود، نسخه را از نام فایل دربیاوریم (fitup-own-v1.1.0.apk)
    if (!versionName) {
      const m = /fitup-own-v(\d+\.\d+\.\d+)/i.exec(apks[apks.length - 1]);
      versionName = m ? m[1] : "1.0.0";
    }
    return { versionName, versionCode: versionCode || 1, fileSize };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const release = await db.ownAppRelease.findFirst({
      where: { isActive: true },
      orderBy: { versionCode: "desc" },
      select: {
        versionName: true,
        versionCode: true,
        changelog: true,
        fileSize: true,
        forceUpdate: true,
        createdAt: true,
      },
    });

    if (release) {
      return Response.json(
        {
          available: true,
          latestVersionName: release.versionName,
          latestVersionCode: release.versionCode,
          changelog: release.changelog,
          fileSize: release.fileSize,
          forceUpdate: release.forceUpdate,
          // دانلود همیشه از endpoint سایت — مسیر نسبی
          apkUrl: "/api/app/own/download",
          releasedAt: release.createdAt,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ─── fallback: اطلاعات از فایل‌های همراه بستهٔ دیپلوی ───
    const bundled = bundledOwnAppInfo();
    if (bundled) {
      return Response.json(
        {
          available: true,
          latestVersionName: bundled.versionName,
          latestVersionCode: bundled.versionCode,
          changelog: "",
          fileSize: bundled.fileSize,
          forceUpdate: false,
          apkUrl: "/api/app/own/download",
          releasedAt: null,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // هنوز هیچ نسخه‌ای در دسترس نیست — پاسخ «بدون آپدیت» (اپ ساکت ادامه می‌دهد)
    return Response.json(
      { available: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // DB در دسترس نیست — تلاش برای fallback فایل‌های محلی، وگرنه پاسخ امن
    const bundled = bundledOwnAppInfo();
    if (bundled) {
      return Response.json(
        {
          available: true,
          latestVersionName: bundled.versionName,
          latestVersionCode: bundled.versionCode,
          changelog: "",
          fileSize: bundled.fileSize,
          forceUpdate: false,
          apkUrl: "/api/app/own/download",
          releasedAt: null,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return Response.json(
      { available: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
