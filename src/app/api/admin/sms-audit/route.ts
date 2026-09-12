import { db } from "@/lib/db";
import { apiError, requireAdmin } from "@/lib/fitness/auth";
import {
  DEFAULT_SMS_TEMPLATE_IDS,
  SMS_TEMPLATE_ENV_KEYS,
  resolveTemplateId,
  type SmsTemplateKey,
} from "@/lib/fitness/smsir";

/**
 * GET /api/admin/sms-audit — ممیزی تک‌به‌تک پیامک‌های سیستمی (فقط ادمین)
 *
 * درخواست مالک (v66): «باید دونه به دونه پیامک‌ها رو بررسی کنی تا ببینی
 * درست در زمان خودشون ارسال می‌شن یا نه و همگی به لینک درست و جای درست
 * می‌رن یا نه.»
 *
 * برای هر سناریو برمی‌گرداند:
 *  - شناسهٔ قالبِ مؤثر + منبع آن (override پنل / env سرور / پیش‌فرض هاردکد)
 *  - زمان‌بندی دقیق فراخوانی در کد (کدام مسیر، کِی)
 *  - رفتار دداپ (یک بار در عمر / هر دوره / هر پرداخت / …)
 *  - آمار SmsLog (sent / failed) + آخرین ارسال + ۸ لاگ آخر با موبایل ماسک‌شده
 *
 * نکتهٔ v66: دِداپِ «در عمر حساب» برای program_ready و checkup_reminder باگ
 * بود (فقط اولین بار می‌رفت) — این دو حالا بر چرخهٔ تولید/چکاپ یکتا هستند.
 */

/** موبایل ماسک‌شده برای نمایش در پنل: 9123456789 → 912•••••789 */
function maskMobile(m: string): string {
  if (m.length < 6) return "••••••";
  return `${m.slice(0, 3)}•••••${m.slice(-3)}`;
}

interface ScenarioDef {
  /** پیشوند کلیدهای SmsLog این سناریو (grouping) */
  prefix: string;
  /** کلید قالب برای رزولوشن شناسه (null = سناریو بدون قالب سیستمی) */
  templateKey?: SmsTemplateKey;
  name: string;
  timing: string;
  dedupe: string;
  link: string;
  /** منبع شناسهٔ قالب خارج از سیستم env/پیش‌فرض (abandoned_cart) */
  specialSource?: string;
}

const SCENARIOS: ScenarioDef[] = [
  {
    prefix: "onboarding_nudge",
    templateKey: "onboarding_nudge",
    name: "یادآوری تکمیل آنبوردینگ (669068)",
    timing: "۳۰ دقیقه بعد از ثبت شماره موبایل، اگر آنبوردینگ تکمیل نشده باشد (جاروی رفتاری)",
    dedupe: "یک بار در عمر حساب — بدون نام، «ورزشکار» نوشته می‌شود",
    link: "بدون لینک (فقط NAME)",
  },
  {
    prefix: "onboarding_winback",
    templateKey: "onboarding_winback",
    name: "وین‌بک بعد از آنبوردینگ (461291)",
    timing: "۲۴ ساعت بعد از تکمیل آنبوردینگ بدون خرید — با کد تخفیف اختصاصی",
    dedupe: "یک بار در عمر حساب",
    link: "بدون لینک (NAME + CODE)",
  },
  {
    prefix: "program_ready",
    templateKey: "program_ready",
    name: "برنامه شما آماده شد (663678)",
    timing: "به محض آماده‌شدن برنامه — پایان تولید پس‌زمینه، watchdog بازیابی، تایید/تمدید ادمین",
    dedupe: "🩹 v66 — هر چرخهٔ تولید برنامه یک پیامک (قبلاً یک بار در عمر بود و بعدی هرگز نمی‌رفت)",
    link: "بدون لینک (NAME) — مقصد: نوتیف + تب برنامه‌ها",
  },
  {
    prefix: "checkup_reminder",
    templateKey: "checkup_reminder",
    name: "یادآوری چکاپ دوره‌ای (761137)",
    timing: "روز ۱۵ / ۳۰ / ۴۰ هر دورهٔ ۴۵ روزه — همزمان با نوتیف چکاپ (جاروی رفتاری)",
    dedupe: "🩹 v66 — هر (شروع دوره + شمارهٔ چکاپ) یک پیامک (قبلاً یک بار در عمر بود)",
    link: "بدون لینک (NAME) — مقصد: تب پیشرفت → بخش چکاپ",
  },
  {
    prefix: "plan_expiring",
    templateKey: "plan_expiring_soon",
    name: "پلن فردا منقضی می‌شود (184777)",
    timing: "۲۴ ساعت قبل از انقضای پلن (جاروی رفتاری) — با لینک تمدید کوتاه r/…",
    dedupe: "هر چرخهٔ اشتراک یک بار (کلید بر subscriptionId)",
    link: "لینک تمدید /r/{code} → دامنهٔ رسمی fittup.ir",
  },
  {
    prefix: "plan_expired",
    templateKey: "plan_expired",
    name: "پلن منقضی شد (322780)",
    timing: "تا ۲۴ ساعت بعد از انقضای پلن (جاروی رفتاری) — با لینک تمدید کوتاه",
    dedupe: "هر چرخهٔ انقضا یک بار (کلید بر subscriptionId)",
    link: "لینک تمدید /r/{code} → fittup.ir",
  },
  {
    prefix: "expired_winback",
    templateKey: "expired_winback",
    name: "وین‌بک ۷۲ ساعته (604678)",
    timing: "۷۲ ساعت بعد از انقضا بدون تمدید — کد تخفیف اختصاصی + لینک تمدید",
    dedupe: "هر چرخهٔ انقضا یک بار (کلید بر subscriptionId)",
    link: "لینک تمدید /r/{code} → fittup.ir",
  },
  {
    prefix: "renewal_boost",
    templateKey: "renewal_boost",
    name: "تقویت تمدید ۸ روزه (883325)",
    timing: "۸ روز بعد از انقضا بدون تمدید — کد تخفیف + لینک هوشمند اپ",
    dedupe: "هر چرخهٔ انقضا یک بار (کلید بر cycleId)",
    link: "go/renew?t=… کوتاه‌شده → اپ فیتاپ باز می‌شود، نبود اپ → وب",
  },
  {
    prefix: "welcome_offer",
    templateKey: "welcome_offer",
    name: "خوش‌آمدگویی ۸ روزه (612964)",
    timing: "دقیقاً ۸ روز بعد از ثبت شماره موبایل برای کاربر بدون خرید — کد تخفیف خوش‌آمدگویی",
    dedupe: "یک بار در عمر حساب",
    link: "https://fittup.ir/go/plans (لینک هوشمند در متن قالب)",
  },
  {
    prefix: "purchase_",
    name: "خرید موفق — بلافاصله بعد از تأیید پرداخت (565185 اقتصادی/استاندارد، 423726 پیشرفته، 612405 حرفه‌ای)",
    timing: "بلافاصله بعد از verify موفق درگاه (خرید درگاه، کیف پول، بازار) — در payment-delivery",
    dedupe: "هر پرداخت یک پیامک (کلید بر paymentId — verify تکراری دوباره نمی‌فرستد)",
    link: "بدون لینک (NAME اختیاری با خودترمیم)",
  },
  {
    prefix: "plan_upgrade_",
    name: "ارتقای پلن (275042 به پیشرفته/حرفه‌ای، 324322 به استاندارد)",
    timing: "بعد از پرداخت موفقِ پلن بالاتر وقتی اشتراک فعالِ پلن پایین‌تر دارد",
    dedupe: "هر پرداخت ارتقا یک پیامک (کلید بر planId+paymentId)",
    link: "بدون لینک (NAME + PLANBASE + PLANUPDATE)",
  },
  {
    prefix: "wallet_topup",
    templateKey: "wallet_topup",
    name: "شارژ موفق کیف پول (556023)",
    timing: "بعد از تأیید پرداخت شارژ کیف پول",
    dedupe: "هر شارژ یک پیامک (کلید بر paymentId)",
    link: "بدون لینک (NAME + AMOUNT با خودترمیم)",
  },
  {
    prefix: "abandoned_cart",
    name: "ترک درگاه پرداخت (248945)",
    timing: "دقیقاً ۳۰ تا ۳۵ دقیقه بعد از ترک درگاه بدون پرداخت — فقط بازهٔ ۱۰ تا ۲۲ تهران",
    dedupe: "هر پرداخت رهاشده یک پیامک (کلید بر paymentId) — داپ ابدی",
    link: "لینک کوتاه /r/{code} → go/plans?offer=… (کد تخفیف ۲ ساعته) — دامنهٔ رسمی fittup.ir",
    specialSource: "abandoned_cart_sms_template_id (پنل) — خالی = ارسال با متن آزاد bulk",
  },
  {
    prefix: "invite_friend",
    templateKey: "invite_friend",
    name: "دعوت دوست (852193)",
    timing: "درخواست کاربر در صفحهٔ معرفی — به شمارهٔ دوستش",
    dedupe: "هر (دعوت‌کننده + شمارهٔ دوست) یک بار",
    link: "go/plans?ref=… کوتاه‌شده → اپ اول، وب بعد",
  },
];

export async function GET() {
  try {
    await requireAdmin();

    const apiConfigured = Boolean(process.env.SMSIR_API_KEY);

    // آمار کلیدها — groupBy(key,status) و تجمیع بر پیشوند در JS
    const grouped = await db.smsLog.groupBy({
      by: ["key", "status"],
      _count: { _all: true },
      _max: { createdAt: true },
    });

    // آخرین لاگ هر سناریو — یک کوئری برای هر سناریو (۱۴ کوئری سبک با ایندکس key)
    const scenarioRows = await Promise.all(
      SCENARIOS.map(async (s) => {
        const recent = await db.smsLog.findMany({
          where: { key: { startsWith: s.prefix } },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            mobile: true,
            key: true,
            status: true,
            error: true,
            createdAt: true,
            templateId: true,
          },
        });
        return { scenario: s, recent };
      })
    );

    const scenarios = scenarioRows.map(({ scenario: s, recent }) => {
      // ردیف‌های این سناریو: کلید دقیقاً برابر پیشوند، یا با «_» ادامه یابد،
      // یا برای پیشوندهای با «_» پایانی (purchase_/plan_upgrade_) startsWith
      const rows = grouped.filter(
        (g) =>
          g.key === s.prefix ||
          g.key.startsWith(`${s.prefix}_`) ||
          (s.prefix.endsWith("_") && g.key.startsWith(s.prefix))
      );
      const sent = rows
        .filter((r) => r.status === "sent")
        .reduce((a, r) => a + r._count._all, 0);
      const failed = rows
        .filter((r) => r.status === "failed")
        .reduce((a, r) => a + r._count._all, 0);
      const lastSentAt = rows
        .filter((r) => r.status === "sent")
        .reduce<string | null>((acc, r) => {
          const t = r._max.createdAt?.toISOString() ?? null;
          return !acc || (t && t > acc) ? t : acc;
        }, null);

      let templateId: string | null = null;
      let source: string = "none";
      let envKey: string | null = null;
      if (s.templateKey) {
        const resolved = resolveTemplateId(s.templateKey);
        templateId = resolved.id;
        source = resolved.source;
        envKey = SMS_TEMPLATE_ENV_KEYS[s.templateKey];
      }
      if (s.specialSource) {
        source = s.specialSource;
      }

      return {
        prefix: s.prefix,
        name: s.name,
        timing: s.timing,
        dedupe: s.dedupe,
        link: s.link,
        templateId,
        source,
        envKey,
        sent,
        failed,
        lastSentAt,
        recent: recent.map((r) => ({
          mobile: maskMobile(r.mobile),
          key: r.key,
          status: r.status,
          error: r.error,
          templateId: r.templateId,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });

    return Response.json({
      ok: true,
      apiConfigured,
      defaults: DEFAULT_SMS_TEMPLATE_IDS,
      scenarios,
    });
  } catch (e) {
    return apiError(e);
  }
}
