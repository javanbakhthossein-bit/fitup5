#!/bin/bash
set -e

echo "🚀 شروع دیپلوی..."
cd /var/www/fitup

# ۱. پشتیبان‌گیری از دیتابیس
echo "📦 پشتیبان‌گیری از دیتابیس..."
BACKUP_DIR="/var/www/fitup/backups"
mkdir -p $BACKUP_DIR
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
cp db/custom.db "$BACKUP_DIR/db_backup_$DATE.db" 2>/dev/null || echo "  (دیتابیس در دسترس نیست)"
ls -t $BACKUP_DIR/db_backup_*.db 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
echo "  ✓ پشتیبان ذخیره شد"

# ۲. نصب وابستگی‌ها
echo "📦 نصب وابستگی‌ها..."
bun install

# ۳. تولید Prisma client
echo "🔧 تولید Prisma client..."
bun run db:generate

# ۴. اعمال تغییرات schema
echo "📊 اعمال تغییرات schema..."
bun run db:push 2>&1 || echo "  ✓ دیتابیس همگام است"

# ۵. توقف اپلیکیشن
echo "⏹ توقف اپلیکیشن..."
pm2 stop fitup

# ۶. انتقال عکس‌های قدیمی (فقط یک‌بار — اگر از نسخه قدیمی public/uploads دارید)
if [ -d "public/uploads/articles" ] && [ ! -L "public/uploads" ]; then
  echo "📁 انتقال عکس‌های قدیمی به uploads/..."
  mkdir -p uploads/articles
  cp -rn public/uploads/articles/* uploads/articles/ 2>/dev/null || true
  rm -rf public/uploads
  echo "  ✓ انتقال کامل شد"
fi

# ۷. پاک کردن build قدیمی
echo "🗑 پاک کردن build قدیمی..."
rm -rf .next

# ۸. build جدید
echo "🔨 Build جدید..."
NODE_ENV=production bun run build

# ۹. کپی static و public
echo "📁 کپی static و public..."
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

# ۱۰. کپی فایل‌های پیکربندی
echo "📁 کپی فایل‌های پیکربندی..."
cp .env .next/standalone/.env 2>/dev/null || echo "  (.env وجود ندارد)"
mkdir -p .next/standalone/db
cp db/custom.db .next/standalone/db/custom.db 2>/dev/null || echo "  (دیتابیس وجود ندارد)"
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

# ۱۳. ری‌استارت اپلیکیشن
echo "▶ ری‌استارت اپلیکیشن..."
pm2 restart fitup

# ۱۴. ذخیره تنظیمات pm2
echo "💾 ذخیره تنظیمات pm2..."
pm2 save

# ۱۵. تست
echo "🔍 تست..."
sleep 3
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3000/

echo ""
echo "🎉 دیپلوی کامل شد!"
echo "  - دیتابیس: $(ls -lh db/custom.db 2>/dev/null | awk '{print $5}')"
echo "  - پشتیبان‌ها: $(ls backups/*.db 2>/dev/null | wc -l) فایل"
echo "  - تصاویر مقالات: $(find uploads -type f 2>/dev/null | wc -l) فایل"
