import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BookOpen,
  Calendar,
  ChevronLeft,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Newspaper,
  PenLine,
  Sparkles,
} from "lucide-react";
import { db } from "@/lib/db";
// v251 — تک‌منبع حقیقت اسلاگ نویسنده (مشترک با باکس مقاله‌ها)
import { authorSlugFromName } from "@/lib/fitness/author-slug";
import { toPersianDigits } from "@/lib/fitness/types";
import { fitupOrgRef, FITUP_SITE_URL } from "@/lib/fitness/schema-org";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/fitness/article-shared";
import { toWebpServer } from "@/lib/fitness/image-utils";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
// v211 — سیاست نیکا: ویجت شناور در همهٔ صفحات محتوایی (الگوی articles)
import { NikaWidget } from "@/components/fitness/nika-widget";
// v252 — آواتار نویسنده (کلاینتی — پرترهٔ واقعی حسین جوان با فال‌بک مونوگرام)
import { AuthorAvatar } from "./author-avatar";

/**
 * ─── صفحهٔ نویسنده (/author/[slug]) — سیگنال E-E-A-T برای گوگل ───
 *
 * چرا این صفحه؟
 *   مقالات مجله فیلد نویسنده (Article → User) دارند؛ اما تا امروز هیچ صفحهٔ
 *   مستقلی برای نویسنده وجود نداشت — گوگل نمی‌توانست «چه کسی این محتوا را
 *   نوشته» (Experience / Expertise / Authoritativeness) را به موجودیت واقعی
 *   گره بزند. این صفحه هویت نویسنده را با JSON-LD از نوع Person (با worksFor
 *   به Organization کانونی از schema-org.ts)، BreadcrumbList، لیست کامل
 *   مقالات منتشرشده و بیوی مبتنی بر ادعاهای واقعی صفحهٔ درباره‌ما می‌سازد.
 *
 * تصمیم‌های کلیدی:
 *   ۱) slug = نسخهٔ لاتین-کبابِ دترمینیستیک از نام نویسنده (authorSlugFromName):
 *      نگاشت صریح برای نویسنده‌های واقعی دیتابیس + fallback آوانگاری فارسی→لاتین
 *      (هیچ اسلاگی به شانس واگذار نمی‌شود؛ همان تابع هم برای generateStaticParams
 *      و هم برای حل slug→author استفاده می‌شود تا همیشه سازگار بمانند).
 *   ۲) generateStaticParams از DISTINCT نویسنده‌های مقالات «منتشرشده» +
 *      dynamicParams = false → اسلاگ ناشناخته = 404 واقعی (بدون loading.tsx
 *      و بدون soft-404) — همان رویکرد سخت‌گیری که مقاله‌ها دارند (v218).
 *   ۳) تاریخ‌ها با فرمول جلالیِ خالص + toPersianDigits رندر می‌شوند —
 *      هرگز toLocaleString("fa-IR") (وابسته به ICU سرور و غیردترمینیستیک
 *      بین محیط‌ها) استفاده نمی‌شود.
 *   ۴) بیو فقط ادعاهای موجود در صفحهٔ درباره‌ما (src/app/about/page.tsx و
 *      کامپوننت about-page) را بازگو می‌کند — هیچ ادعای تحصیلی/سابقه‌ایِ
 *      ازخوددرآوردی مجاز نیست (اعتبار E-E-A-T با اغراق نابود می‌شود).
 *
 * رندر: ISR با revalidate 600 (۱۰ دقیقه) — هم‌راستا با صفحهٔ مقاله
 */

const SITE_URL = FITUP_SITE_URL;

export const revalidate = 600;
// اسلاگ ناشناخته → 404 واقعی (نه رندر داینامیک، نه soft-404)
export const dynamicParams = false;

interface AuthorPageProps {
  params: Promise<{ slug: string }>;
}

/* ═══════════════ ۱) اسلاگ دترمینیستیک نویسنده ═══════════════ */

/** نگاشت صریح نویسنده‌های واقعی دیتابیس به اسلاگ خوانا (منبع: DISTINCT authorهای مقالات منتشرشده در db/custom.db) */


/* ═══════════════ ۲) تاریخ جلالی دترمینیستیک (بدون toLocaleString) ═══════════════ */

const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** الگوریتم استاندارد میلادی→جلالی (بدون وابستگی خارجی — خروجی همیشه یکسان) */
function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gDayCumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) - 80 + gd + gDayCumulative[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

/**
 * تاریخ شمسی دترمینیستیک از epoch — مثال خروجی: «۲۳ آبان ۱۴۰۴».
 * آفست تهران UTC+3:30 ثابت است (ایران از ۱۴۰۱ ساعت تابستانی ندارد؛
 * مقالات همه از ۱۴۰۴ به بعد هستند) — پس getUTC* پس از شیفت، دقیق و پایدار است.
 */
function formatJalaliDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const tehran = new Date(ms + 210 * 60 * 1000);
  const [jy, jm, jd] = gregorianToJalali(tehran.getUTCFullYear(), tehran.getUTCMonth() + 1, tehran.getUTCDate());
  return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

/* ═══════════════ ۳) داده‌های نویسنده از دیتابیس ═══════════════ */

interface PublishedAuthor {
  id: string;
  name: string;
  slug: string;
}

/** نویسنده‌های واقعی مقالات منتشرشده (DISTINCT) — با try/catch (خطای DB هرگز ۵۰۰ ندهد) */
async function getPublishedAuthors(): Promise<PublishedAuthor[]> {
  try {
    const rows = await db.article.findMany({
      where: { status: "published", authorId: { not: null } },
      distinct: ["authorId"],
      select: { authorId: true, author: { select: { name: true } } },
    });
    const seen = new Set<string>();
    const list: PublishedAuthor[] = [];
    for (const r of rows) {
      const name = r.author?.name?.trim();
      if (!name || !r.authorId) continue;
      const slug = authorSlugFromName(name);
      if (seen.has(slug)) continue; // دو نام مختلف به یک اسلاگ نرسند (اولویت با اولین)
      seen.add(slug);
      list.push({ id: r.authorId, name, slug });
    }
    return list.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  } catch {
    return [];
  }
}

interface AuthorArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  coverImage: string;
  readingMinutes: number;
  publishedAt: Date | null;
  createdAt: Date;
}

/** نویسندهٔ متناظر با slug + همهٔ مقالات منتشرشدهٔ او (جدیدترین اول) */
async function getAuthorWithArticles(slug: string): Promise<{ author: PublishedAuthor; articles: AuthorArticle[] } | null> {
  const authors = await getPublishedAuthors();
  const author = authors.find((a) => a.slug === slug);
  if (!author) return null;
  try {
    const articles = await db.article.findMany({
      where: { status: "published", authorId: author.id },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, slug: true, title: true, excerpt: true, category: true,
        coverImage: true, readingMinutes: true, publishedAt: true, createdAt: true,
      },
    });
    return { author, articles };
  } catch {
    return { author, articles: [] };
  }
}

/* ═══════════════ ۴) پروفایل نویسنده — فقط ادعاهای واقعی صفحهٔ درباره‌ما ═══════════════ */

interface AuthorProfile {
  roleLine: string; // زیرعنوان نمایشی (و دنبالهٔ title متا)
  jobTitle: string; // schema.org jobTitle
  bio: string[]; // ۲-۳ بند — بازگویی ادعاهای /about بدون افزودنی
  chips: string[]; // بج‌های اعتبار (E-E-A-T)
  sameAs: string[]; // پروفایل واقعی خارجی — اگر چیزی نبود خالی می‌ماند
  alumniOf?: string;
  aboutCtaTitle: string;
  aboutCtaDesc: string;
  alternateName?: string;
  knowsAbout: string[];
}

/** پروفایل نمایشی هر نویسنده — همهٔ ادعاها از صفحهٔ درباره‌ما (about-page.tsx) */
function getAuthorProfile(name: string): AuthorProfile {
  if (name === "حسین جوان") {
    return {
      roleLine: "نویسنده و بنیان‌گذار فیتاپ",
      jobTitle: "عکاس حرفه‌ای، مؤلف و بنیان‌گذار فیتاپ",
      alternateName: "Hossein Javan",
      bio: [
        "حسین جوان بنیان‌گذار فیتاپ است؛ عکاس حرفه‌ای با بیش از ۱۲ سال تجربه که از طریق فوتوگالری جوان بیش از ۴٬۰۰۰ پروژهٔ عکاسی را اجرا کرده — فعال در ۲۲ رشتهٔ عکاسی و فیلم‌برداری — و مؤلف کتاب «عکاس جوان» است.",
        "او بیش از ۸ سال است که با جدیت بدنسازی کار می‌کند و هم‌زمان مقاله‌به‌مقاله و کتاب‌به‌کتاب در علم تمرین، فیزیولوژی ورزشی و تغذیهٔ ورزشی مدرن تحقیق کرده است؛ حاصل این هشت سال تمرین و تحقیقِ بی‌وقفه، امروز ستون علمی مقالات مجلهٔ فیتاپ است.",
        "فارغ‌التحصیل دانشگاه تهران؛ فیتاپ را ساخت تا همان چیزی باشد که خودش در سال‌های تمرین آرزویش را داشت: برنامهٔ تمرینی و غذاییِ شخصی‌سازی‌شده با مربیِ همیشه‌در‌دسترس، چکاپ منظم پیشرفت و تحلیل دقیق — در جیب هر ورزشکار ایرانی.",
      ],
      chips: ["بنیان‌گذار فیتاپ", "عکاس حرفه‌ای", "مؤلف کتاب «عکاس جوان»", "دانشگاه تهران"],
      sameAs: ["https://hosseinjavan.com"],
      alumniOf: "دانشگاه تهران",
      aboutCtaTitle: "داستان فیتاپ از زبان بنیان‌گذار",
      aboutCtaDesc: "از دوربین تا هالتر؛ چرا و چگونه فیتاپ ساخته شد — روایت کامل در صفحهٔ درباره‌ما.",
      knowsAbout: ["بدنسازی", "تغذیه ورزشی", "مکمل‌های ورزشی", "برنامه‌های تمرینی", "حرکات اصلاحی"],
    };
  }
  // سایر نویسنده‌ها (حساب تیمی) — بدون هیچ ادعای شخصیِ ازخوددرآوردی
  return {
    roleLine: "نویسنده مجله فیتاپ",
    jobTitle: "تیم محتوای فیتاپ",
    bio: [
      "مدیر سیستم، حساب تیمی فیتاپ است؛ مقالات این صفحه توسط تیم محتوای فیتاپ نگارش، ویرایش و منتشر شده‌اند.",
      "تمرکز این مقالات بر برنامه‌های تمرینی کاربردی، آموزش حرکات و تغذیهٔ ورزشی است — با همان رویکرد فیتاپ: ساده، دقیق و بر اساس علم روز.",
    ],
    chips: ["تیم محتوای فیتاپ"],
    sameAs: [],
    aboutCtaTitle: "درباره فیتاپ",
    aboutCtaDesc: "اهداف فیتاپ و داستان ساخت آن را در صفحهٔ درباره‌ما بخوانید.",
    knowsAbout: ["برنامه‌های تمرینی", "حرکات اصلاحی", "تغذیه ورزشی"],
  };
}

/* ═══════════════ ۵) Static params — از نویسنده‌های واقعی دیتابیس ═══════════════ */

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const authors = await getPublishedAuthors();
  return authors.map((a) => ({ slug: a.slug }));
}

/* ═══════════════ ۶) متادیتا ═══════════════ */

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const found = await getAuthorWithArticles(slug);

  // با dynamicParams=false عملاً نمی‌رسد؛ محکم‌کاری برای هر مسیر غیرمنتظره
  if (!found) {
    return {
      title: { absolute: "نویسنده یافت نشد | فیتاپ" }, // v251-seo — ضد دوبل-برند
      robots: { index: false, follow: true },
    };
  }

  const { author, articles } = found;
  const profile = getAuthorProfile(author.name);
  const canonical = `${SITE_URL}/author/${encodeURIComponent(author.slug)}`;
  const topicList = [...new Set(articles.map((a) => CATEGORY_LABELS[a.category] || a.category))]
    .slice(0, 4)
    .join("، ");
  const title = `${author.name} | ${profile.roleLine}`;
  const description = `${author.name}، ${profile.roleLine}؛ ${toPersianDigits(articles.length)} مقالهٔ منتشرشده در مجلهٔ فیتاپ دربارهٔ ${topicList}.`;
  // og:image — v252: برای حسین جوان پرترهٔ واقعی (همان عکس درباره‌ما)؛ بقیه لوگو
  const ogImage = author.name === "حسین جوان"
    ? `${SITE_URL}/images/hossein-javan.webp`
    : `${SITE_URL}/fitup-logo.png`;
  const [firstName, ...restName] = author.name.split(" ");

  return {
    title: { absolute: title },
    description,
    robots: "index,follow",
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "profile",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [{ url: ogImage, width: 512, height: 512, alt: `${author.name} — ${profile.roleLine}` }],
      firstName: firstName || author.name,
      lastName: restName.join(" ") || undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [ogImage],
    },
  };
}

/* ═══════════════ ۷) JSON-LD — Person + BreadcrumbList ═══════════════ */

/** همان الگوی سخت‌سازی hydration صفحهٔ مقاله: escape «<» + id پایدار */
function jsonLdScriptContent(block: object): string {
  return JSON.stringify(block).replace(/</g, "\\u003c");
}

function buildAuthorJsonLd(author: PublishedAuthor, articles: AuthorArticle[]): object[] {
  const profile = getAuthorProfile(author.name);
  const authorUrl = `${SITE_URL}/author/${encodeURIComponent(author.slug)}`;
  const topics = [...new Set(articles.map((a) => CATEGORY_LABELS[a.category] || a.category))];

  const personSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${authorUrl}#person`,
    name: author.name,
    ...(profile.alternateName ? { alternateName: profile.alternateName } : {}),
    jobTitle: profile.jobTitle,
    description: profile.bio[0] || "",
    url: authorUrl,
    // ارجاع به Organization کانونی فیتاپ (@id مشترک با root layout — بدون تکرار موجودیت)
    worksFor: fitupOrgRef(),
    knowsAbout: [...new Set([...profile.knowsAbout, ...topics])],
  };
  // sameAs فقط با لینک واقعی؛ اگر چیزی نبود کلاً حذف می‌شود (لینک دروغین = سیگنال منفی)
  if (profile.sameAs.length > 0) personSchema.sameAs = profile.sameAs;
  if (profile.alumniOf) personSchema.alumniOf = { "@type": "CollegeOrUniversity", name: profile.alumniOf };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "مجله فیتاپ", item: `${SITE_URL}/articles` },
      { "@type": "ListItem", position: 3, name: author.name, item: authorUrl },
    ],
  };

  return [personSchema, breadcrumbSchema];
}

/* ═══════════════ ۸) صفحه ═══════════════ */

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { slug } = await params;
  const found = await getAuthorWithArticles(slug);

  // محکم‌کاری: با dynamicParams=false نمی‌رسد، اما اگر رسید → 404 واقعی
  if (!found) notFound();

  const { author, articles } = found;
  const profile = getAuthorProfile(author.name);
  const jsonLdBlocks = buildAuthorJsonLd(author, articles);

  // آمار واقعی (محاسبه‌شده از خود لیست — نه عدد دستی)
  const articleCount = articles.length;
  const topicMap = new Map<string, number>();
  for (const a of articles) topicMap.set(a.category, (topicMap.get(a.category) || 0) + 1);
  const topicCount = topicMap.size;
  const totalMinutes = articles.reduce((s, a) => s + (a.readingMinutes || 3), 0);
  const firstPublishMs = articles.length
    ? Math.min(...articles.map((a) => (a.publishedAt || a.createdAt).getTime()))
    : null;

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      {/* JSON-LD — سرور-ساید، مستقل از جاوااسکریپت */}
      {jsonLdBlocks.map((block, i) => (
        <script
          key={i}
          id={`ld-author-${i}`}
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(block) }}
        />
      ))}

      <AuthorTopNav />

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-4 py-6 w-full">
          {/* Breadcrumb قابل دیدن و کلیک */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5 flex-wrap">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <Link href="/articles" className="hover:text-orange-600 transition">مجله فیتاپ</Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600">{author.name}</span>
          </nav>

          {/* ─── کارت هویت نویسنده ─── */}
          <section
            aria-labelledby="author-name"
            className="rounded-3xl border border-amber-100 bg-gradient-to-b from-amber-50/80 to-white p-5 sm:p-7 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
              {/* v252 — پرترهٔ واقعی حسین جوان (درخواست مالک: به‌جای مونوگرام «ح»،
                  «همون عکسی که در صفحه درباره ما هست») — همان مسیر رسمی
                  /images/hossein-javan.webp که درباره‌ما استفاده می‌کند؛ اگر عکس
                  به هر دلیل لود نشد، فال‌بک خودکار به مونوگرام (بدون باگ ظاهری). */}
              <AuthorAvatar name={author.name} />
              <div className="text-center sm:text-right flex-1">
                <h1 id="author-name" className="text-2xl sm:text-3xl font-black text-slate-900 leading-tight">
                  {author.name}
                </h1>
                <p className="text-sm font-bold text-amber-600 mt-1">{profile.roleLine}</p>
                {profile.chips.length > 0 && (
                  <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap mt-3">
                    {profile.alumniOf && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 font-bold text-emerald-700">
                        <GraduationCap className="w-3.5 h-3.5" />
                        {profile.alumniOf}
                      </span>
                    )}
                    {profile.chips.map((chip) => (
                      <span key={chip} className="text-[11px] px-3 py-1 rounded-full bg-orange-50 border border-orange-100 font-bold text-orange-700">
                        {chip}
                      </span>
                    ))}
                    {profile.sameAs.length > 0 && (
                      <a
                        href={profile.sameAs[0]}
                        target="_blank"
                        rel="nofollow noopener"
                        className="inline-flex items-center gap-1 text-[11px] px-3 py-1 rounded-full bg-slate-100 border border-slate-200 font-bold text-slate-600 hover:text-orange-600 hover:border-orange-200 transition"
                      >
                        وب‌سایت شخصی
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* بیو — فقط ادعاهای واقعی صفحهٔ درباره‌ما */}
            <div className="mt-5 space-y-3">
              {profile.bio.map((para, i) => (
                <p key={i} className="text-sm sm:text-[15px] text-slate-700 leading-loose">
                  {para}
                </p>
              ))}
            </div>

            {/* آمار واقعی نویسنده */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
              <div className="rounded-2xl bg-white border border-slate-100 p-4 text-center">
                <FileText className="w-4 h-4 text-orange-500 mx-auto mb-1.5" aria-hidden="true" />
                <p className="text-xl font-black text-slate-900">{toPersianDigits(articleCount)}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">مقاله منتشرشده</p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-100 p-4 text-center">
                <Layers className="w-4 h-4 text-amber-500 mx-auto mb-1.5" aria-hidden="true" />
                <p className="text-xl font-black text-slate-900">{toPersianDigits(topicCount)}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">موضوع تخصصی</p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-100 p-4 text-center">
                <Clock className="w-4 h-4 text-orange-500 mx-auto mb-1.5" aria-hidden="true" />
                <p className="text-xl font-black text-slate-900">{toPersianDigits(totalMinutes)}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">دقیقه محتوای آموزشی</p>
              </div>
              <div className="rounded-2xl bg-white border border-slate-100 p-4 text-center">
                <Calendar className="w-4 h-4 text-emerald-500 mx-auto mb-1.5" aria-hidden="true" />
                <p className="text-sm font-black text-slate-900 leading-6">{firstPublishMs ? formatJalaliDate(firstPublishMs) : "—"}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">اولین مقاله</p>
              </div>
            </div>

            {/* موضوعات با تعداد واقعی */}
            {topicCount > 0 && (
              <div className="flex items-center gap-2 flex-wrap mt-5" aria-label="موضوعات مقالات این نویسنده">
                {[...topicMap.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, count]) => (
                    <span
                      key={cat}
                      className={`text-[11px] px-3 py-1 rounded-full font-bold ${CATEGORY_COLORS[cat] || CATEGORY_COLORS["عمومی"]}`}
                    >
                      {CATEGORY_LABELS[cat] || cat} ({toPersianDigits(count)})
                    </span>
                  ))}
              </div>
            )}
          </section>

          {/* ─── لیست کامل مقالات نویسنده ─── */}
          <section aria-labelledby="author-articles-title" className="mt-10">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 id="author-articles-title" className="text-lg font-black text-slate-900 flex items-center gap-2">
                <PenLine className="w-5 h-5 text-orange-500" aria-hidden="true" />
                مقالات {author.name} در مجله فیتاپ
              </h2>
              {articleCount > 0 && (
                <span className="text-[11px] px-3 py-1 rounded-full bg-amber-100 text-amber-700 font-bold">
                  {toPersianDigits(articleCount)} مقاله
                </span>
              )}
            </div>

            {articleCount === 0 ? (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-8 text-center text-sm text-slate-500">
                هنوز مقاله‌ای برای این نویسنده منتشر نشده است.
              </div>
            ) : (
              /* لیست بلند: ارتفاع محدود + اسکرول با اسکرول‌بار سفارشی — لینک‌ها همه در HTML سرور هستند (SSR) */
              <div className="max-h-[44rem] overflow-y-auto px-0.5 [scrollbar-width:thin] [scrollbar-color:#fde68a_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-amber-300">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
                  {articles.map((a) => (
                    <AuthorArticleCard key={a.id} article={a} />
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ─── CTA: درباره ما + همه مقالات ─── */}
          <section aria-label="لینک‌های مرتبط" className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
            <Link
              href="/about"
              className="group rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 hover:shadow-md hover:border-orange-300 transition-all"
            >
              <Sparkles className="w-5 h-5 text-amber-500 mb-2" aria-hidden="true" />
              <h3 className="text-sm font-black text-slate-900 group-hover:text-orange-700 transition">{profile.aboutCtaTitle}</h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{profile.aboutCtaDesc}</p>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 mt-3">
                <ChevronLeft className="w-4 h-4" />
                مشاهده صفحه درباره ما
              </span>
            </Link>
            <Link
              href="/articles"
              className="group rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 hover:shadow-md hover:border-emerald-300 transition-all"
            >
              <BookOpen className="w-5 h-5 text-emerald-600 mb-2" aria-hidden="true" />
              <h3 className="text-sm font-black text-slate-900 group-hover:text-emerald-700 transition">همه مقالات مجله فیتاپ</h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                مرور تخصصی بدنسازی، تغذیه، مکمل و تمرین — به زبان ساده و بر اساس علم روز.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 mt-3">
                <ChevronLeft className="w-4 h-4" />
                رفتن به مجله
              </span>
            </Link>
          </section>
        </div>
      </main>

      <SiteFooter />

      {/* سیاست نیکا: ویجت شناور در صفحات محتوایی عمومی (الگوی articles) */}
      <NikaWidget context="public" />
    </div>
  );
}

/* ═══════════════ ۹) اجزای محلی صفحه ═══════════════ */

/** کارت مقاله — همان زبان بصری مجله (کاور + دسته + عنوان + تاریخ شمسی دترمینیستیک) */
function AuthorArticleCard({ article: a }: { article: AuthorArticle }) {
  const dateLabel = formatJalaliDate((a.publishedAt || a.createdAt).getTime());
  const coverSrc = a.coverImage ? toWebpServer(a.coverImage) : "";
  return (
    <Link href={`/article/${encodeURIComponent(a.slug)}`} className="group">
      <article className="rounded-2xl overflow-hidden border-2 border-orange-100 hover:border-orange-300 transition-all hover:shadow-lg bg-white h-full flex flex-col">
        {coverSrc ? (
          <div className="aspect-[16/9] overflow-hidden relative bg-orange-50 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverSrc}
              alt={a.title}
              width={400}
              height={225}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          </div>
        ) : (
          <div className="aspect-[16/9] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center shrink-0">
            <Newspaper className="w-10 h-10 text-orange-300" aria-hidden="true" />
          </div>
        )}
        <div className="p-4 flex flex-col flex-1">
          <span className={`self-start text-[10px] px-2 py-0.5 rounded-full font-bold ${CATEGORY_COLORS[a.category] || CATEGORY_COLORS["عمومی"]}`}>
            {CATEGORY_LABELS[a.category] || a.category}
          </span>
          <h3 className="text-sm font-bold text-slate-900 mt-2 line-clamp-2 leading-relaxed group-hover:text-orange-600 transition">
            {a.title}
          </h3>
          {a.excerpt && (
            <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">{a.excerpt}</p>
          )}
          <div className="flex items-center gap-3 mt-auto pt-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" aria-hidden="true" />
              {dateLabel}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {toPersianDigits(a.readingMinutes || 3)} دقیقه
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

/** هدر صفحهٔ نویسنده — همان الگوی ArticleTopNav (همهٔ آیتم‌ها لینک واقعی) */
function AuthorTopNav() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/articles" className="flex items-center gap-1 text-sm text-slate-600 hover:text-orange-600 transition">
          <ChevronLeft className="w-4 h-4" />
          بازگشت به مجله
        </Link>
        <Link href="/" className="flex items-center gap-2" aria-label="فیتاپ — صفحه اصلی">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
          </div>
          <span className="font-black text-sm text-slate-900">مجله فیتاپ</span>
        </Link>
      </div>
    </header>
  );
}
