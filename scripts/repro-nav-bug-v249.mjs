#!/usr/bin/env node
/**
 * v249 — بازتولید باگ ناوبری «برنامه‌های رایگان» (گزارش مالک)
 * سناریو: صفحه اصلی → اسکرول به پایین → بخش ابزارهای رایگان → کلیک
 * «برنامه رایگان بگیر» → /free-programs → کلیک لوگو/هوم در ToolsNav
 * انتظار درست: ناوبری واقعی به «/» و رندر لندینگ.
 * باگ گزارش‌شده: URL می‌رود «/» ولی صفحه همان /free-programs می‌ماند.
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
let pass = 0, fail = 0;
function report(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // موبایل — اندازه اپ
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

  // ۱) صفحه اصلی
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500); // هیدریشن
  report("خانه لود شد", true, await page.title());

  // ۲) اسکرول به بخش ابزارهای رایگان (کارت ویژه برنامه‌های رایگان)
  const card = page.locator('a[href="/free-programs"]').first();
  const cardCount = await page.locator('a[href="/free-programs"]').count();
  report("کارت «برنامه رایگان بگیر» در صفحه اصلی هست", cardCount > 0, `count=${cardCount}`);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  report("صفحه اصلی اسکرول شده", scrollBefore > 300, `scrollY=${scrollBefore}`);

  // ۳) کلیک روی کارت → ورود کلاینتی به /free-programs (بدون رفرش کامل)
  await card.click();
  await page.waitForTimeout(2500);
  const path = await page.evaluate(() => window.location.pathname);
  report("وارد /free-programs شدیم", path === "/free-programs", `path=${path}`);

  // ۴) چک اسکرول ورود (فلیکر/گیج‌زدن گزارش مالک): صفحه باید از بالا باز شود
  const entryScroll = await page.evaluate(() => window.scrollY);
  report("ورود به free-programs از بالای صفحه (اسکرول=0)", entryScroll < 50, `scrollY=${entryScroll}`);

  const h1 = await page.locator("h1").first().textContent();
  report("H1 صفحه free-programs", (h1 || "").includes("بدنسازی رایگان"), (h1 || "").slice(0, 60));

  // ۵) کلیک لوگوی فیتاپ در ToolsNav (اولین دکمه هدر فیکس)
  const nav = page.locator("header.fixed").first();
  await nav.locator("button").first().click();
  await page.waitForTimeout(2000);

  const afterLogo = await page.evaluate(() => ({
    path: window.location.pathname,
    h1: document.querySelector("h1")?.textContent || "",
    hasLandingHero: !!document.querySelector("[data-landing]") || (document.body.innerText.includes("هر بدنی فیتاپ میخواد")),
  }));
  report("بعد کلیک لوگو → مسیر «/»", afterLogo.path === "/", `path=${afterLogo.path}`);
  report("بعد کلیک لوگو → لندینگ واقعاً رندر شده", afterLogo.h1.includes("فیتاپ") === false || afterLogo.hasLandingHero, `h1=${afterLogo.h1.slice(0, 50)}`);
  report("بعد کلیک لوگو → صفحه دیگر free-programs نیست", !afterLogo.h1.includes("بدنسازی رایگان"), `h1=${afterLogo.h1.slice(0, 50)}`);

  // ۶) دکمه هوم (سمت چپ هدر) — دوباره از مسیر طولانی
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator('a[href="/free-programs"]').first().click();
  await page.waitForTimeout(2000);
  await page.locator("header.fixed .h-16 > button").first().click(); // دکمه هوم (فرزند مستقیم ردیف هدر)
  await page.waitForTimeout(2000);
  const afterHome = await page.evaluate(() => ({
    path: window.location.pathname,
    h1: document.querySelector("h1")?.textContent || "",
  }));
  report("بعد کلیک هوم → مسیر «/»", afterHome.path === "/", `path=${afterHome.path}`);
  report("بعد کلیک هوم → لندینگ رندر شده", !afterHome.h1.includes("بدنسازی رایگان"), `h1=${afterHome.h1.slice(0, 50)}`);

  // خطاهای کنسول
  const realErrors = consoleErrors.filter((e) => !e.includes("Download the React DevTools") && !e.includes("third-party"));
  report("بدون خطای کنسول بحرانی", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(`\n=== نتیجه: ${pass} PASS / ${fail} FAIL ===`);
  process.exitCode = fail > 0 ? 1 : 0;
} finally {
  await browser.close();
}
