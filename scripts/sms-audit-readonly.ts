/**
 * ممیزی فقط-خواندنی پیامک‌ها (بدون هیچ ارسالی) — v96
 * اجرا: bun run scripts/sms-audit-readonly.ts
 *
 * خروجی:
 *  ۱) شناسهٔ مؤثر هر قالب (override/env/پیش‌فرض)
 *  ۲) آمار SmsLog هر سناریو (sent/failed/آخرین ارسال)
 *  ۳) تعداد «نامزدهای واجد شرایط» هر سناریوی کرون در همین لحظه
 *     (از جمله بک‌لاگ 461291: آنبوردینگ‌تمام‌کردهٔ بدون خرید که هرگز پیامک نگرفته)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function fa(n: number): string {
  return n.toLocaleString("en-US");
}

async function main() {
  const now = new Date();
  console.log("═".repeat(64));
  console.log(`ممیزی پیامک — ${now.toISOString()}`);
  console.log("═".repeat(64));

  // ─── ۰) کلید API ───
  const hasKey = Boolean(process.env.SMSIR_API_KEY);
  console.log(`\nSMSIR_API_KEY: ${hasKey ? "✓ تنظیم شده" : "✗ تنظیم نشده!"}`);
  console.log(
    `CRON_SECRET: ${process.env.CRON_SECRET ? "✓ تنظیم شده" : "✗ تنظیم نشده → جاروی رفتاری کلاً خاموش است!"}`
  );

  // ─── ۱) آمار SmsLog بر اساس وضعیت ───
  const logByStatus = await db.smsLog.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("\n── SmsLog (کل تاریخچه) ──");
  for (const r of logByStatus) {
    console.log(`  ${r.status}: ${fa(r._count._all)}`);
  }

  // ─── ۲) تفکیک بر اساس کلید (خانواده‌ها) ───
  const allLogs = await db.smsLog.groupBy({
    by: ["key", "status"],
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const family = (key: string): string => {
    if (key.startsWith("abandoned_cart")) return "abandoned_cart";
    if (key.startsWith("purchase_")) return "purchase_*";
    if (key.startsWith("plan_upgrade")) return "plan_upgrade_*";
    if (key.startsWith("plan_expiring")) return "plan_expiring_*";
    if (key.startsWith("plan_expired")) return "plan_expired_*";
    if (key.startsWith("renewal_boost")) return "renewal_boost_*";
    if (key.startsWith("program_ready")) return "program_ready_*";
    if (key.startsWith("checkup_reminder")) return "checkup_reminder_*";
    if (key.startsWith("expired_winback")) return "expired_winback_*";
    return key;
  };
  const famMap = new Map<
    string,
    { sent: number; failed: number; lastSent: Date | null }
  >();
  for (const g of allLogs) {
    const f = family(g.key);
    const cur = famMap.get(f) ?? { sent: 0, failed: 0, lastSent: null };
    if (g.status === "sent") {
      cur.sent += g._count._all;
      if (g._max.createdAt && (!cur.lastSent || g._max.createdAt > cur.lastSent))
        cur.lastSent = g._max.createdAt;
    } else {
      cur.failed += g._count._all;
    }
    famMap.set(f, cur);
  }
  console.log("\n── تفکیک سناریوها (sent/failed/آخرین ارسال) ──");
  const fams = [...famMap.entries()].sort((a, b) => b[1].sent - a[1].sent);
  for (const [f, s] of fams) {
    console.log(
      `  ${f.padEnd(24)} sent=${fa(s.sent).padStart(5)} failed=${fa(s.failed).padStart(4)}  last=${s.lastSent ? s.lastSent.toISOString().slice(0, 16) : "—"}`
    );
  }

  // ─── ۳) نامزدهای واجد شرایط هر سناریو (بدون ارسال) ───
  const h = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000);

  // 461291 — پنجرهٔ فعلی ۲۴ تا ۴۸ ساعت
  const winbackInWindow = await db.user.count({
    where: {
      onboardingDone: true,
      onboardingCompletedAt: { lte: h(24), gt: h(48) },
      isBlocked: false,
      planName: null,
    },
  });
  // 461291 — بک‌لاگ: قدیمی‌تر از ۴۸ ساعت (هرگز وارد پنجرهٔ فعلی نمی‌شوند)
  const winbackBacklog = await db.user.count({
    where: {
      onboardingDone: true,
      onboardingCompletedAt: { lte: h(48) },
      isBlocked: false,
      planName: null,
    },
  });
  // از بک‌لاگ، چند نفرشان هرگز پیامک 461291 نگرفته‌اند؟
  const backlogSample = await db.user.findMany({
    where: {
      onboardingDone: true,
      onboardingCompletedAt: { lte: h(48) },
      isBlocked: false,
      planName: null,
    },
    select: { id: true, mobile: true },
    take: 5000,
  });
  let backlogNeverSent = 0;
  for (const u of backlogSample) {
    const norm = (u.mobile ?? "").replace(/\s/g, "").replace(/[+\-()]/g, "");
    const m = norm.startsWith("0098")
      ? norm.slice(4)
      : norm.startsWith("98")
        ? norm.slice(2)
        : norm.startsWith("0")
          ? norm.slice(1)
          : norm;
    if (!/^9\d{9}$/.test(m)) continue;
    const sent = await db.smsLog.findUnique({
      where: { mobile_key: { mobile: m, key: "onboarding_winback" } },
      select: { status: true },
    });
    if (sent?.status !== "sent") backlogNeverSent++;
  }
  console.log("\n── سناریو 461291 (وین‌بک آنبوردینگ) ──");
  console.log(`  داخل پنجرهٔ ۲۴-۴۸h الان: ${fa(winbackInWindow)} کاربر`);
  console.log(`  بک‌لاگ (>۴۸h بدون خرید): ${fa(winbackBacklog)} کاربر`);
  console.log(`  بک‌لاگی که هرگز 461291 نگرفته: ${fa(backlogNeverSent)} کاربر`);

  // 669068 — ناج
  const nudgeEligible = await db.user.count({
    where: {
      onboardingDone: false,
      isBlocked: false,
      createdAt: { lt: h(0.5), gt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
    },
  });
  console.log(`\n── سناریو 669068 (یادآوری آنبوردینگ) ──`);
  console.log(`  واجد شرایط الان (ثبت‌شدهٔ <۹۰ روز، آنبوردینگ ناتمام): ${fa(nudgeEligible)}`);

  // 612964 — خوش‌آمدگویی ۸ روزه
  const welcomeEligible = await db.user.count({
    where: { createdAt: { lte: h(8 * 24), gt: h(9 * 24) }, isBlocked: false },
  });
  console.log(`\n── سناریو 612964 (خوش‌آمدگویی ۸ روزه) ──`);
  console.log(`  داخل پنجرهٔ ۸-۹ روزی الان: ${fa(welcomeEligible)}`);

  // 184777 / 322780 / 604678 / 883325 — تمدید
  const expiring = await db.subscription.count({
    where: { status: "active", endDate: { gt: now, lt: new Date(now.getTime() + 30 * 60 * 60 * 1000) } },
  });
  const justExpired = await db.subscription.count({
    where: { status: "active", endDate: { lt: now, gt: h(24) } },
  });
  const expired72h = await db.user.count({
    where: { planExpiresAt: { lt: h(3 * 24), gt: h(4 * 24) }, isBlocked: false },
  });
  const boost8d = await db.user.count({
    where: { planExpiresAt: { lt: h(8 * 24), gt: h(9 * 24) }, isBlocked: false },
  });
  console.log(`\n── سناریوهای تمدید ──`);
  console.log(`  184777 (فردا منقضی — پنجرهٔ ۳۰h): ${fa(expiring)} اشتراک`);
  console.log(`  322780 (تازه منقضی — پنجرهٔ ۲۴h): ${fa(justExpired)} اشتراک`);
  console.log(`  604678 (۷۲ ساعت بعد انقضا): ${fa(expired72h)} کاربر`);
  console.log(`  883325 (۸ روز بعد انقضا): ${fa(boost8d)} کاربر`);

  // ترک درگاه
  const pendingGateway = await db.payment.count({
    where: {
      status: "pending",
      paymentMethod: "gateway",
      plan: { not: "wallet_topup" },
      createdAt: { gte: h(24), lte: h(0.5) },
    },
  });
  console.log(`\n── سناریو 248945 (ترک درگاه) ──`);
  console.log(`  پرداخت pending درگاه در پنجرهٔ ۳۰دقیقه-۲۴h: ${fa(pendingGateway)}`);

  // کاربران با موبایل نامعتبر (برای گزارش)
  const badMobileUsers = await db.user.findMany({
    select: { mobile: true },
    take: 100000,
  });
  const noMobile = badMobileUsers.filter((u) => {
    const m = (u.mobile ?? "").replace(/\s/g, "").replace(/[+\-()]/g, "");
    const norm = m.startsWith("0098")
      ? m.slice(4)
      : m.startsWith("98")
        ? m.slice(2)
        : m.startsWith("0")
          ? m.slice(1)
          : m;
    return !/^9\d{9}$/.test(norm);
  }).length;
  console.log(`\n── متفرقه ──`);
  console.log(`  کاربران با موبایل نامعتبر/خالی: ${fa(noMobile)}`);

  console.log("\n✅ ممیزی فقط-خواندنی تمام شد — هیچ پیامکی ارسال نشد.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
