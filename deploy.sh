#!/bin/bash
set -e

echo "🚀 شروع دیپلوی..."
cd /var/www/fitup

# ۰. خودترمیمی (v22): استخراج idempotent جدیدترین زیپ + جایگزینی امن deploy.sh
# درس باگ v21 روی سرور: unzip دستی ناقص/قطع‌شده فقط بخشی از فایل‌ها را باز کرد
# و .deploy-manifest.txt قدیمی روی دیسک ماند → پاک‌سازی stale دو فایلِ «جدیدِ»
# v21 را قدیمی پنداشت و حذف کرد → خطای build «Module not found».
# v22: همیشه (نه فقط وقتی src غایب است) جدیدترین زیپ کامل extract می‌شود تا
# دیسک دقیقاً با زیپ همگام بماند — شامل مانیفست.
LATEST_ZIP=$(ls -t fitup-deploy-*.zip 2>/dev/null | head -1 || true)
if [ -n "$LATEST_ZIP" ]; then
  echo "📦 زیپ دیپلوی: $LATEST_ZIP — استخراج idempotent همهٔ فایل‌ها (به‌جز deploy.sh)..."
  if ! unzip -oq "$LATEST_ZIP" -x deploy.sh; then
    echo "❌ استخراج زیپ شکست خورد (احتمال کمبود فضا؟) — دیپلوی متوقف شد."
    df -h /var/www/fitup 2>/dev/null || true
    exit 1
  fi
  # deploy.sh خودش از unzip مستثنی است: بازنویسی اسکریپتِ در حالِ اجرا باعث
  # خرابی bash می‌شود. اگر نسخهٔ زیپ جدیدتر است → جایگزین + exec مجدد خودکار.
  unzip -p "$LATEST_ZIP" deploy.sh > deploy.sh.zipnew 2>/dev/null || true
  if [ -s deploy.sh.zipnew ] && ! cmp -s deploy.sh.zipnew deploy.sh; then
    if [ "$DEPLOY_REEXEC" = "1" ]; then
      echo "  ⚠ deploy.sh زیپ با نسخهٔ در حال اجرا فرق دارد ولی قبلاً exec شده — ادامه با نسخهٔ فعلی"
    else
      echo "  🔄 deploy داخل زیپ جدیدتر از نسخهٔ در حال اجراست — جایگزینی و اجرای مجدد..."
      cp deploy.sh.zipnew deploy.sh && rm -f deploy.sh.zipnew
      export DEPLOY_REEXEC=1
      exec bash deploy.sh
    fi
  fi
  rm -f deploy.sh.zipnew 2>/dev/null || true
fi
if [ ! -f "prisma/schema.prisma" ] || [ ! -d "src" ]; then
  if [ -z "$LATEST_ZIP" ]; then
    echo "❌ خطا: کد پروژه (prisma/schema.prisma / src) یافت نشد و هیچ fitup-deploy-*.zip در /var/www/fitup نیست."
    echo ""
    echo "   راه حل: زیپ دیپلوی را در همین مسیر آپلود کنید، بعد:"
    echo "     cd /var/www/fitup && bash deploy.sh   (خودش زیپ را باز می‌کند)"
    echo "   یا دستی:"
    echo "     unzip -o fitup-deploy-2026-09-05-v22.zip && bash deploy.sh"
    exit 1
  else
    echo "❌ زیپ $LATEST_ZIP کامل نیست (prisma/schema.prisma / src همچنان غایب است)!"
    echo "   زیپ احتمالاً ناقص آپلود شده — دوباره آپلود کنید و bash deploy.sh را دوباره بزنید."
    exit 1
  fi
fi

# ۰-ب. گارد هویت PWA (v29 — باگ دیالوگ «مرور به‌روزرسانی» کروم)
# کروم برای WebAPKهای نصب‌شده هر بار که «نام یا آیکون» وب‌اپ تغییر کند یک
# دیالوگ تأیید هویت (با دکمهٔ حذف نصب!) نشان می‌دهد — حتی اگر تغییر عمدی نباشد
# (مثلاً re-export تصادفی لوگو با بایت‌های متفاوت). این گارد هویت PWA را هش
# می‌کند و اگر بین دیپلوی‌ها تغییر کرده باشد با هشدار بزرگ اطلاع می‌دهد تا
# «هیچ‌وقت» تصادفی تغییر نکند. دیپلوی fail نمی‌شود — فقط هشدار صادقانه.
PWA_IDENTITY_FILES="public/manifest.json public/icon-192.png public/icon-512.png public/icon-192-maskable.png public/icon-512-maskable.png"
PWA_IDENTITY_FILE=".pwa-identity.sha256"
PWA_IDENTITY_NOW=$(cat $PWA_IDENTITY_FILES 2>/dev/null | sha256sum | awk '{print $1}')
if [ -z "$PWA_IDENTITY_NOW" ]; then
  echo "Ⓦ PWA identity: فایل‌های manifest/آیکون پیدا نشدند — گارد skip شد"
else
  PWA_IDENTITY_PREV=$(cat "$PWA_IDENTITY_FILE" 2>/dev/null || true)
  if [ -n "$PWA_IDENTITY_PREV" ] && [ "$PWA_IDENTITY_NOW" != "$PWA_IDENTITY_PREV" ]; then
    echo ""
    echo "⚠⚠ هویت PWA تغییر کرده است (manifest.json یا فایل‌های آیکون) ⚠⚠"
    echo "   کروم به «همه» کاربرانی که وب‌اپ را نصب دارند، دیالوگ تأیید هویت"
    echo "   (مرور به‌روزرسانی + گزینهٔ «حذف نصب برنامه») نشان می‌دهد."
    echo "   اگر این تغییر عمدی نیست، فایل‌های زیر را به نسخهٔ قبلی برگردانید:"
    echo "     $PWA_IDENTITY_FILES"
    echo "   (هویت قبلی: $PWA_IDENTITY_PREV — هویت جدید: $PWA_IDENTITY_NOW)"
    echo ""
  else
    echo "  ✓ هویت PWA پایدار است (بدون دیالوگ تأیید کروم برای کاربران فعلی)"
  fi
  echo "$PWA_IDENTITY_NOW" > "$PWA_IDENTITY_FILE"
fi

# ۱. پشتیبان‌گیری از دیتابیس
echo "📦 پشتیبان‌گیری از دیتابیس..."
BACKUP_DIR="/var/www/fitup/backups"
mkdir -p $BACKUP_DIR
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
cp db/custom.db "$BACKUP_DIR/db_backup_$DATE.db" 2>/dev/null || echo "  (دیتابیس در دسترس نیست)"
ls -t $BACKUP_DIR/db_backup_*.db 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
echo "  ✓ پشتیبان ذخیره شد"

# ۱-ب. پشتیبان‌گیری از «همه» رسانه‌های کاربران (v15 — قبلاً فقط articles!)
# مهم: رسانه‌های خصوصی کاربران (عکس پیشرفت/بدن، چت، ویدیو، آزمایش خون) هم
# مثل مقالات مقدس‌اند. اگر دیپلوی/rollback اتفاقی uploads را خالی کند، این
# پشتیبان نجات‌دهنده است (ریشه‌ی باگ «عکس‌های شکسته گالری پیشرفت»).
if [ -d "uploads" ]; then
  echo "🖼 پشتیبان‌گیری از کل رسانه‌ها (uploads)..."
  UPLOADS_COUNT_BEFORE=$(find uploads -type f 2>/dev/null | wc -l)
  ARTICLES_COUNT_BEFORE=$(find uploads/articles -type f 2>/dev/null | wc -l)
  mkdir -p "$BACKUP_DIR/uploads_full_backup"
  rsync -a uploads/ "$BACKUP_DIR/uploads_full_backup/" 2>/dev/null \
    || cp -rn uploads/* "$BACKUP_DIR/uploads_full_backup/" 2>/dev/null || true
  echo "  ✓ $UPLOADS_COUNT_BEFORE فایل پشتیبان شد ($ARTICLES_COUNT_BEFORE تصویر مقالات + رسانه‌های خصوصی کاربران)"
else
  UPLOADS_COUNT_BEFORE=0
  ARTICLES_COUNT_BEFORE=0
  echo "  (پوشه uploads موجود نیست)"
fi

# ۲. نصب وابستگی‌ها
echo "📦 نصب وابستگی‌ها..."
bun install

# ۲-ب. خودترمیمی DATABASE_URL در .env (v22)
# باگ واقعی سرور: DATABASE_URL به مسیر سندباکس (file:/home/z/...) اشاره می‌کرد
# → prisma دیتابیسِ خالی در آن مسیر ساخت، repair-media «۰ رفرنس رسانه» دید و
# سایت عملاً دیتابیس غلط می‌خواند؛ دیتای واقعی در /var/www/fitup/db/custom.db بود.
# این قدم فقط وقتی .env را اصلاح می‌کند که دیتابیس فعلی «خالی/گمشده» باشد و
# دیتابیس استاندارد سرور «پر از دیتا» — هیچ‌وقت دیتای واقعی را جابه‌جا نمی‌کند.
echo "🗄 بررسی سلامت DATABASE_URL..."
if bun run scripts/fix-database-url.ts; then
  echo "  ✓ بررسی DATABASE_URL انجام شد"
else
  echo "  ⚠ بررسی DATABASE_URL ناموفق بود — بعد از دیپلوی دستی چک کنید: grep DATABASE_URL .env"
fi

# ۲-ج. نصب ffmpeg — لازم برای تحلیل ویدیو در چت و آنالیز ویدیویی
# (استخراج فریم‌های ویدیو با ffmpeg انجام می‌شود؛ نبود آن باعث می‌شود مربی
#  هوشمند به کاربر «نمی‌توانم ویدیو را تحلیل کنم» بگوید!)
echo "🎬 بررسی ffmpeg..."
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "  ✓ ffmpeg از قبل نصب است"
else
  echo "  ⚠ ffmpeg نصب نیست — در حال نصب..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq 2>/dev/null || true
    apt-get install -y -qq ffmpeg 2>/dev/null && echo "  ✓ ffmpeg نصب شد" || echo "  ✗ نصب ffmpeg ناموفق بود — تحلیل ویدیو کار نمی‌کند! دستی: apt-get install -y ffmpeg"
  else
    echo "  ✗ apt-get در دسترس نیست — ffmpeg را دستی نصب کنید (الزامی برای تحلیل ویدیو):"
    echo "     Ubuntu/Debian: apt-get install -y ffmpeg"
    echo "     CentOS/RHEL:   yum install -y ffmpeg (repo EPEL/RPMFusion)"
  fi
fi

# ۳. تولید Prisma client
echo "🔧 تولید Prisma client..."
bun run db:generate

# ۴. توقف اپلیکیشن — قبل از db:push تا schema روی SQLite قفل نشود
# (قبلاً db:push با اپ زنده اجرا می‌شد → ریسک SQLITE_BUSY/lock)
# 2>/dev/null || true — در اولین دیپلوی، فرآیند fitup هنوز در pm2 ثبت نشده
# و exit code غیرصفر نباید اسکریپت را با set -e قطع کند.
echo "⏹ توقف اپلیکیشن..."
pm2 stop fitup 2>/dev/null || true

# ۵. اعمال تغییرات schema
# ⚠️ بعد از توقف اپ — برای جلوگیری از تداخل قفل SQLite
# اگر db:push شکست بخورد صدای آن را پنهان نمی‌کنیم (باگ v9: پنهان‌شدن
# خطا باعث قطع لاگین روی سرور شد چون ستون lastActiveAt ساخته نشده بود)
echo "📊 اعمال تغییرات schema..."
if bun run db:push 2>&1; then
  echo "  ✓ schema اعمال شد"
else
  echo "  ⚠ db:push با خطا مواجه شد — ادامه می‌دهیم (جایگزین: خودترمیمی DB بعد از boot ستون‌های ضروری را اضافه می‌کند)"
fi

# ۶. انتقال رسانه‌های قدیمی از public/uploads (فقط یک‌بار — مهاجرت امن)
# مهم: رسانه‌های خصوصی کاربران (عکس بدن، چت، ویدیو، آزمایش خون و…) از
# نسخه‌های قدیمی در public/uploads بودند. این قدم همه دسته‌ها را به‌صورت
# امن به uploads/ منتقل می‌کند و فقط وقتی public/uploads را حذف می‌کند که
# هیچ فایل جامانده‌ای داخلش نباشد (بدون از دست رفتن حتی یک فایل کاربر).
if [ -d "public/uploads" ] && [ ! -L "public/uploads" ]; then
  echo "📁 مهاجرت رسانه‌های قدیمی از public/uploads به uploads/..."
  for category in articles body-analysis body-photos blood-tests chat meal-analysis progress videos; do
    if [ -d "public/uploads/$category" ]; then
      mkdir -p "uploads/$category"
      # -n: فایل موجود را بازنویسی نکن (نسخه جدیدتر در uploads برنده است)
      cp -rn "public/uploads/$category/." "uploads/$category/" 2>/dev/null || true
      echo "  ✓ $category منتقل شد ($(find "public/uploads/$category" -type f 2>/dev/null | wc -l) فایل)"
    fi
  done
  # زیرپوشه TTS چت (chat/tts)
  if [ -d "public/uploads/chat/tts" ]; then
    mkdir -p "uploads/chat/tts"
    cp -rn "public/uploads/chat/tts/." "uploads/chat/tts/" 2>/dev/null || true
  fi
  # فقط وقتی حذف کن که هیچ فایلی در هیچ زیرپوشه‌ای باقی نمانده باشد
  REMAINING=$(find public/uploads -type f 2>/dev/null | wc -l)
  if [ "$REMAINING" -eq 0 ]; then
    rm -rf public/uploads
    echo "  ✓ مهاجرت کامل شد و public/uploads حذف شد"
  else
    echo "  ⚠ $REMAINING فایل شناسایی‌نشده در public/uploads باقی مانده — پوشه حفظ شد (حذف نشد)"
  fi
fi

# ۶-ب-۲. ترمیم رسانه‌های گم‌شده کاربران (v15 — ریشه‌ی باگ «عکس شکسته گالری»)
# رکوردهایی که فایلشان یا در public/uploads مانده یا در پشتیبان backup است
# بازیابی می‌شوند؛ گزارش دقیق چاپ می‌شود. اسکریپت فقط فایل کپی می‌کند —
# هیچ رکورد DB حذف نمی‌شود.
echo "🔧 ترمیم رسانه‌های کاربران..."
bun run scripts/repair-user-media.ts 2>&1 | tail -8 || echo "  (skip — ترمیم ناموفق ولی دیپلوی ادامه می‌یابد)"

# ۶-ب. پاک‌سازی فایل‌های stale — منبع حقیقت: خودِ زیپ (v22)
# مهم: unzip فایل‌های حذف‌شده را پاک نمی‌کند! اگر کد قدیمی روی سرور بماند،
# next build هنگام TypeScript با خطای تایپ شکست می‌خورد (مثل smart-nav.ts).
# ⚠️ باگ v21 روی سرور: مانیفست روی دیسک قدیمی مانده بود (unzip ناقص) → دو
# فایل جدیدِ v21 «stale» پنداشته شدند، حذف شدند و build با Module not found مرد!
# v22: فهرست فایل‌های مجاز = محتوای جدیدترین زیپ (unzip -Z1) ∪ مانیفست.
# هیچ فایلی که در زیپ هست حذف نمی‌شود — حتی اگر مانیفست غلط/قدیمی باشد.
# (db/uploads/public دست نمی‌خورند — دیتای کاربر و رسانه‌ها مقدس‌اند.)
if [ -n "$LATEST_ZIP" ] || [ -f ".deploy-manifest.txt" ]; then
  echo "🧹 پاک‌سازی فایل‌های قدیمی (stale)..."
  ALLOWED_FILES=$(
    {
      if [ -n "$LATEST_ZIP" ]; then
        unzip -Z1 "$LATEST_ZIP" 2>/dev/null | grep -v '/$' || true
      fi
      if [ -f ".deploy-manifest.txt" ]; then
        tr ' ' '\n' < .deploy-manifest.txt || true
      fi
    } | grep -v '^$' | LC_ALL=C sort -u
  )
  STALE_COUNT=0
  if [ -n "$ALLOWED_FILES" ]; then
    while IFS= read -r stale_file; do
      case "$stale_file" in
        src/*|prisma/*|scripts/*)
          if [ -f "$stale_file" ]; then
            rm -f "$stale_file"
            STALE_COUNT=$((STALE_COUNT + 1))
            echo "  🗑 حذف stale: $stale_file"
          fi
          ;;
      esac
    done < <(LC_ALL=C comm -23 <(find src prisma scripts -type f 2>/dev/null | LC_ALL=C sort) <(printf '%s\n' "$ALLOWED_FILES" | LC_ALL=C sort -u))
  fi
  if [ "$STALE_COUNT" -eq 0 ]; then
    echo "  ✓ فایل stale ای وجود ندارد"
  else
    echo "  ✓ $STALE_COUNT فایل قدیمی حذف شد"
  fi
else
  echo "ℹ زیپ و مانیفست موجود نیستند — پاک‌سازی stale رد شد (امن است)"
fi

# ۶-ج. فایل‌های کد قدیمی در upload/ — از نسخه‌های خیلی قدیمی مانده‌اند
# (tsconfig جدید فقط src/scripts را تایپ‌چک می‌کند، ولی این فایل‌ها زباله‌اند و پاک می‌شوند.
#  فقط *.ts/*.tsx حذف می‌شود — دیتابیس یا فایل‌های دیگر upload/ دست نمی‌خورند.)
if [ -d "upload" ]; then
  STRAY_CODE=$(find upload -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null | wc -l)
  if [ "$STRAY_CODE" -gt 0 ]; then
    find upload -type f \( -name "*.ts" -o -name "*.tsx" \) -delete
    echo "  🗑 $STRAY_CODE فایل کد قدیمی از upload/ حذف شد (کپی stale از نسخه‌های قبلی)"
  else
    echo "  ✓ فایل کد قدیمی در upload/ نیست"
  fi
fi

# ۷. کنار گذاشتن build قدیمی (v22 — نه rm؛ برای rollback اگر build شکست خورد)
# باگ v21 روی سرور: build شکست خورد، .next قبلی از قبل rm شده بود و pm2 هم
# stop بود → سایت تا دیپلوی موفق بعدی خاموش ماند. حالا build قبلی فقط
# rename می‌شود تا در صورت خطا برگردد.
rm -rf .next.old 2>/dev/null || true
if [ -d ".next" ]; then
  mv .next .next.old
  echo "🗑 build قدیمی کنار گذاشته شد (.next.old — برای rollback)"
fi

# ۸. build جدید — اگر شکست خورد: build قبلی برمی‌گردد و سایت بالا می‌ماند
# ⚠️ v25: build صریحاً با **webpack** اجرا می‌شود، نه Turbopack.
# علت (باگ واقعی دیپلوی v24 روی سرور): Turbopack — پیش‌فرض Next 16 — وسط build
# با پنیک داخلی خودش مرد: «Dependency tracking is disabled so invalidation is
# not allowed at turbo-tasks-backend/src/backend/mod.rs» (باگ داخلی Turbopack،
# خارج از کد پروژه). کل پروژه از ابتدا با webpack توسعه و تست شده
# (next dev --webpack) — پس پروداکشن هم روی webpack قفل می‌شود.
# مستقیم باینری محلی next صدا زده می‌شود چون اسکریپت build در package.json
# سرور قابل تغییر نیست (package.json جزو زیپ دیپلوی نیست)؛ دستورهای کپی
# static/public هم در قدم ۹ همین اسکریپت عیناً وجود دارد.
# (باگ فرعی فیکس شد: comm بدون LC_ALL=C با ترتیب sort ناسازگار بود و
# «comm: file is not in sorted order» می‌داد — نتیجه پاک‌سازی stale غیرقابل‌اتکا)
echo "🔨 Build جدید (webpack)…"
if NODE_ENV=production ./node_modules/.bin/next build --webpack; then
  rm -rf .next.old 2>/dev/null || true
  echo "  ✓ build موفق"
else
  echo "❌ Build شکست خورد — بازگردانی build قبلی و روشن نگه‌داشتن سایت..."
  rm -rf .next 2>/dev/null || true
  if [ -d ".next.old" ]; then
    mv .next.old .next
    pm2 restart fitup 2>/dev/null || true
    echo "  ✓ سایت با build قبلی بالا نگه داشته شد — خطای بالا را ریشه‌یابی کنید و دوباره دیپلوی بزنید"
  else
    echo "  ⚠ build قبلی وجود نداشت — سایت تا دیپلوی موفق بعدی خاموش است"
  fi
  exit 1
fi

# ۹. کپی static و public
echo "📁 کپی static و public..."
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# ۹-ب. رسانه‌ها در خروجی build (v21 — لایه دوم امنیت سرو عکس‌های مقالات)
# ⚠️ درس باگ پروداکشن: rewrite های next.config (/uploads/* → /api/serve-upload/*)
# در بیلد standalone روی سرور اعمال نمی‌شدند → همهٔ عکس‌های مقالات ۴۰۴!
# فیکس اصلی v21: route واقعی src/app/uploads/[...path]/route.ts (داخل خود اپ).
# این قدم لایه دوم است: کپی «فقط articles» (محتوای عمومی) به public بیلد تا
# به‌صورت static هم سرو شوند — static serving روی سرور اثباتاً کار می‌کند.
# ⚠️ امنیت: فقط articles/ کپی می‌شود — رسانه‌های خصوصی کاربران (chat،
# body-photos، blood-tests، …) هرگز static سرو نمی‌شوند (فقط از route با auth).
LEFTOVER_IN_BUILD=$(find .next/standalone/public/uploads -type f 2>/dev/null | wc -l)
if [ "$LEFTOVER_IN_BUILD" -gt 0 ]; then
  echo "  ⚠ $LEFTOVER_IN_BUILD فایل جامانده public/uploads از بیلد پاک شد (سرو بدون auth فقط برای articles مجاز است)"
fi
rm -rf .next/standalone/public/uploads
if [ -d "uploads/articles" ]; then
  ARTICLES_TO_STATIC=$(find uploads/articles -type f 2>/dev/null | wc -l)
  mkdir -p .next/standalone/public/uploads
  cp -rn uploads/articles .next/standalone/public/uploads/ 2>/dev/null || true
  echo "  ✓ $ARTICLES_TO_STATIC تصویر مقاله به static public بیلد اضافه شد (لایه دوم + کش CDN)"
fi

# ۱۰. کپی فایل‌های پیکربندی
echo "📁 کپی فایل‌های پیکربندی..."
cp .env .next/standalone/.env 2>/dev/null || echo "  (.env وجود ندارد)"
mkdir -p .next/standalone/db
cp db/custom.db .next/standalone/db/custom.db 2>/dev/null || echo "  (دیتابیس وجود ندارد)"
# حفظ کلید سشن بین دیپلوی‌ها — کاربران بعد از دیپلوی لاگین می‌مانند.
# (اگر SESSION_SECRET در .env باشد این فایل استفاده نمی‌شود؛ کپی صرفاً برای
#  حالت خودکار db/.session-secret است که کد auth.ts آن را تولید می‌کند.)
cp db/.session-secret .next/standalone/db/.session-secret 2>/dev/null || true
echo "  ✓ فایل‌های پیکربندی کپی شد"

# ۱۱. symlink برای uploads (عکس‌ها مستقل از build باقی می‌مانند)
echo "📁 ایجاد symlink برای uploads..."
rm -rf .next/standalone/uploads 2>/dev/null || true
ln -sfn /var/www/fitup/uploads .next/standalone/uploads
echo "  ✓ symlink ایجاد شد"

# ۱۲. اصلاح URL‌های عکس در دیتابیس
echo "🔧 اصلاح URL‌های عکس..."
bun run src/lib/fitness/fix-article-image-urls.ts 2>&1 | tail -3 || echo "  (skip)"

# ۱۲-ب. بازگرداندن inline images گم شده
echo "🔄 بازگرداندن inline images گم شده..."
bun run src/lib/fitness/restore-missing-inlines.ts 2>&1 | tail -3 || echo "  (skip)"

# ۱۲-ج. به‌روزرسانی سال‌های مقالات (2024/1403 → 2026/1405)
echo "📅 به‌روزرسانی سال‌های مقالات..."
bun run src/lib/fitness/update-article-years.ts 2>&1 | tail -3 || echo "  (skip)"

# ۱۲-ج۲. تعمیر ویدیوهای خراب بانک حرکات (v28 — idempotent؛ درخواست مالک:
# «هیچ حرکتی بدون ویدیوی آموزشی نباشد» — ۲۱۲ حرکت ID ساختگی داشتند)
echo "🎬 تعمیر ویدیوهای بانک حرکات..."
bun run scripts/fix-exercise-videos.ts --apply 2>&1 | tail -4 || echo "  (skip — فایل مپینگ نیست)"

# ۱۲-د. انتشار اپ اندروید اختصاصی (v16 — idempotent)
# فایل public/downloads/fitup-own-version.txt دقیقاً «versionName versionCode» را
# مشخص می‌کند (همان اعدادی که در build.gradle.kts ساخته شده) — فرمول حدس‌زدن
# ندارد. اگر نسخه از قبل فعال باشد، اسکریپت هیچ کاری نمی‌کند (اجرای دوباره امن).
echo "📱 انتشار اپ اندروید اختصاصی..."
if [ -f "public/downloads/fitup-own-version.txt" ] && ls public/downloads/fitup-own-v*.apk >/dev/null 2>&1; then
  OWN_VER=$(awk '{print $1}' public/downloads/fitup-own-version.txt | tr -d '[:space:]')
  OWN_CODE=$(awk '{print $2}' public/downloads/fitup-own-version.txt | tr -d '[:space:]')
  if [ -n "$OWN_VER" ] && [ -n "$OWN_CODE" ]; then
    if bun run scripts/publish-own-app.ts "$OWN_VER" "$OWN_CODE" 2>&1 | tail -2; then
      echo "  ✓ اپ اختصاصی بررسی/منتشر شد ($OWN_VER / code $OWN_CODE)"
    else
      echo "  ⚠ انتشار اپ اختصاصی ناموفق — بعداً دستی: bun run scripts/publish-own-app.ts $OWN_VER $OWN_CODE"
    fi
  fi
else
  echo "  (APK/نسخهٔ اپ اختصاصی در public/downloads نیست — skip)"
fi

# ۱۳. ری‌استارت اپلیکیشن
# 2>/dev/null || true — اگر فرآیند fitup در pm2 ثبت نشده باشد (اولین دیپلوی)،
# اسکریپت نباید اینجا قطع شود؛ health check پایانی وضعیت را مشخص می‌کند.
echo "▶ ری‌استارت اپلیکیشن..."
pm2 restart fitup 2>/dev/null || echo "  ⚠ فرآیند fitup در pm2 موجود نیست — با pm2 start/ecosystem راه‌اندازی کنید"

# ۱۴. ذخیره تنظیمات pm2
echo "💾 ذخیره تنظیمات pm2..."
pm2 save

# ۱۵. تست — بررسی واقعی کد HTTP (قبلاً فقط چاپ می‌شد و خطا نادیده گرفته می‌شد)
echo "🔍 تست سلامت اپلیکیشن..."
sleep 3
HTTP_CODE=000
for i in 1 2 3 4 5; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
  if [ "$HTTP_CODE" = "200" ]; then
    break
  fi
  echo "  تلاش $i: HTTP $HTTP_CODE — ۵ ثانیه صبر و تلاش مجدد..."
  sleep 5
done
if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ دیپلوی ناموفق: اپلیکیشن با کد HTTP $HTTP_CODE پاسخ داد (انتظار ۲۰۰)"
  echo "  آخرین خطاهای pm2:"
  pm2 logs fitup --err --lines 20 --nostream 2>/dev/null || true
  exit 1
fi
echo "  ✓ HTTP Status: $HTTP_CODE"

# ۱۵.۵. بررسی سلامت sitemap — باید ۱۳۰۰+ URL داشته باشد نه فقط ۷ صفحات ثابت
# (باگ پروداکشن: یک خطای DB → sitemap فقط صفحات ثابت برمی‌گرداند. حالا sitemap
# خودترمیم‌شو per-section است؛ این چک صادقانه هشدار می‌دهد اگر باز هم بخشی شکست خورده باشد.)
echo "🗺 بررسی sitemap.xml..."
SITEMAP_URL_COUNT=$( (curl -s --max-time 90 http://localhost:3000/sitemap.xml || true) | (grep -o '<loc>' || true) | wc -l )
if [ "$SITEMAP_URL_COUNT" -lt 20 ]; then
  echo ""
  echo "Ⓦ SITEMAP PROBLEM: sitemap.xml فقط $SITEMAP_URL_COUNT URL دارد (انتظار: ۱۳۰۰+) — بخش‌های دیتابیس (مقالات/حرکات/غذاها) احتمالاً شکست خورده‌اند!"
  echo "   برای ریشه‌یابی، لاگ‌های pm2 را برای خطاهای [sitemap] بررسی کنید:"
  echo "     pm2 logs fitup --lines 100 --nostream 2>/dev/null | grep '\\[sitemap\\]'"
  echo "   (دیپلوی fail نمی‌شود — sitemap بعد از رفع مشکل DB با کش ۱ ساعته خودش ترمیم می‌شود)"
  echo ""
else
  echo "  ✓ sitemap.xml: $SITEMAP_URL_COUNT URL"
fi

# ۱۶. بازگردانی خودکار تصاویر اگر در دیپلوی گم شده‌اند
# (مقایسه فقط روی uploads/articles — قبلاً کل uploads با articles مقایسه می‌شد و
#  همیشه هشدار کاذب می‌داد؛ مسیر پشتیبان هم اشتباه بود: uploads_backup → uploads_full_backup)
ARTICLES_COUNT_AFTER=$(find uploads/articles -type f 2>/dev/null | wc -l)
if [ "$ARTICLES_COUNT_BEFORE" -gt 0 ] && [ "$ARTICLES_COUNT_AFTER" -lt "$ARTICLES_COUNT_BEFORE" ]; then
  echo "⚠ تعداد تصاویر مقالات کاهش یافته ($ARTICLES_COUNT_BEFORE → $ARTICLES_COUNT_AFTER) — بازگردانی از پشتیبان..."
  mkdir -p uploads/articles
  if [ -d "$BACKUP_DIR/uploads_full_backup/articles" ]; then
    cp -rn "$BACKUP_DIR/uploads_full_backup/articles/." uploads/articles/ 2>/dev/null || true
  fi
  ARTICLES_COUNT_RECOVERED=$(find uploads/articles -type f 2>/dev/null | wc -l)
  echo "  ✓ بازگردانی شد: $ARTICLES_COUNT_RECOVERED فایل"
fi

# ۱۶-ب. هشدار جدی اگر تصاویر مقالات کلاً غایب است (v18)
# اگر DB مقاله با کاور دارد ولی uploads/articles خالی است، همه عکس‌ها ۴۰۴ می‌شوند.
# سرویس خودترمیم در بوت بعدی با کش/تولید AI ترمیم می‌کند ولی ادمین باید بداند.
FINAL_ARTICLES_COUNT=$(find uploads/articles -type f 2>/dev/null | wc -l)
if [ "$FINAL_ARTICLES_COUNT" -lt 20 ]; then
  echo ""
  echo "Ⓦ WARNING: فقط $FINAL_ARTICLES_COUNT فایل تصویر مقاله در uploads/articles است!"
  echo "   اگر مقالات سایت بدون عکس نمایش داده می‌شوند، زیپ v18+ را unzip -o کنید که uploads/articles کامل را دارد"
  echo "   (سرویس خودترمیم رسانه در بوت هم کاورها/inline های باقی‌مانده را ترمیم/تولید می‌کند)"
  echo ""
fi
# نکته: سرویس خودترمیم رسانه (article-media-selfheal) هنگام boot سرور هم همه
# کاورها/inline های مفقود را به‌صورت خودکار ترمیم می‌کند (با کش آینه‌ای بدون هزینه).

echo ""
echo "🎉 دیپلوی کامل شد!"
echo "  - دیتابیس: $(ls -lh db/custom.db 2>/dev/null | awk '{print $5}')"
echo "  - پشتیبان‌ها: $(ls backups/*.db 2>/dev/null | wc -l) فایل"
echo "  - تصاویر مقالات: $(find uploads -type f 2>/dev/null | wc -l) فایل"
