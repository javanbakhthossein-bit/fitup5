import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

/**
 * POST /api/push/subscribe
 * Register a push subscription for the current user.
 *
 * ═══ v63 — ضد نوتیف تکراری (گزارش مالک: «هر نوتیف یک‌بار») ═══
 * ریشهٔ نوتیف‌های ۲-۵ برابری: برای یک کاربر چند ردیف PushSubscription وجود
 * داشت (هر بار مرورگر/APK endpoint جدید FCM می‌سازد؛ ردیف‌های قبلی هرگز پاک
 * نمی‌شدند) و sendPushToUser به «همهٔ» ردیف‌ها push می‌فرستد.
 * این نسخه تضمین می‌کند:
 *   ۱) هر deviceId (پروفایل مرورگر/WebView) حداکثر یک ردیف دارد
 *      → ثبت endpoint جدید، endpointهای قبلیِ همان دستگاه را حذف می‌کند.
 *   ۲) previousEndpoint (از pushsubscriptionchange سرویس‌ورکر) حذف می‌شود.
 *   ۳) اپ‌های نیتیو (UA فیتاپ): ردیف‌های قدیمیِ هم-UA بدون deviceId پاک
 *      می‌شوند — UA اپ ثابت است و فقط یک نصب اپ آن را دارد (امن).
 *   ۴) سقف ۴ دستگاه برای هر کاربر (بیشترش = قدیمی‌ترین‌ها حذف).
 */
const MAX_SUBS_PER_USER = 4;

/** UA اپ‌های نیتیو — ثابت و یکتا برای هر نصب؛ پاک‌سازی هم-UA امن است */
function isNativeAppUa(ua: string | null | undefined): boolean {
  const s = (ua || "").toLowerCase();
  return s.includes("fitupapp/") || s.includes("fitupbazaar/");
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return Response.json({ error: "Invalid subscription" }, { status: 400 });
    }

    // v63 — deviceId پایدار کلاینت (localStorage)؛ فقط مقدار معتبر
    const deviceId =
      typeof body.deviceId === "string" && body.deviceId.length >= 8 && body.deviceId.length <= 64
        ? body.deviceId.trim()
        : null;
    const userAgent = req.headers.get("user-agent") || "";
    const endpoint = String(body.endpoint);

    await db.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.id,
        endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
        deviceId,
      },
      update: {
        userId: user.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        ...(deviceId ? { deviceId } : {}),
      },
    });

    // ─── ۱) endpoint قبلیِ همان دستگاه (pushsubscriptionchange) ───
    const previousEndpoint =
      typeof body.previousEndpoint === "string" && body.previousEndpoint.startsWith("https")
        ? body.previousEndpoint
        : null;
    if (previousEndpoint && previousEndpoint !== endpoint) {
      await db.pushSubscription
        .deleteMany({ where: { userId: user.id, endpoint: previousEndpoint } })
        .catch(() => {});
    }

    // ─── ۲) endpointهای دیگرِ همان deviceId (چرخش endpoint در همان پروفایل) ───
    if (deviceId) {
      await db.pushSubscription
        .deleteMany({
          where: { userId: user.id, deviceId, endpoint: { not: endpoint } },
        })
        .catch(() => {});
    }

    // ─── ۳) اپ نیتیو: ردیف‌های قدیمی هم-UA بدون deviceId (نصب‌های قبلی/APK
    //     قدیمی که deviceId نداشتند) — UA اپ ثابت است، پس این پاک‌سازی فقط
    //     endpointهای از-افتادهٔ خودِ همین اپ را حذف می‌کند ───
    if (isNativeAppUa(userAgent)) {
      await db.pushSubscription
        .deleteMany({
          where: {
            userId: user.id,
            userAgent,
            endpoint: { not: endpoint },
          },
        })
        .catch(() => {});
    }

    // ─── ۴) سقف ۴ دستگاه — قدیمی‌ترین‌ها حذف ───
    try {
      const all = await db.pushSubscription.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (all.length > MAX_SUBS_PER_USER) {
        const staleIds = all.slice(MAX_SUBS_PER_USER).map((r) => r.id);
        await db.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
      }
    } catch {
      // cap غیربحرانی است
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE /api/push/subscribe
 * Unsubscribe
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));

    if (body.endpoint) {
      await db.pushSubscription.deleteMany({
        where: { endpoint: body.endpoint, userId: user.id },
      });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * GET /api/push/subscribe
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const count = await db.pushSubscription.count({
      where: { userId: user.id },
    });
    return Response.json({ subscribed: count > 0, count });
  } catch (e) {
    return apiError(e);
  }
}
