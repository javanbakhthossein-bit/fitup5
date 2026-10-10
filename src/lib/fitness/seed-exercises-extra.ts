/**
 * Seed: افزودن حرکات ورزشی «extra» (seed_ex_101 تا seed_ex_260)
 * اجرا: bun run src/lib/fitness/seed-exercises-extra.ts
 *
 * این اسکریپت ۱۵۰+ حرکت جدید اضافه می‌کند تا مجموع به ۲۵۰+ برسد.
 * هیچ تغییری در حرکات موجود ایجاد نمی‌کند.
 *
 * 🔧 v130: خودِ «داده» به seed-exercises-extra-data.ts منتقل شد تا هم این
 * اسکریپت و هم self-heal سرور (db-selfheal گام ۵) از یک منبع استفاده کنند.
 */
import { db } from "../db";
import { EXTRA_EXERCISES } from "./seed-exercises-extra-data";

async function main() {
  console.log(`🏋️ افزودن ${EXTRA_EXERCISES.length} حرکت جدید...`);

  let added = 0;
  let skipped = 0;

  for (const ex of EXTRA_EXERCISES) {
    const existing = await db.exerciseLibrary.findUnique({ where: { id: ex.id } });
    if (existing) {
      skipped++;
      continue;
    }
    await db.exerciseLibrary.create({
      data: {
        id: ex.id,
        name: ex.name,
        muscle: ex.muscle,
        category: ex.category,
        equipment: ex.equipment,
        description: ex.description,
        tips: ex.tips,
        mediaUrl: "",
        youtubeUrl: ex.youtubeUrl,
        difficulty: ex.difficulty,
      },
    });
    added++;
  }

  const total = await db.exerciseLibrary.count();
  console.log(`\n🎉 تمام!`);
  console.log(`  - افزوده شده: ${added}`);
  console.log(`  - رد شده (تکراری): ${skipped}`);
  console.log(`  - مجموع حرکات: ${total}`);
}

main().catch(console.error).finally(() => process.exit(0));
