/**
 * v73.2 — ارکستراتور E2E کامل «به‌روزرسانی برنامه با چکاپ» در یک پروسه:
 *   ① پراکسی AI محلی (پاس‌ترو واقعی برای تحلیل چکاپ؛ پاسخ فوری برنامه برای
 *      کال‌های max — کیفیت تولید برنامه جداگانه با تست‌های زندهٔ v73 اثبات شده)
 *   ② dev سرور موقت روی 3110 با AVALAI_BASE_URL=پراکسی
 *   ③ گارد fresh-plan (بدون منبع) → POST واقعی /api/checkup با سشن معتبر
 *   ④ poll وضعیت → وریفای swap/اشتراک/نوتیف → پاک‌سازی کامل
 */
import { spawn, execSync, type ChildProcess } from "child_process";
import http from "http";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const MOBILE = "09120000073";
const MOCK_PORT = 3994;
const DEV_PORT = 3110;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/v1`;

const WORKOUT_JSON = JSON.stringify({
  weeklyGoal: "حفظ عضله با حجم ملایم",
  muscleGroupSplit: "push/pull/legs",
  days: [
    {
      day: "شنبه", title: "پا و مرکز بدن", exercises: [
        { name: "اسکوات", sets: 3, reps: "10-12", restSec: 90, description: "اسکوات با فرم استاندارد" },
        { name: "لانژ", sets: 3, reps: "12", restSec: 60, description: "لانژ متناوب" },
      ],
    },
    { day: "دوشنبه", title: "بالا تنه", exercises: [{ name: "پرس سینه دمبل", sets: 3, reps: "10", restSec: 90, description: "پرس دمبل" }] },
  ],
  weeklyProgression: "هفته ۱: وزنه ملایم — هفته ۲: +۵٪",
  safetyNotes: ["در صورت زانودرد اسکوات عمیق انجام نده"],
  recoveryNotes: ["خواب ۷-۸ ساعته"],
  nutritionTimingNotes: ["۳۰ دقیقه قبل: کربوهیدرات سبک"],
  supplementTimingNotes: [],
  medicalWarningFlags: [],
  notes: ["🔥 تمرکز روی فرم"],
});
const MEAL_JSON = JSON.stringify({
  totalCalories: 1800, totalProtein: 130, totalCarbs: 160, totalFat: 55, waterLiters: 2.5,
  meals: [
    { name: "صبحانه", items: [{ name: "املت سبزیجات", amount: "۲ تخم‌مرغ", calories: 320, protein: 20, carbs: 8, fat: 22 }] },
    { name: "ناهار", items: [{ name: "مرغ گریل + برنج", amount: "۱۵۰ گرم", calories: 520, protein: 42, carbs: 60, fat: 12 }] },
    { name: "شام", items: [{ name: "سالاد تن ماهی", amount: "۱ قوطی", calories: 380, protein: 35, carbs: 12, fat: 20 }] },
  ],
  supplements: [{ category: "base", name: "ویتامین D", dose: "۱۰۰۰ واحد", timing: "صبح" }],
});

function startMockProxy(): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const isMax = parsed?.reasoning_effort === "max" || Number(parsed?.max_tokens) >= 65536;
          if (isMax) {
            const text = JSON.stringify(parsed?.messages ?? []);
            const isWorkout = text.includes("تمرینی") || text.includes("workout");
            const content = isWorkout ? WORKOUT_JSON : MEAL_JSON;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              id: "mock-max", object: "chat.completion", model: parsed.model,
              choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
              usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
            }));
            return;
          }
          // پاس‌ترو واقعی → AvalAI
          const path = req.url || "/chat/completions";
          const upstream = await fetch(`https://api.avalai.ir${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: req.headers.authorization || "" },
            body,
          });
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
          res.end(buf);
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(e).slice(0, 200) }));
        }
      });
    });
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve());
  });
}

async function startDevServer(): Promise<ChildProcess> {
  const child = spawn("node_modules/.bin/next", ["dev", "-p", String(DEV_PORT), "--webpack"], {
    cwd: process.cwd(),
    env: { ...process.env, AVALAI_BASE_URL: MOCK_BASE, NEXT_DIST_DIR: ".next" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fs = await import("fs");
  const logStream = fs.createWriteStream("checkup-e2e-dev.log");
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  return Promise.resolve(child);
}

async function waitReady(url: string, timeoutMs: number): Promise<boolean> {
  // ⚠️ پروب‌های کوتاه کامپایل dev را لغو می‌کنند — اولین پروب صبور (curl)
  const { execFileSync } = await import("child_process");
  try {
    const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", String(Math.ceil(timeoutMs / 1000)), url], { encoding: "utf8", timeout: timeoutMs + 5000 });
    if (code.trim().startsWith("2") || code.trim() === "401" || code.trim() === "405") return true;
  } catch { /* fallthrough */ }
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try {
      const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "25", url], { encoding: "utf8", timeout: 30000 });
      if (code.trim().startsWith("2")) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

function killNextStrays() {
  // next-server فرزند از گروه پروسه خارج می‌شود — با الگو می‌کشیم (درس E2E)
  try { execSync("pkill -9 -f next-server || true", { stdio: "ignore" }); } catch {}
  try { execSync("pkill -9 -f 'next dev' || true", { stdio: "ignore" }); } catch {}
  try { execSync("rm -f .next/dev/lock", { stdio: "ignore" }); } catch {}
}

async function cleanup() {
  const u = await db.user.findUnique({ where: { mobile: MOBILE } });
  if (u) {
    await db.aiUsageLog.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await db.user.delete({ where: { id: u.id } }).catch(() => {});
  }
}

async function main() {
  console.log("── ① پراکسی AI محلی ──");
  await startMockProxy();
  console.log(`✅ پراکسی روی ${MOCK_PORT} (پاس‌ترو تحلیل واقعی + پاسخ فوری تولید)`);

  console.log("── ② dev سرور موقت روی 3110 ──");
  killNextStrays();
  await new Promise((r) => setTimeout(r, 2000));
  const dev = await startDevServer();
  const ready = await waitReady(`http://127.0.0.1:${DEV_PORT}/`, 300000);
  if (!ready) { console.log("❌ سرور آماده نشد"); try { process.kill(-dev.pid!, "SIGKILL"); } catch {} process.exit(1); }
  console.log("✅ سرور آماده — گرم‌کردن مسیر چکاپ (کامپایل سنگین)...");
  // GET بی‌اثر (401/405) فقط برای کامپایل — درخواست واقعی POST بعداً سریع است
  try {
    await fetch(`http://127.0.0.1:${DEV_PORT}/api/checkup`, { signal: AbortSignal.timeout(300000) });
  } catch { /* کامپایل سنگین — خطای سوکت اینجا نادیده */ }
  console.log("✅ کامپایل مسیر چکاپ تمام شد");

  console.log("── ③ دادهٔ تست + گارد ──");
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

  const { startProgramGenerationInBackground } = await import("@/lib/fitness/program-generation");
  const g0 = await startProgramGenerationInBackground(user.id);
  console.log(g0.reason === "already_has_fresh_plan" ? "✅ گارد بدون منبع بلاک کرد" : `❌ گارد: ${g0.reason ?? "(undefined)"}`);

  console.log("── ④ POST واقعی /api/checkup (تحلیل AI واقعی از پاس‌ترو) ──");
  const { createSessionToken } = await import("@/lib/fitness/auth");
  const cookie = `sc_session=${createSessionToken(user.id)}`;
  const payload = JSON.stringify({
    weight: 91, bodyFatPercent: 27, leanBodyMass: 66.4, waistMeasurement: 98,
    fatigueLevel: 4, sleepQuality: 3, dietAdherence: 2, workoutAdherence: 2,
    notes: "خیلی خسته‌ام، هفته قبل فقط یک جلسه تمرین رفتم و رژیم را رعایت نکردم.",
    phaseNumber: 1,
  });
  // POST با curl — fetchِ bun با dev سرور روی POST سوکت را می‌بندد (GET سالم است)
  const { execFileSync } = await import("child_process");
  const cookieFile = "/tmp/e2e-cookie.txt";
  (await import("fs")).writeFileSync(cookieFile, cookie);
  let stdout = "";
  try {
    stdout = execFileSync("curl", [
      "-s", "--max-time", "170", "-X", "POST",
      `http://127.0.0.1:${DEV_PORT}/api/checkup`,
      "-H", "Content-Type: application/json",
      "-H", `Cookie: ${cookie}`,
      "--data-binary", payload,
    ], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  } catch (e: any) { console.log("❌ curl fail:", String(e?.message || e).slice(0, 200)); try { process.kill(-dev.pid!, "SIGKILL"); } catch {} process.exit(1); }
  const res = { ok: true, status: 200, json: async () => JSON.parse(stdout || "{}") } as any;
  let body: any;
  try { body = JSON.parse(stdout); } catch { console.log("❌ پاسخ JSON نیست:", stdout.slice(0, 200)); try { process.kill(-dev.pid!, "SIGKILL"); } catch {} process.exit(1); }
  if (body.error) { console.log(`❌ خطا از API:`, stdout.slice(0, 300)); try { process.kill(-dev.pid!, "SIGKILL"); } catch {} process.exit(1); }
  const a = body.aiAnalysis ?? {};
  console.log(`امتیاز بدن: ${a.bodyScore} | programUpdateNeeded: ${a.programUpdateNeeded} | triggered: ${body.programUpdateTriggered}`);
  if (a.programUpdateNotes) console.log(`یادداشت AI: ${String(a.programUpdateNotes).slice(0, 140)}`);

  console.log("── ⑤ انتظار برای تولید + وریفای ──");
  let finalStatus = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const req = await db.programRequest.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    finalStatus = req?.status ?? "none";
    if (finalStatus === "ready" || finalStatus === "failed") break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`وضعیت نهایی: ${finalStatus}`);

  const plans = await db.workoutPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const meals = await db.mealPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const subAfter = (await db.subscription.findFirst({ where: { userId: user.id, status: "active" } }))!;
  const userAfter = (await db.user.findUnique({ where: { id: user.id } }))!;
  const readyNotif = await db.notification.findFirst({ where: { userId: user.id, title: "برنامه‌های شما به‌روزرسانی شد! ✨" } });
  const inProgNotif = await db.notification.findFirst({ where: { userId: user.id, title: "برنامه‌های شما در حال به‌روزرسانی است ⏳" } });

  let ok = true;
  const chk = (n: string, c: boolean, d = "") => { console.log(`${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) ok = false; };
  chk("گارد بدون منبع بلاک", g0.reason === "already_has_fresh_plan");
  chk("تحلیل چکاپ واقعی و تصمیم به‌روزرسانی", (a.programUpdateNeeded === true || body.programUpdateTriggered === true));
  chk("وضعیت نهایی ready", finalStatus === "ready", `status=${finalStatus}`);
  chk("تمرین جدید جای قبلی", plans.length === 2 && plans[0].active === true && plans[1].active === false && plans[0].id !== workoutBefore.id);
  chk("غذای جدید جای قبلی", meals.length === 2 && meals[0].active === true && meals[1].active === false && meals[0].id !== mealBefore.id);
  chk("اشتراک دست‌نخورده", subAfter.id && subAfter.endDate.getTime() === end.getTime() && subAfter.durationDays === 45);
  chk("پلن/انقضای کاربر دست‌نخورده", userAfter.planName === "standard" && userAfter.planExpiresAt?.getTime() === end.getTime());
  chk("نوتیف در-حال-به‌روزرسانی", !!inProgNotif || finalStatus === "failed");
  chk("نوتیف به‌روزرسانی-شد", !!readyNotif || finalStatus === "failed");

  console.log("── ⑥ پاک‌سازی ──");
  await cleanup();
  try { process.kill(-dev.pid!, "SIGKILL"); } catch { try { dev.kill("SIGKILL"); } catch {} }
  killNextStrays();
  console.log(ok ? "\n🎉 E2E کامل سبز" : "\n⛔ شکست");
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => { console.error("E2E error:", String(e).slice(0, 500)); await db.$disconnect(); try { process.kill(-process.pid, "SIGKILL"); } catch {} process.exit(1); });
