"use client";

import { useEffect } from "react";

/**
 * ─── قفل اسکرول صفحه پشت مودال‌ها (v143 — فیکس فلش مدال خروج) ───
 *
 * مشکل قبلی (v43): با باز شدن مودال، کل body.style.cssText با
 * position:fixed + top:-scrollY بازنویسی می‌شد — چون body خودِ ظرف اسکرول
 * پنل است، این جابجایی پشت پس‌زمینهٔ نیمه‌شفافِ مودال مثل «فلش/پرش» دیده
 * می‌شد (گزارش مالک: «مدال تایید خروج فلش می‌زنه»)؛ مخصوصاً وقتی از داخل
 * drawer باز می‌شود که خودش overflow:hidden گذاشته بود (دو نویسندهٔ متناقض).
 *
 * v143: فقط overflow:hidden روی html+body — موقعیت اسکرول در مرورگرهای
 * مدرن حفظ می‌شود، صفر پرش/رفلو، و بازیابی دقیق مقدار قبلی (سازگار با
 * قفلِ drawer). جبران اسکرول‌بار مثل قبل روی padding-left (چیدمان RTL).
 *
 * چند مودال هم‌زمان باز باشند؟ فعال‌سازی با شمارنده (ref-count) انجام
 * می‌شود؛ قفل فقط با بسته‌شدن آخرین مودال آزاد می‌شود.
 */

let lockCount = 0;
let savedHtmlOverflow = "";
let savedBodyOverflow = "";
let savedBodyPaddingLeft = "";

function lock() {
  if (typeof document === "undefined") return;
  lockCount++;
  if (lockCount > 1) return; // قبلاً قفل شده
  savedHtmlOverflow = document.documentElement.style.overflow;
  savedBodyOverflow = document.body.style.overflow;
  savedBodyPaddingLeft = document.body.style.paddingLeft;
  const sbw = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  if (sbw > 0) document.body.style.paddingLeft = `${sbw}px`; // جبران حذف اسکرول‌بار (RTL)
}

function unlock() {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return; // هنوز مودالی باز است
  document.documentElement.style.overflow = savedHtmlOverflow;
  document.body.style.overflow = savedBodyOverflow;
  document.body.style.paddingLeft = savedBodyPaddingLeft;
}

/** اسکرول صفحه را تا وقتی active=true است قفل می‌کند */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lock();
    return unlock;
  }, [active]);
}
