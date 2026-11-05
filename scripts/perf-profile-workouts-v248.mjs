/**
 * v248 — CPU profile باز شدن تب تمرین‌ها برای یافتن توابع سنگین
 */
import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MOBILE = process.env.MOBILE || "09123026563";
const db = await import("@prisma/client").then((m) => new m.PrismaClient());
const u = await db.user.findFirst({ where: { mobile: MOBILE }, select: { id: true } });
const secret = (process.env.SESSION_SECRET || readFileSync("db/.session-secret", "utf8")).trim();
const payload = Buffer.from(JSON.stringify({ uid: u.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Linux; Android 13; SM-A125F) Chrome/120.0.0.0 Mobile",
  viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
await ctx.addInitScript(() => { try { localStorage.setItem("fitup_tour_seen_v1", "1"); } catch {} });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

await page.goto(BASE + "/?screen=panel&tab=dashboard", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");

await page.evaluate(() => {
  const els = [...document.querySelectorAll("button, [role=button], a")];
  const el = els.find((e) => (e.textContent || "").includes("تمرین") && (e.textContent || "").length < 30 && e.offsetParent !== null);
  el?.click();
});
await page.waitForTimeout(5000);

const { profile } = await cdp.send("Profiler.stop");

// تجمیع self time بر اساس functionName+url
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const selfTime = new Map();
const total = profile.samples.length;
for (const s of profile.samples) {
  const n = nodes.get(s);
  if (!n) continue;
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} @ ${(f.url || "").split("/").slice(-2).join("/")}:${f.lineNumber}`;
  selfTime.set(key, (selfTime.get(key) || 0) + 1);
}
const top = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28);
console.log(`\n=== TOP self-time (samples=${total}, ~${(total * 0.2).toFixed(0)}ms هر سمپل @throttle4) ===`);
for (const [k, v] of top) console.log(`  ${String(v).padStart(5)}  ${k}`);

await browser.close();
await db.$disconnect();
process.exit(0);
