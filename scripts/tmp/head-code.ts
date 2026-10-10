import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
(async () => {
  try {
    const rows = await (db as any).headCode.findMany({ take: 20 });
    for (const r of rows) console.log(`--- id=${r.id} name=${r.name} active=${r.active ?? r.isActive ?? "?"} ---\n${String(r.code ?? r.content ?? "").slice(0, 600)}\n`);
  } catch (e) { console.log("headCode model error:", String(e).slice(0, 200)); }
  await db.$disconnect();
})();
