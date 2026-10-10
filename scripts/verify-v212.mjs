/**
 * v212 — راستی‌آزمایی مرورگری سه دیرکتیو مالک:
 *  A) آنبوردینگ: بازگشت اسکرول نرم به «اول سؤال بعدی» با انتخاب هر گزینهٔ
 *     تک‌انتخابی + صفر پرش (ریشهٔ KeyboardFix درمان شد)
 *  B) ریشه‌یابی KeyboardFix: شبیه‌سازی کیبورد واقعی (override window.innerHeight
 *     + dispatch رویدادهای visualViewport):
 *     B1 = سناریوی دقیق پرش فرم بدن: فوکوس → کیبورد باز → اسکرول کاربر (بعد از
 *          settle) → بستن کیبورد → اسکرولر باید سرجایش بماند
 *     B2 = حفظ فیکس v91-B: بدون اسکرول کاربر → بستن کیبورد → بازگردانی به خط پایه
 *  C) مدال پرداخت بازار: گزینهٔ «کیف پول فیتاپ» برگشته (دو روش) + خرید واقعی
 *     با کیف پول در UA بازار → رسید موفق و کسر موجودی
 *  D) پرپرایم خودکار کد تخفیف اختصاصی پیامکی در مدال لندینگ
 *
 * نکته‌ها:
 *  • هر بخش کاربر/شمارهٔ خودش را دارد (سقف rate-limit ورود OTP per-mobile).
 *  • ورود از مسیر رسمی API است: ردیف OTP با هش کد معلوم در DB ساخته می‌شود و
 *    verify-otp کوکی سشن می‌دهد (بدون دورزدن احراز هویت).
 *  • کلیک‌ها با el.click() واقعی DOM (کلیک استاندارد Playwright عنصر را سنتر
 *    می‌کند و خودش پرش می‌سازد — درس v209).
 *  • صحنه‌های B بعد از اتمام انیمیشن‌های smooth خود اپ (ensureVisible کیبورد)
 *    اسکرول کاربر را شبیه‌سازی می‌کنند تا با خودِ اپ نپیکند.
 *
 * اجرا: bun scripts/verify-v212.mjs (سرور dev لازم است)
 */
import { chromium, devices } from "playwright";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const BAZAAR_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 FitUpBazaar/1.15.6";
const hashOtp = (code) => createHash("sha256").update(`fitup-otp:${code}`).digest("hex");

let pass = 0;
let fail = 0;
let prisma;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

/** ورود واقعی از مسیر رسمی verify-otp برای کاربر داده‌شده */
async function loginIntoContext(ctx, mobile, code = "2121") {
  await prisma.otpCode.deleteMany({ where: { mobile } });
  await prisma.otpCode.create({
    data: { mobile, code: hashOtp(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000), used: false },
  });
  const res = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, code }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/sc_session=([^;]+)/);
  if (!m) return false;
  await ctx.addCookies([{ name: "sc_session", value: m[1], url: BASE }]);
  return true;
}

/** اسکرولر واقعی مرحلهٔ آنبوردینگ (بالارفتن از data-onb-q اول) */
const SCROLLER_FN = `() => {
  let el = document.querySelector("[data-onb-q]");
  while (el) {
    const cs = getComputedStyle(el);
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}`;

async function getScrollTop(page) {
  return page.evaluate(`(() => { const el = (${SCROLLER_FN})(); return el ? el.scrollTop : -1; })()`);
}

/** بستن دیالوگ‌های مزاحم (تور خوش‌آمد و…) تا مدال خرید باز بماند */
async function closeStrayDialogs(page) {
  for (let i = 0; i < 10; i++) {
    const state = await page.evaluate(() => {
      const dlgs = Array.from(document.querySelectorAll("[role=dialog]"));
      if (dlgs.some((d) => (d.textContent || "").includes("روش پرداخت"))) return "purchase";
      return dlgs.length > 0 ? "stray" : "none";
    });
    if (state === "purchase") return true;
    if (state === "stray") {
      // اول دکمهٔ رد/بعداً (مثلاً «الان نه» در دیالوگ اجازهٔ اعلان‌ها) —
      // AlertDialog با Escape بسته نمی‌شود
      const dismissed = await page.evaluate(() => {
        const dlgs = Array.from(document.querySelectorAll("[role=dialog], [role=alertdialog]"));
        for (const d of dlgs) {
          const btns = Array.from(d.querySelectorAll("button"));
          const dismiss = btns.find((b) => /الان نه|بعدا|دیرتر|رد کردن|نه,|نه،/.test(b.textContent || ""));
          if (dismiss) {
            dismiss.click();
            return true;
          }
        }
        return false;
      });
      if (dismissed) {
        await page.waitForTimeout(900);
      } else {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(800);
      }
    } else {
      return false;
    }
  }
  return false;
}

async function main() {
  prisma = new PrismaClient();

  // کاربر A (آنبوردینگ + کیبورد) — از صفر
  const mobileA = "09350002233";
  let userA = await prisma.user.findUnique({ where: { mobile: mobileA } });
  if (!userA) userA = await prisma.user.create({ data: { mobile: mobileA, name: "تستی" } });
  await prisma.userDiscountCode.deleteMany({ where: { userId: userA.id } });
  await prisma.user.update({
    where: { id: userA.id },
    data: { onboardingDone: false, planName: null, planExpiresAt: null },
  });

  const browser = await chromium.launch();

  // ═══════════════ بخش A — آنبوردینگ: اسکرول نرم به سؤال بعدی ═══════════════
  console.log("\n═══ A) آنبوردینگ — اسکرول نرم به اول سؤال بعدی (دیرکتیو v212) ═══");
  {
    const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
    check("A0 ورود واقعی OTP", (await loginIntoContext(ctx, mobileA)) === true);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text().slice(0, 160));
    });

    await page.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.waitForSelector("[data-onb-q]", { timeout: 25000 });

    // A1 — جنسیت: کلیک → در پنجرهٔ settle همان‌جا → سپس اسکرول نرم به اولِ «سن»
    const beforeGender = await getScrollTop(page);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("[data-onb-q] button"));
      const b = btns.find((x) => (x.textContent || "").includes("آقا"));
      b?.click();
    });
    await page.waitForTimeout(120);
    const duringGender = await getScrollTop(page);
    await page.waitForTimeout(900);
    const afterGender = await getScrollTop(page);
    const ageOff = await page.evaluate(({ fn }) => {
      const scroller = eval(fn)();
      const q = scroller.querySelectorAll("[data-onb-q]")[2];
      return q.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }, { fn: SCROLLER_FN });
    check("A1 جنسیت: بدون پرش لحظه‌ای (settle ۳۲۰ms)", Math.abs(duringGender - beforeGender) < 40, `during=${duringGender} before=${beforeGender}`);
    check("A1 جنسیت: اسکرول نرم به اولِ سؤال «سن»", Math.abs(ageOff - 12) <= 24, `ageOff=${ageOff}`);
    check("A1 جنسیت: واقعاً اسکرول شده (نه ثابت)", afterGender > beforeGender + 40, `after=${afterGender} before=${beforeGender}`);

    // A2 — پرکردن فیلدهای متنی تا فرم بدن (native setter — بدون نیاز به دیده‌شدن)
    await page.evaluate(() => {
      const setVal = (sel, val) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error("missing input " + sel);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setVal('input[placeholder*="علی"]', "تستی");
      setVal('input[placeholder*="رضایی"]', "کاربر");
      setVal('input[placeholder="۲۵"]', "28");
      setVal('input[placeholder="۱۷۵"]', "180");
      setVal('input[placeholder="۷۵"]', "80");
    });
    await page.waitForTimeout(400);
    const beforeForm = await getScrollTop(page);

    // A3 — فرم بدن: کلیک روی گزینه → اسکرول نرم به سؤال بعدی (ریکاوری).
    // ریکاوری نزدیک انتهای محتواست — اگر جا برای ترازِ بالای دید نبود، اسکرول
    // در سقف می‌ایستد؛ شرط درست: یا ترازِ بالای دید، یا کاملاً داخل دید.
    await page.evaluate(({ fn }) => {
      const scroller = eval(fn)();
      const qs = scroller.querySelectorAll("[data-onb-q]");
      qs[5].querySelector("button").click();
    }, { fn: SCROLLER_FN });
    await page.waitForTimeout(1200);
    const recState = await page.evaluate(({ fn }) => {
      const scroller = eval(fn)();
      const q = scroller.querySelectorAll("[data-onb-q]")[6];
      const off = q.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const fullyVisible =
        q.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 4 && off >= -4;
      return { off, fullyVisible, atMax: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 2 };
    }, { fn: SCROLLER_FN });
    const afterForm = await getScrollTop(page);
    check(
      "A3 فرم بدن: اسکرول نرم به سؤال بعدی (ریکاوری در دید)",
      Math.abs(recState.off - 12) <= 26 || (recState.fullyVisible && recState.atMax),
      `off=${recState.off} fullyVisible=${recState.fullyVisible} atMax=${recState.atMax}`
    );
    check("A3 فرم بدن: پرشِ بازگشت وجود ندارد (به جلو رفته نه عقب)", afterForm >= beforeForm - 10, `after=${afterForm} before=${beforeForm}`);

    // A4 — آکاردئون اختیاری: کلیک روی هدر ریکاوری → هیچ اسکرولی
    const beforeAcc = await getScrollTop(page);
    await page.evaluate(() => {
      const qs = document.querySelectorAll("[data-onb-q][data-onb-acc]");
      qs[0]?.querySelector("button")?.click();
    });
    await page.waitForTimeout(700);
    const afterAcc = await getScrollTop(page);
    check("A4 آکاردئون ریکاوری: صفر اسکرول", Math.abs(afterAcc - beforeAcc) <= 2, `after=${afterAcc} before=${beforeAcc}`);

    // A5 — ادامه به مرحلهٔ ۲ → انتخاب هدف → اسکرول نرم به «سطح فعالیت»
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      btns.find((b) => b.textContent?.trim() === "ادامه")?.click();
    });
    await page.waitForTimeout(1000);
    const step2Top = await getScrollTop(page);
    check("A5 تعویض مرحله: بازگشت به بالای مرحلهٔ جدید", step2Top <= 2, `top=${step2Top}`);
    await page.evaluate(({ fn }) => {
      const scroller = eval(fn)();
      scroller.querySelectorAll("[data-onb-q]")[0].querySelector("button").click();
    }, { fn: SCROLLER_FN });
    await page.waitForTimeout(1100);
    const actOff = await page.evaluate(({ fn }) => {
      const scroller = eval(fn)();
      const q = scroller.querySelectorAll("[data-onb-q]")[1];
      return q.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }, { fn: SCROLLER_FN });
    check("A5 مرحلهٔ ۲: انتخاب هدف → اسکرول نرم به اول «سطح فعالیت»", Math.abs(actOff - 12) <= 26, `actOff=${actOff}`);

    // A6 — چیپ چند-انتخابی (روزها): هیچ اسکرولی نباید بیاید
    const beforeMulti = await getScrollTop(page);
    await page.evaluate(() => {
      const qs = document.querySelectorAll("[data-onb-q][data-onb-multi]");
      qs[0]?.querySelector("button")?.click();
    });
    await page.waitForTimeout(800);
    const afterMulti = await getScrollTop(page);
    check("A6 چیپ چند-انتخابی روزها: صفر اسکرول", Math.abs(afterMulti - beforeMulti) <= 2, `after=${afterMulti} before=${beforeMulti}`);

    const fatalA = errors.filter((e) => !/ResizeObserver|favicon|hydration/i.test(e));
    check("A7 صفر خطای مرگبار کنسول (بخش A)", fatalA.length === 0, fatalA.slice(0, 2).join(" | "));
    await ctx.close();
  }

  // ═══════════ بخش B — ریشه‌یابی KeyboardFix (شبیه‌سازی کیبورد واقعی) ═══════════
  console.log("\n═══ B) KeyboardFix — شبیه‌سازی کیبورد: ریشهٔ پرش فرم بدن درمان شد ═══");
  // کاربران جدا برای هر سناریو (سقف rate-limit ورود OTP per-mobile)
  const ensureFreshUser = async (mobile) => {
    let u = await prisma.user.findUnique({ where: { mobile } });
    if (!u) u = await prisma.user.create({ data: { mobile, name: "کیبورد" } });
    await prisma.user.update({ where: { id: u.id }, data: { onboardingDone: false } });
    return u;
  };
  {
    // ── B1: سناریوی دقیق باگ — فوکوس → کیبورد باز → اسکرول کاربر (بعد از settle)
    // → بسته شدن کیبورد → اسکرولر باید سرجایش بماند (نسخهٔ قبلی برمی‌گرداند!)
    const mobileB1 = "09350002336";
    await ensureFreshUser(mobileB1);
    const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
    await loginIntoContext(ctx, mobileB1, "2131");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder="۱۷۵"]', { timeout: 25000 });
    await page.waitForTimeout(2000);

    const r1 = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let sc = document.querySelector("[data-onb-q]");
      while (sc && !/auto|scroll/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      if (!sc) return { ok: false, why: "no-scroller" };
      let fakeH = window.innerHeight;
      Object.defineProperty(window, "innerHeight", { configurable: true, get: () => fakeH });
      const vv = window.visualViewport;
      const realVvH = vv.height;
      const input = document.querySelector('input[placeholder="۱۷۵"]');
      const S0 = 60;
      sc.scrollTop = S0;
      await sleep(80);
      input.focus(); // focusin → saveScroll(B0=S0) → کیبورد «باز» می‌شود
      await sleep(60);
      fakeH = realVvH + 420; // overlapNow=420 → keyboardOpen در تایمر ۲۲۰ms ✓
      await sleep(2600); // تایمرهای ۲۲۰/۵۰۰/۹۰۰ms + انیمیشن‌های smooth تمام شوند
      const centered = sc.scrollTop; // جای «وسط‌چین‌شدن ورودی» توسط خود اپ
      const maxTop = sc.scrollHeight - sc.clientHeight;
      const S1 = Math.min(centered + 500, Math.max(0, maxTop - 10));
      sc.scrollTop = S1; // اسکرول ارادی کاربر به فرم بدن (بعد از settle → dirty)
      await sleep(400);
      const afterUserScroll = sc.scrollTop;
      fakeH = realVvH; // کیبورد بسته می‌شود
      vv.dispatchEvent(new Event("resize")); // onVvChange → overlap=0 → closeKeyboard
      input.blur();
      await sleep(1100); // تلاش‌های تأخیری بازگردانی ۲۲۰/۶۰۰ms هم باید بگذرند
      const finalTop = sc.scrollTop;
      delete window.innerHeight;
      return { ok: true, S0, S1, centered, afterUserScroll, finalTop };
    });
    check("B1 شبیه‌سازی اجرا شد", r1.ok === true, JSON.stringify(r1).slice(0, 140));
    check("B1 اسکرول به S1 پایدار ماند پیش از بستن کیبورد", Math.abs(r1.afterUserScroll - r1.S1) < 60, `after=${r1.afterUserScroll} S1=${r1.S1}`);
    check(
      "B1 پس از بستن کیبورد برنمی‌گردد (ریشهٔ پرش فرم بدن درمان شد)",
      Math.abs(r1.finalTop - r1.S1) < 60,
      `final=${r1.finalTop} S1=${r1.S1} S0=${r1.S0}`
    );
    await ctx.close();

    // ── B2: حفظ فیکس v91-B — بدون اسکرول کاربر → بستن کیبورد → بازگردانی به خط پایه
    const mobileB2 = "09350002337";
    await ensureFreshUser(mobileB2);
    const ctx2 = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
    await loginIntoContext(ctx2, mobileB2, "2132");
    const page2 = await ctx2.newPage();
    await page2.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded" });
    await page2.waitForSelector('input[placeholder="۱۷۵"]', { timeout: 25000 });
    await page2.waitForTimeout(2000);
    const r2 = await page2.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let sc = document.querySelector("[data-onb-q]");
      while (sc && !/auto|scroll/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      if (!sc) return { ok: false };
      let fakeH = window.innerHeight;
      Object.defineProperty(window, "innerHeight", { configurable: true, get: () => fakeH });
      const vv = window.visualViewport;
      const realVvH = vv.height;
      const input = document.querySelector('input[placeholder="۱۷۵"]');
      // ورودی را «قبل از» فوکوس کاملاً مرئی می‌کنیم تا کروم اسکرول خودکارِ
      // focus را نزند (در کروم دسکتاپ اسکرول خودکار قبل از dispatch شدن
      // focusin است و خط پایه را خراب می‌کند؛ در دستگاه واقعی پنِ بومی بعد
      // از focusin است — این‌جا همان توالی واقعی را دستی می‌سازیم)
      const PRE = 612;
      sc.scrollTop = PRE;
      await sleep(120);
      input.focus(); // focusin → saveScroll(PRE) — بدون اسکرول خودکار
      await sleep(80);
      fakeH = realVvH + 420; // کیبورد «باز» می‌شود
      await sleep(80);
      // پنِ بومی WebView لجبار — بعد از focusin، قبل از settle — جابه‌جاییِ
      // قابل‌بازگردانی (با بسته شدن کیبورد باید به PRE برگردد — فیکس v91-B)
      sc.scrollTop = PRE + 500;
      await sleep(2400);
      const drifted = sc.scrollTop;
      fakeH = realVvH;
      vv.dispatchEvent(new Event("resize"));
      input.blur();
      await sleep(1200);
      const finalTop = sc.scrollTop;
      delete window.innerHeight;
      return { ok: true, PRE, drifted, finalTop, restored: Math.abs(finalTop - PRE) < 60 };
    });
    check(
      "B2 فیکس v91-B سالم ماند: بسته شدن کیبورد → بازگردانی به خط پایه",
      r2.ok === true && r2.restored === true,
      `final=${r2.finalTop} PRE=${r2.PRE} drifted=${r2.drifted}`
    );
    await ctx2.close();
  }

  // ═══════════ بخش C — مدال پرداخت بازار: بازگشت کیف پول + خرید واقعی ═══════════
  console.log("\n═══ C) مدال پرداخت بازار — گزینهٔ کیف پول برگشت + خرید واقعی با کیف پول ═══");
  {
    const mobileC = "09350002334";
    let userC = await prisma.user.findUnique({ where: { mobile: mobileC } });
    if (!userC) userC = await prisma.user.create({ data: { mobile: mobileC, name: "بازار" } });
    await prisma.userDiscountCode.deleteMany({ where: { userId: userC.id } });
    await prisma.user.update({
      where: { id: userC.id },
      data: { onboardingDone: true, walletBalance: 5_000_000, planName: null, planExpiresAt: null },
    });
    const ctx = await browser.newContext({
      ...devices["Pixel 7"],
      locale: "fa-IR",
      userAgent: BAZAAR_UA,
    });
    check("C0 ورود واقعی OTP (UA بازار)", (await loginIntoContext(ctx, mobileC)) === true);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/?screen=main`, { waitUntil: "domcontentloaded" });
    // انتظار واقعی برای رندر پنل: نوبار پنل (داشبورد + پلن‌ها) — نه متن لندینگ
    let panelReady = true;
    try {
      await page.waitForFunction(
        () => {
          const texts = Array.from(document.querySelectorAll("button, [role=tab], a")).map((b) => (b.textContent || "").trim());
          return texts.some((t) => t === "داشبورد") && texts.some((t) => t === "پلن‌ها");
        },
        { timeout: 60000 }
      );
    } catch {
      panelReady = false;
    }
    await page.waitForTimeout(1500);
    await closeStrayDialogs(page); // دیالوگ اجازهٔ اعلان‌ها (الان نه) و…
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role=tab], a"));
      btns.find((b) => (b.textContent || "").trim() === "پلن‌ها")?.click();
    });
    // انتظار برای رندر صفحهٔ پلن‌ها (دکمهٔ انتخاب پلن) — با یک تلاش دوباره
    let plansReady = true;
    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("button")).filter((b) => (b.textContent || "").trim() === "انتخاب پلن").length >= 2,
        { timeout: 30000 }
      );
    } catch {
      // تلاش دوباره: شاید کلیک تب جا نیفتاده بود
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, [role=tab], a"));
        btns.find((b) => (b.textContent || "").trim() === "پلن‌ها")?.click();
      });
      try {
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll("button")).filter((b) => (b.textContent || "").trim() === "انتخاب پلن").length >= 2,
          { timeout: 20000 }
        );
      } catch {
        plansReady = false;
      }
    }
    await closeStrayDialogs(page);
    const opened = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const buy = btns.find((b) => (b.textContent || "").trim() === "انتخاب پلن");
      buy?.click();
      return !!buy;
    });
    await page.waitForTimeout(2500);
    await closeStrayDialogs(page);
    const modalState = await page.evaluate(() => {
      const dlgs = Array.from(document.querySelectorAll("[role=dialog]"));
      const dlg = dlgs.find((d) => (d.textContent || "").includes("روش پرداخت"));
      if (!dlg) return { open: false, text: (dlgs[0]?.textContent || "").slice(0, 140) };
      const texts = Array.from(dlg.querySelectorAll("button p")).map((p) => p.textContent || "");
      return {
        open: true,
        text: (dlg.textContent || "").slice(0, 180),
        hasIap: texts.some((t) => t.includes("پرداخت درون‌برنامه‌ای")),
        hasWallet: texts.some((t) => t.includes("کیف پول فیتاپ")),
      };
    });
    check("C1 مدال خرید در اپ بازار باز شد", panelReady && plansReady && opened && modalState.open, `panel=${panelReady} plans=${plansReady} buy=${opened} ${modalState.text}`);
    check("C2 روش «پرداخت درون‌برنامه‌ای» (پیش‌فرض بازار) هست", modalState.hasIap === true);
    check("C3 گزینهٔ «کیف پول فیتاپ» به مدال بازار برگشت (دیرکتیو v212)", modalState.hasWallet === true);

    if (modalState.hasWallet) {
      await page.evaluate(() => {
        const dlg = Array.from(document.querySelectorAll("[role=dialog]")).find((d) => (d.textContent || "").includes("روش پرداخت"));
        const p = Array.from(dlg.querySelectorAll("button p")).find((x) => (x.textContent || "").includes("کیف پول فیتاپ"));
        p?.closest("button")?.click();
      });
      // انتظار برای به‌روزشدن دکمهٔ پرداخت به حالت کیف پول
      let payReady = true;
      try {
        await page.waitForFunction(
          () => {
            const dlg = Array.from(document.querySelectorAll("[role=dialog]")).find((d) => (d.textContent || "").includes("روش پرداخت"));
            return !!dlg && Array.from(dlg.querySelectorAll("button")).some((b) => /با کیف پول/.test(b.textContent || ""));
          },
          { timeout: 10000 }
        );
      } catch {
        payReady = false;
      }
      const payState = await page.evaluate(() => {
        const dlg = Array.from(document.querySelectorAll("[role=dialog]")).find((d) => (d.textContent || "").includes("روش پرداخت"));
        const btns = Array.from(dlg?.querySelectorAll("button") || []);
        const pay = btns.find((b) => /با کیف پول/.test(b.textContent || ""));
        return { label: pay?.textContent?.trim() || "", disabled: pay?.disabled ?? null };
      });
      check(
        "C4 دکمهٔ پرداخت = «پرداخت … با کیف پول» و فعال",
        payReady && /با کیف پول/.test(payState.label) && payState.disabled === false,
        JSON.stringify(payState)
      );
      const meBefore = await prisma.user.findUnique({ where: { id: userC.id }, select: { walletBalance: true } });
      await page.evaluate(() => {
        const dlg = Array.from(document.querySelectorAll("[role=dialog]")).find((d) => (d.textContent || "").includes("روش پرداخت"));
        const pay = Array.from(dlg.querySelectorAll("button")).find((b) => /با کیف پول/.test(b.textContent || ""));
        pay?.click();
      });
      // حقیقتِ زمینی: ردیف Payment در DB — و انتظار برای کامل شدن verify (تا ۶۵s)
      let payRow = null;
      let sub = null;
      for (let i = 0; i < 65; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        payRow = await prisma.payment.findFirst({
          where: { userId: userC.id, plan: { not: "wallet_topup" } },
          orderBy: { createdAt: "desc" },
        });
        sub = await prisma.subscription.findFirst({ where: { userId: userC.id }, orderBy: { createdAt: "desc" } });
        if (payRow?.status === "success" || sub) break;
      }
      const meAfter = await prisma.user.findUnique({ where: { id: userC.id }, select: { walletBalance: true } });
      const receiptTxt = await page.evaluate(() => {
        const dlg = Array.from(document.querySelectorAll("[role=dialog]")).find((d) => /موفق|فعال شد|ثبت شد|تایید پرداخت/.test(d.textContent || ""));
        return (dlg?.textContent || "").slice(0, 120);
      });
      check("C5 رسید موفق خرید با کیف پول نمایش داده شد", receiptTxt.length > 0 && /موفق|فعال شد|ثبت شد/.test(receiptTxt), receiptTxt);
      check("C6 موجودی کیف پول واقعاً کسر شد", (meBefore?.walletBalance ?? 0) > (meAfter?.walletBalance ?? 0), `${meBefore?.walletBalance} → ${meAfter?.walletBalance}`);
      check("C7 اشتراک ثبت شد (مسیر checkout — نه IAP بازار)", !!payRow && !!sub, `pay=${payRow?.status}/${payRow?.amount} sub=${sub?.status}`);
    }
    const fatalC = errors.filter((e) => !/ResizeObserver|favicon/i.test(e));
    check("C8 صفر خطای مرگبار (بخش C)", fatalC.length === 0, fatalC.slice(0, 2).join(" | "));
    await ctx.close();
  }

  // ═══════ بخش D — پرپرایم خودکار کد تخفیف پیامکی در مدال لندینگ ═══════
  console.log("\n═══ D) پرپرایم خودکار کد تخفیف اختصاصی (پیامک‌های تخفیف در همهٔ مدال‌ها) ═══");
  {
    const mobileD = "09350002335";
    let userD = await prisma.user.findUnique({ where: { mobile: mobileD } });
    if (!userD) userD = await prisma.user.create({ data: { mobile: mobileD, name: "کدخور" } });
    await prisma.userDiscountCode.deleteMany({ where: { userId: userD.id } });
    await prisma.user.update({
      where: { id: userD.id },
      data: { onboardingDone: true, planName: null, planExpiresAt: null, walletBalance: 0 },
    });
    // کد اختصاصی «هدیهٔ خرید اول» (پیامک 612964) — ۱۵٪ — استفاده‌نشده
    await prisma.userDiscountCode.create({
      data: {
        code: "FITAP15-V212TEST",
        userId: userD.id,
        type: "percent",
        value: 15,
        reason: "welcome_offer",
        isUsed: false,
        validUntil: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });
    const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
    check("D0 ورود واقعی OTP", (await loginIntoContext(ctx, mobileD)) === true);
    const dCookie = (await ctx.cookies(`${BASE}/`)).find((c) => c.name === "sc_session")?.value || "";
    // گرم‌کردن endpoint (در dev اولین hit کامپایل می‌شود و می‌تواند از تایم‌اوت
    // پرپرایمِ ۸ثانیه‌ای مدال فراتر برود — در production بیلد‌شده موضوعیت ندارد)
    try {
      await fetch(`${BASE}/api/user-discount-code`, { headers: { cookie: `sc_session=${dCookie}` } });
    } catch {}
    const page = await ctx.newPage();
    // لاگ شبکه برای دیاگنوستیک پرپرایم (وضعیت واقعی HTTP در جزئیات چک‌ها می‌آید)
    const netLog = [];
    page.on("response", (res) => {
      const u2 = res.url();
      if (u2.includes("user-discount-code") || u2.includes("/api/payment/discount")) {
        netLog.push(`${u2.replace(BASE, "").slice(0, 40)}→${res.status()}`);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // انتظار برای کامل شدن auth-check پس‌زمینه (set شدن user در استور) —
    // کلیک قبل از آن به auth ناوبری می‌شود و مدال باز نمی‌شود
    try {
      await page.waitForResponse(
        (res) => res.url().includes("/api/auth/me") && res.status() === 200,
        { timeout: 30000 }
      );
      await page.waitForTimeout(2000); // جای‌گذاری user در استور + رندر هدر
    } catch {}
    await closeStrayDialogs(page); // تور خوش‌آمد و…
    // باز کردن مدال خرید با retry (هیدریشن لندینگ در dev ممکن است کند باشد)
    let buyFound = "";
    let modalOpened = false;
    for (let attempt = 0; attempt < 6 && !modalOpened; attempt++) {
      // اگر کلیک قبلی به auth پرت شده بود (user هنوز ست نبود) → برگشت به لندینگ
      const onAuth = await page.evaluate(() => {
        const hasPurchase = Array.from(document.querySelectorAll("[role=dialog]")).some((d) => (d.textContent || "").includes("روش پرداخت"));
        const urlAuth = location.search.includes("screen=auth");
        return urlAuth && !hasPurchase;
      });
      if (onAuth) {
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        try {
          await page.waitForResponse((res) => res.url().includes("/api/auth/me") && res.status() === 200, { timeout: 20000 });
          await page.waitForTimeout(2000);
        } catch {}
        await closeStrayDialogs(page);
      }
      buyFound = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        const buy = btns.find((b) => /انتخاب پلن/.test(b.textContent || ""));
        buy?.click();
        return (buy?.textContent || "").trim().slice(0, 24);
      });
      await page.waitForTimeout(2500);
      modalOpened = await page.evaluate(() => {
        const dlgs = Array.from(document.querySelectorAll("[role=dialog]"));
        return dlgs.some((x) => (x.textContent || "").includes("روش پرداخت"));
      });
    }
    // انتظار فعالانه برای اعمال خودکار کد (GET + POST اعتبارسنجی سرور)
    let discountApplied = false;
    try {
      await page.waitForFunction(
        () => {
          const dlg = Array.from(document.querySelectorAll("[role=dialog]")).find((x) => (x.textContent || "").includes("روش پرداخت"));
          return !!dlg && /٪ تخفیف/.test(dlg.textContent || "");
        },
        { timeout: 25000 }
      );
      discountApplied = true;
    } catch {}
    await closeStrayDialogs(page);
    const d = await page.evaluate(() => {
      const dlgs = Array.from(document.querySelectorAll("[role=dialog]"));
      const dlg = dlgs.find((x) => (x.textContent || "").includes("روش پرداخت"));
      if (!dlg) return { open: false, text: (dlgs[0]?.textContent || "").slice(0, 140) };
      const txt = dlg.textContent || "";
      return {
        open: true,
        text: txt.slice(0, 200),
        hasApplied: /٪ تخفیف/.test(txt),
      };
    });
    check("D1 مدال خرید لندینگ باز شد", d.open === true, `buy="${buyFound}" ${d.text}`);
    check(
      "D2 کد اختصاصی پیامکی خودکار اعمال شد (۱۵٪ — بدون تایپ کاربر)",
      d.hasApplied === true,
      `net=[${netLog.join(", ")}] ${d.text.slice(0, 100)}`
    );
    await ctx.close();
  }

  await browser.close();

  // ═══════════════ پاک‌سازی داده‌های تست ═══════════════
  for (const mobile of ["09350002233", "09350002334", "09350002335", "09350002336", "09350002337"]) {
    const u = await prisma.user.findUnique({ where: { mobile } });
    if (!u) continue;
    await prisma.userDiscountCode.deleteMany({ where: { userId: u.id } });
    await prisma.subscription.deleteMany({ where: { userId: u.id } });
    await prisma.payment.deleteMany({ where: { userId: u.id } });
    await prisma.programRequest.deleteMany({ where: { userId: u.id } });
    await prisma.otpCode.deleteMany({ where: { mobile } });
    await prisma.user.update({
      where: { id: u.id },
      data: { onboardingDone: false, planName: null, planExpiresAt: null, walletBalance: 0 },
    });
  }
  await prisma.$disconnect();

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
