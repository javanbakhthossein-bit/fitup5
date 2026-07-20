# Task: BODY-COMPOSITION-PRO
Agent: Main (Z.ai Code)

## Summary
پیاده‌سازی سیستم حرفه‌ای ردیابی ترکیب بدن (Body Composition) برای فیتاپ هوشمند:
- اضافه شدن اندازه‌های دور گردن، دور شانه، دور ساق پا
- فرمول علمی US Navy برای محاسبه دقیق درصد چربی بدن
- فرم بازخوانی اندازه‌های بدنی پس از خرید (اختیاری)
- نمودار پیشرفت بدنی روی داشبورد
- کارت‌های ترکیب بدن روی صفحه تحلیل

## Work Log

### Task 1: Prisma Schema
- فایل: `prisma/schema.prisma`
- به `OnboardingProfile` اضافه شد: `neckMeasurement`, `shoulderMeasurement`, `calfMeasurement` (همگی `Float?`)
- به `Checkup` اضافه شد: `neckMeasurement` (`Float?`)
- `bun run db:push` اجرا شد (موفق، 42ms)
- فایل `src/lib/db.ts`: SCHEMA_VERSION به `v15-body-comp` ارتقا یافت

### Task 2: OnboardingData Type
- فایل: `src/lib/fitness/types.ts`
- به اینترفیس `OnboardingData` اضافه شد: `neckMeasurement?`, `shoulderMeasurement?`, `calfMeasurement?`

### Task 3: Body Composition Utility
- فایل جدید: `src/lib/fitness/body-composition.ts`
- پیاده‌سازی فرمول US Navy برای آقایان و خانم‌ها
- تابع اصلی `calculateBodyComposition` که `BodyComposition | null` برمی‌گرداند
- تابع `calculateMuscleMassPercent` برای تخمین درصد عضله از LBM
- تابع `categorizeBodyFat` با ۵ دسته فارسی (ضروری/ورزشی/آمادگی/قابل‌قبول/چاق) و رنگ hex متناسب
- تابع helper `calculateBodyCompositionFromProfile` برای استفاده از profile object

### Task 4: Onboarding UI
- فایل: `src/components/fitness/onboarding-screen.tsx`
- در کامپوننت `OptionalBodyMeasurements` اضافه شد:
  - ۸ فیلد به‌جای ۵: دور کمر (*)، دور گردن (*)، دور سینه، دور بازو، دور باسن، دور ران، دور شانه، دور ساق پا
  - چیدمان grid ۲ ستونی به‌جای ۱ ستونی
  - نشانگر `*` برای فیلدهای الزامی (کمر و گردن)
  - یک note باکس امبر رنگی: «برای محاسبه دقیق درصد چربی بدن، دور کمر و دور گردن الزامی است»

### Task 5: Onboarding API
- فایل: `src/app/api/onboarding/route.ts`
- ۳ فیلد جدید به OnboardingProfile.create و update اضافه شد
- `neckMeasurement` به Checkup phase 0 (baseline) هم اضافه شد (در create و update)
- شروط `hasNewMeasurements` آپدیت شد تا `neckMeasurement` را هم چک کند

### Task 6: Smart Report (Analysis API)
- فایل: `src/app/api/onboarding/analysis/route.ts`
- Import از `body-composition.ts`
- محاسبه `bodyComposition` و `muscleMass` با استفاده از چکاپ baseline (waist + hip) و OnboardingProfile (neck)
- پرامپت AI به‌روزرسانی شد تا درصد چربی، جرم خالص، جرم چربی و درصد عضله را شامل شود
- پاسخ JSON فیلد جدید `bodyComposition` با ۷ زیرفیلد دریافت می‌کند
- فیلد `neck` به `measurements` اضافه شد

### Task 7: Post-Purchase Measurement Prompt
- فایل: `src/app/api/payment/verify/route.ts`
- برای پلن‌های Advanced/Ultimate (needsBodyPhoto): اگر کاربر `waistMeasurement` + `neckMeasurement` در چکاپ baseline ندارد، یک نوتیفیکیشن جداگانه برای تشویق به وارد کردن اندازه‌ها ارسال می‌شود
- فایل: `src/components/fitness/views/body-analysis-banner.tsx`
- کاملاً بازنویسی شد تا ۳ مرحله داشته باشد:
  1. **prompt**: نمایش پیام «برای برنامه دقیق‌تر، اندازه‌های بدنی خود را وارد کنید» با ۲ دکمه «وارد می‌کنم» و «رد کردن»
  2. **form**: فرم با ۸ فیلد (waist*, neck*, hip, chest, arm, thigh, shoulder, calf) با دکمه «ذخیره و ادامه»
  3. **done**: آپلود عکس بدن (و ویدیو برای Ultimate) — همان فرم قبلی
- دکمه «ویرایش اندازه‌های بدنی» در مرحله آپلود برای بازگشت به فرم
- endpoint جدید: `POST /api/checkup/baseline-measurements` برای ذخیره اندازه‌ها در چکاپ phase 0 + محاسبه body composition

### Task 8: Checkup Body Composition
- فایل: `src/app/api/checkup/route.ts`
- تابع `computeBodyFat` بازنویسی شد:
  - Primary: `calculateBodyComposition` از `body-composition.ts` (فرمول US Navy واقعی)
  - Fallback: فرمول BMI-based Deurenberg (اگر neck نباشد)
  - خروجی: `{ bodyFatPercent, leanBodyMass }` به‌جای عدد ساده
- `CheckupBody` اینترفیس: `neckMeasurement` اضافه شد
- GET response: `neckMeasurement` اضافه شد
- POST: ذخیره `neckMeasurement` و محاسبه `bodyFatPercent` + `leanBodyMass` از طریق تابع جدید
- فایل: `src/components/fitness/views/checkup-section.tsx`
- `CheckupDto` اینترفیس: `neckMeasurement` اضافه شد
- MiniStat ها در history: گردن، باسن، ران هم اضافه شدند
- فرم چکاپ: فیلد «دور گردن *» با علامت الزامی اضافه شد
- توضیح: «برای محاسبه دقیق‌تر درصد چربی بدن با فرمول علمی US Navy، دور کمر و گردن (برای خانم‌ها دور باسن هم) را وارد کنید»

### Task 9: Dashboard Progress Chart + Progress API
- فایل: `src/app/api/progress/route.ts`
- GET اکنون `checkups` را هم query می‌کند
- فیلدهای جدید در response:
  - `bodyCompositionHistory`: آرایه‌ای از { date, weight, bodyFatPercent, leanBodyMass }
  - `latestBodyComposition`: آخرین مورد از history
- فایل: `src/components/fitness/views/dashboard-view.tsx`
- Import recharts (LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer)
- کامپوننت جدید `BodyProgressCard` اضافه شد:
  - اگر داده‌ای نبود: CTA «اندازه‌های بدنی خود را وارد کنید» → progress tab
  - اگر داده بود: ۳ کارت آماری (درصد چربی با BodyFatRing، جرم خالص، وزن با تغییر)
  - نمودار خطی recharts با ۲ خط (چربی نارنجی، جرم خالص سبز) و تاریخ شمسی روی X-axis
  - footer note: «محاسبه بر اساس فرمول علمی US Navy»
- کامپوننت `BodyFatRing`: SVG circular progress با رنگ متغیر بر اساس درصد چربی (cyan/emerald/amber/red)
- کامپوننت در انتهای DashboardView اضافه شد

### Task 10: Analysis Screen Body Composition Cards
- فایل: `src/components/fitness/analysis-screen.tsx`
- اینترفیس `BodyCompositionData` و `neck?` در `Measurements` اضافه شد
- کارت جدید «ترکیب بدن شما» با ۳ آمار اصلی:
  - درصد چربی بدن (با رنگ دسته‌بندی + برچسب فارسی دسته)
  - جرم بدون چربی (کیلوگرم)
  - جرم چربی (کیلوگرم)
- بخش «درصد عضله تقریبی» (اگر موجود باشد)
- note باکس علمی: «محاسبه بر اساس فرمول علمی US Navy (Hodgdon & Beckett, 1984)»
- کارت اندازه‌های بدن: «دور گردن» هم اضافه شد

### Baseline Measurements API (New)
- فایل جدید: `src/app/api/checkup/baseline-measurements/route.ts`
- POST endpoint برای ذخیره اندازه‌های بدنی وارد‌شده پس از خرید
- shoulder/calf در OnboardingProfile ذخیره می‌شوند
- سایر اندازه‌ها در چکاپ phase 0 (baseline) آپدیت یا create می‌شوند
- bodyFatPercent و leanBodyMass با `calculateBodyComposition` محاسبه و ذخیره می‌شوند

## Verification
- ✅ `bun run db:push`: موفق (42ms)
- ✅ `bun run lint`: 0 errors, 53 warnings (همگی pre-existing unused eslint-disable directives)
- ✅ `npx tsc --noEmit`: هیچ خطای جدیدی از فایل‌های تغییر یافته نداریم (تنها خطاهای pre-existing در فایل‌های دیگر باقی مانده)
- ✅ dev.log: سرور در حال اجرا، schema version v15-body-comp اعمال شده، 0 error
- ✅ همه فیلدهای جدید optional هستند و به هیچ وجه flow موجود را نمی‌شکنند

## Files Modified
1. `prisma/schema.prisma` — اضافه شدن ۳ فیلد به OnboardingProfile + ۱ فیلد به Checkup
2. `src/lib/db.ts` — bump SCHEMA_VERSION به v15-body-comp
3. `src/lib/fitness/types.ts` — اضافه شدن ۳ فیلد به OnboardingData
4. `src/lib/fitness/body-composition.ts` (جدید) — utility کامل فرمول US Navy
5. `src/components/fitness/onboarding-screen.tsx` — فرم اندازه‌های بدنی توسعه یافت
6. `src/app/api/onboarding/route.ts` — ذخیره فیلدهای جدید
7. `src/app/api/onboarding/analysis/route.ts` — محاسبه body composition + AI prompt
8. `src/app/api/payment/verify/route.ts` — نوتیفیکیشن تشویقی
9. `src/components/fitness/views/body-analysis-banner.tsx` — ۳ مرحله: prompt → form → upload
10. `src/app/api/checkup/baseline-measurements/route.ts` (جدید) — endpoint ذخیره اندازه‌ها
11. `src/app/api/checkup/route.ts` — استفاده از calculateBodyComposition
12. `src/components/fitness/views/checkup-section.tsx` — نمایش + فرم دور گردن
13. `src/app/api/progress/route.ts` — bodyCompositionHistory + latestBodyComposition
14. `src/components/fitness/views/dashboard-view.tsx` — BodyProgressCard با recharts
15. `src/components/fitness/analysis-screen.tsx` — کارت ترکیب بدن

## Key Design Decisions
1. **Neck/Shoulder/Calf در OnboardingProfile**: shoulder و calf فقط در OnboardingProfile هستند چون برای body fat محاسبه استفاده نمی‌شوند (فقط اطلاعاتی برای track پیشرفت). neck هم در OnboardingProfile و هم در Checkup ذخیره می‌شود چون برای US Navy formula لازم است.
2. **baseline Checkup به عنوان source of truth**: اندازه‌های اصلی (chest/arm/waist/hip/thigh/neck) از چکاپ phase 0 خوانده می‌شوند، نه از OnboardingProfile. این design قبلی حفظ شد.
3. **fallback Deurenberg**: اگر neck measurement نباشد، فرمول BMI-based Deurenberg به‌عنوان fallback استفاده می‌شود (بدون شکستن کد موجود).
4. **post-purchase optional**: مرحله اندازه‌ها در body-analysis-banner کاملاً optional است. کاربر می‌تواند «رد کردن» بزند و مستقیم به آپلود عکس برود.
5. **BodyFatRing visual**: درصد چربی ۳-۳۸٪ به فرکانس بصری ۵-۱۰۰٪ تبدیل می‌شود تا نمودار دایره‌ای معنادار باشد.
6. **رنگ‌بندی دسته‌بندی**: ۵ رنگ (cyan → emerald → lime → amber → red) که با افزایش چربی به سمت قرمز می‌رود — سازگار با orange theme.
