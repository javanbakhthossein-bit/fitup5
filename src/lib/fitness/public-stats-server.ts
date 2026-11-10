import "server-only";
import { db } from "@/lib/db";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * v204 — منبع واحد آمار عمومی لندینگ (سمت سرور)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * دیرکتیو مالک: «با اینترنت سرعت پایین کاربر فکر می‌کند آمار صفر است» —
 * راه‌حل ریشه‌ای: آمار در SSR (src/app/page.tsx) هم از همین تابع خوانده می‌شود
 * و عدد واقعی از همان اول در HTML است؛ کلاینت بعداً با /api/stats/public
 * (همان منبع، همان کش) زنده نگه داشته می‌شود — بدون هیچ شمارش از صفر.
 *
 * فرمول «نصب اپ» دقیقاً همان فرمول داشبورد ادمین (admin/stats) است:
 *   اپ اختصاصی (appInstallSource="panel") + اپ بازار ("bazaar") + وب‌اپ (pwaInstalledAt)
 *
 * کش ماژول‌سطح ۱۰ دقیقه‌ای — همان رفتار قبلی route (دیتابیس فقط دو count سبک).
 */

export interface PublicStatsData {
  users: number;
  plansSold: number;
  exercises: number;
  foods: number;
  /** مجموع نصب اپ موبایل: اختصاصی + بازار + وب‌اپ (PWA) — فرمول داشبورد ادمین */
  appInstalls: number;
}

const STATS_TTL_MS = 10 * 60 * 1000;
let statsCache: { at: number; data: PublicStatsData } | null = null;

/** تبدیل عدد به رقم فارسی با جداکنندهٔ هزارگان «٬» — مثال: ۲٬۵۰۰ */
export function formatFaCount(n: number): string {
  return n
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/**
 * آمار عمومی — null فقط وقتی دیتابیس در دسترس نیست (کلاینت فال‌بک می‌شود).
 */
export async function getPublicStatsData(): Promise<PublicStatsData | null> {
  try {
    if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) {
      return statsCache.data;
    }
    const [users, plansSold, exercises, foods, panelInstalls, bazaarInstalls, pwaInstalls] =
      await Promise.all([
        db.user.count({ where: { isBlocked: false } }),
        db.payment.count({ where: { status: "success" } }),
        db.exerciseLibrary.count(),
        db.foodLibrary.count(),
        // نصب اپ نیتیو — منبع: UA اپ‌ها (FitUpApp/ = اختصاصی، FitUpBazaar/ = بازار)
        db.user.count({ where: { appInstallSource: "panel" } }),
        db.user.count({ where: { appInstallSource: "bazaar" } }),
        // وب‌اپ (PWA) — رویداد appinstalled
        db.user.count({ where: { pwaInstalledAt: { not: null } } }),
      ]);
    const data: PublicStatsData = {
      users,
      plansSold,
      exercises,
      foods,
      appInstalls: panelInstalls + bazaarInstalls + pwaInstalls,
    };
    statsCache = { at: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}
