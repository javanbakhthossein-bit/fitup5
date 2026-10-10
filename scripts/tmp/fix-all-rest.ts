import { PrismaClient } from "@prisma/client";
import { normalizeSupersetRestContract } from "../../src/lib/fitness/plan-superset-repair";

const db = new PrismaClient();
const USERS: Array<[string, string]> = [
  ["cmv1gv0t9001q2bhmlth3j8ij", "Hossein"],
  ["cmuyme6bi00ax2birlpojm5rl", "Yashar"],
  ["cmtv6c7yk01h82bx6cmzmkp85", "Nasser"],
  ["cmv15ey6l007a2bht8x87f5ng", "Tina"],
];

async function main() {
  for (const [uid, nm] of USERS) {
    const plan = await db.workoutPlan.findFirst({
      where: { userId: uid, active: true },
      orderBy: { version: "desc" },
    });
    if (!plan) { console.log(nm, ": no active plan"); continue; }
    const parsed = JSON.parse(plan.content);
    const fixed = normalizeSupersetRestContract(parsed);
    if (fixed === 0) { console.log(nm, `: v${plan.version} already clean`); continue; }
    await db.workoutPlan.update({ where: { id: plan.id }, data: { content: JSON.stringify(parsed) } });
    console.log(nm, `: v${plan.version} — ${fixed} rest cell(s) normalized`);
  }
}
main().finally(() => db.$disconnect());
