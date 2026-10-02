#!/bin/bash
# FITUP_DEV_GUARD v143.2 — تک‌نمونه، ضدجنگ داخلی، مجهز به warmup
warm() {
  for u in "/?screen=panel&tab=dashboard" "/api/auth/me" "/api/dashboard/pulse" "/api/notifications" "/api/stats/public" "/api/progress" "/api/dashboard/journey" "/api/coach/plan" "/api/daily-status"; do
    curl -s -o /dev/null -m 120 "http://localhost:3000$u" >/dev/null 2>&1
    sleep 3
  done
}
spawn() {
  cd /home/z/my-project && NODE_OPTIONS=--max-old-space-size=1536 setsid nohup bun run dev >> /home/z/my-project/dev.log 2>&1 &
  for i in $(seq 1 90); do sleep 5; curl -sf -o /dev/null -m 10 http://localhost:3000/ && break; done
  warm
}
fails=0
while true; do
  sleep 20
  if curl -sf -o /dev/null -m 8 http://localhost:3000/; then fails=0; continue; fi
  fails=$((fails+1))
  if ! pgrep -f "next[-]server" >/dev/null 2>&1; then
    echo "[guard] missing -> respawn+warm $(date +%T)" >> /tmp/next-dev-guard.log
    pkill -9 -f "next[-]server" 2>/dev/null; sleep 2
    spawn; fails=0
  elif [ $fails -ge 9 ]; then
    echo "[guard] stuck 3min -> kill+respawn+warm $(date +%T)" >> /tmp/next-dev-guard.log
    pkill -9 -f "next[-]server" 2>/dev/null; sleep 2
    spawn; fails=0
  fi
done
