/**
 * v210 — راستی‌آزمایی مرورگری سیاست نهایی مالک برای چت نیکا:
 * «در آنبوردینگ به هیچ وجه نباید باشه، در ورود هم نباید باشه، در هیچ جا —
 *  فقط در لندینگ‌ها باید باشه»
 *
 *  ① landing            → ویجت «چت با نیکا» باید باشد (۱)
 *  ② auth               → ویجت نباید باشد (۰)
 *  ③ onboarding         → ویجت نباید باشد (۰) — با سشن واقعی
 *  ④ /exercise/[id]     → ویجت نباید باشد (۰) — صفحهٔ محتوایی
 *  ⑤ /?ref=…            → ویجت باید باشد (۱) — لندینگ دعوت
 *  ⑥ صفر خطای مرگبار کنسول (به‌ویژه #418 هیدریشن)
 *
 * ⚠️ محدودیت سندباکس: cgroup فقط ~۳.۹GB رم دارد؛ همزمانی Chromium + کامپایل
 * تازهٔ webpack در dev → oom-kill سرور. راه‌حل: هر چک در «یک اجرای جدا» با
 * CHECK=<name> اجرا می‌شود؛ بین اجراها اسکریپت bash سرور را زنده نگه می‌دارد
 * و مسیرها را با curl (بدون Chromium) گرم می‌کند تا کامپایل‌ها کش شوند.
 *
 * اجرا: CHECK=landing bun scripts/verify-v210-nika.mjs
 */
import { chromium, devices } from "playwright";
import { readFileSync } from "fs";
import { scryptSync } from "crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const MOBILE = "09350001122";
const WIDGET = "[aria-label='چت با نیکا']";
const CHECK = process.env.CHECK || "all";

const results = [];
function check(name, cond, detail = "") {
  const ok = cond;
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok ? "" : " " + detail}`);
}

function makeSessionToken(userId, secret) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

/** dev-mode: اتصال HMR گاهی goto را ERR_ABORTED می‌کند — تلاش مجدد */
async function safeGoto(page, url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      return;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function openBrowser(sessionToken) {
  const browser = await chromium.launch({
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--renderer-process-limit=1"],
  });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
  if (sessionToken) {
    await ctx.addCookies([{ name: "sc_session", value: sessionToken, url: BASE }]);
  }
  const page = await ctx.newPage();
  return { browser, page };
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

  const want = (n) => CHECK === "all" || CHECK === n;

  // ─── ① landing ───
  if (want("landing")) {
    const { browser, page } = await openBrowser(null);
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
    await safeGoto(page, `${BASE}/`);
    await page.waitForTimeout(6000);
    check("① لندینگ → ویجت نیکا هست", (await page.locator(WIDGET).count()) === 1);
    await browser.close();
  }

  // ─── ② auth ───
  if (want("auth")) {
    const { browser, page } = await openBrowser(null);
    await safeGoto(page, `${BASE}/?screen=auth`);
    await page.waitForTimeout(5000);
    check("② ورود → ویجت نیکا نیست", (await page.locator(WIDGET).count()) === 0);
    await browser.close();
  }

  // ─── ③ onboarding (سشن واقعی، onboardingDone=false) ───
  if (want("onboarding")) {
    const { browser, page } = await openBrowser(token);
    await safeGoto(page, `${BASE}/?screen=auth`);
    const appeared = await page
      .locator("text=اطلاعات پایه")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    check("③ آنبوردینگ بالا آمد (سشن واقعی)", appeared);
    if (appeared) {
      await page.waitForTimeout(5000); // جاافتادن بوت در dev
      check("③ آنبوردینگ → ویجت نیکا نیست", (await page.locator(WIDGET).count()) === 0);
    }
    await browser.close();
  }

  // ─── ④ صفحهٔ محتوایی تمرین ───
  if (want("exercise")) {
    const { browser, page } = await openBrowser(null);
    await safeGoto(page, `${BASE}/exercise/seed_ex_28`);
    await page.waitForTimeout(5000);
    check("④ /exercise → ویجت نیکا نیست", (await page.locator(WIDGET).count()) === 0);
    await browser.close();
  }

  // ─── ⑤ لندینگ دعوت (referral) ───
  if (want("referral")) {
    const { browser, page } = await openBrowser(null);
    await safeGoto(page, `${BASE}/?ref=TEST210`);
    await page.waitForTimeout(5000);
    check("⑤ لندینگ دعوت → ویجت نیکا هست", (await page.locator(WIDGET).count()) === 1);
    await page.screenshot({ path: "/tmp/v210-verify-referral.png" });
    await browser.close();
  }

  // ─── ⑥ خطاهای مرگبار کنسول (روی اجرای landing دوباره جمع می‌شود) ───
  if (want("console")) {
    const { browser, page } = await openBrowser(null);
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
    await safeGoto(page, `${BASE}/`);
    await page.waitForTimeout(6000);
    const fatal = errs.filter(
      (e) =>
        e.includes("#418") ||
        e.includes("Hydration failed") ||
        e.includes("Minified React error") ||
        e.includes("hydration mismatch")
    );
    check("⑥ صفر خطای هیدریشن/مرگبار کنسول", fatal.length === 0, JSON.stringify(fatal.slice(0, 3)));
    if (errs.length > 0) {
      console.log("  ℹ️ همهٔ پیام‌های error کنسول (برای اطلاع):");
      for (const e of errs.slice(0, 5)) console.log(`     - ${e}`);
    }
    await browser.close();
  }

  const fails = results.filter((r) => !r.ok).length;
  console.log(`\nنتیجهٔ CHECK=${CHECK}: ${results.length - fails} PASS / ${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(2);
});
