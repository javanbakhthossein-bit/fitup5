// ─────────────────────────────────────────────────────────────────────────────
// v239 — پچ سازگاری کامل بانک حرکات (دیرکتیو مالک: «تمام توضیحات و نکات ایمنی و
// اسم حرکات در بانک حرکات باهم سازگار بشن تا هیچ تناقضی وجود نداشته باشه»)
//
// اصل کانونی هر خانواده (استاندارد مربیگری + هم‌راستا با موتور):
//   • ددلیفت کلاسیک/سومو/رک/دیفسیت/دداستاپ/کتل‌بل-دوپا → پشت / pull (روز پشت)
//   • ددلیفت رومانیایی/تک‌پا/پا صاف/با مکث/با کش (همهٔ واریانت‌ها) → پشت ران / legs (روز پا)
//   • فیله/لاری/چکشی (جلو بازو) → pull | پشت بازو/دیپ → push
//   • فیس‌پول/پول‌آپارت/فلای خماری (دلتوئید خلفی) → سرشانه / pull
//   • شراگ → گردن و کول / pull  (موتور: کول → گروه پشت)
//   • حرکات پیلاتسِ ثبات‌محور (سوپرمن/بردداگ/قو/سگ‌گربه/…) → شکم و کمر / core
//   • پل باسن/ساید کیک (باسن‌محور) → legs
//   • تجهیز = وسیلهٔ نام‌برده در نام (نیمکت → bench، دمبل → dumbbell، …)
//
// اجرا: node scripts/apply-bank-consistency-patch-v239.mjs [--dry]
// خروجی: اعمال روی db/custom.db + فایل scripts/exercise-bank-consistency-patch-v239.sql
// ─────────────────────────────────────────────────────────────────────────────
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const DB_PATH = process.env.DB_PATH_OVERRIDE || "db/custom.db";
const db = new DatabaseSync(DB_PATH);

/** [id, patch, دلیل] — patch: {name?, muscle?, category?, equipment?, description?, tipsAppend?} */
const FIXES = [
  // ─── ① خانوادهٔ ددلیفت: واریانت‌های تک‌پا/رومانیایی = پا (پشت ران) ───
  { id: "seed_ex_127", patch: { muscle: "پشت ران", category: "legs" },
    why: "ددلیفت رومانیایی دمبل تک‌پا — هینج تک‌پا = همسترینگ/باسن (متن توضیحات هم همین می‌گوید)؛ فیلد قبلی پشت/pull متناقض بود" },
  { id: "seed_ex_218", patch: { muscle: "پشت ران", category: "legs" },
    why: "ددلیفت رومانیایی با کش — متن: «عضلات اصلی: همسترینگ، باسن»؛ فیلد کمر و پشت/pull متناقض" },
  { id: "cmufkcy1c002r2b12zieun8na", patch: { muscle: "پشت ران", category: "legs" },
    why: "ددلیفت تک‌پا با دمبل — tips کاملاً هینج/لگن است؛ فیلد پشت و زیربغل/pull متناقض" },
  { id: "seed_ex_220", patch: { muscle: "پشت" },
    why: "ددلیفت سومو با کتل‌بل — خانوادهٔ ددلیفت کلاسیک = پشت (کانونی‌سازی مقدار «کمر و پشت»)" },
  // ─── ② باگ‌های کتگوری صریح (جلو بازو=push؟! / زیربغل=push؟!) ───
  { id: "cmukfesii019c2bdyxllp85t5", patch: { category: "pull", equipment: "dumbbell" },
    why: "جلو بازو لاری دمبل — جلوبازو = pull (نه push)؛ تجهیز فارسی «دمبل» → dumbbell" },
  { id: "cmukfin5s019t2bdy5zb6lbi7", patch: { category: "pull", equipment: "dumbbell" },
    why: "جلو بازو لاری دمبل تک — همان بالا" },
  { id: "cmukfr7v801a82bdyuvjmcq21", patch: { category: "pull" },
    why: "جلو بازو لاری دستگاه — جلوبازو = pull" },
  { id: "cmulvft1h00072b9lmad0zgrc", patch: { category: "pull" },
    why: "زیر بغل سیم کش خم — زیربغل = pull (نه push)؛ باگ صریح" },
  // ─── ③ پول‌اور: متن خودش «زیربغل و سینه عضلات اصلی» گفته — فیلد سینه/push متناقض ───
  { id: "cmufkcza6008s2b12cxa0jiqy", patch: { muscle: "پشت و زیربغل", category: "pull" },
    why: "پول‌اور دمبل — توضیحات: «زیربغل و سینه عضلات اصلی»؛ فیلد باید همان باشد" },
  // ─── ④ خانوادهٔ دلتوئید خلفی (فیس‌پول/پول‌آپارت) → سرشانه — هم‌سو با فیس پول سرشانه و فلای خماری ───
  { id: "cmufkcyku00582b12gww2zgq7", patch: { muscle: "سرشانه" },
    why: "فیس‌پول با کش — متن: «دلتوئید خلفی و چرخاننده‌های خارجی شانه»؛ ردیف هم‌خانواده («فیس پول سرشانه») سرشانه دارد" },
  { id: "cmufkcza1008r2b127sj1vrfr", patch: { muscle: "سرشانه" },
    why: "پول‌آپارت با کش — متن: «دلتوئید خلفی و پایش کتف»؛ هم‌خانوادهٔ دلتوئید خلفی" },
  // ─── ⑤ شراگ → گردن و کول (هم‌سو با شراگ‌های دیگر) ───
  { id: "seed_ex_54", patch: { muscle: "گردن و کول" },
    why: "شراگ — دو ردیف شراگ دیگر «گردن و کول» دارند؛ این یکی سرشانه بود (تناقض درون‌خانواده)" },
  { id: "cmufkcyfd004f2b12trya9xlm", patch: { muscle: "گردن و کول" },
    why: "شراگ با دستگاه — همان بالا" },
  // ─── ⑥ خاص‌سازی عضله (بازوی مبهم → پشت بازو/جلو بازو) ───
  ...["seed_ex_61", "seed_ex_62", "seed_ex_63", "seed_ex_64", "seed_ex_184", "seed_ex_186", "seed_ex_192", "seed_ex_194"]
    .map((id) => ({ id, patch: { muscle: "پشت بازو" },
      why: "حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)" })),
  { id: "seed_ex_59", patch: { muscle: "جلو بازو" },
    why: "جلو بازو اسکات — عضلهٔ مبهم «بازو» → جلو بازو" },
  // ─── ⑦ پیلاتس ثبات‌محور → «شکم و کمر» (کانونی core) — حذف تناقض core/پشت ───
  ...["cmufkcy7j003h2b12j77kww76", "cmufkcyem004c2b126s5aw478", "cmufkcyio004z2b122m0idopn",
      "cmufkcyiy00502b12tcmitg3y", "cmufkcylq005d2b12dlleuz1f", "cmufkczdr009b2b12kne5rjxg"]
    .map((id) => ({ id, patch: { muscle: "شکم و کمر" },
      why: "حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر" })),
  ...["seed_dx_5", "seed_dx_54", "seed_dx_7", "seed_ex_215", "seed_ex_89", "seed_ex_90", "cmufkcz27007r2b12sx0sfhoj"]
    .map((id) => ({ id, patch: { muscle: "شکم و کمر" },
      why: "مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)" })),
  // ─── ⑧ پل باسن/ساید کیک (باسن‌محور) → legs (متناقض با cat=core نباشد) ───
  { id: "cmufkcydt00492b12nai36ttm", patch: { category: "legs" }, why: "ساید کیک — عضله «باسن» + cat=core متناقض؛ باسن‌محور = legs" },
  { id: "cmufkcydz004a2b12ne5ov5wi", patch: { category: "legs" }, why: "ساید کیک زانوزده — همان بالا" },
  { id: "cmufkcz73008e2b12jfvwbmgf", patch: { category: "legs" }, why: "پل دیواری — عضله «باسن» + cat=core متناقض" },
  { id: "cmufkcz7r008f2b12dvc6uhky", patch: { category: "legs" }, why: "پل شانه (Shoulder Bridge) — عضله «باسن» + cat=core متناقض" },
  // ─── ⑨ موبیلیتی/کششِ برچسب‌خورده fullbody با عضله «پشت» → core/شکم و کمر ───
  { id: "cmufkcxnz00162b12ujq9wsya", patch: { category: "core", muscle: "شکم و کمر" }, why: "باز کردن کتاب — چرخش توراسیک موبیلیتی؛ fullbody/پشت متناقض" },
  { id: "cmufkcyq500622b12o7bwjmt7", patch: { category: "core", muscle: "شکم و کمر" }, why: "نخ در سوزن — چرخش موبیلیتی؛ fullbody/پشت متناقض" },
  { id: "cmufkczba008y2b123r4ji805", patch: { category: "core", muscle: "شکم و کمر" }, why: "ژست کودک — کشش؛ fullbody/پشت متناقض" },
  // ─── ⑩ تجهیز = وسیلهٔ نام‌برده در نام/متن ───
  { id: "seed_ex_120", patch: { equipment: "dumbbell" }, why: "شنا سوئدی T-Push — متن: «با دو دمبل سبک»؛ equipment=bodyweight متناقض" },
  { id: "cmufkcy4e00342b126wu15i53", patch: { equipment: "bench" }, why: "دیپ روی نیمکت — نیمکت وسیلهٔ حرکت است (هم‌سو با «پشت بازو دیپس نیمکت»)" },
  { id: "cmufkcyod005q2b1231ij3otk", patch: { equipment: "bench" }, why: "لگ‌رایزر معکوس روی نیمکت — نیمکت وسیلهٔ حرکت است" },
  // ─── ⑪ واژگان تجهیز کانونی ───
  { id: "cmukfr7v801a82bdyuvjmcq21", patch: { equipment: "machine" }, why: "جلو بازو لاری دستگاه — «دستگاه لاری» → machine" },
  // ─── ⑫ تایپوی نام ───
  { id: "cmufkczef009g2b120j7gcygd", patch: { name: "کشش لات با کش از بالا" }, why: "«کشش لست» → «کشش لات» (تایپو)" },
  // ─── ⑬ جملهٔ عضلانی متناقض در ددلیفت سومو کتل‌بل ───
  { id: "seed_ex_220", patch2: true,
    desc: "کتل‌بل را وسط پاها بگیرید و با پنجه‌ها کمی بازتر، با ستون فقرات خنثی تا نزدیک زمین پایین بروید؛ در posture سومو زانوها به بیرون باز می‌مانند. با فشار کل کف پا به حالت ایستاده برگردید. عضلات اصلی درگیر، پشت (راست‌کننده‌های کمر) و زیربغل هستند و باسن و داخل ران به‌طور جدی فعال‌اند.",
    why: "جملهٔ قبلی «عضلات اصلی: باسن، داخل ران و همسترینگ» با هویت روز-پشتِ ددلیفت سومو در تضاد دیده می‌شد — متن با فیلد هم‌سو شد (صحت آناتومیک حفظ شد)" },
  // ─── ⑭ نکات ایمنی ناقصِ خانواده‌های آکسایل — تکمیل هم‌سو با خانواده ───
  { id: "seed_ex_149", tipsAppend: " تنه صاف و کمر خنثی بماند، زانوی جلو هم‌راستای پنجه و پاشنه‌ها روی زمین؛ مکث را با تنفس منظم و کنترل کامل اجرا کنید.",
    why: "اسکوات اسپلیت بلغاری با مکث — tips ۲۸ نویسه‌ای بدون هیچ نکتهٔ ایمنی اسکوات" },
  { id: "seed_ex_157", tipsAppend: " کمر خنثی و شکم سفت، زانوها هم‌راستای پنجه و وزن روی وسط پا تا پاشنه؛ تنفس را در مکث قطع نکنید.",
    why: "اسکوات ایزومتریک — tips ۲۶ نویسه‌ای بدون نکتهٔ ایمنی" },
  { id: "seed_ex_240", tipsAppend: " همیشه با یار کمکی، کتف‌ها جمع و پاها ثابت، میله کنترل‌شده پایین بیاید (نه رها شدن) و پرس با بازدم اجرا شود.",
    why: "پرس سینه هالتر با مکث پایین — حرکت هالتری سنگین بدون نکتهٔ ایمنی" },
  { id: "seed_ex_245", tipsAppend: " کش باید زیر و پشت نیمکت محکم مهار شده باشد، مسیر دمبل‌ها عمودی و متقارن بماند و قوس کمر اضافه نباشد.",
    why: "پرس سینه دمبل با کش مقاومتی — tips ۲۱ نویسه‌ای" },
  // ─── ⑮ هم‌سازسازی سوپرمن موتور محلی با بانک اصلی ───
  { em: true, id: "em-superman", patch: { muscle: "شکم و کمر", category: "core" },
    why: "سوپرمن در بانک اضطراری فال‌بک = پشت/pull ولی در بانک اصلی core — هم‌سازسازی" },
];

// ردیف «سیم کش» واقعی را پیدا کن (id نمونه بالا ممکن است متفاوت باشد)
const wireRow = db.prepare("SELECT id FROM ExerciseLibrary WHERE equipment = 'سیم کش'").all();
if (wireRow.length > 0) {
  const f = FIXES.find((x) => x.why && x.why.includes("سیم کش"));
  if (f && f.id !== wireRow[0].id) { f.id = wireRow[0].id; }
}

// واژگان تجهیز کانونی — bulk (بدون id مشخص)
const BULK_EQ = [
  { from: "سیم کش", to: "cable" },
  { from: "band", to: "resistance band" },
];

const sqlLines = [
  "-- ─────────────────────────────────────────────────────────────────────────",
  "-- v239 — پچ سازگاری بانک حرکات (تناقض صفر: نام/توضیحات/نکات ایمنی/فیلدها)",
  "-- اجرا روی سرور پس از دیپلوی:",
  "--   sqlite3 /var/www/fitup/db/custom.db < scripts/exercise-bank-consistency-patch-v239.sql",
  "-- اصول کانونی: RDL/تک‌پا/پا صاف → پا (پشت ران) | ددلیفت کلاسیک/سومو/رک → پشت |",
  "--   جلوبازو → pull | پشت‌بازو → push | فیس‌پول/پول‌آپارت → سرشانه | شراگ → گردن و کول |",
  "--   پیلاتس ثباتی → شکم و کمر | پل باسن/ساید کیک → legs | تجهیز = وسیلهٔ نام‌برده",
  "-- ─────────────────────────────────────────────────────────────────────────",
  "BEGIN TRANSACTION;",
];

function q(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

let applied = 0, skipped = 0;
for (const fix of FIXES) {
  const table = fix.em ? "… (fallback mini-bank — کد)" : "ExerciseLibrary";
  if (fix.em) {
    // فقط SQL گزارشی — سوپرمن موتور محلی با کد فیکس می‌شود نه SQL
    sqlLines.push(`-- [fallback-code] em-superman → muscle='شکم و کمر', category='core' — با کد v239 اصلاح شد`);
    continue;
  }
  const row = db.prepare("SELECT * FROM ExerciseLibrary WHERE id = ?").get(fix.id);
  if (!row) { console.error("!! ردیف یافت نشد:", fix.id); skipped++; continue; }
  const sets = [];
  const before = [];
  const after = [];
  const p = fix.patch || {};
  if (p.name && p.name !== row.name) { sets.push(`name = ${q(p.name)}`); before.push(row.name); after.push(p.name); }
  if (p.muscle && p.muscle !== row.muscle) { sets.push(`muscle = ${q(p.muscle)}`); before.push(row.muscle); after.push(p.muscle); }
  if (p.category && p.category !== row.category) { sets.push(`category = ${q(p.category)}`); before.push(row.category); after.push(p.category); }
  if (p.equipment && p.equipment !== row.equipment) { sets.push(`equipment = ${q(p.equipment)}`); before.push(row.equipment); after.push(p.equipment); }
  if (fix.desc && fix.desc !== row.description) { sets.push(`description = ${q(fix.desc)}`); before.push("(متن عضلانی قدیمی)"); after.push("(متن هم‌سو شده)"); }
  if (fix.tipsAppend) {
    const nt = String(row.tips || "").trim() + fix.tipsAppend;
    sets.push(`tips = ${q(nt)}`);
    before.push(`tips(${String(row.tips || "").length}n)`); after.push(`tips(${nt.length}n)`);
  }
  if (sets.length === 0) { console.error("~~ بدون تغییر (هم‌سو بود):", fix.id, "|", fix.why); skipped++; continue; }
  const stmt = `UPDATE ExerciseLibrary SET ${sets.join(", ")} WHERE id = ${q(fix.id)};`;
  sqlLines.push(`-- ${fix.why}`);
  sqlLines.push(stmt);
  applied++;
  if (!DRY) db.prepare(stmt.replace(/;$/, "")).run();
  console.log(`✅ ${fix.id} | ${row.name}: ${before.join(",")} → ${after.join(",")}`);
}

// ─── bulk تجهیز ───
for (const b of BULK_EQ) {
  const rows = db.prepare("SELECT id, name FROM ExerciseLibrary WHERE equipment = ?").all(b.from);
  if (rows.length === 0) continue;
  const stmt = `UPDATE ExerciseLibrary SET equipment = ${q(b.to)} WHERE equipment = ${q(b.from)};`;
  sqlLines.push(`-- واژگان تجهیز: «${b.from}» → «${b.to}» (${rows.length} ردیف)`);
  sqlLines.push(stmt);
  if (!DRY) db.prepare(stmt.replace(/;$/, "")).run();
  applied += rows.length;
  console.log(`✅ bulk equipment ${b.from} → ${b.to}: ${rows.length} ردیف`);
}

sqlLines.push("COMMIT;");
writeFileSync("scripts/exercise-bank-consistency-patch-v239.sql", sqlLines.join("\n") + "\n");
console.log(`\nAPPLIED=${applied} SKIPPED=${skipped} DRY=${DRY}`);
console.log("SQL → scripts/exercise-bank-consistency-patch-v239.sql");
