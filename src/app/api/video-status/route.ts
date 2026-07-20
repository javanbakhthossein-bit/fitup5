import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";

/**
 * PATCH /api/video-status
 *
 * آپدیت وضعیت ویدیوی فرم حرکات کاربر (فقط برای پلن Ultimate).
 * body: { status: "skipped" | "uploaded" | null }
 *
 * - null: حالت اولیه (هنوز تصمیم نگرفته) — تولید برنامه متوقف می‌ماند
 * - "skipped": کاربر نمی‌خواهد ویدیو آپلود کند — برنامه بدون تحلیل ویدیو طراحی می‌شود
 * - "uploaded": کاربر ویدیو را آپلود کرده (به‌صورت خودکار از submit-body-analysis ست می‌شود)
 *
 * مهم: تا زمانی که status برابر null باشد، تولید برنامه برای پلن Ultimate متوقف می‌ماند
 * (کاربر باید حداقل یک تصمیم بگیرد: آپلود یا skip).
 *
 * M5: این endpoint اکنون requirePlanCapability("videoBodyAnalysis") را صدا می‌زند تا
 * کاربران basic/standard نتوانند این وضعیت را set کنند (این قابلیت فقط برای Ultimate است).
 */
export async function PATCH(req: NextRequest) {
  try {
    // M5: بررسی دسترسی پلن — فقط Ultimate می‌تواند videoStatus را set کند
    const { userId } = await requirePlanCapability("videoBodyAnalysis");
    const { status } = await req.json();

    if (
      status !== null &&
      status !== "skipped" &&
      status !== "uploaded"
    ) {
      return Response.json({ error: "وضعیت نامعتبر است." }, { status: 400 });
    }

    await db.user.update({
      where: { id: userId },
      data: { videoStatus: status },
    });

    // پیام مناسب بر اساس وضعیت انتخاب‌شده
    const message =
      status === "skipped"
        ? "باشه! برنامه شما بدون تحلیل ویدیو طراحی می‌شود."
        : status === "uploaded"
        ? "ویدیوی شما ثبت شد — برنامه با تحلیل ویدیو طراحی می‌شود."
        : "وضعیت ویدیو بازنشانی شد.";

    return Response.json({
      ok: true,
      status,
      message,
    });
  } catch (e) {
    return apiError(e);
  }
}
