"use client";

import { useState } from "react";
import { Camera, ImageOff, type LucideIcon } from "lucide-react";

/**
 * ─── MediaImage — <img> با fallback شکیل برای فایل‌های گم‌شده ───
 *
 * مشکل (گزارش مالک): عکس‌های آپلودشده کاربر در «گالری پیشرفت» و «پرونده
 * ورزشی» به‌صورت آیکون عکس شکسته (broken image) نمایش داده می‌شدند.
 *
 * ریشه: فایل‌های قدیمی public/uploads در دیپلوی‌های قبلی (rm -rf public قبل
 * از مهاجرت) حذف شده بودند؛ رکورد DB مانده ولی فایل دیسک نه. سرور 404
 * می‌دهد و مرورگر آیکون شکسته می‌کشد.
 *
 * این کامپوننت:
 *  ۱) اگر عکس سالم لود شد → همان <img>
 *  ۲) اگر 404/خطا خورد → کارت placeholder شکیل (آیکون + برچسب) به‌جای
 *     آیکون شکسته — تجربه کاربری تمیز و صادقانه
 *
 * کاربرد: ProgressGallery، پرونده ورزشی، مودال ادمین و هر جا رسانه کاربر
 * رندر می‌شود.
 */
export function MediaImage({
  src,
  alt,
  className,
  fallbackLabel = "فایل یافت نشد",
  fallbackIcon,
  rounding = "rounded-xl",
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  fallbackIcon?: LucideIcon;
  rounding?: string;
  /** محتوای overlay (برچسب زاویه/تاریخ) — فقط وقتی عکس سالم است رندر می‌شود */
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const Icon = fallbackIcon ?? ImageOff;

  if (!src || failed) {
    return (
      <div
        className={`${className ?? ""} ${rounding} bg-slate-100 flex flex-col items-center justify-center gap-1 text-slate-400`}
        role="img"
        aria-label={`${alt} — ${fallbackLabel}`}
      >
        <Icon className="w-5 h-5 opacity-60" />
        <span className="text-[8px] text-center px-1 leading-tight">{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ""} ${rounding} overflow-hidden bg-slate-100`}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
          <Camera className="w-5 h-5 text-slate-300 animate-pulse" />
        </div>
      )}
      {loaded && children}
    </div>
  );
}
