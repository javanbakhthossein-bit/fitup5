/**
 * ─── تست E2E واقعی v154 — تزریق کامل بانک + حفظ حرکت خارج از دیتابیس ───
 *
 * قانون مالک v154:
 *   «۹۰ حرکت هم کمه. تمام حرکات دیتابیس من بهش تزریق بشه. حتی اگر حرکتی داخل
 *    دیتابیس من نبود باز هم باید اون حرکت رو بده و نزدیک‌ترین ویدیو و توضیحات
 *    براش قرار بگیره. تمام حرکات دیتابیس و خارج از دیتابیس در نظر گرفته بشه.»
 *
 * اجرا روی «مک» محلی AvalAI (پورت ۳۰۴۰) — صفر هزینه، صفر تماس با AvalAI واقعی:
 *   AVALAI_BASE_URL=http://localhost:3040/v1 bun scripts/tests/v154-e2e-full-bank.ts
 *
 * سناریو: پرامپت کامل (۵۷۴ نام) → تولید واقعی از مسیر generateWorkoutPlan
 * (مک پاسخی با ۲ حرکتِ عمداً خارج از دیتابیس: «ساب پرس» و «پرس بالاسینه دمبل»)
 * → قفل v154 → invariant نهایی: هر حرکتِ برنامه exerciseIdِ ویدیودار بانک دارد.
 */
process.env.AVALAI_BASE_URL = "http://localhost:3040/v1";
process.env.AVALAI_TEXT_MODEL = process.env.AVALAI_TEXT_MODEL || "deepseek-v4.1-flash";

const { generateWorkoutPlan } = await import("../../src/lib/fitness/ai");
const { buildLockedBank } = await import("../../src/lib/fitness/exercise-bank-lock");
const { PrismaClient } = await import("@prisma/client");
type OnboardingData = import("../../src/lib/fitness/types").OnboardingData;
type Plan = import("../../src/lib/fitness/types").Plan;
type BankExerciseRow = import("../../src/lib/fitness/exercise-bank-lock").BankExerciseRow;

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
  // بانک واقعی برای invariant نهایی
  const db = new PrismaClient();
  const rows = (await db.exerciseLibrary.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, muscle: true, category: true, equipment: true,
      description: true, tips: true,
      videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true,
    },
  })) as BankExerciseRow[];
  await db.$disconnect();
  const bank = buildLockedBank(rows, true);
  console.log(`🏦 بانک واقعی: ${rows.length} ردیف فعال → ${bank.all.length} ویدیودار`);

  const data: OnboardingData = {
    firstName: "تست",
    lastName: "v154",
    gender: "male",
    age: 27,
    height: 178,
    weight: 80,
    targetWeight: 84,
    goal: "muscle_gain",
    activityLevel: "moderate",
    workoutDays: 3,
    workoutDaysList: ["شنبه", "یکشنبه", "دوشنبه"],
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

  console.log("🚀 تولید واقعی برنامهٔ تمرینی از مسیر کامل (پرامپت کامل → مک → قفل v154)...");
  const t0 = Date.now();
  const plan = await generateWorkoutPlan(data, "advanced" as Plan);
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`⏱️  زمان تولید: ${sec} ثانیه`);

  console.log("\n── ۱) ساختار برنامه ──");
  check("برنامهٔ کامل برگشت", Array.isArray(plan?.days) && plan.days.length > 0);
  check("تعداد روزها = ۳", plan.days.length === 3, `دریافتی: ${plan.days.length}`);

  const allEx = plan.days.flatMap((d: any) => (Array.isArray(d.exercises) ? d.exercises : []));
  console.log("\n── ۲) حرکات نهایی برنامه (برای گزارش مالک) ──");
  for (const d of plan.days as any[]) {
    console.log(`  • ${d.day}: ${(d.exercises ?? []).map((e: any) => e.name).join(" | ")}`);
  }

  console.log("\n── ۳) قانون آهنین v154: هر حرکت ویدیوی بانک دارد ──");
  const noId = allEx.filter((e: any) => !e?.exerciseId || !bank.all.some((r) => r.id === e.exerciseId));
  check(`هر ${allEx.length} حرکت exerciseIdِ ویدیودارِ بانک دارد`, allEx.length > 0 && noId.length === 0, noId.map((e: any) => e?.name).join(" | "));

  console.log("\n── ۴) حرکت خارج از دیتابیس: حفظ نام + الصاق نزدیک‌ترین ویدیو ──");
  const sab = allEx.find((e: any) => /ساب\s*پرس/i.test(String(e?.name ?? "")));
  check("«ساب پرس» (خارج از دیتابیس) با نام خودش در برنامه است", !!sab, sab?.name ?? "یافت نشد");
  check("«ساب پرس» نزدیک‌ترین ویدیوی بانک را گرفت", !!sab && bank.all.some((r) => r.id === sab.exerciseId), sab?.exerciseId);
  const inclineDumbbell = allEx.find((e: any) => /بالا\s?سینه\s*دمبل|بالاسینه\s*دمبل/.test(String(e?.name ?? "")));
  // «پرس بالاسینه دمبل» در دیتابیس با نام «پرس بالا سینه دمبل (Incline Dumbbell Bench Press)»
  // ثبت است → تطبیقِ «همان حرکت» → کانونیکل به نام استاندارد بانک (رفتار درست v154)
  check("«پرس بالاسینه دمبل» به نام استاندارد بانک کانونیکل شد (همان حرکت در دیتابیس هست)", !!inclineDumbbell && inclineDumbbell.name === "پرس بالا سینه دمبل (Incline Dumbbell Bench Press)", inclineDumbbell?.name ?? "یافت نشد");
  check("ویدیوی خودِ همان ردیف بانک الصاق شد", !!inclineDumbbell && bank.all.some((r) => r.id === inclineDumbbell.exerciseId && /بالا\s?سینه|بالاسینه/.test(r.name)), inclineDumbbell ? bank.all.find((r) => r.id === inclineDumbbell.exerciseId)?.name : "—");

  console.log("\n── ۵) هیچ حرکتی بی‌نام/خالی نشد ──");
  const empty = allEx.filter((e: any) => !String(e?.name ?? "").trim());
  check("صفر حرکت بی‌نام", empty.length === 0);

  console.log(`\n═══ نتیجهٔ E2E v154: ${pass} موفق / ${fail} ناموفق ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("❌ E2E شکست خورد:", e?.message ?? e);
  process.exit(1);
});
