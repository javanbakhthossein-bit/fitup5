import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || 1);
    const pageSize = Number(searchParams.get("pageSize") || 20);
    const status = searchParams.get("status") || "";
    const search = searchParams.get("search") || "";

    const where: any = {};
    if (status && ["pending", "success", "failed", "cancelled", "refunded"].includes(status)) {
      where.status = status;
    }

    // For search by user mobile/name, we need to join
    let userIds: string[] | undefined;
    if (search) {
      const users = await db.user.findMany({
        where: { OR: [{ mobile: { contains: search } }, { name: { contains: search } }] },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
      where.userId = { in: userIds };
    }

    const [total, payments, walletTxns] = await Promise.all([
      db.payment.count({ where }),
      db.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { name: true, mobile: true } } },
      }),
      // Also get wallet transactions if searching or no status filter
      (!status || status === "all")
        ? db.walletTransaction.findMany({
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: { user: { select: { name: true, mobile: true } } },
          })
        : Promise.resolve([]),
    ]);

    // Combine and format
    const transactions = [
      ...payments.map((p) => ({
        id: p.id,
        type: "payment" as const,
        userId: p.userId,
        userName: p.user?.name || "",
        userMobile: p.user?.mobile || "",
        amount: p.amount,
        originalAmount: p.originalAmount,
        plan: p.plan,
        paymentMethod: p.paymentMethod,
        status: p.status,
        refId: p.refId,
        authority: p.authority,
        cardPan: p.cardPan || null,
        cardHash: p.cardHash || null,
        fee: p.fee ?? null,
        discountCode: p.discountCode,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() || null,
      })),
      ...walletTxns.map((t) => ({
        id: t.id,
        type: "wallet" as const,
        userId: t.userId,
        userName: t.user?.name || "",
        userMobile: t.user?.mobile || "",
        amount: t.amount,
        originalAmount: 0,
        plan: "",
        paymentMethod: "wallet",
        status: "success",
        refId: t.refId || "",
        discountCode: "",
        description: t.description,
        createdAt: t.createdAt.toISOString(),
        verifiedAt: null,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return Response.json({
      transactions: transactions.slice(0, pageSize),
      total: total + (walletTxns?.length || 0),
      page,
      pageSize,
      totalPages: Math.ceil((total + (walletTxns?.length || 0)) / pageSize),
    });
  } catch (e) {
    return apiError(e);
  }
}
