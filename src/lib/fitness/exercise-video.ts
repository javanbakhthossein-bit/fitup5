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
