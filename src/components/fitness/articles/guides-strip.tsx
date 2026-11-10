/**
 * ─── v262 — نوار راهنماهای فیتاپ (ممیزی سئو — لینک‌سازی داخلی سراسری) ───
 *
 * صفحات ابزار (/tdee، /bmi، /macro، /1rm) پرترافیک‌ترین صفحات ارگانیک
 * سایت‌اند (دادهٔ سرچ‌کنسول) ولی صفر لینک داخلی به دو هاب حیاتی می‌دادند:
 *   ۱) لندینگ رشته‌ها — به‌ویژه /sport/bodybuilding
 *   ۲) خوشهٔ خرید/تعرفه — مقالهٔ راهنمای خرید برنامه
 *
 * این کامپوننت سرور-ساید (async RSC) دو کار می‌کند:
 *  • مقالات هاب خرید فقط وقتی لینک می‌شوند که واقعاً status=published باشند
 *    (هیچ لینک ۴۰۴ داخلی ساخته نمی‌شود)
 *  • لینک‌های مسیر (/sport/…، /free-programs) ثابت و همیشه موجودند
 *  • variant روی انتخاب لینک‌ها اثر دارد تا هر صفحه مرتبط‌ترین هاب‌ها را بدهد
 */

import Link from "next/link";
import { db } from "@/lib/db";
import { ChevronLeft } from "lucide-react";

type GuideLink = { href: string; label: string; sub: string; emoji: string };

const BUY_GUIDE_SLUGS = [
  "buy-workout-program-guide",
  "fitness-program-pricing-guide",
  "personal-trainer-fees-guide",
];

async function getLiveGuideSlugs(): Promise<Set<string>> {
  try {
    const rows = await db.article.findMany({
      where: { slug: { in: BUY_GUIDE_SLUGS }, status: "published" },
      select: { slug: true },
    });
    return new Set(rows.map((r) => r.slug));
  } catch {
    return new Set(); // هیچ خطای DB حق ندارد رندر ابزار را بشکند
  }
}

export async function GuidesStrip({
  variant = "default",
}: {
  variant?: "default" | "muscle" | "fatloss" | "strength";
}) {
  const live = await getLiveGuideSlugs();

  const links: GuideLink[] = [];

  // هاب خرید — در همهٔ variantها ارزشمند است (قیف فروش فیتاپ)
  if (live.has("buy-workout-program-guide")) {
    links.push({
      href: "/article/buy-workout-program-guide",
      label: "راهنمای خرید برنامه بدنسازی",
      sub: "قبل از تصمیم، این نکات را دقیق بخوان",
      emoji: "🛒",
    });
  }

  // لندینگ رشته‌ها بر اساس موضوع صفحهٔ ابزار
  if (variant === "muscle") {
    links.push({
      href: "/sport/bodybuilding",
      label: "راهنمای کامل بدنسازی",
      sub: "آموزش، فواید و حرکات اختصاصی بدنسازی",
      emoji: "🏋️‍♂️",
    });
  }
  if (variant === "strength") {
    links.push({
      href: "/sport/powerlifting",
      label: "راهنمای کامل پاورلیفتینگ",
      sub: "سه حرکت اصلی قدرت — اسکوات، پرس و ددلیفت",
      emoji: "🦾",
    });
  }
  if (variant === "fatloss") {
    links.push({
      href: "/sport/hiit",
      label: "راهنمای کامل HIIT",
      sub: "چربی‌سوزی هدفمند با تمرین تناوبی",
      emoji: "⚡",
    });
  }
  if (variant === "muscle" && live.has("bodybuilding-complete-guide")) {
    links.push({
      href: "/article/bodybuilding-complete-guide",
      label: "بادی بیلدینگ چیست؟",
      sub: "راهنمای کامل عضله‌سازی از صفر",
      emoji: "🏋️",
    });
  }

  // پرکنندهٔ ثابت — همیشه موجود
  links.push({
    href: "/free-programs",
    label: "برنامه‌های رایگان تمرینی",
    sub: "برنامه‌های آمادهٔ رایگان — از مبتدی تا پیشرفته",
    emoji: "🎁",
  });

  if (links.length === 0) return null;

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-8" aria-label="راهنماهای فیتاپ">
      <h2 className="text-xl font-black text-slate-900 mb-4">راهنماهای فیتاپ</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group flex items-start gap-3 rounded-2xl border-2 border-slate-100 p-4 hover:border-orange-200 hover:bg-orange-50/40 transition"
          >
            <span className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 group-hover:bg-orange-200 transition text-lg" aria-hidden>
              {l.emoji}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black text-slate-900 group-hover:text-orange-600 transition">{l.label}</span>
              <span className="block text-xs text-slate-500 mt-1 leading-relaxed">{l.sub}</span>
            </span>
            <ChevronLeft className="w-4 h-4 text-orange-400 mr-auto shrink-0 mt-1 group-hover:translate-x-0.5 transition-transform" aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}
