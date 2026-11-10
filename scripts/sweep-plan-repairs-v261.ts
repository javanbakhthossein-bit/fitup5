// sweep-plan-repairs-v261.ts — جاروی بازآرایی علمی همهٔ برنامه‌های فعال (v261)
// ═══════════════════════════════════════════════════════════════════════════
// دیرکتیو مالک: «چند تا برنامه کاربرهای مختلفی که تولید شده رو نگاه کن
// همگی باید درست بشن» — ۶۸ برنامهٔ فعال ۲+ روز پا دارند (قبل از گارد v259)،
// ۷۵ برنامه ساعد ندارند، ۶ تضاد تجهیزات، ۴ بدون core، ۱۲ بدون کاردیو هدف.
//
// این جارو همان گاردهای علمی v261 را روی همهٔ برنامه‌های فعال اجرا می‌کند:
//   • بودجهٔ روز پا (v259) + ترمیم بازو/ساعد (v260) + گاردهای v261
//     (core / کاردیو هدف‌محور / هم‌ترازی تجهیزات)
// • نسخهٔ اصلاحی جدید می‌سازد (تاریخچهٔ نسخه‌ها سالم می‌ماند) و نسخهٔ
//   قبلی را supersede می‌کند — دقیقاً با معناشناسی نسخه‌بندی v111.
//
// اجرا: DATABASE_URL=file:... bun scripts/sweep-plan-repairs-v261.ts [--dry]
// ═══════════════════════════════════════════════════════════════════════════
import { db } from "@/lib/db";
import {
  buildLockedBank,
  type BankExerciseRow,
} from "@/lib/fitness/exercise-bank-lock";
import { repairWorkoutPlanArmSubmuscles } from "@/lib/fitness/ai";
import { applyPlanScientificGuards } from "@/lib/fitness/plan-scientific-guards";
import { GLOBAL_YOUTUBE_SETTING_KEY, globalYoutubeEnabledFromValue } from "@/lib/fitness/exercise-video";
import { writeFileSync } from "fs";

const DRY = process.argv.includes("--dry");

function normEqKey(s: string): string {
  const n = String(s ?? "").toLowerCase().replace(/[\s\-_\u200c]/g, "");
  if (n === "pullupbar" || n === "pullup") return "pullup_bar";
  return n;
}

async function main() {
  console.log("── v261 sweep: بازآرایی علمی برنامه‌های فعال ──");
  const [rows, ytRow] = await Promise.all([
    db.exerciseLibrary.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, muscle: true, category: true, equipment: true,
        description: true, tips: true, videoUrl: true, videoPosterUrl: true,
        youtubeUrl: true, youtubeEnabled: true,
      },
    }),
    db.siteSetting.findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } }),
  ]);
  const bank = buildLockedBank(rows as unknown as BankExerciseRow[], globalYoutubeEnabledFromValue(ytRow?.value));
  console.log(`بانک قفل: ${bank.all.length} حرکت`);

  const profiles = await db.onboardingProfile.findMany({
    where: { user: { mobile: { not: { startsWith: "099991000" } } } },
    include: { user: { select: { id: true, name: true, mobile: true } } },
  });
  console.log(`پروفایل‌های واقعی: ${profiles.length}`);

  let repaired = 0, untouched = 0, failed = 0;
  const log: string[] = [];

  for (const prof of profiles) {
    const plan = await db.workoutPlan.findFirst({ where: { userId: prof.userId, active: true }, orderBy: { createdAt: "desc" } });
    if (!plan) continue;
    let parsed: any;
    try { parsed = JSON.parse(plan.content); } catch { log.push(`⚠️ ${prof.user.mobile}: JSON پارس نشد — رد شد`); failed++; continue; }
    if (!Array.isArray(parsed?.days) || parsed.days.length === 0) { untouched++; continue; }

    const before = JSON.stringify(parsed.days.length) + ":" + parsed.days.map((d: any) => (d.exercises ?? []).length).join(",");
    const bmi = prof.weight / Math.pow(prof.height / 100, 2);

    // ① بودجهٔ روز پا + ② بازو/ساعد + ③ گاردهای علمی v261
    const armReport = repairWorkoutPlanArmSubmuscles(parsed, bank, undefined, null);
    const injText = `${prof.injuries ?? ""} ${prof.diseases ?? ""}`;
    const injuryKeys = (() => {
      const keys = new Set<string>();
      if (/زانو/.test(injText)) keys.add("knee");
      if (/کمر|دیست|لومبار/.test(injText)) keys.add("lower_back");
      if (/شانه|روتاتور|imping/i.test(injText)) keys.add("shoulder");
      if (/مچ\s*دست/.test(injText)) keys.add("wrist");
      if (bmi >= 30) keys.add("knee"); // پرش ممنوع
      return [...keys];
    })();
    const guardReport = applyPlanScientificGuards(parsed, {
      bank,
      place: String(prof.workoutPlace ?? "gym"),
      equipment: (() => { try { return JSON.parse(prof.equipment || "[]"); } catch { return []; } })(),
      goal: String(prof.goal ?? ""),
      bmi,
      workoutDays: prof.workoutDays || parsed.days.length,
      injuryKeys,
      seed: 261,
    }, { skip: [] });

    const after = JSON.stringify(parsed.days.length) + ":" + parsed.days.map((d: any) => (d.exercises ?? []).length).join(",");
    const legChanged = !!(guardReport.legReport && (guardReport.legReport.replaced.length > 0 || guardReport.legReport.titleRewrites.length > 0 || guardReport.legReport.removedWithoutReplacement.length > 0));
    const changed = before !== after || legChanged || armReport.added.length > 0 || guardReport.coreAdded.length > 0 || guardReport.cardioAdded.length > 0 || guardReport.equipmentSwaps.length > 0 || guardReport.equipmentRemoved.length > 0 || guardReport.injurySwaps.length > 0 || guardReport.injuryRemoved.length > 0;

    if (!changed) { untouched++; continue; }
    if (DRY) {
      log.push(`● ${prof.user.name ?? "-"} (${prof.user.mobile}) — DRY: arm=${armReport.added.length} core=${guardReport.coreAdded.length} cardio=${guardReport.cardioAdded.length} swaps=${guardReport.equipmentSwaps.length} removed=${guardReport.equipmentRemoved.length}`);
      repaired++;
      continue;
    }

    try {
      const newVersion = plan.version + 1;
      const summaryParts: string[] = [];
      if (legChanged && guardReport.legReport) summaryParts.push(`بودجهٔ روز پا (نگه‌داشته: ${guardReport.legReport.keptLegDay ?? "—"}، تعویض: ${guardReport.legReport.replaced.length})`);
      if (guardReport.equipmentSwaps.length > 0) summaryParts.push(`هم‌ترازی تجهیزات (${guardReport.equipmentSwaps.length} تعویض)`);
      if (guardReport.coreAdded.length > 0) summaryParts.push(`تکمیل پوشش مرکزی (${guardReport.coreAdded.length})`);
      if (guardReport.cardioAdded.length > 0) summaryParts.push(`کاردیو هدف‌محور (${guardReport.cardioAdded.length})`);
      if (guardReport.injurySwaps.length > 0) summaryParts.push(`ایمن‌سازی آسیب (${guardReport.injurySwaps.length} تعویض)`);
      if (guardReport.injuryRemoved.length > 0) summaryParts.push(`حذف حرکتِ ناسازگار با آسیب (${guardReport.injuryRemoved.length})`);
      if (armReport.added.length > 0) summaryParts.push(`تکمیل بازو/ساعد (${armReport.added.length})`);
      if (guardReport.equipmentRemoved.length > 0) summaryParts.push(`حذف حرکات بی‌امکانات (${guardReport.equipmentRemoved.length})`);
      const changeSummary = `بازآرایی علمی v۲۶۱: ${summaryParts.join(" + ") || "بهینه‌سازی"}`;

      const newPlan = await db.workoutPlan.create({
        data: {
          userId: prof.userId,
          weekIndex: plan.weekIndex,
          content: JSON.stringify(parsed),
          active: true,
          baseWeight: plan.baseWeight,
          version: newVersion,
          generatedSource: "repair_v261",
          changeSummary,
        },
      });
      await db.workoutPlan.update({
        where: { id: plan.id },
        data: { active: false, supersededAt: new Date(), supersededById: newPlan.id },
      });
      log.push(`✅ ${prof.user.name ?? "-"} (${prof.user.mobile}) — v${newVersion}: arm=${armReport.added.length} core=${guardReport.coreAdded.length} cardio=${guardReport.cardioAdded.length} swaps=${guardReport.equipmentSwaps.length} removed=${guardReport.equipmentRemoved.length} injSwaps=${guardReport.injurySwaps.length} injRemoved=${guardReport.injuryRemoved.length}`);
      repaired++;
    } catch (err) {
      failed++;
      log.push(`❌ ${prof.user.mobile}: ${String((err as Error)?.message || err).slice(0, 150)}`);
    }
  }

  const summary = `═══ جاروی بازآرایی v261 (${DRY ? "DRY" : "اجرا شده"}) — ${new Date().toISOString()} ═══
اصلاح‌شده: ${repaired} | دست‌نخورده: ${untouched} | خطا: ${failed}

${log.join("\n")}`;
  writeFileSync("/home/z/my-project/download/گزارش-جاروی-بازآرایی-v261.txt", summary, "utf8");
  console.log(summary.slice(0, 3000));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
