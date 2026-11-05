#!/usr/bin/env node
/**
 * v206 — راستی‌آزمایی وب (اسموک): لایهٔ ۳ (retry شفاف fetch) نباید هیچ رفتار
 * ظاهری را عوض کرده باشد — صفحه سالم لود شود، fetch عادی کار کند، wrapper فقط
 * روی خطای شبکه‌ای GET یک‌بار retry بی‌صدا بزند و POST/abort دست‌نخورده بماند.
 * الگو: scripts/browser-verify-v205.mjs
 *
 * تکنیک: mock از قبلِ اجرای اسکریپت‌های صفحه (addInitScript) نصب می‌شود تا
 * wrapper موتور همان را به‌عنوان fetch اصلی بگیرد — شبیه‌سازی واقعی زنجیره.
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3000";
let pass = 0;
let fail = 0;

function report(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // mock fetch قبل از هر اسکریپت صفحه — wrapper موتور همین را می‌گیرد
  // شمارندهٔ توکن‌محور: فقط فراخوانی‌های خودِ پروب می‌شماریم (مصون از نویز dev-mode)
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.__fitupMockCtl = { failUrl: null, tokens: {} };
    window.fetch = async function (input, init) {
      const ctl = window.__fitupMockCtl;
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const m = /v206probe-([a-z0-9-]+)/.exec(url);
      if (m) ctl.tokens[m[1]] = (ctl.tokens[m[1]] || 0) + 1;
      if (ctl.failUrl && url.includes(ctl.failUrl)) {
        ctl.failUrl = null;
        throw new TypeError("Failed to fetch (simulated VPN switch)");
      }
      return real(input, init);
    };
  });

  // ۱) صفحهٔ اصلی سالم لود می‌شود
  const resp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  report("GET / → 200", resp && resp.ok(), `status=${resp && resp.status()}`);

  // ۲) موتور بازیابی + پل نیتیو (با انتظار هیدریشن — تا ۲۰ ثانیه)
  let engine = { installed: false, bridge: false };
  for (let i = 0; i < 20; i++) {
    engine = await page.evaluate(() => ({
      installed: !!window.__fitupNetRecovery,
      bridge: typeof window.__fitupNativeNetworkChanged === "function",
    }));
    if (engine.installed && engine.bridge) break;
    await page.waitForTimeout(1_000);
  }
  report("موتور بازیابی + پل نیتیو + لایهٔ ۳ نصب", engine.installed && engine.bridge);

  // ۳) fetch عادی سالم (GET/HEAD از زنجیرهٔ wrapper رد می‌شود)
  const okGet = await page.evaluate(async () => {
    try {
      const r = await fetch(`/favicon.png?v206probe-ok=${Date.now()}`, { method: "HEAD", cache: "no-store" });
      return { status: r.status, calls: window.__fitupMockCtl.tokens.ok || 0 };
    } catch {
      return { status: -1, calls: window.__fitupMockCtl.tokens.ok || 0 };
    }
  });
  report(
    "GET/HEAD عادی از زنجیرهٔ wrapper سالم رد می‌شود",
    okGet.status > 0 && okGet.status < 500 && okGet.calls === 1,
    `status=${okGet.status} calls=${okGet.calls}`
  );

  // ۴) شبیه‌سازی خطای شبکه در GET → retry شفاف یک‌بار (~700ms) و موفق — کاربر هیچ‌چیز نمی‌بیند
  const retryResult = await page.evaluate(async () => {
    const url = `/favicon.png?v206probe-retry=${Date.now()}`;
    const t0 = Date.now();
    try {
      window.__fitupMockCtl.failUrl = url;
      const r = await fetch(url, { cache: "no-store" });
      return { calls: window.__fitupMockCtl.tokens.retry || 0, status: r.status, ms: Date.now() - t0 };
    } catch (e) {
      return { calls: window.__fitupMockCtl.tokens.retry || 0, error: String(e), ms: Date.now() - t0 };
    }
  });
  report(
    "GET با خطای شبکه‌ای → retry شفاف یک‌بار و موفق",
    retryResult.calls === 2 && retryResult.status > 0 && retryResult.status < 500,
    `calls=${retryResult.calls} status=${retryResult.status ?? retryResult.error} ms=${retryResult.ms}`
  );

  // ۵) POST هرگز retry نمی‌شود (خط شبکهٔ عینی حفظ — بدون ریسک رکورد تکراری)
  const postResult = await page.evaluate(async () => {
    const url = `/favicon.png?v206probe-post=${Date.now()}`;
    try {
      window.__fitupMockCtl.failUrl = url;
      await fetch(url, { method: "POST", body: "{}", cache: "no-store" });
      return { calls: window.__fitupMockCtl.tokens.post || 0, surfaced: false };
    } catch {
      return { calls: window.__fitupMockCtl.tokens.post || 0, surfaced: true };
    }
  });
  report(
    "POST شکست‌خورده → بدون retry و خطا به caller می‌رسد",
    postResult.calls === 1 && postResult.surfaced,
    `calls=${postResult.calls} surfaced=${postResult.surfaced}`
  );

  // ۶) abort کاربر-ساخت retry نمی‌شود
  const abortResult = await page.evaluate(async () => {
    const url = `/favicon.png?v206probe-abort=${Date.now()}`;
    try {
      const ac = new AbortController();
      const p = fetch(url, { signal: ac.signal, cache: "no-store" });
      ac.abort();
      // mock ما TypeError می‌اندازد (شبیه‌سازی سوکت مرده) — گارد signal.aborted
      // داخل wrapper نباید اجازهٔ retry بدهد
      window.__fitupMockCtl.failUrl = url;
      await p;
      return { calls: window.__fitupMockCtl.tokens.abort || 0 };
    } catch {
      return { calls: window.__fitupMockCtl.tokens.abort || 0 };
    }
  });
  report("خطای شبکه‌ای با signal قبلاً-abort‌شده → بدون retry", abortResult.calls === 1, `calls=${abortResult.calls}`);

  // ۷) هیچ خطای مرگبار کنسول
  const fatal = consoleErrors.filter(
    (t) => /Hydration|hydration failed|Minified React error|ChunkLoadError/i.test(t)
  );
  report("صفر خطای مرگبار کنسول", fatal.length === 0, fatal.slice(0, 2).join(" | "));
} catch (e) {
  report("اجرای اسکریپت", false, String(e));
} finally {
  await browser.close();
}

console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
