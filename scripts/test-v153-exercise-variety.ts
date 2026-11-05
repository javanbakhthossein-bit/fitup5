/**
 * ─── تست v153 — تنوع حرکات + ضدتکرار همان‌روز (تیکت مالک) ───
 *
 * پوشش:
 *  T1  exerciseFamilyKey: همهٔ واریانت‌های «شنا» یک خانواده (pushup) — ریشهٔ
 *      باگ «دو تا شنا در یک روز»؛ «شنای پیلاتس (Swimming)» pushup نیست.
 *  T2  buildLockedBank: ردیف‌های هم‌نام در مبدأ حذف می‌شوند.
 *  T3  dedupeExerciseFamiliesInPlan: شنا + شنا سوئدی در یک روز → دومین ترمیم؛
 *      پرس سینه هالتر + پرس سینه دمبل در یک روز مجاز (سقف ۲ + بدون رابطهٔ پیشوند)؛
 *      واریانتِ پیشوندیِ هم‌خانواده (پرس سینه هالتر + پرس سینه هالتر دست‌باز) ترمیم.
 *  T4  buildBankPromptNames: نمونه‌گیری دانه‌دار — دو seed متفاوت زیرمجموعهٔ
 *      متفاوت؛ حرکات رشته اول فهرست؛ سقف هدف رعایت؛ همه از بانک.
 *  T5  lockWorkoutPlanToBank: (v154 به‌روز شد) نام غریبه «با نام خودش می‌ماند»
 *      و نزدیک‌ترین ویدیوی بانک به آن الصاق می‌شود — جایگزینی کامل حرکت حذف شد.
 *  T6  enforceWorkoutExclusions: حرکت ممنوع → جایگزینی که هم‌نام/هم‌خانوادهٔ روز نباشد.
 *
 * اجرا: bun scripts/test-v153-exercise-variety.ts
 */
import {
  buildLockedBank,
  buildBankPromptNames,
  dedupeExerciseFamiliesInPlan,
  exerciseFamilyKey,
  lockWorkoutPlanToBank,
  type BankExerciseRow,
} from "../src/lib/fitness/exercise-bank-lock";
import { enforceWorkoutExclusions, type RedesignConstraints } from "../src/lib/fitness/plan-redesign-constraints";

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

function row(id: string, name: string, muscle: string, category: string): BankExerciseRow {
  return {
    id,
    name,
    muscle,
    category,
    youtubeUrl: "https://www.youtube.com/watch?v=abc",
    youtubeEnabled: true,
  };
}

const BANK_ROWS: BankExerciseRow[] = [
  row("e1", "شنا سوئدی (Push-Up)", "سینه", "push"),
  row("e2", "شنا الماسی", "سینه", "push"),
  row("e3", "شنای پیلاتس (Swimming)", "شکم", "core"),
  row("e4", "پرس سینه هالتر", "سینه", "push"),
  row("e5", "پرس سینه دمبل", "سینه", "push"),
  row("e6", "پرس سینه هالتر دست‌باز", "سینه", "push"),
  row("e7", "قفسه سینه سیم‌کش", "سینه", "push"),
  row("e8", "کراس اور سیم‌کش", "سینه", "push"),
  row("e9", "پک دک دستگاه", "سینه", "push"),
  row("e10", "اسکوات جلو", "پا", "legs"),
  row("e11", "اسکوات جلو (Front Squat)", "پا", "legs"), // هم‌نام فشردهٔ e10
  row("e12", "پرس پا دستگاه", "پا", "legs"),
  row("e13", "جلوبازو هالتر", "جلوبازو", "push"),
  row("e14", "جلوبازو چکشی دمبل", "جلوبازو", "push"),
  row("e15", "پارالل پشت بازو", "پشت بازو", "push"),
];

const bank = buildLockedBank(BANK_ROWS, true);

console.log("\n── T1: کلید خانوادهٔ حرکتی ──");
check("«شنا سوئدی (Push-Up)» → pushup", exerciseFamilyKey("شنا سوئدی (Push-Up)", "سینه") === "pushup");
check("«شنا الماسی» → pushup", exerciseFamilyKey("شنا الماسی", "سینه") === "pushup");
check("«شنا با دست‌باز» → pushup", exerciseFamilyKey("شنا با دست‌باز", "سینه") === "pushup");
check("«شنای پیلاتس (Swimming)» pushup نیست", exerciseFamilyKey("شنای پیلاتس (Swimming)", "شکم") !== "pushup");
check("«شنا پیلاتس (Pilates Push-Up)» → pushup", exerciseFamilyKey("شنا پیلاتس (Pilates Push-Up)", "سینه") === "pushup");
check("«بارفیکس شکم» → core_legraise (ترتیب الگوها سالم)", exerciseFamilyKey("بارفیکس شکم", "شکم") === "core_legraise");

console.log("\n── T2: حذف ردیف‌های هم‌نام بانک ──");
const sqOf = (n: string) => n.replace(/[^آ-یa-z0-9]/gi, "");
const allSqueezed = new Set(bank.all.map((r) => sqOf(r.name.replace(/[()]/g, "").replace(/\s|‌|-/g, ""))));
const e10Count = bank.all.filter((r) => r.name.includes("اسکوات جلو")).length;
check("«اسکوات جلو» فقط یک ردیف مانده", e10Count === 1, `found ${e10Count}`);
check("کل بانک بدون هم‌نام فشرده", bank.all.length === new Set(bank.all.map((r) => sqOf(r.name.replace(/[()]/g, "").replace(/\s|‌|-/g, "")))).size);

console.log("\n── T3: dedupe همان‌روز ──");
{
  const plan = {
    days: [
      {
        day: "شنبه",
        exercises: [
          { name: "شنا سوئدی (Push-Up)", muscle: "سینه", category: "push", sets: [] },
          { name: "شنا الماسی", muscle: "سینه", category: "push", sets: [] },
          { name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] },
        ],
      },
    ],
  };
  const rep = dedupeExerciseFamiliesInPlan(plan as any, bank);
  const names = (plan as any).days[0].exercises.map((e: any) => e.name);
  const shnaCount = names.filter((n: string) => /شنا|پوش/.test(n)).length;
  check("دو واریانت شنا در یک روز → یکی ترمیم شد", rep.replaced.length === 1, JSON.stringify(rep.replaced));
  check("بعد از ترمیم فقط یک شنا در روز است", shnaCount === 1, names.join(" | "));
  check("پرس سینه هالتر دست‌نخورده ماند", names.includes("پرس سینه هالتر"));
}
{
  const plan = {
    days: [
      {
        day: "یکشنبه",
        exercises: [
          { name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] },
          { name: "پرس سینه دمبل", muscle: "سینه", category: "push", sets: [] },
        ],
      },
    ],
  };
  const rep = dedupeExerciseFamiliesInPlan(plan as any, bank);
  check("پرس هالتر + پرس دمبل مجاز (دو واریانت غیرپیشوندی)", rep.replaced.length === 0, JSON.stringify(rep.replaced));
}
{
  const plan = {
    days: [
      {
        day: "دوشنبه",
        exercises: [
          { name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] },
          { name: "پرس سینه هالتر دست‌باز", muscle: "سینه", category: "push", sets: [] },
        ],
      },
    ],
  };
  const rep = dedupeExerciseFamiliesInPlan(plan as any, bank);
  check("واریانت پیشوندی هم‌خانواده ترمیم شد", rep.replaced.length === 1, JSON.stringify(rep.replaced));
}

console.log("\n── T4: تنوع نمونه‌گیری پرامپت ──");
{
  const seedA = 123456;
  const seedB = 654321;
  const listA = buildBankPromptNames(bank, ["پرس سینه هالتر"], 5, { seed: seedA, targetCount: 8 });
  const listB = buildBankPromptNames(bank, ["پرس سینه هالتر"], 5, { seed: seedB, targetCount: 8 });
  const listAgain = buildBankPromptNames(bank, ["پرس سینه هالتر"], 5, { seed: seedA, targetCount: 8 });
  check("حرکت رشته اول فهرست است", listA[0] === "پرس سینه هالتر", listA.join(","));
  check("سقف هدف رعایت شد (۸)", listA.length === 8, `len=${listA.length}`);
  check("همهٔ نام‌ها از بانک‌اند", listA.every((n) => bank.all.some((r) => r.name === n)));
  const same = listA.filter((n) => listB.includes(n)).length;
  check("دو seed متفاوت → زیرمجموعهٔ متفاوت", same < listA.length, `overlap=${same}/${listA.length}`);
  check("همان seed → خروجی قطعی", JSON.stringify(listA) === JSON.stringify(listAgain));
  // دانه‌داریِ نسخهٔ پرحجم واقعی: بانک فعلی ۵۴۹ حرکتی + minCount ۲۵ + هدف ۹۰
  const bigA = buildBankPromptNames(bank, [], 25, { seed: seedA, targetCount: 90 });
  const bigB = buildBankPromptNames(bank, [], 25, { seed: seedB, targetCount: 90 });
  check("بانک کامل: هدف ۹۰ → ۱۴ (بانک تست کوچک است، سقف = اندازهٔ بانک)", bigA.length === bank.all.length, `len=${bigA.length}`);
  const bigSame = bigA.filter((n) => bigB.includes(n)).length;
  check("بانک کامل: دو seed → ترتیب/ترکیب متفاوت", JSON.stringify(bigA) !== JSON.stringify(bigB));
  // بدون opts — رفتار قدیمی حفظ شود
  const legacy = buildBankPromptNames(bank, [], 25);
  check("بدون seed — حداقل ۱۰ نام مثل قبل", legacy.length >= 10);
}

console.log("\n── T5: قفل بانک v154 — حرکت غریبه می‌ماند + نزدیک‌ترین ویدیو الصاق می‌شود ──");
{
  const plan = {
    days: [
      {
        day: "سه‌شنبه",
        exercises: [
          { name: "شنای آرچر", muscle: "سینه", category: "push", sets: [] },
          { name: "شنا سوئدی (Push-Up)", muscle: "سینه", category: "push", sets: [] },
        ],
      },
    ],
  };
  const rep = lockWorkoutPlanToBank(plan as any, bank, { seed: 99 });
  const first = (plan as any).days[0].exercises[0];
  const attached = bank.all.find((r) => r.id === first.exerciseId);
  check("نام غریبه با نام خودش ماند (تعویض ممنوع — v154)", first.name === "شنای آرچر", first.name);
  check("نزدیک‌ترین ویدیوی بانک الصاق شد (exerciseId)", typeof first.exerciseId === "string" && !!attached, first.exerciseId);
  check("ردیف الصاق‌شده خودِ حرکت هم‌خانوادهٔ شنا است (نزدیک‌ترین)", !!attached && /شنا|پوش/.test(attached.name), attached?.name);
  check("ردیف الصاق‌شده تکرار ردیف حرکت دوم روز نیست", first.exerciseId !== bank.all.find((r) => r.name === "شنا سوئدی (Push-Up)")?.id);
  check("گزارش videoAttached=1", rep.videoAttached === 1, JSON.stringify(rep));
}

console.log("\n── T6: ممیزی ممنوعیت‌ها — جایگزین ضدتکرار همان‌روز ──");
{
  const constraints: RedesignConstraints = {
    forbiddenMovements: ["پرس سینه هالتر"],
    forbiddenFoods: [],
    forbiddenSupplements: [],
  };
  const plan = {
    days: [
      {
        day: "چهارشنبه",
        exercises: [
          { name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] },
          { name: "پرس سینه دمبل", muscle: "سینه", category: "push", sets: [] },
        ],
      },
    ],
  };
  const rep = enforceWorkoutExclusions(plan as any, constraints, bank as any);
  const names = (plan as any).days[0].exercises.map((e: any) => e.name);
  check("حرکت ممنوع حذف/جایگزین شد", rep.removed.length === 1 && !names.includes("پرس سینه هالتر"), JSON.stringify(rep));
  check("جایگزین هم‌نامِ حرکت دوم روز نشد", names[0] !== "پرس سینه دمبل", names.join(" | "));
  check("جایگزین از بانک است", bank.all.some((r) => r.name === names[0]), names.join(" | "));
  check("leftover صفر", rep.leftover.length === 0);
}

console.log(`\n═══ نتیجه: ${pass} موفق / ${fail} ناموفق ═══`);
if (fail > 0) process.exit(1);
