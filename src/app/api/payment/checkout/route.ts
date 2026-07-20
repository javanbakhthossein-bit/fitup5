import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import {
  toPersianDigits,
  type Plan,
} from "@/lib/fitness/types";
import { getActivePlans, getActivePlan } from "@/lib/fitness/pricing";
import {
  zarinpalRequest,
  buildCallbackUrl,
  isZarinpalConfigured,
  isZarinpalSandbox,
} from "@/lib/fitness/zarinpal";

export async function GET() {
  // قیمت‌ها از DB خوانده می‌شوند (قابل ویرایش توسط ادمین)
  const plans = await getActivePlans();
  return Response.json({ plans });
}

interface CheckoutBody {
  planId: Plan;
  paymentMethod: "gateway" | "wallet";
  discountCode?: string;
  /** Per-user renewal discount code (validated against UserDiscountCode table) */
  userDiscountCode?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = (await req.json()) as CheckoutBody;
    const plan = await getActivePlan(body.planId);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    if (!["gateway", "wallet"].includes(body.paymentMethod)) {
      return Response.json({ error: "روش پرداخت نامعتبر است." }, { status: 400 });
    }

    let originalAmount = plan.price;
    let discountValue = 0;
    let discountCodeRecord: { id: string; code: string; type: string; value: number } | null = null;
    let userDiscountRecord: { id: string; code: string; type: string; value: number } | null = null;
    let appliedCode: string | null = null;

    // ─── منطق ارتقا (Upgrade): اگر کاربر پلن فعلی دارد و پلن جدید متفاوت است ───
    // فرمول: مبلغ باقی‌مانده از پلن فعلی = (pricePaid / durationDays) × daysLeft
    // مبلغ قابل پرداخت = قیمت پلن جدید - مبلغ باقی‌مانده (حداقل 0)
    let upgradeCredit = 0;
    let isUpgrade = false;
    const now = new Date();
    const activeSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "active", endDate: { gt: now } },
      orderBy: { endDate: "desc" },
    });
    if (activeSub && activeSub.plan !== plan.id) {
      const oldPlan = await getActivePlan(activeSub.plan as Plan);
      if (oldPlan) {
        const daysLeft = Math.ceil((activeSub.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) {
          // مبلغ باقی‌مانده از پلن فعلی (pro-rated)
          upgradeCredit = Math.round((activeSub.pricePaid / activeSub.durationDays) * daysLeft);
          isUpgrade = true;
        }
      }
    }

    // اعتبارسنجی و اعمال کد تخفیف عمومی
    if (body.discountCode) {
      const code = body.discountCode.trim().toUpperCase();
      const dc = await db.discountCode.findUnique({ where: { code } });
      if (!dc || !dc.active) {
        return Response.json({ error: "کد تخفیف نامعتبر است." }, { status: 400 });
      }
      if (dc.validUntil && dc.validUntil < new Date()) {
        return Response.json({ error: "کد تخفیف منقضی شده است." }, { status: 400 });
      }
      if (dc.maxUses !== -1 && dc.usedCount >= dc.maxUses) {
        return Response.json({ error: "سقف استفاده از این کد تخفیف تکمیل شده است." }, { status: 400 });
      }
      if (dc.applicablePlans !== "all") {
        const allowed = dc.applicablePlans.split(",");
        if (!allowed.includes(plan.id)) {
          return Response.json({ error: "این کد تخفیف برای پلن انتخاب‌شده قابل استفاده نیست." }, { status: 400 });
        }
      }
      discountCodeRecord = dc;
      appliedCode = dc.code;
      if (dc.type === "percent") {
        discountValue = Math.round((originalAmount * dc.value) / 100);
      } else {
        discountValue = Math.min(dc.value, originalAmount);
      }
    }

    // اعتبارسنجی و اعمال کد تخفیف اختصاصی کاربر (renewal loyalty)
    // اولویت: اگر هم کد عمومی هم کد اختصاصی داده شده، کد اختصاصی بر کد عمومی ارجحیت دارد.
    if (body.userDiscountCode) {
      const code = body.userDiscountCode.trim().toUpperCase();
      const udc = await db.userDiscountCode.findUnique({ where: { code } });
      if (!udc) {
        return Response.json({ error: "کد تخفیف اختصاصی یافت نشد." }, { status: 400 });
      }
      if (udc.userId !== user.id) {
        return Response.json({ error: "این کد تخفیف متعلق به حساب شما نیست." }, { status: 403 });
      }
      if (udc.isUsed) {
        return Response.json({ error: "این کد تخفیف قبلاً استفاده شده است." }, { status: 400 });
      }
      if (udc.validUntil && udc.validUntil < new Date()) {
        return Response.json({ error: "کد تخفیف اختصاصی منقضی شده است." }, { status: 400 });
      }
      // اگر کد عمومی هم داده شده، آن را نادیده می‌گیریم و کد اختصاصی را اعمال می‌کنیم
      if (discountCodeRecord) {
        discountValue = 0;
        discountCodeRecord = null;
      }
      userDiscountRecord = udc;
      appliedCode = udc.code;
      if (udc.type === "percent") {
        discountValue = Math.round((originalAmount * udc.value) / 100);
      } else {
        discountValue = Math.min(udc.value, originalAmount);
      }
    }

    // محاسبه مبلغ نهایی: قیمت پلن - تخفیف - اعتبار ارتقا (حداقل 0)
    const finalAmount = Math.max(0, originalAmount - discountValue - upgradeCredit);

    // اگر پرداخت از کیف پول، بررسی موجودی
    if (body.paymentMethod === "wallet") {
      const freshUser = await db.user.findUnique({ where: { id: user.id } });
      const balance = freshUser?.walletBalance ?? 0;
      if (balance < finalAmount) {
        return Response.json(
          {
            error: `موجودی کیف پول کافی نیست. موجودی: ${toPersianDigits(balance.toLocaleString("en-US"))} تومان، مبلغ لازم: ${toPersianDigits(finalAmount.toLocaleString("en-US"))} تومان.`,
            code: "INSUFFICIENT_WALLET",
            walletBalance: balance,
            required: finalAmount,
          },
          { status: 400 }
        );
      }
    }

    // مقداردهی اولیه authority — در صورت اتصال موفق به زرین‌پال، با authority واقعی جایگزین می‌شود
    let authority: string | null = null;
    let gatewayUrl: string | null = null;
    let simulated = false;

    if (body.paymentMethod === "gateway") {
      const origin = req.nextUrl.origin ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
      const callbackUrl = buildCallbackUrl(origin);

      // اگر کلید واقعی زرین‌پال پیکربندی شده باشد، به API واقعی زرین‌پال متصل می‌شویم
      if (isZarinpalConfigured()) {
        const zarinRes = await zarinpalRequest({
          amount: finalAmount, // Tomans
          description: `خرید پلن ${plan.label} فیتاپ — ${toPersianDigits(plan.durationDays)} روزه`,
          callbackUrl,
          mobile: user.mobile,
        });

        if (zarinRes.ok && zarinRes.authority && zarinRes.gatewayUrl) {
          authority = zarinRes.authority;
          gatewayUrl = zarinRes.gatewayUrl;
          simulated = isZarinpalSandbox();
        } else {
          // خطای واقعی زرین‌پال — نباید به شبیه‌سازی fallback کنیم
          return Response.json(
            {
              error: `اتصال به درگاه زرین‌پال ناموفق بود: ${zarinRes.error || "خطای ناشناخته"}`,
              code: "GATEWAY_ERROR",
              details: zarinRes.error,
            },
            { status: 502 }
          );
        }
      } else {
        // زرین‌پال پیکربندی نشده — خطا برگردان
        return Response.json(
          {
            error: "درگاه پرداخت پیکربندی نشده است. لطفاً با پشتیبانی تماس بگیرید.",
            code: "GATEWAY_NOT_CONFIGURED",
          },
          { status: 503 }
        );
      }
    }

    const payment = await db.payment.create({
      data: {
        userId: user.id,
        amount: finalAmount,
        originalAmount,
        plan: plan.id,
        paymentMethod: body.paymentMethod,
        authority,
        status: "pending",
        discountCode: appliedCode,
        description: `خرید پلن ${plan.label} فیتاپ — ${toPersianDigits(plan.durationDays)} روزه`,
      },
    });

    return Response.json({
      paymentId: payment.id,
      authority,
      originalAmount,
      discountValue,
      upgradeCredit,
      isUpgrade,
      finalAmount,
      plan,
      paymentMethod: body.paymentMethod,
      gatewayUrl,
      simulated,
      userDiscountCode: userDiscountRecord?.code ?? null,
      callbackUrl: body.paymentMethod === "gateway" ? buildCallbackUrl(req.nextUrl.origin ?? "") : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
