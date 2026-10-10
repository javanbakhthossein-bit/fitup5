import { db } from "@/lib/db";

/**
 * v76 — منبع حقیقت واحد برای «وزن فعال کاربر»
 * ═══════════════════════════════════════════════════════════
 *
 * ریشهٔ باگ گزارش‌شده (تیکت «وزن اصلی من ۴۶ کیلوگرم هست ولی در برنامه وزنم
 * ۹۷ کیلوگرم خورده»):
 *   دو منبع وزن وجود دارد — OnboardingProfile.weight و WeightLog — که
 *   ناهمگام می‌شدند:
 *   ۱) کاربر در آنبوردینگ ۹۷ وارد کرد → WeightLog(97, «وزن اولیه»)
 *   ۲) برنامه با latestWeightLog = ۹۷ ساخته شد
 *   ۳) کاربر وزن را در پروفایل به ۴۶ اصلاح کرد — ولی هیچ WeightLog جدیدی
 *      ثبت نمی‌شد و WeightLog قدیمی (۹۷) همچنان «جدیدترین» بود
 *   ۴) تولیدهای بعدی هم همچنان ۹۷ می‌گرفتند (latestWeightLog اولویت داشت)
 *
 * راه‌حل سه‌لایه:
 *   الف) هنگام تغییر وزن در پروفایل/آنبوردینگ، WeightLog جدید ثبت می‌شود
 *        (به‌همراه ستون OnboardingProfile.weightUpdatedAt) — دو منبع همگام.
 *   ب) در خواندن، تعارض با مقایسهٔ زمانی حل می‌شود: هر منبعی که وزنش
 *        جدیدتر تنظیم شده مبناست (پروفایل: weightUpdatedAt؛ لاگ: loggedAt).
 *   پ) برنامه‌ها baseWeight (وزنِ لحظهٔ تولید) را ذخیره می‌کنند تا
 *        ناسازگاریِ برنامهٔ موجود با وزن فعلی قابل تشخیص و نمایش باشد.
 */

export type ActiveWeight = {
  /** وزن نهایی (kg) — null فقط وقتی هیچ داده‌ای وجود ندارد */
  weight: number | null;
  /** منبع مبنای تصمیم */
  source: "profile" | "weight_log" | "none";
};

/** ورودی خلاصه‌شده برای رزولور — تا در هر دو مسیر (DB مستقیم و دادهٔ پاس‌شده) قابل استفاده باشد */
export type WeightSourceInputs = {
  profileWeight: number | null | undefined;
  /** زمان آخرین تغییر وزن پروفایل (fallback: updatedAt پروفایل) */
  profileWeightUpdatedAt: Date | null | undefined;
  /** وزن آخرین WeightLog کاربر */
  lastLogWeight: number | null | undefined;
  /** زمان ثبت آخرین WeightLog */
  lastLogLoggedAt: Date | null | undefined;
};

/**
 * حل تعارض دو منبع وزن با قاعدهٔ «جدیدترین مبناست».
 * - اگر فقط پروفایل داشته باشیم → پروفایل
 * - اگر فقط لاگ داشته باشیم → لاگ
 * - اگر هر دو → هرکدام که وزنش جدیدتر به‌روز شده؛ در تساوی کامل، لاگ
 *   (چون ثبتِ آگاهانهٔ وزن‌کشی از ویرایش جانبیِ پروفایل معتبرتر است)
 */
export function resolveWeightFromInputs(inputs: WeightSourceInputs): ActiveWeight {
  const profileWeight =
    typeof inputs.profileWeight === "number" && Number.isFinite(inputs.profileWeight)
      ? inputs.profileWeight
      : null;
  const logWeight =
    typeof inputs.lastLogWeight === "number" && Number.isFinite(inputs.lastLogWeight)
      ? inputs.lastLogWeight
      : null;

  if (profileWeight == null && logWeight == null) return { weight: null, source: "none" };
  if (profileWeight == null) return { weight: logWeight, source: "weight_log" };
  if (logWeight == null) return { weight: profileWeight, source: "profile" };

  // هر دو موجود — مقایسهٔ زمانی
  const profileAt = inputs.profileWeightUpdatedAt ?? null;
  const logAt = inputs.lastLogLoggedAt ?? null;
  if (!logAt) return { weight: profileWeight, source: "profile" };
  if (!profileAt) return { weight: logWeight, source: "weight_log" };
  // تساوی زمانی → لاگ (ثبت آگاهانه)
  if (logAt.getTime() >= profileAt.getTime()) return { weight: logWeight, source: "weight_log" };
  return { weight: profileWeight, source: "profile" };
}

/**
 * وزن فعال کاربر را از DB می‌خواند و حل تعارض می‌کند.
 * جایگزین الگوی قدیمی `latestWeightLog?.weight ?? profile.weight` در همهٔ
 * مسیرها (تولید برنامه، چت، تحلیل‌ها) — یک منبع، یک منطق، بدون ناسازگاری.
 */
export async function resolveActiveWeight(userId: string): Promise<ActiveWeight> {
  const [profile, lastLog] = await Promise.all([
    db.onboardingProfile.findUnique({
      where: { userId },
      select: { weight: true, weightUpdatedAt: true },
    }),
    db.weightLog.findFirst({
      where: { userId },
      orderBy: { loggedAt: "desc" },
      select: { weight: true, loggedAt: true },
    }),
  ]);
  return resolveWeightFromInputs({
    profileWeight: profile?.weight,
    profileWeightUpdatedAt: profile?.weightUpdatedAt,
    lastLogWeight: lastLog?.weight,
    lastLogLoggedAt: lastLog?.loggedAt,
  });
}

/**
 * ثبت رکورد WeightLog برای تغییر وزن اعلامی کاربر (پروفایل/آنبوردینگ مجدد).
 * فقط وقتی وزن واقعاً تغییر کرده ثبت می‌شود تا نمودار پیشرفت شلوغ نشود.
 * بازگشت: true اگر رکورد ساخته شد.
 */
export async function logWeightChangeIfChanged(
  userId: string,
  newWeight: number,
  previousWeight: number | null | undefined,
  note: string
): Promise<boolean> {
  if (!Number.isFinite(newWeight)) return false;
  if (previousWeight != null && Math.abs(previousWeight - newWeight) < 0.05) return false;
  await db.weightLog.create({
    data: { userId, weight: newWeight, note },
  });
  return true;
}

/** حداقل اختلاف وزن (کیلوگرم) برای اینکه برنامه «ناسازگار» حساب شود */
export const WEIGHT_MISMATCH_THRESHOLD_KG = 2;

/**
 * تشخیص ناسازگاری وزنِ یک برنامه با وزن فعلی پروفایل.
 *
 * دو حالت:
 *  ۱) برنامه دارای اسنپ‌شات (baseWeight — v76 به بعد): ناسازگار اگر اختلاف با
 *     وزن فعلی پروفایل ≥ آستانه باشد.
 *  ۲) برنامه‌های قدیمیِ بدون اسنپ‌شات: اگر وزن پروفایل بعد از تولیدِ برنامه
 *     ویرایش شده باشد (weightUpdatedAt > planCreatedAt) — برنامه با دادهٔ
 *     قبلی ساخته شده و ممکن است دیگر معتبر نباشد.
 */
export function computePlanWeightMismatch(input: {
  baseWeight: number | null | undefined;
  planCreatedAt: Date | null | undefined;
  profileWeight: number | null | undefined;
  weightUpdatedAt: Date | null | undefined;
}): boolean {
  const { baseWeight, planCreatedAt, profileWeight, weightUpdatedAt } = input;
  if (typeof profileWeight !== "number" || !Number.isFinite(profileWeight)) return false;

  if (typeof baseWeight === "number" && Number.isFinite(baseWeight)) {
    return Math.abs(baseWeight - profileWeight) >= WEIGHT_MISMATCH_THRESHOLD_KG;
  }

  if (
    weightUpdatedAt instanceof Date &&
    planCreatedAt instanceof Date &&
    weightUpdatedAt.getTime() > planCreatedAt.getTime()
  ) {
    return true;
  }
  return false;
}
