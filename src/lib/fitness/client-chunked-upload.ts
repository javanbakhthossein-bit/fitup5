"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v90 — آپلود چانکی فایل‌های حجیم از سمت کلاینت
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * فیکس ریشه‌ای «ویدیوی ۸۶ مگابایتی آپلود نمی‌شود»: آپلود تک‌درخواستی روی
 * گیت‌وی تولیدی (~۱۲۰s قطع) برای اتصال موبایل ایران قابل‌اعتماد نیست.
 * اینجا فایل به چانک‌های ۴ مگابایتی تقسیم می‌شود؛ هر چانک یک درخواست
 * چندثانیه‌ای مستقل با retry — عملاً غیرقابل‌شکست در برابر تایم‌اوت گیت‌وی.
 *
 * مسیر سرور (پیش‌فرض): POST /api/coach/upload-chunk + POST /api/coach/upload-complete
 * (هر دو با احراز هویت سشن — cookies هم‌مبدأ خودکار ارسال می‌شود)
 *
 * v112 — مسیرهای سفارشی: با opts.endpoints مسیر دیگری می‌توان داد (پنل ادمین
 * برای ویدیوی اختصاصی حرکات از /api/admin/exercises/upload-chunk +
 * upload-complete استفاده می‌کند)؛ پاسخِ complete با کلید videoUrl/ok هم
 * پذیرفته می‌شود (به‌علاوهٔ mediaUrl) و در raw پاسخ کامل سرور برگردانده می‌شود.
 *
 * قابل لغو: abortRef.current?.abort() همهٔ درخواست‌های باقی‌مانده را قطع می‌کند.
 * پیشرفت: onProgress با درصد واقعی بایت‌های رسیده (۰ تا ۱۰۰).
 */

export type ChunkedUploadTarget = "chat" | "videos" | "exercise-videos";

export interface ChunkedUploadResult {
  mediaUrl: string;
  size: number;
  /** فقط برای target=videos — تحلیل پس‌زمینه شروع شد */
  started?: boolean;
  status?: string;
  /** v112 — پاسخ کامل سرور (برای مسیرهای سفارشی مثل آپلود ویدیوی حرکت ادمین) */
  raw?: Record<string, unknown>;
}

export interface ChunkedUploadOptions {
  /** اندازهٔ هر چانک (پیش‌فرض ۴ مگابایت) */
  chunkSize?: number;
  /** درصد پیشرفت ۰-۱۰۰ */
  onProgress?: (pct: number) => void;
  /** برای لغو — caller یک { current: null } می‌سازد و در دکمهٔ لغو abort() می‌زند */
  abortRef?: { current: AbortController | null };
  /** retry هر چانک در خطای گذرا (پیش‌فرض ۳) */
  retriesPerChunk?: number;
  /** v112 — مسیرهای سفارشی (پیش‌فرض: /api/coach/*) */
  endpoints?: { chunk: string; complete: string };
  /** v112 — فیلدهای اضافی بدنهٔ JSON کامل‌کردن (مثل exerciseId ادمین) — با فیلدهای پیش‌فرض merge می‌شود */
  completeBody?: Record<string, unknown>;
}

const CHUNK_SIZE_DEFAULT = 4 * 1024 * 1024;

/** شناسهٔ یکتای آپلود — الگوی امن سرور [A-Za-z0-9_-]{8,64} */
function makeUploadId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `up${Date.now().toString(36)}${rand}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadFileChunked(
  file: File,
  target: ChunkedUploadTarget,
  opts: ChunkedUploadOptions = {}
): Promise<ChunkedUploadResult> {
  const chunkSize = Math.max(256 * 1024, opts.chunkSize ?? CHUNK_SIZE_DEFAULT);
  const retries = opts.retriesPerChunk ?? 3;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  const uploadId = makeUploadId();
  const controller = new AbortController();
  if (opts.abortRef) opts.abortRef.current = controller;

  // v112 — مسیرهای سفارشی (ادمین) یا پیش‌فرض coach
  const chunkEndpoint = opts.endpoints?.chunk ?? "/api/coach/upload-chunk";
  const completeEndpoint = opts.endpoints?.complete ?? "/api/coach/upload-complete";

  const fail = (msg: string, err?: unknown): never => {
    controller.abort();
    if (err) console.error("[chunked-upload]", msg, err);
    throw new Error(msg);
  };

  try {
    // ─── ارسال ترتیبی چانک‌ها — هر کدام مستقل و قابل retry ───
    for (let index = 0; index < totalChunks; index++) {
      if (controller.signal.aborted) throw new Error("آپلود ویدیو لغو شد.");
      const start = index * chunkSize;
      const blob = file.slice(start, Math.min(file.size, start + chunkSize));

      let lastErr: unknown = null;
      let sent = false;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const res = await fetch(chunkEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "x-upload-id": uploadId,
              "x-upload-target": target,
              "x-chunk-index": String(index),
            },
            body: blob,
            signal: controller.signal,
          });
          if (!res.ok) {
            // خطای قطعی سرور (۴xx غیر از ۴۲۹) → بدون retry رد شو
            let errMsg = `آپلود بخش ${index + 1} ناموفق بود (${res.status}).`;
            try {
              const j = await res.json();
              if (j?.error) errMsg = String(j.error);
            } catch {}
            if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 413) {
              fail(errMsg);
            }
            lastErr = new Error(errMsg);
            await sleep(600 * attempt);
            continue;
          }
          sent = true;
          break;
        } catch (e) {
          if (controller.signal.aborted) throw new Error("آپلود ویدیو لغو شد.");
          lastErr = e;
          await sleep(600 * attempt);
        }
      }
      if (!sent) {
        fail("ارتباط در حین آپلود قطع شد. دوباره تلاش کن.", lastErr);
      }

      // پیشرفت واقعی — نسبت چانک‌های تحویل‌شده
      if (opts.onProgress) {
        const pct = Math.min(99, Math.round(((index + 1) / totalChunks) * 100));
        opts.onProgress(pct);
      }
    }

    if (opts.onProgress) opts.onProgress(99);

    // ─── پایان: سرهم‌کردن چانک‌ها سمت سرور ───
    const completeRes = await fetch(completeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        target,
        fileName: file.name || "video.mp4",
        fileType: file.type || "video/mp4",
        size: file.size,
        totalChunks,
        ...(opts.completeBody ?? {}),
      }),
      signal: controller.signal,
    }).catch((e) => fail("ارتباط با سرور برقرار نشد. دوباره تلاش کن.", e));

    if (!completeRes.ok) {
      let errMsg = "پایان آپلود ناموفق بود. دوباره تلاش کن.";
      try {
        const j = await completeRes.json();
        if (j?.error) errMsg = String(j.error);
      } catch {}
      fail(errMsg);
    }

    const data = (await completeRes.json()) as ChunkedUploadResult & {
      videoUrl?: string;
      [key: string]: unknown;
    };
    // v112 — مسیرهای سفارشی (ادمین) { ok, videoUrl, … } را هم می‌پذیرند
    const resultUrl = data?.mediaUrl || data?.videoUrl || "";
    if (!resultUrl && !data?.ok) fail("پاسخ سرور نامعتبر بود.");

    if (opts.onProgress) opts.onProgress(100);
    return { ...data, mediaUrl: resultUrl, raw: data as Record<string, unknown> } as ChunkedUploadResult;
  } finally {
    if (opts.abortRef && opts.abortRef.current === controller) {
      opts.abortRef.current = null;
    }
  }
}
