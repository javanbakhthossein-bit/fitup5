# -*- coding: utf-8 -*-
"""Assemble + validate groupA-gym.json (FitUp task 2-a)."""
import json, re, urllib.request, urllib.parse, os

BASE = "/home/z/my-project/scripts/exercise-research"
MASTER = json.load(open(os.path.join(BASE, "groupA_master.json"), encoding="utf-8"))
VERIFIED = json.load(open(os.path.join(BASE, "groupA_videos_verified.json"), encoding="utf-8"))

EQUIP = {"barbell","dumbbell","machine","cable","bodyweight","kettlebell","band","bench","smith","other"}
CAT = {"push","pull","legs","core","cardio","fullbody"}
DIFF = {"beginner","intermediate","advanced"}
MUSCLE = {"سینه","سرشانه","پشت","جلو بازو","پشت بازو","پا","باسن","ساق","شکم","کل بدن","گردن و کول"}
DISC = {"bodybuilding","fitness","classic_physique","mens_physique","wellness","bikini_fitness","womens_fitness","womens_physique","general"}

out, errs, seen_ids = [], [], {}
for e in MASTER:
    en = e["en"]
    v = VERIFIED.get(en)
    if not v or not v.get("videoId") or not v.get("title"):
        errs.append(f"missing video: {en}")
        continue
    vid = v["videoId"]
    if vid in seen_ids:
        errs.append(f"duplicate videoId {vid}: {en} vs {seen_ids[vid]}")
        continue
    seen_ids[vid] = en
    if e["equipment"] not in EQUIP: errs.append(f"bad equipment {en}: {e['equipment']}")
    if e["category"] not in CAT: errs.append(f"bad category {en}: {e['category']}")
    if e["difficulty"] not in DIFF: errs.append(f"bad difficulty {en}: {e['difficulty']}")
    if e["muscle"] not in MUSCLE: errs.append(f"bad muscle {en}: {e['muscle']}")
    if not set(e["disciplines"]) <= DISC: errs.append(f"bad disciplines {en}")
    if e["core"] and (not e["desc"] or not e["tips"]): errs.append(f"core missing desc/tips: {en}")
    if not e["core"] and (e["desc"] or e["tips"]): errs.append(f"non-core has desc/tips: {en}")
    item = {
        "en": en, "fa": e["fa"], "name": f"{e['fa']} ({en})",
        "muscle": e["muscle"], "secondary": e["secondary"],
        "equipment": e["equipment"], "category": e["category"],
        "pattern": e["pattern"], "difficulty": e["difficulty"],
        "core": e["core"], "disciplines": e["disciplines"],
        "ytVideoId": vid, "ytTitle": v["title"], "ytChannel": v.get("channel", ""),
        "description": e["desc"] if e["core"] else "",
        "tips": e["tips"] if e["core"] else "",
    }
    out.append(item)

# fresh full oEmbed re-verification of every recorded video
recheck_fail = []
for it in out:
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote(
        "https://www.youtube.com/watch?v=" + it["ytVideoId"], safe="") + "&format=json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as f:
            d = json.loads(f.read().decode("utf-8"))
        if d.get("title") != it["ytTitle"] or d.get("author_name") != it["ytChannel"]:
            recheck_fail.append((it["en"], "mismatch", d.get("title"), it["ytTitle"]))
    except Exception as ex:
        recheck_fail.append((it["en"], "oembed_error", str(ex)[:60], it["ytVideoId"]))

json.dump(out, open(os.path.join(BASE, "groupA-gym.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("errors:", len(errs))
for x in errs: print(" -", x)
print("oEmbed recheck failures:", len(recheck_fail))
for x in recheck_fail: print(" -", x)
print("total:", len(out), "| core:", sum(1 for i in out if i["core"]))
mus = {}
for i in out: mus[i["muscle"]] = mus.get(i["muscle"], 0) + 1
print("by muscle:", json.dumps(mus, ensure_ascii=False))
eq = {}
for i in out: eq[i["equipment"]] = eq.get(i["equipment"], 0) + 1
print("by equipment:", json.dumps(eq, ensure_ascii=False))
