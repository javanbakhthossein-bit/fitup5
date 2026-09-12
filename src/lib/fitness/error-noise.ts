/**
 * ─── فیلتر نویز خطاهای مرورگر داخلی اینستاگرام (Instagram In-App Browser) ───
 *
 * کاربران با کلیک روی لینک‌های اینستاگرام وارد fittup.ir می‌شوند؛ مرورگر داخلی
 * اینستاگرام (IAB) اسکریپت‌های خودش را به صفحه تزریق می‌کند و خطاهای آن اسکریپت‌ها
 * به window.onerror / unhandledrejection اپ ما هم می‌رسند. این خطاها «نویز»اند —
 * به کد اپلیکیشن ما هیچ ربطی ندارند و فقط تب «لاگ خطاها»ی پنل مدیریت را شلوغ می‌کنند:
 *
 *   ۱) «Script error.» با استک «:0:0» — خطای cross-origin که مرورگر عمداً جزئیاتش
 *      را مخفی می‌کند (event.error هم undefined است)؛ اسکریپتِ تزریقیِ خارجی است
 *   ۲) «Error invoking postMessage: Java exception was raised during method
 *      invocation» با استکِ iabjs://navigation_performance_logger_android —
 *      لاگر پرفورمنسِ خودِ اینستاگرام در اندروید
 *
 * این گارد عمداً «سخت‌گیرانه» است: فقط امضاهای شناخته‌شدهٔ بالا فیلتر می‌شوند و
 * هیچ خطای واقعی اپ نباید قربانی شود. اگر امضا تطابق نداشت، خطا عادی لاگ می‌شود.
 */

/** ورودی گزارهٔ نویز — همهٔ فیلدها اختیاری جز message (خام، قبل از هر پیشوندی) */
export interface NoiseErrorInput {
  /** پیام خام خطا (مثلاً event.message یا reason.message — بدون پیشوند) */
  message: string;
  /** استک خطا در صورت وجود */
  stack?: string | null;
  /** فایل مبدأ خطا (ErrorEvent.filename) */
  filename?: string | null;
  /** شمارهٔ خط (ErrorEvent.lineno) */
  lineno?: number;
  /**
   * آیا event.error / reason یک شیء Error واقعی (دارای stack) بود؟
   * نامشخص (مثلاً سمت سرور) → true بدهید تا فقط قواعد پیام/استک اعمال شوند.
   */
  hasErrorObject?: boolean;
}

/** امضای کلاسیک cross-origin — دقیقاً «Script error» با/بدون نقطه و صرفاً به‌تنهایی */
const SCRIPT_ERROR_RE = /^script error\.?$/i;
/** لاگر پرفورمنس اینستاگرام اندروید — پیام کامل: «…: Java exception was raised during method invocation» */
const POSTMESSAGE_MARKER = "Error invoking postMessage";
/** اسکیمهٔ اسکریپت‌های تزریقیِ IAB اینستاگرام (در استک/filename ظاهر می‌شود) */
const IAB_SCHEME_MARKER = "iabjs://";
/** نام لاگر داخلی اینستاگرام */
const NAV_LOGGER_MARKER = "navigation_performance_logger";

/**
 * v37 — امضاهای IAB اینستاگرام iOS + اندروید که «در بستر صفحهٔ ما» اجرا می‌شوند:
 * اینستاگرام اسکریپت‌های خودش را داخل همان window تزریق می‌کند؛ برای همین در
 * استک به‌جای iabjs:// آدرس صفحهٔ ما (fittup.ir/:1) دیده می‌شود و شبیه خطای
 * اپ ما به نظر می‌رسد — ولی هیچ‌کدام از این نمادها در کد فیتاپ وجود ندارند
 * (بررسی‌شده با جست‌وجوی کامل مخزن). همه نویز محض‌اند:
 *   • window.webkit.messageHandlers  → پل iOS اینستاگرام که در IAB موجود نیست
 *   • sendDataToNative / sendPageShowMessage / setupIosCallbackHandler → توابع تزریقی اینستاگرام
 *   • «Java object is gone» / «Java exception was raised» → WebView اندروید بعد از نابودی شیء جاوا
 */
const WEBKIT_BRIDGE_MARKER = "window.webkit.messageHandlers";
const IAB_FN_MARKERS = ["sendDataToNative", "sendPageShowMessage", "setupIosCallbackHandler"];
const JAVA_BRIDGE_MARKERS = ["Java object is gone", "Java exception was raised"];

/**
 * v75 — امضاهای ChunkLoadError (خطای لود chunk بعد از دیپلوی جدید).
 *
 * چون فیلتر شد؟ (درخواست مالک: «این لاگ خطاها در پنل مدیر نباید بیاد دیگه»)
 * وقتی بیلد جدید دیپلوی می‌شود، هش chunkها عوض می‌شود؛ تب‌های بازِ کاربران قدیمی
 * چند ثانیه/دقیقه «Loading chunk failed / missing» گزارش می‌دهند. این‌ها خطای
 * واقعی اپ نیستند — گذرای دیپلوی‌اند، خودِ error-capture.js هم صفحه را reload
 * می‌کند (maybeReloadForChunkFailure) و رفع خودکار می‌شوند. لاگ‌شان فقط پنل
 * خطاهای مدیر را شلوغ می‌کرد. (هم در capture سمت کلاینت و هم در POST
 * /api/error-log سمت سرور اعمال می‌شود.)
 */
const CHUNK_ERROR_MARKERS = [
  "Loading chunk",           // «Loading chunk 8920 failed.»
  "ChunkLoadError",          // نام کلاس خطای webpack
  "Loading CSS chunk",       // نسخهٔ CSS
  "chunk load failed",       // پیام generic مرورگرها
] as const;

/** تطابق خطای chunk-load (پیام/استک) — برای فیلتر نویز دیپلوی */
export function isChunkLoadNoise(message: string, stack?: string | null): boolean {
  const msg = typeof message === "string" ? message : "";
  const stk = typeof stack === "string" ? stack : "";
  // «missing:» + آدرس chunk هم امضای کلاسیک است («(missing: https://...js)»)
  return (
    CHUNK_ERROR_MARKERS.some((m) => msg.toLowerCase().includes(m.toLowerCase()) || stk.toLowerCase().includes(m.toLowerCase())) ||
    /\(missing:\s*https?:\/\/\S+\.js\)/i.test(msg)
  );
}

/**
 * تشخیص نویز خطاهای تزریق‌شدهٔ مرورگر اینستاگرام.
 * true یعنی «ذخیره نکن»؛ false یعنی خطای عادی اپ — همیشه ذخیره شود.
 */
export function isNoiseError({
  message,
  stack,
  filename,
  lineno,
  hasErrorObject,
}: NoiseErrorInput): boolean {
  const msg = typeof message === "string" ? message : "";
  const stk = typeof stack === "string" ? stack : "";
  const file = typeof filename === "string" ? filename : "";

  // ۰) v75 — نویز دیپلوی: خطاهای ChunkLoadError بعد از هر دیپلوی انبوه می‌شوند
  //    (درخواست مالک: «این لاگ در پنل مدیر نباید بیاد دیگه»)
  if (isChunkLoadNoise(msg, stk)) return true;

  // ۱) امضای cross-origin: «Script error.» / «Script error» (بدون هیچ جزئیات دیگر)
  if (SCRIPT_ERROR_RE.test(msg)) return true;

  // ۲) لاگر پرفورمنس اینستاگرام — خطای postMessage جاوا (در پیام یا استک)
  if (msg.includes(POSTMESSAGE_MARKER) || stk.includes(POSTMESSAGE_MARKER)) return true;

  // ۳) اسکیمهٔ اسکریپت‌های تزریقی IAB (در استک یا نام فایل)
  if (stk.includes(IAB_SCHEME_MARKER) || file.includes(IAB_SCHEME_MARKER)) return true;

  // ۴) نام لاگر داخلی اینستاگرام (در استک یا پیام)
  if (stk.includes(NAV_LOGGER_MARKER) || msg.includes(NAV_LOGGER_MARKER)) return true;

  // ۵) پل iOS اینستاگرام (window.webkit.messageHandlers) — در پیام یا استک (v37)
  if (msg.includes(WEBKIT_BRIDGE_MARKER) || stk.includes(WEBKIT_BRIDGE_MARKER)) return true;

  // ۶) توابع تزریقی اینستاگرام در استک — حتی وقتی آدرسشان صفحهٔ ماست (v37)
  for (const m of IAB_FN_MARKERS) {
    if (stk.includes(m)) return true;
  }

  // ۷) خطاهای پل جاوا WebView بعد از نابودی شیء (v37)
  for (const m of JAVA_BRIDGE_MARKERS) {
    if (msg.includes(m) || stk.includes(m)) return true;
  }

  // ۸) امضای cross-origin بدون شیء Error: نه error object، نه محل خطا.
  //    فقط وقتی hasErrorObject صریحاً false باشد — «نامشخص» هرگز نویز حساب نمی‌شود.
  if (hasErrorObject === false && (lineno === undefined || lineno === 0) && !file) {
    return true;
  }

  return false;
}
