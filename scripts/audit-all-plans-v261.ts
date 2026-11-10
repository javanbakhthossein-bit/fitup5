// audit-all-plans-v261.ts — ممیزی ریزبه‌ریز همهٔ برنامه‌های فعال کاربران (v261)
// دیرکتیو مالک: «همه برنامه‌ها درست باشند — تمام عضلات حتی مچ و ساعد — بدون ۲-۳ روز پا»
import { db } from "@/lib/db";
import { coveredMajorGroupsDetailed, MAJOR_GROUP_KEYS } from "@/lib/fitness/exercise-bank-lock";
import {
  isDesignatedLegDayByExercises,
  countLegPrimaryExercises,
} from "@/lib/fitness/coach-blueprint";
import { writeFileSync } from "fs";
import { buildLockedBank, type BankExerciseRow } from "@/lib/fitness/exercise-bank-lock";
import { db as dbx } from "@/lib/db";

// نیازمندی تجهیزات یک حرکت — اول بانکِ قفل (منبع حقیقت، مثل گارد)، فال‌بک نام
let BANK_EQ: Map<string, string> | null = null;
async function initBankEq(): Promise<void> {
  const rows = await dbx.exerciseLibrary.findMany({ where: { isActive: true }, select: { id: true, equipment: true } });
  BANK_EQ = new Map(rows.map((r) => [r.id, r.equipment]));
}
function eqNeed(ex: { name?: string; exerciseId?: string }): string[] {
  const id = String(ex.exerciseId ?? "");
  const eqRaw = BANK_EQ?.get(id);
  if (eqRaw !== undefined) {
    const keys = String(eqRaw).split(/[,،]/).map((s) => s.trim().toLowerCase().replace(/[\s\-]/g, "")).filter(Boolean).filter((k) => k !== "bodyweight");
    const mapped = keys.map((k) => (k === "pullupbar" ? "pullup_bar" : k));
    if (eqRaw.trim()) return mapped.length ? mapped : [];
    return [];
  }
  const name = String(ex.name ?? "");
  const need: string[] = [];
  if (/هالتر/.test(name) && !/دستگاه|سیم/.test(name)) need.push("barbell");
  if (/دمبل/.test(name)) need.push("dumbbell");
  if (/کش\s*مقاومتی|کش\s*ورزشی/.test(name)) need.push("bands");
  if (/بارفیکس|آویزان\s*شدن|پاروئی/.test(name)) need.push("pullup_bar");
  if (/طناب/.test(name)) need.push("jump_rope");
  if (/کِتل|کتلبل|kettle/i.test(name)) need.push("kettlebell");
  if (/TRX|ت‌آر‌ایکس/i.test(name)) need.push("trx");
  return need;
}

type Issue = { code: string; severity: "critical" | "warn"; detail: string };

const fa = (n: number | string) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
const FOREARM_RE = /ساعد|مچ\s*دست|مچ\s*و\s*ساعد|دستبند/i;

// قواعد از منبع واحد حقیقت — plan-scientific-guards
import { INJURY_RULES } from "@/lib/fitness/plan-scientific-guards";

async function main() {
  await initBankEq();
  const users = await db.user.findMany({
    where: { mobile: { not: { startsWith: "099991000" } } },
    select: { id: true, name: true, mobile: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  console.log(`کاربران واقعی: ${users.length}`);

  const reportLines: string[] = [];
  let audited = 0, withPlan = 0, criticalUsers = 0, warnUsers = 0;
  const issueCounts = new Map<string, number>();
  const perUserIssues: { name: string; mobile: string; issues: Issue[] }[] = [];

  for (const u of users) {
    const profile = await db.onboardingProfile.findUnique({ where: { userId: u.id } });
    const plan = await db.workoutPlan.findFirst({ where: { userId: u.id, active: true }, orderBy: { createdAt: "desc" } });
    if (!plan || !profile) continue;
    withPlan++;
    const issues: Issue[] = [];
    const push = (code: string, severity: "critical" | "warn", detail: string) => { issues.push({ code, severity, detail }); issueCounts.set(code, (issueCounts.get(code) ?? 0) + 1); };

    audited++;
    if (plan.generatedSource === "local_fallback") push("local_fallback", "critical", "برنامه با موتور محلی ساخته شده (AI شکست)");
    if ((plan.changeSummary ?? "").includes("موتور محلی")) push("local_fallback_summary", "critical", "خلاصهٔ تغییرات اعلام موتور محلی");

    let content: any = null;
    try { content = JSON.parse(plan.content); } catch { push("unparsable", "critical", "JSON پارس نشد"); }
    const days: any[] = Array.isArray(content?.days) ? content.days : [];
    const reqDays = profile.workoutDays ?? 0;
    if (days.length !== reqDays && days.length > 0) push("days_mismatch", "critical", `پروفایل ${fa(reqDays)} روز، برنامه ${fa(days.length)} روز`);

    // بودجهٔ روز پا (الگوی بزرگان — حداکثر یک روز اختصاصی پا در برنامهٔ هفتگی عادی)
    let legDays = 0;
    const focusText = [content?.focus ?? "", content?.title ?? ""].join(" ");
    const gluteFocused = /باسن|سرینی|گلوت|glute/i.test(focusText);
    for (const d of days) {
      // معیار رسمی v259: عنوانِ روز + شمار حرکات پا-اصلی (همان کلاسیفایر گارد)
      const byEx = isDesignatedLegDayByExercises({ title: String(d.title ?? ""), exercises: d.exercises ?? [] });
      if (byEx) legDays++;
    }
    if (legDays > 1 && !gluteFocused) push("leg_day_budget", "critical", `${fa(legDays)} روز اختصاصی پا در برنامهٔ ${fa(days.length)} روزه`);

    // پوشش گروه‌های بزرگ
    const cov = coveredMajorGroupsDetailed(days);
    const missing = MAJOR_GROUP_KEYS.filter((g) => !cov.covered.has(g));
    if (missing.length > 0 && !cov.isGenuineFullbodySplit) push("coverage_missing", "critical", `پوشش‌نایافته: ${missing.join("، ")}`);

    // ساعد و مچ (دیرکتیو: «حتی مچ و ساعد باید درگیر بشن»)
    let forearmHit = 0;
    for (const d of days) for (const ex of d.exercises ?? []) { if (FOREARM_RE.test(String(ex.muscle ?? "")) || FOREARM_RE.test(String(ex.name ?? ""))) forearmHit++; }
    const reqPlace = profile.workoutPlace;
    const canForearm = reqPlace !== "home" || (JSON.parse(profile.equipment || "[]")).some((e: string) => ["dumbbell", "barbell", "machine", "cable"].includes(e));
    if (forearmHit === 0 && canForearm && days.length >= 3) push("no_forearm", "warn", `صفر تمرین ساعد/مچ در هفته (${fa(days.length)} روزه)`);

    // آسیب‌ها
    const injText = `${profile.injuries ?? ""} ${profile.diseases ?? ""}`.toLowerCase();
    const injKeys = new Set<string>();
    if (/زانو|زانوها/.test(injText)) injKeys.add("knee");
    if (/کمر|دیست|لومبار|ل۴|ل5/.test(injText)) injKeys.add("lower_back");
    if (/شانه|روتاتور|imping/i.test(injText)) injKeys.add("shoulder");
    if (/مچ\s*دست|مچ\s*دست‌ها/.test(injText)) injKeys.add("wrist");
    const bmi = profile.weight / Math.pow(profile.height / 100, 2);
    if (bmi >= 30) injKeys.add("knee"); // پرش ممنوع برای BMI بالا
    for (const d of days) for (const ex of d.exercises ?? []) {
      const name = String(ex.name ?? "");
      for (const rule of INJURY_RULES) {
        if (!injKeys.has(rule.key)) continue;
        if (rule.allow && rule.allow.test(name)) continue;
        if (rule.patterns.some((p) => p.test(name))) push("injury_violation", "critical", `«${name}» (${d.day}) با آسیب ${rule.label} ناسازگار`);
      }
    }
    if (bmi >= 30) {
      for (const d of days) for (const ex of d.exercises ?? []) { if (/پرش|جامپ|jump/i.test(String(ex.name ?? ""))) push("injury_violation", "critical", `«${ex.name}» (${d.day}) با BMI ${bmi.toFixed(1)} پرش خطرناک`); }
    }

    // کاردیو برای چربی‌سوزی/استقامت
    if (profile.goal === "fat_loss" || profile.goal === "endurance") {
      let cardio = 0;
      for (const d of days) { cardio += Array.isArray(d.cardio) ? d.cardio.length : 0; for (const ex of d.exercises ?? []) { if (String(ex.category ?? "") === "cardio" || /کاردیو|هوازی|تردمیل|دوچرخه|الپتیکال|طناب|برپی|جامپ\s*جک|دوی|پیاده/i.test(String(ex.name ?? ""))) cardio++; } }
      if (cardio < 2) push("goal_no_cardio", "critical", `هدف ${profile.goal} ولی فقط ${fa(cardio)} کاردیو`);
    }

    // تجهیزات خانگی
    if (reqPlace === "home") {
      const eq: string[] = (() => { try { return JSON.parse(profile.equipment || "[]"); } catch { return []; } })();
      for (const d of days) for (const ex of d.exercises ?? []) {
        const need = eqNeed({ name: String(ex.name ?? ""), exerciseId: String(ex.exerciseId ?? "") }).filter((n) => !eq.includes(n));
        if (need.length) push("equipment_mismatch", "critical", `«${ex.name}» (${d.day}) نیازمند ${need.join("+")} — کاربر خانگی ندارد`);
      }
    }

    // ساختار
    let totalEx = 0, empty = 0, emptyDay = 0;
    for (const d of days) {
      if (!Array.isArray(d.exercises) || d.exercises.length === 0) { emptyDay++; continue; }
      for (const ex of d.exercises ?? []) { totalEx++; if (!String(ex.name ?? "").trim()) empty++; }
    }
    if (emptyDay > 0) push("empty_day", "critical", `${fa(emptyDay)} روز خالی`);
    if (empty > 0) push("empty_ex_name", "critical", `${fa(empty)} حرکت بی‌نام`);

    const meal = await db.mealPlan.findFirst({ where: { userId: u.id, active: true }, orderBy: { createdAt: "desc" } });
    if (!meal) push("no_meal", "critical", "برنامهٔ غذایی فعال ندارد");

    if (issues.length) {
      perUserIssues.push({ name: u.name ?? u.mobile, mobile: u.mobile, issues });
      if (issues.some((i) => i.severity === "critical")) criticalUsers++; else warnUsers++;
      const line = `● ${u.name ?? "-"} (${u.mobile}) — برنامهٔ ${fa(days.length)} روزه v${plan.version} [${plan.generatedSource ?? "?"}] روز پا: ${fa(legDays)} ساعد/مچ: ${fa(forearmHit)}\n` + issues.map((i) => `   ${i.severity === "critical" ? "🔴" : "🟡"} ${i.code}: ${i.detail}`).join("\n");
      reportLines.push(line);
    }
  }

  const summary = `═══ گزارش ممیزی v261 — ${new Date().toISOString()} ═══
کاربران واقعی: ${fa(users.length)} | دارای برنامهٔ فعال: ${fa(withPlan)} | ممیزی‌شده: ${fa(audited)}
🔴 کاربران با ایراد بحرانی: ${fa(criticalUsers)} | 🟡 فقط هشدار: ${fa(warnUsers)} | ✅ سالم: ${fa(audited - criticalUsers - warnUsers)}

توزیع ایرادها:
${[...issueCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  هیچ ایرادی"}

${reportLines.join("\n")}`;
  writeFileSync("/home/z/my-project/download/گزارش-ممیزی-برنامه‌ها-v261.txt", summary, "utf8");
  console.log(summary.slice(0, 5000));
}

main().catch((e) => { console.error(e); process.exit(1); });
