/**
 * تست واحد v149 — «بازطراحی از چت: برنامه عیناً عین درخواست ورزشکار»
 * تیکت مالک: کاربر «۳ روز بالاتنه، ۱ روز پایین تنه» خواست و ۴ روز بالاتنه گرفت.
 *
 * پوشش:
 *   ① پارسر ساختاری (فارسی محاوره + انگلیسی + حالت‌های منفی)
 *   ② توضیح فارسی اسپک + دیرکتیو الزامی (لغو بند A)
 *   ③ طبقه‌بندی واقعی روزها از روی عضلات حرکات
 *   ④ ترمیم قطعی: برنامهٔ «۴ روز بالاتنه» → «۳ بالاتنه + ۱ پایین‌تنه» با حرکات
 *      ویدیودار واقعی بانک + focus/label درست + خط شفافیت در نکات
 *   ⑤ idempotency (اجرای دوم no-op) + case برعکس (۴ روز پا → ۳ بالا + ۱ پا)
 *   ⑥ fail-safe: بانک null → هیچ تخریبی انجام نمی‌شود
 *
 * اجرا: cd /home/z/my-project && bun run scripts/tests/v149-redesign-split.test.ts
 */
import {
  parseRequestedSplitFromText,
  describeSplitSpecFa,
  buildRedesignDirectiveFa,
  classifyPlanDayRegion,
  repairPlanDaySplitToRequest,
  describeSplitMismatch,
  type RequestedSplitSpec,
} from "../../src/lib/fitness/plan-redesign-request";
import {
  buildLockedBank,
  type BankExerciseRow,
} from "../../src/lib/fitness/exercise-bank-lock";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ─────────────── بانک ساختگی واقع‌گرا (فقط ویدیودار) ─────────────── */
function row(id: string, name: string, muscle: string, category: string): BankExerciseRow {
  return {
    id, name, muscle, category,
    equipment: "dumbbell",
    description: "توضیح تست",
    tips: "نکتهٔ تست",
    videoUrl: `https://youtube.com/watch?v=${id}`,
    youtubeEnabled: true,
  };
}

const bankRows: BankExerciseRow[] = [
  // پا — ۸ حرکت (برای بازسازی کامل روز پایین‌تنه)
  row("lg1", "اسکوات هالتر", "پا", "legs"),
  row("lg2", "پرس پا دستگاه", "پا", "legs"),
  row("lg3", "لانژ دمبل", "پا", "legs"),
  row("lg4", "ددلیفت رومانیایی", "پشت پا", "legs"),
  row("lg5", "جلو پا دستگاه", "چهارسر", "legs"),
  row("lg6", "پشت پا خوابیده", "پشت پا", "legs"),
  row("lg7", "ساق ایستاده", "ساق", "legs"),
  row("lg8", "هیپ تراست", "باسن", "legs"),
  // سینه
  row("ch1", "پرس سینه هالتر", "سینه", "push"),
  row("ch2", "پرس سینه دمبل", "سینه", "push"),
  row("ch3", "قفسه سینه دمبل", "سینه", "push"),
  row("ch4", "پرس بالاسینه هالتر", "سینه", "push"),
  row("ch5", "پرس سینه سیم‌کش", "سینه", "push"),
  // زیربغل
  row("bk1", "بارفیکس دست‌باز", "زیربغل", "pull"),
  row("bk2", "لت دست‌باز", "زیربغل", "pull"),
  row("bk3", "روئینگ هالتر", "زیربغل", "pull"),
  row("bk4", "روئینگ سیم‌کش", "زیربغل", "pull"),
  // سرشانه
  row("sh1", "پرس سرشانه دمبل", "سرشانه", "push"),
  row("sh2", "نشر جانب دمبل", "سرشانه", "push"),
  row("sh3", "نشر خم دمبل", "سرشانه خم", "push"),
  // بازو
  row("ar1", "جلو بازو هالتر", "جلوبازو", "push"),
  row("ar2", "پشت بازو سیم‌کش", "پشت‌بازو", "push"),
  row("ar3", "جلو بازو دمبل", "جلوبازو", "push"),
  row("ar4", "جلوبازو لاری", "جلوبازو", "push"),
  // شکم
  row("co1", "پلانک", "شکم", "core"),
  row("co2", "کرانچ شکم", "شکم", "core"),
];
const bank = buildLockedBank(bankRows, true);

function ex(id: string): Record<string, any> {
  const r = bankRows.find((x) => x.id === id)!;
  return { name: r.name, muscle: r.muscle, category: r.category, exerciseId: r.id, sets: [{ setNumber: 1, reps: "10", restSec: 90 }] };
}

/* ═════════════ ① پارسر ساختاری ═════════════ */
console.log("\n── ① پارسر درخواست چیدمان ──");
{
  const p1 = parseRequestedSplitFromText("برنامم رو بازطراحی کن: سه روز بالاتنه بده یک روز پایین تنه");
  check("محاورهٔ دقیق تیکت: «سه روز بالاتنه بده یک روز پایین تنه»",
    !!p1 && p1.spec.upper === 3 && p1.spec.lower === 1,
    JSON.stringify(p1?.spec));

  const p2 = parseRequestedSplitFromText("۴ روز بالاتنه ۲ روز پایین تنه بچین");
  check("اعداد فارسی: «۴ روز بالاتنه ۲ روز پایین تنه»",
    !!p2 && p2.spec.upper === 4 && p2.spec.lower === 2, JSON.stringify(p2?.spec));

  const p3 = parseRequestedSplitFromText("2 upper days, 1 leg day please");
  check("انگلیسی: «2 upper days, 1 leg day»",
    !!p3 && p3.spec.upper === 2 && p3.spec.lower === 1, JSON.stringify(p3?.spec));

  const p4 = parseRequestedSplitFromText("بالاتنه سه روز و پا یک روز");
  check("ترتیب معکوس: «بالاتنه سه روز و پا یک روز»",
    !!p4 && p4.spec.upper === 3 && p4.spec.lower === 1, JSON.stringify(p4?.spec));

  const p5 = parseRequestedSplitFromText("۳ روز بالاتنه + ۱ روز پایین‌تنه");
  check("خلاصهٔ کارت تایید با نیم‌فاصله: «۳ روز بالاتنه + ۱ روز پایین‌تنه»",
    !!p5 && p5.spec.upper === 3 && p5.spec.lower === 1, JSON.stringify(p5?.spec));

  const p6 = parseRequestedSplitFromText("برنامه غذایی رو عوض کن، غذاهای دریایی بیشتر باشه");
  check("منفی: درخواست غذایی بدون چیدمان → null", p6 === null);

  const p7 = parseRequestedSplitFromText("هفته‌ای ۵ روز تمرین می‌کنم، برنامه رو بازطراحی کن");
  check("منفی: عدد بدون واژهٔ ناحیه («۵ روز تمرین») → null", p7 === null, JSON.stringify(p7?.spec));

  const p8 = parseRequestedSplitFromText("یک روز بالاتنه بده بعداً ۳ جلسه پا بریم");
  check("عدد ناحیهٔ مجاور آلوده نشود: «یک روز بالاتنه… ۳ جلسه پا» → upper=1 فقط",
    !!p8 && p8.spec.upper === 1 && p8.spec.lower === 3, JSON.stringify(p8?.spec));

  const p10 = parseRequestedSplitFromText("۲ روز بالاتنه ۴ روز پایین تنه بچین");
  check("دو جفت پشت‌سرهم: «۲ روز بالاتنه ۴ روز پایین تنه» → 2+4",
    !!p10 && p10.spec.upper === 2 && p10.spec.lower === 4, JSON.stringify(p10?.spec));

  const p11 = parseRequestedSplitFromText("4 بالاتنه 2 پایین تنه");
  check("بدون واحد: «4 بالاتنه 2 پایین تنه» → 4+2",
    !!p11 && p11.spec.upper === 4 && p11.spec.lower === 2, JSON.stringify(p11?.spec));

  const p12 = parseRequestedSplitFromText("پا یک روز بالاتنه ۲ روز بچین برام");
  check("پشتی‌مالکیت با واحد: «پا یک روز بالاتنه ۲ روز» → 1+2",
    !!p12 && p12.spec.lower === 1 && p12.spec.upper === 2, JSON.stringify(p12?.spec));

  const p9 = parseRequestedSplitFromText("دو روز بدن کامل بده");
  check("بدن کامل: «دو روز بدن کامل» → fullBody=2",
    !!p9 && p9.spec.fullBody === 2, JSON.stringify(p9?.spec));
}

/* ═════════════ ② توضیح + دیرکتیو ═════════════ */
console.log("\n── ② دیرکتیو «درخواست صریح ورزشکار» ──");
{
  const spec: RequestedSplitSpec = { upper: 3, lower: 1 };
  const desc = describeSplitSpecFa(spec);
  check("توضیح فارسی: «۳ روز بالاتنه + ۱ روز پایین‌تنه»", desc.includes("۳ روز بالاتنه") && desc.includes("۱ روز پایین‌تنه"), desc);

  const dir = buildRedesignDirectiveFa(spec, "سه روز بالاتنه بده یک روز پایین تنه", "چیدمان ۳+۱ توافق شد");
  check("دیرکتیو شامل «درخواست صریح و الزامی ورزشکار» است", dir.includes("درخواست صریح و الزامی ورزشکار"));
  check("دیرکتیو صریحاً بند A را لغو می‌کند", dir.includes("لغو"));
  check("دیرکتیو متن خود کاربر را حمل می‌کند", dir.includes("سه روز بالاتنه بده یک روز پایین تنه"));
  check("دیرکتیو خلاصهٔ توافق‌شده را حمل می‌کند", dir.includes("چیدمان ۳+۱ توافق شد"));
}

/* ═════════════ ③ طبقه‌بندی روز ═════════════ */
console.log("\n── ③ طبقه‌بندی ناحیهٔ روز از عضلات واقعی ──");
{
  const legDay = { day: "شنبه", exercises: [ex("lg1"), ex("lg2"), ex("lg3"), ex("lg4"), ex("lg7")] };
  const upperDay = { day: "یکشنبه", exercises: [ex("ch1"), ex("ch2"), ex("bk1"), ex("sh1"), ex("ar1"), ex("co1")] };
  const fullDay = {
    day: "دوشنبه",
    exercises: [
      { name: "برپی کامل", muscle: "کل بدن", category: "fullbody" },
      { name: "دودل کل بدن", muscle: "کل بدن", category: "fullbody" },
    ],
  };
  check("روز پا → lower", classifyPlanDayRegion(legDay) === "lower");
  check("روز بالاتنه → upper", classifyPlanDayRegion(upperDay) === "upper");
  check("روز کل‌بدن → fullbody", classifyPlanDayRegion(fullDay) === "fullbody");
  check("روز خالی → unknown", classifyPlanDayRegion({ day: "x", exercises: [] }) === "unknown");
}

/* ═════════════ ④ ترمیم سناریوی دقیق تیکت: ۴ روز بالاتنه → ۳+۱ ═════════════ */
console.log("\n── ④ ترمیم «۴ روز بالاتنه» به «۳ بالا + ۱ پا» (سناریوی تیکت) ──");
{
  const plan = {
    notes: "- نکتهٔ موجود",
    days: [
      { day: "شنبه", title: "سینه و بازو", focus: "سینه", exercises: [ex("ch1"), ex("ch2"), ex("ar1"), ex("ar2"), ex("co2")] },
      { day: "یکشنبه", title: "زیربغل", focus: "زیربغل", exercises: [ex("bk1"), ex("bk2"), ex("bk3"), ex("ar3"), ex("co1")] },
      { day: "دوشنبه", title: "سرشانه", focus: "سرشانه", exercises: [ex("sh1"), ex("sh2"), ex("ch3"), ex("ch4")] },
      { day: "سه‌شنبه", title: "بالاتنه دوم", focus: "سینه", exercises: [ex("ch5"), ex("bk4"), ex("sh3"), ex("ar4")] },
    ],
  };
  const spec: RequestedSplitSpec = { upper: 3, lower: 1 };
  const before = describeSplitMismatch(plan.days, spec);
  check("قبل از ترمیم ناهم‌خوانی شناسایی می‌شود", !!before && before.includes("lower"), before ?? "null");

  const report = repairPlanDaySplitToRequest(plan as any, spec, bank);
  check("یک روز تبدیل شده است", report.converted.length === 1, JSON.stringify(report.converted));
  check("روزِ تبدیل‌شده → lower", report.converted[0]?.to === "lower");
  check("خط شفافیت به نکات اضافه شد", report.noteAdded === true && (plan.notes ?? "").includes("طبق درخواست صریح شما"));

  const regions = plan.days.map((d: any) => classifyPlanDayRegion(d));
  const upperCount = regions.filter((r) => r === "upper").length;
  const lowerCount = regions.filter((r) => r === "lower").length;
  check("بعد از ترمیم: دقیقاً ۳ روز بالاتنه", upperCount === 3, JSON.stringify(regions));
  check("بعد از ترمیم: دقیقاً ۱ روز پایین‌تنه", lowerCount === 1, JSON.stringify(regions));

  const convertedDay = plan.days.find((d: any) => classifyPlanDayRegion(d) === "lower") as any;
  check("focus روز پایین‌تنه اصلاح شد", typeof convertedDay.focus === "string" && convertedDay.focus.includes("پایین‌تنه"), convertedDay.focus);
  check("همهٔ حرکات روز جدید exerciseId بانک دارند", convertedDay.exercises.every((e: any) => typeof e.exerciseId === "string" && !!e.exerciseId));
  check("حرکات روز جدید همگی پا هستند", convertedDay.exercises.every((e: any) => /پا|باسن|ساق|چهارسر|همسترینگ/.test(e.muscle ?? "") || /اسکوات|پرس پا|لانژ|ددلیفت|هیپ|ساق/.test(e.name)));
  const ids = plan.days.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
  check("هیچ حرکتی در کل برنامه دوبار نیامده", new Set(ids).size === ids.length);

  // idempotency
  const report2 = repairPlanDaySplitToRequest(plan as any, spec, bank);
  check("اجرای دوم no-op است (idempotent)", report2.alreadyOk === true && report2.converted.length === 0, JSON.stringify(report2));
  check("نکتهٔ شفافیت دوبار اضافه نشد", (plan.notes ?? "").split("طبق درخواست صریح شما").length - 1 === 1);
}

/* ═════════════ ⑤ case برعکس: ۴ روز پا → ۳ بالا + ۱ پا ═════════════ */
console.log("\n── ⑤ ترمیم برعکس: «۴ روز پایین‌تنه» → «۳ بالا + ۱ پا» ──");
{
  const plan = {
    notes: "",
    days: [
      { day: "شنبه", title: "پا", focus: "پا", exercises: [ex("lg1"), ex("lg2"), ex("lg3"), ex("lg4")] },
      { day: "یکشنبه", title: "پا ۲", focus: "پا", exercises: [ex("lg5"), ex("lg6"), ex("lg7"), ex("lg8")] },
      { day: "دوشنبه", title: "پا ۳", focus: "پا", exercises: [ex("lg1"), ex("lg3"), ex("lg4"), ex("lg7")] },
      { day: "سه‌شنبه", title: "پا ۴", focus: "پا", exercises: [ex("lg2"), ex("lg5"), ex("lg6"), ex("lg8")] },
    ],
  };
  const spec: RequestedSplitSpec = { upper: 3, lower: 1 };
  const report = repairPlanDaySplitToRequest(plan as any, spec, bank);
  const regions = plan.days.map((d: any) => classifyPlanDayRegion(d));
  check("۳ روز بالاتنه ساخته شد", regions.filter((r) => r === "upper").length === 3, JSON.stringify(regions));
  check("۱ روز پایین‌تنه ماند", regions.filter((r) => r === "lower").length === 1, JSON.stringify(regions));
  check("گزارش تبدیل ۳ روز است", report.converted.length === 3, JSON.stringify(report.converted));
  const ids = plan.days.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId));
  check("بدون تکرار حرکت در کل برنامه", new Set(ids).size === ids.length);
  const upperDays = plan.days.filter((d: any) => classifyPlanDayRegion(d) === "upper") as any[];
  check("روزهای بالاتنه ترکیب گروهی دارند (نه تک‌گروه انباشته)", upperDays.every((d) => {
    const groups = new Set(d.exercises.map((e: any) => (e.muscle || "").replace(/[\s\u200C]/g, "").slice(0, 4)));
    return groups.size >= 2;
  }));
}

/* ═════════════ ⑥ fail-safe: بانک null ═════════════ */
console.log("\n── ⑥ fail-safe ──");
{
  const plan = {
    notes: "n",
    days: [
      { day: "شنبه", focus: "سینه", exercises: [ex("ch1"), ex("ch2"), ex("ch3")] },
      { day: "یکشنبه", focus: "سینه", exercises: [ex("ch4"), ex("ar1"), ex("ar2")] },
      { day: "دوشنبه", focus: "زیربغل", exercises: [ex("bk1"), ex("bk2"), ex("bk3")] },
      { day: "سه‌شنبه", focus: "سرشانه", exercises: [ex("sh1"), ex("sh2"), ex("co1")] },
    ],
  };
  const beforeJson = JSON.stringify(plan.days.map((d: any) => d.exercises.map((e: any) => e.exerciseId)));
  const report = repairPlanDaySplitToRequest(plan as any, { upper: 3, lower: 1 }, null);
  const afterJson = JSON.stringify(plan.days.map((d: any) => d.exercises.map((e: any) => e.exerciseId)));
  check("بانک null → هیچ حرکتی تغییر نکرد (pool exhausted)", report.poolExhausted === true && beforeJson === afterJson);
}

/* ═════════════ نتیجه ═════════════ */
console.log(`\n═══ نتیجه: ${pass} سبز / ${fail} قرمز ═══`);
if (fail > 0) process.exit(1);
