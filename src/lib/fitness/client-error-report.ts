/**
 * ─── گزارش خطای کلاینت با دِداپ + ریکاوری خودکار چانک (v67) ───
 *
 * مشکل گزارش‌شدهٔ مالک (لاگ خطاهای مدیر):
 *   «Loading chunk N failed» یکسان چندین بار در چند ساعت درج می‌شود
 *   (مثلاً chunk 9711 شش بار در دو ساعت از یک دستگاه).
 *
 * ریشه:
 *   ۱) کلاینت هیچ دِداپی نداشت — هر mount مرز خطا/هر رویداد window یک POST
 *      مستقل می‌فرستاد و تنها سدِ سرور، پنجرهٔ ۱۵ دقیقه‌ای دِداپ بود؛ یعنی
 *      مشکلِ جاری هر ۱۵ دقیقه یک رکورد جدید می‌ساخت.
 *   ۲) ریکاوریِ «reload برای chunk قدیمی» فقط داخل error.tsx/global-error.tsx
 *      بود؛ خطاهای chunk که به مرز خطای React نمی‌رسیدند (dynamic import در
 *      event handler → unhandledrejection) هرگز reload نمی‌شدند.
 *
 * راه‌حل این ماژول:
 *   - reportClientError(): دِداپ سمت کلاینت با اثرانگوش (message+url) در
 *     sessionStorage — همان خطا در یک سشن حداکثر هر ۱۰ دقیقه یک‌بار POST
 *     می‌شود. dedupeKey اختیاری اجازه می‌دهد چند گزارشگرِ یک حادثه (مرز خطا +
 *     window.onerror) روی یک اثرانگوش مشترک دِداپ شوند.
 *   - maybeReloadForChunkFailure(): گارد reload مشترک (هر ۶۰ ثانیه حداکثر
 *     یک‌بار، sessionStorage) — همهٔ مسیرها (مرز خطا، watchdog، …) از یک گارد
 *     رد می‌شوند تا حلقهٔ reload ممکن نشود.
 *   - isChunkFailure(): تشخیص یکسان پیام‌های ChunkLoadError در همهٔ مسیرها.
 */

/** پنجرهٔ دِداپ گزارش کلاینت — همان خطا در یک سشن حداکثر هر ۱۰ دقیقه یک‌بار */
const REPORT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
/** سقف کل گزارش‌ها در هر سشن — ضد طوفان خطا (بعد از آن فقط console) */
const REPORT_MAX_PER_SESSION = 20;
/** گارد ریکاوری reload — حداکثر یک‌بار در هر ۶۰ ثانیه */
const CHUNK_RELOAD_WINDOW_MS = 60 * 1000;

/** امضاهای شکست بارگذاری chunk (webpack / Next.js / مرورگر) */
const CHUNK_FAIL_RE =
  /chunkloaderror|loading chunk|css chunk|dynamically imported module|importing a module script|failed to fetch dynamically|error loading dynamically/i;

export function isChunkFailure(message: string): boolean {
  return CHUNK_FAIL_RE.test(`${message ?? ""}`);
}

/** هش FNV-1a — برای کلید sessionStorage کافی است (نه رمزنگاری) */
function fingerprint(parts: string[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function sessionCounterBump(): number {
  try {
    const n = Number(sessionStorage.getItem("fitup_err_count") || 0) + 1;
    sessionStorage.setItem("fitup_err_count", String(n));
    return n;
  } catch {
    return 1;
  }
}

export interface ReportClientErrorOptions {
  /**
   * اثرانگوش مشترک دِداپ — وقتی چند گزارشگر یک حادثه را گزارش می‌کنند
   * (مثلاً error.tsx با پیشوند [error-boundary] و window.onerror با پیام خام)،
   * هر دو باید همین پیامِ خام را بدهند تا دومی حذف شود.
   */
  dedupeKey?: string;
  context?: Record<string, unknown>;
}

/**
 * گزارش خطا به /api/error-log با دِداپ سمت کلاینت.
 * true یعنی واقعاً ارسال شد؛ false یعنی دِداپ/سقف شد (فقط console).
 */
export function reportClientError(
  prefix: string,
  error: Error & { digest?: string },
  options: ReportClientErrorOptions = {}
): boolean {
  try {
    const message = error?.message || "Unknown error";
    const fpSource = options.dedupeKey ?? message;
    const key = `fitup_err_fp_${fingerprint([
      fpSource,
      window.location.pathname,
    ])}`;
    const now = Date.now();

    // سقف کل سشن — طوفان خطا هرگز نباید به API برسد
    let count = 0;
    try {
      count = Number(sessionStorage.getItem("fitup_err_count") || 0);
    } catch {}
    if (count >= REPORT_MAX_PER_SESSION) {
      console.error(`[${prefix}] (deduped: session cap)`, error);
      return false;
    }

    // دِداپ اثرانگوشی در پنجرهٔ زمانی
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (last && now - last < REPORT_DEDUPE_WINDOW_MS) {
        console.error(`[${prefix}] (deduped)`, error);
        return false;
      }
      sessionStorage.setItem(key, String(now));
    } catch {
      // sessionStorage غیرفعال (حالت خصوصی قدیمی) — بدون دِداپ ارسال شود
    }

    sessionCounterBump();

    fetch("/api/error-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive: حتی وسط reload شدن هم درخواست قطع نشود
      keepalive: true,
      body: JSON.stringify({
        source: "client",
        message: `[${prefix}] ${message}`,
        stack: error?.stack || "(بدون استک)",
        url: window.location.href,
        userAgent: navigator.userAgent,
        context: JSON.stringify({
          digest: error?.digest ?? null,
          ...(options.context ?? {}),
        }),
      }),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * ریکاوری «chunk قدیمی/گم‌شده» — یک بار reload کامل با گارد ضد حلقه.
 * reset() هرگز chunk گم‌شده را ترمیم نمی‌کند (همان کد خراب دوباره اجرا می‌شود)؛
 * تنها راه درست گرفتن HTML تازه با نام‌های chunk جدید است.
 * گارد: هر ۶۰ ثانیه حداکثر یک‌بار (sessionStorage) — بعد از دیپلویِ واقعی،
 * reload اول HTML تازه می‌گیرد و مشکل تمام می‌شود؛ اگر شبکه/کش خراب‌تر باشد،
 * یک دقیقه بعد یک فرصت دیگر — بدون حلقهٔ بی‌پایان.
 */
export function maybeReloadForChunkFailure(): boolean {
  try {
    const key = "fitup_stale_chunk_reload";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // sessionStorage غیرفعال — بدون گارد reload نکن تا حلقه نشود
    return false;
  }
  window.location.reload();
  return true;
}
