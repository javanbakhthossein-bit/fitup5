#!/bin/bash
# build-zip-v262.sh — ساخت زیپ دیپلوی v262 «فقط سورس کد کامل + ۲ APK آخر»
# ═══════════════════════════════════════════════════════════════════════════
# قانون جدید زیپ‌سازی مالک (v261 به بعد — تا ابد):
#   زیپ = تمام سورس کد بدون نقص و کم‌وکاستی + دو اپ اندروید آخرین نسخه
#   (fitup-own + fitup-bazaar). هیچ چیز دیگری (عکس/ویدیو/DB/media) داخل زیپ نیست.
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v262-stage
OUT=/tmp/fitup-deploy-2026-11-09-v262.zip
FINAL=/home/z/my-project/download/fitup-deploy-2026-11-09-v262.zip
V261_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-09-v261.zip

OWN_APK=download/fitup-own-v1.19.4.apk
BAZAAR_APK=download/fitup-bazaar-v1.17.3.apk

rm -rf "$STAGE" "$OUT"; mkdir -p "$STAGE"

# فهرست مرجع = محتوای v261 (فایل‌های سورس)
unzip -Z1 "$V261_ZIP" | grep -v '/$' | sed 's/\r$//' > /tmp/v262-filelist-ref.txt
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
done < /tmp/v262-filelist-ref.txt

# ─── فایل‌های جدید v262 ───
NEW_FILES=(
  src/lib/fitness/article-hub-links.ts
  src/components/fitness/articles/guides-strip.tsx
  scripts/rewrite-legacy-links-v262.ts
  scripts/build-zip-v262.sh
  download/راهنما-سرور-v262.md
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
echo "✅ v262 zip: $FINAL"
echo "   فایل‌ها: $COUNT | حجم: $SIZE"
echo "   کوپی‌شده: $COPIED"
if [ -n "$MISSING" ]; then echo "⚠️ MISSING:"; echo -e "$MISSING" | head -20; fi
echo "── چک‌های نهایی ──"
unzip -Z1 "$FINAL" | grep -c "fitup-own-v1.19.4.apk\|fitup-bazaar-v1.17.3.apk" | xargs echo "   APK داخل زیپ:"
unzip -Z1 "$FINAL" | grep -c "\.env$" | xargs echo "   .env داخل زیپ (باید 0):"
unzip -Z1 "$FINAL" | grep -c "node_modules/" | xargs echo "   node_modules (باید 0):"
unzip -Z1 "$FINAL" | grep -c "custom.db$" | xargs echo "   DB داخل زیپ (باید 0):"
unzip -Z1 "$FINAL" | grep -c "article-hub-links.ts" | xargs echo "   ماژول هاب‌لینک v262:"
unzip -Z1 "$FINAL" | grep -c "guides-strip.tsx" | xargs echo "   GuidesStrip v262:"
unzip -Z1 "$FINAL" | grep -c "rewrite-legacy-links-v262.ts" | xargs echo "   اسکریپت بازنویسی DB v262:"
unzip -Z1 "$FINAL" | grep '"version": "262.0.0"' | xargs echo "   نسخهٔ package.json:"
