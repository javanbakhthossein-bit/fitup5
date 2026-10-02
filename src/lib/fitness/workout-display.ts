/**
 * workout-display — نمایش «یکدست و سینک» ست/تکرار/استراحت در تمام سایت (v55)
 *
 * درخواست صریح مالک: «تعداد حرکات و ست‌ها و زمان استراحت در مدال تمرینی و در
 * تمرین امروز و شروع تمرین و حالت باشگاه باید سینک و یکی باشند» و «تکرار را
 * نامفهوم ننویس — باید معلوم باشد چند ست و چند تکرار است».
 *
 * این ماژول تنها منبع فرمت است و در ۴ بخش استفاده می‌شود:
 *   ۱) مدال تمرینی برنامه‌ها (programs-view → ExerciseRow + مدال جزئیات حرکت)
 *   ۲) تمرین امروز (workouts-view → کارت حرکت + جدول ست‌ها)
 *   ۳) شروع تمرین (active-workout-session → خط هدف هر ست + خلاصه حرکت)
 *   ۴) حالت باشگاه (gym-mode-view → جدول ست‌ها)
 *
 * فرمت مرجع:
 *   ست‌ها  → «۴ ست × ۱۰-۱۲ تکرار»  (اگر همه ست‌ها یکی باشند: «۴ ست × ۱۲ تکرار»)
 *   استراحت → «۶۰ ثانیه» یا «۲ دقیقه» ( مضرب دقیق ۶۰ و ≥۶۰ → دقیقه)
 *   reps می‌تواند رشته بازه‌ای باشد («10-12») یا عدد؛ هر دو پشتیبانی می‌شوند.
 */

import { toPersianDigits } from "@/lib/fitness/types";

/** استخراج کف و سقف عددی تکرار از مقدار ست (عدد یا رشتهٔ بازه‌ای مثل «10-12») */
function repBounds(raw: unknown): { min: number; max: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  if (!s) return null;
  // بازه «10-12» یا «10 تا 12» یا «10–12»
  const range = s.match(/^(\d+)\s*(?:[-–—]|تا)\s*(\d+)$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
  }
  // اولین عدد داخل رشته (مثل «حدود 10» یا «10»)
  const n = s.match(/\d+/);
  if (n) {
    const v = Number(n[0]);
    if (Number.isFinite(v)) return { min: v, max: v };
  }
  return null;
}

/**
 * خلاصهٔ ست‌های یک حرکت — فرمت واحد همه‌جا:
 *   ۴ ست × ۱۲ تکرار   (همهٔ ست‌ها یکسان)
 *   ۴ ست × ۱۰-۱۲ تکرار (بازه‌ای/متفاوت — کف تا سقف)
 *   ۴ ست               (بدون دادهٔ تکرار)
 */
export function formatSetsSummary(sets: Array<{ reps?: unknown }> | undefined | null): string {
  const count = sets?.length ?? 0;
  if (count === 0) return "—";
  const bounds = sets!.map((s) => repBounds(s?.reps)).filter(Boolean) as Array<{ min: number; max: number }>;
  if (bounds.length === 0) return `${toPersianDigits(count)} ست`;
  const min = Math.min(...bounds.map((b) => b.min));
  const max = Math.max(...bounds.map((b) => b.max));
  const repsPart = min === max ? toPersianDigits(min) : `${toPersianDigits(min)}-${toPersianDigits(max)}`;
  return `${toPersianDigits(count)} ست × ${repsPart} تکرار`;
}

/** برچسب کوتاه برای فضای تنگ (بج ردیف حرکت): «۴ ست × ۱۰-۱۲» بدون کلمهٔ تکرار */
export function formatSetsSummaryShort(
  sets: Array<{ reps?: unknown }> | undefined | null
): string {
  return formatSetsSummary(sets).replace(" تکرار", "");
}

/**
 * فرمت استراحت — فرمت واحد همه‌جا:
 *   45 → «۴۵ ثانیه» | 60 → «۱ دقیقه» | 90 → «۹۰ ثانیه» | 120 → «۲ دقیقه»
 * صفر → «—» (بدون استراحت — مثلاً وسط سوپرست).
 */
export function formatRestSec(sec: number | undefined | null): string {
  const s = Number(sec ?? 0);
  if (!s || s <= 0) return "—";
  if (s >= 60 && s % 60 === 0) {
    const m = s / 60;
    return `${toPersianDigits(m)} دقیقه`;
  }
  return `${toPersianDigits(s)} ثانیه`;
}

/**
 * هدف یک ستِ مشخص برای نمایش کنار ورودی (شروع تمرین/حالت باشگاه):
 * «هدف: ۱۰-۱۲ تکرار • استراحت ۱ دقیقه»
 */
export function formatSetGoal(set: { reps?: unknown; restSec?: number }): string {
  const b = repBounds(set?.reps);
  const repsPart = b ? (b.min === b.max ? toPersianDigits(b.min) : `${toPersianDigits(b.min)}-${toPersianDigits(b.max)}`) : "—";
  return `هدف: ${repsPart} تکرار • استراحت ${formatRestSec(set?.restSec)}`;
}
