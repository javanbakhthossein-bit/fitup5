import { db } from "@/lib/db";
import { generateWorkoutPlan, generateMealPlan } from "@/lib/fitness/ai";
import type { OnboardingData, Plan } from "@/lib/fitness/types";
import { checkPrerequisites } from "@/lib/fitness/prerequisites";
import { activatePendingSubscription } from "@/lib/fitness/subscription";
import { createNotification } from "@/lib/fitness/notifications";
import { notifyProgramReadySms } from "@/lib/fitness/sms-flows";
import { buildUserDto } from "@/lib/fitness/auth";
import { fixPlanTypographyDeep } from "@/lib/fitness/persian-typography";
import { resolveActiveWeight } from "@/lib/fitness/active-weight";

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
    // v75 — رشتهٔ ورزشی (فیزیک کلاسیک/بادی‌بیلدینگ/فیتنس/…) — در همهٔ پرامپت‌ها لحاظ می‌شود
    discipline: (profile.discipline ?? undefined) as OnboardingData["discipline"],
    // v74 — یادداشت‌های تغذیه‌ای کاربر (ستون OnboardingProfile.nutritionNotes):
    // از دستیار تغذیه ثبت می‌شود و باید در تولید برنامه (تمرینی/غذایی/مکمل)
    // و همهٔ پرامپت‌های AI پروندهٔ ورزشی دقیق رعایت شود.
    nutritionNotes: profile.nutritionNotes ?? undefined,
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
}> {
  const extras: {
    bodyPhotoAnalysis?: string;
    videoAnalysisResult?: string;
    bloodTestReport?: string;
    renewalContext?: string;
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
          extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر (تاریخ: ${new Date(latestBodyPhoto.createdAt).toLocaleDateString("fa-IR")}):\n${analysisText}`;
        } else {
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
          extras.videoAnalysisResult = `آخرین تحلیل ویدیوی فرم بدن کاربر (تاریخ: ${new Date(latestVideo.createdAt).toLocaleDateString("fa-IR")}):\n${parsed.analysis}`;
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
            extras.videoAnalysisResult = `آخرین تحلیل ویدیوی فرم بدن کاربر (تاریخ: ${new Date(latestVideo.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
          }
        }
      } catch {
        extras.videoAnalysisResult = `آخرین تحلیل ویدیوی کاربر:\n${latestVideo.result.slice(0, 800)}`;
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
          extras.bloodTestReport = `آخرین آزمایش خون کاربر (تاریخ: ${new Date(latestBloodTest.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
        }
      } catch {
        extras.bloodTestReport = `آخرین آزمایش خون کاربر:\n${latestBloodTest.result.slice(0, 800)}`;
      }
    }
  } catch (e) {
    console.error("[program-generation] failed to load blood test:", e);
  }

  // بستر تمدید / بازتولید — پیشرفت کاربر در دوره قبلی
  try {
    const previousSub = await db.subscription.findFirst({
      where: { userId, status: "expired" },
      orderBy: { endDate: "desc" },
      select: { plan: true, durationDays: true, endDate: true },
    });
    const previousPlan = await db.workoutPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (previousSub || previousPlan) {
      const latestCheckup = await db.checkup.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { weight: true, bodyFatPercent: true, fatigueLevel: true, sleepQuality: true, dietAdherence: true, workoutAdherence: true, phaseNumber: true, isFinalCheckup: true },
      });
      const parts: string[] = [];
      if (previousSub) {
        parts.push(`[سیستم - تمدید اشتراک]: این کاربر قبلاً پلن ${previousSub.plan} را برای ${previousSub.durationDays} روز استفاده کرده است.`);
      } else {
        parts.push(`[سیستم - بازتولید برنامه]: کاربر قبلاً برنامه داشته است.`);
      }
      if (latestCheckup) {
        parts.push(`پیشرفت کاربر:`);
        if (latestCheckup.weight) parts.push(`- وزن فعلی: ${latestCheckup.weight}kg`);
        if (latestCheckup.bodyFatPercent) parts.push(`- درصد چربی: ${latestCheckup.bodyFatPercent}%`);
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
      // ─── v53: خلاصهٔ بودجه‌دار پیشرفت واقعی کاربر (تغذیه/تمرین/وزن/استریک) ───
      // خواستهٔ مالک: هر چیزی که کاربر ثبت می‌کند به AI برنامه‌ساز برسد؛ ولی
      // خروجی سقف سخت ۱۵۰۰ کاراکتر دارد و با داینامیک-ایمپورت + try/catch دوتایی
      // تضمین می‌شود که هیچ خطایی هرگز تولید برنامه را نمی‌شکند.
      try {
        const { buildCompactProgressSummary } = await import("@/lib/fitness/sports-profile-context");
        const compact = await buildCompactProgressSummary(userId, { includeCheckups: false });
        if (compact) parts.push(compact);
      } catch (compactErr) {
        console.error("[program-generation] compact progress summary failed (skipped):", compactErr);
      }
      if (parts.length > 0) extras.renewalContext = parts.join("\n");
    }
  } catch (e) {
    console.error("[program-generation] failed to build renewalContext:", e);
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
  opts?: { source?: "checkup" | "admin_rewrite" | "chat_request" }
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
  if (source !== "chat_request") {
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
  if (
    latestReq &&
    latestReq.status === "ready" &&
    source !== "checkup" &&
    source !== "admin_rewrite" &&
    source !== "chat_request"
  ) {
    const freshPlan = await db.workoutPlan.findFirst({
      where: {
        userId,
        active: true,
        createdAt: { gte: latestReq.updatedAt },
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
      where: {
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
  if (source !== "admin_rewrite" && source !== "chat_request") {
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
    try {
      const [planData, extras] = await Promise.all([
        buildOnboardingData(userId),
        buildGenerationExtras(userId),
      ]);
      if (!planData) throw new Error("پروفایل آنبوردینگ یافت نشد");

      // ─── v38: تمرین و غذا مستقل از هم تولید و ذخیره می‌شوند ───
      // قبلاً Promise.all بود: اگر غذایی موفق و تمرین ناموفق بود (یا برعکس)،
      // هر دو دور ریخته می‌شد و کاربر کاملاً بدون برنامه می‌ماند. حالا:
      // ① هر کدام موفق شد فوراً ذخیره می‌شود ② فقط سمتِ ناموفق یک‌بار دیگر
      // تلاش می‌شود ③ اگر یکی در نهایت موفق بود، کاربر حداقل آن را دارد و
      // سوئیپ خودکار فردای سمتِ جاافتاده را کامل می‌کند.
      // v76 — وزن مبنای این تولید؛ روی برنامه ذخیره می‌شود تا ناسازگاریِ
      // وزنِ برنامهٔ موجود با وزن فعلیِ پروفایل قابل تشخیص و هشدار باشد.
      const generationBaseWeight = planData.weight;
      const saveWorkout = async () => {
        const workout = await generateWorkoutPlan(planData, effectivePlan, extras);
        // v75 — اصلاح تایپوگرافی فارسی روی کل متن برنامه قبل از ذخیره
        // (کلمات چسبیده مثل «تمامقد» دیگر وارد DB نمی‌شوند)
        const fixed = fixPlanTypographyDeep(workout);
        await db.workoutPlan.updateMany({ where: { userId }, data: { active: false } });
        await db.workoutPlan.create({
          data: { userId, content: JSON.stringify(fixed), active: true, baseWeight: generationBaseWeight ?? null },
        });
      };
      const saveMeal = async () => {
        const meal = await generateMealPlan(planData, effectivePlan, extras);
        // v75 — اصلاح تایپوگرافی فارسی روی کل متن برنامه قبل از ذخیره
        const fixed = fixPlanTypographyDeep(meal);
        await db.mealPlan.updateMany({ where: { userId }, data: { active: false } });
        await db.mealPlan.create({
          data: { userId, content: JSON.stringify(fixed), totalCal: meal.totalCalories, active: true, baseWeight: generationBaseWeight ?? null },
        });
      };

      const [wRes, mRes] = await Promise.allSettled([saveWorkout(), saveMeal()]);
      // v38-fix: موفقیتِ «این چرخه» با نتیجهٔ راندها سنجیده می‌شود نه وجود
      // برنامهٔ فعال در DB — وگرنه برنامهٔ فعالِ دورهٔ قبلیِ کاربرِ تمدیدی
      // تولیدِ شکست‌خورده را «آماده» جعل می‌کرد (در تست E2E دیتابیس واقعی گرفته شد)
      let workoutOk = wRes.status === "fulfilled";
      let mealOk = mRes.status === "fulfilled";
      if (wRes.status === "rejected") {
        lastErrMsg = `تمرین: ${String((wRes.reason as Error)?.message || wRes.reason).slice(0, 250)}`;
        console.error("[program-generation] workout side failed (attempt 1):", wRes.reason);
      }
      if (mRes.status === "rejected") {
        lastErrMsg = `${lastErrMsg ? lastErrMsg + " | " : ""}غذا: ${String((mRes.reason as Error)?.message || mRes.reason).slice(0, 250)}`;
        console.error("[program-generation] meal side failed (attempt 1):", mRes.reason);
      }

      // فقط سمت‌های ناموفق → یک راند تلاش مجدد (هر سمت مستقل)
      const round2: Array<{ name: string; run: Promise<void> }> = [];
      if (!workoutOk) round2.push({ name: "workout", run: saveWorkout() });
      if (!mealOk) round2.push({ name: "meal", run: saveMeal() });
      if (round2.length > 0) {
        const r2 = await Promise.allSettled(round2.map((r) => r.run));
        r2.forEach((res, i) => {
          if (res.status === "rejected") {
            console.error(`[program-generation] ${round2[i].name} side failed (attempt 2):`, res.reason);
          } else {
            if (round2[i].name === "workout") workoutOk = true;
            else mealOk = true;
            console.log(`[program-generation] ${round2[i].name} side recovered on attempt 2`);
          }
        });
      }

      if (workoutOk && mealOk) {
        if (reqId) {
          await db.programRequest.update({
            where: { id: reqId },
            data: { status: "ready", lastError: null },
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
          await createNotification(
            userId,
            "achievement",
            readyTitle,
            source === "checkup"
              ? "بر اساس آخرین چکاپ، فیتاپ هوشمند برنامه‌های تمرینی و غذایی شما را به‌روزرسانی کرد — برنامهٔ جدید در جای برنامهٔ قبلی نشسته و تغییری در پلن و زمان اشتراک شما ایجاد نشده است. از بخش «تمرینات» و «تغذیه» ببینید."
              : "برنامه تمرینی و غذایی شخصی‌سازی‌شده شما توسط فیتاپ هوشمند ساخته شد. از بخش «تمرینات» و «تغذیه» مشاهده کنید.",
            "?tab=programs"
          );
        }
        // v32: پیامک همزمان «برنامه آماده شد» (قالب 663678)
        // v66: دداپ بر چرخهٔ تولید (reqId) — هر برنامهٔ جدید یک پیامک
        notifyProgramReadySms(userId, reqId ?? undefined);
        console.log(`[program-generation] completed for ${userId} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
        return;
      }

      // سمتِ جاافتاده را دقیق گزارش کن
      const missing: string[] = [];
      if (!workoutOk) missing.push("برنامه تمرینی");
      if (!mealOk) missing.push("برنامه غذایی");
      throw new Error(
        `تولید ${missing.join(" و ")} پس از ۲ تلاش ناموفق بود${lastErrMsg ? ` — ${lastErrMsg}` : ""}`
      );
    } catch (err) {
      const errMsg = String((err as Error)?.message || err).slice(0, 480) || "خطای ناشناخته";
      console.error("[program-generation] background generation failed:", err);
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
    }
  })();

  return { started: true };
}

/** پیام فارسی استاندارد «در حال آماده‌سازی» — برای پاسخ API‌ها */
export const PROGRAM_PREPARING_MESSAGE =
  "برنامه شما در حال آماده‌سازی است — پس از آماده‌سازی به شما اطلاع می‌دهیم.";

/**
 * پنجره «تولید گیرکرده» (M3) — باید از بدترین حالت تولید بزرگ‌تر باشد تا
 * تولیدِ هنوز-در-حال-اجرا اشتباهی «یتیم» تشخیص داده نشود و تولید موازی دوباره
 * شروع نشود (هزینه ۲× AI).
 * v38: زنجیره حالا فال‌بک مدل دوم هم دارد + راند دومِ سمتِ ناموفق →
 * بدترین حالت: زنجیرهٔ ۱۸دقیقه‌ای + راند دوم تا ۱۸ دقیقه ≈ ۳۶ دقیقه
 * → پنجره ۵۰ دقیقه.
 */
const STUCK_GENERATION_WINDOW_MS = 50 * 60 * 1000;

/**
 * Watchdog خودترمیم — بازیابی درخواست‌های «generating» گیرکرده (یتیم‌شده).
 *
 * چرا: تولید برنامه fire-and-forget است. اگر پروسه سرور وسط تولید restart شود
 * (dev-mode memory restart، crash، دیپلوی)، پروسه پس‌زمینه می‌میرد و
 * ProgramRequest برای همیشه «generating» می‌ماند.
 *
 * رفتار:
 *  - درخواست گیرکرده (>۲۰ دقیقه بدون به‌روزرسانی) پیدا می‌شود
 *  - اگر برنامه‌ای بعد از شروع همین چرخه تولید ذخیره شده باشد → ready
 *    (تولید کامل شده ولی آپدیت status به‌خاطر مرگ پروسه نرسیده)
 *  - اگر برنامه‌ای نیست و autoRetryCount < 1:
 *      → یک‌بار به‌صورت خودکار تولید دوباره شروع می‌شود (بدون دخالت کاربر)
 *  - وگرنه: failed (کاربر از تب برنامه‌ها دکمه retry را می‌زند)
 *
 * این تابع از endpointهایی صدا زده می‌شود که فرانت‌اند موقع generating به آن‌ها
 * poll می‌کند (coach/plan GET و program-history GET) — یعنی watchdog همان‌جا
 * فعال می‌شود که کاربر منتظر برنامه است.
 */
export async function recoverStuckGenerations(userId: string): Promise<void> {
  try {
    const stuckWindowAgo = new Date(Date.now() - STUCK_GENERATION_WINDOW_MS);
    const stuck = await db.programRequest.findFirst({
      where: { userId, status: "generating", updatedAt: { lt: stuckWindowAgo } },
      orderBy: { createdAt: "desc" },
    });
    if (!stuck) return;

    // آیا برنامه‌ای در این مدت ذخیره شده؟ (تولید ممکن است کامل شده باشد ولی
    // آپدیت status به‌خاطر مرگ پروسه نرسیده باشد)
    // ─── M2: فقط برنامه‌ای که «بعد از شروع همین چرخه تولید» ساخته شده دلیل
    // آماده‌بودن است — updatedAt همان لحظه‌ای است که وضعیت generating شده؛
    // برنامه دوره قبلی نباید تولید گیرکردهِ کاربر تمدیدی را ready کند.
    const hasPlan = await db.workoutPlan.findFirst({
      where: { userId, createdAt: { gte: stuck.updatedAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (hasPlan) {
      // برنامه موجود است — وضعیت را ready کن (نه failed!)
      await db.programRequest.update({
        where: { id: stuck.id },
        data: { status: "ready" },
      });
      // v37: نوتیف همزمان (قبلاً فقط پیامک می‌رفت — درخواست مالک: پیامک ↔ نوتیف جفت باشند)
      // v63 — dedupe عنوان‌محورِ ۲۴ساعته (هم‌راستا با مسیرهای دیگر) + متنِ یکسان با
      // مسیر تولید عادی. قبلاً متنِ متفاوت بود و dedupeِ (عنوان+متن) آن را رد نمی‌کرد
      // → کاربر هم نوتیف «ساخته شد» و هم «آماده است» می‌گرفت (گزارش نوتیف ۵تایی).
      const alreadyNotified = await db.notification.findFirst({
        where: {
          userId,
          type: "achievement",
          title: "برنامه شما آماده شد! 🎯",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (!alreadyNotified) {
        await createNotification(
          userId,
          "achievement",
          "برنامه شما آماده شد! 🎯",
          "برنامه تمرینی و غذایی شخصی‌سازی‌شده شما توسط فیتاپ هوشمند ساخته شد. از بخش «تمرینات» و «تغذیه» مشاهده کنید.",
          "?tab=programs"
        );
      }
      // v32: پیامک «برنامه آماده شد» (قالب 663678)
      // v66: دداپ بر چرخهٔ بازیابی‌شده (stuck.id) — دورهٔ بعدی هم پیامک می‌گیرد
      notifyProgramReadySms(userId, stuck.id);
      console.log("[watchdog] recovered orphaned generating → ready (plan exists):", stuck.id);
      return;
    }

    // برنامه‌ای نیست — اگر تابه‌حال خودترمیم نشده، یک‌بار دوباره شروع کن
    if (stuck.autoRetryCount < 1) {
      await db.programRequest.update({
        where: { id: stuck.id },
        data: { status: "failed", autoRetryCount: { increment: 1 } },
      });
      console.log("[watchdog] auto-retrying orphaned generation:", stuck.id);
      const result = await startProgramGenerationInBackground(userId);
      if (result.started) {
        console.log("[watchdog] auto-retry started for:", userId);
      } else {
        console.log("[watchdog] auto-retry not started:", result.reason);
      }
      return;
    }

    // قبلاً یک‌بار خودترمیم شده و باز گیر کرده — failed بماند (کاربر دستی retry می‌کند)
    await db.programRequest.update({
      where: { id: stuck.id },
      data: { status: "failed" },
    });
    console.log("[watchdog] marked stuck generation as failed (retry budget exhausted):", stuck.id);
  } catch (e) {
    // watchdog هرگز نباید مسیر caller را بشکند
    console.error("[watchdog] recoverStuckGenerations error:", e);
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
      const planAfterFailure = await db.workoutPlan.findFirst({
        where: {
          userId: req.userId,
          active: true,
          createdAt: { gte: req.createdAt },
        },
        select: { id: true },
      });
      if (planAfterFailure) {
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
