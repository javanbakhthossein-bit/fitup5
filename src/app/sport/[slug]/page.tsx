import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Dumbbell,
  Flame,
  Lightbulb,
  Target,
  Zap,
} from "lucide-react";
import {
  DISCIPLINE_EXERCISE_NAMES,
  DISCIPLINE_PAGE_SLUGS,
  getDisciplinePage,
  type DisciplinePageData,
} from "@/lib/fitness/disciplines-data";
import { toPersianDigits, type Discipline } from "@/lib/fitness/types";
import { db } from "@/lib/db";

/**
 * v101 — دیرکتیو مالک: لندینگ اختصاصی و واقعی هر رشتهٔ ورزشی (/sport/<slug>).
 *
 * چرا این صفحه وجود دارد: صفحهٔ پویای قدیمی (?sport=<slug>) بخشی از SPA است و
 * گوگل آن را مثل URL واقعی ایندکس نمی‌کند؛ اینجا هر رشته یک route واقعی و
 * استاتیک دارد که در build-time رندر می‌شود (SSR ثابت — بدون هیچ client
 * component) و در sitemap با همین URL ایندکس می‌شود.
 *
 * قواعد سخت این صفحه:
 *   ۱) هیچ ویدیویی رندر نمی‌شود — youtubeUrl در این لندینگ‌ها مصرف نمی‌شود.
 *   ۲) هیچ "use client" وجود ندارد — HTML کاملاً سرور-ساید و کرال‌پذیر است.
 *   ۳) dynamicParams=false + notFound → slugهای خارج از DISCIPLINE_PAGE_SLUGS
 *      همیشه 404 واقعی می‌دهند.
 *   ۴) JSON-LD کامل: FAQPage + BreadcrumbList + SportsActivity.
 *
 * v113 — دیرکتیو مالک: «در صفحه‌های ورزشی وقتی می‌زنی به قسمت ورزش‌ها
 *   نمی‌بره» → سکشن «حرکات اختصاصی رشته» (#exercises) اضافه شد: گرید حرکات
 *   از DISCIPLINE_EXERCISE_IDS + DB با لینک واقعی /exercise/<id>، دکمهٔ
 *   انکر «مشاهده حرکات این رشته» در hero و لینک ثانویهٔ «بانک حرکات کامل».
 *   revalidate=600 تا دادهٔ حرکات بدون ری‌دیپلوی تازه شود.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

interface SportPageProps {
  params: Promise<{ slug: string }>;
}

/** فقط ۵ رشتهٔ دارای دادهٔ کامل صفحهٔ واقعی می‌سازند — بقیهٔ slugها 404 */
export function generateStaticParams() {
  return DISCIPLINE_PAGE_SLUGS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

/** v113 — حرکات اختصاصی از DB می‌آیند → ISR هر ۱۰ دقیقه (حرکت/ویدیوی جدید
 *  ادمین بدون ری‌دیپلوی به همین لندینگ استاتیک می‌رسد). */
export const revalidate = 600;

/** metadata کامل هر رشته — title از دیتا (metaTitle) + canonical واقعی /sport/<slug> */
export async function generateMetadata({ params }: SportPageProps): Promise<Metadata> {
  const { slug } = await params;
  const d = getDisciplinePage(slug);
  if (!d) return {};

  const canonical = `${SITE_URL}/sport/${d.slug}`;
  return {
    title: { absolute: d.metaTitle },
    description: d.metaDescription,
    keywords: d.seoKeywords,
    robots: "index,follow",
    alternates: { canonical },
    openGraph: {
      title: d.metaTitle,
      description: d.metaDescription,
      type: "website",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: d.label }],
    },
  };
}

/* ─── v113 — حرکات اختصاصی رشته (بانک حرکات فیتاپ) ─── */

interface DisciplineExercise {
  id: string;
  name: string;
  muscle: string;
  category: string;
}

/** برچسب فارسی دستهٔ حرکت (همان نگاشت صفحهٔ /exercise/[id] — عضله معمولاً فارسی است) */
const CATEGORY_LABELS: Record<string, string> = {
  push: "سینه/سرشانه/پشت‌بازو",
  pull: "پشت/جلو‌بازو",
  legs: "پا و باسن",
  core: "مرکزی/شکم",
  cardio: "هوازی",
  fullbody: "تمام بدن",
};

const CATEGORY_EMOJI: Record<string, string> = {
  push: "💪",
  pull: "🏋️",
  legs: "🦵",
  core: "🎯",
  cardio: "🏃",
  fullbody: "🔥",
};

/**
 * حرکات اختصاصی هر رشته از کتابخانهٔ DB — به ترتیب کیور DISCIPLINE_EXERCISE_NAMES
 * (چیدهٔ دستی هر رشته، نه ترتیب الفبای DB). v115: ارجاع نامی (به‌جای id) تا با
 * پاکسازی بانک حرکات هم سازگار بماند — ردیف غایب فیلتر می‌شود. حداکثر ۱۲ حرکت.
 * try/catch سخت: هیچ خطای DB حق ندارد این لندینگ استاتیک را بیندازد — بدترین
 * حالت، سکشن «پوسته + لینک بانک حرکات» رندر می‌شود. slugهای بدون ورودی
 * عمداً خالی برمی‌گردند → همان پوستهٔ سکشن با لینک /exercises.
 */
async function getDisciplineExercises(slug: string): Promise<DisciplineExercise[]> {
  try {
    const names = DISCIPLINE_EXERCISE_NAMES[slug as Discipline] ?? [];
    if (names.length === 0) return [];
    const rows = await db.exerciseLibrary.findMany({
      where: { name: { in: names }, isActive: true }, // v135 — فقط فعال‌ها در صفحهٔ رشته
      select: { id: true, name: true, muscle: true, category: true },
      take: 12,
    });
    const byName = new Map(rows.map((r) => [r.name, r]));
    return names
      .map((n) => byName.get(n))
      .filter((r): r is DisciplineExercise => !!r)
      .slice(0, 12);
  } catch {
    return [];
  }
}

/* ─── JSON-LD (FAQPage + BreadcrumbList + SportsActivity) ─── */
function buildJsonLd(d: DisciplinePageData): object[] {
  const canonical = `${SITE_URL}/sport/${d.slug}`;
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: d.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "رشته‌های ورزشی", item: `${SITE_URL}/#disciplines` },
      { "@type": "ListItem", position: 3, name: d.label, item: canonical },
    ],
  };
  const sportsActivitySchema = {
    "@context": "https://schema.org",
    "@type": "SportsActivity",
    name: d.label,
    alternateName: `${d.label} — فیتاپ`,
    description: d.metaDescription,
    url: canonical,
    sport: d.label,
    image: `${SITE_URL}/fitup-logo.png`,
  };
  return [faqSchema, breadcrumbSchema, sportsActivitySchema];
}

export default async function SportDisciplinePage({ params }: SportPageProps) {
  const { slug } = await params;
  const d = getDisciplinePage(slug);
  if (!d) notFound();

  const jsonLdBlocks = buildJsonLd(d);
  const otherDisciplines = DISCIPLINE_PAGE_SLUGS.filter((s) => s !== d.slug)
    .map((s) => getDisciplinePage(s))
    .filter((x): x is DisciplinePageData => !!x);

  // v113 — حرکات اختصاصی این رشته (خطای DB → [] → سکشن پوسته‌ای)
  const exercises = await getDisciplineExercises(slug);

  const infoCards = [
    { icon: Target, title: "مناسب چه کسانی؟", body: d.whoIsFor, color: "#ea580c", bg: "#fff7ed" },
    { icon: Dumbbell, title: "تجهیزات لازم", body: d.equipmentNeeded, color: "#b45309", bg: "#fffbeb" },
    { icon: Clock, title: "طول هر جلسه", body: d.sessionLength, color: "#c2410c", bg: "#fff7ed" },
    { icon: Flame, title: "کالری هر جلسه", body: d.caloriesBurn, color: "#dc2626", bg: "#fef2f2" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-white to-orange-50/60 scroll-smooth">
      {/* ─── JSON-LD ─── */}
      {jsonLdBlocks.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}

      {/* ─── هدر ثابت (سرور-ساید) ─── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-orange-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5" aria-label="فیتاپ — صفحهٔ اصلی">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md overflow-hidden"
              style={{ background: "linear-gradient(135deg, #fb923c, #f97316)" }}
            >
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </div>
            <span className="font-black text-lg text-slate-900">فیتاپ</span>
          </a>
          <a
            href="/?screen=auth"
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white shadow-md transition hover:scale-[1.03]"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Zap className="w-4 h-4" />
            شروع رایگان
          </a>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          {/* ─── breadcrumb ─── */}
          <nav aria-label="مسیر صفحه" className="pt-6">
            <ol className="flex items-center flex-wrap gap-1.5 text-xs text-slate-500">
              <li>
                <a href="/" className="hover:text-orange-600 transition">
                  خانه
                </a>
              </li>
              <li aria-hidden className="text-slate-300">
                /
              </li>
              <li>
                <a href="/#disciplines" className="hover:text-orange-600 transition">
                  رشته‌های ورزشی
                </a>
              </li>
              <li aria-hidden className="text-slate-300">
                /
              </li>
              <li className="font-bold text-slate-700" aria-current="page">
                {d.label}
              </li>
            </ol>
          </nav>

          {/* ─── hero ─── */}
          <div className="text-center mt-8 mb-10">
            <div
              className="w-16 h-16 mx-auto mb-4 rounded-3xl flex items-center justify-center text-3xl shadow-lg"
              style={{ background: "linear-gradient(135deg, #fff7ed, #ffedd5)", border: "1px solid #fed7aa" }}
              aria-hidden
            >
              {d.emoji}
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 leading-tight mb-4">
              راهنمای کامل{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {d.label}
              </span>{" "}
              — آموزش، فواید و برنامهٔ تخصصی فیتاپ
            </h1>
            <p className="text-slate-500 max-w-2xl mx-auto leading-7 text-sm sm:text-base">{d.tagline}</p>
            {/* v113 — دیرکتیو مالک: دکمهٔ انکر به سکشن حرکات (اسکرول نرم native — بدون JS) */}
            <div className="mt-6">
              <a
                href="#exercises"
                className="inline-flex items-center justify-center gap-2 rounded-2xl h-12 sm:h-14 px-6 sm:px-8 text-sm sm:text-base font-black text-white shadow-lg transition hover:scale-[1.03]"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <Dumbbell className="w-5 h-5" aria-hidden />
                مشاهده حرکات این رشته
                <ChevronLeft className="w-5 h-5" aria-hidden />
              </a>
            </div>
          </div>

          {/* ─── معرفی (دو پاراگراف) ─── */}
          <section className="mb-10">
            {d.intro.map((p, i) => (
              <p key={i} className="text-slate-600 leading-8 mb-4 text-justify">
                {p}
              </p>
            ))}
          </section>

          {/* ─── فواید ─── */}
          <section className="mb-10">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-4">فواید {d.label}</h2>
            <ul className="bg-white rounded-2xl border border-orange-100 p-5 sm:p-6 shadow-sm space-y-3">
              {d.benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-slate-700 leading-7">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-1.5"
                    style={{ background: "#ffedd5" }}
                    aria-hidden
                  >
                    <Check className="w-3.5 h-3.5 text-orange-600" strokeWidth={3} />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </section>

          {/* ─── کارت‌های اطلاعاتی ─── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12" aria-label="اطلاعات کلیدی رشته">
            {infoCards.map((c, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-orange-100 p-5 shadow-sm flex items-start gap-3.5"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: c.bg }}
                  aria-hidden
                >
                  <c.icon className="w-5 h-5" style={{ color: c.color }} />
                </div>
                <div>
                  <p className="font-black text-sm text-slate-900 mb-1">{c.title}</p>
                  <p className="text-[13px] text-slate-600 leading-6">{c.body}</p>
                </div>
              </div>
            ))}
          </section>

          {/* ─── سکشن‌های سئوی بلند ─── */}
          <div className="space-y-10 mb-12">
            {d.seoSections.map((s, i) => (
              <section key={i}>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-4 leading-snug">{s.heading}</h2>
                {s.paragraphs.map((p, j) => (
                  <p key={j} className="text-slate-600 leading-8 mb-3.5 text-justify">
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </div>

          {/* ─── نکات مبتدی‌ها ─── */}
          <section className="mb-12">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-4 flex items-center gap-2">
              <Lightbulb className="w-6 h-6 text-amber-500" aria-hidden />
              نکات طلایی برای شروع {d.label}
            </h2>
            <ol className="space-y-3">
              {d.beginnerTips.map((t, i) => (
                <li key={i} className="flex items-start gap-3 bg-white rounded-2xl border border-orange-100 p-4 shadow-sm">
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black text-white shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                    aria-hidden
                  >
                    {(i + 1).toLocaleString("fa-IR")}
                  </span>
                  <p className="text-slate-700 leading-7 text-sm">{t}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ─── حرکات اختصاصی رشته (v113 — لینک واقعی /exercise/<id>، بدون کوئری‌استرینگ) ─── */}
          <section id="exercises" aria-label="حرکات این رشته" className="mb-12 scroll-mt-24">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-3 flex items-center gap-2">
              <Dumbbell className="w-6 h-6 text-orange-500" aria-hidden />
              حرکات اختصاصی {d.label} در فیتاپ
            </h2>
            <p className="text-slate-500 text-sm leading-7 mb-5">
              {exercises.length > 0
                ? `${toPersianDigits(exercises.length)} حرکت آموزشی برای ${d.label} در بانک حرکات فیتاپ — روی هر حرکت بزنی، صفحهٔ آموزش کاملش (ویدیو، نحوهٔ اجرا و نکات ایمنی) باز می‌شود.`
                : `مجموعهٔ کامل آموزش حرکات ${d.label} در بانک حرکات فیتاپ منتظر توست — ویدیو، نحوهٔ اجرا و نکات ایمنی هر حرکت.`}
            </p>
            {exercises.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {exercises.map((ex) => (
                  <a
                    key={ex.id}
                    href={`/exercise/${encodeURIComponent(ex.id)}`}
                    className="group bg-white rounded-2xl border border-orange-100 p-4 shadow-sm hover:border-orange-300 hover:shadow-md transition flex flex-col gap-2.5"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                      style={{ background: "#fff7ed", border: "1px solid #ffedd5" }}
                      aria-hidden
                    >
                      {CATEGORY_EMOJI[ex.category] ?? "💪"}
                    </div>
                    <h3 className="font-black text-[13px] sm:text-sm text-slate-900 leading-6 line-clamp-2 group-hover:text-orange-600 transition">
                      {ex.name}
                    </h3>
                    <span className="self-start text-[11px] px-2.5 py-1 rounded-full font-bold bg-orange-50 text-orange-700 border border-orange-100">
                      {ex.muscle || CATEGORY_LABELS[ex.category] || "حرکت"}
                    </span>
                  </a>
                ))}
              </div>
            )}
            <div className="mt-5">
              <a
                href="/exercises"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-600 hover:text-orange-700 transition"
              >
                مشاهده بانک حرکات کامل
                <ChevronLeft className="w-4 h-4" aria-hidden />
              </a>
            </div>
          </section>

          {/* ─── پرسش‌های متداول (accordion ساده با details) ─── */}
          <section className="mb-12">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-4">پرسش‌های متداول دربارهٔ {d.label}</h2>
            <div className="space-y-3">
              {d.faq.map((f, i) => (
                <details key={i} className="group bg-white rounded-2xl border border-orange-100 shadow-sm overflow-hidden">
                  <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer list-none select-none">
                    <span className="font-bold text-sm sm:text-[15px] text-slate-900 leading-6">{f.q}</span>
                    <ChevronDown
                      className="w-5 h-5 text-orange-500 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <p className="px-5 pb-5 text-slate-600 leading-7 text-sm border-t border-orange-50 pt-4">{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* ─── CTA انتهای صفحه ─── */}
          <section className="mb-14">
            <div
              className="relative overflow-hidden rounded-[2rem] p-8 sm:p-12 text-center text-white shadow-2xl"
              style={{ background: "linear-gradient(135deg, #f59e0b 0%, #f97316 55%, #ea580c 100%)" }}
            >
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" aria-hidden />
              <div className="absolute -bottom-14 -left-14 w-56 h-56 rounded-full bg-white/10" aria-hidden />
              <div className="relative">
                <h2 className="text-2xl sm:text-3xl font-black mb-3">آمادهٔ شروع {d.label} هستی؟</h2>
                <p className="text-white/95 text-sm sm:text-base leading-7 max-w-xl mx-auto mb-7">
                  برنامهٔ هفتگی {d.label} — دقیقاً با حرکات تخصصی همین رشته، متناسب با سطح، وزن و شرایط بدنی تو —
                  در چند دقیقه ساخته می‌شود.
                </p>
                <a
                  href="/?screen=onboarding"
                  className="inline-flex items-center justify-center gap-2 bg-white text-orange-600 rounded-2xl h-14 px-8 text-base font-black shadow-xl transition hover:scale-[1.03]"
                >
                  <Zap className="w-5 h-5" />
                  ساخت برنامهٔ تخصصی {d.label}
                  <ChevronLeft className="w-5 h-5" />
                </a>
              </div>
            </div>
          </section>

          {/* ─── رشته‌های دیگر (لینک‌سازی داخلی برای کرالر) ─── */}
          <section className="mb-16">
            <h2 className="text-base font-black text-slate-900 mb-3">رشته‌های دیگر فیتاپ</h2>
            <div className="flex flex-wrap gap-2.5">
              {otherDisciplines.map((o) => (
                <a
                  key={o.slug}
                  href={`/sport/${o.slug}`}
                  className="inline-flex items-center gap-2 bg-white rounded-xl border border-orange-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-orange-300 hover:text-orange-600 transition shadow-sm"
                >
                  <span aria-hidden>{o.emoji}</span>
                  {o.label}
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* ─── فوتر چسبیده (root layout فوتر ندارد — این صفحه فوتر خودش را دارد) ─── */}
      <footer className="mt-auto border-t border-orange-100 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md overflow-hidden"
                style={{ background: "linear-gradient(135deg, #fb923c, #f97316)" }}
              >
                <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
              </div>
              <div>
                <span className="font-black text-slate-900">فیتاپ</span>
                <p className="text-[11px] text-slate-500">هر بدنی فیتاپ میخواد</p>
              </div>
            </div>
            <nav aria-label="لینک‌های فوتر">
              <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-500">
                <li>
                  <a href="/#features" className="hover:text-orange-600 transition">
                    امکانات
                  </a>
                </li>
                <li>
                  <a href="/exercises" className="hover:text-orange-600 transition">
                    بانک حرکات
                  </a>
                </li>
                <li>
                  <a href="/tdee" className="hover:text-orange-600 transition">
                    محاسبه کالری
                  </a>
                </li>
                <li>
                  <a href="/articles" className="hover:text-orange-600 transition">
                    مقالات
                  </a>
                </li>
                <li>
                  <a href="/terms" className="hover:text-orange-600 transition">
                    شرایط و قوانین
                  </a>
                </li>
                <li>
                  <a href="/contact" className="hover:text-orange-600 transition">
                    تماس با ما
                  </a>
                </li>
              </ul>
            </nav>
          </div>
          <p className="text-center text-xs text-slate-400 mt-8">© ۱۴۰۵ فیتاپ — برنامهٔ تمرینی و تغذیهٔ هوشمند</p>
        </div>
      </footer>
    </div>
  );
}
