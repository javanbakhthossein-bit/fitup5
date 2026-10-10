# راهنمای فعال‌سازی ویدیوهای Muscle Wiki بانک حرکات (v192)

> 🔧 **v192-fix (مهم):** نسخهٔ اولیهٔ اسکریپت یک باگ داشت — مسیر سندباکس
> (`/home/z/my-project`) هاردکد بود و روی سرور خطای `Cannot find module '@prisma/client'`
> می‌داد. zip فعلی و فایل‌های داخل پوشهٔ download نسخهٔ اصلاح‌شده را دارند
> (ROOT حالا از محل خود اسکریپت کشف می‌شود). اگر فایل قدیمی روی سرورت هست،
> اول «پچ فوری» پایین همین راهنما را اجرا کن، بعد مراحل اصلی.

## مشکل چه بود؟
ویدیوها روی سرور آپلود شده بودند (`public/videos/exercises/<id>.mp4` و `<id>-f.mp4`)
اما ستون‌های `mwVideoUrl` / `mwVideoUrlFemale` دیتابیس خالی بودند → بانک حرکات ویدیو
نشان نمی‌داد. (چالش‌ها سالم بودند چون نقشهٔ ویدیوهایشان داخل کد است.)

## پچ فوری اسکریپت قدیمی روی سرور (اگر نمی‌خواهی فایل جدید بریزی)

```bash
cd /var/www/fitup
python3 - <<'PYEOF'
p = "scripts/mw-wire-videos.mjs"
s = open(p, encoding="utf-8").read()
if "/home/z/my-project" not in s:
    print("OK — قبلاً پچ شده، کاری لازم نیست")
else:
    s = s.replace('const ROOT = "/home/z/my-project";',
                  'const HERE = path.dirname(fileURLToPath(import.meta.url));\nconst ROOT = path.resolve(HERE, "..");')
    s = s.replace('import path from "node:path";',
                  'import path from "node:path";\nimport { fileURLToPath } from "node:url";', 1)
    open(p, "w", encoding="utf-8").write(s)
    print("PATCHED OK — مسیر سندباکس حذف شد")
PYEOF
```

## راه‌حل — روش پیشنهادی (بدون تعویض دیتابیس، بدون از دست رفتن هیچ دیتایی)

روی سرور تولید:

```bash
cd /var/www/fitup

# ۱) بکاپ فوری از دیتابیس
cp db/custom.db db/custom-backup-$(date +%Y%m%d-%H%M).db

# ۲) توقف موقت اپ
pm2 stop fitup

# ۳) اول فقط گزارش (هیچ تغییری نمی‌کند) — اعداد را ببین
node scripts/mw-wire-videos.mjs --scan --dry

# ۴) اعمال واقعی (+ بکاپ خودکار دیتابیس)
node scripts/mw-wire-videos.mjs --scan

# ۵) اجرای مجدد اپ
pm2 restart fitup
```

خروجی مورد انتظار اسکریپت:
```
📋 ردیف‌های بانک حرکات: ۵۷۳
   دارای ویدیوی اختصاصی (دست‌نخورده): ۱۰۹
📁 اسکن دیسک: ~۴۲۹ شناسه — ~۴۲۹ مرد، ~۴۱۱ زن
🔗 به‌روزرسانی می‌شوند: ~۳۳۶ (mwVideoUrl: ~۳۳۶، mwVideoUrlFemale: ~۳۲۵)
⚙️ کلید سراسری exercise_musclewiki_enabled = 1 ساخته شد (اگر نبود)
✅ تمام شد — ردیف‌های دارای mwVideoUrl: ~۳۳۶
```

نکته‌ها:
- اسکریپت **فقط** `mwVideoUrl`/`mwVideoUrlFemale` را پر می‌کند و کلید سراسری
  `exercise_musclewiki_enabled` را در صورت نبود می‌سازد — هیچ چیز دیگری دست نمی‌خورد.
- حرکاتِ دارای ویدیوی اختصاصی ادمین (۱۰۹ ردیف) عمداً دست‌نخورده می‌مانند
  (اولویت نمایش: اختصاصی > ماسل‌ویکی > یوتیوب).
- اسکریپت قابل اجرای مجدد است (idempotent) — هر وقت ویدیوی جدیدی آپلود کردید
  دوباره اجرایش کنید تا ردیف‌های تازه هم وصل شوند.
- حالت بدون تغییر (فقط گزارش): `node scripts/mw-wire-videos.mjs --scan --dry`

## روش جایگزین — تعویض کامل دیتابیس

فایل `fitup-db-2026-10-04-mw-wired.gz` نسخهٔ پچ‌شدهٔ همین دیتابیس سایت است
(اسنپ‌شات ۱۴:۵۵ روز جاری + ویدیوهای متصل‌شده). اگر به‌جای اسکریپت می‌خواهید
کل دیتابیس را جایگزین کنید:

```bash
cd /var/www/fitup
cp db/custom.db db/custom-backup-$(date +%Y%m%d-%H%M).db
pm2 stop fitup
gunzip -kf fitup-db-2026-10-04-mw-wired.gz
cp fitup-db-2026-10-04-mw-wired db/custom.db
pm2 restart fitup
```

⚠️ توجه: در این روش هر سفارش/کاربری که بعد از ساعت ۱۴:۵۵ ثبت شده باشد از دست
می‌رود — روش اسکریپت (بالا) امن‌تر است.

## راستی‌آزمایی بعد از دیپلوی

```bash
# صفحهٔ عمومی بانک حرکات باید «۵۶۷ حرکت با ویدیوی آموزشی» نشان دهد
curl -s https://fittup.ir/exercises | grep -o "[۰-۹]* حرکت با ویدیوی آموزشی" | head -1

# یک ویدیوی MW باید 200 بدهد
curl -sI https://fittup.ir/videos/exercises/seed_ex_6.mp4 | head -1

# جزئیات حرکت باید مسیر ویدیو + کپشن ماسل‌ویکی داشته باشد
curl -s https://fittup.ir/exercise/seed_ex_6 | grep -c "متعلق به سایت ماسل ویکی"
```
