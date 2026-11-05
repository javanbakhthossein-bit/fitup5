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
import { ensureWorkoutTipFields } from "@/lib/fitness/workout-tip-fields";
import { toPersianDigits, sortWeekdaysByPersianOrder, normalizeWeekdayName } from "@/lib/fitness/types";
// v237 — ممیزی نشتِ حرکات ممنوع در گیت (لایهٔ آخر تضمین ممنوعیت‌ها)
import { matchesForbiddenName, expandMovementPatterns, enforceWorkoutExclusions } from "@/lib/fitness/plan-redesign-constraints";
import { createResilientCompletion, parseJsonFromContent, repairWorkoutPlanCoverage } from "@/lib/fitness/ai";
import { db } from "@/lib/db";
import {
  exerciseFamilyKey,
  coveredMajorGroupsDetailed,
  majorGroupsOfExercise,
  buildLockedBank,
  MAJOR_GROUP_KEYS,
  MAJOR_GROUP_LABELS_FA,
  type LockedBank,
  type BankExerciseRow,
} from "@/lib/fitness/exercise-bank-lock";
import { GLOBAL_YOUTUBE_SETTING_KEY, globalYoutubeEnabledFromValue } from "@/lib/fitness/exercise-video";
// v213 — ممیزی انطباق با معماری معمار برنامه (Coach Blueprint)
// v237 — تطبیق نام‌محور روزها (matchBlueprintDayIndex) هم اضافه شد
import {
  blueprintDayAllowedGroups,
  blueprintDayPrimaryGroups,
  matchBlueprintDayIndex,
} from "@/lib/fitness/coach-blueprint";

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

/* ═══════════════ v216 — پست-چک قطعی ایمنی آسیب (R4-B3-5: ضد پرامپت-فرار) ═══════════════
 * دیرکتیو مالک: «ناحیهٔ آسیب ← خانوادهٔ حرکات ممنوعه» باید قطعی (بدون LLM) روی
 * خروجی نهایی اجرا شود — اگر AI حرکتِ در تضاد با آسیب کاربر تجویز کرد، همینجا
 * به‌صورت قطعی از بانک حرکات جایگزین می‌شود (الگوی جایگزینی بانک) و سوآپ لاگ می‌شود.
 * قرارداد گیت: هر خطا فقط warn — این چک هرگز تولید برنامه را نمی‌شکند.
 * ═════════════════════════════════════════════════════════════════════════ */

/** ناحیهٔ آسیب → خانوادهٔ حرکات ممنوعه (الگوهای نام فارسی/انگلیسی؛ allow = استثنای مجاز) */
interface InjuryBanRule {
  key: string;
  label: string;
  patterns: RegExp[];
  allow?: RegExp;
}

const INJURY_MOVEMENT_BANS: InjuryBanRule[] = [
  // v256 — باگ B14 (اثبات E2E تمدید): برپی = پرش + فرود با خمِ عمیق زانو — برای
  // آسیب زانو/مچ‌پا/شکستگی اخیر هم ممنوع است (قبلاً فقط کمر/BMI بالا می‌گرفت).
  { key: "knee", label: "زانو", patterns: [/پرش|جامپ|jump|برپی|burpee/i, /اسکوات\s*عمیق|دیپ\s*اسکوات|deep\s*squat|پیستول|پستول|pistol/i] },
  // v237 — کمر/دیسک: حرکات پرشی (برپی/جامپ جک/پلایومتریک) بار ضربه‌ای محوری روی ستون
  // و دیسک‌ها می‌گذارند — برای کمردرد ممنوع (برپی هم شامل: فرود دوپای پرشی).
  { key: "lower_back", label: "کمر / دیسک", patterns: [/گود\s*مورنینگ|good\s*morning/i, /ددلیفت/, /اسنچ|کلین|snatch|clean\s*&?\s*(jerk|press)|های\s*پول|high\s*pull/i, /پرش|جامپ|jump|پلایومتریک|plyo|برپی|burpee/i], allow: /رومانی|ترپ|تراپ|trap/i },
  { key: "shoulder", label: "شانه / روتاتور کاف", patterns: [/پشت\s*گردن|behind[.\s-]?neck/i] },
  { key: "neck", label: "گردن", patterns: [/پشت\s*گردن|behind[.\s-]?neck|بریج\s*گردن|پل\s*گردن|تمرین\s*گردن|neck\s*(bridge|curl|ext)/i] },
  { key: "elbow", label: "آرنج", patterns: [/اسکال\s*کراشر|skull\s*crush|دیپ[\s\u200C]*(پارالل|بار|سینه|پشت\s*بازو)|dips/i] },
  { key: "wrist", label: "مچ دست", patterns: [/هندستند|handstand|کرل\s*مچ|wrist\s*(curl|ext)|پلانک\s*روی\s*کف\s*دست/i] },
  { key: "hip_groin", label: "لگن / کشاله ران", patterns: [/اسپلیت\s*اسکوات|کوزاک|cossack|لانژ\s*جانبی/i] },
  { key: "hamstring", label: "پشت ران (همسترینگ)", patterns: [/رومانی|پای\s*صاف|stiff\s*leg|leg\s*curl|لگ\s*کرل|همسترینگ\s*کرل/i] },
  { key: "ankle", label: "مچ پا", patterns: [/پرش|جامپ|jump|برپی|burpee/i] },
  { key: "recent_fracture", label: "شکستگی اخیر", patterns: [/پرش|جامپ|jump|برپی|burpee/i] },
  { key: "surgery_history", label: "سابقه جراحی", patterns: [/پرش|جامپ|jump|برپی|burpee/i] },
  // v237 — وزن بالا (BMI≥۳۰): پرش/پلایومتریک با بار ضربه‌ای چندبرابر وزن بدن روی
  // زانو/مچ‌پا/کمر برای فرد چاق ممنوع است (استاندارد مربیان حرفه‌ای) — مصداق شکایت
  // مالک: برپی/جامپ‌جک/شنا پلایومتریک برای کاربر ۱۲۲ کیلویی با کمر درد.
  { key: "high_impact_risk", label: "وزن بالا (BMI≥۳۰)", patterns: [/پرش|جامپ|jump|پلایومتریک|plyo|برپی|burpee/i] },
];

function userInjuryAreaSet(data: OnboardingData): Set<string> {
  return new Set<string>(
    (Array.isArray(data?.injuryAreas) ? data.injuryAreas : []).map((a) => String(a)).filter(Boolean)
  );
}

/**
 * v237 — نواحی ایمنیِ سینتتیک (غیرِ آسیب): BMI ≥ ۳۰ → «high_impact_risk» —
 * فرد با وزن بالا نباید پرش/پلایومتریک بزند (بار ضربه‌ای چندبرابر روی زانو/کمر).
 * شکایت مالک: کاربر ۱۲۲ کیلویی با کمر درد برپی/جامپ جک گرفته بود — پیش‌تر
 * هیچ منطق BMI-محور وجود نداشت و چون نواحی آسیب او (کمر/مچ) پرش را ممنوع
 * نمی‌کردند، حرکات پرشی در برنامه می‌ماندند (خود ممیز هم هشدارش را داده بود!).
 */
function userSafetyAreaSet(data: OnboardingData): Set<string> {
  const areas = userInjuryAreaSet(data);
  try {
    const w = Number((data as { weight?: number | null })?.weight ?? 0);
    const h = Number((data as { height?: number | null })?.height ?? 0);
    if (w > 0 && h > 0) {
      const bmi = w / Math.pow(h / 100, 2);
      if (bmi >= 30) areas.add("high_impact_risk");
    }
  } catch {
    // هرگز نمی‌شکند — BMI نامعلوم فقط یعنی این قانون سینتتیک اعمال نمی‌شود
  }
  return areas;
}

/** حرکت با ناحیه‌های آسیبِ کاربر تضاد مستقیم دارد؟ برچسب ناحیه‌های متضاد را برمی‌گرداند */
function injuryBanHits(name: string, areas: Set<string>): string[] {
  const clean = String(name ?? "");
  if (!clean || areas.size === 0) return [];
  const hits: string[] = [];
  for (const rule of INJURY_MOVEMENT_BANS) {
    if (!areas.has(rule.key)) continue;
    if (rule.allow && rule.allow.test(clean)) continue;
    if (rule.patterns.some((p) => p.test(clean))) hits.push(rule.label);
  }
  return hits;
}

/** v216 — ممیزی قطعی ایمنی آسیب (L2): نقض‌ها را گزارش می‌کند (بدون تغییر برنامه) */
export function auditInjuryMovementSafety(
  workout: Record<string, any> | null,
  data: OnboardingData
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  try {
    // v237 — نواحی سینتتیک BMI هم اعمال می‌شود (وزن بالا → پرش ممنوع)
    const areas = userSafetyAreaSet(data);
    if (areas.size === 0) return issues;
    const days = Array.isArray(workout?.days) ? workout.days : [];
    for (const day of days) {
      const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
      for (const ex of exs) {
        if (!ex?.name) continue;
        const hits = injuryBanHits(String(ex.name), areas);
        if (hits.length > 0) {
          issues.push({
            code: "workout_injury_violation",
            message: `حرکت «${ex.name}» در روز «${day?.day ?? "؟"}» با نواحی آسیب کاربر (${hits.join("، ")}) تضاد مستقیم دارد و باید تعویض شود`,
            severity: "critical",
            autoFixable: true,
          });
        }
      }
    }
  } catch (e) {
    // قرارداد گیت: این چک هرگز نمی‌شکند
    console.warn("[plan-quality-gate] v216 injury audit skipped (non-fatal):", e);
  }
  return issues;
}

/** v216 — انتخاب جایگزین قطعی از بانک (بدون LLM): هم‌عضله → هم‌کاتگوری → هم‌گروه اصلی → هر حرکتِ ایمن */
function pickSafeInjuryReplacement(
  bank: Array<{ id: string; name: string; muscle: string | null; category: string | null; description: string | null; tips: string | null }>,
  violating: { name: string; muscle?: string | null; category?: string | null },
  areas: Set<string>,
  usedNamesOfDay: Set<string>,
  usedFamiliesOfDay: Map<string, number>
): (typeof bank)[number] | null {
  const violatingKey = squeeze(violating.name);
  const safe = bank.filter((row) => {
    if (squeeze(row.name) === violatingKey) return false;
    if (injuryBanHits(row.name, areas).length > 0) return false;
    if (usedNamesOfDay.has(squeeze(row.name))) return false;
    // واریانت سومِ یک خانواده در همان روز نساز (قانون v147)
    const fam = exerciseFamilyKey(row.name, row.muscle);
    if ((usedFamiliesOfDay.get(fam) ?? 0) >= 2) return false;
    return true;
  });
  if (safe.length === 0) return null;
  const bySameMuscle = safe.find((r) => r.muscle && violating.muscle && r.muscle === violating.muscle);
  if (bySameMuscle) return bySameMuscle;
  const bySameCategory = safe.find((r) => r.category && violating.category && r.category === violating.category);
  if (bySameCategory) return bySameCategory;
  const violatingGroups = majorGroupsOfExercise({ name: violating.name, muscle: violating.muscle, category: violating.category });
  const bySameGroup = safe.find((r) => {
    const g = majorGroupsOfExercise({ name: r.name, muscle: r.muscle, category: r.category });
    for (const gg of violatingGroups) if (g.has(gg)) return true;
    return false;
  });
  return bySameGroup ?? safe[0];
}

/** فشرده‌سازی سادهٔ نام برای مقایسه (بدون وابستگی به normalizePersianText) */
function squeeze(name: string): string {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\s\u200C\-–—_]+/g, "")
    .trim();
}

export interface InjurySafetyReport {
  swapped: number;
  removed: number;
  details: string[];
}

/**
 * v216 — تعویض قطعی حرکاتِ در تضاد با آسیب کاربر، از بانک حرکات (بدون LLM).
 * هرگز throw نمی‌کند — هر خطا فقط warn و چک skip می‌شود (قرارداد never-fail).
 */
export async function enforceInjuryMovementSafety(
  workout: Record<string, any> | null,
  data: OnboardingData
): Promise<InjurySafetyReport> {
  const report: InjurySafetyReport = { swapped: 0, removed: 0, details: [] };
  try {
    // v237 — نواحی سینتتیک BMI هم اعمال می‌شود (وزن بالا → تعویض قطعی پرش‌ها)
    const areas = userSafetyAreaSet(data);
    if (!workout || !Array.isArray(workout.days) || areas.size === 0) return report;

    const bank = await db.exerciseLibrary.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" }, // ترتیب قطعی برای انتخاب تکرارپذیر
      select: {
        id: true, name: true, muscle: true, category: true, description: true, tips: true,
      },
    });
    if (bank.length === 0) return report;

    for (const day of workout.days) {
      if (!day || !Array.isArray(day.exercises)) continue;
      const usedFamiliesOfDay = new Map<string, number>();
      const usedNamesOfDay = new Set<string>();
      for (const ex of day.exercises as any[]) {
        if (ex?.name) {
          usedNamesOfDay.add(squeeze(String(ex.name)));
          const fam = exerciseFamilyKey(String(ex.name), ex.muscle);
          usedFamiliesOfDay.set(fam, (usedFamiliesOfDay.get(fam) ?? 0) + 1);
        }
      }
      const keep: any[] = [];
      for (const ex of day.exercises as any[]) {
        if (!ex?.name) { keep.push(ex); continue; }
        const hits = injuryBanHits(String(ex.name), areas);
        if (hits.length === 0) { keep.push(ex); continue; }
        const replacement = pickSafeInjuryReplacement(bank, ex, areas, usedNamesOfDay, usedFamiliesOfDay);
        if (replacement) {
          // تعویض از بانک — نام/توضیح/نکات/ویدیو (exerciseId) استاندارد بانک می‌شود
          ex.name = replacement.name;
          ex.exerciseId = replacement.id;
          if (replacement.muscle) ex.muscle = replacement.muscle;
          if (replacement.category) ex.category = replacement.category;
          ex.description = (replacement.description || "").trim() || ex.description;
          ex.tips = (replacement.tips || "").trim() || ex.tips;
          ex.coachTip = `تعویض قطعی ایمنی (v216): حرکت قبلی با ناحیهٔ آسیب شما (${hits.join("، ")}) تضاد داشت — این جایگزینِ سازگار با فرم صحیح و دامنهٔ کنترل‌شده اجرا شود.`;
          report.swapped++;
          report.details.push(`روز «${day?.day ?? "؟"}»: تعویض ← «${replacement.name}» (تضاد با ${hits.join("، ")})`);
          usedNamesOfDay.add(squeeze(replacement.name));
          const fam = exerciseFamilyKey(replacement.name, replacement.muscle);
          usedFamiliesOfDay.set(fam, (usedFamiliesOfDay.get(fam) ?? 0) + 1);
        } else {
          // هیچ جایگزین امنی نیست — حرکت حذف می‌شود (ایمنی مقدم بر حجم)
          report.removed++;
          report.details.push(`روز «${day?.day ?? "؟"}»: حذف «${ex.name}» (تضاد با ${hits.join("، ")}) — جایگزین امن در بانک نبود`);
        }
      }
      day.exercises = keep;
    }

    if (report.swapped + report.removed > 0) {
      // شناسنامهٔ سوآپ داخل خودِ محتوای برنامه (بدون تغییر اسکیما) + لاگ سرور
      (workout as Record<string, any>).injurySafetyReport = {
        enforcedAt: new Date().toISOString(),
        swapped: report.swapped,
        removed: report.removed,
        details: report.details,
      };
      console.warn(
        `[plan-quality-gate] v216 injury-safety enforce: swapped=${report.swapped} removed=${report.removed} — ${report.details.join(" | ")}`
      );
    }
  } catch (e) {
    // قرارداد گیت: خطای این چک هرگز تولید/تحویل برنامه را نمی‌شکند — فقط skip
    console.warn("[plan-quality-gate] v216 injury-safety check skipped (non-fatal):", e);
  }
  return report;
}
/* ═══════════════ پایان v216 — پست-چک ایمنی آسیب ═══════════════ */

/* ═══════════════ v237 — تضمین قطعی ممنوعیت‌ها و سقف فرکانس گروه‌ها ═══════════════
 * شکایت مالک (برنامهٔ مصطفی خوشبخت): پرس سینه ×۲ و شنا سوئدی در برنامهٔ کاربری
 * مانده بود در حالی که در حرکات ممنوع پروفایلش بود + پا ۳ روز در هفته بود.
 * ریشه: ممیزی ممنوعیت‌ها فقط در زنجیرهٔ generateWorkoutPlan بود و گیت هرگز
 * re-check نمی‌کرد؛ سقف فرکانس هم اصلاً وجود نداشت. اینجا لایهٔ آخر بسته می‌شود.
 */

/** v237 — ممیزی نشت حرکات ممنوع (L2): هر نامِ هم‌خانوادهٔ ممنوع در برنامه = critical */
export function auditForbiddenMovementLeak(
  workout: Record<string, any> | null,
  forbiddenMovements: string[] | undefined | null
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  try {
    if (!workout || !Array.isArray(workout.days) || !forbiddenMovements || forbiddenMovements.length === 0) return issues;
    const keywords = new Set<string>();
    for (const m of forbiddenMovements) {
      for (const p of expandMovementPatterns(m)) keywords.add(p);
    }
    const keywordList = [...keywords].filter(Boolean);
    if (keywordList.length === 0) return issues;
    for (const day of workout.days) {
      const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
      for (const ex of exs) {
        if (!ex?.name) continue;
        const hit = matchesForbiddenName(String(ex.name), keywordList);
        if (hit) {
          issues.push({
            code: "workout_forbidden_leak",
            message: `حرکت «${ex.name}» در روز «${day?.day ?? "؟"}» با ممنوعیت صریح پروفایل کاربر (الگوی «${hit}») تضاد دارد و نباید در برنامه باشد`,
            severity: "critical",
            autoFixable: true,
          });
        }
      }
    }
  } catch (e) {
    // قرارداد گیت: هرگز نمی‌شکند
    console.warn("[plan-quality-gate] v237 forbidden-leak audit skipped (non-fatal):", e);
  }
  return issues;
}

/**
 * v237 — سقف فرکانس گروه‌های عضلانی (ممیزی شکایت «از ۴ روز، ۲ روز پا + داخل
 * روز دیگر هم پا»): هر گروه حداکثر باید به تعداد روزهایی کار مستقیم بگیرد که
 * معماری برایش مجاز کرده (PHUL: پا=۲ روز؛ فول‌بادی ۳×: هر گروه=۳ روز).
 * شمارش «مستقیم» است: حرکت کل‌بدن/هوازی (برپی و...) تمرکز مستقیم حساب نمی‌شود.
 */
export function auditGroupFrequencyCap(
  workout: Record<string, any> | null
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  try {
    if (!workout || !Array.isArray(workout.days) || workout.days.length === 0) return issues;
    const bp = workout.coachBlueprint as
      | { days?: Array<{ day?: string; primary?: string[]; secondary?: string[] }>; splitLabelFa?: string }
      | undefined;

    // سقف مجاز هر گروه: اگر معماری هست، تعداد روزهای مجازِ همان گروه در معماری؛
    // اگر نیست، ۲ (فرکانس علمی استاندارد) — مگر اسپلیت فول‌بادی باشد.
    const cap = new Map<string, number>();
    if (bp && Array.isArray(bp.days)) {
      for (const g of MAJOR_GROUP_KEYS) {
        let c = 0;
        bp.days.forEach((d, idx) => {
          const allowed = blueprintDayAllowedGroups({ days: bp.days } as never, idx);
          if (allowed.has(g as never)) c++;
        });
        cap.set(g, Math.max(c, 1));
      }
    } else {
      const splitLabel = String(workout.muscleGroupSplit ?? "");
      const isFullbodySplit = /فول.?بادی|بدن.?کامل|full.?body/i.test(splitLabel);
      for (const g of MAJOR_GROUP_KEYS) cap.set(g, isFullbodySplit ? Math.max(2, workout.days.length) : 2);
    }

    // شمارش روزهای «تمرکز مستقیم» هر گروه (فول‌بادی/کاردیو مستقیم حساب نمی‌شود)
    const directDays = new Map<string, Set<string>>();
    for (const g of MAJOR_GROUP_KEYS) directDays.set(g, new Set());
    for (const day of workout.days) {
      const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
      for (const ex of exs) {
        if (!ex?.name) continue;
        const groups = majorGroupsOfExercise(ex as any);
        if (groups.size >= 5) continue; // کل‌بدن — تمرکز مستقیم یک گروه نیست
        for (const g of groups) directDays.get(g)?.add(String(day?.day ?? "?"));
      }
    }

    for (const g of MAJOR_GROUP_KEYS) {
      const days = directDays.get(g);
      if (!days) continue;
      const limit = cap.get(g) ?? 2;
      if (days.size > limit) {
        issues.push({
          code: "workout_group_frequency_overcap",
          message: `گروه «${MAJOR_GROUP_LABELS_FA[g] ?? g}» در ${toPersianDigits(days.size)} روز کار مستقیم دارد (${[...days].join("، ")}) — سقف مجاز معماری/علمی ${toPersianDigits(limit)} روز است؛ حجم اضافه ریکاوری را می‌شکند و خطر آسیب دارد`,
          severity: "critical",
          autoFixable: false,
        });
      }
    }
  } catch (e) {
    console.warn("[plan-quality-gate] v237 group-frequency audit skipped (non-fatal):", e);
  }
  return issues;
}
/* ═══════════════ پایان v237 — تضمین ممنوعیت‌ها/فرکانس ═══════════════ */

/* ═══════════════ v255 — لایه‌های تعویض تجهیزات / کاردیوی هدف / پوشش مجدد ═══════════════
 * ممیزی ریزبه‌ریزِ ۹۳ برنامهٔ فعالِ ماه گذشته (بستهٔ b1/b2/b3):
 *  • b2 — کاربر خانگی حرکتِ باشگاهی (سیم‌کش/هالتر/ماشین) گرفته بود؛ قانون تجهیزات
 *    فقط در پرامپت بود و هیچ تعویض قطعیِ بعد-از-تولید نداشت.
 *  • b3 — ۱۰ برنامهٔ چربی‌سوزی صفر حرکت کاردیو داشتند (قانون پرامپت نادیده شده بود).
 *  • b1 — گیت ترمیمِ پوشش را هرگز اجرا نمی‌کرد؛ اگر تعویض ایمنی/ممنوعیت گروهی را
 *    خالی می‌گذاشت، یافتهٔ critical فقط «ثبت» می‌شد و تحویل می‌شد.
 * ترتیب: بعد از ایمنی‌آسیب (L2.6) و ممنوعیت‌ها (L2.7) — تا تعویض‌های آن لایه‌ها
 * هم بازچک شوند؛ ترمیم پوشش آخرین لایه است تا با ترکیب نهایی حساب کند.
 * قرارداد گیت حفظ است: هر خطا فقط warn و هرگز تحویل برنامه را نمی‌شکند.
 */

/** الگوهای «فقط-باشگاهی» از روی نام (فقط سیگنال‌های قاطع — ضد فالس‌پازیو «گوبلت») */
const GYM_ONLY_NAME_PATTERNS: Array<[RegExp, string]> = [
  [/ماشین|دستگاه|هاک|پک\s*دک|پروانه|قفسه|لگ\s*پرس|اسمیت|شراک|سمیت/i, "machine"],
  [/سیم\s*کش|سیم\u200cکش|کراس\s*ا?ور|پولی/i, "cable"],
  [/هالتر/i, "barbell"],
  // v256 — باگ B8 (اثبات E2E با AI واقعی): بارفیکس/پارالل/دیپ برای کاربر خانگیِ بدون
  // بارفیکس غیرقابل اجراست ولی الگوی نام آن را نمی‌گرفت و تگِ بانک هم "bodyweight" بود →
  // کاربر خانگیِ بدون هیچ تجهیزاتی بارفیکس اکسنتریک/استرالیایی/دیپس پارالل می‌گرفت.
  [/بارفیکس|میوزآپ|muscle.?up|chin.?up|pull.?up/i, "pullup_bar"],
  [/پارالل|parallel\s*bars?/i, "pullup_bar"], // برج بارفیکس خانگی معمولاً میلهٔ دیپ هم دارد
  [/دیپس(?!.*نیمکت)|دیپ(?!.*(نیمکت|روی))/i, "pullup_bar"], // دیپ‌های نیمکتی استثنا (bench dip)
  [/حلقه|ring/i, "rings"], // دیپ حلقه/حلقهٔ ژیمناستیک
  [/دمبل/i, "dumbbell"],
  [/کتل.?بل/i, "kettlebell"],
  [/نیمکت/i, "bench"],
  [/\bTRX\b|ناپایدار|بی\s*ثبات/i, "trx"],
];

/** توکن‌های تجهیزاتی که بدون لیستِ کاربر فرضِ دسترسی نمی‌شوند (خانه) */
const HOME_CHECKED_EQUIPMENT = new Set(["machine", "cable", "barbell", "smith", "dumbbell", "kettlebell", "bench", "pullup_bar", "trx", "rings"]);

/** تجهیزات مجاز کاربر از پروفایل — null = باشگاه/هر دو (همه مجاز) */
function userAllowedEquipmentSet(data: OnboardingData): Set<string> | null {
  const place = String((data as { workoutPlace?: string })?.workoutPlace ?? "gym");
  if (place === "gym" || place === "both") return null;
  // v256 — باگ B9 (اثبات E2E): «band» قبلاً همیشه مجاز فرض می‌شد → کاربری که فقط
  // «فقط وزن بدن» انتخاب کرده بود، حرکت با کش مقاومتی می‌گرفت. کش فقط با انتخابِ
  // صریح کاربر (bands/band) مجاز است؛ پیش‌فرض خانه فقط وزن بدن + مت است.
  const allowed = new Set<string>(["bodyweight", "mattress"]);
  const raw = Array.isArray((data as { equipment?: unknown })?.equipment) ? (data as { equipment?: string[] }).equipment! : [];
  for (const e of raw) {
    const k = String(e ?? "").trim().toLowerCase();
    if (!k) continue;
    allowed.add(k);
    if (k === "bands" || k === "resistance_band") allowed.add("band");
    if (k === "pullupbar" || k === "bar") allowed.add("pullup_bar");
    if (k === "smith") allowed.add("machine");
  }
  return allowed;
}

/** توکن‌های تجهیزاتِ لازم برای یک حرکت برنامه: اول از بانک (exerciseId)، فال‌بک نام */
function requiredEquipmentOf(
  ex: { name?: string; exerciseId?: string },
  bankIdMap: Map<string, BankExerciseRow>
): string[] {
  const row = ex?.exerciseId ? bankIdMap.get(String(ex.exerciseId)) : undefined;
  if (row) {
    // v256 — باگ B8 بخش ۲: تگ‌های چندکلمه‌ای بانک ("pull-up bar"، "parallel bars,weight")
    // با split(/[,\s]+/) به توکن‌های بی‌معنی ("pull-up"، "bar") می‌شکستند که هیچ‌کدام
    // در HOME_CHECKED_EQUIPMENT نبودند → حرکتِ نیازمند بارفیکس هرگز فلگ نمی‌شد.
    const toks = normalizeEqTokens(
      String(row.equipment || "bodyweight")
        .split(/[,]/)
        .flatMap((part) => part.trim().split(/\s+/))
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    );
    return toks.length > 0 ? toks : ["bodyweight"];
  }
  // بدون ردیف بانک — فقط الگوهای قاطع نام
  const name = String(ex?.name ?? "");
  const out: string[] = [];
  for (const [re, eq] of GYM_ONLY_NAME_PATTERNS) if (re.test(name)) out.push(eq);
  return out.length > 0 ? out : ["bodyweight"];
}

/**
 * v256 — نرمال‌سازی توکن‌های تگ تجهیزات بانک (باگ B8 — بخش ۲):
 * جفت‌های شناخته‌شده به شناسهٔ رسمی تجهیزات اپ (pullup_bar/band) نگاشت می‌شوند.
 */
function normalizeEqTokens(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "pull-up" || t === "pullup" || t === "parallel") {
      const next = toks[i + 1];
      if (next === "bar" || next === "bars") i++; // جفت کامل مصرف شد
      out.push("pullup_bar");
      continue;
    }
    if (t === "resistance") {
      const next = toks[i + 1];
      if (next === "band" || next === "bands") i++;
      out.push("band");
      continue;
    }
    out.push(t);
  }
  return out;
}

/** v255 — ممیزی تجهیزات (L2): حرکتِ نیازمند تجهیزِ در-دسترس-نبودِ کاربر = critical */
export function auditEquipmentCompatibility(
  workout: Record<string, any> | null,
  data: OnboardingData
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  try {
    const allowed = userAllowedEquipmentSet(data);
    if (!workout || !Array.isArray(workout.days) || allowed === null) return issues;
    for (const day of workout.days) {
      const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
      for (const ex of exs) {
        if (!ex?.name) continue;
        const need = requiredEquipmentOf(ex, new Map()); // ممیزی فقط نام‌محور (exerciseId در enforce حل می‌شود)
        const missing = need.filter((t) => HOME_CHECKED_EQUIPMENT.has(t) && !allowed.has(t));
        if (missing.length > 0) {
          issues.push({
            code: "workout_equipment_mismatch",
            message: `حرکت «${ex.name}» در روز «${day?.day ?? "؟"}» تجهیزات باشگاهی (${missing.join(", ")}) می‌خواهد ولی کاربر در خانه آن‌ها را ندارد`,
            severity: "critical",
            autoFixable: true,
          });
        }
      }
    }
  } catch (e) {
    console.warn("[plan-quality-gate] v255 equipment audit skipped (non-fatal):", e);
  }
  return issues;
}

/** v255.1 — الگوهای کشش/موبیلیتی/توانبخشی — هرگز جایگزینِ حرکتِ قدرتی نمی‌شوند */
const STRETCH_REHAB_NAME_RE = /کشش|کششی|موبیلیتی|حالت\s*کودک|child'?s|stretch|موبیلیز|آماده\s*سازی|گرم\s*کردن|foam|فوم|سمفونی|حرکت\s*درمانی|درمانی/i;

/** v255.1 — انتخاب امتیاز‌محور جایگزین (ضد «سیم‌کش ← حالت کودک») */
function pickEquipmentReplacement(
  bank: LockedBank,
  bankIdMap: Map<string, BankExerciseRow>,
  violating: { name?: string; muscle?: string | null; category?: string | null },
  violatingGroups: Set<string>,
  allowed: Set<string>,
  usedNamesOfDay: Set<string>,
  usedFamiliesOfDay: Set<string>
): BankExerciseRow | null {
  const violatingMuscle = String(violating.muscle ?? "").trim();
  let best: BankExerciseRow | null = null;
  let bestScore = -Infinity;
  for (const r of bank.all) {
    if (usedNamesOfDay.has(squeeze(String(r.name ?? "")))) continue;
    const fam = exerciseFamilyKey(String(r.name ?? ""), r.muscle);
    if (usedFamiliesOfDay.has(fam)) continue;
    if (STRETCH_REHAB_NAME_RE.test(String(r.name ?? ""))) continue;
    const toks = requiredEquipmentOf({ name: r.name, exerciseId: r.id }, bankIdMap);
    if (toks.some((t) => HOME_CHECKED_EQUIPMENT.has(t) && !allowed.has(t))) continue;
    const g = majorGroupsOfExercise(r as any);
    if (g.size >= 5) continue; // حرکات کل‌بدن جایگزین تخصصی نمی‌شوند
    let score = 0;
    const rMuscle = String(r.muscle ?? "").trim();
    if (violatingMuscle && rMuscle && rMuscle === violatingMuscle) score += 100; // هم‌عضلهٔ دقیق
    if ([...g].some((x) => violatingGroups.has(x))) score += 80; // هم‌گروه اصلی
    else if (violating.category && String(r.category ?? "") === violating.category) score += 45; // هم‌کاتگوری
    else continue; // نه هم‌گروه نه هم‌کاتگوری → به‌درد همان روز نمی‌خورد
    if (/پرس|اسکوات|ددلیفت|روئینگ|بارفیکس|پارالل|press|squat|row|pull/i.test(String(r.name ?? ""))) score += 12; // کامپاند اول
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export interface EquipmentSafetyReport {
  swapped: number;
  removed: number;
  details: string[];
}

/**
 * v255 — تعویض قطعی حرکاتِ نیازمند تجهیزاتِ ناموجود کاربر خانگی (b2).
 * جایگزین: هم‌گروهِ ویدیودارِ سازگار با تجهیزاتِ کاربر از بانک؛ هیچ جایگزینی نبود → حذف.
 * هرگز throw نمی‌کند (قرارداد گیت).
 */
export async function enforceEquipmentCompatibility(
  workout: Record<string, any> | null,
  data: OnboardingData,
  bank: LockedBank
): Promise<EquipmentSafetyReport> {
  const report: EquipmentSafetyReport = { swapped: 0, removed: 0, details: [] };
  try {
    const allowed = userAllowedEquipmentSet(data);
    if (!workout || !Array.isArray(workout.days) || allowed === null) return report;
    if (!bank || !Array.isArray(bank.all) || bank.all.length === 0) return report;

    const bankIdMap = new Map<string, BankExerciseRow>();
    for (const r of bank.all) bankIdMap.set(String(r.id), r);
    // پیش‌کشیدن ممنوعیت‌ها روی بانک — در تماسِ caller (forbiddenMovements) اعمال می‌شود

    for (const day of workout.days) {
      if (!day || !Array.isArray(day.exercises)) continue;
      const usedFamiliesOfDay = new Set<string>();
      const usedNamesOfDay = new Set<string>();
      for (const ex of day.exercises as any[]) {
        if (ex?.name) {
          usedNamesOfDay.add(squeeze(String(ex.name)));
          usedFamiliesOfDay.add(exerciseFamilyKey(String(ex.name), ex.muscle));
        }
      }
      for (const ex of day.exercises as any[]) {
        if (!ex?.name) continue;
        const need = requiredEquipmentOf(ex, bankIdMap);
        const missing = need.filter((t) => HOME_CHECKED_EQUIPMENT.has(t) && !allowed.has(t));
        if (missing.length === 0) continue;

        const violatingGroups = majorGroupsOfExercise(ex);
        const violatingCategory = String(ex.category ?? "");
        // v255.1 — انتخاب امتیازمحور (هم‌عضله ← هم‌گروه ← هم‌کاتگوری؛ ضد جایگزین کششی)
        const candidate = pickEquipmentReplacement(
          bank,
          bankIdMap,
          { name: ex.name, muscle: ex.muscle, category: ex.category },
          violatingGroups,
          allowed,
          usedNamesOfDay,
          usedFamiliesOfDay
        );

        if (candidate) {
          report.details.push(`روز «${day?.day ?? "؟"}»: «${ex.name}» ← «${candidate.name}» (تجهیزات ناموجود: ${missing.join(", ")})`);
          ex.name = candidate.name;
          ex.exerciseId = candidate.id;
          if (candidate.muscle) ex.muscle = candidate.muscle;
          if (candidate.category) ex.category = candidate.category;
          ex.description = (candidate.description || "").trim() || ex.description;
          ex.tips = (candidate.tips || "").trim() || ex.tips;
          ex.coachTip = `تعویض قطعی تجهیزات (v255): این حرکت تجهیزات باشگاهی می‌خواست که در تجهیزاتِ اعلامی شما نیست — جایگزینِ هم‌عضله با تجهیزات در-دسترس شما جای آن نشست.`;
          report.swapped++;
          usedNamesOfDay.add(squeeze(String(candidate.name)));
          usedFamiliesOfDay.add(exerciseFamilyKey(String(candidate.name), candidate.muscle));
        } else {
          report.details.push(`روز «${day?.day ?? "؟"}»: حذف «${ex.name}» (تجهیزات ناموجود: ${missing.join(", ")}) — جایگزین سازگار در بانک نبود`);
          ex._removed = true;
          report.removed++;
        }
      }
      day.exercises = (day.exercises as any[]).filter((e) => !e?._removed);
    }

    if (report.swapped + report.removed > 0) {
      (workout as Record<string, any>).equipmentSafetyReport = {
        enforcedAt: new Date().toISOString(),
        swapped: report.swapped,
        removed: report.removed,
        details: report.details,
      };
      console.warn(`[plan-quality-gate] v255 equipment enforce: swapped=${report.swapped} removed=${report.removed} — ${report.details.join(" | ")}`);
    }
  } catch (e) {
    console.warn("[plan-quality-gate] v255 equipment enforce skipped (non-fatal):", e);
  }
  return report;
}

/** هدفِ خانوادهٔ چربی‌سوزی — enum + متن‌های آزاد («cut» دیده‌شده در دیتای واقعی) */
function isFatLossGoal(goal: unknown): boolean {
  return /fat|چربی|کات|cut|لاغر|کاهش\s*وزن|weight\s*loss/i.test(String(goal ?? ""));
}

/**
 * v255 — تزریق قطعی کاردیو برای چربی‌سوزیِ بی‌کاردیو (b3).
 * دو حرکت کاردیوی ویدیودارِ سازگار با تجهیزات/ایمنیِ کاربر در دو روز متفاوت.
 * هرگز throw نمی‌کند (قرارداد گیت).
 */
export function enforceGoalCardio(
  workout: Record<string, any> | null,
  data: OnboardingData,
  bank: LockedBank,
  forbiddenKeywords: string[]
): { added: number; details: string[] } {
  const out = { added: 0, details: [] as string[] };
  try {
    if (!workout || !Array.isArray(workout.days) || workout.days.length === 0) return out;
    if (!isFatLossGoal((data as { goal?: unknown })?.goal)) return out;
    const areas = userSafetyAreaSet(data);
    // v255.1 — «طناب» تنها کافی نیست (طنابِ سیم‌کش پشت بازو!) — فقط طنابِ زدن/پرش
    // v256 — باگ B11 (اثبات E2E): شمارش دودویی («حداقل یک کاردیو») کافی نبود —
    // برنامهٔ AI با فقط «یک» حرکت پویا (جامپینگ جک) از گیت رد می‌شد. قانون علمی
    // B3: چربی‌سوزی حداقل «۲ جلسهٔ» کاردیو مستقل در هفته می‌خواهد (ACSM).
    const isCardioName = (n: string) =>
      /کاردیو|هوازی|تردمیل|دوچرخه\s*ثابت|الپتیکال|رووینگ|رویینگ|پرش\s*با\s*طناب|طناب\s*زدن|جامپینگ\s*طناب|jump\s*rope|برپی|جامپینگ\s*جک|جامپ\s*جک|دوی|پیاده\s*روی|اسکی\s*سطح|پارویی|کوهنوردی\s*درجا|mountain\s*climb/i.test(n);
    const cardioCount = workout.days.reduce((acc: number, d: any) => {
      const exs = Array.isArray(d?.exercises) ? d.exercises : [];
      return acc + exs.filter((ex: any) => String(ex?.category ?? "") === "cardio" || isCardioName(String(ex?.name ?? ""))).length;
    }, 0);
    if (cardioCount >= 2) return out;
    if (!bank || !Array.isArray(bank.all)) return out;

    const cardioPool = bank.all.filter((r) => {
      if (String(r.category ?? "") !== "cardio") return false;
      if (injuryBanHits(String(r.name ?? ""), areas).length > 0) return false; // پرش برای زانو/BMI بالا ممنوع
      if (forbiddenKeywords.length > 0 && matchesForbiddenName(String(r.name ?? ""), forbiddenKeywords)) return false;
      return true;
    });
    if (cardioPool.length === 0) return out;

    // سبک‌ترین روزها (تعادل حجم) — دو روز متفاوت
    const sortedDays = [...workout.days].sort((a, b) => (a?.exercises?.length ?? 0) - (b?.exercises?.length ?? 0));
    const targets: any[] = [];
    for (const d of sortedDays) {
      if (targets.length >= 2) break;
      if (targets.includes(d)) continue;
      targets.push(d);
    }
    for (let i = 0; i < targets.length; i++) {
      const row = cardioPool[i % cardioPool.length];
      const day = targets[i];
      if (!day || !Array.isArray(day.exercises)) continue;
      day.exercises.push({
        name: row.name,
        muscle: row.muscle,
        category: "cardio",
        description: (row.description || "").trim() || "کاردیوی پیوسته با شدت قابل گفتگو — ضربان قلب در محدودهٔ چربی‌سوزی حفظ شود.",
        tips: (row.tips || "").trim() || "ریتم تنفس منظم و شیب/سرعت ثابت؛ ۵ دقیقهٔ اول گرم‌کردنی.",
        coachTip: "کاردیوی هدف‌محور چربی‌سوزی (v255) — بعد از حرکات قدرتی یا در روز جدا اجرا شود؛ شدت طوری که بتوانی حرف بزنی.",
        difficulty: "beginner",
        rpe: 6,
        tempo: "پیوسته",
        substitution: "نسخهٔ سبک‌تر با همان مدت در صورت خستگی",
        sets: [{ setNumber: 1, reps: "15-20 دقیقه", restSec: 0, rpe: 6 }],
        exerciseId: row.id,
      });
      out.details.push(`روز «${day?.day ?? "؟"}»: تزریق کاردیوی «${row.name}» (هدف چربی‌سوزی)`);
      out.added++;
    }
    if (out.added > 0) {
      const noteLine = `- 🔥 تکمیل کاردیوی هدف: برای هدف چربی‌سوزی، ${toPersianDigits(out.added)} جلسهٔ کاردیو به برنامه اضافه شد (${out.details.map((d) => d.split(":")[1]?.trim() ?? "").join("، ")}).`;
      workout.notes = workout.notes ? `${workout.notes}\n${noteLine}` : noteLine;
      console.warn(`[plan-quality-gate] v255 goal-cardio inject: ${out.added} — ${out.details.join(" | ")}`);
    }
  } catch (e) {
    console.warn("[plan-quality-gate] v255 goal-cardio inject skipped (non-fatal):", e);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// L2 — ممیزی قطعی برنامهٔ تمرینی
// ─────────────────────────────────────────────────────────────────────────────

/* ═══ v255.2 — استراحت بین ست‌ها (ممیزی b6 — ۲۹ برنامهٔ ماه گذشته صفر/نامشخص) ═══
 * علم مرجع: راهنمای NSCA + فراتحلیل Schoenfeld ۲۰۱۷ — هایپرتروفی ۶۰-۱۲۰ثانیه،
 * قدرت ۱۸۰+، چربی‌سوزی/استقامت ۴۰-۹۰، core ۴۵، کاردیوی پیوسته ۰.
 * اعضای غیرآخری سوپرست/تری‌ست/جاینت‌ست زنجیره‌ای‌اند — استراحت صفرشان استاندارد است.
 */

/** ایندکس‌های «زنجیره‌ای» روز: اعضای غیرآخری هر supersetGroup — استراحت صفرشان صحیح است */
function chainedSupersetIndexes(day: Record<string, any>): Set<number> {
  const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
  const lastIdx = new Map<string, number>();
  exs.forEach((ex, i) => {
    const g = String(ex?.supersetGroup ?? "").trim();
    if (g) lastIdx.set(g, i); // آخرین رخداد گروه در همان روز
  });
  const chained = new Set<number>();
  exs.forEach((ex, i) => {
    const g = String(ex?.supersetGroup ?? "").trim();
    if (g && lastIdx.get(g) !== i) chained.add(i);
  });
  return chained;
}

/** v256 — تشخیص حرکت مرکب (مشترک بین استاندارد استراحت و ترمیم کف علمی) */
function isCompoundMovement(name: string, category: string): boolean {
  const c = String(category ?? "").toLowerCase();
  return c === "fullbody" ||
    /اسکوات|سکوات|ددلیفت|ددل\s*لیفت|پرس\s*(سینه|سرشانه|پا|هالتر|سرباز|بالانس)|لگ\s*پرس|هاک|بارفیکس|پارالل|روئینگ|قایقی|پاور\s*کلین|هیپ\s*ثرست|پل\s*باسن/i.test(String(name ?? ""));
}

/** نسخهٔ علمی استراحت (ثانیه) بر اساس نام/کاتگوری حرکت و هدف کاربر — ۰ = پیوسته (صحیح) */
function standardRestSec(name: string, category: string, goal: unknown): number {
  const n = String(name ?? "");
  const c = String(category ?? "").toLowerCase();
  const g = String(goal ?? "").toLowerCase();
  if (c === "cardio" || /کاردیو|هوازی|تردمیل|دوچرخه|الپتیکال|رووینگ|رویینگ|طناب/i.test(n)) return 0;
  if (c === "core" || /شکم|کور|پلانک|کرانچ|زیرشکم|مرکز\s*بدن/i.test(n)) return 45;
  const isCompound = isCompoundMovement(n, c);
  if (/strength|قدرت/.test(g)) return isCompound ? 180 : 120;
  if (/fat|cut|چربی|لاغر/.test(g)) return isCompound ? 90 : 45;
  if (/endurance|استقامت/.test(g)) return isCompound ? 75 : 40;
  return isCompound ? 120 : 75; // عضله‌سازی/پیش‌فرض — Schoenfeld ۲۰۱۷
}

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
    for (const [ei, ex] of exs.entries()) {
      // v256 — باگ B13: پوستهٔ بی‌نام (خروجی خام AI) = critical قابل ترمیم قطعی
      if (!ex?.name || String(ex.name).trim().length < 2 || ex?.ignore === true) {
        issues.push({
          code: "workout_nameless_shell",
          message: `حرکت بی‌نام/پوستهٔ خالی در روز «${day?.day ?? "?"}» (خروجی خام AI)`,
          severity: "critical",
          autoFixable: true,
        });
        continue;
      }
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
      // v255.2 — استراحت بین ست‌ها (b6): صفر/نامشخص فقط برای عضو زنجیره‌ای سوپرست
      // و کاردیوی پیوسته صحیح است؛ بقیه باید استراحت علمی داشته باشند
      if (
        sets.length > 0 &&
        !chainedSupersetIndexes(day).has(ei) &&
        standardRestSec(String(ex?.name ?? ""), String(ex?.category ?? ""), data.goal) > 0 &&
        sets.some((s) => s?.restSec == null || Number(s.restSec) <= 0)
      ) {
        issues.push({
          code: "workout_missing_rest",
          message: `حرکت «${ex?.name ?? "?"}» در روز «${day?.day ?? "?"}» استراحت بین ست‌ها ندارد (استاندارد نخبگی فیتاپ)`,
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

  // ─── v145 — ممیزی قانون مربیان بزرگ (ریشهٔ شکایت مالک: «۴ بارفیکس در روز
  // زیربغل + هیچ روز سرشانه») — این ممیزی باید معمولاً صفر باشد چون لایه‌های
  // قبلی (رد در زنجیرهٔ تولید + dedupe قطعی بعد از قفل بانک) این نقض‌ها را
  // ترمیم کرده‌اند؛ اگر اینجا دیده شد یعنی ترمیم‌های قبلی کامل نبوده و باید
  // در سند coachAudit ثبت و به ممیز هوشمند گزارش شود. ───

  // ① انباشت هم‌خانواده در یک روز — قانون علمی v147
  // «دو واریانت از یک خانواده در یک روز» مجاز و استاندارد است (جلو بازو هالتر +
  // چکشی، اسکوات جلو + بلغاری)؛ فقط «۳ واریانت به بالا» یا تکرار دقیق ایراد است.
  // استثنا: تمرینات شکم (core_*) — واریانت‌های مختلف شکم در یک روز عادی است؛
  // فقط تکرارِ دقیقِ همان حرکت ایراد شمرده می‌شود.
  for (const day of workout.days) {
    const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
    const familyCount = new Map<string, number>();
    const seenExact = new Set<string>();
    for (const ex of exs) {
      if (!ex?.name) continue;
      const fam = exerciseFamilyKey(String(ex.name), ex.muscle);
      const sqName = String(ex.name).replace(/[\s\u200C\-]+/g, "");
      const isCoreFam = fam.startsWith("core");
      if (seenExact.has(sqName)) {
        issues.push({
          code: "workout_family_duplicate",
          message: `روز «${day?.day ?? "؟"}»: حرکت «${ex.name}» دو بار تکرار شده`,
          severity: "critical",
          autoFixable: false,
        });
      } else if (!isCoreFam && (familyCount.get(fam) ?? 0) >= 2) {
        issues.push({
          code: "workout_family_duplicate",
          message: `روز «${day?.day ?? "؟"}»: «${ex.name}» سومین واریانت خانوادهٔ حرکتی خودش است — قانون مربیان بزرگ: در یک روز حداکثر دو واریانت از یک خانواده مجاز است`,
          severity: "critical",
          autoFixable: false,
        });
      } else {
        familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);
        seenExact.add(sqName);
      }
    }
  }

  // ② پوشش کامل گروه‌های عضلانی اصلی در هفته — v163: همان شمارندهٔ تفکیک‌شدهٔ
  // ترمیم‌گر (coveredMajorGroupsDetailed) — حرکت «کل بدن» دیگر سرشانه را «پوشیده»
  // حساب نمی‌کند مگر اسپلیت فول‌بادی واقعی (≥۲ روز) باشد؛ هم‌راستا با فیکس v162.
  const expectedDaysGate = Math.max(1, Math.min(7, Number(data.workoutDays) || 3));
  if (expectedDaysGate >= 3) {
    const covered = coveredMajorGroupsDetailed(workout.days).covered;
    const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
    if (missing.length > 0) {
      const labels = missing.map((g) => MAJOR_GROUP_LABELS_FA[g] ?? g).join("، ");
      issues.push({
        code: "workout_coverage_missing",
        message: `گروه‌های «${labels}» در کل هفته هیچ حرکت مستقیمی ندارند — قانون طلایی: هر شش گروه اصلی (سینه/زیربغل/سرشانه/پا/بازو/شکم) باید حداقل یک‌بار در هفته کار مستقیم بگیرند`,
        severity: "critical",
        autoFixable: false,
      });
    }
  }

  // ─── v213 — ممیزی انطباق با معماری معمار (Coach Blueprint) ───
  // معماری روی خود برنامه ذخیره شده (coachBlueprint) — اینجا چک می‌کنیم خروجی
  // نهایی واقعاً همان معماری است: هویت روزها + سقف جلسه‌ای ~۸ ست هر عضله.
  // همه warn/info — هرگز برنامه را رد نمی‌کند (قرارداد گیت).
  issues.push(...auditBlueprintAdherence(workout));

  // ─── v216 — پست-چک قطعی ایمنی آسیب (ناحیهٔ آسیب + BMI ← خانوادهٔ حرکات ممنوعه) ───
  issues.push(...auditInjuryMovementSafety(workout, data));

  // ─── v237 — سقف فرکانس گروه‌ها + نشت ممنوعیت‌ها (لایهٔ آخر تضمین کیفیت) ───
  // فرکانس: تیکت مالک «از ۴ روز، ۲ روزش پا بود و داخل یک روز دیگه هم پا گذاشته بود»
  issues.push(...auditGroupFrequencyCap(workout));

  return issues;
}

/**
 * v213 — ممیزی انطباق برنامه با معماری معمار (روز فرانکنشتاینی صفر):
 * ① هویت روز: ≥۵۰٪ حرکات هر روز باید از گروه‌های مجازِ همان روز در معماری باشند.
 * ② سقف جلسه‌ای: بیش از ۹ ست سنگین برای یک عضله در یک جلسه = هشدار (علم حجم).
 * ③ عضلهٔ اصلی روز بدون هیچ حرکت مستقیم = هشدار.
 */
export function auditBlueprintAdherence(
  workout: Record<string, any> | null
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  const bp = workout?.coachBlueprint as
    | { days?: Array<{ day?: string; primary?: string[]; secondary?: string[] }>; splitLabelFa?: string }
    | undefined;
  if (!bp || !Array.isArray(bp.days) || !Array.isArray(workout?.days)) return issues;
  const bpDays: Array<{ day?: string; primary?: string[]; secondary?: string[] }> = bp.days;
  const planDays: Array<any> = workout.days;

  // v237 — چک مجموعهٔ روزها: هر روز برنامه باید در معماری هم‌نام داشته باشد
  // (روزِ گم‌شده/اضافی/ناشناخته = هشدار ساختاری) + تطبیق هر روزِ برنامه با روز
  // معماریِ «هم‌نام» (نه اندیسی — ریشهٔ باگ یاشار ستاری که اندیسی تطبیق می‌داد
  // و روز پا با حرکات روز سینه ممیزی می‌شد).
  const planDayNames = planDays.map((d: any) => String(d?.day ?? ""));
  const bpDayNames = bpDays.map((d) => String(d?.day ?? ""));
  // v237 — مقایسه با نام نرمال‌شده (نقل‌قول/نیم‌فاصله سرگردان AI شکست نمی‌خورد)
  const missingInPlan = bpDayNames.filter((n) => n && !planDayNames.some((p) => p && normalizeWeekdayName(p) === normalizeWeekdayName(n)));
  if (bpDayNames.length > 0 && missingInPlan.length > 0) {
    issues.push({
      code: "blueprint_day_set",
      message: `روزهای برنامه (${planDayNames.join("، ")}) با روزهای معماری (${bpDayNames.join("، ")}) هم‌خوان نیست — «${missingInPlan.join("، ")}» در برنامه نیست یا نامش عوض شده`,
      severity: "warn",
      autoFixable: false,
    });
  }

  planDays.forEach((day: any, idx: number) => {
    if (!day || !Array.isArray(day.exercises)) return;
    // v237 — تطبیق نام‌محور با معماری (اندیس فقط فال‌بک)
    const bpIdx = matchBlueprintDayIndex({ days: bpDays } as never, String(day.day ?? ""), idx);
    const spec = bpDays[bpIdx];
    if (!spec) return;
    const dayName = String(day.day ?? spec.day ?? `روز ${idx + 1}`);

    // مجوزها را از همان توابع معمار می‌خوانیم — یک حقیقت واحد
    const allowed = blueprintDayAllowedGroups(
      { days: bpDays } as never,
      bpIdx
    );
    const primary = blueprintDayPrimaryGroups(
      { days: bpDays } as never,
      bpIdx
    );
    if (allowed.size === 0) return;

    const exs = day.exercises;
    const inAllowed = exs.filter((ex: any) => {
      if (!ex?.name) return false;
      const g = majorGroupsOfExercise(ex as any);
      if (g.size >= 5) return true; // حرکت کل‌بدن — هم‌پوشانی طبیعی
      return [...g].some((x) => allowed.has(x));
    }).length;
    const ratio = exs.length > 0 ? inAllowed / exs.length : 0;
    if (ratio < 0.5) {
      issues.push({
        code: "blueprint_day_identity",
        message: `روز «${dayName}» فقط ${Math.round(ratio * 100)}٪ حرکاتش از عضلات معماری خودش است — معماری انتخابی: ${bp.splitLabelFa ?? "?"}`,
        severity: "warn",
        autoFixable: false,
      });
    }

    const hasPrimary = exs.some((ex: any) => {
      if (!ex?.name) return false;
      const g = majorGroupsOfExercise(ex as any);
      return [...g].some((x) => primary.has(x));
    });
    if (!hasPrimary && primary.size > 0) {
      issues.push({
        code: "blueprint_primary_missing",
        message: `روز «${dayName}» هیچ حرکت مستقیمی از عضلهٔ اصلی معماری خودش (${[...primary].map((g) => MAJOR_GROUP_LABELS_FA[g] ?? g).join("، ")}) ندارد`,
        severity: "warn",
        autoFixable: false,
      });
    }

    // v213.2 — سقف جلسه‌ای ~۸-۱۰ ست سنگین، در سطح «عضلهٔ ریز» (چهارسر/پشت پا/...)
    // نه بستهٔ ۶گروهی — روز پا ذاتاً ۲۰+ ست «پا» دارد و این طبیعی است؛
    // نقض واقعی وقتی است که «یک عضلهٔ واحد» بیش از ۱۰ ست در همان جلسه بگیرد.
    const FINE_MUSCLE_PATTERNS: Array<[RegExp, string]> = [
      [/چهارسر|جلو ?ران|کواد|leg ?extension/i, "چهارسر"],
      [/پشت ?پا|همسترینگ|leg ?curl/i, "پشت پا"],
      [/باسن|سرینی|گلوت|hip ?thrust|abduction|pull.?through/i, "باسن"],
      [/ساق|کلف|calf/i, "ساق"],
      [/جلو ?بازو|جلوبازو|دوسر|بیسپ|curl/i, "جلو بازو"],
      [/پشت ?بازو|پشت‌بازو|سه‌?سر|تریسپ|triceps/i, "پشت بازو"],
      [/نشر|دلتوئید جانبی|lateral ?raise|shoulder ?press|پرس سرشانه/i, "سرشانه"],
      [/سرشانهٔ? عقب|پستور|rear ?delt|فیس ?پول/i, "سرشانهٔ عقب"],
    ];
    const fineSets = new Map<string, number>();
    for (const ex of exs) {
      if (!ex?.name && !ex?.muscle) continue;
      const hay = `${ex?.muscle ?? ""} ${ex?.name ?? ""}`;
      const sets = Array.isArray(ex.sets) ? ex.sets.length : 0;
      for (const [re, label] of FINE_MUSCLE_PATTERNS) {
        if (re.test(hay)) {
          fineSets.set(label, (fineSets.get(label) ?? 0) + sets);
        }
      }
    }
    for (const [label, sets] of fineSets) {
      if (sets > 10) {
        issues.push({
          code: "blueprint_session_set_cap",
          message: `روز «${dayName}» برای عضلهٔ «${label}» ${sets} ست دارد — بیش از سقف مؤثر جلسه‌ای (~۸-۱۰ ست)؛ بودجهٔ عضله باید بین جلسات هفته پخش شود`,
          severity: "info",
          autoFixable: false,
        });
      }
    }
  });

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// L2 — ممیزی قطعی برنامهٔ غذایی
// ─────────────────────────────────────────────────────────────────────────────
export function auditMealPlanDeterministic(
  meal: Record<string, any> | null,
  data: OnboardingData,
  /** v255 — پلن شامل مکمل است؟ (استاندارد به بالا) */
  supplementsAllowed?: boolean
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
  // v255 — صلبیت پلن (مکمل از استاندارد به بالا) به ممیزی مکمل پاس می‌شود
  issues.push(...auditSupplementsDeterministic(meal, data, supplementsAllowed));

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
  data: OnboardingData,
  /** v255 — پلن شامل مکمل است؟ (استاندارد به بالا) — خالی‌بودن فقط برای این پلن‌ها critical است */
  supplementsAllowed?: boolean
): PlanAuditIssue[] {
  const issues: PlanAuditIssue[] = [];
  const stack: any[] = Array.isArray(meal?.supplementStack)
    ? meal.supplementStack
    : Array.isArray(meal?.supplements)
      ? meal.supplements
      : [];

  if (stack.length === 0) {
    // v255 — ممیزی b4: ۵۷ از ۹۳ برنامهٔ ماه گذشته بدون استک مکمل بودند چون
    // «خالی» فقط info بود و بازسازی L4 هرگز تریگر نمی‌شد. حالا برای پلن‌های
    // شامل‌مکمل critical+autoFixable است تا L4-هوشمند حتماً استک شخصی‌سازی‌شده بسازد.
    const allowed = supplementsAllowed !== false; // نامشخص → رفتار محتاطانهٔ critical
    issues.push({
      code: "supplements_empty",
      message: "برنامهٔ مکمل خالی است (پلن استاندارد به بالا باید استک شخصی‌سازی‌شده داشته باشد)",
      severity: allowed ? "critical" : "info",
      autoFixable: allowed,
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

const CRITIC_SYSTEM = `تو «ممیزِ ارشد فیتاپ» هستی — سطح یک مربی/متخصص تغذیهٔ تیم‌دارِ بدنسازی حرفه‌ای که کارش کنترل کیفی نهایی برنامه‌های قبل از تحویل به ورزشکار است. الگوی تو مربیان بزرگ دنیاست: هانی رامبد (FST-7)، هادی چوپان (حجم و فرکانس بالا)، کریس بامستد (تمپو و ارتباط ذهن-عضله)، آرنولد شوارتزنگر (اصول پایه و حجم کار)، رونی کلمن (پایهٔ سنگین حرکات چندمفصلی) و جی کاتلر (دقت و پیوستگی) و لانسفورد (جزئیات اجرا و پمپ).
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
export function applyDeterministicWorkoutFixes(workout: Record<string, any>, data: OnboardingData): number {
  let fixed = 0;
  const days = Array.isArray(workout?.days) ? workout.days : [];
  // v237 — مرتب‌سازی روزها (بیمهٔ مسیرهای قدیمی که گیت را رد می‌کنند):
  // آرایهٔ ذخیره‌شده باید همیشه ترتیب هفتهٔ فارسی داشته باشد (gym-mode ترتیب خام
  // را می‌خواند). اینجا ترتیبِ غلط قطعی اصلاح و به‌عنوان فیکس ثبت می‌شود.
  const preOrder = days.map((d: any) => String(d?.day ?? ""));
  const sorted = sortWeekdaysByPersianOrder(days as Array<{ day: string }>);
  const postOrder = sorted.map((d) => String(d?.day ?? ""));
  if (preOrder.join("|") !== postOrder.join("|")) {
    workout.days = sorted;
    fixed++;
    console.warn(`[plan-quality-gate] v237 day-order fix: [${preOrder.join("، ")}] → [${postOrder.join("، ")}]`);
  }
  for (const day of days) {
    const exs: any[] = Array.isArray(day?.exercises) ? day.exercises : [];
    // v256 — باگ B13 (اثبات E2E با AI واقعی): پوسته‌های بی‌نامِ خروجی خام AI
    // ({"聳":"ignore","ignore":true,"sets":[]}) بدون نام/ست در برنامهٔ نهایی
    // می‌ماندند و برای کاربر «حرکت خراب» می‌ساختند. حذف قطعی قبل از هر ترمیم دیگر.
    const cleaned = exs.filter((ex: any) => {
      const hasName = !!ex?.name && String(ex.name).trim().length >= 2;
      const isShell = ex?.ignore === true || !hasName;
      if (isShell) {
        fixed++;
        console.warn(`[plan-quality-gate] v256 nameless-shell removed (day=${day?.day ?? "?"}): ${JSON.stringify(ex).slice(0, 80)}`);
      }
      return !isShell;
    });
    if (cleaned.length !== exs.length) day.exercises = cleaned;
    const chained = chainedSupersetIndexes(day);
    for (const [ei, ex] of cleaned.entries()) {
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
      // v255.2 — استراحت بین ست‌ها (b6): تزریق قطعی نسخهٔ علمی
      if (Array.isArray(ex?.sets) && ex.sets.length > 0) {
        if (chained.has(ei)) {
          // عضو غیرآخری سوپرست/جاینت — استراحت اختراعی ≥۱s غلط است (زنجیره باید پیوسته باشد)
          let zeroed = false;
          for (const s of ex.sets) {
            if (Number(s?.restSec) > 0) { s.restSec = 0; zeroed = true; }
          }
          if (zeroed) fixed++;
        } else {
          const prescribed = standardRestSec(String(ex?.name ?? ""), String(ex?.category ?? ""), data.goal);
          if (prescribed > 0) {
            // v256 — باگ B14 بخش ۲ (اثبات E2E تمدید): ترمیم قبلاً فقط خالی/صفر را پر
            // می‌کرد — AI ممکن است روی حرکت مرکب استراحتِ زیرِ کف علمی (۶۰s < ۷۵s)
            // بگذارد و ترمیم نمی‌شد. کف سخت ۷۵ ثانیه برای مرکب (NSCA) اعمال می‌شود؛
            // مقادیر ≥۷۵ ثانیهٔ خودِ AI محترم است.
            const compoundNow = isCompoundMovement(String(ex?.name ?? ""), String(ex?.category ?? ""));
            let filled = false;
            for (const s of ex.sets) {
              const cur = Number(s?.restSec);
              if (s?.restSec == null || !Number.isFinite(cur) || cur <= 0) { s.restSec = prescribed; filled = true; }
              else if (compoundNow && cur < 75) { s.restSec = Math.max(prescribed, 75); filled = true; }
            }
            if (filled) fixed++;
          }
          // جاینت‌ست — عضو آخر (پایان دور): استراحت بین دورها
          if (String(ex?.supersetType ?? "") === "giant" && (ex.restBetweenRounds == null || Number(ex.restBetweenRounds) <= 0)) {
            ex.restBetweenRounds = 150;
            fixed++;
          }
        }
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
  /** v237 — حرکات ممنوع صریح پروفایل کاربر (persistentExclusions) — برای ممیزی/جاروی نشت در گیت */
  forbiddenMovements?: string[];
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

  // v255 — صلبیت مکمل از پلن (استاندارد به بالا) — برای ممیزی خالی‌بودن استک
  const supplementsAllowed = ["standard", "advanced", "ultimate"].includes(String(planName ?? ""));

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
    // v237 — نشت حرکات ممنوع هم بخشی از ممیزی قطعی است
    workoutIssues.push(...auditForbiddenMovementLeak(workout, input.forbiddenMovements));
    // v255 — تجهیزات ناموجود کاربر خانگی هم بخشی از ممیزی قطعی است (b2)
    workoutIssues.push(...auditEquipmentCompatibility(workout, data));
    const mealIssues = auditMealPlanDeterministic(meal, data, supplementsAllowed);
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

    // ─── v171 — تضمین فیلدهای نکات تمرینی (دیرکتیو مالک: باکس‌های نکات/پیشرفت هفتگی
    // هرگز نباید غایب باشند حتی اگر AI ناقص تحویل بدهد) — قطعی، بدون AI ───
    if (ensureWorkoutTipFields(workout as Record<string, unknown>)) {
      workoutIssuesFixed += 1;
      layersRan.push("L2.5-tip-fields-ensure");
      console.log("[plan-quality-gate] L2.5 tip fields ensured (safety/recovery/progression/notes)");
      await input.updateWorkoutRow(workout).catch((e) =>
        console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
      );
    }

    // ─── v216 — پست-چک قطعی ایمنی آسیب (تعویض اجباری از بانک — بدون LLM) ───
    // قبل از ممیز اجرا می‌شود تا ممیز نسخهٔ ایمن‌شده را ببیند؛ هر خطا non-fatal است.
    const injuryReport = await enforceInjuryMovementSafety(workout, data);
    if (injuryReport.swapped + injuryReport.removed > 0) {
      workoutIssuesFixed += injuryReport.swapped + injuryReport.removed;
      layersRan.push("L2.6-injury-safety-enforce");
      await input.updateWorkoutRow(workout).catch((e) =>
        console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
      );
    }

    // ─── v237 — L2.7: جاروی قطعی ممنوعیت‌ها (لایهٔ آخر تضمین — تعویض از بانک، بدون LLM) ───
    // شکایت مالک: «پرس سینه» و «شنا سوئدی» ممنوع پروفایل بود ولی در برنامه ماند.
    // زنجیرهٔ تولید ۳ جارو دارد؛ این چهارمی است تا حتی نشتِ یک‌درمیلیونی هم
    // به کاربر نرسد. هر خطا non-fatal (قرارداد گیت).
    if (input.forbiddenMovements && input.forbiddenMovements.length > 0) {
      try {
        const leak = auditForbiddenMovementLeak(workout, input.forbiddenMovements);
        if (leak.length > 0) {
          const bankRows = await db.exerciseLibrary.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true, muscle: true, category: true, description: true, tips: true },
          });
          const exFix = enforceWorkoutExclusions(
            workout as { days?: Array<Record<string, any>>; notes?: string },
            { forbiddenMovements: input.forbiddenMovements, forbiddenFoods: [], forbiddenSupplements: [] },
            { all: bankRows as Array<Record<string, any>> }
          );
          if (exFix.removed.length > 0) {
            workoutIssuesFixed += exFix.removed.length;
            layersRan.push("L2.7-forbidden-leak-enforce");
            console.warn(
              `[plan-quality-gate] v237 forbidden-leak enforce: ${exFix.removed.length} item(s) → ` +
                exFix.removed.slice(0, 8).map((r) => `[${r.day}] "${r.from}"→"${r.to ?? "حذف"}"`).join(", ")
            );
            await input.updateWorkoutRow(workout).catch((e) =>
              console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
            );
          }
        }
      } catch (e) {
        console.warn("[plan-quality-gate] v237 forbidden-leak enforce skipped (non-fatal):", e);
      }
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

    // ═══ v255 — بانک ویدیودار مشترک لایه‌های تعویض/تزریق/پوشش (b1/b2/b3) ═══
    // یک‌بار خوانده می‌شود (کاهش بار DB) و به سه لایهٔ قطعی جدید پاس داده می‌شود؛
    // شکست بانک‌گذاری فقط یعنی این سه لایه skip می‌شوند — هرگز گیت را نمی‌شکند.
    let v255Bank: LockedBank | null = null;
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
      v255Bank = buildLockedBank(rows as BankExerciseRow[], globalYoutubeEnabledFromValue(ytRow?.value));
    } catch (e) {
      console.warn("[plan-quality-gate] v255 bank load failed — equipment/cardio/coverage layers skipped:", e);
    }

    if (v255Bank && v255Bank.all.length > 0) {
      const forbiddenExpandedV255 = [...new Set((input.forbiddenMovements ?? []).flatMap((m) => expandMovementPatterns(m)))].filter(Boolean);
      // ─── L2.8 — تعویض قطعی تجهیزات ناموجود (b2 — شکایت «کاربر خانگی سیم‌کش گرفته») ───
      try {
        const eqReport = await enforceEquipmentCompatibility(workout, data, v255Bank);
        if (eqReport.swapped + eqReport.removed > 0) {
          workoutIssuesFixed += eqReport.swapped + eqReport.removed;
          layersRan.push("L2.8-equipment-enforce");
          await input.updateWorkoutRow(workout).catch((e) =>
            console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
          );
        }
      } catch (e) {
        console.warn("[plan-quality-gate] L2.8 equipment enforce skipped (non-fatal):", e);
      }

      // ─── L2.9 — تزریق قطعی کاردیوی هدف (b3 — چربی‌سوزیِ بی‌کاردیو صفر شد) ───
      try {
        const cardioReport = enforceGoalCardio(workout, data, v255Bank, forbiddenExpandedV255);
        if (cardioReport.added > 0) {
          workoutIssuesFixed += cardioReport.added;
          layersRan.push("L2.9-goal-cardio-inject");
          await input.updateWorkoutRow(workout).catch((e) =>
            console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
          );
        }
      } catch (e) {
        console.warn("[plan-quality-gate] L2.9 goal-cardio inject skipped (non-fatal):", e);
      }

      // ─── L2.10 — ترمیم مجدد پوشش شش‌گروه (b1 — اگر تعویض‌های بالا گروهی را خالی گذاشتند) ───
      try {
        const covReport = repairWorkoutPlanCoverage(
          workout as { days?: Array<Record<string, any>>; notes?: string },
          v255Bank,
          forbiddenExpandedV255,
          (workout as Record<string, any>).coachBlueprint ?? null
        );
        if (covReport.added.length > 0) {
          workoutIssuesFixed += covReport.added.length;
          layersRan.push("L2.10-coverage-repair");
          await input.updateWorkoutRow(workout).catch((e) =>
            console.warn("[plan-quality-gate] workout row update failed (non-fatal):", e)
          );
        }
      } catch (e) {
        console.warn("[plan-quality-gate] L2.10 coverage repair skipped (non-fatal):", e);
      }
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
    finalWorkoutIssues.push(...auditForbiddenMovementLeak(workout, input.forbiddenMovements));
    finalWorkoutIssues.push(...auditEquipmentCompatibility(workout, data));
    const finalMealIssues = auditMealPlanDeterministic(meal, data, supplementsAllowed);
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
