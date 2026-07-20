/**
 * Fix broken internal links in published articles.
 * Patterns to fix:
 *   /article//?tool=tdee       → /?tool=tdee
 *   /article//?tool=foods      → /?tool=foods
 *   /article//?tool=exercises  → /?tool=exercises
 *   /article// (double slash)  → /
 *   /article/slug              → /?article=slug (markdown link)
 *   /blog                      → /?screen=articles
 *
 * Run: bun tmp-fix-article-links.ts
 */
import { db } from "./src/lib/db";

interface FixResult {
  slug: string;
  before: { doubleSlash: number; blog: number; wrongArticle: number };
  after: { doubleSlash: number; blog: number; wrongArticle: number };
  modified: boolean;
}

function fixContent(content: string): { fixed: string; counts: { doubleSlash: number; blog: number; wrongArticle: number } } {
  // Count before
  const beforeDoubleSlash = (content.match(/\/article\/\//g) || []).length;
  const beforeBlog = (content.match(/\(\/blog\)/g) || []).length;
  const beforeWrongArticle = (content.match(/\]\(\/article\/[^)]+\)/g) || []).length;

  let fixed = content;

  // 1) Fix double slash: /article//?tool=tdee → /?tool=tdee
  //    More generally: /article//anything → /anything
  //    i.e. remove the redundant "article/" segment when followed by another slash.
  fixed = fixed.replace(/\/article\/\//g, "/");

  // 2) Convert markdown links of form ](/article/slug) → ](/?article=slug)
  //    Handles slug with query string: /article/slug?param=val → /?article=slug&param=val
  fixed = fixed.replace(/\]\(\/article\/([^)]+)\)/g, (match, rest: string) => {
    // rest could be "slug" or "slug?param=val"
    if (rest.includes("?")) {
      const [slug, query] = rest.split("?");
      return `](/?article=${slug}&${query})`;
    }
    return `](/?article=${rest})`;
  });

  // 3) Convert ](/blog) → ](/?screen=articles)
  fixed = fixed.replace(/\]\(\/blog\)/g, "](/?screen=articles)");

  // 4) Catch any standalone /blog references (not in markdown links)
  fixed = fixed.replace(/(^|[\s(])\/blog(?=[\s)]|$)/g, "$1/?screen=articles");

  const afterDoubleSlash = (fixed.match(/\/article\/\//g) || []).length;
  const afterBlog = (fixed.match(/\(\/blog\)/g) || []).length;
  const afterWrongArticle = (fixed.match(/\]\(\/article\/[^)]+\)/g) || []).length;

  return {
    fixed,
    counts: {
      doubleSlash: beforeDoubleSlash - afterDoubleSlash,
      blog: beforeBlog - afterBlog,
      wrongArticle: beforeWrongArticle - afterWrongArticle,
    },
  };
}

async function main() {
  console.log("=== Fix broken article links ===\n");
  const articles = await db.article.findMany({
    where: { status: "published" },
    select: { id: true, slug: true, title: true, content: true },
  });

  const results: FixResult[] = [];
  let totalFixed = 0;

  for (const a of articles) {
    const before = {
      doubleSlash: (a.content.match(/\/article\/\//g) || []).length,
      blog: (a.content.match(/\(\/blog\)/g) || []).length,
      wrongArticle: (a.content.match(/\]\(\/article\/[^)]+\)/g) || []).length,
    };

    if (before.doubleSlash === 0 && before.blog === 0 && before.wrongArticle === 0) {
      // No fixes needed
      results.push({
        slug: a.slug,
        before,
        after: { doubleSlash: 0, blog: 0, wrongArticle: 0 },
        modified: false,
      });
      continue;
    }

    const { fixed, counts } = fixContent(a.content);
    const after = {
      doubleSlash: (fixed.match(/\/article\/\//g) || []).length,
      blog: (fixed.match(/\(\/blog\)/g) || []).length,
      wrongArticle: (fixed.match(/\]\(\/article\/[^)]+\)/g) || []).length,
    };

    if (fixed !== a.content) {
      await db.article.update({
        where: { id: a.id },
        data: { content: fixed },
      });
      totalFixed++;
      console.log(`✓ ${a.slug}: fixed ${counts.doubleSlash} doubleSlash, ${counts.blog} blog, ${counts.wrongArticle} wrongArticle`);
    }

    results.push({
      slug: a.slug,
      before,
      after,
      modified: fixed !== a.content,
    });
  }

  console.log(`\n=== Summary ===`);
  console.log(`Articles scanned: ${results.length}`);
  console.log(`Articles modified: ${totalFixed}`);
  console.log(`Total fixes applied: ${results.reduce((acc, r) => acc + r.before.doubleSlash + r.before.blog + r.before.wrongArticle, 0)}`);
  console.log(`Remaining issues: ${results.reduce((acc, r) => acc + r.after.doubleSlash + r.after.blog + r.after.wrongArticle, 0)}`);

  // Verify the specific broken link mentioned in task
  const checkArticle = await db.article.findFirst({
    where: { content: { contains: "[جدول کالری تعاملی فیتاپ]" } },
    select: { slug: true, content: true },
  });
  if (checkArticle) {
    const hasFixedLink = checkArticle.content.includes("[جدول کالری تعاملی فیتاپ](/?tool=foods)");
    const hasBrokenLink = checkArticle.content.includes("[جدول کالری تعاملی فیتاپ](/article//?tool=foods)");
    console.log(`\n=== Verification: "جدول کالری تعاملی فیتاپ" link ===`);
    console.log(`In article: ${checkArticle.slug}`);
    console.log(`Has fixed link /?tool=foods: ${hasFixedLink}`);
    console.log(`Still has broken /article//?tool=foods: ${hasBrokenLink}`);
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
