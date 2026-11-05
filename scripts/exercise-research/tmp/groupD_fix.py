#!/usr/bin/env python3
"""Fix specific exercises with better queries; print top candidates for manual pick."""
import json, subprocess, re, sys, time, urllib.parse, html
TMP = "/home/z/my-project/scripts/exercise-research/tmp"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

def yt_search(query, n=12):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query) + "&sp=EgIQAQ%253D%253D"
    r = subprocess.run(["curl","-s","--max-time","25","-H",f"User-Agent: {UA}","-H","Accept-Language: en-US,en;q=0.9",url], capture_output=True, text=True, timeout=40)
    page = r.stdout
    out, seen = [], set()
    for m in re.finditer(r'"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?(?="videoRenderer"|"richItemRenderer"|\Z)', page):
        vid = m.group(1)
        block = m.group(0)[:4000]
        t = re.search(r'"title":\{"runs":\[\{"text":"(.*?)"\}', block)
        ch = re.search(r'"ownerText":\{"runs":\[\{"text":"(.*?)"\}', block) or re.search(r'"longBylineText":\{"runs":\[\{"text":"(.*?)"\}', block)
        title = html.unescape(t.group(1)) if t else ""
        channel = html.unescape(ch.group(1)) if ch else ""
        if vid in seen: continue
        seen.add(vid); out.append({"videoId": vid, "title": title, "channel": channel})
        if len(out) >= n: break
    return out

def oembed(vid):
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid, safe="") + "&format=json"
    r = subprocess.run(["curl","-s","--max-time","15",url], capture_output=True, text=True, timeout=25)
    if r.returncode == 0 and r.stdout.strip().startswith("{"):
        d = json.loads(r.stdout)
        if "title" in d: return d["title"], d["author_name"]
    return None

JOBS = json.load(open(TMP + "/fix_jobs.json"))
mapping = json.load(open(TMP + "/groupD_videos.json"))
for eid, queries in JOBS.items():
    done = False
    for q in queries:
        print(f"=== {eid}: {q}")
        for c in yt_search(q):
            print("   ", c["videoId"], f"[{c['channel'][:30]}]", c["title"][:80])
        time.sleep(1)
