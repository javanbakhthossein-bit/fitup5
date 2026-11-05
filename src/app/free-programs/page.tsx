import type { Metadata } from "next";
import { NikaWidget } from "@/components/fitness/nika-widget";

import Link from "next/link";
import {
  ChevronLeft,
  Crown,
  Download,
  Dumbbell,
  Flame,
  Home,
  ImageDown,
  ListChecks,
  Calculator,
  Apple,
  Newspaper,
  ShieldCheck,
  Sparkles,
  UserCheck,
  VenusAndMars,
  Lightbulb,
  ClipboardList,
} from "lucide-react";
import { toPersianDigits } from "@/lib/fitness/types";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { FreeProgramsClient } from "./free-programs-client";
import {
  FREE_GOAL_LABELS,
  FREE_GOAL_META,
  FREE_GENDER_LABELS,
  FREE_DAYS_LABELS,
  FREE_PROGRAMS,
  FREE_PROGRAMS_FAQ,
  type FreeGoal,
} from "@/lib/fitness/free-programs-data";

/**
 * ─── v247-free-programs — «برنامه‌های بدنسازی رایگان» (/free-programs) ───
 *
 * قیف جذب اصلی سایت: یک صفحهٔ SSR سئو-غنی که همهٔ خوشه‌های کلیدواژهٔ برنامه‌های
 * رایگان (حجم / چربی‌سوزی / باسن / خانه × مردان / زنان × ۳/۴/۵/۶ روزه) را
 * پوشش می‌دهد + ابزار تعاملی انتخاب برنامه با دانلود عکس (کلاینت).
 *
 * ساختار (الگوی /exercises و /tdee):
 *  ToolsNav (active="tool-free-programs") → بردکرامب → هیرو تصویری تیره →
 *  انتخاب‌گر/نمایش‌گر کلاینت → سکشن اعتماد → چهار سکشن هدف با تصویر و پاراگراف
 *  سئو + کارت برنامه‌ها → CTA → لینک‌های داخلی → FAQ (هم‌محتوا با JSON-LD).
 *
 * JSON-LD: FAQPage + ItemList (۳۲ برنامه) + BreadcrumbList.
 * CTAها: /?screen=auth (همان ورودی آنبوردینگ CTAهای لندینگ) و /#pricing
 * (سکشن پلن‌های صفحهٔ اصلی — دیرکتیو مالک v247: «مشاهدهٔ پلن‌ها» باید دقیقاً
 * به قسمت پلن‌های صفحهٔ اصلی برود).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

// محتوای ایستا و کیوریت‌شده — هر ساعت بازاعتبار (الگوی /foods)
export const revalidate = 3600;

export const metadata: Metadata = {
  title: {
    absolute:
      "برنامه بدنسازی رایگان | برنامه افزایش حجم و چربی سوزی رایگان — فیتاپ",
  },
  description:
    "برنامه بدنسازی رایگان و کامل برای مردان و زنان: برنامه افزایش حجم رایگان، برنامه عضله سازی رایگان، برنامه چربی سوزی رایگان، برنامه سه روزه و چهار روزه حجم، برنامه پنج روزه و شش روزه تمرین، برنامه باسن رایگان و برنامه بدنسازی در خانه بدون وسیله — با ست، تکرار و استراحت دقیق هر حرکت + دانلود عکس برنامه، بدون ثبت‌نام.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/free-programs` },
  openGraph: {
    title:
      "برنامه بدنسازی رایگان | برنامه افزایش حجم و چربی سوزی رایگان — فیتاپ",
    description:
      "۳۲ برنامه بدنسازی رایگان کیوریت‌شده: افزایش حجم، چربی‌سوزی، باسن و تمرین در خانه — برای مردان و زنان، ۳ و ۴ و ۵ و ۶ روزه با دانلود عکس برنامه. بدون ثبت‌نام.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/free-programs`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/og/og-default.png`, width: 1200, height: 630, alt: "برنامه‌های بدنسازی رایگان فیتاپ" }],
  },
};

// ترتیب ثابت سکشن‌های هدف
const GOAL_ORDER: FreeGoal[] = ["muscle-gain", "glutes", "fat-loss", "home"];

// v250 — آیکون هر هدف در سکشن ایندکس «همهٔ برنامه‌ها در یک نگاه»
const GOAL_INDEX_ICONS: Record<FreeGoal, typeof Dumbbell> = {
  "muscle-gain": Dumbbell,
  "fat-loss": Flame,
  glutes: Sparkles,
  home: Home,
};

const programsByGoal = (goal: FreeGoal) => FREE_PROGRAMS.filter((p) => p.goal === goal);

export default function FreeProgramsPage() {
  const totalPrograms = FREE_PROGRAMS.length;

  // ─── JSON-LD (الگوی /exercises) ───
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FREE_PROGRAMS_FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "برنامه‌های بدنسازی رایگان فیتاپ",
      description: `۳۲ برنامه تمرینی رایگان کیوریت‌شده: افزایش حجم، چربی‌سوزی، فرم‌دهی باسن و تناسب اندام در خانه — برای مردان و زنان، ۳ و ۴ و ۵ و ۶ روزه`,
      numberOfItems: totalPrograms,
      itemListElement: FREE_PROGRAMS.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: p.title,
        url: `${SITE_URL}/free-programs#p=${p.id}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "ابزارهای رایگان", item: `${SITE_URL}/#tools` },
        { "@type": "ListItem", position: 3, name: "برنامه‌های رایگان", item: `${SITE_URL}/free-programs` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* v246 — نوار واحد ابزارهای رایگان (هماهنگ با /tdee و /exercises و /foods) */}
      <ToolsNav active="tool-free-programs" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24 pb-20 md:pb-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 w-full">
          {/* Breadcrumb */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <Link href="/#tools" className="hover:text-orange-600 transition">
              ابزارهای رایگان
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600">برنامه‌های رایگان</span>
          </nav>

          {/* ─── هیرو تصویری تیره (عکس برند + H1 سئو) ─── */}
          <section className="relative overflow-hidden rounded-3xl mb-10" aria-label="معرفی برنامه‌های رایگان">
            {/* v246-free-programs — عکس هیرو برند (باشگاه تیره با تن نارنجی) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/free-programs/hero.jpg"
              alt="برنامه بدنسازی رایگان فیتاپ — تمرین در باشگاه"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(105deg, rgba(15,23,42,0.94) 0%, rgba(15,23,42,0.82) 45%, rgba(15,23,42,0.45) 100%)" }} />
            <div className="relative p-6 sm:p-10 lg:p-12 text-white">
              <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full mb-4 font-bold" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                <Sparkles className="w-3.5 h-3.5" />
                {toPersianDigits(totalPrograms)} برنامهٔ کامل — کاملاً رایگان و بدون ثبت‌نام
              </span>
              <h1 className="text-2xl sm:text-4xl font-black mb-3 leading-tight">
                برنامه{" "}
                <span style={{ background: "linear-gradient(135deg, #fb923c, #f97316)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  بدنسازی رایگان
                </span>{" "}
                — حجم، چربی‌سوزی، باسن و خانه
              </h1>
              <p className="text-sm sm:text-base text-white/85 leading-relaxed max-w-3xl mb-4">
                برنامه تمرینی رایگان فیتاپ، مجموعهٔ کامل و کیوریت‌شدهٔ{" "}
                <strong className="text-white">برنامه افزایش حجم رایگان</strong>،{" "}
                <strong className="text-white">برنامه چربی سوزی رایگان</strong>،{" "}
                <strong className="text-white">برنامه باسن رایگان</strong> و{" "}
                <strong className="text-white">برنامه بدنسازی در خانه بدون وسیله</strong> است؛
                جدا برای مردان و زنان و در چهار نسخهٔ ۳ روزه، ۴ روزه، ۵ روزه و ۶ روزه. جنسیت، هدف و تعداد روزت را انتخاب کن،
                برنامهٔ کامل با ست، تکرار و استراحت هر حرکت را ببین و عکسش را دانلود کن — سر تمرین همراهت باشد.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/?screen=auth"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-6 font-black text-sm text-white transition hover:scale-[1.02] shadow-lg"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", boxShadow: "0 10px 22px -8px rgba(249,115,22,0.55)" }}
                >
                  <Sparkles className="w-5 h-5" />
                  دریافت برنامهٔ اختصاصی حرفه‌ای
                </Link>
                <Link
                  href="/#pricing"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-6 font-bold text-sm text-white bg-white/10 border border-white/30 hover:bg-white/20 transition"
                >
                  <Crown className="w-5 h-5" />
                  مشاهدهٔ پلن‌های اشتراک
                </Link>
              </div>
            </div>
          </section>

          {/* ─── ابزار تعاملی: انتخاب‌گر + نمایش‌گر برنامه ─── */}
          <FreeProgramsClient />

          {/* ─── سکشن اعتماد — چرا برنامه‌های رایگان فیتاپ؟ ─── */}
          <section className="mt-16" aria-labelledby="why-free">
            <h2 id="why-free" className="text-2xl sm:text-3xl font-black text-slate-900 mb-2">
              چرا برنامه‌های <span style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>رایگان فیتاپ</span>؟
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-3xl">
              این برنامه‌ها اسکرین‌شاتِ تمپلیت‌های اینترنتی نیستند؛ با همان منطقی چیده شده‌اند که برنامهٔ اختصاصی
              فیتاپ را می‌سازد: انتخاب حرکات بر اساس هدف، حجم ست و تکرار مناسب و استراحت هدف‌محور.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <TrustCard
                icon={UserCheck}
                title="بدون ثبت‌نام، بدون هزینه"
                desc="همهٔ ۳۲ برنامه بدون حساب کاربری و به‌طور کامل رایگان‌اند؛ همین‌جا انتخاب کن و تمرین را شروع کن."
              />
              <TrustCard
                icon={ClipboardList}
                title="کیوریت‌شده، نه تصادفی"
                desc="حرکات، ست‌ها و تکرارها بر اساس اصول هیپرتروفی و چربی‌سوزی چیده شده‌اند — همان منطق مربیان حرفه‌ای."
              />
              <TrustCard
                icon={ImageDown}
                title="دانلود عکس برنامه"
                desc="برنامه را به‌صورت عکس برنددار دانلود کن و سر تمرین در گالری گوشی‌ات داشته باش."
              />
              <TrustCard
                icon={ListChecks}
                title="ست، تکرار و استراحت دقیق"
                desc="برای هر حرکت، تعداد ست، بازهٔ تکرار و زمان استراحت مشخص است — حدس و خطا ممنوع."
              />
              <TrustCard
                icon={VenusAndMars}
                title="نسخهٔ جنسیتی واقعی"
                desc="برنامهٔ زنان و مردان تفاوت واقعی دارد: از انتخاب حرکات و بازهٔ تکرار تا عکس برنامه — هر نسخه دقیقاً برای همان جنسیت چیده شده."
              />
              <TrustCard
                icon={Lightbulb}
                title="نکات تغذیه و استراحت"
                desc="هر برنامه با نکات عملی تغذیه، پروتئین و ریکاوری همراه است تا نتیجهٔ واقعی ببینی."
              />
            </div>
          </section>

          {/* ─── چهار سکشن هدف (سئو) ─── */}
          {GOAL_ORDER.map((goal) => {
            const meta = FREE_GOAL_META[goal];
            const progs = programsByGoal(goal);
            return (
              <section key={goal} className="mt-16" aria-labelledby={`goal-${goal}`}>
                <div className="grid md:grid-cols-5 gap-5 items-stretch">
                  <div className="md:col-span-2 relative rounded-3xl overflow-hidden min-h-[200px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={meta.imageDefault} alt={meta.imageAlt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(15,23,42,0) 40%, rgba(15,23,42,0.6))" }} />
                    <span className="absolute bottom-3 right-3 text-[11px] font-bold text-white bg-black/45 backdrop-blur px-3 py-1.5 rounded-full">
                      {FREE_GOAL_LABELS[goal]}
                    </span>
                  </div>
                  <div className="md:col-span-3">
                    <h2 id={`goal-${goal}`} className="text-xl sm:text-2xl font-black text-slate-900 mb-3 leading-snug">
                      {meta.seoHeading}
                    </h2>
                    <p className="text-sm text-slate-600 leading-relaxed">{meta.seoParagraph}</p>
                  </div>
                </div>

                {/* کارت‌های ۴ برنامهٔ همین هدف */}
                <div className="grid sm:grid-cols-2 gap-3 mt-5">
                  {progs.map((p) => (
                    <a
                      key={p.id}
                      href={`#p=${p.id}`}
                      className="group rounded-2xl border-2 border-orange-100 bg-white p-4 hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/10 transition-all flex gap-3"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.image}
                        alt={p.imageAlt}
                        loading="lazy"
                        className="w-16 h-16 rounded-xl object-cover shrink-0 border border-orange-100"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <h3 className="font-black text-sm text-slate-800 group-hover:text-orange-600 transition">{p.title}</h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-100 shrink-0">
                            {FREE_DAYS_LABELS[p.days]}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{p.description}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-100">{FREE_GENDER_LABELS[p.gender]}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-100">{toPersianDigits(p.split.length)} جلسه در هفته</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-100">سطح: {p.level}</span>
                          <span className="text-[10px] mr-auto inline-flex items-center gap-1 text-orange-600 font-bold">
                            <Download className="w-3 h-3" />
                            مشاهده و دانلود
                          </span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>

                {/* CTA بعد از هر سکشن هدف */}
                <div className="mt-5 flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/?screen=auth"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-5 font-black text-sm text-white transition hover:scale-[1.01] shadow-lg"
                    style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", boxShadow: "0 10px 22px -8px rgba(249,115,22,0.45)" }}
                  >
                    <Sparkles className="w-5 h-5" />
                    دریافت برنامهٔ اختصاصی حرفه‌ای
                  </Link>
                  <Link
                    href="/#pricing"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-5 font-bold text-sm text-orange-600 bg-orange-50 hover:bg-orange-100 border-2 border-orange-200 transition"
                  >
                    <Crown className="w-5 h-5" />
                    مشاهدهٔ پلن‌های اشتراک
                  </Link>
                </div>
              </section>
            );
          })}

          {/* ─── معرفی صفحه (سئو — پاراگراف‌های اصلی) ─── */}
          <section className="mt-16 space-y-4 text-sm leading-relaxed text-slate-700">
            <h2 className="text-2xl font-black text-slate-900">
              برنامه بدنسازی رایگان فیتاپ — مرجع کامل برنامه‌های تمرینی رایگان
            </h2>
            <p>
              به‌دنبال <strong>برنامه بدنسازی رایگان</strong> هستی؟ این صفحه یک مرجع کامل است:{" "}
              <strong>برنامه افزایش حجم رایگان</strong> برای عضله‌سازی، <strong>برنامه چربی سوزی رایگان</strong> برای کات،{" "}
              <strong>برنامه باسن رایگان</strong> برای فرم‌دهی و <strong>برنامه بدنسازی در خانه بدون وسیله</strong> برای
              کسانی که باشگاه ندارند. هر برنامه در چهار نسخهٔ <strong>۳ روزه</strong>، <strong>۴ روزه</strong>،{" "}
              <strong>۵ روزه</strong> و <strong>۶ روزه</strong> و جداگانه برای{" "}
              <strong>مردان</strong> و <strong>زنان</strong> طراحی شده — یعنی در مجموع {toPersianDigits(totalPrograms)} برنامهٔ
              آماده که همین حالا می‌توانی شروع کنی، بدون ثبت‌نام و بدون پرداخت.
            </p>
            <p>
              همهٔ برنامه‌ها بر پایهٔ اصول علمی چیده شده‌اند: در برنامه‌های حجم، حرکات مرکب با بازهٔ تکرار هیپرتروفی
              (۸ تا ۱۲) و استراحت کامل؛ در برنامه‌های چربی‌سوزی، سوپرست و سیرکویت با استراحت کوتاه برای ضربان بالا؛ در
              برنامه‌های باسن، حجم اصلی روی هیپ تراست و حرکات گلوت؛ و در برنامه‌های خانگی، حرکات وزن بدن با تکنیک تمپو و
              دامنهٔ کامل. اگر تازه شروع کرده‌ای، از نسخهٔ ۳ روزه شروع کن و هر ۶ تا ۸ هفته به نسخهٔ بعد (۴، ۵ و ۶ روزه) برو.
            </p>
            <p>
              برای نتیجهٔ واقعی، تمرین کافی نیست: کالری و پروتئین روزانه‌ات را با{" "}
              <a href="/tdee" className="text-orange-600 font-bold hover:text-orange-700 transition">محاسبه‌گر کالری رایگان فیتاپ</a> تنظیم کن،
              تکنیک حرکات را از <a href="/exercises" className="text-orange-600 font-bold hover:text-orange-700 transition">بانک حرکات</a> یاد بگیر و
              ارزش غذایی وعده‌ها را از <a href="/foods" className="text-orange-600 font-bold hover:text-orange-700 transition">بانک غذاهای ایرانی</a> چک کن.
              وقتی بدنت آمادهٔ قدم بعدی بود، <a href="/?screen=auth" className="text-orange-600 font-bold hover:text-orange-700 transition">برنامهٔ اختصاصی فیتاپ</a> با هوش مصنوعی دقیقاً بر اساس بدن و هدف تو ساخته می‌شود.
            </p>
          </section>

          {/* ─── لینک‌های داخلی (ابزارهای رایگان و مجله) ─── */}
          <section className="mt-12" aria-label="لینک‌های مرتبط">
            <h2 className="text-xl font-black text-slate-900 mb-4">ابزارهای رایگان و منابع تکمیلی</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <InnerLink href="/exercises" icon={Dumbbell} title="بانک حرکات" desc="آموزش گام‌به‌گام و ویدیوی صدها حرکت بدنسازی — تکنیک صحیح هر حرکت برنامه." />
              <InnerLink href="/tdee" icon={Calculator} title="محاسبه‌گر کالری" desc="کالری روزانه (TDEE)، BMI و درشت‌مغذی‌هایت را رایگان حساب کن." />
              <InnerLink href="/foods" icon={Apple} title="بانک غذاهای ایرانی" desc="کالری و درشت‌مغذی بیش از هزار غذای ایرانی با محاسبه‌گر زنده." />
              <InnerLink href="/articles" icon={Newspaper} title="مقالات فیتاپ" desc="مجلهٔ تخصصی بدنسازی، تغذیه و تناسب اندام — آموزش‌های رایگان." />
            </div>
          </section>

          {/* ─── v250 — ایندکس کامل ۳۲ صفحهٔ اختصاصی برنامه‌ها (لینک‌سازی داخلی سئو) ─── */}
          <section className="mt-12" aria-labelledby="all-programs-index">
            <h2 id="all-programs-index" className="text-xl font-black text-slate-900 mb-2">
              همهٔ {toPersianDigits(totalPrograms)} برنامهٔ رایگان در یک نگاه
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed mb-5 max-w-3xl">
              هر برنامه یک صفحهٔ اختصاصی با جدول کامل ست، تکرار و استراحت، نکات تغذیه و سوالات متداول
              دارد — روی هر عنوان بزن:
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {GOAL_ORDER.map((goal) => {
                const GoalIcon = GOAL_INDEX_ICONS[goal];
                return (
                  <div key={goal} className="rounded-2xl border-2 border-orange-100 bg-white p-4 sm:p-5">
                    <h3 className="font-black text-sm text-slate-800 mb-3 flex items-center gap-2">
                      <span
                        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                        style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                      >
                        <GoalIcon className="w-4 h-4 text-white" strokeWidth={2.4} />
                      </span>
                      {FREE_GOAL_LABELS[goal]}
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {programsByGoal(goal).map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/free-programs/${p.id}`}
                            className="inline-block text-[11px] font-bold px-2.5 py-1.5 rounded-full bg-orange-50 text-orange-700 border border-orange-100 hover:bg-orange-100 hover:border-orange-200 hover:text-orange-800 transition"
                          >
                            {p.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ─── CTA پایانی بزرگ ─── */}
          <section className="mt-12 p-6 sm:p-8 rounded-3xl text-center text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
            <h3 className="text-xl sm:text-2xl font-black mb-2">می‌خواهی برنامه دقیقاً برای بدن خودت ساخته شود؟</h3>
            <p className="text-sm text-white/90 mb-5 max-w-2xl mx-auto leading-relaxed">
              برنامه‌های رایگان نقطهٔ شروع عالی‌اند. برنامهٔ اختصاصی فیتاپ اما بر اساس قد، وزن، سن، سابقهٔ تمرینی،
              آسیب‌ها و هدف دقیق تو با هوش مصنوعی ساخته می‌شود — با وزنه‌های پیشنهادی، پیشرفت هفتگی، برنامهٔ غذایی
              با گرم‌های دقیق و پشتیبانی مربی.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <Link
                href="/?screen=auth"
                className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[52px] px-8 font-black text-sm bg-white text-orange-600 hover:bg-white/90 transition shadow-lg"
              >
                <Sparkles className="w-5 h-5" />
                دریافت برنامهٔ اختصاصی حرفه‌ای
              </Link>
              <Link
                href="/#pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[52px] px-8 font-bold text-sm text-white bg-white/10 border border-white/35 hover:bg-white/20 transition"
              >
                <Crown className="w-5 h-5" />
                مشاهدهٔ پلن‌های اشتراک
              </Link>
            </div>
          </section>

          {/* ─── سوالات متداول (هم‌محتوا با JSON-LD) ─── */}
          <section className="mt-16" aria-labelledby="faq-title">
            <h2 id="faq-title" className="text-2xl font-black text-slate-900 mb-6">
              سوالات متداول دربارهٔ برنامه‌های بدنسازی رایگان
            </h2>
            <div className="space-y-3">
              {FREE_PROGRAMS_FAQ.map((f, i) => (
                <div key={i} className="rounded-2xl border border-orange-100 bg-white p-4 sm:p-5">
                  <h3 className="font-black text-sm sm:text-base text-slate-800 mb-2 flex items-start gap-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 mt-0.5" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                      {toPersianDigits(i + 1)}
                    </span>
                    {f.q}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed pr-8">{f.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* یادآور نهایی اعتماد */}
          <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-slate-500 text-center">
            <ShieldCheck className="w-4 h-4 text-orange-500 shrink-0" />
            این برنامه‌ها برای همیشه رایگان‌اند — بدون محدودیت، بدون ثبت‌نام و بدون نیاز به کارت بانکی.
          </p>
        </div>
      </main>

      <SiteFooter />

      {/* v211 — سیاست نیکا: همه‌جای سایت به‌جز ورود/آنبوردینگ/پنل */}
      <NikaWidget context="public" />
    </div>
  );
}

// ─── اجزای کوچک سکشن‌ها (SSR — بدون استیت) ───

/** کارت سکشن اعتماد */
function TrustCard({ icon: Icon, title, desc }: { icon: typeof Dumbbell; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border-2 border-orange-100 bg-white p-5 hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/10 transition-all">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3 shadow-md" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", boxShadow: "0 10px 24px -8px rgba(249,115,22,0.5)" }}>
        <Icon className="w-6 h-6 text-white" strokeWidth={2.4} />
      </div>
      <h3 className="font-black text-sm text-slate-900 mb-1.5">{title}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
    </div>
  );
}

/** کارت لینک داخلی (ابزارها/مجله) */
function InnerLink({ href, icon: Icon, title, desc }: { href: string; icon: typeof Dumbbell; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3.5 rounded-2xl border-2 border-orange-100 bg-white p-4 hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/10 transition-all"
    >
      <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", boxShadow: "0 10px 24px -8px rgba(249,115,22,0.5)" }}>
        <Icon className="w-5 h-5 text-white" strokeWidth={2.4} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1 font-black text-sm text-slate-900 group-hover:text-orange-600 transition">
          {title}
          <ChevronLeft className="w-4 h-4 text-orange-500 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </span>
        <span className="block text-xs text-slate-500 leading-relaxed mt-1">{desc}</span>
      </span>
    </Link>
  );
}
