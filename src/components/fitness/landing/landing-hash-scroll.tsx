"use client";

import { useEffect } from "react";

/**
 * ─── v123 — پرش به سکشن مقصد وقتی با هش به صفحه اصلی می‌آییم (درخواست مالک) ───
 *
 * مشکل: بردکرامب صفحات SSR (مثلاً «رشته‌های ورزشی» در /sport/<slug> به
 * /#disciplines) و CTAهای ابزار (/#pricing) با بارگذاری کامل صفحه به `/`
 * می‌آیند. اسکرول انکر بومی مرورگر فقط وقتی کار می‌کند که سکشن مقصد «در
 * HTML اولیه» باشد؛ برای کاربر لاگین‌شده (مرورگر/PWA/اپ) SSR صفحهٔ اصلی
 * را به پنل/auth حل می‌کند و لندینگ بعداً سمت کلاینت مونت می‌شود → هش
 * هیچ‌وقت پیدا نمی‌شود و کاربر بالای صفحه می‌ماند (گزارش مالک).
 * ضمناً حتی برای مهمان، لود دیرهنگام عکس‌ها/فونت‌ها layout را جابه‌جا
 * می‌کند و اسکرول اولیه از مقصد جا می‌ماند.
 *
 * راه‌حل: این کامپوننت داخل LandingPage مونت می‌شود؛ بعد از مونت، هش URL
 * را می‌خواند و مقصد را با آفست هدر ثابت (۸۰px) اسکرول می‌کند — با چند
 * تلاش فاصله‌دار تا جابه‌جایی layout هم جبران شود. اگر کاربر خودش اسکرول
 * کند، اصلاح متوقف می‌شود. هر هش فقط یک‌بار در هر بارگذاری صفحه اجرا
 * می‌شود تا مونت‌های بعدیِ SPA (برگشت از پنل به لندینگ) دوباره نپرد.
 */

/** سکشن‌های دارای id در لندینگ (با sections/*.tsx هماهنگ نگه داشته شود) */
const LANDING_SECTION_IDS = new Set([
  "features",
  "tools",
  "disciplines",
  "ai-coach",
  "sample-program",
  "pricing",
  "articles",
  "install",
  "faq",
]);

/** آفست هدر ثابت لندینگ (LandingNav ارتفاع ۶۴px) + فاصلهٔ تنفسی */
const SCROLL_OFFSET = 80;

/** هش‌هایی که در این بارگذاری صفحه قبلاً پردازش شده‌اند (ماژول‌سطحی) */
const processedHashes = new Set<string>();

function scrollToHash(hash: string): boolean {
  const id = decodeURIComponent(hash.slice(1));
  if (!id || !LANDING_SECTION_IDS.has(id)) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
  window.scrollTo({ top: Math.max(0, top), behavior: "instant" as ScrollBehavior });
  return true;
}

export function LandingHashScroll() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    // هر هش فقط یک‌بار در هر بارگذاری صفحه (مونت‌های بعدی SPA نپرند)
    if (processedHashes.has(hash)) return;
    processedHashes.add(hash);

    let cancelled = false;
    let userInterrupted = false;
    // اولین اسکرول دستی کاربر → اصلاح‌های بعدی متوقف (نباید با کاربر بجنگیم)
    const markInterrupt = () => {
      userInterrupted = true;
    };
    window.addEventListener("wheel", markInterrupt, { passive: true, once: true });
    window.addEventListener("touchmove", markInterrupt, { passive: true, once: true });
    window.addEventListener("keydown", markInterrupt, { once: true });

    // تلاش اول بلافاصله + چند تلاش فاصله‌دار برای جبران لود عکس/فونت/انیمیشن
    const timers = [0, 150, 400, 900, 1600].map((delay) =>
      window.setTimeout(() => {
        if (cancelled || userInterrupted) return;
        scrollToHash(hash);
      }, delay)
    );

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("wheel", markInterrupt);
      window.removeEventListener("touchmove", markInterrupt);
      window.removeEventListener("keydown", markInterrupt);
    };
  }, []);

  return null;
}
