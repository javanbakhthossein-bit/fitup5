import { randomBytes } from "crypto";
import { db } from "@/lib/db";
// v56: اصلاح تایپوگرافی فارسی در منبع واحد — همهٔ نوتیفیکیشن‌ها (DB + push)
// از این تابع عبور می‌کنند؛ نیم‌فاصله‌های چسبیده («برنامهات»→«برنامه‌ات»)
// اینجا به‌صورت سراسری اصلاح می‌شوند (درخواست مالک).
import { fixPersianTypography } from "@/lib/fitness/persian-typography";
// Task 2-d — FCM برای اپ اندروید: «اعلان‌ها حتی وقتی اپ کلاً بسته است»
import { sendFcmToUser } from "@/lib/fitness/fcm";

/**
 * Create a notification for a user.
 *
 * علاوه بر ذخیره در DB، یک push notification هم (best-effort) به تمام
 * دستگاه‌های کاربر ارسال می‌کند تا در PWA حتی وقتی اپ بسته است هم نمایش
 * داده شود. اگر VAPID keys تنظیم نشده باشند یا push ارسال ناموفق باشد،
 * فقط رکورد DB ایجاد می‌شود (failures به‌صورت silent نادیده گرفته می‌شوند
 * تا جریان اصلی شکسته نشود).
 *
 * ═══ v63 — تضمین «هر نوتیف دقیقاً یک‌بار» (گزارش مالک) ═══
 * گزارش مالک: نوتیف «برنامه آماده شد» ۵ بار و «پلن اقتصادی با موفقیت خریداری
 * شد» ۲ بار ارسال شده. مسیرهای مختلف (پرداخت/سوئیپ/watchdog/ادمین/ریتری) هر
 * کدام مستقیم createNotification صدا می‌زنند و اگر دو مسیر هم‌زمان یا با فاصله
 * کم فعال شوند، نوتیف تکراری ساخته می‌شود. حالا پیش‌فرضِ این تابع: اگر نوتیفِ
 * «دقیقاً یکسان» (همان کاربر + نوع + عنوان + متن) در ۶۰ دقیقهٔ اخیر ساخته شده،
 * دوباره ساخته/ارسال نمی‌شود و همان رکورد قبلی برگردانده می‌شود.
 * پنجرهٔ ۶۰ دقیقه‌ای حتی تکرارهای ۳۰ دقیقه‌ایِ کرون را هم می‌بندد؛ نوتیف‌های
 * مشروع با متن متفاوت (مثل خرید اقتصادی→حرفه‌ای پشت‌سرهم) دست‌نخورده می‌مانند.
 *
 * @param userId  Target user id
 * @param type    Notification type (welcome | workout_reminder | water_reminder |
 *                subscription | achievement | system | upgrade | renewal |
 *                re_engagement | checkup | coach)
 * @param title   Persian title
 * @param body    Persian body
 * @param link    Optional internal app path for clickable notifications
 *                 (e.g. "?tab=plans", "?tab=progress")
 * @param meta    Optional extra data — will be JSON-stringified
 * @param opts    Optional — { skipDedupe?: boolean } برای مسیرهایی که عمداً
 *                تکرار مجاز است (پیش‌فرض: dedupe فعال)
 */
// پنجرهٔ dedupe — ۶۰ دقیقه. حتی تکرار هر-۳۰-دقیقهٔ سوئیپ‌ها را هم می‌بندد.
const NOTIF_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  link?: string,
  meta?: any,
  opts?: { skipDedupe?: boolean }
) {
  try {
    // v56: پاس تایپوگرافی فارسی — کلمات چسبیده (بدون نیم‌فاصله) قبل از ذخیره/ارسال اصلاح می‌شوند
    const faTitle = fixPersianTypography(title);
    const faBody = fixPersianTypography(body);

    // v63 — گارد تکرار: نوتیف یکسان در پنجرهٔ ۶۰ دقیقه = skip (هرگز push/row دوم)
    if (!opts?.skipDedupe) {
      try {
        const duplicate = await db.notification.findFirst({
          where: {
            userId,
            type,
            title: faTitle,
            body: faBody,
            createdAt: { gte: new Date(Date.now() - NOTIF_DEDUPE_WINDOW_MS) },
          },
          select: { id: true },
        });
        if (duplicate) {
          console.log(
            `[createNotification] duplicate suppressed (60min window) user=${userId} title="${faTitle.slice(0, 40)}"`
          );
          // رکورد موجود برمی‌گردد تا کالرها با null (خطا) اشتباه نگیرند
          return duplicate as any;
        }
      } catch {
        // خطای dedupe هرگز نباید ساخت نوتیف را ببندد
      }
    }

    const notif = await db.notification.create({
      data: {
        userId,
        type,
        title: faTitle,
        body: faBody,
        link: link ?? null,
        meta: meta ? JSON.stringify(meta) : null,
        read: false,
      },
    });

    // ارسال push به هر دو کانال (best-effort، non-blocking — Task 2-d):
    //  ۱) web-push (VAPID) → PWA/مرورگر
    //  ۲) FCM → اپ اندروید حتی وقتی کلاً بسته است (درخواست مکرر مالک)
    // فقط وقتی «رکورد جدید» ساخته شد اجرا می‌شود (مسیر dedupe بالا return کرده)
    // و هر دو کانال از یک سقف روزانهٔ مشترک (PUSH_DAILY_CAP) عبور می‌کنند.
    void deliverPushes(userId, faTitle, faBody, link, notif.id, type, meta);

    return notif;
  } catch (err) {
    console.error("[createNotification] failed:", err);
    return null;
  }
}

/**
 * Task 2-d — ارسال موازی push به هر دو کانال (web-push + FCM) با سقف روزانهٔ مشترک.
 * شمارندهٔ سقف همان ردیف‌های Notification ۲۴ ساعت اخیر است (pushCountLast24h) —
 * یعنی مجموع وب‌پوش + FCM برای هر کاربر در یک روز از PUSH_DAILY_CAP عبور نمی‌کند
 * (ضداسپم). خطای هر کانال هرگز کانال دیگر یا جریان اصلی را نمی‌بندد.
 */
async function deliverPushes(
  userId: string,
  title: string,
  body: string,
  link?: string,
  notificationId?: string,
  type?: string,
  meta?: any
): Promise<void> {
  try {
    // سقف روزانهٔ مشترک — یک شمارش برای هر دو کانال
    const sentLast24h = await pushCountLast24h(userId);
    if (sentLast24h > PUSH_DAILY_CAP) {
      console.warn(
        `[createNotification] daily push cap reached (web+FCM) user=${userId} (${sentLast24h}/24h > ${PUSH_DAILY_CAP}) — push skipped, in-app notification saved`
      );
      return;
    }
    const results = await Promise.allSettled([
      sendPushToUser(userId, title, body, link),
      sendFcmToUser(userId, {
        title,
        body,
        link,
        notificationId,
        type,
        data: meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null,
      }),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        // silent fail — push optional است
        console.warn(
          "[createNotification] push failed (non-blocking):",
          (r.reason as any)?.message || r.reason
        );
      }
    }
  } catch (err: any) {
    console.warn("[createNotification] push failed (non-blocking):", err?.message || err);
  }
}

// ─── lazy init web-push (مانند /api/push/send/route.ts) ───
// در زمان build مقداردهی نمی‌شود چون VAPID keys موجود نیستند.
let _webpush: any = null;
async function getWebpush(): Promise<any | null> {
  if (_webpush) return _webpush;
  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      // VAPID keys تنظیم نشده‌اند — push غیرفعال است
      return null;
    }
    const wp = (await import("web-push")).default;
    const subject = `mailto:support@${
      (process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir")
        .replace("https://", "")
        .replace("http://", "")
    }`;
    wp.setVapidDetails(subject, publicKey, privateKey);
    _webpush = wp;
    return _webpush;
  } catch (err) {
    console.warn("[sendPushToUser] web-push init failed:", err);
    return null;
  }
}

// ─── v36: سقف روزانهٔ push برای هر کاربر (رفع «Chrome detected spam») ───
// اگر یک کاربر در ۲۴ ساعت بیش از این تعداد push گرفته باشد، pushهای بعدی
// skip می‌شوند (اعلان همچنان در اپ ذخیره می‌شود — فقط نوتیفِ سیستم‌عامل
// ارسال نمی‌شود). گوگل اپ‌هایی که push انبوه/مکرر می‌فرستند به‌عنوان
// «اعلان مزاحم» علامت می‌زند. پیش‌فرض ۸ — با PUSH_DAILY_CAP قابل تغییر.
const PUSH_DAILY_CAP = Math.max(
  1,
  Number(process.env.PUSH_DAILY_CAP || 8)
);

/** شمارش pushهای ۲۴ ساعت اخیر کاربر (proxy: ردیف‌های Notification ایجادشده) */
async function pushCountLast24h(userId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await db.notification.count({
      where: { userId, createdAt: { gte: since } },
    });
  } catch {
    return 0; // خطای شمارش هرگز نباید push را ببندد
  }
}

/**
 * ارسال push notification به تمام دستگاه‌های کاربر (PWA).
 * best-effort: خطاها silently نادیده گرفته می‌شوند تا جریان اصلی شکسته نشود.
 * endpointهای نامعتبر (410/404) به‌صورت خودکار از DB پاک می‌شوند.
 * v36: سقف روزانه (PUSH_DAILY_CAP) — جلوگیری از اعلان انبوه → پرچم اسپم کروم.
 */
async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  link?: string
): Promise<void> {
  const wp = await getWebpush();
  if (!wp) return; // VAPID keys موجود نیست — skip

  // سقف روزانه — بعد از ۸ اعلان در ۲۴ ساعت، فقط اعلان درون‌اپ (بدون push سیستم)
  const sentLast24h = await pushCountLast24h(userId);
  if (sentLast24h > PUSH_DAILY_CAP) {
    console.warn(
      `[sendPushToUser] daily cap reached for user=${userId} (${sentLast24h}/24h > ${PUSH_DAILY_CAP}) — push skipped, in-app notification saved`
    );
    return;
  }

  const subs = await db.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return; // کاربر دستگاهی ثبت نکرده

  const payload = JSON.stringify({
    title,
    body,
    url: link || "/",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "fa",
    vibrate: [100, 50, 100],
    tag: "fitup-notification",
    requireInteraction: false,
  });

  const invalidEndpoints: string[] = [];
  for (const sub of subs) {
    try {
      await wp.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      );
    } catch (err: any) {
      // 410 = subscription expired, 404 = not found → پاک‌سازی
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        invalidEndpoints.push(sub.endpoint);
      }
      // سایر خطاها (network، timeout، ...) silently نادیده گرفته می‌شوند
    }
  }

  if (invalidEndpoints.length > 0) {
    try {
      await db.pushSubscription.deleteMany({
        where: { endpoint: { in: invalidEndpoints } },
      });
    } catch {
      // silent — cleanup غیربحرانی است
    }
  }
}

/**
 * Generate a unique per-user renewal discount code for loyalty.
 * Format: FITAP15-{USERID-SHORT-6-CHARS}
 * (FITAP15 = 15% off renewal loyalty, private per-user, only shown in dashboard)
 * نکته: پیشوند FITAP15 برندِ کد است؛ درصد واقعی همیشه از فیلد value خوانده
 * می‌شود و از پنل مدیر (تنظیمات) قابل تغییر است.
 */
export function buildRenewalDiscountCode(userId: string, percent: number): string {
  // First 6 chars of the userId (cuid), uppercased, alphanumeric only
  const short = userId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "0");
  return `FITAP15-${short}`;
}

/**
 * خواندن یک تنظیم عددی از SiteSetting با سقف/کف امن.
 * (درصدهای تخفیف پیامکی از پنل مدیر قابل تغییرند — v32)
 */
export async function getSettingNumber(
  key: string,
  fallback: number,
  min: number,
  max: number
): Promise<number> {
  try {
    const setting = await db.siteSetting.findUnique({ where: { key }, select: { value: true } });
    if (setting) {
      const val = parseInt(setting.value, 10);
      if (!isNaN(val)) return Math.min(max, Math.max(min, val));
    }
  } catch {
    // DB در دسترس نیست — پیش‌فرض
  }
  return fallback;
}

/** درصد تخفیف پیامک «انقضای پلن + ۷۲ ساعت» (قالب 604678) — کلید پنل مدیر: expiry_discount_percent */
export async function getExpiryDiscountPercent(): Promise<number> {
  return getSettingNumber("expiry_discount_percent", 30, 5, 90);
}

/** درصد تخفیف پیامک «۲۴ ساعت بعد از آنبوردینگ بدون خرید» (قالب 461291) — کلید پنل مدیر: onboarding_discount_percent */
export async function getOnboardingDiscountPercent(): Promise<number> {
  return getSettingNumber("onboarding_discount_percent", 15, 5, 90);
}

/**
 * Ensure a user has an active (non-expired, non-used) per-user discount code
 * for renewal. If they already have one, reuse it; otherwise create a new one.
 *
 * Default percent = 15 (FITAP15 loyalty code).
 * v53 — اعتبار پیش‌فرض ۱۴ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک.
 */
export async function ensureRenewalDiscountCode(
  userId: string,
  percent = 15,
  validForDays = 2
): Promise<{ code: string; value: number; type: "percent" } | null> {
  // Look for an existing active (non-used, non-expired) renewal code
  const now = new Date();
  const existing = await db.userDiscountCode.findFirst({
    where: {
      userId,
      isUsed: false,
      reason: "renewal_loyalty",
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    // ─── اعمال درصد جدید مدیر (v32) ───
    // اگر ادمین درصد را در پنل تغییر داده باشد، کدِ استفاده‌نشدهٔ کاربر هم
    // به‌روز می‌شود تا «تغییر درصد در پنل = اعمال واقعی روی کدها» برقرار باشد.
    if (existing.value !== percent) {
      const newValidUntil = new Date();
      newValidUntil.setDate(newValidUntil.getDate() + validForDays);
      try {
        const updated = await db.userDiscountCode.update({
          where: { id: existing.id },
          data: { value: percent, validUntil: newValidUntil },
        });
        return { code: updated.code, value: updated.value, type: "percent" as const };
      } catch {
        // خطای به‌روزرسانی — همان کد قبلی برگردانده می‌شود (بدون شکستن جریان)
      }
    }
    return { code: existing.code, value: existing.value, type: "percent" as const };
  }

  // Otherwise create a new one (retry on unique collision)
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validForDays);

  for (let attempt = 0; attempt < 5; attempt++) {
    // The base code is deterministic per user (FITAP15-{short6}). On collision
    // (already exists for another user due to short hash), append a numeric suffix.
    const suffix = attempt === 0 ? "" : String(attempt);
    const code = `${buildRenewalDiscountCode(userId, percent)}${suffix}`;
    try {
      const created = await db.userDiscountCode.create({
        data: {
          userId,
          code,
          type: "percent",
          value: percent,
          reason: "renewal_loyalty",
          isUsed: false,
          validUntil,
        },
      });
      return { code: created.code, value: created.value, type: "percent" as const };
    } catch (err: any) {
      // P2002 = unique constraint failure — retry with new code
      if (err?.code !== "P2002" && err?.name !== "PrismaClientKnownRequestError") {
        console.error("[ensureRenewalDiscountCode] failed:", err);
        return null;
      }
    }
  }
  return null;
}

/**
 * کد تخفیف اختصاصی «بازگشت بعد از آنبوردینگ» (پیامک 461291).
 * برای هر کاربر یکتا، یک‌بارمصرف و فقط برای اولین خرید فعال است
 * (اعتبارسنجی «فقط خرید اول» در api/payment/discount و api/payment/checkout).
 * Format: NEW{percent}-{USERID-SHORT-6}
 * v53 — اعتبار پیش‌فرض ۲ روز (۴۸ ساعت).
 */
export function buildOnboardingWinbackCode(userId: string, percent: number): string {
  const short = userId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "0");
  return `NEW${percent}-${short}`;
}

// v53 — اعتبار پیش‌فرض ۳۰ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
export async function ensureOnboardingWinbackCode(
  userId: string,
  percent = 15,
  validForDays = 2
): Promise<{ code: string; value: number; type: "percent" } | null> {
  const now = new Date();
  const existing = await db.userDiscountCode.findFirst({
    where: {
      userId,
      reason: "onboarding_winback",
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    // اعمال درصد جدید مدیر روی کد استفاده‌نشده (مثل کد تمدید)
    if (!existing.isUsed && existing.value !== percent) {
      const newValidUntil = new Date();
      newValidUntil.setDate(newValidUntil.getDate() + validForDays);
      try {
        const updated = await db.userDiscountCode.update({
          where: { id: existing.id },
          data: { value: percent, validUntil: newValidUntil },
        });
        return { code: updated.code, value: updated.value, type: "percent" as const };
      } catch {}
    }
    if (!existing.isUsed) {
      return { code: existing.code, value: existing.value, type: "percent" as const };
    }
    // کد قبلی استفاده شده — کد جدید نمی‌سازیم (این پیامک یک‌بار در عمر حساب است)
    return null;
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validForDays);

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = attempt === 0 ? "" : String(attempt);
    const code = `${buildOnboardingWinbackCode(userId, percent)}${suffix}`;
    try {
      const created = await db.userDiscountCode.create({
        data: {
          userId,
          code,
          type: "percent",
          value: percent,
          reason: "onboarding_winback",
          isUsed: false,
          validUntil,
        },
      });
      return { code: created.code, value: created.value, type: "percent" as const };
    } catch (err: any) {
      if (err?.code !== "P2002" && err?.name !== "PrismaClientKnownRequestError") {
        console.error("[ensureOnboardingWinbackCode] failed:", err);
        return null;
      }
    }
  }
  return null;
}

/** درصد تخفیف پیامک خوش‌آمدگویی ۸ روزه (قالب 612964) — کلید پنل مدیر: welcome_offer_discount_percent (v47 — پیش‌فرض ۳۰٪) */
export async function getWelcomeOfferDiscountPercent(): Promise<number> {
  return getSettingNumber("welcome_offer_discount_percent", 30, 5, 90);
}

/**
 * کد تخفیف اختصاصی «خوش‌آمدگویی خرید» (پیامک 612964 — v47).
 * دقیقاً ۸ روز بعد از ثبت موبایل برای کاربرِ بدونِ خرید ساخته می‌شود.
 * یک‌بارمصرف و فقط برای اولین خرید فعال است (reason=welcome_offer —
 * اعتبارسنجی «فقط خرید اول» در api/payment/discount و api/payment/checkout
 * برای همهٔ reasonهای غیر-renewal برقرار است).
 * Format: HI{percent}-{USERID-SHORT-6}
 * v53 — اعتبار پیش‌فرض ۲ روز (۴۸ ساعت).
 */
export function buildWelcomeOfferCode(userId: string, percent: number): string {
  const short = userId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "0");
  return `HI${percent}-${short}`;
}

// v53 — اعتبار پیش‌فرض ۳۰ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
export async function ensureWelcomeOfferCode(
  userId: string,
  percent = 30,
  validForDays = 2
): Promise<{ code: string; value: number; type: "percent" } | null> {
  const now = new Date();
  const existing = await db.userDiscountCode.findFirst({
    where: {
      userId,
      reason: "welcome_offer",
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    // اعمال درصد جدید مدیر روی کد استفاده‌نشده — سینک پنل ↔ کد ↔ قیمت‌ها
    if (!existing.isUsed && existing.value !== percent) {
      const newValidUntil = new Date();
      newValidUntil.setDate(newValidUntil.getDate() + validForDays);
      try {
        const updated = await db.userDiscountCode.update({
          where: { id: existing.id },
          data: { value: percent, validUntil: newValidUntil },
        });
        return { code: updated.code, value: updated.value, type: "percent" as const };
      } catch {}
    }
    if (!existing.isUsed) {
      return { code: existing.code, value: existing.value, type: "percent" as const };
    }
    // کد قبلی استفاده شده — پیامک/کد جدید نمی‌سازیم (یک‌بار در عمر حساب)
    return null;
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validForDays);

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = attempt === 0 ? "" : String(attempt);
    const code = `${buildWelcomeOfferCode(userId, percent)}${suffix}`;
    try {
      const created = await db.userDiscountCode.create({
        data: {
          userId,
          code,
          type: "percent",
          value: percent,
          reason: "welcome_offer",
          isUsed: false,
          validUntil,
        },
      });
      return { code: created.code, value: created.value, type: "percent" as const };
    } catch (err: any) {
      if (err?.code !== "P2002" && err?.name !== "PrismaClientKnownRequestError") {
        console.error("[ensureWelcomeOfferCode] failed:", err);
        return null;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// v53 — کد تخفیف «ترک درگاه پرداخت» (سناریوی abandoned_cart)
// ═══════════════════════════════════════════════════════════════════════════
// کاربری که پرداخت درگاه (زرین‌پال) را شروع کرده و همان را رها کرده، در
// پنجرهٔ ۵۵ دقیقه تا ۲۴ ساعت با پیامک «کد ۲۴۸۹۴۵» (درصد از تنظیم پنل،
// پیش‌فرض ۱۰٪ و اعتبار ۲ ساعت) به صفحهٔ پلن‌ها برمی‌گردد.
//
// ⚠️ کد «نمایشی» به کاربر همیشه «248945» است، ولی چون UserDiscountCode.code
// @unique سراسری است، کد «داخلی» یکتا با فرمت «248945-{5charRandom}» ساخته
// می‌شود و فقط این کد داخلی در /plans?offer=... و جدول می‌چرخد (resolve
// نمایشی → داخلی در api/payment/discount و api/payment/checkout انجام می‌شود).

/** کد نمایشی ترک درگاه — چیزی که کاربر در پیامک/UI می‌بیند */
export const ABANDONED_CART_DISPLAY_CODE = "248945";

/** پیشوند کد داخلی ترک درگاه (دنبالهٔ ۵ کاراکتری تصادفی) */
export const ABANDONED_CART_CODE_PREFIX = "248945-";

/** حروف الفبای کد داخلی — فقط بزرگ/رقم (بدون I/O/0/1 گیج‌کننده) — ⚠️ باید
 * uppercase-safe باشد: کل زنجیرهٔ کد تخفیف (discount/checkout) ورودی را
 * toUpperCase می‌کند و کد باید بعد از آن ذاتی‌اش حفظ شود */
const ABANDONED_CART_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomAbandonedCartSuffix(len = 5): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ABANDONED_CART_ALPHABET[bytes[i] % ABANDONED_CART_ALPHABET.length];
  return out;
}

/**
 * درصد تخفیف سناریوی «ترک درگاه پرداخت» — کلید پنل مدیر:
 * abandoned_cart_discount_percent (پیش‌فرض ۱۰٪)
 */
export async function getAbandonedCartDiscountPercent(): Promise<number> {
  return getSettingNumber("abandoned_cart_discount_percent", 10, 5, 90);
}

/**
 * کد داخلیِ معتبرِ ترک-درگاهِ کاربر (unused + validUntil آینده) — برای resolve
 * کد نمایشی «248945» در api/payment/discount و api/payment/checkout.
 * اگر کاربر کد معتبری نداشته باشد null برمی‌گردد (یعنی «248945» برای او
 * منقضی/ناموجود است).
 */
export async function getAbandonedCartCodeForUser(userId: string) {
  const now = new Date();
  return db.userDiscountCode.findFirst({
    where: {
      userId,
      reason: "abandoned_cart",
      isUsed: false,
      code: { startsWith: ABANDONED_CART_CODE_PREFIX },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Ensure a valid (non-used, non-expired) abandoned-cart code for the user.
 * اگر کد unused از همین reason با validUntil آینده موجود باشد همان برگردانده
 * می‌شود (نه کد جدید)؛ فقط درصدش با تنظیم فعلی پنل سینک می‌شود تا متن پیامک و
 * قیمتِ کارت‌ها همیشه با کد یکی باشد. validUntil هرگز تمدید نمی‌شود —
 * «دو ساعت از لحظهٔ ساخت» قطعی است.
 */
export async function ensureAbandonedCartCode(
  userId: string,
  percent = 10,
  validHours = 2
): Promise<{ code: string; value: number; type: "percent"; validUntil: Date | null } | null> {
  const now = new Date();
  const existing = await getAbandonedCartCodeForUser(userId);
  if (existing) {
    if (existing.value !== percent) {
      try {
        const updated = await db.userDiscountCode.update({
          where: { id: existing.id },
          data: { value: percent },
        });
        return {
          code: updated.code,
          value: updated.value,
          type: "percent" as const,
          validUntil: updated.validUntil,
        };
      } catch {}
    }
    return {
      code: existing.code,
      value: existing.value,
      type: "percent" as const,
      validUntil: existing.validUntil,
    };
  }

  const validUntil = new Date(now.getTime() + Math.max(1, validHours) * 60 * 60 * 1000);

  // کد داخلی یکتا (code @unique سراسری) — برخورد → پسوند تصادفی جدید
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = `${ABANDONED_CART_CODE_PREFIX}${randomAbandonedCartSuffix(5 + attempt)}`;
    try {
      const created = await db.userDiscountCode.create({
        data: {
          userId,
          code,
          type: "percent",
          value: percent,
          reason: "abandoned_cart",
          isUsed: false,
          validUntil,
        },
      });
      return {
        code: created.code,
        value: created.value,
        type: "percent" as const,
        validUntil: created.validUntil,
      };
    } catch (err: any) {
      if (err?.code !== "P2002" && err?.name !== "PrismaClientKnownRequestError") {
        console.error("[ensureAbandonedCartCode] failed:", err);
        return null;
      }
    }
  }
  return null;
}
