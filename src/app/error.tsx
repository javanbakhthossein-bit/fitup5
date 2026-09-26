"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isChunkFailure,
  maybeReloadForChunkFailure,
  reportClientError,
} from "@/lib/fitness/client-error-report";

/**
 * error.tsx — مرز خطای سطح روت (v57 بازطراحی کامل).
 *
 * اسکرین‌شات مالک: کاربران گاهی موقع باز کردن سایت این کارت انگلیسی
 * «Oops! Something went wrong» را می‌دیدند (مخصوصاً وسط دیپلوی که سرور چند
 * ثانیه swap می‌شود یا یک chunk دیر می‌رسد). تغییرات:
 *  ۱) کاملاً فارسی و هم‌رنگ هویت فیتاپ.
 *  ۲) تلاش مجدد «خودکار» با تایمر ۳ ثانیه‌ای (تا ۶ بار) — خطاهای گذرای
 *     دیپلوی/شبکه بدون هیچ کلیکی خودشان ترمیم می‌شوند و کاربر هیچ‌وقت گیر
 *     نمی‌کند.
 *  ۳) اگر ریشه خطا «سرور در دسترس نیست» باشد (وسط دیپلوی)، به‌جای «خطا»،
 *     پیام دوستانهٔ «در حال آپدیت فیتاپ هستیم» نمایش داده می‌شود.
 */
const MAX_AUTO_RETRIES = 6;
const AUTO_RETRY_DELAY_MS = 3_000;

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
  const resettingRef = useRef(false);

  // تشخیص «سرور در دسترس نیست» — پیام خطای تایپ فچ/شبکه در لحظهٔ کرش
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

  // تایمر تلاش مجدد خودکار
  useEffect(() => {
    if (autoLeft <= 0) return;
    const t = setTimeout(() => {
      setAutoLeft((v) => v - 1);
      resettingRef.current = false; // اجازهٔ تلاش مجدد
      doReset();
    }, AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoLeft, doReset]);

  // اگر صفحه دوباره قابل مشاهده شد (کاربر برگشت) یک تلاش زودتر انجام بده
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        resettingRef.current = false;
        doReset();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [doReset]);

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
          <AlertTriangle className="h-8 w-8" aria-hidden="true" />
        </div>

        {looksOffline ? (
          <>
            <h2 className="mb-2 text-xl font-black text-slate-900">
              در حال آپدیت فیتاپ هستیم 🚀
            </h2>
            <p className="mb-6 text-sm leading-7 text-slate-500">
              چند لحظه‌ای فیتاپ را با نسخهٔ بهتر و قدرتمندتر آماده می‌کنیم.
              <br />
              لطفاً چند دقیقه بعد مجدداً تلاش کنید — همین‌جا هستیم و به‌محض آماده شدن، صفحه خودش بالا می‌آید.
            </p>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-xl font-black text-slate-900">
              یک اتفاق غیرمنتظره رخ داد
            </h2>
            <p className="mb-6 text-sm leading-7 text-slate-500">
              مشکلی در بارگذاری صفحه پیش آمد. معمولاً با تلاش مجدد برطرف می‌شود —
              ما هم به‌صورت خودکار داریم دوباره تلاش می‌کنیم.
            </p>
          </>
        )}

        {autoLeft > 0 ? (
          <p className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-orange-600">
            <span
              className="inline-block h-3.5 w-3.5 rounded-full border-2 border-orange-400 border-t-transparent animate-spin"
              aria-hidden="true"
            />
            تلاش مجدد خودکار تا چند لحظه دیگر…
          </p>
        ) : null}

        {error.digest ? (
          <p className="mb-5 font-mono text-xs text-slate-300" dir="ltr">
            #{error.digest}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            onClick={() => {
              resettingRef.current = false;
              doReset();
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
