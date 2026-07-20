#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# راه‌حل قطعی برای پایداری سرور FitUp
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# مشکل: sandbox فقط ۴GB RAM دارد، Next.js dev ~۲GB مصرف می‌کند
# OOM killer سرور را می‌کشد
#
# راه‌حل: 
# ۱. محدود کردن حافظه Next.js به ۱.۵GB
# ۲. restart خودکار فوری
# ۳. پاک کردن cache قبل از restart
# ۴. لاگ‌گیری برای دیباگ
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cd /home/z/my-project
LOG=/home/z/my-project/supervisor.log

# محدودیت حافظه Next.js — prevents OOM
export NODE_OPTIONS="--max-old-space-size=1536"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] supervisor started (NODE_OPTIONS=$NODE_OPTIONS)" >> $LOG

while true; do
  # بررسی زنده بودن سرور
  if ! pgrep -f "next dev" > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] server down — restarting..." >> $LOG
    
    # پاک کردن cache برای آزادسازی حافظه
    rm -rf /home/z/my-project/.next/cache 2>/dev/null
    
    # آزادسازی page cache (در صورت امکان)
    sync 2>/dev/null
    
    # شروع سرور با محدودیت حافظه
    nohup npx next dev -p 3000 --webpack > /home/z/my-project/dev.log 2>&1 &
    DEV_PID=$!
    echo "[$(date '+%H:%M:%S')] started PID $DEV_PID" >> $LOG
    
    # صبر برای آماده شدن (حداکثر ۶۰ ثانیه)
    for i in $(seq 1 30); do
      sleep 2
      if curl -s -o /dev/null -m 3 http://localhost:3000/ 2>/dev/null; then
        echo "[$(date '+%H:%M:%S')] ready after ${i}x2s" >> $LOG
        break
      fi
    done
  fi
  
  # چک هر ۱۵ ثانیه
  sleep 15
done
