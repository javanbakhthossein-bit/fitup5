#!/usr/bin/env python3
"""Batch2 helper: scrape YouTube search candidates (videoId+title+channel), cache, print compact list."""
import json, re, sys, time, os, urllib.request, urllib.parse

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
BASE = os.path.dirname(os.path.abspath(__file__))

def yt_search(query, n=12):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    html = urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "ignore")
    out, seen = [], set()
    # grab each videoRenderer block up to 1500 chars, pull id/title/channel
    for m in re.finditer(r'"videoRenderer":\{"videoId":"([\w-]{11})".{0,2000}?"title":\{"runs":\[\{"text":"(.*?)"\}\].{0,3000}?"ownerText":\{"runs":\[\{"text":"(.*?)"', html):
        vid, t, ch = m.group(1), m.group(2), m.group(3)
        if vid in seen: continue
        seen.add(vid)
        t = t.encode().decode("unicode_escape", "ignore")
        ch = ch.encode().decode("unicode_escape", "ignore")
        out.append({"id": vid, "title": t, "channel": ch})
        if len(out) >= n: break
    return out

def main(tasks_file, cache_file, only=None):
    tasks = json.load(open(tasks_file))
    cache = json.load(open(cache_file)) if os.path.exists(cache_file) else {}
    for slug, q in tasks.items():
        if only and slug not in only: continue
        if slug in cache and cache[slug]: continue
        cands = []
        for attempt in range(2):
            try:
                cands = yt_search(q); break
            except Exception as e:
                print(f"ERR {slug}: {e}", flush=True); time.sleep(2)
        cache[slug] = cands
        json.dump(cache, open(cache_file, "w"), ensure_ascii=False, indent=1)
        print(f"== {slug} | {q} | {len(cands)} cands", flush=True)
        time.sleep(0.4)
    # print compact review
    for slug in (only or list(tasks.keys())):
        cands = cache.get(slug) or []
        print(f"### {slug} :: {tasks[slug]}")
        for i, c in enumerate(cands):
            print(f"  {i} {c['id']} | {c['title'][:85]} | {c['channel'][:40]}")

if __name__ == "__main__":
    only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
    main(sys.argv[1], sys.argv[2], only)
