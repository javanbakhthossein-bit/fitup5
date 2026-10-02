import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/fitness/rate-limit";
import { getActivePlan } from "@/lib/fitness/pricing";
import { detectEntrySourceFromUa } from "@/lib/fitness/entry-source";
import { stampUserSource } from "@/lib/fitness/payment-bridge";
import { toPersianDigits, type Plan } from "@/lib/fitness/types";

/**
 * v171 — POST /api/payment/instagram/intent — ثبت «نیت خرید» اینستاگرام
 *
 * حالت ۳ سبد رهاشده (سند بخش ۷): «کاربر ثبت‌نام کرده ولی حتی دکمه را هم نزده»
 * باید در همان لیست سبد رهاشده فعلی بیفتد — و تنها نشانگرِ کرون‌های موجود،
 * ردیف Payment pending با paymentMethod=gateway است. پس وقتی کاربر اینستاگرام
 * مدال خرید را باز می‌کند (قبل از زدن هر دکمه‌ای)، همین endpoint یک پرداخت
 * pending «بدون authority» می‌سازد — کرون موجود، بدون هیچ تغییری، ۳۰ دقیقه
 * بعد پیامک ترک-درگاه را می‌فرستد. هیچ کرون جدیدی ساخته نمی‌شود (دستور مهم ۲).
 *
 * اگر کاربر دکمه را بزند، checkout استاندارد همین پرداخت را (پنجرهٔ dedupe)
 * برمی‌دارد یا پرداخت واقعی می‌سازد — منطق پرداخت دست‌نخورده است.
 *
 * ⚠️ فقط برای منبع اینستاگرام صدا زده می‌شود؛ وب هیچ ردیف جدیدی نمی‌سازد
 * (تجربهٔ وب بایت‌به‌بایت ثابت می‌ماند) و اپ کافه‌بازار مسیر IAP خودش را دارد.
 */

interface Body {
  planId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const rl = rateLimit(`intent:${user.id}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as Body;
    const planId = String(body.planId || "").trim() as Plan;
    if (!planId) {
      return Response.json({ ok: false }, { status: 400 });
    }

    // کاربر بدون آنبوردینگ هنوز خریدار نیست (همان گارد T12 checkout) — ردیف نیت هم نمی‌سازیم
    if (!user.onboardingDone) {
      return Response.json({ ok: false, code: "ONBOARDING_REQUIRED" });
    }

    const plan = await getActivePlan(planId);
    if (!plan || plan.price <= 0) {
      return Response.json({ ok: false }, { status: 400 });
    }

    const ua = req.headers.get("user-agent");
    const source = detectEntrySourceFromUa(ua);
    const ip = getClientIp(req);

    // idempotent: اگر نیتِ همین پلن در ۲۴ ساعت اخیر هنوز باز است، همان کافی است
    const existing = await db.payment.findFirst({
      where: {
        userId: user.id,
        plan: plan.id,
        paymentMethod: "gateway",
        status: "pending",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) {
      return Response.json({ ok: true, paymentId: existing.id, reused: true });
    }

    const payerLabel = user.name?.trim() || user.mobile;
    const payment = await db.payment.create({
      data: {
        userId: user.id,
        amount: plan.price,
        originalAmount: plan.price,
        plan: plan.id,
        paymentMethod: "gateway",
        status: "pending",
        // بدون authority — فقط «نیت خرید». کرون سبد رهاشده این را می‌بیند؛
        // recover-payments هم (authority: { not: null }) از آن عبور می‌کند.
        description: `فیتاپ — ${plan.label} — ${payerLabel} — ${user.mobile} — ${toPersianDigits(plan.durationDays)} روزه`,
        source: source || "instagram",
      },
    });

    await stampUserSource(user.id, source);

    console.info(
      `[ig-intent] payment intent created — payment=${payment.id} user=${user.id} plan=${plan.id} ip=${ip}`
    );

    return Response.json({ ok: true, paymentId: payment.id, reused: false });
  } catch (e) {
    return apiError(e);
  }
}
