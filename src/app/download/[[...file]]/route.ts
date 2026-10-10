import { NextRequest } from "next/server";
import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { createHmac, timingSafeEqual } from "crypto";
import path from "path";
import { getCurrentUser } from "@/lib/fitness/auth";

/**
 * v220 — لینک دانلود توکن‌دار برای مالک (بازگزارش «زیپ دانلود نمیشه»)
 *
 * مشکل: از ممیزی v202 این مسیر فقط با سشن ادمین باز می‌شود؛ داخل پیش‌نمایش
 * سندباکس دانلودِ iframe گاهی بلاک می‌شود و لاگین ادمین هم همیشه در دسترس
 * نیست → مالک زیپ دیپلوی را نمی‌تواند بگیرد.
 *
 * راه‌حل: توکن امضاشدهٔ کوتاه‌عمر (۴۸ ساعت) در ?t= — بدون دیتابیس، stateless:
 *   token = expHex(میلی‌ثانیه) + "." + HMAC-SHA256(secret, "deploy-zip:" + expHex)
 *   secret = HMAC-SHA256("fitup-deploy-zip-v1", DATABASE_URL)
 *
 * امنیت:
 *   • کلید در سورس نیست — از DATABASE_URL (.env، هرگز در zip نمی‌رود) مشتق می‌شود؛
 *     روی سرورِ دیگر DATABASE_URL متفاوت است → توکن سندباکس آنجا بی‌اعتبار.
 *   • توکن منقضی = رد؛ مقایسهٔ timing-safe؛ مسیر ادمین (بدون توکن) دست‌نخورده.
 *   • فقط زیپ‌های deploy داخل download/ و public/downloads سرو می‌شود (مثل قبل).
 */

function deployZipSecret(): string {
  const dbUrl = process.env.DATABASE_URL || "fitup-no-dburl";
  return createHmac("sha256", "fitup-deploy-zip-v1").update(dbUrl).digest("hex");
}

function signDeployToken(expHex: string): string {
  return createHmac("sha256", deployZipSecret()).update(`deploy-zip:${expHex}`).digest("hex");
}

function verifyDeployToken(token: string | null): boolean {
  if (!token) return false;
  const m = /^([0-9a-f]+)\.([0-9a-f]{64})$/i.exec(token.trim());
  if (!m) return false;
  const exp = Number.parseInt(m[1], 16);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signDeployToken(m[1].toLowerCase());
  try {
    return timingSafeEqual(Buffer.from(m[2], "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** صفحهٔ ۴۰۳ — پیام متغیر بر اساس وضعیت توکن */
function accessDeniedPage(reason: "no-auth" | "bad-token" | "expired"): Response {
  const title = reason === "no-auth" ? "دسترسی محدود" : "لینک دانلود معتبر نیست";
  const body =
    reason === "no-auth"
      ? "این بخش فقط برای مدیر فیتاپ است.<br/>برای دانلود فایل دیپلوی، ابتدا با شمارهٔ مدیر وارد شوید و دوباره این لینک را باز کنید."
      : reason === "expired"
        ? "لینک دانلود منقضی شده (۴۸ ساعت اعتبار دارد).<br/>دوباره از دستیار لینک تازه بگیرید."
        : "لینک دانلود نامعتبر است.<br/>لینک را کامل کپی کرده‌اید؟ دوباره از دستیار لینک تازه بگیرید.";
  return new Response(
    `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} — فیتاپ</title></head>
<body style="font-family:system-ui,Tahoma,sans-serif;background:#fafaf9;color:#1c1917;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:32px;text-align:center;background:#fff;border:1px solid #e7e5e4;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06)">
<div style="font-size:40px">${reason === "no-auth" ? "🔐" : "⏳"}</div>
<h1 style="font-size:18px;margin:12px 0">${title}</h1>
<p style="font-size:14px;color:#57534e;line-height:2">${body}</p>
<a href="/enter" style="display:inline-block;margin-top:12px;padding:10px 24px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#fff;border-radius:12px;text-decoration:none;font-size:14px;font-weight:700">ورود مدیر</a>
</div></body></html>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

/**
 * GET /download — دانلود «آخرین» زیپ دیپلوی فیتاپ (fitup-deploy-*-vNNN.zip)
 * GET /download/<filename>.zip — دانلود یک فایل زیپ مشخص
 *
 * عمومی (بدون لاگین) — مالک باید بتواند از سندباکس/مرورگر مستقیم زیپ آخر را بگیرد.
 *
 * ─── چرا این route ساخته شد؟ ───
 * زیپ‌های دیپلوی در دو جا کپی می‌شوند: download/ و public/downloads/.
 * مسیر استاتیک /downloads/<file>.zip کار می‌کند ولی:
 *   ۱) تایپ اشتباه مسیر /download/ (بدون s) → 404 (در لاگ واقعی رخ داد)
 *   ۲) داخل iframe پیش‌نمایش سندباکس، دانلود استاتیک گاهی بلاک می‌شود
 *   ۳) لینکی که «همیشه آخرین زیپ» را بدهد وجود نداشت
 * این route هر سه مشکل را حل می‌کند:
 *   - /download           → همیشه آخرین زیپ (بالاترین vNNN)
 *   - /download/<name>.zip → همان فایل (با هر دو املای مسیر)
 *   - هدر Content-Disposition: attachment → مرورگر «دانلود» می‌کند نه باز کردن
 *   - پشتیبانی Range (206) → ادامه دانلود قطع‌شده در دانلود منیجرها
 *
 * امنیت: فقط فایل‌های *.zip داخل download/ و public/downloads/ سرو می‌شوند؛
 * نام فایل با basename پاک‌سازی می‌شود و path traversal بلاک است.
 */

const ZIP_MIME = "application/zip";
const ZIP_EXT = ".zip";

/** دایرکتوری‌های مجاز منبع زیپ — به‌ترتیب اولویت */
function zipDirs(): string[] {
  return [
    path.join(process.cwd(), "download"),
    path.join(process.cwd(), "public", "downloads"),
  ];
}

type ZipCandidate = { filePath: string; fileName: string; v: number; mtime: number };

/** جمع‌آوری همهٔ زیپ‌های دیپلوی موجود (fitup-deploy-*-vNNN.zip) */
function collectDeployZips(): ZipCandidate[] {
  const candidates: ZipCandidate[] = [];
  for (const dir of zipDirs()) {
    try {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.toLowerCase().endsWith(ZIP_EXT)) continue;
        if (!/^fitup-deploy-.+\.zip$/i.test(f)) continue;
        const full = path.join(dir, f);
        try {
          if (!statSync(full).isFile()) continue;
          const vMatch = /v(\d+)\.zip$/i.exec(f);
          candidates.push({
            filePath: full,
            fileName: f,
            v: vMatch ? Number(vMatch[1]) : 0,
            mtime: statSync(full).mtimeMs,
          });
        } catch {
          // فایل ناخوانا — نادیده
        }
      }
    } catch {
      // دایرکتوری در دسترس نیست
    }
  }
  return candidates;
}

/** پیدا کردن «آخرین» زیپ: بالاترین vNNN، بعد تازه‌ترین mtime */
function resolveLatestZip(): ZipCandidate | null {
  const all = collectDeployZips();
  if (all.length === 0) return null;
  all.sort((a, b) => (b.v !== a.v ? b.v - a.v : b.mtime - a.mtime));
  return all[0];
}

/** پیدا کردن یک فایل مشخص (فقط نام ساده، بدون مسیر) در دایرکتوری‌های مجاز */
function resolveNamedZip(rawName: string): ZipCandidate | null {
  const safeName = path.basename(rawName).trim();
  // پاک‌سازی سخت‌گیرانه: فقط حروف/عدد/خط تیره/نقطه/زیرخط + پسوند zip
  if (!safeName || safeName.startsWith(".") || !safeName.toLowerCase().endsWith(ZIP_EXT)) return null;
  if (!/^[\w.\-]+\.zip$/i.test(safeName)) return null;
  for (const dir of zipDirs()) {
    try {
      const full = path.resolve(dir, safeName);
      if (!full.startsWith(path.resolve(dir))) continue; // traversal
      if (!existsSync(full)) continue;
      if (!statSync(full).isFile()) continue;
      const vMatch = /v(\d+)\.zip$/i.exec(safeName);
      return {
        filePath: full,
        fileName: safeName,
        v: vMatch ? Number(vMatch[1]) : 0,
        mtime: statSync(full).mtimeMs,
      };
    } catch {
      // ادامه جست‌وجو
    }
  }
  return null;
}

function zipHeaders(zip: ZipCandidate, size: number): Record<string, string> {
  return {
    "Content-Type": ZIP_MIME,
    "Content-Length": String(size),
    "Content-Disposition": `attachment; filename="${zip.fileName}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ file?: string[] }> }) {
  try {
    // ═══ v202 ممیزی (H2) — این مسیر فقط برای ادمین (مالک) ═══
    // قبلاً «عمومی» بود و هر غریبه‌ای می‌توانست سورس کامل سایت (شامل منطق
    // پرداخت و کلیدها) را دانلود کند. حالا سشن ادمین لازم است؛ کاربر عادی
    // صفحهٔ راهنمای فارسی می‌گیرد. فایل‌های عمومی (APK اپ‌ها) همچنان از
    // /downloads/*.apk بدون لاگین سرو می‌شوند — این مسیر فقط زیپ سورس است.
    // ═══ v220 — گرهٔ توکن: ?t= معتبر (۴۸ ساعت) بدون لاگین هم باز می‌کند ═══
    const url = new URL(req.url);
    const tParam = url.searchParams.get("t");
    let authorized = false;
    let denyReason: "no-auth" | "bad-token" | "expired" = "no-auth";
    if (tParam !== null) {
      if (verifyDeployToken(tParam)) {
        authorized = true;
      } else {
        const m = /^([0-9a-f]+)\.([0-9a-f]{64})$/i.exec(tParam.trim());
        const exp = m ? Number.parseInt(m[1], 16) : NaN;
        denyReason = Number.isFinite(exp) && exp < Date.now() ? "expired" : "bad-token";
      }
    }
    if (!authorized) {
      const admin = await getCurrentUser();
      if (admin?.role === "ADMIN") {
        authorized = true;
      } else if (tParam !== null) {
        return accessDeniedPage(denyReason);
      } else {
        return accessDeniedPage("no-auth");
      }
    }

    const { file } = await ctx.params;

    // فقط یک سگمنت مجاز است: /download/<file>.zip
    if (file && file.length > 1) {
      return new Response("مسیر نامعتبر", { status: 404 });
    }

    const zip = file?.[0] ? resolveNamedZip(decodeURIComponent(file[0])) : resolveLatestZip();
    if (!zip) {
      return new Response(
        file?.[0] ? "فایل زیپ درخواستی یافت نشد" : "هیچ زیپ دیپلوی‌ای موجود نیست",
        { status: 404 }
      );
    }

    let size = 0;
    try {
      const st = await stat(zip.filePath);
      if (!st.isFile()) throw new Error("not file");
      size = st.size;
    } catch {
      return new Response("فایل زیپ روی سرور یافت نشد", { status: 404 });
    }

    // پشتیبانی Range برای ادامه دانلود قطع‌شده
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
        const stream = createReadStream(zip.filePath, { start, end });
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            ...zipHeaders(zip, end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${size}`,
          },
        });
      }
    }

    const stream = createReadStream(zip.filePath);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: zipHeaders(zip, size),
    });
  } catch (err) {
    console.error("[download] خطای غیرمنتظره:", err instanceof Error ? err.message : err);
    return new Response("خطا در آماده‌سازی دانلود", { status: 500 });
  }
}
