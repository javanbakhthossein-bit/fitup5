#!/bin/bash
# FitUp sandbox watchdog — keeps the server on :3000 alive.
# Started detached (double-fork) so it survives tool-call cleanup.
# Mode-aware: restarts PRODUCTION standalone if a build exists, else DEV server.
# Every 20s: if :3000 is dead -> free memory (kill leftover chrome) -> restart.
#
# v2 — compile-tolerant:
#  - health-check timeout 10s→90s: در dev، کامپایل روی‌دمندِ یک روت سنگین
#    (مثل /articles) می‌تواند ۳۰-۶۰ ثانیه event-loop را بلاک کند؛ چک ۱۰ ثانیه‌ای
#    باعث kill شدن سرورِ سالم در وسط کامپایل و حلقهٔ بی‌نهایت restart می‌شد.
#  - restart فقط بعد از ۲ چک متوالی ناموفق (حذف false-positive).
# LOG: /home/z/my-project/watchdog.log (rotated at 5000 lines)

LOG=/home/z/my-project/watchdog.log
PROJECT=/home/z/my-project

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

# rotate log
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 5000 ] && tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

if [ -f "$PROJECT/.next/standalone/server.js" ]; then MODE=PROD; else MODE=DEV; fi
log "watchdog started (mode=$MODE, pid $$, v2 compile-tolerant)"

start_server() {
  if [ -f "$PROJECT/.next/standalone/server.js" ]; then
    log "restarting PRODUCTION standalone server"
    ( cd "$PROJECT" && set -a && source "$PROJECT/.env" 2>/dev/null; set +a && NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 node .next/standalone/server.js > server.log 2>&1 & )
  else
    log "restarting DEV server (no standalone build present)"
    ( cd "$PROJECT" && bun run dev > dev.log 2>&1 & )
  fi
}

FAILS=0
while true; do
  sleep 20
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ --max-time 90 2>/dev/null)
  if [ "$CODE" = "200" ] || [ "$CODE" = "307" ] || [ "$CODE" = "308" ]; then
    FAILS=0
    continue
  fi
  FAILS=$((FAILS+1))
  if [ "$FAILS" -lt 2 ]; then
    log "health check #1 failed (http=$CODE) — صبر برای چک بعدی (احتمالاً compile)"
    continue
  fi
  FAILS=0
  AVAIL=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  log "server DOWN after 2 consecutive checks (http=$CODE, avail=${AVAIL}MB)"
  # free memory if tight: leftover agent-browser chrome blocks the ~2.3GB dev compile
  if [ "$AVAIL" -lt 2500 ]; then
    pkill -f "agent-browser" 2>/dev/null && log "killed agent-browser to free memory"
    sleep 2
  fi
  pkill -f "next-server" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  pkill -f "standalone/server.js" 2>/dev/null
  sleep 2
  start_server
  # wait for it to come up (prod ~5s, dev cold compile up to ~150s)
  for i in $(seq 1 15); do
    sleep 10
    C2=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ --max-time 60 2>/dev/null)
    if [ "$C2" = "200" ] || [ "$C2" = "307" ] || [ "$C2" = "308" ]; then
      log "server UP again (http=$C2) after ~$((i*10))s"
      break
    fi
  done
done
