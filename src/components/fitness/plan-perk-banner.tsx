"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Crown, X } from "lucide-react";
import { motion } from "framer-motion";

/**
 * ─── v138 — بنر «می‌دونستی؟» برای کاربران بدون پلن (دیرکتیو مالک) ───
 *
 * بالای بانک حرکات و بانک غذاها: «می‌دونستی با دریافت برنامهٔ شخصی می‌تونی این
 * حرکات/غذاها رو داخل برنامت ببینی و ثبت کنی؟»
 *
 * • حالت خودکفا: خودش /api/auth/me را چک می‌کند (صفحات عمومی SSR)
 * • رد شدن با X در localStorage (هر kind جدا — یک‌بار برای همیشه بسته می‌شود)
 * • برای مهمان‌ها هم نشان داده می‌شود (CTA همان ثبت‌نام/پلن)
 */

type Kind = "exercises" | "foods";

const CONTENT: Record<Kind, { text: string; cta: string; href: string }> = {
  exercises: {
    text: "می‌دونستی با دریافت برنامهٔ شخصی می‌تونی این حرکات رو داخل برنامت ببینی و ثبت کنی؟",
    cta: "دیدن برنامه‌ها",
    href: "/?screen=panel&tab=plans",
  },
  foods: {
    text: "می‌دونستی با دریافت برنامهٔ شخصی می‌تونی این غذاها رو داخل برنامت ببینی و ثبت کنی؟",
    cta: "دیدن برنامه‌ها",
    href: "/?screen=panel&tab=plans",
  },
};

const DISMISS_KEY = (kind: Kind) => `fitup-plan-perk-banner-${kind}`;

export function PlanPerkBanner({ kind }: { kind: Kind }) {
  const [state, setState] = useState<"loading" | "show" | "hide">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // بسته‌شده توسط کاربر؟ (localStorage — بدون setState همگام در effect)
      try {
        if (localStorage.getItem(DISMISS_KEY(kind)) === "1") {
          if (!cancelled) setState("hide");
          return;
        }
      } catch {}
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const user = data?.user;
        // کاربر پلن‌دار → هیچ بنری (این بنر فقط برای بدون‌پلن/مهمان است)
        if (user?.hasActiveSubscription) {
          setState("hide");
        } else {
          setState("show");
        }
      } catch {
        if (!cancelled) setState("hide"); // خطا → بی‌صدا (ضد مزاحمت)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  if (state !== "show") return null;
  const c = CONTENT[kind];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl p-4 mb-6 border border-orange-200 shadow-sm"
      style={{ background: "linear-gradient(135deg, #fffbeb 0%, #ffedd5 100%)" }}
      role="note"
    >
      <div className="absolute -left-8 -top-8 w-28 h-28 rounded-full bg-orange-300/20 blur-2xl" />
      <div className="relative flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-amber-900 leading-relaxed">
            {c.text}
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Link
              href={c.href}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 h-8 text-white text-xs font-bold shadow-md transition hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Crown className="w-3.5 h-3.5" />
              {c.cta}
            </Link>
          </div>
        </div>
        <button
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY(kind), "1");
            } catch {}
            setState("hide");
          }}
          className="w-7 h-7 rounded-full bg-white/70 border border-orange-200 flex items-center justify-center text-amber-500 hover:text-amber-700 transition shrink-0"
          aria-label="بستن پیام"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
