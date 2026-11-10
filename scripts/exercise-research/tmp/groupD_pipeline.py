#!/usr/bin/env python3
"""Group D: search YouTube for each exercise, verify via oEmbed, save mapping."""
import json, subprocess, re, sys, time, urllib.parse

SPEC = [
 # id, en, fa, search query
 ("hundred","Pilates Hundred","صد پیلاتس","pilates hundred exercise how to Blogilates"),
 ("rollup","Roll Up","رول‌آپ","pilates roll up exercise how to tutorial"),
 ("rollover","Roll Over","رول‌اور","pilates roll over exercise how to"),
 ("legcircle","Single Leg Circle","دایره تک‌پا","pilates single leg circle how to"),
 ("rollingball","Rolling Like a Ball","غلتک مثل توپ","pilates rolling like a ball tutorial"),
 ("singlelegstretch","Single Leg Stretch","کشش تک‌پا","pilates single leg stretch how to"),
 ("singlestraightleg","Single Straight Leg Stretch","کشش تک‌پای صاف","pilates single straight leg stretch scissors"),
 ("doublelegstretch","Double Leg Stretch","کشش دوپا","pilates double leg stretch how to"),
 ("lowerlift","Double Straight Leg Lower Lift","پایین و بالا بردن دوپای صاف","pilates double straight leg lower lift how to"),
 ("crisscross","Criss-Cross","کراس‌کراس","pilates criss cross ab exercise how to"),
 ("spinestretch","Spine Stretch Forward","کشش ستون فقرات رو به جلو","pilates spine stretch forward how to"),
 ("saw","Saw","اره","pilates saw exercise how to"),
 ("spinetwist","Spine Twist","چرخش ستون فقرات نشسته","pilates spine twist seated how to"),
 ("swan","Swan","قو","pilates swan exercise how to"),
 ("swimming","Swimming","شناوری پیلاتس","pilates swimming exercise how to"),
 ("teaser","Teaser","تیزر","pilates teaser how to tutorial"),
 ("shoulderbridge","Shoulder Bridge","پل شانه","pilates shoulder bridge exercise how to"),
 ("pelviccurl","Pelvic Curl","چرخش لگن","pilates pelvic curl how to"),
 ("sidekick","Side Kick","ساید کیک","pilates side kick exercise how to"),
 ("kneelingsidekick","Kneeling Side Kick","ساید کیک زانوزده","pilates kneeling side kick how to"),
 ("chestlift","Chest Lift","لیفت سینه","pilates chest lift how to"),
 ("doublelegkick","Double Leg Kick","ضربه دوپا","pilates double leg kick how to"),
 ("legpullfront","Leg Pull Front","پل با ضربه پا","pilates leg pull front exercise how to"),
 ("sidebend","Side Bend","خم جانبی","pilates side bend exercise how to"),
 ("jackknife","Jackknife","جک‌نایف","pilates jackknife how to"),
 ("pilatespushup","Pilates Push-Up","شنا پیلاتس","pilates push up exercise how to"),
 ("catcow","Cat-Cow","سگ-گربه","cat cow stretch how to yoga"),
 ("deadbug","Dead Bug","دد باگ","dead bug exercise how to"),
 ("birddog","Bird Dog","پرنده-سگ","bird dog exercise how to"),
 ("sideplank","Side Plank","پلانک جانبی","side plank exercise how to"),
 ("wallpushup","Wall Push-Up","شنا دیواری","wall push up exercise how to"),
 ("wallplank","Wall Plank","پلانک دیواری","wall plank exercise how to"),
 ("wallbridge","Wall Pilates Bridge","پل دیواری","wall pilates bridge exercise how to"),
 ("wallrolldown","Wall Roll-Down","رول‌داون دیواری","wall pilates roll down exercise"),
 ("wallsit","Wall Sit","اسکات دیواری","wall sit exercise how to"),
 ("singlelegstance","Single Leg Stance","ایستاده تک‌پا","single leg stance balance exercise how to"),
 ("heeltotoe","Heel-to-Toe Walk","راه‌رفتن پاشنه-پنجه","heel to toe walking balance exercise seniors"),
 ("tandemstance","Tandem Stance","ایست تعادلی پاشنه-پنجه","tandem stance balance exercise"),
 ("weightshift","Weight Shift","انتقال وزن","weight shifting balance exercise"),
 ("heelraise","Heel Raise","بلند کردن پاشنه","heel raise exercise balance how to"),
 ("sittostand","Sit-to-Stand","بلند شدن از صندلی","sit to stand exercise how to seniors"),
 ("singlelegdeadlift","Single-Leg Deadlift","ددلیفت تک‌پا","single leg deadlift how to"),
 ("squattopress","Squat to Press","اسکات به پرس","dumbbell squat to press how to"),
 ("lungerotation","Lunge with Rotation","لانج با چرخش","lunge with rotation exercise how to"),
 ("rdl","Romanian Deadlift","ددلیفت رومانیایی","romanian deadlift dumbbell how to"),
 ("kbswing","Kettlebell Swing","سوئینگ کتلبل","kettlebell swing how to"),
 ("farmerscarry","Farmer's Carry","حمل بار کشاورز","farmer carry exercise how to"),
 ("woodchop","Wood Chop","هاشور چوبی","dumbbell wood chop exercise how to"),
 ("bearcrawl","Bear Crawl","خزیدن خرسی","bear crawl exercise how to"),
 ("gobletsquat","Goblet Squat","اسکات گابلت","goblet squat how to"),
 ("stepup","Step-Up","استپ‌آپ","step up exercise how to"),
 ("glutebridge","Glute Bridge","پل باسن","glute bridge exercise how to"),
 ("walkinglunge","Walking Lunge","لانج راه‌رونده","walking lunge how to"),
 ("turkishgetup","Turkish Get-Up","ترکیش گت‌آپ","turkish get up how to"),
 ("ninetynine","90/90 Hip Opener","هیپ اوپنر ۹۰/۹۰","90/90 hip stretch how to"),
 ("openbook","Open Book Thoracic Rotation","باز کردن کتاب","open book thoracic rotation stretch how to"),
 ("wgs","World's Greatest Stretch","بزرگ‌ترین حرکت جهان","world's greatest stretch how to"),
 ("hipflexor","Kneeling Hip Flexor Stretch","کشش فلکسور هیپ زانوزده","kneeling hip flexor stretch how to"),
 ("threadneedle","Thread the Needle","نخ در سوزن","thread the needle stretch how to"),
 ("wallslide","Scapular Wall Slide","اسلاید سرشانه دیواری","scapular wall slide how to"),
 ("kneetowall","Knee-to-Wall Ankle Mobility","موبیلیتی مچ پا زانو به دیوار","knee to wall ankle mobility how to"),
 ("pelvictilt","Pelvic Tilt","تیلت لگن","pelvic tilt exercise how to"),
 ("childspose","Child's Pose","ژست کودک","child's pose stretch how to"),
]

YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?[^\"'\s]*v=|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})")

def oembed(vid):
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid, safe="") + "&format=json"
    try:
        r = subprocess.run(["curl","-s","--max-time","15",url], capture_output=True, text=True, timeout=25)
        if r.returncode == 0 and r.stdout.strip().startswith("{"):
            d = json.loads(r.stdout)
            if "title" in d and "author_name" in d:
                return d["title"], d["author_name"]
    except Exception:
        pass
    return None

def search(query):
    out = f"/home/z/my-project/scripts/exercise-research/tmp/s_{abs(hash(query))%999999}.json"
    cmd = ["z-ai","function","-n","web_search","-a", json.dumps({"query": query, "num": 8}), "-o", out]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        return json.load(open(out))
    except Exception as e:
        print("   search fail:", e)
        return []

mapping = {}
if __name__ == "__main__":
    args = sys.argv[1:]
    only = set(args)
    for eid, en, fa, q in SPEC:
        if only and eid not in only: continue
        cands = []
        for res in search(q):
            for m in YT_RE.finditer(res.get("url","") + " " + res.get("name","")):
                cands.append(m.group(1))
        seen, uniq = set(), []
        for c in cands:
            if c not in seen: seen.add(c); uniq.append(c)
        got = None
        for vid in uniq[:5]:
            r = oembed(vid)
            if r:
                got = (vid, r[0], r[1]); break
        if got:
            mapping[eid] = {"en": en, "fa": fa, "videoId": got[0], "ytTitle": got[1], "ytChannel": got[2]}
            print(f"OK   {eid:20s} {got[0]}  [{got[2]}] {got[1][:70]}")
        else:
            mapping[eid] = {"en": en, "fa": fa, "videoId": None}
            print(f"FAIL {eid:20s} ({en})")
        json.dump(mapping, open("/home/z/my-project/scripts/exercise-research/tmp/groupD_videos.json","w"), ensure_ascii=False, indent=1)
