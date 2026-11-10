#!/usr/bin/env node
/**
 * prod-sync-audit-days-v183.mjs — ممیزی انطباق «تعداد روز تمرین» برنامه‌های فعال با پروفایل کاربران
 *
 * زمینه (تیکت #یوسف ابوطالبی): کاربر ۴ روز تمرین خواسته بود ولی برنامهٔ تولیدشده ۳ روزه بود.
 * از v183 موتور تولید «ترمیم قطعی» دارد (repairMissingWorkoutDays) — این اسکریپت فقط
 * «گزارش» برنامه‌های فعالِ قبلی است که هنوز مغایرت دارند تا مدیر از پنل ادمین
 * (پروندهٔ کاربر → «بازنویسی برنامه») برایشان تولید تازه بگیرد.
 *
 * ⚠️ این اسکریپت هیچ چیزی را تغییر نمی‌دهد (report-only) — اجرای آن کاملاً بی‌خطر است.
 *
 * مصرف (روی سرور، در ریشهٔ پروژه):
 *   bun scripts/prod-sync-audit-days-v183.mjs
 *
 * خروجی: جدول کاربرانی که برنامهٔ فعالِ تمرینی‌شان با تعداد روزِ درخواستی‌شان
 *         مغایرت دارد + راهنمای رفع از پنل.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function daysCountOf(content) {
  try {
    const c = JSON.parse(content);
    return Array.isArray(c?.days) ? c.days.length : 0;
  } catch {
    return -1;
  }
}

async function main() {
  console.log("─── ممیزی انطباق تعداد روز تمرین (v183) ───\n");
  const profiles = await db.onboardingProfile.findMany({
    select: { userId: true, workoutDays: true },
  });
  const byUser = new Map(profiles.map((p) => [p.userId, p.workoutDays]));

  // جدیدترین برنامهٔ فعال هر کاربر (نسخه‌های superseded نادیده)
  const plans = await db.workoutPlan.findMany({
    where: { active: true },
    select: { id: true, userId: true, content: true, createdAt: true, version: true },
    orderBy: { createdAt: "desc" },
  });

  const users = await db.user.findMany({
    select: { id: true, name: true, mobile: true, planName: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const seen = new Set();
  const rows = [];
  for (const pl of plans) {
    if (seen.has(pl.userId)) continue; // فقط جدیدترین برنامهٔ فعال هر کاربر
    seen.add(pl.userId);
    const requested = byUser.get(pl.userId);
    if (!requested) continue;
    const got = daysCountOf(pl.content);
    if (got > 0 && got !== requested) {
      const u = userById.get(pl.userId);
      rows.push({
        name: u?.name ?? "؟",
        mobile: u?.mobile ?? "؟",
        planName: u?.planName ?? "-",
        requested,
        got,
        version: pl.version,
        createdAt: pl.createdAt,
        userId: pl.userId,
      });
    }
  }

  if (rows.length === 0) {
    console.log("✅ هیچ مغایرتی یافت نشد — همهٔ برنامه‌های فعال با تعداد روز درخواستی کاربر سینک‌اند.\n");
    await db.$disconnect();
    return;
  }

  console.log(`⚠️  ${rows.length} کاربر با مغایرت تعداد روز (برنامهٔ فعال فعلی):\n`);
  console.log("نام | موبایل | پلن | درخواستی | موجود | تاریخ برنامه");
  for (const r of rows) {
    console.log(
      `${r.name} | ${r.mobile} | ${r.planName} | ${r.requested} روز | ${r.got} روز | ${r.createdAt.toISOString().slice(0, 10)}`
    );
  }
  console.log(
    "\n─── راهنمای رفع ───\n" +
      "برای هر کاربر بالا از پنل ادمین: کاربران → پروندهٔ کاربر → دکمهٔ «بازنویسی برنامه»\n" +
      "(یا تب «صف برنامه‌ها»). بازنویسی با موتور v183 تضمین می‌کند تعداد روز دقیقاً برابر\n" +
      "درخواست کاربر باشد — حتی اگر مدل هوش مصنوعی باز هم روزی کم بگذارد (ترمیم قطعی از بانک حرکات).\n" +
      "هیچ نیازی به تغییر دستی دیتابیس نیست.\n"
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error("audit failed:", e);
  process.exit(1);
});
