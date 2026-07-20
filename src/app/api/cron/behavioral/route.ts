import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createNotification, ensureRenewalDiscountCode } from "@/lib/fitness/notifications";

/**
 * GET /api/cron/behavioral?secret=CRON_SECRET
 *
 * Behavioral marketing cron endpoint. Runs three scenarios:
 *  1) Basic plan users → upgrade notification
 *  2) Plan expires within 3 days → renewal reminder (+ auto per-user discount code)
 *  3) Inactive for 5+ days → re-engagement notification
 *
 * Each scenario creates notifications in the DB (deduped by a per-scenario window).
 * The endpoint is protected by CRON_SECRET — must match the secret in the query string.
 *
 * Returns a JSON summary of how many notifications were created per scenario.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET || "fitup-cron-secret-2025";

  if (secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // خلاصه گزارش cron — تمام فیلدهای سناریوها به‌صورت اختیاری تعریف شده‌اند چون در طول
  // اجرا به‌صورت پویا ست می‌شوند (با `if (!summary.x) summary.x = 0;`).
  const summary: {
    upgrade: number;
    renewal: number;
    reengagement: number;
    total: number;
    runAt: string;
    checkup?: number;
    expired?: number;
    renewalLate?: number;
    pendingReminder?: number;
    pendingAutoActivated?: number;
  } = {
    upgrade: 0,
    renewal: 0,
    reengagement: 0,
    total: 0,
    runAt: now.toISOString(),
  };

  // -------------------------------------------------------------------
  // Scenario 1: Users on basic plan → upgrade notification
  // Dedupe: don't send if they already got an "upgrade" notification in last 7 days
  // -------------------------------------------------------------------
  try {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const basicUsers = await db.user.findMany({
      where: {
        planName: "basic",
        isBlocked: false,
      },
      select: { id: true },
    });
    for (const u of basicUsers) {
      const recent = await db.notification.findFirst({
        where: { userId: u.id, type: "upgrade", createdAt: { gt: sevenDaysAgo } },
        select: { id: true },
      });
      if (recent) continue;
      await createNotification(
        u.id,
        "upgrade",
        "ارتقای پلن — مسیر سریع‌تر به هدف! 🚀",
        "با پلن پیشرفته به چت نامحدود با مربی هوشمند، حالت باشگاه و آنالیز عکس غذا/بدن دسترسی پیدا کنید. همین حالا ارتقا دهید.",
        "?tab=plans",
        { scenario: "upgrade", fromPlan: "basic" }
      );
      summary.upgrade++;
    }
  } catch (err) {
    console.error("[cron/behavioral] upgrade scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 2: Plan expires within 3 days → renewal reminder
  // Also auto-generates a per-user 20% renewal discount code (if not exists).
  // Dedupe: don't send if they got a "renewal" notification in last 2 days.
  // -------------------------------------------------------------------
  try {
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const expiringUsers = await db.user.findMany({
      where: {
        planExpiresAt: { gt: now, lt: inThreeDays },
        isBlocked: false,
      },
      select: { id: true, planName: true, mobile: true },
    });

    for (const u of expiringUsers) {
      const recent = await db.notification.findFirst({
        where: { userId: u.id, type: "renewal", createdAt: { gt: twoDaysAgo } },
        select: { id: true },
      });
      if (recent) continue;

      // Auto-generate per-user renewal discount code (FITAP15 = 15% off)
      const discount = await ensureRenewalDiscountCode(u.id, 15, 14);

      await createNotification(
        u.id,
        "renewal",
        "اشتراک شما به‌زودی منقضی می‌شود ⏰",
        discount
          ? `اشتراک ${u.planName ?? ""} شما در کمتر از ۳ روز منقضی می‌شود. با کد اختصاصی ${discount.code} (۱۵٪ تخفیف تمدید) همین حالا تمدید کنید.`
          : `اشتراک ${u.planName ?? ""} شما در کمتر از ۳ روز منقضی می‌شود. همین حالا تمدید کنید تا برنامه شما متوقف نشود.`,
        "?tab=plans",
        { scenario: "renewal", planName: u.planName, discountCode: discount?.code ?? null }
      );
      summary.renewal++;
    }
  } catch (err) {
    console.error("[cron/behavioral] renewal scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 3: Inactive for 5+ days → re-engagement notification
  // We use the most recent of: weight log, checkup, chat message, workout plan creation
  // to determine last activity. If no activity at all (or >5 days ago), send notification.
  // Dedupe: don't send if they got a "re_engagement" notification in last 7 days.
  // -------------------------------------------------------------------
  try {
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const candidates = await db.user.findMany({
      where: {
        isBlocked: false,
        onboardingDone: true,
        // Has any active or expired plan (engaged users)
        NOT: [{ planName: null }],
      },
      select: { id: true },
    });

    for (const u of candidates) {
      // Check for any recent notification to avoid spamming
      const recentNotif = await db.notification.findFirst({
        where: { userId: u.id, type: "re_engagement", createdAt: { gt: sevenDaysAgo } },
        select: { id: true },
      });
      if (recentNotif) continue;

      // Pull the most recent activity across multiple tables
      const [lastWeight, lastCheckup, lastChat, lastWorkoutPlan] = await Promise.all([
        db.weightLog.findFirst({
          where: { userId: u.id },
          orderBy: { loggedAt: "desc" },
          select: { loggedAt: true },
        }),
        db.checkup.findFirst({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        db.chatMessage.findFirst({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        db.workoutPlan.findFirst({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

      const timestamps = [
        lastWeight?.loggedAt,
        lastCheckup?.createdAt,
        lastChat?.createdAt,
        lastWorkoutPlan?.createdAt,
      ]
        .filter(Boolean)
        .map((t) => new Date(t as Date).getTime());

      const lastActivity = timestamps.length ? Math.max(...timestamps) : 0;

      // If last activity is older than 5 days (or no activity at all), send re-engagement
      if (lastActivity === 0 || lastActivity < fiveDaysAgo.getTime()) {
        await createNotification(
          u.id,
          "re_engagement",
          "وقتشه برگردی به مسیر! 💪",
          "چند روزی نیستی فعال بودی. یه تمرین کوتاه همین امروز می‌تونه انگیزه‌ت رو برگردونه. مربی هوشمندت منتظره!",
          "?tab=programs",
          { scenario: "re_engagement", daysSinceLastActivity: lastActivity ? Math.floor((now.getTime() - lastActivity) / (24 * 60 * 60 * 1000)) : null }
        );
        summary.reengagement++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] re-engagement scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 4: Checkup reminders — day 15, 30, 40 of the 45-day plan
  // Sends a notification reminding the user to do their periodic checkup.
  // Dedupe: don't send if they already got a "checkup_reminder" in last 5 days.
  // -------------------------------------------------------------------
  try {
    const fiveDaysAgoCheckup = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const activeUsers = await db.user.findMany({
      where: {
        planName: { not: null },
        planStartedAt: { not: null },
        isBlocked: false,
      },
      select: { id: true, planStartedAt: true, name: true },
    });

    for (const u of activeUsers) {
      if (!u.planStartedAt) continue;
      const daysSinceStart = Math.floor((now.getTime() - new Date(u.planStartedAt).getTime()) / (24 * 60 * 60 * 1000));

      // Checkup milestones: day 15, 30, 40 (±1 day tolerance)
      const isCheckupDay = [14, 15, 16, 29, 30, 31, 39, 40, 41].includes(daysSinceStart);
      if (!isCheckupDay) continue;

      // Determine which phase
      let phase = 1;
      let phaseLabel = "اول";
      if (daysSinceStart >= 29 && daysSinceStart <= 31) { phase = 2; phaseLabel = "دوم"; }
      else if (daysSinceStart >= 39 && daysSinceStart <= 41) { phase = 3; phaseLabel = "سوم (نهایی)"; }

      // Dedupe
      const recentCheckupNotif = await db.notification.findFirst({
        where: { userId: u.id, type: "checkup_reminder", createdAt: { gt: fiveDaysAgoCheckup } },
        select: { id: true },
      });
      if (recentCheckupNotif) continue;

      await createNotification(
        u.id,
        "checkup_reminder",
        `زمان چکاپ ${phaseLabel} فرا رسید! 📊`,
        `${u.name ?? "ورزشکار"} عزیز، روز ${toPersianDigitsFn(daysSinceStart)} از دوره ۴۵ روزه شماست. اکنون زمان چکاپ ${phaseLabel} است: وزن، اندازه‌های بدن و درصد چربی را ثبت کنید تا فیتاپ هوشمند پیشرفت شما را تحلیل کند. از بخش «پیشرفت» اقدام کنید.`,
        "?tab=progress",
        { scenario: "checkup_reminder", phase, daysSinceStart }
      );
      if (!summary.checkup) summary.checkup = 0;
      summary.checkup++;
    }
  } catch (err) {
    console.error("[cron/behavioral] checkup reminder scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 5: Plan just expired — send expiry notification + survey link
  // Checks if plan expired within the last 24 hours (cron runs daily).
  // Also: extend renewal discount code generation to expired users so they
  // get an actual per-user code in the notification (no hardcoded "FITAP15").
  // Sends a separate survey notification inviting the user to rate their plan.
  // Dedupe: don't send if they already got an "expired" notification.
  // -------------------------------------------------------------------
  try {
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyExpired = await db.subscription.findMany({
      where: {
        status: "active",
        endDate: { lt: now, gt: oneDayAgo },
      },
      select: { id: true, userId: true, plan: true, endDate: true, durationDays: true },
    });

    // Mark subscriptions as expired
    for (const sub of recentlyExpired) {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "expired" },
      });

      // Check if already notified
      const alreadyNotified = await db.notification.findFirst({
        where: { userId: sub.userId, type: "expired" },
        select: { id: true },
      });
      if (alreadyNotified) continue;

      // Generate (or fetch existing) per-user renewal discount code so the
      // notification includes the user's ACTUAL code, not a hardcoded "FITAP15".
      const discount = await ensureRenewalDiscountCode(sub.userId, 15, 14);
      const codeText = discount
        ? ` با کد ${discount.code} از ۱۵٪ تخفیف تمدید بهره‌مند شوید.`
        : "";

      await createNotification(
        sub.userId,
        "expired",
        "اشتراک شما منقضی شد ⚠️",
        `اشتراک ${sub.plan ?? ""} شما منقضی شد. برای ادامه تمرینات و دسترسی به مربی هوشمند، لطفاً پلن خود را تمدید کنید.${codeText}`,
        "?tab=plans",
        { scenario: "expired", planName: sub.plan, discountCode: discount?.code ?? null }
      );

      // ─── نظرسنجی پایان پلن (وظیفه ۷-الف) ───
      // یک نوتیف جداگانه با لینک به نظرسنجی ارسال می‌شود.
      // dedupe: اگر قبلاً نظرسنجی برای این کاربر ارسال شده، دوباره نفرست
      const alreadySurveyNotified = await db.notification.findFirst({
        where: { userId: sub.userId, type: "system", meta: { contains: '"survey_invite"' } },
        select: { id: true },
      });
      if (!alreadySurveyNotified) {
        await createNotification(
          sub.userId,
          "system",
          "نظر شما درباره فیتاپ مهم است 📝",
          `پلن ${sub.plan ?? ""} شما به پایان رسید. لطفاً چند ثانیه وقت بگذارید و نظرسنجی پایان پلن را پر کنید تا بتوانیم خدمات بهتری ارائه دهیم.`,
          "?survey=open",
          { scenario: "survey_invite", planName: sub.plan }
        );
      }

      if (!summary.expired) summary.expired = 0;
      summary.expired++;
    }
  } catch (err) {
    console.error("[cron/behavioral] expired scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 6: کاربران منقضی شده ۱۰ روزه — یادآوری تمدید با کد تخفیف
  // کاربرانی که اشتراکشان منقضی شده و ۱۰ روز گذشته ولی تمدید نکرده‌اند
  // نوتیف با کد تخفیف ۱۵٪ اختصاصی ارسال می‌شود
  // Dedupe: don't send if they got a "renewal_late" notification in last 7 days
  // -------------------------------------------------------------------
  try {
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const nineDaysAgo = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoLate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // کاربرانی که planExpiresAt بین ۱۰ تا ۹ روز پیش بوده (یعنی امروز دقیقاً ۱۰ روز از انقضا می‌گذرد)
    const lateExpiredUsers = await db.user.findMany({
      where: {
        planExpiresAt: { lt: nineDaysAgo, gt: tenDaysAgo },
        isBlocked: false,
      },
      select: { id: true, planName: true, mobile: true, planExpiresAt: true },
    });

    for (const u of lateExpiredUsers) {
      // چک کن آیا قبلاً نوتیف renewal_late گرفته
      const recent = await db.notification.findFirst({
        where: { userId: u.id, type: "renewal_late", createdAt: { gt: sevenDaysAgoLate } },
        select: { id: true },
      });
      if (recent) continue;

      // چک کن آیا کاربر تمدید کرده (اشتراک فعال جدید دارد)
      const hasNewActive = await db.subscription.findFirst({
        where: { userId: u.id, status: "active", endDate: { gt: now } },
        select: { id: true },
      });
      if (hasNewActive) continue; // کاربر تمدید کرده — نوتیف نفرست

      // تولید کد تخفیف اختصاصی ۱۵٪
      const discount = await ensureRenewalDiscountCode(u.id, 15, 14);

      await createNotification(
        u.id,
        "renewal_late",
        "یادآوری تمدید اشتراک — ۱۵٪ تخفیف 🎁",
        discount
          ? `اشتراک ${u.planName ?? ""} شما ۱۰ روز پیش منقضی شد. با کد اختصاصی ${discount.code} (۱۵٪ تخفیف) همین حالا تمدید کنید تا برنامه شما متوقف نشود.`
          : `اشتراک ${u.planName ?? ""} شما ۱۰ روز پیش منقضی شد. همین حالا تمدید کنید تا برنامه شما متوقف نشود.`,
        "?tab=plans",
        { scenario: "renewal_late", planName: u.planName, discountCode: discount?.code ?? null }
      );
      if (!summary.renewalLate) summary.renewalLate = 0;
      summary.renewalLate++;
    }
  } catch (err) {
    console.error("[cron/behavioral] renewal_late scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 7: مدیریت اشتراک‌های pending (advanced/ultimate بدون پیش‌نیاز)
  // این اشتراک‌ها با status="pending" و startDate/endDate=null ساخته شده‌اند.
  // اگر کاربر هرگز عکس بدن را آپلود نکند، اشتراک همیشه pending می‌ماند.
  // منطق:
  //   • ۷ روز پس از خرید pending → یادآوری ارسال عکس بدن (dedupe 7-day window).
  //   • ۳۰ روز پس از خرید pending → auto-activate با durationDays (معمولاً ۴۵ روز).
  //     اشتراک از این لحظه فعال می‌شود تا کاربر حداقل به‌اندازه روزهای باقی‌مانده از
  //     پلن خود بهره‌مند شود. ProgramRequest همچنان pending_body_photo می‌ماند تا
  //     اگر کاربر بعداً عکس بدن را آپلود کرد، برنامه ساخته شود (از submit-body-analysis).
  // -------------------------------------------------------------------
  try {
    const sevenDaysAgoPending = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoDedupe = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // (الف) یادآوری برای اشتراک‌های pending که بین ۷ تا ۳۰ روز از خرید گذشته
    const pendingReminders = await db.subscription.findMany({
      where: {
        status: "pending",
        createdAt: { lt: sevenDaysAgoPending, gt: thirtyDaysAgo },
      },
      select: { id: true, userId: true, plan: true, durationDays: true, createdAt: true },
    });

    for (const sub of pendingReminders) {
      // کاربر مسدود شده → skip
      const u = await db.user.findUnique({
        where: { id: sub.userId },
        select: { isBlocked: true },
      });
      if (u?.isBlocked) continue;

      // dedupe: اگر در ۷ روز گذشته نوتیف pending_reminder گرفته، نفرست
      const recent = await db.notification.findFirst({
        where: {
          userId: sub.userId,
          type: "system",
          createdAt: { gt: sevenDaysAgoDedupe },
          meta: { contains: '"pending_reminder"' },
        },
        select: { id: true },
      });
      if (recent) continue;

      const daysSincePurchase = Math.floor(
        (now.getTime() - new Date(sub.createdAt).getTime()) / (24 * 60 * 60 * 1000)
      );

      await createNotification(
        sub.userId,
        "system",
        "یادآوری: عکس بدن خود را ارسال کنید 📸",
        `پلن ${sub.plan ?? ""} شما ${toPersianDigitsFn(
          daysSincePurchase
        )} روز پیش فعال شد اما هنوز عکس‌های بدن خود را ارسال نکرده‌اید. برای شروع دوره ${toPersianDigitsFn(
          sub.durationDays ?? 45
        )} روزه و ساخت برنامه اختصاصی، لطفاً از بخش داشبورد عکس‌های بدن (۴ زاویه) را آپلود کنید.`,
        "?tab=dashboard",
        {
          scenario: "pending_reminder",
          planName: sub.plan,
          daysSincePurchase,
          subscriptionId: sub.id,
        }
      );
      if (!summary.pendingReminder) summary.pendingReminder = 0;
      summary.pendingReminder++;
    }

    // (ب) auto-activate برای اشتراک‌های pending که بیش از ۳۰ روز از خرید گذشته
    const stalePending = await db.subscription.findMany({
      where: {
        status: "pending",
        createdAt: { lt: thirtyDaysAgo },
      },
      select: { id: true, userId: true, plan: true, durationDays: true, createdAt: true },
    });

    for (const sub of stalePending) {
      // اشتراک را به active تبدیل کن با startDate=now و endDate=now + durationDays
      // durationDays معمولاً ۴۵ روز است. اگر از مدت زمان گذشته باشیم، همچنان این مدت
      // به کاربر داده می‌شود تا از ارزش پلن خود بهره‌مند شود.
      const startNow = new Date();
      const endNow = new Date();
      endNow.setDate(endNow.getDate() + (sub.durationDays || 45));

      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: "active",
          startDate: startNow,
          endDate: endNow,
        },
      });

      // به‌روزرسانی فیلدهای پلن روی User (اگر هنوز null یا کمتر است)
      try {
        const freshUser = await db.user.findUnique({
          where: { id: sub.userId },
          select: { planStartedAt: true, planExpiresAt: true, isBlocked: true },
        });
        if (freshUser && !freshUser.isBlocked) {
          const updateData: { planStartedAt?: Date; planExpiresAt?: Date; planName?: string } = {};
          if (!freshUser.planStartedAt) updateData.planStartedAt = startNow;
          if (!freshUser.planExpiresAt || freshUser.planExpiresAt.getTime() < endNow.getTime()) {
            updateData.planExpiresAt = endNow;
          }
          updateData.planName = sub.plan;
          if (Object.keys(updateData).length > 0) {
            await db.user.update({
              where: { id: sub.userId },
              data: updateData,
            });
          }
        }
      } catch (userErr) {
        console.error("[cron/behavioral] auto-activate user update failed:", userErr);
      }

      // نوتیف به کاربر مبنی بر فعال‌سازی خودکار
      await createNotification(
        sub.userId,
        "subscription",
        "اشتراک شما فعال شد ⏰",
        `پلن ${sub.plan ?? ""} شما بیش از ۳۰ روز در حالت انتظار (pending) بود. برای اینکه از ارزش پلن خود بهره‌مند شوید، اشتراک از همین حالا برای ${toPersianDigitsFn(
          sub.durationDays ?? 45
        )} روز فعال شد. هنوز هم می‌توانید از بخش داشبورد عکس بدن خود را ارسال کنید تا برنامه اختصاصی شما ساخته شود.`,
        "?tab=dashboard",
        {
          scenario: "pending_auto_activated",
          planName: sub.plan,
          durationDays: sub.durationDays,
          endDate: endNow.toISOString(),
          subscriptionId: sub.id,
        }
      );
      if (!summary.pendingAutoActivated) summary.pendingAutoActivated = 0;
      summary.pendingAutoActivated++;
    }
  } catch (err) {
    console.error("[cron/behavioral] pending subscription scenario failed:", err);
  }

  summary.total =
    summary.upgrade +
    summary.renewal +
    summary.reengagement +
    (summary.checkup || 0) +
    (summary.expired || 0) +
    (summary.renewalLate || 0) +
    (summary.pendingReminder || 0) +
    (summary.pendingAutoActivated || 0);
  return Response.json({ ok: true, ...summary });
}

// Simple Persian digit converter (to avoid importing from types in cron)
function toPersianDigitsFn(n: number | string): string {
  const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(n).replace(/[0-9]/g, (d) => persianDigits[parseInt(d)]);
}
