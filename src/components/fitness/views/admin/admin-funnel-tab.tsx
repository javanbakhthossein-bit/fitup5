"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v198 — تب «قیف فروش» پنل مدیریت (دیرکتیو مالک)
 * ═══════════════════════════════════════════════════════════════════════════
 * «تمام مراحل خرید رو در همه جا رویداد گذاری کنی و در پنل مدیر برام بیاری»
 *
 * پاسخ مستقیم به سؤالی که Clarity نتوانست بدهد:
 *   «کاربران دقیقاً در کدام مرحله خرید را ول می‌کنند و کدام خطای فنی مانع
 *    خرید شده؟»
 *
 * بخش‌ها:
 *   ① خط اصلی قیف — سشن/کاربر یکتا در هر مرحله + نرخ تبدیل پله‌ای + ریزش
 *   ② دو شاخهٔ تحویل — پیامک امن اینستاگرام vs رفتن به درگاه
 *   ③ شکست‌ها و بن‌بست‌ها — بن‌بست ایجاد پرداخت، خطای شبکه، لغو بازار، کد رد‌شده
 *   ④ خطاهای واقعی جاوااسکریپت — از ErrorLog (همان که Clarity جدا می‌شمارد)
 *   ⑤ تفکیک منبع ورود / دستگاه / پلن
 *   ⑥ رصد زنده — ۳۰ رویداد آخر با کاربر
 *   + بینش خودکار: بزرگ‌ترین ریزش خط قیف
 */

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  TrendingDown,
  AlertTriangle,
  Bug,
  Smartphone,
  Globe,
  MessageSquare,
  CreditCard,
  Zap,
  Users,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toPersianDigits, formatToman } from "@/lib/fitness/types";

interface FunnelRow {
  event: string;
  label: string;
  step: number;
  sessions: number;
  users: number;
  total: number;
  pctOfFirst: number;
  pctOfPrev: number | null;
}
interface FunnelData {
  ok: boolean;
  days: number;
  truncated: boolean;
  funnel: FunnelRow[];
  branches: { sms: { sessions: number; users: number }; gateway: { sessions: number; users: number } };
  side: { event: string; label: string; total: number; sessions: number }[];
  daily: { date: string; counts: Record<string, number> }[];
  breakdown: {
    sources: { key: string; opens: number; created: number; success: number }[];
    devices: { key: string; opens: number; created: number; success: number }[];
    plans: { key: string; opens: number; created: number; success: number }[];
  };
  payments: { successCount: number; successAmount: number; bySource: Record<string, number> };
  jsErrors: { message: string; count: number; topUrl: string; lastAt: string }[];
  recent: {
    event: string;
    label: string;
    createdAt: string;
    path: string | null;
    planId: string | null;
    amount: number | null;
    source: string | null;
    device: string | null;
    user: { name: string | null; mobile: string | null } | null;
  }[];
  dropOffInsight: string | null;
}

const RANGE_OPTIONS: { days: number; label: string }[] = [
  { days: 1, label: "امروز/۲۴ساعت" },
  { days: 3, label: "۳ روز" },
  { days: 7, label: "۷ روز" },
  { days: 30, label: "۳۰ روز" },
  { days: 0, label: "همه" },
];

const SOURCE_LABELS: Record<string, string> = {
  instagram: "اینستاگرام",
  app_android: "اپ اختصاصی",
  web: "وب",
  bazaar: "کافه‌بازار",
  unknown: "نامشخص",
};
const DEVICE_LABELS: Record<string, string> = {
  android: "اندروید",
  ios: "iOS",
  desktop: "دسکتاپ",
  unknown: "نامشخص",
};

const fa = (v: number) => toPersianDigits(Number(v || 0).toLocaleString("en-US"));

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "همین حالا";
  if (m < 60) return `${toPersianDigits(m)} دقیقه پیش`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${toPersianDigits(h)} ساعت پیش`;
  return `${toPersianDigits(Math.floor(h / 24))} روز پیش`;
}

export function AdminFunnelTab() {
  const [days, setDays] = useState(3);
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/funnel?days=${d}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`خطای سرور ${res.status}`);
      const json = await res.json();
      if (!json?.ok) throw new Error("پاسخ نامعتبر");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطای نامشخص");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
    // بروزرسانی خودکار هر ۶۰ ثانیه — رصد زنده بدون فشار دستی
    const t = setInterval(() => void load(days), 60_000);
    return () => clearInterval(t);
  }, [days, load]);

  const maxSessions = data?.funnel?.[0]?.sessions ?? 0;

  return (
    <div className="space-y-4">
      {/* ─── هدر + بازهٔ زمانی ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-100 text-amber-600">
            <TrendingDown className="w-4.5 h-4.5" />
          </span>
          <div>
            <h3 className="font-bold text-sm text-slate-900">قیف فروش — تمام مراحل خرید</h3>
            <p className="text-[11px] text-muted-foreground">
              هر ۶۰ ثانیه خودبه‌خود بروز می‌شود؛ خطاها از لاگ واقعی جاوااسکریپت سایت می‌آید
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                days === r.days
                  ? "bg-primary text-primary-foreground glow-gold-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void load(days)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error} — دوباره تلاش کنید.
        </div>
      )}

      {loading && !data && (
        <div className="space-y-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* ─── بینش خودکار + درآمد ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 flex items-start gap-2.5">
              <Zap className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-black text-amber-700 mb-0.5">بینش خودکار ریزش</p>
                <p className="text-xs font-bold text-slate-800 leading-6">
                  {data.dropOffInsight ?? "دادهٔ کافی برای تحلیل ریزش نیست (هر مرحله کمتر از ۵ سشن)."}
                </p>
              </div>
            </div>
            <div className="rounded-xl border p-3.5 bg-card">
              <p className="text-[11px] text-muted-foreground font-bold">خرید موفق (جدول پرداخت‌ها)</p>
              <p className="text-lg font-black font-stat text-emerald-600 mt-1">
                {fa(data.payments.successCount)} پرداخت
              </p>
              <p className="text-[11px] text-muted-foreground font-stat">
                {toPersianDigits(formatToman(data.payments.successAmount))} تومان
              </p>
            </div>
          </div>

          {/* ─── خط اصلی قیف ─── */}
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider mb-3">
              خط اصلی خرید — سشن یکتا در هر مرحله
            </p>
            <div className="space-y-2.5">
              {data.funnel.map((row, i) => {
                const width = maxSessions > 0 ? Math.max(3, (row.sessions / maxSessions) * 100) : 0;
                const zero = row.sessions === 0;
                return (
                  <div key={row.event}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-md bg-muted flex items-center justify-center text-[10px] font-stat text-muted-foreground">
                          {toPersianDigits(i + 1)}
                        </span>
                        {row.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0 font-stat">
                        {fa(row.sessions)} سشن
                        {row.users > 0 && <> · {fa(row.users)} کاربر</>}
                        {row.pctOfPrev != null && (
                          <span className={row.pctOfPrev >= 70 ? "text-emerald-600" : row.pctOfPrev >= 40 ? "text-amber-600" : "text-rose-600"}>
                            {" "}· {toPersianDigits(row.pctOfPrev)}٪ از مرحلهٔ قبل
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-7 rounded-lg bg-muted/50 overflow-hidden relative">
                      <div
                        className={`h-full rounded-lg transition-all duration-500 ${zero ? "bg-muted" : "bg-gradient-to-l from-amber-400 to-orange-500"}`}
                        style={{ width: `${width}%` }}
                      />
                      <span className="absolute inset-y-0 left-3 flex items-center text-[11px] font-black font-stat text-slate-700">
                        {row.pctOfFirst > 0 || row.sessions > 0 ? `${toPersianDigits(row.pctOfFirst)}٪` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {data.truncated && (
              <p className="text-[10px] text-muted-foreground mt-2">
                * حجم رویدادها بسیار بالاست؛ محاسبه روی آخرین سقف ایمنی انجام شده.
              </p>
            )}
          </div>

          {/* ─── شاخه‌های تحویل ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <CreditCard className="w-4.5 h-4.5" />
                </span>
                <div>
                  <p className="text-xs font-black text-slate-900">شاخهٔ درگاه (زرین‌پال)</p>
                  <p className="text-[10px] text-muted-foreground">انتقال به درگاه از وب/اپ/اینستاگرام</p>
                </div>
              </div>
              <p className="text-lg font-black font-stat text-slate-900">
                {fa(data.branches.gateway.sessions)} <span className="text-xs font-bold text-muted-foreground">سشن</span>
                <span className="text-xs font-bold text-muted-foreground mr-2">· {fa(data.branches.gateway.users)} کاربر</span>
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                  <MessageSquare className="w-4.5 h-4.5" />
                </span>
                <div>
                  <p className="text-xs font-black text-slate-900">شاخهٔ پیامک امن (اینستاگرام)</p>
                  <p className="text-[10px] text-muted-foreground">ارسال لینک پرداخت امن پیامکی</p>
                </div>
              </div>
              <p className="text-lg font-black font-stat text-slate-900">
                {fa(data.branches.sms.sessions)} <span className="text-xs font-bold text-muted-foreground">سشن</span>
                <span className="text-xs font-bold text-muted-foreground mr-2">· {fa(data.branches.sms.users)} کاربر</span>
              </p>
            </div>
          </div>

          {/* ─── شکست‌ها و بن‌بست‌ها + خطاهای JS ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-2xl border bg-card p-4">
              <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider mb-3">
                شکست‌ها و بن‌بست‌ها (کجا خرید شکسته می‌شود)
              </p>
              {data.side.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">هیچ شکستی ثبت نشده ✨</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pl-1">
                  {data.side.map((s) => (
                    <div key={s.event} className="flex items-center justify-between gap-2 rounded-xl bg-rose-50/70 border border-rose-100 px-3 py-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 min-w-0">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        <span className="truncate">{s.label}</span>
                      </span>
                      <span className="text-xs font-black font-stat text-rose-600 shrink-0">{fa(s.total)}×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border bg-card p-4">
              <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" />
                خطاهای واقعی جاوااسکریپت (لاگ سایت — دقیق‌تر از Clarity)
              </p>
              {data.jsErrors.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">هیچ خطای JS در این بازه ثبت نشده ✨</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pl-1">
                  {data.jsErrors.map((e, i) => (
                    <div key={i} className="rounded-xl bg-muted/40 border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-800 truncate font-mono" dir="ltr" title={e.message}>
                          {e.message}
                        </span>
                        <span className="text-xs font-black font-stat text-amber-600 shrink-0">{fa(e.count)}×</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground truncate font-mono" dir="ltr" title={e.topUrl}>
                          {e.topUrl}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(e.lastAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── تفکیک منبع / دستگاه / پلن ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <BreakCard title="منبع ورود" icon={<Globe className="w-3.5 h-3.5" />} rows={data.breakdown.sources.map((r) => ({ ...r, key: SOURCE_LABELS[r.key] ?? r.key }))} />
            <BreakCard title="دستگاه" icon={<Smartphone className="w-3.5 h-3.5" />} rows={data.breakdown.devices.map((r) => ({ ...r, key: DEVICE_LABELS[r.key] ?? r.key }))} />
            <BreakCard title="پلن" icon={<Users className="w-3.5 h-3.5" />} rows={data.breakdown.plans} />
          </div>

          {/* ─── رصد زنده ─── */}
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <MousePointerClick className="w-3.5 h-3.5" />
              رصد زنده — آخرین رویدادها
            </p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pl-1">
              {data.recent.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[11px] rounded-lg px-2.5 py-1.5 hover:bg-muted/40">
                  <span className="font-bold text-slate-800 truncate">
                    {r.label}
                    {r.planId && <span className="text-muted-foreground"> · {r.planId}</span>}
                    {r.amount != null && <span className="font-stat text-emerald-600"> · {toPersianDigits(formatToman(r.amount))} ت</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0 flex items-center gap-1.5">
                    {r.user?.mobile ? `${r.user.name || ""} · ${r.user.mobile.replace(/(\d{4})\d+(\d{3})/, "$1***$2")}` : "ناشناس"}
                    <span className="opacity-60">· {timeAgo(r.createdAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BreakCard({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { key: string; opens: number; created: number; success: number }[];
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">—</p>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-4 gap-1 text-[9.5px] text-muted-foreground font-bold px-2">
            <span />
            <span className="text-center">مدال</span>
            <span className="text-center">پرداخت</span>
            <span className="text-center">موفق</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-4 gap-1 items-center text-[11px] rounded-lg px-2 py-1.5 odd:bg-muted/30">
              <span className="font-bold text-slate-800 truncate">{r.key}</span>
              <span className="text-center font-stat font-bold text-slate-700">{fa(r.opens)}</span>
              <span className="text-center font-stat font-bold text-amber-600">{fa(r.created)}</span>
              <span className="text-center font-stat font-black text-emerald-600">{fa(r.success)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
