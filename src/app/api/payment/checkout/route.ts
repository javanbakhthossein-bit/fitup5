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
import { detectEntrySourceFromUa } from "@/lib/fitness/entry-source";
import { stampUserSource } from "@/lib/fitness/payment-bridge";
// v198 — رویدادگذاری قیف فروش (دیرکتیو مالک)
import { recordFunnelEvent } from "@/lib/analytics/funnel";

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
  /** v197 — توکن تخفیف ۱۰٪ صفحهٔ تحلیل (صادرشده از /api/onboarding/analysis-discount) */
  analysisDiscountToken?: string;
  /** v214 — سشن ناشناس قیف (اتصال رویداد سروری به رویدادهای کلاینت) */
  sessionId?: string;
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
    // v171 — منبع ورود از UA همین درخواست (سند بخش ۱) — روی Payment ثبت می‌شود؛
    // وب/اینستاگرام/اپ اختصاصی هرکدام مقدار مستقل خودشان را می‌گیرند و کافه‌بازار
    // مستثناست. هیچ تغییری در منطق پرداخت ندارد — فقط برچسب ممیزی + مسیریابی کال‌بک.
    const entrySource = detectEntrySourceFromUa(req.headers.get("user-agent"));
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

    // ═══ v200 — اعتبارسنجی زودهنگام توکن تخفیف صفحهٔ تحلیل (قبل از dedupe) ═══
    // ریشه‌یابی باگ گزارش مالک: «از مدال خرید اینستاگرام وارد درگاه شدم ولی
    // تخفیف صفحهٔ تحلیل اعمال نشده بود — همان ۱٬۲۰۰٬۰۰۰ در درگاه بود».
    // دو ریشهٔ ساختاری پیدا و ریشه‌کنی شد:
    //   ① dedupe پایین‌تر پرداخت معلقِ قدیمیِ «بدون تخفیف» را بازمی‌گرداند و
    //      توکن را بی‌صدا نادیده می‌گرفت → درگاه مبلغ کامل می‌گرفت.
    //      فیکس: اگر توکن معتبر هست ولی پرداخت معلق موجود توکن تخفیف تحلیل
    //      ندارد، بازیاستفاده نمی‌کنیم — مسیر عادی با تخفیف ادامه می‌یابد.
    //   ② مسابقه revoke-grant بعد از reload (مرورگر درون‌اپی اینستاگرام) —
    //      فیکس سمت کلاینت/سرور در /api/onboarding/analysis-discount (revoke
    //      فقط توکن خودش) — این‌جا تغییری لازم ندارد؛ توکن نامعتبر = بدون تخفیف.
    // اعتبارسنجی یک‌بار این‌جا انجام می‌شود و نتیجه در کل مسیر استفاده می‌شود
    // (هم dedupe هم اعمال تخفیف) — بدون کوئری تکراری.
    let adTokenRecord: { id: string; amount: number } | null = null;
    {
      const adTokenRaw0 = String(body.analysisDiscountToken || "").trim();
      if (adTokenRaw0) {
        const t = await db.paymentToken.findFirst({
          where: {
            token: adTokenRaw0,
            kind: "analysis_discount",
            userId: user.id,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, amount: true },
        });
        // amount فیلد ممیزیِ درصد است — برای kind="analysis_discount" همیشه مقدار دارد
        if (t && typeof t.amount === "number") {
          adTokenRecord = { id: t.id, amount: t.amount };
        }
      }
    }

    // ─── FIX (ممیزی 2-a باگ‌های ۳/۷): دیداپ پرداخت pending تکراری ───
    // دو checkout موازی (دابل‌کلیک/رفرش) اعتبار ارتقا و کد تخفیف را دوبار embed
    // می‌کرد و دو Payment می‌ساخت → دو verify → دو فعال‌سازی/دو کسر. حالا: اگر
    // پرداخت pending همان پلن+روش+کد در ۱۰ دقیقه اخیر موجود است، همان را
    // برمی‌گردانیم (به‌جای ساخت دومی). برای درگاه، authority/gatewayUrl همان
    // درخواست قبلی زرین‌پال است — رفتار کاربر تغییری نمی‌کند.
    //
    // v200 — استثنای تخفیف صفحهٔ تحلیل: اگر توکن تخفیف معتبر داریم ولی پرداخت
    // معلقِ موجود «بدون تخفیف صفحهٔ تحلیل» ساخته شده (مثلاً تلاش قبلی قبل از
    // رسیدن به صفحهٔ تحلیل، یا توکن قبلی منقضی/ابطال شده)، همان پرداختِ کامل‌قیمت
    // بازیاستفاده نمی‌شود — چون بازیاستفاده = حذف بی‌صدای تخفیف و مبلغ کامل در
    // درگاه (دقیقاً باگ گزارش مالک). پرداخت قدیمی دست‌نخورده می‌ماند (اگر کاربر
    // با آن authority قدیمی پرداخت کرده باشد verify همان را تحویل می‌دهد) و
    // کرون انقضا بعداً رسیدگی می‌کند.
    let skipDupForAnalysisDiscount = false;
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
      if (dup && adTokenRecord) {
        const dupHasAnalysisDiscount = await db.paymentToken.findFirst({
          where: { paymentId: dup.id, kind: "analysis_discount" },
          select: { id: true },
        });
        if (!dupHasAnalysisDiscount) {
          skipDupForAnalysisDiscount = true;
        }
      }
      if (dup && !skipDupForAnalysisDiscount) {
        let effectiveAuthority = dup.authority;

        // ═══ v171 — پرداختِ بدون authority (نیت خرید اینستاگرام یا ردیف قدیمی) ═══
        // checkout استاندارد برایش authority می‌سازد — رکورد ثابت می‌ماند و
        // dedupe/تحویل/کرون‌ها دقیقاً مثل قبل کار می‌کنند. فقط مسیر درگاهِ وب
        // (کال‌بک ساده) اینجا ساخته می‌شود؛ مسیرهای اینستاگرام/اپ از /enter و
        // /pay/start با کال‌بک مخصوص خودشان authority تازه می‌سازند.
        if (
          body.paymentMethod === "gateway" &&
          dup.paymentMethod === "gateway" &&
          dup.amount > 0 &&
          !dup.authority
        ) {
          if (isZarinpalConfigured()) {
            const origin0 = req.nextUrl.origin ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
            const cb0 = buildCallbackUrl(origin0);
            try {
              const fresh0 = await zarinpalRequest({
                amount: dup.amount,
                description: `خرید پلن فیتاپ — ${plan.label}`,
                callbackUrl: cb0,
                mobile: user.mobile,
              });
              if (fresh0.ok && fresh0.authority) {
                await db.payment.update({
                  where: { id: dup.id },
                  data: {
                    authority: fresh0.authority,
                    authorityCallbackUrl: cb0,
                    authorityIssuedAt: new Date(),
                  },
                });
                effectiveAuthority = fresh0.authority;
              }
            } catch {
              // خطای شبکه → authority null می‌ماند (رفتار امنِ بدون درگاه)
            }
          }
        }

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
                  data: {
                    authority: fresh.authority,
                    // v171 — هم‌ترازسازی فرادادهٔ authority (کال‌بک/زمان صدور)
                    authorityCallbackUrl: buildCallbackUrl(req.nextUrl.origin ?? ""),
                    authorityIssuedAt: new Date(),
                  },
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
      // v207 — زمان‌بندی شروع کمپین‌های پیامکی: کدِ برنامه‌ریزی‌شده برای آینده هنوز فعال نیست
      if (dc.validFrom && dc.validFrom > new Date()) {
        return Response.json({ error: "کد تخفیف هنوز فعال نشده است." }, { status: 400 });
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
      // v216 — استثنا: کد شخصی «personal_upsell» (دیرکتیو مالک — آپ‌سل ریتنشن)
      if (udc.reason !== "renewal_loyalty" && udc.reason !== "personal_upsell") {
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
    let finalAmount = Math.max(0, originalAmount - discountValue - upgradeCredit);

    // ═══ v197 — تخفیف ۱۰٪ صفحهٔ تحلیل آنبوردینگ (دیرکتیو مالک) ═══
    // «تخفیف انبوردینگ رو هم بذار ۱۰ درصد برای همه … اگر اومد بیرون دیگه
    // غیرفعال بشه» — توکن فقط از /api/onboarding/analysis-discount صادر
    // می‌شود، ۳۰ دقیقه TTL دارد و با خروج از صفحه فوراً باطل می‌شود.
    // اعمال: ۱۰٪ از مبلغ نهایی (بعد از کد تخفیف و اعتبار ارتقا) — برای همه.
    //
    // v200 — اعتبارسنجی از قبل (بالای فایل) انجام شده. اعمال تخفیف دو مرحله‌ای شد
    // (v202 ممیزی H4): ابتدا فقط «محاسبهٔ» تخفیف؛ «مصرف اتمیک» توکن بعد از چک
    // کیف پول انجام می‌شود و در همهٔ شکست‌های بعدی (خطای درگاه/کرش create)
    // rollback می‌شود — دیگر شکست میانی توکن را نمی‌سوزاند.
    let analysisDiscountValue = 0;
    let adTokenId: string | null = null;
    if (adTokenRecord && finalAmount > 0) {
      analysisDiscountValue = Math.round((finalAmount * adTokenRecord.amount) / 100);
      finalAmount = Math.max(0, finalAmount - analysisDiscountValue);
    }

    // اگر پرداخت از کیف پول، بررسی موجودی (قبل از مصرف توکن — H4:
    // «موجودی کافی نیست» دیگر نباید توکن تخفیف را بسوزاند)
    const checkWalletBalance = async (): Promise<Response | null> => {
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
      return null;
    };
    if (body.paymentMethod === "wallet") {
      const walletErr = await checkWalletBalance();
      if (walletErr) return walletErr;
    }

    // ═══ مصرف اتمیک توکن تخفیف (فقط بعد از همهٔ اعتبارسنجی‌ها) ═══
    if (adTokenRecord && analysisDiscountValue > 0) {
      const consumed = await db.paymentToken.updateMany({
        where: { id: adTokenRecord.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 1) {
        // پیوند به پرداخت بعد از ساخت رکورد ثبت می‌شود (ممیزی)
        adTokenId = adTokenRecord.id;
      } else {
        // توکن در درخواست موازی همین لحظه مصرف شد — تخفیف اعمال نمی‌شود
        adTokenRecord = null;
        analysisDiscountValue = 0;
        finalAmount = Math.max(0, originalAmount - discountValue - upgradeCredit);
        // مبلغ واقعیِ بدون تخفیف بزرگ‌تر است — چک کیف پول باید با مبلغ جدید تکرار شود
        if (body.paymentMethod === "wallet") {
          const walletErr2 = await checkWalletBalance();
          if (walletErr2) return walletErr2;
        }
      }
    }

    // v202 (H4) — بازگردانی توکن در شکست‌های میانی بعد از مصرف:
    // گارد paymentId:null تضمین می‌کند فقط توکنِ همین درخواست (که هنوز به
    // هیچ پرداختی لینک نشده) آزاد شود — اگر درخواست موازی‌ای بعداً آن را
    // مصرف/لینک کرده باشد، دست نمی‌خورد.
    const rollbackAnalysisToken = async () => {
      if (!adTokenId) return;
      await db.paymentToken
        .updateMany({
          where: { id: adTokenId, paymentId: null, usedAt: { not: null } },
          data: { usedAt: null },
        })
        .catch(() => {});
      adTokenId = null;
    };

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
          // v202 (H4): توکن مصرف‌شده را پس بده — کاربر برای تلاش بعدی تخفیف را از دست ندهد
          await rollbackAnalysisToken();
          // v202 (L11) — جزئیات داخلی درگاه فقط در لاگ سرور
          console.error("[checkout] zarinpal request failed:", zarinRes.error);
          return Response.json(
            {
              error: "اتصال به درگاه پرداخت ناموفق بود. لطفاً چند لحظه بعد تلاش کنید.",
              code: "GATEWAY_ERROR",
            },
            { status: 502 }
          );
        }
      } else {
        // زرین‌پال پیکربندی نشده — خطا برگردان
        await rollbackAnalysisToken();
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
    // v202 (H4) — اگر ساخت Payment شکست بخورد، توکن مصرف‌شده پس داده شود
    let payment;
    try {
      payment = await db.payment.create({
      data: {
        userId: user.id,
        amount: finalAmount,
        originalAmount,
        plan: plan.id,
        paymentMethod: body.paymentMethod,
        authority,
        // v171 — فرادادهٔ authority + منبع ورود (فقط برچسب ممیزی/مسیریابی)
        ...(body.paymentMethod === "gateway" && authority
          ? {
              authorityCallbackUrl: buildCallbackUrl(req.nextUrl.origin ?? ""),
              authorityIssuedAt: new Date(),
            }
          : {}),
        source: entrySource,
        status: "pending",
        discountCode: appliedCode,
        description: `فیتاپ — ${plan.label} — ${payerLabel2} — ${user.mobile} — ${toPersianDigits(plan.durationDays)} روزه`,
      },
    });
    } catch (createErr) {
      await rollbackAnalysisToken();
      throw createErr;
    }

    // v197 — پیوند توکن تخفیف تحلیل به پرداخت (ممیزی)
    if (adTokenId) {
      await db.paymentToken
        .update({ where: { id: adTokenId }, data: { paymentId: payment.id } })
        .catch(() => {});
    }

    // v198 — رویداد قیف: ایجاد پرداخت در سرور (authoritative — شاخهٔ درگاه/کیف
    // پول/فعال‌سازی رایگان از meta روش مشخص می‌شود)
    await recordFunnelEvent({
      event: "checkout_created",
      userId: user.id,
      // v214 — سشن کلاینت (ممیزی قیف: این رویداد بدون سشن بود و به «مدال باز/کلیک» وصل نمی‌شد)
      sessionId: typeof body.sessionId === "string" ? body.sessionId.slice(0, 80) : null,
      planId: plan.id,
      amount: finalAmount,
      meta: {
        method: body.paymentMethod,
        hasGateway: !!gatewayUrl,
        directActivation: body.paymentMethod === "gateway" && finalAmount === 0,
        discountCode: appliedCode ?? undefined,
        // v200 — ممیزی تخفیف صفحهٔ تحلیل (تشخیص دقیق در قیف فروش)
        analysisDiscountApplied: analysisDiscountValue > 0,
      },
      userAgent: req.headers.get("user-agent"),
    });

    // v171 — ثبت منبع ورود کاربر (فقط اولین بار — مقدس)
    await stampUserSource(user.id, entrySource);

    return Response.json({
      paymentId: payment.id,
      authority,
      originalAmount,
      discountValue,
      upgradeCredit,
      isUpgrade,
      // v197 — مقدار تخفیف ۱۰٪ صفحهٔ تحلیل (برای نمایش دقیق در مودال)
      analysisDiscountValue,
      // v200 — آیا تخفیف صفحهٔ تحلیل واقعاً اعمال شد؟ (شفافیت: اگر مودال انتظار
      // تخفیف داشت ولی توکن مثلاً منقضی/ابطال شده بود، کلاینت پیام روشن می‌دهد)
      analysisDiscountApplied: analysisDiscountValue > 0,
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
