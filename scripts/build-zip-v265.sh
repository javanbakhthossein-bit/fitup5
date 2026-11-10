#!/bin/bash
# build-zip-v265.sh — ساخت زیپ دیپلوی v265 «فقط سورس کد کامل + ۲ APK آخر»
# قانون ثابت زیپ‌سازی مالک (v261 به بعد — تا ابد):
#   زیپ = تمام سورس کد بدون نقص و کم‌وکاستی + دو اپ اندروید آخرین نسخه
#   (fitup-own + fitup-bazaar). هیچ چیز دیگری (عکس/ویدیو/DB/media) داخل زیپ نیست.
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v265-stage
OUT=/tmp/fitup-deploy-2026-11-09-v265.zip
FINAL=/home/z/my-project/download/fitup-deploy-2026-11-09-v265.zip
# مرجع فهرست = فایل‌های زیپ تأییدشدهٔ v264 (همان سورس + فیکس‌های v265)
REF_LIST=/tmp/v265-filelist-ref.txt
REF_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-09-v264.zip

OWN_APK=download/fitup-own-v1.19.4.apk
BAZAAR_APK=download/fitup-bazaar-v1.17.3.apk

rm -rf "$STAGE" "$OUT"; mkdir -p "$STAGE"

# فهرست مرجع از زیپ v264
unzip -Z1 "$REF_ZIP" | grep -v '/$' | sed 's/\r$//' > "$REF_LIST"
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
done < "$REF_LIST"

# ─── فایل‌های جدید v265 ───
NEW_FILES=(
  scripts/test-v265-analysis-token.ts
  scripts/test-v265-renewal-context.ts
  scripts/v265-test-session.ts
  scripts/stub-next-headers.ts
  scripts/build-zip-v265.sh
  download/راهنما-سرور-v265.md
)
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"; COPIED=$((COPIED+1)); else echo "⚠️ new file missing: $f" >&2; MISSING="$MISSING$v265:$f\n"; fi
done

# ─── دو اپ اندروید آخرین نسخه (قانون ثابت) ───
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
echo "✅ v265 zip: $FINAL"
echo "   فایل‌ها: $COUNT | حجم: $SIZE"
echo "   کوپی‌شده: $COPIED"
if [ -n "$MISSING" ]; then echo "⚠️ MISSING:"; echo -e "$MISSING" | head -20; fi
echo "── چک‌های نهایی ──"
zl() { unzip -Z1 "$FINAL" | grep -c "$1" || true; }
zl "fitup-own-v1.19.4.apk\|fitup-bazaar-v1.17.3.apk" | xargs echo "   APK داخل زیپ (باید 2):"
zl "\.env$" | xargs echo "   .env داخل زیپ (باید 0):"
zl "node_modules/" | xargs echo "   node_modules (باید 0):"
zl "custom\.db$" | xargs echo "   DB داخل زیپ (باید 0):"
zl "راهنما-سرور-v265" | xargs echo "   راهنمای v265:"
unzip -p "$FINAL" src/components/fitness/landing/sections/purchase-modal.tsx | grep -c "v265" | xargs echo "   فیکس مودال v265 (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/abandoned-cart-scenario.ts | grep -c "v265" | xargs echo "   فیکس توکن ۲ساعته (باید ≥1):"
unzip -p "$FINAL" src/app/api/onboarding/analysis-discount/route.ts | grep -c "v265" | xargs echo "   فیکس revoke (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/payment-delivery.ts | grep -c "v265" | xargs echo "   فیکس حفظ روزها (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/program-generation.ts | grep -c "v265" | xargs echo "   فیکس عکس‌های قبلی (باید ≥1):"
unzip -p "$FINAL" package.json | grep '"version": "265.0.0"' | xargs echo "   نسخهٔ package.json:"
