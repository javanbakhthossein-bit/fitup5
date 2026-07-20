import type { Metadata } from "next";
import { db } from "@/lib/db";
import HomeClient from "./page-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

// در Next.js 16, searchParams یک Promise است
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * تولید metadata پویا بر اساس searchParams.
 *
 * canonical برای هر صفحه در server-side تولید می‌شود تا گوگل HTML اولیه را
 * با canonical درست ببیند (بدون نیاز به اجرای JavaScript).
 *
 * - ?article=slug → canonicalUrl از دیتابیس (یا fallback به ?article=slug)
 * - ?tool=tdee → https://fittup.ir/?tool=tdee
 * - ?screen=articles → https://fittup.ir/?screen=articles
 * - ?exercise=id → https://fittup.ir/?exercise=id
 * - ?food=id → https://fittup.ir/?food=id
 * - URL خالی → https://fittup.ir/
 */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;

  // اگر مقاله است، canonicalUrl اختصاصی را از دیتابیس بخوان
  const articleSlug = typeof sp.article === "string" ? sp.article : undefined;
  if (articleSlug) {
    try {
      const article = await db.article.findUnique({
        where: { slug: articleSlug },
        select: { canonicalUrl: true, status: true },
      });
      // اگر مقاله canonicalUrl اختصاصی دارد، از آن استفاده کن
      if (article?.canonicalUrl) {
        return {
          alternates: { canonical: article.canonicalUrl },
        };
      }
    } catch {
      // خطای دیتابیس — fallback به URL پیش‌فرض
    }
  }

  // برای بقیه صفحات: canonical از query params ساخته می‌شود
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else {
        params.set(key, value);
      }
    }
  }

  const queryString = params.toString();
  const canonical = queryString ? `${SITE_URL}/?${queryString}` : `${SITE_URL}/`;

  return {
    alternates: {
      canonical,
    },
  };
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <HomeClient />;
}
