import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
(async () => {
  const a = await (db as any).article.findFirst({ select: { slug: true } });
  const f = await (db as any).food?.findFirst?.({ select: { slug: true } }) ?? null;
  console.log("article=" + (a?.slug ?? "none") + " food=" + (f?.slug ?? "none/table"));
  await db.$disconnect();
})();
