/**
 * ============================================================
 *  v52 — حسابداری هزینه‌ها (COSTS-SHARED)
 * ============================================================
 * منبع واحد محاسبهٔ هزینه‌های عملیاتی برای «حسابداری مدیریت»:
 *  ۱. هزینهٔ پیامک — از پاسخ واقعی sms.ir (cost) با لاگ SmsMessageLog
 *  ۲. هزینهٔ هوش مصنوعی — قیمت دلاری هر مدل × نرخ دلار روز (SiteSetting)
 *
 * همهٔ تنظیمات در SiteSetting ذخیره می‌شوند و از پنل ادمین
 * (تب حسابداری ← «هزینه‌ها و سود») قابل ویرایش‌اند:
 *   • usd_rate_toman               → نرخ هر دلار به تومان (پیش‌فرض ۱۱۰٬۰۰۰)
 *   • sms_cost_per_message_toman   → هزینهٔ هر پیامک به تومان (پیش‌فرض ۲۵۰)
 *   • ai_model_costs               → JSON قیمت هر مدل (دلار به‌ازای ۱M توکن، یا flat per-call)
 *
 * قیمت‌های پیش‌فرض مدل‌ها برآوردِ محافظه‌کارانه بر اساس مستندات قیمت
 * AvalAI (https://avalai.ir/pricing) هستند و باید توسط مالک با قیمت‌های
 * واقعی پنل خود تنظیم شوند — جدول از پنل ادمین قابل ویرایش است.
 */

import { db } from "@/lib/db";

// ─── پیش‌فرض‌ها ───

export const DEFAULT_USD_RATE_TOMAN = 110_000;
export const DEFAULT_SMS_COST_PER_MESSAGE_TOMAN = 250;

/** قیمت پیش‌فرض مدل ناشناخته — دلار به‌ازای هر ۱M توکن ورودی */
export const DEFAULT_INPUT_USD_PER_1M = 0.3;
/** قیمت پیش‌فرض مدل ناشناخته — دلار به‌ازای هر ۱M توکن خروجی */
export const DEFAULT_OUTPUT_USD_PER_1M = 1.2;

export interface ModelCostEntry {
  /** دلار به‌ازای هر ۱M توکن ورودی (برای مدل‌های flat لازم نیست) */
  input?: number;
  /** دلار به‌ازای هر ۱M توکن خروجی (برای مدل‌های flat لازم نیست) */
  output?: number;
  /** هزینهٔ ثابت هر فراخوانی به دلار — برای TTS/تصویر (بدون توکن) */
  flat?: number;
}

export type ModelCostsRecord = Record<string, ModelCostEntry>;

/**
 * قیمت‌های پیش‌فرض مدل‌های استفاده‌شده در سیستم (ai.ts / tts.ts / avalai-image.ts).
 * ⚠️ این اعداد «برآورد» هستند (مستندات AvalAI: https://avalai.ir/pricing) و
 * مالک باید آنها را با قیمت واقعی پنل AvalAI تنظیم کند — از پنل ادمین
 * (حسابداری ← هزینه‌ها و سود) بدون تغییر کد قابل ویرایش است.
 */
export const DEFAULT_MODEL_COSTS: ModelCostsRecord = {
  // v73 — مدل اصلی سیستم (متن + ویژن + تولید برنامه با تفکر مکس)
  // تعرفهٔ ثابت AvalAI: ورودی $0.15/1M (کش $0.003)، خروجی $0.60/1M
  "deepseek-v4.1-flash": { input: 0.15, output: 0.6 },
  // مدل فال‌بک سراسری (متن/ویژن/برنامه) — کلاس flash گوگل
  "gemini-3.8-flash": { input: 0.3, output: 1.2 },
  // مدل ویژن فال‌بک قدیمی (پیش از مهاجرت v73)
  "gemini-3.5-flash": { input: 0.15, output: 0.6 },
  // مدل متنی قدیمی (بازنشسته شده توسط DeepSeek — برای لاگ‌های تاریخی نگه داشته می‌شود)
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  // TTS — مدل صوتی، هزینهٔ ثابت هر فراخوانی (برآورد ~۱۵ ثانیه صدا)
  "gemini-2.5-flash-tts": { flat: 0.004 },
  // فال‌بک TTS قدیمی (OpenAI tts-1 از طریق AvalAI)
  "tts-1": { flat: 0.006 },
  // تولید تصویر (Nano Banana 2 Lite) — هزینهٔ ثابت هر تصویر
  "gemini-3.1-flash-lite-image": { flat: 0.012 },
};

// ─── کلیدهای SiteSetting ───

export const KEY_USD_RATE = "usd_rate_toman";
export const KEY_SMS_COST = "sms_cost_per_message_toman";
export const KEY_MODEL_COSTS = "ai_model_costs";

// ─── کش درون‌ماژول (۶۰ ثانیه) ───

const CACHE_TTL_MS = 60_000;
let usdRateCache: { value: number; at: number } | null = null;
let smsCostCache: { value: number; at: number } | null = null;
let modelCostsCache: { value: ModelCostsRecord; at: number } | null = null;

/** ابطال کش‌ها — بعد از ذخیرهٔ تنظیمات جدید صدا زده می‌شود */
export function invalidateCostsCache(): void {
  usdRateCache = null;
  smsCostCache = null;
  modelCostsCache = null;
}

function parsePositiveInt(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(String(raw).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

// ─── نرخ دلار ───

/** نرخ هر دلار به تومان — از SiteSetting با کش ۶۰ثانیه‌ای */
export async function getUsdRateToman(): Promise<number> {
  const now = Date.now();
  if (usdRateCache && now - usdRateCache.at < CACHE_TTL_MS) return usdRateCache.value;
  try {
    const row = await db.siteSetting.findUnique({ where: { key: KEY_USD_RATE } });
    const value = parsePositiveInt(row?.value, DEFAULT_USD_RATE_TOMAN);
    usdRateCache = { value, at: now };
    return value;
  } catch {
    return DEFAULT_USD_RATE_TOMAN;
  }
}

/** ذخیرهٔ نرخ دلار در SiteSetting + ابطال کش */
export async function setUsdRateToman(v: number): Promise<void> {
  const rounded = Math.round(v);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error("نرخ دلار باید عددی مثبت باشد.");
  }
  await db.siteSetting.upsert({
    where: { key: KEY_USD_RATE },
    create: { key: KEY_USD_RATE, value: String(rounded), label: "نرخ دلار (تومان)" },
    update: { value: String(rounded) },
  });
  usdRateCache = { value: rounded, at: Date.now() };
}

function normalizePersianDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[,\s٬]/g, "");
}

/**
 * واکشی best-effort نرخ دلار از TGJU (رایگان، بدون کلید).
 * ساختار پاسخ: { current: { price_dollar_rl: { p: "۲٬۲۶۷٬۰۰۰" } }, ... }
 * (در نسخه‌های قدیمی‌تر همین آبجکت در ریشهٔ پاسخ بود — هر دو پوشش داده می‌شود)
 * قیمت به «ریال» است → تومان = ریال ÷ ۱۰. موفقیت → ذخیره در SiteSetting. هرگز throw نمی‌کند.
 */
export async function fetchUsdRateFromWeb(): Promise<{ ok: boolean; rate?: number; error?: string }> {
  try {
    const res = await fetch("https://call5.tgju.org/ajax.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { ok: false, error: `پاسخ TGJU با کد ${res.status} برگشت.` };
    }
    const data = (await res.json()) as {
      price_dollar_rl?: { p?: string };
      current?: { price_dollar_rl?: { p?: string } };
    };
    const raw = data?.current?.price_dollar_rl?.p ?? data?.price_dollar_rl?.p;
    if (!raw) {
      return { ok: false, error: "فیلد قیمت دلار در پاسخ TGJU یافت نشد." };
    }
    const rial = Number(normalizePersianDigits(String(raw)));
    if (!Number.isFinite(rial) || rial <= 0) {
      return { ok: false, error: `قیمت نامعتبر از TGJU: ${raw}` };
    }
    const rate = Math.round(rial / 10); // ریال → تومان
    await setUsdRateToman(rate);
    return { ok: true, rate };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "خطای ناشناخته در واکشی نرخ دلار" };
  }
}

// ─── هزینهٔ پیامک ───

/** هزینهٔ هر پیامک به تومان — پیش‌فرض ۲۵۰ (قابل ویرایش از پنل) */
export async function getSmsCostPerMessageToman(): Promise<number> {
  const now = Date.now();
  if (smsCostCache && now - smsCostCache.at < CACHE_TTL_MS) return smsCostCache.value;
  try {
    const row = await db.siteSetting.findUnique({ where: { key: KEY_SMS_COST } });
    const value = parsePositiveInt(row?.value, DEFAULT_SMS_COST_PER_MESSAGE_TOMAN);
    smsCostCache = { value, at: now };
    return value;
  } catch {
    return DEFAULT_SMS_COST_PER_MESSAGE_TOMAN;
  }
}

/** ذخیرهٔ هزینهٔ هر پیامک در SiteSetting + ابطال کش */
export async function setSmsCostPerMessageToman(v: number): Promise<void> {
  const rounded = Math.round(v);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error("هزینهٔ هر پیامک باید عددی مثبت باشد.");
  }
  await db.siteSetting.upsert({
    where: { key: KEY_SMS_COST },
    create: { key: KEY_SMS_COST, value: String(rounded), label: "هزینهٔ هر پیامک (تومان)" },
    update: { value: String(rounded) },
  });
  smsCostCache = { value: rounded, at: Date.now() };
}

// ─── قیمت مدل‌های AI ───

/** جدول قیمت مدل‌ها — پیش‌فرض‌ها + override ذخیره‌شدهٔ ادمین (کش ۶۰ثانیه‌ای) */
export async function getModelCosts(): Promise<ModelCostsRecord> {
  const now = Date.now();
  if (modelCostsCache && now - modelCostsCache.at < CACHE_TTL_MS) return modelCostsCache.value;
  let merged: ModelCostsRecord = { ...DEFAULT_MODEL_COSTS };
  try {
    const row = await db.siteSetting.findUnique({ where: { key: KEY_MODEL_COSTS } });
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as ModelCostsRecord;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          merged = { ...merged, ...parsed };
        }
      } catch {
        // JSON خراب → فقط پیش‌فرض‌ها
      }
    }
    modelCostsCache = { value: merged, at: now };
  } catch {
    // خطای DB → پیش‌فرض‌ها
  }
  return merged;
}

/** ذخیرهٔ کل جدول قیمت مدل‌ها (override روی پیش‌فرض‌ها) + ابطال کش */
export async function setModelCosts(record: ModelCostsRecord): Promise<void> {
  const json = JSON.stringify(record);
  await db.siteSetting.upsert({
    where: { key: KEY_MODEL_COSTS },
    create: { key: KEY_MODEL_COSTS, value: json, label: "قیمت مدل‌های هوش مصنوعی (دلار)" },
    update: { value: json },
  });
  modelCostsCache = { value: { ...DEFAULT_MODEL_COSTS, ...record }, at: Date.now() };
}

/**
 * هزینهٔ دلاری یک فراخوانی مدل:
 *  • مدل flat (TTS/تصویر) → همان flat
 *  • بقیه → (prompt/1M × input) + (completion/1M × output)
 *  • مدل ناشناخته → DEFAULT_INPUT/OUTPUT_USD_PER_1M
 */
export async function computeModelCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): Promise<number> {
  const costs = await getModelCosts();
  const entry = model ? costs[model] : undefined;
  if (entry && typeof entry.flat === "number" && Number.isFinite(entry.flat)) {
    return Math.max(0, entry.flat);
  }
  const inputPer1M =
    entry && typeof entry.input === "number" && Number.isFinite(entry.input)
      ? entry.input
      : DEFAULT_INPUT_USD_PER_1M;
  const outputPer1M =
    entry && typeof entry.output === "number" && Number.isFinite(entry.output)
      ? entry.output
      : DEFAULT_OUTPUT_USD_PER_1M;
  const cost =
    (Math.max(0, promptTokens) / 1_000_000) * inputPer1M +
    (Math.max(0, completionTokens) / 1_000_000) * outputPer1M;
  return Math.max(0, cost);
}

// ─── لاگرهای best-effort (هرگز جریان اصلی را نمی‌شکنند) ───

export interface AiUsageLogInput {
  route: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs?: number;
  userId?: string | null;
}

/**
 * ثبت مصرف هوش مصنوعی در AiUsageLog — best-effort.
 * هزینهٔ دلاری از جدول قیمت مدل‌ها و تومان با نرخ دلار لحظهٔ ثبت محاسبه می‌شود.
 * شکست فقط console.error — هرگز throw نمی‌کند.
 */
export async function logAiUsage(input: AiUsageLogInput): Promise<void> {
  try {
    const costUsd = await computeModelCostUsd(
      input.model,
      input.promptTokens,
      input.completionTokens
    );
    const rate = await getUsdRateToman();
    await db.aiUsageLog.create({
      data: {
        route: input.route || "unknown",
        model: input.model || "unknown",
        promptTokens: Math.max(0, Math.round(input.promptTokens || 0)),
        completionTokens: Math.max(0, Math.round(input.completionTokens || 0)),
        totalTokens: Math.max(0, Math.round(input.totalTokens || 0)),
        costUsd,
        costToman: Math.round(costUsd * rate),
        latencyMs:
          typeof input.latencyMs === "number" && Number.isFinite(input.latencyMs)
            ? Math.max(0, Math.round(input.latencyMs))
            : null,
        userId: input.userId ?? null,
      },
    });
  } catch (e) {
    console.error("[costs] logAiUsage failed:", e instanceof Error ? e.message : e);
  }
}

export interface SmsCostLogInput {
  mobile: string;
  scenario: string;
  templateId?: string | null;
  status: "sent" | "failed";
  cost: number;
  error?: string | null;
  userId?: string | null;
  provider?: string;
}

/**
 * ثبت یک ارسال پیامک در SmsMessageLog — best-effort.
 * ⚠️ جدول SmsLog (داپ ابدی) کاملاً مستقل است و به این تابع ربطی ندارد.
 */
export async function logSmsCost(input: SmsCostLogInput): Promise<void> {
  try {
    await db.smsMessageLog.create({
      data: {
        mobile: input.mobile,
        scenario: input.scenario || "custom",
        templateId: input.templateId ?? null,
        provider: input.provider || "smsir",
        status: input.status === "failed" ? "failed" : "sent",
        cost: Math.max(0, Math.round(input.cost || 0)),
        error: input.error ?? null,
        userId: input.userId ?? null,
      },
    });
  } catch (e) {
    console.error("[costs] logSmsCost failed:", e instanceof Error ? e.message : e);
  }
}

// ─── محاسبهٔ تجمیعی هزینه‌های یک بازه (برای routeهای حسابداری) ───

export interface CostsBreakdown {
  costs: {
    smsCostToman: number;
    smsSentCount: number;
    smsFailedCount: number;
    aiCostToman: number;
    aiCostUsd: number;
    aiCallCount: number;
    aiTotalTokens: number;
    gatewayFeeToman: number;
    totalCostsToman: number;
    profitToman: number;
    legacySmsEstimate: { count: number; costToman: number };
  };
  breakdowns: {
    smsByScenario: { scenario: string; costToman: number; count: number }[];
    aiByModel: { model: string; costToman: number; totalTokens: number; count: number }[];
  };
}

/**
 * محاسبهٔ کامل هزینه‌های یک بازه: پیامک (از SmsMessageLog) + هوش مصنوعی
 * (از AiUsageLog) + کارمزد درگاه (از Payment.fee) + برآورد ارسال‌های
 * قدیمی‌تر از قبل از راه‌اندازی لاگ (SmsLog/OtpCode × نرخ پیامک).
 *
 * @param netRevenue درآمد خالص بازه (پرداخت موفق − مستردشده) برای محاسبهٔ سود
 * @param gatewayFeeToman جمع کارمزد درگاه بازه (خروجی computePaymentKpis.feeTotal)
 */
export async function computeCostsForRange(
  from: Date,
  to: Date,
  netRevenue: number,
  gatewayFeeToman: number
): Promise<CostsBreakdown> {
  const rangeWhere = { createdAt: { gte: from, lte: to } };

  const [smsSentAgg, smsSentCount, smsFailedCount, aiAgg, firstLog] = await Promise.all([
    db.smsMessageLog.aggregate({
      where: { ...rangeWhere, status: "sent" },
      _sum: { cost: true },
    }),
    db.smsMessageLog.count({ where: { ...rangeWhere, status: "sent" } }),
    db.smsMessageLog.count({ where: { ...rangeWhere, status: "failed" } }),
    db.aiUsageLog.aggregate({
      where: rangeWhere,
      _sum: { costToman: true, costUsd: true, totalTokens: true },
      _count: true,
    }),
    // اولین لاگ پیامک — مرز «ارسال‌های قدیمی‌تر» (قبل از راه‌اندازی لاگ)
    db.smsMessageLog.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const smsCostToman = smsSentAgg._sum.cost || 0;
  const aiCostToman = aiAgg._sum.costToman || 0;
  const aiCostUsd = Math.round((aiAgg._sum.costUsd || 0) * 100) / 100;
  const totalCostsToman = smsCostToman + aiCostToman + Math.max(0, gatewayFeeToman);

  // ─── برآورد ارسال‌های قدیمی‌تر (قبل از وجود SmsMessageLog) ───
  // اگر هیچ لاگی نیست → firstLog = now (همهٔ ردیف‌های قدیمی برآورد می‌شوند).
  let legacyCount = 0;
  try {
    const cutoff = firstLog?.createdAt ?? new Date();
    const legacyWhere = { createdAt: { gte: from, lte: to, lt: cutoff } };
    const [smsLedgerCount, otpCount] = await Promise.all([
      db.smsLog.count({ where: { ...legacyWhere, status: "sent" } }),
      db.otpCode.count({ where: legacyWhere }),
    ]);
    legacyCount = smsLedgerCount + otpCount;
  } catch (e) {
    console.error("[costs] legacySmsEstimate failed:", e instanceof Error ? e.message : e);
  }
  const legacyCostToman = legacyCount * (await getSmsCostPerMessageToman());

  // ─── ریز شکست‌ها (top 10) ───
  const [smsByScenarioRaw, aiByModelRaw] = await Promise.all([
    db.smsMessageLog
      .groupBy({
        by: ["scenario"],
        where: { ...rangeWhere, status: "sent" },
        _sum: { cost: true },
        _count: true,
        orderBy: { _sum: { cost: "desc" } },
        take: 10,
      })
      .catch(() => []),
    db.aiUsageLog
      .groupBy({
        by: ["model"],
        where: rangeWhere,
        _sum: { costToman: true, totalTokens: true },
        _count: true,
        orderBy: { _sum: { costToman: "desc" } },
        take: 10,
      })
      .catch(() => []),
  ]);

  return {
    costs: {
      smsCostToman,
      smsSentCount,
      smsFailedCount,
      aiCostToman,
      aiCostUsd,
      aiCallCount: aiAgg._count,
      aiTotalTokens: aiAgg._sum.totalTokens || 0,
      gatewayFeeToman: Math.max(0, gatewayFeeToman),
      totalCostsToman,
      profitToman: netRevenue - totalCostsToman,
      legacySmsEstimate: { count: legacyCount, costToman: legacyCostToman },
    },
    breakdowns: {
      smsByScenario: smsByScenarioRaw.map((s) => ({
        scenario: s.scenario,
        costToman: s._sum.cost || 0,
        count: s._count,
      })),
      aiByModel: aiByModelRaw.map((m) => ({
        model: m.model,
        costToman: m._sum.costToman || 0,
        totalTokens: m._sum.totalTokens || 0,
        count: m._count,
      })),
    },
  };
}
