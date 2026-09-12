"use client";

/**
 * مرکز راهنمای پنل فیتاپ (Task 3-c)
 *
 * HelpDialog — دیالوگ راهنمای «همین منویی که کاربر داخلش است»:
 *  - محتوای هر تب بر اساس خواندن واقعی فایل‌های views نوشته شده (نه متن عمومی)
 *    تا راهنما دقیقاً همان چیزهایی را توضیح دهد که صفحه واقعاً دارد.
 *  - هدر تیره گرادیانی (هم‌خانواده کارت‌های پرمیوم پنل)، بدنه اسکرول‌شونده با
 *    اسکرول‌بار سفارشی، RTL کامل، بستن با ESC/کلیک بیرون (خود Radix Dialog).
 *  - فوتر فقط یک دکمه دارد: «تور راهنما را دوباره اجرا کن» → تور راهنمای
 *    ورود اول (panel-tour.tsx) از نو اجرا می‌شود (رویداد window بدون zustand).
 */

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Apple,
  Bell,
  X,
  CalendarDays,
  Camera,
  CheckCircle2,
  Crown,
  Dumbbell,
  Droplets,
  Flame,
  Gift,
  HelpCircle,
  Hourglass,
  Images,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Mic,
  Play,
  RefreshCw,
  RotateCcw,
  Salad,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Video,
  Wallet,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";
import type { MainTab } from "@/lib/fitness/store";
import { isFitUpBazaarApp } from "@/lib/fitness/bazaar-bridge";
import { replayFitupTour } from "./panel-tour";

/* ─────────────────────────── مدل محتوا ─────────────────────────── */

export interface HelpSection {
  icon: LucideIcon;
  title: string;
  body: string;
}

interface TabHelp {
  tagline: string;
  sections: HelpSection[];
}

const TAB_LABELS: Record<MainTab, string> = {
  dashboard: "داشبورد",
  programs: "برنامه‌ها",
  workouts: "تمرین‌ها",
  nutrition: "دستیار تغذیه",
  progress: "پیشرفت",
  chat: "چت با فیتاپ",
  referral: "معرفی به دوست",
  support: "پشتیبانی",
  mobileapp: "اپ موبایل",
  plans: "پلن‌ها",
};

/* آیکون بزرگ هدر هر تب — همان آیکون منوی همان تب */
const TAB_ICONS: Record<MainTab, LucideIcon> = {
  dashboard: LayoutDashboard,
  programs: ListChecks,
  workouts: Dumbbell,
  nutrition: Salad,
  progress: TrendingUp,
  chat: MessageCircle,
  referral: Gift,
  support: LifeBuoy,
  mobileapp: Smartphone,
  plans: Crown,
};

/* ─────────────────────── محتوای راهنمای هر تب ───────────────────────
   هر بخش با فایل واقعی view تطبیق داده شده:
   - dashboard-view: PlanProgressCard + باکس «برنامه شما» (۳ دکمه) + بنر
     آنبوردینگ + PrerequisitesBanner + PriorityActionCard + ProgramStatusBanner
   - programs-view: دو تب تمرین/غذا + آکاردئون روزها + ویدیو + جایگزین‌ها + مکمل
   - workouts-view: نوار روزها + startSession + حالت باشگاه (overlay پرمیوم)
   - nutrition-view: وضعیت کالری + آپلود عکس غذا + بانک غذا (autocomplete)
     + غذاهای جایگزین + آب روزانه (نمایش هدف از برنامه غذایی)
   - progress-view: گالری ۳ زاویه + تحلیل هوشمند عکس‌ها + نمودار چکاپ‌ها + تحلیل جامع
   - smart-coach/nika chat: مربی هوشمند + پیام صوتی + عکس/ویدیو (گیت پلن) + نیکا
   - referral-view: لینک معرف + پاداش دوطرفه → کیف پول + آمار
   - support-view: FAQ + تیکت + پیامک پاسخ (قالب ۹۴۲۷۶۳) + reopen تیکت بسته
   - plans-view: ۴ پلن ۴۵ روزه + ارتقا + تمدید با کد تخفیف + کیف پول/زرین‌پال
   - mobile-app-view: APK اندروید + وب‌اپ iOS + اعلان‌ها (در اپ نیتیو پنهان) ── */

const HELP_CONTENT: Record<MainTab, TabHelp> = {
  dashboard: {
    tagline: "مرکز کنترل مسیر فیتنس تو — همه‌چیز از همین‌جا شروع می‌شود",
    sections: [
      {
        icon: Crown,
        title: "کارت پیشرفت پلن",
        body: "نام پلن، تاریخ و روزهای باقی‌مانده اشتراکت را یک‌جا می‌بینی؛ وضعیت دوره همیشه بالای داشبورد جلوی چشم توست.",
      },
      {
        icon: Flame,
        title: "برنامه شما — سه دکمه سریع",
        body: "«مشاهده برنامه»، «تمرین امروز» (آماده اجرا یا استراحت و ریکاوری) و «حالت باشگاه» (ویژه پلن پیشرفته و حرفه‌ای). با یک لمس به هرکدام می‌ری.",
      },
      {
        icon: ListChecks,
        title: "آنبوردینگ و پیش‌نیازها",
        body: "اگر پروفایلت کامل نیست، جعبه «تکمیل آنبوردینگ» می‌بینی. دارندگان پلن حرفه‌ای هم بنر پیش‌نیازها را همین بالا دارند — از جمله «آنالیز ویدیوی فرم بدن»: ویدیوی فرم بدن‌ات را می‌فرستی تا برنامه بدنسازی دقیقاً بر اساس بدنت طراحی شود. (آنالیز فرم حرکات جای دیگری است — در چت با فیتاپ انجام می‌شود.)",
      },
      {
        icon: Bell,
        title: "یادآورهای مهم",
        body: "اگر اشتراکت نزدیک انقضاست یا برنامه‌ات هنوز در حال ساخته‌شدن است (بنر «برنامه شما در حال طراحی است ⏳»)، همین‌جا با کارت اقدام مهم بهت یادآوری می‌شود.",
      },
    ],
  },

  programs: {
    tagline: "برنامه تمرینی و غذایی اختصاصی، ساخته‌شده برای بدن تو",
    sections: [
      {
        icon: Dumbbell,
        title: "دو برنامه، دو تب",
        body: "بالای صفحه بین «برنامه تمرینی» و «برنامه غذایی» سوئیچ می‌کنی؛ هر دو با هوش مصنوعی و بر اساس اطلاعات آنبوردینگ تو طراحی شده‌اند.",
      },
      {
        icon: CalendarDays,
        title: "آکاردئون روزهای تمرین",
        body: "روی هر روز کلیک کن تا حرکاتش باز شود. برای هر حرکت توضیح اجرا و ویدیوی آموزشی گذاشته‌ایم — روی اسم حرکت بزن تا باز شود.",
      },
      {
        icon: Salad,
        title: "برنامه غذایی وعده‌به‌وعده",
        body: "صبحانه، ناهار، شام و میان‌وعده با کالری و درشت‌مغذی هر غذا نوشته شده؛ برای هر وعده «غذاهای جایگزین» هم پیشنهاد شده تا بتوانی غذایش را عوض کنی. آبِ روزانه‌ات هم پایین برنامه نوشته شده.",
      },
      {
        icon: Sparkles,
        title: "مکمل‌های لازم",
        body: "فهرست مکمل‌های پیشنهادی با دوز ایمن، دلیل تجویز و جایگزین غذایی‌شان — اولویت همیشه با غذای واقعی است و لازم نیست همه را بخری.",
      },
      {
        icon: Hourglass,
        title: "دوره ۴۵ روزه",
        body: "نوار پیشرفت دوره، تعداد روز تمرین و کالری هدف روزانه را بالای صفحه می‌بینی. اگر برنامه‌ات هنوز آماده نشده، همین صفحه وضعیت تولید را بهت نشان می‌دهد.",
      },
    ],
  },

  workouts: {
    tagline: "تمرین امروزت را با فیتاپ اجرا کن",
    sections: [
      {
        icon: CalendarDays,
        title: "چک‌لیست تمرین امروز",
        body: "نوار روزهای هفته بالای صفحه است و روزِ امروز خودکار انتخاب می‌شود؛ حرکات با گروه عضلانی، ست و تکرار آماده‌اند. اگر امروز استراحت است، کارت ویژه «روز استراحت» می‌بینی و می‌توانی روزهای دیگر را مرور کنی.",
      },
      {
        icon: Play,
        title: "شروع تمرین (حالت فعال)",
        body: "دکمه «شروع تمرین (حالت فعال)» یک جلسه تمام‌صفحه می‌سازد: برای هر ست، وزنه و تکرار واقعی‌ات را ثبت می‌کنی، تایمر استراحت خودکار می‌آید و آخر تمرین تبریک با آمار جلسه (ست‌ها و کالری سوزانده) می‌بینی. اگر وسط تمرین اپ را ببندی، جلسه تا ۲۴ ساعت نگه داشته می‌شود.",
      },
      {
        icon: Dumbbell,
        title: "حالت باشگاه (پرمیوم)",
        body: "برای وقتی که زیر وزنه‌ای: چک‌لیست سریع گروه‌ها و سوپرست‌ها با تیک زدن و استراحت‌های نوشته‌شده، در یک صفحه بزرگ و خوانا. ویژه پلن پیشرفته و حرفه‌ای است.",
      },
      {
        icon: Video,
        title: "ویدیو و جزئیات حرکت",
        body: "روی هر حرکت بزن تا ویدیوی آموزشی و نکات فرم صحیح را ببینی — قبل از اجرا یک نگاه بینداز تا حرکت را درست بزنی.",
      },
    ],
  },

  nutrition: {
    tagline: "کالری‌شمار و دستیار تغذیه — ثبت ساده، نتیجه دقیق",
    sections: [
      {
        icon: Flame,
        title: "وضعیت کالری امروز",
        body: "کالری خورده، سوزانده (خودکار از جلسه تمرین) و باقی‌مانده امروز را با نوار پیشرفت می‌بینی؛ وقتی به هدفت برسی، خودش بهت تبریک می‌گوید.",
      },
      {
        icon: Camera,
        title: "ثبت غذا با عکس",
        body: "عکس غذات را آپلود کن؛ هوش مصنوعی کالری و درشت‌مغذی‌ها را تشخیص می‌دهد و بعد انتخاب می‌کنی به کدام وعده (صبحانه/ناهار/شام/میان‌وعده) اضافه شود.",
      },
      {
        icon: Search,
        title: "بانک غذاها",
        body: "می‌توانی از بانک غذای فیتاپ جستجو کنی (هم‌تیپ کن، پیشنهادها می‌آیند) یا دستی وارد کنی؛ تعداد وعده (ضریب) را هم تعیین می‌کنی تا کالری دقیق حساب شود.",
      },
      {
        icon: RefreshCw,
        title: "تعویض غذا با دستیار هوشمند",
        body: "در برنامه غذایی، هر وعده «غذاهای جایگزین» دارد؛ یکی را انتخاب کن و همان کالری را با غذایی که دلت می‌خواهد بخور — بدون خداحافظی با هدف.",
      },
      {
        icon: Droplets,
        title: "آب روزانه",
        body: "مقدار آب پیشنهادی برنامه‌ات (لیتر) پایین برنامه غذایی نوشته شده؛ روزی که آب کافی نخوری، بقیه تلاش‌هایت هم کم‌اثر می‌شود!",
      },
    ],
  },

  progress: {
    tagline: "تغییرات واقعی بدنت را با داده ببین",
    sections: [
      {
        icon: Images,
        title: "گالری عکس پیشرفت",
        body: "هر چند وقت یک‌بار از بدنت در ۳ زاویه (جلو، بغل، پشت) عکس بگیر و با دکمه «افزودن عکس» آپلود کن؛ تب زاویه هم فیلتر گالری است هم مقصد آپلود. تغییراتی که در آینه نمی‌بینی، در عکس‌ها واضح می‌شوند.",
      },
      {
        icon: Sparkles,
        title: "مقایسه هوشمند عکس‌ها",
        body: "فیتاپ عکس‌های تو را با هم مقایسه می‌کند و نقاط پیشرفت و بهبود را مشخص می‌کند (۳ بار در طول اشتراک). دکمه تحلیل وقتی حداقل ۲ عکس داشته باشی فعال می‌شود.",
      },
      {
        icon: TrendingUp,
        title: "چکاپ و نمودارها",
        body: "با ثبت چکاپ‌های دوره‌ای (وزن و درصد چربی)، نمودار پیشرفت رسم می‌شود — ویژه پلن استاندارد و بالاتر. آمار وزن فعلی، وزن عضلانی و کاهش وزن هم همین‌جاست.",
      },
      {
        icon: Lightbulb,
        title: "تحلیل جامع هوش مصنوعی",
        body: "هوش مصنوعی پروفایل، چکاپ‌ها، وزن‌ها و عکس‌هایت را کنار هم می‌گذارد و یک گزارش کامل پیشرفت با نقاط قوت و توصیه‌های اختصاصی برایت می‌نویسد.",
      },
    ],
  },

  chat: {
    tagline: "مربی هوشمند فیتاپ — شبانه‌روزی، با پرونده کامل تو",
    sections: [
      {
        icon: MessageCircle,
        title: "چت با مربی هوشمند",
        body: "هر سوال فنی ورزشی یا تغذیه‌ای داری بپرس؛ مربی به پرونده کامل تو (آنبوردینگ، برنامه، پیشرفت) دسترسی دارد و شخصی — نه کلی — جواب می‌دهد.",
      },
      {
        icon: Mic,
        title: "پیام صوتی",
        body: "دکمه میکروفون را بزن و حرفت را بگو؛ صدای تو به متن تبدیل می‌شود و مربی جواب می‌دهد. جواب را هم می‌توانی با دکمه «گوش دادن» بشنوی.",
      },
      {
        icon: Camera,
        title: "آنالیز فرم حرکات — اینجاست",
        body: "با دکمه + می‌توانی عکس و ویدیو بفرستی. ویدیوی اجرای حرکتت را بفرست تا آنالیز فرم حرکات انجام شود — یعنی فیتاپ فرم تنت را بررسی و اصلاح می‌کند (ویدیو ویژه پلن حرفه‌ای است؛ اگر قفل بود، پیام ارتقا می‌بینی). ⚠️ نکته: «آنالیز ویدیوی فرم بدن» (برای طراحی برنامه بر اساس بدنت) جای دیگری است — از پیش‌نیازهای داشبورد انجام می‌شود.",
      },
      {
        icon: MessageSquare,
        title: "چت نیکا",
        body: "نیکا دستیار فروش و راهنمای فیتاپ است؛ هر سوال درباره پلن‌ها، امکانات و تخفیف‌ها داری از او بپرس. اگر دسترسی مربی نداشته باشی، خود صفحه دکمه «رفتن به چت نیکا» را نشانت می‌دهد.",
      },
      {
        icon: Trash2,
        title: "شروع تازه",
        body: "با دکمه حذف، گفتگو را پاک کن و از صفر شروع کن — گفتگوی قبلی در تاریخچه نمی‌ماند.",
      },
    ],
  },

  referral: {
    tagline: "فیتاپ را به دوستانت معرفی کن — هر دو پاداش بگیرید",
    sections: [
      {
        icon: Gift,
        title: "لینک معرف اختصاصی تو",
        body: "لینکت را با دکمه کپی بردار یا با اشتراک‌گذاری مستقیم (واتساپ/تلگرام و…) بفرست؛ یک متن آماده فارسی هم کنار لینک برایت نوشته شده.",
      },
      {
        icon: TrendingUp,
        title: "پاداش دوطرفه",
        body: "وقتی دوستت با لینک تو ثبت‌نام کند و اولین پلن را بخرد، هر دوی شما مبلغ پاداش نقدی می‌گیرید — هم تو، هم او.",
      },
      {
        icon: Wallet,
        title: "شارژ کیف پول",
        body: "پاداش‌ها مستقیم به کیف پولت شارژ می‌شوند و موقع خرید یا تمدید پلن بعدی قابل استفاده‌اند. موجودی کیف پول را در پروفایل و منوی موبایل می‌بینی.",
      },
      {
        icon: CheckCircle2,
        title: "آمار معرفی‌ها",
        body: "کل معرفی‌ها، تعداد موفق و پاداش کل‌ات را بالا صفحه می‌بینی؛ وضعیت هر دوست (در انتظار خرید / خرید کرده) هم مشخص است.",
      },
    ],
  },

  support: {
    tagline: "سوالات متداول و تیکت پشتیبانی — ما پای پاسخیم",
    sections: [
      {
        icon: HelpCircle,
        title: "سوالات متداول",
        body: "پاسخ پرتکرارترین سوال‌ها (ثبت‌نام، قیمت پلن‌ها، پیامک تأیید و…) با جستجو همین‌جاست؛ اول اینجا نگاه کن، معمولاً سریع‌تر جوابت را پیدا می‌کنی.",
      },
      {
        icon: LifeBuoy,
        title: "ثبت تیکت",
        body: "اگر جواب را پیدا نکردی، دکمه «تیکت جدید» را بزن؛ موضوع و توضیح را بنویس و ثبت کن. تیکت‌های قبلی‌ات با وضعیت‌شان (پاسخ داده شده، بسته و…) زیر همین صفحه لیست می‌شوند.",
      },
      {
        icon: Bell,
        title: "پاسخ با پیامک",
        body: "به‌محض اینکه پشتیبانی به تیکتت جواب بدهد، پیامک اطلاع‌رسانی برایت فرستاده می‌شود — پس نگران گم‌شدن پاسخ نباش.",
      },
      {
        icon: MessageSquare,
        title: "گفتگو ادامه دارد",
        body: "پاسخ خودت را داخل همان تیکت بنویس تا گفتگو ادامه پیدا کند؛ حتی تیکت بسته‌شده هم با فرستادن یک پاسخ دوباره برای تیم پشتیبانی باز می‌شود.",
      },
    ],
  },

  mobileapp: {
    tagline: "فیتاپ روی گوشی تو — سریع‌تر و راحت‌تر",
    sections: [
      {
        icon: Smartphone,
        title: "اپ اندروید اختصاصی",
        body: "APK رسمی فیتاپ را مستقیم از خود سایت دانلود کن؛ کارت دانلود همیشه آخرین نسخه و حجم را از سرور می‌گیرد. راهنمای نصب هم همان‌جا قدم‌به‌قدم نوشته شده.",
      },
      {
        icon: Apple,
        title: "وب‌اپ iOS",
        body: "کاربر آیفون: در سافاری گزینه «Add to Home Screen» را بزن تا فیتاپ مثل یک اپ واقعی روی صفحه اصلی‌ات نصب شود — مراحل در کارت راهنمای iOS آمده.",
      },
      {
        icon: Bell,
        title: "اعلان‌های iOS",
        body: "بعد از نصب وب‌اپ، اجازه نوتیفیکیشن را بده تا یادآوری‌های تمرین و پیام‌های مهم را از دست ندهی؛ فعال‌سازی‌اش هم راهنما دارد.",
      },
      {
        icon: Lightbulb,
        title: "نکته",
        body: "اگر الان داخل خود اپ اندروید باشی، این تب اصلاً بهت نشان داده نمی‌شود — چون دیگر بهش نیازی نداری!",
      },
    ],
  },

  plans: {
    tagline: "پلن مناسب بدنت را انتخاب یا تمدید کن",
    sections: [
      {
        icon: Crown,
        title: "چهار پلن ۴۵ روزه",
        body: "اقتصادی، استاندارد، پیشرفته و حرفه‌ای — همه ۴۵ روزه. کارت هر پلن قیمت و قابلیت‌هایش را نشان می‌دهد و علامت (i) کنار هر قابلیت توضیح دقیق‌ترش را باز می‌کند تا راحت مقایسه کنی.",
      },
      {
        icon: TrendingUp,
        title: "انتخاب یا ارتقا",
        body: "اگر پلن فعالی نداری، دکمه‌ها «انتخاب پلن» است؛ اگر پلن داری، فقط ارتقا به پلن‌های بالاتر را می‌بینی و پلن پایین‌تر از تو پنهان می‌شود.",
      },
      {
        icon: RefreshCw,
        title: "تمدید با کد تخفیف",
        body: "نزدیک انقضا (یا بعدش) بنر تمدید با «کد تخفیف اختصاصی تمدید» بهت نشان داده می‌شود؛ صفحه تمدید آمار دوره گذشته و مزایا را هم قشنگ نشان می‌دهد.",
      },
      {
        icon: Wallet,
        title: "پرداخت با کیف پول یا زرین‌پال",
        body: "در مودال خرید می‌توانی موجودی کیف پولت (پاداش معرفی دوستان) را به‌کار بگیری یا با درگاه امن زرین‌پال پرداخت کنی.",
      },
      {
        icon: CheckCircle2,
        title: "وضعیت اشتراک",
        body: "وضعیت فعلی‌ات — فعال تا کدام تاریخ، منقضی یا بدون پلن — بالای همین صفحه نوشته شده تا همیشه بدانی کجای دوره‌ای.",
      },
    ],
  },
};

/* ─────────────── حالت fallback: تب ناشناخته → مرور کلی منوها ─────────────── */

const OVERVIEW_ITEMS: HelpSection[] = [
  { icon: LayoutDashboard, title: "داشبورد", body: "کارت پیشرفت پلن، برنامه امروز و دسترسی سریع به همه‌چیز." },
  { icon: ListChecks, title: "برنامه‌ها", body: "برنامه تمرینی و غذایی اختصاصی با روزها، ویدیوها و غذاهای جایگزین." },
  { icon: Dumbbell, title: "تمرین‌ها", body: "چک‌لیست تمرین امروز، شروع تمرین فعال و حالت باشگاه." },
  { icon: Salad, title: "دستیار تغذیه", body: "ثبت غذای امروز با عکس، کالری‌شمار و تعویض غذا با دستیار هوشمند." },
  { icon: TrendingUp, title: "پیشرفت", body: "عکس‌های پیشرفت، چکاپ وزن و نمودارها + تحلیل جامع هوش مصنوعی." },
  { icon: MessageCircle, title: "چت با فیتاپ", body: "مربی هوشمند شبانه‌روزی با پیام صوتی، عکس و ویدیو." },
  { icon: Gift, title: "معرفی به دوست", body: "لینک معرف اختصاصی + پاداش نقدی دوطرفه در کیف پول." },
  { icon: LifeBuoy, title: "پشتیبانی", body: "سوالات متداول و تیکت با اطلاع‌رسانی پیامکی." },
  { icon: Smartphone, title: "اپ موبایل", body: "دانلود اپ اندروید و راهنمای وب‌اپ iOS." },
  { icon: Crown, title: "پلن‌ها", body: "مقایسه و خرید پلن‌های ۴۵ روزه، تمدید با کد تخفیف و کیف پول." },
];

/* ─────────────────────────── کامپوننت ─────────────────────────── */

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** تب فعلی پنل — راهنما بر اساس آن ساخته می‌شود */
  tab: MainTab;
  /** اجرای دوباره تور راهنمای ورود اول (panel-tour) */
  onReplayTour: () => void;
}

export function HelpDialog({ open, onOpenChange, tab, onReplayTour }: HelpDialogProps) {
  const content = HELP_CONTENT[tab] ?? null;
  // v51 (قانون بازار): در اپ کافه‌بازار آیتم «اپ موبایل» از راهنمای کلی هم حذف می‌شود
  const overviewItems =
    typeof window !== "undefined" && isFitUpBazaarApp()
      ? OVERVIEW_ITEMS.filter((s) => s.title !== "اپ موبایل")
      : OVERVIEW_ITEMS;
  const sections = content ? content.sections : overviewItems;
  const title = content ? TAB_LABELS[tab] : "پنل فیتاپ";
  const tagline = content ? content.tagline : "راهنمای سریع همه منوهای پنل";
  const TabIcon = content ? TAB_ICONS[tab] : HelpCircle;

  // بستن دیالوگ با ESC وقتی خود دیالوگ فوکوس ندارد هم کار کند (Radix خودش
  // روی فوکوس داخل دیالوگ ESC را می‌گیرد؛ این گارد اضافه برای اطمینان است)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        showCloseButton={false}
        className="w-full max-w-[calc(100%-2rem)] sm:max-w-lg p-0 gap-0 overflow-hidden rounded-2xl sm:rounded-3xl"
      >
        {/* ─── هدر تیره گرادیانی — هم‌خانواده کارت‌های پرمیوم پنل ─── */}
        <div
          className="relative px-5 py-4 sm:px-6 sm:py-5"
          style={{
            background: "linear-gradient(140deg, #292524 0%, #1c1917 55%, #0c0a09 100%)",
          }}
        >
          {/* هاله گرم پس‌زمینه */}
          <div
            aria-hidden
            className="absolute -top-10 -left-10 w-36 h-36 rounded-full opacity-25 blur-3xl pointer-events-none"
            style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 70%)" }}
          />
          <div className="relative flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <TabIcon className="w-5.5 h-5.5 text-white" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg font-black text-amber-50 leading-tight">
                راهنمای {title}
              </DialogTitle>
              <DialogDescription className="text-[11px] sm:text-xs text-amber-200/70 mt-0.5 leading-relaxed">
                {tagline}
              </DialogDescription>
            </div>
            {/* دکمه بستن — گوشه چپ (RTL) */}
            <button
              onClick={() => onOpenChange(false)}
              className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-amber-100/70 hover:text-white hover:bg-white/10 transition"
              aria-label="بستن راهنما"
              title="بستن (ESC)"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* ─── بدنه اسکرول‌شونده ─── */}
        <div className="max-h-[52vh] sm:max-h-[55vh] overflow-y-auto custom-scrollbar bg-white">
          <div className="p-4 sm:p-5 space-y-3">
            {sections.map((s, i) => (
              <div
                key={`${tab}-${i}`}
                className="flex items-start gap-3 rounded-2xl border border-orange-100 bg-gradient-to-l from-orange-50/60 to-white p-3 sm:p-3.5"
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-100/70 text-amber-600">
                  <s.icon className="w-4.5 h-4.5" strokeWidth={2.2} />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-black text-[13px] sm:text-sm text-slate-900 leading-snug">{s.title}</h4>
                  <p className="text-[11.5px] sm:text-xs text-slate-600 leading-relaxed mt-1">{s.body}</p>
                </div>
              </div>
            ))}

            {/* نکته پایانی صمیمی */}
            <div className="flex items-center gap-2 pt-1 px-1 text-[11px] text-slate-400">
              <Lightbulb className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>هر وقت یادت رفت، دکمه «راهنما» بالای صفحه کنار زنگ اعلان‌ها همین راهنما را برایت باز می‌کند.</span>
            </div>
          </div>
        </div>

        {/* ─── فوتر: فقط دکمه اجرای دوباره تور ─── */}
        <div className="border-t border-orange-100 bg-orange-50/40 px-4 sm:px-5 py-3">
          <button
            onClick={() => {
              // دیالوگ بسته شود و تور راهنما از اول اجرا شود
              onOpenChange(false);
              onReplayTour();
            }}
            className="w-full min-h-[44px] rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-orange-500/25 hover:shadow-lg hover:brightness-105 active:scale-[0.99] transition"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            aria-label="اجرای دوباره تور راهنمای پنل"
          >
            <RotateCcw className="w-4 h-4" />
            تور راهنما را دوباره اجرا کن
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
