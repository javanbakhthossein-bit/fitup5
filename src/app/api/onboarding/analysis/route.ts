import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import {
  createResilientCompletion,
  ONBOARDING_ANALYSIS_MODEL,
  TEXT_MODEL,
  withSystemDirectives,
} from "@/lib/fitness/ai";
import { fixPersianTypography } from "@/lib/fitness/persian-typography";
import {
  GOAL_LABELS, ACTIVITY_LABELS, GENDER_LABELS, DISCIPLINE_LABELS,
  WORKOUT_PLACE_LABELS, DIET_LABELS, TRAINING_EXPERIENCE_LABELS,
  BODY_FRAME_LABELS, WORKOUT_TIME_LABELS, PREFERRED_CUISINE_LABELS,
  MEDICAL_CONDITION_LABELS, sanitizeDiscipline, toPersianDigits,
  type OnboardingData, type Goal, type Plan,
} from "@/lib/fitness/types";
import {
  calculateBodyComposition,
  calculateMuscleMassPercent,
  type BodyComposition,
} from "@/lib/fitness/body-composition";

/** Robustly parse a stored JSON-or-CSV string list field. */
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

// ═══ v63 — قفل تولید مشترک درون‌پردازشی (باگ مرورگر درون‌برنامه‌ای اینستا) ═══
// تولید تحلیل همگام داخل GET است (تا چند دقیقه). WebViewهای درون‌برنامه‌ای
// (اینستاگرام/تلگرام) fetchهای طولانی را قطع می‌کنند؛ کلاینت هم auto-retry
// دارد — بدون این قفل، هر retry یک فراخوانی AI جدید و ریس روی نوشتن کش بود
// و کاربر باید چند بار دستی «تلاش مجدد» می‌زد تا یک دور کامل شود.
// حالا همهٔ GETهای هم‌زمان یک کاربر به همان Promise تولیدِ در-جریان می‌پیوندند
// (بدون هزینهٔ AI اضافه، بدون ریس) و به‌محض آماده‌شدن، همان متن را می‌گیرند.
const inFlightAnalysis = new Map<string, Promise<string>>();

/** ساخت پرامپت تحلیل آنبوردینگ (v63 — از GET جدا شد تا با قفل مشترک خوانا بماند) */
function buildAnalysisPrompt(args: {
  data: OnboardingData;
  userName: string;
  workoutDaysList: string[];
  bmi: number;
  bmr: number;
  tdee: number;
  bodyComposition: BodyComposition | null;
  muscleMass: { muscleMassPercent: number } | null;
}): string {
  const { data, userName, workoutDaysList, bmi, bmr, tdee, bodyComposition, muscleMass } = args;
  return `تو فیتاپ هوشمند هستی. یک تحلیل اختصاصی کوتاه (حداکثر ۳ پاراگراف) از وضعیت فیزیکی این ورزشکار بنویس. لحن علمی، دوستانه و انگیزشی. فقط تحلیل بده، برنامه تجویز نکن.

اطلاعات ورزشکار:
- نام: ${userName}
- جنسیت: ${GENDER_LABELS[data.gender]}
- سن: ${data.age} سال
- قد: ${data.height} سانتی‌متر
- وزن: ${data.weight} کیلوگرم
- وزن هدف: ${data.targetWeight || "نامشخص"} کیلوگرم
- هدف: ${GOAL_LABELS[data.goal]}
${data.discipline ? `- رشتهٔ ورزشی (بسیار مهم — تحلیل باید با الزامات و فرهنگ همین رشته هماهنگ باشد): ${DISCIPLINE_LABELS[data.discipline]}` : ""}
- سطح فعالیت: ${ACTIVITY_LABELS[data.activityLevel]}
- روزهای تمرین: ${workoutDaysList.length > 0 ? workoutDaysList.join("، ") : data.workoutDays + " روز در هفته"}
- مکان تمرین: ${WORKOUT_PLACE_LABELS[data.workoutPlace]}
- آسیب‌دیدگی: ${data.injuries || "ندارد"}
- بیماری: ${data.diseases || "ندارد"}
- حساسیت غذایی: ${data.allergies || "ندارد"}
${data.specialConditions ? `- ⚠️ شرایط/نیاز/هدف خاص که خود کاربر نوشته (بسیار مهم — تحلیل باید کاملاً با این شرایط سازگار و همدلانه باشد):
«${data.specialConditions}»
` : ""}- BMI: ${bmi.toFixed(1)}
- BMR: ${Math.round(bmr)} کالری
- TDEE: ${tdee} کالری
${bodyComposition ? `- درصد چربی بدن: ${bodyComposition.bodyFatPercent}٪ (${bodyComposition.bodyFatCategory})
- جرم بدون چربی (LBM): ${bodyComposition.leanBodyMass} کیلوگرم
- جرم چربی: ${bodyComposition.fatMass} کیلوگرم
${muscleMass ? `- درصد عضله تقریبی: ${muscleMass.muscleMassPercent}٪` : ""}
` : ""}
⚠️ قواعد نگارش فارسی: بین همه‌ی کلمات فاصله (space) بگذار و کلمات را به هم نچسبان. برای کلمات مرکب از نیم‌فاصله استفاده کن: «کم‌وزنی»، «اضافه‌وزن»، «عضله‌سازی»، «برنامه‌ریزی»، «می‌توانی»، «می‌شود».

تحلیل را با نام کاربر شروع کن. به نکات مهم مثل BMI${bodyComposition ? "، درصد چربی بدن" : ""}، فاصله تا وزن هدف، و توصیه‌های کلی اشاره کن. در پایان فقط یک جمله کوتاه بگو که برای دریافت برنامه اختصاصی باید از پلن‌های فیتاپ استفاده کند — ⚠️ نام هیچ پلن یا قیمتی را در متن تحلیل ذکر نکن (پیشنهاد پلن جداگانه و خودکار در UI نمایش داده می‌شود).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Macro recommendation
// Calculates target calories + protein/carbs/fat grams based on user's goal.
// ─────────────────────────────────────────────────────────────────────────────
interface MacroRecommendation {
  targetCalories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  proteinPerKg: number;
  deficitPercent: number; // positive = deficit, negative = surplus
}

function calculateMacros(
  goal: Goal,
  tdee: number,
  weightKg: number,
): MacroRecommendation {
  let targetCalories = tdee;
  let proteinPerKg = 1.8;
  let deficitPercent = 0; // positive = cut, negative = bulk

  switch (goal) {
    case "fat_loss":
      // 25% deficit
      deficitPercent = 0.25;
      targetCalories = Math.round(tdee * 0.75);
      proteinPerKg = 2.2;
      break;
    case "cut":
      // v60 — کات: نقصان ملایم‌تر (۲۰٪) + پروتئین بالا برای حفظ حداکثری عضله
      deficitPercent = 0.20;
      targetCalories = Math.round(tdee * 0.80);
      proteinPerKg = 2.4;
      break;
    case "muscle_gain":
      // 10% surplus
      deficitPercent = -0.10;
      targetCalories = Math.round(tdee * 1.10);
      proteinPerKg = 2.0;
      break;
    case "bulk":
      // v60 — افزایش حجم: مازاد ۱۵٪ برای رشد عضلانی سریع‌تر (حجم‌گیری تمیز)
      deficitPercent = -0.15;
      targetCalories = Math.round(tdee * 1.15);
      proteinPerKg = 2.0;
      break;
    case "endurance":
    case "fitness":
    case "strength":
    default:
      // maintenance
      deficitPercent = 0;
      targetCalories = tdee;
      proteinPerKg = 1.8;
      break;
  }

  const protein_g = Math.round(weightKg * proteinPerKg);
  const proteinCal = protein_g * 4;

  // Fat = 25% of total calories
  const fatCal = targetCalories * 0.25;
  const fat_g = Math.round(fatCal / 9);

  // Carbs = remaining calories
  const carbsCal = Math.max(0, targetCalories - proteinCal - fatCal);
  const carbs_g = Math.round(carbsCal / 4);

  return {
    targetCalories,
    protein_g,
    carbs_g,
    fat_g,
    proteinPerKg,
    deficitPercent: Math.round(deficitPercent * 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weight goal trajectory
// ─────────────────────────────────────────────────────────────────────────────
interface WeightTrajectory {
  currentWeight: number;
  targetWeight: number;
  weeksToGoal: number;
  weeklyRate: number; // kg per week (negative = loss)
  weeklyCalorieAdjustment: number; // kcal/day vs TDEE (negative = deficit)
}

function calculateTrajectory(
  goal: Goal,
  currentWeight: number,
  targetWeight: number | undefined | null,
  tdee: number,
): WeightTrajectory | null {
  if (!targetWeight || targetWeight <= 0) return null;
  const diff = targetWeight - currentWeight; // positive = gain, negative = loss

  // Determine safe weekly rate based on goal direction
  let weeklyRate: number;
  if (goal === "fat_loss" || goal === "cut" || diff < 0) {
    // Fat loss / cut: 0.5 kg/week safe rate (کات هم حفظ عضله در اولویت)
    weeklyRate = -0.5;
  } else if (goal === "muscle_gain" || goal === "bulk" || diff > 0) {
    // Muscle gain: 0.25 kg/week — bulk: 0.3 kg/week (حجم‌گیری کمی سریع‌تر)
    weeklyRate = goal === "bulk" ? 0.3 : 0.25;
  } else {
    // Maintenance
    return null;
  }

  // If the rate sign doesn't match the goal direction (e.g. user wants to lose
  // weight but target is heavier than current), bail out.
  if (Math.sign(diff) !== Math.sign(weeklyRate)) return null;

  const weeksToGoal = Math.max(1, Math.ceil(Math.abs(diff) / Math.abs(weeklyRate)));

  // Calorie adjustment: 1 kg fat ≈ 7700 kcal. Per week: rate * 7700. Per day: / 7.
  const weeklyCalorieAdjustment = Math.round((weeklyRate * 7700) / 7);

  return {
    currentWeight: Math.round(currentWeight * 10) / 10,
    targetWeight: Math.round(targetWeight * 10) / 10,
    weeksToGoal,
    weeklyRate,
    weeklyCalorieAdjustment,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan recommendation
// ─────────────────────────────────────────────────────────────────────────────
interface PlanRecommendation {
  recommendedPlan: Plan;
  reason: string;
  /** v132 — دلایل خط‌به‌خط برای لیست UI («چرا این پلن برای توست؟») */
  reasons: string[];
}

// برچسب‌های محلی برای شخصی‌سازی دلیل‌ها (بدون وابستگی به UI)
const REC_PLACE_LABELS: Record<string, string> = {
  gym: "باشگاه",
  home: "خانه",
  both: "باشگاه و خانه",
};

/** v132 — دیرکتیو جدید مالک (جانشین سیاست v59):
 *  «تمرکز پیشنهاد پلن روی ۸۰۰ هزار تومانی (استاندارد) و ۱.۲ میلیون (پیشرفته) باشد.»
 *
 *  قیف جدید:
 *   • حرفه‌ای (۱.۸M) ← فقط سیگنال صریح حرفه‌ای بودن (maxLifts / تجربهٔ pro) — نادر و صادقانه
 *   • پیشرفته (۱.۲M) ← قیف اصلی فروش: پروفایل جدی (≥۴ روز تمرین، تجربهٔ متوسط به بالا،
 *     رشتهٔ ورزشی مشخص) یا نیاز به پیگیری مستمر (آسیب/بیماری ثبت‌شده)
 *   • استاندارد (۸۰۰K) ← شروع اصولی برای پروفایل‌های ساده (مبتدی، ≤۳ روز، بدون عارضه)
 *   • اقتصادی (۳۵۰K) ← دیگر هرگز پیشنهاد خودکار نمی‌شود (فقط در ویترین ۴ کارت دیده می‌شود)
 *  دلیل‌ها همیشه از دادهٔ واقعی آنبوردینگ همان کاربر ساخته می‌شوند تا حس
 *  «پلن اختصاصی خودم» ایجاد شود — نه یک جملهٔ عمومی برای همه.
 */
function recommendPlan(input: {
  goal: Goal;
  experience: string | null | undefined;
  hasInjuries: boolean;
  hasDiseases: boolean;
  wantsDetailedAnalysis: boolean;
  workoutDays: number;
  workoutPlace: string | null | undefined;
  discipline: string | null | undefined;
}): PlanRecommendation {
  const { goal, experience, hasInjuries, hasDiseases, wantsDetailedAnalysis } = input;
  const exp = (experience ?? "").toLowerCase();
  const days = Number(input.workoutDays) || 0;
  const place = REC_PLACE_LABELS[input.workoutPlace ?? ""] ?? "باشگاه";
  const goalLabel = GOAL_LABELS[goal] ?? "تناسب اندام";
  const disciplineLabel = (input.discipline ?? "").trim();
  const healthNote = hasInjuries
    ? "آسیب‌دیدگی ثبت‌شده‌ات"
    : hasDiseases
      ? "شرایط جسمانی ثبت‌شده‌ات"
      : null;

  // ─── ① حرفه‌ای — فقط سیگنال صریح (نادر) ───
  if (wantsDetailedAnalysis || (exp === "pro" && (hasInjuries || hasDiseases))) {
    return {
      recommendedPlan: "ultimate",
      reason:
        "سطح تمرین شما حرفه‌ای است و آنالیز دقیق لازم داری؛ پلن حرفه‌ای با آنالیز ویدیوی فرم بدن (برنامه دقیقاً بر اساس ویدیوی تو طراحی می‌شود)، اصلاح تکنیک حرکات و تحلیل تخصصی آزمایش خون طراحی شده تا هر جزء برنامه با دادهٔ واقعی بدن تو تنظیم شود.",
      reasons: [
        "آنالیز ویدیویی فرم بدن — برنامه دقیقاً بر اساس ویدیوی خودت طراحی می‌شود",
        "اصلاح تکنیک حرکات با ارسال ویدیو — هر حرکت را درست اجرا می‌کنی",
        "تحلیل تخصصی آزمایش خون و تطبیق آن با برنامهٔ تغذیه و تمرین",
        "چت نامحدود ۲۴ ساعته با فیتاپ (متن + عکس + ویدیو)",
      ],
    };
  }

  // ─── ② پیشرفته (۱.۲M) — قیف اصلی: پروفایل جدی یا نیاز به پیگیری ───
  const seriousProfile =
    days >= 4 ||
    exp === "intermediate" ||
    exp === "advanced" ||
    !!disciplineLabel;

  if (seriousProfile || !!healthNote) {
    const reasonParts: string[] = [
      `هدف تو ${goalLabel} است و با ${toPersianDigits(days)} روز تمرین در هفته (${place})${
        disciplineLabel ? ` و رشتهٔ ${disciplineLabel}` : ""
      }، مسیر تو به همراهی مستمر نیاز دارد — نه فقط یک برنامهٔ ثابت.`,
    ];
    if (healthNote) {
      reasonParts.push(
        `با توجه به ${healthNote}، برنامه باید با پایش مداوم تنظیم و اصلاح شود؛ چت ۲۴ ساعته با فیتاپ دقیقاً برای همین است.`,
      );
    }
    return {
      recommendedPlan: "advanced",
      reason:
        reasonParts.join(" ") +
        " پلن پیشرفته چت نامحدود با فیتاپ، تحلیل عکس غذا و بدن، حالت باشگاه و به‌روزرسانی برنامه با پیشرفت تو را دارد — دقیقاً همان ابزارهایی که این مسیر را سریع‌تر و مطمئن‌تر می‌کند.",
      reasons: [
        `چت نامحدود ۲۴ ساعته با فیتاپ — هر سوالی دربارهٔ ${goalLabel}، همان لحظه جواب می‌گیری`,
        "تحلیل عکس غذا با فیتاپ — بدون وزیر کردن و شمارش دستی، فقط عکس بفرست",
        `حالت باشگاه (Gym Mode) و کتابخانهٔ کامل حرکات — دقیقاً برای تمرین در ${place}`,
        healthNote
          ? "به‌روزرسانی برنامه با چکاپ‌های دوره‌ای — برنامه با بدنِ امروزِ تو جلو می‌رود نه با بدنِ یک ماه قبل"
          : "به‌روزرسانی برنامه با پیشرفت تو — هر چکاپ، برنامه در جای خودش تازه می‌شود",
      ],
    };
  }

  // ─── ③ استاندارد (۸۰۰K) — شروع اصولی برای پروفایل‌های ساده ───
  return {
    recommendedPlan: "standard",
    reason: `برای شروع مسیر ${goalLabel} با ${toPersianDigits(days)} روز تمرین در هفته (${place})، پایهٔ درست از روز اول مهم‌تر از هر امکان اضافه‌ای است. پلن استاندارد علاوه بر برنامهٔ تمرینی و غذایی اختصاصی، برنامهٔ مکمل و ۳ چکاپ دوره‌ای دارد تا برنامه‌ات همیشه با پیشرفت واقعی بدنت هماهنگ بماند — بدون پرداخت هزینهٔ امکاناتی که فعلاً به آن نیاز نداری.`,
    reasons: [
      `برنامهٔ تمرین + تغذیه + مکمل اختصاصی بر اساس همین تحلیل — ساختار کامل مسیر ${goalLabel}`,
      "۳ چکاپ دوره‌ای برای رصد پیشرفت و به‌روزرسانی برنامه‌ها در جای خودشان",
      `داشبورد پیشرفته با تاریخچهٔ ورزشی — ${toPersianDigits(days)} روز تمرین در هفته، دقیق پیگیری می‌شود`,
      "ارزان‌ترین مسیر «کامل» برای شروع اصولی — هر وقت خواستی می‌توانی ارتقا بدهی",
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();

    // ─── ممیزی 1-b#3 — سقف نرخ تحلیل آنبوردینگ (کال LLM گران؛ قبلاً هیچ
    // rate-limit ای نداشت — force=1 کش را دور می‌زد و هر بار یک کال کامل می‌زد) ───
    // force=1 → ۶ بار در ساعت؛ GET عادی → ۳۰ بار در ساعت (سبک‌تر)
    const forceRefresh = req.nextUrl.searchParams.get("force") === "1";
    const rl = forceRefresh
      ? rateLimit(`onboarding-analysis-force:${user.id}`, 6, 3600_000)
      : rateLimit(`onboarding-analysis:${user.id}`, 30, 3600_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      return Response.json({ error: "اطلاعات آنبوردینگ یافت نشد." }, { status: 400 });
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
      specialConditions: profile.specialConditions ?? undefined,
      // v75 — رشتهٔ ورزشی — در پرامپت تحلیل و توصیه‌های ماکرو لحاظ می‌شود (v95: sanitize)
      discipline: sanitizeDiscipline(profile.discipline),
      dietType: profile.dietType as OnboardingData["dietType"],
      trainingExperience: (profile.trainingExperience ?? undefined) as OnboardingData["trainingExperience"],
      previousTrainingType: profile.previousTrainingType ?? undefined,
      drugAllergies: profile.drugAllergies ?? undefined,
      currentMedications: profile.currentMedications ?? undefined,
      maxLifts: profile.maxLifts ?? undefined,
    };

    // Fetch the baseline checkup (phase 0) — اندازه‌های بدنی (chest/arm/waist/hip/thigh/neck)
    // در OnboardingProfile ذخیره نمی‌شوند؛ در چکاپ phase 0 ذخیره می‌شوند.
    // shoulder/calf فقط در OnboardingProfile ذخیره می‌شوند (فیلدهای BODY-COMPOSITION-PRO).
    const baselineCheckupForCalc = await db.checkup.findFirst({
      where: { userId: user.id, phaseNumber: 0 },
      orderBy: { createdAt: "desc" },
    });

    // ─── محاسبه ترکیب بدن (US Navy Body Fat Formula) ───
    // اگر کاربر اندازه‌های لازم را دارد، درصد چربی، جرم خالص و جرم چربی را محاسبه می‌کنیم.
    // برای محاسبه: waist + neck [+ hip for women] از چکاپ baseline + height/weight/gender از OnboardingProfile.
    const bodyComposition: BodyComposition | null = calculateBodyComposition({
      gender: data.gender,
      height: data.height,
      weight: data.weight,
      waist: baselineCheckupForCalc?.waistMeasurement ?? null,
      neck: baselineCheckupForCalc?.neckMeasurement ?? profile.neckMeasurement ?? null,
      hip: baselineCheckupForCalc?.hipMeasurement ?? null,
    });
    const muscleMass = bodyComposition
      ? calculateMuscleMassPercent({ weight: data.weight, leanBodyMass: bodyComposition.leanBodyMass })
      : null;

    // Calculate BMI, BMR, TDEE
    const heightM = data.height / 100;
    const bmi = data.weight / (heightM * heightM);

    const bmr =
      data.gender === "male"
        ? 10 * data.weight + 6.25 * data.height - 5 * data.age + 5
        : 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;

    const activityFactors: Record<string, number> = {
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
    };
    const tdee = Math.round(bmr * (activityFactors[data.activityLevel] || 1.55));

    // ─── Macro + trajectory + plan recommendations ───
    const macros = calculateMacros(data.goal, tdee, data.weight);
    const trajectory = calculateTrajectory(data.goal, data.weight, data.targetWeight, tdee);

    // Detect if user wants detailed analysis (came from onboarding with body images / blood test)
    // We don't have direct access to body images count here, so we use heuristics.
    const wantsDetailedAnalysis = !!data.maxLifts || data.trainingExperience === "pro";

    const planRecommendation = recommendPlan({
      goal: data.goal,
      experience: data.trainingExperience,
      hasInjuries: !!data.injuries,
      hasDiseases: !!data.diseases,
      wantsDetailedAnalysis,
      workoutDays: data.workoutDays,
      workoutPlace: data.workoutPlace,
      discipline: data.discipline ?? null,
    });

    // ─── AI analysis — with caching ───
    // Bypass the cache when ?force=1 is passed.
    // (ممیزی 1-b#3) پنجرهٔ کش اجباری: force تکراریِ کمتر از ۱۰ دقیقه قبل → همان
    // تحلیل کش‌شده برگردانده می‌شود نه کال جدید (سقف هزینهٔ تدافعی — نه خطا؛
    // کاربر همان متن معتبر قبلی را می‌بیند). window فقط روی force چک می‌شود تا
    // GET عادیِ کش‌خورده اشغالش نکند.
    const forceWindowOk = forceRefresh
      ? rateLimit(`onboarding-analysis-force-window:${user.id}`, 1, 10 * 60_000).ok
      : false;
    const effectiveForce = forceRefresh && forceWindowOk;

    const workoutDaysList = data.workoutDaysList ?? [];

    let analysisText = "";
    if (!effectiveForce && profile.aiAnalysis) {
      // متن‌های cache شده ممکن است کلمات چسبیده داشته باشند («کموزنی») —
      // در لحظه‌ی خواندن اصلاح می‌شوند تا کاربر همیشه متن تمیز ببیند.
      analysisText = fixPersianTypography(profile.aiAnalysis);
    } else {
      const userName = user.name || "ورزشکار";

      // ═══ v63 — پیوستن به تولیدِ در-جریان (اگر هست) ═══
      const pending = inFlightAnalysis.get(user.id);
      if (pending) {
        console.log(`[Analysis] joining in-flight generation for user=${user.id}`);
        analysisText = await pending;
      } else {
        const generation = (async (): Promise<string> => {
          try {
            const aiRaw = await createResilientCompletion(
              {
              // v58 — دیریکتیو مالک: تحلیل آنبوردینگ با deepseek-v4-flash (همان کلید AvalAI)
              model: ONBOARDING_ANALYSIS_MODEL,
              // v58 — فال‌بک صریح: اگر deepseek نشد → gemini-3.8-flash (TEXT_MODEL)
              fallback_model: TEXT_MODEL,
              messages: [
                { role: "system", content: withSystemDirectives("تو فیتاپ هوشمند هستی — مربی متخصص ورزشی و تغذیه. به زبان فارسی پاسخ بده.") },
                { role: "user", content: buildAnalysisPrompt({ data, userName, workoutDaysList, bmi, bmr, tdee, bodyComposition, muscleMass }) },
              ],
            } as any,
              { logTag: "onboarding-analysis", routeTag: "onboarding-analysis", maxTokens: 8192, timeoutMs: 120_000, maxAttempts: 2, userId: user.id }
            );
            return fixPersianTypography(aiRaw);
          } catch (err) {
            console.error("[Analysis] AI error:", err);
            return `${userName} عزیز، بر اساس اطلاعات شما:\n\nشاخص توده بدنی (BMI) شما ${bmi.toFixed(1)} است که در دسته‌بندی ${bmi < 18.5 ? "کم‌وزن" : bmi < 25 ? "وزن نرمال" : bmi < 30 ? "اضافه‌وزن" : "چاق"} قرار می‌گیرد. کالری مورد نیاز روزانه شما حدود ${tdee} کیلوکالری است.\n\nبرای رسیدن به هدف ${GOAL_LABELS[data.goal]}، توصیه می‌شود یک برنامه تمرینی و غذایی اختصاصی تهیه کنید. فیتاپ هوشمند آماده طراحی برنامه متناسب با شرایط شماست.`;
          } finally {
            // در هر حالت (موفق/فال‌بک) قفل آزاد می‌شود
            inFlightAnalysis.delete(user.id);
          }
        })();
        inFlightAnalysis.set(user.id, generation);
        analysisText = await generation;
      }

      // Cache the AI analysis for next visit (هر دو مسیر: تولیدکنندهٔ اصلی و پیوسته)
      try {
        await db.onboardingProfile.update({
          where: { userId: user.id },
          data: { aiAnalysis: analysisText },
        });
      } catch (cacheErr) {
        console.error("[Analysis] failed to cache aiAnalysis:", cacheErr);
      }
    }

    // Fetch the baseline checkup (phase 0) for body measurements
    const baselineCheckup = await db.checkup.findFirst({
      where: { userId: user.id, phaseNumber: 0 },
      orderBy: { createdAt: "desc" },
    });

    // Filter out null measurements so the client only shows what's actually present
    const measurements: Record<string, number> = {};
    if (baselineCheckup) {
      if (baselineCheckup.chestMeasurement != null) measurements.chest = baselineCheckup.chestMeasurement;
      if (baselineCheckup.armMeasurement != null) measurements.arm = baselineCheckup.armMeasurement;
      if (baselineCheckup.waistMeasurement != null) measurements.waist = baselineCheckup.waistMeasurement;
      if (baselineCheckup.hipMeasurement != null) measurements.hip = baselineCheckup.hipMeasurement;
      if (baselineCheckup.thighMeasurement != null) measurements.thigh = baselineCheckup.thighMeasurement;
      if (baselineCheckup.neckMeasurement != null) measurements.neck = baselineCheckup.neckMeasurement;
    }

    return Response.json({
      analysis: analysisText,
      bmi: Math.round(bmi * 10) / 10,
      bmr: Math.round(bmr),
      tdee,
      // ─── v15: تاریخ عضویت در فیتاپ (درخواست مالک — نمایش در آنبوردینگ/پرونده) ───
      memberSince: (user as any).createdAt ? new Date((user as any).createdAt).toISOString() : null,
      // ─── Macro recommendations ───
      macros,
      // ─── Weight goal trajectory (null if no target weight) ───
      trajectory,
      // ─── Plan recommendation based on goal + experience + medical concerns ───
      planRecommendation,
      // ─── NEW: Body composition (US Navy formula) ───
      bodyComposition: bodyComposition
        ? {
            bodyFatPercent: bodyComposition.bodyFatPercent,
            leanBodyMass: bodyComposition.leanBodyMass,
            fatMass: bodyComposition.fatMass,
            bodyFatCategory: bodyComposition.bodyFatCategory,
            bodyFatColor: bodyComposition.bodyFatColor,
            muscleMassPercent: muscleMass?.muscleMassPercent ?? null,
            muscleMass: muscleMass?.muscleMass ?? null,
          }
        : null,
      // ─── Raw profile data for display in profile overlay ───
      // تمام فیلدهای آنبوردینگ (شامل فیلدهای اختیاری حرفه‌ای) برای نمایش
      // و ویرایش در پروفایل کاربر برمی‌گردند.
      profile: {
        // Identity
        gender: data.gender,
        genderLabel: GENDER_LABELS[data.gender],
        age: data.age,
        height: data.height,
        weight: data.weight,
        targetWeight: data.targetWeight ?? null,
        goal: data.goal,
        goalLabel: GOAL_LABELS[data.goal],
        activityLevel: data.activityLevel,
        activityLabel: ACTIVITY_LABELS[data.activityLevel],
        workoutDays: data.workoutDays,
        workoutDaysList,
        workoutPlace: data.workoutPlace,
        workoutPlaceLabel: WORKOUT_PLACE_LABELS[data.workoutPlace],
        workoutTime: profile.workoutTime ?? null,
        workoutTimeLabel: profile.workoutTime
          ? (WORKOUT_TIME_LABELS as any)[profile.workoutTime] ?? profile.workoutTime
          : null,
        // Equipment
        equipment: data.equipment,
        // Diet
        dietType: data.dietType,
        dietLabel: DIET_LABELS[data.dietType],
        preferredCuisine: profile.preferredCuisine ?? null,
        preferredCuisineLabel: profile.preferredCuisine
          ? (PREFERRED_CUISINE_LABELS as any)[profile.preferredCuisine] ?? profile.preferredCuisine
          : null,
        dislikedFoods: profile.dislikedFoods ?? null,
        allergies: data.allergies,
        // Health
        injuries: data.injuries,
        diseases: data.diseases,
        specialConditions: data.specialConditions ?? null,
        drugAllergies: data.drugAllergies ?? null,
        currentMedications: data.currentMedications ?? null,
        medicalConditions: safeParseList(profile.medicalConditions),
        medicalConditionsLabel: (() => {
          const list = safeParseList(profile.medicalConditions);
          if (list.length === 0) return null;
          return list.map((c) => (MEDICAL_CONDITION_LABELS as any)[c] || c).join("، ");
        })(),
        // Recovery
        sleepHours: profile.sleepHours ?? null,
        stressLevel: profile.stressLevel ?? null,
        waterHabit: profile.waterHabit ?? null,
        waterGoalMl: profile.waterHabit != null ? profile.waterHabit * 250 : null,
        bodyFrame: profile.bodyFrame ?? null,
        bodyFrameLabel: profile.bodyFrame
          ? (BODY_FRAME_LABELS as any)[profile.bodyFrame] ?? profile.bodyFrame
          : null,
        // Training experience
        trainingExperience: data.trainingExperience ?? null,
        trainingExperienceLabel: data.trainingExperience
          ? TRAINING_EXPERIENCE_LABELS[data.trainingExperience]
          : null,
        previousTrainingType: data.previousTrainingType ?? null,
        maxLifts: data.maxLifts ?? null,
        // v75 — رشتهٔ ورزشی
        discipline: data.discipline ?? null,
        disciplineLabel: data.discipline
          ? (DISCIPLINE_LABELS as any)[data.discipline] ?? data.discipline
          : null,
        // Target date
        targetDate: profile.targetDate ?? null,
        // Supplements
        currentSupplements: profile.currentSupplements ?? null,
        // Body composition measurements
        neckMeasurement: profile.neckMeasurement ?? null,
        shoulderMeasurement: profile.shoulderMeasurement ?? null,
        calfMeasurement: profile.calfMeasurement ?? null,
      },
      // اندازه‌های اولیه بدن از چکاپ baseline (phase 0)
      baseline: baselineCheckup
        ? {
            weight: baselineCheckup.weight,
            chestMeasurement: baselineCheckup.chestMeasurement,
            armMeasurement: baselineCheckup.armMeasurement,
            waistMeasurement: baselineCheckup.waistMeasurement,
            hipMeasurement: baselineCheckup.hipMeasurement,
            thighMeasurement: baselineCheckup.thighMeasurement,
            createdAt: baselineCheckup.createdAt,
          }
        : null,
      // ─── Body measurements (filtered, only non-null) ───
      measurements,
      // ─── Whether the AI text was loaded from cache (for UI refresh button) ───
      fromCache: !effectiveForce && !!profile.aiAnalysis,
    });
  } catch (e) {
    return apiError(e);
  }
}
