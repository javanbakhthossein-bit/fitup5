import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyRenewToken } from "@/lib/fitness/renew-token";
import { getActivePlans, getActivePlan } from "@/lib/fitness/pricing";
import { computePlanFinalAmount } from "@/lib/fitness/payment-delivery";
import {
  ensureRenewalDiscountCode,
  getExpiryDiscountPercent,
} from "@/lib/fitness/notifications";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import type { Plan } from "@/lib/fitness/types";

/**
 * GET /api/renew/info?t=<token> — عمومی (بدون لاگین؛ توکن = هویت)
 *
 * صفحهٔ تمدید مجزا (لینک پیامک‌های ۱۸۴۷۷۷/۳۲۲۷۸۰/۶۰۴۶۷۸):
 * اطلاعات پلن فعلی، مبلغ نهایی تمدید با تخفیف اختصاصی، و پیشنهادهای ارتقا
 * به پلن‌های بالاتر با مبلغ نهایی هرکدام برمی‌گرداند.
 *
 * هیچ دادهٔ حساسی (موبایل/ایمیل/...) برنمی‌گرداند — فقط نام کوچک و وضعیت پلن.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`renew-info:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    const token = new URL(req.url).searchParams.get("t");
    const parsed = verifyRenewToken(token);
    if (!parsed) {
      return Response.json(
        { error: "لینک تمدید نامعتبر یا منقضی شده است." },
        { status: 400 }
      );
    }
    const { uid, sid } = parsed;

    const user = await db.user.findUnique({
      where: { id: uid },
      select: { id: true, name: true, isBlocked: true, planName: true, planExpiresAt: true },
    });
    if (!user || user.isBlocked) {
      return Response.json({ error: "حساب کاربری یافت نشد." }, { status: 404 });
    }

    const tokenSub = await db.subscription.findUnique({ where: { id: sid } });
    if (!tokenSub || tokenSub.userId !== uid) {
      return Response.json({ error: "اشتراک مرتبط با این لینک یافت نشد." }, { status: 404 });
    }

    // ─── آیا کاربر بعد از این لینک، دوباره تمدید/خرید کرده؟ ───
    const now = new Date();
    const latestActive = await db.subscription.findFirst({
      where: { userId: uid, status: "active", endDate: { gt: now } },
      orderBy: { endDate: "desc" },
    });
    if (latestActive && latestActive.id !== sid) {
      return Response.json({
        ok: true,
        alreadyRenewed: true,
        userFirstName: (user.name || "کاربر").trim().split(/\s+/)[0],
        planLabel: latestActive.plan,
        subscriptionEnd: latestActive.endDate?.toISOString() ?? null,
      });
    }

    const plans = await getActivePlans();
    const currentPlanId = tokenSub.plan;
    const currentPlan = plans.find((p) => p.id === currentPlanId) ??
      (await getActivePlan(currentPlanId as Plan));

    // ─── روزهای باقی‌مانده / وضعیت انقضا ───
    const endDate = tokenSub.endDate ?? user.planExpiresAt ?? null;
    const daysLeft = endDate
      ? Math.ceil((new Date(endDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const isExpired = daysLeft == null ? false : daysLeft <= 0;

    // ─── v38 — گیت تخفیف مالک: کد تخفیف تمدید فقط بعد از «۷۲ ساعت از انقضا»
    // فعال می‌شود (هم‌زمان با پیامک 604678 و نوتیف کد تخفیف). تا آن لحظه —
    // پلن فعال، نزدیک انقضا یا تازه منقضی — هیچ حرفی از تخفیف در صفحه نیست.
    const expiredHoursAgo = endDate
      ? (now.getTime() - new Date(endDate).getTime()) / (60 * 60 * 1000)
      : 0;
    const discountWindowActive = expiredHoursAgo >= 72;

    // ─── تخفیف اختصاصی تمدید (فقط در پنجرهٔ فعال — idempotent) ───
    let discountCode: string | null = null;
    let discountPercent: number | null = null;
    if (discountWindowActive) {
      try {
        const percent = await getExpiryDiscountPercent();
        // v53 — اعتبار ۱۴ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
        const discount = await ensureRenewalDiscountCode(uid, percent, 2);
        if (discount?.code) {
          discountCode = discount.code;
          discountPercent = discount.type === "percent" ? discount.value : null;
        }
      } catch (e) {
        console.warn("[renew/info] discount ensure failed (non-blocking):", e);
      }
    }

    // ─── مبلغ نهایی تمدید پلن فعلی ───
    let renewFinalAmount = currentPlan?.price ?? 0;
    if (currentPlan) {
      try {
        const computed = await computePlanFinalAmount(uid, currentPlan, {
          userDiscountCode: discountCode ?? undefined,
        });
        renewFinalAmount = computed.finalAmount;
      } catch (e) {
        console.warn("[renew/info] compute renew amount failed (fallback to base price):", e);
      }
    }

    // ─── پیشنهادهای ارتقا — پلن‌های بالاتر با مبلغ نهایی (تخفیف همان کد) ───
    const upgrades: Array<{
      id: string;
      label: string;
      tagline: string;
      price: number;
      finalAmount: number;
      durationDays: number;
      phases: number;
      badge: string | null;
      popular: boolean;
      tier: number;
    }> = [];
    for (const p of plans) {
      if ((p.tier ?? 0) <= (currentPlan?.tier ?? 0)) continue;
      let finalAmount = p.price;
      try {
        const computed = await computePlanFinalAmount(uid, p, {
          userDiscountCode: discountCode ?? undefined,
        });
        finalAmount = computed.finalAmount;
      } catch {
        // کد برای این پلن اعمال نشد → قیمت پایه
      }
      upgrades.push({
        id: p.id,
        label: p.label,
        tagline: p.tagline,
        price: p.price,
        finalAmount,
        durationDays: p.durationDays,
        phases: p.phases,
        badge: p.badge ?? null,
        popular: p.popular ?? false,
        tier: p.tier,
      });
    }
    upgrades.sort((a, b) => a.tier - b.tier);

    return Response.json({
      ok: true,
      alreadyRenewed: false,
      userFirstName: (user.name || "کاربر").trim().split(/\s+/)[0],
      subscriptionId: sid,
      planId: currentPlanId,
      planLabel: currentPlan?.label ?? currentPlanId,
      planPrice: currentPlan?.price ?? 0,
      planDurationDays: currentPlan?.durationDays ?? 45,
      planPhases: currentPlan?.phases ?? 1,
      subscriptionEnd: endDate ? new Date(endDate).toISOString() : null,
      daysLeft,
      isExpired,
      discount: discountCode
        ? { code: discountCode, percent: discountPercent, finalRenewAmount: renewFinalAmount }
        : { code: null, percent: null, finalRenewAmount: renewFinalAmount },
      renewFinalAmount,
      upgrades,
    });
  } catch (e) {
    console.error("[renew/info] failed:", e);
    return Response.json({ error: "خطا در دریافت اطلاعات تمدید." }, { status: 500 });
  }
}
