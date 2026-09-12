import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import * as XLSX from "xlsx";
import {
  computePaymentKpis,
  computeWalletTotals,
  previousRange,
  ACCOUNTING_PLANS,
  ACCOUNTING_METHODS,
  ACCOUNTING_STATUSES,
  ACCOUNTING_PLAN_LABELS,
  ACCOUNTING_METHOD_LABELS,
  ACCOUNTING_STATUS_LABELS,
} from "@/lib/fitness/accounting";

/**
 * GET /api/admin/accounting/export?from=ISO&to=ISO&plan=&method=&status=
 *
 * خروجی اکسل حسابداری — سه شیت:
 *  ۱. «خلاصه»: KPIهای بازه (ناخالص/خالص/AOV/نرخ تبدیل/کیف پول/...) + مقایسه با بازهٔ قبلی
 *  ۲. «تراکنش‌ها»: پرداخت‌های فیلترشده (تا ۱۰,۰۰۰ ردیف) با همهٔ ستون‌ها
 *  ۳. «کیف پول»: تراکنش‌های کیف پول همان بازه
 *
 * فیلترها مثل overview: plan/method روی همه، status فقط روی ردیف‌های تراکنش.
 * Admin-only (requireAdmin) — مثل بقیهٔ routeهای حسابداری.
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

    const txnWhere: any = {
      createdAt: { gte: from, lte: to },
      ...(planFilter ? { plan: planFilter } : {}),
      ...(methodFilter ? { paymentMethod: methodFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const [payments, walletTxns, prevRows] = await Promise.all([
      db.payment.findMany({
        where: txnWhere,
        orderBy: { createdAt: "desc" },
        take: 10000,
        include: { user: { select: { name: true, mobile: true } } },
      }),
      db.walletTransaction.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        take: 10000,
        include: { user: { select: { name: true, mobile: true } } },
      }),
      db.payment.findMany({
        where: {
          createdAt: { gte: previousRange(from, to).from, lt: previousRange(from, to).to },
          ...(planFilter ? { plan: planFilter } : {}),
          ...(methodFilter ? { paymentMethod: methodFilter } : {}),
        },
        select: {
          amount: true,
          originalAmount: true,
          plan: true,
          paymentMethod: true,
          status: true,
          userId: true,
          discountCode: true,
          fee: true,
          createdAt: true,
        },
      }),
    ]);

    const kpis = computePaymentKpis(payments);
    const prevKpis = computePaymentKpis(prevRows);
    const wallet = computeWalletTotals(walletTxns);

    const fmtDate = (d: Date) => new Date(d).toLocaleString("fa-IR");
    const rangeText = `${fmtDate(from)} تا ${fmtDate(to)}`;

    // ─── شیت ۱: خلاصه (KPI + مقایسه با بازهٔ قبلی هم‌طول) ───
    const summaryRows: (string | number)[][] = [
      ["شاخص", "مقدار", "بازهٔ قبلی (هم‌طول)", "تغییر مطلق"],
      ["بازه گزارش", rangeText, "", ""],
      [
        "فیلترها",
        [
          planFilter ? `پلن: ${ACCOUNTING_PLAN_LABELS[planFilter] || planFilter}` : "",
          methodFilter ? `روش: ${ACCOUNTING_METHOD_LABELS[methodFilter] || methodFilter}` : "",
          statusFilter ? `وضعیت: ${ACCOUNTING_STATUS_LABELS[statusFilter] || statusFilter}` : "",
        ]
          .filter(Boolean)
          .join(" | ") || "بدون فیلتر",
        "",
        "",
      ],
      ["درآمد ناخالص (تومان)", kpis.grossRevenue, prevKpis.grossRevenue, kpis.grossRevenue - prevKpis.grossRevenue],
      ["درآمد خالص — منهای مستردشده (تومان)", kpis.netRevenue, prevKpis.netRevenue, kpis.netRevenue - prevKpis.netRevenue],
      ["تعداد تراکنش موفق", kpis.successCount, prevKpis.successCount, kpis.successCount - prevKpis.successCount],
      ["کل تلاش‌های پرداخت", kpis.attempts, prevKpis.attempts, kpis.attempts - prevKpis.attempts],
      ["میانگین سبد خرید — AOV (تومان)", kpis.avgOrderValue, prevKpis.avgOrderValue, kpis.avgOrderValue - prevKpis.avgOrderValue],
      ["پرداخت‌کنندهٔ یکتا", kpis.uniquePayers, prevKpis.uniquePayers, kpis.uniquePayers - prevKpis.uniquePayers],
      [
        "نرخ تبدیل (٪)",
        kpis.conversionRate,
        prevKpis.conversionRate,
        Math.round((kpis.conversionRate - prevKpis.conversionRate) * 10) / 10,
      ],
      ["مستردشده — مبلغ (تومان)", kpis.refundAmount, prevKpis.refundAmount, kpis.refundAmount - prevKpis.refundAmount],
      ["مستردشده — تعداد", kpis.refundCount, prevKpis.refundCount, kpis.refundCount - prevKpis.refundCount],
      ["کل تخفیف داده‌شده (تومان)", kpis.discountTotal, prevKpis.discountTotal, kpis.discountTotal - prevKpis.discountTotal],
      ["کارمزد درگاه (تومان)", kpis.feeTotal, prevKpis.feeTotal, kpis.feeTotal - prevKpis.feeTotal],
      ["شارژ کیف پول (تومان)", wallet.deposits, "", ""],
      ["مصرف کیف پول (تومان)", wallet.spent, "", ""],
      ["پاداش کیف پول (تومان)", wallet.bonus, "", ""],
      ["بازگشت به کیف پول (تومان)", wallet.refunds, "", ""],
      [],
      ["سهم پلن‌ها", "درآمد (تومان)", "تعداد", ""],
      ...kpis.planMix.map((p) => [ACCOUNTING_PLAN_LABELS[p.plan] || p.plan, p.revenue, p.count, ""] as (string | number)[]),
      [],
      ["روش پرداخت", "کل تلاش", "موفق", "درآمد موفق (تومان)"],
      ...kpis.methodBreakdown.map((m) => [
        ACCOUNTING_METHOD_LABELS[m.method] || m.method,
        m.count,
        m.successCount,
        m.amount,
      ] as (string | number)[]),
      [],
      ["وضعیت تراکنش‌ها", "تعداد", "مبلغ (تومان)", ""],
      ...kpis.statusBreakdown.map((s) => [ACCOUNTING_STATUS_LABELS[s.status] || s.status, s.count, s.amount, ""] as (string | number)[]),
      [],
      ["کدهای تخفیف پرمصرف", "تعداد استفاده", "کل تخفیف (تومان)", ""],
      ...kpis.topDiscounts.map((d) => [d.code, d.count, d.totalDiscount, ""] as (string | number)[]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws1["!cols"] = [{ wch: 36 }, { wch: 22 }, { wch: 22 }, { wch: 16 }];
    ws1["!views"] = [{ RTL: true }];

    // ─── شیت ۲: تراکنش‌ها ───
    const txnRows = payments.map((p, i) => ({
      "ردیف": i + 1,
      "کاربر": p.user?.name || "",
      "موبایل": p.user?.mobile || "",
      "مبلغ نهایی (تومان)": p.amount,
      "مبلغ اصلی (تومان)": p.originalAmount,
      "تخفیف (تومان)": Math.max(0, (p.originalAmount || 0) - p.amount),
      "پلن": ACCOUNTING_PLAN_LABELS[p.plan] || p.plan,
      "روش پرداخت": ACCOUNTING_METHOD_LABELS[p.paymentMethod] || p.paymentMethod,
      "وضعیت": ACCOUNTING_STATUS_LABELS[p.status] || p.status,
      "کد تخفیف": p.discountCode || "",
      "کد پیگیری": p.refId || "",
      "Authority": p.authority || "",
      "کارمزد (تومان)": p.fee ?? "",
      "شماره کارت": p.cardPan || "",
      "توضیحات": p.description || "",
      "تاریخ ثبت": fmtDate(p.createdAt),
      "تاریخ تأیید": p.verifiedAt ? fmtDate(p.verifiedAt) : "",
    }));
    const ws2 = XLSX.utils.json_to_sheet(txnRows);
    ws2["!cols"] = [
      { wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
      { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 24 },
      { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 20 }, { wch: 20 },
    ];
    ws2["!views"] = [{ RTL: true }];

    // ─── شیت ۳: کیف پول ───
    const walletRowsSheet = walletTxns.map((t, i) => ({
      "ردیف": i + 1,
      "کاربر": t.user?.name || "",
      "موبایل": t.user?.mobile || "",
      "نوع": t.type === "deposit" ? "شارژ" : t.type === "purchase" ? "خرید" : t.type === "refund" ? "بازگشت" : t.type === "bonus" ? "پاداش" : t.type,
      "مبلغ (تومان)": t.amount,
      "موجودی پس از تراکنش": t.balance,
      "توضیحات": t.description || "",
      "مرجع": t.refId || "",
      "تاریخ": fmtDate(t.createdAt),
    }));
    const ws3 = XLSX.utils.json_to_sheet(walletRowsSheet);
    ws3["!cols"] = [
      { wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 20 }, { wch: 34 }, { wch: 18 }, { wch: 20 },
    ];
    ws3["!views"] = [{ RTL: true }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "خلاصه");
    XLSX.utils.book_append_sheet(wb, ws2, "تراکنش‌ها");
    XLSX.utils.book_append_sheet(wb, ws3, "کیف پول");
    if (!wb.Props) wb.Props = {};
    (wb.Props as { Creator?: string }).Creator = "فیتاپ";

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `fitap-accounting-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
