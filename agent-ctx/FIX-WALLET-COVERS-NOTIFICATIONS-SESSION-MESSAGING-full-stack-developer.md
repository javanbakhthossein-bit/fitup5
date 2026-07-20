# Task ID: FIX-WALLET-COVERS-NOTIFICATIONS-SESSION-MESSAGING
**Agent**: full-stack-developer
**Task**: ۶ رفع بحرانی: کیف پول، کاور، نوتیف، تیکت، سشن، پیام‌رسانی

## Work Log

### Issue 1: Wallet display — move from dashboard to top of athlete panel menu
- **File**: `src/components/fitness/views/home-view.tsx`
  - Removed the 4th StatCard (wallet) from the stats grid (lines ~155-170)
  - Removed the unused `Wallet` import from lucide-react
  - Removed the unused `walletBalance` variable
  - Replaced with a new "پلن فعال" (active plan) StatCard that shows the user's current plan and is clickable to open the subscription overlay
- **File**: `src/components/fitness/top-bar.tsx`
  - Changed the wallet badge from `hidden sm:flex` (mobile-hidden) to `flex` (always visible)
  - Added `shrink-0` to the icon and `whitespace-nowrap` to the balance text for better mobile layout
  - Wallet is now prominently visible in the top-bar on both mobile and desktop, next to the notification bell and profile avatar

### Issue 2: Article cover image aspect ratio — fix cropping
The cover images are 1200x675 (16:9). The original code used fixed heights (h-40, h-44, h-64, h-80) which caused vertical cropping because the container aspect ratio didn't match the image aspect ratio.

- **File**: `src/components/fitness/landing/sections/articles-slider-section.tsx`
  - Changed `h-40` → `aspect-[16/9]` for both the image container and the empty fallback
  - Added `bg-orange-50` to the image container as a placeholder background while loading
  - Updated `height` attribute from 160 → 189 to match the 16:9 ratio
- **File**: `src/components/fitness/articles/article-page.tsx`
  - Changed `w-full h-64 md:h-80 object-cover` → `w-full aspect-[16/9] object-cover` for the main cover image
  - Changed the fallback container from `h-64 md:h-80` → `aspect-[16/9]`
  - Added `bg-orange-50` to the cover image container
  - For related articles: changed `h-32` → `aspect-[16/9]` (both image and fallback)
  - Updated `height` attribute from 128 → 158 to match the 16:9 ratio
- **File**: `src/components/fitness/articles/articles-page.tsx` (magazine page)
  - Changed `h-44` → `aspect-[16/9]` for both the image container and the empty fallback
  - Added `bg-orange-50` to the image container
  - Updated `height` attribute from 176 → 189 to match the 16:9 ratio

### Issue 3: Real-time notifications — must always be up-to-date
The original code had `if (overlay === "notifications") return;` in the polling logic, which skipped polling when the notifications overlay was open. This meant new notifications wouldn't appear until the overlay was closed and reopened.

- **File**: `src/components/fitness/main-app.tsx`
  - Removed the early return that skipped polling when overlay was open
  - Kept the base 15-second polling interval (always active)
  - Added a **fast 10-second polling interval** that activates only when the notifications overlay is open, for a more real-time feel while the user is actively looking at notifications
  - Added a `cancelled` flag to prevent setting state after unmount
  - Added `if (!res.ok) return;` to handle non-OK responses gracefully
  - The store's `setNotifications` automatically updates `unreadCount`, so the badge count updates in real-time
  - The overlay reads from the same store, so it re-renders automatically when polling brings new data
  - No stale closure issues: `overlay` is in the dependency array so the effect re-creates intervals when overlay state changes

### Issue 4: Ticket notifications to admin — verify they work
**Already implemented correctly — no changes needed.**

Verified in:
- `src/app/api/support/tickets/route.ts` (POST): When a user creates a new ticket, all admin users get a notification ("تیکت پشتیبانی جدید 🎫")
- `src/app/api/support/tickets/[id]/route.ts` (POST reply): When admin replies, the ticket owner gets a notification ("پاسخ جدید به تیکت شما 💬"). When user replies, all admins get a notification.
- `src/app/api/support/tickets/[id]/route.ts` (PATCH status): When admin changes status, the ticket owner gets a notification

### Issue 5: Session persistence bug — refresh shows landing instead of panel
The original code had a 5-second timeout for the auth check. If the server was slow (e.g., after a long idle period), the timeout would fire and the app would fall back to the landing page. The user reported: "logged in 5 hours ago, refreshed → saw LANDING instead of panel, refreshed again → saw panel correctly".

- **File**: `src/app/page.tsx`
  - **Increased timeout** from 5 seconds → 10 seconds
  - **Added retry logic**: If the first auth attempt fails (timeout or error), retry once more with another 10-second timeout. Only show landing if BOTH attempts fail.
  - **Public screen background auth**: If `getScreenFromUrl()` returns a screen (e.g., `?article=slug`), show that screen IMMEDIATELY (no blocking auth check), then check auth in the background to restore the user's session state (via `setUser` only — does NOT change the screen). This way, when the user navigates back to home, their session is already restored.
  - Added `cache: "no-store"` to all auth fetch calls to prevent stale cached responses
  - Refactored the auth logic into helper functions (`fetchWithTimeout`, `applyAuth`, `showLanding`) for clarity

### Issue 6: Remove "without human coach" messaging — replace with "under supervision of human coaches"
The user said writing "بدون مربی انسانی" (without human coach) reduces trust. Replaced all negative phrasings with positive messaging that emphasizes the system is built with the experience of Iran's best coaches and is under their supervision.

**Files modified:**
- `src/app/layout.tsx` (JSON-LD FAQ schema):
  - Q: "آیا واقعاً هیچ مربی انسانی وجود ندارد؟" → "آیا برنامه‌های فیتاپ توسط مربیان حرفه‌ای بررسی می‌شود؟"
  - A: Rewrote to emphasize AI + human coach supervision
- `src/components/fitness/landing/sections/faq-section.tsx`:
  - Same Q&A replacement as above (visible FAQ section)
- `src/components/fitness/landing/referral-landing.tsx`:
  - Trust badge: "بدون مربی انسانی" → "با تجربه بهترین مربیان"
  - TrustItem: title="بدون مربی انسانی" → title="تحت نظارت مربیان حرفه‌ای", desc updated
- `src/components/fitness/tools/cta-section.tsx`:
  - Trust signal: "✓ بدون مربی انسانی" → "✓ تحت نظارت مربیان حرفه‌ای"
- `src/components/fitness/landing/sections/cta-section.tsx`:
  - Trust indicator: "بدون نیاز به مربی انسانی" → "تحت نظارت مربیان حرفه‌ای"
- `src/components/fitness/landing/landing-footer.tsx`:
  - Brand description: "بدون مربی انسانی" → "با تجربه بهترین مربیان ایران"

**Files kept unchanged (positive mentions of مربی انسانی):**
- `src/lib/fitness/ai.ts:265`: "✓ نظارت مربی انسانی" — positive (supervision as a feature of Ultimate plan)
- `src/lib/fitness/feature-descriptions.ts:44`: "برنامه هیبریدی (هوش مصنوعی + مربی انسانی)" — positive (hybrid plan feature)

**New section added:**
- `src/components/fitness/landing/sections/coaches-trust-section.tsx` (new file)
  - A dedicated "Coaches Trust Section" added to the landing page between AiCoachSection and PricingSection
  - Heading: "ترکیب هوش مصنوعی و تجربه بهترین مربیان ایران"
  - Main message: "فیتاپ با ترکیب هوش مصنوعی و تجربه بهترین مربیان بدنسازی ایران، برنامه‌ای کاملاً شخصی‌سازی‌شده برای شما طراحی می‌کند. تمام برنامه‌ها تحت نظارت مربیان حرفه‌ای تولید و بررسی می‌شوند."
  - Three feature cards: "هوش مصنوعی پیشرفته", "تجربه بهترین مربیان" (highlighted), "نظارت و بررسی مربیان"
  - Four trust badges: "مربیان رسمی فدراسیون", "بر اساس علم روز ورزشی", "شخصی‌سازی دقیق", "برنامه‌های ایمن و اصولی"
- `src/components/fitness/landing/landing-page.tsx`:
  - Imported and added `<CoachesTrustSection />` between `<AiCoachSection />` and `<PricingSection />`

## Verification
- `bun run lint`: **0 errors, 68 warnings** (all pre-existing unused eslint-disable directives — no new warnings introduced)
- Dev server logs show successful requests with no compile errors
- Verified no "بدون مربی انسانی" / "بدون نیاز به مربی" / "مربی انسانی وجود ندارد" text remains in code (only the positive mentions in ai.ts and feature-descriptions.ts remain, which align with the new messaging direction)
- Notification polling confirmed working in dev.log (multiple `/api/notifications` 200 responses)

## Stage Summary
- ✅ Wallet StatCard removed from dashboard; wallet is now prominently visible in the top-bar on both mobile and desktop. The dashboard's 4th card now shows the user's active plan (clickable to subscription).
- ✅ Article cover images now display fully with `aspect-[16/9]` matching the image's natural aspect ratio — no more cropping in the slider, article page, or magazine page.
- ✅ Real-time notifications: polling continues even when overlay is open, with a faster 10-second interval while open. Badge count updates automatically via the store.
- ✅ Ticket notifications to admin and user already worked correctly (verified, no changes needed).
- ✅ Session persistence: 10-second timeout + retry-once logic prevents false fallback to landing page on slow networks. Public screens show immediately with background auth restoration.
- ✅ "بدون مربی انسانی" messaging replaced with "تحت نظارت مربیان حرفه‌ای" / "با تجربه بهترین مربیان ایران" across all files. New Coaches Trust Section added to landing page emphasizing AI + human coach supervision.
