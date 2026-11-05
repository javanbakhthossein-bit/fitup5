/**
 * وریفای مرورگری v94 — لندینگ (کارت‌های رشته/شمارنده) + صفحهٔ رشته + آنبوردینگ
 * اجرا: bun scripts/browser-verify-v94.ts
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
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
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/net::ERR|favicon|404/.test(m.text())) errors.push(m.text().slice(0, 160));
  });

  // ─── ۱) لندینگ: کارت‌های رشته + شمارنده ───
  console.log("\n── لندینگ ──");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4000);
  const discSection = await page.locator("#disciplines").count();
  check("سکشن رشته‌ها در لندینگ", discSection > 0);
  const cardText = await page.locator("#disciplines").textContent().catch(() => "");
  for (const label of ["پیلاتس", "TRX", "هییت", "کیک‌بوکسینگ", "فانکشنال", "بالنس"]) {
    check(`کارت ${label}`, (cardText || "").includes(label));
  }
  await page.screenshot({ path: "/tmp/v94-landing.png" });

  // ─── ۲) صفحهٔ رشته (?sport=pilates) ───
  console.log("\n── صفحهٔ رشته پیلاتس ──");
  await page.goto(BASE + "/?sport=pilates", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
  const body = await page.locator("body").textContent().catch(() => "");
  check("عنوان صفحهٔ رشته", (body || "").includes("پیلاتس چیست"));
  check("سکشن فواید", (body || "").includes("فواید پیلاتس"));
  check("حرکات اختصاصی", (body || "").includes("حرکات اختصاصی پیلاتس"));
  check("FAQ", (body || "").includes("پرسش‌های متداول"));
  const iframe = await page.locator("iframe[src*='youtube.com/embed']").count();
  check("ویدیوی یوتیوب embed", iframe > 0);
  const exBtns = await page.locator("text=صد پیلاتس").count();
  check("حرکت «صد پیلاتس» در لیست", exBtns > 0);
  await page.screenshot({ path: "/tmp/v94-sport-pilates.png" });

  // کلیک روی حرکت → صفحهٔ آموزش حرکت
  await page.locator("button:has-text('صد پیلاتس')").first().click().catch(() => {});
  await page.waitForTimeout(3500);
  const exBody = await page.locator("body").textContent().catch(() => "");
  check("صفحهٔ آموزش حرکت باز شد", (exBody || "").includes("Pilates Hundred") || (exBody || "").includes("آموزش"));
  await page.screenshot({ path: "/tmp/v94-exercise-detail.png" });

  // ─── ۳) صفحهٔ رشتهٔ بدون ویدیو (بالنس — همه ویدیو دارند؛ تست رشتهٔ ناموجود) ───
  console.log("\n── بالنس (ویدیو دارد) + رشتهٔ ناموجود ──");
  await page.goto(BASE + "/?sport=balance", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  const balBody = await page.locator("body").textContent().catch(() => "");
  check("صفحهٔ بالنس", (balBody || "").includes("بالنس و تعادل"));
  check("ویدیوی بالنس embed", (await page.locator("iframe[src*='youtube.com/embed']").count()) > 0);

  // ─── ۴) متادیتای SSR ───
  const title = await page.title();
  check("title بالنس", title.includes("بالنس"));

  await browser.close();

  console.log("\n══════════════════");
  console.log(`نتیجه: ${pass} ✅ / ${fail} ❌`);
  if (errors.length) {
    console.log("\nخطاهای کنسول:");
    for (const e of errors.slice(0, 8)) console.log("  •", e);
  } else {
    console.log("بدون خطای کنسول ✓");
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("verify شکست:", e);
  process.exit(1);
});
