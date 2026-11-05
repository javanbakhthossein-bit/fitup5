/**
 * scripts/test-plan-quality-v237.ts — راستی‌آزمایی v237 «تضمین کیفیت برنامه»
 * ═══════════════════════════════════════════════════════════════════════════
 * دیرکتیو مالک: «برنامه کاربران به هیچ وجه از لحاظ علمی و ورزشی و منطقی و
 * اصولی هیچ ایراد و باگی نداشته باشه تا حتی اگر بزرگترین ورزشکاران دنیا هم
 * برنامه رو دیدند هیچ ایرادی نتونن بگیرن.»
 *
 * تست روی «برنامهٔ واقعی v6 مصطفی خوشبخت» (برنامهٔ فعال تولیدی که شکایت مالک
 * را ساخت: از ۴ روز، ۲ روز پا + داخل روز دیگر هم پا + پرس سینه/شنا سوئدی
 * ممنوع پروفایل + ترتیب به‌هم‌ریخته روزها + برپی/جامپ جک برای کاربر ۱۲۲ کیلویی
 * با کمر درد) — همهٔ فیکس‌های v237 قطعی باید همین برنامه را ترمیم کنند.
 *
 * اجرا: bun run scripts/test-plan-quality-v237.ts
 * بدون AI — تمام لایه‌ها deterministic هستند (قانون v148: صفر شکست).
 */
import { db } from "@/lib/db";
import {
  enforceBlueprintDayIdentity,
  type CoachBlueprint,
} from "@/lib/fitness/coach-blueprint";
import { enforceWorkoutExclusions } from "@/lib/fitness/plan-redesign-constraints";
import {
  auditWorkoutPlanDeterministic,
  auditForbiddenMovementLeak,
  auditGroupFrequencyCap,
  enforceInjuryMovementSafety,
  type PlanAuditIssue,
} from "@/lib/fitness/plan-quality-gate";
import { sortWeekdaysByPersianOrder } from "@/lib/fitness/types";
import { appendMuscleCoverageExplanationNotes } from "@/lib/fitness/ai";
import { MAJOR_GROUP_KEYS } from "@/lib/fitness/exercise-bank-lock";
import * as fs from "node:fs";

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

async function main() {
  console.log("═╡ v237 — راستی‌آزمایی تضمین کیفیت برنامه روی مورد واقعی مصطفی خوشبخت ╞═");

  // ─── ۱) بارگذاری برنامهٔ واقعی v6 (از دامپ تولیدی ۲۰۲۶-۱۰-۱۲) ───
  const raw = JSON.parse(
    fs.readFileSync("/home/z/my-project/download/db-2026-10-12-2247/mostafa-plan-v6.json", "utf8")
  ) as Record<string, any>;
  const workout: Record<string, any> = JSON.parse(JSON.stringify(raw)); // کپی عمیق

  // پروفایل واقعی مصطفی: ۱۲۲ کیلو، ۱۷۸ سانتی‌متر، کمر درد + مچ دست، ۴ روز
  const data = {
    gender: "male",
    age: 39,
    height: 178,
    weight: 122,
    goal: "fat_loss",
    activityLevel: "moderate",
    workoutDays: 4,
    workoutDaysList: ["شنبه", "دوشنبه", "چهارشنبه", "سه‌شنبه"],
    workoutPlace: "gym",
    equipment: [],
    diseases: "",
    injuries: "کمر دردو مچ دست",
    injuryAreas: ["lower_back", "wrist"],
    allergies: "",
    dietType: "standard",
    trainingExperience: "intermediate",
  } as any;

  // حرکات ممنوع واقعی پروفایل او (persistentExclusions)
  const forbiddenMovements: string[] = [
    "پارالل", "شنا الماسی", "شنا سوئدی", "اسکوات بلغاری", "دی‌پس پارالل", "شنا",
    "اسکوات جلو", "پرس سینه", "اسکات به پرس", "شنا (پوش‌آپ)", "دیپس پارالل", "اسکوات",
  ];

  // بانک حرکات سندباکس (همان منبع تولید)
  const bankRows = await db.exerciseLibrary.findMany({
    where: { isActive: true },
    select: { id: true, name: true, muscle: true, category: true, description: true, tips: true },
  });
  const bank = { all: bankRows as Array<Record<string, any>> };
  console.log(`بانک حرکات فعال: ${bankRows.length} ردیف`);
  const blueprint = workout.coachBlueprint as CoachBlueprint | undefined;

  const dayNames = () => (workout.days as any[]).map((d) => String(d?.day ?? ""));
  const allExNames = () =>
    (workout.days as any[]).flatMap((d) => (d.exercises ?? []).map((e: any) => String(e?.name ?? "")));

  // ─── ۲) وضعیت BEFORE — شکایت مالک باید بازتولید شود ───
  console.log("\n【۱】 وضعیت قبل (بازتولید شکایت):");
  check(
    "ترتیب روزها به‌هم‌ریخته است (سه‌شنبه بعد از چهارشنبه)",
    dayNames().map((d) => d.replace(/[\u200C\s"]+/g, "")).join("|") === "شنبه|دوشنبه|چهارشنبه|سهشنبه",
    dayNames().join("، ")
  );
  const preFreq = auditGroupFrequencyCap(workout);
  check(
    "سقف فرکانس پا نقض شده (۳ روز پا)",
    preFreq.some((i) => i.code === "workout_group_frequency_overcap" && i.message.includes("پا")),
    preFreq.map((i) => i.code).join(",") || "هیچ"
  );
  const preLeak = auditForbiddenMovementLeak(workout, forbiddenMovements);
  check(
    "حرکات ممنوع پروفایل نشت کرده‌اند (پرس سینه ×۲ + شنا سوئدی)",
    preLeak.length >= 3,
    `${preLeak.length} نشت`
  );
  const preInjury = auditWorkoutPlanDeterministic(workout, data).filter(
    (i) => i.code === "workout_injury_violation"
  );
  check(
    "حرکات پرشی با کمر درد/BMI ۳۸.۵ تضاد ایمنی دارند (برپی/جامپ‌جک/پلایومتریک)",
    ["برپی", "جامپ", "پلایومتریک"].every((w) => preInjury.some((i) => i.message.includes(w))),
    `${preInjury.length} نقض: ${preInjury.map((i) => i.message.slice(10, 50)).join(" | ")}`
  );

  // ─── ۳) اجرای زنجیرهٔ ترمیم v237 (همان ترتیب generateWorkoutPlan) ───
  console.log("\n【۲】 اجرای زنجیرهٔ ترمیم قطعی v237:");

  // ۳-الف — مرتب‌سازی روزها (v237)
  const pre = dayNames().join("|");
  workout.days = sortWeekdaysByPersianOrder(workout.days as Array<{ day: string }>);
  check(
    "مرتب‌سازی قطعی روزها بر اساس هفتهٔ فارسی",
    dayNames().map((d) => d.replace(/[\u200C\s"]+/g, "")).join("|") === "شنبه|دوشنبه|سهشنبه|چهارشنبه" && pre !== dayNames().map((d) => d.replace(/[\u200C\s"]+/g, "")).join("|"),
    dayNames().join("، ")
  );

  // ۳-ب — پلیس معماری (تعویض/حذف حرکات خارج از مجوز روز — ددلیفت روز بالاتنه)
  const bpReport = enforceBlueprintDayIdentity(workout, blueprint, bank, []);
  const wednesday = () =>
    (workout.days as any[]).find((d) => String(d?.day ?? "").replace(/[\s\u200C]+/g, "") === "چهارشنبه");
  const rdlLeak = (wednesday()?.exercises ?? []).some((e: any) => /ددلیفت رومانیایی/i.test(String(e?.name ?? "")));
  check(
    "ددلیفت رومانیایی از روز بالاتنه (چهارشنبه) حذف/تعویض شد",
    !rdlLeak,
    bpReport.replaced.filter((r) => r.day === "چهارشنبه").map((r) => `"${r.from}"→"${r.to}"`).join("، ") || "بدون تغییر"
  );

  // ۳-ج — جاروی ممنوعیت‌ها (پرس سینه ×۲ + شنا سوئدی)
  const exReport = enforceWorkoutExclusions(
    workout as { days?: Array<Record<string, any>>; notes?: string },
    { forbiddenMovements, forbiddenFoods: [], forbiddenSupplements: [] },
    bank
  );
  const postLeak = auditForbiddenMovementLeak(workout, forbiddenMovements);
  check(
    "جاروی ممنوعیت‌ها صفر نشت گذاشت",
    postLeak.length === 0,
    `${exReport.removed.length} تعویض/حذف — باقی: ${postLeak.map((i) => i.message.slice(8, 45)).join(" | ")}`
  );

  // ۳-د — ایمنی آسیب/BMI (برپی/جامپ‌جک/پلایومتریک → تعویض از بانک)
  const injuryReport = await enforceInjuryMovementSafety(workout, data);
  const postInjury = auditWorkoutPlanDeterministic(workout, data).filter(
    (i) => i.code === "workout_injury_violation"
  );
  check(
    "ایمنی آسیب/BMI: هیچ حرکت پرشی باقی نماند",
    postInjury.length === 0,
    `تعویض=${injuryReport.swapped} حذف=${injuryReport.removed} — باقی: ${postInjury.map((i) => i.message.slice(8, 45)).join(" | ")}`
  );

  // ─── ۴) وضعیت AFTER — هیچ ایراد علمی باقی نمانده باشد ───
  console.log("\n【۳】 وضعیت بعد (تضمین):");
  const postFreq = auditGroupFrequencyCap(workout);
  check(
    "سقف فرکانس همهٔ گروه‌ها برقرار (پا = ۲ روز)",
    postFreq.length === 0,
    postFreq.map((i) => i.message.slice(0, 60)).join(" | ") || "—"
  );
  const postAll = auditWorkoutPlanDeterministic(workout, data);
  const criticalLeft = postAll.filter((i) => i.severity === "critical");
  check(
    "هیچ ایراد critical دیگری در ممیزی قطعی باقی نمانده",
    criticalLeft.length === 0,
    criticalLeft.map((i) => `${i.code}: ${i.message.slice(0, 50)}`).join(" | ") || "—"
  );
  const wed = wednesday();
  const wedLegDirect = ((wed?.exercises ?? []) as any[]).filter((e) => {
    const n = String(e?.name ?? "");
    const m = String(e?.muscle ?? "");
    if (/بدن کامل|کل بدن/i.test(m)) return false; // فول‌بادی/هوازی — تمرکز مستقیم نیست
    return /چهارسر|همسترینگ|پشت پا|پشت ران|باسن|سرینی|ساق|leg|glute|چهارسر/i.test(`${m} ${n}`) || String(e?.category ?? "") === "legs";
  });
  check(
    "روز چهارشنبه دیگر حرکت مستقیم پا ندارد (متابولیک بالاتنه/کل‌بدن)",
    wedLegDirect.length === 0,
    wedLegDirect.map((e) => String(e?.name ?? "").slice(0, 25)).join(" ، ") || "—"
  );
  check(
    "ترتیب نهایی روزها استاندارد هفته است",
    dayNames().map((d) => d.replace(/[\u200C\s"]+/g, "")).join("|") === "شنبه|دوشنبه|سهشنبه|چهارشنبه"
  );
  const minVolume = (workout.days as any[]).every((d) => (d.exercises ?? []).length >= 4);
  check("حجم روزها سالم ماند (هر روز ≥۴ حرکت)", minVolume, (workout.days as any[]).map((d) => (d.exercises ?? []).length).join("، "));

  // ─── ۵) یادداشت صادقانه چیدمان (شمارش مستقیم — فول‌بادی پا حساب نمی‌شود) ───
  console.log("\n【۴】 یادداشت تحلیل چیدمان:");
  const noteWorkout: Record<string, any> = JSON.parse(JSON.stringify(workout));
  noteWorkout.notes = "";
  appendMuscleCoverageExplanationNotes(
    noteWorkout,
    { goal: "fat_loss" } as any,
    new Set(MAJOR_GROUP_KEYS)
  );
  const legsOvercapNote = String(noteWorkout.notes ?? "").includes("۳ روز کار مستقیم");
  check("یادداشت «۳ روز پا» دیگر تولید نمی‌شود", !legsOvercapNote);
  const honestyNote = String(noteWorkout.notes ?? "").includes("فرکانس علمی ۲ بار در هفته برای هر عضله طراحی شده");
  check("متن تناقض‌دار قدیمی («فرکانس علمی ۲ بار...») حذف شده", !honestyNote);

  // کنترل منفی: روز فقط-برپی «پا» حساب نمی‌شود
  const burpeeOnly: Record<string, any> = {
    days: [
      { day: "شنبه", exercises: [{ name: "برپی", muscle: "بدن کامل", category: "cardio" }] },
      { day: "دوشنبه", exercises: [{ name: "پرس پا دستگاه", muscle: "چهارسر", category: "legs" }] },
      { day: "سه‌شنبه", exercises: [{ name: "پرس پا تک‌پا", muscle: "چهارسر", category: "legs" }] },
    ],
    notes: "",
  };
  appendMuscleCoverageExplanationNotes(burpeeOnly, { goal: "fat_loss" } as any, new Set(MAJOR_GROUP_KEYS));
  check("برپی/هوازی در شمارش تمرکز مستقیم پا نمی‌آید", !String(burpeeOnly.notes ?? "").includes("۳ روز"));

  // ─── جمع‌بندی ───
  console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
  if (fail > 0) process.exit(1);
  await db.$disconnect?.();
}

main().catch((e) => {
  console.error("تست شکست خورد:", e);
  process.exit(1);
});
