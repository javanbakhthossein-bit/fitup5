import { PrismaClient } from "@prisma/client";
import { groupExercises, groupTypeLabel, groupRoundRestSec } from "../../src/lib/fitness/workout-groups";

const db = new PrismaClient();
async function main() {
  const plan = await db.workoutPlan.findFirst({
    where: { userId: "cmv1gv0t9001q2bhmlth3j8ij", active: true },
    orderBy: { version: "desc" },
  });
  if (!plan) throw new Error("no plan");
  const content = JSON.parse(plan.content);
  const day = content.days[0]; // شنبه — روز اول (تیکت مالک)
  const grouped = groupExercises(day.exercises as any);
  console.log("روز:", day.day, "—", day.title);
  for (const g of grouped) {
    if (g.type === "group") {
      console.log(`  🔗 گروه ${g.group} (${groupTypeLabel(g.groupType)}) — ${g.exercises.length} عضو:`);
      g.exercises.forEach((m, i) =>
        console.log(`      ${i + 1}. ${m.name} | استراحت پس از دور گروه: ${groupRoundRestSec(g as any, 1)}s`)
      );
    } else {
      console.log(`  • ${g.exercise.name}`);
    }
  }
  const grp = grouped.find((g): g is Extract<typeof g, { type: "group" }> => g.type === "group");
  const pass = !!grp && grp.exercises.length >= 2;
  console.log(pass ? "✅ PASS — سوپرست به‌صورت " + grp!.exercises.length + " حرکت جدا با برچسب گروه رندر می‌شود (همان تابع UI)" : "❌ FAIL");
  process.exit(pass ? 0 : 1);
}
main().finally(() => db.$disconnect());
