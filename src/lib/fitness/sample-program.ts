/**
 * SAMPLE_PROGRAM — نمونهٔ واقعی از برنامهٔ تولیدی هوش مصنوعی فیتاپ (Task 5-c)
 *
 * محتوای کاملاً ایستا و حرفه‌ای — بدون هیچ هزینهٔ AI یا endpoint. هدف: کاربرِ
 * لندینگ/آنبوردینگ قبل از خرید «دقیقاً ببیند» چه چیزی دریافت می‌کند.
 * در دو جا استفاده می‌شود:
 *  ۱) SampleProgramSection در لندینگ (تب‌های تمرین/تغذیه/مکمل)
 *  ۲) باکس فشردهٔ «نمونهٔ برنامه» در صفحهٔ تحلیل آنبوردینگ (قبل از ویترین پلن‌ها)
 * اگر خواستید نمونه را عوض کنید، فقط همین فایل را ویرایش کنید — UI خودکار
 * هم‌گام می‌ماند.
 *
 * v87 — (دیرکتیو مالک) «امکانات برنامه‌ها بیشتر نوشته شود»:
 *  • هر وعدهٔ تغذیه حالا «دو وعدهٔ جایگزین» دارد — دقیقاً مثل برنامهٔ واقعی
 *    تولیدی (Meal.alternatives — یکی را انتخاب می‌کنید).
 *  • NUTRITION_PROGRAM_FEATURES / WORKOUT_PROGRAM_FEATURES — فهرست امکانات
 *    برنامهٔ کامل برای نمایش زیبا زیر نمونه (زمان‌بندی وعده‌ها، آب، قبل/بعد
 *    تمرین، گرم‌کردن و…).
 *
 * 101-c — (دیرکتیو مالک) برنامهٔ نمونهٔ صفحهٔ تحلیل آنبوردینگ باید «یک قسمت
 *  واقعی از برنامهٔ همان کاربر» باشد نه تمپلیت ثابت برای همه:
 *  buildSampleProgram(data: OnboardingData) بر اساس جنسیت/هدف/سطح/تعداد روز
 *  تمرین/محل تمرین/رشتهٔ ورزشی (data.discipline) یک «روز اول واقعی از برنامه»
 *  می‌سازد:
 *   • هدف چربی‌سوزی (fat_loss/cut) → ترکیب قدرتی + هوازی
 *   • هدف عضله‌سازی (muscle_gain/bulk) → قدرتی با تکرارهای هیپرتروفی
 *   • workoutPlace = home → نسخهٔ وزن‌بدن/دمبل خانگی
 *   • رشتهٔ ترند (پیلاتس/TRX/هییت/فانکشنال/بالنس) → نام و ساختار حرکات از
 *     همان رشته (هم‌نام با حرکات seed شدهٔ کتابخانه — فقط متن، بدون ایمپورت سنگین)
 *   • نام کاربر اگر موجود باشد در تیتر می‌آید («برنامهٔ نمونهٔ حسین — روز اول»)
 *  کالری/پروتئین هم با همان فرمول‌های خود اپ (Mifflin-St Jeor + ضرایب فعالیت
 *  + تنظیم هدف — همان مسیر /api/onboarding/analysis) محاسبه می‌شود تا عددها
 *  با کارت «کالری و درشت‌مغذی پیشنهادی» همان صفحه یکی باشد.
 *  لندینگ (SampleProgramSection) همچنان از SAMPLE_PROGRAM ایستا می‌خواند.
 */

import type {
  OnboardingData,
  Gender,
  Goal,
  WorkoutPlace,
  TrainingExperience,
  Discipline,
  DietType,
} from "./types";

export interface SampleExercise {
  name: string;
  sets: string;
  reps: string;
  rest: string;
  /** یادداشت اختیاری (مثلاً سوپرست با حرکت بعدی) */
  note?: string;
}

export interface SampleMeal {
  name: string;
  items: string;
  /** v87 — وعده‌های جایگزین (برنامهٔ واقعی برای هر وعده ۲-۳ گزینهٔ جایگزین می‌سازد) */
  alternatives: string[];
}

export interface SampleSupplement {
  name: string;
  when: string;
  dose: string;
}

export interface SampleProgram {
  /** 101-c — تیتر شخصی‌سازی‌شده («برنامهٔ نمونهٔ حسین — روز اول») — فقط وقتی نام کاربر موجود است */
  title?: string;
  workout: {
    dayLabel: string;
    focus: string;
    exercises: SampleExercise[];
  };
  nutrition: {
    calories: string;
    protein: string;
    meals: SampleMeal[];
  };
  supplements: SampleSupplement[];
}

/** v87 — امکانات برنامهٔ تغذیهٔ کامل (زیر نمونهٔ لندینگ نمایش داده می‌شود) */
export const NUTRITION_PROGRAM_FEATURES: string[] = [
  "۲ وعدهٔ جایگزین برای هر وعده — اگر سلیقه‌ات نبود، جایگزین دار",
  "گرم دقیق هر مادهٔ غذایی + کالری و درشت‌مغذی هر وعده",
  "زمان‌بندی وعده‌ها نسبت به تمرین (قبل/بعد)",
  "برنامهٔ آب روزانه ساعت‌به‌ساعت",
];

/** v87 — امکانات برنامهٔ تمرینی کامل (زیر نمونهٔ لندینگ نمایش داده می‌شود) */
export const WORKOUT_PROGRAM_FEATURES: string[] = [
  "گرم‌کردن اختصاصی هر جلسه",
  "سوپرست‌ها و ترتیب دقیق حرکات",
  "زمان استراحت دقیق بین ست‌ها",
  "پیشرفت هفتگی وزنه‌ها (Overload)",
];

// ═════════════════════════════════════════════════════════════════════════════
// 101-c — سازندهٔ پارامتری «روز اول برنامهٔ همان کاربر»
// ═════════════════════════════════════════════════════════════════════════════

/** تبدیل عدد به رقم فارسی با جداکنندهٔ هزارگان «٬» — مثل «۲٬۴۵۰» */
function faCount(n: number): string {
  return n
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** برچسب فارسی هدف — برای خط تمرکز روز */
const GOAL_FOCUS: Record<Goal, string> = {
  fat_loss: "چربی‌سوزی + حفظ عضله",
  cut: "چربی‌سوزی با حفظ حداکثری عضله",
  muscle_gain: "عضله‌سازی (هیپرتروفی)",
  bulk: "افزایش حجم عضلانی",
  strength: "قدرت پایه",
  endurance: "استقامت قلبی-عروقی",
  fitness: "آمادگی جسمانی کلی",
};

/** بازهٔ تکرار بر اساس هدف — چربی‌سوزی = تکرار بیشتر/وزنهٔ متوسط، عضله‌سازی = هیپرتروفی */
const GOAL_REPS: Record<Goal, string> = {
  fat_loss: "۱۲-۱۵",
  cut: "۱۰-۱۲",
  muscle_gain: "۸-۱۰",
  bulk: "۸-۱۰",
  strength: "۵-۶",
  endurance: "۱۵-۲۰",
  fitness: "۱۰-۱۲",
};

/** تعداد ست و استراحت بر اساس سطح ورزشی (سابقهٔ تمرینی) */
const LEVEL_SCHEME: Record<TrainingExperience, { sets: string; rest: string; note?: string }> = {
  beginner: {
    sets: "۳",
    rest: "۹۰ ثانیه",
    note: "وزنه‌ها را سبک شروع کن؛ فرم صحیح مهم‌تر از سنگینی است",
  },
  intermediate: { sets: "۴", rest: "۷۵ ثانیه" },
  advanced: { sets: "۴", rest: "۶۰ ثانیه" },
  pro: { sets: "۴", rest: "۶۰ ثانیه" },
};

/** برچسب اسپلیت روز اول بر اساس تعداد روزهای تمرین هفتگی */
function splitLabelFor(days: number): string {
  if (days >= 5) return "پوش (سینه، سرشانه، پشت‌بازو)";
  if (days === 4) return "بالاتنه";
  return "فول‌بادی (تمام بدن)";
}

/** تعویض‌های جنسیتی — کف فوکوس خانم‌ها روی باسن/ران (پرطرفدارترین خواستهٔ برنامهٔ خانم‌ها) */
function genderize(name: string, gender: Gender): string {
  if (gender === "female") {
    if (name === "پرس سینه هالتر") return "پرس سینه دمبل";
    if (name === "ساق پا ایستاده") return "هیپ تراست با هالتر";
    if (name === "لانگز دمبل") return "پل باسن با هالتر";
  }
  return name;
}

type ExSeed = { name: string; reps?: string; note?: string; rest?: string };

/** پایان‌بخش هوازی — فقط برای اهداف چربی‌سوزی/استقامت؛ متن بر اساس محل تمرین */
function cardioFinisher(place: WorkoutPlace, goal: Goal): ExSeed | null {
  if (goal !== "fat_loss" && goal !== "cut" && goal !== "endurance") return null;
  return place === "home"
    ? {
        name: "طناب زدن یا پرش درجا",
        reps: "۵ راند ۱ دقیقه‌ای",
        rest: "۴۵ ثانیه",
        note: "پایان‌بخش هوازی — بدون طناب هم قابل اجراست",
      }
    : {
        name: "تردمیل شیب‌دار یا الپتیکال",
        reps: "۲۰ دقیقه",
        rest: "—",
        note: "پایان‌بخش هوازی — شدت متوسط (۶۰ تا ۷۰٪ ضربان بیشینه)",
      };
}

// ─── حرکات پایهٔ باشگاهی — بر اساس هدف ───
const GYM_POOL: Record<Goal, ExSeed[]> = {
  fat_loss: [
    { name: "اسکات هالتر", note: "گرم‌کردن: ۲ ست سبک قبل از ست‌های اصلی" },
    { name: "پرس سینه دمبل" },
    { name: "ددلیفت رومانیایی" },
    { name: "لانگز دمبل" },
    { name: "زیربغل سیم‌کش" },
    { name: "پلانک شکم", reps: "۴۵ ثانیه" },
  ],
  cut: [
    { name: "اسکات هالتر", note: "گرم‌کردن: ۲ ست سبک قبل از ست‌های اصلی" },
    { name: "پرس پا دستگاه" },
    { name: "ددلیفت رومانیایی" },
    { name: "پرس سینه دمبل" },
    { name: "زیربغل سیم‌کش" },
    { name: "پلانک شکم", reps: "۶۰ ثانیه" },
  ],
  muscle_gain: [
    { name: "اسکات هالتر", note: "گرم‌کردن: ۲ ست سبک قبل از ست‌های اصلی" },
    { name: "پرس پا دستگاه" },
    { name: "پرس سینه هالتر" },
    { name: "زیربغل سیم‌کش" },
    { name: "جلو بازو دمبل + پشت بازو سیم‌کش", note: "سوپرست — بدون استراحت بین دو حرکت" },
    { name: "ساق پا ایستاده", reps: "۱۲-۱۵" },
  ],
  bulk: [
    { name: "اسکات هالتر", note: "گرم‌کردن: ۲ ست سبک قبل از ست‌های اصلی" },
    { name: "ددلیفت هالتر" },
    { name: "پرس سینه هالتر" },
    { name: "زیربغل هالتر خم" },
    { name: "پرس سرشانه هالتر" },
    { name: "ساق پا ایستاده", reps: "۱۲-۱۵" },
  ],
  strength: [
    { name: "اسکات هالتر", reps: "۵", note: "گرم‌کردن: ۲ ست سبک + ست‌های اصلی با وزنهٔ سنگین" },
    { name: "پرس سینه هالتر", reps: "۵" },
    { name: "ددلیفت هالتر", reps: "۵" },
    { name: "پرس سرشانه هالتر", reps: "۶" },
    { name: "بارفیکس", reps: "۶-۸" },
    { name: "پلانک وزنه‌دار", reps: "۴۵ ثانیه" },
  ],
  endurance: [
    { name: "اسکات با وزن بدن", note: "سیرکویت — با تمپوی یکنواخت و نفس‌گیری منظم" },
    { name: "پوش‌آپ (شنا سوئدی)" },
    { name: "لانج درجا" },
    { name: "روئینگ دستگاه", reps: "۳۰۰ متر" },
    { name: "پلانک شکم", reps: "۶۰ ثانیه" },
  ],
  fitness: [
    { name: "اسکات گابلت با دمبل", note: "گرم‌کردن: ۲ ست سبک قبل از ست‌های اصلی" },
    { name: "پرس سینه دمبل" },
    { name: "ددلیفت رومانیایی دمبل" },
    { name: "زیربغل سیم‌کش" },
    { name: "پلانک شکم", reps: "۴۵ ثانیه" },
  ],
};

// ─── حرکات خانگی (وزن بدن + دمبل) — بر اساس هدف ───
const HOME_POOL: Record<Goal, ExSeed[]> = {
  fat_loss: [
    { name: "برپی (نسخهٔ بدون پرش برای شروع)", note: "سیرکویت خانگی — ترتیب حرکات را رعایت کن" },
    { name: "اسکوات پرشی" },
    { name: "مأنتین کلایمر" },
    { name: "لانج درجا" },
    { name: "پوش‌آپ (شنا سوئدی)" },
    { name: "پلانک شکم", reps: "۴۵ ثانیه" },
  ],
  cut: [
    { name: "اسکوات با وزن بدن (تمپو آهسته)", note: "سیرکویت خانگی — تمرکز روی کنترل حرکت" },
    { name: "لانج معکوس" },
    { name: "پوش‌آپ (شنا سوئدی)" },
    { name: "مأنتین کلایمر" },
    { name: "پل باسن تک‌پا" },
    { name: "پلانک شکم", reps: "۶۰ ثانیه" },
  ],
  muscle_gain: [
    { name: "پوش‌آپ وزنه‌دار (کوله‌پشتی)", note: "گرم‌کردن: ۲ ست سبک — دمبل خانگی یا بطری آب هم جواب می‌دهد" },
    { name: "اسکات با دمبل" },
    { name: "ددلیفت رومانیایی دمبل" },
    { name: "زیربغل دمبل خم" },
    { name: "پل باسن تک‌پا + پلانک", note: "سوپرست — بدون استراحت بین دو حرکت" },
    { name: "شولدرپرس دمبل" },
  ],
  bulk: [
    { name: "پوش‌آپ وزنه‌دار (کوله‌پشتی)", note: "گرم‌کردن: ۲ ست سبک — دمبل خانگی یا بطری آب هم جواب می‌دهد" },
    { name: "اسکات بلغاری با دمبل" },
    { name: "ددلیفت رومانیایی دمبل" },
    { name: "زیربغل دمبل خم" },
    { name: "شولدرپرس دمبل" },
    { name: "پل باسن با وزنه" },
  ],
  strength: [
    { name: "پوش‌آپ وزنه‌دار (کوله‌پشتی)", reps: "۶-۸", note: "وزن بدن + کوله — به‌جای وزنهٔ آزاد" },
    { name: "اسکات بلغاری با دمبل", reps: "۶-۸" },
    { name: "ددلیفت تک‌پا با دمبل", reps: "۶-۸" },
    { name: "پل باسن با وزنه", reps: "۸-۱۰" },
    { name: "پلانک وزنه‌دار", reps: "۴۵ ثانیه" },
  ],
  endurance: [
    { name: "اسکوات سریع در جا", note: "سیرکویت خانگی با استراحت کوتاه" },
    { name: "پوش‌آپ (شنا سوئدی)" },
    { name: "مأنتین کلایمر" },
    { name: "جک پرش" },
    { name: "پلانک شکم", reps: "۶۰ ثانیه" },
  ],
  fitness: [
    { name: "اسکوات با وزن بدن", note: "گرم‌کردن: ۲ ست سبک — ترکیب وزن بدن و دمبل" },
    { name: "پوش‌آپ (شنا سوئدی)" },
    { name: "ددلیفت رومانیایی دمبل" },
    { name: "پل باسن تک‌پا" },
    { name: "پلانک شکم", reps: "۴۵ ثانیه" },
  ],
};

// ─── روز اول اختصاصی رشته‌های ترند (نام حرکات هم‌نام با کتابخانهٔ حرکات فیتاپ) ───
const DISCIPLINE_WORKOUTS: Partial<Record<Discipline, { dayLabel: string; focus: string; exercises: ExSeed[] }>> = {
  pilates: {
    dayLabel: "شنبه — پیلاتس (مرکز بدن و ستون فقرات)",
    focus: "تقویت مرکز بدن + انعطاف و کنترل تنفس",
    exercises: [
      { name: "صد پیلاتس (Pilates Hundred)", reps: "۱۰ دسیسهٔ تنفس", rest: "۳۰ ثانیه", note: "گرم‌کردن: ۵ نفس عمیق پهلویی قبل از شروع" },
      { name: "رول‌آپ پیلاتس (Roll-Up)", reps: "۸-۱۰", rest: "۴۵ ثانیه" },
      { name: "پلانک خانوادهٔ پیلاتس (Front Support)", reps: "۳۰-۴۵ ثانیه", rest: "۴۵ ثانیه" },
      { name: "پل باسن پیلاتس (Shoulder Bridge)", reps: "۱۰-۱۲", rest: "۴۵ ثانیه" },
      { name: "سگ-گربه (Cat-Cow)", reps: "۸-۱۰", rest: "۳۰ ثانیه" },
      { name: "تیزر پیلاتس (Teaser)", reps: "۵-۸", rest: "۶۰ ثانیه", note: "اگر سنگین بود، با کمک پشت زانو اجرا کن" },
    ],
  },
  trx: {
    dayLabel: "شنبه — TRX (تمام بدن با نوار)",
    focus: "قدرت + ثبات مرکز با نوار TRX",
    exercises: [
      { name: "روئینگ TRX ایستاده (TRX Row)", note: "گرم‌کردن: ۱ ست با زاویهٔ ایستادن راحت‌تر" },
      { name: "پرس سینه TRX (TRX Chest Press)" },
      { name: "اسکوات TRX (TRX Squat)" },
      { name: "لانج TRX (TRX Lunge)" },
      { name: "پلانک TRX (TRX Plank)", reps: "۳۰-۴۵ ثانیه" },
      { name: "پایک TRX (TRX Pike)", reps: "۸-۱۲" },
    ],
  },
  hiit: {
    dayLabel: "شنبه — هییت (سیرکویت اینتروال)",
    focus: "چربی‌سوزی با اینتروال شدید و استراحت کوتاه",
    exercises: [
      { name: "جک پرش (Jumping Jacks)", reps: "۴۰ ثانیه کار", rest: "۲۰ ثانیه", note: "گرم‌کردن؛ سپس ۳ تا ۵ راند سیرکویت با استراحت ۶۰ تا ۹۰ ثانیه بین راندها" },
      { name: "برپی (Burpee)", reps: "۴۰ ثانیه کار", rest: "۲۰ ثانیه", note: "نسخهٔ بدون پرش در برنامهٔ کامل برای شروع‌کنندگان" },
      { name: "مأنتین کلایمر (Mountain Climbers)", reps: "۴۰ ثانیه کار", rest: "۲۰ ثانیه" },
      { name: "اسکوات پرشی (Jump Squat)", reps: "۴۰ ثانیه کار", rest: "۲۰ ثانیه" },
      { name: "اسپرینت درجا بلند (High Knees)", reps: "۴۰ ثانیه کار", rest: "۲۰ ثانیه" },
      { name: "پلانک شکم", reps: "۴۵ ثانیه", rest: "۳۰ ثانیه" },
    ],
  },
  functional: {
    dayLabel: "شنبه — فانکشنال (الگوهای کاربردی)",
    focus: "قدرت کاربردی با کتل‌بل، دمبل و وزن بدن",
    exercises: [
      { name: "اسوینگ کتل‌بل (Kettlebell Swing)", note: "گرم‌کردن: ۲ ست سبک — تمرکز روی هینج لگن" },
      { name: "اسکوات گابلت کتل‌بل (Goblet Squat)" },
      { name: "ددلیفت رومانیایی کتل‌بل (KB RDL)" },
      { name: "حمل کشاورز (Farmer Carry)", reps: "۴۰ قدم" },
      { name: "روئینگ رنینگیت (Renegade Row)" },
      { name: "گت‌آپ ترکی نیمه (Turkish Get-Up)", reps: "۴ برای هر سمت" },
    ],
  },
  balance: {
    dayLabel: "شنبه — بالنس و تعادل",
    focus: "ثبات مرکز + تعادل تک‌پا و کنترل عصبی-عضلانی",
    exercises: [
      { name: "ایستادگی تک‌پا (Single-Leg Stance)", reps: "۳۰-۴۵ ثانیه هر پا", rest: "۳۰ ثانیه", note: "گرم‌کردن: چرخش ملایم مچ و لگن" },
      { name: "سگ پرنده (Bird Dog)", reps: "۸-۱۰ هر سمت", rest: "۴۵ ثانیه" },
      { name: "حیوان مرده (Dead Bug)", reps: "۱۰ هر سمت", rest: "۴۵ ثانیه" },
      { name: "لانج معکوس با مکث (Reverse Lunge Hold)", reps: "۸ هر پا", rest: "۶۰ ثانیه" },
      { name: "رسیدن تک‌پا (Single-Leg Reach)", reps: "۸ هر پا", rest: "۴۵ ثانیه" },
      { name: "راه‌رفتن پاشنه به پنجه (Heel-to-Toe Walk)", reps: "۱۰ قدم رفت و برگشت" },
    ],
  },
};

/**
 * ساخت «روز اول واقعی از برنامهٔ تمرینی» بر اساس دادهٔ آنبوردینگ کاربر.
 * اولویت: رشتهٔ ترند (پیلاتس/TRX/هییت/فانکشنال/بالنس) → تمپلیت همان رشته؛
 * در غیر این صورت تمپلیت باشگاه/خانه بر اساس هدف + تعداد روز + سطح + جنسیت.
 */
function buildWorkoutDay(data: OnboardingData): SampleProgram["workout"] {
  const gender: Gender = data.gender ?? "male";
  const goal: Goal = data.goal ?? "fitness";
  const place: WorkoutPlace = data.workoutPlace ?? "gym";
  const level: TrainingExperience = data.trainingExperience ?? "beginner";
  const days = data.workoutDays ?? 3;
  const discipline = data.discipline;

  // ─── رشتهٔ ترند؟ → ساختار و نام حرکات از همان رشته ───
  const d = discipline ? DISCIPLINE_WORKOUTS[discipline] : undefined;
  if (d) {
    const scheme = LEVEL_SCHEME[level];
    return {
      dayLabel: d.dayLabel,
      focus: d.focus,
      exercises: d.exercises.map((ex) => ({
        name: ex.name,
        sets: scheme.sets,
        reps: ex.reps ?? GOAL_REPS[goal],
        rest: ex.rest ?? scheme.rest,
        note: ex.note ?? scheme.note,
      })),
    };
  }

  // ─── تمپلیت پایه باشگاه/خانه ───
  const pool = place === "home" ? HOME_POOL[goal] : GYM_POOL[goal];
  const scheme = LEVEL_SCHEME[level];
  const cardio = cardioFinisher(place, goal);
  const seeds = cardio ? [...pool, cardio] : pool;

  return {
    dayLabel: `شنبه — ${splitLabelFor(days)}`,
    focus: GOAL_FOCUS[goal],
    exercises: seeds.map((ex, i) => ({
      name: genderize(ex.name, gender),
      sets: scheme.sets,
      reps: ex.reps ?? GOAL_REPS[goal],
      rest: ex.rest ?? scheme.rest,
      note: ex.note ?? (i === 0 && scheme.note ? scheme.note : undefined),
    })),
  };
}

/**
 * کالری و پروتئین هدف — همان فرمول‌های خود اپ (Mifflin-St Jeor + ضرایب فعالیت
 * + تنظیم کالری بر اساس هدف) تا نمونه دقیقاً با تحلیل واقعی کاربر هم‌خوان باشد.
 */
function buildNutrition(data: OnboardingData): SampleProgram["nutrition"] {
  const gender: Gender = data.gender ?? "male";
  const goal: Goal = data.goal ?? "fitness";
  const age = data.age ?? 30;
  const height = data.height ?? 175;
  const weight = data.weight ?? 75;

  const activityFactors: Record<string, number> = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
  };
  const bmr =
    gender === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;
  const tdee = bmr * (activityFactors[data.activityLevel] || 1.55);

  const calorieFactor: Record<Goal, number> = {
    fat_loss: 0.75, cut: 0.8, muscle_gain: 1.1, bulk: 1.15,
    strength: 1, endurance: 1, fitness: 1,
  };
  const proteinPerKg: Record<Goal, number> = {
    fat_loss: 2.2, cut: 2.4, muscle_gain: 2.0, bulk: 2.0,
    strength: 1.8, endurance: 1.8, fitness: 1.8,
  };

  const calories = Math.round(tdee * calorieFactor[goal]);
  const protein = Math.round(weight * proteinPerKg[goal]);

  return {
    calories: faCount(calories),
    protein: `${faCount(protein)} گرم پروتئین`,
    meals: mealsForDiet(data.dietType ?? "standard"),
  };
}

/** وعده‌های نمونه — با نوع رژیم واقعی کاربر هماهنگ (استاندارد/گیاهی/وگان/کتوژنیک) */
function mealsForDiet(diet: DietType): SampleProgram["nutrition"]["meals"] {
  if (diet === "keto") {
    return [
      {
        name: "صبحانه",
        items: "۳ عدد تخم‌مرغ نیمرو با کره + ۱/۲ آووکادو + پنیر",
        alternatives: [
          "املت با ۳ تخم‌مرغ + اسفناج + قارچ + روغن زیتون",
          "۲ عدد تخم‌مرغ آب‌پز + پنیر کم‌چرب + چند عدد گردو",
        ],
      },
      {
        name: "میان‌وعدهٔ ظهر",
        items: "۱۰ عدد بادام + ۲ قاشق خامهٔ پرچرب",
        alternatives: ["۲۵ گرم پنیر چدار + چند عدد زیتون", "۱ قاشق کره بادام‌زمینی بدون شکر + برش‌های خیار"],
      },
      {
        name: "ناهار",
        items: "۱۸۰ گرم سینه مرغ گریل + سالاد بزرگ با روغن زیتون و آووکادو",
        alternatives: [
          "۱۸۰ گرم گوشت قرمز کبابی + سالاد فصل با روغن زیتون",
          "۱۵۰ گرم ماهی سالمون + سبزیجات کره‌ای",
        ],
      },
      {
        name: "شام",
        items: "۱۵۰ گرم ماهی یا مرغ + سبزیجات بخارپز با کره حیوانی",
        alternatives: ["۳ عدد تخم‌مرغ + نیمرو با گوجه و پنیر", "۱۵۰ گرم میگو تفت‌داده با کدو سبز"],
      },
    ];
  }

  const vegan = diet === "vegan";
  const vegetarian = diet === "vegetarian";
  if (vegan || vegetarian) {
    return [
      {
        name: "صبحانه",
        items: `جو دوسر با شیر${vegetarian ? " + ۱ قاشق عسل" : " گیاهی"} + ۱ عدد موز + ۱ قاشق کره بادام‌زمینی`,
        alternatives: [
          `${vegetarian ? "۳ عدد تخم‌مرغ + نان کامل" : "توفتَه سوخاری + نان کامل"} + گوجه و خیار`,
          "نان کامل + کره بادام‌زمینی + ۱ عدد خرما",
        ],
      },
      {
        name: "میان‌وعدهٔ ظهر",
        items: "۱ لیوان ماست (گیاهی در صورت وگان) + ۱ قاشق عسل + ۱۰ عدد بادام",
        alternatives: ["۱ عدد سیب + ۲ قاشق کره بادام‌زمینی", "خوراک نخود آب‌پز + لیمو و نمک"],
      },
      {
        name: "ناهار",
        items: `${vegan ? "خوراک عدس و لوبیا" : "خوراک عدس + ۲ عدد تخم‌مرغ"} + ۸ قاشق برنج + سالاد با روغن زیتون`,
        alternatives: [
          `${vegan ? "توفتهٔ توفو و سبزیجات" : "کوکو سبزی + ماست"} + برنج + سالاد شیرازی`,
          "عدسی + برنج + سبزیجات بخارپز",
        ],
      },
      {
        name: "شام",
        items: `${vegan ? "خوراک نخود و سیب‌زمینی" : "املت ۳ تخم‌مرغی"} + ماکارونی کامل + سالاد`,
        alternatives: [
          "سوپ لوبیا + نان کامل + سبزی",
          `${vegetarian ? "پنیر + گوجه + گردو داخل نان کامل" : "توفتهٔ توفو با سبزیجات"}`,
        ],
      },
    ];
  }

  // استاندارد — همان وعده‌های مرجع SAMPLE_PROGRAM (پروتئین حیوانی کامل)
  return [
    {
      name: "صبحانه",
      items: "۳ عدد تخم‌مرغ + ۶۰ گرم جو دوسر + ۱ عدد موز",
      alternatives: [
        "املت اسفناج با ۲ تخم‌مرغ + ۱ کف دست نان سنگک + پنیر",
        "جو دوسر با شیر + ۱ قاشق کره بادام‌زمینی + ۱ عدد خرما",
      ],
    },
    {
      name: "میان‌وعدهٔ ظهر",
      items: "۱ لیوان ماست یونانی + ۲ قاشق عسل + ۱۰ عدد بادام",
      alternatives: ["۱ عدد سیب + ۲ قاشق کره بادام‌زمینی", "۱ لیوان شیر موز + ۵ عدد گردو"],
    },
    {
      name: "ناهار",
      items: "۱۵۰ گرم سینه مرغ گریل + ۸ قاشق برنج + سالاد با روغن زیتون",
      alternatives: [
        "۱۵۰ گرم گوشت قرمز کم‌چرب + ۶ قاشق برنج + سالاد شیرازی",
        "۲ عدد عدسی مرغ + برنج + سبزیجات بخارپز",
      ],
    },
    {
      name: "شام",
      items: "۱۲۰ گرم ماهی قزل‌آلا + سیب‌زمینی آب‌پز + سبزیجات بخارپز",
      alternatives: [
        "۳ عدد تخم‌مرغ + نیمرو با گوجه + ۲ کف دست نان + سبزی",
        "۱۵۰ گرم سینه مرغ بخارپز + ماکارونی کامل + سالاد",
      ],
    },
  ];
}

/** مکمل‌های نمونه — v133: کاملاً شرطی از دل پروفایل؛ قالب ثابت «کراتین+امگا۳+ویتامین D» ممنوع
 *  (دیرکتیو مالک: مکمل باید با توجه به هدف/رژیم/پروفایل ورزشکار داده شود، نه به‌عنوان عادت) */
function buildSupplements(data: OnboardingData): SampleProgram["supplements"] {
  const goal: Goal = data.goal ?? "fitness";
  const diet: DietType = data.dietType ?? "standard";

  const list: SampleProgram["supplements"] = [];

  // وی پروتئین — فقط وقتی پوشش پروتئین وعده‌ها سخت است (حجم/عضله‌سازی یا رژیم گیاهی)
  if (goal === "muscle_gain" || goal === "bulk" || goal === "strength") {
    const proteinName =
      diet === "vegan" ? "وی پروتئین گیاهی (نخود/برنج)" : "وی پروتئین";
    list.push({ name: proteinName, when: "بعد تمرین", dose: "۱ اسکوپ" });
  }
  // کراتین — فقط هدف‌های عضلانی/قدرتی (برای چربی‌سوزی خالص نه)
  if (goal === "muscle_gain" || goal === "bulk" || goal === "strength") {
    list.push({ name: "کراتین مونوهیدرات", when: "هر روز", dose: "۵ گرم" });
  }
  // کافئین — چربی‌سوزی
  if (goal === "fat_loss" || goal === "cut") {
    list.push({ name: "کافئین (قهوهٔ تلخ)", when: "۳۰ دقیقه قبل تمرین", dose: "۱ فنجان" });
  }
  // امگا۳ — التهاب/آسیب یا کات
  if (goal === "fat_loss" || goal === "cut" || (data.injuries && data.injuries.trim().length > 0)) {
    list.push({ name: "امگا۳", when: "با شام", dose: "۱ عدد" });
  }
  // B12 — رژیم گیاهی سخت‌گیر
  if (diet === "vegan" || diet === "vegetarian") {
    list.push({ name: "ویتامین B12", when: "با صبحانه", dose: "۱ عدد" });
  }
  // اگر هیچ‌کدام معنی نداشت — پیام صریح «لازم نیست»
  if (list.length === 0) {
    list.push({ name: "برای تو فعلاً مکمل خاصی لازم نیست — غذای واقعی اولویت است", when: "—", dose: "—" });
  }
  return list;
}

/**
 * 101-c — برنامهٔ نمونهٔ شخصی‌سازی‌شدهٔ «همان کاربر».
 * ورودی: دادهٔ آنبوردینگ کاربر (از /api/onboarding/profile یا هر منبع دیگر).
 * خروجی: یک روز واقعی از برنامهٔ تمرینی + تغذیه + مکمل، هم‌راستا با پروفایل او.
 */
export function buildSampleProgram(data: OnboardingData): SampleProgram {
  const firstName = (data.firstName ?? "").trim().split(/\s+/)[0];
  return {
    ...(firstName ? { title: `برنامهٔ نمونهٔ ${firstName} — روز اول` } : {}),
    workout: buildWorkoutDay(data),
    nutrition: buildNutrition(data),
    supplements: buildSupplements(data),
  };
}

export const SAMPLE_PROGRAM: SampleProgram = {
  workout: {
    dayLabel: "شنبه — پایین‌تنه",
    focus: "عضله‌سازی + قدرت",
    exercises: [
      {
        name: "اسکات هالتر",
        sets: "۴",
        reps: "۸-۱۰",
        rest: "۹۰ ثانیه",
        note: "گرم‌کردن: ۲ ست سبک قبل از ست‌های اصلی",
      },
      { name: "ددلیفت رومانیایی", sets: "۳", reps: "۸-۱۲", rest: "۹۰ ثانیه" },
      { name: "پرس پا دستگاه", sets: "۳", reps: "۱۰-۱۲", rest: "۷۵ ثانیه" },
      {
        name: "لانگز دمبل + پل باسن",
        sets: "۳",
        reps: "۱۲+۱۲",
        rest: "۶۰ ثانیه",
        note: "سوپرست — بدون استراحت بین دو حرکت",
      },
      { name: "ساق پا ایستاده", sets: "۴", reps: "۱۲-۱۵", rest: "۴۵ ثانیه" },
      { name: "پلانک شکم", sets: "۳", reps: "۴۵ ثانیه", rest: "۴۵ ثانیه" },
    ],
  },
  nutrition: {
    calories: "۲۴۵۰",
    protein: "۱۶۰ گرم پروتئین",
    meals: [
      {
        name: "صبحانه",
        items: "۳ عدد تخم‌مرغ + ۶۰ گرم جو دوسر + ۱ عدد موز",
        alternatives: [
          "املت اسفناج با ۲ تخم‌مرغ + ۱ کف دست نان سنگک + پنیر",
          "جو دوسر با شیر + ۱ قاشق کره بادام‌زمینی + ۱ عدد خرما",
        ],
      },
      {
        name: "میان‌وعدهٔ ظهر",
        items: "۱ لیوان ماست یونانی + ۲ قاشق عسل + ۱۰ عدد بادام",
        alternatives: [
          "۱ عدد سیب + ۲ قاشق کره بادام‌زمینی",
          "۱ لیوان شیر موز + ۵ عدد گردو",
        ],
      },
      {
        name: "ناهار",
        items: "۱۵۰ گرم سینه مرغ گریل + ۸ قاشق برنج + سالاد با روغن زیتون",
        alternatives: [
          "۱۵۰ گرم گوشت قرمز کم‌چرب + ۶ قاشق برنج + سالاد شیرازی",
          "۲ عدد عدسی مرغ + برنج + سبزیجات بخارپز",
        ],
      },
      {
        name: "شام",
        items: "۱۲۰ گرم ماهی قزل‌آلا + سیب‌زمینی آب‌پز + سبزیجات بخارپز",
        alternatives: [
          "۳ عدد تخم‌مرغ + نیمرو با گوجه + ۲ کف دست نان + سبزی",
          "۱۵۰ گرم سینه مرغ بخارپز + ماکارونی کامل + سالاد",
        ],
      },
    ],
  },
  supplements: [
    // v133 — تمپلیت عمومی (کاربر بدون پروفایل): بدون استکِ کلیشه‌ای؛ استک واقعی
    // از دل پروفایل هر کاربر در برنامهٔ اصلی ساخته می‌شود
    { name: "برنامهٔ مکمل اختصاصی تو پس از تحلیل پروفایل ساخته می‌شود", when: "—", dose: "—" },
  ],
};
