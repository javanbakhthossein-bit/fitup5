"use client";
import { useEffect } from "react";
import { isNoiseError } from "@/lib/fitness/error-noise";
import {
  isChunkFailure,
  maybeReloadForChunkFailure,
  reportClientError,
} from "@/lib/fitness/client-error-report";

/**
 * v228 — ورودی بافر خطاهای پیش‌از‌هیدریشن (گارد سرِ head در layout.tsx):
 * خطاهایی که قبل از mount شدن همین کامپوننت رخ می‌دهند (مثلاً شکست chunk بوت
 * روی شبکهٔ بد، یا خطای اسکریپت شخص‌ثالث قبل از هیدریشن) قبلاً هیچ‌وقت به
 * لاگ مدیر نمی‌رسیدند — Clarity می‌دید ولی ما نه. گارد زودهنگام آنها را در
 * window.__fitupEarlyErrs بافر می‌کند و اینجا در اولین mount شسته می‌شوند.
 */
interface EarlyErrorEntry {
  kind?: string;
  message?: unknown;
  stack?: unknown;
  filename?: unknown;
  lineno?: unknown;
  colno?: unknown;
  hasErr?: unknown;
}

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

    // ─── v228 — پردازنده‌های مشترک: هم listenerهای زنده، هم شستشوی بافر پیش‌هیدریشن ──
    const processErrorInfo = (info: {
      message: string;
      stack: string;
      filename?: string;
      lineno?: number;
      colno?: number;
      hasError: boolean;
      /** v228 — شیء Error اصلی (مسیر زنده) برای حفظ stack/digest واقعی */
      error?: Error;
    }): void => {
      try {
        // نویز مرورگر اینستاگرام (cross-origin / iabjs) را قبل از ارسال رد کن
        if (
          isNoiseError({
            message: info.message,
            stack: info.stack,
            filename: info.filename,
            lineno: info.lineno,
            hasErrorObject: info.hasError,
          })
        ) {
          return;
        }
        // شکست chunk → گزارش با اثرانگوش مشترک + ریکاوری reload
        if (isChunkFailure(info.message)) {
          handlePossibleChunkFailure(info.message);
          return;
        }
        reportClientError("window-error", info.error ?? new Error(info.message), {
          dedupeKey: info.message,
          context: {
            filename: info.filename,
            lineno: info.lineno,
            colno: info.colno,
          },
        });
      } catch {}
    };

    const processRejectionInfo = (
      rawMessage: string,
      stack: string,
      hasStack: boolean
    ): void => {
      try {
        // پیام خام reason — بررسی نویز باید قبل از افزودن پیشوند انجام شود
        if (
          isNoiseError({
            message: rawMessage,
            stack,
            hasErrorObject: hasStack,
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

    // ─── v228 — شستشوی بافر خطاهای پیش‌از‌هیدریشن (اولین کار useEffect) ──
    try {
      const w = window as unknown as {
        __fitupEarlyErrs?: EarlyErrorEntry[];
        __fitupEarlyErrsOpen?: boolean;
      };
      const early = w.__fitupEarlyErrs;
      if (Array.isArray(early) && early.length > 0) {
        for (const e of early) {
          try {
            if (!e) continue;
            const message = typeof e.message === "string" ? e.message : String(e.message ?? "");
            if (!message) continue;
            const stack = typeof e.stack === "string" ? e.stack : "";
            if (e.kind === "rejection") {
              processRejectionInfo(message, stack, !!e.hasErr);
            } else {
              processErrorInfo({
                message,
                stack,
                filename:
                  typeof e.filename === "string" && e.filename ? e.filename : undefined,
                lineno: typeof e.lineno === "number" ? e.lineno : undefined,
                colno: typeof e.colno === "number" ? e.colno : undefined,
                hasError: !!e.hasErr,
              });
            }
          } catch {}
        }
        early.length = 0;
      }
      // بافر بسته شد — از این‌جا listenerهای زندهٔ زیر مسئول‌اند (بدون دوباره‌گویی)
      w.__fitupEarlyErrsOpen = false;
    } catch {}

    const errorHandler = (event: ErrorEvent) => {
      try {
        const { message, filename, lineno, colno, error } = event;
        const stack = error?.stack || `${filename}:${lineno}:${colno}`;
        processErrorInfo({
          message,
          stack,
          filename,
          lineno,
          colno,
          hasError: !!error,
          error: error ?? undefined,
        });
      } catch {}
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      try {
        const reason = event.reason;
        const rawMessage: string = reason?.message || String(reason);
        const stack = reason?.stack || "";
        processRejectionInfo(rawMessage, stack, !!reason?.stack);
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
