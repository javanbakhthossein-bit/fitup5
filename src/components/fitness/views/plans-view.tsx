"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Crown, Check, Wallet, ShieldCheck, RefreshCw, Clock, Loader2, Gift, PartyPopper } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import {
  toPersianDigits,
  formatToman,
  PLAN_LABELS,
  type SubscriptionPlan,
} from "@/lib/fitness/types";
import { usePlans } from "@/lib/fitness/use-plans";
import { PurchaseModal } from "@/components/fitness/landing/sections/purchase-modal";
import { SharedPlanCard, ComparisonTable } from "@/components/fitness/plan-card-shared";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface RenewalDiscountInfo {
  code: string | null;
  value: number;
  type: string;
  reason?: string | null;
  validUntil: string | null;
  isUsed: boolean;
  expiresSoon: boolean;
  isExpired: boolean;
  expiredDaysAgo: number | null;
  daysLeft: number;
  subEndDate: string | null;
  currentPlanId: string | null;
}

// ─── v53 — کد تخفیف «ترک درگاه پرداخت» (کد نمایشی 248945) ───
// کد نمایشی به کاربر همیشه «248945» است (ثابت سمت سرور:
// notifications.ABANDONED_CART_DISPLAY_CODE — اینجا ثابت محلی است چون
// notifications سمت سرور است و قابل ایمپورت در کلاینت نیست).
const ABANDONED_CART_OFFER_DISPLAY_CODE = "248945";

type OfferState =
  | { status: "valid"; percent: number; validUntil: string | null }
  | { status: "expired" }
  | null;

/** شمارش معکوس فارسی HH:MM:SS تا مهلت داده‌شده */
function formatCountdownFa(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 1000) % 60;
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return toPersianDigits(`${pad(h)}:${pad(m)}:${pad(s)}`);
}

// ─── v78 — «بروزرسانی برنامه (یکبار)» روی کارت پلن فعلی (درخواست مالک):
// در پلن پیشرفته به بالا فقط یکبار در طول اشتراک، همراه تولتیپ توضیح؛ کلیک →
// رفتن به چت فیتاپ برای جمع‌آوری اطلاعات و تایید نهایی. وضعیت از
// GET /api/coach/plan?meta=1 می‌آید (eligible/pending/used). ───
const PLAN_REGEN_TOOLTIP =
  "یکبار در طول اشتراک می‌توانید برنامهٔ تمرینی، تغذیه و مکمل را با کمک چت فیتاپ و بر اساس دیتای فعلی شما بازطراحی کنید — بدون تغییر در مدت اشتراک";
const PLAN_REGEN_USED_TOOLTIP =
  "سهمیهٔ بروزرسانی برنامه در این اشتراک مصرف شده است";
const PLAN_REGEN_PENDING_TOOLTIP =
  "اطلاعات بازطراحی شما در چت فیتاپ در جریان است — برای تایید نهایی به چت بروید";

type PlanRegenStateDto = { eligible: boolean; pending: boolean; used: boolean };

function PlanRegenFooter({
  pending,
  used,
  onGoChat,
}: {
  pending: boolean;
  used: boolean;
  onGoChat: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (!used) onGoChat();
          }}
          disabled={used}
          className="mt-2.5 w-full h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-orange-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {pending ? "تکمیل بروزرسانی برنامه" : "بروزرسانی برنامه (یکبار)"}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[250px] text-[11px] leading-relaxed text-center">
        {used ? PLAN_REGEN_USED_TOOLTIP : pending ? PLAN_REGEN_PENDING_TOOLTIP : PLAN_REGEN_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}

export function PlansView() {
  const { user, setMainTab, setOverlay } = useAppStore();
  const { plans: SUBSCRIPTION_PLANS } = usePlans();
  const [purchasePlan, setPurchasePlan] = useState<SubscriptionPlan | null>(null);
  const [purchaseUserDiscount, setPurchaseUserDiscount] = useState<string | null>(null);
  const [renewalInfo, setRenewalInfo] = useState<RenewalDiscountInfo | null>(null);
  // ضد دابل‌کلیک + بازخورد لمسی: صفحه تمدید (RenewalOverlay) lazy-load می‌شود؛
  // تا باز شدنش دکمه غیرفعال + اسپینر + تغییر متن می‌گیرد تا کلیک مرده حس نشود.
  const [renewing, setRenewing] = useState(false);

  // ─── v53 — تخفیف «ترک درگاه» از لینک پیامک (?offer=کد داخلی) ───
  const [offer, setOffer] = useState<OfferState>(null);
  // تیک ثانیه‌ای برای شمارش معکوس زندهٔ بنر آفر
  const [nowTick, setNowTick] = useState(() => Date.now());

  // ─── v78 — وضعیت قابلیت «بروزرسانی برنامه (یکبار)» — GET /api/coach/plan?meta=1
  // (فقط وضعیت سهمیه — بدون محتوای سنگین برنامه‌ها). PlansView با هر سوییچ تب
  // دوباره مونت می‌شود → وضعیت همیشه تازه است. ───
  const [planRegen, setPlanRegen] = useState<PlanRegenStateDto | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coach/plan?meta=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.planRegen) setPlanRegen(data.planRegen as PlanRegenStateDto);
      } catch {
        // بی‌صدا — ردیف بروزرسانی نشان داده نمی‌شود
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // پارامتر URL پس از ورود/ناوبری هم حفظ می‌شود (navigation.ts پارامترهای ناشناس را پاک نمی‌کند)
    const offerParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("offer")
        : null;
    if (!offerParam) return;
    let cancelled = false;
    (async () => {
      try {
        // کاربر لاگین است — اعتبارسنجی کد از همان مسیر کد تخفیف خرید
        // (پلن فقط برای اعتبارسنجی عمومی است؛ کدهای اختصاصی وابسته به پلن نیستند)
        const res = await fetch("/api/payment/discount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: offerParam, planId: "basic" }),
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data?.valid && Number(data?.value) > 0) {
          setOffer({
            status: "valid",
            percent: Number(data.value),
            validUntil: data.validUntil ?? null,
          });
        } else {
          setOffer({ status: "expired" });
        }
      } catch {
        if (!cancelled) setOffer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // شمارش معکوس زنده تا انقضای آفر/تخفیف شخصی — بعد از انقضا نوار حذف و
  // قیمت‌ها برمی‌گردند (v68: دیریکتیو مالک — بعد از مهلت ۲ساعته/دودوزه،
  // کارت‌ها باید بدون تخفیف شوند حتی بدون رفرش صفحه)
  const personalValidUntilMs = renewalInfo?.validUntil
    ? new Date(renewalInfo.validUntil).getTime()
    : null;
  useEffect(() => {
    if (offer?.status !== "valid" && personalValidUntilMs == null) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [offer?.status, personalValidUntilMs]);

  const offerValidUntilMs =
    offer?.status === "valid" && offer.validUntil
      ? new Date(offer.validUntil).getTime()
      : null;
  const offerActive =
    offer?.status === "valid" &&
    offer.percent > 0 &&
    (offerValidUntilMs == null || offerValidUntilMs > nowTick);
  const offerExpiredBanner = offer?.status === "expired";
  const offerCountdownText =
    offerActive && offerValidUntilMs != null
      ? formatCountdownFa(offerValidUntilMs - nowTick)
      : null;
  const offerDeadlineText =
    offer?.status === "valid" && offer.validUntil
      ? new Date(offer.validUntil).toLocaleTimeString("fa-IR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch("/api/user-discount-code", { cache: "no-store" });
        const data = await res.json();
        setRenewalInfo(data);
      } catch {
      }
    })();
  }, [user]);

  // اگر پلن pending است (advanced/ultimate بدون پیش‌نیاز)، UI متفاوت نشان بده
  const isPending = user?.hasPendingSubscription === true;
  // ─── FIX: پلن منقضی/لغو‌شده دیگر «فعال» دیده نمی‌شود ───
  // قبلاً: currentPlanId = planName || lastPlanName → کاربرِ منقضی همچنان
  // «پلن فعلی شما» + «پلن فعال — ۰ روز» می‌دید و دکمه‌های خرید پایین‌تر قفل بود!
  // حالا: فقط اشتراکِ واقعاً فعال یا pending «فعال» است؛ منقضی → حالت خرید.
  const hasActive = !!user?.planName && user?.hasActiveSubscription === true && !isPending;
  const currentPlanId = (hasActive || isPending) ? user?.planName : null;
  const expiredPlanId = !currentPlanId && !isPending ? (user?.lastPlanName ?? null) : null;
  const subEndDate = hasActive && user?.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const daysLeft = subEndDate ? Math.ceil((subEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
  // برای بنر تمدید (متن) نام آخرین پلن لازم است — حتی وقتی منقضی شده
  const bannerPlanId = user?.planName || user?.lastPlanName;

  async function renewWithDiscount() {
    if (renewing) return; // گارد دابل‌کلیک
    setRenewing(true);
    try {
      // ─── دعوت به «صفحه تمدید» (تجربه کامل: آمار دوره + کد + مزایا + CTA) ───
      // به‌جای پرش مستقیم به مودال خرید، کاربر تجربه جذاب تمدید را می‌بیند و
      // از همان‌جا با کد تخفیف از-قبل-اعمال‌شده به پرداخت می‌رود.
      // تأخیر کوتاه فقط برای دیدن بازخورد لمسی (اسپینر) قبل از باز شدن Sheet
      await new Promise((r) => setTimeout(r, 350));
      setOverlay("renewal");
    } finally {
      setRenewing(false);
    }
  }

  // بنر تمدید فقط وقتی اشتراک واقعاً منقضی شده باشد (نه فقط نزدیک انقضا ۰–۵ روز)
  const showRenewalBanner =
    !!bannerPlanId &&
    !renewalInfo?.isUsed &&
    !!renewalInfo?.code &&
    renewalInfo?.isExpired === true;

  // ─── v47 — تخفیف اختصاصی کاربر (دیریکتیو مالک) ───
  // «قیمت پلن‌ها را روی کارت‌ها با تخفیف بنویس و تا زمان خرید هم همین‌جوری
  // نمایش بده» — کد از /api/user-discount-code (بهره‌مندی همهٔ سناریوها:
  // تمدید + خوش‌آمدگویی ۸ روزه + وین‌بک آنبوردینگ) و روی همهٔ کارت‌ها اعمال می‌شود.
  // v68 — اعتبار زنده: تا لحظهٔ گذشتن validUntil (بدون رفرش). بعد از آن کارت‌ها
  // بدون تخفیف می‌شوند — دیریکتیو مالک: «پس از گذشت زمان تخفیف ۲ساعته/دودوزه
  // باید به همان کارت‌های بدون تخفیف پلن‌ها بروند».
  const personalDiscountBase =
    renewalInfo?.code && !renewalInfo?.isUsed && renewalInfo?.value > 0
      ? { percent: renewalInfo.value, code: renewalInfo.code, reason: renewalInfo.reason ?? null }
      : null;
  const personalDiscountActive =
    !!personalDiscountBase &&
    (personalValidUntilMs == null || personalValidUntilMs > nowTick);
  const personalDiscount = personalDiscountActive ? personalDiscountBase : null;
  // بنر هدیهٔ خرید اول (پیامک‌های 461291 / 612964) — برای کاربرِ بدونِ خرید
  // (وقتی آفر ترک-درگاه فعال است بنر هدیه نشان داده نمی‌شود — فقط یک بنر تخفیف)
  const showGiftBanner =
    !showRenewalBanner &&
    !offerActive &&
    !!personalDiscount &&
    (personalDiscount.reason === "welcome_offer" || personalDiscount.reason === "onboarding_winback");

  // تخفیف مؤثر روی کارت‌ها: آفر ترک-درگاه (اولویت بر personalDiscount) یا تخفیف شخصی کاربر
  const effectiveDiscount =
    offerActive && offer?.status === "valid"
      ? {
          percent: offer.percent,
          code: ABANDONED_CART_OFFER_DISPLAY_CODE,
          reason: "abandoned_cart" as const,
        }
      : personalDiscount;

  return (
    <div className="px-4 py-4 space-y-4 max-w-6xl mx-auto lg:px-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900">مدیریت اشتراک</h2>
        <p className="text-sm text-slate-500">هر بدنی فیتاپ میخواد — پلنت رو انتخاب کن</p>
      </div>

      {/* Renewal banner — only when the plan has ACTUALLY expired (+ user has a personal discount code).
          حالت «نزدیک انقضا» (۰–۵ روز) عمداً بنر نمی‌گیرد؛ جعبهٔ منقضی بالاتر همین صفحه کافی است. */}
      {showRenewalBanner && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl p-5 text-white shadow-xl relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
        >
          <div className="absolute -left-6 -top-6 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm">اشتراک شما منقضی شده است</p>
                <p className="text-[11px] opacity-90 mt-0.5">
                  {`${toPersianDigits(renewalInfo?.expiredDaysAgo ?? 0)} روز از انقضای اشتراک ${PLAN_LABELS[bannerPlanId as keyof typeof PLAN_LABELS] ?? bannerPlanId} شما می‌گذرد. برای ادامه دسترسی، همین حالا تمدید کنید.`}
                </p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] opacity-90">کد تخفیف اختصاصی تمدید شما:</span>
                  <span
                    dir="ltr"
                    className="text-xs font-mono px-2.5 py-1 rounded-md bg-white text-orange-600 font-bold"
                  >
                    {renewalInfo?.code}
                  </span>
                  <span className="text-[11px] opacity-90">({toPersianDigits(renewalInfo?.value ?? 0)}٪ تخفیف)</span>
                </div>
              </div>
            </div>
            <button
              onClick={renewWithDiscount}
              disabled={renewing}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-white text-orange-600 font-bold text-sm hover:bg-orange-50 transition shadow-md flex items-center gap-1.5 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {renewing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {renewing ? "در حال باز کردن…" : "تمدید اشتراک"}
            </button>
          </div>
        </motion.div>
      )}

      {/* بنر هدیهٔ تخفیف خرید اول — v47 (پیامک‌های ۴۶۱۲۹۱ / ۶۱۲۹۶۴): کاربر به پلن‌ها
          ارجاع شده و باید تا لحظهٔ خرید، قیمت‌ها را تخفیف‌خورده ببیند */}
      {showGiftBanner && personalDiscount && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl p-5 text-white shadow-xl relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
        >
          <div className="absolute -left-6 -top-6 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm">هدیهٔ تخفیف اختصاصی شما فعال است 🎁</p>
              <p className="text-[11px] opacity-90 mt-0.5 leading-5">
                با کد {personalDiscount.code} تا {toPersianDigits(personalDiscount.percent)}٪ تخفیف
                روی همهٔ پلن‌ها داری — تا ۴۸ ساعت از لحظهٔ فعال‌سازی معتبر است.
                قیمت‌های پایین همین صفحه با تخفیف شما محاسبه شده‌اند.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* بنر آفر «ترک درگاه پرداخت» — v53: کاربر با لینک پیامک (?offer=) آمده و
          کد نمایشی 248945 برای او فعال است؛ قیمت‌های کارت‌ها با تخفیف او محاسبه
          شده‌اند و شمارش معکوس تا انقضا زنده است — بعد از انقضا نوار حذف و
          قیمت‌ها برمی‌گردند */}
      {offerActive && offer?.status === "valid" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl p-5 text-white shadow-xl relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #f43f5e, #f97316)" }}
        >
          <div className="absolute -left-6 -top-6 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <PartyPopper className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm">
                  🎉 تخفیف ویژهٔ {toPersianDigits(offer.percent)}٪ برای شما فعال شد
                  {offerDeadlineText ? ` — تا ساعت ${offerDeadlineText} فرصت دارید` : ""}
                </p>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] opacity-90">کد تخفیف شما:</span>
                  <span
                    dir="ltr"
                    className="text-xs font-mono px-2.5 py-1 rounded-md bg-white text-rose-600 font-bold"
                  >
                    {ABANDONED_CART_OFFER_DISPLAY_CODE}
                  </span>
                  {offerCountdownText && (
                    <span className="text-[11px] font-bold bg-white/20 px-2 py-1 rounded-md tabular-nums">
                      ⏱ {offerCountdownText} باقی‌مانده
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Clock className="w-8 h-8 opacity-40 hidden sm:block shrink-0" />
          </div>
        </motion.div>
      )}

      {/* نوار زرد ملایم — کد آفر ترک-درگاه منقضی/نامعتبر بوده (کاربر با لینک پیامک
          آمده ولی کدش دیگر اعتبار ندارد) */}
      {offerExpiredBanner && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl px-4 py-3 border border-amber-200 bg-amber-50 flex items-center gap-2.5"
        >
          <Clock className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-xs font-bold text-amber-700">کد تخفیف شما منقضی شده است.</p>
        </motion.div>
      )}

      {/* وضعیت فعلی */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl p-5 text-white" style={{ background: "linear-gradient(135deg, #fb923c, #f97316)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5" />
            <h3 className="font-bold">وضعیت فعلی شما</h3>
          </div>
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-white/20">
            <Wallet className="w-3.5 h-3.5" />
            {toPersianDigits(formatToman(user?.walletBalance ?? 0))} ت
          </div>
        </div>
        {currentPlanId ? (
          isPending ? (
            // FIX: اشتراک pending هنوز فعال نیست — «پلن فعال / ۰ روز» گمراه‌کننده بود.
            // ۴۵ روز بعد از ارسال عکس بدن شروع می‌شود.
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] opacity-80">پلن خریداری‌شده</p>
                <p className="font-black flex items-center gap-1.5">
                  {PLAN_LABELS[currentPlanId as keyof typeof PLAN_LABELS] ?? currentPlanId}
                </p>
              </div>
              <div>
                <p className="text-[11px] opacity-80">وضعیت</p>
                <p className="font-black">در انتظار تکمیل پیش‌نیازها</p>
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] opacity-80">پلن فعال</p>
              <p className="font-black flex items-center gap-1.5">
                {PLAN_LABELS[currentPlanId as keyof typeof PLAN_LABELS] ?? currentPlanId}
              </p>
            </div>
            <div>
              <p className="text-[11px] opacity-80">باقی‌مانده</p>
              <p className="font-black">{toPersianDigits(Math.max(0, daysLeft))} روز</p>
            </div>
            <div>
              <p className="text-[11px] opacity-80">انقضا</p>
              <p className="font-bold text-sm">{subEndDate?.toLocaleDateString("fa-IR")}</p>
            </div>
          </div>
          )
        ) : expiredPlanId ? (
          // ─── FIX: پلن منقضی/لغو‌شده — حالت «بدون پلن» + دعوت به تمدید ───
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold flex items-center gap-1.5">
                اشتراک {PLAN_LABELS[expiredPlanId as keyof typeof PLAN_LABELS] ?? expiredPlanId} به پایان رسیده
              </p>
              <p className="text-xs opacity-90 mt-1">برای ادامه دسترسی به امکانات، پلن خود را تمدید یا انتخاب کنید.</p>
            </div>
            <button
              onClick={renewWithDiscount}
              disabled={renewing}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-white text-orange-600 font-bold text-sm hover:bg-orange-50 transition shadow-md flex items-center gap-1.5 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {renewing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {renewing ? "در حال باز کردن…" : "تمدید اشتراک"}
            </button>
          </div>
        ) : (
          <p className="text-sm">پلن فعالی ندارید — یک پلن انتخاب کنید</p>
        )}
      </motion.div>

      {/* ۴ کارت پلن — دقیقاً همان کارت‌های لندینگ (بوردر طلایی، روبان پیشنهادی، شیمر هاور)
          فقط CTA پنل حفظ شده: پلن فعلی / ارتقا / انتخاب پلن */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 items-stretch">
        {SUBSCRIPTION_PLANS.map((plan, i) => {
          const isCurrent = plan.id === currentPlanId;
          // ─── منطق ارتقا: فقط پلن‌های بالاتر «ارتقا» ───
          // کاربر با پلن پیشرفته فقط روی حرفه‌ای «ارتقا» می‌بیند
          // کاربر با پلن پیشرفته روی استاندارد و اقتصادی چیزی نمی‌بیند
          const currentPlan = SUBSCRIPTION_PLANS.find((p) => p.id === currentPlanId);
          const currentTier = currentPlan?.tier ?? 0;
          // بدون پلن فعلی (منقضی/هرگز): همه دکمه‌ها «انتخاب پلن» — نه «ارتقا»
          const isHigherTier = currentTier > 0 && plan.tier > currentTier;
          const isLowerTier = currentTier > 0 && plan.tier < currentTier;
          return (
            <SharedPlanCard
              key={plan.id}
              plan={plan}
              index={i}
              // v53 — تخفیف مؤثر: آفر ترک-درگاه (?offer=) اولویت دارد، بعد تخفیف شخصی کاربر
              personalDiscount={isCurrent ? null : effectiveDiscount}
              // v78 — «بروزرسانی برنامه (یکبار)» فقط روی کارت پلنِ فعلیِ پیشرفته/حرفه‌ای
              footer={
                isCurrent &&
                (plan.id === "advanced" || plan.id === "ultimate") &&
                planRegen?.eligible ? (
                  <PlanRegenFooter
                    pending={planRegen.pending}
                    used={planRegen.used}
                    onGoChat={() => setMainTab("chat")}
                  />
                ) : undefined
              }
              cta={
                isCurrent ? (
                  <div className="w-full py-3 rounded-xl text-sm font-bold text-center flex items-center justify-center gap-1.5 text-white" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                    <Check className="w-4 h-4" /> پلن فعلی شما
                  </div>
                ) : isLowerTier ? (
                  // ─── پلن پایین‌تر: کلمه ارتقا نشان داده نمی‌شود ───
                  // فقط یک دکمه خاکستری غیرفعال با متن «پلن پایین‌تر»
                  <div className="w-full py-3 rounded-xl text-sm font-bold text-center flex items-center justify-center gap-1.5 bg-slate-100 text-slate-400 border border-slate-200">
                    {plan.label}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      // v47 — پیش‌پرکردن کد تخفیف اختصاصی کاربر (تمدید/خوش‌آمدگویی/وین‌بک)
                      // تا مودال خرید همان قیمت تخفیف‌خوردهٔ کارت‌ها را نشان دهد
                      // v53 — آفر ترک-درگاه: کد نمایشی «248945» پیش‌پر می‌شود
                      // (resolve سروری در payment/discount و payment/checkout انجام می‌شود)
                      setPurchaseUserDiscount(
                        offerActive
                          ? ABANDONED_CART_OFFER_DISPLAY_CODE
                          : personalDiscount?.code ?? null
                      );
                      setPurchasePlan(plan);
                    }}
                    className="w-full h-11 rounded-xl font-bold text-sm text-white transition hover:scale-[1.02] flex items-center justify-center gap-1.5 shadow-lg"
                    style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                  >
                    <Crown className="w-4 h-4" />
                    {isHigherTier ? "ارتقا" : "انتخاب پلن"}
                  </button>
                )
              }
            />
          );
        })}
      </div>

      {/* جدول مقایسه — همان جدول صفحهٔ اصلی، تاشو و پیش‌فرض جمع */}
      <div className="space-y-3">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
          />
          مقایسه کامل پلن‌ها
        </h3>
        <ComparisonTable />
      </div>

      {/* کد تخفیف بخش حذف شد — فقط FITAP20 در مودال خرید با وارد کردن دستی کاربر نمایش داده می‌شود */}

      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-orange-500" /> پرداخت امن</span>
        <span className="flex items-center gap-1.5"><Wallet className="w-4 h-4 text-orange-500" /> پرداخت با کیف پول</span>
      </div>

      {purchasePlan && (
        <PurchaseModal
          plan={purchasePlan}
          prefillUserDiscountCode={purchaseUserDiscount ?? undefined}
          onClose={() => {
            setPurchasePlan(null);
            setPurchaseUserDiscount(null);
          }}
          onNeedLogin={() => {
            setPurchasePlan(null);
            setPurchaseUserDiscount(null);
          }}
        />
      )}
    </div>
  );
}
