#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# rescue-now.sh — نجات فوری دیتابیس فیتاپ (v141) — بدون دیپلوی کامل
# مصرف: در ریشهٔ /var/www/fitup بازش کنید و بزنید:  bash rescue-now.sh
# کاری که می‌کند:
#   ۱) سرور را می‌ایستاند (pm2 stop)
#   ۲) از دیتابیس فعلی (خراب) بکاپ می‌گیرد → db/corrupt-backup-<زمان>/
#   ۳) نسخهٔ تمیز db-rescue/custom.db را نصب می‌کند (integrity + ۵۴ جدول + ۵۸۱ حرکت + ۱۵۲۵ غذا)
#   ۴) pm2 restart + تست HTTP
# ═══════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

echo "🛠 فیتاپ — نجات فوری دیتابیس (v141)"

if [ ! -f "db-rescue/custom.db" ]; then
  echo "❌ db-rescue/custom.db پیدا نشد — این اسکریپت باید در ریشهٔ /var/www/fitup و کنار پوشهٔ db-rescue اجرا شود"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "❌ bun نصب نیست — روی سرور bun باید موجود باشد (مثل همیشه)"
  exit 1
fi

echo "⏸ توقف سرور..."
pm2 stop fitup 2>/dev/null || echo "  (pm2/فرآیند fitup در دسترس نیست — ادامه)"

echo "🚑 نجات دیتابیس (--force: بکاپ + نصب نسخهٔ تمیز)..."
if bun run scripts/rescue-db.ts --force; then
  echo "  ✓ دیتابیس تمیز نصب شد"
else
  echo "  ✗ نجات ناموفق — هیچ چیزی خراب‌تر نشده؛ بکاپ خراب در db/corrupt-backup-* است"
  exit 1
fi

echo "▶ راه‌اندازی مجدد..."
pm2 restart fitup 2>/dev/null || echo "  ⚠ pm2 restart دستی بزنید: pm2 restart fitup"
sleep 3
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 http://localhost:3000/ || echo "000")
echo ""
if [ "$CODE" = "200" ]; then
  echo "✅ سایت بالا آمد — HTTP $CODE"
else
  echo "⚠ هنوز 200 نشد (HTTP: $CODE) — دو قدم:"
  echo "   ۱) pm2 logs fitup --lines 40 --nostream   ← خطا را ببینید"
  echo "   ۲) اگر بیلد شکسته است، دیپلوی کامل با زیپ v141: bash deploy.sh"
fi
