import { NextRequest } from "next/server";
import { Readable } from "stream";
import busboy from "busboy";
import { savePrivateMediaFileStream } from "./private-media";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * v85 — آپلود استریمی multipart (حافظهٔ ثابت) — مشترک بین:
 *   • /api/coach/chat/upload  (ویدیوی «چت با فیتاپ»)
 *   • /api/coach/analyze-video (آنالیز ویدیویی فرم بدن)
 *
 * فایل هرگز کامل در RAM بافر نمی‌شود — با busboy chunk به chunk مستقیم روی
 * دیسک نوشته می‌شود → آپلود ویدیوهای حجیم (حتی ۵۰۰ مگابایت — دیریکتیو مالک)
 * بدون ریسک OOM انجام می‌شود. نسخهٔ قبلی (req.formData + arrayBuffer) کل فایل
 * را در حافظه نگه می‌داشت.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface StreamUploadResultOk {
  ok: true;
  url: string;
  size: number;
  /** فیلدهای متنی multipart (مثل userContext) — هر فیلد سقف ۶۴KB */
  fields: Record<string, string>;
}

export interface StreamUploadResultErr {
  ok: false;
  status: number;
  error: string;
  code?: string;
}

export interface StreamUploadOptions {
  /** نام فیلد فایل در multipart (مثل "file" یا "video") */
  fieldName: string;
  /** زیرپوشهٔ ذخیره در uploads/ (مثل "chat" یا "videos") — باید دستهٔ خصوصی مجاز باشد */
  subDir: string;
  /** نام فایل نهایی بر اساس پسوند تشخیص‌داده‌شده (الگوی مالکیت را رعایت کند!) */
  fileNameBuilder: (ext: string) => string;
  /** سقف فنی حجم (bytes) — عبور = 413 */
  maxBytes: number;
  /** پسوندهای مجاز (برای فایل‌های octet-stream و تشخیص ext) */
  allowedExts: string[];
  /** نگاشت mime → ext (اختیاری) */
  mimeToExt?: Record<string, string>;
  /** آیا نوع باید video/* یا پسوند مجاز باشد؟ (true برای ویدیوها) */
  videoTypeOnly?: boolean;
  /** خطاهای استاندارد (فارسی) قابل بازنویسی */
  errors?: {
    notVideo?: string;
    tooLarge?: string;
    invalidRequest?: string;
    noFile?: string;
  };
}

const DEFAULT_MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
};

/**
 * پارس استریمی اولین فایل multipart و ذخیرهٔ مستقیم آن در رسانهٔ خصوصی.
 * هیچ throw نمی‌کند — همیشه نتیجهٔ ساختارمند برمی‌گرداند.
 */
export async function streamMultipartFile(
  req: NextRequest,
  opts: StreamUploadOptions
): Promise<StreamUploadResultOk | StreamUploadResultErr> {
  if (!req.body) {
    return {
      ok: false,
      status: 400,
      error: opts.errors?.invalidRequest ?? "درخواست نامعتبر است. لطفاً دوباره تلاش کن.",
      code: "INVALID_FORMAT",
    };
  }

  return new Promise<StreamUploadResultOk | StreamUploadResultErr>((resolve) => {
    let settled = false;
    const done = (v: StreamUploadResultOk | StreamUploadResultErr) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });

    /** فیلدهای متنی فرم (غیر فایل) — سقف سخت ۶۴KB برای هر فیلد */
    const fields: Record<string, string> = {};

    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers, limits: { files: 1, fileSize: opts.maxBytes } });
    } catch {
      done({
        ok: false,
        status: 400,
        error: opts.errors?.invalidRequest ?? "درخواست نامعتبر است. لطفاً دوباره تلاش کن.",
        code: "INVALID_FORMAT",
      });
      return;
    }

    const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
    nodeStream.pipe(bb);

    // فیلدهای متنی فرم — مثل userContext (سقف ۶۴KB هر فیلد)
    bb.on("field", (name, value) => {
      if (typeof value === "string" && value.length <= 64 * 1024) {
        fields[name] = value;
      }
    });

    bb.on("file", (_name, fileStream, info) => {
      const mimeType = (info.mimeType || "").toLowerCase();
      const nameExt = ((info.filename || "").split(".").pop() || "").toLowerCase();

      // ─── اعتبارسنجی نوع: video/* یا پسوند شناخته‌شده (برای octet-stream) ───
      const mimeMap = { ...DEFAULT_MIME_EXT, ...(opts.mimeToExt ?? {}) };
      const extFromMime = mimeMap[mimeType];
      const extAllowed = opts.allowedExts.includes(nameExt);
      if (opts.videoTypeOnly && !mimeType.startsWith("video/") && !extAllowed) {
        fileStream.resume(); // تخلیهٔ استریم برای پایان تمیز
        nodeStream.unpipe(bb);
        done({
          ok: false,
          status: 400,
          error: opts.errors?.notVideo ?? "فقط فایل ویدیویی مجاز است.",
          code: "INVALID_TYPE",
        });
        return;
      }
      const ext = extFromMime || (extAllowed ? nameExt : opts.allowedExts[0] || "mp4");
      const fileName = opts.fileNameBuilder(ext);

      let bytes = 0;
      let aborted = false;
      let sink: ReturnType<typeof savePrivateMediaFileStream>;
      try {
        sink = savePrivateMediaFileStream(opts.subDir, fileName);
      } catch {
        fileStream.resume();
        nodeStream.unpipe(bb);
        done({
          ok: false,
          status: 400,
          error: opts.errors?.invalidRequest ?? "درخواست نامعتبر است.",
          code: "INVALID_FORMAT",
        });
        return;
      }

      fileStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      // سقف فنی — busboy خودش استریم را می‌بندد و 'limit' می‌دهد
      fileStream.on("limit", () => {
        aborted = true;
        void sink.abort().then(() =>
          done({
            ok: false,
            status: 413,
            error: opts.errors?.tooLarge ?? "فایل بسیار بزرگ است. لطفاً ویدیوی کوتاه‌تری بفرستید.",
            code: "PAYLOAD_TOO_LARGE",
          })
        );
      });
      fileStream.on("error", (err) => {
        console.error("[stream-upload] file stream error:", err);
        if (!aborted) {
          aborted = true;
          void sink.abort().then(() =>
            done({
              ok: false,
              status: 400,
              error: "دریافت فایل ناموفق بود. دوباره تلاش کن.",
              code: "UPLOAD_FAILED",
            })
          );
        }
      });
      fileStream.pipe(sink.stream);
      sink.stream.on("finish", () => {
        if (!aborted && bytes > 0) {
          done({ ok: true, url: sink.url, size: bytes, fields });
        } else if (!aborted) {
          void sink.abort().then(() =>
            done({
              ok: false,
              status: 400,
              error: opts.errors?.noFile ?? "فایل ارسال نشده است. لطفاً دوباره تلاش کن.",
              code: "NO_FILE",
            })
          );
        }
      });
      sink.stream.on("error", (err) => {
        console.error("[stream-upload] disk write error:", err);
        if (!aborted) {
          aborted = true;
          void sink.abort().then(() =>
            done({
              ok: false,
              status: 500,
              error: "ذخیرهٔ فایل ناموفق بود. دوباره تلاش کن.",
              code: "SAVE_FAILED",
            })
          );
        }
      });
    });

    bb.on("error", (err) => {
      console.error("[stream-upload] busboy error:", err);
      done({
        ok: false,
        status: 400,
        error: opts.errors?.invalidRequest ?? "درخواست نامعتبر است. لطفاً دوباره تلاش کن.",
        code: "INVALID_FORMAT",
      });
    });
    nodeStream.on("error", (err) => {
      console.error("[stream-upload] request stream error:", err);
      done({
        ok: false,
        status: 400,
        error: "درخواست قطع شد. لطفاً دوباره تلاش کن.",
        code: "UPLOAD_FAILED",
      });
    });
  });
}
