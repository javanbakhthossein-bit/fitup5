"use client";

import { useEffect } from "react";
import { installNetShield } from "@/lib/fitness/net-shield";
import { initNetworkRecovery } from "@/lib/fitness/network-recovery";

/**
 * v156 — نصب‌کنندهٔ سراسری سپر شبکهٔ فیتاپ (تیکت مالک: «خاموش کردن VPN → هیچ
 * چیزی کار نمی‌کند» + «حالت خواب»).
 *
 * در ریشهٔ layout نصب می‌شود تا «همهٔ» روت‌ها (لندینگ، پنل، /renew، /activity،
 * /tdee، /exercises و…) پوشش داده شوند:
 *  ۱) net-shield: هر fetch بدون signal در کل سایت تایم‌اوت سخت می‌گیرد —
 *     درخواست دیگر هرگز روی سوکت مردهٔ سوییچ VPN برای همیشه آویزان نمی‌ماند.
 *  ۲) network-recovery: موتور خودترمیمی — روی شکست شبکه پروب بی‌پایان تا
 *     بازیابی، بعد رویداد connection-restored برای زنده‌شدن درجا (بدون بستن اپ).
 *
 * v216 — دیرکتیو مالک: «اعلان‌هایی که پایین صفحه راجع به اتصال می‌زنی باید
 * برداشته شود — به هیچ وجه نمایش داده نشود»:
 *  • بنر وضعیت اتصال v215 («اتصال اینترنت قطع شد» / «اتصال برقرار شد ✓») کامل
 *    حذف شد — دیگر هیچ اعلان اتصالی در پایین صفحه دیده نمی‌شود.
 *  • موتور خودترمیمی v156/v205 عیناً و بی‌صدا سر جای خودش است.
 *  • سمت موتور هم اصلاح شد: رویداد fitup:connection-restored فقط بعد از یک
 *    قطعیِ واقعی پخش می‌شود (نه بعد از هر لغزش یک‌بارهٔ درخواست) — پنل دیگر
 *    موج تازه‌سازی/چشمک به‌دلیل بلپ‌های زودگذر ندارد.
 */
export function NetShieldInstaller() {
  useEffect(() => {
    try {
      installNetShield();
    } catch {}
    try {
      initNetworkRecovery();
    } catch {}
  }, []);

  return null;
}
