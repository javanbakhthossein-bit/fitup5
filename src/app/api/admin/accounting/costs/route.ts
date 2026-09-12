import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import {
  computeCostsForRange,
  getUsdRateToman,
  setUsdRateToman,
  getSmsCostPerMessageToman,
  setSmsCostPerMessageToman,
  getModelCosts,
  setModelCosts,
  fetchUsdRateFromWeb,
  type ModelCostsRecord,
} from "@/lib/fitness/costs";

/**
 * GET /api/admin/accounting/costs?from=ISO&to=ISO
 *
 * هزینه‌ها + ریز شکست‌ها + تنظیمات قابل‌ویرایش برای سابتَب «هزینه‌ها و سود»
 * حسابداری. مستقل از route overview است (بازهٔ خودش را می‌گیرد).
 * پیش‌فرض بازه: ابتدای ماه جاری میلادی تا الان.
 *
 * پاسخ:
 * {
 *   range: { from, to },
 *   costs: { smsCostToman, smsSentCount, smsFailedCount, aiCostToman, aiCostUsd,
 *            aiCallCount, aiTotalTokens, gatewayFeeToman, totalCostsToman,
 *            profitToman, legacySmsEstimate: { count, costToman } },
 *   breakdowns: { smsByScenario[], aiByModel[] },
 *   settings: { usdRateToman, smsCostPerMessageToman, modelCosts }
 * }
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
      : new Date(now.getFullYear(), now.getMonth(), 1); // ابتدای ماه جاری
    if (isNaN(from.getTime())) return Response.json({ error: "تاریخ شروع نامعتبر است." }, { status: 400 });
    if (from > to) return Response.json({ error: "تاریخ شروع باید قبل از پایان باشد." }, { status: 400 });

    // درآمد خالص و کارمزد درگاه همین بازه — برای محاسبهٔ سود نهایی
    const paymentRows = await db.payment.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { amount: true, status: true, fee: true },
    });
    let netRevenue = 0;
    let gatewayFeeToman = 0;
    for (const p of paymentRows) {
      if (p.status !== "success") continue;
      netRevenue += p.amount;
      gatewayFeeToman += p.fee || 0;
    }
    const refundRows = paymentRows.filter((p) => p.status === "refunded");
    netRevenue -= refundRows.reduce((s, p) => s + Math.max(0, p.amount), 0);

    const [breakdown, usdRateToman, smsCostPerMessageToman, modelCosts] = await Promise.all([
      computeCostsForRange(from, to, netRevenue, gatewayFeeToman),
      getUsdRateToman(),
      getSmsCostPerMessageToman(),
      getModelCosts(),
    ]);

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      ...breakdown,
      settings: {
        usdRateToman,
        smsCostPerMessageToman,
        modelCosts,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/admin/accounting/costs
 * body: { action: "refreshUsdRate" }
 *     | { action: "saveSettings", usdRateToman?, smsCostPerMessageToman? }
 *     | { action: "saveModelCosts", modelCosts: Record<string, {input?, output?, flat?}> }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.action !== "string") {
      return Response.json({ error: "درخواست نامعتبر است." }, { status: 400 });
    }

    // ─── به‌روزرسانی نرخ دلار از وب (TGJU) ───
    if (body.action === "refreshUsdRate") {
      const r = await fetchUsdRateFromWeb();
      if (!r.ok) {
        return Response.json({ ok: false, error: r.error || "واکشی نرخ دلار ناموفق بود." }, { status: 502 });
      }
      return Response.json({ ok: true, rate: r.rate, source: "tgju" });
    }

    // ─── ذخیرهٔ نرخ دلار / هزینهٔ پیامک ───
    if (body.action === "saveSettings") {
      const updated: string[] = [];
      if (body.usdRateToman !== undefined) {
        const n = Number(body.usdRateToman);
        if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n) {
          return Response.json({ error: "نرخ دلار باید عدد صحیح مثبت باشد." }, { status: 400 });
        }
        await setUsdRateToman(n);
        updated.push("usdRateToman");
      }
      if (body.smsCostPerMessageToman !== undefined) {
        const n = Number(body.smsCostPerMessageToman);
        if (!Number.isFinite(n) || n <= 0 || Math.round(n) !== n) {
          return Response.json({ error: "هزینهٔ پیامک باید عدد صحیح مثبت باشد." }, { status: 400 });
        }
        await setSmsCostPerMessageToman(n);
        updated.push("smsCostPerMessageToman");
      }
      if (updated.length === 0) {
        return Response.json({ error: "چیزی برای ذخیره ارسال نشده است." }, { status: 400 });
      }
      const [usdRateToman, smsCostPerMessageToman] = await Promise.all([
        getUsdRateToman(),
        getSmsCostPerMessageToman(),
      ]);
      return Response.json({ ok: true, updated, settings: { usdRateToman, smsCostPerMessageToman } });
    }

    // ─── ذخیرهٔ جدول قیمت مدل‌ها ───
    if (body.action === "saveModelCosts") {
      const mc = body.modelCosts;
      if (!mc || typeof mc !== "object" || Array.isArray(mc)) {
        return Response.json({ error: "جدول قیمت مدل‌ها نامعتبر است." }, { status: 400 });
      }
      const clean: ModelCostsRecord = {};
      const MAX_USD_PER_1M = 1000; // سقف منطقی برای جلوگیری از خطای تایپ
      for (const [model, entryRaw] of Object.entries(mc as Record<string, unknown>)) {
        if (!model.trim() || !entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
          return Response.json({ error: `ورودی نامعتبر برای مدل «${model}».` }, { status: 400 });
        }
        const e = entryRaw as Record<string, unknown>;
        const input = e.input === undefined || e.input === null ? undefined : Number(e.input);
        const output = e.output === undefined || e.output === null ? undefined : Number(e.output);
        const flat = e.flat === undefined || e.flat === null ? undefined : Number(e.flat);
        const check = (v: number | undefined, name: string) => {
          if (v === undefined) return;
          if (!Number.isFinite(v) || v < 0 || v > MAX_USD_PER_1M) {
            throw new Error(`مقدار ${name} مدل «${model}» باید بین ۰ تا ${MAX_USD_PER_1M} دلار باشد.`);
          }
        };
        try {
          check(input, "input");
          check(output, "output");
          check(flat, "flat");
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : "ورودی نامعتبر" }, { status: 400 });
        }
        if (input === undefined && output === undefined && flat === undefined) {
          return Response.json({ error: `برای مدل «${model}» هیچ قیمتی وارد نشده است.` }, { status: 400 });
        }
        if (flat !== undefined && (input !== undefined || output !== undefined)) {
          return Response.json({ error: `مدل «${model}»: حالت flat با input/output قابل ترکیب نیست.` }, { status: 400 });
        }
        const entry: { input?: number; output?: number; flat?: number } = {};
        if (flat !== undefined) entry.flat = flat;
        if (input !== undefined) entry.input = input;
        if (output !== undefined) entry.output = output;
        clean[model.trim()] = entry;
      }
      if (Object.keys(clean).length === 0) {
        return Response.json({ error: "جدول قیمت خالی است." }, { status: 400 });
      }
      await setModelCosts(clean);
      return Response.json({ ok: true, modelCosts: await getModelCosts() });
    }

    return Response.json({ error: "اکشن ناشناخته است." }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
