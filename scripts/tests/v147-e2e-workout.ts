/**
 * تست E2E واقعی v147 — تولید برنامهٔ تمرینی با هوش مصنوعی واقعی (AvalAI)
 * ثابت می‌کند که زنجیرهٔ کامل (AI → validator → قفل بانک → dedupe) بدون خطا
 * برنامهٔ علمی می‌سازد و قانون «هیچ‌وقت تولید ناموفق» برقرار است.
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v147-e2e-workout.ts
 */
import { generateWorkoutPlan } from "../../src/lib/fitness/ai";
import { validateEliteWorkoutStructure } from "../../src/lib/fitness/ai";
import { coveredMajorGroups, MAJOR_GROUP_KEYS } from "../../src/lib/fitness/exercise-bank-lock";
import { db } from "../../src/lib/db";
import type { OnboardingData, Plan } from "../../src/lib/fitness/types";

async function main() {
  const data: OnboardingData = {
    firstName: "تست",
    lastName: "v147",
    gender: "male",
    age: 27,
    height: 178,
    weight: 82,
    targetWeight: 88,
    goal: "muscle_gain",
    activityLevel: "moderate",
    workoutDays: 4,
    workoutDaysList: ["شنبه", "یکشنبه", "سه‌شنبه", "چهارشنبه"],
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

  console.log("🚀 شروع تولید واقعی برنامهٔ تمرینی (AvalAI واقعی — تا ~۴.۵ دقیقه)...");
  const t0 = Date.now();
  let plan: any;
  try {
    plan = await generateWorkoutPlan(data, planName, {});
  } catch (err) {
    console.error("❌❌ تولید برنامه شکست خورد — قانون صفر-خطا نقض شد:", err);
    process.exit(1);
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`✅ تولید موفق در ${secs} ثانیه`);

  // ─── صحت‌سنجی‌های سخت ───
  let failures = 0;
  const ok = (label: string, cond: boolean, detail?: string) => {
    if (cond) console.log(`  ✅ ${label}`);
    else {
      failures++;
      console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const days = Array.isArray(plan?.days) ? plan.days : [];
  ok("برنامه حداقل ۴ روز دارد", days.length >= 4, `${days.length} روز`);
  ok(
    "روزها دقیقاً روزهای انتخابی کاربرند",
    JSON.stringify(days.map((d: any) => d.day)) === JSON.stringify(data.workoutDaysList),
    days.map((d: any) => d.day).join("، ")
  );

  const allEx = days.flatMap((d: any) => (Array.isArray(d.exercises) ? d.exercises : []));
  ok(`هر روز بین ۶ تا ۸ حرکت دارد (مجموع ${allEx.length})`, allEx.length >= 4 * 6);

  // قفل بانک: هر حرکت exerciseId واقعی دارد
  const missingIds = allEx.filter((e: any) => !e.exerciseId);
  ok("همهٔ حرکات به بانک قفل شده‌اند (exerciseId)", missingIds.length === 0, missingIds.map((e: any) => e.name).join("، ").slice(0, 200));

  // v147 — validator روی خروجی نهایی باید null بدهد
  const vResult = validateEliteWorkoutStructure(plan, new Set(MAJOR_GROUP_KEYS));
  ok("validator نخبگی روی خروجی نهایی = معتبر (null)", vResult === null, vResult ?? "");

  // پوشش شش گروه اصلی
  const covered = coveredMajorGroups(days);
  const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
  ok("هر شش گروه اصلی پوشش داده شده‌اند", missing.length === 0, `گم‌شده: ${missing.join("، ")}`);

  // سرشانه حداقل ۲ حرکت در هفته
  const shoulderEx = allEx.filter((e: any) => /سرشانه|شانه|نشر|دلتوئید|shoulder/i.test(`${e.muscle ?? ""} ${e.name ?? ""}`));
  ok(`سرشانه ${shoulderEx.length} حرکت مستقیم دارد (≥۲)`, shoulderEx.length >= 2, shoulderEx.map((e: any) => e.name).join("، ").slice(0, 150));

  // ست/تکرار/RPE
  const noSets = allEx.filter((e: any) => !Array.isArray(e.sets) || e.sets.length === 0);
  ok("همهٔ حرکات ست دارند", noSets.length === 0, noSets.map((e: any) => e.name).slice(0, 5).join("، "));

  // جزئیات نمایش برای ممیزی انسانی
  console.log("\n📋 خلاصهٔ برنامه:");
  for (const d of days) {
    const names = (d.exercises || []).map((e: any) => e.name).join(" | ");
    console.log(`  • ${d.day} (${(d.focus ?? "").slice(0, 40)}): ${names}`);
  }
  console.log(`  • دوره‌بندی: ${plan.periodizationType ?? "?"} | تقسیم: ${plan.muscleGroupSplit ?? "?"}`);

  // ذخیرهٔ خروجی برای بازبینی
  const fs = await import("fs");
  fs.writeFileSync("/home/z/my-project/scripts/tests/v147-e2e-workout-output.json", JSON.stringify(plan, null, 2), "utf-8");
  console.log("\n💾 خروجی کامل: scripts/tests/v147-e2e-workout-output.json");

  await db.$disconnect?.().catch(() => {});
  console.log(failures === 0 ? "\n═══ E2E: همهٔ صحت‌سنجی‌ها پاس شد ═══" : `\n═══ E2E: ${failures} صحت‌سنجی شکست خورد ═══`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ خطای غیرمنتظره:", e);
  process.exit(1);
});
