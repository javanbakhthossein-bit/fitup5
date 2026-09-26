"use client";

/**
 * ═══════════════════════════════════════════════════════════════
 *  Task 4-a — هوک سبک خلاصهٔ سهمیه‌ها برای بنر چت فیتاپ
 * ═══════════════════════════════════════════════════════════════
 *
 *  GET /api/user/quota را در mount (وقتی enabled) می‌گیرد و refresh()
 *  برای به‌روزرسانی بعد از هر ارسال موفق عکس/ویدیو فراخوانی می‌شود.
 *  شکست‌ها ساکت هستند — بنر فقط وقتی داده هست نمایش داده می‌شود.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

export function useQuotaSummary(enabled: boolean) {
  const [summary, setSummary] = useState<QuotaSummary | null>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { res, data } = await fetchJson<QuotaSummary>("/api/user/quota", {
        cache: "no-store",
      });
      if (res.ok && data && typeof data === "object") {
        setSummary(data);
      }
    } catch {
      // ساکت — بنر سهمیه حیاتی نیست
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      refresh();
    }
  }, [enabled, refresh]);

  return { summary, refresh };
}
