import { NextRequest } from "next/server";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { analyzeBloodTest } from "@/lib/fitness/ai";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/fitness/types";

/**
 * POST /api/coach/analyze-blood
 *  - نیازمند پلن حرفه‌ای (Ultimate) — قابلیت bloodTestAnalysis (آلیاس bloodTest)
 *  - محدودیت پلن: bloodTestLimit (۱ بار در پلن Ultimate)
 *  - پس از تحلیل موفق، نتیجه در AnalysisResult ذخیره می‌شود و شمارنده bloodTestUsed افزایش می‌یابد.
 *
 * GET /api/coach/analyze-blood
 *  - آخرین نتیجه ذخیره‌شده کاربر را برمی‌گرداند (تا رفرش صفحه اطلاعات را از دست ندهد).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, planName } = await requirePlanCapability("bloodTestAnalysis");
    const { base64Image, mimeType } = await req.json();
    if (!base64Image) return Response.json({ error: "تصویر ارسال نشده." }, { status: 400 });

    // === اعمال محدودیت واقعی پلن ===
    const limit = getCapabilities(planName).bloodTestLimit;
    const user = await db.user.findUnique({ where: { id: userId }, select: { bloodTestUsed: true } });
    const used = user?.bloodTestUsed ?? 0;
    if (limit > 0 && used >= limit) {
      return Response.json(
        { error: "سقف استفاده از این قابلیت پر شده است.", code: "LIMIT_REACHED" },
        { status: 403 }
      );
    }

    const result = await analyzeBloodTest(base64Image, mimeType || "image/jpeg");

    // === ذخیره نتیجه در DB + افزایش شمارنده استفاده ===
    await db.$transaction([
      db.analysisResult.create({
        data: {
          userId,
          type: "blood_test",
          result: JSON.stringify(result),
          mediaUrl: null,
        },
      }),
      db.user.update({
        where: { id: userId },
        data: { bloodTestUsed: { increment: 1 } },
      }),
    ]);

    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}

export async function GET() {
  try {
    await requireAuth();
    const { userId } = await requirePlanCapability("bloodTestAnalysis");
    const latest = await db.analysisResult.findFirst({
      where: { userId, type: "blood_test" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      return Response.json({ result: null });
    }
    try {
      return Response.json({
        result: JSON.parse(latest.result),
        createdAt: latest.createdAt.toISOString(),
      });
    } catch {
      return Response.json({ result: null });
    }
  } catch (e) {
    return apiError(e);
  }
}
