#!/usr/bin/env node
/** v249 — سنجش اندازهٔ DOM صفحات (هدف لایت‌هاوس: < ۱۵۰۰ عنصر) */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/exercises", "/foods", "/tdee", "/articles"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const p of pages) {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const stats = await page.evaluate(() => {
    const all = document.querySelectorAll("*").length;
    // عمق درخت
    let maxDepth = 0;
    const walk = (el, d) => { if (d > maxDepth) maxDepth = d; for (const c of el.children) walk(c, d + 1); };
    walk(document.body, 0);
    // بزرگ‌ترین زیردرخت‌ها per top-level section of main
    const main = document.querySelector("main") || document.body;
    const sections = [...main.children].slice(0, 12).map((c) => ({
      tag: c.tagName.toLowerCase(),
      cls: (c.className || "").toString().slice(0, 40),
      n: c.querySelectorAll("*").length + 1,
    })).sort((a, b) => b.n - a.n);
    return { all, maxDepth, htmlKB: Math.round(document.documentElement.outerHTML.length / 1024), sections };
  });
  console.log(`\n=== ${p} — DOM=${stats.all} (عمق ${stats.maxDepth}) HTML=${stats.htmlKB}KB`);
  for (const s of stats.sections.slice(0, 6)) console.log(`   ${s.n}\t<${s.tag} class="${s.cls}">`);
}
await browser.close();
