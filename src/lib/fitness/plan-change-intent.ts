import { db } from "@/lib/db";
import type { Plan } from "@/lib/fitness/types";
import { findNeverActivatedSubscription } from "@/lib/fitness/subscription";
import {
  parseRequestedSplitFromText,
  type RequestedSplitSpec,
} from "@/lib/fitness/plan-redesign-request";
// v149 — ممنوعیت‌های صریح (تیکت باگ بزرگ بازطراحی: حرکات حذفی دوباره برنگردند)
import { parseRedesignConstraintsFromText } from "@/lib/fitness/plan-redesign-constraints";
// v157 — مخزن ماندگار ممنوعیت‌ها (حفره‌های ۱/۲/۳ تیکت مصطفی خوشبخت:
// ممنوعیت‌ها باید از همهٔ مسیرها ضبط شوند، هرگز منقضی/پاک نشوند و در همهٔ
// تولیدها مسلح شوند — رجوع به persistent-exclusions.ts)
import { capturePersistentExclusionsFromText } from "@/lib/fitness/persistent-exclusions";

/**
 * v77 — «تغییر برنامه از طریق چت با فیتاپ» — ریشه‌یابی تیکت‌های مالک:
 *
 * تیکت ۱ (سجاد لطفی): «بروزرسانی نشده یا فیتاپ آنلاین چت کردم قرار بود برنامه
 * غذایی هم تغییر کنه» + «برنامه غذایی درست نیست تغییرش بدید» — کاربر در چت
 * درخواست تغییر برنامه داد (جایگزینی منابع پروتئینی، تنوع بیشتر، افزودن
 * مکمل‌های خودش)؛ مربی هوشمند در چت «ثبت شد ✅» می‌گفت ولی هیچ تغییر واقعی در
 * برنامهٔ ذخیره‌شده اعمال نمی‌شد و کاربر ساعت‌ها وقت تلف کرد (حتی با حذف و
 * نصب مجدد اپ به توصیهٔ نادرست چت!).
 *
 * ریشه: چت هیچ مسیر عملیاتی برای اعمال تغییر برنامه ندارد و مدل هم بلد نبود
 * صادق بگوید. راه‌حل (سه لایه — مکمل مکانیزم جایگزینی تکی v73.4):
 *   ۱) تشخیص نیت «تغییر/بازتولید برنامه» در پیام چت (دقت بالا — فقط افعال
 *      امریِ تغییر + اسم برنامه/غذا/تمرین؛ سؤال‌های معمولی trigger نمی‌شوند)
 *   ۲) ماندگاری درخواست: متن درخواست کاربر به nutritionNotes پروفایل اضافه
 *      می‌شود (این فیلد در همهٔ پرامپت‌های تولید تمرین/غذا/مکمل تزریق می‌شود)
 *      و مکمل‌های اعلامی به currentSupplements اضافه می‌شوند — پس تغییرِ
 *      درخواستی، دائمی است و در بازتولیدهای بعدی هم رعایت می‌شود.
 *   ۳) اجرای واقعی: startProgramGenerationInBackground با source
 *      «chat_request» شروع می‌شود (بازتولید کامل، بدون دست‌زدن به اشتراک،
 *      مشمول سقف روزانهٔ ۵ بار). نتیجه (شروع شد/در جریان است/سقف پر) به‌صورت
 *      یادداشت سیستمی به مدل چت تزریق می‌شود تا پاسخ «صد در صد صادقانه» باشد —
 *      دیگر مدل نمی‌تواند ادعای دروغِ «ثبت شد» بکند.
 */

/** نرمال‌سازی سبک متن فارسی برای تشخیص نیت (ی/ی، ک/ك، اعداد، نیم‌فاصله) */
function normalizeFaText(raw: string): string {
  return (raw || "")
    .replace(/[\u200c\u200f\u200e]/g, " ") // نیم‌فاصله/جهت‌ها → فاصله
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/** فعل امریِ تغییر (کن/کنید/کنم/بده/بدید/بشه…)
 *  🩹 v78 — واژه‌های مالک اضافه شد: «بازطراحی» (کلمهٔ دقیق مالک)، «بازنویسی» بدون فعل
 *  کمکی، «به روز/به‌روز/آپدیت/اپدیت»، «بچین»، «طراحی کن» — normalize نیم‌فاصله را
 *  فاصله می‌کند پس «به روز» با فاصله می‌آید */
const RE_CHANGE_VERB_IMPERATIVE =
  /(عوضش?\s*(کن|کنید|کنم|بدید|بده|بکن)|تغییرش?\s*(بدید|بده|کن|کنید|کنم|بدم)|جای\s*گ?زین\s*(کن|کنید|کنم|بده|بدید|بکن)|جایگزینش?\s*(کن|کنید|کنم|بده|بدید)|بازنویسی|بازطراحی|بازتولید|بازسازی|از\s*اول\s*(بنویس|بساز|بچین|طراحی\s*کن)|دوباره\s*(بنویس|بساز|بچین|طراحی\s*کن)|درستش?\s*(کن|کنید|کنم|بدید|بده)|فیکس\s*(کن|کنید|کنم)|برام\s*بنویس|به?م\s*بده|به?م\s*بساز|برام\s*بساز|به\s*روز\s*(کن|کنید|کنم|بشه|بده)|آپدیت|اپدیت|بچین|از\s*(اول|نو)\s*(بنویس|بساز|بسازی|بسازید|بچین|طراحی\s*کن)|دوباره\s*(بساز|بسازی|بسازید)|بساز(ی|ید|یم)?)/;

/** اسم برنامه/غذا/تمرین (شرط همراهی با فعل تغییر)
 *  🩹 v78 — «برنام» پیشوندی است تا محاوره‌ها (برناممو/برنامم/برنامو…) هم بگیرد */
const RE_PLAN_CONTEXT_NOUN =
  /(برنام|رژیم|غذا|غذایی|تمرین|تمرینی|وعده|حرکت|مکمل|کالری|دستور)/;

/**
 * الگوهای قوی مستقل — حتی بدون همجواری، خودشان تغییر برنامه را می‌رسانند
 * (نمونهٔ واقعی تیکت: «برنامه غذایی درست نیست تغییرش بدید»)
 */
const RE_PLAN_CHANGE_STRONG = [
  /برنامه[^.\n]{0,24}(غذا|تمرین|مکمل)[^.\n]{0,40}(عوض|تغییر|جایگزین|جای گزین|بازنویسی|بازطراحی|بازتولید|بازسازی|جدید|درست|دوباره|از اول|به روز|آپدیت|اپدیت)/,
  /(برنامه|رژیم)[^.\n]{0,12}جدید/,
  /برنامه[^.\n]{0,10}(مو\s*نده|دیگه\s*خوب|بدتر|اشتباه)/,
  /(برنامه|رژیم)[^.\n]{0,30}(بازتولید|بازطراحی|بازنویسی|بازسازی)/,
  /(بازطراحی|بازنویسی|بازتولید|بازسازی|آپدیت|اپدیت|به\s*روز(\s*(کن|کنید|کنم|بشه|بده)|رسانی))[^.\n]{0,16}(برنام|رژیم|تمرین|غذا|مکمل)/,
];

/** مکمل‌های قابل تشخیص در متن کاربر (برای افزودن به currentSupplements) */
const SUPPLEMENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /امینو|آمینو|bcaa|eaa/i, label: "پودر آمینواسید" },
  { re: /پروبیوتیک/i, label: "قرص پروبیوتیک" },
  { re: /کراتین|کرئاتین/i, label: "کراتین" },
  { re: /مولتی\s*ویتامین|مولتی ویتامین/i, label: "مولتی‌ویتامین" },
  { re: /ویتامین\s*(د|d)\s*?(۳|3)?|vitamin\s*d/i, label: "ویتامین D3" },
  { re: /امگا|omega/i, label: "امگا ۳" },
  { re: /گلوتامین/i, label: "گلوتامین" },
  { re: /کافئین|پری ورکات|pre\s*workout/i, label: "کافئین" },
  { re: /آرژینین|ارجینین|arginine/i, label: "آرژینین" },
  { re: /بتا\s*آلانین|beta\s*alanine/i, label: "بتا آلانین" },
  { re: /زینک|روی\s*(مکمل)?/i, label: "زینک" },
  { re: /منیزیم|magnesium/i, label: "منیزیم" },
];

/** نشانه‌های «مالکیت/درخواست افزودن» مکمل — بدون این، فقط نام مکمل کافی نیست
 *  🩹 v78 — «می?کنم» → «می\s*?کنم»: نیم‌فاصله در normalize به فاصله تبدیل می‌شود و
 *  «مصرف می‌کنم / استفاده می‌کنم» هرگز مچ نمی‌شد (باگ پنهان v77 — اکیداً superset) */
const RE_SUPPLEMENT_OWNERSHIP =
  /(دارم|خریدم|گرفتم|استفاده\s*می\s*?کنم|مصرف\s*می\s*?کنم|اضافه\s*(کن|کنید|کنم|بکن|بشه)|بذار|بگذار|به?رم\s*بده|به?رم\s*اضافه)/;

export type PlanChangeDetection = {
  /** درخواست تغییر/بازتولید برنامه شناسایی شد؟ */
  isPlanChange: boolean;
  /** مکمل‌های اعلامی/درخواستی قابل افزودن به پرونده */
  supplementMentions: string[];
};

export function detectPlanChangeIntent(raw: string): PlanChangeDetection {
  const text = normalizeFaText(raw);
  if (!text || text.length < 4) {
    return { isPlanChange: false, supplementMentions: [] };
  }

  const hasPlanNoun = RE_PLAN_CONTEXT_NOUN.test(text);
  const imperativeChange = RE_CHANGE_VERB_IMPERATIVE.test(text);

  // درخواست تغییر برنامه: فعل امریِ تغییر + زمینهٔ برنامه/غذا/تمرین
  // یا یکی از الگوهای قوی مستقل
  const isPlanChange =
    (hasPlanNoun && imperativeChange) || RE_PLAN_CHANGE_STRONG.some((re) => re.test(text));

  // مکمل‌ها فقط با نشانهٔ مالکیت/افزودن جمع می‌شوند (نام مکملِ خالی کافی نیست)
  const wantsSupplement = RE_SUPPLEMENT_OWNERSHIP.test(text);
  const supplementMentions = wantsSupplement
    ? SUPPLEMENT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label)
    : [];

  return { isPlanChange, supplementMentions };
}

// ═══════════════════════════════════════════════════════════════════
// v78 — «بازطراحی برنامه (یکبار در طول اشتراک) از چت فیتاپ» — درخواست مالک:
// «چت فیتاپ اگر می‌خواد برنامه بازتولید بشه باید در پلن پیشرفته به بالا فقط
// یکبار قابلیت انجام باشه و فیتاپ باید این موضوع رو به کاربر بگه و تمام اطلاعات
// لازم رو از کاربر بگیره و تایید نهایی رو هم بگیره و بعد بره سراغ تغییر برنامه
// ... این بازطراحی نیاز به پیش‌نیازها نداره و با دیتای فعلی کاربر ساخته بشه و
// تاثیری در مدت اشتراک و تغییر پلن نداره.»
// اسکیمای Subscription: planRegenUsed (سهمیه یکبار مصرف شده) + planRegenPending
// (دستیار در حال جمع‌آوری اطلاعات / منتظر تایید نهایی) — اسکیمای فیلدها خارج از
// محدودهٔ این فایل اعمال شده و اینجا فقط سیاست/جریان پیاده می‌شود.
// ═══════════════════════════════════════════════════════════════════

/**
 * عبارت‌های تایید نهایی صریح (بعد از normalizeFaText — نیم‌فاصله → فاصله، پس
 * هر دو صورت «تایید‌نهایی» و «تایید نهایی» یک الگو می‌گیرند). تشخیص تایید فقط
 * وقتی مصرف می‌شود که planRegenPending فعال باشد — یعنی دستیار اطلاعات را
 * جمع کرده و منتظر تایید است؛ این تضمین می‌کند دستیار همیشه اول «موضوع را به
 * کاربر بگوید + اطلاعات لازم را بگیرد» و بعد سراغ تغییر برنامه برود.
 * گارد «نساز» (نه + بساز) با lookbehind تا «دیگه نساز» تایید حساب نشود.
 */
const RE_PLAN_REGEN_CONFIRM = [
  /تایید\s*نهایی/,
  /تایید\s*می\s*کنم/,
  /تاییدم/,
  /تایید\s*دارم/,
  /موافقم/,
  /باشه\s*بساز/,
  // v199 — بدون lookbehind (?<![نن]): سافاری/WebViewهای قدیمی با «invalid group
  // specifier name» می‌شکنند. معادل دقیق با .test(): (?:^|[^نن]) — کاراکتر
  // مصرف‌شدهٔ پیشوند روی نتیجهٔ بولی اثری ندارد.
  /(?:^|[^نن])بساز/,
  /انجامش?\s*بده/,
  /ثبتش?\s*کن/,
  /همینه\s*[،,]?\s*(بساز|ثبت|انجام|برو)/,
  /بله\s*[،,]?\s*(برنامه\s*رو?\s*)?بساز/,
  /برو\s*برای\s*ساخت/,
];

/** عبارت‌های انصراف/لغو — اولویت بر تایید (مثلاً «تایید نمی‌کنم» انصراف است نه تایید) */
const RE_PLAN_REGEN_CANCEL = [
  /بی\s*خیال/,
  /انصراف/,
  /لغوش?\s*کن/,
  /تایید\s*نمی/,
  /تایید[^.\n]{0,12}نمی/,
  /نمی\s*تایید/,
  /منصرف/,
  /ولش\s*کن/,
];

export type PlanRegenConfirmation = {
  /** تایید نهایی صریح شناسایی شد */
  confirmed: boolean;
  /** انصراف/لغو شناسایی شد (اولویت بر confirmed) */
  cancelled: boolean;
};

export function detectPlanChangeConfirmation(raw: string): PlanRegenConfirmation {
  const text = normalizeFaText(raw);
  if (!text) return { confirmed: false, cancelled: false };
  const cancelled = RE_PLAN_REGEN_CANCEL.some((re) => re.test(text));
  if (cancelled) return { confirmed: false, cancelled: true };
  const confirmed = RE_PLAN_REGEN_CONFIRM.some((re) => re.test(text));
  return { confirmed, cancelled: false };
}

// ─── v78 — وضعیت سهمیهٔ بازطراحی برنامه ───

export type PlanRegenState = {
  /** پلن مؤثر کاربر (اشتراک active/pending یا فال‌بک ردیف User — الگوی buildUserDto) */
  plan: Plan | null;
  /** بازطراحی از چت فقط برای پلن پیشرفته/حرفه‌ای فعال است (درخواست مالک) */
  eligible: boolean;
  /** سهمیهٔ یک‌بارِ اشتراک جاری مصرف شده است (بدون احتساب سهمیهٔ اضافهٔ اهدایی) */
  used: boolean;
  /** دستیار در حال جمع‌آوری اطلاعات / منتظر تایید نهایی است */
  pending: boolean;
  /** رکورد اشتراک حامل سهمیه (null = بدون رکورد اشتراک — فال‌بک ردیف User) */
  subscriptionId: string | null;
  /** v150 — سهمیهٔ اضافهٔ اهدایی مدیر که هنوز مصرف نشده (هر واحد = یک بازطراحی اضافی) */
  extra: number;
};

/**
 * وضعیت سهمیهٔ بازطراحی برنامهٔ کاربر را از اشتراک جاری (active اول، بعد pending
 * در پنجره — همان ترتیب buildUserDto) می‌خواند. هر رکورد Subscription جدید
 * (تمدید/ارتقا) سهمیه را به‌طور طبیعی ریست می‌کند.
 */
export async function getPlanRegenState(userId: string): Promise<PlanRegenState> {
  const now = new Date();
  const activeSub = await db.subscription.findFirst({
    where: { userId, status: "active", endDate: { gt: now } },
    orderBy: { endDate: "desc" },
  });
  const pendingSub = activeSub
    ? null
    : await db.subscription.findFirst({
        where: {
          userId,
          status: "pending",
          OR: [{ endDate: null }, { endDate: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
      });
  // ─── v87 — نجات حق خریدِ «هرگز-فعال‌نشده» (هم‌راستا با buildUserDto) ───
  // کاربری که پنجرهٔ ۷روزه‌اش گذشته ولی پلن را خریده، برای سهمیهٔ بازطراحی هم
  // واجد شرایط است (planRegen holder = اشتراک نجات‌یافته).
  const rescuedSub = !activeSub && !pendingSub
    ? await findNeverActivatedSubscription(userId).catch(() => null)
    : null;
  const holder = activeSub ?? pendingSub ?? rescuedSub ?? null;

  let plan: Plan | null = (holder?.plan as Plan | undefined) ?? null;
  if (!plan) {
    // فال‌بک منبع دوم پلن — فیلدهای معتبر ردیف User (همان الگوی v77 در buildUserDto)
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { planName: true, planExpiresAt: true },
    });
    if (
      user?.planName &&
      typeof user.planName === "string" &&
      user.planExpiresAt &&
      user.planExpiresAt.getTime() > now.getTime()
    ) {
      plan = user.planName as Plan;
    }
  }

  return {
    plan,
    eligible: plan === "advanced" || plan === "ultimate",
    // v150 — با سهمیهٔ اضافهٔ اهدایی مدیر: حتی اگر یک‌بارِ پایه مصرف شده باشد،
    // تا وقتی extra>0 باشد هنوز یک بازطراحی در دسترس است.
    used: (holder?.planRegenUsed ?? false) && (holder?.planRegenExtra ?? 0) <= 0,
    pending: holder?.planRegenPending ?? false,
    subscriptionId: holder?.id ?? null,
    extra: holder?.planRegenExtra ?? 0,
  };
}

/** خط وضعیت برای تزریق همیشگی به پرامپت چت (فقط وقتی eligible صدا زده می‌شود) */
export function buildPlanRegenStateNote(state: PlanRegenState): string {
  if (!state.eligible) return "";
  const extraPart = state.extra > 0
    ? ` سهمیهٔ اضافهٔ اهداییِ پشتیبانی: ${state.extra} بار (مجموع در دسترس پس از این مصرف: ${Math.max(0, (state.used ? 0 : 1) + state.extra - 1)} بار).`
    : "";
  const status = state.used
    ? "مصرف شده — دیگر در این اشتراک قابل استفاده نیست؛ با تمدید یا تغییر/ارتقای پلن، سهمیه به‌طور خودکار دوباره فعال می‌شود (هر اشتراک جدید سهمیهٔ تازهٔ یک‌بار دارد) — این را به کاربر یادآوری کن و برای تغییر فوری به پشتیبانی (تیکت) ارجاع بده."
    : state.pending
      ? "در انتظار تایید نهایی کاربر — اطلاعات را کامل کن و تایید نهایی صریح بگیر؛ تا تایید، برنامهٔ جدید شروع نمی‌شود."
      : `در دسترس (فقط یکبار در طول این اشتراک — هنوز مصرف نشده؛ با تمدید یا تغییر پلن دوباره فعال می‌شود).${extraPart}`;
  return `\n\n[سیستم — قابلیت بازطراحی برنامهٔ کاربر]: بازطراحی کامل برنامه (تمرینی + تغذیه + مکمل) از طریق چت، فقط یکبار در طول هر اشتراک و فقط برای پلن پیشرفته/حرفه‌ای. وضعیت فعلی این کاربر: ${status} بازطراحی نیاز به تکمیل پیش‌نیازها ندارد و هیچ تأثیری در مدت اشتراک یا پلن او ندارد. ⛔ این خط وضعیتِ سیستم است — هرگز به کاربر نشانش نده و هرگز خودت پیشنهاد بازطراحی/بازنویسی برنامه نده و قابلیت آن را تبلیغ نکن؛ فقط وقتی کاربر خودش صریحاً درخواست تغییر کامل برنامه داد، دربارهٔ آن صحبت کن و همان‌جا لیست تغییرات و تایید نهایی را بگیر.`;
}

/** سقف کل nutritionNotes (نویسه) — تا پرامپت تولید منفجر نشود */
const NUTRITION_NOTES_MAX_CHARS = 2400;
/** سقف تعداد قلم currentSupplements */
const SUPPLEMENTS_MAX_ITEMS = 14;

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const p = JSON.parse(t);
    if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* CSV */
  }
  return t
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function faNowStamp(): string {
  try {
    const d = new Date();
    const date = d.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" });
    const time = d.toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran",  hour: "2-digit", minute: "2-digit" });
    return `${date} ساعت ${time}`;
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

export type PlanChangeApplyResult = {
  /** آیا اقدامی (ذخیره/بازتولید/لغو) انجام شد؟ */
  handled: boolean;
  /** یادداشت سیستمی برای تزریق به پرامپت چت (خالی = هیچ) */
  systemNote: string;
  detection: PlanChangeDetection;
  /** v78 — وضعیت سهمیهٔ بازطراحی (برای UI/لاگ؛ خط وضعیت همیشه به systemNote چسبیده است) */
  regenState?: PlanRegenState;
};

/* متن‌های سیستمی v78 — جریان «یکبار در طول اشتراک» (دیرکتیو مالک) */

const NOTE_NOT_ELIGIBLE =
  "\n\n[سیستم — وضعیت درخواست بازطراحی برنامه]: بازطراحی کامل برنامه (تمرین + تغذیه + مکمل) از طریق چت فقط برای پلن پیشرفته و حرفه‌ای فعال است. صادقانه به کاربر بگو با پلن فعلی‌اش این قابلیت از طریق چت فعال نیست؛ اگر در برنامهٔ فعلی‌اش موردی اذیتش می‌کند می‌تواند بگوید تا در پرونده ثبت شود (در چکاپ/به‌روزرسانی دوره‌ای اعمال می‌شود) و اگر بودجه دارد، با مهربانی از ارتقا به پلن پیشرفته بگو. برنامهٔ فعلی او دست‌نخورده می‌ماند.";

const NOTE_QUOTA_USED =
  "\n\n[سیستم — وضعیت درخواست بازطراحی برنامه]: این قابلیت در طول هر اشتراک فقط یکبار قابل استفاده است و سهمیهٔ این اشتراک کاربر قبلاً مصرف شده است. صادقانه به کاربر بگو: «این قابلیت در طول هر اشتراک فقط یکبار قابل استفاده است و سهمیهٔ شما مصرف شده. برای تغییر فوری برنامه با پشتیبانی در ارتباط باشید» (تیکت در تب پشتیبانی). و حتماً امیدوارش کن: با تمدید اشتراک یا تغییر/ارتقای پلن، سهمیهٔ یک‌بارِ بازطراحی به‌طور خودکار دوباره فعال می‌شود چون هر اشتراک جدید سهمیهٔ تازه دارد. اگر مکمل یا تغییری اعلام کرد، در پرونده ثبت می‌شود ولی برنامه بازسازی نمی‌شود.";

const NOTE_COLLECT_INFO =
  "\n\n[سیستم — بازطراحی برنامه — مرحلهٔ جمع‌آوری اطلاعات]: کاربر درخواست بازطراحی/تغییر کامل برنامه (تمرینی + تغذیه + مکمل) داده و درخواستش در پروندهٔ او ذخیره شد؛ سهمیهٔ یک‌بارِ اشتراکش هنوز مصرف نشده و برنامهٔ جدید هنوز شروع نشده است. دقیقاً این پنج کار را بکن:\n" +
  "۱) اول صادقانه بگو این امکان فقط یکبار در طول اشتراک او فعال است (با تمدید یا تغییر پلن دوباره فعال می‌شود) و بعد از تایید نهاییِ او، کل برنامهٔ تمرینی، تغذیه و مکملش بر اساس دیتای فعلی‌اش از نو ساخته می‌شود — بدون هیچ تغییری در مدت اشتراک یا پلن و بدون نیاز به تکمیل پیش‌نیازها.\n" +
  "۲) با دانش پزشکی و مربیگری خودت، «لیست دقیق تغییرات لازم» را بنویس و به کاربر نشان بده (بر اساس برنامهٔ فعلی‌اش که کامل در پروندهٔ ورزشی توست) — کاربر باید ببیند دقیقاً چه چیزی قرار است عوض شود؛ این لیست مبنای بازطراحی است.\n" +
  "۳) تمام اطلاعات لازم را با او کامل کن: هدف و وزن موردنظر، غذاهای حذفی/علاقه‌مندی، مکمل‌هایی که مصرف می‌کند یا می‌خواهد، محدودیت‌های پزشکی/غذایی/آسیب، روزها و مکان و تجهیزات تمرین، و دقیقاً چه چیزی در برنامهٔ فعلی ناراضی است.\n" +
  "۴) وقتی لیست تغییرات کامل و روشن شد، پیامت را با خط دقیق زیر تمام کن تا سیستم برای کاربر کارت تایید (دکمهٔ «تایید و ساخت برنامهٔ جدید» / «انصراف») نشان دهد:\n" +
  '[PLAN_CHANGE_PROPOSAL summary="خلاصهٔ یک‌خطی تغییرات توافق‌شده"]\n' +
  "خلاصهٔ داخل تگ باید همان تغییرات اصلی توافق‌شده در یک خط باشد. فقط «یک» تگ در هر پاسخ و فقط وقتی که لیست تغییرات را نشان داده‌ای و منتظر تایید نهایی هستی. اگر کاربر به‌جای دکمه، متنی مثل «تایید نهایی» یا «بساز» نوشت، همان مسیر عادی شروع بازطراحی است — تگ دوباره نگذار.\n" +
  "۵) اگر کاربر چیزی را اصلاح کرد، همان را به‌روز کن و دوباره تایید نهایی (با تگ بالا) بگیر.\n" +
  "هرگز نگو برنامه در حال ساخت است — هنوز شروع نشده و سهمیه‌ای هم مصرف نشده.";

const NOTE_PENDING_INFO =
  "\n\n[سیستم — بازطراحی برنامه — در انتظار تایید نهایی]: اطلاعات جدید کاربر به پروندهٔ بازطراحی او اضافه شد (سهمیهٔ یک‌بارش هنوز مصرف نشده). اگر نکتهٔ مهم مبهمی مانده کوتاه بپرس؛ در غیر این صورت از او تایید نهایی صریح بگیر: لیست تغییرات توافق‌شده را کوتاه نشان بده و پیامت را با خط دقیق زیر تمام کن تا کارت تایید برای کاربر نمایش داده شود:\n" +
  '[PLAN_CHANGE_PROPOSAL summary="خلاصهٔ یک‌خطی تغییرات توافق‌شده"]\n' +
  "فقط «یک» تگ در هر پاسخ؛ اگر کاربر متنی مثل «تایید نهایی» یا «بساز» نوشت، همان مسیر عادی شروع بازطراحی است و دیگر تگ نگذار. تا تایید نهایی، برنامهٔ جدید شروع نمی‌شود.";

const NOTE_CANCELLED =
  "\n\n[سیستم — بازطراحی برنامه لغو شد]: کاربر انصراف داده است؛ فرایند بازطراحی برنامه لغو شد و سهمیهٔ یک‌بارِ اشتراک او مصرف نشده است. کوتاه و مهربان تأیید کن و بگو هر وقت خواست می‌تواند دوباره در همین چت بنویسد «بازطراحی برنامه». برنامهٔ فعلی او سر جای خودش است.";

const NOTE_NO_SUBSCRIPTION_ROW =
  "\n\n[سیستم — وضعیت درخواست بازطراحی برنامه]: درخواست کاربر ذخیره شد اما اشتراک فعلی او به‌صورت رکورد در سیستم ثبت نیست و سهمیهٔ بازطراحی قابل فعال‌سازی نیست. صادقانه بگو برای فعال‌شدن این قابلیت باید با پشتیبانی (تیکت) در ارتباط باشد.";

/**
 * v78 — جریان کامل «بازطراحی برنامه (یکبار در طول اشتراک) از چت»:
 *
 *   (a) گیت پلن: فقط advanced/ultimate — در غیر این صورت یادداشت صادقانه، بدون
 *       هیچ تغییر وضعیت و بدون بازتولید (اعلام مکملِ ساده مثل v77 برای همهٔ پلن‌ها برقرار است).
 *   (b) سهمیه مصرف‌شده (planRegenUsed) → یادداشت صادقانه، بدون بازتولید.
 *   (c) نیت تغییر + منتظر-تایید نیست → ذخیرهٔ درخواست (nutritionNotes/currentSupplements)
 *       + planRegenPending=true + یادداشت جمع‌آوری اطلاعات (بدون شروع تولید!).
 *   (d) منتظر-تایید + تایید نهایی → ذخیرهٔ نکات نهایی، شروع بازتولید واقعی
 *       (source=chat_request) و سپس قفل سهمیه: started/already_generating →
 *       planRegenUsed=true و pending=false. اگر شروع به هر دلیل ممکن نشد
 *       (مهم‌ترینش سقف روزانهٔ ۵/۲۴ساعت که به‌عنوان گارد نهایی برقرار می‌ماند)
 *       سهمیه مصرف نمی‌شود و pending می‌ماند تا کاربر بعداً دوباره تایید بدهد —
 *       سهمیهٔ کاربر هرگز بدون بازتولیدِ واقعی نمی‌سوزد.
 *   (e) منتظر-تایید + انصراف → فقط pending=false (سهمیه دست‌نخورده).
 *   (f) منتظر-تایید + ادامهٔ دادن اطلاعات (بدون تایید/انصراف) → ادغام در نکات +
 *       یادداشت کوتاه «تایید نهایی بگیر».
 *   برای کاربرِ واجد شرایط، خط وضعیت قابلیت (buildPlanRegenStateNote) همیشه به
 *   systemNote چسبانده می‌شود تا مدل در هر پیامی وضعیت را بداند (و درخواست
 *   پیام معمولی هم بدون نیت، handled=false با همین خط وضعیت برمی‌گردد).
 * هرگز throw نمی‌کند — شکست فقط یعنی بدون یادداشت سیستمی ادامه می‌دهیم.
 */
export type PlanChangeApplyOptions = {
  /**
   * v111 — خلاصهٔ تغییرات توافق‌شده (مثلاً از تگ [PLAN_CHANGE_PROPOSAL] یا
   * بدنهٔ درخواست تایید) — به startProgramGenerationInBackground پاس داده
   * می‌شود و در changeSummary نسخهٔ جدید برنامه + پیام خلاصهٔ چت ذخیره می‌شود.
   * سقف سخت ۳۰۰ نویسه (اینجا هم بریده می‌شود تا هر مسیر فراخوانی امن باشد).
   */
  changeSummary?: string | null;
};

/** سقف کاراکتری خلاصهٔ تغییرات (هم‌سقف buildChangeSummary در program-generation) */
export const PLAN_CHANGE_SUMMARY_MAX_CHARS = 300;

/** پاک‌سازی خلاصهٔ تغییرات ورودی (trim + سقف سخت) */
export function sanitizePlanChangeSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > PLAN_CHANGE_SUMMARY_MAX_CHARS
    ? s.slice(0, PLAN_CHANGE_SUMMARY_MAX_CHARS).trimEnd() + "…"
    : s;
}

/**
 * v157 — حفرهٔ ۱ (مسیر تاییدِ تایپ‌شده): وقتی کاربر به‌جای دکمهٔ کارت،
 * «تایید نهایی» را تایپ می‌کند، مسیر چت changeSummary را پاس نمی‌دهد و
 * ممنوعیت‌های توافق‌شدهٔ پیشنهاد قبلی هیچ‌وقت ذخیره/مسلح نمی‌شدند (ریشهٔ
 * اصلی تیکت مصطفی خوشبخت: تایید او تایپی بود و برنامهٔ ساخته‌شده با همان
 * بارفیکس/شنا/اسکات به پرس قدیمی برگشت).
 * راه‌حل: آخرین پیام دستیار حاوی تگ [PLAN_CHANGE_PROPOSAL summary="…"] را
 * (در پنجرهٔ ۱۴ روز) می‌یابیم و خلاصهٔ توافق‌شدهٔ همان را به‌عنوان
 * changeSummary مسیر تایید متنی استفاده می‌کنیم — هم‌مسیر با دکمهٔ کارت.
 */
export async function findLastProposalSummary(userId: string): Promise<string | null> {
  try {
    const windowAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const msgs = await db.chatMessage.findMany({
      where: {
        userId,
        role: "assistant",
        createdAt: { gte: windowAgo },
        content: { contains: "[PLAN_CHANGE_PROPOSAL" },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true },
    });
    for (const m of msgs) {
      const m2 = /\[PLAN_CHANGE_PROPOSAL\s+summary="([^"]*)"/u.exec(m.content);
      const s = m2?.[1]?.trim();
      if (s) return sanitizePlanChangeSummary(s);
    }
    return null;
  } catch (err) {
    console.warn("[plan-change-intent] findLastProposalSummary failed (non-fatal):", err);
    return null;
  }
}

/**
 * v149 — تیکت مالک: «قرار بود اگر در چت با فیتاپ درخواست بازطراحی برنامه داده
 * میشه دقیقاً و عیناً برنامه عین درخواست ورزشکار نوشته بشه».
 * درخواست ساختاری چیدمان روزها (مثل «۳ روز بالاتنه، ۱ روز پایین تنه») را از
 * متن کاربر/خلاصهٔ توافق‌شده استخراج و در Subscription.planRegenRequest ذخیره
 * می‌کند تا در تولید برنامه به‌صورت دیرکتیو الزامی تزریق و بعد از ذخیرهٔ موفق
 * مصرف (پاک) شود. در صورت نبود رکورد اشتراک، فقط خط کانونی به nutritionNotes
 * می‌چسبد (فال‌بک — پارسرِ سمت تولید از همان هم می‌خواند).
 * همیشه silently-best-effort — هرگز جریان چت را نمی‌شکند.
 */
async function persistSplitRequestSpec(
  userId: string,
  subscriptionId: string | null,
  ...texts: Array<string | null | undefined>
): Promise<RequestedSplitSpec | null> {
  try {
    let parsed: ReturnType<typeof parseRequestedSplitFromText> = null;
    let sourceText = "";
    for (const t of texts) {
      if (!t || typeof t !== "string") continue;
      parsed = parseRequestedSplitFromText(t);
      if (parsed) {
        sourceText = t;
        break;
      }
    }
    // v149 — ممنوعیت‌ها (حذف حرکات/مواد) هم از همان متن‌ها استخراج و لنگر می‌شوند —
    // حتی وقتی درخواست ساختاریِ چیدمان (اسپک) ندارد (تیکت باگ بزرگ بازطراحی).
    const constraints = parseRedesignConstraintsFromText(...texts);
    if (!parsed && !constraints) return null;
    const firstText = texts.find((t): t is string => typeof t === "string" && t.trim().length > 0) ?? "";
    const payload = JSON.stringify({
      ...(parsed ? { spec: parsed.spec } : {}),
      ...(constraints ? { constraints } : {}),
      raw: (sourceText || firstText).trim().slice(0, 400),
      at: new Date().toISOString(),
    });
    if (subscriptionId) {
      await db.subscription.update({
        where: { id: subscriptionId },
        data: { planRegenRequest: payload },
      });
    } else {
      // فال‌بک: خط کانونی ماندگار در nutritionNotes (تا پارسر سمت تولید بگیردش)
      const profile = await db.onboardingProfile.findUnique({ where: { userId } });
      if (profile) {
        const marker = parsed
          ? `[چیدمان درخواستی کاربر: ${parsed.summary}]`
          : `[موارد حذفی درخواستی کاربر: ${[
              ...constraints!.forbiddenMovements,
              ...constraints!.forbiddenFoods,
              ...constraints!.forbiddenSupplements,
            ].slice(0, 12).join("، ")}]`;
        const existing = (profile.nutritionNotes ?? "").trim();
        if (!existing.includes(marker)) {
          const merged = existing ? `${existing}\n${marker}` : marker;
          await db.onboardingProfile.update({
            where: { userId },
            data: {
              nutritionNotes:
                merged.length > NUTRITION_NOTES_MAX_CHARS
                  ? merged.slice(merged.length - NUTRITION_NOTES_MAX_CHARS)
                  : merged,
            },
          });
        }
      }
    }
    console.log(
      `[plan-change-intent] v149 redesign request captured: ` +
        `split=${parsed ? parsed.summary : "none"}, ` +
        `movements=${constraints ? constraints.forbiddenMovements.length : 0}, ` +
        `foods=${constraints ? constraints.forbiddenFoods.length : 0}, ` +
        `supplements=${constraints ? constraints.forbiddenSupplements.length : 0} (sub=${subscriptionId ?? "none"})`
    );
    return parsed?.spec ?? null;
  } catch (err) {
    console.warn("[plan-change-intent] v149 persistSplitRequestSpec failed (non-fatal):", err);
    return null;
  }
}

export async function applyPlanChangeRequest(
  userId: string,
  message: string,
  opts?: PlanChangeApplyOptions
): Promise<PlanChangeApplyResult> {
  const detection = detectPlanChangeIntent(message);
  const confirmation = detectPlanChangeConfirmation(message);

  let systemNote = "";
  try {
    const state = await getPlanRegenState(userId);
    const stateNote = buildPlanRegenStateNote(state);

    // ═══ (a) گیت پلن — فقط پیشرفته/حرفه‌ای ═══
    if (!state.eligible) {
      // فقط نیتِ تغییر برنامه؛ تاییدِ تنها (مثل «بساز» بدون زمینه) اینجا معنا ندارد
      if (detection.isPlanChange) {
        return { handled: true, systemNote: NOTE_NOT_ELIGIBLE, detection, regenState: state };
      }
      // اعلام مکملِ ساده — مثل v77 برای همهٔ پلن‌ها برقرار می‌ماند
      if (detection.supplementMentions.length > 0) {
        const supplementNote = await persistSupplementMentions(userId, detection.supplementMentions);
        return { handled: true, systemNote: supplementNote, detection, regenState: state };
      }
      return { handled: false, systemNote: "", detection, regenState: state };
    }

    // ─── از اینجا به بعد کاربر واجد شرایط است — خط وضعیت همیشه تزریق می‌شود ───

    // ═══ (b) سهمیه مصرف شده ═══
    if (state.used) {
      if (detection.supplementMentions.length > 0) {
        const supplementNote = await persistSupplementMentions(userId, detection.supplementMentions);
        return { handled: true, systemNote: supplementNote + stateNote, detection, regenState: state };
      }
      if (detection.isPlanChange) {
        return { handled: true, systemNote: NOTE_QUOTA_USED + stateNote, detection, regenState: state };
      }
      // پیام معمولی — فقط خط وضعیت به مدل برسد
      return { handled: false, systemNote: stateNote, detection, regenState: state };
    }

    // ═══ (e) انصراف — اولویت بر همه (تایید نمی‌کنم ≠ تایید) ═══
    if (state.pending && confirmation.cancelled) {
      if (state.subscriptionId) {
        await db.subscription.update({
          where: { id: state.subscriptionId },
          data: { planRegenPending: false },
        });
      }
      return {
        handled: true,
        systemNote: NOTE_CANCELLED + buildPlanRegenStateNote({ ...state, pending: false }),
        detection,
        regenState: { ...state, pending: false },
      };
    }

    // ═══ (d) تایید نهایی در حالت انتظار → شروع بازتولید واقعی ═══
    if (state.pending && confirmation.confirmed) {
      // ذخیرهٔ نکات نهایی همین پیام (اگر اطلاعات تازه‌ای همراه تایید باشد)
      await persistRequestNotes(userId, message, detection);
      // v157 — حفرهٔ ۱: اگر changeSummary از فراخوان نیامده (تاییدِ تایپیِ
      // «تایید نهایی» در چت)، خلاصهٔ توافق‌شده از آخرین تگ پیشنهاد دستیار
      // بازیابی می‌شود تا ممنوعیت‌های توافق‌شده عیناً ذخیره و مسلح شوند.
      const effectiveSummary = opts?.changeSummary ?? (await findLastProposalSummary(userId));
      // v149 — استخراج/به‌روزرسانی درخواست ساختاری چیدمان از تایید/خلاصهٔ توافق
      // (مسیر دکمهٔ کارت: پیام مصنوعی «تایید نهایی» است و چیدمان در changeSummary می‌آید)
      await persistSplitRequestSpec(userId, state.subscriptionId, effectiveSummary, message);
      // v157 — ضبط ماندگار ممنوعیت‌های توافق‌شده (هرگز منقضی نمی‌شود؛ در همهٔ
      // تولیدهای بعدی حتی تمدید/چکاپ/بازنویسی مدیر هم اعمال می‌شود)
      await capturePersistentExclusionsFromText(userId, effectiveSummary, message);

      const { startProgramGenerationInBackground } = await import(
        "@/lib/fitness/program-generation"
      );
      const gen = await startProgramGenerationInBackground(userId, {
        source: "chat_request",
        // v111 — خلاصهٔ تغییرات توافق‌شده (تگ تایید / مسیر API) — سازگار با عقب
        // v157 — در مسیر تاییدیِ تایپی از تگ پیشنهاد بازیابی می‌شود
        changeSummary: sanitizePlanChangeSummary(effectiveSummary),
      });

      if (gen.started || gen.reason === "already_generating") {
        // قفل سهمیه فقط وقتی بازتولید واقعاً در جریان است
        // v150 — سهمیهٔ اضافهٔ اهدایی مدیر: اگر یک‌بارِ پایه قبلاً مصرف شده بود
        // (state.used=false فقط به لطف extra>0)، این مصرف از extra کم می‌شود.
        // (اینجا فقط وقتی می‌رسیم که state.used=false — پس decrement فقط وقتی
        // رخ می‌دهد که base used=true و extra>0 باشد → هرگز منفی نمی‌شود.)
        if (state.subscriptionId) {
          const holderRow = await db.subscription.findUnique({
            where: { id: state.subscriptionId },
            select: { planRegenUsed: true },
          });
          const consumeFromExtra = holderRow?.planRegenUsed === true;
          await db.subscription.update({
            where: { id: state.subscriptionId },
            data: {
              planRegenUsed: true,
              planRegenPending: false,
              // مصرف از بونوس: پایه قبلاً used=true بوده — یک واحد از extra کم کن
              ...(consumeFromExtra ? { planRegenExtra: { decrement: 1 } } : {}),
            },
          });
        }
        const baseNote = gen.started
          ? "\n\n[سیستم — وضعیت درخواست بازتولید برنامه]: تایید نهایی کاربر دریافت شد؛ سهمیهٔ یک‌بارِ بازطراحی اشتراک او همین حالا مصرف شد و بازتولید کامل برنامه (تمرینی + غذایی + مکمل) به‌صورت خودکار آغاز شده است؛ متن درخواست‌های کاربر در پرامپت تولید لحاظ می‌شود. به کاربر کوتاه و صمیمی تأیید بده که برنامهٔ جدید با درخواست‌هایش طی چند دقیقه دیگر در تب‌های تمرین/تغذیه/مکمل جایگزین برنامهٔ فعلی می‌شود و اعلان «برنامه شما آماده شد» دریافت می‌کند. یادآوری کن که این سهمیه در این اشتراک مصرف شده و دفعهٔ بعد برای تغییر برنامه باید با پشتیبانی در ارتباط باشد. هرگز نگو که تغییرات همین حالا روی برنامهٔ فعلی اعمال شده است — برنامهٔ فعلی تا آماده‌شدن نسخهٔ جدید سر جای خودش است."
          : "\n\n[سیستم — وضعیت بازتولید برنامه]: تایید نهایی کاربر دریافت شد و سهمیهٔ یک‌بارِ او همین حالا مصرف شد. بازتولید برنامه برای این کاربر هم‌اکنون در جریان است (شاید از چکاپ یا درخواست قبلی). به کاربر بگو برنامهٔ جدید در حال ساخت است و طی چند دقیقه با اعلان جایگزین می‌شود؛ درخواست‌هایش هم در پرونده ذخیره شده تا در همین بازتولید لحاظ شود.";
        return {
          handled: true,
          systemNote: baseNote,
          detection,
          regenState: { ...state, used: true, pending: false },
        };
      }

      if (gen.reason === "daily_budget") {
        // گارد نهایی سقف روزانه — سهمیهٔ یک‌بارِ کاربر نمی‌سوزد؛ pending می‌ماند
        return {
          handled: true,
          systemNote:
            "\n\n[سیستم — وضعیت بازتولید برنامه]: تایید کاربر دریافت شد اما سقف روزانهٔ بازتولید خودکار (۵ بار در ۲۴ ساعت) پر است. صادقانه به کاربر بگو تاییدش ثبت است و سهمیهٔ یک‌بارش هنوز دست‌نخورده؛ امروز سقف بازتولید پر شده و فردا با نوشتن «تایید نهایی» یا «بساز» در همین چت، بازطراحی شروع می‌شود. پیشنهاد بده اگر عجله دارد از پشتیبانی بخواهد بازتولید دستی بزنند." +
            stateNote,
          detection,
          regenState: state,
        };
      }

      // no_plan / سایر — سهمیه نمی‌سوزد؛ pending می‌ماند
      return {
        handled: true,
        systemNote:
          "\n\n[سیستم — وضعیت بازتولید برنامه]: تایید کاربر دریافت شد اما شروع خودکار بازتولید در این لحظه ممکن نشد. صادقانه بگو تاییدش ثبت است، سهمیه‌اش دست‌نخورده و به‌زودی (یا با کمک پشتیبانی) بازطراحی شروع می‌شود." +
          stateNote,
        detection,
        regenState: state,
      };
    }

    // ═══ (f) ادامهٔ دادن اطلاعات در حالت انتظار (بدون تایید/انصراف) ═══
    if (state.pending) {
      const hasNewInfo =
        detection.isPlanChange ||
        detection.supplementMentions.length > 0 ||
        message.trim().length >= 12;
      if (hasNewInfo) {
        await persistRequestNotes(userId, message, detection);
        // v149 — درخواست ساختاری چیدمان اگر در این پیام باشد ثبت/به‌روز می‌شود
        await persistSplitRequestSpec(userId, state.subscriptionId, message);
        // v157 — ضبط ماندگار ممنوعیت‌های صریح این پیام (مثلاً «شنا حذف بشه»)
        await capturePersistentExclusionsFromText(userId, message);
      }
      return {
        handled: true,
        systemNote:
          (hasNewInfo
            ? NOTE_PENDING_INFO
            : "\n\n[سیستم — بازطراحی برنامه — در انتظار تایید نهایی]: کاربر هنوز تایید نهایی نداده است. از او تایید نهایی صریح بگیر (مثلاً بنویسد «تایید نهایی» یا «بساز»).") +
          stateNote,
        detection,
        regenState: state,
      };
    }

    // ═══ (c) نیت تغییر (حالت انتظار فعال نیست) → جمع‌آوری اطلاعات + قفل pending ═══
    if (detection.isPlanChange) {
      if (!state.subscriptionId) {
        // کاربر واجد شرایط ولی بدون رکورد اشتراک (فال‌بک ردیف User) — سهمیه‌ای نیست که قفل شود
        await persistRequestNotes(userId, message, detection);
        return {
          handled: true,
          systemNote: NOTE_NO_SUBSCRIPTION_ROW + stateNote,
          detection,
          regenState: state,
        };
      }
      await persistRequestNotes(userId, message, detection);
      // v149 — درخواست ساختاری چیدمان (مثل «۳ روز بالاتنه، ۱ روز پایین تنه»)
      await persistSplitRequestSpec(userId, state.subscriptionId, message);
      // v157 — ضبط ماندگار ممنوعیت‌های صریح این پیام («بارفیکس و شنا حذف بشه»)
      await capturePersistentExclusionsFromText(userId, message);
      await db.subscription.update({
        where: { id: state.subscriptionId },
        data: { planRegenPending: true },
      });
      return {
        handled: true,
        systemNote: NOTE_COLLECT_INFO + stateNote,
        detection,
        regenState: { ...state, pending: true },
      };
    }

    // اعلام مکملِ ساده — مثل v77 (بدون pending، بدون بازتولید)
    if (detection.supplementMentions.length > 0) {
      const supplementNote = await persistSupplementMentions(userId, detection.supplementMentions);
      return { handled: true, systemNote: supplementNote + stateNote, detection, regenState: state };
    }

    // پیام معمولیِ کاربر واجد شرایط — فقط خط وضعیت به مدل برسد (بازتولیدِ بدون نیت ممنوع)
    return { handled: false, systemNote: stateNote, detection, regenState: state };
  } catch (err) {
    console.error("[plan-change-intent] apply failed:", err);
    return { handled: false, systemNote: "", detection };
  }
}

/** ذخیرهٔ ماندگار متن درخواست کاربر در nutritionNotes (سقف سخت ۲۴۰۰ نویسه) */
async function persistRequestNotes(
  userId: string,
  message: string,
  detection: PlanChangeDetection
): Promise<void> {
  if (!detection.isPlanChange && detection.supplementMentions.length === 0 && message.trim().length < 12) {
    return; // چیزی برای ذخیره نیست
  }
  const profile = await db.onboardingProfile.findUnique({ where: { userId } });
  if (!profile) return;
  const stamp = faNowStamp();
  const entry = `[درخواست بازطراحی برنامه — چت با فیتاپ، ${stamp}]: ${message.trim().slice(0, 400)}`;
  const existing = (profile.nutritionNotes ?? "").trim();
  const merged = existing ? `${existing}\n${entry}` : entry;
  const nutritionNotes =
    merged.length > NUTRITION_NOTES_MAX_CHARS
      ? merged.slice(merged.length - NUTRITION_NOTES_MAX_CHARS)
      : merged;
  await db.onboardingProfile.update({ where: { userId }, data: { nutritionNotes } });
}

/** ادغام مکمل‌های اعلامی در currentSupplements — یادداشت سیستمی v77 برمی‌گرداند */
async function persistSupplementMentions(
  userId: string,
  mentions: string[]
): Promise<string> {
  const profile = await db.onboardingProfile.findUnique({ where: { userId } });
  if (!profile) return "";
  const existing = parseStringList(profile.currentSupplements);
  const mergedSet = new Set<string>(existing);
  for (const s of mentions) mergedSet.add(s);
  const merged = Array.from(mergedSet).slice(0, SUPPLEMENTS_MAX_ITEMS);
  if (merged.join("،") !== existing.join("،")) {
    await db.onboardingProfile.update({
      where: { userId },
      data: { currentSupplements: merged.join("،") },
    });
  }
  return "\n\n[سیستم — وضعیت پرونده]: مکمل‌های اعلامی کاربر به پروندهٔ مکمل‌های او (currentSupplements) اضافه شد و در پرامپت تولید/به‌روزرسانی برنامه‌های بعدی (مخصوصاً استک مکمل) لحاظ می‌شود. کوتاه تأیید کن؛ اگر کاربر خواست مکمل‌ها وارد برنامهٔ فعلی شوند، بگو با بازطراحی برنامه در همین چت یا با چکاپ دوره‌ای اعمال می‌شود.";
}
