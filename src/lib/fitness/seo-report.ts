/**
 * گزارش آپلودشدهٔ Google Search Console (درخواست مالک — تب «سئو هوشمند»)
 *
 * مالک یک خروجی اکسل/CSV از سرچ کنسول گوگل (Export → Excel/CSV) آپلود می‌کند؛
 * این ماژول آن را parse می‌کند، با AvalAI (v73: deepseek-v4.1-flash) تحلیل می‌کند و نتیجه را در
 * SiteSetting ذخیره می‌کند تا موتور سئو هوشمند (استراتژی/مقالات) و آپدیت
 * محتواها از دادهٔ واقعی کلیک و نمایش تغذیه شوند — حتی بدون سرویس‌اکانت GSC.
 *
 * کلیدهای SiteSetting:
 *  - seo_gsc_report           → خود گزارش پارس‌شده (SeoGscReport)
 *  - seo_gsc_report_insights  → تحلیل هوش مصنوعی (SeoAiInsights)
 */

import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { createChatCompletionWithRetry, TEXT_MODEL, TEXT_TASK_MODEL, withBrandDirective } from "@/lib/fitness/ai";

/* ─────────────────────────── تایپ‌ها ─────────────────────────── */

export interface SeoGscReport {
  uploadedAt: string;
  fileName: string;
  rowsAnalyzed: number;
  /** تعداد کل ردیف‌های معتبر موجود در فایل (قبل از اعمال سقف ۲۰۰۰) — برای گزارش «X از Y ردیف» */
  totalRowsFound?: number;
  /** آیا فایل بیشتر از سقف ۲۰۰۰ ردیف داشت؟ */
  truncated?: boolean;
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  opportunities: Array<{ query: string; impressions: number; position: number; reason: string }>;
  pages: Array<{ page: string; clicks: number; impressions: number }>;
}

export interface SeoAiInsights {
  executiveSummary: string;
  quickWins: string[];
  contentIdeas: string[];
  updateTargets: string[];
  keywordClusters: Array<{ cluster: string; queries: string[]; intent: string }>;
}

export interface ParsedQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface ParsedPageRow {
  page: string;
  clicks: number;
  impressions: number;
}

/** خروجی parse ورک‌بوک — با سقف ۲۰۰۰ ردیف و آمار کوت‌شدن */
export interface ParsedWorkbook {
  rows: ParsedQueryRow[];
  pages: ParsedPageRow[];
  /** تعداد کل ردیف‌های معتبرِ پیدا شده در فایل (حتی اگر به‌خاطر سقف ذخیره نشده باشند) */
  totalRowsFound: number;
  /** آیا ردیف‌های معتبرِ بیش از سقف وجود داشت؟ */
  truncated: boolean;
}

/** سقف ردیف‌های خوانده‌شده از گزارش آپلودی — درخواست مالک (هم‌سقف با واکشی زندهٔ API) */
export const MAX_REPORT_ROWS = 2000;

/* ─────────────────────── نگاشت هدرها (فارسی/انگلیسی) ─────────────────────── */

/** یکسان‌سازی هدر: ی/ک فارسی، حذف نیم‌فاصله، حروف کوچک، فاصلهٔ تکی */
function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\u200c/g, " ") // نیم‌فاصله → فاصله
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** مترادف‌های هر ستون (فرم نرمال‌شده) — انگلیسی و فارسی */
const HEADER_MAP: Record<"query" | "clicks" | "impressions" | "ctr" | "position" | "page", string[]> = {
  query: ["query", "query top", "top queries", "top query", "پرس وجو", "عبارت جستجو", "عبارت جست وجو", "کوئری", "کوری"],
  clicks: ["clicks", "کلیک", "تعداد کلیک"],
  impressions: ["impressions", "نمایش", "ایمپرشن", "تعداد نمایش"],
  ctr: ["ctr", "نرخ کلیک", "نرخ کلیک ها"],
  position: ["position", "میانگین ترتیب", "ترتیب", "موقعیت", "رتبه", "میانگین موقعیت"],
  page: ["landing page", "page", "top pages", "صفحه", "صفحه فرود", "صفحه فرود ها", "نشانی صفحه"],
};

/** عدد از سلول خام: «۱٬۲۳۴»، "1,234"، "5.2%"، "12,3٪" → number */
function numFrom(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return NaN;
  let s = String(v)
    .replace(/[\u06F0-\u06F9]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\u0660-\u0669]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\u066B/g, ".") // ممیز فارسی
    .replace(/[%,\u060C\u066A\u066C\s\u200c]/g, ""); // درصد/کاما/جداکنندهٔ هزارگان و عربی/فاصله/نیم‌فاصله
  if (!s || s === "-" || s === "—") return NaN;
  return parseFloat(s);
}

/** نرمال‌سازی CTR به کسر (0.027 = ۲.۷٪): سلول درصددار «2.7%» یا عدد خام 0.027 یا «2.7» خام */
function parseCtr(v: unknown): number {
  if (typeof v === "number") {
    return Number.isFinite(v) ? (v > 1 ? v / 100 : v) : 0;
  }
  const s = String(v ?? "");
  const n = numFrom(s);
  if (!Number.isFinite(n)) return 0;
  // اگر علامت درصد در متن سلول بود، دقیقاً یک‌بار بر ۱۰۰ تقسیم کن (0.6% → 0.006)
  if (/[%\u066A]/.test(s)) return n / 100;
  return n > 1 ? n / 100 : n;
}

/** ردیف خام sheet_to_json → فیلدهای شناخته‌شده بر اساس هدر */
function mapRow(row: Record<string, unknown>): {
  query: string; page: string; clicks: number; impressions: number; ctr: number; position: number;
} {
  const out = { query: "", page: "", clicks: NaN, impressions: NaN, ctr: NaN, position: NaN };
  for (const [rawKey, value] of Object.entries(row)) {
    const key = normalizeHeader(rawKey);
    if (!key) continue;
    let field: keyof typeof HEADER_MAP | null = null;
    for (const [f, synonyms] of Object.entries(HEADER_MAP) as [keyof typeof HEADER_MAP, string[]][]) {
      if (synonyms.includes(key)) { field = f; break; }
    }
    if (!field) continue;
    if (field === "query") out.query = String(value ?? "").trim();
    else if (field === "page") out.page = String(value ?? "").trim();
    else if (field === "ctr") out.ctr = parseCtr(value);
    else out[field] = numFrom(value);
  }
  return out;
}

/* ─────────────────────────── Parse ورک‌بوک ─────────────────────────── */

/**
 * همهٔ شیت‌های فایل اکسل/CSV را می‌خواند و ردیف‌های کوئری و صفحه را جدا می‌کند.
 * خروجی اکسل GSC معمولاً دو شیت دارد (Queries / Pages)؛ CSV تک‌شیت است —
 * هر دو حالت (و حتی شیت ترکیبی) با تشخیص ستونِ پُر در هر ردیف پوشش داده می‌شود.
 *
 * سقف ۲۰۰۰ ردیف (درخواست مالک): خواندن تا هر تعداد ردیفی که هست ادامه پیدا
 * می‌کند (تا تعداد کلِ ردیف‌های معتبر دقیق شمرده شود) اما فقط ۲۰۰۰ ردیفِ اول
 * ذخیره می‌شوند — اگر بیشتر بود، truncated=true و totalRowsFound تعداد واقعی است.
 */
export function parseGscWorkbook(buffer: Buffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows: ParsedQueryRow[] = [];
  const pages: ParsedPageRow[] = [];
  let totalRowsFound = 0;
  let truncated = false;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    let records: Record<string, unknown>[];
    try {
      records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    } catch {
      continue; // شیت خراب → شیت‌های بعدی ادامه می‌دهند
    }
    for (const rec of records) {
      const m = mapRow(rec);
      // ردیف‌های کاملاً خالی رد شوند
      if (!m.query && !m.page) continue;
      const hasAnyNumber = [m.clicks, m.impressions, m.ctr, m.position].some((n) => Number.isFinite(n));
      if (!hasAnyNumber) continue;

      totalRowsFound++;
      // سقف ۲۰۰۰: بشمار ولی ذخیره نکن (تا «X از Y ردیف» بتوانیم نشان بدهیم)
      if (totalRowsFound > MAX_REPORT_ROWS) {
        truncated = true;
        continue;
      }

      if (m.query) {
        rows.push({
          query: m.query,
          clicks: Number.isFinite(m.clicks) ? m.clicks : 0,
          impressions: Number.isFinite(m.impressions) ? m.impressions : 0,
          // CTR قبلاً در parseCtr به کسر نرمال شده (0.027 = ۲.۷٪)
          ctr: m.ctr,
          position: Number.isFinite(m.position) ? m.position : 0,
        });
      }
      if (m.page) {
        pages.push({
          page: m.page,
          clicks: Number.isFinite(m.clicks) ? m.clicks : 0,
          impressions: Number.isFinite(m.impressions) ? m.impressions : 0,
        });
      }
    }
  }

  return { rows, pages, totalRowsFound, truncated };
}

/* ─────────────────────── ساخت گزارش از ردیف‌ها ─────────────────────── */

export const REASON_HIGH_IMPRESSIONS = "نمایش بالا، CTR پایین — عنوان/توضیحات را بهبود بده";
export const REASON_PAGE_2_3 = "در صفحه ۲–۳ است — تقویت محتوا برای ورود به صفحه اول";

/**
 * ساخت SeoGscReport نهایی از ردیف‌های پارس‌شده:
 *  - topQueries: ۵۰ کوئری پرکلیک
 *  - opportunities: نمایش ≥ ۵۰۰ و جایگاه ۵–۳۰، یا جایگاه ۱۰.۱–۳۰ (صفحهٔ ۲–۳)
 *  - pages: ۲۰ صفحهٔ پرکلیک
 *  - totalRowsFound/truncated: سقف ۲۰۰۰ ردیف برای نمایش «X از Y ردیف»
 */
export function buildSeoGscReport(fileName: string, parsed: ParsedWorkbook): SeoGscReport {
  const { rows, pages, totalRowsFound, truncated } = parsed;
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);

  const weightedPos = rows.reduce((s, r) => s + r.position * r.impressions, 0);
  const simplePos = rows.length ? rows.reduce((s, r) => s + r.position, 0) / rows.length : 0;
  const avgPosition = totalImpressions > 0 ? weightedPos / totalImpressions : simplePos;

  const topQueries = [...rows]
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 50)
    .map((r) => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

  const opportunities = rows
    .filter((r) => {
      if (!Number.isFinite(r.position) || r.position <= 0 || r.position > 30) return false;
      const highImpression = r.impressions >= 500 && r.position >= 5;
      const pageTwoThree = r.position >= 10.1;
      return highImpression || pageTwoThree;
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30)
    .map((r) => ({
      query: r.query,
      impressions: r.impressions,
      position: r.position,
      reason: r.impressions >= 500 && r.position >= 5 ? REASON_HIGH_IMPRESSIONS : REASON_PAGE_2_3,
    }));

  const reportPages = [...pages]
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 20)
    .map((p) => ({ page: p.page, clicks: p.clicks, impressions: p.impressions }));

  return {
    uploadedAt: new Date().toISOString(),
    fileName,
    rowsAnalyzed: rows.length,
    totalRowsFound,
    truncated,
    totals: {
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      position: avgPosition,
    },
    topQueries,
    opportunities,
    pages: reportPages,
  };
}

/* ─────────────────────── خلاصهٔ متنی برای پرامپت AI ─────────────────────── */

function fa(n: number, digits = 0): string {
  const v = digits > 0 ? n.toFixed(digits) : Math.round(n).toLocaleString("en-US");
  return String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** خلاصهٔ فارسی گزارش — برای تزریق به پرامپت تحلیل AI و پرامپت استراتژی سئو */
export function buildReportSummary(report: SeoGscReport): string {
  const lines: string[] = [];
  const uploadDate = new Date(report.uploadedAt).toLocaleDateString("fa-IR");
  lines.push(`گزارش آپلودشدهٔ سرچ کنسول (فایل: ${report.fileName} — تاریخ آپلود: ${uploadDate})`);
  // سقف ۲۰۰۰ ردیف — اگر کوت‌شده بود، صادقانه ذکر شود
  const rowsLine =
    report.truncated && report.totalRowsFound
      ? `${fa(report.rowsAnalyzed)} از ${fa(report.totalRowsFound)} ردیف (سقف ۲٬۰۰۰)`
      : fa(report.rowsAnalyzed);
  lines.push(
    `جمع کلیک‌ها: ${fa(report.totals.clicks)} | جمع نمایش‌ها: ${fa(report.totals.impressions)} | CTR: ${fa(report.totals.ctr * 100, 1)}٪ | میانگین جایگاه: ${fa(report.totals.position, 1)} | تعداد ردیف تحلیل‌شده: ${rowsLine}`
  );
  if (report.truncated) {
    lines.push(`⚠️ توجه: این گزارش به ۲۰۰۰ ردیف محدود شده است (${fa(report.rowsAnalyzed)} ردیف از مجموع ${fa(report.totalRowsFound ?? report.rowsAnalyzed)} ردیف فایل) — تحلیل بر اساس پرتکرارترین ردیف‌ها است.`);
  }

  if (report.topQueries.length > 0) {
    lines.push("");
    lines.push("پرکلیک‌ترین کوئری‌های واقعی کاربران (حداکثر ۲۰ مورد):");
    report.topQueries.slice(0, 20).forEach((q, i) => {
      lines.push(
        `${fa(i + 1)}. «${q.query}» — ${fa(q.clicks)} کلیک، ${fa(q.impressions)} نمایش، CTR ${fa(q.ctr * 100, 1)}٪، جایگاه ${fa(q.position, 1)}`
      );
    });
  }

  if (report.opportunities.length > 0) {
    lines.push("");
    lines.push("فرصت‌های بهبود (اولویت‌دار بر اساس نمایش):");
    report.opportunities.slice(0, 15).forEach((o) => {
      lines.push(`- «${o.query}» — ${fa(o.impressions)} نمایش، جایگاه ${fa(o.position, 1)} — ${o.reason}`);
    });
  }

  if (report.pages.length > 0) {
    lines.push("");
    lines.push("پرکلیک‌ترین صفحه‌های سایت (حداکثر ۱۰ مورد):");
    report.pages.slice(0, 10).forEach((p) => {
      lines.push(`- ${p.page} — ${fa(p.clicks)} کلیک، ${fa(p.impressions)} نمایش`);
    });
  }

  return lines.join("\n");
}

/* ─────────────────────────── تحلیل با AI ─────────────────────────── */

/** استخراج tolerant JSON از پاسخ مدل (حذف fence، برش اولین { تا آخرین }) */
function extractJsonLoose(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function coerceInsights(obj: Record<string, unknown> | null): SeoAiInsights | null {
  if (!obj || typeof obj !== "object") return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.trim()) : [];
  const executiveSummary = typeof obj.executiveSummary === "string" ? obj.executiveSummary : "";
  const clusters = Array.isArray(obj.keywordClusters)
    ? (obj.keywordClusters as Record<string, unknown>[])
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          cluster: String(c.cluster ?? ""),
          queries: strArr(c.queries),
          intent: String(c.intent ?? "informational"),
        }))
        .filter((c) => c.cluster)
    : [];
  if (!executiveSummary) return null; // حداقلِ اعتبار
  return {
    executiveSummary,
    quickWins: strArr(obj.quickWins),
    contentIdeas: strArr(obj.contentIdeas),
    updateTargets: strArr(obj.updateTargets),
    keywordClusters: clusters,
  };
}

const INSIGHTS_JSON_SHAPE = `{
  "executiveSummary": "خلاصهٔ مدیریتی ۲-۴ جمله‌ای از وضعیت فعلی سئو بر اساس داده‌های واقعی",
  "quickWins": ["اقدام فوری کم‌هزینه با اثر سریع — بر اساس داده‌های گزارش"],
  "contentIdeas": ["ایدهٔ مقالهٔ جدید با کلمهٔ کلیدی هدف — اولویت‌دار و مستند به کوئری‌های واقعی"],
  "updateTargets": ["مقاله/صفحهٔ موجود که باید آپدیت شود + دلیل (بر اساس کوئری‌های فرصت‌دار)"],
  "keywordClusters": [{"cluster": "نام کلاستر", "queries": ["کوئری ۱", "کوئری ۲"], "intent": "informational|commercial|transactional|navigational"}]
}`;

/**
 * تحلیل گزارش با AvalAI (v73: deepseek-v4.1-flash) — خروجی STRICT JSON.
 * یک بار retry با تذکر «فقط JSON برگردان» در صورت خرابی parse.
 */
export async function analyzeReportWithAi(report: SeoGscReport): Promise<SeoAiInsights> {
  const systemPrompt = withBrandDirective(
    `تو یک استراتژیست ارشد سئوی فارسی‌زبان برای پلتفرم فیتاپ (fittup.ir — سایت محتوایی بدنسازی، تناسب اندام و تغذیه) هستی.
گزارش واقعی Google Search Console سایت به تو داده می‌شود (کوئری‌ها، کلیک، نمایش، CTR، جایگاه، صفحه‌ها).
تحلیل دقیق، عملی و مستند به همین داده‌ها ارائه بده — به زبان فارسی.

قواعد خروجی:
- فقط و فقط JSON معتبر برگردان — بدون markdown fence، بدون هیچ متن اضافه قبل یا بعد از JSON.
- ساختار JSON دقیقاً این شکلی باشد:
${INSIGHTS_JSON_SHAPE}
- quickWins/contentIdeas/updateTargets هر کدام ۳ تا ۶ آیتم؛ هر آیتم یک جملهٔ کوتاه و قابل‌اجرا.
- keywordClusters: ۳ تا ۶ کلاستر از کوئری‌های واقعی گزارش.
- اولویت‌ها را بر اساس نمایش/کلیک/جایگاه و نیت جستجو بچین؛ کلمات نزدیک به خرید (تعرفه/قیمت/برنامه/مربی) را بالاتر بیاور.`
  );

  const baseUser = `${buildReportSummary(report)}\n\nبر اساس این داده‌های واقعی، تحلیل JSON خواسته‌شده را تولید کن.`;

  const callAi = (userContent: string) =>
    createChatCompletionWithRetry(
      {
        // v73 — قاعدهٔ مالک: تحلیل گزارش سرچ‌کنسول (متن خالص) → deepseek-v4.1-flash
        model: TEXT_TASK_MODEL,
        fallback_model: TEXT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.4,
      },
      "seo-report-analyze",
      3
    );

  // تلاش اول
  const raw1 = await callAi(baseUser);
  const parsed1 = coerceInsights(extractJsonLoose(raw1));
  if (parsed1) return parsed1;

  // تلاش دوم — تذکر سخت‌گیرانه‌تر
  console.warn("[seo-report] پاسخ اول AI قابل پارس نبود — یک retry با تذکر «فقط JSON»");
  const raw2 = await callAi(`${baseUser}\n\nهشدار: پاسخ قبلی JSON معتبر نبود. فقط JSON برگردان — بدون هیچ متن دیگری.`);
  const parsed2 = coerceInsights(extractJsonLoose(raw2));
  if (parsed2) return parsed2;

  throw new Error("پاسخ تحلیل هوش مصنوعی قابل پارس نبود");
}

/* ─────────────────────── ذخیره/خواندن (SiteSetting) ─────────────────────── */

const SETTING_REPORT = "seo_gsc_report";
const SETTING_INSIGHTS = "seo_gsc_report_insights";
const LABEL_REPORT = "گزارش آپلودشده سرچ کنسول";
const LABEL_INSIGHTS = "تحلیل هوش مصنوعی گزارش سرچ کنسول";

export async function saveSeoReport(fileName: string, report: SeoGscReport, insights: SeoAiInsights | null): Promise<void> {
  const withFile = { ...report, fileName } as SeoGscReport;
  await db.siteSetting.upsert({
    where: { key: SETTING_REPORT },
    create: { key: SETTING_REPORT, value: JSON.stringify(withFile), label: LABEL_REPORT },
    update: { value: JSON.stringify(withFile), label: LABEL_REPORT },
  });
  if (insights) {
    await db.siteSetting.upsert({
      where: { key: SETTING_INSIGHTS },
      create: { key: SETTING_INSIGHTS, value: JSON.stringify(insights), label: LABEL_INSIGHTS },
      update: { value: JSON.stringify(insights), label: LABEL_INSIGHTS },
    });
  }
  // کش بلوک پرامپت باطل شود
  promptBlockCache = null;
}

function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getSeoReport(): Promise<{ report: SeoGscReport | null; insights: SeoAiInsights | null }> {
  const rows = await db.siteSetting.findMany({
    where: { key: { in: [SETTING_REPORT, SETTING_INSIGHTS] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    report: safeJsonParse<SeoGscReport>(map.get(SETTING_REPORT)),
    insights: safeJsonParse<SeoAiInsights>(map.get(SETTING_INSIGHTS)),
  };
}

/* ─────────────────────── بلوک پرامپت برای موتور سئو ─────────────────────── */

/** کش ماژول‌سطح با TTL ۶۰ ثانیه — بلوک پرامپت ارزان نگه داشته شود */
let promptBlockCache: { value: string; ts: number } | null = null;
const PROMPT_BLOCK_TTL_MS = 60_000;

/**
 * بلوک متنی گزارش آپلودشده + تحلیل AI برای تزریق به پرامپت‌های
 * استراتژی سئو / آپدیت محتوا. اگر گزارشی نباشد رشتهٔ خالی برمی‌گردد.
 */
export async function getSeoReportPromptBlock(): Promise<string> {
  const now = Date.now();
  if (promptBlockCache && now - promptBlockCache.ts < PROMPT_BLOCK_TTL_MS) {
    return promptBlockCache.value;
  }

  let value = "";
  try {
    const { report, insights } = await getSeoReport();
    if (report && report.topQueries?.length > 0) {
      const uploadDate = new Date(report.uploadedAt).toLocaleDateString("fa-IR");
      const lines: string[] = [];
      lines.push(`═══ گزارش سرچ کنسول (آپلودشده در تاریخ ${uploadDate} — فایل: ${report.fileName}) — هنگام انتخاب کلمات و اولویت‌ها از این داده‌های واقعی استفاده کن ═══`);
      lines.push(buildReportSummary(report));
      if (insights?.executiveSummary) {
        lines.push("═══ تحلیل هوش مصنوعی همین گزارش ═══");
        lines.push(`خلاصهٔ تحلیل: ${insights.executiveSummary}`);
        if (insights.quickWins?.length) {
          lines.push("بردهای سریع پیشنهادی:");
          insights.quickWins.slice(0, 5).forEach((w) => lines.push(`- ${w}`));
        }
        if (insights.contentIdeas?.length) {
          lines.push("ایده‌های محتوایی پیشنهادی:");
          insights.contentIdeas.slice(0, 5).forEach((c) => lines.push(`- ${c}`));
        }
        if (insights.updateTargets?.length) {
          lines.push("اهداف آپدیت محتوا:");
          insights.updateTargets.slice(0, 5).forEach((u) => lines.push(`- ${u}`));
        }
      }
      value = `\n\n${lines.join("\n")}`;
    }
  } catch (e) {
    // نبود/خرابی گزارش نباید هیچ جریانی را متوقف کند
    console.warn("[seo-report] خواندن بلوک گزارش ناموفق:", e instanceof Error ? e.message : e);
    value = "";
  }

  promptBlockCache = { value, ts: now };
  return value;
}
