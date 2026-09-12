"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const TIPS = [
  "مربی هوشمند همیشه کنارته",
  "برنامه تمرینی شخصی‌سازی شده",
  "تغذیه هوشمند با AI",
  "پیگیری پیشرفت لحظه‌ای",
];

/** شعار برند — کلمه‌به‌کلمه انیمیت می‌شود (به‌ترتیب منطقی RTL) */
const SLOGAN_WORDS = ["هر", "بدنی", "فیتاپ", "میخواد!"];

/**
 * v78 — اسپلش فیتاپ (بازطراحی کامل بر اساس دستور مالک):
 *   فقط لوگوی فیتاپ در مرکز — تصویر «بدن هیرو» کاملاً حذف شد.
 *   ۱) لوگو (۱۴۰px از سورس کریسپ ۵۱۲): ورود اورشوت نرم (backOut) +
 *      هالهٔ نور تپنده + شناوری پیوسته
 *   ۲) حلقهٔ نور کونیک طلایی/نارنجی که آرام دور لوگو می‌چرخد + دو نقطهٔ
 *      مداری (بالا/پایین) روی همان مدار — همهٔ GPU-friendly (rotate/opacity)
 *   ۳) برند «فیتاپ» با جاروب نور (مطابق قبل)
 *   ۴) شعار «هر بدنی فیتاپ میخواد!» — کلمه‌به‌کلمه فید + سُرش به بالا
 *   ۵) نوار پیشرفت و نکتهٔ چرخشی مثل قبل
 * prefers-reduced-motion → همهٔ حلقه‌ها خاموش و چیدمان ثابت می‌ماند.
 * بدون هیچ عکس سنگین — فقط لوگو (icon-512 که مال آیکون PWA است و کش می‌شود).
 */
export function SplashLoader() {
  // مقدار اولیه ۰ — اولین نکته همزمان با لوگو نمایش داده می‌شود
  const [tipIdx, setTipIdx] = useState(0);
  // احترام به تنظیمات سیستم (prefers-reduced-motion) → چیدمان ثابت بدون هیچ حلقه‌ای
  const reduced = useReducedMotion() === true;

  useEffect(() => {
    // چرخش نکته‌ها — هر ۲۲۰۰ms (خواناتر برای کاربر)
    const tipTimer = setInterval(() => {
      setTipIdx((i) => (i + 1) % TIPS.length);
    }, 2200);
    return () => clearInterval(tipTimer);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden flex flex-col items-center justify-center bg-white">
      {/* ─── گرمای ملایم پس‌زمینه — هالهٔ طلایی خیلی محو پشت کل صحنه ─── */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] max-w-[680px] aspect-square rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(249,115,22,0.12) 0%, rgba(245,158,11,0.06) 45%, rgba(255,255,255,0) 72%)",
        }}
        animate={
          reduced ? undefined : { opacity: [0.6, 1, 0.6], scale: [0.94, 1.05, 0.94] }
        }
        transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* ─── ستون اصلی ─── */}
      <div className="relative z-10 flex flex-col items-center px-6">
        {/* ─── لوگو: حلقهٔ کونیک چرخان + دو نقطهٔ مداری + هالهٔ تپنده ─── */}
        <div className="relative mb-8 w-[150px] h-[150px]">
          {/* حلقهٔ نور کونیک — دو قوس طلایی/نارنجی که دور لوگو می‌گردند */}
          {!reduced && (
            <motion.div
              aria-hidden
              className="absolute -inset-2 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, rgba(245,158,11,0.55) 45deg, transparent 100deg, transparent 185deg, rgba(249,115,22,0.45) 230deg, transparent 285deg)",
                WebkitMaskImage:
                  "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))",
                maskImage:
                  "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
            />
          )}
          {/* دو نقطهٔ مداری — روی همان مدار حلقه، چرخش معکوس‌کند */}
          {!reduced && (
            <motion.div
              aria-hidden
              className="absolute -inset-2"
              animate={{ rotate: -360 }}
              transition={{ duration: 11, repeat: Infinity, ease: "linear" }}
            >
              <span
                className="absolute top-0 left-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500"
                style={{ boxShadow: "0 0 10px 2px rgba(249,115,22,0.55)" }}
              />
              <span
                className="absolute bottom-0 left-1/2 block h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-amber-400"
                style={{ boxShadow: "0 0 8px 2px rgba(245,158,11,0.45)" }}
              />
            </motion.div>
          )}
          {/* هالهٔ نورانی پشت لوگو — تپش هماهنگ با شناوری */}
          <motion.div
            aria-hidden
            className="absolute inset-1 rounded-full bg-orange-400/40 blur-2xl"
            animate={
              reduced
                ? undefined
                : { opacity: [0.35, 0.75, 0.35], scale: [0.95, 1.12, 0.95] }
            }
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* ورود اولیه لوگو — اورشوت نرم مثل پرش برند */}
          <motion.div
            initial={reduced ? false : { opacity: 0, scale: 0.55 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.65, ease: "backOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* شناوری پیوسته + تپش مقیاس ظریف */}
            <motion.div
              animate={
                reduced ? undefined : { y: [0, -8, 0], scale: [1, 1.03, 1] }
              }
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <img
                src="/icon-512.png"
                alt="فیتاپ"
                width={140}
                height={140}
                draggable={false}
                className="block select-none"
                style={{
                  width: 140,
                  height: 140,
                  objectFit: "contain",
                  filter: "drop-shadow(0 14px 26px rgba(249,115,22,0.38))",
                }}
              />
            </motion.div>
          </motion.div>
        </div>

        {/* ─── برند «فیتاپ» — فید + سُرش به بالا + جاروب نور ظریف ─── */}
        <motion.h1
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.25, ease: "easeOut" }}
          className="text-5xl font-extrabold text-gray-900 relative overflow-hidden px-2 leading-tight"
        >
          فیتاپ
          {/* جاروب نور — باریکهٔ روشن که هر ۳ ثانیه از روی متن می‌گذرد */}
          {!reduced && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3 pointer-events-none"
              style={{
                background:
                  "linear-gradient(105deg, transparent 0%, rgba(249,115,22,0.28) 50%, transparent 100%)",
                filter: "blur(2px)",
              }}
              initial={{ x: "-160%", skewX: "-12deg" }}
              animate={{ x: "420%" }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                repeatDelay: 1.8,
                ease: "easeInOut",
                delay: 0.9,
              }}
            />
          )}
        </motion.h1>

        {/* ─── شعار برند «هر بدنی فیتاپ میخواد!» — کلمه‌به‌کلمه فید + سُرش ─── */}
        <p
          dir="rtl"
          aria-label="هر بدنی فیتاپ میخواد!"
          className="mt-3 flex items-center gap-x-2 text-lg font-bold text-orange-600"
        >
          {SLOGAN_WORDS.map((word, i) => (
            <motion.span
              key={word}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.5 + i * 0.14,
                ease: "easeOut",
              }}
            >
              {word}
            </motion.span>
          ))}
        </p>

        {/* ─── نوار پیشرفت نامعین — جاروب ملایم (کلاسیک‌تر از نقطه‌های جهنده) ─── */}
        <div className="mt-8 h-1 w-40 overflow-hidden rounded-full bg-orange-100">
          <motion.div
            className="h-full w-1/2 rounded-full bg-orange-500"
            animate={reduced ? undefined : { x: ["-100%", "200%"] }}
            transition={{
              duration: 1.3,
              repeat: Infinity,
              ease: "easeInOut",
              repeatDelay: 0.2,
            }}
          />
        </div>

        {/* ─── نکتهٔ چرخشی — فید نرم بین نکته‌ها (بدون جابه‌جایی چیدمان) ─── */}
        <div className="mt-5 h-6 flex items-center justify-center overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.p
              key={tipIdx}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-orange-600/80 font-medium whitespace-nowrap"
            >
              {TIPS[tipIdx]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
