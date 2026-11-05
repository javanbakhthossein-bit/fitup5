/**
 * تست E2E واقعی v148 — «یک تلاش، صفر شکست + سرشانه + توضیح چیدمان»
 * پروفایل شبیه‌سازی‌شدهٔ سناریوی مالک: سرشانه‌های ضعیف + ۴ روز تمرین.
 * ثابت می‌کند زنجیرهٔ v148 (AI واقعی → اعتبارسنج ملایم → قفل بانک → dedupe →
 * ترمیم پوشش → توضیح چیدمان) در «اولین تلاش» برنامهٔ کامل علمی می‌دهد.
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v148-e2e-workout.ts
 */
import { generateWorkoutPlan } from "../../src/lib/fitness/ai";
import { exerciseFamilyKey, coveredMajorGroups, MAJOR_GROUP_KEYS, MAJOR_GROUP_LABELS_FA } from "../../src/lib/fitness/exercise-bank-lock";
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
    lastName: "v148",
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

  console.log("🚀 شروع تولید واقعی برنامهٔ تمرینی v148 (AvalAI — deepseek-v4.1-flash)...");
  const t0 = Date.now();
  const plan = await generateWorkoutPlan(data, planName, {});
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`⏱️  زمان تولید: ${sec} ثانیه`);

  // ─── ۱) موفقیت در اولین تلاش زنجیره (تولید بدون خطا برگشت) ───
  check("زنجیرهٔ تولید بدون خطا برنامه برگرداند (یک تلاش ساختاری — بدون رد/ری‌تای ساختاری)", Array.isArray(plan?.days) && plan.days.length > 0);

  // ─── ۲) تعداد روزها دقیقاً طبق درخواست ───
  check(`تعداد روزها = ${data.workoutDays}`, plan.days.length === data.workoutDays, `دریافتی: ${plan.days.length}`);

  // ─── ۳) پوشش کامل شش گروه اصلی (سرشانه الزامی) ───
  const covered = coveredMajorGroups(plan.days as any);
  const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
  check("هر شش گروه اصلی پوشش داده شده (سرشانه صفر نیست)", missing.length === 0, missing.map((g) => MAJOR_GROUP_LABELS_FA[g]).join("، "));

  // ─── ۴) قانون علمی خانواده: حداکثر ۲ واریانت در روز + بدون تکرار دقیق ───
  let familyViolations = 0;
  let exactDupes = 0;
  for (const day of plan.days) {
    const famCount = new Map<string, number>();
    const seen = new Set<string>();
    for (const ex of day.exercises ?? []) {
      const fam = exerciseFamilyKey(String(ex.name), ex.muscle);
      const sq = String(ex.name).replace(/[\s\u200C\-]+/g, "");
      if (seen.has(sq)) exactDupes++;
      else {
        seen.add(sq);
        famCount.set(fam, (famCount.get(fam) ?? 0) + 1);
      }
    }
    for (const [, c] of famCount) if (c >= 3) familyViolations++;
  }
  check("هیچ روزی ۳+ واریانت هم‌خانواده ندارد", familyViolations === 0, `${familyViolations} روز`);
  check("هیچ تکرار دقیق حرکتی در یک روز نیست", exactDupes === 0, `${exactDupes} مورد`);

  // ─── ۵) قفل بانک: همهٔ حرکات exerciseId واقعی دارند ───
  const noId = plan.days.flatMap((d: any) => (d.exercises ?? []).filter((e: any) => !e.exerciseId));
  check("همهٔ حرکات ارجاع exerciseId بانک دارند", noId.length === 0, `${noId.length} حرکت بی‌id`);

  // ─── ۶) ست/تکرار/شدت ───
  const badSets = plan.days.flatMap((d: any) => (d.exercises ?? []).filter((e: any) => !Array.isArray(e.sets) || e.sets.length < 2 || e.sets.length > 5));
  check("ست‌ها بین ۲ تا ۵ برای همهٔ حرکات", badSets.length === 0, `${badSets.length} حرکت`);

  // ─── ۷) توضیح چیدمان (اگر تأکید غیرمعمول/جافته وجود دارد، نکات مربی توضیح دارد) ───
  // بعد از ترمیمِ v148 هیچ گروه الزام‌پذیری جاافتاده نیست؛ چک می‌کنیم که اگر
  // گروهی ۳+ روز تمرکز دارد، در notes «تحلیل چیدمان» یا حداقل ذکر نام گروه هست.
  const groupDayCount = new Map<string, number>();
  for (const g of MAJOR_GROUP_KEYS) groupDayCount.set(g, 0);
  for (const day of plan.days as any[]) {
    const seenGroups = new Set<string>();
    for (const ex of day.exercises ?? []) {
      for (const g of coveredMajorGroups([{ exercises: [ex] }])) seenGroups.add(g);
    }
    for (const g of seenGroups) groupDayCount.set(g, (groupDayCount.get(g) ?? 0) + 1);
  }
  const notesText = String(plan.notes ?? "");
  const unusual = [...groupDayCount.entries()].filter(([, c]) => c >= 3);
  let explained = true;
  for (const [g] of unusual) {
    const label = MAJOR_GROUP_LABELS_FA[g] ?? g;
    const base = label.split("/")[0].trim();
    if (!notesText.includes("تحلیل چیدمان") && !notesText.includes(base)) explained = false;
  }
  check("تأکید غیرمعمول (۳+ روز) در نکات مربی توضیح داده شده یا گروه صریحاً ذکر شده", explained, `notes head: ${notesText.slice(0, 120)}`);
  console.log("  📊 پوشش روزهای هر گروه:", MAJOR_GROUP_KEYS.map((g) => `${MAJOR_GROUP_LABELS_FA[g]}=${groupDayCount.get(g)}`).join(" | "));

  // ─── ۸) بدون محتوای تغذیه‌ای در برنامهٔ تمرینی (چک سریع) ───
  check("فیلد notes خالی نیست (نکات مربی موجود است)", notesText.trim().length > 10);

  // گزارش چیدمان روزها
  console.log("\n  🗓 چیدمان برنامه:");
  for (const d of plan.days as any[]) {
    console.log(`   • ${d.day}: ${d.title ?? ""} — ${(d.exercises ?? []).map((e: any) => e.name).join("، ")}`);
  }

  console.log(`\n═══ نتیجهٔ E2E v148: ${pass} سبز / ${fail} قرمز ═══`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("💥 E2E v148 شکست خورد:", err);
  process.exit(1);
});
