-- ─────────────────────────────────────────────────────────────────────────
-- v239 — پچ سازگاری بانک حرکات (تناقض صفر: نام/توضیحات/نکات ایمنی/فیلدها)
-- اجرا روی سرور پس از دیپلوی:
--   sqlite3 /var/www/fitup/db/custom.db < scripts/exercise-bank-consistency-patch-v239.sql
-- اصول کانونی: RDL/تک‌پا/پا صاف → پا (پشت ران) | ددلیفت کلاسیک/سومو/رک → پشت |
--   جلوبازو → pull | پشت‌بازو → push | فیس‌پول/پول‌آپارت → سرشانه | شراگ → گردن و کول |
--   پیلاتس ثباتی → شکم و کمر | پل باسن/ساید کیک → legs | تجهیز = وسیلهٔ نام‌برده
-- ─────────────────────────────────────────────────────────────────────────
BEGIN TRANSACTION;
-- ددلیفت رومانیایی دمبل تک‌پا — هینج تک‌پا = همسترینگ/باسن (متن توضیحات هم همین می‌گوید)؛ فیلد قبلی پشت/pull متناقض بود
UPDATE ExerciseLibrary SET muscle = 'پشت ران', category = 'legs' WHERE id = 'seed_ex_127';
-- ددلیفت رومانیایی با کش — متن: «عضلات اصلی: همسترینگ، باسن»؛ فیلد کمر و پشت/pull متناقض
UPDATE ExerciseLibrary SET muscle = 'پشت ران', category = 'legs' WHERE id = 'seed_ex_218';
-- ددلیفت تک‌پا با دمبل — tips کاملاً هینج/لگن است؛ فیلد پشت و زیربغل/pull متناقض
UPDATE ExerciseLibrary SET muscle = 'پشت ران', category = 'legs' WHERE id = 'cmufkcy1c002r2b12zieun8na';
-- ددلیفت سومو با کتل‌بل — خانوادهٔ ددلیفت کلاسیک = پشت (کانونی‌سازی مقدار «کمر و پشت»)
UPDATE ExerciseLibrary SET muscle = 'پشت' WHERE id = 'seed_ex_220';
-- جلو بازو لاری دمبل — جلوبازو = pull (نه push)؛ تجهیز فارسی «دمبل» → dumbbell
UPDATE ExerciseLibrary SET category = 'pull', equipment = 'dumbbell' WHERE id = 'cmukfesii019c2bdyxllp85t5';
-- جلو بازو لاری دمبل تک — همان بالا
UPDATE ExerciseLibrary SET category = 'pull', equipment = 'dumbbell' WHERE id = 'cmukfin5s019t2bdy5zb6lbi7';
-- جلو بازو لاری دستگاه — جلوبازو = pull
UPDATE ExerciseLibrary SET category = 'pull' WHERE id = 'cmukfr7v801a82bdyuvjmcq21';
-- زیر بغل سیم کش خم — زیربغل = pull (نه push)؛ باگ صریح
UPDATE ExerciseLibrary SET category = 'pull' WHERE id = 'cmulvft1h00072b9lmad0zgrc';
-- پول‌اور دمبل — توضیحات: «زیربغل و سینه عضلات اصلی»؛ فیلد باید همان باشد
UPDATE ExerciseLibrary SET muscle = 'پشت و زیربغل', category = 'pull' WHERE id = 'cmufkcza6008s2b12cxa0jiqy';
-- فیس‌پول با کش — متن: «دلتوئید خلفی و چرخاننده‌های خارجی شانه»؛ ردیف هم‌خانواده («فیس پول سرشانه») سرشانه دارد
UPDATE ExerciseLibrary SET muscle = 'سرشانه' WHERE id = 'cmufkcyku00582b12gww2zgq7';
-- پول‌آپارت با کش — متن: «دلتوئید خلفی و پایش کتف»؛ هم‌خانوادهٔ دلتوئید خلفی
UPDATE ExerciseLibrary SET muscle = 'سرشانه' WHERE id = 'cmufkcza1008r2b127sj1vrfr';
-- شراگ — دو ردیف شراگ دیگر «گردن و کول» دارند؛ این یکی سرشانه بود (تناقض درون‌خانواده)
UPDATE ExerciseLibrary SET muscle = 'گردن و کول' WHERE id = 'seed_ex_54';
-- شراگ با دستگاه — همان بالا
UPDATE ExerciseLibrary SET muscle = 'گردن و کول' WHERE id = 'cmufkcyfd004f2b12trya9xlm';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_61';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_62';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_63';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_64';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_184';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_186';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_192';
-- حرکات پشت‌بازو با عضلهٔ مبهم «بازو» — کانونی: پشت بازو (هم‌سو با ۲۱ ردیف دیگر)
UPDATE ExerciseLibrary SET muscle = 'پشت بازو' WHERE id = 'seed_ex_194';
-- جلو بازو اسکات — عضلهٔ مبهم «بازو» → جلو بازو
UPDATE ExerciseLibrary SET muscle = 'جلو بازو' WHERE id = 'seed_ex_59';
-- حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkcy7j003h2b12j77kww76';
-- حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkcyem004c2b126s5aw478';
-- حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkcyio004z2b122m0idopn';
-- حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkcyiy00502b12tcmitg3y';
-- حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkcylq005d2b12dlleuz1f';
-- حرکت پیلاتسِ core با عضلهٔ «پشت» — با کتگوری core در تضاد بود؛ کانونی: شکم و کمر
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkczdr009b2b12kne5rjxg';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'seed_dx_5';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'seed_dx_54';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'seed_dx_7';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'seed_ex_215';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'seed_ex_89';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'seed_ex_90';
-- مقدار غیرکانونی «کمر و پشت»/«شکم» در خانوادهٔ ثبات مرکزی → «شکم و کمر» (هم‌سو با ۱۱ ردیف موجود)
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر' WHERE id = 'cmufkcz27007r2b12sx0sfhoj';
-- ساید کیک — عضله «باسن» + cat=core متناقض؛ باسن‌محور = legs
UPDATE ExerciseLibrary SET category = 'legs' WHERE id = 'cmufkcydt00492b12nai36ttm';
-- ساید کیک زانوزده — همان بالا
UPDATE ExerciseLibrary SET category = 'legs' WHERE id = 'cmufkcydz004a2b12ne5ov5wi';
-- پل دیواری — عضله «باسن» + cat=core متناقض
UPDATE ExerciseLibrary SET category = 'legs' WHERE id = 'cmufkcz73008e2b12jfvwbmgf';
-- پل شانه (Shoulder Bridge) — عضله «باسن» + cat=core متناقض
UPDATE ExerciseLibrary SET category = 'legs' WHERE id = 'cmufkcz7r008f2b12dvc6uhky';
-- باز کردن کتاب — چرخش توراسیک موبیلیتی؛ fullbody/پشت متناقض
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر', category = 'core' WHERE id = 'cmufkcxnz00162b12ujq9wsya';
-- نخ در سوزن — چرخش موبیلیتی؛ fullbody/پشت متناقض
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر', category = 'core' WHERE id = 'cmufkcyq500622b12o7bwjmt7';
-- ژست کودک — کشش؛ fullbody/پشت متناقض
UPDATE ExerciseLibrary SET muscle = 'شکم و کمر', category = 'core' WHERE id = 'cmufkczba008y2b123r4ji805';
-- شنا سوئدی T-Push — متن: «با دو دمبل سبک»؛ equipment=bodyweight متناقض
UPDATE ExerciseLibrary SET equipment = 'dumbbell' WHERE id = 'seed_ex_120';
-- دیپ روی نیمکت — نیمکت وسیلهٔ حرکت است (هم‌سو با «پشت بازو دیپس نیمکت»)
UPDATE ExerciseLibrary SET equipment = 'bench' WHERE id = 'cmufkcy4e00342b126wu15i53';
-- لگ‌رایزر معکوس روی نیمکت — نیمکت وسیلهٔ حرکت است
UPDATE ExerciseLibrary SET equipment = 'bench' WHERE id = 'cmufkcyod005q2b1231ij3otk';
-- جلو بازو لاری دستگاه — «دستگاه لاری» → machine
UPDATE ExerciseLibrary SET equipment = 'machine' WHERE id = 'cmukfr7v801a82bdyuvjmcq21';
-- «کشش لست» → «کشش لات» (تایپو)
UPDATE ExerciseLibrary SET name = 'کشش لات با کش از بالا' WHERE id = 'cmufkczef009g2b120j7gcygd';
-- جملهٔ قبلی «عضلات اصلی: باسن، داخل ران و همسترینگ» با هویت روز-پشتِ ددلیفت سومو در تضاد دیده می‌شد — متن با فیلد هم‌سو شد (صحت آناتومیک حفظ شد)
UPDATE ExerciseLibrary SET description = 'کتل‌بل را وسط پاها بگیرید و با پنجه‌ها کمی بازتر، با ستون فقرات خنثی تا نزدیک زمین پایین بروید؛ در posture سومو زانوها به بیرون باز می‌مانند. با فشار کل کف پا به حالت ایستاده برگردید. عضلات اصلی درگیر، پشت (راست‌کننده‌های کمر) و زیربغل هستند و باسن و داخل ران به‌طور جدی فعال‌اند.' WHERE id = 'seed_ex_220';
-- اسکوات اسپلیت بلغاری با مکث — tips ۲۸ نویسه‌ای بدون هیچ نکتهٔ ایمنی اسکوات
UPDATE ExerciseLibrary SET tips = 'در پایین‌ترین نقطه مکث کنید. تنه صاف و کمر خنثی بماند، زانوی جلو هم‌راستای پنجه و پاشنه‌ها روی زمین؛ مکث را با تنفس منظم و کنترل کامل اجرا کنید.' WHERE id = 'seed_ex_149';
-- اسکوات ایزومتریک — tips ۲۶ نویسه‌ای بدون نکتهٔ ایمنی
UPDATE ExerciseLibrary SET tips = 'در زاویه ۹۰ درجه مکث کنید. کمر خنثی و شکم سفت، زانوها هم‌راستای پنجه و وزن روی وسط پا تا پاشنه؛ تنفس را در مکث قطع نکنید.' WHERE id = 'seed_ex_157';
-- پرس سینه هالتر با مکث پایین — حرکت هالتری سنگین بدون نکتهٔ ایمنی
UPDATE ExerciseLibrary SET tips = 'هالتر را روی سینه مکث کنید. همیشه با یار کمکی، کتف‌ها جمع و پاها ثابت، میله کنترل‌شده پایین بیاید (نه رها شدن) و پرس با بازدم اجرا شود.' WHERE id = 'seed_ex_240';
-- پرس سینه دمبل با کش مقاومتی — tips ۲۱ نویسه‌ای
UPDATE ExerciseLibrary SET tips = 'کش را محکم نگه دارید. کش باید زیر و پشت نیمکت محکم مهار شده باشد، مسیر دمبل‌ها عمودی و متقارن بماند و قوس کمر اضافه نباشد.' WHERE id = 'seed_ex_245';
-- [fallback-code] em-superman → muscle='شکم و کمر', category='core' — با کد v239 اصلاح شد
-- واژگان تجهیز: «سیم کش» → «cable» (1 ردیف)
UPDATE ExerciseLibrary SET equipment = 'cable' WHERE equipment = 'سیم کش';
-- واژگان تجهیز: «band» → «resistance band» (10 ردیف)
UPDATE ExerciseLibrary SET equipment = 'resistance band' WHERE equipment = 'band';
-- ددلیفت با کتل‌بل — جملهٔ عضلانی متن با هویت روز-پشت هم‌سو شد (باسن/همسترینگ کمکی ماند)
UPDATE ExerciseLibrary SET description = 'کتل‌بل را بین پاها و کمی جلوتر قرار دهید و پاها را به عرض شانه بگذارید. با ستون فقرات خنثی، لگن را عقب بدهید، کتل‌بل را با دو دست بگیرید و با فشار کف پا و انقباض باسن بدن را صاف بلند کنید؛ در بالا لگن را کامل باز کنید. عضلات اصلی درگیر، پشت (راست‌کننده‌های کمر) و زیربغل هستند و باسن و همسترینگ به‌طور جدی فعال‌اند.' WHERE id = 'cmufkcy0u002o2b12gjxxp3lu';
COMMIT;
