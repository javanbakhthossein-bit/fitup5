import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
db.errorLog.count().then((c) => { console.log("ERRORLOG_TOTAL=" + c); return db.$disconnect(); });
