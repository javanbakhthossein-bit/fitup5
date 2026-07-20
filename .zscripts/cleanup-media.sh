#!/bin/sh
# cleanup-media.sh — فراخوانی روزانه endpoint پاک‌سازی مدیای قدیمی فیتاپ
#
# این اسکریپت را در crontab سیستم عامل قرار دهید تا هر روز (مثلاً ۳:۳۰ بامداد) اجرا شود.
#
# نمونه crontab (هر روز ساعت ۳:۳۰ بامداد):
#   30 3 * * * /home/z/my-project/.zscripts/cleanup-media.sh >> /var/log/fitup-cleanup.log 2>&1
#
# متغیرهای محیطی مورد نیاز:
#   - CRON_SECRET: باید با مقدار تنظیم‌شده در .env پروژه یکی باشد
#   - FITUP_BASE_URL: آدرس سایت (پیش‌فرض: https://fittup.ir)
#
# نکته: اگر فایل .env در کنار پروژه موجود باشد، CRON_SECRET از آن خوانده می‌شود.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── خواندن متغیرها از .env در صورت موجود بودن ───
if [ -f "$PROJECT_DIR/.env" ]; then
  # فقط CRON_SECRET و NEXT_PUBLIC_SITE_URL را استخراج می‌کنیم (در صورت وجود)
  ENV_SECRET=$(grep -E "^CRON_SECRET=" "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '[:space:]' || true)
  ENV_SITE_URL=$(grep -E "^NEXT_PUBLIC_SITE_URL=" "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '[:space:]' || true)
fi

# ─── تنظیم مقادیر نهایی ───
SECRET="${ENV_SECRET:-${CRON_SECRET:-fitup-cron-secret-2025}}"
BASE_URL="${ENV_SITE_URL:-${FITUP_BASE_URL:-${NEXT_PUBLIC_SITE_URL:-https://fittup.ir}}}"

# حذف / انتهایی اگر وجود دارد
BASE_URL=$(echo "$BASE_URL" | sed 's#/*$##')

URL="${BASE_URL}/api/cron/cleanup-media?secret=${SECRET}"

echo "─── cleanup-media @ $(date '+%Y-%m-%d %H:%M:%S') ───"
echo "URL: ${BASE_URL}/api/cron/cleanup-media?secret=***"

# ─── فراخوانی endpoint ───
# --max-time 600: حداکثر ۱۰ دقیقه برای اجرای پاک‌سازی
# --silent --show-error: فقط خطاها را نشان بده
# --fail-with-body: در صورت خطای HTTP، متن پاسخ را چاپ کن
RESPONSE=$(curl --silent --show-error --fail-with-body --max-time 600 \
  --request GET \
  --header "Accept: application/json" \
  "$URL" 2>&1) || {
    echo "❌ Cleanup endpoint call failed:"
    echo "$RESPONSE"
    exit 1
  }

echo "✅ Cleanup response:"
echo "$RESPONSE" | head -100

# ─── استخراج خلاصه برای لاگ ───
# (jq در صورت موجود بودن استفاده می‌شود؛ در غیر این‌صورت متن خام چاپ می‌شود)
if command -v jq >/dev/null 2>&1; then
  echo ""
  echo "Summary:"
  echo "$RESPONSE" | jq -r '"  files deleted: \(.totalFilesDeleted)\n  records deleted: \(.totalRecordsDeleted)\n  chat cleared: \(.chatMessagesCleared)\n  errors: \(.errors | length)"' 2>/dev/null || true
fi

echo "─── done @ $(date '+%Y-%m-%d %H:%M:%S') ───"
