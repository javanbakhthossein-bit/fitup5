import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, UtensilsCrossed, Home } from "lucide-react";
import { db } from "@/lib/db";
import { toPersianDigits } from "@/lib/fitness/types";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import { SiteFooter } from "@/components/fitness/articles/site-footer";
import { FoodsHubList, type FoodHubGroup } from "./foods-hub-list";

/**
 * ─── v106 — بانک کالری غذاها (/foods) — هاب سئوی SSR ───
 *
 * تا v105 بانک کالری فقط اسکرین SPA (?tool=foods) بود و هر غذا صفحهٔ SSR
 * (/food/[id]) داشت ولی صفحهٔ لینک‌دهنده وجود نداشت. این هاب همهٔ غذاهای
 * کتابخانه را گروه‌بندی‌شده (بر اساس وعده) با لینک واقعی رندر می‌کند.
 * ورودی‌های قدیمی /?tool=foods با 308 به همین مسیر می‌آیند (src/proxy.ts).
 *
 * v123 — هماهنگ‌سازی طراحی با بقیهٔ ابزارهای رایگان (درخواست مالک):
 * مثل /tdee و /exercises، بالای صفحه از ToolsNav با دکمه‌های جابجایی بین
 * ابزارها استفاده می‌شود (با active="tool-foods" هایلایت می‌شود).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: "بانک کالری غذاها — جدول کامل کالری و درشت‌مغذی‌ها | فیتاپ" },
  description:
    "جدول کامل کالری غذاها با بیش از ۱۰۰۰ ماده غذایی ایرانی و خارجی. کالری، پروتئین، کربوهیدرات و چربی هر غذا — مرجع طراحی رژیم غذایی بدنسازی و کنترل وزن.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/foods` },
  openGraph: {
    title: "بانک کالری غذاها — جدول کامل کالری و درشت‌مغذی‌ها | فیتاپ",
    description:
      "جدول کامل کالری و درشت‌مغذی‌های بیش از ۱۰۰۰ غذا. جستجوی سریع و رایگان — فیتاپ.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/foods`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: "بانک کالری فیتاپ" }],
  },
};

// ترتیب استاندارد وعده‌ها
const CATEGORY_ORDER = ["breakfast", "lunch", "dinner", "snack"];

async function getFoodGroups(): Promise<FoodHubGroup[]> {
  try {
    const foods = await db.foodLibrary.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, calories: true, category: true },
    });
    const map = new Map<string, FoodHubGroup>();
    for (const f of foods) {
      const category = f.category || "snack";
      let group = map.get(category);
      if (!group) {
        group = { category, items: [] };
        map.set(category, group);
      }
      group.items.push({ id: f.id, name: f.name, calories: f.calories, category });
    }
    // ترتیب وعده‌ها: صبحانه → ناهار → شام → میان‌وعده، بعد بقیه
    return Array.from(map.values()).sort(
      (a, b) =>
        (CATEGORY_ORDER.indexOf(a.category) === -1 ? 99 : CATEGORY_ORDER.indexOf(a.category)) -
        (CATEGORY_ORDER.indexOf(b.category) === -1 ? 99 : CATEGORY_ORDER.indexOf(b.category))
    );
  } catch {
    return [];
  }
}

export default async function FoodsHubPage() {
  const groups = await getFoodGroups();
  const total = groups.reduce((acc, g) => acc + g.items.length, 0);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "بانک کالری غذاها",
      description: `جدول کامل کالری و درشت‌مغذی‌های ${total} غذا — گروه‌بندی‌شده بر اساس وعده`,
      url: `${SITE_URL}/foods`,
      inLanguage: "fa-IR",
      isPartOf: { "@type": "WebSite", name: "فیتاپ", url: SITE_URL },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "بانک کالری غذاها", item: `${SITE_URL}/foods` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* v123 — نوار واحد ابزارهای رایگان (هماهنگ با /tdee و /exercises) */}
      <ToolsNav active="tool-foods" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24">
        <div className="max-w-3xl mx-auto px-4 py-8 w-full">
          {/* Breadcrumb */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600">بانک کالری غذاها</span>
          </nav>

          {/* Hero */}
          <div className="relative overflow-hidden border-b border-orange-100 mb-6 pb-6">
            <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-orange-100 blur-3xl opacity-50" />
            <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3">
              <UtensilsCrossed className="w-3.5 h-3.5" />
              مرجع رایگان کالری غذاها
            </span>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2 leading-tight">
              بانک کالری{" "}
              <span style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                غذاها
              </span>
            </h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              کالری، پروتئین، کربوهیدرات و چربی {toPersianDigits(total)} غذا، گروه‌بندی‌شده بر اساس
              وعده (صبحانه، ناهار، شام، میان‌وعده). روی هر غذا بزنید تا جدول کامل درشت‌مغذی‌های آن باز شود.
            </p>
          </div>

          {groups.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                <UtensilsCrossed className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-500 text-sm">فعلاً غذایی ثبت نشده است</p>
            </div>
          ) : (
            <FoodsHubList groups={groups} />
          )}

          {/* CTA */}
          <div className="mt-10 p-6 rounded-2xl text-center text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <h3 className="text-xl font-black mb-1">برنامه غذایی اختصاصی خودت را بساز</h3>
            <p className="text-sm text-white/90 mb-4">
              فیتاپ با هوش مصنوعی بر اساس هدف و بدن تو، رژیم دقیق با گرم‌های مشخص می‌سازد
            </p>
            <Link
              href="/?screen=auth"
              className="inline-flex items-center justify-center bg-white text-orange-600 hover:bg-white/90 rounded-xl font-bold px-6 h-10 transition"
            >
              شروع رایگان
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
