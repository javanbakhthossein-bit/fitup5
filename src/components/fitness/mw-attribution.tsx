"use client";

import { MUSCLEWIKI_ATTRIBUTION } from "@/lib/fitness/exercise-video";

/**
 * v190 — کپشن منبع ویدیوی Muscle Wiki (دیرکتیو مالک)
 *
 * «در همه قسمت‌های سایت که ویدیو ماسل ویکی وجود داره زیرش بنویس
 *  ویدیو متعلق به سایت ماسل ویکی»
 *
 * مصرف: زیر هر پلیر <video> که منبعش Muscle Wiki است (resolveExerciseVideoSrc
 * با source="mw" یا بلوک mw در resolveExerciseVideoBlocks) + پلیر ویدیوی چالش‌ها.
 * برای ویدیوی اختصاصی و یوتیوب نمایش داده نمی‌شود.
 */
export function MwAttribution({ className = "" }: { className?: string }) {
  return (
    <p
      className={`text-[11px] leading-4 text-slate-500 font-medium text-center ${className}`}
      dir="rtl"
    >
      {MUSCLEWIKI_ATTRIBUTION}
    </p>
  );
}
