/* v214 — راستی‌آزمایی پنل مدیر:
   A) تب کاربران: ساعت ثبت‌نام + بج منبع ورود زیر نام
   B) تب مالی: قیف اینستاگرام جمع‌وجور (بدون روند روزانه) + برچسب‌های وضعیت
      (مدال پرداخت / در انتظار پرداخت / موفق)
*/
import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

// ─── دادهٔ تست: ادمین + کاربر + سه پرداخت با وضعیت‌های مختلف ───
const mobile = "0914" + String(Math.floor(1_000_000 + Math.random() * 8_999_999));
const admin = await db.user.create({
  data: { mobile, name: "ادمین تست ۲۱۴", role: "ADMIN", onboardingDone: true },
  select: { id: true },
});
const customer = await db.user.create({
  data: { mobile: "0914" + String(Math.floor(1_000_000 + Math.random() * 8_999_999)), name: "مشتری تست ۲۱۴", role: "USER", onboardingDone: true, signupSource: "instagram" },
  select: { id: true },
});
const pModal = await db.payment.create({ data: { userId: customer.id, amount: 350000, originalAmount: 350000, plan: "basic", paymentMethod: "gateway", status: "pending", description: "تست مدال پرداخت" } });
const pGate = await db.payment.create({ data: { userId: customer.id, amount: 690000, originalAmount: 690000, plan: "standard", paymentMethod: "gateway", status: "pending", authority: "A000000000000000000000000000TST1", description: "تست در انتظار پرداخت" } });
const pOk = await db.payment.create({ data: { userId: customer.id, amount: 1290000, originalAmount: 1290000, plan: "advanced", paymentMethod: "gateway", status: "success", authority: "A000000000000000000000000000TST2", refId: "TST214", verifiedAt: new Date(), description: "تست موفق" } });

const secret = readFileSync("db/.session-secret", "utf8").trim();
const payload = Buffer.from(JSON.stringify({ uid: admin.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile", viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
const page = await ctx.newPage();
await page.goto(BASE + "/?screen=admin", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// ─── A) تب کاربران ───
console.log("\n─── A) تب کاربران ───");
try {
  await page.waitForSelector("text=پنل مدیریت", { timeout: 30_000 });
  ok(true, "پنل مدیریت بالا آمد");
  // تب کاربران
  const usersTab = page.locator("button").filter({ hasText: /^\s*کاربران\s*$/ }).first();
  await usersTab.click({ force: true }).catch(async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "کاربران"); b?.click(); }); });
  // انتظار برای جدول واقعی کاربران (هدر «ثبت‌نام») + ردیف کاربر تستی
  await page.waitForSelector("th:has-text('ثبت‌نام')", { timeout: 90_000 });
  await page.waitForSelector("text=مشتری تست ۲۱۴", { timeout: 90_000 });
  await page.waitForTimeout(800);
  const body = await page.evaluate(() => document.body.innerText);
  ok(/ساعت \d/.test(body.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))), "A1 ستون ثبت‌نام شامل «ساعت» است");
  ok(body.includes("اینستاگرام"), "A2 بج منبع ورود (اینستاگرام) زیر نام کاربر نمایش داده شد");
  await page.screenshot({ path: "/tmp/v214-admin-users.png", fullPage: false });
} catch (e) {
  ok(false, "تب کاربران", String(e).slice(0, 120));
}

// ─── B) تب مالی و تراکنش‌ها ───
console.log("\n─── B) تب مالی و تراکنش‌ها ───");
try {
  const finTab = page.locator("button").filter({ hasText: /مالی و تراکنش/ }).first();
  await finTab.click({ force: true }).catch(async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("مالی")); b?.click(); }); });
  // انتظار برای برچسب‌های واقعی وضعیت (نه اسکلت)
  await page.waitForSelector("text=مدال پرداخت", { timeout: 90_000 });
  await page.waitForTimeout(800);
  const body = await page.evaluate(() => document.body.innerText);
  ok(!body.includes("روند روزانه"), "B1 «روند روزانه» حذف شده است");
  ok(body.includes("مدال پرداخت"), "B2 برچسب «مدال پرداخت» برای پرداختِ بدون ورود به درگاه");
  ok(body.includes("در انتظار پرداخت"), "B3 برچسب «در انتظار پرداخت» برای پرداختِ با authority");
  ok(body.includes("موفق"), "B4 برچسب «موفق» برای پرداخت موفق");
  ok(body.includes("قیف «پرداخت امن اینستاگرام»"), "B5 قیف اینستاگرام (جمع‌وجور) حاضر است");
  await page.screenshot({ path: "/tmp/v214-admin-finance.png", fullPage: false });
} catch (e) {
  ok(false, "تب مالی", String(e).slice(0, 120));
}

// ─── پاک‌سازی دادهٔ تست ───
await db.payment.deleteMany({ where: { id: { in: [pModal.id, pGate.id, pOk.id] } } });
await db.user.deleteMany({ where: { id: { in: [admin.id, customer.id] } } });
console.log("\n(دادهٔ تست پاک شد)");

console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
await browser.close();
await db.$disconnect();
process.exit(fail > 0 ? 1 : 0);
