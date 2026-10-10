import { splitMergedSupersetEntries } from "../../src/lib/fitness/plan-superset-repair";

// Case 1: Hossein's actual merged superset (prefix + "+")
const plan1: any = {
  days: [{
    day: "شنبه",
    exercises: [
      {
        name: "سوپرست A — پرس سینه با هالتر (Barbell Bench Press) + بارفیکس (Pull-Up)",
        muscle: "سینه / زیربغل",
        category: "push",
        description: "روی نیمکت دراز بکشید...",
        sets: [
          { setNumber: 1, reps: "8-10", restSec: 0, rpe: 7 },
          { setNumber: 2, reps: "8-10", restSec: 0, rpe: 8 },
          { setNumber: 3, reps: "8-10", restSec: 0, rpe: 8 },
          { setNumber: 4, reps: "6-8", restSec: 90, rpe: 9 },
        ],
      },
      { name: "پرس بالاسینه دمبل", muscle: "بالای سینه", sets: [{ setNumber: 1, reps: "10", restSec: 90 }] },
    ],
  }],
};
const r1 = splitMergedSupersetEntries(plan1);
console.log("=== Case 1 (Hossein merged): splitCount =", r1.splitCount);
const day1 = plan1.days[0].exercises;
console.log("exercises now:", day1.length, "(expected 3)");
for (const ex of day1) console.log(" -", JSON.stringify({ name: ex.name, muscle: ex.muscle, group: ex.supersetGroup, type: ex.supersetType, rest: ex.sets.map((s: any) => s.restSec) }));

// Case 2: no prefix but "+" in name + "/" in muscle
const plan2: any = { days: [{ day: "دوشنبه", exercises: [
  { name: "پرس سینه دمبل + شنا", muscle: "سینه / سینه", sets: [{ setNumber: 1, reps: "12", restSec: 60 }] },
  { name: "اسکوات با هالتر", muscle: "پا", sets: [{ setNumber: 1, reps: "8", restSec: 120 }] },
] }] };
const r2 = splitMergedSupersetEntries(plan2);
console.log("\n=== Case 2 (prefixless merged): splitCount =", r2.splitCount);
for (const ex of plan2.days[0].exercises) console.log(" -", JSON.stringify({ name: ex.name, group: ex.supersetGroup, type: ex.supersetType, rest: ex.sets.map((s: any) => s.restSec) }));

// Case 3: healthy single exercise with "+" in a single name should NOT split
const plan3: any = { days: [{ day: "سه‌شنبه", exercises: [
  { name: "پرس سینه با هالتر", muscle: "سینه", sets: [{ setNumber: 1, reps: "8", restSec: 90 }] },
] }] };
const r3 = splitMergedSupersetEntries(plan3);
console.log("\n=== Case 3 (healthy, no split): splitCount =", r3.splitCount, "(expected 0)");

// Case 4: triset prefix with 3 members
const plan4: any = { days: [{ day: "چهارشنبه", exercises: [
  { name: "تری‌ست B — قفسه سینه سیم‌کش + شنا + پک‌دک", muscle: "سینه / سینه / سینه", sets: [{ setNumber: 1, reps: "12", restSec: 100 }, { setNumber: 2, reps: "12", restSec: 100 }] },
] }] };
const r4 = splitMergedSupersetEntries(plan4);
console.log("\n=== Case 4 (triset): splitCount =", r4.splitCount);
for (const ex of plan4.days[0].exercises) console.log(" -", JSON.stringify({ name: ex.name, group: ex.supersetGroup, type: ex.supersetType, rest: ex.sets.map((s: any) => s.restSec) }));
