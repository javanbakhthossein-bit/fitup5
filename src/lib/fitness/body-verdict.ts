/**
 * ═══════════════════════════════════════════════════════════════════════
 *  v159 — موتور «تشخیص قطعی ترکیب بدن» (T6 — دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * نقل‌قول مالک:
 *  «دوماً هر عکس به صورت جداگانه ٪ چربی را حدس زده که این اشتباهه —
 *   باید با توجه به همه عکس‌های مدال آنالیز عکس بدن و اندازه‌های بدنی
 *   درصد چربی و درصد عضله تشخیص قطعی و درست داده بشه»
 *
 * اصول طراحی (قطعی، بدون LLM):
 *  ۱) پایهٔ حکم = فرمول اندازه‌های بدنی (US Navy — body-composition.ts؛
 *     فال‌بک Deurenberg در نبود کمر/گردن — checkup-helpers.ts).
 *  ۲) خروجی عددی مدل ویژن فقط «سیگنال تعدیلی» است — نه حکم.
 *     سیگنال از همهٔ عکس‌های ارسالی یکجا جمع و میانگین‌گیری می‌شود
 *     (نه حدسِ هر عکس جداگانه).
 *  ۳) حکم نهایی چربی = ترکیب وزنی قطعی:
 *        fat = round1(0.70 × اندازه‌ها + 0.30 × مدل‌ویژن)
 *     اگر فقط یکی موجود باشد، همان مبناست. عدد به‌صورت
 *     قطعی در TS محاسبه می‌شود — هیچ LLMی در محاسبهٔ عدد نقش ندارد.
 *  ۴) درصد عضله = تابع قطعی از چربی + جنسیت + فعالیت (کامنت فارسی
 *     پایین تابع estimateMusclePercent) — بدون هیچ کال شبکه‌ای.
 */

import { computeBodyFat } from "./checkup-helpers";
import type { Gender } from "./types";

/** وزن ترکیب حکم نهایی — ۷۰٪ فرمول اندازه‌های بدنی، ۳۰٪ سیگنال بصری مدل */
export const VERDICT_MEASUREMENT_WEIGHT = 0.7;
export const VERDICT_AI_WEIGHT = 0.3;

/** گشت‌زنی عدد از متن تخمین مدل — «۱۸-۲۰٪»، "18-20%"، «حدود ۲۰ درصد»، «2۰٪» */
export function parseAiFatEstimate(text?: string | null): number | null {
  if (!text || typeof text !== "string") return null;
  // ارقام فارسی/عربی → انگلیسی
  const normalized = text
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  // اولین بازهٔ «عدد-عدد» یا یک عدد تنها (۰ تا ۷۰ منطقی است)
  const range = /(\d{1,2}(?:[.,]\d)?)\s*[-–—ـ]\s*(\d{1,2}(?:[.,]\d)?)/.exec(normalized);
  if (range) {
    const a = parseFloat(range[1].replace(",", "."));
    const b = parseFloat(range[2].replace(",", "."));
    if (isFinite(a) && isFinite(b) && a > 0 && a < 70 && b > 0 && b < 70) {
      return Math.round(((a + b) / 2) * 10) / 10; // میانهٔ بازه
    }
    return null;
  }
  const single = /(\d{1,2}(?:[.,]\d)?)\s*٪?/.exec(normalized);
  if (single) {
    const v = parseFloat(single[1].replace(",", "."));
    if (isFinite(v) && v > 0 && v < 70) return v;
  }
  return null;
}

/**
 * تخمین قطعی درصد عضله (بدون LLM — تابع بسته).
 *
 * منطق علمی (تقریب مستند):
 *   عضله ≈ درصدِ تودهٔ بدون چربی × سهم عضله از تودهٔ بدون چربی.
 *   تودهٔ بدون چربی = ۱۰۰ − چربی.
 *   سهم عضله از تودهٔ بدون چربی: آقایان ~۰٫۶۸، خانم‌ها ~۰٫۶۰
 *   (میزان پایه؛ استخوان/آب/اندام‌ها باقی آن را تشکیل می‌دهند).
 *   تعدیل فعالیت: ورزشکارتر = تودهٔ عضلانی بالاتر (سقف +۱٫۵ واحد
 *   ضریب — محافظه‌کار، فقط برای بازتاب سطح فعالیت اعلامی آنبوردینگ).
 *   خروجی برای آقای با ۲۰٪ چربی فعال: ۸۰ × ۰٫۶۸۵ ≈ ۵۴٫۸٪ — بازهٔ
 *   واقع‌بینانه؛ صرفاً برای ردیابی پیشرفت است نه تشخیص پزشکی.
 */
export function estimateMusclePercent(opts: {
  fatPercent: number;
  gender: "male" | "female";
  activityLevel?: string | null;
}): number {
  const { fatPercent, gender, activityLevel } = opts;
  const leanPercent = 100 - fatPercent;
  const baseShare = gender === "female" ? 0.6 : 0.68;
  const activityBonus =
    activityLevel === "very_active" ? 0.015
    : activityLevel === "active" ? 0.01
    : activityLevel === "moderate" ? 0.005
    : 0;
  const share = baseShare + activityBonus;
  const muscle = leanPercent * share;
  // محدودسازی به بازهٔ منطقی (۲۵-۶۵ درصد)
  return Math.max(25, Math.min(65, Math.round(muscle * 10) / 10));
}

export interface BodyCompositionVerdict {
  fatPercent: number;
  musclePercent: number;
  /** پایهٔ فرمول اندازه‌های بدنی (null = اندازه‌های لازم نبود) */
  measurementFatPercent: number | null;
  /** سیگنال تعدیلی مدل ویژن (میانگین همهٔ عکس‌ها — null = سیگنالی نبود) */
  aiFatPercent: number | null;
  /** روش نهایی: measurement | blended | ai — برای شفافیت لاگ/ذخیره */
  method: "measurement" | "blended" | "ai";
}

/**
 * حکم قطعی ترکیب بدن برای «یک» لحظهٔ زمانی:
 *  - measurementFat: از computeBodyFat (US Navy / فال‌بک Deurenberg)
 *  - aiEstimateTexts: فیلدهای bodyFatEstimate همهٔ عکس‌های یک ارسال، یکجا
 *    میانگین‌گیری می‌شوند (حدس از-هر-عکس-جداگانه حذف شد — دیرکتیو مالک)
 */
export function computeBodyCompositionVerdict(opts: {
  gender: "male" | "female";
  height?: number | null;
  weight?: number | null;
  age?: number | null;
  waist?: number | null;
  hip?: number | null;
  neck?: number | null;
  activityLevel?: string | null;
  aiEstimateTexts?: (string | null | undefined)[];
}): BodyCompositionVerdict | null {
  const { gender, height, weight, age, waist, hip, neck, activityLevel, aiEstimateTexts } = opts;

  // ۱) پایهٔ اندازه‌های بدنی
  const measurement = computeBodyFat({ gender, height, weight, waist, hip, neck, age });
  const measurementFat = measurement?.bodyFatPercent ?? null;

  // ۲) سیگنال بصری مدل — میانگین همهٔ تخمین‌های معتبر (نه هر عکس جداگانه)
  const aiCandidates = (aiEstimateTexts ?? [])
    .map((t) => parseAiFatEstimate(t))
    .filter((v): v is number => v != null);
  const aiFat =
    aiCandidates.length > 0
      ? Math.round((aiCandidates.reduce((s, v) => s + v, 0) / aiCandidates.length) * 10) / 10
      : null;

  // ۳) ترکیب وزنی قطعی
  let fatPercent: number | null = null;
  let method: BodyCompositionVerdict["method"] = "measurement";
  if (measurementFat != null && aiFat != null) {
    fatPercent =
      Math.round((VERDICT_MEASUREMENT_WEIGHT * measurementFat + VERDICT_AI_WEIGHT * aiFat) * 10) / 10;
    method = "blended";
  } else if (measurementFat != null) {
    fatPercent = measurementFat;
    method = "measurement";
  } else if (aiFat != null) {
    fatPercent = aiFat;
    method = "ai";
  }
  if (fatPercent == null) return null;

  // محافظه‌کار: بازهٔ منطقی ۳-۶۰
  fatPercent = Math.max(3, Math.min(60, fatPercent));

  const musclePercent = estimateMusclePercent({
    fatPercent,
    gender,
    activityLevel: activityLevel ?? null,
  });

  return {
    fatPercent,
    musclePercent,
    measurementFatPercent: measurementFat,
    aiFatPercent: aiFat,
    method,
  };
}

/** برچسب فارسی منبع نقطهٔ ترکیب بدن (برای UI/لاگ) */
export function bodyCompositionSourceLabel(source: string): string {
  switch (source) {
    case "initial": return "ارزیابی اولیه";
    case "checkup": return "چکاپ دوره‌ای";
    case "body_analysis": return "تحلیل عکس بدن";
    default: return "ارزیابی";
  }
}

export type { Gender };
