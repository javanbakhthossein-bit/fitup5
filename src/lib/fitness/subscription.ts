import { db } from "@/lib/db";
import { processReferralReward } from "@/lib/fitness/referral";

/**
 * پنجره اعتبار اشتراک pending (به روز).
 *
 * اشتراک‌های advanced/ultimate هنگام خرید با status="pending" ساخته می‌شوند و
 * دوره اصلی (۴۵ روز) از زمان تکمیل پیش‌نیازها شروع می‌شود. برای اینکه کاربر
 * نتواند برای همیشه (بدون ارسال عکس بدن) به قابلیت‌های tier-3/4 دسترسی داشته
 * باشد، endDate اشتراک pending برابر «زمان خرید + PENDING_WINDOW_DAYS» است.
 * buildUserDto (auth.ts) اشتراک pending را فقط تا این تاریخ معتبر می‌شمارد و
 * بعد از آن به‌صورت تنبل (lazy) آن را expired می‌کند.
 */
export const PENDING_WINDOW_DAYS = 7;

/**
 * v87 — قاعدهٔ «حق خریدِ هرگز-فعال‌نشده» (ریشه‌یابی باگ مالک: «یک هفته پیش پلن
 * پیشرفته خریدم ولی در پنلم زده پلن نداری»):
 *
 * اشتراک advanced/ultimate هنگام خرید با status="pending" و startDate=null و
 * endDate=خرید+۷روز ساخته می‌شود. اگر کاربر تا پایان پنجرهٔ ۷روزه پیش‌نیازها
 * (عکس بدن) را تکمیل نکند، buildUserDto آن را به‌صورت تنبل expired می‌کند.
 * قبلاً بعد از این لحظه کاربرِ پرداخت‌کرده به‌طور کامل «بی‌پلن» دیده می‌شد و
 * هیچ مسیری (یادآوری، auto-activate روز ۳۰، فعال‌سازی بعد از تکمیل دیرهنگام
 * پیش‌نیازها) او را پیدا نمی‌کرد — چون همه‌شان فقط status="pending" را
 * جستجو می‌کردند.
 *
 * قاعدهٔ واحد و امن: اشتراکی «حق خریدِ فعال‌نشده» است اگر و فقط اگر:
 *   • status آن pending یا expired باشد (فعال‌نشده),
 *   • startDate آن null باشد (هرگز شروع نشده — اشتراک‌های واقعاً فعال startDate دارند),
 *   • cancelledAt آن null باشد (لغو صریح ادمین — اکشن remove — را مستثنی می‌کند
 *     تا پلنِ حذف‌شده توسط ادمین هرگز دوباره زنده نشود).
 *
 * همهٔ نقاطی که قبلاً فقط «pending داخل پنجره» را می‌دیدند (buildUserDto، پالس،
 * getPlanRegenState، یادآوری/auto-activate کرون رفتاری، activatePendingSubscription)
 * از این هلپر مشترک استفاده می‌کنند تا معناشناسی در تمام سیستم یکی بماند.
 */
export function findNeverActivatedSubscription(userId: string) {
  return db.subscription.findFirst({
    where: {
      userId,
      status: { in: ["pending", "expired"] },
      startDate: null,
      cancelledAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * نسخهٔ سبک هلپر بالا برای روتی‌هایی که فقط پلن/وجود را لازم دارند
 * (پالس ۳ ثانیه‌ای — کوئری روی همان ایندکس، بدون select سنگین).
 */
export function findNeverActivatedSubscriptionLight(userId: string) {
  return db.subscription.findFirst({
    where: {
      userId,
      status: { in: ["pending", "expired"] },
      startDate: null,
      cancelledAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { plan: true },
  });
}

/**
 * فعال‌سازی اشتراک pending کاربر (advanced/ultimate) در لحظه تکمیل پیش‌نیازها.
 *
 * این تابع entitlement تجاری را از موفقیت زنجیره AI جدا می‌کند:
 * به‌محض اینکه کاربر پیش‌نیازها را تعیین‌تکلیف کرد صدا زده می‌شود (نه بعد از
 * موفقیت تولید برنامه) تا دوره ۴۵ روزه صرف‌نظر از نتیجه AI شروع شود.
 *
 * کارها:
 *  - آخرین اشتراک «هرگز-فعال‌نشده» (pending داخل پنجره یا expired پشت‌سرِ پنجره —
 *    v87، قاعدهٔ findNeverActivatedSubscription) را پیدا می‌کند.
 *  - endDate = now + durationDays و status="active" و startDate=now تنظیم می‌کند.
 *  - فیلدهای پلن روی User (planName/planStartedAt/planExpiresAt) را آپدیت می‌کند.
 *  - پاداش معرفی (referral) را در صورت وجود paymentId پردازش می‌کند — چون
 *    پرداخت واقعی این اشتراک حالا «نهایی» شده است (F10: پاداش فقط روی
 *    فعال‌سازی، نه روی خرید pending).
 *
 * Idempotent: اگر اشتراک pendingی نباشد (یا همزمان توسط فراخوان دیگری فعال
 * شده باشد) null برمی‌گرداند و هیچ تغییری نمی‌دهد.
 */
export async function activatePendingSubscription(userId: string, now = new Date()) {
  // v87 — علاوه بر pending داخل پنجره، اشتراک‌های «هرگز-فعال‌نشده» که پنجرهٔ
  // ۷روزه‌شان گذشته (lazy → expired) هم پذیرفته می‌شوند. قبلاً کاربری که
  // پیش‌نیازها را «دیرتر» از پنجره تکمیل می‌کرد اینجا null می‌گرفت → اشتراک
  // هرگز فعال نمی‌شد و کاربرِ پرداخت‌کرده بی‌پلن می‌ماند (همان باگ مالک).
  // گارد امنیتی داخل هلپر: startDate=null و cancelledAt=null یعنی حق خرید
  // واقعی و لغونشده — اشتراکِ حذف‌شده توسط ادمین هرگز بازفعال نمی‌شود.
  const pendingSub = await findNeverActivatedSubscription(userId);
  if (!pendingSub) return null;

  // طول دوره اصلی پلن — دوره pending (پنجره) با دوره واقعی جایگزین می‌شود
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + (pendingSub.durationDays || 45));

  // فعال‌سازی اتمیک — اگر همزمان فراخوان دیگری همین اشتراک را فعال کرده باشد،
  // count=0 برمی‌گردد و این فراخوان no-op است (idempotent).
  const claimed = await db.subscription.updateMany({
    where: { id: pendingSub.id, status: { in: ["pending", "expired"] }, startDate: null },
    data: { status: "active", startDate: now, endDate },
  });
  if (claimed.count === 0) return null;

  // به‌روزرسانی فیلدهای پلن روی User برای دسترسی سریع و gating
  await db.user.update({
    where: { id: userId },
    data: {
      planName: pendingSub.plan,
      planStartedAt: now,
      planExpiresAt: endDate,
    },
  });

  // ─── پاداش معرفی (F10) ───
  // خریدهای advanced/ultimate هنگام verify پاداش نمی‌گیرند (اشتراک pending است)؛
  // پاداش اینجا پردازش می‌شود چون حالا مشخص است اشتراک واقعاً فعال شده است.
  // اشتراک‌های اهدایی ادمین (paymentId=null) پاداش رفرال ندارند.
  if (pendingSub.paymentId) {
    try {
      await processReferralReward({
        buyerUserId: userId,
        paymentId: pendingSub.paymentId,
      });
    } catch (refErr) {
      // خطای پاداش نباید جلوی فعال‌سازی را بگیرد
      console.error("[subscription] referral reward failed on activation:", refErr);
    }
  }

  return { ...pendingSub, status: "active", startDate: now, endDate };
}
