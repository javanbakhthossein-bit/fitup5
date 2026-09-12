/**
 * POST /api/admin/seo-agent/analyze — «تحلیل هوشمند» تب سئو (درخواست مالک)
 *
 * تمام داده‌های سایت را سمت سرور جمع می‌کند (هیچ پیلودی از کلاینت نمی‌آید):
 *  - موجودی کامل مقالات (تعداد/دسته/بازدید/کیفیت فیلدهای سئو/کندانس انتشار ۹۰ روز)
 *  - گزارش آپلودشدهٔ سرچ‌کنسول + تحلیل AI آن (در صورت وجود) — منبع دادهٔ جستجوی واقعی
 *    (درخواست مالک: GSC API حذف شد — فایل Export گوگل دستی آپلود می‌شود)
 *  - استراتژی فعال (پیلارها، کلمات هدف، توزیع امتیاز فرصت)
 *  - صف مقالات برنامه‌ریزی‌شده + تاریخچه ۵ اجرای آخر ایجنت
 *  - ساختار سایت (حرکات ورزشی، مواد غذایی، ابزارها)
 * سپس با یک فراخوانی LLM (STRICT JSON — analyzeSeoComprehensive در ai.ts) تحلیل
 * جامع صفر تا صد تولید و در SiteSetting کلید «seo_comprehensive_analysis» ذخیره می‌شود.
 *
 * GET /api/admin/seo-agent/analyze — آخرین تحلیل ذخیره‌شده را برمی‌گرداند
 * (تا مودال بدون اجرای مجدد هم آخرین تصویر را نشان بدهد؛ دکمه همچنان اجازهٔ اجرای مجدد می‌دهد).
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { analyzeSeoComprehensive, type SeoSmartAnalysis } from "@/lib/fitness/ai";
import { getSeoReport } from "@/lib/fitness/seo-report";

const SETTING_ANALYSIS = "seo_comprehensive_analysis";
const LABEL_ANALYSIS = "تحلیل هوشمند جامع سئو";

interface SavedAnalysis extends SeoSmartAnalysis {
  generatedAt: string;
}

/* ─────────────────────── خواندن تحلیل ذخیره‌شده ─────────────────────── */

async function readSavedAnalysis(): Promise<SavedAnalysis | null> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: SETTING_ANALYSIS } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as SavedAnalysis;
    if (!parsed || typeof parsed !== "object" || typeof parsed.summary !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveAnalysis(analysis: SeoSmartAnalysis): Promise<string> {
  const generatedAt = new Date().toISOString();
  const payload: SavedAnalysis = { ...analysis, generatedAt };
  await db.siteSetting.upsert({
    where: { key: SETTING_ANALYSIS },
    create: { key: SETTING_ANALYSIS, value: JSON.stringify(payload), label: LABEL_ANALYSIS },
    update: { value: JSON.stringify(payload), label: LABEL_ANALYSIS },
  });
  return generatedAt;
}

/* ─────────────────────── جمع‌آوری داده‌ها ─────────────────────── */

async function gatherArticleStats() {
  const published = await db.article.findMany({
    where: { status: "published" },
    select: {
      title: true,
      slug: true,
      category: true,
      tags: true,
      views: true,
      seoTitle: true,
      seoDescription: true,
      metaKeywords: true,
      coverImage: true,
      readingMinutes: true,
      publishedAt: true,
      createdAt: true,
    },
  });

  const totalDrafts = await db.article.count({ where: { status: "draft" } });
  const scheduled = await db.article.count({
    where: { status: "draft", scheduledAt: { not: null } },
  });

  const now = Date.now();
  const days90Ago = now - 90 * 86400_000;
  const publishedLast90 = published.filter(
    (a) =>
      (a.publishedAt ?? a.createdAt) &&
      new Date(a.publishedAt ?? a.createdAt).getTime() >= days90Ago
  ).length;

  // کندانس انتشار — سه ماه اخیر (هر ماه چند مقاله منتشر شده؟)
  const monthBuckets: Record<string, number> = {};
  for (let i = 0; i < 3; i++) {
    const start = new Date();
    start.setMonth(start.getMonth() - i, 1);
    start.setHours(0, 0, 0, 0);
    monthBuckets[start.toISOString().slice(0, 7)] = 0;
  }
  for (const a of published) {
    const d = new Date(a.publishedAt ?? a.createdAt);
    const key = d.toISOString().slice(0, 7);
    if (key in monthBuckets) monthBuckets[key]++;
  }

  const withSeoTitle = published.filter((a) => a.seoTitle?.trim()).length;
  const withSeoDesc = published.filter((a) => a.seoDescription?.trim()).length;
  const withKeywords = published.filter((a) => a.metaKeywords?.trim()).length;
  const withCover = published.filter((a) => a.coverImage?.trim()).length;
  const pct = (n: number) => (published.length ? Math.round((n / published.length) * 100) : 0);

  const categoryStats: Record<string, number> = {};
  const tagCount: Record<string, number> = {};
  let totalViews = 0;
  for (const a of published) {
    totalViews += a.views;
    categoryStats[a.category] = (categoryStats[a.category] || 0) + 1;
    for (const t of (a.tags || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      tagCount[t] = (tagCount[t] || 0) + 1;
    }
  }

  const topArticles = [...published]
    .sort((a, b) => b.views - a.views)
    .slice(0, 20)
    .map((a) => ({ title: a.title, category: a.category, views: a.views }));

  // کلمات کلیدی موجود (از تگ‌ها) — حداکثر ۳۰ پرتکرار
  const existingKeywords = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }));

  return {
    publishedCount: published.length,
    draftCount: totalDrafts,
    scheduledCount: scheduled,
    totalViews,
    categoryStats,
    publishCadence: {
      last90Days: publishedLast90,
      monthlyLast3Months: monthBuckets,
    },
    seoFieldCompleteness: {
      seoTitle: { count: withSeoTitle, percent: pct(withSeoTitle) },
      seoDescription: { count: withSeoDesc, percent: pct(withSeoDesc) },
      metaKeywords: { count: withKeywords, percent: pct(withKeywords) },
      coverImage: { count: withCover, percent: pct(withCover) },
    },
    avgReadingMinutes: published.length
      ? Math.round((published.reduce((s, a) => s + (a.readingMinutes || 0), 0) / published.length) * 10) / 10
      : 0,
    topArticlesByViews: topArticles,
    existingKeywords,
  };
}

async function gatherStrategy() {
  const strategy = await db.seoStrategy.findFirst({
    where: { isActive: true },
    orderBy: { version: "desc" },
  });
  if (!strategy) return null;

  let content: any = null;
  try {
    content = JSON.parse(strategy.content);
  } catch {
    content = null;
  }

  const pillars: string[] = Array.isArray(content?.contentPillars)
    ? content.contentPillars
        .map((p: any) => (typeof p === "string" ? p : String(p?.name ?? p?.title ?? "")))
        .filter(Boolean)
    : [];
  const keywords: any[] = Array.isArray(content?.targetKeywords) ? content.targetKeywords : [];
  // توزیع امتیاز فرصت: بالا ≥۷۵ | متوسط ≥۵۰ | پایین <۵۰
  const opp = { high: 0, medium: 0, low: 0 };
  for (const k of keywords) {
    const s = Number(k?.opportunityScore ?? 0);
    if (s >= 75) opp.high++;
    else if (s >= 50) opp.medium++;
    else opp.low++;
  }
  const clustersCount = Array.isArray(content?.clusters) ? content.clusters.length : 0;
  const calendarCount = Array.isArray(content?.contentCalendar) ? content.contentCalendar.length : 0;

  return {
    version: strategy.version,
    summary: strategy.summary,
    plannedCount: strategy.plannedCount,
    lastRunAt: strategy.lastRunAt?.toISOString() ?? null,
    createdAt: strategy.createdAt.toISOString(),
    pillars,
    pillarsCount: pillars.length,
    clustersCount,
    calendarCount,
    keywordsCount: keywords.length,
    opportunityDistribution: opp,
    targetKeywordsSample: keywords.slice(0, 30).map((k) => ({
      keyword: k?.keyword,
      intent: k?.intent,
      difficulty: k?.difficulty,
      pillar: k?.pillar,
      searchVolume: k?.searchVolume,
      monetization: k?.monetization,
      opportunityScore: k?.opportunityScore,
    })),
  };
}

async function gatherQueue() {
  const byStatus = await db.seoArticlePlan.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  let total = 0;
  for (const g of byStatus) {
    map[g.status] = g._count._all;
    total += g._count._all;
  }
  // ۱۰ آیتم بالای صف برای نمونه
  const queuedSample = await db.seoArticlePlan.findMany({
    where: { status: { in: ["planned", "queued"] } },
    orderBy: { priority: "desc" },
    take: 10,
    select: { keyword: true, title: true, category: true, priority: true },
  });
  return { total, byStatus: map, queuedSample };
}

async function gatherRuns() {
  const runs = await db.seoAgentRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      mode: true,
      status: true,
      requestedCount: true,
      successCount: true,
      failCount: true,
      durationMs: true,
      startedAt: true,
    },
  });
  return runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() }));
}

async function gatherUploadedReport() {
  try {
    const { report, insights } = await getSeoReport();
    if (!report) return null;
    return {
      fileName: report.fileName,
      uploadedAt: report.uploadedAt,
      rowsAnalyzed: report.rowsAnalyzed,
      totalRowsFound: report.totalRowsFound ?? null,
      truncated: report.truncated ?? false,
      totals: report.totals,
      topQueries: report.topQueries.slice(0, 10).map((q) => ({
        query: q.query,
        clicks: q.clicks,
        impressions: q.impressions,
        position: q.position,
      })),
      opportunities: report.opportunities.slice(0, 10),
      aiInsights: insights
        ? {
            executiveSummary: insights.executiveSummary,
            quickWins: insights.quickWins?.slice(0, 5) ?? [],
            updateTargets: insights.updateTargets?.slice(0, 5) ?? [],
          }
        : null,
    };
  } catch {
    return null;
  }
}

async function gatherSiteStructure() {
  // خطای هر شمارش کل تحلیل را نمی‌کشد
  const safeCount = async (fn: () => Promise<number>, fallback = 0) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const [exercises, foods] = await Promise.all([
    safeCount(() => db.exerciseLibrary.count()),
    safeCount(() => db.foodLibrary.count()),
  ]);
  return {
    staticPages: 6, // لندینگ، مقالات، TDEE، حرکات، غذاها، ورود — صفحات همیشگی فیتاپ
    exercises,
    foods,
    note: "بانک حرکات ورزشی و مواد غذایی، صفحات پویای سئوپذیر سایت هستند",
  };
}

/* ─────────────────────── API ─────────────────────── */

export async function GET() {
  try {
    await requireAdmin();
    const analysis = await readSavedAnalysis();
    return Response.json({ ok: true, analysis, generatedAt: analysis?.generatedAt ?? null });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(_req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return apiError(e);
  }

  // جمع‌آوری داده‌ها — خطای هر بخش داده، تحلیل را نمی‌کشد (به‌صورت null/empty به مدل می‌رود)
  let context: Record<string, any>;
  try {
    const [articles, strategy, queue, runs, uploadedReport, siteStructure] = await Promise.all([
      gatherArticleStats().catch(() => null),
      gatherStrategy().catch(() => null),
      gatherQueue().catch(() => null),
      gatherRuns().catch(() => null),
      gatherUploadedReport(),
      gatherSiteStructure(),
    ]);
    context = {
      generatedAt: new Date().toISOString(),
      articles,
      uploadedReport,
      strategy,
      queue,
      recentRuns: runs,
      siteStructure,
    };
  } catch (e) {
    console.error("[seo-analyze] خطا در جمع‌آوری داده‌ها:", e);
    return Response.json(
      { error: "خطا در جمع‌آوری داده‌های سایت. لطفاً دوباره تلاش کنید." },
      { status: 500 }
    );
  }

  // فراخوانی LLM — شکست = پیام فارسی تمیز ۵۰۰ (در سندباکس بدون کلید AVALAI هم همین مسیر تمیز است)
  try {
    const analysis = await analyzeSeoComprehensive(context);
    const generatedAt = await saveAnalysis(analysis);
    return Response.json({ ok: true, analysis, generatedAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تحلیل هوشمند ناموفق بود";
    console.error("[seo-analyze] تحلیل هوشمند ناموفق:", msg.slice(0, 300));
    return Response.json({ error: msg }, { status: 500 });
  }
}
