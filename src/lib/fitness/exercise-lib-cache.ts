"use client";

/**
 * v171 — کش مشترک بانک حرکات (ضد آبشار N+1 در جلسهٔ تمرین — دیرکتیو مالک)
 *
 * مشکل قبلی: کارت حرکت در «جلسهٔ تمرین» برای هر حرکت یک زنجیرهٔ sequential می‌زد:
 *   id → GET /api/exercises?ids=X → اگر خالی → search(نام کامل) → search(کلمه‌به‌کلمه)
 * یعنی وسط تمرین، برای یک روز ۶-۸ حرکتی تا ۱۰+ درخواست پشت‌سرهم — حس کندی مستقیم.
 *
 * معماری این ماژول:
 *  • getExercisesByIds(ids) — «همهٔ حرکات روز با یک درخواست» ?ids=a,b,c
 *    (سقف سرور ۱۰۰ id در هر کوئری) + کش ماژول‌سطح + تک‌پرواز.
 *  • getExerciseById(id) — تک‌حرکت از همان کش (بدون شبکه اگر موجود).
 *  • searchExercisesLib(term) — جستجوی نام با کش + تک‌پرواز؛ دیگر session/
 *    overlay/programs-view برای یک نام واحد درخواست تکراری نمی‌زنند.
 *  • searchExerciseLibWithFallback(name) — همان زنجیرهٔ فال‌بک کلمه‌به‌کلمهٔ قبلی
 *    (کلمات عمومی حذف، بلندترین اول) — فقط این‌بار از کش مشترک می‌گذرد.
 *  • getExerciseDetailById(id) — همان endpoint /api/exercises/[id] (با related)
 *    برای پنل جزئیات بانک؛ قبلاً کش روی خودِ تابع کامپوننت بود، حالا مرکزی.
 *
 * صفر تغییر در شکل payload نمایش — فقط منبعِ داده، مشترک و کش‌شده می‌شود.
 */

export interface ExerciseLibRow {
  id?: string;
  name?: string;
  muscle?: string;
  description?: string;
  tips?: string;
  videoUrl?: string;
  videoPosterUrl?: string;
  youtubeUrl?: string;
  youtubeEnabled?: boolean | null;
  /** v189 — ویدیوی Muscle Wiki (مرد/زن) */
  mwVideoUrl?: string;
  mwVideoUrlFemale?: string;
  /** v190 — کلید تک‌حرکتی Muscle Wiki */
  mwEnabled?: boolean | null;
  difficulty?: string;
  [key: string]: unknown;
}

// ─── سقف حافظهٔ کش‌ها (اپ موبایل روزها باز می‌ماند؛ Map بدون تخلیه رشد می‌کرد) ───
const LIB_CACHE_MAX = 600;

// ─── v190 — کلیدهای سراسری بانک (از پاسخ‌های API بانک گرم می‌شوند + تک‌پرواز) ───
// هر پاسخ /api/exercises و /api/bank/exercises و /api/exercises/[id] این دو گیت
// را برمی‌گرداند؛ اولین پاسخ مقدار را ثبت می‌کند و بقیه بدون درخواست اضافه
// از همین مقدار می‌خوانند. اگر هنوز هیچ پاسخی نیامده باشد، یک درخواست سبک
// /api/bank/gates زده می‌شود.
export interface BankGates {
  youtubeEnabled: boolean;
  muscleWikiEnabled: boolean;
}
let bankGates: BankGates | null = null;
let bankGatesInFlight: Promise<BankGates> | null = null;

/** ثبت گیت‌ها از هر پاسخ بانک (اگر پاسخ گیت نداشت، بی‌اثر است) */
function noteBankGates(data: { globalYoutubeEnabled?: boolean; globalMuscleWikiEnabled?: boolean } | null | undefined): void {
  if (!data) return;
  const yt = typeof data.globalYoutubeEnabled === "boolean" ? data.globalYoutubeEnabled : null;
  const mw = typeof data.globalMuscleWikiEnabled === "boolean" ? data.globalMuscleWikiEnabled : null;
  if (yt === null && mw === null) return;
  if (!bankGates) bankGates = { youtubeEnabled: yt ?? true, muscleWikiEnabled: mw ?? true };
  else {
    if (yt !== null) bankGates.youtubeEnabled = yt;
    if (mw !== null) bankGates.muscleWikiEnabled = mw;
  }
}

/** کلیدهای سراسری بانک — کش‌شده؛ اگر نامشخص، یک درخواست سبک /api/bank/gates */
export async function getBankGates(): Promise<BankGates> {
  if (bankGates) return bankGates;
  if (!bankGatesInFlight) {
    bankGatesInFlight = (async () => {
      try {
        const res = await fetch("/api/bank/gates");
        const data = await res.json();
        noteBankGates(data);
      } catch {
        // خطای شبکه → پیش‌فرض روشن
      } finally {
        bankGatesInFlight = null;
      }
      return bankGates ?? { youtubeEnabled: true, muscleWikiEnabled: true };
    })();
  }
  return bankGatesInFlight;
}

const byIdCache = new Map<string, ExerciseLibRow | null>(); // null = سرور نداشت (ضد refetch بی‌ثمر)
const batchInFlight = new Map<string, Promise<Map<string, ExerciseLibRow>>>();
const searchCache = new Map<string, ExerciseLibRow[]>();
const searchInFlight = new Map<string, Promise<ExerciseLibRow[]>>();
const detailCache = new Map<string, ExerciseLibRow | null>();
const detailInFlight = new Map<string, Promise<ExerciseLibRow | null>>();

function trimCache<T>(map: Map<string, T>): void {
  while (map.size > LIB_CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (typeof oldest !== "string") break;
    map.delete(oldest);
  }
}

/** واکشی چند حرکت بانک با «یک» درخواست ?ids=a,b,c — تک‌پرواز + کش ماژول‌سطح */
export async function getExercisesByIds(ids: Array<string | undefined | null>): Promise<Map<string, ExerciseLibRow>> {
  const result = new Map<string, ExerciseLibRow>();
  const missing: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id) continue;
    if (byIdCache.has(id)) {
      const row = byIdCache.get(id);
      if (row) result.set(id, row);
      continue;
    }
    missing.push(id);
  }

  if (missing.length > 0) {
    // کلید دسته — دو فراخوانی با همان مجموعه id = یک درخواست (تک‌پرواز)
    const batchKey = [...missing].sort().join(",");
    let batch = batchInFlight.get(batchKey);
    if (!batch) {
      batch = (async () => {
        const found = new Map<string, ExerciseLibRow>();
        try {
          const res = await fetch(`/api/exercises?ids=${encodeURIComponent(missing.join(","))}`);
          const data = await res.json();
          noteBankGates(data);
          const rows: ExerciseLibRow[] = data?.exercises || [];
          const seen = new Set<string>();
          for (const row of rows) {
            if (row?.id) {
              byIdCache.set(row.id, row);
              seen.add(row.id);
              found.set(row.id, row);
            }
          }
          // idهایی که سرور برنگرداند → null ثبت می‌شود تا هر رندر دوباره پرسیده نشود
          for (const id of missing) {
            if (!seen.has(id) && !byIdCache.has(id)) byIdCache.set(id, null);
          }
          trimCache(byIdCache);
        } catch {
          // خطای شبکه — چیزی در کش ثبت نمی‌شود تا تلاش بعدی دوباره بگیرد
        } finally {
          batchInFlight.delete(batchKey);
        }
        return found;
      })();
      batchInFlight.set(batchKey, batch);
    }
    const batchResult = await batch;
    for (const id of missing) {
      const row = batchResult.get(id) ?? byIdCache.get(id) ?? null;
      if (row) result.set(id, row);
    }
  }

  return result;
}

/** تک‌حرکت از کش مشترک (در صورت نبود → یک درخواست ids تک‌عضوی) */
export async function getExerciseById(id: string | undefined | null): Promise<ExerciseLibRow | null> {
  if (!id) return null;
  const map = await getExercisesByIds([id]);
  return map.get(id) ?? null;
}

/** جستجوی نام در بانک — با کش + تک‌پرواز (نام واحد = صفر درخواست تکراری) */
export async function searchExercisesLib(term: string): Promise<ExerciseLibRow[]> {
  const key = term.trim();
  if (!key) return [];
  const cached = searchCache.get(key);
  if (cached) return cached;
  const inflight = searchInFlight.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const params = new URLSearchParams({ search: key });
      const res = await fetch(`/api/exercises?${params.toString()}`);
      const data = await res.json();
      noteBankGates(data);
      const rows: ExerciseLibRow[] = data?.exercises || [];
      searchCache.set(key, rows);
      // ردیف‌های پیدا‌شده در کش id هم گرم می‌شوند (getExerciseById بعدی بدون شبکه)
      for (const row of rows) {
        if (row?.id && !byIdCache.has(row.id)) byIdCache.set(row.id, row);
      }
      trimCache(searchCache);
      trimCache(byIdCache);
      return rows;
    } catch {
      return [];
    } finally {
      searchInFlight.delete(key);
    }
  })();
  searchInFlight.set(key, promise);
  return promise;
}

const COMMON_SEARCH_WORDS = new Set([
  "با", "دمبل", "هالتر", "دستگاه", "سیم‌کش", "سیم", "کش", "کابل", "وزن", "بدن", "روی", "از", "به", "و", "را",
]);

/**
 * همان زنجیرهٔ فال‌بک قبلی (v118): اول جستجوی نام کامل؛ اگر خالی بود، کلمات
 * متمایز (بدون کلمات عمومی) از بلند به کوتاه یکی‌یکی — با این تفاوت که همهٔ
 * تلاش‌ها از کش مشترک می‌گذرند و بین session/overlay/programs مشترک‌اند.
 */
export async function searchExerciseLibWithFallback(name: string): Promise<ExerciseLibRow[]> {
  let list = await searchExercisesLib(name);
  if (list.length === 0) {
    const words = name
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !COMMON_SEARCH_WORDS.has(w));
    const sortedWords = [...words].sort((a, b) => b.length - a.length);
    for (const word of sortedWords) {
      list = await searchExercisesLib(word);
      if (list.length > 0) break;
    }
  }
  return list;
}

/**
 * بهترین تطبیق از لیست نتایج — همان منطق امتیازدهی قبلی (تطبیق دقیق همیشه
 * برتر؛ وگرنه بیشترین اشتراک کلمات ≥۲ حرفی).
 */
export function pickBestLibMatch(planName: string, list: ExerciseLibRow[]): ExerciseLibRow | null {
  if (list.length === 0) return null;
  return list.reduce((best, e) => {
    if (e.name === planName) return e;
    const planWords = new Set(planName.split(/\s+/));
    const libWords = new Set((e.name || "").split(/\s+/));
    let shared = 0;
    planWords.forEach((w) => {
      if (libWords.has(w) && w.length >= 2) shared++;
    });
    const bestShared = best
      ? (() => {
          let s = 0;
          planWords.forEach((w) => {
            if (new Set((best.name || "").split(/\s+/)).has(w) && w.length >= 2) s++;
          });
          return s;
        })()
      : -1;
    return shared > bestShared ? e : best;
  }, list[0]);
}

/**
 * خواندن همگام از کش جزئیات (بدون شبکه) — برای رندر مشتق فوری در پنل بانک
 * (اگر حرکت قبلاً باز شده، همان لحظه نمایش داده می‌شود — بدون setState همگام).
 */
export function peekExerciseDetail(id: string | undefined | null): ExerciseLibRow | null {
  if (!id) return null;
  return detailCache.get(id) ?? null;
}

/**
 * جزئیات کامل یک حرکت بانک از /api/exercises/[id] (همان endpoint قبلی پنل
 * بانک — با related) — کش سشن + تک‌پرواز؛ قبلاً کش روی خودِ تابع کامپوننت
 * بود و بین بازشدن‌های پنل مشترک نمی‌شد.
 */
export async function getExerciseDetailById(id: string | undefined | null): Promise<ExerciseLibRow | null> {
  if (!id) return null;
  if (detailCache.has(id)) return detailCache.get(id) ?? null;
  const inflight = detailInFlight.get(id);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const res = await fetch(`/api/exercises/${encodeURIComponent(id)}`);
      const data = await res.json();
      noteBankGates(data);
      if (data?.exercise) {
        const d = data.exercise as ExerciseLibRow;
        detailCache.set(id, d);
        trimCache(detailCache);
        return d;
      }
      detailCache.set(id, null);
      return null;
    } catch {
      // بی‌صدا — فال‌بک به دادهٔ خود حرکت برنامه
      return null;
    } finally {
      detailInFlight.delete(id);
    }
  })();
  detailInFlight.set(id, promise);
  return promise;
}
