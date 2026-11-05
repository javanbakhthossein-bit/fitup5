import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { zarinpalInquiry } from "@/lib/payment/providers/zarinpal";
// v252 — استعلام چنددرگاهی: از روی فیلد gateway رکورد (زرین‌پال/زیبال)
import { resolvePaymentGateway } from "@/lib/payment/gateway-dispatch";
import { ZibalProviderInstance } from "@/lib/payment/providers/zibal";

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
      select: { authority: true, paymentMethod: true, status: true, description: true, amount: true, source: true, gateway: true },
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

    // v252 — استعلام از درگاهِ خودِ رکورد (زرین‌پال پیش‌فرض برای ردیف‌های قدیمی)
    const isZibalPayment = resolvePaymentGateway(payment.gateway) === "zibal";

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
            "این رکورد «نیت خرید» است (قابلیت سبد رهاشدهٔ اینستاگرام): کاربر پنجرهٔ خرید را باز کرده اما دکمهٔ پرداخت را نزده و هرگز به درگاه پرداخت نرسیده است. بنابراین N/A طبیعی است و هیچ مشکل درگاهی در کار نیست. اگر کاربر دکمهٔ پرداخت را می‌زد، همان ردیف authority می‌گرفت.",
          dbStatus: payment.status,
        });
      }
      return Response.json({
        ok: true,
        status: "FREE",
        message:
          "این پرداخت مبلغ صفر دارد (فعال‌سازی رایگان — کد تخفیف ۱۰۰٪ یا اعتبار ارتقا) و هیچ‌گاه به درگاه پرداخت نمی‌رود؛ N/A طبیعی است.",
        dbStatus: payment.status,
      });
    }

    // v252 — دیسپچ: زیبال از gateway.zibal.ir، زرین‌پال از payment.zarinpal.com
    if (isZibalPayment) {
      const zibalRes = await ZibalProviderInstance.inquiry(payment.authority!);
      if (!zibalRes.ok) {
        return Response.json({
          ok: false,
          status: null,
          message: zibalRes.error ?? "استعلام زیبال ناموفق بود",
          dbStatus: payment.status,
          code: zibalRes.result,
        });
      }
      return Response.json({
        ok: true,
        // وضعیت‌های زیبال عددی‌اند — فرانت با statusMap آنها را فارسی می‌کند
        status: zibalRes.status ?? null,
        gateway: "zibal",
        message:
          zibalRes.status === 1
            ? "تراکنش پرداخت‌شده و تاییدشده است (زیبال)"
            : zibalRes.status === 2
              ? "تراکنش پرداخت‌شده ولی هنوز تایید (verify) نشده است (زیبال)"
              : undefined,
        dbStatus: payment.status,
        code: 100,
      });
    }

    const result = await zarinpalInquiry({ authority: payment.authority });

    return Response.json({
      ok: result.ok,
      status: result.status ?? null,
      gateway: "zarinpal",
      message: result.message ?? result.error,
      dbStatus: payment.status,
      code: result.code,
    });
  } catch (e) {
    return apiError(e);
  }
}
