#!/bin/bash
# اجرای مستقیم سرور با restart خودکار
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=1024"
while true; do
  echo "[$(date '+%H:%M:%S')] starting..." >> /home/z/my-project/server-run.log
  bun run dev > /home/z/my-project/dev.log 2>&1
  EXIT=$?
  echo "[$(date '+%H:%M:%S')] exited with $EXIT" >> /home/z/my-project/server-run.log
  sleep 3
done
