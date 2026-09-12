import OpenAI from "openai";
import { db } from "@/lib/db";
import type {
  OnboardingData,
  WorkoutPlanContent,
  MealPlanContent,
  Plan,
} from "./types";
import {
  GOAL_LABELS, ACTIVITY_LABELS, GENDER_LABELS, WORKOUT_PLACE_LABELS, DIET_LABELS,
  PERSIAN_WEEKDAYS, PLAN_LABELS, getCapabilities, TRAINING_EXPERIENCE_LABELS,
  BODY_FRAME_LABELS, WORKOUT_TIME_LABELS, PREFERRED_CUISINE_LABELS, MEDICAL_CONDITION_LABELS,
  DISCIPLINE_LABELS, equipmentFa,
} from "./types";
import { bloodTestPromptSummary } from "./blood-tests";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { logAiUsage } from "@/lib/fitness/costs";

const execFileAsync = promisify(execFile);

// AvalAI OpenAI-compatible client — lazy initialization
// در زمان build ساخته نمی‌شود تا خطای Missing credentials ندهد
let _avalaiClient: OpenAI | null = null;

export function getAvalaiClient(): OpenAI {
  if (!_avalaiClient) {
    _avalaiClient = new OpenAI({
      apiKey: process.env.AVALAI_API_KEY || "placeholder-for-build",
      baseURL: process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1",
      // ⚠️ بدون این دو گزینه، تایم‌اوت پیش‌فرض SDK ۱۰ دقیقه است و کال‌های کند
      // (که کلادفلرِ جلوی api.avalai.ir با 504 می‌کُشد) کل مسیر تولید برنامه را قفل می‌کنند.
      timeout: 165_000, // ۱۶۵ ثانیه — تست واقعی AvalAI: تولید برنامه کامل با reasoning low ≈ ۹۷-۱۱۰s؛ سقف گیت‌وی بالاتر از ۱۱۰s است
      maxRetries: 1, // یک retry خودکار برای خطاهای گذرا (429/5xx) — نه بیشتر، تا سریع fail شود
    });
  }
  return _avalaiClient;
}

export const TEXT_MODEL = process.env.AVALAI_TEXT_MODEL || "deepseek-v4.1-flash";
export const VISION_MODEL = process.env.AVALAI_VISION_MODEL || "deepseek-v4.1-flash";

// ═══════════════════════════════════════════════════════════════════════════
// v73 — مهاجرت کامل به DeepSeek V4.1 Flash (دیریکتیو مالک):
// «مدل جدید دیپ‌سیک آمده که هم قوی‌تره و هم از عکس پشتیبانی می‌کنه. می‌خوام
//  کل سیستم دیگه با این هوش مصنوعی بره جلو. تولید برنامه باید با میزان تفکر
//  مکس و بقیه موارد همگی با low باشه.»
//
// مدل deepseek-v4.1-flash از طریق AvalAI (api.avalai.ir/v1/chat/completions):
//   • بینایی بومی (native vision) — image_url با data URL می‌پذیرد
//   • حالت‌های تفکری/غیرتفکری — reasoning_effort
//   • فراخوانی ابزار، خروجی JSON، کش پرامپت
//   • ورودی حداکثر ۱M توکن / خروجی تا 393K — قیمت: $0.15 ورودی / $0.60 خروجی
//     (هر ۱M توکن؛ کش پرامپت $0.003) — تعرفهٔ ثابت AvalAI
//
// ⚠️ نکتهٔ حیاتی: DeepSeek مدل‌های قدیمی V4-Flash و V4-Flash-Vision-Exp را
// بازنشسته کرده است — بنابراین فال‌بک‌های قدیمی (deepseek-v4-flash برای متن و
// gemini-3.5-flash برای ویژن) به مدلِ اثبات‌شدهٔ gemini-3.8-flash منتقل شدند
// تا قاعدهٔ «هرگز بی‌پاسخ نماند» با مدل مرده شکسته نشود.
// تشخیص ویژن خودکار است (پیام شامل image_url باشد) — لازم نیست هر call-site
// دستی مشخص کند. هر شکستِ نهایی (پاسخ خالی/نامعتبر، 4xx، 5xx، تایم‌اوت) بعد از
// اتمام تلاش‌های همان مدل، به مدل فال‌بک می‌رود — در createResilientCompletion
// و createChatCompletionWithRetry (دو نقطهٔ تماس تنها با avalaiClient در سیستم،
// علاوه بر مسیر تولید برنامه که فال‌بک اختصاصی خودش را دارد).
// ═══════════════════════════════════════════════════════════════════════════
export const FALLBACK_VISION_MODEL =
  process.env.AVALAI_FALLBACK_VISION_MODEL || "gemini-3.8-flash";
export const FALLBACK_TEXT_MODEL =
  process.env.AVALAI_FALLBACK_TEXT_MODEL || "gemini-3.8-flash";

// ═══════════════════════════════════════════════════════════════════════════
// v73 — مدل اختصاصی چت نیکا و تحلیل آنبوردینگ (مهاجرت به V4.1 Flash)
//   • چت نیکا: reasoning_effort=low (پاسخ سریع فروش/راهنما — تجربهٔ چت)
//   • تحلیل آنبوردینگ: سطح پیش‌فرض (low) — تحلیل ۳ پاراگرافی سریع
// فال‌بک هر دو: اگر deepseek به هر دلیلی نشد → TEXT_MODEL (فال‌بک سراسری).
// ═══════════════════════════════════════════════════════════════════════════
export const NIKA_MODEL = process.env.AVALAI_NIKA_MODEL || "deepseek-v4.1-flash";
export const ONBOARDING_ANALYSIS_MODEL =
  process.env.AVALAI_ONBOARDING_MODEL || "deepseek-v4.1-flash";

// ═══════════════════════════════════════════════════════════════════════════
// v73 — مدل وظایف متنی عمومی (ادامهٔ مسیر v58→v69→v72 — حالا روی V4.1 Flash)
// همهٔ وظایف متنی (چت مربی، تحلیل چکاپ/جامع/تاریخچه، جایگزین غذا، دستیار مدیر،
// سئو/مقاله، تحلیل نظرسنجی) روی همین مدل با تفکر low اجرا می‌شوند.
// دست‌نخورده (ضروری برای کارکرد درست — مدل‌های تخصصی جدا):
//   • تولید برنامهٔ تمرینی/غذایی — PLAN_MODEL (deepseek-v4.1-flash با تفکر مکس)
//   • تولید تصویر — مدل تصویری (gemini-3.1-flash-lite-image)
//   • STT ویس کاربر — whisper → فال‌بک gemini (v71)
// ═══════════════════════════════════════════════════════════════════════════
export const TEXT_TASK_MODEL = process.env.AVALAI_TEXT_TASK_MODEL || "deepseek-v4.1-flash";

// ═══════════════════════════════════════════════════════════════════════════
// v73 — مدل تولید برنامه (دیریکتیو مالک):
// «تولید برنامه باید با میزان تفکر مکس و بقیه موارد همگی با low باشه.»
// از TEXT_MODEL جدا شده تا تغییر تصادفی AVALAI_TEXT_MODEL در envِ سرور،
// مسیر گران‌ترین و حساس‌ترین کال سیستم را خراب نکند.
// ═══════════════════════════════════════════════════════════════════════════
export const PLAN_MODEL = process.env.AVALAI_PLAN_MODEL || "deepseek-v4.1-flash";
export const FALLBACK_PLAN_MODEL =
  process.env.AVALAI_FALLBACK_PLAN_MODEL || "gemini-3.8-flash";

/** تشخیص درخواست ویژن — آیا بعضی پیام‌ها شامل تصویر (image_url) هستند؟ */
function isVisionRequest(params: Record<string, unknown>): boolean {
  const messages = params.messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => {
    if (!m || typeof m !== "object") return false;
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) return false;
    return content.some(
      (p) =>
        p &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "image_url"
    );
  });
}

/**
 * مدل فال‌بک مناسب این درخواست — null یعنی فال‌بک معنا ندارد
 * (خودِ درخواست از قبل روی مدل فال‌بک است یا مدل فال‌بک تنظیم نشده).
 */
function fallbackModelFor(params: Record<string, unknown>): string | null {
  const model = typeof params.model === "string" ? params.model : TEXT_MODEL;
  // v58 — اولویت با فال‌بکِ صریحِ همان فراخوانی (fallback_model — مثل چت نیکا
  // و تحلیل آنبوردینگ که مدل اصلی deepseek است و فال‌بک‌شان gemini)؛ بعد تشخیص
  // خودکار ویژن/متن. این پارامتر داخلی است و هرگز به API ارسال نمی‌شود.
  const explicit =
    typeof params.fallback_model === "string" ? params.fallback_model.trim() : "";
  const fb = explicit || (isVisionRequest(params) ? FALLBACK_VISION_MODEL : FALLBACK_TEXT_MODEL);
  return fb && fb !== model ? fb : null;
}

/**
 * ساخت پارامترهای نسخهٔ فال‌بک — فقط مدل عوض می‌شود؛ برای مقصد gemini-3.x،
 * reasoning_effort (اگر هست) هم‌زمان به extra_body.thinkingConfig هم برده
 * می‌شود (هم‌سان با buildPlanParams) تا سطح استدلال در پروکسی gemini گم نشود.
 */
function withFallbackModel(
  params: Record<string, unknown>,
  fallbackModel: string
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params, model: fallbackModel };
  const effort = next.reasoning_effort;
  if (effort && isGemini3Model(fallbackModel)) {
    const prevExtra = (next.extra_body ?? {}) as Record<string, unknown>;
    const prevConfig = (prevExtra.generationConfig ?? {}) as Record<string, unknown>;
    next.extra_body = {
      ...prevExtra,
      generationConfig: {
        ...prevConfig,
        thinkingConfig: { ...(prevConfig.thinkingConfig as object | undefined), thinkingLevel: effort },
      },
    };
  }
  return next;
}

/**
 * تبدیل عدد میلادی به سال هجری شمسی (تقریبی، برای نمایش سال کافی است).
 * الگوریتم: سال میلادی - 621 (با تنظیم برای قبل/بعد از نوروز).
 * مثال: 2026 - 621 = 1405
 */
function gregorianToJalaliYear(gYear: number): number {
  const now = new Date();
  // نوروز معمولاً 20 یا 21 مارس است. اگر قبل از 21 مارس هستیم، سال شمسی یکی کمتر است.
  const mar21 = new Date(gYear, 2, 21); // ماه 2 = مارس (0-indexed)
  return now >= mar21 ? gYear - 621 : gYear - 622;
}

/**
 * دایرکتیو سیستم — شامل برند و سال جاری.
 *
 * این دایرکتیو به‌صورت پویا ساخته می‌شود تا سال جاری همیشه درست باشد
 * (میلادی و هجری شمسی). مدل هرگز نباید سال قدیمی (مثلاً ۱۴۰۳، ۱۴۰۴، 2024، 2025)
 * را در محتوای مقالات، پاسخ‌ها یا هر جای سیستم استفاده کند.
 *
 * قوانین:
 *  - برند: «فیتاپ» (فارسی) یا «FitUp» (انگلیسی) — ممنوع: fitup، fittap، ...
 *  - سال جاری: همیشه به‌صورت پویا محاسبه می‌شود (میلادی + شمسی).
 */
export function getSystemDirectives(): string {
  const now = new Date();
  const gYear = now.getFullYear();
  const jYear = gregorianToJalaliYear(gYear);
  // تبدیل به اعداد فارسی
  const faGYear = String(gYear).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  const faJYear = String(jYear).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

  return `قوانین مهم سیستم:

۱) برند: نام این پلتفرم در متن فارسی همیشه و فقط «فیتاپ» نوشته می‌شود و در متن انگلیسی همیشه «FitUp» (با F و U بزرگ). هرگز نام برند را به‌صورت fitup، Fitup، fittup، Fittup، fittap یا Fittap ننویس.

۲) سال جاری: ${faJYear} هجری شمسی و ${faGYear} میلادی است. سال را فقط جایی به کار ببر که واقعاً لازم است:
- ❌ هرگز سال را به تایتل (عنوان) مقالات، عناوین سئو (seoTitle) یا هدینگ‌ها اضافه نکن، مگر اینکه کلمه کلیدی اصلی خودش شامل سال باشد (مثلاً «بهترین اپلیکیشن بدنسازی ۲۰۲۶»).
- ❌ سال را به عنوان یک پسوند خودکار به هر موضوعی اضافه نکن (مثلاً «راهنمای کامل پرس سینه در سال ۱۴۰۵» اشتباه است).
- ✅ فقط وقتی در متن بدنه به یک رویداد، آمار یا تاریخ مشخص اشاره می‌کنی و سال برای درک آن ضروری است، از سال جاری استفاده کن.
- ✅ اگر کاربر مستقیماً درباره سال می‌پرسد یا مقاله درباره یک موضوع time-sensitive (مثل «بهترین اپلیکیشن‌های ${faGYear}») است، سال جاری را ذکر کن.
- ⚠️ هرگز از سال‌های قدیمی (۱۴۰۳، ۱۴۰۴، 1403، 1404، 2024، 2025) استفاده نکن.

۳) محرمانگی هویت فنی (بسیار مهم): تو «فیتاپ هوشمند» هستی — هوش مصنوعی اختصاصی خود فیتاپ. اگر کاربر دربارهٔ مدل، سرویس، شرکت یا فناوری زیربنایی‌ات پرسید، فقط بگو که «فیتاپ هوشمندِ فیتاپ» هستی و برای او کافی است. هرگز و تحت هیچ شرایطی نام هیچ مدل یا سرویس یا شرکت هوش مصنوعی خارجی (مثل DeepSeek، Gemini، GPT، OpenAI، Claude، AvalAI، Whisper و امثال آن) را ذکر نکن، تأیید یا رد نکن و دربارهٔ معماری فنی، هزینهٔ توکن، کلید یا جزئیات داخلی سیستم حرفی نزن. این اطلاعات محرمانهٔ فیتاپ است.

۴) زبان فارسی سلیس و روان (بسیار مهم): همهٔ پاسخ‌ها، برنامه‌ها و تحلیل‌ها فقط به فارسیِ روان، صمیمی و قابل‌فهم برای کاربر ایرانی نوشته می‌شوند. از واژه‌های بیگانه و اصطلاحات تخصصیِ ناآشنا که کاربر عادی ایرانی به‌ندرت شنیده استفاده نکن و معادل فارسی رایج را به‌کار ببر. معادل‌های الزامی:
- ❌ «پوسچر» → ✅ «فرم بدن» یا «وضعیت بدن» (هرگز پوسچر ننویس)
- ❌ «فانکشنال» → ✅ «کاربردی»
- ❌ «موبیلیتی» → ✅ «انعطاف و دامنه حرکتی»
- ❌ «استابیلیتی» / «استابلایزر» → ✅ «تعادل و ثبات»
- ❌ «پروتکل» → ✅ «برنامهٔ عملی» یا «روش»
- ❌ «اینتنسیتی» → ✅ «شدت تمرین»
- واژه‌های فارسی‌شدهٔ رایج و آشنا مثل «اسکوات، ددلیفت، پرس، دمبل، هالتر، کاردیو، پروتئین، کراتین» اشکالی ندارند و می‌توانند استفاده شوند.
هرگز جملات را لحن ترجمه‌ای و خشک ننویس؛ طبیعی و شیوا بنویس.

`;
}

/**
 * @deprecated از `withSystemDirectives` استفاده کنید.
 * برای backward compatibility نگه داشته شده است.
 */
export const BRAND_DIRECTIVE = getSystemDirectives();

/**
 * تزریق دایرکتیو سیستم (برند + سال جاری) به ابتدای یک system prompt.
 * اگر prompt قبلاً تزریق شده باشد، دوباره تزریق نمی‌کند.
 *
 * @deprecated از `withSystemDirectives` استفاده کنید.
 * برای backward compatibility نگه داشته شده است.
 */
export function withBrandDirective(systemPrompt: string): string {
  return withSystemDirectives(systemPrompt);
}

/**
 * تزریق دایرکتیو سیستم (برند + سال جاری) به ابتدای یک system prompt.
 * اگر prompt قبلاً تزریق شده باشد، دوباره تزریق نمی‌کند.
 *
 * این تابع تمام دایرکتیوهای سیستمی را شامل می‌شود:
 *  - قانون برند (فیتاپ / FitUp)
 *  - قانون سال جاری (میلادی و شمسی)
 */
export function withSystemDirectives(systemPrompt: string): string {
  const directives = getSystemDirectives();
  if (!systemPrompt) return directives;
  // چک کردن idempotency: اگر prompt با "قوانین مهم سیستم:" شروع می‌شود، یعنی قبلاً تزریق شده.
  if (systemPrompt.startsWith("قوانین مهم سیستم:")) return systemPrompt;
  // backward compatibility: اگر با دایرکتیو قدیمی برند شروع شده، کل دایرکتیو جدید را جایگزین می‌کنیم
  if (systemPrompt.startsWith("قانون مهم برند:")) {
    // حذف دایرکتیو قدیمی و تزریق جدید
    const withoutOldDirective = systemPrompt.replace(/^قانون مهم برند:[^\n]*\n\n/, "");
    return directives + withoutOldDirective;
  }
  return directives + systemPrompt;
}

/**
 * آیا مدل از خانواده gemini-3.x است؟
 * این مدل‌ها نیاز به پارامترهای مخصوص دارند (thinkingConfig، maxOutputTokens).
 * شامل gemini-3.0، gemini-3.5، gemini-3.6، gemini-3.7 و غیره.
 */
export function isGemini3Model(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("gemini-3") || m.includes("gemini-3.5") || m.includes("gemini-3.0") || m.includes("gemini-3.6") || m.includes("gemini-3.7");
}

/**
 * آیا مدل از خانواده deepseek-v4 است؟
 * این مدل‌ها از پارامتر reasoning_effort (low | high | max) پشتیبانی می‌کنند.
 * deepseek-v4.1-flash (V4.1 Flash — بینایی بومی + حالت تفکری) نمونهٔ فعلی این
 * خانواده است؛ الگوی نام «deepseek-v4*» هر دو نسل را پوشش می‌دهد.
 */
export function isDeepseekV4Model(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith("deepseek-v4") || m.includes("deepseek-v4");
}

/**
 * آداپتور ویژن deepseek-v4.x — تبدیل فرمت OpenAI به Anthropic (/v1/messages).
 *
 * چرا لازم شد؟ تست زندهٔ v73 (اسکریپت probe-ai-vision-v73.ts):
 *   • chat/completions + image_url (data URL و http URL هر دو): مدل تصویر را
 *     نمی‌بیند — AvalAI بلاک تصویر را به مدل deepseek نمی‌رساند (200 ولی کور).
 *   • chat/completions + type:image: 400 دائمی (فرمت غیر OpenAI).
 *   • /v1/messages + {type:"image", source:{type:"base64"}}: ✅ واقعاً کار می‌کند —
 *     مدل تصویر را توصیف کرد، کش پرامپت هم فعال است (cache_read_input_tokens).
 *   • گیت‌وی روی این مسیر گاهی 400 گذرا می‌دهد → دو تلاش داخلی + فال‌بک بیرونی.
 *
 * نکات:
 *   • تفکر (thinking) در این مسیر همیشه روشن است و بودجهٔ خروجی را می‌خورد —
 *     max_tokens باید بزرگ باشد (پیش‌فرض آداپتور 4096؛ call-siteهای سیستم
 *     بودجهٔ 4096 می‌فرستند). اگر پاسخ فقط thinking باشد و متن نیاید، استثنا
 *     می‌دهیم تا لایهٔ retry/fallback وارد عمل شود (قاعدهٔ «هرگز بی‌پاسخ نماند»).
 *   • reasoning_effort/thinking-related پارامترها به /v1/messages فرستاده
 *     نمی‌شوند (400 می‌دهد) — سطح تفکر ویژن ثابتِ خودِ مدل است.
 *   • usage به شکل OpenAI برمی‌گردد تا حسابداری (logAiUsage) سالم بماند:
 *     prompt = input + cache_creation + cache_read، completion = output.
 */
async function anthropicVisionCompletion(
  params: Record<string, unknown>,
  options?: { timeout?: number }
): Promise<unknown> {
  const apiKey = process.env.AVALAI_API_KEY || "";
  const baseUrl = (process.env.AVALAI_BASE_URL || "https://api.avalai.ir/v1").replace(/\/$/, "");
  const model = String(params.model || TEXT_MODEL);

  // ── تبدیل پیام‌ها ──
  const systemParts: string[] = [];
  const anthropicMessages: Array<Record<string, unknown>> = [];
  const messages = Array.isArray(params.messages) ? params.messages : [];

  const convertPart = (part: any): Record<string, unknown> | null => {
    if (!part || typeof part !== "object") return null;
    if (part.type === "text" && typeof part.text === "string") {
      return { type: "text", text: part.text };
    }
    if (part.type === "image_url") {
      const url: string =
        typeof part.image_url === "string"
          ? part.image_url
          : String(part.image_url?.url || "");
      if (!url) return null;
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
      if (m && m[2]) {
        // data URL → base64 source (مسیر اصلی سیستم — فریم‌های ویدیو هم data URL هستند)
        return {
          type: "image",
          source: { type: "base64", media_type: m[1] || "image/jpeg", data: m[3] },
        };
      }
      if (m && !m[2]) {
        // data URL بدون base64 (نادر) — به‌عنوان متن می‌گذریم؛ مدل آن را نمی‌بیند
        return { type: "text", text: "[تصویر با فرمت پشتیبانی‌نشده حذف شد]" };
      }
      if (/^https?:\/\//i.test(url)) {
        return { type: "image", source: { type: "url", url } };
      }
      // v75 — رسانهٔ ناشناخته دیگر «بی‌صدا حذف نمی‌شود»: حذف بی‌صدا یعنی مدل متن
      // را بدون تصویر می‌گیرد و به کاربر می‌گوید «ویدیو/عکس همراهش نبود» (باگ
      // گزارش‌شده). حالا صریحاً خطا می‌دهیم تا لایهٔ retry/fallback و نکتهٔ
      // شفاف به کاربر وارد عمل شود.
      throw new Error(
        `تصویر با فرمت پشتیبانی‌نشده در درخواست بینایی حذف شد (شروع آدرس: ${url.slice(0, 40)})`
      );
    }
    return null;
  };

  for (const msg of messages) {
    const role = (msg as any)?.role === "assistant" ? "assistant" : "user";
    const content = (msg as any)?.content;
    if (typeof content === "string") {
      if (msg && (msg as any).role === "system") {
        systemParts.push(content);
        continue;
      }
      if (content.trim()) anthropicMessages.push({ role, content: [{ type: "text", text: content }] });
      continue;
    }
    if (Array.isArray(content)) {
      const blocks = content.map(convertPart).filter(Boolean);
      if (msg && (msg as any).role === "system") {
        for (const b of blocks) if ((b as any).type === "text") systemParts.push((b as any).text);
        continue;
      }
      if (blocks.length) anthropicMessages.push({ role, content: blocks });
    }
  }

  // بودجهٔ خروجی — تفکر هم از همین بودجه می‌خورد؛ حداقل ۴۰۹۶ برای اطمینان
  // (درس تست زندهٔ v73: با بودجهٔ کوچک، خروجی ۱۰۰٪ thinking می‌شود و متن خالی
  // برمی‌گردد. سقف «سقف» است نه صورت‌حساب — مدل که تمام کند قطع می‌شود.)
  const maxTokens = Math.max(4096, Number(params.max_tokens) || 4096);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
  };
  if (systemParts.length) body.system = systemParts.join("\n\n");
  if (params.temperature != null) body.temperature = params.temperature;

  const timeoutMs = Number(options?.timeout) || 120_000;
  const maxInnerAttempts = 2; // 400/5xx گذرای گیت‌وی (تست زنده تأیید شد)
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxInnerAttempts; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        // 400 گیت‌وی گاهی گذراست (زیر فشار درخواست‌های عکس‌دار) → یک تلاش داخلی دیگر
        const retriable = res.status === 400 || res.status >= 500 || res.status === 429;
        lastErr = new Error(`AvalAI /messages HTTP ${res.status}: ${errText.slice(0, 160)}`);
        if (retriable && attempt < maxInnerAttempts) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw lastErr;
      }

      const json: any = await res.json();
      const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
      const text = blocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (!text) {
        // فقط thinking برگشته (بودجه خورده شد) یا پاسخ خالی → به retry بیرونی بسپار
        throw new Error(
          `پاسخ خالی از مدل بینایی (بلوک‌ها: ${blocks.map((b) => b?.type).join(",") || "هیچ"} — stop=${json?.stop_reason})`
        );
      }

      const usage = json?.usage || {};
      const promptTokens =
        Number(usage.input_tokens ?? 0) +
        Number(usage.cache_creation_input_tokens ?? 0) +
        Number(usage.cache_read_input_tokens ?? 0);
      const completionTokens = Number(usage.output_tokens ?? 0);
      const finishReason =
        json?.stop_reason === "max_tokens" ? "length" : json?.stop_reason === "end_turn" ? "stop" : String(json?.stop_reason || "stop");

      // شکل OpenAI — call-siteها فقط choices[0].message.content و usage می‌خوانند
      return {
        id: json?.id,
        object: "chat.completion",
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // خطای شبکه/تایم‌اوت — تلاش داخلی دیگر (اگر مانده)
      if (attempt < maxInnerAttempts) {
        const retriableNet = /timeout|timed out|fetch failed|ECONN|socket|network|HTTP [45]/i.test(lastErr.message);
        if (retriableNet) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }
      throw lastErr;
    }
  }

  throw lastErr || new Error("آداپتور ویژن ناموفق بود");
}

/**
 * Proxy هوشمند برای avalaiClient.
 *
 * این Proxy تمام کال‌های `chat.completions.create` را intercept می‌کند و به‌صورت
 * خودکار پارامترهای مخصوص هر مدل را اضافه می‌کند:
 *
 *  - مدل‌های gemini-3.x (gemini-3.8-flash، gemini-3.5-flash و ...):
 *    max_tokens و temperature را به generationConfig منتقل می‌کند و
 *    thinkingConfig.thinkingLevel = "low" اضافه می‌کند (دیریکتیو: تفکر LOW — سرعت).
 *
 *  - مدل‌های deepseek-v4 (deepseek-v4.1-flash / نسل‌های دیگر خانواده):
 *    reasoning_effort = "low" اضافه می‌کند (دیریکتیو v73: همه‌چیز low — فقط
 *    تولید برنامه max است که خودش صریح reasoning_effort می‌فرستد و همین‌جا
 *    محترم شمرده می‌شود).
 *    ⚠️ درس v39: تفکر max روی «gemini-3.8» بودجهٔ خروجی را می‌بلعید؛ برای
 *    deepseek-v4.1-flash با بودجهٔ صریح 65536 پذیرش max تست زنده شد ✓
 *
 *  - برای مدل‌های دیگر: رفتار استاندارد OpenAI حفظ می‌شود.
 *
 * مهم: تابع `create` در OpenAI SDK به `this._client` وابسته است. اگر آن را bind
 * نکنیم، خطای "Cannot read properties of undefined (reading '_client')" رخ می‌دهد.
 * بنابراین `originalCreate` را قبل از wrap کردن به `completionsObj` bind می‌کنیم.
 */
function wrapCreateWithGemini3Support<T extends (...args: any[]) => any>(
  originalCreate: T,
  thisArg: any
): T {
  // bind کردن به thisArg (completions object) تا this._client در دسترس باشد
  const boundCreate = originalCreate.bind(thisArg) as T;
  return ((async (params: any, options?: any) => {
    const model: string = params?.model || TEXT_MODEL;
    const isGemini3 = isGemini3Model(model);
    const isDeepseekV4 = isDeepseekV4Model(model);

    if (isGemini3) {
      // برای gemini-3.x: پارامترها به generationConfig منتقل شوند
      // thinkingLevel پیش‌فرض "low" است (دیریکتیو کاربر: تفکر LOW — سرعت)،
      // اما اگر caller مقدار دیگری (مثلاً "high" برای تولید برنامه) داده باشد،
      // آن مقدار محترم شمرده می‌شود و override نمی‌شود.
      const callerThinkingLevel = (params as any)?.extra_body?.generationConfig?.thinkingConfig?.thinkingLevel;
      const thinkingLevel = typeof callerThinkingLevel === "string" && callerThinkingLevel
        ? callerThinkingLevel
        : "low";
      const generationConfig: Record<string, unknown> = {
        thinkingConfig: { thinkingLevel },
      };
      if (params?.max_tokens != null) {
        generationConfig.maxOutputTokens = params.max_tokens;
      }
      if (params?.temperature != null) {
        generationConfig.temperature = params.temperature;
      }
      if (params?.top_p != null) {
        generationConfig.topP = params.top_p;
      }

      // حذف پارامترهای top-level که gemini-3.x نمی‌پذیرد
      const { max_tokens, temperature, top_p, ...rest } = params;

      // ادغام با extra_body موجود (اگر کاربر قبلاً چیزی فرستاده)
      const existingExtraBody = (params as any).extra_body || {};
      const mergedParams = {
        ...rest,
        extra_body: {
          ...existingExtraBody,
          generationConfig: {
            ...(existingExtraBody.generationConfig || {}),
            ...generationConfig,
          },
        },
      };

      return boundCreate(mergedParams, options);
    }

    if (isDeepseekV4) {
      // ─── v73 ویژن بومی: درخواست‌های تصویری deepseek از مسیر /v1/messages ───
      // تست زندهٔ v73: AvalAI روی chat/completions بلاک‌های image_url را بی‌صدا
      // حذف می‌کند (مدل «تصویری نمی‌بینم» می‌گوید)؛ اما مسیر Anthropic‌سازگار
      // /v1/messages با source.base64 واقعاً تصویر را به مدل می‌رساند (تأیید:
      // توصیف دقیق عکس واقعی + کش پرامپت فعال). آداپتور پایین، فرمت OpenAI را
      // به Anthropic تبدیل و پاسخ را به شکل OpenAI برمی‌گرداند — هیچ call-site
      // تغییر نمی‌کند. اگر 400/5xx گذرا (گیت‌وی ناپایدار — تست شد) → تلاش مجدد
      // داخلی؛ شکست نهایی → استثنا به لایهٔ retry/fallback (gemini-3.8-flash).
      if (isVisionRequest(params as Record<string, unknown>)) {
        return anthropicVisionCompletion(
          params as Record<string, unknown>,
          options as { timeout?: number } | undefined
        ) as any;
      }
      // برای deepseek-v4 (متن): پیش‌فرض reasoning_effort = "low" (دیریکتیو مالک v73:
      // «بقیه موارد همگی با low»). تولید برنامه صریح max می‌فرستد
      // و همین‌جا override نمی‌شود. اگر کاربر قبلاً reasoning_effort تنظیم کرده، دست نمی‌زنیم.
      if (params?.reasoning_effort == null) {
        return boundCreate({ ...params, reasoning_effort: "low" }, options);
      }
      return boundCreate(params, options);
    }

    // برای مدل‌های دیگر: بدون تغییر
    return boundCreate(params, options);
  }) as unknown as T);
}

/**
 * فراخوانی LLM با retry دستی برای تولید برنامه‌های تمرینی/غذایی.
 *
 * چرا: گیت‌وی api.avalai.ir (کلادفلر) برای پاسخ‌های طولانیِ تولید برنامه
 * (خروجی JSON بزرگ ≈ ۳۰KB) به‌صورت ناپایدار 504 Gateway Timeout می‌دهد
 * (تست واقعی: پاسخ‌های ۹۷-۱۱۰ ثانیه‌ای گاهی رد می‌شوند، گاهی در ۶۳s قطع).
 * SDK خودش maxRetries دارد ولی خطاهای HTML-دار 504 را همیشه retry نمی‌کند؛
 * اینجا تا ۳ تلاش با backoff کوتاه انجام می‌شود (فقط برای خطاهای گذرا).
 *
 * planTimeoutMs: تولید برنامه در پس‌زمینه انجام می‌شود (نه داخل request کاربر)
 * پس می‌توانیم timeout بلندتری گذاشت — تفکر high ممکن است ۲-۴ دقیقه طول بکشد.
 *
 * fallbackParams: اگر همه تلاش‌ها با پارامتر اصلی (مثلاً تفکر high) شکست خوردند،
 * یک تلاش نهایی با پارامتر جایگزین (تفکر low) انجام می‌شود — کیفیت در اولویت
 * است ولی کاربر هرگز بدون برنامه نمی‌ماند.
 */
/**
 * اعتبارسنج محتوای پاسخ — null/رشتهٔ خالی یعنی OK، رشتهٔ فارسی یعنی توضیح خطا.
 * v39: زنجیرهٔ تفکر فقط روی «پاسخِ واقعاً قابل‌استفاده» توقف می‌کند، نه هر پاسخ 200.
 */
export type PlanContentValidator = (text: string) => string | null;

export async function createPlanCompletionWithRetry(
  params: Record<string, unknown>,
  logTag: string,
  maxAttempts = 3,
  opts?: {
    timeoutMs?: number;
    fallbackParams?: Record<string, unknown>;
    validateContent?: PlanContentValidator;
    userId?: string | null; // v70 حسابداری
  }
): Promise<string> {
  let lastErr: unknown = null;
  // v58 — پارامتر داخلی fallback_model قبل از ارسال حذف می‌شود (هرگز به API نمی‌رود)
  const apiParams: Record<string, unknown> = { ...params };
  delete apiParams.fallback_model;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartedAt = Date.now(); // v70 حسابداری — اندازه‌گیری تأخیر
    try {
      const completion = await avalaiClient.chat.completions.create(apiParams as any, {
        maxRetries: 0, // retry دستی اینجا — دوباره‌کاری نکن
        ...(opts?.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      });
      // ─── v39-fix: پاسخ «خالی» دیگر موفقیت حساب نمی‌شود ───
      // باگ ریشه‌ای تولید برنامه: AvalAI با 200 و content:null برمی‌گشت
      // (مدل تفکری gemini-3.8، کل بودجهٔ خروجی را با reasoning می‌خورد و
      // صفر توکن متن تولید می‌کرد → finish_reason=length) و کد قدیمی
      // `content || ""` آن را «موفق» می‌گرفت → زنجیره همان لحظه متوقف،
      // بدون سقوط به سطح تفکر بعدی و بدون فال‌بک مدل → «برنامه خالی».
      const choice: any = (completion as any)?.choices?.[0];
      const rawContent = choice?.message?.content;
      const text = typeof rawContent === "string" ? rawContent : "";
      if (!text.trim()) {
        const usage: any = (completion as any)?.usage || {};
        const cd = usage.completion_tokens_details || {};
        const diag = `finish_reason=${choice?.finish_reason || "?"} completion_tokens=${usage.completion_tokens ?? "?"} reasoning=${cd.reasoning_tokens ?? "?"} text=${cd.text_tokens ?? "?"}`;
        console.error(`[${logTag}] attempt ${attempt}/${maxAttempts}: EMPTY content (${diag})`);
        // قطعی است؛ تلاش دوباره با همین پارامترها بی‌فایده → سطح بعدی زنجیره
        lastErr = new Error(`پاسخ خالی از مدل هوش مصنوعی (${diag})`);
        break;
      }
      if (choice?.finish_reason === "length") {
        // متن هست ولی سقف خروجی خورده — احتمالاً JSON بریده؛ هنوز برمی‌گردانیم
        // چون ممکن است JSON کامل باشد و فقط توضیح انتهایی بریده شده باشد.
        console.warn(`[${logTag}] attempt ${attempt}: finish_reason=length (len=${text.length}) — may be truncated`);
      }
      if (opts?.validateContent) {
        const vErr = opts.validateContent(text);
        if (vErr) {
          console.error(
            `[${logTag}] attempt ${attempt}/${maxAttempts}: validation failed — ${vErr} (len=${text.length}, finish_reason=${choice?.finish_reason || "?"}, head=${text.slice(0, 160).replace(/\s+/g, " ")})`
          );
          lastErr = new Error(vErr);
          if (attempt === maxAttempts) break;
          await new Promise((r) => setTimeout(r, 2000));
          continue; // پاسخ نامعتبر می‌تواند تصادفی باشد → retry همان سطح
        }
      }
      // ─── v70 حسابداری — لاگ مصرف AI (best-effort؛ زنجیرهٔ برنامه گران‌ترین مسیر است
      // و تا امروز هیچ ردیفی در داشبورد حسابداری نمی‌گذاشت) ───
      try {
        const usage: any = (completion as any)?.usage;
        if (usage && typeof usage === "object") {
          const promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
          const completionTokens = Number(usage.completion_tokens ?? 0) || 0;
          await logAiUsage({
            route: logTag.split("(fallback")[0],
            model: String(apiParams.model ?? TEXT_MODEL),
            promptTokens,
            completionTokens,
            totalTokens: Number(usage.total_tokens ?? promptTokens + completionTokens) || promptTokens + completionTokens,
            latencyMs: Date.now() - attemptStartedAt,
            userId: opts?.userId ?? null,
          });
        }
      } catch {
        // هرگز جریان اصلی را نمی‌شکند
      }
      return text;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message || err);
      const retriable = /50[234]|429|timed out|timeout|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(msg);
      console.error(`[${logTag}] AvalAI error (attempt ${attempt}/${maxAttempts}):`, msg.slice(0, 200));
      if (!retriable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 3000)); // backoff کوتاه
    }
  }

  // تلاش نهایی با پارامتر جایگزین (مثلاً تفکر low) — بهتر از هیچ برنامه‌ای نیست
  if (opts?.fallbackParams) {
    console.warn(`[${logTag}] falling back to alternate params (e.g. low thinking)...`);
    const fbStartedAt = Date.now();
    try {
      const completion = await avalaiClient.chat.completions.create(opts.fallbackParams as any, {
        maxRetries: 0,
        ...(opts?.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      });
      const choice: any = (completion as any)?.choices?.[0];
      const rawContent = choice?.message?.content;
      const text = typeof rawContent === "string" ? rawContent : "";
      if (text.trim() && (!opts.validateContent || !opts.validateContent(text))) {
        // v70 حسابداری — لاگ مصرف تلاش جایگزین
        try {
          const usage: any = (completion as any)?.usage;
          if (usage && typeof usage === "object") {
            const promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
            const completionTokens = Number(usage.completion_tokens ?? 0) || 0;
            await logAiUsage({
              route: logTag.split("(fallback")[0],
              model: String((opts.fallbackParams as Record<string, unknown>).model ?? TEXT_MODEL),
              promptTokens,
              completionTokens,
              totalTokens: Number(usage.total_tokens ?? promptTokens + completionTokens) || promptTokens + completionTokens,
              latencyMs: Date.now() - fbStartedAt,
              userId: opts?.userId ?? null,
            });
          }
        } catch {}
        return text;
      }
      console.error(`[${logTag}] fallback attempt returned empty/invalid content (finish_reason=${choice?.finish_reason || "?"})`);
      lastErr = new Error("پاسخ خالی/نامعتبر از مدل (fallbackParams)");
    } catch (err) {
      lastErr = err;
      console.error(`[${logTag}] fallback attempt failed:`, String((err as Error)?.message || err).slice(0, 200));
    }
  }

  console.error(`[${logTag}] all attempts failed:`, lastErr);
  throw lastErr instanceof Error
    ? lastErr
    : new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
}

// ═══════════════════════════════════════════════════════════════════════════
// زنجیرهٔ تولید برنامه‌های تمرینی/تغذیه/مکمل — دیریکتیو مالک (v73):
// «تولید برنامه باید با میزان تفکر مکس و بقیه موارد همگی با low باشه.»
// زنجیره (کیفیت اول، اما کاربر هرگز بدون برنامه نمی‌ماند):
//   گام ۱ — deepseek-v4.1-flash با reasoning_effort=max (۲ تلاش برای خطاهای
//           گذرای گیت‌وی) + پارامتر فال‌بکِ همان مدل با تفکر low (۱ تلاش) —
//           اگر تفکر مکس به هر شکلی شکست خورد (پاسخ خالی/نامعتبر، 400 دائمی،
//           504/تایم‌اوت پایدار)، سطح پایین‌تر می‌آید نه برنامه‌نشدن.
//   گام ۲ — gemini-3.8-flash با thinkingLevel=high (۲ تلاش) — فال‌بک مدلِ
//           اثبات‌شدهٔ قبلی؛ فقط اگر گام ۱ به‌طور کامل شکست خورد.
//
// بودجه‌بندی زمان: watchdog تولید برنامه STUCK_GENERATION_WINDOW_MS=۵۰ دقیقه است؛
// سقف هر تلاش ۲۷۰ ثانیه → بدترین حالت (۲×max + ۱×low + ۲×gemini) ≈ ۲۲.۵ دقیقه < ۵۰ ✓
// (تمرینی و غذایی موازی اجرا می‌شوند و هر دو از همین بودجه استفاده می‌کنند.)
//
// درس v39 (بستر تصمیم): تفکر «max روی gemini-3.8» بودجهٔ خروجی را با reasoning
// می‌بلعید (finish_reason=length، متن خالی) — برای جلوگیری از تکرار، بودجهٔ
// خروجی صریح 65536 حفظ شده و deepseek-v4.1-flash با سقف خروجی 393K فضای
// reasoning+JSON را راحت‌تر جا می‌دهد. تست زندهٔ v73: پذیرش reasoning_effort=max
// روی AvalAI تأیید شد (اسکریپت scripts/test-real-ai-v73.ts).
const PLAN_ATTEMPT_TIMEOUT_MS = 270_000; // ۴.۵ دقیقه برای هر تلاش

// v39-fix: بودجهٔ صریح خروجی برای تولید برنامه.
// بدون این، AvalAI برای gemini-3.8 یک بودجهٔ پیش‌فرض کوچک اعمال می‌کند که
// reasoning (تفکر max/high) به‌تنهایی آن را می‌بلعد → content:null → «برنامه خالی».
// تست واقعی (سپتامبر ۲۰۲۶): maxOutputTokens=65536 پذیرفته می‌شود و reasoning+JSON
// بزرگ (~۲۵هزار توکن) را با هم جا می‌دهد. برای gemini-3.x پروکسیِ پایین‌تر این
// مقدار را به generationConfig.maxOutputTokens منتقل می‌کند.
const PLAN_MAX_OUTPUT_TOKENS = 65536;

/**
 * ساخت پارامترهای chat.completions برای تولید برنامه با سطح تفکر مشخص.
 * v73: مدل پیش‌فرض PLAN_MODEL (deepseek-v4.1-flash) است — فال‌بک gemini-3.8-flash
 * هم با همین سازنده ساخته می‌شود (پروکسیِ پایین‌تر مقدار non-null reasoning_effort
 * را override نمی‌کند) و extra_bodyِ تفکرِ gemini فقط برای gemini-3.x ست می‌شود.
 */
function buildPlanParams(
  systemPrompt: string,
  userPrompt: string,
  thinkingLevel: string,
  model: string = PLAN_MODEL
): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    // v39-fix: بودجهٔ صریح خروجی (جلوگیری از بلعیده‌شدن بودجه توسط reasoning)
    max_tokens: PLAN_MAX_OUTPUT_TOKENS,
    // برای مدل‌های deepseek-v4 (reasoning_effort پشتیبانی می‌کنند)
    reasoning_effort: thinkingLevel,
    // برای مدل‌های gemini-3.x (thinkingLevel از طریق generationConfig)
    ...(isGemini3Model(model)
      ? { extra_body: { generationConfig: { thinkingConfig: { thinkingLevel } } } }
      : {}),
  };
}

/**
 * فراخوانی LLM برای تولید برنامه — دیریکتیو مالک (v73):
 * «تولید برنامه باید با میزان تفکر مکس و بقیه موارد همگی با low باشه.»
 *
 * گام ۱: deepseek-v4.1-flash با reasoning_effort=max — ۲ تلاش برای خطاهای گذرای
 *        گیت‌وی (504/429/timeout)؛ پاسخ خالی/نامعتبر و خطای دائمی (400) بلافاصله
 *        به پارامتر فال‌بک (همان مدل، تفکر low — یک تلاش) می‌روند: کاربر هرگز
 *        بدون برنامه نمی‌ماند.
 * گام ۲: gemini-3.8-flash با thinkingLevel=high — ۲ تلاش؛ فال‌بک مدلِ
 *        اثبات‌شدهٔ زنجیرهٔ v40 که سال‌ها برنامهٔ سیستم را ساخته است.
 *        AVALAI_FALLBACK_PLAN_MODEL اگر ست شده باشد جایگزین gemini می‌شود.
 */
export async function generatePlanContent(
  systemPrompt: string,
  userPrompt: string,
  logTag: string,
  validateContent?: PlanContentValidator
): Promise<string> {
  let lastErr: unknown = null;
  // ─── گام ۱: PLAN_MODEL با تفکر مکس (دیریکتیو مالک v73) + تور نجات low ───
  try {
    return await createPlanCompletionWithRetry(
      buildPlanParams(systemPrompt, userPrompt, "max", PLAN_MODEL),
      logTag,
      2,
      // پاسخ فقط وقتی «موفق» است که واقعاً قابل‌استفاده باشد — وگرنه زنجیره
      // ادامه پیدا می‌کند. fallbackParams: همان مدل با تفکر low (تور نجات
      // دسترس‌پذیری — «برنامهٔ خالی» بهتر از «بی‌برنامه» است، دیریکتیو همیشگی).
      {
        timeoutMs: PLAN_ATTEMPT_TIMEOUT_MS,
        validateContent,
        fallbackParams: buildPlanParams(systemPrompt, userPrompt, "low", PLAN_MODEL),
      }
    );
  } catch (err) {
    lastErr = err;
    console.warn(
      `[${logTag}] ${PLAN_MODEL} (thinking=max → low net) exhausted — switching to fallback model:`,
      String((err as Error)?.message || err).slice(0, 180)
    );
  }

  // ─── گام ۲: فال‌بک مدل — gemini-3.8-flash با تفکر high (مسیر اثبات‌شدهٔ v40) ───
  // پرامپت‌ها و اعتبارسنج دست‌نخورده می‌مانند، فقط موتور عوض می‌شود.
  const fallbackModel = FALLBACK_PLAN_MODEL;
  if (fallbackModel && fallbackModel !== PLAN_MODEL) {
    console.warn(
      `[${logTag}] primary model exhausted — trying fallback model "${fallbackModel}" (thinking=high)...`
    );
    try {
      return await createPlanCompletionWithRetry(
        buildPlanParams(systemPrompt, userPrompt, "high", fallbackModel),
        `${logTag}(fallback:${fallbackModel})`,
        2,
        { timeoutMs: PLAN_ATTEMPT_TIMEOUT_MS, validateContent }
      );
    } catch (err) {
      lastErr = err;
      console.error(`[${logTag}] fallback model also failed:`, String((err as Error)?.message || err).slice(0, 200));
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
}

/**
 * فراخوانی چت با retry سبک برای خطاهای گذرا — برای چت‌ها و تحلیل‌های سریع.
 *
 * چرا: گیت‌وی api.avalai.ir (ArvanCloud) به‌صورت ناپایدار درخواست‌ها را بعد از
 * ~۳۰ ثانیه با 504 (صفحه HTML کلادفلر) می‌کُشد. تست واقعی: چت نیکا/مربی گاهی
 * در اولین تلاش 504 می‌خورد و در تلاش دوم همان لحظه جواب می‌دهد. بدون retry،
 * کاربر خطای «ارتباط برقرار نشد» می‌بیند در حالی که یک تلاش دیگر کافی بود.
 *
 * فقط خطاهای گذرا (502/503/504/429/timeout/شبکه) retry می‌شوند؛
 * خطاهای دائمی (401 کلید غلط، 400 پارامتر غلط) بلافاصله fail می‌شوند.
 *
 * v42: بعد از اتمام همهٔ تلاش‌های مدل اول، درخواست با مدل فال‌بک تکرار می‌شود
 * (ویژن → gemini-3.5-flash، متن → deepseek-v4-flash — دیریکتیو مالک).
 * چت نیکا/مربی، تحلیل عکس غذا/بدن و تحلیل ویدیو از این تابع استفاده می‌کنند.
 *
 * v70 حسابداری: هر تلاشِ موفق در AiUsageLog ثبت می‌شود (قبلاً این تابع — که
 * چت نیکا/مربی و «همهٔ» تحلیل‌های ویژن از آن می‌گذرد — صفر لاگ مصرف می‌گذاشت
 * و داشبورد حسابداری مصرف‌کننده‌های اصلی بودجه را نمی‌دید).
 */
export async function createChatCompletionWithRetry(
  params: Record<string, unknown>,
  logTag: string,
  maxAttempts = 3,
  opts?: { userId?: string | null }
): Promise<string> {
  try {
    return await chatCompletionWithRetryAttempt(params, logTag, maxAttempts, opts?.userId);
  } catch (primaryErr) {
    // ─── v42 دیریکتیو مالک: هر شکستِ نهایی مدل اول → مدل فال‌بک ───
    // ویژن → gemini-3.5-flash | متن → deepseek-v4-flash (خودکار)
    const fb = fallbackModelFor(params);
    if (!fb) throw primaryErr;
    console.warn(
      `[${logTag}] primary model exhausted — falling back to "${fb}" (v42 directive)...`
    );
    return await chatCompletionWithRetryAttempt(
      withFallbackModel(params, fb),
      `${logTag}(fallback:${fb})`,
      maxAttempts,
      opts?.userId
    );
  }
}

async function chatCompletionWithRetryAttempt(
  params: Record<string, unknown>,
  logTag: string,
  maxAttempts: number,
  userId?: string | null
): Promise<string> {
  let lastErr: unknown = null;
  // v58 — پارامتر داخلی fallback_model قبل از ارسال حذف می‌شود (هرگز به API نمی‌رود)
  const apiParams: Record<string, unknown> = { ...params };
  delete apiParams.fallback_model;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartedAt = Date.now(); // v70 حسابداری — اندازه‌گیری تأخیر
    try {
      const completion = await avalaiClient.chat.completions.create(apiParams as any, {
        maxRetries: 0, // retry دستی اینجا
      });
      // v39: پاسخ خالی (content:null — مدل تفکری بودجه را با reasoning می‌خورد)
      // دیگر موفقیت نیست؛ مثل خطای گذرا retry می‌شود (چت سریع است)
      const choice: any = (completion as any)?.choices?.[0];
      const rawContent = choice?.message?.content;
      const text = typeof rawContent === "string" ? rawContent : "";
      if (!text.trim()) {
        const usage: any = (completion as any)?.usage || {};
        const cd = usage.completion_tokens_details || {};
        console.error(
          `[${logTag}] attempt ${attempt}/${maxAttempts}: EMPTY content (finish_reason=${choice?.finish_reason || "?"}, reasoning=${cd.reasoning_tokens ?? "?"}, text=${cd.text_tokens ?? "?"})`
        );
        lastErr = new Error(`پاسخ خالی از مدل هوش مصنوعی (finish_reason=${choice?.finish_reason || "?"})`);
        if (attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      // ─── v70 حسابداری — لاگ مصرف AI (best-effort؛ هرگز جریان اصلی نمی‌شکند) ───
      try {
        const usage: any = (completion as any)?.usage;
        if (usage && typeof usage === "object") {
          const promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
          const completionTokens = Number(usage.completion_tokens ?? 0) || 0;
          await logAiUsage({
            route: logTag.split("(fallback")[0], // برچسب ثابت مسیر — بدون پسوند فال‌بک
            model: String(apiParams.model ?? TEXT_MODEL), // مدل واقعی همین تلاش موفق
            promptTokens,
            completionTokens,
            totalTokens: Number(usage.total_tokens ?? promptTokens + completionTokens) || promptTokens + completionTokens,
            latencyMs: Date.now() - attemptStartedAt,
            userId: userId ?? null,
          });
        }
      } catch {
        // لاگ مصرف هرگز نباید پاسخ چت را بشکند
      }
      return text;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message || err);
      const retriable = /50[234]|429|timed out|timeout|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(msg);
      console.error(`[${logTag}] AvalAI error (attempt ${attempt}/${maxAttempts}):`, msg.slice(0, 200));
      if (!retriable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 2500)); // backoff کوتاه
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * v41 — سپر سراسری فراخوانی AI برای «همهٔ» امکانات سیستم
 * ═══════════════════════════════════════════════════════════════════════════
 * درس v39/v40: gemini-3.8-flash مدل تفکری است — بدون بودجهٔ خروجیِ صریح،
 * reasoning بودجهٔ پیش‌فرض AvalAI را می‌خورد و با 200 و content:null برمی‌گردد.
 * تولید برنامه این سپر را گرفت؛ اما ۱۲ نقطهٔ دیگر (سئوی هوشمند، تحلیل‌ها،
 * دستیار مدیر و…) مستقیم avalaiClient را صدا می‌زدند — همه به این تابع
 * منتقل شدند: بودجهٔ صریح + retry خطاهای گذرا + تشخیص پاسخ خالی + اعتبارسنج.
 */

export interface ResilientCompletionOptions {
  /** برچسب لاگ — مثل "content-refresh" */
  logTag: string;
  /**
   * بودجهٔ صریح خروجی (max_tokens). برای gemini-3.x پروکسی آن را به
   * generationConfig.maxOutputTokens می‌برد. پیش‌فرض ۸۱۹۲ — برای خروجی‌های بزرگ
   * (بازنویسی مقالهٔ کامل) مقدار بالاتر بدهید (مثل 65536).
   */
  maxTokens?: number;
  temperature?: number;
  /** سقف زمانی هر تلاش (میلی‌ثانیه) — پیش‌فرض بدون سقف SDK */
  timeoutMs?: number;
  /** تعداد تلاش‌ها برای خطای گذرا/پاسخ خالی (پیش‌فرض ۳) */
  maxAttempts?: number;
  /** اعتبارسنج محتوا — رشتهٔ فارسی = توضیح خطا → retry؛ null = پذیرفتن */
  validateContent?: PlanContentValidator;
  /** مدل — پیش‌فرض TEXT_MODEL؛ برای تحلیل تصویر VISION_MODEL بدهید */
  model?: string;
  /** استدلال صریح (برای deepseek: reasoning_effort؛ اگر ست نشود پروکسی پیش‌فرض را می‌گذارد) */
  reasoningEffort?: string;
  /**
   * v52 حسابداری — شناسهٔ مسیر برای لاگ مصرف AiUsageLog (پیش‌فرض: همان logTag).
   * اختیاری — فراخوانی‌های فعلی بدون تغییر کار می‌کنند.
   */
  routeTag?: string;
  /** v52 حسابداری — کاربر مرتبط با این فراخوانی (اختیاری — برای لاگ مصرف) */
  userId?: string;
}

/**
 * فراخوانی محافظت‌شدهٔ chat.completions — همهٔ نقاط AI باید از این استفاده کنند
 * نه از avalaiClient مستقیم. رفتار: retry خطاهای گذرا (502/503/504/429/timeout)،
 * retry پاسخ خالی (content:null)، اعتبارسنجی اختیاری محتوا، لاگ تشخیصی کامل.
 * v42: بعد از اتمام تلاش‌های مدل اول، مدل فال‌بک (ویژن → gemini-3.5-flash،
 * متن → deepseek-v4-flash) امتحان می‌شود — دیریکتیو مالک «اگر یک درصد نشد…».
 */
export async function createResilientCompletion(
  params: Record<string, unknown>,
  opts: ResilientCompletionOptions
): Promise<string> {
  try {
    return await resilientCompletionAttempt(params, opts);
  } catch (primaryErr) {
    // ─── v42 دیریکتیو مالک: هر شکستِ نهایی مدل اول → مدل فال‌بک ───
    // ویژن → gemini-3.5-flash | متن → deepseek-v4-flash (تشخیص خودکار با image_url)
    const fb = fallbackModelFor(params);
    if (!fb) throw primaryErr;
    console.warn(
      `[${opts.logTag}] primary model exhausted — falling back to "${fb}" (v42 directive)...`
    );
    return await resilientCompletionAttempt(withFallbackModel(params, fb), {
      ...opts,
      logTag: `${opts.logTag}(fallback:${fb})`,
    });
  }
}

async function resilientCompletionAttempt(
  params: Record<string, unknown>,
  opts: ResilientCompletionOptions
): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const body: Record<string, unknown> = {
    ...(opts.model ? { model: opts.model } : {}),
    ...params,
  };
  if (body.model == null) body.model = TEXT_MODEL;
  // v58 — پارامتر داخلی مسیر فال‌بک؛ هرگز نباید به API برسد
  delete body.fallback_model;
  if (opts.maxTokens != null && body.max_tokens == null) body.max_tokens = opts.maxTokens;
  if (opts.temperature != null && body.temperature == null) body.temperature = opts.temperature;
  if (opts.reasoningEffort != null && body.reasoning_effort == null) body.reasoning_effort = opts.reasoningEffort;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartedAt = Date.now(); // v52 حسابداری — اندازه‌گیری تأخیر برای لاگ مصرف
    try {
      const completion = await avalaiClient.chat.completions.create(body as any, {
        maxRetries: 0, // retry دستی اینجا — دوباره‌کاری نکن
        ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      });
      const choice: any = (completion as any)?.choices?.[0];
      const rawContent = choice?.message?.content;
      const text = typeof rawContent === "string" ? rawContent : "";
      if (!text.trim()) {
        // v39-lesson: 200 با content:null = شکست، نه موفقیت
        const usage: any = (completion as any)?.usage || {};
        const cd = usage.completion_tokens_details || {};
        const diag = `finish_reason=${choice?.finish_reason || "?"} completion_tokens=${usage.completion_tokens ?? "?"} reasoning=${cd.reasoning_tokens ?? "?"} text=${cd.text_tokens ?? "?"}`;
        console.error(`[${opts.logTag}] attempt ${attempt}/${maxAttempts}: EMPTY content (${diag})`);
        lastErr = new Error(`پاسخ خالی از مدل هوش مصنوعی (${diag})`);
        if (attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (choice?.finish_reason === "length") {
        console.warn(`[${opts.logTag}] attempt ${attempt}: finish_reason=length (len=${text.length}) — خروجی ممکن است بریده باشد`);
      }
      if (opts.validateContent) {
        const vErr = opts.validateContent(text);
        if (vErr) {
          console.error(
            `[${opts.logTag}] attempt ${attempt}/${maxAttempts}: validation failed — ${vErr} (len=${text.length}, finish_reason=${choice?.finish_reason || "?"}, head=${text.slice(0, 160).replace(/\s+/g, " ")})`
          );
          lastErr = new Error(vErr);
          if (attempt === maxAttempts) break;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
      // ─── v52 حسابداری — لاگ مصرف AI (best-effort؛ بعد از اعتبارسنجیِ موفق) ───
      // هیچ تغییری در منطق retry/فال‌بک/اعتبارسنجی ایجاد نمی‌کند — فقط ثبت هزینه.
      try {
        const usage: any = (completion as any)?.usage;
        if (usage && typeof usage === "object") {
          const promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
          const completionTokens = Number(usage.completion_tokens ?? 0) || 0;
          const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || promptTokens + completionTokens;
          await logAiUsage({
            route: opts.routeTag ?? opts.logTag ?? "unknown",
            model: String(body.model ?? TEXT_MODEL), // مدل واقعی همین تلاشِ موفق (بعد از fallback هم درست است)
            promptTokens,
            completionTokens,
            totalTokens,
            latencyMs: Date.now() - attemptStartedAt,
            userId: opts.userId ?? null,
          });
        }
      } catch {
        // هرگز جریان اصلی را نمی‌شکند
      }
      return text;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message || err);
      const retriable = /50[234]|429|timed out|timeout|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|Request was aborted/i.test(msg);
      console.error(`[${opts.logTag}] AvalAI error (attempt ${attempt}/${maxAttempts}):`, msg.slice(0, 200));
      if (!retriable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
}

// ساخت Proxy عمیق که chat.completions.create را intercept می‌کند
export const avalaiClient = new Proxy({} as OpenAI, {
  get(_, prop) {
    const client = getAvalaiClient();
    const value = (client as any)[prop];

    if (prop === "chat") {
      // Proxy برای chat
      return new Proxy(value, {
        get(__, chatProp) {
          const chatValue = (value as any)[chatProp];
          if (chatProp === "completions") {
            // Proxy برای completions
            return new Proxy(chatValue, {
              get(___, compProp) {
                const compValue = (chatValue as any)[compProp];
                if (compProp === "create" && typeof compValue === "function") {
                  // wrap create با مدیریت gemini-3.x — bind به chatValue (completions object)
                  return wrapCreateWithGemini3Support(compValue, chatValue);
                }
                return typeof compValue === "function" ? compValue.bind(chatValue) : compValue;
              },
            });
          }
          return typeof chatValue === "function" ? chatValue.bind(value) : chatValue;
        },
      });
    }

    return typeof value === "function" ? value.bind(client) : value;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKOUT-PLAN-PRO — تایپ‌های توسعه‌یافته برای برنامه‌های حرفه‌ای
// این فیلدها به صورت اختیاری به WorkoutPlanContent / MealPlanContent اضافه می‌شوند
// تا برنامه‌ها در سطح مربیان بزرگ دنیا (هانی رامبد، هادی چوپان، کریس بامستد) تولید شوند.
// ─────────────────────────────────────────────────────────────────────────────

/** تایپ توسعه‌یافته برنامه تمرینی — شامل فیلدهای حرفه‌ای جدید */
export type ProWorkoutPlanContent = WorkoutPlanContent & {
  /** تکنیک‌های پیشرفته استفاده‌شده در برنامه (FST-7، سوپرست آنتاگونیست، تری‌ست، دراپ‌ست، رست پاز، و ...) */
  advancedTechniques?: string[];
  /** تقسیم عضلات هفته (push/pull/legs، upper/lower، body part split، push/pull/legs/rest، و ...) */
  muscleGroupSplit?: string;
  /** جزئیات FST-7 (Fascia Stretch Training) در حرکت آخر هر گروه عضلانی — ویژه پلن ultimate */
  fst7Details?: {
    exerciseName: string;
    sets: number;
    reps: string;
    restSec: number;
    note?: string;
  };
  /** نوع دوره‌بندی (Periodization) */
  periodizationType?: "linear" | "undulating" | "block" | "wave" | "daily_undulating";
  /** فرکانس تمرین هر گروه عضلانی در هفته (۱-۳) */
  muscleFrequencyPerWeek?: number;
  /** الهام‌گرفته از کدام مربی بزرگ */
  inspiredByCoach?: "hany_rambod" | "hadi_chupan" | "chris_bumstead" | "mixed";
};

/** تایپ توسعه‌یافته برنامه غذایی — شامل فیلدهای حرفه‌ای جدید */
export type ProMealPlanContent = MealPlanContent & {
  /** تفکیک دقیق محاسبه TDEE و مازاد/نقصان کالری */
  tdeeBreakdown?: {
    bmr: number;
    tdee: number;
    targetCalories: number;
    /** مازاد کالری (مثبت) یا نقصان (منفی) */
    calorieAdjustment: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    /** پروتئین به ازای هر کیلوگرم وزن بدن */
    proteinPerKg: number;
    /** کربوهیدرات به ازای هر کیلوگرم وزن بدن */
    carbsPerKg: number;
    /** چربی به ازای هر کیلوگرم وزن بدن */
    fatPerKg: number;
  };
  /** جایگزین‌های رژیمی (وگان، کتو، کم‌کربوهیدرات، بدون گلوتن، و ...) برای هر وعده */
  dietAlternatives?: {
    diet: string;
    description: string;
    sampleMeals: string[];
  }[];
  /** استک مکمل پیشرفته — دسته‌بندی‌شده به پایه/پیشرفته/هدفمند */
  supplementStack?: {
    category: "base" | "advanced" | "targeted";
    name: string;
    dose: string;
    timing: string;
    note?: string;
    /** افراد منع‌شده از مصرف این مکمل (بیماران قلبی، دیابتی، و ...) */
    contraindicatedFor?: string[];
  }[];
};

// ─── ضریب فعالیت برای محاسبه دقیق TDEE ───
// بر اساس فرمول‌های استاندارد Harris-Benedict و Mifflin-St Jeor
function getActivityMultiplier(activityLevel?: OnboardingData["activityLevel"]): number {
  switch (activityLevel) {
    case "sedentary":
      return 1.2;   // بی‌تحرک (کار پشت میز، بدون تمرین)
    case "light":
      return 1.375; // کم‌تحرک (تمرین ۱-۳ روز در هفته)
    case "moderate":
      return 1.55;  // متوسط (تمرین ۳-۵ روز در هفته)
    case "active":
      return 1.725; // فعال (تمرین ۶-۷ روز در هفته)
    case "very_active":
      return 1.9;   // خیلی فعال (تمرین سنگین روزانه + کار فیزیکی)
    default:
      return 1.4;   // پیش‌فرض محافظه‌کارانه
  }
}

// ─── راهنمای تکنیک‌های پیشرفته بر اساس سطح پلن ───
// این تابع تعیین می‌کند کاربر بر اساس پلن اشتراکش به چه تکنیک‌های حرفه‌ای دسترسی دارد.
// - ultimate (حرفه‌ای): FST-7 هانی رامبد + دوره‌بندی موجی + ۸-۱۰ حرکت
// - advanced (پیشرفته): سوپرست‌های آنتاگونیست + دراپ‌ست + ۷-۸ حرکت
// - standard (استاندارد): تمرینات پایه با رعایت فرم + ۶-۷ حرکت
// - basic (اقتصادی): تمرینات ساده و مؤثر + ۵-۶ حرکت
// ─── تکنیک‌های تمرینی بر اساس سابقه ورزشکار (نه پلن) ───
// ⚠️ مهم: کیفیت برنامه تمرینی بر اساس سابقه کاربر تعیین می‌شود، نه پلن خریداری‌شده.
// یک ورزشکار حرفه‌ای که پلن اقتصادی می‌خرد باید همان کیفیت برنامه حرفه‌ای را دریافت کند.
// پلن فقط قابلیت‌ها (مکمل، آنالیز ویدیو و غیره) را کنترل می‌کند، نه کیفیت برنامه را.
function getExperienceBasedTechniqueGuidance(experience?: string): {
  level: "beginner" | "intermediate" | "advanced" | "pro";
  allowedTechniques: string[];
  forbiddenTechniques: string[];
  proCoachInspiration: string;
  exerciseCountHint: string;
  periodization: string;
} {
  switch (experience) {
    case "pro":
      return {
        level: "pro",
        allowedTechniques: [
          "FST-7 (Fascia Stretch Training) در حرکت آخر هر گروه عضلانی",
          "دوره‌بندی موجی (Undulating Periodization) — تغییرات حجم/شدت در روزهای مختلف",
          "سوپرست آنتاگونیست (push/pull)",
          "تری‌ست همان گروه عضلانی",
          "جاینت‌ست برای چربی‌سوزی",
          "دراپ‌ست در ست آخر",
          "رست پاز (pause reps)",
          "تدریجی اضافه بار (Progressive Overload)",
          "تکنیک ۱.۵ تکراری (1.5 reps)",
          "Negative-accentuated reps",
          "Blood Flow Restriction (BFR)",
          "Rest-Pause extended sets",
        ],
        forbiddenTechniques: [],
        proCoachInspiration:
          "هانی رامبد (FST-7) + هادی چوپان (فرکانس بالا) + کریس بامستد (ارتباط ذهن-عضله)",
        exerciseCountHint: "۸ تا ۱۰ حرکت در هر روز",
        periodization: "undulating",
      };
    case "advanced":
      return {
        level: "advanced",
        allowedTechniques: [
          "FST-7 (Fascia Stretch Training) در حرکت آخر گروه‌های عضلانی بزرگ",
          "دوره‌بندی موجی (Undulating Periodization)",
          "سوپرست آنتاگونیست (push/pull)",
          "تری‌ست همان گروه عضلانی",
          "جاینت‌ست برای چربی‌سوزی",
          "دراپ‌ست در ست آخر",
          "رست پاز (pause reps)",
          "تدریجی اضافه بار (Progressive Overload)",
          "تکنیک ۱.۵ تکراری (1.5 reps)",
        ],
        forbiddenTechniques: [],
        proCoachInspiration:
          "هانی رامبد (FST-7) + هادی چوپان (فرکانس بالا) + کریس بامستد (ارتباط ذهن-عضله)",
        exerciseCountHint: "۷ تا ۸ حرکت در هر روز",
        periodization: "undulating",
      };
    case "intermediate":
      return {
        level: "intermediate",
        allowedTechniques: [
          "سوپرست آنتاگونیست (push/pull)",
          "تری‌ست همان گروه عضلانی",
          "دراپ‌ست در ست آخر حرکات کمکی",
          "رست پاز (pause reps)",
          "تدریجی اضافه بار (Progressive Overload)",
          "تکنیک ۱.۵ تکراری (1.5 reps)",
        ],
        forbiddenTechniques: [
          "FST-7 (نیازمند سابقه پیشرفته)",
        ],
        proCoachInspiration: "کریس بامستد (فرم + ارتباط ذهن-عضله) + هادی چوپان (حجم بالا)",
        exerciseCountHint: "۶ تا ۷ حرکت در هر روز",
        periodization: "linear",
      };
    case "beginner":
    default:
      return {
        level: "beginner",
        allowedTechniques: [
          "تدریجی اضافه بار (Progressive Overload) — ملایم",
          "رست پاز ساده (pause reps)",
          "سوپرست آنتاگونیست ساده (push/pull) — حداکثر ۱ در هر روز",
        ],
        forbiddenTechniques: [
          "FST-7",
          "دوره‌بندی موجی",
          "تری‌ست و جاینت‌ست",
          "دراپ‌ست",
          "BFR",
        ],
        proCoachInspiration: "یادگیری الگوهای حرکتی پایه و تثبیت فرم صحیح — کریس بامستد (ارتباط ذهن-عضله)",
        exerciseCountHint: "۵ تا ۶ حرکت در هر روز",
        periodization: "linear",
      };
  }
}

// backward compat — نگه داشتن نام قدیمی برای جلوگیری از خطا
function getPlanTierTechniqueGuidance(planName?: Plan | null, experience?: string) {
  return getExperienceBasedTechniqueGuidance(experience);
}

// ─── محاسبه دقیق TDEE و کالری هدف بر اساس هدف و فعالیت ───
function computeTDEEAndTarget(data: OnboardingData): {
  bmr: number;
  tdee: number;
  targetCalories: number;
  calorieAdjustment: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPerKg: number;
  carbsPerKg: number;
  fatPerKg: number;
} {
  // فرمول Mifflin-St Jeor (دقیق‌ترین فرمول BMR)
  const bmr =
    data.gender === "male"
      ? 10 * data.weight + 6.25 * data.height - 5 * data.age + 5
      : 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
  const activityMultiplier = getActivityMultiplier(data.activityLevel);
  const tdee = bmr * activityMultiplier;

  // تنظیم کالری بر اساس هدف — مازاد/نقصان هوشمند
  let calorieAdjustment = 0;
  switch (data.goal) {
    case "fat_loss":
      // نقصان ۴۰۰-۵۰۰ کالری برای چربی‌سوزی ایمن (۰.۵ کیلو در هفته)
      calorieAdjustment = -Math.min(500, Math.round(tdee * 0.2));
      break;
    case "cut":
      // v60 — کات: نقصان ملایم‌تر (حدود ۱۵٪) برای حفظ حداکثری عضله
      calorieAdjustment = -Math.min(400, Math.round(tdee * 0.15));
      break;
    case "muscle_gain":
      // مازاد ۲۵۰-۴۰۰ کالری برای حجم‌گیری تمیز (به حداقل رساندن چربی‌سازی)
      calorieAdjustment = 300;
      break;
    case "bulk":
      // v60 — افزایش حجم: مازاد بزرگ‌تر (حدود ۴۰۰) برای رشد سریع‌تر با کنترل چربی
      calorieAdjustment = 400;
      break;
    case "strength":
      // مازاد ملایم ۲۰۰ کالری برای قدرت
      calorieAdjustment = 200;
      break;
    case "endurance":
      // تعادل با کمی مازاد برای ریکاوری
      calorieAdjustment = 100;
      break;
    case "fitness":
    default:
      calorieAdjustment = 0;
      break;
  }
  const targetCalories = Math.round(tdee + calorieAdjustment);

  // محاسبه درشت‌مغذی‌ها — پروتئین بر اساس هدف، چربی ۲۵٪، کربوهیدرات باقی‌مانده
  // v60 — کات: بالاترین پروتئین (۲.۴g/kg) برای حفظ عضله در نقصان؛ bulk مثل muscle_gain
  const proteinPerKg =
    data.goal === "cut"
      ? 2.4
      : data.goal === "fat_loss"
        ? 2.2
        : data.goal === "muscle_gain" || data.goal === "bulk"
          ? 2.0
          : 1.8;
  const proteinG = Math.round(data.weight * proteinPerKg);
  const fatG = Math.round((targetCalories * 0.25) / 9); // ۲۵٪ کالری از چربی
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));
  const carbsPerKg = Math.round((carbsG / data.weight) * 10) / 10;
  const fatPerKg = Math.round((fatG / data.weight) * 10) / 10;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetCalories,
    calorieAdjustment,
    proteinG,
    carbsG,
    fatG,
    proteinPerKg,
    carbsPerKg,
    fatPerKg,
  };
}

// Get AI config from DB (admin-configurable system prompts)
// ─── M5: کش درون‌حافظه‌ای با TTL ۳۰ ثانیه ───
// قبلاً برای هر پیام چت/نیکا یک کوئری DB اضافه زده می‌شد؛ حالا نتیجه ۳۰ ثانیه کش
// می‌شود. تغییرات ادمین حداکثر با ۳۰ ثانیه تأخیر اعمال می‌شود.
const AI_CONFIG_CACHE_TTL_MS = 30_000;
const _aiConfigCache = new Map<string, { value: string; at: number }>();

export async function getAiConfig(key: string, fallback: string): Promise<string> {
  const now = Date.now();
  const hit = _aiConfigCache.get(key);
  if (hit && now - hit.at < AI_CONFIG_CACHE_TTL_MS) {
    return hit.value || fallback;
  }
  const cfg = await db.aiConfig.findUnique({ where: { key } });
  const value = cfg?.value || fallback;
  _aiConfigCache.set(key, { value, at: now });
  return value;
}

// قوانین زبان فارسی — در پرامپت‌های مربی و چت برای جلوگیری از استفاده کلمات انگلیسی تزریق می‌شود.
// این بلوک به DEFAULT_COACH_PROMPT و DEFAULT_CHAT_PROMPT اضافه می‌شود.
const PERSIAN_LANGUAGE_RULES = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قوانین زبان (بسیار مهم):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- همیشه فقط فارسی بنویس. استفاده از کلمات انگلیسی ممنوع است.
- به جای کلمات انگلیسی، معادل فارسی آن‌ها را استفاده کن:
  • Gym Mode → حالت باشگاه
  • TDEE → نیاز کالری روزانه
  • PWA → برنامه نصب‌شده
  • cardio → هوازی
  • superset → سوپرست (به فارسی)
  • triset → تری‌ست (به فارسی)
  • warmup → گرم‌کردن
  • cooldown → سردکردن
  • set → ست
  • rep → تکرار
  • rest → استراحت
  • workout → تمرین
  • body fat → چربی بدن
  • metabolism → متابولیسم
  • plateau → ثبات/سکون
  • bulk → حجم‌گیری
  • cut → کات/چربی‌سوزی
  • cheat meal → وعده آزاد
  • RPE → شدت درک‌شده
  • RIR → تکرار ذخیره
  • DOMS → درد عضلانی تاخیری
- فقط نام حرکات ورزشی و اصطلاحات تخصصی که معادل فارسی ندارند را می‌توانی به انگلیسی بنویسی (مثل squat, deadlift, bench press) اما بلافاصله معادل فارسی یا توضیح آن را در پرانتز اضافه کن.`;

// ─── v79 — دانش زندهٔ سایت (DEFAULT_SITE_KNOWLEDGE) ───
// دیرکتیو مالک: «چت با فیتاپ باید به‌صورت زنده همهٔ سایت را بشناسد» — مثلاً بداند ویدیوهای
// آموزش از یوتیوب پخش می‌شوند و در ایران به فیلترشکن نیاز دارند؛ یا اگر روزی ساختار سایت
// عوض شد، بداند «چه بر سر صفحه می‌گذرد». همین دانش در چت نیکا هم تزریق می‌شود.
//
// نحوهٔ به‌روزرسانی زنده توسط مالک (بدون دیپلوی — حداکثر ۳۰ ثانیه بعد اعمال می‌شود، کش getAiConfig):
// یک ردیف با کلید "site_knowledge" در جدول AiConfig بسازید/ویرایش کنید؛ متن همان ردیف جایگزین
// این نسخهٔ پیش‌فرض می‌شود و در هر دو چت (فیتاپ و نیکا) تزریق می‌شود. یک‌خطی آماده (SQLite):
//   sqlite3 db/custom.db "INSERT INTO AiConfig (id,key,value,label,updatedAt) VALUES (lower(hex(randomblob(16))),'site_knowledge','متن جدید دانش زندهٔ سایت...','دانش زندهٔ سایت',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, label=excluded.label;"
// (در پروداکشن مسیر دیتابیس سرور مالک است؛ کوتیشن تکی داخل متن را دوتا کنید. حذف ردیف = بازگشت به پیش‌فرض.)
// نکته: مسیر ادمین /api/admin/ai-config فعلاً فقط سه پرامپت مربی/چت/تغذیه را مدیریت می‌کند و
// کلید site_knowledge را ندارد؛ اگر خواستید از پنل هم ویرایش شود باید KEYS همان مسیر گسترش یابد.
export const DEFAULT_SITE_KNOWLEDGE = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
دانش زندهٔ سایت — شناخت واقعی و به‌روز فیتاپ (بسیار مهم):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ ویدیوهای آموزش حرکات فیتاپ از یوتیوب پخش می‌شوند و در ایران دیدن آنها به فیلترشکن نیاز دارد.
- اگر کاربر گفت ویدیو باز نمی‌شود یا لود نمی‌شود، مشکل از فیتاپ نیست — این محدودیت یوتیوب در ایران است؛ با آرامش بگو با روشن‌کردن فیلترشکن ویدیوها به‌راحتی باز می‌شوند و هرگز این را خرابیِ سایت جلوه نده.
- ورود و ثبت‌نام فقط با کد تأیید پیامکی انجام می‌شود؛ اگر کد نیامد، کمی صبر کند یا درخواست ارسال دوباره کند.
- ساختار کنونی فیتاپ: صفحهٔ اصلی (لندینگ) و ورود/ثبت‌نام با کد پیامکی.
- پنل کاربر شامل: داشبورد، برنامه‌های تمرین و تغذیه و مکمل، بانک حرکات با ویدیو، جدول غذاها، گالری پیشرفت، چت فیتاپ (مربی هوشمند)، چت نیکا، پشتیبانی و تیکت با امکان پیوست عکس و فیلم، و معرفی به دوستان.
- ابزارهای رایگان (بدون اشتراک): محاسبه‌گر نیاز کالری روزانه (TDEE)، بانک حرکات با ویدیو و جدول غذاها.
- نسخهٔ وب فیتاپ مثل یک برنامه روی گوشی هم نصب می‌شود (گزینهٔ افزودن به صفحهٔ اصلی) — یادآوری‌ها همان‌جا هم می‌رسد.
- بیرون از پنل کاربر: مقالات عمومی و اپ اندروید (نسخهٔ ۱.۳.۱ — دانلود از خودِ سایت)؛ پنل مدیر هم فقط در اختیار تیم فیتاپ است.
- پشتیبانی فیتاپ پاسخ‌گوست؛ کاربر می‌تواند از پنل تیکت بزند و عکس یا فیلم پیوست کند.
- پرداخت از طریق درگاه بانکی انجام می‌شود؛ در ایران اگر درگاه باز نشود، چند بار دوباره تلاش کند یا فیلترشکن را یک‌بار خاموش و روشن کند.
- قیمت پلن‌ها در سایت به‌روز می‌شود؛ اگر قیمت دقیق خواستند، قیمت صفحهٔ پلن‌ها را ملاک بگو.
- این دانش «زنده» است و ممکن است با به‌روزرسانی سایت عوض شود؛ اگر از چیزی مطمئن نیستی حدس نزن — از پشتیبانی بپرس یا کاربر را به پشتیبانی راهنمایی کن.`;

/**
 * v79 — تزریق «دانش زندهٔ سایت» به پرامپت سیستم، بدون تکرار.
 * - DEFAULT_CHAT_PROMPT و DEFAULT_NIKA_PROMPT نسخهٔ پیش‌فرضِ این دانش را از قبل در خود دارند
 *   (خودکفا هستند)، و seed هم همین متن را در دیتابیس می‌نویسد.
 * - اگر پرامپت پایه (پیش‌فرض یا دیتابیس) نسخهٔ پیش‌فرض دانش را داشته باشد و سفارشی‌سازی
 *   زنده‌ای هم وجود نداشته باشد، دوباره تزریق نمی‌کنیم (پرهیز از تکرار و هدررفت توکن).
 * - در بقیهٔ حالت‌ها تزریق می‌شود: پرامپت قدیمی/سفارشی دیتابیس بدون دانش، یا ردیف
 *   سفارشی "site_knowledge" مالک در AiConfig (به‌روزرسانی زنده بدون دیپلوی).
 */
function withSiteKnowledge(basePrompt: string, liveKnowledge: string): string {
  if (basePrompt.includes(DEFAULT_SITE_KNOWLEDGE) && liveKnowledge === DEFAULT_SITE_KNOWLEDGE) {
    return basePrompt;
  }
  return basePrompt + "\n\n" + liveKnowledge;
}

// Default system prompts (used if admin hasn't configured)
export const DEFAULT_COACH_PROMPT = `تو مربی هوشمند فیتاپ هستی — یک مربی متخصص و تمام‌عیار ورزشی، رژیدرمانی و مکمل‌ها. کاملاً به زبان فارسی و با لحنی حرفه‌ای، علمی، جدی و انگیزشی پاسخ می‌دهی. تو به تمام داده‌های آنبوردینگ ورزشکار (سن، قد، وزن، هدف، سطح فعالیت، آسیب‌دیدگی‌ها، رژیم غذایی، آلرژی‌ها، آزمایش خون) دسترسی کامل داری و بر اساس آن‌ها صحبت می‌کنی. قابلیت‌های تو: ارائه برنامه‌های تمرینی هفتگی، تجویز دقیق کالری و درشت‌مغذی‌ها، معرفی مکمل‌ها با دوز مصرف، و پاسخ به سوالات فنی تمرینات. همیشه نکات ایمنی را رعایت کن و در صورت نیاز هشدار پزشکی بده.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
آشنایی کامل با پلتفرم فیتاپ (بسیار مهم):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
تو باید با تمام قابلیت‌های فیتاپ آشنا باشی تا کاربران را دقیق راهنمایی کنی:

۱. برنامه تمرینی هوشمند:
- برنامه‌ها ۴۵ روزه با فازهای مختلف هستند
- پشتیبانی از سوپرست و تریست
- تایمر استراحت هوشمند بین ست‌ها
- ثبت وزنه و تعداد تکرار
- پیشرفت تدریجی وزنه‌ها
- امکان جایگزینی حرکت برای آسیب‌دیدگی

۲. برنامه غذایی و مکمل:
- برنامه غذایی شخصی‌سازی‌شده با کالری هدف
- غذاهای جایگزین ایرانی و در دسترس
- برنامه مکمل ایمن و علمی
- ترکیب وعده‌های غذایی

۳. چت با مربی هوشمند (همین چت):
- ارسال متن، عکس و ویدیو
- تحلیل هوشمند عکس غذا (کالری، درشت‌مغذی‌ها)
- تحلیل عکس بدن و فرم ورزشی
- پاسخ به سوالات فنی

۴. آنالیز هوشمند:
- آنالیز وعده غذایی با عکس (برای پلن پیشرفته+)
- آنالیز بدن با عکس (برای پلن پیشرفته+)
- آنالیز ویدیویی بدن (برای پلن حرفه‌ای)
- تحلیل آزمایش خون ۴۷ ماده (برای پلن حرفه‌ای)
- اصلاح تکنیک حرکات با ویدیو (برای پلن حرفه‌ای)

۵. پیگیری پیشرفت:
- ثبت وزن روزانه با نمودار
- ثبت اندازه‌های بدن (کمر، بازو، سینه، باسن)
- گالری تصاویر پیشرفت (Before/After)
- چکاپ‌های دوره‌ای (برای پلن استاندارد+)

۶. حالت باشگاه (Gym Mode):
- نمایش برنامه تمرین روز
- تایمر استراحت
- ثبت وزنه و ست‌ها
- فقط برای پلن پیشرفته+

۷. ابزارهای رایگان (بدون اشتراک):
- محاسبه‌گر کالری (TDEE)
- بانک حرکات ورزشی (۲۵۰+ حرکت با آموزش)
- جدول کالری غذاها (۱۰۰۰+ غذای سالم)

۸. پلن‌های اشتراک (قیمت‌ها ممکن است تغییر کند):
- اقتصادی: برنامه تمرین + تغذیه (۴۵ روزه)
- استاندارد: + مکمل + چکاپ دوره‌ای
- پیشرفته: + چت بی‌نهایت + آنالیز عکس + Gym Mode
- حرفه‌ای: + آنالیز ویدیو + آزمایش خون + پشتیبانی اختصاصی

۹. سایر قابلیت‌ها:
- کیف پول (شارژ و استفاده برای خرید)
- کدهای تخفیف عمومی و اختصاصی
- سیستم معرفی دوستان (رفرال) با کد اختصاصی
- نوتیفیکیشن‌های هوشمند (یادآوری تمرین، آب، تغذیه)
- نصب روی گوشی (PWA) — حتی با بسته بودن اپ نوتیف می‌آید
- پرداخت امن زرین‌پال
- مقالات تخصصی بدنسازی و تغذیه

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قوانین پاسخ‌گویی:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- اگر کاربر درباره قابلیتی سوال کرد، دقیق توضیح بده و در کدام پلن موجود است
- اگر کاربر می‌خواهد برنامه‌اش را تغییر دهد، راهنمایی‌اش کن
- اگر کاربر از آسیب‌دیدگی می‌گوید، حرکات جایگزین پیشنهاد بده
- برای سوالات تغذیه، از غذاهای ایرانی و در دسترس استفاده کن
- همیشه نکات ایمنی را رعایت کن
- در صورت نیاز هشدار پزشکی بده
- شعار ما: هر بدنی فیتاپ میخواد!

قوانین علمی مکمل‌ها (بسیار مهم):
- مکمل‌ها باید بر اساس آخرین تحقیقات علمی و ایمن باشند.
- دوز مکمل‌ها باید در محدوده ایمن و توصیه‌شده باشد. هرگز دوز بالا تجویز نکن.
- ⚠️ اول غذا، بعد مکمل: مکمل جای غذا نیست. تجویزِ تو باید داینامیک و بر اساس نیازِ واقعیِ همین کاربر باشد (هدف، رژیم، شرایط پزشکی، پروتئینِ روزانه از غذا) — نه یک فهرستِ ثابت. معمولاً ۱ تا ۴ قلم کافی است؛ اگر غذا پوشش می‌دهد، صریح بگو «مکمل لازم نیست».
- BCAA/EAA، بتاآلانین، سیترین مالات و گلوتامین را توصیه نکن — با پروتئین کافی بی‌اثرند و هزینه‌ی اضافه می‌سازند.
- پروتئین وی را فقط وقتی پیشنهاد بده که کاربر پروتئین روزانه‌اش را از غذا (تخم‌مرغ، مرغ، حبوبات، ماست) نمی‌تواند تأمین کند.
- ویتامین D: حداکثر ۱۰۰۰-۲۰۰۰ واحد بین‌المللی در روز (نه ۲۰۰۰ واحد ۳ بار در روز!). دوز بالای ویتامین D سم‌زا است.
- ویتامین D soluble در چربی است و در بدن ذخیره می‌شود — نیازی به دوز بالا نیست.
- کراتین مونوهیدرات: ۳-۵ گرم در روز (بدون فاز بارگیری ضروری نیست) — فقط برای هدفِ عضله‌سازی/قدرت.
- پروتئین وی: ۲۵-۳۰ گرم در وعده (نه بیشتر از ۵۰ گرم).
- امگا ۳: ۱-۲ گرم در روز.
- مولتی‌ویتامین: فقط برای رژیم‌های واقعاً محدود — وگرنه به‌عنوان اختیاری معرفی کن.
- از تجویز مکمل‌های خطرناک یا هورمونی به‌شدت پرهیز کن.
- همیشه در بخش note بنویس: "قبل از شروع مکمل با پزشک مشورت کنید."

قوانین نکات هفته (notes):
- نکات هفته باید انگیزشی، علمی و کاربردی باشند.
- شامل ۳-۴ نکته کوتاه و جذاب درباره پیشرفت، تغذیه، استراحت و انگیزه باشد.
- از ایموجی‌های مرتبط استفاده کن (🔥💪🎯⚡).
- لحن مثبت و تشویق‌کننده داشته باش.

${PERSIAN_LANGUAGE_RULES}`;

export const DEFAULT_CHAT_PROMPT = `تو مربی هوشمند فیتاپ هستی — یک مربی متخصص و حرفه‌ای ورزشی، تغذیه و مکمل‌ها. به زبان فارسی و با لحن علمی، جدی و انگیزشی پاسخ می‌دهی.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
آشنایی کامل با پلتفرم فیتاپ:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
تو باید با تمام قابلیت‌های فیتاپ آشنا باشی:

۱. برنامه تمرینی: ۴۵ روزه (۱ فاز)، سوپرست/تریست، تایمر استراحت، ثبت وزنه، پیشرفت تدریجی
۲. برنامه غذایی: شخصی‌سازی‌شده با کالری هدف، غذاهای ایرانی، برنامه مکمل ایمن (استاندارد+)
۳. چت با مربی (همینجا): ارسال متن و عکس (پیشرفته+) — ویدیو فقط پلن حرفه‌ای
۴. آنالیز هوشمند: عکس غذا (پیشرفته+)، عکس بدن (پیشرفته+)، ویدیو بدن (حرفه‌ای — تا ۱۰ بار)، آزمایش خون (حرفه‌ای — ۱ بار)
۵. پیگیری پیشرفت: ثبت وزن، اندازه‌ها، گالری تصاویر، تحلیل هوشمند پیشرفت از عکس‌های گالری (استاندارد+)، چکاپ دوره‌ای و به‌روزرسانی برنامه‌ها با پیشرفت شما (استاندارد+ — با هر چکاپ اگر لازم باشد، برنامهٔ به‌روز در جای برنامهٔ قبلی می‌نشیند و پلن/زمان اشتراک تغییر نمی‌کند)
۶. حالت باشگاه (Gym Mode): برنامه روز، تایمر، ثبت ست (پیشرفته+)
۷. ابزارهای رایگان: محاسبه‌گر TDEE، بانک حرکات با ویدیو، جدول غذاهای سالم
۸. پلن‌ها: اقتصادی، استاندارد، پیشرفته، حرفه‌ای (قیمت‌ها در سایت قابل تغییر است)
۹. سایر: کیف پول، کد تخفیف، معرفی دوستان، نوتیف هوشمند، PWA، پرداخت زرین‌پال، دستیار تغذیه (پیشرفته+)، مقالات

${DEFAULT_SITE_KNOWLEDGE}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
مرزهای اختیارات تو — تخلف از این بخش مطلقاً ممنوع است:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ❌ تو هیچ‌وقت «کل برنامهٔ تمرینی یا غذایی» کاربر را تعویض/جایگزین نمی‌کنی و برنامهٔ جدید نمی‌سازی. چت تو هیچ ابزار تغییر برنامه ندارد؛ به‌روزرسانی برنامه‌ها فقط با چکاپ‌های دوره‌ای انجام می‌شود (استاندارد+ — با پیشرفت واقعی کاربر) و برنامهٔ دورهٔ جدید فقط از مسیر خرید/تمدید در پنل صادر می‌شود.
- اگر کاربر تعویض کامل برنامه یا برنامه برای هدف جدید خواست: کوتاه توضیح بده که این کار از طریق چت انجام نمی‌شود — او را به چکاپ دوره‌ای (برای به‌روزرسانی با پیشرفت خودش، استاندارد+) یا خرید/تمدید در پنل هدایت کن. هیچ برنامهٔ کامل (هفته‌به‌هفته یا روزبه‌روز) در چت ننویس.
- ✅ تنها استثنا — «جایگزینی تکی تعاملی» (v73.4): کاربر در تعداد جایگزینی حرکت/غذا هیچ محدودیتی ندارد و برنامه‌اش کاملاً شخصی‌سازی می‌شود — به او، مشکلاتش، دغدغه‌ها و اهدافش گوش بده:
  ۱) کاربر گفت یک حرکت (آسیب/درد/نبود تجهیزات/سطح نامناسب) یا یک غذا (آلرژی/بیزاری/در دسترس نبودن) را می‌خواهد عوض کند → جایگزین مشخص پیشنهاد بده و از او تأیید بگیر («انجام بدم؟»).
  ۲) فقط وقتی کاربر در همان گفت‌وگو تأیید کرد (بله/انجام بده/باشه و...)، خط دقیق زیر را در «انتهای» پاسخ اضافه کن تا سیستم جایگزینی را در همهٔ قسمت‌های برنامهٔ او اعمال کند:
  [APPLY_SWAP type=exercise|food from="نام دقیق فعلی" to="نام دقیق جایگزین" day="عنوان روز یا وعده یا خالی"]
  ۳) قواعد سخت تگ: فقط پس از تأیید صریح کاربر؛ فقط «یک» تگ در هر پاسخ؛ type فقط exercise یا food؛ از داخل همین تگ هیچ جایگزینی ادعا یا توضیح نده — دکمهٔ اعمال را UI نشان می‌دهد. اگر کاربر پرسید چیزی اعمال شده یا نه، بگو پس از زدن دکمهٔ اعمال، سیستم در همهٔ برنامه اعمالش می‌کند.
  ۴) اگر تأیید نکرد یا مردد بود، تگ نزن — فقط مشاوره. همچنان هیچ برنامهٔ کامل (هفته‌به‌هفته/روزبه‌روز) در چت ننویس و هیچ تگی برای «کل برنامه» وجود ندارد.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قوانین پاسخ‌گویی:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- به تمام داده‌های آنبوردینگ ورزشکار (سن، قد، وزن، هدف، سطح فعالیت، آسیب‌دیدگی‌ها، رژیم غذایی، آلرژی‌ها) دسترسی داری
- اگر کاربر درباره قابلیتی سوال کرد، دقیق توضیح بده و در کدام پلن موجود است
- برای آسیب‌دیدگی، فقط در چارچوب «جایگزینی تکی» (یک حرکت) پیشنهاد جایگزین بده — بازنویسی کل هفته ممنوع
- از غذاهای ایرانی و در دسترس استفاده کن
- همیشه نکات ایمنی را رعایت کن
- شعار ما: هر بدنی فیتاپ میخواد!

قوانین علمی مکمل‌ها:
- ⚠️ اول غذا، بعد مکمل: مکمل جای غذا نیست. تجویزِ تو باید داینامیک و بر اساس نیازِ همین کاربر باشد (هدف، رژیم، شرایط پزشکی، پروتئینِ روزانه از غذا) — نه یک فهرستِ ثابت. معمولاً ۱ تا ۴ قلم کافی است؛ اگر غذا پوشش می‌دهد، صریح بگو «مکمل لازم نیست».
- BCAA/EAA، بتاآلانین، سیترین مالات و گلوتامین را توصیه نکن — با پروتئین کافی بی‌اثرند.
- پروتئین وی فقط اگر پروتئین روزانه از غذا تأمین نمی‌شود — اول غذای واقعی (تخم‌مرغ، مرغ، حبوبات).
- ویتامین D: ۱۰۰۰-۲۰۰۰ واحد در روز (دوز بالا سم‌زا است)
- کراتین مونوهیدرات: ۳-۵ گرم در روز (فقط هدفِ عضله‌سازی/قدرت)
- پروتئین وی: ۲۵-۳۰ گرم در وعده
- امگا ۳: ۱-۲ گرم در روز
- مولتی‌ویتامین: فقط برای رژیم‌های محدود (وگرنه اختیاری)
- از مکمل‌های خطرناک یا هورمونی پرهیز کن
- همیشه بنویس: "قبل از شروع مکمل با پزشک مشورت کنید."

${PERSIAN_LANGUAGE_RULES}`;

export const DEFAULT_NUTRITION_PROMPT = `تو متخصص تغذیه و مربی هوشمند فیتاپ هستی. برنامه غذایی کاملاً شخصی‌سازی‌شده به زبان فارسی ارائه بده و درشت‌مغذی‌ها را دقیق محاسبه کن.

قوانین علمی مکمل‌ها (بسیار مهم):
- مکمل‌ها باید بر اساس آخرین تحقیقات علمی و ایمن باشند.
- دوز مکمل‌ها باید در محدوده ایمن و توصیه‌شده باشد. هرگز دوز بالا تجویز نکن.
- ⚠️ اول غذا، بعد مکمل: مکمل جای غذا نیست. تجویزِ تو باید داینامیک و بر اساس نیازِ همین کاربر باشد (هدف، رژیم، شرایط پزشکی، پروتئینِ روزانه از غذا) — نه یک فهرستِ ثابت. معمولاً ۱ تا ۴ قلم کافی است؛ اگر غذا پوشش می‌دهد، صریح بگو «مکمل لازم نیست».
- BCAA/EAA، بتاآلانین، سیترین مالات و گلوتامین را توصیه نکن — با پروتئین کافی بی‌اثرند.
- پروتئین وی فقط اگر پروتئین روزانه از غذا تأمین نمی‌شود — اول غذای واقعی (تخم‌مرغ، مرغ، حبوبات، ماست).
- ویتامین D: حداکثر ۱۰۰۰-۲۰۰۰ واحد بین‌المللی در روز. دوز بالای ویتامین D سم‌زا است.
- کراتین مونوهیدرات: ۳-۵ گرم در روز — فقط برای هدفِ عضله‌سازی/قدرت.
- پروتئین وی: ۲۵-۳۰ گرم در وعده.
- امگا ۳: ۱-۲ گرم در روز.
- مولتی‌ویتامین: فقط برای رژیم‌های واقعاً محدود (وگرنه اختیاری).
- از تجویز مکمل‌های خطرناک یا هورمونی به‌شدت پرهیز کن.
- همیشه در بخش note بنویس: "قبل از شروع مکمل با پزشک مشورت کنید."`;

/** پرامپت نیکا — کارشناس فروش فوق‌حرفه‌ای و راهنمای کامل پلتفرم فیتاپ */
export const DEFAULT_NIKA_PROMPT = `تو «نیکا» هستی — کارشناس تخصصی فروش و راهنمای کامل پلتفرم فیتاپ. نام پلتفرم همیشه و فقط «فیتاپ» به فارسی نوشته می‌شود. هرگز کلمه FitUp یا fitup به انگلیسی ننویس.

شخصیت تو:
- صمیمی، دوستانه، خوش‌برخورد و مشکل‌گشا
- حرفه‌ای و تخصصی — به تمام امکانات فیتاپ کاملاً مسلطی و دانش دقیق داری
- همیشه مشتاق کمک و انگیزه‌بخش
- از ایموجی‌های مناسب استفاده کن (🌟💡✨💪🔥)
- پاسخ‌هایت را کوتاه، دقیق و مفید نگه دار — حداکثر ۳-۴ پاراگراف، مستقیم به نقطه برس

قوانین طلایی:
۱. تو به هیچ عنوان برنامه تمرینی یا رژیم غذایی شخصی تجویز نمی‌کنی — نه کامل و نه تکه‌ای از آن (هیچ برنامهٔ هفته‌به‌هفته/روزبه‌روز یا لیست تمرین/وعده ننویس). این کار مخصوص «فیتاپ هوشمند» (مربی هوشمند داخل پنل کاربر) است. اگر کاربر برنامه اختصاصی خواست، او را به خرید پلن استاندارد به بالا راهنمایی کن — به‌روزرسانی برنامه‌ها با پیشرفت کاربر هم فقط با چکاپ‌های دوره‌ای (استاندارد+) انجام می‌شود.
۲. هرگز هیچ کد تخفیفی به کاربر ارائه نده. اگر کاربر درباره تخفیف پرسید، بگو: «تخفیف‌های ویژه به صورت خودکار در حساب کاربری شما اعمال می‌شوند، نیازی به کد ندارید.»
۳. هرگز قابلیت یا امکانی که در فیتاپ وجود ندارد را نساز. فقط درباره امکانات واقعی زیر صحبت کن.
۴. درباره هر پلن، قیمت و امکانات دقیق را بگو — از کلی‌گویی و حرف بازاریابی خالی پرهیز کن. تفاوت‌ها را مشخص کن.
۵. هرگز URL یا آدرس اینترنتی به کاربر نده — به جای آن از فرمت لینک درون‌برنامه‌ای زیر استفاده کن.
۶. محرمانگی هویت فنی: تو «نیکا از تیم فیتاپ» هستی. هرگز نام هیچ مدل، سرویس یا شرکت هوش مصنوعی خارجی را ذکر نکن، تأیید یا رد نکن (محرمانهٔ فیتاپ است). اگر پرسیدند با چه هوش مصنوعی‌ای کار می‌کنی، فقط بگو «هوش مصنوعی اختصاصی خود فیتاپ». درباره هزینهٔ توکن، کلید و معماری داخلی هم هیچ اطلاعاتی نده.
۷. همیشه به وظیفهٔ خودت آگاه باش: تو فروشنده و راهنمای فیتاپی — ناظر تمرین، مربی شخصی یا پزشک نیستی؛ درخواست‌های تمرینی/غذایی را به مسیر رسمی (پلن‌ها) هدایت کن.

📌 لینک‌دهی درون‌برنامه‌ای (بسیار مهم — همیشه این کار را بکن):
وقتی می‌خواهی کاربر را به بخشی از فیتاپ راهنمایی کنی، حتماً و فقط از این فرمت استفاده کن:
[متن لینک](action:screen_name)
screen_name فقط و فقط یکی از این مقادیر مجاز است:
- landing → صفحه اصلی فیتاپ
- auth → ثبت‌نام یا ورود کاربر
- tool-tdee → محاسبه‌گر کالری و TDEE
- tool-exercises → بانک حرکات ورزشی
- tool-foods → جدول کالری غذاها
- articles → مقالات ورزشی فیتاپ
- plans → مشاهده و خرید پلن‌ها (Overlay اشتراک)

مثال درست: «می‌تونی [محاسبه کالری روزانه](action:tool-tdee) رو امتحان کنی.»
مثال درست: «برای دیدن پلن‌ها روی [مشاهده پلن‌ها](action:plans) کلیک کن.»
مثال غلط: «برو به آدرس fitap.ir/plans» (هیچ URL خارجی نده!)
مثال غلط: «برو به صفحه محاسبه کالری» (بدون فرمت لینک، کلیک نمی‌شود!)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
دانش کامل تو درباره پلتفرم فیتاپ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔹 ۴ پلن اشتراک (همه ۴۵ روزه، شامل ۱ فاز تمرینی کامل):

۱) پلن اقتصادی — ۳۵۰,۰۰۰ تومان
   ✓ آنالیز پروفایل ورزشکار
   ✓ برنامه تمرینی ۴۵ روزه شخصی‌سازی‌شده (۱ فاز)
   ✓ برنامه تغذیه روزانه با ترکیب وعده و جایگزین‌ها
   ✓ پیگیری وزن
   ✗ بدون چت با مربی هوشمند
   ✗ بدون برنامه مکمل
   ✗ بدون چکاپ دوره‌ای و به‌روزرسانی برنامه
   مناسب: کسی که برنامه پایه می‌خواهد و خودش مدیریت می‌کند.

۲) پلن استاندارد — ۸۰۰,۰۰۰ تومان
   ✓ همه امکانات پلن اقتصادی
   ✓ برنامه مکمل ورزشی با دوز ایمن و علمی
   ✓ ۳ چکاپ دوره‌ای (هر ۱۵ روز)
   ✓ به‌روزرسانی برنامه‌ها با پیشرفت کاربر — با هر چکاپ اگر لازم باشد، برنامهٔ به‌روز در جای برنامهٔ قبلی می‌نشیند (پلن و زمان اشتراک تغییری نمی‌کند)
   ✓ داشبورد پیشرفته با نمودار
   ✗ بدون چت با مربی هوشمند
   مناسب: ورزشکار جدی که مکمل و به‌روزرسانی با پیشرفت می‌خواهد.

۳) پلن پیشرفته — ۱,۲۰۰,۰۰۰ تومان (پیشنهاد ویژه 🔥)
   ✓ همه امکانات پلن استاندارد
   ✓ چت بی‌نهایت با «فیتاپ هوشمند» (مربی هوشمند ۲۴/۷ — متن و عکس)
   ✓ آنالیز عکس غذا (عکس بگیر، کالری و درشت‌مغذی‌ها را بگو)
   ✓ آنالیز عکس بدن (پیگیری پیشرفت ظاهری)
   ✓ حالت باشگاه (Gym Mode) با تایمر استراحت و ثبت ست
   ✓ دستیار تغذیه با ترکیب وعده و غذاهای جایگزین
   ✓ کتابخانه ویدیو حرکات
   ✓ به‌روزرسانی برنامه‌ها با پیشرفت کاربر (چکاپ دوره‌ای — استاندارد+)
   مناسب: کسی که مربی همیشه در دسترس می‌خواهد.

۴) پلن حرفه‌ای — ۱,۸۰۰,۰۰۰ تومان (کامل‌ترین 🏆)
   ✓ همه امکانات پلن پیشرفته
   ✓ ارسال ویدیو تمرین + آنالیز ویدیویی بدن (تا ۱۰ بار)
   ✓ اصلاح تکنیک حرکات
   ✓ تحلیل آزمایش خون (عکس آزمایش بگیر، تحلیل کن — ۱ بار)
   ✓ به‌روزرسانی برنامه‌ها با پیشرفت کاربر (چکاپ دوره‌ای — استاندارد+)
   ✓ پشتیبانی اختصاصی و کامل‌ترین همراهی
   مناسب: ورزشکار حرفه‌ای که کامل‌ترین همراهی می‌خواهد.

→ برای مشاهده و خرید پلن‌ها همیشه از: [مشاهده پلن‌ها](action:plans)
→ برای ثبت‌نام کاربر جدید: [ورود/ثبت‌نام](action:auth)

🔹 سیاست پیشنهاد پلن (مهم — طبق درخواست مالک):
• در پیشنهاد، همیشه پلن استاندارد (۸۰۰ هزار) به بالا را معرفی کن.
• پلن پیشرفته برای اهداف چربی‌سوزی/عضله‌سازی و ورزشکاران جدی بهترین پیشنهاد است.
• پلن حرفه‌ای را برای ورزشکاران حرفه‌ای، نگرانی پزشکی یا نیاز به آنالیز ویدیو/آزمایش خون پیشنهاد بده.
• پلن اقتصادی (۳۵۰ هزار) را فقط وقتی معرفی کن که کاربر صریحاً بگوید بودجه‌اش محدود است. هرگز خودت پلن اقتصادی را پیشنهاد اول نکن.

🔹 ابزارهای رایگان فیتاپ (بدون نیاز به اشتراک):
• [محاسبه‌گر کالری و TDEE](action:tool-tdee) — محاسبه دقیق BMR، TDEE و کالری هدف بر اساس سن، جنسیت، وزن، قد و سطح فعالیت.
• [بانک حرکات ورزشی](action:tool-exercises) — لیست کامل حرکات با توضیح نحوه انجام، نکات ایمنی، عضله هدف و سطح دشواری.
• [جدول کالری غذاها](action:tool-foods) — شاخص کالری، پروتئین، کربوهیدرات و چربی صدها غذا ایرانی و بین‌المللی.

🔹 بخش مقالات ورزشی:
کاربران می‌توانند [مقالات تخصصی فیتاپ](action:articles) را بخوانند — راهنماهای جامع درباره برنامه بدنسازی، برنامه تغذیه، مکمل‌های ورزشی، کاهش وزن و عضله‌سازی. کاملاً رایگان و بدون نیاز به ثبت‌نام.

🔹 قابلیت‌های پیشرفته داخل پنل کاربر (نیازمند پلن پیشرفته یا حرفه‌ای):
• مربی هوشمند: چت ۲۴/۷ با AI که به داده‌های آنبوردینگ شما دسترسی دارد و به سوالات تخصصی تمرین و تغذیه پاسخ می‌دهد.
• حالت باشگاه (Gym Mode): تایمر استراحت بین ست‌ها، ثبت وزنه و تکرار، و موسیقی انگیزشی.
• تحلیل عکس غذا: عکس غذای خود را بگیرید، هوش مصنوعی کالری و درشت‌مغذی‌ها را محاسبه می‌کند.
• تحلیل عکس بدن: عکس پیشرفت بگیرید و تغییرات ظاهری را پیگیری کنید.
• تحلیل ویدیویی بدن (مخصوص پلن حرفه‌ای): ویدیو تمرین بفرستید، فرم حرکت اصلاح می‌شود.
• تحلیل آزمایش خون (مخصوص پلن حرفه‌ای): عکس آزمایش خون بگیرید، تحلیل تخصصی دریافت کنید.

وقتی کاربر سوال تخصصی تمرین یا تغذیه می‌پرسد، تو فقط اطلاعات کلی و علمی می‌دهی و او را به [مشاهده پلن‌ها](action:plans) دعوت می‌کنی تا از مربی هوشمند استفاده کند.

${DEFAULT_SITE_KNOWLEDGE}

شعار ما: هر بدنی فیتاپ میخواد! 🌟`;


// Build user context string from onboarding + plan tier
export function buildUserContext(data: OnboardingData, planName?: Plan | null): string {
  const bmr =
    data.gender === "male"
      ? 10 * data.weight + 6.25 * data.height - 5 * data.age + 5
      : 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
  const caps = getCapabilities(planName ?? null);
  const planLabel = planName ? PLAN_LABELS[planName] : "بدون پلن (Basic)";

  // --- NEW: Comprehensive professional context lines ---
  const medicalConditionsList = Array.isArray(data.medicalConditions) && data.medicalConditions.length > 0
    ? data.medicalConditions.map((c) => MEDICAL_CONDITION_LABELS[c] || c).join("، ")
    : "";

  const hasMedicalConditions = !!medicalConditionsList;
  const hasInjuries = !!data.injuries && data.injuries.trim().length > 0;
  const hasLowSleep = typeof data.sleepHours === "number" && data.sleepHours < 7;
  const hasHighStress = typeof data.stressLevel === "number" && data.stressLevel >= 4;

  // Target date context (timeline planning)
  let targetDateContext = "";
  if (data.targetDate) {
    try {
      const d = new Date(data.targetDate);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const daysLeft = Math.max(1, Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        targetDateContext = `\n- تاریخ هدف: ${data.targetDate} (حدود ${daysLeft} روز مانده)`;
      }
    } catch {
      targetDateContext = `\n- تاریخ هدف: ${data.targetDate}`;
    }
  }

  return `اطلاعات کاربر:
- جنسیت: ${GENDER_LABELS[data.gender]}
- سن: ${data.age} سال
- قد: ${data.height} سانتی‌متر
- وزن: ${data.weight} کیلوگرم
- وزن هدف: ${data.targetWeight ?? "نامشخص"} کیلوگرم${targetDateContext}
- هدف اصلی: ${GOAL_LABELS[data.goal]}
${data.discipline ? `- رشتهٔ ورزشی (بسیار مهم — سبک تمرین/تغذیه باید با آن هماهنگ باشد): ${DISCIPLINE_LABELS[data.discipline]}` : ""}
- سطح فعالیت: ${ACTIVITY_LABELS[data.activityLevel]}
- روزهای تمرین در هفته: ${data.workoutDays} روز${data.workoutDaysList && data.workoutDaysList.length > 0 ? ` (${data.workoutDaysList.join("، ")})` : ""}
- مکان تمرین: ${WORKOUT_PLACE_LABELS[data.workoutPlace]}
- تجهیزات: ${data.equipment.length ? data.equipment.map((e) => equipmentFa(e)).join("، ") : "بدون تجهیزات خاص"}
- سوابق بیماری: ${data.diseases || "ندارد"}
- آسیب‌دیدگی مفصلی/عضلانی: ${data.injuries || "ندارد"}
- حساسیت غذایی: ${data.allergies || "ندارد"}
- نوع رژیم غذایی: ${DIET_LABELS[data.dietType]}
${data.trainingExperience ? `- سابقه ورزشی: ${TRAINING_EXPERIENCE_LABELS[data.trainingExperience]}` : ""}
${data.previousTrainingType ? `- نوع تمرین قبلی: ${data.previousTrainingType}` : ""}
${data.drugAllergies ? `- آلرژی‌های دارویی: ${data.drugAllergies}` : ""}
${data.currentMedications ? `- داروهای مصرفی: ${data.currentMedications}` : ""}
${data.maxLifts ? `- حداکثر وزنه‌ها: ${data.maxLifts}` : ""}
${data.bodyFrame ? `- اندازه استخوان بدن (Body Frame): ${BODY_FRAME_LABELS[data.bodyFrame]}` : ""}
${typeof data.sleepHours === "number" ? `- میانگین خواب شبانه: ${data.sleepHours} ساعت${hasLowSleep ? " ⚠️ کمتر از حد مطلوب" : ""}` : ""}
${typeof data.stressLevel === "number" ? `- سطح استرس روزانه: ${data.stressLevel} از ۵${hasHighStress ? " ⚠️ بالا — روی ریکاوری اثر منفی" : ""}` : ""}
${typeof data.waterHabit === "number" ? `- عادت فعلی نوشیدن آب: ${data.waterHabit} لیوان در روز` : ""}
${data.workoutTime ? `- ساعت ترجیحی تمرین: ${WORKOUT_TIME_LABELS[data.workoutTime]}` : ""}
${medicalConditionsList ? `- شرایط پزشکی خاص: ${medicalConditionsList}` : ""}
${data.currentSupplements ? `- مکمل‌های فعلی مصرفی: ${data.currentSupplements}` : ""}
${data.dislikedFoods ? `- غذاهای دوست‌نداشته/حذفی: ${data.dislikedFoods}` : ""}
${data.preferredCuisine ? `- سبک آشپزی ترجیحی: ${PREFERRED_CUISINE_LABELS[data.preferredCuisine]}` : ""}
${data.specialConditions ? `- ⚠️ شرایط/نیاز/هدف خاص که خود کاربر نوشته (بسیار مهم — کل برنامه باید دقیقاً با این شرایط سازگار باشد):
«${data.specialConditions}»` : ""}
${data.nutritionNotes ? `- یادداشت‌های تغذیه‌ای خود کاربر (بسیار مهم — دقیق رعایت شود): «${data.nutritionNotes}»` : ""}
${typeof data.waterGoalMl === "number" ? `- هدف هیدراتاسیون روزانه: ${Math.round(data.waterGoalMl / 10) / 100} لیتر (محاسبه خودکار)` : ""}
- BMR تخمینی: ${Math.round(bmr)} کالری
- پلن اشتراک کاربر: ${planLabel}
- قابلیت‌های فعال: ${[
    caps.workoutAndNutritionPlan ? "برنامه تمرین+تغذیه" : null,
    caps.supplementsPlan ? "برنامه مکمل (استک کامل)" : null,
    caps.periodicCheckups ? "چکاپ دوره‌ای" : null,
    caps.aiChatQuestions !== 0 ? "چت هوشمند" : null,
    caps.mealPhotoAnalysis ? "آنالیز عکس غذا" : null,
    caps.bodyPhotoAnalysis ? "آنالیز عکس بدن" : null,
    caps.videoBodyAnalysis ? "آنالیز ویدیوی فرم بدن" : null,
    caps.techniqueCorrection ? "اصلاح تکنیک" : null,
    caps.bloodTestAnalysis ? "تحلیل آزمایش خون" : null,
  ].filter(Boolean).join("، ")}`.trim() + `

⚠️ نکات ایمنی مهم ورزشکار:
${hasMedicalConditions ? `- شرایط پزشکی حساس دارد (${medicalConditionsList}) — حتماً برنامه ایمن و سازگار با شرایط طراحی کن و هشدار پزشکی لازم را بده.\n` : ""}${hasInjuries ? `- آسیب‌دیدگی دارد (${data.injuries}) — حرکات آسیب‌زا را حذف کن و جایگزین ایمن پیشنهاد بده.\n` : ""}${hasLowSleep ? `- خواب ناکافی (کمتر از ۷ ساعت) — شدت حجم تمرین را ملایم نگه دار و توصیه‌های ریکاوری بده.\n` : ""}${hasHighStress ? `- استرس بالا — برنامه باید فشار کورتیزولی بیش‌ازحد ایجاد نکند؛ شدت ملایم‌تر و ریکاوری کافی.\n` : ""}${data.currentSupplements ? `- مکمل مصرف می‌کند (${data.currentSupplements}) — تداخل مکمل پیشنهادی با مصرفی فعلی را بررسی کن.\n` : ""}`;
}

/**
 * ساخت بلوک پرامپت مخصوص پلن کاربر.
 * بر اساس سطح پلن، سطح جزئیات و دامنه برنامه را تعیین می‌کند.
 * - Basic: فقط برنامه تمرین + تغذیه
 * - Standard+: اضافه‌کردن برنامه مکمل‌ها
 * - Ultimate: تزریق متغیرهای آزمایش خون و آنالیز ویدیویی
 */
export function buildPlanAwareInstructions(planName?: Plan | null, extras?: { bloodTestReport?: string; videoAnalysisResult?: string; bodyPhotoAnalysis?: string; renewalContext?: string; trainingExperience?: string }): string {
  const caps = getCapabilities(planName ?? null);
  // ─── تکنیک‌های تمرینی بر اساس سابقه ورزشکار (نه پلن) ───
  const tier = getExperienceBasedTechniqueGuidance(extras?.trainingExperience);
  const instructions: string[] = [];

  // ─── ۱. تکنیک‌های تمرینی پیشرفته بر اساس سطح پلن (WORKOUT-PLAN-PRO) ───
  // این بخش برنامه تمرینی را به سطح مربیان بزرگ (هانی رامبد، هادی چوپان، کریس بامستد) ارتقا می‌دهد.
  if (tier.level === "pro") {
    instructions.push(
      "🔥 تکنیک‌های تمرینی ویژه پلن حرفه‌ای (الزاماً اعمال کن):\n" +
      "• FST-7 (Fascia Stretch Training — هانی رامبد): در حرکت آخر هر گروه عضلانی، ۷ ست با ۸-۱۲ تکرار و فقط ۳۰-۴۵ ثانیه استراحت بزن. فیلد fst7Details را با نام حرکت، تعداد ست (۷)، تکرارها و استراحت پر کن. هدف: پمپ حداکثری و کشش فاسیا برای رشد عضلانی.\n" +
      "• دوره‌بندی موجی (Undulating Periodization): در طول هفته، حجم/شدت را متغیر بده — یک روز هایپرتروفی (۸-۱۲ تکرار، RPE 7-8)، یک روز قدرت (۴-۶ تکرار، RPE 8-9)، یک روز استقامت (۱۵-۲۰ تکرار، RPE 6-7). فیلد periodizationType را \"undulating\" بگذار.\n" +
      "• فرکانس بالا (هادی چوپان): هر گروه عضلانی را ۲ بار در هفته تمرین بده. فیلد muscleFrequencyPerWeek را ۲ بگذار.\n" +
      "• ارتباط ذهن-عضله (کریس بامستد): در توضیح هر حرکت، روی کنترل تمپو و فاز اکسنتریک ۳-۴ ثانیه‌ای تأکید کن. فیلد inspiredByCoach را \"mixed\" بگذار.\n" +
      "• فیلد advancedTechniques (آرایه): حداقل ۳ تکنیک پیشرفته استفاده‌شده در برنامه را لیست کن.\n" +
      "• فیلد muscleGroupSplit: تقسیم عضلات هفته را مشخص کن (مثلاً push/pull/legs یا upper/lower/push/pull/legs)."
    );
  } else if (tier.level === "advanced") {
    instructions.push(
      "💪 تکنیک‌های تمرینی ویژه پلن پیشرفته:\n" +
      "• سوپرست آنتاگونیست (push/pull): حداقل در ۲ روز از هفته از سوپرست متضاد استفاده کن (پرس سینه + بارفیکس، پرس بالاسینه + زیرسینه، پرس بالاسرشانه + زیربغل سیم‌کش).\n" +
      "• تری‌ست همان گروه عضلانی: در روزهای حجمی می‌توانی ۱ تری‌ست برای پمپ نهایی عضله استفاده کنی.\n" +
      "• دراپ‌ست: در ست آخر حرکات کمکی، یک دراپ‌ست ۲۰٪ کاهش وزنه + ناتمام تا شکست بزن.\n" +
      "• رست پاز (pause reps): در نقطه میانی حرکات اصلی (پرس، اسکوات) ۲ ثانیه مکث کن.\n" +
      "• فیلد advancedTechniques (آرایه): حداقل ۲ تکنیک پیشرفته استفاده‌شده را لیست کن.\n" +
      "• فیلد muscleGroupSplit: تقسیم عضلات هفته را مشخص کن (مثلاً push/pull/legs یا upper/lower).\n" +
      "• فیلد inspiredByCoach را \"chris_bumstead\" بگذار — تمرکز روی فرم و ارتباط ذهن-عضله.\n" +
      "• ⚠️ از FST-7 و دوره‌بندی موجی استفاده نکن (مخصوص پلن حرفه‌ای)."
    );
  } else if (tier.level === "intermediate") {
    instructions.push(
      "⚡ راهنمای پلن استاندارد:\n" +
      "• تمرکز روی فرم صحیح حرکات و اتصال ذهن-عضله.\n" +
      "• تدریجی اضافه بار (Progressive Overload): هر هفته وزنه را ۲.۵-۵٪ افزایش بده.\n" +
      "• فیلد advancedTechniques: می‌توانی خالی بگذاری یا فقط [\"Progressive Overload\"] بنویسی.\n" +
      "• فیلد muscleGroupSplit: تقسیم ساده عضلات هفته را مشخص کن (مثلاً \"full body 3x\" یا \"upper/lower\").\n" +
      "• ⚠️ از سوپرست‌های پیچیده، تری‌ست، جاینت‌ست، FST-7 و دراپ‌ست استفاده نکن."
    );
  } else {
    // basic
    instructions.push(
      "🌱 راهنمای پلن اقتصادی:\n" +
      "• تمرکز روی یادگیری الگوهای حرکتی پایه (پرس، اسکوات، ددلیفت، بارفیکس).\n" +
      "• فرم صحیح مهم‌تر از وزنه است — کنترل کامل تمپو (۳-۱-۲-۰).\n" +
      "• تدریجی اضافه بار ملایم — هر ۲ هفته یک‌بار وزنه را افزایش بده.\n" +
      "• فیلد advancedTechniques: خالی یا [\"Progressive Overload\"]\n" +
      "• فیلد muscleGroupSplit: تقسیم ساده (مثلاً \"full body 3x\" یا \"split: upper/lower\").\n" +
      "• ⚠️ از هیچ تکنیک پیشرفته‌ای (سوپرست، تری‌ست، FST-7، دراپ‌ست) استفاده نکن."
    );
  }

  // ─── ۲. برنامه مکمل — فقط برای پلن‌های استاندارد به بالا (v75 — درخواست مالک) ───
  // مهم: طبق درخواست مدیر (۱۴۰۵/۰۶): «تجویز مکمل باید اندازه باشد؛ مکمل بی‌خودی
  // و زیادی به کاربر نده که مجبور شود ۲۵ میلیون تومان مکمل بخرد».
  // فلسفه: اول غذا، بعد مکمل — فقط مکمل‌های با بیشترین شواهد علمی و هزینه منطقی.
  // (به‌روزرسانی ۱۴۰۵/۰۶/۲): «مکمل‌ها باید داینامیک و با توجه به نیاز کاربر تجویز
  // بشوند و فرمت یکسان نداشته باشند» — قالب ثابت ۳+۱+۱ حذف شد؛ تصمیم need-based است.
  // v75 — گیت پلن برگشت: برنامه مکمل فقط برای standard+ ساخته می‌شود؛ برای
  // کاربر اقتصادی صریحاً ممنوع می‌شود (UI هم با «نیازمند پلن استاندارد به بالا» قفل است).
  if (caps.supplementsPlan) {
    const supplementBase = "💊 برنامه مکمل اختصاصی فیتاپ (داینامیک — فقط بر اساس نیازِ واقعیِ همین کاربر):\n" +
      "⚠️ قانون طلایی: اول غذا، بعد مکمل. مکمل جای غذا را نمی‌گیرد و قرار نیست کاربر برای مکمل هزینه‌ی سنگین بکند.\n\n" +

      "🔴 مهم‌ترین قانون — فرمت ثابت ممنوع:\n" +
      "برنامه‌ی مکمل هر کاربر باید با داده‌های پروفایلِ او ساخته شود، نه یک قالبِ همیشگی. برای هر مکمل، اول «نیاز» را از روی پروفایل ثابت کن و در note دلیلش را بنویس؛ اگر نیاز نیست، همان یک را هم تجویز نکن. تعدادِ نهایی بین ۱ تا ۴ قلم است (به‌ندرت ۵). اگر تغذیه‌ی کاربر پوشش می‌دهد، با صراحت بنویس «برای تو فعلاً مکمل خاصی لازم نیست» و فقط ۱-۲ قلمِ واقعاً مفید بگذار.\n\n" +

      "چک‌لیستِ تصمیم‌گیری (فقط مواردِ نیازمند را بگذار):\n" +
      "• ویتامین D3 → برای اکثر ایرانی‌ها منطقی است (آفتابِ کم/زمانِ داخل)؛ با ذکرِ همین دلیلِ کوتاه.\n" +
      "• امگا ۳ → فقط اگر مصرف ماهی کمتر از ۲ بار در هفته است (در رژیمِ ایرانیِ معمول صادق است؛ باز دلیل بنویس).\n" +
      "• کراتین مونوهیدرات → فقط برای هدفِ عضله‌سازی/قدرت با تمرینِ مقاومتیِ منظم؛ برای هدفِ چربی‌سوزیِ خالص یا درمانی تجویز نکن.\n" +
      "• پروتئین وی → فقط اگر پروتئینِ روزانه (تخم‌مرغ/مرغ/حبوبات/ماست/پنیر) به هدفِ g×kg وزنِ بدن نمی‌رسد؛ وگرنه صریحاً «لازم نیست» بنویس.\n" +
      "• B12 → فقط رژیمِ وگان/گیاه‌خواریِ سخت‌گیر.\n" +
      "• آهن یا کلسیم → فقط با شرایطِ خاصِ پروفایل (خونریزیِ زیاد/زنانِ ورزشکار/پوکیِ استخوان...) و با تأکیدِ مشورتِ پزشک.\n" +
      "• کافئین → فقط هدفِ چربی‌سوزی + بدون مشکلِ قلبی/خواب؛ ساده‌ترین شکل: قهوه قبل تمرین.\n\n" +

      "پرچم‌های قرمز (ممنوعِ مطلق):\n" +
      "• BCAA/EAA، بتاآلانین، سیترین مالات، گلوتامین، گینر، ال-کارنیتین، کلاژن و ZMA هرگز آیتمِ اصلیِ تجویز نباشند — حداکثر در note به‌عنوان «در صورتِ بودجه‌ی اضافه» + جایگزینِ غذاییِ ارزان.\n" +
      "• هیچ‌وقت «برای اطمینان همه را بخر» ننویس؛ برعکس: «لازم نیست همه را بگیری» را صریح بگو.\n\n" +

      "خروجی JSON — بخش «supplements» (لیست ساده) و «supplementStack» (دسته‌بندی‌شده) هر دو:\n" +
      "• هر مکمل دارای category: \"base\" (ضروریِ همین کاربر) | \"advanced\" (پوششِ شکافِ خاص) | \"targeted\" (هدفمندِ ارزان).\n" +
      "• فقط دسته‌هایی را پر کن که مکمل واقعی برایش داری — دسته‌ی خالی نساز. فرمتِ خروجی باید متناسب با نیازِ کاربر باشد، نه همیشه یکسان.\n" +
      "• هر مکمل باید فیلد contraindicatedFor (آرایه‌ی شرایطِ منع مصرف) داشته باشد:\n" +
      "  • کراتین → بیمارانِ کلیوی\n" +
      "  • کافئین → بیمارانِ قلبی، فشارِ خونِ بالا، بی‌خوابی\n" +
      "  • پروتئین وی → نارساییِ کلیویِ پیشرفته\n" +
      "• در note هر مکمل: (۱) دلیلِ تجویز برای همین کاربر، (۲) جایگزینِ غذاییِ ارزان، (۳) «قبل از شروع با پزشک مشورت کنید.»\n" +
      "• هرگز دوز بالاتر از استاندارد تجویز نکن.\n" +
      "• انتخاب‌ها باید بر اساس goal، رژیم، سطحِ فعالیت، سن/جنس، شرایطِ پزشکی (data.diseases, data.medicalConditions) و مکمل‌های فعلیِ کاربر (data.currentSupplements) باشد.";

    if (tier.level === "pro" || tier.level === "advanced") {
      // ورزشکاران پیشرفته: همان منطقِ need-based + تأکید بر اقتصاد
      instructions.push(supplementBase + "\n\n⚠️ سطح ورزشکار: پیشرفته/حرفه‌ای — حتی در این سطح، استک را حداقلی و غذا-محور نگه دار؛ قهرمان‌ها هم از بشقابِ غذا قهرمان می‌شوند نه از قفسه‌ی مکمل.");
    } else {
      // مبتدی/متوسط: همان منطق با لحنِ ساده‌تر
      instructions.push(supplementBase + "\n\n⚠️ سطح ورزشکار: مبتدی/متوسط — در این سطح معمولاً حداکثر ۲-۳ قلم لازم است؛ دوزهای محافظانه‌تر و تأکید بر شروعِ سبک در note.");
    }
  } else {
    // v75 — پلن اقتصادی: برنامه مکمل ممنوع — صریح و قاطع
    instructions.push(
      "⛔ این کاربر پلن اقتصادی دارد و «برنامه مکمل» شامل پلن او نمی‌شود:\n" +
      "• فیلدهای supplements و supplementStack را کامل خالی بگذار (آرایه خالی []).\n" +
      "• فیلد supplementTimingNotes را هم خالی بگذار و هیچ مکملی تجویز نکن.\n" +
      "• به‌جای آن، در notes بنویس: «برای دریافت برنامهٔ مکمل اختصاصی، پلن استاندارد به بالا لازم است.»"
    );
  }

  // آنالیز عکس بدن — برای کاربران Advanced / Ultimate که عکس بدن ارسال کرده‌اند.
  // نیازی به capability gate نیست: اگر extras.bodyPhotoAnalysis وجود دارد، یعنی کاربر
  // قبلاً از طریق submit-body-analysis عکس‌هایش را ارسال کرده و قابلیت bodyPhotoAnalysis
  // توسط requirePlanCapability تأیید شده است.
  if (extras?.bodyPhotoAnalysis) {
    instructions.push(
      `آنالیز عکس‌های بدن کاربر (توسط هوش مصنوعی بررسی شده):\n${extras.bodyPhotoAnalysis}\nاین اطلاعات را در طراحی برنامه لحاظ کن — نقاط ضعف فرم بدن، عدم تقارن، و حرکات اصلاحی پیشنهاد بده. تمرینات را بر اساس نقاط ضعف شناسایی‌شده اولویت‌بندی کن. اگر عدم تقارن عضلانی (مثلاً بین بازوی چپ و راست) دیده شد، تمرینات یک‌طرفه (unilateral) را در برنامه بگنجان.`
    );
  }

  if (caps.videoBodyAnalysis && extras?.videoAnalysisResult) {
    instructions.push(
      `آنالیز ویدیوی فرم بدن کاربر (توسط هوش مصنوعی بررسی شده):\n${extras.videoAnalysisResult}\nاین اطلاعات را در طراحی برنامه لحاظ کن — نقاط ضعف فرم بدن، عدم تقارن، و حرکات اصلاحی پیشنهاد بده.`
    );
  }

  if (caps.bloodTestAnalysis && extras?.bloodTestReport) {
    instructions.push(
      `گزارش آزمایش خون کاربر:\n${extras.bloodTestReport}\nبرنامه تغذیه را بر اساس کمبودهای ویتامینی، سطح قند، چربی خون و هورمون‌ها بهینه‌سازی کن. در صورت کمبود، غذاهای غنی از آن ویتامین/ماده معدنی را اولویت بده. هشدارهای پزشکی لازم را در بخش notes بیاور.`
    );
  }

  // تمدید هوشمند: پیشرفت کاربر از دوره قبلی
  if (extras?.renewalContext) {
    instructions.push(extras.renewalContext);
  }

  return instructions.length
    ? `\n\nدستورالعمل‌های ویژه پلن ${planName ? PLAN_LABELS[planName] : ""} (سطح: ${tier.level}):\n${instructions.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}`
    : "";
}

// ─── راهنمای انتخاب سوپرست بر اساس هدف ورزشکار ───
// (FULL-PROFILE-AI-CONTEXT-WORKOUT) تصمیم‌گیری هوشمند درباره استفاده از
// سوپرست/تری‌ست/جاینت‌ست بر اساس هدف، سطح ورزشکار و شرایط پزشکی.
function supersetGuidanceForGoal(goal: OnboardingData["goal"]): string {
  switch (goal) {
    case "fat_loss":
      return [
        "  • توصیه: استفاده از سوپرست/تری‌ست/جاینت‌ست در ۲ تا ۳ روز از هفته برای افزایش فشار متابولیک (metabolic stress) و کالری‌سوزی.",
        "  • بهترین انتخاب: جاینت‌ست‌های بدن‌کامل (full-body circuit) و سوپرست‌های آنتاگونیست با استراحت کم.",
        "  • استراحت کوتاه (۳۰-۶۰ ثانیه بین گروه‌ها) برای حفظ ضربان قلب بالا.",
      ].join("\n");
    case "cut":
      // v60 — کات: فشار متابولیک متوسط ولی شدت مکانیکی حفظ شود (حفظ عضله اولویت است)
      return [
        "  • توصیه (کات): سوپرست/تری‌ست در ۱ تا ۲ روز از هفته برای فشار متابولیک — ولی شدت مکانیکی حرکات اصلی حفظ شود تا عضله از دست نرود.",
        "  • بهترین انتخاب: سوپرست آنتاگونیست با استراحت ۴۵-۷۵ ثانیه؛ جاینت‌ست فقط در روزهای کم‌حجم.",
        "  • حجم کل تمرین را با نقصان کالری هماهنگ کن — در روزهای خیلی خسته، سوپرست را حذف کن نه حرکات اصلی را.",
      ].join("\n");
    case "muscle_gain":
      return [
        "  • توصیه: استفاده از سوپرست آنتاگونیست (push/pull) در ۱ تا ۲ روز از هفته برای افزایش حجم تمرین بدون خستگی اضافی.",
        "  • بهترین انتخاب: سوپرست‌های متضاد (پرس سینه + بارفیکس، پرس بالاسینه + زیرسینه) برای حفظ شدت هایپرتروفی.",
        "  • از تری‌ست و جاینت‌ست کمتر استفاده کن — استراحت کافی (۹۰-۱۲۰ ثانیه) برای حفظ شدت مکانیکی.",
      ].join("\n");
    case "bulk":
      // v60 — افزایش حجم: حجم تمرین بالاتر با سوپرست کمکی و استراحت کامل
      return [
        "  • توصیه (افزایش حجم): سوپرست آنتاگونیست در ۱ تا ۲ روز برای افزایش حجم تمرین؛ حرکات اصلی همیشه تکی و سنگین.",
        "  • استراحت کامل (۹۰-۱۲۰ ثانیه) بین گروه‌ها — در مازاد کالری، ریکاوری خوب است؛ شدت را قربانی نکن.",
        "  • از جاینت‌ست برای حرکات بزرگ پرهیز کن؛ فقط در حرکات کمکی/آخر جلسه قابل قبول است.",
      ].join("\n");
    case "strength":
      return [
        "  • توصیه: استفاده از سوپرست به حداقل (۰ تا ۱ روز در هفته) — تمرکز روی حرکات اصلی با وزنه سنگین و استراحت کامل.",
        "  • برای قدرت محض، حرکات تکی با ۳-۵ دقیقه استراحت برتری دارند.",
        "  • اگر سوپرست می‌دهی، فقط سوپرست آنتاگونیست با شدت متوسط برای حرکات کمکی (نه حرکات اصلی).",
      ].join("\n");
    case "endurance":
      return [
        "  • توصیه: استفاده از تری‌ست و جاینت‌ست در ۱ تا ۲ روز برای افزایش استقامت عضلانی.",
        "  • استراحت کوتاه (۳۰-۴۵ ثانیه) و تکرار بالا (۱۵-۲۰) برای بهبود ظرفیت لاکتات.",
      ].join("\n");
    case "fitness":
    default:
      return [
        "  • توصیه: استفاده متوسط از سوپرست (۱ تا ۲ روز در هفته) برای تنوع و افزایش شدت تمرین.",
        "  • ترکیب سوپرست‌های آنتاگونیست با حرکات تکی برای تعادل قدرت و استقامت.",
      ].join("\n");
  }
}

function supersetGuidanceForExperience(experience: OnboardingData["trainingExperience"] | undefined): string {
  switch (experience) {
    case "beginner":
      return [
        "  • سطح مبتدی: از سوپرست/تری‌ست/جاینت‌ست استفاده نکن (یا حداکثر ۱ سوپرست ساده در یک روز).",
        "  • تمرکز روی یادگیری فرم صحیح حرکات تکی، اتصال ذهن-عضله و تثبیت الگوهای حرکتی.",
        "  • استراحت کامل (۹۰-۱۲۰ ثانیه) بین ست‌ها برای ریکاوری عصبی-عضلانی.",
      ].join("\n");
    case "intermediate":
      return [
        "  • سطح متوسط: می‌توانی از سوپرست‌های آنتاگونیست در ۱-۲ روز استفاده کنی.",
        "  • هنوز از تری‌ست/جاینت‌ست پرهیز کن مگر برای روز استقامت/کاردیو.",
      ].join("\n");
    case "advanced":
      return [
        "  • سطح پیشرفته: استفاده از سوپرست/تری‌ست در ۲-۳ روز مجاز و مفید است.",
        "  • جاینت‌ست را برای روزهای چربی‌سوزی یا بدن‌کامل نگه دار.",
      ].join("\n");
    case "pro":
      return [
        "  • سطح حرفه‌ای: آزادی کامل در استفاده از تکنیک‌های پیشرفته (سوپرست/تری‌ست/جاینت‌ست/دراپ‌ست).",
        "  • برای حداکثر رشد، ترکیب سوپرست آنتاگونیست با تری‌ست همان گروه را در روزهای حجمی امتحان کن.",
      ].join("\n");
    default:
      return [
        "  • سطح نامشخص: محتاط رفتار کن — حداکثر ۱ سوپرست در یک روز.",
      ].join("\n");
  }
}

// Generate a weekly workout plan via AI
export async function generateWorkoutPlan(
  data: OnboardingData,
  planName?: Plan | null,
  extras?: { bloodTestReport?: string; videoAnalysisResult?: string; bodyPhotoAnalysis?: string; renewalContext?: string }
): Promise<ProWorkoutPlanContent> {
  const systemPrompt = withBrandDirective(await getAiConfig("coach_system_prompt", DEFAULT_COACH_PROMPT));
  const context = buildUserContext(data, planName);
  // ─── trainingExperience را به extras اضافه کن تا تکنیک‌ها بر اساس سابقه فعال شوند ───
  const planInstructions = buildPlanAwareInstructions(planName, { ...extras, trainingExperience: data.trainingExperience });

  // Use user-selected specific weekdays if provided; otherwise fallback to first N days
  const chosenDays =
    data.workoutDaysList && data.workoutDaysList.length > 0
      ? data.workoutDaysList
      : PERSIAN_WEEKDAYS.slice(0, data.workoutDays);

  // --- Fetch exercise names from the library so AI only uses real exercises ---
  let libraryNames: string[] = [];
  try {
    const all = await db.exerciseLibrary.findMany({ select: { name: true, muscle: true } });
    libraryNames = all.map((e: any) => e.name);
  } catch (e) {
    console.error("[generateWorkoutPlan] failed to load exercise library:", e);
  }
  const libraryList = libraryNames.length > 0
    ? `\n\nکتابخانه حرکات موجود (فقط از بین این حرکات انتخاب کن):\n${libraryNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n`
    : "";

  // ─── محاسبه پویای تعداد حرکات هر روز بر اساس سطح تجربه کاربر (WORKOUT-PLAN-PRO) ───
  // مبتدی: ۵-۶ | متوسط: ۶-۷ | پیشرفته: ۷-۸ | حرفه‌ای: ۸-۱۰
  // این مقادیر بر اساس استاندارد مربیان بزرگ دنیا (هانی رامبد، هادی چوپان، کریس بامستد) تنظیم شده‌اند.
  // برای کاربران با سابقه ۳ سال یا بیشتر (advanced/pro) حداقل ۶ حرکت الزامی است.
  const exerciseCountRange = (() => {
    switch (data.trainingExperience) {
      case "beginner":
        return { min: 5, max: 6 };
      case "intermediate":
        return { min: 6, max: 7 };
      case "advanced":
        return { min: 7, max: 8 };
      case "pro":
        return { min: 8, max: 10 };
      default:
        return { min: 5, max: 6 };
    }
  })();
  // قانون سابقه ۳ سال یا بیشتر → حداقل ۶ حرکت
  const minExercisesForExperienced = 6;
  const effectiveMinExercises =
    (data.trainingExperience === "advanced" || data.trainingExperience === "pro")
      ? Math.max(exerciseCountRange.min, minExercisesForExperienced)
      : exerciseCountRange.min;

  const userPrompt = `بر اساس اطلاعات زیر، یک برنامه تمرینی هفتگی کامل، حرفه‌ای و شخصی‌سازی‌شده بساز — سطح مربی حرفه‌ای فدراسیون.

${context}
${planInstructions}
${libraryList}

روزهای تمرین کاربر: ${chosenDays.join("، ")}

فقط و فقط با ساختار JSON زیر پاسخ بده و هیچ متن اضافه‌ای قبل یا بعد از JSON ننویس:
{
  "days": [
    {
      "day": "شنبه",
      "title": "عنوان روز تمرین",
      "focus": "عضله هدف",
      "estimatedMinutes": 60,
      "warmup": [
        {"name": "نام حرکت گرم‌کردن (مثلاً دویدن سبک روی تردمیل)", "durationSec": 300, "notes": "شدت پایین، RPE 4-5"},
        {"name": "موبیلیتی مفصل هدف (مثلاً چرخش شانه)", "durationSec": 120, "notes": "۳ ست ۱۰ تکراری"}
      ],
      "exercises": [
        {
          "name": "نام حرکت (حتماً از کتابخانه حرکات بالا)",
          "muscle": "عضله هدف",
          "category": "push|pull|legs|core|cardio|fullbody",
          "description": "توضیح نحوه انجام (۲-۳ جمله کامل و واضح — فرم، مسیر حرکت، نکته فنی کلیدی)",
          "tips": "نکته ایمنی و تکنیک",
          "coachTip": "توصیه کوتاه مربی (۱ جمله) — مثلاً «دقت کن زانوها در جهت نوک پنجه باشد» یا «در فاز منفی ۳ ثانیه مکث کن»",
          "difficulty": "beginner|intermediate|advanced",
          "rpe": 7,
          "tempo": "3-1-2-0",
          "substitution": "حرکت جایگزین برای زمانی که تجهیزات کافی نباشد یا محدودیت خطری وجود داشته باشد",
          "sets": [
            {"setNumber": 1, "reps": "10-12", "restSec": 90, "rpe": 7},
            {"setNumber": 2, "reps": "10-12", "restSec": 90, "rpe": 7}
          ],
          "supersetGroup": "A",
          "supersetType": "superset",
          "circuitRounds": 3,
          "restBetweenRounds": 180
        }
      ],
      "cooldown": [
        {"name": "استretch دینامیک/استاتیک عضله هدف", "durationSec": 180, "notes": "۳۰ ثانیه روی هر عضله"},
        {"name": "فوم رولر (Foam Roller)", "durationSec": 180, "notes": "روی عضلات هدف و فاسیا"}
      ]
    }
  ],
  "weeklyProgression": {
    "strategy": "استراتژی کلی پیشرفت (مثلاً: هر هفته وزنه‌ها را ۲.۵٪ افزایش بده، تکرارها را ثابت نگه دار)",
    "weeks": [
      {"week": 1, "weightChangeKg": 0, "repChange": 0, "note": "هفته آشنایی — RPE 6-7، فرم حرکات را تثبیت کن"},
      {"week": 2, "weightChangeKg": 2.5, "repChange": 0, "note": "افزایش وزنه ۲.۵ کیلو در حرکات اصلی — RPE 7-8"},
      {"week": 3, "weightChangeKg": 5, "repChange": 0, "note": "افزایش وزنه تجمعی — RPE 8-9، حجم ثابت"},
      {"week": 4, "weightChangeKg": 7.5, "repChange": -1, "note": "هفته اوج (deload بعدی) — RPE 9، تکرار کاهشی"}
    ]
  },
  "safetyNotes": [
    "نکته ایمنی ۱ بر اساس آسیب‌دیدگی یا شرایط پزشکی",
    "نکته ایمنی ۲"
  ],
  "recoveryNotes": [
    "توصیه ریکاوری ۱ بر اساس خواب/استرس",
    "توصیه ریکاوری ۲"
  ],
  "nutritionTimingNotes": [
    "توصیه تایمینگ تغذیه قبل از تمرین (۹۰-۱۲۰ دقیقه قبل)",
    "توصیه تایمینگ تغذیه بعد از تمرین (۳۰-۶۰ دقیقه بعد)"
  ],
  "supplementTimingNotes": [
    "توصیه تایمینگ مکمل بر اساس مکمل‌های فعلی یا هدف"
  ],
  "medicalWarningFlags": [
    "⚠️ هشدار پزشکی (در صورت وجود شرایط حساس)"
  ],
  "weeklyGoal": "هدف هفته",
  "notes": "نکات کلی هفته — انگیزشی و کاربردی",
  "advancedTechniques": [
    "نام تکنیک پیشرفته استفاده‌شده (مثلاً FST-7، سوپرست آنتاگونیست، تری‌ست، دراپ‌ست، رست پاز، Progressive Overload)"
  ],
  "muscleGroupSplit": "تقسیم عضلات هفته (مثلاً push/pull/legs یا upper/lower یا body part split یا full body 3x)",
  "periodizationType": "linear | undulating | block | wave | daily_undulating",
  "muscleFrequencyPerWeek": 2,
  "inspiredByCoach": "hany_rambod | hadi_chupan | chris_bumstead | mixed",
  "fst7Details": {
    "exerciseName": "نام حرکت آخر گروه عضلانی (که FST-7 روی آن اعمال می‌شود)",
    "sets": 7,
    "reps": "8-12",
    "restSec": 30,
    "note": "توضیح اجرای FST-7 (پمپ حداکثری، استراحت ۳۰-۴۵ ثانیه، ۷ ست)"
  }
}

قوانین حرفه‌ای (همه را رعایت کن):

۱) ساختار و تعداد (قانون سخت — نقض آن یعنی برنامه نامعتبر است):
- دقیقاً ${data.workoutDays} روز تمرین در روزهای ذکر شده (${chosenDays.join("، ")}) ایجاد کن.
- 📅 روزهای تمرین را به ترتیب استاندارد هفته فارسی برگردان: شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه، پنجشنبه، جمعه. هرگز روزها را نامرتب برنگردان. آرایه "days" باید دقیقاً به همین ترتیب زمانی چیده شده باشد.
- ⚠️ هر روز «حداقل ${effectiveMinExercises}» و «حداکثر ${exerciseCountRange.max}» حرکت داشته باشد (سطح تجربه کاربر: ${data.trainingExperience || "beginner"}). کمتر از حداقل یا بیشتر از حداکثر حرکت در هر روز ممنوع است — این محدوده بر اساس استانداردهای علمی تمرین برای همین سطح تجربه تعیین شده است.
- ⚠️ قانون مهم: برای کاربران با سابقه ۳ سال یا بیشتر (سطح پیشرفته/حرفه‌ای)، حداقل ۶ حرکت در هر روز الزامی است.
- تعداد ست‌ها بین ۳ تا ۵ باشد.
- **حتماً فقط از حرکات کتابخانه حرکات بالا استفاده کن** — نام حرکات را دقیقاً همان‌طور بنویس.
- **سوپرست/تری‌ست/جاینت‌ست به عنوان یک حرکت در نظر گرفته می‌شود** (مثلاً ۵ حرکت تکی + ۱ سوپرست = ۶ حرکت کل).
- 💰 بودجه و تجهیزات کاربر: مکان تمرین «${WORKOUT_PLACE_LABELS[data.workoutPlace] || data.workoutPlace}» و تجهیزات موجود: ${data.equipment?.length ? data.equipment.map((e) => equipmentFa(e)).join("، ") : "نامشخص"}. حرکات را فقط با همین تجهیزات انتخاب کن — حرکت با تجهیزات گران‌قیمت یا خارج از دسترس کاربر تجویز نکن و در "substitution" جایگزین کم‌هزینه بده.

۲) گرم‌کردن و سردکردن (بسیار مهم):
- هر روز حتماً آرایه "warmup" با حداقل ۲ آیتم بساز: ۵-۱۰ دقیقه هوازی سبک + موبیلیتی/اکتیویشن مفصل هدف.
- هر روز حتماً آرایه "cooldown" با حداقل ۲ آیتم بساز: استretch استاتیک + فوم رولر یا نفس‌گیری فعال.
- durationSec به ثانیه (نه دقیقه) باشد.

۳) RPE (Rate of Perceived Exertion) — حرفه‌ای:
- برای هر حرکت فیلد "rpe" (۱ تا ۱۰) بگذار:
  • RPE 5-6: گرم‌کردن / آماده‌سازی
  • RPE 7: شدت متوسط — ۳ تکرار ذخیره (RIR 3)
  • RPE 8: شدت بالا — ۲ تکرار ذخیره (RIR 2)
  • RPE 9: نزدیک شکست — ۱ تکرار ذخیره
  • RPE 10: شکست عضلانی کامل (فقط در ست آخر حرکات اصلی)
- در ست آخر هر حرکت اصلی (پرس، اسکوات، ددلیفت) می‌توانی RPE را ۱-۲ درجه بالاتر بگذاری.

۴) Tempo (تمپو اجرا):
- برای هر حرکت فیلد "tempo" با فرمت ۴-رقمی بنویس: "اکسنتریک-مکث-کنسنتریک-مکث".
  مثال‌ها:
  • "3-1-2-0" — پایین ۳ ثانیه، مکث ۱، بالا ۲، بدون مکث (استاندارد هایپرتروفی)
  • "2-0-1-0" — کنترل‌شده سریع (قدرت)
  • "4-2-1-0" — زیر کنترل کامل (هایپرتروفی پیشرفته)
- برای حرکات انفجاری (مثل پاور کلین) از "1-0-X-0" استفاده کن (X = حداکثر سرعت).

۴-۱) توصیه مربی (coachTip) — الزامی برای هر حرکت:
- برای هر حرکت فیلد "coachTip" را با یک جمله کوتاه و کاربردی از مربی پر کن.
- این توصیه باید مختص همان حرکت باشد — نکته فنی یا فرمی که کاربر را در همان حرکت کمک کند.
- مثال‌ها:
  • اسکوات: «دقت کن زانوها در جهت نوک پنجه باشد و عمق حداقل موازی با زمین.»
  • ددلیفت: «کمر کاملاً صاف، وزنه نزدیک بدن، فاز بالا با باسن و زانو هم‌زمان.»
  • پرس سینه: «پایین آهسته (۳ ثانیه)، مکث ۱ ثانیه روی سینه، انفجاری بالا.»
  • بارفیکس: «در فاز منفی ۳ ثانیه مکث کن تا کنترل کامل داشته باشی.»
  • پرس سرشانه: «قفسه سینه بالا، شکم سفت، بدون قوس کمری — از فاز منفی غافل نشو.»
- هرگز توصیه کلی و تکراری ننویس (مثل «فرم درست داشته باش»). همیشه نکته خاص همان حرکت.

۵) استراحت بین ست‌ها:
- در فیلد "restSec" هر ست بگذار:
  • قدرت محض (۱-۳ تکرار): ۱۸۰ ثانیه (۳ دقیقه)
  • هایپرتروفی (۶-۱۲ تکرار): ۶۰-۹۰ ثانیه
  • استقامت عضلانی (۱۵+ تکرار): ۳۰-۴۵ ثانیه
  • سوپرست/تری‌ست: ۹۰-۱۲۰ ثانیه بین گروه‌ها

۶) حرکت جایگزین (substitution):
- برای هر حرکت فیلد "substitution" پر کن با جایگزینی که همان عضله را هدف می‌گیرد اما با تجهیزات کمتر یا محدودیت ایمنی متفاوت.

۷) سوپرست / تری‌ست / جاینت‌ست (روش‌های حرفه‌ای افزایش شدت):
- **استفاده از سوپرست/تری‌ست/جاینت‌ست اختیاری است و باید بر اساس هدف و سطح ورزشکار تصمیم کنی.** در صورت استفاده، برای حرکات گروهی فیلد "supersetGroup" را با یک حرف یکسان (مثل "A" یا "B") پر کن.
- **توجه**: سوپرست/تری‌ست/جاینت‌ست در شمارش حرکات یک حرکت محسوب می‌شود (نه دو یا سه).
- "supersetType" را بر اساس نوع گروه تنظیم کن:
  • "superset" (۲ حرکت): متضاد آنتاگونیست — مثل پرس سینه + بارفیکس (push + pull).
  • "triset"    (۳ حرکت): همان گروه عضلانی — مثل ۳ حرکت مختلف سینه (پرس، قفسه، شنا).
  • "giant"     (۴ حرکت یا بیشتر): جاینت‌ست یا سیرکویت — برای اتمام کامل یک گروه عضلانی یا سیرکویت بدن‌کامل (full-body circuit).
- برای جاینت‌ست (giant) حتماً این فیلدها را هم پر کن:
  • "circuitRounds": تعداد دفعات تکرار کل سیرکویت (عدد ۲ تا ۴، پیش‌فرض ۳).
  • "restBetweenRounds": استراحت بین دورهای سیرکویت به ثانیه (۱۲۰ تا ۱۸۰ ثانیه).
- در سوپرست/تری‌ست/جاینت‌ست، restSec حرکات داخل گروه را ۰ یا کم بگذار (چون بدون استراحت بین حرکات انجام می‌شوند)؛ استراحت واقعی بین گروه‌ها (یا بین دورها در جاینت‌ست) لحاظ می‌شود.
- به ازای هر گروه، حداکثر ۱ گروه از هر نوع در یک روز بساز — هم‌نام‌بودن "supersetGroup" یعنی همان گروه.

۷-۱) راهنمای انتخاب سوپرست بر اساس هدف و سطح ورزشکار:
- **هدف "${GOAL_LABELS[data.goal]}"** (${data.goal}):
${supersetGuidanceForGoal(data.goal)}
- **سطح ورزشکار "${data.trainingExperience || "beginner"}"**:
${supersetGuidanceForExperience(data.trainingExperience)}
- اگر کاربر مبتدی است یا شرایط پزشکی/آسیب‌دیدگی حساس دارد، استفاده از سوپرست را به حداقل برسان یا کلاً حذف کن و روی حرکات تکی با فرم تکنیکی تمرکز کن.

۷-۲) تکنیک‌های پیشرفته و الگوی مربیان بزرگ (WORKOUT-PLAN-PRO):
- **هانی رامبد — FST-7 (Fascia Stretch Training)**: در حرکت آخر هر گروه عضلانی (به ویژه برای پلن حرفه‌ای/ultimate)، ۷ ست با ۸-۱۲ تکرار و استراحت ۳۰-۴۵ ثانیه بزن. هدف: پمپ حداکثری و کشش فاسیا. فیلد "fst7Details" را با نام حرکت، ۷ ست، تکرارها و استراحت پر کن.
- **هادی چوپان — حجم بالا + فرکانس بالا**: هر گروه عضلانی را ۲ بار در هفته تمرین بده. فیلد "muscleFrequencyPerWeek" را ۲ بگذار. در روزهای تکراری، حرکات و زاویه‌های متفاوت استفاده کن.
- **کریس بامستد — ارتباط ذهن-عضله**: در توضیح هر حرکت روی کنترل فاز اکسنتریک (۳-۴ ثانیه پایین) و مکث در نقطه کشش تأکید کن. تمپو "4-1-2-0" یا "3-1-2-1" برای هایپرتروفی.
- **دوره‌بندی موجی (Undulating Periodization)**: در طول هفته، حجم/شدت را متغیر بده. فیلد "periodizationType" را بر اساس پلن کاربر تنظیم کن:
  • ultimate → "undulating" یا "daily_undulating"
  • advanced → "linear"
  • standard/basic → "linear"
- **دراپ‌ست (Drop Set)**: در ست آخر حرکات کمکی، می‌توانی یک دراپ‌ست (۲۰-۳۰٪ کاهش وزنه + تکرار تا شکست) پیشنهاد بده. در توضیح حرکت ذکر کن.
- **رست پاز (Pause Reps)**: در نقطه میانی حرکات اصلی، ۲-۳ ثانیه مکث (tempo مثلاً "3-2-1-0").
- **تکنیک ۱.۵ تکراری (1.5 reps)**: یک تکرار کامل + نیم تکرار = ۱.۵. برای پمپ حداکثری عضله.
- فیلد "advancedTechniques" (آرایه): حداقل تکنیک‌های پیشرفته استفاده‌شده در این برنامه را لیست کن (بر اساس سطح پلن کاربر).
- فیلد "muscleGroupSplit": تقسیم عضلات هفته را دقیق مشخص کن (مثلاً "push/pull/legs" یا "upper/lower" یا "push/pull/legs/upper/lower" یا "body part split").
- فیلد "inspiredByCoach": بر اساس پلن و هدف:
  • ultimate → "mixed" یا "hany_rambod"
  • advanced → "chris_bumstead" یا "hadi_chupan"
  • standard/basic → "mixed"

۸) پیشرفت هفتگی (weeklyProgression):
- استراتژی پیشرفت (Progressive Overload) را برای حداقل ۴ هفته بنویس.
- هر هفته توضیح بده چقدر وزنه/تکرار اضافه شود و RPE هدف چقدر باشد.
- اگر کاربر "${data.trainingExperience || "beginner"}" است، آغاز را ملایم‌تر بگذار. اگر "pro" یا "advanced" است، پرگرسیون تهاجمی‌تر بده.

۹) نکات ایمنی (safetyNotes):
- بر اساس آسیب‌دیدگی‌ها و شرایط پزشکی کاربر، حداقل ۲ نکته بنویس.
- اگر شرایط حساسی (دیابت، قلب، فشار خون) دارد، آن را صراحتاً ذکر کن.

۱۰) توصیه ریکاوری (recoveryNotes):
- بر اساس خواب و استرس کاربر، حداقل ۲ توصیه بنویس.
  • اگر خواب کمتر از ۷ ساعت: حجم تمرین را ملایم پیشنهاد بده و تاکید بر خواب.
  • اگر استرس بالا (۴-۵): تاکید بر ریکاوری فعال (پیاده‌روی، مدیتیشن، تنفس).

۱۱) تایمینگ تغذیه (nutritionTimingNotes):
- حداقل ۲ توصیه: قبل و بعد از تمرین (با فاصله زمانی دقیق).

۱۲) تایمینگ مکمل (supplementTimingNotes):
- اگر کاربر مکمل فعلی مصرف می‌کند (${data.currentSupplements || "نامشخص"}): تداخل/هماهنگی زمان مصرف را توضیح بده.
- اگر مکمل نمی‌خورد: توصیه مکمل هدفمند (مثلاً کراتین بعد از تمرین).

۱۳) هشدارهای پزشکی (medicalWarningFlags):
- در صورت وجود شرایط حساس، حداقل ۱ هشدار اضافه کن.
- اگر شرایط حساس نیست، آرایه خالی بگذار: [].

۱۴) نکات هفته (notes):
- انگیزشی و کاربردی، شامل ۳-۴ نکته کوتاه با ایموجی. مثال: "🔥 این هفته روی فرم حرکات تمرکز کن — کیفیت مهم‌تر از کمیت است!\n💪 پروتئین کافی بخور تا ریکاوری بهتر شود.\n🎯 هدف هفته: افزایش وزنه در اسکوات!\n⚡ استراحت بین ست‌ها را رعایت کن — عضله در استراحت رشد می‌کند."

۱۵) شخصی‌سازی بر اساس شرایط:
- اگر آسیب‌دیدگی وجود دارد، حرکات آسیب‌زا را حذف و جایگزین ایمن بده.
- برای تمرین در خانه، از حرکات با وزن بدن یا تجهیزات موجود استفاده کن.
- ساعت ترجیحی تمرین کاربر ${data.workoutTime ? `(${WORKOUT_TIME_LABELS[data.workoutTime]})` : "(نامشخص)"} — اگر صبح است، تمرین قدرتی پیشنهاد بده؛ اگر عصر/شب، حجمی/استقامتی.
${data.targetDate ? `- تاریخ هدف کاربر ${data.targetDate} است — استراتژی پیشرفت را به این تایم‌لاین تنظیم کن.` : ""}
${data.bodyFrame ? `- اندازه استخوان بدن کاربر ${BODY_FRAME_LABELS[data.bodyFrame]} است — در محاسبه حجم و شدت لحاظ کن.` : ""}

برای هر حرکت، توضیح کامل و واضح بنویس که کاربر بتواند حرکت را درست انجام دهد.`;

  let content: string;
  try {
    // ─── تولید برنامه تمرینی (دیریکتیو مالک v40): gemini-3.8-flash + تفکر high،
    // فال‌بک deepseek-v4-flash با همان تفکر high — در generatePlanContent.
    // تولید در پس‌زمینه انجام می‌شود (program-generation.ts) پس timeout بلند
    // مشکلی برای UX ایجاد نمی‌کند و بودجهٔ ~۱۸ دقیقه‌ای زیر watchdog ۵۰ دقیقه‌ای است.
    // اعتبارسنج داخل زنجیره — پاسخِ بی‌روز، مستقیم به مدل فال‌بک می‌رود
    content = await generatePlanContent(
      systemPrompt,
      userPrompt,
      "generateWorkoutPlan",
      (text) => {
        const p = parseJsonFromContent(text);
        return Array.isArray(p?.days) && p.days.length > 0
          ? null
          : "پاسخ نامعتبر از هوش مصنوعی (برنامه خالی)";
      }
    );
  } catch (err) {
    console.error("[generateWorkoutPlan] AvalAI error:", err);
    throw err instanceof Error ? err : new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);

  // ─── M1: اعتبارسنجی پاسخ — برنامه خالی نباید به‌عنوان موفقیت ذخیره شود ───
  // اگر خروجی AI کوتاه/ناقص یا HTML خطا باشد، parseJsonFromContent آرایه days خالی
  // برمی‌گرداند. با خطا دادن اینجا، ProgramRequest به‌صورت failed علامت می‌خورد (نه موفقیت کاذب).
  if (!Array.isArray(parsed.days) || parsed.days.length === 0) {
    console.error("[generateWorkoutPlan] AI returned empty/invalid plan. Content head:", content.slice(0, 300));
    throw new Error("پاسخ نامعتبر از هوش مصنوعی (برنامه خالی)");
  }

  // ─── WORKOUT-COUNT: اعتبارسنجی تعداد حرکات هر روز بر اساس سطح تجربه ───
  // قانون سخت: هر روز باید بین effectiveMinExercises و exerciseCountRange.max حرکت باشد.
  // اگر AI بیشتر از سقف داده → حرکات اضافه (از انتها) حذف می‌شوند (ترمیم امن).
  // اگر کمتر از حداقل داده → لاگ هشدار (نمی‌توانیم حرکت جدید اختراع کنیم؛
  // برنامه رد نمی‌شود چون برای کاربر بهتر است برنامه کم‌حرکت‌تر از هیچ برنامه‌ای باشد).
  {
    let trimmedTotal = 0;
    let underMinTotal = 0;
    for (const day of parsed.days) {
      if (!Array.isArray(day.exercises)) continue;
      if (day.exercises.length > exerciseCountRange.max) {
        trimmedTotal += day.exercises.length - exerciseCountRange.max;
        day.exercises = day.exercises.slice(0, exerciseCountRange.max);
      }
      if (day.exercises.length < effectiveMinExercises) {
        underMinTotal++;
        console.warn(
          `[generateWorkoutPlan] day "${day.day}" has ${day.exercises.length} exercises (min expected: ${effectiveMinExercises})`
        );
      }
    }
    if (trimmedTotal > 0) {
      console.warn(`[generateWorkoutPlan] trimmed ${trimmedTotal} excess exercises to respect the ${exerciseCountRange.max}-exercise cap`);
    }

    // ─── L3: پاکسازی سوپرست‌های یتیم بعد از تریم ───
    // حذف حرکات اضافه از انتها ممکن است یکی از اعضای یک supersetGroup را حذف کند؛
    // گروه تک‌عضوی در gym-mode بج «سوپرست» می‌گیرد بدون گروه واقعی → به حرکت عادی
    // تبدیل شود (معادل منطق workouts-view: members.length <= 1 → single).
    for (const day of parsed.days) {
      if (!Array.isArray(day.exercises)) continue;
      const groupCounts = new Map<string, number>();
      for (const ex of day.exercises) {
        if (ex && typeof ex.supersetGroup === "string" && ex.supersetGroup) {
          groupCounts.set(ex.supersetGroup, (groupCounts.get(ex.supersetGroup) || 0) + 1);
        }
      }
      for (const ex of day.exercises) {
        if (ex && ex.supersetGroup && (groupCounts.get(ex.supersetGroup) || 0) < 2) {
          delete ex.supersetGroup;
          delete ex.supersetType;
        }
      }
    }
  }

  // Enrich exercises with IDs + superset fields + new pro fields (rpe, tempo, substitution)
  const enriched: ProWorkoutPlanContent = {
    days: (parsed.days || []).map((day: any) => ({
      ...day,
      // Ensure warmup/cooldown arrays are valid
      warmup: Array.isArray(day.warmup) ? day.warmup.map((w: any) => ({
        name: String(w.name || "گرم‌کردن"),
        durationSec: Number(w.durationSec) || 300,
        notes: w.notes ? String(w.notes) : undefined,
      })) : undefined,
      cooldown: Array.isArray(day.cooldown) ? day.cooldown.map((c: any) => ({
        name: String(c.name || "سردکردن"),
        durationSec: Number(c.durationSec) || 300,
        notes: c.notes ? String(c.notes) : undefined,
      })) : undefined,
      exercises: (day.exercises || []).map((ex: any, i: number) => ({
        ...ex,
        id: `ex_${Math.random().toString(36).slice(2, 9)}`,
        mediaUrl: "",
        // Preserve per-exercise pro fields (rpe, tempo, substitution)
        rpe: typeof ex.rpe === "number" ? Math.max(1, Math.min(10, ex.rpe)) : undefined,
        tempo: typeof ex.tempo === "string" && ex.tempo.trim() ? ex.tempo.trim() : undefined,
        substitution: typeof ex.substitution === "string" && ex.substitution.trim()
          ? ex.substitution.trim()
          : undefined,
        // COACH-TIP: توصیه کوتاه مربی زیر هر حرکت (۱ جمله)
        coachTip: typeof ex.coachTip === "string" && ex.coachTip.trim()
          ? ex.coachTip.trim()
          : undefined,
        sets: (ex.sets || []).map((s: any, j: number) => ({
          ...s,
          setNumber: j + 1,
          done: false,
          weight: undefined,
          rpe: typeof s.rpe === "number" ? Math.max(1, Math.min(10, s.rpe)) : undefined,
        })),
        supersetGroup: ex.supersetGroup || undefined,
        supersetType: ex.supersetType || undefined,
        // Preserve giant-set circuit fields
        circuitRounds: typeof ex.circuitRounds === "number" ? Math.max(1, Math.min(5, Math.round(ex.circuitRounds))) : undefined,
        restBetweenRounds: typeof ex.restBetweenRounds === "number" ? Math.max(0, Math.min(600, Math.round(ex.restBetweenRounds))) : undefined,
      })),
    })),
    weeklyGoal: parsed.weeklyGoal || "بهبود تدریجی قدرت و استقامت",
    notes: parsed.notes || "قبل از شروع حتماً ۵ تا ۱۰ دقیقه گرم کردن انجام دهید.",
    // v75 — گیت پلن: برنامه مکمل فقط standard+ (به‌عنوان لایهٔ دوم پرامپت)
    supplements: getCapabilities(planName ?? null).supplementsPlan ? (parsed.supplements || undefined) : undefined,
    // NEW: professional enrichment fields
    weeklyProgression: parsed.weeklyProgression && typeof parsed.weeklyProgression === "object"
      ? {
          strategy: String(parsed.weeklyProgression.strategy || "افزایش تدریجی وزنه ۲.۵٪ در هفته"),
          weeks: Array.isArray(parsed.weeklyProgression.weeks)
            ? parsed.weeklyProgression.weeks.map((w: any, idx: number) => ({
                week: Number(w.week) || idx + 1,
                weightChangeKg: typeof w.weightChangeKg === "number" ? w.weightChangeKg : undefined,
                repChange: typeof w.repChange === "number" ? w.repChange : undefined,
                note: String(w.note || ""),
              }))
            : [],
        }
      : undefined,
    safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes.map((s: any) => String(s)) : undefined,
    recoveryNotes: Array.isArray(parsed.recoveryNotes) ? parsed.recoveryNotes.map((s: any) => String(s)) : undefined,
    nutritionTimingNotes: Array.isArray(parsed.nutritionTimingNotes) ? parsed.nutritionTimingNotes.map((s: any) => String(s)) : undefined,
    supplementTimingNotes: getCapabilities(planName ?? null).supplementsPlan && Array.isArray(parsed.supplementTimingNotes) ? parsed.supplementTimingNotes.map((s: any) => String(s)) : undefined,
    medicalWarningFlags: Array.isArray(parsed.medicalWarningFlags) ? parsed.medicalWarningFlags.map((s: any) => String(s)) : undefined,
    // ─── WORKOUT-PLAN-PRO: فیلدهای حرفه‌ای جدید ───
    // تکنیک‌های پیشرفته استفاده‌شده در برنامه (FST-7، سوپرست آنتاگونیست، دراپ‌ست، رست پاز، و ...)
    advancedTechniques: Array.isArray(parsed.advancedTechniques)
      ? parsed.advancedTechniques.map((t: any) => String(t)).filter(Boolean)
      : undefined,
    // تقسیم عضلات هفته (push/pull/legs، upper/lower، body part split، و ...)
    muscleGroupSplit: typeof parsed.muscleGroupSplit === "string" && parsed.muscleGroupSplit.trim()
      ? parsed.muscleGroupSplit.trim()
      : undefined,
    // نوع دوره‌بندی (Periodization) — linear / undulating / block / wave / daily_undulating
    periodizationType: (() => {
      const v = parsed.periodizationType;
      if (v === "linear" || v === "undulating" || v === "block" || v === "wave" || v === "daily_undulating") {
        return v;
      }
      // پیش‌فرض بر اساس پلن: ultimate → undulating، بقیه → linear
      return planName === "ultimate" ? "undulating" : "linear";
    })(),
    // فرکانس تمرین هر گروه عضلانی در هفته
    muscleFrequencyPerWeek: typeof parsed.muscleFrequencyPerWeek === "number"
      ? Math.max(1, Math.min(3, Math.round(parsed.muscleFrequencyPerWeek)))
      : (planName === "ultimate" ? 2 : 1),
    // الهام‌گرفته از کدام مربی بزرگ
    inspiredByCoach: (() => {
      const v = parsed.inspiredByCoach;
      if (v === "hany_rambod" || v === "hadi_chupan" || v === "chris_bumstead" || v === "mixed") {
        return v;
      }
      // پیش‌فرض بر اساس پلن
      if (planName === "ultimate") return "mixed";
      if (planName === "advanced") return "chris_bumstead";
      return "mixed";
    })(),
    // جزئیات FST-7 — فقط برای پلن ultimate (و در صورت ارائه AI)
    fst7Details: parsed.fst7Details && typeof parsed.fst7Details === "object" && planName === "ultimate"
      ? {
          exerciseName: String(parsed.fst7Details.exerciseName || ""),
          sets: typeof parsed.fst7Details.sets === "number" ? Math.max(1, Math.min(10, Math.round(parsed.fst7Details.sets))) : 7,
          reps: typeof parsed.fst7Details.reps === "string" && parsed.fst7Details.reps.trim()
            ? parsed.fst7Details.reps.trim()
            : "8-12",
          restSec: typeof parsed.fst7Details.restSec === "number"
            ? Math.max(0, Math.min(300, Math.round(parsed.fst7Details.restSec)))
            : 30,
          note: typeof parsed.fst7Details.note === "string" && parsed.fst7Details.note.trim()
            ? parsed.fst7Details.note.trim()
            : undefined,
        }
      : undefined,
  };

  return enriched;
}

// Generate a daily meal plan via AI
export async function generateMealPlan(
  data: OnboardingData,
  planName?: Plan | null,
  extras?: { bloodTestReport?: string; videoAnalysisResult?: string; bodyPhotoAnalysis?: string; renewalContext?: string }
): Promise<ProMealPlanContent> {
  const systemPrompt = withBrandDirective(
    await getAiConfig(
      "nutrition_system_prompt",
      DEFAULT_NUTRITION_PROMPT
    )
  );
  const context = buildUserContext(data, planName);
  const planInstructions = buildPlanAwareInstructions(planName, { ...extras, trainingExperience: data.trainingExperience });
  const caps = getCapabilities(planName ?? null);
  const tier = getExperienceBasedTechniqueGuidance(data.trainingExperience);

  // ─── محاسبه دقیق TDEE و کالری هدف (WORKOUT-PLAN-PRO) ───
  // از تابع computeTDEEAndTarget استفاده می‌کنیم که بر اساس Mifflin-St Jeor
  // و ضریب فعالیت واقعی کاربر (نه عدد ثابت ۱.۴) محاسبه می‌کند.
  const tdeeData = computeTDEEAndTarget(data);
  const targetCal = tdeeData.targetCalories;

  // Auto-calculated water goal (ml) — use stored value or compute from weight × 35
  const waterGoalMl = typeof data.waterGoalMl === "number" && data.waterGoalMl > 0
    ? data.waterGoalMl
    : Math.round(data.weight * 35);
  const waterGoalLiters = (waterGoalMl / 1000).toFixed(1);

  // Anti-inflammatory context — flag if user has injuries or medical conditions that benefit
  const hasInjuries = !!data.injuries && data.injuries.trim().length > 0;
  const hasMedicalConditions = Array.isArray(data.medicalConditions) && data.medicalConditions.length > 0;
  const needsAntiInflammatory = hasInjuries || hasMedicalConditions;

  const cuisineLabel = data.preferredCuisine
    ? PREFERRED_CUISINE_LABELS[data.preferredCuisine]
    : "ایرانی (پیش‌فرض)";

  const userPrompt = `بر اساس اطلاعات زیر، یک برنامه غذایی یک روزه کامل، حرفه‌ای و شخصی‌سازی‌شده بساز — سطح متخصص تغذیه ورزشی بالینی.

${context}
${planInstructions}

📊 محاسبه دقیق TDEE و درشت‌مغذی‌ها (محاسبه‌شده با فرمول Mifflin-St Jeor):
- BMR (متابولیسم پایه): ${tdeeData.bmr} کالری
- TDEE (نیاز روزانه با توجه به فعالیت): ${tdeeData.tdee} کالری
- کالری هدف (با ${tdeeData.calorieAdjustment >= 0 ? "مازاد" : "نقصان"} ${Math.abs(tdeeData.calorieAdjustment)} کالری): ${targetCal} کالری
- پروتئین: ${tdeeData.proteinG} گرم (${tdeeData.proteinPerKg} گرم به ازای هر کیلو وزن)
- کربوهیدرات: ${tdeeData.carbsG} گرم (${tdeeData.carbsPerKg} گرم به ازای هر کیلو)
- چربی: ${tdeeData.fatG} گرم (${tdeeData.fatPerKg} گرم به ازای هر کیلو)

کالری هدف روزانه: حدود ${targetCal} کالری
نوع رژیم: ${DIET_LABELS[data.dietType]}
حساسیت غذایی: ${data.allergies || "ندارد"}
غذاهای دوست‌نداشته/حذفی: ${data.dislikedFoods || "ندارد"}
سبک آشپزی ترجیحی: ${cuisineLabel}
هدف هیدراتاسیون روزانه: ${waterGoalLiters} لیتر (${waterGoalMl}ml)
${needsAntiInflammatory ? `🩹 نیاز به غذاهای ضدالتهابی: دارد (به دلیل آسیب‌دیدگی/شرایط پزشکی)` : ""}

فقط و فقط با ساختار JSON زیر پاسخ بده و هیچ متن اضافه‌ای ننویس:
{
  "meals": [
    {
      "type": "breakfast",
      "label": "صبحانه",
      "combination": "تخم‌مرغ + نان سنگک + پنیر کم‌چرب",
      "timingNote": "۳۰-۶۰ دقیقه بعد از بیدار شدن — پروتئین صبحانه متابولیسم را روشن می‌کند",
      "items": [
        {
          "name": "تخم‌مرغ آب‌پز",
          "category": "breakfast",
          "calories": 210, "protein": 18, "carbs": 1, "fat": 15,
          "servingSize": "۳ عدد",
          "glycemicIndex": "low",
          "antiInflammatory": false,
          "micronutrients": ["کولین", "ویتامین B12", "سلنیوم", "ویتامین D"],
          "prepTip": "آب‌پز کن، نه سرخ‌کرده — چربی اضافه نده"
        },
        {
          "name": "نان سنگک",
          "category": "breakfast",
          "calories": 160, "protein": 5, "carbs": 32, "fat": 1,
          "servingSize": "۱ کف دست",
          "glycemicIndex": "medium",
          "antiInflammatory": false,
          "micronutrients": ["فیبر", "سلنیوم", "منیزیم"],
          "prepTip": "تازه مصرف کن؛ نان روز قبل را گرم نکن"
        }
      ],
      "micronutrientHighlights": ["کولین برای مغز", "B12 برای انرژی", "فیبر برای گوارش"],
      "alternatives": [
        {
          "combination": "جو دوسر + شیر + موز",
          "items": [
            {"name": "جو دوسر", "category": "breakfast", "calories": 230, "protein": 8, "carbs": 40, "fat": 4, "servingSize": "۶۰ گرم", "glycemicIndex": "low", "antiInflammatory": true, "micronutrients": ["فیبر محلول", "بتاگلوکان", "منیزیم"], "prepTip": "با شیر بپز، نه آب — پروتئین بیشتر"},
            {"name": "شیر کم‌چرب", "category": "breakfast", "calories": 120, "protein": 8, "carbs": 12, "fat": 2, "servingSize": "۱ لیوان", "glycemicIndex": "low", "antiInflammatory": false, "micronutrients": ["کلسیم", "ویتامین D"], "prepTip": "کم‌چرب گرم کن"},
            {"name": "موز", "category": "breakfast", "calories": 105, "protein": 1, "carbs": 27, "fat": 0, "servingSize": "۱ عدد متوسط", "glycemicIndex": "medium", "antiInflammatory": true, "micronutrients": ["پتاسیم", "ویتامین B6"], "prepTip": "رسیده اما نه خیلی سیاه"}
          ]
        }
      ]
    }
  ],
  "waterLiters": ${waterGoalLiters},
  "hydrationSchedule": [
    {"time": "بلافاصله بعد از بیدار شدن", "amountMl": 500, "note": "با چند قطره لیموترش — کبد را فعال می‌کند"},
    {"time": "۹ صبح", "amountMl": 250, "note": "قبل از صبحانه"},
    {"time": "۱۱ صبح", "amountMl": 250, "note": "بین وعده‌ها"},
    {"time": "۱۳ ظهر (قبل از ناهار)", "amountMl": 250, "note": "۳۰ دقیقه قبل از غذا"},
    {"time": "۱۶ بعدازظهر", "amountMl": 300, "note": "میان‌وعده"},
    {"time": "۱۸ عصر (قبل از تمرین)", "amountMl": 300, "note": "آبرسانی قبل از تمرین"},
    {"time": "۲۰ شب (حین تمرین)", "amountMl": 500, "note": "هر ۱۵ دقیقه یک لیوان کوچک"},
    {"time": "۲۲ شب (بعد از تمرین)", "amountMl": 300, "note": "با الکترولیت اگر تعریق زیاد"},
    {"time": "۲۳ شب", "amountMl": 200, "note": "قبل از خواب — اما زیاد نخور که بیدارت نکند"}
  ],
  "prePostWorkoutNutrition": {
    "preWorkout": "۶۰-۹۰ دقیقه قبل از تمرین: ۳۰ گرم کربوهیدرات با GI پایین (مثل موز یا نان جو) + ۱۵ گرم پروتئین",
    "postWorkout": "۳۰-۶۰ دقیقه بعد از تمرین: ۳۰-۴۰ گرم پروتئین سریع‌جذب (مثل پروتئین وی یا تخم‌مرغ) + ۴۰ گرم کربوهیدرات با GI بالا (مثل برنج سفید یا سیب‌زمینی)",
    "note": "پنجره آنابولیک ۳۰-۴۵ دقیقه بعد از تمرین حساس‌ترین زمان برای سنتز پروتئین است"
  },
  "antiInflammatoryFoods": [
    "زردچوبه (با فلفل سیاه برای جذب بهتر)",
    "زنجبیل تازه (۲ گرم در روز)",
    "ماهی چرب (سالمون یا قزل‌آلا)",
    "چای سبز",
    "انار",
    "آووکادو",
    "روغن زیتون فرابکر"
  ],
  "micronutrientHighlights": [
    "ویتامین D3: ۱۰۰۰-۲۰۰۰ IU (با مشورت پزشک)",
    "منیزیم: ۳۰۰-۴۰۰mg برای ریکاوری عضله",
    "امگا ۳: ۱-۲ گرم برای کاهش التهاب",
    "آهن: در صورت کم‌خونی (با مشورت پزشک)"
  ],
  "foodPrepTips": [
    "یک روز در هفته (مثلاً جمعه) تمام پروتئین‌ها را بپز و در ظرف شیشه‌ای در یخچال نگه دار",
    "سبزیجات را شست و خشک کن، در ظرف هوادار نگه دار — تا ۵ روز تازه می‌مانند",
    "برنج و کینوا را یکجا بپز و فریز کن — روزانه یک پرس بردار",
    "سس‌ها و درسینگ‌ها را خودت درست کن (روغن زیتون + لیمو + ادویه) به‌جای سس‌های آماده",
    "میان‌وعده‌ها را از قبل در کیسه‌های کوچک پورشن کن — مچ‌نخوره و راحت"
  ],
  "tdeeBreakdown": {
    "bmr": ${tdeeData.bmr},
    "tdee": ${tdeeData.tdee},
    "targetCalories": ${targetCal},
    "calorieAdjustment": ${tdeeData.calorieAdjustment},
    "proteinG": ${tdeeData.proteinG},
    "carbsG": ${tdeeData.carbsG},
    "fatG": ${tdeeData.fatG},
    "proteinPerKg": ${tdeeData.proteinPerKg},
    "carbsPerKg": ${tdeeData.carbsPerKg},
    "fatPerKg": ${tdeeData.fatPerKg}
  },
  "dietAlternatives": [
    {
      "diet": "وگان (Vegan)",
      "description": "جایگزین کاملاً گیاهی برای این روز — بدون هیچ محصول حیوانی",
      "sampleMeals": ["عدس با برنج قهوه‌ای + سالاد", "توفو скандوبل با کینوا", "اسموتی بول با شیر بادام + پروتئین گیاهی"]
    },
    {
      "diet": "کتوژنیک (Keto)",
      "description": "کربوهیدرات زیر ۵۰ گرم، چربی بالا — برای ورزشکاران کتو",
      "sampleMeals": ["تخم‌مرغ + آووکادو + کره بادام", "سینه مرغ + کره + بروکلی", "ماهی سالمون + روغن نارگیل + اسفناج"]
    },
    {
      "diet": "کم‌کربوهیدرات (Low-Carb)",
      "description": "کربوهیدرات زیر ۱۰۰ گرم برای کنترل قند خون",
      "sampleMeals": ["سینه مرغ + سالاد سبزیجات", "تخم‌مرغ + پنیر + گوجه", "ماهی + سبزیجات بخارپز"]
    },
    {
      "diet": "بدون گلوتن (Gluten-Free)",
      "description": "برای حساسیت به گلوتن یا سلیاک",
      "sampleMeals": ["برنج قهوه‌ای + مرغ", "کینوا + سبزیجات", "سیب‌زمینی + ماهی"]
    }
  ],
  "supplementStack": [
    {"category": "base", "name": "کراتین مونوهیدرات", "dose": "۵ گرم", "timing": "هر روز صبح یا بعد تمرین", "note": "دلیل: هدفِ عضله‌سازی با تمرینِ مقاومتیِ منظم. جایگزینِ غذایی ندارد. با مشورت پزشک.", "contraindicatedFor": ["بیماری کلیوی", "نارسایی کلیه"]},
    {"category": "base", "name": "ویتامین D3", "dose": "۱۰۰۰-۲۰۰۰ واحد", "timing": "همراه صبحانه", "note": "دلیل: آفتابِ کم برای بیشترِ ایرانی‌ها. با مشورت پزشک.", "contraindicatedFor": ["هایپرویتامینوز D"]},
    {"category": "targeted", "name": "کافئین", "dose": "۱۰۰-۲۰۰mg", "timing": "۳۰ دقیقه قبل تمرین", "note": "فقط برای هدفِ چربی‌سوزی/انرژی؛ ساده‌تر: قهوه. نه بعد از ۱۶:۰۰.", "contraindicatedFor": ["بیماری قلبی", "فشار خون بالا", "بی‌خوابی", "اضطراب"]}
  ],
  "notes": "نکات تغذیه‌ای",
  "supplements": [
    {"name": "نام مکمل (مثلاً کراتین مونوهیدرات)", "dose": "۵ گرم", "timing": "بعد از تمرین", "note": "نکته اختیاری"}
  ]
}

مثالِ بالا فقط نمونه است — استکِ واقعی را بر اساس نیازِ همین کاربر بساز (۱ تا ۴ قلم)؛ برای هر مکمل در note دلیلِ تجویز و جایگزینِ غذاییِ ارزان را بنویس. اگر پروتئین از غذا تأمین می‌شود، وی را تجویز نکن و همان را صریح بنویس.

قوانین حرفه‌ای (همه را رعایت کن):

۱) وعده‌ها و درشت‌مغذی‌ها (با محاسبه دقیق TDEE):
- وعده‌ها: صبحانه، ناهار، شام و حداقل یک میان‌وعده (در صورت هدف حجم/قدرت: ۵-۶ وعده).
- درشت‌مغذی‌ها را دقیق محاسبه کن تا جمع کل به کالری هدف (${targetCal}) نزدیک شود.
- پروتئین: ${tdeeData.proteinG} گرم در روز (${tdeeData.proteinPerKg} گرم به ازای هر کیلو — استاندارد جهانی).
- کربوهیدرات: ${tdeeData.carbsG} گرم در روز (${tdeeData.carbsPerKg} گرم به ازای هر کیلو).
- چربی: ${tdeeData.fatG} گرم در روز (حدود ۲۵٪ کالری، ${tdeeData.fatPerKg} گرم به ازای هر کیلو).
- تایمینگ تغذیه: صبحانه (پروتئین + کربوهیدرات پیچیده)، پیش‌تمرین (۹۰-۶۰ دقیقه قبل، GI متوسط)، پس‌تمرین (۳۰-۴۵ دقیقه بعد، پروتئین سریع + کربوهیدرات بالا)، شام (پروتئین + چربی سالم + سبزیجات).

۲) شاخص گلیسمی (GI) — حرفه‌ای:
- برای هر غذا فیلد "glycemicIndex" را پر کن: "low" | "medium" | "high".
- برای هدف کاهش چربی: ۸۰٪ غذاها GI پایین باشند.
- قبل از تمرین: GI متوسط (انرژی سریع).
- بعد از تمرین: GI بالا (ریکاوری سریع گلیکوژن).
- برای دیابت/پیش‌دیابت: فقط GI پایین.

۳) غذاهای ضدالتهابی (antiInflammatory):
- اگر کاربر آسیب‌دیدگی یا شرایط پزشکی دارد (${needsAntiInflammatory ? "دارد" : "ندارد"}):
  • برای هر غذا فیلد "antiInflammatory" را true/false بگذار.
  • آرایه "antiInflammatoryFoods" را با حداقل ۵ غذای ضدالتهایی پر کن (زردچوبه، زنجبیل، ماهی چرب، انار، چای سبز).
  • توصیه مصرف زردچوبه + فلفل سیاه (جذب را ۲۰ برابر می‌کند).
- اگر نه: می‌توانی فیلد را false بگذاری و آرایه را خالی یا چند مورد کلی.

۴) تایمینگ قبل/بعد از تمرین:
- فیلد "prePostWorkoutNutrition" را پر کن با توصیه دقیق قبل و بعد از تمرین.
- فیلد "timingNote" برای هر وعده: چه زمانی از روز بهتر است مصرف شود (نسبت به تمرین یا ساعت).

۵) هیدراتاسیون (بسیار مهم):
- "waterLiters" را بر اساس ${waterGoalLiters} لیتر تنظیم کن (هدف محاسبه‌شده از وزن و فعالیت).
- آرایه "hydrationSchedule" را با حداقل ۶ نقطه در طول روز پر کن — هر نقطه شامل: زمان، مقدار (ml)، و نکته.
- اگر کاربر عادت فعلی کم‌آبی دارد (${typeof data.waterHabit === "number" ? `${data.waterHabit} لیوان` : "نامشخص"}): افزایش تدریجی را در "notes" پیشنهاد بده.

۶) ویتامین‌ها و مواد معدنی:
- برای هر غذا فیلد "micronutrients" را با لیست ویتامین‌ها/مواد معدنی برجسته پر کن.
- برای هر وعده فیلد "micronutrientHighlights" را با توضیح کوتاه بگذار.
- آرایه "micronutrientHighlights" در سطح برنامه را با حداقل ۳-۴ توصیه کلی پر کن (ویتامین D، منیزیم، امگا ۳، و ...).

۷) آماده‌سازی غذا (foodPrepTips):
- آرایه "foodPrepTips" را با حداقل ۴ نکته عملی برای آماده‌سازی هفتگی غذا پر کن (مثل یک‌جا پختن پروتئین، نگه‌داری سبزیجات، فریز برنج، و ...).
- برای هر غذا فیلد "prepTip" را با نکته آماده‌سازی بهتر پر کن (مثلاً "بخارپز کن، نه سرخ‌کرده").

۸) تنوع و جایگزینی (بسیار مهم):
- **فیلد "combination"**: دقیقاً بنویس چه غذاهایی را با هم بخورد، مثلاً "تخم‌مرغ + نان سنگک + پنیر".
- **فیلد "alternatives"**: حداقل ۲ گزینه جایگزین بده.
- ⚠️ قانون الزامی جایگزین‌ها: هر گزینه جایگزین باید در "combination" اندازه و واحد دقیق هر غذا را داشته باشد — مثلاً "جو دوسر ۶۰ گرم + شیر کم‌چرب ۱ لیوان + موز ۱ عدد متوسط". جایگزین بدون اندازه و واحد (مثل فقط "مرغ و برنج") ممنوع است — کاربر باید بداند دقیقاً چقدر بخورد.
- در items هر جایگزین هم فیلد servingSize با عدد و واحد (گرم/لیوان/عدد/کف دست) الزامی است.
- ⚠️ قانون مهم نام غذاها: فیلد "name" فقط نام خالص غذا باشد — بدون عدد/اندازه/واحد. اندازه دقیق فقط در "servingSize" بیاید تا در نمایش واحد دوبار تکرار نشود (مثال درست: name="تخم‌مرغ آب‌پز", servingSize="۳ عدد" — غلط: name="تخم‌مرغ آب‌پز (۳ عدد)").
- غذاهای دوست‌نداشته را حذف کن: ${data.dislikedFoods || "بدون محدودیت اضافه"}.
- حساسیت غذایی را رعایت کن: ${data.allergies || "بدون محدودیت"}.
- 🧾 بودجه: از غذاهای ایرانی در دسترس و مقرون‌به‌صرفه استفاده کن (تخم‌مرغ، مرغ، عدس، حبوبات، ماست، برنج) — از مواد گران و وارداتی (کیل، آووکادو، پروتئین گیاهی وارداتی) فقط اگر واقعاً ضروری است استفاده کن و جایگزین ارزان هم پیشنهاد بده.

۹) سبک آشپزی:
- سبک آشپزی مورد نظر: ${cuisineLabel}. غذاها را بر اساس این سبک انتخاب کن.
- اگر "ترکیبی" است: تنوع ایرانی/مدیترانه‌ای/آسیایی را بده.
- اگر "ایرانی": از مواد در دسترس ایرانی استفاده کن.
- اگر "مدیترانه‌ای": روغن زیتون، ماهی، غلات کامل، سبزیجات فراوان.
- اگر "آسیایی": برنج، سویا، سبزیجات بخارپز، ادویه‌های آسیایی.

۱۰) محدودیت‌های رژیمی:
- ${data.dietType === "vegetarian" ? "فقط غذاهای گیاه‌خواری." : "بدون محدودیت گوشت."}
- ${data.dietType === "vegan" ? "فقط غذاهای وگن." : ""}
- ${data.dietType === "keto" ? "رژیم کتوژنیک با کربوهیدرات زیر ۵۰ گرم در روز." : ""}

۱۱) بخش supplements و supplementStack (مکمل‌ها — داینامیک بر اساس نیازِ همین کاربر):
- ⚠️ قانون طلایی: اول غذا، بعد مکمل. مکمل جای غذا را نمی‌گیرد.
- 🔴 فرمت ثابت ممنوع: استک را با داده‌های همین کاربر بساز (هدف "${GOAL_LABELS[data.goal]}"، رژیم ${data.dietType === "vegetarian" || data.dietType === "vegan" ? "گیاهی" : "مختلط"}، مکمل‌های فعلی: ${data.currentSupplements || "ندارد"}، شرایط پزشکی، سن و جنس). برای هر مکمل اول «نیاز» را ثابت کن و در note دلیلش را بنویس؛ نیاز نیست → تجویز نکن.
- تعداد نهایی: ۱ تا ۴ قلم (به‌ندرت ۵). اگر رژیمِ وعده‌ها پوشش می‌دهد، صریح بنویس «برای تو مکمل خاصی لازم نیست» و فقط ۱-۲ قلمِ واقعاً مفید بگذار.
- منطقِ انتخاب:
  • ویتامین D3 → اکثر ایرانی‌ها (آفتابِ کم) — با دلیلِ کوتاه.
  • امگا ۳ → فقط اگر ماهیِ هفتگیِ کاربر کم است.
  • کراتین → فقط هدفِ عضله‌سازی/قدرت؛ برای چربی‌سوزیِ خالص نه.
  • پروتئین وی → فقط اگر پروتئینِ روزانه از وعده‌ها به هدفِ g×kg نمی‌رسد.
  • B12 → وگان/گیاه‌خوارِ سخت‌گیر. کافئین → چربی‌سوزی بدون مشکلِ قلبی/خواب.
- BCAA/EAA، بتاآلانین، سیترین مالات، گلوتامین، گینر، ال-کارنیتین، کلاژن و ZMA هرگز آیتمِ اصلی نباشند — حداکثر در note به‌عنوان «در صورتِ بودجه‌ی اضافه» با جایگزینِ غذاییِ ارزان.
- بخش «supplementStack» (دسته‌بندی‌شده) با category: "base" (ضروریِ همین کاربر) | "advanced" (پوششِ شکافِ خاص) | "targeted" (هدفمندِ ارزان) — فقط دسته‌های لازم را پر کن؛ دسته‌ی خالی نساز.
- 💰 بودجه کاربر (بر اساس پلن «${PLAN_LABELS[planName ?? "basic"] || "اقتصادی"}»): اولویت با مکمل‌های ارزان و مؤثر؛ در note هر مکمل گزینه‌ی غذایی جایگزینِ ارزان را بنویس (ماهی کنسروی به‌جای امگا۳، تخم‌مرغ و مرغ به‌جای وی).
- هر مکمل باید فیلد contraindicatedFor (آرایه‌ای از شرایط منع مصرف) داشته باشد:
  • کافئین → بیماران قلبی، فشار خون بالا، بی‌خوابی
  • کراتین → بیماران کلیوی
  • پروتئین وی → بیماران کلیوی پیشرفته
- اگر کاربر مکمل فعلی مصرف می‌کند (${data.currentSupplements || "ندارد"}): تداخل و هماهنگی را در "note" بیاور.
- هرگز دوز بالاتر از استاندارد تجویز نکن. در note بنویس: «قبل از شروع با پزشک مشورت کنید.»
۱۲) فیلد tdeeBreakdown (الزامی):
- این فیلد قبلاً با مقادیر محاسبه‌شده پر شده — مقادیر را دست نزن و در طرح وعده‌ها از آن‌ها استفاده کن.
- جمع کالری وعده‌ها باید به targetCalories نزدیک باشد (±۵۰ کالری).
- جمع پروتئین وعده‌ها باید به proteinG نزدیک باشد.

۱۳) فیلد dietAlternatives (الزامی):
- آرایه‌ای از جایگزین‌های رژیمی برای این روز — حداقل ۴ رژیم: وگان، کتوژنیک، کم‌کربوهیدرات، بدون گلوتن.
- هر جایگزین شامل: diet (نام)، description (توضیح کوتاه)، sampleMeals (آرایه ۳ وعده نمونه).
- غذاهای نمونه باید ایرانی و در دسترس باشند (عدس، کینوا، برنج قهوه‌ای، توفو، آووکادو، و ...).

۱۴) شخصی‌سازی بر اساس هدف و شرایط:
- هدف: ${GOAL_LABELS[data.goal]} — توزیع درشت‌مغذی را بر اساس هدف تنظیم کن.
- اگر خواب ناکافی یا استرس بالا: در "notes" توصیه‌های تغذیه‌ای برای بهبود خواب (منیزیم، کافیین قبل از ۱۴) و مدیریت کورتیزول (کاهش قند، افزایش امگا ۳) اضافه کن.`;

  let content: string;
  try {
    // ─── تولید برنامه غذایی + مکمل (دیریکتیو مالک v40) ───
    // gemini-3.8-flash + تفکر high، فال‌بک deepseek-v4-flash — مثل برنامه تمرینی؛
    // تولید در پس‌زمینه است. اعتبارسنج داخل زنجیره — پاسخِ بی‌وعده،
    // مستقیم به مدل فال‌بک می‌رود
    content = await generatePlanContent(
      systemPrompt,
      userPrompt,
      "generateMealPlan",
      (text) => {
        const p = parseJsonFromContent(text);
        return Array.isArray(p?.meals) && p.meals.length > 0
          ? null
          : "پاسخ نامعتبر از هوش مصنوعی (برنامه غذایی خالی)";
      }
    );
  } catch (err) {
    console.error("[generateMealPlan] AvalAI error:", err);
    throw err instanceof Error ? err : new Error("خطا در ارتباط با سرویس هوش مصنوعی. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);

  // ─── M1: اعتبارسنجی پاسخ — برنامه غذایی خالی نباید به‌عنوان موفقیت ذخیره شود ───
  // (اسکیمای برنامه غذایی فیلد days ندارد؛ ملاک، آرایه meals غیرخالی است)
  if (!Array.isArray(parsed.meals) || parsed.meals.length === 0) {
    console.error("[generateMealPlan] AI returned empty/invalid plan. Content head:", content.slice(0, 300));
    throw new Error("پاسخ نامعتبر از هوش مصنوعی (برنامه غذایی خالی)");
  }

  // Helper to coerce glycemicIndex to a valid value
  const coerceGI = (v: any): "low" | "medium" | "high" | undefined => {
    if (v === "low" || v === "medium" || v === "high") return v;
    return undefined;
  };

  // Calculate totals & enrich — handle main items + alternatives
  const meals = (parsed.meals || []).map((m: any) => {
    const items = (m.items || []).map((it: any, i: number) => ({
      ...it,
      id: `food_${Math.random().toString(36).slice(2, 9)}`,
      imageUrl: "",
      done: false,
      // ─── L8: coerce عددی هر قلم — اگر AI رشته (حتی با ارقام فارسی «۲۱۰») برگرداند،
      // جمع‌های وعده رشته‌ای می‌شد و insert با MealPlan.totalCal (Int) می‌شکست.
      calories: toSafeNumber(it.calories),
      protein: toSafeNumber(it.protein),
      carbs: toSafeNumber(it.carbs),
      fat: toSafeNumber(it.fat),
      // NEW: professional enrichment fields
      glycemicIndex: coerceGI(it.glycemicIndex),
      antiInflammatory: typeof it.antiInflammatory === "boolean" ? it.antiInflammatory : undefined,
      micronutrients: Array.isArray(it.micronutrients) ? it.micronutrients.map((n: any) => String(n)) : undefined,
      prepTip: typeof it.prepTip === "string" && it.prepTip.trim() ? it.prepTip.trim() : undefined,
    }));
    // Enrich alternatives
    const alternatives = Array.isArray(m.alternatives) ? m.alternatives.map((alt: any, ai: number) => {
      const altItems = (alt.items || []).map((it: any, i: number) => ({
        ...it,
        id: `food_alt_${ai}_${Math.random().toString(36).slice(2, 9)}`,
        imageUrl: "",
        done: false,
        // L8: coerce عددی مثل آیتم‌های اصلی
        calories: toSafeNumber(it.calories),
        protein: toSafeNumber(it.protein),
        carbs: toSafeNumber(it.carbs),
        fat: toSafeNumber(it.fat),
        glycemicIndex: coerceGI(it.glycemicIndex),
        antiInflammatory: typeof it.antiInflammatory === "boolean" ? it.antiInflammatory : undefined,
        micronutrients: Array.isArray(it.micronutrients) ? it.micronutrients.map((n: any) => String(n)) : undefined,
        prepTip: typeof it.prepTip === "string" && it.prepTip.trim() ? it.prepTip.trim() : undefined,
      }));
      return {
        combination: alt.combination || "",
        items: altItems,
        totalCalories: altItems.reduce((s: number, x: any) => s + (Number(x.calories) || 0), 0),
      };
    }) : undefined;

    return {
      ...m,
      items,
      combination: m.combination || items.map((it: any) => it.name).join(" + "),
      alternatives,
      timingNote: typeof m.timingNote === "string" && m.timingNote.trim() ? m.timingNote.trim() : undefined,
      micronutrientHighlights: Array.isArray(m.micronutrientHighlights)
        ? m.micronutrientHighlights.map((h: any) => String(h))
        : undefined,
      totalCalories: items.reduce((s: number, x: any) => s + (Number(x.calories) || 0), 0),
      totalProtein: items.reduce((s: number, x: any) => s + (Number(x.protein) || 0), 0),
      totalCarbs: items.reduce((s: number, x: any) => s + (Number(x.carbs) || 0), 0),
      totalFat: items.reduce((s: number, x: any) => s + (Number(x.fat) || 0), 0),
    };
  });

  // Coerce prePostWorkoutNutrition if present
  let prePostWorkoutNutrition: MealPlanContent["prePostWorkoutNutrition"] = undefined;
  if (parsed.prePostWorkoutNutrition && typeof parsed.prePostWorkoutNutrition === "object") {
    const p = parsed.prePostWorkoutNutrition;
    prePostWorkoutNutrition = {
      preWorkout: String(p.preWorkout || ""),
      postWorkout: String(p.postWorkout || ""),
      note: typeof p.note === "string" && p.note.trim() ? p.note.trim() : undefined,
    };
  }

  return {
    meals,
    // L8: جمع کل باید عدد صحیح امن باشد — مستقیم داخل MealPlan.totalCal (Int) insert می‌شود
    totalCalories: Math.min(2_000_000, Math.round(meals.reduce((s, m) => s + (Number(m.totalCalories) || 0), 0))),
    totalProtein: meals.reduce((s, m) => s + (Number(m.totalProtein) || 0), 0),
    totalCarbs: meals.reduce((s, m) => s + (Number(m.totalCarbs) || 0), 0),
    totalFat: meals.reduce((s, m) => s + (Number(m.totalFat) || 0), 0),
    waterLiters: Number(parsed.waterLiters) || Number(waterGoalLiters) || 2.5,
    notes: parsed.notes || "در طول روز منظم آب بنوشید.",
    // v75 — گیت پلن: مکمل فقط standard+ — برای اقتصادی صریحاً حذف (لایهٔ دوم پرامپت)
    supplements: getCapabilities(planName ?? null).supplementsPlan && Array.isArray(parsed.supplements) && parsed.supplements.length > 0
      ? parsed.supplements.map((s: any, i: number) => ({
          name: String(s.name || `مکمل ${i + 1}`),
          dose: String(s.dose || ""),
          timing: String(s.timing || ""),
          note: s.note ? String(s.note) : undefined,
        }))
      : undefined,
    // NEW: professional enrichment fields
    hydrationSchedule: Array.isArray(parsed.hydrationSchedule)
      ? parsed.hydrationSchedule.map((h: any) => ({
          time: String(h.time || ""),
          amountMl: Number(h.amountMl) || 0,
          note: typeof h.note === "string" && h.note.trim() ? h.note.trim() : undefined,
        }))
      : undefined,
    antiInflammatoryFoods: Array.isArray(parsed.antiInflammatoryFoods)
      ? parsed.antiInflammatoryFoods.map((s: any) => String(s))
      : undefined,
    prePostWorkoutNutrition,
    foodPrepTips: Array.isArray(parsed.foodPrepTips)
      ? parsed.foodPrepTips.map((s: any) => String(s))
      : undefined,
    micronutrientHighlights: Array.isArray(parsed.micronutrientHighlights)
      ? parsed.micronutrientHighlights.map((s: any) => String(s))
      : undefined,
    // ─── WORKOUT-PLAN-PRO: فیلدهای حرفه‌ای جدید برنامه غذایی ───
    // تفکیک دقیق محاسبه TDEE و درشت‌مغذی‌ها (محاسبه‌شده با Mifflin-St Jeor)
    tdeeBreakdown: {
      bmr: tdeeData.bmr,
      tdee: tdeeData.tdee,
      targetCalories: tdeeData.targetCalories,
      calorieAdjustment: tdeeData.calorieAdjustment,
      proteinG: tdeeData.proteinG,
      carbsG: tdeeData.carbsG,
      fatG: tdeeData.fatG,
      proteinPerKg: tdeeData.proteinPerKg,
      carbsPerKg: tdeeData.carbsPerKg,
      fatPerKg: tdeeData.fatPerKg,
    },
    // جایگزین‌های رژیمی — وگان، کتو، کم‌کربوهیدرات، بدون گلوتن
    // اگر AI آرایه‌ای ارائه داد از آن استفاده کن، در غیر این صورت ۴ جایگزین پیش‌فرض
    dietAlternatives: Array.isArray(parsed.dietAlternatives) && parsed.dietAlternatives.length > 0
      ? parsed.dietAlternatives.map((d: any) => ({
          diet: String(d.diet || ""),
          description: String(d.description || ""),
          sampleMeals: Array.isArray(d.sampleMeals)
            ? d.sampleMeals.map((m: any) => String(m))
            : [],
        }))
      : [
          {
            diet: "وگان (Vegan)",
            description: "جایگزین کاملاً گیاهی — بدون هیچ محصول حیوانی",
            sampleMeals: [
              "عدس با برنج قهوه‌ای + سالاد",
              "توفو скандوبل با کینوا",
              "اسموتی بول با شیر بادام + پروتئین گیاهی",
            ],
          },
          {
            diet: "کتوژنیک (Keto)",
            description: "کربوهیدرات زیر ۵۰ گرم، چربی بالا",
            sampleMeals: [
              "تخم‌مرغ + آووکادو + کره بادام",
              "سینه مرغ + کره + بروکلی",
              "ماهی سالمون + روغن نارگیل + اسفناج",
            ],
          },
          {
            diet: "کم‌کربوهیدرات (Low-Carb)",
            description: "کربوهیدرات زیر ۱۰۰ گرم برای کنترل قند خون",
            sampleMeals: [
              "سینه مرغ + سالاد سبزیجات",
              "تخم‌مرغ + پنیر + گوجه",
              "ماهی + سبزیجات بخارپز",
            ],
          },
          {
            diet: "بدون گلوتن (Gluten-Free)",
            description: "برای حساسیت به گلوتن یا سلیاک",
            sampleMeals: [
              "برنج قهوه‌ای + مرغ",
              "کینوا + سبزیجات",
              "سیب‌زمینی + ماهی",
            ],
          },
        ],
    // استک مکمل پیشرفته — فقط پلن‌های standard+ (v75 — گیت پلن برگشت)
    supplementStack: getCapabilities(planName ?? null).supplementsPlan && Array.isArray(parsed.supplementStack) && parsed.supplementStack.length > 0
      ? parsed.supplementStack.map((s: any) => ({
          category: (s.category === "base" || s.category === "advanced" || s.category === "targeted")
            ? s.category
            : "base",
          name: String(s.name || ""),
          dose: String(s.dose || ""),
          timing: String(s.timing || ""),
          note: typeof s.note === "string" && s.note.trim() ? s.note.trim() : undefined,
          contraindicatedFor: Array.isArray(s.contraindicatedFor)
            ? s.contraindicatedFor.map((c: any) => String(c))
            : undefined,
        }))
      : undefined,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * v71 دیریکتیو مالک: «فقط تولید برنامه و تحلیل عکس‌ها و ویدیوها به عهدهٔ جمنای
 * است و بقیه به عهدهٔ دیپ‌سیک» — پس در چت با فیتاپ:
 *   ۱) تحلیل رسانه (عکس/فریم‌های ویدیو) یک کال مستقل جمنای است (analyzeChatMedia)
 *      و متنِ تحلیلش در DB کش می‌شود (ChatMessage.mediaAnalysis).
 *   ۲) «نوشتن پاسخ نهایی» همیشه دیپ‌سیک است (aiChat) — تحلیل جمنای به‌صورت متن
 *      تزریق می‌شود تا هر دو مدل با هم سینک بمانند و هیچ پیام متنی‌ای به جمنای
 *      نرود (کاهش هزینه + پاسخ‌های متنی همیشه یکدست از یک مدل).
 * ═══════════════════════════════════════════════════════════════════════════ */
const CHAT_MEDIA_ANALYSIS_SYSTEM_PROMPT = `تو «چشم مربی فیتاپ» هستی — یک تحلیل‌گر بینایی دقیق و فنی. وظیفهٔ تو فقط یک چیز است: تحلیل محتوای تصاویر/فریم‌های ویدیویی که کاربر در چت با مربی فرستاده است. پاسخ تو به کاربر نشان داده نمی‌شود؛ به‌عنوان گزارش ورودی به مربی هوشمند (مدل متنی) داده می‌شود تا پاسخ نهایی را بنویسد. پس فارسی، خلاصه، دقیق و ساختارمند بنویس (حداکثر ~۲۰۰ کلمه):

- عکس غذا: همهٔ خوراکی‌های قابل تشخیص، تخمین حجم هر آیتم، تخمین کالری و درشت‌مغذی، نکات ظاهری (روغن، نان، نوشیدنی و…).
- عکس بدن/پیشرفت: ترکیب بدنی ظاهری، توزیع چربی، فرم و وضعیت بدن، وضعیت عضلات، هر تغییر قابل‌مشاهده.
- عکس/فریم‌های تمرین: نام حرکت (در صورت تشخیص)، فرم اجرا در هر فریم (برای ویدیو به ترتیب زمانی از شروع تا پایان)، دامنهٔ حرکتی، وضعیت زانو/کمر/ستون فقرات، خطاهای تکنیکی، کیفیت زاویهٔ دوربین.
- هر چیز دیگر: دقیقاً گزارش کن تصویر چیست.

اگر تصویر مبهم/تیره/ناقص است صادقانه و کوتاه بگو چه چیزی قابل تشخیص نیست، اما هرچه قابل تشخیص است را کامل گزارش کن. هیچ توصیهٔ نهایی به کاربر نده، هیچ سلام و مقدمهٔ چت ننویس و هیچ سوال از کاربر نپرس؛ فقط گزارش تحلیلی خالص.`;

/**
 * v71 — تحلیل رسانهٔ چت با فیتاپ (فقط تحلیل). v73: VISION_MODEL = deepseek-v4.1-flash
 * (بینایی بومی از مسیر آداپتور /v1/messages) — فال‌بک gemini-3.8-flash.
 * خروجی: متن گزارش تحلیلی که (۱) در ChatMessage.mediaAnalysis کش می‌شود و
 * (۲) به aiChat (دیپ‌سیک) تزریق می‌شود. فال‌بک خودکار: FALLBACK_VISION_MODEL (gemini-3.8-flash).
 */
export async function analyzeChatMedia(
  kind: "image" | "video-frames",
  dataUrls: string[],
  caption?: string,
  userId?: string | null
): Promise<string> {
  const userText = caption?.trim()
    ? `متن همراه کاربر: «${caption.trim()}»\n\nتحلیل فنی رسانهٔ بالا را طبق دستور سیستم تولید کن.`
    : kind === "video-frames"
      ? "کاربر ویدیو فرستاده است؛ فریم‌های بالا به ترتیب زمانی از شروع تا پایان حرکت‌اند. تحلیل فنی توالی را طبق دستور سیستم تولید کن."
      : "کاربر عکس فرستاده است. تحلیل فنی آن را طبق دستور سیستم تولید کن.";
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: userText },
    ...dataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  return await createChatCompletionWithRetry(
    {
      model: VISION_MODEL,
      messages: [
        { role: "system", content: CHAT_MEDIA_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      // سقف خروجی تحلیل — گزارش ۲۰۰ کلمه‌ای کافی است (کنترل هزینه/زمان)
      max_tokens: 1200,
      ...(kind === "image" ? { reasoning_effort: "low" } : {}),
    } as any,
    "aiChat-media-analysis",
    3,
    { userId }
  );
}

// AI chat - streaming not needed, return full message
export async function aiChat(
  data: OnboardingData | null,
  history: { role: string; content: string }[],
  userMessage: string,
  planName?: Plan | null,
  mediaAnalysis?: string | null,
  userId?: string | null,
  /** v77 — یادداشت سیستمی (وضعیت بازتولید برنامه) — در پرامپت سیستم تزریق می‌شود */
  systemNote?: string | null
): Promise<string> {
  // ─── v79 — دانش زندهٔ سایت: پس از پرامپت (پیش‌فرض یا دیتابیس) تزریق می‌شود؛ مالک با ویرایش
  // ردیف "site_knowledge" در جدول AiConfig آن را زنده به‌روز می‌کند (کامنت بلوک DEFAULT_SITE_KNOWLEDGE).
  const systemPrompt = withSiteKnowledge(
    withBrandDirective(await getAiConfig("chat_system_prompt", DEFAULT_CHAT_PROMPT)),
    await getAiConfig("site_knowledge", DEFAULT_SITE_KNOWLEDGE)
  );

  const contextPart = data
    ? `\n\nاطلاعات کاربر فعلی:\n${buildUserContext(data, planName)}\n\nپاسخ‌هایت را بر اساس این اطلاعات شخصی‌سازی کن.`
    : "";

  // محدودیت بر اساس پلن: اگر Basic/Standard، فقط پاسخ محدود به برنامه تمرین/تغذیه
  const caps = getCapabilities(planName ?? null);
  const planNote = !caps.aiChatQuestions
    ? "\n\nتوجه: این کاربر به چت کامل دسترسی ندارد و فقط پاسخ محدود درباره برنامه موجود می‌بیند. اگر سوال خارج از برنامه پرسید، به خرید پلن Advanced دعوت کن."
    : "";

  // ─── v71 معماری دومرحله‌ای (v73 به‌روزرسانی): مدل بینایی تحلیل می‌کند، نویسندهٔ متن می‌نویسد ───
  // مدیا هرگز مستقیم به این کال پیوست نمی‌شود (کال چت، کال «متن» است — تحلیل رسانه
  // یک‌بار جداگانه با VISION_MODEL انجام و کش می‌شود؛ صرفه‌جویی در کال تکراری).
  // گزارش تحلیلی رسانه در «پیام سیستم» تزریق می‌شود (بالاترین وزن تبعیت — تست واقعی
  // نشان داد تزریق داخل پیام کاربر گاهی توسط مدل نادیده گرفته می‌شود و «دسترسی ندارم»
  // می‌گفت) تا مربی «بداند» کاربر چه عکس/ویدیویی فرستاده و پاسخ سینک‌شده بنویسد.
  const mediaSystemNote = mediaAnalysis?.trim()
    ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nگزارش بینایی رسانه (منبع: مدل بینایی فیتاپ — گزارش واقعی و معتبر):\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${mediaAnalysis.trim()}\n\n⚠️ دستور الزامی: گزارش بالا توصیف دقیق رسانهٔ (عکس/ویدیوی) ارسالی کاربر است. تو از طریق همین گزارش رسانه را «می‌بینی». هرگز و تحت هیچ شرایطی نگو که به عکس/ویدیو دسترسی نداری یا نمی‌توانی آن را ببینی — بر اساس گزارش بالا پاسخ کامل و دقیق بده.`
    : "";

  // ─── v77 — قاعدهٔ صداقت دربارهٔ تغییر برنامه (همیشه فعال — مستقل از پرامپت ذخیره‌شدهٔ دیتابیس) ───
  // ریشهٔ تیکت مالک (سجاد لطفی): مدل در چت «ثبت شد ✅» می‌گفت بدون اینکه هیچ تغییری در
  // برنامهٔ رسمی اعمال شود؛ حتی به کاربر می‌گفت اپ را حذف و نصب کند!
  // وقتی بازتولید خودکار شروع شده باشد، وضعیت واقعی از طریق systemNote (پارامتر بالا)
  // جداگانه تزریق می‌شود و اولویت بر این قاعدهٔ عمومی دارد.
  const honestyDirective =
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nقاعدهٔ صداقت دربارهٔ برنامهٔ رسمی (الزامی — در همهٔ حالت‌ها):\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n- برنامهٔ رسمی کاربر (تب‌های تمرین/تغذیه/مکمل) فقط با موتور تولید فیتاپ ساخته و به‌روز می‌شود. تو هیچ ابزار مستقیمی برای ویرایش آن نداری، مگر اینکه «پیام سیستمیِ وضعیت بازتولید» صریحاً وضعیت را به تو گزارش کرده باشد.\n- هرگز و تحت هیچ شرایطی ادعا نکن که تغییری را در برنامهٔ رسمی «ثبت کردی»، «اعمال کردی» یا «ذخیره کردی» مگر پیام سیستمی صریحاً تأییدش کرده باشد.\n- هرگز ادعا نکن که تصمیم پیش‌نیازها (مثل «آپلود نمی‌کنم» آزمایش خون یا ویدیو) را در سیستم ثبت کرده‌ای — این انتخاب فقط با دکمه‌های خود پنل کاربر ثبت می‌شود؛ اگر کاربر گفت «آپلود نمی‌کنم»، او را به تب داشبورد برای زدن همان دکمه راهنمایی کن.\n- اگر کاربر خواست برنامهٔ کاملش با درخواست‌هایش عوض شود: سیستم فیتاپ بازتولید خودکار را پشتیبانی می‌کند — او را مطمئن کن درخواستش قابل اعمال است، بدون توضیح فنی دروغ.\n- هرگز به کاربر نگو اپلیکیشن را حذف و نصب کند تا برنامه عوض شود — این کار برنامه را عوض نمی‌کند و وقت کاربر تلف می‌شود.`
      + (systemNote?.trim() ? `\n\n[وضعیت به‌روزِ همین گفت‌وگو]:${systemNote.trim()}` : "");

  const historyMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = history.slice(-15).map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
    content: m.content,
  }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + contextPart + planNote + mediaSystemNote + honestyDirective },
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  try {
    const content = await createChatCompletionWithRetry({
      // v73 دیریکتیو مالک: نویسندهٔ پاسخ چت روی deepseek-v4.1-flash با تفکر low
      // (حتی برای پیام‌های بعد از عکس/ویدیو — سینک از طریق متنِ تحلیل رسانه
      // انجام می‌شود نه پیوست مدیا).
      // فال‌بک صریح: اگر deepseek نشد → gemini-3.8-flash (TEXT_MODEL).
      model: TEXT_TASK_MODEL,
      fallback_model: TEXT_MODEL,
      // v72 حسابداری — سقف خروجی پاسخ چت (پاسخ مربی هرگز طولانی‌تر از این نیست)
      max_tokens: 4096,
      messages,
      // چت متنی: تفکر low (پاسخ سریع — دیریکتیو کاربر).
      reasoning_effort: "low",
    } as any, "aiChat", 3, { userId });
    return content || "متأسفم، پاسخی دریافت نشد. دوباره تلاش کنید.";
  } catch (err) {
    console.error("[aiChat] AvalAI error:", err);
    throw new Error("خطا در ارتباط با مربی هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }
}

/** چت نیکا — دستیار فروش و راهنما (هیچ برنامه‌ای تجویز نمی‌کند) */
// v46: کش ۵ دقیقه‌ای لیست مقالات برای پرامپت نیکا (کاهش توکن هر تماس)
const nikaArticlesCache: { value: { title: string; slug: string; category: string; excerpt: string | null }[] | null; at: number } = {
  value: null,
  at: 0,
};

// v70 حسابداری: کش ۵ دقیقه‌ای قیمت‌های زنده — قبلاً در «هر» پیام نیکا کوئری DB
// + ساخت رشته قیمت تکرار می‌شد؛ محتوای آن مثل مقالات هر ۵ دقیقه یک‌بار کافی است.
const nikaPricingCache: { value: string | null; at: number } = { value: null, at: 0 };

export async function nikaChat(
  history: { role: string; content: string }[],
  userMessage: string,
  userPlan: Plan | null,
  userInfo?: { name: string | null; mobile: string | null; planName: string | null; planExpiresAt: string | null; walletBalance: number },
  userId?: string | null
): Promise<string> {
  // ─── v79 — دانش زندهٔ سایت: پس از پرامپت نیکا (پیش‌فرض یا دیتابیس) تزریق می‌شود؛ نیکا هم
  // همیشه ساختار زندهٔ سایت را می‌داند (کامنت بلوک DEFAULT_SITE_KNOWLEDGE).
  const systemPrompt = withSiteKnowledge(
    withBrandDirective(await getAiConfig("nika_system_prompt", DEFAULT_NIKA_PROMPT)),
    await getAiConfig("site_knowledge", DEFAULT_SITE_KNOWLEDGE)
  );

  // اضافه کردن اطلاعات پلن کاربر برای راهنمایی هدفمند
  const planInfo = userPlan
    ? `\n\nوضعیت پلن کاربر: ${userPlan === "basic" ? "اقتصادی (بدون چت مربی)" : userPlan === "standard" ? "استاندارد (بدون چت مربی)" : userPlan === "advanced" ? "پیشرفته (چت مربی فعال)" : "حرفه‌ای (چت مربی فعال + آنالیز ویدیو/آزمایش خون + پشتیبانی اختصاصی)"}`
    : "\n\nوضعیت پلن کاربر: مهمان (بدون ثبت‌نام)";

  // ─── اطلاعات کاربر (برای شناخت کاربر) ───
  // نیکا باید کاربر را بشناسد — نام، شماره موبایل، پلن فعلی، تاریخ انقضا، موجودی کیف پول
  let userInfoContext = "";
  if (userInfo && userInfo.name) {
    userInfoContext = `\n\n👤 اطلاعات کاربر:\n- نام: ${userInfo.name}\n- موبایل: ${userInfo.mobile}\n- پلن فعلی: ${userInfo.planName || "ندارد"}\n- تاریخ انقضای پلن: ${userInfo.planExpiresAt ? new Date(userInfo.planExpiresAt).toLocaleDateString("fa-IR") : "—"}\n- موجودی کیف پول: ${userInfo.walletBalance.toLocaleString("en-US")} تومان\n`;
    userInfoContext += `\n⚠️ این کاربر را با نام صدا بزن و شخصی‌سازی پاسخ بده.`;
  }

  const upsellHint =
    !userPlan || userPlan === "basic" || userPlan === "standard"
      ? "\n\nیادآوری: این کاربر هنوز به چت مربی هوشمند دسترسی ندارد. او را به خرید پلن پیشرفته یا حرفه‌ای ترغیب کن."
      : "";

  // ─── قیمت‌های زنده پلن‌ها (آپدیت خودکار) ───
  // تا وقتی ادمین قیمت‌ها را تغییر می‌دهد، نیکا همیشه قیمت‌های جدید را بداند.
  // 🩹 v70: کش ۵ دقیقه‌ای در-حافظه (هم‌الگوی کش مقالات) — قبلاً کوئری DB و ساخت
  // رشته قیمت در هر پیام تکرار می‌شد.
  let livePricing = "";
  try {
    const now = Date.now();
    if (!nikaPricingCache.value || now - nikaPricingCache.at > 5 * 60 * 1000) {
      const { getActivePlans } = await import("@/lib/fitness/pricing");
      const plans = await getActivePlans();
      let block = `\n\n💰 قیمت‌های فعلی پلن‌ها (همیشه به‌روز — این قیمت‌ها را به کاربر بگو):\n`;
      for (const p of plans) {
        block += `- ${p.label}: ${p.price.toLocaleString("en-US")} تومان (${p.durationDays} روزه)\n`;
      }
      block += `\n⚠️ مهم: فقط و فقط این قیمت‌های به‌روز را به کاربر بگو. قیمت‌های داخل پرامپت اولیه ممکن است قدیمی باشند — همیشه از این قیمت‌های زنده استفاده کن.`;
      nikaPricingCache.value = block;
      nikaPricingCache.at = now;
    }
    livePricing = nikaPricingCache.value ?? "";
  } catch {
    // اگر DB در دسترس نبود، از قیمت‌های پیش‌فرض استفاده می‌شود
  }

  // ─── اشراف نیکا به مقالات سایت (آپدیت خودکار) ───
  // هر بار که نیکا فراخوانی می‌شود، لیست مقالات منتشرشده از DB خوانده می‌شود
  // تا نیکا همیشه به آخرین مقالات دسترسی داشته باشد
  // 🩹 v46: کش ۵ دقیقه‌ای در-حافظه — قبلاً این کوئری + ~۱.۵K توکن پرامپت
  // در «هر» پیام نیکا تکرار می‌شد؛ محتوای مقالات هر ۵ دقیقه یک‌بار کافی است.
  let articlesContext = "";
  try {
    const now = Date.now();
    if (!nikaArticlesCache.value || now - nikaArticlesCache.at > 5 * 60 * 1000) {
      const articles = await db.article.findMany({
        where: { status: "published" },
        select: { title: true, slug: true, category: true, excerpt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      nikaArticlesCache.value = articles;
      nikaArticlesCache.at = now;
    }
    const articles = nikaArticlesCache.value;
    if (articles && articles.length > 0) {
      articlesContext = `\n\n📄 مقالات منتشرشده فیتاپ (${articles.length} مقاله — همیشه به‌روز):\n`;
      articlesContext += articles
        .map((a) => `- "${a.title}" (دسته: ${a.category}) — ${a.excerpt?.substring(0, 80) || ""}`)
        .join("\n");
      articlesContext += `\n\nمی‌توانی کاربران را به خواندن این مقالات دعوت کنی با فرمت: [عنوان مقاله](action:articles)`;
    }
  } catch {
    // DB may not be available
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + planInfo + userInfoContext + upsellHint + livePricing + articlesContext },
    ...history.slice(-10).map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    const content = await createChatCompletionWithRetry({
      // v58 — دیریکتیو مالک: چت نیکا با deepseek-v4-flash (همان کلید AvalAI)
      model: NIKA_MODEL,
      messages,
      reasoning_effort: "low", // چت با نیکا: تفکر low (پاسخ سریع برای تجربه کاربری بهتر)
      // v58 — فال‌بک صریح: اگر deepseek نشد → همان مدل متن قبلی (gemini-3.8-flash)
      fallback_model: TEXT_MODEL,
      // v72 حسابداری — سقف خروجی پاسخ نیکا
      max_tokens: 2048,
    } as any, "nikaChat", 3, { userId });
    return content || "متأسفم، پاسخی دریافت نشد. دوباره تلاش کنید.";
  } catch (err) {
    console.error("[nikaChat] AvalAI error:", err);
    throw new Error("خطا در ارتباط با نیکا. لطفاً کمی بعد دوباره تلاش کنید.");
  }
}

/** چت دستیار هوشمند پنل مدیریت — تحلیل آمار، پیشنهاد استراتژی، کمک در تولید محتوا */
export async function adminCopilotChat(
  history: { role: string; content: string }[],
  userMessage: string,
  context: { totalUsers: number; totalRevenue: number; activeSubs: number; pendingPrograms: number }
): Promise<string> {
  const systemPrompt = withSystemDirectives(`تو «دستیار مدیر» فیتاپ هستی — مشاور ارشد هوش مصنوعی برای مدیران پلتفرم فیتاپ. تو به تمام ساختار سایت، همه قسمت‌ها، همه امکانات، همه پلن‌ها، همه APIها و تمام جزئیات فنی و ظاهری سایت اشراف کامل داری.

## درباره فیتاپ
فیتاپ (FitUp) پلتفرم هوشمند برنامه‌ریزی تمرین و تغذیه است که با هوش مصنوعی اختصاصی، برنامه ورزشی، غذایی و مکمل کاملاً شخصی‌سازی‌شده برای هر کاربر می‌سازد. شعار فیتاپ: «هر بدنی فیتاپ میخواد». دامنه: fittup.ir

## ساختار سایت و URLها
### صفحات عمومی:
- صفحه اصلی: /
- مقالات: /?screen=articles
- تماس با ما: /?screen=contact
- قوانین: /?screen=terms
- ورود/ثبت‌نام: /?screen=auth
- پنل ورزشکار: /?screen=panel

### ابزارهای رایگان:
- ماشین حساب TDEE: /?tool=tdee
- بانک حرکات (+۲۶۰ حرکت): /?tool=exercises
- بانک کالری غذاها (+۱۰۰۰ غذا): /?tool=foods

### صفحات پویا:
- مقاله اختصاصی: /?article=slug
- حرکت اختصاصی: /?exercise=id
- غذا اختصاصی: /?food=id

## پنل مدیریت (۱۸ بخش)
۱. داشبورد — آمار کلی، KPIها
۲. کاربران — مدیریت، مشاهده جزئیات، لغو اشتراک
۳. مالی و تراکنش‌ها — پرداخت‌ها، استرداد
۴. حسابداری مدیریت — تحلیل درآمد، مقایسه بازه‌ها
۵. کدهای تخفیف — ساخت/ویرایش
۶. صف برنامه‌ها — برنامه‌های در انتظار/تولید
۷. چکاپ‌ها — بررسی چکاپ‌های دوره‌ای
۸. مقالات — CRUD، انتشار، زمان‌بندی
۹. کدهای تحلیلی — تزریق کد head/body
۱۰. قوانین — ویرایش شرایط و قوانین
۱۱. تیکت‌ها — پشتیبانی کاربران
۱۲. نظرسنجی‌ها — تحلیل نظرات
۱۳. دستیار هوشمند (تو) — کمک به مدیر
۱۴. مدیریت ادمین‌ها — ساخت/ویرایش ادمین
۱۵. دامنه و رکوردها — تنظیمات DNS
۱۶. سئو هوشمند — تولید خودکار مقاله
۱۷. لاگ خطاها — بررسی خطاها
۱۸. تنظیمات سایت — پیکربندی

## پلن‌ها و قابلیت‌ها
| پلن | قیمت | مدت | قابلیت‌ها |
|-----|------|-----|----------|
| اقتصادی (basic) | ۳۵۰٬۰۰۰ ت | ۴۵ روز | برنامه تمرین+تغذیه+مکمل، ردیابی وزن، تاریخچه |
| استاندارد (standard) | ۸۰۰٬۰۰۰ ت | ۴۵ روز | + ۳ چکاپ دوره‌ای، داشبورد پیشرفته، مموری |
| پیشرفته (advanced) | ۱٬۲۰۰٬۰۰۰ ت | ۴۵ روز | + چت هوشمند (متن+عکس)، آنالیز عکس غذا/بدن، حالت باشگاه، دستیار تغذیه |
| حرفه‌ای (ultimate) | ۱٬۸۰۰٬۰۰۰ ت | ۴۵ روز | + آنالیز ویدیویی (۱۰x)، آزمایش خون (۱x)، اصلاح تکنیک، چت ویدیویی |

مهم: کیفیت برنامه/مکمل/تغذیه در همه پلن‌ها یکسان است. تفاوت فقط در قابلیت‌هاست.

## مدل‌های هوش مصنوعی (v73+)
- متن: deepseek-v4.1-flash (همهٔ وظایف متنی؛ تفکر low — فال‌بک gemini-3.8-flash)
- تولید برنامه: همان deepseek-v4.1-flash با تفکر max (بودجهٔ خروجی 65536) — فال‌بک gemini-3.8-flash تفکر high
- ویژن: deepseek-v4.1-flash بینایی بومی (مسیر /v1/messages — تحلیل عکس/فریم ویدیو؛ فال‌بک gemini-3.8-flash)
- تصویر: gemini-3.1-flash-lite-image (تولید کاور مقالات)
- محرمانگی: نام مدل‌ها/سرویس‌ها/هزینه‌ها هرگز در پاسخ‌های کاربر-محور ذکر نمی‌شود (فیتاپ هوشمند)

## APIهای مهم
- /api/admin/stats — آمار داشبورد
- /api/admin/users — لیست کاربران
- /api/admin/transactions — تراکنش‌ها
- /api/admin/programs — صف برنامه‌ها
- /api/admin/checkup — چکاپ‌ها
- /api/admin/seo-agent — سئو هوشمند
- /api/coach/plan — تولید/بازتولید برنامه
- /api/coach/program-history — تاریخچه برنامه‌ها
- /api/articles — CRUD مقالات
- /api/indexnow — ایندکس سریع گوگل
- /api/cron/publish-scheduled — انتشار زمان‌بندی‌شده
- /api/cron/behavioral — نوتیف‌های هوشمند

## توانایی‌های تو
۱) تحلیل آمار: تحلیل رشد کاربران، درآمد، نرخ تبدیل، churn rate
۲) استراتژی محتوا: پیشنهاد مقالات سئو، کلمات کلیدی، تقویم محتوا
۳) بهینه‌سازی سئو: تحلیل عنوان، متا دیسکریپشن، ساختار محتوا
۴) مدیریت کاربران: تحلیل رفتار، شناسایی کاربران در معرض ریزش
۵) مالی: تحلیل درآمد، پیش‌بینی، شناسایی الگوهای پرداخت
۶) فنی: کمک در دیباگ، پیشنهاد بهبود عملکرد، تحلیل لاگ‌ها
۷) راهنمایی: اگر مدیر می‌پرسد «چگونه کاربری را لغو کنم؟»، دقیق بگو: به پنل مدیریت برو، تب «کاربران»، کاربر را پیدا کن، روی «مدیریت اشتراک» کلیک کن، «حذف پلن فعلی» را انتخاب کن.

## اطلاعات فعلی سایت
- تعداد کاربران: ${context.totalUsers}
- اشتراک‌های فعال: ${context.activeSubs}
- برنامه‌های در انتظار: ${context.pendingPrograms}
- درآمد کل: ${context.totalRevenue.toLocaleString("fa-IR")} تومان

## قوانین پاسخ‌دهی
- به زبان فارسی روان و حرفه‌ای پاسخ بده
- از مارک‌داون (##، **، -، جدول) برای خوانایی بهتر استفاده کن
- پاسخ‌هایت را ساختاریافته و actionable ارائه بده
- اگر داده‌ای نیاز داری، صادقانه بگو
- اگر سوالی درباره بخشی از سایت پرسیده شد، دقیق و با جزئیات پاسخ بده و اگر لازم است لینک یا مسیر دسترسی بده
- هرگز نگو «نمی‌دونم فیتاپ چیه» — تو به کل سایت اشراف داری`);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user", content: m.content })),
    { role: "user", content: userMessage },
  ];

  // timeout ۱۸۰ ثانیه به‌عنوان سقف سخت (backstop) + timeout ۶۰ ثانیه‌ای SDK در options.
  // ⚠️ C2b: signal و timeout باید در آرگومان دوم create (options) پاس داده شوند؛
  // اگر داخل body (آرگومان اول) بروند، سریالایز می‌شوند ("signal":{}) و abort هرگز اجرا نمی‌شود.
  // v41: سپر سراسری — retry خطای گذرا + تشخیص پاسخ خالی + timeout ۶۰ ثانیه‌ای هر تلاش
  try {
    return await createResilientCompletion(
      // v69 — دیریکتیو مالک: وظایف متنی → deepseek-v4-flash (فال‌بک: gemini-3.8)
      { model: TEXT_TASK_MODEL, fallback_model: TEXT_MODEL, messages },
      { logTag: "adminCopilotChat", reasoningEffort: "low", maxTokens: 8192, timeoutMs: 60_000, maxAttempts: 2 }
    );
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (/timed out|timeout|Request was aborted/i.test(errMsg)) {
      throw new Error("پاسخ دستیار بیش از حد انتظار طول کشید. لطفاً دوباره تلاش کنید.");
    }
    console.error("[adminCopilotChat] AvalAI error:", err);
    throw new Error("خطا در ارتباط با دستیار هوشمند مدیریت. لطفاً کمی بعد دوباره تلاش کنید.");
  }
}

// Swap a food with an AI-suggested equivalent
// v74: پارامتر اختیاری پنجم (backward-compatible) — یادداشت‌های تغذیه‌ای خود
// کاربر (OnboardingProfile.nutritionNotes) که call-site سرور از پروفایل
// می‌خواند و باید در پیشنهاد جایگزین غذا دقیق رعایت شود.
export async function swapFood(
  foodName: string,
  calories: number,
  dietType: string,
  allergies: string,
  nutritionNotes?: string
): Promise<{ name: string; calories: number; protein: number; carbs: number; fat: number; servingSize: string; reason: string }> {
  const userPrompt = `یک غذای جایگزین هم‌کالری برای "${foodName}" (حدود ${calories} کالری) پیشنهاد بده.
نوع رژیم: ${dietType}
حساسیت غذایی: ${allergies || "ندارد"}${nutritionNotes ? `
یادداشت‌های تغذیه‌ای خود کاربر (بسیار مهم — پیشنهاد باید دقیقاً با این قیدها سازگار باشد):
«${nutritionNotes}»` : ""}

فقط JSON:
{"name":"نام غذا","calories":250,"protein":15,"carbs":30,"fat":8,"servingSize":"۱ وعده","reason":"دلیل پیشنهاد"}`;

  let content: string;
  try {
    content = await createChatCompletionWithRetry({
      // v69 — دیریکتیو مالک: وظایف متنی → deepseek-v4-flash (فال‌بک: gemini-3.8)
      model: TEXT_TASK_MODEL,
      fallback_model: TEXT_MODEL,
      // v72 حسابداری — سقف خروجی جایگزین غذا
      max_tokens: 2048,
      messages: [
        { role: "system", content: withSystemDirectives("تو متخصص تغذیه هستی. فقط JSON معتبر برگردان.") },
        { role: "user", content: userPrompt },
      ],
      reasoning_effort: "low",
    } as any, "swapFood");
  } catch (err) {
    console.error("[swapFood] AvalAI error:", err);
    throw new Error("خطا در دریافت پیشنهاد جایگزین غذا. لطفاً دوباره تلاش کنید.");
  }

  // ─── M1: اعتبارسنجی/نرمال‌سازی پاسخ — fallback درون parseJsonFromContent شکل
  // {days, meals, notes} دارد که با قرارداد swap-food نمی‌خواند؛ بدون این نرمال‌سازی
  // UI «undefined» و NaN نشان می‌داد. اعداد coerce می‌شوند و بدون نام غذا خطا می‌دهیم.
  const parsed = parseJsonFromContent(content);
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!name) {
    console.error("[swapFood] AI returned invalid/empty food. Content head:", content.slice(0, 300));
    throw new Error("پاسخ نامعتبر از هوش مصنوعی (جایگزین غذا). لطفاً دوباره تلاش کنید.");
  }
  return {
    name,
    calories: Math.max(0, toSafeNumber(parsed.calories)),
    protein: Math.max(0, toSafeNumber(parsed.protein)),
    carbs: Math.max(0, toSafeNumber(parsed.carbs)),
    fat: Math.max(0, toSafeNumber(parsed.fat)),
    servingSize:
      typeof parsed.servingSize === "string" && parsed.servingSize.trim()
        ? parsed.servingSize.trim()
        : "۱ وعده",
    reason:
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "جایگزین هم‌ارزش از نظر کالری و درشت‌مغذی‌ها.",
  };
}

// ============== Vision functions (deepseek-v4.1-flash — v73; فال‌بک gemini-3.8-flash) ==============

/**
 * آنالیز عکس غذا — تخمین کالری و درشت‌مغذی‌ها
 * از VISION_MODEL (deepseek-v4.1-flash — v73) استفاده می‌کند؛ فال‌بک gemini-3.8-flash.
 */
export async function analyzeMealPhoto(
  base64Image: string,
  mimeType: string,
  userContext: string
): Promise<{ calories: number; protein: number; carbs: number; fat: number; description: string }> {
  const systemPrompt = withBrandDirective("تو متخصص تغذیه هستی. عکس غذا را تحلیل کن و کالری و درشت‌مغذی‌ها را تخمین بزن. فقط JSON معتبر برگردان و هیچ متن اضافه‌ای ننویس.");

  const userText = `این عکس غذا را تحلیل کن. ${userContext ? userContext + "\n\n" : ""}فقط با ساختار JSON زیر پاسخ بده:
{"calories": 350, "protein": 25, "carbs": 40, "fat": 12, "description": "توضیح کوتاه فارسی درباره غذا و ارزش غذایی آن"}`;

  let content: string;
  try {
    content = await createChatCompletionWithRetry({
      model: VISION_MODEL,
      // v72 حسابداری — سقف خروجی (JSON کوچک؛ بدون سقف، reasoning می‌تواند هزینه را ببلعد)
      max_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    } as any, "analyzeMealPhoto");
  } catch (err) {
    console.error("[analyzeMealPhoto] AvalAI error:", err);
    throw new Error("خطا در آنالیز عکس غذا. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
    description: parsed.description || "توضیحی دریافت نشد.",
  };
}

/**
 * آنالیز عکس بدن — ارزیابی فرم بدن و توصیه‌ها
 * از VISION_MODEL (deepseek-v4.1-flash — v73) استفاده می‌کند؛ فال‌بک gemini-3.8-flash.
 */
export async function analyzeBodyPhoto(
  base64Image: string,
  mimeType: string,
  userContext: string
): Promise<{ bodyScore: number; analysis: string; recommendations: string[] }> {
  const systemPrompt = withBrandDirective("تو متخصص فیزیولوژی ورزشی و آنالیز فرم بدن هستی. عکس بدن ورزشکار را تحلیل کن و امتیاز فرم بدن، تحلیل و توصیه‌های تمرینی بده. فقط JSON معتبر برگردان.");

  const userText = `این عکس بدن ورزشکار را تحلیل کن. ${userContext ? userContext + "\n\n" : ""}فقط با ساختار JSON زیر پاسخ بده:
{"bodyScore": 75, "analysis": "تحلیل فارسی درباره فرم بدن، تقارن، عضلات و نقاط ضعف/قوت", "recommendations": ["توصیه ۱", "توصیه ۲", "توصیه ۳"]}
امتیاز bodyScore بین ۰ تا ۱۰۰ باشد.`;

  let content: string;
  try {
    content = await createChatCompletionWithRetry({
      model: VISION_MODEL,
      // v72 حسابداری — سقف خروجی (JSON کوچک)
      max_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    } as any, "analyzeBodyPhoto");
  } catch (err) {
    console.error("[analyzeBodyPhoto] AvalAI error:", err);
    throw new Error("خطا در آنالیز عکس بدن. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    bodyScore: Number(parsed.bodyScore) || 0,
    analysis: parsed.analysis || "تحلیلی دریافت نشد.",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
  };
}

/**
 * آنالیز ویدیویی بدن — ارزیابی فرم و وضعیت بدن، تقارن و فرم حرکات
 *
 * نکته مهم: اگر مدل ویژن فعلی در AvalAI از ویدیو پشتیبانی نکند،
 * فقط از عکس. به‌جای ارسال ویدیو به VLM:
 *   ۱) با ffmpeg یک فریم از وسط ویدیو استخراج می‌کنیم
 *   ۲) فریم را به‌عنوان عکس به VLM می‌دهیم
 *   ۳) پاسخ JSON را برمی‌گردانیم
 *
 * اگر ffmpeg نصب نباشد، پیام واضح فارسی برمی‌گرداند.
 */

/** بررسی موجود بودن ffmpeg با اجرای `ffmpeg -version`. */
async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * استخراج چند فریم از ویدیو (به‌طور مساوی روی تایم‌لاین) برای تحلیل بهتر حرکت.
 * چند فریم پشت‌سرهم به مدل چندوجهی اجازه می‌دهد «توالی حرکت» را ببیند — نه فقط
 * یک لحظه ثابت — و پاسخ «نمی‌توانم تحلیل کنم» عملاً حذف می‌شود.
 * اگر ffmpeg نباشد یا ویدیو فریم قابل استخراج نداشته باشد، آرایه خالی برمی‌گرداند (نه throw).
 * فریم‌ها به حداکثر ۱۰۲۴px و JPEG با کیفیت مناسب کوچک می‌شوند تا payload سبک بماند.
 */
async function extractFramesFromVideoFile(
  videoPath: string,
  maxFrames: number
): Promise<string[]> {
  const frames: string[] = [];
  try {
    if (!(await isFfmpegAvailable())) return [];

    // طول ویدیو برای چینش مساوی فریم‌ها روی تایم‌لاین
    let duration = 0;
    try {
      const { stdout } = await execFileAsync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
        { timeout: 15000 }
      );
      const dur = parseFloat(stdout.trim());
      if (Number.isFinite(dur)) duration = dur;
    } catch {
      // ffprobe نیست — با نقطه پیش‌فرض ادامه
    }

    // زمان‌های استخراج: پخش مساوی روی تایم‌لاین (لبه‌ها حذف می‌شوند — معمولاً لبه اول/آخر
    // سیاه یا ناقص است). مثال ویدیوی ۱۲ ثانیه‌ای با ۴ فریم: ۲.۴s، ۴.۸s، ۷.۲s، ۹.۶s
    let times: number[];
    if (duration > 0.6) {
      const n = Math.max(1, Math.min(maxFrames, Math.max(1, Math.floor(duration))));
      const step = duration / (n + 1);
      times = Array.from({ length: n }, (_, i) =>
        Math.min(duration - 0.1, Math.max(0.2, step * (i + 1)))
      );
    } else {
      // ویدیوی خیلی کوتاه یا طول نامشخص — چند نقطه ابتدایی نزدیک به هم
      times = [0.2, 0.5, 0.8].slice(0, maxFrames);
    }

    for (const t of times) {
      const framePath = path.join(
        tmpdir(),
        `fitup-frames-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      );
      try {
        await execFileAsync(
          "ffmpeg",
          ["-y", "-ss", String(t), "-i", videoPath, "-frames:v", "1", "-q:v", "4", "-vf", "scale=1024:-2", framePath],
          { timeout: 60000 }
        );
        const frameBuf = await readFile(framePath);
        if (frameBuf && frameBuf.length > 0) {
          frames.push(`data:image/jpeg;base64,${frameBuf.toString("base64")}`);
        }
      } catch {
        // این فریم ناموفق بود — بقیه را ادامه بده
      } finally {
        try { await unlink(framePath); } catch {}
      }
    }
    return frames;
  } catch (err) {
    console.error("[extractVideoFramesAsDataUrls] error:", err);
    return frames;
  }
}

/**
 * ─── استخراج فریم با fallback ریموکس (تضمین خوانده‌شدن ویدیو) ───
 *
 * چرا: بعضی ویدیوها (مثل MOV ضبط‌شده آیفون با کدک HEVC، یا فایل‌هایی با
 * index خراب از مرورگر/اپلودر) با استخراج مستقیم ffmpeg هیچ فریمی نمی‌دهند
 * (کدک داخل است ولی muxer/seek روی فایل خام گیر می‌کند). ریموکسِ
 * `ffmpeg -i in -c copy -movflags +faststart out.mp4` بدون بازکدگذاری،
 * ظرف را استاندارد می‌کند و seek فریم را ممکن می‌سازد.
 *
 * جریان: استخراج مستقیم → اگر ۰ فریم → ریموکس → استخراج مجدد از فایل ریموکس.
 * (درخواست مالک: «حتما ویدیو چه در چت چه در آنالیز ویدیویی خوانده و تحلیل بشه»)
 */
export async function extractVideoFramesAsDataUrls(
  videoPath: string,
  maxFrames = 6
): Promise<string[]> {
  // ۱) استخراج مستقیم
  let frames = await extractFramesFromVideoFile(videoPath, maxFrames);
  if (frames.length > 0) return frames;

  // ۲) ریموکس و تلاش مجدد — فقط اگر ffmpeg در دسترس است
  try {
    if (!(await isFfmpegAvailable())) return frames;
    const remuxPath = path.join(
      tmpdir(),
      `fitup-remux-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
    );
    try {
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", videoPath, "-c", "copy", "-movflags", "+faststart", remuxPath],
        { timeout: 90_000 }
      );
      const stat = await readFile(remuxPath).catch(() => null);
      if (stat && stat.length > 1024) {
        // فایل ریموکس‌شده معقول است — استخراج مجدد
        const remuxFrames = await extractFramesFromVideoFile(remuxPath, maxFrames);
        if (remuxFrames.length > 0) {
          console.log(
            `[extractVideoFramesAsDataUrls] ✅ fallback ریموکس جواب داد (${remuxFrames.length} فریم) — ویدیو خوانده شد`
          );
          return remuxFrames;
        }
      }
    } finally {
      try { await unlink(remuxPath); } catch {}
    }
  } catch (err) {
    console.error("[extractVideoFramesAsDataUrls] remux fallback failed:", err);
  }
  return frames;
}

/**
 * استخراج فریم میانی ویدیو به‌صورت data URL (برای پیوست مستقیم به چت چندوجهی).
 * اگر ffmpeg نباشد یا ویدیو فریم قابل استخراج نداشته باشد، null برمی‌گرداند (نه throw).
 * فریم به حداکثر ۱۲۸۰px و JPEG با کیفیت مناسب کوچک می‌شود تا payload سبک بماند.
 */
export async function extractVideoFrameAsDataUrl(videoPath: string): Promise<string | null> {
  let framePath: string | null = null;
  try {
    if (!(await isFfmpegAvailable())) return null;

    // طول ویدیو برای انتخاب فریم میانی
    let seekTime = "1";
    try {
      const { stdout } = await execFileAsync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
        { timeout: 15000 }
      );
      const dur = parseFloat(stdout.trim());
      if (Number.isFinite(dur) && dur > 0) {
        seekTime = String(Math.max(0.5, dur / 2));
      }
    } catch {
      // ffprobe نیست — با seekTime پیش‌فرض ادامه
    }

    framePath = path.join(tmpdir(), `fitup-chat-attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-ss", seekTime, "-i", videoPath, "-frames:v", "1", "-q:v", "3", "-vf", "scale=1280:-2", framePath],
      { timeout: 60000 }
    );

    const frameBuf = await readFile(framePath);
    if (!frameBuf || frameBuf.length === 0) return null;
    return `data:image/jpeg;base64,${frameBuf.toString("base64")}`;
  } catch (err) {
    console.error("[extractVideoFrameAsDataUrl] error:", err);
    return null;
  } finally {
    if (framePath) {
      try { await unlink(framePath); } catch {}
    }
  }
}

/**
 * استخراج یک فریم از وسط ویدیو با ffmpeg.
 * مسیر فایل JPEG خروجی را برمی‌گرداند.
 * اگر ffmpeg نصب نباشد یا خطا بدهد، throw می‌کند.
 *
 * نکته: ابتدا طول ویدیو را با ffprobe (همراه ffmpeg) می‌گیریم، سپس فریم
 * ۵۰٪ زمان ویدیو را استخراج می‌کنیم. اگر ffprobe نبود، فریم ۱ ثانیه را
 * امتحان می‌کنیم.
 */
async function extractVideoFrame(videoPath: string): Promise<string> {
  const hasFfmpeg = await isFfmpegAvailable();
  if (!hasFfmpeg) {
    throw new Error(
      "تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود. لطفاً از عکس بدن استفاده کنید."
    );
  }

  // مسیر موقت برای فریم خروجی
  const outPath = path.join(tmpdir(), `fitup-frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);

  // تلاش برای گرفتن طول ویدیو با ffprobe
  let seekTime = "1"; // پیش‌فرض: ۱ ثانیه
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath],
      { timeout: 15000 }
    );
    const dur = parseFloat(stdout.trim());
    if (Number.isFinite(dur) && dur > 0) {
      // ۵۰٪ طول ویدیو — وسط آن. حداقل ۰.۵ ثانیه برای ویدیوهای خیلی کوتاه.
      seekTime = String(Math.max(0.5, dur / 2));
    }
  } catch {
    // ffprobe نیست یا خطا داد — با seekTime پیش‌فرض ادامه می‌دهیم
  }

  // استخراج فریم با ffmpeg
  // -ss قبل از -i برای seek سریع
  // -frames:v 1: فقط یک فریم
  // -q:v 2: کیفیت خوب JPEG
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss", seekTime,
        "-i", videoPath,
        "-frames:v", "1",
        "-q:v", "2",
        "-vf", "scale=1280:-2", // حداکثر عرض ۱۲۸۰ پیکسل (نسبت تصویر حفظ می‌شود)
        outPath,
      ],
      { timeout: 60000 }
    );
  } catch (err) {
    // پاک کردن احتمالی فایل ناقص
    try { await unlink(outPath); } catch {}
    throw new Error(
      `استخراج فریم از ویدیو ناموفق بود. ${err instanceof Error ? err.message.slice(0, 200) : ""}`.trim()
    );
  }

  // مطمئن شو فایل واقعاً ساخته شده
  try {
    const buf = await readFile(outPath);
    if (!buf || buf.length === 0) {
      throw new Error("فریم استخراج‌شده خالی است.");
    }
  } catch (err) {
    try { await unlink(outPath); } catch {}
    throw new Error(
      `استخراج فریم از ویدیو ناموفق بود. ${err instanceof Error ? err.message.slice(0, 200) : ""}`.trim()
    );
  }

  return outPath;
}

/**
 * تحلیل ویدیو از روی مسیر فایل روی دیسک.
 * ۱) چند فریم کلیدی از ویدیو را با ffmpeg استخراج می‌کند (به‌طور مساوی روی تایم‌لاین)
 * ۲) فریم‌ها را به VLM می‌دهد (VLM از عکس پشتیبانی می‌کند، نه ویدیو — چند فریم
 *    پشت‌سرهم توالی حرکت را نشان می‌دهند و کیفیت تحلیل را به‌شدت بالا می‌برند)
 * ۳) پاسخ JSON را برمی‌گرداند
 *
 * اگر ffmpeg نباشد، پیام واضح می‌دهد: «تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود...»
 */
export async function analyzeVideoFromPath(
  videoPath: string,
  userContext: string
): Promise<{ posture: string; symmetry: number; issues: string[]; recommendations: string[]; score: number }> {
  // ۱) استخراج چند فریم با ffmpeg
  let frameDataUrls: string[];
  try {
    frameDataUrls = await extractVideoFramesAsDataUrls(videoPath, 6);
  } catch (err) {
    console.error("[analyzeVideoFromPath] frame extraction failed:", err);
    throw err;
  }
  if (frameDataUrls.length === 0) {
    throw new Error(
      "استخراج فریم از ویدیو ناموفق بود. لطفاً از فرمت MP4 یا WebM با حداقل ۲ ثانیه طول استفاده کنید یا از عکس بدن استفاده کنید."
    );
  }

  // ۲) ارسال فریم‌ها به VLM
  let content: string;
  try {
    const systemPrompt = withBrandDirective("تو متخصص بیومکانیک ورزشی و آنالیز ویدیویی حرکات هستی. چند فریم کلیدی از ویدیوی ورزشکار — به ترتیب زمانی از شروع تا پایان حرکت — به پیوست رسیده است. این توالی فریم‌ها را مثل یک حرکت پیوسته تحلیل کن: فرم و وضعیت بدن، تقارن، دامنه حرکت، مشکلات فرم و توصیه‌های اصلاحی دقیق بده. فقط با واژگان فارسی رایج صحبت کن (به‌جای اصطلاحات بیگانه مثل «پوسچر» بگو «فرم بدن»). فقط JSON معتبر برگردان.");

    const userText = `این ${frameDataUrls.length} فریم به ترتیب زمانی از ویدیوی ورزشکار است. ${userContext ? userContext + "\n\n" : ""}حرکت را به‌عنوان یک توالی پیوسته تحلیل کن (نه عکس‌های مستقل). فقط با ساختار JSON زیر پاسخ بده:
{"posture": "توصیف فارسیِ فرم و وضعیت بدن و اجرای حرکت", "symmetry": 85, "issues": ["مشکل ۱", "مشکل ۲"], "recommendations": ["توصیه اصلاحی ۱", "توصیه اصلاحی ۲"], "score": 78}
symmetry و score بین ۰ تا ۱۰۰ باشند.`;

    content = await createChatCompletionWithRetry({
      model: VISION_MODEL,
      // v73 — سقف 8192: تفکر مدل جدید بودجه را می‌خورد (درس v39) و تحلیل ۶ فریم بیومکانیک + JSON فضای بیشتری می‌خواهد (سقف است نه هزینه).
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...frameDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
    } as any, "analyzeVideoFromPath");
  } catch (err) {
    console.error("[analyzeVideoFromPath] VLM error:", err);
    const errMsg = err instanceof Error ? err.message.toLowerCase() : "";
    if (
      errMsg.includes("video") ||
      errMsg.includes("media") ||
      errMsg.includes("unsupported") ||
      errMsg.includes("mime") ||
      errMsg.includes("invalid image") ||
      errMsg.includes("format")
    ) {
      throw new Error(
        "تحلیل ویدیو در حال حاضر پشتیبانی نمی‌شود. لطفاً از عکس بدن استفاده کنید."
      );
    }
    throw new Error("خطا در آنالیز ویدیوی بدن. لطفاً دوباره تلاش کنید.");
  }

  // ۳) اعتبارسنجی پاسخ
  if (!content || content.trim() === "") {
    throw new Error("پاسخی از هوش مصنوعی دریافت نشد. لطفاً دوباره تلاش کنید.");
  }
  const looksLikeHtml = /^\s*<(?:html|!doctype|head|body|h1|div|p)\b/i.test(content) ||
    (content.startsWith("<") && content.includes("</") && !content.includes("{"));
  if (looksLikeHtml) {
    console.error("[analyzeVideoFromPath] AI returned HTML:", content.slice(0, 200));
    throw new Error("خطای سرور در پاسخ هوش مصنوعی. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  if (parsed?.notes && typeof parsed.notes === "string" && parsed.notes.includes("خطا") && !parsed.posture) {
    throw new Error(parsed.notes);
  }
  return {
    posture: parsed.posture || "توصیفی دریافت نشد.",
    symmetry: Number(parsed.symmetry) || 0,
    issues: Array.isArray(parsed.issues) ? parsed.issues.map((i: any) => String(i)) : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    score: Number(parsed.score) || 0,
  };
}

/**
 * تحلیل آزمایش خون — استخراج نشانگرها، کمبودها و توصیه‌ها
 * از VISION_MODEL (deepseek-v4.1-flash — v73) استفاده می‌کند؛ فال‌بک gemini-3.8-flash.
 *
 * پنل آزمایش شامل ۱۰ دسته کامل: CBC، چربی، کبد، کلیه، تیروئید،
 * هورمون‌ها (تستوسترون/کورتیزول/انسولین/HGH/...)، ویتامین‌ها و مواد معدنی،
 * قند خون و نشانگرهای التهاب.
 */
export async function analyzeBloodTest(
  base64Image: string,
  mimeType: string
): Promise<{
  overall: string;
  score: number;
  markers: Array<{
    key?: string;
    category?: string;
    categoryName?: string;
    name: string;
    value: string;
    unit?: string;
    status: "normal" | "low" | "high" | "borderline" | "unknown";
    reference?: string;
    explanation?: string;
  }>;
  deficiencies: string[];
  recommendations: string[];
  supplements: string[];
  warnings: string[];
}> {
  const systemPrompt = withBrandDirective(
    "تو متخصص پزشکی، تغذیه ورزشی و تحلیل آزمایش خون هستی. عکس آزمایش خون را با دقت بررسی کن، مقادیر هر نشانگر را استخراج کن، با محدوده نرمال مقایسه کن و برای ورزشکاران و بدنسازان تحلیل کن. فقط JSON معتبر برگردان."
  );

  const userText = `این عکس آزمایش خون را به دقت بررسی کن. مقادیر هر تست را از روی برگه آزمایش استخراج کن و تحلیل کن.

پنل کامل آزمایش‌های مورد انتظار (۱۰ دسته):
${bloodTestPromptSummary()}

برای هر نشانگری که در عکس وجود دارد، یک آبجکت به markers اضافه کن. اگر تستی در عکس نبود، آن را درج نکن.

فقط با ساختار JSON زیر پاسخ بده:
{
  "overall": "ارزیابی کلی فارسی از وضعیت سلامت ورزشکار (۲-۳ جمله)",
  "score": 75,
  "markers": [
    {
      "key": "hemoglobin",
      "category": "cbc",
      "categoryName": "آزمایش خون کامل (CBC)",
      "name": "هموگلوبین",
      "value": "۱۴.۲",
      "unit": "g/dL",
      "status": "normal",
      "reference": "۱۳-۱۷",
      "explanation": "توضیح فارسی کوتاه درباره وضعیت و معنای آن برای ورزشکار"
    }
  ],
  "deficiencies": ["کمبود ویتامین D", "کمبود آهن"],
  "recommendations": [
    "توصیه غذایی ۱ (مثلاً مصرف بیشتر گوشت قرمز)",
    "توصیه غذایی ۲"
  ],
  "supplements": [
    "مکمل توصیه‌شده ۱ (مثلاً ویتامین D3 2000 IU روزانه)",
    "مکمل توصیه‌شده ۲"
  ],
  "warnings": ["هشدار پزشکی حیاتی در صورت وجود"]
}

قوانین:
- score عددی بین ۰ تا ۱۰۰ بر اساس سلامت کلی.
- status فقط یکی از: normal | low | high | borderline | unknown
- key باید یکی از کلیدهای تعریف‌شده در پنل بالا باشد (hemoglobin, testosterone_total, vitamin_d, ...).
- category همان id دسته است (cbc, lipid, liver, kidney, thyroid, hormones, vitamins_minerals, blood_sugar, inflammation).
- explanation حتماً فارسی و کوتاه (۱-۲ جمله) باشد و به تأثیر آن روی عملکرد ورزشکار اشاره کند.
- deficiencies شامل کمبودها و مقادیر خارج محدوده باشد.
- recommendations شامل توصیه‌های غذایی و سبک زندگی باشد.
- supplements شامل مکمل‌های پیشنهادی با دوز و زمان مصرف باشد.
- warnings شامل مواردی که نیاز به مراجعه فوری به پزشک دارند.
- اگر تستی در عکس نبود، آن را در markers درج نکن.

هشدار مهم: این تحلیل جایگزین مشورت پزشک نیست و صرفاً جنبه راهنمایی دارد.`;

  let content: string;
  try {
    content = await createChatCompletionWithRetry({
      model: VISION_MODEL,
      // v72 حسابداری — سقف خروجی (JSON پنل آزمایش)
      max_tokens: 3000,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    } as any, "analyzeBloodTest");
  } catch (err) {
    console.error("[analyzeBloodTest] AvalAI error:", err);
    throw new Error("خطا در تحلیل آزمایش خون. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    overall: parsed.overall || "ارزیابی‌ای دریافت نشد.",
    score: Number(parsed.score) || 0,
    markers: Array.isArray(parsed.markers) ? parsed.markers : [],
    deficiencies: Array.isArray(parsed.deficiencies) ? parsed.deficiencies.map((d: any) => String(d)) : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    supplements: Array.isArray(parsed.supplements)
      ? parsed.supplements.map((s: any) => String(s))
      : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((w: any) => String(w)) : [],
  };
}

/**
 * تحلیل چکاپ دوره‌ای بر اساس داده‌های متنی (وزن، اندازه‌ها، بازخورد).
 * این تابع بدون نیاز به عکس، با استفاده از مدل متنی، امتیاز بدن (bodyScore 0-100)،
 * تحلیل فارسی و توصیه‌های پیشرفت تولید می‌کند.
 */

/**
 * Reference point for comparison. This can be either:
 *  - The user's previous checkup (most recent before the current one), OR
 *  - The user's onboarding baseline (height/weight/measurements from onboarding)
 *    when this is the first checkup.
 *
 * All fields are optional — we only compare what's available.
 */
export interface CheckupReferencePoint {
  /** Source label: "previous_checkup" | "onboarding_baseline" */
  source: "previous_checkup" | "onboarding_baseline";
  /** Days between the reference point and the current checkup */
  daysAgo?: number;
  weight?: number | null;
  bodyFatPercent?: number | null;
  leanBodyMass?: number | null;
  chestMeasurement?: number | null;
  armMeasurement?: number | null;
  waistMeasurement?: number | null;
  hipMeasurement?: number | null;
  thighMeasurement?: number | null;
  fatigueLevel?: number | null;
  sleepQuality?: number | null;
  dietAdherence?: number | null;
  workoutAdherence?: number | null;
}

export interface CheckupAnalysisInput {
  weight: number;
  bodyFatPercent?: number | null;
  leanBodyMass?: number | null;
  chestMeasurement?: number | null;
  armMeasurement?: number | null;
  waistMeasurement?: number | null;
  hipMeasurement?: number | null;
  thighMeasurement?: number | null;
  fatigueLevel: number; // 1-5
  sleepQuality: number; // 1-5
  dietAdherence: number; // 1-5
  workoutAdherence: number; // 1-5
  notes?: string;
  phaseNumber: number;
  userContext?: string; // اطلاعات آنبوردینگ و پلن کاربر
  /**
   * Optional reference point for comparison.
   *  - For the FIRST checkup, pass the onboarding baseline (weight, bodyFat, measurements).
   *  - For subsequent checkups, pass the most recent previous checkup.
   * The AI will use this to compute deltas (e.g. weight change) and assess progress.
   */
  referencePoint?: CheckupReferencePoint | null;
  /** User's primary goal from onboarding (e.g. "fat_loss", "muscle_gain") — used to frame progress assessment */
  goal?: string | null;
}

export async function analyzeCheckup(
  input: CheckupAnalysisInput
): Promise<{
  bodyScore: number;
  bodyFatStatus: string;
  analysis: string;
  recommendations: string[];
  nextPhaseFocus: string;
  /** v73.2 — تصمیم AI: آیا برنامه بر اساس نتیجهٔ چکاپ باید به‌روزرسانی شود؟ */
  programUpdateNeeded: boolean;
  /** v73.2 — توضیح کوتاه چه چیزی در برنامه باید تنظیم شود */
  programUpdateNotes: string;
}> {
  const systemPrompt = withBrandDirective(
    "تو مربی هوشمند و متخصص فیزیولوژی ورزشی و تغذیه فیتاپ هستی. داده‌های چکاپ دوره‌ای ورزشکار را به‌همراه نقطه مرجع (چکاپ قبلی یا داده‌های آنبوردینگ) تحلیل کن. امتیاز بدن (bodyScore 0-100)، وضعیت چربی بدن، تحلیل کلی شامل مقایسه با نقطه مرجع (تغییر وزن، تغییر اندازه‌ها، روند پیشرفت)، توصیه‌های پیشرفت و تمرکز فاز بعدی را ارائه بده. تحلیل باید دقیقاً بر اساس اختلاف بین داده‌های فعلی و نقطه مرجع باشد. فقط JSON معتبر برگردان و هیچ متن اضافه‌ای ننویس."
  );

  // ─── Build the "current measurements" section ───
  const parts: string[] = [
    `فاز تمرینی: ${input.phaseNumber}`,
    `وزن فعلی: ${input.weight} کیلوگرم`,
  ];
  if (input.bodyFatPercent != null) parts.push(`درصد چربی بدن فعلی (تخمینی): ${input.bodyFatPercent.toFixed(1)}٪`);
  if (input.leanBodyMass != null) parts.push(`جرم خالص بدن فعلی: ${input.leanBodyMass.toFixed(1)} کیلوگرم`);
  if (input.chestMeasurement != null) parts.push(`دور سینه فعلی: ${input.chestMeasurement} cm`);
  if (input.armMeasurement != null) parts.push(`دور بازو فعلی: ${input.armMeasurement} cm`);
  if (input.waistMeasurement != null) parts.push(`دور کمر فعلی: ${input.waistMeasurement} cm`);
  if (input.hipMeasurement != null) parts.push(`دور باسن فعلی: ${input.hipMeasurement} cm`);
  if (input.thighMeasurement != null) parts.push(`دور ران فعلی: ${input.thighMeasurement} cm`);
  parts.push(
    `خستگی (1-5): ${input.fatigueLevel}`,
    `کیفیت خواب (1-5): ${input.sleepQuality}`,
    `پیروی از رژیم (1-5): ${input.dietAdherence}`,
    `پیروی از تمرین (1-5): ${input.workoutAdherence}`
  );
  if (input.notes && input.notes.trim()) parts.push(`یادداشت ورزشکار: ${input.notes}`);

  // ─── Build the "reference point" section (previous checkup or onboarding baseline) ───
  // This is the KEY addition: we feed the AI a comparison point so it can compute
  // deltas (weight change, measurement change, adherence trend) and write a
  // progress-aware analysis instead of a generic one.
  let referenceSection = "";
  if (input.referencePoint) {
    const ref = input.referencePoint;
    const refLabel =
      ref.source === "previous_checkup" ? "چکاپ قبلی" : "داده‌های پایه آنبوردینگ (اولین ارزیابی)";
    const refLines: string[] = [`نقطه مرجع: ${refLabel}`];
    if (typeof ref.daysAgo === "number" && ref.daysAgo >= 0) {
      refLines.push(`بازه زمانی از نقطه مرجع تا الان: ${ref.daysAgo} روز`);
    }
    if (ref.weight != null) {
      const delta = input.weight - ref.weight;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`وزن نقطه مرجع: ${ref.weight} کیلوگرم (تغییر: ${sign}${delta.toFixed(1)} کیلوگرم)`);
    }
    if (ref.bodyFatPercent != null && input.bodyFatPercent != null) {
      const delta = input.bodyFatPercent - ref.bodyFatPercent;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`درصد چربی بدن نقطه مرجع: ${ref.bodyFatPercent.toFixed(1)}٪ (تغییر: ${sign}${delta.toFixed(1)}٪)`);
    }
    if (ref.leanBodyMass != null && input.leanBodyMass != null) {
      const delta = input.leanBodyMass - ref.leanBodyMass;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`جرم خالص بدن نقطه مرجع: ${ref.leanBodyMass.toFixed(1)} کیلوگرم (تغییر: ${sign}${delta.toFixed(1)} کیلوگرم)`);
    }
    if (ref.chestMeasurement != null && input.chestMeasurement != null) {
      const delta = input.chestMeasurement - ref.chestMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور سینه نقطه مرجع: ${ref.chestMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.armMeasurement != null && input.armMeasurement != null) {
      const delta = input.armMeasurement - ref.armMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور بازو نقطه مرجع: ${ref.armMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.waistMeasurement != null && input.waistMeasurement != null) {
      const delta = input.waistMeasurement - ref.waistMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور کمر نقطه مرجع: ${ref.waistMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.hipMeasurement != null && input.hipMeasurement != null) {
      const delta = input.hipMeasurement - ref.hipMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور باسن نقطه مرجع: ${ref.hipMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.thighMeasurement != null && input.thighMeasurement != null) {
      const delta = input.thighMeasurement - ref.thighMeasurement;
      const sign = delta > 0 ? "+" : "";
      refLines.push(`دور ران نقطه مرجع: ${ref.thighMeasurement} cm (تغییر: ${sign}${delta.toFixed(1)} cm)`);
    }
    if (ref.fatigueLevel != null) refLines.push(`خستگی در نقطه مرجع (1-5): ${ref.fatigueLevel}`);
    if (ref.sleepQuality != null) refLines.push(`کیفیت خواب در نقطه مرجع (1-5): ${ref.sleepQuality}`);
    if (ref.dietAdherence != null) refLines.push(`پیروی از رژیم در نقطه مرجع (1-5): ${ref.dietAdherence}`);
    if (ref.workoutAdherence != null) refLines.push(`پیروی از تمرین در نقطه مرجع (1-5): ${ref.workoutAdherence}`);
    referenceSection = `\n\n━━━ نقطه مرجع برای مقایسه ━━━\n${refLines.join("\n")}`;
  } else {
    referenceSection = "\n\n━━━ نقطه مرجع برای مقایسه ━━━\nنقطه مرجعی در دسترس نیست (اولین چکاپ و بدون داده آنبوردینگ). لطفاً تحلیل اولیه ارائه بده.";
  }

  // ─── Goal framing ───
  // The user's primary goal (e.g. "fat_loss", "muscle_gain") determines whether
  // weight gain/loss is "good" or "bad" progress. We tell the AI to interpret
  // the deltas in the context of the user's goal.
  let goalSection = "";
  if (input.goal) {
    const goalLabels: Record<string, string> = {
      fat_loss: "کاهش چربی (چربی‌سوزی)",
      muscle_gain: "افزایش عضله (عضله‌سازی)",
      endurance: "افزایش استقامت",
      fitness: "تناسب اندام عمومی",
      strength: "افزایش قدرت",
      cut: "کات (چربی‌سوزی با حفظ عضله)",
      bulk: "افزایش حجم",
    };
    const goalLabel = goalLabels[input.goal] || input.goal;
    goalSection = `\n\nهدف اصلی ورزشکار: ${goalLabel}\nمهم: تحلیل پیشرفت باید بر اساس این هدف باشد. مثلاً اگر هدف «کاهش چربی» است، کاهش وزن و کاهش دور کمر پیشرفت مثبت است؛ اگر هدف «عضله‌سازی» است، افزایش وزن (به‌اندازه متناسب) و افزایش دور بازو/سینه پیشرفت مثبت است.`;
  }

  if (input.userContext) parts.push(`\nاطلاعات ورزشکار:\n${input.userContext}`);

  const userText = `داده‌های چکاپ دوره‌ای ورزشکار را تحلیل کن:

━━━ داده‌های فعلی ━━━
${parts.join("\n")}${referenceSection}${goalSection}

فقط با ساختار JSON زیر پاسخ بده:
{
  "bodyScore": 75,
  "bodyFatStatus": "ارزیابی کوتاه فارسی درباره وضعیت فعلی چربی بدن",
  "analysis": "تحلیل کامل فارسی (۲-۳ پاراگراف). حتماً شامل این موارد باشد: ۱) مقایسه وزن و اندازه‌های فعلی با نقطه مرجع (با ذکر مقدار تغییر)، ۲) ارزیابی پیشرفت بر اساس هدف کاربر (آیا روند در جهت درست است؟)، ۳) چه چیزی خوب پیش رفته، ۴) چه چیزی نیاز به تنظیم دارد، ۵) وضعیت کلی بدن.",
  "recommendations": ["توصیه تمرینی ۱", "توصیه تغذیه‌ای ۲", "توصیه ریکاوری ۳"],
  "nextPhaseFocus": "تمرکز اصلی فاز بعدی (یک جمله فارسی)",
  "programUpdateNeeded": true,
  "programUpdateNotes": "اگر programUpdateNeeded=true است: در یک جمله بگو چه چیزی در برنامه باید تنظیم شود (مثلاً کاهش شدت به دلیل خستگی بالا / افزایش کالری به دلیل افت وزن بیش از حد). اگر false، رشتهٔ خالی."
}

قوانین امتیازدهی bodyScore (۰ تا ۱۰۰):
- امتیاز بر اساس پیروی از برنامه (تمرین + رژیم)، کیفیت خواب، سطح خستگی و میزان پیشرفت نسبت به نقطه مرجع باشد.
- اگر پیروی از برنامه بالا (۴-۵)، خواب خوب (۴-۵) و پیشرفت در جهت هدف باشد → امتیاز ۸۰-۱۰۰.
- اگر پیروی متوسط (۳) و خستگی زیاد (۴-۵) → امتیاز ۵۰-۷۰.
- اگر پیروی پایین (۱-۲) یا پیشرفت منفی (دور از هدف) → امتیاز زیر ۵۰.
توصیه‌ها عملی، مشخص و بر اساس داده‌های واقعی همین ورزشکار باشند (نه کلیشه‌ای).

قوانین programUpdateNeeded (تصمیم به‌روزرسانی برنامه):
- هدف: برنامهٔ فعلی ورزشکار باید فقط «در صورت نیاز» به‌روزرسانی شود (درخواست مالک: «با هر چکاپ اگر نیاز بود برنامه آپدیت شود و برنامهٔ جدید جای قبلی بنشیند»).
- true بده اگر: پیشرفت در جهت هدف متوقف/معکوس شده (وزن یا چربی یا اندازه‌ها بدون تغییر معنادار در بازهٔ مرجع)، یا خستگی/پیروی پایین نشان می‌دهد برنامه از توان ورزشکار خارج است، یا تغییرات بدن ایجاب می‌کند شدت/کالری/حجم تنظیم شود.
- false بده اگر: روند پیشرفت در جهت هدف است و پیروی/ریکاوری سالم است — برنامه فعلی را نگه دارید.
- این تصمیم فقط دربارهٔ محتوای برنامه است؛ به پلن یا زمان اشتراک کاری ندارد و نباید به آن اشاره کنی.`;

  let content: string;
  try {
    content = await createChatCompletionWithRetry({
      // v69 — دیریکتیو مالک: وظایف متنی → deepseek-v4-flash (فال‌بک: gemini-3.8)
      model: TEXT_TASK_MODEL,
      fallback_model: TEXT_MODEL,
      // v72 حسابداری — سقف خروجی تحلیل چکاپ
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    } as any, "analyzeCheckup");
  } catch (err) {
    console.error("[analyzeCheckup] AvalAI error:", err);
    throw new Error("خطا در تحلیل چکاپ. لطفاً دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    bodyScore: Math.max(0, Math.min(100, Number(parsed.bodyScore) || 0)),
    bodyFatStatus: parsed.bodyFatStatus || "ارزیابی‌ای دریافت نشد.",
    analysis: parsed.analysis || "تحلیلی دریافت نشد.",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r))
      : [],
    nextPhaseFocus: parsed.nextPhaseFocus || "ادامه مسیر با تمرکز بر پیشرفت تدریجی.",
    // v73.2 — تصمیم به‌روزرسانی برنامه با نتیجهٔ چکاپ (فقط محتوای برنامه؛ پلن/زمان اشتراک دست‌نخورده)
    programUpdateNeeded: parsed.programUpdateNeeded === true,
    programUpdateNotes:
      typeof parsed.programUpdateNotes === "string" ? parsed.programUpdateNotes.trim() : "",
  };
}

/**
 * تبدیل مقدار عددی خروجی AI به عدد امن (L8) — پشتیبانی از:
 *  - عدد خام JSON
 *  - رشته با ارقام انگلیسی («"210"»)
 *  - رشته با ارقام فارسی/عربی («"۲۱۰"» / «"٢١٠"») + جداکننده هزارگان
 * مقدار نامعتبر → 0 (تا مجموع‌های کالری/درشت‌مغذی هرگز رشته‌ای/NaN نشوند).
 */
function toSafeNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const normalized = v
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // ارقام فارسی
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ارقام عربی
      .replace(/[,،٬]/g, "") // جداکننده هزارگان
      .trim();
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Parse JSON from LLM content (handles markdown code fences + HTML error pages gracefully)
function parseJsonFromContent(content: string): any {
  if (!content || typeof content !== "string") {
    return { days: [], meals: [], notes: "پاسخ هوش مصنوعی خالی بود." };
  }

  let cleaned = content.trim();

  // Detect HTML error pages (gateway error, 502/504, AvalAI returning HTML)
  // If the content looks like HTML and contains no JSON braces, bail out gracefully.
  const looksLikeHtml = /^\s*<(?:html|!doctype|head|body|h1|div|p)\b/i.test(cleaned) ||
    (cleaned.startsWith("<") && cleaned.includes("</") && !cleaned.includes("{"));
  if (looksLikeHtml) {
    console.error("[parseJsonFromContent] AI returned HTML (likely an error page):", cleaned.slice(0, 200));
    return { days: [], meals: [], notes: "خطا در پاسخ هوش مصنوعی. لطفاً دوباره تلاش کنید." };
  }

  // Extract JSON from ```json ... ``` or ``` ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find first { and last }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[parseJsonFromContent] JSON parse failed. Raw content:", content.slice(0, 300), err);
    return { days: [], meals: [], notes: "خطا در پردازش پاسخ هوش مصنوعی." };
  }
}

/* ============================================================
   تحلیل هوشمند حسابداری مدیریت (ACCOUNTING-SYSTEM)
   دریافت خلاصه آماری یک بازه (یا مقایسه دو بازه) و تولید تحلیل
   ساختاریافته شامل: خلاصه، نقاط قوت، نقاط ضعف، راهکار افزایش
   فروش و پیش‌بینی روند.
   ============================================================ */
export interface AccountingAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  salesRecommendations: string[];
  forecast: string;
  healthScore: number; // 0-100
}

export async function analyzeAccountingData(
  payload: Record<string, any>,
  mode: "overview" | "compare" | "details"
): Promise<AccountingAnalysis> {
  const modeLabels: Record<string, string> = {
    overview: "تحلیل کلی یک بازه زمانی",
    compare: "مقایسه دو بازه زمانی",
    details: "تحلیل جزئیات پرداخت‌ها و تراکنش‌ها",
  };

  const systemPrompt = withBrandDirective(`تو یک تحلیل‌گر ارشد مالی و کسب‌وکار برای پلتفرم فیتاپ (اپلیکیشن سلامت و تناسب اندام با سیستم اشتراک ۴ سطحه: اقتصادی، استاندارد، پیشرفته، حرفه‌ای) هستی. وظیفه تو تحلیل داده‌های حسابداری مدیریت و ارائه بینش عملیاتی به مدیران است.
به زبان فارسی روان و حرفه‌ای پاسخ بده.
خروجی تو باید یک JSON معتبر دقیقاً با ساختار زیر باشد و هیچ متن اضافه‌ای بیرون JSON ننویسی:
{
  "summary": "خلاصه وضعیت در ۲-۴ جمله",
  "strengths": ["نقطه قوت ۱", "نقطه قوت ۲", ...],
  "weaknesses": ["نقطه ضعف ۱", "نقطه ضعف ۲", ...],
  "salesRecommendations": ["راهکار عملیاتی ۱", "راهکار عملیاتی ۲", ...],
  "forecast": "پیش‌بینی روند ۳۰ روز آینده در ۲-۳ جمله",
  "healthScore": 75
}
نکات:
- strengths و weaknesses بین ۲ تا ۵ مورد
- salesRecommendations بین ۳ تا ۶ مورد کاملاً عملیاتی و قابل اجرا (نه کلیشه)
- healthScore عددی بین ۰ تا ۱۰۰ که سلامت مالی کسب‌وکار را در این بازه نشان می‌دهد
- همیشه اعداد را به تومان و با قالب خوانا توصیف کن
- اگر داده کم است، صادقانه اشاره کن اما تحلیل کلی ارائه بده`);

  const userPrompt = `حالت تحلیل: ${modeLabels[mode]}

داده‌ها (JSON):
${JSON.stringify(payload, null, 2)}

لطفاً بر اساس این داده‌ها یک تحلیل کامل و ساختاریافته ارائه بده. فقط JSON.`;

  let content: string;
  try {
    content = await createResilientCompletion(
      {
        // v70 — دیریکتیو مالک: تحلیل متنی حسابداری با deepseek-v4-flash (در v69 جا مانده بود)
        model: TEXT_TASK_MODEL,
        fallback_model: TEXT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        logTag: "analyzeAccountingData",
        reasoningEffort: "low",
        maxTokens: 4096,
        timeoutMs: 120_000,
        maxAttempts: 3,
        validateContent: (t: string) => {
          const m = t.match(/\{[\s\S]*\}/);
          if (!m) return "پاسخ JSON نداشت";
          try { JSON.parse(m[0]); return null; } catch { return "JSON نامعتبر از مدل"; }
        },
      }
    );
  } catch (err) {
    console.error("[analyzeAccountingData] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس تحلیل هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  const result: AccountingAnalysis = {
    summary: typeof parsed.summary === "string" ? parsed.summary : "تحلیل در دسترس نیست.",
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    salesRecommendations: Array.isArray(parsed.salesRecommendations)
      ? parsed.salesRecommendations.filter((s: any) => typeof s === "string").slice(0, 8)
      : [],
    forecast: typeof parsed.forecast === "string" ? parsed.forecast : "پیش‌بینی در دسترس نیست.",
    healthScore:
      typeof parsed.healthScore === "number" && !isNaN(parsed.healthScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.healthScore)))
        : 50,
  };
  return result;
}

/* ============================================================
   تحلیل هوشمند جامع سئو (SEO-SMART-ANALYSIS) — درخواست مالک
   «تحلیل هوشمند» تب سئو: تصویر صفر تا صد سایت — تمام مقالات
   منتشرشده، دیتای سرچ‌کنسول (تا ۲۰۰۰ ردیف)، استراتژی‌های اجراشده،
   رتبه‌ها و مسیر فروش — در یک خروجی ساختاریافته.
   الگوی پیاده‌سازی: analyzeAccountingData (STRICT JSON + سپر سراسری)
   ============================================================ */
export interface SeoSmartAnalysisSection {
  headline: string;
  points: string[];
}

export interface SeoSmartAnalysis {
  /** امتیاز سلامت سئو — ۰ تا ۱۰۰ */
  healthScore: number;
  /** خلاصهٔ اجرایی کل وضعیت */
  summary: string;
  /** موجودی مقالات */
  articleInventory: SeoSmartAnalysisSection;
  /** عملکرد سرچ‌کنسول */
  gscPerformance: SeoSmartAnalysisSection;
  /** وضعیت استراتژی‌ها */
  strategyStatus: SeoSmartAnalysisSection;
  /** رتبه‌ها و فرصت‌ها */
  rankings: SeoSmartAnalysisSection;
  /** بردهای سریع (اقدام فوری کم‌هزینه) */
  quickWins: string[];
  /** توصیه‌های اولویت‌دار */
  recommendations: string[];
  /** ایده‌های محتوایی جدید */
  contentIdeas: string[];
  /** مسیر فروش و درآمدزایی */
  monetization: string[];
}

/** تبدیل دفاعی یک سکشن {headline, points} از پاسخ مدل */
function coerceSeoSection(v: unknown): SeoSmartAnalysisSection {
  const obj = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    headline: typeof obj.headline === "string" && obj.headline.trim() ? obj.headline : "",
    points: Array.isArray(obj.points)
      ? obj.points.filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, 8)
      : [],
  };
}

export async function analyzeSeoComprehensive(context: Record<string, any>): Promise<SeoSmartAnalysis> {
  const systemPrompt = withBrandDirective(`تو استراتژیست ارشد سئو و رشد کسب‌وکار پلتفرم فیتاپ (fittup.ir — سایت محتوایی بدنسازی، تناسب اندام و تغذیه با اپلیکیشن اشتراکی ۴ سطحه) هستی.
تمام داده‌های سایت به تو داده می‌شود: موجودی مقالات (تعداد، دسته، کیفیت فیلدهای سئو، بازدیدها)، داده‌های واقعی Google Search Console (کوئری‌ها، کلیک، نمایش، CTR، جایگاه — تا ۲۰۰۰ ردیف)، گزارش آپلودشدهٔ سرچ‌کنسول (در صورت وجود)، استراتژی فعال سئو (پیلارها، کلمات کلیدی هدف و امتیاز فرصت)، صف مقالات برنامه‌ریزی‌شده، تاریخچه اجراهای ایجنت و ساختار سایت (حرکات ورزشی، مواد غذایی، ابزارها).
وظیفه تو یک تحلیل جامعِ صفر تا صد است: همهٔ این داده‌ها را با هم تلاقی بده و تصویر کامل وضعیت فعلی + نقشهٔ راه رشد و فروش ارائه کن.
به زبان فارسی روان و حرفه‌ای پاسخ بده. هر ادعا باید مستند به همین داده‌ها باشد (عدد دقیق بیاور)، نه حدس کلی.

خروجی تو باید یک JSON معتبر دقیقاً با ساختار زیر باشد و هیچ متن اضافه‌ای بیرون JSON ننویسی:
{
  "healthScore": 75,
  "summary": "خلاصهٔ اجرایی کل وضعیت سئو در ۳-۵ جمله — تصویر بزرگ: کجا ایستاده‌ای و مهم‌ترین گلوگاه چیست",
  "articleInventory": { "headline": "یک جملهٔ قوی دربارهٔ موجودی محتوا", "points": ["نکتهٔ مستند به عدد — نقطه قوت/ضعف، کیفیت فیلدهای سئو، کندانس انتشار", ...] },
  "gscPerformance": { "headline": "یک جملهٔ قوی دربارهٔ عملکرد سرچ‌کنسول", "points": ["روند کلیک/نمایش/CTR/جایگاه با عدد", ...] },
  "strategyStatus": { "headline": "یک جمله دربارهٔ وضعیت استراتژی فعال", "points": ["پیلارها/کلمات/پوشش صف — مستند به عدد", ...] },
  "rankings": { "headline": "یک جمله دربارهٔ رتبه‌ها و فرصت‌ها", "points": ["کوئری‌های فرصت‌دار با جایگاه دقیق (۴ تا ۲۰ = فاصلهٔ ضربه‌ای تا صفحه اول)", ...] },
  "quickWins": ["اقدام فوری کم‌هزینه با اثر سریع — مستند به داده", ...],
  "recommendations": ["توصیهٔ اولویت‌دار و قابل‌اجرا به‌ترتیب اهمیت", ...],
  "contentIdeas": ["ایدهٔ مقالهٔ جدید با کلمهٔ کلیدی هدف — مستند به کوئری‌های واقعی یا شکاف محتوایی", ...],
  "monetization": ["اقدام درآمدزایی: اتصال محتوای پربازدید به پلن‌های اشتراک فیتاپ (اقتصادی/استاندارد/پیشرفته/حرفه‌ای)", ...]
}
نکات:
- healthScore عددی بین ۰ تا ۱۰۰ — سلامت کلی سئوی سایت را صادقانه نشان بده
- هر section بین ۲ تا ۵ نکته؛ quickWins بین ۳ تا ۶؛ recommendations بین ۴ تا ۷؛ contentIdeas بین ۴ تا ۷؛ monetization بین ۳ تا ۵
- کلمات نزدیک به خرید (برنامه/مربی/قیمت/اپلیکیشن) در monetization و اولویت‌ها بالاتر بیاور
- اگر داده‌ای کم یا صفر است، صادقانه بگو چه چیزی نبود و چه چیزی باید راه‌اندازی شود — اما تحلیل کامل ارائه بده`);

  const userPrompt = `داده‌های کامل سایت فیتاپ (JSON):

${JSON.stringify(context, null, 2)}

لطفاً بر اساس این داده‌ها تحلیل جامع صفر تا صد خواسته‌شده را تولید کن. فقط JSON.`;

  let content: string;
  try {
    content = await createResilientCompletion(
      {
        // v70 — دیریکتیو مالک: تحلیل متنی سئو با deepseek-v4-flash (در v69 جا مانده بود —
        // پرامپت حاوی JSON کامل مقالات + تا ۲۰۰۰ ردیف GSC است، گران‌ترین پرامپت ادمین)
        model: TEXT_TASK_MODEL,
        fallback_model: TEXT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        logTag: "analyzeSeoComprehensive",
        maxTokens: 8000,
        timeoutMs: 180_000,
        maxAttempts: 3,
        validateContent: (t: string) => {
          const m = t.match(/\{[\s\S]*\}/);
          if (!m) return "پاسخ JSON نداشت";
          try {
            JSON.parse(m[0]);
            return null;
          } catch {
            return "JSON نامعتبر از مدل";
          }
        },
      }
    );
  } catch (err) {
    console.error("[analyzeSeoComprehensive] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس تحلیل هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  const strArr = (v: unknown, cap: number): string[] =>
    Array.isArray(v) ? v.filter((s: any) => typeof s === "string" && s.trim()).slice(0, cap) : [];

  const result: SeoSmartAnalysis = {
    healthScore:
      typeof parsed.healthScore === "number" && !isNaN(parsed.healthScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.healthScore)))
        : 50,
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary : "تحلیل در دسترس نیست.",
    articleInventory: coerceSeoSection(parsed.articleInventory),
    gscPerformance: coerceSeoSection(parsed.gscPerformance),
    strategyStatus: coerceSeoSection(parsed.strategyStatus),
    rankings: coerceSeoSection(parsed.rankings),
    quickWins: strArr(parsed.quickWins, 8),
    recommendations: strArr(parsed.recommendations, 8),
    contentIdeas: strArr(parsed.contentIdeas, 8),
    monetization: strArr(parsed.monetization, 6),
  };
  return result;
}

/* ============================================================
   تحلیل هوشمند نظرسنجی‌ها (SURVEY-SYSTEM)
   دریافت خلاصه آماری نظرسنجی‌های یک بازه/پلن و تولید تحلیل
   ساختاریافته شامل: خلاصه وضعیت، نقاط قوت، نقاط ضعف، راهکار
   بهبود و میانگین رضایت کلی.
   ============================================================ */
export interface SurveyAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  overallSatisfaction: number; // 0-5
  sentiment: "very_positive" | "positive" | "neutral" | "negative" | "very_negative";
}

/**
 * تحلیل هوشمند نظرسنجی‌های پایان پلن با AI.
 *
 * @param payload داده‌های تجمیعی نظرسنجی (stats + sample comments)
 */
export async function analyzeSurveys(
  payload: Record<string, any>
): Promise<SurveyAnalysis> {
  const systemPrompt = withBrandDirective(`تو یک تحلیل‌گر ارشد تجربه کاربری و محصول برای پلتفرم فیتاپ (اپلیکیشن سلامت و تناسب اندام) هستی. وظیفه تو تحلیل نظرسنجی‌های کاربران پایان پلن و ارائه بینش عملیاتی به تیم محصول است.
به زبان فارسی روان و حرفه‌ای پاسخ بده.
خروجی تو باید یک JSON معتبر دقیقاً با ساختار زیر باشد و هیچ متن اضافه‌ای بیرون JSON ننویسی:
{
  "summary": "خلاصه وضعیت نظرات کاربران در ۲-۴ جمله",
  "strengths": ["نقطه قوت ۱", "نقطه قوت ۲", ...],
  "weaknesses": ["نقطه ضعف ۱", "نقطه ضعف ۲", ...],
  "recommendations": ["راهکار بهبود ۱", "راهکار بهبود ۲", ...],
  "overallSatisfaction": 4.2,
  "sentiment": "positive"
}
نکات:
- strengths و weaknesses بین ۲ تا ۶ مورد، بر اساس نمرات واقعی و نظرات کاربران
- recommendations بین ۳ تا ۶ راهکار کاملاً عملیاتی و قابل اجرا برای بهبود محصول
- overallSatisfaction میانگین رضایت کلی (عدد اعشاری بین ۰ تا ۵) بر اساس تمام نمرات
- sentiment یکی از مقادیر: very_positive, positive, neutral, negative, very_negative
- به نمرات پایین (۱ و ۲) و نظرات منفی به‌طور ویژه توجه کن
- اگر نظرات کاربران را می‌بینی، الگوهای تکراری را استخراج کن`);

  const userPrompt = `داده‌های نظرسنجی (JSON):
${JSON.stringify(payload, null, 2)}

لطفاً بر اساس این داده‌ها یک تحلیل کامل و ساختاریافته ارائه بده. فقط JSON.`;

  let content: string;
  try {
    content = await createResilientCompletion(
      {
        // v70 — دیریکتیو مالک: تحلیل متنی نظرسنجی با deepseek-v4-flash
        // (کامنت v69 مدعی انتقال آن بود ولی عملاً انجام نشده بود)
        model: TEXT_TASK_MODEL,
        fallback_model: TEXT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        logTag: "analyzeSurveys",
        reasoningEffort: "low",
        maxTokens: 4096,
        timeoutMs: 120_000,
        maxAttempts: 3,
        validateContent: (t: string) => {
          const m = t.match(/\{[\s\S]*\}/);
          if (!m) return "پاسخ JSON نداشت";
          try { JSON.parse(m[0]); return null; } catch { return "JSON نامعتبر از مدل"; }
        },
      }
    );
  } catch (err) {
    console.error("[analyzeSurveys] AvalAI error:", err);
    throw new Error("خطا در ارتباط با سرویس تحلیل هوشمند. لطفاً کمی بعد دوباره تلاش کنید.");
  }

  const parsed = parseJsonFromContent(content);
  const validSentiments: SurveyAnalysis["sentiment"][] = [
    "very_positive", "positive", "neutral", "negative", "very_negative",
  ];

  let sentiment: SurveyAnalysis["sentiment"] = "neutral";
  if (typeof parsed.sentiment === "string" && validSentiments.includes(parsed.sentiment as any)) {
    sentiment = parsed.sentiment as SurveyAnalysis["sentiment"];
  }

  let overall: number =
    typeof parsed.overallSatisfaction === "number" && !isNaN(parsed.overallSatisfaction)
      ? parsed.overallSatisfaction
      : 0;
  overall = Math.max(0, Math.min(5, Math.round(overall * 10) / 10));

  const result: SurveyAnalysis = {
    summary: typeof parsed.summary === "string" ? parsed.summary : "تحلیل در دسترس نیست.",
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.filter((s: any) => typeof s === "string").slice(0, 6)
      : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((s: any) => typeof s === "string").slice(0, 8)
      : [],
    overallSatisfaction: overall,
    sentiment,
  };
  return result;
}

// ═══════════════════════════════════════════════════════════════
//  تحلیل فاز صفر (Baseline) — اندازه‌های اولیه بدن (v15)
// ═══════════════════════════════════════════════════════════════
/**
 * تحلیل کوتاه (۲-۳ خط) برای فاز صفر — همان لحظه‌ای که کاربر اولین‌بار
 * اندازه‌های بدنش را وارد می‌کند (درخواست مالک: «فاز صفر هر وقت اولین بار
 * اندازه‌ها وارد شد انجام بشه و در حد دو سه خط تحلیل هوش مصنوعی بشه و در
 * فاز صفر نوشته بشه»).
 *
 * خروجی JSON سبک:
 *   { analysis: "۲-۳ خط تحلیل اولیه", recommendations: ["توصیه کوتاه ۱", ...] }
 */
export async function analyzeBaselineMeasurements(input: {
  gender: "male" | "female";
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  targetWeight?: number | null;
  goal?: string | null;
  waist?: number | null;
  neck?: number | null;
  hip?: number | null;
  chest?: number | null;
  arm?: number | null;
  thigh?: number | null;
  bodyFatPercent?: number | null;
}): Promise<{ analysis: string; recommendations: string[] }> {
  const systemPrompt = withBrandDirective(
    "تو مربی هوشمند فیتاپ هستی. اندازه‌های اولیه (فاز صفر — پیش از شروع تمرین) ورزشکار را می‌بینی. یک تحلیل اولیه «کوتاه» (دقیقاً ۲ تا ۳ خط، حداکثر ~۶۰ کلمه) به فارسی محاوره‌ای و انگیزشی بنویس که وضعیت فعلی بدن را در یک نگاه توصیف کند و جهت مسیر را مشخص کند. طولانی ننویس — این متن در یک کارت کوچک نمایش داده می‌شود. فقط JSON معتبر برگردان."
  );

  const goalLabels: Record<string, string> = {
    fat_loss: "کاهش چربی",
    muscle_gain: "افزایش عضله",
    endurance: "افزایش استقامت",
    fitness: "تناسب اندام عمومی",
    strength: "افزایش قدرت",
    cut: "کات",
    bulk: "افزایش حجم",
  };

  const lines: string[] = [];
  lines.push(`جنسیت: ${input.gender === "male" ? "مرد" : "زن"}`);
  if (input.age != null) lines.push(`سن: ${input.age}`);
  if (input.height != null) lines.push(`قد: ${input.height} cm`);
  if (input.weight != null) lines.push(`وزن: ${input.weight} kg`);
  if (input.targetWeight != null) lines.push(`وزن هدف: ${input.targetWeight} kg`);
  if (input.goal) lines.push(`هدف: ${goalLabels[input.goal] || input.goal}`);
  if (input.bodyFatPercent != null) lines.push(`درصد چربی تخمینی (US Navy): ${input.bodyFatPercent.toFixed(1)}٪`);
  if (input.waist != null) lines.push(`دور کمر: ${input.waist} cm`);
  if (input.neck != null) lines.push(`دور گردن: ${input.neck} cm`);
  if (input.hip != null) lines.push(`دور باسن: ${input.hip} cm`);
  if (input.chest != null) lines.push(`دور سینه: ${input.chest} cm`);
  if (input.arm != null) lines.push(`دور بازو: ${input.arm} cm`);
  if (input.thigh != null) lines.push(`دور ران: ${input.thigh} cm`);

  const userText = `اندازه‌های اولیه بدن ورزشکار (فاز صفر — شروع مسیر):

${lines.join("\n")}

با ساختار JSON زیر پاسخ بده:
{
  "analysis": "۲ تا ۳ خط تحلیل اولیه فارسی — وضعیت فعلی بدن + نقطه شروع مسیر + یک جمله انگیزشی کوتاه. حتماً کوتاه باشد.",
  "recommendations": ["۱ توصیه کوتاه و عملی برای شروع", "۱ توصیه تغذیه‌ای کوتاه"]
}`;

  let content: string;
  try {
    content = await createChatCompletionWithRetry({
      // v69 — دیریکتیو مالک: وظایف متنی → deepseek-v4-flash (فال‌بک: gemini-3.8)
      model: TEXT_TASK_MODEL,
      fallback_model: TEXT_MODEL,
      // v72 حسابداری — سقف خروجی تحلیل فاز صفر
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    } as any, "analyzeBaselineMeasurements");
  } catch (err) {
    console.error("[analyzeBaselineMeasurements] AvalAI error:", err);
    throw new Error("خطا در تحلیل اندازه‌های اولیه.");
  }

  const parsed = parseJsonFromContent(content);
  return {
    analysis: typeof parsed.analysis === "string" ? parsed.analysis : "",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: any) => String(r)).slice(0, 3)
      : [],
  };
}
