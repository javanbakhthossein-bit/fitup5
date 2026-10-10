/**
 * ─── pull-to-refresh سفارشی فیتاپ — «فقط یک‌چهارم بالای صفحه» (v153) ───
 *
 * دیرکتیو مالک (تکرار شده در v143 و v149 و این تیکت):
 *   «همچنان در هر قسمتی از صفحه می‌کشیم به پایین رفرش میشه. گفتم فقط
 *    یک چهارم بالای صفحه باید قابلیت اسکرول برای رفرش داشته باشه.»
 *
 * ریشه: رفرشِ مرورگری (Chrome/WebView) هرجا سند در بالای خودش باشد فعال
 * می‌شود — «موقعیت شروع لمس» در هیچ لایه‌ای کنترل نمی‌شد؛ رفرش نیتیو اپ‌ها
 * هم فقط scrollY صفحه را می‌بیند. CSS (overscroll-behavior) فقط می‌تواند
 * رفرش را «کلاً» ببندد، نه اینکه آن را به ناحیه‌ای محدود کند.
 *
 * راه‌حل: رفرشِ بومی کامل بسته می‌شود (globals.css: html overscroll-behavior-y:none
 * + قفل دائمی SwipeRefresh نیتیو در bazaar-scroll-guard) و این ماژول رفرش را
 * با همان UX آشنا (دایرهٔ چرخان بالای صفحه) بازسازی می‌کند — فقط وقتی:
 *   ۱) سند کاملاً در بالای خودش باشد (scrollTop === 0)
 *   ۲) لمس داخل «یک‌چهارم بالای viewport» شروع شده باشد
 *   ۳) لمس روی اسکرولر داخلی (مودال/لیست overflow) نباشد
 *
 * نکتهٔ پرفورمنس: شنوندهٔ غیر-passive فقط «هنگام تسلیحِ» ژست به window وصل
 * می‌شود و بلافاصله بعد از پایان لمس برداشته می‌شود — اسکرول عادی هرگز
 * هزینهٔ non-passive listener را نمی‌پردازد.
 *
 * مصرف: <PullToRefreshInstaller /> در layout.tsx — همهٔ صفحات (SSR + SPA).
 */

const TOP_REGION_RATIO = 0.25; // یک‌چهارم بالای صفحه — دیرکتیو صریح مالک
const TRIGGER_PX = 85; // کشیدِ دمپ‌شده برای فعال‌شدن رفرش
const MAX_PULL_PX = 120; // سقف جابه‌جایی نشانگر (دمپ ۰٫۵)
const INDICATOR_ID = "fitup-ptr-indicator";

let installed = false;

function ensureIndicator(): HTMLElement | null {
  try {
    let el = document.getElementById(INDICATOR_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = INDICATOR_ID;
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = [
      "position:fixed",
      "top:0",
      "left:50%",
      "width:42px",
      "height:42px",
      "margin-left:-21px",
      "border-radius:9999px",
      "background:rgba(28,25,23,.94)",
      "color:#fbbf24",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "box-shadow:0 8px 24px rgba(0,0,0,.28)",
      "transform:translateY(-64px)",
      "opacity:0",
      "transition:opacity .18s ease-out",
      "z-index:2147483000",
      "pointer-events:none",
      "will-change:transform",
    ].join(";");
    el.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .18s ease-out"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    document.body.appendChild(el);
    return el;
  } catch {
    return null;
  }
}

function setProgress(px: number, ready: boolean) {
  const el = document.getElementById(INDICATOR_ID);
  if (!el) return;
  const y = -64 + Math.max(0, px);
  const opacity = Math.min(1, px / 40);
  el.style.transform = `translateY(${Math.round(y)}px)`;
  el.style.opacity = px > 2 ? String(opacity) : "0";
  el.style.transition = px > 0 ? "opacity .18s ease-out" : "transform .22s ease-out, opacity .22s ease-out";
  const svg = el.firstElementChild as SVGElement | null;
  if (svg) svg.style.transform = ready ? "rotate(180deg)" : `rotate(${Math.round(px * 1.2)}deg)`;
}

/** نزدیک‌ترین والد اسکرول‌شوندهٔ عمودی هدف لمس (الگوی bazaar-scroll-guard) */
function findScrollableAncestor(el: EventTarget | null): HTMLElement | null {
  let cur = el as Element | null;
  while (cur && cur !== document.documentElement) {
    if (cur instanceof HTMLElement) {
      const style = window.getComputedStyle(cur);
      const ov = `${style.overflowY || style.overflow || ""}`;
      if (/auto|scroll/.test(ov) && cur.scrollHeight > cur.clientHeight + 1) return cur;
    }
    cur = cur.parentElement ?? (cur.getRootNode() as any)?.host ?? null;
  }
  return null;
}

export function installPullToRefresh(): void {
  if (typeof window === "undefined" || installed) return;
  const coarsePointer =
    ("ontouchstart" in window) ||
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
  if (!coarsePointer) return; // دسکتاپ — رفرش با Ctrl+R/دکمهٔ مرورگر
  installed = true;

  let armed = false;
  let pulling = false;
  let startX = 0;
  let startY = 0;
  let pull = 0;

  const docTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY ?? 0) <= 0;

  const onMove = (e: TouchEvent) => {
    if (!pulling || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dy = t.clientY - startY;
    const dx = t.clientX - startX;
    if (!docTop() || dy <= 0 || Math.abs(dx) > Math.abs(dy) * 1.2) {
      // ژست از حالت کشیدن خارج شد (اسکرول به پایینِ محتوا / حرکت افقی)
      pulling = false;
      pull = 0;
      setProgress(0, false);
      disarm();
      return;
    }
    if (e.cancelable) e.preventDefault(); // جلوگیری از رفتار بومی (rubber-band)
    pull = Math.min(MAX_PULL_PX, dy * 0.5); // دمپ نرم مثل رفرش بومی
    setProgress(pull, pull >= TRIGGER_PX);
  };

  const trigger = () => {
    const el = ensureIndicator();
    if (el) {
      el.style.transition = "transform .2s ease-out, opacity .2s ease-out";
      el.style.transform = "translateY(14px)";
      el.style.opacity = "1";
      const svg = el.firstElementChild as SVGElement | null;
      if (svg) {
        svg.style.animation = "fitup-ptr-spin .8s linear infinite";
        if (!document.getElementById("fitup-ptr-keyframes")) {
          const style = document.createElement("style");
          style.id = "fitup-ptr-keyframes";
          style.textContent =
            "@keyframes fitup-ptr-spin{to{transform:rotate(360deg)}}";
          document.head.appendChild(style);
        }
      }
    }
    // رفرش واقعی صفحه — همان معنای رفرش بومی
    window.setTimeout(() => {
      try {
        window.location.reload();
      } catch {}
    }, 260);
  };

  const onEnd = () => {
    if (pulling && pull >= TRIGGER_PX) {
      pulling = false;
      disarm();
      trigger();
      return;
    }
    pulling = false;
    pull = 0;
    setProgress(0, false);
    disarm();
  };

  function arm() {
    window.addEventListener("touchmove", onMove, { capture: true, passive: false });
    window.addEventListener("touchend", onEnd, { capture: true, passive: true });
    window.addEventListener("touchcancel", onEnd, { capture: true, passive: true });
  }
  function disarm() {
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onEnd, { capture: true });
    window.removeEventListener("touchcancel", onEnd, { capture: true });
  }

  window.addEventListener(
    "touchstart",
    (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (armed) {
          armed = false;
          pulling = false;
          disarm();
        }
        return;
      }
      const t = e.touches[0];
      try {
        armed =
          docTop() &&
          t.clientY <= window.innerHeight * TOP_REGION_RATIO &&
          !findScrollableAncestor(e.target);
      } catch {
        armed = false;
      }
      pulling = armed;
      startX = t.clientX;
      startY = t.clientY;
      pull = 0;
      if (armed) {
        ensureIndicator();
        arm(); // شنوندهٔ غیر-passive فقط در طول همین ژست
      }
    },
    { capture: true, passive: true }
  );

  // پاک‌سازی تضمینی هنگام قطع شدن صفحه (صفحه بسته/ناوبری)
  window.addEventListener("pagehide", () => {
    armed = false;
    pulling = false;
    disarm();
  });
}
