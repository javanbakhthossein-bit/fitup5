/**
 * ─── جستجوی هوشمند بانک حرکات (v114) ─────────────────────────────────────
 *
 * درخواست مالک: «کاربر حتی کلمات مترادف را هم سرچ کرد پیدا کند»
 *
 * مثال‌های مالک:
 *   • حرکت «پرس سینه هالتر با شیب منفی» باید با جستجوی «پرس زیر سینه» هم پیدا شود
 *   • جستجوی «پرس سینه با دمبل» باید حرکت پرس سینه دمبل را برگرداند
 *   • «پرس بالا سینه» = «اینکلاین» = «شیب مثبت» = «بالاسینه»
 *
 * معماری:
 *   ۱. نرمال‌سازی (حروف عربی→فارسی، اعراب، ی/ک، اعداد، حروف کوچک لاتین)
 *   ۲. فشردن (حذف فاصله/نیم‌فاصله) → «پرس زیر سینه» و «پرسزیرسینه» یکی می‌شوند
 *   ۳. واژه‌نامهٔ مترادف‌های عبارتی (SYNONYM_GROUPS) — هر گروه = یک «مفهوم»
 *      با همهٔ لقب‌های رایج فارسی/لاتین؛ اگر هر عبارت گروه در کوئری بود،
 *      آن مفهوم فعال می‌شود و حرکت باید «حداقل یکی» از عبارت‌های همان
 *      گروه را داشته باشد.
 *   ۴. توکن‌های باقی‌مانده (خارج از گروه‌ها) با منطق AND مستقیم چک می‌شوند.
 *   ۵. بدون هیچ مفهوم فعال → fallback: کل عبارت فشرده به‌صورت زیررشته.
 *
 * خالص و بدون I/O — هم در سرور (API) و هم در کلاینت (بانک حرکات/ادمین) قابل استفاده.
 */

import { normalizePersianText } from "./persian-search";

/** حروف لاتین کوچک + اعداد فارسی/عربی → لاتین */
function foldDigitsAndCase(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

/**
 * فشردن کامل برای تطبیق عبارتی: نرمال‌سازی + حذف همهٔ فاصله/نیم‌فاصله/خط تیره.
 * «پرس زیر سینه» == «پرسزیرسینه» == «پرس زیرسینه» == «پرسِ زیر سینه»
 */
export function squeezeExerciseText(input: string): string {
  return foldDigitsAndCase(normalizePersianText(input))
    .replace(/[\s\u200C\-–—_]+/g, "")
    .replace(/[‌.,،؛:!؟?"'()«»\[\]]+/g, "");
}

/**
 * واژه‌نامهٔ مترادف‌های بانک حرکات — هر گروه یک مفهوم با همهٔ لقب‌ها.
 * عبارت‌ها «فشرده‌شده» ذخیره/مقایسه می‌شوند (فاصله اهمیت ندارد).
 * ⚠️ ترتیب مهم است: گروه‌های عبارتی‌تر (خاص‌تر) باید زودتر بیایند.
 */
const SYNONYM_GROUPS_RAW: string[][] = [
  // ─── سینه: زاویه‌ها و مترادف‌ها ───
  ["بالاسینه", "شیبمثبت", "اینکلاین", "اینکایلن", "incline", "uphill"],
  ["زیرسینه", "شیبمنفی", "دکلاین", "decline", "downhill"],
  ["سینه", "چست", "chest", "پکتورال", "pectoral"],

  // ─── سرشانه ───
  ["نشرجانب", "لترال", "لارترال", "lateralraise", "lateral"],
  ["نشرازجلو", "نشرجلو", "فرونتریز", "frontraise", "فرانترایز"],
  ["نشرخم", "پستدلت", "reardelt", "بنتاور", "بنتاورریز", "خمگو", "فلایخم"],
  ["سرشانه", "شولدر", "شانه", "دلتوئید", "دلت", "shoulder", "delt"],
  ["فیسپول", "فیسپول", "facepull"],

  // ─── بازو ───
  ["جلوبازو", "بایسپس", "بایسپ", "بیسپس", "biceps", "bicep"],
  ["پشتبازو", "تریسپس", "تریسپ", "تری‌سپس", "triceps", "triceps"],
  ["ساعد", "فارم", "forearm", "مچدست"],

  // ─── پشت/زیربغل ───
  ["زیربغل", "لات", "لاتیسیموس", "لاتس", "lats", "lat", "back"],
  ["بارفیکس", "پولآپ", "پول‌آپ", "pullup", "pullups"],
  ["روئینگ", "روینگ", "قایقی", "پندلی", "row", "rowing"],
  ["شراگ", "ترپز", "shrug", "traps"],

  // ─── پا ───
  ["اسکوات", "اسکات", "squat", "اسکوا"],
  ["ددلیفت", "ددلیف", "دد‌لیفت", "deadlift"],
  ["لانژ", "لانج", "لانگز", "lunge", "lunges", "بلغاری"],
  ["جلوران", "کوادریسپس", "کواد", "quads", "quad", "جلوبا"],
  ["پشتران", "هامسترینگ", "hamstring", "پشتپا", "پشت‌پا"],
  ["باسن", "گلات", "glute", "باسن‌ها"],
  ["ساق", "کلف", "کآف", "calf", "calves", "ساقپا"],

  // ─── شکم ───
  ["شکم", "ابدومینال", "ابز", "abs", "core"],
  ["کرانچ", "کرنش", "سین‌آپ", "crunch", "situp", "سیتاپ"],
  ["پلانک", "plank"],
  ["کوهنوردی", "مانتینکلایمر", "mountainclimber"],

  // ─── تجهیزات ───
  ["دمبل", "دامبل", "دمببل", "dumbbell", "dumbells"],
  ["هالتر", "باربل", "باربیل", "barbell"],
  ["کتلبل", "کتل‌بل", "کیکبل", "کیتلبل", "کیتلبور", "کتلبل", "kettlebell", "kb"],
  ["سیمکش", "کابل", "cable"],
  ["دستگاه", "ماشین", "machine"],
  ["کش", "کشمقاومتی", "باند", "resistanceband", "band"],
  ["وزنبدن", "بدنوزنه", "bodyweight"],

  // ─── الگوهای حرکتی عمومی ───
  ["پرس", "پررس", "press"],
  ["شنا", "پوشآپ", "pushup", "pushups"],
  ["فلای", "بازوباز", "fly", "flies"],
  ["کراساور", "کراس‌اور", "crossover"],
  ["دیپس", "دیپ", "dips", "پارالل"],
  ["هایپرا", "اکستنشنکمر", "hyperextension", "افزونه‌کمر"],

  // ─── v116 — خانواده‌های ارجاع‌شده در برنامه‌های کاربران (هر تمرینی که در
  // برنامهٔ ورزشکار آمده باید در بانک پیدا شود) ───
  ["تردمیل", "دویدن", "پیاده‌روی", "treadmill", "running", "walking"],
  ["دوچرخهثابت", "دوچرخه", "بایک", "bike", "cycl"],
  ["برپی", "burpee", "بورپی"],
  ["بلغاری", "اسکواتبلغاری", "لانژبلغاری"],
  ["رنه‌گید", "رنگید", "renegade"],
  ["بردداگ", "برددانگ", "سگپرنده", "birddog"],
  ["وی‌آپ", "vup", "vsit", "وی‌سیت", "کرانچ"],
  ["اسپرینتدرجا", "زانوبلند", "هی‌نایز", "highknees"],
  ["سوئینگ", "سوینگ", "swing"],
  ["استپ‌آپ", "استپاپ", "stepup"],
];

/**
 * نسخهٔ نهایی و تمیز گروه‌های مترادف — فشرده‌سازی + حذف تکرار.
 * (ساخت در ماژول‌لود یک‌بار انجام می‌شود؛ صفر هزینه در هر فراخوانی)
 */
const SYNONYM_GROUPS: string[][] = SYNONYM_GROUPS_RAW.map((group) =>
  [...new Set(group.map(squeezeExerciseText))].filter((s) => s.length >= 2)
).filter((g) => g.length > 0);

/** توکن‌های ربط — به‌عنوان مفهوم مستقل چک نمی‌شوند */
const STOPWORDS = new Set(
  [
    "با",
    "و",
    "در",
    "از",
    "به",
    "را",
    "حرکت",
    "حرکات",
    "تمرین",
    "تمرینی",
    "وزنه",
    "وزنه‌ای",
    "حرکت",
    "برای",
    "هم",
    "یک",
    // v116 — صفت‌های توصیفی رایج در نام‌های برنامه‌ها (وزن‌دهندهٔ مفهوم نیستند):
    "سریع",
    "سبک",
    "ملایم",
    "تند",
    "شیب",
    "میز",
    "روی",
    "جا",
    "بدون",
    "پیوسته",
    "سنگین",
    "شیبدار",
    "دار",
  ].map(squeezeExerciseText)
);

/** متن کامل یک حرکت که جستجو روی آن انجام می‌شود */
export function exerciseSearchHaystack(ex: {
  name: string;
  muscle?: string | null;
  equipment?: string | null;
  description?: string | null;
}): string {
  return [ex.name, ex.muscle, ex.equipment, ex.description]
    .filter(Boolean)
    .join(" ");
}

export interface ExerciseSearchable {
  name: string;
  muscle?: string | null;
  equipment?: string | null;
  description?: string | null;
}

/**
 * آیا حرکتِ داده‌شده با کوئری کاربر (با احتساب مترادف‌ها) مطابقت دارد؟
 * کوئری خالی = همیشه بله (بدون جستجو).
 */
export function exerciseMatchesSearch(
  ex: ExerciseSearchable,
  rawQuery: string
): boolean {
  // v116 — بخش پرانتزی کوئری (توضیح جایگزین مثل «بدون وزنه یا با دمبل سبک»)
  // حذف می‌شود — نام‌های بلند برنامه‌ها با پرانتز توضیحی دیگر AND توکنی را نمی‌شکنند.
  const cleaned = rawQuery.replace(/\([^)]*\)/g, " ").trim() || rawQuery;
  const q = squeezeExerciseText(cleaned);
  if (!q) return true;
  const hay = squeezeExerciseText(exerciseSearchHaystack(ex));
  if (!hay) return false;

  // ۱) فعال‌سازی مفهوم‌ها: هر گروهی که یکی از عبارت‌هایش در کوئری بود
  //    v116 — قاعدهٔ «سایه»: گروهی که «همهٔ» عبارت‌های حاضرش زیررشتهٔ عبارتِ
  //    بلندترِ گروهِ دیگری باشند غیرفعال می‌شود (مثلاً «کش» داخل «سیم‌کش»
  //    نباید گروه کش‌مقاومتی را فعال کند و نتیجه را صفر کند).
  const presentGroups: Array<{ group: string[]; present: string[] }> = [];
  for (const group of SYNONYM_GROUPS) {
    const present = group.filter((phrase) => q.includes(phrase));
    if (present.length) presentGroups.push({ group, present });
  }
  const triggered: string[][] = [];
  for (const { group, present } of presentGroups) {
    const shadowed = present.every((p) =>
      presentGroups.some(
        ({ group: g2, present: present2 }) =>
          g2 !== group && present2.some((p2) => p2.length > p.length && p2.includes(p))
      )
    );
    if (!shadowed) triggered.push(group);
  }

  // ۲) توکن‌های آزاد: کلمه‌هایی که «هیچ» گروه فعالی پوشششان نمی‌دهد
  //    (برای مثال نام خاص یک حرکت: «آرنولد»، «گیلوتین»، «نوردیک»…)
  const covered = new Set<string>();
  for (const group of triggered) {
    for (const phrase of group) {
      if (q.includes(phrase)) {
        covered.add(phrase);
      }
    }
  }
  // v116 — توکن‌های آزاد از «cleaned» (بدون بخش پرانتزی) استخراج می‌شوند تا با q هم‌خوان بمانند
  const rawWords = foldDigitsAndCase(normalizePersianText(cleaned))
    .split(/[\s\u200C\-–—_,.،؛:!?؟()"«»\[\]]+/)
    .filter(Boolean);
  const freeTokens: string[] = [];
  for (const word of rawWords) {
    const squeezed = squeezeExerciseText(word);
    if (!squeezed || squeezed.length < 2) continue;
    if (STOPWORDS.has(squeezed)) continue;
    // اگر این توکن زیررشتهٔ/ابَررشتهٔ یک عبارتِ گروه فعال است → پوشش داده شده
    const isCovered = [...covered].some(
      (c) => c.includes(squeezed) || squeezed.includes(c)
    );
    if (!isCovered) freeTokens.push(squeezed);
  }

  // ۳) بررسی AND: هر مفهوم باید با «حداقل یکی» از مترادف‌هایش در حرکت باشد
  for (const group of triggered) {
    if (!group.some((phrase) => hay.includes(phrase))) return false;
  }
  for (const token of freeTokens) {
    if (!hay.includes(token)) return false;
  }

  // ۴) هیچ مفهوم/توکنی؟ (کل کوئری استاپ‌ورده بود) → fallback زیررشتهٔ کامل
  if (triggered.length === 0 && freeTokens.length === 0) {
    return hay.includes(q);
  }
  return true;
}

/** فیلتر یک لیست حرکت با کوئری جستجو (ترتیب ورودی حفظ می‌شود) */
export function filterExercisesBySearch<T extends ExerciseSearchable>(
  list: T[],
  rawQuery: string
): T[] {
  const q = rawQuery.trim();
  if (!q) return list;
  const filtered = list.filter((ex) => exerciseMatchesSearch(ex, q));
  // v116 — فالبک نام‌های بلند: «… با …» صفر نتیجه → حذف پسوند «با X» و تلاش دوباره
  if (filtered.length === 0) {
    const stripped = q.replace(/\s+با\s+\S+\s*$/u, "").trim();
    if (stripped && stripped !== q) {
      const retry = list.filter((ex) => exerciseMatchesSearch(ex, stripped));
      if (retry.length > 0) return retry;
    }
  }
  return filtered;
}

/**
 * v117 — تعداد «مفهوم‌های مشترک» دو نام از دید واژه‌نامهٔ مترادف‌ها.
 * «رنه‌گید رو» و «روئینگ رنگید دمبل (Renegade Row)» هر دو مفهوم renegade دارند
 * — برای امتیازدهی هم‌مفهومی در قفل بانک حرکات (exercise-bank-lock).
 */
export function countSharedSynonymConcepts(a: string, b: string): number {
  const qa = squeezeExerciseText(a);
  const qb = squeezeExerciseText(b);
  if (!qa || !qb) return 0;
  let count = 0;
  for (const group of SYNONYM_GROUPS) {
    if (group.some((p) => qa.includes(p)) && group.some((p) => qb.includes(p))) count++;
  }
  return count;
}
