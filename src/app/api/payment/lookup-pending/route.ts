import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

/**
 * یافتن آخرین پرداخت pending کاربر (برای callback زرین‌پال).
 * در صورت ارسال authority، تطبیق دقیق روی authority انجام می‌شود؛
 * در غیر این صورت، آخرین پرداخت pending کاربر برگردانده می‌شود.
 *
 * این endpoint صرفاً برای پیدا کردن paymentId مناسب برای verify است و
 * خود verify در /api/payment/verify انجام می‌شود.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { authority?: string };

    const where: { userId: string; status: string; authority?: string } = {
      userId: user.id,
      status: "pending",
    };
    if (body.authority && typeof body.authority === "string" && body.authority.trim()) {
      where.authority = body.authority.trim();
    }

    const payment = await db.payment.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        authority: true,
        amount: true,
        plan: true,
        paymentMethod: true,
        createdAt: true,
      },
    });

    if (!payment) {
      return Response.json(
        { error: "پرداخت معلقی یافت نشد.", paymentId: null },
        { status: 404 }
      );
    }

    return Response.json({
      paymentId: payment.id,
      authority: payment.authority,
      amount: payment.amount,
      plan: payment.plan,
      paymentMethod: payment.paymentMethod,
      createdAt: payment.createdAt,
    });
  } catch (e) {
    return apiError(e);
  }
}
