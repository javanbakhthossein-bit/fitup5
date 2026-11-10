/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v252 — آداپتور کال‌بک زیبال: /pay/zibal/callback/{paymentId}
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * زیبال نتیجهٔ پرداخت را با GET به callbackUrl می‌فرستد:
 *   {callbackUrl}?success=1&trackId=…&status=2&orderId=…
 *
 * مشکل: قالب استاندارد کال‌بک فیتاپ ‎/?payment_verify=1&Authority=…&Status=OK|NOK
 * است و کلاینت (PaymentVerifyHandler) فقط همین قالب را می‌فهمد. الحاق پارامترهای
 * زیبال به URL دارای query از قبل، پیش‌بینی‌پذیر نیست (؟ یا &) — پس callbackUrl
 * ثبت‌شدهٔ زیبال عمداً «بدون query» است و این مسیر میانی نقش ترجمه دارد:
 *
 *   زیبال → /pay/zibal/callback/{paymentId}?success=…&trackId=…&status=…
 *         → ۳۰۲ به /?payment_verify=1&Authority={trackId}&Status={OK|NOK}
 *           (+ &ret=app_android&oid=… برای فلو اپ اختصاصی — دیپ‌لینک fitup://)
 *
 * نتیجه: کلاینت و مسیر verify بایت‌به‌بایت مثل زرین‌پال کار می‌کنند — صفر
 * تغییر در PaymentVerifyHandler. امنیت: paymentId از مسیر فقط برای تعیین
 * ret/oid استفاده می‌شود؛ verify سمت سرور همیشه authority از DB را چک می‌کند
 * (سیاست F2 — به هیچ پارامتری از درگاه برای تایید اعتماد نمی‌شود).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canonicalSiteUrl } from "@/lib/fitness/payment-bridge";
import { recordFunnelEvent } from "@/lib/analytics/funnel";
// v253 — وریفای و تحویل سمت سرور بدون وابستگی به کلاینت (ریشه‌کنی باگ
// «تایید نشده توسط پذیرنده» زیبال: پول به کیف پول زیبال رفت چون وریفای
// سمت ما هرگز اجرا نشده بود — کلاینت برگشتی از درگاه رندر نشده بود).
import { serverVerifyAndDeliverPayment } from "@/lib/fitness/payment-delivery";

export const dynamic = "force-dynamic";

const VALID_PAYMENT_ID_RE = /^[a-z0-9]{20,40}$/i;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await ctx.params;
  const sp = req.nextUrl.searchParams;

  // پارامترهای زیبال (طبق مستندات — GET query string)
  const success = sp.get("success");
  const trackId = (sp.get("trackId") || "").trim();
  const zibalStatus = sp.get("status") || "";

  const site = canonicalSiteUrl();

  // ─── پارامتر ناقص/خراب → صفحهٔ استاندارد verify بدون authority ───
  // (کاربر حداقل به صفحهٔ نتیجه می‌رسد و پیام «در حال بررسی» می‌بیند؛
  //  کرون تعیین‌تکلیف می‌کند اگر پول رفته باشد)
  if (!trackId || success == null) {
    console.warn(
      `[pay/zibal/callback] incomplete callback params — paymentId=${paymentId} success=${success} trackId=${trackId} status=${zibalStatus}`
    );
    return NextResponse.redirect(`${site}/?payment_verify=1&Status=OK`, 302);
  }

  // ترجمهٔ success زیبال → Status استاندارد فیتاپ (1 = پرداخت موفق از دید زیبال)
  const status = success === "1" ? "OK" : "NOK";

  // ─── فلو اپ اندروید: ret/oid برای دیپ‌لینک fitup://payment/success ───
  // paymentId از مسیر می‌آید (نه از درگاه) — ضد دستکاری
  let retParams = "";
  if (VALID_PAYMENT_ID_RE.test(paymentId)) {
    try {
      const payment = await db.payment.findUnique({
        where: { id: paymentId },
        select: { source: true },
      });
      if (payment?.source === "app_android") {
        retParams = `&ret=app_android&oid=${encodeURIComponent(paymentId)}`;
      }
    } catch {
      // خطای DB نباید مسیر بازگشت کاربر را بشکند — فقط بدون دیپ‌لینک ادامه می‌دهیم
    }
  }

  // ─── 🔥 v253 — وریفای سمت سرور «قبل از» ریدایرکت (قلب فیکس زیبال) ───
  // کال‌بک زیبال تنها نقطه‌ای است که قطعی می‌دانیم کاربر پول داده و برگشته است.
  // تا v252 وریفای فقط از کلاینت (رندر صفحهٔ /?payment_verify=1) شروع می‌شد —
  // اگر WebView/مرورگر رندر نمی‌شد، کوکی نبود یا کاربر صفحه را می‌بست، وریفای
  // هرگز به زیبال نمی‌رسید و تراکنش «تایید نشده توسط پذیرنده» می‌ماند و مبلغ
  // به کیف پول زیبال می‌رفت (گزارش مالک).
  // حالا: سرور همین‌جا claim → gatewayVerify → تحویل کامل را انجام می‌دهد
  // (idempotent — مسیر کلاینت بعداً رسید idempotent می‌گیرد). خطا/timeout
  // هرگز مسیر بازگشت کاربر را نمی‌شکند — حداکثر ۱۲ ثانیه انتظار، بعد ادامه.
  if (success === "1" && VALID_PAYMENT_ID_RE.test(paymentId)) {
    try {
      const verifyOutcome = await Promise.race([
        serverVerifyAndDeliverPayment(paymentId, {
          userAgent: req.headers.get("user-agent"),
        }),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 12_000)),
      ]);
      console.info(
        `[pay/zibal/callback] server-verify paymentId=${paymentId} trackIdHead=${trackId.slice(0, 8)} → ${JSON.stringify(verifyOutcome)}`
      );
    } catch (e) {
      // وریفای سرور هرگز مسیر بازگشت کاربر را نمی‌شکند — کرون/کلاینت جبران می‌کند
      console.error("[pay/zibal/callback] server-verify threw (non-blocking):", e);
    }
  }

  // رویداد قیف: بازگشت از درگاه زیبال (موفق/ناموفق — برای ریزش‌سنجی دقیق درگاه دوم)
  try {
    await recordFunnelEvent({
      event: success === "1" ? "zibal_callback_success" : "zibal_callback_failed",
      path: "/pay/zibal/callback",
      meta: {
        trackIdHead: trackId.slice(0, 8),
        zibalStatus,
        paymentIdHead: VALID_PAYMENT_ID_RE.test(paymentId) ? paymentId.slice(0, 8) : null,
      },
      userAgent: req.headers.get("user-agent"),
    });
  } catch {
    // رویدادگذاری هرگز مسیر پرداخت را نمی‌شکند
  }

  const target = `${site}/?payment_verify=1&Authority=${encodeURIComponent(
    trackId
  )}&Status=${status}${retParams}`;

  return NextResponse.redirect(target, 302);
}
