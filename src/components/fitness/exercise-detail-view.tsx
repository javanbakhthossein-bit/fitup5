"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v113 — تک‌نسخه‌سازی «صفحهٔ حرکت ورزشی» — رندر مشترک همه‌ی مسیرهای ورود
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * باگ ریشه‌ای که مالک گزارش کرد: تا v112 «دو» پیاده‌سازی موازی برای /exercise/<id>
 * وجود داشت — اسکرین SPA (pushState از داخل اپ) و صفحهٔ SSR (رفرش/دیپ‌لینک) —
 * با طراحی‌های متفاوت و با رفرش بین این دو گیج می‌شد.
 *
 * ریشه‌کنی: این کامپوننت «تنها» رندرکنندهٔ صفحهٔ حرکت است (داخل SSR
 * /exercise/[id] مونت می‌شود)؛ اسکرین SPA موازی حذف شده و هر ناوبری به
 * مسیر واقعی می‌رود → هر مسیر ورود (کلیک/رفرش/بک/گوگل) دقیقاً یک طراحی نشان
 * می‌دهد: همان طراحی غنی که مالک تأیید کرد (ویدیوی اختصاصی + یوتیوب + کارت‌های
 * اطلاعات سریع + حرکات مرتبط + سوالات متداول).
 *
 * داده سمت سرور خوانده و به‌عنوان prop تزریق می‌شود — بدون fetch کلاینت،
 * بدون Skeleton، بدون تفاوت رندر اول/بعد.
 */

import { motion } from "framer-motion";
import {
  Dumbbell,
  ChevronLeft,
  AlertTriangle,
  Info,
  Home,
  Youtube,
  Share2,
  Subtitles,
  Play,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { toPersianDigits, equipmentFa } from "@/lib/fitness/types";
import { resolveExerciseVideoBlocks } from "@/lib/fitness/exercise-video";
import { NikaWidget } from "@/components/fitness/nika-widget";
import { SiteFooter } from "@/components/fitness/articles/site-footer";

export interface ExerciseDetailViewData {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  description: string;
  tips: string;
  mediaUrl: string;
  youtubeUrl: string; // v113 — قبلاً در سرور با قانون کلیدهای یوتیوب پالایش شده
  videoUrl: string;
  videoPosterUrl: string;
  difficulty: string;
}

export interface ExerciseRelatedItem {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  youtubeUrl: string;
  videoUrl: string;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "مبتدی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};
const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-emerald-100 text-emerald-700",
  intermediate: "bg-amber-100 text-amber-700",
  advanced: "bg-red-100 text-red-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  push: "Push (فشار)",
  pull: "Pull (کشش)",
  legs: "پا",
  core: "مرکز (شکم)",
  cardio: "هوازی",
  fullbody: "بدن کامل",
};

export function ExerciseDetailView({
  exercise,
  related,
  jsonLd,
}: {
  exercise: ExerciseDetailViewData;
  related: ExerciseRelatedItem[];
  /** v113 — بلوک‌های JSON-LD ساخته‌شده در سرور (VideoObject/HowTo/FAQ/Breadcrumb) */
  jsonLd?: Record<string, unknown>[];
}) {
  // v113 — قانون واحد نمایش: اختصاصی همیشه + یوتیوب اگر پالایش سرور اجازه دهد
  const blocks = resolveExerciseVideoBlocks(exercise);
  const hasCustomVideo = !!blocks.custom;
  const hasYoutube = !!blocks.youtube;

  function shareLink() {
    const url = `${window.location.origin}/exercise/${encodeURIComponent(exercise.id)}`;
    if (navigator.share) {
      navigator.share({ title: exercise.name, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url);
      toast.success("لینک حرکت کپی شد ✓");
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col" dir="rtl">
      {jsonLd && jsonLd.length > 0 && (
        <script
          type="application/ld+json"
          // 🔒 ممیزی امنیتی F13 — escape «<» به u003C: اگر متن FAQ/عنوان حاوی
          // «</script>» باشد بدون escape از تگ اسکریپت خارج می‌شد (XSS).
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}
      {/* هدر چسبان — لینک واقعی به بانک حرکات */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b" style={{ borderColor: "#fed7aa" }}>
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/exercises"
            className="flex items-center gap-1 text-sm text-slate-600 hover:text-orange-600 transition"
          >
            <ChevronLeft className="w-4 h-4" />
            بانک حرکات
          </Link>
          <Link href="/" className="flex items-center gap-2 group" aria-label="فیتاپ — صفحه اصلی">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center overflow-hidden group-hover:scale-105 transition"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fitup-logo.png" alt="فیتاپ" className="w-full h-full object-cover" />
            </div>
            <span className="font-black text-sm text-slate-900 group-hover:text-orange-600 transition">فیتاپ</span>
          </Link>
          <button
            onClick={shareLink}
            className="p-2 rounded-lg hover:bg-slate-100 transition"
            aria-label="اشتراک‌گذاری این حرکت"
          >
            <Share2 className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-16 w-full">
          {/* مسیر صفحه */}
          <nav aria-label="مسیر صفحه" className="flex items-center gap-1.5 text-xs text-slate-400 mb-5 flex-wrap">
            <Link href="/" className="flex items-center gap-1 hover:text-orange-600 transition">
              <Home className="w-3.5 h-3.5" />
              خانه
            </Link>
            <ChevronLeft className="w-3 h-3" />
            <Link href="/exercises" className="hover:text-orange-600 transition">بانک حرکات</Link>
            <ChevronLeft className="w-3 h-3" />
            <span className="text-slate-600 line-clamp-1">{exercise.name}</span>
          </nav>

          {/* بج‌های دسته/سطح */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge className="bg-orange-100 text-orange-700 text-[11px]">
              {exercise.muscle}
            </Badge>
            {CATEGORY_LABELS[exercise.category] && (
              <Badge className="bg-amber-100 text-amber-700 text-[11px]">
                {CATEGORY_LABELS[exercise.category]}
              </Badge>
            )}
            <Badge
              className={`text-[11px] ${
                DIFFICULTY_COLORS[exercise.difficulty] || "bg-slate-100 text-slate-600"
              }`}
            >
              {DIFFICULTY_LABELS[exercise.difficulty] || exercise.difficulty}
            </Badge>
          </div>

          {/* عنوان */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl md:text-4xl font-black text-slate-900 mb-3 leading-tight"
          >
            {exercise.name}
          </motion.h1>

          {/* کارت‌های اطلاعات سریع */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Card className="p-3 rounded-xl border-2" style={{ borderColor: "#fed7aa" }}>
              <p className="text-[10px] text-slate-400 mb-1">عضله هدف</p>
              <p className="text-sm font-bold text-slate-900">{exercise.muscle}</p>
            </Card>
            <Card className="p-3 rounded-xl border-2" style={{ borderColor: "#fed7aa" }}>
              <p className="text-[10px] text-slate-400 mb-1">سطح دشواری</p>
              <p className="text-sm font-bold text-slate-900">
                {DIFFICULTY_LABELS[exercise.difficulty] || exercise.difficulty}
              </p>
            </Card>
            <Card className="p-3 rounded-xl border-2" style={{ borderColor: "#fed7aa" }}>
              <p className="text-[10px] text-slate-400 mb-1">دسته‌بندی</p>
              <p className="text-sm font-bold text-slate-900">
                {CATEGORY_LABELS[exercise.category] || exercise.category}
              </p>
            </Card>
            <Card className="p-3 rounded-xl border-2" style={{ borderColor: "#fed7aa" }}>
              <p className="text-[10px] text-slate-400 mb-1">تجهیزات</p>
              <p className="text-sm font-bold text-slate-900 truncate">
                {equipmentFa(exercise.equipment) || "وزن بدن"}
              </p>
            </Card>
          </div>

          {/* ─── مدیا — قانون واحد v113 ─── */}
          {/* ویدیوی اختصاصی فیتاپ (اولویت اول) */}
          {hasCustomVideo && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl overflow-hidden mb-4 shadow-lg"
            >
              <div className="aspect-video w-full bg-black">
                <video
                  src={`${blocks.custom!.src}#t=0.1`}
                  poster={blocks.custom!.poster || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full h-full"
                />
              </div>
              <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 border-t border-emerald-200">
                <Play className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-[11px] text-emerald-700 font-medium">ویدیوی اختصاصی فیتاپ</span>
              </div>
            </motion.div>
          )}

          {/* یوتیوب (اگر کلیدهای سراسری/تک‌حرکتی اجازه دهند — پالایش در سرور انجام شده) */}
          {hasYoutube && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl overflow-hidden mb-4 shadow-lg"
            >
              <div className="aspect-video w-full bg-black">
                <iframe
                  src={blocks.youtube!}
                  title={`ویدیو آموزشی ${exercise.name}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-50 border-t border-amber-200 flex-wrap">
                <span className="flex items-center gap-1.5 min-w-0">
                  <Subtitles className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-[11px] text-amber-700 font-medium">در صورتی که ویدیو انگلیسی است، از تنظیمات ویدیو زیرنویس فارسی را روشن کنید</span>
                </span>
                <span className="w-1 h-1 rounded-full bg-amber-300 shrink-0" aria-hidden />
                <span className="flex items-center gap-1.5 min-w-0">
                  <Youtube className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-[11px] text-slate-500 font-medium">ویدیو از یوتیوب</span>
                </span>
              </div>
            </motion.div>
          )}

          {/* نه اختصاصی نه یوتیوب → انیمیشن/تصویر یا پیام شفاف */}
          {!hasCustomVideo && !hasYoutube && (
            exercise.mediaUrl ? (
              <div className="rounded-2xl overflow-hidden mb-4 shadow-lg bg-orange-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={exercise.mediaUrl}
                  alt={`آموزش ${exercise.name}`}
                  width={800}
                  height={450}
                  className="w-full object-cover"
                  fetchPriority="high"
                />
              </div>
            ) : (
              <div className="rounded-2xl mb-4 p-5 bg-amber-50 border border-amber-200 text-center">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                </div>
                <p className="text-sm text-amber-800 font-bold mb-1">ویدیوی آموزشی این حرکت هنوز آماده نشده</p>
                <p className="text-xs text-amber-600 leading-6">
                  این حرکت فعلاً ویدیوی آموزشی ندارد؛ به‌زودی در آپدیت‌های بعدی تکمیل می‌شود. فعلاً برای اجرای صحیح، توضیحات گام‌به‌گام زیر را مطالعه کنید.
                </p>
              </div>
            )
          )}

          {/* توضیحات اجرا */}
          {exercise.description && (
            <section className="mb-6">
              <h2 className="text-xl font-black text-slate-900 mb-3 flex items-center gap-2">
                <Info className="w-5 h-5 text-orange-500" />
                آموزش اجرای {exercise.name}
              </h2>
              <div className="text-sm text-slate-700 leading-relaxed space-y-2">
                {exercise.description.split(/\n+/).map((p, i) =>
                  p.trim() ? <p key={i}>{p.trim()}</p> : null
                )}
              </div>
            </section>
          )}

          {/* نکات ایمنی */}
          {exercise.tips && (
            <section className="mb-6">
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
                <h2 className="font-bold text-base text-amber-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  نکات ایمنی و تکنیک
                </h2>
                <p className="text-sm text-amber-700 leading-relaxed">{exercise.tips}</p>
              </div>
            </section>
          )}

          {/* CTA — دعوت به ساخت برنامه */}
          <div className="mb-10 p-6 rounded-2xl text-center text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <h3 className="text-xl font-black mb-1">برنامه تمرینی اختصاصی خودت را بساز</h3>
            <p className="text-sm text-white/90 mb-4">
              فیتاپ با هوش مصنوعی از روی مشخصات بدن تو برنامه می‌سازد — {toPersianDigits(320)}+ حرکت با آموزش کامل
            </p>
            <Link
              href="/?screen=auth"
              className="inline-flex items-center justify-center bg-white text-orange-600 hover:bg-white/90 rounded-xl font-bold px-6 h-10 transition"
            >
              شروع رایگان
            </Link>
          </div>

          {/* حرکات مرتبط — لینک واقعی */}
          {related.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xl font-black text-slate-900 mb-3 flex items-center gap-2">
                <Dumbbell className="w-5 h-5 text-orange-500" />
                حرکات مرتبط برای {exercise.muscle}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {related.map((rel, i) => (
                  <motion.div
                    key={rel.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 4) * 0.05 }}
                  >
                    <Link
                      href={`/exercise/${encodeURIComponent(rel.id)}`}
                      className="block text-right bg-white rounded-xl border-2 p-3 transition hover:shadow-md hover:-translate-y-0.5"
                      style={{ borderColor: "#fed7aa" }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                          <Dumbbell className="w-4 h-4 text-white" />
                        </div>
                        {rel.videoUrl && rel.videoUrl.trim() !== "" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[9px] font-bold text-emerald-700">
                            <Play className="w-3 h-3" /> ویدیو
                          </span>
                        ) : rel.youtubeUrl && rel.youtubeUrl.trim() !== "" ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-[9px] font-bold text-red-600">
                            <Youtube className="w-3 h-3" /> ویدیو
                          </span>
                        ) : null}
                      </div>
                      <p className="font-bold text-sm text-slate-900">{rel.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge className={`text-[9px] ${DIFFICULTY_COLORS[rel.difficulty] || "bg-slate-100 text-slate-600"}`}>
                          {DIFFICULTY_LABELS[rel.difficulty] || rel.difficulty}
                        </Badge>
                        <span className="text-[10px] text-slate-400">{rel.muscle}</span>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* ── محتوای سئو + سوالات متداول ── */}
          <section className="mt-10 space-y-6">
            <div className="space-y-4 text-sm leading-relaxed text-slate-700">
              <h2 className="text-2xl font-black text-slate-900">
                آموزش {exercise.name} — راهنمای کامل تکنیک و نکات ایمنی
              </h2>
              <p>
                در این صفحه به <strong>آموزش {exercise.name}</strong> پرداخته‌ایم؛ حرکتی برای
                عضله <strong>{exercise.muscle}</strong> که در دسته‌بندی{" "}
                <strong>{CATEGORY_LABELS[exercise.category] || exercise.category}</strong> قرار
                می‌گیرد. برای اجرای صحیح این حرکت به{" "}
                {exercise.equipment ? `تجهیزاتی نظیر ${equipmentFa(exercise.equipment)} نیاز دارید` : "هیچ تجهیز خاصی نیاز ندارید و با وزن بدن قابل اجراست"}.
                سطح دشواری این حرکت{" "}
                <strong>{DIFFICULTY_LABELS[exercise.difficulty] || exercise.difficulty}</strong>{" "}
                است.
              </p>
              <p>
                <strong>{exercise.name}</strong> یکی از حرکات مؤثر در برنامه‌های بدنسازی است
                که به تقویت و رشد عضلات {exercise.muscle} کمک می‌کند. رعایت تکنیک صحیح و کنترل
                حرکت در فاز منفی، از ارکان اصلی پیشگیری از آسیب و رسیدن به بهترین نتیجه است.
                توصیه می‌شود قبل از افزایش وزنه، فرم اجرای حرکت را با وزنه سبک تمرین کنید.
              </p>
              <p>
                برای طراحی برنامه تمرینی هدفمند، می‌توانید این حرکت را با سایر حرکات مرتبط
                بالا ترکیب کنید. اگر در حال طراحی <strong>برنامه بدنسازی</strong> برای عضله{" "}
                {exercise.muscle} هستید، ترکیب حرکات مرکب و فرعی در کنار هم به بهترین تحریک
                عضلانی منجر می‌شود.
              </p>
            </div>

            {/* سوالات متداول */}
            <div className="space-y-3">
              <h3 className="text-xl font-bold text-slate-900">
                سوالات متداول درباره {exercise.name}
              </h3>
              <Accordion
                type="single"
                collapsible
                className="w-full bg-white rounded-2xl border-2 px-4"
                style={{ borderColor: "#fed7aa" }}
              >
                <AccordionItem value="q1">
                  <AccordionTrigger>
                    چگونه {exercise.name} را به درستی اجرا کنم؟
                  </AccordionTrigger>
                  <AccordionContent>
                    برای اجرای صحیح {exercise.name}، ابتدا به توضیحات گام‌به‌گام بالا و ویدیوی
                    آموزشی مراجعه کنید. مهم‌ترین اصول: گرم کردن مناسب قبل از شروع، حفظ فرم
                    صحیح بدن، کنترل حرکت در فاز منفی (Eccentric) و تنفس صحیح (دم در فاز منفی
                    و بازدم در فاز مثبت). اگر مبتدی هستید، ابتدا با وزنه سبک تمرین کنید تا
                    تکنیک کاملاً یاد بگیرید.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q2">
                  <AccordionTrigger>
                    {exercise.name} کدام عضله را درگیر می‌کند؟
                  </AccordionTrigger>
                  <AccordionContent>
                    حرکت {exercise.name} عمدتاً عضله <strong>{exercise.muscle}</strong> را هدف
                    قرار می‌دهد. این حرکت در دسته‌بندی{" "}
                    {CATEGORY_LABELS[exercise.category] || exercise.category} قرار دارد و در
                    برنامه‌های تمرینی مختلف می‌تواند برای رشد و تقویت این عضله استفاده شود.
                    {exercise.equipment
                      ? ` تجهیزات موردنیاز برای این حرکت شامل ${equipmentFa(exercise.equipment)} است.`
                      : ""}
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q3">
                  <AccordionTrigger>
                    {exercise.name} برای چه سطحی مناسب است؟
                  </AccordionTrigger>
                  <AccordionContent>
                    این حرکت برای سطح{" "}
                    <strong>{DIFFICULTY_LABELS[exercise.difficulty] || exercise.difficulty}</strong>{" "}
                    مناسب است.{" "}
                    {exercise.difficulty === "beginner"
                      ? "افراد مبتدی می‌توانند از این حرکت برای شروع بدنسازی استفاده کنند و با وزنه سبک آن را تمرین کنند."
                      : exercise.difficulty === "advanced"
                      ? "این حرکت برای افراد پیشرفته مناسب است؛ توصیه می‌شود افراد مبتدی ابتدا با حرکات ساده‌تر شروع کنند."
                      : "افراد با سطح متوسط می‌توانند از این حرکت در برنامه تمرینی خود استفاده کنند. مبتدیان می‌توانند با وزنه سبک‌تر آن را تمرین کنند."}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </section>
        </article>
      </main>

      <SiteFooter />
      <NikaWidget />
    </div>
  );
}
