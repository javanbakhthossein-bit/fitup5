import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyRenewToken } from "@/lib/fitness/renew-token";
import { zarinpalVerify, isZarinpalConfigured } from "@/lib/fitness/zarinpal";
import {
  WalletInsufficientError,
  claimPayment,
  releaseClaim,
  markPaymentFailed,
  isAuthorityUsedElsewhere,
  deliverPlanPayment,
} from "@/lib/fitness/payment-delivery";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

interface RenewVerifyBody {
  t?: string;
  /** از URL کال‌بک زرین‌پال: Authority و Status */
  authority?: string;
  status?: "OK" | "NOK" | "CANCELLED";
  paymentId?: string;
}

/**
 * POST /api/renew/verify — عمومی (توکن = هویت)
 *
 * تأیید و تحویل پرداخت تمدید/ارتقا از صفحهٔ مجزا (/renew?t=...) —
 * همان سیاست‌های /api/payment/verify با احراز هویتِ توکن به‌جای نشست:
 *   • claim اتمیک pending→verifying (ضد دوباره‌سازی هم‌زمان)
 *   • verify زرین‌پال فقط با authority از DB (F2)
 *   • خطای transport/غیرقطعی → releaseClaim + pending (کرون recover دوباره)
 *   • کد ۱۰۱ → چک replay با isAuthorityUsedElsewhere
 *   • تحویل با deliverPlanPayment → اشتراک + پیامک خرید/ارتقا + نوتیف +
 *     ProgramRequest (پیش‌نیازهای هر خرید جدید) — همه چیز مثل خرید عادی
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`renew-verify:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    const body = (await req.json().catch(() => ({}))) as RenewVerifyBody;
    const parsed = verifyRenewToken(body.t);
    if (!parsed) {
      return Response.json(
        { error: "لینک تمدید نامعتبر یا منقضی شده است." },
        { status: 400 }
      );
    }
    const { uid } = parsed;

    // پیدا کردن پرداخت — با paymentId یا authority (از URL کال‌بک)
    const payment = body.paymentId
      ? await db.payment.findFirst({ where: { id: body.paymentId, userId: uid } })
      : body.authority
        ? await db.payment.findFirst({
            where: { userId: uid, authority: body.authority.trim() },
            orderBy: { createdAt: "desc" },
          })
        : null;
    if (!payment) {
      return Response.json({ error: "پرداخت یافت نشد." }, { status: 404 });
    }

    // ─── قبلاً موفق؟ → رسید idempotent ───
    if (payment.status === "success") {
      const sub = await db.subscription.findFirst({
        where: { userId: uid, paymentId: payment.id },
        orderBy: { createdAt: "desc" },
      });
      return Response.json({
        success: true,
        alreadyVerified: true,
        plan: sub?.plan ?? payment.plan,
        subscriptionStatus: sub?.status ?? null,
        subscriptionEnd: sub?.endDate?.toISOString() ?? null,
      });
    }

    const claim = await claimPayment(payment);
    if (claim === "processed") {
      const sub = await db.subscription.findFirst({
        where: { userId: uid, paymentId: payment.id },
        orderBy: { createdAt: "desc" },
      });
      if (sub) {
        return Response.json({
          success: true,
          alreadyVerified: true,
          plan: sub.plan,
          subscriptionStatus: sub.status,
          subscriptionEnd: sub.endDate?.toISOString() ?? null,
        });
      }
      return Response.json(
        { error: "این پرداخت قبلاً پردازش شده است." },
        { status: 400 }
      );
    }
    if (claim === "busy") {
      return Response.json(
        { success: false, status: "pending", message: "پرداخت در حال پردازش است؛ چند لحظه بعد دوباره بررسی می‌شود." },
        { status: 200 }
      );
    }
    if (claim === "stuck") {
      return Response.json(
        { success: false, status: "pending", message: "پرداخت در صف بررسی است — پول شما حفظ شده است." },
        { status: 200 }
      );
    }

    // (claim === "claimed")

    // ─── انصراف کاربر ───
    if (body.status === "CANCELLED") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "cancelled", verifiedAt: new Date() },
      });
      return Response.json({ success: false, status: "cancelled", message: "پرداخت لغو شد." });
    }

    // ─── ناموفق (NOK) ───
    if (body.status === "NOK") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", verifiedAt: new Date() },
      });
      return Response.json({ success: false, status: "failed", message: "پرداخت ناموفق بود." });
    }

    // ─── verify زرین‌پال — فقط با authority از DB (F2) ───
    if (!isZarinpalConfigured()) {
      await markPaymentFailed(payment.id);
      return Response.json({
        success: false,
        status: "failed",
        message: "درگاه پرداخت پیکربندی نشده است.",
      });
    }
    if (
      body.authority &&
      typeof body.authority === "string" &&
      body.authority.trim() &&
      payment.authority &&
      body.authority.trim() !== payment.authority
    ) {
      await markPaymentFailed(payment.id);
      return Response.json(
        { success: false, status: "failed", message: "کد مرجع پرداخت با تراکنش مطابقت ندارد." },
        { status: 400 }
      );
    }
    if (!payment.authority) {
      await markPaymentFailed(payment.id);
      return Response.json({
        success: false,
        status: "failed",
        message: "کد مرجع پرداخت (authority) یافت نشد.",
      });
    }

    const zRes = await zarinpalVerify({
      authority: payment.authority, // F2: همیشه از DB
      amount: payment.amount,
    });

    if (!zRes.ok) {
      // هر دو حالت transportError و خطای غیرشبکه‌ای → pending (سیاست verify اصلی):
      // کاربر با Status=OK برگشته و پول ممکن است گرفته شده باشد؛
      // کرون recover بعداً با همان authority تعیین‌تکلیف می‌کند.
      await releaseClaim(payment.id);
      return Response.json(
        {
          success: false,
          status: "pending",
          message:
            "زرین‌پال هنوز این تراکنش را تأیید نکرده است. اگر مبلغ کسر شده، نگران نباشید — سیستم به‌زودی دوباره بررسی می‌کند و پلن شما فعال می‌شود.",
          refId: zRes.refId,
        },
        { status: 200 }
      );
    }

    // موفق (100 یا 101) — سیاست ۱۰۱ مثل verify اصلی
    if (zRes.code === 101 || zRes.alreadyVerified) {
      if (await isAuthorityUsedElsewhere(payment.authority, payment.id)) {
        await markPaymentFailed(payment.id);
        return Response.json(
          { success: false, status: "failed", error: "این تراکنش قبلاً استفاده شده است." },
          { status: 400 }
        );
      }
      console.info("[renew/verify] code 101 بدون replay — تحویل پرداخت تمدید:", payment.id);
    }

    const refId = zRes.refId ?? `${Date.now()}${Math.floor(Math.random() * 10000)}`;

    try {
      const result = await deliverPlanPayment({
        userId: uid,
        payment,
        refId,
        cardPan: zRes.cardPan ?? null,
        cardHash: zRes.cardHash ?? null,
        fee: zRes.fee ?? null,
      });
      return Response.json({
        success: true,
        plan: result.plan,
        planId: result.planId,
        subscriptionStatus: result.subscriptionStatus,
        subscriptionEnd: result.subscriptionEnd,
        remainingDaysPreserved: result.remainingDaysPreserved,
      });
    } catch (txErr) {
      if (txErr instanceof WalletInsufficientError) {
        await markPaymentFailed(payment.id);
        return Response.json({
          success: false,
          status: "failed",
          message: "موجودی کیف پول در زمان تایید کافی نبود.",
        });
      }
      console.error("[renew/verify] delivery error:", txErr);
      await releaseClaim(payment.id);
      return Response.json(
        {
          success: false,
          status: "pending",
          message: "خطای موقت در ثبت نهایی خرید. به‌زودی دوباره تلاش می‌شود — پول شما حفظ شده است.",
        },
        { status: 200 }
      );
    }
  } catch (e) {
    console.error("[renew/verify] failed:", e);
    return Response.json({ error: "خطا در تأیید پرداخت." }, { status: 500 });
  }
}
