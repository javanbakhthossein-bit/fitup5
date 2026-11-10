import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";
import { createNotification } from "@/lib/fitness/notifications";
import { notifyProgramReadySms, notifyPlanPurchaseSms } from "@/lib/fitness/sms-flows";
import { SUBSCRIPTION_PLANS, toPersianDigits } from "@/lib/fitness/types";
import { PENDING_WINDOW_DAYS } from "@/lib/fitness/subscription";

/**
 * POST /api/admin/users/[id]/manage-subscription
 *
 * مدیریت اشتراک کاربر توسط ادمین. ۵ اکشن پشتیبانی می‌شود:
 *
 * ۱. action: "remove"
 *    - اشتراک فعال فعلی را به "expired" تغییر می‌دهد.
 *    - planName/planExpiresAt/planStartedAt روی User را null می‌کند.
 *    - نوتیف به کاربر ارسال می‌شود.
 *
 * ۲. action: "activate"
 *    - پلن جدید را فعال می‌کند (با تمام اتفاقات زمان خرید: اشتراک فعال، ProgramRequest، نوتیف).
 *    - پلن قبلی فعال را expire می‌کند.
 *    - body: { plan: "ultimate", days?: 45 }
 *    - اگر days ارسال نشود، از durationDays پلن استفاده می‌شود.
 *
 * ۳. action: "extend"
 *    - تعداد روز مشخص‌شده (days) را به اشتراک فعال فعلی اضافه می‌کند.
 *    - body: { days: 20 }
 *
 * ۴. action: "reduce"
 *    - تعداد روز مشخص‌شده (days) را از اشتراک فعال فعلی کم می‌کند.
 *    - body: { days: 20 }
 *
 * ۵. action: "activate_days"
 *    - یک پلن جدید را برای مدت مشخص (days) از الان فعال می‌کند.
 *    - body: { plan: "ultimate", days: 20 }
 *    - این اکشن برای آزمایش یا پاداش استفاده می‌شود.
 */
interface ManageBody {
  action: "remove" | "activate" | "extend" | "reduce" | "activate_days" | "force_logout";
  plan?: string; // basic | standard | advanced | ultimate
  days?: number;
}

const VALID_PLANS = ["basic", "standard", "advanced", "ultimate"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await requireAdminPerm("canManageUsers");
    const { id } = await params;
    const body = (await req.json()) as ManageBody;
    const action = body.action;

    // بررسی وجود کاربر
    const user = await db.user.findUnique({ where: { id } });
    if (!user) {
      return Response.json({ error: "کاربر یافت نشد." }, { status: 404 });
    }

    const now = new Date();

    // ─── اکشن ۰: ابطال همهٔ سشن‌های کاربر (v202 ممیزی M2) ───
    // sessionEpoch کاربر ++ می‌شود؛ همهٔ توکن‌های صادرشده قبلی (شامل توکنِ
    // سرقت‌شده) در اولین درخواست بعدی رد می‌شوند. کاربر فقط با ورود مجدد
    // (OTP/رمز) برمی‌گردد — بدون هیچ تغییری در داده‌های او.
    if (action === "force_logout") {
      const updated = await db.user.update({
        where: { id },
        data: { sessionEpoch: { increment: 1 } },
      });
      return Response.json({
        ok: true,
        action: "force_logout",
        sessionEpoch: updated.sessionEpoch,
      });
    }

    // ─── اکشن ۱: حذف پلن فعلی ───
    if (action === "remove") {
      // v202 ممیزی (H7) — کل فاز نوشتن در «یک تراکنش»: قبلاً اگر وسط مسیر خطا/کرش
      // رخ می‌داد، اشتراک‌ها منقضی شده بودند ولی planName کاربر باقی می‌ماند و
      // فال‌بک auth.ts (v77) دوباره پلن را «زنده» می‌کرد (کاربرِ لغوشده پلن رایگان).
      await db.$transaction(async (tx) => {
      // همه اشتراک‌های active/pending کاربر را expire کن (تاریخچه باقی می‌ماند)
      // مهم: endDate اصلی حفظ می‌شود (دیگر overwrite نمی‌شود) و به‌جای آن cancelledAt = now
      // تنظیم می‌کنیم. اینطبی در پنل کاربر، بازه واقعی برنامه نمایش داده می‌شود:
      // از startDate (شروع برنامه) تا cancelledAt (لحظه لغو توسط ادمین).
      await tx.subscription.updateMany({
        where: { userId: id, status: { in: ["active", "pending"] } },
        data: { status: "expired", cancelledAt: now },
      });
      // برنامه‌های تمرینی/غذایی فعال کاربر را به active=false تبدیل کن
      // (در تاریخچه باقی می‌مانند اما دیگر به‌عنوان «جاری» شناخته نمی‌شوند)
      await tx.workoutPlan.updateMany({
        where: { userId: id, active: true },
        data: { active: false },
      });
      await tx.mealPlan.updateMany({
        where: { userId: id, active: true },
        data: { active: false },
      });
      // درخواست‌های برنامه در حال انتظار/در حال تولید را لغو کن (pending_body_photo | generating | pending)
      // تا برنامه‌ای در پس‌زمینه ساخته نشود.
      await tx.programRequest.updateMany({
        where: {
          userId: id,
          status: { in: ["pending", "generating", "pending_body_photo"] },
        },
        data: { status: "failed" },
      });
      // پاک‌سازی فیلدهای پلن روی User (planName/planExpiresAt/planStartedAt = null)
      // مهم: planExpiresAt را null می‌کنیم چون planName=null است و کاربر بدون پلن است.
      // تاریخ لغو در subscription.endDate ذخیره شده و در برنامه‌ها/PDF از آنجا خوانده می‌شود.
      await tx.user.update({
        where: { id },
        data: {
          planName: null,
          planExpiresAt: null,
          planStartedAt: null,
        },
      });
      });
      await createNotification(
        id,
        "system",
        "اشتراک شما توسط ادمین لغو شد ⚠️",
        "اشتراک فعلی شما توسط ادمین غیرفعال شد. در صورت سوال، با پشتیبانی در ارتباط باشید.",
        "?tab=plans",
        { from: "admin", action: "remove" }
      );
      return Response.json({ ok: true, action: "remove" });
    }

    // ─── اکشن ۲: فعال‌سازی پلن جدید ───
    // این اکشن دقیقاً همان روال خرید موفق در /api/payment/verify را طی می‌کند:
    //   • اشتراک قبلی expire می‌شود.
    //   • اشتراک جدید ساخته می‌شود:
    //       - basic/standard → status="active" با startDate=now و endDate=now+durationDays.
    //       - advanced/ultimate → status="pending" با startDate/endDate=null (۴۵ روز از
    //         زمان تکمیل پیش‌نیازها شروع می‌شود — یعنی ارسال عکس بدن).
    //   • ProgramRequest ساخته می‌شود:
    //       - basic/standard → status="generating" و برنامه در پس‌زمینه تولید می‌شود.
    //       - advanced/ultimate → status="pending_body_photo" (تا زمان تکمیل پیش‌نیازها).
    //   • فیلدهای planName/planStartedAt/planExpiresAt روی User آپدیت می‌شود
    //     (برای advanced/ultimate مقدار null می‌شود تا در submit-body-analysis ست شود).
    //   • شمارنده‌های AI (videoAnalysisUsed, bloodTestUsed) و وضعیت‌های videoStatus/
    //     bloodTestStatus ریست می‌شوند.
    //   • نوتیف‌های لازم ارسال می‌شود (شامل نوتیف‌های پیش‌نیاز عکس بدن، آزمایش خون
    //     و ویدیو برای پلن ultimate — دقیقاً مثل خرید).
    if (action === "activate") {
      const planId = body.plan;
      if (!planId || !VALID_PLANS.includes(planId)) {
        return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
      }
      const planMeta = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
      if (!planMeta) {
        return Response.json({ error: "پلن یافت نشد." }, { status: 400 });
      }
      const durationDays =
        body.days && body.days > 0 ? Math.floor(body.days) : planMeta.durationDays;

      // بررسی پلن قبلی فعال (برای حفظ روزهای باقی‌مانده در صورت تمدید همان پلن)
      const oldActiveSub = await db.subscription.findFirst({
        where: { userId: id, status: "active" },
        orderBy: { endDate: "desc" },
      });
      let remainingDaysPreserved = 0;
      if (
        oldActiveSub?.endDate &&
        oldActiveSub.endDate.getTime() > now.getTime() &&
        oldActiveSub.plan === planId
      ) {
        const msLeft = oldActiveSub.endDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) remainingDaysPreserved = Math.min(daysLeft, durationDays);
      }

      // غیرفعال‌سازی اشتراک‌های قبلی (مثل خرید)
      await db.subscription.updateMany({
        where: { userId: id, status: "active" },
        data: { status: "expired" },
      });
      await db.subscription.updateMany({
        where: { userId: id, status: "pending" },
        data: { status: "cancelled" },
      });

      // آیا پلن نیاز به عکس بدن دارد؟
      const needsBodyPhoto = planId === "advanced" || planId === "ultimate";
      const canSubmitVideo = planId === "ultimate";

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + durationDays + remainingDaysPreserved);

      // ایجاد اشتراک جدید — منطق دقیقاً مثل /api/payment/verify
      if (needsBodyPhoto) {
        // پلن‌های advanced/ultimate: اشتراک pending — دوره اصلی از زمان تکمیل
        // پیش‌نیازها شروع می‌شود. endDate اینجا «پنجره pending» است (F3):
        // اگر کاربر در این پنجره عکس بدن نفرستد، اشتراک منقضی می‌شود.
        const pendingWindowEnd = new Date(now);
        pendingWindowEnd.setDate(pendingWindowEnd.getDate() + PENDING_WINDOW_DAYS);
        await db.subscription.create({
          data: {
            userId: id,
            plan: planId,
            status: "pending",
            startDate: null,
            endDate: pendingWindowEnd, // پنجره pending — هنگام فعال‌سازی با now+durationDays جایگزین می‌شود
            durationDays,
            pricePaid: 0, // ادمین فعال کرده — پرداخت نداشت
            discountCode: null,
          },
        });
      } else {
        // پلن‌های basic/standard: اشتراک فعال بلافاصله شروع می‌شود (پیش‌نیاز ندارد)
        await db.subscription.create({
          data: {
            userId: id,
            plan: planId,
            status: "active",
            startDate: now,
            endDate,
            durationDays,
            pricePaid: 0, // ادمین فعال کرده — پرداخت نداشت
            discountCode: null,
          },
        });
      }

      // آپدیت فیلدهای پلن روی User (مثل خرید موفق)
      // برای پلن‌های advanced/ultimate: planExpiresAt=null و planStartedAt=null (هنوز شروع نشده).
      // وقتی کاربر پیش‌نیازها را در submit-body-analysis تکمیل کند، این فیلدها ست می‌شوند.
      await db.user.update({
        where: { id },
        data: {
          planName: planId,
          planExpiresAt: needsBodyPhoto ? null : endDate,
          planStartedAt: needsBodyPhoto ? null : now,
          // ریست شمارنده‌های استفاده هوش مصنوعی
          videoAnalysisUsed: 0,
          bloodTestUsed: 0,
          // ریست وضعیت تعیین‌تکلیف ویدیو و آزمایش خون — برای پلن جدید کاربر باید دوباره تصمیم بگیرد
          videoStatus: null,
          bloodTestStatus: null,
        },
      });

      // ایجاد ProgramRequest جدید (مثل خرید موفق)
      const progReq = await db.programRequest.create({
        data: {
          userId: id,
          plan: planId,
          billingPeriod: "monthly",
          status: needsBodyPhoto ? "pending_body_photo" : "generating",
        },
      });

      // v44 — دیریکتیو مالک: فعال‌سازی پلن توسط مدیر باید مثل حالت خرید،
      // پیامک موفقیت خریدِ همان پلن را بفرستد (قالب‌های 423726/612405/565185).
      // دداپ با شناسهٔ ProgramRequest — هر فعال‌سازی فقط یک بار. غیرمسدودکننده.
      notifyPlanPurchaseSms(id, planId, progReq.id);

      // --- تولید برنامه بر اساس نوع پلن (دقیقاً مثل /api/payment/verify) ---
      if (needsBodyPhoto) {
        // بدون تولید برنامه — منتظر ارسال عکس‌های بدن توسط کاربر
        const noticeBody = canSubmitVideo
          ? "برای دریافت برنامه اختصاصی، ارسال عکس‌های بدن (۴ زاویه) الزامی است. ارسال ویدیوی فرم بدن اختیاری است — طبق آن برنامهٔ بدنسازی دقیقاً بر اساس بدن تو طراحی می‌شود. همچنین می‌توانید بعداً از بخش «آزمایش خون» در پنل، عکس آزمایش خون خود را برای تحلیل ارسال کنید (دلبخواه)."
          : "برای دریافت برنامه اختصاصی، عکس‌های بدن خود (۴ زاویه) را ارسال کنید. سپس فیتاپ هوشمند برنامه شما را طراحی می‌کند.";
        await createNotification(
          id,
          "system",
          "ارسال عکس بدن الزامی است 📸",
          noticeBody,
          "?tab=dashboard",
          { from: "admin", action: "activate_body_photo_required", plan: planId }
        );

        // نوتیف جداگانه برای آزمایش خون — فقط برای پلن Ultimate (اختیاری)
        if (canSubmitVideo) {
          await createNotification(
            id,
            "system",
            "آزمایش خون خود را ارسال کنید (اختیاری) 🩸",
            "برای داشتن یک برنامه ورزشی و تغذیه‌ای کاملاً شخصی‌سازی‌شده، می‌توانید آزمایش خون خود را به فیتاپ بسپارید. از بخش «آزمایش خون» در پنل، ابتدا فرم آزمایش را دانلود کرده و به آزمایشگاه ببرید. سپس یکی از گزینه‌ها را انتخاب کنید: آپلود عکس آزمایش، یا «آپلود نمی‌کنم».",
            "?tab=dashboard",
            { from: "admin", action: "activate_blood_test_optional", plan: planId }
          );

          // نوتیف جداگانه برای ویدیوی فرم بدن (اختیاری) — فقط Ultimate
          await createNotification(
            id,
            "system",
            "ارسال ویدیوی فرم بدن (اختیاری) 🎥",
            "برای دقت بالاتر در طراحی برنامه، می‌توانید ویدیویی از فرم اجرای حرکات خود ارسال کنید. این مرحله اختیاری است اما به مربی هوشمند کمک می‌کند نقاط ضعف فرم بدن شما را شناسایی کند. از بخش داشبورد می‌توانید ویدیو را آپلود کنید یا «آپلود نمی‌کنم» را انتخاب کنید. تا زمان تعیین تکلیف این مرحله، ساخت برنامه شما متوقف می‌ماند.",
            "?tab=dashboard",
            { from: "admin", action: "activate_video_optional", plan: planId }
          );
        }

        // نوتیف تشویقی برای اندازه‌های بدنی (اگر کاربر هنوز ندارد)
        try {
          const baselineCheckup = await db.checkup.findFirst({
            where: { userId: id, phaseNumber: 0 },
            orderBy: { createdAt: "desc" },
          });
          const hasMeasurements =
            !!baselineCheckup?.waistMeasurement &&
            !!baselineCheckup?.neckMeasurement;
          if (!hasMeasurements) {
            await createNotification(
              id,
              "system",
              "برای برنامه دقیق‌تر، اندازه‌های بدنی خود را وارد کنید 📏",
              "با وارد کردن دور کمر، گردن و سایر اندازه‌ها، فیتاپ هوشمند درصد چربی بدن شما را با فرمول علمی US Navy محاسبه می‌کند و برنامه دقیق‌تری طراحی می‌کند. می‌توانید این مرحله را رد کنید.",
              "?tab=progress",
              { from: "admin", action: "activate_measurements_tip", plan: planId }
            );
          }
        } catch (checkErr) {
          console.error(
            "[manage-subscription] baseline checkup lookup failed:",
            checkErr
          );
        }
      } else {
        // پلن‌های basic/standard — تولید برنامه در پس‌زمینه (fire-and-forget)
        const userIdBg = id;
        const progReqIdBg = progReq.id;
        const planIdBg = planId;
        const oldSubBg = oldActiveSub;

        void (async () => {
          try {
            const profile = await db.onboardingProfile.findUnique({
              where: { userId: userIdBg },
            });
            if (!profile) {
              // پروفایل آنبوردینگ موجود نیست — نمی‌توان برنامه ساخت (H3: نوتیف به کاربر)
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "failed" },
              });
              try {
                await createNotification(
                  userIdBg,
                  "system",
                  "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
                  "اطلاعات آنبوردینگ شما یافت نشد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
                  "?tab=programs",
                  { from: "admin", action: "activate_plan_failed", plan: planIdBg }
                );
              } catch {}
              return;
            }

            const { generateWorkoutPlan, generateMealPlan } = await import(
              "@/lib/fitness/ai"
            );
            // ─── v214 — هم‌راستاسازی کامل مسیر ادمین با موتور مشترک (دیرکتیو مالک:
            // «همه‌ی کانتکست‌ها مرتب و تمیز به AI تزریق بشه؛ مسیر مدیر هم باید
            // کامل باشد و هیچ باگی نداشته باشد») ───
            // قبلاً اینجا planData دستیِ ناقص (بدون mealCount/specialConditions/
            // discipline/bodyShape/smokingHabit/injuryAreas/otherHealthIssues/
            // nutritionNotes) و extras دستی (بدون weakPoints ساختاریافته، بدون
            // پروندهٔ ورزشی نردبانی، بدون تحلیل ویدیو) ساخته می‌شد. حالا همان
            // سازنده‌های موتور مشترک (program-generation) استفاده می‌شود تا برنامهٔ
            // ادمین عیناً هم‌کیفیت و هم‌کانتکستِ مسیر خود کاربر باشد.
            const { buildOnboardingData, buildGenerationExtras, buildWorkoutSyncContext } = await import(
              "@/lib/fitness/program-generation"
            );

            const planData = await buildOnboardingData(userIdBg);
            if (!planData) {
              // دفاعی — گارد profile بالا پاس شده؛ این هرگز عملاً رخ نمی‌دهد
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "failed" },
              });
              return;
            }
            const currentWeight = planData.weight ?? null;

            // غیرفعال‌سازی برنامه‌های قبلی
            await db.workoutPlan.updateMany({
              where: { userId: userIdBg },
              data: { active: false },
            });
            await db.mealPlan.updateMany({
              where: { userId: userIdBg },
              data: { active: false },
            });

            // extras کامل موتور مشترک: تحلیل عکس بدن (با weakPoints ساختاریافته) +
            // تحلیل ویدیو + آزمایش خون + بستر تمدید/بازتولید + «جای کاربر در مسیر» +
            // خلاصهٔ چت + گالری پیشرفت + پروندهٔ ورزشی نردبانی (v214 ممیزی کانتکست)
            const extras = await buildGenerationExtras(userIdBg);

            // v214 — سینک تمرین → تغذیه (الگوی موتور مشترک v112): اول تمرین ساخته
            // می‌شود، بعد تغذیه با خلاصهٔ فشردهٔ همان تمرین تا وعده‌ها دقیقاً
            // هم‌زمینهٔ برنامهٔ تمرینی تازه باشند.
            const workout = await generateWorkoutPlan(planData, planIdBg as any, extras);
            const workoutSyncCtx = buildWorkoutSyncContext(workout) ?? undefined;
            const meal = await generateMealPlan(planData, planIdBg as any, {
              ...extras,
              workoutContext: workoutSyncCtx,
            });

            await db.workoutPlan.create({
              data: {
                userId: userIdBg,
                content: JSON.stringify(workout),
                active: true,
                baseWeight: currentWeight ?? null,
              },
            });
            await db.mealPlan.create({
              data: {
                userId: userIdBg,
                content: JSON.stringify(meal),
                totalCal: meal.totalCalories,
                active: true,
                baseWeight: currentWeight ?? null,
              },
            });

            // به‌روزرسانی وضعیت درخواست برنامه به "ready"
            await db.programRequest.update({
              where: { id: progReqIdBg },
              data: { status: "ready" },
            });

            // نوتیفیکیشن آماده شدن برنامه (همراه با push PWA)
            // 🩹 v45: dedupe ۲۴ساعته — همان نوتیف از مسیرهای مختلف
            // (سوئیپ/watchdog/پرداخت) دوباره ساخته نشود (باگ نوتیف هر ۳۰ دقیقه)
            const _recentReadyNotif = await db.notification.findFirst({
              where: {
                userId: userIdBg,
                type: "achievement",
                title: "برنامه شما آماده شد! 🎯",
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              },
              select: { id: true },
            });
            if (!_recentReadyNotif) {
              await createNotification(
                userIdBg,
                "achievement",
                "برنامه شما آماده شد! 🎯",
                // v142 — متن یکسان با مسیر تولید عادی (dedupe) — هر سه برنامه ذکر شود
                "برنامه‌های تمرینی، تغذیه و مکمل شخصی‌سازی‌شدهٔ شما توسط فیتاپ هوشمند ساخته شد. از بخش‌های «تمرینات»، «تغذیه» و «مکمل» مشاهده کنید.",
                "?tab=programs"
              );
            }
            // v32: پیامک همزمان «برنامه آماده شد» (قالب 663678)
            // v66: دداپ بر چرخهٔ تولید — دورهٔ بعدی هم پیامک می‌گیرد
            notifyProgramReadySms(userIdBg, progReqIdBg);
            console.log(
              "[manage-subscription] background plan generation completed for user:",
              userIdBg
            );
          } catch (genErr) {
            console.error(
              "[manage-subscription] background plan generation failed:",
              genErr
            );
            try {
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "failed" },
              });
            } catch {}
            // H3: نوتیف به کاربر مبنی بر شکست تولید برنامه
            try {
              await createNotification(
                userIdBg,
                "system",
                "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
                "تولید برنامه ورزشی و غذایی شما با خطا مواجه شد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
                "?tab=programs",
                { from: "admin", action: "activate_plan_failed", plan: planIdBg }
              );
            } catch {}
          }
        })();
      }

      // نوتیفیکیشن اصلی فعال‌سازی (دقیقاً مثل خرید موفق)
      const preservedNote =
        remainingDaysPreserved > 0
          ? ` ${toPersianDigits(remainingDaysPreserved)} روز از اشتراک قبلی شما به اشتراک جدید اضافه شد 🎁`
          : "";
      const bodyText = needsBodyPhoto
        ? `پلن ${planMeta.label} توسط ادمین برای شما فعال شد. برای شروع دوره ${toPersianDigits(
            durationDays
          )} روزه، عکس‌های بدن خود را ارسال کنید.${preservedNote}`
        : `پلن ${planMeta.label} توسط ادمین برای شما فعال شد. تا ${endDate.toLocaleDateString(
            "fa-IR"
          )} فعال است.${preservedNote} برنامه شما در حال تولید توسط فیتاپ هوشمند است — به‌زودی آماده می‌شود.`;

      await createNotification(
        id,
        "subscription",
        needsBodyPhoto ? "پلن شما ثبت شد! ✅" : "پلن شما فعال شد! ✅",
        bodyText,
        "?tab=dashboard",
        {
          from: "admin",
          action: "activate",
          plan: planId,
          endDate: needsBodyPhoto ? null : endDate.toISOString(),
          remainingDaysPreserved,
        }
      );

      return Response.json({
        ok: true,
        action: "activate",
        plan: planId,
        endDate: needsBodyPhoto ? null : endDate.toISOString(),
        remainingDaysPreserved,
        needsBodyPhoto,
      });
    }

    // ─── اکشن ۳: تمدید (افزودن روز) ───
    if (action === "extend") {
      const days = Math.floor(Number(body.days));
      if (!Number.isFinite(days) || days <= 0) {
        return Response.json({ error: "تعداد روز باید عددی مثبت باشد." }, { status: 400 });
      }
      const activeSub = await db.subscription.findFirst({
        where: { userId: id, status: "active" },
        orderBy: { endDate: "desc" },
      });
      if (!activeSub || !activeSub.endDate) {
        return Response.json({ error: "اشتراک فعالی برای تمدید وجود ندارد." }, { status: 400 });
      }
      const newEndDate = new Date(activeSub.endDate.getTime() + days * 24 * 60 * 60 * 1000);
      await db.subscription.update({
        where: { id: activeSub.id },
        data: { endDate: newEndDate },
      });
      await db.user.update({
        where: { id },
        data: { planExpiresAt: newEndDate },
      });
      await createNotification(
        id,
        "subscription",
        `اشتراک شما ${days} روز تمدید شد 🎁`,
        `اشتراک ${activeSub.plan} شما ${days} روز توسط ادمین تمدید شد. تاریخ انقضای جدید: ${newEndDate.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}.`,
        "?tab=dashboard",
        { from: "admin", action: "extend", days, newEndDate: newEndDate.toISOString() }
      );
      return Response.json({
        ok: true,
        action: "extend",
        days,
        newEndDate: newEndDate.toISOString(),
      });
    }

    // ─── اکشن ۴: کاهش (کم کردن روز) ───
    if (action === "reduce") {
      const days = Math.floor(Number(body.days));
      if (!Number.isFinite(days) || days <= 0) {
        return Response.json({ error: "تعداد روز باید عددی مثبت باشد." }, { status: 400 });
      }
      const activeSub = await db.subscription.findFirst({
        where: { userId: id, status: "active" },
        orderBy: { endDate: "desc" },
      });
      if (!activeSub || !activeSub.endDate) {
        return Response.json({ error: "اشتراک فعالی برای کاهش وجود ندارد." }, { status: 400 });
      }
      const newEndDate = new Date(activeSub.endDate.getTime() - days * 24 * 60 * 60 * 1000);
      // اگر تاریخ جدید به قبل از الان رسید، اشتراک را expire کن
      // cancelledAt را هم set می‌کنیم تا نشان دهد این لغو توسط ادمین بوده.
      if (newEndDate.getTime() <= now.getTime()) {
        await db.subscription.update({
          where: { id: activeSub.id },
          data: { status: "expired", endDate: now, cancelledAt: now },
        });
        await db.user.update({
          where: { id },
          data: { planExpiresAt: now, planName: null },
        });
        await createNotification(
          id,
          "system",
          "اشتراک شما توسط ادمین کوتاه شد ⚠️",
          `اشتراک شما ${days} روز کوتاه شد و چون زمان باقی‌مانده کمتر بود، منقضی شد.`,
          "?tab=plans",
          { from: "admin", action: "reduce", days, expired: true }
        );
        return Response.json({
          ok: true,
          action: "reduce",
          days,
          expired: true,
        });
      }
      await db.subscription.update({
        where: { id: activeSub.id },
        data: { endDate: newEndDate },
      });
      await db.user.update({
        where: { id },
        data: { planExpiresAt: newEndDate },
      });
      await createNotification(
        id,
        "system",
        `اشتراک شما ${days} روز کوتاه شد ⚠️`,
        `اشتراک ${activeSub.plan} شما ${days} روز توسط ادمین کوتاه شد. تاریخ انقضای جدید: ${newEndDate.toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" })}.`,
        "?tab=dashboard",
        { from: "admin", action: "reduce", days, newEndDate: newEndDate.toISOString() }
      );
      return Response.json({
        ok: true,
        action: "reduce",
        days,
        newEndDate: newEndDate.toISOString(),
      });
    }

    // ─── اکشن ۵: فعال‌سازی پلن برای مدت مشخص ───
    // این اکشن دقیقاً همان منطق اکشن `activate` را طی می‌کند با این تفاوت که تعداد روزها
    // به‌جای planMeta.durationDays از body.days استفاده می‌کند. برای پلن‌های advanced/ultimate
    // (یعنی needsBodyPhoto=true):
    //   • اشتراک با status="pending" و startDate/endDate=null ساخته می‌شود (۴۵ روز از
    //     زمان تکمیل پیش‌نیازها شروع می‌شود).
    //   • ProgramRequest با status="pending_body_photo" ساخته می‌شود (تا زمان تکمیل پیش‌نیازها).
    //   • نوتیف‌های پیش‌نیاز (عکس بدن، آزمایش خون، ویدیو) ارسال می‌شود.
    //   • videoStatus/bloodTestStatus ریست می‌شود.
    // برای basic/standard:
    //   • اشتراک با status="active" و startDate=now, endDate=now+days ساخته می‌شود.
    //   • ProgramRequest با status="generating" ساخته و برنامه در پس‌زمینه تولید می‌شود.
    if (action === "activate_days") {
      const planId = body.plan;
      if (!planId || !VALID_PLANS.includes(planId)) {
        return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
      }
      const days = Math.floor(Number(body.days));
      if (!Number.isFinite(days) || days <= 0) {
        return Response.json({ error: "تعداد روز باید عددی مثبت باشد." }, { status: 400 });
      }
      const planMeta = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
      if (!planMeta) {
        return Response.json({ error: "پلن یافت نشد." }, { status: 400 });
      }

      const needsBodyPhoto = planId === "advanced" || planId === "ultimate";
      const canSubmitVideo = planId === "ultimate";

      // غیرفعال‌سازی اشتراک‌های قبلی
      await db.subscription.updateMany({
        where: { userId: id, status: "active" },
        data: { status: "expired" },
      });
      await db.subscription.updateMany({
        where: { userId: id, status: "pending" },
        data: { status: "cancelled" },
      });

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);

      // ایجاد اشتراک جدید — منطق دقیقاً مثل اکشن activate و /api/payment/verify
      if (needsBodyPhoto) {
        // پلن‌های advanced/ultimate: اشتراک pending — تعداد روزهای تعیین‌شده از زمان
        // تکمیل پیش‌نیازها. endDate اینجا «پنجره pending» است (F3).
        const pendingWindowEnd = new Date(now);
        pendingWindowEnd.setDate(pendingWindowEnd.getDate() + PENDING_WINDOW_DAYS);
        await db.subscription.create({
          data: {
            userId: id,
            plan: planId,
            status: "pending",
            startDate: null,
            endDate: pendingWindowEnd, // پنجره pending — هنگام فعال‌سازی با now+days جایگزین می‌شود
            durationDays: days,
            pricePaid: 0,
            discountCode: null,
          },
        });
      } else {
        // پلن‌های basic/standard: اشتراک فعال بلافاصله شروع می‌شود
        await db.subscription.create({
          data: {
            userId: id,
            plan: planId,
            status: "active",
            startDate: now,
            endDate,
            durationDays: days,
            pricePaid: 0,
            discountCode: null,
          },
        });
      }

      // آپدیت فیلدهای پلن روی User — ریست شمارنده‌ها و وضعیت‌ها (H4)
      await db.user.update({
        where: { id },
        data: {
          planName: planId,
          planExpiresAt: needsBodyPhoto ? null : endDate,
          planStartedAt: needsBodyPhoto ? null : now,
          // ریست شمارنده‌های استفاده هوش مصنوعی
          videoAnalysisUsed: 0,
          bloodTestUsed: 0,
          // ریست وضعیت تعیین‌تکلیف ویدیو و آزمایش خون — برای پلن جدید کاربر باید دوباره تصمیم بگیرد (H4)
          videoStatus: null,
          bloodTestStatus: null,
        },
      });

      // ایجاد ProgramRequest جدید
      const progReq = await db.programRequest.create({
        data: {
          userId: id,
          plan: planId,
          billingPeriod: "monthly",
          status: needsBodyPhoto ? "pending_body_photo" : "generating",
        },
      });

      // v44 — دیریکتیو مالک: مثل اکشن activate — پیامک خرید طبق پلن
      notifyPlanPurchaseSms(id, planId, progReq.id);

      if (needsBodyPhoto) {
        // بدون تولید برنامه — منتظر ارسال عکس‌های بدن توسط کاربر (H5: نوتیف‌های پیش‌نیاز)
        const noticeBody = canSubmitVideo
          ? "برای دریافت برنامه اختصاصی، ارسال عکس‌های بدن (۴ زاویه) الزامی است. ارسال ویدیوی فرم بدن اختیاری است — طبق آن برنامهٔ بدنسازی دقیقاً بر اساس بدن تو طراحی می‌شود. همچنین می‌توانید بعداً از بخش «آزمایش خون» در پنل، عکس آزمایش خون خود را برای تحلیل ارسال کنید (دلبخواه)."
          : "برای دریافت برنامه اختصاصی، عکس‌های بدن خود (۴ زاویه) را ارسال کنید. سپس فیتاپ هوشمند برنامه شما را طراحی می‌کند.";
        await createNotification(
          id,
          "system",
          "ارسال عکس بدن الزامی است 📸",
          noticeBody,
          "?tab=dashboard",
          { from: "admin", action: "activate_days_body_photo_required", plan: planId }
        );

        // نوتیف جداگانه برای آزمایش خون — فقط برای پلن Ultimate (اختیاری)
        if (canSubmitVideo) {
          await createNotification(
            id,
            "system",
            "آزمایش خون خود را ارسال کنید (اختیاری) 🩸",
            "برای داشتن یک برنامه ورزشی و تغذیه‌ای کاملاً شخصی‌سازی‌شده، می‌توانید آزمایش خون خود را به فیتاپ بسپارید. از بخش «آزمایش خون» در پنل، ابتدا فرم آزمایش را دانلود کرده و به آزمایشگاه ببرید. سپس یکی از گزینه‌ها را انتخاب کنید: آپلود عکس آزمایش، یا «آپلود نمی‌کنم».",
            "?tab=dashboard",
            { from: "admin", action: "activate_days_blood_test_optional", plan: planId }
          );

          // نوتیف جداگانه برای ویدیوی فرم بدن (اختیاری) — فقط Ultimate
          await createNotification(
            id,
            "system",
            "ارسال ویدیوی فرم بدن (اختیاری) 🎥",
            "برای دقت بالاتر در طراحی برنامه، می‌توانید ویدیویی از فرم اجرای حرکات خود ارسال کنید. این مرحله اختیاری است اما به مربی هوشمند کمک می‌کند نقاط ضعف فرم بدن شما را شناسایی کند. از بخش داشبورد می‌توانید ویدیو را آپلود کنید یا «آپلود نمی‌کنم» را انتخاب کنید. تا زمان تعیین تکلیف این مرحله، ساخت برنامه شما متوقف می‌ماند.",
            "?tab=dashboard",
            { from: "admin", action: "activate_days_video_optional", plan: planId }
          );
        }

        // نوتیف تشویقی برای اندازه‌های بدنی (اگر کاربر هنوز ندارد)
        try {
          const baselineCheckup = await db.checkup.findFirst({
            where: { userId: id, phaseNumber: 0 },
            orderBy: { createdAt: "desc" },
          });
          const hasMeasurements =
            !!baselineCheckup?.waistMeasurement &&
            !!baselineCheckup?.neckMeasurement;
          if (!hasMeasurements) {
            await createNotification(
              id,
              "system",
              "برای برنامه دقیق‌تر، اندازه‌های بدنی خود را وارد کنید 📏",
              "با وارد کردن دور کمر، گردن و سایر اندازه‌ها، فیتاپ هوشمند درصد چربی بدن شما را با فرمول علمی US Navy محاسبه می‌کند و برنامه دقیق‌تری طراحی می‌کند. می‌توانید این مرحله را رد کنید.",
              "?tab=progress",
              { from: "admin", action: "activate_days_measurements_tip", plan: planId }
            );
          }
        } catch (checkErr) {
          console.error(
            "[manage-subscription] activate_days baseline checkup lookup failed:",
            checkErr
          );
        }
      } else {
        // پلن‌های basic/standard — تولید برنامه در پس‌زمینه (fire-and-forget)
        const userIdBg = id;
        const progReqIdBg = progReq.id;
        const planIdBg = planId;

        void (async () => {
          try {
            const profile = await db.onboardingProfile.findUnique({
              where: { userId: userIdBg },
            });
            if (!profile) {
              // پروفایل آنبوردینگ موجود نیست — نمی‌توان برنامه ساخت (H3: نوتیف به کاربر)
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "failed" },
              });
              try {
                await createNotification(
                  userIdBg,
                  "system",
                  "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
                  "اطلاعات آنبوردینگ شما یافت نشد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
                  "?tab=programs",
                  { from: "admin", action: "activate_days_plan_failed", plan: planIdBg }
                );
              } catch {}
              return;
            }

            const { generateWorkoutPlan, generateMealPlan } = await import(
              "@/lib/fitness/ai"
            );
            // ─── v214 — هم‌راستاسازی کامل مسیر activate_days با موتور مشترک ───
            // قبلاً اینجا extras = {} بود (کم‌کانتکست‌ترین مسیر کل سیستم) و planData
            // دستیِ ناقص (بدون mealCount/specialConditions/discipline/bodyShape/
            // smokingHabit/injuryAreas/otherHealthIssues/nutritionNotes/اندازه‌ها).
            // حالا سازنده‌های موتور مشترک — برنامهٔ ادمین هم‌کانتکستِ مسیر کاربر است.
            const { buildOnboardingData, buildGenerationExtras, buildWorkoutSyncContext } = await import(
              "@/lib/fitness/program-generation"
            );

            const planData = await buildOnboardingData(userIdBg);
            if (!planData) {
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "failed" },
              });
              return;
            }
            const currentWeight = planData.weight ?? null;

            // غیرفعال‌سازی برنامه‌های قبلی
            await db.workoutPlan.updateMany({
              where: { userId: userIdBg },
              data: { active: false },
            });
            await db.mealPlan.updateMany({
              where: { userId: userIdBg },
              data: { active: false },
            });

            // extras کامل موتور مشترک (v214 ممیزی کانتکست — دیرکتیو مالک)
            const extras = await buildGenerationExtras(userIdBg);

            // سینک تمرین → تغذیه (الگوی موتور مشترک v112)
            const workout = await generateWorkoutPlan(planData, planIdBg as any, extras);
            const workoutSyncCtx = buildWorkoutSyncContext(workout) ?? undefined;
            const meal = await generateMealPlan(planData, planIdBg as any, {
              ...extras,
              workoutContext: workoutSyncCtx,
            });

            await db.workoutPlan.create({
              data: {
                userId: userIdBg,
                content: JSON.stringify(workout),
                active: true,
                baseWeight: currentWeight ?? null,
              },
            });
            await db.mealPlan.create({
              data: {
                userId: userIdBg,
                content: JSON.stringify(meal),
                totalCal: meal.totalCalories,
                active: true,
                baseWeight: currentWeight ?? null,
              },
            });

            // به‌روزرسانی وضعیت درخواست برنامه به "ready"
            await db.programRequest.update({
              where: { id: progReqIdBg },
              data: { status: "ready" },
            });

            // نوتیفیکیشن آماده شدن برنامه (همراه با push PWA)
            // 🩹 v45: dedupe ۲۴ساعته — همان نوتیف از مسیرهای مختلف
            // (سوئیپ/watchdog/پرداخت) دوباره ساخته نشود (باگ نوتیف هر ۳۰ دقیقه)
            const _recentReadyNotif = await db.notification.findFirst({
              where: {
                userId: userIdBg,
                type: "achievement",
                title: "برنامه شما آماده شد! 🎯",
                createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              },
              select: { id: true },
            });
            if (!_recentReadyNotif) {
              await createNotification(
                userIdBg,
                "achievement",
                "برنامه شما آماده شد! 🎯",
                // v142 — متن یکسان با مسیر تولید عادی (dedupe) — هر سه برنامه ذکر شود
                "برنامه‌های تمرینی، تغذیه و مکمل شخصی‌سازی‌شدهٔ شما توسط فیتاپ هوشمند ساخته شد. از بخش‌های «تمرینات»، «تغذیه» و «مکمل» مشاهده کنید.",
                "?tab=programs"
              );
            }
            // v32: پیامک همزمان «برنامه آماده شد» (قالب 663678)
            // v66: دداپ بر چرخهٔ تولید — دورهٔ بعدی هم پیامک می‌گیرد
            notifyProgramReadySms(userIdBg, progReqIdBg);
            console.log(
              "[manage-subscription] activate_days background plan generation completed for user:",
              userIdBg
            );
          } catch (genErr) {
            console.error(
              "[manage-subscription] activate_days background plan generation failed:",
              genErr
            );
            try {
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "failed" },
              });
            } catch {}
            // H3: نوتیف به کاربر مبنی بر شکست تولید برنامه
            try {
              await createNotification(
                userIdBg,
                "system",
                "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
                "تولید برنامه ورزشی و غذایی شما با خطا مواجه شد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
                "?tab=programs",
                { from: "admin", action: "activate_days_plan_failed", plan: planIdBg }
              );
            } catch {}
          }
        })();
      }

      // نوتیفیکیشن اصلی فعال‌سازی
      const bodyText = needsBodyPhoto
        ? `پلن ${planMeta.label} توسط ادمین برای ${toPersianDigits(
            days
          )} روز (از زمان تکمیل پیش‌نیازها) فعال شد. برای شروع دوره، عکس‌های بدن خود را ارسال کنید.`
        : `پلن ${planMeta.label} توسط ادمین برای ${toPersianDigits(
            days
          )} روز فعال شد. تا ${endDate.toLocaleDateString(
            "fa-IR"
          )} فعال است. برنامه شما در حال تولید توسط فیتاپ هوشمند است — به‌زودی آماده می‌شود.`;

      await createNotification(
        id,
        "subscription",
        needsBodyPhoto ? "پلن شما ثبت شد! ✅" : "پلن شما فعال شد! ✅",
        bodyText,
        "?tab=dashboard",
        {
          from: "admin",
          action: "activate_days",
          plan: planId,
          days,
          endDate: needsBodyPhoto ? null : endDate.toISOString(),
          needsBodyPhoto,
        }
      );

      return Response.json({
        ok: true,
        action: "activate_days",
        plan: planId,
        days,
        endDate: needsBodyPhoto ? null : endDate.toISOString(),
        needsBodyPhoto,
      });
    }

    return Response.json({ error: "اکشن نامعتبر است." }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
