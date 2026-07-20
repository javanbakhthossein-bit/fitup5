# Task: FIX-FLICKER-CARDS-SCROLL-BLOODTEST

## Agent: full-stack-developer

## Summary
رفل ۴ مسئله در پروژه فیتاپ: فلیکر انیمیشن کارت‌ها، استایل یکسان کارت‌های coaches-trust، اسکرول موبایل در articles-slider، و سیستم آزمایش خون.

## Files Modified

### Issue 1: Card Flicker Fix (13 files in `src/components/fitness/landing/sections/`)
- `how-it-works-section.tsx`
- `cta-section.tsx`
- `app-install-section.tsx`
- `features-section.tsx`
- `ai-coach-section.tsx`
- `pricing-section.tsx`
- `trust-bar.tsx`
- `visual-breaks.tsx`
- `testimonials-section.tsx`
- `coaches-trust-section.tsx`
- `tools-section.tsx`
- `faq-section.tsx`
- `articles-slider-section.tsx`
- `hero-section.tsx`

**Changes:**
- All `viewport={{ once: true, margin: "-50px" }}` → `viewport={{ once: true, margin: "-100px" }}`
- All `viewport={{ once: true }}` (no margin) → `viewport={{ once: true, margin: "-100px" }}`
- Added `transition={{ duration: 0.4 }}` to motion.divs without transitions
- Added `duration: 0.4` to transitions that only had `delay`

### Issue 2: Coaches Trust Cards
- `coaches-trust-section.tsx` — removed `highlight` prop entirely. All 3 cards now have same style: `bg-white border-orange-200 shadow-sm` with `goldGradient` icon background.

### Issue 3: Articles Slider Mobile Scroll
- `articles-slider-section.tsx` — added `touchAction: "pan-x"` and `overscrollBehavior: "none"` to slider container inline style.

### Issue 4: Blood Test System

**Modified:**
- `src/components/fitness/views/blood-test-view.tsx`:
  - Added "Download referral form" card BEFORE status buttons
  - Two buttons: "پرینت / PDF" (opens /api/blood-test/form) and "دانلود عکس" (PNG)
  - Updated status button text: "آزمایش دادم و منتظر جوابم" + "آپلود نمی‌کنم"
  - Changed status value from "waiting" to "pending_blood_test"
- `src/app/api/blood-test-status/route.ts`:
  - Accepts "pending_blood_test" as valid status (alias for "waiting")
- `src/app/api/payment/verify/route.ts`:
  - Added separate blood test notification for Ultimate plan users

**Created:**
- `src/app/api/blood-test/form/route.ts`:
  - GET endpoint returning printable HTML form
  - Includes: FitUp logo, user name + mobile, date, full test list (6 categories), print button
  - 25KB HTML with inline CSS, print-friendly

## Verification
- `bun run lint`: 0 errors, 69 warnings (all pre-existing unused eslint-disable directives)
- Landing page: 200 OK
- `/api/blood-test/form`: 200 OK, 25KB HTML
- All viewport margins updated to -100px
- `highlight` prop completely removed from coaches-trust-section
- `touchAction: pan-x` added to articles-slider

## Notes for Next Agents
- The dev server (Next.js 16 dev mode) is unstable in this sandbox due to OOM (4GB RAM limit). The keep-server-alive.sh script restarts it automatically every ~20s.
- The blood test form endpoint requires auth — without auth, it returns the form with empty user fields.
- The `bloodTestStatus` field on User model stores: null | "waiting" | "pending_blood_test" | "declined"
- The AI prompt logic does NOT currently use `bloodTestStatus` — it's stored but not read. Future work could integrate it into the program generation flow to actually pause generation when status is "pending_blood_test".
