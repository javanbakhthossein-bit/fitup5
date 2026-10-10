/**
 * ─── v202 — منبع واحد «تب‌های معتبر پنل» ─────────────────────────────
 *
 * قبلاً فهرست تب‌های معتبر در سه جا کپی دستی شده بود (drift — یافتهٔ ممیزی
 * v202-d): page-client.tsx (کامل)، notifications-overlay.tsx و
 * smart-notifications-widget.tsx (هر دو ناقص — «workouts»، «exercise-bank»،
 * «food-bank» و «activity» نبود) → لینک نوتیف مثل «?tab=workouts» بی‌صدا
 * دور ریخته می‌شد و به فال‌بک اورلی نوتیف می‌رفت.
 *
 * این ماژول تنها منبع truth است؛ فهرست باید با لیست «validTabs» در
 * page-client.tsx (بخش ?tab= از URL) و با اتحاد MainTab در store.ts
 * هم‌سانه بماند. («challenges» عمداً اینجا نیست — تب فروشگاه-محور store است
 * و در page-client:306 به‌عنوان تبِ آدرس‌پذیر از URL فهرست نشده.)
 */

export const VALID_TABS = [
  "dashboard",
  "programs",
  "workouts",
  "nutrition",
  "progress",
  "chat",
  "plans",
  "referral",
  "support",
  "mobileapp",
  "exercise-bank",
  "food-bank",
  "activity",
] as const;

export type ValidPanelTab = (typeof VALID_TABS)[number];

/** آیا این مقدار یک تب معتبر پنل است؟ (برای گیت لینک‌های «?tab=…») */
export function isValidPanelTab(v: string): boolean {
  return (VALID_TABS as readonly string[]).includes(v);
}
