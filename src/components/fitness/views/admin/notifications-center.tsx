"use client";

/**
 * ─── v178 — مرکز اعلان‌های مدیر (جایگزین ارسال نوتیف کلی) ───
 *
 * دیرکتیو مالک:
 *  «باید بتونم به گروه‌های مختلف با دسته‌بندی‌های مختلف نوتیف مجزا بفرستم؛
 *   نوتیف زمان‌بندی‌شده هم بتونم بفرستم — مشخص کنم در چه زمانی چه نوتیفی به
 *   این دسته یا این شخص بره؛ مثلاً به کاربرانی که از این بازه تا این بازه
 *   فلان کار رو کردن.»
 *
 * دو تب:
 *  ۱) «ارسال اعلان» — متن + گیرندگان (۱۲ گروه) + زمان‌بندی + پیش‌نمایش تعداد
 *  ۲) «کمپین‌ها» — لیست کمپین‌های ساخته‌شده با وضعیت/تعداد/لغو/ارسال فوری
 *
 * ارسال فوری هم‌مسیر کمپین‌های زمان‌بندی‌شده است (NotificationCampaign) تا
 * تاریخچه و آمار همهٔ اعلان‌های گروهی در یک جا بماند. کمپین‌های سررسیده با
 * جاروی داخلی سرور (هر ۶۰ ثانیه) خودکار ارسال می‌شوند؛ وقتی این دیالوگ باز
 * است، پنل هم هر ۶۰ ثانیه محرک dispatch است (پوشش dev).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Megaphone, Loader2, CalendarClock, Send, Users, Clock, Ban, Trash2,
  RefreshCw, CheckCircle2, AlertTriangle, Eye, XCircle, Hourglass, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { toPersianDigits } from "@/lib/fitness/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PersianDatePicker } from "@/components/fitness/persian-date-picker";

const NOTIFICATION_TYPES = [
  { value: "system", label: "سیستمی" },
  { value: "workout_reminder", label: "یادآوری تمرین" },
  { value: "achievement", label: "دستاورد" },
  { value: "upgrade", label: "ارتقا پلن" },
  { value: "renewal", label: "تمدید اشتراک" },
  { value: "re_engagement", label: "بازگردانی کاربر" },
  { value: "checkup", label: "چکاپ" },
  { value: "subscription", label: "اشتراک" },
  { value: "welcome", label: "خوش‌آمد" },
  { value: "coach", label: "مربی" },
];

const SEGMENT_OPTIONS = [
  { value: "all", label: "همهٔ کاربران" },
  { value: "active_plan", label: "کاربران با پلن فعال" },
  { value: "expired_plan", label: "کاربران با پلن منقضی‌شده" },
  { value: "no_plan", label: "کاربران بدون پلن (هرگز خرید نداشته)" },
  { value: "plan", label: "پلن مشخص…" },
  { value: "source", label: "منبع ثبت‌نام مشخص…" },
  { value: "app", label: "اپ مشخص…" },
  { value: "registered", label: "ثبت‌نام‌شده در بازهٔ زمانی…" },
  { value: "purchased", label: "خرید کرده در بازهٔ زمانی…" },
  { value: "never_purchased", label: "هرگز خرید موفق نداشته" },
  { value: "expiring", label: "پلنش در بازه‌ای منقضی می‌شود…" },
  { value: "users", label: "کاربران مشخص (شماره موبایل)…" },
];

const SOURCE_OPTIONS = [
  { value: "instagram", label: "اینستاگرام" },
  { value: "google", label: "گوگل" },
  { value: "cafebazaar", label: "کافه‌بازار" },
  { value: "app_panel", label: "اپ اختصاصی" },
  { value: "web", label: "وب‌سایت (مستقیم)" },
  { value: "other", label: "سایر" },
];

const APP_OPTIONS = [
  { value: "panel", label: "اپ اختصاصی (پنل)" },
  { value: "bazaar", label: "اپ کافه‌بازار" },
  { value: "pwa", label: "PWA (نصب وب)" },
];

const PLAN_OPTIONS = [
  { value: "basic", label: "اقتصادی" },
  { value: "standard", label: "استاندارد" },
  { value: "advanced", label: "پیشرفته" },
  { value: "ultimate", label: "حرفه‌ای" },
];

const NEEDS_RANGE = ["registered", "purchased", "expiring"];

interface Campaign {
  id: string;
  title: string;
  body: string;
  type: string;
  link: string | null;
  segmentLabel: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  totalTargets: number;
  sentCount: number;
  pushCount: number;
  error: string | null;
  createdAt: string;
}

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  draft: { label: "پیش‌نویس", cls: "bg-slate-100 text-slate-600", icon: Pencil },
  scheduled: { label: "زمان‌بندی‌شده", cls: "bg-amber-100 text-amber-700", icon: Hourglass },
  sending: { label: "در حال ارسال", cls: "bg-blue-100 text-blue-700", icon: RefreshCw },
  sent: { label: "ارسال‌شده", cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  failed: { label: "ناموفق", cls: "bg-red-100 text-red-700", icon: XCircle },
  canceled: { label: "لغوشده", cls: "bg-slate-100 text-slate-400", icon: Ban },
};

function faDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
  } catch {
    return "—";
  }
}

export function NotificationsCenterDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"compose" | "list">("compose");

  // ─── فیلدهای کمپین ───
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("system");
  const [link, setLink] = useState("");
  const [kind, setKind] = useState("all");
  const [plan, setPlan] = useState("basic");
  const [source, setSource] = useState("instagram");
  const [app, setApp] = useState("panel");
  const [fromIso, setFromIso] = useState<string | null>(null);
  const [toIso, setToIso] = useState<string | null>(null);
  const [mobilesText, setMobilesText] = useState("");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduleIso, setScheduleIso] = useState<string | null>(null);
  const [scheduleTime, setScheduleTime] = useState("20:00");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ count: number; sample: { name: string; mobile: string }[] } | null>(null);

  // ─── لیست کمپین‌ها ───
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [listBusy, setListBusy] = useState(false);

  const buildSegment = useCallback((): Record<string, unknown> | null => {
    if (NEEDS_RANGE.includes(kind) && !fromIso && !toIso) {
      toast.error("حداقل یکی از تاریخ‌های شروع/پایان را انتخاب کنید.");
      return null;
    }
    if (kind === "users") {
      const mobiles = mobilesText
        .split(/[\n,،\s]+/)
        .map((m) => m.replace(/[^\d]/g, ""))
        .filter((m) => /^09\d{9}$/.test(m));
      if (!mobiles.length) {
        toast.error("حداقل یک شماره موبایل معتبر (09xxxxxxxxx) وارد کنید.");
        return null;
      }
      return { kind, mobiles };
    }
    if (kind === "plan") return { kind, plan };
    if (kind === "source") return { kind, source };
    if (kind === "app") return { kind, app };
    if (NEEDS_RANGE.includes(kind)) return { kind, from: fromIso ?? undefined, to: toIso ?? undefined };
    return { kind };
  }, [kind, plan, source, app, fromIso, toIso, mobilesText]);

  async function doPreview() {
    const segment = buildSegment();
    if (!segment) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/notifications/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطا در پیش‌نمایش");
      setPreview({ count: data.count ?? 0, sample: data.sample ?? [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در پیش‌نمایش");
    } finally {
      setBusy(false);
    }
  }

  async function doSend() {
    const segment = buildSegment();
    if (!segment) return;
    if (mode === "schedule" && !scheduleIso) {
      toast.error("تاریخ ارسال را انتخاب کنید.");
      return;
    }
    let scheduledAt: string | undefined;
    if (mode === "schedule" && scheduleIso) {
      // ترکیب تاریخ انتخابی با ساعت (ساعت دستگاه مدیر = تهران)
      const base = new Date(scheduleIso);
      const [hh, mm] = scheduleTime.split(":").map((n) => parseInt(n, 10) || 0);
      base.setHours(hh, mm, 0, 0);
      scheduledAt = base.toISOString();
      if (base.getTime() < Date.now() - 60_000) {
        toast.error("زمان ارسال باید در آینده باشد.");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/notifications/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          type,
          link: link.trim() || null,
          segment,
          mode: mode === "now" ? "now" : "schedule",
          scheduledAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطا در ارسال اعلان");
      if (mode === "now") {
        toast.success(`اعلان به ${toPersianDigits(data.sent ?? 0)} کاربر ارسال شد (پوش: ${toPersianDigits(data.pushed ?? 0)})`);
      } else {
        toast.success(`اعلان برای ${faDateTime(scheduledAt ?? null)} زمان‌بندی شد (≈${toPersianDigits(data.estimated ?? 0)} گیرنده)`);
      }
      // ریست فرم + رفتن به لیست
      setTitle(""); setBody(""); setLink(""); setPreview(null); setScheduleIso(null);
      setMode("now");
      setTab("list");
      void loadCampaigns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ارسال اعلان");
    } finally {
      setBusy(false);
    }
  }

  const loadCampaigns = useCallback(async () => {
    setListBusy(true);
    try {
      const res = await fetch("/api/admin/notifications/campaigns", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطا در دریافت کمپین‌ها");
      setCampaigns(data.campaigns ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در دریافت کمپین‌ها");
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "list" && campaigns === null) void loadCampaigns();
  }, [tab, campaigns, loadCampaigns]);

  // وقتی دیالوگ باز است: هر ۶۰ ثانیه محرک dispatch سررسیده‌ها + رفرش لیست
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        await fetch("/api/admin/notifications/dispatch", { method: "POST" });
      } catch {}
      if (tab === "list") void loadCampaigns();
    }, 60_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tab, loadCampaigns]);

  async function campaignAction(id: string, action: "send" | "cancel") {
    try {
      const res = await fetch(`/api/admin/notifications/campaigns/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطا در عملیات");
      toast.success(action === "send" ? `ارسال شد (${toPersianDigits(data.sent ?? 0)} کاربر)` : "کمپین لغو شد");
      void loadCampaigns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در عملیات");
    }
  }

  async function campaignDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/notifications/campaigns/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطا در حذف");
      toast.success("کمپین حذف شد");
      void loadCampaigns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در حذف");
    }
  }

  const canSend = title.trim() && body.trim() && !busy;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent dir="rtl" className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-amber-500" />
            مرکز اعلان‌ها
          </DialogTitle>
        </DialogHeader>

        {/* تب‌ها */}
        <div className="flex gap-1 p-1 rounded-xl bg-muted/60">
          <button
            onClick={() => setTab("compose")}
            className={`flex-1 h-8 rounded-lg text-xs font-bold transition ${tab === "compose" ? "bg-white shadow text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Send className="w-3.5 h-3.5 inline-block ml-1 -mt-0.5" />
            ارسال اعلان
          </button>
          <button
            onClick={() => setTab("list")}
            className={`flex-1 h-8 rounded-lg text-xs font-bold transition ${tab === "list" ? "bg-white shadow text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Clock className="w-3.5 h-3.5 inline-block ml-1 -mt-0.5" />
            کمپین‌ها و زمان‌بندی
          </button>
        </div>

        {tab === "compose" ? (
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block">عنوان *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: خبر جدید فیتاپ 🎉" maxLength={200} className="rounded-xl" />
            </div>
            <div>
              <Label className="mb-1 block">متن پیام *</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن کامل اعلان..." rows={3} maxLength={2000} className="rounded-xl resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block">نوع اعلان</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NOTIFICATION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block">لینک داخلی (اختیاری)</Label>
                <Input dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="?tab=plans" maxLength={500} className="rounded-xl text-left" />
              </div>
            </div>

            {/* گیرندگان */}
            <div className="p-3 rounded-xl border bg-muted/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Users className="w-3.5 h-3.5 text-amber-500" />
                گیرندگان
              </div>
              <Select value={kind} onValueChange={(v) => { setKind(v); setPreview(null); }}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEGMENT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {kind === "plan" && (
                <Select value={plan} onValueChange={(v) => { setPlan(v); setPreview(null); }}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLAN_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {kind === "source" && (
                <Select value={source} onValueChange={(v) => { setSource(v); setPreview(null); }}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {kind === "app" && (
                <Select value={app} onValueChange={(v) => { setApp(v); setPreview(null); }}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {APP_OPTIONS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {NEEDS_RANGE.includes(kind) && (
                <div className="grid grid-cols-2 gap-2">
                  <PersianDatePicker value={fromIso} onChange={(iso) => { setFromIso(iso); setPreview(null); }} label="از تاریخ" />
                  <PersianDatePicker value={toIso} onChange={(iso) => { setToIso(iso); setPreview(null); }} label="تا تاریخ" />
                </div>
              )}

              {kind === "users" && (
                <div>
                  <Label className="mb-1 block">شماره موبایل‌ها (هر خط یک شماره)</Label>
                  <Textarea
                    dir="ltr"
                    value={mobilesText}
                    onChange={(e) => setMobilesText(e.target.value)}
                    placeholder={"09123456789\n09129876543"}
                    rows={3}
                    className="rounded-xl resize-none text-left font-mono text-xs"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={doPreview} disabled={busy}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                  پیش‌نمایش گیرندگان
                </Button>
                {preview && (
                  <span className="text-xs">
                    ≈ <b className="font-stat text-amber-600">{toPersianDigits(preview.count)}</b> گیرنده
                  </span>
                )}
              </div>
              {preview && preview.sample.length > 0 && (
                <div className="text-[11px] text-muted-foreground leading-relaxed">
                  نمونه: {preview.sample.map((s) => `${s.name || s.mobile}`).join("، ")}
                </div>
              )}
            </div>

            {/* زمان‌بندی */}
            <div className="p-3 rounded-xl border bg-muted/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
                زمان ارسال
              </div>
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="notif-mode" checked={mode === "now"} onChange={() => setMode("now")} />
                  ارسال فوری
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="notif-mode" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
                  زمان‌بندی‌شده
                </label>
              </div>
              {mode === "schedule" && (
                <div className="grid grid-cols-2 gap-2 items-end">
                  <PersianDatePicker value={scheduleIso} onChange={setScheduleIso} label="تاریخ ارسال" minDate={new Date().toISOString()} />
                  <div>
                    <Label className="mb-1 block">ساعت (به وقت تهران)</Label>
                    <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="rounded-xl" dir="ltr" />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ─── لیست کمپین‌ها ─── */
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">کمپین‌های زمان‌بندی‌شدهٔ سررسیده به‌صورت خودکار (هر ۶۰ ثانیه) ارسال می‌شوند.</p>
              <Button variant="outline" size="sm" className="rounded-xl gap-1" onClick={loadCampaigns} disabled={listBusy}>
                <RefreshCw className={`w-3.5 h-3.5 ${listBusy ? "animate-spin" : ""}`} />
                بروزرسانی
              </Button>
            </div>
            {campaigns === null ? (
              <div className="py-8 text-center text-xs text-muted-foreground">در حال بارگذاری…</div>
            ) : campaigns.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">هنوز کمپینی ساخته نشده است.</div>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-2 pl-1 styled-scroll">
                {campaigns.map((c) => {
                  const meta = STATUS_META[c.status] ?? STATUS_META.draft;
                  const StatusIcon = meta.icon;
                  return (
                    <div key={c.id} className="p-3 rounded-xl border bg-muted/20 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold truncate max-w-[240px]">{c.title}</span>
                            <Badge className={`text-[10px] px-1.5 py-0 ${meta.cls}`}>
                              <StatusIcon className={`w-2.5 h-2.5 ml-0.5 ${c.status === "sending" ? "animate-spin" : ""}`} />
                              {meta.label}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{c.body}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {["draft", "failed"].includes(c.status) && (
                            <Button variant="outline" size="sm" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => campaignAction(c.id, "send")}>
                              <Send className="w-3 h-3" /> ارسال
                            </Button>
                          )}
                          {["scheduled", "draft", "failed"].includes(c.status) && (
                            <Button variant="outline" size="sm" className="h-7 rounded-lg gap-1 text-[11px]" onClick={() => campaignAction(c.id, "cancel")}>
                              <Ban className="w-3 h-3" /> لغو
                            </Button>
                          )}
                          {["draft", "canceled", "failed", "sent"].includes(c.status) && (
                            <Button variant="ghost" size="sm" className="h-7 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => campaignDelete(c.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {c.segmentLabel}</span>
                        {c.status === "scheduled" && <span className="inline-flex items-center gap-1 text-amber-600"><Hourglass className="w-3 h-3" /> {faDateTime(c.scheduledAt)}</span>}
                        {c.status === "sent" && (
                          <>
                            <span className="text-emerald-600 font-bold">ارسال: {toPersianDigits(c.sentCount)} از {toPersianDigits(c.totalTargets)}</span>
                            <span>پوش: {toPersianDigits(c.pushCount)}</span>
                            <span>{faDateTime(c.sentAt)}</span>
                          </>
                        )}
                        {c.status === "failed" && c.error && (
                          <span className="inline-flex items-center gap-1 text-red-600"><AlertTriangle className="w-3 h-3" /> {c.error}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose} variant="outline" className="rounded-xl">بستن</Button>
          {tab === "compose" && (
            <Button
              onClick={doSend}
              disabled={!canSend}
              className="rounded-xl gap-2 bg-gradient-to-l from-amber-500 to-orange-500 text-white hover:opacity-95"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "now" ? <Megaphone className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
              {mode === "now" ? "ارسال فوری" : "زمان‌بندی ارسال"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
