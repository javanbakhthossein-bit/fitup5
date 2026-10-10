import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
db.errorLog.deleteMany({ where: { OR: [{ message: { contains: "fitup-e2e" } }, { message: { contains: "fitup-final" } }] } }).then((r) => {
  console.log("deleted:", r.count);
  return db.errorLog.count();
}).then((c) => { console.log("remaining:", c); return db.$disconnect(); });
