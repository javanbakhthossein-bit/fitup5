/**
 * ─── تست v154 — تزریق کامل بانک + آزادی حرکت خارج از دیتابیس (تیکت مالک) ───
 *
 * قانون مالک:
 *   «۹۰ حرکت هم کمه. اولاً تمام حرکات دیتابیس من بهش تزریق بشه. ثانیاً حتی اگر
 *    حرکتی داخل دیتابیس من نبود باز هم باید اون حرکت رو بده و نزدیک‌ترین ویدیو
 *    و توضیحات براش قرار بگیره. تمام حرکات دیتابیس من و خارج از دیتابیس برای
 *    دادن برنامهٔ تمرینی در نظر گرفته بشه.»
 *
 * پوشش:
 *  T1  buildFullBankPromptGroups: «تمام» ردیف‌ها (حتی بی‌ویدیو) دقیقاً یک‌بار
 *      گروه‌بندی می‌شوند؛ هم‌نام فشرده حذف؛ ترتیب گروه‌ها؛ بانک خالی.
 *  T2  findClosestBankRow: نزدیک‌ترین «معنایی» (نه تصادفی)؛ احترام به excludeIds
 *      با فال‌بک امن؛ null فقط برای بانک خالی.
 *  T3  lockWorkoutPlanToBank (v154): حرکت غریبه با نام خودش می‌ماند + exerciseId
 *      نزدیک‌ترین ردیف ویدیودار + توضیحات/نکات بانک (DB بر توضیح AI مقدم)؛ دو
 *      غریبه در یک روز → دو ردیف متفاوت؛ تطبیق دقیق هنوز کانونیکل می‌شود؛
 *      بانک کوچک (fail-safe) → هیچ تغییری جز کانونیکل.
 *  T4  دود-تست دیتابیس واقعی: کل بانک فعال گروه‌بندی کامل؛ نزدیک‌ترینِ «شنای
 *      آرچر» شنا/سینه است؛ قفل برنامهٔ کوچک با ۳ حرکت اگزوتیک — همه حفظ + الصاق.
 *
 * اجرا: bun scripts/test-v154-full-bank.ts
 */
import {
  buildLockedBank,
  buildFullBankPromptGroups,
  findClosestBankRow,
  lockWorkoutPlanToBank,
  type BankExerciseRow,
} from "../src/lib/fitness/exercise-bank-lock";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function row(id: string, name: string, muscle: string, category: string, desc = ""): BankExerciseRow {
  return {
    id,
    name,
    muscle,
    category,
    description: desc,
    tips: desc ? `نکتهٔ ${id}` : "",
    youtubeUrl: "https://www.youtube.com/embed/abc",
    youtubeEnabled: true,
  };
}

/* ───── بانک بزرگ‌تر از حد سخت‌قفل (≥۱۰) برای تست‌های اصلی ───── */
const BANK_ROWS: BankExerciseRow[] = [
  row("e1", "پرس بالاسینه هالتر (Incline Barbell Bench Press)", "سینه", "push", "هالتر را روی میز شیب‌دار ۳۰-۴۵ درجه پرس کنید."),
  row("e2", "پرس بالاسینه دمبل (Incline Dumbbell Press)", "سینه", "push", "دو دمبل را روی میز شیب‌دار به بالا پرس کنید."),
  row("e3", "پرس سینه هالتر (Bench Press)", "سینه", "push", "هالتر را روی میز تخت پرس کنید."),
  row("e4", "قفسه سینه دمبل (Dumbbell Fly)", "سینه", "push", "دمبل‌ها را با قوس باز و بسته کنید."),
  row("e5", "ساق پا ایستاده (Standing Calf Raise)", "ساق", "legs", "روی پنجه بالا و پایین بروید."),
  row("e6", "جلو بازو هالتر (Barbell Curl)", "جلوبازو", "push", "هالتر را با آرنج ثابت بالا بیاورید."),
  row("e7", "پارالل (Dips)", "سینه", "push", "بدن را روی پارالل پایین و بالا ببرید."),
  row("e8", "اسکوات جلو (Front Squat)", "پا", "legs", "هالتر روی دلتوئید، اسکوات کامل."),
  row("e9", "اسکوات جلو", "پا", "legs", "هالتر روی دلتوئید، اسکوات کامل."), // هم‌نام فشردهٔ e8
  row("e10", "شنای سوئدی (Push-Up)", "سینه", "push", "بدن صاف، سینه تا نزدیک زمین."),
  row("e11", "ددلیفت هالتر (Deadlift)", "پشت", "pull", "هالتر را از زمین با پشت صاف بلند کنید."),
  row("e12", "بارفیکس (Pull-Up)", "زیربغل", "pull", "بدن را تا چانه از میله بالا بکشید."),
  // حرکت بی‌ویدیو — در بانکِ قفل حذف می‌شود ولی در پرامپت کامل باید باشد
  { ...row("e13", "حرکت آزمایشی بی‌ویدیو (No Video)", "سینه", "push", "توضیح آزمایشی"), youtubeUrl: "", youtubeEnabled: false },
];
const bank = buildLockedBank(BANK_ROWS, true); // e13 و e9(هم‌نام e8) حذف → ۱۱ ردیف
const RAW_ROWS: BankExerciseRow[] = BANK_ROWS; // برای پرامپت کامل (۱۳ ردیف خام)

console.log("\n── T1: buildFullBankPromptGroups — تزریق کامل، بدون سقف ──");
{
  const groups = buildFullBankPromptGroups(RAW_ROWS);
  const allNames = groups.flatMap((g) => g.names);
  check("همهٔ ردیف‌های خام (حتی بی‌ویدیو) در پرامپت‌اند — هم‌نامِ «اسکوات جلو» یکی شده (۱۲ یکتا)", allNames.length === 12, `got ${allNames.length}`);
  check("هر نام دقیقاً یک‌بار (هم‌نام فشردهٔ «اسکوات جلو» یکی شد)", new Set(allNames).size === allNames.length);
  const keys = groups.map((g) => g.key);
  check("ترتیب گروه‌ها: سینه→پا→بازو→زیربغل→سایر", keys[0] === "chest" && keys.includes("legs") && keys.includes("arms") && keys.includes("back"), keys.join(","));
  const chest = groups.find((g) => g.key === "chest")!;
  check("برچسب فارسی گروه سینه", chest.label === "سینه", chest.label);
  check("حرکت بی‌ویدیو هم در فهرست پرامپت است", allNames.some((n) => n.includes("بی‌ویدیو")));
  check("بانک خالی → خروجی خالی (بدون کرش)", buildFullBankPromptGroups([]).length === 0);
  const lockedOnly = buildFullBankPromptGroups(bank.all);
  const lockedNames = lockedOnly.flatMap((g) => g.names);
  check("حالت بانک قفل: بدون حرکت بی‌ویدیو و بدون هم‌نام", lockedNames.length === bank.all.length && !lockedNames.some((n) => n.includes("بی‌ویدیو")));
}

console.log("\n── T2: findClosestBankRow — نزدیک‌ترین معنایی، بدون حد آستانه ──");
{
  const closest = findClosestBankRow("پرس بالاسینه دمبل شیب‌دار", bank);
  check("«پرس بالاسینه دمبل شیب‌دار» → ردیف پرس بالاسینه دمبل", closest?.id === "e2", closest?.name ?? "null");
  const withExclude = findClosestBankRow("پرس بالاسینه دمبل شیب‌دار", bank, { excludeIds: new Set(["e2"]) });
  check("با exclude(e2) → نزدیک‌ترین بعدی (پرس بالاسینه هالتر)", withExclude?.id === "e1", withExclude?.name ?? "null");
  const allExcluded = findClosestBankRow("پرس بالاسینه دمبل شیب‌دار", bank, { excludeIds: new Set(bank.all.map((r) => r.id)) });
  check("همهٔ ردیف‌ها exclude → فال‌بک امن (بدون null)", !!allExcluded && bank.all.some((r) => r.id === allExcluded!.id));
  check("بانک خالی → null", findClosestBankRow("هر چیزی", buildLockedBank([], true)) === null);
  const exotic = findClosestBankRow("حرکت خیالی زد کیو ناشناخته", bank);
  check("نام کاملاً ناشناخته → همیشه یک ردیف برمی‌گردد (الصاق همیشه ممکن)", !!exotic && bank.all.some((r) => r.id === exotic!.id));
}

console.log("\n── T3: lockWorkoutPlanToBank — قانون v154 ──");
{
  // ۳-۱: حرکت خارج از بانک با نام خودش می‌ماند + ویدیو/توضیح نزدیک‌ترین الصاق
  const plan1 = {
    days: [
      {
        day: "شنبه",
        exercises: [
          { name: "شنای آرچر (Archer Push-Up)", muscle: "سینه", category: "push", sets: [{ setNumber: 1, reps: "8-10" }] },
        ],
      },
    ],
  };
  const rep1 = lockWorkoutPlanToBank(plan1 as any, bank);
  const ex1 = (plan1 as any).days[0].exercises[0];
  const attached1 = bank.all.find((r) => r.id === ex1.exerciseId);
  check("نام حرکت خارج از بانک حفظ شد", ex1.name === "شنای آرچر (Archer Push-Up)", ex1.name);
  check("نزدیک‌ترین ویدیو الصاق شد (خانوادهٔ شنا)", !!attached1 && /شنا|پوش/.test(attached1.name), attached1?.name ?? "null");
  check("توضیحات نزدیک‌ترین ردیف بانک الصاق شد", typeof ex1.description === "string" && ex1.description.length > 0, ex1.description);
  check("گزارش videoAttached=1", rep1.videoAttached === 1, JSON.stringify(rep1));

  // ۳-۲: DB بر توضیح AI مقدم است برای حرکت خارج از بانک (قانون مالک: توضیحات بانک)
  const plan2 = {
    days: [
      {
        day: "یکشنبه",
        exercises: [
          { name: "شنای الماسی با دست کف‌باز", muscle: "سینه", category: "push", description: "توضیح خودساختهٔ AI", sets: [] },
        ],
      },
    ],
  };
  const rep2 = lockWorkoutPlanToBank(plan2 as any, bank);
  const ex2 = (plan2 as any).days[0].exercises[0];
  check("نام خارج از بانک ماند", ex2.name === "شنای الماسی با دست کف‌باز", ex2.name);
  check("توضیح استاندارد بانک جای توضیح AI نشست", ex2.description === "بدن صاف، سینه تا نزدیک زمین.", ex2.description);
  check("videoAttached شمارش شد", rep2.videoAttached === 1, JSON.stringify(rep2));

  // ۳-۳: دو غریبه در یک روز → دو ردیف متفاوت (تکرار یک ویدیو ممنوع)
  const plan3 = {
    days: [
      {
        day: "دوشنبه",
        exercises: [
          { name: "شنای آرچر (Archer Push-Up)", muscle: "سینه", category: "push", sets: [] },
          { name: "شنای اسپایدر (Spider Push-Up)", muscle: "سینه", category: "push", sets: [] },
        ],
      },
    ],
  };
  lockWorkoutPlanToBank(plan3 as any, bank);
  const [a3, b3] = (plan3 as any).days[0].exercises;
  check("دو حرکت خارج از بانک حفظ شدند", a3.name === "شنای آرچر (Archer Push-Up)" && b3.name === "شنای اسپایدر (Spider Push-Up)", `${a3.name} | ${b3.name}`);
  check("دو غریبه → دو ردیف ویدیوی متفاوت", a3.exerciseId !== b3.exerciseId, `${a3.exerciseId} vs ${b3.exerciseId}`);

  // ۳-۴: تطبیق دقیق هنوز کانونیکل می‌شود (رفتار قبلی سالم)
  const plan4 = {
    days: [{ day: "سه‌شنبه", exercises: [{ name: "پرس سینه هالتر", muscle: "سینه", category: "push", sets: [] }] }],
  };
  const rep4 = lockWorkoutPlanToBank(plan4 as any, bank);
  const ex4 = (plan4 as any).days[0].exercises[0];
  check("نام بانکی → کانونیکل با نام استاندارد", ex4.name === "پرس سینه هالتر (Bench Press)", ex4.name);
  check("exerciseId ردیف واقعی", ex4.exerciseId === "e3");
  check("canonicalized=1 و videoAttached=0", rep4.canonicalized === 1 && rep4.videoAttached === 0, JSON.stringify(rep4));

  // ۳-۵: fail-safe بانک کوچک — هیچ الصاق/حذفی، فقط کانونیکل
  const smallBank = buildLockedBank([BANK_ROWS[2], BANK_ROWS[4]], true);
  const plan5 = {
    days: [{ day: "چهارشنبه", exercises: [{ name: "شنای آرچر (Archer Push-Up)", muscle: "سینه", category: "push", sets: [] }] }],
  };
  const rep5 = lockWorkoutPlanToBank(plan5 as any, smallBank);
  const ex5 = (plan5 as any).days[0].exercises[0];
  check("بانک کوچک: حرکت دست‌نخورده ماند", ex5.name === "شنای آرچر (Archer Push-Up)" && !ex5.exerciseId);
  check("بانک کوچک: unlocked=true", rep5.unlocked === true);
}

console.log("\n── T4: دود-تست دیتابیس واقعی ──");
{
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const rows = (await db.exerciseLibrary.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, muscle: true, category: true, equipment: true,
        description: true, tips: true,
        videoUrl: true, videoPosterUrl: true, youtubeUrl: true, youtubeEnabled: true,
      },
    })) as BankExerciseRow[];
    await db.$disconnect();

    const groups = buildFullBankPromptGroups(rows);
    const names = groups.flatMap((g) => g.names);
    const promptChars = groups.reduce((s, g) => s + g.label.length + g.names.join("، ").length, 0);
    check(`کل دیتابیس فعال در پرامپت است (${rows.length} ردیف → ${names.length} نام یکتا)`, names.length >= rows.length - 10, `${names.length}/${rows.length}`);
    check("هیچ ردیف فعالی جا نیفتاده (فقط هم‌نام‌های فشرده حذف شده‌اند)", rows.length - names.length <= 10, `${rows.length - names.length}`);
    check("اندازهٔ پرامپت منطقی است (< ۹۰ هزار نویسه)", promptChars < 90000, `${promptChars} chars (~${Math.round(promptChars / 3)} tokens)`);
    check("همهٔ هفت گروه در بانک واقعی پر هستند", groups.length === 7 && groups.every((g) => g.names.length > 0), groups.map((g) => `${g.key}:${g.names.length}`).join(","));

    const realBank = buildLockedBank(rows, true);
    const closestArcher = findClosestBankRow("شنای آرچر (Archer Push-Up)", realBank);
    check("نزدیک‌ترینِ «شنای آرچر» در بانک واقعی: خانوادهٔ شنا/سینه", !!closestArcher && (/شنا|پوش/i.test(closestArcher.name) || closestArcher.muscle.includes("سینه")), closestArcher?.name ?? "null");

    const miniPlan = {
      days: [
        {
          day: "شنبه",
          exercises: [
            { name: "شنای آرچر (Archer Push-Up)", muscle: "سینه", category: "push", sets: [] },
            { name: "اسکوات بلغاری تک‌پا با دمبل روسی", muscle: "پا", category: "legs", sets: [] },
            { name: "نشر دمبل خم تک‌دست مکانیکی", muscle: "سرشانه", category: "push", sets: [] },
          ],
        },
      ],
    };
    const rep = lockWorkoutPlanToBank(miniPlan as any, realBank);
    const exs = (miniPlan as any).days[0].exercises;
    check("هیچ حرکتی حذف/بی‌نام نشد", exs.every((e: any) => typeof e.name === "string" && e.name.trim().length > 0), exs.map((e: any) => e.name).join(" | "));
    check("هر ۳ حرکت ویدیوی ویدیودارِ بانک گرفتند", exs.every((e: any) => typeof e.exerciseId === "string" && realBank.all.some((r) => r.id === e.exerciseId)), exs.map((e: any) => e.exerciseId).join(" | "));
    check("سه ویدیوی متفاوت برای سه حرکت", new Set(exs.map((e: any) => e.exerciseId)).size === 3);
    const kept = exs.filter((e: any) => /شنای آرچر|نشر دمبل خم/.test(e.name)).length;
    check("حرکت‌های اگزوتیکِ بی‌هم‌ارزشِ بانک با نام خودش ماندند (≥۲)", kept >= 2, exs.map((e: any) => e.name).join(" | "));
    check("جمع گزارش = ۳ (هر حرکت یا الصاق یا کانونیکلِ همان حرکت)", rep.videoAttached + rep.canonicalized + rep.fuzzyFixed === 3 && rep.replaced.length === 0, JSON.stringify(rep));
  } catch (e) {
    fail++;
    console.error("  ❌ دود-تست دیتابیس شکست خورد:", (e as Error)?.message ?? e);
  }
}

console.log(`\n═══ نتیجه: ${pass} موفق / ${fail} ناموفق ═══`);
if (fail > 0) process.exit(1);
