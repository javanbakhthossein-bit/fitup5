/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ابزار بازیابی پیامک‌ها (v35) — «اگر بعد از دیپلوی پیامک‌ها ارسال نشدند»
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * این اسکریپت را مالک روی سرور اجرا می‌کند تا هر پیامکی که به هر دلیلی
 * (نبودن env در لحظهٔ دیپلوی، قطعی موقت sms.ir، خطای شبکه و…) ارسال نشده،
 * حالا ارسال شود — بدون هیچ پیامک تکراری:
 *
 *   ۱) دکتر env — وضعیت SMSIR_API_KEY و هر ۱۰ متغیر قالب را نشان می‌دهد
 *      (اگر کلید یا متغیری نباشد دقیقاً می‌گوید چه چیزی در .env کم است)
 *   ۲) تلاش مجدد همهٔ پیامک‌های «failed» ثبت‌شده در SmsLog — دقیقاً با همان
 *      سناریو و همان گیرنده (خرید/برنامه/چکاپ/انقضا/وین‌بک‌ها)
 *
 * 🗓 تغییر v35: مرحلهٔ backfill گروهی ۶۶۹۰۶۸+۴۶۱۲۹۱ حذف شد (درخواست مالک —
 *   ارسال اولین دیپلوی کامل شده است؛ برای هر کاربر جدید همین پیامک‌ها به‌صورت
 *   خودکار همزمان با رخداد واقعی‌شان از جاروی رفتاری ارسال می‌شود).
 *
 * 🔒 دداپ ابدی: هر (شماره، سناریو) فقط یک بار در عمر سیستم «sent» می‌شود
 *    (unique mobile+key در SmsLog) — پس اجرای مکرر این ابزار ۱۰۰٪ بی‌خطر است
 *    و هرگز پیامک تکراری نمی‌فرستد. فقط رکوردهای failed/ارسال‌نشده پردازش می‌شوند.
 *
 * اجرا روی سرور:
 *   cd /var/www/fitup
 *   bun run scripts/resend-sms.ts              ← اجرای کامل
 *   bun run scripts/resend-sms.ts --dry-run    ← فقط گزارش، بدون هیچ ارسالی
 *
 * نکته: bun خودش فایل .env ریشهٔ پروژه را می‌خواند — نیازی به export دستی نیست.
 */

// ماژول مستقل (جلوگیری از تصادم global-scope بین اسکریپت‌ها در tsc)
export {};

const DRY_RUN = process.argv.includes("--dry-run");
/** مکث بین دو ارسال متوالی (ms) — احترام به rate-limit سرویس پیامک */
const SMS_DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** نام فارسی و کد قالب هر سناریو — فقط برای گزارش */
const SCENARIO_FA: Record<string, string> = {
  onboarding_nudge: "۶۶۹۰۶۸ — آنبوردینگ ناتمام",
  onboarding_winback: "۴۶۱۲۹۱ — وین‌بک آنبوردینگ (کد تخفیف)",
  program_ready: "۶۶۳۶۷۸ — برنامه آماده شد",
  checkup_reminder: "۷۶۱۱۳۷ — یادآوری چکاپ",
  plan_expired: "۳۲۲۷۸۰ — پلن منقضی شد",
  invite_friend: "۸۵۲۱۹۳ — دعوت دوست",
  expired_winback: "۶۰۴۶۷۸ — وین‌بک ۷۲ ساعت بعد از انقضا (کد تخفیف)",
  purchase_advanced: "۴۲۳۷۲۶ — خرید پلن پیشرفته",
  purchase_ultimate: "۶۱۲۴۰۵ — خرید پلن حرفه‌ای",
  purchase_basic: "۵۶۵۱۸۵ — خرید پلن اقتصادی/استاندارد",
};

if (!process.env.DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL تنظیم نیست.\n" +
      "   این اسکریپت را از ریشهٔ پروژه اجرا کنید (bun خودش .env را می‌خواند):\n" +
      "     cd /var/www/fitup && bun run scripts/resend-sms.ts"
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { db } = await import("../src/lib/db");
  const { normalizeMobileForSmsIr, SMS_TEMPLATE_ENV_KEYS } = await import("../src/lib/fitness/smsir");
  const {
    sendOnboardingNudgeSms,
    sendOnboardingWinbackSms,
    sendProgramReadySms,
    sendCheckupReminderSms,
    sendPlanExpiredSms,
    sendExpiredWinbackSms,
    notifyPlanPurchaseSms,
  } = await import("../src/lib/fitness/sms-flows");
  const {
    ensureOnboardingWinbackCode,
    ensureRenewalDiscountCode,
    getOnboardingDiscountPercent,
    getExpiryDiscountPercent,
  } = await import("../src/lib/fitness/notifications");

  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("  ابزار بازیابی پیامک‌های فیتاپ" + (DRY_RUN ? "  (حالت گزارش — بدون ارسال)" : ""));
  console.log("═══════════════════════════════════════════════════");
  console.log("");

  // ═══ ۱) دکتر env ═══
  console.log("🩺 دکتر env — وضعیت متغیرهای پیامک:");
  const apiKey = process.env.SMSIR_API_KEY;
  if (!apiKey) {
    console.log("   ❌ SMSIR_API_KEY تنظیم نیست — هیچ پیامکی قابل ارسال نیست!");
    console.log("      ☞ در .env سرور اضافه کنید: SMSIR_API_KEY=کلید_از_پنل_sms.ir");
    console.log("      ☞ بعد از اضافه‌کردن، همین اسکریپت را دوباره اجرا کنید.");
    console.log("");
  } else {
    console.log("   ✅ SMSIR_API_KEY تنظیم است");
  }

  let missingTemplates = 0;
  for (const [scenario, envKey] of Object.entries(SMS_TEMPLATE_ENV_KEYS)) {
    const val = process.env[envKey];
    const label = SCENARIO_FA[scenario] ?? scenario;
    if (val) {
      console.log(`   ✅ ${envKey}=${val}  (${label})`);
    } else {
      missingTemplates++;
      console.log(`   ❌ ${envKey} تنظیم نیست  (${label} — این پیامک ارسال نمی‌شود)`);
    }
  }
  if (missingTemplates > 0) {
    console.log(`      ☞ ${missingTemplates} متغیر در .env کم است — فهرست کامل: download/SMS-TEMPLATES.md`);
  }
  console.log("");

  if (!apiKey) {
    console.log("⛔ بدون SMSIR_API_KEY ادامه نمی‌دهم. کلید را در .env بگذارید و دوباره اجرا کنید.");
    process.exit(1);
  }

  const pauseIfSent = async (sent: boolean) => {
    if (sent && !DRY_RUN) await sleep(SMS_DELAY_MS);
  };

  // ═══ ۲) تلاش مجدد پیامک‌های failed ═══
  console.log("🔁 مرحلهٔ ۱: تلاش مجدد پیامک‌های ناموفق قبلی (SmsLog status=failed)…");
  const failedLogs = await db.smsLog.findMany({
    where: { status: "failed" },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  let retriedSent = 0;
  let retriedStillFailed = 0;
  let retriedSkipped = 0;

  /** یافتن کاربر مرتبط با یک لاگ — اول با userId، بعد با خود شماره */
  const resolveUser = async (userId: string | null, normalizedMobile: string) => {
    if (userId) {
      const u = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, mobile: true },
      });
      if (u?.mobile && normalizeMobileForSmsIr(u.mobile) === normalizedMobile) return u;
    }
    return db.user.findFirst({
      where: { mobile: { in: [`0${normalizedMobile}`, `98${normalizedMobile}`, `+98${normalizedMobile}`] } },
      select: { id: true, name: true, mobile: true },
    });
  };

  for (const log of failedLogs) {
    // لیبل فارسی: کلید کامل → پایهٔ سناریو (purchase_advanced_xxx → purchase_advanced)
    const baseKey = log.key.startsWith("purchase_")
      ? `purchase_${log.key.slice("purchase_".length).split("_")[0]}`
      : log.key.split("_")[0];
    const label = SCENARIO_FA[log.key] ?? SCENARIO_FA[baseKey] ?? log.key;

    // پیامک دعوت دوست: پارامتر NAME دوست در DB ذخیره نمی‌شود — فقط دعوت مجدد
    // از طرف خود کاربر (صفحهٔ معرفی به دوستان) معنا دارد.
    if (log.key.startsWith("invite_friend")) {
      retriedSkipped++;
      console.log(`   ⏭ ${log.mobile} — ${label}: نیاز به دعوت مجدد از داخل اپ (نام دوست ذخیره نمی‌شود)`);
      continue;
    }

    // ─── پیامک‌های خرید: کلید = purchase_{planId}_{paymentId} ───
    if (log.key.startsWith("purchase_")) {
      const rest = log.key.slice("purchase_".length);
      const idx = rest.lastIndexOf("_");
      if (idx <= 0 || !log.userId) {
        retriedSkipped++;
        console.log(`   ⏭ ${log.mobile} — ${label}: کلید/کاربر نامعتبر`);
        continue;
      }
      const planId = rest.slice(0, idx);
      const paymentId = rest.slice(idx + 1);
      if (DRY_RUN) {
        retriedSent++;
        console.log(`   💧 ${log.mobile} — ${label}: تلاش مجدد می‌شد (dry-run)`);
        continue;
      }
      await notifyPlanPurchaseSms(log.userId, planId, paymentId);
      const after = await db.smsLog.findUnique({
        where: { mobile_key: { mobile: log.mobile, key: log.key } },
        select: { status: true },
      });
      if (after?.status === "sent") {
        retriedSent++;
        console.log(`   ✅ ${log.mobile} — ${label}: ارسال شد`);
      } else {
        retriedStillFailed++;
        console.log(`   ❌ ${log.mobile} — ${label}: هنوز ناموفق`);
      }
      await pauseIfSent(after?.status === "sent");
      continue;
    }

    // ─── پیامک‌های سناریویی معمول ───
    const user = await resolveUser(log.userId, log.mobile);
    if (!user?.mobile) {
      retriedSkipped++;
      console.log(`   ⏭ ${log.mobile} — ${label}: کاربر مرتبط پیدا نشد`);
      continue;
    }

    if (DRY_RUN) {
      retriedSent++;
      console.log(`   💧 ${log.mobile} — ${label}: تلاش مجدد می‌شد (dry-run)`);
      continue;
    }

    let sent = false;
    switch (log.key) {
      case "onboarding_nudge":
        sent = (await sendOnboardingNudgeSms(user)).sent;
        break;
      case "onboarding_winback": {
        const percent = await getOnboardingDiscountPercent();
        const code = await ensureOnboardingWinbackCode(user.id, percent, 30);
        if (!code) {
          retriedSkipped++;
          console.log(`   ⏭ ${log.mobile} — ${label}: کد تخفیف قابل صدور نیست (قبلاً استفاده شده)`);
          continue;
        }
        sent = (await sendOnboardingWinbackSms(user, code.code)).sent;
        break;
      }
      case "program_ready":
        sent = (await sendProgramReadySms(user)).sent;
        break;
      case "checkup_reminder":
        sent = (await sendCheckupReminderSms(user)).sent;
        break;
      case "plan_expired":
        sent = (await sendPlanExpiredSms(user)).sent;
        break;
      case "expired_winback": {
        const percent = await getExpiryDiscountPercent();
        const code = await ensureRenewalDiscountCode(user.id, percent, 14);
        if (!code) {
          retriedSkipped++;
          console.log(`   ⏭ ${log.mobile} — ${label}: کد تخفیف قابل صدور نیست`);
          continue;
        }
        sent = (await sendExpiredWinbackSms(user, code.code)).sent;
        break;
      }
      default:
        retriedSkipped++;
        console.log(`   ⏭ ${log.mobile} — ${label}: سناریوی ناشناخته`);
        continue;
    }

    if (sent) {
      retriedSent++;
      console.log(`   ✅ ${log.mobile} — ${label}: ارسال شد`);
    } else {
      retriedStillFailed++;
      console.log(`   ❌ ${log.mobile} — ${label}: هنوز ناموفق (متن خطا در SmsLog)`);
    }
    await pauseIfSent(sent);
  }
  if (failedLogs.length === 0) console.log("   ✅ هیچ پیامک ناموفقی در لاگ نیست");
  console.log(
    `   جمع: ${failedLogs.length} رکورد failed — ${retriedSent} ارسال/قابل‌ارسال، ${retriedStillFailed} همچنان خطا، ${retriedSkipped} رد شد`
  );
  console.log("");

  // ═══ گزارش نهایی ═══
  console.log("═══════════════════════════════════════════════════");
  if (DRY_RUN) {
    console.log("💧 حالت گزارش بود — هیچ پیامکی ارسال نشد.");
    console.log("   برای اجرای واقعی (ارسال همین‌ها):  bun run scripts/resend-sms.ts");
  } else {
    console.log("🎉 تمام شد.");
    console.log(`   • تلاش مجدد ناموفق‌ها: ${retriedSent} ارسال شد، ${retriedStillFailed} همچنان خطا، ${retriedSkipped} رد شد`);
    if (retriedStillFailed > 0) {
      console.log("   ☞ خطاهای باقی‌مانده در جدول SmsLog (status=failed) ثبت شده‌اند —");
      console.log("     این ابزار را بعد از رفع مشکل (مثلاً شارژ پنل sms.ir) دوباره اجرا کنید.");
    }
    console.log("   🔒 دداپ ابدی فعال است — اجرای دوبارهٔ این ابزار هرگز پیامک تکراری نمی‌فرستد.");
  }
  console.log("═══════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ خطای غیرمنتظره:", e);
    process.exit(1);
  });
