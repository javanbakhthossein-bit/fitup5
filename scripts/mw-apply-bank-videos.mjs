/**
 * mw-apply-bank-videos.mjs — v189: نوشتن ویدیوهای Muscle Wiki در بانک حرکات
 *
 * ورودی: research/musclewiki/prepared.json (خروجی mw-prepare-videos.mjs)
 * قاعدهٔ مالک (بانک حرکات — متفاوت از چالش‌ها):
 *   - حرکاتِ دارای ویدیوی اختصاصی (videoUrl) دست‌نخورده می‌مانند (اصلاً mw نمی‌گیرند)
 *   - حرکاتِ دارای یوتیوب → mwVideoUrl / mwVideoUrlFemale پر می‌شود
 *     (نمایش: اختصاصی > Muscle Wiki > یوتیوب؛ یوتیوبِ جایگزین‌شده دیگر نشان داده نمی‌شود)
 *   - حرکاتی که ویدیوی Muscle Wiki ندارند → همان یوتیوب قبلی می‌ماند
 *   - fallback جنسیتی: اگر فقط ویدیوی جنسیت مقابل موجود بود، همان ثبت می‌شود
 *     (تا کمترین تعداد یوتیوبِ باقی‌مانده داشته باشیم)
 *
 * اجرا: node scripts/mw-apply-bank-videos.mjs [--dry]
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = "/home/z/my-project";
const dry = process.argv.includes("--dry");

const prepared = JSON.parse(fs.readFileSync(path.join(ROOT, "research/musclewiki/prepared.json"), "utf8"));
const bank = prepared.bank ?? {};

process.env.DATABASE_URL = process.env.DATABASE_URL || "file:/home/z/my-project/db/custom.db";
const { createRequire } = await import("node:module");
const req = createRequire(path.join(ROOT, "package.json"));
let PrismaClient;
try {
  ({ PrismaClient } = req("@prisma/client"));
} catch {
  console.error("❌ @prisma/client در node_modules پیدا نشد.");
  process.exit(1);
}
const db = new PrismaClient();

async function main() {
  const ids = Object.keys(bank);
  console.log(`📋 ورودی‌های نقشه: ${ids.length}`);

  // فقط ردیف‌هایی که ویدیوی اختصاصی «ندارند» آپدیت می‌شوند
  const rows = await db.exerciseLibrary.findMany({
    where: { id: { in: ids } },
    select: { id: true, videoUrl: true },
  });
  const customSet = new Set(rows.filter((r) => (r.videoUrl ?? "").trim() !== "").map((r) => r.id));

  let updated = 0;
  let skippedCustom = 0;
  let noVideo = 0;
  const updates = [];

  for (const id of ids) {
    const rec = bank[id];
    if (!rec || (!rec.male && !rec.female)) {
      noVideo++;
      continue;
    }
    if (customSet.has(id)) {
      skippedCustom++;
      continue; // اختصاصی دارد — دست نمی‌خوریم
    }
    const male = rec.male ?? rec.female ?? "";
    const female = rec.female ?? rec.male ?? "";
    updates.push({ id, mwVideoUrl: male, mwVideoUrlFemale: female });
  }

  console.log(`   اختصاصی‌دار (skip): ${skippedCustom} | بدون ویدیو: ${noVideo} | آپدیت: ${updates.length}${dry ? " (DRY)" : ""}`);

  if (!dry) {
    for (const u of updates) {
      await db.exerciseLibrary.update({
        where: { id: u.id },
        data: { mwVideoUrl: u.mwVideoUrl, mwVideoUrlFemale: u.mwVideoUrlFemale },
      });
      updated++;
      if (updated % 100 === 0) console.log(`   … ${updated}/${updates.length}`);
    }
    console.log(`✅ ${updated} حرکت بانک به‌روزرسانی شد.`);
  }

  // گزارش نهایی وضعیت بانک
  const total = await db.exerciseLibrary.count();
  const withMw = await db.exerciseLibrary.count({ where: { mwVideoUrl: { not: "" } } });
  const withCustom = await db.exerciseLibrary.count({ where: { videoUrl: { not: "" } } });
  const ytOnly = await db.exerciseLibrary.count({
    where: { videoUrl: "", mwVideoUrl: "", youtubeUrl: { not: "" } },
  });
  console.log(`\n📊 بانک: ${total} حرکت | Muscle Wiki: ${withMw} | اختصاصی: ${withCustom} | فقط یوتیوب (بدون جایگزین): ${ytOnly}`);
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
