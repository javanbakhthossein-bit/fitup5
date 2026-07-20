import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";

/**
 * PATCH /api/blood-test-status
 *
 * آپدیت وضعیت آزمایش خون کاربر.
 * body: { status: "pending_blood_test" | "waiting" | "declined" | null }
 *
 * - null: حالت اولیه (هنوز تصمیم نگرفته)
 * - "pending_blood_test" یا "waiting": کاربر آزمایش داده ولی منتظر نتایج است.
 *   تولید برنامه تا زمان آپلود نتایج متوقف می‌ماند.
 * - "declined": کاربر نمی‌خواهد آزمایش خون آپلود کند — برنامه بدون آزمایش خون طراحی می‌شود.
 *
 * این وضعیت در system prompt فیتاپ هوشمند استفاده می‌شود تا AI بداند
 * آیا باید منتظر نتایج آزمایش بماند یا بدون آن برنامه را طراحی کند.
 *
 * M5: این endpoint اکنون requirePlanCapability("bloodTestAnalysis") را صدا می‌زند تا
 * کاربران basic/standard/advanced نتوانند این وضعیت را set کنند (این قابلیت فقط برای Ultimate است).
 */
export async function PATCH(req: NextRequest) {
  try {
    // M5: بررسی دسترسی پلن — فقط Ultimate می‌تواند bloodTestStatus را set کند
    const { userId } = await requirePlanCapability("bloodTestAnalysis");
    const { status } = await req.json();

    if (
      status !== null &&
      status !== "waiting" &&
      status !== "pending_blood_test" &&
      status !== "declined"
    ) {
      return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });
    }

    await db.user.update({
      where: { id: userId },
      data: { bloodTestStatus: status },
    });

    // پیام مناسب بر اساس وضعیت انتخاب‌شده
    const message =
      status === "pending_blood_test" || status === "waiting"
        ? "باشه! تا زمان آپلود نتایج، تولید برنامه متوقف می‌ماند. وقتی جواب آزمایش آماده شد، اینجا آپلود کنید."
        : status === "declined"
        ? "باشه! برنامه شما بدون آزمایش خون طراحی می‌شود."
        : "وضعیت آزمایش خون بازنشانی شد.";

    return Response.json({
      ok: true,
      status,
      message,
    });
  } catch (e) {
    return apiError(e);
  }
}
