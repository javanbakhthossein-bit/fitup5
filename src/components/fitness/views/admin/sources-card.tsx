"use client";

/**
 * ─── v178 — کارت داشبورد «منبع کاربران و فروش» ───
 *
 * دیرکتیو مالک: «بدونم ریفرهای سایت چه جوری عمل می‌کنند و ثبت‌نام‌کننده‌ها و
 * مشتری‌هامون از کجان» — ثبت‌نام‌ها + خریداران + درآمد per منبع
 * (اینستاگرام / گوگل / کافه‌بازار / اپ اختصاصی / وب / سایر).
 */

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Instagram, Globe, Store, Smartphone, Search, HelpCircle, Loader2, RefreshCw, Users, ShoppingCart, Wallet } from "lucide-react";
import { toPersianDigits, formatToman } from "@/lib/fitness/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const SOURCE_META: Record<string, { icon: any; color: string }> = {
  instagram: { icon: Instagram, color: "#e1306c" },
  google: { icon: Search, color: "#34a853" },
  cafebazaar: { icon: Store, color: "#f97316" },
  app_panel: { icon: Smartphone, color: "#a855f7" },
  web: { icon: Globe, color: "#0ea5e9" },
  other: { icon: HelpCircle, color: "#94a3b8" },
  unknown: { icon: HelpCircle, color: "#cbd5e1" },
};

interface SourceRow {
  source: string;
  label: string;
  registrants: number;
  registrantsRange: number;
  buyers: number;
  buyersRange: number;
  revenue: number;
  revenueRange: number;
  purchases: number;
  purchasesRange: number;
  convPct: number;
}

interface SourcesData {
  rows: SourceRow[];
  totals: {
    registrants: number;
    registrantsRange: number;
    unknownRegistrants: number;
    buyers: number;
    revenue: number;
    revenueRange: number;
    referredTotal: number;
    referredRange: number;
    convPctAll: number;
  };
}

export function AdminSourcesCard() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<SourcesData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(d = days) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/sources?days=${d}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "خطا");
      setData(json);
    } catch {
      // بی‌صدا — کارت نباید داشبورد را بشکند
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load(days);
  }, [days]);

  const rows = (data?.rows ?? []).filter((r) => r.registrants > 0 || r.buyers > 0 || r.revenue > 0);

  return (
    <Card className="glass p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-black">منبع کاربران و فروش</h3>
          <span className="text-[10px] text-muted-foreground">ثبت‌نام و خرید از کدام منبع آمده؟</span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[130px] h-8 rounded-xl text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">۷ روز اخیر</SelectItem>
              <SelectItem value="30">۳۰ روز اخیر</SelectItem>
              <SelectItem value="90">۹۰ روز اخیر</SelectItem>
              <SelectItem value="365">۱ سال اخیر</SelectItem>
              <SelectItem value="0">همهٔ زمان‌ها</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 rounded-xl gap-1" onClick={() => load()} disabled={busy}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* خلاصه */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <div className="p-3 rounded-xl bg-muted/40 border">
              <div className="text-[10px] text-muted-foreground mb-0.5">کل ثبت‌نامی‌ها</div>
              <div className="text-lg font-black font-stat">{toPersianDigits(data.totals.registrants)}</div>
              <div className="text-[10px] text-emerald-600">+{toPersianDigits(data.totals.registrantsRange)} در بازه</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border">
              <div className="text-[10px] text-muted-foreground mb-0.5">خریداران (کل)</div>
              <div className="text-lg font-black font-stat text-emerald-600">{toPersianDigits(data.totals.buyers)}</div>
              <div className="text-[10px] text-muted-foreground">نرخ تبدیل {toPersianDigits(data.totals.convPctAll)}٪</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border">
              <div className="text-[10px] text-muted-foreground mb-0.5">درآمد کل</div>
              <div className="text-lg font-black font-stat text-amber-600">{formatToman(data.totals.revenue)}</div>
              <div className="text-[10px] text-emerald-600">{formatToman(data.totals.revenueRange)} در بازه</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border">
              <div className="text-[10px] text-muted-foreground mb-0.5">با لینک معرفی دوستان</div>
              <div className="text-lg font-black font-stat">{toPersianDigits(data.totals.referredTotal)}</div>
              <div className="text-[10px] text-emerald-600">+{toPersianDigits(data.totals.referredRange)} در بازه</div>
            </div>
          </div>

          {/* نمودار */}
          {rows.length > 0 && (
            <div className="h-44 mb-4" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows.map((r) => ({ name: r.label, ثبت‌نام: r.registrants, خریدار: r.buyers }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={34} />
                  <Tooltip contentStyle={{ direction: "rtl", fontSize: 12, borderRadius: 12 }} />
                  <Bar dataKey="ثبت‌نام" radius={[6, 6, 0, 0]}>
                    {rows.map((r) => (
                      <Cell key={r.source} fill={SOURCE_META[r.source]?.color ?? "#94a3b8"} />
                    ))}
                  </Bar>
                  <Bar dataKey="خریدار" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* جدول */}
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] text-muted-foreground">
                  <th className="px-2 py-2 text-right">منبع</th>
                  <th className="px-2 py-2">ثبت‌نام</th>
                  <th className="px-2 py-2">در بازه</th>
                  <th className="px-2 py-2">خریدار</th>
                  <th className="px-2 py-2">درآمد</th>
                  <th className="px-2 py-2">در بازه</th>
                  <th className="px-2 py-2">نرخ تبدیل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = SOURCE_META[r.source]?.icon ?? HelpCircle;
                  const color = SOURCE_META[r.source]?.color ?? "#94a3b8";
                  return (
                    <tr key={r.source} className="border-b last:border-0 hover:bg-muted/30 transition">
                      <td className="px-2 py-2 text-right">
                        <span className="inline-flex items-center gap-1.5 font-bold">
                          <span className="w-5 h-5 rounded-lg flex items-center justify-center" style={{ background: `${color}1a` }}>
                            <Icon className="w-3 h-3" style={{ color }} />
                          </span>
                          {r.label}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center font-stat font-bold">{toPersianDigits(r.registrants)}</td>
                      <td className="px-2 py-2 text-center text-emerald-600 font-stat">+{toPersianDigits(r.registrantsRange)}</td>
                      <td className="px-2 py-2 text-center font-stat font-bold text-emerald-600">{toPersianDigits(r.buyers)}</td>
                      <td className="px-2 py-2 text-center font-stat font-bold text-amber-600">{formatToman(r.revenue)}</td>
                      <td className="px-2 py-2 text-center font-stat text-amber-600">{formatToman(r.revenueRange)}</td>
                      <td className="px-2 py-2 text-center font-stat">{toPersianDigits(r.convPct)}٪</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      هنوز داده‌ای ثبت نشده — کاربران تازه با منبع ثبت می‌شوند.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {data.totals.unknownRegistrants > 0 && (
            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
              {toPersianDigits(data.totals.unknownRegistrants)} کاربر قدیمیِ قبل از این قابلیت «نامشخص» هستند؛ بخشی از آن‌ها (اپ بازار/اپ اختصاصی/اینستا) با اسکریپت سمت سرور backfill می‌شوند.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
