import { db } from "@/lib/db";
import { resolveWeightFromInputs } from "@/lib/fitness/active-weight";
import { toPersianDigits, PERSIAN_WEEKDAYS } from "@/lib/fitness/types";
import { buildUserContext } from "@/lib/fitness/ai";
import type { OnboardingData, Plan } from "@/lib/fitness/types";

/**
 * ─── پرونده ورزشی کاربر — کانتکست بودجه‌دار برای هوش مصنوعی (v53) ───
 *
 * خواستهٔ مالک: «هر چیزی که کاربر تمرین می‌کند و ثبت می‌کند باید خیلی ریز داخل
 * پرونده ورزشی تزریق بشه تا تحلیل‌های AI بهش اشراف داشته باشه؛ ولی مراقب طول
 * پرامپت باشیم — کاربر ممکنه ۶-۷ ماه یا حتی ۲ سال فعال باشه و پرونده‌اش آنقدر
 * سنگین بشه که AI نتونه پرامپت رو هندل کنه.»
 *
 * راه‌حل: یک بیلدر واحد که «همهٔ» تاریخچه کاربر را تزریق می‌کند ولی خروجی آن
 * سقف سخت کاراکتری دارد (پیش‌فرض ۹۰۰۰):
 *   • ۳۰ روز اخیر → روزبه‌روز (تغذیه از FoodLog با groupBy سمت SQL، تمرین از
 *     DayCompletion/WorkoutDayStatus، وزن‌های داخل پنجره)
 *   • ماه ۲ تا ۱۲ → جمع‌بندی ماهانه (میانگین کالری/پروتئین، روزهای تمرین، مسیر وزن)
 *   • قدیمی‌تر از ۱۲ ماه → یک خط به‌ازای هر سه‌ماهه (کاربر ۲ ساله هم ۸ خط بیشتر ندارد)
 *   • چکاپ‌ها → ۳ مورد آخر با جزئیات + یک خط روند برای قدیمی‌ترها
 *   • استریک پیوستگی (تمرین+تغذیه کامل روزهای متوالی)
 *
 * هیچ جدولی کامل خوانده نمی‌شود؛ همهٔ کوئری‌ها با where بازهٔ تاریخ/رشتهٔ تاریخ
 * و take سقف‌دار یا groupBy (یک سطر به‌ازای هر روزِ ثبت‌شده) اجرا می‌شوند.
 * اگر خروجی از بودجه عبور کند، قدیمی‌ترین بخش‌ها مرحله‌به‌مرحله خلاصه/حذف
 * می‌شوند و در انتها برش سخت با نشانگر «… (بخش‌های قدیمی‌تر خلاصه شد)».
 *
 * مرز روز = نیمه‌شب تهران (UTC+03:30 ثابت — هم‌قرارداد با /api/nutrition/log).
 * ماه‌های میانی میلادی بسته‌بندی می‌شوند ولی برچسب‌ها با Intl فارسی (مرداد ۱۴۰۴…).
 */

/** سقف پیش‌فرض پروندهٔ کامل (کاراکتر) */
export const SPORTS_PROFILE_MAX_CHARS = 9000;
/** سقف خلاصهٔ فشرده برای تولید برنامه (کاراکتر) */
export const COMPACT_SUMMARY_MAX_CHARS = 1500;

const TRUNCATION_MARK = "… (بخش‌های قدیمی‌تر خلاصه شد)";
const DAY_MS = 24 * 60 * 60 * 1000;

const pd = (v: string | number): string => toPersianDigits(v);

// ─── مرز روز به‌وقت تهران (UTC+03:30 ثابت — هم‌قرارداد با /api/nutrition/log) ───

/** تاریخ امروز تهران به شکل YYYY-MM-DD (en-CA خروجی ISO-like می‌دهد) */
function tehranTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date());
}

/** کلید روزِ تهران (YYYY-MM-DD) برای هر لحظه — کلید یکسان‌سازی همهٔ مدل‌ها */
function tehranDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
}

/** نیمه‌شب تهران برای رشتهٔ YYYY-MM-DD به‌صورت Date جهانی */
function tehranDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+03:30`);
}

/** نمایش جلالی تاریخ (مثل ۱۴۰۴/۰۶/۱۲) با ارقام فارسی */
function jalali(d: Date): string {
  return new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran" }).format(d);
}

// ─── کلید ماه میلادی (YYYY-MM) و برچسب فارسی آن ───

function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function addMonthsKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** برچسب فارسی ماه (مثل «مرداد ۱۴۰۵») از کلید YYYY-MM — نیمهٔ ماه به‌عنوان نماینده */
function monthLabelFa(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const mid = new Date(Date.UTC(y, m - 1, 15, 12));
  const monthName = new Intl.DateTimeFormat("fa-IR", { month: "long", timeZone: "UTC" }).format(mid);
  const yearFa = new Intl.DateTimeFormat("fa-IR", { year: "numeric", timeZone: "UTC" }).format(mid);
  return `${monthName} ${yearFa}`;
}

/** تعداد روزهای واقعی یک ماه میلادی */
function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ─── برچسب‌های فارسی ───

const MEAL_LABELS: Record<string, string> = {
  breakfast: "صبحانه",
  lunch: "ناهار",
  dinner: "شام",
  snack: "میان‌وعده",
};

const WORKOUT_SOURCE_LABELS: Record<string, string> = {
  gym_mode: "حالت باشگاه",
  guided_session: "جلسهٔ هدایت‌شده",
};

const WDS_STATUS_LABELS: Record<string, string> = {
  completed: "تمرین ✓",
  skipped: "تمرین جابه‌جا شد",
  rest_as_planned: "استراحت طبق برنامه",
};

const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toString();

const signed = (n: number): string => pd(`${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt1(Math.abs(n))}`);

// ─── تایپ‌های ورودی عمومی ───

export interface CheckupLike {
  phaseNumber: number;
  isFinalCheckup?: boolean;
  weight: number;
  chestMeasurement?: number | null;
  armMeasurement?: number | null;
  waistMeasurement?: number | null;
  hipMeasurement?: number | null;
  thighMeasurement?: number | null;
  neckMeasurement?: number | null;
  bodyFatPercent?: number | null;
  leanBodyMass?: number | null;
  fatigueLevel?: number | null;
  sleepQuality?: number | null;
  dietAdherence?: number | null;
  workoutAdherence?: number | null;
  createdAt: Date | string;
}

export interface SportsProfileOptions {
  /** سقف سخت کاراکتر خروجی (پیش‌فرض ۹۰۰۰) */
  maxChars?: number;
  /** بخش «پروفایل ثابت» (buildUserContext) هم داخل خروجی باشد؟
   *  پیش‌فرض true. در چت مربی false بدهید چون aiChat خودش buildUserContext را
   *  در system prompt تزریق می‌کند (جلوگیری از دوباره‌گویی و هدررفت توکن). */
  includeStaticProfile?: boolean;
}

// ─── بخش چکاپ‌ها (مشترک بین پروندهٔ کامل و تحلیل جامع) ───

/**
 * ساخت بخش «چکاپ‌های دوره‌ای»: ۳ چکاپ آخر با جزئیات + یک خط روند کلی
 * (اولین در برابر آخرین). ورودی هر تعداد چکاپ باشد، خروجی همیشه کوتاه می‌ماند —
 * این تابع مرز «لیست بی‌پایان چکاپ‌ها» در پرامپت‌هاست.
 */
export function buildCheckupSection(checkups: CheckupLike[]): string {
  if (!checkups || checkups.length === 0) return "";
  try {
    const sorted = [...checkups].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const detail = sorted.slice(-3); // فقط ۳ مورد آخر جزئیات می‌گیرند
    const lines: string[] = [];

    for (const c of detail) {
      const parts = [
        `فاز ${pd(c.phaseNumber)}${c.isFinalCheckup ? " (نهایی)" : ""} (${jalali(new Date(c.createdAt))})`,
        `وزن ${pd(fmt1(c.weight))}kg`,
      ];
      if (c.bodyFatPercent != null) parts.push(`چربی ${pd(fmt1(c.bodyFatPercent))}٪`);
      if (c.leanBodyMass != null) parts.push(`عضلهٔ خالص ${pd(fmt1(c.leanBodyMass))}kg`);
      if (c.waistMeasurement != null) parts.push(`کمر ${pd(fmt1(c.waistMeasurement))}cm`);
      if (c.armMeasurement != null) parts.push(`بازو ${pd(fmt1(c.armMeasurement))}cm`);
      if (c.chestMeasurement != null) parts.push(`سینه ${pd(fmt1(c.chestMeasurement))}cm`);
      if (c.thighMeasurement != null) parts.push(`ران ${pd(fmt1(c.thighMeasurement))}cm`);
      if (c.workoutAdherence != null) parts.push(`تمرین ${pd(c.workoutAdherence)}/۵`);
      if (c.dietAdherence != null) parts.push(`رژیم ${pd(c.dietAdherence)}/۵`);
      if (c.sleepQuality != null) parts.push(`خواب ${pd(c.sleepQuality)}/۵`);
      if (c.fatigueLevel != null) parts.push(`خستگی ${pd(c.fatigueLevel)}/۵`);
      lines.push(`• ${parts.join(" | ")}`);
    }

    // روند کلی: اولین در برابر آخرین (قدیمی‌ترهای خارج از ۳ مورد آخر هم پوشش داده می‌شوند)
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (sorted.length > 1 && new Date(first.createdAt).getTime() !== new Date(last.createdAt).getTime()) {
      const trend: string[] = [];
      const delta = (a?: number | null, b?: number | null, unit = "") =>
        a != null && b != null && a !== b ? `${pd(fmt1(a))}→${pd(fmt1(b))} (${signed(b - a)}${unit})` : null;
      const w = delta(first.weight, last.weight, "kg");
      if (w) trend.push(`وزن ${w}`);
      const bf = delta(first.bodyFatPercent, last.bodyFatPercent, "٪");
      if (bf) trend.push(`چربی ${bf}`);
      const waist = delta(first.waistMeasurement, last.waistMeasurement, "cm");
      if (waist) trend.push(`کمر ${waist}`);
      if (trend.length > 0) {
        lines.push(
          `• روند از اولین چکاپ (${jalali(new Date(first.createdAt))}) تا کنون: ${trend.join(" · ")}` +
            (sorted.length > 3 ? ` — مجموع ${pd(sorted.length)} چکاپ ثبت شده` : "")
        );
      }
    }

    return `🩺 چکاپ‌های دوره‌ای (۳ مورد آخر + روند):\n${lines.join("\n")}`;
  } catch (e) {
    console.error("[sports-profile] buildCheckupSection failed:", e);
    return "";
  }
}

// ─── جمع‌بندی کمکی: تبدیل OnboardingProfile به OnboardingData (آینهٔ buildOnboardingData) ───
/**
 * نسخهٔ محلی مونتاژ OnboardingData — عمداً از program-generation.ts ایمپورت
 * نمی‌شود تا زنجیرهٔ ایمپورت حلقه‌ای نشود (program-generation این ماژول را
 * فراخوانی می‌کند). آخرین وزن از WeightLog (که جداگانه خوانده شده) پاس داده می‌شود.
 */
function profileToOnboardingData(
  profile: NonNullable<Awaited<ReturnType<typeof db.onboardingProfile.findUnique>>>,
  currentWeight: number | null
): OnboardingData {
  const safeParseList = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return p.map((x) => String(x));
      if (typeof p === "string") return p.split(",").map((s) => s.trim()).filter(Boolean);
      return [];
    } catch {
      return t.split(",").map((s) => s.trim()).filter(Boolean);
    }
  };
  const w = currentWeight ?? profile.weight ?? 70;
  let adj = 0;
  const al = profile.activityLevel;
  if (al === "active" || al === "very_active") adj = 500;
  else if (al === "moderate") adj = 250;

  return {
    gender: profile.gender as OnboardingData["gender"],
    age: profile.age,
    height: profile.height,
    weight: w,
    targetWeight: profile.targetWeight ?? undefined,
    goal: profile.goal as OnboardingData["goal"],
    activityLevel: profile.activityLevel as OnboardingData["activityLevel"],
    workoutDays: profile.workoutDays,
    workoutDaysList: safeParseList(profile.workoutDaysList),
    workoutPlace: profile.workoutPlace as OnboardingData["workoutPlace"],
    equipment: safeParseList(profile.equipment),
    diseases: profile.diseases,
    injuries: profile.injuries,
    allergies: profile.allergies,
    dietType: profile.dietType as OnboardingData["dietType"],
    trainingExperience: (profile.trainingExperience ?? undefined) as OnboardingData["trainingExperience"],
    previousTrainingType: profile.previousTrainingType ?? undefined,
    drugAllergies: profile.drugAllergies ?? undefined,
    currentMedications: profile.currentMedications ?? undefined,
    maxLifts: profile.maxLifts ?? undefined,
    bodyFrame: (profile.bodyFrame ?? undefined) as OnboardingData["bodyFrame"],
    sleepHours: profile.sleepHours ?? undefined,
    stressLevel: profile.stressLevel ?? undefined,
    waterHabit: profile.waterHabit ?? undefined,
    targetDate: profile.targetDate ?? undefined,
    workoutTime: (profile.workoutTime ?? undefined) as OnboardingData["workoutTime"],
    medicalConditions: safeParseList(profile.medicalConditions) as OnboardingData["medicalConditions"],
    currentSupplements: profile.currentSupplements ?? undefined,
    dislikedFoods: profile.dislikedFoods ?? undefined,
    preferredCuisine: (profile.preferredCuisine ?? undefined) as OnboardingData["preferredCuisine"],
    // v74 — یادداشت‌های تغذیه‌ای کاربر (ستون OnboardingProfile.nutritionNotes)
    // تا پروندهٔ ورزشی/چت مربی هم این قیدهای تغذیه‌ای را ببیند (آینهٔ buildOnboardingData)
    nutritionNotes: profile.nutritionNotes ?? undefined,
    // v75 — رشتهٔ ورزشی — در چت با فیتاپ و پروندهٔ ورزشی لحاظ می‌شود
    discipline: (profile.discipline ?? undefined) as OnboardingData["discipline"],
    waterGoalMl: Math.round(w * 35) + adj,
  };
}

// ─── نرمال‌سازی خروجی groupBy FoodLog ───

interface DayNutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: Set<string>;
  entries: number;
}

function nutritionKeyMap(
  rows: {
    day: Date;
    meal?: string;
    _sum: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
    _count: { _all: number };
  }[]
): Map<string, DayNutrition> {
  const map = new Map<string, DayNutrition>();
  for (const r of rows) {
    const key = tehranDateStr(new Date(r.day));
    let cur = map.get(key);
    if (!cur) {
      cur = { kcal: 0, protein: 0, carbs: 0, fat: 0, meals: new Set(), entries: 0 };
      map.set(key, cur);
    }
    cur.kcal += r._sum.calories ?? 0;
    cur.protein += r._sum.protein ?? 0;
    cur.carbs += r._sum.carbs ?? 0;
    cur.fat += r._sum.fat ?? 0;
    cur.entries += r._count?._all ?? 0;
    if (r.meal) cur.meals.add(r.meal);
  }
  return map;
}

/** تاریخ دقیق رکورد WorkoutDayStatus از هفتهٔ شروع + نام روز فارسی */
function wdsDateKey(weekStart: Date, dayName: string): string {
  const idx = Math.max(0, PERSIAN_WEEKDAYS.indexOf(dayName));
  return tehranDateStr(new Date(new Date(weekStart).getTime() + idx * DAY_MS));
}

// ─── بیلدر اصلی ───

/**
 * پرونده ورزشی کاربر — تاریخچهٔ کامل با سقف سخت کاراکتری.
 *
 * ساختار خروجی (فارسی):
 *  ۱) پروفایل ثابت (اختیاری — includeStaticProfile)
 *  ۲) ۳۰ روز اخیر روزبه‌روز (تغذیه + تمرین + وزن)
 *  ۳) جمع‌بندی ماهانه (ماه ۲ تا ۱۲)
 *  ۴) سه‌ماهه‌های قدیمی‌تر از ۱۲ ماه
 *  ۵) چکاپ‌ها (۳ آخر + روند)
 *  ۶) استریک پیوستگی
 */
export async function buildSportsProfileContext(
  userId: string,
  opts?: SportsProfileOptions
): Promise<string> {
  const maxChars = Math.max(1500, opts?.maxChars ?? SPORTS_PROFILE_MAX_CHARS);
  const includeStaticProfile = opts?.includeStaticProfile !== false;

  try {
    // ── مرزهای زمانی ──
    const todayStr = tehranTodayStr();
    const windowStart = new Date(tehranDayStart(todayStr).getTime() - 29 * DAY_MS); // ۳۰ روز اخیر
    const currentMonthKey = monthKeyOf(todayStr);
    const currentMonthStart = tehranDayStart(`${currentMonthKey}-01`);
    const m12Key = addMonthsKey(currentMonthKey, -12); // قدیمی‌ترین ماهِ بخش ماهانه
    const monthWindowStart = tehranDayStart(`${m12Key}-01`);

    // ── همهٔ کوئری‌ها موازی و سقف‌دار (هیچ جدولی کامل خوانده نمی‌شود) ──
    const [
      foodWindowRows,
      foodMonthRows,
      foodOlderRows,
      dcRecent,
      dcMonthly,
      dcOlder,
      wdsRecent,
      wdsMonthly,
      wdsOlder,
      weightsDesc,
      checkups,
      profile,
      userRow,
    ] = await Promise.all([
      // ۳۰ روز اخیر — تفکیک وعده برای شمارش «وعده»ها (حداکثر ~۱۲۰ سطر)
      db.foodLog.groupBy({
        by: ["day", "meal"],
        where: { userId, day: { gte: windowStart } },
        _sum: { calories: true, protein: true, carbs: true, fat: true },
        _count: { _all: true },
        orderBy: { day: "asc" },
      }),
      // ماه ۲ تا ۱۲ — یک سطر به‌ازای هر روزِ ثبت‌شده (حداکثر ~۳۶۵ سطر)
      db.foodLog.groupBy({
        by: ["day"],
        where: { userId, day: { gte: monthWindowStart, lt: currentMonthStart } },
        _sum: { calories: true, protein: true, carbs: true, fat: true },
        _count: { _all: true },
        orderBy: { day: "asc" },
        take: 400,
      }),
      // قدیمی‌تر از ۱۲ ماه — یک سطر به‌ازای هر روز (کاربر ۲ ساله ≈ ۷۳۰ سطر)
      db.foodLog.groupBy({
        by: ["day"],
        where: { userId, day: { lt: monthWindowStart } },
        _sum: { calories: true, protein: true, carbs: true, fat: true },
        _count: { _all: true },
        orderBy: { day: "asc" },
        take: 1500,
      }),
      // DayCompletion — روزانه حداکثر ۱ سطر (امن برای خواندن)
      db.dayCompletion.findMany({
        where: { userId, date: { gte: tehranDateStr(new Date(tehranDayStart(todayStr).getTime() - 59 * DAY_MS)) } },
        select: { date: true, workoutDone: true, workoutSource: true, nutritionDone: true },
        orderBy: { date: "asc" },
      }),
      db.dayCompletion.findMany({
        where: { userId, date: { gte: `${m12Key}-01`, lt: `${currentMonthKey}-01` } },
        select: { date: true, workoutDone: true, workoutSource: true, nutritionDone: true },
        orderBy: { date: "asc" },
        take: 400,
      }),
      db.dayCompletion.findMany({
        where: { userId, date: { lt: `${m12Key}-01` } },
        select: { date: true, workoutDone: true, workoutSource: true, nutritionDone: true },
        orderBy: { date: "asc" },
        take: 800,
      }),
      // WorkoutDayStatus — حداکثر ۷ سطر در هفته
      db.workoutDayStatus.findMany({
        where: { userId, createdAt: { gte: new Date(windowStart.getTime() - 7 * DAY_MS) } },
        select: { dayName: true, weekStart: true, status: true, movedTo: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      db.workoutDayStatus.findMany({
        where: { userId, createdAt: { gte: monthWindowStart, lt: currentMonthStart } },
        select: { dayName: true, weekStart: true, status: true, movedTo: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 400,
      }),
      db.workoutDayStatus.findMany({
        where: { userId, createdAt: { lt: monthWindowStart } },
        select: { dayName: true, weekStart: true, status: true, movedTo: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 800,
      }),
      // وزن‌ها — آخرین ۱۰۰۰ ثبت (کاربر واقعی به‌ندرت از این عبور می‌کند)
      db.weightLog.findMany({
        where: { userId },
        orderBy: { loggedAt: "desc" },
        select: { weight: true, loggedAt: true },
        take: 1000,
      }),
      // چکاپ‌ها — فازمحور و طبیعتاً کم؛ سقف ۲۴ برای اطمینان
      db.checkup.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          phaseNumber: true, isFinalCheckup: true, weight: true,
          chestMeasurement: true, armMeasurement: true, waistMeasurement: true,
          hipMeasurement: true, thighMeasurement: true, neckMeasurement: true,
          bodyFatPercent: true, leanBodyMass: true,
          fatigueLevel: true, sleepQuality: true, dietAdherence: true, workoutAdherence: true,
          createdAt: true,
        },
        take: 24,
      }),
      db.onboardingProfile.findUnique({ where: { userId } }),
      db.user.findUnique({ where: { id: userId }, select: { planName: true } }),
    ]);

    const weightsAsc = [...weightsDesc].reverse(); // قدیمی → جدید
    const latestLog = weightsAsc.length > 0 ? weightsAsc[weightsAsc.length - 1] : null;
    // v76 — رزولور مرکزی وزن: تعارض پروفایل/WeightLog با مقایسهٔ زمانی حل می‌شود
    // (قبلاً آخرین لاگ همیشه اولویت داشت — ریشهٔ باگ «وزن ۹۷ در برنامه با پروفایل ۴۶»)
    const activeWeight = resolveWeightFromInputs({
      profileWeight: profile?.weight,
      profileWeightUpdatedAt: profile?.weightUpdatedAt,
      lastLogWeight: latestLog?.weight,
      lastLogLoggedAt: latestLog?.loggedAt,
    });
    const latestWeight = activeWeight.weight;

    // ── ۱) پروفایل ثابت ──
    const sections: { key: string; header?: string; lines: string[] }[] = [];
    if (includeStaticProfile) {
      try {
        if (profile) {
          const ctx = buildUserContext(
            profileToOnboardingData(profile, latestWeight),
            (userRow?.planName as Plan) ?? null
          );
          if (ctx) {
            // فشرده‌سازی خطوط خالیِ فیلدهای اختیاریِ پرنشده (کاهش بودجه بدون از دست دادن اطلاعات)
            sections.push({ key: "profile", lines: ctx.replace(/\n{3,}/g, "\n\n").split("\n") });
          }
        }
      } catch (e) {
        console.error("[sports-profile] static profile section failed:", e);
      }
    }

    // ── داده‌های کمکی برای خطوط روزانه ──
    const nutrition = nutritionKeyMap(foodWindowRows as never);
    const workoutByDate = new Map<string, string>();
    for (const r of dcRecent) {
      workoutByDate.set(
        r.date,
        r.workoutDone
          ? `تمرین ✓${r.workoutSource ? ` (${WORKOUT_SOURCE_LABELS[r.workoutSource] || r.workoutSource})` : ""}`
          : "تمرین ✗"
      );
    }
    for (const r of wdsRecent) {
      const key = wdsDateKey(r.weekStart, r.dayName);
      if (!workoutByDate.has(key)) {
        workoutByDate.set(
          key,
          WDS_STATUS_LABELS[r.status] || r.status + (r.status === "skipped" && r.movedTo ? ` به ${r.movedTo}` : "")
        );
      }
    }
    const weightByDate = new Map<string, number>();
    for (const w of weightsAsc) {
      weightByDate.set(tehranDateStr(new Date(w.loggedAt)), w.weight);
    }

    // ── ۲) ۳۰ روز اخیر — روزبه‌روز (قدیمی → جدید) ──
    {
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(windowStart.getTime() + i * DAY_MS);
        const key = tehranDateStr(d);
        const n = nutrition.get(key);
        const wo = workoutByDate.get(key);
        const wt = weightByDate.get(key);
        if (!n && !wo && wt == null) continue; // روز کاملاً خالی — بدون نویز
        const parts: string[] = [];
        if (n && n.kcal > 0) {
          parts.push(
            `${pd(Math.round(n.kcal))} کالری · پ ${pd(Math.round(n.protein))} · ک ${pd(Math.round(n.carbs))} · چ ${pd(Math.round(n.fat))} · ${pd(n.meals.size)} وعده`
          );
        }
        if (wo) parts.push(wo);
        if (wt != null) parts.push(`وزن ${pd(fmt1(wt))}kg`);
        if (parts.length > 0) lines.push(`${jalali(d)}: ${parts.join(" · ")}`);
      }
      if (lines.length > 0) sections.push({ key: "recent30", header: "📅 ۳۰ روز اخیر (روزبه‌روز):", lines });
    }

    // ── ۳) جمع‌بندی ماهانه (ماه ۲ تا ۱۲ — قدیمی → جدید) ──
    {
      const nutritionMonths = nutritionKeyMap(foodMonthRows as never);
      const monthKeys: string[] = [];
      for (let i = 1; i <= 12; i++) monthKeys.push(addMonthsKey(currentMonthKey, -i));
      const lines: string[] = [];
      for (const mk of monthKeys) {
        const parts: string[] = [];
        const agg = [...nutritionMonths.entries()].filter(([d]) => monthKeyOf(d) === mk);
        if (agg.length > 0) {
          const totKcal = agg.reduce((s, [, v]) => s + v.kcal, 0);
          const totP = agg.reduce((s, [, v]) => s + v.protein, 0);
          parts.push(
            `میانگین ${pd(Math.round(totKcal / agg.length))} کالری/روز · پ ${pd(Math.round(totP / agg.length))}g · ${pd(agg.length)} روز ثبت`
          );
        }
        // تمرین: اولویت DayCompletion؛ در نبودش WorkoutDayStatus (ماه‌های قبل از v52)
        const dcRows = dcMonthly.filter((r) => monthKeyOf(r.date) === mk);
        const doneDc = dcRows.filter((r) => r.workoutDone).length;
        if (dcRows.length > 0) {
          parts.push(`تمرین ${pd(doneDc)} روز از ${pd(daysInMonth(mk))}`);
        } else {
          const wdsRows = wdsMonthly.filter(
            (r) => monthKeyOf(tehranDateStr(new Date(r.createdAt))) === mk
          );
          if (wdsRows.length > 0) {
            const done = wdsRows.filter((r) => r.status === "completed").length;
            parts.push(`ثبت تمرین ${pd(done)}/${pd(wdsRows.length)}`);
          }
        }
        const monthWeights = weightsAsc.filter((w) => monthKeyOf(tehranDateStr(new Date(w.loggedAt))) === mk);
        if (monthWeights.length === 1) {
          parts.push(`وزن ${pd(fmt1(monthWeights[0].weight))}kg`);
        } else if (monthWeights.length > 1) {
          const a = monthWeights[0].weight;
          const b = monthWeights[monthWeights.length - 1].weight;
          parts.push(`وزن ${pd(fmt1(a))}→${pd(fmt1(b))} (${signed(b - a)})`);
        }
        if (parts.length > 0) lines.push(`${monthLabelFa(mk)}: ${parts.join(" · ")}`);
      }
      if (lines.length > 0) sections.push({ key: "monthly", header: "🗓 جمع‌بندی ماهانه (ماه‌های ۲ تا ۱۲):", lines });
    }

    // ── ۴) قدیمی‌تر از ۱۲ ماه — یک خط به‌ازای هر سه‌ماهه ──
    {
      const oldNutrition = nutritionKeyMap(foodOlderRows as never);
      const quarterAgg = new Map<string, { kcal: number; protein: number; days: number; first?: [string, number]; last?: [string, number] }>();
      for (const [d, v] of oldNutrition) {
        const [y, m] = d.split("-").map(Number);
        const qk = `${y}-Q${Math.ceil(m / 3)}`;
        let q = quarterAgg.get(qk);
        if (!q) {
          q = { kcal: 0, protein: 0, days: 0 };
          quarterAgg.set(qk, q);
        }
        q.kcal += v.kcal;
        q.protein += v.protein;
        q.days += 1;
      }
      // تمرین و وزن قدیمی‌تر
      const oldDcDone = new Map<string, number>();
      for (const r of dcOlder) {
        if (!r.workoutDone) continue;
        const [y, m] = r.date.split("-").map(Number);
        const qk = `${y}-Q${Math.ceil(m / 3)}`;
        oldDcDone.set(qk, (oldDcDone.get(qk) || 0) + 1);
      }
      const oldWds = new Map<string, { done: number; total: number }>();
      for (const r of wdsOlder) {
        const dStr = tehranDateStr(new Date(r.createdAt));
        const [y, m] = dStr.split("-").map(Number);
        const qk = `${y}-Q${Math.ceil(m / 3)}`;
        const cur = oldWds.get(qk) || { done: 0, total: 0 };
        cur.total += 1;
        if (r.status === "completed") cur.done += 1;
        oldWds.set(qk, cur);
      }
      const oldWeights = new Map<string, number[]>();
      for (const w of weightsAsc) {
        const dStr = tehranDateStr(new Date(w.loggedAt));
        if (new Date(w.loggedAt).getTime() >= monthWindowStart.getTime()) continue;
        const [y, m] = dStr.split("-").map(Number);
        const qk = `${y}-Q${Math.ceil(m / 3)}`;
        const arr = oldWeights.get(qk) || [];
        arr.push(w.weight);
        oldWeights.set(qk, arr);
      }
      const lines: string[] = [];
      for (const qk of [...quarterAgg.keys()].sort()) {
        const q = quarterAgg.get(qk)!;
        const parts: string[] = [
          `میانگین ${pd(Math.round(q.kcal / q.days))} کالری/روز · پ ${pd(Math.round(q.protein / q.days))}g · ${pd(q.days)} روز ثبت`,
        ];
        const dc = oldDcDone.get(qk);
        const wds = oldWds.get(qk);
        if (dc) parts.push(`تمرین ${pd(dc)} روز`);
        else if (wds) parts.push(`ثبت تمرین ${pd(wds.done)}/${pd(wds.total)}`);
        const ws = oldWeights.get(qk);
        if (ws && ws.length > 1) parts.push(`وزن ${pd(fmt1(ws[0]))}→${pd(fmt1(ws[ws.length - 1]))} (${signed(ws[ws.length - 1] - ws[0])})`);
        else if (ws && ws.length === 1) parts.push(`وزن ${pd(fmt1(ws[0]))}kg`);
        lines.push(`${pd(`فصل ${qk.split("-Q")[1]} سال ${qk.split("-")[0]}`)}: ${parts.join(" · ")}`);
      }
      if (lines.length > 0) sections.push({ key: "quarterly", header: "🕰 قدیمی‌تر از ۱۲ ماه (خلاصهٔ فصلی):", lines });
    }

    // ── ۵) چکاپ‌ها ──
    {
      const cs = buildCheckupSection(checkups);
      if (cs) sections.push({ key: "checkups", lines: cs.split("\n") });
    }

    // ── ۶) استریک پیوستگی (روزهای متوالی تمرین+تغذیه کامل، سقف نمایش ۳۰) ──
    try {
      const complete = new Set(dcRecent.filter((r) => r.workoutDone && r.nutritionDone).map((r) => r.date));
      let streak = 0;
      // اگر امروز هنوز کامل نشده، از دیروز شمارش را ادامه بده (روز جاری ناتمام است)
      let cursor = complete.has(todayStr) ? tehranDayStart(todayStr) : new Date(tehranDayStart(todayStr).getTime() - DAY_MS);
      while (complete.has(tehranDateStr(cursor)) && streak < 365) {
        streak++;
        cursor = new Date(cursor.getTime() - DAY_MS);
      }
      if (streak > 0) {
        sections.push({
          key: "streak",
          lines: [
            `🔥 پیوستگی فعال: ${pd(Math.min(streak, 30))} روز متوالی تمرین+تغذیهٔ کامل${streak > 30 ? " (نمایش تا سقف ۳۰)" : ""}`,
          ],
        });
      }
    } catch (e) {
      console.error("[sports-profile] streak section failed:", e);
    }

    // ── مونتاژ با بودجهٔ سخت ──
    const HEADER = "═══ پرونده ورزشی کاربر (تاریخچه کامل) ═══";
    const render = (): string => {
      const body = sections
        .filter((s) => s.lines.length > 0)
        .map((s) => (s.header ? `${s.header}\n${s.lines.join("\n")}` : s.lines.join("\n")))
        .join("\n\n");
      return body ? `${HEADER}\n${body}` : "";
    };

    const degradeStep = (): boolean => {
      const find = (k: string) => sections.find((s) => s.key === k);
      // ترتیب قربانی‌ها: فصلی‌ها → ماهانه → ریز ۳۰ روزه → پروفایل ثابت
      const q = find("quarterly");
      if (q && q.lines.length > 2) {
        q.lines = [q.lines[0], TRUNCATION_MARK, ...q.lines.slice(-2)];
        return true;
      }
      const m = find("monthly");
      if (m && m.lines.length > 6) {
        m.lines = [TRUNCATION_MARK, ...m.lines.slice(-6)];
        return true;
      }
      if (q) {
        sections.splice(sections.indexOf(q), 1);
        return true;
      }
      const r = find("recent30");
      if (r && r.lines.length > 15) {
        r.lines = [TRUNCATION_MARK, ...r.lines.slice(-15)];
        return true;
      }
      const m2 = find("monthly");
      if (m2 && m2.lines.length > 3) {
        m2.lines = [TRUNCATION_MARK, ...m2.lines.slice(-3)];
        return true;
      }
      const p = find("profile");
      if (p && p.lines.join("\n").length > 1200) {
        p.lines = [...p.lines.join("\n").slice(0, 1200).split("\n").slice(0, -1), TRUNCATION_MARK];
        return true;
      }
      if (m2) {
        sections.splice(sections.indexOf(m2), 1);
        return true;
      }
      const r2 = find("recent30");
      if (r2 && r2.lines.length > 7) {
        r2.lines = [TRUNCATION_MARK, ...r2.lines.slice(-7)];
        return true;
      }
      return false; // دیگر چیزی برای خلاصه‌کردن نیست → برش سخت نهایی
    };

    let out = render();
    if (out.length > maxChars) {
      let guard = 0;
      while (out.length > maxChars && guard++ < 20 && degradeStep()) {
        out = render();
      }
      if (out.length > maxChars) {
        out = out.slice(0, Math.max(0, maxChars - TRUNCATION_MARK.length - 1)) + "\n" + TRUNCATION_MARK;
      }
    }
    return out;
  } catch (e) {
    // هرگز caller را نمی‌شکنیم — فلوی AI نباید به‌خاطر کانتکست کمکی خطا بدهد
    console.error("[sports-profile] buildSportsProfileContext failed:", e);
    return "";
  }
}

// ─── خلاصهٔ فشرده برای تولید برنامه (سقف ۱۵۰۰ کاراکتر) ───

export interface CompactSummaryOptions {
  /** چکاپ‌های آخر در خلاصه بیاید؟ (در renewalContext که خودش چکاپ دارد false بدهید) */
  includeCheckups?: boolean;
}

/**
 * خلاصهٔ ≤۱۵۰۰ کاراکتری پیشرفت کاربر: میانگین‌های ۳۰ روز اخیر + مجموع تمرین‌ها
 * + مسیر وزن + ۲ چکاپ آخر. برای تزریق به renewalContext تولید برنامه.
 */
export async function buildCompactProgressSummary(
  userId: string,
  opts?: CompactSummaryOptions
): Promise<string> {
  const includeCheckups = opts?.includeCheckups !== false;
  try {
    const todayStr = tehranTodayStr();
    const windowStart = new Date(tehranDayStart(todayStr).getTime() - 29 * DAY_MS);

    const [foodRows, dcWindow, totalWorkouts, weightsDesc, checkups] = await Promise.all([
      db.foodLog.groupBy({
        by: ["day"],
        where: { userId, day: { gte: windowStart } },
        _sum: { calories: true, protein: true, carbs: true, fat: true },
        _count: { _all: true },
        orderBy: { day: "asc" },
        take: 40,
      }),
      db.dayCompletion.findMany({
        where: { userId, date: { gte: tehranDateStr(windowStart) } },
        select: { date: true, workoutDone: true, nutritionDone: true },
        orderBy: { date: "asc" },
      }),
      db.dayCompletion.count({ where: { userId, workoutDone: true } }),
      db.weightLog.findMany({
        where: { userId },
        orderBy: { loggedAt: "desc" },
        select: { weight: true, loggedAt: true },
        take: 500,
      }),
      includeCheckups
        ? db.checkup.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: { phaseNumber: true, weight: true, bodyFatPercent: true, workoutAdherence: true, dietAdherence: true, createdAt: true },
            take: 2,
          })
        : Promise.resolve([] as { phaseNumber: number; weight: number; bodyFatPercent: number | null; workoutAdherence: number; dietAdherence: number; createdAt: Date }[]),
    ]);

    const lines: string[] = [];

    if (foodRows.length > 0) {
      const totKcal = foodRows.reduce((s, r) => s + (r._sum.calories ?? 0), 0);
      const totP = foodRows.reduce((s, r) => s + (r._sum.protein ?? 0), 0);
      lines.push(
        `• تغذیهٔ ۳۰ روز اخیر: میانگین ${pd(Math.round(totKcal / foodRows.length))} کالری · پ ${pd(Math.round(totP / foodRows.length))}g در روز (${pd(foodRows.length)} روز ثبت از ۳۰)`
      );
    }
    if (dcWindow.length > 0) {
      const done = dcWindow.filter((r) => r.workoutDone).length;
      const nut = dcWindow.filter((r) => r.nutritionDone).length;
      lines.push(`• تمرین ۳۰ روز اخیر: ${pd(done)} روز کامل · تغذیهٔ کامل: ${pd(nut)} روز`);
    }
    if (totalWorkouts > 0) {
      lines.push(`• مجموع تمرین‌های ثبت‌شده در کل دوره: ${pd(totalWorkouts)} روز`);
    }
    if (weightsDesc.length > 0) {
      const first = weightsDesc[weightsDesc.length - 1];
      const last = weightsDesc[0];
      if (weightsDesc.length === 1) {
        lines.push(`• وزن فعلی: ${pd(fmt1(last.weight))}kg (${jalali(new Date(last.loggedAt))})`);
      } else {
        lines.push(
          `• مسیر وزن: ${pd(fmt1(first.weight))} → ${pd(fmt1(last.weight))}kg (${signed(last.weight - first.weight)}) در ${pd(weightsDesc.length)} ثبت`
        );
      }
    }
    for (const c of checkups) {
      lines.push(
        `• چکاپ فاز ${pd(c.phaseNumber)} (${jalali(new Date(c.createdAt))}): وزن ${pd(fmt1(c.weight))}kg${c.bodyFatPercent != null ? ` · چربی ${pd(fmt1(c.bodyFatPercent))}٪` : ""} · پیروی تمرین ${pd(c.workoutAdherence)}/۵ · رژیم ${pd(c.dietAdherence)}/۵`
      );
    }

    if (lines.length === 0) return "";

    const header = "📊 خلاصهٔ پیشرفت کاربر (برای طراحی برنامهٔ جدید):";
    let out = `${header}\n${lines.join("\n")}`;
    if (out.length > COMPACT_SUMMARY_MAX_CHARS) {
      out = out.slice(0, COMPACT_SUMMARY_MAX_CHARS - TRUNCATION_MARK.length - 1) + TRUNCATION_MARK;
    }
    return out;
  } catch (e) {
    console.error("[sports-profile] buildCompactProgressSummary failed:", e);
    return "";
  }
}
