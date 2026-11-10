"use client";

import { useEffect, useRef, useState } from "react";

/**
 * v220 — لایهٔ برق طلایی (gold-shimmer) با گیتِ دید.
 *
 * مشکل (گزارش پرفورمنس اسکرول v220): ۵ انیمیشن «gold-shimmer infinite» روی
 * لندینگ همیشه فعال بودند — حتی وقتی سکشن بیرون از viewport بود — و یکی از
 * آن‌ها داخل لایهٔ blur-2xl بود؛ مجموعشان compositor دائمی می‌ساخت و در
 * اسکرول اولیهٔ موبایل جانک می‌داد.
 *
 * راه‌حل: انیمیشن فقط وقتی اجرا می‌شود که عنصر واقعاً در دید است
 * (IntersectionObserver با rootMargin)؛ و اختیاری hoverGate: فقط هنگام
 * hover روی کارت والد (برای کارت‌های پرمیوم PricingSection).
 * اگر مرورگر IntersectionObserver نداشت → انیمیشن همیشه (رفتار قدیمی).
 */
export function GoldShimmer({
  className = "absolute inset-0",
  from = "rgba(255,255,255,0.15)",
  duration = 4,
  hoverGate = false,
}: {
  className?: string;
  from?: string;
  duration?: number;
  hoverGate?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  // hoverGate=false → همیشه «فعال» از نظر hover؛ hoverGate=true → فقط هنگام hover والد
  const [hovered, setHovered] = useState(!hoverGate);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // بدون setState همگام در effect — قاعدهٔ lint (الگوی Promise.resolve در کل ریپو)
      Promise.resolve().then(() => setInView(true));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!hoverGate) return;
    // والد نباید pointer-events-none باشد — کارت میزبان است
    const host = ref.current?.parentElement;
    if (!host) return;
    const on = () => setHovered(true);
    const off = () => setHovered(false);
    host.addEventListener("mouseenter", on);
    host.addEventListener("mouseleave", off);
    return () => {
      host.removeEventListener("mouseenter", on);
      host.removeEventListener("mouseleave", off);
    };
  }, [hoverGate]);

  const active = inView && hovered;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
      style={{
        background: `linear-gradient(110deg, transparent 30%, ${from} 50%, transparent 70%)`,
        backgroundSize: "200% 100%",
        animation: active ? `gold-shimmer ${duration}s infinite linear` : undefined,
      }}
    />
  );
}
