import { db } from "@/lib/db";
import { apiError, requireAdmin } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { isFcmConfigured, sendFcmToTokens } from "@/lib/fitness/fcm";

/**
 * POST /api/admin/push-test — تست واقعی اعلان پوش FCM (فقط ادمین) — v223
 *
 * «اعلان‌ها حتی وقتی اپ کلاً بسته است» (Firebase Cloud Messaging) حالا در هر
 * دو اپ اندروید فعال است؛ این مسیر به ادمین اجازه می‌دهد مثل «تست پیامک»،
 * پوش را هم یک‌جا راستی‌آزمایی کند:
 *   ۱) FCM تنظیم شده؟ (FCM_SERVICE_ACCOUNT_JSON / FCM_LEGACY_SERVER_KEY)
 *   ۲) آیا دستگاهی (APK نصب‌شده و لاگین‌شده با حساب ادمین) توکن ثبت کرده؟
 *   ۳) ارسال واقعی به همهٔ توکن‌های خود ادمین + نتیجهٔ شفاف
 *      (delivered = رسیده به گوگل → نوتیف باید همان لحظه روی گوشی بیفتد
 *       حتی با اپ کاملاً بسته؛ dead = توکن مرده و خودکار پاک می‌شود)
 *
 * GET — وضعیت: تنظیم بودن FCM + توکن‌های ثبت‌شدهٔ خود ادمین (ماسک‌شده).
 */

/** ماسک توکن برای نمایش امن در پنل */
function maskToken(t: string): string {
  if (t.length <= 16) return t.slice(0, 4) + "…";
  return `${t.slice(0, 8)}…${t.slice(-8)}`;
}

/**
 * 🎯 v227 — ترجمهٔ خطای خام گوگل/زنجیره به توضیح فارسی قابل‌فهم برای ادمین.
 * مالک گزارش داده بود «۲۰۰ می‌دهد ولی نوتیف نمی‌رسد» — شایع‌ترین ریشه‌ها
 * (به‌ترتیب احتمال) این‌ها هستند:
 *  ۱) مجوز POST_NOTIFICATIONS در اندروید ۱۳+ داده نشده → گوگل تحویل می‌دهد
 *     (سمت ما delivered=1 و ۲۰۰) ولی اندروید بی‌صدا نوتیف را دور می‌ریزد.
 *  ۲) توکن برای حساب دیگری ثبت شده (اپ با حساب دیگر لاگین است).
 *  ۳) توکن مرده (اپ حذف/آپدیت نشده).
 */
function explainFcmError(err: string | undefined): string {
  const e = (err || "").toUpperCase();
  if (!err) return "تحویل به گوگل موفق بود — پیام روی دستگاه باید بیفتد";
  if (e.includes("UNREGISTERED") || e.includes("NOT_FOUND") || e.includes("INVALID_REGISTRATION"))
    return "توکن منقضی/مرده است (اپ حذف یا خیلی قدیمی شده) — اپ را باز کن تا توکن نو ثبت شود";
  if (e.includes("SENDER_ID_MISMATCH"))
    return "توکن با پروژهٔ فایربیس سرور نمی‌خواند (اپ بازار/اختصاصی با کلید دیگری ساخته شده)";
  if (e.includes("QUOTA")) return "سهمیهٔ ارسال فایربیس پر شده";
  if (e.includes("OAUTH_FAILED")) return "کلید سرویس‌اکانت روی سرور معتبر نیست — بلاک .env را دوباره چک کن";
  if (e.includes("FCM_NOT_CONFIGURED")) return "کلید FCM روی سرور تنظیم نشده";
  if (e.includes("NETWORK")) return "خطای شبکهٔ سرور به گوگل — دوباره تلاش کن";
  return `خطای گوگل: ${err.slice(0, 120)}`;
}

export async function GET() {
  try {
    const admin = await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const configured = isFcmConfigured();
    const tokens = await db.deviceToken.findMany({
      where: { userId: admin.id },
      select: { token: true, platform: true, lastSeenAt: true, userAgent: true },
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    });
    return Response.json({
      ok: true,
      configured,
      count: tokens.length,
      tokens: tokens.map((t) => ({
        masked: maskToken(t.token),
        platform: t.platform,
        lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
        userAgent: t.userAgent?.slice(0, 120) ?? null,
      })),
      hint: configured
        ? tokens.length === 0
          ? "FCM سرور آماده است ولی هنوز هیچ دستگاهی توکن ثبت نکرده — اپ را نصب/باز کن و با همین حساب وارد شو (حدود ۱۰ ثانیه بعد از باز شدن ثبت می‌شود)."
          : "همه‌چیز آماده است — دکمهٔ «ارسال پوش تست» را بزن و به گوشی نگاه کن."
        : "FCM روی سرور تنظیم نشده — طبق راهنمای v223 کلید FCM_SERVICE_ACCOUNT_JSON را در .env بگذار و pm2 restart کن.",
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST() {
  try {
    const admin = await requireAdmin();
    await requireAdminPerm("canManageUsers");
    if (!isFcmConfigured()) {
      return Response.json(
        {
          ok: false,
          error:
            "FCM روی سرور تنظیم نشده است — کلید FCM_SERVICE_ACCOUNT_JSON را طبق راهنمای v223 در .env بگذار و pm2 restart کن.",
        },
        { status: 400 }
      );
    }
    const rows = await db.deviceToken.findMany({
      where: { userId: admin.id },
      select: { token: true },
    });
    if (rows.length === 0) {
      return Response.json(
        {
          ok: false,
          error:
            "هیچ دستگاهی توکن پوش ثبت نکرده — اپ اندروید را نصب و باز کن، با همین حساب ادمین وارد شو و ۱۰ ثانیه صبر کن؛ بعد دوباره تست کن.",
        },
        { status: 400 }
      );
    }
    const tokens = rows.map((r) => r.token);
    const result = await sendFcmToTokens(tokens, {
      title: "فیتاپ 🔔 پوش تست",
      body: "این یک اعلان تست است — اگر این را می‌بینی، اعلان‌ها حتی با اپ کاملاً بسته هم می‌رسند!",
      link: "?tab=dashboard",
      type: "push_test",
    });
    // نگهداری DB مثل جریان واقعی: توکن‌های مرده پاک، توکن‌های سالم تازه
    if (result.dead.length > 0) {
      await db.deviceToken
        .deleteMany({ where: { token: { in: result.dead } } })
        .catch(() => {});
    }
    if (result.delivered.length > 0) {
      await db.deviceToken
        .updateMany({
          where: { token: { in: result.delivered } },
          data: { lastSeenAt: new Date() },
        })
        .catch(() => {});
    }
    // 🎯 v227 — گزارش ریز هر توکن + ترجمهٔ فارسی خطا (تشخیص چرا نوتیف نمی‌رسد)
    const details = (result.details ?? []).map((d) => ({
      masked: maskToken(d.token),
      ok: d.ok,
      error: d.error ?? null,
      reason: explainFcmError(d.error),
    }));
    const deliveredCount = result.delivered.length;
    return Response.json({
      ok: deliveredCount > 0,
      attempted: result.attempted,
      delivered: deliveredCount,
      dead: result.dead.length,
      failed: result.failed.length,
      details,
      hint:
        deliveredCount > 0
          ? "ارسال به گوگل موفق بود — نوتیف باید همین لحظه روی گوشی بیفتد (حتی با اپِ کاملاً بسته). اگر نوتیف نیفتاد، تقریباً همیشه یعنی مجوز اعلان (POST_NOTIFICATIONS) در خود گوشی داده نشده — بنر قرمز بالای همین کارت را ببین."
          : result.dead.length > 0
          ? "توکن‌ها منقضی شده بودند و پاک شدند — اپ را یک‌بار باز کن (توکن نو ثبت می‌شود) و دوباره تست کن."
          : "ارسال موقتاً ناموفق بود — جزئیات خطای هر توکن در لیست پایین آمده.",
    });
  } catch (e) {
    return apiError(e);
  }
}
