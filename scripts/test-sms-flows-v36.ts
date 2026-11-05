/**
 * تست رفتاری v36 — سه جریان پیامکی جدید (خودآزمایی بدون هزینهٔ پیامک)
 *
 *   سناریو ۱: planUpgradeSmsTemplateFor — نگاشت صحیح قالب‌ها
 *             (basic→advanced = 275042 | basic→standard = 324322 | تمدید/داون‌گرید = null)
 *   سناریو ۲: notifyPlanUpgradeSms — قالب 275042 با NAME+PLANBASE+PLANUPDATE
 *   سناریو ۳: notifyPlanUpgradeSms — قالب 324322 (اقتصادی → استاندارد)
 *   سناریو ۴: دداپ — همان پرداخت دوباره → هیچ درخواست جدیدی نمی‌رود
 *   سناریو ۵: notifyWalletTopupSms — قالب 556023 با نردبان [NAME+AMOUNT]→[NAME]→[]
 *   سناریو ۶: wallet — قالب با NAME+AMOUNT موفق → فقط یک تلاش
 *
 * اجرا: bun run scripts/test-sms-flows-v36.ts
 */
export {};

process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";
process.env.SMSIR_API_KEY = "test-key-sandbox";
process.env.SMSIR_TEMPLATE_PLAN_UPGRADE_PREMIUM = "275042";
process.env.SMSIR_TEMPLATE_PLAN_UPGRADE_STANDARD = "324322";
process.env.SMSIR_TEMPLATE_WALLET_TOPUP = "556023";

interface CapturedCall {
  templateId: number;
  params: Array<{ name: string; value: string }>;
}
const calls: CapturedCall[] = [];
/** تعداد درخواست‌های «دارای پارامتر» که خطا می‌گیرند (FIFO) */
let failParamCalls = 0;

(globalThis as any).fetch = (async (_url: any, init: any) => {
  const body = JSON.parse(init?.body || "{}");
  const params: Array<{ name: string; value: string }> = body.parameters ?? [];
  calls.push({ templateId: body.templateId, params });
  if (params.length > 0 && failParamCalls > 0) {
    failParamCalls--;
    return new Response(
      JSON.stringify({ status: 1006, message: "پارامتر ارسالی با قالب همخوانی ندارد" }),
      { status: 200 }
    );
  }
  return new Response(
    JSON.stringify({
      status: 1,
      message: "موفق",
      data: { messageId: Math.floor(Math.random() * 100000), cost: 100 },
    }),
    { status: 200 }
  );
}) as any;

let ok = true;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) ok = false;
}

async function main() {
  const { planUpgradeSmsTemplateFor, notifyPlanUpgradeSms, notifyWalletTopupSms } =
    await import("../src/lib/fitness/sms-flows");
  const { db } = await import("../src/lib/db");

  // ─── سناریو ۱: نگاشت قالب ارتقا ───
  check(
    "۱) basic→advanced = plan_upgrade_premium",
    planUpgradeSmsTemplateFor("basic", "advanced") === "plan_upgrade_premium"
  );
  check(
    "۱) standard→ultimate = plan_upgrade_premium",
    planUpgradeSmsTemplateFor("standard", "ultimate") === "plan_upgrade_premium"
  );
  check(
    "۱) basic→standard = plan_upgrade_standard",
    planUpgradeSmsTemplateFor("basic", "standard") === "plan_upgrade_standard"
  );
  check(
    "۱) advanced→ultimate (بالاتر→بالاتر) = null",
    planUpgradeSmsTemplateFor("advanced", "ultimate") === null
  );
  check(
    "۱) ultimate→basic (داون‌گرید) = null",
    planUpgradeSmsTemplateFor("ultimate", "basic") === null
  );
  check(
    "۱) basic→basic (تمدید) = null",
    planUpgradeSmsTemplateFor("basic", "basic") === null
  );

  const user = await db.user.findFirst({
    select: { id: true, name: true, mobile: true },
  });
  if (!user) {
    console.error("کاربر تستی در DB نیست");
    process.exit(1);
  }
  const stamp = Date.now();

  // ─── سناریو ۲: ارتقا به حرفه‌ای — قالب 275042 با سه متغیر ───
  calls.length = 0;
  failParamCalls = 0;
  const pay1 = `t1_${stamp}`;
  await notifyPlanUpgradeSms(user.id, "basic", "advanced", pay1);
  check(
    "۲) basic→advanced: یک تلاش موفق با NAME+PLANBASE+PLANUPDATE",
    calls.length === 1 &&
      calls[0].templateId === 275042 &&
      calls[0].params.length === 3 &&
      calls[0].params.some((p) => p.name === "PLANBASE") &&
      calls[0].params.some((p) => p.name === "PLANUPDATE"),
    `calls=${calls.length} tpl=${calls[0]?.templateId} params=${calls[0]?.params.length}`
  );

  // ─── سناریو ۳: اقتصادی → استاندارد — قالب 324322 ───
  calls.length = 0;
  const pay2 = `t2_${stamp}`;
  await notifyPlanUpgradeSms(user.id, "basic", "standard", pay2);
  check(
    "۳) basic→standard: قالب 324322 با سه متغیر",
    calls.length === 1 && calls[0].templateId === 324322 && calls[0].params.length === 3,
    `tpl=${calls[0]?.templateId}`
  );

  // ─── سناریو ۴: دداپ — همان پرداخت دوباره ───
  calls.length = 0;
  await notifyPlanUpgradeSms(user.id, "basic", "advanced", pay1);
  check("۴) دداپ: همان پرداخت دوباره → صفر درخواست جدید", calls.length === 0, `calls=${calls.length}`);

  // ─── سناریو ۵: wallet — قالب متغیر ندارد → نردبان کامل تا [] ───
  calls.length = 0;
  failParamCalls = 2; // NAME+AMOUNT خطا، NAME خطا، [] موفق
  const pay3 = `t3_${stamp}`;
  await notifyWalletTopupSms(user.id, 500000, pay3);
  check(
    "۵) wallet نردبان کامل: [NAME+AMOUNT]→[NAME]→[] موفق",
    calls.length === 3 &&
      calls[0].templateId === 556023 &&
      calls[0].params.length === 2 &&
      calls[1].params.length === 1 &&
      calls[2].params.length === 0,
    `calls=${calls.length} lens=${calls.map((c) => c.params.length).join(",")}`
  );

  // ─── سناریو ۶: wallet — قالب با NAME+AMOUNT موفق → یک تلاش ───
  calls.length = 0;
  failParamCalls = 0;
  const pay4 = `t4_${stamp}`;
  await notifyWalletTopupSms(user.id, 200000, pay4);
  check(
    "۶) wallet: یک تلاش با NAME+AMOUNT موفق",
    calls.length === 1 && calls[0].params.length === 2 && calls[0].templateId === 556023,
    `calls=${calls.length}`
  );

  // ─── پاکسازی رکوردهای تست ───
  await db.smsLog.deleteMany({
    where: { key: { contains: `_${stamp}` } },
  });
}

main()
  .then(() => {
    console.log(ok ? "\n✅ همهٔ سناریوهای v36 PASS شدند" : "\n❌ FAIL");
    process.exit(ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
