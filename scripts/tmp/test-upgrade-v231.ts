/**
 * test-upgrade-v231.ts — تست سنتیک دیرکتیو جدید ارتقا (v231) روی کپی DB سندباکس
 *
 * سناریوی A (دقیقاً race حسین نوربخش): اشتراک استاندارد فعال + WorkoutPlan فعال
 *   ولی MealPlan هنوز ساخته نشده + پرداخت پیشرفته → باید:
 *   ✓ isUpgrade=true → اشتراک فوری ACTIVE با همان endDate قبلی (مدت ثابت)
 *   ✓ User.planExpiresAt = endDate قبلی، planStartedAt = startDate قبلی
 *   ✓ ProgramRequest advanced = pending_body_photo (پیش‌نیاز — بدون شروع تولید)
 * سناریوی B (خرید جدید پیشرفته بدون اشتراک قبلی) → باید:
 *   ✓ اشتراک pending با پنجرهٔ ۷روزه (رفتار قبلی حفظ شده — رگرسیون صفر)
 *
 * اجرا: bun scripts/tmp/test-upgrade-v231.ts   (خودش جاوااسکریپت تست را پاک می‌کند)
 */
import { PrismaClient } from "@prisma/client";
import { deliverPlanPayment } from "../../src/lib/fitness/payment-delivery";

const db = new PrismaClient();
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

async function cleanup(mobile: string) {
  const u = await db.user.findUnique({ where: { mobile } });
  if (!u) return;
  const uid = u.id;
  await db.notification.deleteMany({ where: { userId: uid } });
  await db.funnelEvent.deleteMany({ where: { userId: uid } });
  await db.programRequest.deleteMany({ where: { userId: uid } });
  await db.subscription.deleteMany({ where: { userId: uid } });
  await db.payment.deleteMany({ where: { userId: uid } });
  await db.workoutPlan.deleteMany({ where: { userId: uid } });
  await db.mealPlan.deleteMany({ where: { userId: uid } });
  await db.user.delete({ where: { id: uid } });
}

async function main() {
  const stamp = Date.now().toString(36);
  const mobileA = `099910${stamp.slice(-5)}`;
  const mobileB = `099920${stamp.slice(-5)}`;
  await cleanup(mobileA);
  await cleanup(mobileB);

  // ═══ سناریوی A — race حسین ═══
  console.log("\n═══ A: ارتقای استاندارد→پیشرفته در حین تولید MealPlan (race) ═══");
  const userA = await db.user.create({
    data: {
      mobile: mobileA,
      name: `تست-ارتقا-A-${stamp}`,
      role: "USER",
      onboardingDone: true,
      planName: "standard",
      planStartedAt: new Date(Date.now() - 5 * 864e5),
      planExpiresAt: new Date(Date.now() + 40 * 864e5),
    },
  });
  const oldStart = new Date(Date.now() - 5 * 864e5);
  const oldEnd = new Date(Date.now() + 40 * 864e5);
  const oldSub = await db.subscription.create({
    data: {
      userId: userA.id,
      plan: "standard",
      status: "active",
      startDate: oldStart,
      endDate: oldEnd,
      durationDays: 45,
      pricePaid: 800000,
    },
  });
  // فقط WorkoutPlan فعال — MealPlan هنوز در حال تولید (قلب باگ race)
  await db.workoutPlan.create({
    data: { userId: userA.id, weekIndex: 0, content: "{}", active: true, version: 1 },
  });
  const payA = await db.payment.create({
    data: {
      userId: userA.id,
      amount: 400000,
      originalAmount: 1200000,
      plan: "advanced",
      paymentMethod: "gateway",
      authority: `TEST-A-${stamp}`,
      refId: `TEST-A-${stamp}`,
      status: "pending",
      description: "تست ارتقا",
    },
  });

  const resA = await deliverPlanPayment({
    userId: userA.id,
    payment: payA as never,
    refId: `TEST-A-${stamp}`,
  });

  const subsA = await db.subscription.findMany({ where: { userId: userA.id }, orderBy: { createdAt: "asc" } });
  const newSubA = subsA.find((s) => s.plan === "advanced");
  const freshA = await db.user.findUnique({ where: { id: userA.id } });
  const prA = await db.programRequest.findFirst({ where: { userId: userA.id, plan: "advanced" } });

  // نکته: پاسخ HTTP فیلد isUpgrade را اکسپوز نمی‌کند — اثبات ارتقا = خودِ رفتار
  // (اشتراک active + endDate قبلی + pending_body_photo) که پایین assert شده است.
  check("اشتراک پیشرفته ACTIVE است (نه pending)", newSubA?.status === "active", `status=${newSubA?.status}`);
  check("endDate = همان endDate دورهٔ قبلی (مدت ثابت)", newSubA?.endDate.getTime() === oldEnd.getTime(), `new=${newSubA?.endDate} old=${oldEnd}`);
  check("planExpiresAt کاربر = پایان دورهٔ قبلی", freshA?.planExpiresAt?.getTime() === oldEnd.getTime());
  check("planStartedAt کاربر = شروع دورهٔ قبلی", freshA?.planStartedAt?.getTime() === oldStart.getTime());
  check("ProgramRequest = pending_body_photo (پیش‌نیاز پلن پیشرفته)", prA?.status === "pending_body_photo", `status=${prA?.status}`);
  check("تولید برنامه خودکار شروع نشده (منتظر پیش‌نیاز)", (prA?.attempts ?? 0) === 0);
  check("اشتراک قبلی منقضی شده", (await db.subscription.findUnique({ where: { id: oldSub.id } }))?.status === "expired");
  check("پاسخ: subscriptionStatus=active", resA.subscriptionStatus === "active");
  check("پاسخ: subscriptionEnd = پایان قبلی", resA.subscriptionEnd === oldEnd.toISOString());

  // ═══ سناریوی B — خرید جدید پیشرفته (بدون اشتراک قبلی) → گیت پیش‌نیاز حفظ شود ═══
  console.log("\n═══ B: خرید جدید پیشرفته بدون اشتراک قبلی (رفتار قدیمی باید حفظ شود) ═══");
  const userB = await db.user.create({
    data: { mobile: mobileB, name: `تست-ارتقا-B-${stamp}`, role: "USER", onboardingDone: true },
  });
  const payB = await db.payment.create({
    data: {
      userId: userB.id,
      amount: 1200000,
      originalAmount: 1200000,
      plan: "advanced",
      paymentMethod: "gateway",
      authority: `TEST-B-${stamp}`,
      refId: `TEST-B-${stamp}`,
      status: "pending",
      description: "تست خرید جدید",
    },
  });
  const resB = await deliverPlanPayment({
    userId: userB.id,
    payment: payB as never,
    refId: `TEST-B-${stamp}`,
  });
  const newSubB = await db.subscription.findFirst({ where: { userId: userB.id, plan: "advanced" } });
  check("رفتار خریدِ جدید: اشتراک pending (یعنی isUpgrade=false)", newSubB?.status === "pending", `status=${newSubB?.status}`);
  check("startDate=null در حالت pending", newSubB?.startDate === null);
  check("پاسخ: subscriptionStatus=pending", resB.subscriptionStatus === "pending");
  check("پاسخ: needsBodyPhoto=true", resB.needsBodyPhoto === true);

  // ═══ پاکسازی ═══
  await cleanup(mobileA);
  await cleanup(mobileB);
  console.log("\n🧹 رکوردهای تست پاک شدند.");

  if (failures > 0) {
    console.log(`\n❌ ${failures} assert شکست خورد`);
    process.exit(1);
  }
  console.log("\n✅ ALL PASS — دیرکتیو v231 درست کار می‌کند");
  process.exit(0);
}

main()
  .catch((e) => {
    console.error("TEST ERROR:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
