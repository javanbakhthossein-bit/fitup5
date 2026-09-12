#!/bin/bash
# اجرای مستقیم سرور با restart خودکار + گرم‌کردن خودکار بعد از هر بوت
cd /home/z/my-project
# ─── منطق حافظه (مهم — درس‌آموخته Next.js 16) ───
# Next 16 بعد از «هر درخواست» در dev چک می‌کند: اگر used_heap_size > 80% heap_size_limit
# باشد، خودش graceful restart می‌زند (exit 0!) — پیام: "Server is approaching the used
# memory threshold, restarting". __NEXT_DISABLE_MEMORY_WATCHER این چک را خاموش نمی‌کند!
# heap_size_limit از --max-old-space-size می‌آید؛ پس:
#   1024MB → آستانه ~۹۰۰MB → بعد از هر گرم‌شدن restart بی‌وقفه (بد!)
#   1536MB → آستانه ~1.3GB → restart هر چند دقیقه (رفتار اولیه شکایت کاربر)
#   2048MB → آستانه ~1.7GB → heap گرم (~1.2GB) زیر آستانه → پایدار ✅
#     و RSS کل ~2-2.4GB در سندباکس 4GB جا می‌شود (OOM نمی‌شود).
export NODE_OPTIONS="--max-old-space-size=2048"
# بی‌اثر برای چک heap ولی برای رفتار file-watcher نگه داشته شده (ضرری ندارد)
export __NEXT_DISABLE_MEMORY_WATCHER=1

WARMUP_LOG=/home/z/my-project/warmup.log
# ترتیب حیاتی است: payment/checkout سنگین‌ترین کامپایل را دارد و اگر بعد از
# صفحه اصلی (RSS ~۲GB) کامپایل شود، حافظه ترکید و OOM می‌شود → اولِ اول،
# وقتی سرور تازه بالا آمده و RSS ~۳۰۰MB است کامپایل می‌شود.
WARM_ROUTES=(
  "/api/payment/checkout"
  "/"
  "/api/auth/me"
  "/api/nika/chat"
  "/api/nika/guest-chat"
)

warmup() {
  echo "[$(date '+%H:%M:%S')] warmup started (pid $$)" >> "$WARMUP_LOG"
  # گرم‌کردن ترتیبی — نه موازی (کامپایل موازی حافظه را ترکید می‌کند)
  for route in "${WARM_ROUTES[@]}"; do
    # اگر سرور در حین گرم‌کردن مرد، حلقه بیرونی ری‌استارت می‌کند و
    # گرم‌کردن دوباره از صفر اجرا می‌شود — self-healing
    OK=0
    for attempt in 1 2 3; do
      # curl اول اگر پورت هنوز بالا نیست (000) بعد از ۲ ثانیه retry می‌شود؛
      # وقتی پورت بالا آمد، همین درخواست کامپایل مسیر را شروع می‌کند
      if curl -s -o /dev/null -m 150 "http://localhost:3000$route" 2>/dev/null; then
        OK=1
        break
      fi
      sleep 2
    done
    if [ "$OK" != "1" ]; then
      echo "[$(date '+%H:%M:%S')] warmup ABORTED at $route (server died) — will retry after restart" >> "$WARMUP_LOG"
      return 1
    fi
    echo "[$(date '+%H:%M:%S')] warmed: $route" >> "$WARMUP_LOG"
  done
  echo "[$(date '+%H:%M:%S')] warmup COMPLETE — all routes hot" >> "$WARMUP_LOG"
}

while true; do
  echo "[$(date '+%H:%M:%S')] starting..." >> /home/z/my-project/server-run.log
  bun run dev > /home/z/my-project/dev.log 2>&1 &
  DEVPID=$!
  # گرم‌کردن خودکار در پس‌زمینه همین پروسه (sequential)
  warmup >> /dev/null 2>&1 &
  wait $DEVPID
  EXIT=$?
  echo "[$(date '+%H:%M:%S')] exited with $EXIT" >> /home/z/my-project/server-run.log
  sleep 3
done
