#!/usr/bin/env bash
# v210 — درایور راستی‌آزمایی با مدیریت OOM سندباکس:
# هر چک: سرور زنده؟ → گرم‌کردن مسیر با curl (بدون Chromium) → اجرای چک → نتیجه
set -u
cd /home/z/my-project

SERVER_URL="http://localhost:3000"
TOTAL_PASS=0
TOTAL_FAIL=0

server_alive() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$SERVER_URL/api/auth/me" 2>/dev/null | grep -qE "200|401" && return 0
  return 1
}

restart_server() {
  echo "  ⟳ سرور مرده — راه‌اندازی مجدد…"
  pkill -f "next dev" 2>/dev/null
  sleep 2
  nohup bun run dev >> dev.log 2>&1 &
  for i in $(seq 1 45); do
    if curl -s -o /dev/null --max-time 5 "$SERVER_URL/" 2>/dev/null; then
      echo "  ✓ سرور بالا آمد (تلاش $i)"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ سرور بالا نیامد"; return 1
}

run_check() {
  local NAME="$1"; shift
  local WARM=("$@")
  echo "── CHECK=$NAME ──"
  if ! server_alive; then
    restart_server || { TOTAL_FAIL=$((TOTAL_FAIL+1)); return; }
  fi
  # گرم‌کردن کامپایل‌ها بدون Chromium (ضد OOM)
  for url in "${WARM[@]}"; do
    curl -s -o /dev/null -w "  warm $url → %{http_code} (%{time_total}s)\n" -L --max-time 180 "$SERVER_URL$url"
  done
  if CHECK="$NAME" bun scripts/verify-v210-nika.mjs 2>&1 | grep -E "✅|❌|نتیجه|FATAL"; then
    :
  fi
  local RC=${PIPESTATUS[0]}
  if [ "$RC" -eq 0 ]; then TOTAL_PASS=$((TOTAL_PASS+1)); else TOTAL_FAIL=$((TOTAL_FAIL+1)); fi
}

run_check landing   "/" "/api/auth/me"
run_check auth      "/?screen=auth" "/api/auth/me"
run_check onboarding "/?screen=auth" "/api/auth/me"
run_check exercise  "/exercise/seed_ex_28" "/api/auth/me"
run_check referral  "/?ref=TEST210" "/api/auth/me"
run_check console   "/" "/api/auth/me"

echo ""
echo "═══ جمع‌بندی: $TOTAL_PASS چک سبز / $TOTAL_FAIL چک قرمز ═══"
