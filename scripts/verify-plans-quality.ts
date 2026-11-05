import { auditWorkoutPlanDeterministic, auditBlueprintAdherence } from "@/lib/fitness/plan-quality-gate";
import type { OnboardingData } from "@/lib/fitness/types";
import * as fs from "node:fs";

const profA: OnboardingData = { gender:"male", age:28, height:178, weight:84, goal:"cut", activityLevel:"moderate", workoutDays:4, workoutPlace:"gym", equipment:["barbell"], diseases:"", injuries:"", allergies:"", dietType:"regular", trainingExperience:"advanced" } as unknown as OnboardingData;
const profB = { ...profA, goal:"bulk", workoutDays:6, trainingExperience:"advanced" } as unknown as OnboardingData;
const profC = { ...profA, gender:"female", age:31, weight:68, height:165, goal:"fat_loss", workoutDays:5, trainingExperience:"intermediate" } as unknown as OnboardingData;
const profD = { ...profA, age:41, weight:92, goal:"muscle_gain", workoutDays:3, trainingExperience:"beginner", workoutPlace:"home" } as unknown as OnboardingData;
const profs: Record<string, OnboardingData> = { A: profA, B: profB, C: profC, D: profD };

const nameSets = new Map<string, Set<string>>();
for (const [k, data] of Object.entries(profs)) {
  const plan = JSON.parse(fs.readFileSync(`/tmp/plan-${k}.json`, "utf8"));
  const l2 = auditWorkoutPlanDeterministic(plan, data);
  const bpIssues = auditBlueprintAdherence(plan);
  console.log(`\n□ کاربر ${k} (${data.workoutDays} روز، ${data.goal}):`);
  console.log(`  L2 deterministic: ${l2.length === 0 ? "✅ صفر issue" : l2.map(i => `${i.code}(${i.severity})`).join("، ")}`);
  console.log(`  Blueprint adherence: ${bpIssues.length === 0 ? "✅ کاملاً منطبق" : bpIssues.map(i => `${i.code}(${i.severity})`).join("، ")}`);
  const names = new Set<string>();
  for (const d of plan.days) for (const ex of d.exercises ?? []) names.add(String(ex.name).replace(/\s+/g, " ").trim());
  nameSets.set(k, names);
}
const ks = [...nameSets.keys()];
console.log("\n=== شباهت حرکتی بین کاربران (شاخص شخصی‌سازی) ===");
for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
  const a = nameSets.get(ks[i])!, b = nameSets.get(ks[j])!;
  const inter = [...a].filter(x => b.has(x)).length;
  const jac = inter / (a.size + b.size - inter);
  console.log(`  ${ks[i]}↔${ks[j]}: ${(100 * jac).toFixed(0)}% مشترک (${inter}/${a.size}|${b.size})`);
}
