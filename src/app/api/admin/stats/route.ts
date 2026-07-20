import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

export async function GET() {
  try {
    await requireAdmin();
    const now = new Date();

    const [
      totalUsers,
      activeSubscriptions,
      totalRevenue,
      totalPayments,
      blockedUsers,
      onboardingDone,
      exercises,
      foods,
      usersWithPlan,
    ] = await Promise.all([
      db.user.count(),
      db.subscription.count({ where: { status: "active", endDate: { gt: now } } }),
      db.payment.aggregate({ where: { status: "success" }, _sum: { amount: true } }),
      db.payment.count({ where: { status: "success" } }),
      db.user.count({ where: { isBlocked: true } }),
      db.user.count({ where: { onboardingDone: true } }),
      db.exerciseLibrary.count(),
      db.foodLibrary.count(),
      db.user.count({ where: { planName: { not: null } } }),
    ]);

    // نرخ تبدیل: کاربرانی که پلن فعال دارند / کل کاربران
    const conversionRate = totalUsers > 0 ? Math.round((usersWithPlan / totalUsers) * 100) : 0;

    // درآمد بر اساس پلن
    const revenueByPlan = await db.payment.groupBy({
      by: ["plan"],
      where: { status: "success" },
      _sum: { amount: true },
      _count: true,
    });

    // توزیع کاربران در پلن‌ها
    const planDistribution = await db.user.groupBy({
      by: ["planName"],
      where: { planName: { not: null } },
      _count: true,
    });

    // روند رشد کاربران (۶ ماه گذشته)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const allUsers = await db.user.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const monthNames = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

    // ─── تبدیل ماه میلادی به شمسی ───
    // JavaScript getMonth() میلادی برمی‌گرداند (۰=ژانویه)
    // ما باید با Intl.DateTimeFormat شمسی را محاسبه کنیم
    function getJalaliMonthIndex(date: Date): number {
      try {
        const formatter = new Intl.DateTimeFormat("en-u-ca-persian", { month: "numeric" });
        const monthStr = formatter.format(date);
        return parseInt(monthStr, 10) - 1; // 0-based
      } catch {
        // fallback: تقریبی (۵ ماه اختلاف)
        return (date.getMonth() + 3) % 12;
      }
    }

    const userGrowth: { month: string; users: number; total: number }[] = [];
    let cumulative = totalUsers - allUsers.length;
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      const nextD = new Date(d);
      nextD.setMonth(nextD.getMonth() + 1);
      const monthUsers = allUsers.filter((u) => u.createdAt >= d && u.createdAt < nextD).length;
      cumulative += monthUsers;
      const jalaliMonth = getJalaliMonthIndex(d);
      userGrowth.push({ month: monthNames[jalaliMonth], users: monthUsers, total: cumulative });
    }

    // درآمد ۶ ماه گذشته
    const allPayments = await db.payment.findMany({
      where: { status: "success", createdAt: { gte: sixMonthsAgo } },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const revenueGrowth: { month: string; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      const nextD = new Date(d);
      nextD.setMonth(nextD.getMonth() + 1);
      const monthRev = allPayments.filter((p) => p.createdAt >= d && p.createdAt < nextD).reduce((s, p) => s + p.amount, 0);
      const jalaliMonth = getJalaliMonthIndex(d);
      revenueGrowth.push({ month: monthNames[jalaliMonth], revenue: monthRev });
    }

    // تعداد برنامه‌های در انتظار
    const pendingPrograms = await db.programRequest.count({ where: { status: "pending" } });
    const readyPrograms = await db.programRequest.count({ where: { status: "ready" } });

    // کاربران اخیر
    const recentUsers = await db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, mobile: true, name: true, onboardingDone: true, isBlocked: true, createdAt: true, planName: true },
    });

    return Response.json({
      stats: {
        totalUsers,
        activeSubscriptions,
        totalRevenue: totalRevenue._sum.amount || 0,
        totalPayments,
        blockedUsers,
        onboardingDone,
        exercises,
        foods,
        conversionRate,
        usersWithPlan,
        pendingPrograms,
        readyPrograms,
      },
      revenueByPlan,
      planDistribution,
      userGrowth,
      revenueGrowth,
      recentUsers: recentUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    });
  } catch (e) {
    return apiError(e);
  }
}
