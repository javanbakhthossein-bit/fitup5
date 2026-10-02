"use client";

import { useEffect } from "react";

/**
 * KeyboardFix — لایهٔ سراسری «ضدپوشش‌شدن ورودی‌ها توسط کیبورد نرم» (v89 → v91)
 *
 * ─── ممیزی کامل باگ (گزارش تکراری مالک: مرورگر درون‌برنامه‌ای اینستاگرام) ───
 * علائم: با باز شدن کیبورد، صفحه بالا نمی‌آید؛ ورودی فعال (کد OTP، وزن هدف و…)
 * زیر کیبورد می‌ماند. در کروم/iOS سالم است.
 *
 * لایه‌های قبلی (بررسی شد — هر دو سالم ولی ناکافی):
 *  ۱) layout.tsx → viewport.interactiveWidget = "resizes-content"
 *     فقط در کروم/اندروید ۱۰۸+ و WebViewهای مدرن اعمال می‌شود؛ WebView
 *     اینستاگرام (adjustPan/adjustNothing) آن را نادیده می‌گیرد.
 *  ۲) auth-screen (v50) و onboarding-screen (v56) → ارتفاع ریشه = visualViewport
 *     + scrollIntoView روی رویداد «resize».
 *     شکاف اصلی: در WebView اینستاگرام هنگام باز شدن کیبورد «هیچ» رویدادی
 *     (resize/scroll/visibilitychange) به جاوااسکریپت نمی‌رسد — window.innerHeight
 *     و visualViewport.height هر دو ثابت می‌مانند → هیچ‌کدام از لایه‌های بالا
 *     هرگز فعال نمی‌شوند و ورودی زیر کیبورد می‌ماند.
 *
 * ─── راه‌حل این ماژول: واکنش به focusin (تنها سیگنال تضمینی) ───
 *  ۱) فوکوس روی هر input/textarea/contentEditable → بازرسی‌های زمان‌بندی‌شده
 *     (۲۲۰/۵۰۰/۹۰۰ms) برای جاافتادن کامل انیمیشن کیبورد.
 *  ۲) اگر visualViewport کیبورد را گزارش کرد (overlap ≥ ۱۲۰px = کروم/iOS/WebView
 *     مدرن): فقط در صورت پوشیده‌بودن، scrollIntoView وسط ناحیهٔ دیدنی.
 *  ۳) اگر هیچ رویدادی نیامد (WebView لجبار — حالت اینستاگرام): «حالت پیش‌خوان» —
 *     به نزدیک‌ترین اسکرولرِ والد پدینگ پایین ≈ ۴۰٪ ارتفاع اضافه می‌کنیم؛
 *     جابه‌جایی ورودی را خودِ pan بومی انجام می‌دهد.
 *  ۴) drift آی‌او‌اس (بازماندهٔ پن بالا آمدن layout، visualViewport.offsetTop > ۰)
 *     با window.scrollTo(0,0) اصلاح می‌شود.
 *
 * ─── v91 — دو فیکس جدید (گزارش مالک) ───
 *  A) «لوگو و متن فیتاپ در OTP زیر بخش وارد کردن کد می‌ماند»:
 *     ریشه = جابه‌جایی دوگانه. pan بومی پنجره را بالا می‌برد و scrollIntoView ما
 *     «به‌اضافهٔ آن» window/سند را هم اسکرول می‌کرد → ورودی تا نزدیک بالای صفحه
 *     می‌رفت و هدر برند (لوگو + فیتاپ) که در جریان عادی بالای ورودی است، بصری
 *     «زیر» ورودی می‌افتاد. فیکس: در حالت لجبار هرگز window را اسکرول نمی‌کنیم —
 *     فقط اسکرولرهای داخلی را به‌صورت حداقلی جابه‌جا می‌کنیم و هر اسکرول JS
 *     باقی‌مانده روی window را همان لحظه صفر می‌کنیم (pan بومی کافی است).
 *  B) «با بستن کیبورد صفحه بالا می‌ماند و برنمی‌گردد»:
 *     موقعیت اسکرول window و اسکرولرهای والد «قبل از باز شدن کیبورد» ذخیره و
 *     با بسته شدن آن (blur یا برگشتن visualViewport) دقیقاً بازگردانی می‌شود —
 *     با چند تلاش تأخیری تا چیدمانِ در-حال-جای‌گرفتن هم جا بیفتد.
 *
 * نکته‌ها:
 *  - فقط روی دستگاه‌های لمسی (pointer: coarse) فعال است — دسکتاپ دست‌نخورده.
 *  - ورودی‌های readOnly (نمایشی) نادیده گرفته می‌شوند.
 *  - با بسته شدن کیبورد همه‌چیز دقیقاً به جای قبل برمی‌گردد.
 *  - v112: صفحهٔ ورود/OTP (auth-screen) ماشین‌حالت کیبورد اختصاصی خودش را
 *    دارد؛ هر ورودی/رویداد متعلق به آن صفحه (data-auth-screen) اینجا
 *    «به‌کلردست کشیده می‌شود» تا دو مکانیزم با هم نپنگرند (پن/اسکرول دوگانه
 *    و بازگردانی ناسازگار — علت پرش‌های صفحهٔ OTP). بقیهٔ صفحه‌ها بدون تغییر.
 */
export function KeyboardFix() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // فقط دستگاه‌های لمسی — در دسکتاپ کیبورد نرم نداریم و پدینگ مزاحم می‌شد
    const coarse = window.matchMedia?.("(pointer: coarse)");
    if (coarse && !coarse.matches) return;

    // ─── v112 — گارد «صفحهٔ auth خودش را مدیریت می‌کند» ───
    // auth-screen (v112) ماشین‌حالت کیبورد یکپارچهٔ خودش را دارد؛ اگر عنصر
    // داده‌شده داخل صفحهٔ auth باشد (data-auth-screen)، این لایه هیچ
    // اسکرول/پدینگ/بازگردانی‌ای اعمال نمی‌کند تا با آن ماشین‌حالت نپنگرد.
    const insideAuthScreen = (el: Element | null): boolean => {
      try {
        return !!el && el.closest("[data-auth-screen]") != null;
      } catch {
        return false;
      }
    };

    const KEYBOARD_MIN_OVERLAP = 120; // px — آستانهٔ تشخیص «کیبورد باز است»
    let padded: HTMLElement[] = [];
    const prevPad = new WeakMap<HTMLElement, string>();

    // ─── v91 — موقعیت اسکرول «قبل از کیبورد» برای بازگردانی هنگام بسته شدن ───
    const savedScroll = new Map<HTMLElement, number>();
    let savedWindowY = 0;
    let scrollSaved = false;
    let restoreTimers: number[] = [];

    const vv = () => window.visualViewport;

    const isTextInput = (el: Element | null): el is HTMLElement =>
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        (el as HTMLElement).isContentEditable === true);

    /** میزان پوشش کیبورد = فاصلهٔ پایین ناحیهٔ دیدنی تا پایین پنجرهٔ layout */
    const overlapNow = (): number => {
      const v = vv();
      if (!v) return 0;
      return Math.max(0, window.innerHeight - (v.height + v.offsetTop));
    };

    /** پایین‌ترین نقطهٔ ناحیهٔ دیدنی واقعی (روی صفحه) */
    const visibleBottom = (): number => {
      const v = vv();
      return v ? v.height + v.offsetTop : window.innerHeight;
    };

    /** اسکرولرهای واقعیِ بالادستی (حداکثر ۲) — برای شبیه‌سازی فضای کیبورد
     *  نکته: شرط فقط «توانایی اسکرول» است (overflow:auto/scroll) — نه «در حال
     *  حاضر سرریز دارد». در حالت لجبار اسکرولر دقیقاً هم‌اندازهٔ محتواست و
     *  همین ما باید به آن پدینگ بدهیم تا اسکرول‌پذیر شود. */
    const findScrollParents = (el: HTMLElement): HTMLElement[] => {
      const found: HTMLElement[] = [];
      let node: HTMLElement | null = el.parentElement;
      while (node && found.length < 2) {
        const cs = window.getComputedStyle(node);
        const oy = cs.overflowY;
        if (oy === "auto" || oy === "scroll" || oy === "overlay") {
          found.push(node);
        }
        node = node.parentElement;
      }
      return found;
    };

    /** ذخیرهٔ موقعیت اسکرول فعلی (فقط یک‌بار در هر «باز شدن کیبورد») */
    const saveScroll = (el: HTMLElement) => {
      if (scrollSaved) return;
      scrollSaved = true;
      savedScroll.clear();
      for (const t of findScrollParents(el)) savedScroll.set(t, t.scrollTop);
      savedWindowY = window.scrollY || window.pageYOffset || 0;
    };

    /** v91-B — بازگردانی دقیق موقعیت‌های ذخیره‌شده (با تلاش تأخیری برای چیدمانِ
     *  در-حال-جای‌گرفتن بعد از بسته شدن کیبورد) */
    const restoreScroll = () => {
      if (!scrollSaved) return;
      const apply = () => {
        savedScroll.forEach((top, el) => {
          if (Math.abs(el.scrollTop - top) > 1) {
            try {
              el.scrollTop = top;
            } catch {
              // noop
            }
          }
        });
        if (Math.abs((window.scrollY || window.pageYOffset || 0) - savedWindowY) > 1) {
          try {
            window.scrollTo(0, savedWindowY);
          } catch {
            // noop
          }
        }
      };
      apply();
      for (const d of [220, 600]) {
        restoreTimers.push(window.setTimeout(apply, d));
      }
      // دورهٔ بازشدن بعدی باید موقعیت تازه ذخیره کند
      window.setTimeout(() => {
        scrollSaved = false;
      }, 850);
    };

    /** اضافه‌کردن پدینگ پایین ≈ ۴۰٪ ارتفاع — فضایی که کیبورد اشغال می‌کند */
    const applyPadding = (el: HTMLElement) => {
      removePadding();
      const targets = findScrollParents(el);
      if (targets.length === 0 && document.body) targets.push(document.body);
      const pad = `${Math.round(Math.min(320, Math.max(180, window.innerHeight * 0.4)))}px`;
      for (const t of targets) {
        prevPad.set(t, t.style.paddingBottom || "");
        t.style.paddingBottom = pad;
        padded.push(t);
      }
    };

    const removePadding = () => {
      for (const t of padded) {
        t.style.paddingBottom = prevPad.get(t) || "";
      }
      padded = [];
    };

    /** ورودی فعال را وسط ناحیهٔ دیدنی بیاور (force = حتی اگر «طبق محاسبه» دیده می‌شود) */
    const ensureVisible = (el: HTMLElement, smooth: boolean, force = false) => {
      try {
        const rect = el.getBoundingClientRect();
        const covered =
          rect.bottom > visibleBottom() - 8 || rect.top < -8;
        if (force || covered) {
          el.scrollIntoView({
            block: "center",
            behavior: smooth ? "smooth" : "auto",
          });
        }
      } catch {
        // noop — بعضی WebViewها scrollIntoView با گزینه را پشتیبانی نمی‌کنند
      }
    };

    /** v91-A — جابه‌جایی «حداقلی و فقط داخلی» برای WebView لجبار:
     *  • window هرگز اسکرول نمی‌شود (pan بومی کافی است؛ اسکرول JS روی سند،
     *    جابه‌جایی را دوبرابر و لوگو را زیر ورودی می‌انداخت)
     *  • اسکرولرهای overflow دارِ داخلی فقط به اندازهٔ «خارج شدن از پوشش»
     *    جابه‌جا می‌شوند — نه وسط‌چین forced
     *  • هر اسکرول JS باقی‌مانده روی window از راندهای قبلی صفر می‌شود */
    const stubbornEnsureVisible = (el: HTMLElement) => {
      for (const sp of findScrollParents(el)) {
        try {
          const r = el.getBoundingClientRect();
          const box = sp.getBoundingClientRect();
          if (r.bottom + 8 > box.bottom) {
            sp.scrollTop += r.bottom + 8 - box.bottom;
          } else if (r.top - 8 < box.top) {
            sp.scrollTop -= box.top - (r.top - 8);
          }
        } catch {
          // noop
        }
      }
      if ((window.scrollY || window.pageYOffset || 0) !== 0) {
        try {
          window.scrollTo(0, 0);
        } catch {
          // noop
        }
      }
    };

    /** اصلاح drift آی‌او‌اس — بازماندهٔ پن خودکار مرورگر هنگام کیبورد */
    const fixIosDrift = () => {
      const v = vv();
      if (v && v.offsetTop > 1 && overlapNow() < 40) {
        try {
          window.scrollTo(0, 0);
        } catch {
          // noop
        }
      }
    };

    const cleanupTimers: number[] = [];
    // آیا در جریان فعلی کیبورد باز است؟ (برای جابجایی فوکوس بین ورودی‌ها با کیبورد باز)
    let kbActive = false;

    /** v91-B — بستن کامل جلسهٔ کیبورد: پاک‌سازی پدینگ + بازگردانی اسکرول */
    const closeKeyboard = () => {
      kbActive = false;
      removePadding();
      restoreScroll();
    };

    const onFocusIn = (e: FocusEvent) => {
      // v112 — ورودی/رویداد متعلق به صفحهٔ auth است → کاملاً بی‌اثر
      // (ماشین‌حالت خودِ auth-screen اسکرول/پدینگ/بازگردانی را انجام می‌دهد)
      if (insideAuthScreen(e.target as Element) || insideAuthScreen(document.activeElement)) return;
      const t = e.target;
      if (!isTextInput(t as Element) || !(t instanceof HTMLElement)) return;
      const el = t as HTMLInputElement;
      if (el.readOnly) return;

      // v91-B — خط پایهٔ اسکرول «قبل از هر جابه‌جایی» ذخیره شود تا با بسته شدن
      // کیبورد صفحه دقیقاً به جای اولش برگردد (شکایت مالک: صفحه بالا می‌ماند)
      if (!kbActive) saveScroll(el);

      // خط پایهٔ ارتفاع پنجره «قبل از باز شدن کیبورد» — تشخیص دو حالت:
      //  • resizes-content (کروم ۱۰۸+): layout viewport کوچک می‌شود → innerHeight کم می‌شود
      //  • resizes-visual (iOS/بعضی WebViewها): فقط visualViewport کوچک می‌شود → overlapNow
      const baselineInner = window.innerHeight;
      const keyboardOpen = () =>
        kbActive ||
        baselineInner - window.innerHeight > KEYBOARD_MIN_OVERLAP ||
        overlapNow() > KEYBOARD_MIN_OVERLAP;

      let paddedOnce = false;
      // بازرسی‌های چندمرحله‌ای — جا افتادن کامل انیمیشن کیبورد در WebViewهای کند
      const timers = [220, 500, 900].map((delay) =>
        window.setTimeout(() => {
          if (document.activeElement !== el) return; // فوکوس عوض شده — بی‌خیال
          if (keyboardOpen()) {
            // کیبورد باز است و viewport آن را گزارش می‌دهد (کروم/iOS/WebView مدرن)
            kbActive = true;
            removePadding(); // پدینگ در صفحهٔ کوچک‌شده مزاحم است
            ensureVisible(el, true);
            fixIosDrift();
          } else if (!paddedOnce) {
            // WebView لجبار (الگوی اینستاگرام): هیچ رویدادی نیامد — حالت پیش‌خوان
            paddedOnce = true;
            applyPadding(el);
            // v91-A: فقط اسکرول داخلیِ حداقلی — window دست‌نخورده (بدون دوپرشیفت)
            stubbornEnsureVisible(el);
            // اگر resize دیر رسید، پدینگ را بردار
            window.setTimeout(() => {
              if (document.activeElement === el && keyboardOpen()) {
                kbActive = true;
                removePadding();
                ensureVisible(el, true);
              }
            }, 600);
          } else {
            // تلاش مجدد — کیبورد هنوز در حال بالا آمدن است
            stubbornEnsureVisible(el);
          }
        }, delay)
      );
      cleanupTimers.push(...timers);
    };

    const onFocusOut = (e: FocusEvent) => {
      // v112 — اگر فوکوسِ ازدست‌رفته متعلق به صفحهٔ auth است، ماشین‌حالت خودش
      // بستن/بازگردانی را انجام می‌دهد؛ اینجا دخالت نکن
      if (insideAuthScreen(e.target as Element)) return;
      window.setTimeout(() => {
        if (!isTextInput(document.activeElement)) {
          closeKeyboard();
        }
      }, 160);
    };

    const onVvChange = () => {
      // v112 — وقتی فوکوس روی ورودی‌های صفحهٔ auth است، ماشین‌حالت auth خودش
      // واکنش می‌دهد؛ اینجا هیچ اسکرول/پدینگ/بازگردانی‌ای اعمال نشود (دوپن نشود)
      if (insideAuthScreen(document.activeElement)) return;
      const ae = document.activeElement;
      const overlap = overlapNow();
      if (overlap < KEYBOARD_MIN_OVERLAP) {
        // کیبورد بسته شد (حتی اگر فوکوس روی ورودی مانده — دکمهٔ برگشت کیبورد)
        if (kbActive) closeKeyboard();
      } else if (!kbActive) {
        // v91-B — باز شدن کیبورد بدون focusin تازه (رفوکوس روی همان ورودی):
        // خط پایهٔ اسکرول همین‌جا (قبل از هر جابه‌جایی JS) ذخیره شود
        kbActive = true;
        if (isTextInput(ae) && ae instanceof HTMLElement) saveScroll(ae);
      }
      if (isTextInput(ae)) {
        ensureVisible(ae as HTMLElement, true, false);
      }
      fixIosDrift();
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    vv()?.addEventListener("resize", onVvChange);
    vv()?.addEventListener("scroll", onVvChange);

    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      vv()?.removeEventListener("resize", onVvChange);
      vv()?.removeEventListener("scroll", onVvChange);
      cleanupTimers.forEach((t) => window.clearTimeout(t));
      restoreTimers.forEach((t) => window.clearTimeout(t));
      closeKeyboard();
    };
  }, []);

  return null;
}
