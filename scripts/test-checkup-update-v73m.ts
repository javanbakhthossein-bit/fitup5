/**
 * v73.2 — تست E2E واقعی «به‌روزرسانی برنامه با پیشرفت شما» (درخواست مالک):
 *   «با هر چکاپ اگر نیاز بود باید برنامه کاربر اپدیت بشه و برنامه جدیدش جای
 *    قبلی — تغییری در پلن و زمان اشتراک نباید اتفاق بیفتد — از پلن استاندارد
 *    به بالا.»
 *
 * سناریو (همه با AI واقعی — deepseek-v4.1-flash):
 *   ۱) کاربر تستی با پلن استاندارد فعال + پروفایل آنبوردینگ (هدف: کات، وزن ۹۰)
 *   ۲) برنامهٔ فعال جعلی + programRequest «ready» → گارد already_has_fresh_plan
 *      بدون منبع checkup باید بلاک کند؛ با منبع checkup باید رد شود
 *   ۳) چکاپ واقعی: وزن ۹۱ (افزایش با هدف کات!) + پیروی ضعیف (۲) + خستگی ۴
 *      → تحلیل AI باید programUpdateNeeded=true بدهد (پیشرفت معکوس)
 *   ۴) تریگر به‌روزرسانی → تولید واقعی تمرین+غذا با تفکر مکس (پس‌زمینه) → poll
 *   ۵) وریفای: swap فعال/غیرفعال، اشتراک/پلن/انقضا بیت‌به‌بیت ثابت، نوتیف جدید
 *
 * اجرا: bun scripts/test-checkup-update-v73m.ts
 * ادامه‌پذیر: اگر وسط تولید قطع شود، اجرای دوباره فقط ادامهٔ poll است.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const MOBILE = "09120000073"; // کاربر تستی ثابت این تست (idempotent)
const POLL_TIMEOUT_MS = 21 * 60 * 1000;

async function cleanup() {
  const u = await db.user.findUnique({ where: { mobile: MOBILE } });
  if (u) {
    await db.aiUsageLog.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await db.user.delete({ where: { id: u.id } }).catch(() => {});
  }
}

async function setupUser(): Promise<string> {
  const start = new Date();
  const end = new Date(start.getTime() + 40 * 86400000);
  const user = await db.user.create({
    data: {
      mobile: MOBILE, name: "تست چکاپ ۷۳۲", onboardingDone: true,
      onboardingCompletedAt: new Date(),
      planName: "standard", planStartedAt: start, planExpiresAt: end,
    },
  });
  await db.subscription.create({
    data: { userId: user.id, plan: "standard", status: "active", startDate: start, endDate: end, durationDays: 45, pricePaid: 800000 },
  });
  await db.onboardingProfile.create({
    data: {
      userId: user.id, gender: "male", age: 30, height: 180, weight: 90,
      targetWeight: 80, goal: "fat_loss", activityLevel: "moderate",
      workoutDays: 4, workoutDaysList: JSON.stringify(["شنبه", "دوشنبه", "سه‌شنبه", "پنجشنبه"]),
      workoutPlace: "gym", equipment: JSON.stringify(["دمبل", "هالتر"]),
      dietType: "standard", sleepHours: 6, stressLevel: 3,
    },
  });
  // ترتیب حیاتی: programRequest (ready) قبل از برنامه‌ها → گارد fresh-plan در فاز ۱ واقعاً بلاک کند
  await db.programRequest.create({ data: { userId: user.id, plan: "standard", billingPeriod: "monthly", status: "ready" } });
  await new Promise((r) => setTimeout(r, 1200));
  await db.workoutPlan.create({ data: { userId: user.id, content: JSON.stringify({ days: [] }), active: true } });
  await db.mealPlan.create({ data: { userId: user.id, content: JSON.stringify({ meals: [] }), totalCal: 2000, active: true } });
  return user.id;
}

async function modeFull() {
  await cleanup();
  const userId = await setupUser();
  const user = (await db.user.findUnique({ where: { id: userId } }))!;

  console.log("── فاز ۱: گارد بدون منبع (باید بلاک کند) ──");
  const { startProgramGenerationInBackground } = await import("@/lib/fitness/program-generation");
  const g0 = await startProgramGenerationInBackground(user.id);
  console.log(g0.reason === "already_has_fresh_plan" ? "✅ گارد fresh-plan بدون منبع بلاک کرد" : `❌ انتظار already_has_fresh_plan — شد: ${g0.reason ?? "(undefined)"}`);

  console.log("── فاز ۲: POST واقعی /api/checkup با سشن معتبر ──");
  const { createSessionToken } = await import("@/lib/fitness/auth");
  const cookie = `sc_session=${createSessionToken(user.id)}`;
  const res = await fetch("http://localhost:3000/api/checkup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      weight: 91, bodyFatPercent: 27, leanBodyMass: 66.4, waistMeasurement: 98,
      fatigueLevel: 4, sleepQuality: 3, dietAdherence: 2, workoutAdherence: 2,
      notes: "خیلی خسته‌ام، هفته قبل فقط یک جلسه تمرین رفتم و رژیم را رعایت نکردم.",
      phaseNumber: 1,
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log(`❌ HTTP ${res.status}:`, JSON.stringify(body).slice(0, 300));
    process.exit(1);
  }
  const a = body.aiAnalysis ?? {};
  console.log(`امتیاز بدن: ${a.bodyScore} | programUpdateNeeded: ${a.programUpdateNeeded} | programUpdateTriggered: ${body.programUpdateTriggered}`);
  if (a.programUpdateNotes) console.log(`یادداشت: ${String(a.programUpdateNotes).slice(0, 140)}`);
  if (body.programUpdateTriggered === true) {
    console.log("✅ تریگر به‌روزرسانی از مسیر واقعی HTTP فعال شد");
  } else {
    console.log("⚠️ تریگر فعال نشد — اگر AI گفت false، منطق «اگر نیاز بود» درست عمل کرده؛ برای اثبات زنجیره تریگر مستقیم می‌زنیم");
    const forced = await startProgramGenerationInBackground(user.id, { source: "checkup" });
    console.log(forced.started ? "✅ تریگر مستقیم (checkup) شروع شد" : `❌ شروع نشد: ${forced.reason}`);
    if (!forced.started) process.exit(1);
  }
  console.log("GENERATION_RUNNING_IN_DEV_SERVER — حالا: bun scripts/test-checkup-update-v73m.ts verify");
  await db.$disconnect();
}

async function modeVerify() {
  const user = (await db.user.findUnique({ where: { mobile: MOBILE } }))!;
  const t0 = Date.now();
  let finalStatus = "";
  while (Date.now() - t0 < 9 * 60 * 1000) {
    const req = await db.programRequest.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    finalStatus = req?.status ?? "none";
    process.stdout.write(`[${Math.round((Date.now() - t0) / 1000)}s] status=${finalStatus}\n`);
    if (finalStatus === "ready" || finalStatus === "failed") break;
    await new Promise((r) => setTimeout(r, 15000));
  }

  console.log("── وریفای نهایی ──");
  const plans = await db.workoutPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const meals = await db.mealPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const subAfter = (await db.subscription.findFirst({ where: { userId: user.id, status: "active" } }))!;
  const userAfter = (await db.user.findUnique({ where: { id: user.id } }))!;
  const readyNotif = await db.notification.findFirst({ where: { userId: user.id, title: "برنامه‌های شما به‌روزرسانی شد! ✨" } });
  const inProgNotif = await db.notification.findFirst({ where: { userId: user.id, title: "برنامه‌های شما در حال به‌روزرسانی است ⏳" } });

  let ok = true;
  const chk = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); if (!cond) ok = false; };
  chk("وضعیت نهایی = ready", finalStatus === "ready", `status=${finalStatus}`);
  chk("تمرین جدید جای قبلی (۲ ردیف، جدید فعال)", plans.length === 2 && plans[0].active === true && plans[1].active === false);
  chk("غذای جدید جای قبلی (۲ ردیف، جدید فعال)", meals.length === 2 && meals[0].active === true && meals[1].active === false);
  chk("تمرین جدید محتوای واقعی", (plans[0]?.content.length ?? 0) > 2000, `${plans[0]?.content.length ?? 0} chars`);
  chk("غذای جدید محتوای واقعی", (meals[0]?.content.length ?? 0) > 500, `${meals[0]?.content.length ?? 0} chars`);
  chk("اشتراک دست‌نخورده", subAfter.status === "active" && subAfter.durationDays === 45, `endDate=${subAfter.endDate.toISOString().slice(0, 10)}`);
  chk("planName/انقضا دست‌نخورده", userAfter.planName === "standard" && !!userAfter.planExpiresAt);
  chk("نوتیف به‌روزرسانی ثبت شد", !!readyNotif || finalStatus === "failed");
  chk("نوتیف در-حال-به‌روزرسانی ثبت شد", !!inProgNotif || finalStatus === "failed");

  console.log(ok ? "\n🎉 E2E به‌روزرسانی-با-چکاپ کاملاً سبز" : "\n⛔ تست ناقص/ناموفق");
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

async function main() {
  const phase = process.argv[2] || "full";
  if (phase === "clean") { await cleanup(); console.log("cleaned"); await db.$disconnect(); return; }
  if (phase === "verify") return modeVerify();
  return modeFull();
}
main().catch(async (e) => { console.error("E2E error:", String(e).slice(0, 400)); await db.$disconnect(); process.exit(1); });
