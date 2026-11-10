"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Smartphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toPersianDigits } from "@/lib/fitness/types";
import {
  isFitUpNativeApp,
  getNativeNotificationPermissionStatus,
  requestNativeNotificationPermission,
} from "@/lib/fitness/app-bridge";

/**
 * کارت «اعلان پوش (FCM)» — v223 / ارتقای تشخیصی v227
 *
 * گزارش مالک: «گام ۲ را زدم، ۲۰۰ داد ولی نوتیف نمی‌رسد» — شایع‌ترین ریشه‌ها
 * حالا مستقیم در همین کارت دیده و حل می‌شوند:
 *  ۱) مجوز اعلان اندروید ۱۳+ (POST_NOTIFICATIONS) داده نشده → سرور به گوگل
 *     تحویل می‌دهد (200/delivered) ولی گوشی نوتیف را بی‌صدا دور می‌ریزد.
 *     ← در اپ: بنر قرمز + دکمهٔ فعال‌سازی همان‌جا (پل نیتیو v227).
 *  ۲) توکن مرده/حساب دیگر → ارسال با جزئیات خطای هر توکن (ترجمهٔ فارسی).
 *  ۳) FCM تنظیم نشده → بنر قرمز راهنما.
 */

interface PushToken {
  masked: string;
  platform: string;
  lastSeenAt: string | null;
  userAgent: string | null;
}

interface PushDetail {
  masked: string;
  ok: boolean;
  error: string | null;
  reason: string;
}

function faDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** عمر توکن — اگر خیلی قدیمی باشد (بیش از ۱۴ روز آخرین اتصال) مشکوک به مرگ */
function tokenAgeDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function AdminPushAuditCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tokens, setTokens] = useState<PushToken[]>([]);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastDetails, setLastDetails] = useState<PushDetail[] | null>(null);
  // 🎯 v227 — وضعیت مجوز اعلان روی همین دستگاه (فقط داخل اپ نیتیو معنا دارد)
  const [inNative, setInNative] = useState(false);
  const [permStatus, setPermStatus] = useState<"granted" | "denied" | "unsupported" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/push-test");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در دریافت وضعیت پوش");
      setConfigured(Boolean(data.configured));
      setTokens(data.tokens || []);
      setHint(data.hint || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در دریافت وضعیت پوش");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // v227 — خواندن وضعیت مجوز از پل نیتیو (یک‌بار بعد از mount؛ الگوی Promise.resolve)
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const native = isFitUpNativeApp();
        setInNative(native);
        if (native) setPermStatus(getNativeNotificationPermissionStatus());
      } catch {}
    });
  }, []);

  async function sendTest() {
    setSending(true);
    setLastResult(null);
    setLastDetails(null);
    try {
      const res = await fetch("/api/admin/push-test", { method: "POST" });
      const data = await res.json();
      if (data?.ok) {
        toast.success(
          `پوش به ${toPersianDigits(data.delivered)} دستگاه ارسال شد — به گوشی نگاه کن! 🔔`
        );
        setLastResult(
          `✅ ${toPersianDigits(data.delivered)}/${toPersianDigits(data.attempted)} رسیده${data.dead ? ` — ${toPersianDigits(data.dead)} توکن مرده (پاک شد)` : ""} — ${data.hint}`
        );
      } else {
        toast.error(data?.error || data?.hint || "ارسال پوش ناموفق بود");
        setLastResult(`❌ ${data?.error || data?.hint || "خطای نامشخص"}`);
      }
      if (Array.isArray(data?.details)) setLastDetails(data.details);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ارسال پوش تستی");
      setLastResult("❌ خطا در ارسال — دوباره تلاش کن");
    } finally {
      setSending(false);
      void load();
    }
  }

  const ready = configured && tokens.length > 0;

  return (
    <Card className="p-5">
      {/* سربرگ کارت */}
      <div className="flex items-start gap-2 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-600 flex items-center justify-center shrink-0">
          <BellRing className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-sm text-slate-900">اعلان پوش (FCM) — اپ بسته هم می‌رسد</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            اعلان از مسیر گوگل همان لحظه به گوشی می‌رسد، حتی وقتی اپ کاملاً بسته است (هر دو اپ)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg h-8 text-[11px]"
          aria-label="بروزرسانی وضعیت پوش"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {/* 🎯 v227 — وضعیت مجوز اعلان همین دستگاه (تست پوش را داخل اپ بزن تا این بنر واقعی شود) */}
      {inNative && permStatus && permStatus !== "granted" && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-bold text-red-700 leading-relaxed">
                مجوز اعلان در این گوشی داده نشده! این شایع‌ترین علت «ارسال ۲۰۰ می‌شود ولی نوتیف
                نمی‌رسد» است — سرور به گوگل تحویل می‌دهد ولی اندروید نوتیف را بی‌صدا دور می‌ریزد.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  requestNativeNotificationPermission();
                  // بعد از بستن دیالوگ مجوز، وضعیت دوباره خوانده می‌شود
                  setTimeout(() => setPermStatus(getNativeNotificationPermissionStatus()), 1500);
                }}
                className="mt-2 rounded-lg text-white h-8 text-[11px] gap-1.5"
                style={{ background: "linear-gradient(135deg, #f43f5e, #f97316)" }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                فعال‌سازی مجوز اعلان همین حالا
              </Button>
            </div>
          </div>
        </div>
      )}
      {inNative && permStatus === "granted" && (
        <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-700 font-bold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          مجوز اعلان این گوشی فعال است ✓
        </div>
      )}

      {/* وضعیت تنظیم */}
      {configured === false && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700 font-bold leading-relaxed">
          ⚠ کلید Firebase روی سرور تنظیم نشده — طبق راهنمای v223 بخش «اعلان پوش»،
          دستور آماده را در .env اجرا کن و pm2 restart فیتاپ بزن.
        </div>
      )}
      {configured && tokens.length === 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700 font-bold leading-relaxed">
          🔑 کلید سرور آماده است، ولی هنوز دستگاهی وصل نشده — اپ را روی گوشی نصب/باز کن و
          با همین حساب وارد شو (توکن حدود ۱۰ ثانیه بعد از باز شدن ثبت می‌شود). اگر اپ با
          حساب دیگری لاگین است، توکن به همان حساب ثبت می‌شود — دکمهٔ تست را با همان حساب بزن.
        </div>
      )}
      {ready && (
        <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-700 font-bold">
          ✅ همه‌چیز آماده است — {toPersianDigits(tokens.length)} دستگاه ثبت شده. با دکمهٔ زیر تست کن.
        </div>
      )}

      {/* لیست دستگاه‌ها */}
      {!loading && tokens.length > 0 && (
        <div className="space-y-1 mb-3">
          <p className="text-[10px] font-bold text-muted-foreground">
            دستگاه‌های ثبت‌شدهٔ این حساب:
          </p>
          {tokens.map((t) => {
            const age = tokenAgeDays(t.lastSeenAt);
            const stale = age != null && age > 14;
            return (
              <div
                key={t.masked}
                className="flex items-start gap-2 text-[10px] rounded-lg bg-background/80 border border-border/40 px-2.5 py-1.5"
              >
                <Smartphone className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                <span className="flex-1 leading-relaxed">
                  <span dir="ltr" className="font-mono">{t.masked}</span>
                  <span className="text-muted-foreground"> — {t.platform} — آخرین اتصال: {faDate(t.lastSeenAt)}</span>
                </span>
                {stale ? (
                  <Badge className="shrink-0 text-[9px] bg-amber-500/15 text-amber-700">
                    {toPersianDigits(age)} روز پیش — اپ را باز کن
                  </Badge>
                ) : (
                  <Badge className="shrink-0 text-[9px] bg-emerald-500/15 text-emerald-700">فعال</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* دکمهٔ تست */}
      <Button
        size="sm"
        onClick={() => void sendTest()}
        disabled={sending || loading || !configured}
        className="rounded-lg text-white gap-1.5 h-10 text-[11px] shrink-0"
        style={{ background: "linear-gradient(135deg, #10b981, #0d9488)" }}
      >
        {sending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Send className="w-3.5 h-3.5" />
        )}
        ارسال پوش تست به گوشی من
      </Button>

      {lastResult && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{lastResult}</p>
      )}

      {/* 🎯 v227 — جزئیات ریز هر توکن + ترجمهٔ فارسی علت */}
      {lastDetails && lastDetails.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-bold text-muted-foreground">جزئیات هر دستگاه:</p>
          {lastDetails.map((d) => (
            <div
              key={d.masked}
              className="flex items-start gap-2 text-[10px] rounded-lg border border-border/40 px-2.5 py-1.5 leading-relaxed"
            >
              {d.ok ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
              )}
              <span className="flex-1">
                <span dir="ltr" className="font-mono">{d.masked}</span>
                <span className={d.ok ? "text-emerald-700" : "text-red-700"}> — {d.reason}</span>
                {!d.ok && d.error && (
                  <span className="block text-[9px] text-muted-foreground" dir="ltr">
                    {d.error}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && hint && !lastResult && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>
      )}

      {/* v227 — چک‌لیست کوتاه «چرا نوتیف نمی‌رسد؟» */}
      {!loading && (
        <details className="mt-3 rounded-xl border border-border/40 px-3 py-2">
          <summary className="text-[11px] font-bold text-slate-700 cursor-pointer select-none">
            نوتیف نمی‌رسد؟ این ۴ مورد را به‌ترتیب چک کن
          </summary>
          <ol className="mt-2 space-y-1.5 text-[10px] text-muted-foreground leading-relaxed list-decimal pr-4">
            <li>
              <b className="text-slate-700">مجوز اعلان گوشی:</b> داخل اپ، تنظیمات گوشی ←
              برنامه‌ها ← فیتاپ ← اعلان‌ها روشن باشد (بنر قرمز بالای کارت هم همین را نشان می‌دهد).
            </li>
            <li>
              <b className="text-slate-700">حساب درست:</b> توکن دستگاه به «همان حسابی» وصل است
              که در اپ لاگین است — تست را با همان حساب بزن (لیست دستگاه‌های همین حساب بالاست).
            </li>
            <li>
              <b className="text-slate-700">اپ به‌روز:</b> اپ قدیمی‌تر از ۱.۱۸.۰ (اختصاصی) /
              ۱.۱۶.۰ (بازار) اصلاً FCM ندارد — از تب «اپ موبایل» آپدیت کن.
            </li>
            <li>
              <b className="text-slate-700">تست واقعی:</b> اپ را از recents ببند (نه force-stop)
              و دکمهٔ تست را بزن — نوتیف باید در چند ثانیه بیفتد.
            </li>
          </ol>
        </details>
      )}
    </Card>
  );
}
