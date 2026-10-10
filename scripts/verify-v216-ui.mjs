/* v216 — راستی‌آزمایی مرورگری (دیرکتیو مالک):
   A) بنر اتصال حذف شده: با رویدادهای offline/online/connection-restored هیچ
      «اتصال برقرار شد» / «اتصال اینترنت قطع شد» نباید دیده شود (باگ هر-ثانیه)
   B) سلامت پنل: منو باز/بسته + صفر خطای مرگبار کنسول
   C) robots.txt: دارای Sitemap + Disallow /api/ — بدون تداخل استاتیک
   D) sitemap.xml: XML سالم، تعداد>۰، صفر تکراری
   E) کد تخفیف شخصی: کاربر بدون خرید → کد + idempotent؛ کاربر اقتصادی → کد
      (معافیت personal_upsell از گیت خرید-اول — دیرکتیو مالک)
*/
import { chromium } from "playwright";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

// ─── کاربران آزمون ───
const m1 = "0916" + String(Math.floor(1_000_000 + Math.random() * 8_999_999));
const m2 = "0917" + String(Math.floor(1_000_000 + Math.random() * 8_999_999));
const u1 = await db.user.create({ data: { mobile: m1, name: "تست۲۱۶-بخرید", role: "USER", onboardingDone: true }, select: { id: true } });
const u2 = await db.user.create({ data: { mobile: m2, name: "تست۲۱۶-اقتصادی", role: "USER", onboardingDone: true, planName: "basic", planExpiresAt: new Date(Date.now() + 40 * 864e5) }, select: { id: true } });
await db.subscription.create({ data: { userId: u2.id, plan: "basic", status: "active", startDate: new Date(Date.now() - 5 * 864e5), endDate: new Date(Date.now() + 40 * 864e5), durationDays: 45, pricePaid: 350000 } });

// ─── E) کد تخفیف شخصی (API — بدون مرورگر) ───
console.log("\n─── E) کد تخفیف شخصی ──");
const secret = readFileSync("db/.session-secret", "utf8").trim();
function tokenFor(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, t: Date.now(), sv: 0 })).toString("base64url");
  return `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;
}
async function getDiscount(uid) {
  const res = await fetch(BASE + "/api/panel/personal-discount", { headers: { cookie: `sc_session=${tokenFor(uid)}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const d1a = await getDiscount(u1.id);
ok(d1a.status === 200 && d1a.body?.eligible === true && /^FIT-[A-Z0-9]{6}$/.test(d1a.body?.code ?? ""), "E1 کاربر بدون خرید → کد شخصی معتبر", d1a.body?.code ?? JSON.stringify(d1a.body));
const d1b = await getDiscount(u1.id);
ok(d1b.body?.code === d1a.body?.code, "E2 فراخوانی دوم idempotent (همان کد)");
const d2 = await getDiscount(u2.id);
ok(d2.status === 200 && d2.body?.eligible === true && /^FIT-[A-Z0-9]{6}$/.test(d2.body?.code ?? ""), "E3 کاربر اقتصادی → کد می‌گیرد (معافیت personal_upsell)", d2.body?.code ?? JSON.stringify(d2.body));

// ─── C/D) robots + sitemap ───
console.log("\n─── C/D) robots + sitemap ──");
const robots = await (await fetch(BASE + "/robots.txt")).text();
ok(robots.includes("Sitemap: https://fittup.ir/sitemap.xml"), "C1 robots دارای Sitemap");
ok(robots.includes("Disallow: /api/"), "C2 robots دارای Disallow /api/");
const sitemapText = await (await fetch(BASE + "/sitemap.xml")).text();
const urls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
ok(sitemapText.startsWith("<?xml") && urls.length > 100, `D1 sitemap XML سالم با ${urls.length} URL`);
ok(new Set(urls).size === urls.length, "D2 صفر URL تکراری");
ok(urls.some(u => u.includes("/exercise/")) && urls.some(u => u.includes("/sport/")), "D3 شامل حرکات و ورزش‌ها");

// ─── A/B) مرورگر: بنر حذف شده + سلامت پنل ───
console.log("\n─── A/B) مرورگر — بنر اتصال و سلامت پنل ──");
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile", viewport: { width: 412, height: 915 } });
await ctx.addCookies([{ name: "sc_session", value: tokenFor(u1.id), url: BASE }]);
await ctx.addInitScript(() => { try { localStorage.setItem("fitup_tour_seen_v1", "1"); } catch {} });
const page = await ctx.newPage();
const fatalErrors = [];
page.on("pageerror", (e) => fatalErrors.push(String(e).slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error" && /hydrat|Minified React error|ChunkLoad/.test(m.text())) fatalErrors.push(m.text().slice(0, 140)); });

await page.goto(BASE + "/?screen=panel", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
// تلاش مجدد — پنل ممکن است وسط کار replace/reload کلاینت داشته باشد
async function safeEval(fn, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { return await page.evaluate(fn); } catch (e) { await page.waitForTimeout(2000); }
  }
  return null;
}

// A) رویدادهای اتصال → هیچ بنری نباید ظاهر شود
await safeEval(() => {
  window.dispatchEvent(new Event("offline"));
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new CustomEvent("fitup:connection-restored"));
});
await page.waitForTimeout(1600);
const bodyText = (await safeEval(() => document.body.innerText)) ?? "";
ok(!bodyText.includes("اتصال برقرار شد"), "A1 «اتصال برقرار شد» هرگز نمایش داده نمی‌شود");
ok(!bodyText.includes("اتصال اینترنت قطع شد"), "A2 «اتصال اینترنت قطع شد» هم نمایش داده نمی‌شود");

// B) سلامت منو (بازپخش چک v215-A)
try {
  const burger = page.locator('button[aria-label="باز کردن منو"]');
  await burger.waitFor({ timeout: 45_000 });
  await burger.click({ force: true, timeout: 15_000 });
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => !!document.getElementById("mobile-nav-drawer"));
  ok(opened, "B1 منوی پنل باز شد");
} catch (e) {
  ok(false, "B1 منوی پنل باز شد", String(e).slice(0, 80));
}
ok(fatalErrors.length === 0, `B2 صفر خطای مرگبار کنسول${fatalErrors.length ? " — " + fatalErrors[0] : ""}`);

await browser.close();

// ─── پاکسازی ───
await db.userDiscountCode.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
await db.subscription.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
await db.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
const rem = await db.user.count({ where: { mobile: { in: [m1, m2] } } });
ok(rem === 0, "پاکسازی کامل کاربران آزمون");

console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
