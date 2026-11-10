#!/usr/bin/env node
/**
 * v249 — راستی‌آزمایی جامع مرورگری (اسموک نهایی قبل از بسته‌بندی)
 * پوشش: باگ ناوبری فیکس‌شده، بانک حرکات/غذاها (دسته‌بندی + جستجو + نمایش بیشتر)،
 * llms.txt، اسکیماها، متای /tdee، عنوان مقاله، سلامت لندینگ/پرداخت، فوتر چسبان.
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
let pass = 0, fail = 0;
function report(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
/** GET با ریتری — سرور dev زیر فشار کامپایل ممکن است سوکت را قطع کند */
async function getRetry(path, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await page.request.get(BASE + path);
      if (r.status() < 500) return r;
    } catch (e) { lastErr = e; }
    await new Promise((res) => setTimeout(res, 4000));
  }
  if (lastErr) throw lastErr;
  return await page.request.get(BASE + path);
}
try {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

  // ─── ۱) باگ ناوبری گزارش مالک: از صفحه اصلی (اسکرول‌شده) → free-programs → لوگو/هوم ───
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  // هیدریشن قطعی: page-client هنگام mount فلگ می‌گذارد — بدون حدس زمانی
  await page.waitForFunction(() => (window).__fitupSpaMounted === true, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const card = page.locator('a[href="/free-programs"]').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await card.click();
  // ناوبری کلاینتی در dev ممکن است چند ثانیه کامپایل مسیر طول بکشد — پول تا ۱۵s
  let p1 = "";
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1500);
    p1 = await page.evaluate(() => location.pathname);
    if (p1 === "/free-programs") break;
  }
  report("۱-۱ ورود کلاینتی به /free-programs", p1 === "/free-programs", `path=${p1}`);
  await page.locator("header.fixed .h-16 > button").first().click(); // لوگو
  await page.waitForTimeout(1800);
  const afterLogo = await page.evaluate(() => ({ p: location.pathname, h1: document.querySelector("h1")?.textContent || "" }));
  report("۱-۲ کلیک لوگو → «/» + لندینگ واقعاً رندر", afterLogo.p === "/" && !afterLogo.h1.includes("بدنسازی رایگان"), `path=${afterLogo.p}`);

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window).__fitupSpaMounted === true, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.locator('a[href="/free-programs"]').first().click();
  let pHome = "";
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1500);
    pHome = await page.evaluate(() => location.pathname);
    if (pHome === "/free-programs") break;
  }
  await page.locator("header.fixed .h-16 > button").first().click(); // دکمه هوم
  await page.waitForTimeout(2500);
  const afterHome = await page.evaluate(() => ({ p: location.pathname, h1: document.querySelector("h1")?.textContent || "" }));
  report("۱-۳ کلیک هوم → «/» + لندینگ رندر", afterHome.p === "/" && !afterHome.h1.includes("بدنسازی رایگان"), `path=${afterHome.p}`);

  // دکمه‌های نوار ابزارها روی free-programs (بین ابزارها جابجایی — ردیف موبایل)
  await page.goto(BASE + "/free-programs", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // روی موبایل (۳۹۰px) ناو دسکتاپ مخفی است؛ دکمه‌های ابزار در ردیف دوم هدرند (sm:hidden)
  const toolBtn = page.locator("header.fixed div.sm\\:hidden button", { hasText: "محاسبه‌گر کالری" }).first();
  await toolBtn.click();
  await page.waitForTimeout(2000);
  report("۱-۴ جابجایی ابزار از نوار → /tdee", (await page.evaluate(() => location.pathname)) === "/tdee");

  // ─── ۲) بانک حرکات: دسته‌بندی + نمایش بیشتر + جستجو ───
  await page.goto(BASE + "/exercises", { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);
  let domStats = await page.evaluate(() => ({ dom: document.querySelectorAll("*").length, cards: document.querySelectorAll('a[href^="/exercise/"]').length }));
  report("۲-۱ DOM حرکات < ۱۵۰۰", domStats.dom < 1500, `dom=${domStats.dom}`);
  report("۲-۲ دستهٔ اولیه ۴۸ کارت در SSR", domStats.cards === 48, `cards=${domStats.cards}`);
  const moreBtn = page.locator("button", { hasText: "حرکت بیشتر" }).first();
  report("۲-۳ دکمهٔ «نمایش بیشتر» هست", await moreBtn.isVisible().catch(() => false));
  // فلیک‌محور: کلیک فقط بعد از هیدریشن اثر دارد — تا ۵ بار تلاش با صبر
  for (let attempt = 0; attempt < 5; attempt++) {
    await moreBtn.click().catch(() => {});
    await page.waitForTimeout(2200);
    domStats = await page.evaluate(() => ({ cards: document.querySelectorAll('a[href^="/exercise/"]').length }));
    if (domStats.cards > 48) break;
  }
  report("۲-۴ بعد کلیک → ۹۶ کارت", domStats.cards === 96, `cards=${domStats.cards}`);
  const searchInput = page.getByLabel("جستجوی حرکات");
  await searchInput.fill("اسکوات");
  await page.waitForTimeout(1200);
  const s1 = await page.evaluate(() => document.querySelectorAll('a[href^="/exercise/"]').length);
  report("۲-۵ جستجوی «اسکوات» نتیجه دارد", s1 > 0 && s1 < 96, `hits=${s1}`);
  await searchInput.fill(""); // پاک‌کردن جستجو قبل از فیلتر عضله
  await page.waitForTimeout(800);
  const muscleBtn = page.locator("button", { hasText: "سینه" }).first();
  await muscleBtn.click();
  await page.waitForTimeout(800);
  const s2 = await page.evaluate(() => document.querySelectorAll('a[href^="/exercise/"]').length);
  report("۲-۶ فیلتر عضله کار می‌کند", s2 > 0, `hits=${s2}`);
  // ItemList JSON-LD همهٔ حرکات
  const itemList = await page.evaluate(() => {
    const s = [...document.querySelectorAll('script[type="application/ld+json"]')].map((x) => x.textContent).join("");
    return (s.match(/"@type":"ItemList"/g) || []).length;
  });
  report("۲-۷ ItemList کامل در JSON-LD", itemList >= 1, `count=${itemList}`);

  // ─── ۳) بانک غذاها: دسته‌بندی + نمایش بیشتر + جستجو ───
  await page.goto(BASE + "/foods", { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);
  domStats = await page.evaluate(() => ({ dom: document.querySelectorAll("*").length, foods: document.querySelectorAll('a[href^="/food/"]').length }));
  report("۳-۱ DOM غذاها < ۷۰۰", domStats.dom < 700, `dom=${domStats.dom}`);
  report("۳-۲ دستهٔ اولیه ۶۰ غذا در SSR", domStats.foods === 60, `foods=${domStats.foods}`);
  const moreFood = page.locator("button", { hasText: "غذای بیشتر" }).first();
  await moreFood.click();
  await page.waitForTimeout(1000);
  const f2 = await page.evaluate(() => document.querySelectorAll('a[href^="/food/"]').length);
  report("۳-۳ بعد کلیک → ۱۲۰ غذا", f2 === 120, `foods=${f2}`);
  const foodSearch = page.getByLabel("جستجوی غذا");
  await foodSearch.fill("آب");
  await page.waitForTimeout(1000);
  const f3 = await page.evaluate(() => document.querySelectorAll('a[href^="/food/"]').length);
  report("۳-۴ جستجوی غذا کار می‌کند", f3 > 0 && f3 < 120, `hits=${f3}`);

  // ─── ۴) llms.txt ───
  for (const f of ["/llms.txt", "/llms-full.txt"]) {
    const r = await page.request.get(BASE + f);
    const t = await r.text();
    report(`۴ ${f} → 200 + محتوا`, r.status() === 200 && t.length > 1000 && t.includes("فیتاپ"), `${r.status()} · ${t.length}B`);
  }
  const robots = await (await getRetry("/robots.txt")).text();
  report("۴- robots.txt سالم", robots.includes("Sitemap:") && robots.includes("Disallow: /api/"));

  // ─── ۵) اسکیماها ───
  const home = await getRetry("/").then((r) => r.text());
  report("۵-۱ صفحه اصلی: WebSite با publisher دارای logo", home.includes('"@type":"WebSite"') && /"publisher":\{"@type":"Organization","@id":"https:\/\/fittup\.ir\/#organization","name":"فیتاپ","url":"https:\/\/fittup\.ir","logo":"https:\/\/fittup\.ir\/fitup-logo\.png"/.test(home.replace(/\\u/g, "\\u")));
  const arts = await getRetry("/articles").then((r) => r.text());
  report("۵-۲ مجله: BreadcrumbList", arts.includes('"@type":"BreadcrumbList"'));
  const art = await getRetry("/article/shilajit-for-testosterone-evidence-and-dosage").then((r) => r.text());
  report("۵-۳ مقاله: image مطلق https", art.includes('"image":"https://fittup.ir/uploads/'));
  report("۵-۴ مقاله: author با url+logo", art.includes('"author":{"@type":"Organization","@id":"https://fittup.ir/#organization","name":') && art.includes('"logo":"https://fittup.ir/fitup-logo.png"'));
  report("۵-۵ مقاله: mainEntityOfPage", art.includes('"mainEntityOfPage":{"@type":"WebPage","@id":"https://fittup.ir/article/'));
  const artTitle = (art.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  report("۵-۶ مقاله: عنوان بدون «| فیتاپ | فیتاپ»", (artTitle.match(/فیتاپ/g) || []).length === 1, artTitle.slice(0, 50));
  const tdee = await getRetry("/tdee").then((r) => r.text());
  const rawDesc = (tdee.match(/<meta name="description" content="([^"]+)"/) || [])[1] || "";
  report("۵-۷ /tdee: توضیحات SSR = نسخهٔ بلند مشترک", rawDesc.includes("آب مورد نیاز بدن"), `${rawDesc.length} chars`);

  // ─── ۶) سلامت لندینگ و قیف پرداخت (بدون تراکنش) ───
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2200);
  const hasPricing = await page.evaluate(() => !!document.querySelector("#pricing"));
  report("۶-۱ سکشن پلن‌ها (#pricing) هست", hasPricing);
  // کلیک روی اولین دکمهٔ انتخاب پلن (مهمان) → باید به auth برود
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const planBtn = page.locator("#pricing button", { hasText: "انتخاب پلن" }).first();
  if (await planBtn.isVisible().catch(() => false)) {
    await planBtn.click();
    await page.waitForTimeout(1800);
    const nav = await page.evaluate(() => ({ p: location.pathname + location.search, auth: document.body.innerText.includes("ورود") || document.body.innerText.includes("شماره") }));
    report("۶-۲ مهمان → انتخاب پلن → صفحهٔ ورود", nav.p.includes("screen=auth") || nav.auth, nav.p);
  } else {
    report("۶-۲ مهمان → انتخاب پلن → صفحهٔ ورود", false, "دکمه پیدا نشد");
  }
  // سلامت API پرداخت (بدون پارامتر → نباید 500 بدهد)
  const payResp = await page.request.post(BASE + "/api/payment/checkout", { data: {} }).catch(() => null);
  report("۶-۳ /api/payment/checkout پاسخ می‌دهد (بدون 500)", !!payResp && payResp.status() < 500, `status=${payResp && payResp.status()}`);

  // ─── ۷) فوتر چسبان و کنسول (روی صفحهٔ عمومی — نه auth) ───
  await page.goto(BASE + "/foods", { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(1500);
  const footerCheck = await page.evaluate(() => {
    const f = document.querySelector("footer");
    if (!f) return { has: false };
    const r = f.getBoundingClientRect();
    return { has: true, visible: r.height > 0 };
  });
  report("۷-۱ فوتر هست", footerCheck.has && footerCheck.visible);
  const realErrors = consoleErrors.filter((e) => !e.includes("404") && !e.includes("Download the React DevTools"));
  report("۷-۲ بدون خطای کنسول بحرانی", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

  console.log(`\n=== نتیجهٔ نهایی v249: ${pass} PASS / ${fail} FAIL ===`);
  process.exitCode = fail > 0 ? 1 : 0;
} finally {
  await browser.close();
}
