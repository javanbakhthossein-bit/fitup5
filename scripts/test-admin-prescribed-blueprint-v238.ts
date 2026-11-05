/**
 * test-admin-prescribed-blueprint-v238.ts
 * تست قطعی فیکس «بازنویسی مدیر دوباره ۲ روز پا داد» (تیکت مصطفی خوشبخت):
 *  ۱) پارسر چیدمان: عین متن مدیر در تیکت → ۴ روز دقیق؛ دام «۳ روز پا داره» نباید بخورد
 *  ۲) دام‌های منفی: متن بدون چیدمان / کمتر از ۳ روز / خط پروس‌وار → null
 *  ۳) پلیس معماری با بلوپرینت تجویزی روی «برنامهٔ واقعی v7 مصطفی» (از دامپ تولیدی):
 *     چهارشنبهٔ پا → پشت+پشت‌بازو می‌شود؛ سه روز دیگر دست‌نخورده
 *  ۴) گیت‌ها: سقف فرکانس (پا=۱ روز) + انطباق معماری — صفر critical
 * اجرا: bun run scripts/test-admin-prescribed-blueprint-v238.ts
 */
import { Database } from "bun:sqlite";
import {
  buildAdminPrescribedBlueprintFromText,
  parseAdminPrescribedDayLayout,
} from "../src/lib/fitness/admin-prescribed-blueprint";
import {
  enforceBlueprintDayIdentity,
  enforceBlueprintDayTitles,
  blueprintSnapshotForPlan,
} from "../src/lib/fitness/coach-blueprint";
import {
  auditGroupFrequencyCap,
  auditBlueprintAdherence,
} from "../src/lib/fitness/plan-quality-gate";
import { majorGroupsOfExercise, primaryGroupOfExercise } from "../src/lib/fitness/exercise-bank-lock";

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.error(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
};

/* ───────── متن واقعی مدیر (کپیِ عین درخواست کاربر در تیکت cmv6cmp9403lf2barkskodyil) ───────── */
const ADMIN_TEXT = `چیدمان جدید ۴ روزه:

شنبه: سینه + زیربغل (کامل
دوشنبه: پا (فقط یک روز، ولی کامل — چهارسر، همسترینگ، باسن، ساق، مرکز بدن)
سه‌شنبه: سرشانه + بازو (کامل)
چهارشنبه: پشت + پشت بازو (کامل)
۱) برنامهٔ فعلی ۳ روز پا داره (دوشنبه، سه‌شنبه، چهارشنبه) که برای وزن ۱۲۲ کیلو و هدف چربی‌سوزی زیاده و ریکاوری کامل نمی‌شه. تعداد روز‌های پا به ۱ روز کامل کاهش پیدا کنه.
۲) روز سه‌شنبه از پا به سرشانه + بازو تغییر کنه.
۳) روز چهارشنبه از حرکات فعلی به پشت + پشت بازو تغییر کنه.
۴) هیپ تراست هالتر با پل باسن جایگزین بشه (امن‌تر برای کمر).
۵) تعداد روز‌های تمرین همون ۴ روز حفظ بشه`;

console.log("═ ۱) پارسر چیدمان — متن واقعی مدیر");
const parsed = parseAdminPrescribedDayLayout(ADMIN_TEXT);
ok(parsed !== null, "چیدمان صریح شناسایی شد");
ok(parsed?.length === 4, "دقیقاً ۴ روز (نه ۵ — خط شماره‌دار نشت نکرده)", parsed?.map(d=>d.day).join("،"));
const byDay = new Map((parsed ?? []).map((d) => [d.day, d.groups]));
const sh = byDay.get("شنبه") ?? [];
ok(sh.includes("سینه") && sh.includes("زیربغل/پشت") && sh.length === 2, "شنبه = سینه + زیربغل فقط", sh.join("+"));
const doh = byDay.get("دوشنبه") ?? [];
ok(doh.includes("چهارسر") && doh.includes("پشت پا") && doh.includes("باسن") && doh.includes("ساق") && doh.includes("شکم و مرکز"), "دوشنبه = روز پا کامل", doh.join("+"));
const se = byDay.get("سه‌شنبه") ?? [];
ok(se.includes("سرشانه") && se.includes("جلو بازو") && se.includes("پشت بازو") && !se.includes("پشت پا"), "سه‌شنبه = سرشانه + بازو (بدون پا)", se.join("+"));
const ch = byDay.get("چهارشنبه") ?? [];
ok(ch.includes("زیربغل/پشت") && ch.includes("پشت بازو") && !ch.includes("پشت پا") && !ch.includes("چهارسر"), "چهارشنبه = پشت + پشت‌بازو (بدون پا)", ch.join("+"));

console.log("═ ۲) دام‌های منفی پارسر");
ok(parseAdminPrescribedDayLayout("تعداد روز‌های پا به ۱ روز کاهش پیدا کنه و هر عضله فرکانس ۲ بگیره") === null, "تک‌خط توصیه‌ای بدون چیدمان → null");
ok(parseAdminPrescribedDayLayout("شنبه: سینه + زیربغل\nدوشنبه: پا کامل") === null, "دو روز تنها (کمتر از ۳) → null");
ok(parseAdminPrescribedDayLayout("۱) برنامهٔ فعلی ۳ روز پا داره (دوشنبه، سه‌شنبه، چهارشنبه)\n۲) روز سه‌شنبه از پا به سرشانه + بازو تغییر کنه\n۳) روز چهارشنبه از حرکات فعلی به پشت + پشت بازو تغییر کنه") === null, "فقط خط‌های شماره‌دار (شرح وضعیت) → null — دام «۳ روز پا داره»");
ok(parseAdminPrescribedDayLayout("کاربر کمردرد دارد، حرکت سنگین نده") === null, "متن عادی → null");
ok(parseAdminPrescribedDayLayout("") === null && parseAdminPrescribedDayLayout(undefined as unknown as string) === null, "متن خالی/undefined → null");

console.log("═ ۳) بلوپرینت تجویزی");
const prescribed = buildAdminPrescribedBlueprintFromText(ADMIN_TEXT);
ok(prescribed !== null, "بلوپرینت ساخته شد");
ok(prescribed?.blueprint.splitId === "admin_prescribed", "splitId = admin_prescribed");
ok(prescribed?.blueprint.days.length === 4, "۴ روز در بلوپرینت");
const chBp = prescribed?.blueprint.days.find((d) => d.day === "چهارشنبه");
ok(chBp?.primary.includes("زیربغل/پشت") && chBp?.primary.includes("پشت بازو"), "هویت چهارشنبه در بلوپرینت = پشت/پشت‌بازو");

/* ───────── بانک حرکات واقعی از دیتابیس سندباکس ───────── */
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const rows = db.prepare("SELECT id,name,muscle,category,description,tips FROM ExerciseLibrary WHERE isActive=1").all();
const bank = { all: rows as Array<Record<string, unknown>> };
console.log(`  بانک: ${rows.length} حرکت فعال`);

/* ───────── برنامهٔ واقعی v7 مصطفی از دامپ تولیدی ───────── */
const prod = new Database("/home/z/my-project/download/db-2026-10-14-0021/fitup-db-2026-10-14-0021", { readonly: true });
const v7 = prod.prepare("SELECT content FROM WorkoutPlan WHERE userId='cmui9gu1800632b8d8qbmkjjl' AND version=7").get() as { content: string };
prod.close();
const plan = JSON.parse(v7.content);
const legsOnWedBefore = (plan.days.find((d: any) => String(d.day).includes("چهارشن"))?.exercises ?? [])
  .filter((e: any) => primaryGroupOfExercise(e) === "legs").length;
ok(legsOnWedBefore > 0, `شکایت بازتولید شد: چهارشنبهٔ v7 فعلاً ${legsOnWedBefore} حرکت پا دارد`);

console.log("═ ۴) پلیس معماری با تجویز مدیر روی برنامهٔ واقعی v7");
const bpReport = enforceBlueprintDayIdentity(plan, prescribed!.blueprint, bank as never, []);
console.log(`  تعویض‌ها: ${bpReport.replaced.map((r) => `[${r.day}] ${r.from}→${r.to}`).join(" | ").slice(0, 500)}`);
const titleRewrites = enforceBlueprintDayTitles(plan, prescribed!.blueprint);
console.log(`  عنوان‌ها: ${titleRewrites.map((r) => `[${r.day}] «${r.from.slice(0, 22)}…»→«${r.to.slice(0, 30)}…»`).join(" | ")}`);

for (const day of plan.days) {
  const dayName = String(day.day);
  const exs: any[] = day.exercises ?? [];
  const bad = exs.filter((e) => {
    const pg = primaryGroupOfExercise(e as never);
    const g = majorGroupsOfExercise(e as never);
    if (!pg) return false;
    const allowed = new Set<string>();
    const bpDay = prescribed!.blueprint.days.find((d) => d.day.replace(/\u200C/g, "") === dayName.replace(/\u200C/g, ""));
    for (const m of [...(bpDay?.primary ?? []), ...(bpDay?.secondary ?? [])]) {
      const map: Record<string, string> = { "سینه": "chest", "زیربغل/پشت": "back", "سرشانه": "shoulders", "سرشانهٔ عقب": "shoulders", "جلو بازو": "arms", "پشت بازو": "arms", "چهارسر": "legs", "پشت پا": "legs", "باسن": "legs", "ساق": "legs", "شکم و مرکز": "core" };
      const mg = map[m as string]; if (mg) allowed.add(mg);
    }
    return !allowed.has(pg) && g.size < 5;
  });
  ok(bad.length === 0, `هویت روز ${dayName} — صفر حرکت خارج از تجویز`, bad.length ? bad.map((b) => b.name).join("،") : "");
}
const wedLegs = (plan.days.find((d: any) => String(d.day).includes("چهارشن"))?.exercises ?? [])
  .filter((e: any) => primaryGroupOfExercise(e) === "legs").length;
ok(wedLegs === 0, "چهارشنبه بعد از پلیس: صفر حرکت پا");
const satLegs = (plan.days.find((d: any) => String(d.day).includes("شنبه"))?.exercises ?? [])
  .filter((e: any) => primaryGroupOfExercise(e) === "legs").length;
ok(satLegs === 0, "شنبه بعد از پلیس: صفر حرکت پا");
const totalLegDays = plan.days.filter((d: any) => ((d.exercises ?? []) as any[]).some((e) => primaryGroupOfExercise(e) === "legs")).length;
ok(totalLegDays === 1, `پا فقط ۱ روز (درخواست صریح کاربر) — فعلاً ${totalLegDays} روز`);

console.log("═ ۵) گیت‌های L4 با snapshot تجویز");
(plan as any).coachBlueprint = blueprintSnapshotForPlan(prescribed!.blueprint);
const capIssues = auditGroupFrequencyCap(plan as never);
ok(capIssues.length === 0, "سقف فرکانس: صفر تخلف", capIssues.map((i) => i.message).join(" | ").slice(0, 200));
const adherIssues = auditBlueprintAdherence(plan as never).filter((i) => i.severity === "critical");
ok(adherIssues.length === 0, "انطباق معماری: صفر critical", adherIssues.map((i) => i.message).join(" | ").slice(0, 200));

console.log(`\n═══ نتیجه: ${pass} PASS / ${fail} FAIL ═══`);
process.exit(fail === 0 ? 0 : 1);
