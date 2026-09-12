import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const users = await db.user.findMany({ select: { id: true, mobile: true } });
  for (const u of users) {
    const wps = await db.workoutPlan.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } });
    const subs = await db.subscription.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { id: true, plan: true, status: true, startDate: true, createdAt: true } });
    if (wps.length === 0 && subs.length === 0) continue;
    console.log("USER", u.mobile, "wps:", wps.length, "subs:", subs.length);
    wps.forEach((w, i) => console.log("  WP[" + i + "]", w.createdAt.toISOString(), w.id.slice(-6)));
    subs.forEach((s, i) => console.log("  SUB[" + i + "]", s.plan, s.status, "start:", s.startDate?.toISOString() ?? "null", "created:", s.createdAt.toISOString(), s.id.slice(-6)));
  }
}
main().finally(() => db.$disconnect());
