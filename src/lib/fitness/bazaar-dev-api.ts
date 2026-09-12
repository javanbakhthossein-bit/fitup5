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

export interface BazaarPurchaseData {
  kind?: string;
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
        signal: AbortSignal.timeout(15_000),
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
  const key = process.env.BAZAAR_RSA_PUBLIC_KEY?.trim();
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
 * راستی‌آزمایی خرید با هر سه مسیر:
 *   ۱) OAuth Developer API (جدید — BAZAAR_CLIENT_ID/SECRET)
 *   ۲) هدر قدیمی CAFEBAZAAR-PISHKHAN-API-SECRET (توکن API پیشخان) — fallback
 *   ۳) v55 — امضای RSA خرید (originalJson + signature از اپ) — پشتیبانِ دو مسیر
 *     API؛ طبق مستندات بازار، امضا با کلید عمومی RSA پنل توسعه‌دهندگان چک می‌شود.
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

  // ─── مسیر ۱: OAuth (توصیه‌شده) ───
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
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json().catch(() => ({}))) as BazaarPurchaseData;
        if (!res.ok) {
          const err = data.error || String(res.status);
          if (err === "not_found" || res.status === 404) continue; // SKU از نوع دیگر
          // 401 → توکن بد/منقضی؛ یک‌بار کش را خالی کن و مسیر legacy را امتحان کن
          if (res.status === 401) invalidateBazaarTokenCache();
          return {
            ok: false,
            error: `راستی‌آزمایی بازار (${label}) ناموفق (${res.status}): ${
              data.error_description || err
            }`,
          };
        }
        const verdict = judge(data);
        if (verdict) return verdict;
        return { ok: true, data, via: "oauth" };
      } catch (e) {
        // شبکه — مسیر بعدی
        console.warn(
          `[bazaar-dev-api] ${label} fetch error:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  // ─── مسیر ۲: توکن پیشخان (fallback — هدر قدیمی روی devapi قدیمی) ───
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
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json().catch(() => ({}))) as BazaarPurchaseData;
        if (!res.ok) {
          const err = data.error || String(res.status);
          if (err === "not_found" || res.status === 404) continue;
          return {
            ok: false,
            error: `راستی‌آزمایی بازار ناموفق (${res.status}): ${
              data.error_description || err
            }`,
          };
        }
        const verdict = judge(data);
        if (verdict) return verdict;
        return { ok: true, data, via: "legacy" };
      } catch {
        // مسیر بعدی
      }
    }
  }

  // ─── مسیر ۳ (v55): امضای RSA خرید — پشتیبانِ دو مسیر API ───
  // اگر API بازار در دسترس نبود (اعتبارنامه تنظیم نبود/خطای شبکه/قطعی)،
  // خریدِ واقعی و امضاشدهٔ بازار که اپ فرستاده نباید بی‌پاسخ بماند —
  // همین عامل پیامک «اعتبارنامه‌های API بازار تنظیم نیست» بعد از خریدِ
  // موفق در بازرسی بازار بود.
  if (sig?.dataJson && sig?.signature) {
    const v = verifyBazaarSignature(sig.dataJson, sig.signature);
    if (v.ok && v.data) {
      const verdict = judge(v.data);
      if (verdict) return verdict;
      console.log("[bazaar-dev-api] verify ok via local RSA signature");
      return { ok: true, data: v.data, via: "signature" };
    }
  }

  return {
    ok: false,
    error: token
      ? "خرید یافت نشد — توکن خرید نامعتبر است."
      : sig?.dataJson && sig?.signature
        ? "راستی‌آزمایی خرید بازار ناموفق بود — امضای خرید معتبر تشخیص داده نشد."
        : "هیچ‌کدام از اعتبارنامه‌های API بازار (OAuth / پیشخان) تنظیم نیستند.",
  };
}
