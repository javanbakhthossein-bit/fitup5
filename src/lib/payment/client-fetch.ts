/**
 * v148 — fetch تاب‌آور سمت کلاینت برای درخواست‌های حساسِ پرداخت.
 *
 * ریشهٔ باگ «دکمهٔ پرداخت برای همیشه روی در حال ایجاد پرداخت… گیر می‌کند»:
 * بعد از خاموش/روشن کردن فیلترشکن (یا هر سوئیچ شبکه)، مرورگر می‌تواند سوکت
 * keep-alive مُردهٔ قبلیِ pool را دوباره استفاده کند؛ در آن حالت fetch نه
 * resolve می‌شود نه reject — تا ابد آویزان می‌ماند (mode هواپیما چون سوکت‌ها
 * را می‌بندد به‌عنوان «فیکس» جواب می‌داد). راه‌حل: تایم‌اوت سخت + یک تلاش
 * دوباره با اتصالِ کاملاً تازه (fetch جدید = سوکت جدید).
 *
 * قرارداد:
 *  - cache: "no-store" — پاسخ کش‌شده در مسیر پرداخت بی‌معنی است.
 *  - AbortSignal.timeout با سیگنالِ فراخوان ترکیب می‌شود (لغو فراخوان محترم است).
 *  - خطای سطح شبکه (Timeout/Abort/TypeError) → ۸۰۰ms مکث → تلاش دوباره با
 *    fetch تازه (سوکت مُرده دور زده می‌شود).
 *  - پاسخ‌های HTTP (حتی 4xx/5xx) «خطای شبکه» نیستند — عیناً به فراخوان
 *    برمی‌گردند تا منطق فعلی سرور دست‌نخورده بماند.
 *  - اتمام همهٔ تلاش‌ها → NetworkFetchError با پیام فارسی آمادهٔ نمایش.
 *
 * v156 — این لایه دیگر فقط پرداخت نیست: transport مرجع کل اپ است
 * (fetch-json پنل هم از همین می‌رود). امضای ورودی به RequestInfo|URL باز شد
 * تا هر call-siteای بتواند از آن استفاده کند. رفتار پرداخت ذره‌ای تغییر نکرده.
 *
 * مسیرهای استفاده: مودال خرید (/api/payment/checkout)، شارژ کیف پول
 * (/api/wallet)، صفحهٔ تمدید (/api/renew/checkout) و از v156 کل پنل از طریق
 * fetch-json + روت‌های حیاتی (بوت، ورود، پروفایل و…).
 */

export interface FetchWithResilienceOptions {
  /** سقف زمان هر تلاش (پیش‌فرض: ۱۲ ثانیه) */
  timeoutMs?: number;
  /** تعداد تلاش دوباره پس از خطای سطح شبکه (پیش‌فرض: ۱) */
  retries?: number;
}

/** شکست نهایی سطح شبکه — فراخوان می‌تواند با instanceof پیام اختصاصی نشان دهد */
export class NetworkFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkFetchError";
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const RETRY_DELAY_MS = 800;

/** پیام فارسی پیش‌فرض شکست شبکه (اگر فراخوان پیام اختصاصی نداشته باشد) */
const NETWORK_FAIL_MESSAGE = "اتصال شبکه برقرار نشد؛ لطفاً چند لحظه بعد دوباره تلاش کنید.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * سیگنال تایم‌اوت — در WebView/مرورگرهای خیلی قدیمی که AbortSignal.timeout
 * ندارند null برمی‌گردد تا پرداخت به‌جای کرش، بدون تایم‌اوت ادامه یابد
 * (تنزل موتوردار، نه شکست).
 */
function makeTimeoutSignal(timeoutMs: number): AbortSignal | null {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(timeoutMs);
    }
  } catch {
    /* مرورگر قدیمی — بدون تایم‌اوت ادامه بده */
  }
  return null;
}

/** ترکیب سیگنال فراخوان با سیگنال تایم‌اوت (لغو هرکدام کل درخواست را می‌بندد) */
function combineSignals(
  caller: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal
): AbortSignal {
  if (!caller) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([caller, timeoutSignal]);
  // فال‌بک مرورگرهای قدیمی‌تر: بازپخش دستی لغو
  const controller = new AbortController();
  const relay = (src: AbortSignal) => () => {
    if (!controller.signal.aborted) controller.abort(src.reason);
  };
  if (caller.aborted) controller.abort(caller.reason);
  else caller.addEventListener("abort", relay(caller), { once: true });
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason);
  else timeoutSignal.addEventListener("abort", relay(timeoutSignal), { once: true });
  return controller.signal;
}

/**
 * قرارداد حلقهٔ تلاش: هر پرتاب‌شدنی از خودِ fetch یعنی درخواست «هرگز به پاسخ
 * HTTP نرسیده» است — TypeError (شبکه/سوکت مُرده در مرورگر)، TimeoutError/
 * AbortError (تایم‌اوت) یا معادل engineهای دیگر (مثلاً Bun یک Error ساده
 * می‌دهد). همهٔ این‌ها «سطح شبکه» حساب می‌شوند و یک تلاش دوباره با اتصال تازه
 * می‌خورند. استثناهای منطقیِ برنامه اصلاً از fetch بیرون نمی‌آیند و پاسخ‌های
 * HTTP (حتی 4xx/5xx) هم پرتاب نمی‌شوند — عیناً به فراخوان برمی‌گردند.
 */

export async function fetchWithResilience(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts?: FetchWithResilienceOptions
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      // مکث کوتاه پیش از تلاش دوباره — فرصت برای ریست لایهٔ شبکه
      await sleep(RETRY_DELAY_MS);
    }
    const timeoutSignal = makeTimeoutSignal(timeoutMs);
    const signal = timeoutSignal ? combineSignals(init.signal, timeoutSignal) : init.signal;
    try {
      return await fetch(input, { ...init, cache: "no-store", signal });
    } catch (err) {
      lastError = err;
      // فقط لغوِ عمدی فراخوان تلاش دوباره نمی‌خواهد؛ بقیه = شکست سطح شبکه
      if (init.signal?.aborted) throw err;
      // v149 — شکست شبکه را به موتور خودترمیمی سراسری گزارش بده (سوییچ VPN/IP
      // رویداد offline/online نمی‌دهد — تیکت مالک: «پنل کامل بالا نمی‌آمد»).
      // داینامیک‌ایمپورت — هیچ وابستگی سیکلی و هیچ شکستی این مسیر را نمی‌بندد.
      import("@/lib/fitness/network-recovery")
        .then((m) => m.noteNetworkFailure())
        .catch(() => {});
      // شبکهٔ شکست‌خورده (سوکت مُرده/تایم‌اوت) → تلاش دوباره با اتصال تازه
    }
  }

  throw new NetworkFetchError(NETWORK_FAIL_MESSAGE, { cause: lastError });
}
