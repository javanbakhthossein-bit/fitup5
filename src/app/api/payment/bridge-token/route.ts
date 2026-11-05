import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/fitness/rate-limit";
import { detectEntrySourceFromUa } from "@/lib/fitness/entry-source";
import { createAppBridgeToken, stampUserSource, APP_BRIDGE_TTL_MS } from "@/lib/fitness/payment-bridge";

/**
 * v171 — POST /api/payment/bridge-token — پل Custom Tabs اپ اختصاصی (سند بخش ۳)
 *
 * WebView اپ سشن دارد ولی Chrome Custom Tabs کوکی‌های جدا دارد؛ پس اپ قبل از
 * باز کردن Custom Tabs این endpoint را صدا می‌زند (با سشن WebView) و یک پل
 * ۵دقیقه‌ای می‌گیرد تا URL میانی بدون سشن هم احراز شود:
 *
 *   /pay/start?order=<paymentId>&from=app_android&t=<bridge>
 *   /wallet/topup/start?order=<paymentId>&from=app_android&t=<bridge>
 *
 * فقط اپ اختصاصی (UA شامل FitUpApp/) از این مسیر استفاده می‌کند؛ کافه‌بازار
 * هیچ ردی از آن ندارد (دستور مهم ۱ سند) و وب مسیر مستقیم خودش را دارد.
 */

interface Body {
  paymentId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const rl = rateLimit(`bridge:${user.id}`, 10, 60_000);
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
    if (payment.status !== "pending" || payment.paymentMethod !== "gateway" || payment.amount <= 0) {
      return Response.json(
        { error: "این پرداخت قابل ادامه نیست — دوباره اقدام کنید." },
        { status: 400 }
      );
    }

    // منبع پرداخت = app_android (تا کال‌بک با ret ساخته شود و دیپ‌لینک اجرا شود)
    let effectivePayment = payment;
    if (payment.source !== "app_android") {
      effectivePayment = await db.payment.update({
        where: { id: payment.id },
        data: { source: "app_android" },
      });
    }

    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent");
    const source = detectEntrySourceFromUa(ua);
    await stampUserSource(user.id, source || "app_android");

    const { token, expiresAt } = await createAppBridgeToken({
      userId: user.id,
      paymentId: payment.id,
      amount: payment.amount,
      source: "app_android",
      ip,
      ua,
    });

    const kind = effectivePayment.plan === "wallet_topup" ? "wallet" : "order";
    const startPath =
      kind === "wallet"
        ? `/wallet/topup/start?order=${encodeURIComponent(payment.id)}&from=app_android&t=${token}`
        : `/pay/start?order=${encodeURIComponent(payment.id)}&from=app_android&t=${token}`;

    return Response.json({
      ok: true,
      token,
      kind,
      url: startPath,
      expiresInSec: Math.floor(APP_BRIDGE_TTL_MS / 1000),
    });
  } catch (e) {
    return apiError(e);
  }
}
