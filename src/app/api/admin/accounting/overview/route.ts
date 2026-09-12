import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import {
  computePaymentKpis,
  computeWalletTotals,
  buildDailyBuckets,
  previousRange,
  pctChange,
  ACCOUNTING_PLANS,
  ACCOUNTING_METHODS,
  ACCOUNTING_STATUSES,
  FAILED_STATUSES,
  ACCOUNTING_PLAN_LABELS,
  ACCOUNTING_METHOD_LABELS,
  ACCOUNTING_STATUS_LABELS,
} from "@/lib/fitness/accounting";
import { computeCostsForRange } from "@/lib/fitness/costs";

/**
 * GET /api/admin/accounting/overview?from=ISO&to=ISO&plan=&method=&status=
 *
 * آمار کامل یک بازه زمانی برای «حسابداری مدیریت»:
 *  - stats (شکل قدیمی سازگار): totalRevenue, totalPayments, totalUsers, activeSubscriptions, avgTicket
 *  - kpis: ناخالص/خالص، تعداد موفق، AOV، پرداخت‌کنندهٔ یکتا، نرخ تبدیل، ریفاند، تخفیف، کارمزد
 *  - trends: مقایسهٔ هر KPI با بازهٔ قبلیِ هم‌طول (مطلق + درصد)
 *  - wallet: شارژ/مصرف/پاداش/بازگشت کیف پول + روند
 *  - revenueByPlan (با سهم درصدی)، revenueDaily (نمودار روزانه)
 *  - methodBreakdown / statusBreakdown / topDiscounts / failedRecent
 *  - recentPayments / recentUsers (شکل قدیمی)
 *  - v52: costs (هزینهٔ پیامک + هوش مصنوعی + کارمزد درگاه + سود خالص نهایی)
 *    و breakdowns (ریز پیامک بر اساس سناریو / ریز AI بر اساس مدل)
 *
 * فیلترها: plan و method روی همهٔ متریک‌های پرداخت اعمال می‌شود؛
 * status فقط روی فهرست «پرداخت‌های ناموفق اخیر» (و export) اعمال می‌شود.
 * اگر from/to ارسال نشود، بازه پیش‌فرض ۳۰ روز گذشته است.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const to = toParam ? new Date(toParam) : now;
    if (isNaN(to.getTime())) return Response.json({ error: "تاریخ پایان نامعتبر است." }, { status: 400 });

    const from = fromParam
      ? new Date(fromParam)
      : new Date(new Date(to).setDate(to.getDate() - 29));
    if (isNaN(from.getTime())) return Response.json({ error: "تاریخ شروع نامعتبر است." }, { status: 400 });
    if (from > to) return Response.json({ error: "تاریخ شروع باید قبل از پایان باشد." }, { status: 400 });

    const plan = searchParams.get("plan") || "";
    const method = searchParams.get("method") || "";
    const status = searchParams.get("status") || "";
    const planFilter = (ACCOUNTING_PLANS as readonly string[]).includes(plan) ? plan : "";
    const methodFilter = (ACCOUNTING_METHODS as readonly string[]).includes(method) ? method : "";
    const statusFilter = (ACCOUNTING_STATUSES as readonly string[]).includes(status) ? status : "";

    const rangeWhere = {
      createdAt: { gte: from, lte: to },
      ...(planFilter ? { plan: planFilter } : {}),
      ...(methodFilter ? { paymentMethod: methodFilter } : {}),
    };

    const prev = previousRange(from, to);

    const lightSelect = {
      amount: true,
      originalAmount: true,
      plan: true,
      paymentMethod: true,
      status: true,
      userId: true,
      discountCode: true,
      fee: true,
      createdAt: true,
    } as const;

    const [rows, prevRows, walletRows, prevWalletRows, failedRecent, recentPayments, recentUsers, totalUsers, activeSubscriptions] =
      await Promise.all([
        db.payment.findMany({ where: rangeWhere, select: lightSelect }),
        db.payment.findMany({
          where: { ...rangeWhere, createdAt: { gte: prev.from, lt: prev.to } },
          select: lightSelect,
        }),
        db.walletTransaction.findMany({
          where: { createdAt: { gte: from, lte: to } },
          select: { type: true, amount: true },
        }),
        db.walletTransaction.findMany({
          where: { createdAt: { gte: prev.from, lt: prev.to } },
          select: { type: true, amount: true },
        }),
        db.payment.findMany({
          where: {
            createdAt: { gte: from, lte: to },
            ...(statusFilter ? { status: statusFilter } : { status: { in: [...FAILED_STATUSES] } }),
            ...(planFilter ? { plan: planFilter } : {}),
            ...(methodFilter ? { paymentMethod: methodFilter } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { user: { select: { name: true, mobile: true } } },
        }),
        db.payment.findMany({
          where: { ...rangeWhere, status: "success" },
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { user: { select: { name: true, mobile: true } } },
        }),
        db.user.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            name: true,
            mobile: true,
            createdAt: true,
            planName: true,
            onboardingDone: true,
          },
        }),
        db.user.count({ where: { createdAt: { gte: from, lte: to } } }),
        db.subscription.count({ where: { status: "active", endDate: { gt: now } } }),
      ]);

    // ─── KPIها (فعلی + قبلی) ───
    const kpis = computePaymentKpis(rows);
    const prevKpis = computePaymentKpis(prevRows);

    const trends = {
      grossRevenue: { absolute: kpis.grossRevenue - prevKpis.grossRevenue, pct: pctChange(prevKpis.grossRevenue, kpis.grossRevenue) },
      netRevenue: { absolute: kpis.netRevenue - prevKpis.netRevenue, pct: pctChange(prevKpis.netRevenue, kpis.netRevenue) },
      successCount: { absolute: kpis.successCount - prevKpis.successCount, pct: pctChange(prevKpis.successCount, kpis.successCount) },
      avgOrderValue: { absolute: kpis.avgOrderValue - prevKpis.avgOrderValue, pct: pctChange(prevKpis.avgOrderValue, kpis.avgOrderValue) },
      uniquePayers: { absolute: kpis.uniquePayers - prevKpis.uniquePayers, pct: pctChange(prevKpis.uniquePayers, kpis.uniquePayers) },
      conversionRate: {
        absolute: Math.round((kpis.conversionRate - prevKpis.conversionRate) * 10) / 10,
        pct: pctChange(prevKpis.conversionRate, kpis.conversionRate),
      },
      refundAmount: { absolute: kpis.refundAmount - prevKpis.refundAmount, pct: pctChange(prevKpis.refundAmount, kpis.refundAmount) },
      attempts: { absolute: kpis.attempts - prevKpis.attempts, pct: pctChange(prevKpis.attempts, kpis.attempts) },
    };

    // ─── کیف پول (فعلی + قبلی) ───
    const wallet = computeWalletTotals(walletRows);
    const prevWallet = computeWalletTotals(prevWalletRows);
    const walletTrends = {
      deposits: { absolute: wallet.deposits - prevWallet.deposits, pct: pctChange(prevWallet.deposits, wallet.deposits) },
      spent: { absolute: wallet.spent - prevWallet.spent, pct: pctChange(prevWallet.spent, wallet.spent) },
    };

    // ─── نمودار روزانه (فقط موفق‌ها) ───
    const successRows = rows.filter((r) => r.status === "success");
    const revenueDaily = buildDailyBuckets(
      from,
      to,
      successRows.map((r) => ({ amount: r.amount, createdAt: r.createdAt }))
    );

    // ─── سهم پلن‌ها (با درصد) ───
    const totalPlanRevenue = kpis.planMix.reduce((s, p) => s + p.revenue, 0);
    const revenueByPlan = kpis.planMix.map((p) => ({
      plan: p.plan,
      label: ACCOUNTING_PLAN_LABELS[p.plan] || p.plan,
      revenue: p.revenue,
      count: p.count,
      pct: totalPlanRevenue > 0 ? Math.round((p.revenue / totalPlanRevenue) * 1000) / 10 : 0,
    }));

    const methodBreakdown = kpis.methodBreakdown.map((m) => ({
      method: m.method,
      label: ACCOUNTING_METHOD_LABELS[m.method] || m.method,
      count: m.count,
      successCount: m.successCount,
      amount: m.amount,
      pct: kpis.attempts > 0 ? Math.round((m.count / kpis.attempts) * 1000) / 10 : 0,
    }));

    const totalStatusCount = kpis.statusBreakdown.reduce((s, x) => s + x.count, 0);
    const statusBreakdown = kpis.statusBreakdown.map((s) => ({
      status: s.status,
      label: ACCOUNTING_STATUS_LABELS[s.status] || s.status,
      count: s.count,
      amount: s.amount,
      pct: totalStatusCount > 0 ? Math.round((s.count / totalStatusCount) * 1000) / 10 : 0,
    }));

    // ─── v52 حسابداری — هزینه‌ها: پیامک + هوش مصنوعی + کارمزد درگاه + سود خالص نهایی ───
    // کارمزد درگاه همان feeTotal (جمع fee پرداخت‌های موفق بازه) است — دوباره محاسبه نمی‌شود.
    // سود = درآمد خالص (ناخالص − مستردشده) − (پیامک + AI + کارمزد). برآورد پیامک‌های
    // قدیمی‌تر عمداً در سود لحاظ نمی‌شود و فقط به‌عنوان اطلاعات جداگانه نمایش داده می‌شود.
    let costs: Awaited<ReturnType<typeof computeCostsForRange>>["costs"] | undefined;
    let breakdowns: Awaited<ReturnType<typeof computeCostsForRange>>["breakdowns"] | undefined;
    try {
      const cb = await computeCostsForRange(from, to, kpis.netRevenue, kpis.feeTotal);
      costs = cb.costs;
      breakdowns = cb.breakdowns;
    } catch (e) {
      // هزینه‌ها هرگز کل داشبورد حسابداری را نمی‌شکنند
      console.error("[accounting/overview] costs computation failed:", e instanceof Error ? e.message : e);
    }

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString(), prevFrom: prev.from.toISOString(), prevTo: prev.to.toISOString() },
      filters: { plan: planFilter, method: methodFilter, status: statusFilter },
      stats: {
        totalRevenue: kpis.grossRevenue,
        totalPayments: kpis.successCount,
        totalUsers,
        activeSubscriptions,
        avgTicket: kpis.avgOrderValue,
        attempts: kpis.attempts,
        conversionRate: kpis.conversionRate,
      },
      kpis,
      trends,
      costs,
      breakdowns,
      wallet,
      walletTrends,
      revenueByPlan,
      revenueDaily,
      methodBreakdown,
      statusBreakdown,
      topDiscounts: kpis.topDiscounts,
      failedRecent: failedRecent.map((p) => ({
        id: p.id,
        amount: p.amount,
        originalAmount: p.originalAmount,
        plan: p.plan,
        status: p.status,
        statusLabel: ACCOUNTING_STATUS_LABELS[p.status] || p.status,
        description: p.description || "",
        userName: p.user?.name || "",
        userMobile: p.user?.mobile || "",
        createdAt: p.createdAt.toISOString(),
      })),
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        amount: p.amount,
        originalAmount: p.originalAmount,
        plan: p.plan,
        status: p.status,
        refId: p.refId,
        authority: p.authority,
        paymentMethod: p.paymentMethod,
        userName: p.user?.name || "",
        userMobile: p.user?.mobile || "",
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() || null,
      })),
      recentUsers: recentUsers.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
