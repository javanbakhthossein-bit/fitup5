/**
 * v147 — تست موتور محلی اضطراری بعد از فیکس «تضمین پوشش شش گروه»
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v147-local-engine.test.ts
 */
import { buildLocalFallbackWorkoutPlan } from "../../src/lib/fitness/local-plan-fallback";
import { validateEliteWorkoutStructure } from "../../src/lib/fitness/ai";
import { coveredMajorGroups, MAJOR_GROUP_KEYS } from "../../src/lib/fitness/exercise-bank-lock";
import type { OnboardingData } from "../../src/lib/fitness/types";

const base: OnboardingData = {
  gender: "male",
  age: 28,
  height: 178,
  weight: 80,
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
  trainingExperience: "intermediate",
  discipline: "bodybuilding",
};

let fail = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};

for (const n of [3, 4, 5, 6]) {
  console.log(`\n═══ برنامهٔ ${n} روزه ═══`);
  const plan = await buildLocalFallbackWorkoutPlan({ ...base, workoutDays: n }, "standard");
  const days = plan.days ?? [];
  const allEx = days.flatMap((d: any) => d.exercises ?? []);
  ok(`${n} روز ساخته شد`, days.length === n, `${days.length}`);
  const v = validateEliteWorkoutStructure(plan as any, new Set(MAJOR_GROUP_KEYS));
  ok("validator v147 = معتبر", v === null, v ?? "");
  const covered = coveredMajorGroups(days as any);
  const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
  ok("پوشش ۶ گروه اصلی (شامل شکم)", missing.length === 0, missing.join("، "));
  ok("همهٔ حرکات tempo + rpe دارند", allEx.every((e: any) => e.tempo && e.rpe));
  const coreDays = days.filter((d: any) => (d.exercises ?? []).some((e: any) => (e.muscle || "").includes("شکم"))).length;
  console.log(`  • شکم در ${coreDays} روز | ${allEx.length} حرکت کل`);
  for (const d of days as any[]) {
    console.log(`    - ${d.day}: ${(d.exercises.map((e: any) => e.name)).join(" | ")}`.slice(0, 220));
  }
}

console.log(fail === 0 ? "\n═══ موتور محلی: همه پاس ═══" : `\n═══ ${fail} شکست ═══`);
process.exit(fail > 0 ? 1 : 0);
