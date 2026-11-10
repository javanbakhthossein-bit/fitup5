/**
 * v209 — راستی‌آزمایی مرورگری فیکس‌های آنبوردینگ:
 *  ① ضربه روی «بیضی» (فرم بدن) → پرش به اول سؤال ندارد و بعد از ~۳۰۰ms
 *     اسکرول نرم، بخش اختیاری پایین (ریکاوری) را جلوی چشم می‌آورد
 *  ② در مرحلهٔ ۱ هم: انتخاب هدف → اسکرول نرم به «سطح فعالیت روزانه»
 *  ③ صفر خطای مرگبار کنسول
 *
 * اجرا: bun scripts/verify-v209-onboarding.mjs (سرور dev لازم است)
 */
import { chromium, devices } from "playwright";
import { readFileSync } from "fs";
import { scryptSync } from "crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const MOBILE = "09350001122";
const shot = (n) => `/tmp/v209-verify-${n}.png`;

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

function makeSessionToken(userId, secret) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

async function main() {
  const secret = readFileSync("/home/z/my-project/db/.session-secret", "utf8").trim();
  const prisma = new PrismaClient();
  let user = await prisma.user.findUnique({ where: { mobile: MOBILE } });
  if (!user) user = await prisma.user.create({ data: { mobile: MOBILE, name: "تستی" } });
  if (user.onboardingDone) {
    user = await prisma.user.update({ where: { id: user.id }, data: { onboardingDone: false } });
  }
  const token = makeSessionToken(user.id, secret);
  await prisma.$disconnect();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "fa-IR" });
  await ctx.addCookies([{ name: "sc_session", value: token, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 120));
  });

  // ?screen=auth → doAuthCheck → کاربر با onboardingDone=false → setScreen("onboarding")
  await page.goto(`${BASE}/?screen=auth`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const appeared = await page
    .locator("text=اطلاعات پایه")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  check("آنبوردینگ بالا آمد", appeared);
  if (!appeared) {
    await browser.close();
    process.exit(2);
  }
  // dev-mode: صبر تا جاافتادن کامل بوت/HMR — در production وجود ندارد ولی
  // در dev یک رویداد دیرهنگام (اتصال HMR) می‌تواند درخواست‌های اولیه را ببلعد
  await page.waitForTimeout(8000);

  // ─── پر کردن مرحلهٔ ۰ ───
  const inputs = page.locator("input");
  const fill = async (i, v) => {
    const el = inputs.nth(i);
    await el.scrollIntoViewIfNeeded();
    await el.fill(v);
  };
  await fill(0, "تستی");
  await fill(1, "کاربر");
  await page.locator("button", { hasText: "👨" }).first().click();
  await page.waitForTimeout(400);
  await fill(2, "28");
  await fill(3, "178");
  await fill(4, "82");

  const scroller = page.locator("div.overflow-y-auto.custom-scrollbar").first();
  const oval = page.locator("button", { hasText: "بیضی" }).first();
  // بیضی را دقیقاً وسط دید می‌آوریم (کلیک بدون auto-scroll پلای‌رایت)
  await oval.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(800);

  // ─── ① ضربه روی بیضی ───
  const before = await scroller.evaluate((el) => {
    const btns = [...el.querySelectorAll("button")];
    const b = btns.find((x) => x.textContent?.includes("بیضی"));
    return {
      scrollTop: el.scrollTop,
      ovalTop: b?.getBoundingClientRect().top ?? null,
    };
  });
  // کلیک واقعی DOM (بدون auto-scroll/هندسهٔ پلای‌رایت — عین ضربهٔ کاربر)
  await oval.evaluate((el) => el.click());
  await page.waitForTimeout(100); // قبل از تایمر اسکرول کنترل‌شده (۲۸۰ms)
  const justAfter = await scroller.evaluate((el) => ({
    scrollTop: el.scrollTop,
    ovalTop: (() => {
      const btns = [...el.querySelectorAll("button")];
      const b = btns.find((x) => x.textContent?.includes("بیضی"));
      return b?.getBoundingClientRect().top ?? null;
    })(),
  }));
  await page.waitForTimeout(1500); // پایان اسکرول نرم
  const after = await scroller.evaluate((el) => {
    const blocks = [...el.querySelectorAll("[data-onb-q]")];
    const recovery = blocks.find((b) => b.textContent?.includes("ریکاوری و سبک زندگی"));
    const rr = recovery?.getBoundingClientRect();
    const scRect = el.getBoundingClientRect();
    const btns = [...el.querySelectorAll("button")];
    const b = btns.find((x) => x.textContent?.includes("بیضی"));
    return {
      scrollTop: el.scrollTop,
      recoveryDeltaFromScrollerTop: rr ? rr.top - scRect.top : null,
      recoveryInView: rr ? rr.top >= scRect.top - 60 && rr.top < scRect.bottom : false,
      ovalTop: b?.getBoundingClientRect().top ?? null,
    };
  });
  const jumpAtTap = Math.abs(justAfter.scrollTop - before.scrollTop);
  check(
    `بدون پرشِ پس از ضربه (Δ=${jumpAtTap}px ≤ 40 — قبل از اسکرول کنترل‌شده)`,
    jumpAtTap <= 40,
    `before=${before.scrollTop} at100ms=${justAfter.scrollTop}`
  );
  check(
    `خود بیضی هم در جای خود ماند (Δtop=${Math.round((justAfter.ovalTop ?? 0) - (before.ovalTop ?? 0))}px ≤ 40)`,
    Math.abs((justAfter.ovalTop ?? 0) - (before.ovalTop ?? 0)) <= 40,
    `ovalTop ${before.ovalTop} → ${justAfter.ovalTop}`
  );
  check(
    `اسکرول نرم به بعد انجام شد (Δ=${Math.round(after.scrollTop - before.scrollTop)}px > 40)`,
    after.scrollTop - before.scrollTop > 40,
    `scrollTop ${before.scrollTop} → ${after.scrollTop}`
  );
  check(
    `بخش اختیاری (ریکاوری) حالا دیده می‌شود (Δاز بالای اسکرولر=${Math.round(after.recoveryDeltaFromScrollerTop ?? -999)}px)`,
    after.recoveryInView === true,
    JSON.stringify({ recoveryDeltaFromScrollerTop: after.recoveryDeltaFromScrollerTop })
  );
  await page.screenshot({ path: shot("1-bodyform-after"), timeout: 8000 }).catch(() => {});

  // ─── ② ادامه → مرحلهٔ ۱ → انتخاب هدف → اسکرول به سطح فعالیت ───
  const nextBtn = page.locator("button", { hasText: "ادامه" }).first();
  await nextBtn.click();
  await page
    .locator("text=سطح فعالیت و اهداف")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(700);
  const goalBtn = page.locator("button", { hasText: "کاهش وزن" }).first();
  await goalBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await goalBtn.evaluate((el) => el.click());
  await page.waitForTimeout(1400);
  const step1 = await scroller.evaluate((el) => {
    const blocks = [...el.querySelectorAll("[data-onb-q]")];
    const act = blocks.find((b) => b.textContent?.includes("سطح فعالیت روزانه"));
    const r = act?.getBoundingClientRect();
    const scRect = el.getBoundingClientRect();
    return { delta: r ? r.top - scRect.top : null };
  });
  check(
    `مرحلهٔ ۱: انتخاب هدف → «سطح فعالیت روزانه» نزدیک بالای دید (Δ=${Math.round(step1.delta ?? -999)}px ≤ 60)`,
    step1.delta !== null && step1.delta >= -20 && step1.delta <= 60,
    JSON.stringify(step1)
  );
  await page.screenshot({ path: shot("2-step1-after"), timeout: 8000 }).catch(() => {});

  const fatalErrors = errors.filter(
    (e) => !e.includes("favicon") && !e.includes("net::") && !e.includes("websocket") && !e.includes("Failed to load resource")
  );
  check("صفر خطای مرگبار کنسول", fatalErrors.length === 0, fatalErrors.slice(0, 3).join(" | "));

  await browser.close();

  // پاک‌سازی کاربر تستی
  const p2 = new PrismaClient();
  await p2.user.deleteMany({ where: { mobile: MOBILE } });
  await p2.$disconnect();

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
