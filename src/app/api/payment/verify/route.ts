import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  apiError,
  getCurrentUser,
  setSession,
} from "@/lib/fitness/auth";
import { toPersianDigits } from "@/lib/fitness/types";
import { zarinpalVerify, isZarinpalConfigured } from "@/lib/fitness/zarinpal";
import { createNotification } from "@/lib/fitness/notifications";
import { buildUserDto } from "@/lib/fitness/auth";
import {
  WalletInsufficientError,
  claimPayment,
  releaseClaim,
  markPaymentFailed,
  isAuthorityUsedElsewhere,
  deliverPlanPayment,
} from "@/lib/fitness/payment-delivery";

interface VerifyBody {
  /** v56: با احراز مبتنی بر authority اختیاری شد — برای کاربر بدون سشن */
  paymentId?: string;
  status: "OK" | "NOK" | "CANCELLED";
  /** برای callback زرین‌پال: authority واقعی که از URL برمی‌گردد.
   *  این مقدار هرگز مبنای verify نیست — همیشه payment.authority از DB
   *  استفاده می‌شود و این فقط به‌صورت defensive تطبیق داده می‌شود (F2).
   *  v56: استثنا — کاربر بدون سشن می‌تواند فقط با authority verify کند
   *  (authority فقط به مرورگر پرداخت‌کننده redirect می‌شود). */
  authority?: string;
}

/**
 * POST /api/payment/verify — تایید و تحویل پرداخت.
 *
 * ─── سیاست کد ۱۰۱ (alreadyVerified) — اصلاح باگ «در انتظار» ───
 * قبلاً هر پاسخ ۱۰۱ از زرین‌پال «replay» فرض و پرداخت failed می‌شد. اما ۱۰۱
 * فقط یعنی «این authority قبلاً verify شده» — دو حالدارد:
 *  ۱. Payment موفق دیگری با همین authority موجود است → replay واقعی → رد
 *  ۲. چنین چیزی نیست → تلاش قبلی ما پیش از commit DB مرده (کرش/timeout) →
 *     پول گرفته شده → همینجا deliver می‌کنیم (سناریوی کاربرانِ گیرکرده!)
 *
 * ─── سیاست خطای شبکه ───
 * خطای transport به زرین‌پال ≠ پرداخت ناموفق → claim آزاد، status:"pending"
 * (کالر/کرون بعداً دوباره) — نه failed.
 */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VerifyBody;

    // ═══ v56: احراز انعطاف‌پذیر — سشن یا authority (درخواست مالک) ═══
    // مشکل: کاربر بعد از درگاه بدون کوکی برمی‌گشت (WebView اپ ↔ مرورگر سیستم،
    // یا اختلاف دامنه) → قبلاً به دیوار «برای تأیید وارد شوید» می‌خورد و
    // پیامک تأیید خرید هم تا بعد از لاگین مجدد می‌رفت.
    // راه‌حل: اگر سشن نیست ولی authority به یک پرداخت گیت‌وی تعلق دارد،
    // همان کاربرِ پرداخت فرض می‌شود (authority فقط به مرورگر پرداخت‌کننده
    // redirect می‌شود = اثبات مالکیت) و بعد از verify موفق، سشن هم صادر
    // می‌شود تا بدون لاگین مجدد وارد پنل شود.
    let user = await getCurrentUser();
    let authorityAuth = false;
    if (!user) {
      const a = (body.authority ?? "").trim();
      if (a) {
        const candidate = await db.payment.findFirst({
          where: { authority: a, paymentMethod: "gateway" },
          orderBy: { createdAt: "desc" },
        });
        if (candidate) {
          const owner = await db.user.findUnique({
            where: { id: candidate.userId },
          });
          if (owner && !owner.isBlocked) {
            user = owner;
            authorityAuth = true;
          }
        }
      }
    }
    if (!user) {
      return Response.json(
        { error: "ابتدا وارد حساب کاربری خود شوید." },
        { status: 401 }
      );
    }

    const payment =
      authorityAuth && (body.authority ?? "").trim()
        ? await db.payment.findFirst({
            where: {
              authority: (body.authority ?? "").trim(),
              userId: user.id,
            },
            orderBy: { createdAt: "desc" },
          })
        : await db.payment.findFirst({
            where: { id: body.paymentId, userId: user.id },
          });
    if (!payment) {
      return Response.json({ error: "پرداخت یافت نشد." }, { status: 404 });
    }

    /** v56: صادرکردن سشن در نقاط موفق — فقط وقتی verify موفق برای پرداختِ
     *  متعلق به authority انجام شد (بدون سشن) تا کاربر مستقیم به پنل برود */
    const issueSessionIfAuthorityAuth = async () => {
      if (authorityAuth) {
        try {
          await setSession(user!.id);
        } catch (e) {
          console.warn("[payment/verify] authority-auth session issue failed:", e);
        }
      }
    };

    // ─── claim اتمیک (F12) + تشخیص گیرکردن ───
    const claim = await claimPayment(payment);
    if (claim === "busy") {
      return Response.json(
        {
          success: false,
          status: "verifying",
          message: "این پرداخت در حال پردازش است. لطفاً چند لحظه دیگر دوباره تلاش کنید.",
        },
        { status: 400 }
      );
    }
    if (claim === "stuck") {
      return Response.json(
        {
          success: false,
          status: "failed",
          message:
            "پردازش این پرداخت قبلاً با خطا متوقف شده است. در صورت کسر مبلغ، با پشتیبانی تماس بگیرید.",
        },
        { status: 400 }
      );
    }
    if (claim === "processed") {
      // وضعیت نهایی — اگر موفق بوده، پاسخ موفق idempotent بده (نه خطا!)
      if (payment.status === "success") {
        const sub = await db.subscription.findFirst({
          where: { paymentId: payment.id },
          orderBy: { createdAt: "desc" },
          select: { status: true, plan: true, endDate: true },
        });
        // FIX: برای wallet_topup، type و walletBalance هم برگردانده شود تا
        // رسید idempotent (بازگشت/رفرش دوباره) receipt صحیح کیف پول نشان دهد
        const userDto = await buildUserDto(user.id);
        const isTopup = payment.plan === "wallet_topup";
        // v56: حتی در مسیر idempotent سشن صادر کن (کاربر بدون سشن برگشته باشد)
        await issueSessionIfAuthorityAuth();
        return Response.json({
          success: true,
          status: "success",
          message: "این پرداخت قبلاً با موفقیت ثبت شده است.",
          type: isTopup ? "wallet_topup" : undefined,
          walletBalance: isTopup ? userDto?.walletBalance : undefined,
          refId: payment.refId,
          amount: payment.amount,
          originalAmount: payment.originalAmount,
          plan: sub?.plan ?? payment.plan,
          subscriptionStatus: sub?.status ?? null,
          subscriptionEnd: sub?.endDate?.toISOString() ?? null,
          user: userDto,
        });
      }
      return Response.json(
        { error: "این پرداخت قبلاً پردازش شده است." },
        { status: 400 }
      );
    }

    // (claim === "claimed") — از اینجا فقط مسیرهای قطعی payment را failed می‌کنند

    // --- انصراف کاربر ---
    if (body.status === "CANCELLED") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "cancelled", verifiedAt: new Date() },
      });
      return Response.json({
        success: false,
        status: "cancelled",
        message: "پرداخت لغو شد.",
      });
    }

    // --- پرداخت ناموفق (NOK از درگاه) ---
    if (body.status === "NOK") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", verifiedAt: new Date() },
      });
      return Response.json({
        success: false,
        status: "failed",
        message: "پرداخت ناموفق بود.",
      });
    }

    // ─── شارژ کیف پول (wallet_topup) ───
    if (payment.plan === "wallet_topup") {
      if (payment.paymentMethod !== "gateway") {
        await markPaymentFailed(payment.id);
        return Response.json(
          { success: false, status: "failed", message: "تراکنش شارژ کیف پول نامعتبر است." },
          { status: 400 }
        );
      }
      if (!isZarinpalConfigured()) {
        await markPaymentFailed(payment.id);
        return Response.json({
          success: false,
          status: "failed",
          message: "درگاه پرداخت پیکربندی نشده است.",
        });
      }
      // defensive (F2): authority کلاینت اگر آمده باشد باید با DB مطابقت داشته باشد
      if (
        body.authority &&
        typeof body.authority === "string" &&
        body.authority.trim() &&
        payment.authority &&
        body.authority.trim() !== payment.authority
      ) {
        await markPaymentFailed(payment.id);
        return Response.json(
          { success: false, status: "failed", message: "کد مرجع پرداخت با تراکنش مطابقت ندارد." },
          { status: 400 }
        );
      }
      if (!payment.authority) {
        await markPaymentFailed(payment.id);
        return Response.json({
          success: false,
          status: "failed",
          message: "کد مرجع پرداخت (authority) یافت نشد.",
        });
      }

      const zRes = await zarinpalVerify({
        authority: payment.authority, // همیشه از DB (F2)
        amount: payment.amount, // Tomans
      });

      if (!zRes.ok) {
        if (zRes.transportError) {
          // خطای شبکه — غیرقطعی: claim آزاد و pending بمان (recover/cron دوباره)
          await releaseClaim(payment.id);
          return Response.json(
            {
              success: false,
              status: "pending",
              message: "خطای موقت در ارتباط با زرین‌پال. سیستم به‌زودی دوباره تلاش می‌کند.",
            },
            { status: 200 }
          );
        }
        // FIX: خطای غیر-شبکه‌ای درگاه ≠ «پرداخت ناموفق» قطعی. کاربر از درگاه با
        // Status=OK برگشته یعنی بانک پول را گرفته؛ zarinpalVerify ممکن است برای
        // تراکنشِ تازهٔ settled موقتاً خطا بدهد. سیاست recover/کرون: pending بمان
        // (جاروی بعدی استعلام می‌کند)؛ failed فقط از NOK واقعی می‌آید.
        await releaseClaim(payment.id);
        return Response.json(
          {
            success: false,
            status: "pending",
            message:
              "زرین‌پال هنوز این تراکنش را تأیید نکرده است. اگر مبلغ کسر شده، نگران نباشید — سیستم به‌زودی دوباره بررسی می‌کند و کیف پول شما به‌روز می‌شود.",
            refId: zRes.refId,
          },
          { status: 200 }
        );
      }

      // کد ۱۰۱ → چک replay: اگر Payment موفق دیگری با همین authority هست → رد؛
      // وگرنه پرداخت شده → شارژ را (idempotent داخل tx) انجام بده.
      if (zRes.code === 101 || zRes.alreadyVerified) {
        if (payment.authority && (await isAuthorityUsedElsewhere(payment.authority, payment.id))) {
          await markPaymentFailed(payment.id);
          return Response.json(
            { success: false, status: "failed", error: "این تراکنش قبلاً استفاده شده است." },
            { status: 400 }
          );
        }
        // ۱۰۱ بدون پرداخت موفق دیگر → تلاش قبلی ما پیش از commit مرده → ادامه
      }

      const refId = zRes.refId ?? `${Date.now()}${Math.floor(Math.random() * 10000)}`;

      // افزایش اتمیک موجودی + ثبت تراکنش + success در یک tx (idempotent با شروط status)
      const walletTx = await db.$transaction(async (tx) => {
        // اگر همین پرداخت در همین لحظه توسط فراخوان دیگری success شد → skip
        const fresh = await tx.payment.findUnique({
          where: { id: payment.id },
          select: { status: true },
        });
        if (fresh?.status === "success") {
          const u = await tx.user.findUnique({ where: { id: user.id }, select: { walletBalance: true } });
          return { balance: u?.walletBalance ?? 0, delivered: false as const };
        }
        await tx.user.update({
          where: { id: user.id },
          data: { walletBalance: { increment: payment.amount } },
        });
        const u2 = await tx.user.findUnique({
          where: { id: user.id },
          select: { walletBalance: true },
        });
        const balance = u2?.walletBalance ?? 0;
        await tx.walletTransaction.create({
          data: {
            userId: user.id,
            type: "deposit",
            amount: payment.amount,
            balance,
            description: `شارژ کیف پول — ${toPersianDigits(payment.amount.toLocaleString("en-US"))} تومان`,
            refId: payment.id,
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "success",
            refId,
            verifiedAt: new Date(),
            cardPan: zRes.cardPan ?? null,
            cardHash: zRes.cardHash ?? null,
            fee: zRes.fee ?? null,
          },
        });
        return { balance, delivered: true as const };
      });
      const newBalance = walletTx.balance;

      if (walletTx.delivered) {
        await createNotification(
          user.id,
          "system",
          "کیف پول شما شارژ شد ✅",
          `مبلغ ${toPersianDigits(payment.amount.toLocaleString("en-US"))} تومان با موفقیت به کیف پول شما اضافه شد. موجودی فعلی: ${toPersianDigits(newBalance.toLocaleString("en-US"))} تومان.`,
          "?tab=dashboard"
        );

        // ═══ پیامک شارژ کیف پول (v36 — قالب 556023) ═══
        // درخواست مالک: «برای شارژ کیف پول وقتی که سایت ما تایید پرداخت کرد»
        // دداپ با کلید wallet_topup_{paymentId} — verify تکراری هرگز دوباره نمی‌فرستد.
        try {
          const { notifyWalletTopupSms } = await import("@/lib/fitness/sms-flows");
          await notifyWalletTopupSms(user.id, payment.amount, payment.id);
        } catch (smsErr) {
          console.warn("[payment/verify] wallet topup sms failed (non-blocking):", smsErr);
        }
      }

      const topupDto = await buildUserDto(user.id);
      // v56: سشن بعد از شارژ موفق (کاربر بدون سشن از درگاه برگشته باشد)
      await issueSessionIfAuthorityAuth();
      return Response.json({
        success: true,
        status: "success",
        type: "wallet_topup",
        message: "کیف پول شما با موفقیت شارژ شد.",
        refId,
        amount: payment.amount,
        originalAmount: payment.originalAmount,
        walletBalance: newBalance,
        user: topupDto,
      });
    }

    // ─── خرید پلن ───
    if (payment.paymentMethod === "gateway") {
      if (!isZarinpalConfigured()) {
        await markPaymentFailed(payment.id);
        return Response.json({
          success: false,
          status: "failed",
          message: "درگاه پرداخت پیکربندی نشده است.",
        });
      }

      // F2: هرگز به body.authority اعتماد نمی‌شود — فقط تطابق defensive
      if (
        body.authority &&
        typeof body.authority === "string" &&
        body.authority.trim() &&
        payment.authority &&
        body.authority.trim() !== payment.authority
      ) {
        await markPaymentFailed(payment.id);
        return Response.json(
          { success: false, status: "failed", message: "کد مرجع پرداخت با تراکنش مطابقت ندارد." },
          { status: 400 }
        );
      }

      if (!payment.authority) {
        await markPaymentFailed(payment.id);
        return Response.json({
          success: false,
          status: "failed",
          message: "کد مرجع پرداخت (authority) یافت نشد.",
        });
      }

      const zRes = await zarinpalVerify({
        authority: payment.authority, // F2: همیشه از DB
        amount: payment.amount, // Tomans
      });

      if (!zRes.ok) {
        if (zRes.transportError) {
          // خطای شبکه — غیرقطعی: آزادسازی claim؛ recover/کرون/تلاش مجدد کاربر
          await releaseClaim(payment.id);
          return Response.json(
            {
              success: false,
              status: "pending",
              message:
                "خطای موقت در ارتباط با زرین‌پال. مبلغ در صورت پرداخت حفظ می‌شود و سیستم دوباره بررسی می‌کند.",
            },
            { status: 200 }
          );
        }
        // FIX (هم‌سیاست با wallet_topup بالا + recover/کرون): خطای غیر-شبکه‌ای
        // درگاه ≠ «پرداخت ناموفق» قطعی. کاربر با Status=OK برگشته — پول ممکن
        // است گرفته شده باشد. pending می‌ماند؛ کرون/تلاش مجدد تعیین‌تکلیف می‌کند.
        await releaseClaim(payment.id);
        return Response.json(
          {
            success: false,
            status: "pending",
            message:
              "زرین‌پال هنوز این تراکنش را تأیید نکرده است. اگر مبلغ کسر شده، نگران نباشید — سیستم به‌زودی دوباره بررسی می‌کند و پلن شما فعال می‌شود.",
            refId: zRes.refId,
          },
          { status: 200 }
        );
      }

      // موفق (100 یا 101)
      if (zRes.code === 101 || zRes.alreadyVerified) {
        // ─── سیاست ۱۰۱: فقط با وجود Payment موفق «دیگر» روی همان authority رد ───
        if (await isAuthorityUsedElsewhere(payment.authority, payment.id)) {
          await markPaymentFailed(payment.id);
          return Response.json(
            { success: false, status: "failed", error: "این تراکنش قبلاً استفاده شده است." },
            { status: 400 }
          );
        }
        // ۱۰۱ بدون رکورد موفق دیگر → تلاش قبلی ما نیمه‌کاره مرده → تحویل
        console.info(
          "[payment/verify] code 101 بدون replay — تحویل پرداخت از قبل-verify شده:",
          payment.id
        );
      }

      const refId = zRes.refId ?? `${Date.now()}${Math.floor(Math.random() * 10000)}`;

      try {
        const result = await deliverPlanPayment({
          userId: user.id,
          payment,
          refId,
          cardPan: zRes.cardPan ?? null,
          cardHash: zRes.cardHash ?? null,
          fee: zRes.fee ?? null,
        });
        // v56: سشن بعد از خرید موفق — کاربر بدون لاگین مجدد وارد پنل می‌شود؛
        // پیامک‌های تأیید خرید هم (داخل deliverPlanPayment) همین الان رفته‌اند
        await issueSessionIfAuthorityAuth();
        return Response.json(result);
      } catch (txErr) {
        if (txErr instanceof WalletInsufficientError) {
          await markPaymentFailed(payment.id);
          return Response.json({
            success: false,
            status: "failed",
            message: "موجودی کیف پول در زمان تایید کافی نبود.",
          });
        }
        // خطای DB غیرمنتظره — claim را آزاد نکن (verify یکتا نیست؛ recover دوباره
        // از ۱۰۱ همین مسیر را تحویل می‌دهد). failed نمی‌کنیم؛ pending می‌ماند.
        console.error("[payment/verify] delivery error:", txErr);
        await releaseClaim(payment.id);
        return Response.json(
          {
            success: false,
            status: "pending",
            message: "خطای موقت در ثبت نهایی خرید. به‌زودی دوباره تلاش می‌شود — پول شما حفظ شده است.",
          },
          { status: 200 }
        );
      }
    }

    // ─── پرداخت از کیف پول (بدون درگاه) — تحویل آنی ───
    {
      const refId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      try {
        const result = await deliverPlanPayment({
          userId: user.id,
          payment,
          refId,
        });
        return Response.json(result);
      } catch (txErr) {
        if (txErr instanceof WalletInsufficientError) {
          await markPaymentFailed(payment.id);
          return Response.json({
            success: false,
            status: "failed",
            message: "موجودی کیف پول در زمان تایید کافی نبود.",
          });
        }
        console.error("[payment/verify] wallet delivery error:", txErr);
        await releaseClaim(payment.id);
        return Response.json(
          {
            success: false,
            status: "pending",
            message: "خطای موقت در ثبت نهایی خرید. دوباره تلاش کنید.",
          },
          { status: 200 }
        );
      }
    }
  } catch (e) {
    return apiError(e);
  }
}
