import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import {
  toPersianDigits,
  type Plan,
} from "@/lib/fitness/types";
import { getActivePlans, getActivePlan } from "@/lib/fitness/pricing";
import {
  ABANDONED_CART_DISPLAY_CODE,
  getAbandonedCartCodeForUser,
} from "@/lib/fitness/notifications";
import {
  zarinpalRequest,
  buildCallbackUrl,
  isZarinpalConfigured,
  isZarinpalSandbox,
  zarinpalStartPayUrl,
  zarinpalInquiry,
} from "@/lib/fitness/zarinpal";
import { rateLimit, rateLimitResponse } from "@/lib/fitness/rate-limit";

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

    // ─── T12: گارد آنبوردینگ — مسدودسازی خرید بدون آنبوردینگ تکمیل‌شده ───
    // گارد فرانت‌اند به‌تنهایی کافی نیست (مسیر مستقیم API قابل فراخوانی است)؛
    // سرور هم قطعی مسدود می‌کند. پاسخ با code مشخص تا فرانت به آنبوردینگ هدایت کند.
    if (!user.onboardingDone) {
      return Response.json(
        {
          code: "ONBOARDING_REQUIRED",
          error: "برای خرید پلن، ابتدا اطلاعات آنبوردینگ خود را تکمیل کنید.",
        },
        { status: 403 }
      );
    }

    // محدودیت نرخ: حداکثر ۱۰ checkout در دقیقه به ازای هر کاربر
    const rl = rateLimit(`checkout:${user.id}`, 10, 60_000);
    if (!rl.ok) {
      return rateLimitResponse(rl.retryAfterSec);
    }

    const body = (await req.json()) as CheckoutBody;
    const plan = await getActivePlan(body.planId);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    if (!["gateway", "wallet"].includes(body.paymentMethod)) {
      return Response.json({ error: "روش پرداخت نامعتبر است." }, { status: 400 });
    }

    // ─── v53 — کد نمایشی «248945» (ترک درگاه پرداخت) → resolve به کد داخلی کاربر ───
    // نمایش به کاربر همیشه «248945» است ولی کد داخلی یکتای 248945-XXXXX در
    // UserDiscountCode است. resolve «قبل از» دیداپ انجام می‌شود تا دیداپ
    // هم با کد داخلی درست کار کند و کد درست روی Payment بنشیند (سوختن در verify).
    // اگر کد معتبر نبود، دست نمی‌زنیم — اعتبارسنجی پایین‌تر خطای استاندارد می‌دهد.
    if (
      typeof body.userDiscountCode === "string" &&
      body.userDiscountCode.trim().toUpperCase() === ABANDONED_CART_DISPLAY_CODE
    ) {
      const abandonedCode = await getAbandonedCartCodeForUser(user.id);
      if (abandonedCode) {
        body.userDiscountCode = abandonedCode.code;
      }
    }

    // ─── FIX (ممیزی 2-a باگ‌های ۳/۷): دیداپ پرداخت pending تکراری ───
    // دو checkout موازی (دابل‌کلیک/رفرش) اعتبار ارتقا و کد تخفیف را دوبار embed
    // می‌کرد و دو Payment می‌ساخت → دو verify → دو فعال‌سازی/دو کسر. حالا: اگر
    // پرداخت pending همان پلن+روش+کد در ۱۰ دقیقه اخیر موجود است، همان را
    // برمی‌گردانیم (به‌جای ساخت دومی). برای درگاه، authority/gatewayUrl همان
    // درخواست قبلی زرین‌پال است — رفتار کاربر تغییری نمی‌کند.
    {
      const dupWindowStart = new Date(Date.now() - 10 * 60 * 1000);
      const codeKey = body.discountCode?.trim().toUpperCase() ?? null;
      const userCodeKey = body.userDiscountCode?.trim().toUpperCase() ?? null;
      const dup = await db.payment.findFirst({
        where: {
          userId: user.id,
          plan: plan.id,
          status: "pending",
          paymentMethod: body.paymentMethod,
          createdAt: { gte: dupWindowStart },
          discountCode: codeKey
            ? codeKey
            : userCodeKey
              ? userCodeKey
              : null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (dup) {
        let effectiveAuthority = dup.authority;

        // ─── 🔧 v124 (گزارش مالک — فلوی VPN): تازه‌سازی authority پرداخت کهنه ───
        // پرداخت pending درگاهیِ بالای ۳ دقیقه ممکن است authority مرده در زرین‌پال
        // داشته باشد (کاربر با VPN روی درگاه بلاک شده، برمی‌گردد، دوباره می‌زند →
        // reuse همان StartPay مرده را می‌دهد و به درگاه نمی‌رود). راه‌حل امن:
        // اول استعلام — اگر PAID/VERIFIED نیست، درخواست تازهٔ زرین‌پال می‌سازیم و
        // authority همان رکورد را به‌روز می‌کنیم (رکورد ثابت می‌ماند؛ اگر کاربر
        // قبلاً با authority قدیمی پرداخت کرده باشد استعلام PAID می‌دهد و دست
        // نمی‌زنیم → هیچ سناریوی «پول داده و گم‌شده» ممکن نمی‌شود).
        const dupAgeMs = Date.now() - dup.createdAt.getTime();
        if (
          dup.paymentMethod === "gateway" &&
          dup.amount > 0 &&
          dup.authority &&
          dupAgeMs > 3 * 60 * 1000
        ) {
          try {
            const inq = await zarinpalInquiry({ authority: dup.authority });
            const paidAtGateway = inq.status === "PAID" || inq.status === "VERIFIED";
            if (!paidAtGateway) {
              const fresh = await zarinpalRequest({
                amount: dup.amount,
                description: `خرید پلن فیتاپ — ${plan.label} (تازه‌سازی پرداخت معلق)`,
                callbackUrl: buildCallbackUrl(req.nextUrl.origin ?? ""),
                mobile: user.mobile,
              });
              if (fresh.ok && fresh.authority && fresh.gatewayUrl) {
                await db.payment.update({
                  where: { id: dup.id },
                  data: { authority: fresh.authority },
                });
                effectiveAuthority = fresh.authority;
              }
              // درخواست تازه شکست خورد → همان authority قبلی برمی‌گردد (رفتار قدیمی)
            }
            // PAID/VERIFIED → دست نمی‌زنیم؛ verify/callback خودش تحویل می‌دهد
          } catch {
            // خطای استعلام → همان authority قبلی (رفتار قدیمی، بدون رگرسیون)
          }
        }

        return Response.json({
          paymentId: dup.id,
          authority: effectiveAuthority,
          originalAmount: dup.originalAmount,
          discountValue: 0,
          upgradeCredit: Math.max(0, dup.originalAmount - dup.amount),
          isUpgrade: dup.originalAmount > dup.amount,
          finalAmount: dup.amount,
          plan,
          paymentMethod: dup.paymentMethod,
          // v49: URL درگاه از helper رسمی پراوایدر ساخته می‌شود (payment.zarinpal.com)
          gatewayUrl: effectiveAuthority ? zarinpalStartPayUrl(effectiveAuthority) : null,
          simulated: false,
          userDiscountCode: userCodeKey,
          // v112 — فعال‌سازی رایگان: پرداخت pending مبلغ صفر (کد تخفیف ۱۰۰٪ /
          // اعتبار ارتقای کامل) authority ندارد → کلاینت مستقیماً verify می‌زند
          directActivation: dup.paymentMethod === "gateway" && dup.amount === 0,
          callbackUrl:
            dup.paymentMethod === "gateway" ? buildCallbackUrl(req.nextUrl.origin ?? "") : null,
          reused: true,
        });
      }
    }

    let originalAmount = plan.price;
    let discountValue = 0;
    let discountCodeRecord: { id: string; code: string; type: string; value: number } | null = null;
    let userDiscountRecord: { id: string; code: string; type: string; value: number } | null = null;
    let appliedCode: string | null = null;

    // ─── منطق ارتقا (Upgrade): اگر کاربر پلن فعلی دارد و پلن جدید متفاوت است ───
    // فرمول: مبلغ باقی‌مانده از پلن فعلی = (pricePaid / durationDays) × daysLeft
    // مبلغ قابل پرداخت = قیمت پلن جدید - مبلغ باقی‌مانده (حداقل 0)
    //
    // F6: اشتراک‌های pending (خرید advanced/ultimate که هنوز پیش‌نیازها تکمیل نشده)
    // هم اعتبار کامل دارند — قیمت کامل pricePaid چون هیچ روزی از آن‌ها مصرف نشده.
    // بدون این اعتبار، پول پلن pending هنگام ارتقا سوخته می‌شد.
    let upgradeCredit = 0;
    let isUpgrade = false;
    const now = new Date();
    const [activeSub, pendingSubs] = await Promise.all([
      db.subscription.findFirst({
        where: { userId: user.id, status: "active", endDate: { gt: now } },
        orderBy: { endDate: "desc" },
      }),
      db.subscription.findMany({
        where: {
          userId: user.id,
          status: "pending",
          OR: [{ endDate: null }, { endDate: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (activeSub && activeSub.endDate && activeSub.plan !== plan.id) {
      const oldPlan = await getActivePlan(activeSub.plan as Plan);
      if (oldPlan) {
        const daysLeft = activeSub.endDate
          ? Math.ceil((activeSub.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        if (daysLeft > 0) {
          // مبلغ باقی‌مانده از پلن فعلی (pro-rated)
          upgradeCredit = Math.round((activeSub.pricePaid / activeSub.durationDays) * daysLeft);
          isUpgrade = true;
        }
      }
    }
    // اعتبار کامل اشتراک‌های pending (معمولاً یکی) — هیچ روزی مصرف نشده است
    for (const pSub of pendingSubs) {
      upgradeCredit += pSub.pricePaid;
      isUpgrade = true;
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
        // v53 — اگر کد نمایشی 248945 resolve نشد (منقضی/ناموجود) پیام دقیق بده
        if (code === ABANDONED_CART_DISPLAY_CODE) {
          const anyRecord = await db.userDiscountCode.findFirst({
            where: {
              userId: user.id,
              reason: "abandoned_cart",
              code: { startsWith: "248945-" },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          return Response.json(
            {
              error: anyRecord
                ? "کد ۲۴۸۹۴۵ شما منقضی شده است."
                : "کد تخفیف اختصاصی یافت نشد.",
            },
            { status: 400 }
          );
        }
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
      // v32/v47: کدهای «خرید اول» (وین‌بک آنبوردینگ 461291 + خوش‌آمدگویی 612964)
      // فقط برای اولین خرید فعال هستند — هر reason غیر از تمدید (renewal_loyalty)
      if (udc.reason !== "renewal_loyalty") {
        const subsCount = await db.subscription.count({ where: { userId: user.id } });
        if (subsCount > 0) {
          return Response.json(
            { error: "این کد تخفیف فقط برای اولین خرید قابل استفاده است." },
            { status: 400 }
          );
        }
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

      // توضیحات پرداخت برای زرین‌پال: پلن + نام کامل خریدار + شماره تماس (درخواست مالک)
      const payerLabel = user.name?.trim() || user.mobile;
      const paymentDescription = `فیتاپ — ${plan.label} — ${payerLabel} — ${user.mobile} — ${toPersianDigits(plan.durationDays)} روزه`;

      // ═══ v112 — فعال‌سازی رایگان: مبلغ نهایی صفر (کد تخفیف ۱۰۰٪ / اعتبار ارتقای کامل) ═══
      // زرین‌پال مبلغ صفر را رد می‌کند (قبلاً ۵۰۲ می‌داد و هیچ‌چیز ساخته/فعال نمی‌شد).
      // پس هیچ درگاهی در کار نیست: authority خالی می‌ماند، پرداخت pending مبلغ صفر
      // پایین‌تر ساخته می‌شود و پاسخ directActivation:true به کلاینت می‌گوید با زدن
      // دکمهٔ پرداخت مستقیماً verify را صدا بزند (فعال‌سازی آنی بدون درگاه).
      if (finalAmount === 0) {
        authority = null;
        gatewayUrl = null;
      } else if (isZarinpalConfigured()) {
        const zarinRes = await zarinpalRequest({
          amount: finalAmount, // Tomans
          description: paymentDescription,
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

    // توضیحات Payment در DB هم مثل درگاه: پلن + خریدار + شماره تماس
    const payerLabel2 = user.name?.trim() || user.mobile;
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
        description: `فیتاپ — ${plan.label} — ${payerLabel2} — ${user.mobile} — ${toPersianDigits(plan.durationDays)} روزه`,
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
      // v112 — فعال‌سازی رایگان: کلاینت باید مستقیماً verify بزند (بدون درگاه)
      directActivation: body.paymentMethod === "gateway" && finalAmount === 0,
      userDiscountCode: userDiscountRecord?.code ?? null,
      callbackUrl: body.paymentMethod === "gateway" ? buildCallbackUrl(req.nextUrl.origin ?? "") : null,
    });
  } catch (e) {
    return apiError(e);
  }
}
