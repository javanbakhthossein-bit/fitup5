// ─────────────────────────────────────────────────────────────────────────────
// v239 — ممیزی سازگاری کامل بانک حرکات (دیرکتیو مالک: «تمام توضیحات و نکات ایمنی
// و اسم حرکات در بانک حرکات باهم سازگار بشن تا هیچ تناقضی وجود نداشته باشه»)
//
// ۷ بعد ممیزی (همه قاعده‌محور/قطعی — بدون هوش مصنوعی تا تکرارپذیر باشد):
//   R1  سازگاری category ↔ muscle (جدول کانونی)
//   R2  سازگاری خانوادهٔ نام ↔ category/muscle (کلیدواژهٔ حرکتی)
//   R3  سازگاری متن توضیحات ↔ muscle (عضلاتِ «اصلیِ» ذکرشده در توضیحات)
//   R4  نکات ایمنی: (a) یادداشت ایمنی حیاتیِ خانواده‌های آکسایل (ب) تجهیز ذکرشده
//       در tips غریبه با equipment ردیف (ج) نشانهٔ حرکتیِ خانوادهٔ غلط
//   R5  سازگاری equipment ↔ نام
//   R6  ردیف‌های تکراری هم‌خانواده با فیلدهای متناقض
//   R7  نقطهٔ کور موتور: ردیفی که primaryGroupOfExercise موتور برایش null برمی‌گرداند
//
// خروجی: JSON findings برای بازبینی انسانی → سپس پچ
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("download/v239-research/bank-dump-v239.json", "utf8"));
const findings = { R1: [], R2: [], R3: [], R4a: [], R4b: [], R4c: [], R5: [], R6: [], R7: [] };

// ── نرمال‌سازی متن فارسی (هم‌راستا با موتور) ──
function norm(s) {
  return String(s ?? "")
    .replace(/[\u064A]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/[\u200C]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function squeeze(s) {
  return norm(s).replace(/[\s()（）\-ـ]+/g, "");
}

// ── کلاس گروهی muscle — همان منطق موتور (نگاشت منفی‌دار پشت) ──
const GROUPS = ["core", "arms", "shoulders", "chest", "back", "legs"];
function muscleClass(muscle, name = "") {
  const hay = norm(`${muscle ?? ""} ${name}`);
  if (/کل بدن|بدن کامل|fullbody|full.?body/i.test(hay)) return "fullbody";
  const cls = new Set();
  if (/شکم|کور|core/i.test(hay)) cls.add("core");
  if (/جلوبازو|جلو بازو|پشت ?بازو|بازو|biceps|triceps|arm/i.test(hay)) cls.add("arms");
  if (/سرشانه|شانه|دلتوئید|shoulder|delt/i.test(hay)) cls.add("shoulders");
  if (/سینه|chest|پک/i.test(hay)) cls.add("chest");
  if (/زیربغل|پشت(?![ ]?(?:پا|بازو|ران))|بالاتن|بالاهتن|\blats?\b|back|روئینگ|rowing/i.test(hay)) cls.add("back");
  if (/پا|باسن|[^ ]ران[ ]|$|ساق|leg|glute|همسترینگ|چهارسر/i.test(hay)) cls.add("legs");
  if (cls.has("arms") && /پشت ?بازو|تریسپس|triceps/.test(hay)) {} // arms نگه داشته می‌شود
  return cls;
}
// کلاسِ «فیلد muscle» تنها (بدون نام — همان primaryGroup موتور)
function fieldClass(muscle) {
  const hay = norm(muscle ?? "");
  if (!hay) return new Set();
  if (/کل بدن|بدن کامل|fullbody/i.test(hay)) return new Set(["fullbody"]);
  const cls = new Set();
  if (/شکم|کور|core/i.test(hay)) cls.add("core");
  if (/جلوبازو|جلو بازو|پشت ?بازو|بازو|biceps|triceps|arm/i.test(hay)) cls.add("arms");
  if (/سرشانه|شانه|دلتوئید|shoulder|delt/i.test(hay)) cls.add("shoulders");
  if (/سینه|chest|پک/i.test(hay)) cls.add("chest");
  if (/زیربغل|پشت(?![ ]?(?:پا|بازو|ران))|بالاتن|\blats?\b|back|روئینگ|rowing/i.test(hay)) cls.add("back");
  if (/پا|باسن|(^|[ ])ران([ ]|$)|ساق|leg|glute|همسترینگ|چهارسر/i.test(hay)) cls.add("legs");
  return cls;
}

// ── R1: جدول کانونی category → muscleهای مجاز ──
const CAT_ALLOWED_MUSCLE = {
  push: ["سینه", "سرشانه", "پشت بازو", "پشت‌بازو", "سینه و دست"],
  pull: ["پشت", "زیربغل", "پشت و زیربغل", "کمر و پشت", "ساعد", "گردن و کول", "جلو بازو", "جلوبازو", "بازو"],
  legs: ["پا", "پا و باسن", "باسن", "ساق", "پشت ران", "جلو ران"],
  core: ["شکم", "شکم و کمر"],
  fullbody: ["کل بدن", "بدن کامل"],
};
for (const r of rows) {
  const cat = norm(r.category);
  const mus = norm(r.muscle);
  const allowed = CAT_ALLOWED_MUSCLE[cat];
  if (!allowed) continue; // cardio — چک نرم پایین
  if (!allowed.includes(mus)) {
    findings.R1.push({ id: r.id, name: r.name, category: cat, muscle: mus, note: "muscle خارج از جدول کانونی این category" });
  }
  if (cat === "cardio") {
    const fc = fieldClass(mus);
    if ([...fc].some((c) => ["chest", "shoulders", "arms", "back"].includes(c))) {
      findings.R1.push({ id: r.id, name: r.name, category: cat, muscle: mus, note: "کاردیو با عضلهٔ بالاتنهٔ مشخص" });
    }
  }
}

// ── R2: خانوادهٔ نام → (category, کلاس muscle) مورد انتظار ──
const FAMILY_RULES = [
  { re: /رومانیایی|رومانی|رومانین/i, cat: "legs", musRe: /ران|پا|باسن|همسترینگ/, label: "RDL/رومانیایی → پا (همسترینگ)" },
  { re: /ددلیفت.*تک ?پا|تک ?پا.*ددلیفت|single.?leg.*deadlift|deadlift.*single.?leg/i, cat: "legs", musRe: /ران|پا|باسن|همسترینگ/, label: "ددلیفت تک‌پا → پا" },
  { re: /ددلیفت.*پا صاف|پا صاف|استیف|stiff.?leg/i, cat: "legs", musRe: /ران|پا|باسن|همسترینگ/, label: "ددلیفت پا صاف → پا" },
  { re: /ددلیفت|deadlift/i, cat: "pull", musRe: /پشت|زیربغل|کمر|back/, label: "ددلیفت (کلاسیک/سومو/رک/…) → پشت" },
  { re: /اسکوات|squat/i, cat: "legs", musRe: /پا|ران|باسن|چهارسر/, label: "اسکوات → پا" },
  { re: /لانج|لنج|بلغاری|جهشی|lunge/i, cat: "legs", musRe: /پا|ران|باسن|چهارسر/, label: "لانج/بلغاری → پا" },
  { re: /هیپ ?تراست|پل باسن|hip ?thrust|glute ?bridge/i, cat: "legs", musRe: /باسن|پا|ران/, label: "هیپ‌تراست/پل باسن → پا (باسن)" },
  { re: /پشت پا|leg ?curl|همسترینگ/i, cat: "legs", musRe: /ران|پا|همسترینگ/, label: "پشت پا → پا (پشت ران)" },
  { re: /جلو ران|جلوی پا|leg ?extension|اکستنشن پا/i, cat: "legs", musRe: /ران|پا|چهارسر/, label: "جلو ران → پا (چهارسر)" },
  { re: /ساق|calf/i, cat: "legs", musRe: /ساق|پا/, label: "ساق → پا" },
  { re: /شراگ|shrug/i, cat: "pull", musRe: /کول|گردن|trap|پشت/, label: "شراگ → پشت (کول)" },
  { re: /پرس سینه|پرس بالاسینه|پرس زیرسینه|پرس زیر سینه|بنچ|bench press/i, cat: "push", musRe: /سینه|chest/, label: "پرس سینه → push (سینه)" },
  { re: /پرس سرشانه|سرشانه پرس|نشر|shoulder press|lateral raise|فرانت ریز/i, cat: "push", musRe: /سرشانه|شانه|shoulder|delt/, label: "پرس/نشر سرشانه → push (سرشانه)" },
  { re: /جلو بازو|جلوبازو|چکشی|لاری|پرچر|همر|curl/i, cat: "pull", musRe: /جلو ?بازو|بازو|بایسپس|ساعد/, label: "جلو بازو → pull" },
  { re: /پشت بازو|پشت‌بازو|تریسپس|دیپ|triceps|dip(?!ping)/i, cat: "push", musRe: /پشت ?بازو|بازو|تریسپس/, label: "پشت بازو → push" },
  { re: /کرانچ|پلانک|هالو|توئیست|روتیشن|کیک ?بک پا?|برپی|mountain|دراز نشست/i, cat: "core", musRe: /شکم|کمر|مرکز|core|کل بدن|بدن کامل/, label: "شکمی → core" },
  { re: /روئینگ|قایقی|rowing|بارفیکس|پول ?داون|پولداون|lat ?pulldown|پول ?اور|pullover/i, cat: "pull", musRe: /پشت|زیربغل|کمر|back|lats?/, label: "کشش/روئینگ زیربغل → pull" },
  { re: /هایپراکستنشن|hyperextension/i, cat: "pull", musRe: /کمر|پشت|back/, label: "هایپراکستنشن → پشت (راست‌کننده‌ها)" },
  { re: /جامپینگ|جک|طناب ?زدن|دودمان?ل|burpee|jumping|روگذر|اسپرینت|دویدن|طناب/i, cat: "cardio", label: "هوازی/پرشی → cardio" },
];
for (const r of rows) {
  const n = norm(r.name);
  for (const rule of FAMILY_RULES) {
    if (!rule.re.test(n)) continue;
    if (rule.cat && norm(r.category) !== rule.cat) {
      findings.R2.push({ id: r.id, name: r.name, family: rule.label, expectCat: rule.cat, actualCat: norm(r.category) });
    }
    if (rule.musRe && !rule.musRe.test(norm(r.muscle))) {
      findings.R2.push({ id: r.id, name: r.name, family: rule.label, expectMuscle: rule.musRe.source, actualMuscle: norm(r.muscle) });
    }
    break; // اولین قانون منطبق ملاک است (قوانین خاص قبل از عمومی مرتب شده‌اند)
  }
}

// ── R3: عضلاتِ «اصلیِ» ذکرشده در توضیحات ↔ فیلد muscle ──
const MENTION_LEX = [
  { re: /همسترینگ|پشت ?ران/i, cls: "legs" },
  { re: /چهارسر|جلوران|جلو ران/i, cls: "legs" },
  { re: /باسن|سرینی|glute/i, cls: "legs" },
  { re: /ساق/i, cls: "legs" },
  { re: /راست ?کننده(?:‌)?(?:های)? ?کمر|اریتور/i, cls: "back" },
  { re: /زیربغل|لاتیسیموس|\blats?\b/i, cls: "back" },
  { re: /ذوزنبه(?:‌)?ای|تراپزیس|کول/i, cls: "back" },
  { re: /پشت(?![ ]?(?:پا|بازو|ران))/i, cls: "back" },
  { re: /سینه|پکتورال/i, cls: "chest" },
  { re: /دلتوئید|سرشانه(?! ?عقب)|سرشانه عقب/i, cls: "shoulders" },
  { re: /جلوبازو|جلو بازو|بایسپس/i, cls: "arms" },
  { re: /پشت ?بازو|تریسپس/i, cls: "arms" },
  { re: /ساعد/i, cls: "arms" },
  { re: /شکم|ابدومینال|مرکز بدن/i, cls: "core" },
];
for (const r of rows) {
  const d = norm(r.description);
  if (!d) continue;
  // الگوی صریح «عضلات اصلی/درگیر … هستند» اولویت دارد؛ وگرنه همهٔ ذکرها
  let text = d;
  const explicit = d.match(/عضلات?(?: اصلی| درگیر)[^.]*(?:هستند|است|می‌شود)/);
  if (explicit) text = explicit[0];
  const classes = new Set();
  for (const { re, cls } of MENTION_LEX) if (re.test(text)) classes.add(cls);
  if (classes.size === 0) continue;
  const fc = fieldClass(r.muscle);
  if (fc.has("fullbody") || fc.size === 0) continue;
  const fcArr = [...fc];
  const intersects = fcArr.some((c) => classes.has(c));
  if (!intersects && classes.size >= 1) {
    findings.R3.push({ id: r.id, name: r.name, muscle: r.muscle, category: r.category, descMentionClasses: [...classes], snippet: (explicit ? explicit[0] : d).slice(0, 140) });
  }
}

// ── R4a: تجهیز غریبه در tips ──
const EQUIP_TOKENS = [
  { re: /هالتر/i, eq: "barbell" }, { re: /دمبل/i, eq: "dumbbell" }, { re: /کتل ?بل/i, eq: "kettlebell" },
  { re: /\bکش\b|کش مقاومتی/i, eq: ["band", "resistance band"] }, { re: /دستگاه|اسمیت/i, eq: ["machine", "smith", "cable"] },
  { re: /سیم ?کش/i, eq: "cable" }, { re: /نیمکت/i, eq: ["bench", "dumbbell,bench", "barbell,bench"] },
  { re: /بارفیکس/i, eq: "pull-up bar" }, { re: /توپ ?سوئیسی|سوئیس ?بال/i, eq: ["swiss ball", "dumbbell,swiss ball"] },
  { re: /توپ ?درمانی|مدیسین ?بال/i, eq: ["medicine ball", "medicine_ball", "dumbbell,ball", "bodyweight,ball"] },
  { re: /تی ?آر ?ایکس|trx/i, eq: "trx" },
];
for (const r of rows) {
  const t = norm(r.tips);
  if (!t || !r.equipment) continue;
  const eqSet = new Set(norm(r.equipment).split(",").map((x) => x.trim()));
  for (const { re, eq: token } of EQUIP_TOKENS) {
    if (!re.test(t)) continue;
    const eqs = Array.isArray(token) ? token : [token];
    const match = eqs.some((e) => eqSet.has(e));
    // «هالتر اسمیت» در نام یا «دستگاه» در نام = استثنا
    const nameHas = re.test(norm(r.name));
    if (!match && !nameHas) {
      findings.R4a.push({ id: r.id, name: r.name, equipment: r.equipment, tipMentions: eqs.join("|"), snippet: t.slice(0, 120) });
      break;
    }
  }
}

// ── R4b: یادداشت ایمنی حیاتی خانواده‌های آکسایل (بار محوری روی ستون فقرات) ──
const AXIAL_FAMILIES = [
  { re: /ددلیفت|deadlift/i, need: /کمر|ستون فقرات|فقرات|خنثی|پشت صاف|گرد نکن/i, label: "ددلیفت" },
  { re: /اسکوات(?! ?جلو)|squat/i, need: /کمر|ستون فقرات|فقرات|خنثی|زانو/i, label: "اسکوات" },
  { re: /روئینگ|قایقی|rowing/i, need: /کمر|ستون فقرات|فقرات|خنثی|پشت صاف|گرد نکن/i, label: "روئینگ" },
  { re: /پرس سرشانه|shoulder press|پرس هالتر بالاسر?/i, need: /کمر|ستون فقرات|شانه|کتف|قوس/i, label: "پرس سرشانه" },
  { re: /هیپ ?تراست|پل باسن|hip ?thrust|glute ?bridge/i, need: /کمر|لگن|شکم|کنترل/i, label: "هیپ‌تراست/پل باسن" },
  { re: /هایپراکستنشن|hyperextension/i, need: /کمر|لگن|کنترل/i, label: "هایپراکستنشن" },
  { re: /پرس سینه|بنچ|bench press/i, need: /کتف|شانه|آرنج|کنترل/i, label: "پرس سینه" },
];
for (const r of rows) {
  const n = norm(r.name);
  for (const fam of AXIAL_FAMILIES) {
    if (!fam.re.test(n)) continue;
    const t = norm(r.tips || "");
    if (!t || !fam.need.test(t)) {
      findings.R4b.push({ id: r.id, name: r.name, family: fam.label, tipsLen: t.length, tips: t.slice(0, 110) });
    }
    break;
  }
}

// ── R4c: نشانهٔ حرکتیِ خانوادهٔ غلط در tips (کپی‌پیست از حرکت دیگر) ──
const CUE_MISMATCH = [
  { body: /زانو/i, familyRe: /جلو بازو|جلوبازو|چکشی|لاری|پرچر|مچ|ساعد|شراگ|کرانش?|مچ/i, label: "حرکت بازو/ساعد با نشانهٔ زانو" },
  { body: /آرنج/i, familyRe: /ساق|calf|لانج|اسکوات|هیپ ?تراست|پل باسن/i, label: "حرکت پا با نشانهٔ آرنج" },
];
for (const r of rows) {
  const t = norm(r.tips || "");
  const n = norm(r.name);
  if (!t) continue;
  for (const cm of CUE_MISMATCH) {
    if (cm.body.test(t) && cm.familyRe.test(n)) {
      findings.R4c.push({ id: r.id, name: r.name, rule: cm.label, snippet: t.slice(0, 120) });
      break;
    }
  }
}

// ── R5: تجهیز ↔ نام ──
const NAME_EQUIP = [
  { re: /هالتر(?! ?اسمیت)/i, eqs: ["barbell", "barbell,bench", "barbell,machine"] },
  { re: /هالتر اسمیت|اسمیت/i, eqs: ["smith", "barbell,machine", "machine"] },
  { re: /دمبل/i, eqs: ["dumbbell", "dumbbell,bench", "dumbbell,ball", "dumbbell,swiss ball", "dumbbell,kettlebell", "dumbbell,resistance band,bench", "kettlebell,dumbbell"] },
  { re: /کتل ?بل/i, eqs: ["kettlebell", "kettlebell,dumbbell", "dumbbell,kettlebell"] },
  { re: /با کش|کش مقاومتی/i, eqs: ["band", "resistance band"] },
  { re: /سیم ?کش/i, eqs: ["cable", "سیم کش"] },
  { re: /دستگاه/i, eqs: ["machine", "cable", "smith", "دستگاه لاری", "barbell,machine"] },
  { re: /بارفیکس/i, eqs: ["pull-up bar", "pull-up bar,weight", "bodyweight"] },
  { re: /نیمکت/i, eqs: ["bench", "dumbbell,bench", "barbell,bench"] },
  { re: /تی ?آر ?ایکس|trx/i, eqs: ["trx"] },
];
for (const r of rows) {
  const n = norm(r.name);
  const eqNorm = norm(r.equipment || "");
  for (const ne of NAME_EQUIP) {
    if (!ne.re.test(n)) continue;
    const eqSet = new Set(eqNorm.split(",").map((x) => x.trim()));
    const ok = ne.eqs.some((e) => eqSet.has(e));
    if (!ok) {
      findings.R5.push({ id: r.id, name: r.name, equipment: r.equipment, nameImplies: ne.eqs.join("|") });
    }
    break;
  }
}

// ── R6: ردیف‌های هم‌نام/هم‌خانواده با فیلدهای متناقض ──
const byKey = new Map();
for (const r of rows) {
  const key = squeeze(r.name).replace(/\([^)]*\)/g, "").toLowerCase();
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}
for (const [key, group] of byKey) {
  if (group.length < 2) continue;
  const cats = new Set(group.map((r) => norm(r.category)));
  const musClasses = new Set(group.map((r) => [...fieldClass(r.muscle)].sort().join("+")));
  if (cats.size > 1 || musClasses.size > 1) {
    findings.R6.push({
      key, rows: group.map((r) => ({ id: r.id, name: r.name, muscle: r.muscle, category: r.category, equipment: r.equipment })),
    });
  }
}
// هم‌خانوادهٔ نزدیک (کلیدواژهٔ مشترک + تجهیز مشترک) — فقط برای خانوادهٔ ددلیفت که مالک پرسید
const dl = rows.filter((r) => /ددلیفت|deadlift/i.test(norm(r.name)));
const dlClasses = new Map();
for (const r of dl) {
  const cls = [...fieldClass(r.muscle)].sort().join("+") + "/" + norm(r.category);
  if (!dlClasses.has(cls)) dlClasses.set(cls, []);
  dlClasses.get(cls).push(r.name);
}
console.error("== ددلیفت: توزیع کلاس =");
for (const [k, v] of dlClasses) console.error(`  ${k}: ${v.length}`);

// ── R7: نقطهٔ کور موتور (primaryGroup = null ولی حرکت وزنه‌ای واقعی) ──
for (const r of rows) {
  const fc = fieldClass(r.muscle);
  const cat = norm(r.category);
  if (fc.size === 0 && ["push", "pull", "legs"].includes(cat)) {
    findings.R7.push({ id: r.id, name: r.name, muscle: r.muscle, category: cat, note: "موتور گروه اولیه نمی‌گیرد (کور‌نقطهٔ پلیس معماری)" });
  }
}

// ── گزارش ──
let total = 0;
for (const k of Object.keys(findings)) {
  total += findings[k].length;
  console.error(`\n===== ${k}: ${findings[k].length} =====`);
  for (const f of findings[k].slice(0, 60)) console.error(JSON.stringify(f));
}
console.error(`\nTOTAL findings: ${total}`);
writeFileSync("scripts/tmp/bank-audit-findings-v239.json", JSON.stringify(findings, null, 1));
