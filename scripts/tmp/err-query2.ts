import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
db.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { message: true, url: true, source: true, createdAt: true } }).then((rows) => {
  console.log("TOTAL_RECENT=" + rows.length);
  for (const r of rows) console.log(`[${r.createdAt.toISOString().slice(11,19)}] src=${r.source} | ${r.message.slice(0,100)} | url=${(r.url||"").slice(0,60)}`);
  return db.$disconnect();
});
