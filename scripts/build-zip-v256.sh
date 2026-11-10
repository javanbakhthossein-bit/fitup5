#!/bin/bash
# build-zip-v256.sh — ساخت زیپ دیپلوی v256 «فقط سورس کد کامل»
# دیرکتیو مالک: عکس/ویدیو/APK/DB در زیپ نیست (روی سرور هست) ولی تمام سورس کد
# بدون هیچ کم و کاستی باید داخل زیپ باشد.
# پایه: فهرست فایل‌های زیپ v255 + فایل‌های جدید v256
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v256-stage
OUT=/tmp/fitup-deploy-2026-11-04-v256.zip
V255_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-04-v255.zip
V255_LIST=/tmp/v255-filelist.txt

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# ۱) فهرست فایل‌های زیپ v255 (مرجع کامل‌بودن)
unzip -l "$V255_ZIP" | awk 'NR>3 {print $4}' | rg -v "^$|^-|^Name$|files$|^\d+ file" | sed 's/\r$//' > "$V255_LIST"

# ۲) کپی فایل‌های v255 از سندباکس (با محتوای v256 فعلی) — بدون رسانه‌های سایت/APK/DB
COPIED=0; MISSING=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    db-rescue/custom.db) continue;;
    download/*.apk|public/downloads/*.apk) continue;;
    public/*.png|public/*.webp|public/*.avif|public/*.jpg|public/*.jpeg|public/*.gif|public/*.mp4) continue;;
    public/og/*.png|public/free-programs/*.jpg|public/free-programs/*.webp) continue;;
    audit-b-*.ts|audit-b-*.json) continue;;
    download/fitup-db-snapshot-*.db) continue;;
  esac
  if [ -f "$f" ]; then
    mkdir -p "$STAGE/$(dirname "$f")"
    cp "$f" "$STAGE/$f"
    COPIED=$((COPIED+1))
  else
    MISSING="$MISSING$f\n"
  fi
done < "$V255_LIST"

# ۳) فایل‌های جدید v256
NEW_FILES=(
  scripts/fix-equipment-tags-v256.ts
  scripts/build-zip-v256.sh
  ai-e2e-v256.ts
  download/راهنما-سرور-v256.md
)
ADDED=0
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then
    mkdir -p "$STAGE/$(dirname "$f")"
    cp "$f" "$STAGE/$f"
    ADDED=$((ADDED+1))
  else
    echo "⚠️ فایل جدید v256 پیدا نشد: $f"
  fi
done

# ۴) وریفای کامل‌بودن: هر فایل سورس سندباکس که در استیج نیست = هشدار (به‌جز استثناها)
echo "── وریفای پوشش کامل سورس ──"
GAPS=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.db|*.db-*|*.bak|*.snapshot-*) continue;;
    audit-b-*.ts|audit-b-*.json|check-tmp.ts|cleanup-tmp.ts|check-db-state-tmp.ts) continue;;
    dev.log|*.log|tool-results|agent-ctx|node_modules|.next|.env*|upload|uploads|download/fitup-db-snapshot-*|db/tmp-snap) continue;;
    ai-e2e-v256-result.json) continue;;
  esac
  if [ -f "$f" ] && [ ! -f "$STAGE/$f" ]; then
    case "$f" in
      src/*|prisma/*|mini-services/*|fitup-app/*|fitup-bazaar/*|public/sw.js|public/manifest.json|public/llms*.txt|public/maintenance.html|public/google*.html|public/robots.txt|public/sitemap*|Caddyfile|*.json|*.ts|*.tsx|*.mjs|*.md|*.sh)
        echo "  ❓ در استیج نیست: $f"; GAPS=$((GAPS+1));;
    esac
  fi
done < <(find src prisma mini-services fitup-app fitup-bazaar public scripts download -type f 2>/dev/null | rg -v "node_modules|\.next|/uploads/|fitup-app/(build|\.gradle|gradle/|app/build)|\.apk$|\.keystore$" )

echo ""
echo "COPIED=$COPIED  ADDED=$ADDED  GAPS=$GAPS"
if [ -n "$MISSING" ]; then echo "── فایل‌های v255 که در سندباکس نیستند ──"; echo -e "$MISSING"; fi

# ۵) ساخت زیپ نهایی
cd "$STAGE"
zip -q -r "$OUT" .
cd /home/z/my-project
SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo ""
echo "════════════════════════════════════════"
echo "زیپ v256 ساخته شد: $OUT"
echo "حجم: $SIZE — تعداد فایل: $COUNT — COPIED=$COPIED ADDED=$ADDED GAPS=$GAPS"
echo "════════════════════════════════════════"
