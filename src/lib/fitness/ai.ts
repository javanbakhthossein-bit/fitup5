import OpenAI from "openai";
import { db } from "@/lib/db";
import type {
  OnboardingData,
  WorkoutPlanContent,
  MealPlanContent,
  Plan,
} from "./types";
import {
  GOAL_LABELS, ACTIVITY_LABELS, GENDER_LABELS, WORKOUT_PLACE_LABELS, DIET_LABELS,
  PERSIAN_WEEKDAYS, PLAN_LABELS, getCapabilities, TRAINING_EXPERIENCE_LABELS,
  BODY_FRAME_LABELS, WORKOUT_TIME_LABELS, PREFERRED_CUISINE_LABELS, MEDICAL_CONDITION_LABELS,
} from "./types";
import { bloodTestPromptSummary } from "./blood-tests";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

// AvalAI OpenAI-compatible client — lazy initialization
// در زمان build ساخته نمی‌شود تا خطای Missing credentials ندهد
let _avalaiClient: OpenAI | null = null;

export function getAvalaiClient(): OpenAI {
  if (!_avalaiClient) {
    _avalaiClient = new OpenAI({
      apiKey: process.env.AVALAI_API_KEY || "placeholder-for-build",
      baseURL: process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1",
    });
  }
  return _avalaiClient;
}

export const TEXT_MODEL = process.env.AVALAI_TEXT_MODEL || "gemini-3.5-flash";
export const VISION_MODEL = process.env.AVALAI_VISION_MODEL || "gemini-3.5-flash";

/**
 * آیا مدل از خانواده gemini-3.x است؟
 * این مدل‌ها نیاز به پارامترهای مخصوص دارند (thinkingConfig، maxOutputTokens).
 */
export function isGemini3Model(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gemini-3") || m.includes("gemini-3.5") || m.includes("gemini-3.0");
}

/**
 * Proxy هوشمند برای avalaiClient.
 *
 * این Proxy تمام کال‌های `chat.completions.create` را intercept می‌کند و به‌صورت
 * خودکار پارامترهای مخصوص gemini-3.x را اضافه می‌کند:
 *  - اگر مدل از نوع gemini-3.x باشد، max_tokens و temperature را به generationConfig
 *    منتقل می‌کند و thinkingConfig.thinkingLevel = "high" اضافه می‌کند.
 *  - برای مدل‌های دیگر، رفتار استاندارد OpenAI حفظ می‌شود.
 *
 * مهم: تابع `create` در OpenAI SDK به `this._client` وابسته است. اگر آن را bind
 * نکنیم، خطای "Cannot read properties of undefined (reading '_client')" رخ می‌دهد.
 * بنابراین `originalCreate` را قبل از wrap کردن به `completionsObj` bind می‌کنیم.
 */
function wrapCreateWithGemini3Support<T extends (...args: any[]) => any>(
  originalCreate: T,
  thisArg: any
): T {
  // bind کردن به thisArg (completions object) تا this._client در دسترس باشد
  const boundCreate = originalCreate.bind(thisArg) as T;
  return ((async (params: any, options?: any) => {
    const model: string = params?.model || TEXT_MODEL;
    const isGemini3 = isGemini3Model(model);

    if (isGemini3) {
      // برای gemini-3.x: پارامترها به generationConfig منتقل شوند
      const generationConfig: Record<string, unknown> = {
        thinkingConfig: { thinkingLevel: "high" },
      };
      if (params?.max_tokens != null) {
        generationConfig.maxOutputTokens = params.max_tokens;
      }
      if (params?.temperature != null) {
        generationConfig.temperature = params.temperature;
      }
      if (params?.top_p != null) {
        generationConfig.topP = params.top_p;
      }

      // حذف پارامترهای top-level که gemini-3.x نمی‌پذیرد
      const { max_tokens, temperature, top_p, ...rest } = params;

      // ادغام با extra_body موجود (اگر کاربر قبلاً چیزی فرستاده)
      const existingExtraBody = (params as any).extra_body || {};
      const mergedParams = {
        ...rest,
        extra_body: {
          ...existingExtraBody,
          generationConfig: {
            ...(existingExtraBody.generationConfig || {}),
            ...generationConfig,
          },
        },
      };

      return boundCreate(mergedParams, options);
    }

    // برای مدل‌های دیگر: بدون تغییر
    return boundCreate(params, options);
  }) as unknown as T);
}

// ساخت Proxy عمیق که chat.completions.create را intercept می‌کند
export const avalaiClient = new Proxy({} as OpenAI, {
  get(_, prop) {
    const client = getAvalaiClient();
    const value = (client as any)[prop];

    if (prop === "chat") {
      // Proxy برای chat
      return new Proxy(value, {
        get(__, chatProp) {
          const chatValue = (value as any)[chatProp];
          if (chatProp === "completions") {
            // Proxy برای completions
            return new Proxy(chatValue, {
              get(___, compProp) {
                const compValue = (chatValue as any)[compProp];
                if (compProp === "create" && typeof compValue === "function") {
                  // wrap create با مدیریت gemini-3.x — bind به chatValue (completions object)
                  return wrapCreateWithGemini3Support(compValue, chatValue);
                }
                return typeof compValue === "function" ? compValue.bind(chatValue) : compValue;
              },
            });
          }
          return typeof chatValue === "function" ? chatValue.bind(value) : chatValue;
        },
      });
    }

    return typeof value === "function" ? value.bind(client) : value;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT-PLAN-PRO — تایپ‌های توسعه‌یافته برای برنامه‌های حرفه‌ای
// این فیلدها به صورت اختیاری به WorkoutPlanContent / MealPlanContent اضافه می‌شوند
// تا برنامه‌ها در سطح مربیان بزرگ دنیا (هانی رامبد، هادی چوپان، کریس بامستد) تولید شوند.
// ─────────────────────────────────────────────────────────────────────────────

/** تایپ توسعه‌یافته برنامه تمرینی — شامل فیلدهای حرفه‌ای جدید */
export type ProWorkoutPlanContent = WorkoutPlanContent & {
  /** تکنیک‌های پیشرفته استفاده‌شده در برنامه (FST-7، سوپرست آنتاگونیست، تری‌ست، دراپ‌ست، رست پاز، و ...) */
  advancedTechniques?: string[];
  /** تقسیم عضلات هفته (push/pull/legs، upper/lower، body part split، push/pull/legs/rest، و ...) */
  muscleGroupSplit?: string;
  /** جزئیات FST-7 (Fascia Stretch Training) در حرکت آخر هر گروه عضلانی — ویژه پلن ultimate */
  fst7Details?: {
    exerciseName: string;
    sets: number;
    reps: string;
    restSec: number;
    note?: string;
  };
  /** نوع دوره‌بندی (Periodization) */
  periodizationType?: "linear" | "undulating" | "block" | "wave" | "daily_undulating";
  /** فرکانس تمرین هر گروه عضلانی در هفته (۱-۳) */
  muscleFrequencyPerWeek?: number;
  /** الهام‌گرفته از کدام مربی بزرگ */
  inspiredByCoach?: "hany_rambod" | "hadi_chupan" | "chris_bumstead" | "mixed";
};

/** تایپ توسعه‌یافته برنامه غذایی — شامل فیلدهای حرفه‌ای جدید */
export type ProMealPlanContent = MealPlanContent & {
  /** تفکیک دقیق محاسبه TDEE و مازاد/نقصان کالری */
  tdeeBreakdown?: {
    bmr: number;
    tdee: number;
    targetCalories: number;
    /** مازاد کالری (مثبت) یا نقصان (منفی) */
    calorieAdjustment: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    /** پروتئین به ازای هر کیلوگرم وزن بدن */
    proteinPerKg: number;
    /** کربوهیدرات به ازای هر کیلوگرم وزن بدن */
    carbsPerKg: number;
    /** چربی به ازای هر کیلوگرم وزن بدن */
    fatPerKg: number;
  };
  /** جایگزین‌های رژیمی (وگان، کتو، کم‌کربوهیدرات، بدون گلوتن، و ...) برای هر وعده */
  dietAlternatives?: {
    diet: string;
    description: string;
    sampleMeals: string[];
  }[];
  /** استک مکمل پیشرفته — دسته‌بندی‌شده به پایه/پیشرفته/هدفمند */
  supplementStack?: {
    category: "base" | "advanced" | "targeted";
    name: string;
    dose: string;
    timing: string;
    note?: string;
    /** افراد منع‌شده از مصرف این مکمل (بیماران قلبی، دیابتی، و ...) */
    contraindicatedFor?: string[];
  }[];
};

// ─── ضریب فعالیت برای محاسبه دقیق TDEE ───
// بر اساس فرمول‌های استاندارد Harris-Benedict و Mifflin-St Jeor
function getActivityMultiplier(activityLevel?: OnboardingData["activityLevel"]): number {
  switch (activityLevel) {
    case "sedentary":
      return 1.2;   // بی‌تحرک (کار پشت میز، بدون تمرین)
    case "light":
      return 1.375; // کم‌تحرک (تمرین ۱-۳ روز در هفته)
    case "moderate":
      return 1.55;  // متوسط (تمرین ۳-۵ روز در هفته)
    case "active":
      return 1.725; // فعال (تمرین ۶-۷ روز در هفته)
    case "very_active":
      return 1.9;   // خیلی فعال (تمرین سنگین روزانه + کار فیزیکی)
    default:
      return 1.4;   // پیش‌فرض محافظه‌کارانه
  }
}

// ─── راهنمای تکنیک‌های پیشرفته بر اساس سطح پلن ───
// این تابع تعیین می‌کند کاربر بر اساس پلن اشتراکش به چه تکنیک‌های حرفه‌ای دسترسی دارد.
// - ultimate (حرفه‌ای): FST-7 هانی رامبد + دوره‌بندی موجی + ۸-۱۰ حرکت
// - advanced (پیشرفته): سوپرست‌های آنتاگونیست + دراپ‌ست + ۷-۸ حرکت
// - standard (استاندارد): تمرینات پایه با رعایت فرم + ۶-۷ حرکت
// - basic (اقتصادی): تمرینات ساده و مؤثر + ۵-۶ حرکت
// ─── تکنیک‌های تمرینی بر اساس سابقه ورزشکار (نه پلن) ───
// ⚠️ مهم: کیفیت برنامه تمرینی بر اساس سابقه کاربر تعیین می‌شود، نه پلن خریداری‌شده.
// یک ورزشکار حرفه‌ای که پلن اقتصادی می‌خرد باید همان کیفیت برنامه حرفه‌ای را دریافت کند.
// پلن فقط قابلیت‌ها (مکمل، آنالیز ویدیو و غیره) را کنترل می‌کند، نه کیفیت برنامه را.
function getExperienceBasedTechniqueGuidance(experience?: string): {
  level: "beginner" | "intermediate" | "advanced" | "pro";
  allowedTechniques: string[];
  forbiddenTechniques: string[];
  proCoachInspiration: string;
  exerciseCountHint: string;
  periodization: string;
} {
  switch (experience) {
    case "pro":
      return {
        level: "pro",
        allowedTechniques: [
          "FST-7 (Fascia Stretch Training) در حرکت آخر هر گروه عضلانی",
          "دوره‌بندی موجی (Undulating Periodization) — تغییرات حجم/شدت در روزهای مختلف",
          "سوپرست آنتاگونیست (push/pull)",
          "تری‌ست همان گروه عضلانی",
          "جاینت‌ست برای چربی‌سوزی",
          "دراپ‌ست در ست آخر",
          "رست پاز (pause reps)",
          "تدریجی اضافه بار (Progressive Overload)",
          "تکنیک ۱.۵ تکراری (1.5 reps)",
          "Negative-accentuated reps",
          "Blood Flow Restriction (BFR)",
          "Rest-Pause extended sets",
        ],
        forbiddenTechniques: [],
        proCoachInspiration:
          "هانی رامبد (FST-7) + هادی چوپان (فرکانس بالا) + کریس بامستد (ارتباط ذهن-عضله)",
        exerciseCountHint: "۸ تا ۱۰ حرکت در هر روز",
        periodization: "undulating",
      };
    case "advanced":
      return {
        level: "advanced",
        allowedTechniques: [
          "FST-7 (Fascia Stretch Training) در حرکت آخر گروه‌های عضلانی بزرگ",
          "دوره‌بندی موجی (Undulating Periodization)",
          "سوپرست آنتاگونیست (push/pull)",
          "تری‌ست همان گروه عضلانی",
          "جاینت‌ست برای چربی‌سوزی",
          "دراپ‌ست در ست آخر",
          "رست پاز (pause reps)",
          "تدریجی اضافه بار (Progressive Overload)",
          "تکنیک ۱.۵ تکراری (1.5 reps)",
        ],
        forbiddenTechniques: [],
        proCoachInspiration:
          "هانی رامبد (FST-7) + هادی چوپان (فرکانس بالا) + کریس بامستد (ارتباط ذهن-عضله)",
        exerciseCountHint: "۷ تا ۸ حرکت در هر روز",
        periodization: "undulating",
      };
    case "intermediate":
      return {
        level: "intermediate",
        allowedTechniques: [
          "سوپرست آنتاگونیست (push/pull)",
          "تری‌ست همان گروه عضلانی",
          "دراپ‌ست در ست آخر حرکات کمکی",
          "رست پاز (pause reps)",
          "تدریجی اضافه بار (Progressive Overload)",
          "تکنیک ۱.۵ تکراری (1.5 reps)",
        ],
        forbiddenTechniques: [
          "FST-7 (نیازمند سابقه پیشرفته)",
        ],
        proCoachInspiration: "کریس بامستد (فرم + ارتباط ذهن-عضله) + هادی چوپان (حجم بالا)",
        exerciseCountHint: "۶ تا ۷ حرکت در هر روز",
        periodization: "linear",
      };
    case "beginner":
    default:
      return {
        level: "beginner",
        allowedTechniques: [
          "تدریجی اضافه بار (Progressive Overload) — ملایم",
          "رست پاز ساده (pause reps)",
          "سوپرست آنتاگونیست ساده (push/pull) — حداکثر ۱ در هر روز",
        ],
        forbiddenTechniques: [
          "FST-7",
          "دوره‌بندی موجی",
          "تری‌ست و جاینت‌ست",
          "دراپ‌ست",
          "BFR",
        ],
        proCoachInspiration: "یادگیری الگوهای حرکتی پایه و تثبیت فرم صحیح — کریس بامستد (ارتباط ذهن-عضله)",
        exerciseCountHint: "۵ تا ۶ حرکت در هر روز",
        periodization: "linear",
      };
  }
}

// backward compat — نگه داشتن نام قدیمی برای جلوگیری از خطا
function getPlanTierTechniqueGuidance(planName?: Plan | null, experience?: string) {
  return getExperienceBasedTechniqueGuidance(experience);
}

// ─── محاسبه دقیق TDEE و کالری هدف بر اساس هدف و فعالیت ───
function computeTDEEAndTarget(data: OnboardingData): {
  bmr: number;
  tdee: number;
  targetCalories: number;
  calorieAdjustment: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPerKg: number;
  carbsPerKg: number;
  fatPerKg: number;
} {
  // فرمول Mifflin-St Jeor (دقیق‌ترین فرمول BMR)
  const bmr =
    data.gender === "male"
      ? 10 * data.weight + 6.25 * data.height - 5 * data.age + 5
      : 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
  const activityMultiplier = getActivityMultiplier(data.activityLevel);
  const tdee = bmr * activityMultiplier;

  // تنظیم کالری بر اساس هدف — مازاد/نقصان هوشمند
  let calorieAdjustment = 0;
  switch (data.goal) {
    case "fat_loss":
      // نقصان ۴۰۰-۵۰۰ کالری برای چربی‌سوزی ایمن (۰.۵ کیلو در هفته)
      calorieAdjustment = -Math.min(500, Math.round(tdee * 0.2));
      break;
    case "muscle_gain":
      // مازاد ۲۵۰-۴۰۰ کالری برای حجم‌گیری تمیز (به حداقل رساندن چربی‌سازی)
      calorieAdjustment = 300;
      break;
    case "strength":
      // مازاد ملایم ۲۰۰ کالری برای قدرت
      calorieAdjustment = 200;
      break;
    case "endurance":
      // تعادل با کمی مازاد برای ریکاوری
      calorieAdjustment = 100;
      break;
    case "fitness":
    default:
      calorieAdjustment = 0;
      break;
  }
  const targetCalories = Math.round(tdee + calorieAdjustment);

  // محاسبه درشت‌مغذی‌ها — پروتئین بر اساس هدف، چربی ۲۵٪، کربوهیدرات باقی‌مانده
  const proteinPerKg = data.goal === "fat_loss" ? 2.2 : data.goal === "muscle_gain" ? 2.0 : 1.8;
  const proteinG = Math.round(data.weight * proteinPerKg);
  const fatG = Math.round((targetCalories * 0.25) / 9); // ۲۵٪ کالری از چربی
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));
  const carbsPerKg = Math.round((carbsG / data.weight) * 10) / 10;
  const fatPerKg = Math.round((fatG / data.weight) * 10) / 10;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetCalories,
    calorieAdjustment,
    proteinG,
    carbsG,
    fatG,
    proteinPerKg,
    carbsPerKg,
    fatPerKg,
  };
}

// Get AI config from DB (admin-configurable system prompts)
export async function getAiConfig(key: string, fallback: string): Promise<string> {
  const cfg = await db.aiConfig.findUnique({ where: { key } });
  return cfg?.value || fallback;
}

// قوانین زبان فارسی — در پرامپت‌های مربی و چت برای جلوگیری از استفاده کلمات انگلیسی تزریق می‌شود.
// این بلوک به DEFAULT_COACH_PROMPT و DEFAULT_CHAT_PROMPT اضافه می‌شود.
const PERSIAN_LANGUAGE_RULES = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قوانین زبان (بسیار مهم):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- همیشه فقط فارسی بنویس. استفاده از کلمات انگلیسی ممنوع است.
- به جای کلمات انگلیسی، معادل فارسی آن‌ها را استفاده کن:
  • Gym Mode → حالت باشگاه
  • TDEE → نیاز کالری روزانه
  • PWA → برنامه نصب‌شده
  • cardio → هوازی
  • superset → سوپرست (به فارسی)
  • triset → تری‌ست (به فارسی)
  • warmup → گرم‌کردن
  • cooldown → سردکردن
  • set → ست
  • rep → تکرار
  • rest → استراحت
  • workout → تمرین
  • body fat → چربی بدن
  • metabolism → متابولیسم
  • plateau → ثبات/سکون
  • bulk → حجم‌گیری
  • cut → کات/چربی‌سوزی
  • cheat meal → وعده آزاد
  • RPE → شدت درک‌شده
  • RIR → تکرار ذخیره
  • DOMS → درد عضلانی تاخیری
- فقط نام حرکات ورزشی و اصطلاحات تخصصی که معادل فارسی ندارند را می‌توانی به انگلیسی بنویسی (مثل squat, deadlift, bench press) اما بلافاصله معادل فارسی یا توضیح آن را در پرانتز اضافه کن.`;

// Default system prompts (used if admin hasn't configured)
export const DEFAULT_COACH_PROMPT = `تو مربی هوشمند فیتاپ هستی — یک مربی متخصص و تمام‌عیار ورزشی، رژیدرمانی و مکمل‌ها. کاملاً به زبان فارسی و با لحنی حرفه‌ای، علمی، جدی و انگیزشی پاسخ می‌دهی. تو به تمام داده‌های آنبوردینگ ورزشکار (سن، قد، وزن، هدف، سطح فعالیت، آسیب‌دیدگی‌ها، رژیم غذایی، آلرژی‌ها، آزمایش خون) دسترسی کامل داری و بر اساس آن‌ها صحبت می‌کنی. قابلیت‌های تو: ارائه برنامه‌های تمرینی هفتگی، تجویز دقیق کالری و درشت‌مغذی‌ها، معرفی مکمل‌ها با دوز مصرف، و پاسخ به سوالات فنی تمرینات. همیشه نکات ایمنی را رعایت کن و در صورت نیاز هشدار پزشکی بده.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
آشنایی کامل با پلتفرم فیتاپ (بسیار مهم):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
تو باید با تمام قابلیت‌های فیتاپ آشنا باشی تا کاربران را دقیق راهنمایی کنی:

۱. برنامه تمرینی هوشمند:
- برنامه‌ها ۴۵ روزه با فازهای مختلف هستند
- پشتیبانی از سوپرست و تریست
- تایمر استراحت هوشمند بین ست‌ها
- ثبت وزنه و تعداد تکرار
- پیشرفت تدریجی وزنه‌ها
- امکان جایگزینی حرکت برای آسیب‌دیدگی

۲. برنامه غذایی و مکمل:
- برنامه غذایی شخصی‌سازی‌شده با کالری هدف
- غذاهای جایگزین ایرانی و در دسترس
- برنامه مکمل ایمن و علمی
- ترکیب وعده‌های غذایی

۳. چت با مربی هوشمند (همین چت):
- ارسال متن، عکس و ویدیو
- تحلیل هوشمند عکس غذا (کالری، درشت‌مغذی‌ها)
- تحلیل عکس بدن و فرم ورزشی
- پاسخ به سوالات فنی

۴. آنالیز هوشمند:
- آنالیز وعده غذایی با عکس (برای پلن پیشرفته+)
- آنالیز بدن با عکس (برای پلن پیشرفته+)
- آنالیز ویدیویی بدن (برای پلن حرفه‌ای)
- تحلیل آزمایش خون ۴۷ ماده (برای پلن حرفه‌ای)
- اصلاح تکنیک حرکات با ویدیو (برای پلن حرفه‌ای)

۵. پیگیری پیشرفت:
- ثبت وزن روزانه با نمودار
- ثبت اندازه‌های بدن (کمر، بازو، سینه، باسن)
- گالری تصاویر پیشرفت (Before/After)
- چکاپ‌های دوره‌ای (برای پلن استاندارد+)

۶. حالت باشگاه (Gym Mode):
- نمایش برنامه تمرین روز
- تایمر استراحت
- ثبت وزنه و ست‌ها
- فقط برای پلن پیشرفته+

۷. ابزارهای رایگان (بدون اشتراک):
- محاسبه‌گر کالری (TDEE)
- بانک حرکات ورزشی (۲۵۰+ حرکت با آموزش)
- جدول کالری غذاها (۱۰۰۰+ غذای سالم)

۸. پلن‌های اشتراک (قیمت‌ها ممکن است تغییر کند):
- اقتصادی: برنامه تمرین + تغذیه (۴۵ روزه)
- استاندارد: + مکمل + چکاپ دوره‌ای
- پیشرفته: + چت بی‌نهایت + آنالیز عکس + Gym Mode
- حرفه‌ای: + آنالیز ویدیو + آزمایش خون + پشتیبانی اختصاصی

۹. سایر قابلیت‌ها:
- کیف پول (شارژ و استفاده برای خرید)
- کدهای تخفیف عمومی و اختصاصی
- سیستم معرفی دوستان (رفرال) با کد اختصاصی
- نوتیفیکیشن‌های هوشمند (یادآوری تمرین، آب، تغذیه)
- نصب روی گوشی (PWA) — حتی با بسته بودن اپ نوتیف می‌آید
- پرداخت امن زرین‌پال
- مقالات تخصصی بدنسازی و تغذیه

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قوانین پاسخ‌گویی:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- اگر کاربر درباره قابلیتی سوال کرد، دقیق توضیح بده و در کدام پلن موجود است
- اگر کاربر می‌خواهد برنامه‌اش را تغییر دهد، راهنمایی‌اش کن
- اگر کاربر از آسیب‌دیدگی می‌گوید، حرکات جایگزین پیشنهاد بده
- برای سوالات تغذیه، از غذاهای ایرانی و در دسترس استفاده کن
- همیشه نکات ایمنی را رعایت کن
- در صورت نیاز هشدار پزشکی بده
- شعار ما: هر بدنی فیتاپ میخواد!

قوانین علمی مکمل‌ها (بسیار مهم):
- مکمل‌ها باید بر اساس آخرین تحقیقات علمی و ایمن باشند.
- دوز مکمل‌ها باید در محدوده ایمن و توصیه‌شده باشد. هرگز دوز بالا تجویز نکن.
- ویتامین D: حداکثر ۱۰۰۰-۲۰۰۰ واحد بین‌المللی در روز (نه ۲۰۰۰ واحد ۳ بار در روز!). دوز بالای ویتامین D سم‌زا است.
- ویتامین D soluble در چربی است و در بدن ذخیره می‌شود — نیازی به دوز بالا نیست.
- کراتین مونوهیدرات: ۳-۵ گرم در روز (بدون فاز بارگیری ضروری نیست).
- پروتئین وی: ۲۵-۳۰ گرم در وعده (نه بیشتر از ۵۰ گرم).
- امگا ۳: ۱-۲ گرم در روز.
- مولتی‌ویتامین: ۱ قرص در روز.
- از تجویز مکمل‌های خطرناک یا هورمونی به‌شدت پرهیز کن.
- همیشه در بخش note بنویس: "قبل از شروع مکمل با پزشک مشورت کنید."

قوانین نکات هفته (notes):
- نکات هفته باید انگیزشی، علمی و کاربردی باشند.
- شامل ۳-۴ نکته کوتاه و جذاب درباره پیشرفت، تغذیه، استراحت و انگیزه باشد.
- از ایموجی‌های مرتبط استفاده کن (🔥💪🎯⚡).
- لحن مثبت و تشویق‌کننده داشته باش.

${PERSIAN_LANGUAGE_RULES}`;

export const DEFAULT_CHAT_PROMPT = `تو مربی هوشمند فیتاپ هستی — یک مربی متخصص و حرفه‌ای ورزشی، تغذیه و مکمل‌ها. به زبان فارسی و با لحن علمی، جدی و انگیزشی پاسخ می‌دهی.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
آشنایی کامل با پلتفرم فیتاپ:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
تو باید با تمام قابلیت‌های فیتاپ آشنا باشی:

۱. برنامه تمرینی: ۴۵ روزه، سوپرست/تریست، تایمر استراحت، ثبت وزنه، پیشرفت تدریجی
۲. برنامه غذایی: شخصی‌سازی‌شده با کالری هدف، غذاهای ایرانی، برنامه مکمل ایمن
۳. چت با مربی (همینجا): ارسال متن/عکس/ویدیو، تحلیل غذا و بدن با عکس
۴. آنالیز هوشمند: عکس غذا (پیشرفته+)، عکس بدن (پیشرفته+)، ویدیو بدن (حرفه‌ای)، آزمایش خون (حرفه‌ای)
۵. پیگیری پیشرفت: ثبت وزن، اندازه‌ها، گالری تصاویر، چکاپ دوره‌ای
۶. حالت باشگاه (Gym Mode): برنامه روز، تایمر، ثبت ست (پیشرفته+)
۷. ابزارهای رایگان: محاسبه‌گر TDEE، بانک ۲۵۰+ حرکت، جدول ۱۰۰۰+ غذای سالم
۸. پلن‌ها: اقتصادی، استاندارد، پیشرفته، حرفه‌ای (قیمت‌ها در سایت قابل تغییر است)
۹. سایر: کیف پول، کد تخفیف، معرفی دوستان، نوتیف هوشمند، PWA، پرداخت زرین‌پال، مقالات

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قوانین پاسخ‌گویی:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- به تمام داده‌های آنبوردینگ ورزشکار (سن، قد، وزن، هدف، سطح فعالیت، آسیب‌دیدگی‌ها، رژیم غذایی، آلرژی‌ها) دسترسی داری
- اگر کاربر درباره قابلیتی سوال کرد، دقیق توضیح بده و در کدام پلن موجود است
- برای آسیب‌دیدگی، حرکات جایگزین پیشنهاد بده
- از غذاهای ایرانی و در دسترس استفاده کن
- همیشه نکات ایمنی را رعایت کن
- شعار ما: هر بدنی فیتاپ میخواد!

قوانین علمی مکمل‌ها:
- ویتامین D: ۱۰۰۰-۲۰۰۰ واحد در روز (دوز بالا سم‌زا است)
- کراتین مونوهیدرات: ۳-۵ گرم در روز
- پروتئین وی: ۲۵-۳۰ گرم در وعده
- امگا ۳: ۱-۲ گرم در روز
- مولتی‌ویتامین: ۱ قرص در روز
- از مکمل‌های خطرناک یا هورمونی پرهیز کن
- همیشه بنویس: "قبل از شروع مکمل با پزشک مشورت کنید."

${PERSIAN_LANGUAGE_RULES}`;

export const DEFAULT_NUTRITION_PROMPT = `تو متخصص تغذیه و مربی هوشمند فیتاپ هستی. برنامه غذایی کاملاً شخصی‌سازی‌شده به زبان فارسی ارائه بده و درشت‌مغذی‌ها را دقیق محاسبه کن.

قوانین علمی مکمل‌ها (بسیار مهم):
- مکمل‌ها باید بر اساس آخرین تحقیقات علمی و ایمن باشند.
- دوز مکمل‌ها باید در محدوده ایمن و توصیه‌شده باشد. هرگز دوز بالا تجویز نکن.
- ویتامین D: حداکثر ۱۰۰۰-۲۰۰۰ واحد بین‌المللی در روز. دوز بالای ویتامین D سم‌زا است.
- کراتین مونوهیدرات: ۳-۵ گرم در روز.
- پروتئین وی: ۲۵-۳۰ گرم در وعده.
- امگا ۳: ۱-۲ گرم در روز.
- مولتی‌ویتامین: ۱ قرص در روز.
- از تجویز مکمل‌های خطرناک یا هورمونی به‌شدت پرهیز کن.
- همیشه در بخش note بنویس: "قبل از شروع مکمل با پزشک مشورت کنید."`;

/** پرامپت نیکا — کارشناس فروش فوق‌حرفه‌ای و راهنمای کامل پلتفرم فیتاپ */
export const DEFAULT_NIKA_PROMPT = `تو «نیکا» هستی — کارشناس تخصصی فروش و راهنمای کامل پلتفرم فیتاپ. نام پلتفرم همیشه و فقط «فیتاپ» به فارسی نوشته می‌شود. هرگز کلمه FitUp یا fitup به انگلیسی ننویس.

شخصیت تو:
- صمیمی، دوستانه، خوش‌برخورد و مشکل‌گشا
- حرفه‌ای و تخصصی — به تمام امکانات فیتاپ کاملاً مسلطی و دانش دقیق داری
- همیشه مشتاق کمک و انگیزه‌بخش
- از ایموجی‌های مناسب استفاده کن (🌟💡✨💪🔥)
- پاسخ‌هایت را کوتاه، دقیق و مفید نگه دار — حداکثر ۳-۴ پاراگراف، مستقیم به نقطه برس

قوانین طلایی:
۱. تو به هیچ عنوان برنامه تمرینی یا رژیم غذایی شخصی تجویز نمی‌کنی. این کار مخصوص «فیتاپ هوشمند» (مربی هوشمند داخل پنل کاربر) است. اگر کاربر برنامه اختصاصی خواست، او را به خرید پلن پیشرفته یا حرفه‌ای راهنمایی کن.
۲. هرگز هیچ کد تخفیفی به کاربر ارائه نده. اگر کاربر درباره تخفیف پرسید، بگو: «تخفیف‌های ویژه به صورت خودکار در حساب کاربری شما اعمال می‌شوند، نیازی به کد ندارید.»
۳. هرگز قابلیت یا امکانی که در فیتاپ وجود ندارد را نساز. فقط درباره امکانات واقعی زیر صحبت کن.
۴. درباره هر پلن، قیمت و امکانات دقیق را بگو — از کلی‌گویی و حرف بازاریابی خالی پرهیز کن. تفاوت‌ها را مشخص کن.
۵. هرگز URL یا آدرس اینترنتی به کاربر نده — به جای آن از فرمت لینک درون‌برنامه‌ای زیر استفاده کن.

📌 لینک‌دهی درون‌برنامه‌ای (بسیار مهم — همیشه این کار را بکن):
وقتی می‌خواهی کاربر را به بخشی از فیتاپ راهنمایی کنی، حتماً و فقط از این فرمت استفاده کن:
[متن لینک](action:screen_name)
screen_name فقط و فقط یکی از این مقادیر مجاز است:
- landing → صفحه اصلی فیتاپ
- auth → ثبت‌نام یا ورود کاربر
- tool-tdee → محاسبه‌گر کالری و TDEE
- tool-exercises → بانک حرکات ورزشی
- tool-foods → جدول کالری غذاها
- articles → مقالات ورزشی فیتاپ
- plans → مشاهده و خرید پلن‌ها (Overlay اشتراک)

مثال درست: «می‌تونی [محاسبه کالری روزانه](action:tool-tdee) رو امتحان کنی.»
مثال درست: «برای دیدن پلن‌ها روی [مشاهده پلن‌ها](action:plans) کلیک کن.»
مثال غلط: «برو به آدرس fitap.ir/plans» (هیچ URL خارجی نده!)
مثال غلط: «برو به صفحه محاسبه کالری» (بدون فرمت لینک، کلیک نمی‌شود!)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
دانش کامل تو درباره پلتفرم فیتاپ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔹 ۴ پلن اشتراک (همه ۴۵ روزه، شامل ۱ فاز تمرینی کامل):

۱) پلن اقتصادی — ۳۵۰,۰۰۰ تومان
   ✓ آنالیز پروفایل ورزشکار
   ✓ برنامه تمرینی هفتگی شخصی‌سازی‌شده
   ✓ برنامه تغذیه روزانه با ترکیب وعده و جایگزین‌ها
   ✓ پیگیری وزن
   ✗ بدون چت با مربی هوشمند
   ✗ بدون برنامه مکمل
   مناسب: کسی که برنامه پایه می‌خواهد و خودش مدیریت می‌کند.

۲) پلن استاندارد — ۸۰۰,۰۰۰ تومان
   ✓ همه امکانات پلن اقتصادی
   ✓ برنامه مکمل ورزشی با دوز ایمن و علمی
   ✓ ۳ چکاپ دوره‌ای (هر ۱۵ روز)
   ✓ داشبورد پیشرفته با نمودار
   ✗ بدون چت با مربی هوشمند
   مناسب: ورزشکار جدی که مکمل و چکاپ دوره‌ای هم می‌خواهد.

۳) پلن پیشرفته — ۱,۲۰۰,۰۰۰ تومان (پیشنهاد ویژه 🔥)
   ✓ همه امکانات پلن استاندارد
   ✓ چت بی‌نهایت با «فیتاپ هوشمند» (مربی AI ۲۴/۷)
   ✓ آنالیز عکس غذا (عکس بگیر، کالری و درشت‌مغذی‌ها را بگو)
   ✓ آنالیز عکس بدن (پیگیری پیشرفت ظاهری)
   ✓ حالت باشگاه (Gym Mode) با تایمر استراحت و ثبت ست
   ✓ دستیار تغذیه با ترکیب وعده و غذاهای جایگزین
   ✓ کتابخانه ویدیو حرکات
   مناسب: کسی که مربی همیشه در دسترس می‌خواهد.

۴) پلن حرفه‌ای — ۱,۸۰۰,۰۰۰ تومان (کامل‌ترین 🏆)
   ✓ همه امکانات پلن پیشرفته
   ✓ ارسال ویدیو تمرین + آنالیز ویدیویی بدن توسط AI
   ✓ اصلاح تکنیک حرکات
   ✓ تحلیل آزمایش خون (عکس آزمایش بگیر، تحلیل کن)
   ✓ پشتیبانی اختصاصی و کامل‌ترین همراهی
   مناسب: ورزشکار حرفه‌ای که کامل‌ترین همراهی می‌خواهد.

→ برای مشاهده و خرید پلن‌ها همیشه از: [مشاهده پلن‌ها](action:plans)
→ برای ثبت‌نام کاربر جدید: [ورود/ثبت‌نام](action:auth)

🔹 ابزارهای رایگان فیتاپ (بدون نیاز به اشتراک):
• [محاسبه‌گر کالری و TDEE](action:tool-tdee) — محاسبه دقیق BMR، TDEE و کالری هدف بر اساس سن، جنسیت، وزن، قد و سطح فعالیت.
• [بانک حرکات ورزشی](action:tool-exercises) — لیست کامل حرکات با توضیح نحوه انجام، نکات ایمنی، عضله هدف و سطح دشواری.
• [جدول کالری غذاها](action:tool-foods) — شاخص کالری، پروتئین، کربوهیدرات و چربی صدها غذا ایرانی و بین‌المللی.

🔹 بخش مقالات ورزشی:
کاربران می‌توانند [مقالات تخصصی فیتاپ](action:articles) را بخوانند — راهنماهای جامع درباره برنامه بدنسازی، برنامه تغذیه، مکمل‌های ورزشی، کاهش وزن و عضله‌سازی. کاملاً رایگان و بدون نیاز به ثبت‌نام.

🔹 قابلیت‌های پیشرفته داخل پنل کاربر (نیازمند پلن پیشرفته یا حرفه‌ای):
• مربی هوشمند: چت ۲۴/۷ با AI که به داده‌های آنبوردینگ شما دسترسی دارد و به سوالات تخصصی تمرین و تغذیه پاسخ می‌دهد.
• حالت باشگاه (Gym Mode): تایمر استراحت بین ست‌ها، ثبت وزنه و تکرار، و موسیقی انگیزشی.
• تحلیل عکس غذا: عکس غذای خود را بگیرید، هوش مصنوعی کالری و درشت‌مغذی‌ها را محاسبه می‌کند.
• تحلیل عکس بدن: عکس پیشرفت بگیرید و تغییرات ظاهری را پیگیری کنید.
• تحلیل ویدیویی بدن (مخصوص پلن حرفه‌ای): ویدیو تمرین بفرستید، فرم حرکت اصلاح می‌شود.
• تحلیل آزمایش خون (مخصوص پلن حرفه‌ای): عکس آزمایش خون بگیرید، تحلیل تخصصی دریافت کنید.

وقتی کاربر سوال تخصصی تمرین یا تغذیه می‌پرسد، تو فقط اطلاعات کلی و علمی می‌دهی و او را به [مشاهده پلن‌ها](action:plans) دعوت می‌کنی تا از مربی هوشمند استفاده کند.

شعار ما: هر بدنی فیتاپ میخواد! 🌟`;


// Build user context string from onboarding + plan tier
export function buildUserContext(data: OnboardingData, planName?: Plan | null): string {
  const bmr =
    data.gender === "male"
      ? 10 * data.weight + 6.25 * data.height - 5 * data.age + 5
      : 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
  const caps = getCapabilities(planName ?? null);
  const planLabel = planName ? PLAN_LABELS[planName] : "بدون پلن (Basic)";

  // --- NEW: Comprehensive professional context lines ---
  const medicalConditionsList = Array.isArray(data.medicalConditions) && data.medicalConditions.length > 0
    ? data.medicalConditions.map((c) => MEDICAL_CONDITION_LABELS[c] || c).join("، ")
    : "";

  const hasMedicalConditions = !!medicalConditionsList;
  const hasInjuries = !!data.injuries && data.injuries.trim().length > 0;
  const hasLowSleep = typeof data.sleepHours === "number" && data.sleepHours < 7;
  const hasHighStress = typeof data.stressLevel === "number" && data.stressLevel >= 4;

  // Target date context (timeline planning)
  let targetDateContext = "";
  if (data.targetDate) {
    try {
      const d = new Date(data.targetDate);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const daysLeft = Math.max(1, Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        targetDateContext = `\n- تاریخ هدف: ${data.targetDate} (حدود ${daysLeft} روز مانده)`;
      }
    } catch {
      targetDateContext = `\n- تاریخ هدف: ${data.targetDate}`;
    }
  }

  return `اطلاعات کاربر:
- جنسیت: ${GENDER_LABELS[data.gender]}
- سن: ${data.age} سال
- قد: ${data.height} سانتی‌متر
- وزن: ${data.weight} کیلوگرم
- وزن هدف: ${data.targetWeight ?? "نامشخص"} کیلوگرم${targetDateContext}
- هدف اصلی: ${GOAL_LABELS[data.goal]}
- سطح فعالیت: ${ACTIVITY_LABELS[data.activityLevel]}
- روزهای تمرین در هفته: ${data.workoutDays} روز${data.workoutDaysList && data.workoutDaysList.length > 0 ? ` (${data.workoutDaysList.join("، ")})` : ""}
- مکان تمرین: ${WORKOUT_PLACE_LABELS[data.workoutPlace]}
- تجهیزات: ${data.equipment.length ? data.equipment.join("، ") : "بدون تجهیزات خاص"}
- سوابق بیماری: ${data.diseases || "ندارد"}
- آسیب‌دیدگی مفصلی/عضلانی: ${data.injuries || "ندارد"}
- حساسیت غذایی: ${data.allergies || "ندارد"}
- نوع رژیم غذایی: ${DIET_LABELS[data.dietType]}
${data.trainingExperience ? `- سابقه ورزشی: ${TRAINING_EXPERIENCE_LABELS[data.trainingExperience]}` : ""}
${data.previousTrainingType ? `- نوع تمرین قبلی: ${data.previousTrainingType}` : ""}
${data.drugAllergies ? `- آلرژی‌های دارویی: ${data.drugAllergies}` : ""}
${data.currentMedications ? `- داروهای مصرفی: ${data.currentMedications}` : ""}
${data.maxLifts ? `- حداکثر وزنه‌ها: ${data.maxLifts}` : ""}
${data.bodyFrame ? `- اندازه استخوان بدن (Body Frame): ${BODY_FRAME_LABELS[data.bodyFrame]}` : ""}
${typeof data.sleepHours === "number" ? `- میانگین خواب شبانه: ${data.sleepHours} ساعت${hasLowSleep ? " ⚠️ کمتر از حد مطلوب" : ""}` : ""}
${typeof data.stressLevel === "number" ? `- سطح استرس روزانه: ${data.stressLevel} از ۵${hasHighStress ? " ⚠️ بالا — روی ریکاوری اثر منفی" : ""}` : ""}
${typeof data.waterHabit === "number" ? `- عادت فعلی نوشیدن آب: ${data.waterHabit} لیوان در روز` : ""}
${data.workoutTime ? `- ساعت ترجیحی تمرین: ${WORKOUT_TIME_LABELS[data.workoutTime]}` : ""}
${medicalConditionsList ? `- شرایط پزشکی خاص: ${medicalConditionsList}` : ""}
${data.currentSupplements ? `- مکمل‌های فعلی مصرفی: ${data.currentSupplements}` : ""}
${data.dislikedFoods ? `- غذاهای دوست‌نداشته/حذفی: ${data.dislikedFoods}` : ""}
${data.preferredCuisine ? `- سبک آشپزی ترجیحی: ${PREFERRED_CUISINE_LABELS[data.preferredCuisine]}` : ""}
${typeof data.waterGoalMl === "number" ? `- هدف هیدراتاسیون روزانه: ${Math.round(data.waterGoalMl / 10) / 100} لیتر (محاسبه خودکار)` : ""}
- BMR تخمینی: ${Math.round(bmr)} کالری
- پلن اشتراک کاربر: ${planLabel}
- قابلیت‌های فعال: ${[
    caps.workoutAndNutritionPlan ? "برنامه تمرین+تغذیه" : null,
    caps.supplementsPlan ? "برنامه مکمل" : null,
    caps.periodicCheckups ? "چکاپ دوره‌ای" : null,
    caps.aiChatQuestions !== 0 ? "چت هوشمند" : null,
    caps.mealPhotoAnalysis ? "آنالیز عکس غذا" : null,
    caps.bodyPhotoAnalysis ? "آنالیز عکس بدن" : null,
    caps.videoBodyAnalysis ? "آنالیز ویدیویی بدن" : null,
    caps.techniqueCorrection ? "اصلاح تکنیک" : null,
    caps.bloodTestAnalysis ? "تحلیل آزمایش خون" : null,
  ].filter(Boolean).join("، ")}`.trim() + `

⚠️ نکات ایمنی مهم ورزشکار:
${hasMedicalConditions ? `- شرایط پزشکی حساس دارد (${medicalConditionsList}) — حتماً برنامه ایمن و سازگار با شرایط طراحی کن و هشدار پزشکی لازم را بده.\n` : ""}${hasInjuries ? `- آسیب‌دیدگی دارد (${data.injuries}) — حرکات آسیب‌زا را حذف کن و جایگزین ایمن پیشنهاد بده.\n` : ""}${hasLowSleep ? `- خواب ناکافی (کمتر از ۷ ساعت) — شدت حجم تمرین را ملایم نگه دار و توصیه‌های ریکاوری بده.\n` : ""}${hasHighStress ? `- استرس بالا — برنامه باید فشار کورتیزولی بیش‌ازحد ایجاد نکند؛ شدت ملایم‌تر و ریکاوری کافی.\n` : ""}${data.currentSupplements ? `- مکمل مصرف می‌کند (${data.currentSupplements}) — تداخل مکمل پیشنهادی با مصرفی فعلی را بررسی کن.\n` : ""}`;
}

/**
 * ساخت بلوک پرامپت مخصوص پلن کاربر.
 * بر اساس سطح پلن، سطح جزئیات و دامنه برنامه را تعیین می‌کند.
 * - Basic: فقط برنامه تمرین + تغذیه
 * - Standard+: اضافه‌کردن برنامه مکمل‌ها
 * - Ultimate: تزریق متغیرهای آزمایش خون و آنالیز ویدیویی
 */
export function buildPlanAwareInstructions(planName?: Plan | null, extras?: { bloodTestReport?: string; videoAnalysisResult?: string; bodyPhotoAnalysis?: string; renewalContext?: string; trainingExperience?: string }): string {
  const caps = getCapabilities(planName ?? null);
  // ─── تکنیک‌های تمرینی بر اساس سابقه ورزشکار (نه پلن) ───
  const tier = getExperienceBasedTechniqueGuidance(extras?.trainingExperience);
  const instructions: string[] = [];

  // ─── ۱. تکنیک‌های تمرینی پیشرفته بر اساس سطح پلن (WORKOUT-PLAN-PRO) ───
  // این بخش برنامه تمرینی را به سطح مربیان بزرگ (هانی رامبد، هادی چوپان، کریس بامستد) ارتقا می‌دهد.
  if (tier.level === "pro") {
    instructions.push(
      "🔥 تکنیک‌های تمرینی ویژه پلن حرفه‌ای (الزاماً اعمال کن):\n" +
      "• FST-7 (Fascia Stretch Training — هانی رامبد): در حرکت آخر هر گروه عضلانی، ۷ ست با ۸-۱۲ تکرار و فقط ۳۰-۴۵ ثانیه استراحت بزن. فیلد fst7Details را با نام حرکت، تعداد ست (۷)، تکرارها و استراحت پر کن. هدف: پمپ حداکثری و کشش فاسیا برای رشد عضلانی.\n" +
      "• دوره‌بندی موجی (Undulating Periodization): در طول هفته، حجم/شدت را متغیر بده — یک روز هایپرتروفی (۸-۱۲ تکرار، RPE 7-8)، یک روز قدرت (۴-۶ تکرار، RPE 8-9)، یک روز استقامت (۱۵-۲۰ تکرار، RPE 6-7). فیلد periodizationType را \"undulating\" بگذار.\n" +
      "• فرکانس بالا (هادی چوپان): هر گروه عضلانی را ۲ بار در هفته تمرین بده. فیلد muscleFrequencyPerWeek را ۲ بگذار.\n" +
      "• ارتباط ذهن-عضله (کریس بامستد): در توضیح هر حرکت، روی کنترل تمپو و فاز اکسنتریک ۳-۴ ثانیه‌ای تأکید کن. فیلد inspiredByCoach را \"mixed\" بگذار.\n" +
      "• فیلد advancedTechniques (آرایه): حداقل ۳ تکنیک پیشرفته استفاده‌شده در برنامه را لیست کن.\n" +
      "• فیلد muscleGroupSplit: تقسیم عضلات هفته را مشخص کن (مثلاً push/pull/legs یا upper/lower/push/pull/legs)."
    );
  } else if (tier.level === "advanced") {
    instructions.push(
      "💪 تکنیک‌های تمرینی ویژه پلن پیشرفته:\n" +
      "• سوپرست آنتاگونیست (push/pull): حداقل در ۲ روز از هفته از سوپرست متضاد استفاده کن (پرس سینه + بارفیکس، پرس بالاسینه + زیرسینه، پرس بالاسرشانه + زیربغل سیم‌کش).\n" +
      "• تری‌ست همان گروه عضلانی: در روزهای حجمی می‌توانی ۱ تری‌ست برای پمپ نهایی عضله استفاده کنی.\n" +
      "• دراپ‌ست: در ست آخر حرکات کمکی، یک دراپ‌ست ۲۰٪ کاهش وزنه + ناتمام تا شکست بزن.\n" +
      "• رست پاز (pause reps): در نقطه میانی حرکات اصلی (پرس، اسکوات) ۲ ثانیه مکث کن.\n" +
      "• فیلد advancedTechniques (آرایه): حداقل ۲ تکنیک پیشرفته استفاده‌شده را لیست کن.\n" +
      "• فیلد muscleGroupSplit: تقسیم عضلات هفته را مشخص کن (مثلاً push/pull/legs یا upper/lower).\n" +
      "• فیلد inspiredByCoach را \"chris_bumstead\" بگذار — تمرکز روی فرم و ارتباط ذهن-عضله.\n" +
      "• ⚠️ از FST-7 و دوره‌بندی موجی استفاده نکن (مخصوص پلن حرفه‌ای)."
    );
  } else if (tier.level === "intermediate") {
    instructions.push(
      "⚡ راهنمای پلن استاندارد:\n" +
      "• تمرکز روی فرم صحیح حرکات و اتصال ذهن-عضله.\n" +
      "• تدریجی اضافه بار (Progressive Overload): هر هفته وزنه را ۲.۵-۵٪ افزایش بده.\n" +
      "• فیلد advancedTechniques: می‌توانی خالی بگذاری یا فقط [\"Progressive Overload\"] بنویسی.\n" +
      "• فیلد muscleGroupSplit: تقسیم ساده عضلات هفته را مشخص کن (مثلاً \"full body 3x\" یا \"upper/lower\").\n" +
      "• ⚠️ از سوپرست‌های پیچیده، تری‌ست، جاینت‌ست، FST-7 و دراپ‌ست استفاده نکن."
    );
  } else {
    // basic
    instructions.push(
      "🌱 راهنمای پلن اقتصادی:\n" +
      "• تمرکز روی یادگیری الگوهای حرکتی پایه (پرس، اسکوات، ددلیفت، بارفیکس).\n" +
      "• فرم صحیح مهم‌تر از وزنه است — کنترل کامل تمپو (۳-۱-۲-۰).\n" +
      "• تدریجی اضافه بار ملایم — هر ۲ هفته یک‌بار وزنه را افزایش بده.\n" +
      "• فیلد advancedTechniques: خالی یا [\"Progressive Overload\"]\n" +
      "• فیلد muscleGroupSplit: تقسیم ساده (مثلاً \"full body 3x\" یا \"split: upper/lower\").\n" +
      "• ⚠️ از هیچ تکنیک پیشرفته‌ای (سوپرست، تری‌ست، FST-7، دراپ‌ست) استفاده نکن."
    );
  }

  // ─── ۲. برنامه مکمل بر اساس سطح پلن ───
  // - basic: بدون مکمل (فقط توصیه‌های تغذیه‌ای)
  // - standard: مکمل‌های پایه (۴ مکمل)
  // - advanced: مکمل‌های پایه + پیشرفته (۶-۷ مکمل)
  // - ultimate: مکمل‌های پایه + پیشرفته + هدفمند (۸-۱۰ مکمل با استک دسته‌بندی‌شده)
  if (caps.supplementsPlan) {
    if (tier.level === "pro") {
      instructions.push(
        "💊 برنامه مکمل حرفه‌ای (پلن حرفه‌ای — استک کامل):\n" +
        "بخش «supplements» (لیست ساده) و بخش «supplementStack» (دسته‌بندی‌شده) را هر دو در JSON اضافه کن.\n" +
        "دسته‌بندی supplementStack (هر مکمل دارای فیلد category):\n\n" +
        "🔹 base (پایه — همه ورزشکاران):\n" +
        "• کراتین مونوهیدرات: ۵ گرم در روز (هر روز، صبح یا بعد تمرین)\n" +
        "• پروتئین وی: ۲۵-۳۰ گرم در وعده (بعد تمرین + یک وعده دیگر)\n" +
        "• امگا ۳ (روغن ماهی): ۱-۲ گرم در روز (با غذای چرب)\n" +
        "• مولتی‌ویتامین: ۱ قرص در روز (با صبحانه)\n\n" +
        "🔹 advanced (پیشرفته):\n" +
        "• BCAA/EAA: ۵-۱۰ گرم حین تمرین (فقط در صورت حجم تمرین بالا)\n" +
        "• بتاآلانین: ۳-۶ گرم در روز (مقسم به دو وعده — باعث سوزن می‌شود)\n" +
        "• سیترین مالات: ۶-۸ گرم ۳۰ دقیقه قبل تمرین (استقامت + پمپ)\n" +
        "• ZMA (زینک + منیزیم + B6): قبل خواب (ریکاوری + خواب بهتر)\n\n" +
        "🔹 targeted (هدفمند — بر اساس هدف):\n" +
        "• هدف چربی‌سوزی: ال-کارنیتین (۲ گرم قبل تمرین) + کافئین (۱۰۰-۲۰۰mg قبل تمرین)\n" +
        "• هدف حجم: کراتین (شامل بالا) + گینر (اختیاری، در صورت کالری پایین)\n" +
        "• هدف قدرت: سیترین (شامل بالا) + بتاآلانین (شامل بالا)\n\n" +
        "⚠️ هر مکمل باید فیلد contraindicatedFor (آرایه‌ای از شرایط منع مصرف) داشته باشد:\n" +
        "• کافئین → منع برای بیماران قلبی، فشار خون بالا، بی‌خوابی\n" +
        "• کراتین → منع برای بیماران کلیوی\n" +
        "• گینر → منع برای دیابتی‌ها (قند بالا)\n" +
        "• ZMA → منع برای کسانی که مکمل زینک مصرف می‌کنند (مسمومیت زینک)\n\n" +
        "هرگز دوز بالاتر از مقادیر ذکرشده تجویز نکن. در بخش note هر مکمل بنویس: «قبل از شروع با پزشک مشورت کنید.»"
      );
    } else if (tier.level === "advanced") {
      instructions.push(
        "💊 برنامه مکمل پیشرفته (پلن پیشرفته):\n" +
        "بخش «supplements» (لیست ساده) و بخش «supplementStack» (دسته‌بندی‌شده) را در JSON اضافه کن.\n\n" +
        "🔹 base (پایه — الزامی):\n" +
        "• کراتین مونوهیدرات: ۳-۵ گرم در روز\n" +
        "• پروتئین وی: ۲۵-۳۰ گرم در وعده (بعد تمرین)\n" +
        "• امگا ۳ (روغن ماهی): ۱-۲ گرم در روز\n" +
        "• مولتی‌ویتامین: ۱ قرص در روز\n" +
        "• ویتامین D3: ۱۰۰۰-۲۰۰۰ واحد در روز (نه بیشتر!)\n\n" +
        "🔹 advanced (پیشرفته — بر اساس هدف):\n" +
        "• BCAA: ۵ گرم حین تمرین (در صورت حجم بالا)\n" +
        "• بتاآلانین: ۳-۶ گرم در روز\n" +
        "• سیترین مالات: ۶ گرم قبل تمرین (اختیاری)\n\n" +
        "هر مکمل باید فیلد contraindicatedFor داشته باشد. هرگز دوز بالاتر تجویز نکن. در note بنویس: «قبل از شروع با پزشک مشورت کنید.»"
      );
    } else {
      // standard
      instructions.push(
        "💊 برنامه مکمل پایه (پلن استاندارد):\n" +
        "بخش «supplements» در JSON اضافه کن. حداقل ۴ مکمل پایه:\n" +
        "• کراتین مونوهیدرات: ۳-۵ گرم در روز (هر روز)\n" +
        "• پروتئین وی: ۲۵-۳۰ گرم در وعده (بعد تمرین)\n" +
        "• امگا ۳ (روغن ماهی): ۱-۲ گرم در روز\n" +
        "• مولتی‌ویتامین: ۱ قرص در روز\n" +
        "• ویتامین D3: ۱۰۰۰-۲۰۰۰ واحد در روز (نه بیشتر!)\n" +
        "• ال-گلوتامین: ۵ گرم در روز (اختیاری)\n" +
        "هرگز دوز بالاتر از این مقادیر تجویز نکن. در بخش note هر مکمل بنویس: «قبل از شروع با پزشک مشورت کنید.»"
      );
    }
  } else {
    // basic — بدون پلن مکمل، فقط توصیه‌های تغذیه‌ای
    instructions.push(
      "🥗 توصیه‌های تغذیه‌ای (پلن اقتصادی — بدون مکمل):\n" +
      "• پروتئین کافی از منابع غذایی: تخم‌مرغ، سینه مرغ، ماهی، عدس، عدسی، ماست یونانی.\n" +
      "• کربوهیدرات از منابع کامل: برنج، سیب‌زمینی، نان سنگک، جو دوسر.\n" +
      "• چربی سالم: روغن زیتون، آووکادو، مغزها (گردو، بادام).\n" +
      "• آب کافی: حداقل ۸ لیوان در روز.\n" +
      "• در صورت تمایل به مکمل، ارتقا به پلن استاندارد یا بالاتر پیشنهاد می‌شود.\n" +
      "⚠️ بخش supplements در JSON را خالی بگذار یا اصلاً اضافه نکن."
    );
  }

  // آنالیز عکس بدن — برای کاربران Advanced / Ultimate که عکس بدن ارسال کرده‌اند.
  // نیازی به capability gate نیست: اگر extras.bodyPhotoAnalysis وجود دارد، یعنی کاربر
  // قبلاً از طریق submit-body-analysis عکس‌هایش را ارسال کرده و قابلیت bodyPhotoAnalysis
  // توسط requirePlanCapability تأیید شده است.
  if (extras?.bodyPhotoAnalysis) {
    instructions.push(
      `آنالیز عکس‌های بدن کاربر (توسط هوش مصنوعی بررسی شده):\n${extras.bodyPhotoAnalysis}\nاین اطلاعات را در طراحی برنامه لحاظ کن — نقاط ضعف فرم بدن، عدم تقارن، و حرکات اصلاحی پیشنهاد بده. تمرینات را بر اساس نقاط ضعف شناسایی‌شده اولویت‌بندی کن. اگر عدم تقارن عضلانی (مثلاً بین بازوی چپ و راست) دیده شد، تمرینات یک‌طرفه (unilateral) را در برنامه بگنجان.`
    );
  }

  if (caps.videoBodyAnalysis && extras?.videoAnalysisResult) {
    instructions.push(
      `آنالیز ویدیویی بدن کاربر (توسط هوش مصنوعی بررسی شده):\n${extras.videoAnalysisResult}\nاین اطلاعات را در طراحی برنامه لحاظ کن — نقاط ضعف فرم بدن، عدم تقارن، و حرکات اصلاحی پیشنهاد بده.`
    );
  }

  if (caps.bloodTestAnalysis && extras?.bloodTestReport) {
    instructions.push(
      `گزارش آزمایش خون کاربر:\n${extras.bloodTestReport}\nبرنامه تغذیه را بر اساس کمبودهای ویتامینی، سطح قند، چربی خون و هورمون‌ها بهینه‌سازی کن. در صورت کمبود، غذاهای غنی از آن ویتامین/ماده معدنی را اولویت بده. هشدارهای پزشکی لازم را در بخش notes بیاور.`
    );
  }

  // تمدید هوشمند: پیشرفت کاربر از دوره قبلی
  if (extras?.renewalContext) {
    instructions.push(extras.renewalContext);
  }

  return instructions.length
    ? `\n\nدستورالعمل‌های ویژه پلن ${planName ? PLAN_LABELS[planName] : ""} (سطح: ${tier.level}):\n${instructions.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}`
    : "";
}

// ─── راهنمای انتخاب سوپرست بر اساس هدف ورزشکار ───
// (FULL-PROFILE-AI-CONTEXT-WORKOUT) تصمیم‌گیری هوشمند درباره استفاده از
// سوپرست/تری‌ست/جاینت‌ست بر اساس هدف، سطح ورزشکار و شرایط پزشکی.
function supersetGuidanceForGoal(goal: OnboardingData["goal"]): string {
  switch (goal) {
    case "fat_loss":
      return [
        "  • توصیه: استفاده از سوپرست/تری‌ست/جاینت‌ست در ۲ تا ۳ روز از هفته برای افزایش فشار متابولیک (metabolic stress) و کالری‌سوزی.",
        "  • بهترین انتخاب: جاینت‌ست‌های بدن‌کامل (full-body circuit) و سوپرست‌های آنتاگونیست با استراحت کم.",
        "  • استراحت کوتاه (۳۰-۶۰ ثانیه بین گروه‌ها) برای حفظ ضربان قلب بالا.",
      ].join("\n");
    case "muscle_gain":
      return [
        "  • توصیه: استفاده از سوپرست آنتاگونیست (push/pull) در ۱ تا ۲ روز از هفته برای افزایش حجم تمرین بدون خستگی اضافی.",
        "  • بهترین انتخاب: سوپرست‌های متضاد (پرس سینه + بارفیکس، پرس بالاسینه + زیرسینه) برای حفظ شدت هایپرتروفی.",
        "  • از تری‌ست و جاینت‌ست کمتر استفاده کن — استراحت کافی (۹۰-۱۲۰ ثانیه) برای حفظ شدت مکانیکی.",
      ].join("\n");
    case "strength":
      return [
        "  • توصیه: استفاده از سوپرست به حداقل (۰ تا ۱ روز در هفته) — تمرکز روی حرکات اصلی با وزنه سنگین و استراحت کامل.",
        "  • برای قدرت محض، حرکات تکی با ۳-۵ دقیقه استراحت برتری دارند.",
        "  • اگر سوپرست می‌دهی، فقط سوپرست آنتاگونیست با شدت متوسط برای حرکات کمکی (نه حرکات اصلی).",
      ].join("\n");
    case "endurance":
      return [
        "  • توصیه: استفاده از تری‌ست و جاینت‌ست در ۱ تا ۲ روز برای افزایش استقامت عضلانی.",
        "  • استراحت کوتاه (۳۰-۴۵ ثانیه) و تکرار بالا (۱۵-۲۰) برای بهبود ظرفیت لاکتات.",
      ].join("\n");
    case "fitness":
    default:
      return [
        "  • توصیه: استفاده متوسط از سوپرست (۱ تا ۲ روز در هفته) برای تنوع و افزایش شدت تمرین.",
        "  • ترکیب سوپرست‌های آنتاگونیست با حرکات تکی برای تعادل قدرت و استقامت.",
      ].join("\n");
  }
}

function supersetGuidanceForExperience(experience: OnboardingData["trainingExperience"] | undefined): string {
  switch (experience) {
    case "beginner":
      return [
        "  • سطح مبتدی: از سوپرست/تری‌ست/جاینت‌ست استفاده نکن (یا حداکثر ۱ سوپرست ساده در یک روز).",
        "  • تمرکز روی یادگیری فرم صحیح حرکات تکی، اتصال ذهن-عضله و تثبیت الگوهای حرکتی.",
        "  • استراحت کامل (۹۰-۱۲۰ ثانیه) بین ست‌ها برای ریکاوری عصبی-عضلانی.",
      ].join("\n");
    case "intermediate":
      return [
        "  • سطح متوسط: می‌توانی از سوپرست‌های آنتاگونیست در ۱-۲ روز استفاده کنی.",
        "  • هنوز از تری‌ست/جاینت‌ست پرهیز کن مگر برای روز استقامت/کاردیو.",
      ].join("\n");
    case "advanced":
      return [
        "  • سطح پیشرفته: استفاده از سوپرست/تری‌ست در ۲-۳ روز مجاز و مفید است.",
        "  • جاینت‌ست را برای روزهای چربی‌سوزی یا بدن‌کامل نگه دار.",
      ].join("\n");
    case "pro":
      return [
        "  • سطح حرفه‌ای: آزادی کامل در استفاده از تکنیک‌های پیشرفته (سوپرست/تری‌ست/جاینت‌ست/دراپ‌ست).",
        "  • برای حداکثر رشد، ترکیب سوپرست آنتاگونیست با تری‌ست همان گروه را در روزهای حجمی امتحان کن.",
      ].join("\n");
    default:
      return [
        "  • سطح نامشخص: محتاط رفتار کن — حداکثر ۱ سوپرست در یک روز.",
      ].join("\n");
  }
}

// Generate a weekly workout plan via AI
export async function generateWorkoutPlan(
  data: OnboardingData,
  planName?: Plan | null,
  extras?: { bloodTestReport?: string; videoAnalysisResult?: string; bodyPhotoAnalysis?: string; renewalContext?: string }
): Promise<ProWorkoutPlanContent> {
  const systemPrompt = await getAiConfig("coach_system_prompt", DEFAULT_COACH_PROMPT);
  const context = buildUserContext(data, planName);
  // ─── trainingExperience را به extras اضافه کن تا تکنیک‌ها بر اساس سابقه فعال شوند ───
  const planInstructions = buildPlanAwareInstructions(planName, { ...extras, trainingExperience: data.trainingExperience });

  // Use user-selected specific weekdays if provided; otherwise fallback to first N days
  const chosenDays =
    data.workoutDaysList && data.workoutDaysList.length > 0
      ? data.workoutDaysList
      : PERSIAN_WEEKDAYS.slice(0, data.workoutDays);

  // --- Fetch exercise names from the library so AI only uses real exercises ---
  let libraryNames: string[] = [];
  try {
    const all = await db.exerciseLibrary.findMany({ select: { name: true, muscle: true } });
    libraryNames = all.map((e: any) => e.name);
  } catch (e) {
    console.error("[generateWorkoutPlan] failed to load exercise library:", e);
  }
  const libraryList = libraryNames.length > 0
    ? `\n\nکتابخانه حرکات موجود (فقط از بین این حرکات انتخاب کن):\n${libraryNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n`
    : "";

  // ─── محاسبه پویای تعداد حرکات هر روز بر اساس سطح تجربه کاربر (WORKOUT-PLAN-PRO) ───
  // مبتدی: ۵-۶ | متوسط: ۶-۷ | پیشرفته: ۷-۸ | حرفه‌ای: ۸-۱۰
  // این مقادیر بر اساس استاندارد مربیان بزرگ دنیا (هانی رامبد، هادی چوپان، کریس بامستد) تنظیم شده‌اند.
  // برای کاربران با سابقه ۳ سال یا بیشتر (advanced/pro) حداقل ۶ حرکت الزامی است.
  const exerciseCountRange = (() => {
    switch (data.trainingExperience) {
      case "beginner":
        return { min: 5, max: 6 };
      case "intermediate":
        return { min: 6, max: 7 };
      case "advanced":
        return { min: 7, max: 8 };
      case "pro":
        return { min: 8, max: 10 };
      default:
        return { min: 5, max: 6 };
    }
  })();
  // قانون سابقه ۳ سال یا بیشتر → حداقل ۶ حرکت
  const minExercisesForExperienced = 6;
  const effectiveMinExercises =
    (data.trainingExperience === "advanced" || data.trainingExperience === "pro")
      ? Math.max(exerciseCountRange.min, minExercisesForExperienced)
      : exerciseCountRange.min;

  const userPrompt = `بر اساس اطلاعات زیر، یک برنامه تمرینی هفتگی کامل، حرفه‌ای و شخصی‌سازی‌شده بساز — سطح مربی حرفه‌ای فدراسیون.

${context}
${planInstructions}
${libraryList}

روزهای تمرین کاربر: ${chosenDays.join("، ")}

فقط و فقط با ساختار JSON زیر پاسخ بده و هیچ متن اضافه‌ای قبل یا بعد از JSON ننویس:
{
  "days": [
    {
      "day": "شنبه",
      "title": "عنوان روز تمرین",
      "focus": "عضله هدف",
      "estimatedMinutes": 60,
      "warmup": [
        {"name": "نام حرکت گرم‌کردن (مثلاً دویدن سبک روی تردمیل)", "durationSec": 300, "notes": "شدت پایین، RPE 4-5"},
        {"name": "موبیلیتی مفصل هدف (مثلاً چرخش شانه)", "durationSec": 120, "notes": "۳ ست ۱۰ تکراری"}
      ],
      "exercises": [
        {
          "name": "نام حرکت (حتماً از کتابخانه حرکات بالا)",
          "muscle": "عضله هدف",
          "category": "push|pull|legs|core|cardio|fullbody",
          "description": "توضیح نحوه انجام (۲-۳ جمله کامل و واضح — فرم، مسیر حرکت، نکته فنی کلیدی)",
          "tips": "نکته ایمنی و تکنیک",
          "coachTip": "توصیه کوتاه مربی (۱ جمله) — مثلاً «دقت کن زانوها در جهت نوک پنجه باشد» یا «در فاز منفی ۳ ثانیه مکث کن»",
          "difficulty": "beginner|intermediate|advanced",
          "rpe": 7,
          "tempo": "3-1-2-0",
          "substitution": "حرکت جایگزین برای زمانی که تجهیزات کافی نباشد یا محدودیت خطری وجود داشته باشد",
          "sets": [
            {"setNumber": 1, "reps": "10-12", "restSec": 90, "rpe": 7},
            {"setNumber": 2, "reps": "10-12", "restSec": 90, "rpe": 7}
          ],
          "supersetGroup": "A",
          "supersetType": "superset",
          "circuitRounds": 3,
          "restBetweenRounds": 180
        }
      ],
      "cooldown": [
        {"name": "استretch دینامیک/استاتیک عضله هدف", "durationSec": 180, "notes": "۳۰ ثانیه روی هر عضله"},
        {"name": "فوم رولر (Foam Roller)", "durationSec": 180, "notes": "روی عضلات هدف و فاسیا"}
      ]
    }
  ],
  "weeklyProgression": {
    "strategy": "استراتژی کلی پیشرفت (مثلاً: هر هفته وزنه‌ها را ۲.۵٪ افزایش بده، تکرارها را ثابت نگه دار)",
    "weeks": [
      {"week": 1, "weightChangeKg": 0, "repChange": 0, "note": "هفته آشنایی — RPE 6-7، فرم حرکات را تثبیت کن"},
      {"week": 2, "weightChangeKg": 2.5, "repChange": 0, "note": "افزایش وزنه ۲.۵ کیلو در حرکات اصلی — RPE 7-8"},
      {"week": 3, "weightChangeKg": 5, "repChange": 0, "note": "افزایش وزنه تجمعی — RPE 8-9، حجم ثابت"},
      {"week": 4, "weightChangeKg": 7.5, "repChange": -1, "note": "هفته اوج (deload بعدی) — RPE 9، تکرار کاهشی"}
    ]
  },
  "safetyNotes": [
    "نکته ایمنی ۱ بر اساس آسیب‌دیدگی یا شرایط پزشکی",
    "نکته ایمنی ۲"
  ],
  "recoveryNotes": [
    "توصیه ریکاوری ۱ بر اساس خواب/استرس",
    "توصیه ریکاوری ۲"
  ],
  "nutritionTimingNotes": [
    "توصیه تایمینگ تغذیه قبل از تمرین (۹۰-۱۲۰ دقیقه قبل)",
    "توصیه تایمینگ تغذیه بعد از تمرین (۳۰-۶۰ دقیقه بعد)"
  ],
  "supplementTimingNotes": [
    "توصیه تایمینگ مکمل بر اساس مکمل‌های فعلی یا هدف"
  ],
  "medicalWarningFlags": [
    "⚠️ هشدار پزشکی (در صورت وجود شرایط حساس)"
  ],
  "weeklyGoal": "هدف هفته",
  "notes": "نکات کلی هفته — انگیزشی و کاربردی",
  "advancedTechniques": [
    "نام تکنیک پیشرفته استفاده‌شده (مثلاً FST-7، سوپرست آنتاگونیست، تری‌ست، دراپ‌ست، رست پاز، Progressive Overload)"
  ],
  "muscleGroupSplit": "تقسیم عضلات هفته (مثلاً push/pull/legs یا upper/lower یا body part split یا full body 3x)",
  "periodizationType": "linear | undulating | block | wave | daily_undulating",
  "muscleFrequencyPerWeek": 2,
  "inspiredByCoach": "hany_rambod | hadi_chupan | chris_bumstead | mixed",
  "fst7Details": {
    "exerciseName": "نام حرکت آخر گروه عضلانی (که FST-7 روی آن اعمال می‌شود)",
    "sets": 7,
    "reps": "8-12",
    "restSec": 30,
    "note": "توضیح اجرای FST-7 (پمپ حداکثری، استراحت ۳۰-۴۵ ثانیه، ۷ ست)"
  }
}

قوانین حرفه‌ای (همه را رعایت کن):

۱) ساختار و تعداد:
- دقیقاً ${data.workoutDays} روز تمرین در روزهای ذکر شده (${chosenDays.join("، ")}) ایجاد کن.
- 📅 روزهای تمرین را به ترتیب استاندارد هفته فارسی برگردان: شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه، پنجشنبه، جمعه. هرگز روزها را نامرتب برنگردان. آرایه "days" باید دقیقاً به همین ترتیب زمانی چیده شده باشد.
- هر روز ${effectiveMinExercises} تا ${exerciseCountRange.max} حرکت داشته باشد (سطح تجربه کاربر: ${data.trainingExperience || "beginner"}).
- ⚠️ قانون مهم: برای کاربران با سابقه ۳ سال یا بیشتر (سطح پیشرفته/حرفه‌ای)، حداقل ۶ حرکت در هر روز الزامی است.
- تعداد ست‌ها بین ۳ تا ۵ باشد.
- **حتماً فقط از حرکات کتابخانه حرکات بالا استفاده کن** — نام حرکات را دقیقاً همان‌طور بنویس.
- **سوپرست/تری‌ست/جاینت‌ست به عنوان یک حرکت در نظر گرفته می‌شود** (مثلاً ۵ حرکت تکی + ۱ سوپرست = ۶ حرکت کل).

۲) گرم‌کردن و سردکردن (بسیار مهم):
- هر روز حتماً آرایه "warmup" با حداقل ۲ آیتم بساز: ۵-۱۰ دقیقه هوازی سبک + موبیلیتی/اکتیویشن مفصل هدف.
- هر روز حتماً آرایه "cooldown" با حداقل ۲ آیتم بساز: استretch استاتیک + فوم رولر یا نفس‌گیری فعال.
- durationSec به ثانیه (نه دقیقه) باشد.

۳) RPE (Rate of Perceived Exertion) — حرفه‌ای:
- برای هر حرکت فیلد "rpe" (۱ تا ۱۰) بگذار:
  • RPE 5-6: گرم‌کردن / آماده‌سازی
  • RPE 7: شدت متوسط — ۳ تکرار ذخیره (RIR 3)
  • RPE 8: شدت بالا — ۲ تکرار ذخیره (RIR 2)
  • RPE 9: نزدیک شکست — ۱ تکرار ذخیره
  • RPE 10: شکست عضلانی کامل (فقط در ست آخر حرکات اصلی)
- در ست آخر هر حرکت اصلی (پرس، اسکوات، ددلیفت) می‌توانی RPE را ۱-۲ درجه بالاتر بگذاری.

۴) Tempo (تمپو اجرا):
- برای هر حرکت فیلد "tempo" با فرمت ۴-رقمی بنویس: "اکسنتریک-مکث-کنسنتریک-مکث".
  مثال‌ها:
  • "3-1-2-0" — پایین ۳ ثانیه، مکث ۱، بالا ۲، بدون مکث (استاندارد هایپرتروفی)
  • "2-0-1-0" — کنترل‌شده سریع (قدرت)
  • "4-2-1-0" — زیر کنترل کامل (هایپرتروفی پیشرفته)
- برای حرکات انفجاری (مثل پاور کلین) از "1-0-X-0" استفاده کن (X = حداکثر سرعت).

۴-۱) توصیه مربی (coachTip) — الزامی برای هر حرکت:
- برای هر حرکت فیلد "coachTip" را با یک جمله کوتاه و کاربردی از مربی پر کن.
- این توصیه باید مختص همان حرکت باشد — نکته فنی یا فرمی که کاربر را در همان حرکت کمک کند.
- مثال‌ها:
  • اسکوات: «دقت کن زانوها در جهت نوک پنجه باشد و عمق حداقل موازی با زمین.»
  • ددلیفت: «کمر کاملاً صاف، وزنه نزدیک بدن، فاز بالا با باسن و زانو هم‌زمان.»
  • پرس سینه: «پایین آهسته (۳ ثانیه)، مکث ۱ ثانیه روی سینه، انفجاری بالا.»
  • بارفیکس: «در فاز منفی ۳ ثانیه مکث کن تا کنترل کامل داشته باشی.»
  • پرس سرشانه: «قفسه سینه بالا، شکم سفت، بدون قوس کمری — از فاز منفی غافل نشو.»
- هرگز توصیه کلی و تکراری ننویس (مثل «فرم درست داشته باش»). همیشه نکته خاص همان حرکت.

۵) استراحت بین ست‌ها:
- در فیلد "restSec" هر ست بگذار:
  • قدرت محض (۱-۳ تکرار): ۱۸۰ ثانیه (۳ دقیقه)
  • هایپرتروفی (۶-۱۲ تکرار): ۶۰-۹۰ ثانیه
  • استقامت عضلانی (۱۵+ تکرار): ۳۰-۴۵ ثانیه
  • سوپرست/تری‌ست: ۹۰-۱۲۰ ثانیه بین گروه‌ها

۶) حرکت جایگزین (substitution):
- برای هر حرکت فیلد "substitution" پر کن با جایگزینی که همان عضله را هدف می‌گیرد اما با تجهیزات کمتر یا محدودیت ایمنی متفاوت.

۷) سوپرست / تری‌ست / جاینت‌ست (روش‌های حرفه‌ای افزایش شدت):
- **استفاده از سوپرست/تری‌ست/جاینت‌ست اختیاری است و باید بر اساس هدف و سطح ورزشکار تصمیم کنی.** در صورت استفاده، برای حرکات گروهی فیلد "supersetGroup" را با یک حرف یکسان (مثل "A" یا "B") پر کن.
- **توجه**: سوپرست/تری‌ست/جاینت‌ست در شمارش حرکات یک حرکت محسوب می‌شود (نه دو یا سه).
- "supersetType" را بر اساس نوع گروه تنظیم کن:
  • "superset" (۲ حرکت): متضاد آنتاگونیست — مثل پرس سینه + بارفیکس (push + pull).
  • "triset"    (۳ حرکت): همان گروه عضلانی — مثل ۳ حرکت مختلف سینه (پرس، قفسه، شنا).
  • "giant"     (۴ حرکت یا بیشتر): جاینت‌ست یا سیرکویت — برای اتمام کامل یک گروه عضلانی یا سیرکویت بدن‌کامل (full-body circuit).
- برای جاینت‌ست (giant) حتماً این فیلدها را هم پر کن:
  • "circuitRounds": تعداد دفعات تکرار کل سیرکویت (عدد ۲ تا ۴، پیش‌فرض ۳).
  • "restBetweenRounds": استراحت بین دورهای سیرکویت به ثانیه (۱۲۰ تا ۱۸۰ ثانیه).
- در سوپرست/تری‌ست/جاینت‌ست، restSec حرکات داخل گروه را ۰ یا کم بگذار (چون بدون استراحت بین حرکات انجام می‌شوند)؛ استراحت واقعی بین گروه‌ها (یا بین دورها در جاینت‌ست) لحاظ می‌شود.
- به ازای هر گروه، حداکثر ۱ گروه از هر نوع در یک روز بساز — هم‌نام‌بودن "supersetGroup" یعنی همان گروه.

۷-۱) راهنمای انتخاب سوپرست بر اساس هدف و سطح ورزشکار:
- **هدف "${GOAL_LABELS[data.goal]}"** (${data.goal}):
${supersetGuidanceForGoal(data.goal)}
- **سطح ورزشکار "${data.trainingExperience || "beginner"}"**:
${supersetGuidanceForExperience(data.trainingExperience)}
- اگر کاربر مبتدی است یا شرایط پزشکی/آسیب‌دیدگی حساس دارد، استفاده از سوپرست را به حداقل برسان یا کلاً حذف کن و روی حرکات تکی با فرم تکنیکی تمرکز کن.

۷-۲) تکنیک‌های پیشرفته و الگوی مربیان بزرگ (WORKOUT-PLAN-PRO):
- **هانی رامبد — FST-7 (Fascia Stretch Training)**: در حرکت آخر هر گروه عضلانی (به ویژه برای پلن حرفه‌ای/ultimate)، ۷ ست با ۸-۱۲ تکرار و استراحت ۳۰-۴۵ ثانیه بزن. هدف: پمپ حداکثری و کشش فاسیا. فیلد "fst7Details" را با نام حرکت، ۷ ست، تکرارها و استراحت پر کن.
- **هادی چوپان — حجم بالا + فرکانس بالا**: هر گروه عضلانی را ۲ بار در هفته تمرین بده. فیلد "muscleFrequencyPerWeek" را ۲ بگذار. در روزهای تکراری، حرکات و زاویه‌های متفاوت استفاده کن.
- **کریس بامستد — ارتباط ذهن-عضله**: در توضیح هر حرکت روی کنترل فاز اکسنتریک (۳-۴ ثانیه پایین) و مکث در نقطه کشش تأکید کن. تمپو "4-1-2-0" یا "3-1-2-1" برای هایپرتروفی.
- **دوره‌بندی موجی (Undulating Periodization)**: در طول هفته، حجم/شدت را متغیر بده. فیلد "periodizationType" را بر اساس پلن کاربر تنظیم کن:
  • ultimate → "undulating" یا "daily_undulating"
  • advanced → "linear"
  • standard/basic → "linear"
- **دراپ‌ست (Drop Set)**: در ست آخر حرکات کمکی، می‌توانی یک دراپ‌ست (۲۰-۳۰٪ کاهش وزنه + تکرار تا شکست) پیشنهاد بده. در توضیح حرکت ذکر کن.
- **رست پاز (Pause Reps)**: در نقطه میانی حرکات اصلی، ۲-۳ ثانیه مکث (tempo مثلاً "3-2-1-0").
- **تکنیک ۱.۵ تکراری (1.5 reps)**: یک تکرار کامل + نیم تکرار = ۱.۵. برای پمپ حداکثری عضله.
- فیلد "advancedTechniques" (آرایه): حداقل تکنیک‌های پیشرفته استفاده‌شده در این برنامه را لیست کن (بر اساس سطح پلن کاربر).
- فیلد "muscleGroupSplit": تقسیم عضلات هفته را دقیق مشخص کن (مثلاً "push/pull/legs" یا "upper/lower" یا "push/pull/legs/upper/lower" یا "body part split").
- فیلد "inspiredByCoach": بر اساس پلن و هدف:
  • ultimate → "mixed" یا "hany_rambod"
  • advanced → "chris_bumstead" یا "hadi_chupan"
  • standard/basic → "mixed"

۸) پیشرفت هفتگی (weeklyProgression):
- استراتژی پیشرفت (Progressive Overload) را برای حداقل ۴ هفته بنویس.
- هر هفته توضیح بده چقدر وزنه/تکرار اضافه شود و RPE هدف چقدر باشد.
- اگر کاربر "${data.trainingExperience || "beginner"}" است، آغاز را ملایم‌تر بگذار. اگر "pro" یا "advanced" است، پرگرسیون تهاجمی‌تر بده.

۹) نکات ایمنی (safetyNotes):
- بر اساس آسیب‌دیدگی‌ها و شرایط پزشکی کاربر، حداقل ۲ نکته بنویس.
- اگر شرایط حساسی (دیابت، قلب، فشار خون) دارد، آن را صراحتاً ذکر کن.

۱۰) توصیه ریکاوری (recoveryNotes):
- بر اساس خواب و استرس کاربر، حداقل ۲ توصیه بنویس.
  • اگر خواب کمتر از ۷ ساعت: حجم تمرین را ملایم پیشنهاد بده و تاکید بر خواب.
  • اگر استرس بالا (۴-۵): تاکید بر ریکاوری فعال (پیاده‌روی، مدیتیشن، تنفس).

۱۱) تایمینگ تغذیه (nutritionTimingNotes):
- حداقل ۲ توصیه: قبل و بعد از تمرین (با فاصله زمانی دقیق).

۱۲) تایمینگ مکمل (supplementTimingNotes):
- اگر کاربر مکمل فعلی مصرف می‌کند (${data.currentSupplements || "نامشخص"}): تداخل/هماهنگی زمان مصرف را توضیح بده.
- اگر مکمل نمی‌خورد: توصیه مکمل هدفمند (مثلاً کراتین بعد از تمرین).

۱۳) هشدارهای پزشکی (medicalWarningFlags):
- در صورت وجود شرایط حساس، حداقل ۱ هشدار اضافه کن.
- اگر شرایط حساس نیست، آرایه خالی بگذار: [].

۱۴) نکات هفته (notes):
- انگیزشی و کاربردی، شامل ۳-۴ نکته کوتاه با ایموجی. مثال: "🔥 این هفته روی فرم حرکات تمرکز کن — کیفیت مهم‌تر از کمیت است!\n💪 پروتئین کافی بخور تا ریکاوری بهتر شود.\n🎯 هدف هفته: افزایش وزنه در اسکوات!\n⚡ استراحت بین ست‌ها را رعایت کن — عضله در استراحت رشد می‌کند."

۱۵) شخصی‌سازی بر اساس شرایط:
- اگر آسیب‌دیدگی وجود دارد، حرکات آسیب‌زا را حذف و جایگزین ایمن بده.
- برای تمرین در خانه، از حرکات با وزن بدن یا تجهیزات موجود استفاده کن.
- ساعت ترجیحی تمرین کاربر ${data.workoutTime ? `(${WORKOUT_TIME_LABELS[data.workoutTime]})` : "(نامشخص)"} — اگر صبح است، تمرین قدرتی پیشنهاد بده؛ اگر عصر/شب، حجمی/استقامتی.
${data.targetDate ? `- تاریخ هدف کاربر ${data.targetDate} است — استراتژی پیشرفت را به این تایم‌لاین تنظیم کن.` : ""}
${data.bodyFrame ? `- اندازه استخوان بدن کاربر ${BODY_FRAME_LABELS[data.bodyFrame]} است — در محاسبه حجم و شدت لحاظ کن.` : ""}

برای هر حرکت، توضیح کامل و واضح بنویس که کاربر بتواند حرکت را درست انجام دهد.`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[generateWorkoutPlan] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);

  // Enrich exercises with IDs + superset fields + new pro fields (rpe, tempo, substitution)
  const enriched: ProWorkoutPlanContent = {
    days: (parsed.days || []).map((day: any) => ({
      ...day,
      // Ensure warmup/cooldown arrays are valid
      warmup: Array.isArray(day.warmup) ? day.warmup.map((w: any) => ({
        name: String(w.name || "گرم‌کردن"),
        durationSec: Number(w.durationSec) || 300,
        notes: w.notes ? String(w.notes) : undefined,
      })) : undefined,
      cooldown: Array.isArray(day.cooldown) ? day.cooldown.map((c: any) => ({
        name: String(c.name || "سردکردن"),
        durationSec: Number(c.durationSec) || 300,
        notes: c.notes ? String(c.notes) : undefined,
      })) : undefined,
      exercises: (day.exercises || []).map((ex: any, i: number) => ({
        ...ex,
        id: `ex_${Math.random().toString(36).slice(2, 9)}`,
        mediaUrl: "",
        // Preserve per-exercise pro fields (rpe, tempo, substitution)
        rpe: typeof ex.rpe === "number" ? Math.max(1, Math.min(10, ex.rpe)) : undefined,
        tempo: typeof ex.tempo === "string" && ex.tempo.trim() ? ex.tempo.trim() : undefined,
        substitution: typeof ex.substitution === "string" && ex.substitution.trim()
          ? ex.substitution.trim()
          : undefined,
        // COACH-TIP: توصیه کوتاه مربی زیر هر حرکت (۱ جمله)
        coachTip: typeof ex.coachTip === "string" && ex.coachTip.trim()
          ? ex.coachTip.trim()
          : undefined,
        sets: (ex.sets || []).map((s: any, j: number) => ({
          ...s,
          setNumber: j + 1,
          done: false,
          weight: undefined,
          rpe: typeof s.rpe === "number" ? Math.max(1, Math.min(10, s.rpe)) : undefined,
        })),
        supersetGroup: ex.supersetGroup || undefined,
        supersetType: ex.supersetType || undefined,
        // Preserve giant-set circuit fields
        circuitRounds: typeof ex.circuitRounds === "number" ? Math.max(1, Math.min(5, Math.round(ex.circuitRounds))) : undefined,
        restBetweenRounds: typeof ex.restBetweenRounds === "number" ? Math.max(0, Math.min(600, Math.round(ex.restBetweenRounds))) : undefined,
      })),
    })),
    weeklyGoal: parsed.weeklyGoal || "بهبود تدریجی قدرت و استقامت",
    notes: parsed.notes || "قبل از شروع حتماً ۵ تا ۱۰ دقیقه گرم کردن انجام دهید.",
    supplements: parsed.supplements || undefined,
    // NEW: professional enrichment fields
    weeklyProgression: parsed.weeklyProgression && typeof parsed.weeklyProgression === "object"
      ? {
          strategy: String(parsed.weeklyProgression.strategy || "افزایش تدریجی وزنه ۲.۵٪ در هفته"),
          weeks: Array.isArray(parsed.weeklyProgression.weeks)
            ? parsed.weeklyProgression.weeks.map((w: any, idx: number) => ({
                week: Number(w.week) || idx + 1,
                weightChangeKg: typeof w.weightChangeKg === "number" ? w.weightChangeKg : undefined,
                repChange: typeof w.repChange === "number" ? w.repChange : undefined,
                note: String(w.note || ""),
              }))
            : [],
        }
      : undefined,
    safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes.map((s: any) => String(s)) : undefined,
    recoveryNotes: Array.isArray(parsed.recoveryNotes) ? parsed.recoveryNotes.map((s: any) => String(s)) : undefined,
    nutritionTimingNotes: Array.isArray(parsed.nutritionTimingNotes) ? parsed.nutritionTimingNotes.map((s: any) => String(s)) : undefined,
    supplementTimingNotes: Array.isArray(parsed.supplementTimingNotes) ? parsed.supplementTimingNotes.map((s: any) => String(s)) : undefined,
    medicalWarningFlags: Array.isArray(parsed.medicalWarningFlags) ? parsed.medicalWarningFlags.map((s: any) => String(s)) : undefined,
    // ─── WORKOUT-PLAN-PRO: فیلدهای حرفه‌ای جدید ───
    // تکنیک‌های پیشرفته استفاده‌شده در برنامه (FST-7، سوپرست آنتاگونیست، دراپ‌ست، رست پاز، و ...)
    advancedTechniques: Array.isArray(parsed.advancedTechniques)
      ? parsed.advancedTechniques.map((t: any) => String(t)).filter(Boolean)
      : undefined,
    // تقسیم عضلات هفته (push/pull/legs، upper/lower، body part split، و ...)
    muscleGroupSplit: typeof parsed.muscleGroupSplit === "string" && parsed.muscleGroupSplit.trim()
      ? parsed.muscleGroupSplit.trim()
      : undefined,
    // نوع دوره‌بندی (Periodization) — linear / undulating / block / wave / daily_undulating
    periodizationType: (() => {
      const v = parsed.periodizationType;
      if (v === "linear" || v === "undulating" || v === "block" || v === "wave" || v === "daily_undulating") {
        return v;
      }
      // پیش‌فرض بر اساس پلن: ultimate → undulating، بقیه → linear
      return planName === "ultimate" ? "undulating" : "linear";
    })(),
    // فرکانس تمرین هر گروه عضلانی در هفته
    muscleFrequencyPerWeek: typeof parsed.muscleFrequencyPerWeek === "number"
      ? Math.max(1, Math.min(3, Math.round(parsed.muscleFrequencyPerWeek)))
      : (planName === "ultimate" ? 2 : 1),
    // الهام‌گرفته از کدام مربی بزرگ
    inspiredByCoach: (() => {
      const v = parsed.inspiredByCoach;
      if (v === "hany_rambod" || v === "hadi_chupan" || v === "chris_bumstead" || v === "mixed") {
        return v;
      }
      // پیش‌فرض بر اساس پلن
      if (planName === "ultimate") return "mixed";
      if (planName === "advanced") return "chris_bumstead";
      return "mixed";
    })(),
    // جزئیات FST-7 — فقط برای پلن ultimate (و در صورت ارائه AI)
    fst7Details: parsed.fst7Details && typeof parsed.fst7Details === "object" && planName === "ultimate"
      ? {
          exerciseName: String(parsed.fst7Details.exerciseName || ""),
          sets: typeof parsed.fst7Details.sets === "number" ? Math.max(1, Math.min(10, Math.round(parsed.fst7Details.sets))) : 7,
          reps: typeof parsed.fst7Details.reps === "string" && parsed.fst7Details.reps.trim()
            ? parsed.fst7Details.reps.trim()
            : "8-12",
          restSec: typeof parsed.fst7Details.restSec === "number"
            ? Math.max(0, Math.min(300, Math.round(parsed.fst7Details.restSec)))
            : 30,
          note: typeof parsed.fst7Details.note === "string" && parsed.fst7Details.note.trim()
            ? parsed.fst7Details.note.trim()
            : undefined,
        }
      : undefined,
  };

  return enriched;
}

// Generate a daily meal plan via AI
export async function generateMealPlan(
  data: OnboardingData,
  planName?: Plan | null,
  extras?: { bloodTestReport?: string; videoAnalysisResult?: string; bodyPhotoAnalysis?: string; renewalContext?: string }
): Promise<ProMealPlanContent> {
  const systemPrompt = await getAiConfig(
    "nutrition_system_prompt",
    DEFAULT_NUTRITION_PROMPT
  );
  const context = buildUserContext(data, planName);
  const planInstructions = buildPlanAwareInstructions(planName, { ...extras, trainingExperience: data.trainingExperience });
  const caps = getCapabilities(planName ?? null);
  const tier = getExperienceBasedTechniqueGuidance(data.trainingExperience);

  // ─── محاسبه دقیق TDEE و کالری هدف (WORKOUT-PLAN-PRO) ───
  // از تابع computeTDEEAndTarget استفاده می‌کنیم که بر اساس Mifflin-St Jeor
  // و ضریب فعالیت واقعی کاربر (نه عدد ثابت ۱.۴) محاسبه می‌کند.
  const tdeeData = computeTDEEAndTarget(data);
  const targetCal = tdeeData.targetCalories;

  // Auto-calculated water goal (ml) — use stored value or compute from weight × 35
  const waterGoalMl = typeof data.waterGoalMl === "number" && data.waterGoalMl > 0
    ? data.waterGoalMl
    : Math.round(data.weight * 35);
  const waterGoalLiters = (waterGoalMl / 1000).toFixed(1);

  // Anti-inflammatory context — flag if user has injuries or medical conditions that benefit
  const hasInjuries = !!data.injuries && data.injuries.trim().length > 0;
  const hasMedicalConditions = Array.isArray(data.medicalConditions) && data.medicalConditions.length > 0;
  const needsAntiInflammatory = hasInjuries || hasMedicalConditions;

  const cuisineLabel = data.preferredCuisine
    ? PREFERRED_CUISINE_LABELS[data.preferredCuisine]
    : "ایرانی (پیش‌فرض)";

  const userPrompt = `بر اساس اطلاعات زیر، یک برنامه غذایی یک روزه کامل، حرفه‌ای و شخصی‌سازی‌شده بساز — سطح متخصص تغذیه ورزشی بالینی.

${context}
${planInstructions}

📊 محاسبه دقیق TDEE و درشت‌مغذی‌ها (محاسبه‌شده با فرمول Mifflin-St Jeor):
- BMR (متابولیسم پایه): ${tdeeData.bmr} کالری
- TDEE (نیاز روزانه با توجه به فعالیت): ${tdeeData.tdee} کالری
- کالری هدف (با ${tdeeData.calorieAdjustment >= 0 ? "مازاد" : "نقصان"} ${Math.abs(tdeeData.calorieAdjustment)} کالری): ${targetCal} کالری
- پروتئین: ${tdeeData.proteinG} گرم (${tdeeData.proteinPerKg} گرم به ازای هر کیلو وزن)
- کربوهیدرات: ${tdeeData.carbsG} گرم (${tdeeData.carbsPerKg} گرم به ازای هر کیلو)
- چربی: ${tdeeData.fatG} گرم (${tdeeData.fatPerKg} گرم به ازای هر کیلو)

کالری هدف روزانه: حدود ${targetCal} کالری
نوع رژیم: ${DIET_LABELS[data.dietType]}
حساسیت غذایی: ${data.allergies || "ندارد"}
غذاهای دوست‌نداشته/حذفی: ${data.dislikedFoods || "ندارد"}
سبک آشپزی ترجیحی: ${cuisineLabel}
هدف هیدراتاسیون روزانه: ${waterGoalLiters} لیتر (${waterGoalMl}ml)
${needsAntiInflammatory ? `🩹 نیاز به غذاهای ضدالتهابی: دارد (به دلیل آسیب‌دیدگی/شرایط پزشکی)` : ""}

فقط و فقط با ساختار JSON زیر پاسخ بده و هیچ متن اضافه‌ای ننویس:
{
  "meals": [
    {
      "type": "breakfast",
      "label": "صبحانه",
      "combination": "تخم‌مرغ + نان سنگک + پنیر کم‌چرب",
      "timingNote": "۳۰-۶۰ دقیقه بعد از بیدار شدن — پروتئین صبحانه متابولیسم را روشن می‌کند",
      "items": [
        {
          "name": "تخم‌مرغ آب‌پز (۳ عدد)",
          "category": "breakfast",
          "calories": 210, "protein": 18, "carbs": 1, "fat": 15,
          "servingSize": "۳ عدد",
          "glycemicIndex": "low",
          "antiInflammatory": false,
          "micronutrients": ["کولین", "ویتامین B12", "سلنیوم", "ویتامین D"],
          "prepTip": "آب‌پز کن، نه سرخ‌کرده — چربی اضافه نده"
        },
        {
          "name": "نان سنگک",
          "category": "breakfast",
          "calories": 160, "protein": 5, "carbs": 32, "fat": 1,
          "servingSize": "۱ کف دست",
          "glycemicIndex": "medium",
          "antiInflammatory": false,
          "micronutrients": ["فیبر", "سلنیوم", "منیزیم"],
          "prepTip": "تازه مصرف کن؛ نان روز قبل را گرم نکن"
        }
      ],
      "micronutrientHighlights": ["کولین برای مغز", "B12 برای انرژی", "فیبر برای گوارش"],
      "alternatives": [
        {
          "combination": "جو دوسر + شیر + موز",
          "items": [
            {"name": "جو دوسر (۶۰ گرم)", "category": "breakfast", "calories": 230, "protein": 8, "carbs": 40, "fat": 4, "servingSize": "۶۰ گرم", "glycemicIndex": "low", "antiInflammatory": true, "micronutrients": ["فیبر محلول", "بتاگلوکان", "منیزیم"], "prepTip": "با شیر بپز، نه آب — پروتئین بیشتر"},
            {"name": "شیر کم‌چرب", "category": "breakfast", "calories": 120, "protein": 8, "carbs": 12, "fat": 2, "servingSize": "۱ لیوان", "glycemicIndex": "low", "antiInflammatory": false, "micronutrients": ["کلسیم", "ویتامین D"], "prepTip": "کم‌چرب گرم کن"},
            {"name": "موز", "category": "breakfast", "calories": 105, "protein": 1, "carbs": 27, "fat": 0, "servingSize": "۱ عدد متوسط", "glycemicIndex": "medium", "antiInflammatory": true, "micronutrients": ["پتاسیم", "ویتامین B6"], "prepTip": "رسیده اما نه خیلی سیاه"}
          ]
        }
      ]
    }
  ],
  "waterLiters": ${waterGoalLiters},
  "hydrationSchedule": [
    {"time": "بلافاصله بعد از بیدار شدن", "amountMl": 500, "note": "با چند قطره لیموترش — کبد را فعال می‌کند"},
    {"time": "۹ صبح", "amountMl": 250, "note": "قبل از صبحانه"},
    {"time": "۱۱ صبح", "amountMl": 250, "note": "بین وعده‌ها"},
    {"time": "۱۳ ظهر (قبل از ناهار)", "amountMl": 250, "note": "۳۰ دقیقه قبل از غذا"},
    {"time": "۱۶ بعدازظهر", "amountMl": 300, "note": "میان‌وعده"},
    {"time": "۱۸ عصر (قبل از تمرین)", "amountMl": 300, "note": "آبرسانی قبل از تمرین"},
    {"time": "۲۰ شب (حین تمرین)", "amountMl": 500, "note": "هر ۱۵ دقیقه یک لیوان کوچک"},
    {"time": "۲۲ شب (بعد از تمرین)", "amountMl": 300, "note": "با الکترولیت اگر تعریق زیاد"},
    {"time": "۲۳ شب", "amountMl": 200, "note": "قبل از خواب — اما زیاد نخور که بیدارت نکند"}
  ],
  "prePostWorkoutNutrition": {
    "preWorkout": "۶۰-۹۰ دقیقه قبل از تمرین: ۳۰ گرم کربوهیدرات با GI پایین (مثل موز یا نان جو) + ۱۵ گرم پروتئین",
    "postWorkout": "۳۰-۶۰ دقیقه بعد از تمرین: ۳۰-۴۰ گرم پروتئین سریع‌جذب (مثل پروتئین وی یا تخم‌مرغ) + ۴۰ گرم کربوهیدرات با GI بالا (مثل برنج سفید یا سیب‌زمینی)",
    "note": "پنجره آنابولیک ۳۰-۴۵ دقیقه بعد از تمرین حساس‌ترین زمان برای سنتز پروتئین است"
  },
  "antiInflammatoryFoods": [
    "زردچوبه (با فلفل سیاه برای جذب بهتر)",
    "زنجبیل تازه (۲ گرم در روز)",
    "ماهی چرب (سالمون یا قزل‌آلا)",
    "چای سبز",
    "انار",
    "آووکادو",
    "روغن زیتون فرابکر"
  ],
  "micronutrientHighlights": [
    "ویتامین D3: ۱۰۰۰-۲۰۰۰ IU (با مشورت پزشک)",
    "منیزیم: ۳۰۰-۴۰۰mg برای ریکاوری عضله",
    "امگا ۳: ۱-۲ گرم برای کاهش التهاب",
    "آهن: در صورت کم‌خونی (با مشورت پزشک)"
  ],
  "foodPrepTips": [
    "یک روز در هفته (مثلاً جمعه) تمام پروتئین‌ها را بپز و در ظرف شیشه‌ای در یخچال نگه دار",
    "سبزیجات را شست و خشک کن، در ظرف هوادار نگه دار — تا ۵ روز تازه می‌مانند",
    "برنج و کینوا را یکجا بپز و فریز کن — روزانه یک پرس بردار",
    "سس‌ها و درسینگ‌ها را خودت درست کن (روغن زیتون + لیمو + ادویه) به‌جای سس‌های آماده",
    "میان‌وعده‌ها را از قبل در کیسه‌های کوچک پورشن کن — مچ‌نخوره و راحت"
  ],
  "tdeeBreakdown": {
    "bmr": ${tdeeData.bmr},
    "tdee": ${tdeeData.tdee},
    "targetCalories": ${targetCal},
    "calorieAdjustment": ${tdeeData.calorieAdjustment},
    "proteinG": ${tdeeData.proteinG},
    "carbsG": ${tdeeData.carbsG},
    "fatG": ${tdeeData.fatG},
    "proteinPerKg": ${tdeeData.proteinPerKg},
    "carbsPerKg": ${tdeeData.carbsPerKg},
    "fatPerKg": ${tdeeData.fatPerKg}
  },
  "dietAlternatives": [
    {
      "diet": "وگان (Vegan)",
      "description": "جایگزین کاملاً گیاهی برای این روز — بدون هیچ محصول حیوانی",
      "sampleMeals": ["عدس با برنج قهوه‌ای + سالاد", "توفو скандوبل با کینوا", "اسموتی بول با شیر بادام + پروتئین گیاهی"]
    },
    {
      "diet": "کتوژنیک (Keto)",
      "description": "کربوهیدرات زیر ۵۰ گرم، چربی بالا — برای ورزشکاران کتو",
      "sampleMeals": ["تخم‌مرغ + آووکادو + کره بادام", "سینه مرغ + کره + بروکلی", "ماهی سالمون + روغن نارگیل + اسفناج"]
    },
    {
      "diet": "کم‌کربوهیدرات (Low-Carb)",
      "description": "کربوهیدرات زیر ۱۰۰ گرم برای کنترل قند خون",
      "sampleMeals": ["سینه مرغ + سالاد سبزیجات", "تخم‌مرغ + پنیر + گوجه", "ماهی + سبزیجات بخارپز"]
    },
    {
      "diet": "بدون گلوتن (Gluten-Free)",
      "description": "برای حساسیت به گلوتن یا سلیاک",
      "sampleMeals": ["برنج قهوه‌ای + مرغ", "کینوا + سبزیجات", "سیب‌زمینی + ماهی"]
    }
  ],${caps.supplementsPlan ? `
  "supplementStack": [
    {"category": "base", "name": "کراتین مونوهیدرات", "dose": "۵ گرم", "timing": "هر روز صبح یا بعد تمرین", "note": "بدون فاز بارگیری، هر روز مصرف کن. با مشورت پزشک.", "contraindicatedFor": ["بیماری کلیوی", "نارسایی کلیه"]},
    {"category": "base", "name": "پروتئین وی", "dose": "۲۵-۳۰ گرم", "timing": "بعد از تمرین + یک وعده دیگر", "note": "سریع‌جذب، ایده‌آل برای پنجره آنابولیک.", "contraindicatedFor": ["حساسیت به لاکتوز (از isolate استفاده کنید)"]},
    {"category": "advanced", "name": "BCAA/EAA", "dose": "۵-۱۰ گرم", "timing": "حین تمرین", "note": "در صورت حجم تمرین بالا (بالای ۹۰ دقیقه).", "contraindicatedFor": []},
    {"category": "targeted", "name": "کافئین", "dose": "۱۰۰-۲۰۰mg", "timing": "۳۰ دقیقه قبل تمرین", "note": "افزایش تمرکز و قدرت. نه بعد از ۱۶:۰۰.", "contraindicatedFor": ["بیماری قلبی", "فشار خون بالا", "بی‌خوابی", "اضطراب"]}
  ],` : ""}
  "notes": "نکات تغذیه‌ای"${caps.supplementsPlan ? `,
  "supplements": [
    {"name": "نام مکمل (مثلاً کراتین مونوهیدرات)", "dose": "۵ گرم", "timing": "بعد از تمرین", "note": "نکته اختیاری"}
  ]` : ""}
}

قوانین حرفه‌ای (همه را رعایت کن):

۱) وعده‌ها و درشت‌مغذی‌ها (با محاسبه دقیق TDEE):
- وعده‌ها: صبحانه، ناهار، شام و حداقل یک میان‌وعده (در صورت هدف حجم/قدرت: ۵-۶ وعده).
- درشت‌مغذی‌ها را دقیق محاسبه کن تا جمع کل به کالری هدف (${targetCal}) نزدیک شود.
- پروتئین: ${tdeeData.proteinG} گرم در روز (${tdeeData.proteinPerKg} گرم به ازای هر کیلو — استاندارد جهانی).
- کربوهیدرات: ${tdeeData.carbsG} گرم در روز (${tdeeData.carbsPerKg} گرم به ازای هر کیلو).
- چربی: ${tdeeData.fatG} گرم در روز (حدود ۲۵٪ کالری، ${tdeeData.fatPerKg} گرم به ازای هر کیلو).
- تایمینگ تغذیه: صبحانه (پروتئین + کربوهیدرات پیچیده)، پیش‌تمرین (۹۰-۶۰ دقیقه قبل، GI متوسط)، پس‌تمرین (۳۰-۴۵ دقیقه بعد، پروتئین سریع + کربوهیدرات بالا)، شام (پروتئین + چربی سالم + سبزیجات).

۲) شاخص گلیسمی (GI) — حرفه‌ای:
- برای هر غذا فیلد "glycemicIndex" را پر کن: "low" | "medium" | "high".
- برای هدف کاهش چربی: ۸۰٪ غذاها GI پایین باشند.
- قبل از تمرین: GI متوسط (انرژی سریع).
- بعد از تمرین: GI بالا (ریکاوری سریع گلیکوژن).
- برای دیابت/پیش‌دیابت: فقط GI پایین.

۳) غذاهای ضدالتهابی (antiInflammatory):
- اگر کاربر آسیب‌دیدگی یا شرایط پزشکی دارد (${needsAntiInflammatory ? "دارد" : "ندارد"}):
  • برای هر غذا فیلد "antiInflammatory" را true/false بگذار.
  • آرایه "antiInflammatoryFoods" را با حداقل ۵ غذای ضدالتهایی پر کن (زردچوبه، زنجبیل، ماهی چرب، انار، چای سبز).
  • توصیه مصرف زردچوبه + فلفل سیاه (جذب را ۲۰ برابر می‌کند).
- اگر نه: می‌توانی فیلد را false بگذاری و آرایه را خالی یا چند مورد کلی.

۴) تایمینگ قبل/بعد از تمرین:
- فیلد "prePostWorkoutNutrition" را پر کن با توصیه دقیق قبل و بعد از تمرین.
- فیلد "timingNote" برای هر وعده: چه زمانی از روز بهتر است مصرف شود (نسبت به تمرین یا ساعت).

۵) هیدراتاسیون (بسیار مهم):
- "waterLiters" را بر اساس ${waterGoalLiters} لیتر تنظیم کن (هدف محاسبه‌شده از وزن و فعالیت).
- آرایه "hydrationSchedule" را با حداقل ۶ نقطه در طول روز پر کن — هر نقطه شامل: زمان، مقدار (ml)، و نکته.
- اگر کاربر عادت فعلی کم‌آبی دارد (${typeof data.waterHabit === "number" ? `${data.waterHabit} لیوان` : "نامشخص"}): افزایش تدریجی را در "notes" پیشنهاد بده.

۶) ویتامین‌ها و مواد معدنی:
- برای هر غذا فیلد "micronutrients" را با لیست ویتامین‌ها/مواد معدنی برجسته پر کن.
- برای هر وعده فیلد "micronutrientHighlights" را با توضیح کوتاه بگذار.
- آرایه "micronutrientHighlights" در سطح برنامه را با حداقل ۳-۴ توصیه کلی پر کن (ویتامین D، منیزیم، امگا ۳، و ...).

۷) آماده‌سازی غذا (foodPrepTips):
- آرایه "foodPrepTips" را با حداقل ۴ نکته عملی برای آماده‌سازی هفتگی غذا پر کن (مثل یک‌جا پختن پروتئین، نگه‌داری سبزیجات، فریز برنج، و ...).
- برای هر غذا فیلد "prepTip" را با نکته آماده‌سازی بهتر پر کن (مثلاً "بخارپز کن، نه سرخ‌کرده").

۸) تنوع و جایگزینی:
- **فیلد "combination"**: دقیقاً بنویس چه غذاهایی را با هم بخورد، مثلاً "تخم‌مرغ + نان سنگک + پنیر".
- **فیلد "alternatives"**: حداقل ۲ گزینه جایگزین بده.
- غذاهای دوست‌نداشته را حذف کن: ${data.dislikedFoods || "بدون محدودیت اضافه"}.
- حساسیت غذایی را رعایت کن: ${data.allergies || "بدون محدودیت"}.

۹) سبک آشپزی:
- سبک آشپزی مورد نظر: ${cuisineLabel}. غذاها را بر اساس این سبک انتخاب کن.
- اگر "ترکیبی" است: تنوع ایرانی/مدیترانه‌ای/آسیایی را بده.
- اگر "ایرانی": از مواد در دسترس ایرانی استفاده کن.
- اگر "مدیترانه‌ای": روغن زیتون، ماهی، غلات کامل، سبزیجات فراوان.
- اگر "آسیایی": برنج، سویا، سبزیجات بخارپز، ادویه‌های آسیایی.

۱۰) محدودیت‌های رژیمی:
- ${data.dietType === "vegetarian" ? "فقط غذاهای گیاه‌خواری." : "بدون محدودیت گوشت."}
- ${data.dietType === "vegan" ? "فقط غذاهای وگن." : ""}
- ${data.dietType === "keto" ? "رژیم کتوژنیک با کربوهیدرات زیر ۵۰ گرم در روز." : ""}

${caps.supplementsPlan ? `۱۱) بخش supplements و supplementStack (مکمل‌ها):
- بخش «supplements» (لیست ساده) را با حداقل ۴ مکمل پایه پر کن: پروتئین وی، کراتین، امگا۳، مولتی‌ویتامین.
- بخش «supplementStack» (دسته‌بندی‌شده) را با دسته‌بندی category: "base" | "advanced" | "targeted" پر کن.
${tier.level === "pro" ? `  • base (پایه): کراتین + پروتئین وی + امگا۳ + مولتی‌ویتامین
  • advanced (پیشرفته): BCAA/EAA + بتاآلانین + سیترین مالات + ZMA
  • targeted (هدفمند بر اساس هدف "${GOAL_LABELS[data.goal]}"):
    - چربی‌سوزی: ال-کارنیتین + کافئین
    - حجم: کراتین + گینر (اختیاری)
    - قدرت: سیترین + بتاآلانین` : tier.level === "advanced" ? `  • base (پایه): کراتین + پروتئین وی + امگا۳ + مولتی‌ویتامین + ویتامین D3
  • advanced (پیشرفته): BCAA + بتاآلانین + سیترین (اختیاری)` : `  • base (پایه): کراتین + پروتئین وی + امگا۳ + مولتی‌ویتامین`}
- هر مکمل باید فیلد contraindicatedFor (آرایه‌ای از شرایط منع مصرف) داشته باشد:
  • کافئین → بیماران قلبی، فشار خون بالا، بی‌خوابی
  • کراتین → بیماران کلیوی
  • گینر → دیابتی‌ها
  • ZMA → کسانی که مکمل زینک مصرف می‌کنند
- اگر کاربر مکمل فعلی مصرف می‌کند (${data.currentSupplements || "ندارد"}): تداخل و هماهنگی را در "note" بیاور.
- هرگز دوز بالاتر از استاندارد تجویز نکن. در note بنویس: «قبل از شروع با پزشک مشورت کنید.»` : ""}
۱۲) فیلد tdeeBreakdown (الزامی):
- این فیلد قبلاً با مقادیر محاسبه‌شده پر شده — مقادیر را دست نزن و در طرح وعده‌ها از آن‌ها استفاده کن.
- جمع کالری وعده‌ها باید به targetCalories نزدیک باشد (±۵۰ کالری).
- جمع پروتئین وعده‌ها باید به proteinG نزدیک باشد.

۱۳) فیلد dietAlternatives (الزامی):
- آرایه‌ای از جایگزین‌های رژیمی برای این روز — حداقل ۴ رژیم: وگان، کتوژنیک، کم‌کربوهیدرات، بدون گلوتن.
- هر جایگزین شامل: diet (نام)، description (توضیح کوتاه)، sampleMeals (آرایه ۳ وعده نمونه).
- غذاهای نمونه باید ایرانی و در دسترس باشند (عدس، کینوا، برنج قهوه‌ای، توفو، آووکادو، و ...).

۱۴) شخصی‌سازی بر اساس هدف و شرایط:
- هدف: ${GOAL_LABELS[data.goal]} — توزیع درشت‌مغذی را بر اساس هدف تنظیم کن.
- اگر خواب ناکافی یا استرس بالا: در "notes" توصیه‌های تغذیه‌ای برای بهبود خواب (منیزیم، کافیین قبل از ۱۴) و مدیریت کورتیزول (کاهش قند، افزایش امگا ۳) اضافه کن.`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[generateMealPlan] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);

  // Helper to coerce glycemicIndex to a valid value
  const coerceGI = (v: any): "low" | "medium" | "high" | undefined => {
    if (v === "low" || v === "medium" || v === "high") return v;
    return undefined;
  };

  // Calculate totals & enrich — handle main items + alternatives
  const meals = (parsed.meals || []).map((m: any) => {
    const items = (m.items || []).map((it: any, i: number) => ({
      ...it,
      id: `food_${Math.random().toString(36).slice(2, 9)}`,
      imageUrl: "",
      done: false,
      // NEW: professional enrichment fields
      glycemicIndex: coerceGI(it.glycemicIndex),
      antiInflammatory: typeof it.antiInflammatory === "boolean" ? it.antiInflammatory : undefined,
      micronutrients: Array.isArray(it.micronutrients) ? it.micronutrients.map((n: any) => String(n)) : undefined,
      prepTip: typeof it.prepTip === "string" && it.prepTip.trim() ? it.prepTip.trim() : undefined,
    }));
    // Enrich alternatives
    const alternatives = Array.isArray(m.alternatives) ? m.alternatives.map((alt: any, ai: number) => {
      const altItems = (alt.items || []).map((it: any, i: number) => ({
        ...it,
        id: `food_alt_${ai}_${Math.random().toString(36).slice(2, 9)}`,
        imageUrl: "",
        done: false,
        glycemicIndex: coerceGI(it.glycemicIndex),
        antiInflammatory: typeof it.antiInflammatory === "boolean" ? it.antiInflammatory : undefined,
        micronutrients: Array.isArray(it.micronutrients) ? it.micronutrients.map((n: any) => String(n)) : undefined,
        prepTip: typeof it.prepTip === "string" && it.prepTip.trim() ? it.prepTip.trim() : undefined,
      }));
      return {
        combination: alt.combination || "",
        items: altItems,
        totalCalories: altItems.reduce((s: number, x: any) => s + (x.calories || 0), 0),
      };
    }) : undefined;

    return {
      ...m,
      items,
      combination: m.combination || items.map((it: any) => it.name).join(" + "),
      alternatives,
      timingNote: typeof m.timingNote === "string" && m.timingNote.trim() ? m.timingNote.trim() : undefined,
      micronutrientHighlights: Array.isArray(m.micronutrientHighlights)
        ? m.micronutrientHighlights.map((h: any) => String(h))
        : undefined,
      totalCalories: items.reduce((s: number, x: any) => s + (x.calories || 0), 0),
      totalProtein: items.reduce((s: number, x: any) => s + (x.protein || 0), 0),
      totalCarbs: items.reduce((s: number, x: any) => s + (x.carbs || 0), 0),
      totalFat: items.reduce((s: number, x: any) => s + (x.fat || 0), 0),
    };
  });

  // Coerce prePostWorkoutNutrition if present
  let prePostWorkoutNutrition: MealPlanContent["prePostWorkoutNutrition"] = undefined;
  if (parsed.prePostWorkoutNutrition && typeof parsed.prePostWorkoutNutrition === "object") {
    const p = parsed.prePostWorkoutNutrition;
    prePostWorkoutNutrition = {
      preWorkout: String(p.preWorkout || ""),
      postWorkout: String(p.postWorkout || ""),
      note: typeof p.note === "string" && p.note.trim() ? p.note.trim() : undefined,
    };
  }

  return {
    meals,
    totalCalories: meals.reduce((s, m) => s + m.totalCalories, 0),
    totalProtein: meals.reduce((s, m) => s + m.totalProtein, 0),
    totalCarbs: meals.reduce((s, m) => s + m.totalCarbs, 0),
    totalFat: meals.reduce((s, m) => s + m.totalFat, 0),
    waterLiters: Number(parsed.waterLiters) || Number(waterGoalLiters) || 2.5,
    notes: parsed.notes || "در طول روز منظم آب بنوشید.",
    supplements: Array.isArray(parsed.supplements) && parsed.supplements.length > 0
      ? parsed.supplements.map((s: any, i: number) => ({
          name: String(s.name || `مکمل ${i + 1}`),
          dose: String(s.dose || ""),
          timing: String(s.timing || ""),
          note: s.note ? String(s.note) : undefined,
        }))
      : undefined,
    // NEW: professional enrichment fields
    hydrationSchedule: Array.isArray(parsed.hydrationSchedule)
      ? parsed.hydrationSchedule.map((h: any) => ({
          time: String(h.time || ""),
          amountMl: Number(h.amountMl) || 0,
          note: typeof h.note === "string" && h.note.trim() ? h.note.trim() : undefined,
        }))
      : undefined,
    antiInflammatoryFoods: Array.isArray(parsed.antiInflammatoryFoods)
      ? parsed.antiInflammatoryFoods.map((s: any) => String(s))
      : undefined,
    prePostWorkoutNutrition,
    foodPrepTips: Array.isArray(parsed.foodPrepTips)
      ? parsed.foodPrepTips.map((s: any) => String(s))
      : undefined,
    micronutrientHighlights: Array.isArray(parsed.micronutrientHighlights)
      ? parsed.micronutrientHighlights.map((s: any) => String(s))
      : undefined,
    // ─── WORKOUT-PLAN-PRO: فیلدهای حرفه‌ای جدید برنامه غذایی ───
    // تفکیک دقیق محاسبه TDEE و درشت‌مغذی‌ها (محاسبه‌شده با Mifflin-St Jeor)
    tdeeBreakdown: {
      bmr: tdeeData.bmr,
      tdee: tdeeData.tdee,
      targetCalories: tdeeData.targetCalories,
      calorieAdjustment: tdeeData.calorieAdjustment,
      proteinG: tdeeData.proteinG,
      carbsG: tdeeData.carbsG,
      fatG: tdeeData.fatG,
      proteinPerKg: tdeeData.proteinPerKg,
      carbsPerKg: tdeeData.carbsPerKg,
      fatPerKg: tdeeData.fatPerKg,
    },
    // جایگزین‌های رژیمی — وگان، کتو، کم‌کربوهیدرات، بدون گلوتن
    // اگر AI آرایه‌ای ارائه داد از آن استفاده کن، در غیر این صورت ۴ جایگزین پیش‌فرض
    dietAlternatives: Array.isArray(parsed.dietAlternatives) && parsed.dietAlternatives.length > 0
      ? parsed.dietAlternatives.map((d: any) => ({
          diet: String(d.diet || ""),
          description: String(d.description || ""),
          sampleMeals: Array.isArray(d.sampleMeals)
            ? d.sampleMeals.map((m: any) => String(m))
            : [],
        }))
      : [
          {
            diet: "وگان (Vegan)",
            description: "جایگزین کاملاً گیاهی — بدون هیچ محصول حیوانی",
            sampleMeals: [
              "عدس با برنج قهوه‌ای + سالاد",
              "توفو скандوبل با کینوا",
              "اسموتی بول با شیر بادام + پروتئین گیاهی",
            ],
          },
          {
            diet: "کتوژنیک (Keto)",
            description: "کربوهیدرات زیر ۵۰ گرم، چربی بالا",
            sampleMeals: [
              "تخم‌مرغ + آووکادو + کره بادام",
              "سینه مرغ + کره + بروکلی",
              "ماهی سالمون + روغن نارگیل + اسفناج",
            ],
          },
          {
            diet: "کم‌کربوهیدرات (Low-Carb)",
            description: "کربوهیدرات زیر ۱۰۰ گرم برای کنترل قند خون",
            sampleMeals: [
              "سینه مرغ + سالاد سبزیجات",
              "تخم‌مرغ + پنیر + گوجه",
              "ماهی + سبزیجات بخارپز",
            ],
          },
          {
            diet: "بدون گلوتن (Gluten-Free)",
            description: "برای حساسیت به گلوتن یا سلیاک",
            sampleMeals: [
              "برنج قهوه‌ای + مرغ",
              "کینوا + سبزیجات",
              "سیب‌زمینی + ماهی",
            ],
          },
        ],
    // استک مکمل پیشرفته — فقط برای پلن‌های دارای supplementsPlan (Standard+)
    supplementStack: caps.supplementsPlan && Array.isArray(parsed.supplementStack) && parsed.supplementStack.length > 0
      ? parsed.supplementStack.map((s: any) => ({
          category: (s.category === "base" || s.category === "advanced" || s.category === "targeted")
            ? s.category
            : "base",
          name: String(s.name || ""),
          dose: String(s.dose || ""),
          timing: String(s.timing || ""),
          note: typeof s.note === "string" && s.note.trim() ? s.note.trim() : undefined,
          contraindicatedFor: Array.isArray(s.contraindicatedFor)
            ? s.contraindicatedFor.map((c: any) => String(c))
            : undefined,
        }))
      : undefined,
  };
}

// AI chat - streaming not needed, return full message
export async function aiChat(
  data: OnboardingData | null,
  history: { role: string; content: string }[],
  userMessage: string,
  planName?: Plan | null
): Promise<string> {
  const systemPrompt = await getAiConfig("chat_system_prompt", DEFAULT_CHAT_PROMPT);

  const contextPart = data
    ? `\n\nاطلاعات کاربر فعلی:\n${buildUserContext(data, planName)}\n\nپاسخ‌هایت را بر اساس این اطلاعات شخصی‌سازی کن.`
    : "";

  // محدودیت بر اساس پلن: اگر Basic/Standard، فقط پاسخ محدود به برنامه تمرین/تغذیه
  const caps = getCapabilities(planName ?? null);
  const planNote = !caps.aiChatQuestions
    ? "\n\nتوجه: این کاربر به چت کامل دسترسی ندارد و فقط پاسخ محدود درباره برنامه موجود می‌بیند. اگر سوال خارج از برنامه پرسید، به خرید پلن Advanced دعوت کن."
    : "";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + contextPart + planNote },
    ...history.slice(-15).map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages,
    });
    return completion.choices[0]?.message?.content || "متأسفم، پاسخی دریافت نشد. دوباره تلاش کنید.";
  } catch (err) {
    console.error("[aiChat] AvalAI error:", err);
    throw new Error("خطا در ارتباط با مربی هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }
}

/** چت نیکا — دستیار فروش و راهنما (هیچ برنامه‌ای تجویز نمی‌کند) */
export async function nikaChat(
  history: { role: string; content: string }[],
  userMessage: string,
  userPlan: Plan | null,
  userInfo?: { name: string | null; mobile: string | null; planName: string | null; planExpiresAt: string | null; walletBalance: number }
): Promise<string> {
  const systemPrompt = await getAiConfig("nika_system_prompt", DEFAULT_NIKA_PROMPT);

  // اضافه کردن اطلاعات پلن کاربر برای راهنمایی هدفمند
  const planInfo = userPlan
    ? `\n\nوضعیت پلن کاربر: ${userPlan === "basic" ? "اقتصادی (بدون چت مربی)" : userPlan === "standard" ? "استاندارد (بدون چت مربی)" : userPlan === "advanced" ? "پیشرفته (چت مربی فعال)" : "حرفه‌ای (چت مربی فعال + آنالیز ویدیو/آزمایش خون + پشتیبانی اختصاصی)"}`
    : "\n\nوضعیت پلن کاربر: مهمان (بدون ثبت‌نام)";

  // ─── اطلاعات کاربر (برای شناخت کاربر) ───
  // نیکا باید کاربر را بشناسد — نام، شماره موبایل، پلن فعلی، تاریخ انقضا، موجودی کیف پول
  let userInfoContext = "";
  if (userInfo && userInfo.name) {
    userInfoContext = `\n\n👤 اطلاعات کاربر:\n- نام: ${userInfo.name}\n- موبایل: ${userInfo.mobile}\n- پلن فعلی: ${userInfo.planName || "ندارد"}\n- تاریخ انقضای پلن: ${userInfo.planExpiresAt ? new Date(userInfo.planExpiresAt).toLocaleDateString("fa-IR") : "—"}\n- موجودی کیف پول: ${userInfo.walletBalance.toLocaleString("en-US")} تومان\n`;
    userInfoContext += `\n⚠️ این کاربر را با نام صدا بزن و شخصی‌سازی پاسخ بده.`;
  }

  const upsellHint =
    !userPlan || userPlan === "basic" || userPlan === "standard"
      ? "\n\nیادآوری: این کاربر هنوز به چت مربی هوشمند دسترسی ندارد. او را به خرید پلن پیشرفته یا حرفه‌ای ترغیب کن."
      : "";

  // ─── قیمت‌های زنده پلن‌ها (آپدیت خودکار) ───
  // هر بار که نیکا فراخوانی می‌شود، قیمت‌های فعلی از DB خوانده می‌شود
  // تا وقتی ادمین قیمت‌ها را تغییر می‌دهد، نیکا همیشه قیمت‌های جدید را بداند
  let livePricing = "";
  try {
    const { getActivePlans } = await import("@/lib/fitness/pricing");
    const plans = await getActivePlans();
    livePricing = `\n\n💰 قیمت‌های فعلی پلن‌ها (همیشه به‌روز — این قیمت‌ها را به کاربر بگو):\n`;
    for (const p of plans) {
      livePricing += `- ${p.label}: ${p.price.toLocaleString("en-US")} تومان (${p.durationDays} روزه)\n`;
    }
    livePricing += `\n⚠️ مهم: فقط و فقط این قیمت‌های به‌روز را به کاربر بگو. قیمت‌های داخل پرامپت اولیه ممکن است قدیمی باشند — همیشه از این قیمت‌های زنده استفاده کن.`;
  } catch {
    // اگر DB در دسترس نبود، از قیمت‌های پیش‌فرض استفاده می‌شود
  }

  // ─── اشراف نیکا به مقالات سایت (آپدیت خودکار) ───
  // هر بار که نیکا فراخوانی می‌شود، لیست مقالات منتشرشده از DB خوانده می‌شود
  // تا نیکا همیشه به آخرین مقالات دسترسی داشته باشد
  let articlesContext = "";
  try {
    const articles = await db.article.findMany({
      where: { status: "published" },
      select: { title: true, slug: true, category: true, excerpt: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    if (articles.length > 0) {
      articlesContext = `\n\n📄 مقالات منتشرشده فیتاپ (${articles.length} مقاله — همیشه به‌روز):\n`;
      articlesContext += articles
        .map((a) => `- "${a.title}" (دسته: ${a.category}) — ${a.excerpt?.substring(0, 80) || ""}`)
        .join("\n");
      articlesContext += `\n\nمی‌توانی کاربران را به خواندن این مقالات دعوت کنی با فرمت: [عنوان مقاله](action:articles)`;
    }
  } catch {
    // DB may not be available
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + planInfo + userInfoContext + upsellHint + livePricing + articlesContext },
    ...history.slice(-10).map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages,
    });
    return completion.choices[0]?.message?.content || "متأسفم، پاسخی دریافت نشد. دوباره تلاش کنید.";
  } catch (err) {
    console.error("[nikaChat] AvalAI error:", err);
    throw new Error("خطا در ارتباط با نیکا. لطفاً کمی بعد دوباره تلاش کنید.");
  }
}

/** چت دستیار هوشمند پنل مدیریت — تحلیل آمار، پیشنهاد استراتژی، کمک در تولید محتوا */
export async function adminCopilotChat(
  history: { role: string; content: string }[],
  userMessage: string,
  context: { totalUsers: number; totalRevenue: number; activeSubs: number; pendingPrograms: number }
): Promise<string> {
  const systemPrompt = `تو دستیار هوش مصنوعی پنل مدیریت فیتاپ هستی. یک مشاور حرفه‌ای برای مدیران سایت که در تمام مراحل مدیریت کمک می‌کنی: تحلیل آمار، پیشنهاد استراتژی، کمک در نوشتن مقالات، بهینه‌سازی محتوا، پاسخ به سوالات فنی. به زبان فارسی پاسخ بده. اطلاعات فعلی سایت: ${context.totalUsers} کاربر، ${context.activeSubs} اشتراک فعال، ${context.pendingPrograms} برنامه در انتظار، درآمد کل: ${context.totalRevenue} تومان.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user", content: m.content })),
    { role: "user", content: userMessage },
  ];

  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages,
    });
    return completion.choices[0]?.message?.content || "متأسفم، پاسخی دریافت نشد.";
  } catch (err) {
    console.error("[adminCopilotChat] AvalAI error:", err);
    throw new Error("خطا در ارتباط با دستیار هوشمند مدیریت. لطفاً کمی بعد دوباره تلاش کنید.");
  }
}

// Swap a food with an AI-suggested equivalent
export async function swapFood(
  foodName: string,
  calories: number,
  dietType: string,
  allergies: string
): Promise<{ name: string; calories: number; protein: number; carbs: number; fat: number; servingSize: string; reason: string }> {
  const userPrompt = `یک غذای جایگزین هم‌کالری برای "${foodName}" (حدود ${calories} کالری) پیشنهاد بده.
نوع رژیم: ${dietType}
حساسیت غذایی: ${allergies || "ندارد"}

فقط JSON:
{"name":"نام غذا","calories":250,"protein":15,"carbs":30,"fat":8,"servingSize":"۱ وعده","reason":"دلیل پیشنهاد"}`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: "تو متخصص تغذیه هستی. فقط JSON معتبر برگردان." },
        { role: "user", content: userPrompt },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[swapFood] AvalAI error:", err);
    throw new Error("خطا در دریافت پیشنهاد جایگزین غذا. لطفاً دوباره تلاش کنید.");
  }

  return parseJsonFromContent(content);
}

// ============== Vision functions (Gemini 3.5 Flash via AvalAI) ==============

/**
 * آنالیز عکس غذا — تخمین کالری و درشت‌مغذی‌ها
 * از VISION_MODEL (gemini-3.5-flash) استفاده می‌کند.
 */
export async function analyzeMealPhoto(
  base64Image: string,
  mimeType: string,
  userContext: string
): Promise<{ calories: number; protein: number; carbs: number; fat: number; description: string }> {
  const systemPrompt = "تو متخصص تغذیه هستی. عکس غذا را تحلیل کن و کالری و درشت‌مغذی‌ها را تخمین بزن. فقط JSON معتبر برگردان و هیچ متن اضافه‌ای ننویس.";

  const userText = `این عکس غذا را تحلیل کن. ${userContext ? userContext + "\n\n" : ""}فقط با ساختار JSON زیر پاسخ بده:
{"calories": 350, "protein": 25, "carbs": 40, "fat": 12, "description": "توضیح کوتاه فارسی درباره غذا و ارزش غذایی آن"}`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeMealPhoto] AvalAI error:", err);
    throw new Error("خطا در آنالیز عکس غذا. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
    description: parsed.description || "توضیحی دریافت نشد.",
  };
}

/**
 * آنالیز عکس بدن — ارزیابی فرم بدن و توصیه‌ها
 * از VISION_MODEL (gemini-3.5-flash) استفاده می‌کند.
 */
export async function analyzeBodyPhoto(
  base64Image: string,
  mimeType: string,
  userContext: string
): Promise<{ bodyScore: number; analysis: string; recommendations: string[] }> {
  const systemPrompt = "تو متخصص فیزیولوژی ورزشی و آنالیز فرم بدن هستی. عکس بدن ورزشکار را تحلیل کن و امتیاز فرم بدن، تحلیل و توصیه‌های تمرینی بده. فقط JSON معتبر برگردان.";

  const userText = `این عکس بدن ورزشکار را تحلیل کن. ${userContext ? userContext + "\n\n" : ""}فقط با ساختار JSON زیر پاسخ بده:
{"bodyScore": 75, "analysis": "تحلیل فارسی درباره فرم بدن، تقارن، عضلات و نقاط ضعف/قوت", "recommendations": ["توصیه ۱", "توصیه ۲", "توصیه ۳"]}
امتیاز bodyScore بین ۰ تا ۱۰۰ باشد.`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeBodyPhoto] AvalAI error:", err);
    throw new Error("خطا در آنالیز عکس بدن. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    bodyScore: Number(parsed.bodyScore) || 0,
    analysis: parsed.analysis || "تحلیلی دریافت نشد.",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
  };
}

/**
 * آنالیز ویدیویی بدن — ارزیابی پوسچر، تقارن و فرم حرکات
 *
 * نکته مهم: VISION_MODEL (gemini-3.5-flash) در AvalAI از ویدیو پشتیبانی نمی‌کند،
 * فقط از عکس. به‌جای ارسال ویدیو به VLM:
 *   ۱) با ffmpeg یک فریم از وسط ویدیو استخراج می‌کنیم
 *   ۲) فریم را به‌عنوان عکس به VLM می‌دهیم
 *   ۳) پاسخ JSON را برمی‌گردانیم
 *
 * اگر ffmpeg نصب نباشد، پیام واضح فارسی برمی‌گرداند.
 */

/** بررسی موجود بودن ffmpeg با اجرای `ffmpeg -version`. */
async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * استخراج یک فریم از وسط ویدیو با ffmpeg.
 * مسیر فایل JPEG خروجی را برمی‌گرداند.
 * اگر ffmpeg نصب نباشد یا خطا بدهد، throw می‌کند.
 *
 * نکته: ابتدا طول ویدیو را با ffprobe (همراه ffmpeg) می‌گیریم، سپس فریم
 * ۵۰٪ زمان ویدیو را استخراج می‌کنیم. اگر ffprobe نبود، فریم ۱ ثانیه را
 * امتحان می‌کنیم.
 */
async function extractVideoFrame(videoPath: string): Promise<string> {
  const hasFfmpeg = await isFfmpegAvailable();
  if (!hasFfmpeg) {
    throw new Error(
      "تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود. لطفاً از عکس بدن استفاده کنید."
    );
  }

  // مسیر موقت برای فریم خروجی
  const outPath = path.join(tmpdir(), `fitup-frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);

  // تلاش برای گرفتن طول ویدیو با ffprobe
  let seekTime = "1"; // پیش‌فرض: ۱ ثانیه
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
      { timeout: 15000 }
    );
    const dur = parseFloat(stdout.trim());
    if (Number.isFinite(dur) && dur > 0) {
      // ۵۰٪ طول ویدیو — وسط آن. حداقل ۰.۵ ثانیه برای ویدیوهای خیلی کوتاه.
      seekTime = String(Math.max(0.5, dur / 2));
    }
  } catch {
    // ffprobe نیست یا خطا داد — با seekTime پیش‌فرض ادامه می‌دهیم
  }

  // استخراج فریم با ffmpeg
  // -ss قبل از -i برای seek سریع
  // -frames:v 1: فقط یک فریم
  // -q:v 2: کیفیت خوب JPEG
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss", seekTime,
        "-i", videoPath,
        "-frames:v", "1",
        "-q:v", "2",
        "-vf", "scale=1280:-2", // حداکثر عرض ۱۲۸۰ پیکسل (نسبت تصویر حفظ می‌شود)
        outPath,
      ],
      { timeout: 60000 }
    );
  } catch (err) {
    // پاک کردن احتمالی فایل ناقص
    try { await unlink(outPath); } catch {}
    throw new Error(
      `استخراج فریم از ویدیو ناموفق بود. ${err instanceof Error ? err.message.slice(0, 200) : ""}`.trim()
    );
  }

  // مطمئن شو فایل واقعاً ساخته شده
  try {
    const buf = await readFile(outPath);
    if (!buf || buf.length === 0) {
      throw new Error("فریم استخراج‌شده خالی است.");
    }
  } catch (err) {
    try { await unlink(outPath); } catch {}
    throw new Error(
      `استخراج فریم از ویدیو ناموفق بود. ${err instanceof Error ? err.message.slice(0, 200) : ""}`.trim()
    );
  }

  return outPath;
}

/**
 * تحلیل ویدیو از روی مسیر فایل روی دیسک.
 * ۱) فریم وسط ویدیو را با ffmpeg استخراج می‌کند
 * ۲) فریم را به VLM می‌دهد (VLM از عکس پشتیبانی می‌کند، نه ویدیو)
 * ۳) پاسخ JSON را برمی‌گرداند
 *
 * اگر ffmpeg نباشد، پیام واضح می‌دهد: «تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود...»
 */
export async function analyzeVideoFromPath(
  videoPath: string,
  userContext: string
): Promise<{ posture: string; symmetry: number; issues: string[]; recommendations: string[]; score: number }> {
  // ۱) استخراج فریم با ffmpeg
  let framePath: string | null = null;
  try {
    framePath = await extractVideoFrame(videoPath);
  } catch (err) {
    console.error("[analyzeVideoFromPath] frame extraction failed:", err);
    throw err;
  }

  // ۲) خواندن فریم به base64 و ارسال به VLM
  let content: string;
  try {
    const frameBuf = await readFile(framePath);
    const frameBase64 = frameBuf.toString("base64");

    const systemPrompt = "تو متخصص بیومکانیک ورزشی و آنالیز ویدیویی حرکات هستی. این فریم از ویدیوی ورزشکار است. پوسچر، تقارن، مشکلات فرم و توصیه‌های اصلاحی بده. فقط JSON معتبر برگردان.";

    const userText = `این فریم از ویدیوی ورزشکار است. ${userContext ? userContext + "\n\n" : ""}فقط با ساختار JSON زیر پاسخ بده:
{"posture": "توصیف فارسی پوسچر کلی", "symmetry": 85, "issues": ["مشکل ۱", "مشکل ۲"], "recommendations": ["توصیه اصلاحی ۱", "توصیه اصلاحی ۲"], "score": 78}
symmetry و score بین ۰ تا ۱۰۰ باشند.`;

    const completion = await avalaiClient.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frameBase64}` } },
          ],
        },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeVideoFromPath] VLM error:", err);
    const errMsg = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      errMsg.includes("video") ||
      errMsg.includes("media") ||
      errMsg.includes("unsupported") ||
      errMsg.includes("mime") ||
      errMsg.includes("invalid image") ||
      errMsg.includes("format")
    ) {
      throw new Error(
        "تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود. لطفاً از عکس بدن استفاده کنید."
      );
    }
    throw new Error("خطا در آنالیز ویدیوی بدن. لطفاً دوباره تلاش کنید.");
  } finally {
    // ۳) پاک کردن فریم موقت
    if (framePath) {
      try { await unlink(framePath); } catch {}
    }
  }

  // ۴) اعتبارسنجی پاسخ
  if (!content || content.trim() === "") {
    throw new Error("پاسخی از هوش مصنوعی دریافت نشد. لطفاً دوباره تلاش کنید.");
  }
  const looksLikeHtml = /^\s*<(?:html|!doctype|head|body|h1|div|p)\b/i.test(content) ||
    (content.startsWith("<") && content.includes("</") && !content.includes("{"));
  if (looksLikeHtml) {
    console.error("[analyzeVideoFromPath] AI returned HTML:", content.slice(0, 200));
    throw new Error("خطای سرور در پاسخ هوش مصنوعی. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  if (parsed?.notes && typeof parsed.notes === "string" && parsed.notes.includes("خطا") && !parsed.posture) {
    throw new Error(parsed.notes);
  }
  return {
    posture: parsed.posture || "توصیفی دریافت نشد.",
    symmetry: Number(parsed.symmetry) || 0,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((i: any) => String(i)) : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    score: Number(parsed.score) || 0,
  };
}

/**
 * نسخه legacy: تحلیل ویدیو از روی base64.
 * این تابع base64 را در فایل موقت می‌نویسد و سپس `analyzeVideoFromPath` را صدا می‌زند.
 *
 * پیشنهاد: در فراخوانی‌های جدید از `analyzeVideoFromPath` مستقیماً استفاده کنید
 * تا از نوشتن دو بار ویدیو جلوگیری شود.
 */
export async function analyzeVideoBody(
  base64Video: string,
  mimeType: string,
  userContext: string
): Promise<{ posture: string; symmetry: number; issues: string[]; recommendations: string[]; score: number }> {
  if (!base64Video) {
    throw new Error("تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود. لطفاً از عکس بدن استفاده کنید.");
  }

  // نوشتن base64 در فایل موقت
  const ext = mimeType.includes("webm") ? "webm"
    : mimeType.includes("quicktime") || mimeType.includes("mov") ? "mov"
    : mimeType.includes("x-matroska") ? "mkv"
    : "mp4";
  const tmpPath = path.join(tmpdir(), `fitup-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  try {
    const buffer = Buffer.from(base64Video, "base64");
    await mkdir(path.dirname(tmpPath), { recursive: true });
    await writeFile(tmpPath, buffer);
    // تحلیل از روی فایل
    return await analyzeVideoFromPath(tmpPath, userContext);
  } finally {
    // پاک کردن فایل موقت
    try { await unlink(tmpPath); } catch {}
  }
}

/**
 * تحلیل آزمایش خون — استخراج نشانگرها، کمبودها و توصیه‌ها
 * از VISION_MODEL (gemini-3.5-flash) استفاده می‌کند.
 *
 * پنل آزمایش شامل ۱۰ دسته کامل: CBC، چربی، کبد، کلیه، تیروئید،
 * هورمون‌ها (تستوسترون/کورتیزول/انسولین/HGH/...)، ویتامین‌ها و مواد معدنی،
 * قند خون و نشانگرهای التهاب.
 */
export async function analyzeBloodTest(
  base64Image: string,
  mimeType: string
): Promise<{
  overall: string;
  score: number;
  markers: Array<{
    key?: string;
    category?: string;
    categoryName?: string;
    name: string;
    value: string;
    unit?: string;
    status: "normal" | "low" | "high" | "borderline" | "unknown";
    reference?: string;
    explanation?: string;
  }>;
  deficiencies: string[];
  recommendations: string[];
  supplements: string[];
  warnings: string[];
}> {
  const systemPrompt =
    "تو متخصص پزشکی، تغذیه ورزشی و تحلیل آزمایش خون هستی. عکس آزمایش خون را با دقت بررسی کن، مقادیر هر نشانگر را استخراج کن، با محدوده نرمال مقایسه کن و برای ورزشکاران و بدنسازان تحلیل کن. فقط JSON معتبر برگردان.";

  const userText = `این عکس آزمایش خون را به دقت بررسی کن. مقادیر هر تست را از روی برگه آزمایش استخراج کن و تحلیل کن.

پنل کامل آزمایش‌های مورد انتظار (۱۰ دسته):
${bloodTestPromptSummary()}

برای هر نشانگری که در عکس وجود دارد، یک آبجکت به markers اضافه کن. اگر تستی در عکس نبود، آن را درج نکن.

فقط با ساختار JSON زیر پاسخ بده:
{
  "overall": "ارزیابی کلی فارسی از وضعیت سلامت ورزشکار (۲-۳ جمله)",
  "score": 75,
  "markers": [
    {
      "key": "hemoglobin",
      "category": "cbc",
      "categoryName": "آزمایش خون کامل (CBC)",
      "name": "هموگلوبین",
      "value": "۱۴.۲",
      "unit": "g/dL",
      "status": "normal",
      "reference": "۱۳-۱۷",
      "explanation": "توضیح فارسی کوتاه درباره وضعیت و معنای آن برای ورزشکار"
    }
  ],
  "deficiencies": ["کمبود ویتامین D", "کمبود آهن"],
  "recommendations": [
    "توصیه غذایی ۱ (مثلاً مصرف بیشتر گوشت قرمز)",
    "توصیه غذایی ۲"
  ],
  "supplements": [
    "مکمل توصیه‌شده ۱ (مثلاً ویتامین D3 2000 IU روزانه)",
    "مکمل توصیه‌شده ۲"
  ],
  "warnings": ["هشدار پزشکی حیاتی در صورت وجود"]
}

قوانین:
- score عددی بین ۰ تا ۱۰۰ بر اساس سلامت کلی.
- status فقط یکی از: normal | low | high | borderline | unknown
- key باید یکی از کلیدهای تعریف‌شده در پنل بالا باشد (hemoglobin, testosterone_total, vitamin_d, ...).
- category همان id دسته است (cbc, lipid, liver, kidney, thyroid, hormones, vitamins_minerals, blood_sugar, inflammation).
- explanation حتماً فارسی و کوتاه (۱-۲ جمله) باشد و به تأثیر آن روی عملکرد ورزشکار اشاره کند.
- deficiencies شامل کمبودها و مقادیر خارج محدوده باشد.
- recommendations شامل توصیه‌های غذایی و سبک زندگی باشد.
- supplements شامل مکمل‌های پیشنهادی با دوز و زمان مصرف باشد.
- warnings شامل مواردی که نیاز به مراجعه فوری به پزشک دارند.
- اگر تستی در عکس نبود، آن را در markers درج نکن.

هشدار مهم: این تحلیل جایگزین مشورت پزشک نیست و صرفاً جنبه راهنمایی دارد.`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeBloodTest] AvalAI error:", err);
    throw new Error("خطا در تحلیل آزمایش خون. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    overall: parsed.overall || "ارزیابی‌ای دریافت نشد.",
    score: Number(parsed.score) || 0,
    markers: Array.isArray(parsed.markers) ? parsed.markers : [],
    deficiencies: Array.isArray(parsed.deficiencies) ? parsed.deficiencies.map((d: any) => String(d)) : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    supplements: Array.isArray(parsed.supplements)
      ? parsed.supplements.map((s: any) => String(s))
      : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((w: any) => String(w)) : [],
  };
}

/**
 * تحلیل چکاپ دوره‌ای بر اساس داده‌های متنی (وزن، اندازه‌ها، بازخورد).
 * این تابع بدون نیاز به عکس، با استفاده از مدل متنی، امتیاز بدن (bodyScore 0-100)،
 * تحلیل فارسی و توصیه‌های پیشرفت تولید می‌کند.
 */

/**
 * Reference point for comparison. This can be either:
 *  - The user's previous checkup (most recent before the current one), OR
 *  - The user's onboarding baseline (height/weight/measurements from onboarding)
 *    when this is the first checkup.
 *
 * All fields are optional — we only compare what's available.
 */
export interface CheckupReferencePoint {
  /** Source label: "previous_checkup" | "onboarding_baseline" */
  source: "previous_checkup" | "onboarding_baseline";
  /** Days between the reference point and the current checkup */
  daysAgo?: number;
  weight?: number | null;
  bodyFatPercent?: number | null;
  leanBodyMass?: number | null;
  chestMeasurement?: number | null;
  armMeasurement?: number | null;
  waistMeasurement?: number | null;
  hipMeasurement?: number | null;
  thighMeasurement?: number | null;
  fatigueLevel?: number | null;
  sleepQuality?: number | null;
  dietAdherence?: number | null;
  workoutAdherence?: number | null;
}

export interface CheckupAnalysisInput {
  weight: number;
  bodyFatPercent?: number | null;
  leanBodyMass?: number | null;
  chestMeasurement?: number | null;
  armMeasurement?: number | null;
  waistMeasurement?: number | null;
  hipMeasurement?: number | null;
  thighMeasurement?: number | null;
  fatigueLevel: number; // 1-5
  sleepQuality: number; // 1-5
  dietAdherence: number; // 1-5
  workoutAdherence: number; // 1-5
  notes?: string;
  phaseNumber: number;
  userContext?: string; // اطلاعات آنبوردینگ و پلن کاربر
  /**
   * Optional reference point for comparison.
   *  - For the FIRST checkup, pass the onboarding baseline (weight, bodyFat, measurements).
   *  - For subsequent checkups, pass the most recent previous checkup.
   * The AI will use this to compute deltas (e.g. weight change) and assess progress.
   */
  referencePoint?: CheckupReferencePoint | null;
  /** User's primary goal from onboarding (e.g. "fat_loss", "muscle_gain") — used to frame progress assessment */
  goal?: string | null;
}

export async function analyzeCheckup(
  input: CheckupAnalysisInput
): Promise<{
  bodyScore: number;
  bodyFatStatus: string;
  analysis: string;
  recommendations: string[];
  nextPhaseFocus: string;
}> {
  const systemPrompt =
    "تو مربی هوشمند و متخصص فیزیولوژی ورزشی و تغذیه فیتاپ هستی. داده‌های چکاپ دوره‌ای ورزشکار را به‌همراه نقطه مرجع (چکاپ قبلی یا داده‌های آنبوردینگ) تحلیل کن. امتیاز بدن (bodyScore 0-100)، وضعیت چربی بدن، تحلیل کلی شامل مقایسه با نقطه مرجع (تغییر وزن، تغییر اندازه‌ها، روند پیشرفت)، توصیه‌های پیشرفت و تمرکز فاز بعدی را ارائه بده. تحلیل باید دقیقاً بر اساس اختلاف بین داده‌های فعلی و نقطه مرجع باشد. فقط JSON معتبر برگردان و هیچ متن اضافه‌ای ننویس.";

  // ─── Build the "current measurements" section ───
  const parts: string[] = [
    `فاز تمرینی: ${input.phaseNumber}`,
    `وزن فعلی: ${input.weight} کیلوگرم`,
  ];
  if (input.bodyFatPercent != null) parts.push(`درصد چربی بدن فعلی (تخمینی): ${input.bodyFatPercent.toFixed(1)}٪`);
  if (input.leanBodyMass != null) parts.push(`جرم خالص بدن فعلی: ${input.leanBodyMass.toFixed(1)} کیلوگرم`);
  if (input.chestMeasurement != null) parts.push(`دور سینه فعلی: ${input.chestMeasurement} cm`);
  if (input.armMeasurement != null) parts.push(`دور بازو فعلی: ${input.armMeasurement} cm`);
  if (input.waistMeasurement != null) parts.push(`دور کمر فعلی: ${input.waistMeasurement} cm`);
  if (input.hipMeasurement != null) parts.push(`دور باسن فعلی: ${input.hipMeasurement} cm`);
  if (input.thighMeasurement != null) parts.push(`دور ران فعلی: ${input.thighMeasurement} cm`);
  parts.push(
    `خستگی (1-5): ${input.fatigueLevel}`,
    `کیفیت خواب (1-5): ${input.sleepQuality}`,
    `پیروی از رژیم (1-5): ${input.dietAdherence}`,
    `پیروی از تمرین (1-5): ${input.workoutAdherence}`
  );
  if (input.notes && input.notes.trim()) parts.push(`یادداشت ورزشکار: ${input.notes}`);

  // ─── Build the "reference point" section (previous checkup or onboarding baseline) ───
  // This is the KEY addition: we feed the AI a comparison point so it can compute
  // deltas (weight change, measurement change, adherence trend) and write a
  // progress-aware analysis instead of a generic one.
  let referenceSection = "";
  if (input.referencePoint) {
    const ref = input.referencePoint;
    const refLabel =
      ref.source === "previous_checkup" ? "چکاپ قبلی" : "داده‌های پایه آنبوردینگ (اولین ارزیابی)";
    const refLines: string[] = [`نقطه مرجع: ${refLabel}`];
    if (typeof ref.daysAgo === "number" && ref.daysAgo >= 0) {
      refLines.push(`بازه زمانی از نقطه مرجع تا الان: ${ref.daysAgo} روز`);
    }
    if (ref.weight != null) {
      const delta = input.weight - ref.weight;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`وزن نقطه مرجع: ${ref.weight} کیلوگرم (تغییر: ${sign}${delta.toFixed(1)} کیلوگرم)`);
    }
    if (ref.bodyFatPercent != null && input.bodyFatPercent != null) {
      const delta = input.bodyFatPercent - ref.bodyFatPercent;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`درصد چربی بدن نقطه مرجع: ${ref.bodyFatPercent.toFixed(1)}٪ (تغییر: ${sign}${delta.toFixed(1)}٪)`);
    }
    if (ref.leanBodyMass != null && input.leanBodyMass != null) {
      const delta = input.leanBodyMass - ref.leanBodyMass;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`جرم خالص بدن نقطه مرجع: ${ref.leanBodyMass.toFixed(1)} کیلوگرم (تغییر: ${sign}${delta.toFixed(1)} کیلوگرم)`);
    }
    if (ref.chestMeasurement != null && input.chestMeasurement != null) {
      const delta = input.chestMeasurement - ref.chestMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور سینه نقطه مرجع: ${ref.chestMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.armMeasurement != null && input.armMeasurement != null) {
      const delta = input.armMeasurement - ref.armMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور بازو نقطه مرجع: ${ref.armMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.waistMeasurement != null && input.waistMeasurement != null) {
      const delta = input.waistMeasurement - ref.waistMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور کمر نقطه مرجع: ${ref.waistMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.hipMeasurement != null && input.hipMeasurement != null) {
      const delta = input.hipMeasurement - ref.hipMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور باسن نقطه مرجع: ${ref.hipMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.thighMeasurement != null && input.thighMeasurement != null) {
      const delta = input.thighMeasurement - ref.thighMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور ران نقطه مرجع: ${ref.thighMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.fatigueLevel != null) refLines.push(`خستگی در نقطه مرجع (1-5): ${ref.fatigueLevel}`);
    if (ref.sleepQuality != null) refLines.push(`کیفیت خواب در نقطه مرجع (1-5): ${ref.sleepQuality}`);
    if (ref.dietAdherence != null) refLines.push(`پیروی از رژیم در نقطه مرجع (1-5): ${ref.dietAdherence}`);
    if (ref.workoutAdherence != null) refLines.push(`پیروی از تمرین در نقطه مرجع (1-5): ${ref.workoutAdherence}`);
    referenceSection = `\n\n━━━ نقطه مرجع برای مقایسه ━━━\n${refLines.join("\n")}`;
  } else {
    referenceSection = "\n\n━━━ نقطه مرجع برای مقایسه ━━━\nنقطه مرجعی در دسترس نیست (اولین چکاپ و بدون داده آنبوردینگ). لطفاً تحلیل اولیه ارائه بده.";
  }

  // ─── Goal framing ───
  // The user's primary goal (e.g. "fat_loss", "muscle_gain") determines whether
  // weight gain/loss is "good" or "bad" progress. We tell the AI to interpret
  // the deltas in the context of the user's goal.
  let goalSection = "";
  if (input.goal) {
    const goalLabels: Record<string, string> = {
      fat_loss: "کاهش چربی (چربی‌سوزی)",
      muscle_gain: "افزایش عضله (عضله‌سازی)",
      endurance: "افزایش استقامت",
      fitness: "تناسب اندام عمومی",
      strength: "افزایش قدرت",
    };
    const goalLabel = goalLabels[input.goal] || input.goal;
    goalSection = `\n\nهدف اصلی ورزشکار: ${goalLabel}\nمهم: تحلیل پیشرفت باید بر اساس این هدف باشد. مثلاً اگر هدف «کاهش چربی» است، کاهش وزن و کاهش دور کمر پیشرفت مثبت است؛ اگر هدف «عضله‌سازی» است، افزایش وزن (به‌اندازه متناسب) و افزایش دور بازو/سینه پیشرفت مثبت است.`;
  }

  if (input.userContext) parts.push(`\nاطلاعات ورزشکار:\n${input.userContext}`);

  const userText = `داده‌های چکاپ دوره‌ای ورزشکار را تحلیل کن:

━━━ داده‌های فعلی ━━━
${parts.join("\n")}${referenceSection}${goalSection}

فقط با ساختار JSON زیر پاسخ بده:
{
  "bodyScore": 75,
  "bodyFatStatus": "ارزیابی کوتاه فارسی درباره وضعیت فعلی چربی بدن",
  "analysis": "تحلیل کامل فارسی (۲-۳ پاراگراف). حتماً شامل این موارد باشد: ۱) مقایسه وزن و اندازه‌های فعلی با نقطه مرجع (با ذکر مقدار تغییر)، ۲) ارزیابی پیشرفت بر اساس هدف کاربر (آیا روند در جهت درست است؟)، ۳) چه چیزی خوب پیش رفته، ۴) چه چیزی نیاز به تنظیم دارد، ۵) وضعیت کلی بدن.",
  "recommendations": ["توصیه تمرینی ۱", "توصیه تغذیه‌ای ۲", "توصیه ریکاوری ۳"],
  "nextPhaseFocus": "تمرکز اصلی فاز بعدی (یک جمله فارسی)"
}

قوانین امتیازدهی bodyScore (۰ تا ۱۰۰):
- امتیاز بر اساس پیروی از برنامه (تمرین + رژیم)، کیفیت خواب، سطح خستگی و میزان پیشرفت نسبت به نقطه مرجع باشد.
- اگر پیروی از برنامه بالا (۴-۵)، خواب خوب (۴-۵) و پیشرفت در جهت هدف باشد → امتیاز ۸۰-۱۰۰.
- اگر پیروی متوسط (۳) و خستگی زیاد (۴-۵) → امتیاز ۵۰-۷۰.
- اگر پیروی پایین (۱-۲) یا پیشرفت منفی (دور از هدف) → امتیاز زیر ۵۰.
توصیه‌ها عملی، مشخص و بر اساس داده‌های واقعی همین ورزشکار باشند (نه کلیشه‌ای).`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeCheckup] AvalAI error:", err);
    throw new Error("خطا در تحلیل چکاپ. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    bodyScore: Math.max(0, Math.min(100, Number(parsed.bodyScore) || 0)),
    bodyFatStatus: parsed.bodyFatStatus || "ارزیابی‌ای دریافت نشد.",
    analysis: parsed.analysis || "تحلیلی دریافت نشد.",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    nextPhaseFocus: parsed.nextPhaseFocus || "ادامه مسیر با تمرکز بر پیشرفت تدریجی.",
  };
}

// Parse JSON from LLM content (handles markdown code fences + HTML error pages gracefully)
function parseJsonFromContent(content: string): any {
  if (!content || typeof content !== "string") {
    return { days: [], meals: [], notes: "پاسخ هوش مصنوعی خالی بود." };
  }

  let cleaned = content.trim();

  // Detect HTML error pages (gateway error, 502/504, AvalAI returning HTML)
  // If the content looks like HTML and contains no JSON braces, bail out gracefully.
  const looksLikeHtml = /^\s*<(?:html|!doctype|head|body|h1|div|p)\b/i.test(cleaned) ||
    (cleaned.startsWith("<") && cleaned.includes("</") && !cleaned.includes("{"));
  if (looksLikeHtml) {
    console.error("[parseJsonFromContent] AI returned HTML (likely an error page):", cleaned.slice(0, 200));
    return { days: [], meals: [], notes: "خطا در پاسخ هوش مصنوعی. لطفاً دوباره تلاش کنید." };
  }

  // Extract JSON from ```json ... ``` or ``` ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find first { and last }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[parseJsonFromContent] JSON parse failed. Raw content:", content.slice(0, 300), err);
    return { days: [], meals: [], notes: "خطا در پردازش پاسخ هوش مصنوعی." };
  }
}

/* ============================================================
   تحلیل هوشمند حسابداری مدیریت (ACCOUNTING-SYSTEM)
   دریافت خلاصه آماری یک بازه (یا مقایسه دو بازه) و تولید تحلیل
   ساختاریافته شامل: خلاصه، نقاط قوت، نقاط ضعف، راهکار افزایش
   فروش و پیش‌بینی روند.
   ============================================================ */
export interface AccountingAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  salesRecommendations: string[];
  forecast: string;
  healthScore: number; // 0-100
}

export async function analyzeAccountingData(
  payload: Record<string, any>,
  mode: "overview" | "compare" | "details"
): Promise<AccountingAnalysis> {
  const modeLabels: Record<string, string> = {
    overview: "تحلیل کلی یک بازه زمانی",
    compare: "مقایسه دو بازه زمانی",
    details: "تحلیل جزئیات پرداخت‌ها و تراکنش‌ها",
  };

  const systemPrompt = `تو یک تحلیل‌گر ارشد مالی و کسب‌وکار برای پلتفرم فیتاپ (اپلیکیشن سلامت و تناسب اندام با سیستم اشتراک ۴ سطحه: اقتصادی، استاندارد، پیشرفته، حرفه‌ای) هستی. وظیفه تو تحلیل داده‌های حسابداری مدیریت و ارائه بینش عملیاتی به مدیران است.
به زبان فارسی روان و حرفه‌ای پاسخ بده.
خروجی تو باید یک JSON معتبر دقیقاً با ساختار زیر باشد و هیچ متن اضافه‌ای بیرون JSON ننویسی:
{
  "summary": "خلاصه وضعیت در ۲-۴ جمله",
  "strengths": ["نقطه قوت ۱", "نقطه قوت ۲", ...],
  "weaknesses": ["نقطه ضعف ۱", "نقطه ضعف ۲", ...],
  "salesRecommendations": ["راهکار عملیاتی ۱", "راهکار عملیاتی ۲", ...],
  "forecast": "پیش‌بینی روند ۳۰ روز آینده در ۲-۳ جمله",
  "healthScore": 75
}
نکات:
- strengths و weaknesses بین ۲ تا ۵ مورد
- salesRecommendations بین ۳ تا ۶ مورد کاملاً عملیاتی و قابل اجرا (نه کلیشه)
- healthScore عددی بین ۰ تا ۱۰۰ که سلامت مالی کسب‌وکار را در این بازه نشان می‌دهد
- همیشه اعداد را به تومان و با قالب خوانا توصیف کن
- اگر داده کم است، صادقانه اشاره کن اما تحلیل کلی ارائه بده`;

  const userPrompt = `حالت تحلیل: ${modeLabels[mode]}

داده‌ها (JSON):
${JSON.stringify(payload, null, 2)}

لطفاً بر اساس این داده‌ها یک تحلیل کامل و ساختاریافته ارائه بده. فقط JSON.`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeAccountingData] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس تحلیل هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  const result: AccountingAnalysis = {
    summary: typeof parsed.summary === "string" ? parsed.summary : "تحلیل در دسترس نیست.",
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    salesRecommendations: Array.isArray(parsed.salesRecommendations)
      ? parsed.salesRecommendations.filter((s: any) => typeof s === "string").slice(0, 8)
      : [],
    forecast: typeof parsed.forecast === "string" ? parsed.forecast : "پیش‌بینی در دسترس نیست.",
    healthScore:
      typeof parsed.healthScore === "number" && !isNaN(parsed.healthScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.healthScore)))
        : 50,
  };
  return result;
}

/* ============================================================
   تحلیل هوشمند نظرسنجی‌ها (SURVEY-SYSTEM)
   دریافت خلاصه آماری نظرسنجی‌های یک بازه/پلن و تولید تحلیل
   ساختاریافته شامل: خلاصه وضعیت، نقاط قوت، نقاط ضعف، راهکار
   بهبود و میانگین رضایت کلی.
   ============================================================ */
export interface SurveyAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  overallSatisfaction: number; // 0-5
  sentiment: "very_positive" | "positive" | "neutral" | "negative" | "very_negative";
}

/**
 * تحلیل هوشمند نظرسنجی‌های پایان پلن با AI.
 *
 * @param payload داده‌های تجمیعی نظرسنجی (stats + sample comments)
 */
export async function analyzeSurveys(
  payload: Record<string, any>
): Promise<SurveyAnalysis> {
  const systemPrompt = `تو یک تحلیل‌گر ارشد تجربه کاربری و محصول برای پلتفرم فیتاپ (اپلیکیشن سلامت و تناسب اندام) هستی. وظیفه تو تحلیل نظرسنجی‌های کاربران پایان پلن و ارائه بینش عملیاتی به تیم محصول است.
به زبان فارسی روان و حرفه‌ای پاسخ بده.
خروجی تو باید یک JSON معتبر دقیقاً با ساختار زیر باشد و هیچ متن اضافه‌ای بیرون JSON ننویسی:
{
  "summary": "خلاصه وضعیت نظرات کاربران در ۲-۴ جمله",
  "strengths": ["نقطه قوت ۱", "نقطه قوت ۲", ...],
  "weaknesses": ["نقطه ضعف ۱", "نقطه ضعف ۲", ...],
  "recommendations": ["راهکار بهبود ۱", "راهکار بهبود ۲", ...],
  "overallSatisfaction": 4.2,
  "sentiment": "positive"
}
نکات:
- strengths و weaknesses بین ۲ تا ۶ مورد، بر اساس نمرات واقعی و نظرات کاربران
- recommendations بین ۳ تا ۶ راهکار کاملاً عملیاتی و قابل اجرا برای بهبود محصول
- overallSatisfaction میانگین رضایت کلی (عدد اعشاری بین ۰ تا ۵) بر اساس تمام نمرات
- sentiment یکی از مقادیر: very_positive, positive, neutral, negative, very_negative
- به نمرات پایین (۱ و ۲) و نظرات منفی به‌طور ویژه توجه کن
- اگر نظرات کاربران را می‌بینی، الگوهای تکراری را استخراج کن`;

  const userPrompt = `داده‌های نظرسنجی (JSON):
${JSON.stringify(payload, null, 2)}

لطفاً بر اساس این داده‌ها یک تحلیل کامل و ساختاریافته ارائه بده. فقط JSON.`;

  let content: string;
  try {
    const completion = await avalaiClient.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    content = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[analyzeSurveys] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس تحلیل هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  const validSentiments: SurveyAnalysis["sentiment"][] = [
    "very_positive", "positive", "neutral", "negative", "very_negative",
  ];

  let sentiment: SurveyAnalysis["sentiment"] = "neutral";
  if (typeof parsed.sentiment === "string" && validSentiments.includes(parsed.sentiment as any)) {
    sentiment = parsed.sentiment as SurveyAnalysis["sentiment"];
  }

  let overall: number =
    typeof parsed.overallSatisfaction === "number" && !isNaN(parsed.overallSatisfaction)
      ? parsed.overallSatisfaction
      : 0;
  overall = Math.max(0, Math.min(5, Math.round(overall * 10) / 10));

  const result: SurveyAnalysis = {
    summary: typeof parsed.summary === "string" ? parsed.summary : "تحلیل در دسترس نیست.",
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((s: any) => typeof s === "string").slice(0, 8)
      : [],
    overallSatisfaction: overall,
    sentiment,
  };
  return result;
}
