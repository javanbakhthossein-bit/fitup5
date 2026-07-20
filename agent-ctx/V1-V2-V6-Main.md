# Task ID: V1-V2-V6
## Agent: Main (Z.ai Code)
## Task: YouTube videos for ALL 100 exercises + fix FAQ section background + remove external dependencies for Iran hosting

## Summary
All three sub-tasks completed and verified end-to-end. See `/home/z/my-project/worklog.md` (Task ID: V1-V2-V6) for full details.

## What was done

### 1. YouTube videos for ALL 100 exercises (V1)
- Replaced `YOUTUBE_URLS` map in `src/lib/fitness/seed.ts` with a comprehensive 100-entry map
- Used the 21 verified real YouTube video IDs explicitly provided in the task description for common exercises (پرس سینه با هالتر → rT7DgCr-3pg, etc.)
- For exercise variations and less-common movements (Meadows row, single-leg RDL, etc.), mapped to closely related exercise tutorial videos so NO exercise has an empty `youtubeUrl`
- Ran `bun run src/lib/fitness/seed.ts` → "Seeded 100 exercises (100 with YouTube videos)"
- DB verification: `ExerciseLibrary.count()` = 100 total, `youtubeUrl != ""` count = 100

### 2. FAQ section background fix (V2)
- `src/components/fitness/landing/sections/faq-section.tsx` rewritten:
  - Section: `bg-card/30 border-y` (gray on mobile) → `bg-white border-y border-orange-100`
  - Header badge: `bg-primary/10 border-primary/20 text-primary` → `bg-orange-50 border-orange-200 text-orange-600`
  - Heading text: added `text-slate-900`; subtitle `text-muted-foreground` → `text-slate-500`
  - Accordion items: `bg-card border` → `bg-white border border-orange-200 shadow-sm hover:border-orange-300 [&[data-state=open]]:border-orange-400 [&[data-state=open]]:shadow-md`
  - Trigger text: added `text-slate-900 hover:text-orange-600 transition-colors`; content `text-muted-foreground` → `text-slate-600`
- Verified via agent-browser eval: bgColor = `rgb(255, 255, 255)`, 8 accordion items render

### 3. Remove external dependencies for Iran hosting (V6)
- **Fonts**: Removed `import { Vazirmatn } from "next/font/google"` from `src/app/layout.tsx`. Added local fallback stack in `globals.css` `:root`: `--font-vazirmatn: Vazirmatn, "Vazirmatn Variable", Tahoma, Arial, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;`. Verified via agent-browser that body fontFamily is now this local stack (no Google Fonts request).
- **jsdelivr CDN**: Removed `<link href="https://cdn.jsdelivr.net/...Vazirmatn-font-face.css">` from `blood-test-view.tsx` printable prescription; replaced with inline `font-family: Vazirmatn, Tahoma, Arial, system-ui, sans-serif;`. Also updated inline `fontFamily` in `blood-test-view.tsx:166` and `workouts-view.tsx:256` to use the same Tahoma-first fallback stack.
- **Unused package**: Removed `"z-ai-web-dev-sdk": "^0.0.18"` from `package.json` (no source files import it since AvalAI migration). Ran `bun install` (1 package removed, lockfile updated).
- **Verified OK (kept)**: Zarinpal (`api.zarinpal.com`), AvalAI (`api.avalai.ir`), YouTube embed URLs in seed.ts (intentionally external), metadataBase URL (metadata only), admin-overlay.tsx Google Analytics/Meta Pixel template snippets (admin-controlled optional).
- Final grep confirms no remaining `next/font/google`, `googleapis`, `gstatic`, `cloudflare`, `jsdelivr`, `unpkg`, or `cdnjs` references in `src/`.

## Verification
- `bun run lint` → **0 errors**, 18 pre-existing warnings (baseline unchanged)
- Dev server: GET / returns 200 OK
- agent-browser eval confirms FAQ section bgColor is white with orange border
- agent-browser eval confirms body font-family is the local Tahoma-based stack (no Google Fonts)

## Files modified
1. `src/lib/fitness/seed.ts` — YOUTUBE_URLS map expanded from 65 to 100 entries
2. `src/components/fitness/landing/sections/faq-section.tsx` — white bg + orange accents
3. `src/app/layout.tsx` — removed Google Fonts import, body className simplified
4. `src/app/globals.css` — added `:root --font-vazirmatn` local system-font stack
5. `src/components/fitness/views/blood-test-view.tsx` — removed jsdelivr CDN link, Tahoma fallback
6. `src/components/fitness/views/workouts-view.tsx` — Tahoma fallback for inline fontFamily
7. `package.json` — removed z-ai-web-dev-sdk dependency
