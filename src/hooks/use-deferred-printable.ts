"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ─── v248 — ضدلگ printable مخفی (ممیزی مالک: «مدال برنامه تمرینی/تغذیه/مکمل
 * و پرونده ورزشی با لگ زیاد و فلیکر باز می‌شوند») ───
 *
 * ریشهٔ مشکل: printable کامل (کل برنامه/نسخهٔ آزمایش) به‌صورت position:fixed
 * و visibility:hidden همزمان با mount مودال/ویو رندر می‌شد — روی پلن‌های
 * واقعی تولیدی (تا ~۵۱KB JSON، صدها ردیف جدول) ساختن صدها نود DOM در همان
 * فریمِ باز شدن، ترد اصلی را ~۱ تا ۲ ثانیه بلاک می‌کرد؛ در نتیجه انیمیشن ورود
 * مودال (Radix 200ms) وسط راه می‌خشید و «لگ زیاد + فلیکر» دیده می‌شد —
 * مخصوصاً در WebView اندروید با CPU ضعیف.
 *
 * راه‌حل: نود printable دیگر در فریم باز شدن mount نمی‌شود؛ در idle مرورگر
 * (بعد از رندر و پایان انیمیشن ورود) ساخته می‌شود. توابع دانلود با
 * waitForPrintable() منتظر آماده‌شدن نود می‌مانند — خروجی تصویر/PDF عیناً
 * مثل قبل و سالم است (فقط زمانِ ساخت عقب‌تر و بی‌هزینه است).
 *
 * اعمال‌شده در: programs-view (PlanViewModal — تمرین/تغذیه/مکمل)،
 * workouts-view (PrintableWorkout)، blood-test-view (نسخهٔ آزمایش).
 */
export function useDeferredPrintable() {
  const [mounted, setMounted] = useState(false);
  const mountedRef = useRef(false);
  const resolversRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const run = () => {
      if (mountedRef.current) return;
      mountedRef.current = true;
      setMounted(true);
      const resolvers = resolversRef.current;
      resolversRef.current = [];
      for (const r of resolvers) r();
    };
    let id: number | ReturnType<typeof setTimeout>;
    if (typeof w.requestIdleCallback === "function") {
      id = w.requestIdleCallback(run, { timeout: 2500 });
    } else {
      id = setTimeout(run, 1200);
    }
    return () => {
      if (typeof w.cancelIdleCallback === "function" && typeof id === "number") w.cancelIdleCallback(id);
      else clearTimeout(id as ReturnType<typeof setTimeout>);
    };
  }, []);

  /** منتظر mount شدن نود printable می‌ماند (برای توابع دانلود) */
  const waitForPrintable = useCallback(() => {
    if (mountedRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      resolversRef.current.push(resolve);
    });
  }, []);

  return { printableMounted: mounted, waitForPrintable };
}

/**
 * صبر برای لود کامل تصاویر داخل نود printable قبل از capture
 * (ضد خروجی سفید/ناقص — جایگزین انتظار ثابت ۸۰ms)
 */
export function waitForImagesLoaded(node: HTMLElement, timeoutMs = 1500): Promise<void> {
  const imgs = Array.from(node.querySelectorAll("img"));
  const pending = imgs.filter((i) => !i.complete);
  if (pending.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let left = pending.length;
    const done = () => {
      if (--left <= 0) resolve();
    };
    for (const img of pending) {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }
    setTimeout(resolve, timeoutMs);
  });
}
