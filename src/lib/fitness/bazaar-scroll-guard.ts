/**
 * ─── گارد اسکرول اپ‌ها (رفع نهایی باگ pull-to-refresh — v153) ───
 *
 * تاریخچهٔ تیکت مالک:
 *   v143: «فقط وقتی از بالای صفحه به پایین کشید رفرش بشه»
 *   v149: «وسط صفحه و پایین صفحه رفرش نشه»
 *   v153: «همچنان در هر قسمتی از صفحه می‌کشیم به پایین رفرش میشه. گفتم فقط
 *          یک چهارم بالای صفحه باید قابلیت اسکرول برای رفرش داشته باشه.»
 *
 * ریشهٔ باقی‌ماندن باگ: SwipeRefresh نیتیو هرجا scrollY صفحه صفر باشد فعال
 * می‌شود — «موقعیت شروع لمس در یک‌چهارم بالای صفحه» را هیچ لایه‌ای کنترل
 * نمی‌کرد؛ قفل/بازکردن مبتنی بر touchstart هم بین رویدادهای نیتیو (scrollY==0
 * در MainActivity دوباره فعالش می‌کند) نشتی داشت.
 *
 * راه‌حل نهایی v153: رفرش نیتیو «برای همیشه» بسته می‌شود (setSwipeRefreshEnabled(false)
 * پایدار — در touchstart دوباره تأکید می‌شود چون MainActivity در scrollY==0
 * آن را دوباره روشن می‌کند) و رفرش توسط ماژول وب pull-to-refresh.ts بازسازی
 * می‌شود که دقیقاً همان قاعدهٔ مالک را اجرا می‌کند: فقط یک‌چهارم بالای صفحه،
 * فقط وقتی سند در بالای خودش است، فقط خارج از اسکرولرهای داخلی.
 *
 * نصب: در page-client برای هر دو اپ (isFitUpNativeApp) — رفتار وب صفحات SSR
 * هم از طریق PullToRefreshInstaller در layout یکسان شده است.
 */

type BazaarNativeBridge = {
  setSwipeRefreshEnabled?: (enabled: boolean) => void;
};

function native(): BazaarNativeBridge | null {
  try {
    return (window as any).FitUpNative ?? null;
  } catch {
    return null;
  }
}

let guardInstalled = false;

/** نصب گارد — فقط داخل اپ (هر دو) فراخوانی می‌شود */
export function installBazaarScrollGuard() {
  if (typeof window === "undefined" || guardInstalled) return;
  guardInstalled = true;

  const lockNative = () => {
    try {
      native()?.setSwipeRefreshEnabled?.(false);
    } catch {}
  };

  // ۱) بستن فوری در نصب
  lockNative();
  // ۲) تضمین بعد از لود کامل (اگر بریج دیر آماده شده باشد)
  window.addEventListener("load", lockNative, { once: true });
  // ۳) تأکید مجدد در شروع هر لمس — MainActivity در scrollY==0 دوباره روشنش
  //    می‌کند؛ تا ژست شروع نشده به رفرش نیتیو فرصت نمی‌دهیم.
  window.addEventListener(
    "touchstart",
    lockNative,
    { capture: true, passive: true }
  );
  // ۴) بعد از هر اسکرول هم بستن بماند (رفرش فقط از مسیر وب ماژول می‌آید)
  window.addEventListener(
    "scroll",
    lockNative,
    { capture: true, passive: true }
  );
}
