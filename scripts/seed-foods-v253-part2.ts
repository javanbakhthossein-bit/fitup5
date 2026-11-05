// v253-part2 — Phase 1: آش/سوپ/خورش/پلو/کباب/نان/میوه/صبحانه/سالاد/بین‌المللی (NEW) · Phase 2: calibrate existing · Phase 3: units enrichment
import { db } from "../src/lib/db";

type U = [string, number];
type Row = [string, string, number, number, number, number, string, number, boolean, U[], string?];

const USDA = "USDA FoodData Central";
const FA = "منابع تغذیه‌ای استاندارد";
const IR = "محاسبه ایرانی";
const K = "برچسب محصول کاله";

// ---- unit presets (گرم:1 auto-prepended) ----
const BOWL300: U[] = [["کاسه", 300]];
const BOWL250: U[] = [["کاسه", 250]];
const PIALA: U[] = [["پیاله", 250]];
const PRESS: U[] = [["پرس", 300], ["کفگیر", 150]];
const KHORSH: U[] = [["کاسه", 250]];
const SALAD = (g: number): U[] => [["کاسه", g]];
const BRSH = (g: number): U[] => [["برش", g]];
const NUM = (g: number): U[] => [["عدد", g]];
const FRUIT_100: U[] = [["مشت", 80]];
const FRUIT_NUM = (g: number): U[] => [["عدد", g], ["مشت", 80]];

// [name, category, kcal, P, C, F, servingSize, servingGrams, vegan, units, source?]
const rows: Row[] = [
  // ================= آش و سوپ (lunch) =================
  ["آش رشته", "lunch", 280, 9, 38, 10, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش رشته خانه‌ای کم‌چرب", "lunch", 210, 8, 32, 6, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش کشک", "lunch", 310, 10, 30, 16, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش دوغ‌آزار", "lunch", 230, 8, 28, 8, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش انار", "lunch", 240, 7, 34, 8, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش جو", "lunch", 220, 8, 32, 6, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش ماست", "lunch", 250, 9, 26, 12, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش آلبالو", "lunch", 240, 7, 33, 8, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["آش‌پلا", "lunch", 260, 10, 34, 9, "۱ کاسه (۳۰۰ گرم)", 300, false, BOWL300, IR],
  ["سوپ جو", "lunch", 180, 6, 24, 6, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, false, BOWL250, IR],
  ["سوپ مرغ", "lunch", 130, 12, 10, 4, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, false, BOWL250, IR],
  ["سوپ قارچ خامه‌ای", "lunch", 190, 5, 16, 12, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, false, BOWL250, IR],
  ["سوپ ذرت خامه‌ای", "lunch", 170, 5, 22, 7, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, false, BOWL250, FA],
  ["سوپ گوجه", "lunch", 140, 4, 20, 5, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, true, BOWL250, FA],
  ["سوپ مرغ نودل", "lunch", 190, 10, 20, 6, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, false, BOWL250, FA],
  ["سوپ کرم اسفناج", "lunch", 170, 5, 14, 10, "۱ کاسه (۲۵۰ میلی‌لیتر)", 250, true, BOWL250, FA],
  ["حلیم", "lunch", 350, 15, 45, 11, "۱ پیاله (۲۵۰ گرم)", 250, false, PIALA, IR],
  ["حلیم گوشت", "lunch", 380, 22, 40, 14, "۱ پیاله (۲۵۰ گرم)", 250, false, PIALA, IR],
  // ================= خورش‌ها (per ۱ کاسه ۲۵۰ گرم) =================
  ["قرمه‌سبزی", "lunch", 350, 18, 20, 20, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["قرمه‌سبزی کم‌چرب", "lunch", 250, 18, 18, 12, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["قیمه", "lunch", 300, 15, 22, 15, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["قیمه سیب‌زمینی", "lunch", 310, 14, 26, 16, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["قیمه بادمجان", "lunch", 280, 13, 20, 15, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["فسنجان", "lunch", 420, 14, 18, 32, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["قرمه‌سبزی با سویا", "lunch", 280, 19, 21, 13, "۱ کاسه (۲۵۰ گرم)", 250, true, KHORSH, IR],
  ["قیمه سویا", "lunch", 230, 16, 22, 8, "۱ کاسه (۲۵۰ گرم)", 250, true, KHORSH, IR],
  ["خورش قارچ و مرغ", "lunch", 250, 18, 14, 12, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورش کرفس", "lunch", 240, 12, 14, 15, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورش کرفس کم‌چرب", "lunch", 180, 13, 12, 8, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورش بادمجان", "lunch", 260, 10, 18, 16, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورش لوبیا سبز", "lunch", 230, 11, 18, 12, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورش هویج و لوبیا", "lunch", 250, 11, 22, 12, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورشت آلو", "lunch", 280, 12, 22, 15, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورشت به", "lunch", 270, 10, 22, 15, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["خورشت بامیه", "lunch", 220, 10, 14, 13, "۱ کاسه (۲۵۰ گرم)", 250, false, KHORSH, IR],
  ["کوفته تبریزی", "lunch", 330, 14, 28, 16, "۱ عدد (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["کوفته برنجی", "lunch", 300, 13, 30, 13, "۱ عدد (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["کوفته لپه", "lunch", 280, 12, 28, 12, "۱ عدد (۱۵۰ گرم)", 150, false, NUM(150), IR],
  // ================= پلوها (per ۱ پرس ۳۰۰ گرم) =================
  ["زرشک‌پلو با مرغ", "lunch", 550, 28, 75, 12, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["زرشک‌پلو با گوشت", "lunch", 570, 26, 74, 16, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["ته‌چین مرغ", "lunch", 450, 24, 48, 17, "۱ برش (۲۵۰ گرم)", 250, false, BRSH(250), IR],
  ["باقالی‌پلو با گوشت", "lunch", 560, 25, 72, 16, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["باقالی‌پلو با مرغ", "lunch", 530, 26, 72, 13, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["عدس‌پلو با کشمش", "lunch", 480, 14, 85, 8, "۱ پرس (۳۰۰ گرم)", 300, true, PRESS, IR],
  ["لوبیاپلو با قیمه", "lunch", 540, 20, 78, 14, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["سبزی‌پلو با ماهی", "lunch", 530, 28, 68, 14, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["سبزی‌پلو با گوشت", "lunch", 540, 25, 70, 16, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["کلم‌پلو", "lunch", 500, 18, 72, 12, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["استامبولی‌پلو", "lunch", 520, 20, 78, 10, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["سیب‌زمینی‌پلو", "lunch", 500, 15, 80, 12, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["آلبالوپلو با مرغ", "lunch", 540, 26, 76, 12, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, IR],
  ["چلو کباب", "lunch", 600, 30, 80, 15, "۱ پرس (۴۰۰ گرم)", 400, false, [["پرس", 400], ["سیخ", 150]], IR],
  ["ته‌دیگ برنجی", "lunch", 180, 3, 32, 4, "۱ برش (۷۰ گرم)", 70, false, BRSH(70), IR],
  ["ته‌دیگ نانی", "lunch", 200, 4, 36, 5, "۱ برش (۷۰ گرم)", 70, false, BRSH(70), IR],
  ["برنج سفید پخته", "lunch", 130, 2.7, 28, 0.3, "۱۰۰ گرم", 100, false, [["قاشق غذاخوری", 20], ["کاسه", 150]], USDA],
  ["برنج قهوه‌ای پخته", "lunch", 123, 2.7, 26, 1, "۱۰۰ گرم", 100, false, [["قاشق غذاخوری", 20], ["کاسه", 150]], USDA],
  // ================= کباب‌ها (per سیخ) =================
  ["کباب کوبیده", "lunch", 320, 22, 6, 23, "۱ سیخ (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["کباب برگ", "lunch", 300, 26, 1, 20, "۱ سیخ (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["کباب بختیاری", "lunch", 310, 24, 4, 22, "۱ سیخ (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["جوجه کباب بی‌استخوان", "lunch", 250, 35, 2, 10, "۱ سیخ (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["جوجه کباب با استخوان", "lunch", 240, 32, 2, 10, "۱ سیخ (۱۸۰ گرم)", 180, false, NUM(180), IR],
  ["شیشلیک", "lunch", 350, 26, 3, 25, "۱ سیخ (۲۰۰ گرم)", 200, false, NUM(200), IR],
  ["کباب شاندیز", "lunch", 400, 28, 4, 30, "۱ سیخ (۲۰۰ گرم)", 200, false, NUM(200), IR],
  ["کباب ترش", "lunch", 280, 24, 8, 16, "۱ سیخ (۱۵۰ گرم)", 150, false, NUM(150), IR],
  ["چنجه", "lunch", 330, 25, 2, 24, "۱ سیخ (۱۵۰ گرم)", 150, false, NUM(150), IR],
  // ================= نان‌های ایرانی (breakfast) =================
  ["نان بربری", "breakfast", 270, 8, 55, 1, "۱۰۰ گرم", 100, false, BRSH(100), USDA],
  ["نان سنگک", "breakfast", 280, 9, 56, 1.5, "۱۰۰ گرم", 100, false, BRSH(100), USDA],
  ["نان تافتون", "breakfast", 275, 8, 57, 1, "۱۰۰ گرم", 100, false, BRSH(100), USDA],
  ["نان لواش", "breakfast", 110, 3, 23, 0.5, "۱ نان (۴۰ گرم)", 40, false, NUM(40), USDA],
  ["نان باگت", "breakfast", 275, 9, 55, 1.5, "۱۰۰ گرم", 100, false, BRSH(50), USDA],
  ["نان خمیر ترش ساندویچی", "breakfast", 200, 7, 40, 1.5, "۱ نان (۸۰ گرم)", 80, false, NUM(80), FA],
  ["نان جو", "breakfast", 248, 9, 48, 1.5, "۱۰۰ گرم", 100, false, BRSH(100), USDA],
  ["نان شیرمال", "breakfast", 200, 5, 32, 5, "۱ نان (۶۰ گرم)", 60, false, NUM(60), FA],
  ["نان تست سفید", "breakfast", 285, 9, 55, 2.5, "۱ برش (۲۵ گرم)", 25, false, BRSH(25), FA],
  ["نان تست سبوس‌دار", "breakfast", 250, 10, 46, 3, "۱ برش (۲۵ گرم)", 25, false, BRSH(25), FA],
  ["نان همبرگر", "breakfast", 170, 5, 32, 2.5, "۱ عدد (۶۰ گرم)", 60, false, NUM(60), FA],
  // ================= میوه‌ها (snack) =================
  ["سیب", "snack", 78, 0.4, 21, 0.3, "۱ عدد متوسط (۱۵۰ گرم)", 150, false, FRUIT_NUM(150), USDA],
  ["پرتقال", "snack", 62, 1.2, 15, 0.2, "۱ عدد متوسط (۱۳۰ گرم)", 130, false, FRUIT_NUM(130), USDA],
  ["نارنگی", "snack", 47, 0.8, 12, 0.1, "۱ عدد (۱۱۰ گرم)", 110, false, FRUIT_NUM(110), USDA],
  ["کیوی", "snack", 42, 0.8, 10, 0.4, "۱ عدد (۷۵ گرم)", 75, false, FRUIT_NUM(75), USDA],
  ["موز", "snack", 105, 1.3, 27, 0.4, "۱ عدد متوسط (۱۲۰ گرم)", 120, false, NUM(120), USDA],
  ["انگور", "snack", 69, 0.7, 18, 0.2, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["هندوانه", "snack", 30, 0.6, 8, 0.2, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["طالبی", "snack", 34, 0.8, 8, 0.2, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["خربزه", "snack", 34, 0.8, 8, 0.2, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["انار", "snack", 83, 1.7, 19, 1.2, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["انجیر تازه", "snack", 74, 0.8, 19, 0.3, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["انجیر خشک", "snack", 249, 3.3, 63, 1, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["خرمای مضافتی", "snack", 66, 0.2, 18, 0.1, "۱ عدد (۲۵ گرم)", 25, true, NUM(25), USDA],
  ["توت‌فرنگی", "snack", 32, 0.7, 8, 0.3, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["آلبالو", "snack", 50, 0.8, 12, 0.3, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["گیلاس", "snack", 63, 1.1, 16, 0.2, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["لیمو شیرین", "snack", 43, 0.8, 11, 0.1, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["گریپ‌فروت", "snack", 42, 0.8, 11, 0.1, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["انبه", "snack", 60, 0.8, 15, 0.4, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["آناناس", "snack", 50, 0.5, 13, 0.1, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["هلو", "snack", 39, 0.9, 10, 0.3, "۱ عدد (۱۱۰ گرم)", 110, false, FRUIT_NUM(110), USDA],
  ["زردآلو", "snack", 48, 1.4, 11, 0.4, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["شلیل", "snack", 56, 1.1, 13, 0.3, "۱ عدد (۱۱۰ گرم)", 110, false, NUM(110), USDA],
  ["خرمالو", "snack", 70, 0.6, 18, 0.2, "۱ عدد (۱۴۰ گرم)", 140, false, NUM(140), USDA],
  ["گوجه‌سبز", "snack", 38, 1, 9, 0.2, "۱۰۰ گرم", 100, true, FRUIT_100, FA],
  ["توت سفید", "snack", 43, 1.4, 9, 0.3, "۱۰۰ گرم", 100, true, FRUIT_100, USDA],
  ["کشمش پلویی", "snack", 299, 3, 79, 0.5, "۱۰۰ گرم", 100, true, [["مشت", 30], ["قاشق غذاخوری", 20]], USDA],
  // ================= صبحانه رایج (breakfast) =================
  ["نیمرو با روغن", "breakfast", 300, 15, 2, 26, "۲ عدد تخم‌مرغ + روغن", 130, false, NUM(65), IR],
  ["املت گوجه با روغن کم", "breakfast", 240, 15, 5, 18, "۲ عدد تخم‌مرغ + گوجه", 180, false, NUM(90), IR],
  ["پنیر و گردو و سبزی", "breakfast", 320, 14, 8, 26, "۱ بشقاب متوسط", 130, false, [["بشقاب", 130]], IR],
  ["عسل", "breakfast", 64, 0.1, 17, 0, "۱ قاشق غذاخوری (۲۱ گرم)", 21, true, [["قاشق غذاخوری", 21], ["قاشق مرباخوری", 7]], USDA],
  ["کره", "breakfast", 88, 0.1, 0, 10, "۱ قاشق مرباخوری (۱۲ گرم)", 12, false, [["قاشق مرباخوری", 12]], K],
  ["مربا توت‌فرنگی", "breakfast", 55, 0, 14, 0, "۱ قاشق غذاخوری (۲۰ گرم)", 20, true, [["قاشق غذاخوری", 20]], FA],
  ["خامه و عسل", "breakfast", 260, 2, 18, 20, "۱ بشقاب کوچک", 80, false, [["بشقاب", 80]], FA],
  ["عدسی صبحانه", "breakfast", 230, 14, 35, 3, "۱ کاسه (۲۵۰ گرم)", 250, true, BOWL250, IR],
  ["خاگینه", "breakfast", 250, 12, 8, 19, "۱ بشقاب (۱۰۰ گرم)", 100, false, [["بشقاب", 100]], IR],
  ["کره بادام‌زمینی", "breakfast", 95, 4, 3, 8, "۱ قاشق غذاخوری (۱۶ گرم)", 16, false, [["قاشق غذاخوری", 16]], USDA],
  // ================= سالاد و سبزیجات (snack) =================
  ["سالاد فصل", "snack", 50, 2, 8, 0.5, "۱ کاسه بدون سس (۱۵۰ گرم)", 150, true, SALAD(150), IR],
  ["سالاد شیرازی", "snack", 60, 2, 9, 1, "۱ کاسه (۱۵۰ گرم)", 150, true, SALAD(150), IR],
  ["سالاد سزار", "snack", 260, 8, 10, 21, "۱ کاسه (۱۵۰ گرم)", 150, false, SALAD(150), FA],
  ["سالاد الویه", "snack", 310, 6, 18, 24, "۱ کاسه (۱۵۰ گرم)", 150, false, SALAD(150), FA],
  ["سالاد کاهو", "snack", 35, 1.5, 6, 0.3, "۱ کاسه (۱۰۰ گرم)", 100, true, SALAD(100), USDA],
  ["سالاد کلم", "snack", 120, 2, 12, 7, "۱ کاسه (۱۵۰ گرم)", 150, false, SALAD(150), FA],
  ["سبزی خوردن", "snack", 45, 3, 7, 0.5, "۱ بشقاب (۸۰ گرم)", 80, true, [["بشقاب", 80]], USDA],
  ["سالاد ماکارونی", "snack", 420, 10, 45, 22, "۱ کاسه (۲۰۰ گرم)", 200, false, SALAD(200), FA],
  ["ترشی مخلوط", "snack", 15, 0.5, 3, 0.1, "۱ قاشق غذاخوری (۲۰ گرم)", 20, true, [["قاشق غذاخوری", 20]], FA],
  ["ترشی لیته", "snack", 20, 0.5, 3, 0.5, "۱ قاشق غذاخوری (۲۰ گرم)", 20, true, [["قاشق غذاخوری", 20]], FA],
  ["زیتون پرورده", "snack", 75, 0.5, 2, 7, "۱ قاشق (۳۰ گرم)", 30, false, [["قاشق غذاخوری", 30]], IR],
  ["ماست‌وخیار", "snack", 160, 8, 12, 8, "۱ کاسه (۲۵۰ گرم)", 250, false, BOWL250, IR],
  ["سس مایونز", "snack", 100, 0, 0.5, 11, "۱ قاشق غذاخوری (۱۵ گرم)", 15, false, [["قاشق غذاخوری", 15]], FA],
  ["سس گوجه", "snack", 15, 0.5, 3, 0.1, "۱ قاشق غذاخوری (۱۵ گرم)", 15, true, [["قاشق غذاخوری", 15]], FA],
  ["خردل", "snack", 10, 0.5, 1, 0.5, "۱ قاشق غذاخوری (۱۵ گرم)", 15, true, [["قاشق غذاخوری", 15]], FA],
  // ================= غذاهای بین‌المللی (lunch) =================
  ["ماکارونی با سس گوشت", "lunch", 480, 18, 65, 15, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, FA],
  ["لازانیا", "lunch", 430, 22, 40, 20, "۱ برش (۲۵۰ گرم)", 250, false, BRSH(250), FA],
  ["پاستا آلفردو", "lunch", 560, 18, 58, 28, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, FA],
  ["اسپاگتی بولونز", "lunch", 470, 20, 60, 14, "۱ پرس (۳۰۰ گرم)", 300, false, PRESS, FA],
  ["پیتزا پپرونی", "lunch", 300, 13, 30, 14, "۱ برش (۱۰۰ گرم)", 100, false, BRSH(100), FA],
  ["پیتزا مخلوط", "lunch", 290, 12, 30, 13, "۱ برش (۱۰۰ گرم)", 100, false, BRSH(100), FA],
  ["پیتزا مارگاریتا", "lunch", 270, 11, 32, 10, "۱ برش (۱۰۰ گرم)", 100, false, BRSH(100), FA],
  ["همبرگر ذغالی", "lunch", 520, 28, 35, 28, "۱ عدد (۲۰۰ گرم)", 200, false, NUM(200), FA],
  ["ساندویچ فلافل", "lunch", 380, 12, 50, 14, "۱ عدد (۲۲۰ گرم)", 220, false, NUM(220), FA],
  ["ساندویچ کوکوسبزی", "lunch", 350, 9, 48, 14, "۱ عدد (۲۰۰ گرم)", 200, true, NUM(200), FA],
  ["ساندویچ مرغ گریل", "lunch", 350, 25, 40, 8, "۱ عدد (۲۰۰ گرم)", 200, false, NUM(200), FA],
  ["ساندویچ تخم‌مرغ", "lunch", 300, 14, 32, 12, "۱ عدد (۱۸۰ گرم)", 180, false, NUM(180), FA],
  ["ساندویچ پنیر و کاهو", "lunch", 280, 11, 34, 10, "۱ عدد (۱۸۰ گرم)", 180, false, NUM(180), FA],
  ["ساندویچ سوسیس", "lunch", 420, 14, 36, 24, "۱ عدد (۲۰۰ گرم)", 200, false, NUM(200), FA],
  ["ساندویچ ژامبون مرغ", "lunch", 320, 18, 36, 10, "۱ عدد (۲۰۰ گرم)", 200, false, NUM(200), FA],
  ["شاورما مرغ", "lunch", 420, 25, 42, 16, "۱ ساندویچ (۲۵۰ گرم)", 250, false, NUM(250), FA],
  ["برگر مخصوص", "lunch", 560, 27, 40, 30, "۱ عدد (۲۳۰ گرم)", 230, false, NUM(230), FA],
  ["هات‌داگ", "lunch", 420, 15, 38, 22, "۱ عدد (۱۸۰ گرم)", 180, false, NUM(180), FA],
  ["ناگت مرغ", "lunch", 280, 15, 18, 16, "۶ عدد (۱۰۰ گرم)", 100, false, [["مشت", 80]], FA],
  ["فیله مرغ سوخاری", "lunch", 350, 25, 25, 16, "۳ تکه (۱۵۰ گرم)", 150, false, [["تکه", 50]], FA],
  ["سیب‌زمینی سرخ‌کرده", "lunch", 310, 3.4, 41, 15, "۱۰ عدد (۱۰۰ گرم)", 100, false, [["مشت", 80]], USDA],
  ["سیب‌زمینی آب‌پز", "lunch", 87, 2, 20, 0.1, "۱۰۰ گرم", 100, false, [["مشت", 80]], USDA],
  ["سالاد اولویه ایرانی", "lunch", 350, 8, 15, 30, "۱ کاسه (۱۵۰ گرم)", 150, false, SALAD(150), FA],
];

function food([name, category, kcal, p, c, f, serving, sg, vegan, units, source]: Row) {
  return {
    name,
    category,
    calories: Math.round(kcal),
    protein: p,
    carbs: c,
    fat: f,
    servingSize: serving,
    isVegan: vegan,
    units: JSON.stringify([{ label: "گرم", grams: 1 }, ...units.map(([label, grams]) => ({ label, grams }))]),
    servingGrams: sg,
    source: source ?? FA,
  };
}

// ================= PHASE 2 — calibrate existing top items =================
type Calib = { kcal: number; p: number; c: number; f: number; serving: string; sg: number; units: U[]; source: string };
const calib: Record<string, Calib> = {
  "شیر پرچرب": { kcal: 155, p: 8, c: 12, f: 8.5, serving: "۱ لیوان ۲۴۰ میلی‌لیتر", sg: 240, units: [["لیوان", 240]], source: K },
  "ماست پرچرب": { kcal: 145, p: 8, c: 8, f: 8, serving: "۱ لیوان ۲۴۰ گرم", sg: 240, units: [["لیوان", 240]], source: K },
  "تخم مرغ آب‌پز": { kcal: 78, p: 6.3, c: 0.6, f: 5.3, serving: "۱ عدد ۵۰ گرم", sg: 50, units: [["عدد", 50]], source: USDA },
  "پنیر سفید ایرانی": { kcal: 75, p: 5, c: 0.5, f: 6, serving: "۱ قاچ ۳۰ گرم", sg: 30, units: [["قاچ", 30]], source: K },
  "برنج سفید پخته": { kcal: 130, p: 2.7, c: 28, f: 0.3, serving: "۱۰۰ گرم", sg: 100, units: [["قاشق غذاخوری", 20], ["کاسه", 150]], source: USDA },
  "مرغ گریل": { kcal: 165, p: 31, c: 0, f: 3.6, serving: "۱۰۰ گرم", sg: 100, units: [["کف دست", 100]], source: USDA },
  "گردو مغز": { kcal: 654, p: 15.2, c: 13.7, f: 65.2, serving: "۱۰۰ گرم", sg: 100, units: [["مغز", 5], ["مشت", 30]], source: USDA },
  "بادام خام": { kcal: 579, p: 21.2, c: 21.6, f: 49.9, serving: "۱۰۰ گرم", sg: 100, units: [["مغز", 1.2], ["مشت", 30]], source: USDA },
  "پسته خام": { kcal: 560, p: 20.2, c: 27.2, f: 45.3, serving: "۱۰۰ گرم مغز", sg: 100, units: [["مشت", 30]], source: USDA },
  "سیب": { kcal: 78, p: 0.4, c: 21, f: 0.3, serving: "۱ عدد متوسط (۱۵۰ گرم)", sg: 150, units: [["عدد", 150], ["مشت", 80]], source: USDA },
  "موز": { kcal: 105, p: 1.3, c: 27, f: 0.4, serving: "۱ عدد متوسط (۱۲۰ گرم)", sg: 120, units: [["عدد", 120]], source: USDA },
  "خرما": { kcal: 66, p: 0.2, c: 18, f: 0, serving: "۱ عدد ۲۵ گرم", sg: 25, units: [["عدد", 25]], source: USDA },
  "عسل": { kcal: 64, p: 0.1, c: 17, f: 0, serving: "۱ قاشق غذاخوری (۲۱ گرم)", sg: 21, units: [["قاشق غذاخوری", 21], ["قاشق مرباخوری", 7]], source: USDA },
  "نخود پخته": { kcal: 164, p: 8.9, c: 27.4, f: 2.6, serving: "۱۰۰ گرم", sg: 100, units: [["قاشق غذاخوری", 20], ["کاسه", 150]], source: USDA },
  "عدس پخته": { kcal: 116, p: 9, c: 20, f: 0.4, serving: "۱۰۰ گرم", sg: 100, units: [["قاشق غذاخوری", 20], ["کاسه", 150]], source: USDA },
  "لوبیا چیتی پخته": { kcal: 127, p: 8.7, c: 22.8, f: 0.5, serving: "۱۰۰ گرم", sg: 100, units: [["قاشق غذاخوری", 20], ["کاسه", 150]], source: USDA },
  "سیب‌زمینی سرخ‌کرده": { kcal: 310, p: 3.4, c: 41, f: 15, serving: "۱۰ عدد (۱۰۰ گرم)", sg: 100, units: [["مشت", 80]], source: USDA },
  "ماکارونی پخته": { kcal: 158, p: 5.8, c: 31, f: 0.9, serving: "۱۰۰ گرم", sg: 100, units: [["قاشق غذاخوری", 20], ["کاسه", 150]], source: USDA },
  "نان سنگک": { kcal: 280, p: 9, c: 56, f: 1.5, serving: "۱۰۰ گرم", sg: 100, units: [["برش", 100]], source: USDA },
  "نان بربری": { kcal: 270, p: 8, c: 55, f: 1, serving: "۱۰۰ گرم", sg: 100, units: [["برش", 100]], source: USDA },
  "تخم‌مرغ نیمرو": { kcal: 125, p: 6.5, c: 0.6, f: 10, serving: "۱ عدد با نصف قاشق روغن", sg: 60, units: [["عدد", 60]], source: FA },
  "کره": { kcal: 88, p: 0.1, c: 0, f: 10, serving: "۱ قاشق مرباخوری (۱۲ گرم)", sg: 12, units: [["قاشق مرباخوری", 12]], source: K },
  "روغن زیتون": { kcal: 119, p: 0, c: 0, f: 13.5, serving: "۱ قاشق غذاخوری (۱۴ گرم)", sg: 14, units: [["قاشق غذاخوری", 14]], source: USDA },
  "شکر": { kcal: 46, p: 0, c: 12, f: 0, serving: "۱ قاشق مرباخوری (۱۲ گرم)", sg: 12, units: [["قاشق مرباخوری", 12], ["حبه", 4]], source: USDA },
  "نمک": { kcal: 0, p: 0, c: 0, f: 0, serving: "۱ قاشق مرباخوری (۶ گرم)", sg: 6, units: [["قاشق مرباخوری", 6]], source: FA },
};

// ================= PHASE 3 — units enrichment for legacy rows =================
const KW = [
  "شیر", "ماست", "پنیر", "برنج", "مرغ", "تخم مرغ", "تخم‌مرغ", "نان", "ماکارونی", "عدس", "نخود", "لوبیا",
  "سیب", "سیب‌زمینی", "موز", "پرتقال", "هندوانه", "انگور", "خرما", "گردو", "بادام", "بادام زمینی", "پسته", "فندق",
  "کشمش", "عسل", "شکر", "روغن", "کره", "خامه", "دوغ", "چای", "قهوه", "نوشابه", "آبمیوه", "ماءالشعیر",
  "توت", "گیلاس", "آلبالو", "انار", "طالبی", "خربزه", "کیوی", "گریپ‌فروت", "نارنگی", "انبه", "آناناس",
  "هلو", "زردآلو", "هویج", "خیار", "گوجه", "خورش", "سوپ", "سالاد", "پیتزا", "لازانیا", "ساندویچ", "برگر", "شاورما",
  "آش", "حلیم", "پلو", "کباب", "کاهو", "سبزی",
];
function unitsFor(name: string): U[] | null {
  const has = (s: string) => name.includes(s);
  if (has("نان")) return [["برش", 50]];
  if (has("تخم مرغ") || has("تخم‌مرغ")) return [["عدد", 55]];
  if (has("سیب‌زمینی")) return [["مشت", 80]];
  if (has("بادام زمینی") || has("بادام‌زمینی")) return [["مشت", 30], ["قاشق غذاخوری", 16]];
  if (has("گردو") || has("بادام") || has("پسته") || has("فندق") || has("کشمش") || has("آجیل")) return [["مشت", 30]];
  if (has("برنج") || has("ماکارونی") || has("پاستا") || has("اسپاگتی") || has("عدس") || has("نخود") || has("لوبیا"))
    return [["قاشق غذاخوری", 20], ["کاسه", 150]];
  if (has("شیرازی")) return [["کاسه", 150]];
  if (has("شیر") || has("ماست") || has("دوغ")) return [["لیوان", 240]];
  if (has("پنیر")) return [["قاچ", 30]];
  if (has("خامه")) return [["قاشق غذاخوری", 15]];
  if (has("کره")) return [["قاشق مرباخوری", 12]];
  if (has("عسل") || has("مربا")) return [["قاشق غذاخوری", 21]];
  if (has("روغن")) return [["قاشق غذاخوری", 14]];
  if (has("شکر")) return [["قاشق مرباخوری", 12], ["حبه", 4]];
  if (has("چای")) return [["استکان", 100]];
  if (has("قهوه")) return [["فنجان", 150]];
  if (has("پیتزا") || has("لازانیا")) return [["برش", 100]];
  if (has("ساندویچ") || has("برگر") || has("همبرگر") || has("شاورما")) return [["عدد", 200]];
  if (has("سالاد")) return [["کاسه", 150]];
  if (has("خورش") || has("سوپ") || has("آش") || has("حلیم")) return [["کاسه", 250]];
  if (has("پلو")) return [["پرس", 300]];
  if (has("کباب")) return [["سیخ", 150]];
  if (has("مرغ")) return [["کف دست", 100]];
  if (has("سیب") || has("موز") || has("پرتقال") || has("نارنگی") || has("انبه")) return [["عدد", 150], ["مشت", 80]];
  if (["هندوانه", "انگور", "خرما", "توت", "گیلاس", "آلبالو", "انار", "طالبی", "خربزه", "کیوی", "آناناس", "هلو", "زردآلو", "هویج", "خیار", "گوجه", "کاهو", "سبزی", "گریپ‌فروت"].some(has))
    return [["مشت", 80]];
  return null;
}
const DIG: Record<string, string> = { "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
const toEn = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => DIG[d]);
function gramsFromServing(s: string): number | null {
  const t = toEn(s);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:گرم|میلی.?لیتر)/);
  if (m) return parseFloat(m[1]);
  if (/(لیوان|استکان)/.test(t)) return 240;
  return null;
}
const U = (extra: U[]) => JSON.stringify([{ label: "گرم", grams: 1 }, ...extra.map(([label, grams]) => ({ label, grams }))]);

async function main() {
  // ---- Phase 1: add new (dedupe by exact name) ----
  const existingNames = (await db.foodLibrary.findMany({ select: { name: true } })).map((x) => x.name);
  const existing = new Set(existingNames);
  const data = rows.map(food).filter((x) => !existing.has(x.name));
  let added = 0;
  for (let i = 0; i < data.length; i += 80) {
    const res = await db.foodLibrary.createMany({ data: data.slice(i, i + 80) });
    added += res.count;
  }

  // ---- Phase 1.5: dupes that are legacy rows (no units or no source) → upgrade to v253-part2 spec ----
  let upserted = 0;
  for (const x of rows.map(food)) {
    if (!existing.has(x.name)) continue;
    const cur = await db.foodLibrary.findFirst({ where: { name: x.name }, select: { units: true, source: true } });
    if (cur && (!cur.units || !cur.source)) {
      await db.foodLibrary.updateMany({ where: { name: x.name }, data: x });
      upserted++;
    }
  }

  // ---- Phase 2: calibrate existing items by exact name ----
  let calibrated = 0;
  const calibratedNames: string[] = [];
  for (const [name, v] of Object.entries(calib)) {
    const res = await db.foodLibrary.updateMany({
      where: { name },
      data: {
        calories: Math.round(v.kcal), protein: v.p, carbs: v.c, fat: v.f,
        servingSize: v.serving, servingGrams: v.sg, units: U(v.units), source: v.source,
      },
    });
    if (res.count) { calibrated += res.count; calibratedNames.push(name); }
  }

  // ---- Phase 3: units/servingGrams enrichment for legacy rows missing units ----
  const legacy = await db.foodLibrary.findMany({
    where: { units: "", OR: KW.map((k) => ({ name: { contains: k } })) },
    take: 300,
    orderBy: { createdAt: "asc" },
  });
  let enriched = 0;
  for (const row of legacy) {
    const extra = unitsFor(row.name);
    if (!extra) continue;
    const sg = row.servingGrams ?? gramsFromServing(row.servingSize);
    await db.foodLibrary.update({
      where: { id: row.id },
      data: { units: U(extra), ...(sg !== null ? { servingGrams: sg } : {}) },
    });
    enriched++;
  }

  const total = await db.foodLibrary.count();
  console.log(`P1.5 legacy-upgraded=${upserted}`);
  console.log(`P1 added=${added} (script rows=${rows.length}, dupes skipped=${rows.length - data.length})`);
  console.log(`P2 calibrated=${calibrated} [${calibratedNames.join("، ")}]`);
  console.log(`P3 units-enriched=${enriched} (scanned legacy=${legacy.length})`);
  console.log(`FINAL TOTAL=${total}`);

  // verification
  for (const n of ["قرمه‌سبزی", "زرشک‌پلو با مرغ", "نان تافتون", "سیب", "شیر پرچرب", "زیتون پرورده", "ساندویچ فلافل"]) {
    const hit = await db.foodLibrary.findFirst({
      where: { name: n },
      select: { name: true, calories: true, protein: true, carbs: true, fat: true, servingSize: true, units: true, servingGrams: true, source: true },
    });
    console.log(hit ? `OK ${hit.name} | ${hit.servingSize} | ${hit.calories}kcal P${hit.protein} C${hit.carbs} F${hit.fat} | sg=${hit.servingGrams} | src=${hit.source} | units=${(hit.units || "").slice(0, 90)}` : `MISSING ${n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
