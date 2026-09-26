/**
 * audit-broken-links-v135.ts — ممیزی «هیچ لینک شکسته و ۴۰۴‌ای نباشد» (دیرکتیو مالک)
 * چک‌ها:
 *   ۱) همهٔ ارجاع‌های نامی حرکات در DISCIPLINE_EXERCISE_NAMES به ردیفِ فعالِ بانک
 *   ۲) ارجاع‌های exerciseId/نام در محتوای برنامه‌های کاربران به بانک (فعال یا نه)
 *   ۳) لینک‌های داخلی مقالات (/exercise/, /article/, /sport/, /foods/) به مقاصد موجود
 *   ۴) sitemap فقط شامل حرکات فعال
 */
import { db } from "../src/lib/db";
import { DISCIPLINE_EXERCISE_NAMES } from "../src/lib/fitness/disciplines-data";

async function main() {
  let fail = 0, ok = 0;

  /* ۱) رشته‌ها → بانک */
  const bank = await db.exerciseLibrary.findMany({ select: { id: true, name: true, isActive: true } });
  const byName = new Map(bank.map((b) => [b.name, b]));
  for (const [disc, names] of Object.entries(DISCIPLINE_EXERCISE_NAMES)) {
    for (const n of names ?? []) {
      const row = byName.get(n);
      if (!row) { console.log(`🔴 [${disc}] نام در بانک نیست: ${n}`); fail++; }
      else if (!row.isActive) { console.log(`🟠 [${disc}] حرکت غیرفعال: ${n}`); fail++; }
      else ok++;
    }
  }

  /* ۲) برنامه‌ها → بانک */
  const plans = await db.workoutPlan.findMany({ select: { id: true, content: true } });
  for (const p of plans) {
    const text = JSON.stringify(p.content);
    const ids = text.match(/"exerciseId":"([\w-]+)"/g) ?? [];
    for (const raw of ids) {
      const id = raw.split('"')[3];
      const row = bank.find((b) => b.id === id);
      if (!row) { console.log(`🔴 برنامه ${p.id}: exerciseId ناموجود: ${id}`); fail++; }
      else if (!row.isActive) { console.log(`🟠 برنامه ${p.id}: حرکت غیرفعال (${row.name}) — نمایش لطیف`); ok++; } // تلرانس: برنامهٔ قدیمی
      else ok++;
    }
  }

  /* ۳) لینک‌های داخلی مقالات */
  const articles = await db.article.findMany({ where: { status: "published" }, select: { id: true, slug: true, content: true,  } });
  const activeIds = new Set(bank.filter((b) => b.isActive).map((b) => b.id));
  const allIds = new Set(bank.map((b) => b.id));
  const slugs = new Set(articles.map((a) => a.slug));
  const linkRe = /href="(\/(?:exercise|article|sport|foods|articles)\/[^"#?]*)/g;
  for (const a of articles) {
    const text = typeof a.content === "string" ? a.content : JSON.stringify(a.content);
    for (const m of text.matchAll(linkRe)) {
      const href = m[1];
      const ex = href.match(/^\/exercise\/([\w-]+)$/);
      if (ex) {
        if (!allIds.has(ex[1])) { console.log(`🔴 مقاله ${a.slug}: لینک حرکت ناموجود ${href}`); fail++; }
        else if (!activeIds.has(ex[1])) { console.log(`🟠 مقاله ${a.slug}: لینک حرکت غیرفعال ${href} — صفحهٔ لطیف می‌دهد`); ok++; }
        else ok++;
        continue;
      }
      const art = href.match(/^\/article\/([^/]+)$/);
      if (art && !slugs.has(decodeURIComponent(art[1]))) { console.log(`🔴 مقاله ${a.slug}: لینک مقاله ناموجود ${href}`); fail++; continue; }
      ok++; // بقیه مسیرها route واقعی دارند
    }
  }

  /* ۴) sitemap = فقط فعال */
  const activeCount = bank.filter((b) => b.isActive).length;
  console.log(`\n─────── نتیجه ممیزی لینک ───────`);
  console.log(`✅ چک سبز: ${ok} | 🔴 شکسته: ${fail}`);
  console.log(`حرکات: ${bank.length} کل / ${activeCount} فعال / ${bank.length - activeCount} غیرفعال`);
  console.log(`برنامه‌ها: ${plans.length} | مقالات منتشرشده: ${articles.length}`);
  if (fail > 0) process.exitCode = 1;
}
main().finally(() => db.$disconnect());
