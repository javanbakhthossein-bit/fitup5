"use client";

/**
 * صفحهٔ «پنل کاربری مسدود شده» (v51 — درخواست مالک)
 *
 * کاربر مسدودشده توسط ادمین (چه پلن داشته باشد چه نداشته باشد) به‌جای پنل
 * این صفحه را می‌بیند و هیچ بخشی از پنل برایش کار نمی‌کند:
 *  - همهٔ APIها از قبل ۴۰۱ می‌دهند (auth.ts: getCurrentUserWithMeta → isBlocked)
 *  - ورود با OTP/رمز هم مسیر ۴۰۳ دارد (verify-otp / login)
 *  - این صفحه فقط «نتیجه» را زیبا و صادقانه نشان می‌دهد + خروج/پشتیبانی
 *
 * نمایش در: ssr-screen (ریفرش)، doAuthCheck (ورود/ناوبری)، refreshUserIfNeeded
 * (مسدودسازی زندهٔ وسط سشن — صفحه همان لحظه عوض می‌شود).
 * طراحی: یک‌باره‌متحرک (بدون انیمیشن بی‌پایان — درس لگ WebView) + RTL.
 */

import { motion } from "framer-motion";
import { ShieldBan, LogOut, Headphones, ShieldCheck } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";

export function BlockedScreen() {
  const setScreen = useAppStore((s) => s.setScreen);

  async function handleLogout() {
    const { performLogout } = await import("@/lib/fitness/logout");
    await performLogout({ confirm: false });
  }

  return (
    <div
      dir="rtl"
      className="min-h-[100dvh] w-full flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(160deg, #fef2f2 0%, #ffffff 45%, #fff7ed 100%)",
      }}
      role="main"
      aria-label="پنل کاربری مسدود شده"
    >
      {/* هاله‌های پس‌زمینه — ثابت (بدون blur متحرک) */}
      <div aria-hidden className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-rose-100/60" />
      <div aria-hidden className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-orange-100/50" />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "tween", duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        className="relative w-full max-w-md bg-white rounded-3xl shadow-xl border border-rose-100 overflow-hidden"
      >
        {/* هدر گرادیانی */}
        <div
          className="relative px-6 pt-8 pb-7 text-center overflow-hidden"
          style={{ background: "linear-gradient(135deg, #e11d48 0%, #f43f5e 55%, #f97316 100%)" }}
        >
          <div aria-hidden className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
          <div aria-hidden className="absolute -bottom-12 -left-8 w-36 h-36 rounded-full bg-black/10" />
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 240, damping: 16, delay: 0.1 }}
            className="relative w-20 h-20 mx-auto rounded-3xl bg-white/20 ring-4 ring-white/30 flex items-center justify-center"
          >
            <ShieldBan className="w-10 h-10 text-white" strokeWidth={1.8} />
          </motion.div>
          <h1 className="relative mt-4 text-lg font-black text-white leading-snug">
            پنل کاربری شما از طرف مدیریت
            <br />
            مسدود شده است
          </h1>
        </div>

        {/* بدنه */}
        <div className="px-6 py-6 text-center">
          <p className="text-sm text-slate-600 leading-relaxed">
            دسترسی این حساب به تمام امکانات پنل کاربری — برنامه‌ها، تمرین‌ها،
            تغذیه، چت و کیف پول — متوقف شده است.
          </p>

          {/* آیتم‌های وضعیت */}
          <div className="mt-5 grid gap-2 text-right">
            {[
              "دسترسی به پنل کاربری غیرفعال است",
              "اشتراک و پرداخت‌های این حساب متوقف شده است",
              "برای پیگیری، با پشتیبانی در تماس باشید",
            ].map((text, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.09, duration: 0.25 }}
                className="flex items-center gap-2.5 rounded-xl bg-rose-50/70 border border-rose-100 px-3.5 py-2.5"
              >
                <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-xs text-slate-700 leading-relaxed">{text}</span>
              </motion.div>
            ))}
          </div>

          {/* دکمه‌ها */}
          <div className="mt-6 flex items-center gap-2.5">
            <button
              onClick={() => setScreen("contact")}
              className="flex-1 min-h-[48px] rounded-2xl border-2 border-slate-200 text-slate-700 text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 active:scale-[0.99] transition"
            >
              <Headphones className="w-4.5 h-4.5 text-slate-500" />
              تماس با پشتیبانی
            </button>
            <button
              onClick={handleLogout}
              className="flex-1 min-h-[48px] rounded-2xl text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-rose-500/25 hover:brightness-105 active:scale-[0.99] transition"
              style={{ background: "linear-gradient(135deg, #e11d48, #f97316)" }}
            >
              <LogOut className="w-4.5 h-4.5" />
              خروج از حساب
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
