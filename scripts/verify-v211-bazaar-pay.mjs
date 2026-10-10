/**
 * v211 — راستی‌آزمایی درمان «اطلاعات ارسالی برنامه برای پرداخت نامعتبر است»
 *
 *  ۱. بدون تخفیف → reason:"base_price" و توکن null (رفتار v209 حفظ شده)
 *  ۲. کد تخفیف ۲۰٪ بدون skuPrice → JWT با مبلغ تومان×۱۰ (فال‌بک رسمی) — payload:
 *     price (ریال، عدد) / package_name=ir.fittup.app (سخت‌کد) / sku / exp / nonce
 *  ۳. کد تخفیف ۲۰٪ + skuPrice تومانی هم‌تراز («۳۵۰٬۰۰۰ تومان») → همان مبلغ ×۱۰
 *     (جهان سالم — نمایش مودال تغییری نمی‌کند)
 *  ۴. کد تخفیف ۲۰٪ + skuPrice «3,500,000 ریال» → همان مبلغ ×۱۰ (نمایش ریالی)
 *  ۵. کد تخفیف ۲۰٪ + skuPrice «۳۵٬۰۰۰ تومان» (پنل ۱۰برابر کمتر) → مبلغ JWT از
 *     سقف واقعی پیشخان (finalAmount ریال) — همیشه < سقف ⇒ هرگز رد نمی‌شود
 *     (priceSource=bazaar_sku + priceToman هم‌خوان)
 *  ۶. skuPrice نامربوط («توضیحات محصول») → نادیده گرفته می‌شود (فال‌بک ×۱۰)
 *  ۷. کلید با کوتیشن/فاصلهٔ دور → ضدعفونی می‌شود و JWT سالم می‌سازد
 *  ۸. بدون کلید → ۵۰۳ fail-closed (حفظ v207)
 *
 * اجرا: bun scripts/verify-v211-bazaar-pay.mjs   (سرور دیو روی :3000)
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, scryptSync } from "crypto";

const BASE = "http://localhost:3000";
const TEST_KEY = "v211-test-signing-key-0123456789abcdef";
const CODE = "V211TEST";
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

function makeSessionTokenReal(userId, secret) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now(), sv: 0 })).toString("base64url");
  const sig = scryptSync(payload, secret, 32).toString("hex");
  return `${payload}.${sig}`;
}

function decodeJwt(jwt, key = TEST_KEY) {
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  const expect = createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
  return { header, payload, sigOk: s === expect };
}

async function main() {
  const secret = (await import("fs")).readFileSync("/home/z/my-project/db/.session-secret", "utf8").trim();

  // ─── آماده‌سازی دادهٔ تست ───
  let user = await prisma.user.findUnique({ where: { mobile: "09350009988" } });
  if (!user) {
    user = await prisma.user.create({ data: { mobile: "09350009988", name: "تست v211" } });
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

  const planRow = await prisma.siteSetting.findUnique({ where: { key: "price_standard" } });
  const basePrice = planRow ? parseInt(String(planRow.value).replace(/[^\d]/g, ""), 10) : 800000;
  console.log("قیمت پایهٔ standard (تومان):", basePrice);
  const discounted = Math.round(basePrice * 0.8); // کد ۲۰٪

  // ─── ۱) بدون تخفیف → base_price ───
  console.log("\n[۱] بدون تخفیف:");
  const r1 = await post({ planId: "standard" });
  const j1 = await r1.json().catch(() => ({}));
  check("HTTP 200", r1.status === 200, `got ${r1.status} ${JSON.stringify(j1).slice(0, 150)}`);
  check("reason=base_price", j1?.reason === "base_price");
  check("توکن null (خرید با قیمت عادی SKU)", j1?.dynamicPriceToken === null);

  // ─── ۲) کد ۲۰٪ بدون skuPrice → فال‌بک رسمی تومان×۱۰ ───
  console.log("\n[۲] کد ۲۰٪ بدون skuPrice (فال‌بک رسمی):");
  const r2 = await post({ planId: "standard", discountCode: CODE });
  const j2 = await r2.json().catch(() => ({}));
  check("HTTP 200 + reason=dynamic", r2.status === 200 && j2?.reason === "dynamic", JSON.stringify(j2).slice(0, 200));
  check("dynamicPriceToken حاضر", typeof j2?.dynamicPriceToken === "string" && j2.dynamicPriceToken.split(".").length === 3);
  const d2 = decodeJwt(j2.dynamicPriceToken);
  check("امضای HS256 معتبر", d2.sigOk && d2.header.alg === "HS256");
  check("price عدد ریال درست (تومان×۱۰)", d2.payload.price === discounted * 10, `got ${d2.payload.price} expect ${discounted * 10}`);
  check("package_name سخت‌کد ir.fittup.app", d2.payload.package_name === "ir.fittup.app", `got ${d2.payload.package_name}`);
  check("sku درست", d2.payload.sku === "fitup_standard");
  check("exp ~۱۵دقیقه (UTC UNIX)", Math.abs(d2.payload.exp - Math.floor(Date.now() / 1000) - 900) < 30);
  check("nonce حاضر", typeof d2.payload.nonce === "string" && d2.payload.nonce.length >= 16);
  check("priceSource=computed", j2?.priceSource === "computed");
  check("priceToman هم‌خوان", j2?.priceToman === discounted, `got ${j2?.priceToman} expect ${discounted}`);

  // ─── ۳) skuPrice تومانی هم‌تراز → همان ×۱۰ ───
  console.log("\n[۳] skuPrice «۳۵۰٬۰۰۰ تومان» (جهان سالم):");
  const skuStr = `${basePrice.toLocaleString("fa-IR")} تومان`;
  const r3 = await post({ planId: "standard", discountCode: CODE, skuPrice: skuStr });
  const j3 = await r3.json().catch(() => ({}));
  const d3 = decodeJwt(j3.dynamicPriceToken);
  check("HTTP 200 + reason=dynamic", r3.status === 200 && j3?.reason === "dynamic", JSON.stringify(j3).slice(0, 200));
  check("مبلغ JWT = تومان×۱۰ (بدون تغییر)", d3.payload.price === discounted * 10, `got ${d3.payload.price}`);
  check("priceSource=bazaar_sku", j3?.priceSource === "bazaar_sku", `got ${j3?.priceSource}`);

  // ─── ۴) skuPrice ریالی → همان ×۱۰ ───
  console.log("\n[۴] skuPrice «3,500,000 ریال» (نمایش ریالی):");
  const r4 = await post({ planId: "standard", discountCode: CODE, skuPrice: `${(basePrice * 10).toLocaleString("en-US")} ریال` });
  const j4 = await r4.json().catch(() => ({}));
  const d4 = decodeJwt(j4.dynamicPriceToken);
  check("مبلغ JWT = تومان×۱۰", d4.payload.price === discounted * 10, `got ${d4.payload.price}`);

  // ─── ۵) پنل ۱۰برابر کمتر → JWT از سقف واقعی (هرگز رد نمی‌شود) ───
  console.log("\n[۵] skuPrice «۳۵٬۰۰۰ تومان» (پنل ۱۰برابر کمتر):");
  const r5 = await post({ planId: "standard", discountCode: CODE, skuPrice: `${(basePrice / 10).toLocaleString("fa-IR")} تومان` });
  const j5 = await r5.json().catch(() => ({}));
  const d5 = decodeJwt(j5.dynamicPriceToken);
  check("HTTP 200 + reason=dynamic", r5.status === 200 && j5?.reason === "dynamic", JSON.stringify(j5).slice(0, 200));
  check("مبلغ JWT از سقف واقعی پیشخان (finalAmount ریال)", d5.payload.price === discounted, `got ${d5.payload.price} expect ${discounted}`);
  check("اکیداً کمتر از سقف پیشخان (ضد خطای ۱۰)", d5.payload.price < basePrice, `got ${d5.payload.price} panel~${basePrice}`);
  check("priceSource=bazaar_sku", j5?.priceSource === "bazaar_sku");
  check("priceToman هم‌خوان با درگاه", j5?.priceToman === Math.round(discounted / 10), `got ${j5?.priceToman}`);

  // ─── ۶) skuPrice نامربوط → نادیده (فال‌بک ×۱۰) ───
  console.log("\n[۶] skuPrice نامربوط:");
  const r6 = await post({ planId: "standard", discountCode: CODE, skuPrice: "اشتراک یک‌ماهه فیتاپ - بهترین انتخاب" });
  const j6 = await r6.json().catch(() => ({}));
  const d6 = decodeJwt(j6.dynamicPriceToken);
  check("فال‌بک به تومان×۱۰", d6.payload.price === discounted * 10, `got ${d6.payload.price}`);
  check("priceSource=computed", j6?.priceSource === "computed");

  // ─── ۷) کلید با کوتیشن/فاصلهٔ دور → ضدعفونی ───
  console.log("\n[۷] کلید با کوتیشن/فاصلهٔ دور:");
  await prisma.siteSetting.update({ where: { key: "bazaar_dynamic_price_token" }, data: { value: `  "${TEST_KEY}"  ` } });
  const r7 = await post({ planId: "standard", discountCode: CODE });
  const j7 = await r7.json().catch(() => ({}));
  const d7 = decodeJwt(j7?.dynamicPriceToken || "");
  check("HTTP 200 (کلید ضدعفونی شد)", r7.status === 200 && j7?.reason === "dynamic", JSON.stringify(j7).slice(0, 150));
  check("امضا با کلید واقعی معتبر", d7.sigOk);

  // ─── ۸) بدون کلید → ۵۰۳ fail-closed ───
  console.log("\n[۸] بدون کلید (fail-closed v207 حفظ شود):");
  await prisma.siteSetting.update({ where: { key: "bazaar_dynamic_price_token" }, data: { value: "   " } });
  const r8 = await post({ planId: "standard", discountCode: CODE });
  const j8 = await r8.json().catch(() => ({}));
  check("HTTP 503", r8.status === 503, `got ${r8.status}`);
  check("reason=dynamic_price_not_configured", j8?.reason === "dynamic_price_not_configured");

  // ─── پاک‌سازی ───
  await prisma.siteSetting.delete({ where: { key: "bazaar_dynamic_price_token" } }).catch(() => {});
  await prisma.discountCode.delete({ where: { code: CODE } }).catch(() => {});

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error("خطای اسکریپت:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
