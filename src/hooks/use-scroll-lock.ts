"use client";

import { useEffect } from "react";

/**
 * ─── قفل اسکرول صفحه پشت مودال‌ها ───
 *
 * مشکل: مودال‌های سفارشی (motion.div با fixed inset-0) اسکرول body را قفل
 * نمی‌کنند — کاربر با اسکرول/لمس، صفحه‌ی پشت مودال را حرکت می‌دهد.
 * Radix (Sheet/Dialog) خودش این کار را می‌کند؛ این hook برای مودال‌های
 * دست‌ساز است.
 *
 * نکته: به‌جای overflow:hidden (که اسکرول‌بار را حذف و صفحه را «پرش»
 * می‌دهد)، از position:fixed + حفظ موقعیت استفاده می‌کنیم — بدون layout
 * shift. روی iOS هم مطمئن‌تر است.
 *
 * چند مودال هم‌زمان باز باشند؟ فعال‌سازی با شمارنده (ref-count) انجام
 * می‌شود؛ قفل فقط با بسته‌شدن آخرین مودال آزاد می‌شود.
 */

let lockCount = 0;
let savedScrollY = 0;
let savedStyle = "";

function lock() {
  if (typeof document === "undefined") return;
  lockCount++;
  if (lockCount > 1) return; // قبلاً قفل شده
  savedScrollY = window.scrollY;
  savedStyle = document.body.style.cssText;
  const sbw = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.cssText =
    `position:fixed; top:${-savedScrollY}px; width:100%; ` +
    (sbw > 0 ? `padding-left:${sbw}px; ` : "") + // جبران حذف اسکرول‌بار
    savedStyle;
}

function unlock() {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return; // هنوز مودالی باز است
  document.body.style.cssText = savedStyle;
  window.scrollTo(0, savedScrollY);
}

/** اسکرول صفحه را تا وقتی active=true است قفل می‌کند */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
