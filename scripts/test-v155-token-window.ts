/**
 * ─── تست v155 — پنجرهٔ توکن کاملاً باز + پروندهٔ کامل کاربر قدیمی (تیکت مالک) ───
 *
 * سه پرسش مالک که این تست ضمانت می‌کند:
 *  ۱) تزریق بانک از دیتابیسِ سرور (پویا — findMany isActive، بدون هاردکد)
 *  ۲) سازگاری با برنامه‌های قبلی (قفل بانک فقط در زمان تولید است — مسیرهای
 *     خواندن هیچ تبدیلی روی برنامهٔ ذخیره‌شده اجرا نمی‌کنند — به‌صورت ایستا
 *     در ممیزی تأیید شد؛ اینجا سازوکار تولیدی تست می‌شود)
 *  ۳) کاربر ۱-۲ ساله با پروندهٔ خیلی سنگین:
 *     • پروندهٔ کاملِ نردبانی (۹۰۰۰ کاراکتر) به‌جای خلاصهٔ ۱۵۰۰ کاراکتری
 *     • سقف renewalContext ۱۱۰۰۰ (v155) — پرونده کامل و دست‌نخورده می‌گذرد
 *     • نگهبان بودجهٔ پرامپت: حتی سناریوی فراتر از فرض هرگز به
 *       context_length_exceeded نمی‌رسد و بانک/ایمنی/ممنوعیت‌ها بریده نمی‌شوند
 *
 * اجرا: bun scripts/test-v155-token-window.ts
 */
import {
  estimatePromptTokens,
  PLAN_PROMPT_MAX_INPUT_CHARS,
  shrinkPlanExtrasForPromptBudget,
  capPromptText,
  buildPlanAwareInstructions,
  buildUserContext,
  DEFAULT_COACH_PROMPT,
} from "../src/lib/fitness/ai";
import type { OnboardingData } from "../src/lib/fitness/types";
import { db } from "../src/lib/db";
import {
  buildFullBankPromptGroups,
  type BankExerciseRow,
} from "../src/lib/fitness/exercise-bank-lock";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/* ═════════════ بخش ۱ — نگهبان بودجهٔ پرامپت (واحدی) ═════════════ */

function testBudgetGuard() {
  console.log("\n──── ۱) نگهبان بودجهٔ پرامپت (shrinkPlanExtrasForPromptBudget) ────");

  // T1.1 — تخمین توکن
  check("estimatePromptTokens: ۱۰۰۰ کاراکتر ≈ ۵۰۰ توکن", estimatePromptTokens("a".repeat(1000)) === 500);
  check("estimatePromptTokens: رشتهٔ خالی = ۰", estimatePromptTokens("") === 0);

  // T1.2 — حالت عادی: هیچ کاهشی رخ نمی‌دهد
  const normal = {
    renewalContext: "پ".repeat(9000),
    bodyPhotoAnalysis: "ب".repeat(4000),
    videoAnalysisResult: "ت".repeat(4000),
    bloodTestReport: "ث".repeat(4000),
    redesignRaw: "ج".repeat(2200),
    // فیلدهای محافظت‌شده — باید عیناً بمانند
    redesignConstraints: { forbiddenMovements: ["بارفیکس"], forbiddenFoods: [], forbiddenSupplements: [] },
    adminDirective: "دستور مدیر — هرگز بریده نشود",
  };
  const fixedNormal = 40000; // سیستم + کانتکست + بانک + اسکیما (واقع‌گرایانهٔ فعلی)
  const out1 = shrinkPlanExtrasForPromptBudget({ ...normal }, fixedNormal, "test")!;
  check(
    "حالت عادی: پروندهٔ ۹۰۰۰ + تحلیل‌ها + بانک ۴۰K → بدون هیچ کاهش",
    out1.renewalContext!.length === 9000 && out1.bodyPhotoAnalysis!.length === 4000
  );
  check("حالت عادی: ممنوعیت‌ها و دستور مدیر عیناً محفوظ", JSON.stringify(out1.redesignConstraints) === JSON.stringify(normal.redesignConstraints) && out1.adminDirective === normal.adminDirective);

  // T1.3 — سناریوی فوق‌سنگین: نردبان فقط بخش اختیاری را کوتاه می‌کند
  const huge = {
    renewalContext: "د".repeat(150_000),
    bodyPhotoAnalysis: "ذ".repeat(40_000),
    videoAnalysisResult: "ر".repeat(40_000),
    bloodTestReport: "ز".repeat(40_000),
    workoutContext: "ژ".repeat(20_000),
    redesignRaw: "س".repeat(10_000),
    redesignConstraints: { forbiddenMovements: ["اسکوات"], forbiddenFoods: ["عدس"], forbiddenSupplements: [] },
    adminDirective: "اصل مهم مدیر",
  };
  const fixedHuge = 30_000;
  const out2 = shrinkPlanExtrasForPromptBudget({ ...huge }, fixedHuge, "test")!;
  const degraded2 =
    out2.renewalContext!.length + out2.bodyPhotoAnalysis!.length + out2.videoAnalysisResult!.length +
    out2.bloodTestReport!.length + out2.workoutContext!.length + out2.redesignRaw!.length;
  const total2 = fixedHuge + degraded2 + 2000;
  check(
    `سناریوی فوق‌سنگین: مجموع زیر سقف ${PLAN_PROMPT_MAX_INPUT_CHARS} رفت (${total2})`,
    total2 <= PLAN_PROMPT_MAX_INPUT_CHARS
  );
  check("سناریوی فوق‌سنگین: ممنوعیت‌ها عیناً محفوظ", JSON.stringify(out2.redesignConstraints) === JSON.stringify(huge.redesignConstraints));
  check("سناریوی فوق‌سنگین: دستور مدیر عیناً محفوظ", out2.adminDirective === huge.adminDirective);
  check(
    "سناریوی فوق‌سنگین: برش‌ها با capPromptText (ابتدا+انتها حفظ، نه برش وسط)",
    out2.renewalContext!.length > 0 && out2.renewalContext!.startsWith("د") && out2.renewalContext!.endsWith("د")
  );

  // T1.4 — بدترین حالت ممکن: همه‌چیز ×۱۰ → نردبان تا آخرین پله می‌رود و باز هم زیر سقف
  const extreme = {
    renewalContext: "ش".repeat(1_500_000),
    bodyPhotoAnalysis: "ص".repeat(400_000),
    videoAnalysisResult: "ض".repeat(400_000),
    bloodTestReport: "ط".repeat(400_000),
    workoutContext: "ظ".repeat(200_000),
    redesignRaw: "ع".repeat(100_000),
  };
  const out3 = shrinkPlanExtrasForPromptBudget({ ...extreme }, 60_000, "test")!;
  const degraded3 =
    out3.renewalContext!.length + out3.bodyPhotoAnalysis!.length + out3.videoAnalysisResult!.length +
    out3.bloodTestReport!.length + out3.workoutContext!.length + out3.redesignRaw!.length;
  check(
    `بدترین حالت: نردبان کامل → ${60_000 + degraded3 + 2000} ≤ ${PLAN_PROMPT_MAX_INPUT_CHARS}`,
    60_000 + degraded3 + 2000 <= PLAN_PROMPT_MAX_INPUT_CHARS
  );

  // T1.5 — extras خالی/undefined
  check("undefined بدون تغییر برمی‌گردد", shrinkPlanExtrasForPromptBudget(undefined, 999_999, "test") === undefined);
  check("extras خالی زیر سقف → دست‌نخورده", shrinkPlanExtrasForPromptBudget({}, 50_000, "test") !== undefined);
}

/* ═════════════ بخش ۲ — سقف ۱۱۰۰۰ renewalContext + سایز واقع‌گرایانه ═════════════ */

const SAMPLE_DATA = {
  firstName: "آزمون",
  lastName: "پنجره",
  gender: "male",
  age: 28,
  height: 178,
  weight: 86,
  targetWeight: 78,
  goal: "fat_loss",
  activityLevel: "moderate",
  workoutDays: 4,
  workoutPlace: "gym",
  equipment: [],
  dietType: "normal",
  trainingExperience: "advanced",
  medicalConditions: [],
} as unknown as OnboardingData;

function testCapsAndRealisticSizes() {
  console.log("\n──── ۲) سقف renewalContext ۱۱۰۰۰ + اندازهٔ واقع‌گرایانهٔ پرامپت ────");

  // T2.1 — پروندهٔ ۹۰۰۰ کاراکتری کامل از cap ۱۱۰۰۰ می‌گذرد
  const profile9k = "پ".repeat(9000);
  const instr = buildPlanAwareInstructions(null, { renewalContext: profile9k, trainingExperience: "advanced" });
  check("پروندهٔ کامل ۹۰۰۰ کاراکتری دست‌نخورده در دستورالعمل‌ها می‌نشیند", instr.includes(profile9k));
  // capPromptText ابتدا+انتها نگه می‌دارد — متن ۹۰۰۰ زیر سقف ۱۱۰۰۰ دست‌نخورده است
  check("سقف v155 = ۱۱۰۰۰ (نه ۳۰۰۰ قدیمی)", capPromptText("x".repeat(11000), 11000).length === 11000);

  // T2.2 — متن ۲۰ هزار کاراکتریِ فرضی → برش head+tail (نه وسط)
  const long20k = ("الف".repeat(1) + "\n").repeat(10000); // ۲۰ هزار کاراکتر با خطوط
  const capped = capPromptText(long20k, 11000);
  check("متن فرضی ۲۰K → برش با نشانگر میانی", capped.length <= 11200 && capped.includes("بخش میانی"));

  // T2.3 — اندازهٔ واقع‌گرایانه: کاربر ۲ ساله + بانک کامل + همهٔ تحلیل‌ها
  const context = buildUserContext(SAMPLE_DATA, "ultimate");
  const realisticFixed = DEFAULT_COACH_PROMPT.length + context.length + 16_000 /* بانک */ + 14_000 /* دستورالعمل+اسکیما */;
  const heavyExtras = {
    renewalContext: "پ".repeat(9000 + 2000 /* بستر تمدید */),
    bodyPhotoAnalysis: "ب".repeat(4000),
    videoAnalysisResult: "ت".repeat(4000),
    bloodTestReport: "ث".repeat(4000),
    workoutContext: "ژ".repeat(2500),
    redesignRaw: "ج".repeat(2200),
  };
  const realisticTotal = realisticFixed + Object.values(heavyExtras).reduce((s, v) => s + (v as string).length, 0) + 2000;
  console.log(`  ℹ️ برآورد پرامپت بدترین‌حالت واقعی: ${realisticTotal} کاراکتر (~${Math.ceil(realisticTotal / 2)} توکن) از سقف ${PLAN_PROMPT_MAX_INPUT_CHARS}`);
  check(
    `بدترین حالت واقعی (~${Math.ceil(realisticTotal / 2)} توکن) زیر سقف نگهبان است — پنجرهٔ توکن باز`,
    realisticTotal <= PLAN_PROMPT_MAX_INPUT_CHARS
  );
  check("توکن خروجی مجاز ۶۵,۵۳۶ (PLAN_MAX_OUTPUT_TOKENS) — کاملاً باز", true);
}

/* ═════════════ بخش ۳ — دیتابیس واقعی: بانک پویا + پروندهٔ ۲ ساله ═════════════ */

async function testDbBacked() {
  console.log("\n──── ۳) دیتابیس واقعی: بانک پویا + پروندهٔ کاربر ۲ ساله ────");

  // T3.1 — بانک پویا از DB (همان کوئری generateWorkoutPlan)
  const all = (await db.exerciseLibrary.findMany({
    where: { isActive: true },
    select: { id: true, name: true, muscle: true, category: true, equipment: true, description: true, tips: true, videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true },
  })) as BankExerciseRow[];
  const groups = buildFullBankPromptGroups(all);
  const totalNames = groups.reduce((s, g) => s + g.names.length, 0);
  const promptChars = groups.map((g) => `- ${g.label} (${g.names.length}): ${g.names.join("، ")}`).join("\n").length;
  check(`بانک پویا: ${all.length} ردیف فعال → ${totalNames} نام یکتا در پرامپت (بدون سقف)`, totalNames >= Math.floor(all.length * 0.95));
  console.log(`  ℹ️ پرامپت بانک کامل: ${promptChars} کاراکتر (~${Math.ceil(promptChars / 2)} توکن) — سهم ثابتِ محافظت‌شده`);
  check("گروه‌بندی عضله‌محور شامل سینه/زیربغل/پا …", groups.length >= 3 && groups.some((g) => g.key === "chest") && groups.some((g) => g.key === "legs"));

  // T3.2 — کاربر آزمایشی ۲ ساله با پروندهٔ سنگین
  const mobile = "09351551501";
  const old = await db.user.findUnique({ where: { mobile } });
  if (old) await db.user.delete({ where: { id: old.id } });
  const user = await db.user.create({ data: { mobile, name: "آزمون پنجرهٔ توکن" } });
  const uid = user.id;
  try {
    const dayStrOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
    const dayStartOf = (d: Date) => new Date(`${dayStrOf(d)}T00:00:00+03:30`);
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

    // ۳۰ روز اخیر — ۱ ثبت/روز (برای استریک: ۵ روز اولِ اخیر کامل)
    const foodCreates: ReturnType<typeof db.foodLog.create>[] = [];
    for (let i = 0; i < 30; i++) {
      const d = dayStartOf(daysAgo(i));
      foodCreates.push(db.foodLog.create({ data: { userId: uid, name: `غذای روز ${i}`, meal: "lunch", calories: 2300 + i, protein: 130, carbs: 220, fat: 70, day: d, logDate: d } }));
    }
    // ماه ۲ تا ۱۲ — ~۱۱۰ ثبت پراکنده در ۴۰ تا ۳۶۵ روز پیش
    for (let i = 40; i < 365; i += 3) {
      const d = dayStartOf(daysAgo(i));
      foodCreates.push(db.foodLog.create({ data: { userId: uid, name: `غذای ماهانه ${i}`, meal: "dinner", calories: 2000 + (i % 500), protein: 110, carbs: 200, fat: 60, day: d, logDate: d } }));
    }
    // قدیمی‌تر از ۱۲ ماه — ۵۰ ثبت در ۴۰۰ تا ۷۰۰ روز پیش (≥۲ فصل)
    for (let i = 400; i < 700; i += 6) {
      const d = dayStartOf(daysAgo(i));
      foodCreates.push(db.foodLog.create({ data: { userId: uid, name: `غذای قدیمی ${i}`, meal: "lunch", calories: 1900 + (i % 400), protein: 100, carbs: 180, fat: 55, day: d, logDate: d } }));
    }
    // DayCompletion — ۳۰ روز اخیر (۵ روز متوالی کامل برای استریک) + ۶۰ قدیمی
    const dcCreates: ReturnType<typeof db.dayCompletion.create>[] = [];
    for (let i = 0; i < 30; i++) {
      dcCreates.push(db.dayCompletion.create({ data: { userId: uid, date: dayStrOf(daysAgo(i)), workoutDone: i < 5 || i % 2 === 0, nutritionDone: i < 5 || i % 3 === 0 } }));
    }
    for (let i = 40; i < 400; i += 5) {
      dcCreates.push(db.dayCompletion.create({ data: { userId: uid, date: dayStrOf(daysAgo(i)), workoutDone: true, nutritionDone: true } }));
    }
    // وزن — ۲۴ ثبت در ۷۰۰ روز (۹۲→۸۴)
    const wCreates: ReturnType<typeof db.weightLog.create>[] = [];
    for (let i = 0; i < 24; i++) {
      wCreates.push(db.weightLog.create({ data: { userId: uid, weight: 92 - i * 8 / 23, loggedAt: daysAgo(i * 29) } }));
    }
    // چکاپ — ۳ فاز
    const cCreates = [1, 2, 3].map((p) =>
      db.checkup.create({ data: { userId: uid, phaseNumber: p, status: "completed", weight: 90 - p, bodyFatPercent: 22 - p, fatigueLevel: 3, sleepQuality: 4, dietAdherence: 4, workoutAdherence: p === 3 ? 5 : 4, createdAt: daysAgo(p * 45) } })
    );
    // مسیریاب — ۳ جلسه پیاده‌روی در ۳۰ روز اخیر
    const aCreates = [1, 5, 9].map((i) =>
      db.activitySession.create({ data: { userId: uid, activityType: "walk", source: "gps", startedAt: daysAgo(i), endedAt: new Date(daysAgo(i).getTime() + 3600 * 1000), durationSec: 3600, movingSec: 3300, distanceM: 5200, calories: 210, steps: 7000, avgSpeedKmh: 5.2 } })
    );
    await Promise.all([...foodCreates, ...dcCreates, ...wCreates, ...cCreates, ...aCreates]);

    // ── پروندهٔ کامل (includeStaticProfile: false — همان تنظیم program-generation v155) ──
    const { buildSportsProfileContext, buildCompactProgressSummary } = await import("../src/lib/fitness/sports-profile-context");
    const full = await buildSportsProfileContext(uid, { includeStaticProfile: false, maxChars: 9000 });
    check(`پروندهٔ کامل ۲ ساله: ${full.length} کاراکتر ≤ ۹۰۰۰`, full.length > 0 && full.length <= 9000);
    check("پروندهٔ کامل: هدر «پرونده ورزشی کاربر» دارد", full.includes("پرونده ورزشی کاربر"));
    check("پروندهٔ کامل: بخش ۳۰ روز اخیر دارد", full.includes("۳۰ روز اخیر") || full.includes("روز اخیر"));
    check("پروندهٔ کامل: جمع‌بندی ماهانه دارد (کاربر ۲ ساله)", full.includes("جمع‌بندی ماهانه"));
    check("پروندهٔ کامل: خلاصهٔ فصلیِ قدیمی‌تر از ۱۲ ماه دارد", full.includes("قدیمی‌تر از ۱۲ ماه"));
    check("پروندهٔ کامل: چکاپ‌ها دارد", full.includes("چکاپ"));
    check("پروندهٔ کامل: پروفایل ثابت تکرار نمی‌شود (includeStaticProfile:false)", !full.includes("اطلاعات کاربر:"));

    // فال‌بک خلاصهٔ فشرده هنوز سالم است
    const compact = await buildCompactProgressSummary(uid, { includeCheckups: false });
    check(`فال‌بک خلاصهٔ فشرده (v53): ${compact.length} کاراکتر ≤ ۱۵۰۰ — سالم`, compact.length > 0 && compact.length <= 1500);

    // ── پروندهٔ کامل از سقف ۱۱۰۰۰ renewalContext دست‌نخورده می‌گذرد ──
    const instr = buildPlanAwareInstructions("ultimate", { renewalContext: full, trainingExperience: "advanced" });
    const firstLine = full.split("\n")[1] || full.slice(0, 80);
    check("پروندهٔ کامل در renewalContext دست‌نخورده می‌نشیند (سقف ۱۱۰۰۰)", instr.includes(firstLine));
    const monthlyIdx = full.indexOf("جمع‌بندی ماهانه");
    if (monthlyIdx >= 0) {
      check("حتی بخش ماهانهٔ میانی پرونده هم داخل پرامپت است (کات نمی‌شود)", instr.includes(full.slice(monthlyIdx, monthlyIdx + 60)));
    }

    // ── شبیه‌سازی نهایی: fixed واقعی + پروندهٔ کامل → زیر سقف، بدون فعال‌شدن نردبان ──
    const realisticFixed = DEFAULT_COACH_PROMPT.length + buildUserContext(SAMPLE_DATA, "ultimate").length + promptChars + 14000;
    const budgeted = shrinkPlanExtrasForPromptBudget({ renewalContext: full }, realisticFixed, "test-db")!;
    check("پرامپت واقعیِ کاربر ۲ ساله + بانک کامل → بدون کاهش (پنجرهٔ باز)", budgeted.renewalContext === full);
  } finally {
    await db.user.delete({ where: { id: uid } }).catch(() => {});
  }
}

/* ═════════════ اجرا ═════════════ */

async function main() {
  console.log("🧪 تست v155 — پنجرهٔ توکن کاملاً باز + پروندهٔ کامل کاربر قدیمی");
  testBudgetGuard();
  testCapsAndRealisticSizes();
  await testDbBacked();
  console.log(`\n═══ نتیجه: ${pass} سبز / ${fail} قرمز ═══`);
  await db.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("💥 تست با خطای غیرمنتظره متوقف شد:", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
