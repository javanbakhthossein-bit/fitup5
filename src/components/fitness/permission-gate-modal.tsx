"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Mic, Images, Camera, CheckCircle2, X } from "lucide-react";
import {
  registerPermissionGate,
  type PermissionGateType,
} from "@/lib/fitness/permission-gate";

/**
 * مودال زیبای «دسترسی‌ها» — pre-permission rationale برای اپ اندروید اختصاصی.
 *
 * FIX (گزارش مالک — v50): «مدال دسترسی به گالری در اپ با لگ شدید باز می‌شود و
 * دکمه‌هایش کار نمی‌کند.» دو ریشهٔ قطعی که هر دو فیکس شد:
 *
 *  ۱) دکمه‌های مرده: وقتی این مودال روی یک Sheet/Dialog رادیکس (مثل پروفایل)
 *     باز می‌شود، رادیکس برای جلوگیری از کلیک بیرون،
 *     document.body.style.pointerEvents = "none" می‌گذارد. این مودال portal
 *     نداشت و فرزند body بود → خودش هم pointer-events:none می‌گرفت → هیچ کلیکی
 *     روی هیچ دکمه‌ای اثر نمی‌کرد (تپش هم به Sheet زیرین می‌خورد).
 *     ← حالا createPortal به body + pointerEvents:"auto" صریح روی backdrop.
 *
 *  ۲) لگ شدید WebView: backdropFilter:blur(6px) متحرکِ تمام‌صفحه روی یک
 *     Sheet ۹۰vh + دو حلقهٔ pulse بی‌نهایت + اسپرینگ تند = قاتل GPU WebView
 *     اندروید. ← حالا اسکریم ساده بدون blur، حلقه‌های ثابت (بدون انیمیشن)،
 *     انیمیشن tween سبک به‌جای اسپرینگ سنگین.
 *
 * در مرورگر/PWA هرگز باز نمی‌شود (فقط دروازه‌های اپ اختصاصی صدا می‌زنند).
 */

const GOLD_GRADIENT = "linear-gradient(135deg, #f59e0b, #f97316)";

const CONTENT: Record<
  PermissionGateType,
  {
    icon: typeof Bell;
    title: string;
    desc: string;
    bullets: string[];
    confirm: string;
    dismiss: string;
  }
> = {
  notifications: {
    icon: Bell,
    title: "اعلان‌های فیتاپ را فعال کنی؟ 🔔",
    desc: "یادآوری تمرین، نکات تغذیه و پیام‌های مربی را حتی وقتی فیتاپ بسته است دریافت کن — هیچ خبر مهمی را از دست نمی‌دهی.",
    bullets: [
      "یادآوری روزهای تمرین و برنامهٔ غذایی",
      "پیام‌های مربی و پاسخ پشتیبانی",
      "خبرها و کدهای تخفیف، اول از همه",
    ],
    confirm: "فعال‌سازی اعلان‌ها",
    dismiss: "الان نه",
  },
  microphone: {
    icon: Mic,
    title: "اجازهٔ استفاده از میکروفون 🎙️",
    desc: "برای ضبط پیام صوتی و فرستادنش به مربی، در همین لحظهٔ ضبط به میکروفون نیاز است.",
    bullets: [
      "فقط هنگامی که خودت دکمهٔ ضبط را می‌زنی فعال می‌شود",
      "بدون هیچ ضبط پشت‌صحنه‌ای",
    ],
    confirm: "اجازه می‌دهم",
    dismiss: "الان نه",
  },
  gallery: {
    icon: Images,
    title: "باز شدن گالری گوشی 🖼️",
    desc: "برای انتخاب عکس یا ویدیو، گالری گوشی‌ات باز می‌شود — فقط همان چیزی که خودت انتخاب می‌کنی ارسال خواهد شد.",
    bullets: [
      "انتخاب عکس فقط با دست خودت",
      "فیتاپ به هیچ عکس دیگری دسترسی ندارد",
    ],
    confirm: "باز کردن گالری",
    dismiss: "الان نه",
  },
  camera: {
    icon: Camera,
    title: "اجازهٔ استفاده از دوربین 📷",
    desc: "برای ضبط ویدیوی فرم حرکات یا عکس بدن، در همین لحظه به دوربین نیاز است.",
    bullets: [
      "فقط وقتی خودت ضبط را شروع می‌کنی",
      "ویدیو فقط برای تحلیل فرم تمرین استفاده می‌شود",
    ],
    confirm: "اجازه می‌دهم",
    dismiss: "الان نه",
  },
};

interface GateRequest {
  type: PermissionGateType;
  resolve: (ok: boolean) => void;
}

const subscribeNoop = () => () => {};

export function PermissionGateModal() {
  const [req, setReq] = useState<GateRequest | null>(null);
  // mounted بدون setState در effect (قاعدهٔ lint): server=false، client=true
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );

  // singleton: منطق دروازه خودش را به این کامپوننت وصل می‌کند
  useEffect(() => {
    return registerPermissionGate(async (type) => {
      return new Promise<boolean>((resolve) => {
        // اگر قبلاً مودالی باز است، آن را بی‌جواب نبند — فقط جدید جایگزین می‌شود
        setReq((prev) => {
          if (prev) prev.resolve(false);
          return { type, resolve };
        });
      });
    });
  }, []);

  // اگر وسط مودال unmount شد → ردِ محترمانه
  useEffect(() => {
    return () => {
      setReq((prev) => {
        if (prev) prev.resolve(false);
        return null;
      });
    };
  }, []);

  function close(ok: boolean) {
    setReq((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }

  const content = req ? CONTENT[req.type] : null;

  // FIX: portal به body + pointerEvents:auto صریح — وقتی Sheet رادیکس باز است،
  // body دارای pointer-events:none است و بدون این، مودال کورکلیک می‌شود.
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {req && content && (
        <motion.div
          key="perm-gate"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          // z-[140]: بالاتر از همهٔ لایه‌ها (Sheet ادمین z-100، آپدیت اپ z-110،
          // قوانین سراسری z-130) تا هیچ‌وقت زیر مدال دیگری گیر نکند.
          className="fixed inset-0 z-[140] flex items-center justify-center p-5"
          // FIX لگ: اسکریم سادهٔ rgba — بدون backdropFilter (blur متحرک در
          // WebView اندروید هر فریم re-composite تمام‌صفحه می‌خواهد).
          style={{
            background: "rgba(15,23,42,0.62)",
            pointerEvents: "auto",
          }}
          dir="rtl"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
          aria-label={content.title}
        >
          <motion.div
            initial={{ scale: 0.92, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 10, opacity: 0 }}
            // FIX لگ: tween کوتاه به‌جای اسپرینگ تند (stiffness 320) — نرم و
            // بدون فشار روی compositor WebView.
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden"
          >
            {/* دکمهٔ بستن */}
            <button
              onClick={() => close(false)}
              aria-label="بستن"
              className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
            >
              <X className="w-4 h-4" />
            </button>

            {/* هدر گرادیانی + گوی آیکون */}
            <div
              className="relative px-6 pt-8 pb-6 text-center overflow-hidden"
              style={{ background: "linear-gradient(160deg, #fff7ed 0%, #ffedd5 60%, #fed7aa 100%)" }}
            >
              {/* FIX لگ: حلقه‌های نور حالا کاملاً ثابت‌اند (قبلاً دو حلقه با
                  repeat:Infinity هر فریم style می‌گرفتند و compositor را بیکار
                  نمی‌گذاشتند) — همان حس بصری، صفر هزینهٔ انیمیشن. */}
              <div
                className="absolute left-1/2 top-8 -translate-x-1/2 rounded-full pointer-events-none"
                style={{ width: 88, height: 88, border: "2px solid rgba(249,115,22,0.22)" }}
              />
              <div
                className="absolute left-1/2 top-8 -translate-x-1/2 rounded-full pointer-events-none"
                style={{ width: 116, height: 116, border: "2px solid rgba(249,115,22,0.12)" }}
              />
              <motion.div
                initial={{ scale: 0.7, rotate: -12, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                className="relative mx-auto w-[72px] h-[72px] rounded-3xl flex items-center justify-center shadow-xl"
                style={{ background: GOLD_GRADIENT }}
              >
                <content.icon className="w-9 h-9 text-white" />
              </motion.div>
            </div>

            {/* بدنه */}
            <div className="px-6 pb-6">
              <motion.h3
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.2 }}
                className="text-lg font-black text-slate-900 text-center leading-snug mb-2"
              >
                {content.title}
              </motion.h3>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.14, duration: 0.2 }}
                className="text-[13px] text-slate-600 text-center leading-relaxed mb-4"
              >
                {content.desc}
              </motion.p>

              <ul className="space-y-2 mb-5">
                {content.bullets.map((b, i) => (
                  <motion.li
                    key={b}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.18 + i * 0.06, duration: 0.2 }}
                    className="flex items-center gap-2 rounded-xl bg-orange-50/70 border border-orange-100 px-3 py-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-orange-500 shrink-0" />
                    <span className="text-[12px] font-bold text-slate-700 leading-relaxed">{b}</span>
                  </motion.li>
                ))}
              </ul>

              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26, duration: 0.2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => close(true)}
                className="w-full min-h-[52px] rounded-2xl text-white font-black text-[15px] shadow-lg flex items-center justify-center gap-2 transition hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: GOLD_GRADIENT }}
              >
                <content.icon className="w-5 h-5" />
                {content.confirm}
              </motion.button>

              <button
                onClick={() => close(false)}
                className="w-full mt-2.5 py-2 rounded-2xl text-[13px] font-bold text-slate-400 hover:text-slate-600 transition"
              >
                {content.dismiss}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
