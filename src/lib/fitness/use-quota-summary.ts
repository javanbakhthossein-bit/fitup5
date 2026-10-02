"use client";

/**
 * ═══════════════════════════════════════════════════════════════
 *  Task 4-a — هوک سبک خلاصهٔ سهمیه‌ها برای بنر چت فیتاپ
 *  v171 — کش مشترک ماژول‌سطح (ضد درخواست تکراری)
 * ═══════════════════════════════════════════════════════════════
 *
 *  GET /api/user/quota را در mount (وقتی enabled) می‌گیرد و refresh()
 *  برای به‌روزرسانی بعد از هر ارسال موفق عکس/ویدیو فراخوانی می‌شود.
 *  شکست‌ها ساکت هستند — بنر فقط وقتی داده هست نمایش داده می‌شود.
 *
 *  v171 — قبلاً هر نمونهٔ هوک (چت فیتاپ + تب تغذیه +…) fetch مستقل می‌زد.
 *  حالا همهٔ نمونه‌ها از یک کش ۶۰ ثانیه‌ای ماژول‌سطح با single-flight استفاده
 *  می‌کنند:
 *   • کش تازه → نمایش فوری بدون شبکه (رندر آنی بنر).
 *   • refresh() (بعد از اقدام مصرف‌کنندهٔ سهمیه: ارسال عکس چت/آنالیز غذا و…)
 *     همیشه «شبکه‌ای تازه» می‌گیرد — رفتار invalidate-on-action حفظ شده.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fitness/fetch-json";

export interface QuotaPartSummary {
  used: number;
  total: number;
  baseTotal: number;
  bonus: number;
  dailyUsed: number;
  dailyTotal: number;
  remaining: number;
}

export interface QuotaSummary {
  hasPlan: boolean;
  planName: string | null;
  planDays: number;
  /** تعداد کل حرکات برنامهٔ تمرینی فعال — منبع سقف movement_video */
  workoutExerciseCount: number;
  chatPhoto: QuotaPartSummary;
  mealPhoto: QuotaPartSummary;
  movementVideo: QuotaPartSummary;
}

// ─── کش مشترک ماژول‌سطح (۶۰ ثانیه) + تک‌پرواز ───
const QUOTA_TTL_MS = 60_000;
let quotaCache: { at: number; data: QuotaSummary } | null = null;
let quotaInFlight: Promise<QuotaSummary | null> | null = null;

/** واکشی با single-flight — پاسخ موفق در کش مشترک ثبت می‌شود؛ شکست کش نمی‌شود */
function fetchQuotaOnce(): Promise<QuotaSummary | null> {
  if (quotaInFlight) return quotaInFlight;
  quotaInFlight = (async () => {
    try {
      const { res, data } = await fetchJson<QuotaSummary>("/api/user/quota", {
        cache: "no-store",
      });
      if (res.ok && data && typeof data === "object") {
        quotaCache = { at: Date.now(), data };
        return data;
      }
      return null;
    } catch {
      // ساکت — بنر سهمیه حیاتی نیست
      return null;
    } finally {
      quotaInFlight = null;
    }
  })();
  return quotaInFlight;
}

export function useQuotaSummary(enabled: boolean) {
  // رندر اول — اگر کش مشترک موجود است (تازه یا منقضی)، همان لحظه پر شود
  // (بدون اسپینر؛ مقدار منقضی با رفرش پس‌زمینه تازه می‌شود)
  const [summary, setSummary] = useState<QuotaSummary | null>(() =>
    enabled && quotaCache ? quotaCache.data : null
  );

  /**
   * refresh — بعد از اقدام مصرف‌کنندهٔ سهمیه صدا زده می‌شود (ارسال عکس چت،
   * آنالیز غذا و…) → همیشه شبکه‌ای تازه (کش دور زده می‌شود) — همان رفتار قبلی.
   */
  const refresh = useCallback(async () => {
    const data = await fetchQuotaOnce();
    if (data) setSummary(data);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // کش تازه → صفر شبکه (state اولیه همین مقدار را دارد — بدون setState همگام)
    if (quotaCache && Date.now() - quotaCache.at < QUOTA_TTL_MS) return;
    // کش منقضی/غایب → رفرش تک‌پرواز؛ به‌روزرسانی async (مجاز — خارج از بدن effect)
    let cancelled = false;
    fetchQuotaOnce().then((data) => {
      if (!cancelled && data) setSummary(data);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { summary, refresh };
}
