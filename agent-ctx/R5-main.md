# Task R5 — Analytics/Search Console code injection system

**Agent:** Main (Z.ai Code)
**Task ID:** R5
**Date:** 2026-07-01

## Objective

Add an analytics/search console code injection system to the admin panel:
- New Prisma `HeadCode` model
- Admin CRUD APIs + public read API
- Server-side SSR injection in `layout.tsx` (3 placements: head, body_start, body_end)
- New "کدهای تحلیلی" admin tab with table, create/edit dialog, active toggle, quick templates (GA4, Search Console, Meta Pixel)

## What was built

### 1. Prisma — `prisma/schema.prisma`
Added `HeadCode` model with: id, name, type (analytics|search_console|pixel|custom), code (raw HTML), placement (head|body_start|body_end, default head), isActive (default true), createdAt, updatedAt.

Ran `bun run db:push --force-reset` then `bun run src/lib/fitness/seed.ts` to reset + reseed.

### 2. DB client guard — `src/lib/db.ts`
Bumped `SCHEMA_VERSION` to `v4-headcode` and extended `isStaleClient()` to also check for `headCode` property so stale cached clients force a rebuild.

### 3. API routes
- `src/app/api/admin/head-codes/route.ts` — admin GET (list) + POST (create) with validation
- `src/app/api/admin/head-codes/[id]/route.ts` — admin PUT (partial update) + DELETE
- `src/app/api/head-codes/route.ts` — PUBLIC GET (no auth), returns codes grouped by placement: `{ head, bodyStart, bodyEnd, total }`

All admin routes use `requireAdmin()` (401 unauth / 403 non-admin). Public route has no auth.

### 4. SSR injection — `src/components/fitness/head-code-injector.tsx` (NEW)
Async server component that:
- Takes `placement: "head" | "body_start" | "body_end"`
- Fetches active HeadCodes directly from DB filtered by placement
- Renders concatenated raw HTML via `<div dangerouslySetInnerHTML={{ __html: combined }} suppressHydrationWarning />`
- Try/catch wraps only the DB fetch (not JSX construction — lint-safe)
- Returns `null` on error or empty list (never crashes layout)

### 5. Layout wiring — `src/app/layout.tsx`
- Added `<head>` element (Next.js merges with metadata-generated tags) with `<HeadCodeInjector placement="head" />`
- Added `<HeadCodeInjector placement="body_start" />` at top of `<body>`
- Added `<HeadCodeInjector placement="body_end" />` at bottom of `<body>`

### 6. Admin UI — `src/components/fitness/views/admin-overlay.tsx`
- Extended `AdminTab` union with `"head_codes"`
- Added tab `{ id: "head_codes", label: "کدهای تحلیلی", icon: Code2 }` (between مقالات and قوانین)
- New constants: `HEAD_CODE_TYPES` (4 types w/ colors), `HEAD_CODE_PLACEMENTS` (3 placements), `HEAD_CODE_TEMPLATES` (GA4, Search Console, Meta Pixel — full boilerplate code with PLACEHOLDERs)
- New helper functions: `headCodeTypeLabel`, `headCodeTypeColor`, `headCodePlacementLabel`
- New `HeadCodesTab` component: summary card with active/total badges + brand names + "کد جدید" button; table (name+code preview, color-coded type Badge, placement, inline Switch for isActive, edit/delete actions); empty state
- New `HeadCodeEditorDialog` component: quick templates row (3 buttons auto-fill code+type+placement+name), name Input, type Select, placement Select with helper text, code Textarea (LTR, font-mono), isActive Switch; validates name ≥ 2 chars and code ≥ 5 chars before POST/PUT

## Verification

End-to-end curl test as admin (09000000000 / admin123):
- Unauthorized POST → 401 ✓
- Authenticated POST → 200, created with id ✓
- Public GET → returned new code in `head` array ✓
- `GET /` HTML contains `googletagmanager` + `G-TEST123` (SSR injection verified) ✓
- PUT (deactivate) → 200 ✓; public GET empty ✓
- PUT (reactivate) → 200 ✓
- DELETE → 200 ✓; public GET empty ✓
- `GET /` HTML no longer contains `G-TEST123` (no stale injection) ✓
- Prisma queries in dev.log show 3 HeadCode findMany per page render (one per placement) ✓

## Quality

- `bun run lint` → **0 errors**, 17 pre-existing warnings (all unused eslint-disable directives in unrelated files)
- Dev server compiles cleanly, no runtime errors
- All API endpoints return 200/401/404/400 correctly

## Notes / Decisions

- Head codes injected server-side for SEO/performance (per spec)
- Public `/api/head-codes` requires NO auth (per spec)
- All admin operations use `requireAdmin()` (per spec)
- Used `<div dangerouslySetInnerHTML>` wrapper for raw HTML — browsers tolerate this in `<head>` for script execution (GA4, Meta Pixel work); for meta-tag-only codes (e.g., Search Console verification), admin UI helper text recommends "داخل head" placement
- DB schema version bumped to v4-headcode to invalidate any cached Prisma client
- Dev server had to be restarted once after Prisma client regeneration (webpack module cache held stale @prisma/client)

## Files changed

- `prisma/schema.prisma` — added HeadCode model
- `src/lib/db.ts` — bumped SCHEMA_VERSION + extended isStaleClient
- `src/app/api/admin/head-codes/route.ts` — NEW
- `src/app/api/admin/head-codes/[id]/route.ts` — NEW
- `src/app/api/head-codes/route.ts` — NEW
- `src/components/fitness/head-code-injector.tsx` — NEW (server component)
- `src/app/layout.tsx` — wired HeadCodeInjector at 3 placements
- `src/components/fitness/views/admin-overlay.tsx` — added head_codes tab, HeadCodesTab, HeadCodeEditorDialog, constants, helpers

Worklog appended at `/home/z/my-project/worklog.md` (Task ID: R5 section).
