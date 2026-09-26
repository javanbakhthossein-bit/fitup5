/**
 * دیباگ جریان: کلیک حرکت در صفحهٔ رشته → صفحهٔ آموزش حرکت
 */
import { chromium } from "playwright-core";

const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("request", (r) => {
    if (r.url().includes("/api/exercises")) console.log("REQ:", r.url());
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/exercises")) console.log("RES:", r.status(), r.url().slice(-40));
  });
  page.on("console", (m) => console.log("CONSOLE:", m.type(), m.text().slice(0, 120)));

  await page.goto("http://localhost:3000/?sport=pilates", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);
  const btn = page.locator("button:has-text('صد پیلاتس')").first();
  console.log("button count:", await btn.count());
  await btn.click();
  await page.waitForTimeout(5000);
  console.log("URL now:", page.url());
  const body = await page.locator("body").textContent();
  console.log("has Hundred:", (body || "").includes("Pilates Hundred"));
  console.log("has notFound:", (body || "").includes("حرکت یافت نشد"));
  await page.screenshot({ path: "/tmp/v94-exercise-debug.png" });
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
