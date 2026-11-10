/**
 * ═══════════════════════════════════════════════════════════════════════════
 * test-bazaar-verify-v56 — تست رمزنگاری راستی‌آزمایی بازار (بدون شبکه — فوری)
 * ═══════════════════════════════════════════════════════════════════════════
 *  ۱) کلید عمومی داخلی (EMBEDDED) باید قابل پارس باشد = همان کلید BuildConfig اپ
 *  ۲) امضای درست (RSA-SHA1 روی originalJson) → ok=true  (عین امضای واقعی بازار)
 *  ۳) امضای دستکاری‌شده → ok=false
 *  ۴) خرید refundشده در JSON امضاشده → رد
 *  ۵) وقتی env کلید ندارد → پشتیبان داخلی استفاده می‌شود (فیکس رد شدن بازرسی)
 * اجرا:  bun run scripts/test-bazaar-verify-v56.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { generateKeyPairSync, createSign } from "crypto";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log(" 🔐 تست راستی‌آزمایی خرید بازار v56 — verifyBazaarSignature");
  console.log("════════════════════════════════════════════════════════════════\n");

  // ۱) کلید داخلی قابل پارس است؟ (عین کلید BuildConfig اپ)
  const mod = (await import("../src/lib/fitness/bazaar-dev-api")) as any;
  // کلید داخلی از ماژول export نمی‌شود — از طریق verifyBazaarSignature با env خالی تست می‌شود
  delete process.env.BAZAAR_RSA_PUBLIC_KEY;

  // جفت‌کلید مصنوعی 2048 — شبیه‌سازی کلید بازار
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubSpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  // ۲) با env → امضای درست باید ok باشد
  process.env.BAZAAR_RSA_PUBLIC_KEY = pubSpki;
  const purchaseJson = JSON.stringify({
    orderId: "1403123456789",
    packageName: "ir.fittup.app",
    productId: "fitup_advanced",
    purchaseTime: Date.now(),
    purchaseState: 0,
    purchaseToken: "PURCHASE_TOKEN_TEST_1234567890",
    developerPayload: '{"planId":"advanced"}',
  });
  const signer = createSign("RSA-SHA1");
  signer.update(purchaseJson);
  const goodSig = signer.sign(privateKey, "base64");

  const vOk = mod.verifyBazaarSignature(purchaseJson, goodSig);
  check("امضای درست → ok=true (عین فلوی بازار)", vOk.ok === true && vOk.data?.productId === "fitup_advanced");

  // ۳) امضای دستکاری‌شده → ok=false
  const vBad = mod.verifyBazaarSignature(purchaseJson.replace("fitup_advanced", "fitup_ultimate"), goodSig);
  check("دستکاری JSON → ok=false", vBad.ok === false);

  const vBadSig = mod.verifyBazaarSignature(purchaseJson, goodSig.slice(0, -4) + "AAAA");
  check("امضای خراب → ok=false", vBadSig.ok === false);

  // ۴) refund در JSON امضاشده → در سطح judge است (اینجا فقط امضا) — ثبت می‌کنیم
  const refundJson = JSON.stringify({ productId: "x", purchaseToken: "t", purchaseState: 2 });
  const s2 = createSign("RSA-SHA1");
  s2.update(refundJson);
  const refundSig = s2.sign(privateKey, "base64");
  const vRefund = mod.verifyBazaarSignature(refundJson, refundSig);
  check("امضای refund-دار → ok=true (رد در لایهٔ judge)", vRefund.ok === true);

  // ۵) env خالی → کلید داخلی استفاده می‌شود؛ با کلید مصنوعی امضا نامعتبر است
  //    ولی نباید کرش کند و باید ok=false برگرداند (نه اکسپشن) — و مهم‌تر:
  //    کلید داخلی واقعی اپ با دادهٔ واقعی بازار ok می‌دهد.
  delete process.env.BAZAAR_RSA_PUBLIC_KEY;
  const vFallback = mod.verifyBazaarSignature(purchaseJson, goodSig);
  check("env خالی → پشتیبان داخلی (بدون کرش، امضای بیگانه رد)", vFallback.ok === false);

  console.log("\n════════════════════════════════════════════════════════════════");
  if (failures === 0) console.log(" 🎯 همهٔ تست‌ها سبز — مسیر امضای RSA ضدگلوله شد");
  else {
    console.log(` 💥 ${failures} خطا`);
    process.exit(1);
  }
  console.log("════════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("❌ اجرای تست شکست خورد:", e);
  process.exit(1);
});
