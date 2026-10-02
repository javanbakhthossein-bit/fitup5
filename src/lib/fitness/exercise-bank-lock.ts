/**
 * ─────────────────────────────────────────────────────────────────────────
 * exercise-bank-lock.ts (v117→v154) — «قفل بانک حرکات»
 *
 * قانون مطلق مالک (v117):
 *   «در آینده هم هر حرکتی که هوش مصنوعی به کاربر می‌دهد باید وجود داشته باشد.
 *    حرکات تجویزی در تمام رشته‌ها باید با بانک حرکات سینک باشد و توضیحی که در
 *    برنامهٔ کاربر وجود دارد دقیقاً به بانک درست اشاره کند.
 *    پیش نیاید حرکتی به کاربر داده شود که ویدیو نداشته باشد.»
 *
 * قانون مطلق مالک (v154 — تکمیل/تعدیل قانون v117):
 *   «۹۰ حرکت هم کمه. اولاً تمام حرکات دیتابیس من بهش تزریق بشه. ثانیاً حتی
 *    اگر حرکتی داخل دیتابیس من نبود باز هم باید اون حرکت رو بده و نزدیک‌ترین
 *    ویدیو و توضیحات براش قرار بگیره. تمام حرکات دیتابیس من و خارج از دیتابیس
 *    برای دادن برنامهٔ تمرینی در نظر گرفته بشه.»
 *
 * سه گارد (همهٔ مسیرهای تولید برنامه — خرید، بازنویسی ادمین، درخواست چت —
 * از generateWorkoutPlan می‌گذرند):
 *
 *   ۱) پرس‌تایم (v154): «کل» دیتابیس حرکات فعال (ویدیودار و بی‌ویدیو) به AI
 *      تزریق می‌شود (buildFullBankPromptGroups — بدون سقف و بدون نمونه‌گیری)
 *      و AI به حرکات «خارج از بانک» هم آزاد است.
 *
 *   ۲) پس‌تایم (قفل سخت): خروجی AI ردیف‌به‌ردیف با بانک تطبیق داده می‌شود:
 *        • نام دقیق/معادل → نام «استاندارد بانک» + exerciseId واقعی (canonical)
 *        • نام موهومی/خارج از بانک → «با نام خودش می‌ماند» و نزدیک‌ترین حرکتِ
 *          ویدیودار بانک پیدا شده و ویدیو/توضیحات/نکات آن به همین ردیف الصاق
 *          می‌شود (v154 — جایگزینی کامل حرکت غریبه حذف شد)
 *        • هر حرکتِ برنامه exerciseId ویدیودار بانک می‌گیرد → هرگز حرکت بی‌ویدیو
 *
 *   ۳) نمایش: fetchExerciseVideo با exerciseId ردیف دقیق بانک را می‌خواند
 *      (بدون حدس نام) و نام حرکت از خودِ برنامهٔ کاربر رندر می‌شود —
 *      پس حرکت خارج از بانک با نام واقعی‌اش + ویدیوی نزدیک‌ترین حرکت بانک
 *      نمایش داده می‌شود (programs-view).
 *
 * خالص و بدون I/O — هم در سرور (ai.ts) و هم در کلاینت (programs-view) قابل
 * استفاده. خواندن DB در ai.ts انجام می‌شود و نتیجه با buildLockedBank وارد
 * این ماژول می‌شود.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { normalizePersianText } from "./persian-search";
import { exerciseMatchesSearch, countSharedSynonymConcepts } from "./exercise-search";
import { isCustomVideo, isYoutubeDisplayAllowed } from "./exercise-video";

/* ───────────────────── نرمال‌سازی نام (تطبیق مقاوم) ───────────────────── */

function foldDigitsAndCase(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

/** فشردن کامل: ی/ک عربی، اعراب، اعداد، حذف فاصله/نیم‌فاصله/خط تیره و پرانتز */
export function squeezeExerciseName(input: string): string {
  return foldDigitsAndCase(normalizePersianText(input))
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\s\u200C\-–—_]+/g, "")
    .replace(/[.,،؛:!؟?"'«»\[\]]+/g, "")
    .trim();
}

/**
 * کلید رفع ابهام: «با»ی مستقل حذف می‌شود —
 * «پرس سینه با هالتر» == «پرس سینه هالتر» (همان الگوی seed v114)
 *
 * v154 — ریشه‌کنی باگ تاریخی: پیاده‌سازی قبلی با regex /با\S+$/u «اولین
 * «با»ی هر جای نام» را تا انتهای نام حذف می‌کرد — «پرس بالاسینه دمبل» به‌خاطر
 * «با»ی داخل «بالاسینه» کلید «پرس» می‌گرفت و با «پرس بالاسینه هالتر» و هر
 * «پرس ...» دیگری هم‌کلید می‌شد (تطبیق نمرهٔ ۹۰۰ = تغییر نام حرکتِ متفاوت!).
 * حالا «با» فقط به‌عنوان توکن مستقل حذف می‌شود؛ «بارفیکس/بالاسینه/باسن» سالم
 * می‌مانند و کلید «پرس سینه با هالتر» == «پرس سینه هالتر (Bench Press)» هنوز برقرار است.
 */
export function exerciseDedupeKey(input: string): string {
  return foldDigitsAndCase(normalizePersianText(input))
    .replace(/\([^)]*\)/g, " ") // محتوای پرانتز انگلیسی حذف — مثل squeeze
    .split(/[\s\u200C\-–—_(),،؛:!?؟."«»\[\]]+/)
    .filter(Boolean)
    .filter((t) => t !== "با")
    .join("");
}

/**
 * v117 — کلید بدون-حرف-اضافه: واژهٔ «با» به‌طور کامل حذف می‌شود —
 * «اسکوات با هالتر» (ساختار بانک مالک) == «اسکوات هالتر» (نوشتار AI).
 * حرف اضافه فقط به‌صورت توکن مستقل حذف می‌شود تا «بارفیکس» و مانند آن سالم بمانند.
 */
export function noPrepositionKey(input: string): string {
  return foldDigitsAndCase(normalizePersianText(input))
    .split(/[\s\u200C\-–—_(),،؛:!?؟."«»\[\]]+/)
    .filter(Boolean)
    .filter((t) => t !== "با")
    .join("");
}

/* ───────────────────────── تایپ‌های بانک قفل‌شده ───────────────────────── */

/** حداقل شکل رکورد بانک که این ماژول می‌خواند (خروجی findMany سرور) */
export interface BankExerciseRow {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment?: string | null;
  description?: string | null;
  tips?: string | null;
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
  youtubeUrl?: string | null;
  youtubeEnabled?: boolean | null;
}

/** آیا این رکورد «ویدیوی قابل‌نمایش» دارد؟ (قانون: حرکت بی‌ویدیو تجویز نمی‌شود) */
export function hasUsableVideo(row: BankExerciseRow | null | undefined, globalYoutube = true): boolean {
  if (!row) return false;
  if (isCustomVideo(row)) return true;
  return isYoutubeDisplayAllowed(row, globalYoutube);
}

/** بانک قفل‌شده — فقط حرکات ویدیودار؛ مصرف هم‌زمان سرور/کلاینت */
export interface LockedBank {
  all: BankExerciseRow[];
  byId: Map<string, BankExerciseRow>;
  byExact: Map<string, BankExerciseRow>; // نام فشرده‌شده
  byDedupe: Map<string, BankExerciseRow>; // کلید رفع ابهام
  byNoPrep: Map<string, BankExerciseRow>; // v117 — کلید بدون-حرف-اضافه
  globalYoutube: boolean;
  /** حرکاتی که به‌خاطر نداشتن ویدیو از بانک قفل حذف شدند (برای لاگ) */
  excludedCount: number;
}

export function buildLockedBank(rows: BankExerciseRow[], globalYoutube: boolean): LockedBank {
  // v153 — حذف ردیف‌های «هم‌نام فشرده» در مبدأ (ممیزی v153: ۶ گروه نام تکراری در
  // بانک — مثلاً «اسکوات جلو» و «اسکوات جلو (Front Squat)»). اگر دو ردیف برای یک
  // حرکت بماند، قفل بانک یکی را انتخاب می‌کند و dedupe بر اساس id تکرار را نمی‌بیند.
  const seenSq = new Set<string>();
  const usable: BankExerciseRow[] = [];
  for (const r of rows) {
    if (!hasUsableVideo(r, globalYoutube)) continue;
    const sq = squeezeExerciseName(r.name);
    if (sq && seenSq.has(sq)) continue;
    if (sq) seenSq.add(sq);
    usable.push(r);
  }
  const all = usable;
  return {
    all,
    byId: new Map(all.map((r) => [r.id, r])),
    byExact: new Map(all.map((r) => [squeezeExerciseName(r.name), r])),
    byDedupe: new Map(all.map((r) => [exerciseDedupeKey(r.name), r])),
    byNoPrep: new Map(all.map((r) => [noPrepositionKey(r.name), r])),
    globalYoutube,
    excludedCount: rows.length - all.length,
  };
}

/* ───────────── v153 — PRNG دانه‌دار برای تنوع حرکتی ───────────── */

/**
 * PRNG قطعی mulberry32 — با seed یکسان دنبالهٔ یکسان می‌دهد؛ seed متفاوت
 * (هر کاربر/هر چرخهٔ تولید) زیرمجموعهٔ متفاوتی از بانک را به پرامپت می‌فرستد.
 * این همان ضامن «برنامهٔ کاربران شبیه هم نباشد» است (تیکت مالک v153).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** هش رشته به seed ۳۲بیتی — برای ساخت seed از userId/ویژگی‌های کاربر */
export function hashStringToSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * انتخاب با لرزش دانه‌دار بین K کاندیدِ برتر — وقتی seed داده نشود (seed=0/undefined)
 * کاملاً قطعی مثل قبل (تست‌ها و رفتار قدیمی حفظ می‌شود).
 */
function pickWithJitter<T>(candidates: Array<{ item: T; score: number }>, seed?: number): T | null {
  if (candidates.length === 0) return null;
  const best = candidates[0].score;
  const top = candidates.filter((c) => c.score >= best - 5).slice(0, 3);
  if (!seed || top.length === 1) return top[0].item;
  const rnd = mulberry32(seed);
  return top[Math.floor(rnd() * top.length) % top.length].item;
}

/* ───────────────────────── امتیازدهی تطبیق نام ───────────────────────── */

/** توکن‌های یک نام (برای امتیاز هم‌پوشانی) */
function tokensOf(name: string): string[] {
  return foldDigitsAndCase(normalizePersianText(name))
    .split(/[\s\u200C\-–—_(),،؛:!?؟."«»\[\]]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !["با", "و", "از", "در", "به", "حرکت", "تمرین"].includes(t));
}

/**
 * امتیاز شباهت «نام خواسته‌شده» با رکورد بانک — بالاتر = بهتر.
 *      ۱۰۰۰ = تطبیق دقیق فشرده   ۹۰۰ = تطبیق dedupe
 *       ۷۰۰ = شروع با/شامل کامل   بقیه = هم‌پوشانی توکن + عضله/تجهیزات
 */
export function scoreBankCandidate(queryName: string, row: BankExerciseRow): number {
  const q = squeezeExerciseName(queryName);
  const r = squeezeExerciseName(row.name);
  if (!q || !r) return 0;
  if (q === r) return 1000;
  const dq = exerciseDedupeKey(queryName);
  const dr = exerciseDedupeKey(row.name);
  if (dq && dq === dr) return 900;
  if (r.includes(q) || q.includes(r)) return 700 - Math.abs(q.length - r.length);

  const qTokens = new Set(tokensOf(queryName));
  const rTokens = tokensOf(row.name);
  let overlap = 0;
  for (const t of rTokens) {
    if (qTokens.has(t)) overlap += 40;
    else if ([...qTokens].some((qt) => qt.length >= 2 && (qt.includes(t) || t.includes(qt)))) overlap += 15;
  }
  // عضلهٔ هم‌خانواده امتیاز مثبت دارد (تطبیق «زیربغل» در توضیح عضله)
  let score = overlap;
  const rowMuscle = squeezeExerciseName(row.muscle || "");
  for (const t of qTokens) {
    if (t.length >= 3 && rowMuscle.includes(t)) {
      score += 25;
      break;
    }
  }
  // v117 — هم‌مفهومی گروه مترادف («رنه‌گید رو» ↔ «روئینگ رنگید دمبل (Renegade Row)»)
  score += Math.min(countSharedSynonymConcepts(queryName, row.name), 2) * 100;
  return score;
}

export interface BankMatch {
  row: BankExerciseRow;
  /** exact = همان حرکت | fuzzy = معادل/متأثر از مترادف | none = یافت نشد */
  kind: "exact" | "fuzzy";
  score: number;
}

/** حداقل امتیاز قابل‌اعتماد برای تطبیق فازی (زیر آن = نام غریبه) */
const FUZZY_MIN_SCORE = 120;

/**
 * تطبیق یک نام (خروجی AI یا برنامهٔ قدیمی) با بانک:
 *   ۱) نام فشردهٔ دقیق  ۲) کلید dedupe  ۳) موتور مترادف + امتیازدهی
 *   ۴) آرام‌سازی پیشوند — توصیف‌های اضافیِ انتهای نام («بارفیکس دست باز»،
 *      «کراس اور سیم‌کش ایستاده با خم شدید») کلمه‌به‌کلمه حذف می‌شوند تا تطبیق
 *      درست پیدا شود؛ حرکت واقعیِ دارای توصیف هرگز «غریبه» حساب نمی‌شود.
 */
export function resolveBankMatch(name: string, bank: LockedBank): BankMatch | null {
  if (!name || bank.all.length === 0) return null;
  const exact = bank.byExact.get(squeezeExerciseName(name));
  if (exact) return { row: exact, kind: "exact", score: 1000 };
  const deduped = bank.byDedupe.get(exerciseDedupeKey(name));
  if (deduped) return { row: deduped, kind: "exact", score: 900 };
  // v117 — کلید بدون-حرف-اضافه: «اسکوات هالتر» == «اسکوات با هالتر»
  const noPrep = bank.byNoPrep.get(noPrepositionKey(name));
  if (noPrep) return { row: noPrep, kind: "exact", score: 920 };

  // موتور مترادف: کاندیدها → بهترین امتیاز
  const bestOf = (query: string, minScore: number): BankMatch | null => {
    let best: BankMatch | null = null;
    for (const c of bank.all) {
      if (!exerciseMatchesSearch(c, query)) continue;
      const score = scoreBankCandidate(query, c);
      if (score >= minScore && (!best || score > best.score)) {
        best = { row: c, kind: "fuzzy", score };
      }
    }
    return best;
  };

  const full = bestOf(name, FUZZY_MIN_SCORE);
  if (full) return full;

  // v117 — سطح آرام‌سازی پیشوند: کلمات انتهایی تدریجی حذف می‌شوند (حداقل ۴ نویسهٔ
  // فشرده). واژه‌های عمومی/حروف اضافه اول حذف می‌شوند تا پیشوند هرگز به یک
  // اسم عام («حرکت»، «تمرین») تنزل نکند — وگرنه فالبک زیررشته‌ایِ موتور جستجو
  // هر ردیفی حاوی همان اسم عام را «تطبیق» حساب می‌کرد.
  const GENERIC_WORDS = new Set(["با", "و", "از", "به", "را", "روی", "در", "یا", "حرکت", "تمرین", "تمرینی", "حرکات"]);
  const words = foldDigitsAndCase(normalizePersianText(name))
    .split(/[\s\u200C\-–—_(),،؛:!?؟."«»\[\]]+/)
    .filter(Boolean)
    .filter((w) => !GENERIC_WORDS.has(w));
  const maxStrips = Math.min(words.length - 1, 4);
  for (let strip = 1; strip <= maxStrips; strip++) {
    const prefix = words.slice(0, words.length - strip).join(" ").trim();
    if (squeezeExerciseName(prefix).length < 4) break;
    // تطبیق دقیق در پیشوند کوتاه‌شده = همان حرکت (نام استاندارد برمی‌گردد)
    const pExact = bank.byExact.get(squeezeExerciseName(prefix));
    if (pExact) return { row: pExact, kind: "exact", score: 950 };
    const pDedupe = bank.byDedupe.get(exerciseDedupeKey(prefix));
    if (pDedupe) return { row: pDedupe, kind: "exact", score: 940 };
    const pNoPrep = bank.byNoPrep.get(noPrepositionKey(prefix));
    if (pNoPrep) return { row: pNoPrep, kind: "exact", score: 930 };
    const pFuzzy = bestOf(prefix, 400);
    if (pFuzzy) return pFuzzy;
  }
  return null;
}

/* ───────── v154 — تطبیق «همان حرکت» (آستانهٔ کانونیکل‌سازی) ───────── */

/**
 * v154 — تطبیقی که فقط وقتی «همان حرکتِ یکسان» است نام را کانونیکل می‌کند.
 *
 * با قانون جدید مالک (حرکت خارج از بانک با نام خودش می‌ماند)، تطبیق‌های فازیِ
 * متوسط (امتیاز ۱۲۰-۶۹۹ — مثلاً واریانت‌های یک خانواده: «شنای آرچر» ≈ «شنای
 * سوئدی» از مسیر مترادف) دیگر مجاز به «تغییر نام» نیستند — آن‌ها به شاخهٔ
 * «خارج از بانک» می‌روند: نام حفظ + الصاق نزدیک‌ترین ویدیو/توضیح.
 *
 * کانونیکل فقط برای:
 *   • کلیدهای دقیق (۱۰۰۰/۹۲۰/۹۰۰ — همان حرکت با نگارش متفاوت)
 *   • پیشوند-استریپ دقیق (۹۳۰-۹۵۰ — همان حرکت + توصیف انتهایی)
 *   • «پرس‌وجو = نام کامل ردیف + توصیف اضافه» (q.includes(r) — «شنای سوئدی با
 *     مکث» ⊇ «شنای سوئدی») با کف ایمنی ۵۰۰ برای جریمهٔ طول.
 *     v154 — جهتِ برعکس (ردیف = پرس‌وجو + کلمهٔ اضافه) عمداً کانونیکل نیست:
 *     «ساق ایستاده» نباید به «کشش ساق ایستاده» (یک حرکت کششی!) تغییر نام کند —
 *     آن‌هم حرکتِ خارج از بانک است و فقط ویدیو الصاق می‌گیرد.
 */
export function resolveConfidentBankMatch(name: string, bank: LockedBank): BankMatch | null {
  const m = resolveBankMatch(name, bank);
  if (!m) return null;
  if (m.kind === "exact") return m;
  const q = squeezeExerciseName(name);
  const r = squeezeExerciseName(m.row.name);
  const queryAddsDescriptor = !!(q && r && q.includes(r));
  return queryAddsDescriptor && m.score >= 500 ? m : null;
}

/* ───────────── v145 — خانوادهٔ حرکتی و پوشش عضلانی (اصول مربیان بزرگ) ───────────── */

/**
 * کلید «خانوادهٔ حرکتی» — واریانت‌های یک حرکت واحد همه یک خانواده‌اند:
 * بارفیکس دست‌باز/دست‌جمع/برعکس/سنگین/چست‌تو‌بار = یک خانواده (pullup)؛
 * روئینگ هالتر/دمبل/سیم‌کش/تی‌بار = یک خانواده (row)؛ و همین‌طور تا آخر.
 *
 * ریشهٔ باگ واقعی کاربر («در روز زیربغل چهار نوع بارفیکس مختلف داده شده») همین
 * بود: هیچ لایه‌ای از AI و هیچ ممیزی بعدی واریانت‌های یک خانواده را در یک روز
 * کنترل نمی‌کرد. ترتیب الگوها مهم است (core قبل از pullup — «بارفیکس شکم» شکم است؛
 * arms قبل از back — «پشت بازو» زیربغل نیست).
 */
const FAMILY_PATTERNS: Array<[string, RegExp]> = [
  // زیرخانواده‌های شکم — کرانچ + پلانک در یک روز کاملاً درست است (الگوی متفاوت)،
  // ولی دو نوع کرانچ = واریانت تکراری. ترتیب: زیرخانواده‌های دقیق اول،
  // core عمومی آخرِ همه (بعد از row تا «روئینگ خم به پهلو» شکم حساب نشود)
  ["core_legraise", /بارفیکس شکم|زانو.?بغل|بالا.?آوردن|بالابردن|وی.?آپ|v.?up|هالتر شکم|leg.?raise|hang/i],
  ["core_crunch", /کرانچ|سیت.?آپ|دراز.?نشست|crunch|sit.?up/i],
  ["core_plank", /پلانک|plank/i],
  ["legcurl", /پشت\s*پا|لگ\s*(کانس|کرل|اکستنشن)|leg\s*(curl|extension)/i],
  ["calf", /ساق|calf/i],
  ["legpress", /پرس\s*پا|لیگ?رس|leg\s*press|جلو\s*پا/i],
  ["lunge", /لانژ|لانج|اسپلیت\s*سکوات|بولغاری|bulgarian|استپ.?اپ|lunge|step.?up/i],
  ["squat", /اسکوات|سکوات|هاک|گابلت|squat|hack/i],
  ["deadlift", /ددلیفت|دد\s*لیفت|رومانیایی|سومو.*لیفت|deadlift|rdl/i],
  ["hip_thrust", /هیپ.?ثرست|هیپ?ثرست|پل باسن|بریک.?باسن|hip.?thrust|گلوت.?بریج|glute/i],
  ["kettlebell_swing", /سوینگ|swing/i],
  ["clean", /کلین|تمیزکردن|clean(?!.*pull)|اسنچ(?!.*پول)|snatch(?!.*pull)/i],
  ["pullup", /بارفیکس|پول\s*اپ|pull.?up|chin.?up|چین.?اپ|میوزاپ|muscle.?up|کشش عمودی/i],
  ["pulldown", /پول\s*داون|پولداون|pull.?down|(^|[\s\u200C\-])لت([\s\u200C\-]|$)|لَت|lat\s/i],
  ["pullover", /پول.?اور|pullover/i],
  ["facepull", /فیس.?پول|face.?pull/i],
  ["row", /روئینگ|روینگ|rowing|تی.?بار|t.?bar|رنه.?گید|renegade|ایرفت|یوکی?ست|upright/i],
  ["shrug", /شراگ|کول|shrug/i],
  ["ohp", /پرس\s*(سر)?شانه|پرس نظامی|shoulder.?press|اُ؟اچ.?پی|ohp|آرنولدی پرس/i],
  ["lateral_raise", /نشر|لترال|lateral/i],
  // v154 — «incline» باید «قبل از bench» چک شود: نام‌های بانک که پرانتز انگلیسی
  // دارند («پرس بالا سینه دمبل (Incline Dumbbell Bench Press)») کلمهٔ Bench را
  // دارند و اگر bench اول باشد، همان حرکتِ بالاسینه به‌اشتباه خانوادهٔ بنچ می‌گیرد
  // و با بنچِ تخت هم‌خانواده حساب می‌شود (دو سیستم طبقه‌بندی ناسازگار برای
  // نام فارسیِ محض و نام با پرانتز). با این ترتیب هر دو شکل → incline می‌مانند.
  ["incline", /بالاسینه|بالا\s*سینه|اینکلاین|incline/i],
  ["bench", /پرس\s*سینه|بنچ|bench/i],
  ["chest_fly", /قفسه|فلای|کراس.?اور|fly|crossover|pec\s?deck/i],
  ["dips", /پارالل|دیپ|dip/i],
  // v153 — باگ «دو تا شنا در یک روز» (تیکت مالک): الگوی قبلی /شنای\s|شنا$|شنا‌/
  // هیچ واریانت «شنا X» را نمی‌گرفت (شنا سوئدی، شنا الماسی، شنا آرچر و …)
  // چون «شنا» در آن‌ها نه آخر نام است نه با نیم‌فاصله — هر واریانت خانوادهٔ
  // جدا می‌شد و ممیزی dedupe کور می‌شد. حالا هر نامی حاوی «شنا» (یا پوش‌آپ)
  // یک خانواده است — به‌جز «شنای پیلاتس (Swimming)» که شنای کرِش نیست
  // (حرکت شنا در آب/پیلاتس — در exerciseFamilyKey با نگهبان isSwimMove
  // کنار گذاشته می‌شود تا به اشتباه خانوادهٔ pushup نگیرد).
  ["pushup", /شنا|پوش.?آپ|پوش.?اپ|push.?up/i],
  ["triceps", /پشت.?بازو|تریسپس|کیک.?بک|ترای?سپس|triceps|extension/i],
  ["biceps", /جلوبازو|جلو\s*بازو|بایسپس|بای?سپس|curl|هامر/i],
  // عمومی‌ترین الگوی شکم — فقط آخرِ همه (بعد از row تا «خم به پهلو» و «سوپرمن»)
  ["core_other", /شکم|کور|core|پهلو|رول.?اوت|چرخش|روسی|twist|ab.?wheel|سوپرمن/i],
];

/**
 * v153 — سقف واریانت هر خانواده در «یک روز»:
 * پیش‌فرض ۲ (رویهٔ مربیان بزرگ: جلوبازو هالتر + چکشی در یک روز درست است؛
 * مصوب v147 مالک) — فقط خانوادهٔ pushup سقف ۱ دارد: «دو شنا در یک روز»
 * (شنا + شنا سوئدی/الماسی/آرچر و …) عین تیکت باگ مالک است و هرگز نباید
 * در یک روز دیده شود. شکم (core) طبق v147 مستثناست.
 */
const FAMILY_DAY_CAP: Record<string, number> = { pushup: 1 };

/** کلید خانوادهٔ حرکتی یک حرکت (نام + عضلهٔ اختیاری) — ناشناخته = نام فشردهٔ خودش */
export function exerciseFamilyKey(name: string, muscle?: string | null): string {
  const n = foldDigitsAndCase(normalizePersianText(name || ""));
  // v153 — نگهبان «شنا در آب/پیلاتس»: «شنای پیلاتس (Swimming)» حرکت شناورِ
  // شکم/پشت است نه پوش‌آپ — نباید خانوادهٔ pushup بگیرد. فقط اگر خودِ نام
  // صراحتاً پوش‌آپ باشد (مثل «شنا پیلاتس (Pilates Push-Up)») خانوادهٔ pushup می‌ماند.
  const isSwimMove = /پیلاتس|swim/i.test(n) && !/پوش|push/i.test(n);
  for (const [key, re] of FAMILY_PATTERNS) {
    if (key === "pushup" && isSwimMove) continue;
    if (re.test(n)) return key;
  }
  // ناشناخته: کلید از خود نام (موارد هم‌نام دقیق هم همین‌طور گرفته می‌شوند) +
  // عضله برای تفکیک نسبی («پرس زیربغل دستگاه» vs «پرس سینه دستگاه»)
  const m = muscle ? squeezeExerciseName(muscle) : "";
  return `other:${squeezeExerciseName(name)}|${m}`;
}

/** گروه‌های عضلانی اصلی — استاندارد پوشش هفتگی مربیان بزرگ */
export const MAJOR_GROUP_KEYS = ["chest", "back", "shoulders", "legs", "arms", "core"] as const;
export type MajorGroupKey = (typeof MAJOR_GROUP_KEYS)[number];

export const MAJOR_GROUP_LABELS_FA: Record<string, string> = {
  chest: "سینه",
  back: "زیربغل/پشت",
  shoulders: "سرشانه",
  legs: "پا",
  arms: "بازو",
  core: "شکم و مرکز بدن",
};

/** نگاشت مستقیم muscle استاندارد بانک → گروه اصلی (سریع‌تر و دقیق‌تر از regex نام) */
const BANK_MUSCLE_TO_GROUP: Array<[RegExp, MajorGroupKey]> = [
  [/شکم|کور|core/i, "core"],
  [/جلوبازو|پشت.?بازو|بازو|biceps|triceps|arm/i, "arms"],
  [/سرشانه|شانه|دلتوئید|shoulder|delt/i, "shoulders"],
  // ⚠️ "چست" حذف شد — «بارفیکس چست تو بار» حرکت زیربغل است نه سینه
  [/سینه|chest|پک/i, "chest"],
  // ⚠️ "پشت پا" و "پشت بازو" نباید back حساب شوند (نگاه منفی)
  [/زیربغل|پشت(?![\s\u200C]?(?:پا|بازو))|بالا.?تن|lat|back|روئینگ|rowing/i, "back"],
  // ⚠️ "ران" فقط به‌صورت واژهٔ مستقل ("کرانچ" شامل ران است؛ "پا" شامل پارالل)
  [/پا|باسن|(^|[\s\u200C])ران([\s\u200C]|$)|ساق|leg|glute|همسترینگ|چهارسر/i, "legs"],
];

/**
 * گروه عضلانی اصلی یک حرکت — ترکیب muscle + name + category.
 * کل بدن = هر شش گروه را پوشش می‌دهد (حرکت چندمفصلی کامل).
 */
export function majorGroupsOfExercise(ex: { name?: string; muscle?: string | null; category?: string | null }): Set<MajorGroupKey> {
  const groups = new Set<MajorGroupKey>();
  const hay = foldDigitsAndCase(normalizePersianText(`${ex?.muscle ?? ""} ${ex?.name ?? ""}`));
  const cat = foldDigitsAndCase(normalizePersianText(ex?.category ?? ""));
  if (/کل\s*بدن|بدن\s*کامل|fullbody|full.?body/.test(hay) || /fullbody/.test(cat)) {
    for (const g of MAJOR_GROUP_KEYS) groups.add(g);
    return groups;
  }
  for (const [re, group] of BANK_MUSCLE_TO_GROUP) {
    if (re.test(hay)) groups.add(group);
  }
  // «پشت بازو» نباید back حساب شود (بازو اول چک شد ولی «پشت» در hay مانده است)
  if (groups.has("back") && /پشت.?بازو|تریسپس|triceps/.test(hay)) groups.delete("back");
  if (groups.has("legs") && /پشت.?بازو/.test(hay)) groups.delete("legs");
  return groups;
}

/** پوشش گروه‌های اصلی در کل هفته — خروجی: مجموعهٔ گروه‌های پوشش‌داده‌شده */
export function coveredMajorGroups(
  days: Array<{ exercises?: Array<Record<string, any>> } | undefined> | undefined
): Set<MajorGroupKey> {
  const covered = new Set<MajorGroupKey>();
  for (const day of days ?? []) {
    for (const ex of Array.isArray(day?.exercises) ? day!.exercises! : []) {
      for (const g of majorGroupsOfExercise(ex as any)) covered.add(g);
    }
  }
  return covered;
}

/**
 * v162 — پوشش «تفکیک‌شدهٔ» گروه‌های اصلی (فیکس شکایت «سرشانه به من داده نشده»).
 *
 * باگ پنهان نسخه‌های قبل: حرکتِ «کل بدن» هر شش گروه را پوشش می‌داد، پس برنامه‌ای
 * مثل «سینه/زیربغل/پا + یک حرکت فول‌بادی» از نظر شمارنده «سرشانه‌دار» حساب می‌شد
 * و ترمیم پوشش هرگز اجرا نمی‌شد — در حالی که کاربر عملاً هیچ حرکت مستقیم سرشانه‌ای
 * نداشت. حالا پوشش هر گروه دو جزء دارد:
 *   • direct: تعداد حرکات «مستقیمِ» همان گروه (بدون فول‌بادی)
 *   • fullbodyDays: تعداد روزی که حداقل یک حرکت فول‌بادی دارند
 * یک گروه «واقعاً پوشیده» است اگر: حرکت مستقیم دارد، یا برنامهٔ واقعاً
 * فول‌بادی است (حرکت فول‌بادی در ≥۲ روز مختلف — اسپلیت کل‌بدنِ استاندارد).
 */
export interface MajorGroupCoverageDetail {
  covered: Set<MajorGroupKey>;
  directCount: Map<MajorGroupKey, number>;
  fullbodyDays: number;
  isGenuineFullbodySplit: boolean;
}

export function coveredMajorGroupsDetailed(
  days: Array<{ exercises?: Array<Record<string, any>> } | undefined> | undefined
): MajorGroupCoverageDetail {
  const directCount = new Map<MajorGroupKey, number>();
  const fullbodyDaySet = new Set<number>();
  (days ?? []).forEach((day, dayIdx) => {
    for (const ex of Array.isArray(day?.exercises) ? day!.exercises! : []) {
      const groups = majorGroupsOfExercise(ex as any);
      // کل‌بدن = هر شش گروه را می‌گیرد و از نظر majorGroupsOfExercise قابل‌تفکیک
      // نیست؛ تشخیص از خود متن حرکت انجام می‌شود
      const hay = `${(ex as any)?.muscle ?? ""} ${(ex as any)?.name ?? ""}`;
      const isFullbody = /کل\s*بدن|بدن\s*کامل|fullbody|full.?body/i.test(hay);
      if (isFullbody) {
        fullbodyDaySet.add(dayIdx);
        continue; // پوشش مستقیم حساب نمی‌شود
      }
      for (const g of groups) directCount.set(g, (directCount.get(g) ?? 0) + 1);
    }
  });
  const fullbodyDays = fullbodyDaySet.size;
  const isGenuineFullbodySplit = fullbodyDays >= 2;
  const covered = new Set<MajorGroupKey>();
  for (const g of MAJOR_GROUP_KEYS) {
    if ((directCount.get(g) ?? 0) > 0) covered.add(g);
    else if (isGenuineFullbodySplit) covered.add(g); // فول‌بادی واقعی همه را می‌پوشاند
  }
  return { covered, directCount, fullbodyDays, isGenuineFullbodySplit };
}

/** گزارش dedupe خانوادهٔ حرکتی */
export interface FamilyDedupReport {
  replaced: Array<{ day: string; from: string; to: string }>;
}

/**
 * v147 — dedupe قطعی انباشت خانوادهٔ حرکتی در هر روز (شبکهٔ ایمنی بعد از قفل بانک).
 *
 * قانون علمی مربیان بزرگ: «حداکثر دو واریانت» از یک خانوادهٔ حرکتی در یک روز
 * مجاز و استاندارد است (جلو بازو هالتر + چکشی، اسکوات جلو + بلغاری)؛ فقط
 * «۳ واریانت به بالا» انباشت آماتوری است (۴ بارفیکس در روز زیربغل) و ترمیم
 * می‌شود: جایگزین بهترین حرکتِ ویدیودارِ «هم‌عضله» از یک «خانوادهٔ آزادِ همان
 * روز» — ست/تکرار/RPE/تمپوی کاربر حفظ می‌شود، نام/توضیح/نکات/exerciseId از
 * ردیف بانک می‌آید. تکرار دقیق همان حرکت هم همیشه ترمیم می‌شود.
 *
 * v147 — نسخهٔ قبلی دومین واریانت را هم جایگزین می‌کرد که علمی غلط بود و
 * برنامهٔ درست را خراب می‌کرد (دیباگ مالک: «جلو بازو هالتر و چکشی می‌تونن
 * در یک روز بیان»). سقف ۲ برای خانواده‌های عادی حفظ شد.
 *
 * v153 — سه سخت‌گیری جدید (تیکت مالک: «در بعضی روزها به من دو تا شنا داده»):
 *   ۱) سقف خانواده از FAMILY_DAY_CAP خوانده می‌شود — pushup سقف ۱ دارد:
 *      «شنا + شنا سوئدی/الماسی/آرچر و…» در یک روز هرگز مجاز نیست.
 *   ۲) قاعدهٔ «پیشوند هم‌خانواده»: دو نام هم‌خانواده که یکی پیشوند فشردهٔ دیگری
 *      است (مثل «پرس سینه هالتر» + «پرس سینه هالتر دست‌باز») عملاً همان حرکت‌اند
 *      — حتی زیر سقف ۲ هم واریانت دوم ترمیم می‌شود.
 *   ۳) لرزش دانه‌دار بین ۳ کاندید برتر جایگزین (opts.seed) — تا دو کاربرِ
 *      شبیه‌هم همیشه «اولین ردیف بانک» را نگیرند (ریشهٔ «یک سری حرکت به همه داده میشه»).
 *
 * fail-safe: بانک کوچک یا بدون جایگزین مناسب → حرکت دست‌نخورده می‌ماند.
 */
export function dedupeExerciseFamiliesInPlan<
  T extends {
    days?: Array<{
      day?: string;
      exercises?: Array<Record<string, any>>;
      [k: string]: any;
    }>;
    [k: string]: any;
  }
>(plan: T, bank: LockedBank, opts?: { seed?: number }): FamilyDedupReport {
  const report: FamilyDedupReport = { replaced: [] };
  if (!plan || !Array.isArray(plan.days) || bank.all.length < MIN_BANK_FOR_HARD_LOCK) return report;

  for (const day of plan.days) {
    if (!day || !Array.isArray(day.exercises)) continue;
    const dayLabel = day.day || "؟";
    const exList = day.exercises;
    const usedIds = new Set<string>(
      exList.map((e: any) => e?.exerciseId).filter((x: any): x is string => typeof x === "string")
    );
    // v145 — نام‌های مصرف‌شدهٔ روز (برای حذف کاندیدهای جایگزین که هم‌نامِ حرکات
    // فعلی روزند) + نام‌های پیموده‌شده (برای تشخیص تکرارِ دقیقِ همان حرکت).
    const usedNames = new Set<string>(
      exList.map((e: any) => (typeof e?.name === "string" ? squeezeExerciseName(e.name) : "")).filter(Boolean)
    );
    const seenExactNames = new Set<string>();
    // v147 — شمارش خانواده‌ها به‌جای مجموعه: تا ۲ واریانت مجاز، سومین واریانت ترمیم می‌شود
    const familyCount = new Map<string, number>();

    /** v153 — آیا این واریانت برای این روز «تکراری» است؟ (سقف خانواده + پیشوند هم‌خانواده) */
    const isDupVariant = (fam: string, sqName: string): boolean => {
      const isCoreFam = fam.startsWith("core");
      if (isCoreFam) return false; // شکم فقط تکرارِ دقیق (پایین‌تر) چک می‌شود
      const cap = FAMILY_DAY_CAP[fam] ?? 2;
      const count = familyCount.get(fam) ?? 0;
      if (count >= cap) return true;
      // قاعدهٔ پیشوند: یکی از واریانت‌های موجود هم‌خانواده، پیشوند فشردهٔ همین نام است
      for (const [otherFam, names] of familyNamesByFam) {
        if (otherFam !== fam) continue;
        if (sqName.length < 4) continue;
        for (const other of names) {
          if (other.length >= 4 && (sqName.startsWith(other) || other.startsWith(sqName))) return true;
        }
      }
      return false;
    };
    // v153 — نام‌های فشردهٔ هر خانوادهٔ مصرف‌شدهٔ روز (برای قاعدهٔ پیشوند)
    const familyNamesByFam = new Map<string, Set<string>>();
    const registerVariant = (fam: string, sqName: string) => {
      familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);
      seenExactNames.add(sqName);
      const set = familyNamesByFam.get(fam) ?? new Set<string>();
      set.add(sqName);
      familyNamesByFam.set(fam, set);
    };

    for (const ex of exList) {
      if (!ex || typeof ex.name !== "string" || !ex.name.trim()) continue;
      const fam = exerciseFamilyKey(ex.name, ex.muscle);
      const sqName = squeezeExerciseName(ex.name);
      // تمرینات شکم (core_*) استثنا هستند: کرانچ + پلانک + بالا-آوردن پا در یک
      // روز چیدمان کاملاً استانداردی است — فقط تکرارِ دقیقِ همان حرکت اشکال است.
      const isCoreFam = fam.startsWith("core");
      const exactDup = seenExactNames.has(sqName);
      // v153 — سقف داینامیک خانواده (pushup=۱) + قاعدهٔ پیشوند هم‌خانواده
      const familyDup = isDupVariant(fam, sqName);
      if (!exactDup && !familyDup) {
        registerVariant(fam, sqName);
        continue;
      }

      // ── واریانت سومِ یک خانواده (یا تکرار دقیق) پیدا شد — بهترین جایگزین ──
      // هم‌عضله؛ برای تکرارِ دقیقِ شکم، واریانتِ همان خانوادهٔ شکم هم مجاز است.
      const allowSameFamily = isCoreFam && !familyDup;
      const exMuscle = squeezeExerciseName(ex.muscle || "");
      const exGroups = majorGroupsOfExercise(ex);
      const original = ex.name;
      const scored: Array<{ item: BankExerciseRow; score: number }> = [];

      for (const r of bank.all) {
        if (usedIds.has(r.id)) continue;
        if (usedNames.has(squeezeExerciseName(r.name))) continue;
        const rFam = exerciseFamilyKey(r.name, r.muscle);
        if ((familyCount.get(rFam) ?? 0) >= 1) continue; // باید خانوادهٔ «جدید» برای این روز بیاورد
        const rGroups = majorGroupsOfExercise(r);
        let s = 0;
        // تطابق گروه عضلانی اصلی — الزام اصلی
        let groupOverlap = false;
        for (const g of exGroups) {
          if (rGroups.has(g)) {
            groupOverlap = true;
            s += 40;
          }
        }
        if (!groupOverlap) continue;
        // تطابق عضلهٔ ریز (مثل «پشت و زیربغل»)
        const rMuscle = squeezeExerciseName(r.muscle || "");
        if (exMuscle && rMuscle && (rMuscle.includes(exMuscle) || exMuscle.includes(rMuscle))) s += 30;
        if (ex.category && r.category === ex.category) s += 20;
        if (!r.name.includes("(")) s += 10; // حرکت پایهٔ بانک
        // پرهیز از جایگزینی با خودِ واریانت دیگر همان خانوادهٔ تکراری
        if (rFam === fam && !allowSameFamily) continue;
        scored.push({ item: r, score: s });
      }
      scored.sort((a, b) => b.score - a.score);
      // v153 — لرزش دانه‌دار بین ۳ کاندید برتر (seed=undefined → قطعی مثل قبل)
      const replacement = pickWithJitter(scored, opts?.seed);

      if (replacement) {
        usedIds.add(replacement.id);
        usedNames.add(squeezeExerciseName(replacement.name));
        registerVariant(
          exerciseFamilyKey(replacement.name, replacement.muscle),
          squeezeExerciseName(replacement.name)
        );
        ex.exerciseId = replacement.id;
        ex.name = replacement.name;
        ex.description = (replacement.description || ex.description || "").trim();
        ex.tips = (replacement.tips || ex.tips || "").trim();
        delete ex.coachTip;
        if (replacement.muscle) ex.muscle = replacement.muscle;
        if (replacement.category) ex.category = replacement.category;
        // substitution قدیمی به حرکت قبلی اشاره داشت — پاک می‌شود (AI در توضیح بانک است)
        if (typeof ex.substitution === "string") ex.substitution = "";
        report.replaced.push({ day: dayLabel, from: original, to: replacement.name });
      }
      // بدون جایگزین: fail-safe — حرکت با نام خودش می‌ماند (حذف ممنوع)
      registerVariant(fam, sqName);
    }
  }
  return report;
}

/* ───────── v154 — نزدیک‌ترین ردیف بانک (الصاق ویدیو به حرکت خارج از بانک) ───────── */

/**
 * v154 — نزدیک‌ترین ردیف «ویدیودار» بانک برای یک نام دلخواه (بدون حد آستانه).
 *
 * برخلاف resolveBankMatch (که زیر FUZZY_MIN_SCORE نتیجه نمی‌دهد)، این تابع
 * همیشه بهترین امتیازِ موجود را برمی‌گرداند — چون طبق قانون v154 مالک حرکت
 * خارج از بانک «می‌ماند» و باید نزدیک‌ترین ویدیو/توضیح به آن الصاق شود؛
 * «نزدیک‌ترین» همیشه وجود دارد (فقط وقتی بانک خالی باشد null است).
 *
 * امتیازدهی همان scoreBankCandidate است (توکن‌هم‌پوشانی + موتور مترادف +
 * عضله) — یعنی «پرس بالاسینه دمبل» برای «پرس بالاسینه هالتر» نزدیک‌ترین است،
 * نه یک حرکت بی‌ربط.
 */
export function findClosestBankRow(
  queryName: string,
  bank: LockedBank,
  opts?: { excludeIds?: Set<string> }
): BankExerciseRow | null {
  if (!queryName || bank.all.length === 0) return null;
  // v154 — اگر خودِ پرس‌وجو حرکت کششی/موبیلیتی نیست، ردیف‌های کششی جریمه می‌شوند
  // تا «ساق ایستاده» ویدیوی «کشش ساق ایستاده» نگیرد (نزدیک‌ترین باید هم‌الگو باشد)
  const queryIsStretch = /کشش|استرچ|stretch|موبیلیتی|mobility|فوم|foam|گرم.?کردن|warm/i.test(queryName);
  const bestOf = (exclude?: Set<string>): { row: BankExerciseRow; score: number } | null => {
    let best: { row: BankExerciseRow; score: number } | null = null;
    for (const r of bank.all) {
      if (exclude && exclude.has(r.id)) continue;
      let score = scoreBankCandidate(queryName, r);
      if (!queryIsStretch && /کشش|استرچ|stretch|موبیلیتی|mobility/i.test(r.name)) score -= 250;
      if (!best || score > best.score) best = { row: r, score };
    }
    return best;
  };
  // اول با فیلتر idهای مصرف‌شده (تا دو حرکتِ روز به یک ویدیو نگاشت نشوند)؛
  // اگر همهٔ بانک مصرف شده بود، بدون فیلتر — الصاق ویدیو همیشه ممکن بماند.
  return (opts?.excludeIds ? bestOf(opts.excludeIds) ?? bestOf() : bestOf())?.row ?? null;
}

/* ───────────────────────── قفل برنامهٔ تمرینی ───────────────────────── */

/** زیر حد این تعداد حرکت ویدیودار، جایگزینی اجباری غیرفعال می‌شود (fail-safe) */
const MIN_BANK_FOR_HARD_LOCK = 10;

export interface PlanLockReport {
  canonicalized: number; // نام AI با نام استاندارد بانک یکسان شد (معادل)
  fuzzyFixed: number; // نامِ متفاوت ولی همان حرکت → نام/توضیح استاندارد
  replaced: Array<{ day: string; from: string; to: string }>; // (v153 — حالا فقط dedupe؛ قفل دیگر جایگزین نمی‌کند)
  /** v154 — حرکت خارج از بانک با نام خودش ماند و نزدیک‌ترین ویدیو/توضیح بانک الصاق شد */
  videoAttached: number;
  unlocked: boolean; // بانک خیلی کوچک بود — فقط canonicalization ملایم
}

/**
 * قفل سخت برنامهٔ تمرینی روی بانک ویدیودار:
 *  • هر حرکت به نزدیک‌ترین ردیف بانک (ویدیودار) نگاشت و exerciseId می‌گیرد
 *  • نام‌های معادل → نام استاندارد بانک (توضیح AI شخصی می‌ماند)
 *  • نام‌های غریبه → توضیح/نکات از ردیف بانک (توضیح AI برای حرکت دیگری بود)
 *  • نام‌های خارج از بانک → جایگزینِ هم‌عضلهٔ ویدیودار (دستور ست/تکرار حفظ می‌شود)
 *  • گرم‌کردن/سردکردن: فقط نام‌شان در صورت تطبیق استاندارد می‌شود (هرگز حذف نمی‌شوند)
 *
 * fail-safe: اگر بانک خالی/خیلی کوچک باشد فقط تطبیق دقیق اعمال و چیزی جایگزین
 * نمی‌شود (برنامهٔ کاربر هرگز خراب نمی‌شود).
 *
 * v153 — دو بهبود (تیکت مالک: تنوع حرکات + دو شنا):
 *   • opts.seed → لرزش دانه‌دار بین ۳ کاندید برتر جایگزین (دیگر همیشه «اولین
 *     ردیف بانک» برای همهٔ کاربران انتخاب نمی‌شود).
 *   • جایگزینِ نام غریبه هرگز خانوادهٔ حرکتیِ از قبل موجود در «همان روز» را
 *     تکرار نمی‌کند (مثلاً در روزی که شنا هست، جایگزین دیگر شنا نمی‌شود).
 *
 * v154 — تغییر قانونیِ ریشه‌ای (تیکت مالک: «حتی اگر حرکتی داخل دیتابیس من
 * نبود باز هم باید اون حرکت رو بده و نزدیک‌ترین ویدیو و توضیحات براش قرار
 * بگیره»): نامِ غریبهٔ خارج از بانک دیگر «جایگزین» نمی‌شود — با نام خودش
 * می‌ماند و نزدیک‌ترین ردیفِ ویدیودار بانک (findClosestBankRow) پیدا شده و
 * exerciseId/توضیحات/نکات آن به همین ردیف الصاق می‌شود. یعنی:
 *   • حرکت دیده می‌شود (نام واقعیِ تجویز مربی)
 *   • ویدیو همیشه هست (نزدیک‌ترین ویدیودار بانک)
 *   • توضیحات/نکات استاندارد بانک برای همان حرکتِ نزدیک نمایش داده می‌شود
 *   (توضیح AI فقط وقتی می‌ماند که ردیف بانک توضیح خالی داشته باشد)
 * جایگزینی کامل حرکت فقط در dedupe خانواده (واریانت سوم هم‌خانواده در یک روز)
 * و ممنوعیت‌های صریح کاربر/مدیر ادامه دارد — هر دو خواستهٔ صریح مالک‌اند.
 */
export function lockWorkoutPlanToBank<
  T extends {
    days?: Array<{
      day?: string;
      exercises?: Array<Record<string, any>>;
      warmup?: Array<{ name?: string } & Record<string, any>>;
      cooldown?: Array<{ name?: string } & Record<string, any>>;
      [k: string]: any;
    }>;
    fst7Details?: { exerciseName?: string } & Record<string, any>;
    [k: string]: any;
  }
>(plan: T, bank: LockedBank, opts?: { seed?: number }): PlanLockReport {
  const report: PlanLockReport = { canonicalized: 0, fuzzyFixed: 0, replaced: [], videoAttached: 0, unlocked: false };
  if (!plan || !Array.isArray(plan.days)) return report;
  const hardLock = bank.all.length >= MIN_BANK_FOR_HARD_LOCK;

  for (const day of plan.days) {
    if (!day) continue;
    const dayLabel = day.day || "؟";
    const usedIds = new Set<string>();
    const exList = Array.isArray(day.exercises) ? day.exercises : [];

    // idهای ردیف‌های بانکی که همین روز مصرف شده‌اند — تا الصاق ویدیوی دو حرکتِ
    // مختلفِ یک روز به «یک ردیف» هرگز رخ ندهد (v154)
    // v154 — تطبیق «همان حرکت» (نه فازیِ متوسط) — تا id ردیفی که فقط «نزدیک» است
    // از پیش رزرو نشود و الصاقِ واقعاً نزدیک‌ترین ردیف به حرکتِ خارج از بانک ممکن بماند
    for (const ex of exList) {
      const m = ex?.name ? resolveConfidentBankMatch(ex.name, bank) : null;
      if (m) usedIds.add(m.row.id);
    }

    for (const ex of exList) {
      if (!ex || typeof ex.name !== "string" || !ex.name.trim()) continue;
      const original = ex.name;
      // v154 — فقط تطبیقِ «همان حرکت» کانونیکل می‌شود؛ شباهت فازیِ متوسط
      // (واریانت‌های یک خانواده) = حرکتِ خارج از بانک → شاخهٔ الصاق
      const match = resolveConfidentBankMatch(original, bank);

      if (match) {
        const isExactName = squeezeExerciseName(original) === squeezeExerciseName(match.row.name);
        ex.exerciseId = match.row.id;
        ex.name = match.row.name;
        if (isExactName) {
          report.canonicalized++;
        } else {
          // معادل/فازی: نام استاندارد + توضیح مرجع بانک (توضیح AI برای همین حرکت نبوده)
          ex.description = (match.row.description || ex.description || "").trim();
          ex.tips = (match.row.tips || ex.tips || "").trim();
          delete ex.coachTip;
          report.fuzzyFixed++;
        }
        continue;
      }

      // ── نام غریبه — خارج از بانک ویدیودار (v154 — قانون جدید مالک) ──
      // حرکت با «نام خودش» می‌ماند و هرگز جایگزین نمی‌شود؛ نزدیک‌ترین ردیفِ
      // ویدیودار بانک پیدا شده و ویدیو (exerciseId) + توضیحات + نکات آن به
      // همین ردیف الصاق می‌شود («نزدیک‌ترین ویدیو و توضیحات براش قرار بگیره»).
      if (hardLock) {
        const closest = findClosestBankRow(original, bank, { excludeIds: usedIds });
        if (closest) {
          usedIds.add(closest.id);
          ex.exerciseId = closest.id;
          // توضیح استاندارد بانک برای حرکتِ نزدیک — فقط اگر بانک توضیح خالی
          // داشت، توضیح AI (که مالِ همین حرکتِ خارج از بانک است) می‌ماند.
          ex.description = (closest.description || ex.description || "").trim();
          ex.tips = (closest.tips || ex.tips || "").trim();
          // muscle/category فقط وقتی AI نداده تکمیل می‌شود (دادهٔ AI دربارهٔ
          // حرکتِ واقعی است — dedupe خانواده به آن تکیه دارد)
          if (!ex.muscle && closest.muscle) ex.muscle = closest.muscle;
          if (!ex.category && closest.category) ex.category = closest.category;
          report.videoAttached++;
          continue;
        }
      }
      // بدون ویدیوی قابل‌الصاق (بانک خالی/خیلی کوچک): حرکت با نام خودش می‌ماند
      // (fail-safe — حذف ممنوع)
      report.unlocked = !hardLock;
    }

    // گرم‌کردن/سردکردن: فقط استانداردسازی نام (هرگز حذف/جایگزینی)
    for (const key of ["warmup", "cooldown"] as const) {
      const items = Array.isArray(day[key]) ? day[key] : [];
      for (const item of items) {
        if (!item || typeof item.name !== "string" || !item.name.trim()) continue;
        const m = resolveBankMatch(item.name, bank);
        if (m && m.kind === "exact") {
          item.exerciseId = m.row.id;
          item.name = m.row.name;
        }
      }
    }
  }

  // FST-7 — نام حرکت هم به بانک قفل می‌شود (در صورت تطبیق)
  if (plan.fst7Details && typeof plan.fst7Details.exerciseName === "string" && plan.fst7Details.exerciseName.trim()) {
    const m = resolveBankMatch(plan.fst7Details.exerciseName, bank);
    if (m) plan.fst7Details.exerciseName = m.row.name;
  }

  return report;
}

/* ───────────────────────── فهرست پرامپت برای AI ───────────────────────── */

/**
 * [v154 — legacy] فهرست نام‌هایی که به AI داده می‌شود — فقط حرکات ویدیودار بانک.
 *
 * v154 — دیگر در مسیر تولید برنامه استفاده نمی‌شود: طبق قانون جدید مالک
 * («تمام حرکات دیتابیس من بهش تزریق بشه») پرامپت با buildFullBankPromptGroups
 * از «کل» دیتابیس ساخته می‌شود (۵۸۱ ردیف فعال، بدون سقف) و حرکت خارج از بانک
 * هم مجاز شد. این تابع برای سازگاری تست‌ها/فراخوان‌های قدیمی نگه داشته شد.
 *
 * v153 — ریشه‌درمانی «تنوع حرکات» (تیکت مالک: «انگار از تنوع حرکات موجود در
 * دیتابیس پشتیبانی نمی‌کنه … یک سری حرکات رو به همه داده»):
 *
 *   قبلاً: حرکات رشته + پرکردن «به ترتیب ثابت بانک» تا ۲۵ نام — همهٔ کاربران
 *   تقریباً همین ۲۵ حرکت را در پرامپت می‌دیدند و AI از همان‌ها برنامه می‌ساخت.
 *
 *   حالا: حرکات رشته (الگوهای ثابت و آزمودهٔ رشته) + نمونه‌گیری «متعادل
 *   عضله‌محور و دانه‌دار» از کل بانک تا ~۹۰ نام:
 *     • هر گروه عضلانی اصلی (سینه/زیربغل/سرشانه/پا/بازو/شکم/…) سهمیهٔ برابر دارد
 *     • seed از هویت/چرخهٔ کاربر می‌آید → هر کاربر زیرمجموعهٔ متفاوتی می‌بیند
 *     • seed یکسان = خروجی یکسان (قطعی برای retry و تست)
 *
 * minCount هنوز معنا دارد (حداقل فهرست در بانک‌های کوچک)؛ targetCount سقف
 * نمونه‌گیری است (پیش‌فرض ۹۰ — با ۵۴۹ حرکتِ بانک فعلی، فهرستِ گروه‌بندی‌شدهٔ
 * ~۹۰ نامی حدود ۴۰۰ توکن است و به‌صرفه).
 */
export function buildBankPromptNames(
  bank: LockedBank,
  disciplineNames: string[] = [],
  minCount = 25,
  opts?: { seed?: number; targetCount?: number }
): string[] {
  if (bank.all.length === 0) return [];
  const wanted = disciplineNames
    .map((n) => (bank.byExact.get(squeezeExerciseName(n)) || bank.byDedupe.get(exerciseDedupeKey(n)) || null))
    .filter((r): r is BankExerciseRow => !!r);
  const seenName = new Set<string>();
  const preferred: string[] = [];
  for (const r of wanted) {
    if (seenName.has(r.name)) continue;
    seenName.add(r.name);
    preferred.push(r.name);
  }
  if (preferred.length >= minCount && !opts) return preferred;

  const targetCount = Math.max(minCount, Math.min(opts?.targetCount ?? 90, bank.all.length));
  if (preferred.length >= targetCount) return preferred.slice(0, targetCount);

  // ── نمونه‌گیری متعادل عضله‌محور از بقیهٔ بانک ──
  const rest = bank.all.filter((r) => !seenName.has(r.name));
  // هر ردیف به اولین گروهِ اصلیِ خودش می‌رود (سهمیه‌بندی گروهی)
  const byGroup = new Map<string, BankExerciseRow[]>();
  for (const r of rest) {
    const groups = majorGroupsOfExercise(r);
    const key = groups.size === 0 || groups.size >= 5 ? "fullbody" : [...groups][0];
    const list = byGroup.get(key) ?? [];
    list.push(r);
    byGroup.set(key, list);
  }
  // شافل دانه‌دار داخل هر گروه (بدون seed = ترتیب بانک، مثل رفتار قبلی)
  const seed = opts?.seed;
  const rnd = seed ? mulberry32(seed) : null;
  for (const list of byGroup.values()) {
    if (!rnd) continue;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  // گردش گروهی: از هر گروه یکی تا سقف هدف (تعادل کامل سینه/پا/بازو/…)
  const groupKeys = [...byGroup.keys()];
  const chosenNames: string[] = [...preferred];
  let added = true;
  while (added && chosenNames.length < targetCount) {
    added = false;
    for (const g of groupKeys) {
      const list = byGroup.get(g);
      if (list && list.length > 0) {
        chosenNames.push(list.shift()!.name);
        added = true;
        if (chosenNames.length >= targetCount) break;
      }
    }
  }
  // v153 — fail-safe فقط وقتی بانک هیچ نمونه‌ای نداد (قبلاً «>= ۱۰» بود که
  // نمونه‌گیری بانک کوچک را بی‌اثر می‌کرد و کل بانک را برگرداندن، سقف هدف و
  // تنوع دانه‌دار را دور می‌زد)
  return chosenNames.length > 0 ? chosenNames : bank.all.map((r) => r.name);
}

/* ───────── v154 — تزریق «کامل» بانک به پرامپت (بدون سقف و بدون نمونه‌گیری) ───────── */

export interface BankPromptGroup {
  key: string;
  label: string;
  names: string[];
}

/**
 * v154 — گروه‌بندی «تمام» ردیف‌های دیتابیس برای تزریق کامل به پرامپت AI.
 *
 * قانون مالک (تیکت v154): «۹۰ تا حرکت هم کمه — تمام حرکات دیتابیس من بهش
 * تزریق بشه.» قبلاً buildBankPromptNames با سقف ۹۰ نمونه‌گیری می‌کرد؛ حالا
 * همهٔ ردیف‌های فعال (ویدیودار و بی‌ویدیو — v154 حرکت بی‌ویدیو هم مجاز شد
 * چون الصاق نزدیک‌ترین ویدیو در پس‌تایم تضمین شده) گروه‌بندی عضله‌محور و
 * کامل برمی‌گردند. نام‌های فشردهٔ تکراری (۶ گروه تکراری DB) یک‌بار می‌آیند.
 *
 * خروجی به ترتیب گروه‌های اصلی (سینه → زیربغل → سرشانه → پا → بازو → شکم → سایر)
 * است؛ «other» = کاردیو/کل‌بدن/ناشناخته.
 */
export function buildFullBankPromptGroups(rows: BankExerciseRow[]): BankPromptGroup[] {
  const grouped = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r.name !== "string" || !r.name.trim()) continue;
    const sq = squeezeExerciseName(r.name);
    if (!sq || seen.has(sq)) continue; // حذف هم‌نام فشرده (مثل buildLockedBank)
    seen.add(sq);
    const groups = majorGroupsOfExercise(r);
    const g = groups.size === 0 || groups.size >= 5 ? "other" : [...groups][0];
    const list = grouped.get(g) ?? [];
    list.push(r.name);
    grouped.set(g, list);
  }
  const order = ["chest", "back", "shoulders", "legs", "arms", "core", "other"];
  return order
    .filter((k) => grouped.has(k))
    .map((k) => ({
      key: k,
      label: MAJOR_GROUP_LABELS_FA[k] ?? (k === "other" ? "سایر (کاردیو/کل‌بدن)" : k),
      names: grouped.get(k)!,
    }));
}

/**
 * بهترین تطبیق از میان نتایج یک جستجو (کلاینت‌محور — جایگزین «اولین نتیجهٔ
 * کورکورانه» در fetchExerciseVideo). تطبیق دقیق همیشه برنده است.
 */
export function pickBestBankMatch<T extends { name: string; muscle?: string | null; [k: string]: any }>(
  queryName: string,
  candidates: T[]
): T | null {
  if (!candidates || candidates.length === 0) return null;
  const exactSq = squeezeExerciseName(queryName);
  const exact = candidates.find((c) => squeezeExerciseName(c.name) === exactSq);
  if (exact) return exact;
  let best: { item: T; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreBankCandidate(queryName, c as unknown as BankExerciseRow);
    if (!best || score > best.score) best = { item: c, score };
  }
  return best && best.score >= FUZZY_MIN_SCORE ? best.item : null;
}
