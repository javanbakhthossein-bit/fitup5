import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";

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
        content = JSON.parse(wp.content);
      } catch {
        return Response.json({ error: "محتوای برنامه قابل خواندن نیست." }, { status: 422 });
      }
      return Response.json({
        kind,
        content,
        meta: { weekIndex: wp.weekIndex, active: wp.active, createdAt: wp.createdAt },
      });
    }

    const mp = await db.mealPlan.findFirst({ where: { id: planId, userId } });
    if (!mp) {
      return Response.json({ error: "برنامهٔ غذایی یافت نشد." }, { status: 404 });
    }
    let content: unknown = null;
    try {
      content = JSON.parse(mp.content);
    } catch {
      return Response.json({ error: "محتوای برنامه قابل خواندن نیست." }, { status: 422 });
    }
    return Response.json({
      kind,
      content,
      meta: { dayLabel: mp.dayLabel, totalCal: mp.totalCal, active: mp.active, createdAt: mp.createdAt },
    });
  } catch (e) {
    return apiError(e);
  }
}
