/**
 * v201 — تست مرورگری جامع فیکس باگ «بک گوشی از تحلیل → باز شدن اپ = دوباره تحلیل»
 *
 * سناریوی مالک: بک گوشی در صفحهٔ تحلیل آنبوردینگ → داشبورد → خروج از اپ →
 * باز کردن دوباره = دوباره صفحهٔ تحلیل (باید داشبورد بیاید بالا).
 * ریشه: پل نیتیو __fitupNativeBack بدون clearAnalysisPhase به داشبورد می‌پرید؛
 * هندلر v199 فقط با popstate مرورگر اجرا می‌شد و در اپ اندروید هرگز صدا زده نمی‌شد.
 *
 * نشانه‌های UI (موبایل ۳۹۰px):
 *  - داشبورد: «تمرین امروز» (سایدبار در موبایل مخفی است — «داشبورد» لوکیتور نیست)
 *  - صفحهٔ تحلیل لودشده: «گام ۱ — تحلیل و آنالیز بدن»
 *  - انتظار تحلیل: «در حال تحلیل اطلاعات شما»
 *  - مدال خرید: «رفتن به درگاه پرداخت»
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const MOBILE = "09121112233";
const OTP = "1234";
const SHOTS = "/home/z/my-project/public/shots-temp";
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const results = [];
function pass(name) { results.push({ name, ok: true }); console.log(`  ✅ ${name}`); }
function fail(name, extra = "") { results.push({ name, ok: false }); console.log(`  ❌ ${name} ${extra}`); }
async function assert(name, cond, extra = "") {
  if (cond) pass(name); else fail(name, extra);
  return cond;
}

const ANALYSIS_MOCK = {
  ok: true,
  analysis: "تحلیل تستی v201 — ترکیب بدنی شما نشان می‌دهد با تمرین مقاومتی و کسری کالری ملایم به هدف می‌رسید.",
  bmi: 24.2, bmr: 1650, tdee: 2300,
  macros: { calories: 2000, protein: 150, carbs: 220, fat: 60 },
  planRecommendation: { recommendedPlan: "standard", reason: "تست", reasons: ["دلیل تستی ۱", "دلیل تستی ۲", "دلیل تستی ۳"] },
  profile: { weight: 78, targetWeight: 70, goal: "lose", workoutDays: 3, workoutPlace: "gym", dietType: "normal" },
};
let mockDelayMs = 0;

const waitServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/`, { method: "GET" });
      if (r.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
};

async function main() {
  // ─── ۰. آماده‌سازی DB + سشن ───
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.user.deleteMany({ where: { mobile: MOBILE } });
  await db.otpCode.create({
    data: { mobile: MOBILE, code: OTP, expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0 },
  });
  const verifyRes = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: MOBILE, code: OTP }),
  });
  const setCookies = verifyRes.headers.getSetCookie ? verifyRes.headers.getSetCookie() : [];
  const sessionCookie = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("sc_session="));
  if (!sessionCookie) { console.error("❌ سشن ساخته نشد — verify-otp:", verifyRes.status); process.exit(1); }
  const user = await db.user.findUnique({ where: { mobile: MOBILE } });
  await db.user.update({ where: { id: user.id }, data: { onboardingDone: true } });
  console.log("— کاربر تست ساخته شد (onboardingDone=true) —");

  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // UA دسکتاپ (ویوپورت موبایل) — با UA اندروید، مکانیزم intent:// سایت روی کلیک‌ها
    // مزاحم می‌شود (خطای «user gesture required») — رفتار تحت‌تست (پل بک) مستقل از UA است
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  await context.addCookies([
    { name: "sc_session", value: sessionCookie.split("=")[1], domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message || e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.route("**/api/onboarding/analysis**", async (route) => {
    if (mockDelayMs > 0) await new Promise((r) => setTimeout(r, mockDelayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ANALYSIS_MOCK) });
  });

  const dash = page.getByText("تمرین امروز", { exact: false }).first();
  const analysisBadge = page.getByText("گام ۱ — تحلیل و آنالیز بدن").first();
  const waitingText = page.getByText("در حال تحلیل اطلاعات شما", { exact: false }).first();
  const gatewayBtn = page.getByText("رفتن به درگاه پرداخت").first();

  // v202 — نسخهٔ مقاوم: بعد از بک ممکن است مرورگر روی صفحهٔ خطای اتصال
  // (ERR_CONNECTION_RESET در dev) باشد که localStorage ندارد — یک رفرش نرم
  // به URL پنل می‌زنیم و دوباره می‌خوانیم (فلگ‌ها ماندگارند، حالت UI مهم نیست).
  const phaseState = async () => {
    try {
      return await page.evaluate(() => ({
        ls: window.localStorage.getItem("fitup_ap"),
        plan: window.localStorage.getItem("fitup_ap_plan"),
        cookie: /(?:^|;\s*)fitup_ap=1(?:;|$)/.test(document.cookie || ""),
      }));
    } catch {
      await goto2(`${BASE}/?screen=panel`);
      return await page.evaluate(() => ({
        ls: window.localStorage.getItem("fitup_ap"),
        plan: window.localStorage.getItem("fitup_ap_plan"),
        cookie: /(?:^|;\s*)fitup_ap=1(?:;|$)/.test(document.cookie || ""),
      }));
    }
  };
  const seedPhase = (withPlan = false) =>
    page.evaluate((withPlan) => {
      try {
        window.localStorage.setItem("fitup_ap", "1");
        document.cookie = "fitup_ap=1; path=/; max-age=2592000; samesite=lax";
        if (withPlan) window.localStorage.setItem("fitup_ap_plan", "standard");
        else window.localStorage.removeItem("fitup_ap_plan");
      } catch {}
    }, withPlan);

  /** ورود تمیز به صفحهٔ تحلیل (شبیه‌سازی باز شدن اپ با فاز فعال) */
  const enterAnalysis = async (withPlan = false) => {
    await seedPhase(withPlan);
    await goto2(`${BASE}/?screen=panel`);
    try { await page.waitForFunction(() => typeof window.__fitupNativeBack === "function", undefined, { timeout: 90_000 }); } catch { return false; }
    return waitVisible(analysisBadge, 75_000);
  };
  const enterDashboard = async () => {
    await goto2(`${BASE}/?screen=panel`);
    try { await page.waitForFunction(() => typeof window.__fitupNativeBack === "function", undefined, { timeout: 90_000 }); } catch { return false; }
    return waitVisible(dash, 75_000);
  };
  const nativeBack = () => page.evaluate(() => window.__fitupNativeBack && window.__fitupNativeBack());

  /** ناوبری مقاوم (سرور dev گاهی ری‌استارت می‌شود — خودکار صبر/تلاش مجدد) */
  const goto2 = async (url) => {
    for (let i = 0; i < 6; i++) {
      try {
        return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      } catch (e) {
        console.log(`  ⏳ سرور در حال آماده‌سازی — تلاش مجدد ${i + 1}`);
        await waitServer();
      }
    }
    throw new Error("goto failed after retries");
  };
  /** انتظار مقاوم برای دیده‌شدن یک نشانه (با پولینگ) */
  const waitVisible = async (loc, timeoutMs = 45_000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await loc.isVisible().catch(() => false)) return true;
      await page.waitForTimeout(600);
    }
    return false;
  };

  // ═══ کنترل پایه ═══
  console.log("\n■ کنترل پایه (بدون فاز)");
  const ctl = await enterDashboard();
  await assert("بدون فاز → داشبورد بالا می‌آید (کنترل)", ctl);
  const st0 = await phaseState();
  await assert("بدون فاز → فلگ fitup_ap خالی", st0.ls === null && !st0.cookie, JSON.stringify(st0));

  // ═══ بازیابی SSR فاز (خط پایهٔ v164) ═══
  console.log("\n■ بازیابی فاز بعد از باز شدن دوباره (v164 — وقتی کاربر هنوز خارج نشده)");
  const r1 = await enterAnalysis(false);
  await assert("با فاز → صفحهٔ تحلیل بالا می‌آید (v164)", r1);
  const st1 = await phaseState();
  await assert("فاز در LS و کوکی فعال است", st1.ls === "1" && st1.cookie, JSON.stringify(st1));

  // ═══ TEST A — باگ اصلی: بک پل نیتیو از تحلیلِ لودشده ═══
  console.log("\n■ TEST A — بک پل نیتیو از تحلیلِ لودشده (مسیر باگ مالک)");
  await nativeBack();
  const a1 = await waitVisible(dash, 45_000);
  await assert("بک نیتیو → داشبورد", a1);
  await page.waitForTimeout(400);
  const stA = await phaseState();
  await assert("بک نیتیو → فاز پاک شد (LS + کوکی) — هستهٔ فیکس", stA.ls === null && !stA.cookie, JSON.stringify(stA));

  // ═══ TEST B — باز شدن دوبارهٔ اپ (سناریوی دقیق مالک) ═══
  console.log("\n■ TEST B — باز شدن دوبارهٔ اپ بعد از بک (سناریوی مالک)");
  const b1 = await enterDashboard();
  await assert("باز شدن دوباره → داشبورد (نه تحلیل) ✅ رفع باگ", b1);
  const leak = await analysisBadge.isVisible().catch(() => false);
  await assert("صفحهٔ تحلیل دیگر خودبه‌خود نمی‌آید", !leak);

  // ═══ TEST C — استثنای مالک: مدال خرید باز (هم‌ارز بازگشت از درگاه) ═══
  console.log("\n■ TEST C — مدال خرید باز: بک نیتیو فقط مدال را می‌بندد، فاز می‌ماند");
  const c1 = await enterAnalysis(true);
  const gw1 = c1 && (await waitVisible(gatewayBtn, 45_000));
  await assert("بازگشت به تحلیل + همان مدال خرید (v164)", gw1);
  await nativeBack();
  await page.waitForTimeout(1200);
  const modalClosed = !(await gatewayBtn.isVisible().catch(() => false));
  const stillAnalysis = await analysisBadge.isVisible().catch(() => false);
  const stC = await phaseState();
  await assert("بک نیتیو با مدال باز → مدال بسته شد", modalClosed);
  await assert("بک نیتیو با مدال باز → روی تحلیل ماندیم", stillAnalysis);
  await assert("بک نیتیو با مدال باز → فاز صفحه دست‌نخورده", stC.ls === "1" && stC.cookie, JSON.stringify(stC));

  console.log("\n■ TEST C+ — باز شدن دوباره با مدالِ «باز» در لحظهٔ خروج: همان تحلیل + همان مدال");
  const c2 = await enterAnalysis(true);
  const gw2 = c2 && (await waitVisible(gatewayBtn, 45_000));
  await assert("باز شدن دوباره در فاز فعال + مدال باز → تحلیل + مدال باز (هم‌ارز بازگشت از درگاه)", gw2);

  // ═══ TEST C2 — مسیر خرید UI ═══
  console.log("\n■ TEST C2 — بستن مدال با بک، سپس باز کردن با دکمهٔ خرید کارت پلن");
  await nativeBack(); // بستن مدال (شاخهٔ مدال)
  await page.waitForTimeout(1200);
  const afterClose = !(await gatewayBtn.isVisible().catch(() => false)) && (await waitVisible(analysisBadge, 20_000));
  await assert("بک نیتیو → مدال بسته، روی تحلیل", afterClose);
  // دکمهٔ خرید کارت‌ها aria-label «خرید پلن …» دارند — سلکتور دقیق
  const buyBtn = page.locator('button[aria-label^="خرید پلن"]').first();
  let c2done = false;
  if (await waitVisible(buyBtn, 25_000)) {
    try { await buyBtn.scrollIntoViewIfNeeded({ timeout: 10_000 }); } catch {}
    await page.waitForTimeout(600);
    try { await buyBtn.click({ timeout: 15_000 }); } catch {}
    const gw3 = await waitVisible(gatewayBtn, 25_000);
    c2done = gw3;
    await assert("کلیک خرید UI → مدال باز شد", gw3);
    if (gw3) {
      await nativeBack();
      await page.waitForTimeout(1200);
      await assert("بک نیتیو → مدال بسته، روی تحلیل (دوم)", !(await gatewayBtn.isVisible().catch(() => false)) && (await analysisBadge.isVisible().catch(() => false)));
    }
  }
  if (!c2done) await assert("کلیک خرید UI → مدال باز شد", false, "دکمهٔ خرید کارت پیدا/کلیک نشد");

  // ═══ TEST D — بک مرورگر (مسیر v199) بعد از فیکس سالم ═══
  console.log("\n■ TEST D — بک مرورگر از تحلیل → داشبورد + پاک‌سازی فاز (v199)");
  const d1 = await enterAnalysis(false);
  await assert("ورود مجدد به تحلیل برای تست مرورگر", d1);
  await page.evaluate(() => { try { window.history.back(); } catch {} });
  const d2 = await waitVisible(dash, 45_000);
  await assert("بک مرورگر → داشبورد", d2);
  await page.waitForTimeout(400);
  const stD = await phaseState();
  await assert("بک مرورگر → فاز پاک شد", stD.ls === null && !stD.cookie, JSON.stringify(stD));

  // ═══ TEST E — قفل انتظار تحلیل (نیتیو + مرورگر) ═══
  console.log("\n■ TEST E — حین انتظار تحلیل بک قفل است (نیتیو و مرورگر)");
  mockDelayMs = 15000;
  await seedPhase(false);
  await goto2(`${BASE}/?screen=panel`);
  const e0w = await waitVisible(waitingText, 25_000);
  await assert("حالت انتظار تحلیل نمایش داده شد", e0w);
  await nativeBack();
  await page.waitForTimeout(1500);
  const e1 = (await waitingText.isVisible().catch(() => false)) || (await analysisBadge.isVisible().catch(() => false));
  const stE1 = await phaseState();
  await assert("بک نیتیو حین انتظار → صفحه ترک نشد (قفل v199 در اپ هم اجرا شد)", e1);
  await assert("بک نیتیو حین انتظار → فاز حفظ شد", stE1.ls === "1" && stE1.cookie, JSON.stringify(stE1));
  await page.evaluate(() => { try { window.history.back(); } catch {} });
  await page.waitForTimeout(1500);
  await assert("بک مرورگر حین انتظار → صفحه ترک نشد", (await waitingText.isVisible().catch(() => false)) || (await analysisBadge.isVisible().catch(() => false)));
  mockDelayMs = 0;
  await waitVisible(analysisBadge, 90_000);
  await assert("پس از لود تحلیل → صفحهٔ تحلیل کامل", await analysisBadge.isVisible().catch(() => false));
  await nativeBack();
  const e2 = await waitVisible(dash, 45_000);
  const stE2 = await phaseState();
  await assert("بعد از لود: بک نیتیو → داشبورد + پاک‌سازی فاز", e2 && stE2.ls === null && !stE2.cookie, JSON.stringify(stE2));

  // ═══ TEST F — دود لندینگ + فوتر ═══
  console.log("\n■ TEST F — دود لندینگ (دسکتاپ/موبایل) + فوتر");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3000);
  const footer = page.locator("footer").first();
  const footerDesktop = await footer.isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOTS}/v201-landing-desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const footerMobile = await footer.isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOTS}/v201-landing-mobile.png`, fullPage: false });
  await assert("لندینگ دسکتاپ رندر شد + فوتر", footerDesktop);
  await assert("لندینگ موبایل رندر شد + فوتر", footerMobile);

  await browser.close();
  await db.user.deleteMany({ where: { mobile: MOBILE } });
  await db.$disconnect();

  // ═══ جمع‌بندی ═══
  const fails = results.filter((r) => !r.ok);
  console.log("\n════════════════════════════════");
  console.log(`نتیجه: ${results.length - fails.length}/${results.length} PASS`);
  const realErrors = consoleErrors.filter(
    (t) => !t.includes("DialogContent") && !t.includes("hydration") && !t.includes("Download the React DevTools")
  );
  console.log(`خطاهای کنسول: ${realErrors.length}`);
  if (realErrors.length) console.log(realErrors.slice(0, 6).join("\n---\n"));
  if (fails.length) {
    console.log("❌ موارد ردشده:");
    fails.forEach((f) => console.log(`  - ${f.name}`));
    process.exit(1);
  }
  console.log("✅ همهٔ تست‌ها PASS");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
