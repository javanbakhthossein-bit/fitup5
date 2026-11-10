import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/fitness/rate-limit";
import { detectEntrySourceFromUa, maskMobileFa } from "@/lib/fitness/entry-source";
import {
  issueAndSendPaymentLinkSms,
  stampUserSource,
} from "@/lib/fitness/payment-bridge";
// v198 — رویدادگذاری قیف فروش (دیرکتیو مالک)
import { recordFunnelEvent } from "@/lib/analytics/funnel";

/**
 * v171 — POST /api/payment/instagram/send-link — «ارسال پیامک پرداخت امن»
 * (سند بخش ۲ — فلوی اینستاگرام)
 *
 * ورودی: { paymentId } — پرداختی که همین حالا با checkout استاندارد ساخته شده
 * (همان مبلغ دقیق پلن/تخفیف که کاربر روی دکمه‌اش زده — سند: «مبلغ‌های پلن‌ها
 * در لینک پیامک لحاظ شود»).
 *
 * کار سرور:
 *  ۱. توکن ۶۴کاراکتری ۲۰دقیقه‌ای گره‌خورده به موبایل (PaymentToken)
 *  ۲. لینک کوتاه r/XXXXXXXX (سقف ۲۵کاراکتری sms.ir)
 *  ۳. پیامک قالب 744490 با #LINK# و #NAME# — بلافاصله بعد از زدن دکمه
 *  ۴. ثبت IP/UA/منبع برای ممیزی کامل (سند بخش ۸)
 *
 * فقط برای منبع اینستاگرام صدا زده می‌شود؛ وب و اپ کافه‌بازار هیچ ردی از آن
 * ندارند و اپ اختصاصی از bridge-token استفاده می‌کند.
 */

interface Body {
  paymentId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const rl = rateLimit(`pay-link:${user.id}`, 6, 60 * 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as Body;
    const paymentId = String(body.paymentId || "").trim();
    if (!paymentId) {
      return Response.json({ error: "شناسه پرداخت نامعتبر است." }, { status: 400 });
    }

    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.userId !== user.id) {
      return Response.json({ error: "پرداخت یافت نشد." }, { status: 404 });
    }
    // فقط پرداخت پلنِ معلقِ درگاهی با مبلغ مثبت — شارژ کیف پول برای اینستاگرام
    // تعریف نشده (سند بخش ۱۱) و مبلغ صفر اصلاً پیامک نمی‌خواهد (فعال‌سازی رایگان)
    if (payment.status !== "pending" || payment.paymentMethod !== "gateway") {
      return Response.json(
        { error: "این پرداخت قابل ادامه نیست — دوباره از تب پلن‌ها اقدام کنید." },
        { status: 400 }
      );
    }
    if (payment.plan === "wallet_topup" || payment.amount <= 0) {
      return Response.json({ error: "این نوع پرداخت پیامک ندارد." }, { status: 400 });
    }

    // کول‌داون ۶۰ ثانیه‌ای بین دو پیامک برای یک پرداخت (سند: شمارش معکوس ارسال مجدد)
    const lastToken = await db.paymentToken.findFirst({
      where: { kind: "sms_link", paymentId: payment.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (lastToken && Date.now() - lastToken.createdAt.getTime() < 60_000) {
      const wait = Math.ceil(
        (60_000 - (Date.now() - lastToken.createdAt.getTime())) / 1000
      );
      return Response.json(
        { error: `بین دو ارسال ۶۰ ثانیه فاصله لازم است.`, code: "COOLDOWN", retryAfterSec: wait },
        { status: 429 }
      );
    }

    // منبع ورود از UA همین درخواست — و اگر پرداخت هنوز منبع ندارد، ثبت
    const ua = req.headers.get("user-agent");
    const source = detectEntrySourceFromUa(ua);
    let effectivePayment = payment;
    if (!payment.source) {
      effectivePayment = await db.payment.update({
        where: { id: payment.id },
        data: { source },
      });
    }
    await stampUserSource(user.id, source);

    const ip = getClientIp(req);
    const sms = await issueAndSendPaymentLinkSms({
      user,
      payment: effectivePayment,
      source,
      ip,
      ua,
    });

    if (!sms.ok) {
      return Response.json(
        { error: sms.error || "ارسال پیامک ناموفق بود." },
        { status: 502 }
      );
    }

    // v198 — رویداد قیف: پیامک «لینک پرداخت امن» واقعاً ارسال شد (authoritative —
    // شاخهٔ پیامکی قیف؛ معادل gateway_redirecting در شاخهٔ درگاه)
    await recordFunnelEvent({
      event: "payment_link_sms_sent",
      userId: user.id,
      planId: effectivePayment.plan,
      amount: effectivePayment.amount,
      meta: { paymentId: effectivePayment.id.slice(-12) },
      userAgent: ua,
    });

    return Response.json({
      ok: true,
      phoneMasked: maskMobileFa(user.mobile),
      // لینک کامل برای فال‌بک «کپی لینک» (سند بخش ۲: Fallback)
      link: sms.link,
      expiresInSec: 20 * 60,
      message: "لینک پرداخت به شماره شما پیامک شد.",
    });
  } catch (e) {
    return apiError(e);
  }
}
