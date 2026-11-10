"use client";

/**
 * ─── v156 — سپر شبکهٔ سراسری فیتاپ (ریشه‌درمانی نهایی «خاموش کردن VPN → قطع کامل اپ») ───
 *
 * ریشهٔ واقعی باگ که ۱۰ بار قبلاً درست نشده بود (تیکت مالک: «بعد از خاموش شدن
 * وی‌پی‌ان کلاً دیگر هیچ چیزی برنامه کار نمی‌کند و باید برنامه را ببندیم و
 * دوباره باز کنیم از اول»):
 *
 *  بعد از سوییچ VPN/IP، مرورگر سوکت‌های keep-alive «مردهٔ» قبلی را دوباره
 *  استفاده می‌کند؛ fetch بدون تایم‌اوت در آن حالت نه resolve می‌شود نه reject —
 *  برای همیشه آویزان می‌ماند. پالرهای اپ (پالس ۳ ثانیه‌ای، اعلان‌ها ۳۰ ثانیه،
 *  کووتا، پلن‌ها و…) مدام درخواست زامبیِ جدید روی همان سوکت‌های مرده می‌سازند
 *  تا «استخر اتصال» مرورگر (فقط ~۶ کانکت همزمان به هر origin) کاملاً پر شود.
 *  از آن لحظه حتی fetch تازهٔ دکمهٔ پرداخت هم در صف می‌ماند → کاربر حس می‌کند
 *  «کل اینترنت قطع شده». بستن و بازکردن اپ استخر را خالی می‌کرد — برای همین
 *  «بستن و باز کردن از اول» مشکل را درست می‌کرد.
 *
 * راه‌حل (یک بار در بوت، window.fetch پوشانده می‌شود):
 *  ۱) هر درخواستِ «بدون AbortSignal» یک تایم‌اوت سخت می‌گیرد:
 *     • پیش‌فرض ۴۵ ثانیه (بدون پاسخ → abort → همهٔ finallyها اجرا می‌شوند و
 *       stateهای «در حال بارگذاری» بالاخره آزاد می‌شوند — هیچ UIای برای همیشه گیر نمی‌کند)
 *     • آپلود (Blob/File/FormData/ArrayBuffer) ۱۸۰ ثانیه
 *     • مسیرهای AI طولانی (تولید برنامه/چت/تحلیل‌ها — سرور تا ۳۶۰ ثانیه) ۴۲۰ ثانیه
 *  ۲) هر درخواستی که «خودش signal دارد» (fetchWithResilience پرداخت، تحلیل
 *     آنبوردینگ و…) کاملاً دست‌نخورده می‌ماند — خط قرمز پرداخت مثل قبل.
 *  ۳) شکست سطح شبکه (TypeError/تایم‌اوت) → گزارش به موتور خودترمیمی
 *     (network-recovery.noteNetworkFailure) — همان تریگر بازیابی خودکار.
 *  ۴) رجیستری درخواست‌های در جریان → روی قطعی واقعی شبکه، زامبی‌ها فوراً
 *     abort می‌شوند تا استخر اتصال در چند میلی‌ثانیه آزاد شود و اولین کلیک
 *     کاربر (مثلاً «پرداخت») با سوکت کاملاً تازه انجام شود.
 *
 * هیچ رفتار دیگری تغییر نمی‌کند: retry اضافه نمی‌شود (خطر ارسال دوبارهٔ POST)،
 * پاسخ‌ها عیناً به فراخوان برمی‌گردند و کد هیچ call-siteای تغییر نیاز ندارد.
 */

// درخواست‌های در جریانِ بدون signal فراخوان (تنها این‌ها را خودمان مدیریت می‌کنیم)
const inflight = new Map<AbortController, { startedAt: number; long: boolean }>();

/** مسیرهای AI که سرور تا چند دقیقه (سقف ۳۶۰ ثانیه) درگیر است — تایم‌اوت بلند */
const LONG_TIMEOUT_ROUTES = [
  "/api/coach/plan", // تولید/بازطراحی برنامه تمرین و تغذیه (AI)
  "/api/onboarding", // ثبت آنبوردینگ/تحلیل اولیه (AI)
  "/api/coach/chat", // چت با فیتاپ — پاسخ AI/بازطراحی برنامه
  "/api/nika/", // چت نیکا (AI)
  "/api/coach/voice", // تبدیل ویس به متن (ASR)
  "/api/coach/analyze-", // تحلیل خون/ویدیو/پیشرفت بدنی (AI)
  "/api/coach/meal-photo-analysis", // تحلیل عکس غذا (AI)
  "/api/coach/analyze-meal", // تحلیل غذا (AI)
  "/api/coach/comprehensive-", // تحلیل جامع (AI)
  "/api/coach/submit-body-analysis", // تحلیل بدن (AI)
  "/api/nutrition/analyze", // تحلیل عکس غذا (AI)
  "/api/admin/programs", // بازنویسی/به‌روزرسانی برنامه از پنل ادمین (AI)
  "/api/admin/plan-regen", // تولید مجدد برنامه از پنل ادمین (AI)
];

const DEFAULT_TIMEOUT_MS = 45_000;
const UPLOAD_TIMEOUT_MS = 180_000;
const LONG_TIMEOUT_MS = 420_000;

/** تایم‌اوت پیش‌فرض فعال — برای تست‌پذیری قابل تزریق است (پیش‌فرض: ۴۵ ثانیه) */
let activeDefaultTimeoutMs = DEFAULT_TIMEOUT_MS;

function isLongRoute(url: string): boolean {
  try {
    const path = new URL(url, window.location.origin).pathname;
    return LONG_TIMEOUT_ROUTES.some((r) => path.startsWith(r));
  } catch {
    return false;
  }
}

/**
 * نسخهٔ عمومی برای call-siteهای بیرونی (fetch-json): اگر URL جزو مسیرهای AI
 * طولانی است true — تا تایم‌اوتfetch-json هم برای آن‌ها بلند شود (پاسخ AI
 * گاهی چند دقیقه طول می‌کشد و ۱۲ ثانیه‌ای نباید قطع شود).
 */
export function isLongTimeoutUrl(url: string): boolean {
  if (typeof window === "undefined") return false;
  return isLongRoute(url);
}

/** آپلود حجیم (فایل/فرم) — شبکهٔ موبایل ایران کند است؛ سقف بلندتر */
function isUploadBody(init: RequestInit | undefined): boolean {
  const body = init?.body;
  if (!body) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body as unknown as object))) return true;
  return false;
}

function resolveUrlString(input: RequestInfo | URL): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  } catch {
    return "";
  }
}

function noteShieldFailure(): void {
  // داینامیک‌ایمپورت — هیچ وابستگی سیکلی؛ شکستِ گزارش، جریان اصلی را نمی‌بندد
  import("@/lib/fitness/network-recovery")
    .then((m) => m.noteNetworkFailure())
    .catch(() => {});
}

async function shieldedFetch(
  native: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<Response> {
  // فراخوانی که خودش signal داده (پرداخت تاب‌آور، تحلیل آنبوردینگ، آپلود کنسل‌شونده
  // و…) کاملاً مدیریت خودش است — ما هیچ دخالتی نمی‌کنیم (قرارداد خط قرمز).
  if (init?.signal) return native(input, init);

  const url = resolveUrlString(input);
  const long = isLongRoute(url);
  const upload = isUploadBody(init);
  const timeoutMs = upload ? UPLOAD_TIMEOUT_MS : long ? LONG_TIMEOUT_MS : activeDefaultTimeoutMs;

  const controller = new AbortController();
  const entry = { startedAt: Date.now(), long };
  inflight.set(controller, entry);
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, timeoutMs);

  try {
    const res = await native(input, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    // AbortErrorِ خودِ ما (تایم‌اوت) یا TypeError شبکه — هر دو یعنی لایهٔ شبکه
    // سالم رفتار نمی‌کند → به موتور خودترمیمی گزارش بده (با debounce داخلی خودش).
    // لغوِ عمدیِ خودمان از abortAllInFlight هم گزارش می‌شود (بی‌ضرر — debounce دارد).
    noteShieldFailure();
    throw err;
  } finally {
    clearTimeout(timer);
    inflight.delete(controller);
  }
}

/**
 * بستن فوری همهٔ درخواست‌های آویزان (زامبی‌های سوکت مرده) تا استخر اتصال آزاد شود.
 * به‌صورت پیش‌فرض درخواست‌های AI طولانی (long) حفظ می‌شوند — فقط روی قطعِ
 * «قطعی» شبکه (رویداد offline) آن‌ها هم کشته می‌شوند (anyway مرده‌اند).
 */
export function abortAllInFlight(reason = "offline", includeLong = false): number {
  let killed = 0;
  for (const [controller, entry] of Array.from(inflight.entries())) {
    if (entry.long && !includeLong) continue;
    try {
      controller.abort();
      inflight.delete(controller);
      killed++;
    } catch {}
  }
  if (killed > 0 && typeof console !== "undefined") {
    console.info(`[net-shield] ${killed} درخواست زامبی آزاد شد (${reason})`);
  }
  return killed;
}

/**
 * سیگنال تایم‌اوت اختیاری برای call-siteهای خاص (پالس، verify-OTP و…) که
 * می‌خواهند تندتر از سقف سراسری خطا بدهند. روی WebViewهای خیلی قدیمی null
 * برمی‌گرداند (تنزل موتوردار — سپر سراسری ۴۵ ثانیه‌ای همچنان پوشش می‌دهد).
 */
export function shieldTimeoutSignal(ms: number): AbortSignal | null {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
  } catch {
    /* مرورگر قدیمی */
  }
  return null;
}

/** فقط برای تست/دیاگ — تعداد درخواست‌های در جریان تحت پوشش سپر */
export function inflightCount(): number {
  return inflight.size;
}

/**
 * نصب یک‌بارهٔ سپر — در ریشهٔ اپ (layout) صدا زده می‌شود؛ فراخوانی تکراری بی‌اثر.
 * opts.defaultTimeoutMs فقط برای تست‌ها (تایم‌اوت کوتاه‌تر برای سرعت تست).
 */
export function installNetShield(opts?: { defaultTimeoutMs?: number }): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __fitupNetShield?: boolean };
  if (opts?.defaultTimeoutMs && opts.defaultTimeoutMs > 0) {
    activeDefaultTimeoutMs = opts.defaultTimeoutMs;
  }
  if (w.__fitupNetShield) return;
  w.__fitupNetShield = true;

  const native = window.fetch.bind(window);
  window.fetch = function shielded(input: RequestInfo | URL, init?: RequestInit) {
    return shieldedFetch(native, input, init);
  } as typeof window.fetch;

  // روی قطع واقعی شبکه (ایرلاین/ایرفلاین‌مود) همهٔ زامبی‌ها — حتی AI طولانی —
  // فوراً آزاد می‌شوند؛ سوییچ VPN معمولاً offline نمی‌دهد و مسیرش از
  // noteNetworkFailure (اولین شکست fetch) مدیریت می‌شود.
  window.addEventListener("offline", () => {
    abortAllInFlight("offline", true);
  });
}
