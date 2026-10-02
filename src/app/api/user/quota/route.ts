import { requireAuth, apiError } from "@/lib/fitness/auth";
import { getUserQuotaSummary } from "@/lib/fitness/quota";

/**
 * GET /api/user/quota — خلاصهٔ سهمیه‌های رسانهٔ کاربر (Task 4-a)
 *
 * خروجی: { hasPlan, planName, planDays, workoutExerciseCount,
 *          chatPhoto: {used,total,baseTotal,bonus,dailyUsed,dailyTotal,remaining},
 *          mealPhoto: {...}, movementVideo: {...} }
 *
 * برای کاربر بدون پلن فعال، همهٔ سقف‌ها ۰ برمی‌گردد (UI چیپ‌ها را مخفی/قفل می‌کند).
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const summary = await getUserQuotaSummary(user.id);
    return Response.json(summary);
  } catch (e) {
    return apiError(e);
  }
}
