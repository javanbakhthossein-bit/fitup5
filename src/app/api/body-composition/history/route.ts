import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/body-composition/history   (v159 — T6، دیرکتیو مالک)
 *
 * تاریخچهٔ «تشخیص قطعی ترکیب بدن» کاربر برای نمودار پیشرفت داشبورد:
 *   • نقطهٔ initial  → ارزیابی اولیه (آنبوردینگ/اولین تحلیل) — همهٔ کاربران
 *   • نقطهٔ checkup  → چکاپ‌های دوره‌ای — کاربران استاندارد+
 *   • نقطهٔ body_analysis → تحلیل‌های عکس بدن — پیشرفته/حرفه‌ای
 *
 * نمودار ٪ چربی/٪ عضله داشبورد «الی‌آبد» با هر چکاپ/تحلیل جدید تازه می‌شود و
 * روند رشد را نشان می‌دهد. پاسخ صعودی بر اساس زمان است (نقطهٔ اول = ارزیابی اولیه).
 * فقط requireAuth — دادهٔ ترکیب بدنِ خودِ کاربر است (بدون احراز سرو نمی‌شود).
 */
export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth();

    const rows = await db.bodyComposition.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      take: 200, // سقف محافظه‌کار — برای نمودار کافی است
      select: {
        createdAt: true,
        fatPercent: true,
        musclePercent: true,
        source: true,
      },
    });

    return Response.json({
      ok: true,
      history: rows.map((r) => ({
        createdAt: r.createdAt.toISOString(),
        fatPercent: r.fatPercent,
        musclePercent: r.musclePercent,
        source: r.source,
      })),
      // آخرین حکم (برای نمایش سریع در UI)
      latest:
        rows.length > 0
          ? {
              createdAt: rows[rows.length - 1].createdAt.toISOString(),
              fatPercent: rows[rows.length - 1].fatPercent,
              musclePercent: rows[rows.length - 1].musclePercent,
              source: rows[rows.length - 1].source,
            }
          : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
