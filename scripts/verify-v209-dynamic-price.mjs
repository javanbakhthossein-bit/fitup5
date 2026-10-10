/**
 * v209 — راستی‌آزمایی فلوی رسمی «تخفیف پویا» بازار (JWT یکبارمصرف)
 *
 *  ۱. بدون تخفیف → reason:"base_price" و توکن null
 *  ۲. با کد تخفیف ۲۰٪ → reason:"dynamic" + JWT معتبر:
 *     امضای HS256 با کلید تست ✓ payload: price (ریال) / package_name / sku / exp / nonce ✓
 *  ۳. بدون کلید امضا → ۵۰۳ fail-closed (dynamic_price_not_configured)
 *
 * اجرا: bun scripts/verify-v209-dynamic-price.mjs
 */
import { PrismaClient } from "@prisma/client";
import { createHmac } from "crypto";

const BASE = "http://localhost:3000";
const TEST_KEY = "v209-test-signing-key-0123456789abcdef";
const CODE = "V209TEST";
const prisma = new PrismaClient();

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
  const sig = createHmac("sha256", secret).update(payload).digest("hex"); // placeholder — واقعی زیر
  return `${payload}.${sig}`;
}

import { scryptSync } from "crypto";
function makeSessionTokenReal(userId, secret) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

function decodeJwt(jwt) {
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  const expect = createHmac("sha256", TEST_KEY).update(`${h}.${p}`).digest("base64url");
  return { header, payload, sigOk: s === expect };
}

async function main() {
  const secret = (await import("fs")).readFileSync("/home/z/my-project/db/.session-secret", "utf8").trim();

  // ─── آماده‌سازی دادهٔ تست ───
  let user = await prisma.user.findUnique({ where: { mobile: "09350009988" } });
  if (!user) {
    user = await prisma.user.create({ data: { mobile: "09350009988", name: "تست v209" } });
  }
  await prisma.discountCode.upsert({
    where: { code: CODE },
    update: { type: "percent", value: 20, active: true, maxUses: -1, validFrom: new Date(Date.now() - 86400_000), validUntil: new Date(Date.now() + 86400_000), applicablePlans: "all" },
    create: { code: CODE, type: "percent", value: 20, active: true, maxUses: -1, validFrom: new Date(Date.now() - 86400_000), validUntil: new Date(Date.now() + 86400_000), applicablePlans: "all" },
  });
  await prisma.siteSetting.upsert({
    where: { key: "bazaar_dynamic_price_token" },
    update: { value: TEST_KEY },
    create: { key: "bazaar_dynamic_price_token", value: TEST_KEY },
  });

  const token = makeSessionTokenReal(user.id, secret);
  const cookie = `sc_session=${token}`;
  const post = (body) =>
    fetch(`${BASE}/api/payment/bazaar/dynamic-price`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });

  const plan = await prisma.siteSetting.findUnique({ where: { key: "price_standard" } });
  const basePrice = plan ? parseInt(String(plan.value).replace(/[^\d]/g, ""), 10) : null;
  console.log("قیمت پایهٔ standard (SiteSetting):", basePrice);

  // ─── ۱) بدون تخفیف → base_price ───
  console.log("\n[۱] بدون تخفیف:");
  const r1 = await post({ planId: "standard" });
  const j1 = await r1.json().catch(() => ({}));
  check("HTTP 200", r1.status === 200, `got ${r1.status} ${JSON.stringify(j1).slice(0, 150)}`);
  check("reason=base_price", j1?.reason === "base_price");
  check("توکن null (خرید با قیمت عادی SKU)", j1?.dynamicPriceToken === null);
  const final1 = j1?.finalAmount;

  // ─── ۲) با کد تخفیف ۲۰٪ → dynamic + JWT ───
  console.log("\n[۲] با کد تخفیف ۲۰٪:");
  const r2 = await post({ planId: "standard", discountCode: CODE });
  const j2 = await r2.json().catch(() => ({}));
  check("HTTP 200", r2.status === 200, `got ${r2.status} ${JSON.stringify(j2).slice(0, 200)}`);
  check("reason=dynamic", j2?.reason === "dynamic", JSON.stringify(j2).slice(0, 200));
  check("dynamicPriceToken حاضر", typeof j2?.dynamicPriceToken === "string" && j2.dynamicPriceToken.split(".").length === 3);
  check("سازگاری: dynamicPriceId همان JWT", j2?.dynamicPriceId === j2?.dynamicPriceToken);

  if (typeof j2?.dynamicPriceToken === "string") {
    const { header, payload, sigOk } = decodeJwt(j2.dynamicPriceToken);
    check("header alg=HS256/typ=JWT", header?.alg === "HS256" && header?.typ === "JWT", JSON.stringify(header));
    check("امضای HMAC با کلید تست معتبر", sigOk === true);
    check("price = مبلغ نهایی ×۱۰ (ریال، عدد)", typeof payload?.price === "number" && payload.price === j2.finalAmount * 10, `payload.price=${payload?.price} final=${j2.finalAmount}`);
    check("price < قیمت پایه (تخفیف واقعی)", basePrice ? payload.price < basePrice * 10 : true);
    check("package_name=ir.fittup.app", payload?.package_name === "ir.fittup.app", payload?.package_name);
    check("sku=fitup_standard", payload?.sku === "fitup_standard", payload?.sku);
    check("exp ~۱۵ دقیقه بعد", typeof payload?.exp === "number" && payload.exp > Date.now() / 1000 + 14 * 60 && payload.exp < Date.now() / 1000 + 16 * 60, `exp=${payload?.exp}`);
    check("nonce یکتا حاضر", typeof payload?.nonce === "string" && payload.nonce.length >= 16);
    check("مبلغ نهایی = ۸۰٪ پایه", basePrice ? j2.finalAmount === Math.round(basePrice * 0.8) : true, `${j2.finalAmount} vs ${basePrice}`);
  }

  // ─── ۳) بدون کلید امضا → fail-closed ۵۰۳ ───
  console.log("\n[۳] بدون کلید امضا (fail-closed):");
  await prisma.siteSetting.deleteMany({ where: { key: "bazaar_dynamic_price_token" } });
  const r3 = await post({ planId: "standard", discountCode: CODE });
  const j3 = await r3.json().catch(() => ({}));
  check("HTTP 503", r3.status === 503, `got ${r3.status}`);
  check("reason=dynamic_price_not_configured", j3?.reason === "dynamic_price_not_configured");
  check("پیام فارسی روشن به کاربر", typeof j3?.error === "string" && j3.error.includes("تخفیف"));

  // ─── پاک‌سازی ───
  await prisma.discountCode.deleteMany({ where: { code: CODE } });
  await prisma.siteSetting.deleteMany({ where: { key: "bazaar_dynamic_price_token" } });
  await prisma.user.deleteMany({ where: { mobile: "09350009988" } });
  await prisma.$disconnect();

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e);
  process.exit(1);
});
