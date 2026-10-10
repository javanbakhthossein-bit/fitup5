import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  verifyAdmin2faToken,
  verifyAdminPassword,
  setSession,
  buildUserDto,
  apiError,
} from "@/lib/fitness/auth";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * POST /api/auth/admin-2fa — v202 ممیزی (H3): مرحلهٔ دوم ورود مدیر
 *
 * ورودی: { adminToken, password }
 *  - adminToken: توکن میانی ۵دقیقه‌ای صادرشده از verify-otp (بعد از OTP درست)
 *  - password:   رمز دوم مدیر — مقایسه با ADMIN_PASSWORD در env (timing-safe)
 *
 * خروجی موفق: سشن کامل ادمین + DTO (دقیقاً همان شکل پاسخ verify-otp).
 * اگر ADMIN_PASSWORD در env تنظیم نشده باشد، این مسیر هرگز فعال نمی‌شود
 * (verify-otp اصلاً adminToken نمی‌دهد) — پاسخ ۴۰۳ ثابت.
 *
 * ضد brute-force: ۵ تلاش در ۱۵ دقیقه به‌ازای هر adminToken و هر IP.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      adminToken?: string;
      password?: string;
    };
    const adminToken = String(body?.adminToken || "").trim();
    const password = String(body?.password || "");
    if (!adminToken || !password) {
      return Response.json(
        { error: "توکن ورود و رمز دوم الزامی است." },
        { status: 400 }
      );
    }

    // اگر رمز دوم اصلاً پیکربندی نشده — مسیر بی‌معناست؛ رد قطعی
    if (!process.env.ADMIN_PASSWORD?.trim()) {
      return Response.json(
        { error: "رمز دوم مدیر پیکربندی نشده است." },
        { status: 403 }
      );
    }

    const ip = getClientIp(req);
    const rl = rateLimit(`admin2fa-ip:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const decoded = verifyAdmin2faToken(adminToken);
    if (!decoded) {
      return Response.json(
        { error: "اعتبار ورود منقضی شده است. لطفاً دوباره کد پیامکی را وارد کنید." },
        { status: 401 }
      );
    }

    // سقف تلاش به‌ازای توکن میانی (توکن یکتاست → کلید یکتا)
    const rlToken = rateLimit(`admin2fa-t:${adminToken.slice(-16)}`, 5, 15 * 60 * 1000);
    if (!rlToken.ok) return rateLimitResponse(rlToken.retryAfterSec);

    if (!verifyAdminPassword(password)) {
      return Response.json({ error: "رمز دوم اشتباه است." }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: decoded.uid } });
    if (!user || user.isBlocked) {
      return Response.json(
        { error: "حساب کاربری معتبر نیست." },
        { status: 403 }
      );
    }

    await setSession(user.id);
    const dto = await buildUserDto(user.id);
    if (!dto) {
      return Response.json({ error: "خطا در ساخت اطلاعات کاربر." }, { status: 500 });
    }
    return Response.json(dto);
  } catch (e) {
    return apiError(e);
  }
}
