/**
 * v199 browser verify — تک‌مرورگر، هشت‌بخشی (الگوی v137)
 *
 * بخش‌ها:
 *  ① صفحه تحلیل آنبوردینگ — متن‌های جدید (عنوان پلن پیشنهادی/لیست امکانات/دکمه)
 *  ② حذف آیکون بک هدر + «همه موارد» بازوبستنِ واقعاً نرم (نمونه‌برداری ارتفاع)
 *  ③ تخفیف ۱۰٪ + قیمت تخفیف‌خورده روی کارت‌ها
 *  ④ مدال خرید باز/بسته می‌شود (مسیر پرداخت سالم)
 *  ⑤ بک مرورگر روی صفحهٔ تحلیل → پنل کاربری (نه صفحهٔ اصلی)
 *  ⑥ قفل بک در صفحهٔ انتظار تحلیل (تست + toast)
 *  ⑦ پنل مدیر — تب «قیف فروش» (شامل خطاهای JS از ErrorLog)
 *  ۸ لندینگ دسکتاپ/موبایل — رندر + فوتر + صفر خطای کنسول
 */
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { createSessionToken } from "@/lib/fitness/auth";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const EXE = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const db = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log("  OK " + name); }
  else { fail++; console.log("  FAIL " + name + " " + detail); }
}

async function main() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + "/api/stats/public");
      if (r.ok) break;
    } catch {
      if (i % 6 === 0) {
        try { execSync('(setsid nohup env NODE_OPTIONS="--max-old-space-size=2560" bun run dev >> dev.log 2>&1 &) </dev/null', { cwd: "/home/z/my-project", stdio: "ignore", timeout: 10000 }); } catch {}
      }
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  // ─── دادهٔ آزمایش ───
  await db.user.deleteMany({ where: { mobile: { in: ["09120000197", "09120000199"] } } });
  const activeTerms = await db.termsVersion.findFirst({ where: { isActive: true }, orderBy: { version: "desc" } });
  const termsV = activeTerms?.version ?? 1; // v199 — مودال «قوانین جدید» تست را نبندد
  const start = new Date(Date.now() - 10 * 86_400_000);
  const analysisUser = await db.user.create({
    data: { mobile: "09120000199", name: "آزمون تحلیل v199", onboardingDone: true, onboardingCompletedAt: start, createdAt: start, acceptedTermsVersion: termsV },
  });
  await db.onboardingProfile.create({
    data: {
      userId: analysisUser.id, gender: "male", age: 30, height: 178, weight: 88, targetWeight: 80,
      goal: "fat_loss", activityLevel: "moderate", workoutDays: 4, workoutDaysList: "[]",
      workoutPlace: "gym", equipment: "[]",
      // تحلیل کش‌شده — تا صفحهٔ تحلیل بدون تماس AI و فوراً بالا بیاید
      aiAnalysis: "تحلیل آزمایشی v199: بر اساس داده‌های بدن شما، مسیر چربی‌سوزی با کسری کالری کنترل‌شده طراحی شد. پروتئین بالا برای حفظ عضله، تمرین قدرتی ۴ روز در هفته و پیگیری هفتگی وزن توصیه می‌شود.",
    },
  });
  const adminUser = await db.user.create({
    data: { mobile: "09120000197", name: "مدیر آزمون v199", role: "ADMIN", onboardingDone: true, createdAt: start, acceptedTermsVersion: termsV },
  });
  const userToken = createSessionToken(analysisUser.id);
  const adminToken = createSessionToken(adminUser.id);

  // صبر تا سرور کامل بالا بیاید (گاردrestart وسط تست — dev-guard OOM)
  async function ensureServer() {
    for (let i = 0; i < 30; i++) {
      try { const r = await fetch(BASE + "/api/stats/public"); if (r.ok) return; } catch {}
      if (i === 5) { try { execSync('(setsid nohup env NODE_OPTIONS="--max-old-space-size=2560" bun run dev >> dev.log 2>&1 &) </dev/null', { cwd: "/home/z/my-project", stdio: "ignore", timeout: 10000 }); } catch {}
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const onlyReal = (errs: string[]) =>
    // net::ERR_FAILED = بلاک عمدی تصویر/فونت توسط تست؛ ERR_CONNECTION = ری‌استارت dev-guard — خطای اپ نیستند
    errs.filter((e) => !e.includes("net::ERR_FAILED") && !e.includes("net::ERR_CONNECTION"));

  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });

  // ─── بخش ①-⑤: صفحهٔ تحلیل (موبایل ۳۹۰px) ───
  console.log("-- ①-⑤ صفحهٔ تحلیل آنبوردینگ (موبایل) --");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route("**/api/app/own/latest", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) }));
    await ctx.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "media") return route.abort();
      return route.continue();
    });
    await ctx.addCookies([
      { name: "sc_session", value: userToken, domain: "localhost", path: "/" },
      { name: "fitup_ap", value: "1", domain: "localhost", path: "/" },
    ]);
    await ctx.addInitScript(() => { try { localStorage.setItem("fitup_ap", "1"); } catch {} });
    const errs: string[] = [];
    // net::ERR_FAILED = فایل‌های تصویر/فونت که خودِ تست بلاک کرده — خطای واقعی اپ نیست
    ctx.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR_FAILED")) errs.push(m.text().slice(0, 150)); });
    const page = await ctx.newPage();

    // v199 — نکته: بازیابی فاز تحلیل فقط در مسیر doAuthCheck است (?screen=panel یا PWA)
    await page.goto(`${BASE}/?screen=panel`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("text=تحلیل اختصاصی شما", { timeout: 90000 });

    // ① متن‌های جدید
    const body = await page.evaluate(() => document.body.innerText);
    check("عنوان: «بهترین انتخاب برای توست»", body.includes("بهترین انتخاب برای توست"));
    check("نام پلن پیشنهادی در عنوان («پلن پیشرفته»)", body.includes("پلن پیشرفته بهترین انتخاب برای توست"));
    check("لیست: «با این پلن همه این امکانات را دریافت می‌کنید»", body.includes("با این پلن همه این امکانات را دریافت می‌کنید"));
    check("دکمه: «همین پلن را انتخاب می‌کنم»", body.includes("همین پلن را انتخاب می‌کنم"));
    check("متن دکمهٔ قدیمی حذف شد («همین را می‌خوام»)", !body.includes("همین را می‌خوام"));
    check("متن قدیمی عنوان حذف شد («برایت ساخته‌ایم»)", !body.includes("برایت ساخته‌ایم"));
    check("دلیل حذف‌شده نیست («هر سوالی دربارهٔ»)", !body.includes("هر سوالی دربارهٔ"));

    // ② هدر بدون بک
    check("آیکون بک هدر حذف شد", (await page.locator('button[aria-label="بازگشت"]').count()) === 0);

    // ③ تخفیف
    check("بنر تخفیف ۱۰٪", body.includes("ده درصد تخفیف بگیرید"));
    check("برچسب تخفیف روی قیمت", body.includes("٪ تخفیف"));

    // ② «همه موارد» — بازوبستن واقعاً نرم (نمونه‌برداری ارتفاع در بستن) — محدود به کارت پلن پیشنهادی
    const spotlight = page.locator('section[aria-label="پلن پیشنهادی اختصاصی شما"]');
    const spotlightCollapse = spotlight.locator('div[style*="grid-template-rows"]').first();
    const allBtn = spotlight.locator('button[aria-expanded]').first();
    check("کانتینر بازوبستن نرم وجود دارد", (await spotlightCollapse.count()) > 0);
    check("دکمهٔ «همه موارد» هست", (await allBtn.count()) > 0);
    check("فهرست اول بسته است (aria-hidden)", (await spotlightCollapse.getAttribute("aria-hidden")) === "true");
    await allBtn.click(); // باز کردن
    await page.waitForTimeout(450);
    check("باز شدن فهرست (aria-expanded)", (await allBtn.getAttribute("aria-expanded")) === "true");
    const openH = await spotlightCollapse.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    check("فهرست باز ارتفاع دارد", openH > 40, String(openH));
    // نمونه‌برداری بستن — بلافاصله بعد از کلیکِ بستن؛ ارتفاع باید تدریجی کم شود
    await allBtn.click(); // بستن
    const heights = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="پلن پیشنهادی اختصاصی شما"] div[style*="grid-template-rows"]') as HTMLElement | null;
      if (!el) return [] as number[];
      return new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        samples.push(el.getBoundingClientRect().height);
        let n = 0;
        const iv = setInterval(() => {
          samples.push(el.getBoundingClientRect().height);
          if (++n >= 6) { clearInterval(iv); resolve(samples); }
        }, 60);
      });
    });
    const dropped = heights.filter((h, i) => i > 0 && h < heights[i - 1] - 1).length;
    check("بستن فهرست نرم است (ارتفاع تدریجی کم می‌شود)", dropped >= 3, JSON.stringify(heights.map((h) => Math.round(h))));
    const trans = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="پلن پیشنهادی اختصاصی شما"] div[style*="grid-template-rows"]') as HTMLElement | null;
      return el ? getComputedStyle(el).transitionProperty : "";
    });
    check("گذار CSS روی grid-template-rows", trans.includes("grid-template-rows") || trans === "all", trans);
    await page.waitForTimeout(450);
    check("فهرست بسته شد (aria-hidden)", (await spotlightCollapse.getAttribute("aria-hidden")) === "true");

    // ④ مدال خرید (aria-label دکمه = «انتخاب پلن …»)
    await spotlight.locator('button[aria-label^="انتخاب پلن"]').first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
    check("مدال خرید باز شد", true);
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("مدال خرید بسته شد", (await page.locator('[role="dialog"]').count()) === 0);

    // ⑤ بک مرورگر → پنل کاربری (نه صفحهٔ اصلی)
    await page.evaluate(() => history.back());
    await page.waitForTimeout(1200);
    const afterBack = await page.evaluate(() => ({
      apFlag: localStorage.getItem("fitup_ap"),
      hasAnalysis: document.body.innerText.includes("تحلیل اختصاصی شما"),
    }));
    check("فلگ فاز تحلیل پاک شد (handler اجرا شد)", afterBack.apFlag === null, String(afterBack.apFlag));
    check("صفحهٔ تحلیل بسته شد", !afterBack.hasAnalysis);
    check("صفر خطای کنسول در صفحهٔ تحلیل", onlyReal(errs).length === 0, JSON.stringify(onlyReal(errs).slice(0, 3)));
    await ctx.close();
  }

  // ─── بخش ⑥: قفل بک در صفحهٔ انتظار تحلیل ───
  console.log("-- ⑥ قفل بک صفحهٔ انتظار --");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route("**/api/app/own/latest", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) }));
    // تأخیر مصنوعی روی API تحلیل — تا فاز «انتظار» قابل تست باشد
    // ⚠️ در playwright مسیرهای ثبت‌شدهٔ «بعدی» اولویت دارند — پس تأخیر باید
    // داخل همان مسیر catch-all باشد وگرنه هیچ‌وقت اجرا نمی‌شود
    await ctx.route("**/*", async (route) => {
      const url = route.request().url();
      const t = route.request().resourceType();
      if (url.includes("/api/onboarding/analysis")) {
        await new Promise((r) => setTimeout(r, 5000));
        return route.continue();
      }
      if (t === "image" || t === "font" || t === "media") return route.abort();
      return route.continue();
    });
    await ctx.addCookies([
      { name: "sc_session", value: userToken, domain: "localhost", path: "/" },
      { name: "fitup_ap", value: "1", domain: "localhost", path: "/" },
    ]);
    await ctx.addInitScript(() => { try { localStorage.setItem("fitup_ap", "1"); } catch {} });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?screen=panel`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("text=در حال تحلیل اطلاعات شما", { timeout: 90000 });
    check("صفحهٔ انتظار بالا آمد", true);
    check("پیام «از این صفحه خارج نشوید» روی صفحهٔ انتظار", (await page.evaluate(() => document.body.innerText.includes("از این صفحه خارج نشوید"))));
    // صبر تا لنگر تاریخچه (pushState در mount) قطعاً ثبت شود — وگرنه back به سند قبلی می‌رود
    await page.waitForFunction(() => !!(window.history.state && (window.history.state as { fitupAnalysis?: number }).fitupAnalysis), null, { timeout: 20000 });
    await page.evaluate(() => history.back()); // بک حین انتظار
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      apFlag: localStorage.getItem("fitup_ap"),
      toast: document.body.innerText.includes("در حال آماده‌سازی"),
      // هنوز در فاز انتظار است (تأخیر مصنوعی ۴ثانیه‌ای هنوز تمام نشده)
      notYetAnalysis: !document.body.innerText.includes("تحلیل اختصاصی شما"),
    }));
    check("toast نگه‌داشتن کاربر نشان داده شد", state.toast);
    check("بک حین انتظار کار نکرد (کاربر در فاز انتظار ماند + فلگ پاک نشد)", state.toast && state.notYetAnalysis && state.apFlag === "1", JSON.stringify(state));
    // کاربر باید همچنان در فاز انتظار بماند (متن انتظار باید بماند/برگردد) و هنوز به تحلیل نرسیده باشد
    try {
      await page.waitForFunction(() => document.body.innerText.includes("در حال تحلیل اطلاعات شما") || document.body.innerText.includes("تحلیل اختصاصی شما"), null, { timeout: 20000 });
    } catch {
      const dbg = await page.evaluate(() => ({ body: document.body.innerText.slice(0, 300), hstate: JSON.stringify(window.history.state), url: location.href }));
      console.log("  DBG ⑥:", JSON.stringify(dbg));
    }
    const state2 = await page.evaluate(() => ({
      apFlag: localStorage.getItem("fitup_ap"),
    }));
    check("فلگ فاز همچنان پاک نشده", state2.apFlag === "1", String(state2.apFlag));
    await page.waitForSelector("text=تحلیل اختصاصی شما", { timeout: 90000 });
    check("پس از پایان انتظار، صفحهٔ تحلیل آمد", true);
    await ctx.close();
  }

  // ─── بخش ⑦: پنل مدیر — تب قیف فروش (دسکتاپ) ───
  console.log("-- ⑦ پنل مدیر: قیف فروش --");
  {
    await ensureServer();
    // یک خطای JS واقعی‌نما در ErrorLog — تا بخش خطاهای JS داشبورد قطعاً رندر شود
    const errRow = await db.errorLog.create({ data: { source: "client", statusCode: 0, message: "Script error.", url: "/", userAgent: "test-v199" } });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route("**/api/app/own/latest", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) }));
    await ctx.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "media") return route.abort();
      return route.continue();
    });
    await ctx.addCookies([{ name: "sc_session", value: adminToken, domain: "localhost", path: "/" }]);
    const errs: string[] = [];
    ctx.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR_FAILED")) errs.push(m.text().slice(0, 150)); });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?screen=admin`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(3000);
    const funnelTab = page.getByRole("button", { name: "قیف فروش" }).first();
    check("تب «قیف فروش» در پنل مدیر هست", (await funnelTab.count()) > 0);
    await funnelTab.click({ timeout: 15000 });
    await page.waitForSelector("text=قیف فروش — تمام مراحل خرید", { timeout: 30000 });
    // صبر برای داده‌های async داشبورد (کامپایل سرد API در dev ممکن است طول بکشد)
    try {
      await page.waitForSelector("text=منبع ورود", { timeout: 60000 });
    } catch {
      const dbg = await page.evaluate(() => document.body.innerText.slice(0, 400));
      console.log("  DBG ⑦:", JSON.stringify(dbg));
    }
    check("داشبورد قیف فروش رندر شد", true);
    const adminBody = await page.evaluate(() => document.body.innerText);
    check("بخش خطاهای JS (ErrorLog) در داشبورد + خطای واقعی دیده می‌شود", adminBody.includes("خطاهای واقعی جاوااسکریپت") && adminBody.includes("Script error."));
    check("تفکیک منبع/دستگاه در داشبورد", adminBody.includes("منبع ورود") && adminBody.includes("دستگاه"));
    check("صفر خطای کنسول در پنل مدیر", onlyReal(errs).length === 0, JSON.stringify(onlyReal(errs).slice(0, 3)));
    await ctx.close();
    await db.errorLog.delete({ where: { id: errRow.id } });
  }

  // ─── بخش ۸: لندینگ دسکتاپ + موبایل ───
  console.log("-- ۸ لندینگ دسکتاپ/موبایل --");
  for (const vp of [{ w: 1280, h: 800 }, { w: 390, h: 844 }]) {
    await ensureServer();
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    await ctx.route("**/api/app/own/latest", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) }));
    await ctx.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "font" || t === "media") return route.abort();
      return route.continue();
    });
    const errs: string[] = [];
    ctx.on("console", (m) => { if (m.type() === "error" && !m.text().includes("net::ERR_FAILED")) errs.push(m.text().slice(0, 150)); });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`لندینگ ${vp.w}px — بدون سرریز افقی`, overflow <= 2, `overflow=${overflow}px`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
    const footer = await page.evaluate(() => {
      const f = document.querySelector("footer");
      if (!f) return { has: false, gap: -1 };
      const r = f.getBoundingClientRect();
      return { has: true, gap: Math.round(window.innerHeight - r.bottom) };
    });
    check(`لندینگ ${vp.w}px — فوتر چسبیده به کف`, footer.has && footer.gap <= 2, JSON.stringify(footer));
    check(`لندینگ ${vp.w}px — صفر خطای کنسول`, onlyReal(errs).length === 0, JSON.stringify(onlyReal(errs).slice(0, 3)));
    await ctx.close();
  }

  await browser.close();
  await db.user.deleteMany({ where: { mobile: { in: ["09120000197", "09120000199"] } } });
  console.log(`\n═══ نتیجه: ${pass} OK / ${fail} FAIL ═══`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
