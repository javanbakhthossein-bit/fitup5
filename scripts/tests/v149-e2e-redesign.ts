/**
 * تست E2E واقعی v149 — «بازطراحی چت: برنامه عیناً عین درخواست ورزشکار»
 * سناریوی دقیق تیکت مالک: کاربر در چت خواسته «۳ روز بالاتنه، ۱ روز پایین تنه»
 * (۴ روز تمرین). ثابت می‌کند زنجیرهٔ v149 (دیرکتیو در بالاترین نقطهٔ پرامپت +
 * override بند A + ترمیم قطعی چیدمان بعد از قفل بانک) در «اولین تلاش»
 * برنامه‌ای می‌دهد که چیدمانش عیناً ۳ بالا + ۱ پایین است.
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v149-e2e-redesign.ts
 */
import { generateWorkoutPlan } from "../../src/lib/fitness/ai";
import {
  buildRedesignDirectiveFa,
  classifyPlanDayRegion,
  repairPlanDaySplitToRequest,
  type RequestedSplitSpec,
} from "../../src/lib/fitness/plan-redesign-request";
import { coveredMajorGroups, MAJOR_GROUP_KEYS, MAJOR_GROUP_LABELS_FA, exerciseFamilyKey } from "../../src/lib/fitness/exercise-bank-lock";
import type { OnboardingData, Plan } from "../../src/lib/fitness/types";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const data: OnboardingData = {
    firstName: "تست",
    lastName: "v149",
    gender: "male",
    age: 26,
    height: 180,
    weight: 85,
    targetWeight: 90,
    goal: "muscle_gain",
    activityLevel: "moderate",
    workoutDays: 4,
    workoutDaysList: ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه"],
    workoutPlace: "gym",
    equipment: ["barbell", "dumbbell", "machine", "cable"],
    diseases: "",
    injuries: "",
    allergies: "",
    dietType: "omnivore",
    mealCount: 4,
    trainingExperience: "intermediate",
    previousTrainingType: "بدنسازی",
    bodyFrame: "medium",
    sleepHours: 7,
    stressLevel: 2,
    waterHabit: 6,
    workoutTime: "evening",
    currentSupplements: "وی پروتئین، کراتین",
    discipline: "bodybuilding",
  };
  const planName: Plan = "advanced";

  const spec: RequestedSplitSpec = { upper: 3, lower: 1 };
  const raw = "برنامه‌ام رو بازطراحی کن: سه روز بالاتنه بده یک روز پایین تنه";
  const extras = {
    redesignSpec: spec,
    redesignRaw: raw,
    redesignDirective: buildRedesignDirectiveFa(spec, raw, "چیدمان ۳ روز بالاتنه + ۱ روز پایین‌تنه توافق شد"),
  };

  console.log("🚀 شروع تولید واقعی برنامهٔ تمرینی v149 (AvalAI — deepseek-v4.1-flash)...");
  console.log("🎯 درخواست ساختاری: ۳ روز بالاتنه + ۱ روز پایین‌تنه");
  const t0 = Date.now();
  const plan = await generateWorkoutPlan(data, planName, extras);
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`⏱️  زمان تولید: ${sec} ثانیه`);

  // ─── ۱) زنجیره بدون خطا ───
  check("زنجیرهٔ تولید بدون خطا برنامه برگرداند", Array.isArray(plan?.days) && plan.days.length > 0);
  check("تعداد روزها = ۴", plan.days.length === 4, `دریافتی: ${plan.days.length}`);

  // ─── ۲) چیدمان عیناً ۳ بالا + ۱ پایین (قلب تیکت) ───
  const regions = plan.days.map((d: any) => ({ day: d.day, region: classifyPlanDayRegion(d) }));
  console.log("   چیدمان واقعی:", regions.map((r) => `${r.day}=${r.region}`).join(" | "));
  const upperCount = regions.filter((r) => r.region === "upper").length;
  const lowerCount = regions.filter((r) => r.region === "lower").length;
  check("دقیقاً ۳ روز بالاتنه", upperCount === 3, JSON.stringify(regions));
  check("دقیقاً ۱ روز پایین‌تنه", lowerCount === 1, JSON.stringify(regions));

  // ─── ۳) پوشش شش گروه اصلی حفظ شده ───
  const covered = coveredMajorGroups(plan.days as any);
  const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
  check("پوشش شش گروه اصلی (سرشانه/پا/...)", missing.length === 0, missing.map((g) => MAJOR_GROUP_LABELS_FA[g]).join("، "));

  // ─── ۴) قفل بانک + ست‌ها ───
  const noId = plan.days.flatMap((d: any) => (d.exercises ?? []).filter((e: any) => !e.exerciseId));
  check("همهٔ حرکات ارجاع exerciseId بانک دارند", noId.length === 0, `${noId.length} حرکت بی‌id`);
  const badSets = plan.days.flatMap((d: any) => (d.exercises ?? []).filter((e: any) => !Array.isArray(e.sets) || e.sets.length < 2));
  check("ست‌ها معتبر (حداقل ۲ ست)", badSets.length === 0, `${badSets.length} حرکت`);

  // ─── ۵) شفافیت در نکات مربی ───
  const notes = typeof plan.notes === "string" ? plan.notes : "";
  check("نکات مربی شفافیت درخواست را دارد", notes.includes("طبق درخواست صریح شما") || notes.includes("تحلیل چیدمان"), notes.slice(0, 200));

  // ─── ۶) قانون خانواده حفظ ───
  let familyViolations = 0;
  for (const day of plan.days) {
    const famCount = new Map<string, number>();
    for (const ex of day.exercises ?? []) {
      const fam = exerciseFamilyKey(String(ex.name), ex.muscle);
      famCount.set(fam, (famCount.get(fam) ?? 0) + 1);
    }
    for (const [, c] of famCount) if (c >= 3) familyViolations++;
  }
  check("قانون حداکثر ۲ واریانت هم‌خانواده در روز", familyViolations === 0, `${familyViolations} روز`);

  console.log(`\n═══ نتیجهٔ E2E v149: ${pass} سبز / ${fail} قرمز ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("E2E failed:", e);
  process.exit(1);
});
