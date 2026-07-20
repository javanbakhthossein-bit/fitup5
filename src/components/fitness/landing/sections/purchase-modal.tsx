"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Tag,
  Wallet,
  CreditCard,
  Check,
  Loader2,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Info,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/fitness/store";
import {
  toPersianDigits,
  formatToman,
  type SubscriptionPlan,
} from "@/lib/fitness/types";
import { toast } from "sonner";

type Step = "form" | "gateway" | "processing" | "receipt";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

export function PurchaseModal({
  plan,
  onClose,
  onNeedLogin,
  prefillDiscountCode,
  prefillUserDiscountCode,
}: {
  plan: SubscriptionPlan;
  onClose: () => void;
  onNeedLogin: () => void;
  /** Public discount code to prefill (e.g. FITAP20) */
  prefillDiscountCode?: string;
  /** Per-user renewal discount code to prefill (auto-applied) */
  prefillUserDiscountCode?: string;
}) {
  const { user, setUser, setOverlay, setScreen, setMainTab } = useAppStore();
  const [step, setStep] = useState<Step>("form");
  const [discountCode, setDiscountCode] = useState(prefillDiscountCode ?? "");
  const [userDiscountCode, setUserDiscountCode] = useState<string>(prefillUserDiscountCode ?? "");
  const [discountInfo, setDiscountInfo] = useState<{
    valid: boolean;
    discountValue: number;
    finalAmount: number;
    label: string;
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"gateway" | "wallet">("gateway");
  const [paymentData, setPaymentData] = useState<{
    paymentId: string;
    authority: string;
    gatewayUrl: string | null;
    simulated: boolean;
    finalAmount: number;
  } | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const isLoggedIn = !!user;
  const walletBalance = user?.walletBalance ?? 0;
  const originalAmount = plan.price;

  // === upgrade estimate ===
  const [upgradeEstimate, setUpgradeEstimate] = useState<{
    isUpgrade: boolean;
    upgradeCredit: number;
    daysLeft: number;
    currentPlan: string | null;
    finalAmount: number;
    originalAmount: number;
  } | null>(null);

  // وقتی مودال باز می‌شود و کاربر لاگین است، برآورد ارتقا را بگیر
  useEffect(() => {
    if (!isLoggedIn) {
      setUpgradeEstimate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/payment/upgrade-estimate?planId=${plan.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.isUpgrade) {
          setUpgradeEstimate(data);
        } else if (!cancelled) {
          setUpgradeEstimate(null);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, plan.id]);

  // If a per-user discount code is prefilled, auto-apply it on mount
  useEffect(() => {
    if (prefillUserDiscountCode) {
      // Auto-apply via the same flow as clicking "اعمال"
      validateUserDiscount(prefillUserDiscountCode);
    } else if (prefillDiscountCode) {
      validateDiscount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // اگر تخفیف اعمال شده، finalAmount از discountInfo می‌آید.
  // در غیر این صورت، اگر ارتقا است، finalAmount از upgradeEstimate می‌آید.
  // در غیر این صورت، قیمت اصلی.
  const finalAmount = discountInfo?.valid
    ? discountInfo.finalAmount
    : upgradeEstimate?.isUpgrade
      ? upgradeEstimate.finalAmount
      : originalAmount;
  const canUseWallet = walletBalance >= finalAmount;

  async function validateUserDiscount(code: string) {
    if (!code.trim()) {
      toast.error("کد تخفیف اختصاصی موجود نیست");
      return;
    }
    if (!isLoggedIn) {
      toast.info("برای استفاده از کد تخفیف ابتدا وارد شوید");
      onNeedLogin();
      return;
    }
    setValidating(true);
    try {
      // Fetch the user's actual renewal discount info to display the correct
      // percentage (FITAP15 = 15% by default).
      let percent = 15;
      try {
        const infoRes = await fetch("/api/user-discount-code");
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info?.value && info?.value > 0) percent = info.value;
        }
      } catch {
        /* keep default 15% */
      }
      const estDiscount = Math.round((originalAmount * percent) / 100);
      const estFinal = Math.max(0, originalAmount - estDiscount);
      setDiscountCode(code);
      setUserDiscountCode(code);
      setDiscountInfo({
        valid: true,
        discountValue: estDiscount,
        finalAmount: estFinal,
        label: `کد اختصاصی ${code} (${toPersianDigits(percent)}٪ تخفیف تمدید)`,
      });
      toast.success(`کد اختصاصی اعمال شد! ${toPersianDigits(percent)}٪ تخفیف تمدید`);
    } finally {
      setValidating(false);
    }
  }

  async function validateDiscount() {
    if (!discountCode.trim()) {
      toast.error("کد تخفیف را وارد کنید");
      return;
    }
    if (!isLoggedIn) {
      toast.info("برای استفاده از کد تخفیف ابتدا وارد شوید");
      onNeedLogin();
      return;
    }
    setValidating(true);
    try {
      const res = await fetch("/api/payment/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: discountCode, planId: plan.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setDiscountInfo(null);
        toast.error(data.error || "کد تخفیف نامعتبر است");
        return;
      }
      setUserDiscountCode("");
      setDiscountInfo({
        valid: true,
        discountValue: data.discountValue,
        finalAmount: data.finalAmount,
        label: data.discountLabel,
      });
      toast.success(`کد اعمال شد! ${data.discountLabel}`);
    } catch {
      toast.error("خطا در بررسی کد تخفیف");
    } finally {
      setValidating(false);
    }
  }

  async function startCheckout() {
    if (!isLoggedIn) {
      toast.info("برای خرید ابتدا وارد شوید");
      onNeedLogin();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          paymentMethod,
          discountCode: discountInfo?.valid && !userDiscountCode ? discountCode : undefined,
          userDiscountCode: discountInfo?.valid && userDiscountCode ? userDiscountCode : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "INSUFFICIENT_WALLET") {
          toast.error(data.error);
          setPaymentMethod("gateway");
          return;
        }
        throw new Error(data.error);
      }
      setPaymentData({
        paymentId: data.paymentId,
        authority: data.authority,
        gatewayUrl: data.gatewayUrl,
        simulated: data.simulated === true,
        finalAmount: data.finalAmount,
      });
      if (paymentMethod === "wallet") {
        await completePayment("OK");
      } else {
        setStep("gateway");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ایجاد پرداخت");
    } finally {
      setLoading(false);
    }
  }

  /**
   * باز کردن درگاه پرداخت زرین‌پال.
   *
   * - حالت واقعی (real Zarinpal): در همان تب فعلی به gatewayUrl هدایت می‌شود.
   *   زرین‌پال پس از پرداخت به callback_url (?payment_verify=1) redirect می‌کند
   *   و PaymentVerifyHandler به‌صورت خودکار verify را صدا می‌زند. این کار از
   *   ایجاد تب اضافی و گیج‌شدن کاربر جلوگیری می‌کند.
   * - حالت شبیه‌سازی: در یک تب جدید باز می‌شود تا کاربر بتواند بدون ترک صفحه،
   *   دکمه‌های موفق/ناموفق را امتحان کند.
   */
  function openZarinpalGateway() {
    if (!paymentData?.gatewayUrl) {
      toast.error("لینک درگاه پرداخت در دسترس نیست");
      return;
    }
    // واقعی: هدایت در همان تب — زرین‌پال به ?payment_verify=1 برمی‌گرداند
    toast.info("در حال انتقال به درگاه زرین‌پال... پس از پرداخت، به‌صورت خودکار بازمی‌گردید.");
    window.location.href = paymentData.gatewayUrl;
  }

  async function completePayment(status: "OK" | "NOK" | "CANCELLED") {
    if (!paymentData) return;
    setStep("processing");
    try {
      const res = await fetch("/api/payment/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: paymentData.paymentId,
          status,
          authority: paymentData.authority,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReceipt(data);
      if (data.success && data.user) {
        setUser(data.user);
        toast.success("پلن شما فعال شد! در حال ساخت برنامه... 🎉");
      }
      setStep("receipt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در تایید پرداخت");
      setStep("form");
    }
  }

  function reset() {
    setStep("form");
    setDiscountCode("");
    setDiscountInfo(null);
    setPaymentData(null);
    setReceipt(null);
  }

  function handleClose() {
    if (step === "processing") return;
    reset();
    onClose();
  }

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent dir="rtl" showCloseButton={false} className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-slate-900">
            <span className="flex items-center gap-2">
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                <Crown className="w-4 h-4 text-white" />
              </span>
              خرید پلن {plan.label}
            </span>
            <button
              onClick={handleClose}
              disabled={step === "processing"}
              className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-40"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "form" && (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              {/* خلاصه پلن */}
              <div className="p-3 rounded-2xl text-white" style={{ background: "linear-gradient(135deg, #fb923c, #f97316)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sm">{plan.label}</p>
                    <p className="text-[11px] opacity-90">{toPersianDigits(plan.durationDays)} روزه — {toPersianDigits(plan.phases)} فاز</p>
                  </div>
                  <p className="text-lg font-black font-stat">{toPersianDigits(formatToman(originalAmount))} <span className="text-xs font-normal">ت</span></p>
                </div>
              </div>

              {/* کد تخفیف */}
              <div>
                <Label className="mb-2 block text-sm text-slate-700">کد تخفیف (اختیاری)</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      value={discountCode}
                      onChange={(e) => { setDiscountCode(e.target.value.toUpperCase()); setDiscountInfo(null); }}
                      placeholder="کد تخفیف خود را وارد کنید"
                      className="pr-9 rounded-xl uppercase text-slate-900"
                      dir="ltr"
                    />
                  </div>
                  <Button onClick={validateDiscount} disabled={validating || !discountCode.trim() || !isLoggedIn} variant="outline" className="rounded-xl">
                    {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : "اعمال"}
                  </Button>
                </div>
                {discountInfo?.valid && (
                  <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2 text-xs text-emerald-600">
                    <CheckCircle2 className="w-4 h-4" />
                    {discountInfo.label} — {toPersianDigits(formatToman(discountInfo.discountValue))} تومان تخفیف
                  </motion.div>
                )}

              </div>

              {/* روش پرداخت */}
              <div>
                <Label className="mb-2 block text-sm text-slate-700">روش پرداخت</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPaymentMethod("gateway")}
                    className={`p-3 rounded-2xl border-2 transition text-right ${paymentMethod === "gateway" ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}
                  >
                    <CreditCard className={`w-5 h-5 mb-1.5 ${paymentMethod === "gateway" ? "text-orange-500" : "text-slate-400"}`} />
                    <p className="text-xs font-bold text-slate-900">پرداخت آنلاین</p>
                    <p className="text-[10px] text-slate-500">درگاه زرین‌پال</p>
                  </button>
                  <button
                    onClick={() => setPaymentMethod("wallet")}
                    disabled={!isLoggedIn || !canUseWallet}
                    className={`p-3 rounded-2xl border-2 transition text-right disabled:opacity-50 ${paymentMethod === "wallet" ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}
                  >
                    <Wallet className={`w-5 h-5 mb-1.5 ${paymentMethod === "wallet" ? "text-orange-500" : "text-slate-400"}`} />
                    <p className="text-xs font-bold text-slate-900">کیف پول فیتاپ</p>
                    <p className="text-[10px] text-slate-500">{isLoggedIn ? `${toPersianDigits(formatToman(walletBalance))} ت` : "نیاز به ورود"}</p>
                  </button>
                </div>
                {paymentMethod === "wallet" && isLoggedIn && !canUseWallet && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    موجودی کافی نیست.{" "}
                    <button
                      onClick={() => {
                        setOverlay("profile");
                        onClose();
                      }}
                      className="font-bold underline"
                    >
                      افزایش موجودی
                    </button>
                  </div>
                )}
              </div>

              {/* محاسبه نهایی */}
              <div className="p-3 rounded-2xl bg-slate-50 space-y-1.5 text-sm text-slate-900">
                <div className="flex justify-between">
                  <span className="text-slate-500">قیمت اصلی</span>
                  <span className="font-stat">{toPersianDigits(formatToman(originalAmount))} تومان</span>
                </div>
                {discountInfo?.valid && (
                  <div className="flex justify-between text-emerald-600">
                    <span>تخفیف</span>
                    <span>- {toPersianDigits(formatToman(discountInfo.discountValue))} تومان</span>
                  </div>
                )}
                {upgradeEstimate?.isUpgrade && !discountInfo?.valid && (
                  <div className="flex justify-between text-emerald-600">
                    <span className="flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5" />
                      اعتبار ارتقا ({toPersianDigits(upgradeEstimate.daysLeft)} روز باقی‌مانده)
                    </span>
                    <span>- {toPersianDigits(formatToman(upgradeEstimate.upgradeCredit))} تومان</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1.5 border-t border-slate-200">
                  <span>مبلغ قابل پرداخت</span>
                  <span className="text-orange-600 font-stat">{toPersianDigits(formatToman(finalAmount))} تومان</span>
                </div>
                {upgradeEstimate?.isUpgrade && !discountInfo?.valid && (
                  <p className="text-[11px] text-orange-600 font-medium pt-1">
                    ✓ با ارتقا به این پلن، ۴۵ روز کامل اشتراک جدید فعال می‌شود.
                  </p>
                )}
              </div>

              <Button
                onClick={startCheckout}
                disabled={loading || (paymentMethod === "wallet" && !canUseWallet)}
                className="w-full h-12 rounded-xl font-bold text-white"
                style={{ background: goldGradient }}
              >
                {loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> در حال ایجاد...</span>
                ) : !isLoggedIn ? (
                  "برای خرید وارد شوید"
                ) : (
                  <>
                    {paymentMethod === "wallet" ? <Wallet className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                    پرداخت {toPersianDigits(formatToman(finalAmount))} تومان
                  </>
                )}
              </Button>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />
                پرداخت امن — امکان استرداد وجه
              </div>
            </motion.div>
          )}

          {step === "gateway" && paymentData && (
            <motion.div key="gateway" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 text-center text-slate-900">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-lg" style={{ background: goldGradient }}>
                <CreditCard className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-black text-lg">درگاه پرداخت زرین‌پال</h3>
              <p className="text-xs text-slate-500">پرداخت امن با درگاه زرین‌پال</p>
              <div className="space-y-2 text-right p-4 rounded-2xl bg-slate-50 text-sm border border-slate-100">
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500">مبلغ قابل پرداخت</span>
                  <span className="font-bold font-stat text-orange-600">{toPersianDigits(formatToman(paymentData.finalAmount))} تومان</span>
                </div>
                <div className="border-t border-slate-200 my-1"></div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500">پلن انتخابی</span>
                  <span className="font-bold">{plan.label}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-500">مدت اشتراک</span>
                  <span className="font-bold">{toPersianDigits(plan.durationDays)} روز</span>
                </div>
              </div>

              <div className="space-y-3">
                {/* درگاه واقعی زرین‌پال — رفتن به درگاه در همان تب و انتظار برای callback */}
                <div className="flex items-start gap-2 text-right p-3 rounded-xl bg-amber-50 border border-orange-100 text-xs text-slate-700">
                  <Info className="w-4 h-4 shrink-0 text-orange-500 mt-0.5" />
                  <span>
                    با کلیک روی دکمه زیر، به درگاه پرداخت زرین‌پال منتقل می‌شوید.
                    پس از تکمیل پرداخت، به‌صورت خودکار به این سایت بازمی‌گردید و پرداخت شما
                    تأیید می‌شود — نیازی به هیچ دکمه‌ای نیست.
                  </span>
                </div>
                <Button
                  onClick={openZarinpalGateway}
                  className="w-full rounded-xl h-12 font-bold text-white"
                  style={{ background: goldGradient }}
                >
                  <ExternalLink className="w-4 h-4" /> رفتن به درگاه پرداخت
                </Button>

                {/* پیام انتظار با اسپینر — پس از کلیک روی رفتن به درگاه */}
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-2.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500" />
                  پس از پرداخت در درگاه زرین‌پال، به‌صورت خودکار به این صفحه بازمی‌گردید. صبر کنید...
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={handleClose} variant="ghost" className="rounded-xl text-slate-400">
                    انصراف
                  </Button>
                  <Button onClick={handleClose} variant="ghost" className="rounded-xl text-slate-400">
                    بازگشت به سایت
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center text-slate-900">
              <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
              <h3 className="font-bold mb-1">در حال تایید پرداخت...</h3>
              <p className="text-sm text-slate-500">لطفاً صبر کنید</p>
            </motion.div>
          )}

          {step === "receipt" && receipt && (
            <motion.div key="receipt" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 text-center">
              {receipt.success ? (
                <>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }} className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center mx-auto shadow-xl">
                    <Check className="w-12 h-12 text-white" strokeWidth={3} />
                  </motion.div>
                  <h3 className="text-xl font-black text-emerald-600">پرداخت موفق! 🎉</h3>
                  <p className="text-sm text-slate-500">پلن {plan.label} فعال شد. درخواست ساخت برنامه ثبت شد — در انتظار تولید توسط مربی هوشمند.</p>
                  <div className="text-right p-3 rounded-2xl bg-slate-50 space-y-2 text-sm text-slate-900">
                    <div className="flex justify-between"><span className="text-slate-500">مبلغ</span><span className="font-bold font-stat">{toPersianDigits(formatToman(receipt.amount))} تومان</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">پلن</span><span>{receipt.plan}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">کد پیگیری</span><span dir="ltr" className="font-mono text-xs">{receipt.refId}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">وضعیت برنامه</span><span className="text-orange-600 font-bold">در انتظار تولید</span></div>
                  </div>
                  <Button onClick={() => {
                    reset();
                    onClose();
                    // ورود به پنل با تب داشبورد
                    setMainTab("dashboard");
                    setScreen(user?.role === "ADMIN" ? "admin" : "main");
                    try { window.history.replaceState({}, "", "/?screen=panel"); } catch {}
                  }} className="w-full rounded-xl h-11 font-bold text-white" style={{ background: goldGradient }}>
                    <Sparkles className="w-4 h-4" /> شروع تمرین! 💪
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-full bg-red-500 flex items-center justify-center mx-auto shadow-xl">
                    <XCircle className="w-12 h-12 text-white" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">پرداخت ناموفق</h3>
                  <p className="text-sm text-slate-500">{receipt.message}</p>
                  <Button onClick={reset} variant="outline" className="w-full rounded-xl h-11">تلاش مجدد</Button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
