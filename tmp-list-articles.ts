import { db } from "./src/lib/db";

async function main() {
  const articles = await db.article.findMany({
    where: { status: "published" },
    select: { slug: true, title: true, category: true, tags: true, excerpt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Total: ${articles.length} articles\n`);
  for (const a of articles) {
    console.log(`- slug: ${a.slug}`);
    console.log(`  title: ${a.title}`);
    console.log(`  category: ${a.category}`);
    console.log(`  tags: ${a.tags}`);
    console.log(`  excerpt: ${a.excerpt}`);
    console.log();
  }
}
main().catch(console.error).finally(() => process.exit(0));
