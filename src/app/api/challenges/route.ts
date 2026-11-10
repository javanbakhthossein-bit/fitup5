/**
 * v183 — GET /api/challenges — دادهٔ صفحهٔ چالش‌ها (فقط جنسیت خود کاربر)
 *
 * دیرکتیو مالک (سفت‌وسخت): آقایان فقط چالش‌های آقایان، خانم‌ها فقط چالش‌های
 * خانم‌ها — هم در داشبورد و هم در صفحهٔ چالش‌ها. جنسیت از OnboardingProfile
 * خوانده می‌شود (fallback «male» — همان قرارداد بقیهٔ APIهای سایت).
 *
 * پاسخ: { gender, progress: ChallengeProgressDto[] }
 * محتوای چالش‌ها استاتیک است (challenges-data-men/women) و کلاینت بر اساس
 * همین gender فایل درست را dynamic-import می‌کند — دادهٔ جنسیت دیگر هرگز
 * به کلاینت جنسیت مقابل نمی‌رسد.
 */
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
      select: { gender: true },
    });
    // قرارداد سایت: نبود پروفایل = male (مثل checkup/route.ts و بقیه)
    const gender = profile?.gender === "female" ? "female" : "male";

    const rows = await db.challengeProgress.findMany({
      where: { userId: user.id },
      select: {
        challengeSlug: true,
        completedDays: true,
        currentDay: true,
        startedAt: true,
        lastCompletedAt: true,
        completedAt: true,
      },
    });

    const progress = rows.map((r) => {
      let days: number[] = [];
      try {
        const parsed = JSON.parse(r.completedDays);
        if (Array.isArray(parsed)) days = parsed.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
      } catch {
        days = [];
      }
      return {
        slug: r.challengeSlug,
        completedDays: days,
        currentDay: r.currentDay,
        startedAt: r.startedAt.toISOString(),
        lastCompletedAt: r.lastCompletedAt ? r.lastCompletedAt.toISOString() : null,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      };
    });

    return Response.json({ gender, progress });
  } catch (error) {
    return apiError(error);
  }
}
