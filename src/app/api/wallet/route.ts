import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError, buildUserDto } from "@/lib/fitness/auth";
import { toPersianDigits } from "@/lib/fitness/types";

// دریافت موجودی و تاریخچه کیف پول
export async function GET() {
  try {
    const user = await requireAuth();
    const [freshUser, transactions] = await Promise.all([
      db.user.findUnique({ where: { id: user.id } }),
      db.walletTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return Response.json({
      balance: freshUser?.walletBalance ?? 0,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balance: t.balance,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// شارژ کیف پول (شبیه‌سازی پرداخت موفق)
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { amount } = (await req.json()) as { amount: number };
    if (!amount || amount < 10000 || amount > 10000000) {
      return Response.json(
        { error: "مبلغ شارژ باید بین ۱۰,۰۰۰ و ۱۰,۰۰۰,۰۰۰ تومان باشد." },
        { status: 400 }
      );
    }

    const freshUser = await db.user.findUnique({ where: { id: user.id } });
    const currentBalance = freshUser?.walletBalance ?? 0;
    const newBalance = currentBalance + amount;

    const [updatedUser, txn] = await Promise.all([
      db.user.update({
        where: { id: user.id },
        data: { walletBalance: newBalance },
      }),
      db.walletTransaction.create({
        data: {
          userId: user.id,
          type: "deposit",
          amount,
          balance: newBalance,
          description: `شارژ کیف پول — ${toPersianDigits(amount.toLocaleString("en-US"))} تومان`,
        },
      }),
    ]);

    const dto = await buildUserDto(user.id);
    return Response.json({
      balance: updatedUser.walletBalance,
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
