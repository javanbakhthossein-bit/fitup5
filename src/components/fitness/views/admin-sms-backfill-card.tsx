"use client";

import { useState } from "react";
import {
  MessageSquare,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  TestTube,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toPersianDigits } from "@/lib/fitness/types";

/**
 * کارت «پیامک‌های سیستمی فیتاپ» — داخل تب تنظیمات سایت پنل ادمین.
 *
 * v35: بخش backfill حذف شد (طبق درخواست مالک — ارسال گروهی اولین دیپلوی
 * انجام شده و ابزارهایش از کد خارج شدند). ابزار ارسال مجدد پیامک‌های
 * ناموفق روی سرور باقی است: bun run scripts/resend-sms.ts
 *
 * این کارت فقط تست قالب‌ها را نگه می‌دارد:
 *   A) تست قالب‌ها: ارسال واقعی هر ۱۵ قالب پیامکی به شمارهٔ دلخواه
 *      (POST /api/admin/sms-test — پیش‌فرض شمارهٔ خود ادمین)
 */

/* ─── انواع دادهٔ API ─── */
interface SmsTestResult {
  key: string;
  sent: boolean;
  skipped?: string;
  error?: string;
}
interface SmsEnvStatus {
  key: string;
  envKey: string;
  templateId: string | null;
}

/* ─── کلید نتیجهٔ تست → کد قالب + نام فارسی ─── */
const TEST_RESULT_META: Record<string, { code: string; name: string }> = {
  onboarding_nudge_669068: { code: "669068", name: "یادآوری آنبوردینگ" },
  onboarding_winback_461291: { code: "461291", name: "وین‌بک آنبوردینگ (کد تخفیف)" },
  program_ready_663678: { code: "663678", name: "برنامه آماده شد" },
  checkup_reminder_761137: { code: "761137", name: "یادآوری چکاپ" },
  plan_expired_322780: { code: "322780", name: "انقضای پلن" },
  invite_friend_852193: { code: "852193", name: "دعوت دوستان (لینک معرف)" },
  expired_winback_604678: { code: "604678", name: "وین‌بک ۷۲ ساعته (کد تخفیف)" },
  welcome_offer_612964: { code: "612964", name: "خوش‌آمدگویی ۸ روزه (کد تخفیف) — v47" },
  renewal_boost_883325: { code: "883325", name: "تقویت تمدید ۸ روزه (کد تخفیف) — v47" },
  purchase_advanced_423726: { code: "423726", name: "خرید موفق — پلن پیشرفته" },
  purchase_ultimate_612405: { code: "612405", name: "خرید موفق — پلن حرفه‌ای" },
  purchase_basic_565185: { code: "565185", name: "خرید موفق — اقتصادی/استاندارد" },
};

/** برچسب فارسی مقدار skipped در نتیجهٔ تست */
function skippedLabel(skipped?: string): string | null {
  if (!skipped) return null;
  if (skipped === "no_template") return "متغیر محیطی قالب تنظیم نشده — ارسال نشد";
  if (skipped === "already_sent") return "قبلاً ارسال شده (داپ) — ارسال نشد";
  if (skipped === "invalid_mobile") return "شماره نامعتبر — ارسال نشد";
  return `رد شد (${skipped})`;
}

export function AdminSmsBackfillCard() {
  const [testMobile, setTestMobile] = useState("");
  const [testing, setTesting] = useState(false);
  const [testTarget, setTestTarget] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<SmsTestResult[] | null>(null);
  const [envStatus, setEnvStatus] = useState<SmsEnvStatus[] | null>(null);

  async function runSmsTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/sms-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: testMobile.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "خطا در ارسال پیامک تستی");
      setTestResults(data?.results || []);
      setEnvStatus(data?.envStatus || []);
      setTestTarget(data?.target || null);
      const sent = (data?.results || []).filter((r: SmsTestResult) => r.sent).length;
      toast.success(
        sent === 10
          ? `هر ۱۳ قالب تستی به ${data.target} ارسال شد ✅`
          : `${toPersianDigits(sent)} از ۱۳ قالب تستی به ${data.target} ارسال شد`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ارسال پیامک تستی");
    } finally {
      setTesting(false);
    }
  }

  const sentCount = testResults ? testResults.filter((r) => r.sent).length : 0;

  return (
    <Card className="p-5">
      {/* سربرگ کارت */}
      <div className="flex items-start gap-2 mb-4">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-sky-500/10 text-cyan-500 flex items-center justify-center shrink-0">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm text-slate-900">پیامک‌های سیستمی فیتاپ</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            تست ارسال واقعی ۱۳ قالب پیامکی به شمارهٔ دلخواه (آنبوردینگ، وین‌بک، خرید، انقضا و…)
          </p>
        </div>
      </div>

      {/* ─── A) تست قالب‌ها ─── */}
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TestTube className="w-4 h-4 text-cyan-600 shrink-0" />
            <p className="text-xs font-bold">تست قالب‌ها</p>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            هر ۱۳ قالب با پارامترهای واقعی (نام + کد تخفیف + لینک) به شمارهٔ انتخابی ارسال می‌شود — پیامک واقعی می‌رود. قالب‌های خرید اگر متغیر نداشته باشند بدون پارامتر امتحان می‌شوند.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              dir="ltr"
              inputMode="tel"
              value={testMobile}
              onChange={(e) => setTestMobile(e.target.value)}
              placeholder="شماره موبایل — خالی = شماره خودم"
              className="rounded-xl flex-1 min-h-[44px] text-sm"
              disabled={testing}
            />
            <Button
              onClick={runSmsTest}
              disabled={testing}
              className="rounded-xl gap-1.5 min-h-[44px] text-white shrink-0"
              style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  در حال ارسال...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  ارسال هر ۱۳ قالب تستی
                </>
              )}
            </Button>
          </div>

          {/* نتیجهٔ تست — لیست هر ۱۳ قالب */}
          {testResults && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-bold">
                نتیجه برای <span dir="ltr">{toPersianDigits(testTarget || "")}</span>:{" "}
                <span className={sentCount === 10 ? "text-emerald-600" : "text-amber-600"}>
                  {toPersianDigits(sentCount)} از ۱۰ موفق
                </span>
              </p>
              <ul className="space-y-1">
                {testResults.map((r) => {
                  const meta = TEST_RESULT_META[r.key];
                  const skipped = skippedLabel(r.skipped);
                  return (
                    <li
                      key={r.key}
                      className="flex items-start gap-2 text-xs rounded-xl bg-background/70 border border-border/40 px-3 py-2"
                    >
                      {r.sent ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      )}
                      <span className="flex-1 leading-relaxed">
                        <span className="font-bold">قالب {toPersianDigits(meta?.code ?? "؟")}</span>
                        <span className="text-muted-foreground"> — {meta?.name ?? r.key}</span>
                        {!r.sent && (r.error || skipped) && (
                          <span className="block text-[10px] text-muted-foreground mt-0.5">{r.error || skipped}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* وضعیت متغیرهای محیطی قالب‌ها */}
              {envStatus && envStatus.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] text-muted-foreground w-full">وضعیت متغیرهای محیطی قالب‌ها (.env سرور):</span>
                  {envStatus.map((e) => (
                    <Badge
                      key={e.key}
                      className={`text-[10px] gap-1 font-mono ${
                        e.templateId ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-600"
                      }`}
                      dir="ltr"
                    >
                      {e.envKey}
                      {e.templateId ? ` ✓ ${e.templateId}` : " ✗"}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
    </Card>
  );
}
