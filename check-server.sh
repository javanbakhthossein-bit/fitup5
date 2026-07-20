#!/bin/bash
# اگر سرور مرده، روشنش کن
cd /home/z/my-project
if ! curl -s -o /dev/null -m 5 http://localhost:3000/ 2>/dev/null; then
  pkill -f "next dev" 2>/dev/null
  sleep 2
  rm -rf /home/z/my-project/.next/cache 2>/dev/null
  export NODE_OPTIONS="--max-old-space-size=1536"
  nohup npx next dev -p 3000 --webpack > /home/z/my-project/dev.log 2>&1 &
  disown
  echo "[$(date '+%H:%M:%S')] restarted" >> /home/z/my-project/cron-restart.log
fi
