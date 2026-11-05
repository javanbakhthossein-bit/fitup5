import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { getActivePlan } from "@/lib/fitness/pricing";
// v198 — رویدادگذاری قیف فروش (دیرکتیو مالک)
import { recordFunnelEvent } from "@/lib/analytics/funnel";
import {
  ABANDONED_CART_DISPLAY_CODE,
  getAbandonedCartCodeForUser,
} from "@/lib/fitness/notifications";
import { toPersianDigits, type Plan } from "@/lib/fitness/types";

// اعتبارسنجی کد تخفیف و محاسبه قیمت نهایی
// FIX 1: قیمت پلن از getActivePlan() (SiteSetting — قابل ویرایش توسط ادمین) خوانده
// می‌شود، نه از SUBSCRIPTION_PLANS ثابت کد — تا preview با مبلغ واقعی شارژشده
// در checkout یکی باشد (checkout هم از همان منبع استفاده می‌کند).
// FIX 2: کد تخفیف اختصاصی (UserDiscountCode — کدهای تمدید FITAP15-...) هم
// پشتیبانی می‌شود؛ قبلاً فقط جدول عمومی DiscountCode چک می‌شد و تایپ دستی کد
// اختصاصی «کد تخفیف نامعتبر» می‌گرفت (فقط از طریق prefill plans-view کار می‌کرد).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    // v202 ممیزی (M4) — rate limit ضد brute-force کد تخفیف و ضد اوراکل وجود/مالکیت
    // کد اختصاصی دیگران: ۳۰ درخواست در دقیقه، هم per-IP و هم per-user.
    const rlIp = rateLimit(`discount:${getClientIp(req)}`, 30, 60_000);
    if (!rlIp.ok) return rateLimitResponse(rlIp.retryAfterSec);
    const rlUser = rateLimit(`discount-user:${user.id}`, 30, 60_000);
    if (!rlUser.ok) return rateLimitResponse(rlUser.retryAfterSec);
    const { code, planId } = (await req.json()) as { code: string; planId: Plan };
    const plan = await getActivePlan(planId);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      return Response.json({ error: "کد تخفیف را وارد کنید." }, { status: 400 });
    }

    let discountType: "percent" | "fixed" = "percent";
    let discountValueRaw = 0;
    let discountLabel = "";
    let matchedCode = normalized;
    // v53 — اعتبار کد برای شمارش معکوس UI (کدهای اختصاصی تاریخ انقضا دارند)
    let recordValidUntil: Date | null = null;

    // ─── ۱. کد تخفیف عمومی (DiscountCode) ───
    const dc = await db.discountCode.findUnique({ where: { code: normalized } });
    if (dc) {
      if (!dc.active) {
        return Response.json({ valid: false, error: "کد تخفیف نامعتبر است." });
      }
      // v207 — زمان‌بندی شروع کمپین‌های پیامکی: کدِ برنامه‌ریزی‌شده برای آینده هنوز فعال نیست
      if (dc.validFrom && dc.validFrom > new Date()) {
        return Response.json({ valid: false, error: "کد تخفیف هنوز فعال نشده است." });
      }
      if (dc.validUntil && dc.validUntil < new Date()) {
        return Response.json({ valid: false, error: "کد تخفیف منقضی شده است." });
      }
      if (dc.maxUses !== -1 && dc.usedCount >= dc.maxUses) {
        return Response.json({ valid: false, error: "سقف استفاده از این کد تکمیل شده است." });
      }
      if (dc.applicablePlans !== "all") {
        const allowed = dc.applicablePlans.split(",");
        if (!allowed.includes(plan.id)) {
          return Response.json({
            valid: false,
            error: "این کد تخفیف برای پلن انتخاب‌شده قابل استفاده نیست.",
          });
        }
      }
      discountType = dc.type as "percent" | "fixed";
      discountValueRaw = dc.value;
      matchedCode = dc.code;
      recordValidUntil = dc.validUntil ?? null;
      discountLabel =
        discountType === "percent"
          ? `${toPersianDigits(dc.value)}٪ تخفیف`
          : `${toPersianDigits(dc.value.toLocaleString("en-US"))} تومان تخفیف`;
    } else {
      // ─── ۲. کد تخفیف اختصاصی کاربر (UserDiscountCode — کد تمدید) ───
      // همان اعتبارسنجی checkout برای کدهای شخصی: مالکیت + used + انقضا
      //
      // ─── v53 — کد نمایشی «248945» (ترک درگاه پرداخت) ───
      // نمایش به کاربر همیشه «248945» است ولی کد داخلی یکتای 248945-XXXXX با
      // reason=abandoned_cart در جدول است → برای کاربر لاگین resolve می‌شود.
      let udc: Awaited<ReturnType<typeof db.userDiscountCode.findUnique>> = null;
      if (normalized === ABANDONED_CART_DISPLAY_CODE) {
        udc = await getAbandonedCartCodeForUser(user.id);
        if (!udc) {
          // منقضی/استفاده‌شده/هرگز ساخته‌نشده — پیام دقیق برای منقضی
          const anyRecord = await db.userDiscountCode.findFirst({
            where: {
              userId: user.id,
              reason: "abandoned_cart",
              code: { startsWith: "248945-" },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          return Response.json({
            valid: false,
            error: anyRecord
              ? "کد ۲۴۸۹۴۵ شما منقضی شده است."
              : "کد تخفیف نامعتبر است.",
          });
        }
      } else {
        udc = await db.userDiscountCode.findUnique({ where: { code: normalized } });
      }
      // v202 ممیزی (M4) — پیام «پیدا نشد» و «مالکِ شما نیست» یکسان شد تا وجودِ
      // کد اختصاصی دیگران قابل حدس نباشد؛ جزئیات فقط در لاگ سرور (console.warn).
      if (!udc) {
        console.warn("[discount] code not found:", { code: normalized.slice(0, 8), userId: user.id });
        return Response.json({ valid: false, error: "کد تخفیف معتبر نیست." });
      }
      if (udc.userId !== user.id) {
        console.warn("[discount] code not owned by user:", { code: normalized.slice(0, 8), userId: user.id, ownerId: udc.userId });
        return Response.json({ valid: false, error: "کد تخفیف معتبر نیست." });
      }
      if (udc.isUsed) {
        return Response.json({ valid: false, error: "این کد تخفیف قبلاً استفاده شده است." });
      }
      if (udc.validUntil && udc.validUntil < new Date()) {
        return Response.json({ valid: false, error: "کد تخفیف اختصاصی منقضی شده است." });
      }
      // v32/v47: کدهای «خرید اول» (وین‌بک آنبوردینگ 461291 + خوش‌آمدگویی 612964)
      // فقط برای اولین خرید فعال هستند — هر reason غیر از تمدید (renewal_loyalty)
      // v216 — استثنا: کد شخصی «personal_upsell» (دیرکتیو مالک — آپ‌سل ریتنشن)
      if (udc.reason !== "renewal_loyalty" && udc.reason !== "personal_upsell") {
        const subsCount = await db.subscription.count({ where: { userId: user.id } });
        if (subsCount > 0) {
          return Response.json({
            valid: false,
            error: "این کد تخفیف فقط برای اولین خرید قابل استفاده است.",
          });
        }
      }
      discountType = udc.type as "percent" | "fixed";
      discountValueRaw = udc.value;
      matchedCode = udc.code;
      recordValidUntil = udc.validUntil ?? null;
      // v47 — برچسب بر اساس نوع کد: تمدید (renewal) یا هدیهٔ خرید اول (welcome/winback)
      // v53 — کد ترک-درگاه: «تخفیف ویژه»
      const isRenewalCode = udc.reason === "renewal_loyalty";
      const kindLabel = isRenewalCode
        ? "تخفیف تمدید"
        : udc.reason === "abandoned_cart"
          ? "تخفیف ویژه"
          : "تخفیف اختصاصی";
      discountLabel =
        discountType === "percent"
          ? `${toPersianDigits(udc.value)}٪ ${kindLabel}`
          : `${toPersianDigits(udc.value.toLocaleString("en-US"))} تومان ${kindLabel}`;
    }

    const originalAmount = plan.price;
    let discountValue = 0;
    if (discountType === "percent") {
      discountValue = Math.round((originalAmount * discountValueRaw) / 100);
    } else {
      discountValue = Math.min(discountValueRaw, originalAmount);
    }
    const finalAmount = Math.max(0, originalAmount - discountValue);

    // v198 — رویداد قیف: کد تخفیف سمت سرور اعتبارسنجی و قبول شد
    await recordFunnelEvent({
      event: "discount_applied",
      userId: user.id,
      planId: plan.id,
      amount: finalAmount,
      meta: { code: matchedCode.slice(0, 24), serverValidated: true },
      userAgent: req.headers.get("user-agent"),
    });

    return Response.json({
      valid: true,
      code: matchedCode,
      type: discountType,
      value: discountValueRaw,
      discountValue,
      originalAmount,
      finalAmount,
      discountLabel,
      // v53 — انقضای کد (برای شمارش معکوس بنر تخفیف در صفحهٔ پلن‌ها)
      validUntil: recordValidUntil ? recordValidUntil.toISOString() : null,
      // برای کد اختصاصی — کلاینت با این فلگ کد را در checkout به‌عنوان
      // userDiscountCode (نه discountCode عمومی) می‌فرستد.
      isUserCode: !dc,
    });
  } catch (e) {
    return apiError(e);
  }
}
