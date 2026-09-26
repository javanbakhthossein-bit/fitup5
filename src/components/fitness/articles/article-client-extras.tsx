"use client";

/**
 * article-client-extras.tsx — v119
 *
 * تک‌نسخه‌سازی مقاله‌ها: صفحهٔ واقعی SSR (/article/<slug>) تنها طراحی مقاله
 * است؛ این فایل امکاناتِ تجربه‌ای که قبلاً فقط در نسخهٔ SPA بود را به همان
 * صفحهٔ SSR می‌آورد تا هیچ قابلیتی از دست نرود:
 *
 *   ۱) ArticleViewCounter — شمارندهٔ بازدید (افزایش best-effort از مسیر
 *      رسمی GET /api/articles/<slug> که خودش bot/admin-guard دارد)
 *   ۲) ArticleShareButton — اشتراک‌گذاری (navigator.share → fallback کپی)
 *   ۳) ArticleUserCta — CTA وسط مقاله و CTA پایانی، هوشمند بر اساس وضعیت
 *      کاربر (مهمان / لاگین بی‌پلن / پلن‌دار) با لینک‌های واقعی
 *
 * همهٔ ناوبری‌ها بارگذاری کامل صفحه‌اند (مسیرهای واقعی) — بدون اسکرین SPA.
 */

import { useEffect, useState } from "react";
import { ChevronLeft, Eye, Flame, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";

/* ─────────────────────────────────────────────────────────────────────────
 * ۱) شمارندهٔ بازدید — نمایش سمت سرور + افزایش best-effort سمت کلاینت
 * ───────────────────────────────────────────────────────────────────────── */
export function ArticleViewCounter({ slug, initialViews }: { slug: string; initialViews: number }) {
  const [views, setViews] = useState(initialViews);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // همان API رسمی مقاله — خودش ربات/ادمین را فیلتر و بازدید را increment می‌کند
        const res = await fetch(`/api/articles/${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.article?.views === "number") {
          setViews(data.article.views);
        }
      } catch {
        // شمارش بازدید هرگز رندر مقاله را نبندد
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <span className="flex items-center gap-1 text-[11px] text-slate-500">
      <Eye className="w-3.5 h-3.5" />
      {toPersianDigits(views)} بازدید
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ۲) دکمهٔ اشتراک‌گذاری — navigator.share با fallback کپی لینک
 * ───────────────────────────────────────────────────────────────────────── */
export function ArticleShareButton({ title, slug }: { title: string; slug: string }) {
  function share() {
    const url = `${window.location.origin}/article/${encodeURIComponent(slug)}`;
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {});
    } else {
      navigator.clipboard
        .writeText(url)
        .then(() => toast.success("لینک مقاله کپی شد ✓"))
        .catch(() => toast.error("کپی لینک ممکن نشد"));
    }
  }
  return (
    <button
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 h-8 text-xs font-bold text-slate-600 hover:bg-orange-100 hover:text-orange-700 transition"
      aria-label="اشتراک‌گذاری مقاله"
    >
      <Share2 className="w-4 h-4" />
      اشتراک‌گذاری
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ۳) CTA هوشمند — mode از /api/auth/me (سبک؛ بدون وابستگی به store SPA)
 * ───────────────────────────────────────────────────────────────────────── */

type UserMode = "guest" | "noplan" | "plan";

function useUserMode(): UserMode {
  const [mode, setMode] = useState<UserMode>("guest");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.user) setMode(data.user.planName ? "plan" : "noplan");
      } catch {
        // مهمان بمان
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return mode;
}

/** مقصد CTAها — مسیرهای واقعی (بارگذاری کامل صفحه، بدون اسکرین SPA) */
const CTA_HREF = {
  auth: "/?screen=auth",
  plans: "/?screen=panel&tab=plans",
  panel: "/?screen=panel",
} as const;

/** کارت CTA وسط مقاله (v59 — نرخ ثبت‌نام از ترافیک وبلاگ) — پورت از نسخهٔ SPA */
export function ArticleMidCta() {
  const mode = useUserMode();
  const href = mode === "guest" ? CTA_HREF.auth : mode === "noplan" ? CTA_HREF.plans : CTA_HREF.panel;
  const label = mode === "guest" ? "ثبت‌نام رایگان" : mode === "noplan" ? "دریافت برنامه" : "رفتن به پنل فیتاپ";
  const title =
    mode === "guest"
      ? "همین امروز شروع کن — تحلیل بدنت رایگانه"
      : mode === "noplan"
        ? "برنامهٔ اختصاصی بدن خودت را بگیر"
        : "ادامهٔ مسیر تناسب اندامت";
  const desc =
    mode === "guest"
      ? "فیتاپ با هوش مصنوعی، از روی مشخصات بدن تو برنامهٔ تمرینی و غذایی کاملاً شخصی‌سازی‌شده می‌سازد — تحلیل اول رایگان است."
      : mode === "noplan"
        ? "برنامهٔ تمرینی و غذایی اختصاصی بر اساس تحلیل رایگان بدن تو ساخته می‌شود — چند دقیقه تا شروع فاصله داری."
        : "برنامه و امکانات پلنت هم‌اکنون در پنل فیتاپ آماده است — ادامهٔ مسیر از همین‌جا.";
  return (
    <div className="my-8 not-prose" dir="rtl">
      <div
        className="relative rounded-2xl p-5 overflow-hidden"
        style={{ background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)", border: "1.5px solid #fed7aa" }}
      >
        <div className="absolute -top-8 -left-8 w-28 h-28 rounded-full bg-orange-200/40 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -right-6 w-24 h-24 rounded-full bg-amber-200/40 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Flame className="w-4 h-4 text-white" />
            </div>
            <h3 className="text-base font-black text-slate-900">{title}</h3>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed mb-4">{desc}</p>
          <a
            href={href}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-6 h-11 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            <Sparkles className="w-4 h-4" />
            {label}
            <ChevronLeft className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** CTA پایانی هوشمند (مهمان/بی‌پلن/پلن‌دار) — پورت از نسخهٔ SPA */
export function ArticleFinalCta() {
  const mode = useUserMode();
  const href = mode === "guest" ? CTA_HREF.auth : mode === "noplan" ? CTA_HREF.plans : CTA_HREF.panel;
  const heading = !mode || mode === "guest" ? "آماده‌ای شروع کنی؟" : mode === "plan" ? "مسیرت ادامه دارد 💪" : "برنامه‌ات منتظرت است";
  const label = mode === "guest" ? "شروع رایگان" : mode === "plan" ? "رفتن به پنل" : "دریافت برنامه";
  return (
    <div
      className="mt-8 p-6 rounded-2xl text-center text-white relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
    >
      <div className="absolute -top-8 -left-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
      <Sparkles className="w-8 h-8 mx-auto mb-2" />
      <h3 className="text-xl font-black mb-1">{heading}</h3>
      <p className="text-sm text-white/90 mb-4">برنامه تمرینی و غذایی اختصاصی خودت را با فیتاپ هوشمند بساز</p>
      <a
        href={href}
        className="inline-flex items-center justify-center bg-white text-orange-600 hover:bg-white/90 rounded-xl font-bold px-6 h-10 transition"
      >
        {label}
      </a>
    </div>
  );
}
