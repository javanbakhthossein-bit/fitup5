import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import {
  runSmartAnalysis,
  isSmartRange,
  SMART_RANGES,
  type SmartAnalysisRange,
  type SmartAnalysisReportRow,
} from "@/lib/fitness/smart-analysis";

/**
 * GET /api/admin/smart-analysis?range=1d   (v53 — تحلیل هوشمند سایت)
 *
 * آخرین گزارش تحلیل هوشمندِ همان بازه + تاریخچهٔ ۳۰ ردیف آخر:
 *  - latest: ردیف اخیر با payload/actions پارس‌شده به JSON (null = بدون داده)
 *  - history: [{ id, createdAt, healthScore, trigger, summary(۱۴۰ کاراکتر از report) }]
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const rangeParam = searchParams.get("range") || "1d";
    if (!isSmartRange(rangeParam)) {
      return Response.json(
        { error: `بازهٔ نامعتبر است — مقادیر مجاز: ${SMART_RANGES.join(" | ")}` },
        { status: 400 }
      );
    }

    const [latest, history] = await Promise.all([
      db.smartAnalysisReport.findFirst({
        where: { range: rangeParam },
        orderBy: { createdAt: "desc" },
      }),
      db.smartAnalysisReport.findMany({
        where: { range: rangeParam },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, createdAt: true, healthScore: true, trigger: true, report: true },
      }),
    ]);

    return Response.json({
      latest: latest ? serializeRow(latest) : null,
      history: history.map((h) => ({
        id: h.id,
        createdAt: h.createdAt.toISOString(),
        healthScore: h.healthScore,
        trigger: h.trigger,
        summary: (h.report || "").replace(/\s+/g, " ").trim().slice(0, 140),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/smart-analysis
 * body: { range: "1d" | "7d" | "30d" | "90d" | "180d" | "365d" }
 *
 * اجرای همان‌لحظهٔ تحلیل (trigger=manual). گارد requireAdmin + rate-limit سبک:
 * آخرین گزارش manual کمتر از ۶۰ ثانیه قبل → 429.
 * شکست AI → 502 با پیام فارسی.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e) {
    return apiError(e);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const range = (body?.range as SmartAnalysisRange) || "1d";
    if (!isSmartRange(range)) {
      return Response.json(
        { error: `بازهٔ نامعتبر است — مقادیر مجاز: ${SMART_RANGES.join(" | ")}` },
        { status: 400 }
      );
    }

    // ─── rate-limit سبک: یک تحلیل manual در هر ۶۰ ثانیه ───
    const lastManual = await db.smartAnalysisReport.findFirst({
      where: { range, trigger: "manual" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (lastManual && Date.now() - lastManual.createdAt.getTime() < 60_000) {
      return Response.json(
        { error: "یک تحلیل همین چند لحظه قبل اجرا شده — چند لحظه صبر کنید و دوباره تلاش کنید." },
        { status: 429 }
      );
    }

    const row = await runSmartAnalysis(range, "manual");
    return Response.json({ ok: true, report: serializeRow(row) });
  } catch (e) {
    // شکست AI/دیتابیس — پیام فارسی از throw بالادستی
    console.error("[smart-analysis] POST failed:", e instanceof Error ? e.message : e);
    return Response.json(
      {
        error:
          e instanceof Error && e.message
            ? e.message
            : "اجرای تحلیل هوشمند ناموفق بود. لطفاً کمی بعد دوباره تلاش کنید.",
      },
      { status: 502 }
    );
  }
}

/* ─────────────────────── serializer ─────────────────────── */

function parseJsonSafe(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serializeRow(row: SmartAnalysisReportRow) {
  return {
    id: row.id,
    range: row.range,
    rangeStart: row.rangeStart.toISOString(),
    rangeEnd: row.rangeEnd.toISOString(),
    payload: parseJsonSafe(row.payload),
    report: row.report,
    actions: parseJsonSafe(row.actions),
    healthScore: row.healthScore,
    trigger: row.trigger,
    createdAt: row.createdAt.toISOString(),
  };
}
