import type { Metadata } from "next";
import { ArticlesIndex, getArticlesIndexData } from "@/components/fitness/articles/articles-index";

/**
 * ─── v105 — /articles — ایندکس واقعی مجلهٔ فیتاپ (SSR) ───
 * جایگزین واقعیِ ?screen=articles — با ریدایرکت دائمی در next.config،
 * تمام اعتبار سئوی URL قدیمی به همین مسیر منتقل می‌شود.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const revalidate = 300;

// v119 — صفحهٔ نتایج جستجو ایندکس نشود (محتوای نازک)
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const sp = await searchParams;
  const search = typeof sp.search === "string" ? sp.search.trim() : "";
  if (search) {
    return {
      title: { absolute: `جستجوی «${search}» در مقالات | فیتاپ` },
      robots: "noindex,follow",
    };
  }
  return {
    title: { absolute: "مقالات بدنسازی و تناسب اندام | فیتاپ" },
    description:
      "مقالات تخصصی بدنسازی، تغذیه، چربی‌سوزی، عضله‌سازی و مکمل‌های ورزشی به زبان فارسی. جامع‌ترین مرجع تناسب اندام — فیتاپ.",
    robots: "index,follow",
    alternates: { canonical: `${SITE_URL}/articles` },
    openGraph: {
      title: "مقالات بدنسازی و تناسب اندام | فیتاپ",
      description:
        "مقالات تخصصی بدنسازی، تغذیه، چربی‌سوزی، عضله‌سازی و مکمل‌های ورزشی به زبان فارسی. جامع‌ترین مرجع تناسب اندام — فیتاپ.",
      type: "website",
      locale: "fa_IR",
      url: `${SITE_URL}/articles`,
      siteName: "فیتاپ",
      images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: "مجله فیتاپ" }],
    },
  };
}

export default async function ArticlesHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // v119 — جستجوی مقالات (?search=) — پورت از نسخهٔ SPA؛ نتیجه سمت سرور
  const sp = await searchParams;
  const search = typeof sp.search === "string" ? sp.search.trim().slice(0, 80) : "";
  const data = await getArticlesIndexData(1, undefined, search || undefined);
  return (
    <ArticlesIndex
      data={data}
      page={1}
      basePath="/articles"
      title="مجله فیتاپ"
      subtitle="مقالات تخصصی بدنسازی، تغذیه، مکمل و تمرین — به زبان ساده و بر اساس علم روز"
      activeSearch={search || undefined}
    />
  );
}
