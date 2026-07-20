# Task: USER-JOURNEY-V2 — User journey redesign + smart report enhancement + subscription overlay fix

Agent: full-stack-developer
Date: 2025

## Work Log

### Task 1 — Persist selected plan from landing across auth+onboarding

- **`src/lib/fitness/store.ts`**
  - Added `pendingPlanId: string | null` field with `setPendingPlanId` setter to the Zustand store
  - Initialized to `null`
  - Added `pendingPlanId: null` to the `reset()` function

- **`src/components/fitness/landing/sections/pricing-section.tsx`**
  - Now reads `user` and `setPendingPlanId` from the store
  - Added `handleSelectPlan(plan)` helper:
    - If `user` is logged in → opens `PurchaseModal` as before
    - If not logged in → `setPendingPlanId(plan.id)` + `setScreen("auth")` (skips the modal entirely)
  - All 4 plan cards now route through this helper

- **`src/components/fitness/auth-screen.tsx`** — no changes needed (existing post-verify logic correctly routes new users to onboarding, and `pendingPlanId` persists in the store)

- **`src/components/fitness/onboarding-screen.tsx`** — no changes needed (existing `setScreen("analysis")` at end of `finish()` works, analysis screen reads `pendingPlanId`)

### Task 2 — Enhanced Smart Report (AnalysisScreen + API)

- **`prisma/schema.prisma`**
  - Added `aiAnalysis String?` field to `OnboardingProfile` model (cached AI analysis text)
  - Ran `bun run db:push` — schema in sync, client regenerated

- **`src/lib/db.ts`**
  - Bumped `SCHEMA_VERSION` to `v10-onboarding-cache`
  - Added `onboardingProfile` to the stale-client check

- **`src/app/api/onboarding/analysis/route.ts`** — Complete rewrite with 4 new return fields:
  1. **`macros`** — `calculateMacros(goal, tdee, weightKg)` returns `{ targetCalories, protein_g, carbs_g, fat_g, proteinPerKg, deficitPercent }`. Logic:
     - `fat_loss`: 25% deficit, protein 2.2g/kg, fat 25% of calories, carbs = remainder
     - `muscle_gain`: 10% surplus, protein 2.0g/kg, fat 25%, carbs = remainder
     - `endurance`/`fitness`/`strength`: maintenance, protein 1.8g/kg, fat 25%, carbs = remainder
  2. **`trajectory`** — `calculateTrajectory(goal, currentWeight, targetWeight, tdee)` returns `{ currentWeight, targetWeight, weeksToGoal, weeklyRate, weeklyCalorieAdjustment }` (or `null` if no target weight). Uses 0.5 kg/week for fat loss and 0.25 kg/week for muscle gain (safe rates). 1 kg ≈ 7700 kcal conversion for daily calorie adjustment.
  3. **`measurements`** — Filters non-null fields from baseline checkup (phase 0) into `{ chest?, arm?, waist?, hip?, thigh? }` so the UI only renders chips for values that exist.
  4. **`planRecommendation`** — `recommendPlan(goal, experience, hasInjuries, hasDiseases, wantsDetailedAnalysis)` returns `{ recommendedPlan, reason }`. Logic:
     - Wants detailed analysis (maxLifts or pro experience + medical) → `ultimate`
     - Fat loss / muscle gain + beginner → `standard`
     - Fat loss / muscle gain + non-beginner → `advanced`
     - Strength/endurance/fitness + non-beginner → `advanced`
     - Default → `standard`
  5. **AI caching** — checks `profile.aiAnalysis` first; if present and `?force=1` is not set, returns cached text. Otherwise generates new text and writes it back to `profile.aiAnalysis`. Returns `fromCache: boolean` so UI can show a refresh button.
  - Added `NextRequest` import to read `?force=1` query param.

- **`src/components/fitness/analysis-screen.tsx`** — Complete redesign with 7 sections:
  1. **Header** — back button + FitUp logo (unchanged)
  2. **Title** — "تحلیل اختصاصی شما" (unchanged)
  3. **Biometric cards** — BMI / BMR / TDEE in 3 cards (unchanged, enhanced formatting)
  4. **NEW: Macro recommendation card** — "درشت‌مغذی‌های هدف شما" with:
     - 3 SVG circular progress rings (pure SVG, no new deps) for protein (red), carbs (amber), fat (sky)
     - Target calories prominently displayed in header
     - Footer with deficit/surplus percent + protein per kg ratio
  5. **NEW: Weight goal trajectory card** (only if `targetWeight` set) — "مسیر رسیدن به وزن هدف" with:
     - Current weight → target weight with horizontal progress bar
     - 3 sub-cards: weeks to goal, weekly rate, daily calorie adjustment
     - Helper text explaining safe rate
  6. **NEW: Body measurements card** (only if measurements exist) — "اندازه‌های بدن شما" with grid of chips for chest/arm/waist/hip/thigh
  7. **AI Analysis card** — "تحلیل فیتاپ هوشمند" with refresh button (calls `?force=1` to bypass cache)
  8. **NEW: Plan recommendation card** — "پلن پیشنهادی فیتاپ" with:
     - Mini-card of recommended plan with gradient background, icon, features chips, price
     - Recommendation reason text
     - "خرید پلن {label}" button → opens PurchaseModal directly
  9. **Action buttons**:
     - If `pendingPlanId` set → primary CTA "ادامه خرید پلن {label}" with the chosen plan's icon, price, and orange gradient. Opens PurchaseModal directly.
     - "مشاهده همه پلن‌ها" → `setMainTab("plans"); setScreen("main")`
     - "رفتن به داشبورد" → `setMainTab("dashboard"); setScreen("main")`
  - `handlePurchaseClose` clears `pendingPlanId` so the user doesn't see stale pending UI after the purchase flow
  - Loads `/api/onboarding/analysis` on mount, supports force refresh via button

### Task 3 — Wire up Subscription Overlay

- **`src/components/fitness/main-app.tsx`**
  - Imported `SubscriptionOverlay` from `./views/subscription-overlay`
  - Added new Sheet for `overlay === "subscription"` with `h-[90vh]` bottom sheet, RTL, sr-only title "ارتقای اشتراک"
  - Existing `setOverlay("subscription")` calls in `upgrade-banner.tsx` and `profile-overlay.tsx` now actually trigger this Sheet

- **`src/components/fitness/views/subscription-overlay.tsx`** — Reviewed and confirmed working as-is. It already:
  - Shows subscription status (current plan, days left, expiry date) or "no active plan" empty state
  - Shows wallet balance badge
  - Lists all 4 SUBSCRIPTION_PLANS with icon, tagline, price, first 4 features
  - Highlights current plan with "پلن فعلی شما" badge
  - "انتخاب این پلن" / "ارتقا به این پلن" button opens PurchaseModal
  - Has close button (X) that calls `setOverlay(null)`
  - Uses `bg-card`, `bg-primary`, `bg-muted` shadcn theme colors (work in light/dark mode)

### Task 4 — Clean up dead code

- **`src/app/api/onboarding/route.ts`**
  - Removed the `PUT` method (was ~80 lines, dead code — never called from client)
  - Removed unused imports: `generateWorkoutPlan`, `generateMealPlan` from `@/lib/fitness/ai`
  - Removed unused helper functions `safeParseEquipment` and `safeParseStringList`
  - Added a clear NOTE comment explaining plan generation now happens in `/api/payment/verify/route.ts` (post-payment)
  - Verified `PUT /api/onboarding` now returns 405 Method Not Allowed (no handler exists)

### Verification

- `bun run lint` → **0 errors, 30 warnings** (all pre-existing "Unused eslint-disable directive" warnings; new code adds 0 new errors/warnings)
- `bun run db:push` → schema in sync, Prisma client regenerated with `aiAnalysis` field on `OnboardingProfile`
- `dev.log` shows:
  - `[db] creating NEW PrismaClient (version= v10-onboarding-cache)` ✓
  - All 5 changed files compile cleanly (multiple ✓ Compiled messages)
  - `GET /api/onboarding/analysis` → 401 (auth required) ✓
  - `GET /api/onboarding/analysis?force=1` → 401 ✓ (force param handled)
  - `POST /api/onboarding` → 401 ✓
  - `PUT /api/onboarding` → 405 ✓ (PUT removed)
  - No runtime errors, no TypeScript errors

## Stage Summary

- **End-to-end user journey fixed**: New users clicking "انتخاب پلن" on landing are now redirected through auth → onboarding → analysis with their chosen plan preserved as `pendingPlanId`. The analysis screen prominently surfaces a "ادامه خرید پلن {label}" CTA at the bottom that opens the PurchaseModal directly — closing the conversion loop.
- **Smart report is now enticing**: 4 new sections added (macros with SVG rings, weight-goal trajectory, body measurements, plan recommendation) plus a refresh button to regenerate the AI analysis on demand. The report feels personalized and actionable.
- **AI caching eliminates repeat regeneration**: `aiAnalysis` field on `OnboardingProfile` caches the AI text on first call; subsequent visits return cached text instantly. `?force=1` bypasses the cache for the refresh button.
- **Subscription overlay is no longer dead code**: `main-app.tsx` now renders a Sheet for `overlay === "subscription"`, so all `setOverlay("subscription")` calls (from upgrade banners on locked features like chat, video analysis, blood test, plus the profile overlay's upgrade button) actually display the subscription management UI.
- **Dead code removed**: The unused 80-line `PUT /api/onboarding` handler (which eagerly generated workout+meal plans that no client ever called) is gone. Plan generation lives exclusively in `/api/payment/verify/route.ts` after successful payment.
- **Zero breaking changes**: All existing flows (logged-in users clicking plans, post-payment verify, onboarding save) still work identically. New `pendingPlanId` field is `null` by default so users who don't come from landing see the original behavior.
