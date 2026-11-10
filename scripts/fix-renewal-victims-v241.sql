-- ═══════════════════════════════════════════════════════════════════════════
-- v241 — ترمیم قربانیان باگ «ارتقای ناعادلانه» (تیکت سلمان مقصودی ۱۴۰۵/۰۷/۲۴)
-- اجرای یک‌بار روی سرور تولیدی بعد از دیپلوی v241:
--   sqlite3 /var/www/fitup/db/custom.db < scripts/fix-renewal-victims-v241.sql
-- پچ idempotent است (اجرای تکراری بی‌اثر) و فقط رکوردهای علامت‌گذاری‌شده را می‌زند.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── ۱) سلمان مقصودی (09125612672) — تمدید basic→standard در ۱۴۰۵/۰۷/۲۴ ───
-- باگ: اشتراک standard با startDate=لحظهٔ پرداخت ولی endDate=پایان پلن قبلیِ
-- همان روز ساخته شد → ۴۵ روز پول (۷۹۲,۲۲۲ تومان)، ۱۱.۵ ساعت اشتراک.
-- ترمیم: پایان = شروع + ۴۵ روز کامل (۲۰۲۶-۱۱-۳۰) + فعال‌سازی + هم‌ترازی User.
-- گارد: فقط اگر هنوز endDate همان مقدار معیوب ۲۰۲۶-۱۰-۱۶T18:23:31 باشد.
UPDATE Subscription
SET endDate = 1796021505274,        -- 2026-11-30T06:51:45.274Z (= startDate + 45 روز)
    status  = 'active'
WHERE id = 'cmvam0mr54ghc2bcbtm2wyey3'
  AND endDate = 1792175011393;      -- مقدار معیوب 2026-10-16T18:23:31.393Z

UPDATE User
SET planExpiresAt = 1796021505274,  -- هم‌تراز با اشتراک ترمیم‌شده
    planStartedAt = 1792133505274,  -- 2026-10-16T06:51:45Z (لحظهٔ تحویل پلن standard)
    planName = 'standard'
WHERE id = 'cmtiy5x3600fx2bsp88i74m8v'
  AND planExpiresAt = 1792175011393;

-- نوتیف درون‌برنامهٔ «اصلاح شد» برای سلمان (idempotent با id ثابت)
INSERT INTO Notification (id, userId, type, title, body, link, meta, read, createdAt)
SELECT 'ntf-v241-renewal-fix-salman', 'cmtiy5x3600fx2bsp88i74m8v', 'system',
       'پلن شما اصلاح شد ✅',
       'پلن استاندارد تمدیدی شما که به‌درستی فعال نشده بود، بررسی و اصلاح شد — اشتراک شما تا ۱۰ آذر ۱۴۰۵ فعال است. از صبر و شکیبایی شما متشکریم 🙏',
       '?screen=panel&tab=dashboard',
       '{"scenario":"renewal_fix_v241","paymentId":"cmvalzduf4ggu2bcb1ij6dyke"}',
       0, 1792234800000
WHERE NOT EXISTS (SELECT 1 FROM Notification WHERE id = 'ntf-v241-renewal-fix-salman');

-- ─── ۲) حسین جوان (09300083803) — اشتراک هدیهٔ مدیر (۳۶۵روزه، بدون پرداخت) ───
-- مدیر در ۱۴۰۵/۰۷/۱۴ پلن ultimate او را تا ۲۰۲۷-۱۰-۰۶ تمدید کرده ولی ردیف
-- Subscription عقب مانده بود (پایان ۲۰۲۷-۰۷-۰۲). هم‌ترازی ردیف با تاریخ مدیر.
UPDATE Subscription
SET endDate = 1822848288439         -- 2027-10-06T18:44:48.439Z (= User.planExpiresAt)
WHERE userId = 'cmr2lasau0007pv30942kzh31'
  AND paymentId IS NULL
  AND status = 'active'
  AND plan = 'ultimate'
  AND endDate = 1814524734891;      -- مقدار عقب‌مانده 2027-07-02T10:38:54.891Z

-- ─── ۳) بک‌فیل دعوت نظرسنجی (v241 — ممیزی مالک: «نوتیف نظرسنجی باید برود») ───
-- کاربرانی که اشتراک منقضی دارند ولی در عمر اکانتشان هرگز دعوت نظرسنجی نگرفته‌اند
-- (یازده نفر در دامپ 2026-10-17). از این پس کرون هم با دداپ ۶۰روزه خودش می‌فرستد.
INSERT INTO Notification (id, userId, type, title, body, link, meta, read, createdAt)
SELECT 'ntf-v241-survey-backfill-' || u.userId, u.userId, 'system',
       'نظر شما درباره فیتاپ مهم است 📝',
       'پلن شما به پایان رسیده. لطفاً چند ثانیه وقت بگذارید و نظرسنجی پایان پلن را پر کنید تا بتوانیم خدمات بهتری ارائه دهیم.',
       '?survey=open',
       '{"scenario":"survey_invite","backfill":"v241"}',
       0,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM (SELECT DISTINCT userId FROM Subscription WHERE status = 'expired') AS u
WHERE NOT EXISTS (
  SELECT 1 FROM Notification n WHERE n.userId = u.userId AND n.meta LIKE '%survey_invite%'
)
AND NOT EXISTS (
  SELECT 1 FROM Notification n2 WHERE n2.id = 'ntf-v241-survey-backfill-' || u.userId
);
