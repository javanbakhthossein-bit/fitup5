import { db } from "@/lib/db";
import { generateWorkoutPlan, generateMealPlan, capPromptText, extractRedesignConstraintsLLM } from "@/lib/fitness/ai";
import type { ProWorkoutPlanContent, ProMealPlanContent } from "@/lib/fitness/ai";
import { buildLocalFallbackWorkoutPlan, buildLocalFallbackMealPlan } from "@/lib/fitness/local-plan-fallback";
import { runPlanQualityGate } from "@/lib/fitness/plan-quality-gate";
import type { OnboardingData, Plan } from "@/lib/fitness/types";
import { sanitizeDiscipline } from "@/lib/fitness/types";
import { checkPrerequisites } from "@/lib/fitness/prerequisites";
import { activatePendingSubscription } from "@/lib/fitness/subscription";
import { createNotification } from "@/lib/fitness/notifications";
import { notifyProgramReadySms } from "@/lib/fitness/sms-flows";
import { buildUserDto } from "@/lib/fitness/auth";
import { fixPlanTypographyDeep } from "@/lib/fitness/persian-typography";
import { planHasSupplements as planIncludesSupplement } from "@/lib/fitness/supplement-gate";
import { resolveActiveWeight } from "@/lib/fitness/active-weight";
import { toPersianDigits } from "@/lib/fitness/types";
// v172 — رویداد زندهٔ پنل: «برنامه آماده شد» بدون رفرش به تب برنامه‌ها می‌رسد
import { publishPanelEvent } from "@/lib/realtime/panel-hub";
import { getPlanRegenState } from "@/lib/fitness/plan-change-intent";
import {
  buildRedesignDirectiveFa,
  repairPlanDaySplitToRequest,
  type RequestedSplitSpec,
} from "@/lib/fitness/plan-redesign-request";
// v149 — ممنوعیت‌های صریح کاربر/مدیر (تیکت مالک: حرکات/مواد حذفی دوباره برنگردند)
// v152 — ممیزی فال‌بک محلی هم (enforce*)
import {
  parseRedesignConstraintsFromText,
  mergeConstraints,
  sanitizeConstraints,
  buildMovementExclusionDirectiveFa,
  buildFoodExclusionDirectiveFa,
  enforceWorkoutExclusions,
  enforceMealExclusions,
  type RedesignConstraints,
} from "@/lib/fitness/plan-redesign-constraints";
import { buildLockedBank, type BankExerciseRow } from "@/lib/fitness/exercise-bank-lock";
// v157 — مخزن ماندگار ممنوعیت‌ها (حفره‌های ۱/۲/۳ تیکت مصطفی خوشبخت)
import {
  readPersistentExclusions,
  mergePersistentExclusions,
} from "@/lib/fitness/persistent-exclusions";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  globalYoutubeEnabledFromValue,
} from "@/lib/fitness/exercise-video";

/** v215 — ارقام فارسی امن برای مقادیر اختیاری/احتمالاً undefined (پروندهٔ AI) */
const pdNum = (v: unknown): string => (v == null || v === "" ? "—" : toPersianDigits(String(v)));

/**
 * تولید برنامه (تمرینی + غذایی) در پس‌زمینه — هسته مشترک.
 *
 * چرا این فایل وجود دارد:
 * تولید برنامه با هوش مصنوعی ۱ تا ۵ دقیقه طول می‌کشد (با تفکر high بیشتر).
 * اگر داخل request handler به‌صورت سینکرون اجرا شود، درخواست از سقف تایم‌اوت
 * گیت‌وی عبور می‌کند و مرورگر پاسخ HTML خطا می‌گیرد («Unexpected token '<'») —
 * در حالی که سرور کار را ادامه می‌دهد و برنامه در نهایت ساخته می‌شود؛ یعنی
 * کاربر هم خطا می‌بیند هم بعداً برنامه دارد (باگ گزارش‌شده).
 *
 * راه‌حل: همه مسیرها (خرید، آپلود عکس بدن، تعیین تکلیف ویدیو/آزمایش خون،
 * retry از تب برنامه‌ها) از این تابع استفاده می‌کنند:
 *  ۱) وضعیت ProgramRequest فوراً «generating» می‌شود (UI بنر «در حال طراحی» نشان می‌دهد)
 *  ۲) تولید در پس‌زمینه (fire-and-forget) انجام می‌شود
 *  ۳) با موفقیت: برنامه‌ها ذخیره + وضعیت ready + نوتیفیکیشن «برنامه آماده شد»
 *  ۴) با خطا: وضعیت failed + نوتیفیکیشن (کاربر از تب برنامه‌ها retry می‌کند)
 */

/**
 * v111 — نسخه‌بندی برنامه: متن «خلاصهٔ تغییرات» هر نسخه بر اساس منبع تولید.
 * برای source=chat_request متن واقعی درخواست کاربر (از مسیر تایید در چت) پاس
 * داده می‌شود و در خود برنامه (changeSummary) + پیام خلاصهٔ چت ذخیره می‌شود؛
 * بقیهٔ منابع یک خط فارسی ثابت می‌گیرند. خروجی null یعنی «فیلد خالی بماند»
 * (سازگار با ردیف‌های قدیمیِ بدون نسخه‌بندی).
 */
const CHANGE_SUMMARY_MAX_CHARS = 300;

function buildChangeSummary(
  source: "checkup" | "admin_rewrite" | "chat_request" | "weight_update" | "renewal_update" | null,
  userSummary?: string | null
): string | null {
  const fallbackBySource: Record<string, string> = {
    purchase: "برنامهٔ اولیه پس از خرید",
    checkup: "به‌روزرسانی پس از چکاپ",
    admin_rewrite: "بازنویسی توسط مدیر",
    chat_request: "بازطراحی بر اساس درخواست کاربر در چت با فیتاپ",
    weight_update: "به‌روزرسانی با وزن جدید",
  };
  const text = (userSummary ?? "").trim() || fallbackBySource[source ?? ""] || null;
  if (!text) return null;
  return text.length > CHANGE_SUMMARY_MAX_CHARS
    ? text.slice(0, CHANGE_SUMMARY_MAX_CHARS).trimEnd() + "…"
    : text;
}

/**
 * v112 — خلاصهٔ فشردهٔ برنامهٔ تمرینی ذخیره‌شده برای هم‌سازی پرامپت تغذیه
 * (سینک کامل تمرین/تغذیه/مکمل — دیرکتیو مالک). فقط آنچه متخصص تغذیه لازم
 * دارد: تقسیم عضلات/دوره‌بندی/فرکانس، روزها و تمرکز و مدت هر جلسه، استراتژی
 * پیشرفت و اهداف هفته‌ها. سقف سخت ~۲۲۰۰ نویسه تا پرامپت منفجر نشود.
 * ورودی، content ذخیره‌شدهٔ همین چرخه است؛ خروجی null یعنی «هم‌زمینه‌ای نیست».
 */
export function buildWorkoutSyncContext(content: unknown): string | null {
  try {
    const w = content as {
      days?: Array<{ day?: string; title?: string; focus?: string; estimatedMinutes?: number }>;
      muscleGroupSplit?: string;
      periodizationType?: string;
      muscleFrequencyPerWeek?: number;
      weeklyProgression?: {
        strategy?: string;
        weeks?: Array<{ week?: number; note?: string }>;
      };
    };
    if (!w || !Array.isArray(w.days) || w.days.length === 0) return null;
    const lines: string[] = [];
    const meta: string[] = [];
    if (w.muscleGroupSplit) meta.push(`تقسیم عضلات: ${w.muscleGroupSplit}`);
    if (w.periodizationType) meta.push(`دوره‌بندی: ${w.periodizationType}`);
    if (typeof w.muscleFrequencyPerWeek === "number") meta.push(`فرکانس هر گروه: ${w.muscleFrequencyPerWeek} بار در هفته`);
    if (meta.length) lines.push(`- ${meta.join(" | ")}`);
    const dayLines = w.days.map((d) => {
      const parts = [d.title, d.focus].filter(Boolean).join(" — ");
      const mins = typeof d.estimatedMinutes === "number" ? `، حدود ${d.estimatedMinutes} دقیقه` : "";
      return `${d.day ?? "؟"} (${parts}${mins})`;
    });
    lines.push(`- روزهای تمرین: ${dayLines.join("؛ ")}`);
    if (w.weeklyProgression) {
      if (w.weeklyProgression.strategy) lines.push(`- استراتژی پیشرفت: ${w.weeklyProgression.strategy}`);
      if (Array.isArray(w.weeklyProgression.weeks) && w.weeklyProgression.weeks.length) {
        const weekNotes = w.weeklyProgression.weeks
          .map((x) => `هفتهٔ ${x.week ?? "؟"}: ${(x.note ?? "").trim()}`.trim())
          .filter((s) => !s.endsWith(":"))
          .join(" | ");
        if (weekNotes) lines.push(`- اهداف هفته‌ها: ${weekNotes}`);
      }
    }
    if (lines.length === 0) return null;
    const text = lines.join("\n");
    return text.length > 2200 ? text.slice(0, 2200).trimEnd() : text;
  } catch {
    return null;
  }
}

/** پارس لیست ذخیره‌شده به‌صورت JSON یا CSV */
function safeParseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const p = JSON.parse(t);
    if (Array.isArray(p)) return p.map((x) => String(x));
    if (typeof p === "string") return p.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  } catch {
    return t.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

/**
 * ساخت OnboardingData از پروفایل ذخیره‌شده — وزن فعلی با رزولور مرکزی v76.
 * قبلاً `latestWeightLog?.weight ?? profile.weight` بود که وقتی کاربر وزن را
 * در پروفایل اصلاح می‌کرد ولی WeightLog قدیمی می‌ماند، برنامه با وزنِ کهنه
 * ساخته می‌شد (تیکت «۴۶ ولی در برنامه ۹۷»). حالا تعارض با مقایسهٔ زمانی
 * weightUpdatedAt پروفایل و loggedAt لاگ حل می‌شود.
 */
export async function buildOnboardingData(userId: string): Promise<OnboardingData | null> {
  const profile = await db.onboardingProfile.findUnique({ where: { userId } });
  if (!profile) return null;

  const activeWeight = await resolveActiveWeight(userId);
  const currentWeight = activeWeight.weight ?? profile.weight;

  return {
    gender: profile.gender as OnboardingData["gender"],
    age: profile.age,
    height: profile.height,
    weight: currentWeight,
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
    // v81 — تعداد وعده‌های رغبتی کاربر — در پرامپت برنامهٔ غذایی لحاظ می‌شود
    mealCount: profile.mealCount ?? undefined,
    trainingExperience: (profile.trainingExperience ?? undefined) as OnboardingData["trainingExperience"],
    previousTrainingType: profile.previousTrainingType ?? undefined,
    drugAllergies: profile.drugAllergies ?? undefined,
    currentMedications: profile.currentMedications ?? undefined,
    maxLifts: profile.maxLifts ?? undefined,
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
    // v60 — شرایط/نیاز/هدف خاص کاربر (متن آزاد) — در پرامپت برنامهٔ تمرینی/غذایی/مکمل تزریق می‌شود
    // v75 — این فیلد «توضیحات کاربر» در پروفایل هم قابل ویرایش است و در بازسازی برنامه استفاده می‌شود
    specialConditions: profile.specialConditions ?? undefined,
    // v75 — رشتهٔ ورزشی (فیزیک کلاسیک/بادی‌بیلدینگ/فیتنس/…) — در همهٔ پرامپت‌ها لحاظ می‌شود (v95: sanitize)
    discipline: sanitizeDiscipline(profile.discipline),
    // v162 — فرم بدن + دخانیات + نواحی آسیب + سایر مشکلات — در همهٔ پرامپت‌ها
    bodyShape: (profile.bodyShape ?? undefined) as OnboardingData["bodyShape"],
    smokingHabit: (profile.smokingHabit ?? undefined) as OnboardingData["smokingHabit"],
    injuryAreas: safeParseList(profile.injuryAreas) as OnboardingData["injuryAreas"],
    otherHealthIssues: profile.otherHealthIssues ?? undefined,
    // v74 — یادداشت‌های تغذیه‌ای کاربر (ستون OnboardingProfile.nutritionNotes):
    // از دستیار تغذیه ثبت می‌شود و باید در تولید برنامه (تمرینی/غذایی/مکمل)
    // و همهٔ پرامپت‌های AI پروندهٔ ورزشی دقیق رعایت شود.
    nutritionNotes: profile.nutritionNotes ?? undefined,
    // ─── v214 — اندازه‌های بدنی پایه (دیرکتیو مالک: ممیزی تزریق کانتکست AI) ───
    // این اندازه‌ها از آنبوردینگ/فاز صفر ( renew/update-metrics ) ثبت می‌شوند ولی
    // قبلاً هرگز خوانده نمی‌شدند → AI برنامه هرگز دورهای بدنی کاربر را نمی‌دید.
    // فیلدها در تایپ OnboardingData از قبل تعریف شده‌اند (types.ts) — اینجا مونتاژ.
    chestMeasurement: (profile as any).chestMeasurement ?? undefined,
    armMeasurement: (profile as any).armMeasurement ?? undefined,
    waistMeasurement: (profile as any).waistMeasurement ?? undefined,
    hipMeasurement: (profile as any).hipMeasurement ?? undefined,
    thighMeasurement: (profile as any).thighMeasurement ?? undefined,
    shoulderMeasurement: (profile as any).shoulderMeasurement ?? undefined,
    calfMeasurement: (profile as any).calfMeasurement ?? undefined,
    waterGoalMl: (() => {
      const w = currentWeight || 70;
      const baseMl = Math.round(w * 35);
      let adj = 0;
      const al = profile.activityLevel;
      if (al === "active" || al === "very_active") adj = 500;
      else if (al === "moderate") adj = 250;
      return baseMl + adj;
    })(),
  };
}

/** ساخت extras برای AI از نتایج تحلیل ذخیره‌شده (عکس بدن، ویدیو، آزمایش خون، تمدید) */
export async function buildGenerationExtras(userId: string): Promise<{
  bodyPhotoAnalysis?: string;
  videoAnalysisResult?: string;
  bloodTestReport?: string;
  renewalContext?: string;
  /** v149 — اسپک ساختاری چیدمان درخواستی از بازطراحی چت (تیکت مالک) */
  redesignSpec?: RequestedSplitSpec;
  redesignRaw?: string;
  /** v149 — بلوک دیرکتیو «درخواست صریح ورزشکار» برای تزریق در پرامپت تمرین */
  redesignDirective?: string;
  /** v149 — رکورد اشتراک حامل درخواست — بعد از ذخیرهٔ موفق برنامه پاک می‌شود */
  redesignSubscriptionId?: string | null;
  /** v149 — ممنوعیت‌های صریح حرکات/مواد (چت کاربر یا اصول مدیر) — ممیزی قطعی پس‌تولیدی دارد */
  redesignConstraints?: RedesignConstraints;
  /** v150 — دستور اصولی مدیر برای بازسازی برنامه (باکس «به‌روزرسانی برنامه») */
  adminDirective?: string;
  /** v213 — نقاط ضعف ساختاریافتهٔ آنالیز عکس بدن — ورودی مستقیم معمار برنامه (Coach Blueprint) */
  weakPoints?: string[];
}> {
  const extras: {
    bodyPhotoAnalysis?: string;
    videoAnalysisResult?: string;
    bloodTestReport?: string;
    renewalContext?: string;
    redesignSpec?: RequestedSplitSpec;
    redesignRaw?: string;
    redesignDirective?: string;
    redesignSubscriptionId?: string | null;
    redesignConstraints?: RedesignConstraints;
    adminDirective?: string;
    /** v213 — نقاط ضعف ساختاریافتهٔ آنالیز بدن */
    weakPoints?: string[];
  } = {};

  // آخرین تحلیل عکس بدن
  // v74: ردیف‌های placeholder (result JSON با status="processing"/"failed" —
  // تحلیل پس‌زمینهٔ در جریان یا ناموفق از submit-body-analysis) محتوای تحلیل
  // معتبر ندارند؛ از بین ۳ ردیف آخر، اولین ردیف با محتوای واقعی انتخاب می‌شود
  // تا placeholderِ در-جریان، تحلیل کاملِ قبلی را نپوشاند.
  try {
    const recentBodyPhotos = await db.analysisResult.findMany({
      where: { userId, type: "body_photo" },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { result: true, createdAt: true },
    });
    const latestBodyPhoto = recentBodyPhotos.find((row) => {
      try {
        const parsed = JSON.parse(row.result);
        return parsed?.status !== "processing" && parsed?.status !== "failed";
      } catch {
        // نتیجهٔ non-JSON قدیمی هم محتوای قابل استفاده است (سلایس خام در ادامه)
        return true;
      }
    });
    if (latestBodyPhoto?.result) {
      try {
        const parsed = JSON.parse(latestBodyPhoto.result);
        const analysisText = parsed.analysis ? String(parsed.analysis) : "";
        if (analysisText) {
          // v148 — فیلدهای ساختاریافتهٔ تحلیل بدن (آنالیز عکس حرفه‌ای): weakPoints
          // «اولویت اول برنامهٔ تمرینی» است و صریح به موتور AI اعلام می‌شود.
          const weakPts: string[] = Array.isArray(parsed.weakPoints)
            ? parsed.weakPoints.map((w: any) => String(w)).filter(Boolean).slice(0, 8)
            : [];
          const symIssues: string[] = Array.isArray(parsed.symmetryIssues)
            ? parsed.symmetryIssues.map((w: any) => String(w)).filter(Boolean).slice(0, 8)
            : [];
          const postIssues: string[] = Array.isArray(parsed.postureIssues)
            ? parsed.postureIssues.map((w: any) => String(w)).filter(Boolean).slice(0, 8)
            : [];
          const structuredLines: string[] = [];
          if (parsed.bodyFatEstimate) structuredLines.push(`تخمین چربی بدن: ${parsed.bodyFatEstimate}`);
          if (parsed.muscleMassLevel) structuredLines.push(`سطح تودهٔ عضلانی: ${parsed.muscleMassLevel}`);
          if (weakPts.length > 0) {
            structuredLines.push(
              `🔴 نقاط ضعف و عضلات عقب‌مانده (اولویت اول برنامهٔ تمرینی — فرکانس ۲ بار در هفته + حجم بالاتر): ${weakPts.join("؛ ")}`
            );
          }
          if (symIssues.length > 0) structuredLines.push(`عدم‌تقارن چپ/راست: ${symIssues.join("؛ ")}`);
          // v213 — نقاط ضعف برای معمار برنامه (اولویت اول معماری: فرکانس ۲ + اول جلسه)
          if (weakPts.length > 0) extras.weakPoints = weakPts;
          if (postIssues.length > 0) structuredLines.push(`ایرادات فرم اسکلتی: ${postIssues.join("؛ ")}`);
          const structuredBlock = structuredLines.length > 0 ? `\n\n⚠️ خلاصهٔ ساختاریافته (ورودی مستقیم برنامه):\n${structuredLines.map((l) => `- ${l}`).join("\n")}` : "";
          extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر (تاریخ: ${new Date(latestBodyPhoto.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}):\n${analysisText}${structuredBlock}`;
        } else {
          const summaryParts: string[] = [];
          if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
            summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
          }
          if (parsed.bodyScore != null) summaryParts.push(`امتیاز فرم بدن: ${parsed.bodyScore} از ۱۰۰`);
          if (summaryParts.length > 0) {
            extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر (تاریخ: ${new Date(latestBodyPhoto.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}):\n${summaryParts.join("\n")}`;
          }
        }
      } catch {
        extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر:\n${capPromptText(latestBodyPhoto.result, 2500)}`;
      }
    }
  } catch (e) {
    console.error("[program-generation] failed to load body photo analysis:", e);
  }

  // آخرین تحلیل ویدیو
  try {
    const latestVideo = await db.analysisResult.findFirst({
      where: { userId, type: "video_analysis" },
      orderBy: { createdAt: "desc" },
      select: { result: true, createdAt: true },
    });
    if (latestVideo?.result) {
      try {
        const parsed = JSON.parse(latestVideo.result);
        if (parsed.analysis && typeof parsed.analysis === "string") {
          extras.videoAnalysisResult = `آخرین تحلیل ویدیوی فرم بدن کاربر (تاریخ: ${new Date(latestVideo.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}):\n${parsed.analysis}`;
        } else {
          const summaryParts: string[] = [];
          if (parsed.posture) summaryParts.push(`فرم و وضعیت بدن: ${parsed.posture}`);
          if (parsed.symmetry != null) summaryParts.push(`تقارن: ${parsed.symmetry} از ۱۰۰`);
          if (parsed.score != null) summaryParts.push(`امتیاز: ${parsed.score} از ۱۰۰`);
          if (parsed.issues && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
            summaryParts.push(`مشکلات: ${parsed.issues.join("، ")}`);
          }
          if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
            summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
          }
          if (summaryParts.length > 0) {
            extras.videoAnalysisResult = `آخرین تحلیل ویدیوی فرم بدن کاربر (تاریخ: ${new Date(latestVideo.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}):\n${summaryParts.join("\n")}`;
          }
        }
      } catch {
        extras.videoAnalysisResult = `آخرین تحلیل ویدیوی کاربر:\n${capPromptText(latestVideo.result, 2500)}`;
      }
    }
  } catch (e) {
    console.error("[program-generation] failed to load video analysis:", e);
  }

  // آخرین آزمایش خون
  try {
    const latestBloodTest = await db.analysisResult.findFirst({
      where: { userId, type: "blood_test" },
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
          extras.bloodTestReport = `آخرین آزمایش خون کاربر (تاریخ: ${new Date(latestBloodTest.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}):\n${summaryParts.join("\n")}`;
        }
      } catch {
        extras.bloodTestReport = `آخرین آزمایش خون کاربر:\n${capPromptText(latestBloodTest.result, 2500)}`;
      }
    }
  } catch (e) {
    console.error("[program-generation] failed to load blood test:", e);
  }

  // ─── v214 — بستر «جای کاربر در مسیر» + تمدید/بازتولید (دیرکتیو مالک) ───
  // قبلاً این بلوک فقط برای کاربر تکراری (اشتراک منقضی یا برنامهٔ قبلی) ساخته
  // می‌شد. حالا همیشه ساخته می‌شود تا AI همیشه بداند کاربر کجای مسیر است:
  //   ① جای کاربر در مسیر — روزهای همراهی / چندمین برنامه / تعداد چکاپ
  //   ② تمدید/بازتولید — دورهٔ قبلی + پیشرفت چکاپ (با اندازه‌های کامل بدن)
  //   ③ درخواست‌ها و نکات مطرح‌شدهٔ اخیر در گفتگو با فیتاپ (خلاصهٔ چت)
  //   ④ گالری پیشرفت (عکس‌های آپلودی کاربر) + آخرین تشخیص ترکیب بدن
  //   ⑤ پروندهٔ ورزشی نردبانی کامل (v155 — ۳۰ روز/ماهانه/فصلی/چکاپ/استریک)
  try {
    const parts: string[] = [];

    const [userRow, planCount, checkupCount, latestCheckup, latestBodyComp] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
      db.workoutPlan.count({ where: { userId } }),
      db.checkup.count({ where: { userId } }),
      db.checkup.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          weight: true, bodyFatPercent: true, fatigueLevel: true, sleepQuality: true,
          dietAdherence: true, workoutAdherence: true, phaseNumber: true, isFinalCheckup: true,
          chestMeasurement: true, armMeasurement: true, waistMeasurement: true,
          hipMeasurement: true, thighMeasurement: true, neckMeasurement: true,
        },
      }),
      db.bodyComposition.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }),
    ]);

    // ① جای کاربر در مسیر — همیشه تزریق می‌شود (تازه‌وارد یا قدیمی)
    if (userRow?.createdAt) {
      const daysSinceSignup = Math.max(0, Math.floor((Date.now() - userRow.createdAt.getTime()) / 86400000));
      const journeyLines: string[] = [`- ${daysSinceSignup} روز از ثبت‌نام در فیتاپ`];
      journeyLines.push(
        planCount > 0
          ? `- ${planCount} برنامهٔ ورزشی تاکنون ساخته شده (این برنامهٔ شمارهٔ ${planCount + 1} است)`
          : `- این اولین برنامهٔ ورزشی کاربر است — تازه‌وارد مسیر`
      );
      if (checkupCount > 0) journeyLines.push(`- ${checkupCount} چکاپ دوره‌ای ثبت کرده`);
      parts.push(`[سیستم - جای کاربر در مسیر]:\n${journeyLines.join("\n")}`);
    }

    // ② تمدید / بازتولید — فقط اگر سابقه دارد
    const previousSub = await db.subscription.findFirst({
      where: { userId, status: "expired" },
      orderBy: { endDate: "desc" },
      select: { plan: true, durationDays: true, endDate: true },
    });
    // v215 — برنامهٔ فعال اولویت دارد (چیدمان «فعلی» کاربر)؛ فال‌بک: آخرین برنامه
    const activePlanRow = await db.workoutPlan.findFirst({
      where: { userId, active: true },
      orderBy: { createdAt: "desc" },
      select: { content: true, createdAt: true },
    });
    const previousPlan = activePlanRow ?? (await db.workoutPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { content: true, createdAt: true },
    }));
    if (previousSub) {
      parts.push(`[سیستم - تمدید اشتراک]: این کاربر قبلاً پلن ${previousSub.plan} را برای ${previousSub.durationDays} روز استفاده کرده است.`);
    } else if (previousPlan) {
      parts.push(`[سیستم - بازتولید برنامه]: کاربر قبلاً برنامه داشته است.`);
    }
    // v215 — چیدمان برنامهٔ فعلی/آخرین کاربر (دیرکتیو مالک: «برنامه‌های قبلی به AI تزریق بشه»)
    // خلاصهٔ ساختاری فشرده (تقسیم عضلات/روزها/تمرکز/پریودایزیشن) — برای ادامهٔ منطقی
    // مسیر یا بازطراحی آگاهانه؛ سیر تکاملی لازم، تکرار کورکورانهٔ چیدمان قبلی ممنوع.
    if (previousPlan?.content) {
      try {
        // v215 فیکس — content در DB رشتهٔ JSON است؛ تابع آبجکت می‌خواهد
        const prevContent = JSON.parse(previousPlan.content) as unknown;
        const prevSummary = buildWorkoutSyncContext(prevContent);
        if (prevSummary) {
          parts.push(
            `[سیستم - چیدمان برنامهٔ فعلی/آخرین کاربر] (برای سیر تکاملی مسیر — تکرار کورکورانه ممنوع):
${prevSummary}`
          );
        }
      } catch (prevErr) {
        console.warn("[program-generation] previous plan layout summary failed (skipped):", prevErr);
      }
    }
    if (latestCheckup) {
      parts.push(`پیشرفت کاربر (آخرین چکاپ):`);
      if (latestCheckup.weight) parts.push(`- وزن فعلی: ${latestCheckup.weight}kg`);
      if (latestCheckup.bodyFatPercent) parts.push(`- درصد چربی: ${latestCheckup.bodyFatPercent}%`);
      // v214 — اندازه‌های بدنی ثبت‌شده در چکاپ (قبلاً به AI برنامه نمی‌رسید)
      const cm: Array<[string, number | null | undefined]> = [
        ["دور قفسهٔ سینه", latestCheckup.chestMeasurement],
        ["دور بازو", latestCheckup.armMeasurement],
        ["دور کمر", latestCheckup.waistMeasurement],
        ["دور باسن", latestCheckup.hipMeasurement],
        ["دور ران", latestCheckup.thighMeasurement],
        ["دور گردن", latestCheckup.neckMeasurement],
      ];
      const cmLines = cm.filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}cm`);
      if (cmLines.length > 0) parts.push(`- اندازه‌های بدنی: ${cmLines.join(" · ")}`);
      if (latestCheckup.fatigueLevel) parts.push(`- سطح انرژی: ${latestCheckup.fatigueLevel}/5`);
      if (latestCheckup.sleepQuality) parts.push(`- کیفیت خواب: ${latestCheckup.sleepQuality}/5`);
      if (latestCheckup.dietAdherence) parts.push(`- رعایت رژیم: ${latestCheckup.dietAdherence}/5`);
      if (latestCheckup.workoutAdherence) parts.push(`- رعایت تمرین: ${latestCheckup.workoutAdherence}/5`);
      if (latestCheckup.phaseNumber) parts.push(`- فاز تکمیل‌شده: ${latestCheckup.phaseNumber}${latestCheckup.isFinalCheckup ? " (چکاپ نهایی)" : ""}`);
      parts.push(`برنامه جدید را بر اساس این پیشرفت طراحی کن:`);
      if (latestCheckup.workoutAdherence && latestCheckup.workoutAdherence >= 4) {
        parts.push(`✅ رعایت عالی تمرین — شدت بیشتر پیشنهاد بده`);
      }
      if (latestCheckup.workoutAdherence && latestCheckup.workoutAdherence <= 2) {
        parts.push(`⚠️ رعایت ضعیف تمرین — حجم کمتر و تنوع بیشتر`);
      }
      if (latestCheckup.fatigueLevel && latestCheckup.fatigueLevel <= 2) {
        parts.push(`⚠️ خستگی بالا — حجم کمتر و استراحت بیشتر`);
      }
      if (latestCheckup.dietAdherence && latestCheckup.dietAdherence >= 4) {
        parts.push(`✅ رعایت عالی رژیم — کالری دقیق‌تر`);
      }
    }

    // ③ v214 — درخواست‌ها و نکات اخیر گفتگوی کاربر با فیتاپ (خلاصهٔ چت)
    // دیرکتیو مالک: «خلاصه و نکات مهم چت با فیتاپ و درخواست‌های کاربر در اونجا
    // به AI تزریق بشه». پیام‌های کاربرِ ۲۱ روز اخیر به‌صورت فشرده تزریق می‌شود.
    try {
      const chatCutoff = new Date(Date.now() - 21 * 86400000);
      const recentUserMsgs = await db.chatMessage.findMany({
        where: { userId, role: "user", createdAt: { gte: chatCutoff } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { content: true },
      });
      const chatLines = recentUserMsgs
        .map((m) => m.content.replace(/\s+/g, " ").trim())
        .filter((t) => t.length >= 4)
        .slice(0, 8)
        .map((t) => `«${t.slice(0, 140)}»`);
      if (chatLines.length > 0) {
        parts.push(
          `[سیستم - درخواست‌ها و نکات اخیر کاربر در گفتگو با دستیار فیتاپ] (جدیدترین اول — برای درک نیازها/اولویت‌ها؛ الزام قطعی فقط اگر درخواست صریح است):\n- ${chatLines.join("\n- ")}`
        );
      }
    } catch (chatErr) {
      console.warn("[program-generation] recent chat summary failed (skipped):", chatErr);
    }

    // ④ v214 — گالری پیشرفت + آخرین تشخیص ترکیب بدن
    try {
      const [photoCount, latestPhoto] = await Promise.all([
        db.progressPhoto.count({ where: { userId } }),
        db.progressPhoto.findFirst({
          where: { userId },
          orderBy: { takenAt: "desc" },
          select: { takenAt: true, note: true },
        }),
      ]);
      if (photoCount > 0) {
        const galLines: string[] = [`- تعداد عکس‌های آپلودی در گالری پیشرفت: ${photoCount}`];
        if (latestPhoto?.takenAt) {
          galLines.push(`- آخرین آپلود: ${new Date(latestPhoto.takenAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}`);
        }
        if (latestPhoto?.note && latestPhoto.note.trim()) {
          galLines.push(`- یادداشت کاربر روی آخرین عکس: «${latestPhoto.note.trim().slice(0, 140)}»`);
        }
        parts.push(`[سیستم - گالری پیشرفت]:\n${galLines.join("\n")}`);
      }
      if (latestBodyComp) {
        parts.push(
          `[سیستم - ترکیب بدن]: آخرین تشخیص (${new Date(latestBodyComp.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}): چربی ${latestBodyComp.fatPercent}٪${latestBodyComp.musclePercent != null ? ` · عضله ${latestBodyComp.musclePercent}٪` : ""}`
        );
      }
      // v215 — تحلیل‌های عکس غذا ماندگار شدند (analyze-meal) — آخرین ۲ مورد
      // قبلاً فقط به کلاینت برمی‌گشت و اگر کاربر «افزودن به امروز» نمی‌زد، از دست می‌رفت.
      const mealAnalyses = await db.analysisResult.findMany({
        where: { userId, type: "meal_photo" },
        orderBy: { createdAt: "desc" },
        take: 2,
        select: { result: true, createdAt: true },
      }).catch(() => [] as { result: string; createdAt: Date }[]);
      if (mealAnalyses.length > 0) {
        const mealLines: string[] = [];
        for (const m of mealAnalyses) {
          try {
            const p = JSON.parse(m.result) as { calories?: number; protein?: number; carbs?: number; fat?: number; description?: string };
            const desc = typeof p.description === "string" ? p.description.replace(/\s+/g, " ").trim().slice(0, 140) : "";
            mealLines.push(
              `${new Date(m.createdAt).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}: ${desc || "غذای تحلیل‌شده"} — ${pdNum(p.calories)} کالری · پ ${pdNum(p.protein)} · ک ${pdNum(p.carbs)} · چ ${pdNum(p.fat)}`
            );
          } catch {
            // ردیف خراب — رد
          }
        }
        if (mealLines.length > 0) {
          parts.push(`[سیستم - تحلیل‌های عکس غذای کاربر (آخرین):\n${mealLines.join("\n")}]`);
        }
      }
    } catch (galErr) {
      console.warn("[program-generation] progress gallery summary failed (skipped):", galErr);
    }

    // ─── v155: پروندهٔ ورزشی «کامل» بودجه‌دار — پنجرهٔ توکن کاملاً باز ───
    // خواستهٔ مالک (v155): «حتی اگر کاربر یک سال یا دو سال داخل فیتاپ کار کرده
    // و پروندهٔ خیلی سنگینی داره، پنجرهٔ توکنش کاملاً باز باشه.»
    // ۳۰ روز روزبه‌روز / ماه ۲ تا ۱۲ جمع‌بندی ماهانه / قدیمی‌تر فصلی /
    // چکاپ‌ها (۳ مورد آخر + روند) + استریک پیوستگی — سقف ۹۰۰۰ کاراکتر.
    // پروفایل ثابت اینجا تکرار نمی‌شود (buildUserContext خودش تزریق می‌کند).
    try {
      const { buildSportsProfileContext, buildCompactProgressSummary } = await import(
        "@/lib/fitness/sports-profile-context"
      );
      let profileBlock = "";
      try {
        profileBlock = await buildSportsProfileContext(userId, {
          includeStaticProfile: false,
          // v215 — پنجرهٔ توکن بازتر (دیرکتیو مالک): ۹۰۰۰→۱۴۰۰۰ — هم‌قدِ سقف جدید پرونده؛
          // نگهبان سه‌لایه (shrinkPlanExtrasForPromptBudget) سرریز را همچنان غیرممکن می‌کند
          maxChars: 14000,
        });
      } catch (fullProfileErr) {
        console.error("[program-generation] full sports profile failed (compact fallback):", fullProfileErr);
      }
      if (!profileBlock) {
        profileBlock = await buildCompactProgressSummary(userId, { includeCheckups: false });
      }
      if (profileBlock) parts.push(profileBlock);
    } catch (compactErr) {
      console.error("[program-generation] sports profile/summary failed (skipped):", compactErr);
    }
    if (parts.length > 0) extras.renewalContext = parts.join("\n");
  } catch (e) {
    console.error("[program-generation] failed to build renewalContext:", e);
  }

  // ─── v149 — درخواست ساختاری بازطراحی از چت (تیکت مالک: «برنامه عیناً عین
  // درخواست ورزشکار نوشته بشه») ───
  // فقط رکورد اشتراکِ «حاضر» کاربر (active → pending → rescued — همان ترتیب
  // getPlanRegenState) خوانده می‌شود تا درخواستِ اشتراک قدیمی به چکاپ/تغییر وزن
  // نشت نکند. تازگی: حداکثر ۴۵ روز (یک دورهٔ برنامه). درخواست‌های غیرساختاری
  // (بدون چیدمان عددی) از این مسیر نمی‌آیند — همان مسیر nutritionNotes برقرار است.
  try {
    const regenState = await getPlanRegenState(userId);
    if (regenState.subscriptionId) {
      extras.redesignSubscriptionId = regenState.subscriptionId;
      const holder = await db.subscription.findUnique({
        where: { id: regenState.subscriptionId },
        select: { planRegenRequest: true },
      });
      const raw = holder?.planRegenRequest;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as {
            spec?: RequestedSplitSpec;
            raw?: string;
            at?: string;
            constraints?: unknown;
          };
          const ageOk =
            parsed.at &&
            Date.now() - new Date(parsed.at).getTime() <= 45 * 24 * 60 * 60 * 1000;
          if (ageOk) {
            // v149 — ممنوعیت‌ها مستقل از اسپک هم لنگر می‌شوند (درخواست «فقط حذف حرکات»)
            const storedConstraints = sanitizeConstraints(parsed.constraints);
            if (storedConstraints) extras.redesignConstraints = storedConstraints;
            if (parsed.spec && typeof parsed.spec === "object") {
              extras.redesignSpec = parsed.spec;
              extras.redesignRaw = typeof parsed.raw === "string" ? parsed.raw : undefined;
              extras.redesignDirective = buildRedesignDirectiveFa(
                parsed.spec,
                extras.redesignRaw,
                null
              );
              console.log(
                `[program-generation] v149 redesign split directive armed for user=${userId}`
              );
            } else if (storedConstraints) {
              extras.redesignRaw = typeof parsed.raw === "string" ? parsed.raw : undefined;
              console.log(
                `[program-generation] v149 exclusion-only redesign request armed for user=${userId}`
              );
            }
          }
        } catch (parseErr) {
          console.warn("[program-generation] v149 planRegenRequest parse failed:", parseErr);
        }
      }
    }
  } catch (e) {
    console.warn("[program-generation] v149 redesign request read failed (non-fatal):", e);
  }

  return extras;
}

export interface StartGenerationResult {
  started: boolean;
  reason?:
    | "no_profile"
    | "prerequisites_incomplete"
    | "already_generating"
    | "already_has_fresh_plan"
    | "no_plan"
    | "daily_budget";
  blockingReason?: string | null;
}

/**
 * شروع تولید برنامه در پس‌زمینه برای کاربر.
 *
 * پیش‌شرط‌ها:
 *  - اشتراک فعال یا pending (پلن مؤثر)
 *  - پروفایل آنبوردینگ موجود
 *  - همه پیش‌نیازها تعیین تکلیف شده باشند
 *  - هیچ تولید در حال اجرای تازه‌ای وجود نداشته باشد (جلوگیری از دوباره‌کاری)
 *
 * خروجی فوری برمی‌گرداند؛ تولید در پس‌زمینه ادامه می‌یابد.
 *
 * v73.2 — opts.source === "checkup": به‌روزرسانی برنامه پس از چکاپ دوره‌ای
 * (درخواست مالک: «با هر چکاپ اگر نیاز بود برنامه آپدیت شود و برنامهٔ جدید
 * جای قبلی بنشیند — بدون هیچ تغییری در پلن و زمان اشتراک»). در این حالت
 * گارد «already_has_fresh_plan» دور زده می‌شود (چون برنامهٔ فعال وجود دارد
 * و دقیقاً باید جایگزین شود) ولی سقف روزانه و claim اتمیک برقرار می‌مانند.
 *
 * v75 — opts.source === "admin_rewrite": بازنویسی صریح برنامه توسط مدیر
 * (درخواست مالک: «مدیر باید بتونه برنامه یک کاربر رو بازنویسی بکنه بدون تغییر
 * در مدت اشتراک و تغییر پلن و بازنویسی باید مجدد همه مسائل آخرین پرونده ورزشی
 * و آخرین عکس‌ها و ویدیوهای آپلودشده کاربر رو تحلیل کنه و بسازه»):
 *  ۱) گارد برنامهٔ تازه و سقف روزانه دور زده می‌شود (ادمین عمداً بازتولید می‌خواهد)
 *  ۲) activatePendingSubscription اجرا نمی‌شود (هیچ تغییری در اشتراک/پلن)
 *  ۳) extras کامل (پرونده ورزشی + آخرین عکس/ویدیو/آزمایش) مثل تولید عادی تازه خوانده می‌شود
 *
 * v77 — opts.source === "chat_request": بازتولید از چت با فیتاپ (تیکت‌های
 * «برنامه غذایی درست نیست / در چت گفتید برنامه عوض میشه ولی نشد»). تشخیص نیت
 * در plan-change-intent.ts انجام می‌شود؛ اینجا فقط سیاست‌ها:
 *  ۱) گارد برنامهٔ تازه دور زده می‌شود (کاربر عمداً برنامهٔ فعلی را می‌خواهد عوض کند)
 *  ۲) سقف روزانهٔ ۵ بار برقرار می‌ماند (جلوگیری از سوختن اعتبار AI با اسپم چت)
 *  ۳) activatePendingSubscription اجرا نمی‌شود (بازتولید هیچ تغییری در اشتراک نمی‌دهد)
 *
 * v78 — (درخواست مالک: «این بازطراحی نیاز به پیش‌نیازها نداره و با دیتای فعلی
 * کاربر ساخته بشه و تاثیری در مدت اشتراک و تغییر پلن نداره») برای
 * source === "chat_request" گیت پیش‌نیازها (checkPrerequisites) هم به‌طور کامل
 * دور زده می‌شود — بازطراحی با همان دیتای فعلی پروفایل ساخته می‌شود. سقف
 * روزانهٔ ۵/۲۴ساعت به‌عنوان گارد نهایی برقرار می‌ماند (فراخوانِ chat_request
 * خودش نرخ تایید نهایی کاربر را کنترل می‌کند). هیچ تغییری در اشتراک/پلن.
 */
export async function startProgramGenerationInBackground(
  userId: string,
  opts?: {
    source?: "checkup" | "admin_rewrite" | "chat_request" | "weight_update" | "renewal_update";
    /** v111 — خلاصهٔ تغییرات این نسخه (مثلاً متن درخواست کاربر در چت) — اختیاری و سازگار با عقب */
    changeSummary?: string | null;
    /** v134 — kick ادمین (PATCH status=generating): claim ردیفی که همین الان
     *  توسط خودِ PATCH generating شده مجاز است — وگرنه claim اتمیک v45 آن را
     *  «تولید در جریان» می‌پنداشت و دکمهٔ ادمین هرگز تولید را شروع نمی‌کرد
     *  (پیدا‌شده در ممیزی جامع v134). فقط مسیر ادمین این را پاس می‌دهد. */
    forceClaim?: boolean;
    /** v150 — دستور اصولی مدیر (باکس «به‌روزرسانی برنامه» — دیرکتیو مالک:
     *  «مدیر درخواستشو بنویسه که طبق چه اصولی برنامه به روز رسانی بشه و دقیقاً طبق
     *  همون اصول به روز رسانی بشه؛ اگر چیزی نوشته نشد همون کارکرد قبلی انجام بشه»)
     *  به‌صورت دیرکتیو در بالاترین نقطهٔ پرامپت تمرین + تغذیه تزریق می‌شود. */
    adminInstructions?: string | null;
  }
): Promise<StartGenerationResult> {
  const source = opts?.source ?? null;
  // پلن مؤثر (active یا pending داخل پنجره)
  const dto = await buildUserDto(userId);
  const effectivePlan = (dto?.planName ?? null) as Plan | null;
  if (!effectivePlan) {
    return { started: false, reason: "no_plan" };
  }

  const profile = await db.onboardingProfile.findUnique({ where: { userId } });
  if (!profile) {
    return { started: false, reason: "no_profile" };
  }

  // پیش‌نیازها باید تعیین تکلیف شده باشند
  // v78 — درخواست مالک: بازطراحی از چت (chat_request) «نیاز به پیش‌نیازها ندارد
  // و با دیتای فعلی کاربر ساخته می‌شود» → گیت پیش‌نیازها برای این منبع کلاً bypass.
  // v214 — (دیرکتیو مالک: ممیزی تزریق کانتکست AI) بازنویسی ادمین (admin_rewrite)
  // هم با «دیتای فعلی کاربر» ساخته می‌شود — مدیر آگاهانه اقدام می‌کند و نباید
  // بازنویسی برنامهٔ کاربر advanced/ultimate بدون عکسِ چرخهٔ جدید رد شود.
  if (source !== "chat_request" && source !== "admin_rewrite") {
    const prereqCheck = await checkPrerequisites(userId, effectivePlan);
    if (!prereqCheck.canGenerateProgram) {
      return { started: false, reason: "prerequisites_incomplete", blockingReason: prereqCheck.blockingReason };
    }
  }

  // ─── 🩹 v45 (باگ بحرانی مالک + نشتی اعتبار AI) — دو گارد سخت ───
  // ① سقف روزانه: حداکثر ۵ شروع تولید در ۲۴ ساعت برای هر کاربر — هر منبعی
  // (پرداخت، تحلیل ویدیو/خون، watchdog، سوئیپ، ادمین) از این سقف عبور
  // نمی‌کند؛ حلقه‌های بی‌پایان دیگر نمی‌توانند اعتبار AI را بسوزانند.
  // ② گارد برنامهٔ تازه: اگر آخرین درخواست ready است و برنامهٔ فعالِ
  // ساخته‌شده بعد از آن وجود دارد، تولید دوباره بی‌معنی است (قبلاً reason
  // «already_has_fresh_plan» در interface بود ولی هرگز برگردانده نمی‌شد و
  // همین حلقهٔ «هر ۳۰ دقیقه نوتیف برنامهٔ شما آماده شد» را ساخته بود).
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dayAgo = new Date(Date.now() - DAY_MS);
  // v75 — بازنویسی ادمین از سقف روزانه عبور می‌کند (عمدی و یک‌بار توسط انسان)
  if (source !== "admin_rewrite") {
    const recentStarts = await db.programRequest.count({
      where: { userId, createdAt: { gte: dayAgo } },
    });
    if (recentStarts >= 5) {
      console.warn(
        `[program-generation] daily budget exhausted for ${userId} (${recentStarts} starts/24h) — refusing`
      );
      return { started: false, reason: "daily_budget" };
    }
  }

  // جلوگیری از تولید همزمان: اگر آخرین درخواست «generating» و تازه است، دوباره شروع نکن
  // (پنجره ۲۰ دقیقه‌ای هم‌راستا با بازیابی درخواست‌های گیرکرده — M3)
  const latestReq = await db.programRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const stuckWindowAgo = new Date(Date.now() - STUCK_GENERATION_WINDOW_MS);

  // 🩹 v45 — گارد برنامهٔ تازه (بخش ②): آخرین درخواست ready + برنامهٔ فعال
  // بعد از آن = کاربر برنامه را دارد؛ تولید مجدد فقط هزینهٔ AI + نوتیف تکراری
  // v75 — برای بازنویسی ادمین این گارد دقیقاً باید دور زده شود (برنامهٔ موجود
  // فعال است و هدف، جایگزینی آن است)
  // v81 — فیکس ریشه‌ای حلقهٔ «۷-۸ بار برنامهٔ جدید» (گزارش کاربر امیر ناصری مقدم):
  // قبلاً شرط «برنامه بعد از آخرین درخواست ساخته شده» با gte: latestReq.updatedAt
  // هرگز برقرار نمی‌شد چون برنامه چند ثانیه «قبل» از updateِ ready ذخیره می‌شود
  // (ترتیب: savePlan → update status=ready) → گارد همیشه رد می‌شد و هر فراخوانی
  // video-status/blood-test-status/submit-body-analysis/PUT ناسازگار وزن، یک
  // چرخهٔ کامل AI تازه می‌ساخت. حالا پنجرهٔ ۱۵ دقیقه‌ایِ سازگاری دارد (برنامه‌ای
  // که کمی قبل از ready شدن درخواست ساخته شده هم «برنامهٔ همین درخواست» است).
  if (
    latestReq &&
    latestReq.status === "ready" &&
    source !== "checkup" &&
    source !== "admin_rewrite" &&
    source !== "chat_request"
  ) {
    const freshPlanWindowAgo = new Date(latestReq.updatedAt.getTime() - 15 * 60 * 1000);
    const freshPlan = await db.workoutPlan.findFirst({
      where: {
        userId,
        active: true,
        createdAt: { gte: freshPlanWindowAgo },
      },
      select: { id: true },
    });
    if (freshPlan) {
      return { started: false, reason: "already_has_fresh_plan" };
    }
  }
  // v73.2 — منبع checkup: برنامهٔ فعالِ تازه دقیقاً همان چیزی است که باید
  // با نتیجهٔ چکاپ جایگزین شود → گارد بالا فقط برای منابع دیگر برقرار است.

  // ─── Claim اتمیک (رفع TOCTOU) ───
  // قبلاً «خواندن وضعیت» و «نوشتن generating» دو مرحله جدا بودند؛ دو فراخوانی
  // همزمان (مثلاً verify + submit-body-analysis) هر دو از چک رد می‌شدند و
  // تولیدِ دوباره AI (هزینه دوبرابر + برنامه تکراری) شروع می‌شد.
  // حالا خودِ به‌روزرسانی شرطی است: فقط اگر درخواست در حال generatingِ تازه
  // نباشد، وضعیت به «generating» claim می‌شود — یک برنده، بقیه متوقف.
  let reqId: string;
  if (latestReq) {
    const claimed = await db.programRequest.updateMany({
      where: opts?.forceClaim
        ? { id: latestReq.id }
        : {
            id: latestReq.id,
            OR: [
              { status: { not: "generating" } },
              { updatedAt: { lte: stuckWindowAgo } }, // generatingِ گیرکرده → قابل claim مجدد
            ],
          },
      data: {
        status: "generating",
        // v38: شمارش تلاش + مهر زمانی — برای سوئیپ خودکار و نمایش به ادمین
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      return { started: false, reason: "already_generating" };
    }
    reqId = latestReq.id;
  } else {
    // اولین درخواست — create می‌کند، سپس برای امنیت دوباره چک می‌کنیم که
    // فراخوانی همزمان دیگری در همان لحظه درخواست دیگری نساخته باشد.
    const created = await db.programRequest.create({
      data: {
        userId,
        plan: effectivePlan,
        billingPeriod: "monthly",
        status: "generating",
        attempts: 1,
        lastAttemptAt: new Date(),
      },
    });
    const concurrent = await db.programRequest.findFirst({
      where: {
        userId,
        status: "generating",
        id: { not: created.id },
        updatedAt: { gt: stuckWindowAgo },
      },
      orderBy: { createdAt: "asc" },
    });
    if (concurrent) {
      // این درخواستِ دومِ همزمان است → تولیدِ تکراری را لغو کن
      await db.programRequest.update({
        where: { id: created.id },
        data: { status: "failed" },
      }).catch(() => {});
      return { started: false, reason: "already_generating" };
    }
    reqId = created.id;
  }

  // فعال‌سازی اشتراک pending — دوره ۴۵ روزه از همین لحظه شروع می‌شود،
  // مستقل از موفقیت AI (entitlement کاربر از دست نمی‌رود)
  // v75 — بازنویسی ادمین: هیچ تغییری در اشتراک/پلن مجاز نیست → فعال‌سازی skip
  // v77 — بازتولید چت هم هیچ تغییری در اشتراک/پلن نمی‌دهد → فعال‌سازی skip
  // v81 — دیرکتیو مالک: بازتولید ناشی از «تغییر وزن» هم هیچ تغییری در اشتراک
  // (فعال‌سازی pending، شروع مجدد دورهٔ ۴۵ روزه) و پلن مجاز نیست → skip
  if (source !== "admin_rewrite" && source !== "chat_request" && source !== "weight_update") {
    try {
      const activated = await activatePendingSubscription(userId);
      if (activated) {
        console.log("[program-generation] pending subscription activated:", activated.id);
      }
    } catch (e) {
      console.error("[program-generation] failed to activate pending subscription:", e);
    }
  }

  // ─── تولید در پس‌زمینه (fire-and-forget) — v38 تاب‌آور ───
  // reqId از بلوک بالا (update/create) می‌آید — هرگز null نیست
  void (async () => {
    const startedAt = Date.now();
    let lastErrMsg = "";
    // ─── 🩹 v167 — heartbeat چرخهٔ زنده (فیکس ریشه‌ای «دو نسخه برای یک تولید») ───
    // دیرکتیو مالک: «در تولید هر برنامه هر تعداد تلاشی که انجام شد فقط نسخهٔ نهایی
    // و کامل قرار بگیره».
    // ریشهٔ باگ: watchdog/sweep درخواست‌های generating با updatedAt قدیمی‌تر از
    // ۲۰ دقیقه را «گیرکرده» پنداشته و چرخهٔ تولید دوباره شروع می‌کند — در حالی‌که
    // تغذیه با retry تا ~۴۵ دقیقه هم می‌تواند طول بکشد (v145). نتیجه: چرخهٔ اول
    // که دیرتر تمام می‌شد «نسخهٔ ۱» و چرخهٔ دوم «نسخهٔ ۲» می‌ساخت و هر دو در
    // تب برنامه‌ها دیده می‌شدند. راه‌حل: چرخهٔ زنده هر ۴۵ ثانیه ردیف درخواست را
    // touch می‌کند تا updatedAt تازه بماند و watchdog هرگز چرخهٔ «زنده» را
    // دوباره claim نکند (ردیف مرده همان‌طور که قبلاً بعد از ۲۰ دقیقه پیدا می‌شود).
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    if (reqId) {
      heartbeatTimer = setInterval(() => {
        db.programRequest
          .update({ where: { id: reqId }, data: { updatedAt: new Date() } })
          .catch(() => {}); // خطای گذرا → تیک بعدی دوباره تلاش می‌کند
      }, 45_000);
      // هیچ‌وقت نباید پروسه را زنده نگه دارد (fire-and-forget تمام‌شده بتواند ببندد)
      if (typeof heartbeatTimer === "object" && heartbeatTimer && "unref" in heartbeatTimer) {
        (heartbeatTimer as unknown as { unref: () => void }).unref();
      }
    }
    try {
      // ─── 🩹 v167 — پاک‌سازی یتیم‌های ناقص چرخه‌های قبل (قبل از هر ذخیره‌سازی) ───
      // اگر چرخهٔ قبلی وسط کار مرده باشد (تمرین ذخیره شده، تغذیه نه یا برعکس)،
      // ردیف ناقصش همین‌جا حذف می‌شود تا هرگز به‌عنوان «نسخه» در تب برنامه‌ها
      // دیده نشود. فقط ردیف‌های «غیرفعالِ» بدون جفتِ هم‌دوره حذف می‌شوند —
      // برنامهٔ فعال و تاریخچهٔ کامل دوره‌های قبلی دست‌نخورده می‌ماند.
      await cleanupOrphanPlanRows(userId, { before: new Date(Date.now() - 5_000) });

      const [planData, extras] = await Promise.all([
        buildOnboardingData(userId),
        buildGenerationExtras(userId),
      ]);
      if (!planData) throw new Error("پروفایل آنبوردینگ یافت نشد");

      // ─── v149 — دیرکتیو بازطراحی چت + خلاصهٔ توافق‌شده (تیکت مالک: برنامه عیناً
      // عین درخواست ورزشکار ساخته شود) — در buildGenerationExtras دیرکتیو بدون
      // خلاصهٔ changeSummary ساخته شده (هنوز opts اینجا نیست)؛ مسیر چت آن را همین‌جا کامل می‌کند ───
      if (extras.redesignSpec && (opts?.changeSummary || source === "chat_request")) {
        extras.redesignDirective = buildRedesignDirectiveFa(
          extras.redesignSpec,
          extras.redesignRaw,
          opts?.changeSummary ?? null
        );
      }

      // ─── v150 — دستور اصولی مدیر (باکس «به‌روزرسانی برنامه») — بالاترین اولویت پرامپت ───
      // متن آزاد مدیر نرمال‌سازی و سقف‌گذاری می‌شود (۴۰۰۰ نویسه — هم‌تراز سایر contextها)
      // و فقط وقتی چیزی نوشته شده باشد تزریق می‌شود (خالی = رفتار قبلی).
      const adminInstructionsRaw = (opts?.adminInstructions ?? "").trim();
      if (adminInstructionsRaw.length > 0) {
        extras.adminDirective =
          "⚠️⚠️ دستور صریح و الزامی مدیر فیتاپ — برنامه باید دقیقاً و عیناً طبق این اصول به‌روزرسانی شود؛\n" +
          "هر بندِ زیر بر تمام قواعد دیگر پرامپت مقدم است و هیچ بندی را نادیده نگیر (خلافش ممنوع):\n" +
          "―――――――――――――――\n" +
          capPromptText(adminInstructionsRaw, 4000) +
          "\n―――――――――――――――\n" +
          "پایان دستور مدیر — بعد از رعایت کامل بندهای بالا، بقیهٔ برنامه را حرفه‌ای و هماهنگ با همین اصول کامل کن و در نکات مربی یک خط «طبق دستور مدیر: …» با خلاصهٔ اعمال‌شده بنویس.";
      }

      // ─── v149 — ممنوعیت‌های صریح (تیکت باگ بزرگ بازطراحی): استخراج دو-لایه
      // (واژه‌نامهٔ قطعی + LLM) از متن درخواست کاربر/اصول مدیر، ادغام با ممنوعیت‌های
      // ذخیره‌شده، سپس دیرکتیو ⛔ در پرامپت + ممیزی قطعی پس‌تولیدی در ai.ts.
      // خروجی مدل هرگز بدون این ممیزی به کاربر نمی‌رسد. ───
      const constraintSources: Array<string | null | undefined> = [];
      if (source === "chat_request") {
        constraintSources.push(extras.redesignRaw, opts?.changeSummary);
      }
      if (adminInstructionsRaw.length > 0) {
        constraintSources.push(adminInstructionsRaw);
      }
      if (constraintSources.length > 0) {
        try {
          const lexicon = parseRedesignConstraintsFromText(...constraintSources);
          const llm = await extractRedesignConstraintsLLM(...constraintSources);
          const merged = mergeConstraints(lexicon, llm);
          if (merged) {
            extras.redesignConstraints = mergeConstraints(extras.redesignConstraints ?? null, merged) ?? undefined;
            console.log(
              `[program-generation] v149 redesign constraints armed (source=${source}): ` +
                `movements=[${extras.redesignConstraints?.forbiddenMovements.join("، ")}] ` +
                `foods=[${extras.redesignConstraints?.forbiddenFoods.join("، ")}] ` +
                `supplements=[${extras.redesignConstraints?.forbiddenSupplements.join("، ")}]`
            );
            // v157 — اصول مدیر (باکس به‌روزرسانی/بازنویسی) ممنوعیت‌هایش «ماندگار»
            // ثبت می‌شود: دستور پزشکی/ایمنی مدیر باید در همهٔ تولیدهای بعدیِ همین
            // کاربر هم اعمال شود (چکاپ، تغییر وزن، تمدید، بازطراحی چت) — نه فقط
            // همین یک تولید. فقط وقتی منبع، دستور مدیر است (درخواست کاربر خودش
            // در مسیر چت/تایید جداگانه ضبط شده — ادغام idempotent است).
            if (adminInstructionsRaw.length > 0) {
              await mergePersistentExclusions(userId, merged);
            }
          }
        } catch (e) {
          console.warn("[program-generation] v149 constraints extraction failed (non-fatal):", e);
        }
      }
      // ─── v157 — حفرهٔ ۲/۳: مسلح‌سازی «ماندگار» برای «همهٔ» منابع تولید ───
      // ممنوعیت‌های ثبت‌شدهٔ کاربر/مدیر (از چت، تایید کارت/تایپی، اصول مدیر)
      // در هر تولیدی — خرید، چکاپ، بازطراحی چت، بازنویسی مدیر، به‌روزرسانی وزن —
      // ادغام می‌شوند؛ قبلاً فقط chat_request داشت و بعد از یک تولیدِ موفق
      // حافظه پاک می‌شد و حرکات حذفی «برمی‌گشتند» (ریشهٔ اصلی تیکت مالک).
      // سقف/سن ندارد — آسیب منقضی‌شدنی نیست؛ فقط مدیر پاک می‌کند.
      try {
        const persistent = await readPersistentExclusions(userId);
        if (persistent) {
          const beforeMv = extras.redesignConstraints?.forbiddenMovements.length ?? 0;
          extras.redesignConstraints =
            mergeConstraints(extras.redesignConstraints ?? null, persistent) ?? undefined;
          const afterMv = extras.redesignConstraints?.forbiddenMovements.length ?? 0;
          if (afterMv > 0) {
            console.log(
              `[program-generation] v157 persistent exclusions armed (source=${source}, ` +
                `movements ${beforeMv}→${afterMv}): ` +
                `movements=[${extras.redesignConstraints?.forbiddenMovements.join("، ")}] ` +
                `foods=[${extras.redesignConstraints?.forbiddenFoods.join("، ")}] ` +
                `supplements=[${extras.redesignConstraints?.forbiddenSupplements.join("، ")}]`
            );
          }
        }
      } catch (e) {
        console.warn("[program-generation] v157 persistent exclusions read failed (non-fatal):", e);
      }
      if (extras.redesignConstraints) {
        if (!extras.redesignRaw && adminInstructionsRaw.length > 0) {
          extras.redesignRaw = adminInstructionsRaw.slice(0, 400);
        }
        const exclusionBlock = [
          buildMovementExclusionDirectiveFa(extras.redesignConstraints, extras.redesignRaw, opts?.changeSummary ?? null),
          buildFoodExclusionDirectiveFa(extras.redesignConstraints, extras.redesignRaw),
        ]
          .filter(Boolean)
          .join("\n\n");
        if (exclusionBlock) {
          extras.redesignDirective = extras.redesignDirective
            ? `${extras.redesignDirective}\n\n${exclusionBlock}`
            : exclusionBlock;
        }
      }

      // ─── v38: تمرین و غذا مستقل از هم تولید و ذخیره می‌شوند ───
      // قبلاً Promise.all بود: اگر غذایی موفق و تمرین ناموفق بود (یا برعکس)،
      // هر دو دور ریخته می‌شد و کاربر کاملاً بدون برنامه می‌ماند. حالا:
      // ① هر کدام موفق شد فوراً ذخیره می‌شود ② فقط سمتِ ناموفق یک‌بار دیگر
      // تلاش می‌شود ③ اگر یکی در نهایت موفق بود، کاربر حداقل آن را دارد و
      // سوئیپ خودکار فردای سمتِ جاافتاده را کامل می‌کند.
      // v76 — وزن مبنای این تولید؛ روی برنامه ذخیره می‌شود تا ناسازگاریِ
      // وزنِ برنامهٔ موجود با وزن فعلیِ پروفایل قابل تشخیص و هشدار باشد.
      const generationBaseWeight = planData.weight;
      // v111 — نسخه‌بندی + خلاصهٔ تغییرات (درخواست مالک: «نسخهٔ جدید برنامه
      // جای قبلی بنشیند، قبلی با تاریخ شروع/اصلاح در تب برنامه‌ها بماند و
      // برای برنامهٔ ساخته‌شده از چت، خلاصهٔ تغییرات در همان چت نوشته شود»)
      const changeSummaryText = buildChangeSummary(source, opts?.changeSummary);
      // اسنپ‌شات برنامه‌های ذخیره‌شدهٔ همین چرخه — برای پیام خلاصهٔ چت (v111)
      let savedWorkoutContent: Record<string, unknown> | null = null;
      let savedWorkoutVersion: number | null = null;
      let savedMealContent: Record<string, unknown> | null = null;
      // v112 — id ردیف تمرینی تازه‌ساخته‌شده برای اکوی سینک مکمل (غذا → تمرین)
      let savedWorkoutId: string | null = null;
      const saveWorkout = async (
        // v146 — سازندهٔ قابل‌جایگزینی: پیش‌فرض هوش مصنوعی؛ در فال‌بک نهایی، موتور محلی
        builder?: () => Promise<ProWorkoutPlanContent>,
        forcedSource?: string,
        forcedSummary?: string
      ) => {
        const workout = builder
          ? await builder()
          : await generateWorkoutPlan(planData, effectivePlan, extras);
        // v75 — اصلاح تایپوگرافی فارسی روی کل متن برنامه قبل از ذخیره
        // (کلمات چسبیده مثل «تمامقد» دیگر وارد DB نمی‌شوند)
        const fixed = fixPlanTypographyDeep(workout);
        // ممیزی 1-f#5 — چرخهٔ نسخهٔ برنامه داخل یک تراکنش اتمیک: قبلاً
        // غیرفعال‌سازی برنامهٔ قبلی (updateMany) و ساخت نسخهٔ جدید (create) دو
        // کوئری جدا بودند؛ کرش/تایم‌اوت بین این دو → کاربر بدون هیچ برنامهٔ
        // فعال (watchdog هم فقط ProgramRequest وضعیت generating را ترمیم می‌کند
        // و این شکاف را نمی‌بندد). حالا خواندن نسخهٔ قبلی + غیرفعال‌سازی + ساخت
        // + backfill supersededById همه با tx.* داخل $transaction اجرا می‌شوند.
        await db.$transaction(async (tx) => {
          // v111 — شمارهٔ نسخهٔ بعدی (ترتیب خود MealPlan/WorkoutPlan مستقل است)
          // و ردیف فعال قبلی (قبل از غیرفعال‌سازی) برای ثبت دقیق supersededById
          const [prevVersionRow, prevActiveRow] = await Promise.all([
            tx.workoutPlan.findFirst({ where: { userId }, orderBy: { version: "desc" }, select: { version: true } }),
            tx.workoutPlan.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" }, select: { id: true } }),
          ]);
          const nowDate = new Date();
          await tx.workoutPlan.updateMany({
            where: { userId },
            data: { active: false, supersededAt: nowDate },
          });
          const created = await tx.workoutPlan.create({
            data: {
              userId,
              content: JSON.stringify(fixed),
              active: true,
              baseWeight: generationBaseWeight ?? null,
              version: (prevVersionRow?.version ?? 0) + 1,
              generatedSource: (forcedSource ?? source ?? undefined) as string | undefined,
              changeSummary:
                forcedSummary ?? changeSummaryText ?? (prevVersionRow ? undefined : "برنامهٔ اولیه پس از خرید"),
            },
          });
          // v111 — ثبت دقیق «چه نسخه‌ای با چه نسخه‌ای جایگزین شد» (per-row)
          // (.catch حفظ شده — backfill بهترین‌تلاش است و نباید تراکنش را rollback کند)
          if (prevActiveRow && prevActiveRow.id !== created.id) {
            await tx.workoutPlan
              .update({ where: { id: prevActiveRow.id }, data: { supersededById: created.id } })
              .catch((e) => console.warn("[program-generation] supersededById (workout) backfill failed:", e));
          }
          savedWorkoutContent = fixed as unknown as Record<string, unknown>;
          savedWorkoutVersion = created.version;
          savedWorkoutId = created.id;
        });
      };
      const saveMeal = async (
        workoutContext?: string,
        // v146 — سازندهٔ قابل‌جایگزینی برای فال‌بک محلی تغذیه
        builder?: () => Promise<ProMealPlanContent>,
        forcedSource?: string,
        forcedSummary?: string
      ) => {
        // v112 — خلاصهٔ فشردهٔ برنامهٔ تمرینی تازه‌ساخته‌شده به پرامپت تغذیه تزریق
        // می‌شود تا وعده‌ها/کربوهیدرات/تایمینگ دقیقاً برای همین تمرین ساخته شود
        // (دیرکتیو مالک: «AI باید بداند برنامهٔ غذایی که داده برای همین تمرینه»). 
        const meal = builder
          ? await builder()
          : await generateMealPlan(planData, effectivePlan, { ...extras, workoutContext });
        // v75 — اصلاح تایپوگرافی فارسی روی کل متن برنامه قبل از ذخیره
        const fixed = fixPlanTypographyDeep(meal);
        // ممیزی 1-f#5 — همان تراکنش‌کردن چرخهٔ نسخه (بلوک MealPlan) — بدنهٔ
        // غیرفعال‌سازی/ساخت/backfill اتمیک شد تا کاربر بدون برنامهٔ فعال نماند.
        await db.$transaction(async (tx) => {
          const [prevVersionRow, prevActiveRow] = await Promise.all([
            tx.mealPlan.findFirst({ where: { userId }, orderBy: { version: "desc" }, select: { version: true } }),
            tx.mealPlan.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" }, select: { id: true } }),
          ]);
          const nowDate = new Date();
          await tx.mealPlan.updateMany({
            where: { userId },
            data: { active: false, supersededAt: nowDate },
          });
          const created = await tx.mealPlan.create({
            data: {
              userId,
              content: JSON.stringify(fixed),
              totalCal: meal.totalCalories,
              active: true,
              baseWeight: generationBaseWeight ?? null,
              version: (prevVersionRow?.version ?? 0) + 1,
              generatedSource: (forcedSource ?? source ?? undefined) as string | undefined,
              changeSummary:
                forcedSummary ?? changeSummaryText ?? (prevVersionRow ? undefined : "برنامهٔ اولیه پس از خرید"),
            },
          });
          if (prevActiveRow && prevActiveRow.id !== created.id) {
            await tx.mealPlan
              .update({ where: { id: prevActiveRow.id }, data: { supersededById: created.id } })
              .catch((e) => console.warn("[program-generation] supersededById (meal) backfill failed:", e));
          }
          savedMealContent = fixed as unknown as Record<string, unknown>;
        });
      };

      // ─── v112 — اکوی سینک مکمل (غذا → تمرین) ───
      // استک مکملِ تجویزشدهٔ متخصص تغذیه (supplementStack/supplements برنامهٔ غذایی)
      // عیناً روی برنامهٔ تمرینی می‌نشیند: فیلد supplements بازنویسی و
      // supplementTimingNotes از تایمینگ واقعی همان استک ساخته می‌شود — تا
      // «تایمینگ مکمل» برنامهٔ تمرینی هرگز با تجویز تغذیه تناقض نداشته باشد.
      // بهترین‌تلاش: هر خطایی فقط warn می‌شود و هرگز چرخهٔ تولید را نمی‌شکند.
      const echoSupplementsToWorkout = async () => {
        if (!savedWorkoutId || !savedMealContent) return;
        try {
          const meal = savedMealContent as {
            supplementStack?: Array<{ name?: string; dose?: string; timing?: string; note?: string }>;
            supplements?: Array<{ name?: string; dose?: string; timing?: string; note?: string }>;
          };
          const rawStack = Array.isArray(meal.supplementStack) && meal.supplementStack.length
            ? meal.supplementStack
            : Array.isArray(meal.supplements)
              ? meal.supplements
              : [];
          const flat = rawStack
            .filter((s) => s && typeof s.name === "string" && s.name.trim())
            .map((s) => ({
              name: String(s.name).trim(),
              dose: s.dose ? String(s.dose).trim() : "",
              timing: s.timing ? String(s.timing).trim() : "",
              note: s.note ? String(s.note).trim() : undefined,
            }));
          if (flat.length === 0) return;
          const workoutRow = await db.workoutPlan.findUnique({
            where: { id: savedWorkoutId },
            select: { content: true },
          });
          if (!workoutRow) return;
          const w = JSON.parse(workoutRow.content) as Record<string, unknown>;
          w.supplements = flat;
          w.supplementTimingNotes = flat.map((s) => `${s.name}${s.timing ? `: ${s.timing}` : ""}`);
          // v133 — آبجکت in-memory هم همگام می‌شود (نه تعویض reference): گیت کیفیت
          // (runPlanQualityGate) با همان reference کار می‌کند و اگر بعداً content را
          // کامل بازنویسی کند، اکوی مکمل از بین نمی‌رود.
          if (savedWorkoutContent) {
            (savedWorkoutContent as Record<string, unknown>).supplements = flat;
            (savedWorkoutContent as Record<string, unknown>).supplementTimingNotes = w.supplementTimingNotes;
          }
          await db.workoutPlan.update({
            where: { id: savedWorkoutId },
            data: { content: JSON.stringify(w) },
          });
          console.log(`[program-generation] v112 supplement echo: ${flat.length} item(s) synced meal→workout`);
        } catch (e) {
          console.warn("[program-generation] supplement echo failed (non-fatal):", e);
        }
      };

      // ─── v112 — سینک کامل تمرین/تغذیه/مکمل (دیرکتیو مالک: «برنامهٔ تمرین و تغذیه
      // و مکمل باید با همدیگه کامل سینک تولید شن») — ترتیب قطعی جایگزین
      // Promise.allSettled موازی قبلی شد:
      // ① اول تمرین ساخته می‌شود ② خلاصهٔ فشردهٔ تمرین به پرامپت تغذیه تزریق می‌شود
      // (روزها/تمرکز/شدت/پریودایزیشن/اهداف هفته‌ها) ③ بعد از موفقیت هر دو، استک
      // مکملِ برنامهٔ غذایی عیناً روی برنامهٔ تمرینی برگشت داده می‌شود تا هیچ
      // تناقضی بین سه برنامه باقی نماند.
      // سیاست تاب‌آوری v38 حفظ شده: هر سمت مستقل ذخیره می‌شود و سمتِ ناموفق یک
      // راند دیگر تلاش می‌کند؛ اگر تمرین شکست بخورد تغذیه بدون هم‌زمینه ساخته می‌شود.
      const attemptWorkout = async (label: string): Promise<boolean> => {
        try {
          await saveWorkout();
          return true;
        } catch (e) {
          lastErrMsg = `تمرین: ${String((e as Error)?.message || e).slice(0, 250)}`;
          console.error(`[program-generation] workout side failed (${label}):`, e);
          return false;
        }
      };
      const attemptMeal = async (label: string): Promise<boolean> => {
        try {
          const ctx = savedWorkoutContent ? buildWorkoutSyncContext(savedWorkoutContent) : null;
          await saveMeal(ctx ?? undefined);
          return true;
        } catch (e) {
          lastErrMsg = `${lastErrMsg ? lastErrMsg + " | " : ""}غذا: ${String((e as Error)?.message || e).slice(0, 250)}`;
          console.error(`[program-generation] meal side failed (${label}):`, e);
          return false;
        }
      };

      // ─── v146 — قانون مطلق مالک: «به هیچ وجه نباید برنامهٔ ناموفق داشته باشیم» ───
      // هر سمت ۳ تلاش هوش مصنوعی با فاصلهٔ تصاعدی (۰s / ۸s / ۲۰s) می‌گیرد؛
      // و اگر «همهٔ» تلاش‌های AI شکست بخورد (قطعی AvalAI، خطای شبکه، مرگ مدل و ...)،
      // موتور محلی اضطراری (local-plan-fallback) برنامهٔ کامل علمی را می‌سازد —
      // بنابراین این چرخه «هرگز» بدون ذخیرهٔ برنامه تمام نمی‌شود.
      const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const AI_ATTEMPT_DELAYS_MS = [0, 8_000, 20_000];

      // راند ۱ تا ۳ تمرین — قبل از تغذیه (تا تغذیه هرجا ممکن شد هم‌زمینه داشته باشد)
      let workoutOk = false;
      for (let i = 0; i < AI_ATTEMPT_DELAYS_MS.length && !workoutOk; i++) {
        if (AI_ATTEMPT_DELAYS_MS[i] > 0) await waitMs(AI_ATTEMPT_DELAYS_MS[i]);
        workoutOk = await attemptWorkout(`attempt ${i + 1}`);
      }

      // ─── v149 — مصرف درخواست چیدمان (تیکت مالک: «عیناً عین درخواست») ───
      // چیدمان درخواستی حالا در برنامهٔ ذخیره‌شده لنگر انداخته؛ فیلد پاک می‌شود
      // تا در تولیدهای بعدی (چکاپ/تغییر وزن/ادمین) نشت نکند. اگر تمرین شکست
      // بخورد و چرخه بعدی (سوئیپ/retry) دوباره بیاید، درخواست سر جایش است.
      if (workoutOk && extras.redesignSubscriptionId) {
        await db.subscription
          .update({
            where: { id: extras.redesignSubscriptionId },
            data: { planRegenRequest: null },
          })
          .then(() =>
            console.log(
              `[program-generation] v149 planRegenRequest consumed (cleared) after successful workout save (user=${userId})`
            )
          )
          .catch((e) =>
            console.warn("[program-generation] v149 planRegenRequest cleanup failed (non-fatal):", e)
          );
      }
      let workoutFallbackUsed = false;
      if (!workoutOk) {
        // تضمین never-fail — موتور محلی جایگزین هوش مصنوعی
        try {
          await saveWorkout(
            // v149 — فال‌بک محلی هم با درخواست چیدمان کاربر هم‌راستا می‌شود
            // (تیکت مالک: برنامه عیناً عین درخواست ورزشکار — حتی در فال‌بک اضطراری)
            async () => {
              const fallbackPlan = await buildLocalFallbackWorkoutPlan(planData, effectivePlan);
              // v152 — فال‌بک محلی هم از ممنوعیت‌ها عبور می‌کند (قانون آهنین: حتی موتور
              // اضطراری نباید حرکت ممنوع برگرداند — تیکت مالک)
              if (extras.redesignConstraints) {
                try {
                  const [rows, ytRow] = await Promise.all([
                    db.exerciseLibrary.findMany({
                      where: { isActive: true },
                      select: {
                        id: true, name: true, muscle: true, category: true, equipment: true,
                        description: true, tips: true,
                        videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true,
                      },
                    }),
                    db.siteSetting.findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } }),
                  ]);
                  const bank = buildLockedBank(rows as BankExerciseRow[], globalYoutubeEnabledFromValue(ytRow?.value));
                  const exReport = enforceWorkoutExclusions(fallbackPlan as any, extras.redesignConstraints, bank);
                  console.warn(
                    `[program-generation] v152 exclusion enforce on local fallback workout: removed=${exReport.removed.length} leftover=${exReport.leftover.length}`
                  );
                } catch (exErr) {
                  console.warn("[program-generation] v152 exclusion enforce on fallback failed (non-fatal):", exErr);
                }
              }
              if (extras.redesignSpec) {
                try {
                  const [rows, ytRow] = await Promise.all([
                    db.exerciseLibrary.findMany({
                      where: { isActive: true },
                      select: {
                        id: true, name: true, muscle: true, category: true, equipment: true,
                        description: true, tips: true,
                        videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true,
                      },
                    }),
                    db.siteSetting.findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } }),
                  ]);
                  const bank = buildLockedBank(rows as BankExerciseRow[], globalYoutubeEnabledFromValue(ytRow?.value));
                  const splitReport = repairPlanDaySplitToRequest(fallbackPlan as any, extras.redesignSpec, bank);
                  console.warn(
                    `[program-generation] v149 split repair on local fallback: converted=${splitReport.converted.length}`
                  );
                } catch (splitErr) {
                  console.warn("[program-generation] v149 split repair on fallback failed (non-fatal):", splitErr);
                }
              }
              return fallbackPlan;
            },
            "local_fallback",
            "برنامهٔ موتور محلی فیتاپ (جایگزین اضطراری هوش مصنوعی)"
          );
          workoutOk = true;
          workoutFallbackUsed = true;
          console.warn(`[program-generation] v146 workout saved via LOCAL FALLBACK engine (user=${userId})`);
        } catch (fbErr) {
          lastErrMsg = `${lastErrMsg ? lastErrMsg + " | " : ""}فال‌بک محلی تمرین: ${String((fbErr as Error)?.message || fbErr).slice(0, 200)}`;
          console.error("[program-generation] local fallback workout failed:", fbErr);
        }
      }

      // راند ۱ تا ۳ تغذیه
      let mealOk = false;
      for (let i = 0; i < AI_ATTEMPT_DELAYS_MS.length && !mealOk; i++) {
        if (AI_ATTEMPT_DELAYS_MS[i] > 0) await waitMs(AI_ATTEMPT_DELAYS_MS[i]);
        mealOk = await attemptMeal(`attempt ${i + 1}`);
      }
      let mealFallbackUsed = false;
      if (!mealOk) {
        // تضمین never-fail — برنامهٔ غذایی موتور محلی
        try {
          const ctx = savedWorkoutContent ? buildWorkoutSyncContext(savedWorkoutContent) : null;
          await saveMeal(
            ctx ?? undefined,
            async () => {
              const fbPlan = await buildLocalFallbackMealPlan(planData, effectivePlan);
              // v152 — فال‌بک محلی غذا هم ممنوعیت‌های غذا/مکمل را رعایت می‌کند
              if (extras.redesignConstraints) {
                try {
                  const fbReport = enforceMealExclusions(fbPlan as any, extras.redesignConstraints);
                  console.warn(
                    `[program-generation] v152 exclusion enforce on local fallback meal: removed=${fbReport.removed.length}`
                  );
                } catch (exErr) {
                  console.warn("[program-generation] v152 exclusion enforce on fallback meal failed (non-fatal):", exErr);
                }
              }
              return fbPlan;
            },
            "local_fallback",
            "برنامهٔ موتور محلی فیتاپ (جایگزین اضطراری هوش مصنوعی)"
          );
          mealOk = true;
          mealFallbackUsed = true;
          console.warn(`[program-generation] v146 meal saved via LOCAL FALLBACK engine (user=${userId})`);
        } catch (fbErr) {
          lastErrMsg = `${lastErrMsg ? lastErrMsg + " | " : ""}فال‌بک محلی غذا: ${String((fbErr as Error)?.message || fbErr).slice(0, 200)}`;
          console.error("[program-generation] local fallback meal failed:", fbErr);
        }
      }

      // ③ اکوی مکمل — فقط وقتی هر دو سمت در نهایت موفق بودند
      if (workoutOk && mealOk) {
        await echoSupplementsToWorkout();
        // ─── v133 — گیت کیفیت چندلایه (دیرکتیو مالک: بساز → چک → دیباگ → تست →
        // اثبات → تحویل) — قبل از علامت‌گذاری ready تا کاربر فقط برنامهٔ
        // کنترل‌ کیفی‌شده ببیند. هرگز شکست تولید را نمی‌سازد. ───
        await runPlanQualityGate({
          userId,
          data: planData,
          planName: effectivePlan,
          workout: savedWorkoutContent,
          meal: savedMealContent,
          updateWorkoutRow: async (content) => {
            if (!savedWorkoutId) return;
            await db.workoutPlan.update({
              where: { id: savedWorkoutId },
              data: { content: JSON.stringify(content) },
            });
          },
          updateMealRow: async (content) => {
            const row = await db.mealPlan.findFirst({
              where: { userId, active: true },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            if (!row) return;
            await db.mealPlan.update({
              where: { id: row.id },
              data: { content: JSON.stringify(content) },
            });
          },
          reEchoSupplements: echoSupplementsToWorkout,
        });
      }

      if (workoutOk && mealOk) {
        // ─── 🩹 v167 — پاک‌سازی پایانی یتیم‌ها (قبل از اعلام ready) ───
        // چرخه با موفقیت «یک جفت کامل» (تمرین + تغذیه + مکمل سینک‌شده) ساخت؛
        // حالا هر ردیف ناقصِ بدون جفت از چرخه‌های قبلی حذف می‌شود تا قانون
        // مالک برقرار بماند: «هر تعداد تلاش → فقط نسخهٔ نهایی و کامل».
        // ردیف‌های فعال (همین جفت تازه) و جفت‌های کامل تاریخچه دست‌نخورده‌اند.
        await cleanupOrphanPlanRows(userId);

        if (reqId) {
          await db.programRequest.update({
            where: { id: reqId },
            data: { status: "ready", lastError: null },
          });
          // v172 — رویداد زندهٔ پنل: تب برنامه‌ها/داشبورد در لحظه رفرش می‌شود
          publishPanelEvent(userId, "plan_ready", {
            requestId: reqId,
            source,
            section: "programs",
          });
        }
        // 🩹 v45 (باگ بحرانی مالک): نوتیف «برنامهٔ شما آماده شد» حداکثر یک‌بار
        // در ۲۴ ساعت — تولیدکننده‌های مختلف (پرداخت، سوئیپ، watchdog، ادمین)
        // هرکدام مستقیم نوتیف می‌ساختند و هیچ dedupe مشترکی وجود نداشت؛
        // همین پیام هر ۳۰ دقیقه برای مالک تکرار شد.
        const DAY_MS = 24 * 60 * 60 * 1000;
        // v73.2 — متن نوتیف بسته به منبع تولید: به‌روزرسانی چکاپ پیام خودش را دارد
        const readyTitle = source === "checkup" ? "برنامه‌های شما به‌روزرسانی شد! ✨" : "برنامه شما آماده شد! 🎯";
        const recentReadyNotif = await db.notification.findFirst({
          where: {
            userId,
            type: "achievement",
            title: readyTitle,
            createdAt: { gte: new Date(Date.now() - DAY_MS) },
          },
          select: { id: true },
        });
        if (!recentReadyNotif) {
          // 🩹 v168 — متن نوتیف پلن-آگاه: کاربر اقتصادی «مکمل» ندارد (قانون مالک:
          // مکمل فقط استاندارد به بالا) — ذکر مکمل برای او گمراه‌کننده است.
          const planHasSupplements =
            planIncludesSupplement(effectivePlan);
          const programListFa = planHasSupplements
            ? "برنامه‌های تمرینی، تغذیه و مکمل"
            : "برنامه‌های تمرینی و تغذیه";
          await createNotification(
            userId,
            "achievement",
            readyTitle,
            source === "checkup"
              ? // v142 — متن نوتیف هر سه برنامهٔ شامل پلن (تمرین + تغذیه + مکمل در صورت شمول) را ذکر می‌کند
                `بر اساس آخرین چکاپ، فیتاپ هوشمند ${programListFa} شما را به‌روزرسانی کرد — برنامهٔ جدید در جای برنامهٔ قبلی نشسته و تغییری در پلن و زمان اشتراک شما ایجاد نشده است. از بخش‌های «تمرینات»، «تغذیه»${planHasSupplements ? " و «مکمل»" : ""} ببینید.`
              : `${programListFa} شخصی‌سازی‌شدهٔ شما توسط فیتاپ هوشمند ساخته شد. از بخش‌های «تمرینات»، «تغذیه»${planHasSupplements ? " و «مکمل»" : ""} مشاهده کنید.`,
            "?tab=programs"
          );
        }
        // v32: پیامک همزمان «برنامه آماده شد» (قالب 663678)
        // v66: دداپ بر چرخهٔ تولید (reqId) — هر برنامهٔ جدید یک پیامک
        notifyProgramReadySms(userId, reqId ?? undefined);
        // ─── v111 — پیام خلاصهٔ برنامهٔ جدید در چت فیتاپ (دیرکتیو مالک) ───
        // «چت با فیتاپ بعد از تایید کاربر برنامهٔ جدید را می‌نویسد (خلاصه) در
        // همان چت». فقط برای source=chat_request (تغییر برنامه از چت) —
        // درج مستقیم در DB (مثل بقیهٔ پیام‌های سیستمی/assistant؛ هیچ کال AI
        // اضافه‌ای trigger نمی‌شود) و هرگز شکستش تولید برنامه را نمی‌شکند.
        if (source === "chat_request") {
          await postChatPlanSummaryMessage(
            userId,
            savedWorkoutVersion,
            changeSummaryText,
            savedWorkoutContent,
            savedMealContent
          ).catch((chatErr) =>
            console.error("[program-generation] chat plan summary message failed (non-fatal):", chatErr)
          );
        }
        console.log(`[program-generation] completed for ${userId} in ${Math.round((Date.now() - startedAt) / 1000)}s${workoutFallbackUsed || mealFallbackUsed ? " (با موتور محلی فال‌بک)" : ""}`);
        // ─── v146 — شفافیت ادمین: هر بار که موتور محلی جایگزین AI شد، یک ردیف
        // ErrorLog ثبت می‌شود تا ادمین بداند سرویس AI مشکل داشته و بتواند بعداً
        // با بازتولید AI، برنامه را جایگزین کند. (داخل try/catch — هرگز شکستش
        // چرخهٔ موفق را نمی‌سازد) ───
        if (workoutFallbackUsed || mealFallbackUsed) {
          await db.errorLog.create({
            data: {
              source: "program-generation",
              statusCode: 0,
              message: `برنامه با موتور محلی ذخیره شد (AI در همهٔ تلاش‌ها پاسخ نداد) — تمرین: ${workoutFallbackUsed ? "فال‌بک" : "AI"} | غذا: ${mealFallbackUsed ? "فال‌بک" : "AI"}`,
              url: "program-generation",
              method: "BACKGROUND",
              userId,
              context: JSON.stringify({ reqId, planName: effectivePlan, workoutFallbackUsed, mealFallbackUsed, lastErrMsg }),
            },
          }).catch(() => {});
        }
        return;
      }

      // سمتِ جاافتاده را دقیق گزارش کن (در عمل با فال‌بک محلی دیگر نباید رخ دهد —
      // فقط اگر حتی موتور محلی هم خطای زیرساختی بدهد)
      const missing: string[] = [];
      if (!workoutOk) missing.push("برنامه تمرینی");
      if (!mealOk) missing.push("برنامه غذایی");
      throw new Error(
        `تولید ${missing.join(" و ")} حتی با موتور محلی فال‌بک ناموفق بود${lastErrMsg ? ` — ${lastErrMsg}` : ""}`
      );
    } catch (err) {
      const errMsg = String((err as Error)?.message || err).slice(0, 480) || "خطای ناشناخته";
      console.error("[program-generation] background generation failed:", err);
      // ─── v146 — تشخیص‌پذیری: تا امروز شکست تولید فقط در console.error بود
      // (با مرگ پروسه/ری‌استارت سرور هیچ ردی نمی‌ماند و ریشه‌یابی ناممکن می‌شد —
      // دقیقاً همان اتفاقی که برای «۳ تلاش ناموفق» مالک افتاد). حالا همیشه یک
      // ردیف ErrorLog ثبت می‌شود تا ادمین/توسعه‌دهنده ریشه را ببیند. ───
      try {
        await db.errorLog.create({
          data: {
            source: "program-generation",
            statusCode: 0,
            message: `شکست تولید برنامه: ${errMsg}`,
            stack: (err as Error)?.stack?.slice(0, 2000) ?? null,
            url: "program-generation",
            method: "BACKGROUND",
            userId,
            context: JSON.stringify({ reqId, planName: effectivePlan, source, lastErrMsg }),
          },
        }).catch(() => {});
      } catch {}
      try {
        if (reqId) {
          await db.programRequest.update({
            where: { id: reqId },
            data: { status: "failed", lastError: errMsg },
          });
        }
      } catch {}
      try {
        await createNotification(
          userId,
          "system",
          "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
          "تولید برنامه ورزشی و غذایی شما با خطا مواجه شد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
          "?tab=programs",
          { from: "program-generation", action: "plan_generation_failed" }
        );
      } catch {}
    } finally {
      // 🩹 v167 — توقف heartbeat در هر سرنوشت (موفق/شکست) تا تایمر رها نماند
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  })();

  return { started: true };
}

/**
 * v111 — درج «پیام خلاصهٔ برنامهٔ جدید» در چت با فیتاپ (بعد از تولید موفق
 * source=chat_request). درج مستقیم ردیف ChatMessage با role=assistant —
 * دقیقاً همان الگویی که route چت برای پاسخ‌ها استفاده می‌کند (db.chatMessage.
 * create) — پس هیچ فراخوانی AI تازه‌ای trigger نمی‌شود و پیام با رفرش/بازکردن
 * مجدد چت (یا poll کارت تایید) در همان گفت‌وگو دیده می‌شود.
 *
 * محتوا: تایید فارسی + شمارهٔ نسخه + خلاصهٔ تغییرات (متن واقعی درخواست کاربر)
 * + ۳ تا ۵ گل‌میخ برنامهٔ جدید (تعداد روز/حرکات، هدف هفته، کالری/وعده‌ها).
 * برنامهٔ کامل در تب «برنامه‌ها» است — اینجا فقط خلاصهٔ فشرده.
 * هرگز throw نمی‌کند (caller هم catch دارد — شکست پیام ≠ شکست تولید).
 */
async function postChatPlanSummaryMessage(
  userId: string,
  workoutVersion: number | null,
  changeSummary: string | null,
  workoutContent: Record<string, unknown> | null,
  mealContent: Record<string, unknown> | null
): Promise<void> {
  // ─── استخراج گل‌میخ‌ها از JSON برنامهٔ تازه ذخیره‌شده (بدون شکست) ───
  const highlights: string[] = [];
  try {
    const w = (workoutContent ?? {}) as {
      days?: Array<{ day?: string; exercises?: unknown[] }>;
      weeklyGoal?: string;
      splitType?: string;
      planType?: string;
    };
    const m = (mealContent ?? {}) as { meals?: unknown[]; totalCalories?: number };
    const days = Array.isArray(w.days) ? w.days : [];
    if (days.length > 0) {
      highlights.push(
        `🏋️ تمرین: ${toPersianDigits(days.length)} روز در هفته${w.weeklyGoal ? ` — هدف: ${String(w.weeklyGoal)}` : ""}`
      );
      const exCount = days.reduce(
        (s, d) => s + (Array.isArray(d?.exercises) ? d.exercises.length : 0),
        0
      );
      if (exCount > 0) {
        highlights.push(`💪 ${toPersianDigits(exCount)} حرکت در هفته (ثبت وزنه و پیشرفت هفتگی فعال است)`);
      }
    }
    if (Array.isArray(m.meals) && m.meals.length > 0) {
      const cal = m.totalCalories
        ? ` (~${toPersianDigits(Math.round(m.totalCalories))} کالری روزانه)`
        : "";
      highlights.push(`🍽️ تغذیه: ${toPersianDigits(m.meals.length)} وعده در روز${cal}`);
    }
  } catch (hlErr) {
    console.warn("[program-generation] plan summary highlight extraction failed (skipped):", hlErr);
  }

  const versionLine = workoutVersion
    ? `✅ **برنامهٔ جدید شما ساخته شد (نسخهٔ ${toPersianDigits(workoutVersion)})**`
    : "✅ **برنامهٔ جدید شما ساخته شد**";
  const summaryBlock = changeSummary?.trim()
    ? `خلاصهٔ تغییرات اعمال‌شده بر اساس درخواست شما:\n${changeSummary.trim()}`
    : "خلاصهٔ تغییرات اعمال‌شده بر اساس درخواست شما در همین گفت‌وگو.";
  const bullets = highlights.length > 0
    ? `\n\n📌 برجسته‌های برنامهٔ جدید:\n${highlights.slice(0, 5).map((h) => `- ${h}`).join("\n")}`
    : "";

  const content =
    `${versionLine}\n\n${summaryBlock}${bullets}\n\n` +
    `برنامهٔ جدید در تب «برنامه‌ها» فعال است و «تامین امروز» و «حالت باشگاه» هم به‌روز شدند. ` +
    `نسخهٔ قبلی با تاریخ شروع و تاریخ اصلاح، پایین همان تب باقی مانده است.`;

  await db.chatMessage.create({
    data: { userId, role: "assistant", content },
  });
  console.log(`[program-generation] chat plan summary message posted (user=${userId}, version=${workoutVersion ?? "?"})`);
}

/** پیام فارسی استاندارد «در حال آماده‌سازی» — برای پاسخ API‌ها */
export const PROGRAM_PREPARING_MESSAGE =
  "برنامه شما در حال آماده‌سازی است — پس از آماده‌سازی به شما اطلاع می‌دهیم.";

/**
 * پنجره «تولید گیرکرده» (M3) — باید از بدترین حالت تولید بزرگ‌تر باشد تا
 * تولیدِ هنوز-در-حال-اجرا اشتباهی «یتیم» تشخیص داده نشود و تولید موازی دوباره
 * شروع نشود (هزینه ۲× AI).
 *
 * Task 3-b (دیرکتیو مالک): ۵۰ → ۲۰ دقیقه.
 * چرا ۲۰ دقیقه امن است: تولید عادی با زنجیرهٔ فال‌بک v38 عملاً زیر ۵ دقیقه
 * تمام می‌شود؛ راند دومِ سمتِ ناموفق هم مستقل شروع و تا چند دقیقه بسته می‌شود.
 * یعنی اگر یک ردیف generating بعد از ۲۰ دقیقه هنوز به‌روز نشده باشد، به‌طور
 * قطع پروسه‌ی پس‌زمینه‌اش مرده است (restart/crash/دیپلوی) — نه در حال اجرا.
 * پنجرهٔ کوتاه‌تر یعنی پیامک/نوتیف «برنامه آماده شد» یا retry خودکار به‌جای
 * ۵۰ دقیقه، حداکثر ۲۰ دقیقه بعد از قطعی سرور می‌رسد.
 */
const STUCK_GENERATION_WINDOW_MS = 20 * 60 * 1000;

/**
 * 🩹 v167 — پاک‌سازی «یتیم‌های ناقص» تولید (دیرکتیو مالک: «در تولید هر برنامه
 * هر تعداد تلاشی که انجام شد فقط نسخهٔ نهایی و کامل که هر سه تا برنامهٔ تمرینی
 * تغذیه و مکمل کامل نوشته شده قرار بگیره»).
 *
 * هر چرخهٔ سالم تولید دقیقاً «یک» WorkoutPlan و «یک» MealPlan هم‌دوره می‌سازد
 * (چند دقیقه فاصله). ردیفِ غیرفعالی که جفتِ هم-دوره ندارد یعنی مصنوعِ تلاشِ
 * ناقصِ یک چرخهٔ مرده است (تمرین ذخیره شد و تغذیه نه، یا برعکس) — چنین ردیفی
 * هرگز نباید در تب برنامه‌ها/پنل به‌عنوان «نسخه» دیده شود.
 *
 * منطق جفت‌سازی (۱:۱ حریصانه) عیناً همان الگوی program-history است تا تعریف
 * «هم-دوره» بین تولید و نمایش یکی باشد. فقط ردیف‌های «غیرفعال» بررسی می‌شوند:
 *   ✔ برنامهٔ فعال جاری هرگز دست نمی‌خورد
 *   ✔ جفت‌های کامل دوره‌های قبلی (تاریخچهٔ واقعی کاربر) باقی می‌مانند
 *   ✔ فقط ناقص‌های بدون جفت حذف می‌شوند
 * هرگز throw نمی‌کند — شکست پاک‌سازی نباید چرخهٔ تولید را بشکند.
 *
 * export: مسیر خودترمیم program-history GET هم آن را صدا می‌زند تا نسخه‌های
 * ناقصِ قدیمی با اولین بازدید کاربر خودبه‌خود پاک شوند.
 */
export async function cleanupOrphanPlanRows(
  userId: string,
  opts?: { before?: Date }
): Promise<void> {
  try {
    const cap = { lt: opts?.before ?? new Date() };
    const [workoutRows, mealRows] = await Promise.all([
      db.workoutPlan.findMany({
        where: { userId, active: false, createdAt: cap },
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true },
      }),
      db.mealPlan.findMany({
        where: { userId, active: false, createdAt: cap },
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true },
      }),
    ]);
    if (workoutRows.length === 0 && mealRows.length === 0) return;

    // پنجرهٔ هم-دوره بودن: ۱۵ دقیقه (تولید عادی تمرین→تغذیه چند دقیقه طول می‌کشد؛
    // یتیم‌ها از چرخه‌های دیگر ده‌ها دقیقه/روز فاصله دارند)
    const PAIR_WINDOW_MS = 15 * 60 * 1000;
    const usedMeals = new Set<string>();
    const pairedWorkouts = new Set<string>();
    for (const w of workoutRows) {
      let best: (typeof mealRows)[number] | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const m of mealRows) {
        if (usedMeals.has(m.id)) continue;
        const d = Math.abs(m.createdAt.getTime() - w.createdAt.getTime());
        if (d < bestDiff) {
          bestDiff = d;
          best = m;
        }
      }
      if (best && bestDiff <= PAIR_WINDOW_MS) {
        usedMeals.add(best.id);
        pairedWorkouts.add(w.id);
      }
    }
    const orphanWorkoutIds = workoutRows
      .filter((w) => !pairedWorkouts.has(w.id))
      .map((w) => w.id);
    const orphanMealIds = mealRows
      .filter((m) => !usedMeals.has(m.id))
      .map((m) => m.id);

    if (orphanWorkoutIds.length > 0) {
      const res = await db.workoutPlan.deleteMany({
        where: { id: { in: orphanWorkoutIds }, active: false },
      });
      console.log(
        `[program-generation] v167 orphan cleanup: removed ${res.count} incomplete workout row(s) (user=${userId})`
      );
    }
    if (orphanMealIds.length > 0) {
      const res = await db.mealPlan.deleteMany({
        where: { id: { in: orphanMealIds }, active: false },
      });
      console.log(
        `[program-generation] v167 orphan cleanup: removed ${res.count} incomplete meal row(s) (user=${userId})`
      );
    }
  } catch (e) {
    console.warn("[program-generation] v167 orphan cleanup failed (non-fatal):", e);
  }
}

/**
 * 🩹 v142 — باز-سینک مکمل (تمرین ← تغذیه) در مسیر بازیابی وچ‌داگ.
 *
 * اگر سرور بعد از ذخیرهٔ «هر دو» برنامه ولی «قبل از اکوی مکمل» (v112) مرده
 * باشد، استک مکملِ برنامهٔ غذایی هنوز روی برنامهٔ تمرینی ننشسته است. برای
 * پایبندی به دیرکتیو مالک («هر سه تا در پنل کاربر قرار گرفت») این بهترین‌تلاش
 * همان اکو را قبل از نوتیف انجام می‌دهد — هرگز throw نمی‌کند و شکستش فقط warn است.
 */
async function resyncSupplementEchoForRecovery(userId: string): Promise<void> {
  try {
    const [workoutRow, mealRow] = await Promise.all([
      db.workoutPlan.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
        select: { id: true, content: true },
      }),
      db.mealPlan.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      }),
    ]);
    if (!workoutRow || !mealRow) return;
    type SuppItem = { name?: string; dose?: string; timing?: string; note?: string };
    const meal = JSON.parse(mealRow.content) as {
      supplementStack?: SuppItem[];
      supplements?: SuppItem[];
    };
    const rawStack =
      Array.isArray(meal?.supplementStack) && meal.supplementStack.length
        ? meal.supplementStack
        : Array.isArray(meal?.supplements) && meal.supplements.length
          ? meal.supplements
          : [];
    const flat = rawStack
      .filter((s) => s && typeof s.name === "string" && s.name.trim())
      .map((s) => ({
        name: String(s.name).trim(),
        dose: s.dose ? String(s.dose).trim() : "",
        timing: s.timing ? String(s.timing).trim() : "",
        note: s.note ? String(s.note).trim() : undefined,
      }));
    if (flat.length === 0) return;
    const w = JSON.parse(workoutRow.content) as Record<string, unknown>;
    const existingCount = Array.isArray(w.supplements) ? (w.supplements as unknown[]).length : 0;
    if (existingCount >= flat.length) return; // قبلاً سینک شده — دست نمی‌زنیم
    w.supplements = flat;
    w.supplementTimingNotes = flat.map((s) => `${s.name}${s.timing ? `: ${s.timing}` : ""}`);
    await db.workoutPlan.update({
      where: { id: workoutRow.id },
      data: { content: JSON.stringify(w) },
    });
    console.log("[watchdog] v142 supplement echo re-synced during recovery");
  } catch (e) {
    console.warn("[watchdog] supplement echo re-sync failed (non-fatal):", e);
  }
}

/**
 * Task 3-b — هستهٔ مشترک بازیابی «یک» درخواست گیرکرده.
 *
 * هم مسیر per-user (recoverStuckGenerations — وقتی کاربر پنل را باز می‌کند)
 * و هم سوئیپ سراسری (recoverAllStuckGenerations — کرون رفتاری هر ۵ دقیقه)
 * از همین منطق استفاده می‌کنند تا رفتار همیشه یکسان بماند:
 *  - اگر برنامه‌ای بعد از شروع همین چرخهٔ تولید ذخیره شده باشد → ready
 *    (تولید کامل شده ولی آپدیت status به‌خاطر مرگ پروسه نرسیده) + نوتیف/پیامک
 *  - وگرنه اگر autoRetryCount < 1 → failed + خودترمیم یک‌باره (تولید دوباره)
 *  - وگرنه → failed (کاربر از تب برنامه‌ها دکمهٔ retry را می‌زند)
 *
 * خروجی: "ready" | "retry" | "failed" — برای شمارش خلاصهٔ سوئیپ.
 */
async function recoverOneStuckGeneration(request: {
  id: string;
  userId: string;
  autoRetryCount: number;
  updatedAt: Date;
}): Promise<"ready" | "retry" | "failed"> {
  // آیا برنامه‌ای در این مدت ذخیره شده؟ (تولید ممکن است کامل شده باشد ولی
  // آپدیت status به‌خاطر مرگ پروسه نرسیده باشد)
  // ─── M2: فقط برنامه‌ای که «بعد از شروع همین چرخه تولید» ساخته شده دلیل
  // آماده‌بودن است — updatedAt همان لحظه‌ای است که وضعیت generating شده؛
  // برنامه دوره قبلی نباید تولید گیرکردهِ کاربر تمدیدی را ready کند.
  //
  // ─── 🩹 v142 — دیرکتیو مالک: «هر وقت برنامه تمرین و تغذیه و مکمل آماده شد و
  // هر سه تا در پنل کاربر قرار گرفت، بعد پیام و نوتیف به کاربر برود» ───
  // قبلاً فقط «وجود WorkoutPlan» چک می‌شد → اگر سرور وسط چرخه می‌مرد (تمرین
  // ذخیره شده بود ولی تغذیه نه)، وچ‌داگ وضعیت را ready و نوتیف/پیامک می‌فرستاد؛
  // کاربر که پنل را باز می‌کرد برنامهٔ تغذیه و مکملش را نمی‌دید (گزارش مالک).
  // چون استک مکمل بخشی از برنامهٔ غذایی است (supplementStack در MealPlan)،
  // معیار درست: WorkoutPlan «و» MealPlan هر دو بعد از شروع همین چرخه ذخیره
  // شده باشند. اگر فقط تمرین بود → جزء ناقص است و باید به مسیر خودترمیم/failed برود.
  const [cycleWorkout, cycleMeal] = await Promise.all([
    db.workoutPlan.findFirst({
      where: { userId: request.userId, createdAt: { gte: request.updatedAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    db.mealPlan.findFirst({
      where: { userId: request.userId, createdAt: { gte: request.updatedAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);
  const hasPlan = !!(cycleWorkout && cycleMeal);
  if (hasPlan) {
    // 🩹 v167 — پاک‌سازی یتیم‌های ناقص چرخه‌های قبلی قبل از اعلام ready
    // (قانون مالک: فقط نسخهٔ نهایی و کامل در پنل دیده شود)
    await cleanupOrphanPlanRows(request.userId);
    // 🩹 v142 — اکوی مکمل (تمرین ← تغذیه) شاید به‌خاطر مرگ پروسه اجرا نشده باشد؛
    // بهترین‌تلاش برای سینک مجدد تا قبل از نوتیف، هر سه برنامه واقعاً سینک باشند.
    await resyncSupplementEchoForRecovery(request.userId);
    // برنامه موجود است — وضعیت را ready کن (نه failed!)
    await db.programRequest.update({
      where: { id: request.id },
      data: { status: "ready" },
    });
    // v172 — رویداد زندهٔ پنل: بازیابی watchdog هم لحظه‌ای اعلام می‌شود
    publishPanelEvent(request.userId, "plan_ready", {
      requestId: request.id,
      source: "recovery",
      section: "programs",
    });
    // v37: نوتیف همزمان (قبلاً فقط پیامک می‌رفت — درخواست مالک: پیامک ↔ نوتیف جفت باشند)
    // v63 — dedupe عنوان‌محورِ ۲۴ساعته (هم‌راستا با مسیرهای دیگر) + متنِ یکسان با
    // مسیر تولید عادی. قبلاً متنِ متفاوت بود و dedupeِ (عنوان+متن) آن را رد نمی‌کرد
    // → کاربر هم نوتیف «ساخته شد» و هم «آماده است» می‌گرفت (گزارش نوتیف ۵تایی).
    const alreadyNotified = await db.notification.findFirst({
      where: {
        userId: request.userId,
        type: "achievement",
        title: "برنامه شما آماده شد! 🎯",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (!alreadyNotified) {
      await createNotification(
        request.userId,
        "achievement",
        "برنامه شما آماده شد! 🎯",
        // v142 — متن یکسان با مسیر تولید عادی (dedupe عنوان+متن) — هر سه برنامه ذکر شود
        "برنامه‌های تمرینی، تغذیه و مکمل شخصی‌سازی‌شدهٔ شما توسط فیتاپ هوشمند ساخته شد. از بخش‌های «تمرینات»، «تغذیه» و «مکمل» مشاهده کنید.",
        "?tab=programs"
      );
    }
    // v32: پیامک «برنامه آماده شد» (قالب 663678)
    // v66: دداپ بر چرخهٔ بازیابی‌شده (request.id) — دورهٔ بعدی هم پیامک می‌گیرد
    notifyProgramReadySms(request.userId, request.id);
    console.log("[watchdog] recovered orphaned generating → ready (plan exists):", request.id);
    return "ready";
  }

  // برنامه‌ای نیست — اگر بودجهٔ خودترمیم باقی مانده، دوباره شروع کن
  // v146 — بودجهٔ خودترمیم ۱ → ۲ رسید: با موتور محلی فال‌بک، چرخهٔ تولید عملاً
  // هرگز شکست نمی‌خورد؛ این بودجهٔ دوم فقط برای پوشش مرگ پروسهٔ سرور وسط چرخهٔ
  // خودترمیم اول است (ری‌استارت دوباره وسط تولید → فرصت سوم).
  if (request.autoRetryCount < 2) {
    await db.programRequest.update({
      where: { id: request.id },
      data: { status: "failed", autoRetryCount: { increment: 1 } },
    });
    console.log("[watchdog] auto-retrying orphaned generation:", request.id);
    const result = await startProgramGenerationInBackground(request.userId);
    if (result.started) {
      console.log("[watchdog] auto-retry started for:", request.userId);
    } else {
      console.log("[watchdog] auto-retry not started:", result.reason);
    }
    return "retry";
  }

  // قبلاً یک‌بار خودترمیم شده و باز گیر کرده — failed بماند (کاربر دستی retry می‌کند)
  await db.programRequest.update({
    where: { id: request.id },
    data: { status: "failed" },
  });
  console.log("[watchdog] marked stuck generation as failed (retry budget exhausted):", request.id);
  return "failed";
}

/**
 * Watchdog خودترمیم (مسیر per-user) — بازیابی درخواست‌های «generating» گیرکرده.
 *
 * چرا: تولید برنامه fire-and-forget است. اگر پروسه سرور وسط تولید restart شود
 * (dev-mode memory restart، crash، دیپلوی)، پروسه پس‌زمینه می‌میرد و
 * ProgramRequest برای همیشه «generating» می‌ماند.
 *
 * رفتار (منطق مشترک → recoverOneStuckGeneration):
 *  - درخواست گیرکرده (>۲۰ دقیقه بدون به‌روزرسانی) پیدا می‌شود
 *  - اگر برنامه‌ای بعد از شروع همین چرخه تولید ذخیره شده باشد → ready + نوتیف/پیامک
 *  - اگر برنامه‌ای نیست و autoRetryCount < 1 → خودترمیم یک‌باره
 *  - وگرنه → failed (کاربر از تب برنامه‌ها دکمه retry را می‌زند)
 *
 * این تابع از endpointهایی صدا زده می‌شود که فرانت‌اند به آن‌ها poll می‌کند
 * (coach/plan GET و program-history GET). Task 3-b — مسیر مکمل سراسری:
 * recoverAllStuckGenerations در کرون رفتاری، تا SMS/نوتیف به «حضور کاربر در
 * پنل» وابسته نباشد (دیرکتیو تکراری مالک).
 */
export async function recoverStuckGenerations(userId: string): Promise<void> {
  try {
    const stuckWindowAgo = new Date(Date.now() - STUCK_GENERATION_WINDOW_MS);
    const stuck = await db.programRequest.findFirst({
      where: { userId, status: "generating", updatedAt: { lt: stuckWindowAgo } },
      orderBy: { createdAt: "desc" },
    });
    if (!stuck) return;
    await recoverOneStuckGeneration(stuck);
  } catch (e) {
    // watchdog هرگز نباید مسیر caller را بشکند
    console.error("[watchdog] recoverStuckGenerations error:", e);
  }
}

/**
 * Task 3-b — watchdog سراسری (دیرکتیو مالک: «SMS/نوتیف باید مستقل از حضور
 * کاربر در پنل برسد»).
 *
 * قبلاً بازیابی تولیدهای یتیم فقط از مسیرهای user-facing (coach/plan و
 * program-history) اجرا می‌شد — یعنی کاربرِ غایب هیچ‌وقت پیامک/نوتیف
 * «برنامه آماده شد» را نمی‌گرفت و ردیفش ابدی generating می‌ماند.
 * حالا کرون رفتاری (هر ۵ دقیقه) این سوئیپ را صدا می‌زند:
 *  - «همهٔ» ProgramRequestهای generating با updatedAt قدیمی‌تر از پنجرهٔ
 *    ۲۰ دقیقه‌ای (تولید عادی <۵ دقیقه → بعد از ۲۰ دقیقه قطعاً پروسه مرده است)
 *  - برای هر ردیف همان منطق مسیر per-user (recoverOneStuckGeneration) اجرا می‌شود
 *  - batch-safe: حداکثر ۲۵ ردیف در هر سوئیپ (ضد جهش DB/AI در یک تیک)
 *  - non-throwing: خطای هر ردیف جداگانه catch می‌شود؛ بقیه ادامه می‌یابند
 *
 * خروجی: تعداد ردیف‌های تعیین‌تکلیف‌شده (برای stuckRecovered در summary کرون).
 */
const STUCK_SWEEP_BATCH_LIMIT = 25;

export async function recoverAllStuckGenerations(): Promise<number> {
  try {
    const stuckWindowAgo = new Date(Date.now() - STUCK_GENERATION_WINDOW_MS);
    const stuckRows = await db.programRequest.findMany({
      where: { status: "generating", updatedAt: { lt: stuckWindowAgo } },
      orderBy: { updatedAt: "asc" }, // قدیمی‌ترین‌ها اول — عادلانه بین کاربران
      take: STUCK_SWEEP_BATCH_LIMIT,
      select: { id: true, userId: true, autoRetryCount: true, updatedAt: true },
    });
    if (stuckRows.length === 0) return 0;

    let recovered = 0;
    for (const row of stuckRows) {
      try {
        await recoverOneStuckGeneration(row);
        recovered++;
      } catch (rowErr) {
        // خطای یک ردیف هرگز بقیهٔ سوئیپ را نمی‌شکند
        console.error("[watchdog] recoverAllStuckGenerations row error:", row.id, rowErr);
      }
    }
    console.log(
      `[watchdog] سراسری: ${recovered} از ${stuckRows.length} تولید گیرکرده تعیین تکلیف شد (سقف ${STUCK_SWEEP_BATCH_LIMIT}/سوئیپ)`
    );
    return recovered;
  } catch (e) {
    console.error("[watchdog] recoverAllStuckGenerations error:", e);
    return 0;
  }
}

/**
 * v38 — سوئیپ خودکار درخواست‌های «ناموفق» (درخواست مالک: «به هیچ وجه نباید
 * کاربر بدون برنامه بماند»).
 *
 * قبلاً درخواست failed برای همیشه failed می‌ماند مگر کاربر/ادمین دستی retry
 * می‌زد. حالا کرون رفتاری (هر ۳۰ دقیقه) این سوئیپ را صدا می‌زند:
 *   - درخواست‌های failed با attempts < FAILED_AUTO_RETRY_MAX (۳)
 *   - که حداقل FAILED_RETRY_GAP_MS (۱۵ دقیقه) از آخرین تلاش گذشته باشد
 *     (ضد حلقهٔ سریع روی خطای دائمی)
 * دوباره تولید شروع می‌شود (startProgramGenerationInBackground خودش claim
 * اتمیک انجام می‌دهد؛ درخواست failed قابل claim است).
 *
 * خروجی: تعداد درخواست‌هایی که دوباره صف شدند (برای summary کرون).
 */
const FAILED_AUTO_RETRY_MAX = 3;
const FAILED_RETRY_GAP_MS = 15 * 60 * 1000;

// ─── 🩹 v46 — بودجهٔ روزانهٔ سوئیپ در سطح کل سیستم (لایهٔ آخر ضد نشتی AI) ───
// حتی با همهٔ گاردهای v45، اگر روزی دیتای خراب جدید یا مسیر دورزدنی پیدا شود،
// این بودجه در-حافظه حداکثر سوئیپ‌های مجاز در شبانه‌روز را محدود می‌کند.
// هر تولید برنامهٔ کامل ~۵۰هزار توکن گران است؛ سقف ۶ در ۲۴h یعنی بدترین-case
// نشتی از مسیر سوئیپ ≈ ۳۰۰K توکن/روز — محدود و قابل‌قبول، نه ابدی.
const SWEEP_DAILY_REQUEUE_MAX = 6;
const sweepBudget = { date: "", count: 0 };

function tryConsumeSweepBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (sweepBudget.date !== today) {
    sweepBudget.date = today;
    sweepBudget.count = 0;
  }
  if (sweepBudget.count >= SWEEP_DAILY_REQUEUE_MAX) {
    console.warn(
      `[failed-recovery] daily sweep budget exhausted (${SWEEP_DAILY_REQUEUE_MAX}/24h) — skipping requeue`
    );
    return false;
  }
  sweepBudget.count++;
  return true;
}

export async function recoverFailedGenerations(limit = 3): Promise<number> {
  try {
    const gapAgo = new Date(Date.now() - FAILED_RETRY_GAP_MS);
    const failedRequests = await db.programRequest.findMany({
      where: {
        status: "failed",
        attempts: { lt: FAILED_AUTO_RETRY_MAX },
        updatedAt: { lt: gapAgo },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true, userId: true, plan: true, createdAt: true, updatedAt: true },
    });

    let requeued = 0;
    for (const req of failedRequests) {
      // کاربر نبلاک و دارای پروفایل باشد (خطای دائمی ورودی را دور بزن)
      const user = await db.user.findUnique({
        where: { id: req.userId },
        select: { isBlocked: true },
      });
      if (!user || user.isBlocked) continue;

      // ─── 🩹 v45 — ریشه باگ بحرانی مالک (نوتیف هر ۳۰ دقیقه + سوختن AI) ───
      // قبلاً این سوئیپ رکورد قدیمی failed را انتخاب می‌کرد ولی
      // startProgramGenerationInBackground روی «آخرین» درخواست کاربر عمل
      // می‌کرد (که معمولاً ready بود) → هر ۳۰ دقیقه: claim برنامهٔ سالم →
      // تولید کامل AI (۴ فراخوانی مدل گران) → نوتیف تکراری → رکورد قدیمی
      // همچنان failed/attempts=0 می‌ماند → حلقهٔ ابدی.
      // حالا:
      //   ① فقط اگر همین رکورد «آخرین» درخواست کاربر باشد صف‌مجدد می‌شود؛
      //   ② رکوردهای قدیمی‌تر terminal می‌شوند (attempts=MAX) تا دیگر
      //      هرگز انتخاب نشوند — دیتای خرابِ موجود هم خودترمیم می‌شود؛
      //   ③ اگر بعد از ساخت همین رکوردِ failed برنامهٔ فعال ذخیره شده
      //      باشد، کاربر برنامه را دارد → تولید تکرار ممنوع، terminal.
      const latest = await db.programRequest.findFirst({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!latest || latest.id !== req.id) {
        await db.programRequest
          .update({
            where: { id: req.id },
            data: {
              attempts: FAILED_AUTO_RETRY_MAX,
              lastError: "v45 sweep: superseded by a newer request — terminal",
            },
          })
          .catch(() => {});
        console.log(
          `[failed-recovery] ${req.id} is stale (latest=${latest?.id ?? "none"}) → terminalized, will not requeue`
        );
        continue;
      }
      // 🩹 v142 — دیرکتیو مالک: «آماده» فقط وقتی است که تمرین + تغذیه (که مکمل
      // داخل آن است) هر دو بعد از شکست ذخیره شده باشند؛ اگر فقط تمرین باشد
      // تولید تکرار ممنوع نیست — چرخهٔ جدید شروع می‌شود تا کاربر «هر سه» برنامه
      // را با هم بگیرد (نه نوتیفِ زودهنگام، نه برنامهٔ نصفه‌نیمه).
      const [wAfterFailure, mAfterFailure] = await Promise.all([
        db.workoutPlan.findFirst({
          where: {
            userId: req.userId,
            active: true,
            createdAt: { gte: req.createdAt },
          },
          select: { id: true },
        }),
        db.mealPlan.findFirst({
          where: {
            userId: req.userId,
            active: true,
            createdAt: { gte: req.createdAt },
          },
          select: { id: true },
        }),
      ]);
      if (wAfterFailure && mAfterFailure) {
        await db.programRequest
          .update({
            where: { id: req.id },
            data: {
              attempts: FAILED_AUTO_RETRY_MAX,
              status: "ready",
              lastError: null,
            },
          })
          .catch(() => {});
        console.log(
          `[failed-recovery] ${req.id} already has a plan created after it → marked ready (no duplicate AI generation)`
        );
        continue;
      }

      const result: StartGenerationResult = tryConsumeSweepBudget()
        ? await startProgramGenerationInBackground(req.userId)
        : { started: false, reason: "daily_budget" };
      if (result.started) {
        requeued++;
        console.log(
          `[failed-recovery] requeued failed generation for user ${req.userId} (request ${req.id})`
        );
      } else {
        console.log(
          `[failed-recovery] could not requeue ${req.id}: ${result.reason}${result.blockingReason ? ` — ${result.blockingReason}` : ""}`
        );
      }
    }
    return requeued;
  } catch (e) {
    console.error("[failed-recovery] recoverFailedGenerations error:", e);
    return 0;
  }
}
