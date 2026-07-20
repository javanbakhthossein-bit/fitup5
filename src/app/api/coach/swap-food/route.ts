import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { swapFood } from "@/lib/fitness/ai";
import type { OnboardingData } from "@/lib/fitness/types";

export async function POST(req: NextRequest) {
  try {
    // گیت پلن: دستیار تغذیه فقط برای پلن پیشرفته و حرفه‌ای
    await requirePlanCapability("nutritionCompanion");
    const user = await requireAuth();
    const { foodName, calories } = await req.json();
    if (!foodName || !calories) {
      return Response.json({ error: "اطلاعات غذا ناقص است." }, { status: 400 });
    }

    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
    });
    const dietType = profile?.dietType || "standard";
    const allergies = profile?.allergies || "";

    const result = await swapFood(String(foodName), Number(calories), dietType, allergies);
    return Response.json({ food: result });
  } catch (e) {
    return apiError(e);
  }
}
