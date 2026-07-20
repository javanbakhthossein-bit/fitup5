# Task: SECURITY-ARTICLES-PWA
**Agent**: full-stack-developer
**Task**: Security fixes (option B) + article table/heading fixes + PWA + install notification

## Work Log

### Part A — Security fixes

**A1 — Gating bug fix (src/lib/fitness/auth.ts)**
- Read `requirePlanCapability` and the `minTierMap`. The API routes call `requirePlanCapability("bloodTestAnalysis")` and `requirePlanCapability("videoBodyAnalysis")` but the map only had `bloodTest` and `videoAnalysis` keys → `minTier` was 0 → capability gate was silently bypassed for everyone.
- Added `bloodTestAnalysis: 4` and `videoBodyAnalysis: 4` aliases in `minTierMap` pointing to Ultimate tier (same as canonical keys). Includes explanatory comment about why the aliases exist.

**A2 — Hardcoded API key removed (src/lib/fitness/avalai-image.ts)**
- Removed hardcoded fallback `"aa-zNeavvOx0lBA6ZVtl8pmsLJbq8c8gAFNOLPuNRXgW6gowssI"`.
- Changed to `const AVALAI_IMAGE_API_KEY = process.env.AVALAI_IMAGE_API_KEY;` with a `console.warn` if missing.
- Added explicit guard at the top of each retry attempt: if `!AVALAI_IMAGE_API_KEY`, throws a clear Persian error message instead of sending an unauthenticated request to AvalAI.

**A3 — Real usage limits enforced**
- `buildUserDto` (src/lib/fitness/auth.ts) now returns `videoAnalysisUsed` and `bloodTestUsed` counters (read from the User model).
- `UserDto` interface (src/lib/fitness/store.ts) extended with `videoAnalysisUsed?` and `bloodTestUsed?`.
- `src/app/api/coach/analyze-blood/route.ts`:
  - Reads `bloodTestUsed` from DB, compares to `getCapabilities(planName).bloodTestLimit`.
  - Returns 403 with `code: "LIMIT_REACHED"` and Persian message "سقف استفاده از این قابلیت پر شده است." if at limit.
  - After successful analysis, in a `$transaction`: creates an `AnalysisResult` row AND increments `user.bloodTestUsed`.
- `src/app/api/coach/analyze-video/route.ts`: same pattern with `videoAnalysisUsed` / `videoAnalysisLimit`.
- `blood-test-view.tsx`: 
  - Replaced hardcoded `usedCount = 0; limit = 1` with `getCapabilities(user?.planName ?? null).bloodTestLimit` and `user?.bloodTestUsed ?? 0`.
  - Shows "سقف استفاده پر شده" in header when `limitReached`.
  - Replaces the upload card with a "limit reached" amber banner when `limitReached`.
  - After successful POST, optimistically updates `user.bloodTestUsed` in the store via `useAppStore.setState` so the counter reflects the new value immediately.
- `video-analysis-view.tsx`: same pattern.

**A4 — New AnalysisResult model + persistence**
- `prisma/schema.prisma`: Added `AnalysisResult` model with `id, userId, type, result, mediaUrl, createdAt` and indexes on `[userId]` and `[type]`. Added `analysisResults AnalysisResult[]` relation to `User`.
- Bumped `SCHEMA_VERSION` in `src/lib/db.ts` to `v11-analysis-results` and added `!(c as any).analysisResult` to the stale-client detector.
- Ran `bun run db:push` successfully — schema synced, Prisma client regenerated.
- Both API routes now have a GET handler that returns the user's latest stored result (`findFirst orderBy createdAt desc`).
- Both UI views fetch the latest stored result on mount via `useEffect(() => fetch("/api/coach/analyze-{blood|video}"))`, so refresh no longer loses the analysis.

### Part B — Article fixes

**B1 — Table rendering (src/components/fitness/articles/article-page.tsx)**
- Replaced bare `<table>`, `<th>`, `<td>` overrides with a richer table renderer:
  - Wraps the `<table>` in a `<div className="my-6 overflow-x-auto rounded-xl border border-slate-200 shadow-sm">`.
  - Adds `thead` (orange bg), `tbody` (divide-y), `tr` (hover effect + last:border-0), `th` (orange-tinted header with right-aligned bold text), `td` (bordered cells with proper padding).
- Tables now have visible borders, header background, hover effect — fixes the "just words and flat lines" issue.

**B2 — H1→H2 SEO comment (article-page.tsx)**
- Added inline comment explaining WHY markdown content H1 is rendered as H2: "Markdown content H1 is rendered as H2 because the article title is already H1 (SEO best practice — only one H1 per page)".

**B3 — "h3" literal text in FAQ**
- Wrote `/tmp/fix-articles.ts` script that:
  - Reads all published articles
  - Regex `/^(#{1,6})\s*[hH][1-6][:：\-\s]+/gm` matches `### H3:` / `### h3 ` / `## H2-` patterns and replaces with just `$1 ` (the heading level + space)
  - Saves updated content to DB
- Ran it: fixed 3 of 10 articles (`محاسبه کالری دقیق`, `جدول کالری غذاها`, `بانک حرکات ورزشی`).
- Updated `seo-agent.ts` content system prompt with new rules: "هیچ‌گاه کلمات h1, h2, h3, H1, H2, H3 را به‌عنوان متن در heading‌ها ننویس".
- Added a post-processing step in `generateArticle` that runs the same regex on the AI output before saving — so future articles are auto-cleaned.

**B4 — "ف" icon replaced with Dumbbell**
- `articles-page.tsx` (header): replaced `<span className="text-white font-black text-xs">ف</span>` with `<Dumbbell className="w-4 h-4 text-white" strokeWidth={2.5} />`. Imported `Dumbbell` from `lucide-react`.
- `article-page.tsx` (`ArticleTopNav`): same replacement. Imported `Dumbbell` from `lucide-react`.

**B5 — Missing cover images**
- Wrote `/tmp/fix-missing-covers.ts`:
  - Finds all published articles with `coverImage: ""`.
  - For each: calls `generateImage({ prompt: "Professional fitness photograph for an article titled \"...\"" , aspectRatio: "16:9" })`, then `processAndSaveArticleImage` to resize to cover 1200x675 WebP.
  - Updates `article.coverImage` and `article.ogImage` with the saved URL.
- Ran it: 2 articles (slug `fat-loss-tips`, `beginner-3day-program`) got new covers (39KB and 61KB WebP respectively).
- Verified via API: 0 articles without cover now.

**B6 — Consecutive duplicate images**
- Wrote `/tmp/fix-consecutive-images.ts`:
  - Regex `/(!\[[^\]]*\]\([^\)]+\))[\s\n]+(!\[[^\]]*\]\([^\)]+\))/g` matches two consecutive image markdown tags.
  - Replaces with `$1 + "\n\nبرای درک بهتر، تصویر زیر نکات کلیدی را نشان می‌دهد:\n\n" + $2`.
  - Loops up to 10 times to handle 3+ consecutive images.
- Ran it: fixed 2 articles (`محاسبه کالری دقیق`, `جدول کالری غذاها`).
- Verified via API: the transitional paragraph "برای درک بهتر، تصویر زیر نکات کلیدی را نشان می‌دهد" now appears between previously-consecutive images.

**B7 — SEO agent future-proofing (seo-agent.ts)**
- Updated content system prompt with 4 new explicit rules:
  - "هر مقاله حتماً باید یک H1 در ابتدا داشته باشد (عنوان مقاله)."
  - "هیچ‌گاه دو تصویر را پشت سر هم قرار نده — همیشه حداقل یک پاراگراف متن بین دو تصویر باشد."
  - "هیچ‌گاه کلمات h1, h2, h3, H1, H2, H3 را به‌عنوان متن در heading‌ها ننویس."
  - "از جدول Markdown (table) برای مقایسه‌ها و داده‌های ساختاریافته استفاده کن — حداقل یک جدول در هر مقاله."
- Added two post-processing safety nets in `generateArticle`:
  1. **Heading cleaner**: runs the same regex as the fix script (idempotent).
  2. **Consecutive-image fixer**: same loop as the fix script — inserts a transitional paragraph between any two adjacent images, even if the AI ignores the system prompt.
- Both safety nets log their activity to the run log.

### Part C — PWA + Install notification

**C1 — Service worker (public/sw.js)**
- New SW with `CACHE_NAME = 'fitup-v1'` and `APP_SHELL = ['/', '/manifest.json', '/logo.svg', '/favicon.png']`.
- `install`: caches app shell, `self.skipWaiting()`.
- `activate`: deletes old caches, `self.clients.claim()`.
- `fetch`: network-first for navigation (HTML) requests (keeps UI fresh, falls back to cache on offline); cache-first for other GET requests with runtime caching.
- `push`: parses JSON payload, calls `showNotification` with `dir: 'rtl', lang: 'fa'`, vibrate pattern `[100, 50, 100]`, icon/badge set to `/logo.svg`.
- `notificationclick`: focuses existing window if open, otherwise `openWindow`.

**C2 — SW registration (src/components/fitness/pwa-register.tsx + layout.tsx)**
- New client component `<PwaRegister />` that registers `/sw.js` on window `load` (waits for `complete` readyState to avoid competing with initial resource fetching).
- Logs `[PWA] SW registration successful, scope: ...` or `[PWA] SW registration failed: ...` to console (so verification can grep dev.log).
- Imported and rendered `<PwaRegister />` in `src/app/layout.tsx` body, before `<ThemeProvider>`.

**C3 — manifest.json update**
- `name`: "FitUp — مربی هوشمند بدنسازی", `short_name`: "FitUp".
- Added `scope: "/"`, `display_override: ["standalone", "minimal-ui"]`.
- Added 4 PNG icons (192x192 + 512x512, each with `purpose: "any"` AND `purpose: "maskable"`).
- Kept the SVG fallback with `purpose: "any"`.
- Each shortcut now has a `icons` array referencing `/icon-192.png` for richer Android install UI.

**C4 — PWA install prompt + post-login notification (src/components/fitness/pwa-install-prompt.tsx)**
- New client component `<PwaInstallPrompt />` rendered inside `<ThemeProvider>` in layout.tsx.
- Listens for `beforeinstallprompt` (Android Chrome) — saves the event for later use.
- After 8s of app use, shows a bottom banner with a "نصب برنامه" button (skipped if already prompted or running in standalone mode).
- On first login (`user` transitions null → non-null), after a 5s delay, creates a `system` Notification in DB via `POST /api/notifications` with:
  - `title`: "نصب اپلیکیشن فیتاپ 📱"
  - `body`: long Persian message about installing for reminders and notifications.
  - `meta`: `{ kind: "pwa_install" }`.
  - Uses `localStorage["pwa_install_notified"]` to avoid duplicate notifications.
- On "نصب برنامه" click: if `deferredPrompt` is available (Android Chrome), calls `prompt()` directly; otherwise opens a modal with platform-specific instructions.
- Modal detects platform via User-Agent:
  - **iOS Safari**: 3-step guide (Share → Add to Home Screen → Add) with Lucide icons.
  - **Android Chrome**: 3-step guide (three-dot menu → Add to Home Screen / Install app → Install).
  - **Other**: generic "click install icon in address bar" message.
- `localStorage["pwa_install_prompted"]` tracks if user has dismissed/installed.
- Added `POST /api/notifications` endpoint that allows users to create `system` notifications for themselves (only `system` type allowed, prevents abuse).

**C5 — App icons (192 & 512 PNG)**
- Wrote `/tmp/generate-icons.ts` using `sharp`:
  - Reads `public/favicon.png` (1024x1024 JPEG with .png extension).
  - Resizes to 192x192 PNG → `public/icon-192.png` (28KB).
  - Resizes to 512x512 PNG → `public/icon-512.png` (97KB).
- Updated `layout.tsx` `metadata.icons` and `<head>` to reference the new PNG icons (with `sizes` and `type: "image/png"`), plus `appleWebApp` config.
- Verified via curl: both icons return HTTP 200.

## Verification

- `bun run lint` → **0 errors**, 30 warnings (all pre-existing "Unused eslint-disable directive" — none from new code).
- `bun run db:push` → success ("Your database is now in sync with your Prisma schema").
- `dev.log` → clean `✓ Compiled in 198ms` and `✓ Compiled in 177ms`. Stale-client detector triggered correctly (`analysisResult= undefined` → new client created with v11).
- Smoke tests via curl:
  - `GET /api/coach/analyze-blood` → 401 ✓ (auth required)
  - `GET /api/coach/analyze-video` → 401 ✓ (auth required)
  - `GET /api/auth/me` → 200 `{"user":null}` ✓
  - `GET /manifest.json` → 200 with new name "FitUp — مربی هوشمند بدنسازی" ✓
  - `GET /sw.js` → 200 with `CACHE_NAME = 'fitup-v1'` ✓
  - `GET /icon-192.png` → 200 ✓
  - `GET /icon-512.png` → 200 ✓
- Article verification:
  - `/api/articles?pageSize=50` → 0 articles without cover (was 2) ✓
  - `/api/articles/food-calorie-chart` content → contains "برای درک بهتر، تصویر زیر نکات کلیدی را نشان می‌دهد" (transitional paragraph inserted) ✓
  - Same article → no remaining `### H3:` literal headings ✓
  - Same article → 135 markdown table lines (tables will render with the new enhanced styling) ✓
- HTML output of `/` → includes `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon` references ✓
- Fix scripts at `/tmp/fix-articles.ts`, `/tmp/fix-missing-covers.ts`, `/tmp/fix-consecutive-images.ts`, `/tmp/generate-icons.ts` — all run successfully.

## Stage Summary

- **Gating bug fixed**: `bloodTestAnalysis` and `videoBodyAnalysis` aliases added to `minTierMap` — Ultimate-tier capability check now correctly enforces for both API routes. Previously these endpoints were silently open to all plans because the keys didn't match.
- **Hardcoded API key removed**: `avalai-image.ts` no longer has a fallback AvalAI key. Throws a clear Persian error if env var missing.
- **Real usage limits**: Blood test (1/plan) and video analysis (10/plan) limits are now actually enforced server-side. UI shows real counters from `user.videoAnalysisUsed`/`bloodTestUsed` and disables upload when limit reached.
- **Analysis persistence**: New `AnalysisResult` Prisma model stores every blood-test/video-analysis result. UI fetches the latest on mount — refresh no longer loses data.
- **Article tables render properly**: New ReactMarkdown table components with bordered cells, orange-tinted headers, hover effect, overflow-x-auto wrapper. Tables now look like real tables, not "flat lines".
- **"h3" literal text cleaned**: 3 affected articles fixed via script; future-proofed via seo-agent prompt + post-processing regex safety net.
- **Dumbbell icon**: The "ف" text badge next to "مجله فیتاپ" is now a Dumbbell icon (consistent with the rest of the app).
- **Missing covers generated**: 2 articles that had no cover image now have AI-generated photorealistic fitness photos (WebP, 1200x675, ~40-60KB each).
- **Consecutive images separated**: 2 articles that had two images stacked back-to-back now have a transitional paragraph between them.
- **SEO agent hardened**: 4 new content rules in the system prompt + 2 idempotent post-processing safety nets (heading cleaner + consecutive-image fixer).
- **PWA installable**: Service worker + manifest + 192/512 PNG icons. SW caches app shell, network-first for navigations (fresh UI), handles push notifications (RTL Persian) and notification clicks (focus app).
- **PWA install prompt**: 8s after entering the app, a bottom banner suggests install. On Android Chrome it triggers the native install prompt; on iOS/other it opens a modal with platform-specific step-by-step instructions.
- **Post-login install notification**: 5s after first login, a `system` Notification is created in DB so it shows in the notifications panel.
- **0 lint errors**, 0 new warnings, 0 compile errors, db:push successful, all PWA assets serve HTTP 200.
