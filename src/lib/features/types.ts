/**
 * تعاریف تایپ برای سیستم Feature Flag / قابلیت‌های فیتاپ
 *
 * این ماژول قرارداد سیستم feature flag را تعریف می‌کند. هر feature
 * یک قابلیت پلتفرم است (مثل "برنامه تمرینی"، "آنالیز آزمایش خون" و ...)
 * که می‌تواند بر اساس پلن کاربر فعال/غیرفعال باشد.
 *
 * تفاوت با canAccess قدیمی در src/lib/fitness/types.ts:
 *   - canAccess قدیمی روی PlanCapabilities کار می‌کند (مثل aiChatQuestions، chatImageUpload)
 *     و برای کنترل fine-grained استفاده می‌شود.
 *   - این سیستم جدید روی Feature‌ها کار می‌کند (مثل workout_plan، blood_test_analysis)
 *     و برای کنترل coarse-grained و مارکت‌پلیس استفاده می‌شود.
 *   - هر دو سیستم می‌توانند همزیستی کنند — این سیستم جدید extensible‌تر است.
 *
 * قابلیت‌های آینده:
 *   - toggling از طریق DB SiteSetting (در نسخه بعدی)
 *   - feature flags پویا برای A/B testing
 */

/** نوع پلن اشتراک — منطبق با Plan در types.ts */
export type FeaturePlan = "basic" | "standard" | "advanced" | "ultimate";

/**
 * تعریف یک feature flag.
 */
export interface Feature {
  /** شناسه یکتای feature، مثلاً "workout_plan" */
  id: string;
  /** نام نمایشی فارسی */
  name: string;
  /** توضیحات فارسی — در مارکت‌پلیس نمایش داده می‌شود */
  description: string;
  /** لیست پلن‌هایی که به این feature دسترسی دارند. آرایه خالی = admin-only */
  plans: FeaturePlan[];
  /** آیا این feature فعلاً فعال است؟ (در آینده از DB SiteSetting خوانده می‌شود) */
  enabled: boolean;
  /** نام آیکن از کتابخانه lucide-react */
  icon: string;
}

/**
 * لیست کامل feature flag‌های فیتاپ.
 *
 * نکته: features با plans=[] به معنای admin-only هستند (هیچ کاربری به آن‌ها دسترسی ندارد).
 *
 * v80 — دیریکتیو مالک: featureهای «تحلیل عکس بدن» (body_photo_analysis) و
 * «تحلیل آزمایش خون» (blood_test_analysis) از لیست امکانات ویژه کامل حذف شدند؛
 * ترتیب امکانات ویژه هم بر اساس اولویت مالک است: چت با فیتاپ ← حالت باشگاه ←
 * تحلیل عکس غذا ← دستیار تغذیه.
 */
export const FEATURES: Feature[] = [
  // ─── قابلیت‌های موجود (existing features) ───
  {
    id: "workout_plan",
    name: "برنامه تمرینی",
    description:
      "برنامه تمرینی هوشمند و شخصی‌سازی‌شده بر اساس هدف، سطح و تجهیزات کاربر. شامل سوپرست و تری‌ست.",
    plans: ["basic", "standard", "advanced", "ultimate"],
    enabled: true,
    icon: "Dumbbell",
  },
  {
    id: "meal_plan",
    name: "برنامه غذایی",
    description:
      "برنامه غذایی شخصی‌سازی‌شده با محاسبه دقیق کالری و درشت‌مغذی‌ها، شامل ترکیب و جایگزینی غذاها.",
    plans: ["basic", "standard", "advanced", "ultimate"],
    enabled: true,
    icon: "Apple",
  },
  {
    id: "supplement_plan",
    name: "برنامه مکمل",
    description:
      "تجویز مکمل‌های ورزشی با دوز ایمن و زمان‌بندی مصرف، مبتنی بر آخرین تحقیقات علمی.",
    plans: ["standard", "advanced", "ultimate"],
    enabled: true,
    icon: "Pill",
  },
  {
    id: "checkup",
    name: "چکاپ دوره‌ای",
    description:
      "چکاپ‌های دوره‌ای برای رصد پیشرفت، شامل اندازه‌گیری بدن، درصد چربی و عکس‌های پیشرفت.",
    plans: ["standard", "advanced", "ultimate"],
    enabled: true,
    icon: "ClipboardCheck",
  },
  {
    id: "smart_coach",
    name: "چت با فیتاپ",
    description:
      "چت ۲۴ ساعته با فیتاپ هوشمند — مربی متخصص ورزشی و تغذیه. پشتیبانی متن و عکس.",
    plans: ["advanced", "ultimate"],
    enabled: true,
    icon: "Sparkles",
  },
  {
    id: "gym_mode",
    name: "حالت باشگاه",
    description:
      "حالت باشگاه با تایمر استراحت، پخش موسیقی، و راهنمای حرکات به صورت زنده حین تمرین.",
    plans: ["advanced", "ultimate"],
    enabled: true,
    icon: "Music",
  },
  {
    id: "meal_photo_analysis",
    name: "تحلیل عکس غذا",
    description:
      "ارسال عکس وعده غذایی و دریافت تحلیل هوشمند کالری و درشت‌مغذی‌ها به صورت لحظه‌ای.",
    plans: ["advanced", "ultimate"],
    enabled: true,
    icon: "Camera",
  },
  {
    id: "nutrition_companion",
    name: "دستیار تغذیه",
    description:
      "دستیار هوشمند تغذیه که پیشنهاد جایگزینی غذا و تنظیم کالری روزانه را به صورت تعاملی ارائه می‌دهد.",
    plans: ["advanced", "ultimate"],
    enabled: true,
    icon: "Apple",
  },
  {
    id: "video_analysis",
    name: "تحلیل ویدیو",
    description:
      "تحلیل ویدیوی تمرین برای اصلاح تکنیک حرکات — ویژهٔ پلن حرفه‌ای.",
    plans: ["ultimate"],
    enabled: true,
    icon: "Video",
  },
  // ─── ایجنت‌های هوش مصنوعی آینده (admin-only — plans=[]) ───
  {
    id: "seo_agent",
    name: "ایجنت سئو",
    description:
      "ایجنت خودکار سئو برای تولید و انتشار مقالات سئوشده. مخصوص ادمین — دسترسی کاربر ندارد.",
    plans: [], // آرایه خالی = admin-only
    enabled: true,
    icon: "Rocket",
  },
];

// ─── Registry API (امضاها) ───
// پیاده‌سازی توابع canAccess، listFeaturesForPlan، listAllFeatures
// در فایل index.ts قرار دارد.
