import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireAdmin, apiError } from "@/lib/fitness/auth";
import { ensureRenewalDiscountCode, getExpiryDiscountPercent } from "@/lib/fitness/notifications";

/**
 * GET /api/user-discount-code
 * Returns the current active (non-used, non-expired) renewal discount code for the logged-in user.
 *
 * Flags returned:
 *  - daysLeft:        Days until subscription expires. Negative if already expired.
 *  - expiresSoon:     true when 0 <= daysLeft <= 5 (subscription about to expire).
 *  - isExpired:       true when daysLeft < 0 AND user has a current plan AND
 *                     expiry happened within the last 90 days (so we don't bug long-expired users).
 *  - expiredDaysAgo:  How many days since the subscription expired (null if not expired).
 *
 * A renewal discount code is auto-generated for the user when EITHER:
 *  - the plan is expiring soon (within 5 days), OR
 *  - the plan is already expired (within the last 90 days).
 *
 * Response shape:
 *   { code, value, type, validUntil, isUsed, expiresSoon, isExpired, expiredDaysAgo, daysLeft, subEndDate, currentPlanId,
 *     planStartedAt, planDurationDays, workoutsCompleted, weightStartKg, weightCurrentKg }
 */
export async function GET() {
  try {
    const user = await requireAuth();

    const now = new Date();
    const subEnd = user.planExpiresAt ?? null;
    const daysLeft = subEnd
      ? Math.ceil((subEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const expiresSoon = daysLeft != null && daysLeft >= 0 && daysLeft <= 5;

    // Expired-flag: only true when the user actually had a plan, it has expired,
    // AND the expiry happened within the last 90 days (avoid nagging users who expired long ago).
    const currentPlanId = user.planName ?? null;
    let expiredDaysAgo: number | null = null;
    if (subEnd && daysLeft != null && daysLeft < 0) {
      expiredDaysAgo = Math.abs(daysLeft);
    }
    const isExpired =
      !!currentPlanId &&
      expiredDaysAgo != null &&
      expiredDaysAgo <= 90;

    // ─── v38 — گیت تخفیف مالک: کد تخفیف تمدید فقط «۷۲ ساعت بعد از انقضا» فعال
    // می‌شود (هم‌زمان با پیامک 604678). تا آن لحظه — پلن فعال، نزدیک انقضا یا
    // تازه منقضی — نه کدی ساخته می‌شود نه نمایش داده می‌شود.
    const expiredHoursAgo = subEnd
      ? (now.getTime() - subEnd.getTime()) / (1000 * 60 * 60)
      : 0;
    const discountWindowActive = expiredHoursAgo >= 72;

    // Look for an existing active renewal code — فقط در پنجرهٔ فعال
    let code = null as Awaited<ReturnType<typeof db.userDiscountCode.findFirst>> | null;
    let codeReason: string | null = null;
    if (discountWindowActive) {
      code = await db.userDiscountCode.findFirst({
        where: {
          userId: user.id,
          isUsed: false,
          reason: "renewal_loyalty",
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (code) codeReason = "renewal_loyalty";

      // Auto-generate a code if the plan is already expired (within 90 days)
      // and they don't yet have an active renewal code.
      if (!code && isExpired) {
        // v32: درصد از تنظیمات پنل مدیر (expiry_discount_percent — پیش‌فرض ۳۰ v47)
        // v53: اعتبار ۱۴ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
        const generated = await ensureRenewalDiscountCode(user.id, await getExpiryDiscountPercent(), 2);
        if (generated) {
          code = await db.userDiscountCode.findFirst({
            where: { userId: user.id, code: generated.code },
          });
          codeReason = code ? "renewal_loyalty" : null;
        }
      }
    }

    // ─── v47 — کدهای «خرید اول» (دیریکتیو مالک برای پیامک‌های 461291 و 612964) ───
    // کاربر به صفحه پلن‌ها ارجاع می‌شود → «قیمت پلن‌ها را روی کارت‌ها با تخفیف
    // بنویس و تا زمان خرید هم همین‌جوری با تخفیف نمایش بده برای همون کاربر».
    // پس کد welcome_offer / onboarding_winback (استفاده‌نشده و معتبر) هم اینجا
    // برمی‌گردد تا کارت‌های پلن و مودال خرید برای همان کاربر تخفیف‌خورده شوند.
    // فقط برای کاربری که هرگز اشتراکی نداشته (ماهیت اولین‌خرید این کدها).
    if (!code) {
      try {
        const subsCount = await db.subscription.count({ where: { userId: user.id } });
        if (subsCount === 0) {
          code = await db.userDiscountCode.findFirst({
            where: {
              userId: user.id,
              isUsed: false,
              reason: { in: ["welcome_offer", "onboarding_winback"] },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            },
            orderBy: { createdAt: "desc" },
          });
          codeReason = code?.reason ?? null;
        }
      } catch {
        // نباید جریان را بشکند
      }
    }

    // ─── آمار دوره برای صفحه تمدید (renewal-overlay) ───
    // سبک و فقط وقتی پلنی وجود دارد: تعداد تمرین‌های ثبت‌شده از شروع دوره +
    // وزن شروع/فعلی. هر دو برای پلن‌های خریداری‌شده و ادمین‌فعال یکسان کار می‌کنند.
    let planStartedAt: string | null = null;
    let planDurationDays = 45;
    let workoutsCompleted: number | null = null;
    let weightStartKg: number | null = null;
    let weightCurrentKg: number | null = null;
    if (currentPlanId) {
      try {
        const currentSub = await db.subscription.findFirst({
          where: { userId: user.id, plan: currentPlanId },
          orderBy: { createdAt: "desc" },
          select: { startDate: true, durationDays: true },
        });
        const started = user.planStartedAt ?? currentSub?.startDate ?? null;
        planStartedAt = started ? started.toISOString() : null;
        planDurationDays = currentSub?.durationDays ?? 45;
        const completed = await db.workoutDayStatus.count({
          where: {
            userId: user.id,
            status: "completed",
            ...(started ? { createdAt: { gte: started } } : {}),
          },
        });
        workoutsCompleted = completed;
      } catch {}
      try {
        const profile = await db.onboardingProfile.findUnique({
          where: { userId: user.id },
          select: { weight: true },
        });
        const lastWeight = await db.weightLog.findFirst({
          where: { userId: user.id },
          orderBy: { loggedAt: "desc" },
          select: { weight: true },
        });
        weightStartKg = profile?.weight ?? null;
        weightCurrentKg = lastWeight?.weight ?? weightStartKg;
      } catch {}
    }

    // ─── v53 — طول اعتبار کد بر حسب ساعت (برای شمارش معکوس UI) ───
    // از فاصلهٔ createdAt تا validUntil خود رکورد محاسبه می‌شود — کدهای ۴۸ ساعتهٔ
    // جدید ۴۸ و کدهای قدیمیِ مانده از نسخه‌های قبل، طول واقعی خودشان را می‌دهند.
    const validHours =
      code?.validUntil && code.createdAt
        ? Math.max(1, Math.round((code.validUntil.getTime() - code.createdAt.getTime()) / (1000 * 60 * 60)))
        : null;

    return Response.json({
      // v47 — کدهای خرید اول بدون گیت پنجرهٔ انقضا هم برمی‌گردند
      code: code?.code ?? null,
      value: code?.value ?? 0,
      type: code?.type ?? "percent",
      reason: codeReason,
      validUntil: code?.validUntil?.toISOString() ?? null,
      // v53 — طول اعتبار (ساعت) + مهلت مطلق برای شمارش معکوس بنر تخفیف
      validHours,
      isUsed: code?.isUsed ?? false,
      discountWindowActive,
      expiresSoon,
      isExpired,
      expiredDaysAgo,
      daysLeft: daysLeft ?? 0,
      subEndDate: subEnd?.toISOString() ?? null,
      currentPlanId,
      planStartedAt,
      planDurationDays,
      workoutsCompleted,
      weightStartKg,
      weightCurrentKg,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/user-discount-code
 * Manually trigger creation of a renewal discount code (admin/debug tool).
 * Body: { percent?: number, validForDays?: number, userId?: string }
 *
 * F7: فقط ادمین — قبلاً requireAuth بود و هر کاربر می‌توانست برای خودش
 * کد تخفیف تا ۵۰٪ بسازد (سوءاستفاده مستقیم روی قیمت ultimate).
 * v53: پیش‌فرض اعتبار ۱۴ → ۲ روز (۴۸ ساعت) — دیریکتیو مالک.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const percent = Math.max(5, Math.min(50, Number(body?.percent ?? 15)));
    const validForDays = Math.max(1, Math.min(60, Number(body?.validForDays ?? 2)));

    // شناسه کاربر هدف — اگر ادمین userId نفرستاده، خطا (کد تخفیف per-user است)
    const targetUserId =
      typeof body?.userId === "string" && body.userId.trim()
        ? body.userId.trim()
        : null;
    if (!targetUserId) {
      return Response.json(
        { error: "userId الزامی است (کد تخفیف اختصاصی برای هر کاربر ساخته می‌شود)." },
        { status: 400 }
      );
    }
    const targetUser = await db.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
    }

    const generated = await ensureRenewalDiscountCode(targetUserId, percent, validForDays);
    if (!generated) {
      return Response.json({ error: "ساخت کد تخفیف ناموفق بود." }, { status: 500 });
    }
    return Response.json({ ok: true, ...generated });
  } catch (e) {
    return apiError(e);
  }
}
