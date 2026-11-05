# -*- coding: utf-8 -*-
"""Video pipeline: find + oEmbed-verify YouTube videos for group A exercises."""
import json, re, sys, time, subprocess, urllib.request, urllib.parse, os

BASE = "/home/z/my-project/scripts/exercise-research"
VERIFIED_PATH = os.path.join(BASE, "groupA_videos_verified.json")
MASTER = json.load(open(os.path.join(BASE, "groupA_master.json"), encoding="utf-8"))
EXISTING = json.load(open("/home/z/my-project/scripts/exercise-video-fixes.json", encoding="utf-8"))

# alias: my fa -> existing mapping key (project-verified videos from earlier stage)
ALIAS = {
    "پرس سینه دمبل": "پرس سینه با دمبل",
    "پرس بالا سینه هالتر": "پرس بالاسینه با هالتر",
    "پرس زیر سینه هالتر": "پرس زیرسینه با هالتر",
    "پرس سرشانه هالتر": "پرس سرشانه هالتر ایستاده",
    "پرس سرشانه دمبل": "پرس سرشانه با دمبل",
    "پرس سرشانه دستگاه": "پرس سرشانه ماشین",
    "پرس آرنولد": "آرنولد پرس",
    "نشر جانب سیم‌کش": "نشر جانب تک‌دست کابل",
    "نشر خم دمبل": "نشر خم دمبل سرشانه",
    "کراس اور سیم‌کش": "کراس‌اور سیم‌کش",
    "قفسه سینه سیم‌کش": "فلای سینه با سیم‌کش",
    "پشت بازو سیم‌کش طناب": "پشت بازو سیم‌کش طناب",
    "پشت بازو دمبل بالای سر": "پشت بازو بالای سر",
    "پارالل پشت بازو": "دیپس پشت‌بازو",
    "زیربغل سیم‌کش دست باز": "زیربغل سیم‌کش دست‌باز",
    "زیربغل سیم‌کش دست جمع": "زیربغل سیم‌کش دست‌جمع",
    "زیربغل سیم‌کش دست صاف": "زیربغل سیم‌کش دست‌صاف",
    "زیربغل سیم‌کش تک‌دست": "زیربغل سیم‌کش تک‌دست",
    "زیربغل دمبل تک‌دست": "زیربغل دمبل تک‌دست",
    "زیربغل تی‌بار": "زیربغل تی‌بار",
    "زیربغل قایقی دستگاه": "زیربغل قایقی نشسته",
    "زیربغل پندلی": "زیربغل پندلی سریع",
    "لانژ راه‌رفتنی دمبل": "لانگز پیاده‌روی با دمبل",
    "استپ‌آپ دمبل": "استپ‌آپ",
    "اسکوات جلو": "اسکوات جلو هالتر",
    "اسکوات بلغاری": "اسکوات بلغاری دمبل",
    "هاک اسکوات دستگاه": "اسکوات هاک",
    "پشت پا دستگاه خوابیده": "پشت ران ماشین خوابیده",
    "پشت پا دستگاه نشسته": "پشت ران ماشین نشسته",
    "جلو پا دستگاه": "جلوی پا دستگاه",
    "ساق ایستاده دستگاه": "ساق پا ایستاده",
    "بالا آوردن پا آویزان (بارفیکس)": "بالا آوردن پا آویزان",
    "بالا آوردن پا خوابیده": "بالا آوردن پا خوابیده",
    "کرانچ سیم‌کش": "کرانچ سیم‌کش",
    "کرانچ معکوس": "کرانچ معکوس",
    "کرانچ دوچرخه": "کرانچ دوچرخه",
    "روسی توئیست": "روسیان توئیست",
    "هایپراکستنشن": "هایپراکستنشن",
    "گود مورنینگ": "گود مورنینگ",
    "پرس سینه دستگاه": "پرس سینه دستگاه",
    "اسکوات گابلت": "اسکوات گابلت",
    "سوئینگ کتل‌بل": "کیتل‌بل سوئینگ",
    "فیس‌پول": "فیس پول سرشانه",
}

def norm(s):
    return re.sub(r"[\s\u200c\u200e\u200fـ\-ـ]+", "", s or "")

def lookup_existing(fa):
    keys = [fa] + [ALIAS.get(fa, "")]
    for k in keys:
        if not k:
            continue
        if k in EXISTING:
            return EXISTING[k]
    nf = norm(fa)
    for k, v in EXISTING.items():
        if norm(k) == nf:
            return v
    return None


def yt_search_ids(query, limit=12):
    """Scrape YouTube search results page for (videoId, title) pairs."""
    try:
        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
        r = subprocess.run(["curl", "-s", "--max-time", "20", "-H",
                            "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                            "-H", "Accept-Language: en", url], capture_output=True, timeout=30)
        h = r.stdout.decode("utf-8", "ignore")
        out = []
        for m in re.finditer(r'"videoId":"([A-Za-z0-9_-]{11})".{0,700}?"title":\{"runs":\[\{"text":"(.*?)"\}\]', h, re.S):
            vid, ti = m.group(1), m.group(2).encode().decode("unicode_escape", "ignore")
            ti = ti.replace("\\u0026", "&")
            if vid not in [o[0] for o in out]:
                out.append((vid, ti))
            if len(out) >= limit:
                break
        return out
    except Exception:
        return []

def search(query, num=10):
    fn = "/tmp/vp_" + re.sub(r"\W+", "_", norm(query))[:60] + ".json"
    try:
        subprocess.run(["z-ai", "function", "-n", "web_search", "-a",
                        json.dumps({"query": query, "num": num}), "-o", fn],
                       capture_output=True, timeout=90)
        d = json.load(open(fn, encoding="utf-8"))
        return d if isinstance(d, list) else []
    except Exception:
        return []

YT_ID = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")

def extract_ids(results):
    ids = []
    for r in results:
        for m in YT_ID.finditer(r.get("url", "")):
            if m.group(1) not in ids:
                ids.append(m.group(1))
        # also check name for youtu links
        for m in YT_ID.finditer(r.get("name", "")):
            if m.group(1) not in ids:
                ids.append(m.group(1))
    return ids

def oembed(vid):
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote(
        "https://www.youtube.com/watch?v=" + vid, safe="") + "&format=json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as f:
            d = json.loads(f.read().decode("utf-8"))
            return {"videoId": vid, "title": d.get("title", ""), "channel": d.get("author_name", "")}
    except Exception:
        return None

def title_ok(e, title):
    t = (title or "").lower()
    if not t:
        return False
    persian_hit = False
    fa_core = re.sub(r"\([^)]*\)", "", e["fa"]).strip()
    fa_words = [w for w in re.split(r"[\s/]+", fa_core) if len(w) > 2]
    if fa_words:
        phrase = norm("".join(fa_words[:3]))
        persian_hit = phrase in norm(title)
    mt_hit = any(m in t for m in [x.lower() for x in e["mt"]])
    if e["mt_all"]:
        mt_all_hit = all(m in t for m in [x.lower() for x in e["mt_all"]])
    else:
        mt_all_hit = False
    base_ok = mt_hit or mt_all_hit or persian_hit
    if not base_ok:
        return False
    if any(x.lower() in t for x in e["xt"]):
        return False
    return True

def main(start, end):
    verified = {}
    if os.path.exists(VERIFIED_PATH):
        verified = json.load(open(VERIFIED_PATH, encoding="utf-8"))
    used_ids = {v["videoId"] for v in verified.values()}
    todo = MASTER[start:end]
    for e in todo:
        en = e["en"]
        if en in verified:
            continue
        fa_core = re.sub(r"\([^)]*\)", "", e["fa"]).strip()
        fa_q = "آموزش " + " ".join(fa_core.split()[:4]) + " یوتیوب"
        query_sets = []
        if e.get("q"):
            query_sets.append([e["q"]])
        query_sets.append([e["en"] + " proper form", e["en"] + " exercise form tutorial"])
        query_sets.append([fa_q])
        query_sets.append([e["en"] + " site:youtube.com"])
        got = None
        for qs in query_sets:
            cands = []
            ex = lookup_existing(e["fa"])
            if ex and ex.get("videoId") and not cands:
                cands.append(ex["videoId"])
            for q in qs:
                for vid, _ti in yt_search_ids(q):
                    if vid not in cands:
                        cands.append(vid)
                for vid in extract_ids(search(q)):
                    if vid not in cands:
                        cands.append(vid)
            for vid in cands:
                if vid in used_ids:
                    continue
                o = oembed(vid)
                if o and title_ok(e, o["title"]):
                    got = o
                    break
                time.sleep(0.15)
            if got:
                break
        if got:
            verified[en] = got
            used_ids.add(got["videoId"])
            print("OK  ", en, "->", got["videoId"], "|", got["title"][:60])
        else:
            print("FAIL", en, "| cands:", cands[:5])
        json.dump(verified, open(VERIFIED_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("verified total:", len(verified))

if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
