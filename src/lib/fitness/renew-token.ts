/**
 * توکن امن «لینک تمدید بدون لاگین» — v37
 *
 * مالک می‌خواهد پیامک‌های تمدید (۱۸۴۷۷۷ / ۳۲۲۷۸۰ / ۶۰۴۶۷۸) لینک مجزا داشته
 * باشند که کاربر با یک کلیک مستقیم وارد صفحهٔ تمدید شود و پرداخت را سریع تمام
 * کند — بدون نیاز به لاگین بودن روی آن دستگاه.
 *
 * طراحی:
 *   payload = base64url(JSON { uid, sid, exp })  +  "."  +  HMAC-SHA256(payload)
 *   uid = userId ، sid = subscriptionId (چرخهٔ مشخصی از اشتراک)
 *   exp = ۱۸۰ روز — پیامک باید هفته‌ها بعد هم کار کند، ولی ابدی نباشد.
 *
 * نشت توکن چه خطری دارد؟ فقط دیدن اطلاعات پلن کاربر و «پرداخت برای او» —
 * هیچ دادهٔ حساسی برنمی‌گرداند و هیچ تغییر حالتی نمی‌دهد؛ ریسک قابل قبول.
 * امضا با SESSION_SECRET (همان راز نشست) — env جدید لازم ندارد.
 */

import { createHmac, timingSafeEqual } from "crypto";

const RENEW_TOKEN_TTL_DAYS = 180;

function renewSecret(): string {
  return process.env.SESSION_SECRET || process.env.CRON_SECRET || "fitup-renew-secret-fallback";
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** ساخت لینک نسبی تمدید برای پیامک‌ها — قالب SMS به‌صورت https://fittup.ir/#LINK# است */
export function createRenewToken(userId: string, subscriptionId: string): string {
  const exp = Date.now() + RENEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ uid: userId, sid: subscriptionId, exp }));
  const sig = createHmac("sha256", renewSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * اعتبارسنجی توکن — null یعنی نامعتبر/منقضی/دستکاری‌شده.
 * بهینه: امضای اشتباه با مقایسهٔ timing-safe رد می‌شود؛ نتیجه ۶۰ ثانیه کش می‌شود
 * تا sweep های پی‌درپی و refresh های صفحه هزینهٔ HMAC را تکرار نکنند.
 */
const verifyCache = new Map<string, { ok: boolean; uid: string; sid: string } | null>();
const VERIFY_CACHE_TTL_MS = 60 * 1000;
const VERIFY_CACHE_MAX = 2000;

export function verifyRenewToken(token: string | null | undefined): { uid: string; sid: string } | null {
  if (!token || typeof token !== "string") return null;
  const cachedEntry = verifyCache.get(token);
  if (cachedEntry !== undefined) {
    return cachedEntry && cachedEntry.ok ? { uid: cachedEntry.uid, sid: cachedEntry.sid } : null;
  }

  let result: { ok: boolean; uid: string; sid: string } | null = null;
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx > 0) {
      const payload = token.slice(0, dotIdx);
      const sig = token.slice(dotIdx + 1);
      const expected = createHmac("sha256", renewSecret()).update(payload).digest("base64url");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
          uid?: string;
          sid?: string;
          exp?: number;
        };
        if (
          parsed.uid &&
          parsed.sid &&
          typeof parsed.exp === "number" &&
          parsed.exp > Date.now()
        ) {
          result = { ok: true, uid: parsed.uid, sid: parsed.sid };
        }
      }
    }
  } catch {
    result = null;
  }

  // کش محدود — از رشد بی‌رویهٔ Map با توکن‌های آلوده جلوگیری می‌کند
  if (verifyCache.size > VERIFY_CACHE_MAX) verifyCache.clear();
  verifyCache.set(token, result);
  return result && result.ok ? { uid: result.uid, sid: result.sid } : null;
}
