#!/bin/bash
# build-zip-v261.sh — ساخت زیپ دیپلوی v261 «فقط سورس کد کامل + ۲ APK آخر»
# ═══════════════════════════════════════════════════════════════════════════
# قانون جدید زیپ‌سازی مالک (v261 به بعد — تا ابد):
#   زیپ = تمام سورس کد بدون نقص و کم‌وکاستی + دو اپ اندروید آخرین نسخه
#   (fitup-own + fitup-bazaar). هیچ چیز دیگری (عکس/ویدیو/DB/media) داخل زیپ نیست.
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v261-stage
OUT=/tmp/fitup-deploy-2026-11-09-v261.zip
FINAL=/home/z/my-project/download/fitup-deploy-2026-11-09-v261.zip
V260_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-08-v260.zip

OWN_APK=download/fitup-own-v1.19.4.apk
BAZAAR_APK=download/fitup-bazaar-v1.17.3.apk

rm -rf "$STAGE" "$OUT"; mkdir -p "$STAGE"

# فهرست مرجع = محتوای v260 (۱۷۴۵ فایل سورس)
unzip -Z1 "$V260_ZIP" | grep -v '/$' | sed 's/\r$//' > /tmp/v261-filelist-ref.txt
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
    mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"; COPIED=$((COPIED+1))
  else
    MISSING="$MISSING$f\n"
  fi
done < /tmp/v261-filelist-ref.txt

# ─── فایل‌های جدید v261 ───
NEW_FILES=(
  src/lib/fitness/plan-scientific-guards.ts
  scripts/sc-analyze-v261.ts
  scripts/audit-all-plans-v261.ts
  scripts/sweep-plan-repairs-v261.ts
  scripts/build-zip-v261.sh
  download/راهنما-سرور-v261.md
  download/گزارش-سرچ-کنسول-v261.txt
  download/گزارش-ممیزی-برنامه‌ها-v261.txt
  download/گزارش-جاروی-بازآرایی-v261.txt
)
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"; COPIED=$((COPIED+1)); else echo "⚠️ new file missing: $f" >&2; MISSING="$MISSING$new:$f\n"; fi
done

# ─── دو اپ اندروید آخرین نسخه (قانون جدید زیپ‌سازی) ───
for f in "$OWN_APK" "$BAZAAR_APK"; do
  if [ -f "$f" ]; then mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"; COPIED=$((COPIED+1)); else echo "❌ APK missing: $f" >&2; exit 1; fi
done

cd "$STAGE"
zip -q -r "$OUT" . -x '.*' '!.*'
mkdir -p "$(dirname "$FINAL")"
mv "$OUT" "$FINAL"

COUNT=$(unzip -Z1 "$FINAL" | grep -v '/$' | wc -l)
SIZE=$(du -h "$FINAL" | cut -f1)
echo "════════════════════════════════════════"
echo "✅ v261 zip: $FINAL"
echo "   فایل‌ها: $COUNT | حجم: $SIZE"
echo "   کوپی‌شده: $COPIED"
if [ -n "$MISSING" ]; then echo "⚠️ MISSING:"; echo -e "$MISSING" | head -20; fi
echo "── چک‌های نهایی ──"
unzip -Z1 "$FINAL" | grep -c "fitup-own-v1.19.4.apk\|fitup-bazaar-v1.17.3.apk" | xargs echo "   APK داخل زیپ:"
unzip -Z1 "$FINAL" | grep -c "\.env$" | xargs echo "   .env داخل زیپ (باید 0):"
unzip -Z1 "$FINAL" | grep -c "node_modules/" | xargs echo "   node_modules (باید 0):"
unzip -Z1 "$FINAL" | grep -c "custom.db$" | xargs echo "   DB داخل زیپ (باید 0):"
unzip -Z1 "$FINAL" | grep -c "plan-scientific-guards.ts" | xargs echo "   ماژول گارد v261:"
