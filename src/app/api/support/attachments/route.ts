import { NextRequest } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { savePrivateMediaFile } from "@/lib/fitness/private-media";
import { compressVideoFileInPlace, formatBytes } from "@/lib/fitness/media-compress";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * v77 — آپلود پیوست تیکت پشتیبانی (عکس/ویدیو/فایل) — درخواست مالک:
 * «کاربر و مدیر باید بتوانند عکس/ویدیو/فایل‌های دیگر در تیکت بفرستند؛
 * فایل‌ها همیشه بمانند برای پیگیری‌های بعدی»
 *
 * جریان: کلاینت فایل را اینجا آپلود می‌کند (قبل از ثبت تیکت/پاسخ) → رکورد
 * standalone با uploaderId ساخته می‌شود → هنگام ثبت تیکت/پاسخ، attachmentIds
 * پاس داده می‌شود و رکورد به ticketId/replyId متصل می‌شود (در مسیرهای
 * /api/support/tickets و /api/support/tickets/[id]).
 *
 * ماندگاری: فایل روی دیسک در uploads/tickets/ ذخیره می‌شود و سیاست
 * cleanup-media «forever» است — هیچ چیز خودکار حذف نمی‌شود.
 *
 * امنیت سرو: مسیر /uploads/tickets/… در PRIVATE_MEDIA_DIRS است و
 * canAccessPrivateMedia فقط آپلودکننده، مالک تیکت یا ادمین را مجاز می‌کند.
 */

/**
 * گارد فنی حجم فایل (۲ گیگابایت) — دیرکتیو مالک: سقف کاربر-پسند حذف شد؛
 * ویدیوها بعد از آپلود با ffmpeg فشرده می‌شوند و عکس‌های خیلی بزرگ با sharp
 * کوچک می‌شوند (هر دو best-effort). این گارد فقط ضد درخواست‌های مخرب/OOM است.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 8;
/** حداکثر بُعد عکس پیوست — بزرگ‌تر از این با sharp کوچک می‌شود (best-effort) */
const MAX_IMAGE_DIM = 2048;

/** پسوندهای ممنوع (خطر اجرا/نصب) — بقیهٔ انواع معمول مجازند */
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".sh", ".bash", ".ps1",
  ".apk", ".apks", ".xapk", ".jar", ".vbs", ".js", ".mjs", ".dll", ".so",
  ".bin", ".iso", ".dmg", ".app",
]);

function sanitizeFileName(raw: string): string {
  const base = path.basename(raw || "file").replace(/[\u0000-\u001f]/g, "").trim();
  return (base || "file").slice(0, 180);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    // گیت نرخ: ۲۰ آپلود در ۵ دقیقه برای هر کاربر (ادمین/کاربر یکسان)
    const rl = rateLimit(`ticket-attach:${user.id}`, 20, 5 * 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const form = await req.formData().catch(() => null);
    if (!form) {
      return Response.json({ error: "فرم نامعتبر است." }, { status: 400 });
    }
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return Response.json({ error: "فایلی انتخاب نشده است." }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return Response.json(
        { error: `حداکثر ${MAX_FILES_PER_REQUEST} فایل در هر بار.` },
        { status: 400 }
      );
    }

    const saved: Array<{
      id: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      fileUrl: string;
    }> = [];

    for (const file of files) {
      const cleanName = sanitizeFileName(file.name || "file");
      const ext = path.extname(cleanName).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        return Response.json(
          { error: `فایل «${cleanName}» مجاز نیست.` },
          { status: 400 }
        );
      }
      if (file.size <= 0) {
        return Response.json({ error: `فایل «${cleanName}» خالی است.` }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return Response.json(
          {
            error: file.type.startsWith("video/")
              ? "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید."
              : "فایل بسیار بزرگ است.",
          },
          { status: 413 }
        );
      }

      let buffer = Buffer.from(await file.arrayBuffer());
      let saveExt = ext || "";

      // ─── کوچک‌سازی عکس‌های خیلی بزرگ با sharp (best-effort — هرگز throw نمی‌کند) ───
      // فقط وقتی بُعد > ۲۰۴۸px است و خروجی واقعاً کوچک‌تر شد جایگزین می‌شود؛
      // سند/عکس کوچک همان خام ذخیره می‌شود.
      if (file.type.startsWith("image/")) {
        try {
          const sharp = (await import("sharp")).default;
          const meta = await sharp(buffer).metadata();
          const maxDim = Math.max(meta.width ?? 0, meta.height ?? 0);
          if (maxDim > MAX_IMAGE_DIM) {
            const out = await sharp(buffer)
              .rotate()
              .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: "inside", withoutEnlargement: true })
              .webp({ quality: 82 })
              .toBuffer();
            if (out.length > 0 && out.length < buffer.length) {
              buffer = out;
              saveExt = ".webp"; // content-type سرو از روی پسوند فایل تعیین می‌شود
            }
          }
        } catch {
          // عکس خراب/فرمت عجیب → همان خام ذخیره می‌شود (رفتار قبلی)
        }
      }

      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${saveExt}`;
      const { url, filePath } = await savePrivateMediaFile("tickets", uniqueName, buffer);

      const row = await db.ticketAttachment.create({
        data: {
          uploaderId: user.id,
          fileName: cleanName,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          fileUrl: url,
        },
      });

      // ─── فشرده‌سازی ویدیو (best-effort، پس‌زمینه — هرگز throw نمی‌کند) ───
      // قانون مالک: فقط نسخهٔ فشرده نگه داشته می‌شود. پاسخ آپلود فوراً برمی‌گردد
      // و فشرده‌سازی درجا ادامه می‌یابد؛ در پایان اندازهٔ ردیف به‌روز می‌شود.
      if (file.type.startsWith("video/")) {
        void (async () => {
          try {
            const cmp = await compressVideoFileInPlace(filePath, { timeoutMs: 10 * 60_000 });
            if (cmp.compressed) {
              console.log(`[support/attachments] video compressed: ${formatBytes(cmp.sizeBefore)} → ${formatBytes(cmp.sizeAfter)}`);
              await db.ticketAttachment
                .update({ where: { id: row.id }, data: { fileSize: cmp.sizeAfter } })
                .catch(() => {});
            }
          } catch (cmpErr) {
            console.error("[support/attachments] compression step failed (keeping original):", cmpErr);
          }
        })();
      }

      saved.push({
        id: row.id,
        fileName: row.fileName,
        fileType: row.fileType,
        fileSize: row.fileSize,
        fileUrl: row.fileUrl,
      });
    }

    return Response.json({ attachments: saved });
  } catch (e) {
    return apiError(e);
  }
}
