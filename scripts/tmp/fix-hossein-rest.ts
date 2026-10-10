import { PrismaClient } from "@prisma/client";
import { normalizeSupersetRestContract } from "../../src/lib/fitness/plan-superset-repair";

const db = new PrismaClient();
const planId = "cmv1ih2mh00bf62bhmrq0yqenxy".slice(0, 0) || process.argv[2];

async function main() {
  // فعال‌ترین برنامهٔ حسین جوان
  const plan = await db.workoutPlan.findFirst({
    where: { userId: "cmv1gv0t9001q2bhmlth3j8ij", active: true },
    orderBy: { version: "desc" },
  });
  if (!plan) { console.error("no active plan"); process.exit(1); }
  const parsed = JSON.parse(plan.content);
  const before = JSON.stringify(parsed);
  const fixed = normalizeSupersetRestContract(parsed);
  if (fixed === 0) { console.log("already clean — 0 cells"); return; }
  const after = JSON.stringify(parsed);
  await db.workoutPlan.update({ where: { id: plan.id }, data: { content: after } });
  console.log(`plan ${plan.id} v${plan.version}: ${fixed} rest cell(s) normalized, ${before.length} → ${after.length} chars`);
}
main().finally(() => db.$disconnect());
