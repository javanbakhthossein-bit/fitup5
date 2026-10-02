"use client";

/**
 * پل اپ اندروید «اختصاصی» فیتاپ — تشخیص و تعامل با WebView اپ خودمان.
 *
 * دو اپ نیتیو داریم:
 *  ۱. اپ کافه‌بازار (ir.fittup.app) — پرداخت IAB بازار — پل: bazaar-bridge.ts
 *  ۲. اپ اختصاصی (ir.fittup.panel) — فقط پنل کاربری + درگاه پرداخت خود سایت — همین فایل
 *     (دانلود فقط از خود سایت؛ آپدیت از /api/app/own/latest)
 *
 * اپ اختصاصی window.FitUpNative را با این متدها تزریق می‌کند:
 *  - isOwnApp() → true
 *  - getAppVersionCode() → Int (برای مقایسه با latest)
 *  - getAppVersionName() → String ("1.0.0")
 *  - downloadUpdate(url) → باز کردن مرورگر برای دانلود/نصب APK (v1.2.8 — بدون مجوز نصب)
 *  - showNotification(title, body) → نوتیف سیستم اندروید
 *  - requestNotificationPermission() → مجوز POST_NOTIFICATIONS
 *  - downloadFile(filename, dataUrl) / printPage()
 *
 * همه توابع خارج از اپ (مرورگر/PWA) no-op یا fallback مرورگر دارند.
 */

/** آیا داخل اپ اندروید «اختصاصی» فیتاپ هستیم؟ */
export function isFitUpOwnApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if ((window as any).FitUpNative?.isOwnApp?.() === true) return true;
    // fallback: UA suffix که اپ به همه درخواست‌ها می‌چسباند
    const ua = navigator.userAgent || "";
    return /FitUpApp\//.test(ua);
  } catch {
    return false;
  }
}

/** versionCode اپ اختصاصی (۰ = خارج از اپ / نامشخص) */
export function getOwnAppVersionCode(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = (window as any).FitUpNative?.getAppVersionCode?.();
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** versionName اپ اختصاصی ("" = خارج از اپ) */
export function getOwnAppVersionName(): string {
  if (typeof window === "undefined") return "";
  try {
    return String((window as any).FitUpNative?.getAppVersionName?.() || "");
  } catch {
    return "";
  }
}

/** آیا داخل هر اپ نیتیو فیتاپ هستیم (اختصاصی یا بازار)؟ */
export function isFitUpNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if ((window as any).FitUpNative?.isOwnApp?.() === true) return true;
    if ((window as any).FitUpNative?.isBazaarApp?.() === true) return true;
    const ua = navigator.userAgent || "";
    return /FitUpBazaar\/|FitUpApp\//.test(ua);
  } catch {
    return false;
  }
}

/** آیا در حالت «برنامه» هستیم؟ (اپ نیتیو یا وب‌اپ iOS/PWA standalone) */
export function isAppShellMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    return standalone || isFitUpNativeApp();
  } catch {
    return false;
  }
}

/**
 * دانلود آپدیت اپ اختصاصی — با تشخیص دقیق محیط و «همیشه-کار-کند»:
 *
 *  ۱. اپ v1.2.2+ (code ≥ 5) → پل نیتیو downloadUpdate(url):
 *     تا v1.2.7: DownloadManager + دیالوگ نصب داخل اپ؛
 *     از v1.2.8: باز کردن مرورگر بیرونی برای دانلود/نصب (حذف مجوز
 *     REQUEST_INSTALL_PACKAGES — فیکس مسدودشدن اپ توسط Play Protect).
 *     (ریشه‌یابی باگ «دانلود نمی‌شود» در نسخه‌های قدیمی: تا قبل از v1.2.2 گیرندهٔ
 *     ACTION_DOWNLOAD_COMPLETE با RECEIVER_NOT_EXPORTED ثبت می‌شد و اندروید ۱۴+
 *     برادکست DownloadProvider را به آن نمی‌رساند → دانلود شاید تمام می‌شد ولی
 *     دیالوگ نصب هیچ‌وقت نمی‌آمد و کاربر هیچ چیزی نمی‌دید.)
 *  ۲. اپ‌های قدیمی‌تر (code < 5) → باز کردن لینک APK در مرورگر بیرونی با
 *     intent:// — مرورگر (کروم) خودش دانلود می‌کند، نوتیف پیشرفت/پایان دارد و
 *     نصب را پیشنهاد می‌دهد. این مسیر روی «همه» اپ‌های نصب‌شده حتی بدون آپدیت اپ
 *     کار می‌کند (handleExternalScheme intent از v1.0.0 وجود دارد).
 *  ۳. مرورگر عادی → لینک دانلود مستقیم (رفتار قبلی).
 *
 * خروجی — چه چیزی رخ داد تا caller پیام درست نشان دهد:
 *  - "native"        → اپ جدید دانلود را خودش مدیریت می‌کند (توست/دیالوگ نیتیو)
 *  - "browser-intent"→ مرورگر بیرونی برای دانلود باز شد (نیازی به توست وب نیست)
 *  - "browser-link"  → لینک مرورگر کلیک شد؛ caller توست «شروع شد» نشان دهد
 *  - "none"          → هیچ (SSR/محیط ناشناخته)
 */
export type OwnAppDownloadHandoff = "native" | "browser-intent" | "browser-link" | "none";

export function downloadOwnAppUpdate(apkUrl: string): OwnAppDownloadHandoff {
  if (typeof window === "undefined") return "none";
  const url = new URL(apkUrl, window.location.origin).toString();
  if (isFitUpOwnApp()) {
    const code = getOwnAppVersionCode();
    if (code >= 5) {
      try {
        (window as any).FitUpNative?.downloadUpdate?.(url);
        return "native";
      } catch {
        // پل شکست → مسیر مرورگر بیرونی
      }
    }
    // اپ قدیمی (code < 5) یا پل شکست → مرورگر بیرونی (همیشه کار می‌کند)
    try {
      const u = new URL(url);
      const fallback = encodeURIComponent(url);
      const intentUrl =
        `intent://${u.host}${u.pathname}` +
        `#Intent;scheme=https;action=android.intent.action.VIEW;` +
        `S.browser_fallback_url=${fallback};end`;
      window.location.href = intentUrl;
      return "browser-intent";
    } catch {
      // ساخت intent ممکن نشد → لینک معمولی
    }
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = "fitup.apk";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return "browser-link";
}

/**
 * درخواست مجوز POST_NOTIFICATIONS از اپ نیتیو (اندروید ۱۳+).
 * در زمان درست صدا زده می‌شود: بعد از ورود کاربر به پنل و با تأییدِ مودال
 * زیبای «فعال‌سازی اعلان‌ها» (permission-gate) — نه در استارتاپ.
 * خارج از اپ نیتیو no-op است.
 */
export function requestNativeNotificationPermission(): void {
  if (typeof window === "undefined") return;
  try {
    (window as any).FitUpNative?.requestNotificationPermission?.();
  } catch {}
}

/** نمایش نوتیف سیستم اندروید از پل نیتیو (اگر موجود) */
export function showNativeNotification(title: string, body: string): void {
  if (typeof window === "undefined") return;
  try {
    (window as any).FitUpNative?.showNotification?.(String(title), String(body));
  } catch {}
}

/**
 * درخواست «غیرفعال‌سازی بهینه‌سازی باتری» از اپ نیتیو (v31).
 * دیالوگ فارسی نیتیو یک‌بار در عمر نصب نشان داده می‌شود؛ رد → دیگر پرسیده
 * نمی‌شود. هدف: رسیدن یادآوری‌ها حتی وقتی برنامه بسته است (به‌همراه
 * همگام‌سازی WorkManager) — مصرف باتری به‌طور محسوسی بالا نمی‌رود.
 * خارج از اپ نیتیو no-op است.
 */
export function requestBatteryOptimizationExemption(): void {
  if (typeof window === "undefined") return;
  try {
    (window as any).FitUpNative?.requestBatteryOptimization?.();
  } catch {}
}

/**
 * همگام‌سازی فوری اعلان‌ها در WorkManager اپ (v31) — در ورود به پنل صدا زده
 * می‌شود؛ اپ اعلان‌های از-دست-رفتهٔ زمان بسته‌بودن را به‌صورت نوتیف محلی نشان می‌دهد.
 */
export function syncNativeNotificationsNow(): void {
  if (typeof window === "undefined") return;
  try {
    (window as any).FitUpNative?.syncNotificationsNow?.();
  } catch {}
}

/**
 * فعال‌سازی شنوندهٔ SMS Retriever اپ نیتیو (v31) — بدون هیچ پرمیشن پیامکی.
 * فقط وقتی متن پیامک با هش اپ امضا شده باشد کار می‌کند (ارسال خام sms.ir
 * با SMSIR_USE_RAW_SEND=true). کار می‌کند در صفحهٔ ورود کد.
 */
export function startNativeOtpRetriever(): void {
  if (typeof window === "undefined") return;
  try {
    (window as any).FitUpNative?.startOtpSmsRetriever?.();
  } catch {}
}

/**
 * v57 — کلید bridge ورود خودکار OTP (فقط داخل اپ‌های نیتیو مقدار دارد).
 * اپ این کلید را از BuildConfig می‌دهد؛ send-otp با تطبیقش در سرور، کد را در
 * «همان پاسخ» برمی‌گرداند (bridgeCode) تا صفحهٔ ورود بدون هیچ دکمه/تایپی، کد
 * را جا بگذارد و خودکار verify کند → کاربر مستقیم وارد پنل می‌شود.
 * در مرورگر/وب همیشه null برمی‌گردد (سرور هم فقط برای واریانت اپ قبول می‌کند).
 */
export function getNativeOtpBridgeKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return String((window as any).FitUpNative?.getOtpBridgeKey?.() || "");
  } catch {
    return "";
  }
}
