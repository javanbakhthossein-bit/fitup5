/**
 * v171 — منطق مشترک مسیرهای «شروع پرداخت» (Server-only):
 *   • /enter?token=…            → لینک پیامکی اینستاگرام (سشن + ریدایرکت درگاه)
 *   • /pay/start?order=&t=&from → پل Custom Tabs اپ اختصاصی (هر نوع پرداخت)
 *   • /wallet/topup/start?…     → همان پل، فقط برای شارژ کیف پول (سند بخش ۱۱)
 *
 * خروجی همیشه یک NextResponse است (302 یا صفحهٔ خطای هدایت‌شده) — هیچ HTML
 * مستقیمی اینجا رندر نمی‌شود؛ خطاها به /enter/expired (صفحهٔ فارسی سبک) یا
 * پنل هدایت می‌شوند.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, setSession } from "@/lib/fitness/auth";
import {
  desiredCallbackForPayment,
  recordTokenClick,
  resolveGatewayStart,
  validatePaymentToken,
} from "@/lib/fitness/payment-bridge";
import { rateLimit, getClientIp, rateLimitHtmlResponse } from "@/lib/fitness/rate-limit";

function internalUrl(req: NextRequest, path: string): string {
  return `${req.nextUrl.origin}${path}`;
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(internalUrl(req, path), 302);
}

export interface GatewayStartOptions {
  /** فقط پرداخت‌های شارژ کیف پول (wallet_topup) پذیرفته شوند؟ */
  walletOnly?: boolean;
}

/**
 * هندلر مشترک شروع پرداخت.
 * شناسهٔ کاربر: اول توکن پل (app_bridge برای اپ اندروید)، بعد سشن موجود.
 */
export async function handleGatewayStart(
  req: NextRequest,
  opts: GatewayStartOptions = {}
): Promise<Response> {
  const ip = getClientIp(req);
  const rl = rateLimit(`pay-start:${ip}`, 30, 60_000);
  // v197 — HTML به‌جای JSON خام (Custom Tabs اپ هم مرورگر است — JSON خام بن‌بست است)
  if (!rl.ok)
    return rateLimitHtmlResponse(
      rl.retryAfterSec,
      `${req.nextUrl.pathname}${req.nextUrl.search || ""}`
    );

  const sp = req.nextUrl.searchParams;
  const tokenParam = (sp.get("t") || sp.get("token") || "").trim();
  const orderParam = (sp.get("order") || sp.get("oid") || "").trim();
  const fromParam = (sp.get("from") || "").trim();
  const amountParam = sp.get("amount");

  let userId: string | null = null;
  let validatedTokenId: string | null = null;

  // ① احراز با پل اپ (Custom Tabs سشن ندارد — سند بخش ۳)
  if (tokenParam) {
    const v = await validatePaymentToken(tokenParam, "app_bridge");
    if (v.ok) {
      userId = v.data.user.id;
      validatedTokenId = v.data.tokenRow.id;
    } else if (v.reason === "expired" || v.reason === "invalid") {
      // پل منقضی/نامعتبر → فال‌بک به سشن (مثلاً کروم همان کاربر باشد)؛
      // بدون سشن → ورود به سایت
      const sessUser = await getCurrentUser();
      if (sessUser) {
        userId = sessUser.id;
      } else {
        return redirectTo(req, `/?screen=panel&pay_bridge=${v.reason === "expired" ? "expired" : "invalid"}`);
      }
    }
  } else {
    // ② فال‌بک: سشن موجود (مرورگری که لاگین است)
    const sessUser = await getCurrentUser();
    if (sessUser) userId = sessUser.id;
  }

  if (!userId) {
    return redirectTo(req, "/?screen=panel");
  }

  // پرداخت: از پارامتر order، وگرنه آخرین پرداختِ pending گیت‌ویِ همین کاربر
  let payment = null as Awaited<ReturnType<typeof db.payment.findFirst>>;
  if (orderParam) {
    payment = await db.payment.findUnique({ where: { id: orderParam } });
  } else {
    payment = await db.payment.findFirst({
      where: { userId, status: "pending", paymentMethod: "gateway", amount: { gt: 0 } },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!payment || payment.userId !== userId) {
    return redirectTo(req, "/?screen=panel&tab=plans");
  }
  if (opts.walletOnly && payment.plan !== "wallet_topup") {
    return redirectTo(req, "/?screen=panel&tab=plans");
  }
  if (!opts.walletOnly && payment.plan === "wallet_topup") {
    // شارژ کیف پول باید از مسیر مخصوص خودش برود (سند بخش ۱۱) — اجازه هم هست
    // ولی از /pay/start مستقیم مشکلی ندارد؛ فقط ارجاع می‌دهیم برای ثبت یکدست
    return redirectTo(
      req,
      `/wallet/topup/start?order=${encodeURIComponent(payment.id)}${
        tokenParam ? `&t=${encodeURIComponent(tokenParam)}` : ""
      }&from=${encodeURIComponent(fromParam || payment.source || "unknown")}`
    );
  }

  // اعتبارسنجی amount اختیاری (سند: /wallet/topup/start?amount=…) — صرفاً سازگاری
  if (
    amountParam &&
    Number.isFinite(Number(amountParam)) &&
    Number(amountParam) > 0 &&
    Number(amountParam) !== payment.amount
  ) {
    return redirectTo(req, "/enter/expired?reason=gateway");
  }

  // آمار کلیک پل
  if (validatedTokenId) {
    await recordTokenClick(validatedTokenId);
  }

  // سنجش صحت پرداخت معلق
  if (payment.status === "success") {
    return redirectTo(req, "/?screen=panel&tab=dashboard");
  }
  if (payment.status !== "pending" || payment.paymentMethod !== "gateway" || payment.amount <= 0) {
    return redirectTo(req, "/?screen=panel&tab=plans");
  }

  // اگر from=app_android آمده ولی منبع پرداخت هنوز ثبت نشده → ثبت (تا کال‌بک
  // با ret=app_android ساخته شود و دیپ‌لینک اجرا شود)
  if (fromParam === "app_android" && payment.source !== "app_android") {
    payment = await db.payment.update({
      where: { id: payment.id },
      data: { source: "app_android" },
    });
  }

  const desired = desiredCallbackForPayment(payment);
  const result = await resolveGatewayStart(payment, desired);

  switch (result.mode) {
    case "gateway":
      return NextResponse.redirect(result.redirectUrl!, 302);
    case "verify_return":
      return NextResponse.redirect(result.redirectUrl!, 302);
    case "not_pending":
      if (payment.status === "success") {
        return redirectTo(req, "/?screen=panel&tab=dashboard");
      }
      return redirectTo(req, "/?screen=panel&tab=plans");
    case "gateway_error":
    default:
      return redirectTo(req, "/enter/expired?reason=gateway");
  }
}

/**
 * هندلر مشترک /enter?token=… — لینک پیامکی اینستاگرام.
 * کلیدهای رفتار (سند بخش ۲):
 *   • validate → session → ریدایرکت مستقیم به زرین‌پال
 *   • چندکلیک مجاز تا پرداخت موفق (سناریوی VPN: رفرش/کلیک دوباره کار می‌کند)
 *   • پرداختِ موفقِ قبلی → مستقیم داشبورد
 *   • منقضی → صفحهٔ «لینک منقضی شده» + «دریافت لینک جدید»
 */
export async function handleSmsLinkEnter(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req);
  const rl = rateLimit(`enter:${ip}`, 30, 60_000);
  // v197 — HTML به‌جای JSON خام (کاربر موبایل روی لینک پیامکی JSON نمی‌فهمد؛
  // رفرش خودکار بعد از رفع محدودیت ادامهٔ کلیک را بی‌دردسر می‌کند)
  if (!rl.ok)
    return rateLimitHtmlResponse(
      rl.retryAfterSec,
      `${req.nextUrl.pathname}${req.nextUrl.search || ""}`
    );

  const tokenParam = (req.nextUrl.searchParams.get("token") || "").trim();
  if (!tokenParam) {
    return redirectTo(req, "/enter/expired?reason=invalid");
  }

  const { validatePaymentToken } = await import("@/lib/fitness/payment-bridge");
  const v = await validatePaymentToken(tokenParam, "sms_link");
  if (!v.ok) {
    if (v.reason === "expired") {
      return redirectTo(
        req,
        `/enter/expired?reason=expired&t=${encodeURIComponent(tokenParam)}`
      );
    }
    return redirectTo(req, "/enter/expired?reason=invalid");
  }

  const { data } = v;
  const payment = data.payment;

  // آمار کلیک — قبل از هر ریدایرکتی (ممیزی چندکلیک)
  await recordTokenClick(data.tokenRow.id);

  // سشن — قلب فلوی اینستاگرام: کلیک لینک = ورود به حساب در مرورگر پیش‌فرض
  try {
    await setSession(data.user.id);
  } catch (e) {
    console.error("[enter] setSession failed:", e instanceof Error ? e.message : e);
    return redirectTo(req, "/enter/expired?reason=gateway");
  }

  if (!payment) {
    return redirectTo(req, `/enter/expired?reason=expired&t=${encodeURIComponent(tokenParam)}`);
  }

  if (payment.status === "success") {
    return redirectTo(req, "/?screen=panel&tab=dashboard");
  }
  if (payment.status !== "pending") {
    return redirectTo(
      req,
      `/enter/expired?reason=expired&t=${encodeURIComponent(tokenParam)}`
    );
  }

  const desired = desiredCallbackForPayment(payment);
  const result = await resolveGatewayStart(payment, desired);

  switch (result.mode) {
    case "gateway":
    case "verify_return":
      return NextResponse.redirect(result.redirectUrl!, 302);
    case "not_pending":
      // وضعیت هنوز pending است — تنها مسیر رسیدن به اینجا مبلغ صفر است؛
      // کاربر به پنل (تب پلن‌ها) برمی‌گردد
      return redirectTo(req, "/?screen=panel&tab=plans");
    case "gateway_error":
    default:
      return redirectTo(
        req,
        `/enter/expired?reason=gateway&t=${encodeURIComponent(tokenParam)}`
      );
  }
}