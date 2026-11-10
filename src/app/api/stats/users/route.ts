import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /api/stats/users — شمارندهٔ زندهٔ ثبت‌نام‌کنندگان فیتاپ (Task 101-c)
 *
 * دیرکتیو مالک: در صفحهٔ «تحلیل آنبوردینگ» تعداد ثبت‌نام‌کنندگان واقعی و پویا
 * نزدیک بخش CTA/خرید نمایش داده شود تا کاربر به خرید ترغیب شود.
 *
 * N = db.user.count() + عدد پایهٔ پایدار از SiteSetting key="stats_users_base"
 * (اگر تنظیم نباشد، پایه = 0 — یعنی فقط تعداد واقعی).
 *
 * محافظت‌ها (هم‌الگوی /api/stats/public):
 *  - بدون احراز هویت (عمومی) + Cache-Control عمومی ۳۰۰ ثانیه‌ای
 *  - کش درون‌حافظه‌ای ۱۰ دقیقه‌ای در سطح ماژول — دیتابیس هر ۱۰ دقیقه فقط دو
 *    کوئری شمارش سبک می‌بیند
 *  - Rate limit سادهٔ درون‌حافظه‌ای per-IP (۳۰ درخواست در دقیقه)
 */

const STATS_USERS_TTL_MS = 10 * 60 * 1000;
let usersCache: { at: number; users: number } | null = null;

export async function GET(req: NextRequest) {
  // ─── Rate limit per-IP — سبک ولی مؤثر در برابر اسپم ───
  const rl = rateLimit(`stats-users:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  try {
    if (!usersCache || Date.now() - usersCache.at > STATS_USERS_TTL_MS) {
      // دو کوئری سبک: شمارش کاربران + پایهٔ پایدار از تنظیمات سایت
      const [realUsers, baseSetting] = await Promise.all([
        db.user.count(),
        db.siteSetting.findUnique({ where: { key: "stats_users_base" } }),
      ]);
      // مقدار پایه رشته ذخیره می‌شود — اگر نبود یا نامعتبر بود → 0
      const base = Number(baseSetting?.value ?? 0);
      usersCache = {
        at: Date.now(),
        users: realUsers + (Number.isFinite(base) && base > 0 ? Math.floor(base) : 0),
      };
    }

    return Response.json(
      { ok: true, users: usersCache.users },
      { headers: { "Cache-Control": "public, max-age=300" } }
    );
  } catch {
    // خطای دیتابیس — کلاینت موظف است در حالت خطا هیچ چیزی نشان ندهد (بی‌صدا)
    return Response.json(
      { ok: false, users: 0 },
      { status: 200, headers: { "Cache-Control": "public, max-age=60" } }
    );
  }
}
