import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, Clock, Newspaper } from "lucide-react";
import { db } from "@/lib/db";
import {
  ARTICLE_CATEGORY_ORDER,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
} from "@/lib/fitness/article-shared";
import { toPersianDigits } from "@/lib/fitness/types";
import { toWebpServer } from "@/lib/fitness/image-utils";
import { SiteFooter } from "./site-footer";
import { ArticlesSearchBox } from "./articles-search-box";

/**
 * ─── v105 — صفحهٔ مجلهٔ فیتاپ (/articles) — کامپوننت مشترک SSR ───
 *
 * چرا این صفحه وجود دارد:
 *  تا v104 لیست مقالات فقط در SPA (?screen=articles) بود و دکمهٔ «مقالات»
 *  منو هم یک <button> جاوااسکریپتی بود — گوگل نه لینکی می‌دید نه محتوا.
 *  این کامپوننت توسط ۴ route واقعی استفاده می‌شود:
 *    /articles ، /articles/page/[n] ، /articles/category/[c] ، /articles/category/[c]/page/[n]
 *  و با <a> واقعی به هر مقاله لینک می‌دهد — مسیر خزش کامل برای گوگل:
 *  صفحهٔ اصلی ← /articles ← /article/[slug]
 */

export const ARTICLES_PAGE_SIZE = 24;

export type ArticlesIndexArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  coverImage: string;
  readingMinutes: number;
  publishedAt: Date | null;
  createdAt: Date;
};

export type ArticlesIndexData = {
  articles: ArticlesIndexArticle[];
  total: number;
  categories: { category: string; count: number }[];
};

/** خواندن دادهٔ ایندکس از دیتابیس — مقاوم به خطا (هر بخش مستقل)
 *  v119 — پشتیبانی جستجو (?search=) — پورت قابلیت جستجوی نسخهٔ SPA */
export async function getArticlesIndexData(
  page: number,
  category?: string,
  search?: string
): Promise<ArticlesIndexData> {
  const where: Record<string, unknown> = { status: "published" };
  if (category) where.category = category;
  const q = search?.trim();
  if (q) {
    where.OR = [{ title: { contains: q } }, { excerpt: { contains: q } }, { tags: { contains: q } }];
  }

  const [total, articles, categories] = await Promise.all([
    db.article.count({ where }).catch(() => 0),
    db.article
      .findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * ARTICLES_PAGE_SIZE,
        take: ARTICLES_PAGE_SIZE,
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          category: true,
          coverImage: true,
          readingMinutes: true,
          publishedAt: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    db.article
      .groupBy({ by: ["category"], where: { status: "published" }, _count: { _all: true } })
      .catch(() => [] as { category: string | null; _count: { _all: number } }[]),
  ]);

  const catList = (categories as { category: string | null; _count: { _all: number } }[])
    .filter((c): c is { category: string; _count: { _all: number } } => !!c.category)
    .map((c) => ({ category: c.category, count: c._count._all }))
    .sort((a, b) => {
      const ia = ARTICLE_CATEGORY_ORDER.indexOf(a.category);
      const ib = ARTICLE_CATEGORY_ORDER.indexOf(b.category);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return { articles, total, categories: catList };
}

interface ArticlesIndexProps {
  data: ArticlesIndexData;
  page: number;
  basePath: string; // "/articles" یا "/articles/category/تغذیه"
  title: string;
  subtitle: string;
  activeCategory?: string;
  /** v119 — جستجوی فعال (?search=) */
  activeSearch?: string;
}

export function ArticlesIndex({ data, page, basePath, title, subtitle, activeCategory, activeSearch }: ArticlesIndexProps) {
  const totalPages = Math.max(1, Math.ceil(data.total / ARTICLES_PAGE_SIZE));
  const showCategories = data.categories.length > 1;

  // URL صفحهٔ n بر اساس basePath
  const pageUrl = (n: number) => (n <= 1 ? basePath : `${basePath}/page/${n}`);

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      {/* هدر مجله */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label="فیتاپ — صفحه اصلی">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </div>
            <span className="font-black text-sm text-slate-900">مجله فیتاپ</span>
          </Link>
          <Link href="/" className="flex items-center gap-1 text-sm text-slate-600 hover:text-orange-600 transition">
            صفحه اصلی فیتاپ
            <ChevronLeft className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-8">
        {/* H1 + توضیح */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 mb-2">{title}</h1>
          <p className="text-sm text-slate-500 leading-relaxed">{subtitle}</p>
        </div>

        {/* v119 — جستجوی مقالات (پورت از نسخهٔ SPA — نتیجه سمت سرور + قابل بوکمارک) */}
        <ArticlesSearchBox initial={activeSearch ?? ""} />
        {activeSearch ? (
          <p className="text-sm text-slate-600 mb-6">
            {toPersianDigits(data.total)} نتیجه برای «<span className="font-bold text-slate-900">{activeSearch}</span>»
          </p>
        ) : null}

        {/* چیپ‌های دسته‌بندی — لینک واقعی */}
        {showCategories && (
          <nav aria-label="دسته‌بندی مقالات" className="flex items-center gap-2 flex-wrap mb-8">
            <Link
              href="/articles"
              className={`text-xs px-3.5 py-1.5 rounded-full font-bold border transition ${
                !activeCategory
                  ? "bg-orange-500 text-white border-orange-500"
                  : "bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-600"
              }`}
            >
              همه ({toPersianDigits(data.categories.reduce((s, c) => s + c.count, 0))})
            </Link>
            {data.categories.map((c) => (
              <Link
                key={c.category}
                href={`/articles/category/${encodeURIComponent(c.category)}`}
                className={`text-xs px-3.5 py-1.5 rounded-full font-bold border transition ${
                  activeCategory === c.category
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-slate-600 border-slate-200 hover:border-orange-300 hover:text-orange-600"
                }`}
              >
                {CATEGORY_LABELS[c.category] || c.category} ({toPersianDigits(c.count)})
              </Link>
            ))}
          </nav>
        )}

        {/* گرید مقالات — همه لینک واقعی */}
        {data.articles.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Newspaper className="w-12 h-12 mx-auto mb-3 text-slate-200" />
            <p className="text-sm">هنوز مقاله‌ای در این بخش منتشر نشده است.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {data.articles.map((a) => (
              <Link key={a.id} href={`/article/${encodeURIComponent(a.slug)}`} className="group">
                <article className="rounded-2xl overflow-hidden border-2 border-orange-100 hover:border-orange-300 transition-all hover:shadow-lg bg-white h-full flex flex-col">
                  {a.coverImage ? (
                    <div className="aspect-[16/9] overflow-hidden relative bg-orange-50 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={toWebpServer(a.coverImage)}
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
                      <Newspaper className="w-10 h-10 text-orange-300" />
                    </div>
                  )}
                  <div className="p-4 flex flex-col flex-1">
                    <span className={`self-start text-[10px] px-2 py-0.5 rounded-full font-bold ${CATEGORY_COLORS[a.category] || CATEGORY_COLORS["عمومی"]}`}>
                      {CATEGORY_LABELS[a.category] || a.category}
                    </span>
                    <h2 className="text-sm font-bold text-slate-900 mt-2 line-clamp-2 group-hover:text-orange-600 transition leading-relaxed">
                      {a.title}
                    </h2>
                    {a.excerpt && (
                      <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">{a.excerpt}</p>
                    )}
                    <div className="flex items-center gap-3 mt-auto pt-3 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(a.publishedAt || a.createdAt).toLocaleDateString("fa-IR")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {toPersianDigits(a.readingMinutes || 3)} دقیقه
                      </span>
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}

        {/* صفحه‌بندی */}
        {totalPages > 1 && (
          <nav aria-label="صفحه‌بندی" className="flex items-center justify-center gap-2 mt-10">
            {page > 1 ? (
              <Link
                href={pageUrl(page - 1)}
                className="flex items-center gap-1 text-xs font-bold px-4 h-9 rounded-xl border border-slate-200 text-slate-600 hover:border-orange-300 hover:text-orange-600 transition"
              >
                <ChevronRight className="w-4 h-4" />
                قبلی
              </Link>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold px-4 h-9 rounded-xl border border-slate-100 text-slate-300 cursor-not-allowed">
                <ChevronRight className="w-4 h-4" />
                قبلی
              </span>
            )}
            <span className="text-xs text-slate-500 px-2">
              صفحه {toPersianDigits(page)} از {toPersianDigits(totalPages)}
            </span>
            {page < totalPages ? (
              <Link
                href={pageUrl(page + 1)}
                className="flex items-center gap-1 text-xs font-bold px-4 h-9 rounded-xl border border-slate-200 text-slate-600 hover:border-orange-300 hover:text-orange-600 transition"
              >
                بعدی
                <ChevronLeft className="w-4 h-4" />
              </Link>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold px-4 h-9 rounded-xl border border-slate-100 text-slate-300 cursor-not-allowed">
                بعدی
                <ChevronLeft className="w-4 h-4" />
              </span>
            )}
          </nav>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
