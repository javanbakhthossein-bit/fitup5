#!/usr/bin/env bun
/**
 * strip-supplements-basic-users.mjs — پاکسازی یک‌بارهٔ دیتا (v79)
 *
 * گزارش مالک: «برای کاربر با پلن اقتصادی برنامه مکمل ساخته شده که خیلی اشتباهه —
 * برنامهٔ مکمل فقط برای استاندارد به بالاست.»
 *
 * ریشه: کاربرانی که قبلاً پلن بالاتر داشتند (یا در لحظهٔ تولید، پلن دیگری بود)
 * برنامهٔ مکمل‌دار در DB دارند و با تغییر پلن به اقتصادی، محتوای قدیمی همچنان
 * نمایش داده می‌شد. گیت نمایش (supplement-gate.ts) جلوی نمایش را می‌گیرد؛ این
 * اسکریپت محتوای ذخیره‌شده را هم برای همیشه تمیز می‌کند (دست‌نوشتهٔ ماندگار).
 *
 * مصرف: bun scripts/strip-supplements-basic-users.mjs [--dry]
 *  --dry: فقط گزارش می‌دهد و چیزی تغییر نمی‌دهد
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DRY = process.argv.includes("--dry");

// پلن‌های بدون مجوز مکمل: basic و null (بدون پلن فعال)
const users = await db.user.findMany({
  where: { OR: [{ planName: "basic" }, { planName: null }] },
  select: { id: true, name: true, mobile: true, planName: true },
});

let scanned = 0;
let cleaned = 0;

for (const u of users) {
  const plans = await db.mealPlan.findMany({
    where: { userId: u.id },
    select: { id: true, content: true },
  });
  for (const plan of plans) {
    scanned++;
    let content;
    try {
      content = JSON.parse(plan.content);
    } catch {
      continue; // محتوای خراب — دست نمی‌زنیم
    }
    if (content == null || typeof content !== "object") continue;
    const had =
      "supplements" in content ||
      "supplementStack" in content ||
      "supplementTimingNotes" in content;
    const hasItems =
      (Array.isArray(content.supplements) && content.supplements.length > 0) ||
      (Array.isArray(content.supplementStack) && content.supplementStack.length > 0);
    if (!had || !hasItems) continue; // چیزی برای پاک کردن نیست

    delete content.supplements;
    delete content.supplementStack;
    delete content.supplementTimingNotes;

    if (!DRY) {
      await db.mealPlan.update({
        where: { id: plan.id },
        data: { content: JSON.stringify(content) },
      });
    }
    cleaned++;
    console.log(
      `${DRY ? "[dry] would clean" : "cleaned"} mealPlan=${plan.id} user=${u.mobile} (${u.name ?? "—"}, plan=${u.planName ?? "none"})`
    );
  }
}

console.log(
  `\n✅ done — users(no-supplement-plan): ${users.length}, mealPlans scanned: ${scanned}, ${DRY ? "would clean" : "cleaned"}: ${cleaned}`
);
await db.$disconnect();
if (DRY) console.log("(dry run — هیچ داده‌ای تغییر نکرد)");
