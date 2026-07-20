import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { SUBSCRIPTION_PLANS, toPersianDigits, type Plan } from "@/lib/fitness/types";

// اعتبارسنجی کد تخفیف و محاسبه قیمت نهایی
export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const { code, planId } = (await req.json()) as { code: string; planId: Plan };
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      return Response.json({ error: "کد تخفیف را وارد کنید." }, { status: 400 });
    }

    const dc = await db.discountCode.findUnique({ where: { code: normalized } });
    if (!dc || !dc.active) {
      return Response.json({ valid: false, error: "کد تخفیف نامعتبر است." });
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

    const originalAmount = plan.price;
    let discountValue = 0;
    if (dc.type === "percent") {
      discountValue = Math.round((originalAmount * dc.value) / 100);
    } else {
      discountValue = Math.min(dc.value, originalAmount);
    }
    const finalAmount = Math.max(0, originalAmount - discountValue);

    return Response.json({
      valid: true,
      code: dc.code,
      type: dc.type,
      value: dc.value,
      discountValue,
      originalAmount,
      finalAmount,
      discountLabel:
        dc.type === "percent"
          ? `${toPersianDigits(dc.value)}٪ تخفیف`
          : `${toPersianDigits(dc.value.toLocaleString("en-US"))} تومان تخفیف`,
    });
  } catch (e) {
    return apiError(e);
  }
}
