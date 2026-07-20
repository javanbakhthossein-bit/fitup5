import { db } from "./src/lib/db";

async function main() {
  const articles = await db.article.findMany({
    where: { status: "published" },
    select: { slug: true, title: true, excerpt: true, content: true, coverImage: true },
  });
  for (const a of articles) {
    const wordCount = a.content.trim().split(/\s+/).length;
    console.log(`\n=== ${a.slug} ===`);
    console.log(`Title: ${a.title}`);
    console.log(`Words: ${wordCount}`);
    console.log(`Cover: ${a.coverImage ? "✓" : "✗"}`);
    const brokenDoubleSlash = (a.content.match(/\/article\/\//g) || []).length;
    const brokenBlog = (a.content.match(/\(\/blog\)/g) || []).length;
    const wrongFormat = (a.content.match(/\/article\/[a-z]/g) || []).length;
    const correctFormat = (a.content.match(/\?article=/g) || []).length;
    console.log(`Broken /article//: ${brokenDoubleSlash}, /blog: ${brokenBlog}, /article/slug (wrong): ${wrongFormat}, ?article= (correct): ${correctFormat}`);
  }
}
main().catch(console.error).finally(() => process.exit(0));
