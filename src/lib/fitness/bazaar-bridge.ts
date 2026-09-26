"use client";

/**
 * پل اپ کافه‌بازار — توابع سمت سایت برای تعامل با NativeBridge اپ اندروید.
 *
 * همه این توابع خارج از اپ (مرورگر/PWA) no-op یا fallback مرورگر دارند؛
 * اپ فقط وقتی window.FitUpNative را تزریق کرده که داخل WebView فیتاپ هستیم.
 */

/**
 * آیا داخل اپ اندروید کافه‌بازار هستیم؟
 *
 * FIX (v51 — درخواست مالک / قانون کافه‌بازار): قبلاً فقط پل JS چک می‌شد؛ اگر
 * به هر دلیلی (لحظهٔ اول لود، خطای bridge) پاسخ false می‌آمد، تب «اپ موبایل»
 * و بخش نصب اپ داخل اپ بازار دیده می‌شد — همان چیزی که بازار با آن برخورد کرد.
 * حالا مثل isFitUpOwnApp فال‌بک UA هم دارد (اپ بازار پسوند «FitUpBazaar/x»
 * به User-Agent اضافه می‌کند — MainActivity.kt:255) و تشخیص هرگز false منفی
 * نمی‌دهد.
 */
export function isFitUpBazaarApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if ((window as any).FitUpNative?.isBazaarApp?.() === true) return true;
    // فال‌بک UA — همان الگوی app-bridge.ts برای اپ اختصاصی
    if (/FitUpBazaar\//.test(window.navigator.userAgent || "")) return true;
    return false;
  } catch {
    try {
      return /FitUpBazaar\//.test(window.navigator.userAgent || "");
    } catch {
      return false;
    }
  }
}

/**
 * FIX (گزارش مالک — v50): «دکمهٔ دانلود برنامه‌ها (تمرینی/تغذیه/مکمل) هیچ‌چیز
 * دانلود نمی‌کند.» ریشه: downloadDataUrl قبلاً فقط برای اپ بازار پل native
 * می‌ساخت و در اپ اختصاصی (isBazaarApp=false) و WebView به مسیر
 * <a download href="data:..."> می‌رفت که WebView اندروید برای data:/blob: بزرگ
 * اجرا نمی‌کند → «هیچ اتفاقی نمی‌افتد». حتی pdf.save() هم داخل jsPDF همان
 * ترفند blob/anchor را می‌زند. اکنون:
 *
 *  ۱) هر جا FitUpNative.downloadFile وجود دارد (اپ اختصاصی «و» اپ بازار) →
 *     پل native (MediaStore Downloads + توست خود اپ) — خروجی "native".
 *  ۲) مرورگر → Blob + createObjectURL (مطمئن‌تر از data:های چندمگابایتی) —
 *     خروجی "browser" تا caller توست موفقیت را فقط اینجا نشان دهد.
 *  ۳) شکست واقعی → "failed" (دیگر هیچ توست «دانلود شد ✓» قلابی نیست).
 */
export type DownloadResult = "native" | "browser" | "failed";

/** آیا پل دانلود native (هر دو اپ) در دسترس است؟ */
function hasNativeDownloadBridge(): boolean {
  try {
    const native = (window as any).FitUpNative;
    if (!native || typeof native.downloadFile !== "function") return false;
    // فقط داخل اپ‌های خودمان (نه هر صفحه‌ای که تصادفاً FitUpNative دارد)
    const own = native.isOwnApp?.() === true;
    const bazaar = native.isBazaarApp?.() === true;
    return own || bazaar;
  } catch {
    return false;
  }
}

export function downloadDataUrl(filename: string, dataUrl: string): DownloadResult {
  if (typeof window === "undefined") return "failed";
  if (!dataUrl || !dataUrl.startsWith("data:")) return "failed";

  // ۱) پل native — هر دو اپ (FIX اصلی: اپ اختصاصی هم از این مسیر استفاده کند)
  if (hasNativeDownloadBridge()) {
    try {
      (window as any).FitUpNative.downloadFile(filename, dataUrl);
      // اپ خودش «ذخیره شد ✓» توست می‌کند → caller توست اضافه نشان ندهد
      return "native";
    } catch {
      // پل شکست خورد → ادامه به مسیر مرورگر (شاید WebView جدیدش را دارد)
    }
  }

  // ۲) مرورگر — Blob + objectURL (به‌جای data: چندمگابایتی که در موبایل‌ها
  //    بی‌صدا شکست می‌خورد) + append به DOM (سافاری/WebView قدیمی بدون append
  //    کلیک anchor را نادیده می‌گیرد)
  try {
    const commaIdx = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, commaIdx); // مثلاً image/png;base64
    const mime = /^([^;]+)/.exec(meta)?.[1] || "application/octet-stream";
    const b64 = dataUrl.slice(commaIdx + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    // بعد از fallback مرورگر، هر چه شد «دانلود مرورگر» است (مدیریت دانلود خود مرورگر)
    setTimeout(() => {
      try {
        link.remove();
        URL.revokeObjectURL(url);
      } catch {}
    }, 10_000);
    return "browser";
  } catch {
    return "failed";
  }
}

/**
 * دانلود مستقیم Blob (اکسل‌های پنل ادمین و ...) — داخل اپ‌ها از پل native،
 * در مرورگر همان مسیر objectURL. خروجی مثل downloadDataUrl.
 */
export async function downloadBlob(filename: string, blob: Blob): Promise<DownloadResult> {
  if (typeof window === "undefined") return "failed";
  if (hasNativeDownloadBridge()) {
    try {
      // تبدیل Blob → dataURL برای پل native (اپ انتظار data:...;base64 دارد)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read blob failed"));
        reader.readAsDataURL(blob);
      });
      if (dataUrl.startsWith("data:")) {
        (window as any).FitUpNative.downloadFile(filename, dataUrl);
        return "native";
      }
    } catch {
      // پل شکست → مسیر مرورگر
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        a.remove();
        URL.revokeObjectURL(url);
      } catch {}
    }, 10_000);
    return "browser";
  } catch {
    return "failed";
  }
}

/** چاپ صفحه فعلی — در اپ از PrintManager اندروید، در مرورگر window.print */
export function printPage(): void {
  if (typeof window === "undefined") return;
  if (isFitUpBazaarApp()) {
    try {
      (window as any).FitUpNative?.printPage?.();
      return;
    } catch {
      // fallback
    }
  }
  window.print();
}

/** consume خرید مصرفی بازار بعد از فعال‌سازی موفق روی سرور */
export function consumeBazaarPurchase(purchaseToken: string): void {
  if (typeof window === "undefined") return;
  try {
    (window as any).FitUpNative?.consumePurchase?.(purchaseToken);
  } catch {
    // no-op
  }
}
