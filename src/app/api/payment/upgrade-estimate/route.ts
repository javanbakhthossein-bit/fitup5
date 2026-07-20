import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { getActivePlan } from "@/lib/fitness/pricing";
import type { Plan } from "@/lib/fitness/types";

/**
 * GET /api/payment/upgrade-estimate?planId=X
 *
 * برآورد اعتبار ارتقا برای یک پلن خاص.
 * اگر کاربر اشتراک فعال با پلن متفاوت دارد، اعتبار باقی‌مانده را محاسبه می‌کند.
 *
 * فرمول: upgradeCredit = (pricePaid / durationDays) × daysLeft
 *
 * پاسخ:
 *   { isUpgrade, upgradeCredit, daysLeft, currentPlan, finalAmount, originalAmount }
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const planId = req.nextUrl.searchParams.get("planId") as Plan | null;
    if (!planId) {
      return Response.json({ error: "planId الزامی است." }, { status: 400 });
    }

    const plan = await getActivePlan(planId);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    const now = new Date();
    const activeSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "active", endDate: { gt: now } },
      orderBy: { endDate: "desc" },
    });

    // اگر اشتراک فعال ندارد یا همان پلن را دارد → ارتقا نیست
    if (!activeSub || activeSub.plan === plan.id) {
      return Response.json({
        isUpgrade: false,
        upgradeCredit: 0,
        daysLeft: 0,
        currentPlan: activeSub?.plan ?? null,
        originalAmount: plan.price,
        finalAmount: plan.price,
      });
    }

    const oldPlan = await getActivePlan(activeSub.plan as Plan);
    if (!oldPlan) {
      return Response.json({
        isUpgrade: false,
        upgradeCredit: 0,
        daysLeft: 0,
        currentPlan: activeSub.plan,
        originalAmount: plan.price,
        finalAmount: plan.price,
      });
    }

    const daysLeft = Math.ceil((activeSub.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let upgradeCredit = 0;
    if (daysLeft > 0) {
      upgradeCredit = Math.round((activeSub.pricePaid / activeSub.durationDays) * daysLeft);
    }

    const finalAmount = Math.max(0, plan.price - upgradeCredit);

    return Response.json({
      isUpgrade: true,
      upgradeCredit,
      daysLeft,
      currentPlan: activeSub.plan,
      currentPlanEndDate: activeSub.endDate.toISOString(),
      originalAmount: plan.price,
      finalAmount,
    });
  } catch (e) {
    return apiError(e);
  }
}
