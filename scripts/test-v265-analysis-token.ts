/**
 * تست عملی v265 — پنجرهٔ ۲ ساعتهٔ تخفیف تحلیل پس از پیامک ترک خرید
 *  ① صدور/تمدید توکن با source="abandoned_cart_sms" (همان کوئری‌های grantAbandonedCartAnalysisToken)
 *  ② معافیت توکن پیامکی از ابطال revoke (همان where مسیر /api/onboarding/analysis-discount)
 *  ③ قاعدهٔ v264: کد تخفیف روی توکن ارجحیت دارد (عدم پشته) — computePlanFinalAmount
 *  ④ توکن بدون کد → ۱۰٪ اعمال می‌شود
 * همهٔ ردیف‌های تستی در پایان پاک می‌شوند (کاربر سینتتیک cascade).
 * اجرا: bun scripts/test-v265-analysis-token.ts
 */
import { randomBytes } from "crypto";
import { db } from "../src/lib/db";
import { computePlanFinalAmount } from "../src/lib/fitness/payment-delivery";
import { getActivePlan } from "../src/lib/fitness/pricing";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra?: string) => {
  if (ok) { pass++; console.log(`  ✓ PASS — ${name}${extra ? ` (${extra})` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL — ${name}${extra ? ` (${extra})` : ""}`); }
};

async function main() {
  const suffix = randomBytes(4).toString("hex");
  const mobile = `0999${Date.now().toString().slice(-7)}`;

  // ─── کاربر سینتتیک (isBlocked=true تا هیچ کرون/پیامکی سراغش نرود؛ آخر کار پاک می‌شود)
  const user = await db.user.create({
    data: { name: `تست-v265-${suffix}`, mobile, isBlocked: true, role: "USER" },
  });
  try {
    const now = new Date();
    const TWO_H = 2 * 60 * 60 * 1000;

    // ─── ① صدور توکن جدید (حالت «توکن زنده ندارد») — بازسازی دقیق منطق grant ───
    const mkToken = (src: string, ttlMs: number) => ({
      token: `test-${suffix}-${src}-${randomBytes(5).toString("hex")}`,
      kind: "analysis_discount",
      userId: user.id,
      amount: 10,
      source: src,
      expiresAt: new Date(now.getTime() + ttlMs),
    });

    // ② توکن زندهٔ صفحه (analysis_screen) موجود → پیامک باید «تمدید» کند + source عوض شود
    const screenTok = await db.paymentToken.create({ data: mkToken("analysis_screen", 30 * 60 * 1000) });
    const live = await db.paymentToken.findFirst({
      where: { kind: "analysis_discount", userId: user.id, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    check("① توکن زندهٔ صفحه پیدا شد", !!live && live.id === screenTok.id);
    const extendTo = new Date(now.getTime() + TWO_H);
    await db.paymentToken.update({ where: { id: live!.id }, data: { expiresAt: extendTo, source: "abandoned_cart_sms" } });
    const extended = await db.paymentToken.findUnique({ where: { id: screenTok.id } });
    check("② تمدید به ۲ ساعت + مهر پیامک", extended!.source === "abandoned_cart_sms" && extended!.expiresAt.getTime() >= extendTo.getTime() - 1000);

    // ─── ③ معافیت از revoke: دو توکن — پیامکی + صفحه‌ای؛ revoke فقط صفحه‌ای را می‌کشد
    const smsTok = await db.paymentToken.create({ data: mkToken("abandoned_cart_sms", TWO_H) });
    const screenTok2 = await db.paymentToken.create({ data: mkToken("analysis_screen", 30 * 60 * 1000) });
    // عین where مسیر revoke (v265: source: { not: "abandoned_cart_sms" })
    const r = await db.paymentToken.updateMany({
      where: {
        kind: "analysis_discount", userId: user.id, usedAt: null,
        expiresAt: { gt: new Date() }, source: { not: "abandoned_cart_sms" },
      },
      data: { expiresAt: new Date() },
    });
    check("③ revoke فقط توکن صفحه‌ای را کشت (نه پیامکی)", r.count === 1);
    const afterSms = await db.paymentToken.findUnique({ where: { id: smsTok.id } });
    const afterScreen = await db.paymentToken.findUnique({ where: { id: screenTok2.id } });
    check("③-a توکن پیامکی زنده ماند", afterSms!.expiresAt.getTime() > Date.now());
    check("③-b توکن صفحه‌ای ابطال شد", afterScreen!.expiresAt.getTime() <= new Date());

    // ─── ④⑤ قاعدهٔ مبلغ — computePlanFinalAmount
    const plan = await getActivePlan("advanced");
    if (!plan) throw new Error("پلن advanced یافت نشد");

    // ④ بدون کد، توکن پیامکی زنده → ۱۰٪
    const c1 = await computePlanFinalAmount(user.id, plan, { analysisDiscountToken: smsTok.token });
    check("④ توکن پیامکی بدون کد → ۱۰٪", c1.analysisDiscountValue === Math.round(plan.price * 0.1) && c1.finalAmount === plan.price - Math.round(plan.price * 0.1), `final=${c1.finalAmount}`);

    // ⑤ با کد اختصاصی ۳۰٪ → کد اعمال، توکن نه (عدم پشته v264)
    const udc = await db.userDiscountCode.create({
      data: { code: `TEST265-${suffix.toUpperCase()}`, userId: user.id, type: "percent", value: 30, reason: "welcome_offer", validUntil: new Date(Date.now() + 86400000) },
    });
    const c2 = await computePlanFinalAmount(user.id, plan, { userDiscountCode: udc.code, analysisDiscountToken: smsTok.token });
    const expect30 = Math.round(plan.price * 0.3);
    check("⑤ کد ۳۰٪ اعمال شد", c2.discountValue === expect30, `discount=${c2.discountValue}`);
    check("⑤-ب توکن ۱۰٪ پشته نشد (v264)", c2.analysisDiscountValue === 0 && c2.finalAmount === plan.price - expect30, `final=${c2.finalAmount}`);

    // ⑥ مصرف توکن در خرید → usedAt ثبت؛ بعدش دیگر اعمال نمی‌شود
    await db.paymentToken.update({ where: { id: smsTok.id }, data: { usedAt: new Date() } });
    const c3 = await computePlanFinalAmount(user.id, plan, { analysisDiscountToken: smsTok.token });
    check("⑥ توکن مصرف‌شده دوباره اعمال نمی‌شود", c3.analysisDiscountValue === 0);

    console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  } finally {
    // پاک‌سازی کامل — cascade توکن‌ها/کدها
    await db.userDiscountCode.deleteMany({ where: { userId: user.id } });
    await db.paymentToken.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log("(ردیف‌های تستی پاک شد)");
  }
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("CRASH:", e); process.exit(1); });
