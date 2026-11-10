// ─────────────────────────────────────────────────────────────────────────────
// v239 — تست قطعی «تناقض صفر» بانک حرکات + پلیس معماری
// سناریوی مالک: «یک روز پا داد و در دو روز دیگه از جمله روز کمر ددلیفت داده»
// پاسخ حرفه‌ای: ددلیفت کلاسیک در روز پشت = استاندارد ✓ | RDL در روز پا = استاندارد ✓
// تضمین v239: RDL هرگز در روز پشت نمی‌ماند و ددلیفت کلاسیک هرگز در روز پا نمی‌ماند.
// اجرا: bun scripts/tmp/test-bank-consistency-v239.ts
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "@/lib/db";
import {
  primaryGroupOfExercise,
  majorGroupsOfExercise,
} from "../../src/lib/fitness/exercise-bank-lock";
import { enforceBlueprintDayIdentity } from "../../src/lib/fitness/coach-blueprint";
import type { CoachBlueprint } from "../../src/lib/fitness/coach-blueprint";

let pass = 0, fail = 0;
function ok(cond: boolean, label: string, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); }
}

const rows: any[] = await db.exerciseLibrary.findMany({
  where: { isActive: true },
  select: { id: true, name: true, muscle: true, category: true, equipment: true, description: true, tips: true },
});
const bank = { all: rows };
const byName = (re: RegExp) => rows.filter((r: any) => re.test(String(r.name)));

console.log("\n═══ ① گروه اولیهٔ موتور روی ردیف‌های فیکس‌شده ═══");
const expectPrimary: Array<[RegExp, string | null, string]> = [
  [/ددلیفت رومانیایی با کش/, "legs", "RDL با کش → پا"],
  [/ددلیفت رومانیایی دمبل تک‌پا/, "legs", "RDL دمبل تک‌پا → پا"],
  [/ددلیفت تک‌پا با دمبل/, "legs", "ددلیفت تک‌پا دمبل → پا"],
  [/^ددلیفت \(|ددلیفت کلاسیک|ددلیفت سومو$/, "back", "ددلیفت کلاسیک/سومو → پشت"],
  [/شراگ/, "back", "شراگ (کول) → پشت"],
  [/جلو بازو لاری/, "arms", "جلوبازو لاری → بازو"],
  [/زیر بغل سیم کش خم|زیربغل سیم کش خم/, "back", "زیربغل سیم‌کش خم → پشت"],
  [/پول‌اور دمبل/, "back", "پول‌اور دمبل → پشت"],
  [/فیس‌پول با کش|فیس پول سرشانه|پول‌آپارت/, "shoulders", "خانوادهٔ دلتوئید خلفی → سرشانه"],
  [/پل شانه|پل دیواری|ساید کیک/, "legs", "پل باسن/ساید کیک → پا"],
  [/سوپرمن|برد داگ|سگ-گربه|قو \(|قو پیلاتس|\bقو\b(?!ر)/, "core", "پیلاتس ثباتی → core"],
];
for (const [re, want, label] of expectPrimary) {
  const list = byName(re);
  ok(list.length > 0, `${label} — ردیف پیدا شد (${list.length})`);
  for (const r of list) {
    const pg = primaryGroupOfExercise(r as any);
    ok(pg === want, `${label}: «${r.name}» primary=${pg} انتظار=${want}`);
  }
}

console.log("\n═══ ② پلیس معماری — سناریوی دقیق مالک ═══");
// بلوپرینت تجویزی مصطفی (چهارشنبه = پشت+پشت‌بازو، دوشنبه = پا)
const bp: CoachBlueprint = {
  splitId: "admin_prescribed",
  splitLabelFa: "تجویز مدیر",
  coachModelFa: "تست",
  coachKey: "mixed",
  periodizationHint: "linear",
  days: [
    { day: "دوشنبه", title: "پا", primary: ["چهارسر", "باسن"], secondary: ["پشت پا", "ساق", "شکم و مرکز"], rationale: "" },
    { day: "چهارشنبه", title: "پشت + پشت بازو", primary: ["زیربغل/پشت", "پشت بازو"], secondary: ["ساعد", "شکم و مرکز"], rationale: "" },
  ] as any,
  weeklySets: [],
} as any;

function runPolice(dayEx: any[]): any[] {
  const plan = { days: [{ day: "دوشنبه", title: "پا", exercises: [] as any[] }, { day: "چهارشنبه", title: "پشت + پشت بازو", exercises: dayEx }] };
  enforceBlueprintDayIdentity(plan as any, bp, bank as any);
  return plan.days[1].exercises;
}
const mk = (name: string) => {
  const r = rows.find((x: any) => x.name === name) || rows.find((x: any) => reOf(name).test(x.name));
  return r ? { name: r.name, muscle: r.muscle, category: r.category, exerciseId: r.id } : { name, muscle: "", category: "" };
  function reOf(n: string) { return new RegExp(n); }
};

// الف) RDL در روز پشت → باید تعویض/حذف شود
{
  const out = runPolice([mk("ددلیفت رومانیایی دمبل (Dumbbell Romanian Deadlift)")]);
  const kept = out.some((e: any) => /رومانیایی/i.test(e.name));
  ok(!kept, "RDL در روز پشت → تعویض شد (خارج از معماری)", JSON.stringify(out.map((e: any) => e.name)));
}
// ب) RDL با کش در روز پشت → همان
{
  const out = runPolice([mk("ددلیفت رومانیایی با کش")]);
  const kept = out.some((e: any) => /رومانیایی/i.test(e.name));
  ok(!kept, "RDL با کش در روز پشت → تعویض شد", JSON.stringify(out.map((e: any) => e.name)));
}
// ج) ددلیفت کلاسیک در روز پشت → باید بماند (استاندارد مربیگری — سؤال مالک)
// نکته: پلیس §② تا ۲ حرکت primary به روز اضافه می‌کند — سنجه = عضویت، نه طول
{
  const out = runPolice([mk("ددلیفت (Deadlift)")]);
  ok(out.some((e: any) => /ددلیفت \(|^ددلیفت کلاسیک$/.test(e.name) && !/رومانیایی|تک‌پا/.test(e.name)), "ددلیفت کلاسیک در روز پشت → می‌ماند ✓", JSON.stringify(out.map((e: any) => e.name)));
}
// د) ددلیفت کلاسیک در روز پا → باید تعویض شود
{
  const plan = { days: [{ day: "دوشنبه", title: "پا", exercises: [mk("ددلیفت (Deadlift)")] }] };
  enforceBlueprintDayIdentity(plan as any, bp, bank as any);
  const kept = plan.days[0].exercises.some((e: any) => /ددلیفت \(|ددلیفت کلاسیک/.test(e.name) && !/رومانیایی|تک‌پا/.test(e.name));
  ok(!kept, "ددلیفت کلاسیک در روز پا → تعویض شد", JSON.stringify(plan.days[0].exercises.map((e: any) => e.name)));
}
// هـ) شراگ در روز پا → تعویض (فیکس کول→back)
{
  const plan = { days: [{ day: "دوشنبه", title: "پا", exercises: [mk("شراگ هالتر (Barbell Shrug)")] }] };
  enforceBlueprintDayIdentity(plan as any, bp, bank as any);
  const kept = plan.days[0].exercises.some((e: any) => /شراگ/.test(e.name));
  ok(!kept, "شراگ در روز پا → تعویض شد (نقطهٔ کور بسته شد)", JSON.stringify(plan.days[0].exercises.map((e: any) => e.name)));
}
// و) شراگ در روز پشت → می‌ماند (سنجه = عضویت)
{
  const out = runPolice([mk("شراگ هالتر (Barbell Shrug)")]);
  ok(out.some((e: any) => /شراگ/.test(e.name)), "شراگ در روز پشت → می‌ماند ✓");
}
// ز) جلوبازو لاری در روز «پشت + پشت‌بازو»: گروه arms مجاز ثانویهٔ این روز است
// (پشت‌بازو → arms) — پس جلوبازو هم مجاز است (طراحی پلیس v213/v230) — باید بماند
{
  const out = runPolice([mk("جلو بازو لاری دمبل")]);
  const kept = out.some((e: any) => /لاری/.test(e.name));
  ok(kept, "جلوبازو لاری در روز پشت+پشت‌بازو → می‌ماند (arms مجازِ ثانویه) ✓", JSON.stringify(out.map((e: any) => e.name)));
}
// ح) ساید کیک در روز پا → می‌ماند (legs — سنجه = عضویت)
{
  const plan = { days: [{ day: "دوشنبه", title: "پا", exercises: [mk("ساید کیک (Side Kick)")] }] };
  enforceBlueprintDayIdentity(plan as any, bp, bank as any);
  ok(plan.days[0].exercises.some((e: any) => /ساید کیک/.test(e.name)), "ساید کیک در روز پا → می‌ماند ✓");
}

console.log("\n═══ ③ سازگاری درون‌خانواده (متن ↔ فیلد) ═══");
// متن توضیحات نباید عضلهٔ اصلیِ خارج از فیلد بگوید — فقط با الگوی صریح
const MENTION = [
  [/همسترینگ|پشت ?ران/i, "legs"], [/چهارسر/i, "legs"], [/باسن|سرینی/i, "legs"], [/ساق/i, "legs"],
  [/زیربغل|لاتیسیموس|عریضه(?:ٔ)? ?پشتی/i, "back"], [/راست[\u200C ]?کننده(?:[\u200C]?های)?[\u200C ]?کمر/i, "back"],
  [/کول/i, "back"],
  [/سینه|پکتورال/i, "chest"], [/دلتوئید/i, "shoulders"],
  [/جلوبازو|جلو بازو|بایسپس/i, "arms"], [/پشت ?بازو|تریسپس/i, "arms"], [/ساعد/i, "arms"],
  [/شکم|ابدومینال/i, "core"],
];
let txtIssues = 0;
for (const r of rows as any[]) {
  const d = String(r.description || "");
  // جملهٔ کاملِ حاوی «عضلات اصلی/درگیر» (نه فقط از عبارت به بعد — عضلهٔ اصلی ممکن
  // است قبل از «عضلات اصلی» نام برده شود: «زیربغل و میانی پشت عضلات اصلی و …»)
  const m = d.match(/[^.]*(?:عضلات? (?:اصلی|درگیر))[^.]*(?:هستند|است)/);
  if (!m) continue;
  const cls = new Set<string>();
  for (const [re, c] of MENTION) if (re.test(m[0])) cls.add(c);
  if (cls.size === 0) continue;
  const pg = primaryGroupOfExercise(r as any);
  if (!pg || pg === "core") continue;
  if (!cls.has(pg)) { txtIssues++; console.log(`  ⚠️ «${r.name}» primary=${pg} | متن: ${m[0].slice(0, 90)}`); }
}
ok(txtIssues === 0, `متنِ «عضلات اصلی» با فیلد عضله در کل بانک هم‌سو است (${txtIssues} تناقض)`);

console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
process.exit(fail > 0 ? 1 : 0);
