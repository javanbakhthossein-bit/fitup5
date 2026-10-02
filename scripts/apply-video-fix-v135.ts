/** v135 — اعمال ویدیوهای یکتای بچ‌های video-fix (۱۶۲ حرکت) — idempotent */
import { db } from "../src/lib/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const dir = join(__dirname, "exercise-research", "video-fix-pass");
  const fixes = [
    ...JSON.parse(readFileSync(join(dir, "batch1.json"), "utf8")),
    ...JSON.parse(readFileSync(join(dir, "batch2.json"), "utf8")),
  ] as { name: string; videoId?: string; unresolved?: boolean; reason?: string }[];

  let applied = 0, skipped = 0;
  for (const f of fixes) {
    if (f.unresolved || !f.videoId) { skipped++; console.log(`⏭ unresolved: ${f.name} (${f.reason ?? ""})`); continue; }
    const ex = await db.exerciseLibrary.findFirst({ where: { name: f.name } });
    if (!ex) { skipped++; console.log(`⚠ not found: ${f.name}`); continue; }
    const url = `https://www.youtube.com/embed/${f.videoId}`;
    if (ex.youtubeUrl !== url) {
      await db.exerciseLibrary.update({ where: { id: ex.id }, data: { youtubeUrl: url } });
      applied++;
    }
  }
  console.log(`\n✅ applied: ${applied} | skipped: ${skipped}`);
}
main().finally(() => db.$disconnect());
