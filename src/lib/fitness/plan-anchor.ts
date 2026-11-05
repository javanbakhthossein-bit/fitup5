import { db } from "@/lib/db";

// ─── v246-checkup — لنگر زمانی پلن (Plan Anchor) ───
// دیرکتیو مالک: «چکاپ‌های ۱۵ روزه (۱/۲/۳) باید وقتی زمان‌شان رسید فعال و
// قابل‌اعمال باشند — بدون نیاز به چکاپ فاز صفر» و «پیامک ثبت چکاپ هرگز نباید
// برای کاربری که پلنش توسط مدیر لغو شده (یا منقضی است) ارسال شود.»
//
// ریشهٔ مشکل: برای پلن‌های advanced/ultimate، User.planStartedAt فقط هنگام
// فعال‌سازی اشتراک (activatePendingSubscription) ست می‌شود و در خرید/دریفت می‌تواند
// null یا ناهم‌زمان با اشتراک باشد → کاربرِ دارای اشتراکِ فعال، همهٔ چکاپ‌هایش
// برای همیشه قفل می‌ماند (به‌خاطر لنگر null روی ردیف User).
//
// منبع حقیقتِ لنگر، همان معناشناسی buildUserDto (src/lib/fitness/auth.ts) است:
//   • اشتراک فعال: status="active" + endDate > now (مرتب بر endDate نزولی) —
//     به‌اضافهٔ دفاعِ در-عمقِ cancelledAt=null (لغو ادمین هرگز لنگر نمی‌شود) و
//     startDate≠null (لنگر بدون شروع بی‌معنی است).
//   • planActive = اشتراک فعال Exists ‖ فال‌بک ردیف User (v77): planName
//     غیرخالی + planExpiresAt در آینده — دقیقاً مثل userRowPlanValid در buildUserDto.
//   • planStart = activeSub.startDate ?? User.planStartedAt (زنجیرهٔ فال‌بک).
//
// این هلپر «فقط-خواندنی» است (هیچ write ای ندارد) و خطای DB را می‌بلعد
// (خروجی null/false) تا GET /api/checkup هرگز ۵۰۰ ندهد.

export interface PlanAnchor {
  /** لنگر شروع دوره: startDate اشتراک فعال، در نبودش User.planStartedAt، در نبود آن null */
  planStart: Date | null;
  /** پلن واقعاً فعال است؟ (اشتراک active یا فال‌بک معتبر ردیف User طبق v77) */
  planActive: boolean;
}

export async function resolvePlanAnchor(userId: string): Promise<PlanAnchor> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { planName: true, planStartedAt: true, planExpiresAt: true },
    });
    if (!user) return { planStart: null, planActive: false };

    const now = new Date();
    // v246-checkup — اشتراکِ لنگر: همان شرایط buildUserDto + گاردهای دفاعی
    // cancelledAt=null (لغو ادمین) و startDate≠null (لنگر باید تاریخ شروع داشته باشد)
    const anchorSub = await db.subscription.findFirst({
      where: {
        userId,
        status: "active",
        cancelledAt: null,
        startDate: { not: null },
        endDate: { gt: now },
      },
      orderBy: { endDate: "desc" },
      select: { startDate: true },
    });

    // v77 — فال‌بک ردیف User (کاربرانی که رکورد Subscription ندارند ولی
    // planName + planExpiresAt معتبر دارند) — فقط برای planActive، عین buildUserDto
    const userRowPlanValid =
      typeof user.planName === "string" &&
      user.planName.length > 0 &&
      !!user.planExpiresAt &&
      user.planExpiresAt.getTime() > now.getTime();

    return {
      planStart: anchorSub?.startDate ?? (user.planStartedAt ? new Date(user.planStartedAt) : null),
      planActive: !!anchorSub || userRowPlanValid,
    };
  } catch (err) {
    // خطای DB → بدون لنگر و بدون پلن فعال ( graceful — هرگز route را ۵۰۰ نمی‌کند)
    console.error("[plan-anchor] resolve failed:", err);
    return { planStart: null, planActive: false };
  }
}
