import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/fitness/theme-provider";
import { HeadCodeInjector } from "@/components/fitness/head-code-injector";
import { PwaRegister } from "@/components/fitness/pwa-register";
import { KeyboardFix } from "@/components/fitness/keyboard-fix";
import { NetShieldInstaller } from "@/components/fitness/net-shield-installer";
// v153 — pull-to-refresh سفارشی «فقط یک‌چهارم بالای صفحه» (دیرکتیو مالک)
import { PullToRefreshInstaller } from "@/components/fitness/pull-to-refresh-installer";
// PwaInstallPrompt حذف شد (v12.3) — نصب فقط با اپ اندروید (APK) و وب‌اپ iOS
import { ErrorCapture } from "@/components/fitness/error-capture";
// BackButtonHandler حذف شد — popstate در page.tsx مدیریت می‌شود (جلوگیری از تداخل)
import { GlobalNewTermsModal } from "@/components/fitness/global-new-terms-modal";

const vazirmatn = localFont({
  src: [
    { path: "../../public/fonts/Vazirmatn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-vazirmatn",
  display: "swap",
  preload: true,
});

// دامنه سایت — fittup.ir
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه",
    template: "%s | فیتاپ",
  },
  description:
    "برنامه بدنسازی آنلاین فیتاپ — برنامه تمرینی، غذایی و مکمل شخصی‌سازی‌شده. دنیایی از تجربه بدنسازی با بهترین مربیان ایران. حجمی، کات، رژیم غذایی برای آقایان و بانوان.",
  applicationName: "فیتاپ",
  // Google Search Console verification — کد جدید برای fittup.ir
  verification: {
    google: "FBUeu2ZuRqKrlnu_aweORxGbh3gxSYHOlA1jhX4xiDs",
  },
  keywords: [
    // ─── Primary (اصلی) ───
    "برنامه بدنسازی",
    "برنامه تمرینی بدنسازی",
    "برنامه غذایی بدنسازی",
    "برنامه مکمل بدنسازی",
    "رژیم غذایی بدنسازی",
    "برنامه حجمی بدنسازی",
    "برنامه کات چربی سوزی بدنسازی",
    // ─── Pricing / تعرفه ───
    "تعرفه برنامه بدنسازی",
    "قیمت برنامه بدنسازی",
    "قیمت برنامه ورزشی",
    "تعرفه برنامه تمرینی",
    "قیمت برنامه تمرینی",
    "تعرفه برنامه غذایی",
    "قیمت برنامه غذایی",
    "هزینه برنامه بدنسازی",
    "خرید برنامه بدنسازی",
    "خرید برنامه ورزشی",
    // پایه (شامل واژگان تکی پرتقاضا)
    "برنامه تمرینی",
    "برنامه غذایی",
    "برنامه مکمل",
    // ─── Coach / مربی ───
    "مربی ورزشی",
    "مربی بدنسازی",
    "مربی خانم",
    "مربی آقا",
    "مربی هوشمند",
    "مربی آنلاین",
    "مربی شخصی",
    "مربی هوش مصنوعی ورزشی",
    // ─── Synonyms (مترادف‌ها) ───
    "برنامه ورزشی",
    "برنامه پرورش اندام",
    "روال تمرینی",
    "برنامه باشگاه",
    "رژیم غذایی",
    "برنامه تغذیه",
    "منوی غذایی",
    "پلن تغذیه",
    "برنامه مصرف مکمل",
    "استک مکمل",
    "پرورش اندام",
    "تناسب اندام",
    "فیتنس",
    // ─── Related / LSI ───
    "افزایش حجم عضلانی",
    "چربی سوزی",
    "کاهش وزن",
    "عضله سازی",
    "خشک کردن بدن",
    "سلامتی",
    "برنامه بدنسازی آقایان",
    "برنامه بدنسازی بانوان",
    "برنامه بدنسازی مبتدی",
    "برنامه بدنسازی حرفه‌ای",
    "برنامه بدنسازی در خانه",
    "برنامه بدنسازی در باشگاه",
    "حجم Bulking",
    "کات Cutting",
    "بدنسازی طبیعی",
    "دوره حجم",
    "دوره کات",
    "کالری",
    "درشت‌مغذی‌ها",
    // ─── High-Intent (قصد خرید بالا) ───
    "خرید برنامه بدنسازی",
    "خرید برنامه بدنسازی آنلاین",
    "بهترین برنامه تمرینی بدنسازی",
    "بهترین برنامه غذایی بدنسازی",
    "برنامه بدنسازی شخصی‌سازی شده",
    "برنامه بدنسازی آنلاین",
    "برنامه بدنسازی ارزان",
    "برنامه بدنسازی رایگان",
    // ─── Long-Tail (افعال و اهداف) ───
    "برنامه بدنسازی برای افزایش وزن",
    "برنامه بدنسازی برای کاهش وزن",
    "برنامه بدنسازی برای افزایش وزن در خانه",
    "برنامه بدنسازی برای مبتدیان",
    "برنامه بدنسازی برای حرفه‌ایان",
    "برنامه بدنسازی ۳ روز در هفته",
    "برنامه بدنسازی ۴ روز در هفته",
    "برنامه بدنسازی ۳ جلسه در هفته",
    "برنامه بدنسازی بدون تجهیزات",
    "برنامه بدنسازی با دمبل",
    "برنامه غذایی برای حجم‌گیری",
    "برنامه غذایی برای چربی‌سوزی",
    "برنامه غذایی برای کاهش وزن",
    "برنامه غذایی برای عضله‌سازی",
    "برنامه غذایی حجمی برای آقایان مبتدی",
    "برنامه تمرینی و غذایی شخصی‌سازی شده",
    // ─── Tools / Movements / Metrics (ابزارها، بانک حرکات و سنجش‌ها) ───
    "محاسبه کالری روزانه",
    "جدول کالری غذاها",
    "بانک حرکات بدنسازی",
    "آموزش حرکات بدنسازی",
    "تمرینات بدنسازی",
    "حرکات قدرتی",
    "حرکات هایپرتروفی",
    "پروتئین روزانه",
    "کالری روزانه",
    "درصد چربی بدن",
    "شاخص توده بدنی BMI",
    "TDEE محاسبه",
    // ─── Supplements (مکمل‌ها — پایه) ───
    "مکمل‌های ورزشی",
    "مکمل بدنسازی",
    "کراتین",
    "پروتئین وی",
    "امگا ۳",
    // ─── Regional (منطقه‌ای — ایران) ───
    "برنامه بدنسازی ایرانی",
    "مربی بدنسازی ایرانی",
    "برنامه غذایی ایرانی",
    "غذاهای ایرانی کالری",
    "جدول کالری غذاهای ایرانی",
    // ─── Plans / Subscriptions (پلن و اشتراک) ───
    "خرید پلن بدنسازی",
    "اشتراک بدنسازی",
    "پلن اقتصادی بدنسازی",
    "پلن استاندارد بدنسازی",
    "پلن پیشرفته بدنسازی",
    "پلن حرفه‌ای بدنسازی",
    // ─── Brand + English ───
    "فیتاپ",
    "fittup",
    "AI fitness coach",
    "workout plan",
    // ─── مکمل‌های تخصصی (Supplements — Pro) ───
    "کراتین مونوهیدرات",
    "کازئین پروتئین",
    "پروتئین ایزوله",
    "پروتئین کنسانتره",
    "گینر",
    "آمینو اسید",
    "BCAA",
    "EAA",
    "گلوتامین",
    "آرژنین",
    "سیترین",
    "بتاآلانین",
    "کافئین",
    "نایاسین",
    "ملاتونین",
    "زینک",
    "منیزیم",
    "کلسیم",
    "آهن",
    "ویتامین D",
    "ویتامین B12",
    "ویتامین C",
    "ویتامین E",
    "ویتامین K",
    "روغن ماهی",
    "فیش اویل",
    "مولتی ویتامین",
    "زینک منیزیم",
    "ZMA",
    "تورین",
    "ال-کارنیتین",
    "ال-تیروزین",
    "ال-سیستئین",
    "هورمون رشد",
    "تستوسترون بوستر",
    "تریبولوس",
    "مک جا",
    "اشواگاندا",
    "گینسنگ",
    "کلاژن",
    "اسید هیالورونیک",
    "MSM",
    "کرتین HCL",
    // ─── ویتامین‌ها به‌صورت تفکیک‌شده (Each Vitamin — Deep) ───
    "ویتامین A",
    "ویتامین B1",
    "ویتامین B2",
    "ویتامین B3",
    "ویتامین B5",
    "ویتامین B6",
    "ویتامین B7",
    "ویتامین B9",
    "ویتامین B12",
    "ویتامین C",
    "ویتامین D",
    "ویتامین E",
    "ویتامین K",
    "تیامین",
    "ریبوفلاوین",
    "نیاسین",
    "پانتوتنیک اسید",
    "پیریدوکسین",
    "بیوتین",
    "فولیک اسید",
    "کوبالامین",
    "اسید اسکوربیک",
    "توکوفرول",
    "کینون",
    // ─── مکمل‌های گیاهی و طبیعی (Herbal/Adaptogens — Deep) ───
    "جینسنگ قرمز",
    "جینسنگ کره‌ای",
    "ماکا روت",
    "ماکا پرویی",
    "اشواگاندا",
    "آشواگاندا",
    "تورین",
    "شیلجیت",
    "شیلاجیت",
    "تریبولوس ترستریس",
    "مک جا",
    "فنوگریک",
    "تونکات علی",
    // ─── مکمل‌های پیش‌تمرین (Pre-Workout — Deep) ───
    "پیش تمرین",
    "پری ورک‌اوت",
    "N.O. booster",
    "نیتریک اکساید بوستر",
    "آرژنین AKG",
    "آرژنین آلفا کتوگلوتارات",
    "سیترین مالات",
    "سیترین",
    "آرژنین",
    // ─── مکمل‌های ریکاوری (Recovery — Deep) ───
    "گلوتامین",
    "کلاژن هیدرولیز شده",
    "کلاژن هیدرولیزاته",
    "کراتین HCL",
    "کراتین هیدروکلراید",
    "کراتین مونوهیدرات",
    // ─── استروئیدها و داروها (فقط اطلاعات آموزشی) ───
    "استروئید آنابولیک",
    "تستوسترون",
    "تستوسترون انانتات",
    "تستوسترون سیپیونات",
    "تستوسترون پروپیونات",
    "ناندولون",
    "دکا دورابولین",
    "ترنبالون",
    "وینسترول",
    "آناور",
    "دیانابول",
    "کلن بوترول",
    "هورمون رشد انسانی",
    "HGH",
    "IGF-1",
    "انسولین",
    "PCT",
    "درمان پس از دوره",
    "آنتی استروژن",
    "کلومید",
    "نولوادکس",
    "آرمیدکس",
    "پروویرون",
    "اچ سی جی",
    "HCG",
    // ─── استروئیدهای بیشتر (فقط آموزشی — Steroids Deep) ───
    "اکسی‌مثلون",
    "آنادرول",
    "فلویوکسترون",
    "هالوتستین",
    "مسترولون",
    "پروویرون",
    "دروستانولون",
    "مسترولون",
    "متندیلون",
    "داینبول",
    "تورینابول",
    "پارابولان",
    "آناور",
    "وینسترول",
    "ترنبالون",
    // ─── SARMs (Selective Androgen Receptor Modulators — فقط آموزشی) ───
    "SARM",
    "SARMs",
    "اوستارین",
    "اوستarine",
    "لیناگولوتامید",
    "لیگاندرول",
    "رادارین",
    "رادارین 140",
    "آندارین",
    "آندارین S4",
    "مکمل SARM",
    // ─── پروتکل‌های PCT (PCT Protocols — فقط آموزشی) ───
    "پروتکل PCT",
    "کلومید و نولوادکس",
    "HCG و آرمیدکس",
    "HCG و آریمازول",
    "درمان پس از دوره استروئید",
    // ─── حرکات تخصصی (Exercises) ───
    "پرس سینه",
    "پرس بالاسینه",
    "پرس زیرسینه",
    "اسکوات",
    "اسکوات جلو",
    "ددلیفت",
    "ددلیفت رومانیایی",
    "لات پولدان",
    "بارفیکس",
    "پرس سرشانه",
    "پرس نظامی",
    "شنا",
    "دیپ",
    "لانگز",
    "پرس پا",
    "جلو ران",
    "پشت ران",
    "ساق پا",
    "زیربغل قایقی",
    "زیربغل دمبل",
    "جلو بازو",
    "پشت بازو",
    "ساعد",
    "کرانچ",
    "پلانک",
    "هایپراکستنشن",
    "کشش",
    "فوم رولر",
    // ─── حرکات کلاژن و کور (Rotator Cuff / Prehab — Deep) ───
    "face pull",
    "فیس پول",
    "external rotation",
    "چرخش خارجی شانه",
    "internal rotation",
    "چرخش داخلی شانه",
    "Y-Raise",
    "Y ریز",
    "T-Raise",
    "T ریز",
    "روتاتور کاف",
    "rotator cuff",
    "حرکات کلاژن",
    "حرکات کور",
    "فرم اصلاحی",
    // ─── حرکات کالیشتیک (Calisthenics — Deep) ───
    "muscle up",
    "ماسل آپ",
    "front lever",
    "فرانت لور",
    "back lever",
    "بک لور",
    "human flag",
    "پرچم انسانی",
    "planche",
    "پلانش",
    "کالیشتیک",
    "کرن کالیشتیک",
    "هندستند",
    "handstand",
    "پارالترال",
    "بارفیکس کالیشتیک",
    // ─── حرکات المپیکی (Olympic Lifts — Deep) ───
    "clean and jerk",
    "کلین اند جِرک",
    "snatch",
    "اسنچ",
    "power clean",
    "پاور کلین",
    "وزنه‌برداری المپیکی",
    "حرکات المپیکی",
    "پرتاب وزنه",
    "split jerk",
    "اسکوات اسنچ",
    // ─── روش‌های تمرینی (Training Methods) ───
    "سوپرست",
    "تری‌ست",
    "جاینت‌ست",
    "دراپ‌ست",
    "رست پاز",
    "فش با پول",
    "تدریجی اضافه بار",
    "RPE",
    "RIR",
    "volume training",
    "intensity training",
    "فرکانسی تمرین",
    "دوره‌بندی",
    "خطی دوره‌بندی",
    "موجی دوره‌بندی",
    // ─── روش‌های تمرینی پیشرفته (Training Methods — Deep) ───
    "German Volume Training",
    "GVT تمرین",
    "حجم تمرین آلمانی",
    "5/3/1",
    "5/3/1 وندلر",
    "Starting Strength",
    "استارتینگ استرنگت",
    "PPL",
    "Push Pull Legs",
    "پوش پول پا",
    "Upper/Lower",
    "آپر لوور",
    "Bro Split",
    "برو اسپلیت",
    "BFR",
    "Blood Flow Restriction",
    "محدودیت جریان خون",
    "CAT",
    "Compensatory Acceleration Training",
    "Pre-Exhaust",
    "پیش تخلیه",
    "Post-Exhaust",
    "پس تخلیه",
    "Rest-Pause",
    "رست پاز",
    "Cluster Sets",
    "کلاستر ست",
    // ─── تغذیه تخصصی (Advanced Nutrition) ───
    "کالری مازاد",
    "کالری نقصان",
    "بولکینگ",
    "کاتینگ",
    "بولک تمیز",
    "بولک کثیف",
    "رفلید",
    "روز تقلب",
    "متغیر کالری",
    "سایکل کربوهیدرات",
    "کتوژنیک",
    "اینترمیتنت فاستینگ",
    "فستینگ",
    "پالئو",
    "وگان بدنسازی",
    "رژیم پروتئین بالا",
    "رژیم کم کربوهیدرات",
    "تایمینگ تغذیه",
    "پری ورک‌اوت",
    "پست ورک‌اوت",
    // ─── آنالیز و اندازه‌گیری (Analysis & Metrics) ───
    "درصد چربی بدن",
    "شاخص توده بدنی",
    "BMI",
    "BMR",
    "TDEE",
    "متابولیسم پایه",
    "متریک بدنی",
    "اندازه‌گیری عضلات",
    "پیشرفت ورزشی",
    "رکورد شخصی",
    "PR",
    "1RM",
    "ماکسیمم تکرار",
    "تست استقامت",
    "تست قدرت",
    // ─── مربیان و ورزشکاران (Athletes & Coaches) ───
    "رونی کلمن",
    "جی کاتلر",
    "فیل هیت",
    "دکستر جکسون",
    "مسابقات بدنسازی",
    "المپیا",
    "مستر المپیا",
    // ─── بیماری‌ها و مصدومیت‌ها (Injuries & Conditions) ───
    "کمردرد ورزشی",
    "آسیب شانه",
    "کشیدگی عضله",
    "التهاب تاندون",
    "کف پای صافی",
    "دیسک کمر",
    "آسیب زانو",
    "رباط صلیبی",
    "تنگی نفس ورزشی",
    "خستگی مزمن",
    "overtraining",
    "overreaching",
    "ریکاوری ورزشی",
    "استراحت فعال",
    "روز استراحت",
  ],
  authors: [{ name: "فیتاپ", url: SITE_URL }],
  creator: "فیتاپ",
  publisher: "فیتاپ",
  // NOTE: canonical در اینجا set نمی‌شود چون صفحات مختلف canonical متفاوتی دارند.
  // هر صفحه (مقاله، ابزار، لندینگ) canonical خود را با setLinkTag در client set می‌کند.
  // اگر canonical در اینجا set شود، همه صفحات canonical یکسان می‌شوند و گوگل خطای
  // "Alternative page with proper canonical tag" می‌دهد.
  // v218 — فقط types (فید RSS) در سطح layout تعریف می‌شود؛ canonical همچنان
  // در اختیار خود صفحات است.
  alternates: {
    types: {
      "application/rss+xml": `${SITE_URL}/feed.xml`,
    },
  },
  openGraph: {
    title: "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه",
    description:
      "بهترین برنامه تمرینی و غذایی بدنسازی شخصی‌سازی‌شده با هوش مصنوعی. برنامه حجمی و برنامه کات (چربی‌سوزی)، برنامه مکمل، رژیم غذایی برای آقایان و بانوان، مبتدی و حرفه‌ای. خرید برنامه بدنسازی آنلاین با پشتیبانی ۲۴ ساعته — هر بدنی فیتاپ میخواد.",
    url: SITE_URL,
    siteName: "فیتاپ",
    locale: "fa_IR",
    type: "website",
    // v218 — تصویر OG اختصاصی ۱۲۰۰×۶۳۰ (جای لوگوی ۵۱۲×۵۱۲ — ممیزی سئو:
    // پیش‌نمایش شبکه‌های اجتماعی/واتساپ/تلگرام نسبت‌درست و برندشده)
    images: [
      {
        url: `${SITE_URL}/og/og-default.png`,
        width: 1200,
        height: 630,
        alt: "فیتاپ — اپلیکیشن تناسب اندام با هوش مصنوعی",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "برنامه بدنسازی آنلاین | فیتاپ",
    description:
      "بهترین برنامه تمرینی و غذایی بدنسازی شخصی‌سازی‌شده با هوش مصنوعی — برنامه حجمی، برنامه کات، رژیم غذایی. خرید برنامه بدنسازی آنلاین.",
    images: [`${SITE_URL}/og/og-default.png`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // v52 (درخواست مالک — ۳۱ نصب PWA در برابر ۱ نصب اپ): لینک manifest عمومی حذف شد.
  // کروم با وجود manifest سایت را «قابل نصب» می‌داند و مدال نصب در نوار آدرس +
  // گزینهٔ Install app را نشان می‌دهد (preventDefault فقط مینی‌بنر را می‌کُشد).
  // حالا manifest فقط برای iOS (سافاری) در head script پایین به‌صورت داینامیک
  // تزریق می‌شود — نصب وب‌اپ فقط روی آیفون ممکن می‌ماند (موضوع رسمی وب‌اپ iOS)
  // و کروم/اندروید به‌کلی از UI نصب محروم می‌شود؛ کاربر اندرویدی به اپ اختصاصی می‌رود.
  // manifest: "/manifest.json",
  icons: {
    // ۳۲-B: ?v=8 — آیکون‌ها بازتولید شدند (کش‌باستر برای همه صفحات)
    icon: [
      { url: "/favicon-16.png?v=8", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png?v=8", sizes: "32x32", type: "image/png" },
      { url: "/favicon.png?v=8", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png?v=8", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png?v=8", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png?v=8", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.png?v=8"],
  },
  // v52: بلوک appleWebApp حذف شد — Next متای apple-mobile-web-app-status-bar-style
  // با مقدار default می‌ساخت که با متای دستی پایین (black-translucent) متناقض بود؛
  // متاهای دستی مرجع‌اند.
  // appleWebApp: { capable: true, title: "FitUp", statusBarStyle: "default" },
  category: "health",
};

export const viewport: Viewport = {
  // نارنجی سازمانی فیتاپ (#f97316) — نوار بالای مرورگر کروم/اندروید (قبلاً زرد #f59e0b بود)
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // viewportFit=cover برای فعال شدن env(safe-area-inset-*) در iOS —
  // بدون آن padding ناوبری پایین و TopBar زیر نوار وضعیت/هوم‌اندیکیتور می‌رود.
  viewportFit: "cover",
  // FIX (v50 — گزارش مالک: ورود از اینستاگرام، کیبورد فرم OTP را می‌پوشاند):
  // resizes-content → هنگام باز شدن کیبورد در اندروید (کروم/WebView/مرورگر
  // درون‌برنامه‌ای) layout viewport کوچک می‌شود و ۱۰۰dvh/ثابت‌های ارتفاعی با
  // کیبورد جمع می‌شوند — همان رفتار adjustResize که اپ اندروید دارد. ورودیِ
  // فعال دیگر پشت کیبورد نمی‌ماند (مکمل scrollIntoView در auth-screen).
  interactiveWidget: "resizes-content",
};

// ---- Structured data (JSON-LD) ----
// سازمان (Organization)
const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "فیتاپ",
  alternateName: "FitUp",
  url: SITE_URL,
  logo: `${SITE_URL}/fitup-logo.png`,
  description: "اپلیکیشن برنامه بدنسازی و تغذیه با تجربه بهترین مربیان ایران",
  slogan: "هر بدنی فیتاپ میخواد — برنامه بدنسازی آنلاین",
  sameAs: [
    SITE_URL,
    // v218 — پروفایل‌های واقعی سازمان (ممیزی سئو: sameAs غنی‌تر = اعتماد بیشتر
    // در Knowledge Graph) — اینستاگرام از landing-nav/instagram-cta-section و
    // پیام‌رسان بله از فوتر لندینگ (پشتیبانی)
    "https://instagram.com/fittup.ir",
    "https://ble.ir/hossein_javanbakht",
  ],
};

// وب‌سایت (WebSite) با قابلیت جستجو
// v218 — potentialAction SearchAction اضافه شد (Sitelinks Search Box)؛
// پارامتر جستجو از route واقعی مقالات برداشته شد: /articles?search=…
// (src/app/articles/page.tsx — sp.search)
const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "فیتاپ",
  url: SITE_URL,
  inLanguage: "fa-IR",
  description: "برنامه بدنسازی و تغذیه شخصی‌سازی‌شده — دنیایی از تجربه بدنسازی در دستان شما. هر بدنی فیتاپ میخواد",
  publisher: { "@type": "Organization", name: "فیتاپ", url: SITE_URL },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/articles?search={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning translate="no" className="notranslate">
      <head>
        {/* ── v202 (L15) — صف پل restore خرید بازار (قبل از هر چیز دیگری) ──
            MainActivity در onPageFinished (قبل از هیدریشن React) صدا می‌زند:
            window.__fitupBazaarRestore(purchases) — اگر هندلر واقعی هنوز ثبت
            نشده باشد، wrapper آن را صف می‌کند و page-client بعد از ثبت Impl
            تخلیه‌اش می‌کند. بدون این، فعال‌سازی خریدِ پرداخت‌شده تا بازوبند
            کردن اپ عقب می‌افتاد. قرارداد دوطرفه — بدون تغییر در سمت Kotlin. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              if (window.__fitupBazaarRestore) return;
              window.__fitupBazaarRestoreQueue = [];
              window.__fitupBazaarRestore = function (purchases) {
                try {
                  if (window.__fitupBazaarRestoreImpl) {
                    return window.__fitupBazaarRestoreImpl(purchases);
                  }
                  window.__fitupBazaarRestoreQueue.push(purchases);
                } catch (e) {}
              };
            })();`,
          }}
        />
        {/* ── v161 — پالی‌فیل مرورگرهای قدیمی (باید قبل از هر JS اپ اجرا شود) ──
            مرورگر Huawei 11 (Chrome/83) و WebViewهای مشابه APIهای ۲۰۲۰+ ندارند:
            replaceAll (Chrome 85)، Array.at (92)، Object.hasOwn (93)، findLast (97).
            نبودِ فقط یکی از این‌ها کرش error-boundary می‌سازد (لاگ مالک:
            «e.replaceAll is not a function» در تب پلن‌ها). inline در head تا
            قبل از هیدریشن React حاضر باشد — هم برای کد خودمان هم برای کتابخانه‌ها. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              if (!String.prototype.replaceAll) {
                String.prototype.replaceAll = function (search, replacement) {
                  if (search instanceof RegExp) {
                    if (!search.global) throw new TypeError("String.prototype.replaceAll called with a non-global RegExp argument");
                    return this.replace(search, replacement);
                  }
                  return this.split(search).join(String(replacement));
                };
              }
              if (!Array.prototype.at) {
                Array.prototype.at = function (n) {
                  n = Math.trunc(n) || 0;
                  if (n < 0) n += this.length;
                  if (n < 0 || n >= this.length) return undefined;
                  return this[n];
                };
                String.prototype.at = Array.prototype.at;
              }
              if (!Object.hasOwn) {
                Object.hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(Object(o), k); };
              }
              if (!Array.prototype.findLast) {
                Array.prototype.findLast = function (fn, thisArg) {
                  for (var i = this.length - 1; i >= 0; i--) {
                    if (fn.call(thisArg, this[i], i, this)) return this[i];
                  }
                  return undefined;
                };
              }
              if (!Array.prototype.findLastIndex) {
                Array.prototype.findLastIndex = function (fn, thisArg) {
                  for (var i = this.length - 1; i >= 0; i--) {
                    if (fn.call(thisArg, this[i], i, this)) return i;
                  }
                  return -1;
                };
              }
            })();`,
          }}
        />
        {/* ── v161 — ممنوعیت ترجمهٔ خودکار مرورگر (ریشه‌یابی removeChild/#418) ──
            مرورگرهای درون‌برنامه‌ای (GSA/اینستاگرام/سامسونگ) با ترجمهٔ خودکار،
            نودهای متن DOM را جایگزین می‌کنند؛ React هنگام حذف همان نودها
            NotFoundError «The object can not be found here» می‌گیرد و درختِ
            هیدریشن هم mismatch می‌خورد (#418). سایت تمام‌فارسی است — دستکاریِ
            ترجمه‌ای DOM هیچ ارزشی ندارد و فقط قیف فروش را می‌شکند. */}
        <meta name="google" content="notranslate" />
        {/* ── تأییدیه‌ها ── */}
        {/* Google Search Console Verification — کد جدید برای fittup.ir */}
        <meta name="google-site-verification" content="FBUeu2ZuRqKrlnu_aweORxGbh3gxSYHOlA1jhX4xiDs" />
        {/* اینماد — کد جدید 24472446 */}
        <meta name="enamad" content="24472446" />
        {/* ── v228 — گارد زودهنگام خطا (اولین listener خطای صفحه) ──
            ریشه‌یابی ممیزی Clarity (دیرکتیو مالک: «خطاهای JS باید به صفر برسد»):
            سه امضای ۲۴ ساعت اخیر — «Script error.»، «Error invoking postMessage:
            Java object is gone» و «Invalid regular expression: invalid group
            specifier name» — همگی نویزِ اسکریپت‌های تزریقی خارجی (IAB اینستاگرام
            و مشابه) روی WebKit قدیمی‌اند، نه کد فیتاپ: هر ۲۸ چانک زندهٔ سه صفحه
            + HTML inline + SDK خود Clarity با grep راستی‌آزمایی شد (صفر
            lookbehind محافظت‌نشده؛ تنها مورد، feature-detection محافظت‌شدهٔ
            core-js است) و لاگ خطای خود سایت هم از همیشه صفر خطای regex دارد.
            چون Clarity با «window.onerror=» گوش می‌دهد (نه addEventListener)،
            طبق spec تنها راه کورکردن آن preventDefault است؛ برای نویز محض
            stopImmediatePropagation هم می‌زنیم، ولی خطاهای chunk فقط
            preventDefault می‌شوند تا زنجیرهٔ ریکاوری/reload خود اپ (v67/v156)
            دست‌نخورده بماند. خطاهای واقعیِ غیرنویز کاملاً عبور می‌کنند.
            بعلاوه: خطاهای رخ‌داده «پیش از هیدریشن» (که قبلاً از دست ErrorCapture
            می‌رفتند و لاگ ما نمی‌دید) در __fitupEarlyErrs بافر و در اولین mount
            ErrorCapture شسته می‌شوند — تساوی دیدِ لاگ ما با Clarity.
            ES5 خالص: این گارد باید روی همان مرورگرهای قدیمیِ هدفش هم سالم اجرا
            شود. همگام با src/lib/fitness/error-noise.ts (v37/v75/v149/v161). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              var CHUNK_MARKERS=["chunkloaderror","loading chunk","loading css chunk","chunk load failed","dynamically imported module","importing a module script","failed to fetch dynamically","error loading dynamically"];
              var NOISE_RE=[/^script error\\.?$/i,/invalid group specifier name/i,/resizeobserver loop (completed with undelivered notifications|limit exceeded)/i,/undefined is not an object.*window\\.webkit/i];
              var NOISE_MARKERS=["error invoking postmessage","window.webkit.messagehandlers","iabjs://","navigation_performance_logger"];
              var STACK_RE=/maximum call stack|too much recursion|call stack size exceeded/i;
              function hasMarker(lower,list){for(var i=0;i<list.length;i++){if(lower.indexOf(list[i])!==-1)return true}return false}
              function isNoise(msg,stk,file,lineno,hasErr){
                var m=String(msg||"").toLowerCase(),s=String(stk||"").toLowerCase(),f=String(file||"");
                if(m){for(var i=0;i<NOISE_RE.length;i++){if(NOISE_RE[i].test(m))return true}}
                if(hasMarker(m,NOISE_MARKERS)||hasMarker(s,NOISE_MARKERS))return true;
                if(STACK_RE.test(m)||STACK_RE.test(s)){if(s.indexOf("/_next/")===-1&&f.indexOf("/_next/")===-1)return true}
                if(hasErr===false&&(lineno===undefined||lineno===0)&&!f)return true;
                return false;
              }
              function isChunk(msg,stk){return hasMarker((String(msg||"")+" "+String(stk||"")).toLowerCase(),CHUNK_MARKERS)}
              var buf=[];
              try{window.__fitupEarlyErrs=buf}catch(e){buf=[]}
              function record(kind,message,stack,filename,lineno,colno,hasErr){
                try{
                  if(window.__fitupEarlyErrsOpen===false)return;
                  if(buf.length<30)buf.push({kind:kind,message:message,stack:stack,filename:filename,lineno:lineno,colno:colno,hasErr:hasErr});
                }catch(e){}
              }
              function cancel(ev){try{if(ev.preventDefault)ev.preventDefault();else ev.returnValue=false}catch(e){}}
              window.addEventListener("error",function(ev){
                try{
                  if(!ev||!ev.message)return; /* خطای resource تگ‌ها (بدون message) → منطق retry v67 دست‌نخورده */
                  var stk=(ev.error&&ev.error.stack)?ev.error.stack:((ev.filename||"")+":"+(ev.lineno||0)+":"+(ev.colno||0));
                  if(isChunk(ev.message,stk)){cancel(ev);return}
                  if(isNoise(ev.message,stk,ev.filename,ev.lineno,!!ev.error)){try{ev.stopImmediatePropagation()}catch(e){}cancel(ev);return}
                  record("error",ev.message,stk,ev.filename,ev.lineno,ev.colno,!!ev.error);
                }catch(e){}
              },true);
              window.addEventListener("unhandledrejection",function(ev){
                try{
                  var r=ev&&ev.reason,msg=(r&&r.message)?r.message:String(r);
                  if(!msg)return;
                  var stk=(r&&r.stack)?r.stack:"";
                  if(isNoise(msg,stk,"",undefined,!!(r&&r.stack))){try{ev.stopImmediatePropagation()}catch(e){}cancel(ev);return}
                  record("rejection",msg,stk,"",undefined,undefined,!!(r&&r.stack));
                }catch(e){}
              },true);
            })();`,
          }}
        />
        {/* Microsoft Clarity — v139: لود بعد از «بارگذاری کامل صفحه» (نه در مسیر رندر).
            قبلاً اسکریپت همیشه در head تزریق می‌شد و در Lighthouse موبایل هم
            render-blocking بود (~۳۰KB + ۱۰۰ms main-thread). حالا با رویداد load +
            requestIdleCallback با تأخیر کوتاه تزریق می‌شود؛ تحلیل رفتار همیشه فعال
            می‌ماند ولی از LCP/TBT حذف می‌شود. */}
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `(function(){
              function loadClarity(){
                (function(c,l,a,r,i,t,y){
                  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                })(window, document, "clarity", "script", "xi8940h5ty");
              }
              if("requestIdleCallback" in window){
                var started=false;
                var go=function(){ if(started) return; started=true; loadClarity(); };
                window.addEventListener("load",function(){
                  setTimeout(function(){ requestIdleCallback(go,{timeout:4000}); },1200);
                },{once:true});
              } else {
                window.addEventListener("load",function(){ setTimeout(loadClarity,1800); },{once:true});
              }
            })();`,
          }}
        />
        {/* Preconnect to third-party origins for faster resource loading */}
        <link rel="preconnect" href="https://www.clarity.ms" />
        <link rel="preconnect" href="https://www.clarity.ms" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.clarity.ms" />
        {/* ── v218 — RSS autodiscovery (فید مقالات) ──
            عمداً به‌صورت تگ خام در head است نه فقط metadata.alternates.types:
            «همهٔ» صفحات عمومی alternates خودشان را (canonical) در metadata
            صفحه تعریف می‌کنند و در Next.js alternatesِ صفحه جایگزین کاملِ
            alternatesِ layout می‌شود (merge نمی‌شود) — یعنی typesِ layout
            هیچ‌وقت رندر نمی‌شد (تست curl تأیید کرد). تگ خام روی همهٔ صفحات
            قطعی است. (metadata.alternates.types به‌عنوان فال‌بک هم می‌ماند.) */}
        <link rel="alternate" type="application/rss+xml" title="مجله فیتاپ" href={`${SITE_URL}/feed.xml`} />
        {/* Preload hero image (LCP element) — v220: فرمت preload با <picture> هم‌تراز شد.
            قبلاً WebP پیش‌بار می‌شد ولی مرورگر مدرن از <picture> شاخهٔ AVIF را برمی‌داشت
            → preload دور ریخته می‌شد و AVIF دیر پیدا می‌شد (LCP کندتر + دانلود دوگانه).
            type="image/avif" → مرورگر بدون AVIF (سافاری ۱۴/۱۵) preload را رد می‌کند و
            همان شاخهٔ WebP خودش لود می‌شود. */}
        <link rel="preload" as="image" fetchPriority="high" type="image/avif" href="/hero-fitup-desktop.avif" imageSrcSet="/hero-fitup-mobile.avif 500w, /hero-fitup-680.avif 680w, /hero-fitup-desktop.avif 800w, /hero-fitup.avif 886w" imageSizes="(max-width: 768px) 90vw, (max-width: 1024px) 50vw, 600px" />
        {/* Favicon — FitUp logo with padding (full logo visible)
            ۳۲-B: همه لینک‌های آیکون به ?v=8 بمپ شدند (آیکون‌های بازتولیدشده) */}
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=8" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=8" />
        <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png?v=8" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=8" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=8" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=8" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=8" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png?v=8" />
        {/* iOS PWA — full standalone mode (no Safari chrome) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FitUp" />
        {/* v52: لینک manifest ثابت حذف شد — فقط iOS (در head script پایین) manifest می‌گیرد
            تا کروم دیگر مدال/گزینهٔ نصب وب‌اپ نشان ندهد. */}
        {/* ─── v52: اسپلش‌اسکرین‌های iOS — نصب وب‌اپ آیفون «مثل ساعت» ───
            هنگام باز شدن وب‌اپ نصب‌شده روی آیفون، به‌جای فلش سفید، صفحهٔ برند
            (لوگو روی سفید) با نوار وضعیت شفاف (black-translucent) دیده می‌شود.
            هر سایز با media query دقیق دستگاهِ هدف سرو می‌شود (iOS فقط همین
            روش را می‌فهمد — از manifest استفاده نمی‌کند). */}
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1290x2796.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)" href="/splash/2796x1290.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1284x2778.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)" href="/splash/2778x1284.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1179x2556.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)" href="/splash/2556x1179.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1170x2532.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)" href="/splash/2532x1170.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1242x2688.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)" href="/splash/2688x1242.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" href="/splash/828x1792.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" href="/splash/1792x828.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1125x2436.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)" href="/splash/2436x1125.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" href="/splash/750x1334.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" href="/splash/1334x750.png" />
        {/* Theme-color فقط از viewport export بالا ست می‌شود (#f97316) —
            متای دستی تکراری حذف شد تا دو theme-color متناقض رندر نشود. */}
        {/* NOTE: canonical در page.tsx با generateMetadata set می‌شود (داینامیک بر اساس searchParams).
            در اینجا canonical set نمی‌کنیم تا با canonical صفحه تداخل نداشته باشد. */}

        {/* ─── PWA: سرکوب UI نصب وب‌اپ کروم (v12.3 — درخواست مالک) ───
            مدال/بنر/نوتیف «نصب وب‌اپ» دیگر لازم نیست. beforeinstallprompt
            کاملاً preventDefault می‌شود تا کروم هیچ پیشنهاد نصبی (نوار آدرس،
            مودال، مینی‌بنر) نشان ندهد. مسیر رسمی نصب: اپ اندروید (APK از خود
            سایت) و وب‌اپ iOS از سافاری. نصب موفق همچنان track می‌شود تا
            نوتیف‌های نصب تکراری برای نصب‌کرده‌ها نرود. */}
        <script dangerouslySetInnerHTML={{ __html: `
          // سرکوب پیشنهاد نصب وب‌اپ کروم
          window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
          });

          // ─── v52: manifest فقط برای iOS ───
          // کروم بدون manifest سایت را «قابل نصب» نمی‌داند → نه مدال نوار آدرس،
          // نه Install app در منو، نه هیچ UI نصبی. آیفون (سافاری) manifest را
          // هنگام Add to Home Screen می‌خواند → وب‌اپ iOS دست‌نخورده و standalone
          // می‌ماند. تشخیص iOS: iPhone/iPad/iPod یا Mac با تاچ‌بار (iPadOS سافاری).
          try {
            var ua = navigator.userAgent || '';
            var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            if (isIOS) {
              var mf = document.createElement('link');
              mf.rel = 'manifest';
              mf.href = '/manifest.json';
              document.head.appendChild(mf);
            }
          } catch (e) {}

          // Track نصب موفق
          window.addEventListener('appinstalled', function(e) {
            try { localStorage.setItem('pwa_installed', '1'); } catch {}
            window.dispatchEvent(new CustomEvent('pwa-install-status'));
            try { fetch('/api/pwa/installed', { method: 'POST' }).catch(function(){}); } catch {}
          });

          // ─── SSR: تشخیص PWA standalone برای سرور ───
          // display-mode فقط سمت کلاینت قابل خواندن است؛ این کوکی به سرور
          // اعلام می‌کند که کاربر داخل اپ نصب‌شده است تا screen اولیه درست
          // حساب شود (بدون فلش لندینگ قبل از auth).
          try {
            if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
              document.cookie = 'pwa_standalone=1; path=/; max-age=31536000; samesite=lax';
            } else if (document.cookie.indexOf('pwa_standalone=1') !== -1) {
              // دیگر standalone نیست (مثلاً حذف نصب) → کوکی را پاک کن
              document.cookie = 'pwa_standalone=; path=/; max-age=0; samesite=lax';
            }
          } catch (e) {}
        `}} />

        {/* Structured Data: Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        {/* Structured Data: WebSite */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />

        {/* Server-side injection of analytics/search-console/pixel codes (head placement) */}
        <HeadCodeInjector placement="head" />
      </head>
      <body
        className={`${vazirmatn.variable} font-sans antialiased bg-background text-foreground`}
      >
        {/* Server-side injection (body_start placement) */}
        <HeadCodeInjector placement="body_start" />
        {/* PWA: register service worker + install prompt banner */}
        <PwaRegister />
        {/* v156 — سپر شبکهٔ سراسری + موتور خودترمیمی (تیکت VPN/حالت خواب) — برای همهٔ روت‌ها */}
        <NetShieldInstaller />
        {/* PWA: prevent accidental exit with back button */}
        {/* BackButtonHandler حذف شد — popstate در page.tsx مدیریت می‌شود */}
        {/* Capture client-side errors and log them for admin review */}
        <ErrorCapture />
        {/* v89 — فیکس ریشه‌ای کیبورد مرورگرهای درون‌برنامه‌ای (اینستاگرام):
            ورودی فعال (OTP/وزن هدف/…) هرگز زیر کیبورد نمی‌ماند — سراسری برای همهٔ صفحات */}
        <KeyboardFix />
        {/* v153 — رفرش فقط از یک‌چهارم بالای صفحه (رفرش بومی مرورگر/اپ با CSS+گارد نیتیو بسته شده) */}
        <PullToRefreshInstaller />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <SonnerToaster position="top-center" dir="rtl" />
          {/* Global "new terms" modal — shown when user was logged out due to
              outdated TermsVersion. Rendered via portal so it overlays any page. */}
          <GlobalNewTermsModal />
        </ThemeProvider>
        {/* Server-side injection (body_end placement) */}
        <HeadCodeInjector placement="body_end" />
      </body>
    </html>
  );
}
