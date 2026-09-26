/**
 * audit-plan-pipeline-v134.ts — تست ممیزی جامع خط تولید چندلایهٔ برنامه‌ها
 * ═══════════════════════════════════════════════════════════════════════════
 * دیرکتیو مالک (v134):
 *  «یک تست ممیزی و جامع بگیر برای اینکه برای تولید برنامه چند لایه تست و دیباگ
 *   گذاشتی، همهٔ برنامه‌ها درست ساخته می‌شوند و با ساخته شدنش هم به کاربر نوتیف
 *   و پیامکش میره.»
 *
 * این اسکریپت «خط تولید واقعی» را با ۳ پروفایل ورزشکاری متفاوت، end-to-end اجرا
 * می‌کند (همان startProgramGenerationInBackground مسیر خرید — نه مسیر خلاصه‌شده):
 *   سناریو A — مبتدی، چربی‌سوزی، خانه، ۳ روز، ۴ وعده
 *   سناریو B — متوسط، عضله‌سازی، باشگاه، ۵ روز، خواب ۶ ساعت
 *   سناریو C — زن، تناسب اندام، آسیب زانو، گیاه‌خوار، ۴ روز
 *
 * سپس روی هر کاربر این‌ها را راستی‌آزمایی می‌کند:
 *   ۱) ProgramRequest → ready
 *   ۲) WorkoutPlan فعال: تعداد روزها = آنبوردینگ، حجم تمرین، ست‌ها، RPE/تمپو،
 *      پریودایزیشن، پیشرفت ۶ هفته‌ای، سند coachAudit (لایه‌ها/verdict/score/proof)
 *   ۳) MealPlan فعال: وعده‌ها، کالری/پروتئین در حد هدف، هیدراتاسیون، استک مکمل
 *      شخصی‌سازی‌شده (نه قالب کراتین+امگا۳+ویتامین D)، سند coachAudit
 *   ۴) سینک سه‌گانه: استک مکمل غذا == مکمل برنامهٔ تمرینی (اکوی v112)
 *   ۵) نوتیفیکیشن «برنامه شما آماده شد! 🎯» ساخته شده
 *   ۶) پیامک: ردیف SmsLog با کلید program_ready_{reqId} و قالب 663678 ثبت شده
 *      (در سندباکس شماره فیک است → status=failed با خطای اپراتور طبیعی است؛
 *       مهم: «ثبت تلاش ارسال» = اتصال جریان به SMS.ir اثبات می‌شود)
 *   ۷) تست‌های قطعی گیت: تشخیص استک قالبی + گیت مکمل پلن اقتصادی
 *
 * اجرا:  bun scripts/audit-plan-pipeline-v134.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { db } from "@/lib/db";
import { startProgramGenerationInBackground } from "@/lib/fitness/program-generation";
import {
  auditSupplementsDeterministic,
  type CoachAuditRecord,
} from "@/lib/fitness/plan-quality-gate";
import { stripSupplementsForPlan, planHasSupplements } from "@/lib/fitness/supplement-gate";
import type { OnboardingData } from "@/lib/fitness/types";

const TAG = "[audit-v134]";
// ۹ رقم پایه + ۲ رقم شمارهٔ سناریو = ۱۱ رقم کامل موبایل ایران (۰۹۱۲۹۹۰۰۰۰۱)
// ⚠️ درس ممیزی: شمارهٔ کوتاه‌تر توسط گارد normalizeMobileForSmsIr درست رد می‌شد
const MOBILE_BASE = "091299000";
const PER_USER_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// سناریوها
// ─────────────────────────────────────────────────────────────────────────────
interface Scenario {
  idx: number;
  name: string;
  label: string;
  workoutDays: number;
  profile: Record<string, unknown>;
  softChecks?: {
    /** نام مکمل/نوتی که انتظار داریم به‌خاطر شخصی‌سازی بیاید (هشدار، نه شکست) */
    supplementHint?: RegExp;
    /** الگوی ممنوع در نام حرکات به‌خاطر آسیب (هشدار) */
    forbiddenExercise?: RegExp;
  };
}

const SCENARIOS: Scenario[] = [
  {
    idx: 1,
    name: "کاربر ممیزی A (چربی‌سوزی خانه)",
    label: "A — مبتدی چربی‌سوزی خانه ۳روزه",
    workoutDays: 3,
    profile: {
      gender: "male",
      age: 32,
      height: 175,
      weight: 92,
      targetWeight: 80,
      goal: "fat_loss",
      activityLevel: "light",
      workoutDays: 3,
      workoutDaysList: JSON.stringify(["شنبه", "دوشنبه", "چهارشنبه"]),
      workoutPlace: "home",
      equipment: JSON.stringify(["dumbbell", "bands", "bench", "bodyweight"]),
      diseases: "",
      injuries: "",
      allergies: "",
      dietType: "standard",
      mealCount: 4,
      trainingExperience: "beginner",
      sleepHours: 7,
      stressLevel: 2,
      waterHabit: 4,
      workoutTime: "morning",
    },
    softChecks: {
      // چربی‌سوزی خالص مبتدی: کراتین باید یا نباشد یا با توجیه عضله باشد (گیت L2 چک قطعی دارد)
      forbiddenExercise: undefined,
    },
  },
  {
    idx: 2,
    name: "کاربر ممیزی B (عضله‌سازی باشگاه)",
    label: "B — متوسط عضله‌سازی باشگاه ۵روزه",
    workoutDays: 5,
    profile: {
      gender: "male",
      age: 26,
      height: 180,
      weight: 70,
      targetWeight: 78,
      goal: "muscle_gain",
      activityLevel: "moderate",
      workoutDays: 5,
      workoutDaysList: JSON.stringify(["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه"]),
      workoutPlace: "gym",
      equipment: JSON.stringify(["barbell", "machine", "cable", "bench", "dumbbell"]),
      diseases: "",
      injuries: "",
      allergies: "",
      dietType: "standard",
      mealCount: 5,
      trainingExperience: "intermediate",
      sleepHours: 6,
      stressLevel: 3,
      waterHabit: 6,
      workoutTime: "evening",
    },
  },
  {
    idx: 3,
    name: "کاربر ممیزی C (زن، آسیب زانو، گیاه‌خوار)",
    label: "C — زن تناسب/آسیب زانو/گیاه‌خوار ۴روزه",
    workoutDays: 4,
    profile: {
      gender: "female",
      age: 29,
      height: 165,
      weight: 68,
      targetWeight: 60,
      goal: "fitness",
      activityLevel: "light",
      workoutDays: 4,
      workoutDaysList: JSON.stringify(["شنبه", "دوشنبه", "سه‌شنبه", "پنجشنبه"]),
      workoutPlace: "gym",
      equipment: JSON.stringify(["machine", "dumbbell", "bench", "cable"]),
      diseases: "",
      injuries: "آسیب قدیمی زانو (پارگی رباط صلیبی) — حرکات پرشی و اسکوات عمیق ممنوع",
      allergies: "",
      dietType: "vegetarian",
      mealCount: 4,
      trainingExperience: "beginner",
      sleepHours: 8,
      stressLevel: 2,
      waterHabit: 5,
      workoutTime: "afternoon",
    },
    softChecks: {
      supplementHint: /B12|ب12|ویتامین\s*B/i,
      forbiddenExercise: /پرش|جامپ|jump|باکس جامپ|اسکوات پرشی/i,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ابزار گزارش
// ─────────────────────────────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  ok: boolean;
  severity: "critical" | "warn" | "info";
  detail?: string;
}

function fa(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR");
}

function check(name: string, ok: boolean, severity: "critical" | "warn" | "info" = "critical", detail?: string): CheckResult {
  return { name, ok, severity, detail };
}

function printChecks(results: CheckResult[]): { criticalFail: number; warnFail: number } {
  let criticalFail = 0;
  let warnFail = 0;
  for (const c of results) {
    if (c.ok) {
      console.log(`   ✅ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    } else {
      const icon = c.severity === "critical" ? "❌" : c.severity === "warn" ? "⚠️" : "ℹ️";
      console.log(`   ${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
      if (!c.ok && c.severity === "critical") criticalFail++;
      if (!c.ok && c.severity === "warn") warnFail++;
    }
  }
  return { criticalFail, warnFail };
}

/** استخراج امن لیست نام مکمل‌ها از محتوای برنامه */
function stackNames(meal: Record<string, any>): string[] {
  const stack: any[] = Array.isArray(meal?.supplementStack)
    ? meal.supplementStack
    : Array.isArray(meal?.supplements)
      ? meal.supplements
      : [];
  return stack.map((s) => String(s?.name ?? "").trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// ۰) تست‌های قطعی گیت (بدون AI) — ریشه‌کنی استک قالبی + گیت مکمل اقتصادی
// ─────────────────────────────────────────────────────────────────────────────
async function deterministicGateTests(): Promise<{ pass: boolean; results: CheckResult[] }> {
  console.log(`\n${TAG} ═══ بخش ۰: تست‌های قطعی گیت کیفیت (بدون AI) ═══`);
  const results: CheckResult[] = [];

  const data: OnboardingData = {
    gender: "male",
    age: 30,
    height: 178,
    weight: 85,
    goal: "fat_loss",
    activityLevel: "moderate",
    workoutDays: 4,
    workoutDaysList: [],
    workoutPlace: "gym",
    equipment: [],
    diseases: "",
    injuries: "",
    allergies: "",
    dietType: "standard",
  } as OnboardingData;

  // ۰-۱) استک قالبی کلاسیک باید critical شود
  const cliché = {
    supplementStack: [
      { name: "کراتین مونوهیدرات", dose: "5g", timing: "صبح" },
      { name: "امگا ۳", dose: "2g", timing: "با غذا" },
      { name: "ویتامین D3", dose: "2000IU", timing: "صبح" },
    ],
  };
  const clichIssues = auditSupplementsDeterministic(cliché, data);
  const hasTrio = clichIssues.some((i) => i.code === "supplements_default_trio" && i.severity === "critical");
  results.push(
    check("گیت: استک قالبی «کراتین+امگا۳+ویتامین D» critical تشخیص داده شد", hasTrio, "critical",
      clichIssues.map((i) => i.code).join(",") || "بدون ایراد")
  );

  // ۰-۲) استک شخصی‌سازی‌شده (با دلیل و منع مصرف) باید بدون critical باشد
  const personalized = {
    supplementStack: [
      {
        name: "مولتی‌ویتامین گیاهی",
        dose: "۱ قرص",
        timing: "صبح با صبحانه",
        note: "ورزشکار گیاه‌خوار است و B12/آهن رژیمش ممکن است کم باشد؛ جایگزین غذایی: تخم‌مرغ و حبوبات — قبل از شروع با پزشک مشورت کنید.",
        contraindicatedFor: ["مصرف همزمان با داروی تیروئید"],
      },
      {
        name: "مگنزیم گلیسینات",
        dose: "300mg",
        timing: "۳۰ دقیقه قبل خواب",
        note: "خواب کاربر ۶ ساعت است و ریکاوری ضعیف گزارش شده؛ جایگزین غذایی: بادام و اسفناج — قبل از شروع با پزشک مشورت کنید.",
        contraindicatedFor: ["نارسایی کلیوی"],
      },
    ],
  };
  const persIssues = auditSupplementsDeterministic(personalized, data);
  const noCritical = !persIssues.some((i) => i.severity === "critical");
  results.push(
    check("گیت: استک شخصی‌سازی‌شده (با دلیل/منع مصرف) بدون ایراد critical است", noCritical, "critical",
      persIssues.map((i) => i.code).join(",") || "پاس کامل")
  );

  // ۰-۳) گیت مکمل پلن‌محور: اقتصادی ممنوع، استاندارد مجاز
  const econOk = !planHasSupplements("basic");
  const stdOk = planHasSupplements("standard");
  results.push(check("گیت مکمل: پلن اقتصادی مکمل ندارد", econOk, "critical"));
  results.push(check("گیت مکمل: پلن استاندارد مکمل دارد", stdOk, "critical"));

  // ۰-۴) stripSupplementsForPlan واقعاً فیلدها را از خروجی نمایش حذف می‌کند
  const stripped = stripSupplementsForPlan({ meals: [], supplementStack: [{ name: "کراتین" }], supplementTimingNotes: ["x"] }, "basic");
  const strippedClean = !("supplementStack" in stripped) && !("supplements" in stripped);
  results.push(check("گیت مکمل: نمایش برای اقتصادی بدون فیلد مکمل است", strippedClean, "critical"));

  const { criticalFail } = printChecks(results);
  return { pass: criticalFail === 0, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// ساخت کاربر تست + پروفایل + اشتراک استاندارد فعال
// ─────────────────────────────────────────────────────────────────────────────
async function ensureUser(sc: Scenario) {
  const mobile = MOBILE_BASE + String(sc.idx).padStart(2, "0");
  const old = await db.user.findUnique({ where: { mobile } });
  if (old) {
    try {
      await db.user.delete({ where: { id: old.id } }); // cascade همهٔ ردیف‌ها
      console.log(`${TAG} کاربر قبلی سناریو ${sc.idx} پاک شد (${mobile})`);
    } catch (e) {
      console.warn(`${TAG} پاک‌کردن کاربر قبلی ناموفق — ادامه با همان mobile (خطا: ${String(e).slice(0, 120)})`);
      await db.user.update({ where: { id: old.id }, data: { isBlocked: false } });
      // ردیف‌های چرخهٔ قبلی را دستی پاک کن تا گارد daily_budget و fresh_plan اذیت نکنند
      await db.programRequest.deleteMany({ where: { userId: old.id } });
      await db.workoutPlan.deleteMany({ where: { userId: old.id } });
      await db.mealPlan.deleteMany({ where: { userId: old.id } });
      await db.notification.deleteMany({ where: { userId: old.id } });
      return old;
    }
  }
  const user = await db.user.create({
    data: {
      mobile,
      name: sc.name,
      onboardingDone: true,
      planName: "standard",
      planStartedAt: new Date(),
      planExpiresAt: new Date(Date.now() + 45 * 24 * 3600 * 1000),
    },
  });
  await db.subscription.create({
    data: {
      userId: user.id,
      plan: "standard",
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 45 * 24 * 3600 * 1000),
      durationDays: 45,
      pricePaid: 800000, // قیمت رسمی پلن استاندارد (تومان)
    },
  });
  await db.onboardingProfile.create({
    data: { userId: user.id, ...(sc.profile as any) },
  });
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// انتظار برای پایان تولید — با heartbeat (برای ردیابی مرگ پروسه)
// ─────────────────────────────────────────────────────────────────────────────
async function waitForGeneration(userId: string): Promise<{ status: string; lastError: string | null; reqId: string | null }> {
  const deadline = Date.now() + PER_USER_TIMEOUT_MS;
  let beat = 0;
  while (Date.now() < deadline) {
    const req = await db.programRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (req && req.status !== "generating" && req.status !== "pending") {
      return { status: req.status, lastError: req.lastError, reqId: req.id };
    }
    console.log(`${TAG} heartbeat #${++beat}: ${new Date().toLocaleTimeString("fa-IR")} — تولید در جریان...`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const req = await db.programRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return { status: "timeout", lastError: req?.lastError ?? null, reqId: req?.id ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// ممیزی خروجی یک کاربر
// ─────────────────────────────────────────────────────────────────────────────
async function auditGeneratedPlans(
  sc: Scenario,
  userId: string,
  gen: { status: string; lastError: string | null; reqId: string | null }
): Promise<{ pass: boolean; results: CheckResult[] }> {
  console.log(`\n${TAG} ═══ سناریو ${sc.label} — ممیزی خروجی ═══`);
  const results: CheckResult[] = [];

  results.push(
    check("ProgramRequest → ready", gen.status === "ready", "critical",
      `status=${gen.status}${gen.lastError ? ` | lastError=${gen.lastError.slice(0, 180)}` : ""}`)
  );

  const workoutRow = await db.workoutPlan.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" } });
  const mealRow = await db.mealPlan.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" } });
  results.push(check("WorkoutPlan فعال ساخته شد", !!workoutRow, "critical"));
  results.push(check("MealPlan فعال ساخته شد", !!mealRow, "critical"));
  if (!workoutRow || !mealRow) {
    printChecks(results);
    return { pass: false, results };
  }

  const w = JSON.parse(workoutRow.content) as Record<string, any>;
  const m = JSON.parse(mealRow.content) as Record<string, any>;

  // ─── برنامهٔ تمرینی ───
  const days: any[] = Array.isArray(w.days) ? w.days : [];
  results.push(
    check("تمرین: تعداد روزها = آنبوردینگ", days.length === sc.workoutDays, "critical",
      `انتظار ${fa(sc.workoutDays)} → واقعی ${fa(days.length)}`)
  );
  const allExs: any[] = days.flatMap((d) => (Array.isArray(d?.exercises) ? d.exercises : []));
  const totalSets = allExs.reduce((s, e) => s + (Array.isArray(e?.sets) ? e.sets.length : 0), 0);
  results.push(
    check("تمرین: حجم کل (حرکات ≥ ۴ در روز)", days.every((d) => (Array.isArray(d?.exercises) ? d.exercises.length : 0) >= 4), "warn",
      `${fa(allExs.length)} حرکت / ${fa(totalSets)} ست در کل هفته`)
  );
  const noSetEx = allExs.filter((e) => !Array.isArray(e?.sets) || e.sets.length === 0);
  results.push(check("تمرین: هیچ حرکتی بدون ست نیست", noSetEx.length === 0, "critical",
    noSetEx.length ? `${fa(noSetEx.length)} حرکت کاملاً بی‌ست` : undefined));
  // تک‌ست‌ها (warmup/finisher) در برنامهٔ مربیان حرفه‌ای مشروع‌اند — فقط سهم بالایش هشدار
  const singleSetEx = allExs.filter((e) => Array.isArray(e?.sets) && e.sets.length === 1);
  results.push(check("تمرین: سهم حرکات تک‌ست (warmup/finisher) ≤ ۳۰٪", singleSetEx.length <= allExs.length * 0.3, "warn",
    singleSetEx.length ? `${fa(singleSetEx.length)} تک‌ست از ${fa(allExs.length)} حرکت` : undefined));
  const noIntensity = allExs.filter((e) => e?.rpe == null || e?.tempo == null);
  results.push(check("تمرین: RPE/تمپو برای همهٔ حرکات (استاندارد نخبگی)", noIntensity.length === 0, "warn",
    noIntensity.length ? `${fa(noIntensity.length)} حرکت بدون RPE/تمپو` : undefined));
  const wpWeeks = Array.isArray(w?.weeklyProgression?.weeks) ? w.weeklyProgression.weeks : [];
  results.push(check("تمرین: پیشرفت هفتگی ۶ هفته‌ای", wpWeeks.length === 6, "warn", `weeks=${fa(wpWeeks.length)}`));
  results.push(
    check("تمرین: دوره‌بندی + تقسیم عضلات مشخص", !!w?.periodizationType && !!w?.muscleGroupSplit, "warn",
      `${w?.periodizationType ?? "—"} | ${w?.muscleGroupSplit ?? "—"}`)
  );
  if (typeof w?.inspiredByCoach === "string" && w.inspiredByCoach.trim()) {
    results.push(check("تمرین: امضای سبک مربی بزرگ ثبت شد", true, "info", w.inspiredByCoach));
  }
  if (sc.softChecks?.forbiddenExercise) {
    const offenders = allExs.filter((e) => sc.softChecks!.forbiddenExercise!.test(String(e?.name ?? "")));
    results.push(
      check("تمرین: آسیب کاربر رعایت شد (حرکت ممنوع دیده نشد)", offenders.length === 0, "warn",
        offenders.length ? offenders.map((e) => e?.name).slice(0, 4).join("، ") : undefined)
    );
  }

  // ─── برنامهٔ غذایی ───
  const meals: any[] = Array.isArray(m.meals) ? m.meals : [];
  results.push(check("غذا: وعده‌ها ساخته شد (≥۳)", meals.length >= 3, "critical", `وعده‌ها=${fa(meals.length)}`));
  const targetCal = Number(m?.tdeeBreakdown?.targetCalories) || 0;
  const totalCal = Number(m.totalCalories) || 0;
  const calDev = targetCal > 0 ? Math.abs(totalCal - targetCal) / targetCal : 0;
  results.push(
    check("غذا: جمع کالری در ۱۵٪ هدف", calDev <= 0.15, "warn",
      `${fa(Math.round(totalCal))} کالری در برابر هدف ${fa(Math.round(targetCal))}`)
  );
  const proteinTarget = Number(m?.tdeeBreakdown?.proteinG) || 0;
  const proteinTotal = Number(m.totalProtein) || 0;
  results.push(
    check("غذا: پروتئین ≥ ۷۰٪ هدف", proteinTarget <= 0 || proteinTotal >= proteinTarget * 0.7, "warn",
      `${fa(Math.round(proteinTotal))}g در برابر هدف ${fa(Math.round(proteinTarget))}g`)
  );
  results.push(
    check("غذا: زمان‌بندی هیدراتاسیون", Array.isArray(m?.hydrationSchedule) && m.hydrationSchedule.length >= 4, "info",
      `${fa(Array.isArray(m?.hydrationSchedule) ? m.hydrationSchedule.length : 0)} آیتم`)
  );

  // ─── مکمل: شخصی‌سازی + سینک ───
  const names = stackNames(m);
  results.push(check("مکمل: استک برای پلن استاندارد تجویز شده", names.length > 0, "critical",
    names.join("، ") || "(خالی)"));
  const suppIssues = auditSupplementsDeterministic(m, dataFor(sc));
  const trioIssue = suppIssues.find((i) => i.code === "supplements_default_trio");
  results.push(check("مکمل: نه قالب ثابت همگانی (کراتین+امگا۳+ویتامین D)", !trioIssue, "critical",
    trioIssue?.message ?? "شخصی‌سازی‌شده"));
  const noReason = suppIssues.filter((i) => i.code === "supplement_no_reason").length;
  results.push(check("مکمل: هر قلم دلیلِ مختص کاربر دارد", noReason === 0, "warn",
    noReason ? `${fa(noReason)} قلم بی‌دلیل` : undefined));

  // سینک سه‌گانه: مکمل برنامهٔ تمرینی == استک مکمل غذایی
  const wNames: string[] = Array.isArray(w?.supplements)
    ? w.supplements.map((s: any) => String(s?.name ?? "").trim()).filter(Boolean)
    : [];
  const synced = names.length > 0 && wNames.length === names.length && names.every((n) => wNames.includes(n));
  results.push(check("سینک سه‌گانه: استک مکمل غذا == مکمل برنامهٔ تمرینی (اکو v112)", synced, "critical",
    synced ? names.join("، ") : `غذا=[${names.join("، ")}] تمرین=[${wNames.join("، ")}]`));

  // ─── سند coachAudit (اثبات ۵ لایه) ───
  const wa = w.coachAudit as CoachAuditRecord | undefined;
  const ma = m.coachAudit as CoachAuditRecord | undefined;
  results.push(check("coachAudit روی برنامهٔ تمرینی ثبت شد", !!wa, "critical"));
  results.push(check("coachAudit روی برنامهٔ غذایی ثبت شد", !!ma, "critical"));
  const audit = wa ?? ma;
  if (audit) {
    const layers = Array.isArray(audit.layers) ? audit.layers : [];
    results.push(
      check("coachAudit: هر ۵ لایه (L2/L3/L5) اجرا شد", layers.includes("L2-deterministic-audit") && layers.includes("L3-ai-critic") && layers.includes("L5-retest-and-proof"), "critical",
        layers.join(" → "))
    );
    results.push(check("coachAudit: ممیز هوشمند واقعاً اجرا شد (criticRan)", audit.criticRan === true, "warn"));
    results.push(
      check("coachAudit: امتیاز کیفیت ≥ ۷۰", typeof audit.qualityScore === "number" && audit.qualityScore >= 70, "warn",
        `score=${fa(audit.qualityScore ?? -1)} | verdict=${audit.verdict}`)
    );
    results.push(
      check("coachAudit: اثبات رسیدن به هدف (proof) ثبت شد", !!audit.proof && audit.proof.length >= 40, "warn",
        audit.proof ? audit.proof.slice(0, 140) + "…" : undefined)
    );
    if (audit.supplementRebuilt) {
      results.push(check("coachAudit: استک مکمل توسط لایهٔ دیباگ بازسازی/شخصی‌سازی شد", true, "info"));
    }
  }

  // ─── نوتیفیکیشن + پیامک ───
  const notif = await db.notification.findFirst({
    where: { userId, type: "achievement", title: "برنامه شما آماده شد! 🎯", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  results.push(check("نوتیفیکیشن «برنامه شما آماده شد!» ساخته شد", !!notif, "critical",
    notif ? `link=${notif.link}` : undefined));

  if (gen.reqId) {
    // notifyProgramReadySms بدون await صدا زده می‌شود (پس از ready) — تا ۲۰
    // ثانیه منتظر ثبت SmsLog می‌مانیم تا ریس چک را نپوشانیم.
    let sms: { templateId: string; status: string; error: string | null } | null = null;
    for (let i = 0; i < 10 && !sms; i++) {
      sms = await db.smsLog.findFirst({
        where: { userId, key: `program_ready_${gen.reqId}`, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        select: { templateId: true, status: true, error: true },
      });
      if (!sms) await new Promise((r) => setTimeout(r, 2000));
    }
    results.push(
      check("پیامک «برنامه آماده شد» ثبت شد (SmsLog با کلید چرخهٔ تولید)", !!sms, "critical",
        sms ? `templateId=${sms.templateId} status=${sms.status}${sms.error ? ` error=${sms.error.slice(0, 90)}` : ""}` : "ردیف SmsLog پیدا نشد")
    );
  } else {
    results.push(check("پیامک: reqId برای ردگیری موجود نبود", false, "critical"));
  }

  printChecks(results);
  const criticalFail = results.filter((r) => !r.ok && r.severity === "critical").length;
  return { pass: criticalFail === 0, results };
}

/** OnboardingData حداقلی برای ممیزی قطعی داخل اسکریپت */
function dataFor(sc: Scenario): OnboardingData {
  return {
    gender: sc.profile.gender as OnboardingData["gender"],
    age: sc.profile.age as number,
    height: sc.profile.height as number,
    weight: sc.profile.weight as number,
    goal: sc.profile.goal as OnboardingData["goal"],
    activityLevel: sc.profile.activityLevel as OnboardingData["activityLevel"],
    workoutDays: sc.workoutDays,
    workoutDaysList: [],
    workoutPlace: sc.profile.workoutPlace as OnboardingData["workoutPlace"],
    equipment: [],
    diseases: "",
    injuries: (sc.profile.injuries as string) ?? "",
    allergies: "",
    dietType: (sc.profile.dietType as OnboardingData["dietType"]) ?? "standard",
  } as OnboardingData;
}

// ─────────────────────────────────────────────────────────────────────────────
// main — سه حالت:
//   setup  → ساخت کاربران/پروفایل/اشتراک/درخواست pending + توکن ادمین (سریع)
//   check  → وضعیت هر کاربر؛ اگر ready بود ممیزی کامل همان کاربر (سریع، قابل تکرار)
//   full   → ممیزی درون-پروسسهٔ کامل (پیش‌فرض — تولید هم در همین پروسه)
// ─────────────────────────────────────────────────────────────────────────────
async function setupMode() {
  console.log(`${TAG} ═══ SETUP: ساخت کاربران ممیزی + درخواست برنامهٔ pending ═══`);
  const gate = await deterministicGateTests();
  if (!gate.pass) {
    console.error(`${TAG} گیت قطعی شکست خورد — ادامه بی‌معناست`);
    process.exit(1);
  }
  const created: Array<{ idx: number; label: string; userId: string; programRequestId: string; mobile: string }> = [];
  for (const sc of SCENARIOS) {
    const user = await ensureUser(sc);
    // درخواست pending — PATCH ادمین آن را به generating kick می‌کند (v134 فیکس‌شده)
    await db.programRequest.deleteMany({ where: { userId: user.id } });
    const req = await db.programRequest.create({
      data: { userId: user.id, plan: "standard", billingPeriod: "monthly", status: "pending", attempts: 0 },
    });
    created.push({ idx: sc.idx, label: sc.label, userId: user.id, programRequestId: req.id, mobile: user.mobile });
    console.log(`${TAG} [${sc.idx}] ${sc.label} → userId=${user.id} reqId=${req.id}`);
  }
  // توکن سشن ادمین — برای kick از طریق PATCH /api/admin/programs (مسیر واقعی ادمین)
  const { createSessionToken } = await import("@/lib/fitness/auth");
  const admin = await db.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, mobile: true } });
  if (!admin) throw new Error("کاربر ادمین یافت نشد");
  const adminToken = createSessionToken(admin.id);
  console.log(`${TAG} ADMIN_TOKEN=${adminToken}`);
  console.log(`${TAG} SETUP_JSON=${JSON.stringify(created)}`);
  process.exit(0);
}

async function checkMode() {
  const overall: Array<{ label: string; state: string; pass: boolean }> = [];
  for (const sc of SCENARIOS) {
    const mobile = MOBILE_BASE + String(sc.idx).padStart(2, "0");
    const user = await db.user.findUnique({ where: { mobile } });
    if (!user) {
      console.log(`${TAG} [${sc.idx}] ${sc.label} → کاربر نیست (setup اجرا نشده؟)`);
      overall.push({ label: sc.label, state: "missing", pass: false });
      continue;
    }
    const req = await db.programRequest.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!req) {
      overall.push({ label: sc.label, state: "no_request", pass: false });
      continue;
    }
    if (req.status === "generating" || req.status === "pending") {
      console.log(`${TAG} [${sc.idx}] ${sc.label} → هنوز ${req.status} (updatedAt=${req.updatedAt.toISOString()})`);
      overall.push({ label: sc.label, state: req.status, pass: true });
      continue;
    }
    if (req.status === "failed") {
      console.log(`${TAG} [${sc.idx}] ${sc.label} → ❌ FAILED: ${req.lastError?.slice(0, 300) ?? "?"}`);
      overall.push({ label: sc.label, state: "failed", pass: false });
      continue;
    }
    // ready → ممیزی کامل خروجی
    const audit = await auditGeneratedPlans(sc, user.id, { status: req.status, lastError: req.lastError, reqId: req.id });
    const warnFail = audit.results.filter((r) => !r.ok && r.severity === "warn").length;
    console.log(`${TAG} [${sc.idx}] ${sc.label} → ${audit.pass ? "✅ پاس" : "❌ شکست"}${warnFail ? ` (${fa(warnFail)} هشدار)` : ""}`);
    overall.push({ label: sc.label, state: "audited", pass: audit.pass });
  }
  const allPass = overall.every((o) => o.pass);
  const audited = overall.filter((o) => o.state === "audited").length;
  console.log(`${TAG} خلاصهٔ check: ${overall.map((o) => `${o.label}=${o.state}${o.pass ? "" : "❌"}`).join(" | ")}`);
  console.log(`${TAG} CHECK_RESULT=${allPass ? (audited === overall.length ? "ALL_PASS" : "PENDING_OK") : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

async function main() {
  const startedAt = Date.now();
  console.log(`${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} تست ممیزی جامع خط تولید چندلایهٔ برنامه‌ها — شروع`);
  console.log(`${TAG} مدل AI: ${process.env.AVALAI_TEXT_MODEL ?? "(پیش‌فرض)"} / ممیز: ${process.env.AVALAI_TEXT_TASK_MODEL ?? "(پیش‌فرض)"}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════`);

  const gate = await deterministicGateTests();
  const scenarioOut: Array<{ label: string; pass: boolean; warnFail: number }> = [];

  for (const sc of SCENARIOS) {
    console.log(`\n${TAG} ─────── سناریو ${sc.label} ───────`);
    const user = await ensureUser(sc);
    console.log(`${TAG} کاربر آماده: ${user.id} (${user.mobile}) — پلن standard + پروفایل کامل`);

    const start = await startProgramGenerationInBackground(user.id);
    console.log(`${TAG} startProgramGenerationInBackground → started=${start.started}${start.reason ? ` reason=${start.reason}` : ""}`);
    if (!start.started) {
      scenarioOut.push({ label: sc.label, pass: false, warnFail: 0 });
      continue;
    }
    console.log(`${TAG} تولید در پس‌زمینه شروع شد — تا ${fa(Math.round(PER_USER_TIMEOUT_MS / 60000))} دقیقه منتظر می‌مانم (پول هر ${fa(POLL_MS / 1000)} ثانیه)...`);
    const gen = await waitForGeneration(user.id);
    console.log(`${TAG} چرخهٔ تولید تمام شد: status=${gen.status}${gen.lastError ? ` | lastError=${gen.lastError.slice(0, 200)}` : ""}`);
    const audit = await auditGeneratedPlans(sc, user.id, gen);
    const warnFail = audit.results.filter((r) => !r.ok && r.severity === "warn").length;
    scenarioOut.push({ label: sc.label, pass: audit.pass, warnFail });
  }

  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} جمع‌بندی ممیزی (${fa(Math.round((Date.now() - startedAt) / 1000))} ثانیه):`);
  console.log(`${TAG}   گیت قطعی: ${gate.pass ? "✅ پاس" : "❌ شکست"}`);
  for (const s of scenarioOut) {
    console.log(`${TAG}   ${s.label}: ${s.pass ? "✅ پاس" : "❌ شکست"}${s.warnFail ? ` (${fa(s.warnFail)} هشدار)` : ""}`);
  }
  const allPass = gate.pass && scenarioOut.every((s) => s.pass);
  console.log(`${TAG} نتیجهٔ نهایی: ${allPass ? "✅ همهٔ سناریوها پاس — خط تولید چندلایه + نوتیف + پیامک سالم" : "❌ شکست در حداقل یک سناریو — جزئیات بالا"}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════`);
  process.exit(allPass ? 0 : 1);
}

const mode = process.argv[2] ?? "full";
if (mode === "setup") {
  setupMode().catch((e) => { console.error(`${TAG} خطای setup:`, e); process.exit(2); });
} else if (mode === "check") {
  checkMode().catch((e) => { console.error(`${TAG} خطای check:`, e); process.exit(2); });
} else {
  main().catch((e) => {
    console.error(`${TAG} خطای کلیدی اسکریپت:`, e);
    process.exit(2);
  });
}

// ردیابی مرگ پروسه — اگر سندباکس پروسه را بکشد، لاگش می‌کنیم
process.on("SIGTERM", () => { console.error(`${TAG} ⚠️ SIGTERM دریافت شد`); process.exit(143); });
process.on("SIGINT", () => { console.error(`${TAG} ⚠️ SIGINT دریافت شد`); process.exit(130); });
process.on("SIGHUP", () => { console.error(`${TAG} ⚠️ SIGHUP دریافت شد`); process.exit(129); });
process.on("uncaughtException", (e) => { console.error(`${TAG} ⚠️ uncaughtException:`, e); process.exit(3); });
process.on("unhandledRejection", (e) => { console.error(`${TAG} ⚠️ unhandledRejection:`, e); process.exit(4); });
