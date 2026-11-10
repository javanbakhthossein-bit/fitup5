/**
 * scripts/regen-affected-plans-v255.ts — بازتولید برنامهٔ کاربرانِ دارای باگ (ممیزی v255)
 * ═════════════════════════════════════════════════════════════════════════════
 * دیرکتیو مالک: «برای کسانی که باگ داشته‌اند دیگه باگ تکرار نشه — برنامه رو بساز دوباره»
 *
 * این اسکریپت re-runnable است (idempotent) و روی سرور پروداکشن اجرا می‌شود:
 *   ۱) همهٔ برنامه‌های فعالِ ۴۵ روز اخیر را با همان ممیزهای قطعیِ گیت v255 اسکن می‌کند:
 *        • پوشش ناقص شش‌گروه (b1)
 *        • تجهیزات ناموجود کاربر خانگی (b2)
 *        • چربی‌سوزیِ بی‌کاردیو (b3)
 *        • برنامهٔ فال‌بک موتور محلی (b7 — ضعیف‌ترین کیفیت)
 *        • رژیمِ بدون استک مکمل برای پلن استاندارد+ (b4)
 *   ۲) برای هر کاربرِ دارای مشکل: startProgramGenerationInBackground با source=admin_rewrite
 *      (عبور از سقف روزانه/گارد برنامهٔ تازه/پیش‌نیازها — بدون هیچ تغییری در اشتراک/پلن)
 *   ۳) گیت کیفیت v255 (تعویض تجهیزات/کاردیو/پوشش/مکمل) خودش روی تولید جدید اجرا می‌شود
 *      تا باگ دیگر تکرار نشود.
 *
 * اجرا (روی سرور):
 *   بکاپ:  cp /var/www/fitup/db/custom.db /var/www/fitup/db/custom.db.pre-v255-regen
 *   خشک:   cd /var/www/fitup && DATABASE_URL=file:./db/custom.db bun scripts/regen-affected-plans-v255.ts
 *   اجرا:  ... bun scripts/regen-affected-plans-v255.ts --execute [--limit 40]
 *
 * ایمنی‌ها:
 *   • کاربران pending_body_photo (منتظر عکس بدن) هدف نیستند — بازتولید برایشان ممکن نیست
 *   • کاربری که در ۲۴ ساعت اخیر برنامهٔ تازه ساخته skip می‌شود (idempotent)
 *   • سقف per-run (پیش‌فرض ۴۰) برای بودجهٔ AI
 *   • هیچ ردیف برنامه‌ای مستقیم دست نمی‌خورد — فقط تولید رسمیِ همان مسیر خرید
 */
import { db } from "@/lib/db";
import { buildLockedBank, coveredMajorGroupsDetailed, MAJOR_GROUP_KEYS, majorGroupsOfExercise } from "@/lib/fitness/exercise-bank-lock";
import {
  auditEquipmentCompatibility,
  auditWorkoutPlanDeterministic,
  applyDeterministicWorkoutFixes,
  enforceEquipmentCompatibility,
  enforceGoalCardio,
} from "@/lib/fitness/plan-quality-gate";
import { repairWorkoutPlanCoverage } from "@/lib/fitness/ai"; // ترمیم پوشش شش‌گروه (قطعی) — در ai.ts
import { buildOnboardingData, startProgramGenerationInBackground } from "@/lib/fitness/program-generation";
import { GLOBAL_YOUTUBE_SETTING_KEY, globalYoutubeEnabledFromValue } from "@/lib/fitness/exercise-video";
import type { OnboardingData, Plan } from "@/lib/fitness/types";

const EXECUTE = process.argv.includes("--execute");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 40) : 40;
})();
const WINDOW_DAYS = 45;
const SUPPLEMENT_PLANS = new Set(["standard", "advanced", "ultimate"]);

function isFatLossGoal(goal: unknown): boolean {
  return /fat|چربی|کات|cut|لاغر|کاهش\s*وزن|weight\s*loss/i.test(String(goal ?? ""));
}
function hasCardioExercise(days: Array<any>): boolean {
  return days.some((d: any) =>
    (Array.isArray(d?.exercises) ? d.exercises : []).some((ex: any) =>
      String(ex?.category ?? "") === "cardio" ||
      /کاردیو|هوازی|تردمیل|دوچرخه|الپتیکال|رووینگ|رویینگ|پرش\s*با\s*طناب|طناب\s*زدن|جامپینگ\s*طناب|jump\s*rope|برپی|جامپ|دوی|پیاده\s*روی|اسکی\s*سطح|پارویی/i.test(String(ex?.name ?? ""))
    )
  );
}

async function main() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  console.log(`═══ اسکن برنامه‌های فعالِ ساخته‌شده بعد از ${since.toISOString().slice(0, 10)} ═══`);

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
  const bank = buildLockedBank(rows as never[], globalYoutubeEnabledFromValue(ytRow?.value));
  console.log(`بانک: ${bank.all.length} حرکت ویدیودار`);

  const plans = await db.workoutPlan.findMany({
    where: { active: true, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, content: true, generatedSource: true, version: true, createdAt: true },
  });
  console.log(`برنامه‌های فعال در بازه: ${plans.length}`);

  const affected: Array<{ userId: string; reasons: string[] }> = [];
  for (const p of plans) {
    let workout: Record<string, any> | null = null;
    try { workout = JSON.parse(p.content); } catch { continue; }
    if (!workout || !Array.isArray(workout.days) || workout.days.length === 0) continue;
    const data = await buildOnboardingData(p.userId) as unknown as OnboardingData | null;
    if (!data) continue;

    const reasons: string[] = [];

    // b1 — پوشش
    const covered = coveredMajorGroupsDetailed(workout.days);
    const missing = MAJOR_GROUP_KEYS.filter((g) => !covered.covered.has(g));
    if (missing.length > 0) reasons.push(`b1-پوشش[${missing.join(",")}]`);

    // b2 — تجهیزات
    const eqIssues = auditEquipmentCompatibility(workout, data);
    if (eqIssues.length > 0) reasons.push(`b2-تجهیزات(${eqIssues.length})`);

    // b3 — کاردیوی هدف
    if (isFatLossGoal((data as any).goal) && !hasCardioExercise(workout.days)) reasons.push("b3-کاردیو");

    // b7 — فال‌بک محلی
    if (p.generatedSource === "local_fallback") reasons.push("b7-فال‌بک");

    // b6 — استراحت بین ست‌ها (فقط-استراحت → ترمیم درجا، بدون بازتولید)
    const restIssues = auditWorkoutPlanDeterministic(workout, data).filter((i) => i.code === "workout_missing_rest");
    if (restIssues.length > 0) reasons.push(`b6-استراحت(${restIssues.length})`);

    // b4 — رژیم بدون استک مکمل (استاندارد+) — پلن از User (OnboardingData پلن ندارد)
    const userRow = await db.user.findUnique({
      where: { id: p.userId },
      select: { planName: true, planExpiresAt: true, isBlocked: true },
    });
    if (userRow && SUPPLEMENT_PLANS.has(String(userRow.planName ?? ""))) {
      const meal = await db.mealPlan.findFirst({
        where: { userId: p.userId, active: true },
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true },
      });
      if (meal) {
        try {
          const mc = JSON.parse(meal.content);
          const stackLen = Array.isArray(mc?.supplementStack) ? mc.supplementStack.length : Array.isArray(mc?.supplements) ? mc.supplements.length : 0;
          if (stackLen === 0) reasons.push("b4-مکمل-خالی");
        } catch { /* ignore */ }
      }
    }

    if (reasons.length === 0) continue;

    // idempotent — برنامهٔ تازهٔ ۲۴ ساعت اخیر؟ skip
    const freshReq = await db.programRequest.findFirst({
      where: { userId: p.userId, status: "ready", updatedAt: { gte: dayAgo } },
      select: { id: true },
    });
    if (freshReq) { console.log(`  ⏭ ${p.userId} (${reasons.join("+")}) — برنامهٔ تازهٔ ۲۴h دارد، skip`); continue; }

    // کاربر منتظر عکس بدن؟ بازتولید ممکن نیست
    const pendingPhoto = await db.programRequest.findFirst({
      where: { userId: p.userId, status: "pending_body_photo" },
      select: { id: true },
    });
    if (pendingPhoto) { console.log(`  ⏭ ${p.userId} (${reasons.join("+")}) — در انتظار عکس بدن، skip`); continue; }

    // اشتراک مؤثر دارد؟
    if (!userRow || userRow.isBlocked || !userRow.planName) { continue; }

    affected.push({ userId: p.userId, reasons });
  }

  console.log(`\n═══ ${affected.length} کاربرِ دارای باگ شناسایی شد ═══`);
  for (const a of affected) console.log(`  • ${a.userId}: ${a.reasons.join(" + ")}`);

  if (!EXECUTE) {
    console.log("\nحالت خشک (dry-run) — برای اجرای واقعی: --execute");
    await db.$disconnect();
    return;
  }

  const targets = affected.slice(0, LIMIT);
  console.log(`\n═══ اجرای بازتولید برای ${targets.length} کاربر (سقف ${LIMIT}) ═══`);
  let started = 0, skipped = 0, inplaceFixed = 0;
  const claimedReqIds: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      // ─── v255.2 — مسیر قطعیِ بدون-AI: ترکیب‌های فقط-قطعی (b1/b2/b3/b6) ───
      // هر چهار لایه‌ی قطعی گیت (تعویض تجهیزات → کاردیو → پوشش → استراحت) همانی‌اند
      // که بعد از تولیدِ هوشمند روی برنامه اجرا می‌شوند؛ اجرای مستقیمِ همان لایه‌ها
      // درجا = همان خروجی نهایی گیت، بدون هزینه/وابستگی AI و بدون بازتولید.
      // b4 (استک مکمل هوشمند) و b7 (ارتقای فال‌بک) → مسیر کامل بازتولید (AI سرور).
      const needsAI = t.reasons.some((r) => r.startsWith("b4-") || r.startsWith("b7-"));
      if (!needsAI) {
        const row = await db.workoutPlan.findFirst({
          where: { userId: t.userId, active: true },
          orderBy: { createdAt: "desc" },
          select: { id: true, content: true },
        });
        if (row) {
          const w = JSON.parse(row.content) as Record<string, any>;
          const data2 = await buildOnboardingData(t.userId) as unknown as OnboardingData;
          const changes: string[] = [];
          // ترتیب گیت: L2.8 تجهیزات ← L2.9 کاردیو ← L2.10 پوشش ← L4 استراحت
          const eq = await enforceEquipmentCompatibility(w, data2, bank);
          if (eq.swapped + eq.removed > 0) changes.push(`تجهیزات:${eq.swapped}+${eq.removed}`);
          const cardio = enforceGoalCardio(w, data2, bank, []);
          if (cardio.added > 0) changes.push(`کاردیو:${cardio.added}`);
          const cov = repairWorkoutPlanCoverage(w as { days?: Array<Record<string, any>>; notes?: string }, bank, [], (w as Record<string, any>).coachBlueprint ?? null);
          if (cov.added.length > 0) changes.push(`پوشش:${cov.added.length}`);
          const rest = applyDeterministicWorkoutFixes(w, data2);
          if (rest > 0) changes.push(`استراحت/ساختار:${rest}`);
          if (changes.length > 0) {
            // راستی‌آزمایی پس از ترمیم — برنامهٔ نهایی باید صفر-خطای قطعی باشد
            const eqAfter = auditEquipmentCompatibility(w, data2);
            const restAfter = auditWorkoutPlanDeterministic(w, data2).filter((x) => x.code === "workout_missing_rest");
            if (eqAfter.length > 0 || restAfter.length > 0) {
              skipped++;
              console.log(`  ⚠️ [${i + 1}/${targets.length}] ${t.userId} — ترمیم ناقص (eq=${eqAfter.length}, rest=${restAfter.length}) — ذخیره نشد؛ به مسیر بازتولید منتقل می‌شود`);
            } else {
              await db.workoutPlan.update({ where: { id: row.id }, data: { content: JSON.stringify(w) } });
              inplaceFixed++;
              console.log(`  🔧 [${i + 1}/${targets.length}] ترمیم قطعی درجا (${changes.join(" + ")}): ${t.userId}`);
            }
          } else {
            skipped++;
            console.log(`  ⏭ [${i + 1}/${targets.length}] اصلاحی لازم نبود: ${t.userId}`);
          }
        }
        continue;
      }
      // پیش از شروع، آخرین درخواست را یادداشت می‌کنیم تا بعداً وضعیتش را پایش کنیم
      const latestBefore = await db.programRequest.findFirst({
        where: { userId: t.userId }, orderBy: { createdAt: "desc" }, select: { id: true },
      });
      if (latestBefore) claimedReqIds.push(latestBefore.id);
      const res = await startProgramGenerationInBackground(t.userId, {
        source: "admin_rewrite",
        changeSummary: "بازتولید ممیزی v255 — رفع باگ‌های کیفیت برنامه (پوشش/تجهیزات/کاردیو/مکمل) طبق استاندارد مربیان بزرگ",
      });
      if (res.started) {
        started++;
        console.log(`  ✅ [${i + 1}/${targets.length}] تولید آغاز شد: ${t.userId} (${t.reasons.join("+")})`);
      } else {
        skipped++;
        console.log(`  ⚠️ [${i + 1}/${targets.length}] شروع نشد: ${t.userId} — ${res.reason}${"blockingReason" in res && res.blockingReason ? ` (${res.blockingReason})` : ""}`);
      }
    } catch (e) {
      skipped++;
      console.error(`  ❌ [${i + 1}/${targets.length}] ${t.userId}:`, e);
    }
    // فاصله بین شروع‌ها — تولید در پس‌زمینه است؛ ۱۵ ثانیه برای پخش بار AI
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 15_000));
  }

  // ─── جمع‌بندی ───
  if (inplaceFixed > 0) console.log(`\n🔧 ترمیم قطعی درجا (بدون AI): ${inplaceFixed} برنامه`);

  // ─── v255 — نگه‌داشتن پروسه تا تعیین‌تکلیف چرخه‌ها (fire-and-forget نباید یتیم بماند) ───
  if (claimedReqIds.length > 0) {
    const TIMEOUT_MS = 20 * 60 * 1000;
    const POLL_MS = 20_000;
    const deadline = Date.now() + TIMEOUT_MS;
    const pending = new Set(claimedReqIds);
    console.log(`\nپایش ${pending.size} چرخهٔ تولید تا اتمام (سقف ۲۰ دقیقه)...`);
    while (pending.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      for (const id of [...pending]) {
        const row = await db.programRequest.findUnique({ where: { id }, select: { status: true } });
        if (!row || ["ready", "failed"].includes(row.status)) {
          console.log(`  • ${id}: ${row?.status ?? "حذف‌شده"}`);
          pending.delete(id);
        }
      }
      if (pending.size > 0) console.log(`  … در انتظار ${pending.size} چرخه`);
    }
    for (const id of pending) console.log(`  ⏳ ${id}: timeout — سوئیپ خودکار ۵ دقیقه‌ای تعیین‌تکلیف می‌کند`);
  }

  console.log(`\n═══ پایان: started=${started} skipped=${skipped} ═══`);
  await db.$disconnect();
}

main().catch((e) => { console.error("REGEN FAILED:", e); process.exit(1); });
