/**
 * تست واحد v148 — موفقیت در یک تلاش + ترمیم خودکار پوشش + توضیح چیدمان
 * سناریوهای مالک:
 *   ① برنامه با «یک تلاش» ساخته شود (اعتبارسنج فقط غیرقابل‌ترمیم‌ها را رد کند)
 *   ② برنامهٔ بی‌سرشانه → حرکت سرشانه ترمیم شود (نه رد)
 *   ③ عضلهٔ جاافتاده/غیرمعمول → توضیح علمی در نکات مربی
 *   ④ مقدمهٔ «این ویدیو...» از تحلیل ویدیو حذف شود
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v148-one-shot-engine.test.ts
 */
import {
  validatePlanTextParseable,
  repairWorkoutPlanCoverage,
  appendMuscleCoverageExplanationNotes,
  stripVideoAnalysisPreamble,
} from "../../src/lib/fitness/ai";
import {
  buildLockedBank,
  coveredMajorGroups,
  type BankExerciseRow,
} from "../../src/lib/fitness/exercise-bank-lock";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ─────────────── بانک ساختگی واقع‌گرا (فقط ویدیودار) ─────────────── */
function row(id: string, name: string, muscle: string, category: string): BankExerciseRow {
  return {
    id, name, muscle, category,
    equipment: "dumbbell",
    description: "توضیح تست",
    tips: "نکتهٔ تست",
    videoUrl: `https://youtube.com/watch?v=${id}`,
    youtubeEnabled: true,
  };
}

const bankRows: BankExerciseRow[] = [
  // سرشانه (برای ترمیم «سرشانهٔ صفر»)
  row("sh1", "پرس سرشانه دمبل", "سرشانه", "push"),
  row("sh2", "نشر جانب دمبل", "سرشانه", "push"),
  row("sh3", "نشر خم دمبل", "سرشانه خم", "push"),
  // سینه
  row("ch1", "پرس سینه هالتر", "سینه", "push"),
  row("ch2", "پرس سینه دمبل", "سینه", "push"),
  row("ch3", "قفسه سینه دمبل", "سینه", "push"),
  // زیربغل
  row("bk1", "بارفیکس دست‌باز", "زیربغل", "pull"),
  row("bk2", "لت دست‌باز", "زیربغل", "pull"),
  row("bk3", "روئینگ هالتر", "زیربغل", "pull"),
  // پا
  row("lg1", "اسکوات هالتر", "پا", "legs"),
  row("lg2", "ددلیفت رومانیایی", "پشت پا", "legs"),
  row("lg3", "لانژ دمبل", "پا", "legs"),
  // بازو
  row("ar1", "جلو بازو هالتر", "جلوبازو", "pull"),
  row("ar2", "جلو بازو چکشی دمبل", "جلوبازو", "pull"),
  row("ar3", "پشت بازو سیم‌کش", "پشت‌بازو", "push"),
  // شکم
  row("co1", "کرانچ شکم", "شکم", "core"),
  row("co2", "پلانک", "شکم", "core"),
  row("co3", "لگ ریس", "شکم", "core"),
];

const bank = buildLockedBank(bankRows, true);

/* ─────────────── ۱) اعتبارسنج ملایم ─────────────── */
console.log("\n[۱] validatePlanTextParseable — یک تلاش، بدون ردِ ساختاری");

const goodPlanText = JSON.stringify({
  days: [
    { day: "شنبه", title: "پرس", exercises: [{ name: "پرس سینه هالتر", muscle: "سینه", sets: [] }] },
    { day: "یکشنبه", title: "پول", exercises: [{ name: "بارفیکس دست‌باز", muscle: "زیربغل", sets: [] }] },
    { day: "دوشنبه", title: "پا", exercises: [{ name: "اسکوات هالتر", muscle: "پا", sets: [] }] },
  ],
});
check("برنامهٔ ۳ روزهٔ سالم → null (پذیرش اولین تلاش)", validatePlanTextParseable(goodPlanText, 3) === null);

const emptyResult = validatePlanTextParseable("خروجی غیر JSON", 3);
check("خروجی غیر JSON → رد", emptyResult !== null);

const partialText = JSON.stringify({ days: [{ day: "شنبه", exercises: [] }] });
check("۳ روز درخواستی ولی ۱ روز پاسخ → رد (ناقص فاحش)", validatePlanTextParseable(partialText, 3) !== null);

/* ─────────────── ۲) ترمیم پوشش (سرشانهٔ صفر) ─────────────── */
console.log("\n[۲] repairWorkoutPlanCoverage — برنامهٔ بی‌سرشانه → ترمیم، نه رد");

// برنامهٔ ۵ روزه بدون هیچ حرکت سرشانه (سناریوی مالک: ۳ روز سینه + بی‌سرشانه)
const noShoulderPlan: any = {
  notes: "- نکتهٔ مربی: روی فرم تمرکز کن.",
  days: [
    { day: "شنبه", title: "سینه", focus: "سینه", exercises: [
      { name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "10", restSec: 90 }] },
      { name: "پرس سینه دمبل", muscle: "سینه", category: "push", sets: [] },
      { name: "قفسه سینه دمبل", muscle: "سینه", category: "push", sets: [] },
    ] },
    { day: "یکشنبه", title: "زیربغل", focus: "زیربغل", exercises: [
      { name: "بارفیکس دست‌باز", muscle: "زیربغل", category: "pull", sets: [] },
      { name: "لت دست‌باز", muscle: "زیربغل", category: "pull", sets: [] },
      { name: "روئینگ هالتر", muscle: "زیربغل", category: "pull", sets: [] },
    ] },
    { day: "دوشنبه", title: "سینه ۲", focus: "سینه", exercises: [
      { name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] },
      { name: "قفسه سینه دمبل", muscle: "سینه", category: "push", sets: [] },
    ] },
    { day: "سه‌شنبه", title: "پا", focus: "پا", exercises: [
      { name: "اسکوات هالتر", muscle: "پا", category: "legs", sets: [] },
      { name: "ددلیفت رومانیایی", muscle: "پشت پا", category: "legs", sets: [] },
      { name: "لانژ دمبل", muscle: "پا", category: "legs", sets: [] },
    ] },
    { day: "چهارشنبه", title: "بازو + شکم", focus: "بازو", exercises: [
      { name: "جلو بازو هالتر", muscle: "جلوبازو", category: "pull", sets: [] },
      { name: "پلانک", muscle: "شکم", category: "core", sets: [] },
      { name: "کرانچ شکم", muscle: "شکم", category: "core", sets: [] },
    ] },
  ],
};

const beforeGroups = coveredMajorGroups(noShoulderPlan.days);
check("پیش از ترمیم: سرشانه صفر است", !beforeGroups.has("shoulders"));

const repairReport = repairWorkoutPlanCoverage(noShoulderPlan, bank);
const afterGroups = coveredMajorGroups(noShoulderPlan.days);
check("بعد از ترمیم: سرشانه پوشیده شد", afterGroups.has("shoulders"), JSON.stringify(repairReport.added));
check("حرکت اضافه‌شده واقعاً از بانک است (exerciseId دارد)",
  noShoulderPlan.days.some((d: any) => d.exercises.some((e: any) => e.exerciseId === "sh1" || e.exerciseId === "sh2" || e.exerciseId === "sh3"))
);
check("توضیح تکمیل پوشش در نکات مربی ثبت شد", (noShoulderPlan.notes ?? "").includes("تکمیل پوشش عضلانی"));

// شکم: برنامه‌ای بدون شکم → ۲ حرکت شکم در ۲ روز
const noCorePlan: any = {
  days: [
    { day: "شنبه", exercises: [{ name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] }, { name: "بارفیکس دست‌باز", muscle: "زیربغل", category: "pull", sets: [] }, { name: "اسکوات هالتر", muscle: "پا", category: "legs", sets: [] }, { name: "پرس سرشانه دمبل", muscle: "سرشانه", category: "push", sets: [] }, { name: "جلو بازو هالتر", muscle: "جلوبازو", category: "pull", sets: [] }] },
    { day: "یکشنبه", exercises: [{ name: "پرس سینه دمبل", muscle: "سینه", category: "push", sets: [] }, { name: "لت دست‌باز", muscle: "زیربغل", category: "pull", sets: [] }, { name: "ددلیفت رومانیایی", muscle: "پشت پا", category: "legs", sets: [] }, { name: "نشر جانب دمبل", muscle: "سرشانه", category: "push", sets: [] }, { name: "پشت بازو سیم‌کش", muscle: "پشت‌بازو", category: "push", sets: [] }] },
    { day: "دوشنبه", exercises: [{ name: "قفسه سینه دمبل", muscle: "سینه", category: "push", sets: [] }, { name: "روئینگ هالتر", muscle: "زیربغل", category: "pull", sets: [] }, { name: "لانژ دمبل", muscle: "پا", category: "legs", sets: [] }, { name: "نشر خم دمبل", muscle: "سرشانه خم", category: "push", sets: [] }, { name: "جلو بازو چکشی دمبل", muscle: "جلوبازو", category: "pull", sets: [] }] },
  ],
};
const coreRepair = repairWorkoutPlanCoverage(noCorePlan, bank);
const coreDaysWithCore = noCorePlan.days.filter((d: any) =>
  d.exercises.some((e: any) => { const g = coveredMajorGroups([{ exercises: [e] }]); return g.has("core"); })
).length;
check("شکم صفر → ترمیم با ۲ حرکت در ۲ روز", coreDaysWithCore >= 2, `coreAdded=${coreRepair.added.filter(a => a.group === "core").length}, daysWithCore=${coreDaysWithCore}`);

/* ─────────────── ۳) توضیح چیدمان در نکات ─────────────── */
console.log("\n[۳] appendMuscleCoverageExplanationNotes — «چرا این عضله نیست/چرا این‌قدر سینه؟»");

// برنامهٔ سینه‌محور (۳ روز سینه) — باید توضیح تأکید غیرمعمول بدهد
const chestHeavyPlan: any = {
  notes: "- نکتهٔ مربی: روی فرم تمرکز کن.",
  days: [
    { day: "شنبه", title: "سینه", focus: "سینه", exercises: [
      { name: "پرس سینه هالتر", muscle: "سینه", category: "push", exerciseId: "ch1", sets: [] },
      { name: "پرس سینه دمبل", muscle: "سینه", category: "push", exerciseId: "ch2", sets: [] },
      { name: "قفسه سینه دمبل", muscle: "سینه", category: "push", exerciseId: "ch3", sets: [] },
    ] },
    { day: "یکشنبه", title: "زیربغل", focus: "زیربغل", exercises: [
      { name: "بارفیکس دست‌باز", muscle: "زیربغل", category: "pull", exerciseId: "bk1", sets: [] },
      { name: "لت دست‌باز", muscle: "زیربغل", category: "pull", exerciseId: "bk2", sets: [] },
      { name: "روئینگ هالتر", muscle: "زیربغل", category: "pull", exerciseId: "bk3", sets: [] },
    ] },
    { day: "دوشنبه", title: "سینه ۲", focus: "سینه", exercises: [
      { name: "پرس سینه هالتر", muscle: "سینه", category: "push", exerciseId: "ch1", sets: [] },
      { name: "قفسه سینه دمبل", muscle: "سینه", category: "push", exerciseId: "ch3", sets: [] },
      { name: "پرس سرشانه دمبل", muscle: "سرشانه", category: "push", exerciseId: "sh1", sets: [] },
    ] },
    { day: "سه‌شنبه", title: "سینه ۳ + سرشانه", focus: "سینه", exercises: [
      { name: "پرس سینه دمبل", muscle: "سینه", category: "push", exerciseId: "ch2", sets: [] },
      { name: "نشر جانب دمبل", muscle: "سرشانه", category: "push", exerciseId: "sh2", sets: [] },
      { name: "اسکوات هالتر", muscle: "پا", category: "legs", exerciseId: "lg1", sets: [] },
    ] },
    { day: "چهارشنبه", title: "بازو + شکم", focus: "بازو", exercises: [
      { name: "جلو بازو هالتر", muscle: "جلوبازو", category: "pull", exerciseId: "ar1", sets: [] },
      { name: "پلانک", muscle: "شکم", category: "core", exerciseId: "co2", sets: [] },
      { name: "کرانچ شکم", muscle: "شکم", category: "core", exerciseId: "co1", sets: [] },
    ] },
  ],
};

const enforceable = new Set(["chest", "back", "shoulders", "legs", "arms", "core"]);
const notesBefore = chestHeavyPlan.notes ?? "";
appendMuscleCoverageExplanationNotes(chestHeavyPlan, { goal: "muscle_gain" }, enforceable as any);
const notesAfter = chestHeavyPlan.notes ?? "";
check("تأکید غیرمعمول سینه (۳ روز) → توضیح علمی اضافه شد", notesAfter.includes("تحلیل چیدمان") && notesAfter.includes("سینه"));
check("توضیح سینه دلیل دارد (هدف/فرکانس)", notesAfter.includes("عضله‌سازی") || notesAfter.includes("فرکانس"));

// عضلهٔ جاافتادهٔ غیرالزام‌پذیر → توضیح «چرا نیست»
const missingPlan: any = JSON.parse(JSON.stringify(chestHeavyPlan));
missingPlan.days.forEach((d: any) => { d.exercises = d.exercises.filter((e: any) => !coveredMajorGroups([{ exercises: [e] }]).has("core")); });
const emptyGroups2 = new Set(); // هیچ گروهی الزام‌پذیر نیست → core ترمیم نمی‌شود → باید توضیح بیاید
appendMuscleCoverageExplanationNotes(missingPlan, { goal: "fat_loss" }, emptyGroups2 as any);
check("عضلهٔ جاافتاده → خط «تحلیل چیدمان: ... ندارد. دلیل: ...»", (missingPlan.notes ?? "").includes("حرکت مستقیم اختصاصی ندارد"));

/* ─────────────── ۴) حذف مقدمهٔ ویدیو ─────────────── */
console.log("\n[۴] stripVideoAnalysisPreamble — «فقط ویدیو را تحلیل کن، توضیحش را نگو»");

const withPreamble = "این ویدیو نشان‌دهندهٔ انجام حرکت پرس سینه توسط ورزشکار است. عضلات سینه در فاز منفی کنترل کافی دارند اما ران‌ها هنگام بالا آمدن کمی از نیمکت جدا می‌شوند...";
const stripped = stripVideoAnalysisPreamble(withPreamble);
check("مقدمهٔ «این ویدیو نشان‌دهندهٔ...» حذف شد", stripped.startsWith("عضلات سینه"));

const withBodyEvalFirst = "عضلات سرشانه هنگام پرس فعال‌اند. این ویدیو یک اجرای معمولی است.";
check("اگر جملهٔ اول ارزیابی بدن است، دست نمی‌خورد",
  stripVideoAnalysisPreamble(withBodyEvalFirst) === withBodyEvalFirst);

const bodyEvalVideo = "این ویدیو فرم بدن ورزشکار را هنگام اسکوات نشان می‌دهد که تقارن زانوها نقض شده است.";
check("جملهٔ حاوی ارزیابی بدنی (تقارن) حذف نمی‌شود",
  stripVideoAnalysisPreamble(bodyEvalVideo) === bodyEvalVideo);

/* ─────────────── جمع‌بندی ─────────────── */
console.log(`\n═══ نتیجه: ${pass} سبز / ${fail} قرمز ═══`);
process.exit(fail > 0 ? 1 : 0);
