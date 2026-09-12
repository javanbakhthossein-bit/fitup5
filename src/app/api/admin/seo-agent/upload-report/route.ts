/**
 * POST /api/admin/seo-agent/upload-report
 * آپلود خروجی اکسل/CSV گزارش Google Search Console → parse → تحلیل AI → ذخیره
 *
 * GET /api/admin/seo-agent/upload-report
 * گزارش و تحلیل ذخیره‌شدهٔ فعلی را برمی‌گرداند.
 *
 * نکتهٔ مقادیر خروجی:
 *  - اگر تحلیل AI شکست بخورد، خودِ گزارش ذخیره می‌شود و insights=null + warning برمی‌گردد
 *    (آپلود هرگز به‌خاطر خطای AI هدر نمی‌رود — درخواست مالک).
 */

import { NextRequest } from "next/server";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import {
  parseGscWorkbook,
  buildSeoGscReport,
  analyzeReportWithAi,
  saveSeoReport,
  getSeoReport,
  type SeoGscReport,
  type SeoAiInsights,
} from "@/lib/fitness/seo-report";

const MAX_SIZE = 10 * 1024 * 1024; // ۱۰ مگابایت
const ALLOWED_EXTS = ["xlsx", "xls", "csv"];
const MIN_ROWS = 3;

export async function GET() {
  try {
    await requireAdmin();
    const { report, insights } = await getSeoReport();
    return Response.json({ ok: true, report, insights });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "فایلی ارسال نشده است." }, { status: 400 });
    }

    // اعتبارسنجی پسوند و حجم
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      return Response.json(
        { error: "فقط فایل اکسل یا CSV مجاز است (.xlsx / .xls / .csv) — خروجی Export سرچ کنسول را آپلود کنید." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ error: "حجم فایل بیش از ۱۰ مگابایت است." }, { status: 400 });
    }
    if (file.size === 0) {
      return Response.json({ error: "فایل خالی است." }, { status: 400 });
    }

    // parse ورک‌بوک
    const buffer = Buffer.from(await file.arrayBuffer());
    let parsed: ReturnType<typeof parseGscWorkbook>;
    try {
      parsed = parseGscWorkbook(buffer);
    } catch {
      return Response.json(
        { error: "فایل قابل خواندن نبود — مطمئن شوید فایل سالم اکسل/CSV سرچ کنسول است." },
        { status: 400 }
      );
    }

    if (parsed.rows.length < MIN_ROWS) {
      return Response.json(
        {
          error: `فقط ${parsed.rows.length} ردیف کوئری معتبر پیدا شد (حداقل ${MIN_ROWS} ردیف لازم است). ستون‌های Query/Clicks/Impressions را در فایل چک کنید — خروجی Export → Excel/CSV سرچ کنسول بهترین فرمت است.`,
        },
        { status: 400 }
      );
    }

    // ساخت گزارش + تحلیل AI (شکست AI آپلود را هدر نمی‌دهد)
    const report: SeoGscReport = buildSeoGscReport(file.name, parsed);
    let insights: SeoAiInsights | null = null;
    let warning: string | undefined;
    try {
      insights = await analyzeReportWithAi(report);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload-report] تحلیل AI ناموفق — گزارش بدون تحلیل ذخیره می‌شود:", msg.slice(0, 200));
      warning = "گزارش ذخیره شد اما تحلیل هوش مصنوعی فعلاً ناموفق بود — دوباره آپلود کنید یا بعداً اجرا بگیرید.";
    }

    await saveSeoReport(file.name, report, insights);

    return Response.json({ ok: true, report, insights, warning });
  } catch (e) {
    return apiError(e);
  }
}
