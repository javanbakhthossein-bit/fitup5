"use client";

import { motion } from "framer-motion";
import { Lock, Crown, Sparkles, ChevronLeft } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";

/**
 * ─── PlanLockedView — قفل بخش‌های پنل برای کاربر بدون پلن فعال (v15) ───
 *
 * درخواست مالک: «برای کاربری که هیچ پلن فعالی نداره، پنلش باید برنامه‌ها،
 * تمرین‌ها، دستیار تغذیه، پیشرفت و چت با فیتاپ قفل باشه.»
 *
 * این ویو جایگزین محتوای تب‌های قفل‌شده می‌شود — کارت زیبا با آیکون بزرگ قفل،
 * توضیح شفاف و CTA رفتن به پلن‌ها. کاربران pending (خرید کرده و منتظر
 * تکمیل پیش‌نیازها) و ادمین قفل نمی‌شوند.
 */
const TAB_HINTS: Record<string, string> = {
  programs: "برنامه تمرینی اختصاصی شما با ساخت هوش مصنوعی، همین‌جا ظاهر می‌شود.",
  workouts: "تمرین‌های امروز و جلسات فعال پلن، با فعال‌شدن اشتراک در دسترس‌اند.",
  nutrition: "برنامه غذایی شخصی‌سازی‌شده + دستیار تغذیه و مکمل‌ها با پلن فعال می‌آید.",
  progress: "چکاپ‌های دوره‌ای، نمودار پیشرفت و تحلیل جامع هوش مصنوعی مخصوص اعضای فیتاپ است.",
  chat: "گفتگو با مربی هوشمند فیتاپ — پاسخ‌های اختصاصی بر اساس داده‌های ورزشی تو.",
};

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

export function PlanLockedView({ tab }: { tab: string }) {
  const { user, setMainTab } = useAppStore();
  const hint = TAB_HINTS[tab] || "این بخش با فعال‌شدن پلن باز می‌شود.";
  const name = user?.name?.trim() ? user.name.trim() : "ورزشکار";

  return (
    <div className="px-4 py-8 max-w-md mx-auto" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-3xl p-[1.5px] shadow-lg shadow-orange-500/15"
        style={{ background: "linear-gradient(135deg, rgba(234,88,12,0.7), rgba(251,191,36,0.5), rgba(249,115,22,0.65))" }}
      >
        <div
          className="rounded-[22px] p-6 sm:p-8 text-center"
          style={{ background: "linear-gradient(165deg, #fffdf8 0%, #fff6e9 100%)" }}
        >
          {/* آیکون بزرگ قفل روی تاج */}
          <div className="relative w-20 h-20 mx-auto mb-4">
            <div
              className="absolute inset-0 rounded-3xl flex items-center justify-center shadow-lg"
              style={{ background: goldGradient }}
            >
              <Lock className="w-9 h-9 text-white" />
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center border border-orange-100">
              <Crown className="w-4 h-4 text-amber-500" />
            </div>
          </div>

          <h3 className="font-black text-lg text-slate-900 mb-1.5">
            {name} عزیز، این بخش قفل است
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed mb-1">{hint}</p>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-5">
            با فعال‌کردن پلن فیتاپ، همه‌ی ابزارها یک‌جا برایت باز می‌شوند — برنامه اختصاصی،
            دستیار تغذیه، چکاپ دوره‌ای و مربی هوشمند.
          </p>

          {/* قابلیت‌های کوچک */}
          <div className="grid grid-cols-2 gap-2 mb-5">
            {[
              { t: "برنامه اختصاصی AI", s: "تمرین + تغذیه" },
              { t: "مربی هوشمند ۲۴/۷", s: "چت + تحلیل عکس" },
              { t: "چکاپ دوره‌ای", s: "با تحلیل پیشرفت" },
              { t: "حالت باشگاه", s: "تمرین با موسیقی" },
            ].map((f, i) => (
              <div key={i} className="rounded-xl bg-white border border-orange-100 p-2.5 text-center">
                <p className="text-[11px] font-bold text-slate-800">{f.t}</p>
                <p className="text-[9px] text-slate-500">{f.s}</p>
              </div>
            ))}
          </div>

          <Button
            onClick={() => setMainTab("plans")}
            className="rounded-2xl text-white w-full h-12 text-sm font-black gap-2 shadow-md"
            style={{ background: goldGradient }}
          >
            <Sparkles className="w-4 h-4" />
            دیدن پلن‌ها و فعال‌سازی
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <button
            onClick={() => setMainTab("dashboard")}
            className="mt-3 text-[11px] text-slate-500 hover:text-orange-600 transition font-medium"
          >
            بازگشت به داشبورد
          </button>
        </div>
      </motion.div>
    </div>
  );
}
