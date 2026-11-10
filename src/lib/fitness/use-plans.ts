"use client";

import { useEffect, useState } from "react";
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from "./types";

interface UsePlansResult {
  plans: SubscriptionPlan[];
  loading: boolean;
  refresh: () => Promise<void>;
}

// کش سراسری — همه‌ی نمونه‌های hook از همین داده استفاده می‌کنند
let globalPlans: SubscriptionPlan[] = SUBSCRIPTION_PLANS;
let globalFetchPromise: Promise<void> | null = null;
let globalFetched = false;

/**
 * 🔧 v138 — پالایش سخت‌گیرانهٔ پاسخ سرور (ریشه‌کنی باگ لاگ مدیر:
 * «Cannot read properties of undefined (reading 'toLocaleString')»
 * روی تب اشتراک و پلن‌ها با WebView اپ اندروید).
 *
 * قبلاً data.plans «بدون هیچ اعتبارسنجی» جایگزین پیش‌فرض‌ها می‌شد؛ هر
 * انحراف شکل داده (price گم‌شده/null، features غیرآرایه، رکورد ناقص
 * از دیتابیس یا نسخهٔ قدیمی سرور در WebView) مستقیم به render می‌رفت
 * و مرز خطا کل تب را می‌انداخت. حالا: هر پلن سرور «روی» پلن پیش‌فرضِ
 * همان id مچ می‌شود و فقط فیلدهای عددی/متنیِ معتبر جایگزین می‌شوند —
 * خروجی همیشه کامل و سالم است حتی اگر سرور garbage بدهد.
 */
function sanitizePlans(raw: unknown): SubscriptionPlan[] {
  if (!Array.isArray(raw)) return SUBSCRIPTION_PLANS;
  const out: SubscriptionPlan[] = [];
  for (const base of SUBSCRIPTION_PLANS) {
    const incoming = raw.find(
      (p) => p && typeof p === "object" && (p as Record<string, unknown>).id === base.id
    ) as Partial<SubscriptionPlan> | undefined;
    if (!incoming) {
      out.push(base);
      continue;
    }
    const num = (v: unknown, fallback: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
    };
    const str = (v: unknown, fallback: string): string =>
      typeof v === "string" && v.trim() !== "" ? v : fallback;
    const price = num(incoming.price, base.price);
    out.push({
      ...base,
      ...incoming,
      id: base.id,
      tier: num(incoming.tier, base.tier),
      label: str(incoming.label, base.label),
      tagline: str(incoming.tagline, base.tagline),
      price,
      durationDays: num(incoming.durationDays, base.durationDays),
      phases: num(incoming.phases, base.phases),
      icon: str(incoming.icon, base.icon),
      accentColor: str(incoming.accentColor, base.accentColor),
      badge: typeof incoming.badge === "string" ? incoming.badge : base.badge,
      popular:
        typeof incoming.popular === "boolean" ? incoming.popular : base.popular,
      features:
        Array.isArray(incoming.features) && incoming.features.length > 0
          ? incoming.features.filter((f): f is string => typeof f === "string" && f.trim() !== "")
          : base.features,
      capabilities: { ...base.capabilities, ...(incoming.capabilities ?? {}) },
    } as SubscriptionPlan);
  }
  return out;
}

async function fetchPlansOnce() {
  if (globalFetchPromise) return globalFetchPromise;
  globalFetchPromise = (async () => {
    try {
      const res = await fetch("/api/payment/checkout");
      const data = await res.json();
      if (data.plans) {
        globalPlans = sanitizePlans(data.plans);
        globalFetched = true;
      }
    } catch {
      // در صورت خطا از پیش‌فرض‌ها استفاده می‌شود
    } finally {
      globalFetchPromise = null;
    }
  })();
  return globalFetchPromise;
}

/**
 * Hook مشترک برای دریافت پلن‌ها با قیمت‌های به‌روز از سرور.
 * یک fetch سراسری انجام می‌شود و همه‌ی نمونه‌ها از همان نتیجه استفاده می‌کنند.
 */
export function usePlans(): UsePlansResult {
  const [plans, setPlans] = useState<SubscriptionPlan[]>(globalPlans);
  const [loading, setLoading] = useState(!globalFetched);

  useEffect(() => {
    let mounted = true;
    // v222 — هم مسیر کش و هم مسیر fetch از طریق کال‌بک promise رزول می‌شوند
    // (react-hooks/set-state-in-effect: setState همگام در بدنهٔ effect ممنوع).
    // رفتار عیناً مثل قبل است؛ فقط در یک میکروتسک اجرا می‌شود.
    fetchPlansOnce().then(() => {
      if (mounted) {
        if (plans !== globalPlans) setPlans(globalPlans);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const refresh = async () => {
    globalFetched = false;
    await fetchPlansOnce();
    setPlans(globalPlans);
  };

  return { plans, loading, refresh };
}

/**
 * v171 — نسخهٔ تابعیِ همان کش سراسری (بدون هوک) — برای مصرف‌کننده‌هایی که فقط
 * دادهٔ پلن‌ها را می‌خواهند (مثلاً FAQ پشتیبانی). از همان single-flight سراسری
 * fetchPlansOnce استفاده می‌کند → مصرف‌کنندهٔ دوم صفر درخواست اضافه می‌زند.
 */
export async function getPlansCached(): Promise<SubscriptionPlan[]> {
  if (!globalFetched) {
    await fetchPlansOnce();
  }
  return globalPlans;
}
