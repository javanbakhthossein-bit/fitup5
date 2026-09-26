/**
 * تست رفتاری v33 — پیامک‌های خرید موفق (423726 / 612405 / 565185)
 *
 * fetch سراسری با یک mock sms.ir جایگزین می‌شود تا جریان واقعی
 * notifyPlanPurchaseSms بدون هزینهٔ پیامک تست شود:
 *   سناریو ۱: advanced → قالب 423726؛ تلاش اول با NAME خطای «قالب بدون متغیر»
 *             می‌گیرد → تلاش دوم بدون پارامتر موفق → SmsLog=sent (خودترمیم)
 *   سناریو ۲: standard → همان قالب مشترک 565185 (basic+standard)
 *   سناریو ۳: ultimate → قالب 612405
 *   سناریو ۴: دداپ — همان پرداخت دوباره → هیچ درخواست جدیدی به گیت‌وی نمی‌رود
 *   سناریو ۵: پلن ناشناخته → کاملاً بی‌صدا
 *
 * اجرا: bun run scripts/test-purchase-sms.ts
 */
// ماژول مستقل (جلوگیری از تصادم global-scope بین اسکریپت‌ها در tsc)
export {};

process.env.DATABASE_URL ||= "file:/home/z/my-project/db/custom.db";
process.env.SMSIR_API_KEY = "test-key-sandbox";
process.env.SMSIR_TEMPLATE_PURCHASE_ADVANCED = "423726";
process.env.SMSIR_TEMPLATE_PURCHASE_ULTIMATE = "612405";
process.env.SMSIR_TEMPLATE_PURCHASE_BASIC = "565185";

interface CapturedCall {
  templateId: number;
  params: Array<{ name: string; value: string }>;
}
const calls: CapturedCall[] = [];
/** اگر true باشد، اولین درخواستِ «دارای پارامتر» خطای قالب sms.ir را شبیه‌سازی می‌کند */
let failNextParamCall = true;

(globalThis as any).fetch = (async (_url: any, init: any) => {
  const body = JSON.parse(init?.body || "{}");
  const params: Array<{ name: string; value: string }> = body.parameters ?? [];
  calls.push({ templateId: body.templateId, params });
  const hasParams = params.length > 0;
  if (hasParams && failNextParamCall) {
    failNextParamCall = false;
    // شبیه‌سازی خطای sms.ir برای قالبی که متغیر ندارد ولی پارامتر گرفته
    return new Response(JSON.stringify({ status: 1006, message: "پارامتر ارسالی با قالب همخوانی ندارد" }), { status: 200 });
  }
  return new Response(
    JSON.stringify({ status: 1, message: "موفق", data: { messageId: Math.floor(Math.random() * 100000), cost: 100 } }),
    { status: 200 }
  );
}) as any;

let ok = true;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) ok = false;
}

async function main() {
  const { notifyPlanPurchaseSms } = await import("../src/lib/fitness/sms-flows");
  const { db } = await import("../src/lib/db");

  const user = await db.user.findFirst({
    select: { id: true, name: true, mobile: true },
  });
  if (!user?.mobile) {
    console.error("کاربر تستی در DB نیست");
    process.exit(1);
  }
  const stamp = Date.now();

  // ─── سناریو ۱: advanced با خودترمیم پارامتر ───
  failNextParamCall = true;
  calls.length = 0;
  const pay1 = `t1_${stamp}`;
  await notifyPlanPurchaseSms(user.id, "advanced", pay1);
  const log1 = await db.smsLog.findUnique({
    where: { mobile_key: { mobile: user.mobile.replace(/^0/, ""), key: `purchase_advanced_${pay1}` } },
  });
  check(
    "۱) advanced → دو تلاش (با NAME خطا → بدون پارامتر موفق)",
    calls.length === 2 && calls[0].templateId === 423726 && calls[0].params.length === 1 && calls[1].params.length === 0,
    `calls=${calls.length} tpl=${calls[0]?.templateId}`
  );
  check("۱) SmsLog=sent", log1?.status === "sent", `status=${log1?.status}`);

  // ─── سناریو ۲: standard → قالب مشترک 565185 ───
  failNextParamCall = false;
  calls.length = 0;
  const pay2 = `t2_${stamp}`;
  await notifyPlanPurchaseSms(user.id, "standard", pay2);
  check("۲) standard → قالب 565185، یک تلاش موفق با NAME", calls.length === 1 && calls[0].templateId === 565185 && calls[0].params.length === 1, `calls=${calls.length} tpl=${calls[0]?.templateId}`);

  // ─── سناریو ۳: ultimate → قالب 612405 ───
  calls.length = 0;
  const pay3 = `t3_${stamp}`;
  await notifyPlanPurchaseSms(user.id, "ultimate", pay3);
  check("۳) ultimate → قالب 612405", calls.length === 1 && calls[0].templateId === 612405, `tpl=${calls[0]?.templateId}`);

  // ─── سناریو ۴: دداپ — همان پرداخت دوباره ───
  calls.length = 0;
  await notifyPlanPurchaseSms(user.id, "ultimate", pay3);
  check("۴) دداپ: همان پرداخت دوباره → صفر درخواست جدید", calls.length === 0, `calls=${calls.length}`);

  // ─── سناریو ۵: پلن ناشناخته ───
  calls.length = 0;
  await notifyPlanPurchaseSms(user.id, "unknown_plan", `t5_${stamp}`);
  check("۵) پلن ناشناخته → بی‌صدا (صفر درخواست)", calls.length === 0, `calls=${calls.length}`);

  // ─── پاکسازی رکوردهای تست ───
  await db.smsLog.deleteMany({
    where: { key: { contains: `_${stamp}` } },
  });
}

main()
  .then(() => {
    console.log(ok ? "\n✅ همهٔ سناریوهای پیامک خرید PASS شدند" : "\n❌ FAIL");
    process.exit(ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
