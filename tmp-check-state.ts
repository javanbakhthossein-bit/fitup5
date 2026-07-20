import { db } from "./src/lib/db";
async function main() {
  const arts = await db.article.findMany({
    where: { slug: { in: ["beginner-3day-program", "fat-loss-tips"] } },
    select: { slug: true, content: true, coverImage: true, readingMinutes: true, seoTitle: true, updatedAt: true },
  });
  for (const a of arts) {
    const wordCount = a.content.trim().split(/\s+/).length;
    console.log(`\n=== ${a.slug} ===`);
    console.log(`Words: ${wordCount}`);
    console.log(`Cover: ${a.coverImage}`);
    console.log(`Reading: ${a.readingMinutes} min`);
    console.log(`SEO title: ${a.seoTitle}`);
    console.log(`Updated: ${a.updatedAt}`);
  }
}
main().catch(console.error).finally(() => process.exit(0));
