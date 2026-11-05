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

/* ─────────────────────────────────────────────────────────────────────────
 * v190 — کلید سراسری Muscle Wiki (دیرکتیو مالک):
 *   ۱) کلید سراسری «exercise_musclewiki_enabled» در SiteSetting — پنل ادمین،
 *      تنظیمات بانک حرکات: خاموش = ویدیوی Muscle Wiki «هیچ» حرکتی در هیچ‌جای
 *      سایت (بانک + جلسهٔ برنامه + صفحات عمومی) نشان داده نمی‌شود؛ حرکاتِ
 *      بدون ویدیوی اختصاصی به یوتیوب برمی‌گردند و چالش‌ها به انیمیشن دوفریمی.
 *   ۲) کلید تک‌حرکتی «mwEnabled» روی خود رکورد ExerciseLibrary — سوییچ هر
 *      ردیف در پنل: خاموش = Muscle Wikiِ فقط همان حرکت پنهان است.
 *
 * قانون اولویت نمایش نهایی (دیرکتیو مالک v190):
 *   اختصاصی (videoUrl) > Muscle Wiki (سراسری ∧ تک‌حرکتی) > یوتیوب (سراسری ∧ تک‌حرکتی)
 *   — در چالش‌ها فقط: Muscle Wiki (سراسری) وگرنه انیمیشن دوفریمی.
 * ───────────────────────────────────────────────────────────────────────── */

/** کلید SiteSetting برای کلید سراسری Muscle Wiki (v190) */
export const GLOBAL_MUSCLEWIKI_SETTING_KEY = "exercise_musclewiki_enabled";

/** خواندن مقدار خام SiteSetting → بولین (پیش‌فرض/نامشخص = روشن) */
export function globalMuscleWikiEnabledFromValue(value: string | null | undefined): boolean {
  return (value ?? "1").trim() !== "0";
}

/** متن استاندارد منبع ویدیو زیر پلیر Muscle Wiki (دیرکتیو مالک v190) */
export const MUSCLEWIKI_ATTRIBUTION = "ویدیو متعلق به سایت ماسل ویکی";

/* ─────────────────────────────────────────────────────────────────────────
 * v191 — مرتب‌سازی بانک حرکات بر اساس اولویت ویدیو (دیرکتیو مالک):
 *   حرکاتِ ویدیوی اختصاصی در بالاترین جای لیست، بعد حرکات ماسل‌ویکی،
 *   بعد حرکات یوتیوب و در انتها حرکات بدون ویدیو — در بانک حرکات عمومی
 *   (/exercises) و بانک حرکات پنل کاربری (تب ایزوله).
 *   ترتیب درون هر لایه: الفبایی نام (مثل قبل).
 * ───────────────────────────────────────────────────────────────────────── */

/** لایهٔ ویدیو برای مرتب‌سازی: ۰=اختصاصی، ۱=ماسل‌ویکی، ۲=یوتیوب، ۳=بدون ویدیو */
export function exerciseVideoTier(
  ex: ExerciseVideoSource | null | undefined,
  opts?: ResolveExerciseVideoOptions
): 0 | 1 | 2 | 3 {
  if ((ex?.videoUrl ?? "").trim() !== "") return 0;
  if (isMuscleWikiDisplayAllowed(ex, opts?.muscleWikiEnabled ?? true, opts?.gender)) return 1;
  if (isYoutubeDisplayAllowed(ex, opts?.youtubeEnabled ?? true)) return 2;
  return 3;
}

/**
 * مرتب‌سازی لیست حرکات بر اساس اولویت ویدیو (اختصاصی > ماسل‌ویکی > یوتیوب > بدون ویدیو)،
 * درون هر لایه الفبایی. ورودی/خروجی همان آرایهٔ مرتب‌شده (in-place مثل sort).
 */
export function sortExercisesByVideoPriority<
  T extends ExerciseVideoSource & { name: string }
>(
  list: T[],
  opts?: ResolveExerciseVideoOptions
): T[] {
  return [...list].sort((a, b) => {
    const ta = exerciseVideoTier(a, opts);
    const tb = exerciseVideoTier(b, opts);
    if (ta !== tb) return ta - tb;
    return (a.name ?? "").localeCompare(b.name ?? "", "fa");
  });
}

/** حداقل شکل رکورد حرکت که توابع ویدیو می‌خوانند (سطر کامل API یا زیرمجموعه) */
export interface ExerciseVideoSource {
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
  youtubeUrl?: string | null;
  /** v113 — کلید تک‌حرکتی یوتیوب (فقط false = خاموش؛ undefined = روشن) */
  youtubeEnabled?: boolean | null;
  /** v189 — ویدیوی Muscle Wiki (مرد/زن) — اولویت بین اختصاصی و یوتیوب */
  mwVideoUrl?: string | null;
  mwVideoUrlFemale?: string | null;
  /** v190 — کلید تک‌حرکتی Muscle Wiki (فقط false = خاموش؛ undefined = روشن) */
  mwEnabled?: boolean | null;
}

/** گزینه‌های حل منبع ویدیو (v113 — v190: + muscleWikiEnabled) */
export interface ResolveExerciseVideoOptions {
  /** کلید سراسری پنل ادمین — undefined = روشن */
  youtubeEnabled?: boolean;
  /** v190 — کلید سراسری Muscle Wiki پنل ادمین — undefined = روشن */
  muscleWikiEnabled?: boolean;
  /** v189 — جنسیت کاربر برای انتخاب ویدیوی Muscle Wiki (پیش‌فرض مرد) */
  gender?: "male" | "female" | null;
}

/**
 * نتیجهٔ resolve — file = ویدیوی HTML5 (اختصاصی یا Muscle Wiki)، youtube = iframe امبد، none = فال‌بک انیمیشن
 * v190 — source برای کپشن منبع (اختصاصی = بدون کپشن، mw = «ویدیو متعلق به سایت ماسل ویکی»)
 */
export type ResolvedExerciseVideo =
  | { kind: "file"; src: string; poster: string; source: "custom" | "mw" }
  | { kind: "youtube"; src: string; poster: ""; source: "youtube" }
  | { kind: "none"; src: ""; poster: ""; source: "none" };

/** آیا این حرکت ویدیوی اختصاصی آپلودی (غیر یوتیوب) دارد؟ */
export function isCustomVideo(ex: ExerciseVideoSource | null | undefined): boolean {
  return typeof ex?.videoUrl === "string" && ex.videoUrl.trim() !== "";
}

/**
 * v189 — مسیر ویدیوی Muscle Wiki این حرکت برای جنسیت خواسته‌شده
 * (فال‌بک جنسیتی: اگر جنسیت کاربر نداشت، ویدیوی جنسیت مقابل)
 */
export function muscleWikiVideoUrl(
  ex: ExerciseVideoSource | null | undefined,
  gender?: "male" | "female" | null
): string {
  const male = (ex?.mwVideoUrl ?? "").trim();
  const female = (ex?.mwVideoUrlFemale ?? "").trim();
  return gender === "female" ? female || male : male || female;
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
 * v190 — آیا Muscle Wikiِ این حرکت مجاز به نمایش است؟
 * (سراسری ∧ تک‌حرکتی ∧ وجود مسیر ویدیو)
 */
export function isMuscleWikiDisplayAllowed(
  ex: ExerciseVideoSource | null | undefined,
  globalEnabled = true,
  gender?: "male" | "female" | null
): boolean {
  if (!globalEnabled) return false;
  if (ex?.mwEnabled === false) return false;
  return muscleWikiVideoUrl(ex, gender) !== "";
}

/**
 * منبع نمایش ویدیوی حرکت را با ترتیب اولویت حل می‌کند (تک‌ویدیویی — اورلی پنل
 * و مودال برنامه‌ها) — v190 (دیرکتیو مالک):
 *   ۱) videoUrl (اختصاصی ادمین) → ۲) Muscle Wiki (سراسری ∧ تک‌حرکتی ∧ جنسیتی)
 *   → ۳) youtubeUrl (سراسری ∧ تک‌حرکتی) → ۴) none
 * وقتی Muscle Wiki خاموش است (سراسری یا تک‌حرکتی)، حرکاتِ بدون ویدیوی
 * اختصاصی «به یوتیوب برمی‌گردند» — همان‌طور که مالک خواسته است.
 */
export function resolveExerciseVideoSrc(
  ex: ExerciseVideoSource | null | undefined,
  opts?: ResolveExerciseVideoOptions
): ResolvedExerciseVideo {
  const videoUrl = (ex?.videoUrl ?? "").trim();
  if (videoUrl) {
    return { kind: "file", src: videoUrl, poster: (ex?.videoPosterUrl ?? "").trim(), source: "custom" };
  }
  if (isMuscleWikiDisplayAllowed(ex, opts?.muscleWikiEnabled ?? true, opts?.gender)) {
    return { kind: "file", src: muscleWikiVideoUrl(ex, opts?.gender), poster: "", source: "mw" };
  }
  if (isYoutubeDisplayAllowed(ex, opts?.youtubeEnabled ?? true)) {
    const yt = (ex?.youtubeUrl ?? "").trim();
    return { kind: "youtube", src: withYouTubeFaSubs(yt), poster: "", source: "youtube" };
  }
  return { kind: "none", src: "", poster: "", source: "none" };
}

/**
 * v113 — بلوک‌های ویدیوی «صفحهٔ کامل حرکت» (هم‌نوع SPA v111) — v190: Muscle Wiki
 * تابع کلیدهای سراسری/تک‌حرکتی است؛ یوتیوب فقط وقتی نمایش داده می‌شود که هیچ
 * ویدیوی محلیِ فعال (اختصاصی/Muscle Wiki) وجود نداشته باشد — یعنی با خاموش‌شدن
 * Muscle Wiki، حرکاتِ بدون ویدیوی اختصاصی به یوتیوب برمی‌گردند:
 *   custom  = <video> اختصاصی فیتاپ (null = ندارد)
 *   mw      = <video> Muscle Wiki جنسیتی (null = ندارد یا کلیدها خاموش)
 *   youtube = iframe امبد با زیرنویس فارسی (null = ندارد یا ویدیوی محلی داریم)
 */
export function resolveExerciseVideoBlocks(
  ex: ExerciseVideoSource | null | undefined,
  opts?: ResolveExerciseVideoOptions
): {
  custom: { src: string; poster: string } | null;
  mw: string | null;
  youtube: string | null;
} {
  const videoUrl = (ex?.videoUrl ?? "").trim();
  const custom = videoUrl
    ? { src: videoUrl, poster: (ex?.videoPosterUrl ?? "").trim() }
    : null;
  const mw = isMuscleWikiDisplayAllowed(ex, opts?.muscleWikiEnabled ?? true, opts?.gender)
    ? muscleWikiVideoUrl(ex, opts?.gender)
    : null;
  const hasLocal = !!custom || !!mw;
  const youtube =
    !hasLocal && isYoutubeDisplayAllowed(ex, opts?.youtubeEnabled ?? true)
      ? withYouTubeFaSubs((ex?.youtubeUrl ?? "").trim())
      : null;
  return { custom, mw, youtube };
}
