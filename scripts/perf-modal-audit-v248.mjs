/**
 * v248 — ممیزی دقیق عملکرد باز شدن ۴ مودال پنل + شناسایی ۴۰۴ها
 * WebView اندروید: موبایل + CPU 4x — اندازه‌گیری تپ→دیالوگ رندر + long tasks
 */
import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MOBILE = process.env.MOBILE || "09123026563";

const db = await import("@prisma/client").then((m) => new m.PrismaClient());
const u = await db.user.findFirst({ where: { mobile: MOBILE }, select: { id: true, name: true, planName: true } });
if (!u) { console.error("USER NOT FOUND"); process.exit(1); }
console.log("TEST USER:", u.name, u.planName);

const secret = (process.env.SESSION_SECRET || readFileSync("db/.session-secret", "utf8")).trim();
const payload = Buffer.from(JSON.stringify({ uid: u.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Linux; Android 13; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem("fitup_tour_seen_v1", "1"); } catch {}
});
const page = await ctx.newPage();

const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

const notFound = [];
const consoleErrors = [];
page.on("response", (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url().slice(0, 140)}`); });
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e).slice(0, 200)));

await page.goto(BASE + "/?screen=panel&tab=programs", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// ابزار اندازه‌گیری
await page.evaluate(() => {
  window.__perf = { longTasks: [] };
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__perf.longTasks.push(Math.round(e.duration));
  });
  po.observe({ entryTypes: ["longtask"], buffered: true });
});
await page.waitForTimeout(400);

// ریست کارت‌ها: اگر مودالی باز است ببند
async function ensureCleanState() {
  for (let i = 0; i < 3; i++) {
    const has = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    if (!has) break;
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="dialog"] button')];
      const close = btns.find((b) => (b.getAttribute("aria-label") || "").includes("بستن") || b.className.includes("opacity-70"));
      (close || btns[0])?.click();
    });
    await page.waitForTimeout(1100);
  }
  await page.evaluate(() => { window.__perf.longTasks = []; });
}

/** تپ روی دکمه با اسپن دقیق + اندازه‌گیری تپ→دیالوگ */
async function measureModal(name, spanText, expectTitle) {
  await ensureCleanState();
  const res = await page.evaluate(({ spanText, expectTitle }) => {
    return new Promise((resolve) => {
      const t0 = performance.now();
      // دکمه‌ای که span با متن دقیق دارد
      const spans = [...document.querySelectorAll("button span, [role=button] span")];
      const span = spans.find((s) => s.textContent?.trim() === spanText && s.offsetParent !== null);
      let btn = span?.closest("button, [role=button]");
      if (!btn) {
        // فال‌بک: aria-label حاوی متن
        const byAria = [...document.querySelectorAll("button, [role=button]")].find((e) =>
          (e.getAttribute("aria-label") || "").includes(spanText) && e.offsetParent !== null);
        btn = byAria || null;
      }
      if (!btn) { resolve({ ok: false, why: "not found: " + spanText }); return; }
      btn.click();
      // پول تا دیالوگ با عنوان مورد انتظار
      let polls = 0;
      const iv = setInterval(() => {
        polls++;
        const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
          (d.textContent || "").includes(expectTitle));
        if (dlg) {
          const t1 = performance.now();
          clearInterval(iv);
          resolve({
            ok: true,
            openMs: Math.round(t1 - t0),
            polls,
            domAfter: document.getElementsByTagName("*").length,
            dialogNodes: dlg.getElementsByTagName("*").length,
            imgs: dlg.querySelectorAll("img, video, source").length,
          });
        } else if (polls > 120) { // 6s
          clearInterval(iv);
          resolve({ ok: false, why: "timeout waiting dialog", domAfter: document.getElementsByTagName("*").length });
        }
      }, 50);
    });
  }, { spanText, expectTitle });
  // صبر برای لود کامل محتوا (اسکلتون → داده)
  await page.waitForTimeout(2500);
  const post = await page.evaluate(() => ({
    longTasks: window.__perf.longTasks.slice(),
    totalBlocked: window.__perf.longTasks.reduce((s, d) => s + d, 0),
    worst: window.__perf.longTasks.reduce((m, d) => Math.max(m, d), 0),
  }));
  console.log(`\n=== ${name} ===`);
  console.log(`  بازشدن(dialog رندر): ${res.ok ? res.openMs + "ms" : "FAIL: " + res.why}`);
  if (res.ok) console.log(`  dialog nodes: ${res.dialogNodes} | کل DOM: ${res.domAfter} | img/video داخل دیالوگ: ${res.imgs}`);
  console.log(`  longTasks در ۲.۵s بعد از باز: ${post.longTasks.length} | مجموع بلاک: ${post.totalBlocked}ms | بدترین: ${post.worst}ms`);
  return res;
}

// ─── ۱) برنامه تمرینی ───
// صبر تا کارت برنامه واقعا رندر شود (بعد از واکشی پلن)
try {
  await page.waitForFunction(() => {
    return [...document.querySelectorAll("button span")].some((s) => s.textContent?.trim() === "تمرین" && s.offsetParent !== null);
  }, { timeout: 25000 });
  console.log("کارت برنامه آماده شد ✓");
} catch { console.log("کارت برنامه در ۲۵s ظاهر نشد!"); }
await measureModal("1) مودال برنامه تمرینی", "تمرین", "برنامه تمرینی");
await page.screenshot({ path: "/tmp/v248-1-workout.png" });

// ─── ۲) برنامه غذایی ───
await measureModal("2) مودال برنامه غذایی", "تغذیه", "برنامه غذایی");
await page.screenshot({ path: "/tmp/v248-2-meal.png" });

// ─── ۳) مکمل ───
await measureModal("3) مودال مکمل", "مکمل", "برنامه مکمل");
await page.screenshot({ path: "/tmp/v248-3-supp.png" });

// ─── ۴) پروفایل → پرونده ورزشی ───
await ensureCleanState();
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button, [role=button]")].find((e) =>
    (e.getAttribute("aria-label") || "").includes("پروفایل") || (e.textContent || "").trim().startsWith("پروفایل"));
  b?.click();
});
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/v248-4a-profile.png" });
await measureModal("4) مودال پرونده ورزشی", "پرونده ورزشی", "پرونده");
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/v248-4b-sports.png" });

console.log("\n=== HTTP >=400 ===");
console.log(notFound.length ? [...new Set(notFound)].join("\n") : "هیچ ✓");
console.log("\n=== CONSOLE ERRORS ===");
console.log(consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 12).join("\n") : "صفر ✓");

await browser.close();
await db.$disconnect();
process.exit(0);
