#!/bin/bash
# build-zip-v264.sh — ساخت زیپ دیپلوی v264 «فقط سورس کد کامل + ۲ APK آخر»
# ═══════════════════════════════════════════════════════════════════════════
# قانون جدید زیپ‌سازی مالک (v261 به بعد — تا ابد):
#   زیپ = تمام سورس کد بدون نقص و کم‌وکاستی + دو اپ اندروید آخرین نسخه
#   (fitup-own + fitup-bazaar). هیچ چیز دیگری (عکس/ویدیو/DB/media) داخل زیپ نیست.
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v264-stage
OUT=/tmp/fitup-deploy-2026-11-09-v264.zip
FINAL=/home/z/my-project/download/fitup-deploy-2026-11-09-v264.zip
# مرجع فهرست = کلون گیت‌هاب v263 (fitup5) — سندباکس v263+فیکس‌ها = v264
REF_REPO=/tmp/fitup5

OWN_APK=download/fitup-own-v1.19.4.apk
BAZAAR_APK=download/fitup-bazaar-v1.17.3.apk

rm -rf "$STAGE" "$OUT"; mkdir -p "$STAGE"

# فهرست مرجع = فایل‌های v263 (از گیت)
git -C "$REF_REPO" -c core.quotepath=false ls-files | sed 's/\r$//' > /tmp/v264-filelist-ref.txt
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
done < /tmp/v264-filelist-ref.txt

# ─── فایل‌های جدید v264 ───
NEW_FILES=(
  scripts/repair-never-activated-v264.ts
  scripts/build-zip-v264.sh
  download/راهنما-سرور-v264.md
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
echo "✅ v264 zip: $FINAL"
echo "   فایل‌ها: $COUNT | حجم: $SIZE"
echo "   کوپی‌شده: $COPIED"
if [ -n "$MISSING" ]; then echo "⚠️ MISSING:"; echo -e "$MISSING" | head -20; fi
echo "── چک‌های نهایی ──"
zl() { unzip -Z1 "$FINAL" | grep -c "$1" || true; }
zl "fitup-own-v1.19.4.apk\|fitup-bazaar-v1.17.3.apk" | xargs echo "   APK داخل زیپ:"
zl "\.env$" | xargs echo "   .env داخل زیپ (باید 0):"
zl "node_modules/" | xargs echo "   node_modules (باید 0):"
zl "custom\.db$" | xargs echo "   DB داخل زیپ (باید 0):"
zl "راهنما-سرور-v264" | xargs echo "   راهنمای v264:"
zl "repair-never-activated-v264" | xargs echo "   اسکریپت ترمیم v264:"
unzip -p "$FINAL" src/app/api/payment/checkout/route.ts | grep -c "v264" || true | xargs echo "   فیکس checkout (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/payment-delivery.ts | grep -c "v264" || true | xargs echo "   فیکس payment-delivery (باید ≥1):"
unzip -p "$FINAL" src/lib/fitness/program-generation.ts | grep -c "v264" || true | xargs echo "   فیکس program-generation (باید ≥1):"
unzip -p "$FINAL" package.json | grep '"version": "264.0.0"' | xargs echo "   نسخهٔ package.json:"
