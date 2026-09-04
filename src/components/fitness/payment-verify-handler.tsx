"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, Sparkles, Home, LifeBuoy } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { toPersianDigits, formatToman } from "@/lib/fitness/types";
import { Button } from "@/components/ui/button";

type VerifyState = "verifying" | "querying" | "success" | "failed" | "login";

/** حداکثر تلاش خودکار برای استعلام نتیجه پرداختِ در حال پردازش */
const MAX_VERIFY_ATTEMPTS = 5;
/** فاصله بین تلاش‌های استعلام (میلی‌ثانیه) */
const VERIFY_RETRY_DELAY_MS = 2500;
/** تلاش‌های یافتن پرداخت (lookup) — محکم‌کاری برای هم‌زمانی‌های گذرا */
const MAX_LOOKUP_ATTEMPTS = 3;

interface ReceiptInfo {
  amount: number;
  plan: string;
  refId: string;
  message?: string;
  /** "wallet_topup" برای شارژ کیف پول؛ در غیر این صورت planId خرید پلن */
  type?: string;
  /** موجودی جدید کیف پول بعد از شارژ (فقط برای wallet_topup) */
  walletBalance?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 *
 * ─── FIX (باگ «پرداخت ناموفق» برای کاربرِ پول‌داده‌شده) ───
 * اصل طلایی این صفحه: تا وقتی قطعی نشده که پرداخت ناموفق بوده، هرگز
 * «پرداخت ناموفق» به کاربر نشان نمی‌دهیم. کاربر با Status=OK از درگاه
 * برگشته یعنی بانک پولش را گرفته — بدترین کار ممکن گفتن «ناموفق» است.
 * مسیرهای رفع قبلی:
 *  ۱. lookup-pending حالا «verifying» (claim همزمان recover) را هم برمی‌گرداند
 *     (قبلاً ۴۰۴ می‌داد → پیام غلط «پرداخت معلق یافت نشد»)
 *  ۲. اگر پرداخت قبلاً موفق بوده → رسید موفق idempotent (رفرش ایمن است)
 *  ۳. اگر اصلاً رکوردی پیدا نشد → حالت «در حال استعلام» + recover خودکار،
 *     هرگز failed
 */
export function PaymentVerifyHandler({
  onDone,
}: {
  /** FE-C1: بعد از هر مسیر خروج (finish / backHome) صدا زده می‌شود تا
   *  HomeClient فلگ paymentVerify را false کند — قبلاً این فلگ هرگز ریست
   *  نمی‌شد و کاربر تا reload کامل در همین صفحه گیر می‌کرد. */
  onDone?: () => void;
}) {
  const { setScreen, setUser, setMainTab } = useAppStore();
  const [state, setState] = useState<VerifyState>("verifying");
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);
  const [gatewayReturn, setGatewayReturn] = useState<{
    authority: string;
    status: "OK" | "NOK";
  } | null>(null);

  /**
   * صدا زدن verify با تلاش مجدد خودکار برای وضعیت‌های غیرقطعی
   * ("verifying" = فراخوان دیگری در حال پردازش است؛ "pending" = خطای موقت
   * شبکه به زرین‌پال — claim آزاد شده و retry امن است).
   */
  async function runVerify(
    paymentId: string,
    authority: string,
    verifyStatus: "OK" | "NOK",
  ) {
    let vData: any = null;
    for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt++) {
      let vRes: Response;
      try {
        vRes = await fetch("/api/payment/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId, status: verifyStatus, authority }),
        });
      } catch {
        // خطای شبکه به سرور خودمان — قابل تلاش مجدد
        vData = { success: false, status: "pending", message: "خطا در ارتباط با سرور — در حال تلاش مجدد…" };
        await sleep(VERIFY_RETRY_DELAY_MS);
        continue;
      }
      vData = await vRes.json().catch(() => ({}));
      // موفقیت یا هر پاسخ قطعی نتیجه نهایی است — حلقه را قطع کن
      const nonFinal = vData.status === "verifying" || vData.status === "pending";
      if (vData.success || !nonFinal) break;
      if (attempt < MAX_VERIFY_ATTEMPTS) {
        await sleep(VERIFY_RETRY_DELAY_MS);
      }
    }

    if (vData.success) {
      // به‌روزرسانی کاربر در store — هم برای خرید پلن هم شارژ کیف پول
      if (vData.user) setUser(vData.user);
      setState("success");
      setReceipt({
        amount: vData.amount ?? 0,
        plan: vData.plan ?? "—",
        refId: vData.refId ?? "—",
        type: vData.type,
        walletBalance:
          typeof vData.walletBalance === "number" ? vData.walletBalance : undefined,
      });
      return;
    }

    if (vData.status === "verifying" || vData.status === "pending") {
      // حتی بعد از چند تلاش همچنان در حال پردازش/خطای موقت — شکست نیست؛ استعلام ادامه دارد
      setState("querying");
      setReceipt({
        amount: vData.amount ?? 0,
        plan: vData.plan ?? "—",
        refId: vData.refId ?? authority.slice(0, 16) ?? "—",
        message: vData.message || "در حال استعلام نتیجه پرداخت…",
      });
      return;
    }

    setState("failed");
    setReceipt({
      amount: vData.amount ?? 0,
      plan: vData.plan ?? "—",
      refId: vData.refId ?? "—",
      type: vData.type,
      message: vData.message || vData.error || "پرداخت ناموفق بود.",
    });
  }

  /** یافتن paymentId مرتبط با این authority — با تلاش مجدد کوتاه */
  async function lookupPayment(authority: string): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_LOOKUP_ATTEMPTS; attempt++) {
      try {
        const payRes = await fetch("/api/payment/lookup-pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authority }),
        });
        const payData = await payRes.json().catch(() => ({}));
        if (payData.paymentId) return payData.paymentId as string;
      } catch {
        // خطای شبکه — تلاش بعدی
      }
      if (attempt < MAX_LOOKUP_ATTEMPTS) await sleep(1500);
    }
    return null;
  }

  /** کل جریان بازگشت از درگاه — قابل اجرای مجدد با دکمه «بررسی مجدد» */
  async function processGatewayReturn() {
    const info = gatewayReturn;
    if (!info) return;
    setState("verifying");
    setReceipt(null);

    // ابتدا کاربر فعلی را دریافت کن — اگر لاگین نیست، به صفحه ورود هدایت کن
    try {
      const meRes = await fetch("/api/auth/me");
      const meData = await meRes.json();
      if (!meData.user) {
        setState("login");
        setReceipt({
          amount: 0,
          plan: "—",
          refId: info.authority.slice(0, 16) || "—",
          message:
            "پرداخت شما ثبت شد. برای تأیید نهایی و فعال‌سازی، وارد حساب کاربری خود شوید — بعد از ورود، تأیید به‌صورت خودکار انجام می‌شود.",
        });
        return;
      }
    } catch {
      setState("querying");
      setReceipt({
        amount: 0,
        plan: "—",
        refId: info.authority.slice(0, 16) || "—",
        message: "خطا در ارتباط با سرور. اتصال خود را بررسی و دوباره تلاش کنید.",
      });
      return;
    }

    // پیدا کردن پرداخت مرتبط با این authority
    let paymentId = await lookupPayment(info.authority);

    if (!paymentId) {
      if (info.status === "NOK") {
        // درگاه خودش گفته پرداخت انجام نشده — انصراف/خطای بانک
        setState("failed");
        setReceipt({
          amount: 0,
          plan: "—",
          refId: info.authority.slice(0, 16) || "—",
          message:
            "پرداخت در درگاه تکمیل نشد. اگر مبلغی از حساب شما کسر شده باشد، بانک به‌صورت خودکار آن را برمی‌گرداند.",
        });
        return;
      }
      // Status=OK ولی رکوردی پیدا نشد — نجات: recover همهٔ معلق‌های کاربر را
      // استعلام می‌کند (مثلاً فراخوان دیگری همین الان آن را verify کرده و
      // تعیین‌تکلیف شده — lookup بعدی پیدایش می‌کند)
      try {
        await fetch("/api/payment/recover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch {}
      paymentId = await lookupPayment(info.authority);
    }

    if (!paymentId) {
      if (info.status === "NOK") {
        setState("failed");
        setReceipt({
          amount: 0,
          plan: "—",
          refId: info.authority.slice(0, 16) || "—",
          message: "پرداخت در درگاه تکمیل نشد.",
        });
        return;
      }
      // OK + رکوردی نیست — قطعاً «ناموفق» نشان نمی‌دهیم؛ در حال استعلام
      setState("querying");
      setReceipt({
        amount: 0,
        plan: "—",
        refId: info.authority.slice(0, 16) || "—",
        message:
          "در حال استعلام نتیجه پرداخت از درگاه هستیم. اگر مبلغ از حساب شما کسر شده باشد، نگران نباشید — به‌صورت خودکار تعیین تکلیف و به حساب شما منتقل می‌شود. لطفاً صفحه را نبندید.",
      });
      return;
    }

    // ارسال به verify — با تلاش مجدد خودکار برای وضعیت verifying/pending
    await runVerify(paymentId, info.authority, info.status);
  }

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const isVerify = params.get("payment_verify") === "1";
      if (!isVerify) return;

      const authority = params.get("Authority") || params.get("authority") || "";
      const status = (params.get("Status") || params.get("status") || "OK").toUpperCase();

      // ─── FIX (race مرگبار UI رسید) ───
      // پارامترهای URL فقط هنگام خروج (finish/backHome) پاک می‌شوند — refresh
      // بین راه هم بی‌ضرر است چون verify خودش idempotent است.

      setGatewayReturn({ authority, status: status === "OK" ? "OK" : "NOK" });
    })();
  }, []);

  // اجرای جریان بعد از ثبت gatewayReturn (و برای تلاش مجدد دستی)
  useEffect(() => {
    if (gatewayReturn) void processGatewayReturn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayReturn]);

  /** پاک‌سازی پارامترهای callback زرین‌پال از URL (بدون reload) */
  function cleanCallbackParams() {
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
  }

  function finish() {
    setMainTab("dashboard");
    setScreen("main");
    // URL را به ?screen=panel تغییر بده تا رفرش پنل را نگه دارد
    try {
      window.history.replaceState({}, "", "/?screen=panel");
    } catch {}
    // FE-C1: فلگ paymentVerify در HomeClient ریست شود تا کاربر گیر نکند
    onDone?.();
  }

  function backHome() {
    setScreen("landing");
    cleanCallbackParams();
    // FE-C1
    onDone?.();
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

        {state === "querying" && (
          <>
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-orange-500/20"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Loader2 className="w-10 h-10 text-white animate-spin" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2">در حال استعلام نتیجه پرداخت…</h2>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              {receipt?.message ||
                "پرداخت شما در حال بررسی است و ممکن است چند لحظه طول بکشد. اگر مبلغ از حساب شما کسر شده باشد، نتیجه به‌زودی همین‌جا نمایش داده می‌شود. لطفاً صفحه را نبندید."}
            </p>
            <div className="text-right p-4 rounded-2xl bg-amber-50 border border-amber-200 mb-5 text-xs text-amber-800 leading-relaxed">
              <span className="inline-flex items-center gap-1.5 font-bold">
                <LifeBuoy className="w-3.5 h-3.5" />
                پول شما امن است
              </span>
              <p className="mt-1">
                تراکنش‌های پرداخت‌شدهٔ تأییدنشده به‌صورت خودکار بررسی و تعیین تکلیف می‌شوند؛
                اگر بعد از چند دقیقه کیف پول یا پلن شما فعال نشد، از بخش «پشتیبانی» داخل
                پنل با کد پیگیری زیر پیگیری کنید.
              </p>
              {receipt?.refId && receipt.refId !== "—" && (
                <p className="mt-1" dir="ltr">
                  <span className="font-mono">{receipt.refId}</span>
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => void processGatewayReturn()}
                variant="outline"
                className="flex-1 rounded-xl h-11"
              >
                بررسی مجدد
              </Button>
              <Button
                onClick={finish}
                className="flex-1 rounded-xl h-11 font-bold text-white"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <Home className="w-4 h-4" /> رفتن به پنل کاربری
              </Button>
            </div>
          </>
        )}

        {state === "login" && receipt && (
          <>
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-orange-500/20"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Loader2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2">ورود برای تکمیل تأیید پرداخت</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              {receipt.message ||
                "برای تأیید پرداخت باید وارد حساب کاربری خود شوید. بعد از ورود، پرداخت شما به‌صورت خودکار تأیید می‌شود."}
            </p>
            <Button
              onClick={() => {
                // رفتن به صفحه ورود — فلگ paymentVerify باید ریست شود تا
                // رندر این کارت جای auth screen را نگیرد؛ بعد از لاگین،
                // doAuthCheck خودش recoverPendingPayments را صدا می‌زند.
                setScreen("auth");
                onDone?.();
              }}
              className="w-full rounded-xl h-12 font-bold text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              ورود / دریافت کد تأیید
            </Button>
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
            {receipt.type === "wallet_topup" ? (
              <>
                {/* شارژ کیف پول — قرارداد جدید type:"wallet_topup" */}
                <h2 className="text-2xl font-black text-emerald-600 mb-2">کیف پول شما با موفقیت شارژ شد ✅</h2>
                <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                  موجودی کیف پول شما افزایش یافت. می‌توانید از آن برای خرید یا تمدید پلن‌ها استفاده کنید.
                </p>
                <div className="text-right p-4 rounded-2xl bg-slate-50 space-y-2 text-sm text-slate-900 mb-5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">مبلغ شارژ</span>
                    <span className="font-bold font-stat">{toPersianDigits(formatToman(receipt.amount))} تومان</span>
                  </div>
                  {typeof receipt.walletBalance === "number" && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">موجودی جدید</span>
                      <span className="font-bold font-stat text-emerald-600">{toPersianDigits(formatToman(receipt.walletBalance))} تومان</span>
                    </div>
                  )}
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
                  <Home className="w-4 h-4" /> رفتن به پنل کاربری
                </Button>
              </>
            ) : (
              <>
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
            <h2 className="text-2xl font-black text-slate-900 mb-2">پرداخت تکمیل نشد</h2>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              {receipt.message ||
                "متأسفانه پرداخت شما تکمیل نشد. اگر مبلغی از حساب شما کسر شده باشد، بانک به‌صورت خودکار (معمولاً حداکثر ۷۲ ساعت) آن را بازمی‌گرداند."}
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
                {/* FE-M6: این دکمه retry نمی‌کند — فقط به پنل می‌رود؛ برچسب صادقانه */}
                رفتن به پنل کاربری
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
