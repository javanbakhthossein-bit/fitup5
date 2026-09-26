import type { Plan } from "@/lib/fitness/types";
import { getCapabilities } from "@/lib/fitness/types";

/**
 * ─── v79 — گیت سخت «برنامه مکمل» بر اساس پلن کاربر (درخواست مالک) ───
 *
 * گزارش مالک: «در پنل مدیر برای کاربر با پلن اقتصادی برنامه مکمل ساخته شده که
 * این خیلی اشتباهه — به هیچ وجه نباید برای کاربر اقتصادی برنامه مکمل ساخته
 * بشه و برای کاربران استاندارد به بالاست.»
 *
 * چرا گیت دوم لازم بود؟ (لایه‌های قبلی کافی نبودند)
 *  ۱) لایهٔ پرامپت (buildPlanAwareInstructions): برای پلن اقتصادی به AI گفته
 *     می‌شود مکمل تجویز نکند — ولی AI یک مدل احتمالی است و گاهی نادیده می‌گیرد.
 *  ۲) لایهٔ نگاشت خروجی (generateMealPlan): خروجی AI فقط وقتی از گیت
 *     getCapabilities(planName).supplementsPlan رد شود ذخیره می‌شود.
 *  اما ریشهٔ گزارش مالک «محتوای تاریخی» بود: کاربری که قبلاً پلن بالاتر داشته
 *  (یا در لحظهٔ تولید، پلن دیگری داشته) برنامهٔ مکمل‌دارش در DB مانده و بعد از
 *  تغییر پلن به اقتصادی همچنان در پنل کاربر/مدیر نمایش داده می‌شد.
 *
 * راه‌حل کامل (سه لایه):
 *  ۱) گیت تولید (موجود) — ساخت مکمل برای اقتصادی ممنوع.
 *  ۲) stripSupplementsForPlan (این فایل) — در «نمایش» همهٔ APIها اعمال می‌شود:
 *     اگر پلنِ فعلیِ کاربر basic/null باشد، فیلدهای supplements و
 *     supplementStack از محتوای برنامه (فعال و تاریخی) حذف می‌شوند.
 *  ۳) پاکسازی یک‌بارهٔ دیتا (scripts/strip-supplements-basic-users.mjs) —
 *     محتوای ذخیره‌شدهٔ کاربران اقتصادی فعلی از مکمل خالی می‌شود.
 *
 * قانون: پلن null هم مثل basic رفتار می‌شود (getCapabilities(null) → basic).
 */

/** پلن‌هایی که «برنامه مکمل» شامل آن‌ها می‌شود — استاندارد به بالا */
export function planHasSupplements(planName?: string | null): boolean {
  try {
    return getCapabilities((planName ?? null) as Plan | null).supplementsPlan === true;
  } catch {
    return false;
  }
}

/**
 * حذف فیلدهای مکمل از محتوای برنامه غذایی اگر پلن کاربر اجازه نمی‌دهد.
 * محتوای ورودی بدون تغییر (همان رفرنس) برمی‌گردد اگر مکمل مجاز باشد؛
 * در غیر این صورت یک آبجکت جدید بدون فیلدهای مکمل برمی‌گرداند.
 * ایمن: null/undefined یا محتوای غیرآرایه‌ای را بدون خطا پاس می‌دهد.
 */
export function stripSupplementsForPlan<T>(content: T, planName?: string | null): T {
  if (content == null || typeof content !== "object") return content;
  if (planHasSupplements(planName)) return content;
  // فیلدهای مکمل در هر دو قالب (برنامهٔ غذایی کامل و ساختارهای تخت) حذف می‌شوند
  const c = content as Record<string, unknown>;
  if (!("supplements" in c) && !("supplementStack" in c) && !("supplementTimingNotes" in c)) {
    return content;
  }
  const clone = { ...c };
  delete clone.supplements;
  delete clone.supplementStack;
  delete clone.supplementTimingNotes;
  return clone as T;
}
