"use client";

/**
 * تب «معرفی به دوستان» — پنل ادمین
 *
 * self-contained: fetch خودش + state خودش (بدون prop) — برای ادغام در
 * admin-overlay.tsx کافی است <AdminReferralTab /> رندر شود.
 * API: GET /api/admin/referral  (?page/?pageSize/?q لیست | ?userId= جزئیات)
 *
 * استایل: شیشه‌ای ملایم (rounded-2xl + border + bg-white/70) با لهجهٔ
 * نارنجی/امرالدی/امبر — هم‌خانواده با بنرهای progress-view (بدون indigo/blue).
 * اعداد و تاریخ‌ها فارسی (toPersianDigits + Intl fa-IR).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Users,
  UserCheck,
  ReceiptText,
  Gift,
  RefreshCw,
  Search,
  Loader2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toPersianDigits } from "@/lib/fitness/types";

/* ─────────────────────────── انواع دادهٔ API ─────────────────────────── */

interface ReferralSummary {
  totalReferrers: number;
  totalInvited: number;
  totalPurchasers: number;
  revenueFromReferred: number;
  rewardsPaidTotal: number;
  rewardsPaidFallbackUsed: boolean;
  rewardsPendingCount: number;
  rewardsPendingAmount: number;
  conversionRate: number;
  rewardPerReferral: number;
}

interface ReferralRow {
  userId: string;
  name: string | null;
  mobileMasked: string;
  avatarUrl: string | null;
  code: string | null;
  invitedCount: number;
  purchaserCount: number;
  revenue: number;
  rewardPaidAmount: number;
  rewardPendingCount: number;
  firstInviteAt: string | null;
  lastInviteAt: string | null;
}

interface InviteeRow {
  userId: string;
  name: string | null;
  mobileMasked: string;
  avatarUrl: string | null;
  joinedAt: string;
  hasPurchase: boolean;
  planName: string | null;
  amount: number | null;
  paidAt: string | null;
  rewardStatus: "paid" | "pending" | "none";
}

interface ReferralDetail {
  referrer: {
    userId: string;
    name: string | null;
    mobileMasked: string;
    avatarUrl: string | null;
    code: string | null;
    createdAt: string;
    invitedCount: number;
    purchaserCount: number;
    revenue: number;
    rewardPaidAmount: number;
    rewardPendingCount: number;
  };
  invitees: InviteeRow[];
  inviteesTotal: number;
  truncated: boolean;
  cap: number;
}

/* ─────────────────────────── هلپرهای محلی ─────────────────────────── */

const PAGE_SIZE = 20;

/** عدد فارسی با جداکنندهٔ سه‌رقمی (الگوی referral.ts) */
function fmtNum(n: number): string {
  return toPersianDigits(Math.round(n).toLocaleString("en-US"));
}

/** تاریخ فارسی کوتاه — Intl fa-IR (خروجی خودش ارقام فارسی دارد) */
function faDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

const PLAN_FA: Record<string, string> = {
  basic: "اقتصادی",
  standard: "استاندارد",
  advanced: "پیشرفته",
  ultimate: "حرفه‌ای",
};

function planFa(plan: string | null | undefined): string | null {
  if (!plan) return null;
  return PLAN_FA[plan] ?? plan;
}

/** کلاس اسکرول‌بار سفارشی برای لیست‌های بلند */
const SCROLLBAR_CLS =
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full";

/* ─────────────────────────── کارت KPI شیشه‌ای ─────────────────────────── */

type Tone = "orange" | "emerald" | "amber";

const TONE_TILE: Record<Tone, string> = {
  orange: "bg-gradient-to-br from-orange-500 to-amber-500 text-white",
  emerald: "bg-gradient-to-br from-emerald-500 to-teal-500 text-white",
  amber: "bg-gradient-to-br from-amber-500 to-orange-500 text-white",
};

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  subTone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  label: string;
  value: string;
  sub: string;
  subTone: "slate" | "amber" | "emerald";
}) {
  const subCls =
    subTone === "amber"
      ? "text-amber-700"
      : subTone === "emerald"
        ? "text-emerald-700"
        : "text-slate-500";
  return (
    <div className="p-4 rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${TONE_TILE[tone]}`}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <p className="text-xs font-bold text-slate-600">{label}</p>
      </div>
      <p className="mt-2.5 text-xl font-black text-slate-900 tabular-nums">{value}</p>
      <p className={`mt-1 text-[11px] font-medium ${subCls}`}>{sub}</p>
    </div>
  );
}

/* ─────────────────────────── تب اصلی ─────────────────────────── */

export function AdminReferralTab() {
  const [data, setData] = useState<{
    summary: ReferralSummary;
    list: ReferralRow[];
    total: number;
  } | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");

  // جزئیات معرف (Dialog)
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReferralDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (targetPage: number, query: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
      });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/admin/referral?${params}&_t=${Date.now()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "خطا در بارگذاری داده‌های معرفی");
      setData({ summary: json.summary, list: json.list || [], total: json.total || 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در بارگذاری داده‌های معرفی");
    } finally {
      setInitialLoading(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, q);
  }, [page, q, load]);

  // جستجو با تأخیر (debounce) — ریست به صفحهٔ اول
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQ(searchInput);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  async function openDetail(row: ReferralRow) {
    setDetailUserId(row.userId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(
        `/api/admin/referral?userId=${encodeURIComponent(row.userId)}&_t=${Date.now()}`,
        { cache: "no-store", credentials: "include" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "خطا در بارگذاری جزئیات معرف");
      setDetail(json.detail ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در بارگذاری جزئیات معرف");
      setDetailUserId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  const summary = data?.summary ?? null;
  const list = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const isInitial = initialLoading;

  return (
    <div dir="rtl" className="p-4 space-y-4 max-w-7xl mx-auto">
      {/* ─── ۱. هدر ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shrink-0 shadow-sm">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-40">
          <h2 className="text-base font-black text-slate-900">معرفی به دوستان</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            کیا دعوت کرده‌اند، چه خریدهایی ثبت شده و پاداش‌های پرداخت‌شده و در انتظار
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
          onClick={() => load(page, q)}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          بروزرسانی
        </Button>
      </div>

      {/* ─── ۲. کارت‌های KPI ─── */}
      {isInitial ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={Users}
            tone="orange"
            label="دعوت‌شده‌ها"
            value={fmtNum(summary.totalInvited)}
            sub={`معرف فعال: ${fmtNum(summary.totalReferrers)} نفر`}
            subTone="slate"
          />
          <KpiCard
            icon={UserCheck}
            tone="emerald"
            label="خریدهای حاصل"
            value={fmtNum(summary.totalPurchasers)}
            sub={`نرخ تبدیل: ${toPersianDigits(summary.conversionRate)}٪`}
            subTone="slate"
          />
          <KpiCard
            icon={ReceiptText}
            tone="amber"
            label="درآمد حاصل (تومان)"
            value={fmtNum(summary.revenueFromReferred)}
            sub={`پاداش هر معرفی: ${fmtNum(summary.rewardPerReferral)} تومان`}
            subTone="slate"
          />
          <KpiCard
            icon={Gift}
            tone="emerald"
            label="پاداش پرداخت‌شده (تومان)"
            value={fmtNum(summary.rewardsPaidTotal)}
            sub={`در انتظار: ${fmtNum(summary.rewardsPendingAmount)} تومان (${fmtNum(summary.rewardsPendingCount)} نفر)`}
            subTone={summary.rewardsPendingCount > 0 ? "amber" : "emerald"}
          />
        </div>
      ) : null}

      {/* ─── ۳. جستجو + جدول ─── */}
      <Card className="p-4 border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm">
        {/* نوار جستجو */}
        <div className="relative mb-4">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="جستجو: نام، شماره موبایل یا کد معرفی…"
            className="pr-9 h-10 text-sm bg-white/80 border-slate-200 focus-visible:ring-orange-300"
            aria-label="جستجوی معرف‌ها"
          />
          {loading && !isInitial && (
            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-400 animate-spin" />
          )}
        </div>

        {isInitial ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : list.length === 0 ? (
          /* ─── ۴. حالت خالی ─── */
          <div className="py-14 flex flex-col items-center text-center">
            <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center">
              <Users className="w-12 h-12 text-slate-300" />
            </div>
            <p className="mt-4 text-sm font-bold text-slate-600">
              {q ? "نتیجه‌ای برای این جستجو پیدا نشد" : "هنوز کسی دوستانش را دعوت نکرده"}
            </p>
            <p className="mt-1 text-[11px] text-slate-400 max-w-xs leading-relaxed">
              {q
                ? "نام، شماره موبایل یا کد معرف دیگری را امتحان کنید."
                : "با اولین خریدِ هر کاربرِ دعوت‌شده، آمار معرفی و پاداش‌ها همین‌جا نمایش داده می‌شود."}
            </p>
          </div>
        ) : (
          <>
            {/* جدول — تبلت/دسکتاپ */}
            <div className="hidden md:block rounded-xl border border-slate-200/70 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="text-right text-xs font-bold text-slate-500">کاربر</TableHead>
                    <TableHead className="text-right text-xs font-bold text-slate-500">کد معرفی</TableHead>
                    <TableHead className="text-center text-xs font-bold text-slate-500">دعوت‌شده</TableHead>
                    <TableHead className="text-center text-xs font-bold text-slate-500">خرید</TableHead>
                    <TableHead className="text-right text-xs font-bold text-slate-500">درآمد (تومان)</TableHead>
                    <TableHead className="text-right text-xs font-bold text-slate-500">پاداش</TableHead>
                    <TableHead className="text-right text-xs font-bold text-slate-500">آخرین دعوت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={loading ? "opacity-50 transition-opacity" : ""}>
                  {list.map((row) => (
                    <TableRow
                      key={row.userId}
                      className="cursor-pointer"
                      onClick={() => openDetail(row)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openDetail(row);
                      }}
                      aria-label={`جزئیات معرف ${row.name || row.mobileMasked}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="w-8 h-8 border border-slate-200">
                            {row.avatarUrl ? (
                              <AvatarImage src={row.avatarUrl} alt={row.name || "کاربر"} />
                            ) : null}
                            <AvatarFallback className="bg-orange-100 text-orange-700 text-xs font-bold">
                              {(row.name || "؟").charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate max-w-36">
                              {row.name || "کاربر فیتاپ"}
                            </p>
                            <p className="text-[11px] text-slate-400 tabular-nums" dir="ltr">
                              {row.mobileMasked}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-bold text-slate-600 bg-slate-100 rounded-md px-2 py-1" dir="ltr">
                          {row.code || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-sm font-bold text-slate-700 tabular-nums">
                        {fmtNum(row.invitedCount)}
                      </TableCell>
                      <TableCell className="text-center text-sm font-bold text-emerald-700 tabular-nums">
                        {fmtNum(row.purchaserCount)}
                      </TableCell>
                      <TableCell className="text-sm font-black text-slate-800 tabular-nums">
                        {fmtNum(row.revenue)}
                      </TableCell>
                      <TableCell>
                        {row.rewardPendingCount > 0 ? (
                          <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 font-bold">
                            در انتظار {fmtNum(row.rewardPendingCount)} نفر
                          </Badge>
                        ) : row.purchaserCount > 0 ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 font-bold">
                            پرداخت شده
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">بدون خرید</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 tabular-nums">
                        {faDate(row.lastInviteAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* کارت‌های عمودی — موبایل */}
            <div className={`md:hidden space-y-3 ${loading ? "opacity-50 transition-opacity" : ""}`}>
              {list.map((row) => (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => openDetail(row)}
                  className="w-full text-right p-3.5 rounded-xl border border-slate-200/80 bg-white/80 active:bg-slate-50 transition"
                  aria-label={`جزئیات معرف ${row.name || row.mobileMasked}`}
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar className="w-9 h-9 border border-slate-200">
                      {row.avatarUrl ? (
                        <AvatarImage src={row.avatarUrl} alt={row.name || "کاربر"} />
                      ) : null}
                      <AvatarFallback className="bg-orange-100 text-orange-700 text-xs font-bold">
                        {(row.name || "؟").charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {row.name || "کاربر فیتاپ"}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums" dir="ltr">
                        {row.mobileMasked}
                        {row.code ? ` · ${row.code}` : ""}
                      </p>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 py-1.5">
                      <p className="text-[10px] text-slate-400">دعوت‌شده</p>
                      <p className="text-sm font-black text-slate-700 tabular-nums">{fmtNum(row.invitedCount)}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50/70 py-1.5">
                      <p className="text-[10px] text-emerald-600/80">خرید</p>
                      <p className="text-sm font-black text-emerald-700 tabular-nums">{fmtNum(row.purchaserCount)}</p>
                    </div>
                    <div className="rounded-lg bg-orange-50/70 py-1.5">
                      <p className="text-[10px] text-orange-600/80">درآمد (تومان)</p>
                      <p className="text-sm font-black text-orange-700 tabular-nums">{fmtNum(row.revenue)}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    {row.rewardPendingCount > 0 ? (
                      <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 font-bold text-[10px]">
                        در انتظار {fmtNum(row.rewardPendingCount)} نفر
                      </Badge>
                    ) : row.purchaserCount > 0 ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 font-bold text-[10px]">
                        پرداخت شده
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-slate-400">بدون خرید</span>
                    )}
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      آخرین دعوت: {faDate(row.lastInviteAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* ─── صفحه‌بندی ─── */}
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0 border-slate-200"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                aria-label="صفحهٔ قبل"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <span className="text-xs font-bold text-slate-600 tabular-nums px-2">
                صفحهٔ {toPersianDigits(page)} از {toPersianDigits(totalPages)}
                <span className="text-slate-400 font-medium"> ({fmtNum(total)} معرف)</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0 border-slate-200"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                aria-label="صفحهٔ بعد"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* ─── دیالوگ جزئیات معرف ─── */}
      <Dialog open={!!detailUserId} onOpenChange={(o) => !o && setDetailUserId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" dir="rtl">
          {detailLoading || !detail ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          ) : (
            <>
              <DialogHeader className="text-right shrink-0">
                <DialogTitle className="flex items-center gap-3">
                  <Avatar className="w-10 h-10 border border-slate-200">
                    {detail.referrer.avatarUrl ? (
                      <AvatarImage src={detail.referrer.avatarUrl} alt={detail.referrer.name || "معرف"} />
                    ) : null}
                    <AvatarFallback className="bg-orange-100 text-orange-700 text-sm font-bold">
                      {(detail.referrer.name || "؟").charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-slate-900 truncate">
                      {detail.referrer.name || "کاربر فیتاپ"}
                    </span>
                    <span className="block text-[11px] font-medium text-slate-400 tabular-nums" dir="ltr">
                      {detail.referrer.mobileMasked}
                    </span>
                  </span>
                  {detail.referrer.code ? (
                    <Badge variant="outline" className="font-bold text-[10px] border-orange-200 text-orange-700 bg-orange-50" dir="ltr">
                      {detail.referrer.code}
                    </Badge>
                  ) : null}
                </DialogTitle>
                <DialogDescription className="text-[11px] leading-relaxed">
                  لیست دعوت‌شده‌های این کاربر و وضعیت خرید و پاداش هر کدام — عضویت از {faDate(detail.referrer.createdAt)}
                </DialogDescription>
              </DialogHeader>

              {/* آمار معرف */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
                <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                  <p className="text-[10px] text-slate-400">دعوت‌شده</p>
                  <p className="text-sm font-black text-slate-700 tabular-nums">{fmtNum(detail.referrer.invitedCount)}</p>
                </div>
                <div className="rounded-xl bg-emerald-50/70 p-2.5 text-center">
                  <p className="text-[10px] text-emerald-600/80">خرید</p>
                  <p className="text-sm font-black text-emerald-700 tabular-nums">{fmtNum(detail.referrer.purchaserCount)}</p>
                </div>
                <div className="rounded-xl bg-orange-50/70 p-2.5 text-center">
                  <p className="text-[10px] text-orange-600/80">درآمد (تومان)</p>
                  <p className="text-sm font-black text-orange-700 tabular-nums">{fmtNum(detail.referrer.revenue)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                  <p className="text-[10px] text-slate-400">پاداش گرفته (تومان)</p>
                  <p className="text-sm font-black text-slate-700 tabular-nums">{fmtNum(detail.referrer.rewardPaidAmount)}</p>
                </div>
              </div>

              {detail.referrer.rewardPendingCount > 0 && (
                <div className="shrink-0 mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2">
                  <Gift className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-[11px] font-bold text-amber-800 leading-relaxed">
                    پاداش {fmtNum(detail.referrer.rewardPendingCount)} دعوت‌شدهٔ خریدکرده هنوز پرداخت نشده است.
                  </p>
                </div>
              )}

              {/* لیست دعوت‌شده‌ها */}
              <div className="mt-3 flex-1 min-h-0">
                <div className={`max-h-80 overflow-y-auto -mx-1 px-1 space-y-2 ${SCROLLBAR_CLS}`}>
                  {detail.invitees.map((inv) => (
                    <div
                      key={inv.userId}
                      className="p-3 rounded-xl border border-slate-200/80 bg-white/80 flex items-center gap-3"
                    >
                      <Avatar className="w-9 h-9 border border-slate-200 shrink-0">
                        {inv.avatarUrl ? (
                          <AvatarImage src={inv.avatarUrl} alt={inv.name || "دعوت‌شده"} />
                        ) : null}
                        <AvatarFallback
                          className={`text-xs font-bold ${
                            inv.hasPurchase
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {(inv.name || "؟").charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {inv.name || "کاربر فیتاپ"}
                        </p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          عضویت: {faDate(inv.joinedAt)}
                          {inv.hasPurchase && inv.paidAt ? ` · خرید: ${faDate(inv.paidAt)}` : ""}
                        </p>
                      </div>
                      <div className="text-left shrink-0">
                        {inv.hasPurchase ? (
                          <>
                            <p className="text-xs font-black text-emerald-700 tabular-nums">
                              {fmtNum(inv.amount ?? 0)} تومان
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {planFa(inv.planName) ? `پلن ${planFa(inv.planName)}` : "—"}
                            </p>
                          </>
                        ) : (
                          <p className="text-[11px] text-slate-400">—</p>
                        )}
                      </div>
                      {inv.rewardStatus === "paid" ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 text-[10px] font-bold shrink-0">
                          پاداش پرداخت شد
                        </Badge>
                      ) : inv.rewardStatus === "pending" ? (
                        <Badge className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100 text-[10px] font-bold shrink-0">
                          در انتظار پاداش
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-bold text-slate-400 border-slate-200 bg-slate-50 shrink-0">
                          خرید نکرده
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {detail.truncated && (
                <p className="shrink-0 mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
                  تعداد دعوت‌شده‌ها زیاد است — {fmtNum(detail.invitees.length)} دعوت‌شدهٔ نخست از مجموع {fmtNum(detail.inviteesTotal)} نفر نمایش داده می‌شود.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
