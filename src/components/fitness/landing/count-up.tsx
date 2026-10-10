"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CountUp — شمارندهٔ متحرک اثبات اجتماعی (دیرکتیو مالک)
 *
 * مشکل قبلی: با رفرش صفحه اول «۲٬۵۰۰+» (فال‌بک) نمایش داده می‌شد و ناگهان
 * روی عدد واقعی می‌پرید — پرش زشت و بی‌اعتمادکننده.
 *
 * راه‌حل: عدد همیشه از «۰» شروع می‌شود و با انیمیشن نرم (easeOutCubic)
 * در ~۱٫۲ ثانیه به تعداد واقعی کاربران می‌رسد. اگر عدد وسط انیمیشن عوض
 * شود (مثلاً رسیدن پاسخ سرور)، از مقدار فعلیِ نمایش‌داده‌شده به مقدار جدید
 * ادامه می‌دهد — بدون هیچ پرشی.
 *
 * - رندر با رقم فارسی و جداکنندهٔ «٬» (هم‌قالب formatFaCount)
 * - SSR امن: رندر اول «۰» است (سرور و کلاینت یکسان — بدون hydration mismatch)
 * - requestAnimationFrame + توقف در unmount + کاهش حرکت (prefers-reduced-motion)
 */

/** تبدیل عدد به رقم فارسی با جداکنندهٔ هزارگان «٬» */
function formatFa(n: number): string {
  return Math.round(n)
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** easeOutCubic — شروع سریع، نرم‌شدن در انتها (حس «پر شدن» طبیعی) */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function CountUp({
  value,
  duration = 1200,
  suffix = "+",
  className,
}: {
  /** مقدار هدف — وقتی عوض شود از مقدار فعلی به آن انیمیت می‌شود */
  value: number;
  /** مدت انیمیشن (میلی‌ثانیه) */
  duration?: number;
  /** پسوند بعد از عدد (پیش‌فرض «+») */
  suffix?: string;
  className?: string;
}) {
  // مقدار نمایش‌داده‌شده — رندر اول ۰ (SSR و کلاینت یکسان)
  const [display, setDisplay] = useState(0);
  // آخرین مقدار واقعاً نمایش‌داده‌شده — مبدأ انیمیشن بعدی (نه مقدار هدف قبلی)
  const displayRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    // احترام به کاهش حرکت — پرش مستقیم بدون انیمیشن (هم‌زمان در فریم بعدی)
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      displayRef.current = value;
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }

    const from = displayRef.current;
    const delta = value - from;
    if (delta === 0) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const current = from + delta * easeOutCubic(t);
      displayRef.current = current;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayRef.current = value;
        setDisplay(value);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      // در unmount/تغییر هدف: از آخرین مقدار نمایش‌داده‌شده ادامه بده
      cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return (
    <span className={className} suppressHydrationWarning>
      {formatFa(display)}
      {suffix}
    </span>
  );
}
