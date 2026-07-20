import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("pageSize") || 15)));
    const role = searchParams.get("role") || "";
    const plan = searchParams.get("plan") || "";
    const onboarding = searchParams.get("onboarding") || ""; // "done" | "pending" | ""
    const now = new Date();

    const where: any = {};
    if (search) {
      where.OR = [{ mobile: { contains: search } }, { name: { contains: search } }];
    }
    if (role && role !== "all") {
      where.role = role;
    }
    if (plan && plan !== "all") {
      if (plan === "none") {
        where.planName = null;
      } else {
        where.planName = plan;
      }
    }
    if (onboarding === "done") where.onboardingDone = true;
    if (onboarding === "pending") where.onboardingDone = false;

    const [total, users] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          mobile: true,
          name: true,
          role: true,
          isBlocked: true,
          onboardingDone: true,
          createdAt: true,
          planName: true,
          walletBalance: true,
          planExpiresAt: true,
        },
      }),
    ]);

    // Attach active subscription info
    const userIds = users.map((u) => u.id);
    const subs = await db.subscription.findMany({
      where: { userId: { in: userIds }, status: "active", endDate: { gt: now } },
    });
    const subMap = new Map(subs.map((s) => [s.userId, s]));

    return Response.json({
      total,
      page,
      pageSize,
      users: users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        planExpiresAt: u.planExpiresAt?.toISOString() ?? null,
        hasActiveSubscription: subMap.has(u.id),
        subscriptionEnd: subMap.get(u.id)?.endDate.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

// Block / unblock / delete user
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { userId, action } = await req.json();
    if (userId === admin.id) {
      return Response.json({ error: "نمی‌توانید حساب خود را تغییر دهید." }, { status: 400 });
    }
    if (action === "block") {
      await db.user.update({ where: { id: userId }, data: { isBlocked: true } });
    } else if (action === "unblock") {
      await db.user.update({ where: { id: userId }, data: { isBlocked: false } });
    } else if (action === "makeAdmin") {
      await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    } else if (action === "makeUser") {
      await db.user.update({ where: { id: userId }, data: { role: "USER" } });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("id");
    if (!userId) return Response.json({ error: "ID نیاز است." }, { status: 400 });
    if (userId === admin.id) {
      return Response.json({ error: "نمی‌توانید خود را حذف کنید." }, { status: 400 });
    }
    await db.user.delete({ where: { id: userId } });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
