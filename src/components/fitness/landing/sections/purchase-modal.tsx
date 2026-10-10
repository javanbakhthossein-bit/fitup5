"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
  Crown,
  ShieldOff,
  MessageSquare,
  Copy,
  MessageCircle,
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
// v81 — تشخیص یکپارچهٔ اپ کافه‌بازار (پل + فال‌بک UA) — به‌جای چک پراکندهٔ window
import { isFitUpBazaarApp } from "@/lib/fitness/bazaar-bridge";
// v104 — فلوی «افزایش موجودی» از مدال خرید به مودال شارژ کیف پول پنل
import { requestProfileWalletOpen } from "@/components/fitness/views/profile-overlay";
import {
  toPersianDigits,
  formatToman,
  type SubscriptionPlan,
} from "@/lib/fitness/types";
import {
  toast,
} from "sonner";
// v159 — مدال الزامی به‌روزرسانی اطلاعات بعد از تمدید (دستور مالک)
import { RenewalUpdateModal } from "@/components/fitness/renewal-update-modal";
// v148 — fetch تاب‌آور پرداخت: تایم‌اوت سخت + تلاش دوباره با اتصال تازه
// (رفع هنگ ابدی دکمهٔ پرداخت بعد از سوئیچ VPN — سوکت keep-alive مُرده)
import { fetchWithResilience, NetworkFetchError } from "@/lib/payment/client-fetch";
// v171 — تشخیص منبع ورود (سند بازطراحی جریان پرداخت): اینستاگرام → «ارسال
// پیامک پرداخت امن»؛ اپ اختصاصی → پل Custom Tabs؛ وب → رفتار قبلی بدون تغییر
import {
  detectEntrySourceFromUa,
  type EntrySource,
} from "@/lib/fitness/entry-source";
// v198 — رویدادگذاری قیف فروش (دیرکتیو مالک): «تمام مراحل خرید رو در همه جا
// رویداد گذاری کنی و در پنل مدیر برام بیاری» — fire-and-forget، هرگز بلاک نیست
import { trackFunnelEvent, getFunnelSessionId } from "@/lib/analytics/track-client";

// ═══════════════════════════════════════════════════════════════════════════
// v135 — مدال خرید «تک و یکتا» (دیرکتیو مالک — ممیزی فروش)
//
// قبلاً «دو» مدال پشت‌سرهم بود: ① فرم (کد تخفیف + روش پرداخت + مبالغ) و
// ② صفحهٔ جداگانهٔ «رفتن به درگاه» با متن‌های طولانی. مالک: «اصلاً اینکه هر دو
// تاش باشه اشتباهه — یه دونه مدال که کد تخفیف، انتخاب درگاه، مبالغ و دکمهٔ
// رفتن به درگاه همه داخلش باشه؛ کاربر در یک حرکت همه‌چیز را ببیند و برود».
//
// حالا: یک مدال واحد — همهٔ عناصر یک‌جا؛ کلیک روی دکمهٔ پرداخت = ساخت پرداخت و
// انتقال «فوری» به درگاه (بدون هیچ گام میانی). متن‌های اضافهٔ مرحلهٔ درگاه حذف
// شدند؛ دربارهٔ VPN فقط «یک» جملهٔ ثابت مشورتی نمایش داده می‌شود.
// تمام مسیرها حفظ شده‌اند: زرین‌پال (وب)، کیف پول، فعال‌سازی رایگان، IAP بازار
// (اپ کافه‌بازار) و همین مدال در لندینگ/پلن‌ها/تمدید/تحلیل استفاده می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

type Step = "form" | "processing" | "receipt" | "sms";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

// ═══ v174 — پل native پرداخت (ضد «VPN خاموش → دکمهٔ پرداخت مرده») ═══
// در اپ اختصاصی، با خاموش‌شدن VPN سوکت‌های WebView می‌میرند و هر دو درخواست
// (checkout + bridge-token) از استک مرورگر بی‌جواب می‌مانند. متد پل
// FitUpNative.startPaymentNative همین دو درخواست را با استک native
// (HttpURLConnection جدا از Chromium) می‌زند و Custom Tab را خودش باز می‌کند.
// 🆕 v176 — startPaymentNativeWithCode(planId, discountCode, userDiscountCode):
// کد تخفیف (تمدید/شخصی/عمومی) هم از پل می‌رود → تمدید و ارتقای کدتخفیفی هم
// استک جاوا؛ اپ‌های قدیمی‌تر متد را ندارند → typeof گارد → فال‌بک قبلی وب.
// فلگ پایین: اگر native یک‌بار وسط کار شکست خورد (رویداد fitup:native-payment-failed)،
// تا رفرش بعدی از پل native صرف‌نظر می‌شود — کلیک دوباره = دقیقاً جریان قبلی وب.
let nativePaymentBridgeFailed = false;
let nativePaymentFailCleanupTimer: number | null = null;

export function PurchaseModal({
  plan,
  onClose,
  onNeedLogin,
  prefillDiscountCode,
  prefillUserDiscountCode,
  analysisDiscount,
}: {
  plan: SubscriptionPlan;
  onClose: () => void;
  onNeedLogin: () => void;
  /** Public discount code to prefill (e.g. FITAP20) */
  prefillDiscountCode?: string;
  /** Per-user renewal discount code to prefill (auto-applied) */
  prefillUserDiscountCode?: string;
  /** v197 — تخفیف ۱۰٪ صفحهٔ تحلیل آنبوردینگ (دیرکتیو مالک): توکن سمت سرور
   *  صادر و با خروج از صفحه باطل می‌شود؛ اینجا فقط نمایش + ارسال به checkout */
  analysisDiscount?: { token: string; percent: number };
}) {
  // v229 — subscription انتخابی (الگوی main-app v55): قبلاً کل store subscribe می‌شد
  // و هر setState پنل، کل مدال خرید را re-render می‌کرد (جانک گوشی ضعیف).
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const setOverlay = useAppStore((s) => s.setOverlay);
  const setScreen = useAppStore((s) => s.setScreen);
  const setMainTab = useAppStore((s) => s.setMainTab);
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
  // v159 — مدال الزامی به‌روزرسانی اطلاعات تمدید
  const [renewalPrompt, setRenewalPrompt] = useState(false);
  const [renewalFlagKeyState, setRenewalFlagKeyState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // ضد دابل‌کلیک دکمهٔ پرداخت: از لحظهٔ کلیک تا navigation غیرفعال + اسپینر
  const [redirecting, setRedirecting] = useState(false);

  // ═══ v171 — فلوی چندمنبعی (سند بازطراحی پرداخت) ═══
  const [entrySource, setEntrySource] = useState<EntrySource>("unknown");
  // وضعیت «لینک پرداخت پیامک شد» (فقط اینستاگرام)
  const [smsSent, setSmsSent] = useState<{ phoneMasked: string; link: string } | null>(null);
  const [smsResendIn, setSmsResendIn] = useState(0);
  const [smsLinkCopied, setSmsLinkCopied] = useState(false);
  // در حال فراخوانی API ارسال پیامک (برای برچسب دقیق دکمه)
  const [smsSending, setSmsSending] = useState(false);

  // v91 (دیرکتیو مالک): خط شمارندهٔ ورزشکاران از مدال خرید حذف شد.
  // v104 — تشخیص اپ کافه‌بازار برای «رندر» (نه فقط اکشن): در اپ بازار متن درگاه
  // باید «کافه‌بازار» باشد نه «زرین‌پال». بعد از mount ست می‌شود تا با
  // SSR/hydration تضاد نسازد (الگوی همان navItems در main-app).
  const [inBazaarApp, setInBazaarApp] = useState(false);
  // ═══ v211 — «مبلغ مودال = مبلغ واقعی درگاه بازار» (دیرکتیو مالک) ═══
  // ۱) bazaarSkuPriceStr — رشتهٔ نمایشی واقعی SKU از خودِ بازار (پل
  //    fitupBazaarSkuPrice در اپ ۱.۱۵.۶+ / Poolakey getSkuDetails) — همان چیزی
  //    که پنجرهٔ پرداخت بازار نشان می‌دهد؛ اگر قیمت پیشخان با سایت هم‌تراز
  //    نباشد، نمایش از عدد خودِ بازار پیروی می‌کند نه از حدس ما.
  // ۲) bazaarVersionOk — گیت نسخهٔ بازار: تخفیف پویا فقط در بازار ۱۳.۳.۰+
  //    پشتیبانی می‌شود؛ پایین‌تر درگاه درخواست را با «اطلاعات ارسالی برنامه
  //    برای پرداخت نامعتبر است» رد می‌کند → ما از قبل بدون توکن و با اطلاعِ
  //    شفاف می‌رویم.
  // ۳) bazaarDynamicBlocked/Note — فال‌بک «مرئی» بعد از رد JWT توسط بازار:
  //    مودال با مبلغ واقعی به‌روز می‌شود و کاربر خودش ادامه می‌دهد — هرگز
  //    قیمت کامل بی‌صدا نیست (قانون fail-closed v207 حفظ شده است).
  const [bazaarSkuPriceStr, setBazaarSkuPriceStr] = useState<string | null>(null);
  const [bazaarVersionOk, setBazaarVersionOk] = useState<boolean | null>(null);
  const [bazaarDynamicBlocked, setBazaarDynamicBlocked] = useState(false);
  const [bazaarDynamicNote, setBazaarDynamicNote] = useState<string | null>(null);
  useEffect(() => {
    if (!isFitUpBazaarApp()) return;
    let alive = true;
    (async () => {
      try {
        const native = (window as any).FitUpNative;
        // نسخهٔ کافه‌بازار نصب‌شده (اپ ۱.۱۵.۶+ — در اپ‌های قدیمی‌تر رشتهٔ خالی)
        let ver = "";
        try {
          ver = String(native?.getBazaarVersion?.() || (window as any).fitupBazaarVersion?.() || "");
        } catch {}
        if (alive && ver) {
          const parts = ver.split(".").map((p: string) => parseInt(p, 10) || 0);
          setBazaarVersionOk((parts[0] || 0) > 13 || ((parts[0] || 0) === 13 && (parts[1] || 0) >= 3));
        }
        // قیمت واقعی SKU از خود بازار — بهترین‌تلاش؛ شکستش خرید را بلاک نمی‌کند
        const fn = (window as any).fitupBazaarSkuPrice;
        if (typeof fn === "function") {
          const res = await fn(`fitup_${plan.id}`);
          if (alive && res?.ok && typeof res?.price === "string" && res.price) {
            setBazaarSkuPriceStr(res.price);
          }
        }
      } catch {
        // بهترین‌تلاش
      }
    })();
    return () => {
      alive = false;
    };
  }, [plan.id]);
  useEffect(() => {
    setInBazaarApp(isFitUpBazaarApp());
    // v171 — منبع ورود (کلاینت: UA همان مرورگر/WebView — اینستاگرام UA اش را
    // لو می‌دهد؛ اپ اختصاصی با پسوند FitUpApp/؛ کافه‌بازار مستثنا می‌ماند)
    try {
      setEntrySource(detectEntrySourceFromUa(navigator.userAgent));
    } catch {
      setEntrySource("unknown");
    }
  }, []);

  // ═══ v229 — حفظ تخفیف (دیرکتیو مالک: «با اپدیت برنامه باید تخفیف حفظ بشه») ═══
  // وقتی مدال بدون پراپ تخفیف تحلیل باز می‌شود (ورود از تب پلن‌ها/لندینگ، یا
  // بعد از آپدیت اپ)، وضعیت زندهٔ توکن از سرور خوانده می‌شود — تخفیفِ فعالِ
  // کاربر در مدال همان‌جا نمایش و مصرف می‌شود. اپ اختصاصی مستثناست: پل native
  // زرین‌پال توکن را منتقل نمی‌کند (v174) و باید همان مسیر بومی حفظ شود؛
  // آنجا تخفیف از خودِ صفحهٔ تحلیل می‌آید که بعد از آپدیت دوباره grant می‌شود.
  const [serverAnalysisDiscount, setServerAnalysisDiscount] = useState<{
    token: string;
    percent: number;
  } | null>(null);
  useEffect(() => {
    if (analysisDiscount) return;
    let es: string = "unknown";
    try {
      es = detectEntrySourceFromUa(navigator.userAgent);
    } catch {}
    if (es === "app_android") return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/onboarding/analysis-discount", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (
          alive &&
          json?.active &&
          typeof json?.token === "string" &&
          json.token &&
          Number(json.percent) > 0
        ) {
          setServerAnalysisDiscount({ token: String(json.token), percent: Number(json.percent) });
        }
      } catch {
        // بهترین‌تلاش — بدون تخفیف هم خرید سالم است
      }
    })();
    return () => {
      alive = false;
    };
  }, [analysisDiscount]);
  // اولویت: پراپ صفحهٔ تحلیل (توکن همین صفحه) > توکنِ زندهٔ سرور (hydrate)
  const activeAnalysisDiscount = analysisDiscount ?? serverAnalysisDiscount ?? undefined;

  // ═══ v198 — رویداد: باز شدن مدال خرید = انتخاب پلن (هر ۶ نقطهٔ ورود همین‌جا ═══
  // یک‌جا پوشش داده می‌شود: لندینگ/پلن‌ها/تمدید/اشتراک/تحلیل/اسپات‌لایت)
  const modalOpenTrackedRef = useRef(false);
  useEffect(() => {
    if (modalOpenTrackedRef.current) return;
    modalOpenTrackedRef.current = true;
    trackFunnelEvent("purchase_modal_opened", {
      planId: plan.id,
      amount: plan.price,
      force: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══ v171 — (افکت intent اینستاگرام پایین‌تر — بعد از تعریف isLoggedIn) ═══

  const isLoggedIn = !!user;
  const walletBalance = user?.walletBalance ?? 0;
  const originalAmount = plan.price;

  // ═══ v171 — حالت ۳ سبد رهاشدهٔ اینستاگرام (سند بخش ۷) ═══
  // کاربر اینستاگرامی که مدال خرید را باز کرده ولی هنوز دکمه را نزده، باید در
  // همان لیست سبد رهاشدهٔ فعلی بیفتد (کرون‌ها بدون هیچ تغییری پیامک می‌دهند).
  // سرور idempotent است (نیتِ همان پلن در ۲۴ ساعت reuse می‌شود) — فقط برای
  // اینستاگرام صدا زده می‌شود؛ وب/بازار هیچ ردیفی نمی‌سازند (تجربهٔ وب ثابت).
  useEffect(() => {
    if (entrySource !== "instagram") return;
    if (!isLoggedIn || user?.onboardingDone !== true) return;
    (async () => {
      try {
        await fetch("/api/payment/instagram/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: plan.id }),
        });
      } catch {
        // بهترین‌تلاش — شکستش خرید را بلاک نمی‌کند
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrySource, isLoggedIn, plan.id, user?.onboardingDone]);

  // شمارش معکوس ۶۰ثانیه‌ای «ارسال مجدد پیامک» (سند بخش ۲: شمارش معکوس ارسال مجدد)
  useEffect(() => {
    if (smsResendIn <= 0) return;
    const t = setTimeout(() => setSmsResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [smsResendIn]);

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

  // 🩹 v45: اگر مرورگر صفحه را از bfcache برگرداند (Back از درگاه پرداخت)، قفل
  // redirecting آزاد شود تا کاربر بتواند دوباره روی دکمهٔ پرداخت بزند + «هر»
  // بازگشت به صفحه و برگشت به تب (visibilitychange) قفل را آزاد می‌کند.
  useEffect(() => {
    const unlock = () => setRedirecting(false);
    const onPageShow = (e: PageTransitionEvent) => {
      unlock();
    };
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

  // FIX: فرمول مبلغ نهایی دقیقاً مثل checkout سمت سرور:
  // finalAmount = max(0, قیمت اصلی − تخفیف − اعتبار ارتقا)
  const discountValue = discountInfo?.valid ? discountInfo.discountValue : 0;
  const upgradeCredit = upgradeEstimate?.isUpgrade ? upgradeEstimate.upgradeCredit : 0;
  const preAnalysisAmount = Math.max(0, originalAmount - discountValue - upgradeCredit);
  // v197 — تخفیف ۱۰٪ صفحهٔ تحلیل: دقیقاً همان فرمول سرور (round پس از کد/ارتقا)
  const analysisDiscountValue =
    activeAnalysisDiscount && preAnalysisAmount > 0
      ? Math.round((preAnalysisAmount * activeAnalysisDiscount.percent) / 100)
      : 0;
  const finalAmount = Math.max(0, preAnalysisAmount - analysisDiscountValue);
  const canUseWallet = walletBalance >= finalAmount;

  // ═══ v211 — مبلغ نمایشی در اپ بازار از خودِ بازار (منبع حقیقت) ═══
  // اگر قیمت پیشخان بازار با سایت هم‌تراز نباشد (خطای رایج ۱۰برابری ریال/تومان
  // هنگام ثبت کالا در پیشخان)، مبلغ مودال از عدد خودِ بازار ساخته می‌شود تا
  // «مودال = مبلغ درگاه» همیشه برقرار باشد؛ در جهان سالم (پنل تومانی هم‌تراز)
  // دقیقاً همان finalAmount است و هیچ تغییری دیده نمی‌شود.
  const bazaarSkuToman = useMemo(() => {
    if (!inBazaarApp || !bazaarSkuPriceStr) return null;
    try {
      const fa = "۰۱۲۳۴۵۶۷۸۹";
      const ar = "٠١٢٣٤٥٦٧٨٩";
      const s = bazaarSkuPriceStr
        .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
        .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
      const isRial = /ریال/.test(s);
      const digits = s.replace(/[^\d]/g, "");
      if (!digits) return null;
      const n = parseInt(digits, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      const toman = isRial ? Math.round(n / 10) : n;
      // گارد سلامت: عدد باید مضرب شناخته‌شدهٔ قیمت پلن باشد (۱× یا ۱/۱۰×) —
      // وگرنه رشته، قیمت نیست (مثلاً توضیحات محصول) و نادیده گرفته می‌شود
      const r = toman / plan.price;
      const near = (x: number, y: number) => Math.abs(x - y) <= y * 0.02;
      if (!(near(r, 1) || near(r, 0.1))) return null;
      return toman;
    } catch {
      return null;
    }
  }, [inBazaarApp, bazaarSkuPriceStr, plan.price]);
  const bazaarPriceMismatch =
    bazaarSkuToman !== null && Math.abs(bazaarSkuToman - plan.price) > plan.price * 0.02;
  const displayPayable =
    bazaarPriceMismatch && finalAmount > 0
      ? Math.max(1, Math.round((bazaarSkuToman! * finalAmount) / plan.price))
      : finalAmount;

  async function validateUserDiscount(code: string) {
    if (!code.trim()) {
      toast.error("کد تخفیف اختصاصی موجود نیست");
      return;
    }
    // v198 — رویداد: تلاش کد تخفیف (پیش‌پرشده = خودکار)
    trackFunnelEvent("discount_attempted", {
      planId: plan.id,
      meta: { via: "prefill" },
      force: true,
    });
    if (!isLoggedIn) {
      toast.info("برای استفاده از کد تخفیف ابتدا وارد شوید");
      onNeedLogin();
      return;
    }
    setValidating(true);
    try {
      // Fetch the user's actual per-user discount info to display the correct
      // percentage. v47: reason-aware — تمدید (renewal) یا هدیهٔ خرید اول.
      let percent = 15;
      let kindLabel = "تخفیف تمدید";
      try {
        // v156 — تایم‌اوت ۸ ثانیه: fetch خام قبلاً روی سوکت مرده آویزان می‌شد و
        // `validating` قفل می‌شد (فرم مودال خرید بی‌پاسخ می‌ماند)
        const infoRes = await fetchWithResilience(
          "/api/user-discount-code",
          { cache: "no-store" },
          { timeoutMs: 8_000, retries: 0 }
        );
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info?.value && info?.value > 0) percent = info.value;
          if (info?.reason && info.reason !== "renewal_loyalty") kindLabel = "تخفیف اختصاصی";
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
        label: `کد اختصاصی ${code} (${toPersianDigits(percent)}٪ ${kindLabel})`,
      });
      // v198 — رویداد: کد تخفیف اعمال شد
      trackFunnelEvent("discount_applied", {
        planId: plan.id,
        amount: estFinal,
        meta: { via: "prefill", code },
        force: true,
      });
      toast.success(`کد اختصاصی اعمال شد! ${toPersianDigits(percent)}٪ ${kindLabel}`);
    } finally {
      setValidating(false);
    }
  }

  /**
   * v212 — اعمال کد تخفیف با اعتبارسنجی رسمی سرور (POST /api/payment/discount).
   * مسیر دستی (کاربر تایپ کرده) و مسیر خودکار v212 (پرپرایم کد اختصاصی پیامکی)
   * هر دو از همین تابع استفاده می‌کنند تا مبلغ نمایشی در هر دو حالت «همان عدد
   * سمت سرور» باشد — نه حدس کلاینت. via فقط تفاوت رویداد/پیام می‌گذارد:
   * پرپرایم خودکار بی‌سروصدا اعمال می‌شود و هیچ خطایی کاربر را اذیت نمی‌کند.
   */
  async function applyDiscountCode(code: string, via: "manual" | "prefill"): Promise<boolean> {
    setValidating(true);
    try {
      const res = await fetchWithResilience("/api/payment/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, planId: plan.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setDiscountInfo(null);
        if (via === "manual") {
          // v198 — رویداد: رد شدن کد (دلیل دقیق در پنل مدیر دیده می‌شود)
          trackFunnelEvent("discount_rejected", {
            planId: plan.id,
            meta: { reason: String(data.error || "نامعتبر").slice(0, 120), code: code.slice(0, 20) },
            force: true,
          });
          toast.error(data.error || "کد تخفیف نامعتبر است");
        }
        return false;
      }
      // FIX: کد اختصاصی تمدید که کاربر دستی تایپ کرده — مثل مسیر prefill، به‌عنوان
      // userDiscountCode به checkout ارسال می‌شود تا سمت سرور از جدول درست اعمالش کند.
      setUserDiscountCode(data.isUserCode ? data.code : "");
      setDiscountCode(data.code);
      setDiscountInfo({
        valid: true,
        discountValue: data.discountValue,
        finalAmount: data.finalAmount,
        label: data.discountLabel,
      });
      // v198 — رویداد: کد اعمال شد
      trackFunnelEvent("discount_applied", {
        planId: plan.id,
        amount: data.finalAmount,
        meta: { via, code: data.code },
        force: true,
      });
      toast.success(`کد اعمال شد! ${data.discountLabel}`);
      return true;
    } catch {
      if (via === "manual") toast.error("خطا در بررسی کد تخفیف");
      return false;
    } finally {
      setValidating(false);
    }
  }

  async function validateDiscount() {
    if (!discountCode.trim()) {
      toast.error("کد تخفیف را وارد کنید");
      return;
    }
    // v198 — رویداد: تلاش دستی کد تخفیف (دقیقاً همان‌جایی که Clarity گفت
    // کاربر با پیام «کد منقضی شده» کانال می‌شود)
    trackFunnelEvent("discount_attempted", {
      planId: plan.id,
      meta: { via: "manual" },
      force: true,
    });
    if (!isLoggedIn) {
      toast.info("برای استفاده از کد تخفیف ابتدا وارد شوید");
      onNeedLogin();
      return;
    }
    await applyDiscountCode(discountCode, "manual");
  }

  // ═══ v212 — پرپرایم خودکار کد تخفیف اختصاصیِ پیامکی در همهٔ مدال‌های خرید ═══
  // دیرکتیو مالک: «دقت کن که برای تخفیف همه پیامکهای تخفیف در اپ کافه بازار هم
  // درست باشه». تا حالا فقط صفحهٔ پلن‌ها کد اختصاصی را پیش‌اعمال می‌کرد
  // (prefillUserDiscountCode)؛ مدال باز‌شده از لندینگ/تحلیل/اسپات‌لایت — و
  // مخصوصاً اپ کافه‌بازار — کدِ استفاده‌نشدهٔ پیامکی (خوش‌آمدگویی 612964 /
  // وین‌بک آنبوردینگ 461291 / تمدید 883325 و 604678) را ندید و کاربر با قیمت
  // کامل می‌رفت. حالا: اگر هیچ prefill ای نبود، کد فعالِ کاربر از
  // GET /api/user-discount-code خوانده و با همان اعتبارسنجی رسمی سرور اعمال
  // می‌شود → تخفیف در مودال دیده می‌شود و به JWT تخفیف پویای بازار می‌رسد
  // (همان رفتار صفحهٔ پلن‌ها — حالا همه‌جا و در همهٔ منابع ورود).
  // بی‌خطر: بدون کد فعال هیچ‌کاری نمی‌کند؛ خطا بی‌صدا رد می‌شود و هرگز خرید را
  // بلاک نمی‌کند؛ با prefill دستیِ صفحهٔ پلن‌ها و کد عمومی پیش‌پرشده تداخل ندارد.
  useEffect(() => {
    if (prefillUserDiscountCode || prefillDiscountCode) return;
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithResilience(
          "/api/user-discount-code",
          { cache: "no-store" },
          { timeoutMs: 10_000, retries: 0 }
        );
        if (!res.ok) return;
        const info = await res.json();
        if (cancelled) return;
        const code = typeof info?.code === "string" ? info.code.trim() : "";
        if (code && info?.isUsed !== true && (info?.value ?? 0) > 0) {
          await applyDiscountCode(code, "prefill");
        }
      } catch {
        // بهترین‌تلاش — پرپرایم هرگز جریان خرید را بلاک نمی‌کند
      }
    })();
    return () => {
      cancelled = true;
    };
    // وابستگی‌ها عمداً فقط isLoggedIn است — applyDiscountCode و پراپ‌های
    // prefill پایدارند و نباید اجرای دوبارهٔ پرپرایم را بسازند
  }, [isLoggedIn]);

  // ─── v197 — دو گزینهٔ پرداخت اینستاگرام (دیرکتیو مالک) ───
  // «برای پرداخت اینستا دو گزینه بذار یکی همین ارسال لینک پرداخت امن و یکی
  //  هم رفتن به درگاه پرداخت که معماری دکمه باید دقیقاً عین معماری دکمهٔ
  //  رفتن به درگاه پرداخت در اپ خودمون باشه»:
  //   گزینه ۱ (پیامک امن): فلوی قبلی v171 — لینک پیامکی → مرورگر گوشی
  //   گزینه ۲ (درگاه): دقیقاً معماری دکمهٔ درگاه اپ — دکمهٔ پرداخت →
  //     ایجاد پرداخت → صفحهٔ میانی /pay/{authority} → درگاه زرین‌پال؛
  //     زیر همان متن «با وی‌پی‌ان خاموش…» که در اپ هم آنجاست
  async function startCheckout(igDelivery: "sms" | "gateway" = "sms") {
    if (!isLoggedIn) {
      toast.info("برای خرید ابتدا وارد شوید");
      onNeedLogin();
      return;
    }
    // ═══ v198 — رویداد: کلیک روی دکمهٔ پرداخت (مرحلهٔ کلیدی قیف) ═══
    trackFunnelEvent("checkout_clicked", {
      planId: plan.id,
      amount: finalAmount,
      meta: {
        delivery: igDelivery,
        method: paymentMethod,
        bazaarApp: inBazaarApp,
        source: entrySource,
      },
      force: true,
    });
    // ─── چک آنبوردینگ ───
    // اگر کاربر لاگین کرده ولی آنبوردینگ را تکمیل نکرده، به صفحه آنبوردینگ هدایت کن.
    if (user?.onboardingDone !== true) {
      toast.info("برای خرید پلن، ابتدا اطلاعات آنبوردینگ خود را تکمیل کنید");
      setScreen("onboarding");
      return;
    }
    // ─── T11: اپ کافه‌بازار — پرداخت پیش‌فرض از درگاه درون‌برنامه‌ای بازار ───
    // طبق قانون انتشار بازار، فروش اشتراک دیجیتال در اپ بازار از IAB بازار است.
    // ═══ v212 (دیرکتیو جدید مالک): گزینهٔ «کیف پول فیتاپ» به مدال پرداخت بازار
    // برگردانده شد — انتخاب کیف پول → همان فلوی عادی checkout (کسر از موجودی،
    // بدون درگاه)؛ روش پیش‌فرض (درگاه) → IAP بازار. کد تخفیف/تخفیف تحلیل در هر
    // دو مسیر سمت سرور محاسبه می‌شود (هم‌ترازی کامل v207/v211 حفظ شده است).
    if (inBazaarApp && paymentMethod !== "wallet") {
      await startBazaarCheckout();
      return;
    }
    await runNormalCheckout(igDelivery);
  }

  /**
   * v112 — فلوی عادی checkout (زرین‌پال / کیف پول) — از startCheckout و از
   * فال‌بکِ «فعال‌سازی رایگان» در اپ کافه‌بازار صدا زده می‌شود.
   * v135 — انتقال فوری: اگر درگاه برگردد، همان لحظه به gatewayUrl می‌رویم
   * (دیگر هیچ مرحلهٔ میانی «رفتن به درگاه» وجود ندارد).
   * v197 — igDelivery: تحویل پرداخت در اینستاگرام — "sms" = لینک امن پیامکی
   * (پیش‌فرض/گزینهٔ ۱) یا "gateway" = انتقال مستقیم به درگاه مثل اپ و وب
   * (گزینهٔ ۲ — ریشه‌کنی کاهش فروش: کاربر بدون خروج از اینستاگرام پرداخت می‌کند).
   */
  async function runNormalCheckout(igDelivery: "sms" | "gateway" = "sms") {
    setLoading(true);
    try {
      // v148 — fetch تاب‌آور: تایم‌اوت ۱۲ثانیه‌ای + یک تلاش دوباره با اتصال
      // «کاملاً تازه». قبلاً بعد از سوئیچ VPN مرورگر سوکت keep-alive مُرده را
      // دوباره استفاده می‌کرد و fetch تا ابد آویزان می‌شد → دکمه برای همیشه
      // «در حال ایجاد پرداخت…» می‌ماند (mode هواپیما چون سوکت‌ها را می‌بست
      // «درستش» می‌کرد). payload/مسیر سرور دست‌نخورده مانده است.
      // ═══ v174 — پل native پرداخت (فقط اپ اختصاصی + درگاه زرین‌پال) ═══
      // قبل از هر درخواستِ WebView: اگر پل native موجود است، کار را به او می‌سپاریم
      // تا درخواست‌ها با استک جاوا (مستقل از سوکت‌های مردهٔ WebView) زده شوند.
      // گاردها:
      //  • فقط اپ اختصاصی (entrySource === "app_android") — بازار/اینستاگرام/وب دست‌نخورده
      //  • فقط روش درگاه ("gateway") — کیف پول مسیر خودش را دارد
      //  • فقط کاربر لاگین — مهمان همان مسیر قبلی (پیام ورود)
      //  • native یک‌بار شکست خورد → کل این سشن از پل صرف‌نظر (فال‌بک وب)
      //
      // ═══ v176 — کد تخفیف هم از پل native می‌رود (پوشش کامل تمدید/ارتقا) ═══
      // قبلاً هر حالتِ دارای کد تخفیف از پل صرف‌نظر می‌کرد (v174 native فقط
      // planId می‌فرستاد) — یعنی تمدیدِ کدتخفیفی (رایج‌ترین حالت تمدید) به فال‌بک
      // وب می‌رفت. حالا: متد جدید startPaymentNativeWithCode(planId, discountCode,
      // userDiscountCode) کد را هم می‌فرستد — اعتبارسنجی همچنان ۱۰۰٪ سمت سرور
      // است (مالکیت/استفاده/انقضا/کد نمایشی ۲۴۸۹۴۵)، native فقط منتقل می‌کند.
      // ارجحیت مطابق فلو وب/سرور: کد اختصاصی بر کد عمومی. اپ‌های قدیمی‌تر
      // (1.13.0 و پایین‌تر) این متد را ندارند → typeof گارد → همان رفتار قبلی
      // (کدتخفیفی‌ها فال‌بک وب — بدون هیچ رگرسیون).
      const hasNativeGeneralCode = !!(discountInfo?.valid && !userDiscountCode && discountCode?.trim());
      const hasNativeUserCode = !!(discountInfo?.valid && !!userDiscountCode);
      if (
        entrySource === "app_android" &&
        paymentMethod === "gateway" &&
        isLoggedIn &&
        !nativePaymentBridgeFailed &&
        // v197 — تخفیف ۱۰٪ صفحهٔ تحلیل: پل native هنوز توکن را منتقل نمی‌کند →
        // فال‌بک وب تا تخفیف قطعاً اعمال شود (وب تاب‌آور است — v148)
        !activeAnalysisDiscount
      ) {
        try {
          const native = (
            window as unknown as {
              FitUpNative?: {
                startPaymentNative?: (planId: string) => boolean;
                startPaymentNativeWithCode?: (
                  planId: string,
                  discountCode: string,
                  userDiscountCode: string
                ) => boolean;
              };
            }
          ).FitUpNative;
          let handled = false;
          if (hasNativeUserCode && typeof native?.startPaymentNativeWithCode === "function") {
            // کد اختصاصی کاربر (تمدید / کد شخصی / کد نمایشی ۲۴۸۹۴۵) — فیلد userDiscountCode فلو وب
            handled = native.startPaymentNativeWithCode(plan.id, "", userDiscountCode);
          } else if (hasNativeGeneralCode && typeof native?.startPaymentNativeWithCode === "function") {
            // کد عمومی دستی کاربر — فیلد discountCode فلو وب
            handled = native.startPaymentNativeWithCode(plan.id, (discountCode || "").trim(), "");
          } else if (!hasNativeUserCode && !hasNativeGeneralCode && typeof native?.startPaymentNative === "function") {
            // بدون کد — همان مسیر v174 (همهٔ نسخه‌های اپ دارند)
            handled = native.startPaymentNative(plan.id); // plan.id رشته است — بدون تبدیل
          }
          if (handled === true) {
            // native کار را گرفت (Custom Tab را خودش باز می‌کند) — قفل موقت دکمه:
            // v198 — رویداد: انتقال به درگاه از پل native اپ
            trackFunnelEvent("gateway_redirecting", {
              planId: plan.id,
              amount: finalAmount,
              meta: { via: "native_bridge" },
              force: true,
            });
            setRedirecting(true);
            window.setTimeout(() => setRedirecting(false), 12_000);
            // 🆕 اگر native وسط کار شکست خورد (سرور down/شبکه)، فوراً دکمه را
            // آزاد کن + این سشن از پل صرف‌نظر شود (کلیک دوباره = جریان قبلی وب)
            const onNativePaymentFail = () => {
              window.removeEventListener("fitup:native-payment-failed", onNativePaymentFail);
              if (nativePaymentFailCleanupTimer != null) {
                window.clearTimeout(nativePaymentFailCleanupTimer);
                nativePaymentFailCleanupTimer = null;
              }
              nativePaymentBridgeFailed = true;
              setRedirecting(false);
              toast.error("ارتباط با درگاه پرداخت برقرار نشد — لطفاً دوباره تلاش کنید.");
            };
            window.addEventListener("fitup:native-payment-failed", onNativePaymentFail);
            // پاکسازی لیسنر اگر native هیچ‌وقت جواب نداد (مثلاً ساکن در دیالوگ VPN)
            nativePaymentFailCleanupTimer = window.setTimeout(() => {
              window.removeEventListener("fitup:native-payment-failed", onNativePaymentFail);
              nativePaymentFailCleanupTimer = null;
            }, 30_000);
            return;
          }
        } catch (e) {
          // بی‌صدا رد شو — جریان عادی ادامه پیدا می‌کند
          console.warn("[native-payment] bridge failed, falling back", e);
        }
      }
      // ↓ جریان فعلی — دست‌نخورده
      const res = await fetchWithResilience("/api/payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          paymentMethod,
          discountCode: discountInfo?.valid && !userDiscountCode ? discountCode : undefined,
          userDiscountCode: discountInfo?.valid && userDiscountCode ? userDiscountCode : undefined,
          // v197 — تخفیف ۱۰٪ صفحهٔ تحلیل (سرور اعتبار/تک‌مصرفی را قضاوت می‌کند)
          analysisDiscountToken: activeAnalysisDiscount?.token || undefined,
          // v214 — سشن قیف: رویداد سروری checkout_created به سشن کلاینت وصل شود
          sessionId: getFunnelSessionId(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "INSUFFICIENT_WALLET") {
          toast.error(data.error);
          setPaymentMethod("gateway");
          return;
        }
        // T12: گارد سرور هم آنبوردینگ را چک می‌کند — هدایت به آنبوردینگ
        if (data.code === "ONBOARDING_REQUIRED") {
          toast.info(data.error || "برای خرید پلن، ابتدا آنبوردینگ را تکمیل کنید");
          setScreen("onboarding");
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
      // v200 — شفافیت تخفیف صفحهٔ تحلیل: اگر مودال انتظار تخفیف داشت ولی سرور
      // اعمال نکرد (توکن منقضی/ابطال‌شده/مصرف‌شده در درخواست موازی)، کاربر
      // همان‌جا پیام روشن می‌گیرد — نه با دیدن مبلغ کامل در درگاه (دیرکتیو:
      // «همهٔ کد تخفیف‌ها دقیق و درست اعمال بشن»). در مسیر reused و
      // فعال‌سازی رایگان (مبلغ صفر) پیامی نیست.
      if (activeAnalysisDiscount && data.analysisDiscountApplied === false && data.finalAmount > 0) {
        toast.info("مهلت تخفیف صفحهٔ تحلیل تمام شده بود و در این خرید اعمال نشد.");
        // v229 ممیزی ۱۹-a#۵ — توکن هیدریت‌شده مرده است؛ پاک شود تا ادامهٔ مودال واقعی باشد
        if (!analysisDiscount) setServerAnalysisDiscount(null);
      }
      if (paymentMethod === "wallet") {
        // FE-C2: مقادیر fresh را مستقیم پاس بده — setPaymentData در همین tick
        // هنوز در closure فعلی قابل مشاهده نیست و بدون override،
        // completePayment با paymentData===null بی‌صدا return می‌کرد.
        await completePayment("OK", data.paymentId, data.authority);
      } else if (data.directActivation || (data.finalAmount === 0 && !data.gatewayUrl)) {
        // ═══ v112 — فعال‌سازی رایگان (کد تخفیف ۱۰۰٪ / اعتبار ارتقای کامل) ═══
        // هیچ درگاهی وجود ندارد — مستقیم verify می‌زنیم تا دکمهٔ پرداخت
        // همه‌چیز را فعال کند (بدون درگاه و بدون صفحات میانی). برای اینستاگرام
        // هم همین است — پیامک فقط برای مبلغ مثبت معنا دارد (سند).
        await completePayment("OK", data.paymentId, data.authority);
      } else if (data.gatewayUrl) {
        // ═══ v171 — مسیریابی بر اساس منبع ورود (سند بازطراحی) ═══
        if (entrySource === "instagram" && paymentMethod === "gateway" && igDelivery === "sms") {
          // اینستاگرام — گزینهٔ ۱ (ارسال لینک پرداخت امن): هرگز داخل مرورگر
          // درون‌اپی به درگاه نمی‌رویم — لینک به شمارهٔ کاربر پیامک می‌شود
          try {
            await sendPaymentLinkSms(data.paymentId);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "ارسال پیامک ناموفق بود.");
          }
          return;
        }
        // v197 — اینستاگرام با igDelivery="gateway" و همچنین وب و اپ اختصاصی
        // (فال‌بک پل) از این‌جا به پایین مشترک‌اند: انتقال فوری به درگاه —
        // دقیقاً همان معماری دکمهٔ درگاه اپ (مودال پرداخت → صفحهٔ میانی
        // /pay/{authority} → StartPay زرین‌پال).
        if (entrySource === "app_android") {
          // اپ اختصاصی: پل Custom Tabs (شکست پل → فال‌بک به مسیر قبلی)
          const bridged = await startAppBridge(data.paymentId);
          if (bridged) return;
        }
        // ═══ v135 — انتقال فوری به درگاه (وب — دقیقاً مثل قبل) ═══
        // 🔧 v129 (دیرکتیو مالک): هیچ چک VPN قبل از ناوبری؛ داور نهایی خودِ
        // زرین‌پال است. 🩹 v45: قفل ۱۲ثانیه‌ای + آزادسازی با pageshow/
        // visibilitychange تا دکمه هرگز برای همیشه مرده نماند.
        // v198 — رویداد: انتقال به درگاه (شاخهٔ درگاه قیف)
        trackFunnelEvent("gateway_redirecting", {
          planId: plan.id,
          amount: finalAmount,
          meta: { via: entrySource === "app_android" ? "custom_tabs_fallback" : "web" },
          force: true,
        });
        setRedirecting(true);
        window.setTimeout(() => setRedirecting(false), 12_000);
        window.location.href = data.gatewayUrl;
      } else {
        // ═══ v197 — فیکس بن‌بست سکوت (ریشهٔ «کلیک ۲-۵ بار بدون پرداخت») ═══
        // قبلاً اگر checkout پاسخ reused با gatewayUrl:null می‌داد (authority
        // زرین‌پال در تلاش قبلی ساخته نشده بود)، هیچ شاخه‌ای اجرا نمی‌شد و
        // کاربر بدون هیچ پیامی می‌ماند و چند بار بی‌نتیجه کلیک می‌کرد. حالا
        // پیام روشن: کلیک دوباره روی پرداخت باعث می‌شود سرور (dedupe) برای
        // همان پرداخت authority تازه بسازد.
        // v198 — رویداد: بن‌بست ایجاد پرداخت (درگاه null) — دقیقاً همان ریشهٔ
        // «لینک را باز کرد، ۲-۵ بار کلیک کرد، نخرید»
        trackFunnelEvent("checkout_deadend", {
          planId: plan.id,
          amount: finalAmount,
          meta: { reason: "gateway_null" },
          force: true,
        });
        toast.error(
          "درگاه پرداخت آماده نشد — چند لحظه بعد دوباره روی دکمهٔ پرداخت بزنید."
        );
      }
    } catch (e) {
      // v148 — شکست نهایی شبکه: loading در finally ریست می‌شود و کاربر در
      // همان مودال می‌ماند — فشار دوبارهٔ دکمه یک «درخواست تازه» با اتصال
      // جدید می‌سازد (دقیقاً همان چیزی که حالت سوکت مُرده را اَن‌استاک می‌کند).
      // v198 — رویداد: خطای شبکه/سرور هنگام ایجاد پرداخت
      trackFunnelEvent(
        e instanceof NetworkFetchError ? "checkout_network_error" : "checkout_deadend",
        {
          planId: plan.id,
          amount: finalAmount,
          meta: { reason: e instanceof Error ? e.message.slice(0, 120) : "unknown" },
          force: true,
        }
      );
      if (e instanceof NetworkFetchError) {
        toast.error("ارتباط با سرور برقرار نشد — لطفاً چند لحظه بعد دوباره روی پرداخت بزنید.");
      } else {
        toast.error(e instanceof Error ? e.message : "خطا در ایجاد پرداخت");
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * T11: خرید از طریق پرداخت درون‌برنامه‌ای کافه‌بازار (پولکی).
   *
   * اپ اندروید (WebView) پل window.fitupBazaarPurchase(sku, payload, dynamicPriceToken)
   * را فراهم می‌کند:
   *  ۱. اگر تخفیف/اعتبار ارتقا/تخفیف تحلیل هست، سرور یک JWT یکبارمصرفِ «تخفیف
   *     پویا» بازار با کلید امضای پیشخان می‌سازد (/api/payment/bazaar/dynamic-price
   *     — فلوی رسمی v209: payload = price ریال + package_name + sku + exp + nonce)
   *     و JWT به اپ پاس می‌شود
   *  ۲. اپ همان JWT را در PurchaseRequest(dynamicPriceToken=…) به پولکی می‌دهد —
   *     درگاه پرداخت بازار با همان مبلغ دقیقِ تخفیف‌دار باز می‌شود
   *  ۳. نتیجه (purchaseToken + orderId) به همین تابع برمی‌گردد
   *  ۴. برای فعال‌سازی اشتراک به /api/payment/bazaar/purchase ارسال می‌شود
   *     (سرور خرید را با Developer API بازار راستی‌آزمایی می‌کند)
   *
   * SKU محصولات بازار: fitup_{planId} — در پیشخان بازار با همین شناسه تعریف می‌شوند.
   */
  async function startBazaarCheckout() {
    const sku = `fitup_${plan.id}`;
    // v198 — رویداد: شروع پرداخت درون‌برنامه‌ای بازار
    trackFunnelEvent("bazaar_iap_started", { planId: plan.id, amount: finalAmount, force: true });
    setLoading(true);
    try {
      // ═══ v229 — پیش‌آزمایی اتصال پرداخت بازار (پل isPaymentAvailable — تا امروز بی‌مصرف بود) ═══
      // به‌جای «خطای بعد از کلیک»، همین اول پیام روشن می‌گیرد: بازار را باز/وارد شوید.
      try {
        const nativePrecheck = (window as unknown as { FitUpNative?: { isPaymentAvailable?: () => boolean } }).FitUpNative;
        if (
          typeof nativePrecheck?.isPaymentAvailable === "function" &&
          !nativePrecheck.isPaymentAvailable()
        ) {
          trackFunnelEvent("bazaar_iap_failed", {
            planId: plan.id,
            meta: { reason: "payment_unavailable_precheck" },
            force: true,
          });
          toast.error(
            "اتصال به پرداخت کافه‌بازار برقرار نیست — برنامهٔ کافه‌بازار را باز کنید، وارد حساب شوید و دوباره تلاش کنید."
          );
          return;
        }
      } catch {
        // پل موجود نیست (نسخهٔ قدیمی اپ) — مثل قبل ادامه
      }
      // ─── قیمت پویا (تخفیف/اعتبار ارتقا/تخفیف تحلیل) — اگر هست، مبلغ دقیق در بازار ثبت می‌شود ───
      // ═══ v207 — fail-closed: اگر تخفیفی در کار است، خرید هرگز بی‌صدا با قیمت کامل
      // ادامه پیدا نمی‌کند (دیرکتیو مالک: «تخفیف‌ها حتماً اعمال بشن»). یک retry شفاف
      // هم برای خطاهای گذرا (۸۰۰ms) — کاربر فقط در شکست واقعی پیام روشن می‌بیند.
      // ═══ v211 — ضد خطای «اطلاعات ارسالی برنامه برای پرداخت نامعتبر است»:
      // ① skuPrice (رشتهٔ قیمت واقعی SKU از خودِ بازار) به سرور می‌رود تا مبلغ JWT
      //    از سقف واقعی پیشخان ساخته شود نه حدس واحد تومان×۱۰ (ضد خطای ۱۰).
      // ② گیت نسخهٔ بازار: تخفیف پویا فقط در بازار ۱۳.۳.۰+ کار می‌کند — پایین‌تر
      //    مستقیم با قیمت پایه و اطلاعِ شفاف در مودال ادامه می‌دهیم.
      // ③ اگر بازار JWT را رد کرد (purchaseFailed با توکن)، نشست به فال‌بک مرئی
      //    می‌رود: مودال با مبلغ واقعی به‌روز می‌شود و کاربر خودش ادامه می‌دهد —
      //    هرگز قیمت کامل بی‌صدا نیست (قانون v207) و خرید هم کور نمی‌شود.
      let dynamicPriceToken: string | null = null;
      const dpCall = () =>
        fetchWithResilience("/api/payment/bazaar/dynamic-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.id,
            discountCode: discountInfo?.valid && !userDiscountCode ? discountCode : undefined,
            userDiscountCode: discountInfo?.valid && userDiscountCode ? userDiscountCode : undefined,
            // v207 — توکن تخفیف صفحهٔ تحلیل (قبلاً به این مسیر نمی‌رفت و در اپ بازار
            // ده‌درصدیِ UI در درگاه اعمال نمی‌شد — عین باگ مالک)
            analysisDiscountToken: activeAnalysisDiscount?.token || undefined,
            // v211 — رشتهٔ قیمت واقعی SKU از خود بازار (Poolakey getSkuDetails)
            skuPrice: bazaarSkuPriceStr || undefined,
          }),
        });
      // آیا کاربر حق دارد تخفیف ببیند؟ (کد معتبر یا توکن تحلیل زنده یا اعتبار ارتقا)
      // ═══ v229 ممیزی ۱۹-a#۲ — اعتبار ارتقا هم به expectDiscount اضافه شد: قبلاً
      // کاربرِ ارتقاییِ بازار-قدیمی با قیمت کاملِ SKU پرداخت می‌کرد در حالی که سرور
      // paidAmount را با کسر اعتبار ثبت می‌کرد (ناهم‌خوانی حسابداری + ضرر بی‌صدای کاربر)
      const expectDiscount =
        Boolean(activeAnalysisDiscount?.token) ||
        Boolean(upgradeEstimate?.isUpgrade && (upgradeEstimate.upgradeCredit ?? 0) > 0) ||
        Boolean(discountInfo?.valid && (userDiscountCode?.trim() || discountCode?.trim()));
      // v211 — گیت‌های سمت اپ: نسخهٔ بازار / رد قبلی JWT در همین مودال
      const dynamicPossible = bazaarVersionOk !== false && !bazaarDynamicBlocked;
      if (!dynamicPossible) {
        // ═══ v229 — دیرکتیو مالک ═══
        // کاربرِ تخفیف‌دارِ بازار-قدیمی دیگر با «قیمت کامل» ادامه نمی‌دهد؛ پیام
        // بروزرسانی می‌گیرد و پرداخت متوقف می‌شود. بعد از بروزرسانی (اپ/بازار)
        // تخفیف حفظ می‌ماند (توکن سرور + hydrate مدال) و خرید با تخفیف کامل می‌شود.
        // ═══ v229 ممیزی ۱۹-b#۲ — بازارِ به‌روزِ بلاک‌شده (ردِ گذرای قبلی JWT) پیام
        // درست «تلاش مجدد» می‌گیرد، نه «بروز کنید» — و بلاک آزاد می‌شود تا retry واقعاً کار کند.
        if (expectDiscount) {
          if (bazaarVersionOk === false) {
            const updateMsg = "لطفاً برنامه را بروز کنید تا تخفیف شما اعمال شود.";
            setBazaarDynamicNote(updateMsg);
            toast.error(updateMsg);
            trackFunnelEvent("bazaar_update_prompted", {
              planId: plan.id,
              meta: { reason: "bazaar_version_lt_1330" },
              force: true,
            });
          } else {
            setBazaarDynamicNote(
              "ثبت لحظه‌ای قیمت تخفیف‌دار در کافه‌بازار ناموفق بود — تخفیف شما محفوظ است؛ چند لحظه بعد دوباره تلاش کنید."
            );
            setBazaarDynamicBlocked(false); // ردِ گذرا — تلاش بعدی دوباره قیمت پویا را می‌سازد
            toast.info("ثبت قیمت تخفیف‌دار موقتاً ناموفق بود — چند لحظه بعد دوباره تلاش کنید. تخفیف شما محفوظ است.");
          }
          return;
        }
        setBazaarDynamicNote(
          "ثبت مبلغ تخفیف‌دار در کافه‌بازار ممکن نشد — با مبلغ کامل پلن ادامه می‌دهید."
        );
        trackFunnelEvent("bazaar_iap_dynamic_skipped", {
          planId: plan.id,
          meta: { reason: bazaarVersionOk === false ? "bazaar_version_lt_1330" : "jwt_rejected_earlier" },
          force: true,
        });
      } else {
        let dpRes: Awaited<ReturnType<typeof fetchWithResilience>> | null = null;
        let dpData: Record<string, unknown> | null = null;
        for (let dpAttempt = 0; dpAttempt < 2; dpAttempt++) {
          try {
            dpRes = await dpCall();
            dpData = (await dpRes.json().catch(() => ({}))) as Record<string, unknown>;
          } catch {
            dpRes = null;
            dpData = null;
          }
          if (dpRes?.ok) break;
          if (dpAttempt === 0) await new Promise((r) => setTimeout(r, 800)); // retry شفاف یک‌بار
        }
        // ═══ v112 — فعال‌سازی رایگان: بازار نمی‌تواند مبلغ صفر پردازش کند ═══
        if (dpData?.freeActivation === true) {
          await runNormalCheckout();
          return;
        }
        // ═══ v209 — فیلد توکن: سرور حالا JWT یکبارمصرفِ تخفیف پویا (فلوی رسمی
        // بازار) را در dynamicPriceToken برمی‌گرداند؛ فیلد قدیمی dynamicPriceId
        // هم برای سازگاری همان مقدار را دارد — هر دو این‌جا خوانده می‌شوند.
        if (dpRes?.ok && typeof dpData?.dynamicPriceToken === "string" && dpData.dynamicPriceToken) {
          dynamicPriceToken = dpData.dynamicPriceToken;
        } else if (dpRes?.ok && typeof dpData?.dynamicPriceId === "string" && dpData.dynamicPriceId) {
          dynamicPriceToken = dpData.dynamicPriceId;
        }
        // ═══ v207 — fail-closed: تخفیف انتظار می‌رفت ولی قیمت تخفیف‌دار ثبت نشد ═══
        // (خطای سرور ۵۰۳/۴۰۰ با پیام فارسی، یا سرور قدیمی که ۲۰۰+token:null
        // می‌داد — هر دو این‌جا متوقف می‌شوند؛ هیچ‌وقت قیمت کامل بی‌صدا نیست.
        // شرط دوم هم خطای صریح سرور را می‌گیرد — مثلاً اعتبار ارتقا که کلاینت
        // از آن خبر ندارد ولی سرور در محاسبه تخفیف دیده است.)
        if (!dynamicPriceToken && (expectDiscount || (dpRes && !dpRes.ok))) {
          const dpReason = String(dpData?.reason || (dpRes ? `http_${dpRes.status}` : "network"));
          // ═══ v229 ممیزی ۱۹-a#۵ — خودترمیمی توکن هیدریت‌شدهٔ مرده: اگر سرور گفت
          // توکن تحلیل نامعتبر است، state هیدریشن پاک می‌شود تا تلاش بعدی مودال
          // (بدون بستن/بازکردن) با وضعیت واقعی ادامه دهد.
          if (dpReason.includes("analysis_token")) {
            setServerAnalysisDiscount(null);
          }
          trackFunnelEvent("bazaar_iap_failed", {
            planId: plan.id,
            meta: { reason: `dynamic_price_blocked:${dpReason}`.slice(0, 120) },
            force: true,
          });
          throw new Error(
            (typeof dpData?.error === "string" && dpData.error) ||
              "ثبت قیمت تخفیف‌دار در کافه‌بازار ناموفق بود — پرداخت متوقف شد تا تخفیف شما از دست نرود. لطفاً چند لحظه بعد دوباره تلاش کنید."
          );
        }
        // dynamicPriceId=null و تخفیفی در کار نبود → قیمت پایه SKU (رفتار عادی)
      }

      const purchase = await (window as any).fitupBazaarPurchase(
        sku,
        { planId: plan.id, userId: user?.id || null },
        dynamicPriceToken
      );
      if (!purchase?.ok) {
        if (purchase?.canceled) {
          // v198 — رویداد: لغو پرداخت بازار (سنجهٔ مهم ریزش فروش بازار)
          // v229 — دلیل لغو در meta ثبت می‌شود (قبلاً meta خالی بود)
          trackFunnelEvent("bazaar_iap_canceled", {
            planId: plan.id,
            meta: { reason: "user_canceled" },
            force: true,
          });
          toast.info(purchase.error || "پرداخت لغو شد");
          // v229 — بعد از لغو بن‌بست نیست: تخفیف محفوظ است و تلاش مجدد با همان تخفیف
          if (activeAnalysisDiscount) {
            setBazaarDynamicNote(
              "پرداخت لغو شد — تخفیف شما همچنان فعال است؛ هر وقت آماده بودید دوباره تلاش کنید."
            );
          }
        } else {
          // v198 — رویداد: شکست پرداخت بازار
          trackFunnelEvent("bazaar_iap_failed", {
            planId: plan.id,
            meta: { reason: String(purchase?.error || "unknown").slice(0, 120) },
            force: true,
          });
          // ═══ v211 — رد JWT تخفیف پویا توسط بازار («اطلاعات ارسالی برنامه برای
          // پرداخت نامعتبر است») → فال‌بک مرئی به قیمت پایه: مودال با مبلغ واقعی
          // به‌روز می‌شود، توکن دیگر فرستاده نمی‌شود و کاربر خودش ادامه می‌دهد —
          // نه خرید کور، نه قیمت کامل بی‌صدا.
          if (dynamicPriceToken) {
            setBazaarDynamicBlocked(true);
            // ═══ v229 — دیرکتیو مالک + ممیزی ۱۹-a#۴/۱۹-b#۲: پیام بر اساس علت واقعی —
            // ① بازار قدیمی + تخفیف → «بروز کنید» ② بازار به‌روز (رد گذرای JWT) → «تلاش مجدد»
            // ③ بدون تخفیف → فال‌بک مرئی قبلی با قیمت کامل
            if (expectDiscount && bazaarVersionOk === false) {
              setBazaarDynamicNote("لطفاً برنامه را بروز کنید تا تخفیف شما اعمال شود.");
              toast.error("لطفاً برنامه را بروز کنید تا تخفیف شما اعمال شود.");
              trackFunnelEvent("bazaar_update_prompted", {
                planId: plan.id,
                meta: { reason: "jwt_rejected_old_bazaar" },
                force: true,
              });
            } else if (expectDiscount) {
              setBazaarDynamicNote(
                "ثبت لحظه‌ای قیمت تخفیف‌دار در کافه‌بازار ناموفق بود — تخفیف شما محفوظ است؛ چند لحظه بعد دوباره تلاش کنید."
              );
              setBazaarDynamicBlocked(false); // ردِ گذرا — تلاش بعدی دوباره قیمت پویا را می‌سازد
              toast.info("ثبت قیمت تخفیف‌دار موقتاً ناموفق بود — چند لحظه بعد دوباره تلاش کنید. تخفیف شما محفوظ است.");
            } else {
              setBazaarDynamicNote(
                "ثبت مبلغ تخفیف‌دار در کافه‌بازار پذیرفته نشد. می‌توانید با مبلغ کامل پلن ادامه دهید — مبلغ دقیق در همین مودال نمایش داده می‌شود."
              );
            }
          }
          toast.error(purchase?.error || "پرداخت درون‌برنامه‌ای بازار ناموفق بود");
        }
        return;
      }
      // فعال‌سازی اشتراک در سرور — v55: امضای خرید (originalJson+signature) هم
      // همراه می‌رود تا اگر API بازار در دسترس نبود، سرور با کلید RSA پنل،
      // امضای خرید را محلی راستی‌آزمایی کند.
      const res = await fetchWithResilience("/api/payment/bazaar/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          productId: purchase.productId || sku,
          purchaseToken: purchase.purchaseToken,
          orderId: purchase.orderId,
          dataJson: purchase.dataJson,
          signature: purchase.signature,
          // برای ثبت مبلغ واقعی/کد تخفیف در حسابداری (سرور مستقل دوباره محاسبه می‌کند)
          discountCode: discountInfo?.valid && !userDiscountCode ? discountCode : undefined,
          userDiscountCode: discountInfo?.valid && userDiscountCode ? userDiscountCode : undefined,
          // v207 — توکن تخفیف صفحهٔ تحلیل برای مصرف اتمیک سمت سرور (هم‌تراز checkout)
          analysisDiscountToken: activeAnalysisDiscount?.token || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "ONBOARDING_REQUIRED") {
          toast.info(data.error);
          setScreen("onboarding");
          return;
        }
        throw new Error(data.error);
      }
      // ─── Consume محصول مصرفی بازار ───
      // محصولات consumable تا وقتی consume نشوند قابل خرید مجدد نیستند (تمدید).
      try {
        (window as any).FitUpNative?.consumePurchase?.(purchase.purchaseToken);
      } catch {}
      // v160 — تمدید در مسیر بازار هم مثل زرین‌پال: هر خرید بعد از اولین خرید =
      // تمدید → مدال الزامی به‌روزرسانی اطلاعات (دستور مالک)
      try {
        const bazaarFlagKey = `fitup_renewal_info_done_${data.paymentId || purchase.orderId || "bazaar"}`;
        if (
          data.isRenewal &&
          typeof window !== "undefined" &&
          localStorage.getItem(bazaarFlagKey) !== "1"
        ) {
          setRenewalFlagKeyState(bazaarFlagKey);
          setRenewalPrompt(true);
        }
      } catch {}
      toast.success(data.message || "اشتراک شما فعال شد 🎉");
      // رفرش اطلاعات کاربر (باز شدن قابلیت‌های پلن) — الگوی همان completePayment
      try {
        // v156 — تایم‌اوت ۱۰ ثانیه: این fetch قبلاً `finally` کامل پرداخت بازار را
        // گروگان می‌گرفت (آویزانشدن = رسید هرگز نشان داده نمی‌شد)
        const meRes = await fetchWithResilience(
          "/api/auth/me",
          { cache: "no-store" },
          { timeoutMs: 10_000, retries: 0 }
        );
        const meData = await meRes.json();
        if (meData?.user) {
          setUser(meData.user);
        }
      } catch {
        // رفرش اختیاری است
      }
      // نمایش رسید موفق (بدون درگاه — خرید بازار درون‌برنامه‌ای بود)
      setPaymentData({
        paymentId: data.paymentId,
        authority: purchase.purchaseToken,
        gatewayUrl: null as unknown as string,
        simulated: false,
        finalAmount: typeof data.amount === "number" ? data.amount : plan.price,
      });
      // v104 — فیکس ریشه‌ای «مشکل در نشان دادن پلن… تلاش مجدد» بعد از خرید بازار:
      // فیلدهای amount/plan در receipt ست می‌شوند تا رندر رسید هرگز روی
      // undefined کرش نکند.
      setReceipt({
        success: true,
        amount: typeof data.amount === "number" ? data.amount : plan.price,
        plan: data.planLabel || plan.label,
        pendingPrerequisites: data.pendingPrerequisites === true,
        refId: purchase.orderId || purchase.purchaseToken.slice(0, 20),
        message: data.message || "پرداخت درون‌برنامه‌ای کافه‌بازار موفق بود",
        user: undefined,
      });
      setStep("receipt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در پرداخت بازار");
    } finally {
      setLoading(false);
    }
  }

  /**
   * تأیید پرداخت (کیف پول / فعال‌سازی رایگان / مسیر بازار).
   *
   * FE-C2: paymentId/authority را می‌توان مستقیم پاس داد (override) — وقتی
   * completePayment بلافاصله بعد از setPaymentData در همان handler صدا زده
   * می‌شود، state هنوز در closure رندر قبلی است؛ بدون override بی‌صدا return
   * می‌شد و در تلاش دوم پرداختِ قبلی (stale) verify می‌شد.
   */
  async function completePayment(
    status: "OK" | "NOK" | "CANCELLED",
    paymentIdOverride?: string,
    authorityOverride?: string,
  ) {
    const paymentId = paymentIdOverride ?? paymentData?.paymentId;
    const authority = authorityOverride ?? paymentData?.authority;
    if (!paymentId) return;
    setStep("processing");
    try {
      const res = await fetchWithResilience("/api/payment/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          status,
          authority,
        }),
      });
      const data = await res.json();
      // FIX: پاسخ verifying یک message دارد نه error — قبلاً toast خالی می‌داد
      if (!res.ok) throw new Error(data.error || data.message);
      setReceipt(data);
      if (data.success && data.user) {
        setUser(data.user);
        toast.success("پلن شما فعال شد! در حال ساخت برنامه... 🎉");
      }
      // v159 — تمدید همان پلن → مدال الزامی به‌روزرسانی اطلاعات
      try {
        const flagKey = `fitup_renewal_info_done_${data.paymentId || data.refId || "purchase"}`;
        if (
          data.success &&
          data.isRenewal &&
          typeof window !== "undefined" &&
          localStorage.getItem(flagKey) !== "1"
        ) {
          setRenewalFlagKeyState(flagKey);
          setRenewalPrompt(true);
        }
      } catch {}
      setStep("receipt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در تایید پرداخت");
      setStep("form");
    }
  }

  /**
   * v171 — ارسال پیامک «لینک پرداخت امن» برای کاربر اینستاگرام (سند بخش ۲).
   * پرداختِ همینی که checkout ساخته (با همان مبلغ دقیق پلن/تخفیف) به توکن
   * ۲۰دقیقه‌ای گره می‌خورد و لینکش به شمارهٔ کاربر پیامک می‌شود (قالب 744490).
   */
  async function sendPaymentLinkSms(paymentId: string) {
    setSmsSending(true);
    try {
      const res = await fetchWithResilience("/api/payment/instagram/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSmsSent({ phoneMasked: String(data.phoneMasked || ""), link: String(data.link || "") });
        setSmsResendIn(60);
        setSmsLinkCopied(false);
        setStep("sms");
        // v198 — رویداد: نمایش وضعیت پیامک امن (سطح کلاینت؛ خودِ ارسال پیامک
        // سرور رویداد authoritative را ثبت می‌کند)
        trackFunnelEvent("payment_link_shown", { force: true });
        return;
      }
      if (res.status === 429) {
        const wait = Number(data.retryAfterSec) || 60;
        toast.error(`بین دو ارسال ۶۰ ثانیه فاصله لازم است — ${toPersianDigits(String(wait))} ثانیه دیگر تلاش کنید.`);
        return;
      }
      throw new Error(data.error || "ارسال پیامک ناموفق بود.");
    } finally {
      setSmsSending(false);
    }
  }

  /**
   * v171 — پل Custom Tabs برای اپ اختصاصی (سند بخش ۳): پل ۵دقیقه‌ای می‌گیریم و
   * به URL میانی /pay/start می‌رویم — اپ آن را می‌گیرد، VPN را چک می‌کند و
   * Custom Tabs باز می‌کند. اگر پل به هر دلیل شکست خورد، فال‌بک = رفتار قبلی
   * (رفتن مستقیم به gatewayUrl در همان WebView).
   */
  async function startAppBridge(paymentId: string): Promise<boolean> {
    try {
      const res = await fetchWithResilience("/api/payment/bridge-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.url) {
        setRedirecting(true);
        window.setTimeout(() => setRedirecting(false), 12_000);
        window.location.href = String(data.url);
        return true;
      }
    } catch {
      // فال‌بک به مسیر قبلی
    }
    return false;
  }

  function reset() {
    setStep("form");
    setDiscountCode(prefillDiscountCode ?? "");
    setDiscountInfo(null);
    setPaymentData(null);
    setReceipt(null);
    setRenewalPrompt(false);
    setSmsSent(null);
    setSmsResendIn(0);
    setSmsLinkCopied(false);
  }

  function handleClose() {
    if (step === "processing") return;
    reset();
    onClose();
  }

  // ─── v135 — برچسب و آیکون دکمهٔ پرداخت (مدال تک‌مرحله‌ای) ───
  // v171 — منبع اینستاگرام: «ارسال پیامک پرداخت امن» (دقیقاً طبق سند) — بقیه
  // منابع همان «رفتن به درگاه پرداخت» قبلی (دستور مهم ۴ و ۶ سند)
  const isInstagramSource = entrySource === "instagram";
  const payButtonBusy = loading || redirecting;
  let payButtonLabel = "";
  if (smsSending) {
    payButtonLabel = "در حال ارسال پیامک…";
  } else if (payButtonBusy) {
    payButtonLabel = redirecting ? "در حال انتقال به درگاه…" : "در حال ایجاد پرداخت…";
  } else if (!isLoggedIn) {
    payButtonLabel = "برای خرید وارد شوید";
  } else if (finalAmount === 0) {
    payButtonLabel = "فعال‌سازی رایگان";
  } else if (paymentMethod === "wallet") {
    payButtonLabel = `پرداخت ${toPersianDigits(formatToman(finalAmount))} تومان با کیف پول`;
  } else if (inBazaarApp) {
    payButtonLabel = "پرداخت درون‌برنامه‌ای کافه‌بازار";
  } else if (isInstagramSource && paymentMethod === "gateway") {
    payButtonLabel = "ارسال پیامک پرداخت امن";
  } else {
    payButtonLabel = "رفتن به درگاه پرداخت";
  }
  // متن VPN — فقط یک جملهٔ ثابت مشورتی (دیرکتیو مالک v135) — فقط برای درگاه
  // آنلاین زرین‌پال (در اپ بازار پرداخت درون‌برنامه‌ای است و VPN موضوعیت ندارد)
  const showVpnNote = !inBazaarApp && paymentMethod === "gateway" && finalAmount > 0 && isLoggedIn;

  return (
    <Dialog open onOpenChange={handleClose}>
      {/* v44 — max-h + اسکرول داخلی: بدون این، در صفحات کوتاه محتوای فرم خرید
          از ارتفاع viewport بیرون می‌زد و پایین فرم (دکمه پرداخت) دست‌نیافتنی می‌شد */}
      <DialogContent
        dir="rtl"
        showCloseButton={false}
        className="max-w-md bg-white max-h-[90vh] overflow-y-auto custom-scrollbar"
      >
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

        <>
          {step === "form" && (
            <div key="form" className="animate-fade-in space-y-4">
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
                    <Tag className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
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
                  <div className="animate-fade-in-up mt-2 flex items-center gap-2 text-xs text-emerald-600">
                    <CheckCircle2 className="w-4 h-4" />
                    {discountInfo.label} — {toPersianDigits(formatToman(discountInfo.discountValue))} تومان تخفیف
                  </div>
                )}

              </div>

              {/* روش پرداخت */}
              <div>
                <Label className="mb-2 block text-sm text-slate-700">روش پرداخت</Label>
                {/* v212 — در اپ بازار هم دو روش: IAP بازار (پیش‌فرض) + کیف پول فیتاپ
                    (بازگشت به درخواست مالک) — انتخاب کیف پول همان فلوی checkout عادی */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      // v198 — رویداد: انتخاب روش پرداخت
                      setPaymentMethod("gateway");
                      trackFunnelEvent("payment_method_selected", {
                        planId: plan.id,
                        meta: { method: "gateway" },
                      });
                    }}
                    className={`p-3 rounded-2xl border-2 transition text-right ${paymentMethod === "gateway" ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}
                  >
                    <CreditCard className={`w-5 h-5 mb-1.5 ${paymentMethod === "gateway" ? "text-orange-500" : "text-slate-500"}`} />
                    <p className="text-xs font-bold text-slate-900">{inBazaarApp ? "پرداخت درون‌برنامه‌ای" : "پرداخت آنلاین"}</p>
                    <p className="text-[10px] text-slate-500">{inBazaarApp ? "درگاه کافه‌بازار" : "درگاه زرین‌پال"}</p>
                  </button>
                  <button
                    onClick={() => {
                      // v198 — رویداد: انتخاب روش پرداخت
                      setPaymentMethod("wallet");
                      trackFunnelEvent("payment_method_selected", {
                        planId: plan.id,
                        meta: { method: "wallet" },
                      });
                    }}
                    /* v104: با موجودی ناکافی دکمه انتخاب‌پذیر است و فقط دکمهٔ
                       پرداخت وقتی موجودی ناکافی است قفل می‌شود.
                       v212: این گزینه دوباره در اپ کافه‌بازار هم هست (دیرکتیو مالک). */
                    disabled={!isLoggedIn}
                    className={`p-3 rounded-2xl border-2 transition text-right disabled:opacity-50 ${paymentMethod === "wallet" ? "border-orange-500 bg-orange-50" : "border-slate-200"}`}
                  >
                    <Wallet className={`w-5 h-5 mb-1.5 ${paymentMethod === "wallet" ? "text-orange-500" : "text-slate-500"}`} />
                    <p className="text-xs font-bold text-slate-900">کیف پول فیتاپ</p>
                    <p className="text-[10px] text-slate-500">{isLoggedIn ? `${toPersianDigits(formatToman(walletBalance))} ت` : "نیاز به ورود"}</p>
                  </button>
                </div>
                {paymentMethod === "wallet" && isLoggedIn && !canUseWallet && entrySource !== "instagram" && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    موجودی کافی نیست.{" "}
                    <button
                      onClick={() => {
                        // v104 — overlay پروفایل فقط داخل پنل (MainApp) رندر می‌شود؛
                        // روی لندینگ قبلاً این دکمه هیچ کاری نمی‌کرد. حالا: پنل باز
                        // می‌شود + مودال شارژ کیف پول خودکار (در اپ بازار با بسته‌های
                        // IAP بازار، در وب با درگاه زرین‌پال).
                        requestProfileWalletOpen();
                        setScreen("main");
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
                {upgradeEstimate?.isUpgrade && (
                  <div className="flex justify-between text-emerald-600">
                    <span className="flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5" />
                      اعتبار ارتقا ({toPersianDigits(upgradeEstimate.daysLeft)} روز باقی‌مانده)
                    </span>
                    <span>- {toPersianDigits(formatToman(upgradeEstimate.upgradeCredit))} تومان</span>
                  </div>
                )}
                {/* v197 — تخفیف ۱۰٪ صفحهٔ تحلیل (دیرکتیو مالک) */}
                {activeAnalysisDiscount && analysisDiscountValue > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      تخفیف صفحهٔ تحلیل ({toPersianDigits(String(activeAnalysisDiscount.percent))}٪)
                    </span>
                    <span>- {toPersianDigits(formatToman(analysisDiscountValue))} تومان</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1.5 border-t border-slate-200">
                  <span>مبلغ قابل پرداخت</span>
                  {/* v211 — در اپ بازار مبلغ نمایشی می‌تواند از قیمت واقعی خود بازار
                      بیاید (bazaarSkuToman) تا مودال = مبلغ درگاه؛ در وب همان finalAmount */}
                  <span className="text-orange-600 font-stat">{toPersianDigits(formatToman(displayPayable))} تومان</span>
                </div>
                {/* ═══ v211 — اطلاع شفاف مبلغ واقعی درگاه بازار (دیرکتیو مالک:
                    «کاربر دقیق با همون مبلغی که در مودال می‌بینه پرداخت کنه») ═══ */}
                {inBazaarApp && finalAmount > 0 && (bazaarDynamicNote || bazaarPriceMismatch) && (
                  <div className="mt-2 flex items-start gap-2 text-[11px] leading-4 text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                    <span>
                      {bazaarDynamicNote ||
                        `قیمت این پلن در کافه‌بازار ${toPersianDigits(formatToman(bazaarSkuToman || 0))} تومان است؛ مبلغ بالا بر همین اساس به‌روزرسانی شده تا دقیقاً همان مبلغی که درگاه بازار نشان می‌دهد پرداخت شود.`}
                    </span>
                  </div>
                )}
                {upgradeEstimate?.isUpgrade && !discountInfo?.valid && (
                  <p className="text-[11px] text-orange-600 font-medium pt-1">
                    ✓ با ارتقا به این پلن، ۴۵ روز کامل اشتراک جدید فعال می‌شود.
                  </p>
                )}
              </div>

              {/* v135 — متن VPN: فقط همین یک جمله (دیرکتیو مالک) — فقط برای درگاه آنلاین */}
              {showVpnNote && (
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <ShieldOff className="w-3.5 h-3.5 shrink-0" />
                  با وی‌پی‌ان خاموش وارد درگاه پرداخت شوید
                </div>
              )}

              {/* v200 — پرداخت اینستاگرام: «رفتن به درگاه پرداخت» حالا گزینهٔ اول است
                  (دیرکتیو مالک: «دکمهٔ رفتن به درگاه پرداخت باید بالاتر باشه و با
                  رنگ نارنجی سازمانی») — همان معماری v197 فقط جابه‌جایی + نارنجی توپر.
                  کلیک = ایجاد پرداخت (با توکن تخفیف صفحهٔ تحلیل) + انتقال به صفحهٔ
                  میانی /pay/{authority} → زرین‌پال. */}
              {isInstagramSource && paymentMethod === "gateway" && finalAmount > 0 && isLoggedIn && (
                <Button
                  onClick={() => startCheckout("gateway")}
                  disabled={payButtonBusy || smsSending}
                  className="w-full h-12 rounded-xl font-bold text-white shadow-lg shadow-orange-500/25"
                  style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                >
                  {redirecting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      در حال انتقال به درگاه…
                    </span>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      رفتن به درگاه پرداخت
                    </>
                  )}
                </Button>
              )}

              {/* v135 — دکمهٔ پرداخت: کلیک = ایجاد پرداخت + انتقال فوری به درگاه */}
              {/* v197 — در اینستاگرام: گزینهٔ دوم = ارسال پیامک پرداخت امن */}
              <Button
                onClick={() => startCheckout("sms")}
                disabled={payButtonBusy || (paymentMethod === "wallet" && !canUseWallet)}
                className="w-full h-12 rounded-xl font-bold text-white"
                style={{ background: goldGradient }}
              >
                {payButtonBusy || smsSending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {payButtonLabel}
                  </span>
                ) : (
                  <>
                    {paymentMethod === "wallet" ? (
                      <Wallet className="w-4 h-4" />
                    ) : isInstagramSource ? (
                      <MessageSquare className="w-4 h-4" />
                    ) : (
                      <CreditCard className="w-4 h-4" />
                    )}
                    {payButtonLabel}
                  </>
                )}
              </Button>

              {/* v200 — توضیح دو خطی زیر دکمهٔ «ارسال پیامک پرداخت امن» (دیرکتیو مالک) */}
              {isInstagramSource && paymentMethod === "gateway" && finalAmount > 0 && isLoggedIn && (
                <p className="text-[11px] leading-relaxed text-slate-500 text-center px-4">
                  با این روش، لینک پرداخت امن برای شما پیامک می‌شود و از طریق آن
                  می‌توانید پرداخت خود را نهایی کنید.
                </p>
              )}

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />
                پرداخت امن — پس از پرداخت به‌صورت خودکار بازمی‌گردید
              </div>
            </div>
          )}

          {step === "processing" && (
            <div key="processing" className="animate-fade-in py-10 text-center text-slate-900">
              <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
              <h3 className="font-bold mb-1">در حال تایید پرداخت...</h3>
              <p className="text-sm text-slate-500">لطفاً صبر کنید</p>
            </div>
          )}

          {/* ═══ v171 — صفحهٔ «لینک پرداخت پیامک شد» (فقط اینستاگرام — سند بخش ۲) ═══ */}
          {step === "sms" && smsSent && (
            <div key="sms" className="animate-fade-in space-y-4 text-center">
              <div className="animate-scale-in w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center mx-auto shadow-xl">
                <MessageCircle className="w-10 h-10 text-white" strokeWidth={2.2} />
              </div>
              <h3 className="text-lg font-black text-emerald-600">لینک پرداخت پیامک شد! 📩</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                لینک پرداخت امن به شماره{" "}
                <span className="font-bold text-slate-900" dir="ltr">
                  {smsSent.phoneMasked}
                </span>{" "}
                پیامک شد.
              </p>

              <div className="text-right p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2.5 text-sm">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">۱</span>
                  <p className="text-slate-700 text-xs leading-relaxed">پیامک فیتاپ را در پیام‌های گوشی باز کنید</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">۲</span>
                  <p className="text-slate-700 text-xs leading-relaxed">روی لینک بزنید تا در مرورگر گوشی باز شود</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">۳</span>
                  <p className="text-slate-700 text-xs leading-relaxed">
                    <span className="font-bold">VPN را خاموش کنید</span> و پرداخت را کامل کنید
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <ShieldOff className="w-3.5 h-3.5 shrink-0" />
                لینک ۲۰ دقیقه اعتبار دارد — اگر درگاه بلاک شد، VPN را خاموش کنید و دوباره روی لینک بزنید
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={async () => {
                    if (!smsSent.link) return;
                    try {
                      await navigator.clipboard.writeText(smsSent.link);
                      setSmsLinkCopied(true);
                      setTimeout(() => setSmsLinkCopied(false), 2500);
                      toast.success("لینک کپی شد — در مرورگر گوشی بازش کنید");
                    } catch {
                      toast.error("کپی ممکن نشد — لینک در پیامک هم هست.");
                    }
                  }}
                  variant="outline"
                  className="rounded-xl h-11 font-bold border-slate-200 text-slate-700"
                >
                  {smsLinkCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {smsLinkCopied ? "کپی شد" : "کپی لینک"}
                </Button>
                <Button
                  onClick={async () => {
                    if (smsResendIn > 0 || smsSending) return;
                    if (!paymentData?.paymentId) return;
                    try {
                      await sendPaymentLinkSms(paymentData.paymentId);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "ارسال مجدد ناموفق بود.");
                    }
                  }}
                  disabled={smsResendIn > 0 || smsSending}
                  variant="outline"
                  className="rounded-xl h-11 font-bold border-orange-200 text-orange-600 disabled:opacity-50"
                >
                  {smsSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MessageSquare className="w-4 h-4" />
                  )}
                  {smsResendIn > 0
                    ? `ارسال مجدد (${toPersianDigits(String(smsResendIn))} ثانیه)`
                    : "ارسال مجدد"}
                </Button>
              </div>

              {/* v197 — فرار اضطراری از فلوی پیامک: کاربری که ترجیح می‌دهد
                  همین‌جا (داخل مرورگر اینستاگرام) به درگاه برود — همان
                  معماری درگاه اپ؛ checkout مجدد با dedupe همان پرداخت را
                  برمی‌گرداند و authority تازه می‌سازد */}
              <Button
                onClick={() => startCheckout("gateway")}
                disabled={redirecting || loading}
                variant="outline"
                className="w-full rounded-xl h-11 font-bold border-orange-300 text-orange-600 hover:bg-orange-50"
              >
                {redirecting || loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    در حال انتقال به درگاه…
                  </span>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    یا همین‌جا به درگاه پرداخت بروید
                  </>
                )}
              </Button>

              <Button
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="w-full rounded-xl h-11 font-bold text-white"
                style={{ background: goldGradient }}
              >
                <Sparkles className="w-4 h-4" /> باشه، متوجه شدم
              </Button>
            </div>
          )}

          {step === "receipt" && receipt && (
            <div key="receipt" className="animate-scale-in space-y-4 text-center">
              {receipt.success ? (
                <>
                  <div className="animate-scale-in w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center mx-auto shadow-xl">
                    <Check className="w-12 h-12 text-white" strokeWidth={3} />
                  </div>
                  <h3 className="text-xl font-black text-emerald-600">پرداخت موفق! 🎉</h3>
                  <p className="text-sm text-slate-500">
                    {receipt.pendingPrerequisites
                      ? `پلن ${plan.label} ثبت شد. برای شروع دوره، عکس‌های بدن را از داشبورد ارسال کنید.`
                      : `پلن ${plan.label} فعال شد. درخواست ساخت برنامه ثبت شد — در انتظار تولید توسط مربی هوشمند.`}
                  </p>
                  <div className="text-right p-3 rounded-2xl bg-slate-50 space-y-2 text-sm text-slate-900">
                    <div className="flex justify-between"><span className="text-slate-500">مبلغ</span><span className="font-bold font-stat">{toPersianDigits(formatToman(receipt.amount || 0))} تومان</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">پلن</span><span>{receipt.plan || plan.label}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">کد پیگیری</span><span dir="ltr" className="font-mono text-xs">{receipt.refId}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">وضعیت برنامه</span><span className="text-orange-600 font-bold">{receipt.pendingPrerequisites ? "در انتظار عکس بدن" : "در انتظار تولید"}</span></div>
                  </div>
                  <Button onClick={() => {
                    reset();
                    onClose();
                    // ورود به پنل با تب داشبورد
                    // FE-L10: user را در لحظهٔ کلیک از store بخوان — نه از
                    // closure رندر قبل از setUser (که در همان tick ست شده)
                    const currentUser = useAppStore.getState().user;
                    setMainTab("dashboard");
                    setScreen(currentUser?.role === "ADMIN" ? "admin" : "main");
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
            </div>
          )}
        </>
      </DialogContent>

      {/* v159 — مدال الزامی به‌روزرسانی اطلاعات تمدید (روی مدال خرید) */}
      {renewalPrompt && step === "receipt" && receipt?.success && (
        <RenewalUpdateModal
          token={null}
          planId={plan?.id ?? null}
          onDone={(result) => {
            try {
              if (renewalFlagKeyState) localStorage.setItem(renewalFlagKeyState, "1");
            } catch {}
            setRenewalPrompt(false);
            if (result.saved && result.next === "prerequisites") {
              toast.info("حالا مرحلهٔ بعد: ارسال عکس‌های بدن (پیش‌نیاز) — در داشبورد منتظرت است 📸");
            } else if (result.saved) {
              toast.success(result.generationStarted
                ? "برنامهٔ تو با اطلاعات جدید از نو ساخته می‌شود — چند دقیقه در تب برنامه‌ها ⏳"
                : "برنامهٔ تو با اطلاعات به‌روز ساخته می‌شود ⏳");
            }
            reset();
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}
