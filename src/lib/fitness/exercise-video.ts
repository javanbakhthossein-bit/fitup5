/**
 * exercise-video.ts — ابزار مشترک ویدیوی یوتیوب بانک حرکات (v31)
 *
 * «هیچ حرکتی بدون ویدیوی درست» — سه گارد:
 *   ۱) استخراج/نرمال‌سازی ID یوتیوب از هر قالب رایج (watch / youtu.be / shorts / embed)
 *   ۲) نرمال‌سازی به قالب embed استاندارد که در کل پروژه ذخیره/رندر می‌شود
 *   ۳) فیلتر «خارج از حوزه» — لیست سیاه کلیدواژه‌های غیربدنسازی (زیبایی/آرایش،
 *      قلاب‌بافی، آشپزی، ورزش‌های نامرتبط و…) که ریشه باگ ویدیوی رنگ‌مو برای
 *      حرکت «راوت» بود (جستجوی امتیازدهی v28 فقط شباهت عنوان را می‌سنجید)
 */
const YT_ID = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

/** استخراج ID ۱۱-کاراکتری یوتیوب از هر قالب رایج؛ ناموفق = null */
export function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = YT_ID.exec(url.trim());
  return m ? m[1] : null;
}

/**
 * ورودی کاربر/ادمین را به قالب ذخیرهٔ پروژه تبدیل می‌کند:
 * «https://www.youtube.com/embed/<ID>» — هر چیز دیگر (خالی/نامعتبر) = null
 */
export function normalizeYoutubeEmbedUrl(input: string | null | undefined): string | null {
  const id = extractYouTubeId(input);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

/**
 * v65 — پارامترهای «زیرنویس فارسی پیش‌فرض» برای embed یوتیوب (درخواست مالک):
 *  - cc_load_policy=1 → اگر ویدیو زیرنویس داشته باشد، هنگام پخش خودش روشن است
 *  - cc_lang_pref=fa  → اولویت انتخاب زیرنویس با فارسی
 *  - hl=fa            → رابط پلیر یوتیوب فارسی
 *  - rel=0            → پیشنهادهای پایان ویدیو فقط از کانالِ همان ویدیو
 * اگر ویدیو اصلاً زیرنویس نداشته باشد یوتیوب بی‌صدا نادیده می‌گیرد (بی‌خطر).
 *
 * ⚠️ تصحیح v83 (درخواست مالک): cc_lang_pref=fa فقط وقتی فارسی نشان می‌دهد که
 * «خودِ» ویدیو در یوتیوب ترک زیرنویس فارسی داشته باشد — که برای اکثر ویدیوهای
 * آموزشی وجود ندارد؛ و ترجمهٔ خودکار به فارسی از طریق پارامتر embed قابل اجبار
 * نیست (فقط دستی از منوی پلیر: تنظیمات → زیرنویس‌ها → ترجمهٔ خودکار → فارسی).
 * بنابراین رابط کاربری دیگر ادعای «زیرنویس فارسی روشن است» نمی‌کند و به‌جایش
 * راهنمای روشن‌کردن دستی زیرنویس فارسی را نمایش می‌دهد (exercise-detail-page،
 * exercise-detail-overlay، programs-view). پارامترها حفظ شدند: بی‌خطرند و وقتی
 * ویدیویی ترک فارسی داشته باشد همان خودکار انتخاب می‌شود.
 */
export function withYouTubeFaSubs(embedUrl: string | null | undefined): string {
  const url = (embedUrl ?? "").trim();
  if (!/youtube(?:-nocookie)?\.com\/embed\//.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cc_load_policy=1&cc_lang_pref=fa&hl=fa&rel=0`;
}

/** کلیدواژه‌های غیربدنسازی (فارسی + انگلیسی) — عنوان/نام کانال ویدیو
 *  ⚠️ «شنا» عمومی اینجا نیست: «شنا سوئدی» خودِ پوش‌آپ است (قانون شنا = مثبت کاذب) */
const OFF_TOPIC =
  /رنگ\s*مو|آرایش|زیبایی|میکاپ|makeup|ناخن|nail|اسکراب|پوست|skin\s*care|hair\s*(color|dye|cut)|سالن زیبایی|صاف\s*و\s*براق|قابل\s*(شستشو|رنگ)|قلاب‌بافی|قلاب بافی|crochet|بافتنی|پتوی|کلاه بافت|آشپزی|پخت|خوشمزه|دسر|کیک|food recipe|cooking|موسیقی|آهنگ|music video|گیم|گیمپلی|گیم پلی|gaming|پینگ ?پونگ|تنیس روی میز|table tennis|دفاع شخصی|self ?defense|بوکس|boxing|کرال|water polo|واترپلو|سگ|گربه|طنز|جوک|بورس|ارز دیجیتال|کریپتو|crypto|ترید|کنکور|آموزش زبان|english course/i;

/** true = عنوان/کانال قطعاً خارج از حوزهٔ آموزش حرکات بدنسازی است */
export function isOffTopicVideoTitle(title: string, channel = ""): boolean {
  return OFF_TOPIC.test(`${title} ${channel}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * v112 — ویدیوی اختصاصی فیتاپ در برابر یوتیوب
 *
 * مدیر از پنل ادمین برای هر حرکت می‌تواند ویدیوی اختصاصی آپلود کند
 * (/uploads/exercise-videos/… — فشرده‌سازی + پوستر خودکار).
 *
 * v113 — کلید یوتیوب (دیرکتیو مالک):
 *   ۱) کلید سراسری «exercise_youtube_enabled» در SiteSetting — پنل ادمین،
 *      بالای تب بانک حرکات: خاموش = یوتیوب «هیچ» حرکتی در هیچ‌جای سایت
 *      نشان داده نمی‌شود (فقط ویدیوهای اختصاصی/انیمیشن).
 *   ۲) کلید تک‌حرکتی «youtubeEnabled» روی خود رکورد ExerciseLibrary —
 *      سوییچ هر ردیف در پنل: خاموش = یوتیوبِ فقط همان حرکت پنهان است و
 *      اگر ویدیوی اختصاصی داشته باشد «فقط» همان نشان داده می‌شود.
 *
 * قانون نمایش نهایی یوتیوب = سراسری ∧ تک‌حرکتی ∧ وجود youtubeUrl
 * ویدیوی اختصاصی (videoUrl) همیشه مستقل از این دو کلید نشان داده می‌شود.
 * ───────────────────────────────────────────────────────────────────────── */

/** کلید SiteSetting برای کلید سراسری یوتیوب بانک حرکات (v113) */
export const GLOBAL_YOUTUBE_SETTING_KEY = "exercise_youtube_enabled";

/** خواندن مقدار خام SiteSetting → بولین (پیش‌فرض/نامشخص = روشن) */
export function globalYoutubeEnabledFromValue(value: string | null | undefined): boolean {
  return (value ?? "1").trim() !== "0";
}

/** حداقل شکل رکورد حرکت که توابع ویدیو می‌خوانند (سطر کامل API یا زیرمجموعه) */
export interface ExerciseVideoSource {
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
  youtubeUrl?: string | null;
  /** v113 — کلید تک‌حرکتی یوتیوب (فقط false = خاموش؛ undefined = روشن) */
  youtubeEnabled?: boolean | null;
}

/** گزینه‌های حل منبع ویدیو (v113) */
export interface ResolveExerciseVideoOptions {
  /** کلید سراسری پنل ادمین — undefined = روشن */
  youtubeEnabled?: boolean;
}

/** نتیجهٔ resolve — file = ویدیوی اختصاصی HTML5، youtube = iframe امبد، none = فال‌بک انیمیشن */
export type ResolvedExerciseVideo =
  | { kind: "file"; src: string; poster: string }
  | { kind: "youtube"; src: string; poster: "" }
  | { kind: "none"; src: ""; poster: "" };

/** آیا این حرکت ویدیوی اختصاصی آپلودی (غیر یوتیوب) دارد؟ */
export function isCustomVideo(ex: ExerciseVideoSource | null | undefined): boolean {
  return typeof ex?.videoUrl === "string" && ex.videoUrl.trim() !== "";
}

/**
 * v113 — آیا یوتیوبِ این حرکت مجاز به نمایش است؟
 * (سراسری ∧ تک‌حرکتی ∧ وجود لینک)
 */
export function isYoutubeDisplayAllowed(
  ex: ExerciseVideoSource | null | undefined,
  globalEnabled = true
): boolean {
  if (!globalEnabled) return false;
  if (ex?.youtubeEnabled === false) return false;
  const yt = (ex?.youtubeUrl ?? "").trim();
  return yt !== "";
}

/**
 * منبع نمایش ویدیوی حرکت را با ترتیب اولویت حل می‌کند (تک‌ویدیویی — اورلی پنل
 * و مودال برنامه‌ها): ۱) videoUrl (اختصاصی) → ۲) youtubeUrl اگر هر دو کلید
 * یوتیوب روشن باشند → ۳) none
 */
export function resolveExerciseVideoSrc(
  ex: ExerciseVideoSource | null | undefined,
  opts?: ResolveExerciseVideoOptions
): ResolvedExerciseVideo {
  const videoUrl = (ex?.videoUrl ?? "").trim();
  if (videoUrl) {
    return { kind: "file", src: videoUrl, poster: (ex?.videoPosterUrl ?? "").trim() };
  }
  if (isYoutubeDisplayAllowed(ex, opts?.youtubeEnabled ?? true)) {
    const yt = (ex?.youtubeUrl ?? "").trim();
    return { kind: "youtube", src: withYouTubeFaSubs(yt), poster: "" };
  }
  return { kind: "none", src: "", poster: "" };
}

/**
 * v113 — بلوک‌های ویدیوی «صفحهٔ کامل حرکت» (هم‌نوع SPA v111): ویدیوی اختصاصی
 * و یوتیوب می‌توانند «هم‌زمان» نمایش داده شوند؛ یوتیوب فقط وقتی که هر دو کلید
 * روشن باشند. خروجی برای رندر مستقیم:
 *   custom  = <video> اختصاصی فیتاپ (null = ندارد)
 *   youtube = iframe امبد با زیرنویس فارسی (null = ندارد یا خاموش)
 */
export function resolveExerciseVideoBlocks(
  ex: ExerciseVideoSource | null | undefined,
  opts?: ResolveExerciseVideoOptions
): { custom: { src: string; poster: string } | null; youtube: string | null } {
  const videoUrl = (ex?.videoUrl ?? "").trim();
  const custom = videoUrl
    ? { src: videoUrl, poster: (ex?.videoPosterUrl ?? "").trim() }
    : null;
  const youtube = isYoutubeDisplayAllowed(ex, opts?.youtubeEnabled ?? true)
    ? withYouTubeFaSubs((ex?.youtubeUrl ?? "").trim())
    : null;
  return { custom, youtube };
}
