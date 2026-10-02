/**
 * seed-program-exercises.ts — تضمین وجود حرکاتِ ارجاع‌شده در برنامه‌های کاربران (v116)
 *
 * زمینه (درخواست مالک): «حدود ۱۰۰ کاربر برنامه دارند؛ اگر داخل برنامه‌ها حرکتی
 * گفته باشه که در بانک نباشه چی؟ من می‌خوام هر تمرینی که به یک ورزشکار داده می‌شود،
 * آن حرکت و توضیحاتش در بانک وجود داشته باشد.»
 *
 * دو لایهٔ محافظت داریم:
 *   ۱) cleanup-exercise-variants.ts هیچ حرکتِ ارجاع‌شده در WorkoutPlan را حذف نمی‌کند
 *      (گارد حفاظت — هر بار هنگام دیپلوی از دیتابیس واقعی خوانده می‌شود).
 *   ۲) این اسکریپت (پس از cleanup در deploy.sh) نام‌های ارجاع‌شدهٔ «بدون هیچ ردیفی»
 *      را پیدا و با محتوای واقعی فارسی می‌سازد — حرکات هوازی دستگاهی (تردمیل،
 *      دوچرخه ثابت، پیاده‌روی) که از ابتدا در بانک نبودند ولی برنامه‌ها استفاده‌اند.
 *
 * Idempotent: ردیف موجود (حتی با اختلاف جزئی نام) هرگز بازنویسی نمی‌شود؛
 * اجرای دوباره = صفر تغییر.
 *
 * اجرا:
 *   bun run scripts/seed-program-exercises.ts           # گزارش (DRY-RUN)
 *   bun run scripts/seed-program-exercises.ts --apply   # اعمال واقعی
 */
import { PrismaClient } from "@prisma/client";
import { exerciseMatchesSearch } from "../src/lib/fitness/exercise-search";

const db = new PrismaClient({
  datasources: {
    db: { url: process.env.MAP_DB_URL || process.env.DATABASE_URL },
  },
});
const APPLY = process.argv.includes("--apply");

function normalizeName(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u064A/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\u06C0/g, "\u0647")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[\s\u200C\-–—_]+/g, "")
    .replace(/[.,،؛:!؟?"'()«»[\]]+/g, "");
}

function dedupeKey(input: string): string {
  return normalizeName(input).replace(/با/g, "");
}

/**
 * حرکاتی که در برنامه‌های کاربران ارجاع شده‌اند ولی «هیچ» ردیف معادلی در بانک
 * ندارند — با نام استاندارد، توضیح واقعی و نکات ایمنی ساخته می‌شوند.
 * (ویدیوی یوتیوب تأییدشده‌ای برای این‌ها در مپینگ نیست — خالی ساخته می‌شوند تا
 * ادمین در پنل بتواند ویدیو بچسباند؛ وجود حرکت و توضیحات اولویت مالک است.)
 */
type MissingExercise = {
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  difficulty: string;
  description: string;
  tips: string;
  /** اگر هر یک از این کلیدهای نرمال‌شده در بانک بود، ردیف جدید ساخته نمی‌شود */
  equivalentKeys: string[];
};

const MISSING_EXERCISES: MissingExercise[] = [
  {
    name: "تردمیل",
    muscle: "بدن کامل", category: "cardio", equipment: "machine", difficulty: "beginner",
    description:
      "روی تردمیل راه بروید یا بدوید؛ سرعت و شیب را متناسب با هدف تنظیم کنید. برای گرم‌کردن ۵ تا ۱۰ دقیقه با سرعت کم و برای هوازی پیوسته ۲۰ تا ۴۰ دقیقه با ضربان قلب هدف.",
    tips: "شیب ۱ تا ۲ درصد شبیه راه‌رفتن در فضای باز است؛ بدن را به دسته‌ها تکیه ندهید و فرود را نرم نگه دارید.",
    equivalentKeys: ["تردمیل"],
  },
  {
    name: "دویدن روی تردمیل",
    muscle: "بدن کامل", category: "cardio", equipment: "machine", difficulty: "intermediate",
    description:
      "دویدن پیوسته روی تردمیل با سرعت متوسط تا بالا؛ برای چربی‌سوزی و توان هوازی. شیب ملایم (۱ تا ۳ درصد) فشار روی زانوها را طبیعی‌تر می‌کند.",
    tips: "فرود روی وسط پا باشد نه پاشنه؛ اگر تازه‌کارید هر ۵ دقیقه یک دقیقه راه‌رفتن بیندازید.",
    equivalentKeys: ["دویدنرویتردمیل", "دویدنسبک", "دویدن"],
  },
  {
    name: "دوچرخه ثابت",
    muscle: "پا و باسن", category: "cardio", equipment: "machine", difficulty: "beginner",
    description:
      "پدال‌زنی پیوسته روی دوچرخه ثابت با ارتفاع زین مناسب (پا در پایین‌ترین نقطه کمی خم باشد). برای هوازی ملایم تا شدید و گرم‌کردن مفاصل پا عالی است.",
    tips: "زین خیلی پایین فشار زانو را زیاد می‌کند؛ زانوها در کل دامنه رو به جلو بمانند.",
    equivalentKeys: ["دوچرخهثابت"],
  },
  {
    name: "پیاده‌روی تند",
    muscle: "بدن کامل", category: "cardio", equipment: "bodyweight", difficulty: "beginner",
    description:
      "راه‌رفتن با گام‌های سریع و ضربان قلب بالا (ولی قابل گفت‌وگو)؛ به‌صورت هوازی مستقل یا ریکاوری فعال بین جلسات سنگین. ۲۰ تا ۴۵ دقیقه.",
    tips: "بالاتنه صاف و نگاه رو به جلو؛ دست‌ها با ریتم قدم حرکت کنند.",
    equivalentKeys: ["پیاده‌رویتند", "پیاده‌رویسبک", "پیاده‌روی"],
  },
  {
    name: "ساق پا نشسته",
    muscle: "پا و باسن", category: "legs", equipment: "machine", difficulty: "beginner",
    description:
      "روی دستگاه ساق نشسته، زانوها زیر بالشتک و پنجه‌ها روی صفحه؛ پاشنه را تا بالاترین دامنه بالا بیاورید و پایین با کنترل کامل باز کنید. سولئوس (ساق عمقی) را هدف می‌گیرد.",
    tips: "دامنهٔ کامل و مکث کوتاه بالا؛ از پرتاب وزنه با شتاب پرهیز کنید.",
    equivalentKeys: ["ساقپانشسته"],
  },
  {
    name: "پرس سرشانه دستگاه",
    muscle: "سرشانه", category: "push", equipment: "machine", difficulty: "beginner",
    description:
      "نشسته روی دستگاه پرس سرشانه، دستگیره‌ها هم‌سطح گوش‌ها؛ به بالا فشار دهید تا آرنج‌ها نزدیک قفل شوند و با کنترل پایین بیاورید. مسیر حرکت ثابت دستگاه برای مبتدیان و پیرسازی امن است.",
    tips: "کمر به پشتی بچسبد؛ پایین آوردن تا سطح گوش کافی است (پایین‌تر فشار به مفصل می‌آید).",
    equivalentKeys: ["پرسسرشانهدستگاه"],
  },
];

async function main() {
  const existing = await db.exerciseLibrary.findMany({
    select: { id: true, name: true },
  });
  const byDedupe = new Set<string>();
  for (const ex of existing) byDedupe.add(dedupeKey(ex.name));

  // نام‌های ارجاع‌شده در برنامه‌ها (برای گزارش پوشش)
  const referenced = new Set<string>();
  try {
    const plans = await db.workoutPlan.findMany({ select: { content: true } });
    for (const p of plans) {
      try {
        const data = JSON.parse(p.content);
        for (const day of Array.isArray(data?.days) ? data.days : []) {
          for (const ex of Array.isArray(day?.exercises) ? day.exercises : []) {
            if (typeof ex?.name === "string" && ex.name) referenced.add(ex.name);
          }
        }
      } catch {}
    }
  } catch {}

  let created = 0, skipped = 0;
  const createdNames: string[] = [];

  for (const ex of MISSING_EXERCISES) {
    const hasEquivalent =
      byDedupe.has(dedupeKey(ex.name)) ||
      ex.equivalentKeys.some((k) => byDedupe.has(k));
    if (hasEquivalent) {
      skipped++;
      continue;
    }
    if (APPLY) {
      await db.exerciseLibrary.create({
        data: {
          name: ex.name,
          muscle: ex.muscle,
          category: ex.category,
          equipment: ex.equipment,
          description: ex.description,
          tips: ex.tips,
          difficulty: ex.difficulty,
          mediaUrl: "",
          youtubeUrl: "",
          videoUrl: "",
          videoSizeBytes: 0,
          videoPosterUrl: "",
          youtubeEnabled: true,
        },
      });
      byDedupe.add(dedupeKey(ex.name));
    }
    created++;
    createdNames.push(ex.name);
  }

  // ─── گزارش پوشش: هر نام ارجاع‌شده در برنامه‌ها باید ردیف یا معادل داشته باشد ───
  // با همان موتور جستجوی مترادفِ خود سایت چک می‌شود (هر چیزی که جستجوی سایت
  // پیدا می‌کند، ویدیو و توضیحات هم برای کاربر پیدا می‌شود).
  // همیشه با متن کامل (عضله/تجهیزات/توضیحات) — هم در DRY-RUN هم APPLY —
  // تا گزارش واقعیِ همان چیزی باشد که جستجوی سایت می‌بیند.
  const rowsNow = await db.exerciseLibrary.findMany({
    select: { name: true, muscle: true, equipment: true, category: true, description: true, tips: true },
  });
  const stillMissing = [...referenced].filter(
    (n) => !rowsNow.some((r) => exerciseMatchesSearch(r as any, n))
  );

  console.log("─────────────────────────────");
  console.log(`📊 گزارش seed حرکات ارجاع‌شدهٔ برنامه‌ها (APPLY=${APPLY}):`);
  console.log(`   • ساخته شد: ${created}${createdNames.length ? ` — ${createdNames.join(" | ")}` : ""}`);
  console.log(`   • معادل از قبل موجود (skip): ${skipped}`);
  console.log(`   • نام‌های ارجاع‌شده در برنامه‌ها: ${referenced.size}`);
  console.log(`   • بدون پوشش موتور جستجو (نیاز به اقدام): ${stillMissing.length}`);
  if (stillMissing.length) console.log(`     ${stillMissing.join(" | ")}`);
  await db.$disconnect();
  if (!APPLY) console.log("ℹ DRY-RUN — برای اعمال واقعی --apply بزنید.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
