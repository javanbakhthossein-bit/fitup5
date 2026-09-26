import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronLeft, Flame, Home } from "lucide-react";
import { db } from "@/lib/db";
import { SiteFooter } from "@/components/fitness/articles/site-footer";

/**
 * ─── v105 — صفحهٔ واقعی غذا (/food/[id]) ───
 *
 * تا v104 هر غذا فقط با ?food=<id> در SPA بود (URL کوئری + client-side) و
 * در sitemap هم URL کوئری بود — گوگل ایندکس نمی‌کرد. حالا route واقعی +
 * ریدایرکت دائمی از ?food=<id>.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const revalidate = 3600;

const FOOD_CATEGORY_LABELS: Record<string, string> = {
  breakfast: "صبحانه",
  lunch: "ناهار",
  dinner: "شام",
  snack: "میان‌وعده",
};

function fa(n: number): string {
  return n.toLocaleString("fa-IR");
}

async function getFood(id: string) {
  try {
    return await db.foodLibrary.findUnique({ where: { id } });
  } catch {
    return null;
  }
}

async function getRelated(category: string, excludeId: string) {
  try {
    const rows = await db.foodLibrary.findMany({
      where: { category },
      orderBy: { name: "asc" },
      take: 9,
      select: { id: true, name: true, calories: true },
    });
    return rows.filter((r) => r.id !== excludeId).slice(0, 8);
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const food = await getFood(id);
  if (!food) {
    return { title: "غذا یافت نشد | فیتاپ", robots: { index: false, follow: true } };
  }

  const canonical = `${SITE_URL}/food/${encodeURIComponent(food.id)}`;
  const title = `کالری ${food.name} — ${food.calories} کالری در ${food.servingSize} | فیتاپ`;
  const description = `${food.name} دارای ${food.calories} کالری در هر ${food.servingSize}. پروتئین: ${food.protein}g، کربوهیدرات: ${food.carbs}g، چربی: ${food.fat}g. جدول کامل کالری و درشت‌مغذی‌های ${food.name} در فیتاپ.`;

  return {
    title: { absolute: title },
    description,
    keywords: `کالری ${food.name}, ${food.name}, مقدار کالری ${food.name}, درشت‌مغذی ${food.name}, جدول کالری غذاها`,
    robots: "index,follow",
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: food.name }],
    },
  };
}

export default async function FoodDetailPage({ params }: PageProps) {
  const { id } = await params;
  const food = await getFood(id);
  // 🔧 v130 (دیرکتیو مالک «هیچ لینک شکسته‌ای نباید باشد»): غذای ناموجود →
  // 308 دائمی به بانک غذاها به‌جای 404.
  if (!food) permanentRedirect("/foods");

  const related = await getRelated(food.category, food.id);
  const canonical = `${SITE_URL}/food/${encodeURIComponent(food.id)}`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "بانک کالری غذاها", item: `${SITE_URL}/foods` },
      { "@type": "ListItem", position: 3, name: food.name, item: canonical },
    ],
  };

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/foods" className="flex items-center gap-1 text-sm text-slate-600 hover:text-orange-600 transition">
            <ChevronLeft className="w-4 h-4" />
            بانک کالری غذاها
          </Link>
          <Link href="/" className="flex items-center gap-2" aria-label="فیتاپ — صفحه اصلی">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </div>
            <span className="font-black text-sm text-slate-900">فیتاپ</span>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 py-6 w-full">
          {/* Breadcrumb */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5 flex-wrap">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <Link href="/foods" className="hover:text-orange-600 transition">بانک کالری غذاها</Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600 line-clamp-1">{food.name}</span>
          </nav>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-[11px] px-3 py-1 rounded-full font-bold bg-emerald-100 text-emerald-700">
              {FOOD_CATEGORY_LABELS[food.category] || food.category}
            </span>
            {food.isVegan && (
              <span className="text-[11px] px-3 py-1 rounded-full font-bold bg-teal-100 text-teal-700">گیاهی</span>
            )}
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-3 leading-tight">
            کالری {food.name}
          </h1>

          <p className="text-base text-slate-600 mb-6 leading-relaxed">
            {food.name} دارای {fa(food.calories)} کالری در هر {food.servingSize} است. در جدول زیر مقدار
            دقیق کالری و درشت‌مغذی‌های {food.name} را ببینید.
          </p>

          {food.imageUrl && (
            <div className="rounded-2xl overflow-hidden mb-6 shadow-lg bg-orange-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={food.imageUrl} alt={food.name} width={800} height={450} className="w-full object-cover" fetchPriority="high" />
            </div>
          )}

          {/* جدول ارزش غذایی */}
          <div className="rounded-2xl border-2 border-orange-100 overflow-hidden mb-6">
            <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 border-b border-orange-100">
              <Flame className="w-4 h-4 text-orange-500" />
              <h2 className="text-sm font-black text-slate-900">ارزش غذایی {food.name} ({food.servingSize})</h2>
            </div>
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="bg-orange-50/60 text-slate-700">
                  <th className="border border-slate-200 px-3 py-2.5 text-right font-bold">ماده مغذی</th>
                  <th className="border border-slate-200 px-3 py-2.5 text-right font-bold">مقدار</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700 font-bold">کالری</td>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-900 font-black text-orange-600">{fa(food.calories)} کیلوکالری</td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700">پروتئین</td>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700">{fa(Math.round(food.protein * 10) / 10)} گرم</td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700">کربوهیدرات</td>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700">{fa(Math.round(food.carbs * 10) / 10)} گرم</td>
                </tr>
                <tr>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700">چربی</td>
                  <td className="border border-slate-200 px-3 py-2.5 text-slate-700">{fa(Math.round(food.fat * 10) / 10)} گرم</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* متن سئو برای «کالری X چقدره؟» */}
          <div className="prose prose-slate max-w-none article-content fitup-article text-slate-700">
            <h2 className="text-xl font-black text-slate-900 mt-7 mb-3">{food.name} چند کالری دارد؟</h2>
            <p>
              هر {food.servingSize} از {food.name} حدود <strong>{fa(food.calories)} کیلوکالری</strong> انرژی دارد؛
              یعنی <strong>{fa(Math.round(food.protein * 10) / 10)} گرم پروتئین</strong>،{" "}
              <strong>{fa(Math.round(food.carbs * 10) / 10)} گرم کربوهیدرات</strong> و{" "}
              <strong>{fa(Math.round(food.fat * 10) / 10)} گرم چربی</strong>.
            </p>
            <p>
              برای اینکه بدانی {food.name} در برنامه غذایی روزانهٔ تو چه جایگاهی دارد، ماشین‌حساب کالری روزانه
              (TDEE) فیتاپ را امتحان کن — رایگان و دقیق.
            </p>
            <p>
              <Link href="/tdee" className="text-orange-600 font-bold hover:text-orange-700 transition">
                محاسبه کالری روزانه با ماشین‌حساب TDEE فیتاپ ←
              </Link>
            </p>
          </div>

          {/* غذاهای مشابه — لینک واقعی */}
          {related.length > 0 && (
            <div className="mt-12">
              <h2 className="text-lg font-black text-slate-900 mb-4">غذاهای مشابه</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    href={`/food/${encodeURIComponent(r.id)}`}
                    className="p-3 rounded-xl border-2 border-orange-100 hover:border-orange-300 transition hover:shadow text-center"
                  >
                    <p className="text-sm font-bold text-slate-800 group-hover:text-orange-600 transition">{r.name}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{fa(r.calories)} کالری</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="mt-8 p-6 rounded-2xl text-center text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <h3 className="text-xl font-black mb-1">برنامه غذایی اختصاصی خودت را بساز</h3>
            <p className="text-sm text-white/90 mb-4">فیتاپ با هوش مصنوعی برنامه غذایی دقیق بر اساس هدف و بدن تو می‌سازد</p>
            <Link
              href="/?screen=auth"
              className="inline-flex items-center justify-center bg-white text-orange-600 hover:bg-white/90 rounded-xl font-bold px-6 h-10 transition"
            >
              شروع رایگان
            </Link>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
