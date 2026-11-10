/**
 * v248 — E2E پرداخت (بدون سوزاندن پیامک): تزریق OTP در DB → verify-otp →
 * آنبوردینگ → checkout (درگاه شبیه‌سازی سندباکس) → verify → اشتراک فعال.
 * پاک‌سازی کامل ردیف‌های تست در پایان.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const MOBILE = "0999" + String(Math.floor(Math.random() * 9000000) + 1000000);
let cookie = "";

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) },
  });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  for (const sc of setCookies) {
    const m = sc.match(/^(sc_session=[^;]+)/);
    if (m) cookie = m[1];
  }
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

function log(step, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} [${step}] ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("════════ E2E v248: مسیر کامل پرداخت (بدون پیامک واقعی) ════════");
  console.log(`موبایل تست: ${MOBILE}\n`);

  // ─── ۱) تزریق OTP در DB (الگوی v202 — هش SHA-256 با salt داخلی) ───
  const code = "1357";
  const hash = createHash("sha256").update(`fitup-otp:${code}`).digest("hex");
  await db.otpCode.create({
    data: { mobile: MOBILE, code: hash, expiresAt: new Date(Date.now() + 10 * 60_000), used: false, attempts: 0 },
  });
  log("inject-otp", true, "کد تست در DB تزریق شد (بدون ارسال پیامک)");

  // ─── ۲) verify-otp (ایجاد کاربر + سشن) ───
  let r = await api("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ mobile: MOBILE, code, name: "تست پرداخت v248" }),
  });
  log("verify-otp", r.status === 200 && !!r.body?.id, `status=${r.status} user=${r.body?.id ?? "-"} onboardingDone=${r.body?.onboardingDone}`);
  const userId = r.body?.id;
  if (!userId) return;

  // ─── ۳) آنبوردینگ ───
  r = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({
      firstName: "علی", lastName: "تست", gender: "male", age: 28, height: 178, weight: 80,
      goal: "muscle_gain", activityLevel: "moderate", trainingExperience: "beginner", workoutDays: 3, workoutPlace: "gym", dietType: "balanced",
    }),
  });
  log("onboarding", r.status === 200, `status=${r.status} ${r.body?.error ?? ""}`);

  // ─── ۴) checkout (درگاه شبیه‌سازی‌شده سندباکس) ───
  r = await api("/api/payment/checkout", {
    method: "POST",
    body: JSON.stringify({ planId: "basic", paymentMethod: "gateway" }),
  });
  const paymentId = r.body?.paymentId;
  const authority = r.body?.authority;
  log(
    "checkout",
    r.status === 200 && !!paymentId && !!authority,
    `status=${r.status} paymentId=${paymentId ?? "-"} authority=${authority?.slice(0, 14) ?? "-"}… simulated=${r.body?.simulated} مبلغ=${r.body?.finalAmount}`
  );
  if (!paymentId) return;

  // ─── ۵) verify (مثل callback موفق زرین‌پال) ───
  r = await api("/api/payment/verify", {
    method: "POST",
    body: JSON.stringify({ paymentId, status: "OK", authority }),
  });
  log(
    "verify",
    r.status === 200 && r.body?.success === true && r.body?.status === "success",
    `http=${r.status} status=${r.body?.status} refId=${r.body?.refId ?? "-"} اشتراک=${r.body?.subscriptionStatus ?? "-"} پایان=${r.body?.subscriptionEnd?.slice(0, 10) ?? "-"}`
  );

  // ─── ۶) چک نهایی DB: Payment + Subscription ───
  const pay = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true, amount: true, refId: true, plan: true, source: true } });
  const sub = await db.subscription.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { status: true, plan: true, endDate: true } });
  log("payment-db", pay?.status === "success", `status=${pay?.status} plan=${pay?.plan} amount=${pay?.amount} refId=${pay?.refId ?? "-"}`);
  log("subscription-db", !!sub, sub ? `status=${sub.status} plan=${sub.plan} تا=${sub.endDate?.toISOString?.().slice(0, 10)}` : "ساخته نشد");

  // ─── ۷) پاک‌سازی کامل ───
  await db.subscription.deleteMany({ where: { userId } });
  await db.payment.deleteMany({ where: { userId } });
  await db.otpCode.deleteMany({ where: { mobile: MOBILE } });
  await db.onboardingProfile.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  console.log("\n🧹 پاک‌سازی: کاربر/پرداخت/اشتراک/OTP تست حذف شدند");
  await db.$disconnect();
}

await main();
