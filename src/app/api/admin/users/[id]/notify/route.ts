import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { createNotification } from "@/lib/fitness/notifications";

/**
 * POST /api/admin/users/[id]/notify
 *
 * ارسال اعلان به یک کاربر خاص از طرف ادمین.
 *
 * Body:
 *   title  الزامی (حداکثر ۲۰۰ کاراکتر)
 *   body   الزامی (حداکثر ۲۰۰۰ کاراکتر)
 *   type   اختیاری — یکی از welcome | workout_reminder | water_reminder |
 *          subscription | achievement | system | upgrade | renewal |
 *          re_engagement | checkup | coach (پیش‌فرض: system)
 *   link   اختیاری — مسیر داخلی قابل کلیک (مثل "?tab=workouts")
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const title = (body?.title ?? "").toString().trim();
    const notifBody = (body?.body ?? "").toString().trim();
    const type = (body?.type ?? "system").toString().trim();
    const link = body?.link ? String(body.link).trim() : null;

    if (!title) {
      return Response.json(
        { error: "عنوان اعلان الزامی است." },
        { status: 400 }
      );
    }
    if (!notifBody) {
      return Response.json(
        { error: "متن اعلان الزامی است." },
        { status: 400 }
      );
    }

    const ALLOWED_TYPES = [
      "welcome",
      "workout_reminder",
      "water_reminder",
      "subscription",
      "achievement",
      "system",
      "upgrade",
      "renewal",
      "re_engagement",
      "checkup",
      "coach",
    ];
    const finalType = ALLOWED_TYPES.includes(type) ? type : "system";

    // بررسی وجود کاربر
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, mobile: true },
    });
    if (!user) {
      return Response.json(
        { error: "کاربر یافت نشد." },
        { status: 404 }
      );
    }

    const notif = await createNotification(
      user.id,
      finalType,
      title.slice(0, 200),
      notifBody.slice(0, 2000),
      link ? link.slice(0, 500) : undefined,
      { from: "admin" }
    );

    // v36 — رفع «Chrome detected spam from fittup.ir»:
    // قبلاً بعد از createNotification (که خودش push می‌فرستد) یک push دومِ
    // دستی با tag متفاوت هم ارسال می‌شد → هر اعلان ادمین دوبار به کاربر
    // می‌رسید (کلاسیک‌ترین الگوی اعلان اسپم برای گوگل). حالا فقط همان
    // push داخل createNotification کافی است.

    return Response.json({ ok: true, id: notif?.id ?? null });
  } catch (e) {
    return apiError(e);
  }
}
