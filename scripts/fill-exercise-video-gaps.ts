/**
 * ─────────────────────────────────────────────────────────────────────────
 * fill-exercise-video-gaps.ts (v117) — قانون مطلق مالک:
 *   «پیش نیاد حرکتی به کاربر داده بشه که ویدیو نداشته باشه»
 *
 * گام ۱۲-ج۶ دیپلوی (بعد از seed حرکات و پاکسازی): هر حرکتی که «هیچ» ویدیویی
 * ندارد (نه ویدیوی اختصاصی آپلودی، نه یوتیوب) با یک ویدیوی راستی‌آزمایی‌شدهٔ
 * یوتیوب پر می‌شود.
 *
 * همهٔ IDها در سندباکس با oEmbed یوتیوب (کد ۲۰۰ + عنوان منطبق) راستی‌آزمایی
 * شدند و گارد خارج-از-حوزه (isOffTopicVideoTitle) رویشان اعمال شد — صفر
 * ویدیوی ساختگی، صفر ویدیوی بی‌ربط.
 *
 * Idempotent: فقط youtubeUrl «خالی» پر می‌شود؛ هرگز دادهٔ ادمین بازنویسی
 * نمی‌شود. اجرای دوباره = صفر تغییر.
 *
 * اجرا:  bun run scripts/fill-exercise-video-gaps.ts          (dry-run)
 *        bun run scripts/fill-exercise-video-gaps.ts --apply  (اعمال واقعی)
 * ─────────────────────────────────────────────────────────────────────────
 */
import { db } from "../src/lib/db";
import { normalizeYoutubeEmbedUrl } from "../src/lib/fitness/exercise-video";

/** ویدیوهای راستی‌آزمایی‌شده (oEmbed 200) — کلید = نام دقیق رکورد بانک */
const VERIFIED_VIDEOS: Record<string, { videoId: string; title: string; channel: string }> = {
  "پرس سینه هالتر": { videoId: "O96UKxR1ud8", title: "آموزش حرکت پرس سینه هالتر", channel: "بدنسازی" },
  "صد پیلاتس (Pilates Hundred)": { videoId: "rHHn0WkkAYo", title: "How to do the Hundred?", channel: "Pilates" },
  "رول‌آپ پیلاتس (Pilates Roll-Up)": { videoId: "72iQroEOHeU", title: "The Pilates Roll Up", channel: "Pilates" },
  "پل باسن پیلاتس (Shoulder Bridge)": { videoId: "-ZY3Rgm-UXg", title: "Pilates Bridge | Improve Your Spine and Hip Mobility", channel: "Move With Julia" },
  "سگ-گربه پیلاتس (Cat-Cow Spine Stretch)": { videoId: "2of247Kt0tU", title: "CAT-COW POSE (Marjaryasana-Bitilasana)", channel: "Yoga" },
  "سری پا خوابیده به پهلو (پیلاتس)": { videoId: "3uA9bBosL80", title: "پهلو خوابیده با رساندن پا به پاشنه پا | شکم و پهلو", channel: "فیتنس فارسی" },
  "قو پیلاتس (Swan Prep)": { videoId: "KAotX1bDGps", title: "Pilates Exercise: Swan Prep", channel: "Pilates Anytime" },
  "تیزر پیلاتس (Teaser)": { videoId: "fj_GpnL82Hk", title: "Easy Pilates Teaser Variation for Beginners!", channel: "Pilates" },
  "پیلاتس دیواری سرشانه (Wall Pilates Shoulder Bridge)": { videoId: "e_dXocZXX0c", title: "Morning Wall Pilates - Glutes Bridge", channel: "Wall Pilates" },
  "پیلاتس باز و بسته کردن پاها (Single Leg Stretch)": { videoId: "e5KKgeRoG74", title: "Pilates Workout Exercise: Single Leg Stretch", channel: "Pilates" },
  "پرس سینه TRX (TRX Chest Press)": { videoId: "7VdE8LAFSWQ", title: "How to Perform The TRX Chest Press", channel: "TRX Training" },
  "اسکوات TRX (TRX Squat)": { videoId: "gnIPYR9-HkI", title: "Trx squat / اسکات با تی آر ایکس", channel: "فارسی" },
  "لانج TRX (TRX Lunge)": { videoId: "vv1vJG3WOuI", title: "TRX lunges", channel: "TRX" },
  "پلانک TRX (TRX Plank)": { videoId: "zSuVjt67j7k", title: "TRX Plank", channel: "TRX" },
  "پایک TRX (TRX Pike)": { videoId: "Yyv3iZQFuLs", title: "TRX Pike", channel: "TRX" },
  "جلو بازو TRX (TRX Bicep Curl)": { videoId: "uiRS94PLV-8", title: "جلو بازو با trx", channel: "فارسی" },
  "پشت بازو TRX (TRX Triceps Extension)": { videoId: "HZ3IxeUPk4w", title: "Triceps TRX / پشت بازو تی آر ایکس", channel: "فارسی" },
  "ددل‌لیفت تک‌پا TRX (TRX Single-Leg RDL)": { videoId: "wdpixkZe2WY", title: "TRX 1 Leg RDL with Reach", channel: "TRX" },
  "روئینگ تک‌دست TRX (TRX Single-Arm Row)": { videoId: "fZjzpiOJjpg", title: "TRX® Weekly Exercise: TRX Single Arm Row", channel: "TRX Training" },
  "لانژ پرشی": { videoId: "iJMsF7fzrOM", title: "JUMP LUNGE", channel: "Fitness" },
  "پرش ستاره": { videoId: "MKcGJwl7cKc", title: "آموزش حرکت پرش ستاره Star Jump", channel: "فارسی" },
  "زانو بلند درجا (High Knees)": { videoId: "jE3hyzA3dcA", title: "حرکت زانو ریز / زانو بلند برای افزایش قدرت و چابکی", channel: "فارسی" },
  "اسکوات گابلت کتل‌بل (Goblet Squat)": { videoId: "rlgug0u3CJ8", title: "اجرای اصولی گابلت اسکوات", channel: "بدنسازی فارسی" },
  "حمل کشاورز (Farmer Carry)": { videoId: "1uOs1hP3u4A", title: "FARMERS WALK EXPLAINED", channel: "Fitness" },
  "گت‌آپ ترکی (Turkish Get-Up نیمه)": { videoId: "sgd8n917Zv0", title: "How to do a Turkish get-up", channel: "Fitness" },
  "پرتاب مدبال دیواری (Wall Ball Throw)": { videoId: "WGM7FjbDJUA", title: "Wall Balls: The Do's & Don'ts", channel: "CrossFit" },
  "تراستر دمبل (Thruster)": { videoId: "1tOtPIZXL2Q", title: "تراستر با دمبل dumbbells thruster", channel: "فارسی" },
  "حیوان مرده (Dead Bug)": { videoId: "-8xqJ2xXs2A", title: "Common Deadbug Mistake!", channel: "Fitness" },
  "تردمیل": { videoId: "2qztNxLzyt8", title: "تردمیل: ۵ اشتباه رایج حین دویدن روی تردمیل", channel: "فارسی" },
  "دویدن روی تردمیل": { videoId: "VAf08o0vsC4", title: "Tips to improve your running form on the treadmill", channel: "Running" },
  "دوچرخه ثابت": { videoId: "dieOsJlsvpM", title: "How to use spin bike for beginners", channel: "Cycling" },
  "پیاده‌روی تند": { videoId: "QKB89ZyuHrw", title: "پیاده‌روی مؤثر برای کاهش وزن | ۶ نکته کاربردی", channel: "فارسی" },
  "ساق پا نشسته": { videoId: "BYoJcaNy36I", title: "ساق پا نشسته دستگاه", channel: "فارسی" },
  "پرس سرشانه دستگاه": { videoId: "Gkk-6q7Rq-s", title: "How to Perform the Machine Shoulder Press", channel: "DeltaBolic" },
  // v117 — واریانت‌های موجود در دیتابیس تولیدی مالک (همان ویدیوی راستی‌آزمایی‌شدهٔ خانواده)
  "برپی": { videoId: "JvgvWACRIQg", title: "آموزش حرکت برپی", channel: "فارسی" },
  "اسکات سریع در جا (Fast Feet March)": { videoId: "mWceqtuUaa8", title: "Fast feet exercise", channel: "Fit Family Physical Therapy" },
  "سگ پرنده (Bird Dog)": { videoId: "xEDnlOxeJH4", title: "How to Do the Bird Dog Exercise", channel: "Physical Therapists" },
};

/** تطبیق نرمال‌شدهٔ نام (فاصله/نیم‌فاصله/ی-ک عربی/پرانتز توضیحی بی‌اثر) */
function squeezeName(s: string): string {
  return s
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\u064A]/g, "ی")
    .replace(/[\u0643]/g, "ک")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[\s\u200C\-–—_]+/g, "");
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`=== fill-exercise-video-gaps (v117) — mode: ${apply ? "APPLY" : "DRY-RUN"} ===`);

  const rows = await db.exerciseLibrary.findMany({
    select: { id: true, name: true, videoUrl: true, youtubeUrl: true },
  });
  const bySqueezed = new Map(rows.map((r) => [squeezeName(r.name), r]));

  let filled = 0;
  let alreadyOk = 0;
  let noRecord: string[] = [];
  let noEntry: string[] = [];

  // ۱) حرکات بی‌ویدیوی بانک را با ویدیوی راستی‌آزمایی‌شده پُر کن
  for (const row of rows) {
    const hasFile = (row.videoUrl || "").trim() !== "";
    const hasYt = (row.youtubeUrl || "").trim() !== "";
    if (hasFile || hasYt) continue; // ویدیو دارد — دست نمی‌زنیم

    const hit = VERIFIED_VIDEOS[row.name] || null;
    const squeezedHit = hit ? null : VERIFIED_VIDEOS_BY_SQUEEZED[squeezeName(row.name)] || null;
    const entry = hit || squeezedHit;
    if (!entry) {
      noEntry.push(row.name);
      continue;
    }
    const embed = normalizeYoutubeEmbedUrl(`https://www.youtube.com/watch?v=${entry.videoId}`);
    if (!embed) {
      noEntry.push(`${row.name} (ID نامعتبر ${entry.videoId})`);
      continue;
    }
    filled++;
    console.log(`  + «${row.name}» → ${entry.videoId} (${entry.title.slice(0, 50)})`);
    if (apply) {
      await db.exerciseLibrary.update({ where: { id: row.id }, data: { youtubeUrl: embed } });
    }
  }

  // ۲) گارد معکوس: هر ورودی دیکشنری که در بانک رکوردی نداشت گزارش شود (نام عوض شده؟)
  for (const name of Object.keys(VERIFIED_VIDEOS)) {
    if (!bySqueezed.has(squeezeName(name))) noRecord.push(name);
  }

  console.log(`---`);
  console.log(`بدون ویدیو که ویدیو گرفت: ${filled}`);
  console.log(`ورودی دیکشنری بدون رکورد بانک: ${noRecord.length}${noRecord.length ? " → " + noRecord.join(" | ") : ""}`);
  console.log(`هنوز بی‌ویدیو (ورودی ندارد): ${noEntry.length}${noEntry.length ? " → " + noEntry.join(" | ") : ""}`);

  // آمار نهایی
  const after = await db.exerciseLibrary.findMany({ select: { name: true, videoUrl: true, youtubeUrl: true } });
  const stillNo = after.filter((r) => (r.videoUrl || "").trim() === "" && (r.youtubeUrl || "").trim() === "");
  console.log(`حرکات بانک: ${after.length} | بی‌ویدیوی باقی‌مانده: ${stillNo.length}${stillNo.length ? " → " + stillNo.map((r) => r.name).join(" | ") : ""}`);

  if (!apply) console.log("\nDRY-RUN — برای اعمال واقعی: bun run scripts/fill-exercise-video-gaps.ts --apply");
}

/** نمای فشردهٔ دیکشنری برای تطبیق مقاوم به فاصله/نیم‌فاصله */
const VERIFIED_VIDEOS_BY_SQUEEZED: Record<string, { videoId: string; title: string; channel: string }> =
  Object.fromEntries(Object.entries(VERIFIED_VIDEOS).map(([name, v]) => [squeezeName(name), v]));

main()
  .catch((e) => {
    console.error("[fill-exercise-video-gaps] FAILED:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
