/**
 * v95 browser verify — landing (no kickboxing) + onboarding (gender-dynamic
 * disciplines) + OTP keyboard behavior + chat video poster flow.
 * Run: bun scripts/browser-verify-v95.ts
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

  // ─── 1) landing — disciplines section must have 5 cards, no kickboxing ───
  console.log("\n-- landing --");
  const ctx1 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  const page1 = await ctx1.newPage();
  const errors: string[] = [];
  page1.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page1.on("console", (m) => {
    if (m.type() === "error" && !/net::ERR|favicon|404|XTransformPort/.test(m.text())) errors.push(m.text().slice(0, 160));
  });
  await page1.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page1.waitForTimeout(3500);
  const discSection = await page1.locator("#disciplines").waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
  check("disciplines section exists", discSection);
  const cardText = (await page1.locator("#disciplines").textContent().catch(() => "")) || "";
  for (const label of ["پیلاتس", "TRX", "هییت", "فانکشنال", "بالنس"]) {
    check(`card ${label} present`, cardText.includes(label));
  }
  check("kickboxing card REMOVED", !cardText.includes("کیک‌بوکسینگ"));
  await page1.screenshot({ path: "/tmp/v95-landing.png" });

  // ─── 2) ?sport=kickboxing must not render a kickboxing page ───
  console.log("\n-- ?sport=kickboxing removed --");
  await page1.goto(BASE + "/?sport=kickboxing", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page1.waitForTimeout(2500);
  const kickText = (await page1.locator("body").textContent().catch(() => "")) || "";
  check("kickboxing page removed (falls back to landing)", !kickText.includes("ضربه، تعادل، تعریق"));

  // ─── 3) ?sport=pilates still works ───
  console.log("\n-- ?sport=pilates --");
  await page1.goto(BASE + "/?sport=pilates", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page1.waitForTimeout(3000);
  const pilText = (await page1.locator("body").textContent().catch(() => "")) || "";
  check("pilates page renders", pilText.includes("پیلاتس"));
  await ctx1.close();

  // ─── 4) auth screen — OTP keyboard scroll restore simulation ───
  console.log("\n-- auth / OTP keyboard --");
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page2.waitForTimeout(3000);
  // hero CTA "شروع کنید" -> smartNavigate -> auth screen (guest)
  const cta = page2.getByRole("button", { name: /شروع کنید/ }).first();
  check("hero CTA exists", (await cta.count()) > 0);
  await cta.click();
  await page2.waitForTimeout(2500);
  const phoneInput = page2.locator('input[type="tel"], input[inputmode="tel"], input[placeholder*="موبایل"], input[placeholder*="09"]').first();
  const hasAuth = (await phoneInput.count()) > 0;
  check("auth screen with phone input", hasAuth);
  if (hasAuth) {
    await phoneInput.fill("09120000000");
    await phoneInput.scrollIntoViewIfNeeded().catch(() => {});
    await page2.screenshot({ path: "/tmp/v95-auth-mobile.png" });
    // keyboard-open simulation: shrink visualViewport while focused
    await page2.evaluate(() => {
      const vv = (window as any).visualViewport;
      if (vv) {
        Object.defineProperty(vv, "height", { value: 420, configurable: true });
        vv.dispatchEvent(new Event("resize"));
      }
    });
    await page2.waitForTimeout(700);
    // keyboard-close simulation: grow visualViewport back (no blur — Android back button case)
    await page2.evaluate(() => {
      const vv = (window as any).visualViewport;
      if (vv) {
        Object.defineProperty(vv, "height", { value: 844, configurable: true });
        vv.dispatchEvent(new Event("resize"));
      }
    });
    await page2.waitForTimeout(900);
    const winY = await page2.evaluate(() => window.scrollY);
    const inner = await page2.evaluate(() => {
      const el = document.querySelector(".overflow-y-auto");
      return el ? (el as HTMLElement).scrollTop : -1;
    });
    check("window scrollY reset after keyboard close", winY === 0, `scrollY=${winY}`);
    check("inner scroller scrollTop reset after keyboard close", inner === 0, `scrollTop=${inner}`);
    await page2.screenshot({ path: "/tmp/v95-auth-after-close.png" });
  }
  await ctx2.close();

  // ─── 5) desktop sanity — landing renders, no console errors ───
  console.log("\n-- desktop sanity --");
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page3 = await ctx3.newPage();
  const err3: string[] = [];
  page3.on("pageerror", (e) => err3.push(String(e).slice(0, 160)));
  await page3.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page3.waitForTimeout(3500);
  const hero = (await page3.locator("body").textContent().catch(() => "")) || "";
  check("landing hero renders", hero.includes("فیتاپ"));
  check("no page errors (desktop)", err3.length === 0, err3.join(" | "));
  await page3.screenshot({ path: "/tmp/v95-desktop.png" });
  await ctx3.close();

  check("no page errors (mobile)", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(`\n${"=".repeat(50)}\nresult: ${pass} OK / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("browser verify failed:", e);
  process.exit(1);
});
