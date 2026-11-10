/**
 * v233 — سناریوی «یادآور T+10min» پرداخت در انتظار — جدا از cron/behavioral
 * (عین الگوی abandoned-cart-scenario تا مستقیماً قابل تست هم باشد).
 *
 * ─── دیرکتیو مالک (پس از تحلیل قیف فروش — اکتبر ۱۲) ───
 * «یادآور T+10min موقع انقضای پرداخت را با ظرافت بسیار بالا و بدون اینکه در
 *  تمام پرداخت‌های سایت مشکلی پیش بیاد انجام بده»
 *
 * ریشهٔ پولی: ریزش شمارهٔ ۱ قیف = پرداخت‌های درگاهی که کاربر واردش شده (authority
 * صادر شده) و برنمی‌گردد — ۳۲ پرداخت/۳۱.۱۵M تومان در ۷ روز (۶۶٪ پولِ تلاش‌شده).
 * یک یادآور زودهنگامِ ملایم (بدون تخفیف، بدون فشار) در T+10 دقیقه ارزان‌ترین
 * نجات‌دهنده است؛ پنجرهٔ حواس کاربر هنوز باز است و authority زرین‌پال معمولاً
 * هنوز معتبر است (کاربر با یک کلیک به همان پرداخت برمی‌گردد).
 *
 * گاردهای ظرافت‌ بالا (همه در لحظهٔ ارسال — هیچ‌کدام وضعیت پرداخت/سایت را
 * تغییر نمی‌دهند؛ این سناریو فقط پیامک+نوتیف می‌فرستد):
 *  ۱) فقط Payment status="pending" با paymentMethod="gateway" و authority
 *     واقعی (کاربر حتماً وارد درگاه شده) — wallet_topup مستثنا.
 *  ۲) پنجرهٔ ارسال: دقیقاً بین دقیقهٔ ۱۰ تا ۲۰ بعد از createdAt — با جاروی
 *     ۵ دقیقه‌ای یک‌بار (حداکثر دو تلاش اگر ارسال اول شکست بخورد) شلیک می‌شود؛
 *     نه زودتر (موقع خروج از درگاه مزاحم است) نه دیرتر (پیامِ کهنه اثر ندارد).
 *  ۳) دداپ ابدی per-payment: SmsLog کلید payment_reminder_{paymentId} —
 *     هرگز دوباره برای همان پرداخت پیامک نمی‌رود.
 *  ۴) ساعت تهران ۱۰ تا ۲۲ — بیرون از این بازه skip (بدون صف صبح؛ پنجرهٔ
 *     ۱۰دقیقه‌ای ارزش لحظه‌ای دارد و صفِ صبحِ ترک-درگاه (v217) اولین خرید را
 *     جداگانه پوشش می‌دهد).
 *  ۵) بعد از createdAt این پرداخت، پرداختِ موفقِ دیگری برای کاربر ثبت نشده باشد
 *     (اگر کاربر با پرداخت دیگر/دوباره خریدش را کامل کرده، مزاحم نمی‌شویم).
 *  ۶) پرداخت در لحظهٔ شلیک دوباره استعلام می‌شود — اگر بین کوئری و ارسال
 *     موفق/منقضی شده باشد، پیامک نمی‌رود (ضد پیامک به پرداخت‌کرده).
 *  ۷) نوتیف درون‌برنامه فقط در «اولین تلاش» این سناریو برای آن پرداخت —
 *     حتی اگر پیامک تنظیم نباشد/شکست بخورد، کاربرِ داخل اپ یک‌بار می‌بیند.
 *
 * کانال پیامک — v235 (دیرکتیو قطعی مالک: «حواست باشه یه دونه پیامک باید برای کسی
 * که درگاه رو ترک کرده بره»): این سناریو «همان لمسِ ترک-درگاه» است، فقط ۲۰ دقیقه
 * زودتر — نه پیامک دوم، نه قالب تازه:
 *  • قالب: فقط و فقط قالب ترک-درگاه (env SMSIR_ABANDONED_CART_TEMPLATE_ID =
 *    ۲۴۸۹۴۵ یا SiteSetting abandoned_cart_sms_template_id). نردبانِ اختصاصیِ
 *    v233/v234 (SMSIR_PAYMENT_REMINDER_TEMPLATE_ID / پنل) کامل حذف شد تا
 *    «دو پیامک» به‌صورت ساختاری غیرممکن باشد — در هیچ تنظیمی دوبار شلیک نمی‌شود.
 *  • چون متنِ ۲۴۸۹۴۵ وعدهٔ «۱۰٪ تخفیف تا دو ساعت» دارد، دقیقاً عین گاردهای
 *    سناریوی ترک-درگاه اعمال می‌شود (همیشه، بدون استثنا):
 *    • کد تخفیف واقعی «هم‌زمان با ارسال» ساخته می‌شود (دیرکتیو v217) — نبودنش
 *      یعنی این sweep پیامک نمی‌رود و جاروی ۳۰دقیقه‌ای خودش تلاش می‌کند.
 *    • گاردهای واجدیت: پلن فعال ✗ / سابقهٔ اشتراک ✗ / کد خوش‌آمد یا وین‌بکِ زنده ✗ /
 *      سقف ۱ پیامک ترک-درگاه در ۷ روز ✗ (سقف بین دو سناریو مشترک است).
 *    • اگر ترک-درگاه صاحب این پرداخت باشد (abandoned_cart_{id} = sent یا
 *      queuedِ صبح) → کنار می‌رویم (ضد دوبل با صف صبح v217).
 *    • بعد از ارسال موفق، ردیف abandoned_cart_{id}=sent نوشته می‌شود تا جاروی
 *      ۳۰دقیقه‌ایِ ترک-درگاه همان پرداخت را داپ بزند — یعنی از ترکِ درگاه به بعد
 *      فقط «یک» پیامک رفته (در T+10–20)، هرگز دو تا.
 *  • قالب تنظیم نباشد = فقط نوتیف درون‌برنامه (خرابی نیست؛ جاروی ۳۰دقیقه‌ای
 *    خودش رکورد failed مفهوم‌دار می‌نویسد).
 *  • کلید خاموشی (رفتار کلاسیک T+30 بدون تغییر کد): SiteSetting
 *    payment_reminder_enabled = "0".
 * لینک: pay/{authority} (صفحهٔ میانی موجود — همان مسیر دکمهٔ درگاه) با لینک
 * کوتاه r/XXXXXXXX (ضد خطای ۱۱۴ طول پارامتر).
 */

import { db } from "@/lib/db";
import {
  createNotification,
  ensureAbandonedCartCode,
  getAbandonedCartDiscountPercent,
} from "@/lib/fitness/notifications";
import { normalizeMobileForSmsIr } from "@/lib/fitness/smsir";
import { sendPaymentReminderSms } from "@/lib/fitness/sms-flows";
import { createSmsShortLink } from "@/lib/fitness/sms-short-link";
import {
  tehranHourNow,
  tehranSendWindowStart,
} from "@/lib/fitness/abandoned-cart-scenario";

export interface PaymentReminderSkipDetail {
  /** کاربر ناموجود/مسدود/بدون موبایل معتبر */
  invalidUser: number;
  /** بعد از این پرداخت خرید موفق دیگری داشته / پرداخت دیگر pending نیست */
  laterSuccess: number;
  /** بیرون از پنجرهٔ ساعت ۱۰–۲۲ تهران */
  outOfHours: number;
  /** تلاش ارسال ناموفق (خطای درگاه پیامک) — sweep بعدی تا سقف پنجره دوباره */
  failed: number;
  /** v234 — ترک-درگاه صاحب این پرداخت است (sent/queued صبح) → ضد دوبل کنار رفتیم */
  acOwned: number;
  /** v235 — واجدیتِ لمسِ تخفیفِ ترک-درگاه را نداشت (عین گاردهای ترک-درگاه —
   *  همیشه اعمال می‌شود چون متن قالب ۲۴۸۹۴۵ وعدهٔ تخفیف دارد) */
  discountGuard: number;
}

export interface PaymentReminderResult {
  /** پرداخت‌های داخل پنجرهٔ ۱۰–۲۰ دقیقه */
  candidates: number;
  /** پیامک واقعاً ارسال شده */
  smsSent: number;
  /** v235 — از ارسال‌های موفق، چندتا ردیف دداپِ ترک-درگاه‌شان pre-write شد
   *  (ضد دوبل با جاروی ۳۰دقیقه‌ای — «فقط یک پیامک»؛ عملاً = همهٔ ارسال‌ها) */
  acMarkedSms: number;
  /** قبلاً یادآوری شده (داپ ابدی per-payment) */
  alreadyReminded: number;
  /** نوتیف درون‌برنامهٔ صادرشده (فقط اولین تلاش هر پرداخت) */
  notified: number;
  /** پیامک ارسال نشد چون هیچ قالبی (اختصاصی + فال‌بک ترک-درگاه) تنظیم نیست */
  smsNoTemplate: number;
  skipped: PaymentReminderSkipDetail;
}

export async function runPaymentReminderScenario(
  now: Date,
  opts?: { forceSendWindow?: boolean }
): Promise<PaymentReminderResult> {
  const result: PaymentReminderResult = {
    candidates: 0,
    smsSent: 0,
    acMarkedSms: 0,
    alreadyReminded: 0,
    notified: 0,
    smsNoTemplate: 0,
    skipped: {
      invalidUser: 0,
      laterSuccess: 0,
      outOfHours: 0,
      failed: 0,
      acOwned: 0,
      discountGuard: 0,
    },
  };

  // on/off — پیش‌فرض روشن؛ "0" = کل سناریو skip
  const enabledSetting = await db.siteSetting.findUnique({
    where: { key: "payment_reminder_enabled" },
    select: { value: true },
  });
  if (enabledSetting?.value === "0") return result;

  // ─── v235 فقط یک قالب: همان قالب ترک-درگاه (۲۴۸۹۴۵) — دیرکتیو قطعی مالک ───
  // «ما پیامک ترک خرید درگاه داریم با شناسه قالب ۲۴۸۹۴۵ — چرا دوباره بسازیم؟» +
  // «یه دونه پیامک باید برای کسی که درگاه رو ترک کرده بره». نردبانِ v233/v234
  // (قالب اختصاصی یادآور: SMSIR_PAYMENT_REMINDER_TEMPLATE_ID / پنل) کامل حذف
  // شد و دیگر خوانده نمی‌شود — یادآور T+10 = لمسِ تخفیفِ ترک-درگاه، زودتر.
  const acTemplateIdSetting = await db.siteSetting.findUnique({
    where: { key: "abandoned_cart_sms_template_id" },
    select: { value: true },
  });
  // اول env (هماهنگ با بقیهٔ قالب‌ها)، بعد پنل ادمین
  const templateId =
    process.env.SMSIR_ABANDONED_CART_TEMPLATE_ID?.trim() ||
    acTemplateIdSetting?.value?.trim() ||
    null;
  // متن قالب («با X درصد تخفیف تا دو ساعت») → گاردهای ترک-درگاه همیشه لازم‌اند؛
  // درصد باید عین تنظیم ترک-درگاه بماند تا متن قالب همیشه با کدِ واقعی یکی باشد.
  const percent = await getAbandonedCartDiscountPercent();
  const sevenDaysAgoPR = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // پنجره: ۱۰ تا ۲۰ دقیقه بعد از ترک درگاه
  const minCreated = new Date(now.getTime() - 20 * 60 * 1000);
  const maxCreated = new Date(now.getTime() - 10 * 60 * 1000);

  const tehranHour = tehranHourNow(now);
  const inSendWindow =
    opts?.forceSendWindow === true || (tehranHour >= 10 && tehranHour < 22);

  const pendingPayments = await db.payment.findMany({
    where: {
      status: "pending",
      paymentMethod: "gateway",
      plan: { not: "wallet_topup" },
      createdAt: { gte: minCreated, lte: maxCreated },
      // فقط پرداخت‌هایی که واقعاً به درگاه رسیده‌اند (authority صادر شده)
      AND: [{ authority: { not: null } }, { authority: { not: "" } }],
    },
    select: { id: true, userId: true, authority: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  for (const p of pendingPayments) {
    // هر پرداخت در try/catch خودش — خطای یکی بقیهٔ sweep را نمی‌کُشد
    try {
      const dedupeKey = `payment_reminder_${p.id}`;

      const u = await db.user.findUnique({
        where: { id: p.userId },
        select: {
          id: true,
          name: true,
          mobile: true,
          isBlocked: true,
          planExpiresAt: true,
        },
      });
      if (!u || u.isBlocked || !u.mobile) {
        result.skipped.invalidUser++;
        continue;
      }
      const normalizedMobile = normalizeMobileForSmsIr(u.mobile);
      if (!/^9\d{9}$/.test(normalizedMobile)) {
        result.skipped.invalidUser++;
        continue;
      }

      result.candidates++;

      // (۳) دداپ ابدی per-payment
      const existingLog = await db.smsLog.findUnique({
        where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
        select: { status: true },
      });
      if (existingLog?.status === "sent") {
        result.alreadyReminded++;
        continue;
      }
      const firstAttempt = !existingLog;

      // (۴) پنجرهٔ ساعت تهران — بیرون آن skip بدون ردیف (بدون صف صبح)
      if (!inSendWindow) {
        result.skipped.outOfHours++;
        continue;
      }

      // (۵) بعد از این پرداخت، خرید موفق دیگری داشته؟
      const laterSuccessPayment = await db.payment.findFirst({
        where: { userId: u.id, status: "success", createdAt: { gt: p.createdAt } },
        select: { id: true },
      });
      if (laterSuccessPayment) {
        result.skipped.laterSuccess++;
        continue;
      }

      // (۶) استعلام تازه — اگر بین کوئری و ارسال تعیین‌تکلیف شده، مزاحم نمی‌شویم
      const fresh = await db.payment.findUnique({
        where: { id: p.id },
        select: { status: true },
      });
      if (fresh?.status !== "pending") {
        result.skipped.laterSuccess++;
        continue;
      }

      // ─── v235 گاردهای ترک-درگاه (همیشه — متن قالب ۲۴۸۹۴۵ وعدهٔ تخفیف دارد) ───
      // این پیامک عملاً همان لمسِ تخفیفِ ترک-درگاه است که ۲۰ دقیقه زودتر می‌رود. پس:
      const acDedupeKey = `abandoned_cart_${p.id}`;
      if (templateId) {
        // ① ترک-درگاه صاحب این پرداخت است؟ sent = پیامکش رفته، queued = برای صبح
        //    صف شده (صف صبح v217 کدِ تازه می‌سازد و خودش می‌فرستد) → کنار می‌رویم.
        const acLog = await db.smsLog.findUnique({
          where: { mobile_key: { mobile: normalizedMobile, key: acDedupeKey } },
          select: { status: true },
        });
        if (acLog?.status === "sent" || acLog?.status === "queued") {
          result.skipped.acOwned++;
          continue;
        }

        // ② پلن فعال ندارد؟ (عین abandoned-cart — به کسی که خریدش کامل است تخفیف نده)
        const activeSubPR = await db.subscription.findFirst({
          where: { userId: u.id, status: "active", endDate: { gt: now } },
          select: { id: true },
        });
        const hasActivePlanPR =
          !!activeSubPR ||
          (u.planExpiresAt != null && u.planExpiresAt.getTime() > now.getTime());
        if (hasActivePlanPR) {
          result.skipped.discountGuard++;
          continue;
        }

        // ③ ماهیت خرید اول — کد ترک-درگاه فقط برای اولین خرید قابل استفاده است
        const subsCountPR = await db.subscription.count({ where: { userId: u.id } });
        if (subsCountPR > 0) {
          result.skipped.discountGuard++;
          continue;
        }

        // ④ کد تخفیف اولین-خریدِ معتبرِ دیگر دارد؟ → ضد تداخل کمپین‌ها (عین ترک-درگاه)
        const otherOfferCodePR = await db.userDiscountCode.findFirst({
          where: {
            userId: u.id,
            isUsed: false,
            reason: { in: ["welcome_offer", "onboarding_winback", "expired_winback"] },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { id: true },
        });
        if (otherOfferCodePR) {
          result.skipped.discountGuard++;
          continue;
        }

        // ⑤ سقف ۱ پیامک ترک-درگاه در ۷ روز — ردیف‌های pre-writeِ همین سناریو هم
        //    با کلید abandoned_cart_* شمرده می‌شوند؛ یعنی سقف بین دو سناریو مشترک است.
        const recentAbandonedPR = await db.smsLog.findFirst({
          where: {
            mobile: normalizedMobile,
            key: { startsWith: "abandoned_cart_" },
            status: "sent",
            createdAt: { gt: sevenDaysAgoPR },
          },
          select: { id: true },
        });
        if (recentAbandonedPR) {
          result.skipped.discountGuard++;
          continue;
        }

        // ⑥ کد تخفیف باید «هم‌زمان با ارسال» زنده باشد (دیرکتیو v217 — عین ترک-درگاه).
        // نبودِ کد = این sweep پیامک نمی‌رود (متنِ قالب هرگز بی‌کد نمی‌رود)؛
        // جاروی ۳۰دقیقه‌ایِ ترک-درگاه خودش دوباره تلاش می‌کند.
        const discountPR = await ensureAbandonedCartCode(u.id, percent, 2, {
          minCreatedAt: tehranSendWindowStart(now),
        });
        if (!discountPR) {
          result.skipped.discountGuard++;
          console.warn(
            `[payment-reminder] ساخت کد تخفیف شکست (payment=${p.id}) — پیامک این sweep نمی‌رود؛ جاروی ترک-درگاه ۳۰دقیقه‌ای تلاش می‌کند`
          );
          continue;
        }
      }

      // لینک: صفحهٔ میانی موجود pay/{authority} با لینک کوتاه (ضد خطای طول)
      const payTarget = `pay/${p.authority}`;
      const link =
        (await createSmsShortLink(payTarget, {
          userId: u.id,
          expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
        })) || payTarget;

      const smsRes = await sendPaymentReminderSms({
        user: { id: u.id, name: u.name, mobile: u.mobile },
        dedupeKey,
        link,
        templateId,
      });

      if (smsRes.sent) {
        result.smsSent++;
        // v235 — بعد از هر ارسال موفق، ردیف دداپِ ترک-درگاه همین پرداخت «sent»
        // می‌شود تا جاروی ۳۰دقیقه‌ای دوباره همان متن تخفیف را نفرستد (ضد دوبل
        // قطعی — «فقط یک پیامک») و سقف ۷روزه هم این لمس را بشمارد. هر خطا اینجا
        // هرگز جلوی چیزی را نمی‌گیرد (worst case = یک پیامکِ اضافه در T+30،
        // نه کمبود). ارسالِ موفق بدون قالب ممکن نیست → templateId اینجا همیشه
        // مقدار دارد.
        const marked = await markAbandonedCartSentViaReminder(
          normalizedMobile,
          p.id,
          templateId ?? "template",
          u.id
        );
        if (marked) result.acMarkedSms++;
      } else if (smsRes.skipped === "already_sent") {
        result.alreadyReminded++;
      } else {
        result.skipped.failed++;
        if (!templateId) {
          result.smsNoTemplate++;
          // نشانگر per-payment بدون قالب — تا sweep بعدی اولین‌تلاش نشود
          // (نوتیف تکراری نمی‌سازد) و در ممیزی هم دلیل دیده شود.
          try {
            await db.smsLog.upsert({
              where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
              create: {
                mobile: normalizedMobile,
                key: dedupeKey,
                templateId: "none",
                userId: u.id,
                status: "skipped",
                error:
                  "no-template — قالب ترک-درگاه (۲۴۸۹۴۵) تنظیم نیست؛ فقط نوتیف درون‌برنامه (v235)",
              },
              update: {},
            });
          } catch {
            // نشانگر هرگز جلوی نوتیف/ادامه را نمی‌گیرد
          }
        } else {
          console.warn(
            `[payment-reminder] SMS failed (payment=${p.id}): ${smsRes.error ?? smsRes.skipped}`
          );
        }
      }

      // (۷) نوتیف درون‌برنامه — فقط اولین تلاش هر پرداخت (ضد اسپم پنل)
      if (firstAttempt) {
        try {
          await createNotification(
            u.id,
            "system",
            "پرداخت شما نیمه‌کاره ماند 💳",
            "پرداخت پلن شما کامل نشد. اگر قصد ادامه دارید، از بخش پلن‌ها دوباره اقدام کنید — پلن و مبلغ شما همین حالا آماده است.",
            "?tab=plans"
          );
          result.notified++;
        } catch {
          // نوتیف هرگز جلوی ادامه را نمی‌گیرد
        }
      }

      // لاگ رویداد — فقط وقتی اتفاق واقعی افتاد (ارسال/نوتیف اولین/شکست قالبی)
      if (smsRes.sent || firstAttempt) {
        console.info(
          `[payment-reminder] payment=${p.id} user=${u.id} sms=${smsRes.sent ? "sent" : templateId ? "failed" : "no-template"} notified=${firstAttempt ? 1 : 0}`
        );
      }
    } catch (e) {
      result.skipped.failed++;
      console.error(
        `[payment-reminder] خطای پردازش پرداخت ${p.id} (سایر نامزدها ادامه می‌یابند):`,
        e
      );
    }
  }

  const eventCount =
    result.smsSent +
    result.notified +
    result.skipped.failed +
    result.smsNoTemplate +
    result.skipped.acOwned +
    result.skipped.discountGuard;
  if (eventCount > 0) {
    console.info(
      `[payment-reminder] sweep(tehran=${tehranHour}): sms=${result.smsSent} ` +
        `acMarked=${result.acMarkedSms} notified=${result.notified} ` +
        `dup=${result.alreadyReminded} noTpl=${result.smsNoTemplate} ` +
        `failed=${result.skipped.failed} acOwned=${result.skipped.acOwned} ` +
        `dGuard=${result.skipped.discountGuard} ` +
        `outOfHours=${result.skipped.outOfHours} later=${result.skipped.laterSuccess}`
    );
  }

  return result;
}

/**
 * v235 — بعد از ارسالِ موفقِ پیامک یادآور (که همیشه با قالب ترک-درگاه/۲۴۸۹۴۵
 * می‌رود)، ردیف دداپِ ترک-درگاه (abandoned_cart_{paymentId}) را «sent» می‌کند تا:
 *  ۱) جاروی ۳۰دقیقه‌ایِ ترک-درگاه همان پرداخت را داپ بزند (alreadySent) —
 *     یعنی «فقط یک پیامک» برای رهاکنندهٔ درگاه، در T+10–20 نه دو تا،
 *  ۲) سقف ۷روزهٔ ترک-درگاه (کلیدهای abandoned_cart_* sent) این لمس را بشمارد.
 * best-effort — خطا فقط false برمی‌گرداند و هیچ‌گاه جلوی ارسال/نوتیف را نمی‌گیرد.
 * Export شده تا تست مستقیمِ «ضد دوبل با سناریوی ترک-درگاه» هم ممکن باشد.
 */
export async function markAbandonedCartSentViaReminder(
  normalizedMobile: string,
  paymentId: string,
  templateId: string,
  userId: string
): Promise<boolean> {
  const note =
    "sent_early_via_payment_reminder (v235) — پیامک تخفیف ترک-درگاه در T+10 رفت؛ جاروی ۳۰دقیقه‌ای همین پرداخت داپ می‌زند (فقط یک پیامک)";
  try {
    await db.smsLog.upsert({
      where: {
        mobile_key: {
          mobile: normalizedMobile,
          key: `abandoned_cart_${paymentId}`,
        },
      },
      create: {
        mobile: normalizedMobile,
        key: `abandoned_cart_${paymentId}`,
        templateId,
        userId,
        status: "sent",
        error: note,
      },
      update: {
        status: "sent",
        error: note,
      },
    });
    return true;
  } catch (e) {
    console.warn(
      `[payment-reminder] pre-write abandoned_cart_${paymentId} failed (غیرموانع — worst case یک پیامک در T+30):`,
      e
    );
    return false;
  }
}
