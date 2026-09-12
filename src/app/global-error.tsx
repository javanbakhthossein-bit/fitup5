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
 * v57: تلاش مجدد خودکار (۳ ثانیه‌ای، تا ۶ بار) + پیام فارسی هم‌خانوادهٔ
 * صفحهٔ دیپلوی — خطاهای گذرای دیپلوی دیگر کاربر را گیر نمی‌اندازد.
 */
const MAX_AUTO_RETRIES = 6;
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

  useEffect(() => {
    if (autoLeft <= 0) return;
    const t = setTimeout(() => {
      setAutoLeft((v) => v - 1);
      resettingRef.current = false;
      doReset();
    }, AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoLeft, doReset]);

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
          <div
            style={{
              width: "64px",
              height: "64px",
              margin: "0 auto 20px",
              borderRadius: "16px",
              background: "linear-gradient(135deg, #f59e0b, #ea580c)",
              color: "#fff",
              fontSize: "32px",
              lineHeight: "64px",
            }}
          >
            ⚠️
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", color: "#0f172a" }}>
            در حال آپدیت فیتاپ هستیم 🚀
          </h2>
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#64748b", lineHeight: "1.8" }}>
            لطفاً چند لحظه بعد مجدداً تلاش کنید — صفحه خودش دوباره تلاش می‌کند.
          </p>
          {autoLeft > 0 ? (
            <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#ea580c", fontWeight: 700 }}>
              ⏳ تلاش مجدد خودکار تا چند لحظه دیگر…
            </p>
          ) : null}
          <button
            onClick={() => {
              resettingRef.current = false;
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
