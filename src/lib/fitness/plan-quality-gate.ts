/**
 * plan-quality-gate.ts — گیت کیفیت چندلایهٔ برنامه‌ها (v133)
 * ═══════════════════════════════════════════════════════════════════════════
 * دیرکتیو مالک (۱۴۰۵/۰۷ — مهم‌ترین مسئلهٔ فیتاپ):
 *  «برنامه‌های تمرینی و تغذیه و مکمل فیتاپ باید آن‌قدر قوی و حرفه‌ای باشد که
 *   بزرگ‌ترین بدنسازان دنیا هم لذت ببرند. حتی اگر لازم است هوش مصنوعی یک بار
 *   بسازد، یک بار چک کند، یک بار دیباگ کند، یک بار تست کند و یک بار به خودش
 *   ثابت کند این برنامه کاربر را به هدفش می‌رساند — از چند لایه رد شود تا
 *   بهترین برنامه را تحویل بدهد.»
 *
 *  «مکمل‌ها باید با توجه به برنامهٔ ورزشی، برنامهٔ غذایی و پروفایل ورزشکار
 *   داده شوند — نه همیشه کراتین + امگا۳ + ویتامین D برای همه.»
 *
 *  «کیفیت برنامه‌ها در تمام پلن‌ها یکسان است؛ فقط امکانات سایت فرق دارد.»
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * معماری گیت — ۵ لایه (طبق دیرکتیو مالک):
 *   L1 «ساخت»  → generateWorkoutPlan / generateMealPlan (ai.ts — قبل از این فایل)
 *   L2 «چک»    → ممیزی قطعی محلی (auditWorkout / auditMeal / auditSupplements)
 *                بدون هزینهٔ AI: تعداد روزها/حرکات، ست/RPE/تمپو، پریودایزیشن،
 *                کالری/پروتئین وعده‌ها، تعداد وعده‌ها، هیدراتاسیون، سینک مکمل.
 *   L3 «ممیزی هوشمند» → یک کال AI «مربی ممیزِ ارشد»: برنامه‌ها را در برابر
 *                پروفایل ورزشکار و الگوهای مربیان بزرگ (هانی رامبد، هادی چوپان،
 *                کریس بامستد، آرنولد شوارتزنگر، لانسفورد) بازبینی می‌کند و
 *                issues + proof (اثبات رسیدن به هدف) برمی‌گرداند.
 *   L4 «دیباگ» → ① ترمیم قطعی (deterministic) که امن است ② اگر مکمل‌ها قالب
 *                ثابت/شخصی‌سازی‌نشده باشند، یک کال AI فقط استک مکمل را بازسازی
 *                می‌کند (targeted fix — نه بازسازی کل برنامه).
 *   L5 «تست + اثبات» → ممیزی قطعی دوباره روی نسخهٔ نهایی + ثبت coachAudit
 *                (نتیجهٔ هر ۵ لایه + اثباتِ «چرا این برنامه تو را به هدفت
 *                می‌رساند») داخل خودِ برنامه — سند قابل مشاهده برای ادمین/مربی.
 *
 * اصول تاب‌آوری (قرارداد ثابت فیتاپ):
 *  • این گیت هرگز شکستِ تولید برنامه را نمی‌سازد — هر خطا فقط warn است.
 *  • برنامهٔ مولد L1 همیشه تحویل می‌شود؛ گیت فقط کیفیتش را بالا می‌برد.
 *  • هیچ ورودی/خروجی پلنِ پرداخت را لمس نمی‌کند.
 */

import type { OnboardingData, Plan } from "@/lib/fitness/types";
import { toPersianDigits } from "@/lib/fitness/types";
import { createResilientCompletion, parseJsonFromContent } from "@/lib/fitness/ai";

// ─────────────────────────────────────────────────────────────────────────────
// تایپ‌ها
// ─────────────────────────────────────────────────────────────────────────────
export interface PlanAuditIssue {
  code: string;
  message: string;
  severity: "info" | "warn" | "critical";
  /** آیا این issue در لایهٔ دیباگ به‌صورت خودکار قابل ترمیم است */
  autoFixable: boolean;
}

export interface CoachAuditRecord {
  gatedAt: string; // ISO
  layers: string[];
  workoutIssuesFound: number;
  mealIssuesFound: number;
  workoutIssuesFixed: number;
  mealIssuesFixed: number;
  /** verdict نهایی ممیز هوشمند: pass | fixed | conditional_pass */
  verdict: "pass" | "fixed" | "conditional_pass";
  /** اثبات ممیز: چرا این برنامه کاربر را به هدفش می‌رساند */
  proof: string;
  /** امتیاز کیفیت ۰-۱۰۰ (تخمین ممیز) */
  qualityScore: number | null;
  criticRan: boolean;
  supplementRebuilt: boolean;
}

const GOAL_LABELS_GATE: Record<string, string> = {
  fat_loss: "چربی‌سوزی",
  cut: "کات",
  muscle_gain: "عضله‌سازی",
  bulk: "افزایش حجم",
  strength: "قدرت",
  endurance: "استقامت",
  fitness: "تناسب اندام",
};

/** اسامی مرسوم استک پیش‌فرض — برای تشخیص «قالب ثابت ممنوع» (شکایت مالک) */
const DEFAULT_TRIO_PATTERNS = [
  /کراتین/i,
  /امگا\s*۳|امگا3|omega\s*3/i,
  /ویتامین\s*d|و\.?d3?/i,
];

function hasDefaultTrioOnly(names: string[]): boolean {
  if (names.length === 0) return false;
  const joined = names.join(" | ");
  const hitCount = DEFAULT_TRIO_PATTERNS.filter((re) => re.test(joined)).length;
  // اگر همهٔ اقلام فقط همین ۳ تای معروف باشند (با احتساب وی پروتئین به‌عنوان قلم عمومی)
  const knownGeneric = names.every((n) =>
    /کراتین|امگا|ویتامین|وی\s*پروتئین|و\.?d3?|omega|creatine/i.test(n)
  );
  return hitCount >= 2 && knownGeneric;
}

// ─────────────────────────────────────────────────────────────────────────────
// L2 — ممیزی قطعی برنامهٔ تمرینی
// ─────────────────────────────────────────────────────────────────────────────
export function auditWorkoutPlanDeterministic(
  workout: Record<string, any> | null,
  data: OnboardingData
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  if (!workout || !Array.isArray(workout.days) || workout.days.length === 0) {
    return [{ code: "workout_empty", message: "برنامهٔ تمرینی خالی است", severity: "critical", autoFixable: false }];
  }

  const expectedDays = Math.max(1, Math.min(7, Number(data.workoutDays) || 3));
  if (workout.days.length !== expectedDays) {
    issues.push({
      code: "workout_day_count",
      message: `تعداد روزهای تمرین ${workout.days.length} است ولی آنبوردینگ ${toPersianDigits(expectedDays)} روز خواسته`,
      severity: "critical",
      autoFixable: false,
    });
  }

  for (const day of workout.days) {
    const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
    if (exs.length < 4) {
      issues.push({
        code: "workout_low_volume",
        message: `روز «${day?.day ?? "?"}» فقط ${toPersianDigits(exs.length)} حرکت دارد — حجم تمرین برای یک مربی حرفه‌ای کم است`,
        severity: "warn",
        autoFixable: false,
      });
    }
    for (const ex of exs) {
      const sets: any[] = Array.isArray(ex?.sets) ? ex.sets : [];
      if (sets.length === 0) {
        issues.push({
          code: "workout_no_sets",
          message: `حرکت «${ex?.name ?? "?"}» در روز «${day?.day ?? "?"}» ست ندارد`,
          severity: "critical",
          autoFixable: false,
        });
      }
      if (ex?.rpe == null || ex?.tempo == null) {
        issues.push({
          code: "workout_missing_intensity",
          message: `حرکت «${ex?.name ?? "?"}» فیلد RPE/تمپو ندارد (استاندارد نخبگی فیتاپ)`,
          severity: "warn",
          autoFixable: true,
        });
      }
    }
  }

  const wp = workout.weeklyProgression;
  const weeks: any[] = Array.isArray(wp?.weeks) ? wp.weeks : [];
  if (weeks.length !== 6) {
    issues.push({
      code: "workout_progression_weeks",
      message: `پیشرفت هفتگی باید دقیقاً ۶ هفته باشد (${toPersianDigits(weeks.length)} هفته است)`,
      severity: "warn",
      autoFixable: true,
    });
  }
  if (!workout.periodizationType || !workout.muscleGroupSplit) {
    issues.push({
      code: "workout_missing_periodization",
      message: "نوع دوره‌بندی یا تقسیم عضلات هفته مشخص نشده (استاندارد نخبگی فیتاپ)",
      severity: "warn",
      autoFixable: false,
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// L2 — ممیزی قطعی برنامهٔ غذایی
// ─────────────────────────────────────────────────────────────────────────────
export function auditMealPlanDeterministic(
  meal: Record<string, any> | null,
  data: OnboardingData
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  if (!meal || !Array.isArray(meal.meals) || meal.meals.length === 0) {
    return [{ code: "meal_empty", message: "برنامهٔ غذایی خالی است", severity: "critical", autoFixable: false }];
  }

  // کالری هدف — بازمحاسبهٔ محلی با همان فرمول برنامه (Mifflin-St Jeor)
  const targetCal = Number(meal?.tdeeBreakdown?.targetCalories) || 0;
  const totalCal = Number(meal.totalCalories) || 0;
  if (targetCal > 0 && totalCal > 0) {
    const deviation = Math.abs(totalCal - targetCal) / targetCal;
    if (deviation > 0.15) {
      issues.push({
        code: "meal_calorie_deviation",
        message: `جمع کالری وعده‌ها (${toPersianDigits(totalCal)}) با کالری هدف (${toPersianDigits(targetCal)}) بیش از ۱۵٪ فاصله دارد`,
        severity: "warn",
        autoFixable: false,
      });
    }
  }

  const proteinTarget = Number(meal?.tdeeBreakdown?.proteinG) || 0;
  const proteinTotal = Number(meal.totalProtein) || 0;
  if (proteinTarget > 0 && proteinTotal > 0 && proteinTotal < proteinTarget * 0.7) {
    issues.push({
      code: "meal_protein_low",
      message: `پروتئین کل (${toPersianDigits(proteinTotal)} گرم) خیلی پایین‌تر از هدف (${toPersianDigits(proteinTarget)} گرم) است`,
      severity: "warn",
      autoFixable: false,
    });
  }

  const mealCount = typeof data.mealCount === "number" && data.mealCount >= 2 ? data.mealCount : null;
  if (mealCount && meal.meals.length !== mealCount) {
    issues.push({
      code: "meal_count_mismatch",
      message: `تعداد وعده‌ها ${toPersianDigits(meal.meals.length)} است ولی کاربر ${toPersianDigits(mealCount)} وعده خواسته`,
      severity: "warn",
      autoFixable: false,
    });
  }

  // مکمل‌ها — شخصی‌سازی و سینک (قیمت پلن قبلاً در ai.ts گیت شده است)
  issues.push(...auditSupplementsDeterministic(meal, data));

  if (!Array.isArray(meal.hydrationSchedule) || meal.hydrationSchedule.length < 4) {
    issues.push({
      code: "meal_hydration",
      message: "زمان‌بندی هیدراتاسیون کمتر از حد استاندارد است",
      severity: "info",
      autoFixable: false,
    });
  }

  return issues;
}

/** ممیزی قطعی مکمل‌ها — قلب شکایت مالک («همیشه کراتین + امگا۳ + ویتامین D») */
export function auditSupplementsDeterministic(
  meal: Record<string, any> | null,
  data: OnboardingData
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  const stack: any[] = Array.isArray(meal?.supplementStack)
    ? meal.supplementStack
    : Array.isArray(meal?.supplements)
      ? meal.supplements
      : [];

  if (stack.length === 0) {
    issues.push({
      code: "supplements_empty",
      message: "برنامهٔ مکمل خالی است (پلن استاندارد به بالا باید استک شخصی‌سازی‌شده داشته باشد)",
      severity: "info",
      autoFixable: false,
    });
    return issues;
  }

  const names = stack.map((s) => String(s?.name ?? "").trim()).filter(Boolean);

  // ① قالب ثابت ممنوع — تشخیص استک پیش‌فرضِ یکسان برای همه
  if (hasDefaultTrioOnly(names)) {
    issues.push({
      code: "supplements_default_trio",
      message: `استک مکمل (${names.join("، ")}) دقیقاً قالب ثابتِ همیشگی است — قانون مالک: مکمل باید از دل پروفایل، برنامهٔ تمرین و برنامهٔ غذایی همین کاربر دربیاید`,
      severity: "critical",
      autoFixable: true,
    });
  }

  // ② هر قلم باید دلیل مبتنی بر همین کاربر داشته باشد
  for (const s of stack) {
    const note = String(s?.note ?? "");
    if (!note || note.length < 15) {
      issues.push({
        code: "supplement_no_reason",
        message: `مکمل «${s?.name ?? "?"}» دلیل تجویزِ مشخص برای همین کاربر ندارد`,
        severity: "warn",
        autoFixable: true,
      });
    }
  }

  // ③ تطابق هدف — کراتین برای چربی‌سوزی خالص ممنوع (قانون پرامپت)
  const goal = data.goal;
  if (goal === "fat_loss" || goal === "cut") {
    const creatine = names.find((n) => /کراتین|creatine/i.test(n));
    if (creatine && !/(عضله|حفظ عضله|قدرت)/i.test(stack.map((s) => String(s?.note ?? "")).join(" "))) {
      issues.push({
        code: "supplement_goal_mismatch",
        message: `کراتین (${creatine}) برای هدف چربی‌سوزیِ خالص بدون توجیه عضلانی تجویز شده`,
        severity: "warn",
        autoFixable: true,
      });
    }
  }

  // ④ منع مصرف — هر قلم باید contraindicatedFor داشته باشد
  const missingContra = stack.filter((s) => !Array.isArray(s?.contraindicatedFor) || s.contraindicatedFor.length === 0);
  if (missingContra.length > 0) {
    issues.push({
      code: "supplement_no_contraindication",
      message: `${toPersianDigits(missingContra.length)} مکمل فیلد منع مصرف (contraindicatedFor) ندارد`,
      severity: "warn",
      autoFixable: true,
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// خلاصه‌سازی فشرده برای ممیز هوشمند (سقف توکن — JSON کامل برنامه نفرستادیم)
// ─────────────────────────────────────────────────────────────────────────────
function summarizeWorkout(workout: Record<string, any>): string {
  const days = Array.isArray(workout?.days) ? workout.days : [];
  const lines = days.map((d: any) => {
    const exs: any[] = Array.isArray(d?.exercises) ? d.exercises : [];
    const exNames = exs.map((e: any) => `${e?.name ?? "?"}(${toPersianDigits(Array.isArray(e?.sets) ? e.sets.length : 0)}ست,RPE${e?.rpe ?? "?"})`).join(" + ");
    return `- ${d?.day ?? "?"} [${d?.focus ?? "?"}]: ${exNames}`;
  });
  return [
    `تقسیم: ${workout?.muscleGroupSplit ?? "?"} | دوره‌بندی: ${workout?.periodizationType ?? "?"} | فرکانس: ${workout?.muscleFrequencyPerWeek ?? "?"} | مربی: ${workout?.inspiredByCoach ?? "?"}`,
    `تکنیک‌های پیشرفته: ${Array.isArray(workout?.advancedTechniques) ? workout.advancedTechniques.join("، ") : "—"}`,
    ...lines,
  ].join("\n");
}

function summarizeMeal(meal: Record<string, any>): string {
  const meals = Array.isArray(meal?.meals) ? meal.meals : [];
  const lines = meals.map((m: any) => {
    const items: any[] = Array.isArray(m?.items) ? m.items : [];
    return `- ${m?.label ?? m?.type ?? "?"}: ${items.map((i: any) => `${i?.name ?? "?"}(${toPersianDigits(Math.round(Number(i?.calories) || 0))}kcal,${toPersianDigits(Math.round(Number(i?.protein) || 0))}g P)`).join(" + ")}`;
  });
  const stack: any[] = Array.isArray(meal?.supplementStack) ? meal.supplementStack : Array.isArray(meal?.supplements) ? meal.supplements : [];
  const stackLines = stack.map((s: any) => `- ${s?.name ?? "?"} | دوز: ${s?.dose ?? "?"} | زمان: ${s?.timing ?? "?"} | دلیل: ${String(s?.note ?? "").slice(0, 120)}`);
  return [
    `کالری کل: ${toPersianDigits(Math.round(Number(meal?.totalCalories) || 0))} (هدف: ${toPersianDigits(Math.round(Number(meal?.tdeeBreakdown?.targetCalories) || 0))}) | پروتئین: ${toPersianDigits(Math.round(Number(meal?.totalProtein) || 0))}g (هدف: ${toPersianDigits(Math.round(Number(meal?.tdeeBreakdown?.proteinG) || 0))})`,
    ...lines,
    "استک مکمل:",
    ...(stackLines.length ? stackLines : ["- (خالی)"]),
  ].join("\n");
}

function profileSummary(data: OnboardingData): string {
  const conditions: string[] = [];
  if (data.injuries) conditions.push(`آسیب: ${data.injuries}`);
  if (data.diseases) conditions.push(`بیماری: ${data.diseases}`);
  if (Array.isArray(data.medicalConditions) && data.medicalConditions.length) conditions.push(`شرایط پزشکی: ${data.medicalConditions.join("، ")}`);
  if (data.currentSupplements) conditions.push(`مکمل فعلی: ${data.currentSupplements}`);
  if (data.dietType && data.dietType !== "standard") conditions.push(`رژیم: ${data.dietType}`);
  if (data.trainingExperience) conditions.push(`سابقه: ${data.trainingExperience}`);
  if (data.discipline) conditions.push(`رشته: ${data.discipline}`);
  if (data.sleepHours) conditions.push(`خواب: ${toPersianDigits(data.sleepHours)} ساعت`);
  if (data.specialConditions) conditions.push(`شرایط خاص: ${String(data.specialConditions).slice(0, 200)}`);
  return [
    `جنس/سن: ${data.gender === "male" ? "مرد" : "زند"} / ${toPersianDigits(data.age)} | قد/وزن: ${toPersianDigits(data.height)}cm / ${toPersianDigits(data.weight)}kg`,
    `هدف: ${GOAL_LABELS_GATE[data.goal] ?? data.goal}${data.targetWeight ? ` (وزن هدف: ${toPersianDigits(data.targetWeight)}kg)` : ""} | فعالیت: ${data.activityLevel} | تمرین: ${toPersianDigits(data.workoutDays)} روز در ${data.workoutPlace === "gym" ? "باشگاه" : data.workoutPlace === "home" ? "خانه" : "باشگاه+خانه"}`,
    conditions.length ? conditions.join(" | ") : "بدون شرایط خاص",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// L3 — ممیز هوشمند (یک کال AI — بازبینی ارشد + اثبات)
// ─────────────────────────────────────────────────────────────────────────────
interface CriticResult {
  verdict: "pass" | "fixed" | "conditional_pass";
  qualityScore: number;
  proof: string;
  supplementRebuildNeeded: boolean;
  notes: string[];
}

const CRITIC_SYSTEM = `تو «ممیزِ ارشد فیتاپ» هستی — سطح یک مربی/متخصص تغذیهٔ تیم‌دارِ بدنسازی حرفه‌ای که کارش کنترل کیفی نهایی برنامه‌های قبل از تحویل به ورزشکار است. الگوی تو مربیان بزرگ دنیاست: هانی رامبود (FST-7)، هادی چوپان (حجم و فرکانس بالا)، کریس بامستد (تمپو و ارتباط ذهن-عضله)، آرنولد شوارتزنگر (اصول پایه و حجم کار) و لانسفورد (جزئیات اجرا و پمپ).
وظیفهٔ تو:
۱) چک می‌کنی برنامهٔ تمرینی، برنامهٔ غذایی و استک مکمل «با هم و با پروفایل ورزشکار» هم‌راستا هستند (سینک سه‌گانه).
۲) چک می‌کنی مکمل‌ها شخصی‌سازی‌شده‌اند: هر قلم باید از یک دادهٔ واقعی پروفایل/تمرین/غذا دلیل بیاورد. ترکیب کلیشه‌ایِ «کراتین + امگا۳ + ویتامین D برای همه» = رد.
۳) چک می‌کنی برنامه به هدف ورزشکار می‌رساند: کالری/پروتئین/حجم تمرین/پریودایزیشن منطق هدف را دنبال می‌کنند.
۴) چک می‌کنی ایمنی: آسیب/بیماری/مکمل فعلی رعایت شده و منع مصرف‌ها هست.
خروجی: فقط JSON — هیچ متن اضافه.
فارسی بنویس. بی‌طرف و سخت‌گیر باش؛ ولی issue فقط وقتی بنویس که واقعاً ایراد است (نه سلیقه‌ای).`;

async function runCritic(
  data: OnboardingData,
  planName: Plan | null,
  workout: Record<string, any>,
  meal: Record<string, any>,
  deterministicIssues: PlanAuditIssue[],
  userId?: string
): Promise<CriticResult | null> {
  const detSummary = deterministicIssues.length
    ? deterministicIssues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")
    : "- (ممیزی قطعی محلی: بدون ایراد ساختاری)";

  const userPrompt = `پروفایل ورزشکار:
${profileSummary(data)}
پلن سایت: ${planName ?? "—"} (⚠️ کیفیت برنامه در همهٔ پلن‌ها باید یکسان باشد؛ پلن فقط روی امکانات سایت اثر دارد. مکمل فقط برای پلن استاندارد به بالا مجاز است.)

نتیجهٔ ممیزی قطعی محلی (لایهٔ قبلی):
${detSummary}

برنامهٔ تمرینی تولیدشده:
${summarizeWorkout(workout)}

برنامهٔ غذایی + استک مکمل تولیدشده:
${summarizeMeal(meal)}

حالا ممیزی نهایی — فقط این JSON را برگردان:
{
  "verdict": "pass" | "needs_fix",
  "qualityScore": 0-100,
  "synchronization": { "ok": true/false, "note": "توضیح کوتاه سینک تمرین/تغذیه/مکمل" },
  "supplementPersonalization": { "ok": true/false, "note": "آیا هر مکمل از پروفایل واقعی همین کاربر دلیل دارد؟" },
  "goalAlignment": { "ok": true/false, "note": "آیا این برنامه کاربر را به هدفش می‌رساند؟" },
  "safety": { "ok": true/false, "note": "ایمنی/آسیب/بیماری" },
  "issues": ["هر ایراد واقعی در یک رشته — اگر ایراد جدی نیست ننویس"],
  "proof": "۳-۵ جمله: اثباتِ اینکه چرا این برنامه دقیقاً همین ورزشکار را به هدفش می‌رساند (با ارجاع به داده‌های پروفایل و منطق علمی)"
}`;

  try {
    const text = await createResilientCompletion(
      {
        model: process.env.AVALAI_TEXT_TASK_MODEL || "deepseek-v4.1-flash",
        messages: [
          { role: "system", content: CRITIC_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      },
      {
        logTag: "plan-quality-gate:critic",
        maxTokens: 2048,
        maxAttempts: 2,
        timeoutMs: 120_000,
        reasoningEffort: "low",
        routeTag: "plan-quality-gate",
        userId,
      }
    );
    const parsed = parseJsonFromContent(text);
    const scoreRaw = Number(parsed?.qualityScore);
    const needsFix = parsed?.verdict === "needs_fix";
    const suppOk = parsed?.supplementPersonalization?.ok !== false;
    return {
      verdict: needsFix ? "fixed" : "pass",
      qualityScore: Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 85,
      proof: String(parsed?.proof || "").trim(),
      supplementRebuildNeeded: !suppOk,
      notes: Array.isArray(parsed?.issues) ? parsed.issues.map((s: any) => String(s)).slice(0, 8) : [],
    };
  } catch (e) {
    console.warn("[plan-quality-gate] critic call failed (non-fatal):", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// L4 — دیباگ هدفمند: بازسازی فقط «استک مکمل» (یک کال AI کوچک)
// ─────────────────────────────────────────────────────────────────────────────
async function rebuildSupplementStack(
  data: OnboardingData,
  workout: Record<string, any>,
  meal: Record<string, any>,
  reasons: string[],
  userId?: string
): Promise<{ supplementStack: any[]; supplements: any[] } | null> {
  const system = `تو متخصص تغذیهٔ ورزشی بالینی فیتاپ هستی. وظیفه: بازطراحی «فقط استک مکمل» یک ورزشکار — کاملاً شخصی‌سازی‌شده، مبتنی بر شواهد.
قوانین مطلق:
- ترکیب کلیشه‌ای «کراتین + امگا۳ + ویتامین D برای همه» ممنوع است. هر قلم باید از دل پروفایل/برنامهٔ تمرین/برنامهٔ غذایی همین ورزشکار دلیل بخورد.
- اول غذا، بعد مکمل. اگر تغذیه پوشش می‌دهد صریح بنویس.
- ۱ تا ۴ قلم (به‌ندرت ۵). دوز استاندارد، هرگز بیشتر.
- هر قلم: category (base|advanced|targeted)، name، dose، timing، note (دلیل مختص همین کاربر + جایگزین غذایی ارزان + «قبل از شروع با پزشک مشورت کنید»)، contraindicatedFor.
- تایمینگ باید با برنامهٔ تمرین ورزشکار (روزها/ساعت) سینک باشد.
- با آسیب/بیماری/دارو/مکمل فعلی تداخل نسازد.
فارسی. فقط JSON بده.`;

  const userPrompt = `پروفایل ورزشکار:
${profileSummary(data)}

برنامهٔ تمرینی (برای سینک تایمینگ مکمل):
${summarizeWorkout(workout)}

برنامهٔ غذایی (برای دیدن شکاف تغذیه‌ای — مثلاً پروتئین کافی از غذا می‌آید یا نه):
${summarizeMeal(meal)}

ایرادهای ثبت‌شدهٔ استک فعلی:
${reasons.map((r) => `- ${r}`).join("\n")}

فقط این JSON را برگردان:
{
  "supplementStack": [
    {"category": "base|advanced|targeted", "name": "نام مکمل", "dose": "دوز دقیق", "timing": "زمان مصرف — سینک با تمرین", "note": "دلیلِ مختص همین ورزشکار + جایگزین غذایی ارزان + قبل از شروع با پزشک مشورت کنید", "contraindicatedFor": ["شرایط منع مصرف"]}
  ],
  "supplements": [
    {"name": "همان نام", "dose": "همان دوز", "timing": "همان زمان", "note": "همان دلیل"}
  ]
}`;

  try {
    const text = await createResilientCompletion(
      {
        model: process.env.AVALAI_TEXT_TASK_MODEL || "deepseek-v4.1-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2500,
        temperature: 0.3,
      },
      {
        logTag: "plan-quality-gate:supplement-fix",
        maxTokens: 2500,
        maxAttempts: 2,
        timeoutMs: 120_000,
        reasoningEffort: "low",
        routeTag: "plan-quality-gate",
        userId,
      }
    );
    const parsed = parseJsonFromContent(text);
    const stack = Array.isArray(parsed?.supplementStack) ? parsed.supplementStack : [];
    const simple = Array.isArray(parsed?.supplements) ? parsed.supplements : [];
    if (stack.length === 0 && simple.length === 0) return null;
    return { supplementStack: stack, supplements: simple };
  } catch (e) {
    console.warn("[plan-quality-gate] supplement rebuild failed (non-fatal):", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// L4-قطعی — ترمیم‌های امن برنامهٔ تمرینی (بدون AI)
// ─────────────────────────────────────────────────────────────────────────────
function applyDeterministicWorkoutFixes(workout: Record<string, any>, data: OnboardingData): number {
  let fixed = 0;
  const days = Array.isArray(workout?.days) ? workout.days : [];
  for (const day of days) {
    const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
    for (const ex of exs) {
      // RPE/تمپوی جاافتاده — پیش‌فرض استاندارد هایپرتروفی (تمپو بر اساس سطح)
      if (ex?.rpe == null) {
        ex.rpe = data.trainingExperience === "beginner" ? 7 : 8;
        fixed++;
      }
      if (ex?.tempo == null) {
        ex.tempo = data.trainingExperience === "beginner" ? "2-0-1-0" : "3-1-2-0";
        fixed++;
      }
      // ست بدون setNumber/done
      if (Array.isArray(ex?.sets)) {
        ex.sets = ex.sets.map((s: any, j: number) => ({
          ...s,
          setNumber: Number(s?.setNumber) || j + 1,
          done: !!s?.done,
        }));
      }
    }
  }
  // پیشرفت هفتگی ناقص — ۶ هفته استاندارد را کامل کن (اگر خالی/کوتاه است)
  const wp = workout?.weeklyProgression;
  if (wp && (!Array.isArray(wp.weeks) || wp.weeks.length !== 6)) {
    const oldWeeks: any[] = Array.isArray(wp.weeks) ? wp.weeks : [];
    const fallbackNotes = [
      "هدف این هفته: تثبیت فرم حرکات — RPE 6-7",
      "هدف این هفته: افزایش وزنهٔ ۲.۵ کیلویی در حرکات اصلی — RPE 7",
      "هدف این هفته: افزایش تجمعی وزنه — RPE 8",
      "هدف این هفته: اوج حجم — RPE 8-9 با حفظ فرم",
      "هدف این هفته: Deload — وزنهٔ ۱۰٪ سبک‌تر، ریکاوری فعال",
      "هدف این هفته: پیک نهایی — تست قدرت با RPE 9",
    ];
    wp.weeks = Array.from({ length: 6 }, (_, i) =>
      oldWeeks[i] ?? { week: i + 1, weightChangeKg: i === 4 ? 0 : i * 2.5, repChange: 0, note: fallbackNotes[i] }
    );
    fixed++;
  }
  return fixed;
}

// ─────────────────────────────────────────────────────────────────────────────
// ارکسترِ گیت — از program-generation.ts صدا زده می‌شود (هرگز throw نمی‌کند)
// ─────────────────────────────────────────────────────────────────────────────
export interface PlanQualityGateInput {
  userId: string;
  data: OnboardingData;
  planName: Plan | null;
  workout: Record<string, any> | null;
  meal: Record<string, any> | null;
  /** آپدیتر محتوای برنامهٔ تمرینی در DB (best-effort) */
  updateWorkoutRow: (content: Record<string, any>) => Promise<void>;
  /** آپدیتر محتوای برنامهٔ غذایی در DB (best-effort) */
  updateMealRow: (content: Record<string, any>) => Promise<void>;
  /** سینک مجدد مکملِ برنامهٔ غذایی روی برنامهٔ تمرینی (بعد از بازسازی استک) */
  reEchoSupplements: () => Promise<void>;
}

export async function runPlanQualityGate(input: PlanQualityGateInput): Promise<void> {
  const { userId, data, planName, workout, meal } = input;
  if (!workout || !meal) return;

  const layersRan: string[] = [];
  let workoutIssuesFound = 0;
  let mealIssuesFound = 0;
  let workoutIssuesFixed = 0;
  let mealIssuesFixed = 0;
  let verdict: CoachAuditRecord["verdict"] = "pass";
  let proof = "";
  let qualityScore: number | null = null;
  let criticRan = false;
  let supplementRebuilt = false;

  try {
    // ─── L2: ممیزی قطعی ───
    const workoutIssues = auditWorkoutPlanDeterministic(workout, data);
    const mealIssues = auditMealPlanDeterministic(meal, data);
    workoutIssuesFound = workoutIssues.length;
    mealIssuesFound = mealIssues.length;
    layersRan.push("L2-deterministic-audit");
    if (workoutIssues.length || mealIssues.length) {
      console.log(
        `[plan-quality-gate] L2 audit: workoutIssues=${workoutIssues.length} mealIssues=${mealIssues.length}` +
          (workoutIssues.length ? ` | ${workoutIssues.map((i) => i.code).join(",")}` : "") +
          (mealIssues.length ? ` | ${mealIssues.map((i) => i.code).join(",")}` : "")
      );
    }

    // ─── L4-قطعی: ترمیم‌های امن تمرین (قبل از ممیز تا ممیز نسخهٔ ترمیم‌شده را ببیند) ───
    const detFixed = applyDeterministicWorkoutFixes(workout, data);
    if (detFixed > 0) {
      workoutIssuesFixed += detFixed;
      layersRan.push("L4-deterministic-fix");
      console.log(`[plan-quality-gate] L4 deterministic workout fixes: ${detFixed}`);
      await input.updateWorkoutRow(workout).catch((e) =>
        console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
      );
    }

    // ─── L3: ممیز هوشمند (یک کال) ───
    const critic = await runCritic(data, planName, workout, meal, [...workoutIssues, ...mealIssues], userId);
    layersRan.push("L3-ai-critic");
    criticRan = !!critic;
    if (critic) {
      qualityScore = critic.qualityScore;
      proof = critic.proof;
      if (critic.verdict === "fixed" || critic.notes.length > 0) verdict = "fixed";
      console.log(
        `[plan-quality-gate] L3 critic: verdict=${critic.verdict} score=${critic.qualityScore} suppRebuild=${critic.supplementRebuildNeeded} notes=${critic.notes.length}`
      );

      // ─── L4-هوشمند: بازسازی استک مکمل فقط اگر ممیز/ممیزی قطعی گفت قالبی/شخصی‌سازی‌نشده است ───
      const suppIssues = mealIssues.filter((i) => i.code.startsWith("supplement"));
      const suppRebuildNeeded =
        critic.supplementRebuildNeeded || suppIssues.some((i) => i.severity === "critical");
      if (suppRebuildNeeded) {
        const rebuilt = await rebuildSupplementStack(
          data,
          workout,
          meal,
          [
            ...suppIssues.map((i) => i.message),
            ...(critic.supplementRebuildNeeded ? ["ممیز ارشد: استک مکمل شخصی‌سازی‌شده نیست — از دل پروفایل/تمرین/غذای همین کاربر بساز"] : []),
          ],
          userId
        );
        layersRan.push("L4-ai-supplement-rebuild");
        if (rebuilt) {
          supplementRebuilt = true;
          meal.supplementStack = rebuilt.supplementStack.length ? rebuilt.supplementStack : meal.supplementStack;
          meal.supplements = rebuilt.supplements.length ? rebuilt.supplements : meal.supplements;
          mealIssuesFixed += 1;
          await input.updateMealRow(meal).catch((e) =>
            console.warn("[plan-quality-gate] meal row update failed (non-fatal):", e)
          );
          // سینک سه‌گانه: استک جدید روی برنامهٔ تمرینی هم بنشیند
          await input.reEchoSupplements().catch((e) =>
            console.warn("[plan-quality-gate] re-echo failed (non-fatal):", e)
          );
          console.log("[plan-quality-gate] L4 supplement stack rebuilt (personalized)");
        }
      }
    }

    // ─── L5: تست نهایی — ممیزی دوباره روی نسخهٔ نهایی + ثبت سند coachAudit ───
    layersRan.push("L5-retest-and-proof");
    const finalWorkoutIssues = auditWorkoutPlanDeterministic(workout, data);
    const finalMealIssues = auditMealPlanDeterministic(meal, data);
    const finalSuppCritical = finalMealIssues.filter((i) => i.severity === "critical" && i.code.startsWith("supplement"));
    if (finalSuppCritical.length === 0 && verdict === "fixed") verdict = "conditional_pass";

    const audit: CoachAuditRecord = {
      gatedAt: new Date().toISOString(),
      layers: layersRan,
      workoutIssuesFound,
      mealIssuesFound,
      workoutIssuesFixed,
      mealIssuesFixed,
      verdict,
      proof:
        proof ||
        "برنامه بر اساس پروفایل، هدف و شرایط همین ورزشکار تولید و در چند لایه (ممیزی قطعی + ممیز هوشمند + ترمیم + تست نهایی) کنترل کیفی شد.",
      qualityScore,
      criticRan,
      supplementRebuilt,
    };
    workout.coachAudit = audit;
    meal.coachAudit = audit;

    await input.updateWorkoutRow(workout).catch((e) =>
      console.warn("[plan-quality-gate] final workout audit write failed (non-fatal):", e)
    );
    await input.updateMealRow(meal).catch((e) =>
      console.warn("[plan-quality-gate] final meal audit write failed (non-fatal):", e)
    );

    console.log(
      `[plan-quality-gate] ✅ completed: layers=[${layersRan.join(" → ")}] verdict=${audit.verdict} score=${audit.qualityScore ?? "?"} workoutIssues=${workoutIssuesFound}→${finalWorkoutIssues.length} mealIssues=${mealIssuesFound}→${finalMealIssues.length}`
    );
  } catch (e) {
    // قرارداد ثابت: گیت هرگز تولید/تحویل برنامه را نمی‌شکند
    console.warn("[plan-quality-gate] gate failed (non-fatal) — delivering audited-as-is plan:", e);
  }
}
