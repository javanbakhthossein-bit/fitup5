import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const wps = await db.workoutPlan.findMany({ where: { userId: (await db.user.findFirst({ where: { mobile: "09124347808" } }))!.id }, orderBy: { createdAt: "asc" }, select: { id: true, weekIndex: true, active: true, createdAt: true } });
  wps.forEach(w => console.log("WP", w.createdAt.toISOString(), "week:", w.weekIndex, "active:", w.active, w.id.slice(-6)));
  const mps = await db.mealPlan.findMany({ where: { userId: (await db.user.findFirst({ where: { mobile: "09124347808" } }))!.id }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, active: true } });
  mps.forEach(m => console.log("MP", m.createdAt.toISOString(), "active:", m.active, m.id.slice(-6)));
}
main().finally(() => db.$disconnect());
