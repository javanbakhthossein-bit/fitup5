import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Calculator,
  ChevronLeft,
  Dumbbell,
  Home,
  Lightbulb,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { NikaWidget } from "@/components/fitness/nika-widget";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
// v252 — دکمهٔ دانلود عکس برنامه (کلاینتی — درخواست مالک برای صفحهٔ اختصاصی هر برنامه)
import { FreeProgramDownloadButton } from "../program-download-button";
import { toPersianDigits, SUBSCRIPTION_PLANS } from "@/lib/fitness/types";
import { absoluteImageUrl, fitupWebsiteRef } from "@/lib/fitness/schema-org";
import {
  FREE_DAYS_LABELS,
  FREE_GENDER_LABELS,
  FREE_GOAL_LABELS,
  FREE_GOAL_META,
  FREE_PROGRAMS,
  FREE_PROGRAMS_FAQ,
  type FreeDay,
  type FreeProgram,
} from "@/lib/fitness/free-programs-data";

/**
 * ─── v250-free-program-pages — صفحهٔ فرود اختصاصی هر برنامهٔ رایگان (/free-programs/[slug]) ───
 *
 * هدف: سئو. هر یک از ۳۲ برنامهٔ کاتالوگ (free-programs-data) یک URL مستقل و
 * ایندکس‌پذیر با محتوای کامل SSR دارد (الگو: صفحات program در
 * muscleandstrength.com): هیرو تصویری + پاراگراف‌های توصیفی + جدول کامل
 * ست/تکرار/استراحت همهٔ روزها + نکات تغذیه/استراحت + CTA + FAQ + برنامه‌های مرتبط.
 *
 * قواعد سخت این صفحه:
 *   ۱) هیچ "use client" وجود ندارد — HTML کاملاً سرور-ساید و کرال‌پذیر است.
 *   ۲) generateStaticParams از FREE_PROGRAMS + dynamicParams=false → هر slug
 *      خارج از کاتالوگ فوراً 404 واقعی می‌گیرد (نه soft-404). notFound() فقط
 *      گارد تایپ است و هرگز برای ترافیک واقعی اجرا نمی‌شود.
 *   ۳) slug = id برنامه (مثل «muscle-gain-male-3») — همان id که کارت‌های هاب
 *      و انتخاب‌گر کلاینتی استفاده می‌کنند تا لینک‌سازی داخلی یکدست بماند.
 *   ۴) JSON-LD در «یک» اسکریپت: BreadcrumbList + FAQPage (هم‌متن با سکشن FAQ
 *      صفحه) + ItemList از حرکات روز اول — ارجاع isPartOf با @id کانونی
 *      WebSite فیتاپ (الگوی src/lib/fitness/schema-org.ts).
 *   ۵) عکس Hero با next/image و مسیر نسبی فایل public (بهینه‌ساز داخلی)؛
 *      فقط og:image URL مطلق می‌گیرد (absoluteImageUrl از schema-org).
 *
 * CTAها: «شروع کن» → /#pricing (سکشن پلن‌های صفحهٔ اصلی) و
 * «محاسبهٔ کالری روزانه» → /tdee — هم‌لحن و هم‌مقصد با بقیهٔ سایت.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

interface ProgramPageProps {
  params: Promise<{ slug: string }>;
}

/** هر ۳۲ برنامهٔ کاتالوگ یک صفحهٔ استاتیک واقعی می‌سازند (slug = id برنامه) */
export function generateStaticParams() {
  return FREE_PROGRAMS.map((p) => ({ slug: p.id }));
}

/** slugهای خارج از کاتالوگ بدون هیچ رندری 404 واقعی می‌گیرند */
export const dynamicParams = false;

/** دادهٔ کاتالوگ ایستاست (بدون DB) — بازاعتبار ساعتی، هم‌الگوی هاب /free-programs */
export const revalidate = 3600;

function getProgramBySlug(slug: string): FreeProgram | undefined {
  return FREE_PROGRAMS.find((p) => p.id === slug);
}

/** metadata اختصاصی هر برنامه — title از دادهٔ کیوریت‌شده + canonical مطلق */
export async function generateMetadata({ params }: ProgramPageProps): Promise<Metadata> {
  const { slug } = await params;
  const program = getProgramBySlug(slug);
  if (!program) return {};

  const title = `${program.title} | برنامه رایگان بدنسازی فیتاپ`;
  const canonical = `${SITE_URL}/free-programs/${program.id}`;

  return {
    title: { absolute: title },
    description: program.description,
    robots: "index,follow",
    alternates: { canonical },
    openGraph: {
      title,
      description: program.description,
      type: "website",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [
        { url: absoluteImageUrl(program.image), width: 1376, height: 768, alt: program.imageAlt },
      ],
    },
  };
}

/** JSON-LD صفحه — یک اسکریپت، سه موجودیت (الگوی هاب /free-programs و /sport/[slug]) */
function buildJsonLd(program: FreeProgram): object[] {
  const canonical = `${SITE_URL}/free-programs/${program.id}`;
  const dayOne = program.split[0];

  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: "برنامه‌های بدنسازی رایگان",
          item: `${SITE_URL}/free-programs`,
        },
        { "@type": "ListItem", position: 3, name: program.title, item: canonical },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      isPartOf: fitupWebsiteRef(),
      mainEntity: FREE_PROGRAMS_FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${dayOne.title} — ${program.title}`,
      isPartOf: fitupWebsiteRef(),
      numberOfItems: dayOne.exercises.length,
      itemListElement: dayOne.exercises.map((ex, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: ex.name,
      })),
    },
  ];
}

export default async function FreeProgramDetailPage({ params }: ProgramPageProps) {
  const { slug } = await params;
  const program = getProgramBySlug(slug);
  // با dynamicParams=false این خط هرگز برای ترافیک واقعی اجرا نمی‌شود —
  // فقط گارد تایپ (هم‌الگوی /sport/[slug])
  if (!program) notFound();

  const goalMeta = FREE_GOAL_META[program.goal];
  const totalExercises = program.split.reduce((n, d) => n + d.exercises.length, 0);
  const dayTitles = program.split.map((d) => `«${d.title}»`).join("؛ ");

  // برنامه‌های مرتبط: ۳ نسخهٔ دیگر همین هدف/جنسیت (طول‌های دیگر هفته) + نسخهٔ
  // جنسیت مقابل با همان تعداد روز — دترمینیستیک از کاتالوگ
  const relatedPrograms = [
    ...FREE_PROGRAMS.filter(
      (p) => p.goal === program.goal && p.gender === program.gender && p.id !== program.id
    ),
    FREE_PROGRAMS.find(
      (p) => p.goal === program.goal && p.gender !== program.gender && p.days === program.days
    ),
  ]
    .filter((p): p is FreeProgram => Boolean(p))
    .slice(0, 4);

  const jsonLd = buildJsonLd(program);

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      {/* ─── JSON-LD (یک اسکریپت: BreadcrumbList + FAQPage + ItemList) ─── */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* نوار واحد ابزارهای رایگان (هماهنگ با /free-programs و /tdee) */}
      <ToolsNav active="tool-free-programs" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24 pb-20 md:pb-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 w-full">
          {/* ─── بردکرامب ─── */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5 flex-wrap">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3 shrink-0" />
            <Link href="/free-programs" className="hover:text-orange-600 transition">
              برنامه‌های رایگان
            </Link>
            <ChevronLeft className="w-3 h-3 shrink-0" />
            <span className="text-slate-600">{program.title}</span>
          </nav>

          {/* ─── هیرو تصویری تیره (عکس هدف + H1 اختصاصی برنامه) ─── */}
          <section className="relative overflow-hidden rounded-3xl mb-10" aria-label="معرفی برنامه">
            <Image
              src={program.image}
              alt={program.imageAlt}
              width={1376}
              height={768}
              priority
              sizes="100vw"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(105deg, rgba(15,23,42,0.94) 0%, rgba(15,23,42,0.82) 45%, rgba(15,23,42,0.45) 100%)" }}
            />
            <div className="relative p-6 sm:p-10 lg:p-12 text-white">
              <span
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full mb-4 font-bold"
                style={{ background: goldGradient }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                برنامهٔ رایگان فیتاپ — بدون ثبت‌نام
              </span>
              <h1 className="text-2xl sm:text-4xl font-black mb-3 leading-tight">{program.title}</h1>
              <p className="text-sm sm:text-base text-white/85 leading-relaxed max-w-3xl mb-4">
                {program.description}
              </p>
              {/* بج‌های متادیتا: هدف / جنسیت / تعداد روز / سطح */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <HeroBadge label="هدف" value={FREE_GOAL_LABELS[program.goal]} />
                <HeroBadge label="جنسیت" value={FREE_GENDER_LABELS[program.gender]} />
                <HeroBadge label="روزها" value={`${FREE_DAYS_LABELS[program.days]} در هفته`} />
                <HeroBadge label="سطح" value={program.level} />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="#split"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-6 font-black text-sm text-white transition hover:scale-[1.02] shadow-lg"
                  style={{ background: goldGradient, boxShadow: "0 10px 22px -8px rgba(249,115,22,0.55)" }}
                >
                  <Dumbbell className="w-5 h-5" />
                  مشاهدهٔ جدول تمرین
                </a>
                <Link
                  href="/free-programs"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[48px] px-6 font-bold text-sm text-white bg-white/10 border border-white/30 hover:bg-white/20 transition"
                >
                  <ChevronLeft className="w-5 h-5" />
                  همهٔ برنامه‌های رایگان
                </Link>
              </div>
              {/* ═══ v252 — اکشن دانلود عکس برنامه (دیرکتیو مالک: «دانلود عکس
                  برنامه رو نذاشتی») — داخل جریان هیرو (بدون همپوشانی در موبایل) ═══ */}
              <div className="mt-5 relative">
                <FreeProgramDownloadButton program={program} />
              </div>
            </div>
          </section>

          {/* ─── پاراگراف‌های توصیفی (از دادهٔ واقعی کاتالوگ — بدون ادعای پزشکی) ─── */}
          <section className="mt-2 space-y-4 text-sm leading-relaxed text-slate-700" aria-label="دربارهٔ این برنامه">
            <p>
              <strong>{program.title}</strong> یکی از {toPersianDigits(FREE_PROGRAMS.length)} برنامهٔ
              کاتالوگ رایگان فیتاپ است: {toPersianDigits(program.split.length)} جلسهٔ تمرینی در هفته با
              مجموع {toPersianDigits(totalExercises)} حرکت، مناسب سطح «{program.level}» و دقیقاً برای
              هدف «{FREE_GOAL_LABELS[program.goal]}» چیده شده است. {program.description}
            </p>
            <p>{goalMeta.seoParagraph}</p>
            <p>
              چینش هفتگی این نسخه این‌طور است: {dayTitles}. برای هر حرکت، تعداد ست، بازهٔ تکرار و
              زمان استراحت دقیق مشخص شده و یادداشت‌های اجرا (سوپرست، ست گرم‌کردنی و تکنیک) هم زیر
              نام همان حرکت آمده‌اند. اگر تکنیک حرکتی را کامل بلد نیستی، قبل از سر تمرین آموزشش را در{" "}
              <a href="/exercises" className="text-orange-600 font-bold hover:text-orange-700 transition">
                بانک حرکات فیتاپ
              </a>{" "}
              ببین؛ برای تنظیم کالری و پروتئین روزانه هم{" "}
              <a href="/tdee" className="text-orange-600 font-bold hover:text-orange-700 transition">
                محاسبه‌گر کالری رایگان فیتاپ
              </a>{" "}
              عدد دقیق تو را می‌دهد. نکات تغذیه و ریکاوری مخصوص همین برنامه در ادامهٔ صفحه آمده است.
            </p>
          </section>

          {/* ─── جدول کامل اسپلیت — هر روز یک کارت با جدول ست/تکرار/استراحت ─── */}
          <section id="split" className="mt-14 scroll-mt-24" aria-labelledby="split-title">
            <h2 id="split-title" className="text-2xl sm:text-3xl font-black text-slate-900 mb-2 flex items-center gap-2">
              <Dumbbell className="w-6 h-6 text-orange-500 shrink-0" />
              جدول کامل برنامه — ست، تکرار و استراحت هر حرکت
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-5 max-w-3xl">
              برنامهٔ هفتگی این نسخه {toPersianDigits(program.split.length)} جلسه دارد؛ هر روز در کارت
              جدا با جدول کامل حرکاتش آمده است. سوپرست‌ها و ست‌های گرم‌کردنی با یادداشت زیر نام حرکت
              مشخص شده‌اند — سر تمرین فقط اجرا کن و روی فرم تمرکز کن.
            </p>
            <div className={`grid gap-4 ${program.days >= 4 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
              {program.split.map((day, di) => (
                <DayCard key={day.title} day={day} index={di} />
              ))}
            </div>
          </section>

          {/* ─── نکات تغذیه و استراحت ─── */}
          <section className="mt-14" aria-labelledby="tips-title">
            <h2 id="tips-title" className="text-2xl sm:text-3xl font-black text-slate-900 mb-2 flex items-center gap-2">
              <Lightbulb className="w-6 h-6 text-amber-500 shrink-0" />
              نکات تغذیه و استراحت این برنامه
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-5 max-w-3xl">
              تمرین نیمی از نتیجه است؛ نیمهٔ دیگر تغذیه، خواب و ریکاوری است. برای این برنامه این{" "}
              {toPersianDigits(program.tips.length)} نکته را جدی بگیر:
            </p>
            <div className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 sm:p-5 space-y-3">
              {program.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 mt-0.5"
                    style={{ background: goldGradient }}
                  >
                    {toPersianDigits(i + 1)}
                  </span>
                  <p>{tip}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── CTA: خرید برنامهٔ اختصاصی (v252 — دیرکتیو مالک: CTA خرید واقعی
              علاوه بر قیف عمومی) + محاسبهٔ کالری ─── */}
          <section
            className="mt-14 p-6 sm:p-8 rounded-3xl text-center text-white relative overflow-hidden"
            style={{ background: goldGradient }}
            aria-labelledby="cta-title"
          >
            <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
            <h2 id="cta-title" className="text-xl sm:text-2xl font-black mb-2 relative">
              می‌خواهی برنامهٔ اختصاصی با هوش مصنوعی داشته باشی؟
            </h2>
            <p className="text-sm text-white/90 mb-5 max-w-2xl mx-auto leading-relaxed relative">
              برنامه‌های رایگان نقطهٔ شروع عالی‌اند. برنامهٔ اختصاصی فیتاپ اما بر اساس قد، وزن، سن،
              سابقهٔ تمرینی، آسیب‌ها و هدف دقیق تو با هوش مصنوعی ساخته می‌شود — با وزنه‌های پیشنهادی،
              پیشرفت هفتگی، برنامهٔ غذایی با گرم‌های دقیق و پشتیبانی مربی.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 relative">
              <Link
                href="/?screen=auth"
                className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[52px] px-8 font-black text-sm bg-white text-orange-600 hover:bg-white/90 transition shadow-lg"
              >
                <Sparkles className="w-5 h-5" />
                خرید برنامهٔ اختصاصی
              </Link>
              <Link
                href="/#pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl min-h-[52px] px-8 font-bold text-sm text-white bg-white/10 border border-white/35 hover:bg-white/20 transition"
              >
                <Calculator className="w-5 h-5" />
                مشاهدهٔ پلن‌ها و قیمت‌ها
              </Link>
            </div>
            <p className="text-[11px] text-white/80 mt-4 relative">
              شروع فقط از {""}
              <span className="font-black">
                {toPersianDigits(String(Math.round(Math.min(...SUBSCRIPTION_PLANS.map((p) => p.price)) / 1000)))} هزار تومان
              </span>
              {" "}— ثبت‌نام و دریافت برنامه در کمتر از ۱۰ دقیقه
            </p>
          </section>

          {/* ─── سوالات متداول (هم‌متن با JSON-LD) ─── */}
          <section className="mt-14" aria-labelledby="faq-title">
            <h2 id="faq-title" className="text-2xl sm:text-3xl font-black text-slate-900 mb-6">
              سوالات متداول دربارهٔ برنامه‌های بدنسازی رایگان
            </h2>
            <div className="space-y-3">
              {FREE_PROGRAMS_FAQ.map((f, i) => (
                <div key={i} className="rounded-2xl border border-orange-100 bg-white p-4 sm:p-5">
                  <h3 className="font-black text-sm sm:text-base text-slate-800 mb-2 flex items-start gap-2">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 mt-0.5"
                      style={{ background: goldGradient }}
                    >
                      {toPersianDigits(i + 1)}
                    </span>
                    {f.q}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed pr-8">{f.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── برنامه‌های مرتبط (لینک‌سازی داخلی — نسخه‌های هم‌خانواده) ─── */}
          <section className="mt-14" aria-labelledby="related-title">
            <h2 id="related-title" className="text-2xl sm:text-3xl font-black text-slate-900 mb-2">
              برنامه‌های مرتبط رایگان
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-5 max-w-3xl">
              نسخه‌های دیگر همین هدف و جنسیت با طول هفتهٔ متفاوت، و نسخهٔ جنسیت مقابل این برنامه — همه
              کاملاً رایگان:
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {relatedPrograms.map((p) => (
                <Link
                  key={p.id}
                  href={`/free-programs/${p.id}`}
                  className="group rounded-2xl border-2 border-orange-100 bg-white p-4 hover:border-orange-300 hover:shadow-lg hover:shadow-orange-500/10 transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <h3 className="font-black text-sm text-slate-800 group-hover:text-orange-600 transition">
                      {p.title}
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-100 shrink-0">
                      {FREE_DAYS_LABELS[p.days]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{p.description}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-100">
                      {FREE_GENDER_LABELS[p.gender]}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-100">
                      سطح: {p.level}
                    </span>
                    <span className="text-[10px] mr-auto inline-flex items-center gap-1 text-orange-600 font-bold">
                      مشاهدهٔ برنامه
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            {/* لینک برگشت به هاب */}
            <div className="mt-5">
              <Link
                href="/free-programs"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-600 hover:text-orange-700 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                همهٔ {toPersianDigits(FREE_PROGRAMS.length)} برنامهٔ رایگان فیتاپ را ببین
              </Link>
            </div>
          </section>

          {/* ─── یادآور اعتماد ─── */}
          <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-slate-500 text-center">
            <ShieldCheck className="w-4 h-4 text-orange-500 shrink-0" />
            این برنامه برای همیشه رایگان است — بدون ثبت‌نام، بدون محدودیت و بدون نیاز به کارت بانکی.
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

/** بج متادیتای هیرو */
function HeroBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full bg-white/10 border border-white/25 font-bold backdrop-blur-sm">
      <span className="text-white/70 font-medium">{label}:</span>
      {value}
    </span>
  );
}

/** کارت یک روز تمرین با جدول کامل حرکات (موبایل: اسکرول افقی نرم) */
function DayCard({ day, index }: { day: FreeDay; index: number }) {
  return (
    <div className="rounded-2xl border border-orange-100 bg-white overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: goldGradient }}>
        <span className="w-7 h-7 rounded-full bg-white/25 flex items-center justify-center text-xs font-black shrink-0">
          {toPersianDigits(index + 1)}
        </span>
        <h3 className="font-black text-sm leading-snug">{day.title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="text-slate-400 text-[10px] border-b border-orange-50">
              <th scope="col" className="px-3 py-2 font-bold">حرکت</th>
              <th scope="col" className="px-2 py-2 font-bold text-center w-12">ست</th>
              <th scope="col" className="px-2 py-2 font-bold text-center w-16">تکرار</th>
              <th scope="col" className="px-2 py-2 font-bold text-center w-20">استراحت</th>
            </tr>
          </thead>
          <tbody>
            {day.exercises.map((ex, i) => (
              <tr key={`${ex.name}-${i}`} className={i % 2 === 1 ? "bg-orange-50/40" : "bg-white"}>
                <td className="px-3 py-2.5">
                  <span className="font-bold text-slate-800 leading-snug">{ex.name}</span>
                  {ex.note && (
                    <span className="block text-[10px] text-slate-500 mt-0.5 leading-relaxed">{ex.note}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-center font-black text-orange-600">{ex.sets}</td>
                <td className="px-2 py-2.5 text-center font-bold text-slate-700">{ex.reps}</td>
                <td className="px-2 py-2.5 text-center text-slate-500">{ex.rest}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
