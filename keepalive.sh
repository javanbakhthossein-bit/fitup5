#!/bin/bash
# Keepalive robust برای FitUp dev server
# مشکل: OOM killer سرور را می‌کشد (Next.js dev حافظه زیادی مصرف می‌کند)
# راه‌حل: هر ۲۰ ثانیه چک کن، اگر مرده دوباره روشن کن
cd /home/z/my-project

while true; do
  if ! pgrep -f "bun run dev" > /dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] restarting dev server..." >> /home/z/my-project/keepalive.log
    cd /home/z/my-project
    nohup bun run dev > /home/z/my-project/dev.log 2>&1 &
    disown
    sleep 15
  fi
  sleep 20
done
