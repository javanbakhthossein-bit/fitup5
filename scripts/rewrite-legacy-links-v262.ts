/**
 * v262 — بازنویسی یک‌بارهٔ لینک‌های قدیمی SPA در محتوای مقالات دیتابیس سندباکس
 * (آینهٔ دقیق LEGACY_TARGET_REWRITES در /api/cron/db-selfheal — همان قواعد)
 *
 *  ?tool=tdee|exercises|foods|bmi|macro|1rm  → /tdee | /exercises | ...
 *  ?sport=<slug>  → /sport/<slug>  (فقط رشته‌های دارای لندینگ واقعی)
 *  ?screen=articles → /articles
 *
 * Idempotent: هر لینک قدیمی فقط یک‌بار بازنویسی می‌شود؛ اجرای مجدد = صفر تغییر.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// v262-اصلاح — هم‌منبع با disciplines-data (DISCIPLINE_PAGE_SLUGS) — نسخهٔ قدیمی
// این اسکریپت «boxing» داشت که صفحهٔ واقعی ندارد (۴۰۴ می‌ساخت) و MD_LINK آن
// هدف‌های فاصله‌دار را نمی‌گرفت — حالا عین LEGACY_TARGET_REWRITES در db-selfheal.
import { DISCIPLINE_PAGE_SLUGS } from "../src/lib/fitness/disciplines-data";

const REWRITES: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
  [/^\/?\?tool=tdee.*$/, () => "/tdee"],
  [/^\/?\?tool=exercises.*$/, () => "/exercises"],
  [/^\/?\?tool=foods.*$/, () => "/foods"],
  [/^\/?\?tool=bmi.*$/, () => "/bmi"],
  [/^\/?\?tool=macro.*$/, () => "/macro"],
  [/^\/?\?tool=1rm.*$/, () => "/1rm"],
  [/^\/?\?sport=([a-z0-9_-]+).*$/i, (m) => {
    const slug = m[1].toLowerCase();
    return (DISCIPLINE_PAGE_SLUGS as readonly string[]).includes(slug) ? `/sport/${slug}` : null;
  }],
  [/^\/?\?screen=articles.*$/, () => "/articles"],
];

const MD_LINK = /\[([^\]]*)\]\((\/(?:[^)\s])*)\)/g;

async function main() {
  const articles = await db.article.findMany({
    where: { status: "published" },
    select: { id: true, slug: true, content: true },
  });

  let articlesFixed = 0, linksRewritten = 0;
  const perSlugSample: string[] = [];

  for (const a of articles) {
    const content = a.content ?? "";
    if (!content) continue;

    const next = content.replace(MD_LINK, (full: string, text: string, rawTarget: string) => {
      let target = rawTarget;
      try { target = decodeURIComponent(rawTarget); } catch {}
      const hit = REWRITES.find(([re]) => re.test(target));
      if (!hit) return full;
      const to = hit[1](target.match(hit[0])!);
      if (!to || to === target) return full; // ناشناخته → دست نمی‌خوریم (هم‌منبع با route)
      linksRewritten++;
      return `[${text}](${to})`;
    });

    if (next !== content) {
      await db.article.update({ where: { id: a.id }, data: { content: next } });
      articlesFixed++;
      if (perSlugSample.length < 12) perSlugSample.push(a.slug);
    }
  }

  console.log(`✅ v262 DB rewrite — ${articlesFixed} مقاله اصلاح شد، ${linksRewritten} لینک بازنویسی شد`);
  console.log("نمونه:", perSlugSample.join(", "));

  // وریفای نهایی — صفر باقیماندهٔ legacy در published
  const check = await db.article.findMany({ where: { status: "published" }, select: { content: true } });
  const remain = check.reduce((acc, a) => {
    const c = a.content || "";
    return acc
      + (c.match(/\]\(\/?\?sport=/g) || []).length
      + (c.match(/\]\(\/?\?tool=/g) || []).length
      + (c.match(/\]\(\/?\?screen=articles/g) || []).length;
  }, 0);
  console.log(remain === 0 ? "✓ وریفای: صفر لینک legacy باقی مانده" : `❌ ${remain} لینک legacy باقی مانده!`);

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
