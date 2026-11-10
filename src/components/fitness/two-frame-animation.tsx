"use client";

/**
 * v183 — انیمیشن دوفریمی فیتاپ
 *
 * دو فریم استاتیک (شروع/پایان حرکت) با crossfade بی‌نهایت → حس «متحرک» بدون
 * GIF/ویدیو/کتابخانه — فوق‌سبک (≈۱۵KB برای هر حرکت) و بدون مشکل عملکرد.
 * دیرکتیو مالک: حرکات چالش‌ها باید «زنده» دیده شوند — این کامپوننت همان است.
 *
 * فایل‌ها: /animations/challenges/<animKey>-0.webp و <animKey>-1.webp
 * سرعت با interval قابل تنظیم؛ prefers-reduced-motion → فریم اول ثابت.
 */
import { useEffect, useMemo, useState } from "react";

export function animFileBase(animKey: string): string {
  return animKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function animSrc(animKey: string, frame: 0 | 1): string {
  return `/animations/challenges/${animFileBase(animKey)}-${frame}.webp`;
}

export function TwoFrameAnimation({
  animKey,
  alt,
  intervalMs = 650,
  className = "",
  objectFit = "contain",
}: {
  animKey: string;
  alt: string;
  /** فاصلهٔ تعویض فریم (ms) */
  intervalMs?: number;
  className?: string;
  objectFit?: "contain" | "cover";
}) {
  const src0 = useMemo(() => animSrc(animKey, 0), [animKey]);
  const src1 = useMemo(() => animSrc(animKey, 1), [animKey]);
  // هر دو فریم از اول preload — بدون پرش/چشمک در اولین تعویض
  const [loaded, setLoaded] = useState(false);
  const [showB, setShowB] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all(
      [src0, src1].map(
        (s) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = s;
          })
      )
    ).then(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [src0, src1]);

  // prefers-reduced-motion → فقط فریم اول (بدون interval)
  // init در useState initializer (SSR-safe) — effect فقط گوش می‌دهد
  const [reduceMotion, setReduceMotion] = useState(() => {
    try {
      return typeof window !== "undefined" && !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const on = () => setReduceMotion(mq.matches);
      mq.addEventListener?.("change", on);
      return () => mq.removeEventListener?.("change", on);
    } catch {}
  }, []);

  useEffect(() => {
    if (!loaded || reduceMotion) return;
    const t = setInterval(() => setShowB((v) => !v), Math.max(180, intervalMs));
    return () => clearInterval(t);
  }, [loaded, reduceMotion, intervalMs]);

  const fit = objectFit === "cover" ? "object-cover" : "object-contain";

  return (
    <div className={`relative overflow-hidden ${className}`} aria-label={alt} role="img">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src0}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full ${fit} transition-opacity duration-200 ${showB && loaded ? "opacity-0" : "opacity-100"}`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src1}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full ${fit} transition-opacity duration-200 ${showB && loaded ? "opacity-100" : "opacity-0"}`}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      )}
    </div>
  );
}
