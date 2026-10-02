"use client";

/**
 * v171 — صفحهٔ وضعیت لینک پرداخت پیامکی (/enter/expired)
 *
 * سند بخش ۹ (Fallback): «توکن منقضی شد → صفحه لینک منقضی شده + دریافت لینک جدید»
 *  • reason=expired  → «لینک منقضی شده» + دکمهٔ «دریافت لینک جدید» (پیامک دوباره)
 *  • reason=invalid  → «لینک معتبر نیست» (مصرف‌شده/ناموجود)
 *  • reason=gateway  → «درگاه موقتاً در دسترس نیست» + تلاش مجدد
 * بعد از دریافت لینک جدید: شمارش معکوس ۶۰ ثانیه‌ای برای ارسال مجدد (سند بخش ۲).
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  LinkIcon,
  Clock,
  ShieldAlert,
  RefreshCw,
  Home,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toPersianDigits } from "@/lib/fitness/types";

type Reason = "expired" | "invalid" | "gateway";

const REASON_META: Record<Reason, { title: string; body: string }> = {
  expired: {
    title: "لینک پرداخت منقضی شده است",
    body: "لینک‌های پرداخت برای امنیت بیشتر فقط ۲۰ دقیقه اعتبار دارند. با دکمهٔ زیر یک لینک تازه به همان شماره پیامک می‌شود.",
  },
  invalid: {
    title: "این لینک معتبر نیست",
    body: "لینک پیدا نشد یا قبلاً با موفقیت استفاده شده است. اگر پرداخت شما انجام شده، از پنل کاربری وضعیتش را ببینید؛ در غیر این صورت از پنل دوباره اقدام کنید.",
  },
  gateway: {
    title: "اتصال به درگاه ممکن نشد",
    body: "درگاه پرداخت موقتاً در دسترس نیست. چند لحظه صبر کنید و دوباره تلاش کنید — اگر مبلغی کسر شده باشد، حفظ می‌شود.",
  },
};

export default function EnterExpiredPage() {
  const [reason, setReason] = useState<Reason>("invalid");
  const [oldToken, setOldToken] = useState<string>("");
  const [ready, setReady] = useState(false);

  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const r = (sp.get("reason") || "").trim();
    setReason(r === "expired" || r === "gateway" ? (r as Reason) : "invalid");
    setOldToken((sp.get("t") || "").trim());
    setReady(true);
  }, []);

  // شمارش معکوس ۶۰ ثانیه‌ای «ارسال مجدد»
  useEffect(() => {
    if (cooldown <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setCooldown((c) => (c <= 1 ? 0 : c - 1));
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cooldown > 0]);

  async function requestNewLink() {
    if (sending || cooldown > 0) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/payment/instagram/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSentOk(true);
        setCooldown(60);
      } else if (res.status === 429) {
        const wait = Number(data.retryAfterSec) || 60;
        setSendError(`کمی صبر کنید — ${toPersianDigits(String(wait))} ثانیه دیگر دوباره تلاش کنید.`);
        setCooldown(wait);
      } else {
        setSendError(
          data.error ||
            "ارسال لینک جدید ممکن نشد. از پنل کاربری (تب پلن‌ها) دوباره اقدام کنید."
        );
      }
    } catch {
      setSendError("ارتباط با سرور برقرار نشد — اتصال خود را بررسی و دوباره تلاش کنید.");
    } finally {
      setSending(false);
    }
  }

  const meta = REASON_META[reason];
  const canRequestNew = reason === "expired" && !!oldToken;

  const Icon = reason === "expired" ? Clock : reason === "gateway" ? RefreshCw : ShieldAlert;

  return (
    <main
      dir="rtl"
      className="min-h-screen w-full bg-gradient-to-b from-orange-50 via-white to-white flex items-center justify-center p-4"
    >
      {ready && (
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-md bg-white border border-orange-100 rounded-3xl shadow-xl shadow-orange-500/5 p-7 text-center"
        >
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center">
            <Icon className="w-8 h-8 text-orange-500" aria-hidden />
          </div>

          <h1 className="text-lg font-bold text-slate-900 mb-2">{meta.title}</h1>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">{meta.body}</p>

          {sentOk && (
            <div className="mb-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2 justify-center">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>لینک پرداخت تازه پیامک شد — پیامک را باز کنید و روی لینک بزنید.</span>
            </div>
          )}
          {sendError && (
            <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
              {sendError}
            </div>
          )}

          <div className="space-y-2.5">
            {canRequestNew && (
              <Button
                onClick={requestNewLink}
                disabled={sending || cooldown > 0}
                className="w-full h-12 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : cooldown > 0 ? (
                  `ارسال مجدد تا ${toPersianDigits(String(cooldown))} ثانیه دیگر`
                ) : (
                  <>
                    <MessageSquare className="w-4 h-4 ml-2" />
                    دریافت لینک جدید
                  </>
                )}
              </Button>
            )}

            {reason === "gateway" && (
              <Button
                onClick={() => window.location.reload()}
                className="w-full h-12 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold"
              >
                <RefreshCw className="w-4 h-4 ml-2" />
                تلاش مجدد
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/?screen=panel&tab=plans";
              }}
              className="w-full h-12 rounded-2xl border-slate-200 text-slate-700 hover:bg-slate-50 font-bold"
            >
              <LinkIcon className="w-4 h-4 ml-2" />
              انتخاب پلن از پنل
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full h-11 rounded-2xl text-slate-500 hover:bg-slate-50 text-sm"
            >
              <Home className="w-4 h-4 ml-2" />
              صفحهٔ اصلی
            </Button>
          </div>

          <p className="mt-6 text-[11px] text-slate-400 leading-relaxed">
            اگر مبلغی از حساب شما کسر شده باشد، بانک به‌صورت خودکار برمی‌گرداند —
            هیچ پرداختی گم نمی‌شود.
          </p>
        </motion.div>
      )}
    </main>
  );
}
