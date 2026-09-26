import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Dumbbell, Home } from "lucide-react";
import { db } from "@/lib/db";
import { toPersianDigits } from "@/lib/fitness/types";
import { ToolsNav } from "@/components/fitness/tools/tools-nav";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  isYoutubeDisplayAllowed,
} from "@/lib/fitness/exercise-video";
import {
  ExerciseBankView,
  type ExerciseBankItem,
} from "@/components/fitness/exercise-bank-view";
import { SiteFooter } from "@/components/fitness/articles/site-footer";

/**
 * ─── v113 — بانک حرکات (/exercises) — تک‌نسخه‌ای ───
 *
 * تا v112 «دو» پیاده‌سازی موازی برای همین URL وجود داشت: اسکرین SPA
 * (?tool=exercises با pushState) و این صفحهٔ SSR — با رفرش بین دو طراحی
 * گیج می‌شد (گزارش ریشه‌ای مالک). حالا این صفحه «تنها» نسخه است و طراحی
 * غنی (جستجو + فیلتر عضله/تجهیزات + کارت‌های متحرک) در ExerciseBankView
 * مشترک شده؛ اسکرین SPA حذف شده و هر ناوبری به همین مسیر واقعی می‌رود.
 *
 * v123 — هماهنگ‌سازی طراحی با بقیهٔ ابزارهای رایگان (درخواست مالک):
 * مثل /tdee و /foods، بالای صفحه از ToolsNav با دکمه‌های جابجایی بین
 * ابزارها استفاده می‌شود (با active="tool-exercises" هایلایت می‌شود) —
 * هدر سادهٔ قبلی حذف شد تا هر سه ابزار یک طراحی واحد داشته باشند.
 *
 * داده در سرور خوانده می‌شود (SSR — قابل خزش، لینک‌های /exercise/<id> در
 * HTML اولیه) + CollectionPage/BreadcrumbList/FAQPage.
 * ورودی‌های قدیمی /?tool=exercises با 308 به همین مسیر می‌آیند (src/proxy.ts).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "بانک حرکات بدنسازی — آموزش کامل حرکات ورزشی | فیتاپ" },
  description:
    "بانک کامل حرکات بدنسازی با آموزش گام‌به‌گام، نکات ایمنی و ویدیوهای تکنیکی. حرکات ورزشی بر اساس گروه عضلانی (سینه، پشت، پا، سرشانه، بازو) — مرجع طراحی برنامه تمرینی بدنسازی در خانه و باشگاه.",
  robots: "index,follow",
  alternates: { canonical: `${SITE_URL}/exercises` },
  openGraph: {
    title: "بانک حرکات بدنسازی — آموزش کامل حرکات ورزشی | فیتاپ",
    description:
      "بانک کامل حرکات بدنسازی با آموزش گام‌به‌گام، نکات ایمنی و ویدیوهای تکنیکی. مرجع طراحی برنامه تمرینی بدنسازی در خانه و باشگاه.",
    type: "website",
    locale: "fa_IR",
    url: `${SITE_URL}/exercises`,
    siteName: "فیتاپ",
    images: [{ url: `${SITE_URL}/fitup-logo.png`, width: 512, height: 512, alt: "بانک حرکات فیتاپ" }],
  },
};

async function getBankItems(): Promise<ExerciseBankItem[]> {
  try {
    const [rows, setting] = await Promise.all([
      db.exerciseLibrary.findMany({
        where: { isActive: true }, // v135 — غیرفعال‌ها از بانک عمومی حذف
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          muscle: true,
          category: true,
          equipment: true,
          difficulty: true,
          youtubeUrl: true,
          videoUrl: true,
          youtubeEnabled: true,
        },
      }),
      db.siteSetting
        .findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } })
        .catch(() => null),
    ]);
    const globalYoutube = globalYoutubeEnabledFromValue(setting?.value);
    // v113 — قانون واحد یوتیوب روی لیست (بج ویدیو هم از همین داده ساخته می‌شود)
    return rows.map((r) => ({
      ...r,
      youtubeUrl: isYoutubeDisplayAllowed(r, globalYoutube) ? r.youtubeUrl : "",
    }));
  } catch {
    return [];
  }
}

export default async function ExercisesHubPage() {
  const exercises = await getBankItems();
  const total = exercises.length;
  const videoCount = exercises.filter(
    (e) => (e.videoUrl && e.videoUrl.trim() !== "") || (e.youtubeUrl && e.youtubeUrl.trim() !== "")
  ).length;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "بانک حرکات بدنسازی",
      description: `بانک کامل حرکات بدنسازی با آموزش و ویدیو — ${total} حرکت با جستجو و فیلتر عضله/تجهیزات`,
      url: `${SITE_URL}/exercises`,
      inLanguage: "fa-IR",
      isPartOf: { "@type": "WebSite", name: "فیتاپ", url: SITE_URL },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "بانک حرکات", item: `${SITE_URL}/exercises` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "بهترین حرکات بدنسازی برای مبتدیان کدامند؟",
          acceptedAnswer: {
            "@type": "Answer",
            text: "برای مبتدیان، حرکات مرکب (Compound) مثل اسکوات، ددلیفت رومانیایی، پرس سینه هالتر، پرس سرشانه دمبل، زیربغل سیم‌کش و بارفیکس بهترین انتخاب هستند. این حرکات چندین گروه عضلانی را همزمان درگیر می‌کنند و پایه‌ی برنامه بدنسازی مبتدی را تشکیل می‌دهند.",
          },
        },
        {
          "@type": "Question",
          name: "چگونه حرکت جایگزین انتخاب کنم؟",
          acceptedAnswer: {
            "@type": "Answer",
            text: "برای انتخاب حرکت جایگزین، ابتدا عضله هدف و الگوی حرکتی حرکت اصلی را مشخص کنید. مثلاً جایگزین پرس سینه هالتر می‌تواند پرس سینه دمبل یا پرس بالاسینه دستگاه باشد. در بانک حرکات فیتاپ می‌توانید بر اساس گروه عضلانی و تجهیزات، حرکت جایگزین مناسب پیدا کنید.",
          },
        },
        {
          "@type": "Question",
          name: "چند حرکت در هر جلسه تمرینی انجام دهم؟",
          acceptedAnswer: {
            "@type": "Answer",
            text: "برای اکثر افراد، ۴ تا ۶ حرکت در هر جلسه تمرینی بدنسازی کافی است. هر حرکت ۳ تا ۴ ست با ۸ تا ۱۲ تکرار. اگر برنامه بدنسازی ۳ جلسه در هفته دارید، می‌توانید از تقسیم Push-Pull-Legs یا Upper-Lower استفاده کنید.",
          },
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* v123 — نوار واحد ابزارهای رایگان (هماهنگ با /tdee و /foods) */}
      <ToolsNav active="tool-exercises" />

      <main className="flex-1 pt-[7.5rem] sm:pt-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 w-full">
          {/* Breadcrumb */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600">بانک حرکات</span>
          </nav>

          {/* Hero */}
          <div className="relative overflow-hidden border-b border-orange-100 mb-8 pb-6">
            <div className="absolute -top-16 -left-16 w-56 h-56 rounded-full bg-orange-100 blur-3xl opacity-50" />
            <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3">
              <Dumbbell className="w-3.5 h-3.5" />
              مرجع رایگان حرکات ورزشی
            </span>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-2 leading-tight">
              بانک حرکات{" "}
              <span style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                بدنسازی
              </span>
            </h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              آموزش گام‌به‌گام، عضلات درگیر، سطح دشواری و نکات ایمنی {toPersianDigits(total)} حرکت
              {videoCount > 0 ? ` — ${toPersianDigits(videoCount)} حرکت با ویدیوی آموزشی` : ""}.
              روی هر حرکت بزنید تا صفحهٔ کامل آموزش آن باز شود.
            </p>
          </div>

          {/* بانک حرکات — جستجو/فیلتر/کارت‌ها (تک‌نسخهٔ v113) */}
          <ExerciseBankView exercises={exercises} />

          {/* CTA */}
          <div className="mt-10 p-6 rounded-2xl text-center text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <h3 className="text-xl font-black mb-1">برنامه تمرینی اختصاصی خودت را بساز</h3>
            <p className="text-sm text-white/90 mb-4">
              فیتاپ با هوش مصنوعی از همین بانک حرکات، برنامهٔ ست/تکرار دقیق برای بدن تو می‌چیند
            </p>
            <Link
              href="/?screen=auth"
              className="inline-flex items-center justify-center bg-white text-orange-600 hover:bg-white/90 rounded-xl font-bold px-6 h-10 transition"
            >
              شروع رایگان
            </Link>
          </div>

          {/* ── محتوای سئو ── */}
          <section className="mt-16 space-y-8">
            <div className="space-y-4 text-sm leading-relaxed text-slate-700">
              <h2 className="text-2xl font-black text-slate-900">
                بانک حرکات ورزشی فیتاپ — مرجع کامل حرکات بدنسازی
              </h2>
              <p>
                بانک حرکات ورزشی فیتاپ شامل بیش از <strong>{toPersianDigits(100)} حرکت بدنسازی</strong> با
                آموزش تصویری گام‌به‌گام، نکات ایمنی و ویدیوهای تکنیکی است. این مرجع کامل برای طراحی{" "}
                <strong>برنامه تمرینی بدنسازی</strong>، انتخاب حرکت جایگزین و یادگیری تکنیک صحیح اجرا به کار
                می‌آید. هر حرکت شامل توضیح کامل نحوه اجرا، عضله هدف، تجهیزات مورد نیاز و سطح دشواری
                (مبتدی، متوسط، پیشرفته) است.
              </p>
              <p>
                حرکات این بانک بر اساس <strong>گروه عضلانی</strong> (سینه، پشت، پا، سرشانه، بازو، زیربغل، شکم) و{" "}
                <strong>نوع تجهیزات</strong> (دمبل، هالتر، دستگاه، وزن بدن) دسته‌بندی شده‌اند تا بتوانید به‌سادگی
                حرکت مناسب <strong>برنامه بدنسازی در خانه</strong> یا <strong>برنامه بدنسازی در باشگاه</strong> را
                پیدا کنید.
              </p>
              <h3 className="text-xl font-bold text-slate-900 pt-2">
                دسته‌بندی حرکات: Push، Pull، Legs، Core، Cardio
              </h3>
              <p>
                در <strong>برنامه پرورش اندام</strong> مدرن، حرکات بر اساس الگوی حرکتی (Movement Pattern) دسته‌بندی می‌شوند:
              </p>
              <ul className="list-disc pr-5 space-y-1.5">
                <li><strong>Push (فشار):</strong> حرکاتی مثل پرس سینه، پرس سرشانه و پشت بازو — برای عضله‌سازی بالاتنه.</li>
                <li><strong>Pull (کشش):</strong> حرکاتی مثل زیربغل، لت و جلوبازو — برای رشد پشت بدن و تعادل عضلانی.</li>
                <li><strong>Legs (پا):</strong> اسکوات، ددلیفت و لانگز — مهم‌ترین <strong>حرکات مرکب</strong> برای افزایش حجم و قدرت کل بدن.</li>
                <li><strong>Core (مرکز):</strong> حرکات شکم و کمر برای تثبیت مرکز بدن و پیشگیری از آسیب کمر.</li>
                <li><strong>Cardio (هوازی):</strong> برای چربی‌سوزی، سلامتی قلب و بهبود استقامت.</li>
              </ul>
              <h3 className="text-xl font-bold text-slate-900 pt-2">تکنیک صحیح اجرای حرکات بدنسازی</h3>
              <p>
                تکنیک صحیح مهم‌ترین اصل <strong>بدنسازی طبیعی</strong> و پیشگیری از آسیب است. قبل از افزایش وزنه،
                مطمئن شوید فرم اجرای حرکت کامل درست است. کنترل حرکت در فاز منفی (Eccentric)، تنفس صحیح و گرم کردن
                مناسب، از ارکان اصلی اجرای اصولی هر حرکت به‌شمار می‌آیند. در صورت داشتن آسیب‌دیدگی، از حرکت جایگزین
                با تجهیزات سبک‌تر استفاده کنید.
              </p>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
