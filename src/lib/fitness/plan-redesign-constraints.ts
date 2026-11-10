/**
 * ─────────────────────────────────────────────────────────────────────────
 * plan-redesign-constraints.ts (v149) — «ممنوعیت‌های صریح کاربر/مدیر»
 *
 * تیکت مالک (بزرگ‌ترین باگ بازطراحی): کاربر در چت با فیتاپ درخواست تغییر برنامه
 * داد و صریحاً گفت این حرکات داخل برنامه‌ام نباشند (بارفیکس، اسکات به پرس، شنا)
 * و عدس از تغذیه حذف شود. خلاصهٔ نسخهٔ جدید حتی «حذف حرکات آسیب‌زا (بارفیکس،
 * اسکات به پرس، شنا)» را ادعا می‌کرد — ولی برنامهٔ واقعی پر از همان حرکات بود!
 *
 * ریشه: درخواست ممنوعیت‌ها فقط به‌صورت متن آزاد در nutritionNotes می‌نشست
 * (با برچسب «یادداشت تغذیه‌ای» و سقف ۷۰/۳۰) و هیچ لایهٔ الزام و هیچ ممیزی
 * پس‌تولیدی وجود نداشت؛ مدل هم آزاد بود نادیده بگیرد.
 *
 * راه‌حل این ماژول (سه لایه — مکمل دیرکتیو split در plan-redesign-request):
 *   لایهٔ ۱ — استخراج: متن فارسی/محاورهٔ درخواست → RedesignConstraints
 *     {forbiddenMovements[], forbiddenFoods[], forbiddenSupplements[]} — با
 *     واژه‌نامهٔ قطعی + نگهبان نقیضه («حذف نشه» ≠ «حذف بشه»). v152: مکمل‌ها
 *     (کراتین، وی، امگا۳ و ...) هم پشتیبانی می‌شوند (تأیید مالک: «برنامه تغذیه
 *     و مکمل هم شامل تغییرات در چت با فیتاپ میشه»).
 *   لایهٔ ۲ — دیرکتیو: بلوک «⛔ ممنوعیت‌های قطعی» در بالاترین نقطهٔ پرامپت
 *     تمرین/تغذیه تزریق می‌شود (کنار دیرکتیو مدیر/بازطراحی).
 *   لایهٔ ۳ — ممیزی قطعی پس‌تولیدی: enforceWorkoutExclusions /
 *     enforceMealExclusions هر ردیف برنامهٔ تحویلی را با ممنوعیت‌ها می‌سنجد؛
 *     حرکت ممنوع → جایگزین هم‌عضلهٔ بانک (یا حذف)، غذا ممنوع → حذف از وعده.
 *     خروجی مدل هرگز بدون این ممیزی به کاربر نمی‌رسد.
 *
 * همهٔ توابع قطعی و بدون شبکه‌اند (تست‌پذیر)؛ غنی‌سازی با LLM جداگانه در ai.ts
 * انجام می‌شود و خروجی‌اش با همین توابع merge می‌گردد.
 *
 * v153 — جایگزین ممنوع‌ها هرگز تکراریِ همان‌روز نمی‌شود (تیکت مالک «دو تا شنا»):
 * قبلاً findReplacement فقط شناسه‌های مصرفی کل برنامه را می‌دید و ردیف‌های
 * بدون-exerciseId برایش نامرئی بودند — می‌توانست حرکتی بگذارد که «همان روز»
 * از قبل موجود است (یا هم‌خانوادهٔ آن). حالا نام فشرده + خانوادهٔ حرکتی هر روز
 * هم فیلتر می‌شود؛ فقط اگر فیلتر روزی هیچ کاندیدی نگذاشت، فال‌بک بدون فیلتر روز.
 * ─────────────────────────────────────────────────────────────────────────
 */

// v153 — کلید خانوادهٔ حرکتی/فشردن نام از قفل بانک (بدون وابستگی دوری)
import { exerciseFamilyKey, squeezeExerciseName } from "./exercise-bank-lock";

export interface RedesignConstraints {
  /** نام کانونی حرکات ممنوع (فارسی) — در پرامپت و ممیزی هر دو استفاده می‌شود */
  forbiddenMovements: string[];
  /** نام کانونی غذاهای ممنوع (فارسی) */
  forbiddenFoods: string[];
  /** نام کانونی مکمل‌های ممنوع (فارسی) — تأیید مالک: «برنامه تغذیه و مکمل هم شامل
   * تغییرات در چت با فیتاپ میشه» — استک مکمل بخشی از برنامهٔ غذایی است (v152). */
  forbiddenSupplements: string[];
}

/* ───────────────────────── نرمال‌سازی فارسی ───────────────────────── */

/**
 * نرمال‌سازی متن فارسی برای تطبیق مطمئن:
 * ی/ك عربی → فارسی، همزه → ا، نیم‌فاصله → فاصله، ارقام فارسی/عربی → لاتین،
 * حروف کوچک لاتین، فاصله‌های تکراری → تک‌فاصله.
 * هر دو سمت تطبیق (متن درخواست و نام حرکات برنامه) از همین تابع می‌گذرند تا
 * «اسکات به پرس» در «اسکات به پرس (Squat to Press)» قطعاً مچ شود.
 */
export function normalizeFaText(text: string): string {
  return (text || "")
    .replace(/[\u064A\u0649\u0649]/g, "\u06CC") // ي/ى → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // آ/أ/إ → ا
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/[\u0640]/g, "") // ـ کشیده حذف
    .replace(/\u200C/g, " ") // نیم‌فاصله → فاصله
    .replace(/[\u06F0-\u06F9]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d)))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ───────────────────────── واژه‌نامهٔ قطعی ───────────────────────── */

interface LexEntry {
  /** نام کانونی — همان چیزی که در دیرکتیو/ممیزی استفاده می‌شود */
  canonical: string;
  kind: "movement" | "food" | "supplement";
  /** واریانت‌های محاوره‌ای/انگلیسی — تطبیق واژه‌مرزی روی متن نرمال‌شده */
  keywords: string[];
}

/**
 * واژه‌نامهٔ حرکات/مواد پرتکرارِ درخواست حذف.
 * نکتهٔ ایمنی تطبیق: کلیدواژه فقط «همین عبارت» را می‌گیرد نه خانوادهٔ بزرگ‌تر —
 * «اسکات به پرس» هرگز اسکوات معمولی را ممنوع نمی‌کند؛ «پرس سینه هالتر» هرگز
 * پرس سینه دمبل را. اگر کاربر کل خانواده را خواست، خودش می‌گوید (پرس سینه).
 */
const LEXICON: LexEntry[] = [
  // ── حرکات ──
  { canonical: "بارفیکس", kind: "movement", keywords: ["بارفیکس", "بار فیکس", "پول اپ", "pull up", "pullup", "pull-up", "barfix", "بارفكس"] },
  { canonical: "شنا (پوش‌آپ)", kind: "movement", keywords: ["شنا", "پوش اپ", "push up", "pushup", "push-up", "شنای سوئدی", "شنا الماسی"] },
  { canonical: "اسکات به پرس", kind: "movement", keywords: ["اسکات به پرس", "اسکوات به پرس", "squat to press", "squat to overhead", "تراستر", "thruster"] },
  { canonical: "ددلیفت", kind: "movement", keywords: ["ددلیفت", "دد لیفط", "deadlift", "dead lift"] },
  { canonical: "دیپس پارالل", kind: "movement", keywords: ["دیپس", "پارالل", "dips", "dip"] },
  { canonical: "لانژ", kind: "movement", keywords: ["لانژ", "لانج", "lunge", "lunges"] },
  { canonical: "پرس سینه هالتر", kind: "movement", keywords: ["پرس سینه هالتر", "بنچ پرس", "bench press"] },
  { canonical: "پرس بالاسینه", kind: "movement", keywords: ["پرس بالاسینه", "پرس بالا سینه", "اینکلاین", "incline press"] },
  { canonical: "پرس زیرسینه", kind: "movement", keywords: ["پرس زیرسینه", "پرس زیر سینه", "دکلاین", "decline press"] },
  { canonical: "پرس سرشانه هالتر", kind: "movement", keywords: ["پرس سرشانه", "پرس سر شانه", "اورهید پرس", "overhead press", "میل پرس"] },
  { canonical: "اسکوات هالتر (پشت)", kind: "movement", keywords: ["اسکوات هالتر", "اسکوات پشت", "بک اسکوات", "back squat", "اسکات هالتر"] },
  { canonical: "اسکوات جلو", kind: "movement", keywords: ["اسکوات جلو", "اسکات جلو", "front squat"] },
  { canonical: "اسکوات بلغاری", kind: "movement", keywords: ["اسکوات بلغاری", "اسکات بلغاری", "بلغاری", "bulgarian", "bulgarian split squat"] },
  { canonical: "پرس پا", kind: "movement", keywords: ["پرس پا", "leg press", "هاک اسکوات", "هاک"] },
  { canonical: "روئینگ هالتر", kind: "movement", keywords: ["روئینگ هالتر", "رویینگ هالتر", "بارفیکس خم", "تی بار", "t-bar row"] },
  { canonical: "کرانچ/درازنشست", kind: "movement", keywords: ["دراز نشست", "درازنشست", "کرانچ", "sit up", "situp", "sit-up"] },
  { canonical: "پلانک", kind: "movement", keywords: ["پلانک", "plank"] },
  { canonical: "پروانه سیم‌کش (کراس‌اور)", kind: "movement", keywords: ["کراس اور", "کراساور", "crossover", "کراس اوور"] },
  { canonical: "ساق پا ایستاده", kind: "movement", keywords: ["ساق ایستاده", "ساق پا ایستاده", "کalf", "calf raise"] },
  // ── غذاها ──
  { canonical: "عدس", kind: "food", keywords: ["عدس"] },
  { canonical: "نخود", kind: "food", keywords: ["نخود"] },
  { canonical: "لوبیا", kind: "food", keywords: ["لوبیا"] },
  { canonical: "لپه", kind: "food", keywords: ["لپه"] },
  { canonical: "حبوبات (همه)", kind: "food", keywords: ["حبوبات", "حبوب"] },
  { canonical: "تخم‌مرغ", kind: "food", keywords: ["تخم مرغ", "تخممرغ", "تخم مرغ‌ها"] },
  { canonical: "شیر", kind: "food", keywords: ["شیر پرچرب", "شیر کامل", "شیر کم چرب", "شیر کمچرب"] },
  { canonical: "پنیر", kind: "food", keywords: ["پنیر"] },
  { canonical: "ماست", kind: "food", keywords: ["ماست"] },
  { canonical: "برنج سفید", kind: "food", keywords: ["برنج سفید", "برنج"] },
  { canonical: "نان", kind: "food", keywords: ["نان"] },
  { canonical: "ماهی", kind: "food", keywords: ["ماهی"] },
  { canonical: "مرغ", kind: "food", keywords: ["مرغ"] },
  { canonical: "گوشت قرمز", kind: "food", keywords: ["گوشت قرمز", "گوساله", "گوسفند", "قرمه", "قورمه"] },
  { canonical: "ماکارونی/پاستا", kind: "food", keywords: ["ماکارونی", "پاستا", "اسپاگتی", "لازانیا"] },
  { canonical: "سیب‌زمینی", kind: "food", keywords: ["سیب زمینی", "سیبزمینی"] },
  { canonical: "قند/شکر", kind: "food", keywords: ["قند", "شکر", "شکر سفید"] },
  // ── مکمل‌ها (v152 — تأیید مالک: برنامهٔ مکمل هم شامل تغییرات چت با فیتاپ است) ──
  // ایمنی تطبیق: کلیدواژهٔ تِک‌واژهٔ پرریسک («روی» حرف اضافه، «وی» ضمیر) فقط در
  // ترکیب بی‌خطر می‌آید («قرص روی»، «پروتئین وی»، «وی پروتئین») — مرز واژه‌ای
  // regex هم جلوی «ویتامین»/«دریافت» را می‌گیرد.
  { canonical: "کراتین", kind: "supplement", keywords: ["کراتین", "کریاتین", "کراتین مونوهیدرات", "کریاتین مونوهیدرات", "creatine"] },
  { canonical: "پروتئین وی", kind: "supplement", keywords: ["پروتئین وی", "وی پروتئین", "پروتئین پودری", "پودر پروتئین", "پروتئین گیاهی", "whey", "پروتئین وی ایزولیت"] },
  { canonical: "امگا۳", kind: "supplement", keywords: ["امگا", "امگا ۳", "امگا۳", "امگا 3", "امگا3", "omega", "fish oil", "روغن ماهی"] },
  { canonical: "ویتامین D", kind: "supplement", keywords: ["ویتامین د", "ویتامین دی", "ویتامین d", "vitamin d"] },
  { canonical: "مولتی‌ویتامین", kind: "supplement", keywords: ["مولتی ویتامین", "مولتیویتامین", "مولتی", "multivitamin"] },
  { canonical: "کافئین", kind: "supplement", keywords: ["کافئین", "کافیین", "caffeine"] },
  { canonical: "BCAA", kind: "supplement", keywords: ["bcaa", "بی سی ای"] },
  { canonical: "EAA", kind: "supplement", keywords: ["eaa"] },
  { canonical: "گلوتامین", kind: "supplement", keywords: ["گلوتامین", "glutamine"] },
  { canonical: "گینر", kind: "supplement", keywords: ["گینر", "gainer", "mass gainer"] },
  { canonical: "آشواگاندا", kind: "supplement", keywords: ["آشواگاندا", "اشواگاندا", "ashwagandha"] },
  { canonical: "منیزیم", kind: "supplement", keywords: ["منیزیم", "منیزیوم", "magnesium"] },
  { canonical: "زینک", kind: "supplement", keywords: ["زینک", "قرص روی", "zinc"] },
  { canonical: "پیش‌تمرین", kind: "supplement", keywords: ["پیش تمرین", "پیش‌تمرین", "پری ورکاوت", "پره ورکاوت", "pre workout", "preworkout"] },
  { canonical: "ال-کارنیتین", kind: "supplement", keywords: ["ال کارنیتین", "الکارنیتین", "کارنیتین", "l carnitine", "l-carnitine", "carnitine"] },
  { canonical: "ویتامین C", kind: "supplement", keywords: ["ویتامین ث", "ویتامین c", "vitamin c"] },
  { canonical: "ب کمپلکس", kind: "supplement", keywords: ["ب کمپلکس", "ویتامین ب", "b complex"] },
  { canonical: "کلاژن", kind: "supplement", keywords: ["کلاژن", "collagen"] },
  { canonical: "بتا آلانین", kind: "supplement", keywords: ["بتا آلانین", "beta alanine"] },
  { canonical: "سیترولین", kind: "supplement", keywords: ["سیترولین", "citrulline"] },
  { canonical: "آرژینین", kind: "supplement", keywords: ["آرژینین", "arginine"] },
  { canonical: "الکترولیت", kind: "supplement", keywords: ["الکترولیت", "electrolyte"] },
];

/** تطبیق واژه‌مرزی یک کلیدواژه روی متن نرمال‌شده (با پسوند‌های مجاز ی/ها) */
function containsKeyword(normalizedText: string, keyword: string): boolean {
  const re = keywordRegex(keyword);
  return re ? re.test(normalizedText) : false;
}

/**
 * regex واژه‌مرزی کلیدواژه:
 *  • لاتین: مرز [a-z0-9] + جمع اختیاری s/es
 *  • فارسی: مرز غیرحرفی + پسوند اضافه مجاز (ی/ها/های/هایی) — «شنای سوئدی» ← «شنا»
 *    (ترتیب پسوندها طولانی→کوتاه تا regex درست بخورد)
 */
function keywordRegex(keyword: string): RegExp | null {
  const norm = normalizeFaText(keyword);
  if (!norm) return null;
  const esc = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[a-z0-9]/.test(norm)) {
    return new RegExp(`(^|[^a-z0-9])${esc}(?:s|es)?($|[^a-z0-9])`, "i");
  }
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?:هایی|های|ها|ی)?($|[^\\p{L}\\p{N}])`, "u");
}

/** نام (حرکت/غذا) با فهرست کلیدواژه‌ها مچ می‌شود؟ — کلیدواژهٔ مچ‌شده برمی‌گردد */
export function matchesForbiddenName(name: string, keywords: string[]): string | null {
  if (!name || keywords.length === 0) return null;
  const n = normalizeFaText(name);
  for (const k of keywords) {
    if (containsKeyword(n, k)) return k;
  }
  return null;
}

/* ─── v158 — خانواده‌های حرکات (دستور مالک: ممنوعیت = کل خانواده) ───
 * تیکت مالک: «حواست باشه وقتی حرکات ممنوعه مثلاً مثل اسکات ثبت میشه تمام گروه
 * اسکات باید ممنوع بشه و کلمات خانواده مثل اسکوات هم؛ اینجوری نباشه که یکی
 * بنویسه بارفیکس، فقط بارفیکس دست جمع حذف بشه و بارفیکس دست باز بیاد.»
 *
 * قانون تطبیق: وقتی ممنوع‌شده با هر عضوی از یک خانواده مچ شود، «کل» خانواده
 * (همهٔ واریانت‌های املایی/ترجمه‌ای/تجهیزی) ممنوع است — حرکتی با نام انگلیسی
 * در بانک هم از زیر ممیزی در نمی‌رود. فلسفهٔ قدیمی «کلیدواژه فقط همین عبارت»
 * باطل شد — امنیت آسیب مقدم بر جزئی‌نگری است. */
const MOVEMENT_FAMILY_GROUPS: string[][] = [
  // خانوادهٔ اسکوات/اسکات (هر املایی و هر واریانتی)
  ["اسکوات", "اسکات", "سکوات", "اسکوات پشت", "اسکوات جلو", "اسکوات بلغاری", "اسکات به پرس", "هاک اسکوات", "گابلت", "back squat", "front squat", "bulgarian", "squat", "hack squat", "goblet squat", "split squat"],
  // خانوادهٔ بارفیکس/پول‌آپ (همهٔ گریپ‌ها)
  ["بارفیکس", "بار فیکس", "بارفكس", "پول اپ", "پول‌اپ", "چین اپ", "chin up", "pull up", "pullup", "بارفیکس دست باز", "بارفیکس دست جمع", "بارفیکس خم"],
  // خانوادهٔ پارالل/دیپس
  ["پارالل", "دیپس", "dips", "پاراللت", "پارالل قفسه"],
  // خانوادهٔ شنا/پوش‌آپ (سوئدی، الماسی، دست‌جمع و ...)
  ["شنا", "شنای سوئدی", "شنا الماسی", "شنا سوئدی", "شنا روی دست", "پوش اپ", "پوش‌اپ", "push up", "pushup"],
  // خانوادهٔ پرس سینه/بنچ (بالاسینه/زیرسینه هم‌خانواده‌اند؛ پرس سرشانه/پرس پا جدا هستند)
  ["پرس سینه", "بنچ پرس", "پرس بالاسینه", "پرس بالا سینه", "اینکلاین", "پرس زیرسینه", "پرس زیر سینه", "دکلاین", "bench press", "incline press", "decline press", "پروانه"],
  // خانوادهٔ ددلیفت (رومانیایی و ...)
  ["ددلیفت", "دد لیفط", "ددلیفت رومانیایی", "رومانیایی", "deadlift", "romanian deadlift", "رومانیایی"],
  // خانوادهٔ پرس سرشانه
  ["پرس سرشانه", "پرس سر شانه", "اورهید پرس", "اورهد", "میل پرس", "overhead press", "shoulder press", "آرنولد پرس"],
  // خانوادهٔ لانژ/جلوپا
  ["لانژ", "لانج", "جلو پا", "جلوبا", "lunge"],
  // خانوادهٔ پرس پا/هاک
  ["پرس پا", "هاک", "leg press", "هاک اسکوات"],
  // خانوادهٔ کرانچ/درازنشست
  ["کرانچ", "درازنشست", "دراز نشست", "sit up", "situp", "کرانچ سیم‌کش"],
];

/**
 * v158 — الگوهای ممنوعیت یک قلم: خودِ قلم + کل خانواده‌اش (اگر به خانواده‌ای بخورد).
 * خروجی: فهرست الگوهای نرمال‌شده برای matchesForbiddenName.
 */
export function expandMovementPatterns(term: string): string[] {
  const nt = normalizeFaText(term);
  if (!nt) return [];
  const patterns = new Set<string>([nt]);
  for (const group of MOVEMENT_FAMILY_GROUPS) {
    const hit = group.some((alias) => {
      const na = normalizeFaText(alias);
      if (!na) return false;
      // دوسویه: قلم داخل عضو خانواده (بارفیکس ⊂ بارفیکس دست باز) یا عضو داخل قلم
      return containsKeyword(nt, na) || containsKeyword(na, nt);
    });
    if (hit) {
      for (const alias of group) {
        const na = normalizeFaText(alias);
        if (na) patterns.add(na);
      }
      break; // یک خانواده کافی است — اولین تطبیقِ معنادار
    }
  }
 return [...patterns];
}

/** توضیح فارسی خانوادهٔ یک قلم برای دیرکتیو پرامپت (null = خانوادهٔ ثبت‌شده ندارد) */
export function describeFamilyFa(term: string): string | null {
  const nt = normalizeFaText(term);
  if (!nt) return null;
  for (const group of MOVEMENT_FAMILY_GROUPS) {
    const hit = group.some((alias) => {
      const na = normalizeFaText(alias);
      return na ? containsKeyword(nt, na) || containsKeyword(na, nt) : false;
    });
    if (hit) {
      const fa = group
        .filter((a) => !/^[a-z0-9\- ]+$/i.test(a))
        .slice(0, 6)
        .join("، ");
      return `کل خانوادهٔ «${term}» یعنی: ${fa} (و همهٔ نام‌های دیگر همان حرکت، فارسی یا انگلیسی)`;
    }
  }
  return null;
}

/* ───────────────────────── نگهبان نقیضه (v152 — بازنویسی معنایی) ───────────────────────── */

/**
 * فقط «نفیِ فعلِ حذف» یعنی کاربر می‌خواهد «بماند» — ممنوع نکن.
 * ⚠️ رفع باگ معنایی v149 (تست v152 لو داد): «نخورم / مصرف نکنم / نباشه / نذار /
 * نمی‌خوام بخورم» فی‌نفسه «درخواست حذف» هستند نه نفیِ حذف! اگر همهٔ منفی‌ها
 * نگهبان می‌شدند، عین درخواست کاربر («عدس نخورم»، «کراتین و امگا۳ مصرف نکنم»،
 * «اسکات به پرس نباشه») بی‌صدا دور ریخته می‌شد — همان کلاس باگی که مالک تیکت کرد.
 *
 * نگهبان درست فقط این‌ها را «ماندنی» می‌داند:
 *   «حذف نشه/نکن/نمی‌کنم/نشد»، «خارج نشه»، «پاک نشه»، «برداشته نشه»،
 *   «کنار نذار»، «بمونه/بمانه/بماند»، «نمی‌خوام حذف شه».
 * پنجرهٔ کوتاه بعد از کلیدواژه بررسی می‌شود (۱۸ نویسه تا «نمی‌خوام حذف شه» بگیرد).
 */
function isNegatedAfter(normalizedText: string, matchStart: number, matchEnd: number): boolean {
  void matchStart;
  const window = normalizedText.slice(matchEnd, matchEnd + 18);
  return /(?:حذف\s*ن|خارج\s*ن|پاک\s*ن|برداشته?\s*ن|کنار\s*نذار|بمونه|بمانه|بماند|نمی\s*خوا\S{0,4}\s*حذف)/.test(window);
}

/* ───────────────────────── استخراج از متن ───────────────────────── */

/**
 * v157 — گارد «نیت حذف» (ریشه‌یابی تیکت مالک ۰۶/۰۷ — مصطفی خوشبخت):
 *
 * باگ کشف‌شده در ممیزی مو‌به‌مو: پارسر قبلی «هر» کلیدواژهٔ لغت‌نامه را در هر
 * متنی ممنوع می‌کرد — حتی وقتی کاربر فقط «دربارهٔ» حرکت حرف می‌زد:
 *   • «به جای بارفیکس چی برم؟» → بارفیکس ممنوع! (کاربر دنبال جایگزین بود، نه حذف)
 *   • «شنا خوبه یا بارفیکس؟» → هر دو ممنوع! (مقایسه، نه درخواست حذف)
 * این یعنی یک سؤال ساده می‌توانست حرکتی را برای همیشه از برنامهٔ کاربر حذف کند.
 *
 * قانون جدید: استخراج ممنوعیت فقط وقتی معتبر است که متن، «فعل/نشانهٔ حذف» صریح
 * داشته باشد (حذف، کنسل، نباشه، نذار، بردار، نمی‌خوام، بدون، جایگزین‌شدن و ...).
 * متن سؤالی/توصیفی بدون هیچ نشانهٔ حذف → null (هیچ چیز ممنوع نمی‌شود).
 * لایهٔ LLM (extractRedesignConstraintsLLM) همچنان معنای متن‌های بدون فعل صریح
 * را در مسیرهای بازطراحی/اصول مدیر می‌گیرد — پس پوشش کامل حفظ می‌شود.
 */
const REMOVAL_INTENT_RE =
  /(?:حذف|پاک|بردار|برداشته|برداشتن|کنسل|خارج\s*ش|ممنوع|بنداز|نمی\s*خوا|نخور|نکش|مصرف\s*نکن|استفاده\s*نکن|نباش|نیست\s*توی|نذار|نگذار|کنار\s*گذاش|کنار\s*بذار|بدون|جایگزین|تعویض|سریشن)/;

export function hasRemovalIntent(normalizedText: string): boolean {
  if (!normalizedText) return false;
  return REMOVAL_INTENT_RE.test(normalizedText);
}

/**
 * استخراج قطعی ممنوعیت‌ها از متن فارسی/محاورهٔ درخواست (چت کاربر یا اصول مدیر).
 * خروجی null = هیچ ممنوعیت صریحی پیدا نشد (رفتار عادی).
 * v157 — فقط متنی که نشانهٔ حذف دارد ممنوعیت تولید می‌کند (گارد نیت حذف).
 */
export function parseRedesignConstraintsFromText(
  ...texts: Array<string | null | undefined>
): RedesignConstraints | null {
  const combined = texts.filter((t): t is string => typeof t === "string" && t.trim().length > 0).join("\n");
  if (!combined || combined.length < 3) return null;
  const text = normalizeFaText(combined);

  // v157 — گارد نیت حذف: بدون نشانهٔ حذف صریح، هیچ ممنوعیتی استخراج نمی‌شود
  // (سؤال «به جای بارفیکس چی برم» دیگر بارفیکس را ممنوع نمی‌کند)
  if (!hasRemovalIntent(text)) return null;

  const movements = new Set<string>();
  const foods = new Set<string>();
  const supplements = new Set<string>();

  for (const entry of LEXICON) {
    for (const kw of entry.keywords) {
      const re = keywordRegex(kw);
      if (!re) continue;
      const m = re.exec(text);
      if (!m) continue;
      const matchEnd = m.index + m[0].length;
      if (!isNegatedAfter(text, m.index, matchEnd)) {
        const bucket = entry.kind === "movement" ? movements : entry.kind === "food" ? foods : supplements;
        bucket.add(entry.canonical);
        break; // همین entry تأیید شد — کلیدواژه‌های بعدی‌اش لازم نیست
      }
    }
  }

  // v158 — استخراج خانواده‌محور: اگر کاربر/مدیر ریشهٔ یک خانواده را نوشت
  // («اسکوات رو حذف کن» بدون اشاره به هالتر/جلو/پشت)، کل خانواده ثبت می‌شود
  for (const group of MOVEMENT_FAMILY_GROUPS) {
    const root = group.find((a) => !/^[a-z0-9\- ]+$/i.test(a)); // نمایندهٔ فارسی
    if (!root) continue;
    for (const alias of group) {
      const re = keywordRegex(alias);
      if (!re) continue;
      const m = re.exec(text);
      if (!m) continue;
      const matchEnd = m.index + m[0].length;
      if (!isNegatedAfter(text, m.index, matchEnd)) {
        movements.add(root);
        break;
      }
    }
  }

  if (movements.size === 0 && foods.size === 0 && supplements.size === 0) return null;
  return {
    forbiddenMovements: [...movements],
    forbiddenFoods: [...foods],
    forbiddenSupplements: [...supplements],
  };
}

/* ───────────────────────── ادغام / اعتبارسنجی ───────────────────────── */

/** ادغام دو مجموعهٔ ممنوعیت (لیکسیکون قطعی + استخراج LLM) */
export function mergeConstraints(
  a: RedesignConstraints | null | undefined,
  b: RedesignConstraints | null | undefined
): RedesignConstraints | null {
  if (!a && !b) return null;
  const mv = new Set<string>([...(a?.forbiddenMovements ?? []), ...(b?.forbiddenMovements ?? [])]);
  const fd = new Set<string>([...(a?.forbiddenFoods ?? []), ...(b?.forbiddenFoods ?? [])]);
  const sp = new Set<string>([...(a?.forbiddenSupplements ?? []), ...(b?.forbiddenSupplements ?? [])]);
  if (mv.size === 0 && fd.size === 0 && sp.size === 0) return null;
  return { forbiddenMovements: [...mv], forbiddenFoods: [...fd], forbiddenSupplements: [...sp] };
}

/** اعتبارسنجی JSON خام (از DB/LLM) به RedesignConstraints امن — هرگز throw نمی‌کند */
export function sanitizeConstraints(raw: unknown): RedesignConstraints | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const pick = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x ?? "").trim()).filter((s) => s.length > 0 && s.length <= 60).slice(0, 24)
      : [];
  const movements = pick(obj.forbiddenMovements);
  const foods = pick(obj.forbiddenFoods);
  const supplements = pick(obj.forbiddenSupplements);
  // سازگاری رو به عقب: LLM قدیمی شاید مکمل را داخل forbiddenFoods ریخته باشد —
  // مکمل‌های شناخته‌شدهٔ داخل foods به supplements منتقل می‌شوند (v152).
  const knownSupps = new Set(LEXICON.filter((e) => e.kind === "supplement").map((e) => e.canonical));
  const movedSupps = foods.filter((f) => knownSupps.has(f));
  const foodsOnly = foods.filter((f) => !knownSupps.has(f));
  const suppsAll = [...new Set([...supplements, ...movedSupps])];
  if (movements.length === 0 && foodsOnly.length === 0 && suppsAll.length === 0) return null;
  return { forbiddenMovements: movements, forbiddenFoods: foodsOnly, forbiddenSupplements: suppsAll };
}

/* ───────────────────────── دیرکتیوهای پرامپت ───────────────────────── */

/** بلوک ممنوعیت حرکات — بالاترین اولویت پرامپت تمرین، کنار دیرکتیو مدیر/بازطراحی */
export function buildMovementExclusionDirectiveFa(
  c: RedesignConstraints,
  raw?: string | null,
  changeSummary?: string | null
): string {
  if (c.forbiddenMovements.length === 0) return "";
  const list = c.forbiddenMovements.map((m) => `«${m}»`).join("، ");
  // v158 — شرح خانوادهٔ هر ممنوعیت (دستور مالک: ممنوعیت = کل خانواده)
  const families = c.forbiddenMovements
    .map((m) => describeFamilyFa(m))
    .filter(Boolean)
    .slice(0, 8)
    .map((d) => `   • ${d}`)
    .join("\n");
  return [
    `⛔⛔ ممنوعیت‌های قطعی حرکات (الزامی — نقض آن یعنی برنامهٔ باطل):`,
    `کاربر/مدیر صریحاً خواسته این حرکات در برنامهٔ جدید «به هیچ وجه» نباشند: ${list}.`,
    families ? `• شرح خانواده‌های ممنوع (هر عضو خانواده با هر نامی هم به‌یک‌انداز ممنوع است):\n${families}` : "",
    `• هیچ حرکتی از فهرست بالا — و هیچ واریانت مستقیمش (هم‌نام، هم‌تجهیز، هم‌الگو) — نباید در هیچ روزی بیاید؛ نه حرکت اصلی، نه سوپرست، نه جایگزین (substitution)، نه در گرم‌کردن/سردکردن.`,
    `• اگر دلیل حذف (آسیب کمر/مچ/زانو و ...) در متن آمده، حرکت جایگزین باید آن مفصل را هم ایمن بگذارد و دلیل ایمن‌بودنش در tips حرکت نوشته شود.`,
    `• اگر حرکتی شبیه فهرست بالا در «کتابخانهٔ مجاز» دیدی که واریانت ممنوع است، آن را انتخاب نکن.`,
    `• در فیلد notes یک خط «⛔ ممنوعیت‌های رعایت‌شده» با فهرست همان چیزهایی که حذف کردی بنویس.`,
    raw ? `• متن صریح کاربر/مدیر: «${String(raw).slice(0, 400)}»` : "",
    changeSummary ? `• خلاصهٔ تغییرات توافق‌شده: ${changeSummary.slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** بلوک ممنوعیت مکمل‌ها (v152) — پرامپت تغذیه (استک مکمل بخشی از JSON غذایی است) */
export function buildSupplementExclusionDirectiveFa(c: RedesignConstraints, raw?: string | null): string {
  if (c.forbiddenSupplements.length === 0) return "";
  const list = c.forbiddenSupplements.map((s) => `«${s}»`).join("، ");
  return [
    `⛔⛔ ممنوعیت‌های قطعی مکمل (الزامی — نقض آن یعنی برنامهٔ باطل):`,
    `کاربر/مدیر صریحاً خواسته این مکمل‌ها در برنامه «به هیچ وجه» تجویز نشوند: ${list}.`,
    `• بخش‌های «supplements» و «supplementStack» هر دو خالی از فهرست بالا باشند — هیچ واریانتی (هم‌نام، برند دیگر، فرم دیگر مثل کپسول/پودر) هم نباید بیاید.`,
    `• جایگزینی مکمل ممنوع فقط با «راه غذایی» یا مکملِ غیرممنوعِ هم‌نقش؛ دلیل حذف در note هر آیتم باقی‌مانده مرتبط نوشته شود.`,
    raw ? `• متن صریح کاربر/مدیر: «${String(raw).slice(0, 300)}»` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** بلوک ممنوعیت غذاها — پرامپت تغذیه */
export function buildFoodExclusionDirectiveFa(c: RedesignConstraints, raw?: string | null): string {
  if (c.forbiddenFoods.length === 0) return "";
  const list = c.forbiddenFoods.map((f) => `«${f}»`).join("، ");
  return [
    `⛔⛔ ممنوعیت‌های قطعی تغذیه (الزامی — نقض آن یعنی برنامهٔ باطل):`,
    `کاربر/مدیر صریحاً خواسته این موارد در برنامهٔ غذایی «به هیچ وجه» نباشند: ${list}.`,
    `• هیچ آیتمی از فهرست بالا — و هیچ غذای شامل آن — نباید در هیچ وعده‌ای بیاید؛ نه آیتم اصلی، نه جایگزین (alternatives)، نه نمونه‌های dietAlternatives.`,
    `• کالری/درشت‌مغذی جایگزین‌شده باید با غذای هم‌نقش (پروتئین با پروتئین، کربوهیدرات با کربوهیدرات) پر شود تا جمع روزانه به هدف بخورد.`,
    raw ? `• متن صریح کاربر/مدیر: «${String(raw).slice(0, 300)}»` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ───────────────────────── ممیزی قطعی پس‌تولیدی ───────────────────────── */

export interface WorkoutExclusionReport {
  /** نام‌هایی که واقعاً از برنامه حذف/جایگزین شدند */
  removed: Array<{ day: string; from: string; to?: string }>;
  /** کلیدواژه‌های هنوز مانده بعد از ممیزی (لاگ هشدار) */
  leftover: string[];
}

/**
 * لایهٔ ۳ تمرین — هر روز را می‌گردد؛ حرکت ممنوع را حذف می‌کند و اگر بانک
 * بدهد، جایگزین هم‌عضلهٔ ویدیودار می‌گذارد (ست/تکرار/ریزور ورزشکار حفظ می‌شود).
 * گرم‌کردن/سردکردن و فیلد substitution هم پاک می‌شوند.
 * بدون بانک: فقط حذف + ثبت گزارش.
 */
export function enforceWorkoutExclusions(
  parsed: { days?: Array<Record<string, any>>; notes?: string; [k: string]: any },
  constraints: RedesignConstraints | null | undefined,
  bank?: { all: Array<Record<string, any>> } | null
): WorkoutExclusionReport {
  const report: WorkoutExclusionReport = { removed: [], leftover: [] };
  if (!constraints || !parsed || !Array.isArray(parsed.days)) return report;
  const movements = constraints.forbiddenMovements;
  if (movements.length === 0) return report;

  // v158 — کلیدواژه‌های قابل‌تطبیق: خانواده‌محور (خود قلم + کل خانواده‌اش +
  // واریانت‌های لغت‌نامهٔ همان کانونی) — دستور مالک: «تمام گروه اسکات ممنوع بشه»
  const keywords = new Set<string>();
  for (const canonical of movements) {
    for (const p of expandMovementPatterns(canonical)) keywords.add(p);
    const entry = LEXICON.find((e) => e.canonical === canonical);
    for (const kw of entry?.keywords ?? []) keywords.add(normalizeFaText(kw));
  }
  const keywordList = [...keywords];

  const usedIds = new Set<string>();
  // شناسه‌های مصرفی برنامه (تا جایگزین تکراری نیاید) — توجه: ردیف‌های خود بانک
  // اینجا اضافه نمی‌شوند وگرنه هیچ کاندید جایگزینی باقی نمی‌ماند (باگ تست T7)
  for (const day of parsed.days) {
    for (const ex of (day?.exercises ?? []) as any[]) {
      if (typeof ex?.exerciseId === "string") usedIds.add(ex.exerciseId);
    }
  }

  const findReplacement = (
    removedEx: Record<string, any>,
    dayNames?: Set<string>,
    dayFams?: Set<string>
  ): Record<string, any> | null => {
    if (!bank || !Array.isArray(bank.all) || bank.all.length === 0) return null;
    const removedGroups = coveredGroupsOf(removedEx);
    const removedCat = String(removedEx?.category ?? "");
    const searchPool = (withDayFilter: boolean): Array<Record<string, any>> =>
      (bank.all as Array<Record<string, any>>).filter((row) => {
        if (typeof row?.id !== "string" || usedIds.has(row.id)) return false;
        if (matchesForbiddenName(String(row?.name ?? ""), keywordList)) return false;
        // v153 — کاندید نباید هم‌نام/هم‌خانوادهٔ حرکات موجودِ همین روز باشد
        if (withDayFilter && dayNames && dayFams) {
          if (dayNames.has(squeezeExerciseName(String(row?.name ?? "")))) return false;
          if (dayFams.has(exerciseFamilyKey(String(row?.name ?? ""), row?.muscle))) return false;
        }
        const g = coveredGroupsOf(row);
        return removedGroups.some((rg) => g.includes(rg));
      });
    let candidates = searchPool(true);
    if (candidates.length === 0) candidates = searchPool(false); // فال‌بک امن
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aCat = String(a?.category ?? "") === removedCat ? 0 : 1;
      const bCat = String(b?.category ?? "") === removedCat ? 0 : 1;
      return aCat - bCat;
    });
    return candidates[0];
  };

  const cleanedDays: Array<Record<string, any>> = [];
  for (const day of parsed.days) {
    const dayName = String(day?.day ?? "؟");
    const exs = Array.isArray(day?.exercises) ? day.exercises : [];

    // v153 — نام فشرده + خانوادهٔ حرکتی موجودِ همین روز (برای ضدتکرار جایگزین)
    const dayNames = new Set<string>();
    const dayFams = new Set<string>();
    for (const ex of exs) {
      if (!ex || typeof ex.name !== "string" || !ex.name.trim()) continue;
      dayNames.add(squeezeExerciseName(ex.name));
      dayFams.add(exerciseFamilyKey(ex.name, ex.muscle));
    }

    // شمارش گروه‌های سوپرست برای پاکسازی اعضای یتیم بعد از حذف
    const groupCounts = new Map<string, number>();
    for (const ex of exs) {
      if (ex && typeof ex.supersetGroup === "string" && ex.supersetGroup) {
        groupCounts.set(ex.supersetGroup, (groupCounts.get(ex.supersetGroup) || 0) + 1);
      }
    }

    const kept: Array<Record<string, any>> = [];
    for (const ex of exs) {
      if (!ex || typeof ex !== "object") { kept.push(ex); continue; }
      const name = String(ex.name ?? "");
      const hit = matchesForbiddenName(name, keywordList);
      if (hit) {
        const repl = findReplacement(ex, dayNames, dayFams);
        if (repl) {
          usedIds.add(String(repl.id));
          dayNames.add(squeezeExerciseName(String(repl.name))); // v153
          dayFams.add(exerciseFamilyKey(String(repl.name), repl.muscle)); // v153
          kept.push({
            ...ex,
            name: String(repl.name),
            muscle: String(repl.muscle ?? ex.muscle ?? ""),
            category: String(repl.category ?? ex.category ?? ""),
            description: String(repl.description ?? "حرکت را با کنترل کامل و دامنهٔ کامل اجرا کن."),
            tips: String(repl.tips ?? "فرم صحیح و تنفس منظم را حفظ کن."),
            exerciseId: String(repl.id),
            // substitution قبلی ممکن است خودش ممنوع باشد — پاک می‌شود
            substitution: undefined,
            coachTip: "این جایگزین ایمن طبق درخواست صریح خودت انتخاب شد — همان الگوی عضلانی قبلی را پوشش می‌دهد.",
          });
          report.removed.push({ day: dayName, from: name, to: String(repl.name) });
        } else {
          report.removed.push({ day: dayName, from: name });
        }
        continue;
      }
      // substitution ممنوع؟
      if (typeof ex.substitution === "string" && matchesForbiddenName(ex.substitution, keywordList)) {
        ex.substitution = undefined;
      }
      kept.push(ex);
    }

    // سوپرست‌های یتیم (بعد از حذف/جایگزین)
    const counts2 = new Map<string, number>();
    for (const ex of kept) {
      if (ex && typeof ex.supersetGroup === "string" && ex.supersetGroup) {
        counts2.set(ex.supersetGroup, (counts2.get(ex.supersetGroup) || 0) + 1);
      }
    }
    for (const ex of kept) {
      if (ex && ex.supersetGroup && (counts2.get(ex.supersetGroup) || 0) < 2) {
        delete ex.supersetGroup;
        delete ex.supersetType;
      }
    }
    day.exercises = kept;

    // گرم‌کردن/سردکردن ممنوع‌نام‌ها
    for (const key of ["warmup", "cooldown"]) {
      const arr = day?.[key];
      if (!Array.isArray(arr)) continue;
      const filtered = arr.filter((w: any) => {
        if (!w || typeof w !== "object") return true;
        const hit = matchesForbiddenName(String(w.name ?? ""), keywordList);
        if (hit) report.removed.push({ day: dayName, from: String(w.name) });
        return !hit;
      });
      day[key] = filtered;
    }
    cleanedDays.push(day);
  }

  // ممیزی نهایی — هرچه مانده لاگ می‌شود (باید تهی باشد)
  for (const day of parsed.days) {
    for (const ex of (day?.exercises ?? []) as any[]) {
      const name = String(ex?.name ?? "");
      const hit = matchesForbiddenName(name, keywordList);
      if (hit) {
        report.leftover.push(`${day?.day ?? "؟"}:${name}`);
      }
    }
  }

  // شفافیت برای کاربر — دقیق: کدام جایگزین شد، کدام فقط حذف شد
  if (report.removed.length > 0) {
    const replaced = report.removed.filter((r) => r.to);
    const justRemoved = report.removed.filter((r) => !r.to);
    const parts: string[] = [];
    if (replaced.length > 0) {
      parts.push(`جایگزین ایمن هم‌عضله گرفتند: ${replaced.slice(0, 10).map((r) => `«${r.from}» → «${r.to}»`).join("؛ ")}`);
    }
    if (justRemoved.length > 0) {
      parts.push(`بدون جایگزین حذف شدند: ${[...new Set(justRemoved.map((r) => `«${r.from}»`))].slice(0, 10).join("، ")}`);
    }
    const noteLine = `- ⛔ طبق درخواست صریح شما: ${parts.join(" — ")}.`;
    parsed.notes = parsed.notes ? `${parsed.notes}\n${noteLine}` : noteLine;
  }
  return report;
}

/** گروه‌های اصلی یک ردیف بانک/حرکت — بدون ایمپورت دوری از exercise-bank-lock */
function coveredGroupsOf(ex: Record<string, any>): string[] {
  const groups = new Set<string>();
  const muscle = String(ex?.muscle ?? "");
  const cat = String(ex?.category ?? "");
  const name = String(ex?.name ?? "");
  const hay = `${muscle} ${cat} ${name}`;
  const map: Array<[RegExp, string]> = [
    [/چهارسر|سرینی|همسترینگ|باسن|ساق|پا|leg|quad|hamstring|glute|calf/i, "legs"],
    [/سینه|chest|pec/i, "chest"],
    [/زیربغل|پشت|لات|back|lat|row/i, "back"],
    [/سرشانه|دلت|shoulder|delt/i, "shoulders"],
    [/بازو|جلو بازو|پشت بازو|ترایسپس|بایسپس|arm|bicep|tricep/i, "arms"],
    [/شکم|مرکز بدن|کرانچ|پلانک|core|ab/i, "core"],
    // v149 — نام حرکت بدون فیلد muscle (خروجی خام AI) — از الگوی خودِ حرکت:
    [/بارفیکس|پول اپ|pull[- ]?up/i, "back"],
    [/شنا|پوش اپ|push[- ]?up/i, "chest"],
    [/دیپس|پارالل|dips?/i, "chest"],
    [/اسکوات|اسکات|squat|لانژ|لانج|lunge/i, "legs"],
    [/ددلیفت|deadlift/i, "back"],
  ];
  for (const [re, g] of map) {
    if (re.test(hay)) groups.add(g);
  }
  return [...groups];
}

export interface MealExclusionReport {
  removed: Array<{ meal: string; from: string }>;
}

/**
 * لایهٔ ۳ تغذیه — آیتم‌های ممنوع را از meals/alternatives/dietAlternatives حذف
 * می‌کند. قبل از محاسبهٔ جمع‌ها صدا زده می‌شود تا کالری/درشت‌مغذی درست بماند.
 * v152 — استک مکمل (supplements + supplementStack) هم ممیزی می‌شود (تأیید مالک:
 * «برنامه تغذیه و مکمل هم شامل تغییرات در چت با فیتاپ میشه»). اکوی مکمل به
 * برنامهٔ تمرینی (program-generation) از JSONِ همین‌جا کپی می‌شود، پس با پاکسازی
 * همین‌جا اکو هم خودکار تمیز می‌ماند.
 */
export function enforceMealExclusions(
  parsed: { meals?: Array<Record<string, any>>; dietAlternatives?: Array<Record<string, any>>; notes?: string; [k: string]: any },
  constraints: RedesignConstraints | null | undefined
): MealExclusionReport {
  const report: MealExclusionReport = { removed: [] };
  if (!constraints || !parsed || !Array.isArray(parsed.meals)) return report;
  const foods = constraints.forbiddenFoods;
  // v152 — ممنوعیت «فقط مکمل» (بدون غذا) نباید اینجا early-return شود؛
  // استک مکمل پایین‌تر جداگانه ممیزی می‌شود.
  if (foods.length === 0 && (constraints.forbiddenSupplements ?? []).length === 0) return report;

  const keywords = new Set<string>();
  for (const canonical of foods) {
    keywords.add(normalizeFaText(canonical));
    const entry = LEXICON.find((e) => e.canonical === canonical);
    for (const kw of entry?.keywords ?? []) keywords.add(normalizeFaText(kw));
  }
  const keywordList = [...keywords];
  // v152 — اگر فقط مکمل ممنوع است، غذاهای برنامه دست‌نخورده می‌مانند (keywordList خالی = فیلتر غذا اجرا نمی‌شود)

  // ─── v152 — ممیزی استک مکمل (supplements + supplementStack) ───
  const suppKeywords = new Set<string>();
  for (const canonical of constraints.forbiddenSupplements ?? []) {
    suppKeywords.add(normalizeFaText(canonical));
    const entry = LEXICON.find((e) => e.canonical === canonical);
    for (const kw of entry?.keywords ?? []) suppKeywords.add(normalizeFaText(kw));
  }
  const suppKeywordList = [...suppKeywords];
  if (keywordList.length === 0 && suppKeywordList.length === 0) return report;
  if (suppKeywordList.length > 0) {
    const filterSuppList = (arr: unknown, label: string): unknown => {
      if (!Array.isArray(arr)) return arr;
      const kept = (arr as Array<Record<string, any>>).filter((s: any) => {
        if (!s || typeof s !== "object") return true;
        const hit = matchesForbiddenName(String(s.name ?? ""), suppKeywordList);
        if (hit) report.removed.push({ meal: label, from: String(s.name ?? "") });
        return !hit;
      });
      return kept;
    };
    if (Array.isArray(parsed.supplements) && parsed.supplements.length > 0) {
      parsed.supplements = filterSuppList(parsed.supplements, "مکمل") as any;
      if (Array.isArray(parsed.supplements) && parsed.supplements.length === 0) parsed.supplements = undefined;
    }
    if (Array.isArray(parsed.supplementStack) && parsed.supplementStack.length > 0) {
      parsed.supplementStack = filterSuppList(parsed.supplementStack, "استک مکمل") as any;
      if (Array.isArray(parsed.supplementStack) && parsed.supplementStack.length === 0) parsed.supplementStack = undefined;
    }
  }

  for (const meal of parsed.meals) {
    const mealLabel = String(meal?.type ?? meal?.label ?? "وعده");
    if (Array.isArray(meal?.items)) {
      meal.items = (meal.items as Array<Record<string, any>>).filter((it: any) => {
        const hit = matchesForbiddenName(String(it?.name ?? ""), keywordList);
        if (hit) report.removed.push({ meal: mealLabel, from: String(it?.name ?? "") });
        return !hit;
      });
    }
    if (Array.isArray(meal?.alternatives)) {
      for (const alt of meal.alternatives as Array<Record<string, any>>) {
        if (Array.isArray(alt?.items)) {
          alt.items = (alt.items as Array<Record<string, any>>).filter((it: any) => {
            const hit = matchesForbiddenName(String(it?.name ?? ""), keywordList);
            if (hit) report.removed.push({ meal: `${mealLabel} (جایگزین)`, from: String(it?.name ?? "") });
            return !hit;
          });
        }
      }
    }
  }

  if (Array.isArray(parsed.dietAlternatives)) {
    for (const da of parsed.dietAlternatives as Array<Record<string, any>>) {
      if (Array.isArray(da?.sampleMeals)) {
        da.sampleMeals = (da.sampleMeals as unknown[]).filter((s: unknown) => {
          const hit = matchesForbiddenName(String(s ?? ""), keywordList);
          if (hit) report.removed.push({ meal: "نمونهٔ رژیم جایگزین", from: String(s ?? "") });
          return !hit;
        });
      }
    }
  }

  if (report.removed.length > 0) {
    const suppHits = report.removed.filter((r) => r.meal === "مکمل" || r.meal === "استک مکمل");
    const foodHits = report.removed.filter((r) => r.meal !== "مکمل" && r.meal !== "استک مکمل");
    const parts: string[] = [];
    if (foodHits.length > 0) {
      parts.push(`این موارد از برنامهٔ غذایی حذف شدند: ${[...new Set(foodHits.map((r) => `«${r.from}»`))].slice(0, 12).join("، ")}`);
    }
    if (suppHits.length > 0) {
      parts.push(`این مکمل‌ها از برنامهٔ مکمل حذف شدند: ${[...new Set(suppHits.map((r) => `«${r.from}»`))].slice(0, 12).join("، ")}`);
    }
    const noteLine = `⛔ طبق درخواست صریح شما ${parts.join(" — همچنین ")}.`;
    parsed.notes = typeof parsed.notes === "string" && parsed.notes ? `${parsed.notes}\n${noteLine}` : noteLine;
  }
  return report;
}
