import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { ensureRenewalDiscountCode } from "@/lib/fitness/notifications";

/**
 * GET /api/user-discount-code
 * Returns the current active (non-used, non-expired) renewal discount code for the logged-in user.
 *
 * Flags returned:
 *  - daysLeft:        Days until subscription expires. Negative if already expired.
 *  - expiresSoon:     true when 0 <= daysLeft <= 5 (subscription about to expire).
 *  - isExpired:       true when daysLeft < 0 AND user has a current plan AND
 *                     expiry happened within the last 90 days (so we don't bug long-expired users).
 *  - expiredDaysAgo:  How many days since the subscription expired (null if not expired).
 *
 * A renewal discount code is auto-generated for the user when EITHER:
 *  - the plan is expiring soon (within 5 days), OR
 *  - the plan is already expired (within the last 90 days).
 *
 * Response shape:
 *   { code, value, type, validUntil, isUsed, expiresSoon, isExpired, expiredDaysAgo, daysLeft, subEndDate, currentPlanId }
 */
export async function GET() {
  try {
    const user = await requireAuth();

    const now = new Date();
    const subEnd = user.planExpiresAt ?? null;
    const daysLeft = subEnd
      ? Math.ceil((subEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const expiresSoon = daysLeft != null && daysLeft >= 0 && daysLeft <= 5;

    // Expired-flag: only true when the user actually had a plan, it has expired,
    // AND the expiry happened within the last 90 days (avoid nagging users who expired long ago).
    const currentPlanId = user.planName ?? null;
    let expiredDaysAgo: number | null = null;
    if (subEnd && daysLeft != null && daysLeft < 0) {
      expiredDaysAgo = Math.abs(daysLeft);
    }
    const isExpired =
      !!currentPlanId &&
      expiredDaysAgo != null &&
      expiredDaysAgo <= 90;

    // Look for an existing active renewal code
    let code = await db.userDiscountCode.findFirst({
      where: {
        userId: user.id,
        isUsed: false,
        reason: "renewal_loyalty",
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });

    // Auto-generate a code if the user's plan is expiring soon OR already expired (within 90 days)
    // and they don't yet have an active renewal code.
    if (!code && (expiresSoon || isExpired)) {
      const generated = await ensureRenewalDiscountCode(user.id, 15, 14);
      if (generated) {
        code = await db.userDiscountCode.findFirst({
          where: { userId: user.id, code: generated.code },
        });
      }
    }

    return Response.json({
      code: code?.code ?? null,
      value: code?.value ?? 0,
      type: code?.type ?? "percent",
      validUntil: code?.validUntil?.toISOString() ?? null,
      isUsed: code?.isUsed ?? false,
      expiresSoon,
      isExpired,
      expiredDaysAgo,
      daysLeft: daysLeft ?? 0,
      subEndDate: subEnd?.toISOString() ?? null,
      currentPlanId,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/user-discount-code
 * Manually trigger creation of a renewal discount code (admin/debug tool).
 * Body: { percent?: number, validForDays?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const percent = Math.max(5, Math.min(50, Number(body?.percent ?? 15)));
    const validForDays = Math.max(1, Math.min(60, Number(body?.validForDays ?? 14)));

    const generated = await ensureRenewalDiscountCode(user.id, percent, validForDays);
    if (!generated) {
      return Response.json({ error: "ساخت کد تخفیف ناموفق بود." }, { status: 500 });
    }
    return Response.json({ ok: true, ...generated });
  } catch (e) {
    return apiError(e);
  }
}
