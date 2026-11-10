import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { fixPersianTypography } from "@/lib/fitness/persian-typography";
// Task 2-d — اپ بفهمد سرور FCM دارد یا نه (لاگ/رفتار graceful اپ اندروید)
import { isFcmConfigured } from "@/lib/fitness/fcm";

/**
 * GET /api/app/notifications/sync — همگام‌سازی اعلان‌ها برای اپ اندروید (v31)
 *
 * کاربرِ «همگام‌سازی پس‌زمینه» اپ‌های نیتیو: WorkManager اپ هر ۶ ساعت (و در هر
 * باز شدن اپ) با کوکی سشن کاربر این endpoint را صدا می‌زند و اعلان‌های جدیدِ
 * بعد از «since» را می‌گیرد تا حتی وقتی برنامه بسته است، به‌صورت نوتیف محلی
 * (WorkManager — کم‌مصرف و Doze-safe) نشان داده شوند. وب و PWA از VAPID
 * push استفاده می‌کنند و این مسیر برای آن‌ها لازم نیست.
 *
 * ورودی:  ?since=<ISO> (اختیاری — پیش‌فرض: ۲۴ ساعت اخیر)  &limit=1..30
 * خروجی:  { ok, serverTime, fcmConfigured, notifications: [{id,title,body,link,type,createdAt}] }
 *
 * نکته: اعلان‌های چت (type=coach) عمداً برنمی‌گردند — آن‌ها داخل اپ با پل
 * live (polling ۳۰ ثانیه‌ای main-app) و انیمیشن خود چت نشان داده می‌شوند.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);

    const sinceParam = searchParams.get("since");
    let since: Date;
    if (sinceParam) {
      const d = new Date(sinceParam);
      since = Number.isNaN(d.getTime()) ? new Date(Date.now() - 24 * 3600 * 1000) : d;
    } else {
      since = new Date(Date.now() - 24 * 3600 * 1000);
    }

    const limitRaw = Number(searchParams.get("limit") ?? "15");
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 15, 1), 30);

    const now = new Date();

    const notifications = await db.notification.findMany({
      where: {
        userId: user.id,
        createdAt: { gt: since, lte: now },
        type: { not: "coach" }, // چت فقط داخل اپ
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, title: true, body: true, link: true, type: true, createdAt: true },
    });

    return Response.json({
      ok: true,
      serverTime: now.toISOString(),
      // Task 2-d — اگر FCM تنظیم باشد اپ اندروید می‌داند push فعال است؛
      // نبودش هم graceful است (فال‌بک سینک WorkManager هر ۱۵ دقیقه)
      fcmConfigured: isFcmConfigured(),
      notifications: notifications.map((n) => ({
        id: n.id,
        // v57 — اصلاح تایپوگرافی در زمان خواندن (نوتیف‌های قدیمی هم درست)
        title: fixPersianTypography(n.title),
        body: fixPersianTypography(n.body),
        link: n.link ?? null,
        type: n.type,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
