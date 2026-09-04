"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Camera,
  Dumbbell,
  BookOpen,
  Briefcase,
  ExternalLink,
  Sparkles,
  Quote,
  GraduationCap,
  Images,
  Zap,
  TrendingUp,
  Palette,
  Microscope,
  UtensilsCrossed,
  FlaskConical,
  Building2,
  Award,
  Star,
  ArrowLeft,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { replaceScreen, smartNavigate } from "@/lib/fitness/navigation";
import { toPersianDigits } from "@/lib/fitness/types";

// ─── گرادیان طلایی برند فیتاپ ───
const GOLD_GRADIENT = "linear-gradient(135deg, #f59e0b, #f97316)";

// ─── تنظیمات انیمیشن اسکرول ───
const viewportOnce = { once: true, margin: "-40px" } as const;

export function AboutPage() {
  const { user, setScreen } = useAppStore();
  const [photoError, setPhotoError] = useState(false);

  function goHome() {
    setScreen("landing");
    replaceScreen("landing");
  }

  // URL را برای about تنظیم کن (برای refresh)
  useEffect(() => {
    replaceScreen("about");
  }, []);

  // ─── SEO ───
  useEffect(() => {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";
    const pageUrl = `${siteUrl}/?screen=about`;
    const title = "درباره ما | فیتاپ";
    const description =
      "آشنایی با حسین جوان — عکاس حرفه‌ای، مؤلف کتاب «عکاس جوان» و خالق فیتاپ؛ بیش از ۱۲ سال عکاسی حرفه‌ای با ۴۰۰۰+ پروژه و ۸+ سال بدنسازی، تحقیق عمیق در علم روز ورزش و تغذیه ورزشی.";
    const keywords =
      "حسین جوان، درباره ما فیتاپ، سازنده فیتاپ، عکاس جوان، کتاب عکاس جوان، فوتوگالری جوان، بدنسازی علمی، تغذیه ورزشی";
    const ogImage = `${siteUrl}/images/hossein-javan.webp`;

    document.title = title;
    setMetaTag("description", description);
    setMetaTag("keywords", keywords);
    setMetaTag("robots", "index,follow");
    setLinkTag("canonical", pageUrl);

    // ─── Preload پرترهٔ بنیان‌گذار (LCP صفحهٔ درباره ما) ───
    // عکس از همان HTML اولیه دانلود می‌شود — قبل از هر JS/چفتی که معطلش نگذارد.
    try {
      if (!document.querySelector('link[rel="preload"][href="/images/hossein-javan.webp"]')) {
        const pre = document.createElement("link");
        pre.rel = "preload";
        pre.as = "image";
        pre.href = "/images/hossein-javan.webp";
        pre.fetchPriority = "high";
        document.head.appendChild(pre);
      }
    } catch {}

    setMetaProp("og:title", title);
    setMetaProp("og:description", description);
    setMetaProp("og:type", "profile");
    setMetaProp("og:locale", "fa_IR");
    setMetaProp("og:url", pageUrl);
    setMetaProp("og:image", ogImage);
    setMetaProp("og:site_name", "فیتاپ");

    setMetaProp("twitter:card", "summary_large_image");
    setMetaProp("twitter:title", title);
    setMetaProp("twitter:description", description);
    setMetaProp("twitter:image", ogImage);

    // BreadcrumbList schema
    setJsonLd("breadcrumb-schema", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "فیتاپ", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "درباره ما", item: pageUrl },
      ],
    });

    // AboutPage + Person schema — هویت بنیان‌گذار فیتاپ
    setJsonLd("about-schema", {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      name: "درباره ما | فیتاپ",
      url: pageUrl,
      description,
      mainEntity: {
        "@type": "Person",
        name: "حسین جوان",
        alternateName: "Hossein Javan",
        jobTitle: "عکاس حرفه‌ای، مؤلف و بنیان‌گذار فیتاپ",
        description:
          "عکاس حرفه‌ای، مؤلف کتاب «عکاس جوان» و خالق فیتاپ؛ فارغ‌التحصیل دانشگاه تهران با بیش از ۴۰۰۰ پروژهٔ عکاسی و ۸ سال تجربهٔ بدنسازی و تحقیق علمی",
        url: "https://hosseinjavan.com",
        image: ogImage,
        alumniOf: { "@type": "CollegeOrUniversity", name: "دانشگاه تهران" },
        knowsAbout: [
          "عکاسی حرفه‌ای",
          "فیلم‌برداری",
          "بدنسازی",
          "علم ورزش",
          "تغذیه ورزشی",
          "برندینگ",
          "سئو و کسب‌وکار اینترنتی",
        ],
        worksFor: { "@type": "Organization", name: "فیتاپ", url: siteUrl },
      },
    });

    return () => {
      ["breadcrumb-schema", "about-schema"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      try {
        document
          .querySelectorAll('link[rel="preload"][href="/images/hossein-javan.webp"]')
          .forEach((el) => el.remove());
      } catch {}
      document.title =
        "برنامه بدنسازی آنلاین | فیتاپ — برنامه تمرینی و تغذیه با AI";
    };
  }, []);

  // ─── داده‌های صفحه ───
  // «+۸ سال بدنسازی و تحقیق» کارت اول است (درخواست مالک — ۲۰۲۶-۰۹-۰۳)
  const stats = [
    {
      icon: Dumbbell,
      value: `${toPersianDigits(8)}+`,
      label: "سال بدنسازی و تحقیق",
    },
    {
      icon: Camera,
      value: `${toPersianDigits(12)}+`,
      label: "سال عکاسی حرفه‌ای",
    },
    {
      icon: Briefcase,
      value: `${toPersianDigits("4,000")}+`,
      label: "پروژهٔ عکاسی اجراشده",
    },
    {
      icon: BookOpen,
      value: "«عکاس جوان»",
      label: "مؤلف کتاب",
      small: true,
    },
  ];

  const milestones = [
    {
      icon: GraduationCap,
      year: toPersianDigits(1393),
      title: "شروع عکاسی حرفه‌ای",
      desc: "فارغ‌التحصیل دانشگاه تهران؛ آغاز عکاسی و فیلم‌برداری حرفه‌ای و مدیریت پروژه‌های تصویری — نقطهٔ صفرِ یک مسیر حرفه‌ای.",
    },
    {
      icon: Images,
      year: "پلتفرم",
      title: "تأسیس فوتوگالری جوان و آکادمی جوان",
      desc: "ساخت پلتفرم سفارش آنلاین عکاسی؛ اجرای بیش از ۴٬۰۰۰ پروژهٔ انفرادی و ۳٬۰۰۰ پروژهٔ تیمی با ۹۹٪ رضایت مشتریان، فعال در ۲۲ رشتهٔ عکاسی و فیلم‌برداری.",
    },
    {
      icon: BookOpen,
      year: "کتاب",
      title: "انتشار کتاب «عکاس جوان»",
      desc: "روایت صادقانهٔ مسیر پر فراز و نشیب حرفه‌ای — از عشق به عکاسی تا رسیدن به جایگاهی که در ذهن داشت؛ نوشته‌ای که برای هر کسی که در مسیر سختِ موفقیت قدم می‌گذارد توصیه می‌شود.",
    },
    {
      icon: Dumbbell,
      year: `${toPersianDigits(8)}+ سال`,
      title: "بدنسازی حرفه‌ای و تحقیق عمیق",
      desc: "تمرین جدی در باشگاه + تحقیق گسترده در علم روز بدنسازی، فیزیولوژی ورزشی و تغذیهٔ ورزشی مدرن؛ از تجربهٔ شخصی تا دانش تخصصی مبتنی بر شواهد.",
    },
    {
      icon: Zap,
      year: "فیتاپ",
      title: "خلق فیتاپ",
      desc: "تلاقی هنرِ تصویر و علمِ ورزش؛ مربیِ هوشمندِ همیشه‌همراه برای هر ورزشکار ایرانی — برنامهٔ تمرینی و غذاییِ شخصی‌سازی‌شده با مربی همیشه در دسترس.",
    },
  ];

  // کارت‌های بدنسازی/ورزش اول هستند (درخواست مالک — ۲۰۲۶-۰۹-۰۳)
  const expertise = [
    {
      icon: Microscope,
      title: "علم روز بدنسازی",
      desc: "تحقیق تخصصی در تمرین و فیزیولوژی",
    },
    {
      icon: UtensilsCrossed,
      title: "تغذیه ورزشی",
      desc: "برنامه‌های غذایی مبتنی بر شواهد",
    },
    {
      icon: FlaskConical,
      title: "تحقیق و توسعه محصول",
      desc: "تبدیل تحقیق به محصول واقعی",
    },
    {
      icon: Camera,
      title: "عکاسی و فیلم‌برداری حرفه‌ای",
      desc: `${toPersianDigits("4,000")}+ پروژه در ${toPersianDigits(22)} رشته`,
    },
    {
      icon: TrendingUp,
      title: "سئو و کسب‌وکار اینترنتی",
      desc: "ساخت و رشد پلتفرم‌های پربازدید",
    },
    {
      icon: Palette,
      title: "برندینگ و هویت بصری",
      desc: "برندسازی از ایده تا اجرا",
    },
  ];

  const brands = ["دیجی‌کالا", "اسنپ‌فود", "گروه صنعتی گلرنگ", "میهن", "شهرداری تهران", "بوتان"];

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50/50 to-white">
      {/* ─── هدر چسبان ─── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={goHome}
            aria-label="بازگشت به صفحه اصلی"
            className="flex items-center gap-1 text-sm text-slate-600 hover:text-orange-600 transition"
          >
            <ChevronLeft className="w-4 h-4" />
            صفحه اصلی
          </button>
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden"
              style={{ background: GOLD_GRADIENT }}
            >
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </div>
            <span className="font-black text-sm text-slate-900">درباره ما</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* ═══════════ هرو: پرتره + معرفی ═══════════ */}
        {/* بدون انیمیشن ورود — پرتره در HTML اولیه (SSR) همان لحظه دیده می‌شود؛ */}
        {/* انیمیشن opacity قبلاً تا hydration کامل عکس را مخفی نگه می‌داشت (احساس دیر لود شدن) */}
        <motion.section
          className="relative overflow-hidden rounded-[2rem] bg-white border border-orange-100 shadow-sm"
          aria-labelledby="founder-name"
        >
          {/* نوار گرادیانی پس‌زمینهٔ پرتره */}
          <div className="relative h-32 sm:h-36" style={{ background: GOLD_GRADIENT }}>
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />
            <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/10" />
            <div className="absolute top-1/2 left-1/3 w-16 h-16 rounded-full bg-white/10" />
            <p className="absolute bottom-3 right-5 text-white/90 text-[11px] font-bold tracking-wide">
              بنیان‌گذار فیتاپ
            </p>
          </div>

          <div className="px-6 sm:px-8 pb-8 -mt-14 flex flex-col items-center text-center">
            {/* پرتره */}
            <div className="relative">
              {photoError ? (
                <div
                  className="w-40 h-52 sm:w-44 sm:h-60 rounded-3xl ring-4 ring-white shadow-2xl flex items-center justify-center"
                  style={{ background: GOLD_GRADIENT }}
                  aria-label="حسین جوان"
                >
                  <span className="text-5xl font-black text-white leading-none">حج</span>
                </div>
              ) : (
                <img
                  src="/images/hossein-javan.webp"
                  alt="حسین جوان — عکاس حرفه‌ای و سازندهٔ فیتاپ"
                  onError={() => setPhotoError(true)}
                  width={176}
                  height={228}
                  fetchPriority="high"
                  decoding="async"
                  className="w-40 h-52 sm:w-44 sm:h-60 object-cover rounded-3xl ring-4 ring-white shadow-2xl bg-orange-50"
                />
              )}
              {/* نشان تأیید */}
              <div
                className="absolute -bottom-3 -left-2 w-11 h-11 rounded-full ring-4 ring-white flex items-center justify-center shadow-lg"
                style={{ background: GOLD_GRADIENT }}
                aria-hidden="true"
              >
                <Award className="w-5 h-5 text-white" />
              </div>
            </div>

            {/* نام */}
            <h1
              id="founder-name"
              className="text-3xl sm:text-4xl font-black text-slate-900 mt-5 mb-3"
            >
              حسین جوان
            </h1>

            {/* چیپ‌های تگ‌لاین */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {[
                { icon: Camera, label: "عکاس حرفه‌ای" },
                { icon: Sparkles, label: "سازندهٔ فیتاپ و فوتوگالری جوان" },
                { icon: BookOpen, label: "نویسندهٔ کتاب «عکاس جوان»" },
              ].map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-orange-50 border border-orange-100 text-orange-700 text-xs font-bold"
                >
                  <chip.icon className="w-3.5 h-3.5" />
                  {chip.label}
                </span>
              ))}
            </div>

            {/* معرفی کوتاه */}
            <p className="text-slate-600 text-sm sm:text-[15px] leading-loose max-w-xl">
              دو دنیا من را ساخته است: <strong className="text-slate-800">هنرِ تصویر</strong> و{" "}
              <strong className="text-slate-800">علمِ ورزش</strong>. از سال{" "}
              {toPersianDigits(1393)} با دوربین و از هشت سال پیش با هالتر؛ حاصلِ این دو، فیتاپ
              است — مربیِ هوشمندی که در تمام سال‌های تمرین، آرزوی داشتنش را داشتم.
            </p>

            {/* نشان‌های رضایت */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-bold">
                <Star className="w-3.5 h-3.5" />
                {toPersianDigits(99)}٪ رضایت مشتریان
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-bold">
                <Images className="w-3.5 h-3.5" />
                فعال در {toPersianDigits(22)} رشتهٔ عکاسی
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-bold">
                <GraduationCap className="w-3.5 h-3.5" />
                فارغ‌التحصیل دانشگاه تهران
              </span>
            </div>
          </div>
        </motion.section>

        {/* ═══════════ آمار ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          aria-label="آمار حسین جوان"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewportOnce}
                transition={{ duration: 0.4, delay: i * 0.07, ease: "easeOut" }}
                className="rounded-2xl bg-white border border-orange-100 shadow-sm p-4 sm:p-5 text-center hover:shadow-md hover:-translate-y-0.5 transition"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-md"
                  style={{ background: GOLD_GRADIENT }}
                  aria-hidden="true"
                >
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                <p
                  className={`font-black text-slate-900 mb-1 ${
                    stat.small ? "text-lg leading-tight" : "text-2xl"
                  }`}
                >
                  {stat.value}
                </p>
                <p className="text-[11px] sm:text-xs text-slate-500 font-medium leading-snug">
                  {stat.label}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ═══════════ داستان فیتاپ ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="rounded-[2rem] bg-white border border-orange-100 shadow-sm overflow-hidden"
          aria-labelledby="story-title"
        >
          <div className="px-6 sm:px-8 py-6 bg-gradient-to-l from-amber-50 via-white to-white border-b border-orange-50">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-md shrink-0"
                style={{ background: GOLD_GRADIENT }}
                aria-hidden="true"
              >
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-amber-600 tracking-wide">
                  داستان فیتاپ
                </p>
                <h2 id="story-title" className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
                  چرا فیتاپ را خلق کردم؟
                </h2>
              </div>
            </div>
          </div>
          <div className="px-6 sm:px-8 py-6 sm:py-7 space-y-4 text-sm sm:text-[15px] text-slate-700 leading-loose">
            <p>
              هشت سال پیش، وقتی با جدیت وارد بدنسازی شدم، مثل خیلی‌های دیگر با برنامه‌های
              کپی‌شده و توصیه‌های شنیده‌شده در باشگاه شروع کردم. اما کنجکاوی من طاقت نیاورد؛
              شروع کردم به تحقیق — مقاله‌به‌مقاله و کتاب‌به‌کتاب — در{" "}
              <strong className="text-slate-900">علمِ تمرین، فیزیولوژی ورزشی و تغذیهٔ مدرن</strong>.
              هشت سال تمرین و تحقیقِ بی‌وقفه، امروز به ستونِ علمی فیتاپ تبدیل شده است.
            </p>
            <p>
              در این سال‌ها در باشگاه‌ها با چشمِ خودم دیدم که ورزشکارانِ باانگیزه چطور سال‌ها —
              گاهی بهترین سال‌های عمرشان — را روی{" "}
              <strong className="text-slate-900">برنامه‌های غلط و رژیم‌های کپی‌شده</strong>{" "}
              هدر می‌دهند؛ فقط به این دلیل که دسترسی به یک مربیِ آگاه، دقیق و همیشه‌در‌دسترس
              ندارند. همان‌جا تصمیمی که به ساخته‌شدن فیتاپ ختم شد، در ذهنم جا افتاد.
            </p>
            <p>
              تجربهٔ ساختن فوتوگالری جوان — پلتفرمی که بیش از{" "}
              {toPersianDigits("4,000")} پروژهٔ عکاسی را اجرا کرده و با بزرگ‌ترین برندهای
              ایران همکاری داشته — به من آموخت چطور محصولی آنلاین بسازم که برای هزاران نفر،
              بی‌نقص کار کند. فیتاپ را ساختم تا همان چیزی باشد که خودم در سال‌های تمرین
              آرزویش را داشتم:{" "}
              <strong className="text-slate-900">
                برنامهٔ تمرینی و غذاییِ شخصی‌سازی‌شده با مربی همیشه در دسترس، چکاپ‌های منظم پیشرفت و
                تحلیل عکسِ بدن، ویدیوی فرمِ حرکات و آزمایش خون
              </strong>{" "}
              — همه و همه در جیبِ هر ورزشکار ایرانی.
            </p>
          </div>
        </motion.section>

        {/* ═══════════ مسیر حرفه‌ای — تایم‌لاین ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          aria-labelledby="timeline-title"
        >
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-md shrink-0"
              style={{ background: GOLD_GRADIENT }}
              aria-hidden="true"
            >
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 id="timeline-title" className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
                مسیر حرفه‌ای
              </h2>
              <p className="text-xs text-slate-500">از دانشگاه تهران تا فیتاپ</p>
            </div>
          </div>

          <div className="relative">
            {/* خط عمودی تایم‌لاین */}
            <div
              className="absolute top-4 bottom-6 right-[27px] w-1 rounded-full bg-gradient-to-b from-amber-400 via-orange-300 to-orange-100"
              aria-hidden="true"
            />
            <div className="space-y-5">
              {milestones.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 24 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={viewportOnce}
                  transition={{ duration: 0.45, delay: i * 0.06, ease: "easeOut" }}
                  className="flex gap-4 items-start"
                >
                  {/* آیکون روی خط */}
                  <div className="relative shrink-0 z-10">
                    <div className="w-14 h-14 rounded-2xl bg-white border-2 border-orange-100 shadow-md flex items-center justify-center">
                      <m.icon className="w-6 h-6 text-orange-500" />
                    </div>
                  </div>
                  {/* کارت رویداد */}
                  <div className="flex-1 rounded-2xl bg-white border border-orange-100 shadow-sm p-4 sm:p-5 hover:shadow-md transition">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <h3 className="font-black text-slate-900 text-[15px]">{m.title}</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100 text-amber-700">
                        {m.year}
                      </span>
                    </div>
                    <p className="text-[13px] sm:text-sm text-slate-600 leading-relaxed">
                      {m.desc}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* ═══════════ کتاب «عکاس جوان» ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="rounded-[2rem] p-[2px]"
          style={{ background: GOLD_GRADIENT }}
          aria-labelledby="book-title"
        >
          <div className="rounded-[calc(2rem-2px)] bg-white px-6 sm:px-8 py-6 sm:py-7">
            <div className="flex items-start gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shrink-0"
                style={{ background: GOLD_GRADIENT }}
                aria-hidden="true"
              >
                <BookOpen className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 id="book-title" className="text-lg sm:text-xl font-black text-slate-900 mb-2 leading-tight">
                  کتاب «عکاس جوان»
                </h2>
                <p className="text-sm sm:text-[15px] text-slate-600 leading-loose">
                  حاصل سال‌ها تلاش، تجربه و عشق به عکاسی؛ داستان شکل‌گیری مسیر حرفه‌ای،
                  چالش‌هایی که پشت سر گذاشتم و تجربه‌های منحصربه‌فرد — نوشته‌ای برای
                  الهام‌بخشی به نسلِ جدید و هر کسی که در مسیرِ سختِ موفقیت قدم می‌گذارد.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-100 text-orange-700 text-[11px] font-bold">
                    <BookOpen className="w-3.5 h-3.5" />
                    زندگی‌نامه و منبع الهام
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-50 border border-orange-100 text-orange-700 text-[11px] font-bold">
                    <Star className="w-3.5 h-3.5" />
                    توصیه‌شده برای علاقه‌مندان موفقیت
                  </span>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* ═══════════ تخصص‌ها ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          aria-labelledby="expertise-title"
        >
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-md shrink-0"
              style={{ background: GOLD_GRADIENT }}
              aria-hidden="true"
            >
              <Microscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 id="expertise-title" className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
                تخصص‌ها
              </h2>
              <p className="text-xs text-slate-500">هنر، کسب‌وکار و علم ورزش — همه یک‌جا</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {expertise.map((e, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={viewportOnce}
                transition={{ duration: 0.4, delay: i * 0.05, ease: "easeOut" }}
                className="flex items-center gap-3.5 rounded-2xl bg-white border border-orange-100 shadow-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, #fff7ed, #ffedd5)" }}
                  aria-hidden="true"
                >
                  <e.icon className="w-6 h-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900 mb-0.5">{e.title}</h3>
                  <p className="text-xs text-slate-500">{e.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ═══════════ نقل‌قول ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="relative overflow-hidden rounded-[2rem] p-8 sm:p-10 text-white shadow-xl"
          style={{ background: GOLD_GRADIENT }}
          aria-label="نقل‌قول حسین جوان"
        >
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-14 -left-14 w-52 h-52 rounded-full bg-white/10" />
          <div className="relative flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mb-5" aria-hidden="true">
              <Quote className="w-6 h-6 text-white" />
            </div>
            <blockquote className="text-lg sm:text-xl font-black leading-loose mb-4 max-w-xl">
              «عکاسی به من یاد داد چطور جزئیات را ببینم؛ بدنسازی به من یاد داد چطور با صبر و
              علم، نتیجه بسازم. فیتاپ ترکیبِ همین دو درس است.»
            </blockquote>
            <p className="text-sm font-bold text-white/90">— حسین جوان</p>
            <p className="text-[11px] text-white/70 mt-1">
              ما حرفه‌ای هستیم، چون برای حرفه‌ای‌ها کار می‌کنیم.
            </p>
          </div>
        </motion.section>

        {/* ═══════════ همکاری با برندها ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="rounded-[2rem] bg-white border border-orange-100 shadow-sm px-6 sm:px-8 py-6 text-center"
          aria-labelledby="brands-title"
        >
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Building2 className="w-5 h-5 text-orange-500" />
            <h2 id="brands-title" className="text-lg font-black text-slate-900">
              افتخارِ همکاری با برندها و سازمان‌های مطرح ایران
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mb-5 leading-relaxed">
            پروژه‌های خبری، همایشی، صنعتی و تبلیغاتی برای بزرگ‌ترین شرکت‌های دولتی و خصوصی
            کشور — با {toPersianDigits(99)}٪ رضایت مشتریان.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {brands.map((b) => (
              <span
                key={b}
                className="px-4 py-2 rounded-xl bg-gradient-to-l from-amber-50 to-orange-50 border border-orange-100 text-slate-700 text-sm font-bold"
              >
                {b}
              </span>
            ))}
          </div>
        </motion.section>

        {/* ═══════════ CTA ═══════════ */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="relative overflow-hidden rounded-[2rem] p-8 sm:p-10 text-center text-white shadow-2xl"
          style={{ background: "linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ea580c 100%)" }}
          aria-labelledby="cta-title"
        >
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-white/10" />
          <div className="relative">
            <h2 id="cta-title" className="text-2xl sm:text-3xl font-black mb-3">
              حالا نوبتِ توست
            </h2>
            <p className="text-sm sm:text-base text-white/95 max-w-xl mx-auto mb-7 leading-relaxed">
              اگر من با عشق و علم از عکاسِ جوانِ همان سال‌ها به اینجا رسیدم، تو هم می‌توانی.
              با فیتاپ، مربیِ علمیِ همیشه‌همراهت همیشه همراهت است — هر بدنی فیتاپ میخواد!
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => smartNavigate(!!user, setScreen, user?.onboardingDone)}
                className="bg-white text-orange-600 hover:bg-white/90 rounded-2xl px-8 py-3.5 text-base font-black shadow-xl transition hover:scale-[1.02] flex items-center justify-center gap-2 min-h-[52px]"
              >
                <Dumbbell className="w-5 h-5" />
                با فیتاپ تمرین کن
                <ArrowLeft className="w-5 h-5" />
              </button>
              <a
                href="https://hosseinjavan.com"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/15 backdrop-blur hover:bg-white/25 text-white border border-white/30 rounded-2xl px-8 py-3.5 text-base font-black transition hover:scale-[1.02] flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                سایت فوتوگالری جوان
                <ExternalLink className="w-4 h-4 opacity-70" />
              </a>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-7 text-xs text-white/95">
              <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
                <Star className="w-3.5 h-3.5" />
                ثبت‌نام در ۳۰ ثانیه
              </span>
              <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
                <Sparkles className="w-3.5 h-3.5" />
                برنامهٔ کاملاً شخصی‌سازی‌شده
              </span>
              <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full">
                <Zap className="w-3.5 h-3.5" />
                تحلیل هوشمند عکس و ویدیو
              </span>
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}

// ─── SEO helper functions ───
function setMetaTag(name: string, content: string) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaProp(prop: string, content: string) {
  if (!content) return;
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", prop);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLinkTag(rel: string, href: string) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setJsonLd(id: string, data: Record<string, unknown>) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.type = "application/ld+json";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}
