/**
 * v214 — تست runtime ممیزی تزریق کانتکست AI (سریع، دفاعی)
 * یک کاربر آزمایشی + پروفایل + اندازه‌ها می‌سازد، سازنده‌های کانتکست را
 * صدا می‌زند و کانتکست تولیدی را چاپ می‌کند؛ در پایان همه‌چیز پاک می‌شود.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const uid = `v214test_${Date.now()}`;
  console.log("→ ساخت کاربر آزمایشی:", uid);
  const user = await db.user.create({
    data: {
      id: uid,
      mobile: `0912${String(Date.now()).slice(-7)}`,
      name: "تست v214",
    },
  });
  try {
    await db.onboardingProfile.create({
      data: {
        userId: user.id,
        gender: "male",
        age: 28,
        height: 178,
        weight: 82,
        targetWeight: 76,
        goal: "fat_loss",
        activityLevel: "moderate",
        workoutDays: 4,
        workoutPlace: "gym",
        diseases: "ندارد",
        injuries: "ندارد",
        allergies: "ندارد",
        dietType: "normal",
        equipment: "[]",
        workoutDaysList: "[]",
        medicalConditions: "[]",
        injuryAreas: "[]",
        // اندازه‌های v214 — باید در کانتکست دیده شوند
        chestMeasurement: 102,
        armMeasurement: 34,
        waistMeasurement: 88,
        hipMeasurement: 98,
        thighMeasurement: 57,
        shoulderMeasurement: 122,
        calfMeasurement: 37,
        bodyShape: "pear",
        smokingHabit: "none",
      },
    });

    // پیام چت آزمایشی (برای خلاصهٔ چت)
    await db.chatMessage.create({
      data: {
        userId: user.id,
        role: "user",
        content: "لطفاً برنامه‌ای بده که صبح‌ها تمرین کنم و روی زیربغل بیشتر تمرکز داشته باشد",
      },
    });

    // عکس گالری پیشرفت آزمایشی
    await db.progressPhoto.create({
      data: { userId: user.id, imageUrl: "https://example.com/test.jpg", type: "front", note: "هفته اول" },
    });

    // ترکیب بدن آزمایشی
    await db.bodyComposition.create({
      data: { userId: user.id, fatPercent: 21.5, musclePercent: 38.2, source: "initial" },
    });

    const { buildOnboardingData, buildGenerationExtras } = await import(
      "../src/lib/fitness/program-generation"
    );

    const planData = await buildOnboardingData(user.id);
    console.log("\n=== buildOnboardingData ===");
    console.log("weight:", planData?.weight, "| bodyShape:", planData?.bodyShape);
    console.log(
      "measurements:",
      JSON.stringify({
        chest: planData?.chestMeasurement,
        arm: planData?.armMeasurement,
        waist: planData?.waistMeasurement,
        hip: planData?.hipMeasurement,
        thigh: planData?.thighMeasurement,
        shoulder: planData?.shoulderMeasurement,
        calf: planData?.calfMeasurement,
      })
    );

    const extras = await buildGenerationExtras(user.id);
    console.log("\n=== buildGenerationExtras keys ===");
    console.log(Object.keys(extras));
    if (extras.renewalContext) {
      console.log("\n=== renewalContext (اول ۲۵۰۰ نویسه) ===");
      console.log(extras.renewalContext.slice(0, 2500));
      const hasAll = ["جای کاربر در مسیر", "اندازه‌های بدنی", "گالری پیشرفت", "ترکیب بدن", "گفتگو با دستیار فیتاپ", "اولین برنامه"];
      console.log("\n=== چک اجزای الزامی ===");
      for (const k of hasAll) {
        console.log(hasAll.includes(k) && extras.renewalContext.includes(k) ? `✅ ${k}` : `❌ ${k}`);
      }
    } else {
      console.log("❌ renewalContext خالی است!");
    }

    // چک تزریق اندازه‌ها در buildUserContext
    const { buildUserContext } = await import("../src/lib/fitness/ai");
    const ctx = buildUserContext(planData, "advanced");
    console.log("\n=== buildUserContext: خط اندازه‌ها ===");
    const measLine = ctx.split("\n").find((l) => l.includes("اندازه‌های بدنی ثبت‌شده"));
    console.log(measLine ? `✅ ${measLine}` : "❌ خط اندازه‌ها در کانتکست نیست");
    const shapeLine = ctx.split("\n").find((l) => l.includes("فرم بدن"));
    console.log(shapeLine ? `✅ ${shapeLine.slice(0, 80)}` : "❌ فرم بدن نیست");

    console.log("\n🎉 تست v214 تمام شد");
  } finally {
    // پاکسازی
    await db.onboardingProfile.deleteMany({ where: { userId: user.id } });
    await db.chatMessage.deleteMany({ where: { userId: user.id } });
    await db.progressPhoto.deleteMany({ where: { userId: user.id } });
    await db.bodyComposition.deleteMany({ where: { userId: user.id } });
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
