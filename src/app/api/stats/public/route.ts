import { NextRequest } from "next/server";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
// v204 — منبع واحد آمار (همان تابعی که SSR صفحهٔ اصلی می‌خواند) — بدون کپی کوئری‌ها
import { getPublicStatsData, formatFaCount } from "@/lib/fitness/public-stats-server";

/**
 * GET /api/stats/public — آمار عمومی فیتاپ برای اثبات اجتماعی (Task 5-a)
 *
 * تعداد واقعی کاربران ثبت‌نام‌شده (و پلن‌های فروخته‌شده) را برمی‌گرداند تا در TrustBar
 * و باکس قیمت‌گذاری لندینگ (و مدال خرید) نمایش داده شود — عددهای ثابت
 * دستی دیگر جایی استفاده نمی‌شوند؛ اعتماد کاربر با عدد واقعی ساخته می‌شود.
 *
 * v204 — فیلد جدید appInstalls/appInstallsFa: مجموع نصب اپ موبایل
 * (اپ اختصاصی + اپ کافه‌بازار + وب‌اپ PWA) — دقیقاً همان فرمول داشبورد ادمین.
 *
 * محافظت‌ها:
 *  - بدون احراز هویت (عمومی) + Cache-Control عمومی ۳۰۰ ثانیه‌ای
 *  - کش درون‌حافظه‌ای ۱۰ دقیقه‌ای در سطح ماژول (مشترک با SSR صفحهٔ اصلی)
 *  - Rate limit سادهٔ درون‌حافظه‌ای per-IP (۳۰ درخواست در دقیقه)
 */

export async function GET(req: NextRequest) {
  // ─── Rate limit per-IP — سبک ولی مؤثر در برابر اسپم ───
  const rl = rateLimit(`stats-public:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  const s = await getPublicStatsData();
  if (!s) {
    // خطای دیتابیس — پاسخ دوستانه (کلاینت ok:false را نادیده می‌گیرد و فال‌بک می‌ماند)
    return Response.json(
      {
        ok: false,
        users: 0,
        plansSold: 0,
        exercises: 0,
        foods: 0,
        appInstalls: 0,
        usersFa: "۰+",
        plansSoldFa: "۰",
        exercisesFa: "۰+",
        foodsFa: "۰+",
        appInstallsFa: "۰",
      },
      { status: 200, headers: { "Cache-Control": "public, max-age=60" } }
    );
  }

  return Response.json(
    {
      ok: true,
      users: s.users,
      plansSold: s.plansSold,
      exercises: s.exercises,
      // Task 7-d — تعداد غذاهای بانک غذا (همان رفتار کش)
      foods: s.foods,
      // v204 — مجموع نصب اپ (اختصاصی + بازار + وب‌اپ) — فرمول داشبورد ادمین
      appInstalls: s.appInstalls,
      // اعداد فارسی آمادهٔ نمایش (مثلاً «۲٬۵۰۰+») — کلاینت مستقیماً استفاده می‌کند
      usersFa: `${formatFaCount(s.users)}+`,
      plansSoldFa: formatFaCount(s.plansSold),
      exercisesFa: `${formatFaCount(s.exercises)}+`,
      foodsFa: `${formatFaCount(s.foods)}+`,
      appInstallsFa: formatFaCount(s.appInstalls),
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
