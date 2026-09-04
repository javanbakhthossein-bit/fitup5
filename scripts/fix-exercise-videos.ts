/**
 * fix-exercise-videos.ts — جایگزینی یک‌بارهٔ ویدیوهای خراب/نامرتبط بانک حرکات
 *
 * زمینه (v28 — درخواست مالک): ۲۱۲ حرکت از ۲۶۰ حرکت، ویدیوی یوتیوبِ خراب
 * (ID ساختگی ۴۰۴) یا ویدیوی عمومی نامرتبط داشتند → مشتریان «ویدیو ندارد»
 * می‌دیدند. مپینگِ جایگزین (scripts/exercise-video-fixes.json) با جستجوی
 * یوتیوب + صحت‌سنجی oEmbed (HTTP 200 = ویدیو واقعاً موجود و embed-پذیر)
 * ساخته و بازبینی شده است — ۲۳۳ حرکت، ۲۰۶ ویدیوی یکتا، صفر خراب.
 *
 * اجرا (روی سرور یا سندباکس):
 *   bun run scripts/fix-exercise-videos.ts            # گزارش (DRY-RUN)
 *   bun run scripts/fix-exercise-videos.ts --apply    # اعمال واقعی
 *
 * - آفلاین است (بدون نیاز به اینترنت — IDها از قبل صحت‌سنجی شده‌اند)
 * - Idempotent: اجرای مکرر چیزی را عوض نمی‌کند
 * - فقط youtubeUrl را می‌نویسد؛ هیچ فیلد دیگری دست نمی‌خورد
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import path from "path";

const db = new PrismaClient({
  datasources: {
    // اجازهٔ هدف‌قرار دادن فایل DB دیگر (مثلاً کپی آپلودی مالک) — پیش‌فرض .env
    db: { url: process.env.MAP_DB_URL || process.env.DATABASE_URL },
  },
});
const APPLY = process.argv.includes("--apply");

const VALID_ID = /^[\w-]{11}$/;

function embedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}
function idOf(url: string | null | undefined): string | null {
  const m = /embed\/([\w-]+)/.exec(url || "");
  return m ? m[1] : null;
}

async function main() {
  const mapPath = path.join(process.cwd(), "scripts", "exercise-video-fixes.json");
  if (!existsSync(mapPath)) {
    console.error("MAP_NOT_FOUND — scripts/exercise-video-fixes.json نیست");
    process.exit(1);
  }
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as Record<
    string,
    { videoId: string; title: string; channel: string }
  >;

  const exercises = await db.exerciseLibrary.findMany({
    select: { id: true, name: true, youtubeUrl: true },
  });
  // حرکات هم‌نام (مثلاً دو ردیف «اسکوات گابلت») — همه باید فیکس شوند
  const nameCounts = new Map<string, number>();
  for (const e of exercises) nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);

  let fixed = 0, alreadyOk = 0, notFound = 0, invalidEntries = 0;
  const report: string[] = [];

  for (const [name, fix] of Object.entries(map)) {
    // اعتبار ورودی مپینگ — هرگز ID ساختگی ننویس
    if (!VALID_ID.test(fix.videoId)) {
      invalidEntries++;
      report.push(`⚠ مپینگ نامعتبر برای «${name}» — رد شد (${fix.videoId})`);
      continue;
    }
    const count = nameCounts.get(name);
    if (!count) { notFound++; report.push(`؟ حرکت «${name}» در DB نیست — رد شد`); continue; }

    const rows = exercises.filter((e) => e.name === name);
    const needsFix = rows.filter((e) => idOf(e.youtubeUrl) !== fix.videoId);
    if (needsFix.length === 0) { alreadyOk += count; continue; }

    if (APPLY) {
      await db.exerciseLibrary.updateMany({
        where: { name },
        data: { youtubeUrl: embedUrl(fix.videoId) },
      });
    }
    fixed += needsFix.length;
    report.push(
      `${APPLY ? "✔" : "◦"} ${name}${count > 1 ? ` (${count} ردیف هم‌نام)` : ""}: ${idOf(needsFix[0].youtubeUrl) ?? "—"} → ${fix.videoId} [${fix.channel}]`
    );
  }

  console.log(`\n📋 گزارش فیکس ویدیوها (${APPLY ? "اعمال شد" : "DRY-RUN — با --apply اعمال کن"}):`);
  console.log(`   کل مپینگ: ${Object.keys(map).length}`);
  console.log(`   ${APPLY ? "جایگزین شده" : "نیازمند جایگزینی"}: ${fixed}`);
  console.log(`   از قبل درست: ${alreadyOk}`);
  console.log(`   حرکت غایب در DB: ${notFound} | مپینگ نامعتبر: ${invalidEntries}`);
  console.log("");
  for (const line of report.slice(0, 40)) console.log("  " + line);
  if (report.length > 40) console.log(`  … و ${report.length - 40} مورد دیگر`);

  // گارد نهایی — بعد از اعمال، هیچ حرکتی نباید ویدیوی نامعتبر ساختاری داشته باشد
  const all = await db.exerciseLibrary.findMany({ select: { name: true, youtubeUrl: true } });
  const bad = all.filter((e) => {
    const id = idOf(e.youtubeUrl);
    return !e.youtubeUrl || !id || !VALID_ID.test(id);
  });
  console.log(`\n🔍 ساختار همهٔ ${all.length} ویدیو: ${bad.length === 0 ? "سالم ✓" : `${bad.length} مشکل‌دار!`}`);
  for (const b of bad) console.log("  ✗", b.name, "->", b.youtubeUrl);

  if (!APPLY) console.log("\n💡 این گزارش DRY-RUN بود — برای اعمال: bun run scripts/fix-exercise-videos.ts --apply");
  await db.$disconnect();
  process.exit(APPLY && bad.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
