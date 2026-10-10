/**
 * v200 — تست E2E فیکس‌های تخفیف صفحهٔ تحلیل (root-cause fixes)
 * ① dedupe دیگر پرداختِ «بدون تخفیف» را با توکن معتبر بازیاستفاده نمی‌کند
 * ② revoke هدفمند (توکنِ خود صفحه) — beacon دیرهنگام توکن جدید را نمی‌کشد
 * ③ مصرف اتمیک توکن (دو checkout موازی ≠ دو تخفیف)
 */
const BASE = "http://localhost:3000";
const MOBILE = "09129988776";

function assert(cond, label) {
  const icon = cond ? "✅" : "❌";
  console.log(`${icon} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  // ─── ۰. آماده‌سازی: پاکسازی قبلی + ساخت کاربر تست ───
  await db.user.deleteMany({ where: { mobile: MOBILE } });
  const now = new Date();
  await db.otpCode.create({
    data: { mobile: MOBILE, code: "1234", expiresAt: new Date(now.getTime() + 10 * 60 * 1000), attempts: 0 },
  });

  // ─── ۱. ورود (verify-otp) → کوکی سشن ───
  const verifyRes = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: MOBILE, code: "1234" }),
  });
  const verifyJson = await verifyRes.json();
  assert(verifyJson?.ok !== false && verifyRes.status === 200, "ورود با OTP موفق");
  const setCookies = verifyRes.headers.getSetCookie ? verifyRes.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  assert(!!cookie, "کوکی سشن دریافت شد");
  const H = { "Content-Type": "application/json", Cookie: cookie };

  const user = await db.user.findUnique({ where: { mobile: MOBILE } });
  assert(!!user, "کاربر در DB ساخته شد");

  // ─── ۲. آنبوردینگ تکمیل (گارد سرور checkout) ───
  await db.user.update({ where: { id: user.id }, data: { onboardingDone: true } });

  // قیمت پلن‌ها از API رسمی (siteSetting در DB)
  const plansRes = await fetch(`${BASE}/api/payment/checkout`);
  const plansJson = await plansRes.json();
  const priceOf = (id) => plansJson?.plans?.find((p) => p.id === id)?.price ?? 0;
  const advPrice = priceOf("advanced");
  console.log(`ℹ️  قیمت پلن advanced در DB: ${advPrice}`);

  // ─── ۳. [باگ ①] پرداخت معلق قدیمی «بدون تخفیف» (مثل تلاش قبلی قبل از صفحهٔ تحلیل) ───
  const stale = await db.payment.create({
    data: {
      userId: user.id,
      amount: advPrice,
      originalAmount: advPrice,
      plan: "advanced",
      paymentMethod: "gateway",
      status: "pending",
      source: "web",
      description: "v200-test: stale full-price payment",
    },
  });
  console.log(`ℹ️  پرداخت قدیمی بدون تخفیف ساخته شد: ${stale.id.slice(-8)}`);

  // ─── ۴. grant توکن تخفیف صفحهٔ تحلیل ───
  const grantRes = await fetch(`${BASE}/api/onboarding/analysis-discount`, {
    method: "POST", headers: H, body: JSON.stringify({ action: "grant" }),
  });
  const grantJson = await grantRes.json();
  assert(grantJson?.ok === true && !!grantJson?.token, "توکن تخفیف صادر شد (grant)");
  const token1 = grantJson.token;

  // ─── ۵. checkout با توکن — نباید پرداخت قدیمی بازیاستفاده شود؛ باید ۱۰٪ کم شود ───
  const coRes = await fetch(`${BASE}/api/payment/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({ planId: "advanced", paymentMethod: "gateway", analysisDiscountToken: token1 }),
  });
  const co = await coRes.json();
  const expectedFinal = advPrice - Math.round(advPrice * 0.1);
  assert(co?.reused !== true, "پرداخت قدیمیِ بدون تخفیف بازیاستفاده نشد (فیکس باگ ①)");
  assert(co?.finalAmount === expectedFinal, `مبلغ نهایی با تخفیف درست است (${co?.finalAmount} === ${expectedFinal})`);
  assert(co?.analysisDiscountApplied === true, "پاسخ سرور: analysisDiscountApplied=true");
  assert(co?.analysisDiscountValue === Math.round(advPrice * 0.1), `مقدار تخفیف درست (${co?.analysisDiscountValue})`);
  assert(!!co?.gatewayUrl, "درگاه (sandbox) ساخته شد");

  // ─── ۶. [باگ ②] مسابقه revoke-grant: grant دوم → beacon دیرهنگامِ grant اول ───
  const g2 = await (await fetch(`${BASE}/api/onboarding/analysis-discount`, { method: "POST", headers: H, body: JSON.stringify({ action: "grant" }) })).json();
  const token2 = g2.token;
  const g3 = await (await fetch(`${BASE}/api/onboarding/analysis-discount`, { method: "POST", headers: H, body: JSON.stringify({ action: "grant" }) })).json();
  const token3 = g3.token;
  // beacon دیرهنگام صفحهٔ قبلی — فقط token2 را می‌فرستد
  await fetch(`${BASE}/api/onboarding/analysis-discount`, { method: "POST", headers: H, body: JSON.stringify({ action: "revoke", token: token2 }) });
  const st3 = await db.paymentToken.findFirst({ where: { token: token3 } });
  assert(st3 && st3.expiresAt > new Date(), "توکنِ صفحهٔ جدید پس از beacon دیرهنگام زنده ماند (فیکس باگ ②)");

  // ─── ۷. مصرف اتمیک: توکن token3 فقط یک‌بار قابل مصرف ───
  const co2Res = await fetch(`${BASE}/api/payment/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({ planId: "ultimate", paymentMethod: "gateway", analysisDiscountToken: token3 }),
  });
  const co2 = await co2Res.json();
  const ultPrice = priceOf("ultimate");
  assert(co2?.analysisDiscountApplied === true && co2?.finalAmount === ultPrice - Math.round(ultPrice * 0.1), `checkout دوم با توکن جدید، تخفیف درست (${co2?.finalAmount})`);
  // مصرف دوبارهٔ همان توکن → نباید دوباره تخفیف بخورد
  const co3Res = await fetch(`${BASE}/api/payment/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({ planId: "basic", paymentMethod: "gateway", analysisDiscountToken: token3 }),
  });
  const co3 = await co3Res.json();
  assert(co3?.analysisDiscountApplied === false, "توکن مصرف‌شده دوباره تخفیف نمی‌گیرد (اتمیک)");

  // ─── ۸. رگرسیون: dedupe عادی (بدون توکن) باید کار کند ───
  const co4Res = await fetch(`${BASE}/api/payment/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({ planId: "basic", paymentMethod: "gateway" }),
  });
  const co4 = await co4Res.json();
  assert(co4?.reused === true && co4?.finalAmount === co3?.finalAmount, "dedupe عادی (بدون توکن) سالم — همان پرداخت بازگشت");

  // ─── ۹. کد تخفیف عمومی + توکن تحلیل هم‌زمان (اولویت درست) ───
  const dc = await db.discountCode.create({
    data: { code: "V200TEST", type: "percent", value: 20, active: true, applicablePlans: "all" },
  });
  const g4 = await (await fetch(`${BASE}/api/onboarding/analysis-discount`, { method: "POST", headers: H, body: JSON.stringify({ action: "grant" }) })).json();
  const co5Res = await fetch(`${BASE}/api/payment/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({ planId: "standard", paymentMethod: "gateway", discountCode: "V200TEST", analysisDiscountToken: g4.token }),
  });
  const co5 = await co5Res.json();
  const stdPrice = priceOf("standard");
  const exp5 = stdPrice - Math.round(stdPrice * 0.2) - Math.round((stdPrice - Math.round(stdPrice * 0.2)) * 0.1);
  assert(co5?.finalAmount === exp5, `کد ۲۰٪ + تخفیف تحلیل ۱۰٪ پشت‌سرهم (${co5?.finalAmount} === ${exp5})`);

  // ─── ۱۰. رگرسیون: پرداخت کیف پول با توکن ───
  await db.user.update({ where: { id: user.id }, data: { walletBalance: 999999999 } });
  const g5 = await (await fetch(`${BASE}/api/onboarding/analysis-discount`, { method: "POST", headers: H, body: JSON.stringify({ action: "grant" }) })).json();
  const co6Res = await fetch(`${BASE}/api/payment/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({ planId: "advanced", paymentMethod: "wallet", analysisDiscountToken: g5.token }),
  });
  const co6 = await co6Res.json();
  assert(co6?.analysisDiscountApplied === true && co6?.finalAmount === expectedFinal, `کیف پول هم تخفیف تحلیل می‌گیرد (${co6?.finalAmount})`);

  // ─── پاکسازی ───
  await db.discountCode.delete({ where: { code: "V200TEST" } });
  const payments = await db.payment.findMany({ where: { userId: user.id } });
  await db.paymentToken.deleteMany({ where: { userId: user.id } });
  await db.payment.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log(`ℹ️  پاکسازی انجام شد (${payments.length} پرداخت تست حذف شد)`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ خطای اسکریپت:", e.message);
  process.exit(1);
});
