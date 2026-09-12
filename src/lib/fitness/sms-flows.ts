/**
 * جریان‌های پیامکی سیستمی فیتاپ — v32
 * هر تابع یک سناریوی پیامک با قالب تأییدشدهٔ sms.ir است.
 * دداپ ابدی و ثبت لاگ داخل sendTemplateSms انجام می‌شود (smsir.ts).
 *
 * نکتهٔ مهم: اگر متغیر env قالب تنظیم نشده باشد یا SMSIR_API_KEY نباشد،
 * ارسال بی‌صدا skip می‌شود و هیچ جریان کسب‌وکاری نمی‌شکند.
 */

import {
  normalizeMobileForSmsIr,
  sendTemplateSms,
  type SendTemplateSmsResult,
  type SmsTemplateKey,
} from "@/lib/fitness/smsir";

/**
 * نام کوچک امن برای پارامتر NAME قالب‌ها — v48: حداکثر ۲۵ کاراکتر
 * (سقف رسمی sms.ir برای مقدار هر پارامتر — خطای 114). گارد مرکزی
 * sendTemplateSms هم کوتاه‌سازی/حذف را تضمین می‌کند.
 * دیریکتیو مالک: اگر نام ثبت نشده باشد رشتهٔ خالی برمی‌گردد (نه «کاربر»)
 * و گارد sendTemplateSms ارسال را مدیریت می‌کند تا هیچ پیامکی با نام جعلی نرود.
 */
export function smsFirstName(name: string | null | undefined): string {
  const first = String(name || "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .split(/\s+/)[0] || "";
  return first.slice(0, 25);
}

export interface SmsUserTarget {
  id: string;
  name?: string | null;
  mobile: string;
}

/**
 * قالب 669068 — کاربر وارد شده، موبایلش ثبت شده و کد OTP گرفته ولی
 * آنبوردینگ را تکمیل نکرده. ۳۰ دقیقه بعد از ثبت موبایل و خروج ارسال می‌شود.
 * متغیر: NAME (نام کاربر)
 * 🩹 v43 — دیریکتیو جدید مالک: برای کاربری که آنبوردینگ را تکمیل نکرده و
 * نام ندارد، پیامک بفرست و به‌جای نام «ورزشکار» بنویس — نه NAME خالی، نه
 * skip. (گارد مرکزی sendTemplateSms هم همین fallback را برای این قالب
 * تضمین می‌کند؛ اینجا صریح نوشته شده تا خوانا باشد.)
 */
export async function sendOnboardingNudgeSms(user: SmsUserTarget): Promise<SendTemplateSmsResult> {
  const res = await sendTemplateSms({
    key: "onboarding_nudge",
    templateEnvKey: "onboarding_nudge",
    mobile: user.mobile,
    params: [{ name: "NAME", value: smsFirstName(user.name) || "ورزشکار" }],
    userId: user.id,
  });
  return res;
}

/**
 * قالب 461291 — کاربر آنبوردینگ را تکمیل کرده ولی پلن نخریده.
 * ۲۴ ساعت بعد از تکمیل آنبوردینگ و عدم خرید ارسال می‌شود.
 * متغیرها: NAME + CODE (کد تخفیف اختصاصی یک‌بارمصرفِ خرید اول)
 */
export async function sendOnboardingWinbackSms(
  user: SmsUserTarget,
  discountCode: string
): Promise<SendTemplateSmsResult> {
  const res = await sendTemplateSms({
    key: "onboarding_winback",
    templateEnvKey: "onboarding_winback",
    mobile: user.mobile,
    params: [
      { name: "NAME", value: smsFirstName(user.name) },
      { name: "CODE", value: discountCode },
    ],
    userId: user.id,
  });
  return res;
}

/**
 * قالب 663678 — برنامه ورزشی کاربر آماده شد و روی پنل قرار گرفت.
 * متغیر: NAME
 *
 * 🩹 v66 — فیکس باگ «پیامک کلاً ارسال نمیشه»: کلید دداپ قبلاً ثابت
 * ("program_ready") بود → هر کاربر فقط اولین برنامهٔ عمرش پیامک می‌گرفت و
 * همهٔ برنامه‌های بعدی (تمدید ۴۵ روزه، تولید مجدد ادمین، watchdog) با
 * already_sent رد می‌شدند. حالا کلید بر «هر چرخهٔ تولید» یکتاست
 * (program_ready_{programRequestId}) — هر برنامهٔ جدید یک پیامک.
 */
export async function sendProgramReadySms(
  user: SmsUserTarget,
  dedupeSuffix?: string
): Promise<SendTemplateSmsResult> {
  const res = await sendTemplateSms({
    key: `program_ready${dedupeSuffix ? `_${dedupeSuffix}` : ""}`,
    templateEnvKey: "program_ready",
    mobile: user.mobile,
    params: [{ name: "NAME", value: smsFirstName(user.name) }],
    userId: user.id,
  });
  return res;
}

/**
 * قالب 761137 — چکاپ کاربر فرا رسیده (همزمان با نوتیف چکاپ).
 * متغیر: NAME
 *
 * 🩹 v66 — همان باگ program_ready: کلید ثابت یعنی چکاپ‌های روز ۱۵/۳۰/۴۰ فقط
 * «یک بار در عمر» پیامک می‌رفتند و در دورهٔ بعدی ۴۵ روزه هرگز. کلید حالا
 * بر (شروع دوره + شمارهٔ چکاپ) یکتاست — checkup_reminder_{cycle}_{phase}.
 */
export async function sendCheckupReminderSms(
  user: SmsUserTarget,
  dedupeSuffix?: string
): Promise<SendTemplateSmsResult> {
  const res = await sendTemplateSms({
    key: `checkup_reminder${dedupeSuffix ? `_${dedupeSuffix}` : ""}`,
    templateEnvKey: "checkup_reminder",
    mobile: user.mobile,
    params: [{ name: "NAME", value: smsFirstName(user.name) }],
    userId: user.id,
  });
  return res;
}

/**
 * قالب 184777 — یک روز تا انقضای پلن (v37 — درخواست مالک)
 * متن قالب: «پلن فعلی شما فردا منقضی میشود. از لینک زیر میتوانید مبلغ تمدید را
 * پرداخت کنید تا پلن جدید بصورت خودکار برایتان فعال شود. https://fittup.ir/#LINK#»
 * متغیرها: NAME + LINK (بخش انتهای لینک تمدید مجزا — renew?t=...)
 * دداپ: کلید plan_expiring_{subscriptionId} — هر چرخهٔ اشتراک فقط یک بار.
 */
export async function sendPlanExpiringSoonSms(
  user: SmsUserTarget,
  renewLink: string,
  dedupeSuffix?: string
): Promise<SendTemplateSmsResult> {
  const key = `plan_expiring${dedupeSuffix ? `_${dedupeSuffix}` : ""}`;
  const attempts: Array<Array<{ name: string; value: string }>> = [
    [
      { name: "NAME", value: smsFirstName(user.name) },
      { name: "LINK", value: renewLink },
    ],
    [{ name: "NAME", value: smsFirstName(user.name) }],
    [],
  ];
  let last: SendTemplateSmsResult = { sent: false, error: "no attempt" };
  for (const params of attempts) {
    last = await sendTemplateSms({
      key,
      templateEnvKey: "plan_expiring_soon",
      mobile: user.mobile,
      params,
      userId: user.id,
    });
    if (last.sent) return last;
    if (
      last.skipped === "already_sent" ||
      last.skipped === "no_template" ||
      last.skipped === "invalid_mobile" ||
      last.skipped === "no_name"
    ) {
      return last;
    }
  }
  return last;
}

/**
 * قالب 322780 — پلن کاربر منقضی شد (v37 — متن جدید با لینک تمدید مجزا)
 * متن قالب: «پلن فعلی شما منقضی شده، برای تمدید و دریافت برنامه جدید وارد
 * لینک زیر شوید و پرداخت را تکمیل کنید. https://fittup.ir/#LINK#»
 * متغیرها: NAME + LINK (لینک تمدید مجزا — صفحهٔ /renew بدون نیاز به لاگین)
 * دداپ: کلید plan_expired_{subscriptionId} — هر چرخهٔ اشتراک یک پیامک.
 */
export async function sendPlanExpiredSms(
  user: SmsUserTarget,
  renewLink?: string,
  dedupeSuffix?: string
): Promise<SendTemplateSmsResult> {
  const key = `plan_expired${dedupeSuffix ? `_${dedupeSuffix}` : ""}`;
  const fullName = smsFirstName(user.name);
  const attempts: Array<Array<{ name: string; value: string }>> =
    renewLink
      ? [
          [
            { name: "NAME", value: fullName },
            { name: "LINK", value: renewLink },
          ],
          [{ name: "NAME", value: fullName }],
          [],
        ]
      : [[{ name: "NAME", value: fullName }], []];
  let last: SendTemplateSmsResult = { sent: false, error: "no attempt" };
  for (const params of attempts) {
    last = await sendTemplateSms({
      key,
      templateEnvKey: "plan_expired",
      mobile: user.mobile,
      params,
      userId: user.id,
    });
    if (last.sent) return last;
    if (
      last.skipped === "already_sent" ||
      last.skipped === "no_template" ||
      last.skipped === "invalid_mobile" ||
      last.skipped === "no_name"
    ) {
      return last;
    }
  }
  return last;
}

/**
 * قالب 852193 — دعوت دوست (کاربر نام و شمارهٔ دوستش را وارد می‌کند).
 * متغیرها: NAME (نام دوست/دعوت‌شونده) + LINK (بخش انتهای لینک دعوت دعوت‌کننده —
 * قالب به‌صورت https://fittup.ir/#LINK# است، پس LINK = «?ref=FIT-XXXXXX»)
 * ⚠️ این سناریو user-triggered است؛ دداپ به‌صورت (mobile, invite_friend_{inviterId})
 * است تا هر دعوت‌کننده فقط یک بار بتواند به یک شماره دعوت بفرستد.
 */
export async function sendInviteFriendSms(opts: {
  inviterUserId: string;
  friendMobile: string;
  friendName: string;
  referralCode: string;
}): Promise<SendTemplateSmsResult> {
  const res = await sendTemplateSms({
    key: `invite_friend_${opts.inviterUserId}`,
    templateEnvKey: "invite_friend",
    mobile: opts.friendMobile,
    params: [
      { name: "NAME", value: smsFirstName(opts.friendName) },
      // v56: لینک هوشمند — قبلاً «?ref=...» خام بود که همیشه مرورگر باز می‌کرد
      // (شکایت مالک). حالا مسیر /go با intent:// اول اپ را صدا می‌زند و در
      // نبود اپ به وب برمی‌گردد. متن قالب در پنل ثابت است: fittup.ir/#LINK#
      { name: "LINK", value: `go/plans?ref=${opts.referralCode}` },
    ],
    userId: opts.inviterUserId,
  });
  return res;
}

/**
 * قالب 604678 — ۷۲ ساعت (۳ روز) از انقضای پلن گذشته و تمدید نکرده (v37).
 * متن قالب: «سه روزه که پلن شما منقضی شده و تمدید نکردید. نکنه از هدفت جا بمونی.
 * کد تخفیف: #CODE# لینک تمدید: https://fittup.ir/#LINK#»
 * متغیرها: NAME + CODE (کد تخفیف اختصاصی) + LINK (لینک تمدید مجزا)
 * دقیقاً همزمان با نوتیف renewal_late (هر دو در پنجرهٔ ۷۲ ساعت) ارسال می‌شود.
 * دداپ: کلید expired_winback_{subscriptionId} — هر چرخهٔ انقضا یک بار.
 */
export async function sendExpiredWinbackSms(
  user: SmsUserTarget,
  discountCode: string,
  renewLink?: string,
  dedupeSuffix?: string
): Promise<SendTemplateSmsResult> {
  const key = `expired_winback${dedupeSuffix ? `_${dedupeSuffix}` : ""}`;
  const attempts: Array<Array<{ name: string; value: string }>> = [
    renewLink
      ? [
          { name: "NAME", value: smsFirstName(user.name) },
          { name: "CODE", value: discountCode },
          { name: "LINK", value: renewLink },
        ]
      : [
          { name: "NAME", value: smsFirstName(user.name) },
          { name: "CODE", value: discountCode },
        ],
    [
      { name: "NAME", value: smsFirstName(user.name) },
      { name: "CODE", value: discountCode },
    ],
    [{ name: "NAME", value: smsFirstName(user.name) }],
  ];
  let last: SendTemplateSmsResult = { sent: false, error: "no attempt" };
  for (const params of attempts) {
    last = await sendTemplateSms({
      key,
      templateEnvKey: "expired_winback",
      mobile: user.mobile,
      params,
      userId: user.id,
    });
    if (last.sent) return last;
    if (
      last.skipped === "already_sent" ||
      last.skipped === "no_template" ||
      last.skipped === "invalid_mobile" ||
      last.skipped === "no_name"
    ) {
      return last;
    }
  }
  return last;
}

/**
 * قالب 612964 — پیامک خوش‌آمدگویی خرید (v47 — دیریکتیو مالک)
 * دقیقاً ۸ روز بعد از ثبت شماره موبایل در سایت، برای کاربری که هنوز
 * چیزی نخریده ارسال می‌شود و کاربر را به صفحهٔ پلن‌ها برمی‌گرداند.
 *
 * متن قالب (پنل sms.ir — لینک ثابت دارد، متغیر LINK ندارد):
 *   #NAME# عزیز / با فیتاپ زندگی ورزشیتو متحول کن. / ... / کد تخفیف: #CODE#
 *   لینک: https://fittup.ir/go/plans   ← لینک هوشمند: اپ نصب بود → اپ باز می‌شود
 *
 * دیریکتیو صریح مالک برای NAME:
 *   «اگر کاربر آنبوردینگ رو تکمیل نکرده بود بجای متغیر نیم باید بنویسی
 *    ورزشکار و در صورت تکمیل اسمش رو.»
 * → اینجا NAME صریح پر می‌شود + گارد مرکزی sendTemplateSms هم برای همین
 *   قالب fallback «ورزشکار» را تضمین می‌کند.
 *
 * CODE: کد تخفیف اختصاصی کاربر (reason=welcome_offer، درصد از تنظیم
 * welcome_offer_discount_percent — پیش‌فرض ۳۰٪، قابل تغییر در پنل مدیر).
 * دداپ: کلید welcome_offer — هر کاربر فقط یک بار در عمر سیستم.
 */
export async function sendWelcomeOfferSms(
  user: SmsUserTarget,
  discountCode: string,
  displayName: string
): Promise<SendTemplateSmsResult> {
  const res = await sendTemplateSms({
    key: "welcome_offer",
    templateEnvKey: "welcome_offer",
    mobile: user.mobile,
    params: [
      { name: "NAME", value: displayName || "ورزشکار" },
      { name: "CODE", value: discountCode },
    ],
    userId: user.id,
  });
  return res;
}

/**
 * قالب 883325 — تقویت تمدید (v47 — دیریکتیو مالک)
 * ۸ روز از انقضای پلن گذشته و کاربر تمدید نکرده — همان خانوادهٔ 604678 ولی
 * دیرتر و با لینک هوشمند: کاربر را به «بخش تمدید» با قیمت‌های تخفیف‌خورده
 * می‌برد (متن بخش تمدید با این پیامک سینک است).
 *
 * متن قالب (پنل sms.ir):
 *   فیتاپ / #NAME# عزیز / ۸ روز از زمان تمدید پلنت گذشته، ...
 *   کد تخفیف: #CODE# / لینک: https://fittup.ir/#LINK#
 * → LINK = «go/renew?t=...» (نسبی؛ دامنه در متن قالب است) — صفحهٔ /go اپ را
 *   باز می‌کند و اگر اپ نبود مستقیم به تمدید وب fallback می‌شود.
 *
 * CODE: همان کد renewal_loyalty کاربر (ensureRenewalDiscountCode) — پس
 * درصد پیامک و صفحهٔ تمدید همیشه یکی است. درصد از تنظیم
 * expiry_discount_percent (پیش‌فرض ۳۰٪ v47، قابل تغییر در پنل مدیر).
 * دداپ: کلید renewal_boost_{cycleId} — هر چرخهٔ انقضا فقط یک بار.
 */
export async function sendRenewalBoostSms(
  user: SmsUserTarget,
  discountCode: string,
  renewLink: string,
  dedupeSuffix?: string
): Promise<SendTemplateSmsResult> {
  const key = `renewal_boost${dedupeSuffix ? `_${dedupeSuffix}` : ""}`;
  const attempts: Array<Array<{ name: string; value: string }>> = [
    [
      { name: "NAME", value: smsFirstName(user.name) },
      { name: "CODE", value: discountCode },
      { name: "LINK", value: renewLink },
    ],
    [
      { name: "NAME", value: smsFirstName(user.name) },
      { name: "CODE", value: discountCode },
    ],
    [{ name: "NAME", value: smsFirstName(user.name) }],
  ];
  let last: SendTemplateSmsResult = { sent: false, error: "no attempt" };
  for (const params of attempts) {
    last = await sendTemplateSms({
      key,
      templateEnvKey: "renewal_boost",
      mobile: user.mobile,
      params,
      userId: user.id,
    });
    if (last.sent) return last;
    if (
      last.skipped === "already_sent" ||
      last.skipped === "no_template" ||
      last.skipped === "invalid_mobile" ||
      last.skipped === "no_name"
    ) {
      return last;
    }
  }
  return last;
}

/**
 * پیامک «برنامه آماده شد» (قالب 663678) با واکشی خودکار کاربر.
 * در همهٔ نقاطی که وضعیت ProgramRequest به ready می‌رسد صدا زده می‌شود:
 * تولید پس‌زمینه، recover watchdog، تایید ادمین، تمدید/فعال‌سازی ادمین.
 *
 * v66 — cycleKey (شناسهٔ ProgramRequest) الزاماً پاس داده شود تا دداپ
 * «هر برنامه یک پیامک» باشد نه «یک پیامک در عمر کاربر».
 */
export async function notifyProgramReadySms(
  userId: string,
  cycleKey?: string
): Promise<void> {
  try {
    const user = await (await import("@/lib/db")).db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, mobile: true },
    });
    if (!user) return;
    await sendProgramReadySms(user, cycleKey);
  } catch (e) {
    console.warn("[notifyProgramReadySms] failed (non-blocking):", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// پیامک‌های خرید موفق (v33) — بلافاصله بعد از تأیید پرداخت درگاه
// ═══════════════════════════════════════════════════════════════════════════
// درخواست مالک: «به محض خرید، یعنی کاربر تا درگاه پرداخت پرداختش رو انجام داد
// و سایت ما دریافتش کرد، این پیامک ارسال بشه.»
//
//   423726 → پلن پیشرفته  (advanced)
//   612405 → پلن حرفه‌ای  (ultimate)
//   565185 → پلن اقتصادی + استاندارد (basic / standard — هر دو یک قالب)
//
// نقطهٔ اتصال: deliverPlanPayment در payment-delivery.ts (پس از موفقیت تراکنش
// و نوتیف خرید موفق). خرید کیف‌پول هم از همین مسیر می‌گذارد.
// FIX (v51 — اصلاح کامنت کهنه v36): خرید کافه‌بازار هم از v36 به بعد همان
// جریان درگاه را دارد و پیامک خرید می‌فرستد (api/payment/bazaar/purchase →
// notifyPlanPurchaseSms) — جملهٔ قدیمی «خرید بازار پیامک نمی‌فرستد» منسوخ است.
//
// دداپ: کلید یکتا = purchase_{planId}_{paymentId} →
//   - verify تکراری همان پرداخت هرگز دوباره نمی‌فرستد (همان کلید، status=sent)
//   - تمدید/خرید بعدی کلید جدید دارد → پیامک جدید می‌رود (هر خرید موفق یک پیامک)
//
// خودترمیم پارامتر: مالک متغیرهای این سه قالب را اعلام نکرده است. تلاش اول با
// NAME فرستاده می‌شود؛ اگر قالب متغیر نداشته باشد و sms.ir خطا بدهد، تلاش دوم
// بدون هیچ پارامتری انجام می‌شود — در هر دو حالت پیامک تحویل می‌شود.

/** نگاشت planId → templateEnvKey پیامک خرید (null = پلن ناشناخته، بی‌صدا) */
export function purchaseSmsTemplateForPlan(planId: string): SmsTemplateKey | null {
  switch (planId) {
    case "advanced":
      return "purchase_advanced"; // 423726
    case "ultimate":
      return "purchase_ultimate"; // 612405
    case "basic":
    case "standard":
      return "purchase_basic"; // 565185 — هر دو پلن یک قالب
    default:
      return null;
  }
}

/**
 * ارسال پیامک خرید موفق برای کاربر/پلن/پرداخت داده‌شده.
 * غیرمسدودکننده و بی‌خطر — هر خطایی فقط log می‌شود و هرگز تأثیری روی
 * تحویل پلن ندارد.
 */
export async function notifyPlanPurchaseSms(
  userId: string,
  planId: string,
  paymentId: string
): Promise<void> {
  try {
    const templateEnvKey = purchaseSmsTemplateForPlan(planId);
    if (!templateEnvKey) return;

    const user = await (await import("@/lib/db")).db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, mobile: true },
    });
    if (!user?.mobile) return;

    const key = `purchase_${planId}_${paymentId}`;

    // تلاش ۱ — با NAME (اگر قالب متغیر داشته باشد درست پر می‌شود)
    const first = await sendTemplateSms({
      key,
      templateEnvKey,
      mobile: user.mobile,
      params: [{ name: "NAME", value: smsFirstName(user.name) }],
      userId,
    });
    if (first.sent) return;

    // already_sent → verify تکراری همان پرداخت (طبیعی، پیامک قبلاً رفته)
    // no_template / invalid_mobile / no_name → خطای پیکربندی/ورودی؛ تلاش مجدد بی‌فایده
    if (
      first.skipped === "already_sent" ||
      first.skipped === "no_template" ||
      first.skipped === "invalid_mobile" ||
      first.skipped === "no_name"
    ) {
      return;
    }

    // تلاش ۲ (خودترمیم) — احتمالاً قالب متغیر ندارد و خطای پارامتر خورده؛
    // بدون هیچ پارامتری دوباره تلاش کن (داپ: رکورد failed به sent ارتقا می‌یابد)
    await sendTemplateSms({
      key,
      templateEnvKey,
      mobile: user.mobile,
      params: [],
      userId,
    });
  } catch (e) {
    console.warn("[notifyPlanPurchaseSms] failed (non-blocking):", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// پیامک‌های v36 — ارتقای پلن + شارژ کیف پول
// ═══════════════════════════════════════════════════════════════════════════
// درخواست مالک (v36):
//   • قالب 275042 — ارتقا از اقتصادی/استاندارد به پیشرفته/حرفه‌ای
//     متن: «فیتاپ\n#NAME# عزیز\nپلن شما از #PLANBASE# به #PLANUPDATE# تغییر کرد.
//           برای تکمیل پیش نیازهای طراحی برنامه به داشبورد خود مراجعه کنید.»
//   • قالب 324322 — فقط ارتقا از اقتصادی به استاندارد (همان الگوی متغیرها)
//   • قالب 556023 — شارژ کیف پول بعد از تأیید پرداخت توسط سایت
//
// نام پلن‌ها از PLAN_LABELS (فارسی): اقتصادی / استاندارد / پیشرفته / حرفه‌ای

/** انتخاب قالب ارتقا بر اساس پلن پایه و پلن جدید (null = سناریوی ارتقا نیست) */
export function planUpgradeSmsTemplateFor(
  basePlanId: string,
  newPlanId: string
): SmsTemplateKey | null {
  const premium: string[] = ["advanced", "ultimate"];
  if (["basic", "standard"].includes(basePlanId) && premium.includes(newPlanId)) {
    return "plan_upgrade_premium"; // 275042
  }
  if (basePlanId === "basic" && newPlanId === "standard") {
    return "plan_upgrade_standard"; // 324322
  }
  return null;
}

/**
 * ارسال پیامک ارتقای پلن (قالب 275042 / 324322) — از مسیر تحویل پرداخت صدا زده می‌شود
 * وقتی کاربر با اشتراک فعالِ پلن دیگری، پلن بالاتری خریده است.
 * دداپ: کلید یکتا = plan_upgrade_{newPlanId}_{paymentId}
 * غیرمسدودکننده و بی‌خطر — هر خطایی فقط log می‌شود.
 */
export async function notifyPlanUpgradeSms(
  userId: string,
  basePlanId: string,
  newPlanId: string,
  paymentId: string
): Promise<void> {
  try {
    const templateEnvKey = planUpgradeSmsTemplateFor(basePlanId, newPlanId);
    if (!templateEnvKey) return;

    const { PLAN_LABELS } = await import("@/lib/fitness/types");
    const baseLabel = PLAN_LABELS[basePlanId as keyof typeof PLAN_LABELS] ?? basePlanId;
    const newLabel = PLAN_LABELS[newPlanId as keyof typeof PLAN_LABELS] ?? newPlanId;

    const user = await (await import("@/lib/db")).db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, mobile: true },
    });
    if (!user?.mobile) return;

    const key = `plan_upgrade_${newPlanId}_${paymentId}`;
    const fullParams = [
      { name: "NAME", value: smsFirstName(user.name) },
      { name: "PLANBASE", value: baseLabel },
      { name: "PLANUPDATE", value: newLabel },
    ];

    // تلاش ۱ — با هر سه متغیر (الگوی اعلام‌شدهٔ مالک)
    const first = await sendTemplateSms({
      key,
      templateEnvKey,
      mobile: user.mobile,
      params: fullParams,
      userId,
    });
    if (first.sent) return;
    if (
      first.skipped === "already_sent" ||
      first.skipped === "no_template" ||
      first.skipped === "invalid_mobile" ||
      first.skipped === "no_name"
    ) {
      return;
    }

    // تلاش ۲ (خودترمیم) — قالب متغیر ندارد → بدون پارامتر
    await sendTemplateSms({ key, templateEnvKey, mobile: user.mobile, params: [], userId });
  } catch (e) {
    console.warn("[notifyPlanUpgradeSms] failed (non-blocking):", e);
  }
}

/**
 * ارسال پیامک شارژ کیف پول (قالب 556023) — بعد از تأیید پرداخت توسط سایت.
 * متغیر قالب در پنل اعلام نشده → نردبان خودترمیم:
 *   [NAME + AMOUNT] → [NAME] → []  (اولین ترکیبِ موفق تحویل می‌شود)
 * دداپ: کلید یکتا = wallet_topup_{paymentId} — verify تکراری هرگز دوباره نمی‌فرستد.
 */
export async function notifyWalletTopupSms(
  userId: string,
  amountToman: number,
  paymentId: string
): Promise<void> {
  try {
    const user = await (await import("@/lib/db")).db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, mobile: true },
    });
    if (!user?.mobile) return;

    const key = `wallet_topup_${paymentId}`;
    const attempts: Array<Array<{ name: string; value: string }>> = [
      [
        { name: "NAME", value: smsFirstName(user.name) },
        { name: "AMOUNT", value: amountToman.toLocaleString("en-US") },
      ],
      [{ name: "NAME", value: smsFirstName(user.name) }],
      [],
    ];

    for (const params of attempts) {
      const res = await sendTemplateSms({
        key,
        templateEnvKey: "wallet_topup",
        mobile: user.mobile,
        params,
        userId,
      });
      if (res.sent) return;
      if (
        res.skipped === "already_sent" ||
        res.skipped === "no_template" ||
        res.skipped === "invalid_mobile" ||
        res.skipped === "no_name"
      ) {
        return;
      }
      // خطای پارامتر احتمالی → ترکیب بعدی
    }
  } catch (e) {
    console.warn("[notifyWalletTopupSms] failed (non-blocking):", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v53 — پیامک «ترک درگاه پرداخت» (سناریوی abandoned_cart — درخواست مالک)
// ═══════════════════════════════════════════════════════════════════════════
// کاربری که پرداخت درگاه (زرین‌پال) را شروع کرده و رها کرده، با «کد ۲۴۸۹۴۵»
// (درصد از SiteSetting abandoned_cart_discount_percent — پیش‌فرض ۱۰٪) و
// اعتبار ۲ ساعت به صفحهٔ پلن‌ها برمی‌گردد. کد نمایشی همیشه «248945» است ولی
// کد داخلی یکتا (248945-XXXXX) در UserDiscountCode با reason=abandoned_cart
// ساخته می‌شود (notifications.ensureAbandonedCartCode).
//
// متن دقیق (NAME/LINK جایگزین می‌شوند — درصد داخل متن از تنظیم ساخته می‌شود
// و «دو ساعت» ثابت می‌ماند):
//
//   فیتاپ
//   #NAME# عزیز
//   با 10 درصد تخفیف تا دو ساعت آینده میتونی خریدتو نهایی کنی و برنامه بدنسازی مختص به خودتو بگیری.
//
//   لینک پرداخت:
//   https://fittup.ir/#LINK#
//
//   هر بدنی فیتاپ میخواد!
//
// ارسال فقط با قالب (v61 — دیریکتیو مالک: «همهٔ پیامک‌ها تحویل قالبی است نه
// بولک»؛ خط خدماتی +98500033003 با bulk کار نمی‌کند — مسیر متن آزاد حذف شد):
//   قالب از env SMSIR_ABANDONED_CART_TEMPLATE_ID (۲۴۸۹۴۵) یا SiteSetting
//   abandoned_cart_sms_template_id با نردبان خودترمیم [NAME+LINK] → [NAME] → [].
//   شکست قالب → رکورد failed در SmsLog (sweep بعدی دوباره تلاش می‌کند).
// دداپ ابدی: SmsLog (mobile, key) — key = abandoned_cart_{paymentId}
// (داپ دائمی per-payment؛ حتی بعد از ری‌استارت/بک‌فیل هرگز تکراری نمی‌شود).

// v61 — تابع ساخت «متن آزاد» پیامک (bulk) حذف شد: پیامک ترک خرید فقط با
// قالب ۲۴۸۹۴۵ پنل sms.ir ارسال می‌شود (متن قالب داخل پنل تعریف شده است).

export interface AbandonedCartSmsOptions {
  user: SmsUserTarget;
  /** کلید دداپ — abandoned_cart_{paymentId} */
  dedupeKey: string;
  /** لینک کوتاه نسبی مثل r/XXXXXXXX (خروجی createSmsShortLink) */
  link: string;
  /** v61 — با حذف مسیر متن آزاد دیگر استفاده نمی‌شود (برای سازگاری call-site) */
  percent?: number;
  /** شناسه قالب sms.ir (env/SiteSetting) — قالبی الزامی است (v61) */
  templateId: string | null;
}

export interface AbandonedCartSmsResult {
  sent: boolean;
  /** کدام مسیر تحویل داد (v61: فقط قالب — bulk حذف شد) */
  via?: "template";
  /** already_sent = دداپ قبلی (هرگز دوباره نفرست) */
  skipped?: "already_sent" | "invalid_mobile";
  error?: string;
}

/** رکورد failed در SmsLog (best-effort — هرگز نتیجهٔ ارسال را تغییر نمی‌دهد) */
async function recordAbandonedCartFailure(
  normalizedMobile: string,
  dedupeKey: string,
  templateId: string,
  userId: string | null | undefined,
  error: string
): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.smsLog.upsert({
      where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
      create: {
        mobile: normalizedMobile,
        key: dedupeKey,
        templateId: templateId || "template",
        userId: userId ?? null,
        status: "failed",
        error,
      },
      update: {
        status: "failed",
        error,
      },
    });
  } catch (e) {
    console.warn("[sendAbandonedCartSms] failed-record upsert error:", e);
  }
}

/**
 * ارسال پیامک ترک درگاه — فقط با قالب sms.ir (نردبان خودترمیم پارامترها).
 * v61: مسیر bulk/متن آزاد حذف شد (دیریکتیو مالک + خط خدماتی که bulk را
 * پشتیبانی نمی‌کند). شکست قالب = رکورد failed و تلاشِ sweep بعدی.
 */
export async function sendAbandonedCartSms(
  opts: AbandonedCartSmsOptions
): Promise<AbandonedCartSmsResult> {
  const { user, dedupeKey, link, templateId } = opts;

  const normalized = normalizeMobileForSmsIr(user.mobile);
  if (!/^9\d{9}$/.test(normalized)) {
    return { sent: false, skipped: "invalid_mobile", error: `شماره نامعتبر: ${normalized}` };
  }

  const name = smsFirstName(user.name);

  // ─── مسیر واحد — قالب sms.ir (v61: قالبی الزامی؛ bulk حذف شد) ───
  const templateIdSafe = templateId?.trim() || "";
  if (!templateIdSafe) {
    const noTpl =
      "شناسه قالب ترک خرید تنظیم نیست (SMSIR_ABANDONED_CART_TEMPLATE_ID یا SiteSetting: abandoned_cart_sms_template_id) — پیامک قالبی ارسال نشد.";
    console.warn(`[sendAbandonedCartSms] (key=${dedupeKey}) ${noTpl}`);
    await recordAbandonedCartFailure(normalized, dedupeKey, "", user.id, noTpl);
    return { sent: false, error: noTpl };
  }

  // نردبان خودترمیم پارامترهای قالب: [NAME+LINK] → [NAME] → []
  const attempts: Array<Array<{ name: string; value: string }>> = [
    [
      { name: "NAME", value: name },
      { name: "LINK", value: link },
    ],
    [{ name: "NAME", value: name }],
    [],
  ];
  let last: SendTemplateSmsResult = { sent: false, error: "no attempt" };
  for (const params of attempts) {
    last = await sendTemplateSms({
      key: dedupeKey,
      templateEnvKey: undefined,
      templateIdOverride: templateIdSafe,
      mobile: user.mobile,
      params,
      userId: user.id,
    });
    if (last.sent) return { sent: true, via: "template" };
    if (last.skipped === "already_sent" || last.skipped === "invalid_mobile") {
      return {
        sent: false,
        skipped: last.skipped === "invalid_mobile" ? "invalid_mobile" : "already_sent",
        error: last.error,
      };
    }
    // no_template / no_name / خطای درگاه → رانگ بعدی نردبان
  }

  // ─── شکست نهایی قالب — رکورد failed برای دیده‌شدن؛ sweep بعدی دوباره تلاش می‌کند ───
  // (sendTemplateSms خودش در هر تلاش رکورد ثبت می‌کند؛ این upsert فقط گارانتی
  //  می‌کند که حتماً یک رکورد failed با آخرین خطا موجود باشد.)
  await recordAbandonedCartFailure(
    normalized,
    dedupeKey,
    templateIdSafe,
    user.id,
    last.error ?? "abandoned_cart sms failed"
  );

  return { sent: false, error: last.error ?? "abandoned_cart sms failed" };
}
