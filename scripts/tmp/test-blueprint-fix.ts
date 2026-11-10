import { buildCoachBlueprint, enforceBlueprintDayIdentity, enforceBlueprintDayTitles, matchBlueprintDayIndex } from "../../src/lib/fitness/coach-blueprint";

// Yashar's exact profile (workoutDaysList in HIS raw order)
const bp = buildCoachBlueprint({
  gender: "male",
  age: 25,
  goal: "cut",
  trainingExperience: "intermediate",
  workoutDays: 5,
  workoutDaysList: ["یکشنبه", "سه‌شنبه", "شنبه", "دوشنبه", "چهارشنبه"], // ترتیب خام کاربر
  workoutPlace: "gym",
  equipment: ["dumbbell", "barbell", "machine"],
  injuries: "زانو، سابقه جراحی",
  injuryAreas: ["knee", "surgery_history"],
  bodyShape: "rectangle",
  seed: 12345,
});
console.log("=== BLUEPRINT DAYS (must be شنبه-first Persian order):");
for (const d of bp.days) console.log(`  ${d.day} — «${d.title}» primary: ${d.primary.join("،")}`);

// Simulate the broken plan: شنبه titled "روز پا" but full of chest
const parsed: any = {
  days: [
    { day: "شنبه", title: "روز پا — پایه‌سازی ایمن با محافظت از زانو", focus: "چهارسر، پشت پا، باسن و ساق", exercises: [
      { name: "پرس سینه با هالتر", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "8", restSec: 90 }] },
      { name: "پرس سینه با دمبل", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "8", restSec: 90 }] },
      { name: "پرس بالاسینه با هالتر", muscle: "بالای سینه", category: "push", sets: [{ setNumber: 1, reps: "8", restSec: 90 }] },
      { name: "فلای سینه با سیم‌کش", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "12", restSec: 60 }] },
      { name: "شنا", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "15", restSec: 60 }] },
      { name: "پرس زیرسینه با هالتر", muscle: "زیرسینه", category: "push", sets: [{ setNumber: 1, reps: "8", restSec: 90 }] },
      { name: "فلای سینه با دمبل", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "12", restSec: 60 }] },
    ] },
  ],
};
console.log("\n=== matchBlueprintDayIndex(شنبه) =", matchBlueprintDayIndex(bp, "شنبه", 0), "→ bp day:", bp.days[matchBlueprintDayIndex(bp, "شنبه", 0)].day);

// Without bank, identity can't replace — but title check works without bank
const titles = enforceBlueprintDayTitles(parsed, bp);
console.log("\n=== TITLE ENFORCEMENT (no bank needed):");
for (const r of titles) console.log(`  [${r.day}] "${r.from}" → "${r.to}"`);
console.log("  new focus:", parsed.days[0].focus);

// Now check the blueprint directive lists days in Persian order
import { buildBlueprintDirectiveFa } from "../../src/lib/fitness/coach-blueprint";
const directive = buildBlueprintDirectiveFa(bp);
console.log("\n=== DIRECTIVE day lines:");
for (const line of directive.split("\n")) {
  if (/^\s+\d\)/.test(line)) console.log(" ", line.trim().slice(0, 110));
}
