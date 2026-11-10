import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/fitness/rate-limit";
import { detectEntrySourceFromUa } from "@/lib/fitness/entry-source";
import { issueAndSendPaymentLinkSms } from "@/lib/fitness/payment-bridge";

/**
 * v171 — POST /api/payment/instagram/resend — «دریافت لینک جدید» (سند بخش ۹)
 *
 * از صفحهٔ /enter/expired صدا زده می‌شود؛ کاربر در آن مرورگر لاگین نیست (لینک
 * پیامکی تازه باز شده) پس احراز با «توکن قبلی» انجام می‌شود — داشتن توکن یعنی
 * گیرندهٔ همان پیامک (هر پیامک جدید هم به همان شماره می‌رود، نه شماره‌ای دیگر).
 *
 * بدون سشن، بدون افشای اطلاعات (پاسخ‌ها جنریک‌اند)، با سقف نرخ سه‌لایه:
 * IP (ساعتانه) ← پرداخت (کول‌داون ۶۰ثانیه‌ای در send-link هم هست) ← کاربر (روزانه).
 */

interface Body {
  oldToken?: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const rlIp = rateLimit(`pay-resend-ip:${ip}`, 8, 60 * 60_000);
  if (!rlIp.ok) return rateLimitResponse(rlIp.retryAfterSec);

  const body = (await req.json().catch(() => ({}))) as Body;
  const oldToken = String(body.oldToken || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(oldToken)) {
    return Response.json(
      { ok: false, error: "لینک قبلی معتبر تشخیص داده نشد — از پنل کاربری اقدام کنید." },
      { status: 400 }
    );
  }

  const old = await db.paymentToken.findUnique({
    where: { token: oldToken },
    include: { user: true },
  });
  if (!old || old.kind !== "sms_link") {
    return Response.json(
      { ok: false, error: "لینک قبلی معتبر تشخیص داده نشد — از پنل کاربری اقدام کنید." },
      { status: 404 }
    );
  }
  if (old.user.isBlocked) {
    return Response.json({ ok: false, error: "حساب کاربری در دسترس نیست." }, { status: 403 });
  }

  // سقف روزانه برای همین کاربر (ضد سوخت‌وسوز اعتبار پیامک)
  const rlUser = rateLimit(`pay-resend-user:${old.userId}`, 8, 24 * 60 * 60_000);
  if (!rlUser.ok) return rateLimitResponse(rlUser.retryAfterSec);

  // جدیدترین پرداختِ پلنِ معلقِ درگاهی این کاربر (۲۴ ساعت اخیر)
  const payment = await db.payment.findFirst({
    where: {
      userId: old.userId,
      status: "pending",
      paymentMethod: "gateway",
      plan: { not: "wallet_topup" },
      amount: { gt: 0 },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) {
    return Response.json(
      {
        ok: false,
        error: "پرداخت فعالی برای پیامک‌شدن پیدا نشد — از پنل کاربری (تب پلن‌ها) دوباره اقدام کنید.",
      },
      { status: 404 }
    );
  }

  // کول‌داون ۶۰ ثانیه‌ای بین دو پیامک برای یک پرداخت (سند بخش ۲: شمارش معکوس
  // ارسال مجدد — سمت سرور هم اعمال می‌شود، نه فقط UI)
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
      {
        ok: false,
        error: `بین دو ارسال ۶۰ ثانیه فاصله لازم است — ${wait} ثانیه دیگر تلاش کنید.`,
      },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const ua = req.headers.get("user-agent");
  const source = detectEntrySourceFromUa(ua) || "instagram";

  const sms = await issueAndSendPaymentLinkSms({
    user: old.user,
    payment,
    source,
    ip,
    ua,
  });

  if (!sms.ok) {
    return Response.json(
      { ok: false, error: sms.error || "ارسال پیامک ناموفق بود — چند لحظه بعد تلاش کنید." },
      { status: 502 }
    );
  }

  return Response.json({ ok: true, expiresInSec: 20 * 60 });
}
