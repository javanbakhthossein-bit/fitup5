/* v214 — راستی‌آزمایی مرورگری آنبوردینگ:
   A) جنسیت: بعد از انتخاب، اسکرول به سؤال بعدی ممنوع (دیرکتیو مالک)
   B) فرم بدن با کیبورد باز در UA اینستاگرام: صفر پرش + حفظ فوکوس ورودی
   C) فرم بدن با کیبورد باز در UA وب عادی: رفتار v212 (blur+اسکرول) حفظ شود
   D) انتهای تحلیل: متن دعوت بالای «رفتن به داشبورد»
   (درس v212: کلیک واقعی playwright — نه el.click())
*/
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();

/** ساخت کاربر تستی + سشن (مسیر جایگزین OTP — سندباکس بدون کلید پیامک) */
async function makeTestUser() {
  const mobile = "0914" + String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  const u = await db.user.create({
    data: {
      mobile,
      name: "تست دویست‌وچهارده",
      role: "USER",
      onboardingDone: false,
      sessionEpoch: 0,
    },
    select: { id: true, mobile: true },
  });
  const secret = readFileSync("/home/z/my-project/db/.session-secret", "utf8").trim();
  const payload = Buffer.from(JSON.stringify({ uid: u.id, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  await db.$disconnect();
  return { mobile: u.mobile, token: `${payload}.${sig}` };
}

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

const browser = await chromium.launch();

async function loginAndGotoOnboarding(ua) {
  const ctx = await browser.newContext({
    userAgent: ua,
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true,
  });
  const { mobile, token } = await makeTestUser();
  await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // لندینگ → ورود به اپ (CTA «شروع کنید») → آنبوردینگ برای کاربر بدون آنبوردینگ
  const cta = page.locator("button:has-text('شروع کنید'), a:has-text('شروع کنید')").first();
  if ((await cta.count()) > 0) {
    await cta.click().catch(() => {});
  }
  // انتظار واقعی برای آنبوردینگ (کامپایل on-demand سرور dev می‌تواند کند باشد)
  await page.waitForSelector("text=اطلاعات پایه", { timeout: 60_000 });
  await page.waitForTimeout(600);
  return { ctx, page, mobile };
}

const scrollBlockToTop = async (page, textMatch) => {
  await page.evaluate((t) => {
    const s = document.querySelector("[data-onb-scroller]");
    const block = [...s.querySelectorAll("[data-onb-q]")].find((d) => (d.textContent || "").includes(t));
    if (block) {
      const sRect = s.getBoundingClientRect();
      const bRect = block.getBoundingClientRect();
      s.scrollTop += bRect.top - sRect.top - 8; // بالای بلوک نزدیک سقف اسکرولر — بدون دخالت autoscroll
    }
  }, textMatch);
  await page.waitForTimeout(250);
};

/* ═══ A+B: UA اینستاگرام ═══ */
console.log("\n─── A+B) UA اینستاگرام ───");
{
  const { ctx, page } = await loginAndGotoOnboarding(
    "Mozilla/5.0 (Linux; Android 13; SM-S901E) AppleWebKit/537.36 (KHTML, like Gecko) Instagram 320.1.0.0.109 Android Mobile Safari/537.36"
  );
  ok(true, "آنبوردینگ (مرحلهٔ اطلاعات پایه) بالا آمد");

  // A) جنسیت → صفر اسکرول (بلوک اول نزدیک سقف قرار می‌گیرد تا autoscroll پلی‌رایت دخالت نکند)
  await scrollBlockToTop(page, "جنسیت");
  const stA0 = await page.evaluate(() => document.querySelector("[data-onb-scroller]")?.scrollTop ?? -1);
  await page.locator("div[data-onb-q]:has-text('جنسیت') button").first().click();
  await page.waitForTimeout(700);
  const stA1 = await page.evaluate(() => document.querySelector("[data-onb-scroller]")?.scrollTop ?? -1);
  ok(stA0 >= 0 && Math.abs(stA1 - stA0) < 2, "A1 جنسیت: صفر اسکرول بعد از انتخاب", `Δ=${stA1 - stA0}px`);

  // B) فرم بدن با کیبورد باز — اول KeyboardFix بنشیند (تایمرهای ۲۲۰/۵۰۰/۹۰۰ms)،
  // بعد مبنا گرفته شود؛ هر حرکتی بعد از کلیک = پرشِ واقعی
  await scrollBlockToTop(page, "فرم بدن شما");
  const focusInfo = await page.evaluate(() => {
    const s = document.querySelector("[data-onb-scroller]");
    const w = [...s.querySelectorAll("input")].find((i) => i.type === "number");
    if (!w) return { found: false };
    w.focus({ preventScroll: true });
    return { found: true, tag: document.activeElement?.tagName };
  });
  ok(focusInfo.found && focusInfo.tag === "INPUT", "B1 ورودی عددی فوکوس شد (شبیه‌سازی کیبورد باز)");
  await page.waitForTimeout(1200); // نشستن کامل KeyboardFix
  const stB0 = await page.evaluate(() => document.querySelector("[data-onb-scroller]").scrollTop);
  await page.locator("div[data-onb-q]:has-text('فرم بدن شما') button").first().click();
  await page.waitForTimeout(750);
  const stB1 = await page.evaluate(() => document.querySelector("[data-onb-scroller]").scrollTop);
  const focusB = await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.tagName : "—"));
  ok(Math.abs(stB1 - stB0) < 2, "B2 IG: صفر پرش اسکرول بعد از انتخاب فرم بدن", `Δ=${stB1 - stB0}px`);
  ok(focusB === "INPUT", "B3 IG: فوکوس/کیبورد حفظ شد (بدون blur)", `active=${focusB}`);
  await ctx.close();
}

/* ═══ C: UA وب عادی — رفتار v212 حفظ شود ═══ */
console.log("\n─── C) UA وب عادی (Chrome Android) ───");
{
  const { ctx, page } = await loginAndGotoOnboarding(
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
  );
  await page.click("button:has-text('آقا')");
  await page.waitForTimeout(300);
  // ترتیب واقعی کاربر: فوکوس ورودی (کیبورد باز) → نشستن → اسکرول کاربر به فرم بدن
  // (پرچم userScrolledWhileOpen در v212) → لمس گزینه
  await page.evaluate(() => {
    const s = document.querySelector("[data-onb-scroller]");
    const w = [...s.querySelectorAll("input")].find((i) => i.type === "number");
    if (w) w.focus({ preventScroll: true });
  });
  await page.waitForTimeout(1200); // نشستن KeyboardFix
  // اسکرول «کاربر» با کیبورد باز — رویداد scroll واقعی → جلسه dirty می‌شود
  await page.evaluate(() => {
    const s = document.querySelector("[data-onb-scroller]");
    const block = [...s.querySelectorAll("[data-onb-q]")].find((d) => (d.textContent || "").includes("فرم بدن شما"));
    if (block) {
      const sRect = s.getBoundingClientRect();
      const bRect = block.getBoundingClientRect();
      s.scrollTop += bRect.top - (sRect.top + s.clientHeight * 0.55);
    }
  });
  await page.waitForTimeout(400);
  const stC0 = await page.evaluate(() => document.querySelector("[data-onb-scroller]").scrollTop);
  await page.locator("div[data-onb-q]:has-text('فرم بدن شما') button").first().click();
  await page.waitForTimeout(1400);
  const stC1 = await page.evaluate(() => document.querySelector("[data-onb-scroller]").scrollTop);
  const focusC = await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.tagName : "—"));
  ok(stC1 > stC0 + 40, "C1 وب: اسکرول نرم v212 به بخش بعدی کار می‌کند", `Δ=${stC1 - stC0}px`);
  ok(focusC !== "INPUT", "C2 وب: blur ورودی (رفتار v212) حفظ شده", `active=${focusC}`);
  await ctx.close();
}

/* ═══ D: متن دعوت داشبورد در انتهای تحلیل ═══ */
console.log("\n─── D) انتهای تحلیل ───");
{
  const src = execSync(`grep -c "از طریق داشبوردت" /home/z/my-project/src/components/fitness/analysis-screen.tsx || true`, { encoding: "utf8" }).trim();
  ok(Number(src) > 0, "D1 متن دعوت بالای «رفتن به داشبورد» در سورس تحلیل موجود است");
}

console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
