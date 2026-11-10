/**
 * repair-never-activated-v264.ts — ترمیم قربانیان «پرداخت موفق + برنامهٔ ready + اشتراک هرگز-فعال‌نشده»
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * زمینه: اشتراک advanced/ultimate بعد از خرید با status="pending" و پنجرهٔ ۷روزه ساخته
 * می‌شود و فعال‌سازی در جریان «تولید برنامه» رخ می‌دهد. اگر فراخوان فعال‌سازی در شروع
 * چرخه از دست برود (خطای گذرا — مورد واقعی نیما امیر ی: خرید ۲۰۲۶-۱۱-۰۱، برنامهٔ ready
 * همان روز، فعال‌سازی هرگز)، کاربرِ پرداخت‌کرده تا کرون روز-۳۰ بی‌پلن می‌ماند.
 *
 * این اسکریپت (idempotent — اجرای تکراری بی‌اثر است):
 *   ۱) اشتراک‌های هرگز-فعال‌نشده با پرداخت موفق (paymentId → Payment.status=success) را می‌یابد
 *   ۲) اگر آخرین ProgramRequest کاربر «ready» و هم‌پلن با اشتراک باشد → فعال می‌کند:
 *      startDate = زمان ready شدن برنامه (request.updatedAt) — entitlement منصفانه از همان لحظه
 *      endDate  = startDate + durationDays
 *   ۳) فیلدهای User (planName/planStartedAt/planExpiresAt) را فقط اگر اشتراک فعالِ بهتر (تیر بالاتر)
 *      ندارد هم‌تراز می‌کند
 *   ۴) کاربرانِ pending_body_photo (منتظر عکس بدن) دست‌نخورده می‌مانند — وضعیت طراحی‌شدهٔ درست
 *
 * اجرا:  bun scripts/repair-never-activated-v264.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PLAN_TIER: Record<string, number> = { basic: 1, standard: 2, advanced: 3, ultimate: 4 };

async function main() {
  const subs = await db.subscription.findMany({
    where: {
      status: { in: ["pending", "expired"] },
      startDate: null,
      cancelledAt: null,
    },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  console.log(`اشتراک‌های هرگز-فعال‌نشده: ${subs.length}`);

  let repaired = 0;
  let skippedNoPayment = 0;
  let skippedNotReady = 0;
  let skippedPlanMismatch = 0;
  let skippedBlocked = 0;

  for (const sub of subs) {
    // فقط خریدهای واقعاً پرداخت‌شده
    if (!sub.paymentId) { skippedNoPayment++; continue; }
    const payment = await db.payment.findUnique({ where: { id: sub.paymentId }, select: { status: true } });
    if (!payment || payment.status !== "success") { skippedNoPayment++; continue; }

    // کاربر مسدود؟
    const user = await db.user.findUnique({
      where: { id: sub.userId },
      select: { isBlocked: true, planName: true, planExpiresAt: true },
    });
    if (!user || user.isBlocked) { skippedBlocked++; continue; }

    // آخرین درخواست برنامه باید ready و هم‌پلن باشد (یعنی پیش‌نیازها کامل و برنامه تحویل شده)
    const latestReq = await db.programRequest.findFirst({
      where: { userId: sub.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, plan: true, status: true, updatedAt: true },
    });
    if (!latestReq || latestReq.status !== "ready") { skippedNotReady++; continue; }
    if (latestReq.plan !== sub.plan) { skippedPlanMismatch++; continue; }

    // گارد تیر: اگر اشتراک فعالِ تیر بالاتر یا مساوی دارد، فقط اشتراک را active می‌کنیم
    // ولی فیلدهای User را دست نمی‌زنیم
    const betterActive = await db.subscription.findFirst({
      where: { userId: sub.userId, status: "active", endDate: { gt: new Date() } },
      orderBy: { endDate: "desc" },
    });
    const hasBetter = !!betterActive && (PLAN_TIER[betterActive.plan] ?? 0) >= (PLAN_TIER[sub.plan] ?? 0);

    // زمان ready شدن برنامه = شروع منصفانهٔ دوره (entitlement از همان لحظه)
    const start = latestReq.updatedAt ?? new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + (sub.durationDays || 45));

    // فعال‌سازی اتمیک idempotent — اگر همزمان فعال شده باشد count=0
    const claimed = await db.subscription.updateMany({
      where: { id: sub.id, status: { in: ["pending", "expired"] }, startDate: null },
      data: { status: "active", startDate: start, endDate: end },
    });
    if (claimed.count === 0) continue;

    repaired++;
    console.log(`✅ فعال شد: user=${sub.userId} plan=${sub.plan} start=${start.toISOString()} end=${end.toISOString()} (پرداخت ${sub.pricePaid ?? "—"} تومان)`);

    if (!hasBetter) {
      const updateData: { planName?: string; planStartedAt?: Date; planExpiresAt?: Date } = {};
      if (!user.planExpiresAt || user.planExpiresAt.getTime() < end.getTime()) {
        updateData.planExpiresAt = end;
      }
      if (!user.planExpiresAt) updateData.planStartedAt = start;
      updateData.planName = sub.plan;
      await db.user.update({ where: { id: sub.userId }, data: updateData });
    }
  }

  console.log(`\n── خلاصه ──
فعال‌شده: ${repaired}
بدون پرداخت موفق: ${skippedNoPayment}
آخرین درخواست ready نیست (منتظر پیش‌نیاز — وضعیت درست): ${skippedNotReady}
ناهم‌خوانی پلن درخواست/اشتراک: ${skippedPlanMismatch}
کاربر مسدود: ${skippedBlocked}`);
}

main()
  .catch((e) => { console.error("repair failed:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
