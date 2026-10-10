import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { isFcmConfigured } from "@/lib/fitness/fcm";

/**
 * POST /api/app/device-token — ثبت/به‌روزرسانی توکن FCM اپ اندروید (Task 2-d)
 *
 * اپ اندروید (ir.fittup.panel) بعد از راه‌اندازی Firebase دستی، توکن FCM خودش
 * را اینجا با «همان کوکی سشن» ثبت می‌کند (FcmService.onNewToken / پل
 * syncDeviceToken). سرور بعداً در createNotification با sendFcmToUser پیام‌ها
 * را به این توکن می‌فرستد تا «اعلان‌ها حتی وقتی اپ کلاً بسته است» برسد.
 *
 * ورودی:  { token: string, platform?: "android" | "ios" | "web" }
 * خروجی:  { ok: true }
 * احراز:  سشن کوکی (requireAuth — همان /api/app/notifications/sync)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    // توکن FCM واقعی ~۱۵۰ کاراکتر است؛ بازهٔ سخاوتمندانه برای سازگاری
    if (token.length < 10 || token.length > 4096) {
      return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400 });
    }
    const platform =
      typeof body?.platform === "string" && body.platform.trim()
        ? body.platform.trim().slice(0, 20)
        : "android";
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

    await db.deviceToken.upsert({
      where: { token },
      create: { token, userId: user.id, platform, userAgent, lastSeenAt: new Date() },
      update: { userId: user.id, platform, lastSeenAt: new Date() },
    });

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/app/device-token — حذف توکن (خروج کاربر / چرخش توکن).
 * فقط توکن‌های خودِ کاربر حذف می‌شوند (scope userId).
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return Response.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400 });
    }
    const res = await db.deviceToken.deleteMany({ where: { token, userId: user.id } });
    return Response.json({ ok: true, removed: res.count });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * GET /api/app/device-token — وضعیت توکن کاربر فعلی (عیب‌یابی/تشخیصی).
 * fcmConfigured هم برمی‌گردد تا اپ بداند سرور اصلاً FCM دارد یا نه.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const count = await db.deviceToken.count({ where: { userId: user.id } });
    return Response.json({
      ok: true,
      fcmConfigured: isFcmConfigured(),
      hasToken: count > 0,
      count,
    });
  } catch (e) {
    return apiError(e);
  }
}
