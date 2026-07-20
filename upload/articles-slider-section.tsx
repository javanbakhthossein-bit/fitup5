"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Sparkles, ChevronLeft, ChevronRight, ArrowLeft, Calendar, Eye } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits } from "@/lib/fitness/types";
import { toWebp } from "@/lib/fitness/image-utils";

interface ArticleCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  coverImage: string;
  views: number;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "عمومی",
  nutrition: "تغذیه",
  training: "تمرین",
  motivation: "انگیزشی",
  news: "اخبار",
};

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-slate-100 text-slate-600",
  nutrition: "bg-emerald-100 text-emerald-700",
  training: "bg-orange-100 text-orange-700",
  motivation: "bg-purple-100 text-purple-700",
  news: "bg-blue-100 text-blue-700",
};

export function ArticlesSliderSection() {
  const { setScreen, setArticleSlug } = useAppStore();
  const [articles, setArticles] = useState<ArticleCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const fetchedRef = useRef(false);

  // Lazy fetch — فقط وقتی کاربر به این بخش اسکرول کرد، articles لود شوند
  useEffect(() => {
    if (!sectionRef.current || fetchedRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !fetchedRef.current) {
          fetchedRef.current = true;
          (async () => {
            try {
              const res = await fetch("/api/articles?pageSize=10");
              const data = await res.json();
              setArticles(data.articles || []);
            } catch {} finally { setLoading(false); }
          })();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  function openArticle(slug: string) {
    setArticleSlug(slug);
    setScreen("article");
  }

  function scrollLeft() {
    if (!scrollRef.current) return;
    const cardWidth = 320; // approx
    scrollRef.current.scrollBy({ left: -cardWidth, behavior: "smooth" });
    setActiveIdx((i) => Math.max(0, i - 1));
  }

  function scrollRight() {
    if (!scrollRef.current) return;
    const cardWidth = 320;
    scrollRef.current.scrollBy({ left: cardWidth, behavior: "smooth" });
    setActiveIdx((i) => Math.min(articles.length - 1, i + 1));
  }

  // wrapper div برای IntersectionObserver — همیشه در DOM وجود دارد
  return (
    <div ref={sectionRef}>
    {loading ? (
      <section className="py-16 bg-gradient-to-b from-white to-orange-50/30">
        <div className="max-w-6xl mx-auto px-4">
          <Skeleton className="h-8 w-48 rounded-xl mx-auto mb-8" />
          <div className="flex gap-4 overflow-hidden">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-72 w-72 rounded-2xl shrink-0" />
            ))}
          </div>
        </div>
      </section>
    ) : articles.length === 0 ? null : (
    <section id="articles" className="py-16 bg-gradient-to-b from-white to-orange-50/30 relative overflow-hidden scroll-mt-16">
      {/* Background accents */}
      <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-orange-100/40 blur-3xl" />
      <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-amber-100/40 blur-3xl" />

      <div className="max-w-6xl mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-orange-100 text-orange-600 font-bold mb-3"
          >
            <Sparkles className="w-3.5 h-3.5" />
            مجله تخصصی فیتاپ
          </motion.div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 mb-2">
            مقالات کلیدی <span style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>بدنسازی و تغذیه</span>
          </h2>
          <p className="text-sm text-slate-500 max-w-lg mx-auto">
            جامع‌ترین راهنمای برنامه بدنسازی، برنامه تغذیه، مکمل‌های ورزشی و کاهش وزن — توسط مربیان هوشمند
          </p>
        </div>

        {/* Slider controls (desktop) */}
        <div className="hidden md:flex items-center justify-end gap-2 mb-4">
          <button
            onClick={scrollRight}
            disabled={activeIdx >= articles.length - 1}
            className="w-9 h-9 rounded-full bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition flex items-center justify-center"
            aria-label="قبلی"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <button
            onClick={scrollLeft}
            disabled={activeIdx === 0}
            className="w-9 h-9 rounded-full bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition flex items-center justify-center"
            aria-label="بعدی"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Slider */}
        <div
          ref={scrollRef}
          className="flex gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-4 -mx-4 px-4"
          style={{ scrollbarWidth: "none" }}
        >
          {articles.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="shrink-0 w-[300px] md:w-[340px] snap-start"
            >
              <button
                onClick={() => openArticle(a.slug)}
                className="text-right w-full group"
              >
                <Card className="overflow-hidden border-2 border-orange-100 hover:border-orange-300 transition-all hover:shadow-xl h-full bg-white">
                  {/* Cover image */}
                  {a.coverImage ? (
                    <div className="h-40 overflow-hidden relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={toWebp(a.coverImage)}
                        alt={a.title}
                        width={336}
                        height={160}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                      <span className={`absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full font-bold ${CATEGORY_COLORS[a.category] || CATEGORY_COLORS.general}`}>
                        {CATEGORY_LABELS[a.category] || a.category}
                      </span>
                    </div>
                  ) : (
                    <div className="h-40 bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center relative">
                      <Sparkles className="w-10 h-10 text-orange-300" />
                      <span className={`absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full font-bold ${CATEGORY_COLORS[a.category] || CATEGORY_COLORS.general}`}>
                        {CATEGORY_LABELS[a.category] || a.category}
                      </span>
                    </div>
                  )}

                  <div className="p-4">
                    <h3 className="font-bold text-slate-900 mb-2 line-clamp-2 group-hover:text-orange-600 transition text-sm leading-6 min-h-[3rem]">
                      {a.title}
                    </h3>
                    {a.excerpt && (
                      <p className="text-xs text-slate-500 line-clamp-2 mb-3 leading-5">{a.excerpt}</p>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-50">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(a.createdAt).toLocaleDateString("fa-IR")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {toPersianDigits(a.views)}
                      </span>
                    </div>
                  </div>
                </Card>
              </button>
            </motion.div>
          ))}
        </div>

        {/* See all button */}
        <div className="text-center mt-8">
          <Button
            onClick={() => setScreen("articles")}
            className="rounded-xl text-white gap-2"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          >
            مشاهده همه مقالات
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </section>
    )}
    </div>
  );
}
