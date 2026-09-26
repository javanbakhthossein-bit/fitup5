import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { createResilientCompletion, TEXT_TASK_MODEL, TEXT_MODEL, withSystemDirectives } from "@/lib/fitness/ai";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { fixPersianTypography } from "@/lib/fitness/persian-typography";
import {
  buildCheckupSection,
  buildCompactProgressSummary,
} from "@/lib/fitness/sports-profile-context";

/**
 * GET /api/coach/comprehensive-analysis
 * POST /api/coach/comprehensive-analysis
 *
 * ─── تحلیل جامع فیتاپ (v15 — درخواست مالک) ───
 * «قسمت تحلیل جامع فیتاپ رو خیلی خیلی جذابتر و کاربردی تر کنی که در حال
 *  حاضر فقط داره یه وزن نشون میده و این قسمت رو میتونی با یه تحلیل کلی
 *  هوش مصنوعی جذابترش کنی»
 *
 * تجمیع کل داده‌های ورزشکار (پروفایل آنبوردینگ + همه چکاپ‌ها + وزن‌ها +
 * تعداد عکس پیشرفت + وضعیت پلن) → گزارش ساختاریافته AI:
 *   overallScore, summary, weightTrend, bodyFatTrend, strengths[],
 *   focusAreas[], training, nutrition, recommendations[], motivational
 *
 * ذخیره در AnalysisResult (type="comprehensive_report") — GET آخرین گزارش
 * را برمی‌گرداند (بدون صدا زدن AI). POST گزارش تازه تولید می‌کند.
 *
 * محدودیت: ۶ تولید در ساعت (rate limit) — گزارش قبلی‌ها نگه داشته می‌شوند
 * (حداکثر ۵ تا؛ قدیمی‌ترها حذف می‌شوند) و GET همیشه آخرین را می‌دهد.
 */

const REPORT_TYPE = "comprehensive_report";

export async function GET() {
  try {
    const user = await requireAuth();
    const latest = await db.analysisResult.findFirst({
      where: { userId: user.id, type: REPORT_TYPE },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      report: latest ? safeParse(latest.result) : null,
      generatedAt: latest?.createdAt?.toISOString() ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    // بدون گیت پلن سخت — کاربر بدون پلن هم نمای کلی می‌بیند (داده محدود)؛
    // ولی نرخ محدود تا هزینه AI کنترل شود
    const rl = rateLimit(`comprehensive-analysis:${user.id}`, 6, 60 * 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    // ─── تجمیع داده‌ها ───
    const [profile, checkups, weightLogs, progressPhotos, activeSub] = await Promise.all([
      db.onboardingProfile.findUnique({ where: { userId: user.id } }),
      db.checkup.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: {
          phaseNumber: true, weight: true, bodyFatPercent: true, leanBodyMass: true,
          waistMeasurement: true, neckMeasurement: true, chestMeasurement: true,
          armMeasurement: true, hipMeasurement: true, thighMeasurement: true,
          fatigueLevel: true, sleepQuality: true, dietAdherence: true,
          workoutAdherence: true, createdAt: true,
        },
      }),
      db.weightLog.findMany({
        where: { userId: user.id },
        orderBy: { loggedAt: "asc" },
        select: { weight: true, loggedAt: true },
      }),
      db.progressPhoto.count({ where: { userId: user.id } }),
      db.subscription.findFirst({
        where: { userId: user.id, status: "active" },
        select: { plan: true, startDate: true, endDate: true },
      }),
    ]);

    const daysSinceStart = user.planStartedAt
      ? Math.floor((Date.now() - new Date(user.planStartedAt).getTime()) / (24 * 60 * 60 * 1000))
      : null;

    // ─── ساخت متن داده‌ها برای AI ───
    const sections: string[] = [];

    if (profile) {
      const goalLabels: Record<string, string> = {
        fat_loss: "کاهش چربی", muscle_gain: "افزایش عضله", endurance: "افزایش استقامت",
        fitness: "تناسب اندام عمومی", strength: "افزایش قدرت",
        cut: "کات (چربی‌سوزی با حفظ عضله)", bulk: "افزایش حجم",
      };
      const p: string[] = [
        `جنسیت: ${profile.gender === "female" ? "زن" : "مرد"}`,
        `سن: ${profile.age ?? "نامشخص"}`,
        `قد: ${profile.height ?? "نامشخص"} cm`,
        `وزن اعلامی اولیه: ${profile.weight ?? "نامشخص"} kg`,
      ];
      if (profile.targetWeight) p.push(`وزن هدف: ${profile.targetWeight} kg`);
      if (profile.goal) p.push(`هدف: ${goalLabels[profile.goal] || profile.goal}`);
      if (profile.activityLevel) p.push(`سطح فعالیت: ${profile.activityLevel}`);
      if (profile.workoutDays) p.push(`روزهای تمرین در هفته: ${profile.workoutDays}`);
      if (profile.trainingExperience) p.push(`سابقه تمرین: ${profile.trainingExperience}`);
      if (profile.dietType) p.push(`نوع رژیم: ${profile.dietType}`);
      sections.push(`━━━ پروفایل آنبوردینگ ━━━\n${p.join("\n")}`);
    } else {
      sections.push("━━━ پروفایل آنبوردینگ ━━━\nپروفایل آنبوردینگ تکمیل نشده است.");
    }

    if (daysSinceStart != null) {
      sections.push(
        `━━━ وضعیت پلن ━━━\nپلن فعال: ${activeSub?.plan ?? user.planName ?? "نامشخص"} • روز ${daysSinceStart} از دوره`
      );
    }

    // ─── v53: چکاپ‌ها بودجه‌دار شد ───
    // قبلاً «همهٔ» چکاپ‌ها خط‌به‌خط در پرامپت می‌رفتند — برای کاربر چندساله
    // پرامپت بی‌روند سنگین می‌شد (همان باگی که مالک نگرانش بود). حالا ۳ چکاپ
    // آخر با جزئیات + یک خط روند کلی (اولین ← آخرین)؛ خروجی همیشه کوتاه است.
    if (checkups.length > 0) {
      try {
        const cs = buildCheckupSection(checkups);
        sections.push(cs || "━━━ چکاپ‌های دوره‌ای ━━━\nدادهٔ قابل نمایشی وجود ندارد.");
      } catch (csErr) {
        console.error("[comprehensive-analysis] checkup section failed:", csErr);
        sections.push("━━━ چکاپ‌های دوره‌ای ━━━\nهنوز چکاپی ثبت نشده است.");
      }
    } else {
      sections.push("━━━ چکاپ‌های دوره‌ای ━━━\nهنوز چکاپی ثبت نشده است.");
    }

    if (weightLogs.length > 0) {
      const first = weightLogs[0];
      const last = weightLogs[weightLogs.length - 1];
      const delta = last.weight - first.weight;
      sections.push(
        `━━━ ثبت وزن‌ها ━━━\n${weightLogs.length} ثبت • اولین: ${first.weight}kg (${new Date(
          first.loggedAt
        ).toLocaleDateString("fa-IR")}) • آخرین: ${last.weight}kg (${new Date(
          last.loggedAt
        ).toLocaleDateString("fa-IR")}) • تغییر کل: ${delta > 0 ? "+" : ""}${delta.toFixed(1)}kg`
      );
    }

    if (progressPhotos > 0) {
      sections.push(`━━━ عکس‌های پیشرفت ━━━\n${progressPhotos} عکس ثبت شده است.`);
    }

    // ─── v53: آمار فعالیت واقعی ۳۰ روز اخیر (تغذیهٔ ثبت‌شده + تمرین‌ها + استریک) ───
    // قبلاً FoodLog و DayCompletion هرگز به تحلیل جامع نمی‌رسیدند؛ حالا خلاصهٔ
    // بودجه‌دار (≤۱۵۰۰ کاراکتر، بدون چکاپ چون بالاتر بخش چکاپ داریم) تزریق می‌شود.
    try {
      const recentActivity = await buildCompactProgressSummary(user.id, { includeCheckups: false });
      if (recentActivity) {
        sections.push(recentActivity);
      }
    } catch (actErr) {
      console.error("[comprehensive-analysis] recent activity summary failed:", actErr);
    }

    const prompt = `داده‌های کامل یک ورزشکار فیتاپ را می‌بینی. یک «گزارش تحلیل جامع» بنویس.

${sections.join("\n\n")}

قوانین:
- همه متن‌ها فارسی روان، انگیزشی و علمی باشد (بدون کلی‌گویی).
- تحلیل باید دقیقاً بر اساس همین اعداد باشد؛ اگر داده کم است، همان مقدار موجود را تحلیل کن و برای داده‌های غایب توصیه ورود داده بده.
- اگر چکاپ/وزن قبلی و فعلی موجود است، روند را مشخص کن (جهت تغییر + تفسیر بر اساس هدف).

فقط با ساختار JSON زیر پاسخ بده:
{
  "overallScore": 72,
  "summary": "تحلیل جامع ۳-۵ جمله‌ای: وضعیت کلی مسیر، مهم‌ترین تغییرات عددی، و اینکه در جهت هدف هست یا نه",
  "weightTrend": "روند وزن در یک عبارت کوتاه (مثال: «۱.۵ کیلو کاهش — در جهت هدف») یا «داده کافی نیست»",
  "bodyFatTrend": "روند چربی بدن در یک عبارت کوتاه یا «داده کافی نیست»",
  "strengths": ["نقطه قوت ۱ (بر اساس داده واقعی)", "نقطه قوت ۲"],
  "focusAreas": ["نکته‌ای که باید رویش تمرکز کند ۱", "نکته ۲"],
  "training": "۱-۲ جمله تحلیل تمرین (بر اساس پیروی تمرین و روزهای تمرین)",
  "nutrition": "۱-۲ جمله تحلیل تغذیه (بر اساس پیروی رژیم و هدف)",
  "recommendations": ["توصیه عملی مشخص ۱", "توصیه ۲", "توصیه ۳"],
  "motivational": "یک جمله انگیزشی کوتاه و اختصاصی برای همین ورزشکار"
}`;

    let content: string;
    try {
      content = await createResilientCompletion(
        {
        // v69 — دیریکتیو مالک: وظایف متنی → deepseek-v4-flash (فال‌بک: gemini-3.8)
        model: TEXT_TASK_MODEL,
        fallback_model: TEXT_MODEL,
        messages: [
          {
            role: "system",
            content: withSystemDirectives(
              "تو مربی ارشد و متخصص علمی فیتاپ هستی. گزارش تحلیل جامع پیشرفت ورزشکار را بر اساس داده‌های واقعی می‌نویسی — دقیق، عددی و انگیزشی. فقط JSON معتبر برگردان."
            ),
          },
          { role: "user", content: prompt },
        ],
      } as any,
        {
          logTag: "comprehensive-analysis",
          maxTokens: 4096,
          timeoutMs: 120_000,
          maxAttempts: 3,
          validateContent: (t: string) => {
            const m = t.match(/\{[\s\S]*\}/);
            if (!m) return "پاسخ JSON نداشت";
            try { JSON.parse(m[0]); return null; } catch { return "JSON نامعتبر از مدل"; }
          },
        }
      );
    } catch (err) {
      console.error("[comprehensive-analysis] AvalAI error:", err);
      return NextResponse.json(
        { error: "خطا در تولید تحلیل. لطفاً چند لحظه بعد دوباره تلاش کنید." },
        { status: 502 }
      );
    }

    // پارس JSON (بردارنده‌ی markdown fences احتمالی)
    let parsed: any = null;
    try {
      const cleaned = content.replace(/^```(json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[comprehensive-analysis] JSON parse failed:", content.slice(0, 300));
      return NextResponse.json(
        { error: "پاسخ هوش مصنوعی قابل خواندن نبود. دوباره تلاش کنید." },
        { status: 502 }
      );
    }

    // اصلاح نگارش فارسی همه‌ی متن‌ها
    const fix = (s: unknown): string => (typeof s === "string" ? fixPersianTypography(s) : "");
    const fixArr = (a: unknown): string[] =>
      Array.isArray(a) ? a.map((x) => fix(x)).filter(Boolean).slice(0, 6) : [];

    const report = {
      overallScore: Math.max(0, Math.min(100, Math.round(Number(parsed.overallScore) || 0))),
      summary: fix(parsed.summary),
      weightTrend: fix(parsed.weightTrend),
      bodyFatTrend: fix(parsed.bodyFatTrend),
      strengths: fixArr(parsed.strengths),
      focusAreas: fixArr(parsed.focusAreas),
      training: fix(parsed.training),
      nutrition: fix(parsed.nutrition),
      recommendations: fixArr(parsed.recommendations),
      motivational: fix(parsed.motivational),
    };

    // ذخیره (حداکثر ۵ گزارش — قدیمی‌ترها حذف)
    await db.analysisResult.create({
      data: {
        userId: user.id,
        type: REPORT_TYPE,
        result: JSON.stringify({ ...report, generatedAt: new Date().toISOString() }),
        mediaUrl: null,
      },
    });
    const all = await db.analysisResult.findMany({
      where: { userId: user.id, type: REPORT_TYPE },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (all.length > 5) {
      await db.analysisResult.deleteMany({
        where: { id: { in: all.slice(5).map((r) => r.id) } },
      });
    }

    return NextResponse.json({ report });
  } catch (e) {
    return apiError(e);
  }
}

function safeParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
