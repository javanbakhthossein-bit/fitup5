/**
 * نسخهٔ اپ اندروید فیتاپ — تشخیص نسخهٔ نصب‌شده و مقایسهٔ نسخه‌ها (Task v202-B8)
 *
 * هر دو اپ نیتیو پل مشترک window.FitUpNative دارند (addJavascriptInterface در
 * MainActivity.kt هر اپ):
 *  - اپ کافه‌بازار (ir.fittup.app):  appVersion() → VERSION_NAME  + پسوند UA «FitUpBazaar/<v>»
 *  - اپ اختصاصی   (ir.fittup.panel): getAppVersionName() / getAppVersionCode() / appVersion()
 *                                    + پسوند UA «FitUpApp/<v>»
 *
 * منبع «آخرین نسخهٔ موجود» (تصمیم Task v202-B8):
 *  - اپ اختصاصی → داینامیک: ‎/api/app/own/latest (رکورد OwnAppRelease ادمین یا APK
 *    همراه بستهٔ دیپلوی — public/downloads/fitup-own-version.txt) — ادمین APK جدید
 *    را از پنل مدیریت آپلود می‌کند و همین endpoint سرو می‌شود.
 *  - اپ بازار → ثابت BAZAAR_LATEST_VERSION_NAME: منبع داینامیک بازار (‎/api/app/version)
 *    طبق قانون کافه‌بازار عمداً خنثی شده (v51) و نباید احیا شود؛ این ثابت باید
 *    هم‌تراز با آخرین APK بازار (public/downloads/fitup-bazaar-v*.apk) نگه داشته شود.
 */

import { getOwnAppVersionName } from "@/lib/fitness/app-bridge";

const NUMERIC_VERSION = /^\d+(?:\.\d+)*$/;

/**
 * مقایسهٔ نسخه به سبک semver: اجزا با «.» جدا و عددی مقایسه می‌شوند و جزء
 * ناموجود صفر فرض می‌شود («1.2» == «1.2.0»، «1.2.10» > «1.2.9»).
 * خروجی: 1 (a جدیدتر) / 0 (برابر) / -1 (b جدیدتر)
 */
export function compareVersionNames(a: string, b: string): number {
  const pa = String(a || "")
    .trim()
    .split(".")
    .map((p) => parseInt(p, 10) || 0);
  const pb = String(b || "")
    .trim()
    .split(".")
    .map((p) => parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/** آخرین نسخهٔ اپ کافه‌بازار — ثابت (منبع داینامیک طبق قانون بازار مجاز نیست) */
// v202 — هم‌تراز با بیلد جدید بازار (چرخش امنیتی کلید bridge H1) — build.gradle.kts:29
export const BAZAAR_LATEST_VERSION_NAME = "1.15.2";

function sanitizedVersion(raw: unknown): string {
  const v = String(raw || "").trim();
  return NUMERIC_VERSION.test(v) ? v : "";
}

/**
 * نسخهٔ نصب‌شدهٔ اپ کافه‌بازار — پل appVersion() و فال‌بک UA «FitUpBazaar/x.y.z».
 * خروجی "" = خارج از اپ / غیرقابل تشخیص.
 */
export function getInstalledBazaarVersionName(): string {
  if (typeof window === "undefined") return "";
  try {
    const viaBridge = sanitizedVersion((window as any).FitUpNative?.appVersion?.());
    if (viaBridge) return viaBridge;
  } catch {}
  try {
    const m = /FitUpBazaar\/(\d+(?:\.\d+)*)/.exec(window.navigator.userAgent || "");
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

/**
 * نسخهٔ نصب‌شدهٔ اپ اختصاصی — پل getAppVersionName() (و appVersion()) و فال‌بک
 * UA «FitUpApp/x.y.z» (اپ‌های خیلی قدیمی بدون متد پل را هم پوشش می‌دهد).
 * خروجی "" = خارج از اپ / غیرقابل تشخیص.
 */
export function getInstalledOwnVersionName(): string {
  if (typeof window === "undefined") return "";
  try {
    const viaBridge = sanitizedVersion(getOwnAppVersionName());
    if (viaBridge) return viaBridge;
    const viaAppVersion = sanitizedVersion((window as any).FitUpNative?.appVersion?.());
    if (viaAppVersion) return viaAppVersion;
  } catch {}
  try {
    const m = /FitUpApp\/(\d+(?:\.\d+)*)/.exec(window.navigator.userAgent || "");
    return m ? m[1] : "";
  } catch {
    return "";
  }
}
