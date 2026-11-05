"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Home, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SplashLoader } from "@/components/fitness/splash-loader";
import {
  isChunkFailure,
  maybeReloadForChunkFailure,
  reportClientError,
} from "@/lib/fitness/client-error-report";

/**
 * error.tsx — مرز خطای سطح روت (v167 بازطراحی کامل — دیرکتیو مالک:
 * «اتفاق غیرمنتظره رخ داد» نباید هیچ‌جا دیده شود — اپ، بازار، وب، هیچ‌جا).
 *
 * گزارش مالک: در نصب اول اپ، یک لحظه کارت خطا فلش شد و بعد خودش رفت —
 * خطاهای گذرای اولین اجرا (چانک دیر/شبکهٔ تازه) مرز خطا را روشن می‌کردند و
 * auto-retry فوراً ترمیم می‌کرد؛ ولی همان یک لحظه برای کاربر «اپ خراب است».
 *
 * رفتار جدید:
 *  ۱) در تمام فاز تلاش خودکار فقط «اسپلش برند» نشان داده می‌شود — دقیقاً همان
 *     صفحه‌ای که در شروع عادی اپ دیده می‌شود. کاربر هرگز هیچ متن/کارت خطایی
 *     نمی‌بیند؛ ترمیم گذرا در پشت اسپلش انجام می‌شود.
 *     🩹 v171 — سقف تلاش خودکار ۱۰ → ۳ (حداکثر ~۷ ثانیه اسپلش، نه ~۳۰):
 *     اسپلش طولانی از دید کاربر «اپ هنگ کرده» است — اگر ۳ تلاش کافی نبود،
 *     کاربر حق دارد کنترل داشته باشد.
 *  ۲) فقط اگر همهٔ تلاش‌های خودکار شکست خوردند، یک کارت «آرام» بالا
 *     می‌آید — بدون هیچ واژهٔ «خطا/اتفاق/مشکل»: «بارگذاری کامل نشد» +
 *     دکمهٔ تلاش مجدد (رفرش کامل تمیز) / بازگشت به خانه.
 *  ۳) ChunkLoadError (بیلد قدیم بعد از دیپلوی) مثل قبل یک‌بار reload کامل
 *     با پاک‌سازی کش می‌زند (client-error-report مشترک).
 */
const MAX_AUTO_RETRIES = 3;
const AUTO_RETRY_DELAY_MS = 3_000;

/**
 * v224 — تشخیص پوستهٔ نیتیو اپ اندروید (هر دو APK: اختصاصی و کافه‌بازار).
 * دیرکتیو مالک: «اتصال اینترنت برقرار نیست» و هر کارت خطای دیگری هرگز نباید در
 * اپ دیده شود — به‌جایش همان اسپلش برند نشان داده می‌شود و تلاش خودکار تا ترمیم
 * ادامه پیدا می‌کند (لایهٔ نیتیو هم پروب/reload مستقل خودش را دارد).
 */
function isNativeAppShell(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { FitUpNative?: unknown };
    return !!w.FitUpNative && typeof w.FitUpNative === "object";
  } catch {
    return false;
  }
}

/**
 * v59 — گزارش کرش مرز خطا به سرور (/api/error-log) — از v67 با دِداپ مشترک.
 * پیام + استک + digest + UA + URL ثبت می‌شود تا در تب «لاگ خطاها»ی پنل مدیریت
 * دقیقاً معلوم شود چه چیزی روی چه دستگاهی شکسته. اثرانگوش دِداپ = پیام خام
 * (بدون پیشوند) — تا اگر نگهبان window هم همان حادثه را گزارش کند، فقط یک
 * رکورد درج شود (نه دو تا).
 */
function reportErrorToServer(error: Error & { digest?: string }) {
  reportClientError("error-boundary", error, {
    dedupeKey: error?.message || "Unknown render error",
  });
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app-error]", error);
  // v59 — ارسال به لاگ سرور برای ریشه‌یابی «خطای فقط-برخی-دستگاه‌ها»
  useEffect(() => {
    reportErrorToServer(error);
    // error معمولاً در هر رندر همان شیء است — یک‌بار کافی است
  }, []);
  const [autoLeft, setAutoLeft] = useState(MAX_AUTO_RETRIES);
  // v224 — پوستهٔ نیتیو؟ (یک‌بار در اولین رندر کلاینت سنجیده می‌شود)
  const [nativeApp] = useState(() => isNativeAppShell());
  const resettingRef = useRef(false);

  // تشخیص «سرور/شبکه در دسترس نیست» — برای پیام آرامِ پس از اتمام تلاش‌ها
  const looksOffline =
    /failed to fetch|networkerror|load failed|err_connection|err_name|502|503|timeout|aborted/i.test(
      `${error?.message ?? ""}`
    );

  // ─── v58 — تشخیص «chunk قدیمی بعد از دیپلوی» (ChunkLoadError) ───
  // گزارش کاربر: «با هر مرورگری وارد سایت می‌شوم همین خطا را می‌دهم». وقتی
  // مرورگر کد قدیمیِ درون‌حافظه‌ای را دارد و به فایل‌های chunk نسخهٔ قبلی
  // (که بعد از دیپلوی دیگر وجود ندارند) اشاره می‌کند، reset() هرگز ترمیمش
  // نمی‌کند — چون همان کد خراب را دوباره اجرا می‌کند. تنها راه درست: یک بار
  // reload کامل (گرفتن HTML تازه با نام‌های chunk جدید). ضد حلقه: هر ۳۰
  // ثانیه حداکثر یک بار (sessionStorage).
  const looksStaleChunk = isChunkFailure(`${error?.message ?? ""}`);
  // v67 — گارد reload به ماژول مشترک منتقل شد (۶۰ ثانیه، همهٔ مسیرها یک گارد)
  const staleReloadedRef = useRef(false);
  useEffect(() => {
    if (!looksStaleChunk || staleReloadedRef.current) return;
    staleReloadedRef.current = true;
    maybeReloadForChunkFailure();
  }, [looksStaleChunk]);

  const doReset = useCallback(() => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    reset();
  }, [reset]);

  // تایمر تلاش مجدد خودکار — اولین تلاش سریع (۸۰۰ms) تا خطاهای گذرای اولین
  // اجرای اپ قبل از دیده‌شدن هر چیزی ترمیم شوند؛ تلاش‌های بعدی ۳ ثانیه‌ای.
  useEffect(() => {
    if (autoLeft > 0) {
      const delay = autoLeft === MAX_AUTO_RETRIES ? 800 : AUTO_RETRY_DELAY_MS;
      const t = setTimeout(() => {
        setAutoLeft((v) => v - 1);
        resettingRef.current = false; // اجازهٔ تلاش مجدد
        doReset();
      }, delay);
      return () => clearTimeout(t);
    }
    // v224 — در اپ اندروید تلاش خودکار هرگز تمام نمی‌شود: کاربر فقط اسپلش برند
    // می‌بیند و ترمیم پشت اسپلش ادامه دارد؛ هیچ کارت خطایی رندر نمی‌شود.
    if (nativeApp) {
      const t = setTimeout(() => {
        resettingRef.current = false;
        doReset();
      }, AUTO_RETRY_DELAY_MS);
      return () => clearTimeout(t);
    }
    return;
  }, [autoLeft, doReset, nativeApp]);

  // اگر صفحه دوباره قابل مشاهده شد (کاربر برگشت) یک تلاش زودتر انجام بده
  // 🩹 v171 — فقط تا وقتی تلاش خودکار باقی مانده است؛ بعد از اتمام سقف،
  // برگشت کاربر نباید بی‌صدا دور جدید اسپلش بسازد (کارت کنترل می‌ماند).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && (autoLeft > 0 || nativeApp)) {
        resettingRef.current = false;
        doReset();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [doReset, autoLeft, nativeApp]);

  // ─── v167 — فاز تلاش خودکار: فقط اسپلش برند (صفر متن خطا) ───
  // ─── v224 — در اپ اندروید همیشه همین اسپلش می‌ماند (کارت پایین فقط برای مرورگر/PWA است) ───
  if (autoLeft > 0 || nativeApp) {
    return (
      <div aria-busy="true" aria-live="polite">
        <SplashLoader />
      </div>
    );
  }

  // ─── همهٔ تلاش‌های خودکار شکست خوردند → کارت آرام (بدون واژهٔ خطا) ───
  return (
    <div
      dir="rtl"
      className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-amber-50/60 to-white p-6"
      role="alert"
    >
      {/* درخشش‌های ملایم هم‌خانوادهٔ برند */}
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
        <div className="absolute -top-16 -right-16 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute -bottom-20 -left-16 h-72 w-72 rounded-full bg-orange-200/30 blur-3xl" />
      </div>

      <div className="w-full max-w-md rounded-3xl border border-orange-100 bg-white p-8 text-center shadow-xl shadow-orange-100/60">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-200">
          {looksOffline ? (
            <WifiOff className="h-8 w-8" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-8 w-8" aria-hidden="true" />
          )}
        </div>

        {looksOffline ? (
          <>
            <h2 className="mb-2 text-xl font-black text-slate-900">
              اتصال برقرار نشد
            </h2>
            <p className="mb-6 text-sm leading-7 text-slate-500">
              اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.
              <br />
              اگر همین حالا آپدیت فیتاپ در حال انتشار باشد، چند دقیقه بعد خودش
              بالا می‌آید.
            </p>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-xl font-black text-slate-900">
              بارگذاری صفحه کامل نشد
            </h2>
            <p className="mb-6 text-sm leading-7 text-slate-500">
              چند بار خودکار تلاش کردیم اما نشد — لطفاً دوباره تلاش کنید.
            </p>
          </>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            onClick={() => {
              // 🩹 v171 — تلاش دستی = رفرش کامل تمیز (window.location.reload)
              // به‌جای دور جدید reset/اسپلش: ۳ تلاش خودکار شکست خورده‌اند،
              // پس همان تلاشی که واقعاً ترمیم می‌کند (HTML/چانک تازه) اجرا شود.
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="bg-gradient-to-l from-amber-500 to-orange-600 text-white shadow-md shadow-orange-200 hover:opacity-90"
          >
            <RefreshCw className="ml-2 h-4 w-4" aria-hidden="true" />
            تلاش مجدد
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (typeof window !== "undefined") window.location.assign("/");
            }}
          >
            <Home className="ml-2 h-4 w-4" aria-hidden="true" />
            بازگشت به خانه
          </Button>
        </div>
      </div>
    </div>
  );
}
