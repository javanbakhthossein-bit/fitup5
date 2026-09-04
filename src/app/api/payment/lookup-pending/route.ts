import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";

/**
 * یافتن پرداخت مربوط به callback زرین‌پال (برای صفحهٔ رسید).
 *
 * ─── FIX (باگ «پرداخت معلق یافت نشد») ───
 * قبلاً فقط status:"pending" جستجو می‌شد. اما وقتی فراخوان دیگری
 * (recover پس‌زمینه / کرون) همان لحظه پرداخت را claim کرده باشد، وضعیت
 * «verifying» است و این جستجو ۴۰۴ می‌داد — صفحه رسید به کاربری که
 * پولش کسر شده بود «پرداخت ناموفق» نشان می‌داد!
 *
 * سیاست جدید:
 *  ۱) جستجوی اصلی روی status IN (pending, verifying) — با authority اگر آمده
 *  ۲) اگر پیدا نشد: جستجوی authority «بدون قید وضعیت» — تا پرداختِ قبلاً
 *     موفق (رفرش صفحه رسید) دوباره receipt موفق بدهد (idempotent) و
 *     پرداخت تعیین‌تکلیف‌شده پیام درست بگیرد نه ۴۰۴.
 *  ۳) اگر باز هم نبود: paymentId:null — فرانت دیگر «ناموفق» نشان نمی‌دهد؛
 *     حالت «در حال استعلام» دارد.
 *
 * autoVerify: آیا فرانت می‌تواند بی‌درنگ verify با status=OK صدا بزند؟
 *  • true  → پرداخت کیف‌پولی است یا authority ارسالی با پرداخت match شده
 *  • false → پرداخت درگاهی بدون authority است (F15)
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { authority?: string };

    const rawAuthority = typeof body.authority === "string" ? body.authority.trim() : "";
    const hasAuthorityParam = !!rawAuthority;

    // ─── ۱) جستجوی اصلی: pending یا verifying (claim تازه توسط دیگری) ───
    const where: { userId: string; status: { in: string[] }; authority?: string } = {
      userId: user.id,
      status: { in: ["pending", "verifying"] },
    };
    if (hasAuthorityParam) {
      where.authority = rawAuthority;
    }

    const payment = await db.payment.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        authority: true,
        amount: true,
        plan: true,
        paymentMethod: true,
        createdAt: true,
        refId: true,
      },
    });

    if (payment) {
      const autoVerify =
        payment.paymentMethod === "wallet" ||
        (hasAuthorityParam && !!payment.authority && payment.authority === rawAuthority);
      return Response.json({
        paymentId: payment.id,
        paymentStatus: payment.status,
        authority: payment.authority,
        amount: payment.amount,
        plan: payment.plan,
        type: payment.plan,
        paymentMethod: payment.paymentMethod,
        createdAt: payment.createdAt,
        autoVerify,
      });
    }

    // ─── ۲) fallback: این authority برای همین کاربر تعیین‌تکلیف شده ───
    // (مثلاً verify قبلاً موفق بوده و کاربر رفرش/برگشت دوباره زده)
    if (hasAuthorityParam) {
      const resolved = await db.payment.findFirst({
        where: { userId: user.id, authority: rawAuthority },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          refId: true,
          amount: true,
          plan: true,
          paymentMethod: true,
          createdAt: true,
          authority: true,
        },
      });
      if (resolved) {
        // verify خودش idempotent است: پرداخت موفق → پاسخ موفق با receipt
        return Response.json({
          paymentId: resolved.id,
          paymentStatus: resolved.status,
          resolved: true,
          authority: resolved.authority,
          refId: resolved.refId,
          amount: resolved.amount,
          plan: resolved.plan,
          type: resolved.plan,
          paymentMethod: resolved.paymentMethod,
          createdAt: resolved.createdAt,
          autoVerify: resolved.status === "success",
        });
      }
    }

    // ─── ۳) هیچ پرداختی برای این کاربر/authority نبود ───
    // status 200 (نه 404) — فرانت آن را «در حال استعلام» نشان می‌دهد نه ناموفق
    return Response.json({
      paymentId: null,
      paymentStatus: null,
      message: "هنوز تراکنشی برای این کد پیگیری در حساب شما ثبت نشده است.",
    });
  } catch (e) {
    return apiError(e);
  }
}
