import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { logWeightChangeIfChanged } from "@/lib/fitness/active-weight";
import type { Discipline, MedicalConditionKey, OnboardingData } from "@/lib/fitness/types";
import { DISCIPLINE_LABELS } from "@/lib/fitness/types";

// Allowed medical condition keys — anything else is filtered out.
const ALLOWED_MEDICAL_CONDITIONS: ReadonlySet<MedicalConditionKey> = new Set([
  "diabetes", "hypertension", "thyroid", "heart", "back_pain", "knee_pain", "shoulder_issues",
]);

function coerceMedicalConditions(raw: unknown): MedicalConditionKey[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => String(c))
    .filter((c): c is MedicalConditionKey => ALLOWED_MEDICAL_CONDITIONS.has(c as MedicalConditionKey));
}

/** v75 — اعتبارسنجی رشتهٔ ورزشی (فقط مقادیر شناخته‌شده پذیرفته می‌شوند) */
const ALLOWED_DISCIPLINES = new Set(Object.keys(DISCIPLINE_LABELS));
function coerceDiscipline(raw: unknown): Discipline | undefined {
  const v = typeof raw === "string" ? raw.trim() : "";
  return ALLOWED_DISCIPLINES.has(v) ? (v as Discipline) : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = (await req.json()) as Partial<OnboardingData>;

    // Validate required fields
    const required = ["firstName", "lastName", "gender", "age", "height", "weight", "goal", "activityLevel", "workoutDays", "workoutPlace", "dietType"];
    for (const k of required) {
      if (body[k as keyof OnboardingData] === undefined || body[k as keyof OnboardingData] === null || body[k as keyof OnboardingData] === "") {
        return Response.json({ error: `فیلد ${k} الزامی است.` }, { status: 400 });
      }
    }

    const data: OnboardingData = {
      firstName: String(body.firstName || "").trim(),
      lastName: String(body.lastName || "").trim(),
      gender: body.gender!,
      age: Number(body.age),
      height: Number(body.height),
      weight: Number(body.weight),
      targetWeight: body.targetWeight ? Number(body.targetWeight) : undefined,
      goal: body.goal!,
      activityLevel: body.activityLevel!,
      workoutDays: Number(body.workoutDays),
      workoutDaysList: body.workoutDaysList || [],
      workoutPlace: body.workoutPlace!,
      equipment: body.equipment || [],
      diseases: body.diseases || "",
      injuries: body.injuries || "",
      allergies: body.allergies || "",
      dietType: body.dietType!,
      trainingExperience: body.trainingExperience,
      previousTrainingType: body.previousTrainingType,
      drugAllergies: body.drugAllergies,
      currentMedications: body.currentMedications,
      maxLifts: body.maxLifts,
      // Optional baseline measurements (cm) — may be null/undefined
      chestMeasurement: body.chestMeasurement ? Number(body.chestMeasurement) : undefined,
      armMeasurement: body.armMeasurement ? Number(body.armMeasurement) : undefined,
      waistMeasurement: body.waistMeasurement ? Number(body.waistMeasurement) : undefined,
      hipMeasurement: body.hipMeasurement ? Number(body.hipMeasurement) : undefined,
      thighMeasurement: body.thighMeasurement ? Number(body.thighMeasurement) : undefined,
      // NEW (BODY-COMPOSITION-PRO): اندازه‌های اضافی برای محاسبه چربی بدن
      neckMeasurement: body.neckMeasurement ? Number(body.neckMeasurement) : undefined,
      shoulderMeasurement: body.shoulderMeasurement ? Number(body.shoulderMeasurement) : undefined,
      calfMeasurement: body.calfMeasurement ? Number(body.calfMeasurement) : undefined,
      // NEW: comprehensive professional fields (ONBOARDING-PLAN-UPGRADE)
      bodyFrame: body.bodyFrame,
      sleepHours: body.sleepHours ? Number(body.sleepHours) : undefined,
      stressLevel: body.stressLevel ? Number(body.stressLevel) : undefined,
      waterHabit: body.waterHabit != null ? Number(body.waterHabit) : undefined,
      targetDate: body.targetDate || undefined,
      workoutTime: body.workoutTime,
      medicalConditions: coerceMedicalConditions(body.medicalConditions),
      currentSupplements: body.currentSupplements || undefined,
      dislikedFoods: body.dislikedFoods || undefined,
      preferredCuisine: body.preferredCuisine,
      // v60 — شرایط/نیاز/هدف خاص کاربر (متن آزاد برای هوش مصنوعی)
      specialConditions: body.specialConditions ? String(body.specialConditions).trim().slice(0, 600) || undefined : undefined,
      // v75 — رشتهٔ ورزشی (فیزیک کلاسیک/بادی‌بیلدینگ/فیتنس/... — شامل گزینه‌های بانوان)
      discipline: coerceDiscipline(body.discipline),
      // Auto-calculate daily water goal: weight (kg) × 35 ml + activity-based adjustment
      waterGoalMl: (() => {
        const w = Number(body.weight) || 70;
        const baseMl = Math.round(w * 35);
        let adj = 0;
        const al = body.activityLevel;
        if (al === "active" || al === "very_active") adj = 500;
        else if (al === "moderate") adj = 250;
        return baseMl + adj;
      })(),
    };

    /**
   * v76 — اعتبارسنجی بازهٔ فیلدهای بدنی — مثل مسیر پروفایل.
   * وزن/قد/سن خارج از بازهٔ منطقی به‌عنوان دادهٔ مبنا به هوش مصنوعی نمی‌رود.
   */
  const bodyRanges: Array<{ key: keyof OnboardingData; min: number; max: number; label: string }> = [
    { key: "weight", min: 25, max: 300, label: "وزن" },
    { key: "height", min: 100, max: 250, label: "قد" },
    { key: "age", min: 8, max: 90, label: "سن" },
  ];
  for (const r of bodyRanges) {
    const v = data[r.key] as unknown as number;
    if (v == null || !Number.isFinite(v) || v < r.min || v > r.max) {
      return Response.json(
        { error: `${r.label} واردشده خارج از بازهٔ مجاز (${r.min} تا ${r.max}) است. لطفاً اصلاح کنید.` },
        { status: 400 }
      );
    }
  }
  if (data.targetWeight != null && (data.targetWeight < 25 || data.targetWeight > 300)) {
    return Response.json(
      { error: "وزن هدف واردشده خارج از بازهٔ مجاز (۲۵ تا ۳۰۰) است. لطفاً اصلاح کنید." },
      { status: 400 }
    );
  }

  // v76 — وزن قبلی پروفایل (برای تشخیص تغییر وزن در ذخیرهٔ مجدد آنبوردینگ)
  const existingProfile = await db.onboardingProfile.findUnique({
    where: { userId: user.id },
    select: { weight: true },
  });

  // Upsert onboarding profile
    await db.onboardingProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        gender: data.gender,
        age: data.age,
        height: data.height,
        weight: data.weight,
        targetWeight: data.targetWeight ?? null,
        goal: data.goal,
        activityLevel: data.activityLevel,
        workoutDays: data.workoutDays,
        workoutDaysList: JSON.stringify(data.workoutDaysList || []),
        workoutPlace: data.workoutPlace,
        equipment: JSON.stringify(data.equipment),
        diseases: data.diseases,
        injuries: data.injuries,
        allergies: data.allergies,
        dietType: data.dietType,
        trainingExperience: data.trainingExperience ?? null,
        previousTrainingType: data.previousTrainingType ?? null,
        drugAllergies: data.drugAllergies ?? null,
        currentMedications: data.currentMedications ?? null,
        maxLifts: data.maxLifts ?? null,
        // NEW: comprehensive professional fields
        bodyFrame: data.bodyFrame ?? null,
        sleepHours: data.sleepHours ?? null,
        stressLevel: data.stressLevel ?? null,
        waterHabit: data.waterHabit ?? null,
        targetDate: data.targetDate ?? null,
        workoutTime: data.workoutTime ?? null,
        medicalConditions: data.medicalConditions && data.medicalConditions.length > 0
          ? JSON.stringify(data.medicalConditions)
          : null,
        currentSupplements: data.currentSupplements ?? null,
        dislikedFoods: data.dislikedFoods ?? null,
        preferredCuisine: data.preferredCuisine ?? null,
        // v60 — شرایط خاص کاربر
        specialConditions: data.specialConditions ?? null,
        // v75 — رشتهٔ ورزشی
        discipline: data.discipline ?? null,
        // NEW (BODY-COMPOSITION-PRO): اندازه‌های اضافی
        neckMeasurement: data.neckMeasurement ?? null,
        shoulderMeasurement: data.shoulderMeasurement ?? null,
        calfMeasurement: data.calfMeasurement ?? null,
        // اندازه‌های پایه (SCHEMA-DRIFT-FIX): این فیلدها در data ساخته می‌شدند ولی
        // در upsert جا افتاده بودند و هرگز ذخیره نمی‌شدند (کمر الزامی هم!
        chestMeasurement: data.chestMeasurement ?? null,
        armMeasurement: data.armMeasurement ?? null,
        waistMeasurement: data.waistMeasurement ?? null,
        hipMeasurement: data.hipMeasurement ?? null,
        thighMeasurement: data.thighMeasurement ?? null,
        // v76 — زمان آخرین تغییر وزن پروفایل (رزولور مرکزی وزن)
        weightUpdatedAt: new Date(),
      },
      update: {
        gender: data.gender,
        age: data.age,
        height: data.height,
        weight: data.weight,
        targetWeight: data.targetWeight ?? null,
        goal: data.goal,
        activityLevel: data.activityLevel,
        workoutDays: data.workoutDays,
        workoutDaysList: JSON.stringify(data.workoutDaysList || []),
        workoutPlace: data.workoutPlace,
        equipment: JSON.stringify(data.equipment),
        diseases: data.diseases,
        injuries: data.injuries,
        allergies: data.allergies,
        dietType: data.dietType,
        trainingExperience: data.trainingExperience ?? null,
        previousTrainingType: data.previousTrainingType ?? null,
        drugAllergies: data.drugAllergies ?? null,
        currentMedications: data.currentMedications ?? null,
        maxLifts: data.maxLifts ?? null,
        // NEW: comprehensive professional fields
        bodyFrame: data.bodyFrame ?? null,
        sleepHours: data.sleepHours ?? null,
        stressLevel: data.stressLevel ?? null,
        waterHabit: data.waterHabit ?? null,
        targetDate: data.targetDate ?? null,
        workoutTime: data.workoutTime ?? null,
        medicalConditions: data.medicalConditions && data.medicalConditions.length > 0
          ? JSON.stringify(data.medicalConditions)
          : null,
        currentSupplements: data.currentSupplements ?? null,
        dislikedFoods: data.dislikedFoods ?? null,
        preferredCuisine: data.preferredCuisine ?? null,
        // v60 — شرایط خاص کاربر
        specialConditions: data.specialConditions ?? null,
        // v75 — رشتهٔ ورزشی
        discipline: data.discipline ?? null,
        // NEW (BODY-COMPOSITION-PRO): اندازه‌های اضافی
        neckMeasurement: data.neckMeasurement ?? null,
        shoulderMeasurement: data.shoulderMeasurement ?? null,
        calfMeasurement: data.calfMeasurement ?? null,
        // اندازه‌های پایه (SCHEMA-DRIFT-FIX): در create اضافه شدند — اینجا هم
        chestMeasurement: data.chestMeasurement ?? null,
        armMeasurement: data.armMeasurement ?? null,
        waistMeasurement: data.waistMeasurement ?? null,
        hipMeasurement: data.hipMeasurement ?? null,
        thighMeasurement: data.thighMeasurement ?? null,
        // v76 — ذخیرهٔ مجدد آنبوردینگ با وزن متفاوت = تغییر وزن اعلامی
        weightUpdatedAt: existingProfile && Math.abs(existingProfile.weight - data.weight) < 0.05
          ? undefined
          : new Date(),
        // Clear cached AI analysis when profile changes
        aiAnalysis: null,
      },
    });

    // v76 — ذخیرهٔ مجدد آنبوردینگ با وزن متفاوت → WeightLog جدید.
    // قبلاً فقط «وزن اولیه» ثبت می‌شد و اصلاحِ وزن در ذخیرهٔ مجدد، لاگ جدید
    // نمی‌ساخت → تولید برنامه وزنِ کهنه‌ی لاگ را می‌گرفت (ریشهٔ تیکت ۴۶/۹۷).
    if (existingProfile) {
      await logWeightChangeIfChanged(
        user.id,
        data.weight,
        existingProfile.weight,
        "به‌روزرسانی وزن (ذخیرهٔ مجدد آنبوردینگ)"
      ).catch((e) => console.error("[onboarding] failed to log weight change:", e));
    }

    // Log initial weight — فقط بار اول (L5): هر ذخیره/ویرایش مجدد آنبوردینگ
    // نباید رکورد تکراری «وزن اولیه» بسازد (نمودار پیشرفت شلوغ و چند نقطه
    // همان‌روز می‌شد). «وزن اولیه» یعنی نقطه شروع — باید ثابت بماند.
    const INITIAL_WEIGHT_NOTE = "وزن اولیه (آنبوردینگ)";
    const existingInitialWeightLog = await db.weightLog.findFirst({
      where: { userId: user.id, note: INITIAL_WEIGHT_NOTE },
      select: { id: true },
    });
    if (!existingInitialWeightLog) {
      await db.weightLog.create({
        data: { userId: user.id, weight: data.weight, note: INITIAL_WEIGHT_NOTE },
      });
    }

    // Create an initial baseline checkup so we have a "starting point" to compare future checkups against.
    // Body measurements come from the optional onboarding fields (cm); if absent, they stay null
    // and the user can fill them in their first real checkup.
    const existingCheckup = await db.checkup.findFirst({ where: { userId: user.id, phaseNumber: 0 } });
    if (!existingCheckup) {
      await db.checkup.create({
        data: {
          userId: user.id,
          phaseNumber: 0, // 0 = baseline (before any training)
          isFinalCheckup: false,
          status: "approved",
          weight: data.weight,
          chestMeasurement: data.chestMeasurement ?? null,
          armMeasurement: data.armMeasurement ?? null,
          waistMeasurement: data.waistMeasurement ?? null,
          hipMeasurement: data.hipMeasurement ?? null,
          thighMeasurement: data.thighMeasurement ?? null,
          neckMeasurement: data.neckMeasurement ?? null,
          bodyFatPercent: null,
          leanBodyMass: null,
          fatigueLevel: 3,
          sleepQuality: 3,
          dietAdherence: 3,
          workoutAdherence: 3,
          phaseCompleted: true,
          notes: "چکاپ اولیه — وضعیت شروع ورزشکار قبل از تمرین",
          aiAnalysis: null,
          coachNotes: null,
        },
      });
    } else {
      // اگر چکاپ اولیه از قبل وجود دارد و کاربر اندازه‌ها را فراهم کرده، به‌روزرسانی کن
      const hasNewMeasurements =
        data.chestMeasurement != null ||
        data.armMeasurement != null ||
        data.waistMeasurement != null ||
        data.hipMeasurement != null ||
        data.thighMeasurement != null ||
        data.neckMeasurement != null;
      if (hasNewMeasurements) {
        await db.checkup.update({
          where: { id: existingCheckup.id },
          data: {
            chestMeasurement: data.chestMeasurement ?? existingCheckup.chestMeasurement,
            armMeasurement: data.armMeasurement ?? existingCheckup.armMeasurement,
            waistMeasurement: data.waistMeasurement ?? existingCheckup.waistMeasurement,
            hipMeasurement: data.hipMeasurement ?? existingCheckup.hipMeasurement,
            thighMeasurement: data.thighMeasurement ?? existingCheckup.thighMeasurement,
            neckMeasurement: data.neckMeasurement ?? existingCheckup.neckMeasurement,
            weight: data.weight,
          },
        });
      }
    }

    // Mark onboarding done + save user's full name (firstName + lastName)
    const fullName = `${data.firstName} ${data.lastName}`.trim();

    await db.user.update({
      where: { id: user.id },
      data: {
        onboardingDone: true,
        // v32: زمان دقیق تکمیل — سناریوی پیامک ۴۶۱۲۹۱ (۲۴ ساعت بعد بدون خرید)
        onboardingCompletedAt: new Date(),
        name: fullName || user.name,
      },
    });

    // ─── v12.3: نوتیف «نصب اپ موبایل» بعد از آنبوردینگ حذف شد (درخواست مالک) ───

    return Response.json({ ok: true, message: "اطلاعات با موفقیت ذخیره شد." });
  } catch (e) {
    return apiError(e);
  }
}

// NOTE: The previous PUT method that eagerly generated workout + meal plans here
// has been removed — it was dead code (never called from the client). Plan
// generation now happens lazily after a successful payment in
// /api/payment/verify/route.ts, so users only get a plan once they've actually
// purchased a subscription.
