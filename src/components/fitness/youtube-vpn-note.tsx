"use client";

/**
 * v169 — هشدار فیلترشکن زیر ویدیوهای یوتیوب (دیرکتیو مالک:
 * «در همه قسمت‌ها زیر ویدیو یوتیوب بنویس که برای مشاهده ویدیو باید
 * فیلترشکن خود را روشن کنید»).
 *
 * یوتیوب در ایران بدون فیلترشکن بارگذاری نمی‌شود؛ کاربر جعبهٔ سیاه می‌بیند
 * و نمی‌داند چرا — این نوار کوچک زیر هر پلیر یوتیوب (تمام بخش‌های اپ/سایت)
 * دلیل را قبل از پرسیدن می‌گوید. دو واریانت: bar (نوار کامل با آیکون) و
 * inline (خط کوتاه برای جاهای تنگ).
 */
import { Wifi } from "lucide-react";

export const YOUTUBE_VPN_MESSAGE = "برای مشاهده ویدیو باید فیلترشکن خود را روشن کنید";

export function YoutubeVpnNote({ variant = "bar" }: { variant?: "bar" | "inline" }) {
  if (variant === "inline") {
    return (
      <p className="mt-1 text-[10px] text-amber-600 text-center flex items-center justify-center gap-1" dir="rtl">
        <Wifi className="w-3 h-3 shrink-0" aria-hidden />
        {YOUTUBE_VPN_MESSAGE}
      </p>
    );
  }
  return (
    <div
      className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-50 border-t border-amber-200"
      dir="rtl"
      role="note"
      aria-label={YOUTUBE_VPN_MESSAGE}
    >
      <span className="relative flex w-4 h-4 shrink-0 items-center justify-center" aria-hidden>
        <Wifi className="w-3.5 h-3.5 text-amber-600" />
        <span className="absolute -top-0.5 left-0 w-3 h-3 rounded-full bg-amber-400/30 animate-ping" />
      </span>
      <span className="text-[11px] text-amber-800 font-bold text-center leading-relaxed">
        {YOUTUBE_VPN_MESSAGE}
      </span>
    </div>
  );
}
