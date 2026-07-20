"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, Sparkles, Home } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { toPersianDigits, formatToman } from "@/lib/fitness/types";
import { Button } from "@/components/ui/button";

type VerifyState = "verifying" | "success" | "failed";

interface ReceiptInfo {
  amount: number;
  plan: string;
  refId: string;
  message?: string;
}

/**
 * پردازش callback زرین‌پال — وقتی کاربر پس از پرداخت به سایت برمی‌گردد.
 *
 * زرین‌پال پس از پرداخت (یا انصراف/خطا) به callback_url با پارامترهای زیر redirect می‌کند:
 *   - Authority: کد authority که در مرحله checkout تولید شده
 *   - Status: "OK" | "NOK"
 *
 * ما برای تشخیص اینکه این یک بازگشت از زرین‌پال است، ?payment_verify=1 را در callback_url گذاشته‌ایم.
 * پس الگوی URL به این شکل است:
 *   /?payment_verify=1&Authority=A000...&Status=OK
 */
export function PaymentVerifyHandler() {
  const { setScreen, setUser, setMainTab } = useAppStore();
  const [state, setState] = useState<VerifyState>("verifying");
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const isVerify = params.get("payment_verify") === "1";
      if (!isVerify) return;

      const authority = params.get("Authority") || params.get("authority") || "";
      const status = (params.get("Status") || params.get("status") || "OK").toUpperCase();

      // پاک‌سازی query params از URL بدون reload
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("payment_verify");
        url.searchParams.delete("Authority");
        url.searchParams.delete("authority");
        url.searchParams.delete("Status");
        url.searchParams.delete("status");
        window.history.replaceState({}, "", url.toString());
      } catch {
        // ignore
      }

      // ابتدا کاربر فعلی را دریافت کن — اگر لاگین نیست، به صفحه اصلی برگردان
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        if (!meData.user) {
          setState("failed");
          setReceipt({
            amount: 0,
            plan: "—",
            refId: "—",
            message: "برای تأیید پرداخت باید وارد حساب کاربری خود شوید.",
          });
          return;
        }

        // پیدا کردن آخرین پرداخت pending کاربر
        const payRes = await fetch("/api/payment/lookup-pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authority }),
        });

        let paymentId: string | null = null;
        if (payRes.ok) {
          const payData = await payRes.json();
          paymentId = payData.paymentId ?? null;
        }

        if (!paymentId) {
          setState("failed");
          setReceipt({
            amount: 0,
            plan: "—",
            refId: authority.slice(0, 16) || "—",
            message: "پرداخت معلق یافت نشد. ممکن است قبلاً پردازش شده باشد.",
          });
          return;
        }

        // ارسال به verify
        const verifyStatus = status === "OK" ? "OK" : "NOK";
        const vRes = await fetch("/api/payment/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId, status: verifyStatus, authority }),
        });
        const vData = await vRes.json();

        if (vData.success) {
          if (vData.user) setUser(vData.user);
          setState("success");
          setReceipt({
            amount: vData.amount ?? 0,
            plan: vData.plan ?? "—",
            refId: vData.refId ?? "—",
          });
        } else {
          setState("failed");
          setReceipt({
            amount: vData.amount ?? 0,
            plan: vData.plan ?? "—",
            refId: vData.refId ?? "—",
            message: vData.message || "پرداخت ناموفق بود.",
          });
        }
      } catch (e) {
        setState("failed");
        setReceipt({
          amount: 0,
          plan: "—",
          refId: "—",
          message: e instanceof Error ? e.message : "خطا در ارتباط با سرور.",
        });
      }
    })();
  }, []);

  function finish() {
    setMainTab("dashboard");
    setScreen("main");
    // URL را به ?screen=panel تغییر بده تا رفرش پنل را نگه دارد
    try {
      window.history.replaceState({}, "", "/?screen=panel");
    } catch {}
  }

  function backHome() {
    setScreen("landing");
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      {/* subtle gold tinted background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-orange-200/20 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white border-2 border-orange-200 rounded-3xl shadow-2xl shadow-orange-500/10 p-8 text-center"
      >
        {state === "verifying" && (
          <>
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-orange-500/20"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2">در حال تایید پرداخت...</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              لطفاً صبر کنید. اطلاعات پرداخت شما در حال بررسی توسط زرین‌پال و فیتاپ است.
            </p>
          </>
        )}

        {state === "success" && receipt && (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-5 shadow-xl"
            >
              <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
            </motion.div>
            <h2 className="text-2xl font-black text-emerald-600 mb-2">پرداخت موفق! 🎉</h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              پلن شما با موفقیت فعال شد. پنل شما آماده است — برنامه تمرینی و غذایی شما در پس‌زمینه توسط فیتاپ هوشمند ساخته می‌شود و به‌زودی آماده می‌شود.
            </p>
            <div className="text-right p-4 rounded-2xl bg-slate-50 space-y-2 text-sm text-slate-900 mb-5">
              <div className="flex justify-between">
                <span className="text-slate-500">مبلغ</span>
                <span className="font-bold font-stat">{toPersianDigits(formatToman(receipt.amount))} تومان</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">پلن</span>
                <span>{receipt.plan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">کد پیگیری</span>
                <span dir="ltr" className="font-mono text-xs">{receipt.refId}</span>
              </div>
            </div>
            <Button
              onClick={finish}
              className="w-full rounded-xl h-12 font-bold text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Sparkles className="w-4 h-4" /> شروع تمرین! 💪
            </Button>
          </>
        )}

        {state === "failed" && receipt && (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-red-500 flex items-center justify-center mx-auto mb-5 shadow-xl"
            >
              <XCircle className="w-12 h-12 text-white" strokeWidth={2.5} />
            </motion.div>
            <h2 className="text-2xl font-black text-slate-900 mb-2">پرداخت ناموفق</h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              {receipt.message || "متأسفانه پرداخت شما ناموفق بود. در صورت کسر مبلغ، حداکثر پس از ۷۲ ساعت به حسابتان برمی‌گردد."}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={backHome}
                variant="outline"
                className="flex-1 rounded-xl h-11"
              >
                <Home className="w-4 h-4" /> بازگشت به خانه
              </Button>
              <Button
                onClick={finish}
                className="flex-1 rounded-xl h-11 font-bold text-white"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                تلاش مجدد
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
