#!/bin/bash
# build-zip-v263.sh — ساخت زیپ دیپلوی v263 «فقط سورس کد کامل + ۲ APK آخر»
# ═══════════════════════════════════════════════════════════════════════════
# قانون جدید زیپ‌سازی مالک (v261 به بعد — تا ابد):
#   زیپ = تمام سورس کد بدون نقص و کم‌وکاستی + دو اپ اندروید آخرین نسخه
#   (fitup-own + fitup-bazaar). هیچ چیز دیگری (عکس/ویدیو/DB/media) داخل زیپ نیست.
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v263-stage
OUT=/tmp/fitup-deploy-2026-11-09-v263.zip
FINAL=/home/z/my-project/download/fitup-deploy-2026-11-09-v263.zip
V262_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-09-v262.zip

OWN_APK=download/fitup-own-v1.19.4.apk
BAZAAR_APK=download/fitup-bazaar-v1.17.3.apk

rm -rf "$STAGE" "$OUT"; mkdir -p "$STAGE"

# فهرست مرجع = محتوای v262 (فایل‌های سورس)
unzip -Z1 "$V262_ZIP" | grep -v '/$' | sed 's/\r$//' > /tmp/v263-filelist-ref.txt
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
done < /tmp/v263-filelist-ref.txt

# ─── فایل‌های جدید v263 ───
NEW_FILES=(
  scripts/build-zip-v263.sh
  download/راهنما-سرور-v263.md
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
echo "═══════════════════════════════════════"
echo "✅ v263 zip: $FINAL"
echo "   فایل‌ها: $COUNT | حجم: $SIZE"
echo "   کوپی‌شده: $COPIED"
if [ -n "$MISSING" ]; then echo "⚠️ MISSING:"; echo -e "$MISSING" | head -20; fi
echo "── چک‌های نهایی ──"
zl() { unzip -Z1 "$FINAL" | grep -c "$1" || true; }
zl "fitup-own-v1.19.4.apk\|fitup-bazaar-v1.17.3.apk" | xargs echo "   APK داخل زیپ:"
zl "\.env$" | xargs echo "   .env داخل زیپ (باید 0):"
zl "node_modules/" | xargs echo "   node_modules (باید 0):"
zl "custom\.db$" | xargs echo "   DB داخل زیپ (باید 0):"
zl "راهنما-سرور-v263" | xargs echo "   راهنمای v263:"
unzip -p "$FINAL" src/components/fitness/head-code-injector.tsx | grep -c "v263-fix" || true | xargs echo "   فیکس head-code-injector (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/plan-scientific-guards.ts | grep -c "v263-fix" || true | xargs echo "   فیکس plan-scientific-guards (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/program-generation.ts | grep -c "v263-fix" || true | xargs echo "   فیکس program-generation (باید ≥1):"
unzip -p "$FINAL" package.json | grep '"version": "263.0.0"' | xargs echo "   نسخهٔ package.json:"
