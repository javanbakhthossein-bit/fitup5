"use client";

/**
 * v171 — لایهٔ واکشی مشترک پنل کاربر — SWR کامل (stale-while-revalidate)
 *
 * دیرکتیو مالک: «داشبورد و کل پنل باید مثل اپ نصب‌شدهٔ سنگین، فوری و نرم بالا بیاید».
 *
 * مشکلی که حل می‌کند:
 *  ۱) تکرار درخواست: هر view پنل (داشبورد/تمرین‌ها/تغذیه/…) در mount خودش همان
 *     endpointها را جداگانه می‌گرفت — سوییچ تب = دانلود دوبارهٔ پلن، دو درخواست
 *     همزمان وضعیت تحلیل بدن، دو fetch پشت‌سرهم پیشرفت بدنی و…
 *  ۲) اسپینر روی هر بازگشت به تب: رفتار قبلی «تا TTL هیچ، بعد از TTL صبرِ شبکه»
 *     بود — یعنی هر بار که کش منقضی می‌شد UI دوباره منتظر شبکه می‌ماند (فلیکر).
 *
 * معماری v171 (موتور مشترک createSwrFetcher):
 *  • single-flight — هیچ‌وقت بیش از یک درخواستِ هم‌زمان برای یک endpoint.
 *  • کش ماژول‌سطح با TTL — کش تازه → پاسخ فوری بدون شبکه (رفتار قبلی).
 *  • SWR — کش موجود ولی منقضی → «همان لحظه» مقدار کش‌شده resolve می‌شود و
 *    یک رفرش پس‌زمینه (تک‌پرواز) شروع می‌شود؛ مشترک‌های زنده با دادهٔ تازه
 *    از طریق subscribe() به‌روز می‌شوند (بدون اسپینر، بدون فلیکر).
 *  • stale-while-error — شکست شبکه هرگز کشِ قبلی را نابود نمی‌کند.
 *  • invalidate + شمارندهٔ نسل — پاسخِ در-flightِ قبل از invalidation دیگر
 *    کش نمی‌شود (ضد نوشتن دادهٔ کهنه بعد از «برنامه عوض شد» و…).
 *
 * تازگی واقعی همان مسیرهای قبلی است: پالس ۳ثانیه‌ای + رویدادهای
 * fitup-program-updated/fitup-plan-changed + invalidate بعد از هر ثبت/آپلود.
 */

// ───────────────────────────── موتور مشترک SWR ─────────────────────────────

interface SwrEntry<T> {
  at: number;
  data: T;
}

interface SwrState<T> {
  entry: SwrEntry<T> | null;
  inFlight: { gen: number; promise: Promise<T | null> } | null;
  generation: number;
  listeners: Set<(data: T) => void>;
}

export interface SwrFetcher<T> {
  (): Promise<T | null>;
  /** باطل‌کردن کش — بعد از هر ثبت/آپلود/رویداد تغییر سمت سرور */
  invalidate: () => void;
  /** اشتراک: با هر رفرش موفق پس‌زمینه، دادهٔ تازه به مشترک می‌رسد */
  subscribe: (cb: (data: T) => void) => () => void;
  /** خواندن «سنکرون» کش — برای مقدار اولیهٔ useState در ویوها (ضد فلش یک‌فریمی)
   *  v171 — فلش مودال‌ها: ویو با useState(true) شروع می‌شد و کش در میکروتسکِ
   *  بعد از رندر اول resolve می‌شد → یک فریم اسکلتون قبل از داده. حالا
   *  useState(() => fetcher.peek() == null) یعنی با کش موجود، اولین رندر داده است. */
  peek: () => T | null;
}

function createSwrFetcher<T>(
  url: string,
  ttlMs: number,
  opts?: { requireOk?: boolean }
): SwrFetcher<T> {
  const requireOk = opts?.requireOk ?? false;
  const state: SwrState<T> = {
    entry: null,
    inFlight: null,
    generation: 0,
    listeners: new Set(),
  };

  function notify(data: T): void {
    for (const l of state.listeners) {
      try {
        l(data);
      } catch {
        // شنوندهٔ خراب هرگز کش سراسری را نمی‌شکند
      }
    }
  }

  function startFetch(): Promise<T | null> {
    const gen = state.generation;
    const promise = (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        // پاسخ ۴۰۱/۵۰۰ → مثل خطا: کش نمی‌شود (data کهنهٔ قبلی معتبر می‌ماند)
        if (requireOk && !res.ok) return null;
        const data = (await res.json()) as T;
        // بدنهٔ خالی → کش نمی‌شود (تا کش «پوچ» برای کل TTL قفل نشود)
        if (data == null) return null;
        if (gen === state.generation) {
          state.entry = { at: Date.now(), data };
          notify(data);
        }
        return data;
      } catch {
        // stale-while-error — کش قبلی (اگر هست) سرجایش می‌ماند
        return null;
      } finally {
        if (state.inFlight && state.inFlight.gen === gen) state.inFlight = null;
      }
    })();
    state.inFlight = { gen, promise };
    return promise;
  }

  function getOrStart(): Promise<T | null> {
    if (state.inFlight && state.inFlight.gen === state.generation) {
      return state.inFlight.promise;
    }
    return startFetch();
  }

  const fetcher = (() => {
    const e = state.entry;
    if (e && Date.now() - e.at < ttlMs) {
      // کش تازه — صفر شبکه (رفتار v170)
      return Promise.resolve(e.data);
    }
    if (e) {
      // ─── SWR — قلب تغییر v171 ───
      // کش منقضی: مقدار موجود «همین حالا» برمی‌گردد (رندر فوری، بدون اسپینر)
      // و همزمان رفرش تک‌پرواز پس‌زمینه شروع می‌شود؛ مشترک‌های زنده با
      // دادهٔ تازه notify می‌شوند.
      void getOrStart();
      return Promise.resolve(e.data);
    }
    return getOrStart();
  }) as SwrFetcher<T>;

  fetcher.invalidate = () => {
    // نسل بعد — پاسخ in-flight قبلی (قبل از تغییر سمت سرور) دیگر کش/notify نمی‌شود
    state.generation++;
    state.entry = null;
  };

  fetcher.subscribe = (cb) => {
    state.listeners.add(cb);
    return () => {
      state.listeners.delete(cb);
    };
  };

  fetcher.peek = (): T | null => state.entry?.data ?? null;

  return fetcher;
}

// ────────────────────────────── /api/coach/plan ──────────────────────────────
// سنگین‌ترین endpoint mount-time پنل — توسط داشبورد/تمرین‌ها/تغذیه/پروفایل
// ورزشی مصرف می‌شود. ۳۰ ثانیه single-flight یعنی سوییچ سریع بین تب‌ها هرگز
// دوباره دانلود نمی‌کند (مگر واقعاً تغییر کرده باشد — رویداد پالس invalid می‌کند).

export interface CoachPlanPayload {
  workout?: unknown;
  meal?: unknown;
  /** v171 — متادیتای نسخهٔ برنامه (مُهرِ ارزان برای گارد تغییر — به‌جای stringify سنگین) */
  workoutMeta?: { version?: number; createdAt?: string | null; generatedSource?: string | null } | null;
  mealMeta?: { version?: number; createdAt?: string | null; generatedSource?: string | null } | null;
  programStatus?: string | null;
}

const coachPlanFetcher = createSwrFetcher<CoachPlanPayload>("/api/coach/plan", 30_000);

export function fetchCoachPlanCached(): Promise<CoachPlanPayload | null> {
  return coachPlanFetcher();
}

/** v171 — خواندن سنکرون کش پلن (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekCoachPlanCached(): CoachPlanPayload | null {
  return coachPlanFetcher.peek();
}

/** باطل‌کردن کش پلن — روی رویدادهای «برنامه عوض شد» صدا زده می‌شود */
export function invalidateCoachPlanCache(): void {
  coachPlanFetcher.invalidate();
}

// ─────────────────────── /api/coach/submit-body-analysis ───────────────────────
// قبلاً PrerequisitesBanner و BodyAnalysisBanner در همان tickِ mount داشبورد
// هر دو همین endpoint را می‌گرفتند (دو درخواست سنگین در هر ورود به داشبورد).

const bodyAnalysisFetcher = createSwrFetcher<unknown>("/api/coach/submit-body-analysis", 30_000);

export function fetchBodyAnalysisStatusCached(): Promise<unknown> {
  return bodyAnalysisFetcher();
}

/** v171 — خواندن سنکرون کش وضعیت تحلیل بدن (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekBodyAnalysisStatusCached(): unknown {
  return bodyAnalysisFetcher.peek();
}

/** باطل‌کردن کش وضعیت تحلیل بدن (بعد از آپلود عکس بدن و…) */
export function invalidateBodyAnalysisStatusCache(): void {
  bodyAnalysisFetcher.invalidate();
}

// ───────────────────────────── /api/progress ─────────────────────────────
// کارت پیشرفت بدنی داشبورد + تب پیشرفت + اورلی پروفایل — ۶۰ ثانیه single-flight.

export interface ProgressSummaryPayload {
  bodyCompositionHistory?: Array<{
    date: string;
    weight: number;
    bodyFatPercent: number;
    leanBodyMass: number | null;
  }>;
  hasBodyMeasurements?: boolean;
  [key: string]: unknown;
}

const progressFetcher = createSwrFetcher<ProgressSummaryPayload>(
  "/api/progress",
  60_000,
  { requireOk: true }
);

export function fetchProgressSummaryCached(): Promise<ProgressSummaryPayload | null> {
  return progressFetcher();
}

/** v171 — خواندن سنکرون کش پیشرفت بدنی (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekProgressSummaryCached(): ProgressSummaryPayload | null {
  return progressFetcher.peek();
}

// ───────────────────── /api/body-composition/history ─────────────────────

const bodyCompFetcher = createSwrFetcher<{ history?: unknown[] }>(
  "/api/body-composition/history",
  60_000,
  { requireOk: true }
);

export function fetchBodyCompHistoryCached(): Promise<{ history?: unknown[] } | null> {
  return bodyCompFetcher();
}

/** v171 — خواندن سنکرون کش ترکیب بدنی (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekBodyCompHistoryCached(): { history?: unknown[] } | null {
  return bodyCompFetcher.peek();
}

/** باطل‌کردن همهٔ کش‌های پیشرفت بدنی (بعد از ثبت وزن/اندازه/چکاپ) */
export function invalidateBodyProgressCaches(): void {
  progressFetcher.invalidate();
  bodyCompFetcher.invalidate();
}

// ───────────────────── /api/coach/program-history ─────────────────────
// v171 — از dashboard-view.tsx مرکزیت‌شد: قبلاً داشبورد کش ۲۰s خودش را داشت
// ولی پولِ پشتیبانِ ۳۰s آن fetchJson خام می‌زد (کش را دور می‌زد) و تب
// «برنامه‌ها» هم کلاً خام fetch می‌کرد → سه مصرف‌کننده = درخواست‌های تکراری.
// حالا هر سه از همین واکشی SWR با اشتراک زنده استفاده می‌کنند.

export interface ProgramHistoryPayload {
  programStatus?: string | null;
  programs?: unknown[];
  analysis?: unknown;
  [key: string]: unknown;
}

const programHistoryFetcher = createSwrFetcher<ProgramHistoryPayload>(
  "/api/coach/program-history",
  20_000,
  { requireOk: true }
);

export function fetchProgramHistoryCached(): Promise<ProgramHistoryPayload | null> {
  return programHistoryFetcher();
}

/** v171 — خواندن سنکرون کش تاریخچهٔ برنامه (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekProgramHistoryCached(): ProgramHistoryPayload | null {
  return programHistoryFetcher.peek();
}

export function invalidateProgramHistoryCache(): void {
  programHistoryFetcher.invalidate();
}

export function subscribeProgramHistoryCache(
  cb: (data: ProgramHistoryPayload) => void
): () => void {
  return programHistoryFetcher.subscribe(cb);
}

// ───────────────────────────── /api/checkup ─────────────────────────────
// v171 — قبلاً در «یک mount» تب پیشرفت دو بار گرفته می‌شد (پarent ProgressView
// + فرزند CheckupSection). حالا هر دو از همین واکشی single-flight استفاده
// می‌کنند؛ بعد از ثبت چکاپ/اندازه، invalidate → رفرش واقعی.

export interface CheckupPayload {
  checkups?: any[];
  schedule?: any;
  [key: string]: unknown;
}

const checkupFetcher = createSwrFetcher<CheckupPayload>("/api/checkup", 60_000, {
  requireOk: true,
});

export function fetchCheckupCached(): Promise<CheckupPayload | null> {
  return checkupFetcher();
}

/** v171 — خواندن سنکرون کش چکاپ (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekCheckupCached(): CheckupPayload | null {
  return checkupFetcher.peek();
}

export function invalidateCheckupCache(): void {
  checkupFetcher.invalidate();
}

export function subscribeCheckupCache(cb: (data: CheckupPayload) => void): () => void {
  return checkupFetcher.subscribe(cb);
}

// ──────────────────────────── /api/referral/code ────────────────────────────
// v171 — دو مصرف‌کننده (تب معرفی + پشتیبانی/FAQ) — ۱۲۰ ثانیه single-flight.
// کد معرفی/مبلغ پاداش به‌ندرت عوض می‌شود؛ TTL بلند کاملاً امن است.

export interface ReferralCodePayload {
  referralCode?: string;
  referralLink?: string;
  rewardAmount?: number;
  stats?: unknown;
  recentReferrals?: unknown[];
  [key: string]: unknown;
}

const referralCodeFetcher = createSwrFetcher<ReferralCodePayload>(
  "/api/referral/code",
  120_000,
  { requireOk: true }
);

export function fetchReferralCodeCached(): Promise<ReferralCodePayload | null> {
  return referralCodeFetcher();
}

/** v171 — خواندن سنکرون کش کد معرفی (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekReferralCodeCached(): ReferralCodePayload | null {
  return referralCodeFetcher.peek();
}

export function invalidateReferralCodeCache(): void {
  referralCodeFetcher.invalidate();
}

// ───────────────────────── /api/user-discount-code ─────────────────────────
// v171 — دو مصرف‌کننده (تب پلن‌ها + مودال تمدید) — ۱۲۰ ثانیه، «به‌ازای هر کاربر»
// (کش کلید-شده با userId تا دادهٔ کاربر قبلی هرگز به کاربر بعدی نرسد).

export interface UserDiscountCodePayload {
  code?: string | null;
  value?: number;
  type?: string;
  validUntil?: string | null;
  isUsed?: boolean;
  expiresSoon?: boolean;
  isExpired?: boolean;
  expiredDaysAgo?: number | null;
  daysLeft?: number;
  subEndDate?: string | null;
  currentPlanId?: string | null;
  planStartedAt?: string | null;
  planDurationDays?: number;
  workoutsCompleted?: number | null;
  weightStartKg?: number | null;
  weightCurrentKg?: number | null;
  [key: string]: unknown;
}

const USER_DISCOUNT_TTL_MS = 120_000;
const discountFetchers = new Map<string, SwrFetcher<UserDiscountCodePayload>>();

function discountFetcherFor(userId: string | null | undefined): SwrFetcher<UserDiscountCodePayload> {
  const key = userId || "anon";
  let f = discountFetchers.get(key);
  if (!f) {
    f = createSwrFetcher<UserDiscountCodePayload>("/api/user-discount-code", USER_DISCOUNT_TTL_MS, {
      requireOk: true,
    });
    discountFetchers.set(key, f);
  }
  return f;
}

export function fetchUserDiscountCodeCached(
  userId?: string | null
): Promise<UserDiscountCodePayload | null> {
  return discountFetcherFor(userId)();
}

/** v171 — خواندن سنکرون کش کد تخفیف کاربر (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekUserDiscountCodeCached(
  userId?: string | null
): UserDiscountCodePayload | null {
  return discountFetcherFor(userId).peek();
}

export function invalidateUserDiscountCodeCache(): void {
  for (const f of discountFetchers.values()) f.invalidate();
}

// ───────────────────────── /api/onboarding/analysis ─────────────────────────
// v171 — دو مصرف‌کننده (اورلی پروفایل + مودال پروندهٔ ورزشی) — ۱۲۰ ثانیه.
// ⚠️ بعد از هر PUT /api/onboarding/profile حتماً invalidateOnboardingAnalysisCache
// صدا زده شود (مودال پرونده این کار را در saveSection انجام می‌دهد).

export interface OnboardingAnalysisPayload {
  profile?: any;
  baseline?: any;
  analysis?: any;
  bmi?: number | null;
  bmr?: number | null;
  tdee?: number | null;
  bodyFatPercent?: number | null;
  musclePercent?: number | null;
  bodyCompositionAt?: string | null;
  memberSince?: string | null;
  [key: string]: unknown;
}

const onboardingAnalysisFetcher = createSwrFetcher<OnboardingAnalysisPayload>(
  "/api/onboarding/analysis",
  120_000,
  { requireOk: true }
);

export function fetchOnboardingAnalysisCached(): Promise<OnboardingAnalysisPayload | null> {
  return onboardingAnalysisFetcher();
}

/** v171 — خواندن سنکرون کش تحلیل آنبوردینگ (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekOnboardingAnalysisCached(): OnboardingAnalysisPayload | null {
  return onboardingAnalysisFetcher.peek();
}

export function invalidateOnboardingAnalysisCache(): void {
  onboardingAnalysisFetcher.invalidate();
}

// ───────────────────────────── /api/user-media ─────────────────────────────
// v171 — دو مصرف‌کننده (تب پیشرفت + مودال پروندهٔ ورزشی) — ۱۲۰ ثانیه.
// ⚠️ بعد از آپلود/حذف عکس پیشرفت حتماً invalidateUserMediaCache (تب پیشرفت انجام می‌دهد).

export interface UserMediaPayload {
  planGroups?: any[];
  bodyPhotos?: any[];
  videos?: any[];
  bloodTests?: any[];
  [key: string]: unknown;
}

const userMediaFetcher = createSwrFetcher<UserMediaPayload>("/api/user-media", 120_000, {
  requireOk: true,
});

export function fetchUserMediaCached(): Promise<UserMediaPayload | null> {
  return userMediaFetcher();
}

/** v171 — خواندن سنکرون کش مدیای کاربر (مقدار اولیهٔ ویوها — ضد فلش) */
export function peekUserMediaCached(): UserMediaPayload | null {
  return userMediaFetcher.peek();
}

export function invalidateUserMediaCache(): void {
  userMediaFetcher.invalidate();
}
