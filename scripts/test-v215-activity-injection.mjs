/**
 * v215 — تست runtime «لایهٔ ریز فعالیت‌ها»
 * کاربر آزمایشی + برنامهٔ ساختگی + ست‌های وزنه + ترکیب بدن + پیاده‌روی
 * → buildSportsProfileContext/buildGenerationExtras → چک بخش‌های v215 → پاکسازی
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const uid = `v215test_${Date.now()}`;
  const user = await db.user.create({
    data: { id: uid, mobile: `0913${String(Date.now()).slice(-7)}`, name: "تست v215" },
  });
  try {
    await db.onboardingProfile.create({
      data: {
        userId: user.id, gender: "male", age: 30, height: 180, weight: 85,
        targetWeight: 78, goal: "muscle_gain", activityLevel: "moderate",
        workoutDays: 4, workoutPlace: "gym", diseases: "ندارد", injuries: "ندارد",
        allergies: "ندارد", dietType: "normal", equipment: "[]", workoutDaysList: "[]",
        medicalConditions: "[]", injuryAreas: "[]",
      },
    });

    // برنامهٔ ساختگی (برای چیدمان برنامهٔ فعلی + resolve نام حرکت)
    await db.workoutPlan.create({
      data: {
        userId: user.id,
        active: true,
        content: JSON.stringify({
          muscleGroupSplit: "Push/Pull/Legs",
          periodizationType: "خطی",
          days: [
            {
              day: "شنبه", title: "پوش", focus: "سینه/سرشانه/پشت‌بازو", estimatedMinutes: 60,
              exercises: [
                { id: "ex_squat_v215", name: "اسکوات هالتر" },
                { id: "ex_bench_v215", name: "پرس سینه هالتر" },
              ],
            },
            { day: "یکشنبه", title: "پول", focus: "زیربغل/جلو‌بازو", estimatedMinutes: 55, exercises: [] },
          ],
        }),
      },
    });

    // ست‌های ثبت‌شده — اسکوات: 60 → 82.5 پیشرفت واقعی
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date());
    const sets = [];
    const weights = [60, 65, 70, 75, 80, 82.5];
    for (let d = 5; d >= 0; d--) {
      const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" })
        .format(new Date(Date.now() - d * 86400000));
      sets.push({
        userId: user.id, dateKey, dayName: "شنبه",
        exerciseId: "ex_squat_v215", exerciseName: "اسکوات هالتر",
        setNumber: 1, weightKg: weights[5 - d], reps: 8, done: true, source: "sync",
      });
    }
    sets.push({
      userId: user.id, dateKey: today, dayName: "شنبه",
      exerciseId: "ex_bench_v215", exerciseName: "پرس سینه هالتر",
      setNumber: 1, weightKg: 55, reps: 10, done: true, source: "sync",
    });
    await db.workoutSetLog.createMany({ data: sets });

    // ترکیب بدن + پیاده‌روی + DayCompletion با ساعت واقعی
    await db.bodyComposition.createMany({
      data: [
        { userId: user.id, fatPercent: 24, musclePercent: 36, source: "initial" },
        { userId: user.id, fatPercent: 21.5, musclePercent: 38.2, source: "checkup" },
      ],
    });
    await db.activitySession.create({
      data: { userId: user.id, activityType: "walk", startedAt: new Date(Date.now() - 2 * 3600_000), endedAt: new Date(Date.now() - 3600_000), durationSec: 2400, movingSec: 2300, distanceM: 2500, avgSpeedKmh: 3.7, calories: 95, steps: 3300 },
    });
    await db.dayCompletion.create({
      data: { userId: user.id, date: today, workoutDone: true, workoutSource: "gym_mode", nutritionDone: true, workoutAt: new Date() },
    });

    const { buildGenerationExtras } = await import(
      "../src/lib/fitness/program-generation"
    );
    const { buildSportsProfileContext } = await import(
      "../src/lib/fitness/sports-profile-context"
    );

    const profile = await buildSportsProfileContext(user.id, { includeStaticProfile: false });
    console.log("=== پروندهٔ ورزشی (بخش‌های v215) ===");
    const checks = [
      ["پیشرفت قدرتی هر حرکت", "پیشرفت قدرتی هر حرکت"],
      ["روند وزنهٔ اسکوات ۶۰→۸۲.۵", "بهترین ۸۲.۵"],
      ["روند ترکیب بدن", "روند ترکیب بدن"],
      ["ساعت تمرین واقعی", "ساعت تمرین"],
      ["پیاده‌روی ۳۰ روزه", "مسیریاب فیتاپ"],
    ];
    let pass = 0;
    for (const [label, needle] of checks) {
      const ok = profile.includes(needle);
      console.log(ok ? `✅ ${label}` : `❌ ${label}`);
      if (ok) pass++;
    }
    // خط اسکوات را کامل چاپ کن
    const squatLine = profile.split("\n").find((l) => l.includes("اسکوات"));
    if (squatLine) console.log(`   ↳ ${squatLine.trim().slice(0, 140)}`);

    const extras = await buildGenerationExtras(user.id);
    console.log("\n=== renewalContext کامل ===");
    console.log(extras.renewalContext || "(خالی!)");
    const layoutOk = extras.renewalContext?.includes("چیدمان برنامهٔ فعلی") ?? false;
    console.log(layoutOk ? "✅ چیدمان برنامهٔ فعلی در renewalContext" : "❌ چیدمان برنامهٔ فعلی");
    if (layoutOk) pass++;

    // جای مسیر + سقف جدید
    const journeyOk = extras.renewalContext?.includes("جای کاربر در مسیر") ?? false;
    console.log(journeyOk ? "✅ جای کاربر در مسیر (v214-b سالم)" : "❌ جای مسیر");
    if (journeyOk) pass++;
    console.log(`طول پرونده: ${profile.length} نویسه (سقف ۱۴۰۰۰)`);

    console.log(`\n${pass >= 6 ? "🎉" : "⚠️"} نتیجه: ${pass}/۷ چک`);
  } finally {
    await db.workoutSetLog.deleteMany({ where: { userId: user.id } });
    await db.workoutPlan.deleteMany({ where: { userId: user.id } });
    await db.bodyComposition.deleteMany({ where: { userId: user.id } });
    await db.activitySession.deleteMany({ where: { userId: user.id } });
    await db.dayCompletion.deleteMany({ where: { userId: user.id } });
    await db.onboardingProfile.deleteMany({ where: { userId: user.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    console.log("→ پاکسازی انجام شد");
  }
}

main()
  .catch((e) => {
    console.error("❌ خطا:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
