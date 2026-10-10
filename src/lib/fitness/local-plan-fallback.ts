import { db } from "@/lib/db";
import type { OnboardingData, Meal } from "@/lib/fitness/types";
import type { ProWorkoutPlanContent, ProMealPlanContent } from "@/lib/fitness/ai";
import type { Plan } from "@/lib/fitness/types";
import {
  buildLockedBank,
  exerciseFamilyKey,
  majorGroupsOfExercise,
  MAJOR_GROUP_KEYS,
  type BankExerciseRow,
  type LockedBank,
  type MajorGroupKey,
} from "@/lib/fitness/exercise-bank-lock";
import { GLOBAL_YOUTUBE_SETTING_KEY } from "@/lib/fitness/exercise-video";
import { PERSIAN_WEEKDAYS } from "@/lib/fitness/types";

/**
 * v146 — موتور محلی اضطراری تولید برنامهٔ تمرینی (تضمین مطلق «هیچ‌وقت بدون برنامه نمی‌مانی»).
 *
 * چرا این فایل وجود دارد (گزارش مالک): «برنامه ورزشی بعد از سه بار تلاش ساخته نشد —
 * به هیچ وجه نباید برنامهٔ ناموفق داشته باشیم؛ این یک قانون است.»
 *
 * تا امروز فقط هوش مصنوعی (AvalAI) برنامه می‌ساخت. اگر AI در دسترس نبود (قطعی سرویس،
 * خطای شبکه، مرگ پروسهٔ سرور وسط کامپایل/OOM، افت کیفیت پاسخ و ...)، کاربرِ پرداخت‌کرده
 * کاملاً بدون برنامه می‌ماند. حالا پس از اتمام همهٔ تلاش‌های AI، این موتور محلی یک
 * برنامهٔ کامل و علمی (قواعد مربیان بزرگ: تقسیم عضلانی درست، پوشش کامل گروه‌های اصلی،
 * منع تکرار خانوادهٔ حرکات در یک روز، تنوع حرکتی در طول هفته) را از بانک حرکاتِ
 * ویدیودار می‌سازد — بنابراین تولید برنامه «هرگز» شکست نمی‌خورد.
 *
 * شفافیت: برنامه‌های این موتور با generatedSource = "local_fallback" ذخیره می‌شوند تا
 * ادمین بداند و بتواند با بازتولید AI جایگزینش کند.
 */

/* ───────────────────────── بانک اضطراری داخلی ─────────────────────────
 * فقط اگر بانک اصلی DB خالی/در دسترس نبود استفاده می‌شود — حرکات همگانی
 * بدون تجهیزات که همه‌جا قابل اجرا هستند (تضمین نهایی never-fail). */
const EMERGENCY_BANK: BankExerciseRow[] = [
  { id: "em-pushup", name: "شنا سوئدی (پوش‌آپ)", muscle: "سینه", category: "push", equipment: "bodyweight", description: "در حالت پلانک، دست‌ها زیر شانه؛ بدن صاف، آرنج‌ها ۴۵ درجه؛ پایین برو تا سینه نزدیک زمین و قدرتی بالا بیا.", tips: "کمر قوس نبدهد؛ شکم سفت باشد.", videoUrl: null },
  { id: "em-pushup-incline", name: "شنا سوئدی شیب‌دار (دست بلند)", muscle: "سینه", category: "push", equipment: "bodyweight", description: "دست‌ها روی لبهٔ مبل یا پله؛ همان فرم پوش‌آپ با زاویهٔ آسان‌تر.", tips: "هرچه دست بالاتر، حرکت آسان‌تر.", videoUrl: null },
  { id: "em-pike-pushup", name: "پایک پوش‌آپ (شنا سرشانه)", muscle: "سرشانه", category: "push", equipment: "bodyweight", description: "بدن به شکل V وارونه؛ با خم‌کردن آرنج‌ها سر به سمت زمین بین دست‌ها پایین بیا و بالا برو.", tips: "گردن زیر خط ستون فقرات بماند.", videoUrl: null },
  { id: "em-chair-dip", name: "دیپ روی صندلی (پشت‌بازو)", muscle: "پشت بازو", category: "push", equipment: "bodyweight", description: "دست‌ها روی لبهٔ صندلی، باسن جلوی صندلی؛ آرنج به عقب و پایین، سپس فشار به بالا.", tips: "شانه‌ها پایین و عقب؛ آرنج به بیرون باز نشود.", videoUrl: null },
  { id: "em-inverted-row", name: "زیربغل میز (روئینگ وزن بدن)", muscle: "پشت", category: "pull", equipment: "bodyweight", description: "زیر میز محکم بگیر، بدن صاف؛ سینه را به لبهٔ میز بکش و کنترل‌شده پایین بیا.", tips: "تیره‌ها به سمت بدن جمع شوند.", videoUrl: null },
  { id: "em-towel-row", name: "روئینگ حوله (درِ اتاق)", muscle: "پشت", category: "pull", equipment: "bodyweight", description: "حوله را دور پایهٔ محکم بپیچان، نشسته بکش؛ آرنج‌ها نزدیک بدن.", tips: "کمر صاف، تیغه‌های شانه را به هم نزدیک کن.", videoUrl: null },
  { id: "em-superman", name: "سوپرمن (تقویت کمر)", muscle: "پشت", category: "pull", equipment: "bodyweight", description: "روی شکم؛ دست و پا هم‌زمان بالا، ۲ ثانیه نگه دار و پایین بیا.", tips: "گردن خنثی؛ حرکت کنترل‌شده.", videoUrl: null },
  { id: "em-squat", name: "اسکوات بدون وزنه", muscle: "پا", category: "legs", equipment: "bodyweight", description: "پاها عرض شانه؛ لگن به عقب‌پایین تا ران موازی زمین؛ پاشنه چسبیده به زمین.", tips: "زانو در راستای نوک پنجه.", videoUrl: null },
  { id: "em-lunge", name: "لانژ ثابت", muscle: "پا", category: "legs", equipment: "bodyweight", description: "یک قدم بلند به جلو؛ زانوی عقب به سمت زمین پایین بیا و با پاشنهٔ جلویی بالا برو.", tips: "تنه صاف؛ زانوی جلو از نوک پنجه جلوتر نرود.", videoUrl: null },
  { id: "em-glute-bridge", name: "پل باسن", muscle: "پا و باسن", category: "legs", equipment: "bodyweight", description: "خوابیده به پشت، زانو خم؛ لگن را تا خط بدن بالا فشار بده و در بالا منقبض کن.", tips: "۱ ثانیه در بالا مکث کن.", videoUrl: null },
  { id: "em-calf-raise", name: "ساق پا ایستاده", muscle: "ساق", category: "legs", equipment: "bodyweight", description: "روی پنجه بالا برو، در بالا مکث کوتاه، کنترل‌شده پایین بیا.", tips: "دامنهٔ کامل حرکت.", videoUrl: null },
  { id: "em-plank", name: "پلانک", muscle: "شکم", category: "core", equipment: "bodyweight", description: "ساعد روی زمین، بدن خط صاف؛ شکم و باسن منقبض و نفس منظم.", tips: "لگن نه بالا نه افتاده.", videoUrl: null },
  { id: "em-crunch", name: "کرانچ شکم", muscle: "شکم", category: "core", equipment: "bodyweight", description: "خوابیده به پشت، زانو خم؛ با انقباض شکم شانه‌ها را از زمین بلند کن.", tips: "با شکم بکش، نه با دست‌ها.", videoUrl: null },
  { id: "em-leg-raise", name: "بالادست پا خوابیده", muscle: "شکم", category: "core", equipment: "bodyweight", description: "دست‌ها کنار بدن؛ پاهای صاف را تا ۹۰ درجه بالا بیاور و آهسته پایین بیا.", tips: "کمر به زمین چسبیده بماند.", videoUrl: null },
];

/* ───────────────────────── قالب تقسیم عضلانی ───────────────────────── */

type DayTemplate = {
  title: string;
  focus: string;
  groups: MajorGroupKey[];
  /** امضای تنوع — روزهای A/B با امضای متفاوت حرکات متفاوت برمی‌دارند */
  variant: "A" | "B";
  /** v146b — فقط روزهای تمام‌بدن واقعی (حرکات کل‌بدن فقط اینجا مجازند) */
  fullbody?: boolean;
};

/** قواعد مربیان بزرگ: ۳ روز → PPL | ۴ روز → آپر/لاور | ۵+ → ترکیب PPL + آپر/لاور با تنوع */
function buildSplit(workoutDays: number): DayTemplate[] {
  const pushA: DayTemplate = { title: "پوش — سینه، سرشانه و پشت‌بازو", focus: "سینه، سرشانه، پشت‌بازو", groups: ["chest", "shoulders", "arms"], variant: "A" };
  const pullA: DayTemplate = { title: "پول — زیربغل، کمر و جلوبازو", focus: "زیربغل، پشت، جلوبازو", groups: ["back", "arms"], variant: "A" };
  const legsA: DayTemplate = { title: "پا و باسن", focus: "چهارسر، پشت‌پا، باسن، ساق", groups: ["legs"], variant: "A" };
  const upperA: DayTemplate = { title: "بالاتنه — سینه و زیربغل", focus: "سینه، زیربغل، سرشانه، بازو", groups: ["chest", "back", "shoulders", "arms"], variant: "A" };
  const lowerA: DayTemplate = { title: "پایین‌تنه — پا و مرکز بدن", focus: "پا، باسن، شکم", groups: ["legs", "core"], variant: "A" };
  const upperB: DayTemplate = { title: "بالاتنه — سرشانه و بازو", focus: "سرشانه، بازو، سینه، زیربغل", groups: ["shoulders", "arms", "chest", "back"], variant: "B" };
  const lowerB: DayTemplate = { title: "پایین‌تنه — باسن و پشت‌پا", focus: "باسن، پشت‌پا، ساق، شکم", groups: ["legs", "core"], variant: "B" };
  const fullA: DayTemplate = { title: "تمام بدن — حرکات ترکیبی", focus: "تمام بدن", groups: ["chest", "back", "legs", "shoulders"], variant: "A", fullbody: true };
  const fullB: DayTemplate = { title: "تمام بدن — تنوع دوم", focus: "تمام بدن", groups: ["legs", "chest", "back", "arms"], variant: "B", fullbody: true };

  const n = Math.max(1, Math.min(7, workoutDays || 3));
  switch (n) {
    case 1:
      return [fullA];
    case 2:
      return [fullA, fullB];
    case 3:
      return [pushA, pullA, legsA];
    case 4:
      return [upperA, lowerA, upperB, lowerB];
    case 5:
      return [pushA, pullA, legsA, upperB, lowerB];
    case 6:
      return [
        pushA,
        pullA,
        legsA,
        { ...pushA, variant: "B", title: "پوش (روز دوم) — تأکید سرشانه", focus: "سرشانه، سینه، پشت‌بازو" },
        { ...pullA, variant: "B", title: "پول (روز دوم) — تأکید ضخامت پشت", focus: "پشت، زیربغل، جلوبازو" },
        { ...legsA, variant: "B", title: "پا (روز دوم) — تأکید پشت‌پا و باسن", focus: "پشت‌پا، باسن، چهارسر، ساق" },
      ];
    default:
      return [
        pushA,
        pullA,
        legsA,
        { ...pushA, variant: "B", title: "پوش (روز دوم) — تأکید سرشانه", focus: "سرشانه، سینه، پشت‌بازو" },
        { ...pullA, variant: "B", title: "پول (روز دوم) — تأکید ضخامت پشت", focus: "پشت، زیربغل، جلوبازو" },
        { ...legsA, variant: "B", title: "پا (روز دوم) — تأکید پشت‌پا و باسن", focus: "پشت‌پا، باسن، چهارسر، ساق" },
        fullB,
      ];
  }
}

/* ───────────────────────── انتخاب حرکت ───────────────────────── */

/** الگوهای چندمفصلی (کامپاند) — اولویت برنامه‌نویسی علمی: حرکت پایه اول */
const COMPOUND_PATTERNS = [
  "پرس", "اسکوات", "ددلیفت", "دد لیفتی", "لانژ", "بارفیکس", "پارالل", "دیپ",
  "روئینگ", "رووینگ", "هیپ تراست", "لفت", "تراستر", "کینگ باکس",
];

/* ─────────────── الگوی پایهٔ حرکت (طبقه‌بندی درشت‌تر از خانواده) ───────────────
 * قانون مربیان بزرگ: در یک روز حداکثر ۲ حرکت از «یک الگوی پایه» (پرس/اسکوات/
 * ددلیفت/روئینگ/بارفیکس/نشر/فلای/...) — وگرنه به همان اشتباه معروف
 * «۴ واریانت بارفیکس در یک روز» (گزارش مالک) می‌رسیم. کلید خانوادهٔ دقیق
 * (exercise-bank-lock) پرس بالاسینه/زیرسینه/فلور را خانواده‌های جدا حساب می‌کند
 * (درست برای دیباگ خروجی AI) — ولی برای چیدمان یک روز باید درشت‌تر قضاوت کنیم.
 */
const BASE_PATTERN_RULES: [RegExp, string][] = [
  [/پرس پا|لگ پرس|leg ?press/i, "legpress"],
  [/پرس|پوش ?پرس|پرسس/i, "press"],
  [/اسکوات|اسکات|squat/i, "squat"],
  [/ددلیفت|رومانیایی|deadlift|رانیان?ی/i, "hinge"],
  [/هیپ تراست|بریج|hip ?thrust|برنجی/i, "hip"],
  [/لانژ|lunge|قدم/i, "lunge"],
  [/روئینگ|رووینگ|row/i, "row"],
  [/بارفیکس|پول ?آپ|pull ?up|کشش بارفیکس/i, "pullup"],
  [/پول ?اور|pullover/i, "pullover"],
  [/دیپ|پارالل|dip/i, "dip"],
  [/نشر|لاترال|raise/i, "raise"],
  [/فلای|کراس ?اور|fly/i, "fly"],
  [/جلوبازو|جلو بازو|بیسپس|biceps/i, "biceps"],
  [/پشت بازو|پشت‌بازو|تریسپس|triceps/i, "triceps"],
  [/شراگ|کول|shrug/i, "shrug"],
  [/ساق|calf/i, "calf"],
  [/جلوبازو پا|جلو پا|ددپردامنی|leg ?ext/i, "legext"],
  [/پشت پا|پشت‌پا|leg ?curl|همسترینگ/i, "legcurl"],
  [/کرانچ|پلانک|شکم|زیرشکم|بالاتنه پا|بلند کردن پا|core/i, "core"],
];

function basePatternKey(name: string): string {
  const n = name || "";
  for (const [re, key] of BASE_PATTERN_RULES) {
    if (re.test(n)) return key;
  }
  return "";
}

function compoundScore(name: string): number {
  const n = name || "";
  let s = 0;
  for (const p of COMPOUND_PATTERNS) if (n.includes(p)) { s = 50; break; }
  return s;
}

/** حرکات «کل بدن» — در روزهای تخصصی جایگاه ندارند (تراستر/ارگ/دی‌اچ‌پی و...) */
function isFullbodyRow(row: BankExerciseRow): boolean {
  const m = String(row.muscle || "");
  return m.includes("کل بدن") || m.includes("بدن کامل");
}

/**
 * v146b — نگاشت گروه فقط از «فیلد عضله» (هرگز از اسم حرکت!).
 * مپر اشتراکی (majorGroupsOfExercise) اسم را هم پارس می‌کند و همین باعث
 * خطای «بارفیکس چست تو بار → chest» (کلمهٔ Chest در اسم)، «پرس سرشانه از
 * پشت گردن → back» (پشت در اسم) و «روئینگ دمبل تک‌دست → arms» (دست در اسم)
 * می‌شد — نتیجه‌اش حرکت غریبه در روز اشتباه بود. اسم هرگز گروه را تعیین نمی‌کند.
 */
function pickerGroupsOf(row: BankExerciseRow): Set<MajorGroupKey> {
  const m = String(row.muscle || "");
  const g = new Set<MajorGroupKey>();
  if (isFullbodyRow(row)) {
    for (const k of MAJOR_GROUP_KEYS) g.add(k);
    return g;
  }
  if (m.includes("سینه")) g.add("chest");
  if (m.includes("پشت ران") || m.includes("همسترینگ")) g.add("legs");
  else if (m.includes("پشت") || m.includes("زیربغل")) g.add("back");
  if (m.includes("سرشانه") || m.includes("دلتوئید") || m.includes("کول")) g.add("shoulders");
  if (m.includes("پشت بازو") || m.includes("پشت‌بازو") || m.includes("جلو بازو") || m.includes("جلوبازو") || m.includes("بازو") || m.includes("ساعد")) g.add("arms");
  if (m.includes("شکم") || m.includes("کمر") || m.includes("مرکز")) g.add("core");
  if (m.includes("پا") || m.includes("ران") || m.includes("باسن") || m.includes("ساق") || m.includes("چهارسر") || m.includes("گلوت")) g.add("legs");
  if (g.size === 0) {
    // فال‌بک به مپر اشتراکی (بهتر از هیچ — ولی عملاً رخ نمی‌دهد)
    return majorGroupsOfExercise(row);
  }
  return g;
}

/** نام فشرده — برای تشخیص «هیپ تراست» ≈ «هیپ تراست تک‌پا» */
function squeezeName(n: string): string {
  return String(n || "").replace(/[\s\u200C\-–—_()،؛:!?؟."«»\[\]]/g, "");
}

/** توکن‌های تجهیزات مجاز کاربر — باشگاه = همه؛ خانه = فقط انتخاب‌های کاربر */
function allowedEquipmentTokens(planData: OnboardingData): Set<string> | null {
  if (planData.workoutPlace === "gym") return null; // همه
  const raw = Array.isArray(planData.equipment) ? planData.equipment : [];
  const tokens = new Set<string>();
  for (const e of raw) {
    for (const t of String(e).split(/[,\s]+/)) {
      const k = t.trim().toLowerCase();
      if (k) tokens.add(k);
    }
  }
  if (planData.workoutPlace === "home") {
    // در خانه معمولاً این‌ها در دسترس نیست مگر کاربر صریحاً انتخاب کند
    tokens.add("bodyweight");
    tokens.add("band");
    if (tokens.size <= 2) tokens.add("dumbbell"); // حداقل دمبل خانگی فرض منطقی
  }
  return tokens.size > 0 ? tokens : null;
}

function rowEquipmentTokens(row: BankExerciseRow): string[] {
  return String(row.equipment || "bodyweight")
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function rowAllowed(row: BankExerciseRow, allowed: Set<string> | null): boolean {
  if (!allowed) return true;
  const toks = rowEquipmentTokens(row);
  return toks.every((t) => allowed.has(t));
}

interface PickCtx {
  bank: LockedBank;
  allowed: Set<string> | null;
  usage: Map<string, number>; // تنوع هفته — حرکتِ کم‌استفاده اولویت
  usedIdsThisDay: Set<string>;
  usedFamiliesThisDay: Set<string>;
}

/** برچسب گروه اصلی → وزن ترتیب (گروه‌های اول روز، اول انتخاب می‌شوند) */
function pickExercisesForDay(
  ctx: PickCtx,
  template: DayTemplate,
  count: number,
  disciplineNames: string[]
): BankExerciseRow[] {
  const { bank, allowed, usage, usedIdsThisDay, usedFamiliesThisDay } = ctx;
  const targets = new Set<MajorGroupKey>(template.groups);
  const discPriority = new Set(disciplineNames);
  const fullbodyDay = !!template.fullbody;

  const candidates = bank.all.filter((row) => {
    if (usedIdsThisDay.has(row.id)) return false;
    if (!rowAllowed(row, allowed)) return false;
    // v146b — حرکات کل‌بدن فقط در روزهای تمام‌بدن (تراستر/ارگ روی روز پوش ممنوع)
    if (isFullbodyRow(row) && !fullbodyDay) return false;
    const groups = pickerGroupsOf(row);
    let hit = false;
    for (const g of groups) if (targets.has(g)) { hit = true; break; }
    return hit;
  });

  const scoreRow = (row: BankExerciseRow): number => {
    const groups = pickerGroupsOf(row);
    let score = 0;
    // تنوع هفته: حرکتی که کمتر استفاده شده اولویت دارد
    score -= (usage.get(row.id) ?? 0) * 60;
    // امتیاز رشتهٔ ورزشی
    if (discPriority.has(row.name)) score += 120;
    // کامپاند اول (قاعدهٔ مربیان بزرگ)
    score += compoundScore(row.name);
    // اولویت گروه‌های اصلی روز به ترتیب تعریف (گروه اول +۳۰، دوم +۲۰، بقیه +۱۰)
    const order = template.groups.indexOf([...groups].find((g) => targets.has(g)) as MajorGroupKey);
    score += order === 0 ? 30 : order === 1 ? 20 : Math.max(0, 10);
    // v146b — حرکات کل‌بدن در روزهای تخصصی جریمهٔ سنگین (فقط روزهای تمام‌بدن آزادند)
    if (isFullbodyRow(row)) score += fullbodyDay ? 15 : -45;
    // تجهیزات پرکاربرد باشگاه کمی جلوتر
    const eq = rowEquipmentTokens(row);
    if (eq.some((t) => ["barbell", "machine", "cable", "dumbbell"].includes(t))) score += 8;
    return score;
  };

  const sorted = candidates
    .map((r) => ({ r, s: scoreRow(r) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);

  const picked: BankExerciseRow[] = [];
  const patternCountThisDay = new Map<string, number>(); // ⚠️ لایهٔ درشت — ضد «۴ پرس در یک روز»
  const isNearDuplicate = (name: string): boolean => {
    const sq = squeezeName(name);
    // v146b — «واحد پایه» = دو کلمهٔ اول نام — «هیپ تراست» + هر واریانتش ممنوع در یک روز
    const tokens = String(name || "").trim().split(/[\s\u200C]+/).filter(Boolean);
    const base = tokens.slice(0, 2).join("");
    return picked.some((p) => {
      const ps = squeezeName(p.name);
      const ptokens = String(p.name || "").trim().split(/[\s\u200C]+/).filter(Boolean);
      const pbase = ptokens.slice(0, 2).join("");
      return sq === ps || (sq.length >= 5 && ps.includes(sq)) || (ps.length >= 5 && sq.includes(ps)) ||
        (base.length >= 5 && base === pbase);
    });
  };
  for (const row of sorted) {
    if (picked.length >= count) break;
    // ⚠️ قانون کلیدی (گزارش مالک: ۴ نوع بارفیکس در یک روز!) — در یک روز فقط
    // یک عضو از هر خانوادهٔ حرکتی (بارفیکس/پرس/اسکوات/نشر/...) مجاز است.
    const fam = exerciseFamilyKey(row.name, row.muscle);
    if (fam && usedFamiliesThisDay.has(fam)) continue;
    // v146b — واریانتِ نزدیک همان حرکت در یک روز ممنوع («هیپ تراست» + «هیپ تراست تک‌پا»)
    if (isNearDuplicate(row.name)) continue;
    // v146b — سقف الگوی پایه: حداکثر ۲ حرکت با یک الگو در روز (مثلاً پرس تخت + بالاسینه بله؛ ۴ پرس نه)
    const pattern = basePatternKey(row.name);
    if (pattern && (patternCountThisDay.get(pattern) ?? 0) >= 2) continue;
    // اگر نوبتِ روز B است و حرکت در روز هم‌قالب A استفاده شده، ترجیح تنوع
    if (picked.length < count) {
      picked.push(row);
      usedIdsThisDay.add(row.id);
      if (fam) usedFamiliesThisDay.add(fam);
      if (pattern) patternCountThisDay.set(pattern, (patternCountThisDay.get(pattern) ?? 0) + 1);
      usage.set(row.id, (usage.get(row.id) ?? 0) + 1);
    }
  }
  // fail-safe سه‌مرحله‌ای: ① بدون سقف الگو (ولی همچنان هم‌گروه + ضدخانواده)
  // ② هم‌گروه با چشم‌پوشی از خانوادهٔ دقیق ③ هر حرکت (تضمین never-fail در بانک‌های خیلی کوچک)
  if (picked.length < count) {
    for (const row of sorted) {
      if (picked.length >= count) break;
      if (picked.some((p) => p.id === row.id)) continue;
      if (isNearDuplicate(row.name)) continue;
      if (isFullbodyRow(row) && !fullbodyDay) continue;
      const groups = pickerGroupsOf(row);
      if (![...groups].some((g) => targets.has(g))) continue;
      picked.push(row);
      usedIdsThisDay.add(row.id);
      const fam = exerciseFamilyKey(row.name, row.muscle);
      if (fam) usedFamiliesThisDay.add(fam);
      usage.set(row.id, (usage.get(row.id) ?? 0) + 1);
    }
  }
  if (picked.length < count) {
    for (const row of sorted) {
      if (picked.length >= count) break;
      if (picked.some((p) => p.id === row.id)) continue;
      picked.push(row);
      usedIdsThisDay.add(row.id);
      usage.set(row.id, (usage.get(row.id) ?? 0) + 1);
    }
  }
  return picked;
}

/* ───────────────────────── ست/تکرار/استراحت بر اساس هدف ───────────────────────── */

function prescriptionFor(planData: OnboardingData, experience: string): {
  sets: number; reps: string; restSec: number; rpe: number;
} {
  const goal = planData.goal;
  if (goal === "strength") return { sets: 5, reps: "4-6", restSec: 150, rpe: 8 };
  if (goal === "fat_loss" || goal === "cut") return { sets: 4, reps: "12-15", restSec: 60, rpe: 7 };
  if (goal === "endurance") return { sets: 3, reps: "15-20", restSec: 45, rpe: 6 };
  if (goal === "bulk" || goal === "muscle_gain") return { sets: 4, reps: "8-10", restSec: 90, rpe: 8 };
  // fitness
  return { sets: 3, reps: "10-12", restSec: 75, rpe: 7 };
}

/* ───────────────────────── سازندهٔ برنامه ───────────────────────── */

let cachedBank: { bank: LockedBank; at: number } | null = null;

async function loadBank(): Promise<LockedBank> {
  // کش ۶۰ ثانیه‌ای — بانک در طول یک چرخهٔ تولید تغییر نمی‌کند
  if (cachedBank && Date.now() - cachedBank.at < 60_000) return cachedBank.bank;
  try {
    const [rows, settingRow] = await Promise.all([
      db.exerciseLibrary.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, muscle: true, category: true, equipment: true,
          description: true, tips: true,
          videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true,
        },
      }),
      db.siteSetting.findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } }),
    ]);
    let globalYoutube = true;
    if (settingRow?.value != null) {
      try {
        const v = typeof settingRow.value === "string" ? JSON.parse(settingRow.value) : settingRow.value;
        globalYoutube = !(v && typeof v === "object" && (v as { enabled?: boolean }).enabled === false);
      } catch { /* پیش‌فرض true */ }
    }
    const bank = buildLockedBank(rows as BankExerciseRow[], globalYoutube);
    if (bank.all.length > 0) {
      cachedBank = { bank, at: Date.now() };
      return bank;
    }
  } catch (e) {
    console.error("[local-plan-fallback] bank load failed — using emergency bank:", e);
  }
  // بانک DB خالی بود → بانک اضطراری داخلی (تضمین نهایی)
  return buildLockedBank(EMERGENCY_BANK, true);
}

function buildSets(pres: { sets: number; reps: string; restSec: number; rpe: number }): {
  setNumber: number; reps: string; restSec: number; rpe: number;
}[] {
  return Array.from({ length: pres.sets }, (_, i) => ({
    setNumber: i + 1,
    reps: pres.reps,
    restSec: pres.restSec,
    rpe: pres.rpe,
  }));
}

function dayNamesFor(planData: OnboardingData, count: number): string[] {
  const list = (planData.workoutDaysList || []).filter(Boolean);
  if (list.length >= count) return list.slice(0, count);
  return PERSIAN_WEEKDAYS.slice(0, count);
}

/**
 * ساخت برنامهٔ تمرینی کامل با موتور محلی — هرگز throw نمی‌کند مگر در شرایط
 * غیرقابل‌تصور (که caller هم catch دارد). خروجی همان ساختار ProWorkoutPlanContent است.
 */
export async function buildLocalFallbackWorkoutPlan(
  planData: OnboardingData,
  planName: Plan | null
): Promise<ProWorkoutPlanContent> {
  const bank = await loadBank();
  const templates = buildSplit(planData.workoutDays);
  const dayNames = dayNamesFor(planData, templates.length);
  const experience = planData.trainingExperience || "beginner";
  const pres = prescriptionFor(planData, experience);
  const allowed = allowedEquipmentTokens(planData);

  // تعداد حرکت هر روز بر اساس سابقه — هم‌راستا با بازه‌های پرامپت AI
  const perDay =
    experience === "pro" ? 8 : experience === "advanced" ? 7 : experience === "intermediate" ? 6 : 5;
  // اگر بانک کوچک است، کمتر بگیر (fail-safe)
  const bankSize = bank.all.length;
  const targetPerDay = bankSize >= perDay * templates.length ? perDay : Math.max(4, Math.min(perDay, Math.floor(bankSize / Math.max(1, templates.length))));

  // اولویت رشتهٔ ورزشی (در صورت وجود)
  let disciplineNames: string[] = [];
  try {
    const { DISCIPLINE_EXERCISE_NAMES } = await import("@/lib/fitness/disciplines-data");
    if (planData.discipline && DISCIPLINE_EXERCISE_NAMES[planData.discipline]) {
      disciplineNames = DISCIPLINE_EXERCISE_NAMES[planData.discipline] ?? [];
    }
  } catch { /* اختیاری */ }

  const ctx: PickCtx = {
    bank,
    allowed,
    usage: new Map(),
    usedIdsThisDay: new Set(),
    usedFamiliesThisDay: new Set(),
  };

  const days = templates.map((template, idx) => {
    ctx.usedIdsThisDay = new Set();
    ctx.usedFamiliesThisDay = new Set();
    const rows = pickExercisesForDay(ctx, template, targetPerDay, disciplineNames);

    const exercises = rows.map((row, i) => {
      const sets = buildSets(pres);
      // ست آخر حرکت آخر هر روز — کاهش جزئی RPE برای ریکاوری علمی
      if (i === rows.length - 1) sets[sets.length - 1].rpe = Math.max(6, pres.rpe - 1);
      return {
        id: `local-${row.id}-${idx}-${i}`,
        name: row.name,
        muscle: row.muscle,
        category: row.category,
        description: row.description || "حرکت را با کنترل کامل و دامنهٔ حرکتی کامل اجرا کن.",
        tips: row.tips || "فرم صحیح و تنفس منظم را حفظ کن.",
        mediaUrl: row.videoUrl || "",
        difficulty: experience,
        sets,
        exerciseId: row.id,
        coachTip: "در فاز منفی (پایین آمدن) ۲ تا ۳ ثانیه مکث کن تا کشش کامل حس شود.",
        rpe: pres.rpe,
        // v147 — تمپوی استاندارد هایپرتروفی (ممیزی گیت کیفیت: هر حرکت RPE+تمپو دارد)
        tempo: planData.goal === "strength" ? "2-0-1-1" : planData.goal === "endurance" ? "2-0-2-0" : "3-0-1-0",
      };
    });

    const warmup = [
      { name: "گرم‌کردن عمومی — دویدن سبک یا طناب", durationSec: 300, notes: "شدت پایین (RPE 4-5) تا عرق خفیف" },
      { name: "موبیلیتی مفصل هدف روز", durationSec: 120, notes: "چرخش شانه/لگن + ۱۰ تکرار حرکت اصلی با وزنهٔ خیلی سبک" },
    ];
    const cooldown = [
      { name: "حرکات کششی عضلات هدف روز", durationSec: 240, notes: "هر کشش ۳۰ ثانیه — بدون فشار دردناک" },
    ];

    return {
      day: dayNames[idx] ?? `روز ${idx + 1}`,
      title: template.title,
      focus: template.focus,
      estimatedMinutes: Math.min(90, 15 + exercises.length * 8),
      warmup,
      exercises,
      cooldown,
    };
  });

  // ─── پوشش گروه‌های اصلی (اعتبار برنامه) ───
  const covered = new Set<MajorGroupKey>();
  for (const d of days) for (const ex of d.exercises) {
    for (const g of majorGroupsOfExercise(ex)) covered.add(g);
  }

  // ─── v147 — تضمین قطعی پوشش شش گروه اصلی (قانون مربیان بزرگ) ───
  // موتور انتخاب، حرکات شکم را به‌دلیل امتیاز کامپاندِ حرکات پا هرگز برنمی‌داشت
  // (دیباگ واقعی: برنامهٔ ۵ روزه بدون هیچ حرکت core → پوشش ناقص). حالا اگر گروهی
  // پوشش داده نشده باشد، حرکت آن گروه به‌صورت تضمینی به روزها اضافه می‌شود.
  // شکم: ۲ روز در هفته (استاندارد) با خانواده‌های متفاوت (کرانچ/پلانک/لگ‌ریز).
  {
    const missingGroups = MAJOR_GROUP_KEYS.filter((g) => !covered.has(g));
    if (missingGroups.length > 0) {
      const usedIds = new Set<string>(days.flatMap((d) => d.exercises.map((e) => e.exerciseId as string)));
      const usedFamilies = new Set<string>(days.flatMap((d) => d.exercises.map((e) => exerciseFamilyKey(e.name, e.muscle))));
      let coreAdded = 0;
      for (const g of missingGroups) {
        // کاندیدهای این گروه — کامپاند اول، بدون تکرار خانواده در همان روزِ مقصد
        // ⚠️ v147b — حرکات «کل بدن» از استخرagerِ ترمیم حذف می‌شوند: تراستر/دیل پرس
        // همهٔ شش گروه را پوشش می‌دهند و به‌جای حرکت واقعی شکم انتخاب می‌شدند!
        const pool = bank.all
          .filter((r) => !usedIds.has(r.id) && !isFullbodyRow(r) && pickerGroupsOf(r).has(g))
          .sort((a, b) => compoundScore(b.name) - compoundScore(a.name));
        // برای core: تا ۲ حرکت (روز آخر و روز میانی) با خانواده‌های متفاوت
        const wanted = g === "core" ? 2 : 1;
        let added = 0;
        for (const row of pool) {
          if (added >= wanted) break;
          const fam = exerciseFamilyKey(row.name, row.muscle);
          if (usedFamilies.has(fam)) continue;
          // مقصد: روز با کمترین تعداد حرکت (تعادل حجم روزها)
          const targetDay = days.reduce((min, d) => (d.exercises.length < min.exercises.length ? d : min), days[0]);
          const coreIsPlank = /پلانک|plank/i.test(row.name);
          targetDay.exercises.push({
            id: `local-${row.id}-cov-${g}-${added}`,
            name: row.name,
            muscle: row.muscle,
            category: row.category,
            description: row.description || "حرکت را با کنترل کامل و دامنهٔ حرکتی کامل اجرا کن.",
            tips: row.tips || "فرم صحیح و تنفس منظم را حفظ کن.",
            mediaUrl: row.videoUrl || "",
            difficulty: experience,
            sets: Array.from({ length: 3 }, (_, i) => ({
              setNumber: i + 1,
              reps: coreIsPlank ? "30-45 ثانیه" : "12-15",
              restSec: 60,
              rpe: 7,
            })),
            exerciseId: row.id,
            coachTip: "انقباض کامل و کنترل تنفس — کیفیت اجرا مهم‌تر از وزنه است.",
            rpe: 7,
            tempo: "2-0-2-0",
          });
          usedIds.add(row.id);
          usedFamilies.add(fam);
          added++;
          if (g === "core") coreAdded++;
        }
      }
      if (coreAdded > 0) {
        console.warn(`[local-plan-fallback] v147 coverage guarantee: appended ${coreAdded} core exercise(s) + ${missingGroups.filter((g) => g !== "core").length} other group fix(es)`);
      }
    }
  }

  const safetyNotes: string[] = [];
  if (planData.injuries && planData.injuries.trim()) safetyNotes.push(`به‌دلیل آسیب‌دیدگی ثبت‌شده («${planData.injuries.trim()}»)، هر حرکتی که درد ایجاد کرد را با نسخهٔ سبک‌تر جایگزین کن و با مربی/پزشک مشورت کن.`);
  if (planData.diseases && planData.diseases.trim()) safetyNotes.push(`به‌دلیل شرایط پزشکی ثبت‌شده («${planData.diseases.trim()}»)، شدت را محافظه‌کارانه نگه دار و قبل از تمرین‌های سنگین با پزشک هماهنگ کن.`);
  if (Array.isArray(planData.medicalConditions) && planData.medicalConditions.length > 0) safetyNotes.push("با توجه به شرایط پزشکی انتخابی پروفایل، فشار خون را قبل و بعد تمرین کنترل کن و از انقباض و هماننده‌سازی طولانی (Valsalva) پرهیز کن.");

  const goalLabel =
    planData.goal === "muscle_gain" || planData.goal === "bulk" ? "عضله‌سازی"
    : planData.goal === "fat_loss" || planData.goal === "cut" ? "چربی‌سوزی"
    : planData.goal === "strength" ? "افزایش قدرت"
    : planData.goal === "endurance" ? "استقامت"
    : "تناسب اندام";

  return {
    days,
    weeklyGoal: `هدف هفته: ${goalLabel} — ${templates.length} جلسه تمرین منظم با تلاش تدریجیِ بیشتر نسبت به هفتهٔ قبل.`,
    goal: goalLabel,
    notes: "این برنامه با موتور برنامه‌نویسی محلی فیتاپ (به‌عنوان جایگزین اضطراریِ هوش مصنوعی) بر اساس قواعد مربیان بزرگ ساخته شده است: تقسیم علمی عضلات، پوشش کامل گروه‌های اصلی، حرکات پایهٔ چندمفصلی در اولویت و منع تکرار خانوادهٔ حرکات در یک روز. برای نسخهٔ کاملاً شخصی‌سازی‌شده، از تب برنامه‌ها بازتولید هوش مصنوعی را بزن.",
    muscleGroupSplit: templates.length <= 2 ? "fullbody" : templates.length === 3 ? "push/pull/legs" : "upper/lower + PPL",
    periodizationType: "linear",
    muscleFrequencyPerWeek: templates.length >= 6 ? 2 : 1,
    inspiredByCoach: "mixed",
    advancedTechniques: planName && ["ultimate", "advanced"].includes(planName)
      ? ["سوپرست آنتاگونیست در حرکت آخر روز بالاتنه", "دراپ‌ست روی آخرین ست حرکت اصلی"]
      : [],
    weeklyProgression: {
      strategy: "اضافه‌بار تدریجی خطی — هر هفته کمی وزنه یا تکرار را نسبت به هفتهٔ قبل بالا ببر.",
      weeks: [
        { week: 1, note: "هفتهٔ آماده‌سازی — فرم صحیح، وزنهٔ متوسط (RPE 6-7)" },
        { week: 2, repChange: 1, note: "۱ تکرار به هر ست اضافه کن یا وزنه را ۲.۵ کیلو زیاد کن" },
        { week: 3, repChange: 1, note: "همان روند — فقط اگر فرم آسیب‌پذیر نشد" },
        { week: 4, note: "هفتهٔ دلاود (Deload) — وزنه‌ها ۲۰٪ سبک‌تر برای ریکاوری کامل" },
      ],
    },
    safetyNotes,
    recoveryNotes: [
      "۷ تا ۹ ساعت خواب شبانه — بیشترین ترشح هورمون رشد در خواب عمیق.",
      "روزهای استراحت: پیاده‌روی سبک ۲۰-۳۰ دقیقه برای ریکاوری فعال.",
    ],
    nutritionTimingNotes: [
      "۱.۵ تا ۲ ساعت قبل تمرین: وعدهٔ حاوی کربوهیدرات پیچیده + پروتئین متوسط.",
      "تا ۱ ساعت بعد تمرین: پروتئین سریع‌جذب + کربوهیدرات برای بازسازی گلیکوژن.",
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * v146 — موتور محلی اضطراری برنامهٔ غذایی (همان تضمین never-fail برای تغذیه)
 * ساختار MealPlanContent دقیقاً رعایت می‌شود؛ غذاهای اصلی ایرانی با
 * درشت‌مغذی استاندارد (per 100g) تعبیه شده‌اند و پرس‌ها به کالری هدف
 * مقیاس می‌شوند. برای دیابت/فشار خون/کلمسترول بالا یک هشدار عمومی اضافه می‌شود.
 * ═══════════════════════════════════════════════════════════════════════ */

interface StapleFood {
  key: string;
  name: string;
  category: string;
  kcal100: number;
  p100: number;
  c100: number;
  f100: number;
  base: number; // مقدار پایهٔ پرس (بر حسب unit)
  unit: "گرم" | "عدد" | "اسکوپ" | "قاشق غذاخوری";
  tags?: ("vegan" | "vegetarian" | "keto_ok")[];
}

const STAPLES: StapleFood[] = [
  // پروتئین‌های حیوانی
  { key: "chicken", name: "سینهٔ مرغ گریل‌شده", category: "protein", kcal100: 165, p100: 31, c100: 0, f100: 3.6, base: 150, unit: "گرم", tags: ["keto_ok"] },
  { key: "beef", name: "گوشت گوسالهٔ کم‌چرب", category: "protein", kcal100: 187, p100: 26, c100: 0, f100: 9, base: 130, unit: "گرم", tags: ["keto_ok"] },
  { key: "fish", name: "ماهی (قزل‌آلا/فیل)", category: "protein", kcal100: 190, p100: 21, c100: 0, f100: 11, base: 140, unit: "گرم", tags: ["keto_ok"] },
  { key: "tuna", name: "تن ماهی در آب", category: "protein", kcal100: 116, p100: 26, c100: 0, f100: 1, base: 120, unit: "گرم", tags: ["keto_ok"] },
  { key: "egg", name: "تخم‌مرغ کامل", category: "protein", kcal100: 155, p100: 13, c100: 1.1, f100: 11, base: 2, unit: "عدد", tags: ["vegetarian", "keto_ok"] },
  { key: "whey", name: "پروتئین وی", category: "supplement", kcal100: 400, p100: 80, c100: 8, f100: 5, base: 1, unit: "اسکوپ", tags: ["vegetarian", "keto_ok"] },
  // پروتئین‌های گیاهی/لبنی
  { key: "lentil", name: "عدس پخته", category: "protein", kcal100: 116, p100: 9, c100: 20, f100: 0.4, base: 200, unit: "گرم", tags: ["vegan", "vegetarian"] },
  { key: "bean", name: "لوبیا چیتی پخته", category: "protein", kcal100: 127, p100: 8.7, c100: 22.8, f100: 0.5, base: 180, unit: "گرم", tags: ["vegan", "vegetarian"] },
  { key: "greek_yogurt", name: "ماست یونانی کم‌چرب", category: "dairy", kcal100: 59, p100: 10, c100: 3.6, f100: 0.4, base: 200, unit: "گرم", tags: ["vegetarian", "keto_ok"] },
  { key: "cheese", name: "پنیر سفید کم‌نمک", category: "dairy", kcal100: 174, p100: 14, c100: 1.9, f100: 13, base: 50, unit: "گرم", tags: ["vegetarian", "keto_ok"] },
  // کربوهیدرات‌ها
  { key: "rice", name: "برنج سفید پخته", category: "carb", kcal100: 130, p100: 2.7, c100: 28, f100: 0.3, base: 200, unit: "گرم", tags: ["vegan", "vegetarian"] },
  { key: "bread", name: "نان سنگک", category: "carb", kcal100: 280, p100: 9, c100: 55, f100: 1.5, base: 90, unit: "گرم", tags: ["vegan", "vegetarian"] },
  { key: "potato", name: "سیب‌زمینی آب‌پز", category: "carb", kcal100: 87, p100: 2, c100: 20, f100: 0.1, base: 200, unit: "گرم", tags: ["vegan", "vegetarian"] },
  { key: "oats", name: "جو دوسر (خشک)", category: "carb", kcal100: 389, p100: 16.9, c100: 66, f100: 6.9, base: 60, unit: "گرم", tags: ["vegan", "vegetarian"] },
  // سبزی/میوه/چربی
  { key: "salad", name: "سالاد سبزیجات تازه", category: "veg", kcal100: 25, p100: 1.5, c100: 4, f100: 0.3, base: 150, unit: "گرم", tags: ["vegan", "vegetarian", "keto_ok"] },
  { key: "olive_oil", name: "روغن زیتون", category: "fat", kcal100: 884, p100: 0, c100: 0, f100: 100, base: 1, unit: "قاشق غذاخوری", tags: ["vegan", "vegetarian", "keto_ok"] },
  { key: "walnut", name: "گردو", category: "fat", kcal100: 654, p100: 15, c100: 14, f100: 65, base: 20, unit: "گرم", tags: ["vegan", "vegetarian", "keto_ok"] },
  { key: "almond", name: "بادام خام", category: "fat", kcal100: 579, p100: 21, c100: 22, f100: 50, base: 20, unit: "گرم", tags: ["vegan", "vegetarian", "keto_ok"] },
  { key: "banana", name: "موز", category: "fruit", kcal100: 89, p100: 1.1, c100: 23, f100: 0.3, base: 1, unit: "عدد", tags: ["vegan", "vegetarian"] },
  { key: "apple", name: "سیب", category: "fruit", kcal100: 52, p100: 0.3, c100: 14, f100: 0.2, base: 1, unit: "عدد", tags: ["vegan", "vegetarian"] },
];

function gramsLabel(food: StapleFood, amount: number): string {
  const rounded = food.unit === "گرم" ? Math.round(amount / 5) * 5 : Math.max(1, Math.round(amount * 2) / 2);
  return `${rounded} ${food.unit}`;
}

function itemFrom(food: StapleFood, amount: number, idx: number): {
  id: string; name: string; category: string; calories: number; protein: number; carbs: number; fat: number; servingSize: string; imageUrl: string;
} {
  const factor = amount / 100;
  return {
    id: `local-food-${food.key}-${idx}`,
    name: food.name,
    category: food.category,
    calories: Math.round(food.kcal100 * factor),
    protein: Math.round(food.p100 * factor * 10) / 10,
    carbs: Math.round(food.c100 * factor * 10) / 10,
    fat: Math.round(food.f100 * factor * 10) / 10,
    servingSize: gramsLabel(food, amount),
    imageUrl: "",
  };
}

interface MealDraft {
  type: string;
  label: string;
  items: { food: StapleFood; amount: number }[];
  timingNote?: string;
}

/** قالب وعده‌ها — پرس پایه؛ مقیاس‌پذیر به کالری هدف */
function mealTemplates(diet: string, workoutDayHint: boolean, morningTraining: boolean): MealDraft[] {
  const f = (key: string): StapleFood => {
    const s = STAPLES.find((x) => x.key === key);
    if (!s) throw new Error(`staple missing: ${key}`);
    return s;
  };
  const keto = diet === "keto";
  const vegan = diet === "vegan";
  const vegetarian = diet === "vegetarian" || vegan;

  const proteinLunch = vegan ? f("lentil") : vegetarian ? f("egg") : f("chicken");
  const proteinDinner = vegan ? f("bean") : vegetarian ? f("cheese") : f("fish");
  const carbLunch = keto ? f("salad") : f("rice");
  const carbBreakfast = keto ? f("walnut") : f("bread");

  const drafts: MealDraft[] = [
    {
      type: "صبحانه",
      label: morningTraining ? "صبحانه — وعدهٔ سبک قبل از تمرین صبحگاهی" : "صبحانه — شروع پرانرژی روز",
      timingNote: morningTraining ? "حدود ۶:۰۰-۶:۳۰ — قبل از رفتن به باشگاه (سبک و زودهضم)" : "تا ۱ ساعت بعد از بیداری",
      items: [
        { food: f("egg"), amount: 2 },
        { food: carbBreakfast, amount: keto ? 20 : 90 },
        { food: f("cheese"), amount: 40 },
        { food: f("salad"), amount: 80 },
      ],
    },
    {
      type: "ناهار",
      label: "ناهار — اصلی‌ترین وعده",
      timingNote: "۳ تا ۴ ساعت بعد از صبحانه",
      items: [
        { food: proteinLunch, amount: vegan ? 250 : vegetarian ? 3 : 160 },
        { food: carbLunch, amount: keto ? 200 : 220 },
        { food: f("olive_oil"), amount: 1 },
        { food: f("salad"), amount: 150 },
      ],
    },
    {
      type: "شام",
      label: "شام — سبک و پروتئین‌محور",
      timingNote: "حداقل ۲ ساعت قبل خواب",
      items: [
        { food: proteinDinner, amount: vegan ? 220 : vegetarian ? 120 : 150 },
        { food: keto ? f("salad") : f("potato"), amount: keto ? 200 : 180 },
        { food: f("olive_oil"), amount: 1 },
        { food: f("salad"), amount: 120 },
      ],
    },
    {
      type: "میان‌وعده",
      label: "میان‌وعده — ریکاوری و سیریت کنترل‌شده",
      timingNote: morningTraining ? "عصر — بین وعده‌های اصلی" : workoutDayHint ? "نزدیک تمرین (قبل یا بعد)" : "بین وعده‌های اصلی",
      items: [
        { food: f("greek_yogurt"), amount: 150 },
        { food: vegan ? f("almond") : f("banana"), amount: vegan ? 25 : 1 },
        { food: f("walnut"), amount: 15 },
      ],
    },
  ];

  // v149 — تیکت مالک: تمرین ۶-۱۰ صبح → صبحانه و «وعده بعد تمرین» دو وعدهٔ جدایند؛
  // ورزشکار هرگز با شکم گرسنه به باشگاه نمی‌رود (هم‌قید با موتور AI).
  if (morningTraining) {
    drafts.splice(1, 0, {
      type: "وعده بعد تمرین",
      label: "وعده بعد تمرین — ریکاوری بعد از جلسهٔ صبحگاهی",
      timingNote: "بلافاصله بعد از جلسهٔ تمرین (۱۰-۱۱ صبح)",
      items: [
        { food: f("greek_yogurt"), amount: 200 },
        ...(keto
          ? [{ food: f("walnut"), amount: 15 }, { food: f("almond"), amount: 15 }]
          : [{ food: f("banana"), amount: 1 }, { food: f("oats"), amount: 30 }]),
      ],
    });
  }

  return drafts;
}

function scaleMeal(draft: MealDraft, targetKcal: number, idxBase: number): Meal {
  const items = draft.items.map((it, i) => itemFrom(it.food, it.amount, idxBase + i));
  const baseKcal = items.reduce((s, x) => s + x.calories, 0);
  let factor = baseKcal > 0 ? targetKcal / baseKcal : 1;
  factor = Math.max(0.65, Math.min(1.7, factor)); // مقیاس منطقی — نه گرسنگی نه انفجار پرس
  const scaled = draft.items.map((it, i) => itemFrom(it.food, it.amount * factor, idxBase + i));
  const totalCalories = scaled.reduce((s, x) => s + x.calories, 0);
  return {
    type: draft.type,
    label: draft.label,
    items: scaled,
    totalCalories,
    totalProtein: Math.round(scaled.reduce((s, x) => s + x.protein, 0)),
    totalCarbs: Math.round(scaled.reduce((s, x) => s + x.carbs, 0)),
    totalFat: Math.round(scaled.reduce((s, x) => s + x.fat, 0)),
    combination: scaled.map((x) => x.name).join(" + "),
    timingNote: draft.timingNote,
  };
}

export async function buildLocalFallbackMealPlan(
  planData: OnboardingData,
  planName: Plan | null
): Promise<ProMealPlanContent> {
  const { computeTDEEAndTarget } = await import("@/lib/fitness/ai");
  const t = computeTDEEAndTarget(planData);
  const diet = String(planData.dietType || "standard");
  // v149 — قید وعدهٔ صبحگاهی: صبحانه جدا از وعده بعد تمرین
  const isMorningTraining = planData.workoutTime === "morning";
  const drafts = mealTemplates(diet, true, isMorningTraining);

  // توزیع کالری: صبحانه ۲۷٪ | ناهار ۳۵٪ | شام ۲۶٪ | میان‌وعده ۱۲٪
  // v149 — برای تمرین صبحگاهی: صبحانه سبک‌تر + وعده بعد تمرین مستقل
  const shares: Record<string, number> = isMorningTraining
    ? { "صبحانه": 0.18, "وعده بعد تمرین": 0.17, "ناهار": 0.30, "شام": 0.23, "میان‌وعده": 0.12 }
    : { "صبحانه": 0.27, "ناهار": 0.35, "شام": 0.26, "میان‌وعده": 0.12 };
  let idx = 0;
  const meals = drafts.map((d) => {
    const share = shares[d.type] ?? 0.1;
    const m = scaleMeal(d, t.targetCalories * share, idx);
    idx += d.items.length + 1;
    return m;
  });

  const totalCalories = meals.reduce((s, m) => s + m.totalCalories, 0);
  const totalProtein = meals.reduce((s, m) => s + m.totalProtein, 0);
  const totalCarbs = meals.reduce((s, m) => s + m.totalCarbs, 0);
  const totalFat = meals.reduce((s, m) => s + m.totalFat, 0);

  // 🩹 v168 — قانون مالک: «برنامه مکمل از استاندارد به بالا» — فال‌بک محلی هم
  // باید دقیقاً همان گیت لایهٔ اصلی (ai.ts: supplementsPlan) را رعایت کند.
  // قبلاً "standard" جا افتاده بود → کاربر استاندارد در فال‌بک اضطراری مکمل
  // نمی‌گرفت (نقض «استاندارد به بالا بدون شکست و کامل»).
  const supplements = planName && ["standard", "advanced", "ultimate"].includes(planName)
    ? [
        { name: "پروتئین وی", dose: "۱ اسکوپ (۳۰ گرم)", timing: "بعد از تمرین", note: "در روزهای بدون تمرین هم بعد از صبحانه قابل استفاده است" },
      ]
    : undefined;

  const dietLabel =
    diet === "vegan" ? "وگان" : diet === "vegetarian" ? "گیاهی" : diet === "keto" ? "کتوژنیک" : "استاندارد";

  return {
    meals,
    totalCalories,
    totalProtein,
    totalCarbs,
    totalFat,
    waterLiters: Math.max(1.5, Math.round(planData.weight * 35) / 1000), // وزن × ۳۵ میلی‌لیتر (نه ×۰٫۳۵!)
    notes: `این برنامهٔ غذایی با موتور محلی فیتاپ (جایگزین اضطراری هوش مصنوعی) روی کالری هدف ${t.targetCalories.toLocaleString("fa-IR")} کیلوکالری (${dietLabel}) تنظیم شده است: پروتئین ${t.proteinG} گرم، کربوهیدرات ${t.carbsG} گرم و چربی ${t.fatG} گرم در روز. پرس‌ها با وزن خودتان مقیاس شده‌اند؛ برای نسخهٔ کامل‌تر و متنوع‌تر، از تب برنامه‌ها بازتولید هوش مصنوعی را بزن.`,
    supplements,
    hydrationSchedule: [
      { time: "بیدار شد", amountMl: 300, note: "یک لیوان آب با نصف لیمو" },
      { time: "میانهٔ صبح", amountMl: 400 },
      { time: "قبل تمرین", amountMl: 400, note: "۳۰ دقیقه قبل" },
      { time: "بعد تمرین", amountMl: 400 },
      { time: "عصر", amountMl: 300 },
      { time: "شام", amountMl: 250 },
      { time: "قبل خواب", amountMl: 200 },
    ],
    antiInflammatoryFoods: ["ماهی چرب (امگا-۳)", "روغن زیتون", "گردو و بادام", "سبزیجات برگ‌سبز"],
    prePostWorkoutNutrition: {
      preWorkout: "۶۰ تا ۹۰ دقیقه قبل: کربوهیدرات آسان‌جذب + پروتئین کم‌حجم (مثلاً موز + ماست یونانی)",
      postWorkout: "تا ۶۰ دقیقه بعد: پروتئین سریع‌جذب (وی یا تخم‌مرغ) + کربوهیدرات (برنج/نان/میوه)",
      note: "آب‌رسانی قبل، حین و بعد تمرین را فراموش نکن.",
    },
    foodPrepTips: [
      "پروتئین هفته را یک‌روزه آماده کنید (گریل/آب‌پز) و در یخچال نگه دارید.",
      "برنج/غلات را به‌صورت پختهٔ اندازه‌گیری‌شده ذخیره کنید تا پرس‌ها کنترل شود.",
      "سبزی سالاد را روزانه تازه خرد کنید — ویتامین C حفظ می‌شود.",
    ],
    micronutrientHighlights: ["آهن (گوشت/عدس)", "کلسیم (لبنیات)", "امگا-۳ (ماهی/گردو)", "پتاسیم (موز/سیب‌زمینی)"],
    tdeeBreakdown: {
      bmr: t.bmr,
      tdee: t.tdee,
      targetCalories: t.targetCalories,
      calorieAdjustment: t.calorieAdjustment,
      proteinG: t.proteinG,
      carbsG: t.carbsG,
      fatG: t.fatG,
      proteinPerKg: t.proteinPerKg,
      carbsPerKg: t.carbsPerKg,
      fatPerKg: t.fatPerKg,
    },
  };
}
