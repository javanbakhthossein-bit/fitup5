"use client";

import { useEffect } from "react";

/**
 * v57 — بهبودهای سراسری کلاینت (بدون دست‌زدن به منطق صفحات):
 *
 * ۱) GlobalKeyboardFix — کیبورد نباید فرم را بپوشاند (مرورگر درون‌برنامه‌ای
 *    اینستاگرام و مرورگرهای «resizes-visual»): listener سراسری visualViewport
 *    → متغیر CSS ‎--fitup-vvh‎ + اسکرول ورودیِ فعال به مرکز ناحیهٔ دیدنی.
 *    (صفحات auth/onboarding هندلر خودشان را دارند — هم‌پوشانی بی‌ضرر است و
 *     صفحهٔ چت و بقیهٔ صفحات که هندلر ندارند را پوشش می‌دهد.)
 *
 * ۲) DeepLinkAppOpener — لینک‌های پیامکی/نوتیفیکیشنی مثل
 *    ‎https://fittup.ir/?screen=panel&tab=dashboard‎ باید «اپ» را باز کنند، نه
 *    سایت را. وقتی چنین لینکی در مرورگر اندروید باز شد (اپ نصب است ولی
 *    autoVerify شکست خورده — دستگاه‌های بدون سرویس گوگل) یک‌بار بی‌صدا
 *    intent://fitup/open را صدا می‌زنیم؛ اگر اپ نبود، Chrome خودش به
 *    S.browser_fallback_url (همین صفحه) برمی‌گردد و فلگ session جلوی حلقه را
 *    می‌گیرد. فقط برای لینک‌های «داخل-پنل» (panel/tab/renewal/offer) — لینک‌های
 *    محتوایی وبلاگ (?screen=articles و ?article=) عمداً دست‌نخورده می‌مانند تا
 *    ترافیک وبلاگ روی وب بماند (نرخ ثبت‌نام/چک‌اوت — مستندات بازار).
 */
export function ClientEnhancers() {
  // ─── ۱) فیکس سراسری کیبورد (اینستاگرام و بقیهٔ مرورگرهای درون‌برنامه‌ای) ───
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    let timer = 0;
    const applyViewport = () => {
      try {
        document.documentElement.style.setProperty("--fitup-vvh", `${vv.height}px`);
      } catch {}
      // ورودی فعال را وسط ناحیهٔ دیدنی بیاور (تأخیر کوتاه برای جاافتادن کیبورد)
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          const el = document.activeElement;
          if (
            el instanceof HTMLElement &&
            (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
          ) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        } catch {}
      }, 180);
    };
    applyViewport();
    vv.addEventListener("resize", applyViewport);
    vv.addEventListener("scroll", applyViewport);
    return () => {
      window.clearTimeout(timer);
      vv.removeEventListener("resize", applyViewport);
      vv.removeEventListener("scroll", applyViewport);
    };
  }, []);

  // ─── ۲) تلاش بی‌صدای بازکردن اپ برای لینک‌های عمیق پنل ───
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const ua = navigator.userAgent || "";
      const isAndroid = /Android/.test(ua);
      const isNativeApp = /FitUpApp\/|FitUpBazaar\//.test(ua);
      const isStandalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        (navigator as any).standalone === true;
      if (!isAndroid || isNativeApp || isStandalone) return;

      const params = new URLSearchParams(window.location.search);
      const isPanelDeepLink =
        params.get("screen") === "panel" ||
        params.has("tab") ||
        params.has("renewal") ||
        params.has("offer") ||
        params.has("survey");
      if (!isPanelDeepLink) return;

      // فلگ ضد حلقه: بعد از fallback-reload دوباره تلاش نکن (۱۲ ثانیه اعتبار)
      const FLAG = "fitup_deeplink_attempt";
      const now = Date.now();
      const prev = Number(window.sessionStorage.getItem(FLAG) || 0);
      if (prev && now - prev < 12_000) return;
      window.sessionStorage.setItem(FLAG, String(now));

      const enc = encodeURIComponent(window.location.pathname + window.location.search);
      const encAbs = encodeURIComponent(window.location.href);
      const isChrome = /Chrome\/|CriOS\/|EdgA\//.test(ua);
      const target = isChrome
        ? `intent://fitup/open?url=${enc}#Intent;scheme=fitup;S.browser_fallback_url=${encAbs};end`
        : `fitup://open?url=${enc}`;
      // تلاش در تیک بعدی تا رندر اولیه مختل نشود
      const t = window.setTimeout(() => {
        try {
          window.location.href = target;
        } catch {}
      }, 350);
      return () => window.clearTimeout(t);
    } catch {
      // هیچ‌وقت رندر صفحه را نشکن
    }
  }, []);

  return null;
}
