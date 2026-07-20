# Task ID: REFERRAL-LANDING-WALLET-DASHBOARD

**Agent:** full-stack-developer
**Task:** Build a beautiful referral landing page + add wallet to dashboard

## Summary of work

### Part 1: Public Referral Info API
- Created `src/app/api/referral/info/route.ts` — public (no auth) endpoint
- Accepts `?code=FIT-XXXXXX`, returns:
  - `{ valid: true, referrerName: "م***", rewardAmount: 150000 }` when code exists
  - `{ valid: false }` when missing/invalid
- referrerName is masked (first letter + `***`), falling back to masked mobile
- Reward amount is fetched from `SiteSetting.referral_reward_amount` via `getReferralRewardAmount()` (defaults to 150,000)
- Code is auto-uppercased before lookup (case-insensitive UX)

### Part 2: Referral Landing Page
- Created `src/components/fitness/landing/referral-landing.tsx`
- Full-screen hero with orange gradient background (`#fff7ed → #ffedd5 → #fed7aa`)
- FitUp logo at top, headline "دوستت تو فیتاپ منتظرته! 🎁"
- Subheadline dynamically includes the masked referrer name + reward amount + ref code badge
- 4 benefit cards (AI workout plan, smart nutrition, 24/7 AI chat, reward bonus)
- 3-step "How it works" with numbered cards and dashed connector line
- Trust signals section (بدون مربی انسانی / شخصی‌سازی با AI / پشتیبانی ۲۴ ساعته)
- Social proof (5-star rating, "thousands trust us")
- Big CTA section with orange gradient
- Framer-motion animations throughout (initial/animate + whileInView)
- Fully RTL, mobile-responsive (grid stacks on mobile)
- Skeleton loading state while fetching API
- Graceful fallback when code is invalid (still shows landing with default text)

### Part 3: Routing Logic (page.tsx)
- Added `"referral-landing"` to `AppScreen` type in `store.ts`
- Added `refCode` state init from URL on mount (uppercase-trimmed)
- Modified auth check: if user is NOT logged in AND refCode present → `setScreen("referral-landing")`
- If user IS logged in → normal flow (ignores ref, so logged-in users see normal landing/main)
- The ref code is still saved to localStorage by the existing useEffect (unchanged)
- Added "referral-landing" to the popstate handler's standalone-exit guard list

### Part 4: Wallet in Dashboard (home-view.tsx)
- Added a 4th StatCard in the 2x2 stats grid showing wallet balance
- Uses `Wallet` icon from lucide-react
- Label "کیف پول", value `toPersianDigits((user?.walletBalance ?? 0).toLocaleString("en-US"))` + " تومان"
- Clickable → opens profile overlay (where wallet details live)
- Added `green` color variant to COLOR_MAP for positive balance emphasis
- When balance > 0 → green accent (emerald); when = 0 → normal cyan
- Extended StatCard component with optional `clickable` prop (hover border + shadow + cursor-pointer)

### Part 5: Wallet Badge in Top Bar (top-bar.tsx)
- Added a compact wallet badge button (sm+ screens) showing wallet balance with Wallet icon
- Clickable → opens profile overlay
- Color-coded: emerald background when balance > 0, neutral slate when balance = 0
- Uses `font-stat` for Persian digit display
- Full aria-label with current balance

### Part 6: Wallet Transactions in Profile Overlay
- Added `WalletTxnDto` interface and `walletTxns`/`walletTxnsLoading` state
- Added `/api/wallet` fetch to existing `Promise.all` in useEffect (no extra round-trip)
- Added transactions list section under the existing "شارژ کیف پول" button:
  - Shows up to 20 recent transactions in a scrollable area (max-h-64, custom-scrollbar)
  - Each item: icon (TrendingUp/TrendingDown), description, Jalali date+time, amount with +/-
  - Green for incoming (deposit/bonus/refund), red for outgoing (purchase)
  - Empty state when no transactions
  - Loading skeleton while fetching
- Helper functions `txnTypeLabel()` and `formatJalaliDateTime()` (Jalali date + time)
- After successful wallet charge via modal, the new transaction is prepended to the list (instant feedback)

## Files created
- `src/app/api/referral/info/route.ts`
- `src/components/fitness/landing/referral-landing.tsx`

## Files modified
- `src/lib/fitness/store.ts` — added `"referral-landing"` to AppScreen
- `src/app/page.tsx` — ref code detection + referral-landing routing + popstate handling
- `src/components/fitness/views/home-view.tsx` — 4th StatCard (wallet) + `green` color + `clickable` prop
- `src/components/fitness/top-bar.tsx` — wallet badge button
- `src/components/fitness/views/profile-overlay.tsx` — wallet transactions list + imports + helpers + txn prepend after charge

## Verification
- `bun run lint`: 0 errors (only pre-existing warnings about unused eslint-disable directives in other files)
- `curl -s http://localhost:3000/api/referral/info?code=FIT-TEST` → `{"valid":false}` ✓
- `curl -s http://localhost:3000/api/referral/info?code=FIT-TESTAPI` (with real test user) → `{"valid":true,"referrerName":"م***","rewardAmount":150000}` ✓
- `curl -s http://localhost:3000/api/referral/info?code=fit-testapi` (lowercase) → `{"valid":true,...}` ✓ (auto-uppercase works)
- `curl -s http://localhost:3000/api/referral/info` (no code) → `{"valid":false}` ✓
- `GET /?ref=FIT-TEST` → HTTP 200 ✓ (referral landing renders successfully)
- dev.log shows no errors related to new code paths

## Notes for future agents
- The reward amount comes from `SiteSetting.referral_reward_amount` (key settable from admin panel). Default is 150,000 toman.
- The referral-landing page handles the invalid-code case gracefully — it still shows a generic landing with default text and the ref code badge, so users can still sign up even if the code is stale.
- Wallet balance is now visible in 3 places: home-view StatCard, top-bar badge, profile overlay.
- Wallet transactions are fetched in parallel with other profile data (no extra round-trip).
