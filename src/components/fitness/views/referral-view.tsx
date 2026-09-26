"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Gift,
  Copy,
  Check,
  Share2,
  MessageCircle,
  MessageSquareText,
  AlertCircle,
  Send,
  Users,
  CheckCircle2,
  Wallet,
  Sparkles,
  TrendingUp,
  Loader2,
  ChevronLeft,
} from "lucide-react";
import { useAppStore } from "@/lib/fitness/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toPersianDigits } from "@/lib/fitness/types";
import { toast } from "sonner";

// --- Types ---
interface ReferralStats {
  totalReferrals: number;
  successfulReferrals: number;
  totalEarned: number;
}

interface RecentReferral {
  id: string;
  displayName: string;
  status: "pending" | "purchased";
  createdAt: string;
}

interface ReferralData {
  referralCode: string;
  referralLink: string;
  stats: ReferralStats;
  recentReferrals: RecentReferral[];
  rewardAmount: number;
}

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

// --- Helper: format Jalali date ---
function formatJalaliDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function ReferralView() {
  const { setMainTab } = useAppStore();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  // --- فرم «دعوت با پیامک» (v32) ---
  const [friendName, setFriendName] = useState("");
  const [friendMobile, setFriendMobile] = useState("");
  const [sending, setSending] = useState(false); // ضد دابل‌ارسال
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null); // نام دوست برای پیام موفقیت
  // مبلغ هدیهٔ دعوت‌شونده — با GET /api/referral/invite به‌صورت تنبل واکشی می‌شود
  // (fallback: مبلغ پاداش معرف که پیش‌فرض سرور برای هدیهٔ دعوت‌شونده هم هست)
  const [inviteGiftAmount, setInviteGiftAmount] = useState<number | null>(null);

  // --- Fetch referral data on mount ---
  const fetchReferral = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/referral/code", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "خطا در دریافت کد معرفی");
      }
      const json = (await res.json()) as ReferralData;
      setData(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "خطای ناشناخته";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReferral();
  }, [fetchReferral]);

  // --- واکشی تنبل مبلغ هدیهٔ دعوت‌شونده (کم‌حجم، بی‌صدا — خطا مهم نیست) ---
  useEffect(() => {
    let cancelled = false;
    fetch("/api/referral/invite", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { giftAmount?: number } | null) => {
        if (!cancelled && json && typeof json.giftAmount === "number") {
          setInviteGiftAmount(json.giftAmount);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Copy link to clipboard ---
  async function handleCopyLink() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      toast.success("لینک معرفی کپی شد!");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = data.referralLink;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        toast.success("لینک معرفی کپی شد!");
        setTimeout(() => setCopied(false), 2500);
      } catch {
        toast.error("کپی لینک ناموفق بود");
      }
      document.body.removeChild(ta);
    }
  }

  // --- WhatsApp share ---
  function handleShareWhatsApp() {
    if (!data) return;
    const text = `سلام! 🏋️ من با فیتاپ تمرین می‌کنم و راضی‌ام. تو هم با این لینک ثبت‌نام کن تا هر دو ${toPersianDigits(data.rewardAmount.toLocaleString("en-US"))} تومان پاداش بگیریم! 🎁\n\n${data.referralLink}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // --- Telegram share ---
  function handleShareTelegram() {
    if (!data) return;
    const text = `سلام! 🏋️ من با فیتاپ تمرین می‌کنم و راضی‌ام. تو هم با این لینک ثبت‌نام کن تا هر دو ${toPersianDigits(data.rewardAmount.toLocaleString("en-US"))} تومان پاداش بگیریم! 🎁`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.referralLink)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // --- Native share (mobile) ---
  async function handleNativeShare() {
    if (!data) return;
    const shareData = {
      title: "دعوت به فیتاپ",
      text: `با این لینک ثبت‌نام کن تا هر دو ${toPersianDigits(data.rewardAmount.toLocaleString("en-US"))} تومان پاداش بگیریم! 🎁`,
      url: data.referralLink,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        handleCopyLink();
      }
    } catch {
      // user cancelled
    }
  }

  // --- تبدیل ارقام فارسی/عربی کیبورد به لاتین برای شمارهٔ موبایل (قبل از ارسال) ---
  function toEnglishDigits(s: string): string {
    return s
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  }

  // --- ارسال دعوت‌نامهٔ پیامکی ---
  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return; // ضد دابل‌سابمیت
    setInviteError(null);
    setInviteSuccess(null);
    setSending(true);
    try {
      const res = await fetch("/api/referral/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendName: friendName.trim(),
          friendMobile: toEnglishDigits(friendMobile.trim()),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        giftAmount?: number;
      };
      if (typeof json.giftAmount === "number") {
        setInviteGiftAmount(json.giftAmount);
      }
      if (res.ok && json.ok) {
        const name = friendName.trim();
        setInviteSuccess(name);
        toast.success(json.message || `دعوت‌نامه برای «${name}» ارسال شد ✅`);
        setFriendName("");
        setFriendMobile("");
      } else {
        const msg = json.error || "ارسال دعوت‌نامه ناموفق بود؛ دوباره تلاش کنید.";
        setInviteError(msg);
        toast.error(msg);
      }
    } catch {
      const msg = "ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.";
      setInviteError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-24 rounded-3xl" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">خطا در بارگذاری اطلاعات معرفی.</p>
        <Button onClick={fetchReferral} variant="outline" className="mt-4">
          تلاش مجدد
        </Button>
      </div>
    );
  }

  const { stats } = data;
  const pendingReferrals = stats.totalReferrals - stats.successfulReferrals;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-md"
            style={{ background: goldGradient }}
          >
            <Gift className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">معرفی به دوست</h1>
            <p className="text-xs text-muted-foreground">با هر معرفی، هر دو {toPersianDigits(data.rewardAmount.toLocaleString("en-US"))} تومان پاداش بگیر</p>
          </div>
        </div>
      </motion.div>

      {/* Hero card: referral link + share buttons */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-3xl p-5 sm:p-6 text-white shadow-lg relative overflow-hidden"
        style={{ background: goldGradient }}
      >
        {/* Decorative blobs */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-white/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="w-4 h-4" />
            <h2 className="font-bold text-sm">لینک معرفی اختصاصی شما</h2>
          </div>
          <p className="text-xs opacity-90 mb-4 leading-6">
            با معرفی فیتاپ به دوستانت، هر دو {toPersianDigits(data.rewardAmount.toLocaleString("en-US"))} تومان پاداش بگیرید! 🎁
          </p>

          {/* Link box */}
          <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-3 mb-3 border border-white/20">
            <div className="flex items-center gap-2">
              <span
                dir="ltr"
                className="flex-1 text-sm font-mono truncate select-all"
                title={data.referralLink}
              >
                {data.referralLink}
              </span>
              <button
                onClick={handleCopyLink}
                className="shrink-0 w-9 h-9 rounded-xl bg-white text-orange-600 flex items-center justify-center hover:bg-orange-50 transition shadow"
                aria-label="کپی لینک"
              >
                {copied ? <Check className="w-4 h-4" strokeWidth={3} /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Share buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleShareWhatsApp}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition text-sm font-bold border border-white/20"
            >
              <MessageCircle className="w-4 h-4" />
              واتساپ
            </button>
            <button
              onClick={handleShareTelegram}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition text-sm font-bold border border-white/20"
            >
              <Send className="w-4 h-4" />
              تلگرام
            </button>
            <button
              onClick={handleNativeShare}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 transition text-sm font-bold border border-white/20"
            >
              <Share2 className="w-4 h-4" />
              اشتراک‌گذاری
            </button>
          </div>
        </div>
      </motion.div>

      {/* دعوت با پیامک — کارت پرمیوم (v32) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Card className="p-5 shadow-sm border-orange-100">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0"
              style={{ background: goldGradient }}
            >
              <MessageSquareText className="w-4.5 h-4.5" />
            </div>
            <h3 className="font-bold text-sm">دعوت با پیامک 📨</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-6 mb-4">
            نام و شمارهٔ دوستت را بنویس؛ دعوت‌نامه با لینک اختصاصی تو برایش پیامک می‌شود.
          </p>

          <form onSubmit={handleInviteSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-friend-name" className="text-xs">
                نام دوست
              </Label>
              <Input
                id="invite-friend-name"
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                placeholder="مثلاً: علی"
                maxLength={40}
                autoComplete="off"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-friend-mobile" className="text-xs">
                شماره موبایل دوست
              </Label>
              <Input
                id="invite-friend-mobile"
                dir="ltr"
                inputMode="tel"
                value={friendMobile}
                onChange={(e) => setFriendMobile(e.target.value)}
                placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
                maxLength={16}
                autoComplete="off"
                className="rounded-xl text-left"
              />
            </div>

            <Button
              type="submit"
              disabled={sending}
              className="w-full min-h-11 rounded-xl text-white font-bold text-sm shadow-md disabled:opacity-70"
              style={{ background: goldGradient }}
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال ارسال…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  ارسال دعوت‌نامه
                </>
              )}
            </Button>
          </form>

          {/* بازخورد درون‌خطی: خطا (already_sent / no_template / ...) */}
          {inviteError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 leading-6">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{inviteError}</span>
            </div>
          )}
          {/* بازخورد درون‌خطی: موفقیت با نام دوست */}
          {inviteSuccess && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-xs text-emerald-800 leading-6">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>
                دعوت‌نامه برای «{inviteSuccess}» ارسال شد ✅ به‌محض ثبت‌نام و خرید اولین پلن، هدیهٔ دوطرفه فعال می‌شود.
              </span>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground mt-3 leading-5">
            هدیهٔ دعوت‌شونده:{" "}
            {toPersianDigits((inviteGiftAmount ?? data.rewardAmount).toLocaleString("en-US"))} تومان (قابل تغییر توسط مدیر)
          </p>
        </Card>
      </motion.div>

      {/* Stats grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-3 gap-3"
      >
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="کل معرفی‌ها"
          value={toPersianDigits(stats.totalReferrals)}
          tint="bg-orange-50 text-orange-600"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="موفق"
          value={toPersianDigits(stats.successfulReferrals)}
          tint="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="پاداش کل"
          value={`${toPersianDigits((stats.totalEarned).toLocaleString("en-US"))} ت`}
          tint="bg-amber-50 text-amber-600"
        />
      </motion.div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <Card className="p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-orange-600" />
            <h3 className="font-bold text-sm">چطور کار می‌کند؟</h3>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <HowItWorksStep
              step={1}
              title="لینک را بفرست"
              desc="لینک معرفی اختصاصی خودت را برای دوستانت بفرست."
              icon={<Share2 className="w-5 h-5" />}
            />
            <HowItWorksStep
              step={2}
              title="دوستت ثبت‌نام و خرید کنه"
              desc="دوستت با لینک شما ثبت‌نام می‌کند و اولین پلن را می‌خرد."
              icon={<Users className="w-5 h-5" />}
            />
            <HowItWorksStep
              step={3}
              title="هر دو پاداش بگیرید"
              desc={`وقتی دوستت اولین پلن را خرید، هر دو ${toPersianDigits(data.rewardAmount.toLocaleString("en-US"))} تومان پاداش می‌گیرید.`}
              icon={<Gift className="w-5 h-5" />}
              isLast
            />
          </div>
        </Card>
      </motion.div>

      {/* Recent referrals */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-orange-600" />
              <h3 className="font-bold text-sm">معرفی‌های اخیر</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {toPersianDigits(stats.totalReferrals)} نفر کل
              {pendingReferrals > 0 && (
                <span className="mr-2 text-amber-600">• {toPersianDigits(pendingReferrals)} در انتظار</span>
              )}
            </span>
          </div>

          {data.recentReferrals.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-16 h-16 mx-auto rounded-full bg-orange-50 flex items-center justify-center mb-3">
                <Gift className="w-8 h-8 text-orange-400" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">هنوز معرفی‌ای ندارید</p>
              <p className="text-xs text-muted-foreground">
                لینک معرفی خود را با دوستان به اشتراک بگذارید تا اولین پاداش خود را بگیرید!
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
              {data.recentReferrals.map((r) => (
                <ReferralRow key={r.id} referral={r} />
              ))}
            </div>
          )}
        </Card>
      </motion.div>

      {/* CTA: see plans / wallet */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="flex items-center justify-center gap-2 pt-2"
      >
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => setMainTab("plans")}
        >
          مشاهده پلن‌ها
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
      </motion.div>
    </div>
  );
}

// --- Sub-components ---

function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <Card className="p-3 sm:p-4 shadow-sm text-center">
      <div className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center mb-2 ${tint}`}>
        {icon}
      </div>
      <p className="text-base sm:text-lg font-black text-slate-900 leading-tight">{value}</p>
      <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </Card>
  );
}

function HowItWorksStep({
  step,
  title,
  desc,
  icon,
  isLast,
}: {
  step: number;
  title: string;
  desc: string;
  icon: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="relative p-3 rounded-2xl bg-orange-50/50 border border-orange-100">
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-black"
          style={{ background: goldGradient }}
        >
          {toPersianDigits(step)}
        </div>
        <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center text-orange-600 shadow-sm">
          {icon}
        </div>
        {!isLast && (
          <ChevronLeft className="hidden sm:block w-4 h-4 text-orange-300 mr-auto" />
        )}
      </div>
      <p className="font-bold text-sm mb-1">{title}</p>
      <p className="text-[11px] text-muted-foreground leading-5">{desc}</p>
    </div>
  );
}

function ReferralRow({ referral }: { referral: RecentReferral }) {
  const isPurchased = referral.status === "purchased";
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/70 transition">
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
          isPurchased ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
        }`}
      >
        {isPurchased ? <CheckCircle2 className="w-5 h-5" /> : <Loader2 className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate">{referral.displayName}</p>
        <p className="text-[10px] text-muted-foreground">{formatJalaliDate(referral.createdAt)}</p>
      </div>
      <span
        className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-lg ${
          isPurchased
            ? "bg-emerald-100 text-emerald-700"
            : "bg-amber-100 text-amber-700"
        }`}
      >
        {isPurchased ? "✓ خرید کرده" : "در انتظار"}
      </span>
    </div>
  );
}
