"use client";

/**
 * fetchJson — ابزار مشترک fetch + parse JSON با خطاهای فارسی دوستانه.
 *
 * چرا این فایل وجود دارد:
 * وقتی سرور در حال ری‌استارت است یا درخواست از سقف تایم‌اوت گیت‌وی عبور می‌کند،
 * مرورگر پاسخ HTML (صفحه خطای Caddy/Next) می‌گیرد. `res.json()` در این حالت
 * خطای خام انگلیسی می‌دهد: «Unexpected token '<', "<!DOCTYPE "... is not valid JSON»
 * که برای کاربر فارسی‌زبان بی‌معنی است.
 *
 * این ابزار:
 *  ۱) قبل از parse، content-type را چک می‌کند
 *  ۲) پاسخ‌های HTML/غیر JSON را به خطای فارسی «ارتباط با سرور برقرار نشد» تبدیل می‌کند
 *  ۳) خطای شبکه را هم به همین شکل فارسی می‌دهد
 *
 * v156 — ضد «قطع کامل بعد از سوییچ VPN»: transport از fetch خام به
 * fetchWithResilience منتقل شد (همان لایهٔ پرداخت):
 *  • تایم‌اوت سخت ۱۲ ثانیه — درخواست دیگر هرگز روی سوکت مرده آویزان نمی‌ماند
 *  • درخواست‌های GET/HEAD یک تلاش دوباره با اتصال کاملاً تازه می‌گیرند
 *  • POST/PUT/DELETE/PATCH هرگز به‌صورت خودکار تکرار نمی‌شوند (خطر ارسال دوباره —
 *    فقط تایم‌اوت دارند؛ رفتار فراخوان‌ها مثل قبل)
 *  • هر شکست شبکه به موتور خودترمیمی (network-recovery) گزارش می‌شود
 */

import { fetchWithResilience } from "@/lib/payment/client-fetch";
import { isLongTimeoutUrl } from "@/lib/fitness/net-shield";

/** سقف تایم‌اوت مسیرهای AI طولانی (چت با فیتاپ/نیکا، تحلیل‌ها — پاسخ تا چند دقیقه) */
const LONG_AI_TIMEOUT_MS = 420_000;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const SERVER_UNREACHABLE_MESSAGE =
  "ارتباط با سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.";

export async function fetchJson<T = any>(
  input: RequestInfo,
  init?: RequestInit
): Promise<{ res: Response; data: T }> {
  let res: Response;
  try {
    const method = String(init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") ?? "GET").toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // v156 — فقط POSTهای AI (ارسال چت/تحلیل‌ها) پاسخ چنددقیقه‌ای دارند: تایم‌اوت
    // بلند ۴۲۰ ثانیه. GETها (تاریخچه چت، poll وضعیت و…) همیشه سریع‌اند → ۱۲ ثانیه؛
    // GET امن‌ترین متد برای ریتری است → ۲ تلاش دوباره (۳ تلاش) با سوکت تازه.
    const timeoutMs = !idempotent && isLongTimeoutUrl(url) ? LONG_AI_TIMEOUT_MS : 12_000;
    res = await fetchWithResilience(
      input,
      init,
      { timeoutMs, retries: idempotent ? 2 : 0 }
    );
  } catch {
    // خطای شبکه (سرور در دسترس نیست، DNS، offline، سوکت مردهٔ سوییچ VPN و…)
    throw new ApiError(SERVER_UNREACHABLE_MESSAGE, 0);
  }

  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();

  if (!contentType.includes("application/json")) {
    // پاسخ HTML (صفحه خطای گیت‌وی/سرور) یا هر چیز غیر JSON
    console.error(
      `[fetchJson] non-JSON response (${res.status}, ${contentType || "no content-type"}):`,
      bodyText.slice(0, 150)
    );
    if (res.status >= 500 || res.status === 0) {
      throw new ApiError(SERVER_UNREACHABLE_MESSAGE, res.status);
    }
    throw new ApiError("پاسخ سرور نامعتبر است. لطفاً دوباره تلاش کنید.", res.status);
  }

  let data: any = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    console.error("[fetchJson] JSON parse failed:", bodyText.slice(0, 150));
    throw new ApiError("پاسخ سرور نامعتبر است. لطفاً دوباره تلاش کنید.", res.status);
  }

  return { res, data: data as T };
}

/**
 * نسخه پرکاربرد: خطای API (res.ok=false) را هم به Error فارسی تبدیل می‌کند.
 * data.error از پاسخ سرور در صورت وجود استفاده می‌شود.
 */
export async function fetchJsonOrThrow<T = any>(
  input: RequestInfo,
  init?: RequestInit,
  fallbackError = "خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید."
): Promise<T> {
  const { res, data } = await fetchJson<T>(input, init);
  if (!res.ok) {
    const apiError = (data as any)?.error || (data as any)?.message;
    throw new ApiError(apiError || fallbackError, res.status);
  }
  return data;
}
