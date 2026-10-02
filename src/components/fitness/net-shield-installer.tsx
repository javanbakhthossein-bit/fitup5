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
