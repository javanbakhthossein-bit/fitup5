"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DatabaseBackup,
  Loader2,
  Play,
  PlugZap,
  Clock3,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Send,
  Search,
  Bot,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * کارت «بکاپ دیتابیس» — درخواست مالک v69:
 * «گوگل درایو رو بی‌خیال شو چون تحریمه — بکاپ دیتابیس به ربات من در
 *  پیام‌رسان ایرانی بله ارسال بشه.»
 *
 *  - فعال/خاموش + بازهٔ بکاپ (۱/۲/۳/۴/۵/۶/۱۲ ساعت) + نگهداری محلی
 *  - توکن ربات بله (خالی = از env BALE_BOT_TOKEN) + chat_id مقصد
 *  - «کشف خودکار chat_id» — مالک فقط یک /start به ربات می‌دهد
 *  - دکمهٔ «بکاپ فوری» و «تست ارسال»
 *  - تاریخچهٔ ۱۲ اجرای آخر با وضعیت ارسال
 */

interface BackupRun {
  id: string;
  status: string;
  trigger: string;
  fileName: string | null;
  sizeBytes: number | null;
  uploaded: boolean;
  uploadError: string | null;
  deletedOld: number;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

interface BaleStatus {
  tokenSource: "env" | "panel" | "none";
  tokenSet: boolean;
  chatIdSet: boolean;
  chatId: string;
}

interface BackupInfo {
  settings: {
    enabled: boolean;
    intervalHours: number;
    retentionHours: number;
    baleToken: string;
    baleChatId: string;
  };
  baleStatus: BaleStatus;
  due: { due: boolean; lastAt: string | null; nextDueAt: string | null };
  dbSizeBytes: number | null;
  lastRuns: BackupRun[];
}

interface DiscoveredChat {
  chatId: string;
  title: string;
  type: string;
  at: string;
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

function faBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} گیگابایت`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} مگابایت`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} کیلوبایت`;
  return `${toPersianDigits(n)} بایت`;
}

// v78 — هماهنگ با BALE_MAX_DOCUMENT_BYTES / BALE_PART_TARGET_BYTES در db-backup.ts
const BALE_MAX_DOCUMENT_BYTES = 20_000_000;
const BALE_PART_TARGET_BYTES = 18_000_000;

/**
 * v78 — تعداد بخش‌های یک اجرای چندبخشی را از حجم فایل برمی‌گرداند (بدون تغییر
 * اسکیما — شماره‌گذاری بخش‌ها تابع مستقیم حجم است: ceil(size ÷ 18MB)).
 * فقط برای بکاپ‌هایی که از سقف ۲۰ مگابایت بله بزرگ‌تر بوده‌اند non-null است.
 */
function runPartsCount(r: BackupRun): number | null {
  if (r.sizeBytes == null || r.sizeBytes <= BALE_MAX_DOCUMENT_BYTES) return null;
  return Math.max(1, Math.ceil(r.sizeBytes / BALE_PART_TARGET_BYTES));
}

const INTERVAL_OPTIONS = [1, 2, 3, 4, 5, 6, 12];
const RETENTION_OPTIONS = [24, 48, 72, 168];

export function AdminDbBackupCard() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [foundChats, setFoundChats] = useState<DiscoveredChat[] | null>(null);

  // فرم‌های قابل ویرایش
  const [enabled, setEnabled] = useState(true);
  const [intervalHours, setIntervalHours] = useState(2);
  const [retentionHours, setRetentionHours] = useState(48);
  const [baleToken, setBaleToken] = useState("");
  const [baleChatId, setBaleChatId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/db-backup");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در دریافت وضعیت بکاپ");
      setInfo(data);
      setEnabled(data.settings.enabled);
      setIntervalHours(data.settings.intervalHours);
      setRetentionHours(data.settings.retentionHours);
      setBaleToken("");
      setBaleChatId(data.settings.baleChatId || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در دریافت وضعیت بکاپ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** ذخیرهٔ تنظیمات با PUT /api/admin/settings (کلید به کلید) */
  async function saveSettings() {
    setSaving(true);
    try {
      const updates: Array<[string, string]> = [
        ["db_backup_enabled", enabled ? "1" : "0"],
        ["db_backup_interval_hours", String(intervalHours)],
        ["db_backup_retention_hours", String(retentionHours)],
        ["db_backup_bale_chat_id", baleChatId.trim()],
      ];
      // توکن فقط وقتی فرم پر است آپدیت می‌شود (خالی = بدون تغییر / از env)
      if (baleToken.trim()) updates.push(["db_backup_bale_token", baleToken.trim()]);
      for (const [key, value] of updates) {
        const res = await fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `خطا در ذخیرهٔ ${key}`);
      }
      toast.success("تنظیمات بکاپ ذخیره شد ✅");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ذخیرهٔ تنظیمات");
    } finally {
      setSaving(false);
    }
  }

  async function doAction(action: "run" | "test_upload") {
    if (action === "run") setRunning(true);
    else setTesting(true);
    try {
      const res = await fetch("/api/admin/db-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در اجرا");
      if (action === "run") {
        if (data.ok) {
          if (data.uploaded) {
            toast.success(
              data.parts > 1
                ? `بکاپ گرفته شد (${faBytes(data.sizeBytes)}) و ${toPersianDigits(data.parts)} بخش در بله ارسال شد ✅`
                : `بکاپ گرفته شد (${faBytes(data.sizeBytes)}) و در بله ارسال شد ✅`
            );
          } else if (Array.isArray(data.failedParts) && data.failedParts.length > 0) {
            toast.error(
              `بکاپ گرفته شد (${faBytes(data.sizeBytes)}) — ارسال ناقص ماند: ${toPersianDigits(data.parts ?? 0)} بخش ساخته شد و ${toPersianDigits(data.failedParts.length)} بخش ارسال نشد${data.uploadError ? `: ${data.uploadError}` : ""}`
            );
          } else {
            toast.error(
              `بکاپ گرفته شد (${faBytes(data.sizeBytes)}) — ولی ارسال به بله انجام نشد${data.uploadError ? `: ${faUploadError(data.uploadError)}` : ""}`
            );
          }
        } else {
          toast.error(`بکاپ ناموفق: ${data.error || "خطای نامشخص"}`);
        }
      } else {
        if (data.ok) {
          toast.success("تست موفق بود — فایل آزمایشی در بله تحویل شد ✅ (بعداً حذفش کنید)");
        } else {
          toast.error(`تست ارسال ناموفق: ${faUploadError(data.error) || "خطای نامشخص"}`);
        }
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در اجرا");
    } finally {
      setRunning(false);
      setTesting(false);
    }
  }

  /** ترجمهٔ کدهای خطای داخلی به فارسی برای توست */
  function faUploadError(err?: string | null): string | null {
    if (!err) return null;
    if (err === "no_token") return "توکن ربات بله تنظیم نشده";
    if (err === "no_chat_id") return "شناسهٔ چت (chat_id) تنظیم نشده";
    return err;
  }

  /** کشف خودکار chat_id از پیام‌های دریافتی ربات */
  async function discoverChat() {
    setDiscovering(true);
    setFoundChats(null);
    try {
      const res = await fetch("/api/admin/db-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover_chat", token: baleToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "کشف خودکار ناموفق بود");
      setFoundChats(data.chats as DiscoveredChat[]);
      const first = data.chats?.[0] as DiscoveredChat | undefined;
      if (first && !baleChatId.trim()) setBaleChatId(first.chatId);
      if (data.botUsername) toast.success(`ربات @${data.botUsername} — ${toPersianDigits(data.chats.length)} چت پیدا شد`);
      else toast.success(`${toPersianDigits(data.chats.length)} چت پیدا شد — chat_id را انتخاب و ذخیره کنید`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "کشف خودکار ناموفق بود");
    } finally {
      setDiscovering(false);
    }
  }

  const baleReady = Boolean(info?.baleStatus.tokenSet && info?.baleStatus.chatIdSet);

  return (
    <Card className="p-5">
      {/* سربرگ */}
      <div className="flex items-start gap-2 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-600 flex items-center justify-center shrink-0">
          <DatabaseBackup className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-sm text-slate-900">بکاپ دیتابیس — ارسال به ربات بله</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            بکاپ خودکار فقط از دیتابیس + ارسال فایل فشرده به پیام‌رسان بله + حذف خودکار بایگانی قدیمی
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="rounded-lg h-8 text-[11px]">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "بروزرسانی"}
        </Button>
      </div>

      {loading && !info ? (
        <div className="space-y-2">
          <div className="h-24 rounded-xl bg-muted/50 animate-pulse" />
          <div className="h-10 rounded-xl bg-muted/50 animate-pulse" />
        </div>
      ) : info ? (
        <div className="space-y-4">
          {/* v78 — یادداشت تقسیم خودکار بکاپ بزرگ */}
          <div className="flex items-start gap-1.5 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2">
            <Scissors className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
            <p className="text-[10px] leading-relaxed text-sky-900">
              اگر بکاپ فشرده از ۲۰ مگابایت بله بزرگ‌تر شود، خودکار به چند بخش تقسیم و همهٔ بخش‌ها ارسال می‌شوند
              (دستور بازسازی <span dir="ltr" className="font-mono">cat …parts* &gt; file.db.gz</span> در کپشن هر بخش نوشته می‌شود).
            </p>
          </div>

          {/* وضعیت خلاصه */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
              <p className="text-[9px] text-muted-foreground mb-1">دیتابیس فعلی</p>
              <p className="text-xs font-black text-slate-800">{faBytes(info.dbSizeBytes)}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
              <p className="text-[9px] text-muted-foreground mb-1">آخرین بکاپ</p>
              <p className="text-[10px] font-black text-slate-800 leading-tight">{faDate(info.due.lastAt)}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
              <p className="text-[9px] text-muted-foreground mb-1">بکاپ بعدی</p>
              <p className="text-[10px] font-black text-slate-800 leading-tight">
                {enabled ? faDate(info.due.nextDueAt) : "خاموش"}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
              <p className="text-[9px] text-muted-foreground mb-1">ارسال به بله</p>
              <p className={`text-xs font-black ${baleReady ? "text-emerald-600" : "text-amber-600"}`}>
                {baleReady ? "آماده ✓" : "ناقص"}
              </p>
            </div>
          </div>

          {/* تنظیمات */}
          <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <p className="text-xs font-bold">تنظیمات زمان‌بندی و مقصد</p>

            {/* فعال/خاموش */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold text-slate-700">بکاپ خودکار</p>
                <p className="text-[10px] text-muted-foreground">جاروی داخلی سرور هر ۱۰ دقیقه سررسید را چک می‌کند</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((v) => !v)}
                className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${enabled ? "bg-emerald-500" : "bg-slate-300"}`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? "right-1" : "right-6"}`}
                />
              </button>
            </div>

            {/* بازهٔ بکاپ */}
            <div>
              <p className="text-[11px] font-bold text-slate-700 mb-1.5">هر چند ساعت یک‌بار بکاپ بگیرد؟</p>
              <div className="flex flex-wrap gap-1.5">
                {INTERVAL_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setIntervalHours(h)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-black border-2 transition ${
                      intervalHours === h
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-border bg-white text-slate-500 hover:border-emerald-300"
                    }`}
                  >
                    {toPersianDigits(h)} ساعت
                  </button>
                ))}
              </div>
            </div>

            {/* نگهداری محلی */}
            <div>
              <p className="text-[11px] font-bold text-slate-700 mb-1.5">
                نگهداری بایگانی (حذف خودکار فایل‌های قدیمی‌تر)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RETENTION_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setRetentionHours(h)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-black border-2 transition ${
                      retentionHours === h
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-border bg-white text-slate-500 hover:border-emerald-300"
                    }`}
                  >
                    {toPersianDigits(h)} ساعت{h === 48 ? " (پیش‌فرض)" : ""}
                  </button>
                ))}
              </div>
            </div>

            {/* ربات بله */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-emerald-600" />
                <label className="text-[11px] font-bold text-slate-700">
                  توکن ربات بله (BotFather)
                </label>
                {info.baleStatus.tokenSet && (
                  <Badge className="text-[8px] bg-emerald-500/15 text-emerald-700">
                    {info.baleStatus.tokenSource === "env" ? "تنظیم‌شده از فایل env" : "تنظیم‌شده"}
                  </Badge>
                )}
              </div>
              <Input
                dir="ltr"
                type="password"
                autoComplete="off"
                value={baleToken}
                onChange={(e) => setBaleToken(e.target.value)}
                placeholder={info.baleStatus.tokenSet ? "•••••••••• (خالی = بدون تغییر)" : "1133996971:xxxx…"}
                className="rounded-xl min-h-[44px] text-xs font-mono"
              />
              {info.baleStatus.tokenSource === "env" && (
                <p className="text-[10px] text-emerald-700">
                  توکن از فایل env (BALE_BOT_TOKEN) خوانده می‌شود — نیازی به پرکردن این فیلد نیست.
                </p>
              )}
              <label className="text-[11px] font-bold text-slate-700 block pt-1">
                شناسهٔ چت مقصد (chat_id)
              </label>
              <div className="flex gap-2">
                <Input
                  dir="ltr"
                  value={baleChatId}
                  onChange={(e) => setBaleChatId(e.target.value)}
                  placeholder="مثلاً 1566730423"
                  className="rounded-xl min-h-[44px] text-xs font-mono flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void discoverChat()}
                  disabled={discovering}
                  className="rounded-xl h-11 gap-1.5 text-[11px] font-black border-emerald-300 text-emerald-700 hover:bg-emerald-50 shrink-0"
                >
                  {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  کشف خودکار
                </Button>
              </div>
              {foundChats && foundChats.length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2 space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                  {foundChats.map((c) => (
                    <button
                      key={c.chatId}
                      type="button"
                      onClick={() => setBaleChatId(c.chatId)}
                      className={`w-full text-right px-2.5 py-1.5 rounded-lg text-[10px] flex items-center justify-between gap-2 transition ${
                        baleChatId === c.chatId
                          ? "bg-emerald-500 text-white font-black"
                          : "bg-white hover:bg-emerald-100 text-slate-700"
                      }`}
                    >
                      <span className="truncate">{c.title || "چت بی‌نام"} <span className="opacity-60">({c.type})</span></span>
                      <span dir="ltr" className="font-mono shrink-0">{c.chatId}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                برای پر کردن خودکار: در پیام‌رسان بله به ربات خود یک پیام (مثلاً /start) بدهید و بعد «کشف خودکار» را بزنید.
              </p>
            </div>

            {/* دکمه‌ها */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                onClick={() => void saveSettings()}
                disabled={saving}
                className="rounded-xl text-white gap-1.5 h-11 flex-1 text-xs font-black"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                ذخیرهٔ تنظیمات بکاپ
              </Button>
              <Button
                onClick={() => void doAction("run")}
                disabled={running}
                variant="outline"
                className="rounded-xl gap-1.5 h-11 flex-1 text-xs font-black border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                بکاپ فوری همین حالا
              </Button>
              <Button
                onClick={() => void doAction("test_upload")}
                disabled={testing}
                variant="outline"
                className="rounded-xl gap-1.5 h-11 flex-1 text-xs font-black border-cyan-300 text-cyan-700 hover:bg-cyan-50"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
                تست ارسال به بله
              </Button>
            </div>
          </div>

          {/* راهنمای راه‌اندازی بله */}
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50/50 overflow-hidden">
            <button
              onClick={() => setGuideOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-right hover:bg-cyan-50 transition"
              aria-expanded={guideOpen}
            >
              <Send className="w-4 h-4 text-cyan-700 shrink-0" />
              <span className="flex-1 text-xs font-black text-cyan-900">
                راه‌اندازی یک‌بارهٔ ارسال به بله (کمتر از ۲ دقیقه)
              </span>
              <span className={`transition-transform ${guideOpen ? "rotate-180" : ""} text-cyan-700 text-[10px]`}>▼</span>
            </button>
            {guideOpen && (
              <div className="px-4 pb-4 space-y-2.5 border-t border-cyan-200 pt-3">
                <ol className="text-[11px] text-cyan-950 space-y-1.5 list-decimal pr-4 leading-relaxed">
                  <li>
                    در پیام‌رسان <span className="font-bold">بله</span>، در جستجو نام ربات خود را بزنید و وارد چت آن شوید، سپس دکمهٔ
                    <span dir="ltr" className="font-mono font-bold"> /start </span> را بزنید.
                  </li>
                  <li>
                    توکن ربات (دریافتی از BotFather بله) را در فیلد بالا بگذارید — اگر در فایل env مقدار
                    <span dir="ltr" className="font-mono font-bold"> BALE_BOT_TOKEN </span>
                    باشد می‌توانید این فیلد را خالی بگذارید.
                  </li>
                  <li>
                    دکمهٔ <span className="font-bold">«کشف خودکار»</span> را بزنید — چت شما پیدا و chat_id پر می‌شود؛
                    بعد <span className="font-bold">«ذخیرهٔ تنظیمات بکاپ»</span> و در پایان
                    <span className="font-bold"> «تست ارسال به بله» </span> را بزنید.
                  </li>
                  <li>
                    تمام! از این به بعد هر بکاپ (مثلاً هر ۲ ساعت) خودکار به همین چتِ بله ارسال می‌شود و
                    بایگانی محلی قدیمی‌تر از مهلت انتخابی حذف می‌گردد.
                  </li>
                </ol>
                <div className="rounded-xl bg-white/70 border border-cyan-200 p-2.5 text-[10px] text-cyan-900 leading-relaxed">
                  <p className="font-bold mb-1">جای امن توکن:</p>
                  توکن ربات را در فایل <span dir="ltr" className="font-mono font-bold">.env</span> سرور بگذارید:
                  <span dir="ltr" className="font-mono block mt-1 bg-slate-900 text-emerald-200 rounded-lg px-2 py-1.5">BALE_BOT_TOKEN=1133996971:xxxxxxxxxxxxxxxxxxxxxxxxx</span>
                  اگر متغیر env تنظیم شده باشد، این فیلد می‌تواند خالی بماند
                  (وضعیت بالای فیلد نشان می‌دهد). توکن هرگز به مرورگر کاربران فرستاده نمی‌شود.
                </div>
              </div>
            )}
          </div>

          {/* تاریخچهٔ اجراها */}
          <div>
            <p className="text-xs font-bold mb-2 flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5 text-slate-400" />
              {toPersianDigits(info.lastRuns.length)} اجرای آخر
            </p>
            {info.lastRuns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground rounded-xl bg-muted/30 px-3 py-2.5">
                هنوز هیچ بکاپی ثبت نشده — با «بکاپ فوری همین حالا» اولین را بگیرید.
              </p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                {info.lastRuns.map((r) => {
                  const parts = runPartsCount(r);
                  return (
                  <div
                    key={r.id}
                    className="flex items-start gap-2 text-[10px] rounded-lg bg-muted/20 border border-border/40 px-2.5 py-2"
                  >
                    {r.status === "success" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    ) : r.status === "partial" ? (
                      <Badge className="shrink-0 text-[8px] bg-amber-500/15 text-amber-700 mt-0.5">نیمه‌موفق</Badge>
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <span className="flex-1 leading-relaxed">
                      <span className="font-bold">{faDate(r.createdAt)}</span>
                      <span className="text-muted-foreground">
                        {" "}— {r.fileName ? r.fileName : "بدون فایل"} {r.sizeBytes ? `(${faBytes(r.sizeBytes)})` : ""}
                        {parts != null && (
                          <Badge className="ms-1 inline-block align-middle text-[8px] bg-sky-500/15 text-sky-700">
                            {toPersianDigits(parts)} بخش
                          </Badge>
                        )}
                      </span>
                      <span className="block text-[9px] text-muted-foreground mt-0.5">
                        {r.uploaded
                          ? `✓ در بله ارسال شد${parts != null ? ` — هر ${toPersianDigits(parts)} بخش جداگانه` : ""}`
                          : r.uploadError === "no_token"
                            ? "فقط محلی — توکن ربات بله تنظیم نشده"
                            : r.uploadError === "no_chat_id"
                              ? "فقط محلی — chat_id تنظیم نشده"
                              : `ارسال نشد${r.uploadError ? `: ${r.uploadError}` : ""}`}
                        {r.deletedOld > 0 && ` — ${toPersianDigits(r.deletedOld)} فایل قدیمی حذف شد`}
                        {r.trigger === "manual" && " — دستی"}
                      </span>
                      {r.error && <span className="block text-[9px] text-red-600 mt-0.5">{r.error}</span>}
                    </span>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
