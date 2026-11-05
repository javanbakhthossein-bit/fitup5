/**
 * v248 — ممیزی عملکرد: تب تمرین‌ها + پرونده ورزشی + جزئیات حرکت
 */
import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MOBILE = process.env.MOBILE || "09123026563";

const db = await import("@prisma/client").then((m) => new m.PrismaClient());
const u = await db.user.findFirst({ where: { mobile: MOBILE }, select: { id: true, name: true, planName: true } });
console.log("TEST USER:", u.name, u.planName);

const secret = (process.env.SESSION_SECRET || readFileSync("db/.session-secret", "utf8")).trim();
const payload = Buffer.from(JSON.stringify({ uid: u.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Linux; Android 13; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  viewport: { width: 412, height: 915 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
await ctx.addInitScript(() => { try { localStorage.setItem("fitup_tour_seen_v1", "1"); } catch {} });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const notFound = [];
page.on("response", (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url().slice(0, 130)}`); });

await page.goto(BASE + "/?screen=panel&tab=dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await page.evaluate(() => {
  window.__perf = { longTasks: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push(Math.round(e.duration)); })
    .observe({ entryTypes: ["longtask"], buffered: true });
});
await page.waitForTimeout(400);

async function stats(label, waitMs = 2600) {
  await page.waitForTimeout(waitMs);
  const m = await page.evaluate(() => ({
    lt: window.__perf.longTasks.slice(),
    blocked: window.__perf.longTasks.reduce((s, d) => s + d, 0),
    worst: window.__perf.longTasks.reduce((m2, d) => Math.max(m2, d), 0),
    dom: document.getElementsByTagName("*").length,
  }));
  console.log(`  ${label}: longTasks=${m.lt.length} blocked=${m.blocked}ms worst=${m.worst}ms dom=${m.dom} [${m.lt.join(",")}]`);
  await page.evaluate(() => { window.__perf.longTasks = []; });
}

// ─── ۱) تب تمرین‌ها (برنامه تمرینی روزانه) ───
console.log("\n=== 1) سوییچ به تب تمرین‌ها ===");
const t0 = Date.now();
await page.evaluate(() => {
  const els = [...document.querySelectorAll("button, [role=button], a")];
  const el = els.find((e) => (e.textContent || "").includes("تمرین") && (e.textContent || "").length < 30 && e.offsetParent !== null);
  el?.click();
});
await stats("تب تمرین‌ها باز شد", 3500);
await page.screenshot({ path: "/tmp/v248-5-workouts-tab.png" });

// ─── ۲) مودال جزئیات حرکت از تمرین‌ها ───
console.log("\n=== 2) مودال جزئیات حرکت ===");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((e) =>
    (e.getAttribute("aria-label") || "").includes("اطلاعات") || (e.getAttribute("aria-label") || "").includes("حرکت"));
  if (!b) { const b2 = [...document.querySelectorAll("button svg")].find(() => false); }
  b?.click();
});
await stats("مودال حرکت", 3000);
await page.screenshot({ path: "/tmp/v248-6-exercise-detail.png" });

// ─── ۳) پرونده ورزشی از پروفایل ───
console.log("\n=== 3) پرونده ورزشی ===");
// برگشت به داشبورد
await page.evaluate(() => { window.history.replaceState(null, "", "/?screen=panel&tab=dashboard"); });
await page.goto(BASE + "/?screen=panel&tab=dashboard", { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(7000);
// fix: بعد از goto تازه، سند جدید است — observer عملکرد باید دوباره نصب شود
await page.evaluate(() => {
  window.__perf = { longTasks: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push(Math.round(e.duration)); })
    .observe({ entryTypes: ["longtask"], buffered: true });
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button, [role=button]")].find((e) =>
    (e.getAttribute("aria-label") || "").includes("پروفایل") || (e.textContent || "").trim().startsWith("پروفایل"));
  b?.click();
});
await stats("اورلی پروفایل", 2500);
await page.screenshot({ path: "/tmp/v248-7-profile.png" });
// دکمه مشاهده پرونده ورزشی (aria-label)
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("پرونده ورزشی"));
  b?.click();
});
await stats("مودال پرونده ورزشی", 3500);
await page.screenshot({ path: "/tmp/v248-8-sports.png" });

console.log("\n=== HTTP>=400 ===");
console.log(notFound.length ? [...new Set(notFound)].join("\n") : "هیچ ✓");
await browser.close();
await db.$disconnect();
process.exit(0);
