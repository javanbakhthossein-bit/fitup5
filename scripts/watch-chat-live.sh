#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# watch-chat-live.sh — تماشای زندهٔ لاگ «چت با فیتاپ» روی سرور پروداکشن (v100)
# ═══════════════════════════════════════════════════════════════════════════
# مصرف (روی سرور، در یک ترمینال):
#   bash scripts/watch-chat-live.sh
# بعد در همین حال، در اپ/سایت برو «چت با فیتاپ» و یک عکس یا ویدیو بفرست.
# همهٔ رویدادها زنده همین‌جا می‌آید. پایان: Ctrl+C
#
# خروجی خوانا — ترتیب سالمِ یک پیام رسانه‌دار:
#   ① [chat] POST media received: …          ← پیام با مدیا رسید
#   ② [chat][media-audit] frames extracted …  ← فریم ویدیو (فقط ویدیو)
#   ③ [chat][media-audit] vision analysis starting: kind=… frames=…
#   ④ [chat][media-audit] vision analysis done: ok=true …
#   ⑤ [chat][media-audit] mediaAnalysis cached: len=…
#   ⑥ [chat] aiChat call: … mediaAnalysisChars=<بیشتر از ۰ یعنی تحلیل به مربی تزریق شد>
#   ⑦ [chat] coach reply: … blindFlag=no head=…  ← v100: متنِ خامِ جواب مربی (قبل از پاک‌سازی)
#      ← اگر blindFlag=YES بود، بلافاصله بعدش [aiChat] ⚠️ ری‌تای ضدکور اجرا شده
#   ⑧ [chat] history blind claim scrubbed: …  ← اگر مربیِ قبلی «نرسیده» گفته بود (پاک شد)
#   ⑨ [chat] blind claim scrubbed: …          ← اگر خطِ کور در متن نهایی بود (پاک شد)
#   ⑩ [chat][media-audit] job COMPLETED …
#
# اگر ④ ok=false یا ⑥ mediaAnalysisChars=0 یا ⑦ blindFlag=YES بود
# → کل خروجی ترمینال را کپی کن و بفرست.
# ═══════════════════════════════════════════════════════════════════════════

LOGDIR="${PM2_HOME:-$HOME/.pm2}/logs"
OUT="$LOGDIR/fitup-out.log"
ERR="$LOGDIR/fitup-err.log"

echo "════════════════════════════════════════════════════════════════"
echo " 👁  تماشای زندهٔ لاگ چت فیتاپ (v100) — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"
[ -f "$OUT" ] && echo " 📄 out: $OUT" || echo " ⚠️ out لاگ پیدا نشد: $OUT"
[ -f "$ERR" ] && echo " 📄 err: $ERR" || echo " ⚠️ err لاگ پیدا نشد: $ERR"
echo " 👉 حالا در اپ: چت با فیتاپ → یک عکس یا ویدیو بفرست"
echo " ✋ پایان: Ctrl+C   |   بدون فیلتر کامل:  pm2 logs fitup --lines 200"
echo "────────────────────────────────────────────────────────────────"

tail -n 60 -F "$OUT" "$ERR" 2>/dev/null | grep --line-buffered -E \
  "\[chat\]|\[aiChat\]|aiChat-media-analysis|AvalAI error|validateContent|blind|mediaAnalysis|frames extracted|vision analysis|scrubbed|POST media|coach reply|ری‌تای"
