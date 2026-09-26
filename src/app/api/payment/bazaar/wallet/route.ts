/**
 * POST /api/payment/bazaar/wallet — شارژ کیف پول با پرداخت درون‌برنامه‌ای کافه‌بازار (پولکی)
 *
 * ⚖️ قانون بازار (علت ساخت این مسیر): در اپ منتشرشدهٔ بازار، هر پرداختِ کالای
 * دیجیتال — از جمله شارژ کیف پول — فقط باید از پرداخت درون‌برنامه‌ای بازار
 * انجام شود. قبلاً مودال شارژ کیف پول در اپ بازار هم به درگاه زرین‌پال می‌رفت
 * که نقض سیاست بازار است (ایراد بازرسی).
 *
 * فلوی کامل (هم‌الگوی /api/payment/bazaar/purchase برای پلن‌ها):
 *  ۱. اپ اندروید با پولکی (Poolakey) خرید SKU کیف پول را انجام می‌دهد → purchaseToken
 *  ۲. سایت داخل WebView نتیجه را به همین endpoint می‌فرستد
 *  ۳. سرور خرید را راستی‌آزمایی می‌کند — سه مسیر همیشه به‌ترتیب (v56):
 *     ① OAuth Developer API بازار  ② توکن API پیشخان  ③ امضای RSA خرید
 *     (کلید عمومی RSA = همان BAZAAR_RSA_PUBLIC_KEY اپ — پشتیبان داخلی سرور دارد)
 *  ۴. در صورت معتبر بودن: Payment (wallet_topup) ساخته و تحویل اتمیک انجام می‌شود
 *     (deliverWalletTopupPayment = افزایش موجودی + تراکنش کیف پول + نوتیف +
 *     پیامک شارژ با مبلغ واقعی — دقیقاً همان مسیر تأیید زرین‌پال؛ دیتابیس و
 *     روند کار هر دو اپ یکی است)
 *
 * 🏷️ SKUهای مجاز (باید در پیشخان بازار → «پرداخت درون‌برنامه‌ای» با همین شناسه
 * ساخته شوند — کالای مصرفی/consumable):
 *   fitup_wallet_100000   → شارژ ۱۰۰٬۰۰۰ تومان
 *   fitup_wallet_500000   → شارژ ۵۰۰٬۰۰۰ تومان
 *   fitup_wallet_1000000  → شارژ ۱٬۰۰۰٬۰۰۰ تومان
 * مبلغ فقط از همین جدول سرور خوانده می‌شود (ورودی کلاینت هرگز مبنا نیست).
 *
 * Consume: مثل پلن‌ها، بعد از فعال‌سازی موفق سایت `FitUpNative.consumePurchase`
 * را صدا می‌زند؛ اگر بین پرداخت و فعال‌سازی کرش شد، «بازیابی خریدها» در اجرای
 * بعدی اپ همان توکن را دوباره می‌فرستد (idempotent).
 */
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";
import { deliverWalletTopupPayment } from "@/lib/fitness/payment-delivery";
import { verifyBazaarPurchaseAny, verifyBazaarSignature } from "@/lib/fitness/bazaar-dev-api";

const BAZAAR_PACKAGE = process.env.BAZAAR_PACKAGE_NAME || "ir.fittup.app";

/** SKUهای مجاز شارژ کیف پول → مبلغ (تومان) — با بسته‌های پیشنهادی UI یکی است */
const WALLET_SKU_AMOUNTS: Record<string, number> = {
  fitup_wallet_100000: 100_000,
  fitup_wallet_500000: 500_000,
  fitup_wallet_1000000: 1_000_000,
};

/** خواندن توکن API بازار از SiteSetting یا env — همان منطق مسیر پلن */
async function getBazaarApiSecret(): Promise<string | null> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: "bazaar_api_secret" } });
    if (row?.value?.trim()) return row.value.trim();
  } catch {
    // DB error → env fallback
  }
  return process.env.BAZAAR_API_SECRET?.trim() || null;
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth();

    // T12: خرید فقط با آنبوردینگ تکمیل‌شده (هم‌تراز مسیر پلن/زرین‌پال)
    if (!user.onboardingDone) {
      return Response.json(
        { code: "ONBOARDING_REQUIRED", error: "برای شارژ کیف پول، ابتدا اطلاعات آنبوردینگ خود را تکمیل کنید." },
        { status: 403 }
      );
    }

    const rl = rateLimit(`bazaar-wallet:${user.id}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await req.json()) as {
      productId?: string;
      purchaseToken?: string;
      orderId?: string;
      /** امضای خرید از اپ (Poolakey originalJson + signature) — مسیر پشتیبان RSA */
      dataJson?: string;
      signature?: string;
    };
    const safeDataJson = String(body.dataJson || "").slice(0, 4096);
    const safeSignature = String(body.signature || "").slice(0, 2048);
    const productId = String(body.productId || "").trim();
    const purchaseToken = String(body.purchaseToken || "").trim();

    if (!productId || !purchaseToken) {
      return Response.json({ error: "productId و purchaseToken الزامی است." }, { status: 400 });
    }
    if (purchaseToken.length > 512 || productId.length > 128) {
      return Response.json({ error: "ورودی نامعتبر." }, { status: 400 });
    }

    // ─── مبلغ فقط از جدول مجاز سرور (SKU whitelist) ───
    const amount = WALLET_SKU_AMOUNTS[productId];
    if (!amount) {
      return Response.json(
        { error: "این محصول جزو بسته‌های شارژ کیف پول فیتاپ نیست." },
        { status: 400 }
      );
    }

    // ─── راستی‌آزمایی با بازار — ① OAuth ② پیشخان ③ امضای RSA (پشتیبان) ───
    const secret = await getBazaarApiSecret();
    if (secret) {
      const v = await verifyBazaarPurchaseAny(BAZAAR_PACKAGE, productId, purchaseToken, secret, {
        dataJson: safeDataJson,
        signature: safeSignature,
      });
      if (!v.ok) {
        console.error(
          `[bazaar/wallet] verify failed — user=${user.id} product=${productId} token=${purchaseToken.slice(0, 12)}…: ${v.error}`
        );
        try {
          const existingFailed = await db.payment.findFirst({
            where: { authority: purchaseToken, status: "failed" },
          });
          if (existingFailed) {
            await db.payment.update({
              where: { id: existingFailed.id },
              data: { description: `شارژ ردشده بازار — محصول ${productId} | ${v.error}` },
            });
          } else {
            await db.payment.create({
              data: {
                userId: user.id,
                amount,
                originalAmount: amount,
                plan: "wallet_topup",
                paymentMethod: "bazaar",
                authority: purchaseToken,
                refId: body.orderId || purchaseToken.slice(0, 40),
                status: "failed",
                description: `شارژ ردشده بازار — محصول ${productId} | ${v.error}`,
              },
            });
          }
        } catch (logErr) {
          console.error("[bazaar/wallet] failed-payment record error:", logErr);
        }
        return Response.json({ error: v.error || "راستی‌آزمایی خرید بازار ناموفق بود." }, { status: 400 });
      }
    } else {
      // بدون API بازار — امضای RSA خرید داور است (fail-closed در production)
      const sig = verifyBazaarSignature(safeDataJson, safeSignature);
      if (sig.ok && sig.data) {
        console.log("[bazaar/wallet] verify ok via local RSA signature (no API credentials)");
      } else if (process.env.NODE_ENV === "production") {
        // 🔒 ممیزی 1-c#18 — سوئیچ BAZAAR_SKIP_VERIFY حذف شد (fail-closed در production)
        console.error(
          `[bazaar/wallet] BAZAAR_API_SECRET تنظیم نیست و امضای خرید هم نامعتبر/غایب است — user=${user.id} product=${productId} رد شد (fail-closed)`
        );
        return Response.json(
          {
            error:
              "فعال‌سازی شارژ بازار فعلاً ممکن نیست — پیکربندی سرور ناقص است. لطفاً بعداً تلاش کنید یا با پشتیبانی در تماس باشید.",
          },
          { status: 500 }
        );
      } else {
        console.warn("[bazaar/wallet] ⚠️ BAZAAR_API_SECRET تنظیم نشده — راستی‌آزمایی skip شد (غیر-production).");
      }
    }

    // ─── Idempotency داخل تراکنش (هم‌الگوی مسیر پلن — SQLite سریالایز می‌کند):
    // دو فراخوانی همزمان با یک توکن نمی‌توانند هر دو Payment بسازند ───
    const payment = await db.$transaction(async (tx) => {
      const existing = await tx.payment.findFirst({
        where: { authority: purchaseToken, status: { in: ["pending", "verifying", "success"] } },
      });
      if (existing) return existing;
      return tx.payment.create({
        data: {
          userId: user.id,
          amount,
          originalAmount: amount,
          plan: "wallet_topup",
          // v124 — paymentMethod اختصاصی بازار (قبلاً «gateway» → استعلام زرین‌پال نامشخص)
          paymentMethod: "bazaar",
          authority: purchaseToken,
          refId: body.orderId || purchaseToken.slice(0, 40),
          status: "pending",
          description: `شارژ کیف پول — پرداخت درون‌برنامه‌ای کافه‌بازار (${productId})`,
        },
      });
    });

    // ─── مسیر تکراری: پاسخ idempotent ───
    if (payment.status === "success") {
      const u = await db.user.findUnique({ where: { id: user.id }, select: { walletBalance: true } });
      return Response.json({
        ok: true,
        alreadyProcessed: true,
        message: "این شارژ قبلاً فعال شده است.",
        amount,
        balance: u?.walletBalance ?? 0,
        paymentId: payment.id,
      });
    }

    // Claim اتمیک pending → verifying (الگوی F12 زرین‌پال — تحویل هم‌زمان دوباره ممکن نیست)
    const claimed = await db.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "verifying" },
    });
    if (claimed.count === 0 && payment.status !== "verifying") {
      // فراخوان هم‌زمان دیگری در حال تحویل است — پاسخ امن
      const u = await db.user.findUnique({ where: { id: user.id }, select: { walletBalance: true } });
      return Response.json({
        ok: true,
        alreadyProcessed: true,
        message: "این شارژ در حال پردازش است.",
        amount,
        balance: u?.walletBalance ?? 0,
        paymentId: payment.id,
      });
    }

    // ─── تحویل اتمیک: افزایش موجودی + تراکنش کیف پول + نوتیف + پیامک شارژ ───
    // (دقیقاً همان تابع مسیر تأیید زرین‌پال — accounting و پیامک یکی است)
    const { newBalance } = await deliverWalletTopupPayment({
      payment: payment,
      refId: body.orderId || purchaseToken.slice(0, 40),
    });

    return Response.json({
      ok: true,
      message: `کیف پول شما به مبلغ ${amount.toLocaleString("en-US")} تومان شارژ شد 🎉`,
      amount,
      balance: newBalance,
      paymentId: payment.id,
    });
  } catch (e) {
    return apiError(e);
  }
}
