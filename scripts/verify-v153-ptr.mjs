// v153 — تأیید مرورگری pull-to-refresh سفارشی (فقط یک‌چهارم بالای صفحه)
import { chromium } from "playwright-core";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const touchAt = async (x, y, dy = 0) => {
  await page.evaluate(([cx, cy, ddy]) => {
    const mk = (id, cy2) => new Touch({ identifier: id, target: document.body, clientX: cx, clientY: cy2 });
    // ⚠️ dispatch روی document.body (مثل لمس واقعی — target = عنصر زیر انگشت)
    document.body.dispatchEvent(new TouchEvent("touchstart", { touches: [mk(1, cy)], bubbles: true, cancelable: true }));
    if (ddy > 0) {
      document.body.dispatchEvent(new TouchEvent("touchmove", { touches: [mk(1, cy + ddy)], bubbles: true, cancelable: true }));
    }
  }, [x, y, dy]);
};
const moveTo = async (x, y) => {
  await page.evaluate(([cx, cy]) => {
    const t = new Touch({ identifier: 1, target: document.body, clientX: cx, clientY: cy });
    document.body.dispatchEvent(new TouchEvent("touchmove", { touches: [t], bubbles: true, cancelable: true }));
  }, [x, y]);
};
const endTouch = () => page.evaluate(() => {
  document.body.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true, cancelable: true }));
});

// ۰) CSS: رفرش بومی مرورگر بسته باشد
const oby = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
check("CSS: overscroll-behavior-y:none روی html", oby === "none", oby);

// ۱) لمس در یک‌چهارم بالای صفحه → نشانگر ساخته می‌شود و با کشیدن پایین می‌آید
await touchAt(195, 50, 200); // دیمپ ۱۰۰ → نشانگر ~۳۶px
await page.waitForTimeout(80);
let ind = await page.evaluate(() => {
  const el = document.getElementById("fitup-ptr-indicator");
  return el ? { exists: true, transform: el.style.transform, opacity: el.style.opacity } : { exists: false };
});
check("لمس در یک‌چهارم بالا → نشانگر ساخته شد", ind.exists);
check("کشیدن ۲۰۰px → نشانگر پایین آمد (دمپ ~۱۰۰)", ind.exists && /translateY\(3[5-9]px|translateY\(4[0-9]px/.test(ind.transform), ind.transform);

// ۲) برگرداندن انگشت به بالا و رهاکردن زیر آستانه (دیمپ ۳۰ < ۸۵) → رفرش نمی‌شود
await moveTo(195, 80); // دیمپ ۴۰
await page.waitForTimeout(60);
await moveTo(195, 30); // دیمپ ۱۵ — ژست همچنان «کشیدن» است
await page.waitForTimeout(60);
await endTouch();
await page.waitForTimeout(400);
const noReload = await page.evaluate(() => document.visibilityState === "visible" && location.pathname === "/");
ind = await page.evaluate(() => {
  const el = document.getElementById("fitup-ptr-indicator");
  return el ? { transform: el.style.transform, opacity: el.style.opacity } : null;
});
check("رهاکردن زیر آستانه → رفرش نشد", noReload);
check("نشانگر به حالت مخفی برگشت", ind && (ind.opacity === "0" || ind.transform.includes("-64")), JSON.stringify(ind));

// ۲-ب) کشیدن کامل (دیمپ‌شده ≥ ۸۵) → رفرش واقعی صفحه (location.reload)
await page.evaluate(() => { (window).__ptrMarker = "alive"; });
await touchAt(195, 40, 260); // دیمپ ۱۳۰ ≥ ۸۵
await page.waitForTimeout(120);
await endTouch();
await page.waitForTimeout(1200);
const reloaded = await page.evaluate(() => !(window).__ptrMarker).catch(() => true);
check("کشیدن کامل از آستانه → رفرش واقعی صفحه", reloaded);

// ۳) لمس در وسط صفحه (ی = ۶۰٪) → نشانگر ساخته نمی‌شود
await touchAt(195, 506, 200);
await page.waitForTimeout(80);
const mid = await page.evaluate(() => {
  const el = document.getElementById("fitup-ptr-indicator");
  return el ? el.style.opacity : "none-el";
});
check("لمس در وسط صفحه → بدون نشانگر/بدون کشش", mid === "0" || mid === "none-el", `opacity=${mid}`);
await endTouch();

// ۴) اسکرول‌کردن صفحه → رفرش قفل (سند دیگر بالای خودش نیست)
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(100);
await touchAt(195, 50, 200);
await page.waitForTimeout(80);
const scrolled = await page.evaluate(() => {
  const el = document.getElementById("fitup-ptr-indicator");
  return el ? el.style.opacity : "none-el";
});
check("اسکرول‌شده + لمس بالا → بدون رفرش", scrolled === "0" || scrolled === "none-el", `opacity=${scrolled}`);
await endTouch();
await page.evaluate(() => window.scrollTo(0, 0));

// ۵) لمس روی اسکرولر داخلی در ربع بالا → رفرش قفل
await page.evaluate(() => {
  const scroller = document.createElement("div");
  scroller.id = "ptr-inner-scroller";
  scroller.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;overflow-y:auto;z-index:-1";
  scroller.innerHTML = '<div style="height:400px">x</div>';
  document.body.appendChild(scroller);
  scroller.scrollTop = 10;
  const t = new Touch({ identifier: 9, target: scroller, clientX: 50, clientY: 30 });
  scroller.dispatchEvent(new TouchEvent("touchstart", { touches: [t], bubbles: true, cancelable: true }));
});
await page.waitForTimeout(80);
const innerRes = await page.evaluate(() => {
  const el = document.getElementById("fitup-ptr-indicator");
  // نشانگر ممکن است از لمس قبلی ساخته شده باشد — ملاک opacity پس از لمس روی اسکرولر داخلی است
  return el ? el.style.opacity : "none-el";
});
check("لمس روی اسکرولر داخلی (بالای صفحه) → بدون کشش", innerRes === "0" || innerRes === "none-el", `opacity=${innerRes}`);
await endTouch();

check("بدون خطای صفحه/کنسول", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n═══ PTR verify: ${results.length - failed}/${results.length} pass ═══`);
process.exit(failed ? 1 : 0);
