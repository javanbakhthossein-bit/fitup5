/**
 * کافه‌بازار — API توسعه‌دهندگان (v48)
 *
 * راستی‌آزمایی سمت‌سرور خریدهای درون‌برنامه‌ای بازار با اعتبارنامهٔ OAuth
 * «کلاینت توسعه‌دهندگان» (Client Id / Client Secret از پیشخان → بخش API
 * توسعه‌دهندگان). این مسیر جایگزین/مکّم توکن قدیمی «API پیشخان» است:
 *
 *   ۱) گرفتن access token:
 *      POST {BAZAAR_OAUTH_TOKEN_URL}
 *      Content-Type: application/x-www-form-urlencoded
 *      grant_type=client_credentials & client_id=… & client_secret=…
 *      → { access_token, token_type, expires_in, … }
 *
 *   ۲) راستی‌آزمایی خرید با هدر Authorization: Bearer …:
 *      - کالا:        GET {BAZAAR_DEV_API_V2}/applications/{pkg}/purchases/{productId}/tokens/{token}
 *      - اشتراک:      GET {BAZAAR_DEV_API_V2}/applications/{pkg}/subscriptions/{sku}/purchases/{token}
 *
 * نکتهٔ env (پاسخ به سؤال مالک — «کدام‌کجا بگذارم»):
 *   BAZAAR_CLIENT_ID + BAZAAR_CLIENT_SECRET → همین‌جا مصرف می‌شوند (سرور).
 *   BAZAAR_API_SECRET (توکن API پیشخان — JWT با api_agent_id) → توکن مدیریت
 *     رهانش‌ها؛ به‌عنوان مسیر fallback راستی‌آزمایی هم پذیرفته می‌شود.
 *   Client URI (https://fittup.ir/?screen=panel) → فقط در پیشخان ثبت شده؛
 *     در فلوی client_credentials نقشی در کد ندارد (فقط مستندات).
 *
 * توکن در حافظه کش می‌شود (تا ۶۰ ثانیه قبل از انقضا) تا هر راستی‌آزمایی
 * یک درخواست توکن اضافه نزند.
 */

const OAUTH_TOKEN_URL =
  process.env.BAZAAR_OAUTH_TOKEN_URL?.trim() ||
  "https://accounts.pardakht-bazaar.ir/api/oauth/token";
const DEV_API_V2 =
  process.env.BAZAAR_DEV_API_URL?.trim() ||
  "https://api.pardakht-bazaar.ir/devapi/v2/api";

// v55 — رمزنگاری برای راستی‌آزمایی امضای RSA خرید (مسیر پشتیبان API)
import { createPublicKey, createVerify } from "crypto";

/**
 * v56 — فیکس ریشه‌ای رد شدن بازرسی بازار (versionCode 13):
 * «پس از خرید درون‌برنامه‌ای موفق، پیغام راستی‌آزمایی بازار ناموفق».
 * کلید عمومی RSA پرداخت درون‌برنامه‌ای از پیشخان — همین کلید در BuildConfig اپ
 * اندروید (fitup-bazaar/app/build.gradle.kts) جاسازی شده و پولکی با همین، خریدِ
 * بازرسی را محلی تأیید کرده بود. کلید «عمومی» است — جاسازی در سرور امن است.
 * ترتیب انتخاب: env BAZAAR_RSA_PUBLIC_KEY → همین ثابت داخلی.
 * با این پشتیبان، مسیر امضای RSA هرگز به‌خاطر env خالی از کار نمی‌افتد.
 */
const EMBEDDED_BAZAAR_RSA_PUBLIC_KEY =
  "MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwDI6I3QKZLtAOura5/Ij4MTPlNJ7v9J0znWW1bMcRG54abj/V/FM7pj9F058QhNGcx6qu0moEegqZRvO8er08CWCdgklkdGbzaYLziKrKHql5Os4MAtAjM26juZ+o6F8WvnnoI3g6wG7HBagV73YaNS3eDTatWBoAkMzjchVKSZj/6rRGaRv5d+cfNyyzCCmASD/sk9dQkxH1g+dVFVzUqTdtey+uOxqbONGBJiHdUCAwEAAQ==";

function getBazaarRsaPublicKey(): string {
  return process.env.BAZAAR_RSA_PUBLIC_KEY?.trim() || EMBEDDED_BAZAAR_RSA_PUBLIC_KEY;
}

export interface BazaarPurchaseData {
  kind?: string;
  // v104 — فیلدهای اتصال (در originalJson امضاشدهٔ بازار موجودند): برای اطمینان
  // از اینکه امضای معتبرِ «همین» خرید است — نه امضای معتبرِ خریدی دیگر.
  productId?: string;
  purchaseToken?: string;
  // کالا (inapp): 0 = خرید موفق | 1 = لغوشده | 2 = بازگشت‌داده‌شده
  purchaseState?: number;
  // اشتراک: 0 = پرداخت موفق | 1 = بازگشت وجه
  paymentState?: number;
  consumptionState?: number;
  purchaseTimeMillis?: number | string;
  developerPayload?: string;
  orderId?: string;
  error?: string;
  error_description?: string;
}

// ─── کش توکن OAuth (فرآیندی — Next سرور تک‌پروسه‌ای است) ───
let _cachedToken: { value: string; expiresAt: number } | null = null;
let _inflight: Promise<string | null> | null = null;

/** Client Id از env یا SiteSetting (bazaar_client_id) */
async function getClientId(): Promise<string | null> {
  const env = process.env.BAZAAR_CLIENT_ID?.trim();
  if (env) return env;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.siteSetting.findUnique({ where: { key: "bazaar_client_id" } });
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

/** Client Secret از env یا SiteSetting (bazaar_client_secret) */
async function getClientSecret(): Promise<string | null> {
  const env = process.env.BAZAAR_CLIENT_SECRET?.trim();
  if (env) return env;
  try {
    const { db } = await import("@/lib/db");
    const row = await db.siteSetting.findUnique({ where: { key: "bazaar_client_secret" } });
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * گرفتن access token با فلوی client_credentials (با کش + ضد رگبار).
 * null = اعتبارنامه تنظیم نیست یا درخواست توکن شکست خورد.
 */
export async function getBazaarAccessToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) {
    return _cachedToken.value;
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const clientId = await getClientId();
      const clientSecret = await getClientSecret();
      if (!clientId || !clientSecret) return null;

      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => null)) as
        | { access_token?: string; expires_in?: number; error?: string }
        | null;
      if (!res.ok || !data?.access_token) {
        console.error(
          `[bazaar-dev-api] token request failed — HTTP ${res.status} ${data?.error ?? ""}`
        );
        return null;
      }
      const ttlSec = Number(data.expires_in) || 3600;
      // ۶۰ ثانیه زودتر منقضا کن تا توکن لبه‌ای نمرود
      _cachedToken = {
        value: data.access_token,
        expiresAt: Date.now() + Math.max(60, ttlSec - 60) * 1000,
      };
      return _cachedToken.value;
    } catch (e) {
      console.error(
        "[bazaar-dev-api] token error:",
        e instanceof Error ? e.message : e
      );
      return null;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** پاک‌کردن کش توکن (برای تست/تعویض اعتبارنامه) */
export function invalidateBazaarTokenCache(): void {
  _cachedToken = null;
}

/**
 * v55 — راستی‌آزمایی محلی امضای خرید با کلید RSA عمومی بازار (پیشخان → پرداخت
 * درون‌برنامه‌ای → کلید RSA). طبق مستندات رسمی بازار، کلید باید «در متن برنامه»
 * هم باشد (BAZAAR_RSA_PUBLIC_KEY در app/build.gradle.kts — فیلد BuildConfig) و
 * سمت سرور با همان کلید، امضای SHA1withRSA روی originalJson چک می‌شود.
 *
 * این مسیر پشتیبانِ API است: اگر هر دو API بازار (OAuth/پیشخان) به هر دلیل
 * در دسترس نبودند، خریدِ واقعیِ امضاشده‌ی بازار نباید به‌خاطر خطای شبکه فعال
 * نشود — همان عامل «خرید موفق ولی پیغام خطای اعتبارنامه» در بازرسی بازار.
 */
export function verifyBazaarSignature(
  dataJson: string,
  signatureBase64: string
): { ok: boolean; data?: BazaarPurchaseData } {
  const key = getBazaarRsaPublicKey(); // v56 — با پشتیبان داخلی، هرگز خالی نیست
  if (!key || !dataJson || !signatureBase64) return { ok: false };
  try {
    const der = Buffer.from(key, "base64");
    const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    const verifier = createVerify("RSA-SHA1");
    verifier.update(dataJson);
    const ok = verifier.verify(publicKey, signatureBase64, "base64");
    if (!ok) return { ok: false };
    // purchaseState/paymentState از همان JSON امضاشده خوانده و داوری می‌شود
    const data = JSON.parse(dataJson) as BazaarPurchaseData;
    return { ok: true, data };
  } catch (e) {
    console.warn(
      "[bazaar-dev-api] signature verify error:",
      e instanceof Error ? e.message : e
    );
    return { ok: false };
  }
}

export type BazaarVerifyResult =
  | { ok: true; data: BazaarPurchaseData; via: "oauth" | "legacy" | "signature" }
  | { ok: false; error: string };

/** دادهٔ امضای خرید (از اپ اندروید با پل JS می‌آید) */
export interface BazaarSignatureData {
  dataJson?: string;
  signature?: string;
}

/**
 * راستی‌آزمایی خرید بازار — v104 بازترتیب (رفع تأخیر تأییدیهٔ خرید/شارژ):
 *
 * ✅ ترتیب مسیرها (گزارش مالک: «سایت تأییدیه لازم را خیلی با تأخیر گرفت»):
 *   ۱) امضای RSA خرید (originalJson + signature از اپ — آفلاین و آنی، ~۰ms)
 *   ۲) OAuth Developer API (BAZAAR_CLIENT_ID/SECRET — برای اپ‌های قدیمی بدون امضا)
 *   ۳) هدر قدیمی CAFEBAZAAR-PISHKHAN-API-SECRET (توکن API پیشخان)
 *
 * چرا امضا اول شد؟ امضای RSA اثبات رمزنگاری‌شدهٔ رسمی بازار است (همان معیار
 * SecurityCheck.Enable رسمی پولکی — کلید عمومی پیشخان در سرور). مسیرهای API
 * در شبکهٔ ایران گاهی ده‌ها ثانیه طول می‌کشند و کاربر بعد از پرداخت موفق
 * منتظر فعال‌سازی می‌ماند. امنیت تغییری نکرده: idempotency با purchaseToken
 * برقرار است (پخش مجدد همان توکن دوبار اعتبار نمی‌گیرد) و هر سه مسیر همچنان
 * فعال‌اند — فقط وقتی امضا غایب/نامعتبر بود به سراغ API می‌رویم.
 * خطای غیر-404 در هر مسیر API هرگز توقف نیست (درس v56) — مسیر بعدی امتحان می‌شود.
 * برای هر مسیر API، ابتدا endpoint «کالا» و سپس «اشتراک» امتحان می‌شود.
 */
export async function verifyBazaarPurchaseAny(
  pkg: string,
  productId: string,
  purchaseToken: string,
  legacySecret?: string | null,
  sig?: BazaarSignatureData
): Promise<BazaarVerifyResult> {
  const productUrl = (base: string) =>
    `${base}/applications/${encodeURIComponent(pkg)}/purchases/${encodeURIComponent(
      productId
    )}/tokens/${encodeURIComponent(purchaseToken)}`;
  const subUrl = (base: string) =>
    `${base}/applications/${encodeURIComponent(pkg)}/subscriptions/${encodeURIComponent(
      productId
    )}/purchases/${encodeURIComponent(purchaseToken)}`;

  const judge = (data: BazaarPurchaseData): BazaarVerifyResult | null => {
    // کالا: purchaseState 1=لغو 2=بازگشت | اشتراک: paymentState 1=بازگشت وجه
    const refunded =
      data.paymentState === 1 || data.purchaseState === 1 || data.purchaseState === 2;
    if (refunded) {
      return { ok: false, error: "این خرید بازگشت‌داده‌شده (refund) یا لغو شده است." };
    }
    return null; // معتبر — ادامه
  };

  // ثبت کوتاه هر مسیر شکست‌خورده — در خطای نهایی لاگ می‌شود (قابل رهگیری در سرور)
  const failedPaths: string[] = [];

  // ─── مسیر ۱ (v104 — اول از همه): امضای RSA خرید — اثبات رمزنگاری‌شده با کلید عمومی بازار ───
  // کلید عمومی همیشه در دسترس است (env یا ثابت داخلی — همان کلید BuildConfig اپ که
  // پولکی با همان SecurityCheck.Enable خرید بازرسی را محلیاً تأیید کرد).
  // این مسیر ~۰ ثانیه طول می‌کشد (بدون شبکه) — رفع ریشه‌ای تأخیر تأییدیهٔ خرید/شارژ
  // (گزارش مالک: «سایت تأییدیه لازم را خیلی با تأخیر گرفت» — قبلاً هر سه مسیر API
  // با timeoutهای ۱۵–۳۰ ثانیه‌ای اول امتحان می‌شدند و امضا آخرِ کار بود).
  if (sig?.dataJson && sig?.signature) {
    const v = verifyBazaarSignature(sig.dataJson, sig.signature);
    if (v.ok && v.data) {
      // v104 — اتصال امضا به محصول/توکن درخواستی: امضای معتبرِ «خریدی دیگر»
      // هرگز نباید به‌جای این productId/توکن پذیرفته شود (سناریوی سوءاستفاده:
      // خرید SKU ارزان + ارسال با productId گران → شارژ/پلن بیشتر). فیلدهای
      // productId/purchaseToken داخل originalJson «امضاشده» هستند، پس جعلشان
      // بدون کلید خصوصی بازار ناممکن است؛ اگر در JSON هستند باید دقیقاً
      // با ورودی مسیر یکی باشند. (مسیرهای API به این چک نیاز ندارند —
      // productId/توکن همان‌جا در URL کوئری می‌روند و عدم‌تطابق = 404.)
      const identityMismatch =
        (v.data.productId && v.data.productId !== productId) ||
        (v.data.purchaseToken && v.data.purchaseToken !== purchaseToken);
      if (identityMismatch) {
        failedPaths.push("signature: productId/purchaseToken با امضای خرید همخوان نیست");
      } else {
        const verdict = judge(v.data);
        if (verdict) return verdict;
        console.log(
          `[bazaar-dev-api] verify ok via local RSA signature (instant — API check skipped)`
        );
        return { ok: true, data: v.data, via: "signature" };
      }
    } else {
      failedPaths.push("signature: امضا با کلید RSA تأیید نشد");
    }
  } else {
    failedPaths.push("signature: اپ dataJson/signature نفرستاد (اپ قدیمی؟)");
  }

  // ─── مسیر ۲: OAuth Developer API (توصیه‌شده) — فقط برای اپ‌های قدیمی بدون امضا ───
  // خطا = ادامه به مسیر بعدی، نه توقف (تغییر نرفته از v56).
  const token = await getBazaarAccessToken();
  if (token) {
    for (const [label, url] of [
      ["product", productUrl(DEV_API_V2)],
      ["subscription", subUrl(DEV_API_V2)],
    ] as const) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          cache: "no-store",
          // v104 — ۱۲s (قبلاً ۳۰s): این مسیر فقط پشتیبانِ امضاست و نباید کاربر را نگه دارد
          signal: AbortSignal.timeout(12_000),
        });
        const data = (await res.json().catch(() => ({}))) as BazaarPurchaseData;
        if (!res.ok) {
          const err = data.error || String(res.status);
          if (err === "not_found" || res.status === 404) continue; // SKU از نوع دیگر — endpoint بعدی
          // v56 — خطا فقط ثبت می‌شود؛ مسیر legacy و امضا همچنان امتحان می‌شوند
          failedPaths.push(`oauth/${label}: HTTP ${res.status} ${data.error_description || err}`);
          if (res.status === 401) invalidateBazaarTokenCache();
          continue;
        }
        const verdict = judge(data);
        if (verdict) return verdict;
        return { ok: true, data, via: "oauth" };
      } catch (e) {
        // شبکه — ثبت و مسیر بعدی
        failedPaths.push(
          `oauth/${label}: ${e instanceof Error ? e.message.slice(0, 120) : "network"}`
        );
      }
    }
  } else {
    failedPaths.push("oauth: اعتبارنامه تنظیم نیست");
  }

  // ─── مسیر ۳: توکن پیشخان (fallback — هدر قدیمی روی devapi قدیمی) — به همین ترتیب ───
  if (legacySecret) {
    const legacyBase = "https://pardakht.cafebazaar.ir/devapi/v2/api";
    for (const url of [productUrl(legacyBase), subUrl(legacyBase)]) {
      try {
        const res = await fetch(url, {
          headers: {
            "CAFEBAZAAR-PISHKHAN-API-SECRET": legacySecret,
            Accept: "application/json",
          },
          cache: "no-store",
          // v104 — ۱۲s (قبلاً ۳۰s) — هم‌دلیل مسیر OAuth
          signal: AbortSignal.timeout(12_000),
        });
        const data = (await res.json().catch(() => ({}))) as BazaarPurchaseData;
        if (!res.ok) {
          const err = data.error || String(res.status);
          if (err === "not_found" || res.status === 404) continue;
          failedPaths.push(
            `pishkhan: HTTP ${res.status} ${data.error_description || err}`
          );
          continue; // v56 — ادامه به مسیر بعدی
        }
        const verdict = judge(data);
        if (verdict) return verdict;
        return { ok: true, data, via: "legacy" };
      } catch (e) {
        failedPaths.push(
          `pishkhan: ${e instanceof Error ? e.message.slice(0, 120) : "network"}`
        );
      }
    }
  } else {
    failedPaths.push("pishkhan: توکن تنظیم نیست");
  }

  // ─── همهٔ مسیرها شکست خوردند — خطای قابل رهگیری با خلاصهٔ مسیرها ───
  console.error(
    `[bazaar-dev-api] ALL verify paths failed — product=${productId} token=${purchaseToken.slice(0, 12)}… paths: ${failedPaths.join(" | ")}`
  );
  return {
    ok: false,
    error: sig?.dataJson && sig?.signature
      ? `راستی‌آزمایی خرید بازار ناموفق بود — امضای خرید معتبر تشخیص داده نشد. (${failedPaths.join(" | ")})`
      : `راستی‌آزمایی خرید بازار ناموفق بود — هیچ مسیر اعتبارسنجی در دسترس نبود. (${failedPaths.join(" | ")})`,
  };
}
