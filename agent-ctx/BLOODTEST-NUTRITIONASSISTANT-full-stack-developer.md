# Task ID: BLOODTEST-NUTRITIONASSISTANT
# Agent: full-stack-developer
# Task: Fix blood test view + complete test categories + nutrition assistant card

## Context
- Read /home/z/my-project/worklog.md to understand previous work (Persian RTL AI fitness coach Next.js 16 app).
- Previous agents had built the core fitness platform with 4-tier plans, onboarding, AI coach, workout/meal plans, etc.

## Files Modified (5 files)

### 1. NEW: src/lib/fitness/blood-tests.ts
- Comprehensive shared constant `BLOOD_TEST_CATEGORIES` — 10 categories, 47 tests:
  - CBC (8 tests): hemoglobin, hematocrit, RBC, WBC, platelets, MCV, MCH, MCHC
  - Lipid Panel (4): total_cholesterol, ldl, hdl, triglycerides
  - Liver (4): alt, ast, bilirubin, alp
  - Kidney (3): creatinine, bun, uric_acid
  - Thyroid (3): tsh, ft3, ft4
  - Hormones (9): testosterone_total, testosterone_free, estrogen, cortisol, insulin, growth_hormone, lh, fsh, prolactin
  - Vitamins & Minerals (8): vitamin_d, vitamin_b12, iron, ferritin, magnesium, zinc, calcium, phosphorus
  - Blood Sugar (2): fbs, hba1c
  - Inflammation (2): crp, esr
- Each test has: key, Persian name, English name (for AI matching), unit, Persian reference range, description
- Helper exports: `ALL_BLOOD_TESTS`, `TOTAL_BLOOD_TESTS`, `findBloodTest`, `findBloodCategory`, `bloodTestSummaryForPrint`, `bloodTestPromptSummary`

### 2. src/lib/fitness/ai.ts — analyzeBloodTest()
- Added import: `import { bloodTestPromptSummary } from "./blood-tests";`
- Expanded system prompt: now mentions "متخصص پزشکی، تغذیه ورزشی" (sports nutritionist)
- Expanded user prompt: lists ALL 47 tests across 10 categories with units & reference ranges, asks AI to extract values from image, compare with normal ranges, analyze for athletes/bodybuilders
- New return shape includes `supplements` field and richer `markers` shape: each marker now carries `key`, `category`, `categoryName`, `name`, `value`, `unit`, `status`, `reference`, `explanation`
- Added `supplements` parsing in return statement

### 3. src/components/fitness/views/blood-test-view.tsx — FULL REWRITE (was 490 lines → ~520 lines)
**Bug fix:** The hidden printable prescription div was previously rendered inside SheetContent (Radix Dialog). Because Radix Dialog creates its own stacking context, `zIndex: -9999` did NOT push the printable div behind SheetContent's opaque background — it leaked through and visually overlapped visible content. Fixed by:
- Default `display: none` (was always visible at top:0/left:0 with negative z-index)
- New `isCapturing` state toggles `display: block` only during html-to-image capture
- Offscreen position `left: -9999px` ensures even during capture it never overlaps visible content
- Removed the old runtime style mutation hack that tried (and failed) to fix this

**Layout reorganization (per spec):**
1. Upload section (only if `!file`) — top
2. Uploaded image preview card (only if `file && !result`) — clean separate card with reset/analyze buttons
3. Analyzing progress (only if `analyzing`)
4. AI analysis results (only if `result`) — separate card showing:
   - Overall health score
   - Markers grouped by category (preserves canonical order from BLOOD_TEST_CATEGORIES)
   - Each marker row: name, value+unit, status badge, reference range, AI explanation
   - Deficiencies card (amber)
   - Food/lifestyle recommendations card
   - **NEW** Supplements card (orange, with Pill icon)
   - Medical warnings (red)
5. Download/print prescription form (always at bottom) — uses `BLOOD_TEST_CATEGORIES` to display all 47 tests grouped by category in the printable form

The printable prescription now shows: header (Fitap logo), intro banner with totals, 10 category sections (each with icon + name + count + table of tests with name/English name/ref range/description), notes section, footer.

### 4. src/components/fitness/views/dashboard-view.tsx — Nutrition Assistant Card Fix
- Line 319-326: GatedFeature for "دستیار تغذیه":
  - Changed `sub` from `"تعویض هوشمند غذا"` → `"برنامه غذایی و مکمل اختصاصی"`
  - Changed `onClick` from `setOverlay("nutrition")` → `setMainTab("nutrition")` (the user reported the card didn't work — there is no "nutrition" overlay, it's a main tab)

### 5. src/components/fitness/views/nutrition-view.tsx — Always Fetch Current Plan
- `useEffect` (lines 99-119): changed from `if (!mealPlan) fetch...` (only fetch if cache empty) to **always fetch** fresh from `/api/coach/plan` with `cache: "no-store"` on mount
- Added `cancelled` flag to prevent state updates after unmount
- This ensures the nutrition tab always shows the user's CURRENT active meal plan, not a stale/cached version
- Verified: supplements come from `mealPlan?.supplements` (not workout plan) ✓
- Verified: meal photo analysis button uses `canAccess(user?.planName, "mealPhotoAnalysis")` for Advanced+ plans ✓
- Verified: `/api/coach/plan` GET returns user's most recent active meal plan (`active: true`, ordered by `createdAt desc`) ✓

## Verification
- `bun run lint`: 0 errors, 29 warnings (all pre-existing "Unused eslint-disable directive" warnings in other files; none in my new/modified files)
- Dev server log: compile successful, `/api/coach/plan` returning 200 OK, no errors related to changes
- `TOTAL_BLOOD_TESTS` = 47 tests across 10 categories
