"use client";

/**
 * دروازهٔ مجوزها در اپ اندروید «اختصاصی» فیتاپ — متعادل با درخواست مالک:
 *
 *  «دسترسی‌های نوتیف، گالری، دوربین و میکروفون باید در زمان خودشان گرفته
 *   شوند و ترجیحاً با یک مودال خیلی زیبا و انیمه‌دار و جذاب.»
 *
 * الگو: pre-permission rationale — قبل از هر دیالوگ سیستمی اندروید، یک مودال
 * زیبا و انیمه‌دار داخل خود سایت (همان UI فیتاپ) دلیل نیاز را توضیح می‌دهد؛
 * بعد از تأیید کاربر، دیالوگ سیستمی اندروید در «همان لحظهٔ استفاده» ظاهر
 * می‌شود. در مرورگر/PWA هیچ مودالی نمایش داده نمی‌شود (رفتار تغییر نمی‌کند).
 *
 * نوع‌ها:
 *  - notifications → بعد از ورود اول به پنل (POST_NOTIFICATIONS اندروید ۱۳+)
 *  - microphone    → لحظهٔ ضبط پیام صوتی (getUserMedia)
 *  - gallery       → اولین انتخاب عکس/ویدیو (file picker — نیازی به مجوز
 *                    runtime ندارد؛ فقط توضیح شفاف قبل از باز شدن گالری)
 *  - camera        → رزرو برای استفادهٔ آیندهٔ دوربین درون‌برنامه‌ای
 */
import { isFitUpOwnApp } from "./app-bridge";

export type PermissionGateType = "notifications" | "microphone" | "gallery" | "camera";

/** کامپوننت PermissionGateModal خودش را ثبت می‌کند (singleton) */
type GateHandler = (type: PermissionGateType) => Promise<boolean>;

let gateHandler: GateHandler | null = null;

export function registerPermissionGate(handler: GateHandler): () => void {
  gateHandler = handler;
  return () => {
    if (gateHandler === handler) gateHandler = null;
  };
}

/** آیا مودال دروازهٔ مجوز در دسترس است (کامپوننت mounted است)؟ */
export function isPermissionGateAvailable(): boolean {
  return gateHandler !== null;
}

/**
 * نمایش مودال زیبای مجوز و منتظر تصمیم کاربر.
 * خروجی: true = کاربر تأیید کرد / false = رد یا مودال در دسترس نبود.
 */
export async function showPermissionGate(type: PermissionGateType): Promise<boolean> {
  if (!gateHandler) return false;
  try {
    return await gateHandler(type);
  } catch {
    return false;
  }
}

/* ─── حافظهٔ «قبلاً توضیح داده شده» (فقط تأیید کاربر ذخیره می‌شود) ─── */

function explainedKey(type: PermissionGateType): string {
  return `fitup_perm_${type}_explained`;
}

export function isPermissionExplained(type: PermissionGateType): boolean {
  try {
    return window.localStorage.getItem(explainedKey(type)) === "1";
  } catch {
    return false;
  }
}

function markExplained(type: PermissionGateType) {
  try {
    window.localStorage.setItem(explainedKey(type), "1");
  } catch {}
}

/**
 * دروازهٔ کامل: خارج از اپ اختصاصی یا بعد از یک‌بار توضیح → بی‌مودال عبور.
 * داخل اپ اختصاصی → مودال زیبا → تأیید کاربر → ثبت + true.
 */
export async function requestPermissionWithGate(type: PermissionGateType): Promise<boolean> {
  if (!isFitUpOwnApp()) return true;
  if (isPermissionExplained(type)) return true;
  const ok = await showPermissionGate(type);
  if (ok) markExplained(type);
  return ok;
}

/* ─── دروازهٔ گالری: اولین کلیک روی input[type=file] ───
 *
 * نحوهٔ کار: لیسنر capture روی document — قبل از هر هندلری که می‌خواهد فایل
 * picker را باز کند، کلیک روی خودِ input را می‌گیرد (هم مستقیم، هم label،
 * هم کلیک برنامه‌ای input.click() که UI برای «آپلود» صدا می‌زند). بعد از
 * تأییدِ مودال، همان input دوباره click می‌شود (با فلگ bypass تا حلقه نشود).
 *
 * گالری نیازی به مجوز runtime اندروید ندارد (SAF picker) — این دروازه فقط
 * توضیح شفاف و خوش‌تجربه قبل از اولین باز شدن گالری است (درخواست مالک).
 */

let galleryGateInstalled = false;
let bypassNextFileClick = false;

export function installGalleryGate() {
  if (typeof window === "undefined") return;
  if (galleryGateInstalled || !isFitUpOwnApp()) return;
  galleryGateInstalled = true;

  document.addEventListener(
    "click",
    (e) => {
      try {
        if (bypassNextFileClick) return;
        if (isPermissionExplained("gallery")) return;
        const target = e.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "file") return;

        // فقط اولین بار: جلوی باز شدن مستقیم picker را بگیر و مودال نشان بده
        e.preventDefault();
        e.stopPropagation();

        void (async () => {
          const ok = await showPermissionGate("gallery");
          if (!ok) return; // «الان نه» → همین آپلود لغو شد؛ دفعهٔ بعد دوباره پرسیده می‌شود
          markExplained("gallery");
          bypassNextFileClick = true;
          try {
            target.click();
          } finally {
            setTimeout(() => {
              bypassNextFileClick = false;
            }, 400);
          }
        })();
      } catch {
        // هر خطایی → رفتار پیش‌فرض (picker مستقیم باز شود)
      }
    },
    true // capture — قبل از همهٔ هندلرها
  );
}
