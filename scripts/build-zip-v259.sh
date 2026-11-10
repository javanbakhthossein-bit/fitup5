#!/bin/bash
# build-zip-v259.sh — ساخت زیپ دیپلوی v259 «فقط سورس کد کامل»
# دیرکتیو مالک (۲۰۲۶-۱۱-۰۸): رفع کامل #418، حذف کارت‌های داشبورد، فیکس بینش قیف، بودجهٔ روز پا
#   ✅ تمام سورس کد (پایه: فهرست فایل‌های زیپ v257 + فایل‌های جدید v259)
#   ❌ نه DB، نه APK، نه عکس/ویدیو، نه .env (قانون ثابت)
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/v259-stage
OUT=/tmp/fitup-deploy-2026-11-08-v259.zip
V257_ZIP=/home/z/my-project/download/fitup-deploy-2026-11-04-v257.zip

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

unzip -Z1 "$V257_ZIP" | grep -v '/$' | sed 's/\r$//' > /tmp/v259-filelist-ref.txt
echo "مرجع v257: $(wc -l < /tmp/v259-filelist-ref.txt) فایل"

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
done < /tmp/v259-filelist-ref.txt

NEW_FILES=(
  scripts/test-leg-day-budget-v259.ts
  src/lib/fitness/fa-date.ts
  download/راهنما-سرور-v259.md
)
ADDED=0
for f in "${NEW_FILES[@]}"; do
  if [ -f "$f" ]; then
    mkdir -p "$STAGE/$(dirname "$f")"
    cp "$f" "$STAGE/$f"
    ADDED=$((ADDED+1))
  else
    echo "⚠️ فایل جدید v259 پیدا نشد: $f"
  fi
done

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
    mini-services/*/logs|mini-services/*/outbox|mini-services/*/state|mini-services/*/node_modules) continue;;
    skills/*) continue;;
    agent-ctx/*) continue;;
    scripts/build-zip-*.sh) continue;;
    public/*.png|public/*.webp|public/*.avif|public/*.jpg|public/*.jpeg|public/og/*|public/free-programs/*|public/images/*|public/downloads/*.apk) continue;;
    download/*.apk) continue;;
  esac
  if [ -f "$f" ] && [ ! -f "$STAGE/$f" ]; then
    case "$f" in
      src/*|prisma/*|mini-services/*|fitup-app/*|fitup-bazaar/*|public/sw.js|public/manifest.json|public/llms*.txt|public/maintenance.html|public/google*.html|public/robots.txt|Caddyfile|*.json|*.ts|*.tsx|*.mjs|*.md|*.sh)
        echo "  ❓ در استیج نیست: $f"; GAPS=$((GAPS+1));;
    esac
  fi
done < <(git ls-files --others --exclude-standard --cached 2>/dev/null | sort -u; for d in src scripts prisma public fitup-app fitup-bazaar download mini-services db-rescue; do find "$d" -type f; done; find . -maxdepth 1 -type f | sed 's|^\./||')

# گارد ممنوعه‌ها
echo "── گارد ممنوعه‌ها ──"
FORBIDDEN=0
if [ -f "$STAGE/.env" ]; then echo "⛔ .env در استیج!"; FORBIDDEN=1; fi
if find "$STAGE" -name "*.apk" | grep -q .; then echo "⛔ APK در استیج!"; FORBIDDEN=1; fi
if find "$STAGE" -name "*.db" | grep -q .; then echo "⛔ DB در استیج!"; FORBIDDEN=1; fi

# وریفای حضور تغییرات v259
echo "── وریفای تغییرات v259 داخل استیج ──"
V=0
grep -q "v259 — حذف کامل رِیس تزریق" "$STAGE/src/app/layout.tsx" && V=$((V+1)) || echo "❌ layout.tsx بدون گیت v259"
grep -q "formatFaDateDeterministic" "$STAGE/src/lib/fitness/fa-date.ts" && V=$((V+1)) || echo "❌ fa-date ناقص"
grep -q "enforceLegDayBudget" "$STAGE/src/lib/fitness/coach-blueprint.ts" && V=$((V+1)) || echo "❌ گارد روز پا در coach-blueprint"
grep -q "enforceLegDayBudget" "$STAGE/src/lib/fitness/ai.ts" && V=$((V+1)) || echo "❌ گارد روز پا در ai.ts"
grep -q "بودجهٔ روز پا" "$STAGE/src/lib/fitness/program-generation.ts" && V=$((V+1)) || echo "❌ گارد روز پا در program-generation"
! grep -q "MRR نرمال‌شده" "$STAGE/src/app/api/admin/stats/route.ts" && V=$((V+1)) || echo "❌ MRR هنوز در stats"
! grep -q "تلاش برای اعمال کد تخفیف.*۹۷" "$STAGE/src/app/api/admin/funnel/route.ts" && V=$((V+1))
grep -q "mainLine = funnel.filter" "$STAGE/src/app/api/admin/funnel/route.ts" && V=$((V+1)) || echo "❌ فیکس بینش قیف"
grep -q "body placements هم دیگر" "$STAGE/src/components/fitness/head-code-injector.tsx" && V=$((V+1)) || echo "❌ گارد اسکریپت body"
echo "وریفای v259: $V/9"

cp "$OUT" /dev/null 2>/dev/null || true
cd "$STAGE" && zip -q -r -9 "$OUT" . && cd /home/z/my-project
SIZE=$(du -h "$OUT" | cut -f1)
FILES=$(unzip -Z1 "$OUT" | grep -v '/$' | wc -l)
echo "═══ RESULT ═══ COPIED=$COPIED ADDED=$ADDED GAPS=$GAPS FORBIDDEN=$FORBIDDEN"
echo "زیپ: $OUT — $SIZE — $FILES فایل"
