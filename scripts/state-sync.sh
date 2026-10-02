#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# FITUP_STATE_SYNC — نگهبان ضد-revert سندباکس (v142)
#
# مشکل: سندباکس هر بوت پروژه را از /home/sync/repo.tar بازمی‌گرداند؛ اگر prestop
# پلتفرم قبل از جمع‌شدن سندباکس نتواند اسنپ‌شات بگیرد (kill سخت/کرش)، همهٔ کارِ
# بعد از آخرین اسنپ‌شات از دست می‌رود (حادثهٔ v136→v140 و v141→v142).
#
# راه‌حل: این واچرِ ماندگار (فرزندِ درخت بوت mock-avalai — مقاوم به جمع‌کنندهٔ
# فرایند) به‌صورت دوره‌ای:
#   ۱) هر ۱۵ دقیقه: rsync کامل پروژه → /tmp/my-project (لایهٔ دفاع دوم —
#      این کپی بین بوت‌ها زنده می‌ماند و دو بار نجات‌دهنده بوده: v139 و v140)
#   ۲) هر ۶۰ دقیقه: ساخت repo.tar تازه به‌صورت اتمی (tmp + mv) → حتی اگر
#      prestop شکست بخورد، حداکثر یک ساعت کار از دست می‌رود.
#   ۳) فوری بعد از هر نشست کاری: اجرای دستی «--once» توسط ایجنت (قانون worklog)
#
# استفاده:
#   scripts/state-sync.sh          # حالت حلقهٔ همیشگی (توسط mock-avalai اسپاون می‌شود)
#   scripts/state-sync.sh --once   # یک‌بار همگام‌سازی فوری (انتهای هر نشست کاری)
#
# خروجی لاگ: /tmp/fitup-state-sync.log | وضعیت: /home/sync/.last-state-sync
# ─────────────────────────────────────────────────────────────────────────────
set -u

PROJECT=/home/z/my-project
TMP_COPY=/tmp/my-project
REPO_TAR=/home/sync/repo.tar
STATUS_FILE=/home/sync/.last-state-sync
LOG=/tmp/fitup-state-sync.log
LOCK=/tmp/fitup-state-sync.lock
TMP_INTERVAL=900    # ۱۵ دقیقه
TAR_INTERVAL=3600   # ۶۰ دقیقه

log() { echo "[state-sync $(date '+%F %T')] $*" >> "$LOG" 2>/dev/null; }

# قفل فقط دورِ خودِ عملیات (نه عمرِ واچر) — تا اجرای دستیِ --once همیشه ممکن باشد
# usage: run_locked -n cmd…   (غیرمسدود — مناسب حلقه)
#        run_locked -w cmd…   (مسدود تا ۲ دقیقه — مناسب اجرای دستی)
run_locked() {
  local mode="$1"; shift
  exec 9>"$LOCK"
  if [ "$mode" = "-w" ]; then
    flock -w 120 9 || { log "lock wait timeout (120s)"; exec 9>&-; return 1; }
  else
    flock -n 9 || { log "another sync action in progress — skip"; exec 9>&-; return 1; }
  fi
  "$@"
  local rc=$?
  flock -u 9 2>/dev/null
  exec 9>&-
  return $rc
}

# ⚠️ الگوی حیاتی: «upload» فقط با لنگرِ ریشه حذف شود (مسیر mount سندباکس).
# حذفِ بدون‌لنگر، مسیر route ی src/app/api/coach/chat/upload را هم می‌بلعد!
COMMON_EXCLUDES=(
  --exclude=/upload
  --exclude=/node_modules
  --exclude=/.next
  --exclude=/skills
  --exclude=/dev.log
  --exclude=/tool-results
  --exclude=/tsconfig.tsbuildinfo
  --exclude=/.next.buildtest
  --exclude=/.initial_snapshot.json
  --exclude=/.pending_clone.json
  --exclude=/.zscripts/dev.pid
  --exclude=/.zscripts/*.log
)

health_ok() {
  [ -f "$PROJECT/package.json" ] && [ -d "$PROJECT/src" ] \
    && grep -q '"version"' "$PROJECT/package.json" 2>/dev/null
}

sync_tmp_copy() {
  rsync -a --delete "${COMMON_EXCLUDES[@]}" \
    --exclude=/.git \
    "$PROJECT/" "$TMP_COPY/" >>"$LOG" 2>&1
}

build_repo_tar() {
  # گام ۰: فضای دیسک (حداقل حجم پروژه + ۲۰۰MB حاشیه)
  local need_kb avail_kb
  need_kb=$(du -sk --exclude=upload --exclude=node_modules --exclude=.next \
              --exclude=skills "$PROJECT" 2>/dev/null | cut -f1)
  avail_kb=$(df -k /home/sync 2>/dev/null | awk 'NR==2{print $4}')
  if [ -n "$need_kb" ] && [ -n "$avail_kb" ] \
     && [ "$avail_kb" -lt "$((need_kb + 200000))" ]; then
    log "SKIP tar: not enough space (need ~${need_kb}KB, avail ${avail_kb}KB)"
    return 1
  fi

  # گام ۱: ساخت اتمی (tmp file → mv روی همان فایل‌سیستم)
  local tmpf
  tmpf="${REPO_TAR}.tmp.$$"
  # الگوی v141: tar با مسیرهای نسبی ./ (سازگار با استخراج start.sh)
  tar -cf "$tmpf" \
    --exclude='./upload' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='./skills' \
    --exclude='./dev.log' \
    --exclude='./tool-results' \
    --exclude='./tsconfig.tsbuildinfo' \
    --exclude='./.next.buildtest' \
    --exclude='./.initial_snapshot.json' \
    --exclude='./.pending_clone.json' \
    --exclude='./.zscripts/dev.pid' \
    --exclude='./.zscripts/*.log' \
    -C "$PROJECT" . >>"$LOG" 2>&1
  local tar_rc=$?
  if [ "$tar_rc" -ne 0 ] || [ ! -s "$tmpf" ]; then
    log "FAIL tar (rc=$tar_rc) — tmp file removed, repo.tar قبلی دست‌نخورده ماند"
    rm -f "$tmpf"
    return 1
  fi

  # گام ۲: راستی‌آزمایی حداقلی قبل از تعویض اتمی
  local size
  size=$(stat -c%s "$tmpf" 2>/dev/null || echo 0)
  local nm_count
  nm_count=$(tar -tf "$tmpf" 2>/dev/null | grep -c '^\./node_modules/' || true)
  if [ "$size" -lt 10485760 ] || [ "$nm_count" -ne 0 ]; then
    log "FAIL verify (size=${size}B, node_modules entries=${nm_count}) — تعویض انجام نشد"
    rm -f "$tmpf"
    return 1
  fi

  mv -f "$tmpf" "$REPO_TAR"
  log "repo.tar rebuilt: $(("$size" / 1048576))MB — $(date '+%F %T')"
  echo "last_tar=$(date '+%F %T') size=${size}" >> "$STATUS_FILE"
  tail -1 "$STATUS_FILE" > "$STATUS_FILE.tmp" && mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
  return 0
}

# ─── حالت اجرا ───
if [ "${1:-}" = "--once" ]; then
  if ! health_ok; then log "once: project unhealthy — abort"; exit 1; fi
  log "── once: شروع همگام‌سازی فوری ──"
  run_locked -w sync_tmp_copy && log "once: tmp-copy ok"
  run_locked -w build_repo_tar
  exit $?
fi

# ─── حالت حلقهٔ دائمی ───
log "watcher started (pid $$)"
# baseline: اگر repo.tar تازه است، tar اول را به تعویق بینداز (ضد فشار روی بوت)
last_tar=$(stat -c %Y "$REPO_TAR" 2>/dev/null || echo 0)
while true; do
  if health_ok; then
    run_locked -n sync_tmp_copy && log "tmp-copy ok"
    now=$(date +%s)
    if [ $((now - last_tar)) -ge "$TAR_INTERVAL" ]; then
      if run_locked -n build_repo_tar; then last_tar=$(date +%s); fi
    fi
  else
    log "skip cycle: project unhealthy"
  fi
  sleep "$TMP_INTERVAL"
done
