/**
 * تست v235 — «فقط یک پیامک برای رهاکنندهٔ درگاه» (دیرکتیو قطعی مالک)
 * — روی کپی DB در /tmp (DB واقعی دست‌خورده؛ بدون کلید API → هیچ تماس خارجی)
 *
 * ثابت‌شدن‌ها:
 *  A) کاربر واجد + قالب ۲۴۸۹۴۵ → کد تخفیف «هم‌زمان با تلاش ارسال» + نوتیف؛
 *     شکست ارسال (بدون کلید API) → pre-write انجام نمی‌شود → جاروی T+30 تلاش می‌کند (در نهایت یک پیامک)
 *  B) مسیر قالبِ اختصاصی واقعاً مرده است: env غیرواقعی SMSIR_PAYMENT_REMINDER_TEMPLATE_ID
 *     نادیده گرفته می‌شود — گاردهای ترک-درگاه (که در v234 در حالت اختصاصی دور زده می‌شدند)
 *     همچنان اعمال می‌شوند → دو-لمس به‌صورت ساختاری غیرممکن است
 *  C) acOwned — ترک-درگاه صاحب پرداخت (sent/queued) → یادآور کنار می‌رود
 *  D) گاردهای تخفیف — پلن فعال / کد خوش‌آمد / سقف ۷روزه → skip بدون کد و بدون نوتیف
 *  E) pre-write ضد دوبل — بعد از mark، جاروی ترک-درگاه داپ می‌زند (کنترل منفی هم)
 *  F) شب تهران — سکوت کامل
 *  G) هیچ قالبی تنظیم نباشد → فقط نوتیف + ردیف no-template
 *
 * اجرا:
 *   cp db/custom.db /tmp/pr-v235-test.db
 *   DATABASE_URL=file:/tmp/pr-v235-test.db SMSIR_ABANDONED_CART_TEMPLATE_ID=248945 \
 *     bun --conditions react-server scripts/tmp/test-payment-reminder-v235-one-message.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  runPaymentReminderScenario,
  markAbandonedCartSentViaReminder,
} from "../../src/lib/fitness/payment-reminder-scenario";
import { runAbandonedCartScenario } from "../../src/lib/fitness/abandoned-cart-scenario";

const db = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

const U = "t235u", P = "t235p";
const auth = (n: string) => `A0000000000000000000000000t235p${n}`;

async function mkUser(n: string, mobile: string, name = "تست یک‌پیامک") {
  await db.user.create({ data: { id: `${U}${n}`, mobile, name } });
}
async function mkPayment(n: string, userN: string, minAgo: number, base: Date) {
  await db.payment.create({ data: {
    id: `${P}${n}`, userId: `${U}${userN}`, amount: 1080000, plan: "advanced",
    paymentMethod: "gateway", status: "pending", authority: auth(n),
    createdAt: new Date(base.getTime() - minAgo * 60 * 1000),
  } });
}
async function cleanup() {
  await db.smsLog.deleteMany({ where: { OR: [{ key: { startsWith: "payment_reminder_t235p" } }, { key: { startsWith: "abandoned_cart_t235p" } }, { key: { startsWith: "abandoned_cart_t235cap" } }] } });
  await db.smsShortLink.deleteMany({ where: { target: { contains: "t235" } } });
  await db.notification.deleteMany({ where: { userId: { startsWith: U } } });
  await db.userDiscountCode.deleteMany({ where: { userId: { startsWith: U } } });
  await db.subscription.deleteMany({ where: { userId: { startsWith: U } } });
  await db.payment.deleteMany({ where: { id: { startsWith: P } } });
  await db.user.deleteMany({ where: { id: { startsWith: U } } });
}

async function main() {
  delete process.env.SMSIR_PAYMENT_REMINDER_TEMPLATE_ID; // باید کاملاً بی‌اثر باشد
  await cleanup();

  const t0 = Date.now();
  const force = { forceSendWindow: true };

  // ─── A) کاربر واجد + قالب ۲۴۸۹۴۵ (env) → لمسِ تخفیف، ۲۰ دقیقه زودتر ───
  console.log("A) کاربر واجد + قالب ترک-درگاه ۲۴۸۹۴۵:");
  await mkUser("1", "09130000101");
  await mkPayment("1", "1", 15, new Date(t0));
  const rA = await runPaymentReminderScenario(new Date(t0), force);
  check("candidates=1", rA.candidates === 1, JSON.stringify(rA));
  check("smsNoTemplate=0 (قالب ۲۴۸۹۴۵ از env خوانده شد)", rA.smsNoTemplate === 0);
  check("تلاش ارسال شد (بدون کلید API شکست خورد → T+30 خودش تلاش می‌کند)", rA.skipped.failed === 1, JSON.stringify(rA.skipped));
  check("نوتیف اولین تلاش صادر شد", rA.notified === 1);
  const codeA = await db.userDiscountCode.findFirst({ where: { userId: `${U}1`, reason: "abandoned_cart" } });
  check("کد تخفیف واقعی هم‌زمان با تلاش ارسال ساخته شد (متن قالب صادق)", !!codeA, `value=${codeA?.value}`);
  check("ارسال ناموفق → pre-write دداپ ترک-درگاه نشد (در نهایت فقط یک پیامک در T+30)",
    !(await db.smsLog.findUnique({ where: { mobile_key: { mobile: "9130000101", key: "abandoned_cart_t235p1" } } })));

  // ─── B) مسیر قالب اختصاصی مرده است — env غیرواقعی باید کاملاً نادیده گرفته شود ───
  console.log("B) نبودِ مسیر قالب اختصاصی (ضدِ دو-لمس، ساختاری):");
  process.env.SMSIR_PAYMENT_REMINDER_TEMPLATE_ID = "999999"; // v234 این را جدی می‌گرفت
  await mkUser("2", "09130000102");
  await db.userDiscountCode.create({ data: { userId: `${U}2`, code: "T235WELCOME2", type: "percent", value: 15, reason: "welcome_offer", isUsed: false, validUntil: new Date(t0 + 24 * 3600 * 1000) } });
  await mkPayment("2", "2", 15, new Date(t0));
  const rB = await runPaymentReminderScenario(new Date(t0), force);
  check("env اختصاصی نادیده گرفته شد → گارد خوش‌آمد اعمال شد (در v234 دور زده می‌شد)",
    rB.skipped.discountGuard >= 1, JSON.stringify(rB.skipped));
  check("برای کاربرِ کد-خوش‌آمد-دار تلاش ارسال/کد/نوتیف نشد",
    (await db.notification.count({ where: { userId: `${U}2` } })) === 0 &&
    (await db.userDiscountCode.count({ where: { userId: `${U}2`, reason: "abandoned_cart" } })) === 0);
  delete process.env.SMSIR_PAYMENT_REMINDER_TEMPLATE_ID;

  // ─── C) acOwned — صاحبِ ترک-درگاه (sent / queued صبح) ───
  console.log("C) گارد acOwned — ضد دوبل با ترک-درگاه/صف صبح:");
  await mkUser("3", "09130000103");
  await mkPayment("3", "3", 15, new Date(t0));
  await db.smsLog.create({ data: { mobile: "9130000103", key: "abandoned_cart_t235p3", templateId: "248945", userId: `${U}3`, status: "queued", error: "queued_for_morning (تست)" } });
  await mkUser("3b", "09130000104");
  await mkPayment("3b", "3b", 15, new Date(t0));
  await db.smsLog.create({ data: { mobile: "9130000104", key: "abandoned_cart_t235p3b", templateId: "248945", userId: `${U}3b`, status: "sent", error: "sent (تست)" } });
  const rC = await runPaymentReminderScenario(new Date(t0), force);
  check("هر دو پرداخت acOwned شمرده شد", rC.skipped.acOwned === 2, JSON.stringify(rC.skipped));
  check("برای صاحب‌دارها هیچ ردیف یادآور/کد/نوتیفی ساخته نشد",
    !(await db.smsLog.findUnique({ where: { mobile_key: { mobile: "9130000103", key: "payment_reminder_t235p3" } } })) &&
    !(await db.smsLog.findUnique({ where: { mobile_key: { mobile: "9130000104", key: "payment_reminder_t235p3b" } } })) &&
    (await db.userDiscountCode.count({ where: { userId: { in: [`${U}3`, `${U}3b`] } } })) === 0 &&
    (await db.notification.count({ where: { userId: { in: [`${U}3`, `${U}3b`] } } })) === 0);
  check("ردیف queued دست‌نخورده ماند (صف صبح v217 محترم)",
    (await db.smsLog.findUnique({ where: { mobile_key: { mobile: "9130000103", key: "abandoned_cart_t235p3" } } }))?.status === "queued");

  // ─── D) گاردهای تخفیف (همیشه — متن قالب وعدهٔ تخفیف دارد) ───
  // ایزوله‌سازی: پرداخت‌های بخش‌های قبلی (p1,p2,p3,p3b) بیرون پنجرهٔ ۱۰–۲۰ دقیقه
  // برده می‌شوند (۲۵ دقیقه — هنوز داخل پنجرهٔ ترک-درگاه هم نیست) تا شمارنده‌ها دقیق بمانند.
  await db.payment.updateMany({ where: { id: { in: [`${P}1`, `${P}2`, `${P}3`, `${P}3b`] } }, data: { createdAt: new Date(t0 - 25 * 60 * 1000) } });
  console.log("D) گاردهای تخفیف — پلن فعال / سقف ۷روزه:");
  await mkUser("4", "09130000105");
  await db.subscription.create({ data: { userId: `${U}4`, plan: "basic", status: "active", endDate: new Date(t0 + 20 * 24 * 3600 * 1000), pricePaid: 350000 } });
  await mkPayment("4", "4", 15, new Date(t0));
  await mkUser("5", "09130000106");
  await db.smsLog.create({ data: { mobile: "9130000106", key: "abandoned_cart_t235cap5", templateId: "248945", userId: `${U}5`, status: "sent", createdAt: new Date(t0 - 2 * 24 * 3600 * 1000) } });
  await mkPayment("5", "5", 15, new Date(t0));
  const rD = await runPaymentReminderScenario(new Date(t0), force);
  check("دو گارد دقیقاً شمرده شد (پلن فعال / سقف۷روزه)", rD.skipped.discountGuard === 2, JSON.stringify(rD.skipped));
  check("برای هیچ‌کدام کد/نوتیف ساخته نشد",
    (await db.userDiscountCode.count({ where: { userId: { in: [`${U}4`, `${U}5`] }, reason: "abandoned_cart" } })) === 0 &&
    (await db.notification.count({ where: { userId: { in: [`${U}4`, `${U}5`] } } })) === 0);

  // ─── E) pre-write ضد دوبل: بعد از «ارسال موفق» شبیه‌سازی‌شده، جاروی T+30 داپ می‌زند ───
  console.log("E) pre-write abandoned_cart — ضد دوبل با جاروی ۳۰دقیقه‌ای:");
  await mkUser("6", "09130000107");
  await mkPayment("6", "6", 35, new Date(t0)); // بیرون پنجرهٔ یادآور — فقط ترک-درگاه
  const marked = await markAbandonedCartSentViaReminder("9130000107", "t235p6", "248945", `${U}6`);
  check("pre-write موفق", marked);
  await mkUser("7", "09130000108");
  await mkPayment("7", "7", 35, new Date(t0));
  const rAC = await runAbandonedCartScenario(new Date(t0), force);
  check("پرداخت pre-write شده → alreadySent (داپ — پیامک دوم هرگز نمی‌رود)", rAC.alreadySent >= 1, JSON.stringify({ alreadySent: rAC.alreadySent }));
  check("برای pre-write شده هیچ کدی ساخته نشد",
    (await db.userDiscountCode.count({ where: { userId: `${U}6` } })) === 0);
  check("کنترل منفی: بدون pre-write پردازش شد (کد ساخت)",
    !!(await db.userDiscountCode.findFirst({ where: { userId: `${U}7`, reason: "abandoned_cart" } })));
  check("سقف ۷روزه: pre-write با کلید abandoned_cart_* شمرده می‌شود",
    !!(await db.smsLog.findFirst({ where: { mobile: "9130000107", key: { startsWith: "abandoned_cart_" }, status: "sent" } })));

  // ─── F) شب تهران — سکوت کامل ───
  console.log("F) خارج از پنجرهٔ ساعت تهران:");
  const nightNow = new Date("2026-10-12T23:30:00.000Z"); // ۰۳:۰۰ تهران
  await mkUser("8", "09130000109");
  await mkPayment("8", "8", 15, nightNow);
  const rF = await runPaymentReminderScenario(nightNow);
  check("outOfHours دقیقاً ۱", rF.skipped.outOfHours === 1, JSON.stringify(rF.skipped));
  check("شب: بدون نوتیف/کد/ردیف",
    (await db.notification.count({ where: { userId: `${U}8` } })) === 0 &&
    !(await db.userDiscountCode.findFirst({ where: { userId: `${U}8` } })) &&
    !(await db.smsLog.findUnique({ where: { mobile_key: { mobile: "9130000109", key: "payment_reminder_t235p8" } } })));

  // ─── G) هیچ قالبی تنظیم نباشد → فقط نوتیف (خرابی نیست) ───
  // ایزوله‌سازی: p4,p5 هم بیرون پنجرهٔ یادآور برده می‌شوند تا فقط p9 اسکن شود.
  await db.payment.updateMany({ where: { id: { in: [`${P}4`, `${P}5`] } }, data: { createdAt: new Date(t0 - 25 * 60 * 1000) } });
  console.log("G) بدون هیچ قالبی — فقط نوتیف درون‌برنامه:");
  const savedEnv = process.env.SMSIR_ABANDONED_CART_TEMPLATE_ID;
  delete process.env.SMSIR_ABANDONED_CART_TEMPLATE_ID;
  await mkUser("9", "09130000110");
  await mkPayment("9", "9", 15, new Date(t0));
  const rG = await runPaymentReminderScenario(new Date(t0), force);
  check("smsNoTemplate=1 شمرده شد", rG.smsNoTemplate === 1, JSON.stringify(rG));
  check("نوتیف همچنان صادر شد (کاربر اپ می‌بیند)", rG.notified === 1);
  check("بدون کد تخفیف و بدون pre-write",
    !(await db.userDiscountCode.findFirst({ where: { userId: `${U}9` } })) &&
    !(await db.smsLog.findUnique({ where: { mobile_key: { mobile: "9130000110", key: "abandoned_cart_t235p9" } } })));
  if (savedEnv !== undefined) process.env.SMSIR_ABANDONED_CART_TEMPLATE_ID = savedEnv;

  console.log(`\nنتیجه: ${pass} PASS / ${fail} FAIL`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
