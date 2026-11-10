/**
 * ─── v246-seo-facts — فکت‌های رسمی سایت فیتاپ برای پرامپت‌های سئو ───
 *
 * چرا این فایل وجود دارد:
 *  نویسندهٔ مقالهٔ سئو (generateArticle در seo-agent.ts) و بازنویس محتوا
 *  (content-refresh.ts) هیچ دانشی از پلن‌ها/امکانات واقعی فیتاپ نداشتند؛
 *  حتی یک خطِ هاردکد قدیمی در پرامپت استراتژی، پلن‌ها را با قیمت معرفی می‌کرد.
 *  نتیجه: مدل جدول «مقایسه پلن‌ها» را از خودش می‌ساخت — پلن‌های جعلی (پایه/VIP)،
 *  امکانات غیرواقعی (به‌روزرسانی روزانه/هفتگی، پشتیبانی انسانی ✅) و سقف مربی
 *  هوشمندِ اشتباه. این ماژول «بلوک فکت‌های رسمی» می‌سازد که در هر سه پرامپت تزریق
 *  می‌شود تا مدل فقط و فقط از فکت‌های واقعی استفاده کند.
 *
 * منبع حقیقت:
 *  - SUBSCRIPTION_PLANS (src/lib/fitness/types.ts) — لیبل/دوره/capabilities هر پلن
 *  - SiteSetting (referral_reward_amount) — پاداش معرفی دوست (فال‌بک: ۱۵۰٬۰۰۰)
 *  - شمارش زندهٔ بانک حرکات/غذاها (ExerciseLibrary/FoodLibrary) با فال‌بک ثابت
 *
 * ⚠️ قاعدهٔ مالک: قیمت‌های عددی هرگز وارد مقاله نمی‌شوند (قیمت‌ها تغییر می‌کنند؛
 * مقاله باید به صفحهٔ پلن‌ها لینک بدهد). پس این بلوک هم قیمت عددی ندارد و صریحاً
 * مدل را از نوشتن عدد قیمتی منع می‌کند.
 */

import { db } from "@/lib/db";
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from "./types";
// Task 8-a — شمارندهٔ واحد بانک غذا (کش ۶۰ ثانیه‌ای مشترک) — دیگر اینجا کوئری جدا نمی‌زنیم
import { getFoodCount, FALLBACK_FOOD_COUNT } from "./food-count";

// v246-seo-facts — نشانهٔ نسخه برای ردیابی در پرامپت‌ها
export const SEO_SITE_FACTS_MARKER = "v246-seo-facts";

/** کش در حافظه — ۶۰ ثانیه؛ خواندن SiteSetting/شمارش بانک‌ها ارزان ولی تکراری است */
const FACTS_CACHE_TTL_MS = 60_000;
let cachedFactsBlock: string | null = null;
let cachedFactsAt = 0;

/** فال‌بک‌های ثابت — اگر DB در دسترس نبود (مثلاً زمان build) مقاله بدون فکت ساخته نشود */
const FALLBACK_REFERRAL_REWARD = 150_000; // تومان
const FALLBACK_EXERCISE_COUNT = 573;

/** تبدیل ارقام لاتین به فارسی برای متن پرامپت */
function fa(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** خواندن داده‌های زندهٔ سایت با فال‌بک امن — هیچ خطای DB حق ندارد بلوک فکت را نکشد */
async function readSiteFactsData(): Promise<{
  referralReward: number;
  exerciseCount: number;
  foodCount: number;
}> {
  const fallback = {
    referralReward: FALLBACK_REFERRAL_REWARD,
    exerciseCount: FALLBACK_EXERCISE_COUNT,
    foodCount: FALLBACK_FOOD_COUNT,
  };
  try {
    const [setting, exerciseCount, foodCount] = await Promise.all([
      db.siteSetting
        .findUnique({ where: { key: "referral_reward_amount" } })
        .catch(() => null),
      db.exerciseLibrary.count().catch(() => FALLBACK_EXERCISE_COUNT),
      // Task 8-a — منبع واحد شمارندهٔ غذا (خودش کش ۶۰ث و فال‌بک امن دارد)
      getFoodCount(),
    ]);
    const parsedReward = setting?.value ? Number(setting.value) : NaN;
    const referralReward =
      Number.isFinite(parsedReward) && parsedReward > 0
        ? Math.round(parsedReward)
        : fallback.referralReward;
    return {
      referralReward,
      exerciseCount: exerciseCount > 0 ? exerciseCount : fallback.exerciseCount,
      foodCount: foodCount > 0 ? foodCount : FALLBACK_FOOD_COUNT,
    };
  } catch {
    return fallback;
  }
}

/**
 * ساخت توضیح یک‌خطی هر پلن از روی capabilities واقعی (بدون قیمت).
 * ترتیب امکانات: از پایه به خاص — همان ترتیب منطقی صفحهٔ پلن‌ها.
 */
function planFactLine(p: SubscriptionPlan): string {
  const c = p.capabilities;
  const feats: string[] = [];
  if (c.workoutAndNutritionPlan)
    feats.push(`برنامه تمرینی + برنامه غذایی اختصاصی ${fa(p.durationDays)}روزه`);
  if (c.supplementsPlan) feats.push("برنامه مکمل‌های ورزشی اختصاصی");
  if (c.periodicCheckups)
    feats.push("۳ چکاپ دوره‌ای در روزهای ۱۵/۳۰/۴۰ + به‌روزرسانی برنامه در جای همان برنامه با هر چکاپ");
  if (c.progressAnalysis) feats.push("تحلیل پیشرفت و داشبورد پیشرفته");
  if (c.aiChatQuestions === -1) {
    const channels = c.chatVideoUpload
      ? "(متن + عکس + ویدیو)"
      : c.chatImageUpload
      ? "(متن + عکس)"
      : "";
    feats.push(`مربی هوشمند (چت فیتاپ) بی‌نهایت ${channels}`.trim());
  } else {
    feats.push("مربی هوشمند (چت فیتاپ): ندارد");
  }
  if (c.mealPhotoAnalysis) feats.push("آنالیز عکس غذا");
  if (c.bodyPhotoAnalysis) feats.push("آنالیز عکس بدن");
  if (c.nutritionCompanion) feats.push("کامپنیون تغذیه (دستیار تغذیه)");
  if (c.gymMode) feats.push("حالت باشگاه (Gym Mode)");
  if (c.fullExerciseLibrary) feats.push("کتابخانه کامل حرکات متحرک");
  if (c.videoBodyAnalysis)
    feats.push(`آنالیز ویدیویی فرم بدن — ${fa(c.videoAnalysisLimit)} بار در طول دوره`);
  if (c.techniqueCorrection) feats.push("اصلاح تکنیک حرکات با ارسال ویدیو");
  if (c.bloodTestAnalysis)
    feats.push(`آنالیز تخصصی آزمایش خون — ${fa(c.bloodTestLimit)} بار در طول دوره`);
  if (c.humanCoachOversight) feats.push("نظارت مربی انسانی");
  return `- پلن «${p.label}» (id: ${p.id}${p.badge ? ` — ${p.badge}` : ""}): ${feats.join("؛ ")}`;
}

/** قالب خوانای مبلغ پاداش به تومان (۱۵۰۰۰۰ → «۱۵۰ هزار تومان») */
function formatToman(amount: number): string {
  if (amount % 1000 === 0) return `${fa(Math.round(amount / 1000))} هزار تومان`;
  return `${fa(amount.toLocaleString("en-US"))} تومان`;
}

/**
 * بلوک «فکت‌های رسمی سایت فیتاپ» — به‌صورت متن فارسی فشرده برای تزریق در
 * پرامپت‌های استراتژی سئو، تولید مقاله و بازنویسی محتوا.
 * کش ۶۰ ثانیه‌ای دارد؛ در بدترین حالت (خطای DB) با فال‌بک ثابت ساخته می‌شود.
 */
export async function buildSeoSiteFactsBlock(): Promise<string> {
  const now = Date.now();
  if (cachedFactsBlock && now - cachedFactsAt < FACTS_CACHE_TTL_MS) {
    return cachedFactsBlock;
  }

  const { referralReward, exerciseCount, foodCount } = await readSiteFactsData();

  const block = `🏛️ فکت‌های رسمی سایت فیتاپ (v246 — تنها منبع مجاز برای هر ادعایی دربارهٔ پلن‌ها و امکانات فیتاپ):
۱) پلن‌های اشتراک فیتاپ — دقیقاً ۴ پلن، همهٔ دوره‌ها ${fa(SUBSCRIPTION_PLANS[0]?.durationDays ?? 45)} روزه (۱ فاز) و قابل تمدید:
${SUBSCRIPTION_PLANS.map(planFactLine).join("\n")}
۲) دروازه‌های واقعی امکانات (مهم — هرگز برخلاف این‌ها ننویس):
- مربی هوشمند/چت فیتاپ: فقط پلن پیشرفته و حرفه‌ای — بی‌نهایت؛ پلن اقتصادی و استاندارد مربی هوشمند ندارند (برای این دو پلن هرگز «چت با مربی» یا «پشتیبانی هوشمند» ننویس).
- چکاپ دوره‌ای و به‌روزرسانی برنامه: استاندارد به بالا — ۳ چکاپ در روزهای ۱۵/۳۰/۴۰ دوره؛ برنامه با هر چکاپ در جای همان برنامه به‌روز می‌شود (هیچ پلنی «به‌روزرسانی روزانه/هفتگی/ماهانه» ندارد).
- آنالیز عکس غذا و آنالیز عکس بدن: فقط پیشرفته و حرفه‌ای.
- حالت باشگاه (Gym Mode): فقط پیشرفته و حرفه‌ای.
- آنالیز ویدیویی تمرین/فرم بدن و اصلاح تکنیک: فقط حرفه‌ای — ۱ بار در طول دوره.
- آنالیز آزمایش خون: فقط حرفه‌ای — ۱ بار در طول دوره.
- نظارت مربی انسانی: فقط حرفه‌ای.
۳) سایر فکت‌های واقعی فیتاپ:
- امکانات رایگان برای همهٔ کاربران (حتی بدون خرید پلن): محاسبه‌گر TDEE، بانک ${fa(exerciseCount)} حرکت ورزشی با آموزش تصویری، بانک غذا و کالری با ${fa(foodCount)} ماده غذایی، برنامه‌های رایگان
- مسیریاب فیتاپ: ثبت پیاده‌روی و دویدن با GPS برای همهٔ کاربران
- سیستم معرفی دوست: ${formatToman(referralReward)} پاداش برای هر معرفی موفق
۴) قاعدهٔ قیمت: قیمت هر پلن را عددی ننویس — قیمت‌ها ممکن است تغییر کنند؛ هرجا قیمت مطرح شد به [پلن‌های فیتاپ](/#pricing) لینک بده و بنویس «برای مشاهدهٔ قیمت‌های به‌روز به صفحهٔ پلن‌ها مراجعه کنید».
⚠️ جدول مقایسه پلن‌ها (اگر نوشتی) باید عیناً از همین فکت‌ها ساخته شود؛ هیچ تیر/امکاناتی از خودت نساز.`;

  cachedFactsBlock = block;
  cachedFactsAt = now;
  return block;
}
