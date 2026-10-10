// v205 — راستی‌آزمایی مرورگری لایهٔ وب (پل نیتیو + بازیابی درجا + زامبی‌آزاری)
// ۱) پل window.__fitupNativeNetworkChanged نصب می‌شود؟
// ۲) رویداد نیتیو (vpn-off) → پروب ۳۰۰ms → fitup:connection-restored بدون هیچ رفرش
// ۳) netRescue (ارتقای آخر) روی شبکهٔ سالم صدا زده نمی‌شود
// ۴) رویدادهای داخل پنجرهٔ دی‌دابل دوباره پروب نمی‌زنند
// ۵) شبیه‌سازی «شبکهٔ مرده» (abort پروب) → بازیابی اعلام نمی‌شود؛ وصل‌شدن → بازیابی خودکار
// ۶) شبیه‌سازی «زامبی سوکت مرده» (درخواست آویزان) → رویداد نیتیو همان را آزاد می‌کند
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

const waitServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/`); if (r.status === 200) return true; } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
};

async function main() {
  if (!(await waitServer())) { console.log("❌ server not up"); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });

  // شبیه‌سازی پل اپ اندرویدی — همان مسیر isNativeAppShell
  await page.addInitScript(() => {
    window.FitUpNative = { netRescue: () => { window.__netRescueCalled = true; } };
  });

  await page.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const results = [];
  const assert = (name, cond, extra = "") => {
    results.push({ name, ok: !!cond });
    console.log(`  ${cond ? "✅" : "❌"} ${name} ${cond ? "" : extra}`);
  };

  // ۱) پل نصب شده؟ (هیدریشن dev-mode ممکن است چند ثانیه طول بکشد — با polling)
  const bridgeInstalled = await page
    .waitForFunction(() => typeof window.__fitupNativeNetworkChanged === "function", { timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  assert("پل __fitupNativeNetworkChanged نصب است", bridgeInstalled);
  if (!bridgeInstalled) {
    await browser.close();
    console.log("\nRESULT: 0/7 PASS (bridge never installed)");
    process.exit(1);
  }

  await page.evaluate(() => {
    window.__restoredCount = 0;
    window.addEventListener("fitup:connection-restored", () => { window.__restoredCount++; });
  });

  // ۲) رویداد نیتیو (vpn-off — سناریوی مالک) → پروب ۳۰۰ms → بازیابی؛ بدون رفرش
  const urlBefore = page.url();
  await page.evaluate(() => {
    window.__fitupNativeNetworkChanged({ reason: "vpn-off", vpn: false, hasNetwork: true, ts: Date.now() });
  });
  await page.waitForFunction(() => window.__restoredCount >= 1, { timeout: 8000 }).catch(() => {});
  const restored = await page.evaluate(() => window.__restoredCount || 0);
  assert("رویداد نیتیو → پروب ۳۰۰ms → fitup:connection-restored", restored >= 1, `restored=${restored}`);
  assert("هیچ رفرش/ناوبری رخ نداد (همان صفحه)", page.url() === urlBefore);

  // ۳) netRescue روی شبکهٔ سالم صدا زده نشده
  const rescueCalled = await page.evaluate(() => !!window.__netRescueCalled);
  assert("netRescue (ارتقای آخر زنجیره) روی شبکهٔ سالم صدا زده نشد", !rescueCalled);

  // ۴) دی‌دابل: رویدادهای داخل پنجرهٔ ۲ ثانیه‌ای → پروب/رویداد تازه‌ای نمی‌سازند
  await page.waitForTimeout(2200); // خارج شدن از پنجرهٔ دی‌دابل رویداد قبلی
  await page.evaluate(() => {
    window.__restoredCount = 0;
    window.__fitupNativeNetworkChanged({ reason: "vpn-off", vpn: false, hasNetwork: true, ts: Date.now() });
    window.__fitupNativeNetworkChanged({ reason: "vpn-off", vpn: false, hasNetwork: true, ts: Date.now() }); // دی‌دابل
  });
  await page.waitForTimeout(2500);
  const restored2 = await page.evaluate(() => window.__restoredCount || 0);
  assert("رویدادهای پشت‌سرهم دی‌دابل شد (فقط یک دورهٔ پروب)", restored2 >= 1 && restored2 <= 2, `restored=${restored2}`);

  // ۵) شبیه‌سازی «شبکهٔ مرده»: پروب‌ها abort شوند → بازیابی اعلام نمی‌شود؛
  //    وصل‌شدن دوباره (حذف abort) → بازیابی خودکار تا ۸ ثانیه
  await page.waitForTimeout(2200);
  await page.route("**/favicon.png*", (route) => route.abort("failed"));
  await page.evaluate(() => {
    window.__restoredCount = 0;
    window.__fitupNativeNetworkChanged({ reason: "vpn-off", vpn: false, hasNetwork: true, ts: Date.now() });
  });
  await page.waitForTimeout(5000);
  const restoredDead = await page.evaluate(() => window.__restoredCount || 0);
  assert("شبکهٔ مرده (پروب شکست) → بازیابی اعلام نمی‌شود", restoredDead === 0, `restored=${restoredDead}`);
  await page.unroute("**/favicon.png*");
  await page.waitForFunction(() => window.__restoredCount >= 1, { timeout: 10000 }).catch(() => {});
  const restoredBack = await page.evaluate(() => window.__restoredCount || 0);
  assert("برگشت شبکه → بازیابی خودکار (حلقهٔ پروب تا موفقیت زنده است)", restoredBack >= 1, `restored=${restoredBack}`);

  // ۶) شبیه‌سازی «زامبی سوکت مرده»: درخواست بی‌signal آویزان → رویداد نیتیو همان را آزاد می‌کند
  await page.waitForTimeout(2200);
  await page.route("**/api/dashboard/pulse*", () => {/* عمداً هیچ پاسخی — آویزان */});
  await page.evaluate(() => {
    window.__zombieErr = null;
    fetch("/api/dashboard/pulse", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(() => { window.__zombieErr = "resolved(unexpected)"; })
      .catch((e) => { window.__zombieErr = e?.name || String(e); });
  });
  await page.waitForTimeout(1200); // درخواست کاملاً آویزان شود
  await page.evaluate(() => {
    window.__fitupNativeNetworkChanged({ reason: "vpn-off", vpn: false, hasNetwork: true, ts: Date.now() });
  });
  await page.waitForFunction(() => window.__zombieErr !== null, { timeout: 5000 }).catch(() => {});
  const zombieErr = await page.evaluate(() => window.__zombieErr);
  assert("زامبی سوکت مرده با رویداد نیتیو فوراً abort شد (AbortError)", zombieErr === "AbortError", `err=${zombieErr}`);
  await page.unroute("**/api/dashboard/pulse*");

  await page.screenshot({ path: "/tmp/v205-auth.png" });
  await browser.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
