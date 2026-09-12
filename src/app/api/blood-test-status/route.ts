import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePlanCapability, apiError } from "@/lib/fitness/auth";
import {
  startProgramGenerationInBackground,
  PROGRAM_PREPARING_MESSAGE,
} from "@/lib/fitness/program-generation";

/**
 * PATCH /api/blood-test-status
 *
 * آپدیت وضعیت آزمایش خون کاربر.
 * body: { status: "pending_blood_test" | "waiting" | "declined" | null }
 *
 * - null: حالت اولیه (هنوز تصمیم نگرفته)
 * - "pending_blood_test" یا "waiting": کاربر آزمایش داده ولی منتظر نتایج است.
 *   (تعیین تکلیف حساب می‌شود — پیش‌نیاز تیک می‌خورد؛ نتایج بعداً آپلود می‌شود)
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

    // اگر این تعیین تکلیف (هر تصمیمی: رد/منتظر) آخرین پیش‌نیاز بود → تولید برنامه
    // در پس‌زمینه — طبق طراحی جدید، «آزمایش دادم و منتظر جوابم» هم یک تعیین تکلیف
    // است و پیش‌نیاز را تیک می‌زند؛ برنامه بدون نتایج ساخته می‌شود و کاربر بعداً
    // می‌تواند نتایج را آپلود کند (برای تحلیل و اصلاح‌های بعدی).
    let programStarted = false;
    let message =
      status === "pending_blood_test" || status === "waiting"
        ? "باشه! جواب آزمایش هر وقت آماده شد از همین بخش آپلودش کن."
        : status === "declined"
        ? "باشه! برنامه شما بدون آزمایش خون طراحی می‌شود."
        : "وضعیت آزمایش خون بازنشانی شد.";

    if (status !== null) {
      const genResult = await startProgramGenerationInBackground(userId);
      if (genResult.started || genResult.reason === "already_generating") {
        programStarted = true;
        message = PROGRAM_PREPARING_MESSAGE;
      }
    }

    return Response.json({
      ok: true,
      status,
      programStarted,
      message,
    });
  } catch (e) {
    return apiError(e);
  }
}
