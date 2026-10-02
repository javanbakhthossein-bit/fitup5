import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { getUserQuotaSummary } from "@/lib/fitness/quota";
import { equipmentListFa } from "@/lib/fitness/types";
// v162 — نرمال‌سازی فیلدهای جدید (فرم بدن/دخانیات/نواحی آسیب) پیش از Prisma
import { BODY_SHAPE_LABELS_FA, SMOKING_HABIT_LABELS_FA, INJURY_AREA_LABELS_FA } from "@/lib/fitness/types";
import { fixPlanTypographyDeep } from "@/lib/fitness/persian-typography";
import { planHasSupplements } from "@/lib/fitness/supplement-gate";

/**
 * GET /api/admin/users/[id]/details
 * Full user details for admin:
 *  - profile (تمام فیلدهای آنبوردینگ — قابل ویرایش توسط ادمین)
 *  - subscriptions (تاریخچه اشتراک)
 *  - workoutPlans (تمام برنامه‌های تمرینی خریداری‌شده + جزئیات روزها/حرکات)
 *  - mealPlans (تمام برنامه‌های غذایی)
 *  - checkups (تاریخچه چکاپ)
 *  - weightLogs (آخرین وزن‌ها)
 *  - programRequests (تاریخچه درخواست برنامه)
 *  - payments (تمام تراکنش‌ها — با جزئیات کامل)
 *  - totalPurchased (مجموع خرید کاربر از سایت)
 *  - v15: media (تمام عکس/ویدیوهای آپلودشده کاربر — گالری، عکس بدن،
 *    آزمایش خون، ویدیو، عکس غذا، چت) + جزئیات کامل پلن‌ها برای مودال مجزا
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;

    const [user, profile, subscriptions, workoutPlans, mealPlans, checkups, weightLogs, programRequests, payments, progressPhotos, analysisMedia, foodLogImages, chatMedia] =
      await Promise.all([
        db.user.findUnique({
          where: { id },
          select: {
            id: true, mobile: true, name: true, role: true, isBlocked: true,
            onboardingDone: true, onboardingCompletedAt: true, lastActiveAt: true,
            planName: true, planExpiresAt: true, planStartedAt: true,
            walletBalance: true, videoAnalysisUsed: true, bloodTestUsed: true,
            bloodTestStatus: true, videoStatus: true,
            referralCode: true, referredById: true, referralRewardPaid: true,
            appInstallSource: true, appInstalledAt: true, pwaInstalledAt: true,
            createdAt: true,
          },
        }),
        db.onboardingProfile.findUnique({
          where: { userId: id },
          // تمام فیلدهای آنبوردینگ برای نمایش و ویرایش توسط ادمین
          select: {
            gender: true, age: true, height: true, weight: true, targetWeight: true,
            goal: true, activityLevel: true, workoutDays: true, workoutDaysList: true,
            workoutPlace: true, equipment: true, diseases: true, injuries: true,
            allergies: true, dietType: true,
            // فیلدهای پیشرفته‌تر
            trainingExperience: true, previousTrainingType: true, drugAllergies: true,
            currentMedications: true, maxLifts: true,
            bodyFrame: true, sleepHours: true, stressLevel: true, waterHabit: true,
            targetDate: true, workoutTime: true, medicalConditions: true,
            currentSupplements: true, dislikedFoods: true, preferredCuisine: true,
            // v64 — شرایط/نیاز/هدف خاص کاربر (متن آزاد) — ادمین باید بتواند ویرایش کند
            specialConditions: true,
            // v162 — فرم بدن + دخانیات + نواحی آسیب + سایر مشکلات (نمایش + ویرایش ادمین)
            bodyShape: true, smokingHabit: true, injuryAreas: true, otherHealthIssues: true,
            // v157 — تکمیل نمایش پروفایل: تعداد وعدهٔ مطلوب + یادداشت‌های تغذیه‌ای
            // (قبلاً در پاسخ این route نبودند و ادمین نمی‌دیدشان)
            mealCount: true, nutritionNotes: true,
            // v157 — ممنوعیت‌های ماندگار کاربر/مدیر (حرکات/غذاها/مکمل‌های حذفی که
            // در همهٔ تولیدهای آینده اعمال می‌شوند) — برای نمایش شفاف به ادمین
            persistentExclusions: true,
            // v76 — آخرین تغییر وزن (برای نمایش «آخرین به‌روزرسانی وزن»)
            weightUpdatedAt: true,
            // v75 — رشتهٔ ورزشی (نمایش + ویرایش توسط ادمین)
            discipline: true,
            // اندازه‌های بدنی (فقط آن‌هایی که روی OnboardingProfile هستند —
            // بقیه اندازه‌ها (waist/chest/arm/hip/thigh) روی Checkup قرار دارند)
            neckMeasurement: true, shoulderMeasurement: true, calfMeasurement: true,
            aiAnalysis: true,
            createdAt: true, updatedAt: true,
          },
        }),
        db.subscription.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          // v150 — planRegenUsed/planRegenExtra/planRegenPending برای نمایش سهمیهٔ بازطراحی چت به ادمین
          select: { id: true, plan: true, status: true, startDate: true, endDate: true, durationDays: true, pricePaid: true, discountCode: true, createdAt: true, planRegenUsed: true, planRegenExtra: true, planRegenPending: true },
        }),
        // تمام برنامه‌های تمرینی (بدون take) — تاریخچه کامل خریدها
        db.workoutPlan.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          // v111 — فیلدهای نسخه‌بندی (version/generatedSource/changeSummary/supersededAt/supersededById)
          select: { id: true, weekIndex: true, active: true, createdAt: true, updatedAt: true, content: true, version: true, generatedSource: true, changeSummary: true, supersededAt: true, supersededById: true },
        }),
        // تمام برنامه‌های غذایی (بدون take)
        db.mealPlan.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          // v111 — فیلدهای نسخه‌بندی
          select: { id: true, active: true, totalCal: true, dayLabel: true, createdAt: true, content: true, version: true, generatedSource: true, changeSummary: true, supersededAt: true, supersededById: true },
        }),
        db.checkup.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          select: { id: true, phaseNumber: true, weight: true, bodyFatPercent: true, leanBodyMass: true, status: true, phaseCompleted: true, createdAt: true },
        }),
        db.weightLog.findMany({
          where: { userId: id },
          orderBy: { loggedAt: "desc" },
          select: { id: true, weight: true, loggedAt: true },
          take: 30,
        }),
        db.programRequest.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          // v157 — attempts/lastError/updatedAt هم برای نمایش وضعیت واقعی ساخت برنامه به ادمین
          select: { id: true, plan: true, status: true, attempts: true, autoRetryCount: true, lastError: true, createdAt: true, updatedAt: true },
        }),
        // تمام تراکنش‌ها (پرداخت‌های کاربر)
        db.payment.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, amount: true, originalAmount: true, plan: true,
            paymentMethod: true, authority: true, refId: true, status: true,
            discountCode: true, description: true, cardPan: true,
            createdAt: true, verifiedAt: true,
          },
        }),
        // ─── v15: تمام عکس‌های پیشرفت کاربر ───
        db.progressPhoto.findMany({
          where: { userId: id },
          orderBy: { takenAt: "desc" },
          select: { id: true, imageUrl: true, type: true, note: true, takenAt: true },
        }),
        // ─── v15: تمام مدیاهای تحلیل (عکس بدن / آزمایش خون / ویدیو) ───
        db.analysisResult.findMany({
          where: { userId: id, mediaUrl: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, mediaUrl: true, result: true, createdAt: true },
        }),
        // ─── v15: عکس‌های غذاهای ثبت‌شده ───
        db.foodLog.findMany({
          where: { userId: id, imageUrl: { not: null } },
          orderBy: { logDate: "desc" },
          take: 50,
          select: { id: true, imageUrl: true, name: true, meal: true, logDate: true },
        }),
        // ─── v15: مدیاهای چت ───
        db.chatMessage.findMany({
          where: { userId: id, mediaUrl: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, mediaUrl: true, mediaType: true, createdAt: true },
        }),
      ]);

    if (!user) {
      return Response.json({ error: "کاربر یافت نشد" }, { status: 404 });
    }

    // ─── v157 — اطلاعات معرفی (رفرال): معرفِ این کاربر + کسانی که او معرفی کرده ───
    const [referrer, invitedUsers, invitedCount] = await Promise.all([
      user.referredById
        ? db.user.findUnique({
            where: { id: user.referredById },
            select: { id: true, name: true, mobile: true, referralCode: true },
          })
        : Promise.resolve(null),
      db.user.findMany({
        where: { referredById: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, mobile: true, onboardingDone: true, planName: true, createdAt: true },
        take: 20,
      }),
      db.user.count({ where: { referredById: id } }),
    ]);

    // ─── v15: خلاصه + جزئیات کامل برنامه‌های تمرینی ───
    // برای هر برنامه: تعداد روزها، نام روزها، تعداد کل حرکات، هدف هفتهگی،
    // توزیع ست‌ها — تا ادمین در مودال مجزا «برنامه‌ها» همه‌چیز را ببیند.
    //
    // ─── v75 — رفع باگ «هفته ۲» + تاریخچه کامل با تاریخ ───
    // قبلاً بج «هفته {weekIndex+1}» نشان داده می‌شد ولی weekIndex هرگز آپدیت
    // نمی‌شد (پیش‌فرض ۱) → برای همه «هفته ۲». حالا:
    //  • برنامهٔ فعال: «روز N از برنامه» (N = روزهای سپری‌شده از createdAt)
    //  • برنامهٔ غیرفعال: «از تاریخ تا تاریخ (طول دوره)» — جایگزین‌شده یا لغوشده
    //  • اشتراک پوشش‌دهنده هر برنامه برای تاریخ فعال‌سازی/اتمام/لغو
    const nowMs = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const planSummariesCtx = workoutPlans
      .slice() // قدیمی → جدید برای محاسبهٔ «برنامهٔ بعدی»
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const nextPlanStartById = new Map<string, Date>();
    for (let i = 0; i < planSummariesCtx.length; i++) {
      const cur = planSummariesCtx[i];
      const next = planSummariesCtx[i + 1];
      if (next) nextPlanStartById.set(cur.id, new Date(next.createdAt));
    }
    // v157 — نقشهٔ شناسهٔ برنامه → شمارهٔ نسخه؛ برای نمایش «جایگزین‌شده با نسخهٔ N»
    // (قبلاً فقط supersededById خام ذخیره می‌شد و ادمین نمی‌فهمید کدام نسخه)
    const versionById = new Map<string, number>();
    for (const wp of workoutPlans) versionById.set(wp.id, wp.version ?? 1);
    const mealVersionById = new Map<string, number>();
    for (const mp of mealPlans) mealVersionById.set(mp.id, mp.version ?? 1);
    const coveringSubFor = (at: Date) =>
      subscriptions.find((s) => {
        const start = s.startDate ? new Date(s.startDate) : new Date(s.createdAt);
        const end = s.endDate ? new Date(s.endDate) : null;
        return start.getTime() - DAY_MS <= at.getTime() && (!end || end.getTime() + DAY_MS >= at.getTime());
      }) ?? null;

    const workoutPlanSummaries = workoutPlans.map((wp) => {
      let summary = "";
      let dayNames: string[] = [];
      let totalExercises = 0;
      let totalSets = 0;
      let weeklyGoal = "";
      let splitType = "";
      try {
        const content = JSON.parse(wp.content);
        const days = Array.isArray(content.days) ? content.days : [];
        dayNames = days.map((d: any) => String(d?.day || d?.title || "—"));
        totalExercises = days.reduce(
          (n: number, d: any) => n + (Array.isArray(d?.exercises) ? d.exercises.length : 0),
          0
        );
        totalSets = days.reduce(
          (n: number, d: any) =>
            n +
            (Array.isArray(d?.exercises)
              ? d.exercises.reduce((s: number, e: any) => s + (Array.isArray(e?.sets) ? e.sets.length : 0), 0)
              : 0),
          0
        );
        weeklyGoal = String(content.weeklyGoal || "");
        splitType = String(content.splitType || content.planType || "");
        summary = `${toFaCount(days.length)} روز - هدف: ${weeklyGoal || "—"}`;
      } catch {
        summary = "نامشخص";
      }

      // v75 — روزِ برنامه (به‌جای هفتهٔ غلط)
      const createdMs = new Date(wp.createdAt).getTime();
      const nextStart = nextPlanStartById.get(wp.id) ?? null;
      const endMs = wp.active ? nowMs : nextStart ? nextStart.getTime() : nowMs;
      const dayOfProgram = Math.max(1, Math.floor((endMs - createdMs) / DAY_MS) + (wp.active ? 1 : 0));
      const durationDays = Math.max(1, Math.floor((endMs - createdMs) / DAY_MS));
      const coveringSub = coveringSubFor(new Date(wp.createdAt));

      return {
        id: wp.id,
        weekIndex: wp.weekIndex,
        active: wp.active,
        createdAt: wp.createdAt,
        updatedAt: wp.updatedAt,
        // v111 — نسخه‌بندی (درخواست مالک: پنل مدیر هم نسخه/منبع/خلاصهٔ تغییرات ببیند)
        version: wp.version,
        generatedSource: wp.generatedSource,
        changeSummary: wp.changeSummary,
        supersededAt: wp.supersededAt,
        supersededById: wp.supersededById,
        // v157 — شمارهٔ نسخهٔ جایگزین‌شده (برای «جایگزین‌شده با نسخهٔ N»)
        supersededByVersion: wp.supersededById ? (versionById.get(wp.supersededById) ?? null) : null,
        summary,
        dayNames,
        totalExercises,
        totalSets,
        weeklyGoal,
        splitType,
        // v75 — محاسبات دقیق تاریخ
        dayOfProgram: wp.active ? dayOfProgram : null,
        durationDays,
        endedAt: wp.active ? null : (nextStart ? nextStart.toISOString() : new Date(wp.updatedAt).toISOString()),
        endReason: wp.active ? null : (nextStart ? "replaced" : "ended"),
        subscription: coveringSub
          ? {
              id: coveringSub.id,
              plan: coveringSub.plan,
              status: coveringSub.status,
              startDate: coveringSub.startDate,
              endDate: coveringSub.endDate,
              createdAt: coveringSub.createdAt,
            }
          : null,
        content: undefined,
      };
    });
    // v75 — تایپوگرافی فارسی روی summaryها (weeklyGoal/dayNames) — هم‌سو با پنل کاربر
    for (const s of workoutPlanSummaries) fixPlanTypographyDeep(s);

    // ─── v15: جزئیات برنامه‌های غذایی ───
    // v75 — شمارش مکمل‌های هر برنامه غذایی برای نمایش سریع در پنل مدیر
    // v79 — گیت سخت مکمل: اگر پلن فعلی کاربر اقتصادی است، شمارش مکمل صفر
    // گزارش می‌شود (و در plan-content هم محتوای مکمل حذف می‌شود) —
    // «برنامهٔ مکمل فقط برای استاندارد به بالا» (گزارش مالک)
    const planAllowsSupplements = planHasSupplements(user?.planName ?? null);
    const mealPlanSummaries = mealPlans.map((mp) => {
      let mealsCount = 0;
      let mealNames: string[] = [];
      let supplementsCount = 0;
      let supplementStackCount = 0;
      try {
        const content = JSON.parse(mp.content);
        const meals = Array.isArray(content?.meals) ? content.meals : Array.isArray(content) ? content : [];
        mealsCount = meals.length;
        mealNames = meals.map((m: any) => String(m?.name || m?.title || m?.mealType || "—")).slice(0, 8);
        if (planAllowsSupplements) {
          supplementsCount = Array.isArray(content?.supplements) ? content.supplements.length : 0;
          supplementStackCount = Array.isArray(content?.supplementStack) ? content.supplementStack.length : 0;
        }
      } catch {}
      // v111 — نسخه‌بندی + خلاصهٔ تغییرات (بدون لمس content — فقط متادیتا)
      return {
        ...mp,
        version: mp.version,
        generatedSource: mp.generatedSource,
        changeSummary: mp.changeSummary,
        supersededAt: mp.supersededAt,
        supersededById: mp.supersededById,
        // v157 — شمارهٔ نسخهٔ جایگزین‌شده (برای «جایگزین‌شده با نسخهٔ N»)
        supersededByVersion: mp.supersededById ? (mealVersionById.get(mp.supersededById) ?? null) : null,
        content: undefined,
        mealsCount,
        mealNames,
        supplementsCount,
        supplementStackCount,
      };
    });
    // v75 — تایپوگرافی فارسی روی نام وعده‌ها — هم‌سو با پنل کاربر
    for (const s of mealPlanSummaries) fixPlanTypographyDeep(s);

    // ─── v15: گالری یکپارچه مدیاهای کاربر (برای مودال «عکس‌ها») ───
    const mediaGallery = [
      ...progressPhotos.map((p) => ({
        id: p.id,
        kind: "progress" as const,
        url: p.imageUrl,
        // v75 — برچسب زاویه حذف شد (درخواست مالک)
        label: "عکس پیشرفت",
        note: p.note || "",
        createdAt: p.takenAt,
      })),
      ...analysisMedia.map((a) => ({
        id: a.id,
        kind: a.type as string,
        url: a.mediaUrl as string,
        label:
          a.type === "body_photo" ? "عکس بدن (تحلیل)" :
          a.type === "blood_test" ? "آزمایش خون" :
          a.type === "video_analysis" ? "ویدیوی آنالیز فرم" :
          a.type === "body_progress" ? "تحلیل پیشرفت" : a.type,
        note: "",
        createdAt: a.createdAt,
      })),
      ...foodLogImages.map((f) => ({
        id: f.id,
        kind: "food" as const,
        url: f.imageUrl as string,
        label: `عکس غذا (${f.name || "—"} — ${f.meal || ""})`,
        note: "",
        createdAt: f.logDate,
      })),
      ...chatMedia.map((c) => ({
        id: c.id,
        // v53: ویدیوهای چت در فیلتر «ویدیو» هم دیده شوند (هم‌خوان با mediaCounts.video)
        kind: c.mediaType === "video" ? ("video" as const) : ("chat" as const),
        url: c.mediaUrl as string,
        label: c.mediaType === "video" ? "ویدیوی چت" : "عکس چت",
        note: "",
        createdAt: c.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // مجموع خرید کاربر از سایت — فقط پرداخت‌های موفق
    const successfulPayments = payments.filter((p) => p.status === "success");
    const totalPurchased = successfulPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // v150 — وضعیت سهمیهٔ بازطراحی برنامه از چت (برای نمایش/افزودن تعداد انتخابی ادمین)
    // holder = active اول، بعد pending — همان ترتیب getPlanRegenState (بدون import سنگین)
    const regenHolder =
      subscriptions.find((s: any) => s.status === "active" && new Date(s.endDate).getTime() > nowMs) ??
      subscriptions.find((s: any) => s.status === "pending" && (!s.endDate || new Date(s.endDate).getTime() > nowMs)) ??
      null;
    const regenPlan = (regenHolder?.plan as string | null) ?? user?.planName ?? null;
    const planRegen = {
      eligible: regenPlan === "advanced" || regenPlan === "ultimate",
      used: (regenHolder?.planRegenUsed ?? false) && (regenHolder?.planRegenExtra ?? 0) <= 0,
      pending: regenHolder?.planRegenPending ?? false,
      extra: regenHolder?.planRegenExtra ?? 0,
    };

    return Response.json({
      user,
      profile,
      // v75 — برچسب فارسی تجهیزات برای نمایش ادمین (مقدار خام equipment انگلیسی می‌ماند)
      equipmentLabel: equipmentListFa(profile?.equipment ?? null),
      subscriptions,
      workoutPlans: workoutPlanSummaries,
      mealPlans: mealPlanSummaries,
      checkups,
      weightLogs,
      programRequests,
      payments: payments.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
      })),
      totalPurchased,
      successfulPaymentCount: successfulPayments.length,
      // v157 — اطلاعات معرفی (رفرال) برای نمایش در پروفایل ادمین
      referral: {
        code: user.referralCode ?? null,
        rewardPaid: user.referralRewardPaid ?? false,
        invitedCount,
        invited: invitedUsers.map((u) => ({
          id: u.id,
          name: u.name,
          mobile: u.mobile,
          onboardingDone: u.onboardingDone,
          planName: u.planName,
          createdAt: u.createdAt,
        })),
        referrer: referrer
          ? { id: referrer.id, name: referrer.name, mobile: referrer.mobile, referralCode: referrer.referralCode }
          : null,
      },
      // v150 — وضعیت سهمیهٔ بازطراحی چت (دیرکتیو مالک: افزودن تعداد انتخابی)
      planRegen,
      // ─── v53: سهمیه‌های رسانهٔ کاربر (چت/غذا/ویدیو حرکات + بونوس ادمین) ───
      quota: await getUserQuotaSummary(id).catch(() => null),
      // ─── v15: گالری مدیا (تمام عکس/ویدیوهای آپلودشده کاربر) ───
      mediaGallery,
      mediaCounts: {
        total: mediaGallery.length,
        progress: progressPhotos.length,
        bodyPhoto: analysisMedia.filter((a) => a.type === "body_photo").length,
        bloodTest: analysisMedia.filter((a) => a.type === "blood_test").length,
        video: analysisMedia.filter((a) => a.type === "video_analysis").length + chatMedia.filter((c) => c.mediaType === "video").length,
        food: foodLogImages.length,
        chat: chatMedia.filter((c) => c.mediaType !== "video").length,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

/** تبدیل عدد به رشتهٔ فارسی (بدون وابستگی به types.ts در route ادمین) */
function toFaCount(n: number): string {
  const fa = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(n)
    .split("")
    .map((d) => fa[Number(d)] ?? d)
    .join("");
}

/**
 * PUT /api/admin/users/[id]/details
 * آپدیت اطلاعات کاربر توسط ادمین — v64 (دیریکتیو مالک: «مدیر باید بتونه همهٔ
 * اطلاعات کاربر رو ویرایش کنه از نام گرفته تا همهٔ اطلاعات آنبوردینگ»):
 *  ۱) تمام فیلدهای آنبوردینگ (whitelist پایین) — شامل specialConditions (جدید)
 *  ۲) نام کاربر (User.name)
 *  ۳) هر تغییری در داده‌های آنبوردینگ کشِ تحلیل AI (aiAnalysis) را باطل می‌کند
 *     تا تحلیلِ بعدی با داده‌های جدید بازتولید شود (نه متن قدیمی و ناسازگار).
 * فقط فیلدهای مجاز (whitelist) آپدیت می‌شوند.
 */
const ALLOWED_ONBOARDING_FIELDS = [
  "gender", "age", "height", "weight", "targetWeight", "goal",
  "activityLevel", "workoutDays", "workoutDaysList", "workoutPlace",
  "equipment", "diseases", "injuries", "allergies", "dietType",
  "trainingExperience", "previousTrainingType", "drugAllergies",
  "currentMedications", "maxLifts", "bodyFrame", "sleepHours", "stressLevel",
  "waterHabit", "targetDate", "workoutTime", "medicalConditions",
  "currentSupplements", "dislikedFoods", "preferredCuisine",
  "specialConditions",
  "bodyShape", "smokingHabit", "injuryAreas", "otherHealthIssues",
  "discipline",
  "neckMeasurement", "shoulderMeasurement", "calfMeasurement",
] as const;

/* ═══════════════════════════════════════════════════════════════════
 * 🩹 v166 — لایهٔ نرمال‌سازی/اعتبارسنجی سخت ورودی ادمین (ضد کلاس ۵۰۰)
 * دیرکتیو مالک: مدال «اتفاق غیرمنتظره رخ داد» دیگر هیچ‌جا نباید دیده شود.
 * ریشهٔ واقعی: فیلدهای whitelist «همین‌طوری» به Prisma می‌رفتند — پاک‌کردن
 * سن/قد/وزن/روزها در فرم null می‌فرستاد (ستون NOT NULL) یا «۷.۵» به ستون Int
 * می‌رفت → PrismaClientValidationError → 500. حالا هر فیلد با اسپکِ تایپ/
 * بازهٔ خودش نرمال می‌شود و ورودی خراب = 400 با پیام فارسیِ همان فیلد —
 * نه 500، نه کرش، نه خروج از فرم.
 * ═══════════════════════════════════════════════════════════════════ */

/** ارقام فارسی/عربی → لاتین (ورودی ادمین ممکن است با کیبورد فارسی تایپ شده باشد) */
function normalizeDigits(v: unknown): string {
  return String(v ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

interface NumericSpec { min: number; max: number; label: string; int: boolean; required: boolean }

const NUMERIC_SPECS: Record<string, NumericSpec> = {
  age: { min: 10, max: 100, label: "سن", int: true, required: true },
  height: { min: 100, max: 260, label: "قد", int: true, required: true },
  workoutDays: { min: 1, max: 7, label: "روزهای تمرین", int: true, required: true },
  weight: { min: 20, max: 400, label: "وزن", int: false, required: true },
  targetWeight: { min: 20, max: 400, label: "وزن هدف", int: false, required: false },
  sleepHours: { min: 0, max: 24, label: "خواب شبانه", int: true, required: false },
  stressLevel: { min: 1, max: 5, label: "سطح استرس", int: true, required: false },
  waterHabit: { min: 0, max: 50, label: "عادت آب", int: true, required: false },
  neckMeasurement: { min: 0, max: 300, label: "دور گردن", int: false, required: false },
  shoulderMeasurement: { min: 0, max: 300, label: "دور شانه", int: false, required: false },
  calfMeasurement: { min: 0, max: 300, label: "دور ساق", int: false, required: false },
};

/** فیلدهای JSON-string — آرایه/CSV/رشتهٔ JSON/خالی → JSON معتبر یا null (ستون‌های NOT NULL → "[]") */
const JSON_LIST_FIELDS: Record<string, { label: string; nullable: boolean }> = {
  equipment: { label: "تجهیزات", nullable: false },
  workoutDaysList: { label: "روزهای مشخص", nullable: false },
  medicalConditions: { label: "شرایط پزشکی", nullable: true },
};

/** فیلدهای متنی ساده — trim + سقف طول (ستون String/String?) */
const TEXT_FIELDS: Record<string, { label: string; max: number }> = {
  gender: { label: "جنسیت", max: 20 },
  goal: { label: "هدف", max: 60 },
  activityLevel: { label: "سطح فعالیت", max: 40 },
  workoutPlace: { label: "مکان تمرین", max: 40 },
  dietType: { label: "نوع رژیم", max: 40 },
  workoutTime: { label: "ساعت تمرین", max: 40 },
  preferredCuisine: { label: "سبک آشپزی", max: 40 },
  trainingExperience: { label: "سابقهٔ ورزشی", max: 60 },
  previousTrainingType: { label: "نوع تمرین قبلی", max: 120 },
  drugAllergies: { label: "حساسیت دارویی", max: 500 },
  currentMedications: { label: "داروهای فعلی", max: 500 },
  maxLifts: { label: "رکوردهای وزنه", max: 500 },
  bodyFrame: { label: "اندازهٔ استخوان", max: 40 },
  discipline: { label: "رشتهٔ ورزشی", max: 60 },
  diseases: { label: "بیماری‌ها", max: 500 },
  injuries: { label: "آسیب‌دیدگی", max: 500 },
  allergies: { label: "حساسیت غذایی", max: 500 },
  currentSupplements: { label: "مکمل‌های فعلی", max: 500 },
  dislikedFoods: { label: "غذاهای حذفی", max: 500 },
  specialConditions: { label: "توضیحات کاربر", max: 2000 },
  targetDate: { label: "تاریخ هدف", max: 40 },
};

/** کلاس خطای ورودی — به 400 فارسیِ فیلد-محور تبدیل می‌شود (هرگز 500) */
class FieldValidationError extends Error {}

function coerceNumericField(field: string, raw: unknown): number | null {
  const spec = NUMERIC_SPECS[field];
  const isEmpty = raw == null || raw === "" || (typeof raw === "string" && raw.trim() === "");
  if (isEmpty) {
    if (spec.required) throw new FieldValidationError(`«${spec.label}» نمی‌تواند خالی باشد.`);
    return null;
  }
  const n = Number(normalizeDigits(raw).trim().replace(/[،,]/g, ""));
  if (!Number.isFinite(n)) {
    throw new FieldValidationError(`«${spec.label}» باید عدد معتبر باشد.`);
  }
  const value = spec.int ? Math.round(n) : n;
  if (value < spec.min || value > spec.max) {
    throw new FieldValidationError(
      `«${spec.label}» باید بین ${spec.min} تا ${spec.max} باشد (مقدار ارسالی: ${n}).`
    );
  }
  return value;
}

function coerceJsonListField(field: string, raw: unknown): string | null {
  const spec = JSON_LIST_FIELDS[field];
  let parts: string[] = [];
  if (raw == null || raw === "") {
    parts = [];
  } else if (Array.isArray(raw)) {
    parts = raw.map((x) => String(x).trim()).filter(Boolean);
  } else {
    const t = String(raw).trim();
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) parts = p.map((x) => String(x).trim()).filter(Boolean);
      else parts = t.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
    } catch {
      parts = t.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  parts = parts.slice(0, 100).map((s) => s.slice(0, 200));
  if (parts.length === 0) return spec.nullable ? null : "[]";
  return JSON.stringify(parts).slice(0, 4000);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    // ─── ۱) نام کاربر (User.name) — v64 ───
    let nameUpdated = false;
    if (typeof body.name === "string") {
      const trimmedName = body.name.trim();
      if (trimmedName.length > 0 && trimmedName.length <= 60) {
        await db.user.update({ where: { id }, data: { name: trimmedName } });
        nameUpdated = true;
      } else if (trimmedName.length === 0) {
        return Response.json({ error: "نام نمی‌تواند خالی باشد." }, { status: 400 });
      }
    }

    // ساخت object آپدیت فقط با فیلدهای مجاز — v166: هر فیلد با اسپک خودش
    // نرمال/اعتبارسنجی می‌شود؛ ورودی خراب → 400 فارسی (هرگز 500 Prisma)
    const updateData: Record<string, any> = {};
    try {
      for (const field of ALLOWED_ONBOARDING_FIELDS) {
        if (!(field in body) || body[field] === undefined) continue;
        const spec = NUMERIC_SPECS[field];
        if (spec) {
          const v = coerceNumericField(field, body[field]);
          updateData[field] = v;
          continue;
        }
        if (field in JSON_LIST_FIELDS) {
          updateData[field] = coerceJsonListField(field, body[field]);
          continue;
        }
        if (field in TEXT_FIELDS) {
          const t = String(body[field] ?? "").trim();
          updateData[field] = t ? t.slice(0, TEXT_FIELDS[field].max) : null;
          continue;
        }
        updateData[field] = body[field];
      }
    } catch (e) {
      if (e instanceof FieldValidationError) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    // ─── v162 — نرمال‌سازی فیلدهای جدید پیش از Prisma ───
    // injuryAreas ستون String (JSON) است؛ آرایه/رشتهٔ خام → JSON معتبر کلیدهای
    // شناخته‌شده یا null (بدون این نرمال‌سازی، آرایهٔ خام به Prisma می‌رفت و
    // update با PrismaClientValidationError پنج‌صد می‌شد).
    const INJURY_AREA_KEYS = new Set(Object.keys(INJURY_AREA_LABELS_FA));
    const BODY_SHAPE_KEYS = new Set(Object.keys(BODY_SHAPE_LABELS_FA));
    const SMOKING_KEYS = new Set(Object.keys(SMOKING_HABIT_LABELS_FA));
    if ("injuryAreas" in updateData) {
      const raw = updateData.injuryAreas;
      const list: string[] = Array.isArray(raw)
        ? raw.map((x) => String(x))
        : String(raw ?? "").split(/[،,]/).map((s) => s.trim()).filter(Boolean);
      const clean = list.filter((k, i, arr) => INJURY_AREA_KEYS.has(k) && arr.indexOf(k) === i);
      updateData.injuryAreas = clean.length > 0 ? JSON.stringify(clean) : null;
    }
    for (const enumField of ["bodyShape", "smokingHabit"] as const) {
      if (enumField in updateData) {
        const allowed = enumField === "bodyShape" ? BODY_SHAPE_KEYS : SMOKING_KEYS;
        const v = typeof updateData[enumField] === "string" ? updateData[enumField].trim() : "";
        updateData[enumField] = v && allowed.has(v) ? v : null;
      }
    }
    if ("otherHealthIssues" in updateData) {
      updateData.otherHealthIssues =
        String(updateData.otherHealthIssues ?? "").trim().slice(0, 600) || null;
    }

    if (Object.keys(updateData).length === 0 && !nameUpdated) {
      return Response.json({ error: "هیچ فیلد معتبری برای آپدیت ارسال نشده است." }, { status: 400 });
    }

    // بررسی وجود پروفایل (فقط وقتی فیلد آنبوردینگی ارسال شده)
    let updated = null as any;
    if (Object.keys(updateData).length > 0) {
      const existing = await db.onboardingProfile.findUnique({ where: { userId: id } });
      if (!existing) {
        return Response.json({ error: "پروفایل آنبوردینگ برای این کاربر وجود ندارد." }, { status: 404 });
      }

      // v64 — هر تغییر در داده‌های آنبوردینگ، کشِ تحلیل AI را باطل می‌کند
      // (وگرنه کاربر متن تحلیل قدیمی — محاسبه‌شده روی وزن/قد/هدف قدیمی — می‌بیند)
      updateData.aiAnalysis = null;

      // 🩹 v166 — دفاع آخر: هر خطای Prisma در نوشتن = 400 با پیام صادقانه + ثبت
      // کامل در لاگ خطاها (هرگز 500 «اتفاق غیرمنتظره» به ادمین نشان داده نمی‌شود)
      try {
        updated = await db.onboardingProfile.update({
          where: { userId: id },
          data: updateData,
        });
      } catch (dbErr) {
        const { logError } = await import("@/lib/error-logger");
        await logError({
          source: "api",
          message: `admin details PUT prisma write failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          stack: dbErr instanceof Error ? dbErr.stack : undefined,
          statusCode: 400,
          userId: id,
        }).catch(() => {});
        return Response.json(
          { error: "ذخیره‌سازی اطلاعات با خطای داده مواجه شد — ورودی‌ها امن‌سازی شدند؛ لطفاً مقادیر را بررسی و دوباره تلاش کنید." },
          { status: 400 }
        );
      }
    }

    // نوتیف به کاربر مبنی بر ویرایش پروفایل توسط ادمین
    await db.notification.create({
      data: {
        userId: id,
        type: "system",
        title: "پروفایل شما توسط ادمین به‌روزرسانی شد ✅",
        body: "اطلاعات پروفایل و پرونده پزشکی شما توسط ادمین ویرایش شد. در صورت سوال، با پشتیبانی در ارتباط باشید.",
        read: false,
      },
    }).catch(() => {});

    return Response.json({
      ok: true,
      message: "اطلاعات کاربر با موفقیت به‌روزرسانی شد",
      updatedFields: Object.keys(updateData).filter((f) => f !== "aiAnalysis"),
      nameUpdated,
      updatedAt: updated?.updatedAt ?? new Date().toISOString(),
    });
  } catch (e) {
    return apiError(e);
  }
}
