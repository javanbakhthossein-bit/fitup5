"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const TIPS = [
  "مربی هوشمند همیشه کنارته",
  "برنامه تمرینی شخصی‌سازی شده",
  "تغذیه هوشمند با AI",
  "پیگیری پیشرفت لحظه‌ای",
];

// v171 — چرخش نکته‌ها در سطح ماژول (نه در state هر mount): SplashLoader در
// مسیرهای مختلف دوباره مونت می‌شود (dynamic fallback ها، فید-اوت overlay،
// مرز خطا) — قبلاً هر مونت tipIdx=۰ را از نو شروع می‌کرد و متن نکته روی
// سوییچ اسپلش→پنل «پرش» می‌کرد. حالا همهٔ نمونه‌ها دقیقاً از همان نکتهٔ
// جاری ادامه می‌دهند — سوییچ‌ها از نظر بصری بی‌درزند. (SplashLoader هرگز
// در SSR رندر نمی‌شود — پس متغیر ماژولی کلاینت امن است.)
let sharedTipIdx = 0;

export function SplashLoader() {
  // مقدار اولیه از چرخش مشترک — اولین نکته همزمان با لوگو نمایش داده می‌شود
  const [tipIdx, setTipIdx] = useState(sharedTipIdx);

  useEffect(() => {
    // چرخش سریع — هر ۸۰۰ms
    const tipTimer = setInterval(() => {
      sharedTipIdx = (sharedTipIdx + 1) % TIPS.length;
      setTipIdx(sharedTipIdx);
    }, 800);
    return () => clearInterval(tipTimer);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden flex flex-col items-center justify-center bg-white">
      {/* ─── Main content ─── */}
      <div className="relative z-10 flex flex-col items-center">
        {/* ─── FitUp logo ─── */}
        <div className="mb-5">
          <motion.div
            className="rounded-3xl overflow-hidden"
            style={{ boxShadow: "0 12px 36px -8px rgba(249,115,22,0.35)" }}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <img
              src="/fitup-logo.png"
              alt="فیتاپ"
              width={112}
              height={112}
              className="block"
              style={{ width: 112, height: 112, objectFit: "cover" }}
            />
          </motion.div>
        </div>

        {/* ─── Rotating tip text — همزمان با لوگو، فوری ─── */}
        <div className="h-6 flex items-center justify-center overflow-hidden">
          <motion.p
            key={tipIdx}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="text-sm text-orange-600/80 font-medium whitespace-nowrap"
          >
            {TIPS[tipIdx]}
          </motion.p>
        </div>
      </div>
    </div>
  );
}

// ─── v171 — فید-اوت ۲۲۰ms اسپلش روی محتوای جدید (کراس‌فید، بدون سوییچ خشک) ───
// سوییچ اسپلش→پنل قبلاً unmount/mount خشک بود. حالا page-client وقتی محتوا
// واقعی جای اسپلش را گرفت، این overlay را ۲۲۰ms روی آن نمایش می‌دهد:
// fixed روی همه‌چیز + pointer-events-none (هیچ رخداد موس/لمسی نمی‌گیرد) +
// unmount با تأخیر تا انیمیشن کامل شود (انیمیشن در globals.css).
export function SplashFadeOut({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 260);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      className="fitup-splash-fadeout fixed inset-0 z-[100] pointer-events-none"
      aria-hidden="true"
    >
      <SplashLoader />
    </div>
  );
}
