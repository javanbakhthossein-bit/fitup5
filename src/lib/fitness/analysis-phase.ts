/**
 * v164 — فاز «تحلیل/خرید» بعد از آنبوردینگ — بازگشت دقیق بعد از هر رفرش.
 *
 * دیرکتیو مالک: «وقتی تحلیل آنبوردینگ به هر دلیلی رفرش بشه دیگه اون صفحه بالا
 * نمیاد و از داشبورد میاد بالا» + «باید دقیقاً همون مدال خرید میومد».
 *
 * مکانیزم: ورود به صفحهٔ تحلیل → فلگ `fitup_ap` (کوکی برای SSR + localStorage
 * برای کلاینت) و پلنِ بازِ مدال خرید در `fitup_ap_plan` (فقط وقتی مدال واقعاً
 * باز است). رفرش، بستن‌وبازکردن اپ، کرش رندرر یا خاموش/روشن‌کردن VPN — همه با
 * این فلگ دقیقاً به صفحهٔ تحلیل (و مدال بازِ همان پلن) برمی‌گردند؛ نه داشبورد.
 *
 * پاک‌سازی:
 *  - خرید موفق (اشتراک active/pending) → self-heal خود صفحهٔ تحلیل به داشبورد
 *  - «رفتن به داشبورد» از خود صفحهٔ تحلیل
 *  - بستن مدال خرید → فقط کلید `fitup_ap_plan` پاک می‌شود (فلگ صفحه می‌ماند)
 */

export const ANALYSIS_PHASE_COOKIE = "fitup_ap";

const ANALYSIS_PHASE_LS = "fitup_ap";
const ANALYSIS_PLAN_LS = "fitup_ap_plan";

/** ورود به فاز تحلیل — هم‌زمان با setScreen("analysis") صدا زده می‌شود */
export function markAnalysisPhase(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANALYSIS_PHASE_LS, "1");
    document.cookie = `${ANALYSIS_PHASE_COOKIE}=1; path=/; max-age=2592000; samesite=lax`;
  } catch {
    /* localStorage/cookie در دسترس نیست — بی‌صدا */
  }
}

/** خروج قطعی از فاز تحلیل (خرید موفق یا «رفتن به داشبورد») */
export function clearAnalysisPhase(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ANALYSIS_PHASE_LS);
    window.localStorage.removeItem(ANALYSIS_PLAN_LS);
    document.cookie = `${ANALYSIS_PHASE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    /* بی‌صدا */
  }
}

/** آیا کاربر قبلاً وارد فاز تحلیل شده و هنوز از آن خارج نشده؟ (کلاینت) */
export function isAnalysisPhasePending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ANALYSIS_PHASE_LS) === "1";
  } catch {
    return false;
  }
}

/**
 * شرط مشترک SSR/کلاینت: آیا این کاربر باید به صفحهٔ تحلیل برگردد؟
 * فقط وقتی آنبوردینگ تمام شده ولی هنوز هیچ اشتراکی (active یا pending) ندارد.
 */
export function shouldRestoreAnalysisPhase(
  user:
    | {
        onboardingDone?: boolean;
        hasActiveSubscription?: boolean;
        hasPendingSubscription?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!user) return false;
  return (
    !!user.onboardingDone &&
    !user.hasActiveSubscription &&
    !user.hasPendingSubscription
  );
}

/** مدال خرید باز شد — پلن را برای بازگشتِ بعد از رفرش ثبت کن */
export function rememberOpenPurchasePlan(planId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANALYSIS_PLAN_LS, planId);
  } catch {
    /* بی‌صدا */
  }
}

/** پلنِ باز مدال خرید (بدون حذف — حذف فقط بعد از استفاده/بستن) */
export function peekOpenPurchasePlan(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ANALYSIS_PLAN_LS);
  } catch {
    return null;
  }
}

/** پلنِ باز مدال خرید را پاک کن (بستن مدال) */
export function forgetOpenPurchasePlan(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ANALYSIS_PLAN_LS);
  } catch {
    /* بی‌صدا */
  }
}
