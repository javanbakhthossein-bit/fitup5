import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";

export async function GET() {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewDashboard");
    const now = new Date();

    const [
      totalUsers,
      activeSubscriptions,
      totalRevenue,
      totalPayments,
      blockedUsers,
      onboardingDone,
      exercises,
      foods,
      usersWithPlan,
      // ─── v47 — داشبورد جامع (دیریکتیو مالک: «داشبورد مدیر خیلی خلاصست») ───
      appPanelInstalls,
      appBazaarInstalls,
      pwaInstalls,
      active7d,
      active30d,
      newUsers30d,
      revenue30d,
      payments30d,
      openTickets,
      pendingReplyTickets,
      smsSent30d,
      articlesCount,
      walletTotal,
      failedProgramRequests,
      activeDiscounts,
      referralSuccess,
      // ─── v52 حسابداری — هزینه‌های عملیاتی برای «درآمد خالص» داشبورد ───
      smsCostAll,
      smsCost30d,
      aiCostAll,
      aiCost30d,
      gatewayFeeAll,
      gatewayFee30d,
    ] = await Promise.all([
      db.user.count(),
      db.subscription.count({ where: { status: "active", endDate: { gt: now } } }),
      // درآمد واقعی = پرداخت‌های موفق «غیر از شارژ کیف پول» (ممیزی 2-c P2):
      // شارژ کیف جذب نقدینگی است نه درآمد؛ وگرنه وقتی همان کیف برای خرید پلن خرج شود دوبار شمرده می‌شود.
      // totalPayments عمداً شامل topup می‌ماند (شمارش کل تراکنش‌های موفق).
      db.payment.aggregate({
        where: { status: "success", plan: { not: "wallet_topup" } },
        _sum: { amount: true },
      }),
      db.payment.count({ where: { status: "success" } }),
      db.user.count({ where: { isBlocked: true } }),
      db.user.count({ where: { onboardingDone: true } }),
      db.exerciseLibrary.count(),
      db.foodLibrary.count(),
      db.user.count({ where: { planName: { not: null } } }),
      // نصب اپ نیتیو — منبع: UA اپ‌ها (FitUpApp/ = اختصاصی، FitUpBazaar/ = بازار) + PWA
      db.user.count({ where: { appInstallSource: "panel" } }),
      db.user.count({ where: { appInstallSource: "bazaar" } }),
      db.user.count({ where: { pwaInstalledAt: { not: null } } }),
      // کاربران فعال (آخرین باز شدن اپ/سایت)
      db.user.count({ where: { lastActiveAt: { gt: new Date(now.getTime() - 7 * 86400000) } } }),
      db.user.count({ where: { lastActiveAt: { gt: new Date(now.getTime() - 30 * 86400000) } } }),
      db.user.count({ where: { createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } } }),
      db.payment.aggregate({
        where: { status: "success", plan: { not: "wallet_topup" }, createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } },
        _sum: { amount: true },
      }),
      db.payment.count({ where: { status: "success", createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } } }),
      // v52 فیکس «یک تیکت باز» در داشبورد: قبلاً فقط status="open" (بی‌پاسخِ
      // ادمین) شمرده می‌شد؛ تیکت‌هایی که ادمین پاسخ داده بود («answered») از
      // شمارش خارج می‌شدند در حالی که بسته نشده‌اند — مالک همه را «باز» می‌داند.
      // حالا «تیکت باز» = هر تیکت بسته‌نشده (open + answered). با بستن خودکار
      // ۷روزه (cron/auto-close-tickets) تیکت‌های پاسخ‌داده‌ی قدیمی هم بسته می‌شوند.
      db.supportTicket.count({ where: { status: { not: "closed" } } }).catch(() => 0),
      // در انتظار پاسخ ادمین (بی‌پاسخ) — برای نشان سریع در داشبورد
      db.supportTicket.count({ where: { status: "open" } }).catch(() => 0),
      db.smsLog.count({ where: { status: "sent", createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } } }),
      db.article.count({ where: { status: "published" } }).catch(() => 0),
      db.user.aggregate({ _sum: { walletBalance: true } }),
      db.programRequest.count({ where: { status: "failed" } }).catch(() => 0),
      db.discountCode.count({ where: { active: true } }).catch(() => 0),
      db.user.count({ where: { referredById: { not: null }, referralRewardPaid: true } }).catch(() => 0),
      // v52 — هزینهٔ پیامک (لاگ SmsMessageLog — جدول جدید v52؛ catch برای سازگاری با dbهای قدیمی)
      db.smsMessageLog.aggregate({ where: { status: "sent" }, _sum: { cost: true } }).catch(() => ({ _sum: { cost: 0 } })),
      db.smsMessageLog.aggregate({ where: { status: "sent", createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } }, _sum: { cost: true } }).catch(() => ({ _sum: { cost: 0 } })),
      // v52 — هزینهٔ هوش مصنوعی (لاگ AiUsageLog — تومانِ ثبت‌شده با نرخ دلار لحظهٔ مصرف)
      db.aiUsageLog.aggregate({ _sum: { costToman: true } }).catch(() => ({ _sum: { costToman: 0 } })),
      db.aiUsageLog.aggregate({ where: { createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } }, _sum: { costToman: true } }).catch(() => ({ _sum: { costToman: 0 } })),
      // v52 — کارمزد درگاه روی پرداخت‌های موفق
      db.payment.aggregate({ where: { status: "success" }, _sum: { fee: true } }),
      db.payment.aggregate({ where: { status: "success", createdAt: { gt: new Date(now.getTime() - 30 * 86400000) } }, _sum: { fee: true } }),
    ]);

    // نرخ تبدیل: کاربرانی که پلن فعال دارند / کل کاربران
    const conversionRate = totalUsers > 0 ? Math.round((usersWithPlan / totalUsers) * 100) : 0;

    // ─── v52 — درآمد خالص (پس از هزینه‌ها): درآمد واقعی − (پیامک + هوش مصنوعی + کارمزد درگاه) ───
    const smsCost = smsCostAll._sum.cost || 0;
    const aiCost = aiCostAll._sum.costToman || 0;
    const gatewayFee = gatewayFeeAll._sum.fee || 0;
    const totalCosts = smsCost + aiCost + gatewayFee;
    const netProfit = (totalRevenue._sum.amount || 0) - totalCosts;
    const costs30d =
      (smsCost30d._sum.cost || 0) + (aiCost30d._sum.costToman || 0) + (gatewayFee30d._sum.fee || 0);
    const netProfit30d = (revenue30d._sum.amount || 0) - costs30d;

    // درآمد بر اساس پلن — شارژ کیف پول (wallet_topup) درآمد نیست و حذف می‌شود (ممیزی 2-c P2)
    const revenueByPlan = await db.payment.groupBy({
      by: ["plan"],
      where: { status: "success", plan: { not: "wallet_topup" } },
      _sum: { amount: true },
      _count: true,
    });

    // توزیع کاربران در پلن‌ها
    const planDistribution = await db.user.groupBy({
      by: ["planName"],
      where: { planName: { not: null } },
      _count: true,
    });

    const monthNames = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

    // ─── باکت‌بندی دقیق بر اساس مرز ماه‌های شمسی (جلالی) ───
    // ریشه باگ «فریز نمودار روی مرداد»: قبلاً باکت‌ها اولِ ماهِ میلادی بودند و
    // فقط لیبل شمسی می‌گرفتند؛ اول مرداد میلادی = ۱۰ مرداد شمسی، پس آخرین
    // ستون همیشه ماه شمسیِ قبل را نشان می‌داد و ماه جاری (مثلاً شهریور که
    // از ۲۳ مرداد میلادی شروع می‌شود) هرگز ظاهر نمی‌شد.
    // حالا ۶ ماهِ شمسیِ اخیر با مرز دقیق جلالی ساخته می‌شوند.
    function getJalaliParts(date: Date): { y: number; m: number; d: number } {
      // timeZone صریح تهران (ممیزی 2-c P3): بدون آن قالب‌بندی در TZ سرور انجام می‌شد و
      // اگر سرور UTC باشد رخدادهای ۰۰:۰۰-۰۳:۳۰ تهرانِ ابتدای ماه به ماه قبل می‌افتادند.
      const parts = new Intl.DateTimeFormat("en-u-ca-persian", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        timeZone: "Asia/Tehran",
      }).formatToParts(date);
      const num = (t: string) => parseInt(parts.find((p) => p.type === t)?.value.replace(/\D/g, "") || "0", 10);
      return { y: num("year"), m: num("month"), d: num("day") };
    }

    /** آیا تاریخِ داده‌شده قبل از شروعِ ماه (y, m) جلالی است؟ */
    function beforeJalaliMonth(date: Date, y: number, m: number): boolean {
      const j = getJalaliParts(date);
      if (j.y !== y) return j.y < y;
      return j.m < m;
    }

    /** اولین روزِ میلادیِ ماه (y, m) جلالی — جستجوی دودویی با تقویم Intl */
    function jalaliMonthStart(y: number, m: number): Date {
      const DAY = 86400000;
      // برآورد: نوروز سال j ≈ ۲۱ مارس (y+621) + شروع ماه m
      const est = Date.UTC(y + 621, 2, 21) + Math.round((m - 1) * 30.44 * DAY);
      let lo = Math.floor(est / DAY) * DAY - 7 * DAY;
      let hi = Math.floor(est / DAY) * DAY + 7 * DAY;
      // گسترش دامنه تا lo قاطعاً قبل از ماه و hi قاطعاً در ماه/بعد از آن باشد
      while (beforeJalaliMonth(new Date(hi), y, m)) hi += 7 * DAY;
      while (!beforeJalaliMonth(new Date(lo), y, m)) lo -= 7 * DAY;
      // جستجوی دودویی روزبه‌روز
      while (hi - lo > DAY) {
        const mid = lo + Math.floor((hi - lo) / (2 * DAY)) * DAY;
        if (beforeJalaliMonth(new Date(mid), y, m)) lo = mid;
        else hi = mid;
      }
      const start = new Date(hi);
      start.setHours(0, 0, 0, 0);
      return start;
    }

    const nowJ = getJalaliParts(now);
    const buckets: { start: Date; end: Date; monthIndex: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      let y = nowJ.y;
      let m = nowJ.m - i;
      while (m < 1) { m += 12; y -= 1; }
      while (m > 12) { m -= 12; y += 1; }
      const start = jalaliMonthStart(y, m);
      const end = m === 12 ? jalaliMonthStart(y + 1, 1) : jalaliMonthStart(y, m + 1);
      buckets.push({ start, end, monthIndex: m - 1 });
    }
    const windowStart = buckets[0].start;

    const allUsers = await db.user.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true },
    });

    const userGrowth: { month: string; users: number; total: number }[] = [];
    let cumulative = totalUsers - allUsers.length;
    for (const b of buckets) {
      const monthUsers = allUsers.filter((u) => u.createdAt >= b.start && u.createdAt < b.end).length;
      cumulative += monthUsers;
      userGrowth.push({ month: monthNames[b.monthIndex], users: monthUsers, total: cumulative });
    }

    // درآمد ۶ ماه شمسی اخیر (همان باکت‌ها) — بدون wallet_topup (ممیزی 2-c P2)
    const allPayments = await db.payment.findMany({
      where: { status: "success", plan: { not: "wallet_topup" }, createdAt: { gte: windowStart } },
      select: { amount: true, createdAt: true },
    });
    const revenueGrowth: { month: string; revenue: number }[] = [];
    for (const b of buckets) {
      const monthRev = allPayments.filter((p) => p.createdAt >= b.start && p.createdAt < b.end).reduce((s, p) => s + p.amount, 0);
      revenueGrowth.push({ month: monthNames[b.monthIndex], revenue: monthRev });
    }

    // ─── v251 — KPIهای اشتراکی فروش: MRR نرمال‌شده، نرخ تمدید/Churn،
    // نرخ موفقیت هر درگاه، Cohort ریتنشن و اتریبیوشن کمپین→درآمد ───
    // (همه از دادهٔ واقعی Payment/Subscription/Notification — بدون مدل جدید به‌جز
    //  campaignId که dispatch کمپین‌ها پر می‌کند)
    const since45 = new Date(now.getTime() - 45 * 86400000);

    // MRR نرمال‌شدهٔ ۴۵روزه: درآمد موفق ۴۵ روز ÷ ۴۵ × ۳۰ (زبان مشترک SaaS —
    // دورهٔ فیتاپ ۴۵روزه است؛ مقایسهٔ ماه‌به‌ماه با نرمال‌سازی عادلانه می‌شود)
    const mrrToman = Math.round(
      ((allPayments.filter((p) => p.createdAt >= since45).reduce((sum, p) => sum + p.amount, 0)) / 45) * 30
    );

    // نرخ موفقیت هر درگاه (۴۵ روز اخیر) — attempts = همهٔ ردیف‌های روش‌دار،
    // success = status=success؛ تفکیک gateway (زرین‌پال) / bazaar (بازار) / wallet
    // (paymentMethod در اسکیما غیرنال است — groupBy تایپ‌سخت بود؛ شمارش
    //  درون‌حافظه روی پنجرهٔ ۴۵روزه هم دقیق‌تر است هم صفر ریس تایپ)
    const gatewayRows = await db.payment.findMany({
      where: { createdAt: { gte: since45 } },
      select: { paymentMethod: true, status: true },
    });
    const gatewayAgg = new Map<string, { total: number; success: number }>();
    for (const row of gatewayRows) {
      const key = row.paymentMethod || "gateway";
      const cur = gatewayAgg.get(key) || { total: 0, success: 0 };
      cur.total++;
      if (row.status === "success") cur.success++;
      gatewayAgg.set(key, cur);
    }
    const gatewayBreakdown = [...gatewayAgg.entries()]
      .map(([method, agg]) => ({
        method,
        total: agg.total,
        success: agg.success,
        rate: agg.total > 0 ? Math.round((agg.success / agg.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // نرخ تمدید (۴۵ روز): اشتراک‌هایی که در بازه بسته شدند → چند٪ بعدش چرخهٔ
    // جدید گرفتند (startDate جدیدتر از endDate قبلی). مکمل آن Churn = ۱۰۰−تمدید
    const [endedSubs, newerSubs] = await Promise.all([
      db.subscription.findMany({
        where: { endDate: { lt: now, gte: since45 } },
        select: { userId: true, endDate: true },
      }),
      db.subscription.findMany({
        where: { startDate: { gte: since45 }, status: { in: ["active", "expired"] } },
        select: { userId: true, startDate: true },
      }),
    ]);
    const latestNewStartByUser = new Map<string, Date>();
    for (const ns of newerSubs) {
      const prev = latestNewStartByUser.get(ns.userId);
      if (!prev || (ns.startDate && ns.startDate > prev)) latestNewStartByUser.set(ns.userId, ns.startDate as Date);
    }
    const renewedCount = endedSubs.filter((e) => {
      const newStart = latestNewStartByUser.get(e.userId);
      return newStart && e.endDate && newStart.getTime() > e.endDate.getTime();
    }).length;
    const renewalRate = endedSubs.length > 0 ? Math.round((renewedCount / endedSubs.length) * 100) : null;

    // Cohort ریتنشن — همان ۶ باکت شمسی: هر ماه ثبت‌نام → چند٪ هنوز فعال‌اند
    // (آخرین فعالیت ≤۳۰ روز). تصمیم نگهداشت داده‌محور به‌جای حدس.
    const cohortUsers = await db.user.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { createdAt: true, lastActiveAt: true },
    });
    const activeThreshold = now.getTime() - 30 * 86400000;
    const cohorts = buckets.map((b) => {
      const inMonth = cohortUsers.filter((u) => u.createdAt >= b.start && u.createdAt < b.end);
      const active = inMonth.filter(
        (u) => u.lastActiveAt && u.lastActiveAt.getTime() >= activeThreshold
      ).length;
      return {
        month: monthNames[b.monthIndex],
        registered: inMonth.length,
        active,
        rate: inMonth.length > 0 ? Math.round((active / inMonth.length) * 100) : 0,
      };
    });

    // اتریبیوشن کمپین→درآمد: کمپین‌های ارسال‌شدهٔ ۴۵ روز اخیر → خرید موفقی که
    // تا ۷ روز بعد از دریافت نوتیف کمپین رخ داده (پنجرهٔ تأثیر استاندارد).
    // campaignId در dispatch کمپین‌ها روی نوتیف ثبت می‌شود (v251).
    const recentCampaigns = await db.notificationCampaign.findMany({
      where: { sentAt: { not: null, gte: since45 } },
      select: { id: true, title: true, sentAt: true, totalTargets: true },
      orderBy: { sentAt: "desc" },
      take: 8,
    });
    const campaignAttribution: { id: string; title: string; targets: number; buyers: number; revenue: number }[] = [];
    for (const c of recentCampaigns) {
      const campNotifs = await db.notification.findMany({
        where: { campaignId: c.id },
        select: { userId: true, createdAt: true },
      });
      const base = { id: c.id, title: c.title, targets: c.totalTargets, buyers: 0, revenue: 0 };
      if (campNotifs.length === 0) {
        campaignAttribution.push(base);
        continue;
      }
      const earliestByUser = new Map<string, Date>();
      for (const n of campNotifs) {
        const prev = earliestByUser.get(n.userId);
        if (!prev || n.createdAt < prev) earliestByUser.set(n.userId, n.createdAt);
      }
      const campPayments = await db.payment.findMany({
        where: {
          status: "success",
          plan: { not: "wallet_topup" },
          userId: { in: [...earliestByUser.keys()] },
          createdAt: { gte: since45 },
        },
        select: { userId: true, amount: true, createdAt: true },
      });
      for (const pay of campPayments) {
        const nAt = earliestByUser.get(pay.userId) as Date;
        if (pay.createdAt >= nAt && pay.createdAt.getTime() <= nAt.getTime() + 7 * 86400000) {
          base.buyers++;
          base.revenue += pay.amount;
        }
      }
      campaignAttribution.push(base);
    }
    campaignAttribution.sort((a, b) => b.revenue - a.revenue);

    // تعداد برنامه‌های در انتظار
    const pendingPrograms = await db.programRequest.count({ where: { status: "pending" } });
    const readyPrograms = await db.programRequest.count({ where: { status: "ready" } });

    // کاربران اخیر
    const recentUsers = await db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, mobile: true, name: true, onboardingDone: true, isBlocked: true, createdAt: true, planName: true },
    });

    return Response.json({
      stats: {
        totalUsers,
        activeSubscriptions,
        totalRevenue: totalRevenue._sum.amount || 0,
        totalPayments,
        blockedUsers,
        onboardingDone,
        exercises,
        foods,
        conversionRate,
        usersWithPlan,
        pendingPrograms,
        readyPrograms,
        // ─── v47 — داشبورد جامع ───
        appInstalls: { panel: appPanelInstalls, bazaar: appBazaarInstalls, pwa: pwaInstalls, total: appPanelInstalls + appBazaarInstalls + pwaInstalls },
        active7d,
        active30d,
        newUsers30d,
        revenue30d: revenue30d._sum.amount || 0,
        payments30d,
        openTickets,
        // v251 — وضعیت 2FA ادمین: اگر ADMIN_PASSWORD در env ست نباشد، ورود ادمین
        // تک‌عاملی است (فقط OTP پیامکی) — داشبورد این را به‌صورت هشدار نشان می‌دهد
        twoFactorEnabled: Boolean(process.env.ADMIN_PASSWORD?.trim()),
        pendingReplyTickets,
        smsSent30d,
        articlesCount,
        walletTotal: walletTotal._sum.walletBalance || 0,
        failedProgramRequests,
        activeDiscounts,
        referralSuccess,
        // ─── v52 — درآمد خالص پس از هزینه‌ها (داشبورد ادمین) ───
        netIncome: {
          totalRevenue: totalRevenue._sum.amount || 0,
          totalCosts,
          netProfit,
          smsCost,
          aiCost,
          gatewayFee,
          costs30d,
          netProfit30d,
        },
      },
      revenueByPlan,
      planDistribution,
      userGrowth,
      revenueGrowth,
      recentUsers: recentUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
      // ─── v251 — KPIهای اشتراکی فروش ───
      mrrToman,
      renewalRate,
      renewalStats: { renewed: renewedCount, windowTotal: endedSubs.length },
      gatewayBreakdown,
      cohorts,
      campaignAttribution,
    });
  } catch (e) {
    return apiError(e);
  }
}
