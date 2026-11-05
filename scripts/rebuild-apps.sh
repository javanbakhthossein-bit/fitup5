#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  🩹 v167 — ریبیلد یک-فرمانی هر دو اپ اندروید (بازنویسی منطق نسخه)
# ═══════════════════════════════════════════════════════════════════
#  ⚠️ اصلاح رفتار غلط قبلی (v166): «هر اجرا = ارتقای نسخه» نبودِ درست است!
#  منطق جدید (تأیید مالک):
#    • پیش‌فرض: بیلد با «همان نسخهٔ فعلی» gradle — هیچ bump ای نمی‌زند.
#      (بیلد تکراری/تست/بازسازی همان نسخه نباید نسخهٔ جدید بسازد)
#    • --patch  → فقط این‌بار پچ بالا می‌رود (1.8.0 → 1.8.1)
#    • --minor  → فقط این‌بار مینور بالا می‌رود (1.8.0 → 1.9.0)
#    • --skip-build → هیچ بیلدی نمی‌زند؛ فقط APPS-INFO.md را از فایل‌های
#      واقعی APK همگام می‌کند (برای اصلاح سند بدون دست‌زدن به بیلد)
#
#  کاری که می‌کند:
#    ۱) versionName/versionCode هر دو gradle را می‌خواند (و اگر فلگ bump
#       داده شده باشد یکی بالا می‌برد و در gradle می‌نویسد)
#    ۲) هر دو APK را با تولچین سندباکس بیلد و امضا می‌کند (keystore رسمی)
#    ۳) APKها را در download/ + public/downloads با نام نسخه‌دار می‌گذارد
#    ۴) fitup-own-version.txt (هر دو محل) + رکورد DB + چنج‌لاگ اپ اختصاصی
#    ۵) KNOWN_VERSION_CODES در build-deploy-zip.mjs را تکمیل می‌کند
#    ۶) بخش AUTO در download/APPS-INFO.md را از فایل‌های واقعی (حجم/MD5)
#       بازخوانی و به‌روز می‌کند
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUMP="none"   # v167: پیش‌فرض بدون ارتقا
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --patch) BUMP="patch" ;;
    --minor) BUMP="minor" ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "arg ناشناخته: $arg (مجاز: --patch --minor --skip-build)"; exit 1 ;;
  esac
done

bump_version() {
  local ver="$1"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$ver"
  if [ "$BUMP" = "minor" ]; then
    minor=$((minor + 1)); patch=0
  else
    patch=$((patch + 1))
  fi
  echo "${major}.${minor}.${patch}"
}

bump_code() { echo $(($1 + 1)); }

update_gradle() {
  # $1 = فایل gradle، $2/۳ = نسخه/کد جدید — جایگزینی خط versionCode/versionName
  local file="$1" newVer="$2" newCode="$3"
  python3 - "$file" "$newVer" "$newCode" <<'PYEOF'
import re, sys
path, ver, code = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
src, n1 = re.subn(r'versionCode\s*=\s*\d+', f'versionCode = {code}', src)
src, n2 = re.subn(r'versionName\s*=\s*"[^"]+"', f'versionName = "{ver}"', src)
assert n1 >= 1 and n2 >= 1, f"version fields not found in {path}"
open(path, "w", encoding="utf-8").write(src)
print(f"  {path}: versionName={ver} versionCode={code}")
PYEOF
}

update_known_codes() {
  local ver="$1" code="$2"
  python3 - "$ROOT/scripts/build-deploy-zip.mjs" "$ver" "$code" <<'PYEOF'
import re, sys
path, ver, code = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
if re.search(rf'"{re.escape(ver)}"\s*:\s*\d+', src):
    src = re.sub(rf'"{re.escape(ver)}"\s*:\s*\d+', f'"{ver}": {code}', src)
else:
    # ضمیمهٔ جفت جدید بعد از آخرین جفت شناخته‌شده (1.8.0: 22)
    if '"1.8.0": 22' in src and '"1.8.0": 22,' not in src:
        src = src.replace('"1.8.0": 22', f'"1.8.0": 22, "{ver}": {code}', 1)
    elif '"1.8.0": 22,' in src:
        src = re.sub(r'("1\.8\.0"\s*:\s*22,)', rf'\1 "{ver}": {code},', src, count=1)
    else:
        src = src.replace('} as const', f'  "{ver}": {code},\n}} as const') if '} as const' in src else src
open(path, "w", encoding="utf-8").write(src)
print(f"  KNOWN_VERSION_CODES += {ver}:{code}")
PYEOF
}

# v167 — همگام‌سازی بخش AUTO در APPS-INFO.md از فایل‌های واقعی APK
sync_apps_info() {
  local ownVer="$1" ownCode="$2" bazVer="$3" bazCode="$4"
  python3 - "$ROOT" "$ownVer" "$ownCode" "$bazVer" "$bazCode" <<'PYEOF'
import hashlib, re, subprocess, sys, datetime
root, own_ver, own_code, baz_ver, baz_code = sys.argv[1:6]
path = f"{root}/download/APPS-INFO.md"
try:
    src = open(path, encoding="utf-8").read()
except FileNotFoundError:
    print("  APPS-INFO.md یافت نشد — رد شد"); sys.exit(0)

def meta(p):
    try:
        h = subprocess.run(["md5sum", f"{root}/{p}"], capture_output=True, text=True).stdout.split()[0]
        size = subprocess.run(["stat", "-c", "%s", f"{root}/{p}"], capture_output=True, text=True).stdout.strip()
        return size, h
    except Exception:
        return "?", "?"

own_file = f"download/fitup-own-v{own_ver}.apk"
baz_file = f"download/fitup-bazaar-v{baz_ver}.apk"
own_size, own_md5 = meta(own_file)
baz_size, baz_md5 = meta(baz_file)
today = datetime.date.today().isoformat()

try:
    web_ver = [l.split('"version": "')[1].split('"')[0]
               for l in open(f"{root}/package.json", encoding="utf-8") if '"version"' in l][0]
except Exception:
    web_ver = "?"

block = f"""<!-- AUTO:CURRENT-VERSIONS:START -->
## وضعیت فعلی (خودکار از فایل‌های واقعی — آخرین همگام‌سازی: {today})

| اپ | versionName | versionCode | فایل APK | حجم | MD5 |
|---|---|---|---|---|---|
| **اپ اختصاصی (own)** | **{own_ver}** | **{own_code}** | `download/fitup-own-v{own_ver}.apk` (+ کپی `public/downloads/`) | {own_size} بایت | `{own_md5}` |
| **اپ بازار (bazaar)** | **{baz_ver}** | **{baz_code}** | `download/fitup-bazaar-v{baz_ver}.apk` (+ کپی `public/downloads/`) | {baz_size} بایت | `{baz_md5}` |

- نسخهٔ فعلی وب (package.json): **{web_ver}**
- `download/fitup-own-version.txt`: `{own_ver} {own_code}`
- API انتشار: `/api/app/own/latest` رکورد DB فعال = {own_ver}/{own_code}
<!-- AUTO:CURRENT-VERSIONS:END -->"""

if re.search(r"<!-- AUTO:CURRENT-VERSIONS:START -->.*?<!-- AUTO:CURRENT-VERSIONS:END -->", src, re.S):
    src = re.sub(r"<!-- AUTO:CURRENT-VERSIONS:START -->.*?<!-- AUTO:CURRENT-VERSIONS:END -->",
                 block.replace("\\", "\\\\"), src, flags=re.S)
else:
    src += "\n\n" + block
open(path, "w", encoding="utf-8").write(src)
print("  APPS-INFO.md بخش AUTO همگام شد")
PYEOF
}

echo "━━ ۱) خواندن نسخه‌ها (bump=$BUMP) ━━"
OWN_GRADLE="$ROOT/fitup-app/app/build.gradle.kts"
BAZ_GRADLE="$ROOT/fitup-bazaar/app/build.gradle.kts"
OWN_VER=$(grep -o 'versionName = "[^"]*"' "$OWN_GRADLE" | tail -1 | sed 's/versionName = "//;s/"//')
OWN_CODE=$(grep -o 'versionCode = [0-9]*' "$OWN_GRADLE" | tail -1 | awk '{print $3}')
BAZ_VER=$(grep -o 'versionName = "[^"]*"' "$BAZ_GRADLE" | tail -1 | sed 's/versionName = "//;s/"//')
BAZ_CODE=$(grep -o 'versionCode = [0-9]*' "$BAZ_GRADLE" | tail -1 | awk '{print $3}')

if [ "$BUMP" = "none" ]; then
  echo "  بدون ارتقا — بیلد با نسخهٔ فعلی: own $OWN_VER($OWN_CODE) / bazaar $BAZ_VER($BAZ_CODE)"
else
  OWN_NEW=$(bump_version "$OWN_VER"); OWN_NEWCODE=$(bump_code "$OWN_CODE")
  BAZ_NEW=$(bump_version "$BAZ_VER"); BAZ_NEWCODE=$(bump_code "$BAZ_CODE")
  echo "  own:    $OWN_VER($OWN_CODE) → $OWN_NEW($OWN_NEWCODE)"
  echo "  bazaar: $BAZ_VER($BAZ_CODE) → $BAZ_NEW($BAZ_NEWCODE)"
  OWN_VER="$OWN_NEW"; OWN_CODE="$OWN_NEWCODE"; BAZ_VER="$BAZ_NEW"; BAZ_CODE="$BAZ_NEWCODE"
fi

if [ "$BUMP" != "none" ]; then
  echo "━━ ۲) اعمال نسخه‌های جدید ━━"
  update_gradle "$OWN_GRADLE" "$OWN_VER" "$OWN_CODE"
  update_gradle "$BAZ_GRADLE" "$BAZ_VER" "$BAZ_CODE"
  update_known_codes "$OWN_VER" "$OWN_CODE"
fi

if [ "$SKIP_BUILD" = "1" ]; then
  echo "━━ بیلد رد شد (--skip-build) — فقط همگام‌سازی سند ━━"
  sync_apps_info "$OWN_VER" "$OWN_CODE" "$BAZ_VER" "$BAZ_CODE"
  echo "✅ تمام."
  exit 0
fi

echo "━━ ۳) بیلد اپ اختصاصی (assembleRelease) ━━"
export JAVA_HOME=/tmp/toolchain/jdk17
export ANDROID_HOME=/tmp/toolchain/android-sdk
export PATH="$JAVA_HOME/bin:$PATH"
( cd "$ROOT/fitup-app" && timeout 1400 ./gradlew assembleRelease -q > /tmp/rebuild-own.log 2>&1 || true )
ls "$ROOT/fitup-app/app/build/outputs/apk/release/app-release.apk" > /dev/null

echo "━━ ۴) بیلد اپ بازار (assembleRelease) ━━"
( cd "$ROOT/fitup-bazaar" && timeout 1400 ./gradlew assembleRelease -q > /tmp/rebuild-baz.log 2>&1 || true )
ls "$ROOT/fitup-bazaar/app/build/outputs/apk/release/app-release.apk" > /dev/null

echo "━━ ۵) کپی نسخه‌دار + همگام‌سازی ━━"
cp "$ROOT/fitup-app/app/build/outputs/apk/release/app-release.apk" "$ROOT/download/fitup-own-v${OWN_VER}.apk"
cp "$ROOT/fitup-bazaar/app/build/outputs/apk/release/app-release.apk" "$ROOT/download/fitup-bazaar-v${BAZ_VER}.apk"
cp "$ROOT/download/fitup-own-v${OWN_VER}.apk" "$ROOT/public/downloads/"
cp "$ROOT/download/fitup-bazaar-v${BAZ_VER}.apk" "$ROOT/public/downloads/"

echo "━━ ۶) رکورد DB + version.txt (اپ اختصاصی) ━━"
cd "$ROOT"
DATABASE_URL="file:$ROOT/db/custom.db" bun scripts/publish-own-app.ts "$OWN_VER" "$OWN_CODE" | tail -3

echo "━━ ۷) همگام‌سازی APPS-INFO.md ━━"
sync_apps_info "$OWN_VER" "$OWN_CODE" "$BAZ_VER" "$BAZ_CODE"

echo "✅ ریبیلد کامل شد: own v${OWN_VER}(${OWN_CODE}) + bazaar v${BAZ_VER}(${BAZ_CODE})"
echo "   ⚠️ یادآوری ۱: چنج‌لاگ ${OWN_VER} را در scripts/publish-own-app.ts بنویسید و publish را دوباره اجرا کنید اگر متن جدید لازم است."
echo "   ⚠️ یادآوری ۲: بعد از هر تغییر ریپو → bash /home/sync/snapshot.sh"
