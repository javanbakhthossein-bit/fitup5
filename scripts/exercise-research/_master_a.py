# -*- coding: utf-8 -*-
"""FitUp Task 2-a — master gym hypertrophy exercise list (research group A)."""
import json

Z = "\u200c"  # ZWNJ

D_STR   = ["bodybuilding", "classic_physique", "mens_physique", "fitness"]
D_STR_G = ["bodybuilding", "classic_physique", "mens_physique", "fitness", "general"]
D_LEGS  = ["bodybuilding", "classic_physique", "mens_physique", "wellness", "bikini_fitness", "womens_fitness", "womens_physique", "fitness"]
D_LEGS_G= ["bodybuilding", "classic_physique", "mens_physique", "wellness", "bikini_fitness", "womens_fitness", "womens_physique", "fitness", "general"]
D_ABS   = ["bodybuilding", "fitness", "classic_physique", "mens_physique", "wellness", "bikini_fitness", "womens_fitness", "womens_physique", "general"]
D_GLUTE = ["bodybuilding", "wellness", "bikini_fitness", "womens_fitness", "fitness", "womens_physique"]

E = []
def add(en, fa, muscle, secondary, equipment, category, pattern, difficulty, core, disciplines, mt=None, mt_all=None, xt=None, q=None, desc="", tips=""):
    E.append(dict(en=en, fa=fa, muscle=muscle, secondary=secondary, equipment=equipment,
                  category=category, pattern=pattern, difficulty=difficulty, core=core,
                  disciplines=disciplines, mt=mt or [], mt_all=mt_all or [], xt=xt or [], q=q, desc=desc, tips=tips))

# ============================ CHEST ============================
add("Barbell Bench Press", "پرس سینه هالتر", "سینه", ["سرشانه", "پشت بازو"], "barbell", "push", "horizontal_push", "intermediate", True, D_STR_G,
    mt=["bench press"], xt=["dumbbell","incline","decline","cable","smith","close","floor","machine","reverse","guillotine","board"],
    desc=f"روی نیمکت صاف دراز بکشید و هالتر را با دست‌هایی کمی بازتر از عرض شانه بگیرید. هالتر را با کنترل تا وسط سینه پایین بیاورید و آرنج‌ها حدود ۴۵ درجه باز بمانند، سپس با بازدم آن را به بالا پرس کنید. کتف‌ها را جمع و پایین نگه دارید و پاها محکم روی زمین باشند.",
    tips="با وزنه‌های سنگین حتماً از یار کمکی استفاده کنید و آرنج را در بالای حرکت کاملاً قفل نکنید.")
add("Incline Barbell Bench Press", "پرس بالا سینه هالتر", "سینه", ["سرشانه", "پشت بازو"], "barbell", "push", "incline_push", "intermediate", True, D_STR,
    mt_all=["incline", "press"], xt=["dumbbell","cable","smith","machine","fly"],
    desc=f"نیمکت را روی زاویه ۳۰ تا ۴۵ درجه تنظیم کنید و همانند پرس سینه، هالتر را تا بالای قفسه سینه پایین بیاورید. با بازدم هالتر را به بالا پرس کنید و در بالای حرکت آرنج‌ها را کامل قفل نکنید. سر و کمر را تمام طول حرکت به نیمکت چسبانده نگه دارید.",
    tips="زاویه بیش از ۴۵ درجه فشار را به سرشانه منتقل می‌کند؛ از قوس دادن بیش از حد کمر خودداری کنید.")
add("Decline Barbell Bench Press", "پرس زیر سینه هالتر", "سینه", ["پشت بازو", "سرشانه"], "barbell", "push", "decline_push", "intermediate", True, D_STR,
    mt_all=["decline", "press"], xt=["dumbbell","cable","smith","machine","fly"],
    desc=f"روی نیمکت شیب‌دار منفی دراز بکشید و هالتر را تا پایین قفسه سینه با کنترل پایین بیاورید. سپس با بازدم هالتر را به سمت خط چانه به بالا پرس کنید. برداشتن و گذاشتن هالتر را با کمک یار انجام دهید.",
    tips="به‌دلیل زاویه نیمکت برداشتن وزنه به‌تنهایی خطرناک است؛ همیشه از یار کمکی استفاده کنید.")
add("Dumbbell Bench Press", "پرس سینه دمبل", "سینه", ["سرشانه", "پشت بازو"], "dumbbell", "push", "horizontal_push", "beginner", True, D_STR_G,
    mt_all=["dumbbell", "press"], xt=["incline","decline","fly","floor","shoulder","overhead","cable"],
    desc=f"روی نیمکت صاف دراز بکشید و دمبل‌ها را بالای سینه نگه دارید. دمبل‌ها را با کنترل تا دو طرف سینه پایین بیاورید تا کشش کامل احساس شود، سپس به‌صورت قوسی به بالا پرس کنید. مچ‌ها را صاف نگه دارید و دمبل‌ها را به هم نکوبید.",
    tips="پایین آوردن بیش از حد دمبل‌ها فشار را به مفصل شانه می‌اندازد؛ دامنه را در محدوده بی‌درد کنترل کنید.")
add("Incline Dumbbell Bench Press", "پرس بالا سینه دمبل", "سینه", ["سرشانه", "پشت بازو"], "dumbbell", "push", "incline_push", "intermediate", True, D_STR,
    mt=["incline dumbbell press","incline dumbbell bench press","incline db press","incline dumbbell bench"], xt=["fly","curl"],
    desc=f"روی نیمکت ۳۰ تا ۴۵ درجه دراز بکشید و دمبل‌ها را بالای بالای سینه پرس کنید. دمبل‌ها را با کنترل پایین بیاورید تا کشش در بالا سینه احساس شود و سپس با بازدم به بالا بفرستید. مسیر حرکت باید مستقیم و بدون چرخش مچ باشد.",
    tips="وزنه سنگین‌تر از توان فرم را خراب می‌کند؛ ابتدا با وزنه سبک مسیر صحیح را تمرین کنید.")
add("Decline Dumbbell Bench Press", "پرس زیر سینه دمبل", "سینه", ["پشت بازو"], "dumbbell", "push", "decline_push", "intermediate", False, D_STR,
    mt=["decline dumbbell","decline db"], xt=["fly","cable"])
add("Dumbbell Fly", "قفسه سینه دمبل", "سینه", ["سرشانه"], "dumbbell", "push", "fly", "intermediate", True, D_STR,
    mt=["dumbbell fly","dumbbell flies","db fly","dumbbell flyes","dumbbell flys"], xt=["incline","decline","cable","pec"],
    desc=f"روی نیمکت صاف دراز بکشید و دمبل‌ها را با آرنج‌های کمی خم بالای سینه نگه دارید. دمبل‌ها را به‌صورت قوسی باز کنید تا کشش در سینه احساس شود و سپس همان مسیر را برگردید. زاویه آرنج در تمام حرکت ثابت می‌ماند.",
    tips="وزنه سبک انتخاب کنید؛ پایین آوردن دمبل پایین‌تر از سطح شانه فشار زیادی به کپسول شانه وارد می‌کند.")
add("Incline Dumbbell Fly", "قفسه بالا سینه دمبل", "سینه", ["سرشانه"], "dumbbell", "push", "fly", "intermediate", False, D_STR,
    mt_all=["incline", "fly"], xt=["cable"])
add("Cable Crossover", "کراس اور سیم‌کش", "سینه", ["سرشانه"], "cable", "push", "fly", "beginner", True, D_STR,
    mt=["cable crossover","cable cross over","cable crossovers"], xt=["reverse"],
    desc=f"دو قرقره را در ارتفاع بالا تنظیم کنید و بین دستگاه بایستید. دستگیره‌ها را با آرنج‌های کمی خم از دو طرف به سمت جلو و پایین بدن به‌صورت قوسی ببندید تا سینه کامل جمع شود. در انتهای حرکت یک لحظه انقباض را نگه دارید.",
    tips="از کمر خم نشوید و برای ثبات یک پا را جلوتر بگذارید؛ وزنه را با کنترل برگردانید.")
add("Cable Fly", "قفسه سینه سیم‌کش", "سینه", ["سرشانه"], "cable", "push", "fly", "beginner", False, D_STR,
    mt=["cable fly","cable flyes","standing cable fly","cable chest fly","cable flies"], xt=["reverse","incline"])
add("Machine Chest Press", "پرس سینه دستگاه", "سینه", ["سرشانه", "پشت بازو"], "machine", "push", "horizontal_push", "beginner", True, D_STR_G,
    mt=["machine chest press","chest press machine","seated chest press","chest machine press"], xt=["shoulder"],
    desc=f"روی صندلی دستگاه بنشینید و دستگیره‌ها را هم‌سطح وسط سینه بگیرید. با بازدم دستگیره‌ها را به جلو پرس کنید تا آرنج‌ها نزدیک باز شدن کامل برسند و سپس با کنترل برگردانید. پشت و سر را به تکیه‌گاه بچسبانید.",
    tips="تنظیم صندلی طوری باشد که دستگیره هم‌سطح خط سینه باشد وگرنه فشار به مفصل شانه می‌رود.")
add("Pec Deck Fly", "قفسه سینه پروانه (پک‌دک)", "سینه", ["سرشانه"], "machine", "push", "fly", "beginner", False, D_STR,
    mt=["pec deck","peck deck","pec-deck","butterfly","chest fly machine"], xt=["reverse"])
add("Smith Machine Bench Press", "پرس سینه اسمیت", "سینه", ["سرشانه", "پشت بازو"], "smith", "push", "horizontal_push", "beginner", False, D_STR,
    mt_all=["smith", "press"], xt=["incline","shoulder","behind","squat"])
add("Incline Smith Machine Press", "پرس بالا سینه اسمیت", "سینه", ["سرشانه", "پشت بازو"], "smith", "push", "incline_push", "intermediate", False, D_STR,
    mt_all=["smith", "incline"], xt=["squat","shoulder"])
add("Chest Dip", "پارالل سینه", "سینه", ["پشت بازو", "سرشانه"], "bodyweight", "push", "dip", "intermediate", True, D_STR_G,
    mt=["dip"], xt=["triceps","bench","assisted","machine"],
    desc=f"دست‌ها را روی بار پارالل بگذارید، بدن را کمی به جلو خم کنید و آرنج‌ها را تا جایی که کشش سینه احساس شود خم کنید. سپس با فشار کف دست‌ها بدن را به بالا بفرستید. زانوها را کمی جمع نگه دارید تا تعادل حفظ شود.",
    tips="اگر توان کامل ندارید از دستگاه دیپس کمکی استفاده کنید؛ پایین رفتن بیش از حد فشار خطرناکی به شانه می‌دهد.")
add("Push-Up", "شنا سوئدی", "سینه", ["پشت بازو", "سرشانه"], "bodyweight", "push", "horizontal_push", "beginner", True, D_STR_G,
    mt=["push up","push-up","pushup"], xt=["incline","decline","diamond","plyo","one arm","single","archer","pike","wall","handstand","clap","spider","hindu"],
    desc=f"کف دست‌ها کمی بازتر از عرض شانه روی زمین و بدن از سر تا پاشنه یک خط صاف باشد. آرنج‌ها را تا نزدیکی زمین خم کنید و سپس بدن را با فشار کف دست‌ها به بالا بفرستید. شکم و باسن را در تمام حرکت منقبض نگه دارید.",
    tips="اگر کمر شکم می‌دهد باسن را سفت‌تر کنید یا حرکت را روی زانو انجام دهید.")
add("Dumbbell Pullover", "پول‌اور دمبل", "سینه", ["پشت"], "dumbbell", "push", "pullover", "intermediate", False, D_STR,
    mt=["pullover"], xt=["cable","barbell","machine"])
add("Hammer Strength Chest Press", "پرس سینه هامر استرنگث", "سینه", ["سرشانه", "پشت بازو"], "machine", "push", "horizontal_push", "intermediate", False, D_STR,
    mt=["hammer strength"], xt=["row","incline"], q="hammer strength chest press proper form youtube")

# ============================ BACK ============================
add("Barbell Bent-Over Row", "زیربغل هالتر خم", "پشت", ["جلو بازو", "باسن"], "barbell", "pull", "horizontal_pull", "intermediate", True, D_STR,
    mt=["bent over row","bent-over row","barbell row"], xt=["reverse","pendlay","t-bar","tbar","underhand","yates","grip"],
    desc=f"هالتر را با دست‌هایی به عرض شانه بگیرید، بالاتنه را تا حدود ۴۵ درجه به جلو خم کنید و کمر را صاف نگه دارید. هالتر را به سمت پایین شکم بکشید و آرنج‌ها را نزدیک بدن نگه دارید، سپس با کنترل پایین بروید.",
    tips="کمر هرگز گود یا گرد نشود؛ وزنه سنگین با فرم غلط مستقیم به دیسک‌های کمر فشار می‌آورد.")
add("Lat Pulldown", "زیربغل سیم‌کش از جلو", "پشت", ["جلو بازو"], "cable", "pull", "vertical_pull", "beginner", True, D_STR_G,
    mt=["lat pulldown","lat pull-down","lat pull down","pulldown"], xt=["close","wide","reverse","straight","single","one"],
    desc=f"روی صندلی بنشینید و میله را با دست‌هایی بازتر از عرض شانه بگیرید. میله را تا بالای سینه بکشید، سینه را بالا و شانه‌ها را پایین و عقب نگه دارید. میله را با کنترل به بالا برگردانید تا کشش کامل زیربغل احساس شود.",
    tips="بدن را به عقب پرتاب نکنید و از مومنتوم استفاده نکنید؛ کشیدن میله پشت گردن توصیه نمی‌شود.")
add("Wide-Grip Lat Pulldown", "زیربغل سیم‌کش دست باز", "پشت", ["جلو بازو"], "cable", "pull", "vertical_pull", "beginner", False, D_STR,
    mt_all=["wide", "pulldown"], xt=["reverse","close"])
add("Close-Grip Lat Pulldown", "زیربغل سیم‌کش دست جمع", "پشت", ["جلو بازو"], "cable", "pull", "vertical_pull", "beginner", False, D_STR,
    mt_all=["close", "pulldown"], xt=["wide","reverse"])
add("Pull-Up", "بارفیکس", "پشت", ["جلو بازو"], "bodyweight", "pull", "vertical_pull", "intermediate", True, D_STR_G,
    mt=["pull up","pull-up","pullup"], xt=["chin","assisted","negative","muscle","commando","archer","typewriter","weight"],
    desc=f"از بار آویزان شوید، دست‌ها کمی بازتر از عرض شانه و کف دست‌ها رو به جلو. با جمع کردن تیغه‌های شانه بدن را تا جایی که چانه از بار رد شود بکشید و سپس با کنترل پایین بروید. در پایین حرکت آرنج را کامل باز نگه دارید.",
    tips="اگر تعداد تکرار کم است از کش کمکی یا دستگاه اسیست استفاده کنید؛ چرخاندن و تلوتلو دادن بدن ممنوع است.")
add("Chin-Up", "بارفیکس دست برعکس", "پشت", ["جلو بازو"], "bodyweight", "pull", "vertical_pull", "intermediate", False, D_STR,
    mt=["chin up","chin-up","chinup"], xt=["assisted","weighted","negative"])
add("One-Arm Dumbbell Row", "زیربغل دمبل تک‌دست", "پشت", ["جلو بازو"], "dumbbell", "pull", "horizontal_pull", "beginner", False, D_STR_G,
    mt=["one arm dumbbell row","one-arm dumbbell row","single arm dumbbell row","single-arm dumbbell row","one arm row","dumbbell row"], xt=["chest supported","incline"],
    q="one arm dumbbell row proper form youtube")
add("Seated Cable Row", "زیربغل قایقی سیم‌کش", "پشت", ["جلو بازو"], "cable", "pull", "horizontal_pull", "beginner", False, D_STR_G,
    mt=["seated cable row","seated row"], xt=["one","single","wide","close","machine","chest supported"],
    desc=f"روی دستگاه قایقی بنشینید، زانوها کمی خم و کمر صاف. دستگیره را به سمت شکم بکشید و تیغه‌های شانه را به هم نزدیک کنید، سپس با کنترل به حالت اول برگردید تا کشش کامل در زیربغل احساس شود.",
    tips="بالاتنه را عقب‌وجلو پرتاب نکنید؛ کشیدن دستگیره باید با عضله زیربغل انجام شود نه با مومنتوم.")
add("T-Bar Row", "زیربغل تی‌بار", "پشت", ["جلو بازو", "باسن"], "barbell", "pull", "horizontal_pull", "intermediate", False, D_STR,
    mt=["t-bar row","t bar row","tbar row","landmine row"])
add("Pendlay Row", "زیربغل پندلی", "پشت", ["جلو بازو"], "barbell", "pull", "horizontal_pull", "advanced", False, ["bodybuilding", "classic_physique", "mens_physique"],
    mt=["pendlay"])
add("Deadlift", "ددلیفت", "پشت", ["پا", "باسن"], "barbell", "pull", "hinge", "advanced", True, D_STR,
    mt=["deadlift"], xt=["romanian","stiff","sumo","trap","single","dumbbell","kettlebell","rack","deficit","straight"],
    desc=f"با پاهایی به عرض لگن و هالتر نزدیک ساق، کمر را صاف و سینه را بالا نگه دارید. هالتر را با فشار پاها به زمین و صاف شدن لگن از زمین بلند کنید تا ایستاده کامل شوید. برگرداندن هالتر نیز با همان مسیر و کمر صاف انجام می‌شود.",
    tips="گرد یا گود شدن کمر شایع‌ترین علت آسیب است؛ از وزنه سبک شروع کنید و در وزنه‌های سنگین از کمربند استفاده کنید.")
add("Romanian Deadlift", "ددلیفت رومانیایی", "پا", ["باسن", "پشت"], "barbell", "legs", "hinge", "intermediate", True, D_LEGS,
    mt=["romanian deadlift","romanian dead lift","rdl"], xt=["dumbbell","single","kettlebell","smith"],
    desc=f"هالتر را جلوی ران بگیرید و با زانوهای کمی خم، لگن را به عقب بدهید و هالتر را نزدیک پاها به سمت زمین پایین بیاورید. وقتی کشش در پشت پا احساس شد، با فشار باسن بدن را به حالت ایستاده برگردانید. کمر در تمام حرکت صاف است.",
    tips="هالتر را از بدن جدا نکنید و دامنه حرکت را فقط تا جایی ادامه دهید که کمر صاف بماند.")
add("Stiff-Leg Deadlift", "ددلیفت پا صاف", "پا", ["باسن", "پشت"], "barbell", "legs", "hinge", "intermediate", False, D_LEGS,
    mt=["stiff leg deadlift","stiff legged deadlift","stiff-leg deadlift","stiff-legged deadlift"], xt=["dumbbell","single"])
add("Straight-Arm Pulldown", "زیربغل سیم‌کش دست صاف", "پشت", ["سینه"], "cable", "pull", "vertical_pull", "beginner", False, D_STR,
    mt=["straight arm pulldown","straight-arm pulldown","straight arm pull down","straight-arm pull down","straight arm pushdown"])
add("Seated Machine Row", "زیربغل قایقی دستگاه", "پشت", ["جلو بازو"], "machine", "pull", "horizontal_pull", "beginner", False, D_STR_G,
    mt=["machine row","seated machine row","lever row","hammer strength row","chest supported row"], xt=["t"])
add("Single-Arm Cable Row", "زیربغل سیم‌کش تک‌دست", "پشت", ["جلو بازو"], "cable", "pull", "horizontal_pull", "beginner", False, D_STR,
    mt=["single arm cable row","one arm cable row","single-arm cable row","one-arm cable row","single arm seated cable row"])
add("Back Extension", "هایپراکستنشن", "پشت", ["باسن"], "bodyweight", "pull", "extension", "beginner", True, D_STR_G,
    mt=["back extension","hyperextension"], xt=["reverse","glute ham","ghd"],
    desc=f"روی دستگاه هایپراکستنشن قرار بگیرید و پاها را در رولرها قفل کنید. با کمر صاف بالاتنه را تا زاویه ۹۰ درجه پایین ببرید و سپس با فشار پایین کمر و باسن به بالای خط بدن برگردید. دست‌ها می‌توانند روی سینه یا جلوی بدن باشند.",
    tips="بالاتنه را بالاتر از خط بدن خم نکنید و از پرتاب بدن با مومنتوم خودداری کنید.")
add("Good Morning", "گود مورنینگ", "پشت", ["پا", "باسن"], "barbell", "pull", "hinge", "intermediate", False, ["bodybuilding", "classic_physique", "mens_physique"],
    mt=["good morning"], xt=["seated","single"])
add("Reverse-Grip Bent-Over Row", "زیربغل هالتر خم دست برعکس", "پشت", ["جلو بازو"], "barbell", "pull", "horizontal_pull", "intermediate", False, D_STR,
    mt=["reverse grip barbell row","underhand barbell row","reverse grip row","reverse-grip barbell row"])

# ============================ SHOULDERS ============================
add("Barbell Overhead Press", "پرس سرشانه هالتر", "سرشانه", ["پشت بازو", "شکم"], "barbell", "push", "vertical_push", "intermediate", True, D_STR,
    mt=["overhead press","military press","shoulder press","standing barbell press"], xt=["dumbbell","seated","machine","behind","arnold","smith"],
    desc=f"هالتر را بالای سینه جلوی گردن با مچ‌های جمع بگیرید و بایستید. با بازدم هالتر را کامل بالای سر پرس کنید تا آرنج‌ها باز شوند و سپس با کنترل به حالت اول برگردید. شکم و باسن را منقبض نگه دارید تا کمر بیش از حد گود نشود.",
    tips="برای جلوگیری از گود شدن کمر شکم را سفت کنید؛ اگر سابقه آسیب شانه دارید پرس از جلو ایمن‌تر است.")
add("Dumbbell Shoulder Press", "پرس سرشانه دمبل", "سرشانه", ["پشت بازو"], "dumbbell", "push", "vertical_push", "beginner", True, D_STR_G,
    mt=["dumbbell shoulder press","dumbbell overhead press","seated dumbbell press","db shoulder press"], xt=["arnold"],
    desc=f"نشسته یا ایستاده، دمبل‌ها را کنار شانه‌ها با مچ‌های رو به جلو نگه دارید. دمبل‌ها را بالای سر پرس کنید تا دو دست نزدیک هم شوند و سپس با کنترل پایین بیاورید. مسیر حرکت باید صاف و بدون قوس کمر باشد.",
    tips="پایین آوردن دمبل‌ها پایین‌تر از سطح شانه با وزنه سنگین به مفصل شانه فشار می‌آورد.")
add("Arnold Press", "پرس آرنولد", "سرشانه", ["پشت بازو"], "dumbbell", "push", "vertical_push", "intermediate", False, D_STR,
    mt=["arnold press"])
add("Behind-the-Neck Press", "پرس سرشانه از پشت گردن", "سرشانه", ["پشت بازو"], "barbell", "push", "vertical_push", "advanced", False, ["bodybuilding", "classic_physique"],
    mt=["behind the neck","behind-the-neck","behind neck"], xt=["lat pulldown","pulldown","dip"])
add("Dumbbell Lateral Raise", "نشر جانب دمبل", "سرشانه", [], "dumbbell", "push", "raise", "beginner", True, D_STR_G,
    mt=["lateral raise","side raise","lateral raises"], xt=["cable","machine","front","reverse","bent","lean","rear"],
    desc=f"ایستاده، دمبل‌ها را کنار بدن و آرنج‌ها را کمی خم نگه دارید. دست‌ها را از دو طرف تا سطح شانه بالا بیاورید و در بالای حرکت یک لحظه نگه دارید، سپس با کنترل پایین بیایید.",
    tips="برای بالا بردن وزنه از تکان دادن بدن استفاده نکنید؛ وزنه سبک‌تر با فرم درست مؤثرتر است.")
add("Cable Lateral Raise", "نشر جانب سیم‌کش", "سرشانه", [], "cable", "push", "raise", "beginner", False, D_STR,
    mt=["cable lateral raise","cable side raise","cable lateral","cable later raise"], xt=["rear","reverse"])
add("Machine Lateral Raise", "نشر جانب دستگاه", "سرشانه", [], "machine", "push", "raise", "beginner", False, D_STR,
    mt=["machine lateral","lateral raise machine","side delt machine","machine shoulder lateral"], xt=["press","rear"])
add("Dumbbell Front Raise", "نشر جلو دمبل", "سرشانه", ["سینه"], "dumbbell", "push", "raise", "beginner", False, D_STR,
    mt=["front raise"], xt=["cable","barbell","plate","kettlebell","lateral"])
add("Bent-Over Dumbbell Rear Delt Raise", "نشر خم دمبل", "سرشانه", ["پشت"], "dumbbell", "push", "raise", "intermediate", False, D_STR,
    mt=["rear delt raise","bent over lateral raise","bent-over lateral raise","rear lateral raise","bent over dumbbell raise","rear delt fly","bent over rear delt"], xt=["cable","machine","face"])
add("Reverse Pec Deck", "نشر معکوس دستگاه (پک‌دک معکوس)", "سرشانه", ["پشت"], "machine", "push", "raise", "beginner", False, D_STR,
    mt=["reverse pec deck","reverse peck deck","rear delt machine","machine rear delt","pec deck rear"], xt=["lateral"])
add("Cable Rear Delt Fly", "کراس اور معکوس سیم‌کش", "سرشانه", ["پشت"], "cable", "push", "raise", "beginner", False, D_STR,
    mt=["reverse crossover","rear delt cable","reverse cable fly","reverse cable crossover","rear cable fly"])
add("Face Pull", "فیس‌پول", "سرشانه", ["پشت"], "cable", "pull", "face_pull", "beginner", True, D_STR_G,
    mt=["face pull","facepull"], xt=["kneeling"],
    desc=f"قرقره سیم‌کش را هم‌سطح صورت تنظیم کنید و طناب را با دو دست بگیرید. طناب را به سمت صورت بکشید به‌طوری که آرنج‌ها بالاتر از مچ و رو به بیرون باشند. در انتهای حرکت تیغه‌های شانه را جمع کنید و سپس با کنترل برگردید.",
    tips="وزنه زیاد باعث درگیری بازو و فرم غلط می‌شود؛ آرنج‌ها را پایین نکشید.")
add("Machine Shoulder Press", "پرس سرشانه دستگاه", "سرشانه", ["پشت بازو"], "machine", "push", "vertical_push", "beginner", False, D_STR_G,
    mt=["machine shoulder press","shoulder press machine"], xt=["lateral"])
add("Barbell Shrug", "شراگ هالتر", "گردن و کول", [], "barbell", "pull", "shrug", "beginner", True, D_STR,
    mt=["shrug"], xt=["dumbbell","behind","machine","smith"],
    desc=f"هالتر را جلوی بدن با دست‌هایی به عرض شانه بگیرید و بایستید. شانه‌ها را مستقیم به سمت گوش‌ها بالا بیاورید و یک لحظه نگه دارید، سپس با کنترل پایین بیایید. آرنج‌ها در تمام حرکت صاف می‌مانند.",
    tips="شانه را نچرخانید و از حرکت دادن سر خودداری کنید؛ دامنه حرکت کوتاه اما کنترل‌شده باشد.")
add("Dumbbell Shrug", "شراگ دمبل", "گردن و کول", [], "dumbbell", "pull", "shrug", "beginner", False, D_STR,
    mt=["dumbbell shrug","dumbbell shrugs","db shrug"], xt=["behind"])
add("Behind-the-Back Shrug", "شراگ پشت بدن هالتر", "گردن و کول", [], "barbell", "pull", "shrug", "intermediate", False, ["bodybuilding"],
    mt=["behind the back shrug","behind back shrug","behind-the-back shrug","behind the back barbell shrug"])

# ============================ BICEPS ============================
add("Barbell Curl", "جلو بازو هالتر", "جلو بازو", ["ساعد"], "barbell", "pull", "curl", "beginner", True, D_STR,
    mt=["barbell curl"], xt=["ez","reverse","preacher","close","wrist"],
    desc=f"ایستاده، هالتر را با کف دست‌ها رو به بالا و به عرض شانه بگیرید. با ثابت نگه داشتن آرنج‌ها کنار بدن، هالتر را به سمت شانه‌ها جمع کنید و در بالای حرکت یک لحظه مکث کنید، سپس با کنترل کامل پایین بیایید.",
    tips="بالاتنه را به عقب پرتاب نکنید و آرنج را جلو نبرید؛ پایین آوردن کنترل‌شده برای رشد مهم‌تر از وزنه سنگین است.")
add("EZ-Bar Curl", "جلو بازو هالتر زیگزاگ", "جلو بازو", ["ساعد"], "barbell", "pull", "curl", "beginner", False, D_STR,
    mt=["ez bar curl","ez-bar curl","ez curl","e-z bar curl","zigzag"])
add("Dumbbell Curl", "جلو بازو دمبل", "جلو بازو", ["ساعد"], "dumbbell", "pull", "curl", "beginner", True, D_STR_G,
    mt=["dumbbell curl","db curl"], xt=["hammer","incline","concentration","preacher","seated","zottman"],
    desc=f"ایستاده، در هر دست یک دمبل با کف دست رو به جلو نگه دارید. دمبل‌ها را یکی‌یکی یا هم‌زمان با جمع کردن آرنج بالا بیاورید و مچ را در بالای حرکت کمی بچرخانید. با کنترل به حالت اول برگردید.",
    tips="دمبل‌ها را به هم نکوبید و از چرخاندن بالاتنه استفاده نکنید؛ حرکت باید فقط از آرنج بیاید.")
add("Hammer Curl", "جلو بازو چکشی", "جلو بازو", ["ساعد"], "dumbbell", "pull", "curl", "beginner", False, D_STR,
    mt=["hammer curl","hammer curls"], xt=["cable","rope"])
add("Preacher Curl", "جلو بازو لاری", "جلو بازو", [], "barbell", "pull", "curl", "beginner", True, D_STR,
    mt=["preacher"], xt=["machine","spider"],
    desc=f"بازو را روی تکیه‌گاه دستگاه لاری قرار دهید و هالتر یا دمبل را با دست صاف بگیرید. وزنه را تا نزدیکی شانه جمع کنید و در بالای حرکت انقباض کامل بگیرید، سپس با کنترل تا کشش کامل پایین بروید.",
    tips="بازو را از تکیه‌گاه جدا نکنید و در پایین حرکت آرنج را کامل قفل نکنید.")
add("Incline Dumbbell Curl", "جلو بازو دمبل اینکلاین", "جلو بازو", [], "dumbbell", "pull", "curl", "intermediate", False, D_STR,
    mt=["incline dumbbell curl","incline dumbbell curls","incline curl"], xt=["press","fly"])
add("Concentration Curl", "جلو بازو تمرکزی", "جلو بازو", [], "dumbbell", "pull", "curl", "intermediate", False, D_STR,
    mt=["concentration"])
add("Cable Curl", "جلو بازو سیم‌کش", "جلو بازو", ["ساعد"], "cable", "pull", "curl", "beginner", False, D_STR,
    mt=["cable curl"], xt=["hammer","reverse","face"])
add("Machine Biceps Curl", "جلو بازو دستگاه", "جلو بازو", [], "machine", "pull", "curl", "beginner", False, D_STR_G,
    mt=["machine biceps curl","biceps curl machine","machine curl","preacher curl machine"], xt=["leg"])
add("Reverse Barbell Curl", "جلو بازو مچ برعکس هالتر", "جلو بازو", ["ساعد"], "barbell", "pull", "curl", "intermediate", False, D_STR,
    mt=["reverse curl","reverse barbell curl","reverse grip curl"], xt=["wrist","fly","lunge"])
add("Dumbbell Wrist Curl", "مچ دمبل", "جلو بازو", [], "dumbbell", "pull", "curl", "beginner", False, ["bodybuilding", "fitness"],
    mt=["wrist curl"], xt=["reverse"])

# ============================ TRICEPS ============================
add("Triceps Pushdown", "پشت بازو سیم‌کش", "پشت بازو", [], "cable", "push", "pushdown", "beginner", True, D_STR_G,
    mt=["pushdown","push down","push-down","pressdown"], xt=["rope","reverse","single","one arm","one-arm"],
    desc=f"قرقره را در ارتفاع بالا تنظیم کنید و میله را با دو دست بگیرید. آرنج‌ها را کنار بدن ثابت نگه دارید و میله را تا باز شدن کامل آرنج به پایین بکشید. در پایین حرکت یک لحظه انقباض بگیرید و با کنترل برگردید.",
    tips="آرنج‌ها را از بدن جدا نکنید و بالاتنه را خم نکنید؛ وزنه سنگین باعث حرکت شانه‌ها می‌شود.")
add("Rope Triceps Pushdown", "پشت بازو سیم‌کش طناب", "پشت بازو", [], "cable", "push", "pushdown", "beginner", False, D_STR,
    mt=["rope pushdown","rope push down","rope pressdown","triceps rope pushdown","rope triceps"], xt=["overhead","single"])
add("Lying Triceps Extension", "پشت بازو هالتر خوابیده", "پشت بازو", [], "barbell", "push", "extension", "intermediate", True, D_STR,
    mt=["skull crusher","skullcrusher","lying triceps extension","lying tricep extension","lying ez"], xt=["cable","incline","close grip bench","standing"],
    desc=f"روی نیمکت صاف دراز بکشید و هالتر زیگزاگ را بالای سینه نگه دارید. با ثابت ماندن بازوها، هالتر را با خم کردن آرنج به سمت پیشانی پایین بیاورید. سپس با باز کردن آرنج به حالت اول برگردید.",
    tips="آرنج‌ها را به دو طرف باز نکنید؛ وزنه سنگین خطر برخورد با سر دارد پس با احتیاط و ترجیحاً نزدیک یار تمرین کنید.")
add("Overhead Dumbbell Triceps Extension", "پشت بازو دمبل بالای سر", "پشت بازو", [], "dumbbell", "push", "extension", "intermediate", False, D_STR,
    mt=["overhead triceps extension","overhead tricep extension","overhead dumbbell extension","overhead db extension"], xt=["cable","lying"])
add("Overhead Cable Triceps Extension", "پشت بازو سیم‌کش بالای سر", "پشت بازو", [], "cable", "push", "extension", "intermediate", False, D_STR,
    mt=["overhead cable triceps extension","overhead cable extension","overhead rope extension","cable overhead triceps"], xt=["kickback"])
add("Dumbbell Kickback", "کیک‌بک دمبل (پشت بازو)", "پشت بازو", [], "dumbbell", "push", "extension", "intermediate", False, D_STR,
    mt=["kickback"], xt=["cable","glute","leg"])
add("Triceps Dip", "پارالل پشت بازو", "پشت بازو", ["سینه", "سرشانه"], "bodyweight", "push", "dip", "intermediate", False, D_STR,
    mt=["triceps dip","tricep dip","triceps dips"], xt=["bench","machine","assisted","chest","ring"])
add("Machine Triceps Dip", "پشت بازو دستگاه دیپس", "پشت بازو", ["سینه"], "machine", "push", "dip", "beginner", False, D_STR,
    mt=["machine triceps dip","assisted triceps dip","triceps dip machine"], xt=["bench"])
add("Close-Grip Bench Press", "پرس سینه دست جمع (پشت بازو)", "پشت بازو", ["سینه"], "barbell", "push", "horizontal_push", "intermediate", False, D_STR,
    mt_all=["close", "bench press"], xt=["reverse","feet"])
add("Bench Dip", "دیپس روی نیمکت", "پشت بازو", ["سینه", "سرشانه"], "bench", "push", "dip", "beginner", False, D_STR_G,
    mt=["bench dip"], xt=["machine"])

# ============================ LEGS ============================
add("Barbell Back Squat", "اسکوات هالتر", "پا", ["باسن", "شکم"], "barbell", "legs", "squat", "intermediate", True, D_LEGS_G,
    mt=["squat"], xt=["front","goblet","bulgarian","sumo","smith","hack","box","split","overhead","belt","sissy","jump","pause","single","thruster","front"],
    desc=f"هالتر را روی بالای پشت قرار دهید، پاها به عرض شانه و پنجه‌ها کمی رو به بیرون. با بالا نگه داشتن سینه، لگن را به عقب و پایین ببرید تا ران‌ها موازی زمین شوند و سپس با فشار پاها بالا بروید. زانوها هم‌جهت پنجه باقی می‌مانند.",
    tips="پاشنه را از زمین جدا نکنید و کمر را صاف نگه دارید؛ با وزنه سنگین از یار کمکی و رک اسکوات استفاده کنید.")
add("Front Squat", "اسکوات جلو", "پا", ["باسن", "شکم"], "barbell", "legs", "squat", "advanced", False, D_LEGS,
    mt=["front squat"], xt=["goblet","kettlebell","dumbbell","cross"])
add("Smith Machine Squat", "اسکوات اسمیت", "پا", ["باسن"], "smith", "legs", "squat", "beginner", False, D_LEGS,
    mt_all=["smith", "squat"], xt=["calf","press","lunge","rdl","deadlift"])
add("Leg Press", "پرس پا دستگاه", "پا", ["باسن"], "machine", "legs", "squat", "beginner", True, D_LEGS_G,
    mt=["leg press"], xt=["calf","single","one leg","one-leg"],
    desc=f"پاها را به عرض شانه روی صفحه بگذارید و رک را باز کنید. با خم کردن زانوها صفحه را تا زاویه ۹۰ درجه یا کمی کمتر پایین بیاورید و سپس با فشار پاشنه‌ها به بالا بفرستید. زانوها را در بالای حرکت کامل قفل نکنید.",
    tips="کمر و باسن را روی صندلی بچسبانید؛ جدا شدن باسن از صندلی فشار خطرناکی به ستون فقرات می‌دهد.")
add("Hack Squat", "هاک اسکوات دستگاه", "پا", ["باسن"], "machine", "legs", "squat", "intermediate", False, D_LEGS,
    mt=["hack squat"], xt=["barbell","dumbbell"])
add("Leg Extension", "جلو پا دستگاه", "پا", [], "machine", "legs", "leg_extension", "beginner", True, D_LEGS_G,
    mt=["leg extension"], xt=["single","one leg","sissy"],
    desc=f"روی دستگاه بنشینید و مچ پاها را زیر رولر قرار دهید. با بازدم پاها را تا باز شدن کامل زانو بالا ببرید و یک لحظه انقباض را نگه دارید، سپس با کنترل پایین بیایید. کمر را به پشت صندلی بچسبانید.",
    tips="از مومنتوم و تکان دادن بدن استفاده نکنید؛ وزنه سنگین فشار زیادی به مفصل زانو می‌دهد.")
add("Goblet Squat", "اسکوات گابلت", "پا", ["باسن", "شکم"], "dumbbell", "legs", "squat", "beginner", False, D_LEGS_G,
    mt=["goblet"])
add("Bulgarian Split Squat", "اسکوات بلغاری", "پا", ["باسن"], "dumbbell", "legs", "lunge", "intermediate", False, D_LEGS,
    mt=["bulgarian"], xt=["barbell","jump"])
add("Barbell Lunge", "لانژ هالتر", "پا", ["باسن"], "barbell", "legs", "lunge", "intermediate", False, D_LEGS,
    mt=["barbell lunge","barbell lunges"], xt=["walking","side","lateral","curtsy","jump"])
add("Walking Dumbbell Lunge", "لانژ راه‌رفتنی دمبل", "پا", ["باسن"], "dumbbell", "legs", "lunge", "intermediate", False, D_LEGS,
    mt=["walking lunge","walking lunges"], xt=["barbell","jump","side"])
add("Dumbbell Step-Up", "استپ‌آپ دمبل", "پا", ["باسن"], "dumbbell", "legs", "lunge", "beginner", False, D_LEGS_G,
    mt=["step up","step-up","stepup","step ups"], xt=["barbell","jump","box jump","lateral","side"])
add("Lying Leg Curl", "پشت پا دستگاه خوابیده", "پا", ["باسن", "ساق"], "machine", "legs", "leg_curl", "beginner", True, D_LEGS_G,
    mt=["lying leg curl","lying leg curls"], xt=["seated","standing","nordic"],
    desc=f"روی دستگاه به‌صورت دمر دراز بکشید و مچ پاها را زیر رولر بگذارید. با ثابت نگه داشتن لگن روی صندلی، پاها را تا جمع شدن کامل زانو ببرید و در بالای حرکت انقباض را نگه دارید، سپس با کنترل برگردید.",
    tips="لگن را از صندلی بلند نکنید؛ جدا شدن لگن نشانه وزنه سنگین و فشار به کمر است.")
add("Seated Leg Curl", "پشت پا دستگاه نشسته", "پا", ["باسن"], "machine", "legs", "leg_curl", "beginner", False, D_LEGS,
    mt=["seated leg curl","seated leg curls"], xt=["lying"])
add("Sumo Deadlift", "ددلیفت سومو", "پا", ["باسن", "پشت"], "barbell", "legs", "hinge", "intermediate", False, D_LEGS,
    mt=["sumo deadlift"], xt=["dumbbell","kettlebell"])
add("Nordic Hamstring Curl", "پشت پا نوردیک", "پا", ["باسن"], "bodyweight", "legs", "leg_curl", "advanced", False, ["bodybuilding", "fitness", "classic_physique"],
    mt=["nordic"])
add("Barbell Hip Thrust", "هیپ تراست هالتر", "باسن", ["پشت پا", "شکم"], "barbell", "legs", "hip_thrust", "intermediate", False, D_GLUTE,
    mt=["hip thrust"], xt=["glute bridge","single","smith","dumbbell","bodyweight"],
    q="barbell hip thrust proper form youtube")
add("Cable Glute Kickback", "کیک‌بک باسن سیم‌کش", "باسن", ["پشت پا"], "cable", "legs", "kickback", "beginner", False, D_GLUTE,
    mt=["glute kickback","cable kickback","donkey kick"], xt=["dumbbell","leg extension"])
add("Machine Hip Abduction", "خارج ران دستگاه", "باسن", ["پا"], "machine", "legs", "abduction", "beginner", True, D_LEGS_G,
    mt=["hip abduction","hip abductor","abduction machine","abductor machine"], xt=["adduction"],
    desc=f"روی دستگاه ابداکشن بنشینید و پاها را روی پدها قرار دهید. پاها را با فشار به بیرون از هم باز کنید تا حد امکان و در انتهای حرکت یک لحظه مکث کنید، سپس با کنترل برگردید.",
    tips="از تکان دادن بدن برای بالا بردن وزنه استفاده نکنید؛ دامنه کامل با وزنه متوسط بهتر جواب می‌دهد.")
add("Machine Hip Adduction", "داخل ران دستگاه", "پا", ["باسن"], "machine", "legs", "adduction", "beginner", True, D_LEGS_G,
    mt=["hip adduction","hip adductor","adduction machine","adductor machine"], xt=["abduction"],
    desc=f"روی دستگاه اداکشن بنشینید و پاها را روی پدها قرار دهید. پاها را از حالت باز به سمت همدیگر جمع کنید و در انتهای حرکت انقباض داخل ران را نگه دارید، سپس با کنترل به حالت باز برگردید.",
    tips="دامنه باز کردن پاها را در حد بی‌درد کنترل کنید؛ کشیدگی داخل ران با وزنه سنگین شایع است.")
add("Cable Pull-Through", "پول‌ترو سیم‌کش (باسن)", "باسن", ["پشت پا"], "cable", "legs", "hinge", "beginner", False, D_GLUTE,
    mt=["pull through","pull-through"], xt=[])

# ============================ CALVES ============================
add("Standing Calf Raise", "ساق ایستاده دستگاه", "ساق", [], "machine", "legs", "calf_raise", "beginner", True, D_LEGS_G,
    mt=["standing calf raise"], xt=["barbell","dumbbell","donkey","single","seated","smith"],
    desc=f"روی دستگاه ساق ایستاده قرار بگیرید؛ پنجه‌ها روی صفحه و پاشنه‌ها معلق باشند. پاشنه‌ها را تا حد ممکن پایین ببرید تا کشش ساق احساس شود و سپس روی پنجه بالا بایستید. در بالا یک لحظه انقباض را نگه دارید.",
    tips="از پرش و حرکت سریع استفاده نکنید؛ زانو را در تمام حرکت صاف نگه دارید.")
add("Seated Calf Raise", "ساق نشسته دستگاه", "ساق", [], "machine", "legs", "calf_raise", "beginner", True, D_LEGS_G,
    mt=["seated calf raise"], xt=["single"],
    desc=f"روی دستگاه ساق نشسته بنشینید و پدها را روی ران‌ها قرار دهید. پاشنه‌ها را پایین ببرید تا کشش کامل و سپس با فشار روی پنجه بالا بیایید. در بالای حرکت یک لحظه مکث کنید.",
    tips="دامنه کامل حرکت مهم‌تر از وزنه است؛ فشار را به‌طور مساوی روی پنجه‌های داخلی و خارجی بیاورید.")
add("Leg Press Calf Raise", "ساق پرس پا", "ساق", [], "machine", "legs", "calf_raise", "beginner", False, D_LEGS,
    mt=["calf press","leg press calf"], xt=["seated","standing machine","donkey"])
add("Donkey Calf Raise", "ساق دونکی", "ساق", ["باسن"], "machine", "legs", "calf_raise", "intermediate", False, ["bodybuilding", "classic_physique"],
    mt=["donkey calf"])

# ============================ CORE ============================
add("Crunch", "کرانچ", "شکم", [], "bodyweight", "core", "crunch", "beginner", True, D_ABS,
    mt=["crunch"], xt=["cable","reverse","bicycle","machine","v","twist","decline","sit up"],
    desc=f"به پشت روی زمین دراز بکشید، زانوها خم و کف پاها روی زمین. با انقباض شکم، سر و شانه‌ها را چند سانتی‌متر از زمین بلند کنید و در بالا یک لحظه نگه دارید، سپس با کنترل پایین بیایید.",
    tips="گردن را با دست نکشید؛ دست‌ها فقط کنار سر قرار دارند و حرکت باید از شکم بیاید.")
add("Cable Crunch", "کرانچ سیم‌کش", "شکم", [], "cable", "core", "crunch", "beginner", False, D_ABS,
    mt=["cable crunch","kneeling cable crunch"], xt=["wood"])
add("Plank", "پلانک", "شکم", [], "bodyweight", "core", "plank", "beginner", True, D_ABS,
    mt=["plank"], xt=["side","up","shoulder tap","moving","reverse","long lever"],
    desc=f"روی ساعد و پنجه پاها قرار بگیرید؛ بدن از سر تا پاشنه یک خط صاف است. شکم و باسن را منقبض نگه دارید و تنفس را قطع نکنید. تا زمانی که فرم درست حفظ شود در همین حالت بمانید.",
    tips="باسن را بالا ندهید و نگذارید کمر شکم بدهد؛ زمان را با حفظ فرم افزایش دهید نه با خم شدن.")
add("Side Plank", "پلانک جانبی", "شکم", [], "bodyweight", "core", "plank", "beginner", False, D_ABS,
    mt=["side plank"], xt=["raise"])
add("Hanging Leg Raise", "بالا آوردن پا آویزان (بارفیکس)", "شکم", [], "bodyweight", "core", "leg_raise", "intermediate", True, D_ABS,
    mt=["hanging leg raise","hanging knee raise","hanging leg lifts","hanging leg lift"], xt=["toes to bar","captain"],
    desc=f"از بارفیکس آویزان شوید و بدن را ثابت نگه دارید. پاها را با انقباض شکم تا خط لگن یا بالاتر بالا بیاورید و در بالا یک لحظه مکث کنید، سپس با کنترل پایین بیایید. بدن در پایین حرکت نباید تاب بخورد.",
    tips="اگر تاب خوردن بدن زیاد است ابتدا زانوها را جمع کنید؛ پایین آوردن پاها باید کنترل‌شده باشد.")
add("Lying Leg Raise", "بالا آوردن پا خوابیده", "شکم", [], "bodyweight", "core", "leg_raise", "beginner", False, D_ABS,
    mt=["lying leg raise","lying leg lift","leg raise","leg raises"], xt=["hanging","captain","dip","roman","toes","side","single"])
add("Reverse Crunch", "کرانچ معکوس", "شکم", [], "bodyweight", "core", "crunch", "beginner", False, D_ABS,
    mt=["reverse crunch"], xt=["cable","machine"])
add("Bicycle Crunch", "کرانچ دوچرخه", "شکم", [], "bodyweight", "core", "crunch", "beginner", False, D_ABS,
    mt=["bicycle"], xt=["machine"])
add("Russian Twist", "روسی توئیست", "شکم", [], "bodyweight", "core", "rotation", "beginner", False, D_ABS,
    mt=["russian twist"], xt=["cable"])
add("Cable Woodchopper", "چاپر سیم‌کش", "شکم", ["پشت"], "cable", "core", "rotation", "intermediate", False, D_ABS,
    mt=["wood chop","woodchop","wood chop","chopper"], xt=[])
add("Ab Wheel Rollout", "اب رولر", "شکم", ["پشت"], "other", "core", "rollout", "intermediate", False, D_ABS,
    mt=["ab wheel","ab rollout","standing ab wheel"], xt=["kneeling"],
    q="ab wheel rollout proper form youtube")
add("Machine Crunch", "کرانچ دستگاه", "شکم", [], "machine", "core", "crunch", "beginner", False, D_ABS,
    mt=["machine crunch","ab machine","crunch machine","ab crunch machine"], xt=[])

# ============================ FULL BODY ============================
add("Power Clean", "پاور کلین", "کل بدن", ["پشت", "پا", "سرشانه"], "barbell", "fullbody", "olympic", "advanced", False, ["bodybuilding", "fitness", "mens_physique"],
    mt=["power clean"], xt=["hang","kettlebell","squat clean"])
add("Kettlebell Swing", "سوئینگ کتل‌بل", "کل بدن", ["باسن", "پشت"], "kettlebell", "fullbody", "swing", "intermediate", False, ["fitness", "bodybuilding", "general"],
    mt=["kettlebell swing"], xt=["single","one arm","one-arm"])
add("Burpee", "برپی", "کل بدن", ["سینه", "پا"], "bodyweight", "cardio", "burpee", "intermediate", False, ["fitness", "general", "womens_fitness"],
    mt=["burpee","burpies"], xt=[])
add("Dumbbell Thruster", "تراستر دمبل", "کل بدن", ["پا", "سرشانه"], "dumbbell", "fullbody", "thruster", "advanced", False, ["fitness", "general"],
    mt=["thruster"], xt=["kettlebell","barbell"])
add("Farmer's Walk", "پیاده‌روی کشاورز (فارمرز واک)", "کل بدن", ["جلو بازو", "شکم"], "dumbbell", "fullbody", "carry", "beginner", False, ["fitness", "general", "bodybuilding"],
    mt=["farmer","farmers"], xt=[])

for e in E:
    e["name"] = f"{e['fa']} ({e['en']})"

print("total:", len(E))
print("core:", sum(1 for e in E if e["core"]))
mus = {}
for e in E:
    mus[e["muscle"]] = mus.get(e["muscle"], 0) + 1
print(mus)
json.dump(E, open("/home/z/my-project/scripts/exercise-research/groupA_master.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("saved groupA_master.json")
