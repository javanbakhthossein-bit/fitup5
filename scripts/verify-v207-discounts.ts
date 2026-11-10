/**
 * v207 — راستی‌آزمایی درمان ریشه‌ای «تخفیف‌ها در درگاه اپ بازار اعمال نشد»
 *
 * مستقیماً computePlanFinalAmount (هستهٔ مشترک مسیر بازار) را با دادهٔ واقعی DB
 * می‌آزماید — همان تابعی که bazaar/dynamic-price و bazaar/purchase مصرف می‌کنند:
 *
 *   ۱. validFrom آینده (زمان‌بندی شروع کمپین پیامکی) → رد با «هنوز فعال نشده»
 *   ۲. کد عمومی فعال → تخفیف درصدی دقیق
 *   ۳. کد منقضی → رد با «منقضی شده»
 *   ۴. کد نمایشی «۲۴۸۹۴۵» (ترک درگاه — پیامکی) → resolve به کد واقعی کاربر
 *   ۵. گیت «فقط خرید اول» (وین‌بک/خوش‌آمدگویی) با اشتراک موجود → رد؛ کد تمدید → عبور
 *   ۶. توکن تحلیل + کد عمومی → ۱۰٪ بعد از کد (همان ترتیب checkout)
 *   ۷. توکن منقضی: بدون بخشش → اعمال نمی‌شود / با بخشش ۱۰ دقیقه‌ای (مسیر فعال‌سازی بازار) → اعمال می‌شود
 *   ۸. توکن مصرف‌شده → حتی با بخشش اعمال نمی‌شود (تک‌مصرف)
 *
 * اجرا: bun scripts/verify-v207-discounts.ts   (پاک‌سازی خودکار دادهٔ تست)
 */
import { db } from "@/lib/db";
import {
  computePlanFinalAmount,
  DiscountInvalidError,
} from "../src/lib/fitness/payment-delivery";

const TAG = `V207T${Date.now().toString(36).slice(-6)}`.toUpperCase(); // کدها همیشه اپرکِیس (مثل تولید)
let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ PASS — ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    fail++;
    console.error(`  ❌ FAIL — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function expectInvalid(
  name: string,
  userId: string,
  plan: { id: string; price: number },
  opts: Parameters<typeof computePlanFinalAmount>[2],
  msgPart: string
) {
  try {
    await computePlanFinalAmount(userId, plan, opts);
    ok(name, false, "خطا انتظار می‌رفت ولی عبور کرد");
  } catch (e) {
    ok(
      name,
      e instanceof DiscountInvalidError && e.message.includes(msgPart),
      e instanceof Error ? e.message.slice(0, 60) : "خطای ناشناخته"
    );
  }
}

async function main() {
  const plan = { id: "standard", price: 1_200_000 }; // مبلغ آزمایشی — مستقل از SiteSetting
  const suffix = Math.floor(Math.random() * 9_000_000 + 1_000_000);
  const user = await db.user.create({
    data: { mobile: `0912${suffix}`, name: `تست v207 ${TAG}` },
  });
  const uid = user.id;
  console.log(`\nکاربر تست: ${uid} — قیمت پایهٔ آزمایش: ${plan.price.toLocaleString("en-US")}\n`);

  try {
    // ─── ۱. validFrom آینده ───
    await db.discountCode.create({
      data: { code: `${TAG}FUT`, type: "percent", value: 20, active: true, validFrom: new Date(Date.now() + 3600_000) },
    });
    await expectInvalid(
      "۱) کد با شروع آینده (زمان‌بندی) رد می‌شود",
      uid, plan, { discountCode: `${TAG}FUT` },
      "هنوز فعال نشده"
    );

    // ─── ۲. کد عمومی فعال ───
    await db.discountCode.create({
      data: { code: `${TAG}OK`, type: "percent", value: 20, active: true, validFrom: new Date(Date.now() - 3600_000) },
    });
    const r2 = await computePlanFinalAmount(uid, plan, { discountCode: `${TAG}OK` });
    ok("۲) کد عمومی فعال = ۲۰٪ دقیق", r2.finalAmount === 960_000 && r2.discountCode === `${TAG}OK`, `final=${r2.finalAmount}`);

    // ─── ۳. کد منقضی ───
    await db.discountCode.create({
      data: { code: `${TAG}EXP`, type: "percent", value: 20, active: true, validUntil: new Date(Date.now() - 1000) },
    });
    await expectInvalid("۳) کد منقضی رد می‌شود", uid, plan, { discountCode: `${TAG}EXP` }, "منقضی");

    // ─── ۴. کد نمایشی ۲۴۸۹۴۵ ───
    await db.userDiscountCode.create({
      data: { userId: uid, code: `248945-${TAG}`, type: "percent", value: 15, reason: "abandoned_cart", validUntil: new Date(Date.now() + 7200_000) },
    });
    const r4 = await computePlanFinalAmount(uid, plan, { userDiscountCode: "248945" });
    ok("۴) کد نمایشی ۲۴۸۹۴۵ resolve و اعمال شد", r4.finalAmount === 1_020_000 && r4.discountCode === `248945-${TAG}`, `final=${r4.finalAmount}`);

    // ─── ۵. گیت «فقط خرید اول» ───
    await db.userDiscountCode.create({
      data: { userId: uid, code: `${TAG}WELCOME`, type: "percent", value: 30, reason: "welcome_offer" },
    });
    await db.subscription.create({
      data: { userId: uid, plan: "basic", status: "active", pricePaid: 100_000, durationDays: 30, startDate: new Date(), endDate: new Date(Date.now() + 15 * 86_400_000) },
    });
    await expectInvalid(
      "۵) کد خرید-اول با اشتراک موجود رد می‌شود",
      uid, plan, { userDiscountCode: `${TAG}WELCOME` },
      "اولین خرید"
    );
    // کد تمدید با اشتراک موجود → عبور (رفتار درست)
    await db.userDiscountCode.create({
      data: { userId: uid, code: `${TAG}RENEW`, type: "percent", value: 10, reason: "renewal_loyalty" },
    });
    const r5b = await computePlanFinalAmount(uid, plan, { userDiscountCode: `${TAG}RENEW` });
    // ۱٬۲۰۰٬۰۰۰ − ۱۰٪ (۱۲۰٬۰۰۰) − اعتبار ارتقای basic فعال (روزهای باقیمانده ۱۵ از ۳۰ ⇒ ۵۰٬۰۰۰) = ۱٬۰۳۰٬۰۰۰
    ok(
      "۵-ب) کد تمدید با اشتراک موجود عبور می‌کند (+ اعتبار ارتقای درست)",
      r5b.finalAmount === 1_030_000 && r5b.upgradeCredit === 50_000 && r5b.isUpgrade === true,
      `final=${r5b.finalAmount} credit=${r5b.upgradeCredit}`
    );

    // ─── ۶. توکن تحلیل بعد از کد (اشتراک فعال ⇒ اعتبار ارتقا صفر چون همان پلن نیست؟ basic≠standard ⇒ اعتبار داریم) ───
    // برای جداسازی، اشتراک را منقضی می‌کنیم تا اعتبار ارتقا دخالت نکند
    await db.subscription.updateMany({ where: { userId: uid }, data: { status: "expired", endDate: new Date(Date.now() - 86_400_000) } });
    await db.paymentToken.create({
      data: { token: `${TAG}TOK`, kind: "analysis_discount", userId: uid, amount: 10, source: "verify_v207", expiresAt: new Date(Date.now() + 1800_000) },
    });
    const r6 = await computePlanFinalAmount(uid, plan, {
      discountCode: `${TAG}OK`,
      analysisDiscountToken: `${TAG}TOK`,
    });
    ok(
      "۶) توکن تحلیل بعد از کد: ۲۰٪ سپس ۱۰٪",
      r6.finalAmount === 864_000 && !!r6.analysisTokenId && r6.analysisDiscountValue === 96_000 && r6.analysisTokenProvided === true,
      `final=${r6.finalAmount} tokVal=${r6.analysisDiscountValue}`
    );

    // ─── ۷. انقضای توکن: سخت‌گیر vs بخشش ۱۰ دقیقه‌ای ───
    await db.paymentToken.update({ where: { token: `${TAG}TOK` }, data: { expiresAt: new Date(Date.now() - 5 * 60_000) } });
    const r7a = await computePlanFinalAmount(uid, plan, { discountCode: `${TAG}OK`, analysisDiscountToken: `${TAG}TOK` });
    ok("۷-الف) توکن منقضی بدون بخشش اعمال نمی‌شود", r7a.finalAmount === 960_000 && r7a.analysisTokenId === null, `final=${r7a.finalAmount}`);
    const r7b = await computePlanFinalAmount(uid, plan, {
      discountCode: `${TAG}OK`,
      analysisDiscountToken: `${TAG}TOK`,
      analysisTokenGraceMs: 10 * 60_000,
    });
    ok("۷-ب) توکن منقضی با بخشش ۱۰ دقیقه‌ای اعمال می‌شود (میان-فلوی بازار)", r7b.finalAmount === 864_000 && !!r7b.analysisTokenId, `final=${r7b.finalAmount}`);

    // ─── ۸. توکن مصرف‌شده حتی با بخشش ───
    await db.paymentToken.update({ where: { token: `${TAG}TOK` }, data: { usedAt: new Date() } });
    const r8 = await computePlanFinalAmount(uid, plan, {
      discountCode: `${TAG}OK`,
      analysisDiscountToken: `${TAG}TOK`,
      analysisTokenGraceMs: 10 * 60_000,
    });
    ok("۸) توکن مصرف‌شده با بخشش هم اعمال نمی‌شود (تک‌مصرف)", r8.finalAmount === 960_000 && r8.analysisTokenId === null, `final=${r8.finalAmount}`);
  } finally {
    // ─── پاک‌سازی کامل دادهٔ تست ───
    await db.user.delete({ where: { id: uid } }).catch(() => {});
    await db.discountCode.deleteMany({ where: { code: { startsWith: TAG } } });
    await db.paymentToken.deleteMany({ where: { token: { startsWith: TAG } } }).catch(() => {});
  }

  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("خطای اجرا:", e);
    process.exit(1);
  });
