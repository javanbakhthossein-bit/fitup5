/**
 * راستی‌آزمایی ماتریس قفل امکانات ویژه (v48 — درخواست مالک)
 * «برای کاربر بدون پلن، اقتصادی، استاندارد، پیشرفته و حرفه‌ای بررسی کنیم
 *  گزینه‌هایی که باید قفل باشند درست قفلن و آزادها درست آزاد»
 * + ۸ دکمهٔ داشبورد (تمرین امروز، عکس بدن، حالت باشگاه، دستیار تغذیه،
 *   تحلیل عکس غذا، آنالیز ویدیویی، آزمایش خون، چت با فیتاپ)
 * اجرا: bun scripts/test-feature-matrix.ts
 */
import { canAccess } from "../src/lib/fitness/types";

let pass = 0, fail = 0;
function expect(name: string, got: boolean, want: boolean) {
  if (got === want) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} — انتظار ${want ? "باز" : "قفل"}، واقعی ${got ? "باز" : "قفل"}`); }
}

// دکمه‌های امکانات ویژه داشبورد (v48 = ۸ دکمه) → capability
const BUTTONS: Array<[string, string | null]> = [
  ["تمرین امروز", null], // همیشه باز (بدون گیت)
  ["آپلود عکس بدن", "bodyPhotoAnalysis"],
  ["حالت باشگاه", "gymMode"],
  ["دستیار تغذیه", null], // همیشه باز (B5)
  ["تحلیل عکس غذا", "mealPhotoAnalysis"],
  ["آنالیز ویدیویی", "videoBodyAnalysis"],
  ["آزمایش خون", "bloodTestAnalysis"],
  ["چت با فیتاپ", "aiChatQuestions"], // v48 — دکمهٔ هشتم (پیشرفته+)
];

const STATES: Array<[string, string | null, Record<string, boolean>]> = [
  ["بدون پلن", null, {
    "آپلود عکس بدن": false, "حالت باشگاه": false, "تحلیل عکس غذا": false,
    "آنالیز ویدیویی": false, "آزمایش خون": false, "چت با فیتاپ": false,
  }],
  ["اقتصادی (basic)", "basic", {
    "آپلود عکس بدن": false, "حالت باشگاه": false, "تحلیل عکس غذا": false,
    "آنالیز ویدیویی": false, "آزمایش خون": false, "چت با فیتاپ": false,
  }],
  ["استاندارد (standard)", "standard", {
    "آپلود عکس بدن": false, "حالت باشگاه": false, "تحلیل عکس غذا": false,
    "آنالیز ویدیویی": false, "آزمایش خون": false, "چت با فیتاپ": false,
  }],
  ["پیشرفته (advanced)", "advanced", {
    "آپلود عکس بدن": true, "حالت باشگاه": true, "تحلیل عکس غذا": true,
    "آنالیز ویدیویی": false, "آزمایش خون": false, "چت با فیتاپ": true,
  }],
  ["حرفه‌ای (ultimate)", "ultimate", {
    "آپلود عکس بدن": true, "حالت باشگاه": true, "تحلیل عکس غذا": true,
    "آنالیز ویدیویی": true, "آزمایش خون": true, "چت با فیتاپ": true,
  }],
];

console.log("═══ ماتریس قفل امکانات ویژه (۸ دکمه × ۵ وضعیت) ═══");
for (const [stateLabel, planId, matrix] of STATES) {
  console.log(`\n── ${stateLabel} ──`);
  for (const [btn, cap] of BUTTONS) {
    if (cap === null) {
      expect(`${btn} (همیشه باز)`, true, true);
      continue;
    }
    expect(`${btn}`, canAccess(planId, cap as any), matrix[btn]);
  }
}
console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
process.exit(fail > 0 ? 1 : 0);
