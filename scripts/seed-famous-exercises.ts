/**
 * seed-famous-exercises.ts — افزودن حرکات معروفِ گم‌شده به بانک حرکات (v114)
 *
 * زمینه (درخواست مالک): «حرکات معروف مثل پرس بالاسینه با دمبل، پرس زیرسینه،
 * جلو بازو دمبل/هالتر وجود ندارند و عوضش حرکات گمنام هست.»
 *
 * این اسکریپت «تجمیعی» و کاملاً idempotent است:
 *   • حرکتی که از قبل هست (حتی با اختلاف «با» در نام) دست نمی‌خورد
 *     — هیچ ویدیو/متن ویرایش‌شدهٔ ادمین بازنویسی نمی‌شود.
 *   • اگر حرکت موجودِ هم‌نام ویدیوی یوتیوب «خالی» داشت و ویدیوی معتبری
 *     برایش داریم → فقط یوتیوبِ خالی پر می‌شود (هدف: «هیچ حرکتی بدون ویدیو»).
 *   • حرکات جدید با youtubeUrl از scripts/exercise-video-fixes.json
 *     (همهٔ IDها از قبل با oEmbed صحت‌سنجی شده‌اند) ساخته می‌شوند.
 *
 * اجرا:
 *   bun run scripts/seed-famous-exercises.ts           # گزارش (DRY-RUN)
 *   bun run scripts/seed-famous-exercises.ts --apply   # اعمال واقعی
 *
 * ⚠️ آفلاین و بدون ریسک: هرگز چیزی حذف/بازنویسی کامل نمی‌کند؛ در هر دیپلوی
 * (deploy.sh قدم ۱۲-ج۳) خودکار اجرا می‌شود تا حرکات معروف همیشه تضمین‌شده باشند.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";
import path from "path";

const db = new PrismaClient({
  datasources: {
    db: { url: process.env.MAP_DB_URL || process.env.DATABASE_URL },
  },
});
const APPLY = process.argv.includes("--apply");

// ─── نرمال‌سازی نام برای تشخیص تکراری (هم‌ارز موتور جستجوی سمت اپ) ───
function normalizeName(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // اعراب
    .replace(/\u064A/g, "\u06CC") // ي → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/\u06C0/g, "\u0647")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[\s\u200C\-–—_]+/g, "") // فاصله/نیم‌فاصله حذف
    .replace(/[.,،؛:!؟?"'()«»[\]]+/g, "");
}
/** «پرس سینه با هالتر» == «پرس سینه هالتر» — حذف حرف اضافهٔ «با» */
function dedupeKey(input: string): string {
  return normalizeName(input).replace(/با/g, "");
}

type NewExercise = {
  name: string;
  /** کلید در scripts/exercise-video-fixes.json (ویدیوی صحت‌سنجی‌شده) */
  videoKey: string;
  muscle: string;
  category: "push" | "pull" | "legs" | "core" | "cardio" | "fullbody";
  equipment: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  description: string;
  tips: string;
};

// ─────────────────────────────────────────────────────────────────────────
// حرکات معروفِ پایه — همهٔ لقب‌های جستجوی رایج (پرس سینه/بالاسینه/زیرسینه،
// جلو بازو، پشت بازو، نشر، زیربغل، اسکوات، ددلیفت، لانژ، پرس پا و…)
// ─────────────────────────────────────────────────────────────────────────
const FAMOUS_EXERCISES: NewExercise[] = [
  // ─── سینه (۹) ───
  {
    name: "پرس سینه دمبل",
    videoKey: "پرس سینه با دمبل",
    muscle: "سینه", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "روی نیمکت تخت دراز بکشید و دمبل‌ها را بالای سینه نگه دارید. دمبل‌ها را با کنترل تا کنار سینه پایین بیاورید و سپس به سمت بالا فشار دهید.",
    tips: "آرنج‌ها کمی زیر خط سینه بمانند و مچ‌ها صاف باشد. پایین آوردن وزنه را آهسته انجام دهید.",
  },
  {
    name: "پرس بالاسینه هالتر",
    videoKey: "پرس بالاسینه با هالتر",
    muscle: "سینه", category: "push", equipment: "barbell", difficulty: "intermediate",
    description: "نیمکت را ۳۰ تا ۴۵ درجه شیب بدهید، هالتر را بالاتر از سینه پایین آورده و به سمت بالا پرس کنید. این حرکت بخش بالایی سینه را هدف می‌گیرد.",
    tips: "شیب بیش از ۴۵ درجه فشار را به سرشانه منتقل می‌کند. پاها محکم روی زمین باشند.",
  },
  {
    name: "پرس بالاسینه دمبل",
    videoKey: "پرس سینه دمبل شیب‌دار با چرخش",
    muscle: "سینه", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "روی نیمکت شیب‌دار دراز بکشید و دمبل‌ها را بالای بخش بالایی سینه پرس کنید. دامنهٔ کامل حرکت و کشش در پایین را حفظ کنید.",
    tips: "دمبل‌ها را تا حد کشش ملایم پایین بیاورید؛ بیش از حد پایین نروید تا شانه آسیب نبیند.",
  },
  {
    name: "پرس زیرسینه هالتر",
    videoKey: "پرس زیرسینه با هالتر",
    muscle: "سینه", category: "push", equipment: "barbell", difficulty: "intermediate",
    description: "نیمکت را منفی (۱۵ تا ۳۰ درجه رو به پایین) تنظیم کنید و هالتر را تا بخش پایینی سینه پایین آورده و پرس کنید.",
    tips: "در این حرکت دامنه کوتاه‌تر است؛ از بالا بردن باسن از نیمکت بپرهیزید.",
  },
  {
    name: "پرس زیرسینه دمبل",
    videoKey: "پرس زیرسینه با هالتر",
    muscle: "سینه", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "همان الگوی پرس زیرسینه با هالتر اما با دمبل؛ دامنهٔ بیشتر و کار مستقل‌تر هر سمت از سینه پایینی.",
    tips: "مسیر دمبل‌ها عمودی و هماهنگ باشد. وزنه را کنترل‌شده پایین بیاورید.",
  },
  {
    name: "فلای دمبل خوابیده",
    videoKey: "فلای سینه روی توپ بدنسازی",
    muscle: "سینه", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "روی نیمکت تخت دراز بکشید و با آرنج‌های کمی خم، دمبل‌ها را از دو طرف مثل پرنده باز کرده و دوباره بالای سینه جمع کنید.",
    tips: "آرنج در کل حرکت زاویه ثابت نگه دارد؛ وزنه سبک‌تر از پرس انتخاب کنید.",
  },
  {
    name: "کراس‌اور سیم‌کش",
    videoKey: "کراس‌اور سیم‌کش",
    muscle: "سینه", category: "push", equipment: "cable", difficulty: "intermediate",
    description: "ایستاده، دستگیره‌های سیم‌کش بالا را بگیرید و دست‌ها را از دو طرف به سمت جلو و پایین به هم برسانید.",
    tips: "در نقطهٔ تماس یک ثانیه انقباض سینه نگه دارید. کمر قوس زیادی نگیرد.",
  },
  {
    name: "فلای سینه سیم‌کش",
    videoKey: "فلای سینه با سیم‌کش",
    muscle: "سینه", category: "push", equipment: "cable", difficulty: "beginner",
    description: "با سیم‌کش‌های هم‌سطح سینه، دست‌ها را باز کرده و با قوس ثابت به سمت جلو جمع کنید. کشش دائمی در کل دامنه حفظ می‌شود.",
    tips: "تنه کمی به جلو خم باشد و شانه‌ها عقب. حرکت از سینه شروع شود نه بازو.",
  },
  {
    name: "شنا سوئدی",
    videoKey: "شنا با پای بالا",
    muscle: "سینه", category: "push", equipment: "bodyweight", difficulty: "beginner",
    description: "با دست‌ها کمی بازتر از عرض شانه و بدن صاف، سینه را تا نزدیکی زمین پایین برده و به بالا فشار دهید.",
    tips: "بدن از سر تا پاشنه یک خط صاف باشد؛ باسن بالا نیاید و شکم منقبض بماند.",
  },

  // ─── سرشانه (۷) ───
  {
    name: "پرس سرشانه دمبل نشسته",
    videoKey: "پرس سرشانه دمبل نشسته",
    muscle: "سرشانه", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "روی نیمکت با پشتی بنشینید، دمبل‌ها هم‌سطح گوش‌ها باشند و به سمت بالا پرس کنید تا دمبل‌ها بالای سر جمع شوند.",
    tips: "کمر به پشتی چسبیده باشد و قوس کمر کم باشد. پایین آمدن تا هم‌سطح گوش کافی است.",
  },
  {
    name: "پرس سرشانه هالتر ایستاده",
    videoKey: "پرس سرشانه هالتر ایستاده",
    muscle: "سرشانه", category: "push", equipment: "barbell", difficulty: "intermediate",
    description: "ایستاده، هالتر را از بالای سینه (جلوی گردن) به سمت بالا پرس کنید. حرکتی بنیادی برای قدرت و حجم سرشانه.",
    tips: "شکم و باسن را منقبض کنید تا کمر قوس نگیرد. هالتر از جلوی صورت عبور کند.",
  },
  {
    name: "نشر جانب دمبل",
    videoKey: "نشر جانب نشسته",
    muscle: "سرشانه", category: "push", equipment: "dumbbell", difficulty: "beginner",
    description: "ایستاده و دمبل‌ها کنار بدن، دست‌ها را از جانب با آرنج‌های کمی خم تا هم‌سطح شانه بالا بیاورید و با کنترل پایین بیاورید.",
    tips: "وزنه سبک و اجرای تمیز؛ بالا رفتن از شانه یعنی فشار به تله‌ها نه سرشانه.",
  },
  {
    name: "نشر از جلو دمبل",
    videoKey: "نشر از جلو",
    muscle: "سرشانه", category: "push", equipment: "dumbbell", difficulty: "beginner",
    description: "دمبل‌ها جلوی ران، دست‌ها را صاف از جلو تا هم‌سطح شانه بالا ببرید و با کنترل پایین بیاورید. سرشانه جلویی را هدف می‌گیرد.",
    tips: "بدن را عقب نیندازید؛ از تکان دادن کمر برای بالا بردن وزنه پرهیز کنید.",
  },
  {
    name: "نشر خم دمبل",
    videoKey: "نشر خم دمبل سرشانه",
    muscle: "سرشانه", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "با تنهٔ خم به جلو و دمبل‌ها آویزان، دست‌ها را از دو طرف تا ارتفاع شانه باز کنید. سرشانه خلفی را هدف می‌گیرد.",
    tips: "کمر صاف و ثابت بماند؛ حرکت فقط از مفصل شانه انجام شود.",
  },
  {
    name: "فیس‌پول",
    videoKey: "فیس پول سرشانه",
    muscle: "سرشانه", category: "pull", equipment: "cable", difficulty: "beginner",
    description: "طناب سیم‌کش هم‌سطح صورت را به سمت پیشانی بکشید و در پایان حرکت دست‌ها را باز کنید. برای سلامت شانه و posture عالی است.",
    tips: "آرنج‌ها بالاتر از مچ بمانند. وزنه سبک و تکرار بالاتر پیشنهاد می‌شود.",
  },
  {
    name: "شراگ دمبل",
    videoKey: "شراگ",
    muscle: "سرشانه", category: "pull", equipment: "dumbbell", difficulty: "beginner",
    description: "دمبل‌ها را کنار بدن نگه دارید و شانه‌ها را به سمت گوش‌ها بالا بیاورید، یک لحظه نگه دارید و پایین بیاورید.",
    tips: "چرخش شانه لازم نیست؛ فقط حرکت عمودی بالا/پایین. گردن ریلکس باشد.",
  },

  // ─── جلو بازو (۵) ───
  {
    name: "جلو بازو دمبل",
    videoKey: "جلو بازو دمبل",
    muscle: "جلوبازو", category: "pull", equipment: "dumbbell", difficulty: "beginner",
    description: "ایستاده، دمبل‌ها کنار بدن و کف دست رو به جلو؛ دمبل‌ها را با خم کردن آرنج بالا ببرید و با کنترل پایین بیاورید.",
    tips: "آرنج کنار بدن ثابت بماند و از تاب دادن بدن پرهیز کنید.",
  },
  {
    name: "جلو بازو هالتر",
    videoKey: "جلو بازو هالتر EZ با مکث",
    muscle: "جلوبازو", category: "pull", equipment: "barbell", difficulty: "beginner",
    description: "هالتر را با عرض شانه بگیرید و با خم کردن آرنج تا بالا و پایین کنترل‌شده حرکت دهید. پایهٔ اصلی تمرین جلوبازو.",
    tips: "بدن ثابت؛ بالا آوردن با تکان زانو یعنی وزنه سنگین است. پایین آمدن آرام باشد.",
  },
  {
    name: "جلو بازو چکشی دمبل",
    videoKey: "جلو بازو دمبل چکشی",
    muscle: "جلوبازو", category: "pull", equipment: "dumbbell", difficulty: "beginner",
    description: "دمبل‌ها را مثل چکش (کف دست رو به بدن) بالا و پایین کنید. هم جلوبازو و هم عضلهٔ براکیالیس را درگیر می‌کند.",
    tips: "آرنج ثابت کنار بدن؛ حرکت تمیز و بدون چرخش مچ.",
  },
  {
    name: "جلو بازو تمرکزی دمبل",
    videoKey: "جلو بازو متمرکز دمبل",
    muscle: "جلوبازو", category: "pull", equipment: "dumbbell", difficulty: "intermediate",
    description: "نشسته و آرنج روی ران داخلی تکیه داده، دمبل را با تمرکز کامل بالا ببرید. ایزوله‌ترین حرکت جلوبازو.",
    tips: "بالای حرکت دمبل را بفشارید؛ بدن برای کمک به حرکت نچرخد.",
  },
  {
    name: "جلو بازو دمبل روی نیمکت شیب‌دار",
    videoKey: "جلو بازو دمبل نشسته",
    muscle: "جلوبازو", category: "pull", equipment: "dumbbell", difficulty: "intermediate",
    description: "روی نیمکت شیب‌دار (۴۵ درجه) با دمبل‌های آویزان، جلوبازو را در دامنهٔ کشیده‌تر تمرین کنید.",
    tips: "آرنج‌ها کمی پشت تنه قرار می‌گیرند؛ وزنه سبک‌تر از حالت ایستاده لازم است.",
  },

  // ─── پشت بازو (۵) ───
  {
    name: "پشت بازو سیم‌کش طناب",
    videoKey: "پشت بازو سیم‌کش طناب",
    muscle: "پشت‌بازو", category: "push", equipment: "cable", difficulty: "beginner",
    description: "طناب سیم‌کش بالا را بگیرید و با ثابت نگه داشتن آرنج کنار بدن، طناب را به سمت پایین بکشید و در انتها دست‌ها را کمی باز کنید.",
    tips: "آرنج ثابت کنار بدن؛ در پایین حرکت انقباض کامل پشت بازو را حس کنید.",
  },
  {
    name: "پشت بازو دمبل تک‌دست بالای سر",
    videoKey: "پشت بازو تک‌دست دمبل",
    muscle: "پشت‌بازو", category: "push", equipment: "dumbbell", difficulty: "intermediate",
    description: "دمبل را با یک دست بالای سر نگه دارید و با خم شدن آرنج پشت سر، دمبل را پایین برده و دوباره صاف کنید.",
    tips: "بازو کنار گوش ثابت بماند؛ فقط آرنج حرکت کند. کمر قوس نگیرد.",
  },
  {
    name: "پشت بازو هالتر خوابیده",
    videoKey: "پشت بازو هالتر خوابیده",
    muscle: "پشت‌بازو", category: "push", equipment: "barbell", difficulty: "intermediate",
    description: "خوابیده، هالتر را بالای سینه نگه دارید و با خم کردن آرنج، هالتر را پشت پیشانی پایین برده و صاف کنید (اسکال‌کراشر).",
    tips: "آرنج‌ها ثابت و رو به سقف؛ با هالتر EZ فشار مچ کمتر است.",
  },
  {
    name: "دیپس پارالل",
    videoKey: "دیپس پارالل با مکث",
    muscle: "پشت‌بازو", category: "push", equipment: "bodyweight", difficulty: "intermediate",
    description: "بین دسته‌های پارالل آویزان شوید، بدن را کمی متمایل به جلو نگه دارید و با خم و صاف کردن آرنج بالا و پایین بروید.",
    tips: "پایین رفتن بیش از حد به شانه فشار می‌آورد؛ تا زاویه ۹۰ درجه آرنج کافی است.",
  },
  {
    name: "پشت بازو دیپس روی نیمکت",
    videoKey: "پشت بازو دیپس نیمکت",
    muscle: "پشت‌بازو", category: "push", equipment: "bodyweight", difficulty: "beginner",
    description: "دست‌ها را روی لبهٔ نیمکت بگذارید، پاها جلوی بدن و باسن در هوا؛ با خم کردن آرنج پایین بروید و صاف بالا بیایید.",
    tips: "باسن نزدیک نیمکت بماند؛ شانه‌ها پایین و عقب.",
  },

  // ─── زیربغل / پشت (۸) ───
  {
    name: "زیربغل دمبل خم",
    videoKey: "زیربغل دمبل خم",
    muscle: "زیربغل", category: "pull", equipment: "dumbbell", difficulty: "intermediate",
    description: "با تنهٔ خم به جلو (کمر صاف) و دمبل‌ها آویزان، دمبل‌ها را به سمت شکم/باسن بکشید و با کنترل پایین بیاورید.",
    tips: "کمر صاف و ثابت؛ حرکت با آرنج شروع شود نه دست. سر رو به جلو.",
  },
  {
    name: "زیربغل دمبل تک‌خم",
    videoKey: "زیربغل دمبل تک‌دست",
    muscle: "زیربغل", category: "pull", equipment: "dumbbell", difficulty: "intermediate",
    description: "یک زانو و یک دست روی نیمکت، دمبل را با دست دیگر به سمت باسن بکشید. هر سمت پشت به‌طور مستقل تمرین می‌شود.",
    tips: "شانه را نچرخانید؛ در بالای حرکت کتف را به هم نزدیک کنید.",
  },
  {
    name: "زیربغل سیم‌کش بالا",
    videoKey: "زیربغل سیم‌کش بالا",
    muscle: "زیربغل", category: "pull", equipment: "cable", difficulty: "beginner",
    description: "نشسته، میلهٔ سیم‌کش بالا را به سمت بالای سینه بکشید در حالی که کتف‌ها را پایین و عقب نگه می‌دارید (لات پول‌داون).",
    tips: "بدن را عقب نیندازید؛ با بازو نه با تاب بدن بکشید. میله تا بالای سینه کافی است.",
  },
  {
    name: "بارفیکس",
    videoKey: "بارفیکس عریض",
    muscle: "زیربغل", category: "pull", equipment: "bodyweight", difficulty: "advanced",
    description: "از بارفیکس آویزان شوید و با کشیدن آرنج‌ها به سمت بدن، تا جایی بالا بروید که چانه از میله رد شود.",
    tips: "از تاب خوردن پرهیز کنید؛ پایین آمدن کامل (کشش) بخشی از حرکت است.",
  },
  {
    name: "روئینگ هالتر خم",
    videoKey: "زیربغل هالتر خم ۴۵ درجه",
    muscle: "زیربغل", category: "pull", equipment: "barbell", difficulty: "intermediate",
    description: "با تنهٔ خم حدود ۴۵ درجه و کمر صاف، هالتر را به سمت شکم بکشید و کنترل‌شده پایین بیاورید. حرکت اصلی تودهٔ پشت.",
    tips: "زانو کمی خم؛ هالتر نزدیک بدن بماند و کمر گرد نشود.",
  },
  {
    name: "روئینگ سیم‌کش نشسته",
    videoKey: "زیربغل قایقی نشسته",
    muscle: "زیربغل", category: "pull", equipment: "cable", difficulty: "beginner",
    description: "نشسته با پاها روی صفحه، دستگیره را به سمت شکم بکشید و کتف‌ها را در پایان به هم نزدیک کنید.",
    tips: "تنه ثابت؛ از عقب‌رفتن بیش از حد بدن برای کمک پرهیز کنید.",
  },
  {
    name: "زیربغل تی‌بار",
    videoKey: "زیربغل تی‌بار",
    muscle: "زیربغل", category: "pull", equipment: "barbell", difficulty: "advanced",
    description: "با تنهٔ خم، انتهای هالتر (تی‌بار) را با هر دو دست بکشید. تمرین سنگین برای ضخامت پشت.",
    tips: "کمر صاف حیاتی است؛ وزنه را طوری انتخاب کنید که فرم حفظ شود.",
  },
  {
    name: "ددلیفت هالتر",
    videoKey: "ددلیفت کتل‌بل",
    muscle: "کمر و پشت", category: "fullbody", equipment: "barbell", difficulty: "advanced",
    description: "هالتر را از زمین با پاها عرض شانه، کمر صاف و فشار از پاشنه بلند کنید. پادشاه حرکات قدرتی برای کل زنجیرهٔ پشتی بدن.",
    tips: "هالتر چسبیده به پا بالا بیاید؛ کمر هرگز گرد نشود. با وزنه سبک فرم را تثبیت کنید.",
  },
  {
    name: "ددلیفت رومانیایی هالتر",
    videoKey: "ددلیفت رومانیایی با مکث",
    muscle: "پشت ران", category: "legs", equipment: "barbell", difficulty: "intermediate",
    description: "هالتر جلوی ران؛ با زانوهای کمی خم، باسن را عقب بدهید و هالتر را تا وسط ساق پایین آورده و با انقباض پشت ران بالا بیایید.",
    tips: "دامنه را با انعطاف بدن تنظیم کنید؛ کشش پشت ران باید حس شود نه فشار کمر.",
  },
  {
    name: "هایپراکستنشن",
    videoKey: "هایپراکستنشن",
    muscle: "کمر و پشت", category: "core", equipment: "bodyweight", difficulty: "beginner",
    description: "روی دستگاه هایپراکستنشن، باسن را منقبض کرده و تنه را تا خط بدن بالا بیاورید. تقویت‌کنندهٔ پایین‌کمر و پشت ران.",
    tips: "از قوس بیش از حد در بالای حرکت پرهیز کنید؛ حرکت آهسته و کنترل‌شده.",
  },

  // ─── پا (۸) ───
  {
    name: "اسکوات هالتر",
    videoKey: "اسکوات با مکث در پایین",
    muscle: "پا", category: "legs", equipment: "barbell", difficulty: "advanced",
    description: "هالتر روی شانه‌های بالایی؛ با نشستن باسن به عقب و پایین تا موازی شدن ران با زمین، سپس فشار از پاشنه برای بالا آمدن.",
    tips: "سینه بالا و نگاه رو به جلو؛ زانوها در مسیر پنجه بمانند. عمق را تدریجی افزایش دهید.",
  },
  {
    name: "اسکوات جلو هالتر",
    videoKey: "اسکوات جلو هالتر",
    muscle: "پا", category: "legs", equipment: "barbell", difficulty: "advanced",
    description: "هالتر روی سرشانه‌های جلویی و آرنج‌ها بالا؛ اسکوات را با تنهٔ عمودی‌تر انجام دهید. تمرکز بیشتر روی چهارسر ران.",
    tips: "آرنج‌ها را بالا نگه دارید تا هالتر سر نخورد؛ با وزنه سبک تمرین کنید.",
  },
  {
    name: "پرس پا دستگاه",
    videoKey: "پرس پا با مکث",
    muscle: "پا", category: "legs", equipment: "machine", difficulty: "beginner",
    description: "روی دستگاه پرس پا، صفحه را با فشار از پاشنه تا نزدیک صاف شدن زانو هل دهید و با کنترل پایین بیاورید.",
    tips: "کمر به صندلی چسبیده بماند؛ زانو در بالای حرکت قفل کامل نشود.",
  },
  {
    name: "جلو پا دستگاه",
    videoKey: "جلوی پا دستگاه",
    muscle: "جلو ران", category: "legs", equipment: "machine", difficulty: "beginner",
    description: "روی دستگاه جلو پا نشسته، مچ پا زیر بالشتک و پا را تا صاف شدن بالا ببرید و آهسته پایین بیاورید. ایزولهٔ چهارسر ران.",
    tips: "در بالای حرکت یک لحظه انقباض نگه دارید؛ از پرتاب وزنه پرهیز کنید.",
  },
  {
    name: "پشت پا خوابیده دستگاه",
    videoKey: "پشت پا خوابیده",
    muscle: "پشت ران", category: "legs", equipment: "machine", difficulty: "beginner",
    description: "روی دستگاه شکم‌به‌پایین، پاشنه زیر بالشتک و پا را تا باسن خم کنید و با کنترل پایین بیاورید. ایزولهٔ پشت ران.",
    tips: "باسن از نشیمن بلند نشود؛ حرکت آرام و بدون شوت‌زدن.",
  },
  {
    name: "ساق پا ایستاده",
    videoKey: "ساق پا ایستاده",
    muscle: "پا", category: "legs", equipment: "machine", difficulty: "beginner",
    description: "روی دستگاه ساق ایستاده، پنجه‌ها روی صفحه و پاشنه در هوا؛ روی پنجه بالا بروید و با کنترل پاشنه را پایین بدهید.",
    tips: "در بالای حرکت مکث کنید؛ دامنهٔ کامل (کشش پایین تا انقباض بالا) مهم است.",
  },
  {
    name: "لانژ دمبل راه‌رویی",
    videoKey: "لانگز پیاده‌روی با دمبل",
    muscle: "پا و باسن", category: "legs", equipment: "dumbbell", difficulty: "intermediate",
    description: "دمبل‌ها در دست، با قدم‌های بلند به جلو راه بروید و با هر قدم تا زاویهٔ ۹۰ درجه پایین بروید. پا و باسن را هم‌زمان می‌سازد.",
    tips: "زانوی جلو از پنجه جلوتر نرود؛ بالاتنه صاف و نگاه رو به جلو.",
  },
  {
    name: "اسکوات بلغاری دمبل",
    videoKey: "اسکوات بلغاری دمبل",
    muscle: "پا و باسن", category: "legs", equipment: "dumbbell", difficulty: "advanced",
    description: "پای عقب روی نیمکت، دمبل‌ها کنار بدن؛ با پای جلو پایین بروید تا ران موازی زمین شود. بهترین حرکت تک‌پا برای تعادل و قدرت.",
    tips: "فاصلهٔ مناسب از نیمکت؛ زانوی جلو ثابت در راستای پنجه بماند.",
  },

  // ─── شکم و مرکب (۶) ───
  {
    name: "کرانچ دوچرخه",
    videoKey: "کرانچ دوچرخه",
    muscle: "شکم", category: "core", equipment: "bodyweight", difficulty: "beginner",
    description: "خوابیده، دست‌ها پشت سر؛ زانوی مخالف را به سمت آرنج مقابل بکشید و پاها مثل پدال دوچرخه حرکت کنند.",
    tips: "با شکم بچرخید نه با کشیدن گردن؛ حرکت آرام و کنترل‌شده.",
  },
  {
    name: "پلانک",
    videoKey: "پلانک با تپ شانه",
    muscle: "شکم", category: "core", equipment: "bodyweight", difficulty: "beginner",
    description: "روی ساعد و پنجه پا، بدن از سر تا پاشنه صاف و شکم منقبض؛ همین وضعیت را نگه دارید. پایهٔ قدرت مرکزی بدن.",
    tips: "باسن نه بالا نه پایین؛ نفس نگه ندارید و باسن هم‌سطح بدن بماند.",
  },
  {
    name: "پلانک جانبی",
    videoKey: "پلانک جانبی",
    muscle: "شکم", category: "core", equipment: "bodyweight", difficulty: "beginner",
    description: "روی یک ساعد و لبهٔ بیرونی پا، بدن صاف و لگن بالا؛ عضلات جانبی شکم را ایزوله تقویت می‌کند.",
    tips: "لگن افت نکند؛ شانه دقیقاً بالای آرنج باشد.",
  },
  {
    name: "پل باسن",
    videoKey: "پل باسن",
    muscle: "پا و باسن", category: "legs", equipment: "bodyweight", difficulty: "beginner",
    description: "خوابیده با زانوهای خم، باسن را تا خط بدن بالا ببرید، یک لحظه انقباض نگه دارید و پایین بیایید.",
    tips: "فشار از پاشنه؛ در بالای حرکت باسن کامل منقبض شود.",
  },
  {
    name: "کوهنوردی",
    videoKey: "کوهنوردی",
    muscle: "شکم", category: "core", equipment: "bodyweight", difficulty: "intermediate",
    description: "در حالت شنا، زانوها را به نوبت سریع به سمت سینه بکشید. ترکیبی از قدرت مرکزی و هوازی.",
    tips: "باسن بالا نرود؛ سرعت را با حفظ فرم تنظیم کنید.",
  },
  {
    name: "روسیان توئیست",
    videoKey: "روسیان توئیست",
    muscle: "شکم", category: "core", equipment: "bodyweight", difficulty: "intermediate",
    description: "نشسته با کمی خم شدن به عقب، تنه را با دست‌های جمع‌شده به چپ و راست بچرخانید. عضلات مورب شکم را هدف می‌گیرد.",
    tips: "چرخش از تنه باشد نه دست‌ها؛ کمر گرد نشود.",
  },
];

// ─────────────────────────────────────────────────────────────────────────

// v115 — درخواست مالک: «اگه حرکاتی که اضافه می‌کنی قبلاً در دیتابیسم هست،
// نیازی به اضافه کردنش نیست». تطبیق با dedupeKey به‌تنهایی کافی نیست چون
// مثلاً «نشر جانب دمبل» و «نشر از جانب» کلید یکسانی ندارند ولی یک حرکت‌اند.
// این نگاشت، معادل‌های «از قبل موجود» را برای هر حرکت seed فهرست می‌کند؛
// اگر هرکدام در DB باشد → حرکت seed کاملاً skip می‌شود (صفر تکراری جدید).
const EQUIVALENT_EXISTING: Record<string, string[]> = {
  "فلای دمبل خوابیده": ["فلای سینه با دمبل", "فلای دمبل"],
  "شنا سوئدی": ["شنا", "شنا سوئدی"],
  "نشر جانب دمبل": ["نشر از جانب", "نشر جانب"],
  "نشر از جلو دمبل": ["نشر از جلو", "نشر جلو"],
  "نشر خم دمبل": ["فلای خماری", "نشر خم", "نشر خم دمبل سرشانه", "نشر خم دمبل"],
  "شراگ دمبل": ["شراگ"],
  "جلو بازو چکشی دمبل": ["جلو بازو چکشی", "جلو بازو دمبل چکشی"],
  "جلو بازو تمرکزی دمبل": ["جلو بازو تمرکزی", "جلو بازو متمرکز دمبل"],
  "پشت بازو دمبل تک‌دست بالای سر": ["پشت بازو بالای سر", "پشت بازو دمبل بالای سر"],
  "پشت بازو دیپس روی نیمکت": ["پشت بازو دیپس نیمکت", "دیپس نیمکت"],
  "زیربغل دمبل تک‌خم": ["زیربغل دمبل تک‌خم تک‌دست", "زیربغل دمبل تک‌دست"],
  "روئینگ هالتر خم": ["زیربغل هالتر خم ۴۵ درجه", "زیربغل قایقی هالتر", "روئینگ هالتر خم"],
  "روئینگ سیم‌کش نشسته": ["زیربغل قایقی نشسته", "روئینگ نشسته دستگاه", "زیربغل ماشین قایقی"],
  "ددلیفت هالتر": ["ددلیفت کلاسیک", "ددلیفت"],
  "ددلیفت رومانیایی هالتر": ["ددلیفت رومانیایی"],
  "جلو پا دستگاه": ["جلوی پا دستگاه", "جلو ران ماشین"],
  "پشت پا خوابیده دستگاه": ["پشت پا دستگاه", "پشت پا خوابیده", "پشت ران ماشین خوابیده"],
  "لانژ دمبل راه‌رویی": ["لانژ", "لانگز پیاده‌روی با دمبل", "لانژ دمبل"],
  "اسکوات بلغاری دمبل": ["اسکوات بلغاری"],
  "پشت بازو هالتر خوابیده": ["پشت بازو درازخواب"],
};

function embedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

async function main() {
  const mapPath = path.join(process.cwd(), "scripts", "exercise-video-fixes.json");
  if (!existsSync(mapPath)) {
    console.error("MAP_NOT_FOUND — scripts/exercise-video-fixes.json نیست");
    process.exit(1);
  }
  const videoMap = JSON.parse(readFileSync(mapPath, "utf8")) as Record<
    string,
    { videoId: string; title: string; channel: string }
  >;
  const VALID_ID = /^[\w-]{11}$/;

  const existing = await db.exerciseLibrary.findMany({
    select: { id: true, name: true, youtubeUrl: true },
  });
  const byDedupe = new Map<string, { id: string; name: string; youtubeUrl: string }>();
  for (const ex of existing) {
    // اولین رکوردِ هم‌کلید مرجع است (تکراری‌های تاریخی نادیده)
    const key = dedupeKey(ex.name);
    if (!byDedupe.has(key)) byDedupe.set(key, ex);
  }

  let added = 0, skipped = 0, videoFilled = 0, noVideo = 0;
  const addedNames: string[] = [];

  for (const ex of FAMOUS_EXERCISES) {
    const video = videoMap[ex.videoKey];
    const videoId = video?.videoId ?? "";
    if (!videoId || !VALID_ID.test(videoId)) {
      noVideo++;
      console.warn(`⚠ بدون ویدیوی صحت‌سنجی‌شده برای «${ex.name}» (videoKey: ${ex.videoKey}) — رد شد`);
      continue;
    }
    const key = dedupeKey(ex.name);
    const hit = byDedupe.get(key);
    // v115 — معادل‌های «از قبل موجود» (مثل «نشر جانب دمبل» == «نشر از جانب»)
    // هم skip می‌شوند تا هیچ حرکت تکراریِ نزدیک به بانک اضافه نشود
    const equivalents = EQUIVALENT_EXISTING[ex.name] || [];
    const hasEquivalent = equivalents.some((eq) => byDedupe.has(dedupeKey(eq)));
    if (hit || hasEquivalent) {
      if (hit && !hit.youtubeUrl) {
        // حرکت هست ولی ویدیو ندارد → فقط یوتیوب خالی پر می‌شود
        if (APPLY) {
          await db.exerciseLibrary.update({
            where: { id: hit.id },
            data: { youtubeUrl: embedUrl(videoId) },
          });
        }
        videoFilled++;
        console.log(`🎬 ویدیوی خالی «${hit.name}» پر شد (${videoId})`);
      } else {
        skipped++;
        if (hasEquivalent && !hit) {
          const eqHit = equivalents.map((eq) => byDedupe.get(dedupeKey(eq))?.name).find(Boolean);
          console.log(`↷ «${ex.name}» معادلِ موجود دارد («${eqHit}») — اضافه نشد`);
        }
      }
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
          youtubeUrl: embedUrl(videoId),
          videoUrl: "",
          videoSizeBytes: 0,
          videoPosterUrl: "",
          youtubeEnabled: true,
        },
      });
    }
    added++;
    addedNames.push(ex.name);
  }

  console.log("─────────────────────────────");
  console.log(`📊 گزارش seed حرکات معروف (APPLY=${APPLY}):`);
  console.log(`   • جدید اضافه شد: ${added}`);
  console.log(`   • از قبل موجود (skip): ${skipped}`);
  console.log(`   • ویدیوی خالی پر شد: ${videoFilled}`);
  console.log(`   • بدون ویدیوی معتبر (رد): ${noVideo}`);
  if (addedNames.length) console.log(`   • فهرست جدیدها: ${addedNames.join(" | ")}`);
  await db.$disconnect();
  if (!APPLY) console.log("ℹ DRY-RUN — برای اعمال واقعی --apply بزنید.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
