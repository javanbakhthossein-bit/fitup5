/**
 * coach-blueprint.ts — 🏛️ مغز معمار برنامهٔ فیتاپ (v213 — دیرکتیو مالک: برنامهٔ نخبگی)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * مسئلهٔ ریشه‌ای (ممیزی ۱۶۳ برنامهٔ واقعی کاربران — دیتابیس تولید ۲۰۲۶-۱۰-۰۷):
 *   • ۶۷.۳٪ روزهای تمرینی «۳ گروه عضلانی یا بیشتر» دارند و فقط ۸.۴٪ روز
 *     تک‌عضله‌ای است؛ ۲۲.۷٪ کاربران حتی «یک» روز تک‌عضله‌ای ندارند.
 *   • علت در کد: منوی ثابت اسپلیتِ وابسته به «تعداد روز» در پرامپت (۳ روز →
 *     PPL با ممنوعیت روز تک‌عضله‌ای؛ ۴ روز → UL/PPL؛ ۶ روز → PPL×۲ اجباری؛ ...)
 *     + ترمیمِ کورِ پوشش عضلانی که حرکتِ عضلهٔ جاافتاده را به «روز خلوت‌تر»
 *     می‌چسباند → روزِ فرانکنشتاینی (سینه+سرشانه+پشت‌بازو+جلوبازو+بارفیکس).
 *   • نتیجه: معماریِ برنامه تابعِ تعداد روز است، نه شخص کاربر — دو کاربر با
 *     ۴ روز، فارغ از هدف/سابقه/ضعف بدنی، یک اسپلیت می‌گیرند.
 *
 * راه‌حل معماری — «مربیِ تصمیم‌گیر قبل از مدل زبانی»:
 *   LLM برای انتخاب توزیع عضلات به «حالت غالب» برمی‌گردد (regression to the
 *   mean). پس تصمیمِ معماریِ هفتگی — که قلب شخصی‌سازی است — از LLM گرفته شد
 *   و به این موتورِ قطعی (deterministic) داده شد که از پروفایل واقعی کاربر
 *   (هدف، سابقه، رشته، ریکاوری، نقاط ضعف آنالیز بدن، تجهیزات) معماری را
 *   انتخاب می‌کند. LLM در چارچوب این معماری، حرکات/ست/تمپو/نکات مربی را
 *   می‌نویسد (کاری که در آن بهترین است).
 *
 * مبانی علمی و مربیان (همان ادعای برند فیتاپ):
 *   • حجم روزانهٔ عضله: حداکثر ~۸ ست سنگین مؤثر در جلسه (Schoenfeld 2019 —
 *     ریزش بازده ست‌های ۹ به بعد در همان جلسه) → بودجهٔ هفتگی باید بین ۲ جلسه
 *     پخش شود؛ همین قید، «۴ بارفیکس در یک روز» را از نظر ساختاری ناممکن می‌کند.
 *   • بودجهٔ ست هفتگی (MEV–MAV): سینه/زیربغل ۱۰-۲۰، سرشانه ۱۰-۱۶، بازو ۸-۱۴،
 *     پا ۸-۱۶، عقب‌سرشانه ۶-۱۰، ساق/شکم ۶-۱۲ — مقیاس‌شده با سابقه/هدف/ریکاوری.
 *   • فرکانس: هر عضله ۱ بار مستقیم + هم‌پوشانی، یا ۲ بار مستقیم (نقاط ضعف
 *     همیشه ۲ بار — اولویت اول جلسه) — طبق اصل اولویت‌دهی مربیان نخبه.
 *   • FST-7 هانی رامبد برای ورزشکار حرفه‌ایِ هایپرتروفی (۷ ست پمپ نهایی).
 *   • اسپلیت‌های عضله‌محور (Bro/Arnold) برای هایپرتروفیِ سابقه‌دار — همان چیزی
 *     که آرنولد/کاتلر/کلمن/بامستد/رامبد واقعاً می‌دادند؛ اما «مبتدی هرگز» —
 *     چون مبتدی به فرکانس و یادگیری الگو نیاز دارد (اصل علمی، نه سلیقه).
 *
 * قراردادهای فیتاپ: این ماژول هرگز throw نمی‌کند؛ در بدترین حالت blueprint
 *   امنِ پیش‌فرض (فول‌بادی/UL) برمی‌گرداند. خروجی روی خود برنامه ذخیره می‌شود
 *   (coachBlueprint) تا گیت کیفیت/ترمیم‌ها/ادمین همه از «یک حقیقت» بخوانند.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { MajorGroupKey } from "./exercise-bank-lock";
import { majorGroupsOfExercise } from "./exercise-bank-lock";
import { sortWeekdaysByPersianOrder } from "./types";

// ───────────────────────────── تایپ‌ها ─────────────────────────────

export interface CoachBlueprintInput {
  gender?: string;
  age?: number;
  goal?: string;
  trainingExperience?: string;
  workoutDays: number;
  workoutDaysList?: string[];
  workoutPlace?: string;
  equipment?: string[];
  discipline?: string;
  bodyShape?: string;
  bodyShapeFocus?: string;
  sleepHours?: number;
  stressLevel?: number;
  smokingHabit?: string;
  injuries?: string;
  injuryAreas?: string[];
  medicalConditions?: string[];
  /** نقاط ضعف از آنالیز عکس/ویدیوی بدن — اولویت اول معماری (دیرکتیو مالک v148+) */
  weakPoints?: string[];
  specialConditions?: string;
  /** seed اختیاری برای تولید قطعی (تست) — در تولید واقعی از پروفایل+زمان ساخته می‌شود */
  seed?: number;
}

/** عضلات سطح بالای معماری — هم‌راستا با واژگان بانک حرکات فیتاپ */
export const BP_MUSCLES = [
  "سینه",
  "زیربغل/پشت",
  "سرشانه",
  "سرشانهٔ عقب",
  "جلو بازو",
  "پشت بازو",
  "چهارسر",
  "پشت پا",
  "باسن",
  "ساق",
  "شکم و مرکز",
  "هوازی",
] as const;
export type BpMuscle = (typeof BP_MUSCLES)[number];

export interface BlueprintDay {
  day: string;
  title: string;
  primary: BpMuscle[];
  secondary: BpMuscle[];
  /** توضیح مربی‌وار: چرا این روز این‌طور چیده شده (برای کاربر و ممیز) */
  rationale: string;
}

export interface WeeklySetBudget {
  muscle: BpMuscle;
  min: number;
  max: number;
  /** فرکانس مستقیم توصیه‌شده در هفته */
  frequency: number;
  /** اولویت نخست جلسه + حجم بالاتر (نقطهٔ ضعف کاربر) */
  priority: boolean;
}

export interface CoachBlueprint {
  splitId: string;
  splitLabelFa: string;
  coachModelFa: string;
  coachKey: "hany_rambod" | "chris_bumstead" | "ronnie_coleman" | "jay_cutler" | "hadi_chupan" | "mixed";
  days: BlueprintDay[];
  weeklySets: WeeklySetBudget[];
  /** روز/عضلهٔ FST-7 (هانی رامبد) — در صورت شمول */
  fst7?: { dayIndex: number; muscle: BpMuscle; note: string };
  periodizationHint: "linear" | "undulating" | "daily_undulating";
  /** قواعد ریز اجرا (تمپو/شدت/شرطی‌سازی) — برای تزریق در پرامپت */
  executionNotes: string[];
  /** دلایل انتخاب معماری برای همین کاربر — شفافیت برای ممیز/ادمین */
  rationaleLines: string[];
}

// ───────────────────────── ابزارهای پایه ─────────────────────────

/** هش ۳۲بیتی FNV-1a — seed پایدار از متن پروفایل */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** PRNG mulberry32 — انتخاب وزنیِ قطعی با seed */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T>(items: Array<{ item: T; w: number }>, rnd: () => number): T | null {
  const total = items.reduce((s, x) => s + Math.max(0, x.w), 0);
  if (total <= 0 || items.length === 0) return null;
  let r = rnd() * total;
  for (const x of items) {
    r -= Math.max(0, x.w);
    if (r <= 0) return x.item;
  }
  return items[items.length - 1].item;
}

const HYPERTROPHY_GOALS = new Set(["muscle_gain", "bulk"]);
const FATLOSS_GOALS = new Set(["fat_loss", "cut"]);
const STRENGTH_GOALS = new Set(["strength"]);
const BODYBUILDING_DISCIPLINES = new Set([
  "bodybuilding", "classic_physique", "mens_physique", "womens_physique",
  "wellness", "bikini_fitness", "fitness", "womens_fitness",
]);
const STRENGTH_DISCIPLINES = new Set(["powerlifting"]);
const CONDITIONING_DISCIPLINES = new Set(["crossfit", "hiit", "functional", "calisthenics", "trx"]);
/** v230 — رشته‌های باسن‌محور بانوان (تیکت مالک: «برنامه باسن می‌خوام») */
const GLUTE_DISCIPLINES = new Set(["womens_fitness", "wellness", "bikini_fitness", "womens_physique"]);

const PERSIAN_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

function expLevel(exp?: string): "beginner" | "intermediate" | "advanced" | "pro" {
  if (exp === "beginner" || exp === "intermediate" || exp === "advanced" || exp === "pro") return exp;
  return "beginner";
}

/** نگاشت عضلهٔ معماری → گروه اصلی بانک (برای ترمیم‌ها/گیت) */
export function bpMuscleToGroup(m: BpMuscle): MajorGroupKey | null {
  switch (m) {
    case "سینه": return "chest";
    case "زیربغل/پشت": return "back";
    case "سرشانه":
    case "سرشانهٔ عقب": return "shoulders";
    case "جلو بازو":
    case "پشت بازو": return "arms";
    case "چهارسر":
    case "پشت پا":
    case "باسن":
    case "ساق": return "legs";
    case "شکم و مرکز": return "core";
    default: return null; // هوازی
  }
}

/** گروه‌های مجاز یک روز (primary ∪ secondary) — حرکتِ عضلهٔ بیرونِ این مجموعه در این روز ممنوع */
export function blueprintDayAllowedGroups(bp: CoachBlueprint, dayIndex: number): Set<MajorGroupKey> {
  const out = new Set<MajorGroupKey>();
  const d = bp.days[dayIndex];
  if (!d) return out;
  for (const m of [...d.primary, ...d.secondary]) {
    const g = bpMuscleToGroup(m);
    if (g) out.add(g);
  }
  return out;
}

/** گروه‌های اصلی یک روز — ستون فقرات روز؛ ≥۶۰٪ حرکات باید از این‌ها باشند */
export function blueprintDayPrimaryGroups(bp: CoachBlueprint, dayIndex: number): Set<MajorGroupKey> {
  const out = new Set<MajorGroupKey>();
  const d = bp.days[dayIndex];
  if (!d) return out;
  for (const m of d.primary) {
    const g = bpMuscleToGroup(m);
    if (g) out.add(g);
  }
  return out;
}

// ───────────────────── کتابخانهٔ اسپلیت‌های نخبگی ─────────────────────
// هر اسپلیت: سازندهٔ day-spec برای n روز مشخص + شرط اعتبار + وزن ترجیح

interface DaySpec {
  title: string;
  primary: BpMuscle[];
  secondary: BpMuscle[];
  rationale: string;
}

interface Archetype {
  id: string;
  labelFa: string;
  coachFa: string;
  coachKey: CoachBlueprint["coachKey"];
  fst7Capable: boolean;
  /** روزهای پشتیبانی‌شده */
  nSet: number[];
  /** نقشهٔ day-spec برای هر n */
  build: (n: number, ctx: BlueprintContext) => DaySpec[] | null;
  ok: (ctx: BlueprintContext) => boolean;
  weight: (ctx: BlueprintContext) => number;
  /** v230 — اگر ok() برقرار باشد، این اسپلیت بدون قرعه (قطعی) انتخاب می‌شود —
   * رشته‌های تعریف‌شده (مثل باسن‌محوری بانوان) معماری‌شان خودِ رشته است، نه قرعه. */
  forced?: (ctx: BlueprintContext) => boolean;
  periodization: CoachBlueprint["periodizationHint"];
  executionNotes?: (ctx: BlueprintContext) => string[];
}

interface BlueprintContext {
  n: number;
  exp: ReturnType<typeof expLevel>;
  goal?: string;
  discipline?: string;
  gender?: string;
  recoveryLimited: boolean;
  weakPoints: string[];
  /** v230 — عضلات اولویت‌دار (مثل باسن برای بانوان فیتنس/ولنس) — بودجه/فرکانس بالاتر + تضمین ۲ جلسه */
  priorityMuscles: BpMuscle[];
  homeGym: boolean;
  rationale: string[]; // انباشت دلایل انتخاب
}

// ── استاندارد روزها — عنوان/توجیه مربی‌وار (زبان مربی، نه ماشین) ──
const R = {
  fb: (b: string) => `بدن کامل — یادگیری الگو + فرکانس بالا؛ تمرکز جلسه: ${b}`,
  ulPush: "بالاتنه پرس‌محور (سینه/سرشانه/پشت‌بازو) — خروجی پرس قوی‌تر + حجم سینه و سرشانه",
  ulPull: "بالاتنه کشش‌محور (زیربغل/عقب‌سرشانه/جلوبازو) — پهن‌سازی پشت و ضخامت",
  ulSquat: "پایین‌تنه اسکوات‌محور (چهارسر/باسن) — قدرت پایه و حجم ران",
  ulHinge: "پایین‌تنه هینج‌محور (پشت پا/باسن) — زنجیرهٔ خلفی و فرم باسن",
  push: "روز فشار — سینه/سرشانه/پشت‌بازو در یک زنجیرهٔ پرس؛ هم‌افزایی عصبی هم‌الگو",
  pull: "روز کشش — زیربغل/عقب‌سرشانه/جلوبازو؛ هم‌افزایی گریپ و کشش",
  legs: "روز پا — الگوی اسکوات/هینج/ساق در یک جلسه؛ بیشترین پاسخ هورمونی",
  torso: "تنه — سینه+زیربغل (افقی/عمودی) با بازوی کم‌فشار؛ حجم بالاتنهٔ سریع",
  limb: "اندام — پا + بازو با شکم؛ خستگی سیستمیک کمتر، تمرکز اندام",
  chestBi: "روز کلاسیک آرنولدی — سینه با جلو بازو؛ بازو بعد از پرس، بدون تداخل",
  backTri: "زیربغل با پشت‌بازو؛ پول + سه‌سر، همان منطق هم‌افزایی کشش",
  deltsAbs: "سرشانه کامل (جلو/جانب/عقب) + شکم — پهن‌سازی خط شانه و کمر باریک‌تر",
  arms: "روز بازو — جلو + پشت بازو با پمپ بالا (FST-7/دراپ‌ست)؛ بازو با انرژی کامل",
  weakDay: "روز ضعف‌محور — اولویت اول آنالیز بدن کاربر؛ فرکانس ۲ + حجم بالاتر",
} as const;

const fullBodyArch: Archetype = {
  id: "full_body",
  labelFa: "بدن کامل (Full-Body)",
  coachFa: "مکتب فانکشنال-هایپرتروفی مدرن (فرکانس بالا، حجم معقول)",
  coachKey: "mixed",
  fst7Capable: false,
  nSet: [1, 2, 3],
  build: (n) => {
    if (n === 1) return [{ title: "بدن کامل — کل الگوها", primary: ["چهارسر", "سینه", "زیربغل/پشت"], secondary: ["سرشانه", "شکم و مرکز"], rationale: R.fb("اسکوات+پرس+کشش") }];
    if (n === 2) return [
      { title: "بدن کامل A — پرس‌محور", primary: ["سینه", "چهارسر"], secondary: ["سرشانه", "پشت بازو", "شکم و مرکز"], rationale: R.fb("پرس + اسکوات") },
      { title: "بدن کامل B — کشش‌محور", primary: ["زیربغل/پشت", "پشت پا"], secondary: ["جلو بازو", "شکم و مرکز"], rationale: R.fb("کشش + هینج") },
    ];
    return [
      { title: "بدن کامل A — پا + پرس", primary: ["چهارسر", "سینه"], secondary: ["سرشانه", "پشت بازو", "شکم و مرکز"], rationale: R.fb("اسکوات + پرس سینه") },
      { title: "بدن کامل B — کشش", primary: ["زیربغل/پشت", "پشت پا"], secondary: ["جلو بازو", "شکم و مرکز"], rationale: R.fb("کشش عمودی + هینج") },
      { title: "بدن کامل C — پا + پرس دوم", primary: ["باسن", "سرشانه"], secondary: ["چهارسر", "پشت بازو", "شکم و مرکز"], rationale: R.fb("هینج + پرس سرشانه") },
    ];
  },
  ok: () => true,
  weight: (c) => 2 + (c.exp === "beginner" ? 4 : 0) + (FATLOSS_GOALS.has(c.goal ?? "") ? 2 : 0) + (CONDITIONING_DISCIPLINES.has(c.discipline ?? "") ? 2 : 0) + (c.recoveryLimited ? 1 : 0),
  periodization: "linear",
};

const upperLowerArch: Archetype = {
  id: "upper_lower",
  labelFa: "بالاتنه/پایین‌تنه (Upper/Lower)",
  coachFa: "مکتب قدرت-هایپرتروفی (جف دوقتا/لایمار شیمونز) — فرکانس ۲ با مدیریت خستگی",
  coachKey: "mixed",
  fst7Capable: false,
  nSet: [2, 3, 4],
  build: (n) => {
    if (n === 2) return [
      { title: "بالاتنه", primary: ["سینه", "زیربغل/پشت"], secondary: ["سرشانه", "جلو بازو", "پشت بازو"], rationale: "بالاتنه — همهٔ الگوهای پرس/کشش" },
      { title: "پایین‌تنه", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق", "شکم و مرکز"], rationale: "پایین‌تنه — اسکوات + هینج + ساق" },
    ];
    if (n === 3) return [
      { title: "بالاتنه", primary: ["سینه", "زیربغل/پشت"], secondary: ["سرشانه", "جلو بازو", "پشت بازو"], rationale: "بالاتنه — پرس/کشش افقی و عمودی" },
      { title: "پایین‌تنه", primary: ["چهارسر", "باسن"], secondary: ["پشت پا", "ساق", "شکم و مرکز"], rationale: "پایین‌تنه — اسکوات‌محور" },
      { title: "بالاتنه B + شکم", primary: ["زیربغل/پشت", "سرشانه"], secondary: ["سینه", "جلو بازو", "پشت بازو", "شکم و مرکز"], rationale: "بالاتنهٔ دوم با تأکید کشش + شکم" },
    ];
    return [
      { title: "بالاتنه — پرس‌محور", primary: ["سینه", "سرشانه"], secondary: ["پشت بازو", "زیربغل/پشت"], rationale: R.ulPush },
      { title: "پایین‌تنه — اسکوات‌محور", primary: ["چهارسر", "باسن"], secondary: ["ساق", "شکم و مرکز"], rationale: R.ulSquat },
      { title: "بالاتنه — کشش‌محور", primary: ["زیربغل/پشت", "سرشانهٔ عقب"], secondary: ["جلو بازو", "سینه"], rationale: R.ulPull },
      { title: "پایین‌تنه — هینج‌محور", primary: ["پشت پا", "باسن"], secondary: ["چهارسر", "ساق", "شکم و مرکز"], rationale: R.ulHinge },
    ];
  },
  ok: () => true,
  weight: (c) => 2 + (STRENGTH_GOALS.has(c.goal ?? "") ? 3 : 0) + (FATLOSS_GOALS.has(c.goal ?? "") ? 2 : 0) + (STRENGTH_DISCIPLINES.has(c.discipline ?? "") ? 3 : 0) + (c.recoveryLimited ? 1 : 0),
  periodization: "linear",
};

const pplArch: Archetype = {
  id: "ppl",
  labelFa: "پوش/پول/پا (Push/Pull/Legs)",
  coachFa: "مکتب کلاسیک پرس-کشش-پا (هادی چوپان — حجم و فرکانس)",
  coachKey: "hadi_chupan",
  fst7Capable: true,
  nSet: [3, 4, 5, 6, 7],
  ok: (c) => c.exp !== "beginner", // مبتدی = اسپلیت‌های فرکانس‌بالا (فول‌بادی/UL) — علم یادگیری الگو
  weight: (c) => 2 + (HYPERTROPHY_GOALS.has(c.goal ?? "") ? 2 : 0) + (c.exp === "intermediate" ? 1 : 0) + (c.discipline === "crossfit" ? 1 : 0),
  periodization: "linear",
  build: (n, ctx) => {
    if (n === 3) return [
      { title: "پوش — سینه/سرشانه/پشت‌بازو", primary: ["سینه", "سرشانه"], secondary: ["پشت بازو", "شکم و مرکز"], rationale: R.push },
      { title: "پول — زیربغل/عقب‌سرشانه/جلوبازو", primary: ["زیربغل/پشت"], secondary: ["سرشانهٔ عقب", "جلو بازو"], rationale: R.pull },
      { title: "پا — چهارسر/هینج/ساق", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق", "شکم و مرکز"], rationale: R.legs },
    ];
    if (n === 4) return [
      { title: "پوش", primary: ["سینه", "سرشانه"], secondary: ["پشت بازو", "شکم و مرکز"], rationale: R.push },
      { title: "پول", primary: ["زیربغل/پشت"], secondary: ["سرشانهٔ عقب", "جلو بازو"], rationale: R.pull },
      { title: "پا", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق", "شکم و مرکز"], rationale: R.legs },
      { title: "بالاتنه — سرشانه و بازو", primary: ["سرشانه", "جلو بازو"], secondary: ["پشت بازو", "زیربغل/پشت"], rationale: "جلسهٔ دوم بالاتنه با اولویت سرشانه/بازو — فرکانس ۲ برای نقاط پرتکرار" },
    ];
    if (n === 5) return [
      { title: "پوش", primary: ["سینه", "سرشانه"], secondary: ["پشت بازو", "شکم و مرکز"], rationale: R.push },
      { title: "پول", primary: ["زیربغل/پشت"], secondary: ["سرشانهٔ عقب", "جلو بازو"], rationale: R.pull },
      { title: "پا", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق", "شکم و مرکز"], rationale: R.legs },
      { title: "بالاتنه — سرشانه و بازو", primary: ["سرشانه", "جلو بازو"], secondary: ["پشت بازو", "سینه"], rationale: "سرشانه/بازو با انرژی کامل — فرکانس ۲" },
      { title: "پایین‌تنه دوم + شکم", primary: ["پشت پا", "باسن"], secondary: ["چهارسر", "ساق", "شکم و مرکز"], rationale: "پایین‌تنهٔ دوم با تأکید هینج — فرکانس ۲ پا" },
    ];
    if (n === 6) return [
      { title: "پوش A — سینه‌محور", primary: ["سینه"], secondary: ["سرشانه", "پشت بازو"], rationale: "پوش اول با اولویت سینه (انرژی کامل)" },
      { title: "پول A — زیربغل‌محور", primary: ["زیربغل/پشت"], secondary: ["سرشانهٔ عقب", "جلو بازو"], rationale: "پول اول با اولویت پهنای پشت" },
      { title: "پا A — اسکوات‌محور", primary: ["چهارسر"], secondary: ["پشت پا", "ساق", "شکم و مرکز"], rationale: "پای اول — چهارسر با انرژی کامل" },
      { title: "پوش B — سرشانه‌محور", primary: ["سرشانه"], secondary: ["سینه", "پشت بازو"], rationale: "پوش دوم با اولویت سرشانه — زاویه‌های متفاوت از پوش A" },
      { title: "پول B — ضخامت‌محور", primary: ["زیربغل/پشت"], secondary: ["جلو بازو", "سرشانهٔ عقب"], rationale: "پول دوم با اولویت ضخامت (روئینگ) — زاویه‌های متفاوت" },
      { title: "پا B — هینج‌محور", primary: ["پشت پا", "باسن"], secondary: ["چهارسر", "ساق"], rationale: "پای دوم — زنجیرهٔ خلفی؛ حرکات متفاوت از پا A" },
    ];
    return [
      { title: "پوش A", primary: ["سینه"], secondary: ["سرشانه", "پشت بازو"], rationale: R.push },
      { title: "پول A", primary: ["زیربغل/پشت"], secondary: ["سرشانهٔ عقب", "جلو بازو"], rationale: R.pull },
      { title: "پا A", primary: ["چهارسر"], secondary: ["پشت پا", "ساق", "شکم و مرکز"], rationale: R.legs },
      { title: "پوش B — سرشانه‌محور", primary: ["سرشانه"], secondary: ["سینه", "پشت بازو"], rationale: "پوش دوم — اولویت سرشانه" },
      { title: "پول B — ضخامت‌محور", primary: ["زیربغل/پشت"], secondary: ["جلو بازو", "سرشانهٔ عقب"], rationale: "پول دوم — اولویت ضخامت" },
      { title: "پا B — هینج‌محور", primary: ["پشت پا", "باسن"], secondary: ["چهارسر", "ساق"], rationale: "پای دوم — زنجیرهٔ خلفی" },
      (() => {
        const wpCandidates: BpMuscle[] = ["سینه", "زیربغل/پشت", "سرشانه", "چهارسر"];
        const wpMuscle: BpMuscle | undefined = wpCandidates.find((m) => ctx.weakPoints.some((w) => w.includes(m.split("/")[0])));
        return {
          title: "هوازی/مرکز بدن" + (wpMuscle ? ` + ضعف‌محور (${wpMuscle})` : ""),
          primary: ["هوازی", "شکم و مرکز"] as BpMuscle[],
          secondary: (wpMuscle && wpMuscle !== "شکم و مرکز" ? [wpMuscle] : []) as BpMuscle[],
          rationale: "روز هفتم — کاندیشنینگ + اولویت ضعفِ شناسایی‌شده",
        };
      })(),
    ];
  },
};

const torsoLimbArch: Archetype = {
  id: "torso_limb",
  labelFa: "تنه/اندام (Torso/Limb)",
  coachFa: "مکتب اروپایی حجم بالاتنه (تنه/اندام) — مدیریت خستگی بازو",
  coachKey: "mixed",
  fst7Capable: false,
  nSet: [4],
  build: () => [
    { title: "تنه A — سینه + زیربغل", primary: ["سینه", "زیربغل/پشت"], secondary: ["پشت بازو", "شکم و مرکز"], rationale: R.torso },
    { title: "اندام A — پا + شکم", primary: ["چهارسر", "پشت پا"], secondary: ["ساق", "شکم و مرکز"], rationale: R.limb },
    { title: "تنه B — سرشانه + زیربغل دوم", primary: ["سرشانه", "زیربغل/پشت"], secondary: ["جلو بازو", "سینه"], rationale: R.torso },
    { title: "اندام B — بازو + ساق", primary: ["جلو بازو", "پشت بازو"], secondary: ["ساق", "شکم و مرکز", "چهارسر"], rationale: "اندام دوم — بازو با انرژی کامل + ساق" },
  ],
  ok: () => true,
  weight: (c) => 1.5 + (FATLOSS_GOALS.has(c.goal ?? "") ? 1 : 0),
  periodization: "linear",
};

const phulArch: Archetype = {
  id: "phul",
  labelFa: "PHUL — قدرت+هایپرتروفی بالاتنه/پایین‌تنه",
  coachFa: "مکتب لایمار شیمونز (Power Hypertrophy) — دو روز سنگین، دو روز حجمی",
  coachKey: "ronnie_coleman",
  fst7Capable: false,
  nSet: [4],
  build: () => [
    { title: "بالاتنه قدرتی (۴-۶ تکرار)", primary: ["سینه", "زیربغل/پشت"], secondary: ["سرشانه", "پشت بازو"], rationale: "بالاتنهٔ سنگین — پایهٔ کلمن؛ ۴-۶ تکرار با رشد تهاجمی وزنه" },
    { title: "پایین‌تنه قدرتی (۴-۶ تکرار)", primary: ["چهارسر", "پشت پا"], secondary: ["ساق", "شکم و مرکز"], rationale: "پای سنگین — اسکوات/ددلیفت با رنج قدرت" },
    { title: "بالاتنه حجمی (۸-۱۲ تکرار)", primary: ["سینه", "سرشانه"], secondary: ["زیربغل/پشت", "جلو بازو", "پشت بازو"], rationale: "بالاتنهٔ حجمی — پمپ و تمپو کنترل‌شده (سبک بامستد)" },
    { title: "پایین‌تنه حجمی (۸-۱۵ تکرار)", primary: ["پشت پا", "باسن"], secondary: ["چهارسر", "ساق", "شکم و مرکز"], rationale: "پای حجمی — هینج/ایزوله با فرکانس ۲" },
  ],
  ok: (c) => c.exp !== "beginner",
  weight: (c) => 1.5 + (STRENGTH_GOALS.has(c.goal ?? "") ? 4 : 0) + (STRENGTH_DISCIPLINES.has(c.discipline ?? "") ? 4 : 0) + (HYPERTROPHY_GOALS.has(c.goal ?? "") && c.exp !== "beginner" ? 1.5 : 0),
  periodization: "linear",
  executionNotes: (c) => (STRENGTH_GOALS.has(c.goal ?? "") || STRENGTH_DISCIPLINES.has(c.discipline ?? "") ? ["روزهای قدرتی: حرکات پایه ۴-۶ تکرار با RPE 8-9 و استراحت ۱۸۰-۲۴۰ ثانیه؛ روزهای حجمی ۸-۱۲ تکرار با RPE 7-8."] : []),
};

const arnold4Arch: Archetype = {
  id: "arnold_4",
  labelFa: "اسپلیت آرنولدی ۴ روزه (سینه+جلو بازو / زیربغل+پشت بازو / پا / سرشانه)",
  coachFa: "مکتب آرنولد شوارتزنگر (Golden Era) — روزهای هم‌افزایی آنتاگونیست/هم‌الگو",
  coachKey: "mixed",
  fst7Capable: true,
  nSet: [4],
  build: () => [
    { title: "سینه + جلو بازو", primary: ["سینه"], secondary: ["جلو بازو", "شکم و مرکز"], rationale: R.chestBi },
    { title: "زیربغل + پشت بازو", primary: ["زیربغل/پشت"], secondary: ["پشت بازو", "سرشانهٔ عقب"], rationale: R.backTri },
    { title: "پا + ساق", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق"], rationale: R.legs },
    { title: "سرشانه + شکم", primary: ["سرشانه"], secondary: ["سرشانهٔ عقب", "شکم و مرکز"], rationale: R.deltsAbs },
  ],
  ok: (c) => c.exp === "advanced" || c.exp === "pro" || (c.exp === "intermediate" && HYPERTROPHY_GOALS.has(c.goal ?? "")),
  weight: (c) => 1.2 + (HYPERTROPHY_GOALS.has(c.goal ?? "") ? 2.5 : 0) + (BODYBUILDING_DISCIPLINES.has(c.discipline ?? "") ? 2 : 0),
  periodization: "undulating",
};

const bro5Arch: Archetype = {
  id: "bro5_fst7",
  labelFa: "اسپلیت ۵ روزهٔ عضله‌محور با FST-7 (سینه / زیربغل / پا / سرشانه / بازو)",
  coachFa: "مکتب هانی رامبد (FST-7) — همان ساختار قهرمانان فیزیک؛ هر روز یک عضله با انرژی کامل",
  coachKey: "hany_rambod",
  fst7Capable: true,
  nSet: [5],
  build: (n, ctx) => {
    void n;
    const weak = ctx.weakPoints;
    const wpIsDelts = weak.some((w) => /سرشانه|شانه|دلت/i.test(w));
    const wpIsChest = weak.some((w) => /سینه/i.test(w));
    const wpIsBack = weak.some((w) => /زیربغل|پشت(?! ?بازو)|کول/i.test(w));
    return [
      { title: "سینه" + (wpIsChest ? " — اولویت ضعف" : ""), primary: ["سینه"], secondary: ["پشت بازو", "شکم و مرکز"], rationale: wpIsChest ? "سینه نقطهٔ ضعف آنالیز بدن است — اولین روز هفته با انرژی کامل + فرکانس ۲" : "سینه اول هفته — بیشترین انرژی عصبی برای عضلهٔ پرحجم؛ پشت‌بازو مکمل طبیعی روز پرس" },
      { title: "زیربغل/پشت" + (wpIsBack ? " — اولویت ضعف" : ""), primary: ["زیربغل/پشت"], secondary: ["سرشانهٔ عقب", "جلو بازو"], rationale: wpIsBack ? "پشت نقطهٔ ضعف است — پهنایی+ضخامت در یک جلسهٔ کامل" : "زیربغل با الگوی عمودی+افقی؛ جلوبازو مکمل طبیعی روز کشش" },
      { title: "پا (چهارسر + هینج + ساق)", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق"], rationale: R.legs },
      { title: "سرشانه" + (wpIsDelts ? " — اولویت ضعف" : ""), primary: ["سرشانه"], secondary: ["سرشانهٔ عقب", "شکم و مرکز"], rationale: wpIsDelts ? "سرشانه نقطهٔ ضعف آنالیز — جلسهٔ کامل سه‌دلتی + ترپز" : "سرشانهٔ کامل — V-taper و پهنای خط شانه" },
      { title: "بازو (جلو + پشت) + ساق", primary: ["جلو بازو", "پشت بازو"], secondary: ["ساق", "شکم و مرکز"], rationale: R.arms },
    ];
  },
  ok: (c) => (c.exp === "intermediate" || c.exp === "advanced" || c.exp === "pro") && c.n >= 5,
  weight: (c) => 1.5 + (HYPERTROPHY_GOALS.has(c.goal ?? "") ? 3.5 : 0) + (BODYBUILDING_DISCIPLINES.has(c.discipline ?? "") ? 3 : 0) + (c.recoveryLimited ? -1 : 0),
  periodization: "undulating",
};

const bro6Arch: Archetype = {
  id: "bro6_fst7",
  labelFa: "اسپلیت ۶ روزهٔ عضله‌محور + روز ضعف‌محور (سبک هانی رامبد)",
  coachFa: "مکتب هانی رامبد/کریس بامستد (پریپ ۶ روزهٔ قهرمانان) — ۵ روز عضله‌محور + روز اولویت ضعف",
  coachKey: "chris_bumstead",
  fst7Capable: true,
  nSet: [6],
  build: (n, ctx) => {
    void n;
    const base = bro5Arch.build(5, ctx) ?? [];
    const weak = ctx.weakPoints;
    const wpDay: DaySpec = {
      title: "روز ضعف‌محور — اولویت اول آنالیز بدن",
      primary: weak.some((w) => /سرشانه|شانه/i.test(w)) ? ["سرشانه"] : weak.some((w) => /زیربغل|پشت(?! ?بازو)/i.test(w)) ? ["زیربغل/پشت"] : weak.some((w) => /سینه/i.test(w)) ? ["سینه"] : ["پشت پا", "باسن"],
      secondary: ["شکم و مرکز"],
      rationale: R.weakDay,
    };
    return [...base, wpDay];
  },
  ok: (c) => (c.exp === "advanced" || c.exp === "pro") && !c.recoveryLimited,
  weight: (c) => 1.2 + (HYPERTROPHY_GOALS.has(c.goal ?? "") ? 3 : 0) + (BODYBUILDING_DISCIPLINES.has(c.discipline ?? "") ? 3 : 0),
  periodization: "undulating",
};

const arnold6Arch: Archetype = {
  id: "arnold_6",
  labelFa: "اسپلیت آرنولدی ۶ روزه (سینه+پشت / سرشانه+بازو / پا — دو دور)",
  coachFa: "مکتب آرنولد شوارتزنگر — دو دور از سه روز کلاسیک عصر طلایی (سینه+پشت / سرشانه+بازو / پا)",
  coachKey: "mixed",
  fst7Capable: true,
  nSet: [6],
  build: (n, ctx) => {
    void n;
    void ctx;
    // فرم کلاسیک عصر طلایی: سینه+پشت / سرشانه+بازو / پا ×۲ (دور دوم با زاویهٔ متفاوت)
    return [
      { title: "سینه + پشت (دور اول)", primary: ["سینه", "زیربغل/پشت"], secondary: ["شکم و مرکز"], rationale: "روز کلاسیک آرنولد — سینه و زیربغل در سوپرست آنتاگونیست؛ پمپ خون به کل بالاتنه" },
      { title: "سرشانه + بازو (دور اول)", primary: ["سرشانه", "جلو بازو"], secondary: ["پشت بازو", "سرشانهٔ عقب"], rationale: "سرشانهٔ کامل + بازو — روز وی-تیپر و بازوهای قهرمانی" },
      { title: "پا + ساق (دور اول)", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق"], rationale: R.legs },
      { title: "سینه + پشت (دور دوم — زاویه‌های متفاوت)", primary: ["سینه", "زیربغل/پشت"], secondary: ["شکم و مرکز"], rationale: "دور دوم با زاویه/تجهیزات متفاوت (اصل شوک آرنولد)" },
      { title: "سرشانه + بازو (دور دوم — زاویه‌های متفاوت)", primary: ["سرشانه", "جلو بازو"], secondary: ["پشت بازو", "سرشانهٔ عقب"], rationale: "دور دوم — زاویه‌های متفاوت (اصل شوک آرنولد)" },
      { title: "پا + ساق (دور دوم — زاویه‌های متفاوت)", primary: ["چهارسر", "پشت پا"], secondary: ["باسن", "ساق"], rationale: "دور دوم — زنجیرهٔ خلفی با حرکات متفاوت" },
    ];
  },
  ok: (c) => (c.exp === "advanced" || c.exp === "pro") && !c.recoveryLimited && HYPERTROPHY_GOALS.has(c.goal ?? ""),
  weight: (c) => 1 + (BODYBUILDING_DISCIPLINES.has(c.discipline ?? "") ? 2 : 0),
  periodization: "undulating",
};

/**
 * v230 — اسپلیت باسن‌محور بانوان (تیکت مالک/تینا کاظمی: «من برنامه باسن می‌خوام ولی
 * کلا ۳ تا حرکت باسن داده شده»): دو جلسهٔ پایین‌تنه/باسن + یک جلسه بالاتنه.
 * فقط برای خانم‌های با رشتهٔ باسن‌محور یا فرم بدنِ با تأکید باسن/ران انتخاب می‌شود.
 * هر جلسهٔ باسن ۴-۶ حرکت مستقیم باسن می‌گیرد (هینج سنگین + ایزوله) — نه ۱-۲ حرکت.
 */
const gluteSplitArch: Archetype = {
  id: "glute_focus_split",
  labelFa: "باسن‌محور بانوان (۲ جلسهٔ باسن/پا + ۱ جلسه بالاتنه)",
  coachFa: "مکتب گلوت‌هایپرتروفی مدرن (برِت کانترراس/سل‌است) — فرکانس ۲ برای باسن با حجم مستقیم بالا",
  coachKey: "mixed",
  fst7Capable: false,
  nSet: [3],
  build: (n) => {
    void n;
    return [
      {
        title: "باسن + همسترینگ (هینج‌محور)",
        primary: ["باسن", "پشت پا"],
        secondary: ["شکم و مرکز", "ساق"],
        rationale: "جلسهٔ اول باسن با انرژی کامل — هیپ‌ثراست/ددلیفت رومانیایی سنگین + ایزولهٔ باسن؛ ۴-۶ حرکت مستقیم باسن؛ همسترینگ هم‌الگوی هینج",
      },
      {
        title: "بالاتنه — سینه/زیربغل/سرشانه",
        primary: ["سینه", "زیربغل/پشت"],
        secondary: ["سرشانه", "جلو بازو", "پشت بازو", "شکم و مرکز"],
        rationale: "جلسهٔ بالاتنه متوازن — پرس + کشش + سرشانه؛ تعادل اپر/لوور بدون افت تمرکز باسن",
      },
      {
        title: "باسن + چهارسر (اسکوات‌محور)",
        primary: ["باسن", "چهارسر"],
        secondary: ["ساق", "شکم و مرکز"],
        rationale: "دومین جلسهٔ باسن (فرکانس ۲) — اسکوات/لانژ/بلغاری + ایزولهٔ باسن با زاویه‌های متفاوت از جلسهٔ اول؛ ۴-۶ حرکت مستقیم باسن",
      },
    ];
  },
  ok: (c) =>
    c.gender === "female" &&
    (GLUTE_DISCIPLINES.has(c.discipline ?? "") ||
      c.priorityMuscles.includes("باسن")),
  // v230 — برای خانم باسن‌محور انتخاب قطعی است (نه قرعهٔ وزنی)
  forced: (c) =>
    c.gender === "female" &&
    (GLUTE_DISCIPLINES.has(c.discipline ?? "") ||
      c.priorityMuscles.includes("باسن")),
  weight: (c) =>
    1.5 +
    (GLUTE_DISCIPLINES.has(c.discipline ?? "") ? 8 : 0) +
    (c.priorityMuscles.includes("باسن") ? 6 : 0),
  periodization: "linear",
  executionNotes: (c) =>
    c.priorityMuscles.includes("باسن")
      ? ["باسن اولویت ویژهٔ این کاربر است: در هر جلسهٔ باسن ۴-۶ حرکت مستقیم باسن (۲ الگوی هینج سنگین + ۲-۴ ایزوله) با فرکانس ۲ در هفته تجویز شود — اولویت قبل از هر عضلهٔ دیگر."]
      : [],
};

const ARCHETYPES: Archetype[] = [
  fullBodyArch,
  upperLowerArch,
  pplArch,
  torsoLimbArch,
  phulArch,
  arnold4Arch,
  bro5Arch,
  bro6Arch,
  arnold6Arch,
  gluteSplitArch,
];

// ───────────────────── بودجهٔ ست هفتگی (MEV–MAV علمی) ─────────────────────

const BASE_WEEKLY_SETS: Record<BpMuscle, [number, number]> = {
  "سینه": [10, 16],
  "زیربغل/پشت": [12, 18],
  "سرشانه": [8, 14],
  "سرشانهٔ عقب": [6, 10],
  "جلو بازو": [8, 14],
  "پشت بازو": [8, 14],
  "چهارسر": [8, 14],
  "پشت پا": [6, 12],
  "باسن": [6, 12],
  "ساق": [6, 12],
  "شکم و مرکز": [6, 12],
  "هوازی": [2, 4],
};

function weakPointHit(weakPoints: string[], muscle: BpMuscle): boolean {
  const keys: Record<string, RegExp> = {
    "سینه": /سینه|چست/i,
    "زیربغل/پشت": /زیربغل|پشت(?! ?بازو)|بک|لت|کول/i,
    "سرشانه": /سرشانه|شانه|دلت/i,
    "سرشانهٔ عقب": /سرشانهٔ? عقب|پستور|پشت شانه/i,
    "جلو بازو": /جلو ?بازو|دوسر|بیسپ/i,
    "پشت بازو": /پشت ?بازو|سه‌?سر|تریسپ/i,
    "چهارسر": /چهارسر|ران|کواد/i,
    "پشت پا": /همسترینگ|پشت ?پا/i,
    "باسن": /باسن|سرینی|گلوت|باق/i,
    "ساق": /ساق|کلف/i,
    "شکم و مرکز": /شکم|کور|مرکز|پهلو/i,
    "هوازی": /هوازی|کاردیو/i,
  };
  const re = keys[muscle];
  if (!re) return false;
  return weakPoints.some((w) => re.test(String(w)));
}

function buildWeeklySets(ctx: BlueprintContext, days: DaySpec[]): WeeklySetBudget[] {
  const expFactor = ctx.exp === "beginner" ? 0.7 : ctx.exp === "intermediate" ? 1 : ctx.exp === "advanced" ? 1.1 : 1.15;
  const recoveryFactor = ctx.recoveryLimited ? 0.85 : 1;
  const goalFactor = FATLOSS_GOALS.has(ctx.goal ?? "") ? 0.85 : 1;
  // v230 — عضلات اولویت‌دار (باسن‌محوری بانوان): بودجهٔ علمی بالاتر + فرکانس ۲ تضمینی
  const prioritySet = new Set<BpMuscle>(ctx.priorityMuscles ?? []);

  // عضلاتِ موجود در معماری — بقیه فقط با هم‌پوشانی کار می‌گیرند
  const planned = new Set<BpMuscle>();
  for (const d of days) for (const m of [...d.primary, ...d.secondary]) if (m !== "هوازی") planned.add(m);
  // عضلهٔ اولویت‌دار همیشه «برنامه‌ریزی‌شده» است (معمار آن را لنگر می‌اندازد)
  for (const m of prioritySet) planned.add(m);

  const out: WeeklySetBudget[] = [];
  for (const m of BP_MUSCLES) {
    if (m === "هوازی") continue;
    const [lo, hi] = BASE_WEEKLY_SETS[m];
    if (!planned.has(m)) continue; // عضلهٔ خارج معماری — صفر ست مستقیم (هم‌پوشانی)
    const isWeak = weakPointHit(ctx.weakPoints, m);
    const isPriority = prioritySet.has(m);
    const f = expFactor * recoveryFactor * goalFactor * (isWeak || isPriority ? (isPriority ? 1.3 : 1.2) : 1);
    const scheduledDays = days.filter((d) => d.primary.includes(m) || d.secondary.includes(m)).length;
    // v213 — سقف علمی جلسه‌ای (~۸ ست مؤثر) بودجهٔ هفتگی را قید می‌کند:
    // عضله‌ای که فقط در یک جلسه کار مستقیم دارد، سقف هفته‌ای‌اش ۹ ست است؛
    // بقیهٔ حجم باید با فرکانس ۲ بین جلسات پخش شود (که معماری انجام داده است).
    const capMax = scheduledDays >= 2 || isPriority ? 20 : 9;
    let min = Math.max(4, Math.round(lo * f));
    let max = Math.min(Math.max(min + 2, Math.round(hi * f)), capMax);
    if (max <= min) min = Math.max(3, max - 2);
    const freq = isWeak || isPriority ? Math.max(2, scheduledDays) : Math.max(1, scheduledDays);
    out.push({ muscle: m, min, max, frequency: freq, priority: isWeak || isPriority });
  }
  return out;
}

/**
 * v213 — تزریق فرکانس ۲ برای نقاط ضعف (تضمین قطعی دیرکتیو مالک:
 * «عضلهٔ ضعیف کاربر فدای عضلهٔ قوی‌تر نمی‌شود»): هر عضلهٔ ضعیفِ آنالیز بدن
 * که در معماری کمتر از ۲ روز کار مستقیم دارد، به بهترین روز مرتبط ارتقا/اضافه
 * می‌شود (پرایمری → اولِ جلسه). حداکثر ۳ روز دست‌خورده می‌شود.
 */
function injectWeakPointFrequency(ctx: BlueprintContext, days: DaySpec[]): Array<{ muscle: BpMuscle; action: string; day: string }> {
  const actions: Array<{ muscle: BpMuscle; action: string; day: string }> = [];
  // v230 — عضلات اولویت‌دار (باسن‌محوری) هم‌مانند نقاط ضعف تضمین فرکانس ۲ می‌گیرند
  const prioritySet = new Set<BpMuscle>(ctx.priorityMuscles ?? []);
  const weakMuscles = BP_MUSCLES.filter((m) => m !== "هوازی" && (prioritySet.has(m) || weakPointHit(ctx.weakPoints, m)));
  for (const wm of weakMuscles) {
    const isPriorityOnly = prioritySet.has(wm) && !weakPointHit(ctx.weakPoints, wm);
    const anchorLabel = isPriorityOnly ? "اولویت ویژه" : "اولویت ضعف";
    const scheduled = days.filter((d) => d.primary.includes(wm) || d.secondary.includes(wm));
    if (scheduled.length >= 2) {
      // فرکانس ۲ هست — فقط مطمئن شو پرایمریِ حداقل یک روز است
      if (!days.some((d) => d.primary.includes(wm))) {
        const host = scheduled[0];
        host.primary = [...host.primary, wm];
        host.secondary = host.secondary.filter((m) => m !== wm);
        host.title += ` — ${anchorLabel} (${wm})`;
        actions.push({ muscle: wm, action: "promoted-to-primary", day: host.title });
      }
      continue;
    }
    if (scheduled.length === 1) {
      // یک جلسه دارد — دومین جلسه: بهترین روزِ مرتبط (هم‌گروه) که عضله را ندارد
      const group = bpMuscleToGroup(wm);
      const host =
        days.find((d) => !d.primary.includes(wm) && !d.secondary.includes(wm) && d.primary.some((m) => bpMuscleToGroup(m) === group)) ??
        days.find((d) => !d.primary.includes(wm) && !d.secondary.includes(wm) && d.secondary.some((m) => bpMuscleToGroup(m) === group)) ??
        days.find((d) => !d.primary.includes(wm) && !d.secondary.includes(wm));
      if (host) {
        host.secondary = [...host.secondary, wm];
        actions.push({ muscle: wm, action: "second-session-added", day: host.title });
      }
      continue;
    }
    // صفر جلسه — باید به‌عنوان پرایمری در بهترین روز هم‌گروه بنشیند
    const group = bpMuscleToGroup(wm);
    const host =
      days.find((d) => d.primary.some((m) => bpMuscleToGroup(m) === group)) ??
      days.find((d) => d.primary.length <= 2) ??
      days[0];
    if (host) {
      host.primary = [...host.primary, wm];
      host.title += ` — ${anchorLabel} (${wm})`;
      host.rationale += ` | ${wm} ${isPriorityOnly ? "اولویت ویژهٔ این کاربر است" : "نقطهٔ ضعف آنالیز بدن است"} — مستقیماً در این روز لنگر انداخت.`;
      actions.push({ muscle: wm, action: "anchored-as-primary", day: host.title });
    }
  }
  return actions.slice(0, 3);
}

// ───────────────────────── ساخت Blueprint ─────────────────────────

/**
 * ساخت معماری برنامهٔ هفتگی برای «همین کاربر» — قطعی، شخصی‌سازی‌شده، نخبهمحور.
 * هرگز throw نمی‌کند؛ فال‌بک امن: full-body/upper-lower.
 */
export function buildCoachBlueprint(input: CoachBlueprintInput): CoachBlueprint {
  try {
    const n = Math.max(1, Math.min(7, Math.round(Number(input.workoutDays) || 3)));
    const exp = expLevel(input.trainingExperience);
    const sleepLow = typeof input.sleepHours === "number" && input.sleepHours < 6.5;
    const stressHigh = typeof input.stressLevel === "number" && input.stressLevel >= 4;
    const ageHigh = typeof input.age === "number" && input.age >= 50;
    const smoker = !!input.smokingHabit && input.smokingHabit !== "none" && input.smokingHabit !== "prefer_not";
    const medicalHeavy = (input.medicalConditions?.length ?? 0) >= 2;
    const recoveryLimited = sleepLow || stressHigh || ageHigh || smoker || medicalHeavy;
    const weakPoints = (input.weakPoints ?? []).map((w) => String(w)).filter(Boolean);
    const homeGym = input.workoutPlace === "home";
    const rationale: string[] = [];

    // ─── v230 — عضلات اولویت‌دار از آنبوردینگ فعلی کاربر (دیرکتیو مالک: «طراحی برنامه
    // همیشه از آنبوردینگ فعلی تغذیه شود») ───
    // منبع ۱: فرم بدن با تأکید باسن/ران (مثلث معکوس/مستطیل) برای خانم‌ها
    // منبع ۲: رشتهٔ باسن‌محور (womens_fitness/wellness/bikini_fitness/womens_physique)
    // منبع ۳: شرایط خاص کاربر اگر صریحاً باسن خواسته باشد
    const priorityMuscles: BpMuscle[] = [];
    const focusText = String(input.bodyShapeFocus ?? "");
    const specialText = String(input.specialConditions ?? "");
    const gluteWishRe = /باسن|سرینی|گلوت|باق|ران/i;
    const isFemale = input.gender === "female";
    const gluteDiscipline = GLUTE_DISCIPLINES.has(input.discipline ?? "");
    if (isFemale && (gluteDiscipline || gluteWishRe.test(focusText) || gluteWishRe.test(specialText))) {
      priorityMuscles.push("باسن");
      rationale.push("اولویت ویژه از آنبوردینگ: باسن (رشتهٔ/فرم بدن/درخواست کاربر) → فرکانس ۲ + بودجهٔ ست بالاتر + ۴-۶ حرکت مستقیم در هر جلسهٔ باسن");
    }

    const ctx: BlueprintContext = { n, exp, goal: input.goal, discipline: input.discipline, gender: input.gender, recoveryLimited, weakPoints, priorityMuscles, homeGym, rationale };

    if (recoveryLimited) rationale.push("ظرفیت ریکاوری محدود (خواب/استرس/سن/دخانیات/شرایط پزشکی) → حجم معقول و مدیریت خستگی در اولویت");
    if (exp === "beginner") rationale.push("سابقهٔ مبتدی → اسپلیت‌های فرکانس‌بالا و یادگیری الگو (بدن کامل/بالاتنه-پایین‌تنه) — اسپلیت عضله‌محور برای مبتدی علمی نیست");
    if (HYPERTROPHY_GOALS.has(input.goal ?? "")) rationale.push("هدف هایپرتروفی → بودجهٔ ست در ناحیهٔ MAV و اولویت اسپلیت‌های عضله‌محور در سابقه‌داران");
    if (FATLOSS_GOALS.has(input.goal ?? "")) rationale.push("هدف چربی‌سوزی → حفظ تودهٔ عضلانی با مقاومتی + کاندیشنینگ هدفمند");
    if (STRENGTH_GOALS.has(input.goal ?? "")) rationale.push("هدف قدرت → رنج ۴-۶ تکرار در پایه‌ها + دوره‌بندی قدرت");
    if (weakPoints.length) rationale.push(`نقاط ضعف آنالیز بدن (${weakPoints.slice(0, 3).join("؛ ")}) → فرکانس ۲ + اول جلسه + حجم بالاتر`);

    const candidates = ARCHETYPES.filter((a) => a.nSet.includes(n) && a.ok(ctx));
    const items = candidates.map((a) => ({ item: a, w: a.weight(ctx) }));
    const seedSource = [
      input.gender, input.age, input.goal, input.trainingExperience, input.discipline,
      input.bodyShape, input.workoutDays, (input.workoutDaysList ?? []).join("-"),
      input.weakPoints?.join("|"), input.specialConditions, input.seed ?? Date.now(),
    ].map((x) => String(x ?? "")).join("|");
    const rnd = mulberry32(hashSeed(seedSource));
    // v230 — اسپلیتِ «الزامی رشته» (باسن‌محوری بانوان) قبل از قرعهٔ وزنی
    const forcedArch = candidates.find((a) => a.forced?.(ctx));
    const chosen = forcedArch ?? (weightedPick(items, rnd) ?? upperLowerArch);

    const daySpecs = chosen.build(n, ctx);
    if (!daySpecs || daySpecs.length !== n) {
      // فال‌بک امن
      return fallbackBlueprint(input, n, rationale);
    }

    // v213 — پاکسازی ثانویه: عضلهٔ تکراری در primary/secondary یک روز + نشت بین روزها
    for (const d of daySpecs) {
      d.secondary = d.secondary.filter((m) => !d.primary.includes(m));
    }
    // v213 — تزریق فرکانس ۲ نقاط ضعف (تضمین دیرکتیو مالک) — قبل از بودجهٔ ست
    const weakActions = injectWeakPointFrequency(ctx, daySpecs);
    if (weakActions.length > 0) {
      rationale.push(`تضمین فرکانس ۲ نقاط ضعف: ${weakActions.map((a) => `${a.muscle} (${a.action})`).join("؛ ")}`);
    }

    // 🩹 v230 — روزهای انتخابی کاربر همیشه در ترتیب استاندارد هفتهٔ فارسی به
    // معماری/پرامپت می‌روند (قبلاً ترتیب خام انتخاب کاربر می‌آمد — مثلاً لیست
    // [یکشنبه، سه‌شنبه، شنبه...] → روزِ «یکشنبه» اولِ لیست معماری می‌شد ولی
    // مدلِ مجری خروجی را از شنبه می‌ساخت → چرخش عنوان/حرکات بین روزها — باگ
    // «روز پا ولی کامل سینه» برای یاشار ستاری از همین‌جا بود).
    const chosenRawDays = (input.workoutDaysList && input.workoutDaysList.length >= n
      ? input.workoutDaysList.slice(0, n)
      : PERSIAN_WEEKDAYS.slice(0, n)
    );
    const chosenDays = sortWeekdaysByPersianOrder(chosenRawDays.map((day) => ({ day }))).map((x) => x.day);

    const days: BlueprintDay[] = daySpecs.map((spec, i) => ({
      day: chosenDays[i] ?? PERSIAN_WEEKDAYS[i] ?? `روز ${i + 1}`,
      title: spec.title,
      primary: spec.primary,
      secondary: spec.secondary,
      rationale: spec.rationale,
    }));

    const weeklySets = buildWeeklySets(ctx, daySpecs);

    // FST-7 — هانی رامبد: فقط هایپرتروفی + سابقهٔ بالا + اسپلیتِ توانمند
    let fst7: CoachBlueprint["fst7"];
    if (chosen.fst7Capable && (exp === "advanced" || exp === "pro") && HYPERTROPHY_GOALS.has(input.goal ?? "") && n >= 4) {
      const idx = days.findIndex((d) => d.primary.includes("سینه") || d.primary.includes("زیربغل/پشت") || d.primary.includes("سرشانه"));
      if (idx >= 0) {
        const muscle = days[idx].primary[0];
        fst7 = {
          dayIndex: idx,
          muscle,
          note: `روز «${days[idx].day}» — حرکت آخرِ ${muscle} به سبک FST-7: ۷ ست × ۸-۱۲ تکرار با استراحت ۳۰-۴۵ ثانیه (پمپ حداکثری و کشش فاسیا — هانی رامبد).`,
        };
      }
    }

    const executionNotes = [
      "در هر جلسه، حرکات عضلات «اصلی» اولِ روز می‌آیند (انرژی عصبی کامل) و مکمل‌های «ثانویه» انتهای جلسه.",
      "حداکثر ~۸ ست سنگین برای هر عضله در «یک» جلسه — اگر بودجهٔ هفتگی عضله بیشتر است، بین جلسات پخش می‌شود (بازده ست نهم به بعد در همان جلسه افت شدید دارد).",
      "هیچ حرکتی از عضله‌ای که در معماریِ این روز نیست تجویز نمی‌شود (به‌جز شکم/هوازی اگر در معماری روز آمده) — معماری حرف آخر را می‌زند.",
      ...((chosen.executionNotes?.(ctx)) ?? []),
    ];
    if (recoveryLimited) {
      executionNotes.push("ریکاوری محدود: RPE 7-8 سقف معمول؛ هفتهٔ ۵ برنامه deload سبک (۲۰٪ کاهش حجم).");
    }
    if (FATLOSS_GOALS.has(input.goal ?? "")) {
      executionNotes.push("چربی‌سوزی: هوازی هدفمند (LISS ۲-۳×۲۵-۴۰ دقیقه یا ۱-۲ HIIT) در روزهای بدون پا یا بعد از قدرتی — در فیلد notes هم ذکر شود.");
    }
    if (homeGym) {
      executionNotes.push("تمرین خانگی: الگوی هر حرکت حفظ شود؛ جایگزین وزنه‌ای با کش/وزن بدن/دمبل موجود در substitution بنویس.");
    }

    const splitLabel = chosen.labelFa;
    const coachModelFa = chosen.coachFa;

    rationale.push(`اسپلیت انتخابی از میان گزینه‌های معتبرِ ${n} روزه برای این پروفایل: «${splitLabel}» — انتخاب وزنی بر اساس هدف/سابقه/رشته/ریکاوری (هر کاربر از میان گزینه‌های درستِ خودش، معماری مخصوص خودش را می‌گیرد)`);

    return {
      splitId: chosen.id,
      splitLabelFa: splitLabel,
      coachModelFa,
      coachKey: chosen.coachKey,
      days,
      weeklySets,
      fst7,
      periodizationHint: chosen.periodization,
      executionNotes,
      rationaleLines: rationale,
    };
  } catch {
    return fallbackBlueprint(input, Math.max(1, Math.min(7, Math.round(Number(input.workoutDays) || 3))), []);
  }
}

/** فال‌بک امن — بدن کامل/UL (هرگز نباید شکست بخورد) */
function fallbackBlueprint(input: CoachBlueprintInput, n: number, rationale: string[]): CoachBlueprint {
  const arch = n <= 3 ? fullBodyArch : upperLowerArch;
  const specs = (arch.build(Math.min(n, arch.nSet[arch.nSet.length - 1]), {
    n, exp: expLevel(input.trainingExperience), goal: input.goal, discipline: input.discipline,
    gender: input.gender, recoveryLimited: false, weakPoints: [], priorityMuscles: [], homeGym: false, rationale,
  }) ?? upperLowerArch.build(2, { n: 2, exp: "beginner", goal: undefined, discipline: undefined, gender: input.gender, recoveryLimited: false, weakPoints: [], priorityMuscles: [], homeGym: false, rationale })) as DaySpec[];
  const safeSpecs: DaySpec[] = [];
  for (let i = 0; i < n; i++) {
    safeSpecs.push(specs[i % specs.length]);
  }
  const chosenRawDays = (input.workoutDaysList && input.workoutDaysList.length >= n ? input.workoutDaysList.slice(0, n) : PERSIAN_WEEKDAYS.slice(0, n));
  // v230 — فال‌بک هم با ترتیب استاندارد هفتهٔ فارسی (هم‌راستا با مسیر اصلی)
  const chosenDays = sortWeekdaysByPersianOrder(chosenRawDays.map((day) => ({ day }))).map((x) => x.day);
  return {
    splitId: `${arch.id}_fallback`,
    splitLabelFa: `${arch.labelFa} (فال‌بک امن)`,
    coachModelFa: arch.coachFa,
    coachKey: arch.coachKey,
    days: safeSpecs.map((s, i) => ({
      day: chosenDays[i] ?? PERSIAN_WEEKDAYS[i] ?? `روز ${i + 1}`,
      title: s.title,
      primary: s.primary,
      secondary: s.secondary,
      rationale: s.rationale,
    })),
    weeklySets: buildWeeklySets({ n, exp: expLevel(input.trainingExperience), goal: input.goal, discipline: input.discipline, gender: input.gender, recoveryLimited: false, weakPoints: input.weakPoints ?? [], priorityMuscles: [], homeGym: false, rationale }, safeSpecs),
    periodizationHint: "linear",
    executionNotes: [],
    rationaleLines: rationale,
  };
}

// ───────────────────── بلوک دیرکتیو پرامپت (فارسی) ─────────────────────

const MUSCLE_FA_LABEL: Record<BpMuscle, string> = {
  "سینه": "سینه",
  "زیربغل/پشت": "زیربغل/پشت",
  "سرشانه": "سرشانه",
  "سرشانهٔ عقب": "سرشانهٔ عقب",
  "جلو بازو": "جلو بازو",
  "پشت بازو": "پشت بازو",
  "چهارسر": "چهارسر (جلو ران)",
  "پشت پا": "پشت پا (همسترینگ)",
  "باسن": "باسن",
  "ساق": "ساق",
  "شکم و مرکز": "شکم و مرکز بدن",
  "هوازی": "هوازی/کاندیشنینگ",
};

/**
 * بلوک دیرکتیو «معمار برنامه» — جایگزین منوی ثابت اسپلیت در پرامپت تمرین.
 * لحن: دستور قطعی معمار به مربیِ مجری (LLM) — نقض بند معماری یعنی ردِ برنامه.
 */
export function buildBlueprintDirectiveFa(bp: CoachBlueprint): string {
  const lines: string[] = [];
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("🏛️ معماری برنامه — تصمیم قطعی «معمار برنامهٔ فیتاپ» (پیش از تولید، از پروفایل همین کاربر ساخته شده)");
  lines.push(`اسپلیت انتخابی برای این کاربر: «${bp.splitLabelFa}»`);
  lines.push(`مکتب مربی: ${bp.coachModelFa}`);
  lines.push("");
  lines.push("چیدمان الزامی روزها (عضلهٔ اصلی ← اول جلسه؛ مکمل ← انتهای جلسه):");
  bp.days.forEach((d, i) => {
    const main = d.primary.map((m) => MUSCLE_FA_LABEL[m]).join(" + ");
    const sec = d.secondary.length ? d.secondary.map((m) => MUSCLE_FA_LABEL[m]).join(" + ") : null;
    lines.push(`  ${i + 1}) روز ${d.day} — «${d.title}»: اصلی: ${main}${sec ? ` | مکمل: ${sec}` : ""}`);
  });
  lines.push("");
  lines.push("منطق هر روز (در نکات مربی هم به این منطق ارجاع بده):");
  bp.days.forEach((d, i) => {
    lines.push(`  • روز ${d.day}: ${d.rationale}`);
  });
  lines.push("");
  lines.push("بودجهٔ ست هفتگی (ست‌های سنگین مستقیم — بازهٔ علمی MEV-MAV برای همین کاربر):");
  for (const w of bp.weeklySets) {
    lines.push(`  • ${MUSCLE_FA_LABEL[w.muscle]}: ${w.min}-${w.max} ست در هفته${w.priority ? " 🔴 اولویت (نقطهٔ ضعف) — اول جلسه + فرکانس ۲" : ""}${w.frequency > 1 ? ` — فرکانس ${w.frequency}× در هفته` : ""}`);
  }
  lines.push("");
  if (bp.fst7) {
    lines.push(`🔥 FST-7 (هانی رامبد): ${bp.fst7.note} — فیلد fst7Details را با همین حرکت پر کن.`);
    lines.push("");
  }
  lines.push("قواعد اجرای معماری (قطعی):");
  lines.push("  ۱) focus و title هر روز دقیقاً همان عضلات معماری باشد؛ عضلهٔ اصلی همیشه اولِ جلسه.");
  for (const note of bp.executionNotes) lines.push(`  ۲) ${note}`);
  lines.push("  ⚡ روزهای هم‌نقش (مثل پوش A/B): حرکات و زاویه‌ها باید متفاوت باشند — همان حرکت با همان زاویه مطلقاً تکرار نمی‌شود.");
  lines.push("  ⚡ توضیح علمی معماری را در فیلد muscleGroupSplit بنویس: «" + bp.splitLabelFa + "» و در notes یک خط «- 📊 تحلیل معماری: ...» با منطق انتخاب برای این کاربر.");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

// ───────────── پس‌پردازش قطعی: اجرای انضباط معماری روی خروجی مدل ─────────────

/** نرمال‌سازی نام روز هفته (نیم‌فاصله/فاصله) برای تطبیق نام‌محور */
function normDayName(d: unknown): string {
  return String(d ?? "").replace(/[\s\u200C]+/g, "");
}

/**
 * v230 — تطبیق روزِ برنامه با روزِ معماری «با نامِ هفته‌روز» (نه اندیس آرایه).
 * باگ ریشه‌ای یاشار ستاری: معماری روزها را با ترتیب خامِ انتخاب کاربر لیست می‌کرد
 * (یکشنبه اول) ولی مدلِ مجری خروجی را از شنبه می‌ساخت؛ پلیس معماری هم اندیسی
 * تطبیق می‌داد → روزِ «پا» با حرکاتِ روز سینه ممیزی و تأیید می‌شد! حالا نامِ روز
 * ملاک است و فقط در نبودِ تطبیق نامی به اندیس برمی‌گردیم (فال‌بک امن).
 */
export function matchBlueprintDayIndex(bp: CoachBlueprint, planDayName: string, fallbackIdx: number): number {
  const target = normDayName(planDayName);
  if (target) {
    const byName = bp.days.findIndex((d) => normDayName(d.day) === target);
    if (byName >= 0) return byName;
  }
  return fallbackIdx;
}

/**
 * enforceBlueprintDayIdentity — پلیس معماری (قطعی، بدون ردِ برنامه):
 * ① هر حرکتی که عضله‌اش خارجِ مجوزِ روزِ معماری باشد → با حرکتِ هم‌الگو از
 *    عضلاتِ مجازِ همان روز تعویض می‌شود (ست/تکرار/RPE حفظ می‌شود) — ریشه‌کنی
 *    «بارفیکس در روز پوش» و «جلوبازو چسبیده به روز سینه».
 * ② عضلهٔ اصلیِ هر روز حداقل ۲ حرکت مستقیم می‌گیرد؛ کمتر بود از عضلات مجاز پر می‌شود.
 * ③ خروجی گزارش می‌دهد تا در لاگ/گیت دیده شود. هرگز throw نمی‌کند.
 */
export function enforceBlueprintDayIdentity(
  parsed: { days?: Array<Record<string, any>>; [k: string]: any },
  bp: CoachBlueprint | null | undefined,
  bank: { all: Array<{ id: string; name: string; muscle?: string | null; category?: string | null; description?: string | null; tips?: string | null }> } | null | undefined,
  forbiddenKeywords?: string[]
): { replaced: Array<{ day: string; from: string; to: string }>; report: string } {
  const report = { replaced: [] as Array<{ day: string; from: string; to: string }>, report: "" };
  if (!bp || !Array.isArray(parsed?.days) || !bank || !Array.isArray(bank.all) || bank.all.length === 0) return report;

  const banned = (name: string) =>
    forbiddenKeywords && forbiddenKeywords.length > 0
      ? forbiddenKeywords.some((k) => k && String(name).includes(k))
      : false;

  parsed.days.forEach((day, dayIdx) => {
    if (!day || !Array.isArray(day.exercises)) return;
    // v230 — تطبیق نام‌محور با معماری (اندیس فقط فال‌بک)
    const bpIdx = matchBlueprintDayIndex(bp, String(day.day ?? ""), dayIdx);
    const allowed = blueprintDayAllowedGroups(bp, bpIdx);
    const primary = blueprintDayPrimaryGroups(bp, bpIdx);
    if (allowed.size === 0) return;
    const dayName = String(day.day ?? `روز ${dayIdx + 1}`);

    const usedFamilies = new Set<string>();
    for (const ex of day.exercises) {
      // exerciseFamilyKey از بانک نمی‌آید (چرخهٔ ایمپورت) — نرمال‌سازی سادهٔ نام
      usedFamilies.add(String(ex?.name ?? "").replace(/[\s\u200C\-()（）]+/g, "").slice(0, 14));
    }

    // ① تعویض حرکات خارج از مجوز روز
    for (const ex of day.exercises) {
      if (!ex || !ex.name) continue;
      const groups = majorGroupsOfExercise(ex as any);
      const isFullbody = groups.size >= 5;
      const violation = !isFullbody && ![...groups].some((g) => allowed.has(g));
      if (!violation) continue;
      // جایگزین: حرکتِ عضلاتِ مجاز، اولویت عضلهٔ اصلی، ترجیح هم‌کته‌گوری
      const exCat = String(ex.category ?? "");
      const pool = bank.all.filter((r) => {
        if (!r?.name || banned(r.name)) return false;
        if (day.exercises.some((e: any) => e?.exerciseId === r.id || String(e?.name ?? "") === String(r.name))) return false;
        const g = majorGroupsOfExercise(r as any);
        if (g.size >= 5) return false; // فول‌بادیِ جایگزین نمی‌گذاریم
        if (![...g].some((x) => allowed.has(x))) return false;
        const fam = String(r.name).replace(/[\s\u200C\-()（）]+/g, "").slice(0, 14);
        if (usedFamilies.has(fam)) return false;
        return true;
      });
      if (pool.length === 0) continue;
      const preferred =
        pool.find((r) => {
          const g = majorGroupsOfExercise(r as any);
          return [...g].some((x) => primary.has(x)) && String(r.category ?? "") === exCat;
        }) ??
        pool.find((r) => {
          const g = majorGroupsOfExercise(r as any);
          return [...g].some((x) => primary.has(x));
        }) ??
        pool.find((r) => String(r.category ?? "") === exCat) ??
        pool[0];
      const from = String(ex.name);
      report.replaced.push({ day: dayName, from, to: String(preferred.name) });
      usedFamilies.add(String(preferred.name).replace(/[\s\u200C\-()（）]+/g, "").slice(0, 14));
      ex.name = preferred.name;
      ex.muscle = preferred.muscle ?? ex.muscle;
      ex.category = preferred.category ?? ex.category;
      if (preferred.description) ex.description = preferred.description;
      if (preferred.tips) ex.tips = preferred.tips;
      ex.exerciseId = preferred.id;
      ex.coachTip = ex.coachTip || "انقباض کامل و دامنهٔ حرکتی کامل — کیفیت اجرا مهم‌تر از وزنه.";
      ex.substitution = ex.substitution || "نسخهٔ سبک‌تر با همان عضله در صورت خستگی.";
    }

    // ② تضمین ≥۲ حرکت از عضلهٔ اصلی روز
    const primaryCount = day.exercises.filter((ex: any) => {
      if (!ex?.name) return false;
      const g = majorGroupsOfExercise(ex as any);
      return [...g].some((x) => primary.has(x));
    }).length;
    if (primaryCount < 2) {
      const pool = bank.all.filter((r) => {
        if (!r?.name || banned(r.name)) return false;
        if (day.exercises.some((e: any) => e?.exerciseId === r.id || String(e?.name ?? "") === String(r.name))) return false;
        const g = majorGroupsOfExercise(r as any);
        if (![...g].some((x) => primary.has(x))) return false;
        const fam = String(r.name).replace(/[\s\u200C\-()（）]+/g, "").slice(0, 14);
        return !usedFamilies.has(fam);
      });
      for (let k = 0; k < Math.min(2 - primaryCount, pool.length); k++) {
        const r = pool[k];
        day.exercises.push({
          name: r.name,
          muscle: r.muscle ?? undefined,
          category: r.category ?? undefined,
          description: r.description || "حرکت را با کنترل کامل و دامنهٔ حرکتی کامل اجرا کن.",
          tips: r.tips || "فرم صحیح و تنفس منظم را حفظ کن.",
          coachTip: "عضلهٔ اصلی روز — انقباض کامل و کنترل فاز منفی.",
          difficulty: "intermediate",
          rpe: 7,
          tempo: "2-0-2-0",
          substitution: "نسخهٔ سبک‌تر با همان عضله در صورت خستگی.",
          sets: Array.from({ length: 3 }, (_, i2) => ({ setNumber: i2 + 1, reps: "8-12", restSec: 90, rpe: 7 })),
          exerciseId: r.id,
        });
        usedFamilies.add(String(r.name).replace(/[\s\u200C\-()（）]+/g, "").slice(0, 14));
        report.replaced.push({ day: dayName, from: "(کمبود عضلهٔ اصلی)", to: String(r.name) });
      }
    }
  });

  if (report.replaced.length > 0) {
    report.report = report.replaced.map((r) => `[${r.day}] "${r.from}"→"${r.to}"`).join(", ");
  }
  return report;
}

/**
 * v230 — پلیس عنوان/تمرکز روز: بعد از همهٔ ترمیم‌ها، عنوان و focus هر روز باید
 * با معماریِ همان هفته‌روز بخواند (تیکت مالک: «روز اول نوشته روز پا ولی کامل
 * سینه داده شده»). بازنویسی فقط وقتی انجام می‌شود که عنوانِ مدل با عضلاتِ
 * مجازِ معماریِ همان روز «تناقض» داشته باشد (عضله‌ای در عنوان است که در
 * معماریِ روز نیست) — برنامهٔ سالم دست نمی‌خورد.
 */
export function enforceBlueprintDayTitles(
  parsed: { days?: Array<Record<string, any>>; [k: string]: any },
  bp: CoachBlueprint | null | undefined
): Array<{ day: string; from: string; to: string }> {
  const rewrites: Array<{ day: string; from: string; to: string }> = [];
  if (!bp || !Array.isArray(parsed?.days)) return rewrites;
  // واژگان عنوان → عضلهٔ معماری (برای تشخیص تناقض)
  const TITLE_WORDS: Array<{ re: RegExp; groups: MajorGroupKey[] }> = [
    { re: /سینه/i, groups: ["chest"] },
    { re: /زیربغل|پشت(?! ?بازو)|کول|لت/i, groups: ["back"] },
    { re: /سرشانه|شانه(?! ?ها)|دلت/i, groups: ["shoulders"] },
    { re: /جلوبازو|جلو بازو|بایسپ/i, groups: ["arms"] },
    { re: /پشت‌?بازو|تریسپ/i, groups: ["arms"] },
    { re: /بازو(?!‌?ها)/i, groups: ["arms"] },
    { re: /باسن|سرینی|گلوت|هینج/i, groups: ["legs"] },
    { re: /چهارسر|پا(?! ?روش)|پایین‌?تنه|اسکوات|همسترینگ|پشت ?پا|ساق/i, groups: ["legs"] },
    { re: /شکم|مرکز|کور/i, groups: ["core"] },
    { re: /بالاتنه|پوش|فشار/i, groups: ["chest", "shoulders", "arms", "back"] },
    { re: /کشش|پول/i, groups: ["back", "shoulders", "arms"] },
    { re: /بدن.?کامل|فول.?بادی/i, groups: ["chest", "back", "shoulders", "legs", "arms", "core"] },
  ];
  for (const [dayIdx, day] of (parsed.days ?? []).entries()) {
    if (!day || !Array.isArray(day.exercises)) continue;
    const bpIdx = matchBlueprintDayIndex(bp, String(day.day ?? ""), dayIdx);
    const bpDay = bp.days[bpIdx];
    if (!bpDay) continue;
    const allowed = blueprintDayAllowedGroups(bp, bpIdx);
    if (allowed.size === 0) continue;
    const title = String(day.title ?? "");
    if (!title) continue;
    const titleGroups = new Set<MajorGroupKey>();
    for (const w of TITLE_WORDS) if (w.re.test(title)) for (const g of w.groups) titleGroups.add(g);
    if (titleGroups.size === 0) continue; // عنوان بدون واژهٔ عضلانی — دست نمی‌خوریم
    const contradicts = [...titleGroups].every((g) => !allowed.has(g));
    if (!contradicts) continue;
    // تناقض قطعی — بازنویسی عنوان/تمرکز از معماری همان روز
    const main = bpDay.primary.map((m) => MUSCLE_FA_LABEL[m]).join(" + ");
    const sec = bpDay.secondary.length ? bpDay.secondary.map((m) => MUSCLE_FA_LABEL[m]).join(" + ") : null;
    const newTitle = bpDay.title.includes(main) || bpDay.title.includes("بالاتنه") || bpDay.title.includes("بدن کامل")
      ? bpDay.title
      : `${bpDay.title} (${main})`;
    const newFocus = `تمرکز اصلی: ${main}${sec ? ` | مکمل: ${sec}` : ""} — چیدمان معماری برنامهٔ فیتاپ برای همین کاربر`;
    rewrites.push({ day: String(day.day ?? ""), from: title, to: newTitle });
    day.title = newTitle;
    day.focus = newFocus;
  }
  return rewrites;
}

/**
 * خلاصهٔ blueprint برای ذخیره روی خود برنامه (coachBlueprint) — خوانا برای
 * گیت کیفیت/ادمین/نمایش «معمار برنامه» در UI آینده.
 */
export function blueprintSnapshotForPlan(bp: CoachBlueprint): Record<string, unknown> {
  return {
    splitId: bp.splitId,
    splitLabelFa: bp.splitLabelFa,
    coachModelFa: bp.coachModelFa,
    coachKey: bp.coachKey,
    periodizationHint: bp.periodizationHint,
    days: bp.days.map((d) => ({ day: d.day, title: d.title, primary: d.primary, secondary: d.secondary, rationale: d.rationale })),
    weeklySets: bp.weeklySets,
    fst7: bp.fst7 ?? null,
    rationaleLines: bp.rationaleLines,
  };
}
