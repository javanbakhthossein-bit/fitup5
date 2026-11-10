/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  v53 — تحلیل هوشمند خودکار سایت (Smart Site Analysis)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  گزارش تحلیل هوشمند (دستی از پنل ادمین — حالت خودکار ۶ صبح در v60 حذف شد) + تحلیل روی‌تقاضا برای بازه‌های
 *  ۱روز / ۷روز / ۳۰روز / ۹۰روز / ۱۸۰روز / ۱سال — فروش، قیف تبدیل، سود خالص،
 *  سئو/سرچ‌کنسول، سهمیه‌ها و اکشن‌های پیشنهادی (کلاستر مقاله + تنظیم سهمیه).
 *
 *  اجزای عمومی:
 *   • collectSiteFacts(rangeStart, rangeEnd, now) — فکت‌های بودجه‌دار سایت (≤ ~۲۵هزار کاراکتر؛ لیست‌ها top-20؛
 *     همهٔ aggregateها سمت SQL با groupBy/count/aggregate — هرگز fetch-all).
 *   • buildAnalysisPrompt(facts, rangeLabel) — پرامپت سفت‌وسخت مدیریتی با اسکلت ۷بخشی.
 *   • runSmartAnalysis(range, trigger) — فکت + AI (createResilientCompletion با routeTag
 *     "admin:smart-analysis") + استخراج JSON اکشن‌ها از بلوک ```json انتهایی
 *     (فال‌بک: completion دوم سبک‌تر) + ذخیرهٔ ردیف SmartAnalysisReport.
 *
 *  نکتهٔ سندباکس: GSC ممکن است 403/پیکربندی‌نشده بدهد — همهٔ واکشی‌های بیرونی
 *  داخل try/catch و گزارش بدون GSC هم کامل است.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { db } from "@/lib/db";
import { createResilientCompletion, TEXT_TASK_MODEL, TEXT_MODEL } from "@/lib/fitness/ai";
import { computeCostsForRange } from "@/lib/fitness/costs";
import { getTehranDayKey } from "@/lib/fitness/day";
import { getActivePlans } from "@/lib/fitness/pricing";
import {
  QUOTA_SETTING_KEYS,
  QUOTA_CATEGORIES,
  type QuotaCategory,
} from "@/lib/fitness/quota";

/* ─────────────────────── بازه‌ها ─────────────────────── */

export const SMART_RANGES = ["1d", "7d", "30d", "90d", "180d", "365d"] as const;
export type SmartAnalysisRange = (typeof SMART_RANGES)[number];
export type SmartAnalysisTrigger = "daily_cron" | "manual";

const RANGE_MS: Record<SmartAnalysisRange, number> = {
  "1d": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
  "90d": 90 * 24 * 3600_000,
  "180d": 180 * 24 * 3600_000,
  "365d": 365 * 24 * 3600_000,
};

export const RANGE_LABELS: Record<SmartAnalysisRange, string> = {
  "1d": "۲۴ ساعت گذشته",
  "7d": "۷ روز گذشته",
  "30d": "۳۰ روز گذشته",
  "90d": "۳ ماه گذشته",
  "180d": "۶ ماه گذشته",
  "365d": "۱ سال گذشته",
};

export function isSmartRange(v: unknown): v is SmartAnalysisRange {
  return typeof v === "string" && (SMART_RANGES as readonly string[]).includes(v);
}

/* ─────────────────────── تایپ‌های خروجی ─────────────────────── */

export interface SmartActions {
  clusters: {
    theme: string;
    keywords: string[];
    suggestedCount: number;
    why: string;
  }[];
  quotaSuggestions: {
    category: string;
    direction: "up" | "down";
    to: number;
    reason: string;
  }[];
  priorityActions: {
    title: string;
    where: string;
    what: string;
    expectedImpact: string;
  }[];
}

export interface SmartAnalysisReportRow {
  id: string;
  range: string;
  rangeStart: Date;
  rangeEnd: Date;
  payload: string;
  report: string;
  actions: string | null;
  healthScore: number | null;
  trigger: string;
  createdAt: Date;
}

/* ─────────────────────── کمکی‌های داخلی ─────────────────────── */

const EMPTY_ACTIONS: SmartActions = {
  clusters: [],
  quotaSuggestions: [],
  priorityActions: [],
};

/** پارس امن بلوک ```json (یا اولین {...} متوازن) — نسخهٔ محلی سبک الگوی seo-agent.ts:197 */
function extractJsonObject(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlock ? codeBlock[1].trim() : content.trim();
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === "{") depth++;
    else if (candidate[i] === "}") {
      depth--;
      if (depth === 0) {
        const jsonStr = candidate.slice(start, i + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
        } catch {
          try {
            const fixed = JSON.parse(jsonStr.replace(/,\s*([}\]])/g, "$1"));
            return fixed && typeof fixed === "object" ? (fixed as Record<string, unknown>) : null;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function asString(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asStringArray(v: unknown, maxItems = 15): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .map((x) => x.trim().slice(0, 80))
    .slice(0, maxItems);
}

/** نرمال‌سازی دفاعی actions خام از مدل → ساختار قطعی SmartActions */
export function normalizeActions(raw: unknown): SmartActions {
  if (!raw || typeof raw !== "object") return { ...EMPTY_ACTIONS };
  const obj = raw as Record<string, unknown>;

  const clusters = Array.isArray(obj.clusters)
    ? obj.clusters
        .map((c) => {
          const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          const theme = asString(o.theme ?? o.name, 120);
          const keywords = asStringArray(o.keywords, 12);
          const suggestedCount = Math.max(1, Math.min(20, Math.round(asNumber(o.suggestedCount ?? o.count, 3))));
          const why = asString(o.why ?? o.reason, 400);
          return theme ? { theme, keywords, suggestedCount, why } : null;
        })
        .filter((x): x is SmartActions["clusters"][number] => !!x)
        .slice(0, 6)
    : [];

  const quotaSuggestions = Array.isArray(obj.quotaSuggestions)
    ? obj.quotaSuggestions
        .map((q) => {
          const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
          const category = asString(o.category, 40);
          const direction = asString(o.direction, 10) === "down" ? "down" : "up";
          const to = Math.max(0, Math.min(10_000, Math.round(asNumber(o.to ?? o.value, 0))));
          const reason = asString(o.reason, 400);
          if (!category || to <= 0) return null;
          return { category, direction, to, reason } as SmartActions["quotaSuggestions"][number];
        })
        .filter((x): x is SmartActions["quotaSuggestions"][number] => !!x)
        .slice(0, 6)
    : [];

  const priorityActions = Array.isArray(obj.priorityActions)
    ? obj.priorityActions
        .map((a) => {
          const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
          const title = asString(o.title, 160);
          const where = asString(o.where ?? o.where_, 160);
          const what = asString(o.what, 500);
          const expectedImpact = asString(o.expectedImpact ?? o.impact, 300);
          return title ? { title, where, what, expectedImpact } : null;
        })
        .filter((x): x is SmartActions["priorityActions"][number] => !!x)
        .slice(0, 8)
    : [];

  return { clusters, quotaSuggestions, priorityActions };
}

function clampHealth(v: unknown): number | null {
  const n = asNumber(v, NaN);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** فال‌بک محلی امتیاز سلامت — وزن‌دهی سادهٔ خودمندی (وقتی AI عدد نداد) */
function fallbackHealthScore(f: SiteFacts): number {
  let score = 45;
  const p = f.profit;
  if (p.profitToman > 0) score += 15;
  if (p.profitToman > 5_000_000) score += 5;
  const conv = f.sales.conversion.fromCheckout.ratePct;
  if (conv != null) {
    if (conv >= 30) score += 12;
    else if (conv >= 15) score += 8;
    else if (conv >= 5) score += 3;
  }
  if (f.users.newInRange > 0) score += 5;
  if (f.content.publishedInRange > 0) score += 8;
  if (f.gsc.available && (f.gsc.totals?.clicks ?? 0) > 0) score += 8;
  if (f.engagement.tickets.open <= 3) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const QUOTA_LABELS: Record<string, string> = {
  chat_photo: "عکس چت با فیتاپ",
  meal_photo: "تحلیل عکس غذا",
  movement_video: "ویدیو تحلیل حرکات",
};

/** تشخیص کوئری پرسشی (فارسی/انگلیسی) */
function isQuestionQuery(q: string): boolean {
  return /(چگونه|چطور|چیست|چیه|چرا|بهترین|کدام|چند|آیا|می‌شود|می شود)/i.test(q) || /^(how|what|why|best|which)\b/i.test(q);
}

/* ─────────────────────── فکت‌های سایت ─────────────────────── */

export interface SiteFacts {
  generatedAt: string;
  range: { key: SmartAnalysisRange | string; label: string; start: string; end: string };
  users: {
    total: number;
    newInRange: number;
    activeLast30d: number;
    blocked: number;
    withoutActivePlan: number;
    byActivePlan: { plan: string; count: number }[];
  };
  sales: {
    successCount: number;
    successAmountToman: number;
    refundCount: number;
    refundAmountToman: number;
    startedCheckoutCount: number;
    byPlan: { plan: string; count: number; amountToman: number }[];
    byMethod: { method: string; label: string; count: number; amountToman: number }[];
    renewals: { count: number; amountToman: number };
    newPurchases: { count: number; amountToman: number };
    avgBasketToman: number;
    conversion: {
      fromNewSignup: { ratePct: number | null; paidCount: number; newSignups: number; note: string };
      fromCheckout: { ratePct: number | null; paidCount: number; startedCheckout: number; note: string };
    };
  };
  profit: {
    netRevenueToman: number;
    smsCostToman: number;
    aiCostToman: number;
    gatewayFeeToman: number;
    totalCostsToman: number;
    profitToman: number;
    aiByModel: { model: string; costToman: number; calls: number }[];
    smsByScenario: { scenario: string; costToman: number; count: number }[];
  };
  quotas: {
    byCategory: {
      category: string;
      label: string;
      configuredLimit: number;
      usersWithUsage: number;
      avgUsed: number;
      maxUsed: number;
      usersNearLimit: number;
      totalUsed: number;
      totalBonus: number;
    }[];
    note: string;
  };
  content: {
    articlesTotal: number;
    articlesPublished: number;
    publishedInRange: number;
    viewsTotal: number;
    topArticlesByViews: { title: string; views: number }[];
    lastSeoAgentRun: {
      status: string;
      mode: string;
      requestedCount: number;
      successCount: number;
      failCount: number;
      startedAt: string;
    } | null;
    seoAgentRunsTotal: number;
  };
  gsc: {
    available: boolean;
    note: string;
    totals: { clicks: number; impressions: number; ctrPct: number; avgPosition: number } | null;
    topQueries: { query: string; clicks: number; impressions: number; position: number }[];
    questionQueries: { query: string; clicks: number; impressions: number; position: number }[];
    topPages: { page: string; clicks: number; impressions: number }[];
  };
  engagement: {
    tickets: { open: number; answered: number; closed: number; createdInRange: number };
    dailyCompletionLast7: { date: string; completions: number; fullDays: number }[];
    avgFullDaysLast7: number;
    chatMessagesInRange: number;
    chatActiveUsersInRange: number;
    referrals: { totalReferred: number; referredInRange: number; convertedToPurchase: number };
  };
  pricing: { plan: string; label: string; priceToman: number; durationDays: number }[];
}

/** روش پرداخت قابل‌فهم — Payment.paymentMethod فقط gateway|wallet|mixed دارد؛
 *  خریدهای کافه‌بازار با gateway + description «کافه‌بازار» قابل تفکیک‌اند */
function classifyMethod(method: string, description: string): { method: string; label: string } {
  if (method === "wallet") return { method: "wallet", label: "کیف پول" };
  if (method === "mixed") return { method: "mixed", label: "ترکیبی (درگاه+کیف پول)" };
  if (method === "gateway" && description.includes("کافه‌بازار")) return { method: "bazaar", label: "کافه‌بازار" };
  return { method: "gateway", label: "زرین‌پال (درگاه)" };
}

/**
 * جمع‌آوری فکت‌های بودجه‌دار سایت برای یک بازه.
 * هر بخش مستقل try/catch دارد — شکست GSC یا هر بخش، کل گزارش را نمی‌شکند.
 */
export async function collectSiteFacts(
  rangeStart: Date,
  rangeEnd: Date,
  now: Date = new Date(),
  rangeKey: string = "custom"
): Promise<SiteFacts> {
  const inRange = { gte: rangeStart, lte: rangeEnd };
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000);

  /* ─── ۱) کاربران ─── */
  const users: SiteFacts["users"] = {
    total: 0,
    newInRange: 0,
    activeLast30d: 0,
    blocked: 0,
    withoutActivePlan: 0,
    byActivePlan: [],
  };
  try {
    const [total, newInRange, active30, blocked, noPlan, planRows] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: inRange } }),
      db.user.count({ where: { lastActiveAt: { gte: thirtyDaysAgo } } }),
      db.user.count({ where: { isBlocked: true } }),
      db.user.count({ where: { OR: [{ planName: null }, { planExpiresAt: { lte: now } }] } }),
      db.user.groupBy({
        by: ["planName"],
        where: { planName: { not: null }, planExpiresAt: { gt: now } },
        _count: true,
      }),
    ]);
    users.total = total;
    users.newInRange = newInRange;
    users.activeLast30d = active30;
    users.blocked = blocked;
    users.withoutActivePlan = noPlan;
    users.byActivePlan = planRows
      .map((r) => ({ plan: r.planName || "بدون‌نام", count: r._count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  } catch (e) {
    console.error("[smart-analysis] users facts failed:", e instanceof Error ? e.message : e);
  }

  /* ─── ۲) فروش / درآمد ─── */
  const sales: SiteFacts["sales"] = {
    successCount: 0,
    successAmountToman: 0,
    refundCount: 0,
    refundAmountToman: 0,
    startedCheckoutCount: 0,
    byPlan: [],
    byMethod: [],
    renewals: { count: 0, amountToman: 0 },
    newPurchases: { count: 0, amountToman: 0 },
    avgBasketToman: 0,
    conversion: {
      fromNewSignup: { ratePct: null, paidCount: 0, newSignups: 0, note: "پرداخت موفق ÷ ثبت‌نام جدید همان بازه" },
      fromCheckout: { ratePct: null, paidCount: 0, startedCheckout: 0, note: "پرداخت موفق ÷ شروع checkout (هر status) همان بازه" },
    },
  };
  try {
    const [successRows, startedAgg, refundAgg, feeAgg] = await Promise.all([
      db.payment.findMany({
        where: { createdAt: inRange, status: "success" },
        select: { userId: true, amount: true, plan: true, paymentMethod: true, description: true },
        take: 2000,
      }),
      db.payment.count({ where: { createdAt: inRange } }),
      db.payment.aggregate({ where: { createdAt: inRange, status: "refunded" }, _count: true, _sum: { amount: true } }),
      db.payment.aggregate({ where: { createdAt: inRange, status: "success" }, _sum: { fee: true } }),
    ]);

    sales.startedCheckoutCount = startedAgg;
    sales.refundCount = refundAgg._count;
    sales.refundAmountToman = Math.max(0, refundAgg._sum.amount || 0);
    sales.successCount = successRows.length;
    sales.successAmountToman = successRows.reduce((s, r) => s + r.amount, 0);
    sales.avgBasketToman =
      sales.successCount > 0 ? Math.round(sales.successAmountToman / sales.successCount) : 0;

    // byPlan
    const planMap = new Map<string, { count: number; amount: number }>();
    for (const r of successRows) {
      const cur = planMap.get(r.plan) || { count: 0, amount: 0 };
      cur.count++;
      cur.amount += r.amount;
      planMap.set(r.plan, cur);
    }
    sales.byPlan = [...planMap.entries()]
      .map(([plan, v]) => ({ plan, count: v.count, amountToman: v.amount }))
      .sort((a, b) => b.amountToman - a.amountToman)
      .slice(0, 6);

    // byMethod (zarinpal/bazaar/wallet)
    const methodMap = new Map<string, { label: string; count: number; amount: number }>();
    for (const r of successRows) {
      const { method, label } = classifyMethod(r.paymentMethod, r.description || "");
      const cur = methodMap.get(method) || { label, count: 0, amount: 0 };
      cur.count++;
      cur.amount += r.amount;
      methodMap.set(method, cur);
    }
    sales.byMethod = [...methodMap.entries()]
      .map(([method, v]) => ({ method, label: v.label, count: v.count, amountToman: v.amount }))
      .sort((a, b) => b.amountToman - a.amountToman)
      .slice(0, 5);

    // تمدید در برابر خرید جدید — کاربر با سابقهٔ Subscription قبلی (قبل از شروع بازه)
    const payerIds = [...new Set(successRows.map((r) => r.userId))];
    if (payerIds.length > 0) {
      const withPriorSub = await db.subscription.groupBy({
        by: ["userId"],
        where: { userId: { in: payerIds }, createdAt: { lt: rangeStart } },
      });
      const priorSet = new Set(withPriorSub.map((s) => s.userId));
      for (const r of successRows) {
        if (priorSet.has(r.userId)) {
          sales.renewals.count++;
          sales.renewals.amountToman += r.amount;
        } else {
          sales.newPurchases.count++;
          sales.newPurchases.amountToman += r.amount;
        }
      }
    }

    // نرخ‌های تبدیل — دو نرخ جدا با برچسب روشن
    sales.conversion.fromNewSignup.paidCount = sales.successCount;
    sales.conversion.fromNewSignup.newSignups = users.newInRange;
    sales.conversion.fromNewSignup.ratePct =
      users.newInRange > 0 ? Math.round((sales.successCount / users.newInRange) * 1000) / 10 : null;
    sales.conversion.fromCheckout.paidCount = sales.successCount;
    sales.conversion.fromCheckout.startedCheckout = startedAgg;
    sales.conversion.fromCheckout.ratePct =
      startedAgg > 0 ? Math.round((sales.successCount / startedAgg) * 1000) / 10 : null;
  } catch (e) {
    console.error("[smart-analysis] sales facts failed:", e instanceof Error ? e.message : e);
  }

  /* ─── ۳) سود (هزینه‌ها از computeCostsForRange) ─── */
  const netRevenue = Math.max(0, sales.successAmountToman - sales.refundAmountToman);
  const profit: SiteFacts["profit"] = {
    netRevenueToman: netRevenue,
    smsCostToman: 0,
    aiCostToman: 0,
    gatewayFeeToman: 0,
    totalCostsToman: 0,
    profitToman: 0,
    aiByModel: [],
    smsByScenario: [],
  };
  try {
    const feeAgg = await db.payment.aggregate({
      where: { createdAt: inRange, status: "success" },
      _sum: { fee: true },
    });
    const cb = await computeCostsForRange(rangeStart, rangeEnd, netRevenue, feeAgg._sum.fee || 0);
    profit.smsCostToman = cb.costs.smsCostToman;
    profit.aiCostToman = cb.costs.aiCostToman;
    profit.gatewayFeeToman = cb.costs.gatewayFeeToman;
    profit.totalCostsToman = cb.costs.totalCostsToman;
    profit.profitToman = cb.costs.profitToman;
    profit.aiByModel = cb.breakdowns.aiByModel
      .slice(0, 5)
      .map((m) => ({ model: m.model, costToman: m.costToman, calls: m.count }));
    profit.smsByScenario = cb.breakdowns.smsByScenario
      .slice(0, 5)
      .map((s) => ({ scenario: s.scenario, costToman: s.costToman, count: s.count }));
  } catch (e) {
    console.error("[smart-analysis] profit facts failed:", e instanceof Error ? e.message : e);
  }

  /* ─── ۴) سهمیه‌ها (پایهٔ پیشنهاد بالا/پایین کردن با نگاه هزینهٔ AI) ─── */
  const quotas: SiteFacts["quotas"] = {
    byCategory: [],
    note: "سقف پیکربندی‌شده تقریبی از SiteSetting است (سقف واقعی meal_photo = روزهای پلن، movement_video = تعداد حرکات برنامه). usersNearLimit = کاربرانی که ≥۹۰٪ سقف را مصرف کرده‌اند.",
  };
  try {
    const [limitRows, bucketRows, bonusRows] = await Promise.all([
      db.siteSetting.findMany({
        where: {
          key: {
            in: [
              QUOTA_SETTING_KEYS.chatPhotoTotal,
              QUOTA_SETTING_KEYS.mealPhotoTotal,
              QUOTA_SETTING_KEYS.movementVideoDefault,
            ],
          },
        },
      }),
      db.quotaUsage.groupBy({ by: ["category", "used"], _count: true }),
      db.quotaUsage.groupBy({ by: ["category"], _sum: { bonus: true } }),
    ]);
    const limitMap = new Map(limitRows.map((r) => [r.key, Number(r.value)]));
    const defaultLimits: Record<string, number> = {
      chat_photo: 90,
      meal_photo: 45,
      movement_video: 10,
    };
    const bonusMap = new Map(bonusRows.map((r) => [r.category, r._sum.bonus || 0]));

    quotas.byCategory = QUOTA_CATEGORIES.map((cat: QuotaCategory) => {
      const configured = limitMap.get(
        cat === "chat_photo"
          ? QUOTA_SETTING_KEYS.chatPhotoTotal
          : cat === "meal_photo"
          ? QUOTA_SETTING_KEYS.mealPhotoTotal
          : QUOTA_SETTING_KEYS.movementVideoDefault
      ) ?? defaultLimits[cat] ?? 0;
      const buckets = bucketRows.filter((b) => b.category === cat);
      let usersWithUsage = 0;
      let totalUsed = 0;
      let maxUsed = 0;
      let near = 0;
      for (const b of buckets) {
        usersWithUsage += b._count;
        totalUsed += b.used * b._count;
        maxUsed = Math.max(maxUsed, b.used);
        if (configured > 0 && b.used >= Math.ceil(configured * 0.9)) near += b._count;
      }
      return {
        category: cat,
        label: QUOTA_LABELS[cat] || cat,
        configuredLimit: configured,
        usersWithUsage,
        avgUsed: usersWithUsage > 0 ? Math.round((totalUsed / usersWithUsage) * 10) / 10 : 0,
        maxUsed,
        usersNearLimit: near,
        totalUsed,
        totalBonus: bonusMap.get(cat) || 0,
      };
    });
  } catch (e) {
    console.error("[smart-analysis] quota facts failed:", e instanceof Error ? e.message : e);
  }

  /* ─── ۵) محتوا / سئو ─── */
  const content: SiteFacts["content"] = {
    articlesTotal: 0,
    articlesPublished: 0,
    publishedInRange: 0,
    viewsTotal: 0,
    topArticlesByViews: [],
    lastSeoAgentRun: null,
    seoAgentRunsTotal: 0,
  };
  try {
    const [totalAgg, publishedCount, publishedInRange, topArticles, lastRun, runsTotal] = await Promise.all([
      db.article.aggregate({ _count: true, _sum: { views: true } }),
      db.article.count({ where: { status: "published" } }),
      db.article.count({ where: { status: "published", publishedAt: inRange } }),
      db.article.findMany({
        where: { status: "published" },
        orderBy: { views: "desc" },
        take: 10,
        select: { title: true, views: true },
      }),
      db.seoAgentRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: { status: true, mode: true, requestedCount: true, successCount: true, failCount: true, startedAt: true },
      }),
      db.seoAgentRun.count(),
    ]);
    content.articlesTotal = totalAgg._count;
    content.viewsTotal = totalAgg._sum.views || 0;
    content.articlesPublished = publishedCount;
    content.publishedInRange = publishedInRange;
    content.topArticlesByViews = topArticles.map((a) => ({ title: a.title, views: a.views }));
    content.seoAgentRunsTotal = runsTotal;
    content.lastSeoAgentRun = lastRun
      ? {
          status: lastRun.status,
          mode: lastRun.mode,
          requestedCount: lastRun.requestedCount,
          successCount: lastRun.successCount,
          failCount: lastRun.failCount,
          startedAt: lastRun.startedAt.toISOString(),
        }
      : null;
  } catch (e) {
    console.error("[smart-analysis] content facts failed:", e instanceof Error ? e.message : e);
  }

  /* ─── ۶) سرچ‌کنسول — منبع داده: گزارش آپلودشده (GSC API حذف شد — درخواست مالک) ─── */
  // مالک فایل Export سرچ‌کنسول را دستی در تب «سئو هوشمند» آپلود می‌کند؛ اگر
  // گزارشی آپلود شده باشد همین‌جا به فکت‌ها تزریق می‌شود، وگرنه تحلیل بدون آن هم کامل است.
  const gsc: SiteFacts["gsc"] = {
    available: false,
    note: "دادهٔ سرچ‌کنسول از فایل آپلودشده خوانده می‌شود — اگر گزارشی آپلود نشده باشد، تحلیل بدون آن هم کامل است.",
    totals: null,
    topQueries: [],
    questionQueries: [],
    topPages: [],
  };
  try {
    const { getSeoReport } = await import("@/lib/fitness/seo-report");
    const { report } = await getSeoReport();
    if (report && report.topQueries.length > 0) {
      gsc.available = true;
      gsc.note = `دادهٔ سرچ‌کنسول از گزارش آپلودشده (${report.fileName} — ${report.rowsAnalyzed} ردیف)`;
      const clicks = report.topQueries.reduce((s, q) => s + q.clicks, 0) || report.totals.clicks;
      const impressions = report.topQueries.reduce((s, q) => s + q.impressions, 0) || report.totals.impressions;
      gsc.totals = {
        clicks,
        impressions,
        ctrPct: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
        avgPosition: report.totals.position,
      };
      gsc.topQueries = [...report.topQueries]
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 20)
        .map((q) => ({
          query: q.query,
          clicks: q.clicks,
          impressions: q.impressions,
          position: q.position,
        }));
      gsc.questionQueries = gsc.topQueries.filter((q) => isQuestionQuery(q.query)).slice(0, 20);
      gsc.topPages = [...report.pages]
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 10)
        .map((p) => ({ page: p.page, clicks: p.clicks, impressions: p.impressions }));
    }
  } catch (e) {
    console.error("[smart-analysis] report facts failed (غیرمرگبار):", e instanceof Error ? e.message : e);
  }

  /* ─── ۷) تعامل ─── */
  const engagement: SiteFacts["engagement"] = {
    tickets: { open: 0, answered: 0, closed: 0, createdInRange: 0 },
    dailyCompletionLast7: [],
    avgFullDaysLast7: 0,
    chatMessagesInRange: 0,
    chatActiveUsersInRange: 0,
    referrals: { totalReferred: 0, referredInRange: 0, convertedToPurchase: 0 },
  };
  try {
    const [ticketStatus, ticketsCreated] = await Promise.all([
      db.supportTicket.groupBy({ by: ["status"], _count: true }),
      db.supportTicket.count({ where: { createdAt: inRange } }),
    ]);
    for (const t of ticketStatus) {
      if (t.status === "open") engagement.tickets.open = t._count;
      else if (t.status === "answered") engagement.tickets.answered = t._count;
      else if (t.status === "closed") engagement.tickets.closed = t._count;
    }
    engagement.tickets.createdInRange = ticketsCreated;
  } catch (e) {
    console.error("[smart-analysis] ticket facts failed:", e instanceof Error ? e.message : e);
  }

  try {
    // ۷ روز اخیر تهران — با کلید روز مشترک اپ (day.ts)
    const keys: string[] = [];
    const base = getTehranDayKey(now);
    const [y, m, d] = base.split("-").map(Number);
    for (let i = 0; i < 7; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d - i));
      keys.push(dt.toISOString().slice(0, 10)); // همان ریاضی روزِ تقویمی — کلید YYYY-MM-DD
    }
    const [dayRows, fullRows] = await Promise.all([
      db.dayCompletion.groupBy({ by: ["date"], where: { date: { in: keys } }, _count: true }),
      db.dayCompletion.groupBy({
        by: ["date"],
        where: { date: { in: keys }, workoutDone: true, nutritionDone: true },
        _count: true,
      }),
    ]);
    const rowMap = new Map(dayRows.map((r) => [r.date, r._count]));
    const fullMap = new Map(fullRows.map((r) => [r.date, r._count]));
    let fullSum = 0;
    for (const k of [...keys].sort()) {
      const completions = rowMap.get(k) || 0;
      const fullDays = fullMap.get(k) || 0;
      fullSum += fullDays;
      engagement.dailyCompletionLast7.push({ date: k, completions, fullDays });
    }
    engagement.avgFullDaysLast7 = Math.round((fullSum / 7) * 100) / 100;
  } catch (e) {
    console.error("[smart-analysis] dayCompletion facts failed:", e instanceof Error ? e.message : e);
  }

  try {
    const [chatCount, chatUsers] = await Promise.all([
      db.chatMessage.count({ where: { createdAt: inRange, role: "user" } }),
      db.chatMessage.groupBy({ by: ["userId"], where: { createdAt: inRange, role: "user" } }),
    ]);
    engagement.chatMessagesInRange = chatCount;
    engagement.chatActiveUsersInRange = chatUsers.length;
  } catch (e) {
    console.error("[smart-analysis] chat facts failed:", e instanceof Error ? e.message : e);
  }

  try {
    const [totalReferred, referredInRange] = await Promise.all([
      db.user.count({ where: { referredById: { not: null } } }),
      db.user.count({ where: { referredById: { not: null }, createdAt: inRange } }),
    ]);
    let converted = 0;
    const payers = await db.payment.groupBy({ by: ["userId"], where: { status: "success" } });
    if (payers.length > 0) {
      converted = await db.user.count({
        where: { id: { in: payers.map((p) => p.userId) }, referredById: { not: null } },
      });
    }
    engagement.referrals = { totalReferred, referredInRange, convertedToPurchase: converted };
  } catch (e) {
    console.error("[smart-analysis] referral facts failed:", e instanceof Error ? e.message : e);
  }

  /* ─── ۸) قیمت پلن‌های فعلی (SiteSetting — PRICE_KEYS) ─── */
  const pricing: SiteFacts["pricing"] = [];
  try {
    const plans = await getActivePlans();
    for (const p of plans) {
      pricing.push({ plan: p.id, label: p.label, priceToman: p.price, durationDays: p.durationDays });
    }
  } catch (e) {
    console.error("[smart-analysis] pricing facts failed:", e instanceof Error ? e.message : e);
  }

  const facts: SiteFacts = {
    generatedAt: now.toISOString(),
    range: {
      key: rangeKey,
      label: RANGE_LABELS[rangeKey as SmartAnalysisRange] || "بازهٔ سفارشی",
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
    },
    users,
    sales,
    profit,
    quotas,
    content,
    gsc,
    engagement,
    pricing,
  };
  return facts;
}

/** بودجهٔ سخت JSON فکت‌ها — با شِرینک تدریجی لیست‌ها */
const FACTS_BUDGET_CHARS = 25_000;

function shrinkFactsForBudget(f: SiteFacts): SiteFacts {
  let json = JSON.stringify(f);
  if (json.length <= FACTS_BUDGET_CHARS) return f;
  // مرحلهٔ ۱: لیست‌ها را نصف کن
  f.gsc.topQueries = f.gsc.topQueries.slice(0, 10);
  f.gsc.questionQueries = f.gsc.questionQueries.slice(0, 8);
  f.gsc.topPages = f.gsc.topPages.slice(0, 5);
  f.content.topArticlesByViews = f.content.topArticlesByViews.slice(0, 5);
  f.sales.byPlan = f.sales.byPlan.slice(0, 4);
  f.sales.byMethod = f.sales.byMethod.slice(0, 3);
  f.profit.aiByModel = f.profit.aiByModel.slice(0, 3);
  f.profit.smsByScenario = f.profit.smsByScenario.slice(0, 3);
  json = JSON.stringify(f);
  // مرحلهٔ ۲: اگر هنوز بزرگ بود، کوئری‌های پرسشی حذف — مرز قطعی
  if (json.length > FACTS_BUDGET_CHARS) {
    f.gsc.questionQueries = [];
    f.gsc.topQueries = f.gsc.topQueries.slice(0, 5);
    f.content.topArticlesByViews = [];
  }
  return f;
}

/* ─────────────────────── پرامپت تحلیل ─────────────────────── */

const SMART_SYSTEM_PROMPT = `تو تحلیلگر ارشد رشد و درآمد پلتفرم فیتاپ (fittup.ir، پلتفرم آنلاین برنامهٔ بدنسازی/تغذیه ایرانی با پلن‌های اقتصادی/استاندارد/پیشرفته/حرفه‌ای) هستی.
فقط و فقط بر اساس داده‌های همین سند تحلیل کن؛ هر پیشنهادی که به فیتاپ ربط ندارد ممنوع.
لحن: مدیریتی، مشخص، عدد‌محور، فارسی.
ممنوع: پیشنهاد ابزار خارجی/شبکه اجتماعی خاص/هر چیز خارج از اختیار تیم فیتاپ.
ممنوع: حدس زدن عددی که در سند نیست — اگر داده‌ای موجود نیست، صادقانه بگو «داده در دسترس نیست» و تحلیل را با بقیهٔ داده‌ها ادامه بده.

⚠️ قواعد سختِ فرمت خروجی (نقض = رد شدن گزارش — گزارش مالک: بخش‌هایی به‌صورت کد/اسکریپت رندر می‌شد):
- گزارش فقط و فقط متن فارسی مارک‌داون است؛ هرگز هیچ بخشی از گزارش را داخل بلوک کد (\`\`\` یا ~~~) یا با سینتکس برنامه‌نویسی/اسکریپت/JSON/کامند ترمینال ننویس. تنها استثنای مجاز در کل خروجی: بلوک json انتهایی.
- از بک‌تیکِ inline (\`) در متن استفاده نکن؛ هر چیز که شبیه کد، مسیر فایل، تابع یا کامند است را به متن فارسی ساده ترجمه کن.
- جدول بخش ۵ فقط جدول مارک‌داون ساده با ستون‌بندی | است — هرگز جدول را داخل بلوک کد نگذار.
- هیچ placeholder مثل <عدد> یا [...] داخل متن گزارش ننویس — همهٔ جاها عدد/متن واقعی بگذار.

خروجی الزاماً مارک‌داون فارسی با دقیقاً همین اسکلت (عنوان‌بندی ##):
## ۱) خلاصهٔ مدیریتی
۳-۴ بولت — وضعیت کلی سایت با عدد.
## ۲) فروش و درآمد
تحلیل فروش، سبد میانگین، تمدید در برابر خرید جدید، ترکیب پلن/روش پرداخت.
## ۳) قیف و نرخ تبدیل
کجا می‌ریزیم — با تکیه بر دو نرخ تبدیل سند (ثبت‌نام→خرید و شروع checkout→خرید) و نقاط ریزش.
## ۴) سئو و گوگل
کلمات پرسشی/پرتکرار/پرفروش — برای هر کدام پیشنهاد مشخص. اگر GSC در دسترس نیست، این بخش را بر اساس وضعیت مقالات و کلمات پولساز پلتفرم بنویس.
## ۵) پیشنهاد کلاستر مقاله
جدول مارک‌داون با ستون‌های: کلاستر | کلیدواژه‌ها (۵-۱۰) | تعداد مقاله پیشنهادی | چرا فروش می‌آورد. ۲ تا ۴ کلاستر.
## ۶) سهمیه‌ها و هزینه‌ها
با نگاه سود خالص: کدام سهمیه بالا/پایین برود و چرا — عدد پیشنهادی مشخص. هزینهٔ پیامک/AI/کارمزد را تفسیر کن.
## ۷) اکشن‌های این هفته
۳ تا ۵ اکشن مشخص — هر اکشن: کدام قسمت سایت + کار دقیق + اثر تخمینی روی فروش.

در انتهای پاسخ، یک بلوک کد json اضافه کن با دقیقاً این ساختار (هیچ توضیحی داخل JSON ننویس):
\`\`\`json
{
  "healthScore": <عدد ۰ تا ۱۰۰ — سلامت کلی سایت بر اساس همین داده‌ها>,
  "actions": {
    "clusters": [
      { "theme": "نام کلاستر", "keywords": ["کلیدواژه ۱", "کلیدواژه ۲"], "suggestedCount": 3, "why": "چرا این کلاستر فروش می‌آورد" }
    ],
    "quotaSuggestions": [
      { "category": "chat_photo | meal_photo | movement_video", "direction": "up یا down", "to": 100, "reason": "دلیل با عدد" }
    ],
    "priorityActions": [
      { "title": "عنوان اکشن", "where": "کدام قسمت سایت", "what": "کار دقیق", "expectedImpact": "اثر تخمینی روی فروش" }
    ]
  }
}
\`\`\``;

/* ───────── سانیتایزر گزارش (v58 — ضد «گزارش به‌صورت کد/اسکریپت») ───────── */
/**
 * گزارش مالک: بخش‌هایی از گزارش تحلیل فروش در پنل ادمین به‌صورت بلوک کد
 * (<pre><code>) رندر می‌شد — چون مدل گاهی متن را داخل \`\`\` می‌گذاشت و بلوک
 * json انتهایی هم عیناً در گزارش نمایش داده می‌شد.
 *
 * این تابع قبل از ذخیرهٔ گزارش اجرا می‌شود:
 *  ۱) بلوک json کامل (همان که اکشن‌ها از آن استخراج شد و جداگانه در ستون
 *     actions ذخیره/رندر می‌شود) حذف می‌شود — دوباره‌کاری نمایشی نباشد.
 *  ۲) هر بلوک کد دیگر باز می‌شود (فقط محتوایش می‌ماند — بدون فنس و نام زبان).
 *  ۳) فنس‌های ناقص (بدون بستن) حذف می‌شوند.
 *  ۴) بک‌تیک inline به متن ساده تبدیل می‌شود.
 * نتیجه: رندر مارک‌داون پنل ادمین هرگز <pre><code> نشان نمی‌دهد.
 */
function sanitizeSmartReport(raw: string): string {
  let text = raw;
  // ۱) بلوک‌های json کامل — حذف (شامل بلوک انتهایی)
  text = text.replace(/```(?:json|JSON)?\s*\{[\s\S]*?\}\s*```/g, "");
  // ۲) هر بلوک کد دیگر → فقط محتوای داخلش
  text = text.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, inner) => String(inner));
  // ۳) فنس‌های ناقص بازمانده
  text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, "");
  // ۴) بک‌تیک inline → متن ساده
  text = text.replace(/`([^`\n]+)`/g, "$1");
  return text.trim();
}

export function buildAnalysisPrompt(facts: SiteFacts, rangeLabel: string): { system: string; user: string } {
  const factsJson = JSON.stringify(facts);
  const user = `بازهٔ تحلیل: ${rangeLabel}
(از ${facts.range.start} تا ${facts.range.end})

سند داده‌های سایت (JSON):
${factsJson}

بر اساس فقط همین سند، تحلیل مدیریتی کامل با اسکلت ۷بخشی بنویس و در انتها بلوک json را فراموش نکن.`;
  return { system: SMART_SYSTEM_PROMPT, user };
}

/* ─────────────────────── اجرای تحلیل ─────────────────────── */

/**
 * اجرای کامل تحلیل هوشمند برای یک بازه + ذخیرهٔ ردیف SmartAnalysisReport.
 * در شکست AI → throw با پیام فارسی (روت ۵۰۲ می‌دهد و پیام UI نشان می‌دهد).
 */
export async function runSmartAnalysis(
  range: SmartAnalysisRange,
  trigger: SmartAnalysisTrigger
): Promise<SmartAnalysisReportRow> {
  const now = new Date();
  const rangeEnd = now;
  const rangeStart = new Date(now.getTime() - RANGE_MS[range]);

  let facts = await collectSiteFacts(rangeStart, rangeEnd, now, range);
  facts = shrinkFactsForBudget(facts);

  const { system, user } = buildAnalysisPrompt(facts, RANGE_LABELS[range]);

  // ─── کامپلیشن اصلی — گزارش مارک‌داون + بلوک json انتهایی ───
  let report: string;
  try {
    report = await createResilientCompletion(
      {
        // v73 — دیریکتیو مالک: تحلیل متنی ادمین با deepseek-v4.1-flash
        model: TEXT_TASK_MODEL,
        fallback_model: TEXT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      {
        logTag: "smart-analysis",
        routeTag: "admin:smart-analysis",
        maxTokens: 8192,
        temperature: 0.35,
        reasoningEffort: "low",
        timeoutMs: 180_000,
        maxAttempts: 2,
        validateContent: (t: string) =>
          t && t.trim().length >= 200 ? null : "خروجی تحلیل بیش از حد کوتاه بود",
      }
    );
  } catch (err) {
    console.error("[smart-analysis] AI completion failed:", err instanceof Error ? err.message : err);
    throw new Error(
      "تولید تحلیل هوشمند ناموفق بود — سرویس هوش مصنوعی در دسترس نیست. لطفاً چند دقیقه بعد دوباره تلاش کنید."
    );
  }

  // ─── استخراج JSON اکشن‌ها — از بلوک ```json انتهایی گزارش ───
  const firstParsed = extractJsonObject(report);
  let healthScore = clampHealth((firstParsed as any)?.healthScore);
  let actions = normalizeActions((firstParsed as any)?.actions ?? (firstParsed as any));

  // فال‌بک: اگر JSON از گزارش درنیامد یا خالی بود → completion دوم سبک‌تر فقط برای JSON
  const hasAnyAction =
    actions.clusters.length + actions.quotaSuggestions.length + actions.priorityActions.length > 0;
  if ((!firstParsed || !hasAnyAction) && report.trim().length > 0) {
    try {
      const fixContent = await createResilientCompletion(
        {
          // v70 — فال‌بک JSON هم deepseek (مسیر دوم همین تحلیل)
          model: TEXT_TASK_MODEL,
          fallback_model: TEXT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "تو مبدل خروجی تحلیل به JSON هستی. فقط و فقط یک JSON معتبر با ساختار خواسته‌شده برگردان — بدون هیچ متن اضافه.",
            },
            {
              role: "user",
              content: `از متن تحلیل زیر، فقط JSON اکشن‌ها را برگردان با دقیقاً این ساختار:
{"healthScore": <۰-۱۰۰>, "actions": {"clusters": [{"theme": "...", "keywords": ["..."], "suggestedCount": 3, "why": "..."}], "quotaSuggestions": [{"category": "...", "direction": "up|down", "to": 100, "reason": "..."}], "priorityActions": [{"title": "...", "where": "...", "what": "...", "expectedImpact": "..."}]}}

متن تحلیل:
${report.slice(0, 12_000)}`,
            },
          ],
        },
        {
          logTag: "smart-analysis:actions",
          routeTag: "admin:smart-analysis",
          maxTokens: 2048,
          temperature: 0.1,
          reasoningEffort: "low",
          timeoutMs: 90_000,
          maxAttempts: 2,
          validateContent: (t: string) => (t && t.includes("{") ? null : "پاسخ JSON نداشت"),
        }
      );
      const p2 = extractJsonObject(fixContent);
      if (p2) {
        if (healthScore == null) healthScore = clampHealth(p2.healthScore);
        const a2 = normalizeActions(p2.actions ?? p2);
        const a2Count = a2.clusters.length + a2.quotaSuggestions.length + a2.priorityActions.length;
        if (a2Count > 0) actions = a2;
      }
    } catch {
      // استخراج اکشن‌ها هرگز کل گزارش را نمی‌شکند — گزارش متنی همچنان ذخیره می‌شود
      console.warn("[smart-analysis] actions extraction fallback failed — ذخیره با actions خالی");
    }
  }

  if (healthScore == null) healthScore = fallbackHealthScore(facts);

  // ─── v58 — ضد «گزارش به‌صورت کد/اسکریپت» (گزارش مالک) ───
  // بعد از استخراج اکشن‌ها (که به بلوک json نیاز دارد) اجرا می‌شود؛ متن
  // ذخیره‌شده در SmartAnalysisReport.report همیشه بدون بلوک کد است.
  report = sanitizeSmartReport(report);

  // ─── ذخیرهٔ ردیف گزارش ───
  const row = await db.smartAnalysisReport.create({
    data: {
      range,
      rangeStart,
      rangeEnd,
      payload: JSON.stringify(facts),
      report,
      actions: JSON.stringify(actions),
      healthScore,
      trigger,
    },
  });
  console.log(
    `[smart-analysis] گزارش ${range} (${trigger}) ذخیره شد — id=${row.id} healthScore=${healthScore} clusters=${actions.clusters.length} quotaSugg=${actions.quotaSuggestions.length} actions=${actions.priorityActions.length}`
  );
  return row;
}
