import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { checkPrerequisites, getPendingPrerequisites } from "@/lib/fitness/prerequisites";

/**
 * دریافت تاریخچه برنامه‌های قبلی کاربر + تحلیل هوش مصنوعی برای برنامه جدید
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const generateAnalysis = searchParams.get("analyze") === "1";

    // دریافت تمام برنامه‌های تمرینی کاربر (مرتب بر اساس قدیمی‌ترین)
    const workoutPlans = await db.workoutPlan.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // دریافت تمام برنامه‌های غذایی
    const mealPlans = await db.mealPlan.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // دریافت تمام اشتراک‌ها
    const subscriptions = await db.subscription.findMany({
      where: { userId: user.id },
      orderBy: { startDate: "desc" },
    });

    // دریافت چکاپ‌ها
    const checkups = await db.checkup.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // دریافت وزن‌های ثبت‌شده
    const weightLogs = await db.weightLog.findMany({
      where: { userId: user.id },
      orderBy: { loggedAt: "asc" },
    });

    // ساخت خلاصه هر دوره برنامه
    const programs = workoutPlans.map((wp, i) => {
      const content = JSON.parse(wp.content);
      const mealPlan = mealPlans[i];
      const mealContent = mealPlan ? JSON.parse(mealPlan.content) : null;
      const sub = subscriptions[i];

      return {
        id: wp.id,
        weekIndex: wp.weekIndex,
        active: wp.active,
        createdAt: wp.createdAt.toISOString(),
        days: content.days?.length || 0,
        exercises: content.days?.reduce((s: number, d: any) => s + (d.exercises?.length || 0), 0) || 0,
        weeklyGoal: content.weeklyGoal || "",
        notes: content.notes || "",
        totalCalories: mealContent?.totalCalories || 0,
        planName: sub?.plan || user.planName,
        status: sub?.status || "unknown",
        startDate: sub?.startDate?.toISOString() || wp.createdAt.toISOString(),
        endDate: sub?.endDate?.toISOString() || null,
        // برنامه تمرینی کامل
        workoutDays: content.days || [],
        supplements: mealContent?.supplements || content.supplements || [],
        // برنامه غذایی
        meals: mealContent?.meals || [],
        mealNotes: mealContent?.notes || "",
        waterLiters: mealContent?.waterLiters || 2.5,
        totalProtein: mealContent?.totalProtein || 0,
        totalCarbs: mealContent?.totalCarbs || 0,
        totalFat: mealContent?.totalFat || 0,
      };
    });

    let aiAnalysis: string | null = null;

    // اگر درخواست تحلیل بود و کاربر حداقل ۱ برنامه قبلی دارد
    if (generateAnalysis && programs.length > 0 && user.planName) {
      try {
        const { avalaiClient, TEXT_MODEL } = await import("@/lib/fitness/ai");

        // خلاصه پیشرفت کاربر
        const firstWeight = weightLogs[0]?.weight;
        const lastWeight = weightLogs[weightLogs.length - 1]?.weight;
        const weightChange = firstWeight && lastWeight ? (lastWeight - firstWeight).toFixed(1) : null;
        const checkupCount = checkups.length;
        const lastCheckup = checkups[0];

        const summary = `تاریخچه ورزشکار:
- تعداد برنامه‌های قبلی: ${programs.length}
- تغییر وزن: ${weightChange ? `${weightChange} کیلوگرم (${Number(weightChange) > 0 ? "افزایش" : "کاهش"})` : "نامشخص"}
- تعداد چکاپ‌های ثبت‌شده: ${checkupCount}
- آخرین وزن ثبت‌شده: ${lastWeight || "نامشخص"}
- برنامه‌های قبلی:
${programs.slice(0, 3).map((p, idx) => `  برنامه ${idx + 1}: ${p.days} روز، ${p.exercises} حرکت، ${p.totalCalories} کالری، هدف: ${p.weeklyGoal}`).join("\n")}

برای برنامه جدید، یک تحلیل کوتاه (۲-۳ پاراگراف) به زبان فارسی بنویس که:
۱. پیشرفت کاربر را در دوره‌های قبلی خلاصه کند
۲. نقاط قوت و ضعف را مشخص کند
۳. توضیح بدهد که برنامه جدید چه تفاوتی با قبلی دارد و چه تمرکزی دارد`;

        const completion = await avalaiClient.chat.completions.create({
          model: TEXT_MODEL,
          messages: [
            { role: "system", content: "تو فیتاپ هوشمند هستی — مربی متخصص ورزشی. به زبان فارسی پاسخ بده." },
            { role: "user", content: summary },
          ],
        } as any);

        aiAnalysis = completion.choices[0]?.message?.content || null;
      } catch (err) {
        console.error("[Program History] AI analysis error:", err);
      }
    }

    // ─── اطلاعات پیش‌نیازها برای نمایش در programs-view (وظیفه ۱۰) ───
    // سیستم دانه‌دانه پیش‌نیازها: هر مورد (عکس بدن، ویدیو، آزمایش خون، اندازه‌ها)
    // به‌طور جداگانه با وضعیت خودش نمایش داده می‌شود.
    const userPlan = (user.planName as string) ?? null;
    const prereqCheck = await checkPrerequisites(user.id, userPlan as any);
    const pendingPrerequisites = getPendingPrerequisites(prereqCheck);

    // مقادیر قدیمی برای backward-compatibility
    const needsBodyPhoto = userPlan === "advanced" || userPlan === "ultimate";
    const needsVideo = userPlan === "ultimate";
    const bodyPhotoPrereq = prereqCheck.prerequisites.find((p) => p.type === "body_photo");
    const videoPrereq = prereqCheck.prerequisites.find((p) => p.type === "video_body");
    const hasBodyPhoto = bodyPhotoPrereq?.status === "completed";
    const hasVideo = videoPrereq?.status === "completed";

    // وضعیت درخواست برنامه
    const latestRequest = await db.programRequest.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    const programStatus = latestRequest?.status ?? "ready";

    return Response.json({
      programs,
      totalPrograms: programs.length,
      weightLogs: weightLogs.map((w) => ({
        weight: w.weight,
        loggedAt: w.loggedAt.toISOString(),
      })),
      checkupCount: checkups.length,
      aiAnalysis,
      // اطلاعات پیش‌نیازها (سیستم دانه‌دانه جدید)
      prerequisites: prereqCheck.prerequisites,
      pendingPrerequisites,
      canGenerateProgram: prereqCheck.canGenerateProgram,
      blockingReason: prereqCheck.blockingReason,
      // مقادیر backward-compatible
      programStatus,
      needsBodyPhoto,
      hasBodyPhoto,
      needsVideo,
      hasVideo,
    });
  } catch (e) {
    return apiError(e);
  }
}
