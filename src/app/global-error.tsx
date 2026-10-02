"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isChunkFailure,
  maybeReloadForChunkFailure,
  reportClientError,
} from "@/lib/fitness/client-error-report";

/**
 * global-error.tsx — آخرین لایه دفاعی.
 * فقط وقتی فعال می‌شود که خود layout ریشه هم crash کند؛ چون در این حالت
 * هیچ تم/فونتی در دسترس نیست، استایل‌ها inline هستند.
 *
 * v167 — هم‌راستا با error.tsx (دیرکتیو مالک: هیچ صفحهٔ خطایی نباید فلش
 * شود): در تمام فاز تلاش خودکار (۱۰ تلاش ≈ ۳۰ ثانیه) فقط لوگوی برند با
 * اسپینر آرام نمایش داده می‌شود — کاربر هیچ کارت/متن خطایی نمی‌بیند.
 * فقط بعد از اتمام همهٔ تلاش‌ها کارت آرام بالا می‌آید.
 */
const MAX_AUTO_RETRIES = 10;
const AUTO_RETRY_DELAY_MS = 3_000;

/**
 * v59 — گزارش کرش به سرور (هم‌خانوادهٔ error.tsx) — ریشه‌یابی خطاهای
 * «فقط روی بعضی دستگاه‌ها» از تب «لاگ خطاها»ی پنل مدیریت ممکن می‌شود.
 * v67 — با دِداپ مشترک کلاینت (اثرانگوش = پیام خام) تا چند گزارشگرِ یک حادثه
 * فقط یک رکورد بسازند.
 */
function reportErrorToServer(error: Error & { digest?: string }) {
  reportClientError("global-error", error, {
    dedupeKey: error?.message || "Unknown root crash",
  });
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[global-error]", error);
  // v59 — ارسال به لاگ سرور
  useEffect(() => {
    reportErrorToServer(error);
  }, []);
  const [autoLeft, setAutoLeft] = useState(MAX_AUTO_RETRIES);
  const resettingRef = useRef(false);

  const doReset = useCallback(() => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    reset();
  }, [reset]);

  // ─── v58 — تشخیص «chunk قدیمی بعد از دیپلوی» — reset() ترمیمش نمی‌کند؛
  // v67 — گارد reload مشترک (۶۰ ثانیه) از ماژول مشترک
  const looksStaleChunk = isChunkFailure(`${error?.message ?? ""}`);
  const staleReloadedRef = useRef(false);
  useEffect(() => {
    if (!looksStaleChunk || staleReloadedRef.current) return;
    staleReloadedRef.current = true;
    maybeReloadForChunkFailure();
  }, [looksStaleChunk]);

  // تلاش اول سریع‌تر (۸۰۰ms) تا فلش‌های گذرای اولین اجرا قبل از دیده‌شدن ترمیم شوند
  useEffect(() => {
    if (autoLeft <= 0) return;
    const delay = autoLeft === MAX_AUTO_RETRIES ? 800 : AUTO_RETRY_DELAY_MS;
    const t = setTimeout(() => {
      setAutoLeft((v) => v - 1);
      resettingRef.current = false;
      doReset();
    }, delay);
    return () => clearTimeout(t);
  }, [autoLeft, doReset]);

  const logo = (
    <img
      src="/fitup-logo.png"
      alt="فیتاپ"
      width={96}
      height={96}
      style={{
        width: "96px",
        height: "96px",
        borderRadius: "24px",
        display: "block",
        margin: "0 auto 16px",
        boxShadow: "0 12px 36px -8px rgba(249,115,22,0.35)",
      }}
    />
  );

  // ─── v167 — فاز تلاش خودکار: فقط لوگوی برند + اسپینر (صفر متن خطا) ───
  if (autoLeft > 0) {
    return (
      <html lang="fa" dir="rtl">
        <body
          aria-busy="true"
          style={{
            margin: 0,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            fontFamily:
              "system-ui, -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif",
          }}
        >
          {logo}
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              border: "3px solid #fed7aa",
              borderTopColor: "#f97316",
              animation: "fitup-spin 0.9s linear infinite",
            }}
          />
          <style>{`@keyframes fitup-spin { to { transform: rotate(360deg); } }`}</style>
        </body>
      </html>
    );
  }

  // ─── همهٔ تلاش‌ها شکست خوردند → کارت آرام ───
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "400px",
            width: "100%",
            textAlign: "center",
            border: "1px solid #fed7aa",
            borderRadius: "24px",
            padding: "32px",
          }}
        >
          {logo}
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", color: "#0f172a" }}>
            بارگذاری صفحه کامل نشد
          </h2>
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#64748b", lineHeight: "1.8" }}>
            چند بار خودکار تلاش کردیم اما نشد — لطفاً دوباره تلاش کنید.
          </p>
          <button
            onClick={() => {
              resettingRef.current = false;
              setAutoLeft(MAX_AUTO_RETRIES); // دور جدید تلاش خودکار در پشت اسپلش
              doReset();
            }}
            style={{
              background: "linear-gradient(90deg, #f59e0b, #ea580c)",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              padding: "12px 28px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            تلاش مجدد
          </button>
        </div>
      </body>
    </html>
  );
}
