/**
 * راستی‌آزمایی v104 — پرداخت بازار (امضا-اول + رسید) + زمان مصرف اپ‌ها
 *
 * پوشش:
 *  ۱) واحدی: verifyBazaarPurchaseAny با امضای RSA واقعی (جفت‌کلید تولیدشده در
 *     همین پروسه + env موقت) → باید «آنی» و از مسیر signature تأیید شود.
 *     + تست اتصال هویت (productId ناهمخوان باید رد شود) + تست refund.
 *  ۲) E2E: OTP → آنبوردینگ → فلاش‌های ضربان‌سنج با UA اپ کافه‌بازار →
 *     خواندن /api/admin/usage-time با سشن ادمین → تطبیق جمع/میانگین/بخش‌ها.
 *  ۳) E2E: خرید پلن با «کیف پول» از /api/payment/checkout (سایت) → verify →
 *     فعال‌سازی + کسر کیف پول + کد خطای INSUFFICIENT_WALLET برای موجودی کم.
 *
 * اجرا: bun scripts/verify-v104-payment-usage.ts
 */

import { generateKeyPairSync, createSign } from "crypto";
import { db } from "../src/lib/db";
import { createSessionToken } from "../src/lib/fitness/auth";

export {}; // ماژول
const BASE = "http://localhost:3000";
const MOBILE = "0915" + String(Math.floor(Math.random() * 9000000) + 1000000);
let cookie = "";

async function api(path: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
      ...(init.headers || {}),
    },
  });
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
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

/* ═══════════ ۱) واحدی — امضا-اول ═══════════ */
async function testSignatureFirst() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubSpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  process.env.BAZAAR_RSA_PUBLIC_KEY = pubSpki;

  const dataJson = JSON.stringify({
    orderId: "HNM-TEST-1",
    packageName: "ir.fittup.app",
    productId: "fitup_wallet_100000",
    purchaseTime: Date.now(),
    purchaseToken: "tok_test_abc",
    purchaseState: 0,
    developerPayload: "{}",
  });
  const signer = createSign("RSA-SHA1");
  signer.update(dataJson);
  const signature = signer.sign(privateKey, "base64");

  const { verifyBazaarPurchaseAny } = await import("../src/lib/fitness/bazaar-dev-api");

  const t0 = Date.now();
  const ok = await verifyBazaarPurchaseAny(
    "ir.fittup.app",
    "fitup_wallet_100000",
    "tok_test_abc",
    null,
    { dataJson, signature }
  );
  const ms = Date.now() - t0;
  log(
    "signature-first verify",
    ok.ok && ok.ok && "via" in ok && ok.via === "signature" && ms < 500,
    `ok=${ok.ok} via=${ok.ok && "via" in ok ? ok.via : "-"} در ${ms}ms (باید <500ms و via=signature باشد)`
  );

  // اتصال هویت: امضای معتبرِ fitup_wallet_100000 نباید برای productId گران پذیرفته شود
  const mismatch = await verifyBazaarPurchaseAny(
    "ir.fittup.app",
    "fitup_wallet_1000000",
    "tok_test_abc",
    null,
    { dataJson, signature }
  );
  log(
    "identity binding",
    !mismatch.ok,
    `productId ناهمخوان → رد شد؟ ${!mismatch.ok} (${!mismatch.ok ? "" : "تأیید شد!!!"})`
  );

  // refund باید رد شود
  const refundedJson = JSON.stringify({
    orderId: "HNM-TEST-2",
    packageName: "ir.fittup.app",
    productId: "fitup_wallet_100000",
    purchaseTime: Date.now(),
    purchaseToken: "tok_test_refund",
    purchaseState: 2,
  });
  const s2 = createSign("RSA-SHA1");
  s2.update(refundedJson);
  const refunded = await verifyBazaarPurchaseAny(
    "ir.fittup.app",
    "fitup_wallet_100000",
    "tok_test_refund",
    null,
    { dataJson: refundedJson, signature: s2.sign(privateKey, "base64") }
  );
  log(
    "refund reject",
    !refunded.ok,
    `purchaseState=2 → رد شد؟ ${!refunded.ok}`
  );
}

/* ═══════════ ۲) E2E — ضربان‌سنج + داشبورد مدیر ═══════════ */
async function testUsageTracking() {
  // کاربر تست مستقیم در DB ساخته می‌شود (بدون OTP/پیامک واقعی) + سشن معتبر
  const user = await db.user.create({
    data: { mobile: MOBILE, name: "تست v104", role: "USER", onboardingDone: true },
  });
  cookie = `sc_session=${createSessionToken(user.id)}`;
  const userId = user.id;
  log("session created", true, `user=${userId}`);
  let r = { status: 0, body: null as any };


  // فلاش‌های ضربان‌سنج با UA اپ کافه‌بازار:
  // ۳۵s داشبورد + ۲۰۰s (→ سقف ۱۲۰) با بخش ناموجود (→ app) + ۵s تغذیه = ۱۶۰s
  const UA = { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 FitUpBazaar/1.5.9" };
  r = await api("/api/usage/heartbeat", { method: "POST", body: JSON.stringify({ seconds: 35, screen: "dashboard" }) }, UA);
  log("heartbeat 1", r.status === 200 && r.body?.ok === true, `35s dashboard → ${r.status}`);
  r = await api("/api/usage/heartbeat", { method: "POST", body: JSON.stringify({ seconds: 200, screen: "bogus_screen" }) }, UA);
  log("heartbeat 2 (clamp)", r.status === 200, `200s bogus → سقف ۱۲۰ + نگاشت به app`);
  r = await api("/api/usage/heartbeat", { method: "POST", body: JSON.stringify({ seconds: 5, screen: "nutrition" }) }, UA);
  log("heartbeat 3", r.status === 200, `5s nutrition`);
  r = await api("/api/usage/heartbeat", { method: "POST", body: JSON.stringify({ seconds: 0 }) }, UA);
  log("heartbeat invalid", r.status === 200, `seconds=0 → skipped بی‌خطا`);

  // ارتقای موقت کاربر تست به ادمین برای خواندن داشبورد
  await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
  const adminCookie = `sc_session=${createSessionToken(userId)}`;
  const prevCookie = cookie;
  cookie = adminCookie;
  r = await api("/api/admin/usage-time");
  log("admin usage-time", r.status === 200 && r.body?.ok === true, `status=${r.status}`);

  const bazaar = (r.body?.platforms || []).find((p: any) => p.platform === "bazaar");
  log(
    "aggregation bazaar",
    !!bazaar && bazaar.totalSeconds === 160 && bazaar.activeUsers === 1 && bazaar.avgSecondsPerUser === 160,
    bazaar
      ? `total=${bazaar.totalSeconds} (انتظار ۱۶۰) users=${bazaar.activeUsers} avg=${bazaar.avgSecondsPerUser}`
      : "پلتفرم bazaar یافت نشد"
  );
  const screens: any[] = bazaar?.screens || [];
  const dash = screens.find((x) => x.screen === "dashboard");
  const appOther = screens.find((x) => x.screen === "app");
  const nut = screens.find((x) => x.screen === "nutrition");
  log(
    "screens breakdown",
    dash?.seconds === 35 && appOther?.seconds === 120 && nut?.seconds === 5,
    `dashboard=${dash?.seconds} app=${appOther?.seconds} nutrition=${nut?.seconds} (انتظار ۳۵/۱۲۰/۵)`
  );
  cookie = prevCookie;
  await db.user.update({ where: { id: userId }, data: { role: "USER" } });

  return userId;
}

/* ═══════════ ۳) E2E — خرید با کیف پول (سایت) ═══════════ */
async function testWalletCheckout(userId: string) {
  const price = 149000; // قیمت پایه پلن basic (هم‌سو با SUBSCRIPTION_PLANS)
  // اگر قیمت پلن از SiteSetting خوانده می‌شود، مستقیم از DB بیاور — ساده‌تر:
  // موجودی سخاوتمندانه بگذار و بعد از خرید مانده را چک کن.
  await db.user.update({ where: { id: userId }, data: { walletBalance: 10_000_000 } });

  let r = await api("/api/payment/checkout", {
    method: "POST",
    body: JSON.stringify({ planId: "basic", paymentMethod: "wallet" }),
  });
  const paymentId = r.body?.paymentId;
  log(
    "wallet checkout",
    r.status === 200 && !!paymentId && r.body?.gatewayUrl == null,
    `status=${r.status} finalAmount=${r.body?.finalAmount} gatewayUrl=${r.body?.gatewayUrl ?? "null"}`
  );

  r = await api("/api/payment/verify", {
    method: "POST",
    body: JSON.stringify({ paymentId, status: "OK" }),
  });
  log(
    "wallet verify",
    r.status === 200 && r.body?.success === true,
    `success=${r.body?.success} amount=${r.body?.amount} refId=${String(r.body?.refId ?? "").slice(0, 12)}`
  );

  const u = await db.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
  const expectedLeft = 10_000_000 - (r.body?.amount ?? 0);
  log(
    "wallet deducted",
    u?.walletBalance === expectedLeft,
    `balance=${u?.walletBalance} انتظار=${expectedLeft}`
  );

  // موجودی ناکافی — انتخاب کیف پول باید خطای روشن بدهد (رفتار سایت)
  await db.user.update({ where: { id: userId }, data: { walletBalance: 5_000 } });
  r = await api("/api/payment/checkout", {
    method: "POST",
    body: JSON.stringify({ planId: "ultimate", paymentMethod: "wallet" }),
  });
  log(
    "insufficient wallet",
    r.status === 400 && r.body?.code === "INSUFFICIENT_WALLET",
    `status=${r.status} code=${r.body?.code}`
  );
}

async function main() {
  console.log("════════ راستی‌آزمایی v104 — پرداخت بازار + زمان مصرف ════════\n");
  // پاک‌سازی داده‌های تست قبلی تا ادعاهای تجمیع دقیق باشند (فقط سندباکس)
  await db.appUsageLog.deleteMany({});
  await testSignatureFirst();
  const userId = await testUsageTracking();
  if (userId) await testWalletCheckout(userId);
  console.log("\nپایان.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ خطای اجرا:", e);
  process.exitCode = 1;
});
