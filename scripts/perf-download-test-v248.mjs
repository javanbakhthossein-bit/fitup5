/** v248 — تست دانلود تصویر/PDF برنامه بعد از deferred printable */
import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MOBILE = process.env.MOBILE || "09170435719";
const db = await import("@prisma/client").then((m) => new m.PrismaClient());
const u = await db.user.findFirst({ where: { mobile: MOBILE }, select: { id: true } });
const secret = (process.env.SESSION_SECRET || readFileSync("db/.session-secret", "utf8")).trim();
const payload = Buffer.from(JSON.stringify({ uid: u.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0.0.0 Mobile",
  viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true,
  acceptDownloads: true,
});
await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
await ctx.addInitScript(() => { try { localStorage.setItem("fitup_tour_seen_v1", "1"); } catch {} });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), m.text().slice(0, 220)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.goto(BASE + "/?screen=panel&tab=programs", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

// باز کردن مودال برنامه تمرینی — با retry
let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const span = [...document.querySelectorAll("button span")].find((s) => s.textContent?.trim() === "تمرین" && s.offsetParent !== null);
    span?.closest("button")?.click();
  });
  opened = await page.waitForSelector('[role="dialog"]', { timeout: 6000 }).then(() => true).catch(() => false);
  console.log(`تلاش ${i + 1}: opened=${opened}`);
}
if (!opened) { console.log("مودال باز نشد ✗"); await browser.close(); process.exit(1); }
console.log("مودال باز شد ✓");
// صبر برای deferred printable (idle callback تا 2.5s)
await page.waitForTimeout(3200);
const hasPrintable = await page.evaluate(() => !!document.querySelector('div[aria-hidden="true"][style*="zIndex: -9999"], div[aria-hidden="true"][style*="z-index: -9999"]'));
console.log("printable deferred mount شد:", hasPrintable);

// کلیک دانلود تصویر
const dlPromise = page.waitForEvent("download", { timeout: 40000 }).catch(() => null);
await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')][0];
  const btns = [...dlg.querySelectorAll("button")];
  const imgBtn = btns.find((b) => (b.textContent || "").includes("تصویر"));
  imgBtn?.click();
});
const dl = await dlPromise;
if (dl) {
  const path = await dl.path();
  const fs = await import("node:fs");
  const size = fs.statSync(path).size;
  console.log(`دانلود تصویر ✓ filename=${dl.suggestedFilename()} size=${(size / 1024).toFixed(0)}KB`);
  fs.copyFileSync(path, "/tmp/v248-plan-image.png");
  // صبر برای PNG واقعی (signiture)
  const head = fs.readFileSync(path).subarray(0, 8);
  console.log("PNG signature:", head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "معتبر ✓" : "نامعتبر ✗");
} else {
  console.log("دانلود تصویر ✗ — رویداد download نیامد");
}

// کلیک دانلود PDF
const dl2Promise = page.waitForEvent("download", { timeout: 90000 }).catch(() => null);
await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')][0];
  const btns = [...dlg.querySelectorAll("button")];
  const pdfBtn = btns.find((b) => (b.textContent || "").includes("PDF"));
  pdfBtn?.click();
});
const dl2 = await dl2Promise;
if (dl2) {
  const path = await dl2.path();
  const fs = await import("node:fs");
  const size = fs.statSync(path).size;
  const head = fs.readFileSync(path).subarray(0, 5).toString();
  console.log(`دانلود PDF ✓ filename=${dl2.suggestedFilename()} size=${(size / 1024).toFixed(0)}KB head="${head}"`);
  fs.copyFileSync(path, "/tmp/v248-plan-image.pdf");
} else {
  console.log("دانلود PDF ✗");
}

await page.screenshot({ path: "/tmp/v248-download-test.png" });
await browser.close();
await db.$disconnect();
process.exit(0);
