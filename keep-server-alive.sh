#!/bin/bash
# Keep-alive قوی — هر ۲۰ ثانیه چک کن
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null -m 5 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] restart" >> /home/z/my-project/keepalive.log
    pkill -f "next dev" 2>/dev/null
    pkill -f "bun run dev" 2>/dev/null
    sleep 3
    rm -rf /home/z/my-project/.next/cache 2>/dev/null
    nohup npx next dev -p 3000 --webpack > /home/z/my-project/dev.log 2>&1 & disown
    sleep 25
  fi
  sleep 20
done
