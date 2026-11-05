import "server-only";
import path from "path";
import { mkdir, writeFile, readdir, stat, rm } from "fs/promises";
import { UPLOADS_ROOT } from "./uploads-config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v90 — آپلود چانکی ویدیو (فیکس ریشه‌ای «ویدیوی ۸۶ مگابایتی آپلود نمی‌شود»)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ممیزی مالک: آپلود تک‌درخواستی یک فایل بزرگ (۸۶ مگابایت به بالا) روی گیت‌وی
 * تولیدی به‌طور قابل‌اعتماد شکست می‌خورد — اتصال موبایل ایران برای بدنهٔ چند
 * ده/صد مگابایتی دقیقه‌ها باز می‌ماند و لایهٔ میانی (گیت‌وی ~۱۲۰s) قطع می‌کند.
 *
 * راه‌حل: فایل در کلاینت به چانک‌های کوچک (پیش‌فرض ۴ مگابایت) تقسیم می‌شود؛
 * هر چانک یک درخواست چند‌ثانیه‌ای مستقل است (خیلی زیر هر سقف/تایم‌اوت گیت‌وی)،
 * با retry per-chunk؛ در پایان سرور چانک‌ها را به فایل نهایی می‌چسباند.
 *
 * امنیت:
 *  • uploadId فقط الگوی امن [A-Za-z0-9_-] (بدون traversal)
 *  • مقصد فقط دسته‌های مجاز ("chat" | "videos" | "exercise-videos" — دومی از v112 عمومی است)
 *  • سقف فنی هر فایل ۲ گیگابایت و هر چانک ۸ مگابایت (ضد سوءاستفاده)
 *  • نام فایل نهایی همیشه توسط fileNameBuilder سمت سرور ساخته می‌شود — الگوی
 *    مالکیت (chat-video-{uid}-… / video-{uid}-… / ex-{exerciseId}-…) با مسیرهای
 *    قبلی یکسان می‌ماند؛ «exercise-videos» (v112) رسانهٔ عمومی است و اسم سطر
 *    دیتابیس (ExerciseLibrary) را از نام فایل استخراج نمی‌کند — مالکیت با
 *    requireAdmin روی خود routeها کنترل می‌شود.
 *  • چانک‌های یتیم (اتصال قطع) با پاک‌سازی خودکار ۲۴ ساعته حذف می‌شوند
 */

export const CHUNKED_UPLOAD_TARGETS = ["chat", "videos", "exercise-videos"] as const;
export type ChunkedUploadTarget = (typeof CHUNKED_UPLOAD_TARGETS)[number];

/** سقف فنی کل فایل — هم‌خوان با سقف ۲ گیگابایتی مسیرهای multipart */
export const CHUNKED_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
/** سقف هر چانک — کلاینت ۴ مگابایت می‌فرستد؛ ۸ مگابایت حاشیهٔ امن */
export const CHUNKED_MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** حداکثر تعداد چانک (۲GB ÷ ۴MB = ۵۱۲ — حاشیه تا ۱۰۲۴) */
export const CHUNKED_MAX_PARTS = 1024;
/** عمر چانک‌های یتیم قبل از پاک‌سازی
 * 🔒 ممیزی امنیتی F8 — قبلاً ۲۴ ساعت بود: یک کاربر می‌توانست با چانک‌های
 * رهاشده ~۲GB/دقیقه دیسک را پر کند و تا یک روز جا اشغال می‌ماند. حالا ۲ ساعت. */
const STALE_CHUNK_TTL_MS = 2 * 60 * 60 * 1000;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function chunksRoot(target: ChunkedUploadTarget): string {
  return path.join(UPLOADS_ROOT, target, ".chunks");
}

function chunkDir(target: ChunkedUploadTarget, uploadId: string): string {
  return path.join(chunksRoot(target), uploadId);
}

/** اعتبارسنجی uploadId — هر چیز دیگری رد می‌شود (ضد traversal) */
export function isValidUploadId(uploadId: unknown): uploadId is string {
  return typeof uploadId === "string" && SAFE_ID_RE.test(uploadId);
}

export function isChunkedTarget(t: unknown): t is ChunkedUploadTarget {
  return typeof t === "string" && (CHUNKED_UPLOAD_TARGETS as readonly string[]).includes(t);
}

/**
 * ذخیرهٔ یک چانک روی دیسک — بدنهٔ خام درخواست (octet-stream) مستقیم نوشته می‌شود.
 * هرگز throw نمی‌کند — نتیجهٔ ساختارمند برمی‌گرداند.
 */
export async function saveChunk(
  target: ChunkedUploadTarget,
  uploadId: string,
  index: number,
  body: ArrayBuffer
): Promise<{ ok: true } | { ok: false; status: number; error: string; code?: string }> {
  try {
    if (!Number.isInteger(index) || index < 0 || index >= CHUNKED_MAX_PARTS) {
      return { ok: false, status: 400, error: "شمارهٔ چانک نامعتبر است.", code: "INVALID_INDEX" };
    }
    if (body.byteLength <= 0) {
      return { ok: false, status: 400, error: "چانک خالی است.", code: "EMPTY_CHUNK" };
    }
    if (body.byteLength > CHUNKED_MAX_CHUNK_BYTES) {
      return { ok: false, status: 413, error: "چانک بزرگ‌تر از حد مجاز است.", code: "CHUNK_TOO_LARGE" };
    }
    const dir = chunkDir(target, uploadId);
    await mkdir(dir, { recursive: true });
    const partPath = path.join(dir, `${String(index).padStart(4, "0")}.part`);
    await writeFile(partPath, Buffer.from(body));
    // پاک‌سازی گاه‌به‌گاه چانک‌های یتیم (احتمال ۵٪ — هزینهٔ ناچیز)
    if (Math.random() < 0.25) { // F8: پاک‌سازی پرتکرارتر (قبلاً ۵٪)
      void cleanupStaleChunks(target);
    }
    return { ok: true };
  } catch (e) {
    console.error("[chunked-upload] saveChunk failed:", e);
    return { ok: false, status: 500, error: "ذخیرهٔ چانک ناموفق بود. دوباره تلاش کن.", code: "SAVE_FAILED" };
  }
}

export interface AssembleOptions {
  target: ChunkedUploadTarget;
  uploadId: string;
  totalChunks: number;
  /** سقف فنی کل فایل (۴۱۳ در عبور) */
  maxTotalBytes?: number;
  /** سازندهٔ نام فایل نهایی (الگوی مالکیت را رعایت کند) */
  fileNameBuilder: (ext: string) => string;
  /** پسوند نهایی فایل — caller از لیست سفید انتخاب می‌کند (safeExtFromFileName) */
  extForAssembly: string;
}

export type AssembleResult =
  | { ok: true; url: string; size: number }
  | { ok: false; status: number; error: string; code?: string };

/**
 * چسباندن چانک‌ها به فایل نهایی در uploads/{target}/ — به ترتیب ایندکس،
 * با بررسی وجود همهٔ اجزا و سقف حجم. بعد از موفقیت پوشهٔ چانک‌ها حذف می‌شود.
 * هرگز throw نمی‌کند.
 */
export async function assembleChunks(opts: AssembleOptions): Promise<AssembleResult> {
  const dir = chunkDir(opts.target, opts.uploadId);
  try {
    if (!Number.isInteger(opts.totalChunks) || opts.totalChunks < 1 || opts.totalChunks > CHUNKED_MAX_PARTS) {
      return { ok: false, status: 400, error: "تعداد چانک نامعتبر است.", code: "INVALID_TOTAL" };
    }

    // نام فایل کلاینت فقط برای «تشخیص پسوند» استفاده می‌شود — خود نام نهایی سرور می‌سازد
    // (پسوند در همین‌جا از طریق allowedExts کنترل می‌شود؛ caller ext را از fileName بیرون می‌کشد)

    const entries: { index: number; size: number }[] = [];
    let totalSize = 0;
    for (let i = 0; i < opts.totalChunks; i++) {
      const partPath = path.join(dir, `${String(i).padStart(4, "0")}.part`);
      const st = await stat(partPath).catch(() => null);
      if (!st || !st.isFile() || st.size === 0) {
        return {
          ok: false,
          status: 400,
          error: "برخی بخش‌های فایل دریافت نشده‌اند. لطفاً دوباره تلاش کن.",
          code: "MISSING_PARTS",
        };
      }
      entries.push({ index: i, size: st.size });
      totalSize += st.size;
    }

    const maxTotal = opts.maxTotalBytes ?? CHUNKED_MAX_TOTAL_BYTES;
    if (totalSize <= 0 || totalSize > maxTotal) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return { ok: false, status: 413, error: "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید.", code: "PAYLOAD_TOO_LARGE" };
    }

    const finalName = opts.fileNameBuilder(opts.extForAssembly);
    const finalPath = path.join(UPLOADS_ROOT, opts.target, path.basename(finalName));
    await mkdir(path.dirname(finalPath), { recursive: true });

    // نوشتن ترتیبی — چانک به چانک append می‌شود (حافظهٔ ثابت)
    const { open, unlink: unlinkFile } = await import("fs/promises");
    const out = await open(finalPath, "w");
    try {
      for (const { index } of entries) {
        const partPath = path.join(dir, `${String(index).padStart(4, "0")}.part`);
        const buf = await (await import("fs/promises")).readFile(partPath);
        await out.write(buf);
      }
    } finally {
      await out.close().catch(() => {});
    }

    // اعتبارسنجی نهایی — حجم فایل نوشته‌شده باید برابر مجموع چانک‌ها باشد
    const finalSt = await stat(finalPath).catch(() => null);
    if (!finalSt || finalSt.size !== totalSize) {
      await unlinkFile(finalPath).catch(() => {});
      return { ok: false, status: 500, error: "سرهم‌کردن فایل ناموفق بود. دوباره تلاش کن.", code: "ASSEMBLE_FAILED" };
    }

    // پاک‌سازی چانک‌ها
    await rm(dir, { recursive: true, force: true }).catch(() => {});

    return { ok: true, url: `/uploads/${opts.target}/${path.basename(finalName)}`, size: totalSize };
  } catch (e) {
    console.error("[chunked-upload] assembleChunks failed:", e);
    return { ok: false, status: 500, error: "سرهم‌کردن فایل ناموفق بود. دوباره تلاش کن.", code: "ASSEMBLE_FAILED" };
  }
}

/** حذف پوشه‌های چانک یتیم (اتصال قطع/تب بسته) — هرگز throw نمی‌کند */
export async function cleanupStaleChunks(target: ChunkedUploadTarget): Promise<void> {
  try {
    const root = chunksRoot(target);
    const dirs = await readdir(root).catch(() => [] as string[]);
    const now = Date.now();
    for (const d of dirs) {
      const dirPath = path.join(root, d);
      const st = await stat(dirPath).catch(() => null);
      if (st && st.mtimeMs < now - STALE_CHUNK_TTL_MS) {
        await rm(dirPath, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // پاک‌سازی حیاتی نیست
  }
}

/** استخراج پسوند امن از نام فایل کلاینت — فقط پسوندهای لیست سفید */
export function safeExtFromFileName(fileName: unknown, allowedExts: string[]): string | null {
  if (typeof fileName !== "string" || !fileName) return null;
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (!ext || !allowedExts.includes(ext)) return null;
  return ext;
}
