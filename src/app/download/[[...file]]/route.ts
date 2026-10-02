import { NextRequest } from "next/server";
import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import path from "path";

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
