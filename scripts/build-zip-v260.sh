#!/bin/bash
# build-zip-v260.sh — ساخت زیپ دیپلوی v260 «فقط سورس کد کامل»
set -euo pipefail
cd /home/z/my-project
STAGE=/tmp/v260-stage
OUT=/tmp/fitup-deploy-2026-11-08-v260.zip
V257_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-04-v257.zip
rm -rf "$STAGE" "$OUT"; mkdir -p "$STAGE"
unzip -Z1 "$V257_ZIP" | grep -v '/$' | sed 's/\r$//' > /tmp/v260-filelist-ref.txt
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
  if [ -f "$f" ]; then mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"; COPIED=$((COPIED+1)); else MISSING="$MISSING$f\n"; fi
done < /tmp/v260-filelist-ref.txt
NEW_FILES=(
  scripts/test-leg-day-budget-v259.ts
  src/lib/fitness/fa-date.ts
  scripts/build-zip-v259.sh
  scripts/build-zip-v260.sh
  download/راهنما-سرور-v259.md
  download/راهنما-سرور-v260.md
)
ADDED=0
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then mkdir -p "$STAGE/$(dirname "$f")"; cp "$f" "$STAGE/$f"; ADDED=$((ADDED+1)); else echo "⚠️ پیدا نشد: $f"; fi
done
echo "── گارد ممنوعه‌ها ──"
FORBIDDEN=0
[ -f "$STAGE/.env" ] && { echo "⛔ .env در استیج!"; FORBIDDEN=1; }
find "$STAGE" -name "*.apk" | grep -q . && { echo "⛔ APK!"; FORBIDDEN=1; }
find "$STAGE" -name "*.db" | grep -q . && { echo "⛔ DB!"; FORBIDDEN=1; }
echo "── وریفای تغییرات v260 داخل استیج ──"
V=0
grep -q "repairWorkoutPlanArmSubmuscles" "$STAGE/src/lib/fitness/ai.ts" && V=$((V+1)) || echo "❌ گارد بازو در ai.ts"
grep -q "critiqueWorkoutPlanAI" "$STAGE/src/lib/fitness/ai.ts" && V=$((V+1)) || echo "❌ ایرادسنجی در ai.ts"
grep -q "generateWorkoutPlanWithCritique" "$STAGE/src/lib/fitness/program-generation.ts" && V=$((V+1)) || echo "❌ مسیر تولید+ایرادسنجی"
grep -q "v260 — تناسب جنسیتی" "$STAGE/src/lib/fitness/ai.ts" && V=$((V+1)) || echo "❌ دستور جنسیت"
grep -q "walletTopupRevenue" "$STAGE/src/app/api/admin/finance-summary/route.ts" && V=$((V+1)) || echo "❌ هم‌ترازی مالی"
grep -q "planSalesRevenue" "$STAGE/src/components/fitness/views/admin-overlay.tsx" && V=$((V+1)) || echo "❌ کارت مالی"
echo "وریفای v260: $V/6"
cd "$STAGE" && zip -q -r -9 "$OUT" . && cd /home/z/my-project
echo "═══ RESULT ═══ COPIED=$COPIED ADDED=$ADDED FORBIDDEN=$FORBIDDEN"
du -h "$OUT"; unzip -Z1 "$OUT" | grep -v '/$' | wc -l
