#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build final groupD-pilates-balance.json from verified video mapping + metadata."""
import json

TMP = "/home/z/my-project/scripts/exercise-research/tmp"
OUT = "/home/z/my-project/scripts/exercise-research/groupD-pilates-balance.json"

vids = json.load(open(TMP + "/groupD_videos.json"))

# --- apply manually reviewed fixes (all oEmbed-verified) ---
FIX = {
 "pelviccurl":    ("fOOypTBlke8", "Core Exercises: Pelvic Curl", "Harvard Health Publishing"),
 "lungerotation": ("GhLk3nhFbPM", "How to Do Reverse Lunge With Rotation | Sleek/Strong With Rachel Cosgrove", "LivestrongWoman"),
 "kbswing":       ("VlyWtxtAN_Y", "Mastering the Kettlebell Swing | John Wolf", "Onnit"),
 "woodchop":      ("b65s5BtdOEc", "How To Do A Dumbbell Woodchop | The Right Way | Well+Good", "Well+Good"),
 "wallbridge":    ("7hiLUQCqqn4", "Pilates Wall Bridging | Pilates on the Wall", "Kaira Studios Pilates"),
 "rdl":           ("FQKfr1YDhEk", "How To: Dumbbell Romanian Deadlift", "ScottHermanFitness"),
}
for k, (v, t, c) in FIX.items():
    vids[k]["videoId"], vids[k]["ytTitle"], vids[k]["ytChannel"] = v, t, c

# id: (fa, en, muscle, secondary, equipment, category, pattern, difficulty, disciplines, core)
META = [
 ("hundred","صد پیلاتس","Pilates Hundred","شکم",["سرشانه"],"bodyweight","core","anti_extension","intermediate",["pilates"],True),
 ("rollup","رول‌آپ","Roll Up","شکم",["پشت","پا"],"bodyweight","core","spinal_flexion","intermediate",["pilates"],True),
 ("rollover","رول‌اور","Roll Over","شکم",["پشت"],"bodyweight","core","spinal_flexion","advanced",["pilates"],False),
 ("legcircle","دایره تک‌پا","Single Leg Circle","شکم",["باسن","پا"],"bodyweight","core","anti_rotation","beginner",["pilates"],True),
 ("rollingball","غلتک مثل توپ","Rolling Like a Ball","شکم",["پشت"],"bodyweight","core","spinal_flexion","intermediate",["pilates"],False),
 ("singlelegstretch","کشش تک‌پا","Single Leg Stretch","شکم",["باسن"],"bodyweight","core","spinal_flexion","beginner",["pilates"],True),
 ("singlestraightleg","کشش تک‌پای صاف","Single Straight Leg Stretch","شکم",["پا"],"bodyweight","core","spinal_flexion","intermediate",["pilates"],False),
 ("doublelegstretch","کشش دوپا","Double Leg Stretch","شکم",["پا"],"bodyweight","core","spinal_flexion","beginner",["pilates"],False),
 ("lowerlift","پایین‌آوردن و بالا بردن دوپای صاف","Double Straight Leg Lower Lift","شکم",["پشت"],"bodyweight","core","anti_extension","intermediate",["pilates"],False),
 ("crisscross","کراس‌کراس","Criss-Cross","شکم",["باسن"],"bodyweight","core","spinal_rotation","intermediate",["pilates"],False),
 ("spinestretch","کشش ستون فقرات رو به جلو","Spine Stretch Forward","پشت",["پا"],"bodyweight","core","spinal_flexion","beginner",["pilates"],False),
 ("saw","اره","Saw","شکم",["پا","پشت"],"bodyweight","core","spinal_rotation","intermediate",["pilates"],False),
 ("spinetwist","چرخش ستون فقرات نشسته","Spine Twist","شکم",["پشت"],"bodyweight","core","spinal_rotation","beginner",["pilates"],False),
 ("swan","قو","Swan","پشت",["سرشانه","باسن"],"bodyweight","core","spinal_extension","intermediate",["pilates"],True),
 ("swimming","شنای پیلاتس","Swimming","پشت",["باسن","سرشانه"],"bodyweight","core","spinal_extension","intermediate",["pilates"],False),
 ("teaser","تیزر","Teaser","شکم",["باسن"],"bodyweight","core","spinal_flexion","advanced",["pilates"],True),
 ("shoulderbridge","پل شانه","Shoulder Bridge","باسن",["شکم","پشت"],"bodyweight","core","hip_extension","intermediate",["pilates"],True),
 ("pelviccurl","چرخش لگن","Pelvic Curl","باسن",["شکم"],"bodyweight","core","hip_extension","beginner",["pilates"],False),
 ("sidekick","ساید کیک","Side Kick","باسن",["شکم"],"bodyweight","core","hip_abduction","beginner",["pilates"],True),
 ("kneelingsidekick","ساید کیک زانوزده","Kneeling Side Kick","باسن",["شکم"],"bodyweight","core","hip_abduction","intermediate",["pilates"],False),
 ("chestlift","لیفت سینه","Chest Lift","شکم",["گردن"],"bodyweight","core","spinal_flexion","beginner",["pilates"],False),
 ("doublelegkick","ضربه دوپا","Double Leg Kick","پشت",["باسن"],"bodyweight","core","spinal_extension","intermediate",["pilates"],False),
 ("legpullfront","پلانک با ضربه پا","Leg Pull Front","کل بدن",["شکم","باسن"],"bodyweight","core","anti_extension","advanced",["pilates"],False),
 ("sidebend","خم جانبی","Side Bend","شکم",["سرشانه","باسن"],"bodyweight","core","lateral_flexion","advanced",["pilates"],False),
 ("jackknife","جک‌نایف","Jackknife","شکم",["پشت"],"bodyweight","core","spinal_flexion","advanced",["pilates"],False),
 ("pilatespushup","شنا پیلاتس","Pilates Push-Up","سینه",["شکم","سرشانه"],"bodyweight","push","push","intermediate",["pilates","fitness"],False),
 ("catcow","سگ-گربه","Cat-Cow","پشت",["شکم"],"bodyweight","core","spinal_mobility","beginner",["pilates","general"],True),
 ("deadbug","دد باگ","Dead Bug","شکم",["باسن"],"bodyweight","core","anti_extension","beginner",["functional","general"],True),
 ("birddog","پرنده-سگ","Bird Dog","شکم",["پشت","باسن"],"bodyweight","core","anti_rotation","beginner",["pilates","functional","general"],True),
 ("sideplank","پلانک جانبی","Side Plank","شکم",["سرشانه","باسن"],"bodyweight","core","anti_lateral_flexion","intermediate",["pilates","functional","fitness"],True),
 ("wallpushup","شنا دیواری","Wall Push-Up","سینه",["پشت بازو"],"bodyweight","push","push","beginner",["pilates","fitness"],False),
 ("wallplank","پلانک دیواری","Wall Plank","شکم",["سرشانه"],"bodyweight","core","anti_extension","beginner",["pilates"],False),
 ("wallbridge","پل دیواری","Wall Pilates Bridge","باسن",["شکم"],"bodyweight","core","hip_extension","beginner",["pilates"],False),
 ("wallrolldown","رول‌داون دیواری","Wall Roll-Down","پشت",["شکم"],"bodyweight","core","spinal_flexion","beginner",["pilates"],False),
 ("wallsit","اسکات دیواری","Wall Sit","پا",["باسن","شکم"],"bodyweight","legs","isometric_squat","beginner",["pilates","balance","fitness"],True),
 ("singlelegstance","ایستاده تک‌پا","Single Leg Stance","پا",["باسن"],"bodyweight","legs","balance_static","beginner",["balance","general"],True),
 ("heeltotoe","راه‌رفتن پاشنه-پنجه","Heel-to-Toe Walk","پا",["ساق"],"bodyweight","legs","gait_balance","beginner",["balance","general"],True),
 ("tandemstance","ایست تعادلی پاشنه-پنجه","Tandem Stance","پا",["باسن"],"bodyweight","legs","balance_static","beginner",["balance","general"],False),
 ("weightshift","انتقال وزن","Weight Shift","پا",["باسن"],"bodyweight","legs","balance_dynamic","beginner",["balance","general"],False),
 ("heelraise","بلند کردن پاشنه","Heel Raise","ساق",["پا"],"bodyweight","legs","plantar_flexion","beginner",["balance","general","fitness"],False),
 ("sittostand","بلند شدن از صندلی","Sit-to-Stand","پا",["باسن"],"bodyweight","legs","squat","beginner",["balance","functional","general"],True),
 ("singlelegdeadlift","ددلیفت تک‌پا","Single-Leg Deadlift","باسن",["پا","شکم"],"bodyweight","legs","hip_hinge","intermediate",["balance","functional","fitness"],True),
 ("squattopress","اسکات به پرس","Squat to Press","کل بدن",["پا","سرشانه"],"dumbbell","fullbody","squat_to_press","intermediate",["functional","fitness"],True),
 ("lungerotation","لانج با چرخش","Lunge with Rotation","کل بدن",["پا","شکم"],"bodyweight","fullbody","lunge_rotation","intermediate",["functional","fitness"],True),
 ("rdl","ددلیفت رومانیایی","Romanian Deadlift","پا",["باسن","پشت"],"dumbbell","legs","hip_hinge","intermediate",["functional","fitness"],True),
 ("kbswing","سوئینگ کتلبل","Kettlebell Swing","باسن",["پشت","شکم"],"kettlebell","fullbody","hip_hinge","intermediate",["functional","fitness"],True),
 ("farmerscarry","حمل بار کشاورز","Farmer's Carry","کل بدن",["پشت","ساق"],"dumbbell","fullbody","carry","beginner",["functional","fitness"],False),
 ("woodchop","هاشور چوبی","Wood Chop","شکم",["پشت","سرشانه"],"dumbbell","core","spinal_rotation","intermediate",["functional","fitness"],False),
 ("bearcrawl","خزیدن خرسی","Bear Crawl","کل بدن",["شکم","سرشانه"],"bodyweight","fullbody","gait","intermediate",["functional","general"],False),
 ("gobletsquat","اسکات گابلت","Goblet Squat","پا",["باسن","شکم"],"dumbbell","legs","squat","beginner",["functional","fitness"],False),
 ("stepup","استپ‌آپ","Step-Up","پا",["باسن"],"bodyweight","legs","lunge","beginner",["functional","balance","fitness"],False),
 ("glutebridge","پل باسن","Glute Bridge","باسن",["شکم","همسترینگ"],"bodyweight","legs","hip_extension","beginner",["functional","general"],False),
 ("walkinglunge","لانج راه‌رونده","Walking Lunge","پا",["باسن"],"bodyweight","legs","lunge","intermediate",["functional","fitness"],False),
 ("turkishgetup","ترکیش گت‌آپ","Turkish Get-Up","کل بدن",["شکم","سرشانه"],"kettlebell","fullbody","getup","advanced",["functional","fitness"],False),
 ("ninetynine","هیپ اوپنر ۹۰/۹۰","90/90 Hip Opener","پا",["باسن"],"bodyweight","legs","hip_mobility","beginner",["general","fitness"],True),
 ("openbook","باز کردن کتاب","Open Book Thoracic Rotation","پشت",["سینه"],"bodyweight","fullbody","thoracic_rotation","beginner",["general"],True),
 ("wgs","بزرگ‌ترین حرکت جهان","World's Greatest Stretch","کل بدن",["پا","پشت"],"bodyweight","fullbody","lunge_rotation","intermediate",["general","functional"],False),
 ("hipflexor","کشش فلکسور هیپ زانوزده","Kneeling Hip Flexor Stretch","پا",["باسن"],"bodyweight","legs","hip_mobility","beginner",["general","fitness"],False),
 ("threadneedle","نخ در سوزن","Thread the Needle","پشت",["سرشانه"],"bodyweight","fullbody","thoracic_rotation","beginner",["general"],False),
 ("wallslide","اسلاید سرشانه دیواری","Scapular Wall Slide","سرشانه",["پشت"],"bodyweight","push","scapular_control","beginner",["general","fitness"],False),
 ("kneetowall","موبیلیتی مچ پا زانو به دیوار","Knee-to-Wall Ankle Mobility","ساق",["پا"],"bodyweight","legs","ankle_mobility","beginner",["general","fitness"],False),
 ("pelvictilt","تیلت لگن","Pelvic Tilt","شکم",["باسن"],"bodyweight","core","pelvic_control","beginner",["pilates","general"],False),
 ("childspose","ژست کودک","Child's Pose","پشت",["سینه"],"bodyweight","fullbody","spinal_flexion","beginner",["general"],False),
]

DESC = {
 "hundred": "صد پیلاتس حرکت امضای متد پیلاتس است که با تنه‌ی خمیده و پمپ‌های ۵تایی دست همراه با تنفس، ۱۰ سیکل کامل اجرا می‌شود. این حرکت استقامت عضلات مرکزی و کنترل تنفس را هم‌زمان می‌سازد و پایه‌ی سایر حرکات پیلاتس به‌شمار می‌رود.",
 "rollup": "رول‌آپ ستون فقرات را مهره‌به‌مهره از زمین بلند می‌کند و با یک خم کامل رو به جلو دوباره پایین می‌آورد. این حرکت شکم عمیق، انعطاف همسترینگ و کنترل عصبی-عضلانی را تقویت می‌کند و عملاً نسخه‌ی آهسته و هوشمندانه‌ی نشستن از حالت خوابیده است.",
 "shoulderbridge": "پل شانه از حالت پل کامل یک پا را به سمت سقف بلند می‌کند و پایین می‌آورد. ثابت نگه داشتن لگن هنگام حرکت پا، قدرت باسن و پایداری مرکزی بدن را به چالش می‌کشد.",
 "catcow": "سگ-گربه ستون فقرات را به‌آرامی بین قوس کامل و گرد شدن حرکت می‌دهد و هماهنگی تنفس با حرکت مهره‌ها را آموزش می‌دهد. بهترین گرم‌کردن برای کمر پیش از هر تمرین و رفع سفتی صبحگاهی است.",
 "swan": "قو حرکت اکستنشن کلاسیک پیلاتس است که بالاتنه را با قدرت عضلات راست‌کننده‌ی ستون فقرات از زمین بلند می‌کند. این حرکت قوس‌دار کردن کمر را با فشار کم به دیسک‌ها تمرین می‌دهد و ضد حرکات خمیده‌ی روزمره است.",
 "teaser": "تیزر چالش‌برانگیزترین حرکت شکم پیلاتس است که تعادل روی باسن با پاهای V شکل و قدرت عمیق مرکزی بدن را می‌طلبد. در واقع ترکیب یک رول‌آپ کامل با حفظ تعادل در نقطه‌ی اوج است.",
 "singlelegstretch": "کشش تک‌پا در حالت خوابیده با نزدیک و دور کردن یکی‌یکی پاها همراه با نگه داشتن سر و شانه بالا اجرا می‌شود. بخشی از سری مشهور پنج حرکت شکم پیلاتس است و هماهنگی و استقامت شکم را می‌سازد.",
 "legcircle": "دایره تک‌پا با چرخاندن یک پای صاف در دایره‌های کنترل‌شده اجرا می‌شود در حالی که لگن و تنه کاملاً ثابت می‌مانند. این حرکت کنترل مرکزی بدن و دامنه‌ی حرکتی مفصل ران را هم‌زمان بهبود می‌بخشد.",
 "sidekick": "ساید کیک در حالت خوابیده به پهلو با حرکت ضربه‌ای و کنترل‌شده‌ی پا از جلو به عقب اجرا می‌شود. عضله‌ی میانی باسن و پایدارکننده‌های لگن را هدف می‌گیرد که کلید سلامت زانو و کمر هستند.",
 "wallsit": "اسکات دیواری یک حرکت ایزومتریک است که با تکیه به دیوار در زاویه‌ی ۹۰ درجه، استقامت چهارسر ران و پایداری تنه را می‌سازد. این نسخه‌ی دیواری اسکات، الگوی صحیح نشستن را هم برای بدن ثبت می‌کند.",
 "singlelegstance": "ایستاده تک‌پا بنیادی‌ترین تمرین تعادل است که روی یک پا با نگاه ثابت و بدن راست اجرا می‌شود. همین توان ساده پایه‌ی راه رفتن، بالا رفتن از پله و جلوگیری از افتادن در سالمندان است.",
 "heeltotoe": "راه‌رفتن پاشنه-پنجه یعنی پاشنه‌ی هر پا دقیقاً جلوی پنجه‌ی پای دیگر روی یک خط فرضی قرار گیرد. این تمرین تعادل پویا، هماهنگی عصبی-عضلانی و اطمینان در راه رفتن باریک را تقویت می‌کند.",
 "birddog": "پرنده-سگ با هم‌زمان بلند کردن دست و پای مخالف از حالت چهار دست و پا اجرا می‌شود. پایداری مرکزی، عضلات پشت و لگن را بدون فشار به ستون فقرات می‌سازد و برای اصلاح عدم تقارن عالی است.",
 "deadbug": "دد باگ در حالت خوابیده به پشت با پایین بردن هم‌زمان دست و پای مخالف اجرا می‌شود در حالی که کمر کامل به زمین چسبیده است. تمرین شماره‌ی یک برای تقویت شکم عمیق بدون فشار به ستون فقرات کمری است.",
 "sideplank": "پلانک جانبی بدن را روی یک آرنج نگه می‌دارد و عضلات پهلو، شانه و لگن را در برابر خم شدن جانبی مقاوم می‌سازد. برای پایداری کمر، سلامت شانه و قدرت مورب‌های شکم حیاتی است.",
 "sittostand": "بلند شدن از صندلی الگوی بنیادی نشستن و برخاستن در زندگی روزمره است که با دست روی سینه یا بدون کمک دست اجرا می‌شود. حفظ این الگو یعنی حفظ قدرت پا و استقلال حرکتی تا سنین بالا.",
 "singlelegdeadlift": "ددلیفت تک‌پا هیپ هینج را با تعادل روی یک پا ترکیب می‌کند و باسن، همسترینگ و پایداری لگن را هم‌زمان می‌سازد. یکی از کاربردی‌ترین ترانسفرهای تعادلی برای زندگی واقعی است.",
 "squattopress": "اسکات به پرس یا تراستر، اسکات با دمبل را به پرس سرشانه در یک حرکت پیوسته متصل می‌کند. یک ترکیب فانکشنال کامل بدن است که قدرت، تعادل و ضربان قلب را یکجا بالا می‌برد.",
 "lungerotation": "لانج با چرخش الگوی قدم برداشتن را با چرخش تنه ترکیب می‌کند و پاها و مورب‌های شکم را هم‌زمان درگیر می‌کند. شبیه‌ساز حرکات واقعی زندگی مثل برداشتن بار و چرخیدن به سمت اطراف است.",
 "rdl": "ددلیفت رومانیایی الگوی هیپ هینج با وزنه است که با عقب بردن لگن و کشیده شدن همسترینگ اجرا می‌شود. یادگیری درست آن پایه‌ی حرکات قدرتی و مهم‌ترین سپر در برابر کمردرد است.",
 "kbswing": "سوئینگ کتلبل یک هیپ هینج انفجاری است که کتلبل را با سوئیچ قدرتمند لگن تا سطح سینه پرتاب می‌کند. قدرت باسن، توان انفجاری و استقامت قلبی-عروقی را یکجا می‌سازد.",
 "ninetynine": "هیپ اوپنر ۹۰/۹۰ با چرخش خارجی و داخلی ران در زاویه‌ی ۹۰ درجه روی زمین اجرا می‌شود. برای بازگشایی سفتی مفصل ران ناشی از نشستن طولانی و بهبود عمق اسکات عالی است.",
 "openbook": "باز کردن کتاب چرخش قفسه‌ی سینه را در حالت خوابیده به پشت با حرکت دست مانند باز کردن در بازیابی می‌کند. زانوها روی زمین ثابت می‌مانند تا چرخش واقعاً از ستون فقرات بالایی بیاید.",
}

TIPS = {
 "hundred": "اگر درد گردن داشتید سر را پایین بیاورید و پاها را روی زمین بگذارید؛ شکم را در تمام مدت درگیر نگه دارید.",
 "rollup": "هرگز با شتاب و مومنتوم بالا نروید؛ اگر کنترل کافی ندارید زانوها را کمی خم کنید و با دست‌های کشیده تمرین کنید.",
 "shoulderbridge": "لگن را فقط تا سطح بدن بالا ببرید و از قوس کمر بپرهیزید؛ پاها زاویه‌ی ۹۰ درجه حفظ کنند.",
 "catcow": "حرکت را آهسته انجام دهید و گردن را در امتداد ستون فقرات نگه دارید؛ در ناحیه‌ی دردناک دامنه را کم کنید.",
 "swan": "قدرت بلند شدن باید از عضلات پشت بیاید نه فشار دادن دست‌ها؛ اگر فشار در کمر احساس کردید دامنه را کمتر کنید.",
 "teaser": "برای شروع یک زانو را خم نگه دارید یا از ساق‌ها حمایت بگیرید؛ با درد کمر این حرکت را انجام ندهید.",
 "singlelegstretch": "دست‌ها ساق پای کشیده را نگه می‌دارند نه اینکه گردن را بکشند؛ لگن در طول حرکت کاملاً ثابت بماند.",
 "legcircle": "دایره‌ها را کوچک نگه دارید و اجازه ندهید لگن از زمین بلند شود یا کمر قوس بگیرد.",
 "sidekick": "بالاتنه را در یک خط نگه دارید و اجازه ندهید بدن به جلو یا عقب غلت بخورد.",
 "wallsit": "زانوها نباید از پنجه‌ها جلوتر بروند و کل کمر باید به دیوار چسبیده بماند؛ با ۲۰ ثانیه شروع کنید.",
 "singlelegstance": "نزدیک دیوار یا صندلی تمرین کنید و نگاه را به یک نقطه‌ی ثابت در ارتفاع چشم بدوزید.",
 "heeltotoe": "در کنار دیوار یا نگاه‌دارنده‌ی ثابت تمرین کنید و اگر سرگیجه داشتید فوراً توقف کنید.",
 "birddog": "لگن را موازی زمین نگه دارید و پا را فقط تا ارتفاع لگن بلند کنید؛ از قوس کمر بپرهیزید.",
 "deadbug": "کمر پایین را کامل به زمین بچسبانید؛ اگر کمر برجسته شد فقط پاها یا فقط دست‌ها را حرکت دهید.",
 "sideplank": "آرنج دقیقاً زیر شانه قرار بگیرد و لگن تا پایان حرکت بالا بماند؛ با زانوهای خم نسخه‌ی ساده را تمرین کنید.",
 "sittostand": "وزن را روی پاشنه‌ها بیندازید و زانوها را با پنجه‌ها هم‌راستا نگه دارید؛ صندلی را به دیوار تکیه دهید.",
 "singlelegdeadlift": "پشت صاف بماند و حرکت از لگن شروع شود نه از خم شدن کمر؛ ابتدا بدون وزنه تمرین کنید.",
 "squattopress": "با وزنه‌ی سبک زنجیره‌ی حرکت را تثبیت کنید؛ کمر را در فاز پرس صاف و شکم را درگیر نگه دارید.",
 "lungerotation": "چرخش باید از تنه بیاید نه از زانو؛ زانوی جلو همیشه پشت پنجه بماند.",
 "rdl": "کمر را صاف و سینه را باز نگه دارید و وزنه را در تمام حرکت نزدیک بدن بکشید.",
 "kbswing": "با وزنه‌ی سبک فرم را یاد بگیرید؛ کتلبل را با بازو بلند نکنید، حرکت انفجار لگن است.",
 "ninetynine": "با تنه‌ی صاف و آهسته بچرخید؛ هرگز زانوها را با دست به‌زور به زمین فشار ندهید.",
 "openbook": "زانوی خم را با دست پایین نگه دارید تا چرخش از توراسیک بیاید؛ دامنه را بدون درد حفظ کنید.",
}

out = []
for mid, fa, en, muscle, secondary, equipment, category, pattern, difficulty, disciplines, core in META:
    v = vids.get(mid)
    assert v and v.get("videoId"), f"missing video for {mid}"
    name = f"{fa} ({en})"
    out.append({
        "en": en, "fa": fa, "name": name,
        "muscle": muscle, "secondary": secondary, "equipment": equipment,
        "category": category, "pattern": pattern, "difficulty": difficulty,
        "core": core, "disciplines": disciplines,
        "ytVideoId": v["videoId"], "ytTitle": v["ytTitle"], "ytChannel": v["ytChannel"],
        "description": DESC.get(mid, "") if core else "",
        "tips": TIPS.get(mid, "") if core else "",
    })

# dedupe by videoId
ids = [e["ytVideoId"] for e in out]
dups = {i for i in ids if ids.count(i) > 1}
assert not dups, f"duplicate video ids: {dups}"

json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print("entries:", len(out), "| core:", sum(1 for e in out if e["core"]), "| unique videos:", len(set(ids)))
