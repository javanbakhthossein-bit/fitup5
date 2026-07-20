import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requirePlanCapability, apiError } from "@/lib/fitness/auth";
import { generateWorkoutPlan, generateMealPlan, analyzeBodyPhoto, analyzeVideoBody } from "@/lib/fitness/ai";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { toPersianDigits, type OnboardingData } from "@/lib/fitness/types";
import { checkPrerequisites } from "@/lib/fitness/prerequisites";

/**
 * GET /api/coach/submit-body-analysis
 * بررسی وضعیت ارسال مدیای بدن برای کاربر فعلی.
 * پاسخ شامل:
 *  - needsBodyPhoto: آیا عکس بدن لازم است؟ (Advanced / Ultimate)
 *  - canSubmitVideo: آیا کاربر می‌تواند ویدیو ارسال کند؟ (Ultimate) — ویدیو اختیاری است
 *  - pendingStatus: وضعیت فعلی ProgramRequest (pending_body_photo / pending_body_media / ready / ...)
 *  - hasWorkoutPlan: آیا برنامه تمرینی فعال دارد؟
 */
export async function GET() {
  try {
    const { userId, planName } = await requirePlanCapability("bodyPhotoAnalysis");

    const needsBodyPhoto = planName === "advanced" || planName === "ultimate";
    // ویدیو برای Ultimate اختیاری است (نه الزامی)
    const canSubmitVideo = planName === "ultimate";

    const [latestReq, workout] = await Promise.all([
      db.programRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      db.workoutPlan.findFirst({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const pendingStatus = latestReq?.status ?? null;
    const hasWorkoutPlan = !!workout;

    // ─── بررسی پیش‌نیازها ───
    const prereqCheck = await checkPrerequisites(userId, planName as any);

    // بنر آپلود فقط زمانی نشان داده شود که عکس بدن واقعاً آپلود نشده
    // نه زمانی که برنامه در حال ساخت است (generating) یا ساخته شده (hasWorkoutPlan)
    const bodyPhotoPrereq = prereqCheck.prerequisites.find((p) => p.type === "body_photo");
    const bodyPhotoIncomplete = bodyPhotoPrereq && bodyPhotoPrereq.status !== "completed";
    const awaitingMedia =
      needsBodyPhoto &&
      !hasWorkoutPlan &&
      bodyPhotoIncomplete &&
      pendingStatus !== "generating" &&
      pendingStatus !== "ready";

    return Response.json({
      needsBodyPhoto,
      canSubmitVideo,
      pendingStatus,
      hasWorkoutPlan,
      awaitingMedia,
      // اطلاعات پیش‌نیازها برای نمایش دانه‌دانه در UI
      prerequisites: prereqCheck.prerequisites,
      canGenerateProgram: prereqCheck.canGenerateProgram,
      blockingReason: prereqCheck.blockingReason,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/coach/submit-body-analysis
 * multipart/form-data:
 *   - bodyPhotos: File[] (۱ تا ۴ تصویر) — الزامی
 *   - bodyVideo: File (اختیاری — برای Ultimate کاربران می‌توانند ویدیو هم ارسال کنند)
 *
 * ۱. عکس‌ها (و ویدیو را در صورت ارسال) در public/uploads/body-analysis ذخیره می‌کند.
 * ۲. در ProgressPhoto ثبت می‌کند (type=front/side/back/custom).
 * ۳. هر عکس را با `analyzeBodyPhoto` (VLM gemini-3.5-flash) تحلیل می‌کند و
 *    تحلیل‌ها را در یک رشته‌ی واحد ترکیب می‌کند.
 * ۴. در صورت ارسال ویدیو، آن را هم با `analyzeVideoBody` تحلیل می‌کند (اختیاری —
 *    خطای تحلیل ویدیو باعث شکست کل فرآیند نمی‌شود).
 * ۵. برنامه تمرینی و غذایی را با عبور از `extras.bodyPhotoAnalysis` و
 *    `extras.videoAnalysisResult` به `generateWorkoutPlan` / `generateMealPlan` تولید می‌کند.
 * ۶. وضعیت ProgramRequest را روی "ready" می‌گذارد.
 * ۷. نوتیفیکیشن «برنامه شما آماده شد! 🎯» می‌سازد.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, planName } = await requirePlanCapability("bodyPhotoAnalysis");

    // ویدیو برای Ultimate اختیاری است (هیچ پلنی برای ویدیو الزامی نیست)
    const canSubmitVideo = planName === "ultimate";

    const formData = await req.formData();
    const photoFiles = formData.getAll("bodyPhotos").filter(
      (f): f is File => f instanceof File && f.size > 0 && f.type.startsWith("image/")
    );
    const videoFile = formData.get("bodyVideo");
    const video = videoFile instanceof File && videoFile.size > 0 ? videoFile : null;

    // اعتبارسنجی حداقل‌ها
    if (photoFiles.length === 0) {
      return Response.json(
        { error: "حداقل یک عکس از بدن ارسال کنید." },
        { status: 400 }
      );
    }
    if (photoFiles.length > 4) {
      return Response.json(
        { error: "حداکثر ۴ عکس مجاز است." },
        { status: 400 }
      );
    }
    // ویدیو کاملاً اختیاری است — حتی برای Ultimate — هیچ الزامی وجود ندارد.
    // (اگر کاربر Ultimate ویدیو فرستاد، آن را تحلیل می‌کنیم؛ اگر نفرستاد، برنامه بدون آن ساخته می‌شود.)
    void canSubmitVideo; // for clarity — variable intentionally unused beyond documentation

    // اعتبارسنجی حجم — عکس‌ها ۵MB، ویدیو ۲۰MB
    for (const f of photoFiles) {
      if (f.size > 30 * 1024 * 1024) {
        return Response.json({ error: "حجم هر عکس نباید بیشتر از ۳۰ مگابایت باشد (خودکار کاهش می‌یابد)." }, { status: 400 });
      }
    }
    if (video && video.size > 50 * 1024 * 1024) {
      return Response.json({ error: "حجم ویدیو نباید بیشتر از ۵۰ مگابایت باشد." }, { status: 400 });
    }

    // ─── تعیین تکلیف ویدیو (وظیفه ۷-۸) ───
    // اگر کاربر پلن Ultimate دارد:
    //   - اگر ویدیو آپلود کرده → videoStatus = "uploaded"
    //   - اگر ویدیو آپلود نکرده → videoStatus = "skipped" (یعنی تصمیم صریح گرفته)
    // این کار تضمین می‌کند که پس از ارسال عکس بدن، ویدیو حتماً تعیین تکلیف شده است.
    if (planName === "ultimate") {
      const userRecord = await db.user.findUnique({
        where: { id: userId },
        select: { videoStatus: true },
      });
      // فقط اگر قبلاً "uploaded" نبوده، آپدیت کن (تا روی آپلود قبلی override نکند)
      const newVideoStatus = video ? "uploaded" : (userRecord?.videoStatus === "uploaded" ? "uploaded" : "skipped");
      if (userRecord?.videoStatus !== newVideoStatus) {
        await db.user.update({
          where: { id: userId },
          data: { videoStatus: newVideoStatus },
        });
      }
    }

    // ذخیره فایل‌ها
    const uploadDir = path.join(process.cwd(), "public", "uploads", "body-analysis");
    await mkdir(uploadDir, { recursive: true });

    const savedPhotoUrls: string[] = [];
    const savedPhotoPaths: string[] = [];
    const savedPhotoMimeTypes: string[] = [];
    const photoTypes = ["front", "side", "back", "custom"];
    const photoAngleNames = ["جلو", "پهلو", "پشت", "سه‌چهارم"]; // برسی زاویه عکس برای پرامپت VLM

    // ─── بهینه‌سازی عکس‌ها با sharp: resize به 1024px + WebP q80 ───
    // این کار حجم عکس را به‌شدت کاهش می‌دهد و سرعت آپلود + تحلیل را بالا می‌برد.
    // 1024px برای ارزیابی فرم بدن توسط VLM کافی است و token کمتری مصرف می‌کند.
    const sharp = (await import("sharp")).default;
    for (let i = 0; i < photoFiles.length; i++) {
      const file = photoFiles[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      // کاهش حجم + resize به حداکثر 1024px + WebP (per FOOD-ANALYSIS-LOGGING spec)
      const processed = await sharp(buffer)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();

      const fileName = `body-${userId}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.webp`;
      const filePath = path.join(uploadDir, fileName);
      await writeFile(filePath, processed);
      const url = `/uploads/body-analysis/${fileName}`;
      savedPhotoUrls.push(url);
      savedPhotoPaths.push(filePath);
      savedPhotoMimeTypes.push("image/webp");

      // ثبت در ProgressPhoto
      await db.progressPhoto.create({
        data: {
          userId,
          imageUrl: url,
          type: photoTypes[i] ?? "custom",
          note: "آپلود برای طراحی برنامه (Body Analysis)",
        },
      });
    }

    let savedVideoUrl: string | null = null;
    let savedVideoPath: string | null = null;
    let savedVideoMimeType: string | null = null;
    if (video) {
      const allowedVidExts = ["mp4", "webm", "mov", "m4v", "mkv"];
      const vext = (video.name.split(".").pop() || "").toLowerCase();
      const finalVext = allowedVidExts.includes(vext) ? vext : "mp4";
      const vFileName = `body-video-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${finalVext}`;
      const vFilePath = path.join(uploadDir, vFileName);
      const vBuffer = Buffer.from(await video.arrayBuffer());
      await writeFile(vFilePath, vBuffer);
      savedVideoUrl = `/uploads/body-analysis/${vFileName}`;
      savedVideoPath = vFilePath;
      savedVideoMimeType = video.type || "video/mp4";
    }

    // --- تولید برنامه تمرینی + غذایی ---
    // همان منطق /api/coach/plan PUT با اضافه‌ی ثبت لینک مدیا در notification
    const profile = await db.onboardingProfile.findUnique({ where: { userId } });
    if (!profile) {
      return Response.json({ error: "ابتدا آنبوردینگ را تکمیل کنید." }, { status: 400 });
    }

    // Helpers برای پارس کردن فیلدهای ذخیره‌شده
    const safeParseList = (raw: string | null | undefined): string[] => {
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

    const planData: OnboardingData = {
      gender: profile.gender as OnboardingData["gender"],
      age: profile.age,
      height: profile.height,
      weight: profile.weight,
      targetWeight: profile.targetWeight ?? undefined,
      goal: profile.goal as OnboardingData["goal"],
      activityLevel: profile.activityLevel as OnboardingData["activityLevel"],
      workoutDays: profile.workoutDays,
      workoutDaysList: safeParseList(profile.workoutDaysList),
      workoutPlace: profile.workoutPlace as OnboardingData["workoutPlace"],
      equipment: safeParseList(profile.equipment),
      diseases: profile.diseases,
      injuries: profile.injuries,
      allergies: profile.allergies,
      dietType: profile.dietType as OnboardingData["dietType"],
      trainingExperience: (profile.trainingExperience ?? undefined) as OnboardingData["trainingExperience"],
      previousTrainingType: profile.previousTrainingType ?? undefined,
      drugAllergies: profile.drugAllergies ?? undefined,
      currentMedications: profile.currentMedications ?? undefined,
      maxLifts: profile.maxLifts ?? undefined,
      // NEW: comprehensive professional fields
      bodyFrame: (profile.bodyFrame ?? undefined) as OnboardingData["bodyFrame"],
      sleepHours: profile.sleepHours ?? undefined,
      stressLevel: profile.stressLevel ?? undefined,
      waterHabit: profile.waterHabit ?? undefined,
      targetDate: profile.targetDate ?? undefined,
      workoutTime: (profile.workoutTime ?? undefined) as OnboardingData["workoutTime"],
      medicalConditions: safeParseList(profile.medicalConditions) as OnboardingData["medicalConditions"],
      currentSupplements: profile.currentSupplements ?? undefined,
      dislikedFoods: profile.dislikedFoods ?? undefined,
      preferredCuisine: (profile.preferredCuisine ?? undefined) as OnboardingData["preferredCuisine"],
      // Auto-calculated water goal from weight × 35 ml + activity adjustment
      waterGoalMl: (() => {
        const w = profile.weight || 70;
        const baseMl = Math.round(w * 35);
        let adj = 0;
        const al = profile.activityLevel;
        if (al === "active" || al === "very_active") adj = 500;
        else if (al === "moderate") adj = 250;
        return baseMl + adj;
      })(),
    };

    // ─── تحلیل هر عکس بدن با VLM (gemini-3.5-flash) — موازی برای سرعت بیشتر ───
    // هر عکس را از روی دیسک می‌خوانیم، به base64 تبدیل می‌کنیم و به `analyzeBodyPhoto`
    // می‌دهیم. تحلیل عکس‌ها به‌صورت موازی (Promise.allSettled) انجام می‌شود تا سرعت
    // پاسخ‌دهی افزایش یابد. اگر تحلیل یک عکس خطا دهد، آن را رد می‌کنیم ولی به بقیه ادامه می‌دهیم.
    const bodyAnalyses: string[] = [];
    const analysisResults = await Promise.allSettled(
      savedPhotoPaths.map(async (photoPath, i) => {
        const buffer = await readFile(photoPath);
        const base64 = buffer.toString("base64");
        const mimeType = savedPhotoMimeTypes[i];
        const angleLabel = photoAngleNames[i] || "اضافی";
        const userContext = `این عکس زاویه ${angleLabel} از بدن ورزشکار است. هدف ورزشکار: ${profile.goal || "نامشخص"}. فرم بدن، تعادل عضلانی، نقاط ضعف و قوت را تحلیل کن.`;
        const analysis = await analyzeBodyPhoto(base64, mimeType, userContext);
        return `زاویه ${i + 1} (${angleLabel}):\nامتیاز فرم: ${toPersianDigits(analysis.bodyScore)} از ۱۰۰\nتحلیل: ${analysis.analysis}\nتوصیه‌ها: ${analysis.recommendations.join("، ")}`;
      })
    );
    analysisResults.forEach((res, i) => {
      if (res.status === "fulfilled") {
        bodyAnalyses.push(res.value);
      } else {
        console.error(`[submit-body-analysis] photo ${i + 1} analysis failed:`, res.reason);
        // ادامه حتی اگر یک عکس خطا دهد
      }
    });

    const combinedBodyAnalysis = bodyAnalyses.length > 0
      ? `تحلیل عکس‌های بدن ورزشکار (${toPersianDigits(bodyAnalyses.length)} عکس):\n\n${bodyAnalyses.join("\n\n")}`
      : "";

    // ─── تحلیل ویدیو (اختیاری) ───
    // اگر ویدیو فرستاده شده باشد، آن را هم تحلیل می‌کنیم. خطای تحلیل ویدیو هرگز
    // نباید جلوی تولید برنامه را بگیرد — این بخش کاملاً optional است.
    let videoAnalysisResult = "";
    if (video && savedVideoPath && savedVideoMimeType) {
      try {
        const vBuffer = await readFile(savedVideoPath);
        const vBase64 = vBuffer.toString("base64");
        const vResult = await analyzeVideoBody(vBase64, savedVideoMimeType, "تحلیل فرم بدن و تکنیک حرکات ورزشی");
        videoAnalysisResult = `تحلیل ویدیوی فرم بدن:\nپوسچر: ${vResult.posture}\nتقارن: ${toPersianDigits(vResult.symmetry)} از ۱۰۰\nامتیاز: ${toPersianDigits(vResult.score)} از ۱۰۰\nمشکلات: ${vResult.issues.join("، ")}\nتوصیه‌ها: ${vResult.recommendations.join("، ")}`;
      } catch (e) {
        console.error("[submit-body-analysis] video analysis failed:", e);
        // تحلیل ویدیو اختیاری است — بدون آن ادامه می‌دهیم
      }
    }

    // ─── ساخت extras و تولید برنامه ───
    // (FULL-PROFILE-AI-CONTEXT-WORKOUT) نتایج آزمایش خون (اگر کاربر قبلاً
    // آپلود کرده) و بستر ریکاوری/تمدید هم به AI تزریق می‌شود.
    const extras: {
      bodyPhotoAnalysis?: string;
      videoAnalysisResult?: string;
      bloodTestReport?: string;
      renewalContext?: string;
    } = {};
    if (combinedBodyAnalysis) extras.bodyPhotoAnalysis = combinedBodyAnalysis;
    if (videoAnalysisResult) extras.videoAnalysisResult = videoAnalysisResult;

    // ─── (وظیفه ۱۱) persist کردن تحلیل عکس بدن و ویدیو به AnalysisResult ───
    // این نتایج برای regenerate شدن برنامه (در coach/plan PUT) لازم است تا
    // AI دوباره بتواند از تحلیل‌ها استفاده کند.
    if (combinedBodyAnalysis) {
      try {
        await db.analysisResult.create({
          data: {
            userId,
            type: "body_photo",
            result: JSON.stringify({
              analysis: combinedBodyAnalysis,
              createdAt: new Date().toISOString(),
              photoCount: bodyAnalyses.length,
            }),
            mediaUrl: savedPhotoUrls[0] || null,
          },
        });
      } catch (e) {
        console.error("[submit-body-analysis] failed to persist body photo analysis:", e);
      }
    }
    if (videoAnalysisResult) {
      try {
        await db.analysisResult.create({
          data: {
            userId,
            type: "video_analysis",
            result: JSON.stringify({
              analysis: videoAnalysisResult,
              createdAt: new Date().toISOString(),
            }),
            mediaUrl: savedVideoUrl,
          },
        });
      } catch (e) {
        console.error("[submit-body-analysis] failed to persist video analysis:", e);
      }
    }

    // ─── آخرین آزمایش خون (در صورت وجود) ───
    try {
      const latestBloodTest = await db.analysisResult.findFirst({
        where: { userId, type: "blood_test" },
        orderBy: { createdAt: "desc" },
        select: { result: true, createdAt: true },
      });
      if (latestBloodTest?.result) {
        try {
          const parsed = JSON.parse(latestBloodTest.result);
          // خلاصه‌ای قابل خواندن برای AI می‌سازیم
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
          // اگر result JSON نبود، خودش را به‌عنوان متن می‌فرستیم
          extras.bloodTestReport = `آخرین آزمایش خون کاربر:\n${latestBloodTest.result.slice(0, 800)}`;
        }
      }
    } catch (e) {
      console.error("[submit-body-analysis] failed to load blood test:", e);
    }

    // ─── بستر تمدید (در صورت وجود اشتراک قبلی) ───
    try {
      const previousSub = await db.subscription.findFirst({
        where: { userId, status: "expired" },
        orderBy: { endDate: "desc" },
      });
      const previousLatestCheckup = await db.checkup.findFirst({
        where: { userId, phaseCompleted: true },
        orderBy: { createdAt: "desc" },
      });
      if (previousSub && previousLatestCheckup) {
        const oldWeight = profile.weight;
        const newWeight = profile.weight;
        const weightChange = newWeight - oldWeight;
        extras.renewalContext = `\n\n[سیستم - تمدید اشتراک]: این کاربر قبلاً پلن ${previousSub.plan} را برای ${previousSub.durationDays} روز استفاده کرده است.
پیشرفت کاربر:
- وزن اولیه: ${oldWeight} کیلو → وزن فعلی: ${newWeight} کیلو (تغییر: ${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)} کیلو)
${previousLatestCheckup.bodyFatPercent ? `- درصد چربی بدن در آخرین چکاپ: ${previousLatestCheckup.bodyFatPercent.toFixed(1)}٪` : ""}
- سطح انرژی: ${previousLatestCheckup.fatigueLevel}/5
- کیفیت خواب: ${previousLatestCheckup.sleepQuality}/5
- رعایت رژیم: ${previousLatestCheckup.dietAdherence}/5
- رعایت تمرین: ${previousLatestCheckup.workoutAdherence}/5
- فاز تکمیل‌شده: ${previousLatestCheckup.phaseNumber}${previousLatestCheckup.isFinalCheckup ? " (چکاپ نهایی)" : ""}

برنامه جدید را بر اساس این پیشرفت طراحی کن.`;
      }
    } catch (e) {
      console.error("[submit-body-analysis] failed to load renewal context:", e);
    }

    // غیرفعال‌سازی برنامه‌های قبلی
    await db.workoutPlan.updateMany({ where: { userId }, data: { active: false } });
    await db.mealPlan.updateMany({ where: { userId }, data: { active: false } });

    // ─── بررسی تعیین تکلیف همه پیش‌نیازها (وظیفه ۸) ───
    // قبل از ساخت برنامه، چک می‌کنیم که همه پیش‌نیازهای اختیاری (ویدیو، آزمایش خون)
    // تعیین تکلیف شده باشند. اگر نه، عکس‌ها و ویدیو را ذخیره کرده‌ایم ولی برنامه را
    // نمی‌سازیم — کاربر باید ابتدا تصمیم بگیرد.
    const prereqCheck = await checkPrerequisites(userId, planName as any);
    if (!prereqCheck.canGenerateProgram) {
      // به‌روزرسانی وضعیت ProgramRequest به "pending_body_photo" (در انتظار تعیین تکلیف)
      const latestReq = await db.programRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (latestReq) {
        await db.programRequest.update({
          where: { id: latestReq.id },
          data: { status: "pending_body_photo" },
        });
      }

      // نوتیفیکیشن به کاربر یادآوری می‌کند که باید چه چیزی را تعیین تکلیف کند
      await db.notification.create({
        data: {
          userId,
          type: "system",
          title: "عکس‌های بدن شما ذخیره شد 📸",
          body: `عکس‌های بدن شما با موفقیت ذخیره شد. اما برای ساخت برنامه، باید هنوز ${prereqCheck.blockingReason ?? "پیش‌نیازهای باقی‌مانده را تعیین تکلیف کنید"}. از بخش داشبورد اقدام کنید.`,
          link: "?tab=dashboard",
          read: false,
        },
      });

      return Response.json({
        ok: true,
        photos: savedPhotoUrls,
        video: savedVideoUrl,
        analyzedPhotosCount: bodyAnalyses.length,
        hasWorkoutPlan: false,
        pendingStatus: "pending_body_photo",
        awaitingMedia: false,
        awaitingDecision: true,
        message: prereqCheck.blockingReason ?? "پیش‌نیازهای باقی‌مانده را تعیین تکلیف کنید.",
        prerequisites: prereqCheck.prerequisites,
      });
    }

    const [workout, meal] = await Promise.all([
      generateWorkoutPlan(planData, planName, extras),
      generateMealPlan(planData, planName, extras),
    ]);

    await db.workoutPlan.create({
      data: { userId, content: JSON.stringify(workout), active: true },
    });
    await db.mealPlan.create({
      data: { userId, content: JSON.stringify(meal), totalCal: meal.totalCalories, active: true },
    });

    // ─── فعال‌سازی اشتراک pending (وظیفه ۲) ───
    // برای پلن‌های advanced/ultimate، اشتراک هنگام خرید با status="pending" و startDate/endDate=null
    // ساخته شده بود. حالا که پیش‌نیازها تکمیل شد و برنامه ساخته شد، اشتراک را به "active"
    // تبدیل می‌کنیم و ۴۵ روز از همین لحظه شروع می‌شود.
    try {
      const pendingSub = await db.subscription.findFirst({
        where: { userId, status: "pending" },
        orderBy: { createdAt: "desc" },
      });
      if (pendingSub) {
        const startNow = new Date();
        const endNow = new Date();
        endNow.setDate(endNow.getDate() + (pendingSub.durationDays || 45));
        await db.subscription.update({
          where: { id: pendingSub.id },
          data: {
            status: "active",
            startDate: startNow,
            endDate: endNow,
          },
        });
        // به‌روزرسانی فیلدهای پلن روی User (برای دسترسی سریع)
        await db.user.update({
          where: { id: userId },
          data: {
            planStartedAt: startNow,
            planExpiresAt: endNow,
          },
        });
        console.log("[submit-body-analysis] subscription activated:", pendingSub.id, "endDate:", endNow.toISOString());
      } else {
        // اگر pendingSub نیست، یعنی قبلاً فعال بوده یا پلن basic/standard است.
        // در این حالت کاری نمی‌کنیم — اشتراک از قبل active است.
      }
    } catch (subErr) {
      console.error("[submit-body-analysis] failed to activate subscription:", subErr);
      // خطا در فعال‌سازی اشتراک نباید جلوی ساخت برنامه را بگیرد
    }

    // به‌روزرسانی وضعیت ProgramRequest به "ready"
    const latestReq = await db.programRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (latestReq) {
      await db.programRequest.update({
        where: { id: latestReq.id },
        data: { status: "ready" },
      });
    }

    // نوتیفیکیشن «برنامه شما آماده شد» — به تعداد عکس‌های تحلیل‌شده اشاره می‌کند
    const analyzedPhotosNote = bodyAnalyses.length > 0
      ? `بر اساس ${toPersianDigits(bodyAnalyses.length)} عکس بدن شما${videoAnalysisResult ? " و ویدیوی فرم حرکات" : ""}، فیتاپ هوشمند برنامه تمرینی و غذایی شخصی‌سازی‌شده طراحی کرد. از بخش «تمرینات» و «تغذیه» مشاهده کنید.`
      : "بر اساس اطلاعات شما، فیتاپ هوشمند برنامه تمرینی و غذایی شخصی‌سازی‌شده طراحی کرد. از بخش «تمرینات» و «تغذیه» مشاهده کنید.";

    await db.notification.create({
      data: {
        userId,
        type: "achievement",
        title: "برنامه شما آماده شد! 🎯",
        body: analyzedPhotosNote,
        link: "?tab=programs",
        read: false,
      },
    });

    return Response.json({
      ok: true,
      photos: savedPhotoUrls,
      video: savedVideoUrl,
      analyzedPhotosCount: bodyAnalyses.length,
      hasWorkoutPlan: true,
      pendingStatus: "ready",
      awaitingMedia: false,
      message: "عکس‌های بدن تحلیل شد و برنامه شما ساخته شد.",
    });
  } catch (e) {
    return apiError(e);
  }
}
