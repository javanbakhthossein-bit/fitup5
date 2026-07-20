import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { avalaiClient, TEXT_MODEL } from "@/lib/fitness/ai";

/**
 * POST /api/feedback/analyze
 * Admin only — fetch all survey feedback and run AI analysis to produce:
 *  - نقاط قوت (3 مورد)
 *  - ایرادات و ضعف‌ها (3 مورد)
 *  - پیشنهادات بهبود (3 مورد)
 *  - خلاصه کلی (2 جمله)
 */
export async function POST(_req: NextRequest) {
  try {
    await requireAdmin();

    // Fetch all survey feedback with at least one rating or a comment
    const all = await db.feedback.findMany({
      where: {
        OR: [
          { category: "survey" },
          { comment: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        comment: true,
        category: true,
        name: true,
        mobile: true,
        ratingOverall: true,
        ratingWorkoutPlan: true,
        ratingMealPlan: true,
        ratingAIChat: true,
        ratingUI: true,
        ratingSupport: true,
        ratingValue: true,
        createdAt: true,
      },
    });

    if (all.length === 0) {
      return Response.json({
        analysis:
          "هنوز هیچ نظری ثبت نشده است. پس از دریافت نظرات کاربران، تحلیل هوش مصنوعی در دسترس خواهد بود.",
        count: 0,
      });
    }

    // Build a compact text summary for the AI
    const ratingLabels: { key: string; label: string }[] = [
      { key: "ratingOverall", label: "کیفیت کلی" },
      { key: "ratingWorkoutPlan", label: "برنامه تمرینی" },
      { key: "ratingMealPlan", label: "برنامه غذایی" },
      { key: "ratingAIChat", label: "چت مربی هوشمند" },
      { key: "ratingUI", label: "رابط کاربری" },
      { key: "ratingSupport", label: "پشتیبانی" },
      { key: "ratingValue", label: "ارزش نسبت به قیمت" },
    ];

    const lines: string[] = [];
    let idx = 1;
    for (const f of all) {
      const ratings = ratingLabels
        .map((r) => {
          const v = (f as any)[r.key];
          return v ? `${r.label}: ${v}/5` : null;
        })
        .filter(Boolean)
        .join("، ");
      const who = f.name || f.mobile || "ناشناس";
      const comment = f.comment ? ` | نظر: "${f.comment.slice(0, 500)}"` : "";
      lines.push(`${idx}. [${who}] ${ratings || "بدون امتیاز"}${comment}`);
      idx++;
    }

    const surveyData = lines.join("\n");

    // Compute average ratings
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const r of ratingLabels) {
      sums[r.key] = 0;
      counts[r.key] = 0;
    }
    for (const f of all) {
      for (const r of ratingLabels) {
        const v = (f as any)[r.key];
        if (typeof v === "number" && v >= 1 && v <= 5) {
          sums[r.key] += v;
          counts[r.key] += 1;
        }
      }
    }
    const averages = ratingLabels
      .map((r) =>
        counts[r.key] > 0
          ? `${r.label}: ${(sums[r.key] / counts[r.key]).toFixed(1)}/5`
          : `${r.label}: —`
      )
      .join("، ");

    const systemPrompt = `تو یک تحلیلگر حرفه‌ای نظرات کاربران هستی. نظرات زیر را تحلیل کن و:
۱. نقاط قوت (۳ مورد)
۲. ایرادات و ضعف‌ها (۳ مورد)
۳. پیشنهادات بهبود (۳ مورد)
۴. خلاصه کلی (۲ جمله)
ارائه بده. فارسی، حرفه‌ای و کاربردی. پاسخ را با مارک‌داون (## و -) فرمت کن. هر بخش را با عنوان مارک‌داون مشخص کن: ## نقاط قوت، ## ایرادات و ضعف‌ها، ## پیشنهادات بهبود، ## خلاصه کلی.`;

    const userPrompt = `میانگین امتیازها:
${averages}

تعداد کل نظرات: ${all.length}

لیست نظرات کاربران:
${surveyData}

لطفاً بر اساس این داده‌ها، تحلیل حرفه‌ای خود را ارائه بده.`;

    let analysis = "";
    try {
      const completion = await avalaiClient.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 2000,
      });
      analysis = completion.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("[feedback/analyze] AI error:", err);
      return Response.json(
        { error: "خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید." },
        { status: 502 }
      );
    }

    if (!analysis.trim()) {
      return Response.json(
        { error: "پاسخی از هوش مصنوعی دریافت نشد." },
        { status: 500 }
      );
    }

    return Response.json({ analysis, count: all.length });
  } catch (e) {
    return apiError(e);
  }
}
