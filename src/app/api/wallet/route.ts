import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { PLAN_LABELS, type Plan } from "@/lib/fitness/types";
import {
  zarinpalRequest,
  buildCallbackUrl,
  isZarinpalConfigured,
} from "@/lib/fitness/zarinpal";

/** شکل مشترک تراکنش برای کلاینت (Task 7-d — خریدهای درگاهی هم همین شکل را دارند) */
interface RecentTxnDto {
  id: string;
  type: string;
  amount: number;
  /** تراکنش‌های کیف پول موجودی پس از تراکنش را دارند؛ خریدهای درگاهی null برمی‌گردند */
  balance: number | null;
  description: string;
  createdAt: string;
}

// دریافت موجودی و تاریخچه کیف پول + خریدهای پلن (Task 7-d)
export async function GET() {
  try {
    const user = await requireAuth();
    // total: تعداد واقعی کل تراکنش‌ها (transactions فقط ۵۰ مورد آخر است)
    // — FIX: قبلاً UI تعداد fetched (حداکثر ۵۰) را به‌عنوان کل نمایش می‌داد.
    // Task 7-d — علاوه بر دفتر کیف پول، خریدهای موفق پلن (زرین‌پال/کافه‌بازار/
    // لینک تمدید) که ردیفی در کیف پول ندارند هم به «تراکنش‌های اخیر» می‌آیند.
    const [freshUser, transactions, total, planPayments, planPaymentsTotal] =
      await Promise.all([
        db.user.findUnique({ where: { id: user.id } }),
        db.walletTransaction.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        db.walletTransaction.count({ where: { userId: user.id } }),
        db.payment.findMany({
          where: {
            userId: user.id,
            status: "success",
            // شارژ کیف پول خودش تراکنش deposit دارد — اینجا فقط خرید پلن
            plan: { not: "wallet_topup" },
            // داپلیکیت‌زدایی: خریدِ پرداخت‌شده با «کیف پول» هم‌زمان یک ردیف
            // WalletTransaction type="purchase" (با refId=paymentId) هم می‌سازد؛
            // پس Paymentهای wallet را مستثنی می‌کنیم تا یک خرید دو بار نیاید.
            // درگاه زرین‌پال/تمدید پیامکی/کافه‌بازار همه paymentMethod="gateway"
            // دارند و هیچ ردیف کیف‌پولی نمی‌سازند — همین‌ها را می‌آوریم.
            paymentMethod: { not: "wallet" },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        db.payment.count({
          where: {
            userId: user.id,
            status: "success",
            plan: { not: "wallet_topup" },
            paymentMethod: { not: "wallet" },
          },
        }),
      ]);

    const walletTxns: RecentTxnDto[] = transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balance: t.balance,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    }));

    // خریدهای درگاهی → همان شکل تراکنش (مبلغ منفی = هزینه) — id با پیشوند pay_
    // تا با شناسه‌های WalletTransaction تداخل نکند.
    const purchaseTxns: RecentTxnDto[] = planPayments.map((p) => ({
      id: `pay_${p.id}`,
      type: "purchase",
      amount: -p.amount,
      balance: null,
      description:
        p.description || `خرید پلن ${PLAN_LABELS[p.plan as Plan] ?? p.plan}`,
      createdAt: p.createdAt.toISOString(),
    }));

    // ادغام نزولی بر اساس زمان — ۵۰ مورد آخر
    const merged = [...walletTxns, ...purchaseTxns]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 50);

    return Response.json({
      balance: freshUser?.walletBalance ?? 0,
      // کل واقعی = دفتر کیف پول + خریدهای درگاهی (بدون داپلیکیت)
      total: total + planPaymentsTotal,
      transactions: merged,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * شارژ کیف پول — از طریق درگاه واقعی زرین‌پال (F1).
 *
 * این endpoint دیگر موجودی را مستقیماً افزایش نمی‌دهد (باگ چاپ پول رایگان).
 * فقط یک Payment از نوع wallet_topup با status="pending" می‌سازد، درخواست
 * پرداخت واقعی به زرین‌پال می‌فرستد و gatewayUrl را برمی‌گرداند تا کاربر به
 * درگاه هدایت شود. تأیید و افزایش موجودی فقط در /api/payment/verify انجام
 * می‌شود (بعد از verify موفق زرین‌پال).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    // ─── ممیزی 1-c#2 — سقف نرخ شارژ کیف پول: هر فراخوانی یک Payment pending +
    // درخواست واقعی به زرین‌پال می‌سازد (برخلاف checkout سقفی نداشت — ریسک فلگ
    // شدن merchant و انباشت ردیف‌های pending/failed) ───
    const rl = rateLimit(`wallet-topup:${user.id}`, 5, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const { amount } = (await req.json()) as { amount: number };
    // ممیزی 1-c#17 — مبلغ باید عدد صحیح تومانی باشد (اعشار به درگاه نمی‌رود —
    // هم‌الگوی admin/wallet-charge)
    if (!amount || !Number.isInteger(amount) || amount < 10000 || amount > 10000000) {
      return Response.json(
        { error: "مبلغ شارژ باید بین ۱۰,۰۰۰ و ۱۰,۰۰۰,۰۰۰ تومان باشد." },
        { status: 400 }
      );
    }

    // بدون درگاه واقعی، شارژ کیف پول ممکن نیست — نه شبیه‌سازی، نه اعتبار رایگان
    if (!isZarinpalConfigured()) {
      return Response.json(
        {
          error:
            "درگاه پرداخت پیکربندی نشده است. لطفاً با پشتیبانی تماس بگیرید.",
          code: "GATEWAY_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    // رکورد پرداخت pending — نوع wallet_topup
    const payment = await db.payment.create({
      data: {
        userId: user.id,
        amount,
        originalAmount: amount,
        plan: "wallet_topup",
        paymentMethod: "gateway",
        status: "pending",
        description: "شارژ کیف پول",
      },
    });

    // v65 — origin فقط فال‌بک است؛ buildCallbackUrl خودش NEXT_PUBLIC_SITE_URL را ترجیح می‌دهد
    // (پشت پراکسی origin می‌تواند 0.0.0.0:3000 شود — هرگز نباید به زرین‌پال برسد)
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      req.nextUrl.origin ||
      `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const zarinRes = await zarinpalRequest({
      amount, // Tomans
      description: "شارژ کیف پول فیتاپ",
      callbackUrl: buildCallbackUrl(origin),
      mobile: user.mobile,
    });

    if (!(zarinRes.ok && zarinRes.authority && zarinRes.gatewayUrl)) {
      // اتصال به درگاه ناموفق — پرداخت failed می‌شود و هیچ موجودی‌ای تغییر نمی‌کند
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", verifiedAt: new Date() },
      });
      return Response.json(
        {
          error: `اتصال به درگاه زرین‌پال ناموفق بود: ${zarinRes.error || "خطای ناشناخته"}`,
          code: "GATEWAY_ERROR",
          details: zarinRes.error,
        },
        { status: 502 }
      );
    }

    // ذخیره authority — مرجع واقعی این پرداخت در درگاه
    await db.payment.update({
      where: { id: payment.id },
      data: { authority: zarinRes.authority },
    });

    return Response.json({
      ok: true,
      paymentId: payment.id,
      authority: zarinRes.authority,
      gatewayUrl: zarinRes.gatewayUrl,
      amount,
      message: "برای تکمیل شارژ، به درگاه پرداخت منتقل می‌شوید.",
    });
  } catch (e) {
    return apiError(e);
  }
}
