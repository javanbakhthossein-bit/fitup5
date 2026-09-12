"use client";

import { useEffect, useState } from "react";
import { Crown, Sparkles, Wallet, ShieldCheck, Info, Zap, Headphones, RefreshCw } from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { smartNavigate } from "@/lib/fitness/navigation";
import { type SubscriptionPlan } from "@/lib/fitness/types";
import { usePlans } from "@/lib/fitness/use-plans";
import { PurchaseModal } from "./purchase-modal";
import { SharedPlanCard, ComparisonTable } from "@/components/fitness/plan-card-shared";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// ─── v78 — «بروزرسانی برنامه (یکبار)» روی کارت‌های پیشرفته/حرفه‌ای در لندینگ ───
const PLAN_REGEN_TOOLTIP =
  "یکبار در طول اشتراک می‌توانید برنامهٔ تمرینی، تغذیه و مکمل را با کمک چت فیتاپ و بر اساس دیتای فعلی شما بازطراحی کنید — بدون تغییر در مدت اشتراک";
const PLAN_REGEN_PENDING_TOOLTIP =
  "اطلاعات بازطراحی شما در چت فیتاپ در جریان است — برای تایید نهایی به چت بروید";
type PlanRegenStateDto = { eligible: boolean; pending: boolean; used: boolean };

function PlanRegenLandingLink({
  pending,
  onGoChat,
}: {
  pending: boolean;
  onGoChat: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onGoChat}
          className="mt-2.5 w-full rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 transition border border-orange-100 bg-orange-50/50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {pending ? "تکمیل بروزرسانی برنامه" : "بروزرسانی برنامه (یکبار)"}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[250px] text-[11px] leading-relaxed text-center">
        {pending ? PLAN_REGEN_PENDING_TOOLTIP : PLAN_REGEN_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}

export function PricingSection() {
  const { setScreen, user, setPendingPlanId, setMainTab } = useAppStore();
  const { plans: PLANS } = usePlans();
  const [purchasePlan, setPurchasePlan] = useState<SubscriptionPlan | null>(null);

  // ─── v78 — وضعیت سهمیهٔ بازطراحی برای کاربرِ لاگین (مهمان همیشه لینک را می‌بیند) ───
  // خروجی مؤثر: با خروج کاربر، وضعیت کش‌شده نادیده گرفته می‌شود (بدون setState در effect)
  const [planRegenRaw, setPlanRegen] = useState<PlanRegenStateDto | null>(null);
  const planRegen = user ? planRegenRaw : null;
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
        /* بی‌صدا */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // When a plan is clicked: if user is logged in, open the purchase modal as before;
  // otherwise persist the chosen plan id and route to auth. After auth+onboarding+analysis,
  // the analysis screen will offer a one-tap purchase of the pending plan.
  function handleSelectPlan(plan: SubscriptionPlan) {
    if (user) {
      setPurchasePlan(plan);
    } else {
      setPendingPlanId(plan.id);
      smartNavigate(false, setScreen, false);
    }
  }

  // ─── v78 — کلیک «بروزرسانی برنامه (یکبار)» در لندینگ:
  // لاگین → تب چت پنل (همان الگوی ناوبری smartNavigate + setMainTab)
  // مهمان → همان جریان auth که CTA پلن دارد ───
  function handleGoPlanRegenChat() {
    if (user) {
      setMainTab("chat");
      smartNavigate(true, setScreen, user.onboardingDone);
    } else {
      smartNavigate(false, setScreen, false);
    }
  }

  return (
    <section id="pricing" className="py-20 sm:py-28 bg-white relative overflow-hidden scroll-mt-20">
      {/* subtle background */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-20 right-0 w-96 h-96 rounded-full bg-amber-100/40 blur-3xl" />
        <div className="absolute bottom-20 left-0 w-80 h-80 rounded-full bg-orange-100/40 blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div
          className="animate-fade-in-up text-center mb-12"
        >
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-4"
            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}
          >
            <Crown className="w-4 h-4" />
            ۴ پلن اشتراک — هر بدنی فیتاپ میخواد
          </div>
          <h2 className="text-3xl sm:text-4xl font-black mb-4 text-slate-900">
            پلن متناسب با{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #f59e0b, #f97316)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              هدف و بودجه
            </span>{" "}
            خودت را انتخاب کن
          </h2>
          <p className="text-slate-500 max-w-2xl mx-auto">
            از پلن اقتصادی شروع کن یا با پلن حرفه‌ای، آنالیز ویدیویی و آزمایش خون را تجربه کن. همه پلن‌ها ۴۵ روزه و شامل ۱ فاز تمرینی هستند.
          </p>
        </div>

        {/* ۴ کارت قیمت‌گذاری — سفید با حاشیه طلایی پررنگ (کارت مشترک لندینگ/پنل) */}
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 mb-12 max-w-6xl mx-auto items-stretch">
          {PLANS.map((plan, i) => {
            // ─── v78 — «بروزرسانی برنامه (یکبار)» فقط روی کارت‌های پیشرفته/حرفه‌ای:
            // مهمان → لینک (کلیک → جریان ورود)؛ لاگینِ واجد شرایط → لینک (کلیک → چت پنل)؛
            // لاگینِ غیر واجد شرایط یا سهمیه مصرف‌شده → بدون لینک ───
            const isRegenCard = plan.id === "advanced" || plan.id === "ultimate";
            const showRegenLink =
              isRegenCard && (!user || (planRegen?.eligible === true && planRegen.used === false));
            return (
              <SharedPlanCard
                key={plan.id}
                plan={plan}
                index={i}
                onSelect={() => handleSelectPlan(plan)}
                footer={
                  showRegenLink ? (
                    <PlanRegenLandingLink
                      pending={!!user && planRegen?.pending === true}
                      onGoChat={handleGoPlanRegenChat}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>

        {/* لینک برجسته‌تر به جدول مقایسه */}
        <div className="max-w-5xl mx-auto mb-6">
          <div
            className="animate-fade-in-up flex items-center justify-center gap-2 text-center"
          >
            <a
              href="#comparison-table"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-200 text-orange-700 text-sm font-bold hover:border-orange-400 hover:shadow-lg hover:shadow-orange-500/10 transition-all"
            >
              <Info className="w-4 h-4" />
              مقایسه کامل ۴ پلن را ببینید
              <span className="text-orange-400">↓</span>
            </a>
          </div>
        </div>

        {/* جدول مقایسه تاشو */}
        <div id="comparison-table">
          <ComparisonTable />
        </div>

        {/* نشانه‌های اعتماد — v48: دو نشانهٔ تبدیل‌محور اضافه شد */}
        <div
          className="animate-fade-in flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mt-12 text-sm text-slate-500"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-orange-500" />
            پرداخت امن زرین‌پال
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-500" />
            فعال‌سازی آنی بعد از پرداخت
          </div>
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-orange-500" />
            پرداخت با کیف پول
          </div>
          <div className="flex items-center gap-2">
            <Headphones className="w-4 h-4 text-orange-500" />
            پشتیبانی و تیکت ۲۴ ساعته
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            ۴۵ روز دسترسی کامل به پلتفرم
          </div>
        </div>
      </div>

      {purchasePlan && (
        <PurchaseModal
          plan={purchasePlan}
          onClose={() => setPurchasePlan(null)}
          onNeedLogin={() => {
            setPurchasePlan(null);
            smartNavigate(!!user, setScreen, user?.onboardingDone);
          }}
        />
      )}
    </section>
  );
}
