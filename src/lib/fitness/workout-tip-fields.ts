

/**
 * v171 — تضمین فیلدهای «نکات تمرینی» (دیرکتیو مالک بعد از گزارش حذف‌شدن باکس‌ها)
 *
 * مشکل: برنامه‌هایی که AI فیلدهای tips (safetyNotes / recoveryNotes /
 * weeklyProgression / notes) را ناقص تحویل داده بود، در مدال برنامهٔ تمرینی
 * سکشن‌های «نکات ایمنی / ریکاوری / پیشرفت هفتگی» را اصلاً نشان نمی‌دادند
 * (WorkoutTipsSection برای سازگاری با عقب، سکشن خالی را رندر نمی‌کند).
 *
 * راه‌حل: یک لایهٔ قطعی (بدون AI) که هر برنامهٔ تمرینی را به حداقلِ کاملِ
 * محتوای آموزشی می‌رساند:
 *  • در تولید (runPlanQualityGate) → برنامهٔ جدید همیشه کامل ذخیره می‌شود.
 *  • در خواندن (program-history) → برنامه‌های قدیمیِ ناقص هم در نمایش کامل
 *    می‌شوند (بدون نوشتن در DB — نمایش-محور).
 *
 * محتوای پیش‌فرض‌ها اصول عمومی بدنسازی است (فرم > وزنه، اضافه‌بار تدریجی،
 * ریکاوری/خواب/آب) و با سکشن‌های همان برنامه تناقض نمی‌سازد.
 */

export interface WeeklyProgressionWeek {
  week: number;
  weightChangeKg?: number;
  repChange?: number;
  note?: string;
}

const DEFAULT_SAFETY_NOTES: string[] = [
  "قبل از هر جلسه ۵ تا ۸ دقیقه گرم‌کردن پویا (چرخش مفاصل، اسکوات وزن بدن، پلانک کوتاه) انجام بده و بعد از تمرین ۳ تا ۵ دقیقه سردکردن و کشش ایستا.",
  "وزنه را فقط وقتی افزایش بده که فرم حرکت با تکنیک درست و کنترل کامل حفظ شود — فرم درست همیشه از وزنهٔ سنگین‌تر مهم‌تر است.",
  "در صورت احساس درد تیز یا فشار غیرعادی در مفاصل، همان حرکت را متوقف کن و در اولین چکاپ به مربی گزارش بده.",
];

const DEFAULT_RECOVERY_NOTES: string[] = [
  "۷ تا ۹ ساعت خواب شبانه موتور اصلی ریکاوری و رشد عضله است — ساعت خواب و بیداری ثابت را حفظ کن.",
  "روزهای استراحت را کاملاً بی‌حرکت نگذران؛ ۲۰ تا ۳۰ دقیقه پیاده‌روی سبک ریکاوری را سریع‌تر می‌کند.",
  "آب کافی (حدود ۳۰ تا ۴۰ میلی‌لیتر به‌ازای هر کیلو وزن بدن) و پروتئین روزانه در روزهای استراحت هم باید ادامه داشته باشد.",
];

const DEFAULT_PROGRESSIVE_STRATEGY =
  "اضافه‌بار تدریجی: تنها وقتی وزنه اضافه کن که همهٔ ست‌ها با فرم درست و ۱ تا ۲ تکرارِ ذخیره انجام شده باشد؛ هفتهٔ آخر کمی سبک‌تر (deload) تا بدن برای چرخهٔ بعدی آماده شود.";

const DEFAULT_NOTES: string[] = [
  "🔥 کیفیت مهم‌تر از کمیت: در هر ست روی اتصال ذهن-عضله تمرکز کن و دامنهٔ حرکتی کامل را حفظ کن.",
  "📝 هر جلسه وزنه و تکرارها را یادداشت کن تا هفتهٔ بعد دقیقاً بدانی از کجا باید پیشرفت کنی.",
  "⏱ استراحت بین ست‌های حرکات پایه ۹۰ تا ۱۲۰ ثانیه و بین ست‌های ایزوله حدود ۶۰ ثانیه باشد.",
];

/** جدول ۶ هفته‌ای استاندارد برنامهٔ ۴۵ روزه (اضافه‌بار تدریجی محافظه‌کارانه) */
function defaultProgressionWeeks(): WeeklyProgressionWeek[] {
  return [
    { week: 1, weightChangeKg: 0, repChange: 0, note: "هفتهٔ تثبیت — وزنهٔ مناسب هر حرکت را پیدا کن و فرم را قفل کن" },
    { week: 2, weightChangeKg: 1.25, repChange: 0, note: "افزایش جزئی وزنه در حرکات پایه اگر فرم حفظ شد" },
    { week: 3, weightChangeKg: 0, repChange: 1, note: "در همان وزنه، ۱ تکرار بیشتر در هر ست" },
    { week: 4, weightChangeKg: 1.25, repChange: 0, note: "افزایش وزنهٔ حرکات پایه (اسکوات/پرس/ددلیفت)" },
    { week: 5, weightChangeKg: 0, repChange: 1, note: "فشار بیشتر: ۱ تکرار بیشتر یا ۱۵ ثانیه استراحت کمتر" },
    { week: 6, weightChangeKg: 0, repChange: 0, note: "هفتهٔ سبک (deload) — وزنه حدود ۱۰٪ کمتر برای ریکاوری کامل" },
  ];
}

function isFilledStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.some((s) => typeof s === "string" && s.trim().length > 0);
}

/**
 * فیلدهای نکاتِ غایب برنامهٔ تمرینی را پر می‌کند.
 * @returns true اگر چیزی اضافه شد (باید ذخیره/رفرش شود) — فیلدهای موجود هرگز بازنویسی نمی‌شوند.
 */
export function ensureWorkoutTipFields(
  workout: Record<string, unknown> | null | undefined,
  opts?: { weeks?: number }
): boolean {
  if (!workout || typeof workout !== "object") return false;
  let changed = false;

  if (!isFilledStringArray(workout.safetyNotes)) {
    workout.safetyNotes = [...DEFAULT_SAFETY_NOTES];
    changed = true;
  }
  if (!isFilledStringArray(workout.recoveryNotes)) {
    workout.recoveryNotes = [...DEFAULT_RECOVERY_NOTES];
    changed = true;
  }
  if (!isFilledStringArray(workout.notes) && (typeof workout.notes !== "string" || !String(workout.notes).trim())) {
    workout.notes = DEFAULT_NOTES.map((n) => `- ${n}`).join("\n");
    changed = true;
  }
  const wp = workout.weeklyProgression as { strategy?: unknown; weeks?: unknown } | null | undefined;
  const hasWeeks = Array.isArray(wp?.weeks) && (wp?.weeks as unknown[]).length > 0;
  const hasStrategy = typeof wp?.strategy === "string" && !!wp?.strategy.trim();
  if (!hasWeeks || !hasStrategy) {
    workout.weeklyProgression = {
      strategy: hasStrategy ? wp?.strategy : DEFAULT_PROGRESSIVE_STRATEGY,
      weeks: hasWeeks ? wp?.weeks : (opts?.weeks ? defaultProgressionWeeks().slice(0, opts.weeks) : defaultProgressionWeeks()),
    };
    changed = true;
  }
  return changed;
}
