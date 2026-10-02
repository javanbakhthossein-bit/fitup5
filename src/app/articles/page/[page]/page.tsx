import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticlesIndex, ARTICLES_PAGE_SIZE, getArticlesIndexData } from "@/components/fitness/articles/articles-index";

/**
 * ─── v105 — /articles/page/[n] — صفحه‌بندی مجله (n ≥ 2) ───
 * صفحهٔ ۱ به /articles ریدایرکت دائمی می‌شود تا canonical تمیز بماند.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const revalidate = 300;

interface Props {
  params: Promise<{ page: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  const n = Math.max(1, Math.floor(Number(page) || 1));
  return {
    title: { absolute: `مقالات بدنسازی و تناسب اندام — صفحه ${n} | فیتاپ` },
    description:
      "مقالات تخصصی بدنسازی، تغذیه، چربی‌سوزی، عضله‌سازی و مکمل‌های ورزشی به زبان فارسی. جامع‌ترین مرجع تناسب اندام — فیتاپ.",
    robots: "index,follow",
    alternates: { canonical: `${SITE_URL}/articles/page/${n}` },
  };
}

export default async function ArticlesPaginatedPage({ params }: Props) {
  const { page } = await params;
  const n = Math.floor(Number(page) || 1);

  // صفحهٔ ۱ و نامعتبر → ریدایرکت دائمی به ایندکس اصلی
  if (n < 2) permanentRedirect("/articles");

  const data = await getArticlesIndexData(n);

  // شمارهٔ صفحه بیرون از محدوده → 404 واقعی (نه صفحهٔ خالی)
  const totalPages = Math.max(1, Math.ceil(data.total / ARTICLES_PAGE_SIZE));
  if (data.total > 0 && n > totalPages) notFound();

  return (
    <ArticlesIndex
      data={data}
      page={n}
      basePath="/articles"
      title="مجله فیتاپ"
      subtitle="مقالات تخصصی بدنسازی، تغذیه، مکمل و تمرین — به زبان ساده و بر اساس علم روز"
    />
  );
}
