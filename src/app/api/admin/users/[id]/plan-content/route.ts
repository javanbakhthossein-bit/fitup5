import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { fixPlanTypographyDeep } from "@/lib/fitness/persian-typography";
import { computePlanWeightMismatch } from "@/lib/fitness/active-weight";

export const dynamic = "force-dynamic";

/**
 * ─── GET /api/admin/users/[id]/plan-content — محتوای کامل یک برنامهٔ کاربر ───
 *
 * درخواست مالک: در پنل مدیر، هر برنامهٔ کاربر با کلیک باید «با جزئیات» نمایش
 * داده شود نه فقط نام. تا الان `details` فقط summary/شمارنده‌ها را می‌داد و
 * محتوای JSON برنامه (حرکات/ست‌ها/وعده‌ها) دور ریخته می‌شد.
 *
 * Query:
 *   kind=workout (پیش‌فرض) | meal
 *   planId=...  (الزامی — id رکورد WorkoutPlan یا MealPlan)
 *
 * پاسخ: { kind, content, meta } — content همان JSON تولیدشدهٔ برنامه است
 * (WorkoutPlanContent / MealPlanContent در src/lib/fitness/types.ts).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id: userId } = await params;
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") === "meal" ? "meal" : "workout";
    const planId = (url.searchParams.get("planId") || "").trim();
    if (!planId) {
      return Response.json({ error: "planId الزامی است." }, { status: 400 });
    }

    if (kind === "workout") {
      const wp = await db.workoutPlan.findFirst({ where: { id: planId, userId } });
      if (!wp) {
        return Response.json({ error: "برنامهٔ تمرینی یافت نشد." }, { status: 404 });
      }
      let content: unknown = null;
      try {
        // v75 — تایپوگرافی فارسی (کلمات چسبیده مثل «تمامقد») — هم‌سو با پنل کاربر
        content = fixPlanTypographyDeep(JSON.parse(wp.content));
      } catch {
        return Response.json({ error: "محتوای برنامه قابل خواندن نیست." }, { status: 422 });
      }
    // ─── v76: وزن پروفایل + اسنپ‌شات وزن برنامه — برای هشدار ناسازگاری به مدیر ───
    const profileW = await db.onboardingProfile.findUnique({
      where: { userId },
      select: { weight: true, weightUpdatedAt: true },
    });
    const mismatch = computePlanWeightMismatch({
      baseWeight: wp.baseWeight ?? null,
      planCreatedAt: wp.createdAt,
      profileWeight: profileW?.weight ?? null,
      weightUpdatedAt: profileW?.weightUpdatedAt ?? null,
    });

    return Response.json({
      kind,
      content,
      meta: {
        weekIndex: wp.weekIndex,
        active: wp.active,
        createdAt: wp.createdAt,
        // v76 — اسنپ‌شات وزن + ناسازگاری (تیکت «۴۶ ولی در برنامه ۹۷»)
        baseWeight: wp.baseWeight ?? null,
        profileWeight: profileW?.weight ?? null,
        weightMismatch: mismatch,
      },
    });
    }

    const mp = await db.mealPlan.findFirst({ where: { id: planId, userId } });
    if (!mp) {
      return Response.json({ error: "برنامهٔ غذایی یافت نشد." }, { status: 404 });
    }
    let content: unknown = null;
    try {
      // v75 — تایپوگرافی فارسی — هم‌سو با پنل کاربر
      content = fixPlanTypographyDeep(JSON.parse(mp.content));
    } catch {
      return Response.json({ error: "محتوای برنامه قابل خواندن نیست." }, { status: 422 });
    }
    // ─── v76: وزن پروفایل + اسنپ‌شات وزن برنامه — برای هشدار ناسازگاری به مدیر ───
    const profileW = await db.onboardingProfile.findUnique({
      where: { userId },
      select: { weight: true, weightUpdatedAt: true },
    });
    const mismatch = computePlanWeightMismatch({
      baseWeight: mp.baseWeight ?? null,
      planCreatedAt: mp.createdAt,
      profileWeight: profileW?.weight ?? null,
      weightUpdatedAt: profileW?.weightUpdatedAt ?? null,
    });

    return Response.json({
      kind,
      content,
      meta: {
        dayLabel: mp.dayLabel,
        totalCal: mp.totalCal,
        active: mp.active,
        createdAt: mp.createdAt,
        baseWeight: mp.baseWeight ?? null,
        profileWeight: profileW?.weight ?? null,
        weightMismatch: mismatch,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
