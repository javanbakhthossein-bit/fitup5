# Task: PRO-WORKOUT-SUPERSETS-GIANTS

**Agent:** full-stack-developer
**Task:** حرفه‌ای‌سازی برنامه تمرینی — پشتیبانی از جاینت‌ست + نمایش حرفه‌ای + PDF + ویدیو

## Summary
Added full Giant Set support (۴+ حرکت پشت‌سرهم بدون استراحت) alongside the existing superset/triset, with professional visual grouping in both the interactive UI and the printable PDF export, plus a group-membership section in the exercise detail overlay.

## Files Modified

### 1. `src/lib/fitness/types.ts`
- Extended `PlanExercise.supersetType` union to `"superset" | "triset" | "giant"`
- Added two optional fields to `PlanExercise`:
  - `circuitRounds?: number` — تعداد دفعات تکرار کل سیرکویت (۱ تا ۵)
  - `restBetweenRounds?: number` — استراحت بین دورها (ثانیه)

### 2. `src/lib/fitness/ai.ts` (function `generateWorkoutPlan`)
- Updated JSON example to include `circuitRounds: 3` and `restBetweenRounds: 180`
- Replaced section ۷ (superset/triset instructions) with comprehensive pro guidance:
  - superset (۲ حرکت): antagonist مثل پرس سینه + بارفیکس
  - triset (۳ حرکت): same muscle group
  - giant (۴+ حرکت): full muscle group یا full-body circuit
  - circuitRounds = ۲ تا ۴، restBetweenRounds = ۱۲۰ تا ۱۸۰ ثانیه
  - استفاده از giant به‌ویژه برای fat_loss و advanced/pro
- Updated enrichment section to preserve `circuitRounds` (clamp 1..5) and `restBetweenRounds` (clamp 0..600)

### 3. `src/components/fitness/views/workouts-view.tsx`
- **Added exported `groupExercises()` helper** that takes `PlanExercise[]` and returns:
  - `{ type: "single", exercise }` for non-grouped exercises
  - `{ type: "group", group, groupType, circuitRounds?, restBetweenRounds?, exercises }` for grouped ones
- **Added exported `groupTypeLabel()` helper** for Persian labels (سوپرست/تری‌ست/جاینت‌ست)
- **Interactive view (around line 477)**: now groups exercises via `groupExercises()` and wraps grouped exercises in a new `SupersetGroupCard` component. Each exercise still receives `setExerciseDetailId` + `setOverlay("exerciseDetail")` so the detail overlay opens for EVERY exercise regardless of group membership.
- **New `SupersetGroupCard` component**: visual container with:
  - Header bar: group label + letter + "بدون استراحت بین حرکات" hint
  - For giant sets: extra info row showing "X دور" + "استراحت بین دورها: Ys"
  - Purple theme for superset/triset, **rose/orange theme for giant** to differentiate
- **`ExerciseCard`**: added optional `hideSupersetBadge` prop (when inside group, the badge is redundant since the group container header shows the label). The inner badge text now uses `groupTypeLabel()` so giant sets show "جاینت‌ست" correctly.
- **`PrintableWorkout` (PDF export)**: replaced flat row rendering with grouped rendering:
  - Group banner row spanning all 5 columns showing "سوپرست A — بدون استراحت بین حرکات" (or triset/giant with circuitRounds + restBetweenRounds for giant)
  - Grouped exercise rows have a colored background tint (light purple for superset/triset, light rose for giant)
  - The `#` column shows "A1", "A2", "A3" for grouped exercises (letter + index within group)
  - Non-grouped exercises still show numeric 1, 2, 3...
  - The "استراحت" column shows "—" for grouped exercises (no rest between movements)

### 4. `src/components/fitness/views/exercise-detail-overlay.tsx`
- Imported `Repeat`, `Layers`, `Clock` icons + `PlanExercise` type
- Added local `groupTypeLabel()` helper
- Added `setExerciseDetailId` destructure from store (was missing)
- Changed `let exercise = null` → `let exercise: PlanExercise | null = null` (TS strict fix)
- Added `groupSiblings` collection (other exercises in same group)
- **New group-membership section** after the title: shows "این حرکت عضو [سوپرست/تری‌ست/جاینت‌ست] گروه X است" with:
  - Hint about no-rest-between-movements
  - For giant sets: circuitRounds + restBetweenRounds info
  - Clickable chips for sibling exercises (calls `setExerciseDetailId(sib.id)` to navigate between grouped exercises)
  - Purple theme for superset/triset, rose theme for giant

## Color Scheme
- superset (۲ حرکت): purple (`purple-500`, `fuchsia-500`) — preserves existing styling
- triset (۳ حرکت): purple (same as superset)
- giant (۴+ حرکت): **rose/orange** (`rose-500`, `orange-500`) — distinct to differentiate

## Verification
- `bun run lint`: 0 errors, 62 pre-existing warnings (all "unused eslint-disable" in other files)
- `bunx tsc --noEmit --skipLibCheck`: 0 errors in modified files (workouts-view, exercise-detail-overlay, fitness/types, fitness/ai)
- Dev server log shows successful 200 responses, no compile errors

## Notes
- All numbers displayed use the existing `toPersianDigits()` helper
- The `ExerciseCard`'s auto-expand behavior (first card of the day is expanded by default) is preserved via the `absIdx` counter that increments across both single and grouped items
- The `onShowDetail` callback is invoked for EVERY exercise (including those in groups) — the overlay correctly handles all cases
- The existing `circuitRounds`/`restBetweenRounds` AI output is preserved through enrichment (clamped to safe ranges)
