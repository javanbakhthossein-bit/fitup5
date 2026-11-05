/**
 * scripts/fix-equipment-tags-v256.ts — باگ B8: اصلاح تگ تجهیزات ۱۵ حرکتِ نیازمند بار/پارالل
 * ─────────────────────────────────────────────────────────────────────────────────
 * اثبات E2E (AI واقعی، کاربر سنتزی خانگیِ بدون تجهیزات): کاربر «بارفیکس اکسنتریک/
 * استرالیایی» و «دیپس پارالل» می‌گرفت چون بانک این حرکات را «bodyweight» تگ زده بود.
 *
 * فیکس دو-لایه:
 *   ① گیت (plan-quality-gate.ts v256): الگوهای نام + نرمال‌ساز توکن — خودش کافی است
 *   ② این اسکریپت: تگ درست در بانک (اعتمادبه‌یک‌منبع) — idempotent، هر بار اجرا بی‌خطر
 *
 * اجرا (سندباکس/سرور):
 *   DATABASE_URL=file:./db/custom.db bun scripts/fix-equipment-tags-v256.ts
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

// حرکات نیازمند «بارفیکس» (میلهٔ افقی بالای سر) — تگ رسمی بانک: pull-up bar
const PULLUP_BAR_NAMES = [
  "بارفیکس",
  "بارفیکس استرالیایی (Inverted Row)",
  "بارفیکس اکسنتریک (Negative Pull-Up)",
  "بارفیکس دست برعکس (Chin-Up)",
  "بارفیکس دست خنثی (Neutral-Grip Pull-Up)",
  "بارفیکس دست‌باز",
  "بارفیکس دست‌جمع",
  "بارفیکس دست‌جمع پرونیشن (Close-Grip Pull-Up)",
  "بارفیکس سنگین (Weighted Pull-Up)",
  "بارفیکس چست تو بار (Chest-to-Bar Pull-Up)",
  "میوزآپ بارفیکس (Bar Muscle-Up)",
  "میوزآپ حلقه (Ring Muscle-Up)", // v256 — حلقهٔ ژیمناستیک
];
// حرکات نیازمند «پارالل» — تگ رسمی بانک: parallel bars
const PARALLEL_BAR_NAMES = [
  "دیپس پارالل",
  "دیپ پارالل (Parallel Bar Dip)",
  "پارالل سینه (Chest Dip)",
  "پارالل پشت بازو (Triceps Dip)",
  "دیپس پشت بازو با وزنه", // v256 — دیپ وزنه‌دار هم پارالل می‌خواهد (+وزنه)
];
// حرکات حلقهٔ ژیمناستیک — تگ: rings
const RING_NAMES = ["دیپ حلقه (Ring Dip)", "میوزآپ حلقه (Ring Muscle-Up)"];

async function main() {
  let fixed = 0;
  for (const name of PULLUP_BAR_NAMES) {
    const rows = await db.exerciseLibrary.findMany({ where: { name, isActive: true }, select: { id: true, equipment: true } });
    for (const r of rows) {
      if ((r.equipment ?? "").trim() === "pull-up bar") continue; // درست است — idempotent
      await db.exerciseLibrary.update({ where: { id: r.id }, data: { equipment: "pull-up bar" } });
      console.log(`✅ «${name}»: ${r.equipment || "NULL"} → pull-up bar`);
      fixed++;
    }
  }
  for (const name of PARALLEL_BAR_NAMES) {
    const rows = await db.exerciseLibrary.findMany({ where: { name, isActive: true }, select: { id: true, equipment: true } });
    for (const r of rows) {
      const target = name === "دیپس پشت بازو با وزنه" ? "parallel bars,weight" : "parallel bars";
      if ((r.equipment ?? "").trim() === target) continue;
      await db.exerciseLibrary.update({ where: { id: r.id }, data: { equipment: target } });
      console.log(`✅ «${name}»: ${r.equipment || "NULL"} → ${target}`);
      fixed++;
    }
  }
  for (const name of RING_NAMES) {
    const rows = await db.exerciseLibrary.findMany({ where: { name, isActive: true }, select: { id: true, equipment: true } });
    for (const r of rows) {
      if ((r.equipment ?? "").trim() === "rings") continue;
      await db.exerciseLibrary.update({ where: { id: r.id }, data: { equipment: "rings" } });
      console.log(`✅ «${name}»: ${r.equipment || "NULL"} → rings`);
      fixed++;
    }
  }
  // راستی‌آزمایی: هیچ حرکت فعالِ بارفیکس/پاراللی با تگ bodyweight باقی نمانده باشد
  const all = await db.exerciseLibrary.findMany({ where: { isActive: true }, select: { name: true, equipment: true } });
  const bad = all.filter(
    (r) =>
      (/بارفیکس|پارالل|میوزآپ|muscle.?up|chin.?up|pull.?up|parallel/i.test(r.name)) &&
      (/bodyweight|^$|NULL/i.test(r.equipment ?? "") || !r.equipment)
  );
  if (bad.length > 0) {
    console.error(`❌ ${bad.length} ردیف هنوز بدتگ است:`, bad.map((b) => b.name).join("، "));
    process.exitCode = 1;
  } else {
    console.log(`\n══════ کامل شد: ${fixed} ردیف اصلاح شد · صفر حرکت بدتگ باقی مانده ✅ ══════`);
  }
}

main().finally(() => process.exit(0));
