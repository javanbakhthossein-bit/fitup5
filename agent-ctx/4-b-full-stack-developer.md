# Task 4-b — رسانه‌ها: فشرده‌سازی ویدیو + لغو حذف فایل‌ها + بازطراحی پیشرفت + لایت‌باکس + آزمایش خون در پروفایل + بزرگ‌نمایی گالری ادمین

**Agent:** full-stack-developer (media/compliance/gallery)
**Date:** 2026-09-08 (sandbox)

## خلاصهٔ کارهای انجام‌شده

### ۱) لغو کامل حذف فایل‌های کاربر — قانون مالک v53
- `src/app/api/cron/cleanup-media/route.ts` بازنویسی شد: دیگر **هیچ فایلی** حذف نمی‌شود، **هیچ AnalysisResult** حذف نمی‌شود و **هیچ ChatMessage.mediaUrl** نال نمی‌شود. روت با همان گارد CRON_SECRET زنده ماند و فقط آمار برمی‌گرداند: `{ok, policy:"forever", deletedFiles:0, deletedRecords:0, note:"سیاست v53: نگهداری همیشگی رسانه‌های کاربر"}` (route.ts:55-70).
- ممیزی unlink در کل src: فقط سه مسیر فایل کاربر را حذف می‌کرد — هر سه اصلاح شد:
  - `api/progress/photo/route.ts` DELETE: فقط رکورد DB حذف می‌شود؛ فایل در uploads/progress می‌ماند (route.ts:86-110).
  - `api/user/avatar/route.ts` POST/DELETE: آواتار قبلی/حذف‌شده دیگر از دیسک unlink نمی‌شود؛ فقط URL در DB عوض/null می‌شود؛ `deleteAvatarFileFromDisk` حذف شد (route.ts:16-19, 67-68, 76-89).
  - `api/cron/cleanup-media/route.ts` (بالا).
- unlinkهای مجاز: tmp فایل‌های ffmpeg در ai.ts (فریم/رمکس — tmp نیستند از فایل‌های کاربر)، tmp خروجی فشرده‌ساز، حذف APK قدیمی توسط ادمین (releases — سندباز اپ، نه رسانهٔ کاربر).

### ۲) فشرده‌سازی ویدیو + برداشتن سقف ۳۰MB
- `api/coach/analyze-video/route.ts`: MAX_VIDEO_BYTES = 300MB (route.ts:38) + بعد از savePrivateMediaFile و قبل از analyzeVideoFromPath: `compressVideoFileInPlace(filePath,{maxHeight:720,crf:28})` + لاگ کوتاه (route.ts:111-118). منطق شمارنده/ذخیره/capability دست‌نخورده. ai.ts دست نخورده.
- `video-analysis-view.tsx`: سقف نرم ۳۰۰MB با پیام «ویدیوی بسیار بزرگ است» (خط ۱۳۱-۱۵۲)، نمایش حجم فایل انتخابی (خط ۳۴۲)، متن دکمهٔ حین کار «در حال بهینه‌سازی و تحلیل…» (خط ۳۵۱)، آیتم راهنمای حجم → «بدون دغدغهٔ حجم — تا ۳۰۰ مگابایت» (خط ۴۴).

### ۳) قرارداد جدید /api/user-media
- گروه جدید **`videos`**: ChatMessage های mediaType="video" دارای mediaUrl (source:"chat") + AnalysisResult های video_analysis دارای mediaUrl (source:"video_analysis") — هر آیتم `{id,url,createdAt,source}` مرتب نزولی (route.ts:63-82).
- بقیهٔ گروه‌ها (bodyPhotos/bloodTests/videoAnalysis/bodyAnalysis) بدون تغییر — backward-compatible.

### ۴) لایت‌باکس مشترک
- `src/components/fitness/media-lightbox.tsx` (جدید): portal روی body با الگوی ضدلگ daily-medal (بدون blur سنگین، bg-black/95، useScrollLock)، z-[160]، دکمهٔ بستن بالا-چپ، ناوبری فلش چپ/راست + کیبورد (RTL: چپ=بعدی)، عکس: دبل‌کلیک toggle 1x↔2.5x + درگ pointer events (اسلاید با key={index} remount می‌شود → ریست طبیعی زوم بدون setState در effect)، ویدیو: `<video controls autoPlay playsInline>`.
- مصرف: progress-view (عکس‌ها+ویدیوها)، profile-overlay (آزمایش خون)، admin-overlay UserMediaGalleryDialog (عکس+ویدیو).

### ۵) گالری پیشرفت (progress-view.tsx)
- تب‌های فیلتر جلو/بغل/پشت حذف → همهٔ عکس‌ها در `columns-2 md:columns-3` (masonry ساده) نزولی با بج نوع گوشهٔ تصویر (ProgressGallery خط ۷۷۱+).
- تب «عکس‌ها/ویدیوها» فقط برای پلن حرفه‌ای (`planTierRank>=4` = ultimate)؛ پلن‌های پایین‌تر بدون تب.
- کارت جمع‌وجمع «آزمایش خون» بالای گالری: ۳ آزمایش آخر + خلاصه (امتیاز/تعداد نشانگر/بالا/پایین) + دکمهٔ «مشاهدهٔ کامل» → `setOverlay("bloodTest")`.
- حذف عکس + AlertDialog تأیید همان قبلی ماند. آپلود با انتخاب‌گر زاویهٔ کوچک (جلو/بغل/پشت) کنار دکمه.

### ۶) پروفایل
- سکشن «آزمایش‌های خون من» بعد از اطلاعات فیزیکی (profile-overlay.tsx خط ۶۱۸+): fetch فاز-دوم از /api/user-media (timer 500ms — فریم اول سنگین نمی‌شود)، کلیک آیتم دارای عکس → لایت‌باکس؛ بدون عکس → مودال متنی (score/overall/markers با چیپ وضعیت/توصیه‌ها). خالی → ردیف «هنوز آزمایشی آپلود نکرده‌ای» + دکمهٔ آپلود → setOverlay("bloodTest").

### ۷) ادمین
- `admin-overlay.tsx` → UserMediaGalleryDialog: عکس و ویدیو کلیک‌پذیر شدند → MediaLightbox (ایندکس روی لیست فیلترشدهٔ فعلی؛ isVideo حالا kind="video" را هم می‌گیرد). هیچ بخش دیگری از admin-overlay باز نشد.
- `api/admin/users/[id]/details/route.ts`: kind ویدیوی چت → "video" (هم‌خوان با mediaCounts.video؛ فیلتر «ویدیو» حالا ویدیوی چت را هم نشان می‌دهد). video_analysis همان mediaUrl (فایل فشردهٔ نهایی) را می‌دهد چون فشرده‌سازی درجاست.

## تست واقعی (E2E با کاربر تستی موقت 09330001122)
- ffmpeg تست‌کلیپ 1080x1920/8s/5.8MB ساخته شد → کاربر تستی ultimate + OTP مستقیم DB → POST analyze-video:
  - **فشرده‌سازی تأیید شد:** `5.8MB → 192KB` (لاگ)، فایل نهایی 406x720 (ffprobe) — فشرده و <1MB.
  - AI سندباکس 401 داد (کلید AvalAI سندباکس نامعتبر است) → روت 500 تمیز با پیام فارسی و **فایل فشرده ماند و روت نشکست** (رفتار مورد انتظار).
- ChatMessage ویدیویی + AnalysisResult video_analysis/blood_test تستی درج شد → GET /api/user-media: گروه videos شامل هر دو با source درست؛ bloodTests با score/markers.
- cleanup-media: قبل 424 فایل / بعد 424 فایل (هیچ حذفی) + پاسخ policy forever؛ بدون/با secret غلط → 401.
- admin details برای کاربر تستی: mediaCounts.video=2، kind ها درست.
- serve-upload: فایل ویدیو با کوکی مالک 200 (video/mp4)، بدون کوکی 401.
- **پاک‌سازی بعد از تست:** کاربر تستی (cascade)، ۲ OTP، ۲ فایل تستی حذف شدند؛ CRON_SECRET آزمایشی از .env حذف شد؛ هیچ دادهٔ مالک (09121111111) دست نخورد.

## گیت‌ها
- `bunx tsc --noEmit` → 0 خطا.
- `bun run lint` → 0 error / 73 warning (پایه). دو خطای گذرای tsx/lint از فایل‌های در-جریان ایجنت موازی (quota.ts / inline-video-preview.tsx) وسط کار دیده شد که خودشان قبل از گیت نهایی رفع شدند.
- dev.log بدون خطای کامپایل؛ `/` → 200.

## نکته برای ایجنت‌های بعدی
- MediaLightbox قراردادش: `items: {type:"image"|"video", url, title?}[] + index + onClose + onIndexChange` — هر جا رسانهٔ کاربر بزرگ‌نمایی می‌خواهد از این استفاده کنید (زوم/ناوبری/کیبورد داخلش هست).
- قانون v53 در سراسر کد با کامنت «قانون مالک (v53)» علامت‌گذاری شده — اگر روت جدیدی فایل می‌سازد، هیچ unlinkی روی فایل کاربر نگذارید؛ استثنای واحد: نسخهٔ اصلی ویدیو بعد از فشرده‌سازی موفق (media-compress.ts).
