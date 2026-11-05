/**
 * Zibal Payment Gateway (درگاه پرداخت زیبال) — Production Setup
 *
 * برای فعال‌سازی، یک متغیر محیطی در .env سرور لازم است:
 *   ZIBAL_MERCHANT_ID=6addcadd45ce72c2cfba0ba6
 *
 * سیستم به‌طور خودکار:
 * - به API واقعی زیبال متصل می‌شود (gateway.zibal.ir)
 * - callbackUrl درست می‌سازد (آداپتور /pay/zibal/callback/{paymentId})
 * - پرداخت را سمت سرور verify می‌کند (هرگز به کلاینت اعتماد نمی‌شود)
 *
 * مستندات رسمی: https://help.zibal.ir/ipg/
 *
 * ─── تفاوت‌های مهم زیبال با زرین‌پال (طبق مستندات) ───
 *  ۱) واحد مبلغ در «درخواست» ریال است (تومان × ۱۰) — پاسخ verify/inquiry هم ریال است.
 *  ۲) شناسه پرداخت «trackId» عددی است (مثلاً 15966442233311) — در فیلد
 *     authorityِ رکورد Payment ذخیره می‌شود (همان «کد مرجع درگاه»).
 *  ۳) صفحهٔ شروع پرداخت GET https://gateway.zibal.ir/start/{trackId} است و
 *     مثل زرین‌پال هدر Referer را چک می‌کند → همان سازوکار دو مرحله‌ایِ
 *     صفحهٔ میانی /pay/{authority} (ریدایرکت از دامنهٔ خودمان) استفاده می‌شود
 *     تا Referer: https://fittup.ir/ ارسال شود و درگاه بدون خطا باز شود.
 *  ۴) کال‌بک زیبال GET است با پارامترهای success (1|0)، trackId، status، orderId —
 *     آداپتور /pay/zibal/callback/{paymentId} این‌ها را به قالب استاندارد
 *     فیتاپ (‎/?payment_verify=1&Authority=…&Status=OK|NOK) ترجمه می‌کند تا
 *     کلاینت و مسیر verify بایت‌به‌بایت مثل زرین‌پال کار کند.
 *  ۵) کدهای نتیجه verify: 100=تایید شد، 201=قبلاً تایید شده، 202=پرداخت نشده/ناموفق.
 *  ۶) جدول وضعیت inquiry: 1=پرداخت‌شده-تاییدشده، 2=پرداخت‌شده-تاییدنشده،
 *     3=لغوشده، 15/16/18=استرداد/ریورس، -1=در انتظار پرداخت، بقیه=خطاهای بانکی.
 *  ۷) زیبال API استرداد (reverse) ندارد — استرداد فقط دستی از پیشخان زیبال.
 *
 * ⚠️ خطای 115 («ip شما در پنل کاربری ثبت نشده است») یعنی IP سرور در پنل زیبال
 * ثبت نشده — مالک IP سرور را در پنل زیبال ثبت کرده است.
 */

import type {
  PaymentProvider,
  PaymentRequestParams,
  PaymentRequestResult,
  PaymentVerifyParams,
  PaymentVerifyResult,
} from "../types";
import { registerProvider } from "../registry";

// ─── API Endpoints (طبق مستندات رسمی: gateway.zibal.ir) ───
const ZIBAL_REQUEST_URL = "https://gateway.zibal.ir/v1/request";
const ZIBAL_VERIFY_URL = "https://gateway.zibal.ir/v1/verify";
const ZIBAL_INQUIRY_URL = "https://gateway.zibal.ir/v1/inquiry";

/** صفحهٔ شروع پرداخت زیبال — فقط از صفحهٔ میانی /pay/[authority] استفاده می‌شود */
export function zibalDirectStartPayUrl(trackId: string): string {
  return `https://gateway.zibal.ir/start/${encodeURIComponent(trackId)}`;
}

/**
 * URL صفحهٔ میانی روی دامنهٔ خودمان — هم‌سازوکار زرین‌پال (ورود دو مرحله‌ای):
 *   مرحلهٔ ۱: /pay/{trackId} روی fittup.ir باز می‌شود (Referer درست ست می‌شود)
 *   مرحلهٔ ۲: location.replace به gateway.zibal.ir/start/{trackId}
 * اگر NEXT_PUBLIC_SITE_URL تنظیم نشده باشد (فقط dev خالص) URL مستقیم برمی‌گردد.
 */
export function zibalStartPayUrl(trackId: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return zibalDirectStartPayUrl(trackId);
  return `${site.replace(/\/$/, "")}/pay/${encodeURIComponent(trackId)}`;
}

/**
 * URL کال‌بک زیبال — آداپتور اختصاصی با paymentId در مسیر:
 *   /pay/zibal/callback/{paymentId}
 * آداپتور پارامترهای زیبال (success/trackId/status) را به قالب استاندارد
 * فیتاپ ترجمه می‌کند و به صفحهٔ اصلی (مسیر verify موجود) ریدایرکت می‌کند.
 * ⚠️ عمداً هیچ query-stringی در URL ثبت‌شده نیست تا الحاق پارامترهای زیبال
 * («?success=…&trackId=…») همیشه تمیز و پیش‌بینی‌پذیر باشد.
 */
export function buildZibalCallbackUrl(paymentId: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";
  return `${site.replace(/\/$/, "")}/pay/zibal/callback/${encodeURIComponent(paymentId)}`;
}

// ─── تایپ‌های اختصاصی زیبال ───

export interface ZibalVerifyParams {
  trackId: string;
}

export interface ZibalVerifyResult {
  ok: boolean;
  /** کد نتیجهٔ زیبال: 100=موفق، 201=قبلاً تایید شده، 202=پرداخت نشده */
  result: number | null;
  /** وضعیت تراکنش طبق جدول وضعیت‌های زیبال (1=پرداخت‌شده-تاییدشده) */
  status: number | null;
  refNumber: string | null;
  cardNumber: string | null;
  paidAt: string | null;
  error?: string;
  /** خطای غیرقطعی شبکه/timeout — کالر نباید failed کند (claim آزاد و retry) */
  transportError?: boolean;
}

export interface ZibalInquiryResult {
  ok: boolean;
  result: number | null;
  /** وضعیت تراکنش زیبال: 1=پرداخت‌شده-تاییدشده، 2=پرداخت‌شده-تاییدنشده، … */
  status: number | null;
  refNumber: string | null;
  cardNumber: string | null;
  message?: string;
  error?: string;
  /** v254 — رد IP/خطای transport = غیرقطعی؛ کالر هرگز «not-paid» از آن درنمی‌آورد */
  transportError?: boolean;
}

/** پیام فارسی کدهای نتیجهٔ رایج زیبال — برای لاگ سرور */
export function zibalResultMessage(result: number | null): string {
  switch (result) {
    case 100: return "موفق";
    case 102: return "merchant یافت نشد";
    case 103: return "merchant غیرفعال / عدم امضای قرارداد درگاه";
    case 104: return "merchant نامعتبر";
    case 105: return "IP سرور در پنل کاربری زیبال ثبت نشده است";
    case 106: return "callbackUrl نامعتبر است";
    case 113: return "مبلغ تراکنش از سقف مجاز بیشتر است";
    case 115: return "IP سرور در پنل کاربری زیبال ثبت نشده است";
    case 201: return "قبلاً تایید شده";
    case 202: return "سفارش پرداخت نشده یا ناموفق بوده است";
    case 203: return "trackId نامعتبر است";
    default: return `کد نتیجهٔ زیبال: ${result ?? "?"}`;
  }
}

/**
 * v254 — تشخیص «رد IP» زیبال (result 105/115 یا message "invalid IP").
 * ─── ریشهٔ واقعی باگ «در حال استعلام» ابدی اپ (گزارش مالک v254) ───
 * زیبال verify/inquiry را با گیت IP وایت‌لیست سرو می‌کند؛ سرورهایی که (مثل
 * سرور فیتاپ) چند IP خروجی (NAT pool) دارند، بخشی از درخواست‌ها با
 * «invalid IP» رد می‌شود — اندازه‌گیری واقعی: ~۳۶٪ از فراخوانی‌ها.
 * این خطا «غیرقطعی» است (پرداخت کاربر ممکن است واقعاً انجام شده باشد) و
 * هرگز نباید: ① failed شود ② «not-paid» تلقی شود ③ استعلام را تا ابد
 * معلق بگذارد. رفتار درست = transportError (pending + retry) — هم‌الگوی
 * خطای شبکه؛ به‌علاوه ریتری داخلی کوتاه (اتصال TCP جدید → شانس IP دیگر pool).
 */
export function isZibalIpRejected(
  result: number | null | undefined,
  message?: string | null
): boolean {
  if (result === 105 || result === 115) return true;
  const m = (message || "").toLowerCase();
  return m.includes("invalid ip");
}

/** پیام فارسی وضعیت‌های رایج زیبال (جدول وضعیت‌ها) */
export function zibalStatusMessage(status: number | null): string {
  switch (status) {
    case -1: return "در انتظار پرداخت";
    case -2: return "خطای داخلی زیبال";
    case 1: return "پرداخت شده — تاییدشده";
    case 2: return "پرداخت شده — تاییدنشده";
    case 3: return "لغوشده توسط کاربر";
    case 4: return "شماره کارت نامعتبر است";
    case 5: return "موجودی حساب کافی نیست";
    case 6: return "رمز واردشده اشتباه است";
    case 7: return "تعداد درخواست‌ها بیش از حد مجاز است";
    case 8: return "تعداد پرداخت اینترنتی روزانه بیش از حد مجاز است";
    case 9: return "مبلغ پرداخت اینترنتی روزانه بیش از حد مجاز است";
    case 10: return "صادرکنندهٔ کارت نامعتبر است";
    case 11: return "خطای سوییچ بانکی";
    case 12: return "کارت قابل دسترسی نیست";
    case 15: return "تراکنش استرداد شده";
    case 16: return "تراکنش در حال استرداد";
    case 18: return "تراکنش ریورس شده";
    case 21: return "پذیرنده نامعتبر است";
    default: return `وضعیت زیبال: ${status ?? "?"}`;
  }
}

// ─── Helpers ───

/**
 * مرچنت عمومی تستی زیبال (شبیه‌ساز رسمی حساب آزمایشی «zibal»):
 * با این مرچنت هیچ پول واقعی جابه‌جا نمی‌شود ولی verify «موفق» برمی‌گرداند.
 * ⚠️ دفاع درآمدی: این مرچنت فقط وقتی مجاز است که محیط صراحتاً sandbox باشد
 * (PAYMENT_SANDBOX=true). در production اگر اشتباهاً مرچنت تستی مانده باشد،
 * زیبال «پیکربندی‌نشده» حساب می‌شود → از فهرست درگاه‌ها حذف می‌شود و کاربر
 * به زرین‌پال می‌رود — هیچ فعال‌سازی مجانی رخ نمی‌دهد.
 */
const ZIBAL_PUBLIC_TEST_MERCHANT = "zibal";

/** آیا merchant واقعی پیکربندی شده است؟ (حساب تست zibal فقط در sandbox) */
function hasRealMerchant(): boolean {
  const m = process.env.ZIBAL_MERCHANT_ID;
  if (!m) return false;
  const v = m.trim();
  if (!v || v.toUpperCase() === "TEST") return false;
  if (
    v.toLowerCase() === ZIBAL_PUBLIC_TEST_MERCHANT &&
    process.env.PAYMENT_SANDBOX !== "true"
  ) {
    console.error(
      "[zibal] مرچنت تستی عمومی در محیط غیر-sandbox رد شد — ZIBAL_MERCHANT_ID واقعی را در .env سرور ست کنید"
    );
    return false;
  }
  return true;
}

/** تبدیل تومان به ریال (زیبال مبلغ را ریال می‌گیرد) */
export function tomanToRial(amountTomans: number): number {
  return Math.round(amountTomans * 10);
}

/** POST JSON با تایم‌اوت — خطای شبکه را به‌شکل typed برمی‌گرداند */
async function zibalPostJson<T>(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; transportError: boolean; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      // تایم‌اوت خروجی — درگاه هنگ‌شده نباید checkout/verify را بی‌نهایت معلق کند
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      transportError: true,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/**
 * v254 — همان zibalPostJson + ریتری خودکار روی «رد IP» (105/115).
 * سرور با NAT pool چند-IP: هر اتصال جدید شانس خروج از IP وایت‌لیست‌شده را
 * دارد (اندازه‌گیری واقعی روی سرور: ~۶۴٪ درخواست‌ها IP مجاز دارند). دو ریتری
 * کوتاه (۹۰۰/۱۸۰۰ms) شانس موفقیت همان فراخوان را بالا می‌برد؛ اگر باز هم رد
 * شد → transportError (pending — کرون/ریتری بعدی تعیین‌تکلیف می‌کند).
 */
const ZIBAL_IP_RETRY_DELAYS_MS = [900, 1800] as const;
async function zibalPostJsonWithIpRetry<T>(
  url: string,
  body: Record<string, unknown>,
  /** استخراج result/message از پاسخ برای تشخیص رد IP */
  readResult: (data: T) => { result?: number | null; message?: string | null }
): Promise<
  { ok: true; data: T } | { ok: false; transportError: boolean; error: string }
> {
  let lastData: T | null = null;
  for (let attempt = 0; attempt <= ZIBAL_IP_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, ZIBAL_IP_RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await zibalPostJson<T>(url, body);
    if (!res.ok) return res; // خطای transport واقعی — ریتری همین‌جا بی‌معناست
    lastData = res.data;
    const { result, message } = readResult(res.data);
    if (!isZibalIpRejected(result ?? null, message ?? null)) return res;
    console.warn(
      `[zibal] IP-rejected (attempt ${attempt + 1}/${ZIBAL_IP_RETRY_DELAYS_MS.length + 1}) result=${result} — retry with new connection (NAT pool rotation)`
    );
  }
  return {
    ok: false,
    transportError: true,
    error: `زیبال IP سرور را رد کرد (${zibalResultMessage(
      readResult(lastData as T).result ?? null
    )}) پس از ${ZIBAL_IP_RETRY_DELAYS_MS.length + 1} تلاش — به‌عنوان خطای غیرقطعی ثبت شد`,
  };
}

// ═══ ZibalProvider (پیاده‌سازی PaymentProvider) ═══

class ZibalProvider implements PaymentProvider {
  id = "zibal";
  name = "زیبال";

  isConfigured(): boolean {
    return hasRealMerchant();
  }

  /**
   * درخواست پرداخت زیبال — trackId برمی‌گرداند.
   * ⚠️ amount ورودی تومان است و داخل همین تابع به ریال تبدیل می‌شود.
   */
  async request(params: PaymentRequestParams): Promise<PaymentRequestResult> {
    const merchant = process.env.ZIBAL_MERCHANT_ID;
    if (!hasRealMerchant() || !merchant) {
      return {
        ok: false,
        authority: null,
        gatewayUrl: null,
        simulated: false,
        error: "ZIBAL_MERCHANT_ID not configured",
      };
    }

    const body: Record<string, unknown> = {
      merchant: merchant.trim(),
      amount: tomanToRial(params.amount), // زیبال: مبلغ به ریال
      callbackUrl: params.callbackUrl,
      description: params.description,
      // پیش‌پرکردن موبایل در درگاه — کارت‌های ثبت‌شدهٔ مشتری نمایش داده می‌شود
      ...(params.mobile ? { mobile: params.mobile } : {}),
    };

    // v254 — ریتری روی رد IP (105/115) — request هم ممکن است رد شود
    const res = await zibalPostJsonWithIpRetry<{
      trackId?: number | string;
      result?: number;
      message?: string;
    }>(ZIBAL_REQUEST_URL, body, (d) => ({ result: d.result ?? null, message: d.message ?? null }));

    if (!res.ok) {
      // v254 — رد IP = غیرقطعی (transportError) — کالر pending می‌ماند نه خطای قطعی
      console.error("[zibal] request transport error:", res.error);
      return {
        ok: false,
        authority: null,
        gatewayUrl: null,
        simulated: false,
        error: res.error,
        transportError: res.transportError === true,
      };
    }

    const data = res.data;
    // result 100 = درخواست با موفقیت انجام شد
    if (data?.result === 100 && data.trackId != null) {
      const trackId = String(data.trackId);
      return {
        ok: true,
        authority: trackId,
        gatewayUrl: zibalStartPayUrl(trackId),
        simulated: false,
      };
    }

    console.error(
      "[zibal] request failed — response:",
      JSON.stringify(data),
      "— meaning:",
      zibalResultMessage(data?.result ?? null)
    );
    return {
      ok: false,
      authority: null,
      gatewayUrl: null,
      simulated: false,
      error: zibalResultMessage(data?.result ?? null),
    };
  }

  /**
   * تایید پرداخت زیبال (Verify) — طبق مستندات: POST /v1/verify
   * result: 100 = تایید شد، 201 = قبلاً تایید شده، 202 = پرداخت نشده/ناموفق.
   * ⚠️ تراکنشِ «پرداخت‌شده-تاییدنشده» (status=2) باید ابتدا verify شود؛
   * پاسخ verify با result=202 یعنی پولی در کار نبوده — قطعیِ امن.
   */
  async verify(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
    const merchant = process.env.ZIBAL_MERCHANT_ID;
    if (!hasRealMerchant() || !merchant) {
      return {
        ok: false,
        refId: null,
        error: "ZIBAL_MERCHANT_ID not configured",
      };
    }

    // v254 — ریتری روی رد IP (105/115) — قلب فیکس «در حال استعلام» ابدی
    const res = await zibalPostJsonWithIpRetry<{
      paidAt?: string;
      amount?: number;
      result?: number;
      status?: number;
      refNumber?: number | string;
      cardNumber?: string;
      orderId?: string;
      message?: string;
    }>(ZIBAL_VERIFY_URL, {
      merchant: merchant.trim(),
      trackId: Number(params.authority), // trackId زیبال عددی است
    }, (d) => ({ result: d.result ?? null, message: d.message ?? null }));

    if (!res.ok) {
      // خطای شبکه/timeout — «غیرقطعی»: زرین‌پال‌هم‌ساز: کالر نباید failed کند
      // v253 — لاگ کامل برای ریشه‌یابی «تایید نشده توسط پذیرنده» در زیبال
      console.error(
        `[zibal] verify transport error — trackId=${params.authority} error=${res.error}`
      );
      return {
        ok: false,
        refId: null,
        error: res.error,
        transportError: true,
      };
    }

    const data = res.data;
    // v253 — لاگ کامل پاسخ زیبال روی هر نتیجهٔ غیرموفق (تشخیص 115/202/203 و…)
    if (data?.result !== 100 && data?.result !== 201) {
      console.error(
        `[zibal] verify NOT ok — trackId=${params.authority} response=${JSON.stringify(data)} meaning=${zibalResultMessage(data?.result ?? null)} status=${zibalStatusMessage(typeof data?.status === "number" ? data.status : null)}`
      );
    }

    // دفاع عمق: مبلغِ برگشتی از verify (ریال) باید با مبلغ DB (تومان×۱۰) بخواند.
    // (مرچنت ما ورودی amount در verify ندارد — این چک فقط تطبیق سمت زیبال است.)
    const expectedRials = tomanToRial(params.amount);
    if (
      (data?.result === 100 || data?.result === 201) &&
      typeof data.amount === "number" &&
      data.amount > 0 &&
      Math.abs(data.amount - expectedRials) > 1
    ) {
      console.error(
        `[zibal] verify amount mismatch: gateway=${data.amount} rials, db=${expectedRials} rials (authority=${params.authority}) — تراکنش تایید نمی‌شود`
      );
      return {
        ok: false,
        refId: null,
        error: "مبلغ تراکنش با سفارش مطابقت ندارد",
      };
    }

    if (data?.result === 100) {
      return {
        ok: true,
        refId: data.refNumber != null ? String(data.refNumber) : null,
        alreadyVerified: false,
        cardPan: data.cardNumber ?? null,
        cardHash: null,
        fee: null,
      };
    }

    // 201 = قبلاً تایید شده → مثل کد ۱۰۱ زرین‌پال رفتار می‌شود
    if (data?.result === 201) {
      return {
        ok: true,
        refId: data.refNumber != null ? String(data.refNumber) : null,
        alreadyVerified: true,
        cardPan: data.cardNumber ?? null,
        cardHash: null,
        fee: null,
      };
    }

    return {
      ok: false,
      refId: null,
      error: zibalResultMessage(data?.result ?? null),
    };
  }

  /**
   * استعلام پرداخت زیبال (Inquiry) — طبق مستندات: POST /v1/inquiry
   * فقط وضعیت را اعلام می‌کند؛ تایید با verify انجام می‌شود.
   */
  async inquiry(trackId: string): Promise<ZibalInquiryResult> {
    const merchant = process.env.ZIBAL_MERCHANT_ID;
    if (!hasRealMerchant() || !merchant) {
      return {
        ok: false,
        result: null,
        status: null,
        refNumber: null,
        cardNumber: null,
        error: "ZIBAL_MERCHANT_ID not configured",
      };
    }

    // v254 — ریتری روی رد IP (105/115)
    const res = await zibalPostJsonWithIpRetry<{
      message?: string;
      result?: number;
      refNumber?: number | string;
      status?: number;
      cardNumber?: string;
    }>(ZIBAL_INQUIRY_URL, {
      merchant: merchant.trim(),
      trackId: Number(trackId),
    }, (d) => ({ result: d.result ?? null, message: d.message ?? null }));

    if (!res.ok) {
      // v253/v254 — لاگ خطای transport استعلام زیبال (رد IP هم غیرقطعی است)
      console.error(`[zibal] inquiry transport error — trackId=${trackId} error=${res.error}`);
      return {
        ok: false,
        result: null,
        status: null,
        refNumber: null,
        cardNumber: null,
        error: res.error,
        transportError: res.transportError === true,
      };
    }

    const data = res.data;
    if (data?.result === 100) {
      return {
        ok: true,
        result: 100,
        status: typeof data.status === "number" ? data.status : null,
        refNumber: data.refNumber != null ? String(data.refNumber) : null,
        cardNumber: data.cardNumber ?? null,
        message: data.message,
      };
    }

    // v253 — لاگ کامل پاسخ استعلام غیرموفق
    console.error(
      `[zibal] inquiry NOT ok — trackId=${trackId} response=${JSON.stringify(data)}`
    );
    return {
      ok: false,
      result: data?.result ?? null,
      status: typeof data?.status === "number" ? data.status : null,
      refNumber: null,
      cardNumber: null,
      error: zibalResultMessage(data?.result ?? null),
    };
  }

  /**
   * ساخت URL کال‌بک زیبال (پیاده‌سازی PaymentProvider).
   * extraParams پشتیبانی نمی‌شود — URL عمداً بدون query است (توضیح بالای فایل).
   */
  buildCallbackUrl(_origin: string, _extraParams?: Record<string, string>): string {
    // paymentId در زمان فراخوانی واقعی شناخته می‌شود؛ این پیاده‌سازی فقط
    // برای هم‌شکلی قرارداد PaymentProvider است — مسیر اصلی buildZibalCallbackUrl.
    return buildZibalCallbackUrl("");
  }
}

// ─── Singleton instance ───
const zibalProvider = new ZibalProvider();

// ثبت پروایدر هنگام بارگذاری ماژول (side-effect registration)
registerProvider(zibalProvider);

export { zibalProvider as ZibalProviderInstance };
