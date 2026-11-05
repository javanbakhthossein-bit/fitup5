import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";

/**
 * ─── v247 — خلاصهٔ مالی «مالی و تراکنش‌ها» (کارت‌های گزارش بالای صفحه) ───
 *
 * با یک نگاه: چند کاربر خرید کرده‌اند، چند خرید موفق ثبت شده، درآمد کل،
 * میانگین ارزش سفارش، نرخ موفقیت و تفکیک تعداد خرید هر پلن.
 *
 * فیلترها (هماهنگ با جدول تراکنش‌ها):
 *  • from/to    — بازهٔ تاریخ (ISO) روی createdAt پرداخت‌ها
 *  • source     — منبع ورود پرداخت: instagram | app_android | web | unknown
 *  • method     — gateway | bazaar | wallet (فقط پرداخت‌ها؛ تراکنش کیف حساب نمی‌شود)
 *  • search     — نام/موبایل کاربر
 *
 * خروجی فقط از رکوردهای Payment می‌آید (پرداخت‌های واقعی) تا اعداد «خرید»
 * با تراکنش‌های کیف پول قاطی نشود — مطابق منطق گزارش‌های مالک.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewFinance");
    const { searchParams } = new URL(req.url);

    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const source = searchParams.get("source") || "";
    const method = searchParams.get("method") || "";
    const search = searchParams.get("search") || "";

    const sourceValid = source && ["instagram", "app_android", "web", "unknown"].includes(source);
    const methodValid = method && ["gateway", "bazaar", "wallet"].includes(method);

    const where: any = {};
    // بازهٔ تاریخ
    const fromTs = from ? new Date(from) : null;
    const toTs = to ? new Date(to) : null;
    if (fromTs && !isNaN(fromTs.getTime()) && toTs && !isNaN(toTs.getTime())) {
      where.createdAt = { gte: fromTs, lte: toTs };
    } else if (fromTs && !isNaN(fromTs.getTime())) {
      where.createdAt = { gte: fromTs };
    } else if (toTs && !isNaN(toTs.getTime())) {
      where.createdAt = { lte: toTs };
    }
    // منبع ورود (فیلد source روی Payment — v171)
    if (sourceValid) {
      // «unknown» یعنی بدون مقدار یا null (تراکنش‌های قدیمی)
      if (source === "unknown") {
        where.OR = [{ source: null }, { source: "unknown" }];
      } else {
        where.source = source;
      }
    }
    // روش پرداخت
    if (methodValid) where.paymentMethod = method;
    // جستجوی کاربر
    if (search.trim()) {
      const users = await db.user.findMany({
        where: { OR: [{ mobile: { contains: search } }, { name: { contains: search } }] },
        select: { id: true },
      });
      where.userId = { in: users.map((u) => u.id) };
    }

    const [total, successCount, successAgg, planGroups, buyerGroups] = await Promise.all([
      db.payment.count({ where }),
      db.payment.count({ where: { ...where, status: "success" } }),
      db.payment.aggregate({
        where: { ...where, status: "success" },
        _sum: { amount: true },
        _avg: { amount: true },
      }),
      db.payment.groupBy({
        by: ["plan"],
        where: { ...where, status: "success" },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      // خریدار یکتا — تعداد userIdهای متمایز با خرید موفق (groupBy on userId + count)
      db.payment.groupBy({
        by: ["userId"],
        where: { ...where, status: "success" },
        _count: { _all: true },
      }),
    ]);

    const uniqueBuyers = buyerGroups.length;
    const successRevenue = successAgg._sum.amount || 0;
    const avgOrder = successAgg._avg.amount ? Math.round(successAgg._avg.amount) : 0;
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

    const plans: Record<string, { count: number; revenue: number }> = {};
    for (const g of planGroups) {
      const key = g.plan || "بدون پلن";
      plans[key] = { count: g._count._all, revenue: g._sum.amount || 0 };
    }

    // خریدهای تکراری (کاربرانی که بیش از یک خرید موفق در بازه دارند) — نشان‌دهندهٔ تمدید
    const repeatBuyers = buyerGroups.filter((b) => b._count._all > 1).length;

    return Response.json({
      ok: true,
      total,
      successCount,
      successRevenue,
      avgOrder,
      successRate,
      uniqueBuyers,
      repeatBuyers,
      plans,
    });
  } catch (e) {
    return apiError(e);
  }
}
