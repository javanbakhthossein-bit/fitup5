/**
 * v152 — تست رفتاری ممنوعیت مکمل (تأیید مالک: «برنامه تغذیه و مکمل هم شامل
 * تغییرات در چت با فیتاپ میشه»)
 * اجرا: bun scripts/tests/v152-supplement-exclusion.test.ts
 */
import {
  parseRedesignConstraintsFromText,
  mergeConstraints,
  sanitizeConstraints,
  enforceMealExclusions,
  buildSupplementExclusionDirectiveFa,
  normalizeFaText,
} from "../../src/lib/fitness/plan-redesign-constraints";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.error(`❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// ─── T1: استخراج عین سناریوی مالک (تمرین + تغذیه + مکمل در یک درخواست) ───
const ownerStyle = `سلام، برنامه رو عوض کن. به خاطر کمرم بارفیکس حذف شه و اسکات به پرس هم نباشه، شنا هم به خاطر مچم حذف شه. عدس هم نخورم. کراتین و امگا۳ هم مصرف نکنم، وی پروتئین هم حذف شه.`;
const c1 = parseRedesignConstraintsFromText(ownerStyle);
check(
  "T1 استخراج حرکات",
  !!c1 &&
    c1.forbiddenMovements.includes("بارفیکس") &&
    c1.forbiddenMovements.includes("اسکات به پرس") &&
    (c1.forbiddenMovements.includes("شنا (پوش‌آپ)") || c1.forbiddenMovements.includes("شنا")),
  JSON.stringify(c1)
);
check("T1 استخراج غذا (عدس)", !!c1 && c1.forbiddenFoods.includes("عدس"), JSON.stringify(c1?.forbiddenFoods));
check(
  "T1 استخراج مکمل (کراتین/امگا۳/پروتئین وی)",
  !!c1 &&
    c1.forbiddenSupplements.includes("کراتین") &&
    c1.forbiddenSupplements.includes("امگا۳") &&
    c1.forbiddenSupplements.includes("پروتئین وی"),
  JSON.stringify(c1?.forbiddenSupplements)
);

// ─── T2: نگهبان نقیضه — «کراتین حذف نشه» = ممنوع نیست ───
const c2 = parseRedesignConstraintsFromText("کراتین حذف نشه، امگا۳ حذف شه");
check(
  "T2 نقیضه: کراتین بماند، امگا۳ حذف",
  !!c2 && !c2.forbiddenSupplements.includes("کراتین") && c2.forbiddenSupplements.includes("امگا۳"),
  JSON.stringify(c2?.forbiddenSupplements)
);

// ─── T3: ممنوعیت «فقط مکمل» — غذای برنامه دست‌نخورده می‌ماند ───
const suppOnly = parseRedesignConstraintsFromText("کراتین و مولتی ویتامین مصرف نکنم");
check(
  "T3 فقط مکمل استخراج شد",
  !!suppOnly &&
    suppOnly.forbiddenSupplements.includes("کراتین") &&
    suppOnly.forbiddenSupplements.includes("مولتی‌ویتامین") &&
    suppOnly.forbiddenFoods.length === 0 &&
    suppOnly.forbiddenMovements.length === 0,
  JSON.stringify(suppOnly)
);
const mealPlan = {
  meals: [
    {
      type: "صبحانه",
      items: [{ name: "عدس پخته", calories: 100 }, { name: "نان سنگک", calories: 200 }],
    },
  ],
  supplements: [
    { name: "کراتین مونوهیدرات (Creapure®)", dose: "۵ گرم", timing: "بعد از تمرین" },
    { name: "منیزیم", dose: "۳۰۰ میلی‌گرم", timing: "قبل از خواب" },
  ],
  supplementStack: [
    { name: "کراتین", category: "base", dose: "۵ گرم" },
    { name: "ویتامین D3", category: "base", dose: "۲۰۰۰ IU" },
  ],
};
const rep = enforceMealExclusions(mealPlan as any, suppOnly);
check(
  "T3 کراتین از supplements حذف شد",
  (mealPlan.supplements as any[]).every((s) => !normalizeFaText(s.name).includes("کراتین")),
  JSON.stringify(mealPlan.supplements)
);
check(
  "T3 کراتین از supplementStack حذف شد",
  (mealPlan.supplementStack as any[]).every((s) => !normalizeFaText(s.name).includes("کراتین")),
  JSON.stringify(mealPlan.supplementStack)
);
check("T3 منیزیم و ویتامین D باقی ماندند", (mealPlan.supplementStack as any[]).length === 1 && (mealPlan.supplements as any[]).length === 1);
check("T3 غذا (عدس) دست‌نخورده ماند", (mealPlan.meals[0].items as any[]).length === 2);
check("T3 گزارش شامل هر دو حذف", rep.removed.length === 2, JSON.stringify(rep.removed));
check(
  "T3 خط شفافیت در notes",
  typeof mealPlan.notes === "string" && mealPlan.notes.includes("مکمل") && mealPlan.notes.includes("کراتین"),
  String(mealPlan.notes)
);

// ─── T4: دیرکتیو مکمل ───
const directive = buildSupplementExclusionDirectiveFa(c1!, "کراتین و امگا۳ هم مصرف نکنم");
check(
  "T4 دیرکتیو مکمل ساخته شد",
  directive.includes("ممنوعیت‌های قطعی مکمل") &&
    directive.includes("«کراتین»") &&
    directive.includes("supplements") &&
    directive.includes("supplementStack"),
  directive
);
check("T4 دیرکتیو خالی وقتی مکملی ممنوع نیست", buildSupplementExclusionDirectiveFa({ forbiddenMovements: [], forbiddenFoods: [], forbiddenSupplements: [] }) === "");

// ─── T5: ادغام + sanitize (سازگاری رو به عقب: مکمل داخل foods جابه‌جا شود) ───
const merged = mergeConstraints(c1, suppOnly);
check(
  "T5 ادغام ممنوعیت‌ها",
  !!merged && merged.forbiddenSupplements.includes("کراتین") && merged.forbiddenMovements.includes("بارفیکس"),
  JSON.stringify(merged?.forbiddenSupplements)
);
const legacy = sanitizeConstraints({
  forbiddenMovements: ["بارفیکس"],
  forbiddenFoods: ["عدس", "کراتین", "ویتامین D"],
});
check(
  "T5 sanitize: مکمل از foods به supplements منتقل شد",
  !!legacy &&
    legacy.forbiddenFoods.includes("عدس") &&
    !legacy.forbiddenFoods.includes("کراتین") &&
    legacy.forbiddenSupplements.includes("کراتین") &&
    legacy.forbiddenSupplements.includes("ویتامین D"),
  JSON.stringify(legacy)
);
check("T5 sanitize خروجی خالی → null", sanitizeConstraints({ forbiddenMovements: [], forbiddenFoods: [], forbiddenSupplements: [] }) === null);

// ─── T6: حروف عربی/نیم‌فاصله/ارقام فارسی ───
const c6 = parseRedesignConstraintsFromText("كرياتين مصرف نكنم — ويتامين D هم حذف شه");
check(
  "T6 نرمال‌سازی عربی→فارسی",
  !!c6 && c6.forbiddenSupplements.includes("کراتین") && c6.forbiddenSupplements.includes("ویتامین D"),
  JSON.stringify(c6?.forbiddenSupplements)
);

console.log(`\n──────── نتیجه: ${pass} پاس / ${fail} خطا ────────`);
process.exit(fail > 0 ? 1 : 0);
