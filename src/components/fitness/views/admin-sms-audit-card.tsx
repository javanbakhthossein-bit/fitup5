"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  ChevronDown,
  ClipboardList,
  Clock3,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * کارت «ممیزی پیامک‌ها» — درخواست مالک v66:
 * «باید دونه به دونه پیامک‌ها رو بررسی کنی تا ببینی درست در زمان خودشون
 * ارسال می‌شن یا نه و همگی به لینک درست و جای درست می‌رن یا نه.»
 *
 * برای هر سناریو: زمان‌بندی دقیق + دداپ + مقصد لینک + شناسهٔ قالب مؤثر و
 * منبع آن + آمار ارسال موفق/ناموفق + ۸ لاگ آخر + دکمهٔ «ارسال تست» همان
 * سناریو به شمارهٔ دلخواه.
 */

interface SmsScenario {
  prefix: string;
  name: string;
  timing: string;
  dedupe: string;
  link: string;
  templateId: string | null;
  source: string;
  envKey: string | null;
  sent: number;
  failed: number;
  lastSentAt: string | null;
  recent: Array<{
    mobile: string;
    key: string;
    status: string;
    error: string | null;
    templateId: string | null;
    createdAt: string;
  }>;
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

/** برچسب فارسی منبع شناسهٔ قالب */
function sourceLabel(s: string): string {
  if (s === "env") return "env سرور";
  if (s === "default") return "پیش‌فرض داخلی";
  if (s === "override") return "override پنل";
  if (s === "none") return "بدون شناسه!";
  return s;
}

export function AdminSmsAuditCard() {
  const [scenarios, setScenarios] = useState<SmsScenario[] | null>(null);
  const [apiConfigured, setApiConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testMobile, setTestMobile] = useState("");
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sms-audit");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در دریافت ممیزی");
      setScenarios(data.scenarios || []);
      setApiConfigured(Boolean(data.apiConfigured));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در دریافت ممیزی پیامک‌ها");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSingleTest(key: string) {
    setTestingKey(key);
    try {
      const res = await fetch("/api/admin/sms-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: testMobile.trim(), key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در ارسال پیامک تستی");
      const r = data?.results?.[0];
      if (r?.sent) {
        toast.success(`پیامک تستی «${key}» به ${data.target} ارسال شد ✅`);
      } else {
        toast.error(
          `ارسال تستی «${key}» ناموفق: ${r?.error || (r?.skipped ? `(${r.skipped})` : "خطای نامشخص")}`
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ارسال پیامک تستی");
    } finally {
      setTestingKey(null);
    }
  }

  return (
    <Card className="p-5">
      {/* سربرگ کارت */}
      <div className="flex items-start gap-2 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 text-orange-500 flex items-center justify-center shrink-0">
          <ClipboardList className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-sm text-slate-900">ممیزی پیامک‌های سیستمی</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            وضعیت تک‌به‌تک همهٔ سناریوها: زمان ارسال، دداپ، مقصد لینک، شناسهٔ قالب و لاگ آخرین ارسال‌ها
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg h-8 text-[11px]"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "بروزرسانی"}
        </Button>
      </div>

      {!apiConfigured && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700 font-bold">
          ⚠ SMSIR_API_KEY روی سرور تنظیم نشده — هیچ پیامکی ارسال نمی‌شود (فقط لاگ می‌شود).
        </div>
      )}

      {/* شماره تست */}
      <div className="mb-4">
        <Input
          dir="ltr"
          inputMode="tel"
          value={testMobile}
          onChange={(e) => setTestMobile(e.target.value)}
          placeholder="شمارهٔ تست — خالی = شمارهٔ خود ادمین"
          className="rounded-xl min-h-[44px] text-sm max-w-xs"
        />
      </div>

      {/* لیست سناریوها */}
      {loading && !scenarios ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(scenarios || []).map((s) => {
            const open = expanded === s.prefix;
            const healthy = s.sent > 0 && s.failed === 0;
            const hasIssue = s.failed > 0;
            const neverSent = s.sent === 0 && s.failed === 0;
            return (
              <div
                key={s.prefix}
                className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden"
              >
                {/* ردیف اصلی */}
                <button
                  onClick={() => setExpanded(open ? null : s.prefix)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-right hover:bg-muted/40 transition"
                  aria-expanded={open}
                >
                  {healthy ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : hasIssue ? (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  ) : (
                    <Clock3 className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-slate-800 truncate">{s.name}</span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      {neverSent
                        ? "هنوز هیچ ارسالی ثبت نشده"
                        : `✅ ${toPersianDigits(s.sent)} موفق${s.failed ? ` — ❌ ${toPersianDigits(s.failed)} ناموفق` : ""} — آخرین: ${faDate(s.lastSentAt)}`}
                    </span>
                  </span>
                  <Badge
                    className={`shrink-0 text-[9px] ${
                      s.templateId
                        ? "bg-emerald-500/15 text-emerald-700"
                        : "bg-amber-500/15 text-amber-700"
                    }`}
                    dir="ltr"
                  >
                    {s.templateId ? `قالب ${s.templateId}` : "—"}
                  </Badge>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>

                {/* جزئیات */}
                {open && (
                  <div className="px-3 pb-3 space-y-2.5 border-t border-border/40 pt-2.5">
                    <div className="grid gap-1.5 text-[11px] leading-relaxed">
                      <p className="flex items-start gap-1.5">
                        <Clock3 className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                        <span><b>زمان ارسال:</b> {s.timing}</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span><b>ضد تکرار:</b> {s.dedupe}</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-cyan-600 shrink-0 mt-0.5" />
                        <span><b>لینک / مقصد:</b> {s.link}</span>
                      </p>
                      {s.templateId && (
                        <p className="flex items-start gap-1.5 text-muted-foreground">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span dir="auto">
                            <b>منبع شناسهٔ قالب:</b> {sourceLabel(s.source)}
                            {s.envKey ? ` (${s.envKey})` : ""}
                          </span>
                        </p>
                      )}
                    </div>

                    {/* دکمهٔ تست */}
                    <Button
                      size="sm"
                      onClick={() => void runSingleTest(s.prefix)}
                      disabled={testingKey === s.prefix}
                      className="rounded-lg text-white gap-1.5 h-9 text-[11px] shrink-0"
                      style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
                    >
                      {testingKey === s.prefix ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      ارسال تست این سناریو
                    </Button>

                    {/* لاگ‌های آخر */}
                    {s.recent.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-muted-foreground">
                          {toPersianDigits(s.recent.length)} لاگ آخر:
                        </p>
                        {s.recent.map((r, i) => (
                          <div
                            key={`${r.key}-${i}`}
                            className="flex items-start gap-2 text-[10px] rounded-lg bg-background/80 border border-border/40 px-2.5 py-1.5"
                          >
                            {r.status === "sent" ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                            )}
                            <span className="flex-1 leading-relaxed">
                              <span dir="ltr" className="font-mono">{r.mobile}</span>
                              <span className="text-muted-foreground"> — {faDate(r.createdAt)}</span>
                              <span dir="ltr" className="block text-[9px] text-muted-foreground font-mono truncate">
                                {r.key}
                              </span>
                              {r.error && (
                                <span className="block text-[9px] text-red-600 mt-0.5" dir="auto">{r.error}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
