# PHOTO-ANALYSIS-V2 — Photo Analysis Flow Fix

## Summary

This task refactored the photo analysis flow in the فیتاپ (FitUp) Persian RTL fitness platform:

1. **Removed all photo uploads from onboarding** — both blood test photos AND body photos. The optional body measurements (chest/arm/waist/hip/thigh) were moved into Step 3 (Nutrition) as a collapsible component. `TOTAL_STEPS` is now `4` (was `5`). The progress bar shows 4 steps.
2. **Fixed Ultimate plan notification in payment/verify** — body photos are required; video and blood test are clearly marked as optional/deltbekhah. Both Advanced and Ultimate now use `pending_body_photo` status (not `pending_body_media`).
3. **Made video optional in submit-body-analysis** — removed the video requirement check; renamed `needsBodyVideo` to `canSubmitVideo` in both GET and POST.
4. **Real body photo analysis** — photos are now read from disk as base64, analyzed via `analyzeBodyPhoto` VLM (gemini-3.5-flash), combined into a summary, and passed to `generateWorkoutPlan`/`generateMealPlan` via `extras.bodyPhotoAnalysis`. Video is also analyzed if submitted (optional).
5. **Updated `buildPlanAwareInstructions`** to accept and inject `bodyPhotoAnalysis` (no capability gate — works for Advanced+).
6. **Enhanced the post-generation notification** to mention how many photos were analyzed using `toPersianDigits`.
7. **Updated `body-analysis-banner.tsx`** — `state.needsBodyVideo` → `state.canSubmitVideo`, label "ویدیوی فرم بدن (الزامی)" → "ویدیوی فرم بدن (اختیاری)", submit button no longer requires video, added note about blood test being available separately in the panel.
8. **Verified blood test view still works independently** — `blood-test-view.tsx` + `/api/coach/analyze-blood` are unchanged and remain a separate panel feature.

## Files Modified

- `src/components/fitness/onboarding-screen.tsx` — removed StepUpload, removed all photo state/handlers/imports, moved `OptionalBodyMeasurements` into StepNutrition, updated `finish()` and `canNext()`.
- `src/app/api/payment/verify/route.ts` — updated Ultimate plan notification (video optional, blood test optional), both Advanced+Ultimate use `pending_body_photo`.
- `src/app/api/coach/submit-body-analysis/route.ts` — full rewrite: video optional, real VLM photo analysis, video analysis (optional), pass `extras.bodyPhotoAnalysis` + `extras.videoAnalysisResult` to plan generators.
- `src/lib/fitness/ai.ts` — `buildPlanAwareInstructions` accepts `bodyPhotoAnalysis` (no capability gate), `generateWorkoutPlan`/`generateMealPlan` type signatures updated.
- `src/components/fitness/views/body-analysis-banner.tsx` — `needsBodyVideo` → `canSubmitVideo`, label "اختیاری", no video requirement, blood test note.

## Verification

- `bun run lint` → 0 errors, 30 warnings (all pre-existing "Unused eslint-disable directive").
- dev.log: ✓ Compiled (no syntax/type errors). Pre-existing "Missing credentials" errors for OpenAI client are due to `AVALAI_API_KEY` not being set in the sandbox — they are environment issues, not code regressions. The same error appears on `/api/coach/plan` (unchanged endpoint).
- POST /api/onboarding without auth → 401 ✓
- POST /api/payment/verify without auth → 401 ✓
