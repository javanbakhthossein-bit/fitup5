import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticlesIndex, getArticlesIndexData } from "@/components/fitness/articles/articles-index";
import { CATEGORY_LABELS } from "@/lib/fitness/article-shared";

/**
 * ─── v105 — /articles/category/[category] — آرشیو دستهٔ مقالات (SSR) ───
 * جایگزین واقعیِ ?screen=articles&category=… — URL های قدیمی با ریدایرکت
 * دائمی به همین مسیر می‌آیند. دستهٔ نامعتبر 404 واقعی می‌دهد (نه soft-404).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const revalidate = 300;

interface Props {
  params: Promise<{ category: string }>;
}

/** decode امن — پارامتر ممکن است encode شده باشد (دسته‌ها فارسی‌اند) */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const cat = safeDecode(category);
  const label = CATEGORY_LABELS[cat];

  if (!label) {
    return { title: "دسته یافت نشد | فیتاپ", robots: { index: false, follow: true } };
  }

  const title = `مقالات ${label} | فیتاپ`;
  const description = `مجموعه مقالات تخصصی ${label} در مجله فیتاپ — آموزش گام‌به‌گام، نکات کاربردی و راهنماهای کامل به زبان فارسی.`;
  const canonical = `${SITE_URL}/articles/category/${encodeURIComponent(cat)}`;
  return {
    title: { absolute: title },
    description,
    robots: "index,follow",
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: label }],
    },
  };
}

export default async function ArticleCategoryPage({ params }: Props) {
  const { category } = await params;
  const cat = safeDecode(category);

  // دستهٔ خارج از لیست شناخته‌شده → 404 واقعی (جلوی ایندکس URLهای بی‌معنا)
  if (!CATEGORY_LABELS[cat]) notFound();

  const data = await getArticlesIndexData(1, cat);
  const label = CATEGORY_LABELS[cat] || cat;

  return (
    <ArticlesIndex
      data={data}
      page={1}
      basePath={`/articles/category/${encodeURIComponent(cat)}`}
      title={`مقالات ${label}`}
      subtitle={`مجموعه مقالات تخصصی ${label} در مجله فیتاپ — آموزش گام‌به‌گام و بر اساس علم روز`}
      activeCategory={cat}
    />
  );
}
