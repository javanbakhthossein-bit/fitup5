/**
 * v53 — سناریوی «ترک درگاه پرداخت» (abandoned_cart) — جدا شده از cron/behavioral
 * تا هم از همان sweep استاندارد اجرا شود و هم مستقیماً قابل تست باشد
 * (اسکریپت تست / cron دستی بدون گارد ساعت).
 *
 * نامزدها: Payment های status="pending" با paymentMethod="gateway" (درگاه وب
 * زرین‌پال — مقدار schema این است) که createdAt بین «۳۰ دقیقه» تا ۲۴ ساعت قبل است.
 * v65 — دیریکتیو جدید مالک (اصلاح دستور v64): «پیامک ترک خرید باید دقیقاً ۳۰ دقیقه
 * بعد از ترک درگاه پرداخت ارسال بشه» (قبلاً v64 دو ساعت بود). جارو هم به ۵ دقیقه
 * کاهش یافت (instrumentation-node: BEHAVIORAL_SWEEP_INTERVAL_MIN پیش‌فرض ۵) تا
 * پیامک بین ۳۰ تا ۳۵ دقیقه بعد از ترک درگاه برسد — نزدیک‌ترین حالت ممکن به
 * «دقیقاً ۳۰ دقیقه» با جاروی سبک و بدون فشار به سرور/باتری.
 * (پرداخت‌های plan="wallet_topup" — شارژ کیف پول — متن پلن ندارند، مستثنا.)
 *
 * شروط ارسال (همه در لحظهٔ ارسال):
 *  ۰) v60 — فقط پرداخت‌هایی که بعد از بوتِ این نسخه از سرور ساخته شده‌اند نامزد
 *     می‌شوند (SCENARIO_BOOT_AT). یعنی بعد از هر دیپلوی/ری‌استارت، هیچ پیامکی
 *     به «انبوهِ در انتظارهای» قبل از دیپلوی نمی‌رود؛ سناریو فقط از این به بعد
 *     برای پرداخت‌های جدید طبق روال کار می‌کند.
 *  ۱) کاربر پلن فعال ندارد: نه Subscription active با endDate>now نه planExpiresAt>now
 *  ۲) کاربر کد تخفیف unused معتبر با reason ∈ {welcome_offer, onboarding_winback,
 *     expired_winback} ندارد (این‌ها نباید پیام بگیرند)
 *  ۳) بعد از createdAt این پرداخت، پرداخت موفق/اشتراک فعالِ جدیدی ایجاد نشده
 *  ۴) زمان تهران بین ۱۰:۰۰ تا ۲۲:۰۰ — خارج از بازه ارسال نمی‌شود (نامزد می‌ماند؛
 *     sweep بعدی وقتی ساعت مجاز شد و هنوز در پنجرهٔ ۲۴ساعته بود می‌فرستد)
 *  ۵) SmsLog key=abandoned_cart_{paymentId} قبلاً sent نیست (داپ دائمی per-payment)
 *  ۶) حداکثر یک پیام ترک-درگاه در ۷ روز برای هر کاربر (جستجوی SmsLog با
 *     کلیدهای abandoned_cart_* در ۷ روز اخیر)
 *  ۷) سازگاری با ماهیت «خرید اول» کد (first-purchase gate موجود): کاربرِ دارای
 *     هر نوع اشتراک (حتی منقضی) نامزد نمی‌شود — کد تخفیفِ ترک-درگاه فقط برای
 *     اولین خرید قابل استفاده است و ارسال آن به تمدیدکننده‌ها بن‌بست UX می‌سازد.
 *
 * تنظیمات:
 *  • abandoned_cart_enabled (پیش‌فرض "1") — "0" = کل سناریو skip
 *  • abandoned_cart_discount_percent (پیش‌فرض "10")
 *  • کد قالب پیامک: اول env SMSIR_ABANDONED_CART_TEMPLATE_ID (v55 — هماهنگ با
 *    بقیهٔ پیامک‌ها که کدشان در env است)، بعد SiteSetting
 *    abandoned_cart_sms_template_id؛ خالی = ارسال نمیشود (v61 — مسیر bulk حذف
 *    شد؛ همهٔ پیامک‌ها تحویل قالبی هستند)
 */

import { db } from "@/lib/db";
import {
  ensureAbandonedCartCode,
  getAbandonedCartDiscountPercent,
} from "@/lib/fitness/notifications";
import { normalizeMobileForSmsIr } from "@/lib/fitness/smsir";
import { sendAbandonedCartSms } from "@/lib/fitness/sms-flows";
import { createSmsShortLink } from "@/lib/fitness/sms-short-link";

/**
 * v60 — لحظهٔ بوت این ماژول (= بوت پروسهٔ سرور/دیپلوی).
 * پرداخت‌های pending که قبل از این لحظه ساخته شده‌اند هرگز پیام ترک-درگاه
 * نمی‌گیرند (ضد بک‌لاگ بعد از دیپلوی — درخواست مالک).
 * v64 — فقط برای تست: opts.bootAtOverride (تست اسکریپتی؛ در تولید هرگز پاس
 * داده نمی‌شود).
 */
const SCENARIO_BOOT_AT = new Date();

export interface AbandonedCartScenarioResult {
  /** کل نامزدهای داخل پنجرهٔ ۲۴ ساعته */
  candidates: number;
  /** پیامک واقعاً ارسال/تحویل شده */
  sent: number;
  /** نامزدی که به‌خاطر ساعتِ غیرمجاز تهران رد شد (برای sweep بعدی می‌ماند) */
  skippedOutsideWindow: number;
  /** تلاش ارسالِ ناموفق (مثلاً نبود کلید API — برای retry در sweep بعدی) */
  failed: number;
  /** از قبل ارسال‌شده (داپ) */
  alreadySent: number;
}

/** ساعت فعلی تهران (۰..۲۳) */
export function tehranHourNow(d: Date): number {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran",
      hour: "2-digit",
      hour12: false,
    }).format(d)
  );
  return Number.isFinite(h) ? h : -1;
}

/**
 * اجرای یک چرخهٔ سناریوی ترک-درگاه. در هر sweep (هر ۵ دقیقه — v65) یک بار صدا زده می‌شود.
 * @param opts.forceSendWindow فقط برای تست — گارد ساعت تهران را غیرفعال می‌کند
 * @param opts.bootAtOverride فقط برای تست — جایگزین SCENARIO_BOOT_AT (ضد بک‌لاگ دیپلوی)
 */
export async function runAbandonedCartScenario(
  now: Date,
  opts?: { forceSendWindow?: boolean; bootAtOverride?: Date }
): Promise<AbandonedCartScenarioResult> {
  const result: AbandonedCartScenarioResult = {
    candidates: 0,
    sent: 0,
    skippedOutsideWindow: 0,
    failed: 0,
    alreadySent: 0,
  };

  // on/off — پیش‌فرض روشن؛ "0" = کل سناریو skip
  const enabledSetting = await db.siteSetting.findUnique({
    where: { key: "abandoned_cart_enabled" },
    select: { value: true },
  });
  if (enabledSetting?.value === "0") return result;

  const percent = await getAbandonedCartDiscountPercent();
  const templateIdSetting = await db.siteSetting.findUnique({
    where: { key: "abandoned_cart_sms_template_id" },
    select: { value: true },
  });
  // v55 — اول env (هماهنگ با بقیهٔ قالب‌های پیامک که کدشان در env است)، بعد پنل
  const templateId =
    process.env.SMSIR_ABANDONED_CART_TEMPLATE_ID?.trim() ||
    templateIdSetting?.value?.trim() ||
    null;

  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // v65 — دیریکتیو مالک: پیامک ترک خرید «دقیقاً ۳۰ دقیقه بعد از ترک درگاه» —
  // با جاروی ۵ دقیقه‌ای، ارسال بین ۳۰ تا ۳۵ دقیقه بعد از ترک درگاه می‌افتد.
  const windowSendAfter = new Date(now.getTime() - 30 * 60 * 1000);
  // v60 — دیپلوی-گیت: شروع مؤثر پنجره هرگز قبل از بوتِ این نسخه نیست
  const bootAt = opts?.bootAtOverride ?? SCENARIO_BOOT_AT;
  const effectiveStart =
    bootAt.getTime() > windowStart.getTime() ? bootAt : windowStart;
  const sevenDaysAgoAC = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // بازهٔ ساعت تهران ۱۰:۰۰ تا ۲۲:۰۰
  const tehranHour = tehranHourNow(now);
  const inSendWindow =
    opts?.forceSendWindow === true ||
    (tehranHour >= 10 && tehranHour < 22);

  const pendingPayments = await db.payment.findMany({
    where: {
      status: "pending",
      paymentMethod: "gateway",
      plan: { not: "wallet_topup" },
      createdAt: { gte: effectiveStart, lte: windowSendAfter },
    },
    select: { id: true, userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  for (const p of pendingPayments) {
    const dedupeKey = `abandoned_cart_${p.id}`;

    const u = await db.user.findUnique({
      where: { id: p.userId },
      select: { id: true, name: true, mobile: true, planExpiresAt: true, isBlocked: true },
    });
    if (!u || u.isBlocked || !u.mobile) continue;

    const normalizedMobile = normalizeMobileForSmsIr(u.mobile);
    if (!/^9\d{9}$/.test(normalizedMobile)) continue;

    result.candidates++;

    // (۵) داپ دائمی per-payment — قبل از هر کار سنگین
    const alreadySentLog = await db.smsLog.findUnique({
      where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
      select: { status: true },
    });
    if (alreadySentLog?.status === "sent") {
      result.alreadySent++;
      continue;
    }

    // (۶) حداکثر یک پیام ترک-درگاه در ۷ روز برای هر کاربر
    const recentAbandoned = await db.smsLog.findFirst({
      where: {
        mobile: normalizedMobile,
        key: { startsWith: "abandoned_cart_" },
        status: "sent",
        createdAt: { gt: sevenDaysAgoAC },
      },
      select: { id: true },
    });
    if (recentAbandoned) continue;

    // (۱) پلن فعال ندارد؟
    const activeSubAC = await db.subscription.findFirst({
      where: { userId: u.id, status: "active", endDate: { gt: now } },
      select: { id: true },
    });
    const hasActivePlan =
      !!activeSubAC ||
      (u.planExpiresAt != null && u.planExpiresAt.getTime() > now.getTime());
    if (hasActivePlan) continue;

    // (۷) ماهیت خرید اول — کد ترک-درگاه فقط برای اولین خرید قابل استفاده است
    const subsCountAC = await db.subscription.count({ where: { userId: u.id } });
    if (subsCountAC > 0) continue;

    // (۳) بعد از این پرداخت، پرداخت موفق/اشتراک فعالِ جدیدی ساخته نشده؟
    const laterSuccessPayment = await db.payment.findFirst({
      where: { userId: u.id, status: "success", createdAt: { gt: p.createdAt } },
      select: { id: true },
    });
    if (laterSuccessPayment) continue;
    const laterActiveSub = await db.subscription.findFirst({
      where: { userId: u.id, status: "active", createdAt: { gt: p.createdAt } },
      select: { id: true },
    });
    if (laterActiveSub) continue;

    // (۲) کد تخفیف اولین-خریدِ معتبرِ دیگر دارد؟ → پیام نگیر (ضد تداخل کمپین‌ها)
    const otherOfferCode = await db.userDiscountCode.findFirst({
      where: {
        userId: u.id,
        isUsed: false,
        reason: { in: ["welcome_offer", "onboarding_winback", "expired_winback"] },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { id: true },
    });
    if (otherOfferCode) continue;

    // (۴) بازهٔ ساعت تهران ۱۰ تا ۲۲ — خارج از بازه: نامزد می‌ماند (سکوت)
    if (!inSendWindow) {
      result.skippedOutsideWindow++;
      continue;
    }

    // ─── ساخت کد + لینک + ارسال ───
    const discount = await ensureAbandonedCartCode(u.id, percent, 2);
    if (!discount) continue;

    // لینک هوشمند اپ: go/plans?offer=… → ?screen=panel&tab=plans&offer=…
    // (الگوی کمپین‌های دیگر — target نسبی برای /r/[code] ضد open-redirect)
    const offerTarget = `go/plans?offer=${encodeURIComponent(discount.code)}`;
    const offerExpires = new Date(
      (discount.validUntil ?? now).getTime() + 7 * 24 * 60 * 60 * 1000
    );
    const shortLink = await createSmsShortLink(offerTarget, {
      userId: u.id,
      expiresAt: offerExpires,
    });
    // اگر نگاشت کوتاه شکست → کل target (۲۷+ کاراکتر) در bulk مشکلی ندارد؛
    // در مسیر قالب، گارد ۲۵ کاراکتری sendTemplateSms پارامتر بلند را حذف می‌کند.
    const link = shortLink || offerTarget;

    const smsRes = await sendAbandonedCartSms({
      user: { id: u.id, name: u.name, mobile: u.mobile },
      dedupeKey,
      link,
      percent,
      templateId,
    });

    if (smsRes.sent) {
      result.sent++;
    } else if (smsRes.skipped === "already_sent") {
      result.alreadySent++;
    } else {
      result.failed++;
      console.warn(
        `[abandoned-cart] SMS not sent (payment=${p.id}): ${smsRes.error ?? smsRes.skipped}`
      );
    }
  }

  return result;
}
