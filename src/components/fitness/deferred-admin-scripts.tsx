"use client";

import { useEffect, useRef } from "react";

/**
 * DeferredAdminScripts — v251-fix418
 *
 * ریشه‌یابی قطعی «Minified React error #418 (args[]=HTML)» لاگ مدیر:
 * اسکریپت‌های تزریقی ادمین (HeadCode — مثل Clarity/GA4) تا امروز در parse-time
 * با React.createElement("script") رندر می‌شدند؛ یعنی «همزمان با هیدریشن» اجرا
 * می‌شدند و اسکریپت‌هایی که وسط <head> گره درج می‌کنند (الگوی insertBefore
 * کلاریتی) دقیقاً وسط walk هیدریشن React گره غیرمنتظره می‌سازند — مخصوصاً روی
 * موبایل کند و صفحات سنگین (بانک حرکات/غذاها). فیکس‌های v240 (لودر گارددار
 * layout) و v245 (پرش از قطعهٔ ریسک کلاریتی) بخش بزرگ را بسته بودند؛ این لایه
 * کلاس را «قطعی» می‌بندد: هر اسکریپتِ ادمین بعد از پایان هیدریشن (useEffect)
 * با appendChild در «انتهای head» تزریق می‌شود — نود انتها-افزوده هرگز مسیر
 * walk هیدریشن را نمی‌شکند و هیچ اسکریپتِ ادمینی دیگر ریسِ parse-time ندارد.
 *
 * نکات حفظ رفتار:
 *  • <meta>/<link> ادمین عیناً SSR می‌مانند (وریفای گوگل/اینماد — نیاز به SSR).
 *  • اسکریپت‌های JSON-LD ادمین هم SSR می‌مانند (داده‌اند، DOM را تغییر نمی‌دهند
 *    و صفر ریس هیدریشن دارند؛ گوگل خروجی JS را هم می‌خواند ولی SSR مطمئن‌تر است).
 *  • ترتیب اسکریپت‌ها حفظ می‌شود (appendChild پشت‌سرهم در همان تیک effect).
 *  • src دار → async=1 (الگوی v240)؛ inline → textContent (اجرا در append).
 *  • placement بدنه دست‌نخورده است (رفتار امروز — صفر تغییر).
 */

export type DeferredScript = {
  /** محتوای inline اسکریپت (اگر src نداشته باشد) */
  html?: string;
  /** آدرس اسکریپت خارجی */
  src?: string;
  /** تایپ اسکریپت (فقط برای ثبت — JSON-LD اصلاً به اینجا نمی‌آید) */
  type?: string;
};

export function DeferredAdminScripts({ scripts }: { scripts: DeferredScript[] }) {
  // اجرای تک‌بار در طول عمر صفحه — حتی اگر props عوض شود (ادمین وسط نشست عوضش
  // نکند؛ این کامپوننت فقط با دادهٔ SSR mount می‌شود)
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current || !scripts.length) return;
    doneRef.current = true;
    for (const s of scripts) {
      try {
        const el = document.createElement("script");
        if (s.src) {
          el.src = s.src;
          el.async = true;
        } else if (s.html) {
          el.textContent = s.html;
        } else {
          continue;
        }
        if (s.type) el.type = s.type;
        el.setAttribute("data-headcode", "deferred");
        // appendChild در انتهای head — الگوی اثبات‌شدهٔ v240: نود انتها-افزوده
        // هرگز walk هیدریشن را نمی‌شکند (هیدریشن پیش از useEffect تمام شده است).
        document.head.appendChild(el);
      } catch {
        // خطای تزریق هرگز نباید به رویداد window برسد (نویز لاگ مدیر = صفر)
      }
    }
  }, [scripts]);

  // SSR و اولین رندر کلاینت: هیچ — پس هیچ ناهمسانی هیدریشنی ممکن نیست
  return null;
}
