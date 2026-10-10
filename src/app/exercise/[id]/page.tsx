import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { toPersianDigits } from "@/lib/fitness/types";
import {
  GLOBAL_YOUTUBE_SETTING_KEY,
  GLOBAL_MUSCLEWIKI_SETTING_KEY,
  globalYoutubeEnabledFromValue,
  globalMuscleWikiEnabledFromValue,
  isYoutubeDisplayAllowed,
  isMuscleWikiDisplayAllowed,
  resolveExerciseVideoBlocks,
} from "@/lib/fitness/exercise-video";
import {
  ExerciseDetailView,
  type ExerciseDetailViewData,
  type ExerciseRelatedItem,
} from "@/components/fitness/exercise-detail-view";

/**
 * ─── v113 — صفحهٔ واقعی حرکت ورزشی (/exercise/[id]) — تک‌نسخه‌ای ───
 *
 * تا v112 «دو» پیاده‌سازی موازی برای همین URL وجود داشت (اسکرین SPA +
 * این صفحهٔ SSR) که با رفرش/بک بین دو طراحی گیج می‌شد (گزارش ریشه‌ای مالک).
 * حالا این صفحه «تنها» نسخه است: طراحی غنی (ویدیوی اختصاصی + یوتیوب +
 * کارت‌های اطلاعات + مرتبط‌ها + سوالات متداول) در ExerciseDetailView مشترک
 * شده و اسکرین SPA حذف شده است — هر مسیر ورود یک طراحی نشان می‌دهد.
 *
 * تاریخچه: تا v104 حرکت فقط با ?exercise=<id> در SPA دیده می‌شد؛ v106 این
 * route واقعی + ریدایرکت 308 از ?exercise=<id> (src/proxy.ts) را ساخت.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fittup.ir";

interface PageProps {
  params: Promise<{ id: string }>;
}

// v113 — force-dynamic: بعد از آپلود/تغییر کلیدها در پنل، رفرش صفحه بلافاصله
// وضعیت تازه را نشان می‌دهد (کش ISR یک‌ساعته منبع «رفرش = طراحی/ویدیوی کهنه» بود)
export const dynamic = "force-dynamic";

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "مبتدی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};

async function getExercise(id: string) {
  try {
    return await db.exerciseLibrary.findUnique({ where: { id } });
  } catch {
    return null;
  }
}

async function getRelated(muscle: string, excludeId: string): Promise<ExerciseRelatedItem[]> {
  try {
    const rows = await db.exerciseLibrary.findMany({
      where: { muscle },
      orderBy: { name: "asc" },
      take: 5,
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
    });
    return rows
      .filter((r) => r.id !== excludeId)
      .slice(0, 4);
  } catch {
    return [];
  }
}

/** کلید سراسری یوتیوب (پنل ادمین) */
async function getGlobalYoutube(): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({
      where: { key: GLOBAL_YOUTUBE_SETTING_KEY },
      select: { value: true },
    });
    return globalYoutubeEnabledFromValue(row?.value);
  } catch {
    return true;
  }
}

/** v190 — کلید سراسری Muscle Wiki (پنل ادمین) */
async function getGlobalMuscleWiki(): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({
      where: { key: GLOBAL_MUSCLEWIKI_SETTING_KEY },
      select: { value: true },
    });
    return globalMuscleWikiEnabledFromValue(row?.value);
  } catch {
    return true;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const exercise = await getExercise(id);
  if (!exercise) {
    return { title: "حرکت یافت نشد | فیتاپ", robots: { index: false, follow: true } };
  }
  // v135 — حرکت غیرفعال (کلید ادمین): noindex + عنوان لطیف — صفحهٔ خودش پیام دوستانه می‌دهد (نه ۴۰۴)
  if (!exercise.isActive) {
    return { title: "این حرکت موقتاً غیرفعال است | فیتاپ", robots: { index: false, follow: true } };
  }

  const canonical = `${SITE_URL}/exercise/${encodeURIComponent(exercise.id)}`;
  const title = `${exercise.name} — آموزش و نحوه اجرا | فیتاپ`;
  const descSnippet = exercise.description
    ? exercise.description.slice(0, 150).replace(/[#*]/g, "")
    : `آموزش کامل ${exercise.name}${exercise.muscle ? ` برای ${exercise.muscle}` : ""}. نحوه اجرا، عضلات درگیر، نکات تکنیکی و جایگزین‌ها.`;
  const description = `${descSnippet}${descSnippet.length < 150 ? "" : "…"} — فیتاپ`;

  return {
    title: { absolute: title },
    description,
    keywords: `${exercise.name}, آموزش ${exercise.name}, نحوه اجرای ${exercise.name}, ${exercise.muscle || "بدنسازی"}, بانک حرکات فیتاپ`,
    robots: "index,follow",
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "fa_IR",
      url: canonical,
      siteName: "فیتاپ",
      images: [{ url: `${SITE_URL}/og/og-default.png`, width: 1200, height: 630, alt: exercise.name }],
    },
  };
}

export default async function ExerciseDetailPage({ params }: PageProps) {
  const { id } = await params;
  const exercise = await getExercise(id);
  // ─── v218 — حرکت ناموجود → 404 واقعی (ممیزی سئو: حذف soft-308) ───
  // قبلاً هر id ناشناخته با 308 دائمی به /exercises می‌رفت؛ گوگل این
  // soft-redirect بی‌کران را روی هر id دنبال می‌کرد (بودجهٔ خزش) و «دائمی»
  // یعنی «URL همیشه معتبر است» که برای محتوای ناموجود نادرست است.
  // حرکت غیرفعال (isActive=false) رفتار لطیف noindex خودش را دارد (بالا).
  if (!exercise) notFound();

  // ─── v135 — حرکت غیرفعال: صفحهٔ لطیف noindex (هیچ ۴۰۴ و هیچ لینک شکسته‌ای) ───
  if (!exercise.isActive) {
    return (
      <main className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="max-w-md space-y-4">
          <div className="text-5xl" aria-hidden>🚧</div>
          <h1 className="text-2xl font-bold">این حرکت موقتاً غیرفعال است</h1>
          <p className="text-muted-foreground leading-7">
            این حرکت به‌روزرسانی می‌شود و فعلاً در دسترس نیست؛ به‌زودی با ویدیو و توضیحات کامل برمی‌گردد.
          </p>
          <a
            href="/exercises"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            مشاهدهٔ بانک حرکات فیتاپ
          </a>
        </div>
      </main>
    );
  }

  const [rawRelated, globalYoutube, globalMuscleWiki] = await Promise.all([
    getRelated(exercise.muscle, exercise.id),
    getGlobalYoutube(),
    getGlobalMuscleWiki(),
  ]);
  const canonical = `${SITE_URL}/exercise/${encodeURIComponent(exercise.id)}`;

  // v113 — قانون واحد یوتیوب (سراسری ∧ تک‌حرکتی) روی حرکت اصلی و مرتبط‌ها
  // v190 — همان قانون برای Muscle Wiki (خاموشی → مسیرهای MW خنثی + به یوتیوب برمی‌گردد)
  const youtubeAllowed = isYoutubeDisplayAllowed(exercise, globalYoutube);
  const mwAllowed = isMuscleWikiDisplayAllowed(exercise, globalMuscleWiki);
  const related: ExerciseRelatedItem[] = rawRelated.map((r) => ({
    ...r,
    youtubeUrl: isYoutubeDisplayAllowed(r, globalYoutube) ? r.youtubeUrl : "",
    mwVideoUrl: isMuscleWikiDisplayAllowed(r, globalMuscleWiki) ? r.mwVideoUrl : "",
    mwVideoUrlFemale: isMuscleWikiDisplayAllowed(r, globalMuscleWiki) ? r.mwVideoUrlFemale : "",
  }));

  const viewData: ExerciseDetailViewData = {
    id: exercise.id,
    name: exercise.name,
    muscle: exercise.muscle,
    category: exercise.category,
    equipment: exercise.equipment,
    description: exercise.description,
    tips: exercise.tips,
    mediaUrl: exercise.mediaUrl,
    // پالایش یوتیوب در سرور — کلاینت فقط نمایش می‌دهد
    youtubeUrl: youtubeAllowed ? exercise.youtubeUrl : "",
    videoUrl: exercise.videoUrl,
    videoPosterUrl: exercise.videoPosterUrl,
    // v189 — ویدیوی Muscle Wiki برای نمایش صفحات عمومی (فال‌بک جنسیتی در resolver)
    // v190 — تابع کلید سراسری/تک‌حرکتی MW
    mwVideoUrl: mwAllowed ? exercise.mwVideoUrl : "",
    mwVideoUrlFemale: mwAllowed ? exercise.mwVideoUrlFemale : "",
    difficulty: exercise.difficulty,
  };

  // ─── JSON-LD (پورت از نسخهٔ غنی — VideoObject با قانون v113/v190) ───
  const blocks = resolveExerciseVideoBlocks(viewData, { muscleWikiEnabled: globalMuscleWiki });
  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "بانک حرکات", item: `${SITE_URL}/exercises` },
        { "@type": "ListItem", position: 3, name: exercise.name, item: canonical },
      ],
    },
  ];

  if (blocks.custom) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: `آموزش ${exercise.name}`,
      description: exercise.description || `آموزش نحوه اجرای حرکت ${exercise.name}`,
      thumbnailUrl: exercise.videoPosterUrl ? `${SITE_URL}${exercise.videoPosterUrl}` : undefined,
      uploadDate: exercise.updatedAt.toISOString(),
      contentUrl: `${SITE_URL}${exercise.videoUrl}`,
    });
  } else if (blocks.mw) {
    // v189 — ویدیوی Muscle Wiki (محلی) به‌جای یوتیوب در دادهٔ ساختاریافته
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: `آموزش ${exercise.name}`,
      description: exercise.description || `آموزش نحوه اجرای حرکت ${exercise.name}`,
      uploadDate: exercise.updatedAt.toISOString(),
      contentUrl: `${SITE_URL}${blocks.mw}`,
    });
  } else if (blocks.youtube) {
    const ytId = exercise.youtubeUrl.match(/embed\/([\w-]{11})/)?.[1];
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: `آموزش ${exercise.name}`,
      description: exercise.description || `آموزش نحوه اجرای حرکت ${exercise.name}`,
      thumbnailUrl: ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : undefined,
      uploadDate: exercise.updatedAt.toISOString(),
      embedUrl: exercise.youtubeUrl,
    });
  }

  const steps = (exercise.description || "")
    .split(/[.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5)
    .slice(0, 6)
    .map((text, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: `مرحله ${toPersianDigits(i + 1)}`,
      text,
    }));

  jsonLd.push({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `آموزش ${exercise.name}`,
    description: exercise.description || `نحوه اجرای صحیح ${exercise.name}`,
    totalTime: "PT30M",
    supply: (exercise.equipment || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ "@type": "HowToSupply", name })),
    step: steps.length > 0 ? steps : undefined,
  });

  jsonLd.push({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `چگونه ${exercise.name} را به درستی اجرا کنم؟`,
        acceptedAnswer: {
          "@type": "Answer",
          text: exercise.description || `برای اجرای صحیح ${exercise.name} به توضیحات گام‌به‌گام و ویدیوی آموزشی این صفحه مراجعه کنید.`,
        },
      },
      {
        "@type": "Question",
        name: `${exercise.name} کدام عضله را درگیر می‌کند؟`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `حرکت ${exercise.name} عمدتاً عضله ${exercise.muscle} را هدف قرار می‌دهد.`,
        },
      },
      {
        "@type": "Question",
        name: `${exercise.name} برای چه سطحی مناسب است؟`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `این حرکت برای سطح ${DIFFICULTY_LABELS[exercise.difficulty] || exercise.difficulty} مناسب است.`,
        },
      },
    ],
  });

  return (
    <ExerciseDetailView
      exercise={viewData}
      related={related}
      jsonLd={jsonLd}
      globalYoutubeEnabled={globalYoutube}
      globalMuscleWikiEnabled={globalMuscleWiki}
    />
  );
}
