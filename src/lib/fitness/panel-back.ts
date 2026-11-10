"use client";

/**
 * v190 — استک «بک درونی پنل» (دیرکتیو مالک — ناوبری پله‌پله با دکمه back)
 *
 * مشکل قبلاً: back گوشی/مرورگر داخل ویوهای عمیق پنل (جزئیات چالش، جلسهٔ چالش،
 * مدال، پیاده‌روی و دویدن، تمرین امروز) مستقیم به داشبورد می‌پرید یا وسط چالش
 * دیالوگ «خروج از فیتاپ» را می‌داد.
 *
 * معماری:
 *  • هر ورود به ویوی عمیق → pushPanelEntry: یک history.pushState با مارکر
 *    { __fitupPanel: true, depth } + ثبت «راه برگشت» (restore) در استک ماژول.
 *  • popstate (back گوشی/مرورگر) → اگر روی entryهای پنل فرود آمدیم، بالای استک
 *    pop و restore اجرا می‌شود (بستن مدال / بازگشت جلسه به جزئیات / هاب / داشبورد)
 *    و رویداد با stopImmediatePropagation به هندلرهای قدیمی (page-client) نمی‌رسد.
 *  • بستن از مسیر UI (دکمهٔ ضربدر/«عالیه!»/دکمهٔ بازگشت داخل ویو) → closePanelEntry:
 *    استک pop می‌شود و history.back() فقط برای «مصرف» همان entry اجرا می‌گردد؛
 *    popstate بعدی سرکوب می‌شود تا هیچ ناوبری تصادفی رخ ندهد.
 *
 * هماهنگی با هندلرهای موجود (ترتیب ثبت listener ها):
 *  ۱) همین ماژول (import استاتیک در page-client → اول از همه)
 *  ۲) گارد overlay در main-app (بستن Sheet ها با back)
 *  ۳) هندلر popstate صفحه (page-client — داشبورد → تأیید خروج PWA / لندینگ)
 * این listener فقط وقتی دخالت می‌کند که screen === "main" و اورلی باز نباشد؛
 * بنابراین منطق landing/auth/admin و اورلی‌ها دست‌نخورده می‌ماند.
 */

import { useAppStore } from "@/lib/fitness/store";

/** انواع ویوهای عمیق پنل که entry تاریخچه می‌گیرند */
export type PanelEntryType =
  | "challenge-detail" // جزئیات چالش (هاب چالش‌ها)
  | "challenge-session" // جلسهٔ تمرین چالش (تمام‌صفحه)
  | "workout-session" // «تمرین امروز» برنامهٔ پولی (تمام‌صفحه)
  | "medal" // کارت مدال روز کامل
  | "tab" // تب عمیق (فعلاً: پیاده‌روی و دویدن)
  // 🎯 v227 — دیرکتیو مالک: «مدال برنامه تمرینی/غذایی که باز می‌شود با بک باید
  // برگردد به تب تمرین‌ها، نه داشبورد» — مودال PlanViewModal (تب برنامه‌ها) و
  // مدال داخلی توضیحات حرکت آن حالا در همین زنجیره ثبت می‌شوند.
  | "plan-view" // مودال مشاهدهٔ برنامه (تمرینی/غذایی/مکمل) در تب برنامه‌ها
  | "plan-exercise"; // مدال توضیحات حرکت داخل PlanViewModal

export interface PanelEntry {
  type: PanelEntryType;
  /** شناسهٔ اختیاری (slug چالش / نام تب) */
  id?: string;
}

interface PanelStackItem {
  entry: PanelEntry;
  /** دقیقاً همان کاری که «یک قدم برگشت» باید بکند */
  restore: () => void;
}

const stack: PanelStackItem[] = [];

/** تعداد entryهایی که با history.back() در انتظار popstate «مصرفِ بی‌صدا» هستند */
let consumePending = 0;

/** مارکر روی entryهای تاریخچهٔ ما */
const PANEL_FLAG = "__fitupPanel";

function isPanelState(s: unknown): s is { __fitupPanel: true; depth: number } {
  return !!s && typeof s === "object" && (s as Record<string, unknown>).__fitupPanel === true;
}

/** عمق ثبت‌شده روی state فعلی تاریخچه (۰ = پایین‌تر از entryهای پنل) */
function landedDepth(state: unknown): number {
  if (!isPanelState(state)) return 0;
  const d = Number(state.depth);
  return Number.isFinite(d) && d > 0 ? Math.floor(d) : 0;
}

/**
 * ثبت یک ویوی عمیق — همیشه push می‌کند (برای مسیرهای مشخص ورود).
 * restore = همان کاری که back باید بکند (بستن همان ویو و بازگرداندن قبلی).
 */
export function pushPanelEntry(entry: PanelEntry, restore: () => void): void {
  if (typeof window === "undefined") return;
  stack.push({ entry, restore });
  try {
    window.history.pushState({ [PANEL_FLAG]: true, depth: stack.length }, "", window.location.href);
  } catch {
    // pushState شکست خورد (WebView محدود) — استک می‌ماند؛ back عادی از مسیر
    // قدیمی (page-client) ادامه می‌دهد و landed-logic خودش هماهنگ می‌شود
  }
}

/**
 * مثل pushPanelEntry ولی اگر بالای استک همین entry بود، دوباره push نمی‌کند
 * (ضد push تکراری: فراخوانی چندباره از مسیرهای مختلف / StrictMode / رفرش).
 */
export function ensurePanelEntry(entry: PanelEntry, restore: () => void): void {
  const top = stack[stack.length - 1];
  if (top && top.entry.type === entry.type && top.entry.id === entry.id) return;
  pushPanelEntry(entry, restore);
}

/** آیا بالای استک از این نوع است؟ (برای گاردها) */
export function isTopPanelEntry(type: PanelEntryType, id?: string): boolean {
  const top = stack[stack.length - 1];
  return !!top && top.entry.type === type && (id === undefined || top.entry.id === id);
}

/** عمق استک پنل — ۰ یعنی روی ویوی پایه (داشبورد/هاب/تب) هستیم */
export function panelBackDepth(): number {
  return stack.length;
}

/**
 * v190 — خالی کردن استک (خروج/لاگ‌اوت یا تعویض کاربر): entryهای قدیمی نباید
 * برای کاربر بعدی restore شوند. entryهای تاریخچه‌ی یتیم در popstate بعدی
 * توسط self-heal (پاک‌کردن مارکر) بی‌صدا مصرف می‌شوند.
 */
export function resetPanelBack(): void {
  stack.length = 0;
  consumePending = 0;
}

/**
 * بستن یک ویوی عمیق از مسیر UI (بدون فشار back توسط کاربر):
 * entry از استک حذف و history.back() فقط برای مصرف همان entry اجرا می‌شود؛
 * popstate بعدی سرکوب می‌شود (هیچ restore/ناوبری اضافه‌ای رخ نمی‌دهد).
 * اگر بالای استک از این نوع نبود، کاری نمی‌کند (landed-logic در popstate خودش
 * entryهای بی‌صاحب را بی‌صدا مصرف می‌کند).
 */
export function closePanelEntry(type: PanelEntryType, id?: string): void {
  if (typeof window === "undefined") return;
  const top = stack[stack.length - 1];
  if (!top || top.entry.type !== type || (id !== undefined && top.entry.id !== id)) return;
  stack.pop();
  consumePending++;
  try {
    window.history.back();
  } catch {
    consumePending = Math.max(0, consumePending - 1);
  }
}

// ─── listener سراسری popstate — یک‌بار در عمر ماژول ───
// الگوی همان گارد overlay در main-app (ثبت سطح ماژول + فلگ ضد ثبت مجدد در HMR)
if (typeof window !== "undefined" && !(window as unknown as Record<string, unknown>).__fitupPanelBackGuard) {
  (window as unknown as Record<string, unknown>).__fitupPanelBackGuard = true;
  window.addEventListener("popstate", (e: PopStateEvent) => {
    // ۱) popstate ناشی از «مصرف» entryهای بسته‌شده از مسیر UI — فقط سرکوب
    if (consumePending > 0) {
      consumePending--;
      e.stopImmediatePropagation();
      return;
    }

    const st = useAppStore.getState();

    // ۲) فقط داخل پنل؛ اورلی باز → گارد main-app خودش بسته می‌کند
    if (st.screen !== "main") return;
    if (st.overlay) return;

    // ۳) فرود روی entry اورلیِ بسته‌شده از UI (entry یتیم) — مصرف بی‌صدا
    const state = e.state as Record<string, unknown> | null;
    if (state && state.fitupOverlay === true && !isPanelState(state)) {
      e.stopImmediatePropagation();
      return;
    }

    const landed = landedDepth(e.state);

    // ۴) استک خالی ولی روی entry پنل فرود آمدیم (رفرش وسط ویوی عمیق / back
    //    بعد از بستن‌های UI) — مارکر را پاک می‌کنیم تا backهای بعدی از مسیر
    //    قدیمی (داشبورد/لندینگ) ادامه دهد
    if (stack.length === 0) {
      if (landed > 0) {
        try {
          window.history.replaceState(null, "", window.location.href);
        } catch {}
        e.stopImmediatePropagation();
      }
      return;
    }

    // ۵) فرود روی یکی از entryهای خودمان که بالای استک نیست (back مصرفی /
    //    entry یتیم) — هیچ restore‌ای لازم نیست، فقط به page-client نرسد
    if (landed >= stack.length) {
      e.stopImmediatePropagation();
      return;
    }

    // ۶) back واقعی داخل پنل — همهٔ entryهای بالای عمق فرود را pop و restore
    let handled = false;
    while (stack.length > landed) {
      const top = stack.pop();
      if (!top) break;
      handled = true;
      try {
        top.restore();
      } catch {}
    }
    if (handled) e.stopImmediatePropagation();
  });
}
