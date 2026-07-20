"use client";

import { create } from "zustand";
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
  | "tool-tdee"
  | "tool-exercises"
  | "tool-foods"
  | "articles"
  | "article"
  | "exercise-detail"
  | "food-detail"
  | "terms";

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
  role: string;
  onboardingDone: boolean;
  hasActiveSubscription: boolean;
  subscriptionEnd: string | null;
  planName: Plan | null;
  planExpiresAt: string | null;
  // آخرین پلن (حتی منقضی) — برای renewal banner و نمایش وضعیت
  lastPlanName?: Plan | null;
  lastPlanExpiresAt?: string | null;
  walletBalance: number;
  acceptedTermsVersion: number | null;
  // === AI usage counters (for plan limit display in blood-test/video-analysis views) ===
  videoAnalysisUsed?: number;
  bloodTestUsed?: number;
}

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

  // Chat mode: nika (sales/support) vs coach (smart coach, plan-gated)
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

  // Active workout session
  activeSession: ActiveSession | null;
  startSession: (dayId: string) => void;
  endSession: () => void;
  logSet: (exerciseId: string, setNumber: number, weight: number, reps: number) => void;

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
    | "survey";
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
  setChatMessages: (m: ChatMessageDto[]) => void;
  addChatMessage: (m: ChatMessageDto) => void;

  notifications: NotificationDto[];
  setNotifications: (n: NotificationDto[] | ((prev: NotificationDto[]) => NotificationDto[])) => void;
  unreadCount: number;

  // Plan generation loading
  generatingPlan: boolean;
  setGeneratingPlan: (v: boolean) => void;

  // Onboarding draft
  onboardingDraft: Partial<OnboardingData>;
  setOnboardingDraft: (d: Partial<OnboardingData>) => void;

  // Plan that user selected on landing — persisted across auth+onboarding so we can guide them to buy it after analysis
  pendingPlanId: string | null;
  setPendingPlanId: (id: string | null) => void;

  // Reset
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: typeof window !== "undefined"
    ? (() => {
        // در مرورگر: بلافاصله URL را بخوان تا loading نبینیم
        const params = new URLSearchParams(window.location.search);
        const article = params.get("article");
        if (article) return "article" as AppScreen;
        const exercise = params.get("exercise");
        if (exercise) return "exercise-detail" as AppScreen;
        const food = params.get("food");
        if (food) return "food-detail" as AppScreen;
        const tool = params.get("tool");
        if (tool === "tdee") return "tool-tdee" as AppScreen;
        if (tool === "exercises") return "tool-exercises" as AppScreen;
        if (tool === "foods") return "tool-foods" as AppScreen;
        const screenParam = params.get("screen");
        if (screenParam === "articles") return "articles" as AppScreen;
        if (screenParam === "terms") return "terms" as AppScreen;
        if (screenParam === "contact") return "contact" as AppScreen;
        if (screenParam === "auth") return "auth" as AppScreen;
        if (screenParam === "panel") return "main" as AppScreen;
        // PWA standalone → loading (auth check لازم)
        if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true) {
          return "loading" as AppScreen;
        }
        // مرورگر معمولی → loading (auth check برای نمایش نام کاربر)
        return "loading" as AppScreen;
      })()
    : "loading",
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

  chatMode: "nika",
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
    fetch("/api/nutrition/log", {
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
    })
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json().catch(() => null);
        // جایگزینی id موقت با id سرور (تا حذف بعدی درست کار کند)
        if (data?.food?.id && data.food.id !== tempId) {
          set((s) => ({
            loggedFoods: s.loggedFoods.map((x) =>
              x.id === tempId ? { ...x, id: data.food.id as string } : x
            ),
          }));
        }
      })
      .catch(() => {
        // سکوت — state محلی حفظ می‌شود تا کاربر داده را از دست ندهد
        // در بارگذاری بعدی صفحه، با سرور reconcile می‌شود
      });
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
    if (!id.startsWith("food_")) {
      fetch(`/api/nutrition/log/${id}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {/* silent */});
    }
  },
  loadTodayFoodLogs: async () => {
    try {
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
  setChatMessages: (m) => set({ chatMessages: m }),
  addChatMessage: (m) => set((s) => ({ chatMessages: [...s.chatMessages, m] })),

  notifications: [],
  setNotifications: (n) =>
    set((state) => {
      const arr = typeof n === "function" ? n(state.notifications) : n;
      return { notifications: arr, unreadCount: arr.filter((x) => !x.read).length };
    }),

  generatingPlan: false,
  setGeneratingPlan: (v) => set({ generatingPlan: v }),

  onboardingDraft: {},
  setOnboardingDraft: (d) =>
    set((s) => ({ onboardingDraft: { ...s.onboardingDraft, ...d } })),

  pendingPlanId: null,
  setPendingPlanId: (id) => set({ pendingPlanId: id }),

  reset: () =>
    set({
      screen: "landing",
      user: null,
      mainTab: "dashboard",
      overlay: null,
      workoutPlan: null,
      mealPlan: null,
      chatMessages: [],
      nikaMessages: [],
      chatMode: "nika",
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
    }),
}));

// Persian number formatting helper for components
export { toPersianDigits } from "./types";
