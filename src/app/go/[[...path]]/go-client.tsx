"use client";

import { useEffect, useRef, useState } from "react";
import { Dumbbell, Smartphone, Globe } from "lucide-react";

export type GoTarget = {
  webUrl: string;
  kind: "panel" | "renew" | "web";
};

/**
 * لینک هوشمند فیتاپ — «اپ باز بشه، نه سایت» (v47)
 *
 * ترتیب تلاش روی موبایل اندروید:
 *  ۱) intent:// با اسکیم fitup:// (در هر دو APK اختصاصی/بازار ثبت شده)
 *     + S.browser_fallback_url → اگر اپ نبود، کروم خودش نسخهٔ وب را باز می‌کند
 *  ۲) تایمر ۲.۵ ثانیه‌ای → اگر مرورگر هنوز اینجاست (مثل فایرفاکس که
 *     intent:// را نمی‌فهمد) مستقیم نسخهٔ وب را باز می‌کنیم
 *
 * داخل خود اپ (WebView) یا دسکتاپ → ریدایرکت فوری، بدون نمایش این صفحه.
 */
export function GoClient({ target }: { target: GoTarget }) {
  const [phase, setPhase] = useState<"opening" | "manual">("opening");
  const firedRef = useRef(false);
  const hidOnceRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seconds, setSeconds] = useState(3);

  // v55 — ساخت لینک intent:// (کروم اندروید) — برای تلاش خودکار «و» دکمهٔ اصلی
  // (دکمه با کلیک کاربر = user gesture → کروم همیشه اجازهٔ بازکردن اپ را می‌دهد؛
  // ریشه «لینک پیامک به‌جای اپ، سایت را باز می‌کند» این بود که دکمهٔ اصلی به
  // وب‌سایت لینک بود، نه به اپ!)
  const buildIntentUrl = () => {
    const absolute = window.location.origin + target.webUrl;
    const enc = encodeURIComponent(target.webUrl);
    const encAbs = encodeURIComponent(absolute);
    return `intent://fitup/open?url=${enc}#Intent;scheme=fitup;S.browser_fallback_url=${encAbs};end`;
  };
  const buildSchemeUrl = () =>
    `fitup://open?url=${encodeURIComponent(target.webUrl)}`;

  const openInApp = () => {
    const ua = navigator.userAgent || "";
    const isChrome = /Chrome\/|CriOS\/|EdgA\//.test(ua);
    try {
      window.location.href = isChrome ? buildIntentUrl() : buildSchemeUrl();
    } catch {
      // هیچ هندلری نبود — تایمر پایین نسخهٔ وب را باز می‌کند
    }
  };

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isNativeApp = /FitUpApp\/|FitUpBazaar\//.test(ua);
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (navigator as any).standalone === true;
    const isAndroid = /Android/.test(ua);
    const isChrome = /Chrome\/|CriOS\/|EdgA\//.test(ua);

    // داخل خود اپ یا PWA → مستقیم برو به مقصد (بدون صفحهٔ میانی)
    if (isNativeApp || isStandalone || !isAndroid) {
      window.location.replace(target.webUrl);
      return;
    }

    const cleanup = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    // اگر صفحه پنهان شد = اپ (یا fallback) باز شد → تایمر را متوقف کن
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hidOnceRef.current = true;
        cleanup();
      }
    };
    const onPageHide = () => {
      hidOnceRef.current = true;
      cleanup();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    if (!firedRef.current) {
      firedRef.current = true;
      // v55 — تلاش خودکار برای بازکردن اپ (کروم معمولاً اجازه می‌دهد؛ در
      // بازدیدهای بدون gesture که مسدود شود، تایمر پایین وب را باز می‌کند و
      // دکمهٔ اصلی همیشه با gesture کاربر اپ را باز می‌کند)
      openInApp();
    }

    // تایمر نجات: اگر بعد از ۳ ثانیه هنوز این صفحه هستیم → نسخهٔ وب
    timerRef.current = setTimeout(() => {
      if (hidOnceRef.current) return;
      if (document.visibilityState === "hidden") return;
      window.location.replace(target.webUrl);
    }, 3000);

    // شمارش معکوس نمایشی
    let left = 3;
    const tick = setInterval(() => {
      left -= 1;
      setSeconds(Math.max(0, left));
      if (left <= 0) clearInterval(tick);
    }, 1000);

    return () => {
      cleanup();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [target.webUrl]);

  // بعد از بازگشت از اپ (کاربر دوباره به مرورگر برگشت) → راهنمای دستی
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState === "visible" && hidOnceRef.current) {
        setPhase("manual");
      }
    };
    document.addEventListener("visibilitychange", onBack);
    return () => document.removeEventListener("visibilitychange", onBack);
  }, []);

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-slate-50 flex items-center justify-center p-4"
    >
      <div
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl shadow-amber-100/60 border border-amber-100 p-8 text-center"
        role="status"
        aria-live="polite"
      >
        {/* لوگو */}
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-200">
          <Dumbbell className="w-8 h-8 text-white" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-black text-slate-900">فیتاپ</h1>

        {phase === "opening" ? (
          <>
            <div className="mt-5 flex items-center justify-center gap-2 text-slate-600 text-sm">
              <span
                className="inline-block w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"
                aria-hidden="true"
              />
              در حال باز کردن اپ فیتاپ…
            </div>
            <p className="mt-3 text-xs text-slate-400 leading-6">
              اگر اپ به‌صورت خودکار باز نشد،
              {seconds > 0 ? ` تا ${seconds} ثانیه دیگر ` : " "}
              نسخهٔ وب برایتان باز می‌شود.
            </p>
          </>
        ) : (
          <p className="mt-5 text-sm text-slate-600 leading-7">
            اپ باز شد؟ عالی! 🎉
            <br />
            اگر نه، می‌توانید همین‌جا ادامه دهید.
          </p>
        )}

        <div className="mt-6 space-y-2.5">
          {/* v55 — دکمهٔ اصلی = بازکردن اپ (با gesture کاربر؛ اگر اپ نبود کروم
              خودش fallback وب را باز می‌کند — S.browser_fallback_url) */}
          <button
            type="button"
            onClick={openInApp}
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-l from-amber-400 to-orange-500 text-white font-bold text-sm py-3 shadow-md shadow-orange-200 active:scale-[0.98] transition"
          >
            <Smartphone className="w-4 h-4" aria-hidden="true" />
            ادامه در اپ فیتاپ
          </button>
          <a
            href={target.webUrl}
            className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm py-3 hover:bg-slate-50 active:scale-[0.98] transition"
          >
            <Globe className="w-4 h-4" aria-hidden="true" />
            مشاهده در سایت (مرورگر)
          </a>
        </div>

        <p className="mt-5 text-[11px] text-slate-400 leading-5">
          اپ فیتاپ را نصب ندارید؟ از{" "}
          <a
            href="https://cafebazaar.ir/app/ir.fittup.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 font-semibold hover:underline"
          >
            کافه‌بازار
          </a>{" "}
          دانلود کنید.
        </p>
      </div>
    </main>
  );
}
