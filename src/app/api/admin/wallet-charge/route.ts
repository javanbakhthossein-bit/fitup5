import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError, buildUserDto } from "@/lib/fitness/auth";
import { toPersianDigits } from "@/lib/fitness/types";

// شارژ دستی کیف پول کاربر توسط ادمین
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { userId, amount, description } = await req.json();

    if (!userId || !amount || amount <= 0 || amount > 100000000) {
      return Response.json({ error: "مبلغ نامعتبر است." }, { status: 400 });
    }

    const freshUser = await db.user.findUnique({ where: { id: userId } });
    if (!freshUser) {
      return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
    }

    const newBalance = (freshUser.walletBalance || 0) + amount;

    const [updatedUser, txn] = await Promise.all([
      db.user.update({
        where: { id: userId },
        data: { walletBalance: newBalance },
      }),
      db.walletTransaction.create({
        data: {
          userId,
          type: "deposit",
          amount,
          balance: newBalance,
          description: description || `شارژ دستی توسط ادمین — ${toPersianDigits(amount.toLocaleString("en-US"))} تومان`,
        },
      }),
    ]);

    const dto = await buildUserDto(userId);

    return Response.json({
      ok: true,
      newBalance: updatedUser.walletBalance,
      transaction: {
        id: txn.id,
        type: txn.type,
        amount: txn.amount,
        balance: txn.balance,
        description: txn.description,
        createdAt: txn.createdAt.toISOString(),
      },
      user: dto,
    });
  } catch (e) {
    return apiError(e);
  }
}
