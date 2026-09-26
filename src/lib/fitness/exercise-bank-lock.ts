/**
 * ─────────────────────────────────────────────────────────────────────────
 * exercise-bank-lock.ts (v117) — «قفل بانک حرکات»
 *
 * قانون مطلق مالک:
 *   «در آینده هم هر حرکتی که هوش مصنوعی به کاربر می‌دهد باید وجود داشته باشد.
 *    حرکات تجویزی در تمام رشته‌ها باید با بانک حرکات سینک باشد و توضیحی که در
 *    برنامهٔ کاربر وجود دارد دقیقاً به بانک درست اشاره کند.
 *    پیش نیاید حرکتی به کاربر داده شود که ویدیو نداشته باشد.»
 *
 * سه گارد که این قانون را تضمین می‌کنند (همهٔ مسیرهای تولید برنامه — خرید،
 * بازنویسی ادمین، درخواست چت — از generateWorkoutPlan می‌گذرند):
 *
 *   ۱) پرس‌تایم: به AI فقط حرکات «ویدیودار» بانک داده می‌شود
 *      (buildBankPromptNames) — مدل اصلاً نام حرکت بی‌ویدیو نمی‌بیند.
 *
 *   ۲) پس‌تایم (قفل سخت): خروجی AI ردیف‌به‌ردیف با بانک تطبیق داده می‌شود:
 *        • نام دقیق/معادل → نام «استاندارد بانک» جایگزین می‌شود (canonical)
 *        • نام موهومی/خارج از بانک → با نزدیک‌ترین حرکت ویدیودارِ همان عضله
 *          جایگزین می‌شود (دستور ست/تکرار/RPE کاربر حفظ می‌شود)
 *        • هر حرکتِ برنامه exerciseId واقعی بانک می‌گیرد → ارجاع دقیق
 *
 *   ۳) نمایش: fetchExerciseVideo با exerciseId ردیف دقیق بانک را می‌خواند
 *      (بدون حدس نام) — در programs-view.
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
 * کلید رفع ابهام: پسوند «با X» حذف می‌شود —
 * «پرس بالاسینه هالتر» == «پرس بالاسینه با هالتر» (همان الگوی seed v114)
 */
export function exerciseDedupeKey(input: string): string {
  return squeezeExerciseName(input).replace(/با\S+$/u, "") || squeezeExerciseName(input);
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
  const all = rows.filter((r) => hasUsableVideo(r, globalYoutube));
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

/* ───────────────────────── قفل برنامهٔ تمرینی ───────────────────────── */

/** زیر حد این تعداد حرکت ویدیودار، جایگزینی اجباری غیرفعال می‌شود (fail-safe) */
const MIN_BANK_FOR_HARD_LOCK = 10;

export interface PlanLockReport {
  canonicalized: number; // نام AI با نام استاندارد بانک یکسان شد (معادل)
  fuzzyFixed: number; // نامِ متفاوت ولی همان حرکت → نام/توضیح استاندارد
  replaced: Array<{ day: string; from: string; to: string }>; // نام غریبه → جایگزین بانک
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
>(plan: T, bank: LockedBank): PlanLockReport {
  const report: PlanLockReport = { canonicalized: 0, fuzzyFixed: 0, replaced: [], unlocked: false };
  if (!plan || !Array.isArray(plan.days)) return report;
  const hardLock = bank.all.length >= MIN_BANK_FOR_HARD_LOCK;

  for (const day of plan.days) {
    if (!day) continue;
    const dayLabel = day.day || "؟";
    const usedIds = new Set<string>();
    const exList = Array.isArray(day.exercises) ? day.exercises : [];

    // جایگزین‌ها نباید در یک روز تکراری شوند
    for (const ex of exList) {
      const m = ex?.name ? resolveBankMatch(ex.name, bank) : null;
      if (m) usedIds.add(m.row.id);
    }

    for (const ex of exList) {
      if (!ex || typeof ex.name !== "string" || !ex.name.trim()) continue;
      const original = ex.name;
      const match = resolveBankMatch(original, bank);

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

      // نام غریبه — خارج از بانک
      if (hardLock) {
        const muscle = squeezeExerciseName(ex.muscle || "");
        const category = ex.category || "";
        // v117 — امتیاز کیفیت جایگزین: حرکات اصلی/عمومی بانک اولویت دارند
        // (نام بدون پرانتز انگلیسی = حرکت پایهٔ بانک، نه حرکت تخصصی رشته)
        const qualityOf = (r: BankExerciseRow): number => {
          let s = 0;
          const rm = squeezeExerciseName(r.muscle || "");
          if (category && r.category === category) s += 30;
          if (muscle && rm && (rm.includes(muscle) || muscle.includes(rm))) s += 20;
          if (!r.name.includes("(")) s += 15; // حرکت پایهٔ بانک (بدون پسوند تخصصی)
          return s;
        };
        let replacement: BankExerciseRow | null = null;
        let replacementScore = -1;
        for (const r of bank.all) {
          if (usedIds.has(r.id)) continue;
          const s = qualityOf(r);
          if (s > replacementScore) {
            replacement = r;
            replacementScore = s;
          }
        }

        if (replacement) {
          usedIds.add(replacement.id);
          ex.exerciseId = replacement.id;
          ex.name = replacement.name;
          ex.description = (replacement.description || "").trim();
          ex.tips = (replacement.tips || "").trim();
          delete ex.coachTip;
          if (replacement.muscle) ex.muscle = replacement.muscle;
          if (replacement.category) ex.category = replacement.category;
          report.replaced.push({ day: dayLabel, from: original, to: replacement.name });
          continue;
        }
      }
      // بدون جایگزین ممکن: حرکت با نام خودش می‌ماند (fail-safe — حذف ممنوع)
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
 * فهرست نام‌هایی که به AI داده می‌شود — فقط حرکات ویدیودار بانک.
 * ترتیب: حرکات اختصاصی رشته (اگر در بانک باشند) + پرکردن تا حداقل minCount
 * از بقیهٔ بانک. در بانک خیلی کوچک، نام‌های رشته به‌تنهایی کافی نیستند —
 * همیشه حداقل ۱۰ نام برگردانده می‌شود یا خالی (فال‌بک امن سرور).
 */
export function buildBankPromptNames(bank: LockedBank, disciplineNames: string[] = [], minCount = 25): string[] {
  if (bank.all.length === 0) return [];
  const wanted = disciplineNames
    .map((n) => (bank.byExact.get(squeezeExerciseName(n)) || bank.byDedupe.get(exerciseDedupeKey(n)) || null))
    .filter((r): r is BankExerciseRow => !!r);
  const preferred = wanted.map((r) => r.name);
  if (preferred.length >= minCount) return preferred;
  const rest = bank.all.filter((r) => !preferred.includes(r.name)).map((r) => r.name);
  const chosen = [...preferred, ...rest].slice(0, Math.max(minCount, preferred.length));
  return chosen.length >= 10 ? chosen : bank.all.map((r) => r.name);
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
