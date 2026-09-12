/**
 * Next.js Instrumentation — کد اجراشونده هنگام boot شدن سرور
 *
 * استفاده‌ها:
 *  ۰. خودترمیمی ستون‌های گم‌شده DB — ۸ ثانیه بعد از boot + هر ۶ ساعت
 *     (اگر db:push فراموش شود، لاگین نمی‌شکند — درس آموخته از باگ v9)
 *  ۱. خودترمیمی رسانه مقالات (article-media-selfheal) — ۲۰ ثانیه بعد از boot
 *  ۲. جاروی داخلی بازیابی پرداخت‌های معلق — ۴۵ ثانیه بعد از boot + هر ۱۰ دقیقه
 *     (باگ «پرداخت موفق ولی در انتظار» — بدون نیاز به کرون خارجی)
 *  ۳. جاروی داخلی نوتیف‌های رفتاری — ۹۰ ثانیه بعد از boot + هر ۶ ساعت
 *     (چکاپ‌های ۱۵/۳۰/۴۰ + انقضای پلن + یادآوری تمدید + کد تخفیف اختصاصی —
 *     بدون نیاز به کرون خارجی)
 *  ۴. ناشر مقالات زمان‌بندی‌شده — ۶۰ ثانیه بعد از boot + هر ۱۵ دقیقه
 *     (مقالاتِ scheduledAt دار بدون کرون خارجی منتشر می‌شوند)
 *
 *  v60 — گزارش صبحگاهی خودکار تحلیل هوشمند (۶ صبح) به‌کلی حذف شد
 *  (دیریکتیو مالک: «همه چیز دستی باشد») — تابع startSmartAnalysisSweep و
 *  روت /api/cron/smart-analysis حذف شده‌اند؛ تحلیل هوشمند فقط با دکمهٔ دستی
 *  پنل ادمین (POST /api/admin/smart-analysis) اجرا می‌شود.
 *
 * خاموش‌کردن جاروی پرداخت‌ها: PAYMENT_SWEEP_INTERVAL_MIN=0 در .env
 * خاموش‌کردن جاروی نوتیف‌های رفتاری: BEHAVIORAL_SWEEP_INTERVAL_MIN=0 در .env
 * خاموش‌کردن ناشر مقالات: PUBLISH_SWEEP_INTERVAL_MIN=0 در .env
 * خاموش‌کردن خودترمیمی: فایل `.selfheal-off` در ریشه پروژه یا
 * متغیر محیطی DISABLE_ARTICLE_MEDIA_SELFHEAL=1
 */
export async function register() {
  // فقط در runtime nodejs اجرا شود (نه edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ─── گارد dev: جاروهای boot در حالت development خاموش ───
    // این جاروها برای production نوشته شده‌اند (بدون کرون خارجی). در dev
    // (سندباکس/پیش‌نمایش) هرکدام با self-fetch مسیر خودش را compile می‌کنند —
    // ۴ کامپایل موازی بلافاصله بعد از boot حافظه سرور dev را ترکید می‌کند
    // (سندباکس ۴GB) و چرخه restart بی‌نهایت می‌سازد. در dev کامپایل‌ها باید
    // طبیعی و به‌مرور با بازدید کاربر رخ دهند.
    // فعال‌سازی اجباری در dev: DEV_FORCE_CRONS=1
    if (process.env.NODE_ENV === "development" && process.env.DEV_FORCE_CRONS !== "1") {
      console.log(
        "[instrumentation] حالت development — جاروهای boot (db-selfheal/media/publisher/behavioral) خاموش شدند (DEV_FORCE_CRONS=1 برای فعال‌سازی اجباری)"
      );
      return;
    }
    const {
      startBootMediaSelfHeal,
      startPaymentRecoverySweep,
      startBehavioralSweep,
      startDbSelfHeal,
      startScheduledPublisher,
      startTicketAutoCloseSweep,
      startDbBackupSweep,
    } = await import("./instrumentation-node");
    startDbSelfHeal();
    startBootMediaSelfHeal();
    startPaymentRecoverySweep();
    // بعد از جاروی پرداخت‌ها (۶۰ ثانیه) — مقالات زمان‌بندی‌شده منتشر شوند
    startScheduledPublisher();
    // v52: بستن خودکار تیکت‌های بی‌پاسخ (۷ روز از آخرین پاسخ ادمین)
    startTicketAutoCloseSweep();
    // v60: گزارش صبحگاهی خودکار تحلیل هوشمند حذف شد — همه‌چیز دستی است (دیریکتیو مالک)
    startBehavioralSweep();
    // v66: بکاپ دوره‌ای دیتابیس + آپلود گوگل درایو (بازه/لینک/نگهداری از پنل ادمین)
    startDbBackupSweep();
    // v36: backfill دیپلوی کامل حذف شد — ارسال گروهی اولین دیپلوی تمام شده بود
    // و همهٔ بخش‌های یک‌باره (قوانین/انبوردینگ قدیمی‌ها) قبلاً اعمال شده‌اند (درخواست مالک)
  }
}
