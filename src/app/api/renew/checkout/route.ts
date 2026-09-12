import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyRenewToken } from "@/lib/fitness/renew-token";
import { getActivePlans, getActivePlan } from "@/lib/fitness/pricing";
import {
  computePlanFinalAmount,
  DiscountInvalidError,
} from "@/lib/fitness/payment-delivery";
import { zarinpalRequest } from "@/lib/fitness/zarinpal";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import type { Plan } from "@/lib/fitness/types";

interface RenewCheckoutBody {
  t?: string;
  /** خالی = تمدید پلن فعلی؛ مقدار = ارتقا به پلن بالاتر */
  planId?: string;
  /** کد تخفیف دستی کاربر (اختیاری — پیش‌فرض کد اختصاصی تمدید خودش) */
  discountCode?: string;
}

/**
 * POST /api/renew/checkout — عمومی (توکن = هویت)
 *
 * ساخت پرداخت زرین‌پال برای تمدید پلن فعلی یا ارتقا به پلن بالاتر، مستقیم از
 * صفحهٔ تمدید مجزا (/renew?t=...) — بدون نیاز به لاگین.
 *
 * کال‌بک زرین‌پال به همان صفحهٔ تمدید برمی‌گردد:
 *   {SITE}/renew?t=...&payment_verify=1&Authority=...&Status=OK|NOK
 * و صفحه، POST /api/renew/verify را صدا می‌زند.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`renew-checkout:${getClientIp(req)}`, 10, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    const body = (await req.json().catch(() => ({}))) as RenewCheckoutBody;
    const parsed = verifyRenewToken(body.t);
    if (!parsed) {
      return Response.json(
        { error: "لینک تمدید نامعتبر یا منقضی شده است." },
        { status: 400 }
      );
    }
    const { uid } = parsed;

    const user = await db.user.findUnique({
      where: { id: uid },
      select: { id: true, isBlocked: true, mobile: true, name: true, planName: true },
    });
    if (!user || user.isBlocked) {
      return Response.json({ error: "حساب کاربری یافت نشد." }, { status: 404 });
    }

    // ─── پلن هدف: پیش‌فرض پلنِ اشتراکِ توکن (تمدید)؛ وگرنه planId (ارتقا) ───
    const tokenSub = await db.subscription.findUnique({ where: { id: parsed.sid } });
    const targetPlanId = body.planId?.trim() || tokenSub?.plan || user.planName;
    if (!targetPlanId) {
      return Response.json({ error: "پلن فعلی یافت نشد." }, { status: 400 });
    }

    const plans = await getActivePlans();
    const plan = plans.find((p) => p.id === targetPlanId) ??
      (await getActivePlan(targetPlanId as Plan));
    if (!plan) {
      return Response.json({ error: "پلن انتخاب‌شده معتبر نیست." }, { status: 400 });
    }

    // ─── کد تخفیف: دستی کاربر < کد اختصاصی تمدید خودش ───
    let userDiscountCode: string | undefined = body.discountCode?.trim() || undefined;
    if (!userDiscountCode) {
      const udc = await db.userDiscountCode.findFirst({
        where: {
          userId: uid,
          isUsed: false,
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
      });
      userDiscountCode = udc?.code ?? undefined;
    }

    // ─── محاسبهٔ مبلغ نهایی (تخفیف + اعتبار ارتقا) — همان منطق checkout اصلی ───
    let computed;
    try {
      computed = await computePlanFinalAmount(uid, plan, { userDiscountCode });
    } catch (e) {
      if (e instanceof DiscountInvalidError) {
        // کد اختصاصی نامعتبر شد (مصرف/انقضا) → بدون کد دوباره
        computed = await computePlanFinalAmount(uid, plan, {});
      } else {
        throw e;
      }
    }

    // ─── پرداخت pending تازه (≤۱۰ دقیقه) همان پلن؟ → reuse (ضد دوباره‌سازی) ───
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const existingPending = await db.payment.findFirst({
      where: {
        userId: uid,
        plan: plan.id,
        status: "pending",
        paymentMethod: "gateway",
        createdAt: { gt: tenMinAgo },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existingPending?.authority && existingPending.amount === computed.finalAmount) {
      return Response.json({
        ok: true,
        paymentId: existingPending.id,
        gatewayUrl: `https://payment.zarinpal.com/pg/StartPay/${existingPending.authority}`,
        finalAmount: computed.finalAmount,
        reused: true,
      });
    }

    // ─── درخواست زرین‌پال با کال‌بک اختصاصی صفحهٔ تمدید ───
    // v65 — فال‌بک همیشه دامنهٔ رسمی است (نه origin درخواست که پشت پراکسی ممکن
    // است 0.0.0.0:3000 باشد — گزارش واقعی «لینک 0.0.0.0:3000» در پیامک‌ها)
    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir"
    ).replace(/\/$/, "");
    const callbackUrl = `${siteUrl}/renew?t=${encodeURIComponent(body.t ?? "")}&payment_verify=1`;

    const zReq = await zarinpalRequest({
      amount: computed.finalAmount,
      description: `فیتاپ — ${plan.label} — ${computed.upgradeCredit > 0 ? "ارتقا" : "تمدید"} — ${user.mobile}`,
      callbackUrl,
      mobile: user.mobile,
    });
    if (!zReq.ok || !zReq.authority || !zReq.gatewayUrl) {
      console.error("[renew/checkout] zarinpal request failed:", zReq.error);
      return Response.json(
        { error: "اتصال به درگاه پرداخت ممکن نشد. چند لحظه بعد تلاش کنید." },
        { status: 502 }
      );
    }

    const payment = await db.payment.create({
      data: {
        userId: uid,
        amount: computed.finalAmount,
        originalAmount: computed.originalAmount,
        plan: plan.id,
        paymentMethod: "gateway",
        authority: zReq.authority,
        status: "pending",
        discountCode: computed.discountCode,
        description: `فیتاپ — ${plan.label} — ${computed.upgradeCredit > 0 ? "ارتقا از صفحه تمدید" : "تمدید از لینک پیامک"}`,
      },
    });

    return Response.json({
      ok: true,
      paymentId: payment.id,
      gatewayUrl: zReq.gatewayUrl,
      finalAmount: computed.finalAmount,
      reused: false,
    });
  } catch (e) {
    console.error("[renew/checkout] failed:", e);
    return Response.json({ error: "خطا در ساخت پرداخت. دوباره تلاش کنید." }, { status: 500 });
  }
}
