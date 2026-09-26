import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Calendar, ChevronLeft, Clock, Dumbbell, Home, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import {
  ARTICLE_MD_COMPONENTS,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  extractFaqFromMarkdown,
  normalizeArticleLinks,
} from "@/lib/fitness/article-shared";
import { toPersianDigits } from "@/lib/fitness/types";
import { toWebpServer } from "@/lib/fitness/image-utils";
import { PreferredSourceCard } from "@/components/fitness/articles/preferred-source-card";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { ArticleViewCounter, ArticleShareButton, ArticleMidCta, ArticleFinalCta } from "@/components/fitness/articles/article-client-extras";
import { splitArticleContent } from "@/lib/fitness/article-shared";

/**
 * ─── v105 — صفحهٔ واقعی مقاله (/article/[slug]) — بازیابی سئوی مقالات ───
 *
 * مشکل ریشه‌ای که این صفحه حل می‌کند:
 *  تا v104 مقالات فقط با URL کوئری‌استرینگ (/?article=slug) و فقط با
 *  جاوااسکریپت سمت کاربر رندر می‌شدند؛ متن مقاله در HTML اولیه نبود و
 *  گوگل این ۱٬۴۰۰+ صفحه را عملاً ایندکس نمی‌کرد (query-param URL ها به‌عنوان
 *  صفحهٔ مستقل حساب نمی‌شوند).
 *
 * این صفحه:
 *   ۱) یک route واقعی و تمیز است (/article/creatine-monohydrate-guide)
 *   ۲) محتوای کامل مقاله را SSR می‌کند — بدون هیچ "use client" برای بدنهٔ متن
 *   ۳) canonical اختصاصی + متادیتای کامل از دیتابیس (seoTitle/seoDescription/…)
 *   ۴) JSON-LD سرور-ساید: Article + BreadcrumbList + FAQPage
 *   ۵) مقالات مرتبط با <a> واقعی — مسیر خزش داخلی برای گوگل
 *
 * رندر: ISR با revalidate 600 (۱۰ دقیقه) — اولین درخواست از دیتابیس رندر و
 * کش می‌شود؛ تغییر مقاله حداکثر ۱۰ دقیقه بعد در HTML دیده می‌شود.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 600;

/** خواندن مقاله از دیتابیس — با محافظت try/catch (خطای DB هرگز ۵۰۰ ندهد) */
async function getArticle(slug: string) {
  try {
    return await db.article.findUnique({
      where: { slug },
      include: { author: { select: { id: true, name: true } } },
    });
  } catch {
    return null;
  }
}

async function getRelated(category: string, excludeSlug: string) {
  try {
    const rows = await db.article.findMany({
      where: { status: "published", category },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 4,
      select: { id: true, slug: true, title: true, category: true, coverImage: true },
    });
    return rows.filter((r) => r.slug !== excludeSlug).slice(0, 3);
  } catch {
    return [];
  }
}

/** metadata کامل هر مقاله — canonical واقعی /article/<slug> */
export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  const isScheduledDraft = article?.status === "draft" && !!article.scheduledAt;

  // ناموجود یا unpublished بدون زمان‌بندی → noindex (مثل رفتار 404 خود صفحه)
  if (!article || (article.status !== "published" && !isScheduledDraft)) {
    return {
      title: "مقاله یافت نشد | فیتاپ",
      robots: { index: false, follow: true },
    };
  }

  // مقالهٔ زمان‌بندی‌شده (draft با scheduledAt) — مثل رفتار صفحه: 200 ولی noindex
  if (article.status === "draft") {
    return {
      title: `${article.title} | فیتاپ`,
      robots: { index: false, follow: true },
    };
  }

  const canonical = article.canonicalUrl || `${SITE_URL}/article/${encodeURIComponent(article.slug)}`;
  const title = (article.seoTitle || article.title) + " | فیتاپ";
  const description = article.seoDescription || article.excerpt || "";
  const ogImage = article.ogImage || article.coverImage || `${SITE_URL}/fitup-logo.png`;

  return {
    title: { absolute: title },
    description,
    keywords: article.metaKeywords || article.tags || undefined,
    robots: article.robots || "index,follow",
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "article",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [{ url: ogImage, width: 1200, height: 630, alt: article.title }],
      publishedTime: article.publishedAt?.toISOString() || undefined,
      modifiedTime: article.updatedAt.toISOString(),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

/* ─── JSON-LD سرور-ساید (Article + BreadcrumbList + FAQPage) ───
    v123 — سخت‌سازی hydration (ارور «Recoverable Error» مالک روی این صفحه):
    ۱) «<» در payload به \u003C escape می‌شود — دیگر هیچ دنبالهٔ «</…» یا
       «<!--» (از محتوای مقاله/FAQ) نمی‌تواند پارسر HTML را وسط اسکریپت
       بشکند و ساختار درخت را جابه‌جا کند (ریشهٔ کلاس mismatch های
       «script به‌جای div»).
    ۲) هر اسکریپت id پایدار + suppressHydrationWarning دارد تا React 19
       هنگام هیدریشن این نودها را دقیق‌تر و بی‌هشدار تطبیق دهد. */
function jsonLdScriptContent(block: object): string {
  return JSON.stringify(block).replace(/</g, "\\u003c");
}

function buildJsonLd(article: {
  title: string; slug: string; excerpt: string; content: string; coverImage: string;
  ogImage: string; authorName?: string; publishedAt: Date | null; createdAt: Date;
  updatedAt: Date;
}): object[] {
  const canonical = `${SITE_URL}/article/${encodeURIComponent(article.slug)}`;
  const image = article.ogImage || article.coverImage || `${SITE_URL}/fitup-logo.png`;

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt || "",
    image,
    datePublished: (article.publishedAt || article.createdAt).toISOString(),
    dateModified: article.updatedAt.toISOString(),
    author: { "@type": "Organization", name: article.authorName || "فیتاپ" },
    publisher: {
      "@type": "Organization",
      name: "فیتاپ",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/fitup-logo.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "مقالات", item: `${SITE_URL}/articles` },
      { "@type": "ListItem", position: 3, name: article.title, item: canonical },
    ],
  };

  const blocks: object[] = [articleSchema, breadcrumbSchema];

  // FAQPage از محتوای Markdown (بخش «سوالات متداول»)
  const faqItems = extractFaqFromMarkdown(article.content || "");
  if (faqItems.length > 0) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }

  return blocks;
}

export default async function ArticleDetailPage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await getArticle(slug);

  // مقالهٔ ناموجود → 🔧 v130 (دیرکتیو مالک «هیچ لینک شکسته‌ای نباید باشد»):
  // 308 دائمی به آرشیو مقالات به‌جای 404 — لینک‌های تاریخی/ایندکس‌شده همیشه
  // به مقصد معتبر می‌رسند و اعتبار سئو حفظ می‌شود.
  if (!article) permanentRedirect("/articles");

  // مقالهٔ draft بدون زمان‌بندی → 404 (همان رفتار API)
  if (article.status !== "published" && !(article.status === "draft" && article.scheduledAt)) {
    notFound();
  }

  // مقالهٔ زمان‌بندی‌شده — صفحهٔ محدود «به‌زودی» (گوگل 404 نبیند — noindex)
  if (article.status === "draft") {
    return (
      <div className="min-h-screen bg-white flex flex-col" dir="rtl">
        <ArticleTopNav />
        <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-16 text-center">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 mb-3">{article.title}</h1>
          <p className="text-slate-500">این مقاله به‌زودی منتشر می‌شود — منتظر باشید.</p>
          <Link href="/articles" className="inline-flex items-center gap-1 mt-8 text-sm font-bold text-orange-600 hover:text-orange-700 transition">
            <ChevronLeft className="w-4 h-4" />
            بازگشت به مجله فیتاپ
          </Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const related = await getRelated(article.category, article.slug);
  const jsonLdBlocks = buildJsonLd({
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    content: article.content,
    coverImage: article.coverImage,
    ogImage: article.ogImage,
    authorName: article.author?.name ?? undefined,
    publishedAt: article.publishedAt,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  });
  const authorName = article.author?.name || "تیم فیتاپ";
  const publishDate = new Date(article.publishedAt || article.createdAt).toLocaleDateString("fa-IR");
  const coverSrc = article.coverImage ? toWebpServer(article.coverImage) : "";

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      {/* JSON-LD — سرور-ساید، مستقل از جاوااسکریپت (v123 — سخت‌سازی hydration) */}
      {jsonLdBlocks.map((block, i) => (
        <script
          key={i}
          id={`ld-article-${i}`}
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(block) }}
        />
      ))}

      <ArticleTopNav />

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 py-6 w-full">
          {/* Breadcrumb قابل دیدن و کلیک */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5 flex-wrap">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <Link href="/articles" className="hover:text-orange-600 transition">مقالات</Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600 line-clamp-1">{article.title}</span>
          </nav>

          {/* Category + meta */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className={`text-[11px] px-3 py-1 rounded-full font-bold ${CATEGORY_COLORS[article.category] || CATEGORY_COLORS["عمومی"]}`}>
              {CATEGORY_LABELS[article.category] || article.category}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <Calendar className="w-3.5 h-3.5" />
              {publishDate}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <Clock className="w-3.5 h-3.5" />
              {toPersianDigits(article.readingMinutes || 3)} دقیقه مطالعه
            </span>
            {/* v119 — شمارندهٔ بازدید (افزایش best-effort سمت کلاینت — پورت از نسخهٔ SPA) */}
            <ArticleViewCounter slug={article.slug} initialViews={article.views} />
          </div>

          {/* Title */}
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-3 leading-tight">
            {article.title}
          </h1>

          {/* Excerpt */}
          {article.excerpt && (
            <p className="text-base text-slate-600 mb-6 leading-relaxed">{article.excerpt}</p>
          )}

          {/* Cover image */}
          {coverSrc && (
            <div className="rounded-2xl overflow-hidden mb-6 shadow-lg bg-orange-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverSrc}
                alt={article.title}
                width={1200}
                height={675}
                className="w-full aspect-[16/9] object-cover"
                fetchPriority="high"
              />
            </div>
          )}

          {/* Author + share (v119 — اشتراک‌گذاری پورت از نسخهٔ SPA) */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50/50 border border-orange-100 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                {authorName.charAt(0) || "ف"}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">{authorName}</p>
                <p className="text-[10px] text-slate-500">نویسنده فیتاپ</p>
              </div>
            </div>
            <ArticleShareButton title={article.title} slug={article.slug} />
          </div>

          {/* Content — کاملاً SSR، بدون هیچ جاوااسکریپتی
              v119 — CTA وسط مقاله (v59 پورت از SPA): متن به دو نیم تقسیم می‌شود
              و کارت CTA بین آن‌ها رندر می‌شود (تقسیم فقط روی مرز بلوک‌های
              Markdown — جدول/لیست نمی‌شکند) */}
          <div className="prose prose-slate max-w-none article-content fitup-article">
            {(() => {
              const halves = splitArticleContent(normalizeArticleLinks(article.content));
              if (!halves) {
                return (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={ARTICLE_MD_COMPONENTS}>
                    {normalizeArticleLinks(article.content)}
                  </ReactMarkdown>
                );
              }
              return (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={ARTICLE_MD_COMPONENTS}>
                    {halves.top}
                  </ReactMarkdown>
                  <ArticleMidCta />
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={ARTICLE_MD_COMPONENTS}>
                    {halves.bottom}
                  </ReactMarkdown>
                </>
              );
            })()}
          </div>

          {/* Tags */}
          {article.tags && (
            <div className="flex items-center gap-2 flex-wrap mt-8 pt-6 border-t border-slate-100">
              <span className="text-xs text-slate-400">تگ‌ها:</span>
              {article.tags.split(",").map((t, i) => (
                <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">#{t.trim()}</span>
              ))}
            </div>
          )}

          {/* بج Preferred Source گوگل — همان کامپوننت مشترک */}
          <PreferredSourceCard />

          {/* CTA پایانی — v119: هوشمند بر اساس وضعیت کاربر (مهمان/بی‌پلن/پلن‌دار) */}
          <ArticleFinalCta />

          {/* Related articles — لینک‌های واقعی برای خزش گوگل */}
          {related.length > 0 && (
            <div className="mt-12">
              <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-orange-500" />
                مقالات مرتبط
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {related.map((r) => (
                  <Link key={r.id} href={`/article/${encodeURIComponent(r.slug)}`} className="text-right group">
                    <div className="rounded-2xl overflow-hidden border-2 border-orange-100 hover:border-orange-300 transition-all hover:shadow-lg bg-white">
                      {r.coverImage ? (
                        <div className="aspect-[16/9] overflow-hidden relative bg-orange-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={toWebpServer(r.coverImage)}
                            alt={r.title}
                            width={280}
                            height={158}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </div>
                      ) : (
                        <div className="aspect-[16/9] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                          <Dumbbell className="w-8 h-8 text-orange-300" />
                        </div>
                      )}
                      <div className="p-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${CATEGORY_COLORS[r.category] || CATEGORY_COLORS["عمومی"]}`}>
                          {CATEGORY_LABELS[r.category] || r.category}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 mt-1.5 line-clamp-2 group-hover:text-orange-600 transition">{r.title}</h4>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─── هدر مقاله — همهٔ آیتم‌ها لینک واقعی هستند (فوتر مشترک در site-footer.tsx) ─── */
function ArticleTopNav() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/articles" className="flex items-center gap-1 text-sm text-slate-600 hover:text-orange-600 transition">
          <ChevronLeft className="w-4 h-4" />
          بازگشت به مقالات
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
