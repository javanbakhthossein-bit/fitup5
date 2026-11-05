import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

/**
 * v216-B — کد تخفیف شخصی «آپ‌سل» (دیرکتیو مالک)
 *
 * GET /api/panel/personal-discount
 * کد تخفیف شخصیِ فعالِ کاربر را برمی‌گرداند تا در لحظه‌های ریتنشن
 * («برنامه آماده شد» در تب برنامه‌ها / «اولین عکس پیشرفت» در گالری)
 * با کارت PersonalUpsellCard نمایش داده شود.
 *
 * Get-or-create:
 *  - اگر کد استفاده‌نشده و معتبری با reason="personal_upsell" وجود دارد → همان برمی‌گردد
 *  - وگرنه کد جدید ساخ می‌شود: { type:"percent", value:10, validUntil: now+7d,
 *    code: "FIT-" + ۶ کاراکتر تصادفی A-Z0-9 (چک یکتایی قبل از create) }
 *
 * پاسخ موفق: { code, value, validUntil, eligible: true }
 * پاسخ ناموفق: هرگز throw نمی‌کند → 200 با { code: null }
 * (فقط عدم احراز هویت 401 برمی‌گرداند — هم‌الگوی بقیهٔ /api/panel)
 */

/** کد "FIT-XXXXXX" با ۶ کاراکتر تصادفی A-Z0-9 بزرگ */
function generatePersonalCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[bytes[i] % chars.length];
  return `FIT-${out}`;
}

export async function GET() {
  // احراز هویت — 401 هم‌الگوی بقیهٔ روت‌های پنل
  let userId: string;
  try {
    const user = await requireAuth();
    userId = user.id;
  } catch (e) {
    return apiError(e);
  }

  try {
    // ─── v216 (ادامهٔ دیرکتیو مالک) ───
    // سپر صداقت اولیه حذف شد: اعتبارسنج‌های کد تخفیف (checkout/discount/
    // computePlanFinalAmount) حالا reason="personal_upsell" را از گیت
    // «فقط خرید اول» معاف کرده‌اند (تک‌مصرف، مقید به userId، ۷روزه، ۱۰٪) —
    // پس دارندگان پلن اقتصادی هم در لحظه‌های ریتنشن کد واقعی می‌گیرند و
    // همان کد سر درگاه پذیرفته می‌شود. دارندگان استاندارد+ از سمت کارت
    // (isFullPlanName) اصلاً به این API نمی‌رسند.

    const now = new Date();

    // ۱) کد فعال موجود (استفاده‌نشده + معتبر)
    const existing = await db.userDiscountCode.findFirst({
      where: {
        userId,
        isUsed: false,
        reason: "personal_upsell",
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return Response.json({
        code: existing.code,
        value: existing.value,
        validUntil: existing.validUntil?.toISOString() ?? null,
        eligible: true,
      });
    }

    // ۲) ساخت کد جدید — چک یکتایی قبل از create (فضای ۳۶^۶؛ با retry کوتاه)
    let code = generatePersonalCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await db.userDiscountCode.findUnique({ where: { code } });
      if (!clash) break;
      code = generatePersonalCode();
    }
    const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // ۷ روز
    const created = await db.userDiscountCode.create({
      data: {
        userId,
        code,
        type: "percent",
        value: 10,
        reason: "personal_upsell",
        validUntil,
      },
    });

    return Response.json({
      code: created.code,
      value: created.value,
      validUntil: created.validUntil?.toISOString() ?? null,
      eligible: true,
    });
  } catch {
    // Never throw — شکست شبکه/DB هرگز نباید جریان میزبان (برنامه/گالری) را بشکند
    return Response.json({ code: null });
  }
}
