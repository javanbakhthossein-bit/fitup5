
/**
 * v137 browser verify — FINAL (تک-مرورگر، سرور گرم، بدون ری‌استارت وسط تست)
 */
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { createSessionToken } from "@/lib/fitness/auth";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const db = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  OK " + name); }
  else { fail++; console.log("  FAIL " + name + " " + detail); }
}
const DAY = 86_400_000;

async function main() {
  // صبر تا سرور کامل بالا بیاید (respawn در صورت نیاز)
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + "/api/stats/public");
      if (r.ok) break;
    } catch {
      if (i % 6 === 0) {
        try { execSync('(setsid nohup env NODE_OPTIONS="--max-old-space-size=2560" bun run dev >> dev.log 2>&1 &) </dev/null', { cwd: "/home/z/my-project", stdio: "ignore", timeout: 10000 }); } catch {}
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  await db.user.deleteMany({ where: { mobile: { in: ["09120000137", "09120000138"] } } });
  const now = new Date();
  const start = new Date(now.getTime() - 10 * DAY);
  const end = new Date(now.getTime() + 35 * DAY);
  const planUser = await db.user.create({ data: { mobile: "09120000137", name: "حسین آزمایشی v137", onboardingDone: true, onboardingCompletedAt: start, planName: "advanced", planStartedAt: start, planExpiresAt: end, createdAt: start } });
  await db.subscription.create({ data: { userId: planUser.id, plan: "advanced", status: "active", startDate: start, endDate: end, durationDays: 45, pricePaid: 1200000 } });
  await db.onboardingProfile.create({ data: { userId: planUser.id, gender: "male", age: 30, height: 178, weight: 88, targetWeight: 80, goal: "fat_loss", activityLevel: "moderate", workoutDays: 4, workoutDaysList: "[]", workoutPlace: "gym", equipment: "[]" } });
  await db.weightLog.create({ data: { userId: planUser.id, weight: 86.5, loggedAt: new Date(now.getTime() - 6 * DAY) } });
  await db.weightLog.create({ data: { userId: planUser.id, weight: 85, loggedAt: now } });
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(now);
  await db.dayCompletion.create({ data: { userId: planUser.id, date: todayKey, workoutDone: true, nutritionDone: true } });
  await db.checkup.create({ data: { userId: planUser.id, phaseNumber: 1, status: "completed", weight: 86.5, createdAt: new Date(now.getTime() - 5 * DAY) } });
  const freeUser = await db.user.create({ data: { mobile: "09120000138", name: "بی‌پلن v137", onboardingDone: true, createdAt: start } });
  const planToken = createSessionToken(planUser.id);
  const freeToken = createSessionToken(freeUser.id);

  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // کاهش فشار حافظهٔ dev: چکر آپدیت اپ mock می‌شود (کامپایلش در dev سنگین است)
  await ctx.route("**/api/app/own/latest", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) })
  );
  // کاهش حافظهٔ کرومیوم: تصاویر/فونت‌ها بلاک (چک‌ها متنی‌اند)
  await ctx.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "font" || t === "media") return route.abort();
    return route.continue();
  });
  const errs: string[] = [];
  ctx.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
  const page = await ctx.newPage();
  const P = "http://localhost:3000/?screen=panel&tab=";

  try {
    console.log("-- landing --");
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(1500);
    check("trust-bar /exercises link", (await page.locator('a[href="/exercises"]').count()) >= 1);
    check("trust-bar /foods link", (await page.locator('a[href="/foods"]').count()) >= 1);

    console.log("-- public banks (fetch — بدون hydration سنگین) --");
    const banks = await page.evaluate(async () => {
      const a = await fetch("/exercises");
      const at = await a.text();
      const b = await fetch("/foods");
      const bt = await b.text();
      return { exStatus: a.status, foodStatus: b.status, foodHasZeytun: bt.includes("زیتون"), exHasBank: at.includes("بانک حرکات") };
    });
    check("/exercises 200", banks.exStatus === 200, String(banks.exStatus));
    check("/foods 200", banks.foodStatus === 200, String(banks.foodStatus));
    check("/foods new item (زیتون پرورده)", banks.foodHasZeytun);
    check("/exercises has bank heading", banks.exHasBank);

    console.log("-- dashboard (plan) --");
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "sc_session", value: planToken, domain: "localhost", path: "/" }]);
    await page.goto(P + "dashboard", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(10000);
    const d = await page.content();
    check("bank card حرکات", d.includes("بانک حرکات"));
    check("bank card غذاها", d.includes("بانک غذاها"));
    check("badge رایگان", d.includes("رایگان"));
    check("journey chart", d.includes("مسیر پیشرفت تو"));
    check("journey level", d.includes("تازه‌کار پرانرژی") || d.includes("ورزشکار در مسیر") || d.includes("پیگیر حرفه‌ای"));
    check("black card goal", d.includes("هدف تو"));
    check("black card streak", d.includes("پیوستگی فعلی"));
    check("old features intact", d.includes("چت با فیتاپ") && d.includes("حالت باشگاه"));

    console.log("-- nutrition (plan) --");
    await page.goto(P + "nutrition", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(7000);
    const n = await page.content();
    check("photo analysis", n.includes("آنالیز عکس غذا"));
    const li = n.indexOf("غذاهای ثبت‌شده امروز");
    const ui = n.indexOf("برنامه غذایی شما ساخته نشده");
    check("logged foods present", li > -1);
    check("logged foods top position", li > -1 && ui > -1 && li < ui, "logged=" + li + " upsell=" + ui);
    check("add button", n.includes("ثبت غذای جدید"));

    console.log("-- no-plan user --");
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "sc_session", value: freeToken, domain: "localhost", path: "/" }]);
    await page.goto(P + "nutrition", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(7000);
    const fn = await page.content();
    check("nutrition open for no-plan", fn.includes("کالری‌شمار و تغذیه"));
    check("no-plan logged foods free", fn.includes("غذاهای ثبت‌شده امروز"));
    check("no-plan upsell intact", fn.includes("برنامه غذایی شما ساخته نشده"));
    await page.goto(P + "dashboard", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(8000);
    const fd = await page.content();
    check("no-plan bank cards", fd.includes("بانک حرکات") && fd.includes("بانک غذاها"));

    console.log("-- navigation speed --");
    const t0 = Date.now();
    for (const tab of ["nutrition", "dashboard", "plans"]) {
      await page.goto(P + tab, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(600);
    }
    const ms = Date.now() - t0;
    check("3 navigations < 15s", ms < 15000, ms + "ms");

    console.log("-- console errors --");
    const real = errs.filter((e) => !e.includes("favicon") && !e.includes("net::") && !e.includes("401") && !e.includes("Failed to load resource"));
    check("no real console errors", real.length === 0, real.slice(0, 3).join(" | "));

    console.log("===== RESULT: " + pass + " OK / " + fail + " FAIL =====");
    if (fail > 0) process.exit(1);
  } finally {
    await db.user.deleteMany({ where: { mobile: { in: ["09120000137", "09120000138"] } } });
    await db.$disconnect();
    await browser.close();
  }
}
main().catch(async (e) => { console.error("FAILED:", String(e).slice(0, 300)); await db.$disconnect(); process.exit(1); });
