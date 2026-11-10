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
 *  ۴) زمان تهران بین ۱۰:۰۰ تا ۲۲:۰۰ — v217: بیرون از این بازه نامزد «صفِ صبح»
 *     می‌شود (پایین را ببینید)؛ دیگر سکوتِ خاموش نیست.
 *  ۵) SmsLog key=abandoned_cart_{paymentId} قبلاً sent نیست (داپ دائمی per-payment)
 *  ۶) حداکثر یک پیام ترک-درگاه در ۷ روز برای هر کاربر (جستجوی SmsLog با
 *     کلیدهای abandoned_cart_* در ۷ روز اخیر)
 *  ۷) سازگاری با ماهیت «خرید اول» کد (first-purchase gate موجود): کاربرِ دارای
 *     هر نوع اشتراک (حتی منقضی) نامزد نمی‌شود — کد تخفیفِ ترک-درگاه فقط برای
 *     اولین خرید قابل استفاده است و ارسال آن به تمدیدکننده‌ها بن‌بست UX می‌سازد.
 *
 * ─── v217 — دیریکتیو مالک (پس از ممیزی دیتابیس تولیدی): «هر جفتش اضافه کن» ───
 * ممیزی تولیدی (2026-10-07) نشان داد ۸ پرداخت‌نشدهٔ شب‌هنگام (۲۱:۴۲ تا ۰۲:۲۵
 * تهران) پیامک ۱۰٪ نگرفتند چون نقطهٔ +۳۰دقیقه‌شان بیرون پنجرهٔ ۱۰–۲۲ بود و
 * «حمل به صبح» عملاً بی‌صدا و نامطمئن بود. دو فیکس، هر دو:
 *
 *  ① حمل صریح شب‌به‌صبح (قطع گپ): هر نامزدی که «همهٔ شروط ۰..۳ و ۵..۷» را دارد
 *     و فقط ساعتِ تهران مانع است، به‌جای سکوت با status="queued" در SmsLog
 *     (همان کلید دداپ per-payment → idempotent) برای صبح علامت می‌خورد.
 *     اولین جاروی بعد از ۱۰:۰۰ تهران آن را می‌فرستد. صف روی دیسک است —
 *     ری‌استارت سرور آن را نمی‌کُشد. (پرداخت شب ۲۱:۴۲ → صبح ۱۰:۰۰–۱۰:۰۵ می‌رسد.)
 *
 *  ② کد تخفیف هرگز شب ساخته نمی‌شود (گارانتی مالک: «کد تخفیف هم باید صبح ایجاد
 *     بشه — نباشه که شب کد ساخته بشه، صبح پیامک بره و کد اجرا نشه»):
 *     در لحظهٔ صف‌شدن شب، فقط ردیف SmsLog ساخته می‌شود — نه کد تخفیف، نه لینک.
 *     کد ۲ساعته دقیقاً در لحظهٔ ارسالِ صبح ساخته می‌شود. برای مصونیت از هر
 *     تغییر آیندهٔ مدت اعتبار، ensureAbandonedCartCode با minCreatedAt=شروع
 *     پنجرهٔ ۱۰:۰۰ امروز تهران صدا زده می‌شود: هر کدِ قدیمی‌تر از امروزِ صبح
 *     (مثلاً ساخته‌شدهٔ شبِ قبل) عمداً نادیده گرفته می‌شود و کد تازه ساخته می‌شود.
 *
 *  ③ لاگِ دیده‌شدن skipها (پایان «سکوت خاموش»): نتیجهٔ هر sweep اکنون تفکیک
 *     کامل دلیل‌ها (result.skipped) را دارد + هر رویداد واقعی (ارسال/صف‌شدن/
 *     بسته‌شدن صف/شکست) یک خط [abandoned-cart] در لاگ سرور می‌نویسد. حالت‌های
 *     تکراریِ عادی (همان‌قدیم ماندن در صف، داپِ ارسال‌شدهٔ قبل) عمداً لاگ نمی‌شوند
 *     تا لاگ pm2 در شب‌های بی‌رویداد اسپم نشود.
 *     صف‌های بی‌صاحب (پرداخت ماندهٔ بیرون پنجرهٔ ۲۴ساعته/پرداخته‌شده) با
 *     housekeeping هر sweep بسته می‌شوند (status="skipped" + دلیل) — در ممیزی
 *     پنل هم قابل دیدن‌اند.
 *
 * تنظیمات:
 *  • abandoned_cart_enabled (پیش‌فرض "1") — "0" = کل سناریو skip
 *  • abandoned_cart_discount_percent (پیش‌فرض "10")
 *  • کد قالب پیامک: اول env SMSIR_ABANDONED_CART_TEMPLATE_ID (v55 — هماهنگ با
 *    بقیهٔ پیامک‌ها که کدشان در env است)، بعد SiteSetting
 *    abandoned_cart_sms_template_id؛ خالی = ارسال نمیشود (v61 — مسیر bulk حذف
 *    شد؛ همهٔ پیامک‌ها تحویل قالبی هستند)
 *
 * ─── v232 — ممیزی تولیدی 2026-10-12 (پرسش مالک: «مگه ارسال نشده برای رهاکننده‌ها؟») ───
 * ممیزی SmsLog/Payment نشان داد ۳۱ پرداختِ رهاشدهٔ ۷روزه فقط ۱۹ پیامک گرفتند و
 * ریشهٔ همهٔ جاافتادگی‌های واقعی، گیتِ بوتِ v60 است که با دیپلویِ پرتکرار قربانی می‌سازد:
 *  ① سه پرداخت شب‌هنگام (۱٫۷۸M + ۳۵۰k + ۸۰۰k تومان) برای صبح «صف شدند» ولی
 *     جاروی صبحِ بعد، چون بینِ صف‌شدن و ۱۰:۰۴ دیپلوی/ری‌استارت رخ داده بود،
 *     هرگز آنها را ندید (createdAt < bootAt → نامرئی) → صف تا ۲۶ ساعت ماند و
 *     housekeeping آن را expired_queue بست. یعنی «قولِ صبح» با دیپلویِ نیمه‌شب نقض می‌شد.
 *  ② پرداخت‌های شبِ دورهٔ دیپلویِ پرتکرار (مهر ۵ تا ۹) حتی به صف هم نرسیدند:
 *     اولین جاروی بعد از +۳۰دقیقه‌شان پس از یک ری‌استارت تازه بود → گیت بوت
 *     آنها را نامرئی کرد. (اکثراً بعدها وین‌بکِ ۲۴ساعته نجاتشان داد — ولی این
 *     جایگزینِ پیامکِ ۳۰دقیقه‌ای نیست.)
 * سه فیکس، هر سه:
 *  ① گریسِ ۶۰دقیقه‌ای گیت بوت: پرداخت‌هایی که حداکثر ۶۰ دقیقه قبل از دیپلوی ساخته
 *     شده‌اند همچنان نامزد می‌شوند (اولین جاروی بعد از دیپلوی، پیامکشان می‌رود؛
 *     تأخیرشان به‌جای ۳۰دقیقه حداکثر ~۶۵دقیقه می‌شود). «ضد بک‌لاگ»ِ v60 محفوظ
 *     می‌ماند — انبوهِ معلق‌های قدیمی‌تر از ۶۰ دقیقه هرگز بعد از دیپلوی پیامک
 *     انبوه نمی‌گیرند.
 *  ② صفِ شب معاف از گیت بوت: هر پرداختی که ردیف SmsLog «queued» دارد، در همان
 *     پنجرهٔ ۲۴ساعته مستقل از bootAt دوباره به نامزدها اضافه می‌شود تا اولین
 *     جاروی بعد از ۱۰:۰۰ حتماً بفرستدش. دیپلویِ نیمه‌شب دیگر قولِ صبح را باطل نمی‌کند.
 *  ③ هر پرداخت در try/catch خودش: یک پرداختِ مسموم (خطای پیش‌بینی‌نشدهٔ وسط حلقه)
 *     دیگر کل sweep و نامزدهای بعد از خودش را نمی‌کُشد؛ + شکستِ ارسالِ قالبی
 *     هم دیگر بی‌صدا نیست — رکورد failed در SmsLog می‌ماند (در ممیزی پنل
 *     دیده می‌شود؛ روی retry اثری ندارد چون فقط status=sent داپ می‌شمارد).
 */

import { db } from "@/lib/db";
import {
  ensureAbandonedCartCode,
  getAbandonedCartDiscountPercent,
} from "@/lib/fitness/notifications";
import { normalizeMobileForSmsIr } from "@/lib/fitness/smsir";
import { sendAbandonedCartSms } from "@/lib/fitness/sms-flows";
import { createSmsShortLink } from "@/lib/fitness/sms-short-link";
// v265 — دیرکتیو مالک: «تخفیف ۱۰٪ صفحهٔ تحلیل تا زمانی که کاربر در صفحهٔ تحلیل
// است فعاله و اون بازهٔ دو ساعته بعد از ارسال پیامک عدم خرید و ترک خرید»
import { recordFunnelEvent } from "@/lib/analytics/funnel";

/**
 * v265 — تخفیف ۱۰٪ صفحهٔ تحلیل در بازهٔ دو ساعتهٔ پس از پیامک ترک خرید.
 *
 * دیرکتیو مالک: تخفیف ۱۰٪ صفحهٔ تحلیل (v197) دو حالت فعال دارد:
 *   ① تا زمانی که کاربر در صفحهٔ تحلیل است (توکن ۳۰ دقیقه‌ای + ابطال بیکن —
 *     همان مکانیزم v197/v200/v202 در /api/onboarding/analysis-discount)
 *   ② بازهٔ دو ساعتهٔ بعد از ارسال پیامک «عدم خرید / ترک خرید»
 *
 * این تابع حالت ② را پیاده می‌کند: به‌محض ارسال موفق پیامک ترک-درگاه،
 * توکن kind="analysis_discount" با TTL دقیقاً ۲ ساعت برای همان کاربر صدور/
 * تمدید می‌شود (source="abandoned_cart_sms").
 *
 * نکات طراحی:
 *  - اگر کاربر همین حالا توکن زندهٔ صفحهٔ تحلیل دارد، همان توکن تا now+۲ساعت
 *    تمدید و source آن abandoned_cart_sms می‌شود (قاعدهٔ «فقط یک توکن زنده»
 *    حفظ می‌شود و ابطالِ خروج از صفحه دیگر آن را نمی‌کشد — فیلتر source در
 *    revoke مسیر تحلیل) — یعنی پنجرهٔ ۲ ساعته مستقل از حضور در صفحه فعال است.
 *  - اگر توکن زنده‌ای ندارد، توکن جدید ۲ ساعته ساخته می‌شود.
 *  - مصرف/عدم پشته: قاعدهٔ v264 در computePlanFinalAmount برقرار است — اگر
 *    کاربر کد تخفیف (همان کد پیامک ترک-درگاه) را وارد کند، کد اعمال می‌شود و
 *    توکن ۱۰٪ دست‌نخورده برای بعد می‌ماند؛ اگر کد نزند، ۱۰٪ خودکار اعمال می‌شود.
 *  - هرگز throw نمی‌کند — شکست صدور توکن هرگز نباید نتیجهٔ ارسال پیامک را عوض کند.
 *
 * @returns توکن صدور/تمدیدشده یا null (فقط برای لاگ/ممیزی)
 */
async function grantAbandonedCartAnalysisToken(userId: string, now: Date): Promise<string | null> {
  try {
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const ANALYSIS_DISCOUNT_PERCENT = 10; // هم‌قد v197
    const expiresAt = new Date(now.getTime() + TWO_HOURS_MS);

    const live = await db.paymentToken.findFirst({
      where: {
        kind: "analysis_discount",
        userId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, token: true, expiresAt: true },
    });

    if (live) {
      // تمدید همان توکن زنده تا پایان پنجرهٔ ۲ ساعته + مهر منبع پیامک
      // (ابطالِ خروج از صفحه دیگر آن را نمی‌کشد — فیلتر source در revoke)
      const extendTo = live.expiresAt.getTime() >= expiresAt.getTime() ? live.expiresAt : expiresAt;
      await db.paymentToken.update({
        where: { id: live.id },
        data: { expiresAt: extendTo, source: "abandoned_cart_sms" },
      });
      await recordFunnelEvent({
        event: "analysis_discount_granted",
        userId,
        meta: { source: "abandoned_cart_sms", ttlMin: 120, mode: "extended" },
      }).catch(() => {});
      return live.token;
    }

    const token = `${userId.slice(-8)}${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    await db.paymentToken.create({
      data: {
        token,
        kind: "analysis_discount",
        userId,
        amount: ANALYSIS_DISCOUNT_PERCENT, // درصد در فیلد ممیزی — هم‌الگوی مسیر تحلیل
        source: "abandoned_cart_sms",
        expiresAt,
      },
    });
    await recordFunnelEvent({
      event: "analysis_discount_granted",
      userId,
      meta: { source: "abandoned_cart_sms", ttlMin: 120, mode: "issued" },
    }).catch(() => {});
    return token;
  } catch (e) {
    console.warn("[abandoned-cart] صدور توکن تخفیف ۱۰٪ دو ساعته شکست (غیرموانع):", e);
    return null;
  }
}

/**
 * v60 — لحظهٔ بوت این ماژول (= بوت پروسهٔ سرور/دیپلوی).
 * پرداخت‌های pending که قبل از این لحظه ساخته شده‌اند هرگز پیام ترک-درگاه
 * نمی‌گیرند (ضد بک‌لاگ بعد از دیپلوی — درخواست مالک).
 * v64 — فقط برای تست: opts.bootAtOverride (تست اسکریپتی؛ در تولید هرگز پاس
 * داده نمی‌شود).
 */
const SCENARIO_BOOT_AT = new Date();

/**
 * v232 — گریس گیت بوت (میلی‌ثانیه): نامزدهایی که حداکثر این‌قدر قبل از دیپلوی
 * ساخته شده‌اند بعد از دیپلوی هم پیامک می‌گیرند (بالاتر). عدد بزرگ‌تر = پوشش
 * بهتر دیپلوی‌های پرتکرار، ولی خطر بک‌لاگِ بعد از downtime طولانی — ۶۰ دقیقه
 * تعادلِ امن است (حداکثر چند نامزد در هر دیپلوی، هرگز «انبوه» نمی‌شود).
 */
const SCENARIO_BOOT_GRACE_MS = 60 * 60 * 1000;

/** تفکیک دلیل‌های ردشدن (v217 — هر skip دیگر بی‌نام نیست) */
export interface AbandonedCartSkipDetail {
  /** کاربر ناموجود/مسدود/بدون موبایل معتبر */
  invalidUser: number;
  /** قبلاً برای همین پرداخت ارسال شده (داپ ابدی) */
  duplicate: number;
  /** سقف ۱ پیامک ترک-درگاه در ۷ روز برای کاربر */
  sevenDayCap: number;
  /** کاربر پلن فعال دارد */
  activePlan: number;
  /** سابقهٔ اشتراک دارد (کد فقط برای خرید اول است) */
  notFirstPurchase: number;
  /** بعد از این پرداخت، خرید موفق/اشتراک جدید داشته */
  laterSuccess: number;
  /** کد تخفیف معتبر دیگری (خوش‌آمد/وین‌بک) دارد */
  otherOffer: number;
}

export interface AbandonedCartScenarioResult {
  /** کل نامزدهای داخل پنجرهٔ ۲۴ ساعته */
  candidates: number;
  /** پیامک واقعاً ارسال/تحویل شده */
  sent: number;
  /** تلاش ارسالِ ناموفق (مثلاً نبود کلید API — برای retry در sweep بعدی) */
  failed: number;
  /** از قبل ارسال‌شده (داپ) */
  alreadySent: number;
  /** v217 — این sweep برای صبح صف شد (کد تخفیف عمداً ساخته نشد) */
  queuedForMorning: number;
  /** v217 — از قبل در صف صبح است (وضعیت عادیِ شب — لاگ نمی‌شود) */
  alreadyQueued: number;
  /** v217 — صف‌های بسته‌شده در این sweep (رد شدن با دلیل / خانه‌تکانی صف مانده) */
  queuedResolved: number;
  /** v232 — پرداخت‌هایی که پردازش‌شان وسط حلقه خطای پیش‌بینی‌نشده خورد (پس از try/catch هر-پرداخت) */
  crashed: number;
  /** v217 — تفکیک دلیل‌های ردشدن */
  skipped: AbandonedCartSkipDetail;
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

/** آفست تهران نسبت به UTC (دقیقه) — از ICU می‌خواند؛ با هر سیاست ساعتِ آینده هم سازگار */
function tehranOffsetMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return Math.round((asUTC - d.getTime()) / 60000);
}

/**
 * v217 — شروع پنجرهٔ ارسالِ «امروز» تهران = ۱۰:۰۰ تهرانِ همان روزِ now.
 * به‌عنوان minCreatedAt به ensureAbandonedCartCode داده می‌شود تا گارانتیِ
 * «کد تخفیف پیامک صبح باید صبح ساخته شده باشد» ساختاری باشد، نه شانسی.
 */
export function tehranSendWindowStart(now: Date): Date {
  const off = tehranOffsetMinutes(now);
  // ساعتِ دیواری تهران به‌صورت شبه-UTC (trick استاندارد Intl)
  const wall = new Date(now.getTime() + off * 60000);
  const start = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    10,
    0,
    0,
    0
  );
  return new Date(start - off * 60000);
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
    failed: 0,
    alreadySent: 0,
    queuedForMorning: 0,
    alreadyQueued: 0,
    queuedResolved: 0,
    crashed: 0,
    skipped: {
      invalidUser: 0,
      duplicate: 0,
      sevenDayCap: 0,
      activePlan: 0,
      notFirstPurchase: 0,
      laterSuccess: 0,
      otherOffer: 0,
    },
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
  // v232 — با گریسِ ۶۰دقیقه‌ای: نامزدهای «تا ۶۰ دقیقه قبل از دیپلوی» بعد از
  // دیپلوی هم دیده می‌شوند (ضد قربانی‌شدنِ رهاکننده‌های دمِ دیپلوی)؛ انبوهِ
  // قدیمی‌ترها همچنان هرگز بعد از دیپلوی پیامک نمی‌گیرند (مادیرکتیو v60 محفوظ).
  const bootAt = opts?.bootAtOverride ?? SCENARIO_BOOT_AT;
  const bootGate = bootAt.getTime() - SCENARIO_BOOT_GRACE_MS;
  const effectiveStart =
    bootGate > windowStart.getTime() ? new Date(bootGate) : windowStart;
  const sevenDaysAgoAC = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // ─── v232 ② صفِ شب معاف از گیت بوت ───
  // پرداخت‌هایی که قبلاً (قبل از یک دیپلوی/ری‌استارتِ نیمه‌شب) برای صبح صف شده‌اند
  // باید صبح بروند — وگرنه ردیف صف تا ۲۶ ساعت می‌ماند و housekeeping آن را
  // expired_queue می‌بندد (ریشهٔ ۳ قربانیِ واقعی ممیزی). اینجا فقط شناسه جمع
  // می‌شود؛ واجدبودنِ همهٔ شروط دیگر (فعال-نبودن پلن، خرید اول، دداپ و…) در
  // حلقهٔ اصلی همان‌طور که برای بقیهٔ نامزدها هست، چک می‌شود.
  let queuedPaymentIds: string[] = [];
  try {
    const queuedRows = await db.smsLog.findMany({
      where: { key: { startsWith: "abandoned_cart_" }, status: "queued" },
      select: { key: true },
      take: 200,
    });
    queuedPaymentIds = queuedRows
      .map((r) => r.key.slice("abandoned_cart_".length))
      .filter((id) => id.length > 0);
  } catch (e) {
    console.warn("[abandoned-cart] خواندن صف صبح شکست (غیرموانع):", e);
  }
  const queuedPayments =
    queuedPaymentIds.length > 0
      ? await db.payment.findMany({
          where: {
            id: { in: queuedPaymentIds },
            status: "pending",
            paymentMethod: "gateway",
            plan: { not: "wallet_topup" },
            createdAt: { gte: windowStart, lte: windowSendAfter },
          },
          select: { id: true, userId: true, createdAt: true },
        })
      : [];

  // بازهٔ ساعت تهران ۱۰:۰۰ تا ۲۲:۰۰
  const tehranHour = tehranHourNow(now);
  const inSendWindow =
    opts?.forceSendWindow === true ||
    (tehranHour >= 10 && tehranHour < 22);

  // ─── v217 ③ housekeeping صف‌های مانده ───
  // صفی که از ساختنش بیش از ۲۶ ساعت گذشته، پرداختش قطعاً از پنجرهٔ ۲۴ساعته
  // بیرون افتاده (صف ≈ +۳۰دقیقهٔ پرداخت ساخته می‌شود) → بسته می‌شود تا در
  // SmsLog و ممیزی پنل «روحِ در صف» باقی نماند.
  try {
    const staleQueued = await db.smsLog.findMany({
      where: {
        key: { startsWith: "abandoned_cart_" },
        status: "queued",
        createdAt: { lt: new Date(now.getTime() - 26 * 60 * 60 * 1000) },
      },
      select: { id: true },
      take: 100,
    });
    for (const row of staleQueued) {
      await db.smsLog.update({
        where: { id: row.id },
        data: {
          status: "skipped",
          error: "expired_queue — پنجرهٔ ۲۴ساعتهٔ ترک درگاه گذشت و پیامک صبحِ هیچ روزی نرسید",
        },
      });
      result.queuedResolved++;
    }
    if (staleQueued.length > 0) {
      console.info(
        `[abandoned-cart] housekeeping: ${staleQueued.length} صفِ ماندهٔ منقضی بسته شد (پنجرهٔ ۲۴ساعته گذشته)`
      );
    }
  } catch (e) {
    console.warn("[abandoned-cart] housekeeping failed (غیرموانع):", e);
  }

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

  // v232 — ادغام نامزدهای اصلی + صف‌های معاف-از-گیت (بدون داپ، مرتبِ زمانی)
  const candidateMap = new Map<
    string,
    { id: string; userId: string; createdAt: Date }
  >();
  for (const p of pendingPayments) candidateMap.set(p.id, p);
  for (const p of queuedPayments) {
    if (!candidateMap.has(p.id)) candidateMap.set(p.id, p);
  }
  const allCandidates = [...candidateMap.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  for (const p of allCandidates) {
    // v232 ③ — هر پرداخت در try/catch خودش: خطای پیش‌بینی‌نشدهٔ یک پرداخت،
    // بقیهٔ sweep را قربانی نمی‌کند (پیش از این یک throw وسط حلقه کل جارو
    // و همهٔ نامزدهای بعد از آن پرداخت را حذف می‌کرد).
    try {
    const dedupeKey = `abandoned_cart_${p.id}`;

    const u = await db.user.findUnique({
      where: { id: p.userId },
      select: { id: true, name: true, mobile: true, planExpiresAt: true, isBlocked: true },
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

    // (۵) دداپ دائمی per-payment — قبل از هر کار سنگین.
    // v217 — status ردیف هم خوانده می‌شود: "queued" یعنی این نامزد قبلاً برای
    // صبح علامت خورده (جاروهای بعدیِ همان شب فقط می‌شمارند؛ بازنویسی نمی‌کنند).
    const existingLog = await db.smsLog.findUnique({
      where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
      select: { status: true },
    });
    if (existingLog?.status === "sent") {
      result.alreadySent++;
      continue;
    }
    const isQueued = existingLog?.status === "queued";

    // v217 — اگر نامزدِ در-صف بعداً به هر دلیلی غیرواجد شد، ردیف صف با دلیل
    // بسته می‌شود (نه سکوت، نه روحِ همیشگی در ممیزی).
    const resolveQueuedSkip = async (reason: string): Promise<void> => {
      if (!isQueued) return;
      try {
        await db.smsLog.update({
          where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
          data: { status: "skipped", error: reason },
        });
        result.queuedResolved++;
        console.info(
          `[abandoned-cart] صفِ صبح بسته شد (payment=${p.id}): ${reason}`
        );
      } catch {
        // بسته‌نشدنِ ردیف صف هرگز جلوی منطق اصلی را نمی‌گیرد — housekeeping پشتیبان است
      }
    };

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
    if (recentAbandoned) {
      await resolveQueuedSkip("seven_day_cap — سقف ۱ پیامک ترک-درگاه در ۷ روز");
      result.skipped.sevenDayCap++;
      continue;
    }

    // (۱) پلن فعال ندارد؟
    const activeSubAC = await db.subscription.findFirst({
      where: { userId: u.id, status: "active", endDate: { gt: now } },
      select: { id: true },
    });
    const hasActivePlan =
      !!activeSubAC ||
      (u.planExpiresAt != null && u.planExpiresAt.getTime() > now.getTime());
    if (hasActivePlan) {
      await resolveQueuedSkip("active_plan — کاربر پلن فعال گرفت");
      result.skipped.activePlan++;
      continue;
    }

    // (۷) ماهیت خرید اول — کد ترک-درگاه فقط برای اولین خرید قابل استفاده است
    const subsCountAC = await db.subscription.count({ where: { userId: u.id } });
    if (subsCountAC > 0) {
      await resolveQueuedSkip("not_first_purchase — سابقهٔ اشتراک دارد");
      result.skipped.notFirstPurchase++;
      continue;
    }

    // (۳) بعد از این پرداخت، پرداخت موفق/اشتراک فعالِ جدیدی ساخته نشده؟
    const laterSuccessPayment = await db.payment.findFirst({
      where: { userId: u.id, status: "success", createdAt: { gt: p.createdAt } },
      select: { id: true },
    });
    if (laterSuccessPayment) {
      await resolveQueuedSkip("later_success — بعد از این پرداخت، خرید موفق داشت");
      result.skipped.laterSuccess++;
      continue;
    }
    const laterActiveSub = await db.subscription.findFirst({
      where: { userId: u.id, status: "active", createdAt: { gt: p.createdAt } },
      select: { id: true },
    });
    if (laterActiveSub) {
      await resolveQueuedSkip("later_success — بعد از این پرداخت، اشتراک فعال ساخت");
      result.skipped.laterSuccess++;
      continue;
    }

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
    if (otherOfferCode) {
      await resolveQueuedSkip("other_offer — کد خوش‌آمد/وین‌بک معتبر دارد");
      result.skipped.otherOffer++;
      continue;
    }

    // (۴) v217 — بازهٔ ساعت تهران ۱۰ تا ۲۲: بیرون از بازه دیگر «سکوت خاموش»
    // نیست — برای صبحِ همان روزِ بعد صف می‌شود. ⚠️ دیریکتیو مالک: در لحظهٔ صف‌شدن
    // هیچ کد تخفیفی ساخته نمی‌شود (نه کد، نه لینک) — کد باید «صبح» و هم‌زمان با
    // ارسال ساخته شود تا وقتی پیامک می‌رسد حتماً معتبر/اجرا‌پذیر باشد.
    if (!inSendWindow) {
      if (isQueued) {
        // وضعیت عادیِ شب — صف از قبل ثبت شده؛ لاگ اسپم نمی‌سازیم
        result.alreadyQueued++;
      } else {
        try {
          await db.smsLog.create({
            data: {
              mobile: normalizedMobile,
              key: dedupeKey,
              templateId: "queued",
              userId: u.id,
              status: "queued",
              error:
                tehranHour >= 22
                  ? "queued_for_morning — ترک درگاه بعد از ۲۲ تهران؛ اولین جاروی بعد از ۱۰:۰۰ با کد تخفیفِ تازهٔ همان لحظه ارسال می‌شود (v217)"
                  : "queued_for_morning — ترک درگاه قبل از ۱۰ تهران؛ اولین جاروی بعد از ۱۰:۰۰ با کد تخفیفِ تازهٔ همان لحظه ارسال می‌شود (v217)",
            },
          });
          result.queuedForMorning++;
          console.info(
            `[abandoned-cart] برای صبح صف شد: payment=${p.id} user=${u.id} paymentCreatedAt=${p.createdAt.toISOString()} tehranHour=${tehranHour} — کد تخفیف عمداً همین‌جا ساخته نمی‌شود (دیریکتیو مالک v217)`
          );
        } catch {
          // رقابتی درج شده (sweep موازی) → از قبل در صف است
          result.alreadyQueued++;
        }
      }
      continue;
    }

    // ─── در پنجرهٔ ارسال — v217 گارانتی مالک: کد تخفیف باید «هم‌زمان با ارسال»
    // ساخته شود. minCreatedAt=شروع پنجرهٔ ۱۰:۰۰ِ امروزِ تهران یعنی هر کدِ
    // قدیمی‌تر از صبحِ امروز (مثلاً ساخته‌شدهٔ شبِ قبل، یا هر تغییر آیندهٔ مدت
    // اعتبار) نادیده گرفته می‌شود و کد تازهٔ ۲ساعته از همین لحظه ساخته می‌شود. ───
    const discount = await ensureAbandonedCartCode(u.id, percent, 2, {
      minCreatedAt: tehranSendWindowStart(now),
    });
    if (!discount) {
      result.failed++;
      console.warn(
        `[abandoned-cart] ساخت کد تخفیف شکست (payment=${p.id}) — sweep بعدی دوباره تلاش می‌کند`
      );
      continue;
    }

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
      // ═══ v265 — دیرکتیو مالک: پنجرهٔ دو ساعتهٔ تخفیف ۱۰٪ صفحهٔ تحلیل ═══
      // بلافاصله بعد از ارسال موفق پیامک ترک خرید، توکن تخفیف تحلیل ۲ ساعته
      // صادر/تمدید می‌شود. هرگز جلوی جریان اصلی را نمی‌گیرد (best-effort).
      const adToken = await grantAbandonedCartAnalysisToken(u.id, now);
      if (adToken) {
        console.info(
          `[abandoned-cart] توکن تخفیف ۱۰٪ تحلیل برای ۲ ساعت فعال شد (payment=${p.id} user=${u.id})`
        );
      }
    } else if (smsRes.skipped === "already_sent") {
      result.alreadySent++;
    } else {
      result.failed++;
      const failMsg = String(smsRes.error ?? smsRes.skipped ?? "unknown");
      console.warn(
        `[abandoned-cart] SMS not sent (payment=${p.id}): ${failMsg}`
      );
      // v232 ③ — شکستِ ارسال دیگر بی‌ردیف نیست: رکورد failed در SmsLog می‌ماند
      // تا در ممیزی پیامکِ پنل دیده شود. روی retry اثری ندارد (فقط status=sent
      // داپ می‌شمارد) و sweep بعدی دوباره تلاش می‌کند.
      try {
        await db.smsLog.upsert({
          where: { mobile_key: { mobile: normalizedMobile, key: dedupeKey } },
          create: {
            mobile: normalizedMobile,
            key: dedupeKey,
            templateId: "template",
            userId: u.id,
            status: "failed",
            error: failMsg.slice(0, 400),
          },
          update: { status: "failed", error: failMsg.slice(0, 400) },
        });
      } catch {
        // ثبتِ رکورد شکست هرگز جلوی منطق اصلی را نمی‌گیرد
      }
    }
    } catch (e) {
      result.crashed++;
      console.error(
        `[abandoned-cart] خطای پردازش پرداخت ${p.id} (سایر نامزدها ادامه می‌یابند):`,
        e
      );
      continue;
    }
  }

  // ─── v217 ③ خط لاگ رویدادها — دیده‌شدنِ قیف در لاگ سرور (pm2) ───
  // فقط وقتی «رویداد واقعی» رخ داده (ارسال/صف‌شدن/بستن صف/شکست) — skipهای
  // تکراریِ عادی و وضعیت پایدارِ شب عمداً لاگ نمی‌شوند (ضد اسپم جاروی ۵دقیقه‌ای).
  const eventCount =
    result.sent +
    result.queuedForMorning +
    result.queuedResolved +
    result.failed +
    result.crashed;
  if (eventCount > 0) {
    console.info(
      `[abandoned-cart] sweep(tehran=${tehranHour}): ` +
        `sent=${result.sent} queued→morning=${result.queuedForMorning} ` +
        `queued(already)=${result.alreadyQueued} resolved=${result.queuedResolved} ` +
        `failed=${result.failed} crashed=${result.crashed} | dup=${result.alreadySent} ` +
        `cap=${result.skipped.sevenDayCap} plan=${result.skipped.activePlan} ` +
        `first=${result.skipped.notFirstPurchase} later=${result.skipped.laterSuccess} ` +
        `offer=${result.skipped.otherOffer} invalid=${result.skipped.invalidUser}`
    );
  }

  return result;
}
