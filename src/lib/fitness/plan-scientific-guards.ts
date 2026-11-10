/**
 * plan-scientific-guards.ts — گاردهای علمی قطعی برنامه (v261)
 * ═══════════════════════════════════════════════════════════════════
 * دیرکتیو مالک v261: «همهٔ عضلات حتی مچ و ساعد باید درگیر بشن — بدون
 * ۲-۳ روز پا — برنامه با کیفیت‌ترین/فیزیولوژیک‌ترین الگوی بزرگان — و
 * هیچ باگی در برنامهٔ هیچ کاربری نباشد (حتی برنامه‌های قبلی)».
 *
 * این ماژول سه گارد قطعی (بدون AI) را یک‌جا ارائه می‌کند و هم در
 * پایپ‌لاین تولید (ai.ts / program-generation.ts) و هم در جاروی
 * بازآرایی برنامه‌های موجود (scripts/sweep-plan-repairs-v261.ts) استفاده می‌شود:
 *
 *   ① core-guard      — پوشش مرکزی/شکم (پلانک/کرانچ از بانک واقعی)
 *   ② cardio-guard    — هدف چربی‌سوزی/استقامت ⇒ حداقل ۲ کاردیو سازگار با
 *                       محل/تجهیزات/IMB/آسیب (پرش ممنوع برای IMB≥۳۰/زانو)
 *   ③ equipment-guard — هر حرکت با تجهیزات واقعی کاربر سازگار شود؛ حرکت
 *                       ناسازگار با هم‌خانوادهٔ سازگار تعویض یا حذف می‌شود.
 *
 * قانون بانک قفل (v148): فقط حرکات واقعی بانک (ویدیودار ترجیحی) — هیچ
 * حرکت ساختگی. همهٔ انتخاب‌ها قطعی‌اند (seed) — صفر تصادف.
 */
import {
  enforceLegDayBudget,
  type CoachBlueprint,
  type LegDayBudgetReport,
} from "./coach-blueprint";
import { exerciseFamilyKey, type LockedBank } from "./exercise-bank-lock";

export interface PlanGuardContext {
  bank: LockedBank | null;
  place: string; // gym | home | both
  equipment: string[]; // کلیدهای پروفایل کاربر
  goal: string; // fat_loss | muscle_gain | endurance | fitness | strength | ...
  bmi: number;
  workoutDays: number;
  forbiddenKeywords?: string[];
  /** v261 — کلیدهای آسیب کاربر: knee | lower_back | shoulder | wrist | high_impact_risk */
  injuryKeys?: string[];
  blueprint?: CoachBlueprint | null;
  seed?: number;
}

export interface PlanGuardReport {
  coreAdded: Array<{ name: string; day: string }>;
  cardioAdded: Array<{ name: string; day: string }>;
  equipmentSwaps: Array<{ day: string; from: string; to: string }>;
  equipmentRemoved: Array<{ day: string; name: string }>;
  injurySwaps: Array<{ day: string; from: string; to: string }>;
  injuryRemoved: Array<{ day: string; name: string }>;
  /** گزارش گارد بودجهٔ پا (برای تشخیص تغییر در جارو) */
  legReport?: LegDayBudgetReport;
  notesLines: string[];
}

/** قواعد ممنوعیت آسیب — منبع واحد حقیقت (ممیزی + گارد هر دو از اینجا می‌خوانند) */
export const INJURY_RULES: { key: string; label: string; patterns: RegExp[]; allow?: RegExp }[] = [
  { key: "knee", label: "زانو", patterns: [/پرش|جامپ|jump/i, /اسکوات\s*عمیق|اسکوات\s*هالتر|ددلیفت\s*پا|لانج\s*پرشی|اسکوات\s*جامپ/i], allow: /یارشیو|میلد|جزئی|ایستاده|خوابیده|اکستنشن|جلو\s*پا\s*دستگاه|دستگاه/ },
  { key: "lower_back", label: "کمر", patterns: [/ددلیفت|گود\s*مورنینگ|پرس\s*سرشانه\s*ایستاده\s*هالتر|کول\s*هالتر|زیربغل\s*هالتر\s*میل/i], allow: /ددلیفت\s*رومانیایی\s*سمی|دستگاه|سیم\s*کش|دمبل\s*سبک/ },
  { key: "shoulder", label: "شانه", patterns: [/پشت\s*گردن|پرس\s*سرشانه\s*پشت/i], allow: /جلوبازو|ساعد/ },
  { key: "wrist", label: "مچ", patterns: [/ترایسپ\s*دستی|پرس\s*سردست|مچ\s*برعکس|دکتر\s*دست/i], allow: /مچ\s*بند|سبک/ },
];

const CORE_RE = /شکم|مرکزی|کرانچ|پلانک|core|abdominal|abs/i;
const JUMP_RE = /پرش|جامپ|جک|jump|hop|burpee|برپی/i;
const GYM_EQ = ["barbell", "dumbbell", "machine", "cable", "bench", "pullup_bar", "kettlebell", "trx", "bands", "jump_rope"];

function normEqKey(s: string): string {
  const n = String(s ?? "").toLowerCase().replace(/[\s\-_\u200c]/g, "");
  if (n === "pullupbar" || n === "pullup") return "pullup_bar";
  return n;
}

/** کلیدهای تجهیزاتِ یک ردیف بانک — با نام‌های فارسی هم پشتیبانی می‌شود
 * v263-fix — پارامتر به `string | null | undefined` گسترش یافت: ردیف‌های بانک
 * `equipment?: string | null` دارند و next build پروداکشن روی TS2345 می‌خوابید.
 * بدنه از قبل null-safe است (String(equipment ?? "")) — رفتار عیناً قبلی است. */
function bankRowEqKeys(equipment: string | null | undefined): string[] {
  const raw = String(equipment ?? "").split(/[,،]/).map((x) => x.trim()).filter(Boolean);
  if (raw.length === 0) return [];
  const keys: string[] = [];
  for (const item of raw) {
    const n = normEqKey(item);
    if (/^(bodyweight|بدن|وزنبدن|بدنخود)$/.test(n)) continue; // همیشه در دسترس
    if (/^دستگاه$/.test(n)) { keys.push("machine"); continue; }
    if (/^سیمکش|^کابل/.test(n)) { keys.push("cable"); continue; }
    if (/^نیمکت$/.test(n)) { keys.push("bench"); continue; }
    if (/^دمبل/.test(n)) { keys.push("dumbbell"); continue; }
    if (/^هالتر/.test(n)) { keys.push("barbell"); continue; }
    if (/^کش/.test(n)) { keys.push("bands"); continue; }
    if (/^طناب/.test(n)) { keys.push("jump_rope"); continue; }
    if (/^کتلبل|kettle/.test(n)) { keys.push("kettlebell"); continue; }
    if (/^t‌rx$|^trx$|تآرایکس/.test(n)) { keys.push("trx"); continue; }
    keys.push(n);
  }
  return keys;
}

/** آیا این حرکت با تجهیزات واقعی کاربر سازگار است؟ */
function isRowCompatible(rowEqKeys: string[], available: Set<string>): boolean {
  return rowEqKeys.every((k) => available.has(k));
}

/** نیاز تجهیزات یک حرکتِ برنامه — اول بانک (exerciseId)، فال‌بک نام */
function exerciseEqKeys(ex: Record<string, any>, bank: LockedBank | null): string[] {
  const id = typeof ex?.exerciseId === "string" ? ex.exerciseId : "";
  if (bank && id) {
    const row = (bank.all as Array<{ id: string; equipment: string }>).find((r) => r.id === id);
    if (row) return bankRowEqKeys(row.equipment);
  }
  const name = String(ex?.name ?? "");
  const need: string[] = [];
  if (/هالتر/.test(name) && !/دستگاه|سیم/.test(name)) need.push("barbell");
  if (/دمبل/.test(name)) need.push("dumbbell");
  if (/کش\s*مقاومتی|کش\s*ورزشی/.test(name)) need.push("bands");
  if (/بارفیکس|آویزان\s*شدن|پاروئی/.test(name)) need.push("pullup_bar");
  if (/طناب/.test(name)) need.push("jump_rope");
  if (/کِتل|کتلبل|kettle/i.test(name)) need.push("kettlebell");
  if (/TRX|ت‌آر‌ایکس/i.test(name)) need.push("trx");
  if (/سیم‌?کش|کابل/.test(name)) need.push("cable");
  if (/دستگاه/.test(name)) need.push("machine");
  if (/نیمکت/.test(name)) need.push("bench");
  return need;
}

/** ساخت آبجکت حرکتِ برنامه از ردیف بانک — همان الگوی ترمیم v260 */
function rowToPlanExercise(row: Record<string, any>, opts?: { sets?: number; reps?: string; restSec?: number; rpe?: number }): Record<string, any> {
  return {
    name: row.name,
    muscle: row.muscle,
    category: row.category,
    description: row.description || "حرکت را با کنترل کامل و دامنهٔ حرکتی کامل اجرا کن.",
    tips: row.tips || "فرم صحیح و تنفس منظم را حفظ کن.",
    coachTip: "انقباض کامل و کنترل منفی — کیفیت اجرا مهم‌تر از وزنه است.",
    difficulty: "intermediate",
    rpe: opts?.rpe ?? 7,
    tempo: "2-0-2-0",
    substitution: "نسخهٔ سبک‌تر با همان عضله در صورت خستگی",
    sets: Array.from({ length: opts?.sets ?? 3 }, (_, i) => ({
      setNumber: i + 1,
      reps: opts?.reps ?? "12-15",
      restSec: opts?.restSec ?? 60,
      rpe: opts?.rpe ?? 7,
    })),
    exerciseId: row.id,
  };
}

function matchesForbidden(name: string, forbiddenKeywords?: string[]): boolean {
  if (!forbiddenKeywords || forbiddenKeywords.length === 0) return false;
  return forbiddenKeywords.some((k) => String(k).trim().length > 0 && name.includes(k.trim()));
}

/** یافتن جایگزین سازگار (تجهیزات + ممنوعیت + آسیب) برای یک حرکت — منبع مشترک گاردها */
function findReplacement(ex: Record<string, any>, ctx: PlanGuardContext, available: Set<string>): Record<string, any> | null {
  if (!ctx.bank) return null;
  const usedNames = new Set((parsed_?.days ?? []).flatMap((dd: any) => (dd?.exercises ?? []).map((e: any) => String(e?.name ?? ""))));
  const fam = exerciseFamilyKey(String(ex.name ?? ""), ex.muscle);
  const muscleHead = (String(ex.muscle ?? "").split(/[(（]/)[0] || "").trim();
  const muscleRe = new RegExp(muscleHead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const pool = ctx.bank.all
    .filter((r) => r.id !== String(ex.exerciseId ?? ""))
    .filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), available))
    .filter((r) => !matchesForbidden(String(r.name ?? ""), ctx.forbiddenKeywords))
    .filter((r) => !usedNames.has(String(r.name ?? "")))
    .filter((r) => !injuryViolates(String(r.name ?? ""), ctx.injuryKeys ?? []));
  const sameFam = pool.filter((r) => exerciseFamilyKey(String(r.name ?? ""), r.muscle) === fam);
  const sameMuscle = pool.filter((r) => muscleHead ? muscleRe.test(String(r.muscle ?? "")) : String(r.category ?? "") === String(ex.category ?? ""));
  return sameFam[0] ?? sameMuscle[0] ?? null;
}

// فیل مکان‌نما — در applyPlanScientificGuards قبل از گاردها ست می‌شود (جلوگیری از چرخه پارامتر)
let parsed_: { days?: Array<Record<string, any>> } | null = null;

/** آیا نام حرکت با آسیب‌های کاربر ناسازگار است؟ */
function injuryViolates(name: string, injuryKeys: string[]): boolean {
  for (const rule of INJURY_RULES) {
    if (!injuryKeys.includes(rule.key)) continue;
    if (rule.allow && rule.allow.test(name)) continue;
    if (rule.patterns.some((p) => p.test(name))) return true;
  }
  return false;
}

/** ④ گارد آسیب‌محور — تعویض/حذف حرکاتِ ناسازگار با آسیب کاربر */
function guardInjury(parsed: { days?: Array<Record<string, any>>; [k: string]: any }, ctx: PlanGuardContext, report: PlanGuardReport): void {
  const keys = ctx.injuryKeys ?? [];
  if (keys.length === 0 || !Array.isArray(parsed?.days)) return;
  const available = availableEqOf(ctx);
  for (const d of parsed.days) {
    if (!d || !Array.isArray(d.exercises)) continue;
    const exs = d.exercises as Array<Record<string, any>>;
    for (let i = 0; i < exs.length; i++) {
      const ex = exs[i];
      if (!ex || !injuryViolates(String(ex.name ?? ""), keys)) continue;
      const cand = findReplacement(ex, ctx, available);
      if (cand) {
        const replacement = rowToPlanExercise(cand, { sets: (ex.sets as any[])?.length ?? 3, reps: (ex.sets?.[0]?.reps as string) ?? "10-12", restSec: ex.sets?.[0]?.restSec ?? 90, rpe: ex.rpe ?? 7 });
        exs[i] = replacement;
        report.injurySwaps.push({ day: String(d.day ?? "؟"), from: String(ex.name ?? ""), to: String(cand.name ?? "") });
      } else {
        exs.splice(i, 1);
        i--;
        report.injuryRemoved.push({ day: String(d.day ?? "؟"), name: String(ex.name ?? "") });
      }
    }
    if (exs.length === 0 && ctx.bank && ctx.bank.all.length > 0) {
      const usedNames = new Set(parsed.days.flatMap((dd: any) => (dd?.exercises ?? []).map((e: any) => String(e?.name ?? ""))));
      const filler = ctx.bank.all.filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), available) && String(r.category ?? "") === "fullbody" && !usedNames.has(String(r.name ?? "")) && !injuryViolates(String(r.name ?? ""), keys))[0]
        ?? ctx.bank.all.filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), available) && !usedNames.has(String(r.name ?? "")) && !injuryViolates(String(r.name ?? ""), keys))[0];
      if (filler) {
        exs.push(rowToPlanExercise(filler, { sets: 3, reps: "10-12", restSec: 90 }));
        report.injurySwaps.push({ day: String(d.day ?? "؟"), from: "روز خالی", to: String(filler.name ?? "") });
      }
    }
  }
  if (report.injurySwaps.length > 0) {
    report.notesLines.push(`- 🛡️ ایمنی آسیب: ${report.injurySwaps.map((s) => `«${s.from}» → «${s.to}»`).join("، ")} — نسخهٔ سازگار با وضعیت جسمانی شما.`);
  }
  if (report.injuryRemoved.length > 0) {
    report.notesLines.push(`- 🛡️ ${report.injuryRemoved.length} حرکتِ ناسازگار با آسیب شما (بدون جایگزین ایمن) حذف شد.`);
  }
}

/** ① پوشش مرکزی/شکم */
function guardCore(parsed: any, ctx: PlanGuardContext, report: PlanGuardReport): void {
  if (!ctx.bank || !Array.isArray(parsed?.days) || parsed.days.length < 2) return;
  const days = parsed.days.filter((d: any) => d && Array.isArray(d.exercises));
  const covered = days.some((d: any) =>
    (d.exercises as any[]).some((e) => CORE_RE.test(String(e?.muscle ?? "")) || CORE_RE.test(String(e?.name ?? "")) || String(e?.category ?? "") === "core")
  );
  if (covered) return;
  const usedIds = new Set<string>(days.flatMap((d: any) => d.exercises.map((e: any) => String(e?.exerciseId ?? "")).filter(Boolean)));
  const usedFams = new Set<string>(days.flatMap((d: any) => d.exercises.map((e: any) => exerciseFamilyKey(String(e?.name ?? ""), e?.muscle))));
  const pool = ctx.bank.all
    .filter((r) => String(r.category ?? "") === "core" || CORE_RE.test(String(r.muscle ?? "")))
    .filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), availableEqOf(ctx)))
    .filter((r) => !usedIds.has(r.id) && !usedFams.has(exerciseFamilyKey(String(r.name ?? ""), r.muscle)))
    .slice(0, 20);
  if (pool.length === 0) return;
  // مقصد: کم‌حرکت‌ترین روزِ غیرپا (پلایومتریک/پرش برای IMB بالا نیست — پلانک امن است)
  const target = days
    .filter((d: any) => {
      const legish = (d.exercises as any[]).filter((e) => /پا|چهارسر|همسترینگ|ساق|باسن|سرینی/i.test(String(e?.muscle ?? ""))).length;
      return legish * 2 <= d.exercises.length;
    })
    .reduce((min: any, d: any) => (d.exercises.length < min.exercises.length ? d : min), days[0]);
  const picks = pool.slice(0, 2);
  for (const row of picks) {
    target.exercises.push(rowToPlanExercise(row, { sets: 3, reps: "12-15", restSec: 45, rpe: 6 }));
    usedIds.add(row.id);
    report.coreAdded.push({ name: row.name, day: String(target.day ?? "؟") });
  }
  report.notesLines.push(
    `- 🎯 تکمیل پوشش عضلات مرکزی: «${picks.map((r) => r.name).join("» و «")}» برای پایداری مرکزی و مهار شکم اضافه شد (الگوی علمی تمام‌عضله).`
  );
}

/** تجهیزات واقعی در دسترس کاربر */
function availableEqOf(ctx: PlanGuardContext): Set<string> {
  const s = new Set<string>(["bodyweight"]);
  for (const e of ctx.equipment ?? []) s.add(normEqKey(e));
  if (ctx.place === "gym" || ctx.place === "both") for (const e of GYM_EQ) s.add(e);
  return s;
}

/** ② کاردیو هدف‌محور (چربی‌سوزی/استقامت) */
function guardCardio(parsed: any, ctx: PlanGuardContext, report: PlanGuardReport): void {
  if (!ctx.bank || !Array.isArray(parsed?.days) || parsed.days.length === 0) return;
  const goal = String(ctx.goal ?? "");
  if (goal !== "fat_loss" && goal !== "endurance") return;
  const days = parsed.days.filter((d: any) => d && Array.isArray(d.exercises));
  let cardioCount = 0;
  for (const d of days) {
    cardioCount += Array.isArray(d.cardio) ? d.cardio.length : 0;
    cardioCount += (d.exercises as any[]).filter((e) => String(e?.category ?? "") === "cardio").length;
  }
  const need = 2 - cardioCount;
  if (need <= 0) return;
  const usedIds = new Set<string>(days.flatMap((d: any) => d.exercises.map((e: any) => String(e?.exerciseId ?? "")).filter(Boolean)));
  const noJump = ctx.bmi >= 30 || /زانو|knee/i.test(ctx.forbiddenKeywords?.join(" ") ?? "");
  const isGym = ctx.place === "gym" || ctx.place === "both";
  let pool = ctx.bank.all.filter((r) => String(r.category ?? "") === "cardio");
  pool = pool.filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), availableEqOf(ctx)));
  pool = pool.filter((r) => !usedIds.has(r.id) && !matchesForbidden(String(r.name ?? ""), ctx.forbiddenKeywords));
  if (noJump) pool = pool.filter((r) => !JUMP_RE.test(String(r.name ?? "")));
  // اولویت: کاردیوی دستگاهی باشگاه (سازگار با فیزیولوژی چربی‌سوزی) → بدون پرش
  const gymRe = /تردمیل|دوچرخه|الپتیکال|روئینگ|رویینگ|اسکی|پارویی|کوهنوردی/i;
  pool.sort((a: any, b: any) => Number(gymRe.test(String(b.name ?? "")) && isGym) - Number(gymRe.test(String(a.name ?? "")) && isGym) || Number(!JUMP_RE.test(String(a.name ?? ""))) - Number(!JUMP_RE.test(String(b.name ?? ""))));
  const picks = pool.slice(0, Math.min(need, 2));
  if (picks.length === 0) return;
  for (const row of picks) {
    const target = days.reduce((min: any, d: any) => (d.exercises.length < min.exercises.length ? d : min), days[0]);
    target.exercises.push(rowToPlanExercise(row, { sets: 1, reps: "20 دقیقه", restSec: 0, rpe: 6 }));
    usedIds.add(row.id);
    report.cardioAdded.push({ name: row.name, day: String(target.day ?? "؟") });
  }
  report.notesLines.push(
    `- 🫀 تکمیل کاردیو هدف‌محور: برای ${goal === "fat_loss" ? "چربی‌سوزی" : "استقامت"}، «${picks.map((r) => r.name).join("» و «")}» (${noJump ? "نسخهٔ بدون فشار زانو" : "۲۰ دقیقه هوازی"}) به برنامه اضافه شد.`
  );
}

/** ③ سازگاری تجهیزات — تعویض/حذف حرکاتِ ناسازگار */
function guardEquipment(parsed: any, ctx: PlanGuardContext, report: PlanGuardReport): void {
  if (!ctx.bank || !Array.isArray(parsed?.days)) return;
  const available = availableEqOf(ctx);
  for (const d of parsed.days) {
    if (!d || !Array.isArray(d.exercises)) continue;
    const exs = d.exercises as Array<Record<string, any>>;
    for (let i = 0; i < exs.length; i++) {
      const ex = exs[i];
      if (!ex) continue;
      const need = exerciseEqKeys(ex, ctx.bank);
      const bad = need.filter((k) => !available.has(k));
      if (bad.length === 0) continue;
      // کاندید جایگزین: هم‌خانواده + سازگار + تکرارنشدنی
      const fam = exerciseFamilyKey(String(ex.name ?? ""), ex.muscle);
      const muscleRe = new RegExp(
        (String(ex.muscle ?? "").split(/[(（]/)[0] || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const usedIds = new Set(parsed.days.flatMap((dd: any) => (dd?.exercises ?? []).map((e: any) => String(e?.exerciseId ?? ""))));
      const usedNames = new Set(parsed.days.flatMap((dd: any) => (dd?.exercises ?? []).map((e: any) => String(e?.name ?? ""))));
      let pool = ctx.bank.all
        .filter((r) => r.id !== String(ex.exerciseId ?? ""))
        .filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), available))
        .filter((r) => !matchesForbidden(String(r.name ?? ""), ctx.forbiddenKeywords))
        .filter((r) => !usedNames.has(String(r.name ?? "")));
      const sameFam = pool.filter((r) => exerciseFamilyKey(String(r.name ?? ""), r.muscle) === fam);
      const sameMuscle = pool.filter((r) => String(ex.muscle ?? "").trim() ? muscleRe.test(String(r.muscle ?? "")) : String(r.category ?? "") === String(ex.category ?? ""));
      const cand = sameFam[0] ?? sameMuscle[0];
      if (cand) {
        const replacement = rowToPlanExercise(cand, { sets: (ex.sets as any[])?.length ?? 3, reps: (ex.sets?.[0]?.reps as string) ?? "10-12", restSec: ex.sets?.[0]?.restSec ?? 90, rpe: ex.rpe ?? 7 });
        exs[i] = replacement;
        report.equipmentSwaps.push({ day: String(d.day ?? "؟"), from: String(ex.name ?? ""), to: String(cand.name ?? "") });
      } else {
        exs.splice(i, 1);
        i--;
        report.equipmentRemoved.push({ day: String(d.day ?? "؟"), name: String(ex.name ?? "") });
      }
    }
    // روز خالی نشود
    if (exs.length === 0 && ctx.bank && ctx.bank.all.length > 0) {
      const usedNames = new Set(parsed.days.flatMap((dd: any) => (dd?.exercises ?? []).map((e: any) => String(e?.name ?? ""))));
      const filler = ctx.bank.all.filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), available) && String(r.category ?? "") === "fullbody" && !usedNames.has(String(r.name ?? "")))[0]
        ?? ctx.bank.all.filter((r) => isRowCompatible(bankRowEqKeys(r.equipment), available) && !usedNames.has(String(r.name ?? "")))[0];
      if (filler) {
        exs.push(rowToPlanExercise(filler, { sets: 3, reps: "10-12", restSec: 90 }));
        report.equipmentSwaps.push({ day: String(d.day ?? "؟"), from: "روز خالی", to: String(filler.name ?? "") });
      }
    }
  }
  if (report.equipmentSwaps.length > 0) {
    report.notesLines.push(
      `- 🧰 هم‌ترازی تجهیزات: ${report.equipmentSwaps.map((s) => `«${s.from}» → «${s.to}»`).join("، ")} — همهٔ حرکات دقیقاً با امکانات شما اجراشدنی‌اند.`
    );
  }
  if (report.equipmentRemoved.length > 0) {
    report.notesLines.push(`- 🧹 ${report.equipmentRemoved.length} حرکتِ بدون جایگزینِ سازگار حذف شد تا هیچ حرکتِ بی‌امکاناتی در برنامه نباشد.`);
  }
}

/**
 * applyPlanScientificGuards — اجرای هر سه گارد v261 روی برنامهٔ پارس‌شده.
 * skip: برای جلوگیری از اجرای دوبارهٔ گاردهای قبلی در پایپ‌لاین تولید
 * (بودجهٔ پا v259 و ترمیم بازو v260 همان‌جا اجرا شده‌اند).
 * v263-fix — «arm» به یونیون skip اضافه شد: پایپ‌لاین تولید (ai.ts و
 * program-generation.ts) ترمیم بازو را جداگانه قبل از این تابع اجرا می‌کند و
 * برای مستندسازی همان را skip می‌فرستد؛ حذف آن از تایپ → خطای TS2322 در build.
 */
export function applyPlanScientificGuards(
  parsed: { days?: Array<Record<string, any>>; notes?: string; title?: string; focus?: string; [k: string]: any } | null,
  ctx: PlanGuardContext,
  opts?: { skip?: Array<"core" | "cardio" | "equip" | "leg" | "injury" | "arm">; suppressLog?: boolean }
): PlanGuardReport {
  const report: PlanGuardReport = { coreAdded: [], cardioAdded: [], equipmentSwaps: [], equipmentRemoved: [], injurySwaps: [], injuryRemoved: [], notesLines: [] };
  if (!parsed || !Array.isArray(parsed.days) || parsed.days.length === 0) return report;
  const skip = new Set(opts?.skip ?? []);

  // ⓪ بودجهٔ روز پا (اگر پایپ‌لاین قبلاً اجرا نکرده)
  if (!skip.has("leg")) {
    const focusText = [String(parsed.title ?? ""), String(parsed.focus ?? "")].join(" ");
    const gluteFocused = /باسن|سرینی|گلوت|glute/i.test(focusText);
    if (!gluteFocused) {
      const legReport: LegDayBudgetReport = enforceLegDayBudget(parsed, {
        workoutDays: Math.round(Number(ctx.workoutDays) || parsed.days.length),
        bank: ctx.bank,
        forbiddenKeywords: ctx.forbiddenKeywords,
        blueprint: ctx.blueprint ?? null,
        prescribedBlueprint: null,
        redesignSpec: null,
        seed: ctx.seed,
      });
      report.legReport = legReport;
      if (!opts?.suppressLog && (legReport.replaced.length > 0 || legReport.titleRewrites.length > 0)) {
        console.warn(`[plan-scientific-guards v261] leg-day budget: kept=${legReport.keptLegDay ?? "—"} replaced=${legReport.replaced.length} titles=${legReport.titleRewrites.length}`);
      }
    }
  }

  if (!skip.has("core")) guardCore(parsed, ctx, report);
  if (!skip.has("cardio")) guardCardio(parsed, ctx, report);
  if (!skip.has("equip")) guardEquipment(parsed, ctx, report);
  // ④ آسیب‌محور — آخرین جارو (تعویض‌های گاردهای قبلی هم اینجا بازرسی می‌شوند)
  parsed_ = parsed;
  if (!skip.has("injury")) guardInjury(parsed, ctx, report);
  parsed_ = null;

  if (report.notesLines.length > 0) {
    parsed.notes = parsed.notes ? `${parsed.notes}\n${report.notesLines.join("\n")}` : report.notesLines.join("\n");
  }
  if (!opts?.suppressLog && (report.coreAdded.length || report.cardioAdded.length || report.equipmentSwaps.length || report.equipmentRemoved.length || report.injurySwaps.length || report.injuryRemoved.length)) {
    console.warn(
      `[plan-scientific-guards v261] core=${report.coreAdded.length} cardio=${report.cardioAdded.length} swaps=${report.equipmentSwaps.length} removed=${report.equipmentRemoved.length} injSwaps=${report.injurySwaps.length} injRemoved=${report.injuryRemoved.length}`
    );
  }
  return report;
}
