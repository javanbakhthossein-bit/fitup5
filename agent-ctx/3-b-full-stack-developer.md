# Task 3-b — daily completion sync + medal (سکشن مشترک «روز کامل»)

Agent: full-stack-developer
Date: 2026-09-08

## Files changed
| File | Type | Notes |
|---|---|---|
| `src/lib/fitness/day.ts` | NEW | `getTehranDayKey()` (Intl en-CA / Asia-Tehran — same fixed +03:30 math as `/api/nutrition/log` & `/api/workout-day-status`), `tehranDayKeyToUtcMidnight()` |
| `src/app/api/daily-status/route.ts` | NEW | GET (+`?date`, `last7` = latest 7 rows desc) + POST (workout / nutrition / medalSeen upsert on `(userId, tehranToday)`); auth via `requireAuth`+`apiError`; Persian 400s for bad date/empty body |
| `src/components/fitness/daily-medal.tsx` | NEW | `DailyMedalBadge` (gold pill «روز کامل ✨»), `DailyMedalCelebration` (createPortal body, z-[120], pointerEvents:auto, no blur, one-shot particles, spring trophy, CTA «عالیه!»), helpers `reportDailyStatus` / `notifyMedalSeen` / `claimMedalCelebration` (module-level once-per-day guard) / `useDailyStatusLoader` |
| `src/lib/fitness/store.ts` | EDIT (additive) | `dailyStatus` state slice + `loadDailyStatus` (silent fail → loaded:true) + `applyDailyStatusUpdate`; types `DailyStatusState`/`DailyStatusPatch`/`DEFAULT_DAILY_STATUS` exported; `reset()` got exactly one added line |
| `src/components/fitness/views/gym-mode-view.tsx` | EDIT | after the existing completion toast → POST `{workout:{done:true,source:"gym_mode"}}`; badge in header; celebration at root |
| `src/components/fitness/views/active-workout-session.tsx` | EDIT | `finish()`: non-blocking `reportDailyStatus({workout:{done:true,source:"guided_session"}})` (keepalive); existing celebration untouched |
| `src/components/fitness/views/nutrition-view.tsx` | EDIT | threshold `targetCal>0 ? consumed ≥ round(target*0.8) : consumed>0`; one-shot POST `{nutrition:{done,calories,target}}`; badge under title; celebration w/ stats grid; once-done stays done for the day |
| `src/components/fitness/views/dashboard-view.tsx` | EDIT | `useDailyStatusLoader()` on mount (cheap GET on landing tab); badge next to plan badge in «برنامه شما» header; celebration render |

## API contract
- `GET /api/daily-status[?date=YYYY-MM-DD]` → `{date, workoutDone, workoutSource, workoutAt, nutritionDone, nutritionAt, medalSeenAt, dayComplete, last7:[{date,workoutDone,nutritionDone,dayComplete}]}` (labels Persian-free)
- `POST /api/daily-status` body `{workout?:{done:true,source:"gym_mode"|"guided_session"}, nutrition?:{done:boolean,calories?,target?}, medalSeen?:true}` → same row JSON. `workoutAt`/`nutritionAt` keep first completion time; `workoutSource` sticks to first source; `medalSeen` sets `medalSeenAt` only once (later calls no-op). `calories`/`target` accepted but not persisted (schema frozen).

## Medal trigger logic
1. Any workout completion (gym mode effect or guided-session `finish()`) → POST workout.
2. Nutrition threshold met → one-shot POST nutrition.
3. Whichever POST returns `dayComplete && !medalSeenAt` + wins `claimMedalCelebration(date)` (module guard → only one view auto-opens per day) opens the full-screen celebration; closing it calls `notifyMedalSeen()` (client-guarded POST `{medalSeen:true}`).
4. Badge (`dayComplete`) shows in gym header / nutrition title / dashboard «برنامه شما» header; click re-opens celebration.

## Quality gates
- `bunx tsc --noEmit` → exit 0
- `bun run lint` → 0 errors / 73 warnings (baseline, unchanged)
- `dev.log` → no compile errors; smoke 401s on unauthed GET/POST (compiled + guarded)
- E2E with temp user (09120000931, DB-seeded OTP): full contract verified incl. dayComplete flip, medalSeen idempotency, first-time stamps preserved, Tehran boundary (20:43 UTC → key «2026-09-09»); test user + OTPs deleted afterwards; `DayCompletion` count = 0; owner data untouched
- No new npm packages, no build, no dev-server restart; `/api/workout-day-status` untouched; gym toast + guided celebration behavior unchanged

## Intentionally skipped
- Dashboard does NOT auto-open the celebration (badge only) — auto-celebration lives in the completing sections per brief.
- Guided-session finish does not render the medal itself (deliberate: its own workout celebration stays canonical; medal appears in gym/nutrition/dashboard).
- `calories`/`target` not persisted (DayCompletion schema frozen by brief).
