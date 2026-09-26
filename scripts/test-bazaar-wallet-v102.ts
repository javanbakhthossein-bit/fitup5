/**
 * test-bazaar-wallet-v102.ts — تست E2E مسیر شارژ کیف پول با پرداخت درون‌برنامه‌ای بازار
 *
 * مصرف:  SESSION_SECRET=... bun scripts/test-bazaar-wallet-v102.ts
 *
 * پوشش:
 *  ۱. SKU خارج از whitelist → 400
 *  ۲. خرید مجاز (dev: skip-verify) → ok=true + افزایش موجودی + تراکنش کیف پول + Payment
 *  ۳. فراخوانی دوباره با همان توکن (idempotency) → alreadyProcessed + موجودی ثابت
 *  ۴. بدون سشن → 401
 * در پایان پاک‌سازی کامل رکوردهای تست انجام می‌شود.
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync } from "crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const SECRET = process.env.SESSION_SECRET || "";

function mintSessionToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString("base64url");
  const sig = scryptSync(payload, SECRET, 32).toString("hex");
  return `${payload}.${sig}`;
}

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("── تست E2E شارژ کیف پول با IAP بازار (v102) ──");

  // کاربر تستی
  const mobile = "09129999999";
  let user = await db.user.findUnique({ where: { mobile } });
  if (!user) {
    user = await db.user.create({
      data: { mobile, name: "تست کیف بازار", onboardingDone: true, walletBalance: 50_000 },
    });
  }
  const startBalance = user.walletBalance;
  console.log(`   کاربر تست: ${user.id} — موجودی اولیه: ${startBalance}`);

  const token = mintSessionToken(user.id);
  const cookie = `sc_session=${token}`;
  const TOKEN = `e2e_wallet_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // ─── ۰) سشن معتبر است؟ ───
  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const meData = await meRes.json().catch(() => ({}));
  ok("سشن تستی معتبر است (auth/me کاربر برمی‌گرداند)", meRes.status === 200 && !!meData?.user?.id, `HTTP ${meRes.status}`);

  // ─── ۱) SKU خارج از whitelist ───
  const bad = await fetch(`${BASE}/api/payment/bazaar/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ productId: "fitup_wallet_777777", purchaseToken: TOKEN }),
  });
  const badData = await bad.json().catch(() => ({}));
  ok("SKU غیرمجاز → 400", bad.status === 400, `HTTP ${bad.status} — ${badData.error ?? ""}`);

  // ─── ۲) خرید مجاز → شارژ موفق ───
  const res1 = await fetch(`${BASE}/api/payment/bazaar/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      productId: "fitup_wallet_100000",
      purchaseToken: TOKEN,
      orderId: "e2e-order-1",
      dataJson: "",
      signature: "",
    }),
  });
  const d1 = await res1.json().catch(() => ({}));
  ok("خرید مجاز → 200 + ok", res1.status === 200 && d1.ok === true, `HTTP ${res1.status} — ${d1.message ?? d1.error ?? ""}`);
  ok("مبلغ درست (100000)", d1.amount === 100000);

  const u1 = await db.user.findUnique({ where: { id: user.id } });
  ok("موجودی += 100000", u1?.walletBalance === startBalance + 100_000, `موجودی: ${u1?.walletBalance}`);

  const pay = await db.payment.findFirst({ where: { authority: TOKEN } });
  ok("Payment ساخته شد (wallet_topup/success)", !!pay && pay.status === "success" && pay.plan === "wallet_topup" && pay.amount === 100000);
  const txn = await db.walletTransaction.findFirst({ where: { userId: user.id, type: "deposit", amount: 100_000 }, orderBy: { createdAt: "desc" } });
  ok("WalletTransaction ثبت شد", !!txn, txn?.description ?? "");

  // ─── ۳) idempotency — همان توکن دوباره ───
  const res2 = await fetch(`${BASE}/api/payment/bazaar/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ productId: "fitup_wallet_100000", purchaseToken: TOKEN }),
  });
  const d2 = await res2.json().catch(() => ({}));
  ok("فراخوانی دوباره → alreadyProcessed", res2.status === 200 && d2.alreadyProcessed === true, `HTTP ${res2.status}`);
  const u2 = await db.user.findUnique({ where: { id: user.id } });
  ok("موجودی دوباره شارژ نشد (بدون چاپ پول)", u2?.walletBalance === startBalance + 100_000, `موجودی: ${u2?.walletBalance}`);
  const payCount = await db.payment.count({ where: { authority: TOKEN } });
  ok("فقط یک Payment برای توکن", payCount === 1, `تعداد: ${payCount}`);

  // ─── ۴) بدون سشن ───
  const res3 = await fetch(`${BASE}/api/payment/bazaar/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: "fitup_wallet_100000", purchaseToken: "x" }),
  });
  ok("بدون سشن → 401", res3.status === 401, `HTTP ${res3.status}`);

  console.log(`\n── نتیجه: ${pass} پاس / ${fail} شکست ──`);

  // ─── پاک‌سازی ───
  if (txn) await db.walletTransaction.delete({ where: { id: txn.id } });
  if (pay) await db.payment.delete({ where: { id: pay.id } });
  await db.user.update({ where: { id: user.id }, data: { walletBalance: startBalance } });
  console.log("   پاک‌سازی انجام شد (Payment/Txn حذف، موجودی برگشت).");
  if (fail > 0) process.exit(1);
}

main()
  .catch((e) => { console.error("خطای تست:", e); process.exit(1); })
  .finally(() => db.$disconnect());
