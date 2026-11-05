/** v201 — تست متمرکز کلاستر مدال خرید (C / C+ / C2) با سرور تازه */
import { chromium } from "playwright-core";
const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const MOBILE = "09121112233";
const ANALYSIS_MOCK = {
  ok: true, analysis: "تحلیل تستی", bmi: 24.2, bmr: 1650, tdee: 2300,
  macros: { calories: 2000, protein: 150, carbs: 220, fat: 60 },
  planRecommendation: { recommendedPlan: "standard", reason: "تست", reasons: ["۱", "۲", "۳"] },
  profile: { weight: 78, targetWeight: 70, goal: "lose", workoutDays: 3, workoutPlace: "gym", dietType: "normal" },
};
const waitServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/`); if (r.status === 200) return true; } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
};
async function main() {
  const results = [];
  const assert = async (name, cond, extra = "") => {
    results.push({ name, ok: !!cond });
    console.log(`  ${cond ? "✅" : "❌"} ${name} ${cond ? "" : extra || ""}`);
  };
  await waitServer();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.user.deleteMany({ where: { mobile: MOBILE } });
  await db.otpCode.create({ data: { mobile: MOBILE, code: "1234", expiresAt: new Date(Date.now() + 600000), attempts: 0 } });
  const r = await fetch(`${BASE}/api/auth/verify-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobile: MOBILE, code: "1234" }) });
  const sc = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("sc_session="));
  const u = await db.user.findUnique({ where: { mobile: MOBILE } });
  await db.user.update({ where: { id: u.id }, data: { onboardingDone: true } });
  await db.$disconnect();

  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  await ctx.addCookies([{ name: "sc_session", value: sc.split("=")[1], domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  await page.route("**/api/onboarding/analysis**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ANALYSIS_MOCK) }));

  const badge = page.getByText("گام ۱ — تحلیل و آنالیز بدن").first();
  const gateway = page.getByText("رفتن به درگاه پرداخت").first();
  const goto2 = async (url) => {
    for (let i = 0; i < 6; i++) {
      try { return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 }); }
      catch { await waitServer(); }
    }
    throw new Error("goto failed");
  };
  const waitVisible = async (loc, ms = 45_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await loc.isVisible().catch(() => false)) return true; await page.waitForTimeout(600); }
    return false;
  };
  const seed = (withPlan) => page.evaluate((wp) => {
    localStorage.setItem("fitup_ap", "1");
    document.cookie = "fitup_ap=1; path=/; max-age=2592000; samesite=lax";
    if (wp) localStorage.setItem("fitup_ap_plan", "standard"); else localStorage.removeItem("fitup_ap_plan");
  }, withPlan);
  const phase = () => page.evaluate(() => ({ ls: localStorage.getItem("fitup_ap"), plan: localStorage.getItem("fitup_ap_plan") }));
  const nativeBack = () => page.evaluate(() => window.__fitupNativeBack && window.__fitupNativeBack());

  // ورود اولیه (تا context صفحه ساخته شود) سپس seed
  await goto2(`${BASE}/?screen=panel`);
  await page.waitForTimeout(2000);

  // C — مدال باز → بک فقط مدال را می‌بندد
  await seed(true);
  await goto2(`${BASE}/?screen=panel`);
  await page.waitForFunction(() => typeof window.__fitupNativeBack === "function", undefined, { timeout: 90_000 }).catch(() => {});
  const m1 = await waitVisible(gateway);
  await assert("C: بازگشت به تحلیل + مدال خرید باز", m1);
  await nativeBack();
  await page.waitForTimeout(1200);
  const st1 = await phase();
  await assert("C: بک نیتیو → مدال بسته", !(await gateway.isVisible().catch(() => false)));
  await assert("C: روی تحلیل ماندیم", await badge.isVisible().catch(() => false));
  await assert("C: فاز صفحه دست‌نخورده", st1.ls === "1", JSON.stringify(st1));

  // C+ — باز شدن دوباره با فلگ مدال → همان مدال
  await seed(true);
  await goto2(`${BASE}/?screen=panel`);
  await page.waitForFunction(() => typeof window.__fitupNativeBack === "function", undefined, { timeout: 90_000 }).catch(() => {});
  const m2 = await waitVisible(gateway);
  await assert("C+: باز شدن دوباره → همان تحلیل + همان مدال (هم‌ارز بازگشت از درگاه)", m2);

  // C2 — کلیک UI → مدال → بک
  await nativeBack();
  await page.waitForTimeout(1200);
  const buyBtn = page.locator('button[aria-label^="خرید پلن"]').first();
  if (await waitVisible(buyBtn, 30_000)) {
    try { await buyBtn.scrollIntoViewIfNeeded({ timeout: 10_000 }); } catch {}
    await page.waitForTimeout(500);
    try { await buyBtn.click({ timeout: 15_000 }); } catch { try { await buyBtn.dispatchEvent("click"); } catch {} }
    const m3 = await waitVisible(gateway, 25_000);
    await assert("C2: کلیک خرید UI → مدال باز شد", m3);
    if (m3) {
      await nativeBack();
      await page.waitForTimeout(1200);
      const st2 = await phase();
      await assert("C2: بک نیتیو → مدال بسته، روی تحلیل، فاز زنده", !(await gateway.isVisible().catch(() => false)) && (await badge.isVisible().catch(() => false)) && st2.ls === "1");
    }
  } else {
    await assert("C2: کلیک خرید UI → مدال باز شد", false, "دکمهٔ خرید پیدا نشد");
  }

  await browser.close();
  const db2 = new PrismaClient();
  await db2.user.deleteMany({ where: { mobile: MOBILE } });
  await db2.$disconnect();
  const fails = results.filter((x) => !x.ok);
  console.log(`\n═══ نتیجه کلاستر مدال: ${results.length - fails.length}/${results.length} PASS ═══`);
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
