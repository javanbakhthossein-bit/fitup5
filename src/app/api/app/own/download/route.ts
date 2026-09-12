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

  // ─── ۲) FIX (v51 — «دانلود، همیشه نسخهٔ درست»): بین همهٔ APKهای موجود در
  // uploads/apk و public/downloads، «بالاترین نسخه» سرو می‌شود نه جدیدترین
  // mtime. باگ واقعی: latest می‌گفت 1.2.7 ولی دانلود 1.2.2 می‌داد چون فایل
  // قدیمی uploads/apk برندهٔ مقایسهٔ mtime شده بود — دقیقاً برخلاف خواستهٔ
  // مالک («همه باید به آخرین نسخه و نسخه درست اشاره کنند»).
  type Candidate = ApkSource & { version: [number, number, number] | null; mtime: number };
  const candidates: Candidate[] = [];
  const pushCandidate = (dir: string, prefix: string) => {
    try {
      if (!existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        if (!f.toLowerCase().endsWith(".apk") || !f.startsWith(prefix)) continue;
        const full = path.join(dir, f);
        try {
          const v = /v?(\d+)\.(\d+)\.(\d+)/.exec(f);
          candidates.push({
            filePath: full,
            fileName: f,
            version: v ? [Number(v[1]), Number(v[2]), Number(v[3])] : null,
            mtime: statSync(full).mtimeMs,
          });
        } catch {
          // فایل ناخوانا — نادیده
        }
      }
    } catch {
      // دایرکتوری در دسترس نیست
    }
  };
  pushCandidate(path.join(UPLOADS_ROOT, "apk"), "");
  pushCandidate(path.join(process.cwd(), "public", "downloads"), "fitup-own-");
  // توجه: APK اپ کافه‌بازار عمداً در این زنجیره نیست — دانلود «اپ اختصاصی»
  // هرگز نباید فایل اپ بازار را بدهد (اپ‌آیدی/مسیر انتشار متفاوت).
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.version && b.version) {
      for (let i = 0; i < 3; i++) {
        if (b.version[i] !== a.version[i]) return b.version[i] - a.version[i];
      }
      return b.mtime - a.mtime;
    }
    if (a.version) return -1;
    if (b.version) return 1;
    return b.mtime - a.mtime;
  });
  const best = candidates[0];
  return { filePath: best.filePath, fileName: best.fileName };
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
