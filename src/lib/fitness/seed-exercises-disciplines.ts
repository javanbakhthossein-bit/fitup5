/**
 * v94 — Seed: حرکات اختصاصی رشته‌های ترند ایران (پیلاتس / TRX / هییت /
 * فانکشنال / بالنس) — دیرکتیو مالک: «تمریناتی که داده می‌شوند باید صفحهٔ آموزش
 * حرکت داشته باشند، ترجیحاً فارسی» و «برنامه باید تخصصی همان رشته باشد».
 * v95 — دیرکتیو مالک: «ما فقط در زمینهٔ ورزشهای تناسب اندام کار میکنیم» —
 * رشتهٔ کیک‌بوکسینگ (ورزش رزمی) حذف شد → ۵۰ حرکت برای ۵ رشته.
 *
 * ۵۰ حرکت (۱۰ برای هر رشتهٔ باقی‌مانده) با توضیح گام‌به‌گام فارسی ۲-۳ جمله‌ای + نکتهٔ ایمنی.
 * اجرای دستی: bun run src/lib/fitness/seed-exercises-disciplines.ts
 *
 * v96 — فیکس ریشه‌ای «حرکات به بانک حرکات اضافه نشده»: این بچ قبلاً فقط با اجرای
 * دستی اسکریپت وارد DB می‌شد (روی پروداکشن هرگز اجرا نشده بود) → حالا آرایهٔ
 * `exercises` export شده و در گام ۴ خودترمیمی DB (db-selfheal — بوت سرور) به‌صورت
 * idempotent درج می‌شود؛ بعد از دیپلوی هیچ اقدام دستی لازم نیست.
 *
 * هیچ ردیف موجودی دست نمی‌خورد (idهای "seed_dx_*" اختصاصی این بچ هستند).
 * AI تولید برنامه فقط از نام حرکات این کتابخانه انتخاب می‌کند — پس این ۵۰ حرکت
 * همان چیزی است که برنامهٔ تخصصی رشته‌ها از بینشان حرکت می‌چیند.
 */
import { db } from "../db";

interface ExerciseSeed {
  id: string;
  name: string;
  muscle: string;
  category: string;
  equipment: string;
  description: string;
  tips: string;
  difficulty: string;
}

const exercises: ExerciseSeed[] = [
  /* ═══════════ پیلاتس (۱۰) ═══════════ */
  {
    id: "seed_dx_1",
    name: "صد پیلاتس (Pilates Hundred)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "به پشت دراز بکش، پاها در حالت تیبل‌توپ بالا، دست‌ها کنار بدن و کمی بالاتر از زمین. سر و شانه‌ها را از زمین بلند کن و دست‌ها را با ریتم تنفس ۵ ضربهٔ کوتاه بالا و ۵ ضربهٔ کوتاه پایین تکان بده تا شمارش ۱۰۰ برسد.",
    tips: "بازدم کامل با انگاژ ناوی (کشیدن شکم به ستون فقرات)؛ اگر گردن خسته شد سر را پایین بیاور ولی دست‌ها را نگه دار.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_2",
    name: "رول‌آپ پیلاتس (Pilates Roll-Up)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "به پشت دراز بکش، دست‌ها صاف بالای سر. با بازدم، مهره‌به‌مهره ستون فقرات را از زمین جدا کن و بدون تکان به سمت انگشتان پا برس، سپس با همان کنترل به علت اول برگرد.",
    tips: "مهره‌به‌مهره بودن کل حرکت است؛ اگر پاها بلند شد، زانوها را کمی خم کن تا کنترل حفظ شود.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_3",
    name: "پلانک خانواده پیلاتس (Front Support)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "روی ساعدها و انگشتان پا، بدن را مثل خط صاف نگه دار؛ کف دست‌ها فاصلهٔ عرض شانه. شکم و باسن را فعال کن و ۲۰ تا ۴۰ ثانیه نفس‌های آرام عمیق بکش.",
    tips: "باسن را نه بالا قوز بده و نه پایین بینداز — فقط خط صاف؛ کتف‌ها را از ستون فقرات دور و «پک» نگه دار.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_4",
    name: "پل باسن پیلاتس (Shoulder Bridge)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "bodyweight",
    description:
      "به پشت، زانوها خم و پاها عرض لگن روی زمین. با بازدم از مهرهٔ پایین ستون فقرات شروع کن و لگن را مهره‌به‌مهره تا روی شانه‌ها بالا ببر، در بالا ۲ ثانیه باسن را فشار بده و با همان کنترل پایین بیا.",
    tips: "قوس کمر در بالا نیاید — بالا رفتن با عضلهٔ باسن است نه هِی کمر؛ دم و بازدم آرام را قطع نکن.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_5",
    name: "سگ-گربه پیلاتس (Cat-Cow Spine Stretch)",
    muscle: "کمر و پشت",
    category: "core",
    equipment: "bodyweight",
    description:
      "چهاردست‌وپا؛ با دم شکم رها و سینه باز (کاو)، با بازدم چانه به سینه و ستون فقرات قوس به بالا (گربه). ۸ تا ۱۰ چرخهٔ آرام؛ حرکت را مهره‌به‌مهره پخش کن.",
    tips: "این حرکت «تنفس جانبی قفسهٔ سینه» را آموزش می‌دهد — دم از پهلوها، شانه‌ها بی‌حرکت.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_6",
    name: "خیابان خوابیده پیلاتس (Side-Lying Leg Series)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "bodyweight",
    description:
      "به پهلو، بدن در یک خط، سر روی دست پایینی. پای بالا را با کنترل بالا ببر و پایین بیاور — ۱۰ تا ۱۲ تکرار، بعد نسخهٔ دایرهٔ کوچک پا (۸ دور هر جهت).",
    tips: "لگن هیچ‌وقت به عقب/جلو نغلتد؛ حرکت از مفصل لگن است. برای فشار بیشتر کش مقاومتی بالای زانو.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_7",
    name: "قو پیلاتس (Swan Prep)",
    muscle: "کمر و پشت",
    category: "core",
    equipment: "bodyweight",
    description:
      "روی شکم، دست‌ها زیر شانه و آرنج‌ها خم. با دم، سینه را مهره‌به‌مهره از زمین بلند کن در حالی که شانه‌ها پایین و عقب می‌مانند؛ با بازدم آرام پایین بیا. ۸ تکرار.",
    tips: "گردن دنبالهٔ طبیعی ستون فقرات است — چانه جمع؛ اگر کمر حساس است بلندشدن فقط تا زیر قفسهٔ سینه.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_8",
    name: "تیزر پیلاتس (Teaser)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "به پشت، پاها ۴۵ درجه و دست‌ها موازی پاها. هم‌زمان پاها و تنه را با کنترل به شکل V بالا بیاور و ۲-۳ ثانیه نگه دار، سپس آرام پایین بیا. ۵ تا ۸ تکرار.",
    tips: "حرکت را با «پایین‌کشیدن شکم» شروع کن نه با شلاق‌زدن دست‌ها؛ نسخهٔ ساده‌تر: زانوها خم بمانند.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_9",
    name: "پیلاتس دیواری سرشانه (Wall Pilates Shoulder Bridge)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "bodyweight",
    description:
      "به پشت و پاها روی دیوار با زانوی ۹۰ درجه. یک پا را از دیوار بردار و با پای دیگر لگن را بالا ببر و پایین بیاور — ۸ تا ۱۰ تکرار هر طرف.",
    tips: "دیوار تکیه‌گاه کنترل است؛ لگن همیشه هم‌تراز (یک طرف بالا نیفتد) — بازدم در فاز بالا رفتن.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_10",
    name: "پیلاتس باز و بسته کردن پاها (Single Leg Stretch)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "به پشت، سر و شانه‌ها بلند، یک زانو به سینه و پای دیگر کشیده و بالاتر از زمین. با هر بازدم جای پاها را عوض کن — ۱۰ تکرار هر طرف با دست‌های کنار زانوی جمع‌شده.",
    tips: "پای کشیده هرگز روی زمین ننشیند؛ کمر پایینِ چسبیده به زمین بماند — اگر جداشد، پای کشیده را بالاتر بیاور.",
    difficulty: "beginner",
  },

  /* ═══════════ TRX (۱۰) ═══════════ */
  {
    id: "seed_dx_11",
    name: "روئینگ TRX ایستاده (TRX Row)",
    muscle: "زیربغل",
    category: "pull",
    equipment: "trx",
    description:
      "دسته‌ها را بگیر و بدن را با زاویهٔ انتخابی به عقب کج کن، دست‌ها کشیده و نوارها کشیده. با فشردن کتف‌ها بدن را تا دست‌ها بالای سینه بکش و آرام برگرد.",
    tips: "هرچه پا جلوتر و بدن افقی‌تر، سنگین‌تر؛ کل حرکت بدن مثل تختهٔ صاف بماند — باسن ساگ نکند.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_12",
    name: "پرس سینه TRX (TRX Chest Press)",
    muscle: "سینه",
    category: "push",
    equipment: "trx",
    description:
      "پشت به نقطهٔ اتصال، دسته‌ها زیر سینه و بدن با زاویهٔ جلو مایل. با خم‌کردن آرنج، سینه را تا نزدیک دسته‌ها پایین ببر و با فشار دست‌ها برگرد.",
    tips: "نوارها همیشه کشیده بمانند؛ هرچه قدم‌های جلو بیشتر و بدن افقی‌تر، فشار سینه بیشتر.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_13",
    name: "اسکوات TRX (TRX Squat)",
    muscle: "پا",
    category: "legs",
    equipment: "trx",
    description:
      "دسته‌ها در ارتفاع سینه، بدن عمود. با کمک نوار (نه با کشیدن!) باسن را عقب بفرست تا ران‌ها موازی زمین شوند و با فشار پاشنه‌ها بلند شو.",
    tips: "کشش نوار فقط برای تعادل است — ۷۰٪ وزن روی پاها؛ زانو در راستای نوک پنجه.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_14",
    name: "لانج TRX (TRX Lunge)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "trx",
    description:
      "یک پا پشتِ شما در یکی از دسته‌ها (سرپا داخل دستهٔ پایین)، پای جلو ثابت. پای عقب را عقب‌تر بفرست تا زانوی جلو ۹۰ درجه شود و با فشار پاشنهٔ جلو بلند شو.",
    tips: "بدن عمود بماند و نوار زیر پشتِ پای عقب کشیده باشد؛ تعادل سخت بود دست‌ها در کمر نه باز.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_15",
    name: "پلانک TRX (TRX Plank)",
    muscle: "شکم",
    category: "core",
    equipment: "trx",
    description:
      "پاها داخل دسته‌ها (ساق یا پنجه)، ساعدها روی زمین. بدن را مثل خط صاف با انگاژ کامل شکم و باسن نگه دار — ۲۰ تا ۴۵ ثانیه.",
    tips: "آویزان‌بودن پاها هسته را بیشتر درگیر می‌کند — اگر شکست خورد، زانوها را پایین بیاور.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_16",
    name: "پایک TRX (TRX Pike)",
    muscle: "شکم",
    category: "core",
    equipment: "trx",
    description:
      "از پلانک TRX با پاهای معلق، باسن را به سمت سقف به شکل V معکوس بالا بفرست و کنترل‌شده به پلانک برگرد. ۸ تا ۱۲ تکرار.",
    tips: "بالا رفتن با عضلات شکم است نه دست‌ها؛ سر بین بازوها نگاه به سمت پنجه‌ها.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_17",
    name: "جلو بازو TRX (TRX Bicep Curl)",
    muscle: "جلوبازو",
    category: "pull",
    equipment: "trx",
    description:
      "رو به نقطهٔ اتصال، دسته‌ها در دست با کف رو به بالا، بدن مایل به عقب. با خم‌کردن آرنج‌ها بدن را جلو بیاور تا دسته‌ها کنار شانه، سپس آرام بازگرد.",
    tips: "آرنج‌ها ثابت کنار بدن؛ زاویهٔ افقی‌تر = سنگین‌تر — کمر هرگز خم نشود.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_18",
    name: "پشت بازو TRX (TRX Triceps Extension)",
    muscle: "پشت‌بازو",
    category: "push",
    equipment: "trx",
    description:
      "رو به نقطهٔ اتصال با دسته‌ها، بدن مایل و آرنج‌ها در ارتفاع سینه. آرنج‌ها را خم کن تا دسته‌ها به پیشانی نزدیک شود (فقط خم از آرنج)، سپس با فشار پشت‌بازو صاف کن.",
    tips: "کل حرکت فقط از آرنج — شانه و بدن مثل مجسمه ثابت؛ سخت بود زاویه را ایستاده‌تر کن.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_19",
    name: "ددل‌لیفت تک‌پا TRX (TRX Single-Leg RDL)",
    muscle: "پشت ران",
    category: "legs",
    equipment: "trx",
    description:
      "ایستاده، دسته‌ها در ارتفاع سینه و یک پا کمی بلند پشت. با هینج از لگن، تنه را جلو ببرد تا بدن T معکوس شود و هم‌زمان پای عقب با بدن یک خط شود؛ با فشار پاشنهٔ اتکا برگرد.",
    tips: "لگن‌ها هم‌تراز بمانند (لگن پای آزاد نچرخد) — کشش نوار فقط برای تعادل.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_20",
    name: "روئینگ تک‌دست TRX (TRX Single-Arm Row)",
    muscle: "پشت",
    category: "pull",
    equipment: "trx",
    description:
      "یک دسته با یک دست بگیر، بدن مایل به عقب و چرخیده به سمت دست کشیده. با فشردن کتف، بدن را بکش و هم‌زمان تنه را باز کن؛ ۸ تا ۱۰ تکرار هر طرف.",
    tips: "چرخش تنه بدون چرخش لگن — شکم ضدچرخش سفت؛ این حرکت هم‌زمان تعادل و پشت را می‌سازد.",
    difficulty: "advanced",
  },

  /* ═══════════ هییت (۱۰) ═══════════ */
  {
    id: "seed_dx_21",
    name: "برپی (Burpee)",
    muscle: "بدن کامل",
    category: "cardio",
    equipment: "bodyweight",
    description:
      "از ایستاده به اسکوات و دست‌ها روی زمین، پاها را عقب به پلانک بفرست، یک شنا بزن، پاها را برگردان و با پرش عمودی دست‌ها بالا پایان بده. نسخهٔ بدون پرش: بلندشدن ایستاده به‌جای پرش.",
    tips: "شکم را در پلانک قفل کن تا کمر نیفتد؛ پرش فرود نرم با زانوی نیم‌خم.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_22",
    name: "جک پرش (Jumping Jacks)",
    muscle: "بدن کامل",
    category: "cardio",
    equipment: "bodyweight",
    description:
      "ایستاده؛ با پرش کوچک پاها باز و دست‌ها بالای سر، با پرش بعدی برگرد. ریتم یکنواخت و تنفس منظم برای ۳۰ تا ۴۵ ثانیه.",
    tips: "فرود روی پنجه با زانوی نرم؛ نسخهٔ کم‌فشار (Low-Impact): به‌جای پرش، یک پا به پهلو.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_23",
    name: "اسکوات پرشی (Jump Squat)",
    muscle: "پا",
    category: "legs",
    equipment: "bodyweight",
    description:
      "اسکوات تا موازی‌بودن ران با زمین، سپس با انفجار از پاشنه‌ها پرش عمودی و فرود نرم دوباره به اسکوات. ۸ تا ۱۲ تکرار در بازهٔ زمانی.",
    tips: "فرود = آماده‌سازی اسکوات بعدی؛ زانوها هم‌راستای پنجه. زانو حساس؟ اسکوات سریع بدون پرش.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_24",
    name: "مأنتین کلایمر (Mountain Climbers)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "در حالت پلانک بلند، زانوها را با سرعت بالا به سمت سینه بکش — مثل دویدن افقی. ۳۰ تا ۴۰ ثانیه با تنفس منظم.",
    tips: "باسن بالا نرود (خط صاف بماند)؛ شانه دقیقاً روی مچ. سرعت ثابت مهم‌تر از شلوغ‌کاری.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_25",
    name: "اسکات سریع در جا (Fast Feet March)",
    muscle: "پا",
    category: "cardio",
    equipment: "bodyweight",
    description:
      "ایستاده با قدم‌های بسیار سریع درجا و زانوها بالا (مارچ پرشتاب) — دست‌ها هماهنگ با پاها حمله می‌کنند. ۳۰ تا ۴۵ ثانیه.",
    tips: "نسخهٔ Low-Impact مطلوب مبتدی و زانو درد؛ روی پنجه‌ها با قدم‌های کوتاه و سریع.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_26",
    name: "پرانچ پرشی (Plyo Lunge)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "bodyweight",
    description:
      "لانج با پرش تعویض پا — در هوا پاها جابه‌جا و فرود در لانج مخالف. ۸ تا ۱۰ تعویض در بازهٔ زمانی.",
    tips: "زانوی جلو روی پنجه نمی‌رود؛ فرود نرم و بلافاصله فرو رفتن به لانج (کمک فنری).",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_27",
    name: "دراپ اسکوات جانبی (Side Shuffle Touch)",
    muscle: "پا",
    category: "cardio",
    equipment: "bodyweight",
    description:
      "در پهنای مشخص (مثلاً ۲ متر) با گام‌های کشی سریع به چپ و راست شافل کن و در هر انتها با دست زمین را لمس کن. ۳۰ تا ۴۰ ثانیه.",
    tips: "مرکز پایین و زانوها خم بماند؛ تعویض جهت با فشار پاشنهٔ بیرونی و تنه صاف.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_28",
    name: "کیک‌بک بازو با دمبل (Dumbbell Punch & Row)",
    muscle: "پشت",
    category: "cardio",
    equipment: "dumbbell",
    description:
      "دمبل سبک در هر دست؛ ترکیب ضربهٔ هوازی سریع جلو + روئینگ دمبل خم هر ۴ ضربه. ۴۰ ثانیهٔ پرانرژی.",
    tips: "ضربه با چرخش لگن — نه فقط بازو؛ کمر صاف در روئینگ و شکم سفت.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_29",
    name: "اسکات و پرش ستاره (Star Jump Squat)",
    muscle: "بدن کامل",
    category: "cardio",
    equipment: "bodyweight",
    description:
      "یک اسکوات کامل، سپس پرش ستاره (پاها باز و دست‌ها بالای سر در هوا) و فرود دوباره به اسکوات. ۸ تا ۱۰ تکرار در بازهٔ کاری.",
    tips: "برای کمر سالم، پرش ستاره را با ارتفاع کم و کنترل انجام بده؛ فرود همیشه نرم روی پنجه با زانوی خم.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_30",
    name: "اسپرینت درجا بلند (High Knees Sprint)",
    muscle: "پا",
    category: "cardio",
    equipment: "bodyweight",
    description:
      "دویدن درجا با زانوهای بلند تا ارتفاع لگن و سرعت بیشینه؛ دست‌ها مثل دویدن واقعی. ۲۰ تا ۳۰ ثانیهٔ آخرِ راند.",
    tips: "تنه کمی جلو و شکم سفت؛ فرود روی توپ پنجه. نسخهٔ کم‌فشار: زانوها متوسط با سرعت ثابت.",
    difficulty: "intermediate",
  },

  /* ═══════════ فانکشنال (۱۰) ═══════════ */
  {
    id: "seed_dx_41",
    name: "اسوینگ کتل‌بل (Kettlebell Swing)",
    muscle: "پشت ران",
    category: "fullbody",
    equipment: "kettlebell",
    description:
      "کتل‌بل دو قدم جلوی پا؛ با هینج از لگن دست‌ها را به کتل‌بل بده و با انفجار باسن کتل‌بل را تا ارتفاع سینه بپراند (نه با بازو!) — ۱۲ تا ۱۵ تکرار.",
    tips: "هینج نه اسکوات: کمر صاف، باسن به عقب؛ حرکت انفجاری با فشار لگن، بازو فقط طناب است.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_42",
    name: "اسکوات گابلت کتل‌بل (Goblet Squat)",
    muscle: "پا",
    category: "legs",
    equipment: "kettlebell",
    description:
      "کتل‌بل با دو دست جلوی سینه (مثل جام)؛ باسن را عقب و پایین بفرست تا ران‌ها موازی شوند و با فشار کل کف پا بلند شو. ۳-۴ ست ۸ تا ۱۲ تکرار.",
    tips: "آرنج‌ها بین زانوها در پایین؛ سینه بالا و کتل‌بل چسبیده به بدن.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_43",
    name: "حمل کشاورز (Farmer Carry)",
    muscle: "بدن کامل",
    category: "fullbody",
    equipment: "kettlebell,dumbbell",
    description:
      "وزنهٔ متقارن در هر دست، شانه‌های پک و قفسهٔ سینه بالا؛ با گام‌های کنترل‌شده ۳۰ تا ۴۰ متر راه برو و بدون شل‌کردن بدن زمین بگذار. ۳ ست.",
    tips: "هستهٔ سفت مثل زره — کمر هیچ قوسی نگیرد؛ گام‌ها کوتاه و ریتمنormal.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_44",
    name: "ددلیفت رومانیایی کتل‌بل (Kettlebell RDL)",
    muscle: "پشت ران",
    category: "legs",
    equipment: "kettlebell",
    description:
      "کتل‌بل جلوی ران؛ با هینج، لگن به عقب و کتل‌بل تا وسط ساق پایین بیاید (کمر صاف) و با فشار باسن ایستاده شو. ۱۰ تا ۱۲ تکرار.",
    tips: "کشش را پشت ران حس کنی نه کمر؛ کتل‌بل نزدیک بدن در تمام مسیر.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_45",
    name: "پرس شانه تک‌زانو کتل‌بل (Half-Kneeling KB Press)",
    muscle: "سرشانه",
    category: "push",
    equipment: "kettlebell",
    description:
      "زانوی یک پا روی زمین (نیم‌زانو)، کتل‌بل در ارتفاع شانهٔ همان طرف؛ کتل‌بل را صاف بالای سر ببر و کنترل‌شده پایین بیاور — ۸ تکرار هر طرف.",
    tips: "لگن رو به جلو و باسن سفت — لایهٔ تعادل این حرکت هسته را هم می‌سازد؛ مچ صاف بالای آرنج.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_46",
    name: "روئینگ کتان‌بل خم سه‌نقطه (Renegade Row)",
    muscle: "پشت",
    category: "pull",
    equipment: "dumbbell",
    description:
      "پلانک بلند روی دو دمبل؛ یک دمبل را با فشردن کتف به سمت کمر بکش بدون چرخش لگن، پایین بگذار و سمت دیگر. ۸ تکرار هر طرف.",
    tips: "پاها بازتر برای ثبات؛ لگن مثل سطح آب صاف — چرخش کوچک یعنی وزنه سنگین است.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_47",
    name: "لانج جانبی با دمبل (Lateral Lunge)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "dumbbell",
    description:
      "دمبل جلوی سینه؛ یک قدم بلند به پهلو، باسنِ همان طرف عقب و پایین (پای دیگر صاف) و با فشار پاشنهٔ خم برگرد. ۸ تکرار هر طرف.",
    tips: "زانوی خم روی پنجه نمی‌رود؛ سینه بالا — این حرکت زانو و آسیب ورزشی را واکسینه می‌کند.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_48",
    name: "گت‌آپ ترکی (Turkish Get-Up نیمه)",
    muscle: "شکم",
    category: "core",
    equipment: "kettlebell",
    description:
      "به پشت، کتل‌بل بالای شانهٔ یک طرف با دست صاف؛ با چرخش تنه و اتکای روی آرنج-دست، تا نشسته بالا بیا و کنترل‌شده برگرد. ۴ تکرار هر طرف.",
    tips: "چشم همیشه به کتل‌بل؛ مچ صاف و قفل؛ نیمهٔ حرکت برای شروع کافی است — کیفیت قبل از کامل‌کردن.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_49",
    name: "پرتاب مدبال دیواری (Wall Ball Throw)",
    muscle: "بدن کامل",
    category: "fullbody",
    equipment: "medicine ball",
    description:
      "مدبال جلوی سینه؛ اسکوات کامل و در بلندشدن مدبال را با انفجار کل بدن به نقطهٔ بالای دیوار پرتاب و پرش ورود مدبال را بگیر. ۱۰ تا ۱۲ تکرار.",
    tips: "قدرت از اسکوات می‌آید — پرتاب با کل زنجیره؛ گرفتن با زانوی آماده (فرود نرم).",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_50",
    name: "بایسپس-اسکوات سیرکویت دمبل (Dumbbell Thruster)",
    muscle: "بدن کامل",
    category: "fullbody",
    equipment: "dumbbell",
    description:
      "دمبل‌ها روی شانه؛ اسکوات کامل و در بلندشدن هم‌زمان پرس بالای سر (تراستر) و بازگشت دمبل‌ها به شانه با فرود. ۸ تا ۱۰ تکرار.",
    tips: "پرس هماهنگ با پاپِ لگن؛ تنفس: دم در اسکوات، بازدم با پرس — حرکت شاه فانکشنال برای کالری و قدرت.",
    difficulty: "advanced",
  },

  /* ═══════════ بالنس و تعادل (۱۰) ═══════════ */
  {
    id: "seed_dx_51",
    name: "ایستادگی تک‌پا (Single-Leg Stance)",
    muscle: "پا",
    category: "legs",
    equipment: "bodyweight",
    description:
      "ایستاده کنار دیوار (دست آمادهٔ تکیه)؛ یک پا را از زمین بلند کن و ۳۰ ثانیه با چشم باز روی پای دیگر بایست — بعد تعویض. قوس کف پا را بلند و انگشتان پهن نگه دار.",
    tips: "نگاه به نقطهٔ ثابت؛ لگن هم‌تراز (پای بالا عقب نرود). سطح ۲: چشم بسته یا تکیه‌گاه حذف.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_52",
    name: "لانج معکوس با مکث (Reverse Lunge Hold)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "bodyweight",
    description:
      "قدم بلند به عقب، پایین تا زانوی جلو ۹۰ درجه و ۲ تا ۳ ثانیه در پایین نگه دار؛ بلند شو و با همان پا تکرار کن. ۸ تکرار هر پا.",
    tips: "مکث = آموزش ثبات؛ تنه صاف و وزن روی پاشنهٔ پای جلو. چشم رو به جلو روی نقطهٔ ثابت.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_53",
    name: "حیوان مرده (Dead Bug)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "به پشت، دست‌ها صاف بالای شانه و زانوها ۹۰ درجه. پای و دست مخالف را هم‌زمان پایین و کشیده کنی بدون جدا شدن کمر از زمین، برگرد و سمت مقابل. ۱۰ تکرار هر ضربدری.",
    tips: "کمر کامل چسبیده به زمین — اگر فاصله افتاد دامنه را کم کن؛ بازدم با انگاژ ناوی در فاز بازشدن.",
    difficulty: "beginner",
    },
  {
    id: "seed_dx_54",
    name: "سگ پرنده (Bird Dog)",
    muscle: "کمر و پشت",
    category: "core",
    equipment: "bodyweight",
    description:
      "چهاردست‌وپا؛ دست چپ و پای راست را هم‌زمان صاف کشیده و ۲ ثانیه نگه دار — لگن و شانه در یک خط. ۸ تا ۱۰ تکرار هر ضربدری با کنترل.",
    tips: "پای کشیده بالاتر از لگن نرود (کمر قوس نگیرد)؛ تصور کن لیوانی روی کمرت است که نباید بریزد.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_55",
    name: "رسیدن تک‌پا (Single-Leg Reach)",
    muscle: "پشت ران",
    category: "legs",
    equipment: "bodyweight",
    description:
      "ایستاده روی یک پا؛ پای آزاد عقب و تنه جلو (T معکوس) در حالی که دست‌ها به جلو می‌رسند؛ ۲ ثانیه نگه دار و با فشار پاشنه برگرد. ۸ تکرار هر پا.",
    tips: "لگن‌ها هم‌تراز (پای عقب به سقف نچرخد)؛ حرکت هینج است — کشش پشت ران حس شود.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_56",
    name: "راه‌رفتن پاشنه به پنجه (Heel-to-Toe Walk)",
    muscle: "پا",
    category: "legs",
    equipment: "bodyweight",
    description:
      "۱۰ گام در یک خط مستقیم با تماس کامل پاشنهٔ جلو به پنجهٔ عقب، دست‌ها برای تعادل باز یا روی کمر؛ بعد برگشت به عقب با همان الگو.",
    tips: "نگاه به انتهای خط نه زیر پا؛ کنار دیوار/میز برای اطمینان. سه دور رفت‌وبرگشت.",
    difficulty: "beginner",
  },
  {
    id: "seed_dx_57",
    name: "اسکوات روی سطح ناپایدار (Cushion Squat)",
    muscle: "پا",
    category: "legs",
    equipment: "bodyweight",
    description:
      "روی بالش سخت یا مت تاشده بایست و اسکوات سبک (۴۰-۵۰٪ عمق) با سرعت خیلی آرام انجام بده — ۱۰ تکرار. سطح ناپایدار عضلات کوچک مچ و کف پا را فعال می‌کند.",
    tips: "کنار دیوار شروع کن؛ توزیع وزن روی سه نقطهٔ کف پا (پاشنه + دو سر پنجه).",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_58",
    name: "اسکلات جانبی تک‌پا (Single-Leg Side Reach)",
    muscle: "پا و باسن",
    category: "legs",
    equipment: "bodyweight",
    description:
      "روی یک پا؛ دست بالا و تنه را به پهلو مخالف خم کن (رسیدن جانبی) و برگرد — ۸ تکرار، بعد تعویض پا. پای اتکا با انگاژ کف پا ثابت می‌ماند.",
    tips: "خم‌شدن از لگن و پهلو نه از کمر؛ نقطهٔ نگاه ثابت. برای چالش: یک دمبل سبک در دست.",
    difficulty: "intermediate",
  },
  {
    id: "seed_dx_59",
    name: "چالش دوگانه تک‌پا (Single-Leg Dual Task)",
    muscle: "شکم",
    category: "core",
    equipment: "bodyweight",
    description:
      "تک‌پا بایست و هم‌زمان یک چالش ذهنی ساده انجام بده: شمردن معکوس از ۳۰ با فاصلهٔ ۳، یا پاس‌دادن توپ به دیوار. ۳۰ ثانیه هر پا.",
    tips: "چالش دوگانه واکنش واقعی زندگی را تمرین می‌دهد؛ اگر تعادل شکست، شمردن را ساده‌تر کن نه تکیه‌گاه را.",
    difficulty: "advanced",
  },
  {
    id: "seed_dx_60",
    name: "بلندشدن از صندلی تک‌پا (Single-Leg Sit-to-Stand)",
    muscle: "پا",
    category: "legs",
    equipment: "bodyweight",
    description:
      "جلوی صندلی؛ یک پا بلند، با پای دیگر با کنترل نشست و بدون کمک دست با فشار پاشنه بلند شو. ۵ تا ۸ تکرار هر پا.",
    tips: "استاندارد طلایی تعادل کاربردی سالمندان؛ صندلی بلندتر = آسان‌تر — با تنهٔ کمی جلو بلند شو.",
    difficulty: "advanced",
  },
];

// v95 — دیرکتیو مالک: «ما فقط در زمینهٔ ورزشهای تناسب اندام کار میکنیم» —
// کیک‌بوکسینگ حذف شد؛ این idها از DBهای موجود هم پاک می‌شوند (idempotent).
const REMOVED_KICKBOXING_IDS = [
  "seed_dx_31", "seed_dx_32", "seed_dx_33", "seed_dx_34", "seed_dx_35",
  "seed_dx_36", "seed_dx_37", "seed_dx_38", "seed_dx_39", "seed_dx_40",
];

/**
 * v96 — خروجی برای خودترمیمی DB (db-selfheal گام ۴): آرایهٔ حرکات + idهای
 * حذف‌شدهٔ کیک‌بوکسینگ. import این ماژول هرگز main را اجرا نمی‌کند —
 * گارد import.meta.main پایین فایل است (فقط اجرای مستقیم CLI کار می‌کند).
 */
export const DISCIPLINE_EXERCISES: ExerciseSeed[] = exercises;
export const REMOVED_KICKBOXING_SEED_IDS: string[] = REMOVED_KICKBOXING_IDS;

async function main() {
  console.log(`🏋️ افزودن ${exercises.length} حرکت رشته‌های ترند (پیلاتس/TRX/هییت/فانکشنال/بالنس)...`);

  // v95 — پاک‌سازی حرکات کیک‌بوکسینگ حذف‌شده از نسخه‌های قبل
  let removed = 0;
  for (const id of REMOVED_KICKBOXING_IDS) {
    try {
      const del = await db.exerciseLibrary.deleteMany({ where: { id } });
      removed += del.count;
    } catch {
      // جدول/رکورد نیست — مهم نیست
    }
  }
  if (removed > 0) console.log(`  🥊 حذف ${removed} حرکت کیک‌بوکسینگ (حذف رشتهٔ رزمی — v95)`);

  let added = 0;
  let skipped = 0;

  for (const ex of exercises) {
    const existing = await db.exerciseLibrary.findUnique({ where: { id: ex.id } });
    if (existing) {
      skipped++;
      continue;
    }

    await db.exerciseLibrary.create({
      data: {
        id: ex.id,
        name: ex.name,
        muscle: ex.muscle,
        category: ex.category,
        equipment: ex.equipment,
        description: ex.description,
        tips: ex.tips,
        mediaUrl: "",
        youtubeUrl: "",
        difficulty: ex.difficulty,
      },
    });
    added++;
  }

  const total = await db.exerciseLibrary.count();
  console.log(`\n🎉 تمام!`);
  console.log(`  - افزوده شده: ${added}`);
  console.log(`  - رد شده (تکراری): ${skipped}`);
  console.log(`  - مجموع حرکات کتابخانه: ${total}`);
}

// فقط وقتی مستقیماً به‌عنوان CLI اجرا می‌شود (bun run ...) خودکار اجرا کن؛
// import در ماژول‌های دیگر (db-selfheal) نباید main را اجرا یا پروسه را ببندد.
if ((import.meta as unknown as { main?: boolean }).main) {
  main().catch(console.error).finally(() => process.exit(0));
}