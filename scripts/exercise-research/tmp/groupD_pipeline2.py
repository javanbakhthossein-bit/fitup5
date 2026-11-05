#!/usr/bin/env python3
"""Group D v2: YouTube search-page scrape -> candidate ranking -> oEmbed verify."""
import json, subprocess, re, sys, time, urllib.parse, html

TMP = "/home/z/my-project/scripts/exercise-research/tmp"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

SPEC = [
 # id, en, fa, yt search query, title keywords (lowercase, any-of boost), channel boost substrings
 ("hundred","Pilates Hundred","صد پیلاتس","pilates hundred exercise how to","hundred","blogilates|pilates anytime|howcast"),
 ("rollup","Roll Up","رول‌آپ","pilates roll up exercise how to","roll up","pilates anytime|howcast|blogilates"),
 ("rollover","Roll Over","رول‌اور","pilates roll over exercise how to","roll over","pilates anytime|howcast"),
 ("legcircle","Single Leg Circle","دایره تک‌پا","pilates single leg circle how to","single leg circle|leg circle","pilates anytime|howcast"),
 ("rollingball","Rolling Like a Ball","غلتک مثل توپ","pilates rolling like a ball how to","rolling like a ball","pilates anytime|howcast|blogilates"),
 ("singlelegstretch","Single Leg Stretch","کشش تک‌پا","pilates single leg stretch how to","single leg stretch","pilates anytime|howcast|blogilates"),
 ("singlestraightleg","Single Straight Leg Stretch","کشش تک‌پای صاف","pilates single straight leg stretch how to","straight leg","pilates anytime|howcast|blogilates"),
 ("doublelegstretch","Double Leg Stretch","کشش دوپا","pilates double leg stretch how to","double leg stretch","pilates anytime|howcast|blogilates"),
 ("lowerlift","Double Straight Leg Lower Lift","پایین و بالا بردن دوپای صاف","pilates double leg lower lift how to","lower lift|lower lift","pilates anytime|howcast"),
 ("crisscross","Criss-Cross","کراس‌کراس","pilates criss cross exercise how to","criss cross","pilates anytime|howcast|blogilates"),
 ("spinestretch","Spine Stretch Forward","کشش ستون فقرات رو به جلو","pilates spine stretch forward how to","spine stretch","pilates anytime|howcast|blogilates"),
 ("saw","Saw","اره","pilates saw exercise how to","saw","pilates anytime|howcast|blogilates"),
 ("spinetwist","Spine Twist","چرخش ستون فقرات نشسته","pilates spine twist seated how to","spine twist","pilates anytime|howcast"),
 ("swan","Swan","قو","pilates swan exercise how to","swan","pilates anytime|howcast|blogilates"),
 ("swimming","Swimming","شناوری پیلاتس","pilates swimming exercise how to","swimming","pilates anytime|howcast|blogilates"),
 ("teaser","Teaser","تیزر","pilates teaser exercise how to","teaser","pilates anytime|howcast|blogilates"),
 ("shoulderbridge","Shoulder Bridge","پل شانه","pilates shoulder bridge exercise how to","shoulder bridge","pilates anytime|howcast|blogilates"),
 ("pelviccurl","Pelvic Curl","چرخش لگن","pilates pelvic curl how to","pelvic curl","pilates anytime|howcast"),
 ("sidekick","Side Kick","ساید کیک","pilates side kick exercise how to","side kick","pilates anytime|howcast|blogilates"),
 ("kneelingsidekick","Kneeling Side Kick","ساید کیک زانوزده","pilates kneeling side kick how to","kneeling side kick","pilates anytime|howcast"),
 ("chestlift","Chest Lift","لیفت سینه","pilates chest lift how to","chest lift","pilates anytime|howcast"),
 ("doublelegkick","Double Leg Kick","ضربه دوپا","pilates double leg kick how to","double leg kick","pilates anytime|howcast"),
 ("legpullfront","Leg Pull Front","پل با ضربه پا","pilates leg pull front how to","leg pull","pilates anytime|howcast"),
 ("sidebend","Side Bend","خم جانبی","pilates side bend exercise how to","side bend","pilates anytime|howcast"),
 ("jackknife","Jackknife","جک‌نایف","pilates jackknife exercise how to","jackknife","pilates anytime|howcast"),
 ("pilatespushup","Pilates Push-Up","شنا پیلاتس","pilates push up exercise how to","push up","pilates anytime|howcast"),
 ("catcow","Cat-Cow","سگ-گربه","cat cow stretch how to","cat cow","yoga with adriene|howcast|madfit"),
 ("deadbug","Dead Bug","دد باگ","dead bug core exercise how to","dead bug","bob and brad|tone and tighten|athlean"),
 ("birddog","Bird Dog","پرنده-سگ","bird dog core exercise how to","bird dog","bob and brad|tone and tighten|athlean"),
 ("sideplank","Side Plank","پلانک جانبی","side plank exercise how to","side plank","bob and brad|athlean|howcast"),
 ("wallpushup","Wall Push-Up","شنا دیواری","wall push up exercise how to","wall push","bob and brad|tone and tighten"),
 ("wallplank","Wall Plank","پلانک دیواری","wall plank exercise how to","wall plank","plank"),
 ("wallbridge","Wall Pilates Bridge","پل دیواری","wall pilates bridge exercise how to","wall bridge|bridge","pilates|wall"),
 ("wallrolldown","Wall Roll-Down","رول‌داون دیواری","wall pilates roll down exercise","roll down","pilates|wall"),
 ("wallsit","Wall Sit","اسکات دیواری","wall sit exercise how to","wall sit","bob and brad|tone and tighten"),
 ("singlelegstance","Single Leg Stance","ایستاده تک‌پا","single leg stance balance exercise how to","single leg","more life health|bob and brad"),
 ("heeltotoe","Heel-to-Toe Walk","راه‌رفتن پاشنه-پنجه","heel to toe walk balance exercise","heel to toe","more life health|bob and brad|nhs"),
 ("tandemstance","Tandem Stance","ایست تعادلی پاشنه-پنجه","tandem stance balance exercise","tandem","bob and brad|more life health"),
 ("weightshift","Weight Shift","انتقال وزن","weight shifting balance exercise","weight shift","more life health|bob and brad"),
 ("heelraise","Heel Raise","بلند کردن پاشنه","heel raise exercise balance how to","heel raise","bob and brad|tone and tighten"),
 ("sittostand","Sit-to-Stand","بلند شدن از صندلی","sit to stand exercise how to","sit to stand|chair stand","more life health|bob and brad"),
 ("singlelegdeadlift","Single-Leg Deadlift","ددلیفت تک‌پا","single leg deadlift how to","single leg deadlift","athlean|bob and brad"),
 ("squattopress","Squat to Press","اسکات به پرس","dumbbell squat to press how to","squat to press|thrust","athlean|jeff nippard"),
 ("lungerotation","Lunge with Rotation","لانج با چرخش","lunge with rotation exercise how to","rotation","athlean|bob and brad"),
 ("rdl","Romanian Deadlift","ددلیفت رومانیایی","dumbbell romanian deadlift how to","romanian deadlift|rdl","jeff nippard|athlean"),
 ("kbswing","Kettlebell Swing","سوئینگ کتلبل","kettlebell swing how to","swing","onnit|athlean"),
 ("farmerscarry","Farmer's Carry","حمل بار کشاورز","farmer carry exercise how to","farmer","athlean|buff dudes|alan thrall"),
 ("woodchop","Wood Chop","هاشور چوبی","wood chop exercise how to","wood chop|woodchop","athlean|buff dudes"),
 ("bearcrawl","Bear Crawl","خزیدن خرسی","bear crawl exercise how to","bear crawl","athlean|onnit"),
 ("gobletsquat","Goblet Squat","اسکات گابلت","goblet squat how to","goblet","athlean|jeff nippard"),
 ("stepup","Step-Up","استپ‌آپ","step up exercise how to","step up","athlean|bob and brad"),
 ("glutebridge","Glute Bridge","پل باسن","glute bridge exercise how to","glute bridge","athlean|bob and brad|jeff nippard"),
 ("walkinglunge","Walking Lunge","لانج راه‌رونده","walking lunge how to","walking lunge","athlean|buff dudes"),
 ("turkishgetup","Turkish Get-Up","ترکیش گت‌آپ","turkish get up how to","turkish","onnit|athlean"),
 ("ninetynine","90/90 Hip Opener","هیپ اوپنر ۹۰/۹۰","90 90 hip stretch how to","90/90|90 90","clevelandclinic|tom merrick|precision movement"),
 ("openbook","Open Book Thoracic Rotation","باز کردن کتاب","open book thoracic rotation stretch","open book","precision movement|bob and brad"),
 ("wgs","World's Greatest Stretch","بزرگ‌ترین حرکت جهان","world's greatest stretch how to","greatest stretch","athlean|tom merrick"),
 ("hipflexor","Kneeling Hip Flexor Stretch","کشش فلکسور هیپ زانوزده","kneeling hip flexor stretch how to","hip flexor","bob and brad|tone and tighten"),
 ("threadneedle","Thread the Needle","نخ در سوزن","thread the needle stretch how to","thread the needle","yoga with adriene|bob and brad"),
 ("wallslide","Scapular Wall Slide","اسلاید سرشانه دیواری","scapular wall slide how to","wall slide","bob and brad|athlean|precision movement"),
 ("kneetowall","Knee-to-Wall Ankle Mobility","موبیلیتی مچ پا زانو به دیوار","knee to wall ankle mobility how to","knee to wall|ankle","precision movement|squat university|bob and brad"),
 ("pelvictilt","Pelvic Tilt","تیلت لگن","pelvic tilt exercise how to","pelvic tilt","bob and brad|tone and tighten"),
 ("childspose","Child's Pose","ژست کودک","child's pose stretch how to","child's pose","yoga with adriene|howcast"),
]

def yt_search(query, n=14):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query) + "&sp=EgIQAQ%253D%253D"  # videos only filter
    r = subprocess.run(["curl","-s","--max-time","25","-H",f"User-Agent: {UA}","-H","Accept-Language: en-US,en;q=0.9",url], capture_output=True, text=True, timeout=40)
    page = r.stdout
    out, seen = [], set()
    # walk videoRenderer blocks
    for m in re.finditer(r'"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?(?="videoRenderer"|"richItemRenderer"|\Z)', page):
        vid = m.group(1)
        if vid in seen: continue
        block = m.group(0)[:4000]
        t = re.search(r'"title":\{"runs":\[\{"text":"(.*?)"\}', block)
        ch = re.search(r'"ownerText":\{"runs":\[\{"text":"(.*?)"\}', block) or re.search(r'"longBylineText":\{"runs":\[\{"text":"(.*?)"\}', block)
        title = html.unescape(t.group(1)) if t else ""
        channel = html.unescape(ch.group(1)) if ch else ""
        if vid not in seen:
            seen.add(vid)
            out.append({"videoId": vid, "title": title, "channel": channel})
        if len(out) >= n: break
    return out

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

def pick(eid, en, fa, query, keywords, chan_boost):
    cands = yt_search(query)
    scored = []
    for c in cands:
        tl = (c["title"] or "").lower(); cl = (c["channel"] or "").lower()
        s = 0
        for kw in keywords.split("|"):
            if kw in tl: s += 4
        for cb in chan_boost.split("|"):
            if cb in cl: s += 5
        if "short" in tl: s -= 1
        if len(tl) > 100: s -= 1
        scored.append((s, c))
    scored.sort(key=lambda x: -x[0])
    for s, c in scored[:4]:
        r = oembed(c["videoId"])
        if r:
            return {"videoId": c["videoId"], "ytTitle": r[0], "ytChannel": r[1], "score": s, "scrapeTitle": c["title"]}
    return None

if __name__ == "__main__":
    mapping = {}
    import os
    mfile = TMP + "/groupD_videos.json"
    if os.path.exists(mfile):
        mapping = json.load(open(mfile))
    only = set(sys.argv[1:])
    for eid, en, fa, q, kws, cb in SPEC:
        if only and eid not in only: continue
        if mapping.get(eid, {}).get("videoId") and eid in only or (mapping.get(eid,{}).get("videoId") and not only):
            continue
        best = None
        for attempt in range(2):
            best = pick(eid, en, fa, q, kws, cb)
            if best: break
            time.sleep(3)
        if best:
            mapping[eid] = {"en": en, "fa": fa, **best}
            print(f"OK   {eid:20s} {best['videoId']} s={best['score']} [{best['ytChannel'][:32]}] {best['ytTitle'][:64]}")
        else:
            mapping[eid] = {"en": en, "fa": fa, "videoId": None}
            print(f"FAIL {eid:20s} ({en})")
        json.dump(mapping, open(mfile, "w"), ensure_ascii=False, indent=1)
        time.sleep(1.2)
