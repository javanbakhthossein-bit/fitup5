"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crown, Check, ShieldCheck, Zap, Sparkles, Loader2, AlertTriangle } from "lucide-react";

/**
 * کلاینت صفحهٔ تمدید مجزا — بدون نیاز به لاگین.
 * مبلغ نهایی تمدید (با تخفیف اختصاصی) + پیشنهادهای ارتقا + پرداخت زرین‌پال.
 */

interface RenewInfo {
  ok: boolean;
  alreadyRenewed?: boolean;
  userFirstName?: string;
  planLabel?: string;
  planLabelOrId?: string;
  subscriptionEnd?: string | null;
  planId?: string;
  planPrice?: number;
  planDurationDays?: number;
  planPhases?: number;
  daysLeft?: number | null;
  isExpired?: boolean;
  renewFinalAmount?: number;
  discount?: { code: string | null; percent: number | null; finalRenewAmount: number };
  upgrades?: Array<{
    id: string;
    label: string;
    tagline: string;
    price: number;
    finalAmount: number;
    durationDays: number;
    phases: number;
    badge: string | null;
    popular: boolean;
    tier: number;
  }>;
}

type Phase = "loading" | "ready" | "already" | "verifying" | "success" | "failed" | "error";

function toFa(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
function toToman(n: number): string {
  return toFa(n.toLocaleString("en-US"));
}

const ORANGE_GRADIENT = "linear-gradient(135deg,#f59e0b,#f97316)";

export default function RenewClient({
  token,
  autoVerify,
}: {
  token: string;
  autoVerify: { authority: string; status: string } | null;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<RenewInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [payingPlanId, setPayingPlanId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoVerifyDone = useRef(false);

  // ─── واکشی اطلاعات تمدید ───
  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/renew/info?t=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data?.error || "لینک تمدید نامعتبر است.");
        setPhase("error");
        return;
      }
      setInfo(data);
      if (data.alreadyRenewed) {
        setSuccessMsg("پلن شما فعال است و نیازی به تمدید ندارد ✅");
        setPhase("already");
      } else {
        setPhase("ready");
      }
    } catch {
      setErrorMsg("خطا در برقراری ارتباط. اتصال اینترنت را بررسی کنید.");
      setPhase("error");
    }
  }, [token]);

  // ─── بازگشت از درگاه زرین‌پال (?payment_verify=1) ───
  const runAutoVerify = useCallback(
    async (authority: string, status: string) => {
      setPhase("verifying");
      try {
        const res = await fetch("/api/renew/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ t: token, authority, status }),
        });
        const data = await res.json();
        if (data?.success) {
          setSuccessMsg(
            data.alreadyVerified
              ? "پرداخت شما قبلاً تأیید شده و پلن فعال است ✅"
              : "پرداخت موفق بود و پلن شما به‌صورت خودکار فعال شد 🎉"
          );
          setPhase("success");
          return;
        }
        if (data?.status === "pending") {
          setSuccessMsg(
            data.message ||
              "پرداخت شما در حال بررسی است؛ اگر مبلغ کسر شده باشد، پلن به‌زودی فعال می‌شود."
          );
          setPhase("already");
          return;
        }
        setErrorMsg(data?.message || data?.error || "پرداخت ناموفق بود.");
        setPhase("failed");
      } catch {
        setErrorMsg("خطا در تأیید پرداخت. اگر مبلغ کسر شده، به‌زودی پلن فعال می‌شود.");
        setPhase("failed");
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token) {
      setErrorMsg("لینک تمدید معتبر نیست.");
      setPhase("error");
      return;
    }
    if (autoVerify && !autoVerifyDone.current) {
      autoVerifyDone.current = true;
      runAutoVerify(autoVerify.authority, autoVerify.status);
      return;
    }
    loadInfo();
  }, [token, autoVerify, runAutoVerify, loadInfo]);

  // ─── شروع پرداخت (تمدید یا ارتقا) ───
  async function startPayment(planId?: string) {
    setPayingPlanId(planId ?? "__renew__");
    try {
      const res = await fetch("/api/renew/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, planId }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.gatewayUrl) {
        // 🩹 v45 (باگ دکمهٔ مرده): قبلاً payingPlanId فقط در catch آزاد می‌شد —
        // اگر ناوبری به درگاه انجام نمی‌شد، هر دکمه‌های پرداخت برای همیشه
        // disabled می‌ماندند. حالا timeout ۱۲ثانیه‌ای + بازگشت به صفحه
        // (pageshow/visibilitychange) قفل را آزاد می‌کند.
        window.setTimeout(() => setPayingPlanId(null), 12_000);
        window.location.href = data.gatewayUrl;
        return;
      }
      throw new Error(data?.error || "خطا در ساخت پرداخت");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "خطا در شروع پرداخت");
      setPayingPlanId(null);
    }
  }

  // 🩹 v45: هر بازگشت به این صفحه (Back از درگاه) یا برگشت به تب → آزادسازی قفل پرداخت
  useEffect(() => {
    const unlock = () => setPayingPlanId(null);
    const onPageShow = () => unlock();
    const onVisible = () => {
      if (document.visibilityState === "visible") unlock();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  function toastError(msg: string) {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(""), 5000);
  }

  // ═══════════════ رندر ═══════════════
  return (
    <div dir="rtl" className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 pb-10 pt-6">
        {/* هدر برند */}
        <header className="mb-6 text-center">
          <div
            className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-black text-white shadow-lg"
            style={{ background: ORANGE_GRADIENT }}
          >
            ف
          </div>
          <h1 className="text-lg font-black">فیتاپ</h1>
          <p className="mt-0.5 text-xs text-slate-500">هر بدنی فیتاپ می‌خواد!</p>
        </header>

        {/* حالت لودینگ */}
        {phase === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            <p className="text-sm text-slate-500">در حال بارگذاری اطلاعات تمدید…</p>
          </div>
        )}

        {/* خطا */}
        {phase === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <p className="max-w-xs text-sm font-bold text-slate-700">{errorMsg}</p>
            <a
              href="/"
              className="rounded-2xl px-6 py-3 text-sm font-bold text-white"
              style={{ background: ORANGE_GRADIENT }}
            >
              رفتن به فیتاپ
            </a>
          </div>
        )}

        {/* در حال تأیید بازگشت درگاه */}
        {phase === "verifying" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            <p className="text-sm font-bold text-slate-700">در حال تأیید پرداخت…</p>
            <p className="max-w-xs text-center text-xs text-slate-500">
              صفحه را نبندید؛ تأیید معمولاً چند ثانیه طول می‌کشد.
            </p>
          </div>
        )}

        {/* موفق / از قبل تمدیدشده / pending */}
        {(phase === "success" || phase === "already") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-50">
              <ShieldCheck className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="text-xl font-black">تمام شد! 🎉</h2>
            <p className="max-w-xs text-sm leading-6 text-slate-600">{successMsg}</p>
            <div className="mt-2 w-full rounded-2xl border border-orange-100 bg-orange-50/60 p-4 text-xs leading-6 text-slate-600">
              مرحلهٔ بعد: وارد پنل شو و <b>پیش‌نیازهای طراحی برنامه</b> (عکس بدن و…) را
              تکمیل کن تا برنامهٔ جدیدت ساخته شود.
            </div>
            <a
              href="/?screen=panel"
              className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold text-white shadow-lg"
              style={{ background: ORANGE_GRADIENT }}
            >
              <Crown className="h-5 w-5" />
              ورود به پنل فیتاپ
            </a>
          </div>
        )}

        {/* شکست پرداخت */}
        {phase === "failed" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <p className="max-w-xs text-sm font-bold text-slate-700">{errorMsg}</p>
            <button
              onClick={() => {
                setPhase("loading");
                loadInfo();
              }}
              className="rounded-2xl px-6 py-3 text-sm font-bold text-white"
              style={{ background: ORANGE_GRADIENT }}
            >
              تلاش مجدد
            </button>
          </div>
        )}

        {/* آماده: کارت تمدید + ارتقا */}
        {phase === "ready" && info && (
          <main className="flex flex-col gap-5">
            {/* سلام + وضعیت */}
            <section className="rounded-3xl border border-slate-100 bg-gradient-to-b from-orange-50/70 to-white p-5 text-center shadow-sm">
              <p className="text-sm text-slate-600">
                {info.userFirstName} عزیز، خوش برگشتی 👋
              </p>
              {info.isExpired ? (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  پلن {info.planLabel} شما تمام شده
                </div>
              ) : info.daysLeft == null ? (
                /* 🩹 v45: وقتی تاریخ پایان مشخص نیست (پلن بدون endDate) هیچ عدد روزی نشان نده — قبلاً clamp «۱ روز» چاپ می‌کرد */
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">
                  <Zap className="h-3.5 w-3.5" />
                  پلن {info.planLabel} شما فعال است
                </div>
              ) : info.daysLeft === 0 ? (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">
                  <Zap className="h-3.5 w-3.5" />
                  امروز آخرین روز پلن {info.planLabel} شماست
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">
                  <Zap className="h-3.5 w-3.5" />
                  {toFa(info.daysLeft)} روز تا پایان پلن {info.planLabel}
                </div>
              )}
              {!info.isExpired && (
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  با تمدیدِ از الان، روزهای باقی‌ماندهٔ فعلی‌ت هم آخر پلن جدید حفظ می‌شود.
                </p>
              )}
            </section>

            {/* کارت تمدید پلن فعلی */}
            <section
              className="relative rounded-[1.75rem] shadow-lg transition-all hover:-translate-y-1"
              style={{
                border: "3px solid transparent",
                background:
                  "linear-gradient(white,white) padding-box, linear-gradient(135deg,#fbbf24,#f59e0b,#f97316) border-box",
              }}
            >
              <div className="rounded-[1.65rem] bg-white p-6">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-lg font-black">تمدید پلن {info.planLabel}</h2>
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-600">
                    {toFa(info.planDurationDays ?? 45)} روزه
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  پرداخت آماده است — با یک کلیک، پلن جدیدت خودکار فعال می‌شود.
                </p>

                <div className="my-4 border-y border-slate-100 py-4 text-center">
                  {info.discount?.percent ? (
                    <p className="mb-1 text-xs text-slate-400">
                      <span className="line-through">{toToman(info.planPrice ?? 0)}</span> تومان
                    </p>
                  ) : null}
                  <div className="flex items-baseline justify-center gap-1">
                    <span
                      className="text-4xl font-black"
                      style={{
                        background: ORANGE_GRADIENT,
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                      }}
                    >
                      {toToman(info.renewFinalAmount ?? info.discount?.finalRenewAmount ?? 0)}
                    </span>
                    <span className="text-sm font-bold text-slate-500">تومان</span>
                  </div>
                  {info.discount?.code ? (
                    <button
                      onClick={() => {
                        const code = info.discount?.code ?? "";
                        if (code && navigator?.clipboard) {
                          navigator.clipboard.writeText(code).catch(() => {});
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                      className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white"
                      title="کلیک = کپی"
                    >
                      <Sparkles className="h-3 w-3 text-amber-400" />
                      {copied
                        ? "کپی شد ✅"
                        : `کد تخفیف اختصاصی: ${info.discount.code}${
                            info.discount.percent ? ` (${toFa(info.discount.percent)}٪)` : ""
                          }`}
                    </button>
                  ) : null}
                </div>

                <ul className="mb-5 space-y-2 text-xs text-slate-600">
                  {[
                    "فعال‌سازی خودکار پلن — بدون معطلی",
                    "حفظ روزهای باقی‌مانده پلن فعلی",
                    "دسترسی کامل به برنامه تمرین و غذای جدید",
                  ].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full"
                        style={{ background: ORANGE_GRADIENT }}
                      >
                        <Check className="h-3 w-3 text-white" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>

                {/* v49 (درخواست مالک): هشدار VPN — درگاه زرین‌پال با IP خارجی باز نمی‌شود */}
                <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-center text-[11px] font-bold leading-5 text-red-700">
                  قبل از پرداخت، لطفاً فیلترشکن (VPN) خود را خاموش کنید — درگاه زرین‌پال با IP خارجی باز نمی‌شود.
                </p>
                <button
                  onClick={() => startPayment()}
                  disabled={payingPlanId !== null}
                  className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold text-white shadow-lg transition-opacity disabled:opacity-60"
                  style={{ background: ORANGE_GRADIENT }}
                >
                  {payingPlanId === "__renew__" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Crown className="h-5 w-5" />
                  )}
                  پرداخت و تمدید خودکار
                </button>
              </div>
            </section>

            {/* پیشنهاد ارتقا */}
            {info.upgrades && info.upgrades.length > 0 && (
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-base font-black">
                  <Zap className="h-4 w-4 text-orange-500" />
                  یا قدمی جلوتر بذار — ارتقا بده
                </h3>
                {/* v49: هشدار VPN — بخش ارتقا هم به درگاه زرین‌پال می‌رود */}
                <p className="mb-3 text-[11px] font-bold text-red-600">
                  برای پرداخت، فیلترشکن (VPN) خود را خاموش کنید.
                </p>
                <div className="flex flex-col gap-3">
                  {info.upgrades.map((u) => (
                    <div
                      key={u.id}
                      className={`relative flex items-center justify-between gap-3 rounded-2xl border p-4 ${
                        u.popular ? "border-orange-300 bg-orange-50/50" : "border-slate-200 bg-white"
                      }`}
                    >
                      {u.popular ? (
                        <span
                          className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow"
                          style={{ background: ORANGE_GRADIENT }}
                        >
                          پیشنهاد ویژه
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black">{u.label}</p>
                        <p className="truncate text-[11px] text-slate-500">{u.tagline}</p>
                        <p className="mt-1 text-xs text-slate-600">
                          {toToman(u.finalAmount)} تومان
                          {u.finalAmount < u.price ? (
                            <span className="mr-1.5 text-slate-400 line-through">
                              {toToman(u.price)}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <button
                        onClick={() => startPayment(u.id)}
                        disabled={payingPlanId !== null}
                        className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white shadow disabled:opacity-60"
                        style={{ background: ORANGE_GRADIENT }}
                      >
                        {payingPlanId === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Crown className="h-4 w-4" />
                        )}
                        ارتقا
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className="mt-2 text-center text-[11px] leading-5 text-slate-400">
              بعد از هر خرید پلن جدید، پیش‌نیازهای طراحی برنامه (عکس بدن و اطلاعات) از شما
              خواسته می‌شود تا برنامه دقیقاً متناسب با بدن ساخته شود.
            </p>
          </main>
        )}

        {/* پیام خطای گذرا */}
        {errorMsg && (phase === "ready" || phase === "already") && (
          <div className="fixed bottom-4 left-1/2 z-50 w-[90%] max-w-sm -translate-x-1/2 rounded-2xl bg-red-600 px-4 py-3 text-center text-xs font-bold text-white shadow-xl">
            {errorMsg}
          </div>
        )}

        <footer className="mt-auto pt-8 text-center text-[11px] text-slate-400">
          فیتاپ — هر بدنی فیتاپ می‌خواد!
        </footer>
      </div>
    </div>
  );
}
