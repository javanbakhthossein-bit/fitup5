/**
 * scripts/test-rest-fix-v255.ts — راستی‌آزمایی فیکس b6 (استراحت بین ست‌ها)
 * ممیزی → ترمیم قطعی → ممیزی مجدد باید صفر باشد؛ هم‌چنین مرزهای صحیح:
 * عضو زنجیره‌ای سوپرست (استراحت ۰ صحیح) و کاردیوی پیوسته نباید فلگ شوند.
 * فقط خواندنی روی DB (هیچ ردیفی ذخیره نمی‌شود — همه‌چیز در حافظه است).
 * اجرا: bun scripts/test-rest-fix-v255.ts
 */
import {
  auditWorkoutPlanDeterministic,
  applyDeterministicWorkoutFixes,
} from "@/lib/fitness/plan-quality-gate";
import type { OnboardingData } from "@/lib/fitness/types";

const baseData = {
  goal: "muscle_gain",
  workoutDays: 3,
  trainingExperience: "intermediate",
} as unknown as OnboardingData;

const fatData = {
  goal: "fat_loss",
  workoutDays: 3,
  trainingExperience: "beginner",
} as unknown as OnboardingData;

function mkSet(reps: string, restSec: number | null) {
  return restSec == null ? { setNumber: 1, reps } : { setNumber: 1, reps, restSec };
}

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}`);
  }
}

function run(name: string, workout: Record<string, any>, data: OnboardingData) {
  console.log(`\n### ${name}`);
  const before = auditWorkoutPlanDeterministic(workout, data).filter((i) => i.code === "workout_missing_rest");
  const fixed = applyDeterministicWorkoutFixes(workout, data);
  const after = auditWorkoutPlanDeterministic(workout, data).filter((i) => i.code === "workout_missing_rest");
  return { before: before.length, fixed, after: after.length };
}

// ─── ① پرس سینه هالتر (کامپاند، عضله‌سازی) بدون استراحت → ۱۲۰ ───
{
  const w = {
    days: [
      {
        day: "شنبه",
        exercises: [
          { name: "پرس سینه هالتر", category: "push", sets: [mkSet("8-10", 0), mkSet("8-10", null)] },
        ],
      },
    ],
  };
  const r = run("کامپاند بدون استراحت", w, baseData);
  check("ممیزی قبل: فلگ شد", r.before === 1);
  check("ترمیم اجرا شد", r.fixed > 0);
  check("استراحت = ۱۲۰s (کامپاند عضله‌سازی)", w.days[0].exercises[0].sets.every((s: any) => s.restSec === 120));
  check("ممیزی بعد: صفر", r.after === 0);
}

// ─── ② سوپرست: عضو اول با استراحت اختراعی ۹۰ → صفر؛ عضو آخر → ۷۵ ───
{
  const w = {
    days: [
      {
        day: "شنبه",
        exercises: [
          { name: "جلو بازو دمبل", category: "pull", supersetGroup: "A", supersetType: "superset", sets: [mkSet("10-12", 90)] },
          { name: "پشت بازو سیم کش", category: "push", supersetGroup: "A", supersetType: "superset", sets: [mkSet("10-12", 0)] },
        ],
      },
    ],
  };
  const r = run("سوپرست", w, baseData);
  check("ممیزی قبل: فلگ شد (عضو آخر صفر است)", r.before === 1);
  check("عضو اول زنجیره‌ای → استراحت صفر شد", w.days[0].exercises[0].sets[0].restSec === 0);
  check("عضو آخر → استراحت ۷۵s (ایزوله عضله‌سازی)", w.days[0].exercises[1].sets[0].restSec === 75);
  check("ممیزی بعد: صفر", r.after === 0);
}

// ─── ③ کاردیوی پیوسته — استراحت صفر صحیح است، نباید فلگ شود ───
{
  const w = {
    days: [
      {
        day: "شنبه",
        exercises: [{ name: "تردمیل پیوسته", category: "cardio", sets: [mkSet("20 دقیقه", 0)] }],
      },
    ],
  };
  const r = run("کاردیوی پیوسته", w, baseData);
  check("ممیزی قبل: بدون فلگ", r.before === 0);
  check("ممیزی بعد: بدون فلگ", r.after === 0);
}

// ─── ④ پلانک (core) بدون استراحت → ۴۵ ───
{
  const w = {
    days: [
      {
        day: "شنبه",
        exercises: [{ name: "پلانک", category: "core", sets: [mkSet("45s", null), mkSet("45s", null)] }],
      },
    ],
  };
  const r = run("core بدون استراحت", w, baseData);
  check("ممیزی قبل: فلگ شد", r.before === 1);
  check("استراحت = ۴۵s (core)", w.days[0].exercises[0].sets.every((s: any) => s.restSec === 45));
  check("ممیزی بعد: صفر", r.after === 0);
}

// ─── ⑤ چربی‌سوزی: ایزوله → ۴۵ / کامپاند → ۹۰ ───
{
  const w = {
    days: [
      {
        day: "شنبه",
        exercises: [
          { name: "اسکوات هالتر", category: "legs", sets: [mkSet("12-15", 0)] },
          { name: "نشر جانب دمبل", category: "push", sets: [mkSet("12-15", null)] },
        ],
      },
    ],
  };
  const r = run("چربی‌سوزی", w, fatData);
  check("ممیزی قبل: ۲ فلگ", r.before === 2);
  check("کامپاند چربی‌سوزی = ۹۰s", w.days[0].exercises[0].sets[0].restSec === 90);
  check("ایزوله چربی‌سوزی = ۴۵s", w.days[0].exercises[1].sets[0].restSec === 45);
  check("ممیزی بعد: صفر", r.after === 0);
}

// ─── ⑥ جاینت‌ست: عضو آخر بدون restBetweenRounds → ۱۵۰ ───
{
  const w = {
    days: [
      {
        day: "شنبه",
        exercises: [
          { name: "شنا سوئدی", category: "push", supersetGroup: "C", supersetType: "giant", sets: [mkSet("12", 0)] },
          { name: "کوهنوردی", category: "core", supersetGroup: "C", supersetType: "giant", sets: [mkSet("30s", 0)] },
          { name: "پارالل", category: "push", supersetGroup: "C", supersetType: "giant", sets: [mkSet("10", 0)] },
        ],
      },
    ],
  };
  const r = run("جاینت‌ست", w, baseData);
  check("عضو آخر جاینت → restBetweenRounds=۱۵۰", w.days[0].exercises[2].restBetweenRounds === 150);
  check("اعضای زنجیره‌ای صفر ماندند", w.days[0].exercises[0].sets[0].restSec === 0 && w.days[0].exercises[1].sets[0].restSec === 0);
  check("ممیزی بعد: صفر", r.after === 0);
  void r;
}

// ─── ⑦ برنامهٔ واقعی پرچم‌دار ممیزی (۰۹۰۴۶۸۱۰۷۱۵) — بدون ریسک، در حافظه ───
{
  const { db } = await import("@/lib/db");
  const u = await db.user.findFirst({ where: { mobile: "09046810715" }, select: { id: true } });
  if (u) {
    const wp = await db.workoutPlan.findFirst({
      where: { userId: u.id, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (wp) {
      const workout = JSON.parse(wp.content) as Record<string, any>;
      const data = baseData;
      const before = auditWorkoutPlanDeterministic(workout, data).filter((i) => i.code === "workout_missing_rest");
      applyDeterministicWorkoutFixes(workout, data);
      const after = auditWorkoutPlanDeterministic(workout, data).filter((i) => i.code === "workout_missing_rest");
      console.log(`\n### برنامهٔ واقعی 09046810715`);
      check(`ممیزی قبل: ${before.length} فلگ → بعد: ${after.length} (باید صفر)`, after.length === 0);
      const totalSets = workout.days.flatMap((d: any) => d.exercises ?? []).flatMap((e: any) => e.sets ?? []);
      check("همهٔ ست‌ها استراحت عددی دارند", totalSets.every((s: any) => Number.isFinite(Number(s.restSec))));
    } else {
      console.log("\n### برنامهٔ واقعی یافت نشد — skip");
    }
    await db.$disconnect();
  }
}

console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
if (fail > 0) process.exit(1);
