import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ArticlesIndex,
  ARTICLES_PAGE_SIZE,
  getArticlesIndexData,
} from "@/components/fitness/articles/articles-index";
import { CATEGORY_LABELS } from "@/lib/fitness/article-shared";

/**
 * ─── v105 — /articles/category/[category]/page/[n] — صفحه‌بندی آرشیو دسته ───
 * صفحهٔ ۱ به /articles/category/[category] ریدایرکت دائمی می‌شود.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const revalidate = 300;

interface Props {
  params: Promise<{ category: string; page: string }>;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, page } = await params;
  const cat = safeDecode(category);
  const n = Math.max(1, Math.floor(Number(page) || 1));
  const label = CATEGORY_LABELS[cat];

  if (!label) {
    return { title: "دسته یافت نشد | فیتاپ", robots: { index: false, follow: true } };
  }

  return {
    title: { absolute: `مقالات ${label} — صفحه ${n} | فیتاپ` },
    description: `مجموعه مقالات تخصصی ${label} در مجله فیتاپ — صفحه ${n}.`,
    robots: "index,follow",
    alternates: { canonical: `${SITE_URL}/articles/category/${encodeURIComponent(cat)}/page/${n}` },
  };
}

export default async function ArticleCategoryPaginatedPage({ params }: Props) {
  const { category, page } = await params;
  const cat = safeDecode(category);
  const n = Math.floor(Number(page) || 1);

  if (!CATEGORY_LABELS[cat]) notFound();

  // صفحهٔ ۱ و نامعتبر → ریدایرکت دائمی به آرشیو اصلی دسته
  if (n < 2) permanentRedirect(`/articles/category/${encodeURIComponent(cat)}`);

  const data = await getArticlesIndexData(n, cat);

  const totalPages = Math.max(1, Math.ceil(data.total / ARTICLES_PAGE_SIZE));
  if (data.total > 0 && n > totalPages) notFound();

  const label = CATEGORY_LABELS[cat] || cat;

  return (
    <ArticlesIndex
      data={data}
      page={n}
      basePath={`/articles/category/${encodeURIComponent(cat)}`}
      title={`مقالات ${label}`}
      subtitle={`مجموعه مقالات تخصصی ${label} در مجله فیتاپ — آموزش گام‌به‌گام و بر اساس علم روز`}
      activeCategory={cat}
    />
  );
}
