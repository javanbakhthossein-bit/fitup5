# ═══════════════════════════════════════════════════════════
#  فیتاپ v219 — اسکریپت خودکار nginx نسخهٔ ۳
#  (بکاپ + تست baseline + نردبان فال‌بک ۳ سطحی + رول‌بک خودکار)
#  مصرف: این فایل را روی سرور آپلود کن و بزن:  bash fitup-nginx-setup.sh
#  یا کل محتوایش را یک‌جا کپی و در ترمینال سرور پیست کن.
# ═══════════════════════════════════════════════════════════

bash <<'FITUP_SETUP_219'
#####################################################################
#  فیتاپ v219 — نصب خودکار و امن تنظیمات nginx + رفع robots.txt
#  نسخهٔ ۳ — درس از اجرای واقعی سرور:
#    • nginx -V گاهی «brotli» را نشان می‌دهد ولی دیرکتیو brotli واقعاً
#      در دسترس نیست (ماژول نصب/لود نشده) → نسخهٔ ۲ با حدس اشتباه کرد.
#    • نسخهٔ ۳ هیچ حدسی نمی‌زند: تنها داور، «تست واقعی nginx -t» است.
#      اگر Brotli با تست واقعی کار نکرد، خودش به Gzip برمی‌گردد و
#      اگر آن هم نشد فقط ریدایرکت www را اعمال می‌کند — نردبان ۳ سطحی.
#
#  امنیت (چرا نمی‌ترسد):
#   ۱) قبل از هر تغییری بکاپ کامل از /etc/nginx می‌گیرد
#   ۲) اول سلامت کانفیگ فعلی را با nginx -t چک می‌کند؛ اگر از قبل
#      خراب بوده باشد، دست به هیچ چیزی نمی‌زند و همان‌جا می‌ایستد
#   ۳) هیچ فایل موجودی nginx را ویرایش نمی‌کند — فقط «یک فایل جدید» اضافه می‌کند
#   ۴) دیرکتیوهای فشرده‌سازی موجود سرور را دوباره نمی‌نویسد (گارد duplicate)
#   ۵) هر نسخه از کانفیگ را قبل از قبول‌کردن با nginx -t تست می‌کند و
#      اگر نشد خودش یک سطح پایین‌تر می‌رود (Brotli ← Gzip ← فقط ریدایرکت)
#   ۶) بعد از اعمال، راستی‌آزمایی می‌کند؛ اگر نتیجه درست نبود خودش
#      همه‌چیز را به حالت قبل برمی‌گرداند (رول‌بک خودکار)
#####################################################################
set -u

DOMAIN="fittup.ir"
TS="$(date +%Y%m%d-%H%M%S)"
BAK="/root/nginx-backup-$TS"

NGINX_BIN="$(command -v nginx 2>/dev/null || true)"
[ -x "$NGINX_BIN" ] || NGINX_BIN="/usr/sbin/nginx"
[ -x "$NGINX_BIN" ] || NGINX_BIN="/usr/local/nginx/sbin/nginx"

hr() { echo "────────────────────────────────────────────────────"; }

# ── ۱) دسترسی روت ──
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ این کار نیاز به دسترسی root دارد."
  echo "   اگر با یوزر عادی لاگینی، اول بزن:  sudo -i   و بعد دوباره این بلاک را پیست کن."
  exit 1
fi
[ -x "$NGINX_BIN" ] || { echo "❌ nginx روی این سرور پیدا نشد!"; exit 1; }

hr
echo "🚀 فیتاپ v219 — نصب خودکار تنظیمات nginx (نسخهٔ ۳ — تست واقعی، بدون حدس)"
hr

# ── ۲) بکاپ کامل ──
mkdir -p "$BAK"
cp -a /etc/nginx/. "$BAK/" 2>/dev/null
echo "💾 بکاپ کامل کانفیگ nginx ذخیره شد در:  $BAK"

# ── ۲.۵) گیت baseline: سلامت کانفیگ فعلی (قبل از هر تغییری) ──
if ! T_OUT="$( "$NGINX_BIN" -t 2>&1 )"; then
  echo ""
  echo "❌ کانفیگ nginx از «قبل» خراب بوده است — این مشکل ربطی به این اسکریپت ندارد."
  echo "   چون تست قبل از هر تغییری گرفته شد، هیچ چیزی هم تغییر نکرد."
  echo "   بکاپ از وضعیت فعلی اینجاست:  $BAK"
  echo ""
  echo "   خروجی تست nginx -t:"
  echo "$T_OUT" | sed 's/^/     /'
  echo ""
  echo "   👉 لطفاً همین خروجی را برای من کپی کن تا خرابی قبلی را پیدا کنم."
  exit 1
fi
echo "✅ کانفیگ فعلی nginx سالم است (تست baseline پاس شد)."

# ── ۳) پیدا کردن کانفیگ اصلی سایت + مسیر گواهی SSL ──
NG_DIRS="/etc/nginx/sites-enabled /etc/nginx/conf.d"
SITE_FILE=""
# اولویت ۱: فایلی که هم «fittup» دارد هم گواهی SSL
for f in $(grep -rlE "fittup" $NG_DIRS /etc/nginx/nginx.conf 2>/dev/null); do
  if grep -q "ssl_certificate" "$f" 2>/dev/null; then SITE_FILE="$f"; break; fi
done
# اولویت ۲: فایلی که «fittup» دارد
if [ -z "$SITE_FILE" ]; then
  for f in $(grep -rlE "fittup" $NG_DIRS /etc/nginx/nginx.conf 2>/dev/null); do SITE_FILE="$f"; break; done
fi
# اولویت ۳: فایلی که به پورت ۳۰۰۰ پروکسی می‌کند
if [ -z "$SITE_FILE" ]; then
  for f in $(grep -rlE ":3000" $NG_DIRS 2>/dev/null); do SITE_FILE="$f"; break; done
fi
echo "📄 کانفیگ اصلی سایت:  ${SITE_FILE:-«پیدا نشد»}"

CERT=""; KEY=""
if [ -n "$SITE_FILE" ] && [ -f "$SITE_FILE" ]; then
  CERT="$(awk '/ssl_certificate[ \t]+/ && $0 !~ /_key/ {print $2}' "$SITE_FILE" | head -1 | tr -d ';\"')"
  KEY="$(awk '/ssl_certificate_key[ \t]+/ {print $2}' "$SITE_FILE" | head -1 | tr -d ';\"')"
fi
case "$CERT" in *'$'*) CERT=""; KEY="";; esac
[ -n "$CERT" ] && [ ! -f "$CERT" ] && CERT=""
[ -n "$KEY" ] && [ ! -f "$KEY" ] && KEY=""
if [ -n "$CERT" ] && [ -n "$KEY" ]; then
  echo "🔒 گواهی SSL پیدا شد:  $CERT"
else
  echo "ℹ️ مسیر گواهی SSL خودکار پیدا نشد — ریدایرکت روی HTTP فعال می‌شود."
  echo "   (اگر سایتت HTTPS است و این پیام را دیدی، خروجی را برای من بفرست)"
fi

IPV6=0
[ -n "$SITE_FILE" ] && grep -qE 'listen[^;]*\[::\]' "$SITE_FILE" 2>/dev/null && IPV6=1

# ── ۴) انتخاب محل فایل جدید (conf.d یا sites-enabled) ──
NEW_FILE="/etc/nginx/conf.d/00-fitup.conf"
NEW_LINK=""
if ! grep -qE "include[^;]*conf\.d/\*" /etc/nginx/nginx.conf 2>/dev/null; then
  if [ -d /etc/nginx/sites-enabled ] && grep -qE "include[^;]*sites-enabled" /etc/nginx/nginx.conf 2>/dev/null; then
    NEW_FILE="/etc/nginx/sites-available/00-fitup.conf"
    NEW_LINK="/etc/nginx/sites-enabled/00-fitup.conf"
  else
    echo "⚠️ مسیر include استاندارد در nginx.conf پیدا نشد — فرض بر فعال بودن conf.d (تست نهایی تأییدش می‌کند)."
  fi
fi

# ── گارد duplicate (نسخهٔ ۳: اسکن کامل‌تر + دنبال‌کردن لینک‌ها + بدون حساسیت به بزرگی حرف) ──
# nginx اجازه نمی‌دهد یک دیرکتیو ساده در یک سطح دو بار تعریف شود ([emerg] duplicate).
# پس دیرکتیوهای فشرده‌سازیِ از قبل موجود را پیدا می‌کنیم و فقط غایب‌ها را اضافه می‌کنیم.
SCAN_DIRS="/etc/nginx/nginx.conf /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/snippets /etc/nginx/modules-enabled"
has_dir() {
  grep -RqisE "^[ \t]*$1([ \t;]|$)" $SCAN_DIRS --exclude="00-fitup*" 2>/dev/null
}

# لیست مشترک فایل‌های فشرده‌پذیر برای gzip_types / brotli_types
CMP_TYPES="text/plain text/css application/javascript application/x-javascript text/javascript application/json application/xml application/rss+xml application/atom+xml image/svg+xml application/vnd.ms-fontobject application/x-font-ttf font/opentype font/ttf font/otf font/woff font/woff2 application/manifest+json application/wasm"

# ── ۵) Brotli — فقط با «تست واقعی nginx»، بدون هیچ حدس و گمان ──
#  روش: یک فایل آزمایشی موقت فقط با «brotli on;» می‌سازیم و nginx -t می‌گیریم.
#  اگر پاس شد یعنی Brotli واقعاً کار می‌کند؛ اگر نه، ماژول استاندارد را
#  نصب می‌کنیم و دوباره تست می‌کنیم؛ اگر باز هم نشد → Gzip (کاملاً کافی).
BROTLI_MODE="off"      # on | off | skip
BROTLI_PKGS=""

probe_brotli() {
  {
    echo "# fitup brotli probe — موقت"
    echo "brotli on;"
  } > "$NEW_FILE"
  [ -n "$NEW_LINK" ] && ln -sf "$NEW_FILE" "$NEW_LINK"
  "$NGINX_BIN" -t >/dev/null 2>&1
}
rm_probe() { rm -f "$NEW_FILE" "$NEW_LINK"; }

if has_dir "brotli"; then
  BROTLI_MODE="skip"
  echo "✅ Brotli از قبل در کانفیگت فعال است — دست نمی‌زنیم."
else
  echo "🔎 بررسی واقعی Brotli با تست nginx (بدون حدس و گمان) ..."
  if probe_brotli; then
    BROTLI_MODE="on"
    echo "✅ Brotli روی این سرور آمادهٔ کار است (تست nginx پاس شد)."
  elif command -v apt-get >/dev/null 2>&1; then
    rm_probe
    echo "📦 دیرکتیو brotli فعلاً در دسترس نیست — بررسی نصب ماژول استاندارد ..."
    SIM_OUT="$(apt-get -s install -y --no-install-recommends libnginx-mod-http-brotli-filter 2>&1)"
    if echo "$SIM_OUT" | grep -qE "^(E:|W:)"; then
      echo "⭕ بستهٔ Brotli در مخازن این سرور پیدا نشد — رد شد (gzip فعلی کاملاً کافی است)."
    elif echo "$SIM_OUT" | grep -qE "^Inst (nginx|nginx-common|nginx-core)[  ]"; then
      echo "⭕ نصب Brotli به ارتقای خود nginx نیاز داشت — برای صرف‌نظر از هر ریسکی رد شد (gzip فعلی کاملاً کافی است)."
    else
      # فقط بسته‌هایی که «الان» نصب نیستند را نصب می‌کنیم تا اگر لازم شد همان‌ها را برگردانیم
      dpkg -s libnginx-mod-http-brotli-filter >/dev/null 2>&1 || BROTLI_PKGS="libnginx-mod-http-brotli-filter"
      if [ -n "$BROTLI_PKGS" ]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $BROTLI_PKGS >/dev/null 2>&1 || true
      fi
      if probe_brotli; then
        BROTLI_MODE="on"
        echo "✅ ماژول Brotli نصب شد و تست nginx پاس شد."
      else
        [ -n "$BROTLI_PKGS" ] && DEBIAN_FRONTEND=noninteractive apt-get remove -y $BROTLI_PKGS >/dev/null 2>&1 || true
        BROTLI_PKGS=""
        BROTLI_MODE="off"
        echo "⭕ Brotli حتی بعد از نصب ماژول فعال نشد — رد شد (gzip فعلی کاملاً کافی است)."
      fi
    fi
  else
    echo "⭕ Brotli در دسترس نیست — رد شد (gzip فعلی کاملاً کافی است)."
  fi
  rm_probe
fi

# ── ۶) سازندهٔ فایل کانفیگ (فقط «اضافه» — هیچ فایل موجودی دست نمی‌خورد) ──
#  پارامتر سطح: ۲ = ریدایرکت + فشرده‌سازی کامل (Gzip + Brotli اگر فعال باشد)
#               ۱ = ریدایرکت + فقط Gzip
#               ۰ = فقط ریدایرکت www
ADDED_CMP=""; SKIPPED_CMP=""; BROTLI_ADDED=0
gen_conf() {
  LVL="${1:-2}"
  ADDED_CMP=""; SKIPPED_CMP=""; BROTLI_ADDED=0
  {
    echo "# ─── فیتاپ v219 — تنظیمات خودکار (ساخته‌شده در $TS) ───"
    echo "# این فایل فقط اضافه است؛ هیچ کانفیگ دیگری را تغییر نمی‌دهد."
    echo "# برای حذف کامل تنظیمات فیتاپ کافیست همین فایل پاک شود + reload nginx."
    echo ""
    echo "# ریدایرکت دائمی www → دامنهٔ اصلی (HTTP)"
    echo "server {"
    echo "    listen 80;"
    [ "$IPV6" = "1" ] && echo "    listen [::]:80;"
    echo "    server_name www.$DOMAIN;"
    echo "    return 301 https://$DOMAIN\$request_uri;"
    echo "}"
    if [ -n "$CERT" ] && [ -n "$KEY" ]; then
      echo ""
      echo "# ریدایرکت دائمی www → دامنهٔ اصلی (HTTPS)"
      echo "server {"
      echo "    listen 443 ssl;"
      [ "$IPV6" = "1" ] && echo "    listen [::]:443 ssl;"
      echo "    server_name www.$DOMAIN;"
      echo "    ssl_certificate     $CERT;"
      echo "    ssl_certificate_key $KEY;"
      echo "    return 301 https://$DOMAIN\$request_uri;"
      echo "}"
    fi
    if [ "$LVL" -ge 1 ]; then
      echo ""
      echo "# فشرده‌سازی — فقط دیرکتیوهایی که از قبل در کانفیگ نیستند (جلوگیری از duplicate)"
      if has_dir "gzip_proxied"; then
        SKIPPED_CMP="$SKIPPED_CMP gzip_proxied"
      else
        echo "gzip_proxied any;"
        ADDED_CMP="$ADDED_CMP gzip_proxied"
      fi
      if has_dir "gzip_vary"; then
        SKIPPED_CMP="$SKIPPED_CMP gzip_vary"
      else
        echo "gzip_vary on;"
        ADDED_CMP="$ADDED_CMP gzip_vary"
      fi
      if has_dir "gzip_comp_level"; then
        SKIPPED_CMP="$SKIPPED_CMP gzip_comp_level"
      else
        echo "gzip_comp_level 5;"
        ADDED_CMP="$ADDED_CMP gzip_comp_level"
      fi
      if has_dir "gzip_min_length"; then
        SKIPPED_CMP="$SKIPPED_CMP gzip_min_length"
      else
        echo "gzip_min_length 256;"
        ADDED_CMP="$ADDED_CMP gzip_min_length"
      fi
      if has_dir "gzip_types"; then
        SKIPPED_CMP="$SKIPPED_CMP gzip_types"
      else
        echo "gzip_types $CMP_TYPES;"
        ADDED_CMP="$ADDED_CMP gzip_types"
      fi
      if [ "$LVL" -ge 2 ] && [ "$BROTLI_MODE" = "on" ]; then
        if has_dir "brotli"; then
          SKIPPED_CMP="$SKIPPED_CMP brotli"
        else
          echo "brotli on;"
          BROTLI_ADDED=1
          ADDED_CMP="$ADDED_CMP brotli"
        fi
        if has_dir "brotli_comp_level"; then
          SKIPPED_CMP="$SKIPPED_CMP brotli_comp_level"
        else
          echo "brotli_comp_level 5;"
          ADDED_CMP="$ADDED_CMP brotli_comp_level"
        fi
        if has_dir "brotli_types"; then
          SKIPPED_CMP="$SKIPPED_CMP brotli_types"
        else
          echo "brotli_types $CMP_TYPES;"
          ADDED_CMP="$ADDED_CMP brotli_types"
        fi
      fi
    fi
  } > "$NEW_FILE"
  chmod 644 "$NEW_FILE" 2>/dev/null || true
  [ -n "$NEW_LINK" ] && ln -sf "$NEW_FILE" "$NEW_LINK"
  return 0
}

# ── ۷) نردبان تست: سطح ۲ (با Brotli) ← سطح ۱ (فقط Gzip) ← سطح ۰ (فقط ریدایرکت) ──
CMP_NOTE=""
hr
echo "🧪 تست کانفیگ با nginx -t (نردبان امنیتی: Brotli ← Gzip ← فقط ریدایرکت) ..."
gen_conf 2
if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
  echo "⚠️ تست سطح ۲ (با Brotli) پاس نشد — خروجی تست:"
  "$NGINX_BIN" -t 2>&1 | sed 's/^/     /'
  echo ""
  # بستهٔ brotli اگر همین‌جا نصبش کرده بودیم، برمی‌گردانیم
  if [ -n "$BROTLI_PKGS" ]; then
    DEBIAN_FRONTEND=noninteractive apt-get remove -y $BROTLI_PKGS >/dev/null 2>&1 || true
    BROTLI_PKGS=""
  fi
  BROTLI_MODE="off"
  echo "↩️ تلاش سطح ۱: فقط Gzip (بدون Brotli) ..."
  gen_conf 1
  if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
    echo "⚠️ تست سطح ۱ هم پاس نشد — خروجی تست:"
    "$NGINX_BIN" -t 2>&1 | sed 's/^/     /'
    echo ""
    echo "↩️ تلاش سطح ۰: فقط ریدایرکت www (بدون هیچ فشرده‌سازی) ..."
    gen_conf 0
    if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
      echo "❌ حتی سطح ۰ هم پاس نشد! برگرداندن خودکار به حالت قبل ..."
      rm -f "$NEW_FILE" "$NEW_LINK"
      "$NGINX_BIN" -t >/dev/null 2>&1 && { systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || "$NGINX_BIN" -s reload 2>/dev/null; } || true
      echo "✅ همه‌چیز به حالت قبل برگشت — هیچ چیزی خراب نشده (بکاپ: $BAK)."
      echo "   👉 لطفاً «آخرین خروجی nginx -t» بالا را برای من کپی کن تا علتش را پیدا کنم."
      exit 1
    fi
    CMP_NOTE="فشرده‌سازی اعمال نشد (کانفیگ سرور با آن سازگار نبود) — فقط ریدایرکت www فعال شد که کار اصلی بود."
  else
    CMP_NOTE="Brotli اعمال نشد — Gzip فعال شد (کاملاً کافی است)."
  fi
fi

echo "📝 فایل کانفیگ نهایی:  $NEW_FILE${NEW_LINK:+  (لینک در $NEW_LINK)}"
[ -n "$ADDED_CMP" ] && echo "⚙️ فشرده‌سازی — اضافه شد:$ADDED_CMP"
[ -n "$SKIPPED_CMP" ] && echo "⚙️ فشرده‌سازی — از قبل در کانفیگت بود، دست نخورد:$SKIPPED_CMP"
[ -n "$CMP_NOTE" ] && echo "ℹ️ $CMP_NOTE"

# ── ۸) اعمال (reload یا start) ──
if systemctl is-active --quiet nginx 2>/dev/null || service nginx status >/dev/null 2>&1; then
  systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || "$NGINX_BIN" -s reload 2>/dev/null || { echo "↻ تلاش با restart کامل ..."; systemctl restart nginx 2>/dev/null || service nginx restart 2>/dev/null || "$NGINX_BIN"; }
  echo "✅ nginx ری‌لود شد (کانفیگ جدید فعال است)."
else
  systemctl start nginx 2>/dev/null || service nginx start 2>/dev/null || "$NGINX_BIN"
  echo "✅ nginx که خاموش بود، بالا آمد."
fi
sleep 1

# ── ۹) راستی‌آزمایی (اگر نتیجه درست نبود → رول‌بک خودکار) ──
echo ""
echo "🔎 راستی‌آزمایی ریدایرکت و سلامت سایت ..."
W1="$(curl -s --max-time 8 -o /dev/null -w '%{http_code}' -H 'Host: www.fittup.ir' http://127.0.0.1/ 2>/dev/null || echo 000)"
W2="$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' -H 'Host: www.fittup.ir' https://127.0.0.1/ 2>/dev/null || echo 000)"
M1="$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' -H 'Host: fittup.ir' https://127.0.0.1/ 2>/dev/null || echo 000)"
echo "    http://www.fittup.ir    →  $W1   (انتظار: 301)"
echo "    https://www.fittup.ir   →  $W2   (انتظار: 301)"
echo "    https://fittup.ir       →  $M1   (انتظار: 200)"

RB_NEEDED=0
[ "$W1" != "301" ] && RB_NEEDED=1
[ -n "$CERT" ] && [ "$W2" != "301" ] && RB_NEEDED=1
[ "$M1" != "200" ] && RB_NEEDED=1

if [ "$RB_NEEDED" = "1" ]; then
  echo ""
  echo "❌ نتیجهٔ مورد انتظار نگرفت! برگرداندن خودکار به حالت قبل ..."
  rm -f "$NEW_FILE" "$NEW_LINK"
  [ -n "$BROTLI_PKGS" ] && DEBIAN_FRONTEND=noninteractive apt-get remove -y $BROTLI_PKGS >/dev/null 2>&1 || true
  "$NGINX_BIN" -t >/dev/null 2>&1 && { systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || "$NGINX_BIN" -s reload 2>/dev/null; } || true
  M2="$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' -H 'Host: fittup.ir' https://127.0.0.1/ 2>/dev/null || echo 000)"
  echo "✅ تنظیمات به حالت قبل برگشت (دامنهٔ اصلی الان: $M2). هیچ چیزی خراب نشده."
  echo "   👉 فقط همین خروجی را برای من کپی کن تا علتش را بفهمم."
  exit 1
fi
echo "✅ ریدایرکت www فعال شد و سایت اصلی سالم است."

# ── ۹.۵) نمایش فشرده‌سازی واقعی صفحهٔ اصلی (اطلاع‌رسانی — مانع کار نیست) ──
CE="$(curl -skI --max-time 8 -H 'Host: fittup.ir' -H 'Accept-Encoding: br, gzip' https://127.0.0.1/ 2>/dev/null | grep -i '^content-encoding:' | tr -d '\r' | awk '{print tolower($2)}' | head -1)"
if [ "$CE" = "br" ]; then
  echo "🗜 فشرده‌سازی صفحهٔ اصلی:  br  (Brotli واقعاً در حال کار است ✅)"
elif [ "$CE" = "gzip" ]; then
  echo "🗜 فشرده‌سازی صفحهٔ اصلی:  gzip  (فعال ✅)"
else
  echo "🗜 فشرده‌سازی صفحهٔ اصلی:  تشخیص داده نشد (اطلاع‌رسانی است — مانع کار نیست)."
fi

# ── ۱۰) حذف robots.txt قدیمی (مهم‌ترین فیکس سئو) + ری‌استارت برنامه ──
hr
APP_DIR="/var/www/fitup"
APP_PID="$(pgrep -f 'next-server' 2>/dev/null | head -1 || true)"
if [ -n "${APP_PID:-}" ] && [ -d "/proc/$APP_PID/cwd" ]; then
  D="$(readlink "/proc/$APP_PID/cwd" 2>/dev/null || true)"
  [ -n "${D:-}" ] && APP_DIR="$D"
fi
echo "📁 پوشهٔ برنامه:  $APP_DIR"
NEED_RESTART=0
if [ -f "$APP_DIR/public/robots.txt" ]; then
  rm -f "$APP_DIR/public/robots.txt"
  echo "🗑 فایل قدیمی public/robots.txt حذف شد (روی robots.txt جدید سایه انداخته بود)."
  NEED_RESTART=1
else
  echo "✅ robots.txt قدیمی وجود ندارد (قبلاً حل شده)."
fi

RESTARTED=0
if [ "$NEED_RESTART" = "1" ]; then
  PM2_BIN="$(command -v pm2 2>/dev/null || true)"
  PM2_USER="$(ps -eo user:32,cmd 2>/dev/null | awk '/[P]M2 v.*God/ {print $1}' | grep -v '^root$' | head -1 || true)"
  [ -z "${PM2_USER:-}" ] && PM2_USER="$(ps -eo user:32,cmd 2>/dev/null | awk '/[P]M2 v.*God/ {print $1}' | head -1 || true)"
  if [ -n "${PM2_USER:-}" ] && [ "$PM2_USER" != "root" ] && id "$PM2_USER" >/dev/null 2>&1; then
    if [ -n "${PM2_BIN:-}" ] && runuser -u "$PM2_USER" -- env PATH="/usr/local/bin:/usr/bin:/bin" "$PM2_BIN" restart fitup >/dev/null 2>&1; then
      RESTARTED=1
    elif runuser -u "$PM2_USER" -- bash -lc 'pm2 restart fitup' >/dev/null 2>&1; then
      RESTARTED=1
    fi
  elif [ -n "${PM2_BIN:-}" ]; then
    "$PM2_BIN" restart fitup >/dev/null 2>&1 && RESTARTED=1
  fi
  if [ "$RESTARTED" = "1" ]; then
    echo "🔄 برنامه ری‌استارت شد (pm2 restart fitup)."
  else
    echo "⚠️ ری‌استارت خودکار pm2 ممکن نشد — فقط این یک دستور را با یوزر همیشگی‌ات بزن:"
    echo "     pm2 restart fitup"
  fi
  sleep 2
fi

# ── ۱۱) چک‌لیست نهایی ──
hr
echo "🧾 چک‌لیست نهایی:"
echo ""
RB="$(curl -sk --max-time 8 -H 'Host: fittup.ir' https://127.0.0.1/robots.txt 2>/dev/null || curl -s --max-time 8 http://127.0.0.1:3000/robots.txt 2>/dev/null || echo '')"
if echo "$RB" | grep -qi "sitemap:" && echo "$RB" | grep -qi "disallow: /api"; then
  echo "✅ robots.txt نسخهٔ جدید فعال است (حاوی Sitemap و Disallow /api/):"
  echo "$RB" | grep -iE "sitemap|disallow: /api" | head -3
else
  echo "⚠️ robots.txt هنوز نسخهٔ جدید را نمی‌دهد — اگر pm2 را دستی ری‌استارت نکردی، بزن:  pm2 restart fitup"
fi
echo ""

CNT="$(curl -sk --max-time 20 -H 'Host: fittup.ir' https://127.0.0.1/sitemap.xml 2>/dev/null | grep -c '<loc>' || true)"
echo "📊 تعداد URLهای سایت‌مپ:  ${CNT:-0}   (باید همان ~۲۲۴۵ قبلی باشد — تغییر نکرده باشد)"
echo ""

FD="$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' -H 'Host: fittup.ir' https://127.0.0.1/feed.xml 2>/dev/null || echo 000)"
echo "📡 فید RSS (feed.xml):  $FD   (انتظار: 200)"
echo ""

OG="$(curl -sk --max-time 8 -o /dev/null -w '%{http_code} %{size_download}' -H 'Host: fittup.ir' https://127.0.0.1/og/og-default.png 2>/dev/null || echo '000 0')"
echo "🖼 تصویر OG جدید:  $OG   (انتظار: 200 و حدود ۳۳۸٬۳۵۲ بایت)"
echo ""

NF="$(curl -sk --max-time 8 -H 'Host: fittup.ir' https://127.0.0.1/nashon-midahad-xyz-404 2>/dev/null | grep -c 'صفحه پیدا نشد' || true)"
echo "🚧 صفحهٔ 404 فارسی جدید:  ${NF:-0} مورد یافت شد   (انتظار: ۱ یا بیشتر)"
echo ""

hr
echo "🏁 تمام شد! خلاصه:"
echo "   • بکاپ کانفیگ:  $BAK"
echo "   • ریدایرکت www → fittup.ir:  فعال ✅"
echo "   • فایل تنظیمات فیتاپ:  $NEW_FILE  (برای برگرداندن، فقط همین فایل را پاک کن + reload nginx)"
if [ "$BROTLI_MODE" = "on" ]; then
  if [ -n "$BROTLI_PKGS" ]; then
    echo "   • Brotli:  فعال ✅ (ماژول استاندارد نصب شد + تست nginx پاس شد)"
  else
    echo "   • Brotli:  فعال ✅ (تست nginx پاس شد)"
  fi
elif [ "$BROTLI_MODE" = "skip" ]; then
  echo "   • Brotli:  از قبل فعال بود — دست نخورد ✅"
else
  echo "   • Brotli:  در دسترس نبود — Gzip فعال است (کاملاً کافی است، خیالت راحت) ℹ️"
fi
if [ -n "$CMP_NOTE" ]; then
  echo "   • نکتهٔ فشرده‌سازی:  $CMP_NOTE"
fi
if [ "$NEED_RESTART" = "1" ] && [ "$RESTARTED" != "1" ]; then
  echo "   • یادت نره:  pm2 restart fitup  را با یوزر خودت بزن ⚠️"
fi
echo ""
echo "📌 آخرین قدم: در Google Search Console دوباره Sitemap را Submit کن."
hr
exit 0
FITUP_SETUP_219
