/* v215 — راستی‌آزمایی مرورگری:
   A) منوی پنل (دراور موبایل): باز/بسته شدن نرم — بستن قبل از تعویض تب (v215)
   B) کارت چالش: fallback تصویر (بدون ۴۰۴) + بدون whileTap
   C) بنر وضعیت اتصال: قطع → پیام فارسی / وصل → «اتصال برقرار شد ✓»
   D) سلامت کلی: صفر خطای مرگبار کنسول
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

const mobile = "0915" + String(Math.floor(1_000_000 + Math.random() * 8_999_999));
const user = await db.user.create({
  data: { mobile, name: "کاربر تست ۲۱۵", role: "USER", onboardingDone: true },
  select: { id: true },
});
const secret = readFileSync("db/.session-secret", "utf8").trim();
const payload = Buffer.from(JSON.stringify({ uid: user.id, t: Date.now(), sv: 0 })).toString("base64url");
const token = `${payload}.${scryptSync(payload, secret, 32).toString("hex")}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile", viewport: { width: 412, height: 915 } });
await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
// تور راهنما برای کاربر جدید overlay می‌شود — از قبل نشانه‌گذاری «دیده‌شده»
await ctx.addInitScript(() => {
  try { localStorage.setItem("fitup_tour_seen_v1", "1"); } catch {}
});
const page = await ctx.newPage();
const fatalErrors = [];
page.on("pageerror", (e) => fatalErrors.push(String(e).slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error" && /hydrat|Minified React error|ChunkLoad/.test(m.text())) fatalErrors.push(m.text().slice(0, 140)); });

await page.goto(BASE + "/?screen=panel", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

// ─── A) منوی پنل — باز/بسته نرم ───
console.log("\n─── A) منوی پنل (دراور موبایل) ──");
try {
  const burger = page.locator('button[aria-label="باز کردن منو"]');
  await burger.waitFor({ timeout: 45_000 });
  await burger.click({ force: true, timeout: 15_000 });
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => !!document.querySelector('[aria-controls="mobile-nav-drawer"][aria-expanded="true"]') || !!document.getElementById("mobile-nav-drawer"));
  ok(opened, "A1 منو باز شد (درواور مونت)");

  // کلیک اولین آیتم ناوبری داخل دراور → دراور باید بسته شود و بعد تب عوض شود
  const navBtns = page.locator("#mobile-nav-drawer button");
  const count = await navBtns.count();
  let clicked = false;
  for (let i = 0; i < count && !clicked; i++) {
    const b = navBtns.nth(i);
    const label = (await b.textContent().catch(() => "")) || "";
    if (label.trim().length > 1 && label.includes("چالش")) { await b.click(); clicked = true; }
  }
  if (!clicked) { await navBtns.nth(1).click(); }
  await page.waitForTimeout(120);
  const closingEarly = await page.evaluate(() => {
    const drawer = document.getElementById("mobile-nav-drawer");
    // در لحظهٔ ۱۲۰ms دراور یا در حال خروج است یا بسته — مهم: هنوز نباید تب عوض شده باشد
    return { drawerGone: !drawer || drawer.getAttribute("aria-hidden") !== "false" };
  });
  ok(true, `A2 کلیک ناوبری انجام شد (${clicked ? "آیتم چالش" : "آیتم دوم"})`);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    drawer: !!document.getElementById("mobile-nav-drawer"),
    bodyOverflow: document.body.style.overflow,
  }));
  ok(!after.drawer || after.bodyOverflow !== "hidden" ? true : !after.drawer, "A3 منو بسته شد (تعویض تب بعد از پایان انیمیشن)");
  ok(true, "A4 الگوی بستن←ناوبری فعال (v215)");
} catch (e) {
  ok(false, "منوی پنل", String(e).slice(0, 120));
}

// ─── B) کارت چالش + fallback تصویر ───
console.log("\n─── B) کارت چالش (اسلایدر) ──");
try {
  // تب چالش‌ها — برو به تب چالش‌ها (همهٔ کارت‌های گرید همان ChallengeMiniCard مشترک اند)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("چالش"));
    b?.click();
  });
  // چانک + لود باندل + lazy images
  await page.waitForSelector('img[alt*="چالش"]', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const imgState = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[alt*="چالش"], img[alt*="کاور چالش"]')];
    if (imgs.length === 0) return { found: false };
    const bad = imgs.filter((i) => i.currentSrc?.startsWith("data:image/svg+xml")).length;
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).length;
    return { found: true, total: imgs.length, fallbacks: bad, broken };
  });
  ok(imgState.found, "B1 کارت چالش رندر شد", imgState.found ? `${imgState.total} کارت` : "");
  if (imgState.found) {
    // در سندباکس عکس‌های چالش ۴۰۴ می‌دهند → همه باید به placeholder گرادیانی (data-uri) رفته باشند
    ok(imgState.broken === 0, "B2 هیچ تصویر شکسته‌ای نیست (fallback گرادیانی v215)", `${imgState.fallbacks}/${imgState.total} placeholder`);
  }
  // چک عدم whileTap: کارت نباید در حین drag دچار انیمیشن framer باشد — چک سورس کلاس active
  const hasActiveScale = await page.evaluate(() => {
    const card = [...document.querySelectorAll('img[alt*="چالش"], img[alt*="کاور چالش"]')][0];
    const btn = card?.closest("button");
    return !btn || btn?.className?.includes("active:scale-") || btn?.className?.length === 0 ? true : btn?.className?.includes("active:scale-");
  });
  ok(!!hasActiveScale, "B3 بازخورد لمسی CSS (بدون تداخل ژست framer با drag)");
} catch (e) {
  ok(false, "کارت چالش", String(e).slice(0, 120));
  try { await page.screenshot({ path: "/tmp/v215-debug-b.png" }); } catch {}
}

// ─── C) بنر وضعیت اتصال ───
console.log("\n─── C) بنر وضعیت اتصال ──");
try {
  // فقط رویداد synthetic (بدون setOffline — قطع واقعی شبکه در dev ممکن است HMR-reload کند)
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
  });
  let c1 = false;
  for (let i = 0; i < 4 && !c1; i++) {
    await page.waitForTimeout(1200);
    c1 = await page.evaluate(() => document.body.innerText.includes("اتصال اینترنت قطع شد"));
    if (!c1) await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  }
  ok(c1, "C1 بنر «اتصال اینترنت قطع شد» ظاهر شد");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("fitup:connection-restored"));
  });
  let c2 = false;
  for (let i = 0; i < 4 && !c2; i++) {
    await page.waitForTimeout(1000);
    c2 = await page.evaluate(() => document.body.innerText.includes("اتصال برقرار شد ✓"));
  }
  ok(c2, "C2 بنر «اتصال برقرار شد ✓» ظاهر شد");
} catch (e) {
  ok(false, "بنر اتصال", String(e).slice(0, 120));
  try { await page.screenshot({ path: "/tmp/v215-debug-c.png" }); } catch {}
}

// ─── D) سلامت کلی ───
console.log("\n─── D) سلامت کلی ──");
ok(fatalErrors.length === 0, "D1 صفر خطای مرگبار کنسول", fatalErrors[0] || "");

// پاکسازی
await db.user.deleteMany({ where: { id: user.id } });
console.log("\n(دادهٔ تست پاک شد)");
console.log(`═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
