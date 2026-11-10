/**
 * v95 onboarding browser verify — gender-dynamic disciplines in onboarding.
 * Logs in with a fresh dev user (DEV_OTP_ENABLED=true returns devCode), walks
 * the onboarding steps and checks the discipline chips per gender.
 * Run: bun scripts/browser-verify-onboarding-v95.ts
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const MOBILE = "0912950" + String(Math.floor(Math.random() * 9000 + 1000)); // 11 digits

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  OK ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  // OTP code source: the real SMS gateway usually succeeds, so devCode is NOT in
  // the response — read the latest code for this mobile from the OtpCode table.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const readCode = async (): Promise<string> => {
    const row = await db.otpCode.findFirst({
      where: { mobile: MOBILE, used: false },
      orderBy: { createdAt: "desc" },
    });
    return row?.code ?? "";
  };

  console.log(`test mobile: ${MOBILE}`);

  // ─── 1) login ───
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /شروع کنید/ }).first().click();
  await page.waitForTimeout(1800);
  const phoneInput = page.locator('#mobile, input[inputmode="numeric"][autocomplete="tel"], input[placeholder*="0912"]').first();
  await phoneInput.fill(MOBILE);
  await page.getByRole("button", { name: /ارسال کد/ }).first().click();
  // wait for the OTP step
  await page.waitForTimeout(3000);
  let devCode = "";
  for (let i = 0; i < 12 && !devCode; i++) {
    await page.waitForTimeout(800);
    devCode = await readCode().catch(() => "");
  }
  check("otp code from DB", !!devCode, devCode || "(empty)");
  const otpInput = page.locator("#otp-input").first();
  await otpInput.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  check("otp input visible", (await otpInput.count()) > 0);
  await otpInput.click();
  await page.keyboard.type(devCode, { delay: 60 });
  // wait until the submit button becomes enabled (code.length === 4)
  const submitBtn = page.getByRole("button", { name: /تأیید و ورود/ }).first();
  await submitBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 15; i++) {
    const enabled = await submitBtn.isEnabled().catch(() => false);
    if (enabled) break;
    await page.waitForTimeout(500);
  }
  await submitBtn.click({ timeout: 15000 });
  await page.waitForTimeout(5000);

  // ─── 2) onboarding step 0 (اطلاعات) ───
  const onbVisible = await page.getByText("رشتهٔ ورزشی", { exact: false }).first().isVisible({ timeout: 20000 }).catch(() => false);
  if (!onbVisible) {
    // maybe onboarding shows later; try to detect step indicators
    console.log("  (onboarding not detected yet — waiting)");
    await page.waitForTimeout(3000);
  }
  const body = (await page.locator("body").textContent().catch(() => "")) || "";
  check("onboarding screen loaded", body.includes("جنسیت") || body.includes("نام و نام خانوادگی") || body.includes("اطلاعات"));

  // fill names — exact placeholders from StepBasicInfo
  const fn = page.locator('input[placeholder="مثال: علی"]').first();
  const ln = page.locator('input[placeholder="مثال: رضایی"]').first();
  check("name inputs found", (await fn.count()) > 0 && (await ln.count()) > 0);
  await fn.fill("تست");
  await ln.fill("کاربر");

  // gender: pick male (button containing آقا)
  await page.locator('button:has-text("آقا")').first().click();
  await page.waitForTimeout(400);
  // age / height / weight inputs
  const numInputs = page.locator('input[type="number"], input[inputmode="numeric"]');
  const numCount = await numInputs.count();
  check("numeric inputs exist (age/height/weight)", numCount >= 3, `count=${numCount}`);
  if (numCount >= 3) {
    await numInputs.nth(0).fill("28");
    await numInputs.nth(1).fill("180");
    await numInputs.nth(2).fill("82");
  }
  const nextBtn = page.getByRole("button", { name: /مرحله بعد/ }).first();
  await nextBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  for (let i = 0; i < 12; i++) {
    if (await nextBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(500);
  }
  check("step0 next enabled", await nextBtn.isEnabled().catch(() => false));
  await nextBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // ─── 3) step 1 (هدف/فعالیت/روزها) — متن دکمه‌ها از سورس: چربی‌سوزی/متوسط/شنبه ───
  const next1 = page.getByRole("button", { name: /مرحله بعد/ }).first();
  for (const [sel, desc] of [
    ['button:has-text("چربی")', "goal"],
    ['button:has-text("متوسط")', "activity"],
    ['button:has-text("شنبه")', "day"],
  ] as const) {
    const b = page.locator(sel).first();
    if ((await b.count()) > 0) {
      await b.click({ timeout: 8000 }).catch((e) => console.log(`  (skip ${desc}: ${String(e).slice(0, 60)})`));
    }
    await page.waitForTimeout(350);
  }
  for (let i = 0; i < 12; i++) {
    if (await next1.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(500);
  }
  await next1.click({ timeout: 10000 }).catch((e) => console.log(`  (next1 failed: ${String(e).slice(0, 80)})`));
  await page.waitForTimeout(1000);

  // ─── 4) step 2 (تمرین: محیط + سطح + رشته‌ها) — the discipline grid ───
  const stepBody = (await page.locator("body").textContent().catch(() => "")) || "";
  const discGridVisible = stepBody.includes("رشتهٔ ورزشی");
  check("discipline grid visible", discGridVisible);
  // male set: must include بادی‌بیلدینگ/فیزیک کلاسیک and NOT include female-only ones
  const hasMaleOnly = stepBody.includes("بادی‌بیلدینگ") && stepBody.includes("فیزیک کلاسیک");
  const noFemaleOnly = !stepBody.includes("بیکینی فیتنس") && !stepBody.includes("فیتنس بانوان") && !stepBody.includes("ولنس");
  const noKick = !stepBody.includes("کیک‌بوکسینگ");
  check("male sees male disciplines (بادی‌بیلدینگ/فیزیک کلاسیک)", hasMaleOnly);
  check("male does NOT see female-only disciplines", noFemaleOnly);
  check("no kickboxing anywhere", noKick);
  check("shared disciplines present (پیلاتس/TRX/هییت)", stepBody.includes("پیلاتس") && stepBody.includes("TRX") && stepBody.includes("هییت"));
  await page.screenshot({ path: "/tmp/v95-onb-male.png" });

  // switch gender back to female in step 0 to compare? (discipline grid is step 2;
  // simpler: verify female set by switching gender via profile later — instead we
  // assert the female set statically in the unit test) — finish here.
  await ctx.close();
  await browser.close();
  console.log(`\n${"=".repeat(50)}\nresult: ${pass} OK / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("onboarding verify failed:", e);
  process.exit(1);
});
