/**
 * ============================================================
 *  حسابداری مدیریت — کتابخانهٔ مشترک (ACCOUNTING-SHARED)
 * ============================================================
 * توابع خالص و ثابت‌های مشترک بین routeهای api/admin/accounting
 * (overview / export / …). بدون هیچ وابستگی به Prisma یا Next —
 * فقط محاسبات خالص روی ردیف‌های پرداخت/کیف پول تا در هر دو سمت
 * (سرور و تست) نتیجهٔ یکسان بدهد.
 */

// ─── ثابت‌ها ───

export const ACCOUNTING_PLANS = ["basic", "standard", "advanced", "ultimate"] as const;

export const ACCOUNTING_METHODS = ["gateway", "wallet", "mixed"] as const;

export const ACCOUNTING_STATUSES = [
  "pending",
  "verifying",
  "success",
  "failed",
  "cancelled",
  "refunded",
  "manual_resolved",
  "expired",
] as const;

/** وضعیت‌هایی که «تلاش ناموفق برای پرداخت» حساب می‌شوند */
export const FAILED_STATUSES = ["failed", "expired", "cancelled"] as const;

export const ACCOUNTING_PLAN_LABELS: Record<string, string> = {
  basic: "اقتصادی",
  standard: "استاندارد",
  advanced: "پیشرفته",
  ultimate: "حرفه‌ای",
};

export const ACCOUNTING_METHOD_LABELS: Record<string, string> = {
  gateway: "درگاه بانکی",
  wallet: "کیف پول",
  mixed: "ترکیبی (کیف پول + درگاه)",
};

export const ACCOUNTING_STATUS_LABELS: Record<string, string> = {
  success: "موفق",
  failed: "ناموفق",
  pending: "در انتظار",
  verifying: "در حال پردازش",
  cancelled: "لغو شده",
  refunded: "مسترد شده",
  manual_resolved: "رسیدگی دستی (قدیمی)",
  expired: "منقضی — پرداخت‌نشده",
};

export const ACCOUNTING_STATUS_CHART_COLORS: Record<string, string> = {
  success: "#10b981",
  failed: "#ef4444",
  pending: "#f59e0b",
  verifying: "#0ea5e9",
  cancelled: "#64748b",
  refunded: "#a855f7",
  manual_resolved: "#94a3b8",
  expired: "#fb7185",
};

export const ACCOUNTING_METHOD_CHART_COLORS: Record<string, string> = {
  gateway: "#06b6d4",
  wallet: "#10b981",
  mixed: "#a855f7",
};

// ─── تایپ‌ها ───

/** ردیف سبک‌شدهٔ پرداخت — خروجی select در route */
export interface AccountingPaymentRow {
  amount: number;
  originalAmount: number;
  plan: string;
  paymentMethod: string;
  status: string;
  userId: string;
  discountCode: string | null;
  fee: number | null;
}

export interface PlanMixItem {
  plan: string;
  revenue: number;
  count: number;
}

export interface MethodBreakdownItem {
  method: string;
  count: number; // کل تلاش‌ها با این روش
  successCount: number;
  amount: number; // جمع مبلغ موفق‌ها
}

export interface StatusBreakdownItem {
  status: string;
  count: number;
  amount: number;
}

export interface TopDiscountItem {
  code: string;
  count: number;
  totalDiscount: number;
}

export interface PaymentKpis {
  attempts: number; // کل تلاش‌های پرداخت در بازه (هر وضعیتی)
  successCount: number;
  grossRevenue: number; // جمع مبلغ پرداخت‌های موفق
  netRevenue: number; // ناخالص منهای مستردشده‌ها
  avgOrderValue: number;
  uniquePayers: number;
  conversionRate: number; // درصد با یک رقم اعشار
  refundAmount: number;
  refundCount: number;
  discountTotal: number; // کل تخفیف داده‌شده روی پرداخت‌های موفق
  feeTotal: number; // کل کارمزد درگاه روی پرداخت‌های موفق
  planMix: PlanMixItem[];
  methodBreakdown: MethodBreakdownItem[];
  statusBreakdown: StatusBreakdownItem[];
  topDiscounts: TopDiscountItem[];
}

export interface WalletTotals {
  deposits: number; // جمع شارژها
  depositCount: number;
  spent: number; // جمع مصرف (خرید با کیف پول) — عدد مثبت
  purchaseCount: number;
  bonus: number;
  refunds: number;
}

// ─── توابع محاسباتی ───

/**
 * محاسبهٔ همهٔ KPIهای پرداخت یک بازه از روی آرایهٔ ردیف‌های سبک.
 * خروجی برای دورهٔ فعلی و دورهٔ قبلی (مقایسه روند) یکسان استفاده می‌شود.
 */
export function computePaymentKpis(rows: AccountingPaymentRow[]): PaymentKpis {
  let grossRevenue = 0;
  let refundAmount = 0;
  let refundCount = 0;
  let discountTotal = 0;
  let feeTotal = 0;
  let successCount = 0;
  const payers = new Set<string>();
  const planMap = new Map<string, { revenue: number; count: number }>();
  const methodMap = new Map<string, { count: number; successCount: number; amount: number }>();
  const statusMap = new Map<string, { count: number; amount: number }>();
  const discountMap = new Map<string, { count: number; totalDiscount: number }>();

  for (const r of rows) {
    const method = methodMap.get(r.paymentMethod) || { count: 0, successCount: 0, amount: 0 };
    method.count += 1;
    methodMap.set(r.paymentMethod, method);

    const st = statusMap.get(r.status) || { count: 0, amount: 0 };
    st.count += 1;
    statusMap.set(r.status, st);

    if (r.status === "refunded") {
      refundAmount += Math.max(0, r.amount);
      refundCount += 1;
    }

    if (r.status !== "success") continue;
    successCount += 1;
    grossRevenue += r.amount;
    if (r.userId) payers.add(r.userId);
    feeTotal += r.fee || 0;

    const pm = planMap.get(r.plan) || { revenue: 0, count: 0 };
    pm.revenue += r.amount;
    pm.count += 1;
    planMap.set(r.plan, pm);

    method.successCount += 1;
    method.amount += r.amount;
    methodMap.set(r.paymentMethod, method);

    if (r.discountCode) {
      const saved = Math.max(0, (r.originalAmount || 0) - r.amount);
      const d = discountMap.get(r.discountCode) || { count: 0, totalDiscount: 0 };
      d.count += 1;
      d.totalDiscount += saved;
      discountMap.set(r.discountCode, d);
      discountTotal += saved;
    }
  }

  const attempts = rows.length;
  const planMix: PlanMixItem[] = [...planMap.entries()]
    .map(([plan, v]) => ({ plan, revenue: v.revenue, count: v.count }))
    .sort((a, b) => b.revenue - a.revenue || b.count - a.count);

  const methodBreakdown: MethodBreakdownItem[] = [...methodMap.entries()]
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.count - a.count);

  const statusBreakdown: StatusBreakdownItem[] = [...statusMap.entries()]
    .map(([status, v]) => ({ status, ...v }))
    .sort((a, b) => b.count - a.count);

  const topDiscounts: TopDiscountItem[] = [...discountMap.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count || b.totalDiscount - a.totalDiscount)
    .slice(0, 8);

  return {
    attempts,
    successCount,
    grossRevenue,
    netRevenue: grossRevenue - refundAmount,
    avgOrderValue: successCount > 0 ? Math.round(grossRevenue / successCount) : 0,
    uniquePayers: payers.size,
    conversionRate: attempts > 0 ? Math.round((successCount / attempts) * 1000) / 10 : 0,
    refundAmount,
    refundCount,
    discountTotal,
    feeTotal,
    planMix,
    methodBreakdown,
    statusBreakdown,
    topDiscounts,
  };
}

/** جمع شارژ/مصرف/پاداش/بازگشت کیف پول از روی ردیف‌های سبک WalletTransaction */
export function computeWalletTotals(rows: { type: string; amount: number }[]): WalletTotals {
  const t: WalletTotals = {
    deposits: 0,
    depositCount: 0,
    spent: 0,
    purchaseCount: 0,
    bonus: 0,
    refunds: 0,
  };
  for (const r of rows) {
    const abs = Math.abs(r.amount);
    if (r.type === "deposit" && r.amount > 0) {
      t.deposits += r.amount;
      t.depositCount += 1;
    } else if (r.type === "purchase") {
      t.spent += abs;
      t.purchaseCount += 1;
    } else if (r.type === "bonus") {
      t.bonus += abs;
    } else if (r.type === "refund") {
      t.refunds += abs;
    }
  }
  return t;
}

/** بازهٔ قبلیِ هم‌طول — برای محاسبهٔ روند (trend) هر KPI */
export function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const duration = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - duration),
    to: new Date(from.getTime()),
  };
}

/**
 * درصد تغییر — semantics هم‌سان با route مقایسه:
 * prev=0 و curr=0 → 0 | prev=0 و curr>0 → null («نامحدود»)
 */
export function pctChange(prev: number, curr: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 100);
}

/**
 * سطل‌بندی روزانهٔ درآمد (فقط ردیف‌های موفق را پاس بدهید).
 * کلید روز بر اساس UTC است — هم‌سان با endpointهای قبلی حسابداری.
 */
export function buildDailyBuckets(
  from: Date,
  to: Date,
  rows: { amount: number; createdAt: Date }[]
): { date: string; label: string; revenue: number; count: number }[] {
  const buckets: { date: string; label: string; revenue: number; count: number }[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const endCursor = new Date(to);
  endCursor.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cursor.getTime() <= endCursor.getTime() && guard < 400) {
    buckets.push({
      date: cursor.toISOString().slice(0, 10),
      label: new Date(cursor).toLocaleDateString("fa-IR", { month: "short", day: "numeric" }),
      revenue: 0,
      count: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  const index = new Map(buckets.map((b) => [b.date, b]));
  for (const r of rows) {
    const b = index.get(r.createdAt.toISOString().slice(0, 10));
    if (b) {
      b.revenue += r.amount;
      b.count += 1;
    }
  }
  return buckets;
}
