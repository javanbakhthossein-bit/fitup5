/**
 * v211 — راستی‌آزمایی مرورگری فیکس آنبوردینگ (دیرکتیو مالک):
 *  ① سؤال جنسیت: انتخاب → صفر اسکرول (صفحه سرجایش می‌ماند)
 *  ② سؤال فرم بدن: ضربه روی «بیضی (سیب)» → صفر پرش به اول سؤال؛ بخش اختیاری
 *     پایین (ریکاوری و سبک زندگی) همچنان در دید می‌ماند
 *  ③ صفر خطای مرگبار کنسول
 *
 * درس v209: کلیکِ استاندارد Playwright قبل از کلیک عنصر را «سنتر» می‌کند و
 * خودش پرش اسکرول می‌سازد → با el.click() واقعی DOM کلیک می‌کنیم (بدون اسکرول).
 *
 * اجرا: bun scripts/verify-v211-onboarding.mjs (سرور dev لازم است)
 */
import { chromium, devices } from "playwright";
import { readFileSync } from "fs";
import { scryptSync } from "crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const MOBILE = "09350001122";
const shot = (n) => `/tmp/v211-verify-${n}.png`;

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

function makeSessionToken(userId, secret) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

async function main() {
  const secret = readFileSync("/home/z/my-project/db/.session-secret", "utf8").trim();
  const prisma = new PrismaClient();
  let user = await prisma.user.findUnique({ where: { mobile: MOBILE } });
  if (!user) user = await prisma.user.create({ data: { mobile: MOBILE, name: "تستی" } });
  if (user.onboardingDone) {
    user = await prisma.user.update({ where: { id: user.id }, data: { onboardingDone: false } });
  }
  const token = makeSessionToken(user.id, secret);
  await prisma.$disconnect();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
  await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160));
  });

  await page.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const appeared = await page
    .locator("text=اطلاعات پایه")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  check("آنبوردینگ بالا آمد", appeared);
  if (!appeared) {
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(8000); // dev-mode: جاافتادن HMR

  // اسکرولر مرحله را با لنگرِ متنی پیدا می‌کنیم (مقاوم به کلاس‌ها)
  const scrollerHandle = await page.evaluateHandle(() => {
    const divs = Array.from(document.querySelectorAll("div"));
    return (
      divs.find(
        (el) =>
          /overflow-y-auto/.test(String(el.className || "")) &&
          el.textContent &&
          el.textContent.includes("جنسیت") &&
          el.textContent.includes("فرم بدن")
      ) || null
    );
  });
  const scrollTop = async () =>
    scrollerHandle.evaluate((el) => (el ? el.scrollTop : -1)).catch(() => -1);
  // اسکرول به مطلق (فقط برای نزدیک‌کردن سؤال به دید — شبیه کاربر واقعی)
  const scrollTo = async (y) =>
    scrollerHandle.evaluate((el, yy) => {
      if (el) el.scrollTop = yy;
    }, y).catch(() => {});

  // کلیک واقعی DOM — بدون auto-centering پلای‌رایت
  const domClick = async (locator) => {
    await locator.waitFor({ state: "visible", timeout: 20_000 });
    const h = await locator.elementHandle();
    await h.evaluate((el) => el.click());
  };

  // ─── ① جنسیت: انتخاب → صفر اسکرول ───
  console.log("\n[۱] سؤال جنسیت — انتخاب نباید اسکرول کند:");
  await scrollTo(0);
  await page.waitForTimeout(400);
  const beforeGender = await scrollTop();
  await domClick(page.locator("button", { hasText: "آقا" }).first());
  await page.waitForTimeout(700); // بیشتر از تأخیر ۲۸۰ms مدیر قدیمی — هر پرشی می‌گرفت
  const afterGender = await scrollTop();
  check("scrollTop بدون تغییر (Δ<2px)", Math.abs(afterGender - beforeGender) < 2, `before=${beforeGender} after=${afterGender}`);
  await page.screenshot({ path: shot("gender") });

  // ─── پر کردن بقیهٔ مرحلهٔ ۰ تا فرم بدن ───
  const inputs = page.locator("input");
  await inputs.nth(2).fill("29"); // سن
  await inputs.nth(3).fill("178"); // قد
  await inputs.nth(4).fill("85"); // وزن

  // ─── ② فرم بدن: ضربه روی بیضی → بدون پرش؛ بخش اختیاری در دید ───
  console.log("\n[۲] سؤال فرم بدن — ضربه روی بیضی نباید بپرد:");
  // مثل کاربر: تا وقتی بیضی و بخش اختیاری پشت هم دیده می‌شوند اسکرول می‌کنیم
  await page.locator("text=فرم بدن شما").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const picker = page.locator("div.grid.grid-cols-2 button", { hasText: "بیضی (سیب)" }).first();
  const pickerVisible = await picker.isVisible().catch(() => false);
  check("بیضی (سیب) در دید است", pickerVisible);
  const scBefore = await scrollTop();
  const qTopBefore = await page
    .locator("text=فرم بدن شما")
    .first()
    .evaluate((el) => el.getBoundingClientRect().top);
  await domClick(picker);
  await page.waitForTimeout(900); // هر پرشِ ۲۸۰ms قدیمی این‌جا می‌افتاد
  const scAfter = await scrollTop();
  const qTopAfter = await page
    .locator("text=فرم بدن شما")
    .first()
    .evaluate((el) => el.getBoundingClientRect().top);
  check("scrollTop بدون تغییر (Δ<3px)", Math.abs(scAfter - scBefore) < 3, `before=${scBefore} after=${scAfter}`);
  check("سؤال فرم بدن سرجایش (Δtop<3px)", Math.abs(qTopAfter - qTopBefore) < 3, `before=${qTopBefore} after=${qTopAfter}`);
  // بخش اختیاری (ریکاوری و سبک زندگی) هنوز در دید است؟
  const accVisible = await page
    .locator("text=ریکاوری و سبک زندگی")
    .first()
    .isVisible()
    .catch(() => false);
  check("بخش اختیاری پایین همچنان دیده می‌شود", accVisible);
  await page.screenshot({ path: shot("bodyshape") });

  // ─── ③ خطاهای مرگبار کنسول ───
  console.log("\n[۳] کنسول:");
  const fatal = errors.filter(
    (e) => !/Download the React DevTools|pointerEvents|autofill|Failed to load resource/i.test(e)
  );
  const res404 = errors.filter((e) => /Failed to load resource/i.test(e));
  if (res404.length) console.log(`  ℹ️ ${res404.length} خطای ۴۰۴ منبع (غیرمرگبار): ${res404[0]}`);
  check("صفر خطای مرگبار JS", fatal.length === 0, fatal.slice(0, 3).join(" | "));

  await browser.close();
  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("خطای اسکریپت:", e);
  process.exit(1);
});
