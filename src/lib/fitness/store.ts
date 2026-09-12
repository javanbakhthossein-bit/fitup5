"use client";

import { create } from "zustand";
import { isAppShellMode } from "./app-bridge";
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
  | "blocked"
  | "tool-tdee"
  | "tool-exercises"
  | "tool-foods"
  | "articles"
  | "article"
  | "exercise-detail"
  | "food-detail"
  | "terms"
  | "contact"
  | "about";

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
  | "mobileapp";

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

export type DailyStatusPatch = Partial<Omit<DailyStatusState, "loaded">> & { loaded?: boolean };

interface AppState {
  // Auth
  screen: AppScreen;
  user: UserDto | null;
  setUser: (u: UserDto | null) => void;
  setScreen: (s: AppScreen) => void;

  // New-terms modal — set to true when /api/auth/me returns
  // `termsUpdateRequired: true` (user was logged out due to outdated
  // TermsVersion). The global NewTermsModal renders on top of whatever
  // screen the user is on; on accept it clears this flag and navigates
  // to the auth screen for OTP.
  termsUpdateRequired: boolean;
  setTermsUpdateRequired: (v: boolean) => void;
  // Article slug for article detail screen
  articleSlug: string | null;
  setArticleSlug: (s: string | null) => void;
  // Exercise ID for SEO exercise detail screen
  exerciseId: string | null;
  setExerciseId: (s: string | null) => void;
  // Food ID for SEO food detail screen
  foodId: string | null;
  setFoodId: (s: string | null) => void;

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

  /**
   * آخرین وزن شناخته‌شده کاربر (کیلوگرم) — از داده‌های موجود (progress/checkup)
   * پر می‌شود تا تخمین کالری سوزانده به‌جای وزن هاردکد ۷۵ کیلو از این استفاده کند.
   * null = هنوز داده‌ای نداریم → fallback 75.
   */
  lastKnownWeightKg: number | null;
  setLastKnownWeightKg: (kg: number | null) => void;

  // Overlay views (rendered on top of main)
  overlay:
    | null
    | "notifications"
    | "profile"
    | "subscription"
    | "nutrition"
    | "admin"
    | "workoutDetail"
    | "exerciseDetail"
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

export const useAppStore = create<AppState>((set, get) => ({
  // همیشه "loading" شروع می‌شود تا server و client هماهنگ باشند (جلوگیری از hydration mismatch).
  // URL parsing در useEffect مربوط به page-client انجام می‌شود (applyUrlToScreen).
  // این الگو مطابق مستندات Next.js برای hydration-safe state است.
  screen: "loading",
  // 🩹 v45: شمارندهٔ session برای باطل‌کردن پاسخ‌های async بعد از خروج
  sessionEpoch: 0,
  user: null,
  setUser: (u) => set({ user: u }),

  setScreen: (s) => set({ screen: s }),

  // New-terms modal flag
  termsUpdateRequired: false,
  setTermsUpdateRequired: (v) => set({ termsUpdateRequired: v }),
  articleSlug: null,
  setArticleSlug: (s) => set({ articleSlug: s }),
  exerciseId: null,
  setExerciseId: (s) => set({ exerciseId: s }),
  foodId: null,
  setFoodId: (s) => set({ foodId: s }),

  mainTab: "dashboard",
  setMainTab: (t) => set({ mainTab: t }),

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
          // ردیفی در سرور ساخته نشده — DELETE معلق (اگر بود) لازم نیست
          deletedFoodTemps.delete(tempId);
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
      } catch {
        // سکوت — state محلی حفظ می‌شود تا کاربر داده را از دست ندهد
        // در بارگذاری بعدی صفحه، با سرور reconcile می‌شود
        deletedFoodTemps.delete(tempId);
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
  startSession: (dayId) => set({
    activeSession: {
      dayId,
      startedAt: new Date().toISOString(),
      currentExerciseIdx: 0,
      loggedSets: {},
    },
  }),
  endSession: () => set({ activeSession: null }),
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
    set({
      // 🩹 v45: باطل‌کردن پاسخ‌های async در-پرواز (setUser/setScreen کهنه)
      sessionEpoch: (get().sessionEpoch || 0) + 1,
      screen: afterLogoutScreen,
      user: null,
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
      articleSlug: null,
      exerciseId: null,
      foodId: null,
      pendingPlanId: null,
      termsUpdateRequired: false,
      bodyAnalysisOpen: false,
      plansLoaded: false,
      // Task 3-b: وضعیت روز کامل کاربر جدید نباید از کاربر قبلی بماند
      dailyStatus: { ...DEFAULT_DAILY_STATUS },
    });
    // کش پلن محلی هم پاک شود (خروج = داده پلن دیگر معتبر نیست؛ کاربر بعدی
    // نباید پلن کاربر قبلی را لحظه‌ای ببیند)
    clearPlanCache();
  },
}));

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
      // ─── اعتبارسنجی جلسه در برابر برنامه فعلی (اگر لود شده باشد) ───
      // اگر برنامه regenerate شده باشد (روز حذف/حرکات کمتر)، ایندکس یا
      // روز restore‌شده می‌تواند خارج از محدوده باشد → crash loop رندر.
      // روز نامعتبر → جلسه پاک؛ ایندکس بزرگ → clamp به آخرین حرکت.
      // (اگر برنامه هنوز لود نشده، ویو خودش ایندکس را clamp می‌کند)
      const plan = useAppStore.getState().workoutPlan;
      let session = parsed.activeSession;
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
//  userId کاربر ذخیره می‌شود (TTL ۲۴ ساعت)؛ بلافاصله بعد از شناختن کاربر در
//  MainApp بازیابی می‌گردد تا اولین رندر داشبورد پلن را داشته باشد.
// ═══════════════════════════════════════════════════════════════
const PLAN_CACHE_KEY = "fitup_plan_cache_v1";
const PLAN_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت

interface PlanCacheEntry {
  userId: string;
  workoutPlan: WorkoutPlanContent | null;
  mealPlan: MealPlanContent | null;
  savedAt: number;
}

/**
 * ذخیره پلن فعلی store برای کاربر جاری.
 * در loadPlans داشبورد (هر چرخه fetch) و subscribe تغییر پلن صدا زده می‌شود؛
 * savedAt تازه نوشته می‌شود تا TTL ۲۴ ساعته از سر گرفته شود.
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
let _refreshInFlight = false;

export async function refreshUserIfNeeded(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (_refreshInFlight) return;
  const st = useAppStore.getState();
  // کاربر لاگین نیست → کاری نیست (auth screen خودش flow ورود را دارد)
  if (!st.user) {
    if (!force) return;
  }
  const nowMs = Date.now();
  if (!force && nowMs - _lastUserRefreshAt < 60_000) return; // throttle ۶۰s
  _lastUserRefreshAt = nowMs;
  _refreshInFlight = true;
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
      const changed =
        !cur ||
        cur.planName !== data.user.planName ||
        cur.subscriptionEnd !== data.user.subscriptionEnd ||
        cur.hasActiveSubscription !== data.user.hasActiveSubscription ||
        cur.hasPendingSubscription !== data.user.hasPendingSubscription ||
        cur.avatarUrl !== data.user.avatarUrl ||
        cur.name !== data.user.name ||
        cur.walletBalance !== data.user.walletBalance ||
        cur.videoAnalysisUsed !== data.user.videoAnalysisUsed ||
        cur.bloodTestUsed !== data.user.bloodTestUsed ||
        cur.lastPlanExpiresAt !== data.user.lastPlanExpiresAt;
      if (changed) useAppStore.getState().setUser(data.user);
    }
  } catch {
    // شبکه در دسترس نیست — دفعهٔ بعد foreground دوباره تلاش می‌شود
  } finally {
    _refreshInFlight = false;
  }
}

// Persian number formatting helper for components
export { toPersianDigits } from "./types";
