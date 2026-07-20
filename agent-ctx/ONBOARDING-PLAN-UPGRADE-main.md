# Task: ONBOARDING-PLAN-UPGRADE

**Agent:** Main (Z.ai Code)
**Date:** 2025-07-08
**Status:** ✅ COMPLETED

## Summary

Upgraded the onboarding flow and AI plan generation for the Persian RTL fitness platform فیتاپ (FitUp) to be much more professional and comprehensive for serious athletes. Added 11 new optional onboarding fields, enriched both workout and meal plan AI prompts with professional sports-science parameters (RPE, tempo, progressive overload, glycemic index, anti-inflammatory foods, hydration schedule, etc.), and updated all callers to pass the new fields.

## Files Modified

1. **`prisma/schema.prisma`** — Added 11 new optional fields to `OnboardingProfile` model:
   - `bodyFrame`, `sleepHours`, `stressLevel`, `waterHabit`, `targetDate`, `workoutTime`, `medicalConditions`, `currentSupplements`, `dislikedFoods`, `preferredCuisine` (+ auto-computed `waterGoalMl` on the OnboardingData DTO, not persisted as a column since it's derived from weight × 35 + activity)
   - Ran `bun run db:push` successfully

2. **`src/lib/fitness/types.ts`** — Added:
   - New enums: `BodyFrame`, `WorkoutTime`, `PreferredCuisine`, `MedicalConditionKey`
   - Persian label maps: `BODY_FRAME_LABELS`, `WORKOUT_TIME_LABELS`, `PREFERRED_CUISINE_LABELS`, `MEDICAL_CONDITION_LABELS`
   - Extended `OnboardingData` with 11 new optional fields + `waterGoalMl`
   - Extended `PlanExercise` with `rpe`, `tempo`, `substitution`
   - Extended `ExerciseSet` with optional `rpe`
   - Extended `WorkoutDay` with `warmup`, `cooldown` arrays
   - Added `WarmupCooldownItem`, `WeeklyProgression` interfaces
   - Extended `WorkoutPlanContent` with `weeklyProgression`, `safetyNotes`, `recoveryNotes`, `nutritionTimingNotes`, `supplementTimingNotes`, `medicalWarningFlags`
   - Extended `MealItem` with `glycemicIndex`, `antiInflammatory`, `micronutrients`, `prepTip`
   - Extended `Meal` with `timingNote`, `micronutrientHighlights`
   - Added `HydrationScheduleItem`, `PrePostWorkoutNutrition` interfaces
   - Extended `MealPlanContent` with `hydrationSchedule`, `antiInflammatoryFoods`, `prePostWorkoutNutrition`, `foodPrepTips`, `micronutrientHighlights`

3. **`src/components/fitness/onboarding-screen.tsx`** — Added 4 new collapsible "professional fields" sections:
   - **Step 1 (Basic Info) → `RecoveryLifestyleFields`**: body frame (3-button), sleep hours slider 4-12, stress level slider 1-5, water habit slider 0-15
   - **Step 2 (Activity & Goals) → `GoalTimelineFields`**: target date (date picker), preferred workout time (4-button)
   - **Step 3 (Training Prefs) → `MedicalAndSupplementsFields`**: medical condition checkboxes (7 conditions: diabetes, hypertension, thyroid, heart, back_pain, knee_pain, shoulder_issues), current supplements text input
   - **Step 4 (Nutrition) → `DietPreferencesFields`**: disliked foods tags input (add/remove), preferred cuisine (4-button), auto-calculated daily water goal display (weight × 35 ml + activity adjustment)
   - All sections are optional, collapsible, with Persian labels and lucide-react icons (Moon, Brain, Droplet, CalendarClock, Sunrise, Stethoscope, Pill, UtensilsCrossed, ShieldAlert, HeartPulse, Thermometer, X, Plus)
   - Used `Slider` and `Checkbox` shadcn/ui components
   - All new fields remain optional — existing flow untouched

4. **`src/app/api/onboarding/route.ts`** — Added:
   - `coerceMedicalConditions()` helper that filters incoming array to only allowed `MedicalConditionKey` values (TypeScript-safe)
   - Reads + saves all 11 new fields in the upsert (both `create` and `update` branches)
   - Auto-calculates `waterGoalMl` from weight × 35 ml + activity-based adjustment (+0/+250/+500 ml for sedentary/moderate/active+very_active)
   - Clears cached `aiAnalysis` on profile update (so cached text regenerates with new data)

5. **`src/lib/fitness/ai.ts`** — Major upgrade:
   - Imported new label maps: `BODY_FRAME_LABELS`, `WORKOUT_TIME_LABELS`, `PREFERRED_CUISINE_LABELS`, `MEDICAL_CONDITION_LABELS`
   - `buildUserContext()` now includes all 11 new fields, computes days-until-target-date, and appends a "نکات ایمنی مهم ورزشکار" block flagging medical conditions, injuries, low sleep, high stress, supplement interactions
   - `generateWorkoutPlan()` prompt rewritten as 15-rule professional standard:
     - Warm-up + cool-down protocols per day (arrays with name, durationSec, notes)
     - RPE (1-10) per exercise and per set
     - Tempo (4-digit format like "3-1-2-0" for eccentric-pause-concentric-pause)
     - Specific rest periods (30s/60s/90s/180s based on rep range)
     - Progressive overload scheme (`weeklyProgression` with strategy + week-by-week weight/rep changes over 4 weeks)
     - Exercise substitutions for limited equipment
     - Injury-prevention modifications based on medical conditions
     - `safetyNotes`, `recoveryNotes`, `nutritionTimingNotes`, `supplementTimingNotes`, `medicalWarningFlags` arrays
     - Personalization based on `workoutTime` (morning=strength, evening=hypertrophy), `targetDate` (timeline-aligned progression), `bodyFrame`, `trainingExperience`
   - `generateMealPlan()` prompt rewritten as 12-rule clinical sports-nutrition standard:
     - Glycemic index (low/medium/high) per food with rules per goal/diabetes/timing
     - Anti-inflammatory foods flagged + `antiInflammatoryFoods` array (for users with injuries/conditions)
     - `prePostWorkoutNutrition` (pre/post timing with macros)
     - `hydrationSchedule` (6+ time-point schedule with ml + notes, total = `waterGoalMl`)
     - Micronutrient highlights per food + per meal + program-level
     - Food prep tips (`foodPrepTips` array with weekly meal-prep advice)
     - `prepTip` per food (e.g. "بخارپز کن، نه سرخ‌کرده")
     - Cuisine-based food selection (Persian/Mediterranean/Asian/Mixed)
     - Personalization on `dislikedFoods`, `currentSupplements` (interaction warnings), sleep/stress
   - Parser (in `generateWorkoutPlan`/`generateMealPlan`) coerces new fields to safe types (numbers clamped, strings trimmed, arrays filtered) — never throws on malformed AI output

6. **`src/app/api/payment/verify/route.ts`** — `planData` now includes all 11 new fields read from `OnboardingProfile`, with `medicalConditions` parsed via existing `parseList` helper, and `waterGoalMl` auto-computed from current weight + activity level.

7. **`src/app/api/coach/submit-body-analysis/route.ts`** — Same `planData` enrichment as above, using existing `safeParseList` helper. `waterGoalMl` computed from `profile.weight`.

8. **`src/app/api/coach/plan/route.ts`** — Renamed `safeParseEquipment` → generic `safeParseList` (works for equipment, workoutDaysList, medicalConditions). `data` now includes all 11 new fields + auto-computed `waterGoalMl`. (Bonus caller not strictly required but consistent.)

## Backwards Compatibility

- All 11 new fields are **optional** (`String?`, `Int?`) in the schema — no migration of existing data needed
- Existing `OnboardingProfile` rows: new fields default to `null`
- Existing `WorkoutPlan`/`MealPlan` JSON content: new fields default to `undefined` and existing UI components continue to render old plans correctly (they only check for the new fields when present)
- Frontend onboarding form: new fields are inside collapsible "اختیاری" sections — empty by default, never required for `canNext()` validation
- TypeScript strict: all new fields typed as `?` optional on `OnboardingData` DTO

## Verification

- `bun run db:push`: ✅ successful (46ms, no migration warnings)
- `bun run lint`: ✅ **0 errors, 53 warnings** (all pre-existing `Unused eslint-disable directive` warnings, none from my changes)
- `npx tsc --noEmit`: ✅ no new errors introduced (only pre-existing unrelated errors remain in `programs-view.tsx`, `store.ts`, `use-nika-chat.ts`, `payment/verify/route.ts:75`, etc.)
- `dev.log`: ✅ no errors, server running smoothly, Fast Refresh reload after schema push

## What the User Gets Now

When a serious athlete goes through onboarding:
1. **Step 1** collects body frame (small/medium/large — affects ideal weight), sleep hours (slider), stress level (slider), current water habit (slider)
2. **Step 2** collects target date for their goal (timeline planning) and preferred workout time (morning/afternoon/evening/night for circadian optimization)
3. **Step 3** collects specific medical conditions (7 checkboxes: diabetes, hypertension, thyroid, heart, back pain, knee pain, shoulder issues) and current supplements being taken
4. **Step 4** collects disliked foods (tags input), preferred cuisine (Persian/Mediterranean/Asian/Mixed), and shows auto-calculated daily water goal (weight × 35 ml + activity bonus)

When they purchase a plan:
- **Workout plan** includes warm-up + cool-down protocols per day, RPE per exercise/set, tempo per exercise (e.g. "3-1-2-0"), specific rest periods (30s/60s/90s/180s), progressive overload scheme over 4 weeks, exercise substitutions, injury-prevention modifications, and a notes section with recovery advice (based on sleep/stress), nutrition timing (pre/post workout), supplement timing, and medical warning flags
- **Meal plan** includes glycemic index per food, anti-inflammatory foods (if injuries/conditions), pre/post workout nutrition timing, hydration schedule (6+ time points throughout day with ml amounts), micronutrient highlights per food/meal/program, food prep tips, and cuisine-based food selection

This brings the platform to a level suitable for serious/professional athletes.
