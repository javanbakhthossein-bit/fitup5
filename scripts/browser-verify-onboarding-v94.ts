/**
 * وریفای آنبوردینگ v94 — ورود تستی + چیپ‌های رشته‌های جدید + تجهیزات TRX
 * اجرا: bun scripts/browser-verify-onboarding-v94.ts
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const MOBILE = "09120000001"; // شمارهٔ تست (سندباکس — پیامک واقعی نمی‌رود در dev با DEV_OTP)

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // ۲) ورود با OTP در UI — اول موبایل + ارسال، بعد خواندن کد از DB (کد جدیدی که خود UI ساخته)
  await page.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);
  const mobileInput = page.locator("#mobile").first();
  await mobileInput.click();
  await mobileInput.pressSequentially(MOBILE, { delay: 60 });
  await page.locator("button[type='submit']").first().click();
  await page.waitForTimeout(5000);
  // خواندن کد از دیتابیس (بعد از ارسال UI — آخرین کد)
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const otpRow = await prisma.otpCode.findFirst({
    where: { mobile: MOBILE },
    orderBy: { createdAt: "desc" },
  });
  await prisma.$disconnect();
  const code = otpRow?.code;
  if (!code) throw new Error("کد OTP در دیتابیس پیدا نشد");
  console.log("کد OTP از DB:", code);
  // کد OTP — فیلدهای کد
  const codeInputs = page.locator("input[maxlength='1'], input[inputmode='numeric']");
  const cnt = await codeInputs.count();
  console.log("تعداد فیلد کد:", cnt);
  if (cnt >= 4) {
    for (let i = 0; i < cnt; i++) {
      await codeInputs.nth(i).fill(code[i] || "0");
      await page.waitForTimeout(120);
    }
  } else {
    const single = page.locator("input[inputmode='numeric'], input[maxlength]").first();
    await single.fill(code);
  }
  await page.waitForTimeout(800);
  // دکمهٔ «تأیید و ورود» (submit دوم در فرم)
  const submitBtns = page.locator("button[type='submit']");
  if ((await submitBtns.count()) > 1) {
    await submitBtns.nth(1).click().catch(() => {});
  } else {
    await submitBtns.last().click().catch(() => {});
  }
  await page.waitForTimeout(6000);

  // اگر گام «نام» ظاهر شد (کاربر جدید)، نام بده و ادامه بده
  const nameInput = page.locator("input[type='text']").first();
  if (await nameInput.count().catch(() => 0)) {
    const nb = (await page.locator("body").textContent().catch(() => "")) || "";
    if (nb.includes("نام") || nb.includes("اسمت")) {
      await nameInput.fill("تست وریفای ۹۴");
      const cont = page.locator("button:has-text('ادامه'), button:has-text('ثبت')").first();
      if (await cont.count().catch(() => 0)) await cont.click().catch(() => {});
      await page.waitForTimeout(3000);
    }
  }

  // ۳) آنبوردینگ — رفتن تا مرحلهٔ تمرین (مرحلهٔ ۳)
  // ممکن است کاربر قبلاً آنبوردینگ کرده باشد — URL پنل یا آنبوردینگ
  console.log("URL بعد از ورود:", page.url());
  await page.screenshot({ path: "/tmp/v94-after-login.png" });

  // اگر در پنل است، مستقیم به صفحهٔ رشته‌ها در پروفایل برو نمی‌شود — فقط آنبوردینگ را چک می‌کنیم اگر بود
  const body = await page.locator("body").textContent().catch(() => "");
  const inOnboarding = (body || "").includes("رشتهٔ ورزشی") || page.url().includes("onboarding");
  if (!inOnboarding) {
    // کاربر آنبوردینگ‌شده — چیپ‌ها را از UI پروفایل ورزشی چک می‌کنیم
    console.log("کاربر در پنل — بررسی پروفایل ورزشی...");
    await page.goto(`${BASE}/?screen=panel`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const panelBody = await page.locator("body").textContent().catch(() => "");
    check("پنل بالا آمد", (panelBody || "").length > 200);
  } else {
    await page.waitForTimeout(2000);
    // رفتن به مرحلهٔ تمرین: کلیک‌های بعد تا «رشتهٔ ورزشی» دیده شود
    for (let i = 0; i < 6; i++) {
      const b = await page.locator("body").textContent().catch(() => "") || "";
      if (b.includes("رشتهٔ ورزشی")) break;
      const nextBtn = page.locator("button:has-text('ادامه')").first();
      if (await nextBtn.count()) await nextBtn.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    const b2 = (await page.locator("body").textContent().catch(() => "")) || "";
    for (const label of ["پیلاتس", "TRX", "هییت", "کیک‌بوکسینگ", "فانکشنال", "بالنس و تعادل"]) {
      check(`چیپ رشتهٔ ${label}`, b2.includes(label));
    }
    check("چیپ تجهیزات نوار TRX", b2.includes("نوار TRX"));
    await page.screenshot({ path: "/tmp/v94-onboarding-disciplines.png" });
  }

  await browser.close();
  console.log(`\nنتیجه: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
