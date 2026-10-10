import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const since = new Date(Date.now() - 36*3600*1000);
  const recent = await db.errorLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { message: true, url: true, userAgent: true, createdAt: true, stack: true },
  });
  console.log("=== ErrorLog last 36h:", recent.length, "entries ===");
  const seen = new Set<string>();
  for (const e of recent) {
    const key = `${e.message.slice(0,90)} | ${e.url?.slice(0,60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`[${e.createdAt.toISOString().slice(5,16)}] ${e.message.slice(0,110)}\n   url=${e.url?.slice(0,80)} ua=${(e.userAgent||"").slice(0,90)}`);
  }
  const regexErrs = await db.errorLog.count({ where: { message: { contains: "regular expression" } } });
  console.log("=== total 'regular expression' errors ALL TIME:", regexErrs, "===");
  const lastRegex = await db.errorLog.findMany({
    where: { message: { contains: "regular expression" } },
    orderBy: { createdAt: "desc" }, take: 8,
    select: { message: true, url: true, userAgent: true, createdAt: true },
  });
  for (const e of lastRegex) console.log(`REGEX [${e.createdAt.toISOString().slice(0,16)}] ${e.message.slice(0,120)} | url=${e.url?.slice(0,70)} | ua=${(e.userAgent||"").slice(0,110)}`);
  await db.$disconnect();
}
main();
