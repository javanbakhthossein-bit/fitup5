"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  X,
  Crown,
  Shield,
  LogOut,
  ChevronLeft,
  CreditCard,
  Settings,
  Activity,
  Wallet,
  Loader2,
  TrendingUp,
  TrendingDown,
  Dumbbell,
  Camera,
  Trash2,
  // v53: سکشن «آزمایش‌های خون من»
  TestTube,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  toPersianDigits, formatToman,
  PLAN_LABELS,
} from "@/lib/fitness/types";
import { SportsProfileModal } from "@/components/fitness/views/sports-profile-modal";
import { useMediaSourcePicker } from "@/components/fitness/media-source-picker";
import { LogoutConfirmModal } from "@/components/fitness/logout-button"; // ۳۲-B: تأیید خروج یکدست با دکمه خروج اصلی
import { toast } from "sonner";
// v129 — بنر ثابت مشورتی «فیلترشکن» (بدون چک پویا — دیرکتیو مالک)
import { VpnStatusBanner } from "@/lib/fitness/use-vpn-check";

// ─── t10: فلگ در-پرواز سطح ماژول — ضد آپلود دوباره ───
// state کامپوننت با unmount از دست می‌رود؛ اگر کاربر overlay پروفایل را وسط
// آپلود ببندد و دوباره باز کند، این فلگ هنوز در-پرواز بودن را نشان می‌دهد.
let avatarUploadInFlight = false;

// ─── DTO شامل تمام فیلدهای آنبوردینگ ───
interface OnboardingProfileDto {
  // Basic
  gender: string;
  genderLabel: string;
  age: number;
  height: number;
  weight: number;
  targetWeight: number | null;
  goal: string;
  goalLabel: string;
  activityLevel: string;
  activityLabel: string;
  workoutDays: number;
  workoutDaysList: string[];
  workoutPlace: string;
  workoutPlaceLabel: string;
  workoutTime: string | null;
  workoutTimeLabel: string | null;
  // Equipment
  equipment: string[];
  // Diet
  dietType: string;
  dietLabel: string;
  preferredCuisine: string | null;
  preferredCuisineLabel: string | null;
  dislikedFoods: string | null;
  allergies: string;
  // Health
  injuries: string;
  diseases: string;
  drugAllergies: string | null;
  currentMedications: string | null;
  medicalConditions: string[];
  medicalConditionsLabel: string | null;
  // Recovery
  sleepHours: number | null;
  stressLevel: number | null;
  waterHabit: number | null;
  waterGoalMl: number | null;
  bodyFrame: string | null;
  bodyFrameLabel: string | null;
  // Training experience
  trainingExperience: string | null;
  trainingExperienceLabel: string | null;
  previousTrainingType: string | null;
  maxLifts: string | null;
  // Target date
  targetDate: string | null;
  // Supplements
  currentSupplements: string | null;
  // Body composition measurements
  neckMeasurement: number | null;
  shoulderMeasurement: number | null;
  calfMeasurement: number | null;
}

interface BaselineDto {
  weight: number;
  chestMeasurement: number | null;
  armMeasurement: number | null;
  waistMeasurement: number | null;
  hipMeasurement: number | null;
  thighMeasurement: number | null;
  createdAt: string;
}

interface WalletTxnDto {
  id: string;
  type: string;
  amount: number;
  /** Task 7-d — خریدهای درگاهی (زرین‌پال/بازار/تمدید) که از همان /api/wallet می‌آیند
   *  موجودی پس از تراکنش ندارند (null) — رندر از balance استفاده نمی‌کند و فقط
   *  بر اساس علامت مبلغ (منفی = هزینه، قرمز) رنگ/آیکن می‌گیرد. */
  balance: number | null;
  description: string;
  createdAt: string;
}

/**
 * v102 — آیا داخل اپ اندروید کافه‌بازار هستیم؟
 * اپ تابع window.isFitUpBazaarApp را تزریق می‌کند؛ در اپ‌های قدیمی‌تر، وجود
 * خود پل خرید (window.fitupBazaarPurchase) نشانهٔ اپ است.
 * در اپ بازار، شارژ کیف پول باید با پرداخت درون‌برنامه‌ای بازار انجام شود
 * (قانون بازار) — نه درگاه زرین‌پال.
 */
function detectBazaarApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (typeof (window as any).isFitUpBazaarApp === "function") {
      return !!(window as any).isFitUpBazaarApp();
    }
  } catch {}
  return typeof (window as any).fitupBazaarPurchase === "function";
}

/** بسته‌های شارژ کیف پول — SKUهای مصرفی تعریف‌شده در پیشخان بازار (fitup_wallet_*) */
const WALLET_TOPUP_PRESETS = [100000, 500000, 1000000] as const;

// v104 — درخواست باز شدن خودکار مودال شارژ کیف پول در باز شدن بعدی overlay
// (مدال خرید لندینگ: «افزایش موجودی» → پنل + مودال شارژ، بدون جستجوی دستی)
let openWalletOnNextMount = false;
export function requestProfileWalletOpen(): void {
  openWalletOnNextMount = true;
}

// شناسه‌های سکشن‌های قابل ویرایش
export function ProfileOverlay() {
  const { user, setUser, setOverlay, reset } = useAppStore();
  const [profile, setProfile] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<{
    analysis?: string;
    bmi?: number;
    bmr?: number;
    tdee?: number;
    profile?: OnboardingProfileDto;
    baseline?: BaselineDto | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletOpen, setWalletOpen] = useState(false);
  // v104 — اگر از مدال خرید با «افزایش موجودی» آمده، مودال شارژ بلافاصله باز شود
  useEffect(() => {
    if (openWalletOnNextMount) {
      openWalletOnNextMount = false;
      setWalletOpen(true);
    }
  }, []);
  const [chargeAmount, setChargeAmount] = useState("");
  const [charging, setCharging] = useState(false);
  // v102 — در اپ کافه‌بازار شارژ کیف پول با پرداخت درون‌برنامه‌ای بازار است
  const [isBazaarApp] = useState(detectBazaarApp);
  // 🩹 v49 (هم‌تراز با فیکس v45 مودال خرید): هر بازگشت به صفحه (Back از درگاه،
  // برگشت به تب) قفل شارژ را آزاد می‌کند تا مودال با اسپینر قفل نشود
  useEffect(() => {
    const unlock = () => setCharging(false);
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
  const [walletTxns, setWalletTxns] = useState<WalletTxnDto[]>([]);
  // FIX: کل واقعی تراکنش‌ها از API (txns فقط ۵۰ مورد آخر است)
  const [walletTxnsTotal, setWalletTxnsTotal] = useState(0);
  const [walletTxnsLoading, setWalletTxnsLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  // ۳۲-B: مودال تأیید خروج — خروج بدون تأیید نباید انجام شود
  const [confirmOpen, setConfirmOpen] = useState(false);
  // ─── مودال «پرونده ورزشی» — کل پرونده در یک تجربه مجزا (درخواست مالک) ───
  const [sportsProfileOpen, setSportsProfileOpen] = useState(false);
  // ─── عکس پروفایل (آواتار) ───
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false); // فایل ۴۰۴ شد → fallback به مربع حرفی
  // v120 — دیرکتیو مالک (تذکر کافه‌بازار): عکس پروفایل حالا هم «دوربین» دارد هم «گالری»
  const avatarPicker = useMediaSourcePicker({
    kind: "image",
    onFiles: (files) => handleAvatarChange(files[0] ?? null),
  });
  const showAvatar = !!user?.avatarUrl && !avatarBroken;

  // اگر آواتار عوض/حذف شد، وضعیت broken ریست شود
  useEffect(() => {
    setAvatarBroken(false);
  }, [user?.avatarUrl]);

  /**
   * آپلود عکس پروفایل — t10: بهینه + پس‌زمینه‌ای.
   * ۱) کوچک‌سازی کلاینت‌ساید (client-image.ts → webp ~۶۴۰px؛ خطا = فایل اصلی)
   * ۲) آپدیت خوش‌بینانه از طریق store با objectURL — TopBar/Sidebar/پروفایل
   *    بلافاصله عکس جدید را نشان می‌دهند (بدون spinner مسدودکننده)
   * ۳) POST بدون انتظارِ UI — نتیجه: setUser با URL سرور + آزادسازی objectURL
   * خطا: برگشت خودکار به آواتار قبلی + toast خطا
   */
  // v120 — گیرندهٔ نهایی فایل آواتار (از دوربین یا گالری — انتخابگر مشترک)
  function handleAvatarChange(file: File | null) {
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("فقط فایل تصویری مجاز است.");
      return;
    }
    // دیرکتیو مالک: سقف حجم کاربر-پسند حذف شد — عکس بی‌صدا به ۶۴۰px کوچک
    // می‌شود (downscaleImage پایین)؛ گارد فنی نهایی سمت سرور است با پیام مهربان.
    if (avatarUploadInFlight) return; // ضد دوبار-ارسال
    avatarUploadInFlight = true;
    setAvatarUploading(true); // فقط نشانگر ظریف روی بج دوربین (مسدودکننده نیست)

    const previousAvatarUrl = user.avatarUrl ?? null;

    // عمداً await نمی‌کنیم — UI بلاک نشود؛ حتی اگر overlay unmount شود
    // ادامه پیدا می‌کند (همه‌ی به‌روزرسانی‌ها از useAppStore.getState()).
    void (async () => {
      let objectUrl: string | null = null;
      try {
        const { downscaleImage } = await import("@/lib/fitness/client-image");
        const resized = await downscaleImage(file);

        // آپدیت خوش‌بینانه — همه‌ی مصرف‌کننده‌های store فوری عوض می‌شوند
        objectUrl = URL.createObjectURL(resized);
        const st0 = useAppStore.getState();
        if (st0.user) st0.setUser({ ...st0.user, avatarUrl: objectUrl });
        toast("در حال بروزرسانی عکس پروفایل…");

        const fd = new FormData();
        fd.append("image", resized);
        const res = await fetch("/api/user/avatar", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok || !data.avatarUrl) {
          throw new Error(data.error || "آپلود عکس پروفایل ناموفق بود.");
        }
        const serverUrl = data.avatarUrl as string;
        // URL نهایی سرور — merge با آخرین state کاربر (نه closure کهنه)
        const st = useAppStore.getState();
        if (st.user) st.setUser({ ...st.user, avatarUrl: serverUrl });
        toast.success("عکس پروفایل به‌روزرسانی شد.");
      } catch (err) {
        // برگشت به آواتار قبلی
        const st = useAppStore.getState();
        if (st.user) st.setUser({ ...st.user, avatarUrl: previousAvatarUrl });
        toast.error(err instanceof Error ? err.message : "خطا در آپلود عکس پروفایل");
      } finally {
        if (objectUrl) {
          // با تأخیر آزاد می‌شود تا <img> فرصت لود objectURL را داشته باشد
          const url = objectUrl;
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
        avatarUploadInFlight = false;
        setAvatarUploading(false);
      }
    })();
  }

  /** حذف عکس پروفایل — DELETE /api/user/avatar */
  async function handleAvatarRemove() {
    if (!user || avatarRemoving || avatarUploading) return;
    setAvatarRemoving(true);
    try {
      const res = await fetch("/api/user/avatar", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "حذف عکس پروفایل ناموفق بود.");
      }
      setUser({ ...user, avatarUrl: null });
      toast.success("عکس پروفایل حذف شد.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در حذف عکس پروفایل");
    } finally {
      setAvatarRemoving(false);
    }
  }

  // ─── v48 — رفع لگ باز شدن مودال پروفایل در اپ‌ها (شکایت مالک) ───
  // ۱) contentReady: محتوای سنگین (کیف‌پول/متRICS/پرونده) دو فریم بعد از mount
  //    رندر می‌شود تا انیمیشن باز شدن Sheet با درخت سبک اجرا شود (روان در WebView ضعیف).
  // ۲) واکشی کیف‌پول فاز دوم (۳۵۰ms بعد) — سه فچ موازی فریم اول را قفل نمی‌کنند.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setContentReady(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, []);

  const loadData = useCallback(async () => {
    const [progressRes, onboardingRes] = await Promise.all([
      fetch("/api/progress"),
      fetch("/api/onboarding/analysis"),
    ]);
    const progressData = await progressRes.json();
    let onboardingData: any = null;
    try { onboardingData = await onboardingRes.json(); } catch {}
    setProfile({
      startWeight: progressData.startWeight,
      targetWeight: progressData.targetWeight,
      bmi: onboardingData?.bmi,
      bmr: onboardingData?.bmr,
      tdee: onboardingData?.tdee,
      gender: (onboardingData?.profile?.genderLabel || "").includes("آقا") ? "male" : (onboardingData?.profile?.genderLabel || "").includes("خانم") ? "female" : null,
    });
    if (onboardingData) setOnboarding(onboardingData);
  }, []);

  // فاز دوم — تراکنش‌های کیف‌پول (پایین صفحه؛ عجله‌ای ندارد)
  const loadWallet = useCallback(async () => {
    const walletRes = await fetch("/api/wallet");
    let walletData: any = null;
    try { walletData = await walletRes.json(); } catch {}
    if (Array.isArray(walletData?.transactions)) {
      setWalletTxns(walletData.transactions as WalletTxnDto[]);
      setWalletTxnsTotal(
        typeof walletData?.total === "number" ? walletData.total : walletData.transactions.length
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await loadData();
      } catch {
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    const walletTimer = setTimeout(() => {
      loadWallet()
        .catch(() => {})
        .finally(() => { if (mounted) setWalletTxnsLoading(false); });
    }, 350);
    return () => {
      mounted = false;
      clearTimeout(walletTimer);
    };
  }, [loadData, loadWallet]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    // 🩹 v45: خروج از نسخهٔ مشترک lib/fitness/logout.ts — پاک‌کردن کش SW +
    // storage + reload با cache-buster (پاک‌سازی کامل = بدون state شبح)
    try {
      const { performLogout: sharedLogout } = await import("@/lib/fitness/logout");
      const ok = await sharedLogout({ confirm: false });
      if (!ok) {
        setLoggingOut(false);
        return;
      }
    } catch {
      // حتی اگر lib شکست خورد، مسیر قدیمی امن را برو
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
      try { window.sessionStorage.removeItem("fitap_last_screen"); } catch {}
      reset();
      setOverlay(null);
      window.location.href = "/?_logout=" + Date.now();
    }
  }

  const subEndDate = user?.subscriptionEnd ? new Date(user.subscriptionEnd) : null;
  const daysLeft = subEndDate ? Math.ceil((subEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-bold">پروفایل</h2>
        <Button variant="ghost" size="icon" onClick={() => setOverlay(null)} className="rounded-full">
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {/* User card */}
        <Card className="p-5 relative overflow-hidden">
          <div className="absolute -left-8 -top-8 w-32 h-32 rounded-full bg-primary/10" />
          <div className="relative flex items-center gap-4">
            {/* ─── آواتار: عکس کاربر (اگر آپلود کرده) یا مربع گرادیانی حرف اول ─── */}
            <div className="relative shrink-0 w-16 h-16">
              {showAvatar ? (
                <img
                  src={user?.avatarUrl ?? ""}
                  alt={`عکس پروفایل ${user?.name || "کاربر"}`}
                  className="w-16 h-16 rounded-full object-cover shadow-lg ring-2 ring-white/80 dark:ring-slate-800"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-emerald-600 flex items-center justify-center text-white text-2xl font-black shadow-lg">
                  {user?.name?.[0] || "ک"}
                </div>
              )}
              {/* نشان دوربین — باز کردن file input؛ هدف لمس ≥۴۴px با ::before نامرئی */}
              <button
                type="button"
                onClick={() => avatarPicker.openPicker()}
                disabled={avatarUploading || avatarRemoving}
                aria-label={user?.avatarUrl ? "تغییر عکس پروفایل" : "افزودن عکس پروفایل"}
                className="absolute -bottom-1.5 -left-1.5 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shadow-md border-2 border-white dark:border-slate-900 hover:bg-primary/90 active:scale-95 transition disabled:opacity-70 before:absolute before:-inset-2 before:rounded-full before:content-['']"
              >
                {avatarUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg">{user?.name || "ورزشکار"}</h3>
              <p className="text-sm text-muted-foreground" dir="ltr">{user?.mobile}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                {user?.role === "ADMIN" && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    <Shield className="w-3 h-3" /> مدیر سیستم
                  </span>
                )}
                {user?.planName && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">
                    <Crown className="w-3 h-3" /> پلن {PLAN_LABELS[user.planName as keyof typeof PLAN_LABELS] ?? user.planName}
                  </span>
                )}
                {/* حذف عکس پروفایل — فقط وقتی عکس وجود دارد؛ هدف لمس با ::before ≥۴۴px */}
                {user?.avatarUrl && (
                  <button
                    type="button"
                    onClick={handleAvatarRemove}
                    disabled={avatarUploading || avatarRemoving}
                    className="inline-flex items-center gap-1 text-[11px] bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2.5 py-0.5 rounded-full hover:bg-rose-500/20 active:scale-95 transition disabled:opacity-60 relative before:absolute before:-inset-1.5 before:content-['']"
                  >
                    {avatarRemoving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    حذف عکس
                  </button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Subscription status */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-sm">وضعیت اشتراک</h3>
            </div>
          </div>
          {user?.hasActiveSubscription ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-emerald-600 dark:text-emerald-400">اشتراک فعال ✓</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {toPersianDigits(daysLeft)} روز باقی‌مانده
                  </p>
                </div>
                <div className="text-left">
                  <p className="text-[11px] text-muted-foreground">تاریخ پایان</p>
                  <p className="text-xs font-medium">{subEndDate?.toLocaleDateString("fa-IR")}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">اشتراک فعال نیست</p>
              <Button
                size="sm"
                className="w-full rounded-xl"
                onClick={() => setOverlay("subscription")}
              >
                <Crown className="w-4 h-4" />
                خرید پلن
              </Button>
            </div>
          )}
        </Card>

        {/* Wallet — v48: دو فریم بعد از پینت رندر می‌شود (نرمی باز شدن مودال) */}
        {!contentReady ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-cyan-500" />
              <h3 className="font-bold text-sm">کیف پول</h3>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[11px] text-muted-foreground">موجودی فعلی</p>
                <p className="font-black text-lg text-cyan-600 dark:text-cyan-400">
                  {toPersianDigits((user?.walletBalance ?? 0).toLocaleString("en-US"))} <span className="text-xs font-normal">تومان</span>
                </p>
              </div>
              <Wallet className="w-8 h-8 text-cyan-500/40" />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => setWalletOpen(true)}
            >
              شارژ کیف پول
            </Button>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-muted-foreground">تراکنش‌های اخیر</h4>
              {walletTxnsTotal > 5 && (
                <span className="text-[10px] text-muted-foreground/70">
                  {toPersianDigits(walletTxnsTotal)} تراکنش
                </span>
              )}
            </div>
            {walletTxnsLoading ? (
              <Skeleton className="h-20 rounded-xl" />
            ) : walletTxns.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground rounded-xl bg-muted/30 border border-dashed">
                هنوز تراکنشی ثبت نشده است
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar pl-1">
                {/* Task 7-d — لیست ادغامی است: تراکنش‌های کیف پول + خریدهای درگاهی
                    (id با پیشوند pay_ و type="purchase") — رندر بر اساس علامت مبلغ:
                    منفی → قرمز/TrendingDown، مثبت → سبز/TrendingUp */}
                {walletTxns.slice(0, 20).map((t) => {
                  const isIncome = t.amount >= 0;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50"
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isIncome
                            ? "bg-emerald-100 text-emerald-600"
                            : "bg-rose-100 text-rose-600"
                        }`}
                      >
                        {isIncome ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {t.description || txnTypeLabel(t.type)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatJalaliDateTime(t.createdAt)}
                        </p>
                      </div>
                      <div
                        className={`text-xs font-bold font-stat shrink-0 ${
                          isIncome ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {isIncome ? "+" : ""}
                        {toPersianDigits(Math.abs(t.amount).toLocaleString("en-US"))}
                        <span className="text-[9px] font-normal mr-0.5 opacity-70">ت</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
        )}
        {loading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : (
          profile && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-sm">اطلاعات فیزیکی</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <InfoRow label="وزن شروع" value={profile.startWeight ? `${toPersianDigits(profile.startWeight)} kg` : "—"} />
                <InfoRow label="وزن هدف" value={profile.targetWeight ? `${toPersianDigits(profile.targetWeight)} kg` : "—"} />
                {profile.bmi && <InfoRow label="شاخص BMI" value={toPersianDigits(profile.bmi)} />}
                {profile.bmr && <InfoRow label="متابولیسم (BMR)" value={`${toPersianDigits(profile.bmr)} کالری`} />}
                {profile.tdee && <InfoRow label="کالری روزانه (TDEE)" value={`${toPersianDigits(profile.tdee)} کالری`} />}
              </div>
            </Card>
          )
        )}

        {/* ─── Task 4: پروندهٔ آزمایش خون به پرونده ورزشی منتقل شد (درخواست مالک) ───
            لیست/لایت‌باکس/مودال متنیِ قدیمی حذف شد؛ تحلیل‌های آزمایش خون حالا
            داخل گروه‌بندی «بر اساس پلن» در پرونده ورزشی دیده می‌شود (هم‌دوره با
            عکس/ویدیوی بدن). جریان آپلود/تحلیل (BloodTestView) از پیش‌نیازها و
            سایر ورودی‌ها سر جایش است. */}
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <TestTube className="w-5 h-5 text-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">پروندهٔ آزمایش خون</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                تحلیل آزمایش‌های خون همراه با عکس‌ها و ویدیوهای بدن، حالا در پرونده ورزشی شماست.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="mt-3 w-full rounded-xl text-xs text-white"
            style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            onClick={() => setSportsProfileOpen(true)}
          >
            مشاهده در پرونده ورزشی
          </Button>
        </Card>

        {/* ─── دکمه «مشاهده پرونده ورزشی» (درخواست مالک) ───
            پروفایل فقط اطلاعات پایه را نشان می‌دهد؛ کل پرونده ورزشی/پزشکی
            (۹ سکشن + baseline + تحلیل AI + عکس‌ها و آنالیزها) در مودال
            اختصاصی SportsProfileModal با قابلیت ویرایش نمایش داده می‌شود. */}
        {loading ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setSportsProfileOpen(true)}
            className="w-full p-5 rounded-2xl border-2 border-orange-200 bg-gradient-to-l from-orange-50 to-amber-50/60 text-right shadow-sm transition hover:shadow-md hover:border-orange-300 active:scale-[0.99] flex items-center gap-4"
            aria-label="مشاهده پرونده ورزشی"
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-md"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              <Dumbbell className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-base text-slate-800">مشاهده پرونده ورزشی</p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                هدف، برنامه تمرین، تغذیه، سلامت، ریکاوری و همه‌ی جزئیات — قابل ویرایش
              </p>
            </div>
            <ChevronLeft className="w-5 h-5 text-orange-400 shrink-0" />
          </motion.button>
        )}

        {/* Settings list */}
        <div className="space-y-1">
          <SettingsRow
            icon={CreditCard}
            label="مدیریت اشتراک"
            onClick={() => setOverlay("subscription")}
            chevron
          />
          {user?.role === "ADMIN" && (
            <SettingsRow
              icon={Settings}
              label="پنل مدیریت"
              onClick={() => setOverlay("admin")}
              chevron
              highlight
            />
          )}
        </div>

        {/* Logout — ۳۲-B: کلیک اول فقط مودال تأیید باز می‌کند؛ خروج واقعی
            بعد از «بله، خارج می‌شوم» در LogoutConfirmModal اجرا می‌شود */}
        <Button
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          disabled={loggingOut}
          className="w-full rounded-xl text-destructive hover:text-destructive hover:bg-destructive/5"
        >
          {loggingOut ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              در حال خروج...
            </>
          ) : (
            <>
              <LogOut className="w-4 h-4" />
              خروج از حساب
            </>
          )}
        </Button>

        <p className="text-center text-[11px] text-muted-foreground pt-2">
          فیتاپ — نسخه ۱.۰.۰
        </p>
      </div>

      {/* v120 — انتخابگر دوربین/گالری عکس پروفایل (inputهای مخفی + شیت) */}
      {avatarPicker.machinery}

      {/* ─── مودال «پرونده ورزشی» — تمام جزئیات + ویرایش (درخواست مالک) ─── */}
      <SportsProfileModal
        open={sportsProfileOpen}
        onClose={() => setSportsProfileOpen(false)}
      />

      {/* ─── ۳۲-B: مودال تأیید خروج (همان طراحی دکمه خروج اصلی) ─── */}
      <LogoutConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleLogout}
      />

      {/* ─── v53: لایت‌باکس آزمایش‌های خون حذف شد — Task 4: آزمایش خون حالا در
          پرونده ورزشی با لایت‌باکس/دانلود یکپارچه دیده می‌شود ─── */}

      {/* Wallet Charge Modal — FE-C4: شارژ واقعی از طریق درگاه زرین‌پال.
          قرارداد جدید POST /api/wallet: {ok, paymentId, authority, gatewayUrl}
          کاربر به gatewayUrl هدایت می‌شود و پس از پرداخت به ?payment_verify=1
          برمی‌گردد تا PaymentVerifyHandler نتیجه را تأیید کند. */}
      <Dialog open={walletOpen} onOpenChange={(open) => { if (!charging) setWalletOpen(open); }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader><DialogTitle>شارژ کیف پول</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="p-2 rounded-lg bg-orange-50 text-xs text-center">موجودی فعلی: <b className="font-stat">{toPersianDigits(formatToman(user?.walletBalance || 0))} ت</b></div>
            {isBazaarApp ? (
              // v102 — اپ کافه‌بازار: SKUهای ثابت بازار (پرداخت با مبلغ آزاد در IAP بازار ممکن نیست)
              <div>
                <Label className="mb-1 block">بستهٔ شارژ را انتخاب کنید</Label>
                <div className="grid grid-cols-3 gap-2">
                  {WALLET_TOPUP_PRESETS.map((v) => {
                    const selected = Number(chargeAmount) === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setChargeAmount(String(v))}
                        className={`min-h-[44px] rounded-xl border font-stat text-sm transition ${selected ? "border-orange-500 bg-orange-50 text-orange-600 font-bold" : "border-border bg-muted/40 text-foreground hover:border-orange-300"}`}
                      >
                        {toPersianDigits(formatToman(v))}
                      </button>
                    );
                  })}
                </div>
                {chargeAmount && Number(chargeAmount) > 0 && (
                  <p className="text-[11px] text-center text-slate-500 mt-1">
                    {toPersianDigits(formatToman(Number(chargeAmount)))} تومان
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label className="mb-1 block">مبلغ (تومان)</Label>
                {/* v20: جداکنندهٔ هزارگان زنده — بعد از هر ۳ رقم کاما؛ ارقام فارسی */}
                <Input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={formatChargeInput(chargeAmount)}
                  onChange={(e) => setChargeAmount(sanitizeChargeInput(e.target.value))}
                  placeholder={`مثلاً ${toPersianDigits(formatToman(500000))}`}
                  className="rounded-xl text-center font-stat text-lg font-bold tracking-wide"
                />
                {chargeAmount && Number(chargeAmount) > 0 && (
                  <p className="text-[11px] text-center text-slate-500 mt-1">
                    {toPersianDigits(formatToman(Number(chargeAmount)))} تومان
                  </p>
                )}
              </div>
            )}
            {isBazaarApp ? (
              // v102 — بدون هشدار VPN/زرین‌پال: پرداخت درون‌برنامه‌ای بازار
              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                پرداخت درون‌برنامه‌ای کافه‌بازار — مبلغ از حساب کافه‌بازار شما کسر و کیف پول فیتاپ بلافاصله شارژ می‌شود.
              </p>
            ) : (
              <div>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              پس از تأیید، به درگاه پرداخت زرین‌پال منتقل می‌شوید و پس از پرداخت به‌صورت خودکار به فیتاپ بازمی‌گردید.
            </p>
            {/* v129 (دیرکتیو مالک): متن ثابت مشورتی — بدون چک پویا/spinner؛
                چک پویا خودش منبع هنگ بود (درخواست وسط سوئیچ VPN گیر می‌کرد) */}
            <div className="mt-2">
              <VpnStatusBanner />
            </div>
          </div>
            )}
          </div>
          <DialogFooter>
            {/* v129: انصراف هیچ‌وقت غیرفعال نمی‌شود — بستن مودال باید همیشه کار کند
                (گزارش مالک: «دکمه بستن مدالم کار نمی‌کند») */}
            <Button variant="outline" onClick={() => setWalletOpen(false)} className="rounded-xl">انصراف</Button>
            <Button
              onClick={async () => {
                if (!chargeAmount || Number(chargeAmount) <= 0) return;
                setCharging(true);
                try {
                  // ─── v102 — اپ کافه‌بازار: پرداخت درون‌برنامه‌ای بازار (قانون بازار: زرین‌پال ممنوع) ───
                  if (isBazaarApp) {
                    const sku = `fitup_wallet_${Number(chargeAmount)}`;
                    const purchase = await (window as any).fitupBazaarPurchase(
                      sku,
                      { type: "wallet_topup", userId: user?.id || null },
                      null
                    );
                    if (!purchase?.ok) {
                      setCharging(false);
                      if (purchase?.canceled) toast.info(purchase.error || "پرداخت لغو شد");
                      else toast.error(purchase?.error || "پرداخت درون‌برنامه‌ای بازار ناموفق بود");
                      return;
                    }
                    // فعال‌سازی شارژ روی سرور — راستی‌آزمایی سه‌مسیره (OAuth/پیشخان/RSA)
                    const res = await fetch("/api/payment/bazaar/wallet", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        productId: purchase.productId || sku,
                        purchaseToken: purchase.purchaseToken,
                        orderId: purchase.orderId,
                        // امضای خرید برای مسیر پشتیبان RSA (هم‌الگوی خرید پلن)
                        dataJson: purchase.dataJson,
                        signature: purchase.signature,
                      }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || !data.ok) {
                      throw new Error(data.error || "خطا در فعال‌سازی شارژ کیف پول");
                    }
                    // مصرف کالای مصرفی بازار — بعد از فعال‌سازی موفق سرور (شارژ مجدد ممکن شود)
                    try {
                      (window as any).FitUpNative?.consumePurchase?.(purchase.purchaseToken);
                    } catch {}
                    // به‌روزرسانی فوری موجودی از پاسخ سرور + رفرش تراکنش‌ها
                    if (user && typeof data.balance === "number") {
                      setUser({ ...user, walletBalance: data.balance });
                    }
                    loadWallet();
                    toast.success(data.message || "کیف پول شما شارژ شد 🎉");
                    setCharging(false);
                    setWalletOpen(false);
                    return;
                  }
                  // ─── مسیر وب: زرین‌پال ───
                  // 🔧 v129 (دیرکتیو مالک): هیچ چک VPN قبل از ناوبری — همان رفتار
                  // قدیمی که کار می‌کرد؛ کلیک = ساخت پرداخت و رفتن فوری به درگاه.
                  const res = await fetch("/api/wallet", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount: Number(chargeAmount) }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok || !data.ok || !data.gatewayUrl) {
                    throw new Error(data.error || "خطا در ایجاد پرداخت");
                  }
                  // هدایت به درگاه زرین‌پال — نتیجه پس از بازگشت در
                  // PaymentVerifyHandler تأیید می‌شود (?payment_verify=1)
                  toast.info("در حال انتقال به درگاه پرداخت...");
                  // 🩹 v49 (هم‌تراز با فیکس v45 مودال خرید): اگر ناوبری به هر دلیل
                  // انجام نشد، قبلاً charging برای همیشه true می‌ماند و مودال با
                  // اسپینر قفل می‌شد — حالا ۱۲ ثانیه بعد قفل آزاد می‌شود
                  // (بازگشت زودتر با pageshow/visibilitychange پوشش داده می‌شود)
                  window.setTimeout(() => setCharging(false), 12_000);
                  window.location.href = data.gatewayUrl;
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "خطا در شارژ کیف پول");
                  setCharging(false);
                }
              }}
              disabled={charging}
              className="rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {charging ? <Loader2 className="w-4 h-4 animate-spin" /> : isBazaarApp ? "پرداخت با کافه‌بازار" : "شارژ کیف پول"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════ Task 4: کمکی‌های سکشن «آزمایش‌های خون من» حذف شد ═══════════════
// لیست آزمایش خون + لایت‌باکس + مودال نتیجهٔ متنی به پرونده ورزشی منتقل شد
// (SportsProfileModal — گروه‌بندی بر اساس پلن). formatJalaliDateTime برای
// لیست تراکنش‌های کیف‌پول سر جایش ماند.

/** برچسب فارسی نوع تراکنش کیف پول */
function txnTypeLabel(type: string): string {
  switch (type) {
    case "deposit":
      return "شارژ کیف پول";
    case "purchase":
      return "خرید";
    case "refund":
      return "بازگشت وجه";
    case "bonus":
      return "پاداش";
    default:
      return "تراکنش";
  }
}

/** تبدیل ارقام فارسی/عربی به لاتین (ورودی مبلغ شارژ) */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function toEnDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/**
 * ورودی مبلغ شارژ را به «فقط ارقام لاتین بدون جداکننده» پاک می‌کند.
 * (state همیشه digits-only است؛ کاما فقط در نمایش است)
 */
function sanitizeChargeInput(raw: string): string {
  return toEnDigits(raw).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * نمایش مبلغ داخل ورودی شارژ: کاما بعد از هر ۳ رقم + ارقام فارسی.
 * مثال: 1500000 → «۱,۵۰۰,۰۰۰»
 */
function formatChargeInput(digits: string): string {
  const clean = digits.replace(/\D/g, "");
  if (!clean) return "";
  return toPersianDigits(Number(clean).toLocaleString("en-US"));
}

/** فرمت تاریخ شمسی + ساعت — برای نمایش در لیست تراکنش‌ها */
function formatJalaliDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "long",
    }).format(d);
    const time = new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${date} · ${time}`;
  } catch {
    return "";
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-left" dir="auto">{value}</span>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  action,
  onClick,
  chevron,
  highlight,
}: {
  icon: any;
  label: string;
  action?: React.ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition text-right ${
        highlight ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted"
      }`}
    >
      <Icon className={`w-5 h-5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {action}
      {chevron && <ChevronLeft className="w-4 h-4 text-muted-foreground" />}
    </button>
  );
}

