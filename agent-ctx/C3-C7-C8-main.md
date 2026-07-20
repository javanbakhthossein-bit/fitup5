# Task C3-C7-C8 — Work Record

**Agent:** Main (Z.ai Code)
**Task:** Fix DialogContent accessibility warnings + Nutrition per-item calories + Gym Mode seek bar & playlist persistence

## Summary

Fixed three issues identified in the task:
1. **DialogContent accessibility warnings** — Root cause: SheetContent wrappers in `main-app.tsx` missing SheetTitle (Radix Sheet uses Dialog primitives internally)
2. **Nutrition per-item calorie display + total** — Both `nutrition-view.tsx` and `nutrition-overlay.tsx` now show prominent per-item calories, per-meal subtotals, and grand totals
3. **Gym Mode seek bar + playlist persistence** — Seek bar now works with mouse/touch/keyboard; playlist persists in IndexedDB across sessions via blob storage

## Files Modified

1. **`src/components/fitness/main-app.tsx`** — Added `SheetTitle` import and `<SheetTitle className="sr-only">` to all 7 SheetContent wrappers (notifications, profile, admin, exerciseDetail, gymMode, videoAnalysis, bloodTest)

2. **`src/components/fitness/views/nutrition-view.tsx`** — Redesigned logged food cards:
   - Prominent calorie count (orange-500 font-black, right-aligned)
   - Meal icon + bold name + meal type label
   - Macros row: 3 colored pills (P/C/F)
   - Total bar at list bottom (orange gradient, "مجموع" + total kcal)

3. **`src/components/fitness/views/nutrition-overlay.tsx`** — Redesigned meal items + subtotals:
   - Per-item: prominent calories + macro pills
   - Per-meal subtotal bar: orange-50 bg, P/C/F + total kcal
   - Sticky grand total bar at bottom of overlay (orange gradient)

4. **`src/lib/fitness/store.ts`** — Added optional `blob?: Blob` field to `GymTrack` interface for persistence

5. **`src/components/fitness/views/gym-mode-view.tsx`** — Full Gym Mode update:
   - Seek bar: `progressBarRef`, `seekFromClientX()`, `handleTouchSeek()` (touch + preventDefault), `dir="ltr"` for predictable seeking, `h-3` (2x taller), `role="slider"` + ARIA, `onKeyDown` for ±5s seek, visible thumb, gradient fill
   - IndexedDB persistence: hydration on mount (loads blobs → creates URLs → replaces store), save on add, delete on remove, revoke URLs on unmount
   - Editable playlist verified (delete button + add music button both work)

## Files Created

1. **`src/lib/fitness/gym-playlist-db.ts`** — IndexedDB wrapper with `saveTrackToDB`, `loadTracksFromDB`, `deleteTrackFromDB`, `clearAllTracksFromDB` (all SSR-safe, Promise-based, with graceful failure)

## DialogContent/SheetContent Audit Results

### DialogContent (all already had DialogTitle — no changes needed):
- `purchase-modal.tsx` ✓
- `terms-modal.tsx` ✓
- `checkup-section.tsx` ✓
- `progress-view.tsx` ✓
- `admin-overlay.tsx` (8 dialogs) ✓

### SheetContent (FIXED — were missing SheetTitle):
- `main-app.tsx` — 7 sheets fixed with `<SheetTitle className="sr-only">` (Persian labels: اعلان‌ها / پروفایل / پنل مدیریت / جزئیات حرکت / حالت باشگاه / تحلیل ویدیو / تست خون)
- `sidebar.tsx` — already had SheetTitle (utility, not used directly)

## IndexedDB Schema
- DB name: `fitap_gym_playlist` (version 1)
- Object store: `tracks` (keyPath: `id`)
- Record shape: `{ id: string; name: string; blob: Blob }`

## Hydration Strategy
1. On mount: load all blobs from IndexedDB
2. Revoke any stale object URLs from previous mount
3. Create fresh object URLs from blobs
4. Replace playlist in zustand store
5. On unmount: revoke all current object URLs (blobs remain in IndexedDB)

## Quality
- `bun run lint` → **0 errors**, 18 pre-existing warnings (baseline unchanged)
- Dev server compiles cleanly, all routes 200
- No new accessibility console warnings

## View Previous Work
- `/home/z/my-project/worklog.md` — full project history
- `/home/z/my-project/agent-ctx/M-ALL-main.md` — Module 3 + per-user discounts + brand fix
- `/home/z/my-project/agent-ctx/GATE-FIX` reference (in worklog) — plan gating
