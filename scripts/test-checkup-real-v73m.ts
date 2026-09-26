/**
 * v73.2 — E2E نهایی «به‌روزرسانی برنامه با چکاپ» روی دِو سرور زندهٔ پلتفرم (3000):
 *   fire  → پاک‌سازی + دادهٔ تست + گارد fresh-plan + POST واقعی /api/checkup (curl)
 *   poll  → انتظار تولید واقعی (deepseek مکس) + وریفای کامل
 *   clean → حذف کاربر تستی
 * تولید در پروسهٔ ماندگارِ پلتفرم اجرا می‌شود و بین فراخوانی‌ها زنده می‌ماند.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const MOBILE = "09120000073";
const BASE = "http://127.0.0.1:3000";

async function cleanup() {
  const u = await db.user.findUnique({ where: { mobile: MOBILE } });
  if (u) {
    await db.aiUsageLog.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await db.user.delete({ where: { id: u.id } }).catch(() => {});
  }
}

async function fire() {
  await cleanup();
  const start = new Date();
  const end = new Date(start.getTime() + 40 * 86400000);
  const user = await db.user.create({
    data: { mobile: MOBILE, name: "تست چکاپ ۷۳۲", onboardingDone: true, onboardingCompletedAt: new Date(), planName: "standard", planStartedAt: start, planExpiresAt: end },
  });
  await db.subscription.create({ data: { userId: user.id, plan: "standard", status: "active", startDate: start, endDate: end, durationDays: 45, pricePaid: 800000 } });
  await db.onboardingProfile.create({
    data: { userId: user.id, gender: "male", age: 30, height: 180, weight: 90, targetWeight: 80, goal: "fat_loss", activityLevel: "moderate", workoutDays: 4, workoutDaysList: "[]", workoutPlace: "gym", equipment: "[]", dietType: "standard", sleepHours: 6, stressLevel: 3 },
  });
  await db.programRequest.create({ data: { userId: user.id, plan: "standard", billingPeriod: "monthly", status: "ready" } });
  await new Promise((r) => setTimeout(r, 1200));
  const workoutBefore = await db.workoutPlan.create({ data: { userId: user.id, content: JSON.stringify({ days: [] }), active: true } });
  const mealBefore = await db.mealPlan.create({ data: { userId: user.id, content: JSON.stringify({ meals: [] }), totalCal: 2000, active: true } });
  console.log(`setup: user=${user.id} workoutBefore=${workoutBefore.id} mealBefore=${mealBefore.id}`);

  console.log("── گارد بدون منبع (باید بلاک کند) ──");
  const { startProgramGenerationInBackground } = await import("@/lib/fitness/program-generation");
  const g0 = await startProgramGenerationInBackground(user.id);
  console.log(g0.reason === "already_has_fresh_plan" ? "✅ گارد fresh-plan بلاک کرد" : `❌ گارد: ${g0.reason ?? "(undefined)"}`);
  if (g0.reason !== "already_has_fresh_plan") process.exit(1);

  console.log("── POST واقعی /api/checkup (curl → سرور 3000) ──");
  const { createSessionToken } = await import("@/lib/fitness/auth");
  const cookie = `sc_session=${createSessionToken(user.id)}`;
  const payload = JSON.stringify({
    weight: 91, bodyFatPercent: 27, leanBodyMass: 66.4, waistMeasurement: 98,
    fatigueLevel: 4, sleepQuality: 3, dietAdherence: 2, workoutAdherence: 2,
    notes: "خیلی خسته‌ام، هفته قبل فقط یک جلسه تمرین رفتم و رژیم را رعایت نکردم.",
    phaseNumber: 1,
  });
  const { execFileSync } = await import("child_process");
  const out = execFileSync("curl", ["-s", "--max-time", "170", "-X", "POST", `${BASE}/api/checkup`,
    "-H", "Content-Type: application/json", "-H", `Cookie: ${cookie}`, "--data-binary", payload],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  let body: any;
  try { body = JSON.parse(out); } catch { console.log("❌ پاسخ:", out.slice(0, 250)); process.exit(1); }
  if (body.error) { console.log("❌ خطای API:", out.slice(0, 250)); process.exit(1); }
  const a = body.aiAnalysis ?? {};
  console.log(`HTTP 200 ✓ | امتیاز: ${a.bodyScore} | programUpdateNeeded: ${a.programUpdateNeeded} | triggered: ${body.programUpdateTriggered}`);
  if (a.programUpdateNotes) console.log(`یادداشت AI: ${String(a.programUpdateNotes).slice(0, 150)}`);
  if (a.programUpdateNeeded !== true || body.programUpdateTriggered !== true) {
    console.log("❌ انتظار: AI بگوید نیاز است و تریگر بخورد");
    process.exit(1);
  }
  console.log("✅ تریگر به‌روزرسانی فعال شد — حالا: bun scripts/test-checkup-real-v73m.ts poll");
  await db.$disconnect();
}

async function poll() {
  const user = (await db.user.findUnique({ where: { mobile: MOBILE } }))!;
  if (!user) { console.log("❌ کاربر تستی نیست"); process.exit(1); }
  const t0 = Date.now();
  let finalStatus = "";
  const budgetMs = 8 * 60 * 1000;
  while (Date.now() - t0 < budgetMs) {
    const req = await db.programRequest.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    finalStatus = req?.status ?? "none";
    process.stdout.write(`[${Math.round((Date.now() - t0) / 1000)}s] ${finalStatus}\n`);
    if (finalStatus === "ready" || finalStatus === "failed") break;
    await new Promise((r) => setTimeout(r, 20000));
  }
  if (finalStatus !== "ready") { console.log(`⏳ هنوز ready نشده (${finalStatus}) — poll را دوباره اجرا کن`); await db.$disconnect(); process.exit(2); }

  console.log("── وریفای نهایی ──");
  const plans = await db.workoutPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const meals = await db.mealPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const subAfter = (await db.subscription.findFirst({ where: { userId: user.id, status: "active" } }))!;
  const userAfter = (await db.user.findUnique({ where: { id: user.id } }))!;
  const readyNotif = await db.notification.findFirst({ where: { userId: user.id, title: "برنامه‌های شما به‌روزرسانی شد! ✨" } });
  const inProgNotif = await db.notification.findFirst({ where: { userId: user.id, title: "برنامه‌های شما در حال به‌روزرسانی است ⏳" } });
  const checkupRow = await db.checkup.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

  let ok = true;
  const chk = (n: string, c: boolean, d = "") => { console.log(`${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) ok = false; };
  chk("تمرین جدید جای قبلی (۲ ردیف: جدید فعال، قبلی غیرفعال)", plans.length === 2 && plans[0].active === true && plans[1].active === false);
  chk("غذای جدید جای قبلی", meals.length === 2 && meals[0].active === true && meals[1].active === false);
  chk("تمرین جدید محتوای واقعی AI", (plans[0]?.content.length ?? 0) > 2000, `${plans[0]?.content.length ?? 0} chars`);
  chk("غذای جدید محتوای واقعی AI", (meals[0]?.content.length ?? 0) > 500, `${meals[0]?.content.length ?? 0} chars`);
  chk("اشتراک دست‌نخورده", subAfter.status === "active" && subAfter.durationDays === 45, `پایان: ${subAfter.endDate.toISOString().slice(0, 10)}`);
  chk("planName/انقضا دست‌نخورده", userAfter.planName === "standard" && !!userAfter.planExpiresAt);
  chk("چکاپ با تحلیل و فلگ به‌روزرسانی ذخیره شد", !!checkupRow?.aiAnalysis && checkupRow.aiAnalysis.includes("programUpdateNeeded"));
  chk("نوتیف در-حال-به‌روزرسانی", !!inProgNotif);
  chk("نوتیف به‌روزرسانی-شد", !!readyNotif);

  console.log(ok ? "\n🎉 E2E واقعی به‌روزرسانی-با-چکاپ کاملاً سبز" : "\n⛔ شکست");
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

async function main() {
  const mode = process.argv[2] || "fire";
  if (mode === "fire") return fire();
  if (mode === "poll") return poll();
  if (mode === "clean") { await cleanup(); console.log("cleaned"); await db.$disconnect(); return; }
}
main().catch(async (e) => { console.error("error:", String(e).slice(0, 300)); await db.$disconnect(); process.exit(1); });
