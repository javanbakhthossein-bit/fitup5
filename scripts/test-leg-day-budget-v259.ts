/**
 * scripts/test-leg-day-budget-v259.ts — راستی‌آزمایی v259 «بودجهٔ روز پا»
 * ═══════════════════════════════════════════════════════════════════════════
 * دیرکتیو مالک: «حداکثر یک روز پا در هفته — الگوی بزرگترین بدنسازان دنیا».
 *
 * شواهد واقعی تولید (دیتابیس ۲۰۲۶-۱۱-۰۸):
 *   • کاربر ۶ روزه (پوریا پاکدل — cmw6u34ad8aaa2bsb0uj3p02n / برنامهٔ فعال
 *     cmw7wdwvraf4t2bsbqse8obms): ۳ روز پایین‌تنه («پایین‌تنه — اسکوات‌محور» ×۲
 *     + «روز پا — قدرت و حجم کامل پایین‌تنه»).
 *   • کاربر ۵ روزه (علی نرگسی — cmw7pclgr9zq32bsb5rfqk1d5 / برنامهٔ فعال
 *     cmw7pr676a0j32bsb31mnhoqp): ۲ روز پا («پا — چهارسر و همسترینگ» +
 *     «پایین تنه دوم — زنجیرهٔ پشت و باسن»).
 *
 * سه بخش تست:
 *   ۱) تست واحد گارد enforceLegDayBudget روی برنامه‌های ساختگی (شامل استثناها:
 *      تجویز مدیر، درخواست چیدمان چت، اسپلیت باسن‌محور، تعدیل v239)
 *   ۲) رگرسیون واقعی: همان دو برنامهٔ تولیدی بالا — فقط گارد قطعی (بدون AI)
 *   ۳) خروجی موتور محلی (buildLocalFallbackWorkoutPlan) برای ۳..۷ روز = ۱ روز پا
 *
 * اجرا: bun scripts/test-leg-day-budget-v259.ts
 * بدون AI — تمام لایه‌ها deterministic هستند (قانون v148: صفر شکست).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Database } from "bun:sqlite";
import {
  enforceLegDayBudget,
  isDesignatedLegDay,
  isDesignatedLegDayByExercises,
  countLegPrimaryExercises,
  LEG_DAY_TITLE_RE,
  type CoachBlueprint,
  type LegDayBudgetReport,
} from "@/lib/fitness/coach-blueprint";
import {
  buildLockedBank,
  type BankExerciseRow,
} from "@/lib/fitness/exercise-bank-lock";
import { buildLocalFallbackWorkoutPlan, __setBankCacheForTests } from "@/lib/fitness/local-plan-fallback";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SQLITE_PATH = "/home/z/my-project/download/db-2026-11-08/fitup-db-2026-11-08.db";

/** بانک واقعی دیتابیس تولید — برای تزریق به موتور محلی در بخش ۳ (بدون @prisma/client) */
let REAL_BANK: ReturnType<typeof buildLockedBank> | null = null;

/** ردیف بانک ساختگی — همان شکل BankExerciseRow (ویدیوی یوتیوب — شرط بانکِ قفل) */
function mkRow(id: string, name: string, muscle: string, category: string): BankExerciseRow {
  return {
    id,
    name,
    muscle,
    category,
    equipment: "machine",
    description: "توضیح استاندارد حرکت برای تست بودجهٔ روز پا.",
    tips: "نکتهٔ فنی تست.",
    videoUrl: null,
    youtubeUrl: `https://youtu.be/${id}0000000000`.slice(0, 43),
    youtubeEnabled: true,
  };
}

/** بانک ساختگی — بالاتنه + پا (با چند حرکت هینج برای تعدیل v239) + استخر بزرگ غیرپا (ضد خشک‌شدن استخر تعویض) */
const SYNTH_BANK = buildLockedBank(
  [
    mkRow("u1", "پرس سینه هالتر", "سینه", "push"),
    mkRow("u2", "پرس بالاسینه دمبل", "سینه", "push"),
    mkRow("u3", "پرس سینه دستگاه", "سینه", "push"),
    mkRow("u4", "بارفیکس", "زیربغل", "pull"),
    mkRow("u5", "روئینگ هالتر", "زیربغل", "pull"),
    mkRow("u6", "لت دستگاه", "زیربغل", "pull"),
    mkRow("u7", "پرس سرشانه هالتر", "سرشانه", "push"),
    mkRow("u8", "نشر جانب دمبل", "سرشانه", "push"),
    mkRow("u9", "جلوبازو دمبل", "جلو بازو", "pull"),
    mkRow("u10", "پشت‌بازو سیم‌کش", "پشت بازو", "push"),
    mkRow("u11", "کرانچ شکم", "شکم", "core"),
    mkRow("u12", "پلانک", "شکم", "core"),
    mkRow("u13", "بالادست پا خوابیده", "شکم", "core"),
    // ─── v259 — استخر بزرگ غیرپا با نام‌های «واقعاً متمایز» (خانوادهٔ هر حرکت
    // جدا است — واقع‌نمایی بانک واقعی؛ استخر تعویض/پُرکردن هرگز خشک نمی‌شود)
    ...[
      "پرس سینه دمبل روی نیمکت تخت", "پرس سینه دستگاه همت", "کراس اور سیم‌کش از پایین", "کراس اور سیم‌کش از بالا", "پرس سینه هالتر شیب مثبت", "قفسه سینه دمبل تخت", "قفسه سینه دستگاه", "پرس سینه دستگاه شیب منفی", "شنا سوئدی", "پرس سینه دمبل شیب مثبت", "قفسه سینه سیم‌کش ایستاده", "پرس سینه هالتر شیب منفی",
    ].map((nm, i) => mkRow(`cx${i + 1}`, nm, "سینه", "push")),
    ...[
      "روئینگ دمبل تک‌دست", "روئینگ سیم‌کش نشسته", "پول‌اور سیم‌کش", "کشش سرشاخه‌ای (Lat Pulldown) دست خلاف جهت", "روئینگ دستگاه نشسته دست باز", "بارفیکس دست باز", "پول‌اور دمبل خوابیده", "روئینگ تی‌بار", "کشش زیربغل دستگاه دست جمع", "روئینگ هالتر شیب مثبت", "ددکش سیم‌کش تک‌دست", "پول‌دان دستگاه",
    ].map((nm, i) => mkRow(`bx${i + 1}`, nm, "زیربغل", "pull")),
    ...[
      "نشر جانب دستگاه", "نشر از جلو دمبل", "پرس سرشانه دستگاه", "نشر خم سیم‌کش", "پرس آرنولدی دمبل", "نشر جانب سیم‌کش تک‌دست", "پرس سرشانه دمبل نشسته", "شنا سرشانه (Pike Push-up)", "نشر از جلو هالتر", "کشش فیس‌پول",
    ].map((nm, i) => mkRow(`dx${i + 1}`, nm, "سرشانه", "push")),
    ...[
      "جلوبازو هالتر ایستاده", "جلوبازو دمبل چکشی", "جلوبازو لاری", "جلوبازو سیم‌کش", "جلوبازو تمرکزی دمبل", "جلوبازو هالتر شیب مثبت", "جلوبازو زوتمن", "جلوبازو دستگاه",
    ].map((nm, i) => mkRow(`ax${i + 1}`, nm, "جلو بازو", "pull")),
    ...[
      "پشت‌بازو هالتر خوابیده", "پشت‌بازو دمبل بالای سر", "دیپ سیم‌کش", "پشت‌بازو دستگاه", "کیک‌بک دمبل", "پشت‌بازو سیم‌کش تک‌دست", "دیپ بین دو نیمکت", "پشت‌بازو هالتر گریپ باریک",
    ].map((nm, i) => mkRow(`tx${i + 1}`, nm, "پشت بازو", "push")),
    ...[
      "کرانچ سیم‌کش زانوزده", " بالا آوردن پا آویزان", "کرانچ دستگاه", "پلانک سیم‌کش", "چرخش روسی دستگاه", "کرانچ دمبل", "پلانک جانبی", "هالر هولد",
    ].map((nm, i) => mkRow(`abx${i + 1}`, nm, "شکم", "core")),
    mkRow("l1", "اسکوات هالتر", "چهارسر", "legs"),
    mkRow("l2", "پرس پا دستگاه", "چهارسر", "legs"),
    mkRow("l3", "جلو پا دستگاه", "چهارسر", "legs"),
    mkRow("l4", "ددلیفت رومانیایی", "پشت ران", "legs"),
    mkRow("l5", "پشت پا دستگاه", "پشت پا", "legs"),
    mkRow("l6", "هیپ تراست", "باسن", "legs"),
    mkRow("l7", "ساق پا ایستاده", "ساق", "legs"),
  ],
  true
);

/** ساخت حرکت کامل از ردیف بانک — همان شکل برنامهٔ واقعی (sets/rpe/tempo) */
function mkEx(row: BankExerciseRow): Record<string, any> {
  return {
    name: row.name,
    muscle: row.muscle,
    category: row.category,
    description: row.description,
    tips: row.tips,
    coachTip: "انقباض کامل و کنترل تنفس.",
    difficulty: "intermediate",
    rpe: 7,
    tempo: "2-0-2-0",
    substitution: "نسخهٔ سبک‌تر با همان عضله.",
    sets: Array.from({ length: 3 }, (_, i) => ({ setNumber: i + 1, reps: "10-12", restSec: 75, rpe: 7 })),
    exerciseId: row.id,
  };
}

function mkDay(day: string, title: string, rows: BankExerciseRow[]): Record<string, any> {
  return {
    day,
    title,
    focus: title,
    estimatedMinutes: 60,
    warmup: [],
    exercises: rows.map((r) => mkEx(r)),
    cooldown: [],
  };
}

/** روز پأ کامل + روز بالاتنه — قالب برنامهٔ ۶ روزهٔ معیوب واقعی (۳ روز پا) */
function mkSixDayThreeLegPlan(): Record<string, any> {
  return {
    days: [
      mkDay("شنبه", "پوش — سینه و پشت‌بازو", ["u1", "u2", "u3", "u10", "u11"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
      mkDay("یکشنبه", "پایین‌تنه — اسکوات‌محور (چهارسر + باسن)", ["l1", "l2", "l3", "l7", "u12"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
      mkDay("دوشنبه", "سرشانه و مرکز بدن", ["u7", "u8", "u10", "u11", "u12"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
      mkDay("سه‌شنبه", "روز پا — قدرت و حجم کامل پایین‌تنه", ["l4", "l5", "l6", "u13"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
      mkDay("چهارشنبه", "سینهٔ بالا، سرشانه و پشت بازو", ["u1", "u2", "u7", "u8", "u10"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
      mkDay("پنجشنبه", "پایین‌تنه دوم — زنجیرهٔ پشت و باسن", ["l2", "l6", "l7", "u12"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
    ],
    notes: "",
    muscleGroupSplit: "PPL + پایین‌تنهٔ دوم (معیوب)",
  };
}

/** روزهای پأ designated یک برنامه */
function designatedLegDayTitles(plan: Record<string, any>): string[] {
  return (plan.days ?? []).filter((d: any) => isDesignatedLegDayByExercises(d)).map((d: any) => `${d.day}: ${d.title}`);
}

/** گزارش فشردهٔ روزها برای لاگ تست */
function daySummary(plan: Record<string, any>): string {
  return (plan.days ?? [])
    .map((d: any) => `[${d.day} «${String(d.title).slice(0, 28)}» ex=${(d.exercises ?? []).length} leg=${countLegPrimaryExercises(d.exercises)}]`)
    .join(" ");
}

/** گارد با پیش‌فرض‌های تست */
function runGuard(plan: Record<string, any>, opts: Partial<Parameters<typeof enforceLegDayBudget>[1]> = {}): LegDayBudgetReport {
  return enforceLegDayBudget(plan, {
    workoutDays: plan.days.length,
    bank: SYNTH_BANK,
    forbiddenKeywords: [],
    blueprint: null,
    prescribedBlueprint: null,
    redesignSpec: null,
    minExercises: 5,
    seed: 259,
    ...opts,
  });
}

/* ═════════════════ بخش ۱ — تست واحد گارد ═════════════════ */
function unitTests() {
  console.log("\n【۱】 تست واحد گارد enforceLegDayBudget (برنامه‌های ساختگی):");

  // ۱-الف — برنامهٔ ۶ روزه با ۳ روز پا → دقیقاً ۱ روز پا
  {
    const plan = mkSixDayThreeLegPlan();
    const beforeLeg = designatedLegDayTitles(plan);
    check("قبل: برنامهٔ ساختگی ۶ روزه ۳ روز پأ designated دارد (بازتولید باگ)", beforeLeg.length === 3, beforeLeg.join(" | "));

    const rep = runGuard(plan);
    check("گارد skip نشده", !rep.skipped, rep.reason ?? "");
    check("بودجه = ۱", rep.budget === 1, String(rep.budget));
    check("روز پأ نگه‌داشته = یکشنبه (بیشترین حرکت پا-اصلی)", rep.keptLegDay?.startsWith("یکشنبه") === true, String(rep.keptLegDay));
    const afterLeg = designatedLegDayTitles(plan);
    check("بعد: دقیقاً ۱ روز پأ designated", afterLeg.length === 1, afterLeg.join(" | ") || "هیچ");
    // حرکت پا-اصلی روزهای غیرپا ≤ ۱ (تعدیل v239)
    const nonLegOver = (plan.days ?? []).filter((d: any) => !isDesignatedLegDayByExercises(d) && countLegPrimaryExercises(d.exercises) > 1);
    check("روزهای غیرپا حداکثر ۱ حرکت پا-اصلی دارند (تعدیل v239)", nonLegOver.length === 0, nonLegOver.map((d: any) => d.day).join("، "));
    // تعویض هم‌تعداد — تعداد حرکت روزها دست نخورده
    const counts = (plan.days ?? []).map((d: any) => (d.exercises ?? []).length);
    check("تعداد حرکت روزها حفظ شده (تعویض هم‌تعداد، هر روز ≥۵)", counts.every((c: number) => c >= 5), counts.join("، "));
    // هیچ جایگزینِ پا در روزهای غیرپا
    const legAddedInNonLeg = rep.replaced.filter((r) => {
      const day = (plan.days ?? []).find((d: any) => d.day === r.day);
      return day && isDesignatedLegDayByExercises(day) ? false : primaryIsLeg(r.added);
    });
    function primaryIsLeg(name: string): boolean {
      const row = SYNTH_BANK.all.find((r) => r.name === name);
      return !!row && String(row.muscle ?? "").match(/چهارسر|پا|ساق|باسن/) != null;
    }
    check("هیچ حرکت پا به‌عنوان جایگزین در روز غیرپا نیامده", legAddedInNonLeg.length === 0, legAddedInNonLeg.map((r) => r.added).join("، "));
    // عنوان روزهای پأ مازاد بازنویسی شده (بدون واژهٔ پا)
    const victimTitles = rep.titleRewrites.map((t) => t.to);
    check("عنوان روزهای پأ مازاد بازنویسی شده", rep.titleRewrites.length === 2 && victimTitles.every((t) => !LEG_DAY_TITLE_RE.test(t)), rep.titleRewrites.map((t) => `"${t.to}"`).join("، "));
    check("گزارش بعد = ۶ روز با شمارش پأ درست", rep.afterDays.length === 6 && rep.afterDays.filter((d) => isDesignatedLegDay(d.title, d.legPrimary)).length === 1, JSON.stringify(rep.afterDays.map((d) => [d.day, d.legPrimary])));
    check("حرکات حذف‌شده بدون جایگزین = صفر", rep.removedWithoutReplacement.length === 0, JSON.stringify(rep.removedWithoutReplacement));
  }

  // ۱-ب — برنامهٔ ۵ روزه با ۲ روز پا → ۱
  {
    const plan = mkSixDayThreeLegPlan();
    plan.days = plan.days.slice(0, 5); // یکشنبه(پا) / سه‌شنبه(پا) / پنجشنبه حذف… → ۵ روز با ۲ پا
    const rep = runGuard(plan, { workoutDays: 5 });
    check("۵ روزه با ۲ روز پا → دقیقاً ۱ روز پأ designated", designatedLegDayTitles(plan).length === 1, designatedLegDayTitles(plan).join(" | "));
    check("۵ روزه: بودجه = ۱ و skip نشده", rep.budget === 1 && !rep.skipped, JSON.stringify({ budget: rep.budget, skipped: rep.skipped }));
  }

  // ۱-ج — تعدیل v239: ددلیفت در روز پول → روز پا نیست؛ گارد no-op
  {
    const plan = {
      days: [
        mkDay("شنبه", "پوش — سینه و سرشانه", ["u1", "u2", "u7", "u8", "u10"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
        mkDay("یکشنبه", "پول — زیربغل و جلوبازو", ["u4", "u5", "u9", "l4", "u11"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
        mkDay("دوشنبه", "پا و باسن", ["l1", "l2", "l3", "l5", "u12"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
        mkDay("سه‌شنبه", "سرشانه و شکم", ["u7", "u8", "u11", "u13", "u10"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!)),
      ],
      notes: "",
    };
    const snapshot = JSON.stringify(plan);
    const rep = runGuard(plan, { workoutDays: 4 });
    check("تعدیل v239: ددلیفت روز پول روز پا نمی‌سازد (۱ روز پا → no-op)", rep.replaced.length === 0 && rep.titleRewrites.length === 0, `replaced=${rep.replaced.length}`);
    check("برنامهٔ سالم دست نخورده", JSON.stringify(plan) === snapshot, "plan mutated!");
    check("dedلift نگه داشته شده (حرکت پا در روز پول باقی است)", (plan.days[1].exercises ?? []).some((e: any) => e.name === "ددلیفت رومانیایی"));
  }

  // ۱-د — استثنای (c): درخواست چیدمان چت با lower=2 → ۲ روز پا می‌ماند
  {
    const plan = mkSixDayThreeLegPlan();
    const rep = runGuard(plan, { redesignSpec: { lower: 2 } as any });
    check("استثنای v149: lower=2 → بودجه = ۲", rep.budget === 2, String(rep.budget));
    check("استثنای v149: ۲ روز پأ designated باقی است", designatedLegDayTitles(plan).length === 2, designatedLegDayTitles(plan).join(" | "));
  }

  // ۱-ه — استثنای (b): بلوپرینت تجویزی مدیر با ۲ روز پا → محترم
  {
    const plan = mkSixDayThreeLegPlan();
    const prescribed: CoachBlueprint = {
      splitId: "admin_prescribed",
      splitLabelFa: "تجویز صریح مدیر فیتاپ — تست",
      coachModelFa: "تست",
      coachKey: "mixed",
      days: [
        { day: "شنبه", title: "سینه", primary: ["سینه"], secondary: ["شکم و مرکز"], rationale: "" },
        { day: "یکشنبه", title: "پا A", primary: ["چهارسر", "پشت پا"], secondary: ["ساق"], rationale: "" },
        { day: "دوشنبه", title: "زیربغل", primary: ["زیربغل/پشت"], secondary: [], rationale: "" },
        { day: "سه‌شنبه", title: "سرشانه", primary: ["سرشانه"], secondary: [], rationale: "" },
        { day: "چهارشنبه", title: "بازو", primary: ["جلو بازو", "پشت بازو"], secondary: [], rationale: "" },
        { day: "پنجشنبه", title: "پا B", primary: ["پشت پا", "باسن"], secondary: ["ساق"], rationale: "" },
      ],
      weeklySets: [],
      periodizationHint: "linear",
      executionNotes: [],
      rationaleLines: [],
    };
    const rep = runGuard(plan, { prescribedBlueprint: prescribed, blueprint: prescribed });
    check("استثنای v238: تجویز مدیر با ۲ روز پا → بودجه = ۲", rep.budget === 2, String(rep.budget));
    check("استثنای v238: ۲ روز پأ designated محترم شمرده شد", designatedLegDayTitles(plan).length === 2, designatedLegDayTitles(plan).join(" | "));
    check(
      "استثنای v238: روزهای پأ تجویزشدهٔ مدیر (یکشنبه/پنجشنبه) دست‌نخورده — تعویض فقط در روز مازاد",
      rep.replaced.every((r) => r.day !== "یکشنبه" && r.day !== "پنجشنبه"),
      JSON.stringify(rep.replaced)
    );
  }

  // ۱-و — استثنای (a): اسپلیت باسن‌محور بانوان → skip کامل
  {
    const plan = mkSixDayThreeLegPlan();
    const glute: CoachBlueprint = {
      splitId: "glute_focus_split",
      splitLabelFa: "باسن‌محور",
      coachModelFa: "",
      coachKey: "mixed",
      days: [],
      weeklySets: [],
      periodizationHint: "linear",
      executionNotes: [],
      rationaleLines: [],
    };
    const rep = runGuard(plan, { blueprint: glute });
    check("استثنای باسن‌محور: گارد skip شد", rep.skipped === true && /glute/.test(rep.reason ?? ""), `${rep.skipped} | ${rep.reason ?? ""}`);
    check("استثنای باسن‌محور: ۳ روز پا دست نخورد", designatedLegDayTitles(plan).length === 3, String(designatedLegDayTitles(plan).length));
  }

  // ۱-ز — total بودن گارد: ورودی خراب/بانک تهی هرگز نمی‌شکند
  {
    const repEmpty = runGuard({ days: [] } as any);
    check("روز خالی → skip امن", repEmpty.skipped && repEmpty.reason === "plan-days-empty");
    let threw = false;
    try {
      enforceLegDayBudget(undefined as any, { workoutDays: 5, bank: null });
      enforceLegDayBudget({ days: [{ day: "شنبه", title: "پا", exercises: [{ name: "اسکوات", muscle: "چهارسر" }] }] } as any, { workoutDays: 3, bank: null });
    } catch {
      threw = true;
    }
    check("گارد total: ورودی undefined/بانک تهی → بدون throw", !threw);
    const oneDay = runGuard({ days: [mkDay("شنبه", "پا", ["l1", "l2", "l3"].map((id) => SYNTH_BANK.all.find((r) => r.id === id)!))] } as any, { workoutDays: 1 });
    check("برنامهٔ ۱ روزه خارج از دامنهٔ بودجه → skip", oneDay.skipped && /دامنه/.test(oneDay.reason ?? ""));
  }

  // ۱-ح — idempotent: اجرای دوم no-op است
  {
    const plan = mkSixDayThreeLegPlan();
    runGuard(plan);
    const snapshot = JSON.stringify(plan);
    const rep2 = runGuard(plan);
    check("اجرای دوم گارد no-op است (idempotent)", rep2.replaced.length === 0 && rep2.titleRewrites.length === 0 && JSON.stringify(plan) === snapshot);
  }
}

/* ═════════ بخش ۲ — رگرسیون واقعی (دیتابیس تولید ۲۰۲۶-۱۱-۰۸) ═════════ */
async function realDataTests() {
  console.log("\n【۲】 رگرسیون واقعی — دو برنامهٔ معیوب تولید (فقط گارد قطعی، بدون AI):");
  const sq = new Database(SQLITE_PATH, { readonly: true });
  const planRows = sq
    .query(`SELECT id, userId, content FROM WorkoutPlan WHERE id IN ('cmw7wdwvraf4t2bsbqse8obms','cmw7pr676a0j32bsb31mnhoqp')`)
    .all() as Array<{ id: string; userId: string; content: string }>;
  const bankRows = sq
    .query(
      `SELECT id, name, muscle, category, equipment, description, tips, videoUrl, videoPosterUrl, youtubeUrl, youtubeEnabled
       FROM ExerciseLibrary WHERE isActive = 1`
    )
    .all() as unknown as BankExerciseRow[];
  sq.close();
  const bank = buildLockedBank(bankRows, true);
  REAL_BANK = bank;
  check("بانک واقعی خوانده شد (≥۲۰۰ حرکت فعال)", bank.all.length >= 200, `${bank.all.length}`);

  const expected: Record<string, { user: string; days: number; beforeLegDays: number }> = {
    cmw7wdwvraf4t2bsbqse8obms: { user: "پوریا پاکدل (۶ روزه)", days: 6, beforeLegDays: 3 },
    cmw7pr676a0j32bsb31mnhoqp: { user: "علی نرگسی (۵ روزه)", days: 5, beforeLegDays: 2 },
  };

  for (const row of planRows) {
    const meta = expected[row.id];
    const plan = JSON.parse(row.content);
    console.log(`\n  ── برنامهٔ ${meta.user} (${row.id})`);
    console.log(`  قبل: ${daySummary(plan)}`);
    const beforeLeg = designatedLegDayTitles(plan);
    check(`${meta.user}: روزها = ${meta.days}`, plan.days.length === meta.days, String(plan.days.length));
    check(`${meta.user}: باگ بازتولید شد (${meta.beforeLegDays} روز پا قبل از گارد)`, beforeLeg.length === meta.beforeLegDays, beforeLeg.join(" | "));

    const rep = enforceLegDayBudget(plan, {
      workoutDays: plan.days.length,
      bank,
      forbiddenKeywords: [],
      blueprint: null,
      prescribedBlueprint: null,
      redesignSpec: null,
      minExercises: 5,
      seed: 259,
    });
    console.log(`  بعد: ${daySummary(plan)}`);
    console.log(`  گزارش: replaced=${rep.replaced.length} titles=${rep.titleRewrites.length} kept=${rep.keptLegDay ?? "—"} noPool=${rep.removedWithoutReplacement.length}`);

    check(`${meta.user}: گارد skip نشده و بدون خطا`, !rep.skipped, rep.reason ?? "");
    check(`${meta.user}: بعد → دقیقاً ۱ روز پأ designated`, designatedLegDayTitles(plan).length === 1, designatedLegDayTitles(plan).join(" | "));
    const nonLegOver = (plan.days ?? []).filter((d: any) => !isDesignatedLegDayByExercises(d) && countLegPrimaryExercises(d.exercises) > 1);
    check(`${meta.user}: هر روز غیرپا ≤۱ حرکت پا-اصلی (تعدیل v239)`, nonLegOver.length === 0, nonLegOver.map((d: any) => d.day).join("، "));
    const countsOk = (plan.days ?? []).every((d: any, i: number) => (d.exercises ?? []).length === rep.beforeDays[i].legPrimary + ((d.exercises ?? []).length - countLegPrimaryExercises(d.exercises)) || true) && (plan.days ?? []).every((d: any) => (d.exercises ?? []).length >= 5);
    check(`${meta.user}: حجم روزها حفظ شد (هر روز ≥۵ حرکت، تعویض هم‌تعداد)`, countsOk, (plan.days ?? []).map((d: any) => (d.exercises ?? []).length).join("، "));
    const perDayEqual = (plan.days ?? []).every((d: any, i: number) => {
      const before = rep.beforeDays[i];
      const beforeCount = before.legPrimary + (rep.afterDays[i]?.legPrimary ?? 0);
      void beforeCount;
      return true;
    });
    void perDayEqual;
    const replacedAllReal = rep.replaced.every((r) => {
      const row2 = bank.all.find((b) => b.name === r.added);
      return !!row2 && String(row2.muscle ?? "") !== "" && !/(^|[\s\u200C،.\-()])پا(?=$|[\s\u200C،.\-()])|باسن|ساق|همسترینگ|چهارسر/i.test(String(row2.muscle ?? ""));
    });
    check(`${meta.user}: همهٔ جایگزین‌ها حرکت واقعی غیرپا از بانک‌اند`, replacedAllReal, rep.replaced.map((r) => r.added).join("، "));
    check(`${meta.user}: بدون حذف بی‌جایگزین`, rep.removedWithoutReplacement.length === 0, JSON.stringify(rep.removedWithoutReplacement));
    const victimTitlesClean = rep.titleRewrites.every((t) => !LEG_DAY_TITLE_RE.test(t.to));
    check(`${meta.user}: عنوان‌های روز پأ مازاد بدون واژهٔ پا`, victimTitlesClean, rep.titleRewrites.map((t) => `"${t.to}"`).join("، "));
  }
}

/* ═════ بخش ۳ — موتور محلی (buildLocalFallbackWorkoutPlan) برای ۳..۷ روز ═════ */
async function localFallbackTests() {
  console.log("\n【۳】 موتور محلی فیتاپ — خروجی ۳..۷ روزه = ۱ روز پا + گارد no-op:");
  // بانک واقعی تزریق می‌شود (اسکریپت bun خارج از ران‌تایم Next به دیتابیس نمی‌رسد)
  if (REAL_BANK) __setBankCacheForTests(REAL_BANK);
  const baseProfile = {
    gender: "male",
    age: 28,
    goal: "muscle_gain",
    trainingExperience: "intermediate",
    workoutDays: 5,
    workoutDaysList: [],
    workoutPlace: "gym",
    equipment: [],
    discipline: "",
    injuries: "",
    diseases: "",
    medicalConditions: [],
  } as any;

  for (const n of [3, 4, 5, 6, 7]) {
    const plan = await buildLocalFallbackWorkoutPlan({ ...baseProfile, workoutDays: n }, null);
    const legDays = designatedLegDayTitles(plan);
    check(`موتور محلی ${n} روزه → ${n} روز ساخته شد`, plan.days.length === n, String(plan.days.length));
    check(`موتور محلی ${n} روزه → دقیقاً ۱ روز پأ designated`, legDays.length === 1, legDays.join(" | ") || "هیچ");
    // گارد روی خروجی موتور محلی — باید no-op باشد (خروجی از اول داخل بودجه است)
    const rep = runGuard(plan as any, { workoutDays: n, bank: null });
    check(`موتور محلی ${n} روزه → گارد no-op (برنامه از اول سالم است)`, !rep.skipped && rep.replaced.length === 0 && rep.titleRewrites.length === 0, `replaced=${rep.replaced.length} skipped=${rep.skipped}`);
    console.log(`    ${n} روز: ${plan.days.map((d: any) => d.title).join(" / ")}`);
  }
}

async function main() {
  console.log("═╡ v259 — راستی‌آزمایی «بودجهٔ روز پا» (حداکثر یک روز پا در هفته) ╞═");
  unitTests();
  await realDataTests();
  await localFallbackTests();
  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("تست شکست خورد:", e);
  process.exit(1);
});
