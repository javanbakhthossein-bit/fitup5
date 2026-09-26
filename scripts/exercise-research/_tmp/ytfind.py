#!/usr/bin/env python3
"""YouTube video finder: scrape YT search -> candidates -> prefer good channels -> oEmbed verify."""
import json, re, sys, time, urllib.request, urllib.parse, os

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

PREFERRED = ["calisthenicmovement", "athlean", "fitnessfaqs", "trx", "jeremy ethier", "jeff nippard",
             "fitness programer", "fitnessprogramer", "hybrid calisthenics", "thenx", "gmb fitness",
             "shredded sports science", "fitclub", "badankhooba", "tamrino", "chaghar",
             "سجاد رضایی", "hooman", "mehdikazemifit", "planted and brave", "tylerpath", "kinfix",
             "fitamin", "fitline", "squat couple", "national academy", "nasm", "live lean", "muscle & strength"]

def yt_search(query, n=14):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
    pairs = re.findall(r'"videoRenderer":\{"videoId":"([\w-]{11})".{0,600}?"title":\{"runs":\[\{"text":"(.*?)"', html)
    seen, out = set(), []
    for vid, t in pairs:
        if vid in seen: continue
        seen.add(vid)
        out.append((vid, t.encode().decode("unicode_escape", "ignore")))
        if len(out) >= n: break
    return out

def oembed(vid):
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read().decode())
            return {"videoId": vid, "title": d.get("title", ""), "channel": d.get("author_name", "")}
    except Exception:
        return None

def pick(cands, used):
    best, best_score = None, -10**9
    for i, (vid, title) in enumerate(cands):
        if vid in used: continue
        tl = title.lower()
        score = -i  # earlier = better
        blob = tl
        for ch in PREFERRED:
            if ch.lower().strip() in blob: score += 8
        if "#shorts" in tl or "shorts" in tl: score -= 4
        if "full workout" in tl or "workout music" in tl or "challenge" in tl: score -= 2
        if score > best_score: best_score, best = score, (vid, title)
    return best

def main(tasks_file, out_file, only=None):
    tasks = json.load(open(tasks_file))
    used = set()
    if os.path.exists(out_file):
        res = json.load(open(out_file))
        for v in res.values():
            if v: used.add(v["videoId"])
    else:
        res = {}
    for slug, query in tasks.items():
        if only and slug not in only: continue
        if res.get(slug): continue
        cands = []
        for attempt in range(2):
            try:
                cands = yt_search(query)
                if cands: break
            except Exception as e:
                print(f"  search error {slug}: {e}", flush=True)
                time.sleep(1.5)
        got = None
        for _ in range(4):
            best = pick(cands, used)
            if not best: break
            info = oembed(best[0])
            if info and info["title"]:
                got = info
                used.add(info["videoId"])
                break
            else:
                cands = [c for c in cands if c[0] != best[0]]
                time.sleep(0.4)
        res[slug] = got
        print(f"{slug}: {'OK ' + got['videoId'] + ' | ' + got['title'][:60] + ' | ' + got['channel'][:32] if got else 'MISS'}", flush=True)
        json.dump(res, open(out_file, "w"), ensure_ascii=False, indent=1)
        time.sleep(0.25)
    ok = sum(1 for v in res.values() if v)
    print(f"DONE ok={ok}/{len(tasks)}")

if __name__ == "__main__":
    tf, of = sys.argv[1], sys.argv[2]
    only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
    main(tf, of, only)
