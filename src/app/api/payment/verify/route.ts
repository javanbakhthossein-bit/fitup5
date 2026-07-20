import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError, buildUserDto } from "@/lib/fitness/auth";
import { SUBSCRIPTION_PLANS, toPersianDigits, type Plan } from "@/lib/fitness/types";
import { zarinpalVerify, isZarinpalConfigured } from "@/lib/fitness/zarinpal";
import { processReferralReward } from "@/lib/fitness/referral";

interface VerifyBody {
  paymentId: string;
  status: "OK" | "NOK" | "CANCELLED";
  /** برای callback زرین‌پال: authority واقعی که از URL برمی‌گردد */
  authority?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = (await req.json()) as VerifyBody;

    const payment = await db.payment.findFirst({
      where: { id: body.paymentId, userId: user.id },
    });
    if (!payment) {
      return Response.json({ error: "پرداخت یافت نشد." }, { status: 404 });
    }
    if (payment.status !== "pending") {
      return Response.json(
        { error: "این پرداخت قبلاً پردازش شده است." },
        { status: 400 }
      );
    }

    // --- انصراف کاربر ---
    if (body.status === "CANCELLED") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "cancelled", verifiedAt: new Date() },
      });
      return Response.json({
        success: false,
        status: "cancelled",
        message: "پرداخت لغو شد.",
      });
    }

    // --- پرداخت ناموفق ---
    if (body.status === "NOK") {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "failed", verifiedAt: new Date() },
      });
      return Response.json({
        success: false,
        status: "failed",
        message: "پرداخت ناموفق بود.",
      });
    }

    // --- پرداخت موفق ---
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === payment.plan);
    if (!plan) {
      return Response.json({ error: "پلن نامعتبر است." }, { status: 400 });
    }

    // تعیین refId:
    // - اگر paymentMethod === "wallet" → تایید آنی (نیازی به زرین‌پال نیست)
    // - اگر gateway → verify API واقعی زرین‌پال را صدا بزن (هیچ شبیه‌سازی‌ای نیست)
    let refId: string | null = null;
    let verifyError: string | null = null;

    if (payment.paymentMethod === "gateway") {
      if (!isZarinpalConfigured()) {
        await db.payment.update({
          where: { id: payment.id },
          data: { status: "failed", verifiedAt: new Date() },
        });
        return Response.json({
          success: false,
          status: "failed",
          message: "درگاه پرداخت پیکربندی نشده است.",
        });
      }

      const authorityToVerify = body.authority ?? payment.authority;
      if (!authorityToVerify) {
        await db.payment.update({
          where: { id: payment.id },
          data: { status: "failed", verifiedAt: new Date() },
        });
        return Response.json({
          success: false,
          status: "failed",
          message: "کد مرجع پرداخت (authority) یافت نشد.",
        });
      }

      const zRes = await zarinpalVerify({
        authority: authorityToVerify,
        amount: payment.amount, // Tomans
      });

      if (zRes.ok) {
        refId = zRes.refId ?? `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      } else {
        // تایید ناموفق — پرداخت واقعاً ناموفق است
        verifyError = zRes.error ?? "Zarinpal verify failed";
        await db.payment.update({
          where: { id: payment.id },
          data: {
            status: "failed",
            verifiedAt: new Date(),
            refId: zRes.refId ?? null,
          },
        });
        return Response.json({
          success: false,
          status: "failed",
          message: `تأیید پرداخت توسط زرین‌پال ناموفق بود: ${verifyError}`,
          refId: zRes.refId,
        });
      }

      // ذخیره اطلاعات کارت و کارمزد از پاسخ verify (طبق مستندات زرین‌پال)
      if (zRes.cardPan || zRes.cardHash || zRes.fee != null) {
        await db.payment.update({
          where: { id: payment.id },
          data: {
            cardPan: zRes.cardPan ?? null,
            cardHash: zRes.cardHash ?? null,
            fee: zRes.fee ?? null,
          },
        });
      }
    } else {
      // wallet payment — refId محلی
      refId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    }

    const now = new Date();

    // اگر پرداخت از کیف پول، مبلغ را از موجودی کسر و تراکنش ثبت کن
    let newBalance = 0;
    if (payment.paymentMethod === "wallet") {
      const freshUser = await db.user.findUnique({ where: { id: user.id } });
      const balance = freshUser?.walletBalance ?? 0;
      if (balance < payment.amount) {
        await db.payment.update({
          where: { id: payment.id },
          data: { status: "failed", verifiedAt: now },
        });
        return Response.json({
          success: false,
          status: "failed",
          message: "موجودی کیف پول در زمان تایید کافی نبود.",
        });
      }
      newBalance = balance - payment.amount;
      await db.user.update({
        where: { id: user.id },
        data: { walletBalance: newBalance },
      });
      await db.walletTransaction.create({
        data: {
          userId: user.id,
          type: "purchase",
          amount: -payment.amount,
          balance: newBalance,
          description: `خرید پلن ${plan.label}`,
          refId: payment.id,
        },
      });
    }

    // آپدیت وضعیت پرداخت به success
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "success",
        refId,
        verifiedAt: now,
      },
    });

    // محاسبه تاریخ انقضا بر اساس durationDays پلن
    // در صورت تمدید (خرید همان پلن قبلی)، روزهای باقی‌مانده به اشتراک جدید اضافه می‌شوند.
    // در صورت ارتقا یا دانگرید (پلن متفاوت)، 45 روز کامل از پلن جدید شروع می‌شود.
    let remainingDaysPreserved = 0;
    const oldActiveSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "active" },
      orderBy: { endDate: "desc" },
    });
    if (oldActiveSub && oldActiveSub.endDate && oldActiveSub.endDate.getTime() > now.getTime()) {
      // فقط در صورت تمدید همان پلن (same plan)، روزهای باقی‌مانده حفظ می‌شود
      if (oldActiveSub.plan === plan.id) {
        const msLeft = oldActiveSub.endDate.getTime() - now.getTime();
        const daysLeftOld = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
        if (daysLeftOld > 0) {
          remainingDaysPreserved = Math.min(daysLeftOld, plan.durationDays);
        }
      }
      // در صورت ارتقا یا دانگرید (پلن متفاوت)، remainingDaysPreserved = 0
      // یعنی 45 روز کامل از پلن جدید شروع می‌شود
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays + remainingDaysPreserved);

    // غیرفعال کردن اشتراک‌های قبلی فعال
    await db.subscription.updateMany({
      where: { userId: user.id, status: "active" },
      data: { status: "expired" },
    });
    // همچنین اشتراک‌های pending قبلی را هم cancel کن (در صورت وجود)
    await db.subscription.updateMany({
      where: { userId: user.id, status: "pending" },
      data: { status: "cancelled" },
    });

    // ─── ۴۵ روز از تکمیل پیش‌نیازها (وظیفه ۲) ───
    // برای پلن‌های advanced/ultimate که نیاز به عکس بدن دارند، اشتراک را با
    // status="pending" و startDate/endDate=null می‌سازیم. وقتی کاربر پیش‌نیازها را
    // تکمیل کرد (در submit-body-analysis)، اشتراک به status="active" تبدیل شده و
    // startDate=now و endDate=now+45day تنظیم می‌شود.
    const needsBodyPhoto = plan.id === "advanced" || plan.id === "ultimate";

    if (needsBodyPhoto) {
      // اشتراک pending — ۴۵ روز از زمان تکمیل پیش‌نیازها شروع می‌شود
      await db.subscription.create({
        data: {
          userId: user.id,
          plan: plan.id,
          status: "pending",
          startDate: null,
          endDate: null,
          durationDays: plan.durationDays,
          pricePaid: payment.amount,
          discountCode: payment.discountCode,
        },
      });
    } else {
      // پلن‌های basic/standard: اشتراک فعال بلافاصله شروع می‌شود (پیش‌نیاز ندارند)
      await db.subscription.create({
        data: {
          userId: user.id,
          plan: plan.id,
          status: "active",
          startDate: now,
          endDate,
          durationDays: plan.durationDays,
          pricePaid: payment.amount,
          discountCode: payment.discountCode,
        },
      });
    }

    // آپدیت فیلدهای پلن روی User (برای دسترسی سریع)
    // برای پلن‌های advanced/ultimate: planExpiresAt=null (هنوز شروع نشده) و planStartedAt=null.
    // وقتی کاربر پیش‌نیازها را تکمیل کرد (submit-body-analysis)، این فیلدها به‌روزرسانی می‌شوند.
    await db.user.update({
      where: { id: user.id },
      data: {
        planName: plan.id,
        planExpiresAt: needsBodyPhoto ? null : endDate,
        planStartedAt: needsBodyPhoto ? null : now,
        // ریست شمارنده‌های استفاده هوش مصنوعی
        videoAnalysisUsed: 0,
        bloodTestUsed: 0,
        // ریست وضعیت تعیین‌تکلیف ویدیو و آزمایش خون — برای پلن جدید کاربر باید دوباره تصمیم بگیرد.
        // (اگر کاربر قبلاً ویدیو/آزمایش آپلود کرده باشد، رکوردهای AnalysisResult باقی می‌مانند،
        // اما تعیین‌تکلیفExplicit برای پلن جدید لازم است تا برنامه‌ی پلن جدید ساخته شود.)
        videoStatus: null,
        bloodTestStatus: null,
      },
    });

    // ایجاد درخواست برنامه جدید با وضعیت "در حال تولید"
    const progReq = await db.programRequest.create({
      data: {
        userId: user.id,
        plan: plan.id,
        billingPeriod: "monthly",
        status: "generating",
        paymentId: payment.id,
      },
    });

    // اگر کد تخفیف استفاده شده، شمارش استفاده را افزایش بده
    if (payment.discountCode) {
      // اول در جدول کدهای اختصاصی کاربر بررسی کن
      const udc = await db.userDiscountCode.findUnique({ where: { code: payment.discountCode } });
      if (udc) {
        await db.userDiscountCode.update({
          where: { id: udc.id },
          data: { isUsed: true },
        });
      } else {
        // در غیر این صورت کد عمومی است
        await db.discountCode.updateMany({
          where: { code: payment.discountCode },
          data: { usedCount: { increment: 1 } },
        });
      }
    }

    // --- پردازش تولید برنامه بر اساس پلن ---
    // • Basic / Standard: تولید خودکار برنامه بلافاصله انجام می‌شود.
    // • Advanced / Ultimate: نیازمند عکس بدن قبل از تولید برنامه — وضعیت pending_body_photo
    //   (ویدیو برای Ultimate اختیاری است، نه الزامی. آزمایش خون کاملاً دلبخواه است و
    //    در بخش جداگانه‌ای از پنل قابل ارسال است و هرگز برای تولید برنامه الزامی نیست.)
    // (needsBodyPhoto قبلاً در بالا تعریف شده — برای پلن‌های advanced/ultimate اشتراک
    // با status="pending" ساخته شده است.)
    const canSubmitVideo = plan.id === "ultimate";

    let planGenerationOk = false;

    if (needsBodyPhoto) {
      // بدون تولید برنامه — منتظر ارسال عکس‌های بدن توسط کاربر
      // (ویدیو برای Ultimate اختیاری است؛ بنابراین هر دو پلن از pending_body_photo استفاده می‌کنند)
      await db.programRequest.update({
        where: { id: progReq.id },
        data: { status: "pending_body_photo" },
      });

      const noticeBody = canSubmitVideo
        ? "برای دریافت برنامه اختصاصی، ارسال عکس‌های بدن (۴ زاویه) الزامی است. ارسال ویدیوی فرم حرکات اختیاری است اما به دقت برنامه کمک می‌کند. همچنین می‌توانید بعداً از بخش «آزمایش خون» در پنل، عکس آزمایش خون خود را برای تحلیل ارسال کنید (دلبخواه)."
        : "برای دریافت برنامه اختصاصی، عکس‌های بدن خود (۴ زاویه) را ارسال کنید. سپس فیتاپ هوشمند برنامه شما را طراحی می‌کند.";

      await db.notification.create({
        data: {
          userId: user.id,
          type: "system",
          title: "ارسال عکس بدن الزامی است 📸",
          body: noticeBody,
          link: "?tab=dashboard",
          read: false,
        },
      });

      // ─── NEW (FIX-FLICKER-CARDS-SCROLL-BLOODTEST): نوتیفیکیشن جداگانه برای
      // آزمایش خون — فقط برای پلن Ultimate. کاربر می‌تواند فرم آزمایش را دانلود
      // کند، یا آزمایش بدهد و منتظر جواب بماند، یا اصلاً آپلود نکند. ───
      if (canSubmitVideo) {
        await db.notification.create({
          data: {
            userId: user.id,
            type: "system",
            title: "آزمایش خون خود را ارسال کنید (اختیاری) 🩸",
            body:
              "برای داشتن یک برنامه ورزشی و تغذیه‌ای کاملاً شخصی‌سازی‌شده، می‌توانید آزمایش خون خود را به فیتاپ بسپارید. " +
              "از بخش «آزمایش خون» در پنل، ابتدا فرم آزمایش را دانلود کرده و به آزمایشگاه ببرید. " +
              "سپس یکی از گزینه‌ها را انتخاب کنید: «آزمایش دادم و منتظر جوابم» (تا آپلود نتایج، تولید برنامه متوقف می‌ماند) یا «آپلود نمی‌کنم» (برنامه بدون آزمایش خون طراحی می‌شود).",
            link: "?tab=dashboard",
            read: false,
          },
        });

        // ─── NEW (VIDEO-PREREQUISITE): نوتیفیکیشن جداگانه برای ویدیوی فرم حرکات
        // (اختیاری) — فقط برای پلن Ultimate. کاربر باید حداقل یک تصمیم بگیرد:
        // یا ویدیو را آپلود کند (همراه با عکس‌های بدن در همان فرم) یا "آپلود نمی‌کنم"
        // را بزند. تا زمان تعیین‌تکلیف، تولید برنامه متوقف می‌ماند. ───
        await db.notification.create({
          data: {
            userId: user.id,
            type: "system",
            title: "ارسال ویدیوی فرم حرکات (اختیاری) 🎥",
            body:
              "برای دقت بالاتر در طراحی برنامه، می‌توانید ویدیویی از فرم اجرای حرکات خود ارسال کنید. این مرحله اختیاری است اما به مربی هوشمند کمک می‌کند نقاط ضعف فرم بدن شما را شناسایی کند. " +
              "از بخش داشبورد می‌توانید ویدیو را آپلود کنید یا «آپلود نمی‌کنم» را انتخاب کنید. " +
              "تا زمان تعیین تکلیف این مرحله، ساخت برنامه شما متوقف می‌ماند.",
            link: "?tab=dashboard",
            read: false,
          },
        });
      }

      // ─── NEW (BODY-COMPOSITION-PRO): اگر کاربر هنوز اندازه‌های بدنی ندارد،
      // نوتیفیکیشن جداگانه برای تشویق به وارد کردن اندازه‌ها ارسال می‌کنیم. ───
      const baselineCheckup = await db.checkup.findFirst({
        where: { userId: user.id, phaseNumber: 0 },
        orderBy: { createdAt: "desc" },
      });
      const hasMeasurements =
        !!baselineCheckup?.waistMeasurement && !!baselineCheckup?.neckMeasurement;
      if (!hasMeasurements) {
        await db.notification.create({
          data: {
            userId: user.id,
            type: "system",
            title: "برای برنامه دقیق‌تر، اندازه‌های بدنی خود را وارد کنید 📏",
            body: "با وارد کردن دور کمر، گردن و سایر اندازه‌ها، فیتاپ هوشمند درصد چربی بدن شما را با فرمول علمی US Navy محاسبه می‌کند و برنامه دقیق‌تری طراحی می‌کند. می‌توانید این مرحله را رد کنید.",
            link: "?tab=progress",
            read: false,
          },
        });
      }
    } else {
      // --- تولید برنامه در پس‌زمینه (BACKGROUND) ---
      // IMPORTANT: برنامه‌سازی توسط AI حدود ۲۰ ثانیه طول می‌کشد.
      // اگر اینجا صبر کنیم، کاربر ۲۰ ثانیه صفحه لودینگ می‌بیند و پنل فعال نمی‌شود.
      // راه‌حل: تولید برنامه را در پس‌زمینه (fire-and-forget) انجام می‌دهیم و
      // فوری پاسخ موفقیت برمی‌گردانیم تا کاربر پنل را ببیند.
      // وقتی برنامه آماده شد، نوتیفیکیشن «برنامه آماده شد» ارسال می‌شود.
      // کاربر در صفحه برنامه‌ها وضعیت «در حال تولید...» را می‌بیند.
      try {
        const profile = await db.onboardingProfile.findUnique({ where: { userId: user.id } });
        if (profile) {
          // ساخت OnboardingData از پروفایل ذخیره‌شده
          const { generateWorkoutPlan, generateMealPlan } = await import("@/lib/fitness/ai");

          // local parsers (same as in onboarding route)
          const parseEquip = (raw: string | null | undefined): string[] => {
            if (!raw) return [];
            const t = raw.trim();
            if (!t) return [];
            try {
              const p = JSON.parse(t);
              if (Array.isArray(p)) return p.map((x) => String(x));
              if (typeof p === "string") return p.split(",").map((s) => s.trim()).filter(Boolean);
              return [];
            } catch {
              return t.split(",").map((s) => s.trim()).filter(Boolean);
            }
          };
          const parseList = (raw: string | null | undefined): string[] => {
            if (!raw) return [];
            const t = raw.trim();
            if (!t) return [];
            try {
              const p = JSON.parse(t);
              return Array.isArray(p) ? p.map((x) => String(x)) : [];
            } catch {
              return t.split(",").map((s) => s.trim()).filter(Boolean);
            }
          };

          // ─── Get the LATEST weight from WeightLog (not the original onboarding weight) ───
          // این برای تمدید مهم است: اگر کاربر در طول ۴۵ روز وزن کم/زیاد کرده،
          // برنامه جدید باید بر اساس وزن فعلی ساخته شود نه وزن اولیه.
          const latestWeightLog = await db.weightLog.findFirst({
            where: { userId: user.id },
            orderBy: { loggedAt: "desc" },
            select: { weight: true },
          });
          const currentWeight = latestWeightLog?.weight ?? profile.weight;

          // ─── Get the latest checkup data for body measurements ───
          const latestCheckup = await db.checkup.findFirst({
            where: { userId: user.id, phaseCompleted: true },
            orderBy: { createdAt: "desc" },
            select: { bodyFatPercent: true, waistMeasurement: true, fatigueLevel: true, sleepQuality: true,
                      weight: true, armMeasurement: true, chestMeasurement: true, hipMeasurement: true,
                      thighMeasurement: true, neckMeasurement: true, dietAdherence: true, workoutAdherence: true,
                      phaseNumber: true, isFinalCheckup: true },
          });

          // ─── تمدید هوشمند: اگر کاربر دوره قبلی را کامل کرده، پیشرفت او را به AI می‌گویم ───
          const previousSub = oldActiveSub || await db.subscription.findFirst({
            where: { userId: user.id, status: "expired" },
            orderBy: { endDate: "desc" },
          });

          let renewalContext = "";
          if (previousSub && latestCheckup) {
            const oldWeight = profile.weight;
            const newWeight = currentWeight;
            const weightChange = newWeight - oldWeight;
            const oldBodyFat = latestCheckup.bodyFatPercent;
            renewalContext = `\n\n[سیستم - تمدید اشتراک]: این کاربر قبلاً پلن ${previousSub.plan} را برای ${previousSub.durationDays} روز استفاده کرده است.
پیشرفت کاربر:
- وزن اولیه: ${oldWeight} کیلو → وزن فعلی: ${newWeight} کیلو (تغییر: ${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)} کیلو)
${oldBodyFat ? `- درصد چربی بدن در آخرین چکاپ: ${oldBodyFat.toFixed(1)}٪` : ""}
- سطح انرژی: ${latestCheckup.fatigueLevel}/5
- کیفیت خواب: ${latestCheckup.sleepQuality}/5
- رعایت رژیم: ${latestCheckup.dietAdherence}/5
- رعایت تمرین: ${latestCheckup.workoutAdherence}/5
- فاز تکمیل‌شده: ${latestCheckup.phaseNumber}${latestCheckup.isFinalCheckup ? " (چکاپ نهایی)" : ""}

برنامه جدید را بر اساس این پیشرفت طراحی کن:
${weightChange < 0 ? "✅ کاربر وزن کم کرده — برنامه را با شدت مناسب ادامه بده" : weightChange > 0 ? "⚠️ کاربر وزن اضافه کرده — برنامه را با تمرکز بر چربی‌سوزی تنظیم کن" : "→ وزن ثابت — برنامه را متنوع‌تر و پیشرفته‌تر کن"}
${latestCheckup.fatigueLevel <= 2 ? "⚠️ خستگی بالا — حجم تمرین را کمی کم کن" : ""}
${latestCheckup.sleepQuality <= 2 ? "⚠️ خواب ضعیف — ریکاوری را در نظر بگیر" : ""}
${latestCheckup.workoutAdherence >= 4 ? "✅ رعایت تمرین عالی — می‌توانی شدت را افزایش دهی" : ""}`;
          }

          const planData = {
            gender: profile.gender as any,
            age: profile.age,
            height: profile.height,
            weight: currentWeight, // ← وزن فعلی، نه وزن اولیه
            targetWeight: profile.targetWeight ?? undefined,
            goal: profile.goal as any,
            activityLevel: profile.activityLevel as any,
            workoutDays: profile.workoutDays,
            workoutDaysList: parseList(profile.workoutDaysList),
            workoutPlace: profile.workoutPlace as any,
            equipment: parseEquip(profile.equipment),
            diseases: profile.diseases,
            injuries: profile.injuries,
            allergies: profile.allergies,
            dietType: profile.dietType as any,
            trainingExperience: (profile.trainingExperience ?? undefined) as any,
            previousTrainingType: profile.previousTrainingType ?? undefined,
            drugAllergies: profile.drugAllergies ?? undefined,
            currentMedications: profile.currentMedications ?? undefined,
            maxLifts: profile.maxLifts ?? undefined,
            // NEW: comprehensive professional fields
            bodyFrame: (profile.bodyFrame ?? undefined) as any,
            sleepHours: profile.sleepHours ?? undefined,
            stressLevel: profile.stressLevel ?? undefined,
            waterHabit: profile.waterHabit ?? undefined,
            targetDate: profile.targetDate ?? undefined,
            workoutTime: (profile.workoutTime ?? undefined) as any,
            medicalConditions: parseList(profile.medicalConditions) as any,
            currentSupplements: profile.currentSupplements ?? undefined,
            dislikedFoods: profile.dislikedFoods ?? undefined,
            preferredCuisine: (profile.preferredCuisine ?? undefined) as any,
            // Auto-calculated water goal from weight × 35 ml + activity adjustment
            waterGoalMl: (() => {
              const w = currentWeight || 70;
              const baseMl = Math.round(w * 35);
              let adj = 0;
              const al = profile.activityLevel;
              if (al === "active" || al === "very_active") adj = 500;
              else if (al === "moderate") adj = 250;
              return baseMl + adj;
            })(),
          };

          // غیرفعال‌سازی برنامه‌های قبلی
          await db.workoutPlan.updateMany({ where: { userId: user.id }, data: { active: false } });
          await db.mealPlan.updateMany({ where: { userId: user.id }, data: { active: false } });

          // تولید موازی — با context تمدید (اگر وجود دارد)
          // (FULL-PROFILE-AI-CONTEXT-WORKOUT) آخرین آزمایش خون و تحلیل عکس بدن
          // هم در صورت وجود به AI تزریق می‌شود تا برنامه دقیق‌تر شود.
          const extras: {
            renewalContext?: string;
            bloodTestReport?: string;
            bodyPhotoAnalysis?: string;
          } = {};
          if (renewalContext) extras.renewalContext = renewalContext;

          // ─── آخرین آزمایش خون (در صورت وجود) ───
          try {
            const latestBloodTest = await db.analysisResult.findFirst({
              where: { userId: user.id, type: "blood_test" },
              orderBy: { createdAt: "desc" },
              select: { result: true, createdAt: true },
            });
            if (latestBloodTest?.result) {
              try {
                const parsed = JSON.parse(latestBloodTest.result);
                const summaryParts: string[] = [];
                if (parsed.summary) summaryParts.push(String(parsed.summary));
                if (parsed.abnormalities && Array.isArray(parsed.abnormalities) && parsed.abnormalities.length > 0) {
                  summaryParts.push(`ناهنجاری‌ها: ${parsed.abnormalities.map((a: any) => typeof a === "string" ? a : (a?.name || a?.test || JSON.stringify(a))).join("، ")}`);
                }
                if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
                  summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
                }
                if (summaryParts.length > 0) {
                  extras.bloodTestReport = `آخرین آزمایش خون کاربر (تاریخ: ${new Date(latestBloodTest.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
                }
              } catch {
                extras.bloodTestReport = `آخرین آزمایش خون کاربر:\n${latestBloodTest.result.slice(0, 800)}`;
              }
            }
          } catch (btErr) {
            console.error("[payment/verify] failed to load blood test:", btErr);
          }

          // ─── آخرین تحلیل عکس بدن (در صورت وجود) ───
          try {
            const latestBodyPhoto = await db.analysisResult.findFirst({
              where: { userId: user.id, type: "body_photo" },
              orderBy: { createdAt: "desc" },
              select: { result: true, createdAt: true },
            });
            if (latestBodyPhoto?.result) {
              try {
                const parsed = JSON.parse(latestBodyPhoto.result);
                const summaryParts: string[] = [];
                if (parsed.analysis) summaryParts.push(String(parsed.analysis));
                if (parsed.recommendations && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
                  summaryParts.push(`توصیه‌ها: ${parsed.recommendations.slice(0, 3).join("، ")}`);
                }
                if (parsed.bodyScore != null) summaryParts.push(`امتیاز فرم بدن: ${parsed.bodyScore} از ۱۰۰`);
                if (summaryParts.length > 0) {
                  extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر (تاریخ: ${new Date(latestBodyPhoto.createdAt).toLocaleDateString("fa-IR")}):\n${summaryParts.join("\n")}`;
                }
              } catch {
                extras.bodyPhotoAnalysis = `آخرین تحلیل عکس بدن کاربر:\n${latestBodyPhoto.result.slice(0, 800)}`;
              }
            }
          } catch (bpErr) {
            console.error("[payment/verify] failed to load body photo analysis:", bpErr);
          }

          // ─── تولید برنامه در پس‌زمینه (BACKGROUND — fire and forget) ───
          // صبر نمی‌کنیم تا پاسخ فوری برگردد. کاربر پنل را می‌بیند و وقتی
          // برنامه آماده شد، نوتیفیکیشن دریافت می‌کند.
          const userIdBg = user.id;
          const progReqIdBg = progReq.id;
          const planIdBg = plan.id;
          const oldSubBg = oldActiveSub;

          void (async () => {
            try {
              const [workout, meal] = await Promise.all([
                generateWorkoutPlan(planData, planIdBg as any, extras),
                generateMealPlan(planData, planIdBg as any, extras),
              ]);

              await db.workoutPlan.create({
                data: { userId: userIdBg, content: JSON.stringify(workout), active: true },
              });
              await db.mealPlan.create({
                data: { userId: userIdBg, content: JSON.stringify(meal), totalCal: meal.totalCalories, active: true },
              });

              // به‌روزرسانی وضعیت درخواست برنامه به "ready"
              await db.programRequest.update({
                where: { id: progReqIdBg },
                data: { status: "ready" },
              });

              // نوتیفیکیشن آماده شدن برنامه
              await db.notification.create({
                data: {
                  userId: userIdBg,
                  type: "achievement",
                  title: "برنامه شما آماده شد! 🎯",
                  body: "برنامه تمرینی و غذایی شخصی‌سازی‌شده شما توسط فیتاپ هوشمند ساخته شد. از بخش «تمرینات» و «تغذیه» مشاهده کنید.",
                  link: "?tab=programs",
                  read: false,
                },
              });
              console.log("[payment/verify] background plan generation completed for user:", userIdBg);
            } catch (genErr) {
              console.error("[payment/verify] background plan generation failed:", genErr);
              // علامت‌گذاری درخواست به عنوان ناموفق
              try {
                await db.programRequest.update({
                  where: { id: progReqIdBg },
                  data: { status: "failed" },
                });
              } catch {}
              // H2: نوتیف به کاربر مبنی بر شکست تولید برنامه
              try {
                await db.notification.create({
                  data: {
                    userId: userIdBg,
                    type: "system",
                    title: "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
                    body: "تولید برنامه ورزشی و غذایی شما با خطا مواجه شد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
                    link: "?tab=programs",
                    read: false,
                    meta: JSON.stringify({ from: "payment", action: "plan_generation_failed", plan: planIdBg }),
                  },
                });
              } catch {}
            }
          })();

          // برنامه در حال تولید است — پاسخ فوری برمی‌گردد
          planGenerationOk = false; // یعنی «در حال تولید» (نه شکست)
        }
      } catch (prepErr) {
        console.error("[payment/verify] plan generation prep failed:", prepErr);
        // علامت‌گذاری درخواست به عنوان ناموفق ولی خرید موفق است
        await db.programRequest.update({
          where: { id: progReq.id },
          data: { status: "failed" },
        });
        // H2: نوتیف به کاربر مبنی بر شکست تولید برنامه (مرحله آماده‌سازی)
        try {
          await db.notification.create({
            data: {
              userId: user.id,
              type: "system",
              title: "خطا در تولید برنامه — از تب برنامه‌ها دوباره تلاش کنید ⚠️",
              body: "تولید برنامه ورزشی و غذایی شما با خطا مواجه شد. لطفاً از بخش «برنامه‌ها» دوباره تلاش کنید یا با پشتیبانی در ارتباط باشید.",
              link: "?tab=programs",
              read: false,
              meta: JSON.stringify({ from: "payment", action: "plan_generation_failed_prep", plan: plan.id }),
            },
          });
        } catch {}
      }
    }

    // نوتیفیکیشن خرید موفق
    const preservedNote =
      remainingDaysPreserved > 0
        ? ` ${toPersianDigits(remainingDaysPreserved)} روز از اشتراک قبلی شما به اشتراک جدید اضافه شد 🎁`
        : "";
    // برای پلن‌های advanced/ultimate: اشتراک pending است (هنوز ۴۵ روز شروع نشده).
    // برای basic/standard: اشتراک فعال و تاریخ پایان مشخص است.
    const bodyText = needsBodyPhoto
      ? `پلن ${plan.label} با موفقیت خریداری شد. برای شروع دوره ۴۵ روزه، عکس‌های بدن خود را ارسال کنید.${preservedNote}`
      : `پلن ${plan.label} با موفقیت خریداری شد. تا ${endDate.toLocaleDateString("fa-IR")} فعال است.${preservedNote} برنامه شما در حال تولید توسط فیتاپ هوشمند است — به‌زودی آماده می‌شود.`;
    await db.notification.create({
      data: {
        userId: user.id,
        type: "subscription",
        title: needsBodyPhoto ? "پلن شما ثبت شد! ✅" : "پلن شما فعال شد! ✅",
        body: bodyText,
        link: "?tab=dashboard",
        meta: JSON.stringify({ planId: plan.id, refId, remainingDaysPreserved }),
        read: false,
      },
    });

    // --- پردازش پاداش معرفی به دوست‌دار ---
    // اگر کاربر با کد معرفی ثبت‌نام کرده و این اولین خرید پلن اوست،
    // به هر دو طرف (خریدار + معرف) ۱۵۰,۰۰۰ تومان پاداش داده می‌شود.
    try {
      await processReferralReward({
        buyerUserId: user.id,
        paymentId: payment.id,
      });
    } catch (refErr) {
      // خطا در پردازش پاداش نباید جلوی موفقیت خرید را بگیرد
      console.error("[payment/verify] referral reward failed:", refErr);
    }

    const updatedDto = await buildUserDto(user.id);

    return Response.json({
      success: true,
      status: "success",
      message: "پرداخت با موفقیت انجام شد.",
      refId,
      amount: payment.amount,
      originalAmount: payment.originalAmount,
      plan: plan.label,
      planId: plan.id,
      // برای پلن‌های advanced/ultimate، اشتراک pending است و endDate ندارد.
      // ۴۵ روز از زمان تکمیل پیش‌نیازها شروع می‌شود.
      subscriptionEnd: needsBodyPhoto ? null : endDate.toISOString(),
      subscriptionStatus: needsBodyPhoto ? "pending" : "active",
      remainingDaysPreserved,
      walletBalance: newBalance,
      user: updatedDto,
    });
  } catch (e) {
    return apiError(e);
  }
}
