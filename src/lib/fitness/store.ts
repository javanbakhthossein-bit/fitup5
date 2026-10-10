"use client";

import { useSyncExternalStore } from "react";
import { create, type StoreApi } from "zustand";
import { isAppShellMode } from "./app-bridge";
import { clearAuthHint } from "./auth-hint";
// v190 — استک «بک درونی پنل» (ناوبری پله‌پله با back گوشی/مرورگر)
import {
  closePanelEntry,
  ensurePanelEntry,
  resetPanelBack,
} from "./panel-back";
import type {
  OnboardingData,
  WorkoutPlanContent,
  MealPlanContent,
  ChatMessageDto,
  NotificationDto,
  Plan,
} from "./types";

export interface LoggedFood {
  id: string;
  name: string;
  meal: "breakfast" | "lunch" | "dinner" | "snack";
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  /** اندازه/تعداد وعده — مثلاً "۱.۵ وعده" یا "۲۰۰ گرم" */
  servingSize?: string;
  /** منبع ثبت غذا */
  source?: "manual" | "library" | "ai_photo";
  /** اگر از بانک غذاها انتخاب شده */
  foodLibraryId?: string | null;
  /** اگر از تحلیل عکس غذا آمده، URL عکس */
  imageUrl?: string | null;
}

export interface BodyMeasurements {
  waist?: number; // دور کمر
  arm?: number; // دور بازو
  chest?: number; // دور سینه
  hip?: number; // دور باسن
  updatedAt?: string;
}

export interface ActiveSession {
  dayId: string;
  startedAt: string;
  currentExerciseIdx: number;
  loggedSets: Record<string, { weight: number; reps: number; done: boolean }[]>;
}

// ═══ v183 — جلسهٔ تمرین چالش (معماری مستقل از activeSession برنامهٔ پولی —
// صفر تداخل با جلسهٔ تمرین هدایت‌شدهٔ برنامه — دیرکتیو مالک: بدون هیچ باگ) ═══
export interface ActiveChallengeSession {
  challengeSlug: string;
  dayNumber: number;
  startedAt: string;
  currentStepIdx: number;
  loggedSets: Record<string, { weight: number; reps: number; done: boolean }[]>;
}

export interface GymTrack {
  id: string;
  name: string;
  url: string; // object URL from File API
  duration?: number;
  artist?: string;
  blob?: Blob; // raw audio blob for IndexedDB persistence
}

export type AppScreen =
  | "loading"
  | "landing"
  | "referral-landing"
  | "auth"
  | "onboarding"
  | "analysis"
  | "main"
  | "admin"
  | "blocked";
// v113 — «tool-exercises» و «exercise-detail» حذف شدند (تک‌نسخه‌سازی بانک
// حرکات روی مسیرهای واقعی SSR — باگ دو-طراحی با رفرش)؛ ناوبری با
// navigateToExercises/navigateToExercise از navigation.ts.
// v118 — «tool-foods» و «food-detail» هم با همان الگو حذف شدند.
// v119 — «articles» ، «article» ، «tool-tdee» ، «sport-detail» ، «terms» ،
// «contact» و «about» هم حذف شدند (دیرکتیو مالک: این مشکل در هیچ جای سایت
// نباید باشد) — همهٔ صفحات عمومی فقط مسیر واقعی SSR دارند.

export type MainTab =
  | "dashboard"
  | "programs"
  | "workouts"
  | "nutrition"
  | "progress"
  | "chat"
  | "plans"
  | "referral"
  | "support"
  | "mobileapp"
  // v139 (دیرکتیو مالک) — بانک حرکات و بانک غذاها «داخل پنل» — طراحی ایزوله،
  // بدون خروج به مسیر عمومی؛ بک از این تب‌ها به داشبورد برمی‌گردد (همان
  // رفتار بقیهٔ تب‌های پنل — popstate handler در page-client).
  | "exercise-bank"
  | "food-bank"
  // v143 (دیرکتیو مالک) — مسیریاب پیاده‌روی/دویدن هم «داخل پنل» آمد؛
  // صفحهٔ مستقل /activity حالا فقط ریدایرکت به همین تب است.
  | "activity"
  // v183 (دیرکتیو مالک) — چالش‌های فیتاپ — رایگان برای همه، تفکیک جنسیتی سفت
  | "challenges";

interface UserDto {
  id: string;
  mobile: string;
  name: string | null;
  /** عکس پروفایل (webp ریسایزشده) — null = آیکون پیش‌فرض */
  avatarUrl?: string | null;
  role: string;
  onboardingDone: boolean;
  hasActiveSubscription: boolean;
  /** اشتراک pending (advanced/ultimate — پیش‌نیازها تکمیل نشده) */
  hasPendingSubscription?: boolean;
  subscriptionEnd: string | null;
  planName: Plan | null;
  planExpiresAt: string | null;
  /** v53: شروع دورهٔ پلن فعال — نوار پیشرفت دوره در داشبورد */
  planStartedAt?: string | null;
  // آخرین پلن (حتی منقضی) — برای renewal banner و نمایش وضعیت
  lastPlanName?: Plan | null;
  lastPlanExpiresAt?: string | null;
  /** v78 — قابلیت «بازطراحی برنامه (یکبار در طول اشتراک)» از چت (کارت پلن + تولتیپ) */
  planRegen?: { eligible: boolean; pending: boolean; used: boolean };
  walletBalance: number;
  acceptedTermsVersion: number | null;
  // === AI usage counters (for plan limit display in blood-test/video-analysis views) ===
  videoAnalysisUsed?: number;
  bloodTestUsed?: number;
  // === Prerequisite decision fields ===
  videoStatus?: string | null; // null | "uploaded" | "skipped"
  bloodTestStatus?: string | null; // null | "declined" | "pending_blood_test" | "waiting"
}

// ═══ Task 3-b: وضعیت «روز کامل» مشترک تمرین + تغذیه (مدال روز) ═══
// سکشن مشترک حالت باشگاه / جلسهٔ هدایت‌شده / کالری‌شمار — تکمیلِ هر مسیر
// به‌طور خودکار در مسیر دیگر ثبت می‌شود (DayCompletion سمت سرور).
export interface DailyStatusState {
  /** کلید روز تهران (YYYY-MM-DD) که این وضعیت به آن تعلق دارد — null = هنوز لود نشده */
  date: string | null;
  workoutDone: boolean;
  nutritionDone: boolean;
  /** workoutDone && nutritionDone — شرط نمایش مدال طلایی روز */
  dayComplete: boolean;
  /** اولین بار که مدال این روز دیده شد (ISO) — null = هنوز دیده نشده */
  medalSeenAt: string | null;
  /** آیا حداقل یک‌بار GET /api/daily-status اجرا شده؟ (موفق یا ناموفق) */
  loaded: boolean;
}

export const DEFAULT_DAILY_STATUS: DailyStatusState = {
  date: null,
  workoutDone: false,
  nutritionDone: false,
  dayComplete: false,
  medalSeenAt: null,
  loaded: false,
};

// ═══ v137: مسیر پیشرفت از ثبت‌نام تا امروز (نمودار گیمیفایکشن داشبورد + کارت مشکی) ═══
export interface JourneyData {
  registeredAt: string;
  daysWithFitup: number;
  goal: { key: string; label: string } | null;
  height: number | null;
  // v159 (T6) — «تشخیص قطعی» درصد چربی/عضله (کارت مشکی داشبورد — اختیاری
  // برای سازگاری با کش‌های سشن قدیمی)
  bodyFatPercent?: number | null;
  musclePercent?: number | null;
  startWeight: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
  weightSeries: Array<{ d: string; w: number }>;
  workoutDays: number;
  fullDays: number;
  checkupCount: number;
  weightLogCount: number;
  plansPurchased: number;
  currentStreak: number;
  bestStreak: number;
  /** v138 — مسیریاب فیتاپ: جلسه‌های ۷ روز اخیر (اختیاری برای سازگاری کش قدیمی) */
  activity7d?: { count: number; distanceM: number };
  last7: Array<{ date: string; workoutDone: boolean; nutritionDone: boolean; dayComplete: boolean }>;
  xp: number;
  level: {
    index: number;
    name: string;
    emoji: string;
    min: number;
    next: { name: string; min: number } | null;
    progress: number;
  };
}

export type DailyStatusPatch = Partial<Omit<DailyStatusState, "loaded">> & { loaded?: boolean };

interface AppState {
  // Auth
  screen: AppScreen;
  user: UserDto | null;
  setUser: (u: UserDto | null) => void;
  setScreen: (s: AppScreen) => void;
  /**
   * v143 — کاربر سبک حل‌شده در SSR برای هدر/هیرو لندینگ (صفر فلش «شروع ↔ اسم»).
   * مستقل از `user` است تا جریان auth (doAuthCheck/refreshUserIfNeeded) دست نخورد؛
   * هدر لندینگ «user ?? ssrLandingUser» را نشان می‌دهد و با تعیین تکلیف قطعی
   * auth/me هم‌گام می‌شود (لاگ‌اوت واقعی → null).
   */
  ssrLandingUser: { name: string; onboardingDone: boolean } | null;

  // New-terms modal — set to true when /api/auth/me returns
  // `termsUpdateRequired: true` (user was logged out due to outdated
  // TermsVersion). The global NewTermsModal renders on top of whatever
  // screen the user is on; on accept it clears this flag and navigates
  // to the auth screen for OTP.
  termsUpdateRequired: boolean;
  setTermsUpdateRequired: (v: boolean) => void;
  // v119 — فیلدهای articleSlug/exerciseId/foodId/sportSlug حذف شدند —
  // همهٔ صفحات عمومی SSR هستند و اسکرین SPA‌ای برای این مقادیر وجود ندارد.

  // Main tab
  mainTab: MainTab;
  setMainTab: (t: MainTab) => void;

  // Chat mode: "coach" (پیش‌فرض — چت مربی هوشمند) vs "nika" (فروش/پشتیبانی).
  // پیش‌فرض coach است تا تب «چت با فیتاپ» مربی را نشان دهد؛ دکمه «رفتن به چت نیکا"
  // در smart-coach-chat-view این مقدار را به nika تغییر می‌دهد و ChatView نیکا را رندر می‌کند.
  chatMode: "nika" | "coach";
  setChatMode: (m: "nika" | "coach") => void;
  nikaMessages: ChatMessageDto[];
  setNikaMessages: (m: ChatMessageDto[]) => void;
  addNikaMessage: (m: ChatMessageDto) => void;

  // Daily tracking (persisted in-memory across tab switches)
  waterMl: number; // آب مصرفی امروز به سی‌سی
  addWater: (ml: number) => void;
  caloriesConsumed: number;
  caloriesBurned: number;
  setCaloriesConsumed: (n: number) => void;
  setCaloriesBurned: (n: number) => void;
  loggedFoods: LoggedFood[];
  addLoggedFood: (f: LoggedFood) => void;
  removeLoggedFood: (id: string) => void;
  /** بارگذاری غذاهای ثبت‌شده «امروز» از سرور و جایگزینی state محلی */
  loadTodayFoodLogs: () => Promise<void>;
  bodyMeasurements: BodyMeasurements;
  setBodyMeasurements: (m: BodyMeasurements) => void;

  // ─── v137: مسیر پیشرفت از ثبت‌نام تا امروز — سوخت نمودار گیمیفایکشن + کارت مشکی ───
  journey: JourneyData | null;
  journeyLoaded: boolean;
  /** GET /api/dashboard/journey — یک‌بار در mount داشبورد؛ diff-guard ضد رندر اضافی */
  loadJourney: () => Promise<void>;

  // ─── Task 3-b: وضعیت «روز کامل» (مدال مشترک تمرین/تغذیه) ───
  dailyStatus: DailyStatusState;
  /** GET /api/daily-status — یک‌بار در mount سکشن‌ها؛ خطا بی‌صدا → loaded:true با پیش‌فرض‌ها */
  loadDailyStatus: () => Promise<void>;
  /** ادغام پاسخ POST /api/daily-status در state — بدون invalidate شدن بقیهٔ فیلدها */
  applyDailyStatusUpdate: (patch: DailyStatusPatch) => void;

  // Active workout session
  activeSession: ActiveSession | null;
  startSession: (dayId: string) => void;
  endSession: () => void;
  logSet: (exerciseId: string, setNumber: number, weight: number, reps: number) => void;

  // ═══ v183 — جلسهٔ چالش ═══
  activeChallengeSession: ActiveChallengeSession | null;
  startChallengeSession: (challengeSlug: string, dayNumber: number) => void;
  endChallengeSession: () => void;
  logChallengeSet: (exerciseId: string, setNumber: number, weight: number, reps: number) => void;

  /**
   * v190 — چالش بازِ «جزئیات» در هاب چالش‌ها (قبل‌تر state محلی ChallengesView بود).
   * به store منتقل شد تا «back گوشی» بتواند دقیقاً همان ویو را restore کند
   * (جلسهٔ چالش محتوای تب را unmount می‌کند — state محلی با آن می‌پرید).
   */
  selectedChallengeSlug: string | null;
  setSelectedChallengeSlug: (slug: string | null) => void;

  /**
   * آخرین وزن شناخته‌شده کاربر (کیلوگرم) — از داده‌های موجود (progress/checkup)
   * پر می‌شود تا تخمین کالری سوزانده به‌جای وزن هاردکد ۷۵ کیلو از این استفاده کند.
   * null = هنوز داده‌ای نداریم → fallback 75.
   */
  lastKnownWeightKg: number | null;
  setLastKnownWeightKg: (kg: number | null) => void;

  // Overlay views (rendered on top of main)
  // ممیزی 1-g C-3 — مقدار شبح «workoutDetail» حذف شد: نه caller داشت نه view؛
  // اگر ست می‌شد بی‌صدا هیچ رندری نمی‌شد و فقط یک history entry مصرف می‌کرد.
  overlay:
    | null
    | "notifications"
    | "profile"
    | "subscription"
    | "nutrition"
    | "admin"
    | "exerciseDetail"
    | "exerciseBankDetail"
    | "gymMode"
    | "videoAnalysis"
    | "bloodTest"
    | "survey"
    | "renewal";
  setOverlay: (o: AppState["overlay"]) => void;
  exerciseDetailId: string | null;
  setExerciseDetailId: (id: string | null) => void;

  // Body analysis upload modal — global flag so any view (programs-view,
  // dashboard-view, body-analysis-banner) can request opening the upload modal
  // even though the modal itself is rendered inside <BodyAnalysisBanner />.
  // When set to true, BodyAnalysisBanner will open its modal on next render.
  bodyAnalysisOpen: boolean;
  setBodyAnalysisOpen: (v: boolean) => void;

  // Gym Mode music playlist (in-memory)
  gymPlaylist: GymTrack[];
  setGymPlaylist: (tracks: GymTrack[]) => void;

  // Data
  workoutPlan: WorkoutPlanContent | null;
  setWorkoutPlan: (p: WorkoutPlanContent | null) => void;

  mealPlan: MealPlanContent | null;
  setMealPlan: (p: MealPlanContent | null) => void;

  chatMessages: ChatMessageDto[];
  // v73.4 — functional-friendly (هم‌خوان با setNotifications): هم آرایهٔ کامل هم
  // updater تابعی می‌پذیرد — فیکس باگ کلوژر «پیام یک‌بار ارسال، دوبار نمایش» چت
  setChatMessages: (
    m: ChatMessageDto[] | ((prev: ChatMessageDto[]) => ChatMessageDto[])
  ) => void;
  addChatMessage: (m: ChatMessageDto) => void;

  notifications: NotificationDto[];
  setNotifications: (n: NotificationDto[] | ((prev: NotificationDto[]) => NotificationDto[])) => void;
  unreadCount: number;

  // Plan generation loading
  generatingPlan: boolean;
  setGeneratingPlan: (v: boolean) => void;

  // ─── ضد فلیکر رفرش: آیا پلن‌ها حداقل یک‌بار از سرور لود شده‌اند؟ ───
  // تا false بودن این فلگ، داشبورد به‌جای حالت اشتباه «بی‌پلن» اسکلت نشان می‌دهد.
  // با اولین پایان loadPlans (موفق یا ناموفق) true می‌شود.
  plansLoaded: boolean;
  setPlansLoaded: (v: boolean) => void;

  // Onboarding draft
  onboardingDraft: Partial<OnboardingData>;
  setOnboardingDraft: (d: Partial<OnboardingData>) => void;

  // Plan that user selected on landing — persisted across auth+onboarding so we can guide them to buy it after analysis
  pendingPlanId: string | null;
  setPendingPlanId: (id: string | null) => void;

  // Reset
  reset: () => void;

  /**
   * 🩹 v45: شمارندهٔ session — هر reset (خروج/تعویض کاربر) یکی اضافه می‌شود؛
   * فراخوانی‌های async که قبل از خروج شروع شده‌اند، بعد از await با مقایسهٔ
   * epoch جلوی setUser کهنه (کاربر شبح) را می‌گیرند — ریشهٔ باگ
   * «بعد از خروج دکمهٔ شروع تا رفرش کار نمی‌کند».
   */
  sessionEpoch: number;
  /** v170 — مهر زمانی آخرین auth/me موفق بوت (markUserFresh) — گارد درخواست دوم */
  bootAuthCheckedAt: number;
}

// ═══ ردیابی نوشته‌های در-پرواز /api/nutrition/log (مهار رقابت‌های خوش‌بینانه) ═══
//  ۱) GET زمان mount با POST در-پرواز: جایگزینی کل لیست، ورودی تازه‌اضافه‌شده
//     را پاک می‌کرد (غذا بدون reload ناپدید می‌شد) → تا settle شدن نوشته‌ها
//     جایگزینی نمی‌کنیم و بعد از آن دوباره fetch می‌کنیم (loadTodayFoodLogs).
//  ۲) حذفِ آیتمی که POST آن هنوز برنگشته: DELETE سمت سرور skip می‌شد و ردیف
//     به‌صورت «شبح» در بارگذاری بعدی برمی‌گشت → DELETE را بعد از resolve شدن
//     POST با id واقعی سرور اجرا می‌کنیم (addLoggedFood).
const pendingFoodWrites = new Set<Promise<void>>();
// tempIdهایی (food_*) که قبل از resolve شدن POST حذف شده‌اند (DELETE معلق)
const deletedFoodTemps = new Set<string>();

// ═══ v139.2 — کش سشن «مسیر پیشرفت تو» (journey) — سرعت داشبورد در رفرش ═══
// داشبورد در رفرش/back اپ، نمودار و نشان‌های مسیر پیشرفت را «همان لحظه» از
// کش سشن می‌کشد (بدون اسکلتون تا رسیدن پاسخ شبکه)؛ loadJourney همچنان در
// mount ریکارید می‌کند و diff-guard جلوی رندر اضافی را می‌گیرد. خروج کاربر
// (reset) کش را پاک می‌کند تا دادهٔ کاربر قبلی هرگز نمایش داده نشود.
const JOURNEY_CACHE_KEY = "fitup_journey_cache_v1";
interface JourneyCacheEntry {
  userId: string | null;
  data: JourneyData;
  savedAt: number;
}
// v153 — دیرکتیو مالک «کش موبایل = کش دسکتاپ»: ۲۴h → ۲ دقیقه (فقط ضدفلیکر
// اولین رندر؛ loadJourney همیشه بعدش از سرور ریکارید می‌کند) — در WebView
// چندروزهٔ اپ دیگر هیچ دادهٔ کهنه‌ای رندر نمی‌شود.
const JOURNEY_CACHE_MAX_AGE_MS = 2 * 60 * 1000; // ۲ دقیقه

function loadJourneyCache(): { journey: JourneyData | null; journeyLoaded: boolean } {
  if (typeof window === "undefined") return { journey: null, journeyLoaded: false };
  try {
    const raw = window.sessionStorage.getItem(JOURNEY_CACHE_KEY);
    if (!raw) return { journey: null, journeyLoaded: false };
    const parsed = JSON.parse(raw) as JourneyCacheEntry | null;
    if (!parsed?.data?.registeredAt) return { journey: null, journeyLoaded: false };
    if (Date.now() - parsed.savedAt > JOURNEY_CACHE_MAX_AGE_MS) return { journey: null, journeyLoaded: false };
    return { journey: parsed.data, journeyLoaded: true };
  } catch {
    return { journey: null, journeyLoaded: false };
  }
}
function persistJourneyCache(data: JourneyData, userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const entry: JourneyCacheEntry = { userId, data, savedAt: Date.now() };
    window.sessionStorage.setItem(JOURNEY_CACHE_KEY, JSON.stringify(entry));
  } catch {}
}
function clearJourneyCache(): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(JOURNEY_CACHE_KEY); } catch {}
}
export const useAppStoreBase = create<AppState>((set, get) => ({
  // v122 — store همیشه با "loading" متولد می‌شود (بدون هیچ وابستگی به ترتیب
  // اجرای اسکریپت‌ها — race-free). screen واقعیِ هر بارگذاری از دو مسیرِ
  // ایمن می‌آید: ① سرور: bootstrapStoreFromServer در فاز رندرِ HomeClient
  // (سمت سرور مجاز است) ② کلاینت: اسنپ‌شات هیدریشن — setHydrationSnapshot
  // که HomeClient «خالص» در ابتدای رندرش ست می‌کند (بدون هیچ setState/نوتیف —
  // ریشه‌کنی ارور «Cannot update a component (PwaRegister) …») و بعد از
  // hydration، effect خود HomeClient state واقعی store را هم‌تراز می‌کند.
  screen: "loading",
  // 🩹 v45: شمارندهٔ session برای باطل‌کردن پاسخ‌های async بعد از خروج
  sessionEpoch: 0,
  // v170 — مهر زمانی آخرین auth/me موفقِ بوت (doAuthCheck → markUserFresh) —
  // گارد «auth/me دومِ هر رفرش» در main-app همین را می‌خواند.
  bootAuthCheckedAt: 0,
  user: null,
  setUser: (u) => set({ user: u }),
  // v143 — کاربر سبک SSR هدر لندینگ (bootstrapStoreFromServer / اسنپ‌شات هیدریشن پرش می‌کنند)
  ssrLandingUser: null,

  setScreen: (s) => set({ screen: s }),

  // New-terms modal flag
  termsUpdateRequired: false,
  setTermsUpdateRequired: (v) => set({ termsUpdateRequired: v }),

  // پیش‌فرض ثابت — رفرش پنل با ?tab=… از مسیر اسنپ‌شات هیدریشن می‌آید
  mainTab: "dashboard",
  // v190 — ورود/خروج به تب عمیق «پیاده‌روی و دویدن» با استک بک پنل هماهنگ می‌شود
  // (back از activity → داشبورد، بدون رد شدن از هندلر خروج)
  setMainTab: (t) => {
    const prev = get().mainTab;
    if (t === "activity" && prev !== "activity") {
      ensurePanelEntry(
        { type: "tab", id: "activity" },
        () => useAppStore.getState().setMainTab("dashboard")
      );
    } else if (prev === "activity" && t !== "activity") {
      closePanelEntry("tab", "activity");
    }
    set({ mainTab: t });
  },

  chatMode: "coach",
  setChatMode: (m) => set({ chatMode: m }),
  nikaMessages: [],
  setNikaMessages: (m) => set({ nikaMessages: m }),
  addNikaMessage: (m) => set((s) => ({ nikaMessages: [...s.nikaMessages, m] })),

  // Daily tracking defaults
  waterMl: 0,
  addWater: (ml) => set((s) => ({ waterMl: Math.max(0, Math.min(5000, s.waterMl + ml)) })),
  caloriesConsumed: 0,
  caloriesBurned: 0,
  setCaloriesConsumed: (n) => set({ caloriesConsumed: Math.max(0, n) }),
  setCaloriesBurned: (n) => set({ caloriesBurned: Math.max(0, n) }),
  loggedFoods: [],
  addLoggedFood: (f) => {
    const tempId = f.id;
    // به‌روزرسانی خوش‌بینانه‌ی محلی (UI فوراً واکنش نشان می‌دهد)
    set((s) => ({
      loggedFoods: [...s.loggedFoods, f],
      caloriesConsumed: s.caloriesConsumed + f.calories,
    }));
    // ذخیره در سرور (background, non-blocking) با keepalive برای ادامه در پس‌زمینه
    // v202 — رول‌بک ردیف خوش‌بینانه: اگر POST شکست بخورد، ردیفی در سرور ساخته
    // نشده؛ نگه‌داشتنش یعنی ردیفِ شبح که امروز فقط تا لود موفق بعدی نمایش داده
    // می‌شد و بی‌صدا محو می‌شد (یافتهٔ ممیزی v202-d) — حالا state به قبل برمی‌گردد.
    const rollbackOptimisticRow = (reason: string) => {
      deletedFoodTemps.delete(tempId);
      set((s) => {
        // اگر کاربر همین‌حین ردیف را حذف کرده بود، چیزی برای رول‌بک نیست
        if (!s.loggedFoods.some((x) => x.id === tempId)) return {};
        return {
          loggedFoods: s.loggedFoods.filter((x) => x.id !== tempId),
          caloriesConsumed: Math.max(0, s.caloriesConsumed - f.calories),
        };
      });
      console.warn(`[store] ثبت لاگ غذایی ناموفق (${reason}) — ردیف خوش‌بینانه rollback شد`, {
        name: f.name,
        meal: f.meal,
        calories: f.calories,
      });
    };
    const write = (async () => {
      try {
        const r = await fetch("/api/nutrition/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: f.name,
            meal: f.meal,
            calories: f.calories,
            protein: f.protein,
            carbs: f.carbs,
            fat: f.fat,
            servingSize: f.servingSize ?? "۱ وعده",
            source: f.source ?? "manual",
            foodLibraryId: f.foodLibraryId ?? null,
            imageUrl: f.imageUrl ?? null,
          }),
          keepalive: true,
        });
        if (!r.ok) {
          // ردیفی در سرور ساخته نشده — DELETE معلق (اگر بود) لازم نیست → رول‌بک
          rollbackOptimisticRow(`HTTP ${r.status}`);
          return;
        }
        const data = await r.json().catch(() => null);
        // جایگزینی id موقت با id سرور (تا حذف بعدی درست کار کند)
        if (data?.food?.id && data.food.id !== tempId) {
          const serverId = data.food.id as string;
          set((s) => ({
            loggedFoods: s.loggedFoods.map((x) =>
              x.id === tempId ? { ...x, id: serverId } : x
            ),
          }));
          // کاربر همین‌حین (قبل از resolve شدن POST) حذف کرده بود → DELETE
          // معلق را با id واقعی سرور اجرا کن تا ردیف شبح برنگردد
          if (deletedFoodTemps.has(tempId)) {
            deletedFoodTemps.delete(tempId);
            const del = (async () => {
              try {
                await fetch(`/api/nutrition/log/${serverId}`, { method: "DELETE", keepalive: true });
              } catch {}
            })();
            pendingFoodWrites.add(del);
            void del.finally(() => pendingFoodWrites.delete(del));
          }
        }
      } catch (err) {
        // v202 — دیگر «سکوت» نیست: ردیف خوش‌بینانه حذف می‌شود تا شبحِ محوشدنی
        // در لود بعدی نسازد (رفتار قبلی: state محلی حفظ و در reconcile بعدی پرت می‌شد)
        rollbackOptimisticRow(err instanceof Error ? err.message : "network-error");
      }
    })();
    pendingFoodWrites.add(write);
    void write.finally(() => pendingFoodWrites.delete(write));
  },
  removeLoggedFood: (id) => {
    set((s) => {
      const food = s.loggedFoods.find((x) => x.id === id);
      return {
        loggedFoods: s.loggedFoods.filter((x) => x.id !== id),
        caloriesConsumed: Math.max(0, s.caloriesConsumed - (food?.calories ?? 0)),
      };
    });
    // حذف از سرور فقط اگر id موقت نباشد (id موقت با "food_" شروع می‌شود)
    if (id.startsWith("food_")) {
      // POST این آیتم هنوز resolve نشده — DELETE فعلاً ممکن نیست؛ علامت می‌زنیم
      // تا بعد از resolve شدن POST با id واقعی سرور حذف شود (addLoggedFood)
      deletedFoodTemps.add(id);
      return;
    }
    const del = (async () => {
      try {
        await fetch(`/api/nutrition/log/${id}`, { method: "DELETE", keepalive: true });
      } catch {}
    })();
    pendingFoodWrites.add(del);
    void del.finally(() => pendingFoodWrites.delete(del));
  },
  loadTodayFoodLogs: async () => {
    try {
      // اگر نوشته‌ای (POST ثبت یا DELETE) هنوز در پرواز است، جایگزینی کل لیست
      // می‌تواند ورودی خوش‌بینانه را پاک کند یا ردیف حذف‌شده را برگرداند —
      // این بار جایگزینی نمی‌کنیم؛ بعد از settle شدن نوشته‌ها دوباره fetch می‌کنیم.
      if (pendingFoodWrites.size > 0) {
        void Promise.allSettled([...pendingFoodWrites]).then(() => {
          useAppStore.getState().loadTodayFoodLogs();
        });
        return;
      }
      const res = await fetch("/api/nutrition/log", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const foods: LoggedFood[] = Array.isArray(data.foods)
        ? data.foods.map((f: any) => ({
            id: String(f.id),
            name: String(f.name),
            meal: f.meal,
            calories: Number(f.calories) || 0,
            protein: Number(f.protein) || 0,
            carbs: Number(f.carbs) || 0,
            fat: Number(f.fat) || 0,
            loggedAt: f.loggedAt || new Date().toISOString(),
            servingSize: f.servingSize,
            source: f.source,
            foodLibraryId: f.foodLibraryId ?? null,
            imageUrl: f.imageUrl ?? null,
          }))
        : [];
      const total = foods.reduce((sum, f) => sum + f.calories, 0);
      set({ loggedFoods: foods, caloriesConsumed: total });
    } catch {
      // سکوت — خطای شبکه نباید تجربه کاربر را خراب کند
    }
  },
  bodyMeasurements: {},
  setBodyMeasurements: (m) => set({ bodyMeasurements: { ...m, updatedAt: new Date().toISOString() } }),

  // ─── v137: مسیر پیشرفت (نمودار گیمیفایکشن + کارت مشکی) ───
  journey: null,
  journeyLoaded: false,
  loadJourney: async () => {
    // v139.2 — بازیابی همگام از کش سشن (قبل از اولین await → در همان تیکِ
    // mount effect): کارت «مسیر پیشرفت» در رفرش/back بدون اسکلتون شبکه‌ای
    // رندر می‌شود؛ بعدش fetch عادی diff-guard می‌شود. (خودِ initial state
    // عمداً null می‌ماند تا با SSR/hydration یکی باشد.)
    {
      const cached = loadJourneyCache();
      if (cached.journey && !get().journeyLoaded) {
        set({ journey: cached.journey, journeyLoaded: true });
      }
    }
    // v137: یک تلاش دوبارهٔ ملایم — ۴۰۴/خطای گذرای cold-compile dev نباید
    // کارت «مسیر پیشرفت» را برای همیشه پنهان کند.
    // 🩹 v171 — ضدکندی رفرش داشبورد: یک تلاش (قبلاً ۲) با تأخیر ۴۰۰ms
    // (قبلاً ۱۵۰۰ms) — مسیر شکست دیگر روی هر رفرش معطل نمی‌ماند.
    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        const res = await fetch("/api/dashboard/journey", { cache: "no-store" });
        if (!res.ok) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          set({ journeyLoaded: true });
          return;
        }
        const data = (await res.json()) as JourneyData;
        const prev = get().journey;
        // diff-guard — فقط وقتی داده واقعاً عوض شده set کن (ضد رندر/فلیکر اضافی)
        if (prev && JSON.stringify(prev) === JSON.stringify(data)) {
          set({ journeyLoaded: true });
          return;
        }
        set({ journey: data, journeyLoaded: true });
        persistJourneyCache(data, get().user?.id ?? null);
        return;
      } catch {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        // خطای شبکه — سکوت؛ نمودار مخفی می‌ماند و تجربه خراب نمی‌شود
        set({ journeyLoaded: true });
      }
    }
    // v171 — پایان حلقهٔ تک‌تلاش: journeyLoaded همیشه تضمین می‌شود
    // (اسکلتونِ معلقِ ابدی ممنوع)
    set({ journeyLoaded: true });
  },

  // ─── Task 3-b: وضعیت «روز کامل» (مدال مشترک تمرین/تغذیه) ───
  dailyStatus: { ...DEFAULT_DAILY_STATUS },
  loadDailyStatus: async () => {
    try {
      const res = await fetch("/api/daily-status", { cache: "no-store" });
      if (!res.ok) {
        // حتی در خطا loaded:true تا درخواست‌ها هر رندر تکرار نشوند
        set({ dailyStatus: { ...get().dailyStatus, loaded: true } });
        return;
      }
      const data = await res.json();
      set({
        dailyStatus: {
          date: typeof data?.date === "string" ? data.date : null,
          workoutDone: !!data?.workoutDone,
          nutritionDone: !!data?.nutritionDone,
          dayComplete: !!data?.dayComplete,
          medalSeenAt: typeof data?.medalSeenAt === "string" ? data.medalSeenAt : null,
          loaded: true,
        },
      });
    } catch {
      // خطای شبکه — سکوت؛ تجربهٔ کاربر خراب نمی‌شود
      set({ dailyStatus: { ...get().dailyStatus, loaded: true } });
    }
  },
  applyDailyStatusUpdate: (patch) =>
    set((s) => ({ dailyStatus: { ...s.dailyStatus, ...patch } })),

  // Active workout session
  activeSession: null,
  // v190 — «تمرین امروز» هم entry بک پنل می‌گیرد: back گوشی → بازگشت به ویوی
  // قبلی (داشبورد/تمرین‌ها) — (تب زیرین دست‌نخورده می‌ماند چون جلسه اورلی تمام‌صفحه است)
  // 🎯 v225 — دیرکتیو مالک: back داخل «تمرین امروز» باید «تأیید خروج» بگیرد،
  // نه خروج فوری. restore (ماژول‌سطح، پایینِ فایل: workoutBackRestore)
  // ایونت fitup:workout-back می‌فرستد و خود ویو سلسله‌مراتب لایه‌ها
  // (تایمر استراحت/جشن) را می‌بندد یا دیالوگ تأیید خروج را باز می‌کند.
  // هم بک مرورگر (popstate → panel-back restore) و هم بک نیتیو اپ‌ها
  // (__fitupNativeBack → history.back → همان مسیر) از اینجا عبور می‌کنند.
  startSession: (dayId) => {
    ensurePanelEntry({ type: "workout-session" }, workoutBackRestore);
    set({
      activeSession: {
        dayId,
        startedAt: new Date().toISOString(),
        currentExerciseIdx: 0,
        loggedSets: {},
      },
    });
  },
  endSession: () => {
    // بستن از مسیر UI (ضربدر جلسه) → entry تاریخچه مصرف می‌شود (back بعدی سالم)
    closePanelEntry("workout-session");
    set({ activeSession: null });
  },
  logSet: (exerciseId, setNumber, weight, reps) => set((s) => {
    if (!s.activeSession) return {};
    const existing = s.activeSession.loggedSets[exerciseId] || [];
    const updated = existing.map((entry, i) =>
      i === setNumber - 1 ? { weight, reps, done: true } : entry
    );
    // ensure array length covers setNumber
    while (updated.length < setNumber) updated.push({ weight: 0, reps: 0, done: false });
    updated[setNumber - 1] = { weight, reps, done: true };
    return {
      activeSession: {
        ...s.activeSession,
        loggedSets: { ...s.activeSession.loggedSets, [exerciseId]: updated },
      },
    };
  }),

  // ═══ v183 — جلسهٔ چالش ═══
  activeChallengeSession: null,
  // v190 — شروع جلسهٔ چالش entry بک پنل می‌گیرد: back گوشی وسط تمرین → خروج
  // از جلسه و بازگشت به «جزئیات همان چالش» — نه داشبورد، نه دیالوگ خروج
  startChallengeSession: (challengeSlug, dayNumber) => {
    ensurePanelEntry(
      { type: "challenge-session", id: challengeSlug },
      () => restoreChallengeDetailFromSession(challengeSlug)
    );
    set({
      activeChallengeSession: {
        challengeSlug,
        dayNumber,
        startedAt: new Date().toISOString(),
        currentStepIdx: 0,
        loggedSets: {},
      },
    });
  },
  endChallengeSession: () => {
    // بستن از مسیر UI (ضربدر جلسه / پایان جشن) → مصرف entry تاریخچه
    closePanelEntry("challenge-session");
    set({ activeChallengeSession: null });
  },

  // v190 — state جزئیات چالش (به‌جای useState محلی — برای restore با back)
  selectedChallengeSlug: null,
  setSelectedChallengeSlug: (slug) => {
    const prev = get().selectedChallengeSlug;
    if (slug && !prev) {
      // ورود به جزئیات از هاب → entry بک پنل: back → بازگشت به هاب
      ensurePanelEntry(
        { type: "challenge-detail", id: slug },
        () => backToChallengesHub()
      );
    } else if (!slug && prev) {
      // بستن جزئیات از مسیر UI (دکمهٔ «همهٔ چالش‌ها» / پایان چالش) → مصرف entry
      closePanelEntry("challenge-detail", prev);
    }
    set({ selectedChallengeSlug: slug });
  },
  logChallengeSet: (exerciseId, setNumber, weight, reps) =>
    set((s) => {
      if (!s.activeChallengeSession) return {};
      const existing = s.activeChallengeSession.loggedSets[exerciseId] || [];
      const updated = existing.map((entry, i) =>
        i === setNumber - 1 ? { weight, reps, done: true } : entry
      );
      while (updated.length < setNumber) updated.push({ weight: 0, reps: 0, done: false });
      updated[setNumber - 1] = { weight, reps, done: true };
      return {
        activeChallengeSession: {
          ...s.activeChallengeSession,
          loggedSets: { ...s.activeChallengeSession.loggedSets, [exerciseId]: updated },
        },
      };
    }),

  // آخرین وزن شناخته‌شده — برای تخمین کالری (جایگزین هاردکد ۷۵kg)
  lastKnownWeightKg: null,
  setLastKnownWeightKg: (kg) => set({ lastKnownWeightKg: kg && kg > 20 && kg < 300 ? kg : null }),

  overlay: null,
  setOverlay: (o) => set({ overlay: o }),
  exerciseDetailId: null,
  setExerciseDetailId: (id) => set({ exerciseDetailId: id }),

  // Body analysis upload modal global flag
  bodyAnalysisOpen: false,
  setBodyAnalysisOpen: (v) => set({ bodyAnalysisOpen: v }),

  gymPlaylist: [],
  setGymPlaylist: (tracks) => set({ gymPlaylist: tracks }),

  workoutPlan: null,
  setWorkoutPlan: (p) => set({ workoutPlan: p }),

  mealPlan: null,
  setMealPlan: (p) => set({ mealPlan: p }),

  chatMessages: [],
  // v73.4 — functional-friendly: typeof narrowing اجازهٔ هر دو شکل را می‌دهد
  setChatMessages: (m) =>
    set((s) => ({
      chatMessages: typeof m === "function" ? m(s.chatMessages) : m,
    })),
  addChatMessage: (m) => set((s) => ({ chatMessages: [...s.chatMessages, m] })),

  notifications: [],
  // مقدار اولیه unreadCount — قبلاً در state اولیه نبود (خطای TS2741)
  unreadCount: 0,
  setNotifications: (n) =>
    set((state) => {
      const arr = typeof n === "function" ? n(state.notifications) : n;
      return { notifications: arr, unreadCount: arr.filter((x) => !x.read).length };
    }),

  generatingPlan: false,
  setGeneratingPlan: (v) => set({ generatingPlan: v }),

  // ضد فلیکر رفرش — فلگ لود شدن پلن‌ها (جزئیات در تعریف interface بالا)
  plansLoaded: false,
  setPlansLoaded: (v) => set({ plansLoaded: v }),

  onboardingDraft: {},
  setOnboardingDraft: (d) =>
    set((s) => ({ onboardingDraft: { ...s.onboardingDraft, ...d } })),

  pendingPlanId: null,
  setPendingPlanId: (id) => set({ pendingPlanId: id }),

  reset: () => {
    // ─── در حالت «برنامه» (اپ نیتیو بازار/اختصاصی یا وب‌اپ iOS) خروج → صفحه OTP ───
    // درخواست مالک: بعد از خروج از حساب، کاربر به صفحه ورود (OTP) برمی‌گردد،
    // نه لندینگ — چون کل تجربهٔ اپ حول پنل می‌چرخد و شروع اپ با OTP است.
    // در مرورگر معمولی رفتار قبلی (لندینگ) حفظ می‌شود.
    const afterLogoutScreen = isAppShellMode() ? "auth" : "landing";
    // 🩹 v139.2 — نشانگر «تأیید لاگین اخیر» با خروج دستی باطل می‌شود
    clearAuthHint();
    // v190 — استک بک پنل کاربر قبلی هم خالی شود (ضد restore ویوهای غریبه)
    resetPanelBack();
    set({
      // 🩹 v45: باطل‌کردن پاسخ‌های async در-پرواز (setUser/setScreen کهنه)
      sessionEpoch: (get().sessionEpoch || 0) + 1,
      screen: afterLogoutScreen,
      user: null,
      // v143 — نام SSR هدر لندینگ هم پاک شود (کاربر لاگ‌اوت دوباره «شروع» ببیند)
      ssrLandingUser: null,
      mainTab: "dashboard",
      overlay: null,
      workoutPlan: null,
      mealPlan: null,
      chatMessages: [],
      nikaMessages: [],
      chatMode: "coach",
      notifications: [],
      waterMl: 0,
      caloriesConsumed: 0,
      caloriesBurned: 0,
      loggedFoods: [],
      activeSession: null,
      pendingPlanId: null,
      termsUpdateRequired: false,
      bodyAnalysisOpen: false,
      plansLoaded: false,
      // v190 — جزئیات باز چالش کاربر قبلی برای کاربر جدید نباید بماند
      selectedChallengeSlug: null,
      activeChallengeSession: null,
      // Task 3-b: وضعیت روز کامل کاربر جدید نباید از کاربر قبلی بماند
      dailyStatus: { ...DEFAULT_DAILY_STATUS },
      // v137: سفر پیشرفت کاربر قبلی هم نباید بماند
      journey: null,
      journeyLoaded: false,
    });
    // کش پلن محلی هم پاک شود (خروج = داده پلن دیگر معتبر نیست؛ کاربر بعدی
    // نباید پلن کاربر قبلی را لحظه‌ای ببیند)
    clearPlanCache();
    // v139.2 — کش سشن مسیر پیشرفت هم پاک شود (ضد نمایش دادهٔ کاربر قبلی)
    clearJourneyCache();
    // v139.2 — کش سشن اعلان‌ها هم پاک شود (ضد نمایش اعلان‌های کاربر قبلی)
    try { if (typeof window !== "undefined") window.sessionStorage.removeItem("fitup_notifications_cache_v1"); } catch {}
  },
}));

// ═══════════════════════════════════════════════════════════════
//  v120 — فیکس ریشه‌ای hydration/SSR (ارور «Hydration failed» مالک)
// ═══════════════════════════════════════════════════════════════
//  ریشه: zustand v5 برای رندر سمت سرور و hydration از getInitialState()
//  استفاده می‌کند که «فریز‌شده» است — یعنی سرور همیشه state اولیهٔ لحظهٔ
//  ساخت استور را می‌بیند (screen:"loading" → SplashLoader) و محتوای واقعی
//  هرگز در HTML اولیه نمی‌آید؛ کافی است state کلاینت قبل از hydration
//  تغییر کرده باشد (bootstrap اولیه/HMR/…) تا «server rendered HTML didn't
//  match the client» رخ دهد.
//
//  راه‌حل: هوک را طوری بازنویسی می‌کنیم که server-snapshot هم «وضعیت زنده»
//  (getState) را برگرداند. حالا bootstrap اولیهٔ سرور (bootstrapStoreFromServer
//  در page-client — قبل از اولین رندر) هم در سرور اثر دارد و هم در کلاینت —
//  خروجی SSR = محتوای واقعی اسکرین همان درخواست، و hydration دقیقاً همان را
//  می‌خواند: نه splash در HTML اولیه، نه mismatch.
//  رفتار کلاینت بعد از hydration با zustand معمولی یکسان است (getState زنده).
type AppStoreHook = {
  (): AppState;
  <T>(selector: (state: AppState) => T): T;
} & StoreApi<AppState>;

const useAppStoreImpl = useAppStoreBase as unknown as StoreApi<AppState> & {
  (): AppState;
  <T>(selector: (state: AppState) => T): T;
};

// ═══ v122 — اسنپ‌شات هیدریشن (کلاینت) — ریشه‌کنی ارور «Cannot update a component» ═══
// ارور مالک: «Cannot update a component (PwaRegister) while rendering a
// different component (HomeClient)» — ریشه: در v120 ،HomeClient در «فاز رندر»
// setState می‌زد تا store کلاینت با screen سرور هم‌تراز شود؛ این کار همهٔ
// مشترک‌های store (مثل PwaRegister در layout) را force-rerender می‌کرد.
//
// راه‌حل قطعی (بدون هیچ mutation در فاز رندر): HomeClient در ابتدای رندرِ
// خودش، اسنپ‌شاتِ هم‌تراز-با-سرور را در این متغیر ماژولی «خالص» ست می‌کند
// (فقط انتساب متغیر — بدون setState، بدون نوتیفیکیشن، بدون عارضهٔ جانبی).
// getServerSnapshot تا پایان hydration همین را برمی‌گرداند → خروجی hydration
// دقیقاً با HTML سرور یکی است (بدون mismatch). بعد از hydration، effect در
// HomeClient اسنپ‌شات را پاک و state «واقعی» store را هم‌تراز می‌کند (خارج
// از فاز رندر → کاملاً مجاز و بدون ارور).
let hydrationSnapshot: AppState | null = null;

/** فقط HomeClient در ابتدای رندر کلاینت صدا می‌زند — خالص و بدون عارضه */
export function setHydrationSnapshot(initial: {
  screen: string;
  mainTab?: string;
  landingUser?: { name: string; onboardingDone: boolean } | null;
  ssrUser?: Record<string, unknown> | null;
}) {
  if (typeof window === "undefined") return;
  const base = useAppStoreImpl.getState();
  hydrationSnapshot = {
    ...base,
    screen: initial.screen as AppState["screen"],
    ...(initial.mainTab ? { mainTab: initial.mainTab as AppState["mainTab"] } : {}),
    // v143 — کاربر سبک لندینگ باید در HTML سرور و اولین رندر کلاینت «یکسان» باشد
    ...(initial.landingUser !== undefined ? { ssrLandingUser: initial.landingUser } : {}),
    // v143 — DTO کامل کاربر پنل: اولین رندر کلاینت هم با user پر است (بدون اسکلتون)
    ...(initial.ssrUser !== undefined
      ? { user: (initial.ssrUser as AppState["user"]) ?? null }
      : {}),
  };
}

/** بعد از hydration در effect صدا زده می‌شود — برگشت به state زندهٔ store */
export function clearHydrationSnapshot() {
  hydrationSnapshot = null;
}

export const useAppStore = ((selector?: (state: AppState) => any) =>
  useSyncExternalStore(
    useAppStoreImpl.subscribe,
    () => (selector ? selector(useAppStoreImpl.getState()) : useAppStoreImpl.getState()),
    () => {
      // getServerSnapshot — سرور: state زندهٔ همان درخواست (bootstrapStoreFromServer
      // در فاز رندرِ HomeClient همان را ست کرده). کلاینت: فقط تا پایان hydration —
      // اسنپ‌شات تزریقی (بدون هیچ mutation)؛ بعد از آن state زندهٔ store.
      if (hydrationSnapshot) {
        return selector ? selector(hydrationSnapshot) : hydrationSnapshot;
      }
      return selector ? selector(useAppStoreImpl.getState()) : useAppStoreImpl.getState();
    },
  )) as AppStoreHook;

// API کامل استور (getState/setState/subscribe/getInitialState) روی هوک بماند —
// ده‌ها نقطه در کد به‌صورت useAppStore.getState()/setState() استفاده می‌کنند.
Object.assign(useAppStore, useAppStoreImpl);

// ═══════════════════════════════════════════════════════════════
//  Persist جلسه تمرین فعال در localStorage (FE-H7)
//  ست‌های ثبت‌شده قبلاً با refresh/endSession از بین می‌رفتند؛
//  حالا با هر تغییر activeSession (start/logSet/endSession/تغییر حرکت)
//  در localStorage ذخیره می‌شود و بعد از refresh (تا ۲۴ ساعت) بازیابی می‌گردد.
// ═══════════════════════════════════════════════════════════════
const ACTIVE_SESSION_KEY = "fitup_active_session";
const ACTIVE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت

function persistActiveSession(session: ActiveSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    } else {
      window.localStorage.setItem(
        ACTIVE_SESSION_KEY,
        JSON.stringify({ activeSession: session, savedAt: Date.now() })
      );
    }
  } catch {
    // localStorage پر است یا غیرفعال — بی‌صدا رد شو
  }
}

// subscribe همه مسیرهای تغییر activeSession را پوشش می‌دهد
// (startSession / logSet / endSession / setState مستقیم در active-workout-session)
// t8c-5: نوشتن با تأخیر trailing ~۵۰۰ms — هر تیک ناوبری/تایپ ست‌ها دیگر
// localStorage synchronous write نمی‌زند (عامل لگ ناوبری در پلیر).Flush فوری
// روی pagehide/beforeunload تا بستن تب/اپ وسط تایمر داده گم نکند.
if (typeof window !== "undefined") {
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const schedulePersistActiveSession = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistActiveSession(useAppStore.getState().activeSession);
    }, 500);
  };

  const flushActiveSession = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistActiveSession(useAppStore.getState().activeSession);
  };

  useAppStore.subscribe((state, prev) => {
    if (state.activeSession !== prev.activeSession) {
      schedulePersistActiveSession();
    }
  });

  window.addEventListener("pagehide", flushActiveSession);
  window.addEventListener("beforeunload", flushActiveSession);
}

// ═══════════════════════════════════════════════════════════════
// v183 — Persist جلسهٔ چالش در localStorage (آینهٔ activeSession)
// ═══════════════════════════════════════════════════════════════
const CHALLENGE_SESSION_KEY = "fitup_active_challenge_session";

function persistChallengeSession(session: ActiveChallengeSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      window.localStorage.removeItem(CHALLENGE_SESSION_KEY);
    } else {
      window.localStorage.setItem(
        CHALLENGE_SESSION_KEY,
        JSON.stringify({ activeChallengeSession: session, savedAt: Date.now() })
      );
    }
  } catch {
    // localStorage پر است یا غیرفعال — بی‌صدا رد شو
  }
}

if (typeof window !== "undefined") {
  let chPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistChallenge = () => {
    if (chPersistTimer) clearTimeout(chPersistTimer);
    chPersistTimer = setTimeout(() => {
      chPersistTimer = null;
      persistChallengeSession(useAppStore.getState().activeChallengeSession);
    }, 500);
  };
  const flushChallengeSession = () => {
    if (chPersistTimer) {
      clearTimeout(chPersistTimer);
      chPersistTimer = null;
    }
    persistChallengeSession(useAppStore.getState().activeChallengeSession);
  };
  useAppStore.subscribe((state, prev) => {
    if (state.activeChallengeSession !== prev.activeChallengeSession) {
      schedulePersistChallenge();
    }
  });
  window.addEventListener("pagehide", flushChallengeSession);
  window.addEventListener("beforeunload", flushChallengeSession);
}

// ═══ v190 — restoreهای بک پنل (بالاتر از store با hoisting function declaration صدا زده می‌شوند) ═══

/**
 * 🎯 v225 — دیرکتیو مالک: restore بک داخل «تمرین امروز».
 * دیگر endSession فوری نیست — ایونت fitup:workout-back می‌فرستد تا ویو
 * سلسله‌مراتب لایه‌ها را ببندد یا دیالوگ تأیید خروج را باز کند.
 * ⚠️ نکتهٔ حیاتی: re-arm (ثبت دوبارهٔ entry برای بک بعدی) «هرگز» داخل همین
 * restore انجام نمی‌شود — restore داخل while-loop پردازش popstate صدا زده
 * می‌شود و push همزمان داخل آن = حلقهٔ بی‌نهایت (باگ واقعی که کل تب را فریز
 * کرد). re-arm در خود ویو (active-workout-session) با setTimeout(0) بعد از
 * پایان پردازش popstate انجام می‌شود (armWorkoutBack).
 */
function workoutBackRestore(): void {
  if (typeof window === "undefined") {
    useAppStore.getState().endSession();
    return;
  }
  window.dispatchEvent(new CustomEvent("fitup:workout-back"));
}

/**
 * back در جلسهٔ چالش → خروج از جلسه و بازگشت به «جزئیات همان چالش».
 * (store اینجا کامل eval شده — فقط در زمان فراخوانی runtime اجرا می‌شود)
 */
function restoreChallengeDetailFromSession(challengeSlug: string): void {
  const st = useAppStore.getState();
  if (st.activeChallengeSession) {
    // مسیر restore است (entry را popstate حذف کرده) → closePanelEntry داخلش no-op است
    st.endChallengeSession();
  }
  st.setMainTab("challenges");
  // جزئیات همان چالش دوباره باز شود (اگر قبلاً باز بوده → فقط set)
  st.setSelectedChallengeSlug(challengeSlug);
}

/** back در جزئیات چالش → هاب چالش‌ها */
function backToChallengesHub(): void {
  const st = useAppStore.getState();
  st.setMainTab("challenges");
  // مسیر restore است (entry را popstate حذف کرده) → closePanelEntry داخلش no-op است
  st.setSelectedChallengeSlug(null);
}

/**
 * v183 — بازیابی جلسهٔ چالش از localStorage (<۲۴ ساعت) — آینهٔ restoreActiveSession
 */
export function restoreActiveChallengeSession(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CHALLENGE_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      activeChallengeSession?: ActiveChallengeSession | null;
      savedAt?: number;
    };
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    const fresh = Date.now() - savedAt < ACTIVE_SESSION_MAX_AGE_MS;
    if (!parsed.activeChallengeSession || !fresh) {
      window.localStorage.removeItem(CHALLENGE_SESSION_KEY);
      return;
    }
    if (useAppStore.getState().activeChallengeSession) return;
    const s = parsed.activeChallengeSession;
    // اعتبارسنجی شکل
    if (
      typeof s.challengeSlug !== "string" ||
      !Number.isInteger(s.dayNumber) ||
      s.dayNumber < 1 ||
      typeof s.startedAt !== "string" ||
      !s.loggedSets ||
      typeof s.loggedSets !== "object" ||
      Array.isArray(s.loggedSets)
    ) {
      window.localStorage.removeItem(CHALLENGE_SESSION_KEY);
      return;
    }
    // v190 — بعد از رفرش وسط جلسه، back گوشی همچنان به جزئیات چالش برگردد
    ensurePanelEntry(
      { type: "challenge-session", id: s.challengeSlug },
      () => restoreChallengeDetailFromSession(s.challengeSlug)
    );
    useAppStore.setState({ activeChallengeSession: s });
  } catch {
    // دادهٔ خراب — پاک شود
    try {
      window.localStorage.removeItem(CHALLENGE_SESSION_KEY);
    } catch {}
  }
}

/**
 * بازیابی جلسه تمرین فعال از localStorage — فقط سمت client.
 * در mount پنل (MainApp) صدا زده می‌شود؛ اگر جلسه‌ای <۲۴ ساعت وجود داشت
 * و store خالی بود، بازیابی می‌کند تا پیشرفت کاربر با refresh از دست نرود.
 */
export function restoreActiveSession(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      activeSession?: ActiveSession | null;
      savedAt?: number;
    };
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    const fresh = Date.now() - savedAt < ACTIVE_SESSION_MAX_AGE_MS;
    if (!parsed.activeSession || !fresh) {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      return;
    }
    // فقط وقتی store فعلی جلسه‌ای ندارد (که جلسه جدید شروع‌شده را خراب نکند)
    if (!useAppStore.getState().activeSession) {
      // ─── v165 — اعتبارسنجی شکل loggedSets (ضد کرش رندر «صفحهٔ سفید») ───
      // جلسهٔ ذخیره‌شده باید loggedSets به شکل Record<string, آرایهٔ ست> داشته
      // باشد. دادهٔ ناقص/خراب (قطع‌شدن وسط نوشتن، نسخهٔ قدیمی، دستکاری) هرگز
      // بازیابی نمی‌شود — قبلاً فقط dayId/ایندکس اعتبارسنجی می‌شد و loggedSets
      // خراب می‌توانست در رندر ActiveWorkoutSession روی .map/.filter بترکد.
      const rawLoggedSets = (parsed.activeSession as { loggedSets?: unknown }).loggedSets;
      let loggedSets: ActiveSession["loggedSets"] | null = null;
      if (rawLoggedSets && typeof rawLoggedSets === "object" && !Array.isArray(rawLoggedSets)) {
        const sanitized: ActiveSession["loggedSets"] = {};
        let ok = true;
        for (const [exId, arr] of Object.entries(rawLoggedSets as Record<string, unknown>)) {
          if (!Array.isArray(arr)) { ok = false; break; }
          sanitized[exId] = arr
            .filter((s) => !!s && typeof s === "object")
            .map((s) => ({
              weight: Number((s as { weight?: unknown }).weight) || 0,
              reps: Number((s as { reps?: unknown }).reps) || 0,
              done: !!(s as { done?: unknown }).done,
            }));
        }
        if (ok) loggedSets = sanitized;
      }
      if (loggedSets === null) {
        // دادهٔ خراب — جلسه بازیابی نمی‌شود (UI سالم می‌ماند، جلسه از نو شروع می‌شود)
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
        return;
      }
      // ─── اعتبارسنجی جلسه در برابر برنامه فعلی (اگر لود شده باشد) ───
      // اگر برنامه regenerate شده باشد (روز حذف/حرکات کمتر)، ایندکس یا
      // روز restore‌شده می‌تواند خارج از محدوده باشد → crash loop رندر.
      // روز نامعتبر → جلسه پاک؛ ایندکس بزرگ → clamp به آخرین حرکت.
      // (اگر برنامه هنوز لود نشده، ویو خودش ایندکس را clamp می‌کند)
      const plan = useAppStore.getState().workoutPlan;
      let session: ActiveSession = { ...(parsed.activeSession as ActiveSession), loggedSets };
      if (plan && Array.isArray(plan.days) && plan.days.length > 0) {
        const day = plan.days.find((d) => d.day === session.dayId);
        const exCount = day?.exercises?.length ?? 0;
        if (!day || exCount === 0) {
          // روز جلسه دیگر در برنامه وجود ندارد — جلسه بی‌اعتبار است
          window.localStorage.removeItem(ACTIVE_SESSION_KEY);
          return;
        }
        session = {
          ...session,
          currentExerciseIdx: Math.min(Math.max(0, session.currentExerciseIdx ?? 0), exCount - 1),
        };
      }
      useAppStore.setState({ activeSession: session });
      // v190 — بعد از رفرش وسط «تمرین امروز»، back گوشی همچنان به ویوی قبلی برگردد
      // v225 — همان رفتار جدید: تأیید خروج (ایونت + re-arm) — workoutBackRestore
      ensurePanelEntry({ type: "workout-session" }, workoutBackRestore);
    }
  } catch {
    // داده خراب — کلید را پاک کن
    try {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════
//  کش پلن در localStorage (ضد فلیکر رفرش)
//  قبلاً بعد از هر رفرش، workoutPlan/mealPlan تا رسیدن پاسخ
//  /api/coach/plan خالی می‌ماند و داشبورد لحظه‌ای «بی‌پلن» رندر می‌شد
//  (فلیکر زشت برای دارندگان پلن — وب و هر دو WebView اندروید).
//  الگوی همان activeSession: با هر تغییر پلن در store، آخرین وضعیت به‌همراه
//  userId کاربر ذخیره می‌شود (v153: TTL ۲ دقیقه — فقط ضدفلیکر first-paint)؛
//  بلافاصله بعد از شناختن کاربر در MainApp بازیابی می‌گردد تا اولین رندر
//  داشبورد پلن را داشته باشد؛ دادهٔ تازه همیشه از سرور می‌آید.
// ═══════════════════════════════════════════════════════════════
const PLAN_CACHE_KEY = "fitup_plan_cache_v1";
// v153 — دیرکتیو مالک: «کش در موبایل رو به اندازه کش در دسکتاپ پایین بیار تا
// همه چیز تازه و درست باشه». قبلاً ۲۴ ساعت بود + هر poll ۶۰ثانیه‌ای داشبورد
// savedAt را تازه می‌کرد → در WebView زندهٔ اپ عملاً «همیشه».
// v170 — الگوی نهایی «stale-while-revalidate اپ نیتیو»: نقش این کش first-paint
// ضد فلیکر است (پوستهٔ داشبورد با پلنِ شناخته‌شده رندر می‌شود) و تازگی واقعی
// بلافاصله بعد از آن با fetch سرور + diff-guard تأمین می‌شود؛ تغییر برنامه از
// مسیرهای پالس/رویداد (fitup-program-updated) هم درجا invalid و refetch می‌شود.
// پس TTL طولانی‌تر (۶ ساعت) دیگر ریسک کهنگی ندارد — فقط تجربهٔ «اپ سنگینِ
// نصب‌شده» را می‌سازد: رفرش = پلن همان لحظه روی صفحه، بدون اسکلتون.
const PLAN_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // ۶ ساعت (فقط first-paint)

interface PlanCacheEntry {
  userId: string;
  workoutPlan: WorkoutPlanContent | null;
  mealPlan: MealPlanContent | null;
  savedAt: number;
}

/**
 * ذخیره پلن فعلی store برای کاربر جاری.
 * در loadPlans داشبورد (هر چرخه fetch) و subscribe تغییر پلن صدا زده می‌شود؛
 * v153 — TTL کش ۲ دقیقه است (فقط ضدفلیکر اولین رندر) — هیچ تازگیِ کش ۲۴ساعتهٔ
 * قدیمی باقی نمی‌ماند و داده واقعی همیشه از سرور می‌آید.
 */
export function savePlanCache(): void {
  if (typeof window === "undefined") return;
  try {
    const { user, workoutPlan, mealPlan } = useAppStore.getState();
    if (!user?.id) return; // کاربر لاگین نیست — چیزی برای ذخیره نیست
    if (!workoutPlan && !mealPlan) return; // پلنی وجود ندارد (کاربر بی‌پلن کش نمی‌شود)
    // v48: پلن خراب (بدون days آرایه‌ای) کش نمی‌شود — ضد کرش داشبورد بعد از رفرش
    if (
      workoutPlan &&
      !Array.isArray((workoutPlan as { days?: unknown }).days)
    ) {
      return;
    }
    // v59: برنامهٔ غذایی ناقص (بدون meals آرایه‌ای) هم کش نمی‌شود
    if (
      mealPlan &&
      !Array.isArray((mealPlan as { meals?: unknown }).meals)
    ) {
      return;
    }
    const entry: PlanCacheEntry = {
      userId: user.id,
      workoutPlan,
      mealPlan,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage پر است یا غیرفعال — بی‌صدا رد شو
  }
}

/** پاک‌کردن کش پلن — در reset()/خروج از حساب */
export function clearPlanCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PLAN_CACHE_KEY);
  } catch {}
}

/**
 * بازیابی پلن از کش — فقط وقتی userId ذخیره‌شده با کاربر جاری یکی باشد
 * و TTL ۲۴ ساعته نگذشته باشد. در MainApp بلافاصله بعد از شناختن کاربر
 * (پاسخ /api/auth/me) صدا زده می‌شود تا اولین رندر داشبورد پلن کش‌شده
 * را ببیند (بدون فلیکر «بی‌پلن»).
 */
export function restorePlanCache(userId: string): void {
  if (typeof window === "undefined") return;
  if (!userId) return;
  try {
    const raw = window.localStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PlanCacheEntry | null;
    const fresh =
      !!parsed &&
      typeof parsed.savedAt === "number" &&
      Date.now() - parsed.savedAt < PLAN_CACHE_MAX_AGE_MS;
    if (!parsed || !fresh || parsed.userId !== userId) {
      // کش مال کاربر دیگری است یا منقضی شده — پاکش کن
      window.localStorage.removeItem(PLAN_CACHE_KEY);
      return;
    }
    // فقط فیلدهای خالی store پر می‌شوند — داده تازه‌ترِ fetch جاری بازنویسی نشود
    // v48: اعتبارسنجی شکل داده — پلن کش‌شدهٔ خراب (بدون days آرایه‌ای) هرگز
    // بازیابی نمی‌شود (ریشهٔ کرش «Cannot read properties of undefined (find)»
    // در داشبورد وقتی محتوای ناقص از کش می‌آید).
    const st = useAppStore.getState();
    // v59 — اعتبارسنجی عمیق‌تر (ممیزی کرش فقط-برخی-دستگاه‌ها):
    // علاوه بر days، آرایهٔ exercises هر روز و meals/برنامهٔ غذایی هم باید
    // درست باشند — کشِ نوشته‌شدهٔ نسخهٔ قدیمی اپ با شکل متفاوت هرگز بازیابی
    // نمی‌شود (ریشهٔ «Cannot read properties of undefined (map/length)» فقط
    // روی دستگاه‌هایی که کش قدیمی دارند — مالک با کش تازه هرگز نمی‌بیند).
    const wp = parsed.workoutPlan as { days?: Array<{ exercises?: unknown }> } | null | undefined;
    const wpValid =
      !!wp &&
      Array.isArray(wp.days) &&
      wp.days.every((d) => d == null || Array.isArray((d as { exercises?: unknown }).exercises));
    if (!st.workoutPlan && wpValid) {
      useAppStore.setState({ workoutPlan: parsed.workoutPlan });
    }
    const mp = parsed.mealPlan as { meals?: unknown; totalCalories?: unknown } | null | undefined;
    const mpValid = !!mp && Array.isArray(mp.meals) && typeof mp.totalCalories === "number";
    if (!st.mealPlan && mpValid) {
      useAppStore.setState({ mealPlan: parsed.mealPlan });
    }
  } catch {
    // داده خراب — کلید را پاک کن
    try {
      window.localStorage.removeItem(PLAN_CACHE_KEY);
    } catch {}
  }
}

// با هر تغییر workoutPlan/mealPlan کش به‌روز می‌شود (الگوی همان activeSession)
if (typeof window !== "undefined") {
  useAppStore.subscribe((state, prev) => {
    if (state.workoutPlan !== prev.workoutPlan || state.mealPlan !== prev.mealPlan) {
      savePlanCache();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  v48 — به‌روزرسانی زندهٔ اطلاعات کاربر (رفع باگ بحرانی مالک)
//  «اپ/سایت را باز می‌کنم، صفحهٔ چت می‌آید و می‌نویسد چت با فیتاپ قفل است
//   با اینکه پلن حرفه‌ای دارم — باید یک بار رفرش کنم تا اطلاعات برگرده.»
//
//  ریشه: در اپ‌های نیتیو (WebView زنده) و PWA، اپ ممکن است ساعت‌ها باز بماند؛
//  اطلاعات کاربر در store فقط هنگام لود کامل صفحه از /api/auth/me خوانده
//  می‌شود. اگر session قدیمی/ناقص باشد (شبکهٔ ضعیف موقع باز شدن، session
//  restore اپ، تغییر پلن در دستگاه دیگر و…)، همهٔ گیت‌های پلن (چت/باشگاه/…)
//  بر اساس دادهٔ کهنه «قفل» نشان می‌دهند تا کاربر دستی رفرش کند.
//
//  راه‌حل: refreshUserIfNeeded — هر بار اپ به foreground برمی‌گردد (و در
//  mount)، اطلاعات کاربر بی‌صدا از سرور تازه می‌شود؛ همهٔ گیت‌ها همان لحظه
//  زنده می‌شوند. throttle ۶۰ ثانیه‌ای + گارد sessionEpoch (ضد پاسخِ کهنه
//  بعد از logout — الگوی v45).
// ═══════════════════════════════════════════════════════════════
let _lastUserRefreshAt = 0;
// v156 — ضد قفل ابدی: فلگ boolean با یک /api/auth/me آویزان (سوکت مردهٔ سوییچ
// VPN) برای همیشه true می‌ماند → رفرش کاربر هرگز دیگر انجام نمی‌شد و گیت‌های
// پلن تا بازوبست کردن اپ کهنه می‌ماندند. حالا زمان‌محور است (۲۰ ثانیه منقضی).
let _refreshInFlightSince = 0;

/**
 * v170 — علامت‌گذاری «اطلاعات کاربر همین الان از سرور تازه شد».
 * page-client بعد از doAuthCheck موفق (boot) صدا می‌زند تا تأخیر ۲.۵ ثانیه‌ایِ
 * main-app دیگر auth/me دومِ همیشگیِ هر بوت را نزند (درخواست تکراری روی هر
 * رفرش — گزارش مالک: کندی رفرش داشبورد). throttle ۶۰ ثانیه‌ای پایین خودش
 * بقیهٔ مسیرها (foreground/focus) را مثل قبل مدیریت می‌کند.
 */
export function markUserFresh(): void {
  const now = Date.now();
  _lastUserRefreshAt = now;
  // v170 — مهرِ زمانی در خودِ store (نه متغیر ماژول) تا هر چانکی که store را
  // می‌خواند همان یک حقیقت را ببیند (گارد دو-نسخه‌ای شدن ماژول در باندل‌ها).
  try {
    useAppStore.setState({ bootAuthCheckedAt: now });
  } catch {}
}

export async function refreshUserIfNeeded(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  const st = useAppStore.getState();
  // کاربر لاگین نیست → کاری نیست (auth screen خودش flow ورود را دارد)
  if (!st.user) {
    if (!force) return;
  }
  const nowMs = Date.now();
  if (!force && nowMs - _lastUserRefreshAt < 60_000) return; // throttle ۶۰s
  // یک رفرش در جریان (اگر >۲۰ ثانیه معلق مانده = منقضی — سوییچ VPN سوکت مرده)
  if (_refreshInFlightSince && nowMs - _refreshInFlightSince < 20_000) return;
  _lastUserRefreshAt = nowMs;
  _refreshInFlightSince = nowMs;
  const epochAtStart = useAppStore.getState().sessionEpoch;
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return;
    if (useAppStore.getState().sessionEpoch !== epochAtStart) return; // وسطش logout شد
    const data = await res.json();
    if (useAppStore.getState().sessionEpoch !== epochAtStart) return;
    // v51 (مسدودسازی): اگر کاربر وسط سشن توسط ادمین مسدود شود، همان لحظه که
    // اپ به foreground برمی‌گردد صفحهٔ زیبای «مسدود» جای کل پنل را می‌گیرد.
    if (data?.blocked && !data?.user) {
      useAppStore.getState().setUser(null);
      useAppStore.getState().setScreen("blocked");
      return;
    }
    if (data?.user) {
      const cur = useAppStore.getState().user;
      // فقط اگر چیزی عوض شده setUser کن — از re-render بی‌مورد سراسری جلوگیری می‌کند
      const prevPlanName = cur?.planName ?? null;
      const changed =
        !cur ||
        prevPlanName !== data.user.planName ||
        cur.subscriptionEnd !== data.user.subscriptionEnd ||
        cur.hasActiveSubscription !== data.user.hasActiveSubscription ||
        cur.hasPendingSubscription !== data.user.hasPendingSubscription ||
        cur.avatarUrl !== data.user.avatarUrl ||
        cur.name !== data.user.name ||
        cur.walletBalance !== data.user.walletBalance ||
        cur.videoAnalysisUsed !== data.user.videoAnalysisUsed ||
        cur.bloodTestUsed !== data.user.bloodTestUsed ||
        cur.lastPlanExpiresAt !== data.user.lastPlanExpiresAt;
      if (changed) {
        useAppStore.getState().setUser(data.user);
        // ─── Task 3-a: رویداد سراسری تغییر پلن ───
        // بعد از رفرش موفق، اگر planName نسبت به قبل عوض شده (فعال‌سازی پلن
        // توسط ادمین، ارتقا، انقضا، …) یک CustomEvent سبک روی window می‌فرستیم
        // تا هر ویوی علاقه‌مند (بدون وابستگی به subscription زوستاند) بتواند
        // واکنش جداگانه داشته باشد. خود داشبورد از طریق store خودکار
        // re-render می‌شود — این رویداد صرفاً لایهٔ اختیاری دوم است.
        if (prevPlanName !== (data.user.planName ?? null)) {
          try {
            window.dispatchEvent(
              new CustomEvent("fitup-plan-changed", {
                detail: { planName: data.user.planName ?? null, previous: prevPlanName },
              })
            );
          } catch {
            // رویداد هرگز جریان رفرش را نمی‌شکند
          }
        }
      }
    }
  } catch {
    // شبکه در دسترس نیست — دفعهٔ بعد foreground دوباره تلاش می‌شود
  } finally {
    _refreshInFlightSince = 0;
  }
}

// Persian number formatting helper for components
export { toPersianDigits } from "./types";
