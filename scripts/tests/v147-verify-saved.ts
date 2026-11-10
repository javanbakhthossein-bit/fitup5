/**
 * v147 — صحت‌سنجی برنامهٔ ذخیره‌شدهٔ آخرین E2E
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v147-verify-saved.ts
 */
import { validateEliteWorkoutStructure } from "../../src/lib/fitness/ai";
import { coveredMajorGroups, MAJOR_GROUP_KEYS, dedupeExerciseFamiliesInPlan } from "../../src/lib/fitness/exercise-bank-lock";
import { db } from "../../src/lib/db";

const user = await db.user.findFirst({ where: { mobile: "09128912690" } });
if (!user) throw new Error("user not found");
const wp = await db.workoutPlan.findFirst({
  where: { userId: user.id },
  orderBy: { createdAt: "desc" },
});
if (!wp) throw new Error("no workout plan");
const plan = JSON.parse(wp.content);

console.log(`📅 برنامه ذخیره‌شده: ${new Date(wp.createdAt).toLocaleString("fa-IR")} | source=${wp.generatedSource ?? "ai"}`);
let failures = 0;
const ok = (label: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};

const profile = await db.onboardingProfile.findFirst({ where: { userId: user.id } });
const expectedDays = Math.max(1, Math.min(7, Number((profile as any)?.workoutDays) || 4));
const days = Array.isArray(plan?.days) ? plan.days : [];
ok(`${expectedDays} روز برنامه (بر اساس پروفایل)`, days.length === expectedDays, `${days.length}`);
const allEx = days.flatMap((d: any) => (Array.isArray(d.exercises) ? d.exercises : []));
console.log(`  • مجموع حرکات: ${allEx.length}`);
ok("همهٔ حرکات exerciseId دارند", allEx.every((e: any) => e.exerciseId));
ok("validator v147 روی برنامه = معتبر", validateEliteWorkoutStructure(plan, new Set(MAJOR_GROUP_KEYS)) === null);
const covered = coveredMajorGroups(days);
const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
ok("پوشش ۶ گروه اصلی", missing.length === 0, missing.join("، "));

// هیچ روزی ۳+ واریانت هم‌خانواده نداشته باشد (شبیه‌سازی dedupe: گزارش باید خالی باشد)
const probe = JSON.parse(JSON.stringify(plan));
const fakeBank = { all: [], excludedCount: 0 } as any;
const rep = dedupeExerciseFamiliesInPlan(probe, fakeBank);
ok("صفر انباشت خانواده (۳+ واریانت در روز)", rep.replaced.length === 0, JSON.stringify(rep.replaced).slice(0, 200));

console.log("\n📋 روزها:");
for (const d of days) {
  console.log(`  • ${d.day}: ${(d.exercises || []).map((e: any) => e.name).join(" | ")}`.slice(0, 240));
}

// برنامهٔ غذایی
const meal = await db.mealPlan.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
if (meal) {
  const mc = JSON.parse(meal.content);
  const meals = Array.isArray(mc?.meals) ? mc.meals : [];
  console.log(`\n🍽 برنامهٔ غذایی: ${meals.length} وعده | source=${meal.generatedSource ?? "ai"} | کالری=${mc?.targets?.calories ?? mc?.calories ?? "?"}`);
  ok("حداقل ۳ وعدهٔ غذایی", meals.length >= 3);
}

await db.$disconnect?.().catch(() => {});
console.log(failures === 0 ? "\n═══ صحت‌سنجی: همه پاس ═══" : `\n═══ ${failures} مورد شکست ═══`);
process.exit(failures > 0 ? 1 : 0);
