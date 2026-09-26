"use client";

/**
 * بنر ثابت «فیلترشکن» برای همهٔ نقاط پرداخت — v135
 *
 * 🔧 دیرکتیو مالک (v129 + ساده‌سازی v135): هیچ چک پویا، هیچ درخواست شبکه‌ای،
 * هیچ حالت پویا — و متن فقط «یک» جمله:
 *   «با وی‌پی‌ان خاموش وارد درگاه پرداخت شوید»
 * کلیک پرداخت بدون هیچ انتظاری مستقیم به درگاه می‌رود و داور نهاییِ باز شدن
 * درگاه همیشه خودِ زرین‌پال است (ارور VPN را خودش می‌دهد).
 */

export function VpnStatusBanner() {
  return (
    <div
      dir="rtl"
      className="flex items-center justify-center gap-1.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path
          d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>با وی‌پی‌ان خاموش وارد درگاه پرداخت شوید</span>
    </div>
  );
}
