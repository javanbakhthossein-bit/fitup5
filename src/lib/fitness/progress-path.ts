/**
 * progress-path.ts — موتور «مسیر پیشرفت ۶برنامه‌ای» صفحهٔ تحلیل آنبوردینگ (v133)
 *
 * دیرکتیو مالک (۱۴۰۵/۰۷ — اصلاح v132):
 *  «من نگفتم مسیر پیشرفت ۴۵ روزه بنویس — یک جدول درست کن که بنویسد در انتهای
 *   برنامهٔ اول این اتفاق می‌افتد، در انتهای برنامهٔ دوم، سوم، چهارم، پنجم، ششم…
 *   یعنی برای کاربر یک مسیر ۶برنامه‌ای مشخص کن که کاربر ببیند ما برای برنامهٔ
 *   اولش تا برنامهٔ ششمش برنامه‌ریزی کرده‌ایم — نه فقط ۴۵ روز اول.»
 *
 * اصول v133:
 *  • جدول همیشه «دقیقاً ۶ برنامه» دارد — برنامهٔ اول تا ششم — هر برنامه ۴۵ روزه
 *    (مجموع مسیر نمایش‌داده‌شده = ۲۷۰ روز) تا کاربر حس کند فیتاپ کل مسیرِ پیشِ رو
 *    را از الان برایش طراحی کرده است.
 *  • برنامه‌های تا رسیدن به هدف: وزن شروع ← پایان هر برنامه از همان trajectory
 *    رسمی اپ (weeklyRate) رسم می‌شود؛ ردیفِ «رسیدن به هدف» طلایی است.
 *  • برنامه‌های «پس از هدف»: فازهای واقعی بدنسازی حرفه‌ای — تثبیت (Maintenance)،
 *    فرم‌دهی و رکامپ (Recomp)، عضله‌سازی مرحلهٔ بعد، پیشرفت عملکردی — با وزنِ
 *    ثابت روی هدف، تا کاربر ببیند فیتاپ بعد از هدف هم برایش برنامه دارد.
 *  • متن هر ردیف = «اتفاقات کلیِ پایان همان برنامه» (نه هفته‌به‌هفته).
 *  • اگر رسیدن به هدف بیش از ۶ برنامه طول بکشد (افت وزن خیلی بزرگ)، برنامهٔ ششم
 *    همان ردیف «رسیدن به هدف» است و روزهای ادامهٔ مسیر صادقانه نشان داده می‌شود.
 *  • کاملاً قطعی و محلی — بدون هیچ هزینهٔ AI یا endpoint.
 */

import type { Goal } from "./types";
import { toPersianDigits } from "./types";

export const PROGRAM_DAYS = 45;
/** دیرکتیو مالک: مسیر همیشه ۶ برنامه نمایش داده می‌شود (۶ × ۴۵ = ۲۷۰ روز) */
export const PATH_PROGRAM_COUNT = 6;

export interface ProgressProgram {
  /** 1-based شمارهٔ برنامه */
  index: number;
  /** «برنامهٔ اول» … «برنامهٔ ششم» */
  label: string;
  startDay: number;
  endDay: number;
  headline: string;
  items: string[];
  startWeight: number | null;
  endWeight: number | null;
  /** تغییر وزن همین برنامه (کیلوگرم، منفی = کاهش، صفر = تثبیت) */
  delta: number | null;
  isFinal: boolean;
  /** goal = برنامه‌های مسیر رسیدن به هدف | post = برنامه‌های پس از هدف */
  phase: "goal" | "post";
}

export interface ProgressPath {
  goalLabel: string;
  weeklyRate: number | null;
  weeksToGoal: number | null;
  totalDays: number | null;
  currentWeight: number;
  targetWeight: number | null;
  calorieAdjustment: number | null;
  /** مسیر همیشه ۶ برنامه است (v133) */
  programs: ProgressProgram[];
  /** هدف در برنامهٔ چندم محقق می‌شود (شمارهٔ ردیف 🏁) */
  goalProgramIndex: number;
}

/** ردیف اول تا ششم — «برنامهٔ اول» … «برنامهٔ ششم» */
const ORDINALS = ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم"];

const GOAL_LABELS_LOCAL: Record<Goal, string> = {
  fat_loss: "چربی‌سوزی",
  cut: "کات (چربی‌سوزی با حفظ عضله)",
  muscle_gain: "عضله‌سازی",
  bulk: "افزایش حجم",
  strength: "افزایش قدرت",
  endurance: "استقامت",
  fitness: "تناسب اندام",
};

const PLACE_LABELS: Record<string, string> = {
  gym: "باشگاه",
  home: "خانه",
  both: "باشگاه و خانه",
};

const DIET_LABELS_LOCAL: Record<string, string> = {
  standard: "رژیم استاندارد",
  vegetarian: "گیاه‌خواری",
  vegan: "وگان",
  keto: "کتوژنیک",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** نرخ ایمن پیش‌فرض بر اساس هدف (کیلوگرم در هفته) — همان منطق API تحلیل */
function defaultWeeklyRate(goal: Goal): number | null {
  if (goal === "fat_loss" || goal === "cut") return -0.5;
  if (goal === "bulk") return 0.3;
  if (goal === "muscle_gain") return 0.25;
  return null; // قدرت/استقامت/تناسب — مسیر وزن‌محور نیست
}

// ─────────────────────────────────────────────────────────────────────────────
// مایلستون‌های هر برنامه — «اتفاقات پایان برنامه» — شخصی‌سازی‌شده با آنبوردینگ
// ─────────────────────────────────────────────────────────────────────────────
interface MilestoneCtx {
  goal: Goal;
  goalLabel: string;
  losing: boolean; // true = کاهش وزن
  workoutDays: number | null;
  placeLabel: string | null;
  discipline: string | null;
  dietLabel: string | null;
  hasHealthNote: boolean;
  /** |تغییر وزن این برنامه| به‌صورت متن ارقام فارسی (مثل «۳٫۲») */
  deltaAbs: string | null;
  /** وزن هدف به‌صورت متن ارقام فارسی (مثل «۷۶٫۰») */
  targetWeightFa: string | null;
}

/** فازهای «پس از هدف» — به ترتیب اجرا؛ ردیف آخر جدول همیشه ردیف جمع‌بندی است */
const POST_GOAL_PHASES: Array<{ headline: string; items: (ctx: MilestoneCtx) => string[] }> = [
  {
    headline: "نگه‌داشتن نتیجه برای همیشه",
    items: (ctx) => [
      ctx.targetWeightFa
        ? `وزن دقیقاً روی ${ctx.targetWeightFa} کیلوگرم تثبیت شده — بدون برگشت`
        : "نتیجه به‌طور پایدار تثبیت شده — بدون برگشت",
      "عادت‌های تمرین و تغذیه خودکار شده‌اند — بدون تصمیم‌گیری روزانه",
      "بدن روی پایهٔ سالم و پایدار — آمادهٔ فاز بعدی",
    ],
  },
  {
    headline: "هم‌زمان چربی کمتر و عضله بیشتر",
    items: () => [
      "کم‌کردن چربی و ساختن عضله هم‌زمان — ضعف‌های بدن برطرف شده",
      "فرم عضلات واضح‌تر — کیفیت بدن بالاتر از عدد ترازو",
      "نقاط قوت برجسته‌تر و نقاط ضعف رفع شده",
    ],
  },
  {
    headline: "عضله‌سازی مرحلهٔ بعد",
    items: () => [
      "فاز جدید هدف روی پایهٔ تثبیت‌شده شروع شده — مسیر بعدی با چکاپ‌ها طراحی می‌شود",
      "اعداد تمرین بهتر از همیشه — رکوردهای جدید",
      "پروتئین و تغذیه برای فاز جدید بازتنظیم شده",
    ],
  },
  {
    headline: "پیشرفت عملکردی",
    items: () => [
      "قدرت، استقامت و انرژی روزانه در بالاترین سطح دوران تمرینی‌ات",
      "اجرای فنی حرکات در سطح ورزشکاران جدی",
      "سبک زندگی فیت برای همیشه جا افتاده — این فقط شروع است",
    ],
  },
];

/** ردیف جمع‌بندیِ انتهای جدول (برنامهٔ ششم) — وقتی هدف زودتر محقق شده باشد */
function postGoalClosing(ctx: MilestoneCtx): { headline: string; items: string[] } {
  return {
    headline: "🏁 مسیر بلندمدت تو",
    items: [
      `فیتاپ ${toPersianDigits(PATH_PROGRAM_COUNT * PROGRAM_DAYS)} روز (۶ برنامهٔ ۴۵ روزه) را از همین امروز برایت برنامه‌ریزی کرده`,
      "با هر چکاپ دوره‌ای، برنامه‌های بعدی دقیق‌تر و اختصاصی‌تر می‌شوند",
      ctx.goal === "muscle_gain" || ctx.goal === "bulk"
        ? "هدف بعدی را با هم انتخاب می‌کنیم: حجم تمیز بالاتر یا کات و کار روی فرم"
        : "هدف بعدی را با هم انتخاب می‌کنیم: حفظ فرم، قدرت بالاتر یا یک چالش جدید",
    ],
  };
}

function buildMilestones(index: number, ctx: MilestoneCtx): { headline: string; items: string[] } {
  const { goalLabel, losing, workoutDays, placeLabel, discipline, dietLabel, hasHealthNote, deltaAbs, targetWeightFa } = ctx;
  const place = placeLabel ?? "باشگاه";

  if (index === 1) {
    const items: string[] = [
      `کالری و درشت‌مغذی‌ها دقیقاً روی هدف ${goalLabel} تنظیم شده و بدنت به برنامه عادت کرده`,
      workoutDays
        ? `تمرین ${toPersianDigits(workoutDays)} روز در هفته در ${place} به عادت تبدیل شده — تکنیک حرکات پایه درست شده`
        : `عادت تمرین منظم در ${place} جا افتاده — تکنیک حرکات پایه درست شده`,
    ];
    if (discipline) items.push(`تمرین‌ها مخصوص رشتهٔ ${discipline} جواب داده‌اند — نه یک برنامهٔ عمومی`);
    if (dietLabel) items.push(`برنامهٔ غذایی ${dietLabel} با سلیقهٔ تو جا افتاده — بدون غذای تکراری`);
    if (hasHealthNote) items.push("تمرین امن: حرکات جایگزینِ آسیب/شرایط جسمانی‌ات بدون مشکل اجرا شده");
    items.push("انرژی روزانه و کیفیت خواب بهتر شده — اولین نشانه‌های واقعی تغییر");
    return { headline: "پایان برنامهٔ اول — عادت‌های تازه جا می‌افتد", items };
  }

  if (index === 2) {
    const body = deltaAbs
      ? losing
        ? `حدود ${deltaAbs} کیلوگرم چربی کم کرده‌ای — تغییر در آینه و لباس‌ها مشخص است`
        : `حدود ${deltaAbs} کیلوگرم حجم و قدرت اضافه کرده‌ای — اولین تغییرهای شکل بدن`
      : losing
        ? "کاهش واقعی چربی اتفاق افتاده — تغییر در آینه و لباس‌ها"
        : "افزایش واقعی حجم و قدرت — اولین تغییرهای شکل بدن";
    return {
      headline: "پایان برنامهٔ دوم — اولین نتیجه‌ها را می‌بینی",
      items: [
        body,
        "وزنه‌ها نسبت به شروع سنگین‌تر شده‌اند — بدنت به تمرین جواب داده",
        "برنامه با دادهٔ واقعی بدنت اصلاح شده — نه یک قالب ثابت",
      ],
    };
  }

  if (index === 3) {
    return {
      headline: "پایان برنامهٔ سوم — از مرحلهٔ توقف وزن عبور می‌کنی",
      items: [
        "وزنی که مدتی گیر کرده بود، با تنظیم کالری و تنوع حرکات دوباره حرکت می‌کند",
        dietLabel
          ? `عادت‌های غذایی ${dietLabel} کاملاً تثبیت شده — تغذیه دیگر «رژیم» نیست، سبک زندگی توست`
          : "عادت‌های غذایی کاملاً تثبیت شده — تغذیه دیگر «رژیم» نیست، سبک زندگی توست",
        losing
          ? "چربی‌سوزی ادامه‌دار با حفظ کامل عضله — وزنه‌ها سبک نشده‌اند"
          : "حجم‌گیری تمیز ادامه‌دار — بدون چربی اضافه",
      ],
    };
  }

  if (index === 4) {
    return {
      headline: "پایان برنامهٔ چهارم — تغییر برای همه آشکار می‌شود",
      items: [
        "تغییر محسوس در ترکیب بدن و فرم عضلات — اطرافیان متوجه می‌شوند",
        targetWeightFa
          ? `فاصله تا وزن هدف (${targetWeightFa} کیلوگرم) خیلی کم شده`
          : "نزدیک شدن به هدف تمرینی‌ات",
        "برنامه در نیمهٔ مسیر با داده‌های چکاپ‌ها کامل به‌روز شده",
      ],
    };
  }

  // برنامهٔ پنجم (و در مسیرهای کوتاه، برنامه‌های میانی پس از هدف)
  return {
    headline: "پایان برنامهٔ پنجم — فرم بدن دقیق‌تر و زیباتر می‌شود",
    items: [
      "ریزتنظیم نقاط ضعف و تقویت نقاط قوت بدن انجام شده",
      losing
        ? "چربی پایین و پایدار — بدون ترس از برگشت"
        : "حجم عضلانی پایدار و باکیفیت",
      targetWeightFa
        ? `آمادهٔ فاز نهایی: رسیدن دقیق به ${targetWeightFa} کیلوگرم`
        : "آمادهٔ فاز نهایی رسیدن به هدف",
    ],
  };
}

/** مایلستون ردیف «رسیدن به هدف» — پایان برنامهٔ Nام */
function finalMilestone(
  ctx: MilestoneCtx & { ordinal: string },
): { headline: string; items: string[] } {
  const items = [
    ctx.targetWeightFa
      ? `🏁 رسیدن به وزن ${ctx.targetWeightFa} کیلوگرم — دقیقاً همان عددی که در آنبوردینگ انتخاب کردی`
      : "🏁 رسیدن به هدف تمرینی خودت",
    "یاد می‌گیری نتیجه‌ات را برای همیشه حفظ کنی — بدون ترس از برگشت",
    ctx.goal === "muscle_gain" || ctx.goal === "bulk"
      ? "تصمیم برای مرحلهٔ بعد: ادامهٔ حجم تمیز یا کات و کار کردن روی فرم"
      : "تصمیم برای مرحلهٔ بعد: حفظ فرم، افزایش قدرت یا شروع یک هدف جدید",
  ];
  return { headline: `🏁 پایان برنامهٔ ${ctx.ordinal} — رسیدن به هدف`, items };
}

/** وزن با یک رقم اعشار و ارقام فارسی (مثل «۷۴٫۶») */
function faWeight(n: number): string {
  return toPersianDigits(n.toFixed(1).replace(".", "٫"));
}

/** وزن تخمینی در پایان روز d از trajectory (کیلوگرم) */
function weightAtDay(currentWeight: number, weeklyRate: number, day: number): number {
  return round1(currentWeight + weeklyRate * (day / 7));
}

// ─────────────────────────────────────────────────────────────────────────────
// سازندهٔ مسیر پیشرفت — همیشه ۶ برنامه
// ─────────────────────────────────────────────────────────────────────────────
export function buildProgressPath(input: {
  goal: Goal;
  currentWeight: number;
  targetWeight?: number | null;
  weeklyRate?: number | null;
  weeksToGoal?: number | null;
  weeklyCalorieAdjustment?: number | null;
  workoutDays?: number | null;
  workoutPlace?: string | null;
  discipline?: string | null;
  dietType?: string | null;
  hasInjuries?: boolean;
  hasDiseases?: boolean;
}): ProgressPath {
  const goalLabel = GOAL_LABELS_LOCAL[input.goal] ?? "تناسب اندام";
  const currentWeight = round1(Number(input.currentWeight) || 0);
  const targetWeight =
    input.targetWeight && input.targetWeight > 0 ? round1(input.targetWeight) : null;

  let weeklyRate = input.weeklyRate ?? null;
  let weeksToGoal = input.weeksToGoal ?? null;

  const weightTracked =
    targetWeight != null &&
    targetWeight !== currentWeight &&
    weeklyRate != null &&
    weeklyRate !== 0;

  // اگر trajectory از API نیامده، از نرخ ایمن پیش‌فرض هدف بساز
  if (targetWeight != null && targetWeight !== currentWeight && (weeklyRate == null || weeklyRate === 0)) {
    weeklyRate = defaultWeeklyRate(input.goal);
    if (weeklyRate != null) {
      weeksToGoal = Math.max(1, Math.ceil(Math.abs(targetWeight - currentWeight) / Math.abs(weeklyRate)));
    }
  }
  if (weeklyRate == null) weeklyRate = defaultWeeklyRate(input.goal);

  const ctx: MilestoneCtx = {
    goal: input.goal,
    goalLabel,
    losing: (weeklyRate ?? 0) < 0,
    workoutDays: input.workoutDays ?? null,
    placeLabel: input.workoutPlace ? PLACE_LABELS[input.workoutPlace] ?? null : null,
    discipline: (input.discipline ?? "").trim() || null,
    dietLabel: input.dietType ? DIET_LABELS_LOCAL[input.dietType] ?? null : null,
    hasHealthNote: !!input.hasInjuries || !!input.hasDiseases,
    deltaAbs: null,
    targetWeightFa: targetWeight != null ? faWeight(targetWeight) : null,
  };

  const programs: ProgressProgram[] = [];

  if (weightTracked && weeklyRate && weeksToGoal) {
    const totalDays = Math.max(1, weeksToGoal * 7);
    // چند برنامه ۴۵ روزه تا رسیدن به هدف؟ (سقف = ۶)
    const goalPrograms = Math.min(PATH_PROGRAM_COUNT, Math.max(1, Math.ceil(totalDays / PROGRAM_DAYS)));
    const overshoot = Math.ceil(totalDays / PROGRAM_DAYS) > PATH_PROGRAM_COUNT; // هدف از ۶ برنامه بلندتر است

    for (let i = 1; i <= PATH_PROGRAM_COUNT; i++) {
      const isGoalRow = i === goalPrograms; // ردیف رسیدن به هدف
      const isPostGoal = !overshoot && i > goalPrograms; // برنامه‌های پس از هدف
      const isFinal = i === PATH_PROGRAM_COUNT; // ردیف آخر جدول همیشه طلایی

      const startDay = PROGRAM_DAYS * (i - 1) + 1;
      // اگر هدف بیش از ۶ برنامه طول بکشد، ردیف ششم تا «روز رسیدن به هدف» ادامه دارد
      const endDay = overshoot && i === PATH_PROGRAM_COUNT
        ? totalDays
        : Math.min(PROGRAM_DAYS * i, Math.max(totalDays, PROGRAM_DAYS * i));

      let startWeight: number | null = null;
      let endWeight: number | null = null;
      let delta: number | null = null;
      let headline: string;
      let items: string[];
      let phase: "goal" | "post" = "goal";

      if (isPostGoal) {
        // ─── برنامه‌های پس از هدف: وزن ثابت روی هدف ───
        phase = "post";
        startWeight = targetWeight;
        endWeight = targetWeight;
        delta = 0;
        if (isFinal) {
          const closing = postGoalClosing(ctx);
          headline = closing.headline;
          items = closing.items;
        } else {
          const ph = POST_GOAL_PHASES[i - goalPrograms - 1] ?? POST_GOAL_PHASES[POST_GOAL_PHASES.length - 1];
          headline = `پایان برنامهٔ ${ORDINALS[i - 1]} — ${ph.headline}`;
          items = ph.items(ctx);
        }
      } else {
        // ─── برنامه‌های مسیر رسیدن به هدف: وزن از trajectory ───
        startWeight = i === 1 ? currentWeight : programs[i - 2]?.endWeight ?? null;
        endWeight = isGoalRow || (overshoot && i === PATH_PROGRAM_COUNT)
          ? targetWeight
          : weightAtDay(currentWeight, weeklyRate, endDay);
        delta = startWeight != null && endWeight != null ? round1(endWeight - startWeight) : null;

        const ms = isGoalRow
          ? finalMilestone({ ...ctx, ordinal: ORDINALS[i - 1] })
          : buildMilestones(i, {
              ...ctx,
              deltaAbs: delta ? faWeight(Math.abs(delta)) : null,
              // در مسیر بلندتر از ۶ برنامه، ردیف‌های میانی مثل «شکستن پلاتو/تبدیل» ماندگار می‌شوند
              targetWeightFa: ctx.targetWeightFa,
            });
        headline = ms.headline;
        items = ms.items;
      }

      programs.push({
        index: i,
        label: `برنامهٔ ${ORDINALS[i - 1]}`,
        startDay,
        endDay,
        headline,
        items,
        startWeight,
        endWeight,
        delta,
        isFinal,
        phase,
      });
    }

    return {
      goalLabel,
      weeklyRate,
      weeksToGoal,
      totalDays,
      currentWeight,
      targetWeight,
      calorieAdjustment: input.weeklyCalorieAdjustment ?? null,
      programs,
      goalProgramIndex: goalPrograms,
    };
  }

  // ─── مسیر بدون وزن هدف (قدرت/استقامت/تناسب یا بدون عدد هدف) — همان ۶ برنامه ───
  const phaseHeadlines: Record<number, { headline: string; items: string[] }> = {
    1: buildMilestones(1, ctx),
    2: buildMilestones(2, { ...ctx, deltaAbs: null }),
    3: buildMilestones(3, ctx),
    4: buildMilestones(4, ctx),
    5: buildMilestones(5, ctx),
    6: {
      headline: "🏁 پایان برنامهٔ ششم — رسیدن به هدف",
      items: [
        "🏁 رسیدن به آمادگی جسمانی هدف — با اعداد قابل اندازه‌گیری در چکاپ‌ها",
        "شروع فاز تثبیت — حفظ نتیجه به‌صورت عادت پایدار",
        "تصمیم برای مرحلهٔ بعد: هدف جدید، قدرت بالاتر یا رشتهٔ تخصصی",
      ],
    },
  };

  for (let i = 1; i <= PATH_PROGRAM_COUNT; i++) {
    const ms = phaseHeadlines[i];
    programs.push({
      index: i,
      label: `برنامهٔ ${ORDINALS[i - 1]}`,
      startDay: PROGRAM_DAYS * (i - 1) + 1,
      endDay: PROGRAM_DAYS * i,
      headline: ms.headline,
      items: ms.items,
      startWeight: null,
      endWeight: null,
      delta: null,
      isFinal: i === PATH_PROGRAM_COUNT,
      phase: "goal",
    });
  }

  return {
    goalLabel,
    weeklyRate,
    weeksToGoal: null,
    totalDays: null,
    currentWeight,
    targetWeight: null,
    calorieAdjustment: null,
    programs,
    goalProgramIndex: PATH_PROGRAM_COUNT,
  };
}
