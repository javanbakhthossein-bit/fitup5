# Task: SEO-DYNAMIC-PAGES-EXERCISES-FOODS — full-stack-developer

## Summary

صفحات SEO اختصاصی برای هر حرکت ورزشی و غذا ایجاد شد. وقتی کسی "آموزش پرس سینه با دمبل" یا "کالری سیب" را جستجو کند، صفحه اختصاصی فیتاپ با عنوان و توضیحات دقیق ظاهر می‌شود.

## Files Created

1. **`src/app/api/exercises/[id]/route.ts`** — GET عمومی برای واکشی یک حرکت با ID + related (۴ حرکت هم‌گروه عضلانی). 404 با NextResponse.json.
2. **`src/app/api/foods/[id]/route.ts`** — GET عمومی برای واکشی یک غذا با ID + related (۴ غذا هم‌دسته‌بندی). 404 با NextResponse.json.
3. **`src/components/fitness/tools/exercise-detail-page.tsx`** (۶۰۰+ خط) — صفحه اختصاصی حرکت با:
   - تشخیص ID از URL (`?exercise=ID`) هنگام mount برای deep-link/refresh
   - YouTube embed + آموزش + نکات ایمنی + حرکات مرتبط + FAQ
   - SEO: title, meta description, og:*, twitter:*, JSON-LD (VideoObject + HowTo + FAQPage)
4. **`src/components/fitness/tools/food-detail-page.tsx`** (۵۶۰+ خط) — صفحه اختصاصی غذا با:
   - تشخیص ID از URL (`?food=ID`) هنگام mount
   - Hero کالری + ۳ Card ماکرو + macro bar + غذاهای مرتبط + FAQ
   - SEO: title, meta description, og:*, twitter:*, JSON-LD (NutritionInformation + Food + FAQPage)

## Files Modified

1. **`src/lib/fitness/navigation.ts`** — افزودن `"exercise-detail"` و `"food-detail"` به NavScreen، پاکسازی پارامترهای `exercise` و `food` در cleanNavParams، هندلینگ در buildScreenUrl/pushScreen/replaceScreen/getScreenFromUrl.
2. **`src/lib/fitness/store.ts`** — افزودن `"exercise-detail"` و `"food-detail"` به AppScreen، افزودن state جدید: `exerciseId`/`setExerciseId` و `foodId`/`setFoodId` (با مقدار اولیه null و reset در reset()).
3. **`src/app/page.tsx`** — import کامپوننت‌های جدید، تشخیص پارامترهای `?exercise=` و `?food=` در getScreenFromUrl block، هندلینگ popstate برای back/forward، back handler از جزئیات به لیست، render کامپوننت‌ها.
4. **`src/app/sitemap.ts`** — افزودن query از ExerciseLibrary (250 آیتم) و FoodLibrary (500 آیتم) با URL های `?exercise=ID` (priority=0.7) و `?food=ID` (priority=0.6)، changeFrequency="monthly".
5. **`src/components/fitness/tools/exercises-database.tsx`** — حذف ExerciseDetailModal کامل و state مرتبط، پاکسازی import های بلااستفاده، افزودن openExerciseDetail(id) که setExerciseId + setScreen + pushScreen می‌کند، onClick کارت‌ها از setSelected(ex) به openExerciseDetail(ex.id) تغییر کرد.
6. **`src/components/fitness/tools/food-calorie-index.tsx`** — حذف FoodDetailModal کامل و state مرتبط (selected/weight)، پاکسازی import های بلااستفاده (Card, Flame, Beef, Wheat, Droplet, AnimatePresence)، افزودن openFoodDetail(id)، onClick آیتم‌ها به openFoodDetail(food.id) تغییر کرد.

## Tests Passed

- `bun run lint`: 0 errors ✓ (65 warning موجود، هیچ warning جدید برای فایل‌های ویرایش‌شده)
- `curl -s http://localhost:3000/?exercise=seed_ex_1` → 200 ✓
- `curl -s http://localhost:3000/?food=seed_food_1` → 200 ✓
- `curl -s http://localhost:3000/api/exercises/seed_ex_1` → 200 با داده کامل + related ✓
- `curl -s http://localhost:3000/api/foods/seed_food_1` → 200 با داده کامل + related ✓
- `curl -s http://localhost:3000/api/exercises/nonexistent` → 404 ✓
- `curl -s http://localhost:3000/api/foods/nonexistent` → 404 ✓
- `curl -s http://localhost:3000/sitemap.xml | grep "exercise=" | wc -l` → 250 ✓
- `curl -s http://localhost:3000/sitemap.xml | grep "?food=" | wc -l` → 500 ✓

## Architecture Notes

-SPA با Zustand store و routing مبتنی بر query string. URL pattern: `?exercise=ID` و `?food=ID`.
-SEO meta tags در client-side set می‌شوند (document.title، meta name/property، JSON-LD script tags) پس از fetch داده. این الگو از article-page.tsx موجود الگوبرداری شد.
-Googlebot JavaScript را اجرا می‌کند و این meta tag های داینامیک را ایندکس می‌کند.
-Deep-link و refresh کار می‌کنند: کامپوننت‌ها در mount اول ID را از URL می‌خوانند.
-Back/forward مرورگر از طریق popstate handler مرکزی در page.tsx هندل می‌شود.
