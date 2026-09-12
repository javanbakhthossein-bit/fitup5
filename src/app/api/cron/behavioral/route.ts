import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  createNotification,
  ensureRenewalDiscountCode,
  ensureOnboardingWinbackCode,
  ensureWelcomeOfferCode,
  getExpiryDiscountPercent,
  getOnboardingDiscountPercent,
  getWelcomeOfferDiscountPercent,
} from "@/lib/fitness/notifications";
import {
  sendCheckupReminderSms,
  sendExpiredWinbackSms,
  sendOnboardingNudgeSms,
  sendOnboardingWinbackSms,
  sendPlanExpiredSms,
  sendPlanExpiringSoonSms,
  sendRenewalBoostSms,
  sendWelcomeOfferSms,
} from "@/lib/fitness/sms-flows";
import { createSmsRenewLink } from "@/lib/fitness/sms-short-link";
import { runAbandonedCartScenario } from "@/lib/fitness/abandoned-cart-scenario";
import { recoverFailedGenerations } from "@/lib/fitness/program-generation";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/fitness/rate-limit";

/**
 * GET /api/cron/behavioral?secret=CRON_SECRET
 *
 * Behavioral marketing cron endpoint. Runs these scenarios:
 *  1) Basic plan users → upgrade notification
 *  2) Plan expires within 3 days → renewal reminder (+ auto per-user discount code)
 *  3) Inactive for 5+ days → re-engagement notification
 *  … (سناریوهای ۴ تا ۹.۵ — چکاپ/انقضا/وین‌بک/خوش‌آمدگویی — به‌همراه ۱۰: ترک درگاه)
 *  10) v53 — ترک درگاه پرداخت: پیامک «کد ۲۴۸۹۴۵» (درصد/قالب از SiteSetting) +
 *      کد تخفیف ۲ساعته + لینک کوتاه ?offer= به صفحهٔ پلن‌ها
 *
 * Each scenario creates notifications in the DB (deduped by a per-scenario window).
 * The endpoint is protected by CRON_SECRET — must match the secret in the query string
 * (fail-secure: اگر CRON_SECRET تنظیم نشده باشد، ۴۰۱ برمی‌گردد).
 *
 * Returns a JSON summary of how many notifications were created per scenario.
 */
export async function GET(req: NextRequest) {
  // ─── Rate limit (per-IP) — ضد brute-force روی secret ───
  const rl = rateLimit(`cron-behavioral:${getClientIp(req)}`, 30, 60 * 1000);
  if (!rl.ok) {
    return rateLimitResponse(rl.retryAfterSec);
  }

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
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
    onboardingNudge?: number;
    onboardingWinback?: number;
    welcomeOffer?: number;
    renewalBoost?: number;
    planExpiring?: number;
    programRetry?: number;
    smsSent?: number;
    abandonedCart?: number;
    abandonedCartSkipped?: number;
  } = {
    upgrade: 0,
    renewal: 0,
    reengagement: 0,
    total: 0,
    welcomeOffer: 0,
    renewalBoost: 0,
    runAt: now.toISOString(),
  };

  // -------------------------------------------------------------------
  // Scenario 1: Users on basic plan → upgrade notification
  // Dedupe: don't send if they already got an "upgrade" notification in last 14 days
  // (v48: ۷ روز → ۱۴ روز — ممیزی نوتیف‌ها به درخواست مالک: نویز تکراری کمتر)
  // -------------------------------------------------------------------
  try {
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const basicUsers = await db.user.findMany({
      where: {
        planName: "basic",
        isBlocked: false,
      },
      select: { id: true },
    });
    for (const u of basicUsers) {
      const recent = await db.notification.findFirst({
        where: { userId: u.id, type: "upgrade", createdAt: { gt: fourteenDaysAgo } },
        select: { id: true },
      });
      if (recent) continue;
      await createNotification(
        u.id,
        "upgrade",
        "مسیرت می‌تونه سریع‌تر باشه 🚀",
        "چت بی‌نهایت با فیتاپ هوشمند، آنالیز عکس غذا و حالت باشگاه توی پلن پیشرفته منتظرته. هر وقت خواستی سریع‌تر به هدفت برسی، ارتقا بده.",
        "?tab=plans",
        { scenario: "upgrade", fromPlan: "basic" }
      );
      summary.upgrade++;
    }
  } catch (err) {
    console.error("[cron/behavioral] upgrade scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // v53 (درخواست مالک): نوتیف ارتقای داینامیک برای «پیشرفته به پایین» —
  // قبلاً فقط basic پیام ارتقا می‌گرفت؛ حالا استاندارد و پیشرفته هم بسته به
  // پلن جاری، پیام متناسب با پلن بعدی می‌گیرند (همان dedupe ۱۴ روزه).
  // -------------------------------------------------------------------
  try {
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const upgradeTargets: { from: string; title: string; body: string }[] = [
      {
        from: "standard",
        title: "یک پله تا پلن پیشرفته 🚀",
        body: "با پلن پیشرفته، چت بی‌نهایت با فیتاپ هوشمند، آنالیز عکس غذا و حالت باشگاه فعال می‌شود — مسیر رسیدن به هدفت رو سریع‌تر کن.",
      },
      {
        from: "advanced",
        title: "سقفت رو جلو ببر 💪",
        body: "پلن حرفه‌ای: آنالیز ویدیو حرکات به تعداد حرکات برنامه‌ات، حالت باشگاه کامل و امکانات ویژهٔ حرفه‌ای‌ها — برای نتیجهٔ جدی‌تر، ارتقا بده.",
      },
    ];
    for (const t of upgradeTargets) {
      const users = await db.user.findMany({
        where: { planName: t.from, isBlocked: false },
        select: { id: true },
      });
      for (const u of users) {
        const recent = await db.notification.findFirst({
          where: { userId: u.id, type: "upgrade", createdAt: { gt: fourteenDaysAgo } },
          select: { id: true },
        });
        if (recent) continue;
        await createNotification(
          u.id,
          "upgrade",
          t.title,
          t.body,
          "?tab=plans",
          { scenario: "upgrade", fromPlan: t.from }
        );
        summary.upgrade++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] upgrade scenario (standard/advanced) failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 2: Plan expires within 3 days → renewal reminder
  // ─── v38 (درخواست مالک): هیچ حرفی از کد تخفیف در این مرحله نیست —
  // کد تخفیف تمدید فقط در سناریوی ۷۲ ساعت بعد از انقضا (سناریو ۶) فعال و
  // ارسال می‌شود؛ قبل از آن نه ساخته می‌شود نه نمایش داده می‌شود.
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
      select: { id: true, planName: true, mobile: true, planExpiresAt: true },
    });

    for (const u of expiringUsers) {
      const recent = await db.notification.findFirst({
        where: { userId: u.id, type: "renewal", createdAt: { gt: twoDaysAgo } },
        select: { id: true },
      });
      if (recent) continue;

      await createNotification(
        u.id,
        "renewal",
        `${toPersianDigitsFn(Math.max(1, Math.ceil((new Date(u.planExpiresAt ?? now).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))))} روز تا پایان پلن ${PLAN_LABELS_FN[u.planName ?? ""] ?? ""} ⏳`,
        `اگه گل نزنی، روزهای باقی‌مانده‌ت موقع تمدید حفظ می‌شه. از صفحه تمدید، با یک کلیک کارت را تمام کن.`,
        "?renewal=1",
        { scenario: "renewal", planName: u.planName }
      );
      summary.renewal++;
    }
  } catch (err) {
    console.error("[cron/behavioral] renewal scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 2b (v37): یک روز تا انقضا → پیامک 184777 + نوتیف + لینک تمدید مجزا
  // درخواست مالک: پیامک «پلن فعلی شما فردا منقضی میشود…» با لینک اختصاصی تمدید
  // (/renew?t=...) که کاربر بدون لاگین، پرداخت سریع را انجام دهد.
  // پنجره: اشتراک‌های فعال با endDate در (now, now+30h] — کرون هر ۳۰ دقیقه
  // اجرا می‌شود، پس پیامک وقتی می‌رسد که تقریباً «فردا» انقضا است.
  // دداپ پیامک: SmsLog ابدی با کلید plan_expiring_{subId} — هر چرخه یک بار.
  // دداپ نوتیف: نوع renewal در ۲۴ ساعت اخیر (مستقل از سناریوی ۳ روزهٔ بالا).
  // -------------------------------------------------------------------
  try {
    const in30h = new Date(now.getTime() + 30 * 60 * 60 * 1000);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const expiringSubs = await db.subscription.findMany({
      where: { status: "active", endDate: { gt: now, lt: in30h } },
      select: { id: true, userId: true, plan: true, endDate: true },
    });

    for (const sub of expiringSubs) {
      const u = await db.user.findUnique({
        where: { id: sub.userId },
        select: { id: true, name: true, mobile: true, isBlocked: true },
      });
      if (!u || u.isBlocked || !u.mobile) continue;

      // در میدیان ارتقا/خرید جدید؟ (اشتراک pending تازه یا پرداخت در جریان) → مزاحم نشو
      const midUpgrade = await db.subscription.findFirst({
        where: { userId: u.id, status: "pending", createdAt: { gt: last3d } },
        select: { id: true },
      });
      if (midUpgrade) continue;
      const pendingPayment = await db.payment.findFirst({
        where: {
          userId: u.id,
          status: { in: ["pending", "verifying"] },
          createdAt: { gt: last24h },
        },
        select: { id: true },
      });
      if (pendingPayment) continue;

      // ─── پیامک 184777 با لینک تمدید مجزا ───
      // v48 — لینک کوتاه r/XXXXXXXX (≤۲۵ کاراکتر — فیکس خطای 114)؛ /r به go/renew
      // هدایت می‌کند → لینک هوشمند اپ حفظ است
      const renewLink = await createSmsRenewLink(u.id, sub.id);
      try {
        const smsRes = await sendPlanExpiringSoonSms(
          { id: u.id, name: u.name, mobile: u.mobile },
          renewLink,
          sub.id
        );
        if (smsRes.sent) {
          if (!summary.smsSent) summary.smsSent = 0;
          summary.smsSent++;
        }
      } catch (smsErr) {
        console.error("[cron/behavioral] plan_expiring_soon SMS failed:", smsErr);
      }

      // ─── نوتیف همزمان (سایت + اپ اختصاصی + اپ بازار + وب‌اپ) ───
      const recentRenewNotif = await db.notification.findFirst({
        where: { userId: u.id, type: "renewal", createdAt: { gt: last24h } },
        select: { id: true },
      });
      if (!recentRenewNotif) {
        await createNotification(
          u.id,
          "renewal",
          "فردا پلنت تموم می‌شه ⏳",
          `پلن ${PLAN_LABELS_FN[sub.plan ?? ""] ?? ""} شما فردا منقضی می‌شود. با یک پرداخت از لینک تمدید، پلن جدیدت خودکار فعال می‌شود — روزهای باقی‌ماندهٔ فعلی هم حفظ می‌شود.`,
          "?renewal=1",
          { scenario: "renewal_tomorrow", planName: sub.plan }
        );
        if (!summary.planExpiring) summary.planExpiring = 0;
        summary.planExpiring++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] plan expiring soon scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 3: واقعاً غایب بوده → اعلان بازگشت
  // ─── FIX (گزارش کاربر): «با اینکه مداوم از اپ استفاده می‌کنم بازم میاد» ───
  // ریشه: قبلاً «آخرین فعالیت» فقط از ثبت وزن/چکاپ/چت/ساخت برنامه خوانده
  // می‌شد؛ کاربری که هر روز اپ را باز می‌کرد ولی چیزی ثبت نمی‌کرد «غایب»
  // تلقی می‌شد. حالا سیگنال اصلی = user.lastActiveAt است که در هر باز شدن
  // اپ/سایت (api/auth/me با throttle) و هر لاگین (verify-otp) به‌روز می‌شود.
  // سیگنال‌های مکمل (پرکار بودن واقعی): وزن، چکاپ، چت، برنامه، لاگ غذا،
  // وضعیت روز تمرین. آستانه هم ۵→۷ روز افزایش یافت و متن انسانی شد.
  // فقط وقتی پیام می‌رود که کاربر واقعاً ۷+ روز هیچ نسبتی با فیتاپ نداشته.
  // Dedupe: حداکثر یک re_engagement در هر ۷ روز.
  // -------------------------------------------------------------------
  try {
    const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = new Date(sevenDaysAgoMs);

    const candidates = await db.user.findMany({
      where: {
        isBlocked: false,
        onboardingDone: true,
        // Has any active or expired plan (engaged users)
        NOT: [{ planName: null }],
      },
      select: { id: true, name: true, lastActiveAt: true },
    });

    for (const u of candidates) {
      // Check for any recent notification to avoid spamming
      const recentNotif = await db.notification.findFirst({
        where: { userId: u.id, type: "re_engagement", createdAt: { gt: sevenDaysAgo } },
        select: { id: true },
      });
      if (recentNotif) continue;

      // اگر کاربر این هفته اپ/سایت را باز کرده → قطعااً فعال است، رد شو
      if (u.lastActiveAt && new Date(u.lastActiveAt).getTime() >= sevenDaysAgoMs) {
        continue;
      }

      // Pull the most recent activity across multiple tables (سیگنال‌های مکمل)
      const [lastWeight, lastCheckup, lastChat, lastWorkoutPlan, lastFoodLog, lastWorkoutDay] = await Promise.all([
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
        db.foodLog.findFirst({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        db.workoutDayStatus.findFirst({
          where: { userId: u.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);

      const timestamps = [
        u.lastActiveAt, // سیگنال اصلی — باز کردن اپ
        lastWeight?.loggedAt,
        lastCheckup?.createdAt,
        lastChat?.createdAt,
        lastWorkoutPlan?.createdAt,
        lastFoodLog?.createdAt,
        lastWorkoutDay?.createdAt,
      ]
        .filter(Boolean)
        .map((t) => new Date(t as Date).getTime());

      const lastActivity = timestamps.length ? Math.max(...timestamps) : 0;

      // اگر هیچ فعالیتی ثبت نشده (کاربر قدیمی قبل از lastActiveAt)، برای اولین
      // بار lastActiveAt را seed کن تا نوبت بعدی درست سنجیده شود؛ این دفعه
      // پیام نفرست (اطمینان از عدم اسپم برای داده‌ی قدیمی)
      if (lastActivity === 0) {
        try {
          await db.user.update({
            where: { id: u.id },
            data: { lastActiveAt: now },
          });
        } catch {}
        continue;
      }

      // فقط وقتی پیام بفرست که واقعاً ۷+ روز از آخرین رابطه گذشته است
      if (lastActivity < sevenDaysAgoMs) {
        const days = Math.floor((now.getTime() - lastActivity) / (24 * 60 * 60 * 1000));
        const firstName = (u.name || "").trim().split(" ")[0];
        const who = firstName ? `${firstName}، ` : "";
        await createNotification(
          u.id,
          "re_engagement",
          // v36 — عنوان برندشده (رفع پرچم اسپم کروم): عبارت «دنبالت بودیم» شبیه
          // پیام شخصی/چت بود — الگوی کلاسیک اعلان گمراه‌کننده برای طبقه‌بند
          // «abusive notifications» گوگل. حالا صریحاً برند فیتاپ + لحن اعلانی.
          `${who}یادآوری فیتاپ: وقت برگشتنه 🧡`,
          days >= 10
            ? `حدود ${toPersianDigitsFn(days)} روزه فیتاپ رو باز نکردی. برنامه‌ات سر جاشه و جایی نمی‌ره؛ با یه جلسه‌ی سبکِ همین امروز، دقیقاً از همون‌جایی که رها کردی ادامه بده.`
            : `چند روزه غایبی. بدنت هنوز چیزی از دست نداده — فقط یه تمرین کوتاهِ امروز لازمه تا دوباره ببندیش رو مسیر.`,
          "?tab=programs",
          { scenario: "re_engagement", daysSinceLastActivity: days }
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
        `${u.name ?? "ورزشکار"} عزیز، روز ${toPersianDigitsFn(daysSinceStart)} از دوره ۴۵ روزه شماست. اکنون زمان چکاپ ${phaseLabel} است: وزن، اندازه‌های بدن و درصد چربی را ثبت کنید تا فیتاپ هوشمند پیشرفت شما را تحلیل کند. با لمس این اعلان مستقیماً به بخش چکاپ می‌روید.`,
        // v15: لینک مستقیم به بخش چکاپ (اسکرول خودکار به کارت چکاپ در تب پیشرفت)
        "?tab=progress&section=checkup",
        { scenario: "checkup_reminder", phase, daysSinceStart }
      );

      // ─── پیامک همزمان (قالب 761137 — متغیر NAME) — درخواست مالک v32 ───
      // همان لحظه که نوتیف چکاپ می‌رود، پیامک هم می‌رود (داپ ابدی با SmsLog).
      const smsUser = await db.user.findUnique({
        where: { id: u.id },
        select: { id: true, name: true, mobile: true },
      });
      if (smsUser) {
        // v66 — دداپ بر (شروع دوره + شمارهٔ چکاپ): قبلاً کلید ثابت بود و چکاپ‌ها
        // فقط «یک بار در عمر» پیامک می‌رفتند؛ در دورهٔ بعدی ۴۵ روزه هرگز.
        const checkupSmsSuffix = `${new Date(u.planStartedAt)
          .toISOString()
          .slice(0, 10)}_p${phase}`;
        const smsRes = await sendCheckupReminderSms(smsUser, checkupSmsSuffix);
        if (smsRes.sent) {
          if (!summary.smsSent) summary.smsSent = 0;
          summary.smsSent++;
        }
      }

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
      // Dedupe فقط در پنجره‌ی ۶۰ روز اخیر — قبلاً برای «همیشه» دداپ می‌شد و
      // انقضای اشتراک دوم کاربر دیگر هرگز اطلاع‌رسانی نمی‌گرفت.
      const expiredDedupStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const alreadyNotified = await db.notification.findFirst({
        where: {
          userId: sub.userId,
          type: "expired",
          createdAt: { gt: expiredDedupStart },
        },
        select: { id: true },
      });
      if (alreadyNotified) continue;

      // ─── v38 (درخواست مالک): در لحظهٔ انقضا هیچ کد تخفیفی ساخته/اعلام نمی‌شود —
      // کد تخفیف و پیامک آن فقط در سناریوی ۶ (۷۲ ساعت بعد از انقضا) فعال می‌شود.
      await createNotification(
        sub.userId,
        "expired",
        `پلن ${PLAN_LABELS_FN[sub.plan ?? ""] ?? ""} تمام شد ⏸`,
        "پیشرفتت از بین نرفته. برنامه‌ات آماده‌ست منتظرت بمونه — از صفحه تمدید با یک کلیک دوباره روشن‌ش کن.",
        "?renewal=1",
        { scenario: "expired", planName: sub.plan }
      );

      // ─── پیامک همزمان انقضا (قالب 322780 — متغیر NAME + LINK) — درخواست مالک v32/v37 ───
      // دقیقاً همزمان با منقضی شدن پلن و نوتیف انقضا ارسال می‌شود (داپ با کلید
      // plan_expired_{subId} — هر چرخهٔ اشتراک یک بار). لینک = صفحهٔ تمدید مجزا.
      try {
        const smsUser = await db.user.findUnique({
          where: { id: sub.userId },
          select: { id: true, name: true, mobile: true },
        });
        if (smsUser) {
          // v48 — لینک کوتاه r/… (≤۲۵ کاراکتر) → /go/renew — اپ باز می‌شود، نه مرورگر
          const renewLink = await createSmsRenewLink(sub.userId, sub.id);
          const smsRes = await sendPlanExpiredSms(smsUser, renewLink, sub.id);
          if (smsRes.sent) {
            if (!summary.smsSent) summary.smsSent = 0;
            summary.smsSent++;
          }
        }
      } catch (smsErr) {
        console.error("[cron/behavioral] plan_expired SMS failed:", smsErr);
      }

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
  // Scenario 6: کاربران منقضی ۷۲ ساعته — یادآوری تمدید + پیامک (قالب 604678)
  // ─── v32 (درخواست مالک): قبلاً این نوتیف ۱۰ روز بعد از انقضا می‌رفت؛
  // حالا دقیقاً ۷۲ ساعت (۳ روز) بعد از انقضا — هم‌زمان با پیامک 604678 —
  // هر دو با یک کد تخفیف اختصاصی (درصد قابل تغییر از پنل مدیر) سینک هستند.
  // Dedupe: نوتیف renewal_late (پنجرهٔ ۷ روزه) + پیامک (داپ ابدی SmsLog)
  // -------------------------------------------------------------------
  try {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoLate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // کاربرانی که planExpiresAt بین ۴ تا ۳ روز پیش بوده (یعنی امروز ۷۲ ساعت از انقضا می‌گذرد)
    const lateExpiredUsers = await db.user.findMany({
      where: {
        planExpiresAt: { lt: threeDaysAgo, gt: fourDaysAgo },
        isBlocked: false,
      },
      select: { id: true, name: true, mobile: true, planName: true, planExpiresAt: true },
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
      if (hasNewActive) continue; // کاربر تمدید کرده — نوتیف/پیامک نفرست

      // تولید کد تخفیف اختصاصی (درصد از پنل مدیر — پیش‌فرض ۳۰ v47)
      // v53 — اعتبار ۱۴ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
      const percent = await getExpiryDiscountPercent();
      const discount = await ensureRenewalDiscountCode(u.id, percent, 2);
      const percentFa = toPersianDigitsFn(percent);

      await createNotification(
        u.id,
        "renewal_late",
        "هنوز می‌شه ادامه داد 🎁",
        discount
          ? `۷۲ ساعت از پایان پلن ${PLAN_LABELS_FN[u.planName ?? ""] ?? ""} می‌گذره؛ برنامه‌ات هنوز سر جاش است. با کد ${discount.code} (${percentFa}٪ تخفیف) دوباره روشن‌ش کن.`
          : `۷۲ ساعت از پایان پلن ${PLAN_LABELS_FN[u.planName ?? ""] ?? ""} می‌گذره؛ برنامه‌ات هنوز سر جاش است. دوباره روشن‌ش کن.`,
        "?renewal=1",
        { scenario: "renewal_late_72h", planName: u.planName, discountCode: discount?.code ?? null }
      );

      // ─── پیامک همزمان (قالب 604678 — NAME + CODE + LINK) — دقیقاً ۷۲ ساعت بعد از انقضا ───
      // v37: لینک تمدید مجزا (/renew?t=...) + دداپ چرخه‌ای با شناسهٔ اشتراک منقضی
      if (discount) {
        try {
          const lastExpiredSub = await db.subscription.findFirst({
            where: { userId: u.id, status: "expired" },
            orderBy: { endDate: "desc" },
            select: { id: true },
          });
          const cycleId = lastExpiredSub?.id ?? u.id;
          // v48 — لینک کوتاه r/… (فیکس خطای 114) → /go/renew (لینک هوشمند اپ)
          const renewLink = await createSmsRenewLink(u.id, cycleId);
          const smsRes = await sendExpiredWinbackSms(
            { id: u.id, name: u.name, mobile: u.mobile },
            discount.code,
            renewLink,
            cycleId
          );
          if (smsRes.sent) {
            if (!summary.smsSent) summary.smsSent = 0;
            summary.smsSent++;
          }
        } catch (smsErr) {
          console.error("[cron/behavioral] expired_winback SMS failed:", smsErr);
        }
      }

      if (!summary.renewalLate) summary.renewalLate = 0;
      summary.renewalLate++;
    }
  } catch (err) {
    console.error("[cron/behavioral] renewal_late scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 6.5 (v47): پیامک تقویت تمدید — قالب 883325 (دیریکتیو مالک)
  // «۸ روز از زمان تمدید پلنت گذشته، با تغییر برنامه به بدنت شوک بده.»
  // دقیقاً ۸ روز بعد از انقضای پلن — نردبان دوم تمدید بعد از پیامک 604678
  // (۷۲ ساعت). همان کد تخفیف renewal_loyalty (ensure دوباره صداش می‌زند و
  // اگر کد قبلی استفاده نشده باشد همان را با درصدِ به‌روزِ پنل مدیر سینک
  // می‌کند) → درصد پیامک و صفحهٔ تمدید همیشه یکی است.
  // لینک = go/renew?t=... → لینک هوشمند (اپ باز می‌شود، نه مرورگر).
  // Dedupe ابدی: SmsLog (mobile, renewal_boost_{cycleId}).
  // -------------------------------------------------------------------
  try {
    const eightDaysAgoB = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const nineDaysAgoB = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);

    const boostUsers = await db.user.findMany({
      where: {
        planExpiresAt: { lt: eightDaysAgoB, gt: nineDaysAgoB },
        isBlocked: false,
      },
      select: { id: true, name: true, mobile: true, planName: true },
      take: 200,
    });

    for (const u of boostUsers) {
      // کاربر تمدید کرده → هیچ پیامی نرو
      const hasNewActive = await db.subscription.findFirst({
        where: { userId: u.id, status: "active", endDate: { gt: now } },
        select: { id: true },
      });
      if (hasNewActive) continue;

      const percent = await getExpiryDiscountPercent();
      // v53 — اعتبار ۱۴ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
      const discount = await ensureRenewalDiscountCode(u.id, percent, 2);
      if (!discount) continue; // کد قبلی استفاده شده یا کاربر خریدش را کرده

      const lastExpiredSub = await db.subscription.findFirst({
        where: { userId: u.id, status: "expired" },
        orderBy: { endDate: "desc" },
        select: { id: true },
      });
      const cycleId = lastExpiredSub?.id ?? u.id;
      // v48 — لینک کوتاه r/… (فیکس خطای 114) → /go/renew (لینک هوشمند اپ)
      const renewLink = await createSmsRenewLink(u.id, cycleId);

      const smsRes = await sendRenewalBoostSms(
        { id: u.id, name: u.name, mobile: u.mobile },
        discount.code,
        renewLink,
        cycleId
      );

      // نوتیف هم‌خانواده (متن هماهنگ با پیامک 883325) — فقط وقتی پیامک رفت
      if (smsRes.sent) {
        try {
          await createNotification(
            u.id,
            "renewal_boost",
            "با تغییر برنامه به بدنت شوک بده ⚡",
            `با کد ${discount.code} (${toPersianDigitsFn(percent)}٪ تخفیف) پلنت رو دوباره روشن کن و برنامهٔ ورزشی جدیدت رو بگیر.`,
            "?renewal=1",
            { scenario: "renewal_boost_8d", planName: u.planName, discountCode: discount.code }
          );
        } catch (notifErr) {
          console.warn("[cron/behavioral] renewal_boost notif failed:", notifErr);
        }
        if (!summary.renewalBoost) summary.renewalBoost = 0;
        summary.renewalBoost++;
        if (!summary.smsSent) summary.smsSent = 0;
        summary.smsSent++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] renewal_boost scenario failed:", err);
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
    // ─── FIX (ممیزی 2-a باگ #2) ───
    // قبلاً: هر pending قدیمی‌تر از ۳۰ روز صرف‌نظر از endDate فعال می‌شد با مدت
    // کامل تازه + planName کاربر بی‌قیدوشرط بازنویسی می‌شد (می‌توانست پلن فعالِ
    // بالاتر را «داگرِید» کند). حالا:
    //  ۱) فقط pendings با endDate=null (هنوز پنجرهشان باز است) یا endDate>now
    //  ۲) اگر کاربر اشتراک active با تیر ≥ همین پلن دارد → فیلدهای User دست‌نخورده
    const stalePending = await db.subscription.findMany({
      where: {
        status: "pending",
        createdAt: { lt: thirtyDaysAgo },
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: { id: true, userId: true, plan: true, durationDays: true, createdAt: true },
    });

    // رتبه تیر پلن‌ها برای مقایسه برتری
    const PLAN_TIER: Record<string, number> = { basic: 1, standard: 2, advanced: 3, ultimate: 4 };

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

      // به‌روزرسانی فیلدهای پلن روی User — فقط اگر اشتراک فعالِ برتر ندارد
      try {
        const freshUser = await db.user.findUnique({
          where: { id: sub.userId },
          select: { planStartedAt: true, planExpiresAt: true, isBlocked: true },
        });
        if (freshUser && !freshUser.isBlocked) {
          const betterActive = await db.subscription.findFirst({
            where: {
              userId: sub.userId,
              status: "active",
              endDate: { gt: new Date() },
              id: { not: sub.id },
            },
            orderBy: { endDate: "desc" },
          });
          const newTier = PLAN_TIER[sub.plan] ?? 0;
          const activeTier = betterActive ? (PLAN_TIER[betterActive.plan] ?? 0) : 0;
          const hasBetter = !!betterActive && activeTier >= newTier;
          if (!hasBetter) {
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

  // -------------------------------------------------------------------
  // Scenario 8: پیامک آنبوردینگ ناتمام (قالب 669068 — متغیر NAME)
  // کاربری که موبایلش ثبت شده (و OTP گرفته) ولی آنبوردینگ را تکمیل نکرده —
  // ۳۰ دقیقه بعد از ثبت موبایل و خروج، یک پیامک دعوت به تکمیل می‌گیرد.
  // پنجره: ۳۰ دقیقه تا ۷ روز بعد از ثبت (کاربران قدیمی‌تر با backfill یک‌بار
  // پیامک می‌گیرند). Dedupe ابدی: SmsLog (mobile, onboarding_nudge).
  // v43 — دیریکتیو جدید مالک: کاربرِ بدونِ نام هم پیامک می‌گیرد و به‌جای NAME
  // «ورزشکار» نوشته می‌شود («بجای اینکه متغیر نیم رو خالی بذاری یا پیامک
  // نفرستی، پیامک بفرست و بنویس ورزشکار») — فیلتر نامِ v42 حذف شد. فال‌بک
  // در خود flow + گارد مرکزی sendTemplateSms لایهٔ دوم تضمین است.
  // -------------------------------------------------------------------
  try {
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    // v48 — پنجره ۷ روز → ۹۰ روز: کاربرانِ ناتمامِ قدیمی‌تر هم (با دداپ ابدی،
    // فقط یک‌بار در عمرشان) پیامک دعوت به آنبوردینگ می‌گیرند — گزارش مالک
    const ninetyDaysAgoNudge = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const nudgeUsers = await db.user.findMany({
      where: {
        onboardingDone: false,
        isBlocked: false,
        createdAt: { lt: thirtyMinAgo, gt: ninetyDaysAgoNudge },
      },
      select: { id: true, name: true, mobile: true },
      take: 300,
    });

    for (const u of nudgeUsers) {
      const smsRes = await sendOnboardingNudgeSms(u);
      if (smsRes.sent) {
        // v37: نوتیف همزمان با پیامک (فقط وقتی پیامک واقعاً می‌رود — ضد اسپم)
        try {
          await createNotification(
            u.id,
            "system",
            "هنوز شروع نکردی؟ 💪",
            "پروفایل فیتاپ تو منتظره — چند دقیقه وقت بذار و آنبوردینگ را تمام کن تا برنامه‌ی اختصاصی بدنت ساخته شود.",
            undefined
          );
        } catch (notifErr) {
          console.warn("[cron/behavioral] onboarding nudge notif failed:", notifErr);
        }
        if (!summary.onboardingNudge) summary.onboardingNudge = 0;
        summary.onboardingNudge++;
        if (!summary.smsSent) summary.smsSent = 0;
        summary.smsSent++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] onboarding_nudge SMS scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 9: پیامک بازگشت بعد از آنبوردینگ (قالب 461291 — NAME + CODE)
  // کاربری که آنبوردینگ را تکمیل کرده ولی ۲۴ ساعت بعد هنوز هیچ پلنی نخریده —
  // یک کد تخفیف اختصاصی (درصد از پنل مدیر، یک‌بارمصرفِ خرید اول) + پیامک می‌گیرد.
  // پنجره: ۲۴ تا ۴۸ ساعت بعد از onboardingCompletedAt (قدیمی‌ترها: backfill).
  // Dedupe ابدی: SmsLog (mobile, onboarding_winback).
  // -------------------------------------------------------------------
  try {
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const winbackUsers = await db.user.findMany({
      where: {
        onboardingDone: true,
        onboardingCompletedAt: { lte: twentyFourHoursAgo, gt: fortyEightHoursAgo },
        isBlocked: false,
        planName: null,
      },
      select: { id: true, name: true, mobile: true },
      take: 200,
    });

    for (const u of winbackUsers) {
      // فقط کسانی که هرگز اشتراکی نداشته‌اند (خرید اول)
      const subsCount = await db.subscription.count({ where: { userId: u.id } });
      if (subsCount > 0) continue;

      const percent = await getOnboardingDiscountPercent();
      // v53 — اعتبار ۳۰ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
      const discount = await ensureOnboardingWinbackCode(u.id, percent, 2);
      if (!discount) continue;

      const smsRes = await sendOnboardingWinbackSms(u, discount.code);
      if (smsRes.sent) {
        // v37: نوتیف همزمان با پیامک (فقط وقتی پیامک واقعاً می‌رود — ضد اسپم)
        try {
          await createNotification(
            u.id,
            "system",
            "هدیه‌ی شروع در انتظارته 🎁",
            `کد تخفیف یک‌بارمصرف ${discount.code} (${toPersianDigitsFn(percent)}٪) برای اولین خرید پلن فیتاپ فعال است — تا ۴۸ ساعت اعتبار دارد.`,
            "?tab=plans",
            { scenario: "onboarding_winback", discountCode: discount.code }
          );
        } catch (notifErr) {
          console.warn("[cron/behavioral] onboarding winback notif failed:", notifErr);
        }
        if (!summary.onboardingWinback) summary.onboardingWinback = 0;
        summary.onboardingWinback++;
        if (!summary.smsSent) summary.smsSent = 0;
        summary.smsSent++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] onboarding_winback SMS scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 9.5 (v47): پیامک خوش‌آمدگویی خرید — قالب 612964 (دیریکتیو مالک)
  // «یک پیام با تمپلیت 612964 بساز برای دقیقا ۸ روز بعد از ثبت شماره موبایل»
  //
  // پنجره: دقیقاً ۸ روز بعد از User.createdAt (ثبت موبایل) — نه وابسته به
  // آنبوردینگ (چون ممکن است هنوز تکمیل نکرده باشد).
  //
  // NAME — دیریکتیو صریح مالک:
  //   «اگر کاربر آنبوردینگ رو تکمیل نکرده بود بجای متغیر نیم باید بنویسی
  //    ورزشکار و در صورت تکمیل اسمش رو.»
  //
  // CODE: کد اختصاصی reason=welcome_offer با درصد welcome_offer_discount_percent
  // (پیش‌فرض ۳۰٪ — قابل تغییر در پنل مدیر). لینک ثابت قالب به صفحهٔ پلن‌ها
  // می‌رود (در متن قالب پنل: https://fittup.ir/go/plans — لینک هوشمند اپ).
  //
  // گزینش: کاربرانی که تا امروز ۸ روزه هیچ خریدی نکرده‌اند (هیچ اشتراکی
  // ندارند) — چون لینک به خرید ختم می‌شود، خریدارها مستثنا هستند.
  // Dedupe ابدی: SmsLog (mobile, welcome_offer) — یک بار در عمر کاربر.
  // -------------------------------------------------------------------
  try {
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const nineDaysAgo = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);

    const welcomeUsers = await db.user.findMany({
      where: {
        createdAt: { lt: eightDaysAgo, gt: nineDaysAgo },
        isBlocked: false,
      },
      select: { id: true, name: true, mobile: true, onboardingDone: true },
      take: 200,
    });

    for (const u of welcomeUsers) {
      if (!u.mobile) continue;
      // فقط کاربرانی که هرگز چیزی نخریده‌اند
      const subsCount = await db.subscription.count({ where: { userId: u.id } });
      if (subsCount > 0) continue;

      const percent = await getWelcomeOfferDiscountPercent();
      // v53 — اعتبار ۳۰ روز → ۲ روز (۴۸ ساعت) — دیریکتیو مالک
      const discount = await ensureWelcomeOfferCode(u.id, percent, 2);
      if (!discount) continue; // کد قبلی همین کمپین استفاده شده → خرید/استفاده

      // دیریکتیو مالک: آنبوردینگ ناتمام → «ورزشکار»، تکمیل → نام خودش
      const displayName = u.onboardingDone ? smsFirstNameFn(u.name) : "ورزشکار";

      const smsRes = await sendWelcomeOfferSms(
        { id: u.id, name: u.name, mobile: u.mobile },
        discount.code,
        displayName
      );

      if (smsRes.sent) {
        try {
          await createNotification(
            u.id,
            "system",
            "هدیهٔ ۸ روزهٔ تو آماده‌ست 🎁",
            `کد تخفیف ${discount.code} (${toPersianDigitsFn(percent)}٪) برای خرید پلن فیتاپ فعال شد — تا ۴۸ ساعت اعتبار دارد. زندگی ورزشی‌تو متحول کن!`,
            "?tab=plans",
            { scenario: "welcome_offer_8d", discountCode: discount.code }
          );
        } catch (notifErr) {
          console.warn("[cron/behavioral] welcome_offer notif failed:", notifErr);
        }
        if (!summary.welcomeOffer) summary.welcomeOffer = 0;
        summary.welcomeOffer++;
        if (!summary.smsSent) summary.smsSent = 0;
        summary.smsSent++;
      }
    }
  } catch (err) {
    console.error("[cron/behavioral] welcome_offer SMS scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 10 (v53): ترک درگاه پرداخت — پیامک «کد ۲۴۸۹۴۵» + کد تخفیف ۲ساعته
  // درخواست مالک: کاربری که پرداخت درگاه (زرین‌پال) را شروع کرده و رها کرده،
  // ۵۵ دقیقه تا ۲۴ ساعت بعد با پیامک «با ۱۰ درصد تخفیف تا دو ساعت آینده…»
  // برمی‌گردد. کد نمایشی همیشه «248945» است (کد داخلی یکتا 248945-XXXXX —
  // ensureAbandonedCartCode) و لینک، صفحهٔ پلن‌ها را با ?offer= باز می‌کند.
  //
  // منطق کامل (نامزدها، ۷ شرط ارسال، تنظیمات SiteSetting و ارسال قالب→bulk)
  // در src/lib/fitness/abandoned-cart-scenario.ts جدا شده است — هم از همین
  // sweep اجرا می‌شود و هم مستقیماً قابل تست است.
  // -------------------------------------------------------------------
  try {
    const acRes = await runAbandonedCartScenario(now);
    if (acRes.sent > 0) {
      summary.abandonedCart = acRes.sent;
      if (!summary.smsSent) summary.smsSent = 0;
      summary.smsSent += acRes.sent;
    }
    if (acRes.skippedOutsideWindow > 0) {
      summary.abandonedCartSkipped = acRes.skippedOutsideWindow;
    }
  } catch (err) {
    console.error("[cron/behavioral] abandoned_cart scenario failed:", err);
  }

  // -------------------------------------------------------------------
  // Scenario 11 (v38): سوئیپ خودکار تولیدهای ناموفق — درخواست مالک:
  // «به هیچ وجه نباید کاربر بدون برنامه بماند». درخواست‌های failed با
  // attempts < ۳ و ۱۵ دقیقه سکوت → دوباره صف تولید (سقف ۳ در هر سوئیپ).
  // -------------------------------------------------------------------
  try {
    const requeued = await recoverFailedGenerations(3);
    if (requeued > 0) {
      summary.programRetry = requeued;
      console.log(`[cron/behavioral] auto-requeued ${requeued} failed program generation(s)`);
    }
  } catch (err) {
    console.error("[cron/behavioral] failed-generation sweep error:", err);
  }

  summary.total =
    summary.upgrade +
    summary.renewal +
    summary.reengagement +
    (summary.checkup || 0) +
    (summary.expired || 0) +
    (summary.renewalLate || 0) +
    (summary.pendingReminder || 0) +
    (summary.pendingAutoActivated || 0) +
    (summary.planExpiring || 0) +
    (summary.onboardingNudge || 0) +
    (summary.onboardingWinback || 0) +
    (summary.welcomeOffer || 0) +
    (summary.renewalBoost || 0) +
    (summary.abandonedCart || 0);
  return Response.json({ ok: true, ...summary });
}

// برچسب فارسی پلن‌ها (محلی — بدون import سنگین از types)
const PLAN_LABELS_FN: Record<string, string> = {
  basic: "اقتصادی",
  standard: "استاندارد",
  advanced: "پیشرفته",
  ultimate: "حرفه‌ای",
};

// Simple Persian digit converter (to avoid importing from types in cron)
function toPersianDigitsFn(n: number | string): string {
  const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(n).replace(/[0-9]/g, (d) => persianDigits[parseInt(d)]);
}

// نام کوچک امن برای پارامتر NAME پیامک (محلی — همان منطق sms-flows.smsFirstName، سقف ۲۵ v48)
function smsFirstNameFn(name: string | null | undefined): string {
  const first = String(name || "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .split(/\s+/)[0] || "";
  return first.slice(0, 25);
}
