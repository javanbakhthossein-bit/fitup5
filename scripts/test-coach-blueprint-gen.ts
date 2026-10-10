/**
 * scripts/test-coach-blueprint-gen.ts — راستی‌آزمایی v213 «معمار برنامه»
 * تولید واقعی برنامه با AvalAI برای ۴ پروفایل متمایز + ممیزی چندلایه خروجی.
 * اجرا: bun run scripts/test-coach-blueprint-gen.ts [A|B|C|D|ALL]
 */
import { generateWorkoutPlan } from "@/lib/fitness/ai";
import type { OnboardingData } from "@/lib/fitness/types";
import { majorGroupsOfExercise } from "@/lib/fitness/exercise-bank-lock";
import { MAJOR_GROUP_LABELS_FA } from "@/lib/fitness/exercise-bank-lock";
import * as fs from "node:fs";

const base: OnboardingData = {
  gender: "male",
  age: 28,
  height: 178,
  weight: 84,
  goal: "muscle_gain",
  activityLevel: "moderate",
  workoutDays: 4,
  workoutDaysList: ["شنبه", "یکشنبه", "سه‌شنبه", "چهارشنبه"],
  workoutPlace: "gym",
  equipment: ["barbell", "dumbbell", "machine", "cable", "bench", "pullup_bar"],
  diseases: "",
  injuries: "",
  allergies: "",
  dietType: "regular",
} as unknown as OnboardingData;

// A — «کاربر پس‌گیر» (پروفایل واقعی تیکت استرداد): ۴ روز، پیشرفته، کات، فیزیک آقایان، کمردرد
const profileA: OnboardingData = {
  ...base,
  firstName: "کامران",
  lastName: "تست‌A",
  goal: "cut",
  workoutDays: 4,
  trainingExperience: "advanced",
  discipline: "mens_physique",
  injuries: "مشکل کمردرد",
  sleepHours: 7,
  stressLevel: 2,
} as unknown as OnboardingData;

// B — بدنساز ۶ روزه پیشرفته، هدف حجم، سرشانهٔ ضعیف (از آنالیز بدن) — باید اسپلیت عضله‌محور/روز ضعف بگیرد
const profileB: OnboardingData = {
  ...base,
  firstName: "بهنام",
  lastName: "تست‌B",
  age: 26,
  goal: "bulk",
  workoutDays: 6,
  workoutDaysList: ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه"],
  trainingExperience: "advanced",
  discipline: "bodybuilding",
  sleepHours: 8,
  stressLevel: 2,
} as unknown as OnboardingData;

// C — خانم ۵ روزه متوسط، فیتنس، چربی‌سوزی
const profileC: OnboardingData = {
  ...base,
  firstName: "سارا",
  lastName: "تست‌C",
  gender: "female",
  age: 31,
  height: 165,
  weight: 68,
  goal: "fat_loss",
  workoutDays: 5,
  workoutDaysList: ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه"],
  trainingExperience: "intermediate",
  discipline: "fitness",
  sleepHours: 7,
  stressLevel: 3,
} as unknown as OnboardingData;

// D — مبتدی ۳ روزه خانه با دمبل، خواب کم (ریکاوری محدود) — باید فول‌بادی/UL بگیرد نه اسپلیت عضله‌محور
const profileD: OnboardingData = {
  ...base,
  firstName: "داوود",
  lastName: "تست‌D",
  age: 41,
  weight: 92,
  goal: "muscle_gain",
  workoutDays: 3,
  workoutDaysList: ["شنبه", "دوشنبه", "چهارشنبه"],
  workoutPlace: "home",
  equipment: ["dumbbell", "resistance_band", "bench"],
  trainingExperience: "beginner",
  sleepHours: 6,
  stressLevel: 4,
} as unknown as OnboardingData;

const PROFILES: Record<string, { data: OnboardingData; weakPoints?: string[] }> = {
  A: { data: profileA, weakPoints: [] },
  B: { data: profileB, weakPoints: ["سرشانه‌های ضعیف و عقب‌مانده نسبت به تنه"] },
  C: { data: profileC, weakPoints: ["باسن ضعیف"] },
  D: { data: profileD, weakPoints: [] },
};

function groupOf(ex: any): string[] {
  const g = majorGroupsOfExercise(ex);
  return [...g];
}

function audit(label: string, plan: any) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`برنامهٔ ${label}`);
  console.log("═".repeat(72));
  const bp = plan.coachBlueprint as any;
  console.log(`معمار: ${bp?.splitLabelFa ?? "(ندارد!)"} | مربی: ${bp?.coachModelFa ?? "?"} | key=${plan.inspiredByCoach} | دوره‌بندی=${plan.periodizationType}`);
  if (bp?.fst7) console.log(`FST-7: ${bp.fst7?.muscle} — ${bp.fst7?.note?.slice(0, 80)}`);
  const days: any[] = plan.days ?? [];
  const weeklySets = new Map<string, number>();
  for (const d of days) {
    const exs: any[] = d.exercises ?? [];
    const groups = new Set<string>();
    const bpDay = bp?.days?.[days.indexOf(d)];
    // گروه‌های اصلی/مجازِ این روز را از خودِ اسنپ‌شات معماری می‌سازیم (یک حقیقت)
    const primaryGroups = (bpDay?.primary ?? []).map((m: string) => groupOf({ muscle: m })[0]).filter(Boolean);
    const allowedGroups = [...new Set([...(bpDay?.primary ?? []), ...(bpDay?.secondary ?? [])].map((m: string) => groupOf({ muscle: m })[0]).filter(Boolean))];
    for (const ex of exs) {
      const gs = groupOf(ex);
      for (const g of gs) {
        groups.add(g);
        weeklySets.set(g, (weeklySets.get(g) ?? 0) + (Array.isArray(ex.sets) ? ex.sets.length : 0));
      }
    }
    const inAllowed = exs.filter((ex) => {
      const gs = groupOf(ex);
      return gs.length >= 5 || gs.some((g) => allowedGroups.includes(g));
    }).length;
    const primaryHits = exs.filter((ex) => {
      const gs = groupOf(ex);
      return gs.some((g) => primaryGroups.includes(g));
    }).length;
    const identity = exs.length ? Math.round((100 * inAllowed) / exs.length) : 0;
    console.log(`  ${d.day} «${d.title}» [${exs.length}ح] | ${[...groups].map((g) => MAJOR_GROUP_LABELS_FA[g] ?? g).join(" + ")} | هویت‌با‌معماری=${identity}% | اصلی(${bpDay?.primary?.join("،") ?? "?"})=${primaryHits}ح`);
    for (const ex of exs) console.log(`      - ${ex.name} (${ex.sets?.length ?? 0}ست × ${ex.sets?.[0]?.reps ?? "?"})`);
  }
  console.log("  بودجهٔ ست هفتگی (گروه → ست):");
  for (const [g, s] of [...weeklySets.entries()].sort()) console.log(`      ${MAJOR_GROUP_LABELS_FA[g] ?? g}: ${s}`);
  // ذخیره
  fs.writeFileSync(`/tmp/plan-${label}.json`, JSON.stringify(plan, null, 2));
  // metrics برای مقایسه بین کاربران
  const names = new Set<string>();
  for (const d of days) for (const ex of d.exercises ?? []) names.add(String(ex.name).replace(/\s+/g, " ").trim());
  return names;
}

async function main() {
  const which = process.argv[2] ?? "ALL";
  const keys = which === "ALL" ? Object.keys(PROFILES) : [which];
  const nameSets = new Map<string, Set<string>>();
  for (const k of keys) {
    const { data, weakPoints } = PROFILES[k];
    const t0 = Date.now();
    console.log(`\n⏳ تولید برنامهٔ ${k} (${data.workoutDays} روز، ${data.goal}, ${data.trainingExperience}) ...`);
    try {
      const plan = await generateWorkoutPlan(data, "advanced", { weakPoints });
      console.log(`✅ ${k} در ${Math.round((Date.now() - t0) / 1000)} ثانیه`);
      nameSets.set(k, audit(k, plan));
    } catch (e) {
      console.error(`❌ ${k} FAILED:`, (e as Error).message?.slice(0, 300));
      if ((e as Error).stack) console.error((e as Error).stack!.split("\n").slice(0, 4).join("\n"));
    }
  }
  // شباهت بین کاربران — شاهد شخصی‌سازی
  const keys2 = [...nameSets.keys()];
  for (let i = 0; i < keys2.length; i++) {
    for (let j = i + 1; j < keys2.length; j++) {
      const a = nameSets.get(keys2[i])!;
      const b = nameSets.get(keys2[j])!;
      const inter = [...a].filter((x) => b.has(x)).length;
      const jaccard = inter / (a.size + b.size - inter);
      console.log(`\nشباهت حرکتی کاربر ${keys2[i]} ↔ ${keys2[j]}: ${(100 * jaccard).toFixed(0)}% (${inter} حرکت مشترک از ${a.size}/${b.size})`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
