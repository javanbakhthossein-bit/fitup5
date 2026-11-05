#!/bin/bash
# build-zip-v257.sh — ساخت مجدد زیپ دیپلوی v257 «فقط سورس کد کامل»
# دیرکتیو مالک (۲۰۲۶-۱۱-۰۴): زیپ ۲۵۷ اولیه خیلی بزرگ بود (۵۸MB) چون db-rescue/custom.db
# (۱۲۵MB) + APKها + عکس‌های public داخلش رفته بود. این نسخه دقیقاً با همان روش
# build-zip-v256.sh و با اندازهٔ زیپ ۲۵۶ ساخته می‌شود:
#   ✅ تمام سورس کد بدون هیچ کم و کاستی (پایه: فهرست فایل‌های زیپ v256)
#   ❌ نه DB، نه APK، نه عکس/ویدیو (اینها روی سرور هستند)
#   ✅ فیکس‌های v257 (#418 هیدریشن + اسکرول دستیار هوشمند) با محتوای فعلی سندباکس
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v257-stage
OUT=/tmp/fitup-deploy-2026-11-04-v257.zip
V256_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-04-v256.zip
V256_LIST=/tmp/v256-filelist-ref.txt

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# ۱) فهرست فایل‌های زیپ v256 (مرجع کامل‌بودن — فقط فایل، بدون پوشه‌های خالی)
unzip -Z1 "$V256_ZIP" | grep -v '/$' | sed 's/\r$//' > "$V256_LIST"
echo "مرجع v256: $(wc -l < "$V256_LIST") فایل"

# ۲) کپی فایل‌های v256 از سندباکس (با محتوای فعلی = شامل فیکس‌های v257) — بدون رسانه/APK/DB
COPIED=0; MISSING=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    db-rescue/custom.db) continue;;
    download/*.apk|public/downloads/*.apk) continue;;
    public/*.png|public/*.webp|public/*.avif|public/*.jpg|public/*.jpeg|public/*.gif|public/*.mp4) continue;;
    public/og/*.png|public/free-programs/*.jpg|public/free-programs/*.webp) continue;;
    audit-b-*.ts|audit-b-*.json) continue;;
    download/fitup-db-snapshot-*.db|download/fitup-db-snapshot-*.db-shm|download/fitup-db-snapshot-*.db-wal) continue;;
  esac
  if [ -f "$f" ]; then
    mkdir -p "$STAGE/$(dirname "$f")"
    cp "$f" "$STAGE/$f"
    COPIED=$((COPIED+1))
  else
    MISSING="$MISSING$f\n"
  fi
done < "$V256_LIST"

# ۳) فایل‌های جدید v257
NEW_FILES=(
  scripts/build-zip-v257.sh
  scripts/snapshot-v257.ts
  download/راهنما-سرور-v257.md
)
ADDED=0
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then
    mkdir -p "$STAGE/$(dirname "$f")"
    cp "$f" "$STAGE/$f"
    ADDED=$((ADDED+1))
  else
    echo "⚠️ فایل جدید v257 پیدا نشد: $f"
  fi
done

# ۴) وریفای کامل‌بودن: هر فایل سورس سندباکس که در استیج نیست = هشدار (به‌جز استثناها)
echo "── وریفای پوشش کامل سورس ──"
GAPS=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.db|*.db-*|*.bak|*.snapshot-*|*.gz) continue;;
    audit-b-*.ts|audit-b-*.json|check-tmp.ts|cleanup-tmp.ts|check-db-state-tmp.ts) continue;;
    dev.log|*.log|tool-results|agent-ctx|node_modules|.next|.env*|upload|uploads|download/fitup-db-snapshot-*|db/tmp-snap) continue;;
    ai-e2e-v256-result.json) continue;;
    download/db-2026-*|download/v239-research/*|download/fitup-deploy-*.zip|download/fitup-guest-post-*.zip) continue;;
    mini-services/*/logs|mini-services/*/outbox|mini-services/*/state) continue;;
    public/*.png|public/*.webp|public/*.avif|public/*.jpg|public/*.jpeg|public/og/*|public/free-programs/*|public/images/*|public/downloads/*.apk) continue;;
    download/*.apk) continue;;
  esac
  if [ -f "$f" ] && [ ! -f "$STAGE/$f" ]; then
    case "$f" in
      src/*|prisma/*|mini-services/*|fitup-app/*|fitup-bazaar/*|public/sw.js|public/manifest.json|public/llms*.txt|public/maintenance.html|public/google*.html|public/robots.txt|Caddyfile|*.json|*.ts|*.tsx|*.mjs|*.md|*.sh)
        echo "  ❓ در استیج نیست: $f"; GAPS=$((GAPS+1));;
    esac
  fi
done < <(find src prisma mini-services fitup-app fitup-bazaar public scripts download -type f 2>/dev/null | rg -v "node_modules|\.next|/uploads/|fitup-app/(build|\.gradle|gradle/|app/build)|\.apk$|\.keystore$" | rg -v "mini-services/[^/]+/(logs|outbox|state)/")

echo ""
echo "COPIED=$COPIED  ADDED=$ADDED  GAPS=$GAPS"
if [ -n "$MISSING" ]; then echo "── فایل‌های v256 که در سندباکس نیستند ──"; echo -e "$MISSING"; fi
if [ "$GAPS" -gt 0 ]; then
  echo "⛔ گپ سورس وجود دارد — زیپ ساخته نمی‌شود."
  exit 1
fi

# ۵) گارد نهایی — ممنوعه‌ها (دقیقاً طبق الگوی زیپ v256):
#    ❌ APK باینری / DB / .env / رسانهٔ سایت public (به‌جز favicon.ico)
#    ✅ ریسورس‌های سورس اپ اندروید (fitup-app, fitup-bazaar) و کلیدستورها مجازند — در v256 هم بودند
FORBIDDEN=""
while IFS= read -r f; do
  f="${f#./}"
  case "$f" in
    *.apk) FORBIDDEN="$FORBIDDEN$f (APK باینری)"$'\n';;
    *.db|*.db-shm|*.db-wal|*.sqlite|*.sqlite3|download/fitup-db-snapshot-*) FORBIDDEN="$FORBIDDEN$f (DB)"$'\n';;
    .env) FORBIDDEN="$FORBIDDEN$f (سکرت)"$'\n';;
    public/*.jpg|public/*.jpeg|public/*.png|public/*.webp|public/*.avif|public/*.gif|public/*.mp4|public/og/*|public/free-programs/*|public/images/*)
      [ "$f" = "public/favicon.ico" ] && continue
      FORBIDDEN="$FORBIDDEN$f (رسانهٔ سایت)"$'\n';;
  esac
done < <(cd "$STAGE" && find . -type f | sort)
if [ -n "$FORBIDDEN" ]; then
  echo "⛔ فایل ممنوعه در استیج:"; echo "$FORBIDDEN"
  exit 1
fi
echo "گارد ممنوعه‌ها: پاک ✅"

# ۶) ساخت زیپ نهایی
cd "$STAGE"
zip -q -r "$OUT" .
cd /home/z/my-project
SIZE=$(du -h "$OUT" | cut -f1)
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo ""
echo "════════════════════════════════════════"
echo "زیپ v257 ساخته شد: $OUT"
echo "حجم: $SIZE — تعداد فایل: $COUNT — COPIED=$COPIED ADDED=$ADDED GAPS=0"
echo "════════════════════════════════════════"
