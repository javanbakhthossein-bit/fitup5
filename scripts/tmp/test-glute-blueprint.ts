import { buildCoachBlueprint, buildBlueprintDirectiveFa } from "../../src/lib/fitness/coach-blueprint";

// Tina's exact profile
const bp = buildCoachBlueprint({
  gender: "female",
  age: 31,
  goal: "bulk",
  trainingExperience: "advanced",
  workoutDays: 3,
  workoutDaysList: ["دوشنبه", "چهارشنبه", "شنبه"],
  workoutPlace: "gym",
  equipment: ["dumbbell", "kettlebell", "pullup_bar", "machine", "barbell", "bands", "bench", "trx"],
  discipline: "womens_fitness",
  bodyShape: "athletic",
  smokingHabit: "daily_light",
  specialConditions: "",
  seed: 777,
});
console.log("=== TINA BLUEPRINT: split =", bp.splitId, "|", bp.splitLabelFa);
for (const d of bp.days) console.log(`  ${d.day} — «${d.title}» primary: ${d.primary.join("،")} | secondary: ${d.secondary.join("،")}`);
console.log("\n=== WEEKLY SETS:");
for (const w of bp.weeklySets) console.log(`  ${w.muscle}: ${w.min}-${w.max} ست، فرکانس ${w.frequency}، priority=${w.priority}`);
console.log("\n=== RATIONALE:");
for (const r of bp.rationaleLines) console.log("  •", r.slice(0, 140));

// Test run 10 seeds — must ALWAYS pick glute split for Tina
import { buildCoachBlueprint as b } from "../../src/lib/fitness/coach-blueprint";
const picks = new Set<string>();
for (let s = 0; s < 10; s++) {
  const x = b({
    gender: "female", age: 31, goal: "bulk", trainingExperience: "advanced",
    workoutDays: 3, workoutDaysList: ["دوشنبه", "چهارشنبه", "شنبه"],
    workoutPlace: "gym", equipment: ["dumbbell", "machine", "barbell", "bench"],
    discipline: "womens_fitness", bodyShape: "athletic", seed: s * 111,
  });
  picks.add(x.splitId);
}
console.log("\n=== 10-seed stability for Tina:", [...picks].join(", "), "(expect only glute_focus_split)");

// Control: male bodybuilding 3-day should NOT get glute split
const male = b({
  gender: "male", age: 30, goal: "muscle_gain", trainingExperience: "intermediate",
  workoutDays: 3, workoutDaysList: ["شنبه", "دوشنبه", "چهارشنبه"],
  workoutPlace: "gym", equipment: ["barbell", "machine"], discipline: "bodybuilding", seed: 42,
});
console.log("=== Control male bodybuilding:", male.splitId, "(expect NOT glute_focus_split)");
