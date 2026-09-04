import { NextRequest } from "next/server";
import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import path from "path";
import { db } from "@/lib/db";
import { UPLOADS_ROOT } from "@/lib/fitness/uploads-config";

/**
 * GET /api/app/own/download — دانلود آخرین APK اپ اندروید اختصاصی فیتاپ
 *
 * عمومی (بدون لاگین — کاربر برای آپدیت باید بتواند فایل را بگیرد).
 *
 * ─── زنجیره fallback ضدخطا (v12.3 — فیکس «خطا در آماده‌سازی دانلود») ───
 * قبلاً این route فقط به رکورد DB (OwnAppRelease) تکیه داشت؛ اگر رکورد
 * نبود یا فایلِ رکورد روی دیسک گم شده بود (مثلاً بعد از مهاجرت سرور یا
 * پاک‌شدن uploads)، کاربر با «خطا در آماده‌سازی دانلود» روبه‌رو می‌شد.
 * حالا به‌ترتیب این منابع امتحان می‌شوند تا دانلود «تقریباً هیچ‌وقت» شکست
 * نخورد:
 *   ۱. رکورد فعال DB → فایل در uploads/apk
 *   ۲. جدیدترین فایل *.apk موجود در uploads/apk
 *   ۳. جدیدترین فایل public/downloads/fitup-own-v*.apk (همراه بسته دیپلوی)
 *
 * - Content-Disposition: attachment → مرورگر/WebView فایل را «دانلود» می‌کند
 *   (نه باز کردن). DownloadManager اندروید هم همین هدر را می‌فهمد.
 * - پشتیبانی Range (206) — برای ادامه دانلود قطع‌شده در مرورگر/دانلود منیجرها.
 * - شمارنده downloads بعد از شروع موفق دانلود بالا می‌رود (fire-and-forget،
 *   فقط وقتی منبع، رکورد DB بوده).
 *
 * مسیر نسخهٔ خاص: /api/app/own/download?versionCode=N (اختیاری — برای لینک
 * مستقیم نسخه‌های قبلی در پنل ادمین).
 */
const APK_MIME = "application/vnd.android.package-archive";

/** نام فایل + مسیر مطلق یک منبع APK معتبر روی دیسک */
type ApkSource = { filePath: string; fileName: string; fromDbRecordId?: string };

function newestApkInDir(dir: string, prefix = ""): string | null {
  try {
    if (!existsSync(dir)) return null;
    const candidates = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".apk") && f.startsWith(prefix))
      .map((f) => {
        const full = path.join(dir, f);
        try {
          return { full, mtime: statSyncLike(full) };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { full: string; mtime: number }[];
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].full;
  } catch {
    return null;
  }
}

function statSyncLike(p: string): number {
  return statSync(p).mtimeMs;
}

async function resolveApkSource(wantedCode: string | null): Promise<ApkSource | null> {
  // ─── ۱) رکورد فعال DB ───
  try {
    const release = await db.ownAppRelease.findFirst({
      where: {
        isActive: true,
        ...(wantedCode ? { versionCode: Math.floor(Number(wantedCode)) || 0 } : {}),
      },
      orderBy: { versionCode: "desc" },
      select: { id: true, fileName: true, versionName: true },
    });
    if (release) {
      // امنیت: فقط نام فایل ساده (بدون مسیر) داخل uploads/apk
      const safeName = path.basename(release.fileName);
      const apkDir = path.join(UPLOADS_ROOT, "apk");
      const filePath = path.resolve(apkDir, safeName);
      if (filePath.startsWith(path.resolve(apkDir)) && existsSync(filePath)) {
        return { filePath, fileName: safeName, fromDbRecordId: release.id };
      }
    }
  } catch {
    // DB در دسترس نیست — به fallback می‌رسیم
  }

  // ─── ۲) جدیدترین APK آپلودشده در uploads/apk ───
  const uploadsApk = newestApkInDir(path.join(UPLOADS_ROOT, "apk"));
  if (uploadsApk) {
    return { filePath: uploadsApk, fileName: path.basename(uploadsApk) };
  }

  // ─── ۳) APK همراه بسته دیپلوی در public/downloads ───
  const publicDir = path.join(process.cwd(), "public", "downloads");
  const bundledApk =
    newestApkInDir(publicDir, "fitup-own-") || newestApkInDir(publicDir, "fitup-bazaar-");
  if (bundledApk) {
    return { filePath: bundledApk, fileName: path.basename(bundledApk) };
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const wantedCode = req.nextUrl.searchParams.get("versionCode");
    const source = await resolveApkSource(wantedCode);
    if (!source) {
      return new Response("نسخه‌ای برای دانلود موجود نیست", { status: 404 });
    }

    let size = 0;
    try {
      const st = await stat(source.filePath);
      if (!st.isFile()) throw new Error("not file");
      size = st.size;
    } catch {
      return new Response("فایل نسخه روی سرور یافت نشد", { status: 404 });
    }

    // شمارش دانلود (بدون انتظار — خطایش مهم نیست) — فقط منبع DB
    if (source.fromDbRecordId) {
      void db.ownAppRelease
        .update({ where: { id: source.fromDbRecordId }, data: { downloads: { increment: 1 } } })
        .catch(() => {});
    }

    // نام فایل دانلودی از نسخه داخل نام فایل منبع ساخته می‌شود
    const vMatch = /v?(\d+\.\d+\.\d+)/.exec(source.fileName);
    const fileName = vMatch ? `fitup-${vMatch[1]}.apk` : "fitup.apk";

    // پشتیبانی Range برای ادامه دانلود
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        let start = m[1] ? Number.parseInt(m[1], 10) : 0;
        let end = m[2] ? Number.parseInt(m[2], 10) : size - 1;
        if (Number.isNaN(start) || Number.isNaN(end)) {
          return new Response("بازه نامعتبر", { status: 416 });
        }
        if (start >= size) {
          return new Response("بازه خارج از فایل", {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        }
        start = Math.max(0, start);
        end = Math.min(end, size - 1);
        const stream = createReadStream(source.filePath, { start, end });
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            "Content-Type": APK_MIME,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      }
    }

    const stream = createReadStream(source.filePath);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": APK_MIME,
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[own/download] خطای غیرمنتظره:", err instanceof Error ? err.message : err);
    return new Response("خطا در آماده‌سازی دانلود", { status: 500 });
  }
}
