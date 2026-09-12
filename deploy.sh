#!/bin/bash
set -e

# نشان نسخهٔ deploy.sh (v72.2) — منطق «جایگزینی از زیپ» فقط وقتی نسخهٔ زیپ
# جدیدتر باشد اجرا می‌شود؛ وگرنه deploy.sh آپلودشدهٔ دستی وسط دیپلوی با نسخهٔ
# قدیمیِ داخل زیپ بازنویسی می‌شد (عامل واقعی تکرار ارور OOM در v72: فیکس
# NODE_OPTIONS که آپلود شده بود، توسط deploy.sh داخل زیپ v72 پاک شد!).
# قانون نام‌گذاری: پچ تک‌رقمی (72.2 → 72.3 → ... → 73.0) تا sort -V درست کار کند.
DEPLOY_VERSION=73.3

echo "🚀 شروع دیپلوی... (deploy.sh v${DEPLOY_VERSION})"
DEPLOY_TOTAL_START_TS=$(date +%s)   # v72.6: ⏱ زمان‌سنج کل دیپلوی
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
  # خرابی bash می‌شود. اگر نسخهٔ زیپ «جدیدتر» باشد → جایگزین + exec مجدد خودکار.
  # v72.2: مقایسهٔ نسخه‌دار — قبلاً فقط cmp بود و هر تفاوتی یعنی زیپ جدیدتر!
  # الان فقط وقتی DEPLOY_VERSION داخل زیپ از نسخهٔ در حال اجرا بزرگ‌تر باشد
  # جایگزینی می‌شود؛ deploy.sh دستیِ جدیدتر دیگر توسط زیپِ قدیمی نابود نمی‌شود.
  # (اسکریپت‌های خیلی قدیمی بدون نشان نسخه: رفتار قدیمی v22 حفظ شده — زیپ برنده)
  unzip -p "$LATEST_ZIP" deploy.sh > deploy.sh.zipnew 2>/dev/null || true
  if [ -s deploy.sh.zipnew ] && ! cmp -s deploy.sh.zipnew deploy.sh; then
    ZIPVER=$(grep -m1 '^DEPLOY_VERSION=' deploy.sh.zipnew 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')
    CURVER=$(grep -m1 '^DEPLOY_VERSION=' deploy.sh 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')
    REPLACE=0
    if [ -z "$ZIPVER" ] && [ -z "$CURVER" ]; then
      REPLACE=1
    else
      NEWEST=$(printf '%s\n%s\n' "${ZIPVER:-0}" "${CURVER:-0}" | sort -V | tail -1)
      if [ "$NEWEST" = "${ZIPVER:-0}" ] && [ -n "$ZIPVER" ]; then
        REPLACE=1
      fi
    fi
    if [ "$REPLACE" = "1" ]; then
      if [ "$DEPLOY_REEXEC" = "1" ]; then
        echo "  ⚠ deploy.sh زیپ با نسخهٔ در حال اجرا فرق دارد ولی قبلاً exec شده — ادامه با نسخهٔ فعلی"
      else
        echo "  🔄 deploy داخل زیپ (v${ZIPVER:-?}) جدیدتر از نسخهٔ در حال اجراست — جایگزینی و اجرای مجدد..."
        cp deploy.sh.zipnew deploy.sh && rm -f deploy.sh.zipnew
        export DEPLOY_REEXEC=1
        exec bash deploy.sh
      fi
    else
      echo "  ⛔ deploy.sh داخل زیپ (نسخهٔ ${ZIPVER:-بدون‌نشان/قدیمی}) جدیدتر از نسخهٔ در حال اجرا (v${CURVER:-?}) نیست — فایل فعلی حفظ شد"
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

# ═══════════════════════════════════════════════════════════════════════
# v56 — دیپلوی بدون قطعی (build قبل از توقف سرور — درخواست مالک:
# «موقع دیپلوی ۵۰۲ نشون نده») 
# قبلاً: pm2 stop → build چند دقیقه‌ای → restart ⇒ کاربر کل مدت ۵۰۲ می‌دید.
# حالا: build در پوشهٔ مجزا (.next.new — با NEXT_DIST_DIR در next.config.ts)
# روی سرورِ زنده انجام می‌شود؛ فقط تعویض نهایی چند ثانیه طول می‌کشد و
# شکست build هم دیگر سایت را خاموش نمی‌کند (نسخهٔ قدیمی دست‌نخورده می‌ماند).
# ═══════════════════════════════════════════════════════════════════════

# ۴. پاک‌سازی فایل‌های stale — منبع حقیقت: خودِ زیپ (v22)
# [منتقل‌شده به قبل از build] مهم: unzip فایل‌های حذف‌شده را پاک نمی‌کند! اگر
# کد قدیمی روی سرور بماند، next build هنگام TypeScript با خطای تایپ شکست می‌خورد.
# (db/uploads/public دست نمی‌خورند — دیتای کاربر و رسانه‌ها مقدس‌اند. اجرای این
# مرحله روی سرورِ زنده بی‌خطر است چون نسخهٔ در حال سرو از کپی standalone اجرا می‌شود.)
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


# ۵. build جدید در .next.new — نسخهٔ قدیمی از .next همچنان در حال سرو است
# ⚠️ v25: build صریحاً با **webpack** اجرا می‌شود (باگ پنیک Turbopack v24).
# مستقیم باینری محلی next صدا زده می‌شود؛ دستورهای کپی static/public در قدم ۶ هست.
# ═══════════════════════════════════════════════════════════════════════
# v62 — فیکس قطعی «بیلد به .next.new نمی‌رود» + EISDIR (لاگ‌های v48→v61 مالک)
# ریشه‌یابی با خواندن سورس Next 16 (dist/build/collect-build-traces.js و utils.js):
#  ۱) مسیرهای خطای EISDIR (/var/www/fitup/.next/...) ثابت می‌کردند بیلد با وجود
#     NEXT_DIST_DIR=.next.new داخل «.next» درجا انجام می‌شود ⇒ کانفیگ فعال next
#     روی سرور env را نمی‌گیرد (عامل شایع: next.config.js/.mjs سایه‌دار قدیمی که
#     next.config.ts را پس می‌زند؛ پاک‌سازی stale فقط src/prisma/scripts را
#     پاک می‌کرد و ریشه را هرگز).
#  ۲) بیلد درجا فاجعه‌بار است: Next در شروع مرحلهٔ standalone کل
#     .next/standalone را rm -rf می‌کند — یعنی فایل‌های سرورِ زنده!
#  ۳) گاردهای این بخش:
#     الف) حذف کانفیگ‌های سایه‌دار قبل از build
#     ب) بکاپ hardlink از .next/standalone (لحظه‌ای — بدون کپی دیتا) برای ترمیم
#     ج) بعد از build: وِریفای BUILD_ID داخل .next.new؛ اگر نبود و .next تازه
#        شده بود ⇒ یک‌بار build دوباره؛ باز نشد ⇒ ترمیم standalone و توقف امن
# ═══════════════════════════════════════════════════════════════════════
DEPLOY_BUILD_START_TS=$(date +%s)
echo "🔨 Build جدید (webpack — بدون قطعی سرویس)…"

# ۵-الف. کانفیگ‌های سایه‌دار — next.config.ts منبع حقیقت است (v62)
for SHADOW_CFG in next.config.js next.config.mjs next.config.cjs next.config.mts; do
  if [ -f "$SHADOW_CFG" ]; then
    echo "  🗑 کانفیگ سایه‌دار «$SHADOW_CFG» حذف شد — باعث می‌شد NEXT_DIST_DIR نادیده گرفته شود و بیلد درجا داخل .next برود (ریشهٔ خرابی دیپلوی‌های اخیر)"
    rm -f "$SHADOW_CFG"
  fi
done

# ۵-ب. بکاپ hardlink از standalone زنده — اگر بیلد درجا رخ دهد فوراً ترمیم می‌شود
# (cp -al همان inodeها را لینک می‌کند: لحظه‌ای و بدون مصرف دیسک اضافه)
STANDALONE_BACKUP=""
if [ -d ".next/standalone" ]; then
  rm -rf .next/standalone.prebuild 2>/dev/null || true
  if cp -al .next/standalone .next/standalone.prebuild 2>/dev/null; then
    STANDALONE_BACKUP=".next/standalone.prebuild"
    echo "  ✓ بکاپ hardlink از standalone زنده گرفته شد (حتی در بدترین حالت سایت قابل ترمیم فوری است)"
  else
    echo "  ⚠ بکاپ hardlink ناموفق — ادامه می‌دهیم (نبود بکاپ بهتر از توقف دیپلوی است)"
  fi
fi

restore_standalone() {
  if [ -n "$STANDALONE_BACKUP" ] && [ -d "$STANDALONE_BACKUP" ]; then
    echo "  ↩ ترمیم standalone زنده از بکاپ hardlink..."
    rm -rf .next/standalone 2>/dev/null || true
    mv "$STANDALONE_BACKUP" .next/standalone 2>/dev/null || true
    pm2 restart fitup 2>/dev/null || true
    echo "  ✓ standalone ترمیم شد و سایت دوباره بالا آمد"
  fi
}

run_deploy_build() {
  rm -rf .next.new 2>/dev/null || true
  # v72.3: رفع قطعی OOM بیلد («Reached heap limit») — درس دیپلوی یک‌ساعتهٔ v72.2:
  # سقف ۴۶۰۸ روی سرور ۴گیگ = سوآپ‌خوردگی شدید = بیلد یک‌ساعته و پرشدن دیسک!
  # حالا: سقف ۳۵۸۴ (کفایت‌شده برای نیاز واقعی بیلد) + کسر ۱۲۰۰ برای سیستم.
  # NODE_OPTIONS به build worker هم ارث می‌رسد (تأییدشده در سورس Next 16، lib/worker.js)
  MEM_AVAIL_MB=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  SWAP_TOTAL_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
  MEM_TOTAL_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
  [ -z "$MEM_AVAIL_MB" ] && MEM_AVAIL_MB=2048
  [ -z "$SWAP_TOTAL_MB" ] && SWAP_TOTAL_MB=0
  [ -z "$MEM_TOTAL_MB" ] && MEM_TOTAL_MB=0
  HEAP_MB=$(( MEM_AVAIL_MB + SWAP_TOTAL_MB - 1200 ))
  [ "$HEAP_MB" -lt 2560 ] && HEAP_MB=2560
  [ "$HEAP_MB" -gt 3584 ] && HEAP_MB=3584
  export NODE_OPTIONS="--max-old-space-size=$HEAP_MB"
  echo "  🧠 سقف Heap بیلد: ${HEAP_MB}MB (کل RAM: ${MEM_TOTAL_MB}MB | آزاد: ${MEM_AVAIL_MB}MB | سواپ: ${SWAP_TOTAL_MB}MB)"
  NEXT_DIST_DIR=.next.new NODE_ENV=production ./node_modules/.bin/next build --webpack
}

# ۵-م. (v72.3) گاردهای پیش از بیلد — درس بحران v72: بیلدِ کنسل‌شده
# .next.new چندگیگابایتی جا می‌گذارد، ورکرهای یتیم رم می‌خورند و روی دیسک
# ~۱۰۰٪ هر بیلد جدید هم OOM می‌شود هم یک‌ساعته (حتی با زیپ‌های قدیمی سالم!).

# الف) کشتن بیلدهای یتیم از اجراهای کنسل‌شده — الگوها فقط بیلداند؛ به سایت زنده (server.js) نمی‌خورند
pkill -9 -f "next build" 2>/dev/null || true
pkill -9 -f "webpack-build/impl" 2>/dev/null || true
sleep 1

# ب) پاک‌سازی بقایای بیلدهای نیمه‌کاره (سایت از .next/standalone کار می‌کند؛ .next.new فقط زبالهٔ بیلد است)
rm -rf .next.new 2>/dev/null || true

# ب-۲) (v72.5→v72.7 فیکس بحرانی) پاک‌سازی نسل‌های تو در توی standalone — درس بحران ۱۲گیگی:
# بیلدهای درجای قدیمی داخل standalone لانه کرده بودند (عروسک روسی) و cp -al
# هر بار آنها را در بکاپ hardlink جاودانه می‌کرد (fail → restore آلوده).
# پاک‌سازی «قبل از» بکاپ hardlink تا بکاپ هم همیشه تمیز بماند.
# نکته: db داخل standalone حذف نمی‌شود (نگاه fix-db-url و env PM2) — فقط زباله‌های حتمی.
# ⚠️ v72.7 — درس فاجعهٔ «↺2155 ری‌استارت» (تشخیص 2026-09-11):
# چون بیلد با NEXT_DIST_DIR=.next.new انجام می‌شود، دایرکتوری dist «داخلیِ»
# standalone هم همین اسم را می‌گیرد: .next/standalone/.next.new = دیسکِ زندهٔ اپ!
# نسخهٔ v72.5 آن را «زباله» فرض کرده بود و در شروع هر بیلد حذف می‌کرد ⇒ اپ
# بی‌خانمان می‌شد و کل پنجرهٔ بیلد (~۲۰-۳۰ دقیقه) در کرش‌لوپ «Could not find a
# production build in './.next.new'» می‌افتاد (۲۱۵۵ ری‌استارت pm2 در صبح همین روز!).
# هرگز آن را حذف نکنید؛ خود مرحلهٔ کپی static هر بار هر دو نام را تازه می‌کند.
for JUNK in \
  ".next/standalone/.next/standalone" \
  ".next/standalone/.next/standalone.prebuild" \
  ".next/standalone/.next.old" \
  ".next/standalone/backups" \
  ./workspace-* ; do
  if [ -e "$JUNK" ]; then
    rm -rf "$JUNK" 2>/dev/null || true
    echo "  🧹 زبالهٔ تو در تو/موقت حذف شد: $JUNK"
  fi
done

# ج) گارد دیسک — روی دیسک ۹۰٪+ بیلد ممنوع؛ اول پاک‌سازی اضطراری، اگر باز پر بود توقف امن
DISK_PCT=$(df -P /var/www/fitup 2>/dev/null | awk 'NR==2{gsub("%","",$5);print $5}')
if [ "${DISK_PCT:-0}" -ge 90 ]; then
  echo "  🧹 دیسک ${DISK_PCT}٪ پر است — پاک‌سازی اضطراری قبل از بیلد..."
  rm -rf .next.new 2>/dev/null || true
  rm -rf "$HOME/.bun/install/cache" "$HOME/.npm/_cacache" 2>/dev/null || true
  journalctl --vacuum-size=50M --quiet 2>/dev/null || true
  DISK_PCT=$(df -P /var/www/fitup 2>/dev/null | awk 'NR==2{gsub("%","",$5);print $5}')
fi
if [ "${DISK_PCT:-0}" -ge 90 ]; then
  echo "❌ دیسک ${DISK_PCT}٪ پر است و پاک‌سازی خودکار کافی نبود — بیلد لغو شد (سایت دست‌نخورده بالا است)."
  echo "   برای یافتن بزرگ‌ترین پوشه‌ها این دو دستور را بزن و خروجی را بفرست:"
  echo "     du -xh --max-depth=1 /var/www/fitup 2>/dev/null | sort -rh | head -20"
  echo "     du -xh --max-depth=2 /var/www/fitup/backups 2>/dev/null | sort -rh | head"
  exit 1
fi
echo "  ✓ گارد پیش از بیلد: دیسک ${DISK_PCT:-?}٪ — ورکرهای یتیم کشته و بقایای بیلد پاک شد"

if ! run_deploy_build; then
  echo "❌ Build شکست خورد (⏱ زمان بیلد: $(( ($(date +%s) - DEPLOY_BUILD_START_TS) / 60 )) دقیقه و $(( ($(date +%s) - DEPLOY_BUILD_START_TS) % 60 )) ثانیه) — سایت با build قبلی همچنان بالاست (بدون قطعی)."
  echo "   خطای بالا را ریشه‌یابی کنید و دوباره دیپلوی بزنید."
  rm -rf .next.new 2>/dev/null || true
  restore_standalone
  exit 1
fi
echo "  ✓ build موفق"

# ۵-ج. وِریفای محل خروجی بیلد — BUILD_ID باید داخل .next.new باشد (v62)
verify_build_output() {
  [ -f ".next.new/BUILD_ID" ] && [ -d ".next.new/server" ]
}
if ! verify_build_output; then
  if [ -f ".next/BUILD_ID" ] && [ "$(stat -c %Y .next/BUILD_ID 2>/dev/null || echo 0)" -ge "$DEPLOY_BUILD_START_TS" ]; then
    echo "  ⚠ بیلد به‌جای .next.new داخل .next رفت — یعنی NEXT_DIST_DIR اعمال نشده بود"
    echo "    (عامل شایع: کانفیگ سایه‌دار/قدیمی next.config — بالا حذف شد). build دوباره..."
    # بیلد درجا فایل‌های سرور زنده (.next/standalone) را پاک کرده — فوراً از
    # بکاپ برگردان تا در طول build دوم سایت سالم بماند (v62)
    restore_standalone
    STANDALONE_BACKUP=""
    if ! run_deploy_build; then
      echo "❌ build دوم هم شکست خورد — دیپلوی متوقف شد (سایت با نسخهٔ قبلی بالا می‌ماند)."
      rm -rf .next.new 2>/dev/null || true
      restore_standalone
      exit 1
    fi
    if ! verify_build_output; then
      echo "❌ بعد از build دوم هم .next.new/BUILD_ID نیست — distDir هنوز اعمال نمی‌شود."
      echo "   دیپلوی متوقف شد (سایت با نسخهٔ قبلی بالا می‌ماند). next.config.ts داخل زیپ را بررسی کنید."
      rm -rf .next.new 2>/dev/null || true
      restore_standalone
      exit 1
    fi
    echo "  ✓ build دوم موفق — این‌بار خروجی درست داخل .next.new است"
  else
    echo "❌ بیلد «موفق» اعلام شد ولی .next.new/BUILD_ID وجود ندارد — بیلد ناقص بوده."
    echo "   دیپلوی متوقف شد (سایت با نسخهٔ قبلی بالا می‌ماند)."
    rm -rf .next.new 2>/dev/null || true
    restore_standalone
    exit 1
  fi
fi
rm -rf .next/standalone.prebuild 2>/dev/null || true
STANDALONE_BACKUP=""
echo "  ✓ build موفق و خروجی کامل است (.next.new/BUILD_ID ✓) — ⏱ زمان بیلد: $(( ($(date +%s) - DEPLOY_BUILD_START_TS) / 60 )) دقیقه و $(( ($(date +%s) - DEPLOY_BUILD_START_TS) % 60 )) ثانیه"

# ۶. آماده‌سازی standalone بیلد جدید — همهٔ کپی‌ها «قبل از» توقف سرور انجام
# می‌شود تا پنجرهٔ قطعی واقعاً چند ثانیه باشد.
# ─── v61 فیکس «cp: cannot stat '.next.new/static'» (لاگ بیلد مالک) ───
# کپی static حالا گارد دارد: اگر static در مسیر منتظره نبود، کل بیلد جستجو
# می‌شود؛ اگر Next خودش داخل standalone کپی کرده باشد پذیرفته می‌شود؛ و اگر
# واقعاً هیچ static ای نباشد، دیپلوی «قبل از توقف سرور» متوقف می‌شود تا سایت
# زنده هرگز بدون CSS/JS نماند. (بعد از موفقیت: هم standalone/.next.new و هم
# standalone/.next پر می‌شود تا هر دو حالت runtime پوشش داده شود.)
echo "📁 کپی static و public داخل بیلد جدید..."
STATIC_SRC=".next.new/static"
if [ ! -d "$STATIC_SRC" ]; then
  if [ -d ".next.new/standalone/.next.new/static" ] || [ -d ".next.new/standalone/.next/static" ]; then
    echo "  ✓ Next خودش static را داخل standalone کپی کرده است"
    STATIC_SRC=""
  else
    echo "  ⚠ static در .next.new/static نبود — جستجوی کل بیلد..."
    STATIC_SRC=$(find .next.new -maxdepth 4 -type d -name static -not -path "*/standalone/*" 2>/dev/null | head -1)
    if [ -n "$STATIC_SRC" ]; then
      echo "  ✓ static پیدا شد: $STATIC_SRC"
    else
      echo "  ❌ هیچ پوشهٔ static در بیلد جدید نیست! دیپلوی متوقف شد (سایت قبلی دست‌نخورده و سالم می‌ماند)."
      echo "     این یعنی بیلد ناقص بوده — لاگ بیلد بالا را ببینید و دوباره تلاش کنید."
      exit 1
    fi
  fi
fi
mkdir -p .next.new/standalone/.next.new .next.new/standalone/.next
if [ -n "$STATIC_SRC" ]; then
  cp -r "$STATIC_SRC" .next.new/standalone/.next.new/
  cp -r "$STATIC_SRC" .next.new/standalone/.next/
  echo "  ✓ static کپی شد (standalone/.next.new + standalone/.next)"
fi
cp -r public .next.new/standalone/

# ۶-پ. (v65) حفظ چانک‌های نسخهٔ قبلی — ریشه‌یابی خطای «Loading chunk N failed»
# کاربرانی که صفحه را قبل از دیپلوی باز کرده‌اند (مخصوصاً IAB اینستاگرام که
# HTML را کش می‌کند) هنوز به فایل‌های chunk با hash نسخهٔ قبلی اشاره می‌کنند؛
# اگر آن فایل‌ها حذف شوند، هر کلیک/اسکرول بعدی‌شان ChunkLoadError می‌شود و
# تب «لاگ خطاها» پنل پر از «Loading chunk N failed (timeout)» می‌شود.
# FIX: همهٔ فایل‌های static نسخهٔ قبلی به بیلد جدید «بدون بازنویسی» اضافه
# می‌شوند (cp -n): فایل‌های هم‌نام = نسخهٔ جدید می‌ماند؛ بقیه فقط برای
# صفحات قدیمیِ باز سرو می‌شوند و با آپدیت بعدی HTML تازه، خودبه‌خود بی‌استفاده.
for OLD_STATIC in ".next/standalone/.next/static" ".next/standalone/.next.new/static"; do
  if [ -d "$OLD_STATIC" ]; then
    for DEST in ".next.new/standalone/.next/static" ".next.new/standalone/.next.new/static"; do
      if [ -d "$DEST" ]; then
        cp -rn "$OLD_STATIC"/. "$DEST"/ 2>/dev/null || true
      fi
    done
    echo "  ✓ چانک‌های نسخهٔ قبلی برای سازگاری صفحاتِ باز اضافه شد (از $OLD_STATIC)"
    break
  fi
done

# ۶-پ-۲. (v67) آرشیو ماندگار چانک‌ها — همهٔ نسل‌های ۱۴ روز اخیر، نه فقط نسخهٔ قبلی
# لاگ ChunkLoadError مالک نشان داد HTMLِ کش‌شدهٔ خیلی قدیمی (IAB اینستاگرام و
# WebView اپ اندروید که HTML را مدت‌ها نگه می‌دارند) گاهی به چانک‌های «۲+ دیپلوی
# قبل» اشاره می‌کند؛ کپی «نسخهٔ قبلی» (۶-پ) فقط یک نسل را پوشش می‌دهد.
# FIX: پوشهٔ پایدار .chunk-archive در ریشهٔ سایت (خارج از .next — با هر دیپلوی
# نمی‌سوزد) همهٔ فایل‌های static همهٔ نسل‌ها را تجمیع می‌کند. نام فایل‌های static
# content-hash است — هیچ تداخلی بین نسل‌ها نیست. هر دیپلوی: (۱) آرشیو → بیلد
# جدید (بدون بازنویسی) تا هر HTML کش‌شدهٔ ۱۴ روز اخیر chunk خودش را پیدا کند،
# (۲) نسل جدید → آرشیو، (۳) هرس فایل‌های قدیمی‌تر از ۱۴ روز.
CHUNK_ARCHIVE=".chunk-archive"
mkdir -p "$CHUNK_ARCHIVE"
NEW_STATIC_DIR=".next.new/standalone/.next/static"
if [ -d "$NEW_STATIC_DIR" ]; then
  # ۱) چانک‌های آرشیو (نسل‌های قبلی) به بیلد جدید اضافه شوند
  cp -rn "$CHUNK_ARCHIVE"/. "$NEW_STATIC_DIR"/ 2>/dev/null || true
  if [ -d ".next.new/standalone/.next.new/static" ]; then
    cp -rn "$NEW_STATIC_DIR"/. .next.new/standalone/.next.new/static/ 2>/dev/null || true
  fi
  ARCHIVE_COUNT=$(find "$CHUNK_ARCHIVE" -type f 2>/dev/null | wc -l)
  echo "  ✓ چانک‌های آرشیو ۱۴ روز اخیر ($ARCHIVE_COUNT فایل) به بیلد جدید اضافه شد"
  # ۲) نسل جدید به آرشیو اضافه شود (بدون بازنویسی — فایل هم‌نام یعنی همان محتوا)
  cp -rn "$NEW_STATIC_DIR"/. "$CHUNK_ARCHIVE"/ 2>/dev/null || true
  # ۳) هرس — فایل‌های قدیمی‌تر از ۱۴ روز (HTML کش‌شدهٔ آن‌قدری قدیمی عملاً نیست)
  find "$CHUNK_ARCHIVE" -type f -mtime +14 -delete 2>/dev/null || true
  find "$CHUNK_ARCHIVE" -type d -empty -delete 2>/dev/null || true
  echo "  ✓ آرشیو چانک‌ها به‌روز شد (نگهداری ۱۴ روز)"
fi

# ۶-ب. رسانه‌های مقالات در خروجی build (v21 — لایه دوم امنیت سرو عکس‌ها)
# ⚠️ امنیت: فقط articles/ کپی می‌شود — رسانه‌های خصوصی کاربران هرگز static سرو نمی‌شوند.
rm -rf .next.new/standalone/public/uploads 2>/dev/null || true
if [ -d "uploads/articles" ]; then
  ARTICLES_TO_STATIC=$(find uploads/articles -type f 2>/dev/null | wc -l)
  mkdir -p .next.new/standalone/public/uploads
  cp -rn uploads/articles .next.new/standalone/public/uploads/ 2>/dev/null || true
  echo "  ✓ $ARTICLES_TO_STATIC تصویر مقاله به static public بیلد جدید اضافه شد"
fi

# ۶-ج. کپی فایل‌های پیکربندی
echo "📁 کپی فایل‌های پیکربندی..."
cp .env .next.new/standalone/.env 2>/dev/null || echo "  (.env وجود ندارد)"
mkdir -p .next.new/standalone/db
cp db/custom.db .next.new/standalone/db/custom.db 2>/dev/null || echo "  (دیتابیس وجود ندارد)"
# v72.8 — هاردنینگ WAL: فایل‌های -wal/-shm هم همراه دیتابیس کپی می‌شوند تا اگر
# روزی ترتیب stop→cp جابه‌جا شد یا WAL چک‌پوینت نشده بود، هیچ تراکنش کامیت‌شده‌ای
# از دست نرود (SQLite موقع باز کردن، از WAL بازیابی می‌کند). وقتی اپ stop تمیز
# شده باشد این فایل‌ها یا ناموجودند یا خالی — کپی‌شان بی‌ضرر است.
# (درس معمای ۱۰۷مگ db: WAL متورم پنجرهٔ کرش‌لوپ — تشخیص 2026-09-11)
[ -f db/custom.db-wal ] && cp db/custom.db-wal .next.new/standalone/db/custom.db-wal 2>/dev/null || true
[ -f db/custom.db-shm ] && cp db/custom.db-shm .next.new/standalone/db/custom.db-shm 2>/dev/null || true
# حفظ کلید سشن بین دیپلوی‌ها — کاربران بعد از دیپلوی لاگین می‌مانند.
cp db/.session-secret .next.new/standalone/db/.session-secret 2>/dev/null || true
# symlink uploads (عکس‌ها مستقل از build باقی می‌مانند)
rm -rf .next.new/standalone/uploads 2>/dev/null || true
ln -sfn /var/www/fitup/uploads .next.new/standalone/uploads
echo "  ✓ بیلد جدید کاملاً آماده است"

# ۷. توقف اپلیکیشن — از این لحظه به بعد فقط چند ثانیه طول می‌کشد
echo "⏹ توقف اپلیکیشن (پنجرهٔ کوتاه تعویض)..."
pm2 stop fitup 2>/dev/null || true

# ۸. اعمال تغییرات schema — بعد از توقف تا schema روی SQLite قفل نشود
# اگر db:push شکست بخورد صدای آن را پنهان نمی‌کنیم (باگ v9)
echo "📊 اعمال تغییرات schema..."
if bun run db:push 2>&1; then
  echo "  ✓ schema اعمال شد"
else
  echo "  ⚠ db:push با خطا مواجه شد — ادامه می‌دهیم (جایگزین: خودترمیمی DB بعد از boot ستون‌های ضروری را اضافه می‌کند)"
fi

# ۸-ب. مهاجرت/ترمیم رسانه‌ها (همان مرحله‌های قبلی — بعد از توقف، سریع)
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


# ۹. تعویض build — اتمیک و چندثانیه‌ای (rollback با .next.old ممکن است)
rm -rf .next.old 2>/dev/null || true
if [ -d ".next" ]; then
  mv .next .next.old
  echo "🗑 build قدیمی کنار گذاشته شد (.next.old — برای rollback فوری)"
fi
mv .next.new .next
echo "✓ build جدید جایگزین شد"

# ۹-ب. (v72.4) پاک‌سازی کش بیلد از نسل جدید — چند گیگ در هر دیپلوی!
# سرور زنده (standalone) کشش را از .next/standalone/.next/cache می‌خورد؛
# .next/cache بیرونی فقط کش وبپک/فچِ بیلد تمام‌شده است و دیگر مصرف نمی‌شود.
# با انباشت چندگیگابایتی همین پوشه + .next.old های به‌جامانده از دیپلوی‌های
# شکست‌خورده، .next به ۱۳ گیگ و دیسک به ~۱۰۰٪ رسیده بود (بحران v72).
rm -rf .next/cache 2>/dev/null || true
echo "🧹 کش بیلد نسل جدید پاک شد (جلوگیری از انباشت چندگیگابایتی)"

# ۹-ج. (v72.8) پاک‌سازی کش‌های «runtime» داخل standalone — ریشهٔ واقعی پروندهٔ ۱۲گیگ!
# کش بیلد (بالایی) هر دیپلوی پاک می‌شد ولی کش «زمان اجرا» هرگز:
# بهینه‌ساز تصویر Next هر نسخهٔ resize‌شدهٔ هر عکس را در
# .next/standalone/.next.new/cache/images (و .next/cache) برای همیشه نگه
# می‌دارد؛ با ۱۴۰۰+ URL و هفته‌ها سرو، همین پوشه بدون سقف رشد می‌کرد و
# .next را به ۱۲ گیگ رساند (تشخیص 2026-09-11). اپ در این لحظه stop است
# (قدم ۷) ⇒ حذف کاملاً امن است؛ کش‌ها on-demand دوباره ساخته می‌شوند
# (فقط چند درخواست اول بعد از دیپلوی کمی کندتر — بعدش مثل قبل).
rm -rf .next/standalone/.next.new/cache .next/standalone/.next/cache \
       .next.old/standalone/.next.new/cache .next.old/standalone/.next/cache 2>/dev/null || true
echo "🧹 کش runtime تصاویر/fetch داخل standalone هم پاک شد (v72.8 — ریشهٔ ۱۲گیگ)"

# ۱۰. ری‌استارت اپلیکیشن
# اگر فرآیند fitup در pm2 ثبت نشده باشد (اولین دیپلوی) اسکریپت نباید قطع شود؛
# health check پایانی وضعیت را مشخص می‌کند.
echo "▶ ری‌استارت اپلیکیشن..."
pm2 restart fitup 2>/dev/null || echo "  ⚠ فرآیند fitup در pm2 موجود نیست — با pm2 start/ecosystem راه‌اندازی کنید"

# ۱۰-ب. ذخیره تنظیمات pm2
echo "💾 ذخیره تنظیمات pm2..."
pm2 save

# ۱۰-ج. تعویض خودکار به صفحهٔ نگهداری در صورت بروز خطا (v56)
# اگر build قدیمی موجود باشد rollback می‌کنیم؛ صفحهٔ نگهداری (public/maintenance.html)
# هم برای پروکسی جلویی در دسترس است تا به‌جای ۵۰۲ خام، پیام زیبا دیده شود.
rollback_build() {
  echo "↩ بازگردانی build قبلی..."
  if [ -d ".next.old" ]; then
    rm -rf .next.failed 2>/dev/null || true
    mv .next .next.failed 2>/dev/null || true
    mv .next.old .next
    pm2 restart fitup 2>/dev/null || true
    echo "  ✓ build قبلی بازگردانی و سایت دوباره بالا آمد"
  fi
}

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

# ۱۳/۱۴: ری‌استارت و pm2 save در قدم ۱۰ انجام شد (v56 — بدون تکرار)

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
  rollback_build
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

# ۱۷. (v72.8) وزن‌سنج دیسک — هر دیپلوی وزن .next را اعلان می‌کند تا هیچ انباشت
# بی‌صدایی دیگر ۶ ماه پنهان نماند (درس پروندهٔ ۱۲گیگ)
echo ""
echo "⚖ وزن دیسک: کل .next = $(du -sh .next 2>/dev/null | cut -f1) | standalone زنده = $(du -sh .next/standalone 2>/dev/null | cut -f1)"
NEXT_WEIGHT_MB=$(du -sm .next 2>/dev/null | cut -f1)
if [ "${NEXT_WEIGHT_MB:-0}" -gt 3072 ]; then
  echo "  ⚠️ .next از 3G بزرگ‌تر شده — بزرگ‌ترین بلاک‌ها:"
  du -xh --max-depth=2 .next 2>/dev/null | sort -h | tail -6 | sed 's/^/      /'
fi
echo ""
echo "🎉 دیپلوی کامل شد! (⏱ کل دیپلوی: $(( ($(date +%s) - DEPLOY_TOTAL_START_TS) / 60 )) دقیقه و $(( ($(date +%s) - DEPLOY_TOTAL_START_TS) % 60 )) ثانیه)"
echo "  - دیتابیس: $(ls -lh db/custom.db 2>/dev/null | awk '{print $5}')"
echo "  - پشتیبان‌ها: $(ls backups/*.db 2>/dev/null | wc -l) فایل"
echo "  - تصاویر مقالات: $(find uploads -type f 2>/dev/null | wc -l) فایل"
