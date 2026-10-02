/**
 * تست واحد v147 — قانون علمی «حداکثر دو واریانت هم‌خانواده در روز»
 * سناریوی دقیق مالک: «جلو بازو هالتر و جلو بازو چکشی می‌تونن در یک روز بیان»
 *   + «اسکوات جلو و اسکوات بلغاری می‌تونن در یک روز بیان»
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v147-family-rule.test.ts
 */
import { validateEliteWorkoutStructure } from "../../src/lib/fitness/ai";
import { dedupeExerciseFamiliesInPlan } from "../../src/lib/fitness/exercise-bank-lock";
import { auditWorkoutPlanDeterministic } from "../../src/lib/fitness/plan-quality-gate";

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

const emptyGroups = new Set();

// ─── ۱) validator ────────────────────────────────────────────────────────────
console.log("\n[۱] validateEliteWorkoutStructure");

// ۱-الف: سناریوی دقیق مالک — جلو بازو هالتر + جلو بازو چکشی در یک روز = مجاز
const ownerCase1 = {
  days: [
    {
      day: "شنبه",
      exercises: [
        { name: "جلو بازو هالتر", muscle: "جلوبازو" },
        { name: "جلو بازو چکشی دمبل (Dumbbell Hammer Curl)", muscle: "جلوبازو" },
      ],
    },
    {
      day: "یکشنبه",
      exercises: [
        { name: "اسکوات جلو (Front Squat)", muscle: "چهارسر" },
        { name: "اسکوات بلغاری", muscle: "چهارسر" },
      ],
    },
  ],
};
const r1 = validateEliteWorkoutStructure(ownerCase1, emptyGroups);
check("جلو بازو هالتر + چکشی و اسکوات جلو + بلغاری در روز = معتبر", r1 === null, r1 ?? "");

// ۱-ب: چهار بارفیکس در یک روز = رد (شکایت اولیهٔ مالک)
const fourPullups = {
  days: [
    {
      day: "شنبه",
      exercises: [
        { name: "بارفیکس دست باز", muscle: "زیربغل" },
        { name: "بارفیکس دست جمع", muscle: "زیربغل" },
        { name: "بارفیکس دست برعکس", muscle: "زیربغل" },
        { name: "بارفیکس سنگین", muscle: "زیربغل" },
      ],
    },
  ],
};
const r2 = validateEliteWorkoutStructure(fourPullups, emptyGroups);
check("۴ بارفیکس در یک روز = رد", typeof r2 === "string" && r2.includes("تنوع حرکتی"), r2 ?? "null");

// ۱-ج: سه واریانت یک خانواده = رد
const threeCurls = {
  days: [
    {
      day: "دوشنبه",
      exercises: [
        { name: "جلو بازو هالتر", muscle: "جلوبازو" },
        { name: "جلو بازو چکشی دمبل", muscle: "جلوبازو" },
        { name: "جلو بازو سیم‌کش", muscle: "جلوبازو" },
      ],
    },
  ],
};
const r3 = validateEliteWorkoutStructure(threeCurls, emptyGroups);
check("۳ واریانت جلو بازو در یک روز = رد", typeof r3 === "string" && r3.includes("حداکثر دو واریانت"), r3 ?? "null");

// ۱-د: تکرار دقیق همان حرکت = رد
const exactDup = {
  days: [
    {
      day: "سه‌شنبه",
      exercises: [
        { name: "پرس سینه هالتر", muscle: "سینه" },
        { name: "پرس سینه هالتر", muscle: "سینه" },
      ],
    },
  ],
};
const r4 = validateEliteWorkoutStructure(exactDup, emptyGroups);
check("تکرار دقیق حرکت = رد", typeof r4 === "string" && r4.includes("دو بار تکرار"), r4 ?? "null");

// ۱-ه: واریانت دوم + خانواده‌های متفاوت دیگر = معتبر (برنامهٔ واقعی یک روز بازو)
const realArmDay = {
  days: [
    {
      day: "چهارشنبه",
      exercises: [
        { name: "جلو بازو هالتر", muscle: "جلوبازو" },
        { name: "جلو بازو چکشی دمبل", muscle: "جلوبازو" },
        { name: "پشت بازو سیم‌کش", muscle: "پشت بازو" },
        { name: "پشت بازو هالتر خوابیده", muscle: "پشت بازو" },
      ],
    },
  ],
};
const r5 = validateEliteWorkoutStructure(realArmDay, emptyGroups);
check("روز بازو با ۲ واریانت جلوبازو + ۲ واریانت پشت‌بازو = معتبر", r5 === null, r5 ?? "");

// ─── ۲) dedupeExerciseFamiliesInPlan ────────────────────────────────────────
console.log("\n[۲] dedupeExerciseFamiliesInPlan");
const bank = {
  all: [
    { id: "b1", name: "جلو بازو هالتر", muscle: "جلوبازو", category: "strength" },
    { id: "b2", name: "جلو بازو چکشی دمبل", muscle: "جلوبازو", category: "strength" },
    { id: "b3", name: "جلو بازو سیم‌کش", muscle: "جلوبازو", category: "strength" },
    { id: "b4", name: "جلو بازو لاری", muscle: "جلوبازو", category: "strength" },
    { id: "b5", name: "پرس سینه هالتر", muscle: "سینه", category: "strength" },
    { id: "b6", name: "قفسه سینه دمبل", muscle: "سینه", category: "strength" },
    { id: "b7", name: "پرس سینه دستگاه", muscle: "سینه", category: "strength" },
    { id: "b8", name: "کراس اور سیم‌کش", muscle: "سینه", category: "strength" },
    { id: "b9", name: "پول اور دمبل", muscle: "سینه", category: "strength" },
    { id: "b10", name: "پرس بالاسینه دمبل", muscle: "بالاسینه", category: "strength" },
    { id: "b11", name: "شنا سوئدی", muscle: "سینه", category: "strength" },
    { id: "b12", name: "پارالل", muscle: "سینه", category: "strength" },
    { id: "b13", name: "پشت بازو سیم‌کش", muscle: "پشت بازو", category: "strength" },
    { id: "b14", name: "پشت بازو هالتر خوابیده", muscle: "پشت بازو", category: "strength" },
    { id: "b15", name: "دیپ پشت بازو دستگاه", muscle: "پشت بازو", category: "strength" },
  ] as any[],
  excludedCount: 0,
} as any;

// ۲-الف: دو واریانت جلوبازو — دست‌نخورده (هیچ جایگزینی ممنوع)
const planTwoVariants = {
  days: [
    {
      day: "شنبه",
      exercises: [
        { name: "جلو بازو هالتر", exerciseId: "b1", sets: 4 },
        { name: "جلو بازو چکشی دمبل", exerciseId: "b2", sets: 3 },
      ],
    },
  ],
};
const d1 = dedupeExerciseFamiliesInPlan(planTwoVariants as any, bank);
check(
  "۲ واریانت جلو بازو دست‌نخورده می‌ماند",
  d1.replaced.length === 0 && planTwoVariants.days[0].exercises[0].name === "جلو بازو هالتر" && planTwoVariants.days[0].exercises[1].name === "جلو بازو چکشی دمبل",
  JSON.stringify(d1.replaced)
);

// ۲-ب: سه واریانت — سومی با خانوادهٔ جدید جایگزین می‌شود
const planThreeVariants = {
  days: [
    {
      day: "یکشنبه",
      exercises: [
        { name: "جلو بازو هالتر", exerciseId: "b1", sets: 4 },
        { name: "جلو بازو چکشی دمبل", exerciseId: "b2", sets: 3 },
        { name: "جلو بازو سیم‌کش", exerciseId: "b3", sets: 3 },
      ],
    },
  ],
};
const d2 = dedupeExerciseFamiliesInPlan(planThreeVariants as any, bank);
check(
  "واریانت سوم جلو بازو جایگزین شد (با حرکت هم‌گروه بازو از خانوادهٔ جدید)",
  d2.replaced.length === 1 && planThreeVariants.days[0].exercises[2].name !== "جلو بازو سیم‌کش",
  JSON.stringify(d2.replaced)
);
console.log(`     → جایگزین: «${planThreeVariants.days[0].exercises[2].name}»`);

// ۲-ج: تکرار دقیق — ترمیم می‌شود
const planExactDup = {
  days: [
    {
      day: "دوشنبه",
      exercises: [
        { name: "پرس سینه هالتر", exerciseId: "b5", sets: 4 },
        { name: "پرس سینه هالتر", exerciseId: "b5", sets: 3 },
      ],
    },
  ],
};
const d3 = dedupeExerciseFamiliesInPlan(planExactDup as any, bank);
check(
  "تکرار دقیق پرس سینه ترمیم شد",
  d3.replaced.length === 1 && planExactDup.days[0].exercises[1].name !== "پرس سینه هالتر",
  JSON.stringify(d3.replaced)
);

// ─── ۳) گیت کیفیت ────────────────────────────────────────────────────────────
console.log("\n[۳] auditWorkoutPlanDeterministic — قانون خانواده");
const gatePlanOwner = {
  days: [
    {
      day: "شنبه",
      exercises: [
        { name: "جلو بازو هالتر", muscle: "جلوبازو", sets: 4, rpe: 8, tempo: "3-1-2-0" },
        { name: "جلو بازو چکشی دمبل (Dumbbell Hammer Curl)", muscle: "جلوبازو", sets: 3, rpe: 8, tempo: "3-1-2-0" },
      ],
    },
  ],
};
const gateIssues1 = auditWorkoutPlanDeterministic(gatePlanOwner as any, { workoutDays: 2 } as any);
const famIssues1 = gateIssues1.filter((i: any) => i.code === "workout_family_duplicate");
check("گیت کیفیت: سناریوی مالک صفر ایراد خانواده", famIssues1.length === 0, JSON.stringify(famIssues1));

const gatePlanFour = {
  days: [
    {
      day: "شنبه",
      exercises: [
        { name: "بارفیکس دست باز", muscle: "زیربغل", sets: 4, rpe: 8 },
        { name: "بارفیکس دست جمع", muscle: "زیربغل", sets: 4, rpe: 8 },
        { name: "بارفیکس دست برعکس", muscle: "زیربغل", sets: 4, rpe: 8 },
        { name: "بارفیکس سنگین", muscle: "زیربغل", sets: 4, rpe: 8 },
      ],
    },
  ],
};
const gateIssues2 = auditWorkoutPlanDeterministic(gatePlanFour as any, { workoutDays: 1 } as any);
const famIssues2 = gateIssues2.filter((i: any) => i.code === "workout_family_duplicate");
check("گیت کیفیت: ۴ بارفیکس → ایراد critical", famIssues2.length >= 1, JSON.stringify(famIssues2));

console.log(`\n═══ نتیجه: ${pass} پاس | ${fail} شکست ═══`);
process.exit(fail > 0 ? 1 : 0);
