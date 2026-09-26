import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, apiError } from "@/lib/fitness/auth";
import { logWeightChangeIfChanged } from "@/lib/fitness/active-weight";
import {
  GOAL_LABELS, ACTIVITY_LABELS, GENDER_LABELS,
  WORKOUT_PLACE_LABELS, DIET_LABELS, TRAINING_EXPERIENCE_LABELS,
  BODY_FRAME_LABELS, WORKOUT_TIME_LABELS, PREFERRED_CUISINE_LABELS,
  MEDICAL_CONDITION_LABELS, DISCIPLINE_LABELS, sanitizeDiscipline,
  EQUIPMENT_LABELS, toPersianDigits,
} from "@/lib/fitness/types";

/**
 * v76 — اعتبارسنجی بازهٔ فیلدهای عددی بدنی.
 * وزن خارج از بازهٔ منطقی (مثل ۹۷ به‌جای ۴۶ به‌خاطر غلط تایپی) به‌عنوان
 * دادهٔ مبنا به هوش مصنوعی نمی‌رود و کاربر همان لحظه خطای شفاف می‌گیرد.
 */
const BODY_FIELD_RANGES = {
  weight: { min: 25, max: 300, label: "وزن" },       // kg — بزرگسال و نوجوان
  targetWeight: { min: 25, max: 300, label: "وزن هدف" }, // kg
  height: { min: 100, max: 250, label: "قد" },       // cm
  age: { min: 8, max: 100, label: "سن" },            // سال — v81: سقف ۱۰۰ هم‌خوان با گارد کلاینت آنبوردینگ (۱۲-۱۰۰)
} as const;

function validateBodyRanges(fields: Record<string, any>): string | null {
  for (const [key, r] of Object.entries(BODY_FIELD_RANGES)) {
    const v = fields[key];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < r.min || n > r.max) {
      return `${r.label} واردشده (${v}) خارج از بازهٔ مجاز (${r.min} تا ${r.max}) است. لطفاً اصلاح کنید.`;
    }
  }
  return null;
}

/**
 * Robustly parse a stored JSON-or-CSV string list field.
 */
function safeParseList(raw: string | null | undefined): string[] {
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
}

/**
 * GET /api/onboarding/profile
 *
 * بازگرداندن آخرین پروفایل آنبوردینگ کاربر با تمام فیلدها (برای نمایش در پنل).
 * فیتاپ هوشمند همیشه به آخرین اطلاعات دسترسی دارد چون این داده‌ها
 * در system prompt مربی هوشمند استفاده می‌شوند.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const profile = await db.onboardingProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      return Response.json({ error: "پروفایل آنبوردینگ یافت نشد." }, { status: 404 });
    }

    const medicalConditions = safeParseList(profile.medicalConditions);
    const equipment = safeParseList(profile.equipment);
    const workoutDaysList = safeParseList(profile.workoutDaysList);

    return Response.json({
      ok: true,
      profile: {
        // Identity
        firstName: user.name || null,
        mobile: user.mobile || null,
        // Basic physical
        gender: profile.gender,
        genderLabel: GENDER_LABELS[profile.gender as keyof typeof GENDER_LABELS] || profile.gender,
        age: profile.age,
        height: profile.height,
        weight: profile.weight,
        targetWeight: profile.targetWeight ?? null,
        goal: profile.goal,
        goalLabel: GOAL_LABELS[profile.goal as keyof typeof GOAL_LABELS] || profile.goal,
        activityLevel: profile.activityLevel,
        activityLabel: ACTIVITY_LABELS[profile.activityLevel as keyof typeof ACTIVITY_LABELS] || profile.activityLevel,
        workoutDays: profile.workoutDays,
        workoutDaysList,
        workoutPlace: profile.workoutPlace,
        workoutPlaceLabel: WORKOUT_PLACE_LABELS[profile.workoutPlace as keyof typeof WORKOUT_PLACE_LABELS] || profile.workoutPlace,
        workoutTime: profile.workoutTime ?? null,
        workoutTimeLabel: profile.workoutTime
          ? (WORKOUT_TIME_LABELS[profile.workoutTime as keyof typeof WORKOUT_TIME_LABELS] || profile.workoutTime)
          : null,
        // Equipment
        equipment,
        // Diet
        dietType: profile.dietType,
        dietLabel: DIET_LABELS[profile.dietType as keyof typeof DIET_LABELS] || profile.dietType,
        preferredCuisine: profile.preferredCuisine ?? null,
        preferredCuisineLabel: profile.preferredCuisine
          ? (PREFERRED_CUISINE_LABELS[profile.preferredCuisine as keyof typeof PREFERRED_CUISINE_LABELS] || profile.preferredCuisine)
          : null,
        dislikedFoods: profile.dislikedFoods ?? null,
        allergies: profile.allergies,
        // Health
        injuries: profile.injuries,
        diseases: profile.diseases,
        specialConditions: profile.specialConditions ?? null,
        drugAllergies: profile.drugAllergies ?? null,
        currentMedications: profile.currentMedications ?? null,
        medicalConditions,
        medicalConditionsLabel: medicalConditions.length > 0
          ? medicalConditions.map((c) => MEDICAL_CONDITION_LABELS[c as keyof typeof MEDICAL_CONDITION_LABELS] || c).join("، ")
          : null,
        // Recovery
        sleepHours: profile.sleepHours ?? null,
        stressLevel: profile.stressLevel ?? null,
        waterHabit: profile.waterHabit ?? null,
        bodyFrame: profile.bodyFrame ?? null,
        bodyFrameLabel: profile.bodyFrame
          ? (BODY_FRAME_LABELS[profile.bodyFrame as keyof typeof BODY_FRAME_LABELS] || profile.bodyFrame)
          : null,
        // Training experience
        trainingExperience: profile.trainingExperience ?? null,
        trainingExperienceLabel: profile.trainingExperience
          ? (TRAINING_EXPERIENCE_LABELS[profile.trainingExperience as keyof typeof TRAINING_EXPERIENCE_LABELS] || profile.trainingExperience)
          : null,
        previousTrainingType: profile.previousTrainingType ?? null,
        maxLifts: profile.maxLifts ?? null,
        // v75 — رشتهٔ ورزشی (در پروفایل قابل ویرایش) — v95: مقدار حذف‌شده (مثل kickboxing) → null
        discipline: sanitizeDiscipline(profile.discipline) ?? null,
        disciplineLabel: sanitizeDiscipline(profile.discipline)
          ? DISCIPLINE_LABELS[sanitizeDiscipline(profile.discipline)!]
          : null,
        // Target date
        targetDate: profile.targetDate ?? null,
        // v81 — تعداد وعده‌های رغبتی (در پرونده ورزشی نمایش داده می‌شود)
        mealCount: profile.mealCount ?? null,
        // Supplements
        currentSupplements: profile.currentSupplements ?? null,
        // Body composition measurements (BODY-COMPOSITION-PRO)
        neckMeasurement: profile.neckMeasurement ?? null,
        shoulderMeasurement: profile.shoulderMeasurement ?? null,
        calfMeasurement: profile.calfMeasurement ?? null,
      },
      updatedAt: profile.updatedAt,
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * Build an `allowedFields` object from the request body.
 * Accepts ALL onboarding fields and validates types.
 */
function buildUpdateFields(body: Record<string, any>): Record<string, any> {
  const allowed: Record<string, any> = {};

  // Identity / basic physical (numeric)
  if (body.weight != null) allowed.weight = Number(body.weight);
  if (body.targetWeight != null) allowed.targetWeight = Number(body.targetWeight);
  if (body.age != null) allowed.age = Number(body.age);
  if (body.height != null) allowed.height = Number(body.height);
  if (body.sleepHours != null) allowed.sleepHours = Number(body.sleepHours);
  if (body.stressLevel != null) allowed.stressLevel = Number(body.stressLevel);
  if (body.waterHabit != null) allowed.waterHabit = Number(body.waterHabit);
  if (body.workoutDays != null) allowed.workoutDays = Number(body.workoutDays);
  // v81 — تعداد وعده‌های رغبتی (۲-۸) در ویرایش پروفایل هم قابل آپدیت
  if (body.mealCount != null) {
    const mc = Math.round(Number(body.mealCount));
    allowed.mealCount = Number.isFinite(mc) ? Math.max(2, Math.min(8, mc)) : null;
  }
  if (body.neckMeasurement != null) allowed.neckMeasurement = Number(body.neckMeasurement);
  if (body.shoulderMeasurement != null) allowed.shoulderMeasurement = Number(body.shoulderMeasurement);
  if (body.calfMeasurement != null) allowed.calfMeasurement = Number(body.calfMeasurement);

  // Numeric strings — empty string = null
  const numOrNull = (v: any): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };
  if (body.targetWeight !== undefined) allowed.targetWeight = numOrNull(body.targetWeight);
  if (body.sleepHours !== undefined) allowed.sleepHours = numOrNull(body.sleepHours);
  if (body.stressLevel !== undefined) allowed.stressLevel = numOrNull(body.stressLevel);
  if (body.waterHabit !== undefined) allowed.waterHabit = numOrNull(body.waterHabit);
  if (body.neckMeasurement !== undefined) allowed.neckMeasurement = numOrNull(body.neckMeasurement);
  if (body.shoulderMeasurement !== undefined) allowed.shoulderMeasurement = numOrNull(body.shoulderMeasurement);
  if (body.calfMeasurement !== undefined) allowed.calfMeasurement = numOrNull(body.calfMeasurement);

  // Text fields — empty string preserved as empty (clears the value)
  const textFields: (keyof typeof body)[] = [
    "injuries", "diseases", "allergies", "drugAllergies", "currentMedications",
    "maxLifts", "dislikedFoods", "previousTrainingType", "currentSupplements",
    "targetDate",
  ];
  for (const f of textFields) {
    if (body[f] != null) allowed[f as string] = String(body[f]);
  }
  // v60 — شرایط خاص کاربر: سقف ۶۰۰ کاراکتر (هم‌راستا با UI آنبوردینگ)
  // v75 — «توضیحات کاربر» در پروفایل — ارسال رشتهٔ خالی هم مقدار را پاک می‌کند
  if (body.specialConditions != null) {
    allowed.specialConditions = String(body.specialConditions).trim().slice(0, 600) || null;
  }

  // v75 — رشتهٔ ورزشی (فقط مقادیر شناخته‌شده؛ رشتهٔ خالی = پاک کردن)
  if (body.discipline !== undefined) {
    const v = typeof body.discipline === "string" ? body.discipline.trim() : "";
    allowed.discipline = v && v in DISCIPLINE_LABELS ? v : null;
  }

  // Enum-like string fields
  const strFields: (keyof typeof body)[] = [
    "preferredCuisine", "workoutTime", "workoutPlace",
    "trainingExperience", "goal", "activityLevel", "dietType", "bodyFrame", "gender",
  ];
  for (const f of strFields) {
    if (body[f] != null) allowed[f as string] = String(body[f]);
  }

  // Array-like fields — stored as JSON string
  if (body.equipment != null) {
    allowed.equipment = JSON.stringify(
      Array.isArray(body.equipment) ? body.equipment : String(body.equipment).split(",").map((s) => s.trim()).filter(Boolean)
    );
  }
  if (body.workoutDaysList != null) {
    allowed.workoutDaysList = JSON.stringify(
      Array.isArray(body.workoutDaysList) ? body.workoutDaysList : String(body.workoutDaysList).split(",").map((s) => s.trim()).filter(Boolean)
    );
  }
  if (body.medicalConditions != null) {
    allowed.medicalConditions = JSON.stringify(
      Array.isArray(body.medicalConditions) ? body.medicalConditions : String(body.medicalConditions).split(",").map((s) => s.trim()).filter(Boolean)
    );
  }

  return allowed;
}

// ─── v107 — تیکت خودکار «تغییر پروفایل» به بخش تیکت‌های مدیر ───
// دیرکتیو مالک: وقتی ورزشکار پروفایل «خودش» را ویرایش می‌کند (مثلاً وزن)،
// باید تیکتی در بخش تیکت‌های مدیر ساخته شود («کاربر فلان پروفایل خود را ویرایش
// کرده») تا مدیر وارد پروفایل کاربر شود، دکمهٔ «به‌روزرسانی برنامه» را بزند و
// برنامه با مشخصات جدید بازسازی شود.
// ویرایشِ خودِ ادمین از مسیر جداگانهٔ PUT /api/admin/users/[id]/details می‌رود
// و عمداً تیکت نمی‌سازد (مدیر خودش در جریان تغییر است).

/**
 * فیلدهای «معنادار» که تغییرشان بازبینی برنامه را لازم می‌کند + برچسب فارسی.
 * تغییر فیلدهای غیر از این‌ها (مثل sleepHours یا measurements) تیکت نمی‌سازد.
 * nutritionNotes فعلاً در whitelist این route نیست ولی در لیست مانده تا اگر
 * روزی قابل ویرایش شد، تیکت خودش آن را پوشش دهد.
 */
const PROFILE_TICKET_FIELDS: { key: string; label: string }[] = [
  { key: "weight", label: "وزن" },
  { key: "targetWeight", label: "وزن هدف" },
  { key: "height", label: "قد" },
  { key: "age", label: "سن" },
  { key: "gender", label: "جنسیت" },
  { key: "goal", label: "هدف" },
  { key: "discipline", label: "رشتهٔ ورزشی" },
  { key: "trainingExperience", label: "سابقهٔ تمرینی" },
  { key: "workoutDays", label: "روزهای تمرین" },
  { key: "injuries", label: "آسیب‌ها" },
  { key: "diseases", label: "بیماری‌ها" },
  { key: "currentMedications", label: "داروها" },
  { key: "dietType", label: "نوع رژیم" },
  { key: "allergies", label: "حساسیت‌ها" },
  { key: "equipment", label: "تجهیزات" },
  { key: "activityLevel", label: "سطح فعالیت" },
  { key: "currentSupplements", label: "مکمل‌های فعلی" },
  { key: "nutritionNotes", label: "توضیحات تغذیه" },
];

/** پیشوند موضوع تیکت‌های خودکار — مبنای تشخیص تکراری در کول‌داون ۲۴ ساعته */
const PROFILE_TICKET_SUBJECT_PREFIX = "تغییر پروفایل";

/** قالب‌بندی فارسی یک مقدار پروفایل برای متن تیکت (سبک — بدون وابستگی جدید). */
function formatProfileTicketValue(key: string, raw: unknown): string {
  const EMPTY = "(خالی)";
  if (raw == null || raw === "") return EMPTY;
  switch (key) {
    case "weight":
    case "targetWeight":
      return Number.isFinite(Number(raw)) ? `${toPersianDigits(Number(raw))} کیلوگرم` : String(raw);
    case "height":
      return Number.isFinite(Number(raw)) ? `${toPersianDigits(Number(raw))} سانتی‌متر` : String(raw);
    case "age":
      return Number.isFinite(Number(raw)) ? `${toPersianDigits(Number(raw))} سال` : String(raw);
    case "workoutDays":
      return Number.isFinite(Number(raw)) ? `${toPersianDigits(Number(raw))} روز در هفته` : String(raw);
    case "gender":
      return GENDER_LABELS[raw as keyof typeof GENDER_LABELS] || String(raw);
    case "goal":
      return GOAL_LABELS[raw as keyof typeof GOAL_LABELS] || String(raw);
    case "dietType":
      return DIET_LABELS[raw as keyof typeof DIET_LABELS] || String(raw);
    case "activityLevel":
      return ACTIVITY_LABELS[raw as keyof typeof ACTIVITY_LABELS] || String(raw);
    case "trainingExperience":
      return TRAINING_EXPERIENCE_LABELS[raw as keyof typeof TRAINING_EXPERIENCE_LABELS] || String(raw);
    case "discipline": {
      const d = sanitizeDiscipline(raw);
      return d ? DISCIPLINE_LABELS[d] : EMPTY;
    }
    case "equipment": {
      const list = safeParseList(typeof raw === "string" ? raw : null);
      if (list.length === 0) return EMPTY;
      return list.map((id) => EQUIPMENT_LABELS[id] || id).join("، ");
    }
    default: {
      // فیلدهای متنی آزاد (آسیب‌ها/بیماری‌ها/داروها/...) — کوتاه‌شده برای خوانایی تیکت
      const t = String(raw).trim();
      if (!t) return EMPTY;
      return t.length > 120 ? `${t.slice(0, 120)}…` : t;
    }
  }
}

/**
 * مقایسهٔ فیلدهای معنادار پروفایل (سطر قبل از آپدیت در برابر سطر بعد از آن)
 * → خطوط تیکت به‌صورت { برچسب، مقدار قبلی، مقدار جدید }.
 * مقایسهٔ خام است (نه قالب‌بندی‌شده) تا تغییرِ صرفِ قالب، تیکت نسازد.
 */
function buildProfileTicketDiff(
  before: Record<string, any>,
  after: Record<string, any>
): { key: string; label: string; from: string; to: string }[] {
  const lines: { key: string; label: string; from: string; to: string }[] = [];
  for (const { key, label } of PROFILE_TICKET_FIELDS) {
    const oldRaw = before[key];
    const newRaw = after[key];
    if (key === "equipment") {
      // ترتیب اقلام نباید تیکت بسازد — مقایسهٔ مجموعه‌ای
      const norm = (v: unknown) => safeParseList(typeof v === "string" ? v : null).sort().join("|");
      if (norm(oldRaw) === norm(newRaw)) continue;
    } else if (
      oldRaw === newRaw ||
      (oldRaw == null && (newRaw == null || newRaw === "")) ||
      (newRaw == null && oldRaw === "")
    ) {
      continue;
    }
    // گارد نمایشی: اگر بعد از قالب‌بندی فارسی هر دو مقدار یکسان شدند
    // (مثل discipline نامعتبرِ قدیمی → null)، خط بی‌معنی «(خالی) ← (خالی)» نساز
    const from = formatProfileTicketValue(key, oldRaw);
    const to = formatProfileTicketValue(key, newRaw);
    if (from === to) continue;
    lines.push({ key, label, from, to });
  }
  return lines;
}

/**
 * PUT /api/onboarding/profile
 *
 * آپدیت کامل پروفایل آنبوردینگ کاربر (تمام فیلدها).
 * بعد از ذخیره، فیتاپ هوشمند در چت و تولید برنامه از این اطلاعات استفاده می‌کند.
 *
 * (PATCH نیز برای سازگاری با نسخه‌های قبلی نگه داشته شده است.)
 */
export async function PUT(req: NextRequest) {
  return updateProfile(req);
}

export async function PATCH(req: NextRequest) {
  return updateProfile(req);
}

async function updateProfile(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const allowedFields = buildUpdateFields(body || {});

    if (Object.keys(allowedFields).length === 0) {
      return Response.json({ error: "هیچ فیلدی برای آپدیت ارسال نشده است." }, { status: 400 });
    }

    const existing = await db.onboardingProfile.findUnique({ where: { userId: user.id } });
    if (!existing) {
      return Response.json({ error: "پروفایل آنبوردینگ یافت نشد." }, { status: 404 });
    }

    // v76 — اعتبارسنجی بازهٔ فیلدهای بدنی (وزن/قد/سن/وزن هدف)
    const rangeError = validateBodyRanges(allowedFields);
    if (rangeError) {
      return Response.json({ error: rangeError }, { status: 400 });
    }

    // v76 — تغییر وزن: همگام‌سازی دو منبع (پروفایل + WeightLog).
    // قبلاً فقط پروفایل آپدیت می‌شد و WeightLog قدیمی (وزن آنبوردینگ) باقی
    // می‌ماند؛ تولید برنامه latestWeightLog را اولویت می‌داد و برنامه با
    // وزنِ کهنه ساخته می‌شد (تیکت ۴۶/۹۷). حالا:
    //  ۱) WeightLog جدید با نوت شفاف ثبت می‌شود (نمودار وزن هم درست می‌ماند)
    //  ۲) weightUpdatedAt پروفایل به‌روز می‌شود (رزولور مرکزی مبنا می‌گیرد)
    const weightChanged = allowedFields.weight != null && Number(allowedFields.weight) !== existing.weight;
    if (weightChanged) {
      allowedFields.weightUpdatedAt = new Date();
    }

    const updated = await db.onboardingProfile.update({
      where: { userId: user.id },
      // ─── M5: کش تحلیل AI آنبوردینگ را باطل کن — مثل POST /api/onboarding.
      // بدون این، GET /api/onboarding/analysis تا force نشود، متن قدیمی
      // (با وزن/هدف قبلی) برمی‌گرداند در حالی که پروفایل ویرایش شده است.
      data: { ...allowedFields, aiAnalysis: null },
    });

    if (weightChanged) {
      await logWeightChangeIfChanged(
        user.id,
        Number(allowedFields.weight),
        existing.weight,
        "به‌روزرسانی وزن از پروفایل"
      ).catch((e) => console.error("[profile] failed to log weight change:", e));
    }

    // ثبت نوتیف برای کاربر
    // v63 — از createNotification با dedupe داخلی می‌رود (نه db مستقیم):
    // ذخیره‌های مکرر پروفایل دیگر نوتیف تکراری «پروفایل به‌روزرسانی شد» نمی‌سازند
    // و پنجرهٔ ۶۰ دقیقه‌ای dedupe + push یک‌بارمصرف تضمین می‌شود (گزارش مالک:
    // «برای همه نوتیف‌ها باید تست کن — هر نوتیف یک‌بار»).
    const { createNotification } = await import("@/lib/fitness/notifications");
    await createNotification(
      user.id,
      "system",
      "پروفایل شما به‌روزرسانی شد ✅",
      "اطلاعات پروفایل و پرونده پزشکی شما با موفقیت ذخیره شد. فیتاپ هوشمند از این پس از آخرین اطلاعات شما در چت و تولید برنامه استفاده خواهد کرد."
    ).catch(() => {});

    // ─── v107 — تیکت خودکار «تغییر پروفایل» برای مدیر (فقط مسیر کاربرِ خودش) ───
    // additive-محض: هیچ‌وقت جریان ذخیرهٔ پروفایل را نمی‌شکند (try/catch کامل).
    // شرط‌ها: ۱) حداقل یک فیلد معنادار واقعاً عوض شده باشد
    //         ۲) کاربر برنامهٔ تمرینی فعلی داشته باشد (کاربرِ بدون برنامه بعداً
    //            برنامه را با پروفایل تازه می‌گیرد و بازبینی معنا ندارد)
    //         ۳) کول‌داون: تیکت «تغییر پروفایل» بازی در ۲۴ ساعت اخیر نباشد
    //            (ضداسپم ذخیره‌های مکرر)
    const profileDiff = buildProfileTicketDiff(existing as Record<string, any>, updated as Record<string, any>);
    let changeTicketCreated = false;
    if (profileDiff.length > 0) {
      try {
        const activePlan = await db.workoutPlan.findFirst({
          where: { userId: user.id, active: true },
          select: { id: true },
        });
        if (activePlan) {
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const openDuplicate = await db.supportTicket.findFirst({
            where: {
              userId: user.id,
              category: "program",
              subject: { startsWith: PROFILE_TICKET_SUBJECT_PREFIX },
              status: "open",
              createdAt: { gte: dayAgo },
            },
            select: { id: true },
            orderBy: { createdAt: "desc" },
          });
          if (!openDuplicate) {
            const displayName = user.name?.trim() || "ورزشکار";
            const userTag = user.mobile ? `${displayName} (موبایل: ${user.mobile})` : displayName;
            // نکتهٔ تایپوگرافی RTL: پیکان «←» عمدی است — در پاراگراف راست‌به‌چپ
            // «قبلی ← جدید» به‌صورت «از قبلی به جدید» خوانده می‌شود (پیکان رو به
            // جلوِ خواندن). با «→» پیکان به مقدار قدیمی اشاره می‌کند و گمراه‌کننده است.
            const diffText = profileDiff
              .map((d) => `• ${d.label}: ${d.from} ← ${d.to}`)
              .join("\n");
            await db.supportTicket.create({
              data: {
                userId: user.id,
                subject: `${PROFILE_TICKET_SUBJECT_PREFIX} کاربر — نیاز به بازبینی برنامه`,
                category: "program",
                priority: "normal",
                status: "open",
                message: `کاربر ${userTag} پروفایل خود را ویرایش کرد:\n${diffText}\n\nبرای بازسازی برنامه با مشخصات جدید، به پروفایل کاربر بروید و «به‌روزرسانی برنامه» را بزنید.`,
                adminReadAt: null,
              },
            });
            // نوتیف برای همهٔ ادمین‌ها — بدون پیامک (جلوگیری از هزینهٔ اسپم).
            // همان الگوی POST /api/support/tickets (createMany مستقیم روی Notification).
            const admins = await db.user.findMany({
              where: { role: "ADMIN" },
              select: { id: true },
            });
            if (admins.length > 0) {
              await db.notification.createMany({
                data: admins.map((a) => ({
                  userId: a.id,
                  type: "system",
                  title: "تغییر پروفایل کاربر 📝",
                  body: `${displayName} ${toPersianDigits(profileDiff.length)} فیلد پروفایل را تغییر داد — برنامه نیاز به بازبینی دارد`,
                  read: false,
                })),
              });
            }
            changeTicketCreated = true;
          }
        }
      } catch (ticketErr) {
        console.error("[profile] failed to create profile-change ticket:", ticketErr);
      }
    }

    return Response.json({
      ok: true,
      message: "پروفایل با موفقیت به‌روزرسانی شد و به مربی هوشمند تزریق شد",
      updatedFields: Object.keys(allowedFields),
      updatedAt: updated.updatedAt,
      // v76 — اگر وزن تغییر کرده، UI می‌تواند پیشنهاد بازتولید برنامه بدهد
      weightChanged,
      weight: updated.weight,
      // v107 — اگر تیکت بازبینی برای مدیر ساخته شد، کلاینت توستِ ارجاع را نشان می‌دهد
      changeTicketCreated,
      changedFields: changeTicketCreated ? profileDiff.map((d) => d.label) : [],
    });
  } catch (e) {
    return apiError(e);
  }
}
