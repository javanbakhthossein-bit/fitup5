#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# FITUP_DEV_GUARD_FILE (v207) — نگهبان فایل-محور سرور توسعه
#
# چرا فایل؟ نسخهٔ قبلی (inline در mock-avalai/index.ts) متن «bun run dev» را در
# cmdline خودش داشت و پاک‌کنندهٔ الگوییِ سندباکس (که بعد از هر فراخوانی ایجنت
# پروسه‌های bun/next خارج از درخت بوت را جمع می‌کند) خودِ نگهبان را هم می‌کشت.
# این نسخه: cmdline فقط «bash scripts/dev-guard.sh» است — نامرئی برای پاک‌کننده
# (اثبات: sleeperهای مشابه ساعت‌ها زنده می‌مانند).
#
# منطق = v143.1 هوشمند: «ناپاسخ» ≠ «مرده» — وسط کامپایل سنگین پورت جواب نمی‌دهد
# ولی پروسه زنده است. پروسه نیست → respawn فوری؛ ۸ چک پشت‌سرهم ناپاسخ (~۳ دقیقه)
# → kill + respawn. سرور همیشه با سقف حافظه (ضد OOM) بالا می‌آید.
# ─────────────────────────────────────────────────────────────────────────────
set -u
GUARD_LOG=/tmp/next-dev-guard.log
DEV_LOG=/home/z/my-project/dev.log

respawn_server() {
  echo "[guard-file] respawn server $(date '+%F %T')" >> "$GUARD_LOG"
  pkill -9 -f "next-server" 2>/dev/null
  pkill -9 -f "next dev" 2>/dev/null
  sleep 1
  # v207 — الگوی دبل-فورک (اثبات‌شده در سندباکس): bash داخلی فوراً exit می‌کند و
  # سرور همان لحظه یتیمِ init (ppid=1) می‌شود — پروسه‌هایی که هنگام پایان نشستِ
  # ایجنت هنوز فرزندِ زندهٔ شلِ نشست هستند در پاک‌سازی انتهایی کشته می‌شوند؛
  # یتیم‌های فوری (مثل state-sync و sleeperها) ساعت‌ها زنده می‌مانند.
  cd /home/z/my-project || return
  setsid bash -c 'nohup env NODE_OPTIONS="--max-old-space-size=2048" bun run dev >> /home/z/my-project/dev.log 2>&1 < /dev/null &' < /dev/null > /dev/null 2>&1
  # تا ۵ دقیقه صبر برای اولین 200 (کامپایل سرد) — قبل از ادامهٔ پایش
  for i in $(seq 1 60); do
    sleep 5
    curl -sf -o /dev/null -m 8 http://localhost:3000/ && break
  done
}

# تک‌نمونه با flock (cmdline فایل-محور است؛ مارکت متنی در pkill جواب نمی‌دهد)
exec 8> /tmp/fitup-dev-guard.lock
if ! flock -n 8; then
  echo "[guard-file] another instance holds the lock — exit" >> "$GUARD_LOG"
  exit 0
fi
echo "[guard-file] started pid=$$ $(date '+%F %T')" >> "$GUARD_LOG"

fails=0
while true; do
  sleep 20
  if curl -sf -o /dev/null -m 8 http://localhost:3000/; then
    fails=0
    continue
  fi
  fails=$((fails + 1))
  if ! pgrep -f "next-server" > /dev/null 2>&1; then
    respawn_server
    fails=0
  elif [ "$fails" -ge 8 ]; then
    echo "[guard-file] stuck ~3min unresponsive -> kill+respawn $(date '+%F %T')" >> "$GUARD_LOG"
    respawn_server
    fails=0
  fi
done
