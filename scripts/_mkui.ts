import { PrismaClient } from "@prisma/client";
import { createSessionToken } from "@/lib/fitness/auth";
const db = new PrismaClient();
const MOBILE = "09120000077";
async function main() {
  await db.user.deleteMany({ where: { mobile: MOBILE } });
  const start = new Date(); const end = new Date(start.getTime() + 30 * 86400000);
  const u = await db.user.create({ data: { mobile: MOBILE, name: "تست UI نهایی", onboardingDone: true, planName: "ultimate", planStartedAt: start, planExpiresAt: end } });
  await db.subscription.create({ data: { userId: u.id, plan: "ultimate", status: "active", startDate: start, endDate: end, durationDays: 45, pricePaid: 1800000 } });
  await db.onboardingProfile.create({ data: { userId: u.id, gender: "male", age: 26, height: 182, weight: 84, targetWeight: 80, goal: "fitness", activityLevel: "moderate", workoutDays: 4, workoutDaysList: "[]", workoutPlace: "gym", equipment: "[]" } });
  await db.mealPlan.create({ data: { userId: u.id, content: JSON.stringify({ totalCalories: 2200, totalProtein: 140, totalCarbs: 200, totalFat: 70, notes: "نکتهٔ اول\nنکتهٔ دوم", meals: [{ name: "صبحانه", items: [{ name: "جو دوسر", servingSize: "۶۰ گرم", calories: 220 }], alternatives: [{ combination: "نان سنگک ۲ کف دست + پنیر ۳۰ گرم + چای", items: [{ name: "نان سنگک", servingSize: "۲ کف دست", calories: 160 }], totalCalories: 210 }] }] }), totalCal: 2200, active: true } });
  console.log("TOKEN=" + createSessionToken(u.id));
}
main().then(() => db.$disconnect());
