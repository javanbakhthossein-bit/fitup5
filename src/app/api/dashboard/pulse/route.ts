import { requireAuth, apiError } from "@/lib/fitness/auth";
import { db } from "@/lib/db";
import { findNeverActivatedSubscriptionLight } from "@/lib/fitness/subscription";

/**
 * Task 3-a — «پالس» داشبورد/پنل کاربر (GET /api/dashboard/pulse)
 *
 * هدف (دیرکتیو مالک): داشبورد و پنل باید «تا ~۳ ثانیه» هر تغییر پلن/وضعیت
 * تولید برنامه/اعلان تازه را منعکس کنند — بدون رفرش کامل اپ.
 *
 * این روتی عمداً «خیلی کوچک» است و با کوئری‌های سبک فقط فیلدهایی را برمی‌گرداند
 * که کلاینت برای diff-guard لازم دارد (نگاه کنید به src/lib/fitness/use-pulse.ts).
 * ساخت DTO کامل کاربر (buildUserDto) و واکشی برنامه‌ها عمداً اینجا نیست —
 * هر رفرش واقعی از مسیر /api/auth/me (با force از پالس) انجام می‌شود.
 *
 * پاسخ همیشه با Cache-Control: no-store سرو می‌شود تا هیچ لایه‌ای (مرورگر/PWA/پروکسی)
 * آن را کش نکند — در غیر این صورت کل منطق ۳ ثانیه‌ای بی‌معنا می‌شد.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const now = new Date();

    // ① یک ردیف User — فیلدهای پلن
    // ② اشتراک فعال + pending (همان معناشناسی buildUserDto — سبک‌شده)
    // ③ آخرین ProgramRequest — وضعیت چرخهٔ تولید برنامه
    // ④ شمارش اعلان‌های نخوانده (فیلد مدل: read — نه isRead)
    const [userRow, activeSub, pendingSub, latestRequest, unread] = await Promise.all([
      db.user.findUnique({
        where: { id: user.id },
        select: { planName: true, planStartedAt: true, planExpiresAt: true },
      }),
      db.subscription.findFirst({
        where: { userId: user.id, status: "active", endDate: { gt: now } },
        select: { plan: true },
      }),
      db.subscription.findFirst({
        where: {
          userId: user.id,
          status: "pending",
          OR: [{ endDate: null }, { endDate: { gt: now } }],
        },
        select: { plan: true },
      }),
      db.programRequest.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, updatedAt: true },
      }),
      db.notification.count({ where: { userId: user.id, read: false } }),
    ]);

    // fallback منبع دوم پلن (هم‌راستا با buildUserDto v77): ردیف User فقط وقتی
    // معتبر است که planExpiresAt در آینده باشد — پلن منقضی هرگز «فعال» جلوه نمی‌کند.
    const userRowPlanValid =
      typeof userRow?.planName === "string" &&
      userRow.planName.length > 0 &&
      !!userRow?.planExpiresAt &&
      userRow.planExpiresAt.getTime() > now.getTime();

    // ─── v87 — نجات حق خریدِ «هرگز-فعال‌نشده» (هم‌راستا با buildUserDto) ───
    // اگر این نجات اینجا نبود، پالس با auth/me ناسازگار می‌شد (پالس: بی‌پلن /
    // auth-me: pending نجات‌یافته) → diff-guard پالس هر ۳ ثانیه refreshUser
    // می‌زد = حلقهٔ بی‌پایان رفرش. معناشناسی باید دقیقاً یکی باشد.
    let rescuedPlan: string | null = null;
    if (!activeSub && !pendingSub) {
      try {
        const rescued = await findNeverActivatedSubscriptionLight(user.id);
        if (rescued) rescuedPlan = rescued.plan;
      } catch {
        /* best-effort */
      }
    }

    return Response.json(
      {
        ok: true,
        serverTime: now.toISOString(),
        planName:
          activeSub?.plan ??
          pendingSub?.plan ??
          rescuedPlan ??
          (userRowPlanValid ? userRow!.planName : null),
        planStartedAt: userRow?.planStartedAt?.toISOString() ?? null,
        planExpiresAt: userRow?.planExpiresAt?.toISOString() ?? null,
        hasActiveSubscription: !!activeSub,
        hasPendingSubscription: !!pendingSub || !!rescuedPlan,
        programStatus: latestRequest?.status ?? null,
        programUpdatedAt: latestRequest?.updatedAt.toISOString() ?? null,
        unreadNotifications: unread,
        planId: latestRequest?.id ?? null,
      },
      // بدون کش — پالس باید همیشه «زنده» باشد
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return apiError(e);
  }
}
