import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { generateWorkoutPlan, generateMealPlan } from "@/lib/fitness/ai";
import type { OnboardingData } from "@/lib/fitness/types";
import { checkPrerequisites } from "@/lib/fitness/prerequisites";

/**
 * Robustly parse a JSON-or-CSV string list field (equipment, workoutDaysList, medicalConditions).
 * - JSON array string: '["dumbbell","barbell"]' → ["dumbbell","barbell"]
 * - CSV string: "dumbbell,barbell" → ["dumbbell","barbell"]
 * - Empty string or null → []
 */
function safeParseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    if (typeof parsed === "string") {
      return parsed.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [];
  } catch {
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

// Get active workout + meal plan
export async function GET() {
  try {
    const user = await requireAuth();
    const [workout, meal, profile] = await Promise.all([
      db.workoutPlan.findFirst({
        where: { userId: user.id, active: true },
        orderBy: { createdAt: "desc" },
      }),
      db.mealPlan.findFirst({
        where: { userId: user.id, active: true },
        orderBy: { createdAt: "desc" },
      }),
      db.onboardingProfile.findUnique({ where: { userId: user.id } }),
    ]);

    return Response.json({
      workout: workout ? JSON.parse(workout.content) : null,
      meal: meal ? JSON.parse(meal.content) : null,
      hasProfile: !!profile,
    });
  } catch (e) {
    return apiError(e);
  }
}

// Regenerate plans
export async function PUT() {
  try {
    const user = await requireAuth();

    // ─── بررسی پیش‌نیازها بر اساس پلن (وظیفه ۸) ───
    // برای پلن پیشرفته (advanced) و حرفه‌ای (ultimate)، ارسال عکس بدن الزامی است.
    // برای پلن ultimate، علاوه بر عکس بدن، ویدیو و آزمایش خون هم باید تعیین تکلیف شده باشند.
    const userPlan = (user.planName as string) ?? null;
    const prereqCheck = await checkPrerequisites(user.id, userPlan as any);

    if (!prereqCheck.canGenerateProgram) {
      // پیش‌نیازها تکمیل/تعیین تکلیف نشده‌اند — برنامه نباید ساخته شود
      return Response.json({
        error: prereqCheck.blockingReason ?? "ابتدا پیش‌نیازها را تکمیل کنید.",
        needsBodyPhoto: !prereqCheck.allRequiredCompleted,
        prerequisites: prereqCheck.prerequisites,
      }, { status: 400 });
    }

    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      return Response.json({ error: "ابتدا آنبوردینگ را تکمیل کنید." }, { status: 400 });
    }

    const data: OnboardingData = {
      gender: profile.gender as OnboardingData["gender"],
      age: profile.age,
      height: profile.height,
      weight: profile.weight,
      targetWeight: profile.targetWeight ?? undefined,
      goal: profile.goal as OnboardingData["goal"],
      activityLevel: profile.activityLevel as OnboardingData["activityLevel"],
      workoutDays: profile.workoutDays,
      workoutDaysList: safeParseList(profile.workoutDaysList),
      workoutPlace: profile.workoutPlace as OnboardingData["workoutPlace"],
      equipment: safeParseList(profile.equipment),
      diseases: profile.diseases,
      injuries: profile.injuries,
      allergies: profile.allergies,
      dietType: profile.dietType as OnboardingData["dietType"],
      trainingExperience: (profile.trainingExperience ?? undefined) as OnboardingData["trainingExperience"],
      previousTrainingType: profile.previousTrainingType ?? undefined,
      drugAllergies: profile.drugAllergies ?? undefined,
      currentMedications: profile.currentMedications ?? undefined,
      maxLifts: profile.maxLifts ?? undefined,
      // NEW: comprehensive professional fields
      bodyFrame: (profile.bodyFrame ?? undefined) as OnboardingData["bodyFrame"],
      sleepHours: profile.sleepHours ?? undefined,
      stressLevel: profile.stressLevel ?? undefined,
      waterHabit: profile.waterHabit ?? undefined,
      targetDate: profile.targetDate ?? undefined,
      workoutTime: (profile.workoutTime ?? undefined) as OnboardingData["workoutTime"],
      medicalConditions: safeParseList(profile.medicalConditions) as OnboardingData["medicalConditions"],
      currentSupplements: profile.currentSupplements ?? undefined,
      dislikedFoods: profile.dislikedFoods ?? undefined,
      preferredCuisine: (profile.preferredCuisine ?? undefined) as OnboardingData["preferredCuisine"],
      // Auto-calculated water goal from weight × 35 ml + activity adjustment
      waterGoalMl: (() => {
        const w = profile.weight || 70;
        const baseMl = Math.round(w * 35);
        let adj = 0;
        const al = profile.activityLevel;
        if (al === "active" || al === "very_active") adj = 500;
        else if (al === "moderate") adj = 250;
        return baseMl + adj;
      })(),
    };

    await db.workoutPlan.updateMany({
      where: { userId: user.id },
      data: { active: false },
    });
    await db.mealPlan.updateMany({
      where: { userId: user.id },
      data: { active: false },
    });

    // ─── بارگذاری extras برای AI (وظیفه ۱۱) ───
    // وقتی برنامه regenerate می‌شود، باید همان اطلاعات تحلیلی که در ساخت اولیه
    // استفاده شده بود، دوباره به AI داده شود: تحلیل عکس بدن، تحلیل ویدیو، آزمایش خون.
    // این نتایج در جدول AnalysisResult ذخیره شده‌اند.
    const extras: {
      bodyPhotoAnalysis?: string;
      videoAnalysisResult?: string;
      bloodTestReport?: string;
    } = {};

    // آخرین تحلیل عکس بدن
    try {
      const latestBodyPhoto = await db.analysisResult.findFirst({
        where: { userId: user.id, type: "body_photo" },
        orderBy: { createdAt: "desc" },
        select: { result: true, createdAt: true },
      });
      if (latestBodyPhoto?.result) {
        try {
          const parsed = JSON.parse(latestBodyPhoto.result);
          // ساختار جدید: { analysis: string, createdAt, photoCount }
          // ساختار قدیمی: { analysis: string, recommendations: [], bodyScore: number }
          const analysisText = parsed.analysis ? String(parsed.analysis) : "";
          if (analysisText) {
            extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر (تاریخ: ${new Date(latestBodyPhoto.createdAt).toLocaleDateString("fa-IR")}):\n${analysisText}`;
          } else {
            // fallback برای ساختار قدیمی
            const summaryParts: string[] = [];
            if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
              summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
            }
            if (parsed.bodyScore != null) summaryParts.push(`امتیاز فرم بدن: ${parsed.bodyScore} از ۱۰۰`);
            if (summaryParts.length > 0) {
              extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر (تاریخ: ${new Date(latestBodyPhoto.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
            }
          }
        } catch {
          extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر:\n${latestBodyPhoto.result.slice(0, 800)}`;
        }
      }
    } catch (bpErr) {
      console.error("[coach/plan PUT] failed to load body photo analysis:", bpErr);
    }

    // آخرین تحلیل ویدیو
    try {
      const latestVideo = await db.analysisResult.findFirst({
        where: { userId: user.id, type: "video_analysis" },
        orderBy: { createdAt: "desc" },
        select: { result: true, createdAt: true },
      });
      if (latestVideo?.result) {
        try {
          const parsed = JSON.parse(latestVideo.result);
          // ساختار جدید: { analysis: string, createdAt }
          // ساختار قدیمی: { posture, symmetry, score, issues, recommendations }
          if (parsed.analysis && typeof parsed.analysis === "string") {
            extras.videoAnalysisResult = `آخرین تحلیل ویدیوی فرم بدن کاربر (تاریخ: ${new Date(latestVideo.createdAt).toLocaleDateString("fa-IR")}):\n${parsed.analysis}`;
          } else {
            const summaryParts: string[] = [];
            if (parsed.posture) summaryParts.push(`پوسچر: ${parsed.posture}`);
            if (parsed.symmetry != null) summaryParts.push(`تقارن: ${parsed.symmetry} از ۱۰۰`);
            if (parsed.score != null) summaryParts.push(`امتیاز: ${parsed.score} از ۱۰۰`);
            if (parsed.issues && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
              summaryParts.push(`مشکلات: ${parsed.issues.join("، ")}`);
            }
            if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
              summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
            }
            if (summaryParts.length > 0) {
              extras.videoAnalysisResult = `آخرین تحلیل ویدیوی فرم بدن کاربر (تاریخ: ${new Date(latestVideo.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
            }
          }
        } catch {
          extras.videoAnalysisResult = `آخرین تحلیل ویدیوی کاربر:\n${latestVideo.result.slice(0, 800)}`;
        }
      }
    } catch (vErr) {
      console.error("[coach/plan PUT] failed to load video analysis:", vErr);
    }

    // آخرین آزمایش خون
    try {
      const latestBloodTest = await db.analysisResult.findFirst({
        where: { userId: user.id, type: "blood_test" },
        orderBy: { createdAt: "desc" },
        select: { result: true, createdAt: true },
      });
      if (latestBloodTest?.result) {
        try {
          const parsed = JSON.parse(latestBloodTest.result);
          const summaryParts: string[] = [];
          if (parsed.summary) summaryParts.push(String(parsed.summary));
          if (parsed.abnormalities && Array.isArray(parsed.abnormalities) && parsed.abnormalities.length > 0) {
            summaryParts.push(`ناهنجاری‌ها: ${parsed.abnormalities.map((a: any) => typeof a === "string" ? a : (a?.name || a?.test || JSON.stringify(a))).join("، ")}`);
          }
          if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
            summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
          }
          if (summaryParts.length > 0) {
            extras.bloodTestReport = `آخرین آزمایش خون کاربر (تاریخ: ${new Date(latestBloodTest.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
          }
        } catch {
          extras.bloodTestReport = `آخرین آزمایش خون کاربر:\n${latestBloodTest.result.slice(0, 800)}`;
        }
      }
    } catch (btErr) {
      console.error("[coach/plan PUT] failed to load blood test:", btErr);
    }

    const userPlanForGeneration = (user.planName as any) ?? null;
    const [workout, meal] = await Promise.all([
      generateWorkoutPlan(data, userPlanForGeneration, extras),
      generateMealPlan(data, userPlanForGeneration, extras),
    ]);

    await db.workoutPlan.create({
      data: { userId: user.id, content: JSON.stringify(workout), active: true },
    });
    await db.mealPlan.create({
      data: { userId: user.id, content: JSON.stringify(meal), totalCal: meal.totalCalories, active: true },
    });

    return Response.json({ workout, meal });
  } catch (e) {
    return apiError(e);
  }
}
