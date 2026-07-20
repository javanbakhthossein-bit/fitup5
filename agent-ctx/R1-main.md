# Task R1 — Luxury WHITE + GOLD redesign of auth/onboarding/generating screens + brand-name fix

## Scope
- Brand fix: PLATFORM = "فیتاپ", AI COACH = "فیتاپ هوشمند" (only in chat/program-gen/coach notes)
- Auth screen → white + gold luxury redesign
- Onboarding screen (5 steps + GeneratingScreen) → white + gold premium redesign
- 0 lint errors required

## Files modified (16 files)

### Brand fix (platform name → فیتاپ)
1. `src/components/fitness/landing/landing-nav.tsx` — header brand text
2. `src/components/fitness/top-bar.tsx` — mobile brand text
3. `src/components/fitness/sidebar.tsx` — desktop sidebar brand text
4. `src/components/fitness/landing/landing-footer.tsx` — footer brand + © copyright
5. `src/app/layout.tsx` — metadata (title default/template, description, OG, Twitter, siteName) + themeColor → #f59e0b
6. `src/components/fitness/landing/sections/hero-section.tsx` — hero h1 + img alt
7. `src/components/fitness/landing/sections/cta-section.tsx` — CTA paragraph
8. `src/components/fitness/landing/sections/testimonials-section.tsx` — section subtitle
9. `src/components/fitness/landing/sections/faq-section.tsx` — FAQ answer + section subtitle
10. `src/components/fitness/views/profile-overlay.tsx` — version label at bottom
11. `src/lib/fitness/ai.ts` — DEFAULT_NIKA_PROMPT + admin copilot prompt (referred to "platform")
12. `src/lib/fitness/seed.ts` — siteSettings brandName + heroTitle; upsert `update: {value, label}` (was empty)
13. `src/app/api/settings/route.ts` — public GET fallback defaults
14. `src/app/api/auth/register/route.ts` — welcome notification body ("به فیتاپ خوش آمدی")

### Intentionally KEPT as "فیتاپ هوشمند" (AI coach references)
- `src/lib/fitness/feature-descriptions.ts` — "چت فیتاپ هوشمند" feature
- `src/lib/fitness/types.ts` — same feature label
- `src/lib/fitness/seed.ts` — AI coach system prompts (coach/chat/nutrition) — describe AI coach identity
- `src/components/fitness/views/nutrition-overlay.tsx` — "یادداشت فیتاپ هوشمند" (AI coach note)
- `src/components/fitness/views/exercise-detail-overlay.tsx` — "نکته فیتاپ هوشمند" (AI coach tip)
- `src/components/fitness/landing/sections/ai-coach-section.tsx` — entire section about the AI coach
- `src/components/fitness/onboarding-screen.tsx` GeneratingScreen title — "فیتاپ هوشمند در حال ساخت برنامه شماست..." (program generation context, per task spec)

### Screen redesigns (full rewrites)
15. `src/components/fitness/auth-screen.tsx` — white + gold luxury
16. `src/components/fitness/onboarding-screen.tsx` — white + gold premium (incl. GeneratingScreen)

## Key style decisions
- All gold-gradient buttons: inline `style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}` (Tailwind v4 has no arbitrary gradient utility by default; inline style ensures exact color match)
- All inputs: `bg-white border-2 border-orange-100 focus-visible:border-orange-400 focus-visible:ring-orange-300/40 text-slate-900 placeholder:text-slate-400`
- All selection cards: `bg-white border-2 border-orange-200` → selected: `border-orange-500 bg-orange-50 shadow-md shadow-orange-500/10`
- Ambient gold accents: blurred `bg-amber-200/40` / `bg-orange-200/30` / `bg-amber-100/40` blobs positioned absolutely behind content
- Text hierarchy: slate-900 (headings/primary), slate-700 (labels), slate-500 (secondary), slate-400 (placeholders)

## Verification
- `bun run lint` → 0 errors, 16 pre-existing warnings (unused eslint-disable directives in unrelated files, existed before this task)
- Dev log: clean compilation, all 200 responses, no runtime errors
- Re-seeded DB; verified `curl /api/settings` returns `brandName:"فیتاپ"` and `heroTitle:"بدن ایده‌آلت را با فیتاپ بساز"`
- Auth screen: white bg + gold gradient logo + gold-bordered card + gold gradient submit + T&C checkbox preserved
- Onboarding: 5 steps preserved with same validation, all selection cards now white with gold selection state, gold gradient progress bar + buttons
- GeneratingScreen: WHITE bg (removed dark animated-gradient-bg), gold gradient rotating logo, white cards for loading steps, "فیتاپ هوشمند در حال ساخت برنامه شماست..." title

## What other agents can build on
- Brand-name discipline is now consistent across the platform: any future platform-facing copy should use "فیتاپ"; any AI-coach-specific copy (chat bubbles, plan generation messages, coach tips) should use "فیتاپ هوشمند"
- GOLD_GRADIENT inline-style pattern (defined as const in onboarding-screen.tsx) can be lifted to a shared constant if more screens need gold buttons
- `goldInputCls` reusable class string in onboarding-screen.tsx can be extracted to a shared module if other forms need the same white+gold input styling
- SiteSetting upsert pattern in seed.ts now updates existing rows (was no-op), so re-running seed.ts after editing siteSettings values will actually apply changes
