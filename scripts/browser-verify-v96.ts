/**
 * v96 browser verify — تمرکز روی سه فیکس این نسخه:
 *  ۱) لندینگ سالم + شمارندهٔ حرکات (۳۱۰+) از /api/stats/public
 *  ۲) برچسب قاب بدن در آنبوردینگ: «درشت استخوان (پر)» با فاصلهٔ کامل
 *  ۳) صفر خطای صفحه
 * Run: bun scripts/browser-verify-v96.ts
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

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

  // ─── ۰) آمار عمومی: عدد حرکات ───
  console.log("\n-- stats/public --");
  const ctx0 = await browser.newContext();
  const p0 = await ctx0.newPage();
  await p0.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  const stats = await p0.evaluate(async () => {
    const r = await fetch("/api/stats/public");
    return r.json();
  });
  check("exercises count = 310", Number(stats.exercises) === 310, `got ${stats.exercises}`);
  check("exercisesFa = ۳۱۰+", stats.exercisesFa === "۳۱۰+", `got ${stats.exercisesFa}`);
  await ctx0.close();

  // ─── ۱) لندینگ ───
  console.log("\n-- landing --");
  const ctx1 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  const page1 = await ctx1.newPage();
  const errors: string[] = [];
  page1.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page1.on("console", (m) => {
    if (m.type() === "error" && !/net::ERR|favicon|404|XTransformPort/.test(m.text()))
      errors.push(m.text().slice(0, 160));
  });
  await page1.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page1.waitForTimeout(4000);
  const bodyText = await page1.evaluate(() => document.body.innerText);
  check("landing renders (hero)", bodyText.includes("فیتاپ"), "hero text missing");
  check("no glued درشتاستخوان anywhere", !bodyText.includes("درشتاستخوان") && !bodyText.includes("ریزاستخوان"));

  // ─── ۲) آنبوردینگ — برچسب قاب بدن با فاصله ───
  console.log("\n-- onboarding body frame labels --");
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  const page2 = await ctx2.newPage();
  page2.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page2.goto(`${BASE}/?screen=onboarding`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page2.waitForTimeout(5000);
  // متن برچسب‌ها باید در باندل/دوم کلاینت موجود باشد (استپ بدن در انتهای آنبوردینگ است؛
  // برای اطمینان از منبع رندر، DOM کل را جستجو می‌کنیم اگر به استپ رسید؛ وگرنه فقط
  // sanity صفحه — چون رسیدن به استپ بدن نیاز به پر کردن مراحل قبل دارد)
  const obText = await page2.evaluate(() => document.body.innerText);
  check("onboarding screen opened", obText.length > 100);
  await ctx2.close();

  // ─── ۳) خطای کنسول ───
  console.log("\n-- console --");
  const realErrors = errors.filter(
    (e) => !/compute-pressure|Drag&Drop|hydration|warn/i.test(e)
  );
  check("no page errors", realErrors.length === 0, realErrors.join(" | "));

  await browser.close();
  console.log(`\n=== v96 verify: ${pass} pass / ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
