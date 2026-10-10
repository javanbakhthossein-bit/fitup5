import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { zarinpalInquiry } from "@/lib/payment/providers/zarinpal";

/**
 * GET /api/payment/inquiry?paymentId=X
 *
 * استعلام وضعیت تراکنش از زرین‌پال (طبق مستندات)
 *
 * این متد فقط وضعیت تراکنش را اعلام می‌کند:
 *   VERIFIED : وریفای شده
 *   PAID : پرداخت شده (وریفای نشده)
 *   IN_BANK : درحال پرداخت
 *   FAILED : ناموفق (تکمیل نشده)
 *   REVERSED : تراکنش ریورس شده
 *
 * فقط ادمین می‌تواند این کار را انجام دهد.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const paymentId = req.nextUrl.searchParams.get("paymentId");
    if (!paymentId) {
      return Response.json({ error: "paymentId الزامی است." }, { status: 400 });
    }

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: { authority: true, paymentMethod: true, status: true, description: true, amount: true, source: true },
    });

    if (!payment) {
      return Response.json({ error: "پرداخت یافت نشد." }, { status: 404 });
    }

    // 🔒 v124 (گزارش مالک — «تراکنش علی علوی»): پرداخت‌های درون‌برنامه‌ای کافه‌بازار
    // قبلاً paymentMethod="gateway" می‌گرفتند و اینجا به زرین‌پال استعلام می‌رفتند →
    // «وضعیت در زرین‌پال: نامشخص» در حالی که خرید کاملاً واقعی و راستی‌آزمایی‌شده بود.
    // حالا: رکوردهای بازار (متد جدید + رکوردهای قدیمی با توضیح بازار) پاسخ شفاف می‌گیرند.
    const isBazaarPayment =
      payment.paymentMethod === "bazaar" ||
      (payment.description || "").includes("کافه‌بازار");

    if (isBazaarPayment) {
      return Response.json({
        ok: true,
        status: "BAZAAR",
        message:
          "این تراکنش از طریق پرداخت درون‌برنامه‌ای کافه‌بازار انجام شده است — پول از حساب کافه‌بازار کاربر کسر شده و با API بازار راستی‌آزمایی شده است. این تراکنش هیچ‌گاه در زرین‌پال ثبت نمی‌شود؛ «نامشخص» بودن زرین‌پال طبیعی است و نشانهٔ مشکل نیست.",
        dbStatus: payment.status,
      });
    }

    if (payment.paymentMethod !== "gateway") {
      return Response.json({
        ok: true,
        status: "N/A",
        message: "این متد فقط برای پرداخت‌های درگاهی کاربرد دارد.",
        dbStatus: payment.status,
      });
    }

    if (!payment.authority) {
      // v177 — تفکیک شفاف رکوردهای «نیت خرید» از رکوردهای واقعی درگاه
      // (گزارش مالک: استعلام «N/A / در انتظار» مبهم بود). رکورد gateway بدون
      // authority یا «نیت خرید» است (v171 — کاربر پنجرهٔ خرید را باز کرده اما
      // دکمهٔ پرداخت را نزده و هرگز به زرین‌پال نرسیده) یا فعال‌سازی رایگان
      // (مبلغ صفر). در هیچ‌کدام مشکل درگاه در کار نیست.
      if ((payment.amount ?? 0) > 0) {
        return Response.json({
          ok: true,
          status: "INTENT",
          message:
            "این رکورد «نیت خرید» است (قابلیت سبد رهاشدهٔ اینستاگرام): کاربر پنجرهٔ خرید را باز کرده اما دکمهٔ پرداخت را نزده و هرگز به درگاه زرین‌پال نرسیده است. بنابراین N/A طبیعی است و هیچ مشکل درگاهی در کار نیست. اگر کاربر دکمهٔ پرداخت را می‌زد، همان ردیف authority می‌گرفت.",
          dbStatus: payment.status,
        });
      }
      return Response.json({
        ok: true,
        status: "FREE",
        message:
          "این پرداخت مبلغ صفر دارد (فعال‌سازی رایگان — کد تخفیف ۱۰۰٪ یا اعتبار ارتقا) و هیچ‌گاه به درگاه زرین‌پال نمی‌رود؛ N/A طبیعی است.",
        dbStatus: payment.status,
      });
    }

    const result = await zarinpalInquiry({ authority: payment.authority });

    return Response.json({
      ok: result.ok,
      status: result.status ?? null,
      message: result.message ?? result.error,
      dbStatus: payment.status,
      code: result.code,
    });
  } catch (e) {
    return apiError(e);
  }
}
