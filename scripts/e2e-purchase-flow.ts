/**
 * E2E تست فرایند خرید + تولید برنامه — سندباکس
 *
 * مسیر: OTP → آنبوردینگ → checkout (درگاه شبیه‌سازی) → verify → تحویل پلن + تولید برنامه
 * اجرا: bun scripts/e2e-purchase-flow.ts
 */

export {}; // ماژول — برای جلوگیری از تداخل global با اسکریپت‌های دیگر
const BASE = "http://localhost:3000";
const MOBILE = "0915" + String(Math.floor(Math.random() * 9000000) + 1000000);
let cookie = "";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  // همهٔ set-cookie ها را بگیر و کوکی سشن (sc_session) را نگه دار
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const sc of setCookies) {
    const m = sc.match(/^(sc_session=[^;]+)/);
    if (m) cookie = m[1];
  }
  let body: any = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

function log(step: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✅" : "❌"} [${step}] ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("════════ E2E: خرید پلن + تولید برنامه ════════");
  console.log(`موبایل تست: ${MOBILE}\n`);

  // ─── ۱) ارسال OTP ───
  let r = await api("/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify({ mobile: MOBILE }),
  });
  const devCode = r.body?.devCode;
  log("send-otp", r.status === 200 && !!devCode, `status=${r.status} devCode=${devCode ? "دریافت شد" : "ندارد"}`);
  if (!devCode) return;

  // ─── ۲) تأیید OTP ───
  r = await api("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ mobile: MOBILE, code: devCode, name: "تست خرید" }),
  });
  log("verify-otp", r.status === 200 && !!r.body?.id, `status=${r.status} user=${r.body?.name ?? r.body?.mobile ?? "-"} onboardingDone=${r.body?.onboardingDone}`);

  // ─── ۳) آنبوردینگ ───
  r = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({
      firstName: "علی",
      lastName: "تست",
      gender: "male",
      age: 28,
      height: 178,
      weight: 80,
      goal: "muscle_gain",
      activityLevel: "moderate",
      workoutDays: 3,
      workoutPlace: "gym",
      dietType: "balanced",
    }),
  });
  log("onboarding", r.status === 200, `status=${r.status} ${r.body?.error ?? ""}`);

  // ─── ۴) checkout (درگاه شبیه‌سازی‌شده) ───
  r = await api("/api/payment/checkout", {
    method: "POST",
    body: JSON.stringify({ planId: "basic", paymentMethod: "gateway" }),
  });
  const paymentId = r.body?.paymentId;
  const authority = r.body?.authority;
  const simulated = r.body?.simulated;
  log(
    "checkout",
    r.status === 200 && !!paymentId && !!authority,
    `status=${r.status} paymentId=${paymentId ?? "-"} authority=${authority?.slice(0, 14) ?? "-"}… simulated=${simulated} مبلغ=${r.body?.finalAmount}`
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
    `status=${r.status} http ${r.body?.status} refId=${r.body?.refId ?? "-"} اشتراک=${r.body?.subscriptionStatus ?? "-"} پایان=${r.body?.subscriptionEnd?.slice(0, 10) ?? "-"}`
  );

  // ─── ۶) انتظار برای تولید برنامه (AI واقعی: تا ~۵ دقیقه) ───
  console.log("\n⏳ در انتظار تولید برنامه با AI واقعی (تا ۵ دقیقه)...");
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    process.stdout.write(`\r   poll ${i + 1}/60 — ${(i + 1) * 5}s`);
  }

  // چک مستقیم DB برای نتیجه قطعی
  const { execSync } = await import("node:child_process");
  execSync(
    `cat > /tmp/e2e-db-check.ts << 'DBEOF'
import { db } from "/home/z/my-project/src/lib/db";
const pr = await db.programRequest.findFirst({ orderBy: { createdAt: "desc" } });
const wp = await db.workoutPlan.findFirst({ orderBy: { createdAt: "desc" }, select: { active: true, createdAt: true } });
const mp = await db.mealPlan.findFirst({ orderBy: { createdAt: "desc" }, select: { active: true, totalCal: true, createdAt: true } });
const sub = await db.subscription.findFirst({ orderBy: { createdAt: "desc" }, select: { status: true, plan: true, paymentId: true } });
const pay = await db.payment.findFirst({ orderBy: { createdAt: "desc" }, select: { status: true, amount: true, refId: true, plan: true } });
console.log(JSON.stringify({ programRequest: pr ? { status: pr.status, plan: pr.plan } : null, workoutPlan: wp, mealPlan: mp, subscription: sub, payment: pay }));
process.exit(0);
DBEOF`,
    { encoding: "utf8" }
  );
  const dbOut = execSync("bun /tmp/e2e-db-check.ts 2>/dev/null | tail -1", {
    cwd: "/home/z/my-project",
    encoding: "utf8",
  });
  const state = JSON.parse(dbOut.trim());
  console.log("\n── وضعیت نهایی دیتابیس ──");
  log(
    "payment",
    state.payment?.status === "success",
    `status=${state.payment?.status} plan=${state.payment?.plan} مبلغ=${state.payment?.amount} refId=${state.payment?.refId}`
  );
  log(
    "subscription",
    state.subscription?.status === "active",
    `status=${state.subscription?.status} plan=${state.subscription?.plan}`
  );
  log(
    "program-request",
    state.programRequest?.status === "ready",
    `status=${state.programRequest?.status} plan=${state.programRequest?.plan}`
  );
  log(
    "workout-plan",
    !!state.workoutPlan?.active,
    `active=${state.workoutPlan?.active} ساخته‌شده=${state.workoutPlan?.createdAt}`
  );
  log(
    "meal-plan",
    !!state.mealPlan?.active,
    `active=${state.mealPlan?.active} کالری=${state.mealPlan?.totalCal}`
  );

  const allOk =
    state.payment?.status === "success" &&
    state.subscription?.status === "active" &&
    state.programRequest?.status === "ready" &&
    state.workoutPlan?.active &&
    state.mealPlan?.active;
  console.log(allOk ? "\n🎉 E2E کامل موفق: خرید → اشتراک → تولید برنامه" : "\n⚠️ بخشی از زنجیره ناقص است");
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
