"use client";
import { useEffect } from "react";
import { isNoiseError } from "@/lib/fitness/error-noise";
import {
  isChunkFailure,
  maybeReloadForChunkFailure,
  reportClientError,
} from "@/lib/fitness/client-error-report";

/**
 * Captures client-side errors and sends them to the error logging API.
 * - window.onerror for uncaught errors
 * - window.onunhandledrejection for unhandled promise rejections
 * نویز اسکریپت‌های تزریقی مرورگر داخلی اینستاگرام (Script error / iabjs://…)
 * قبل از ارسال کنار گذاشته می‌شود — جزئیات در src/lib/fitness/error-noise.ts
 *
 * ─── v67 — ریشه‌یابی «Loading chunk failed» لاگ مالک ───
 *  ۱) تلاش مجدد خودکار اسکریپت‌های /_next/static/ که با error روبرو شده‌اند
 *     (خطای موقت شبکه/پروکسی) — قبل از آنکه Promise وب‌پک reject شود، یک
 *     تگ تازه با cache-buster دوباره درخواست می‌دهد؛ اگر فایل زنده باشد،
 *     chunk ثبت می‌شود و کاربر هرگز خطا نمی‌بیند.
 *  ۲) نگهبان جهانی شکست chunk: حتی خطاهایی که به مرز خطای React نمی‌رسند
 *     (dynamic import در event handler → unhandledrejection) هم ریکاوری
 *     reload می‌گیرند (گارد مشترک ۶۰ ثانیه‌ای).
 *  ۳) دِداپ سمت کلاینت (reportClientError) — پایان «یک خطا = چند رکورد».
 */
export function ErrorCapture() {
  useEffect(() => {
    // ─── v67-۱: تلاش مجدد اسکریپت‌های شکست‌خوردهٔ static ───
    // رویداد error المان‌ها bubble نمی‌کند ولی فاز capture از window می‌گذرد.
    const retriedScripts = new WeakSet<Element>();
    const scriptErrorHandler = (event: Event) => {
      try {
        const el = event.target as HTMLScriptElement | null;
        if (!el || el.tagName !== "SCRIPT") return;
        const src = el.getAttribute("src") || "";
        if (!src.includes("/_next/static/")) return;
        if (retriedScripts.has(el)) return;
        retriedScripts.add(el);
        // یک تلاش مجدد با پارامتر cache-buster — فایل‌های static اپِ ما
        // immutable و content-hash دار هستند؛ پارامتر فقط کش میانی را دور می‌زند.
        setTimeout(() => {
          try {
            const retry = document.createElement("script");
            retry.src =
              src + (src.includes("?") ? "&" : "?") + "fitup-retry=1";
            document.head.appendChild(retry);
          } catch {}
        }, 200);
      } catch {}
    };

    // ─── v67-۲: نگهبان جهانی شکست chunk (خارج از مرز خطای React) ───
    const handlePossibleChunkFailure = (message: string): void => {
      if (isChunkFailure(message)) {
        // گزارش از مسیر window با همان اثرانگوشِ مرز خطا (پیام خام) —
        // اگر مرز خطا هم گزارش کند، دِداپ مشترک دومی را حذف می‌کند.
        reportClientError("chunk-watchdog", new Error(message), {
          dedupeKey: message,
        });
        maybeReloadForChunkFailure();
      }
    };

    const errorHandler = (event: ErrorEvent) => {
      try {
        const { message, filename, lineno, colno, error } = event;
        const stack = error?.stack || `${filename}:${lineno}:${colno}`;
        // نویز مرورگر اینستاگرام (cross-origin / iabjs) را قبل از ارسال رد کن
        if (
          isNoiseError({
            message,
            stack,
            filename,
            lineno,
            hasErrorObject: !!error,
          })
        ) {
          return;
        }
        // شکست chunk → گزارش با اثرانگوش مشترک + ریکاوری reload
        if (isChunkFailure(message)) {
          handlePossibleChunkFailure(message);
          return;
        }
        reportClientError("window-error", error ?? new Error(message), {
          dedupeKey: message,
          context: { filename, lineno, colno },
        });
      } catch {}
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      try {
        const reason = event.reason;
        // پیام خام reason — بررسی نویز باید قبل از افزودن پیشوند انجام شود
        const rawMessage: string = reason?.message || String(reason);
        const stack = reason?.stack || "";
        if (
          isNoiseError({
            message: rawMessage,
            stack,
            hasErrorObject: !!reason?.stack,
          })
        ) {
          return;
        }
        if (isChunkFailure(rawMessage)) {
          handlePossibleChunkFailure(rawMessage);
          return;
        }
        reportClientError("unhandled-rejection", new Error(rawMessage), {
          dedupeKey: `Unhandled rejection: ${rawMessage}`,
        });
      } catch {}
    };

    window.addEventListener("error", errorHandler);
    // فاز capture برای رویداد error المان‌ها (تگ script) ضروری است
    window.addEventListener("error", scriptErrorHandler, true);
    window.addEventListener("unhandledrejection", rejectionHandler);
    return () => {
      window.removeEventListener("error", errorHandler);
      window.removeEventListener("error", scriptErrorHandler, true);
      window.removeEventListener("unhandledrejection", rejectionHandler);
    };
  }, []);
  return null;
}
