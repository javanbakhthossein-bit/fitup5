import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { getUserQuotaSummary } from "@/lib/fitness/quota";
import { equipmentListFa } from "@/lib/fitness/types";
import { fixPlanTypographyDeep } from "@/lib/fitness/persian-typography";

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
    const { id } = await params;

    const [user, profile, subscriptions, workoutPlans, mealPlans, checkups, weightLogs, programRequests, payments, progressPhotos, analysisMedia, foodLogImages, chatMedia] =
      await Promise.all([
        db.user.findUnique({
          where: { id },
          select: {
            id: true, mobile: true, name: true, role: true, isBlocked: true,
            onboardingDone: true, planName: true, planExpiresAt: true, planStartedAt: true,
            walletBalance: true, videoAnalysisUsed: true, bloodTestUsed: true,
            bloodTestStatus: true, videoStatus: true,
            referralCode: true, referredById: true, createdAt: true,
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
          select: { id: true, plan: true, status: true, startDate: true, endDate: true, durationDays: true, pricePaid: true, discountCode: true, createdAt: true },
        }),
        // تمام برنامه‌های تمرینی (بدون take) — تاریخچه کامل خریدها
        db.workoutPlan.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          select: { id: true, weekIndex: true, active: true, createdAt: true, updatedAt: true, content: true },
        }),
        // تمام برنامه‌های غذایی (بدون take)
        db.mealPlan.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          select: { id: true, active: true, totalCal: true, dayLabel: true, createdAt: true, content: true },
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
          select: { id: true, plan: true, status: true, createdAt: true },
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
        supplementsCount = Array.isArray(content?.supplements) ? content.supplements.length : 0;
        supplementStackCount = Array.isArray(content?.supplementStack) ? content.supplementStack.length : 0;
      } catch {}
      return { ...mp, content: undefined, mealsCount, mealNames, supplementsCount, supplementStackCount };
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
  "discipline",
  "neckMeasurement", "shoulderMeasurement", "calfMeasurement",
] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
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

    // ساخت object آپدیت فقط با فیلدهای مجاز
    const updateData: Record<string, any> = {};
    for (const field of ALLOWED_ONBOARDING_FIELDS) {
      if (field in body && body[field] !== undefined) {
        updateData[field] = body[field];
      }
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

      updated = await db.onboardingProfile.update({
        where: { userId: id },
        data: updateData,
      });
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
