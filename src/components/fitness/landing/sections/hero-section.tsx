"use client";

import { motion } from "framer-motion";
import { Sparkles, ChevronLeft, Star, Zap } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { pushScreen } from "@/lib/fitness/navigation";
import { toPersianDigits } from "@/lib/fitness/types";

export function HeroSection() {
  const { setScreen } = useAppStore();

  return (
    <section className="relative pt-24 pb-20 sm:pt-32 sm:pb-24 overflow-hidden bg-white min-h-[88vh] sm:min-h-[auto] flex items-center">
      {/* Background effects — مینیمال روی موبایل */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-20 right-1/4 w-96 h-96 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-80 h-80 rounded-full bg-orange-200/40 blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Text */}
          <div className="text-center lg:text-right">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-5"
              style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}
            >
              <Sparkles className="w-4 h-4" />
              اولین پلتفرم تخصصی طراحی برنامه بدنسازی
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="text-2xl sm:text-3xl font-black leading-tight mb-4 text-slate-900"
            >
              برنامه بدنسازی آنلاین با{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                فیتاپ
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-sm sm:text-lg text-slate-600 leading-relaxed mb-6 max-w-xl mx-auto lg:mx-0"
            >
              <span className="sm:hidden">
                بهترین برنامه تمرینی و غذایی بدنسازی، ساخته‌شده طبق الگوی بزرگترین مربیان بدنسازی دنیا.
                هوش مصنوعی اختصاصی فیتاپ، آموزش‌دیده توسط نخبگان بدنسازی ایران.
                خرید برنامه بدنسازی آنلاین.
              </span>
              <span className="hidden sm:inline">
                بهترین برنامه تمرینی و غذایی بدنسازی، ساخته‌شده طبق الگوی بزرگترین مربیان بدنسازی دنیا.
                هوش مصنوعی اختصاصی فیتاپ، آموزش‌دیده توسط نخبگان بدنسازی ایران، برنامه‌ای کاملاً
                شخصی‌سازی‌شده برای افزایش حجم، چربی‌سوزی و عضله‌سازی برای شما طراحی می‌کند.
                خرید برنامه بدنسازی آنلاین و کاملاً شخصی با پشتیبانی ۲۴ ساعته.
              </span>
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8"
            >
              <button
                onClick={() => { setScreen("auth"); pushScreen("auth") }}
                className="rounded-2xl h-14 px-8 text-base font-bold flex items-center justify-center gap-2 text-white shadow-xl transition hover:scale-[1.02]"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                  boxShadow: "0 12px 30px -8px rgba(249, 115, 22, 0.5)",
                }}
              >
                <Zap className="w-5 h-5" />
                شروع کنید
                <ChevronLeft className="w-5 h-5" />
              </button>
            </motion.div>

            {/* Rating */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="flex items-center gap-3 justify-center lg:justify-start"
            >
              <div className="flex">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <div className="text-sm text-slate-600">
                <span className="font-bold text-slate-900">{toPersianDigits("۴.۹")}</span>
                <span> از {toPersianDigits("۱۰,۰۰۰+")} کاربر</span>
              </div>
            </motion.div>
          </div>

          {/* Visual — hero image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, x: 30 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ delay: 0.3, type: "spring", duration: 0.4 }}
            className="relative"
          >
            <div className="relative mx-auto max-w-lg">
              {/* Hero image card — فقط تصویر اصلی، بدون المان‌های متحرک */}
              <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border-4 border-white">
                <img
                  src="/hero-fitup.webp"
                  alt="فیتاپ - اپلیکیشن تناسب اندام با هوش مصنوعی"
                  width={886}
                  height={886}
                  className="w-full h-auto block"
                  loading="eager"
                  fetchPriority="high"
                />
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
