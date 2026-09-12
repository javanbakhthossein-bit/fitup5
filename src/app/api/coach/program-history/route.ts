import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { checkPrerequisites, getPendingPrerequisites } from "@/lib/fitness/prerequisites";
import { recoverStuckGenerations } from "@/lib/fitness/program-generation";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { computePlanWeightMismatch } from "@/lib/fitness/active-weight";

/**
 * دریافت تاریخچه برنامه‌های قبلی کاربر + تحلیل هوش مصنوعی برای برنامه جدید
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const generateAnalysis = searchParams.get("analyze") === "1";

    // ─── rate limit فقط روی حالت تحلیل AI ───
    // حالت عادی (بدون analyze=1) هر ۳۰ ثانیه توسط فرانت‌اند poll می‌شود و
    // ارزان است؛ اما analyze=1 یک فراخوانی VLM/LLM پرهزینه است — بدون محدودیت
    // می‌شد کردیت AvalAI را drained کرد.
    if (generateAnalysis) {
      const rl = rateLimit(`program-history-analyze:${user.id}`, 10, 60 * 60_000);
      if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
    }

    // ─── watchdog خودترمیم ───
    // فرانت‌اند در حالت generating هر ۳۰ ثانیه به این endpoint poll می‌کند —
    // بهترین نقطه برای بازیابی تولیدات یتیم‌شده (بعد از restart سرور)
    if (!generateAnalysis) {
      await recoverStuckGenerations(user.id);
    }

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

    // ─── جفت‌کردن هر برنامه تمرینی با برنامه غذایی «همان دوره تولید» ───
    // قبلاً mealPlans[i] با ایندکس جفت می‌شد — وقتی تعداد برنامه‌های تمرینی و
    // غذایی برابر نبود (یا یکی fail شده بود)، برنامه غذایی اشتباه به برنامه
    // تمرینی وصل می‌شد و مدال «مشاهده کل برنامه» برنامه غذایی متفاوتی از
    // «دستیار تغذیه» (که برنامه فعال واقعی را از /api/coach/plan می‌خواند)
    // نشان می‌داد.
    // راه درست: هر WorkoutPlan با نزدیک‌ترین MealPlan از نظر زمان ایجاد جفت
    // می‌شود — هر دو در یک cycle تولید (با فاصله چند ثانیه) ساخته می‌شوند.
    // برای برنامه فعال، همین جفت‌شدگی عملاً همان برنامه غذایی فعال است چون
    // generation قدیمی‌ها را یکجا deactivate می‌کند.
    const usedMealPlanIds = new Set<string>();
    const mealPlanForWorkout = (wp: { createdAt: Date }) => {
      let best: (typeof mealPlans)[number] | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const mp of mealPlans) {
        if (usedMealPlanIds.has(mp.id)) continue;
        const diff = Math.abs(mp.createdAt.getTime() - wp.createdAt.getTime());
        if (diff < bestDiff) {
          bestDiff = diff;
          best = mp;
        }
      }
      // فقط اگر در همان cycle تولید ساخته شده باشد (فاصله < ۱۰ دقیقه)
      if (best && bestDiff <= 10 * 60 * 1000) {
        usedMealPlanIds.add(best.id);
        return best;
      }
      return null;
    };

    // ─── جفت‌کردن هر برنامه تمرینی با اشتراک «همان دوره» ───
    // قبلاً subscriptions[i] با ایندکس جفت می‌شد — دو لیست با مرتب‌سازی و
    // تعداد متفاوت (تولید مجدد، اشتراک pending بدون برنامه، تمدید بدون
    // برنامه جدید و ...) باعث می‌شد بعد از نقطه واگرایی، هر کارت برنامه
    // اشتراک اشتباه (تاریخ/وضعیت/درصد پیشرفت اشتباه) بگیرد.
    // راه درست (آینه الگوی جفت‌سازی meal-plan بالای همین فایل):
    //  ۱) اشتراکی که بازه اعتبارش (startDate → cancelledAt/endDate) لحظهٔ
    //     ساخت برنامه را پوشش می‌دهد — این حالت دورهای هفتگی و تولیدهای
    //     مجددِ همان اشتراک را هم درست جفت می‌کند (رابطه واقعی ۱:N است،
    //     برخلاف meal-plan که ۱:۱ است — پس بدون used-set).
    //  ۲) اگر هیچ اشتراکی پوشش نداد: نزدیک‌ترین اشتراک در پنجره ۱۰ دقیقه
    //     (حالت لبه: برنامه چند میلی‌ثانیه «قبل از» فعال‌شدن اشتراک pending
    //     نوشته شده — در دیتای زنده DB دیده شده است).
    //  ۳) هیچ تطبیق نبود → بدون برچسب اشتراک (وضعیت unknown + تاریخ خود برنامه).
    // نکته: اشتراک‌های pending (startDate=null) هرگز برنامه تولید نکرده‌اند و
    // فقط در پنجره ۱۰ دقیقه با createdAt خودشان قابل جفت‌شدن هستند.
    const subscriptionForWorkout = (wp: { createdAt: Date }) => {
      const t = wp.createdAt.getTime();
      let covering: (typeof subscriptions)[number] | null = null;
      let coveringStart = 0;
      for (const s of subscriptions) {
        if (!s.startDate) continue; // pending — دوره فعال نداشته است
        const start = s.startDate.getTime();
        const end = (s.cancelledAt ?? s.endDate)?.getTime() ?? Number.POSITIVE_INFINITY;
        if (t >= start && t <= end && (!covering || Math.abs(start - t) < Math.abs(coveringStart - t))) {
          covering = s;
          coveringStart = start;
        }
      }
      if (covering) return covering;
      // همان cycle تولید — نزدیک‌ترین اشتراک در پنجره ۱۰ دقیقه
      let best: (typeof subscriptions)[number] | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const s of subscriptions) {
        const diff = Math.abs((s.startDate ?? s.createdAt).getTime() - t);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = s;
        }
      }
      if (best && bestDiff <= 10 * 60 * 1000) return best;
      return null;
    };

    // ساخت خلاصه هر دوره برنامه
    // ⚠️ گارد JSON.parse: یک رکورد خراب نباید کل endpoint را 500 کند —
    // محتوای تمرینی خراب → کل ردیف skip؛ محتوای غذایی خراب → فقط اطلاعات
    // غذایی همان برنامه حذف می‌شود (برنامه تمرینی سالم نمایش داده می‌شود).
    const programs = workoutPlans.flatMap((wp) => {
      let content: any;
      try {
        content = JSON.parse(wp.content);
      } catch {
        console.error("[Program History] corrupt workoutPlan content — skipped:", wp.id);
        return [];
      }
      const mealPlan = mealPlanForWorkout(wp);
      let mealContent: any = null;
      if (mealPlan) {
        try {
          mealContent = JSON.parse(mealPlan.content);
        } catch {
          console.error("[Program History] corrupt mealPlan content — ignored:", mealPlan.id);
          mealContent = null;
        }
      }
      const sub = subscriptionForWorkout(wp);

      return [{
        id: wp.id,
        weekIndex: wp.weekIndex,
        active: wp.active,
        createdAt: wp.createdAt.toISOString(),
        days: content.days?.length || 0,
        exercises: content.days?.reduce((s: number, d: any) => s + (d.exercises?.length || 0), 0) || 0,
        weeklyGoal: content.weeklyGoal || "",
        notes: content.notes || "",
        // ─── v73.4 — نکات حرفه‌ای تمرین (درخواست مالک: سکشن «نکات تمرینی» در مدال برنامه) ───
        // از content تولید AI (WorkoutPlanContent) پاس داده می‌شوند؛ برنامه‌های قدیمی
        // این فیلدها را ندارند → undefined → سکشن در UI رندر نمی‌شود (سازگار با عقب).
        weeklyProgression: content.weeklyProgression && typeof content.weeklyProgression === "object"
          ? content.weeklyProgression
          : undefined,
        safetyNotes: Array.isArray(content.safetyNotes)
          ? content.safetyNotes.map((s: any) => String(s))
          : undefined,
        recoveryNotes: Array.isArray(content.recoveryNotes)
          ? content.recoveryNotes.map((s: any) => String(s))
          : undefined,
        nutritionTimingNotes: Array.isArray(content.nutritionTimingNotes)
          ? content.nutritionTimingNotes.map((s: any) => String(s))
          : undefined,
        // گرد کردن مقادیر تغذیه — AI گاهی اعداد floating-point با اعشار طولانی
        // (مثل ۲۱۸.۴۰۰۰۰۰۰۰۰۰۰۰۰۳) برمی‌گرداند که بدون گرد شدن در UI زشت نمایش داده می‌شد
        totalCalories: Math.round(mealContent?.totalCalories || 0),
        planName: sub?.plan || user.planName,
        status: sub?.status || "unknown",
        startDate: sub?.startDate?.toISOString() || wp.createdAt.toISOString(),
        endDate: sub?.endDate?.toISOString() || null,
        // تاریخ لغو توسط ادمین — اگر موجود باشد، برنامه از startDate تا cancelledAt نمایش داده می‌شود
        cancelledAt: sub?.cancelledAt?.toISOString() || null,
        // برنامه تمرینی کامل
        workoutDays: content.days || [],
        // مکمل‌های ساده (لیست تخت — برای همه پلن‌ها)
        supplements: mealContent?.supplements || content.supplements || [],
        // برنامه مکمل پیشرفته (با دسته‌بندی base/advanced/targeted و هشدارهای پزشکی)
        // فقط برای پلن‌های استاندارد به بالا — توسط AI در generateMealPlan تولید می‌شود
        supplementStack: mealContent?.supplementStack || [],
        // برنامه غذایی
        meals: mealContent?.meals || [],
        mealNotes: mealContent?.notes || "",
        waterLiters: Math.round((mealContent?.waterLiters || 2.5) * 10) / 10,
        totalProtein: Math.round(mealContent?.totalProtein || 0),
        totalCarbs: Math.round(mealContent?.totalCarbs || 0),
        totalFat: Math.round(mealContent?.totalFat || 0),
      }];
    });

    let aiAnalysis: string | null = null;

    // ─── v48 — تحلیل هوشمند «یک‌بار در هر پلن» (دیریکتیو مالک) ───
    // «دکمهٔ تحلیل هوشمند یک بار در هر پلن ساخته می‌شه متنش نوشته شده ولی چند
    //  بار داره ساخته می‌شه» — ریشه: نتیجه هرگز ذخیره نمی‌شد؛ هر کلیک یک
    //  فراخوانی پرهزینهٔ LLM و هر ورود دوباره دکمه بود.
    // راه‌حل: جدول PlanAiAnalysis با کلید (userId, planKey) — planKey =
    //  آخرین چرخهٔ برنامه (WorkoutPlan.id تازه‌ترین). تا وقتی پلن/بازسازی
    //  جدیدی نباشد:
    //   • analyze=1 با تحلیل ذخیره‌شده پاسخ می‌دهد — بدون هیچ درخواست LLM
    //   • GET عادی هم تحلیل ذخیره‌شده را برمی‌گرداند → آکاردئون به‌جای دکمه
    //     می‌ماند تا انتهای پلن (رفتار خواسته‌شدهٔ مالک)
    const activePlanKey = workoutPlans[0]?.id ?? "none";
    let storedAnalysis: { content: string; model: string | null } | null = null;
    try {
      const row = await db.planAiAnalysis.findUnique({
        where: { userId_planKey: { userId: user.id, planKey: activePlanKey } },
        select: { content: true, model: true },
      });
      if (row?.content) storedAnalysis = { content: row.content, model: row.model };
    } catch {
      // جدول/رکورد نبود — همان رفتار قبلی
    }

    if (storedAnalysis) {
      // قبلاً برای همین پلن تولید شده — بدون صدا زدن AI (ضد سوختن توکن)
      aiAnalysis = storedAnalysis.content;
    } else if (generateAnalysis && programs.length > 0 && user.planName) {
      try {
        const { createResilientCompletion, TEXT_TASK_MODEL, TEXT_MODEL, withSystemDirectives } = await import("@/lib/fitness/ai");

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

        const aiText = await createResilientCompletion(
          {
          // v69 — دیریکتیو مالک: وظایف متنی → deepseek-v4-flash (فال‌بک: gemini-3.8)
          model: TEXT_TASK_MODEL,
          fallback_model: TEXT_MODEL,
          messages: [
            { role: "system", content: withSystemDirectives("تو فیتاپ هوشمند هستی — مربی متخصص ورزشی. به زبان فارسی پاسخ بده.") },
            { role: "user", content: summary },
          ],
        } as any,
          { logTag: "program-history-analysis", maxTokens: 4096, timeoutMs: 120_000, maxAttempts: 2 }
        );
        aiAnalysis = aiText || null;

        // v48 — ذخیرهٔ ابدی برای همین چرخهٔ پلن (آکاردئون تا انتهای پلن)
        if (aiAnalysis && activePlanKey !== "none") {
          try {
            await db.planAiAnalysis.upsert({
              where: { userId_planKey: { userId: user.id, planKey: activePlanKey } },
              create: { userId: user.id, planKey: activePlanKey, content: aiAnalysis, model: TEXT_TASK_MODEL },
              update: { content: aiAnalysis, model: TEXT_TASK_MODEL },
            });
          } catch (storeErr) {
            console.warn("[Program History] analysis persist failed:", storeErr);
          }
        }
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
    let programStatus = latestRequest?.status ?? "ready";
    // ─── v44 — دیریکتیو مالک: بنر «خطا در تولید برنامه» نباید ابدی بماند ───
    // «خوب باید بعد از رفرش یا یک اتفاق خاصی این پیام بره دیگه. نمیشه که همیشه بمونه»
    // شکستِ قدیمیِ آخرین درخواست وقتی دیگر معنا ندارد که کاربر برنامهٔ فعال
    // دارد یا بعد از آن شکست، برنامهٔ جدیدی ساخته شده — در این حالت‌ها وضعیت
    // مؤثر «ready» است و بنر خطا نباید نمایش داده شود. اگر برنامه‌ای وجود
    // ندارد، سوئیپ خودترمیم (recoverStuckGenerations بالا) درخواستِ شکستخورده
    // با attempts<3 را دوباره صف می‌کند و بنر خودش به «در حال تولید» برمی‌گردد.
    if (programStatus === "failed" && latestRequest) {
      const hasActivePlan = await db.workoutPlan.findFirst({
        where: { userId: user.id, active: true },
        select: { id: true },
      });
      if (hasActivePlan) {
        programStatus = "ready";
      } else {
        const planAfterFailure = await db.workoutPlan.findFirst({
          where: { userId: user.id, createdAt: { gt: latestRequest.createdAt } },
          select: { id: true },
        });
        if (planAfterFailure) programStatus = "ready";
      }
    }

    // ─── v76: وزن فعلی پروفایل — برای بنر ناسازگاری وزن برنامه ───
    const profileWeightRow = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
      select: { weight: true, weightUpdatedAt: true },
    });
    const activeWorkoutRow = workoutPlans.find((p) => p.active) ?? null;
    const activeMealRow = mealPlans.find((p) => p.active) ?? null;
    const weightMismatch = {
      workout: computePlanWeightMismatch({
        baseWeight: activeWorkoutRow?.baseWeight ?? null,
        planCreatedAt: activeWorkoutRow?.createdAt ?? null,
        profileWeight: profileWeightRow?.weight ?? null,
        weightUpdatedAt: profileWeightRow?.weightUpdatedAt ?? null,
      }),
      meal: computePlanWeightMismatch({
        baseWeight: activeMealRow?.baseWeight ?? null,
        planCreatedAt: activeMealRow?.createdAt ?? null,
        profileWeight: profileWeightRow?.weight ?? null,
        weightUpdatedAt: profileWeightRow?.weightUpdatedAt ?? null,
      }),
    };

    return Response.json({
      programs,
      totalPrograms: programs.length,
      weightLogs: weightLogs.map((w) => ({
        weight: w.weight,
        loggedAt: w.loggedAt.toISOString(),
      })),
      checkupCount: checkups.length,
      aiAnalysis,
      // v48 — وضعیت تحلیل برای UI (true = آکاردئون ذخیره‌شده از قبل موجود است)
      aiAnalysisStored: !!storedAnalysis,
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
      // ─── v76: دادهٔ بنر ناسازگاری وزن (تیکت «۴۶ ولی در برنامه ۹۷») ───
      // برنامهٔ فعال با چه وزنی تولید شده و وزن فعلی پروفایل چقدر است؛
      // اگر اختلاف ≥ ۲ کیلو باشد UI بنر هشدار «برنامه قدیمی است» می‌دهد.
      planBaseWeight: {
        workout: activeWorkoutRow?.baseWeight ?? null,
        meal: activeMealRow?.baseWeight ?? null,
      },
      currentProfileWeight: profileWeightRow?.weight ?? null,
      weightMismatch,
    });
  } catch (e) {
    return apiError(e);
  }
}
