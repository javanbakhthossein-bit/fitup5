/**
 * Rate limiter ساده درون‌حافظه‌ای (sliding window) برای محافظت از endpointهای حساس.
 * برای تک‌نود (SQLite dev/prod) کافی است — بدون وابستگی خارجی.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 20000;

export interface RateLimitResult {
  ok: boolean;
  /** تعداد درخواست‌های مجاز باقی‌مانده در پنجره فعلی */
  remaining: number;
  /** ثانیه تا آزاد شدن مجدد */
  retryAfterSec: number;
}

/**
 * بررسی محدودیت نرخ درخواست.
 * @param key کلید یکتا (مثلاً `login:${ip}` یا `otp:${mobile}`)
 * @param limit حداکثر تعداد درخواست در پنجره
 * @param windowMs طول پنجره به میلی‌ثانیه
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) {
    // جلوگیری از نشت حافظه — پاکسازی دوره‌ای کلیدهای قدیمی
    for (const [k, b] of buckets) {
      if (!b.hits.length || now - b.hits[b.hits.length - 1] > windowMs * 4) buckets.delete(k);
    }
  }
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  // فقط hits داخل پنجره را نگه دار
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  bucket.hits.push(now);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfterSec: 0 };
}

/**
 * استخراج IP کلاینت از هدرهای Next.js (پشت Caddy/reverse-proxy).
 *
 * 🔒 ممیزی امنیتی F4 — ترتیب قدیمی «cf-connecting-ip اول» قابل تزریق بود:
 * Caddy فقط X-Forwarded-For و X-Real-IP را بازنویسی می‌کند ولی cf-connecting-ip
 * را دست‌نخورده از کلاینت عبور می‌دهد → مهاجم با هدر جعلی rate-limit هر IP دلخواهی
 * را دور می‌زد (هزینهٔ SMS، اسپم، خنثی‌کردن سقف‌ها). حالا فقط هدرهایی که اینفرا
 * واقعاً ست می‌کند اعتماد می‌شوند؛ cf-connecting-ip کاملاً نادیده گرفته می‌شود.
 */
export function getClientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** پاسخ استاندارد 429 برای نقض rate limit */
export function rateLimitResponse(retryAfterSec: number, message?: string) {
  return Response.json(
    {
      error:
        message ??
        `تعداد درخواست‌ها بیش از حد مجاز است. لطفاً ${retryAfterSec} ثانیه دیگر دوباره تلاش کنید.`,
      code: "RATE_LIMITED",
      retryAfterSec,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}

/**
 * v197 — صفحهٔ ۴۲۹ فارسی/موبایل‌پسند برای مسیرهای GET قیف پرداخت (/r و /enter).
 *
 * ریشهٔ سقوط فروش در پیک اینستاگرام: rateLimitResponse قبلی JSON خام
 * {"error":"…"} برمی‌گرداند — کاربر موبایل روی لینک پیامکی دیوار JSON می‌دید و
 * رها می‌کرد (CGNAT اپراتورها می‌تواند کاربران پشت یک IP مشترک کند). حالا
 * صفحهٔ HTML هم‌تم سایت با شمارش معکوس خودکار (meta refresh) برمی‌گردد تا
 * کلیک دوباره بعد از رفع محدودیت به‌طور خودکار ادامه پیدا کند.
 */
export function rateLimitHtmlResponse(retryAfterSec: number, retryUrl?: string): Response {
  const secs = Math.max(1, Math.min(120, Math.ceil(retryAfterSec)));
  const refresh = retryUrl
    ? `<meta http-equiv="refresh" content="${secs + 3};url=${retryUrl.replace(/"/g, "&quot;")}">`
    : "";
  const hint = retryUrl
    ? "تا چند ثانیهٔ دیگر به‌صورت خودکار ادامه می‌یابد؛ اگر نشد، دوباره روی لینک بزنید."
    : "چند لحظه بعد دوباره روی لینک پیامکی بزنید.";
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>فیتاپ — کمی صبر کنید</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(180deg,#fff7ed,#ffffff);font-family:Tahoma,Vazirmatn,sans-serif;color:#0f172a}
  .card{max-width:22rem;margin:1rem;padding:2rem 1.5rem;text-align:center;
    background:#fff;border:1px solid #ffedd5;border-radius:1.5rem;box-shadow:0 10px 30px rgba(249,115,22,.08)}
  .badge{width:4rem;height:4rem;border-radius:1rem;background:#fff7ed;border:1px solid #ffedd5;
    display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:1.75rem}
  h1{font-size:1.05rem;margin:0 0 .5rem} p{font-size:.8rem;color:#64748b;line-height:1.9;margin:0}
</style></head><body>
<div class="card"><div class="badge">🍊</div>
<h1>ترافیک لحظه‌ای زیاد است</h1>
<p>درخواست‌های این لینک موقتاً زیاد شده است. ${hint}</p>
</div></body></html>`;
  return new Response(html, {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(secs),
      "Cache-Control": "no-store",
    },
  });
}
