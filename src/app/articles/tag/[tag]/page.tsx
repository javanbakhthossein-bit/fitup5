import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NikaWidget } from "@/components/fitness/nika-widget";
import {
  ArticlesIndex,
  ARTICLES_PAGE_SIZE,
  type ArticlesIndexData,
} from "@/components/fitness/articles/articles-index";
import { db } from "@/lib/db";

/**
 * ─── v218 — آرشیو تگ مقالات (/articles/tag/[tag]) ───
 *
 * تگ‌های صفحهٔ مقاله (article/[slug]) حالا لینک واقعی دارند و به همین
 * آرشیو می‌آیند (قبلاً span غیرکلیک‌پذیر بودند). مدل Article.tags در
 * prisma schema یک String جداشده با کاما است (نه آرایه) — پس فیلتر DB
 * `contains` است و تطبیق دقیق تگ سمت سرور با split انجام می‌شود (تا
 * «چربی» اشتباهی «چربی‌سوزی» را هم نیاورد).
 *
 * نکتهٔ سئو:
 *  - robots index,follow + canonical خودش — آرشیو تگ مسیر خزش داخلی می‌سازد.
 *  - عمداً به sitemap اضافه نمی‌شود (فقط از لینک‌های تگ کشف می‌شود).
 *  - رفتار noindex جستجوی مقالات (?search=) دست‌نخورده ماند.
 *  - صفحه‌بندی در این روت وجود ندارد (hidePagination) — لینک /page/N
 *    ساخته نمی‌شود تا هیچ لینک شکسته‌ای تولید نشود.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

interface TagPageProps {
  params: Promise<{ tag: string }>;
}

export const revalidate = 300;

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

async function getTagData(tag: string): Promise<ArticlesIndexData | null> {
  try {
    // contains: پیش‌فیلتر DB؛ تطبیق دقیق تگ با split سمت سرور
    const candidates = await db.article.findMany({
      where: { status: "published", tags: { contains: tag } },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
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
        tags: true,
      },
    });
    const exact = candidates.filter((a) =>
      (a.tags || "")
        .split(",")
        .map((t) => t.trim())
        .includes(tag)
    );
    if (exact.length === 0) return null;

    const categories = await db.article
      .groupBy({ by: ["category"], where: { status: "published" }, _count: { _all: true } })
      .catch(() => [] as { category: string | null; _count: { _all: number } }[]);

    // narrowing حلقه‌ای (به‌جای type-predicate در filter) — تایپ union برگشتیِ
    // catch تایپ‌پردایت را گیج می‌کرد و خطای TS2322 می‌داد
    const catList: { category: string; count: number }[] = [];
    for (const c of categories) {
      if (c.category) catList.push({ category: c.category, count: c._count._all });
    }

    return {
      articles: exact.slice(0, ARTICLES_PAGE_SIZE),
      total: exact.length,
      categories: catList,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: TagPageProps): Promise<Metadata> {
  const { tag: raw } = await params;
  const tag = safeDecode(raw).trim();
  const canonical = `${SITE_URL}/articles/tag/${encodeURIComponent(tag)}`;
  const title = `مقالات «${tag}» | فیتاپ`;
  const description = `مجموعه مقالات مجله فیتاپ با برچسب «${tag}» — آموزش‌های تخصصی بدنسازی، تغذیه و تناسب اندام به زبان ساده و بر اساس علم روز.`;
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
    },
  };
}

export default async function ArticleTagPage({ params }: TagPageProps) {
  const { tag: raw } = await params;
  const tag = safeDecode(raw).trim();

  // تگ خالی → 404
  if (!tag) notFound();

  const data = await getTagData(tag);

  // هیچ مقاله‌ای با این تگ → 404 واقعی (نه صفحهٔ خالی ایندکس‌پذیر)
  if (!data) notFound();

  return (
    <>
      <ArticlesIndex
        data={data}
        page={1}
        basePath={`/articles/tag/${encodeURIComponent(tag)}`}
        title={`مقالات «${tag}»`}
        subtitle={`${data.total} مقاله با برچسب «${tag}» در مجله فیتاپ — آموزش گام‌به‌گام و بر اساس علم روز`}
        hidePagination
      />
      {/* v211 — ویجت شناور چت نیکا */}
      <NikaWidget context="public" />
    </>
  );
}
