import { buildCoachBlueprint } from "@/lib/fitness/coach-blueprint";

const cases: Array<[string, any]> = [
  ["A: ۴روز پیشرفته کات فیزیک", { gender:"male", age:28, goal:"cut", trainingExperience:"advanced", workoutDays:4, workoutDaysList:["شنبه","یکشنبه","سه‌شنبه","چهارشنبه"], discipline:"mens_physique", injuries:"کمردرد", sleepHours:7, stressLevel:2, workoutPlace:"gym", equipment:["barbell"], seed:1234 }],
  ["B: ۶روز پیشرفته حجم + سرشانه ضعیف", { gender:"male", age:26, goal:"bulk", trainingExperience:"advanced", workoutDays:6, weakPoints:["سرشانه‌های ضعیف"], discipline:"bodybuilding", sleepHours:8, stressLevel:2, workoutPlace:"gym", equipment:["barbell"], seed:999 }],
  ["C: ۵روز خانم متوسط چربی‌سوزی", { gender:"female", age:31, goal:"fat_loss", trainingExperience:"intermediate", workoutDays:5, weakPoints:["باسن ضعیف"], discipline:"fitness", sleepHours:7, stressLevel:3, workoutPlace:"gym", equipment:["machine"], seed:77 }],
  ["D: ۳روز مبتدی خانه خواب کم", { gender:"male", age:41, goal:"muscle_gain", trainingExperience:"beginner", workoutDays:3, workoutDaysList:["شنبه","دوشنبه","چهارشنبه"], workoutPlace:"home", equipment:["dumbbell"], sleepHours:6, stressLevel:4, seed:55 }],
  ["E: ۷روز pro حجم", { gender:"male", age:30, goal:"bulk", trainingExperience:"pro", workoutDays:7, workoutPlace:"gym", equipment:["barbell"], seed:31 }],
  ["F: ۲روز مبتدی", { gender:"female", age:35, goal:"fitness", trainingExperience:"beginner", workoutDays:2, workoutPlace:"gym", equipment:["machine"], seed:12 }],
  ["G: ۱روز", { gender:"male", age:50, goal:"fitness", trainingExperience:"beginner", workoutDays:1, workoutPlace:"gym", equipment:["machine"], seed:8 }],
  ["H: ۴روز قدرت پاورلیفتینگ", { gender:"male", age:32, goal:"strength", trainingExperience:"advanced", workoutDays:4, discipline:"powerlifting", workoutPlace:"gym", equipment:["barbell"], seed:6 }],
];

for (const [label, input] of cases) {
  const bp = buildCoachBlueprint(input);
  console.log(`\n□ ${label}`);
  console.log(`  → ${bp.splitId} | ${bp.splitLabelFa.slice(0, 70)} | coach=${bp.coachKey} | period=${bp.periodizationHint}`);
  for (const d of bp.days) console.log(`    ${d.day}: ${d.title} | اصلی: ${d.primary.join(" + ")}${d.secondary.length ? " | مکمل: " + d.secondary.join(" + ") : ""}`);
  console.log(`  بودجه: ${bp.weeklySets.map((w) => `${w.muscle}${w.priority ? "🔴" : ""}:${w.min}-${w.max}(${w.frequency}×)`).join(" | ")}`);
  if (bp.fst7) console.log(`  FST-7: ${bp.fst7.muscle} روز ${bp.days[bp.fst7.dayIndex]?.day}`);
}
console.log("\n✅ sanity OK");
