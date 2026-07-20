import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { zarinpalReverse } from "@/lib/payment/providers/zarinpal";
import { zarinpalInquiry } from "@/lib/payment/providers/zarinpal";

/**
 * POST /api/payment/reverse
 * Body: { paymentId: string }
 *
 * استرداد تراکنش (Reverse) — طبق مستندات زرین‌پال
 *
 * تراکنش‌های موفقی که از پرداخت آنها نهایت ۳۰ دقیقه گذشته باشد را
 * بدون کارمزد به حساب خریدار سریعاً استرداد می‌زند.
 *
 * فقط ادمین می‌تواند این کار را انجام دهد.
 *
 * مراحل:
 * 1. بررسی اینکه تراکنش موفق است و کمتر از ۳۰ دقیقه از آن گذشته
 * 2. استعلام وضعیت تراکنش (inquiry) برای اطمینان
 * 3. فراخوانی reverse API زرین‌پال
 * 4. به‌روزرسانی وضعیت پرداخت به "refunded" در دیتابیس
 * 5. غیرفعال کردن اشتراک مرتبط (اگر وجود دارد)
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const { paymentId } = body as { paymentId: string };

    if (!paymentId) {
      return Response.json({ error: "paymentId الزامی است." }, { status: 400 });
    }

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: { user: { select: { mobile: true, name: true } } },
    });

    if (!payment) {
      return Response.json({ error: "پرداخت یافت نشد." }, { status: 404 });
    }

    if (payment.status !== "success") {
      return Response.json(
        { error: `فقط تراکنش‌های موفق قابل استرداد هستند. وضعیت فعلی: ${payment.status}` },
        { status: 400 }
      );
    }

    if (payment.paymentMethod !== "gateway") {
      return Response.json(
        { error: "استرداد فقط برای پرداخت‌های درگاهی امکان‌پذیر است." },
        { status: 400 }
      );
    }

    if (!payment.authority) {
      return Response.json(
        { error: "کد مرجع (authority) این تراکنش موجود نیست." },
        { status: 400 }
      );
    }

    // بررسی زمان: فقط تراکنش‌های کمتر از ۳۰ دقیقه قابل استرداد هستند
    if (payment.verifiedAt) {
      const minutesSinceVerify = (Date.now() - payment.verifiedAt.getTime()) / (1000 * 60);
      if (minutesSinceVerify > 30) {
        return Response.json(
          {
            error: `حداکثر زمان (۳۰ دقیقه) برای استرداد این تراکنش منقضی شده است. ${Math.floor(minutesSinceVerify)} دقیقه گذشته است.`,
            code: "TIME_EXPIRED",
          },
          { status: 400 }
        );
      }
    }

    // ۱. ابتدا استعلام وضعیت تراکنش
    const inquiryRes = await zarinpalInquiry({ authority: payment.authority });
    if (inquiryRes.ok && inquiryRes.status === "REVERSED") {
      // تراکنش قبلاً استرداد شده
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "refunded" },
      });
      return Response.json({
        success: true,
        message: "این تراکنش قبلاً استرداد شده بود.",
        status: "already_reversed",
      });
    }

    // ۲. فراخوانی reverse API
    const reverseRes = await zarinpalReverse({ authority: payment.authority });

    if (!reverseRes.ok) {
      return Response.json(
        {
          error: `استرداد ناموفق بود: ${reverseRes.error}`,
          code: reverseRes.code,
          details: reverseRes.error,
        },
        { status: 400 }
      );
    }

    // ۳. به‌روزرسانی وضعیت پرداخت به "refunded"
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "refunded" },
    });

    // ۴. غیرفعال کردن اشتراک مرتبط با این پرداخت (اگر وجود دارد)
    const sub = await db.subscription.findFirst({
      where: { userId: payment.userId, status: "active" },
      orderBy: { createdAt: "desc" },
    });
    if (sub && sub.pricePaid === payment.amount) {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "expired" },
      });

      // ریست فیلدهای پلن روی کاربر
      await db.user.update({
        where: { id: payment.userId },
        data: {
          planName: null,
          planExpiresAt: null,
          planStartedAt: null,
        },
      });
    }

    // ۵. ثبت تراکنش کیف پول (برای شفافیت)
    await db.walletTransaction.create({
      data: {
        userId: payment.userId,
        type: "refund",
        amount: payment.amount,
        balance: payment.user ? (await db.user.findUnique({ where: { id: payment.userId } }))?.walletBalance ?? 0 : 0,
        description: `استرداد پرداخت ${payment.description} (کد پیگیری: ${payment.refId})`,
        refId: payment.id,
      },
    });

    // ۶. نوتیفیکیشن به کاربر
    await db.notification.create({
      data: {
        userId: payment.userId,
        type: "subscription",
        title: "پرداخت شما استرداد شد ⚠️",
        body: `تراکنش شما به مبلغ ${payment.amount.toLocaleString("en-US")} تومان استرداد شد. مبلغ به حساب بانکی شما بازگردانده می‌شود. اشتراک شما غیرفعال شد.`,
        link: "?tab=plans",
        read: false,
      },
    });

    return Response.json({
      success: true,
      message: "تراکنش با موفقیت استرداد شد.",
      paymentId: payment.id,
      status: "refunded",
    });
  } catch (e) {
    return apiError(e);
  }
}
