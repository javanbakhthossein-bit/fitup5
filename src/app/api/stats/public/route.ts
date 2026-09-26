import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /api/stats/public — آمار عمومی فیتاپ برای اثبات اجتماعی (Task 5-a)
 *
 * تعداد واقعی کاربران ثبت‌نام‌شده از دیتابیس را برمی‌گرداند تا در TrustBar
 * و باکس قیمت‌گذاری لندینگ (و مدال خرید) نمایش داده شود — عددهای ثابت
 * دستی دیگر جایی استفاده نمی‌شوند؛ اعتماد کاربر با عدد واقعی ساخته می‌شود.
 *
 * محافظت‌ها:
 *  - بدون احراز هویت (عمومی) + Cache-Control عمومی ۳۰۰ ثانیه‌ای
 *  - کش درون‌حافظه‌ای ۱۰ دقیقه‌ای در سطح ماژول — دیتابیس هر ۱۰ دقیقه فقط
 *    دو کوئری شمارش سبک می‌بیند (تک‌نود SQLite؛ الگوی کش چت با TTL)
 *  - Rate limit سادهٔ درون‌حافظه‌ای per-IP (۳۰ درخواست در دقیقه)
 */

/** کش ماژول‌سطح — الگوی TTL مشابه کش ۹۰ ثانیه‌ای چت */
const STATS_TTL_MS = 10 * 60 * 1000;
let statsCache: {
  at: number;
  users: number;
  plansSold: number;
  exercises: number;
  foods: number;
} | null = null;

/** تبدیل عدد به رقم فارسی با جداکنندهٔ هزارگان «٬» — مثال: ۲٬۵۰۰ */
function formatFaCount(n: number): string {
  return n
    .toLocaleString("en-US")
    .replace(/,/g, "٬")
    .replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export async function GET(req: NextRequest) {
  // ─── Rate limit per-IP — سبک ولی مؤثر در برابر اسپم ───
  const rl = rateLimit(`stats-public:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  try {
    if (!statsCache || Date.now() - statsCache.at > STATS_TTL_MS) {
      // شمارش کاربران واقعی: همهٔ حساب‌های ثبت‌شدهٔ غیرمسدود (کاربر + ادمین).
      // هیچ فلگ isDeleted در اسکیما نیست؛ isBlocked تنها فلگ حذف/مسدودسازی است.
      // v94 — تعداد حرکات کتابخانه هم (دیرکتیو مالک: مجموع حرکات در صفحهٔ اصلی
      // باید با رشد کتابخانه آپدیت شود — رشته‌های ترند پیلاتس/TRX و…)
      // Task 7-d — تعداد غذاهای بانک FoodLibrary هم اضافه شد تا شمارندهٔ
      // «غذای سالم» لندینگ مثل بقیه از صفر شروع به شمارش کند (نه رشتهٔ ثابت).
      const [users, plansSold, exercises, foods] = await Promise.all([
        db.user.count({ where: { isBlocked: false } }),
        // فقط یک count سبک روی ایندکس موجود status — بدون join
        db.payment.count({ where: { status: "success" } }),
        db.exerciseLibrary.count(),
        db.foodLibrary.count(),
      ]);
      statsCache = { at: Date.now(), users, plansSold, exercises, foods };
    }

    return Response.json(
      {
        ok: true,
        users: statsCache.users,
        plansSold: statsCache.plansSold,
        exercises: statsCache.exercises,
        // Task 7-d — تعداد غذاهای بانک غذا (همان رفتار کش)
        foods: statsCache.foods,
        // اعداد فارسی آمادهٔ نمایش (مثلاً «۲٬۵۰۰+») — کلاینت مستقیماً استفاده می‌کند
        usersFa: `${formatFaCount(statsCache.users)}+`,
        plansSoldFa: formatFaCount(statsCache.plansSold),
        exercisesFa: `${formatFaCount(statsCache.exercises)}+`,
        foodsFa: `${formatFaCount(statsCache.foods)}+`,
      },
      { headers: { "Cache-Control": "public, max-age=300" } }
    );
  } catch {
    // خطای دیتابیس — پاسخ دوستانه (کلاینت ok:false را نادیده می‌گیرد و CountUp از صفر می‌شمارد)
    return Response.json(
      {
        ok: false,
        users: 0,
        plansSold: 0,
        exercises: 0,
        foods: 0,
        usersFa: "۰+",
        plansSoldFa: "۰",
        exercisesFa: "۰+",
        foodsFa: "۰+",
      },
      { status: 200, headers: { "Cache-Control": "public, max-age=60" } }
    );
  }
}
