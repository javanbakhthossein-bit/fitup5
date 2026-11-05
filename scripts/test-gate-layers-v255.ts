/**
 * scripts/test-gate-layers-v255.ts — راستی‌آزمایی لایه‌های v255 گیت کیفیت
 * لایه‌های جدید (b1/b2/b3) را روی برنامه‌های واقعیِ پرچم‌دارِ ممیزی اجرا می‌کند:
 *   • تعویض تجهیزات (کاربر خانگی با حرکت باشگاهی)
 *   • تزریق کاردیوی هدف (چربی‌سوزیِ بی‌کاردیو)
 *   • ترمیم پوشش شش‌گروه (با کلاسیفایر اصلاح‌شدهٔ «مرکز بدن»)
 * فقط خواندنی روی DB — برنامه‌ها در حافظه تغییر می‌کنند و ذخیره نمی‌شوند.
 * اجرا: DATABASE_URL=file:./db/custom.db bun scripts/test-gate-layers-v255.ts
 */
import { db } from "@/lib/db";
import { buildLockedBank, coveredMajorGroupsDetailed, MAJOR_GROUP_KEYS } from "@/lib/fitness/exercise-bank-lock";
import {
  auditEquipmentCompatibility,
  enforceEquipmentCompatibility,
  enforceGoalCardio,
  auditWorkoutPlanDeterministic,
} from "@/lib/fitness/plan-quality-gate";
import { repairWorkoutPlanCoverage } from "@/lib/fitness/ai";
import { GLOBAL_YOUTUBE_SETTING_KEY, globalYoutubeEnabledFromValue } from "@/lib/fitness/exercise-video";
import { buildOnboardingData } from "@/lib/fitness/program-generation";
import type { OnboardingData } from "@/lib/fitness/types";

async function loadBank() {
  const [rows, ytRow] = await Promise.all([
    db.exerciseLibrary.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, muscle: true, category: true, equipment: true,
        description: true, tips: true,
        videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true,
      },
    }),
    db.siteSetting.findUnique({ where: { key: GLOBAL_YOUTUBE_SETTING_KEY }, select: { value: true } }),
  ]);
  return buildLockedBank(rows as never[], globalYoutubeEnabledFromValue(ytRow?.value));
}

async function main() {
  const bank = await loadBank();
  console.log(`bank loaded: ${bank.all.length} rows`);

  const cases: Array<{ mobile: string; expect: string }> = [
    { mobile: "09046810715", expect: "b2 تجهیزات: خانگی (bodyweight+بارفیکس) با سیم‌کش/هالتر در برنامه" },
    { mobile: "09191498196", expect: "b1 پوشش: سرشانه گم‌شده" },
    { mobile: "09354881772", expect: "b1 پوشش: core «مرکز بدن» — با فیکس کلاسیفایر باید پوشیده شود" },
    { mobile: "09373012136", expect: "b3 کاردیو: چربی‌سوزی بدون کاردیو" },
    { mobile: "09128360256", expect: "b3 کاردیو: چربی‌سوزی بدون کاردیو (۲)" },
  ];

  for (const c of cases) {
    const u = await db.user.findFirst({ where: { mobile: c.mobile }, select: { id: true } });
    if (!u) { console.log(`\n### ${c.mobile}: کاربر یافت نشد`); continue; }
    const wp = await db.workoutPlan.findFirst({
      where: { userId: u.id, active: true }, orderBy: { createdAt: "desc" },
    });
    if (!wp) { console.log(`\n### ${c.mobile}: برنامهٔ فعال ندارد`); continue; }
    const data = await buildOnboardingData(u.id) as unknown as OnboardingData;
    const workout = JSON.parse(wp.content) as Record<string, any>;

    console.log(`\n### ${c.mobile} — انتظار: ${c.expect}`);
    console.log(`    place=${(data as any).workoutPlace} equipment=${JSON.stringify((data as any).equipment)} goal=${(data as any).goal} days=${workout?.days?.length}`);

    // ۱) ممیزی تجهیزات (قبل از تعویض)
    const eqIssues = auditEquipmentCompatibility(workout, data);
    console.log(`    [b2] auditEquipment: ${eqIssues.length} نقض`);
    for (const i of eqIssues.slice(0, 5)) console.log(`        - ${i.message.slice(0, 100)}`);

    // ۲) تعویض قطعی تجهیزات
    const eqReport = await enforceEquipmentCompatibility(workout, data, bank);
    console.log(`    [b2] enforce: swapped=${eqReport.swapped} removed=${eqReport.removed}`);
    for (const d of eqReport.details.slice(0, 5)) console.log(`        - ${d.slice(0, 110)}`);

    // ۳) کاردیوی هدف
    const cardio = enforceGoalCardio(workout, data, bank, []);
    console.log(`    [b3] cardio injected: ${cardio.added}`);
    for (const d of cardio.details) console.log(`        - ${d.slice(0, 110)}`);

    // ۴) پوشش بعد از فیکس کلاسیفایر + ترمیم
    const covered = coveredMajorGroupsDetailed(workout.days);
    const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.covered.has(g));
    console.log(`    [b1] پوشش قبل ترمیم: missing=[${missing.join(",")}]`);
    const cov = repairWorkoutPlanCoverage(workout as never, bank, [], (workout as any).coachBlueprint ?? null);
    console.log(`    [b1] coverage repair: added=${cov.added.length} → ${cov.added.map((a) => `${a.group}:${a.name}`).join(" | ") || "—"}`);
    const covered2 = coveredMajorGroupsDetailed(workout.days);
    const missing2 = MAJOR_GROUP_KEYS.filter((g) => !covered2.covered.has(g));
    console.log(`    [b1] پوشش بعد ترمیم: missing=[${missing2.join(",")}]`);

    // ۵) ممیزی قطعی کامل — نباید دیگر تجهیزات/پوشش critical بماند
    const finalIssues = auditWorkoutPlanDeterministic(workout, data);
    const finalEq = auditEquipmentCompatibility(workout, data);
    const criticals = finalIssues.filter((i) => i.severity === "critical");
    console.log(`    [نهایی] criticals=${criticals.length} | equipment=${finalEq.length}`);
    for (const i of criticals.slice(0, 4)) console.log(`        - [${i.code}] ${i.message.slice(0, 100)}`);
  }

  await db.$disconnect();
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
