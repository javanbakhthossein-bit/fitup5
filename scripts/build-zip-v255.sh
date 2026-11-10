#!/bin/bash
# build-zip-v255.sh — ساخت زیپ دیپلوی v255 «فقط سورس کد کامل»
# دیرکتیو مالک: عکس/ویدیو/APK/DB در زیپ نیست (روی سرور هست) ولی تمام سورس کد
# بدون هیچ کم و کاستی باید داخل زیپ باشد.
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v255-stage
OUT=/tmp/fitup-deploy-2026-11-04-v255.zip
V254_LIST=/tmp/v254-filelist.txt

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# ۱) فهرست فایل‌های زیپ v254 (مرجع کامل‌بودن)
unzip -l /tmp/fitup-deploy-remote.zip | awk 'NR>3 {print $4}' | rg -v "^$|^-|^Name$|files$|^\d+ file" | sed 's/\r$//' > "$V254_LIST"

# ۲) کپی فایل‌های v254 از سندباکس (با محتوای v255 فعلی) — بدون رسانه‌های سایت/APK/DB
COPIED=0; MISSING=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # استثناها — رسانهٔ سایت روی سرور هست؛ DB/APK هم
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
done < "$V254_LIST"

# ۳) فایل‌های جدید v255 (بعد از ساخت زیپ v254 به وجود آمدند)
NEW_FILES=(
  scripts/regen-affected-plans-v255.ts
  scripts/test-gate-layers-v255.ts
  scripts/test-rest-fix-v255.ts
  download/راهنما-سرور-v255.md
)
ADDED=0
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then
    mkdir -p "$STAGE/$(dirname "$f")"
    cp "$f" "$STAGE/$f"
    ADDED=$((ADDED+1))
  else
    echo "⚠️ فایل جدید v255 پیدا نشد: $f"
  fi
done

# ۴) وریفای کامل‌بودن: هر فایل سورس سندباکس که در استیج نیست = هشدار (به‌جز استثناها)
SANDBOX_SRC=$(ls -1 src scripts prisma mini-services fitup-app/app fitup-bazaar/app 2>/dev/null | head -0; true)
echo "── وریفای پوشش کامل سورس ──"
GAPS=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.db|*.db-*|*.bak|*.snapshot-*) continue;;
    audit-b-*.ts|audit-b-*.json|check-tmp.ts|cleanup-tmp.ts|check-db-state-tmp.ts) continue;;
    dev.log|*.log|tool-results|agent-ctx|node_modules|.next|.env*|upload|uploads|download/fitup-db-snapshot-*|db/tmp-snap) continue;;
  esac
  if [ -f "$f" ] && [ ! -f "$STAGE/$f" ]; then
    # فایل سندباکس که نه در v254 بود نه در فهرست جدید — فقط اگر سورس واقعی است هشدار بده
    case "$f" in
      src/*|prisma/*|mini-services/*|fitup-app/*|fitup-bazaar/*|public/sw.js|public/manifest.json|public/llms*.txt|public/maintenance.html|public/google*.html|public/robots.txt|public/sitemap*|Caddyfile|*.json|*.ts|*.tsx|*.mjs|*.md|*.sh)
        echo "  ❓ در استیج نیست: $f"; GAPS=$((GAPS+1));;
    esac
  fi
done < <(find src prisma mini-services fitup-app fitup-bazaar public scripts download -type f 2>/dev/null | rg -v "node_modules|\.next|/uploads/|fitup-app/(build|\.gradle|gradle/|app/build)|\.apk$|\.keystore$" )

echo ""
echo "COPIED=$COPIED  ADDED=$ADDED  GAPS=$GAPS"
if [ -n "$MISSING" ]; then echo "── فایل‌های v254 که در سندباکس نیستند ──"; echo -e "$MISSING"; fi
