#!/usr/bin/env python3
"""Fetch YouTube search results for exercise queries, extract (videoId, title, channel) candidates."""
import re, json, sys, urllib.request, urllib.parse

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

def fetch_search(query, num_keep=8):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    html = urllib.request.urlopen(req, timeout=25).read().decode("utf-8", errors="ignore")
    m = re.search(r'ytInitialData\s*=\s*(\{.+?\})\s*;\s*</script>', html, re.S)
    if not m:
        m = re.search(r'ytInitialData"\]\s*=\s*(\{.+?\})\s*;', html, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except Exception:
        return []
    out, seen = [], set()

    def walk(node):
        if isinstance(node, dict):
            vr = node.get("videoRenderer")
            if isinstance(vr, dict):
                vid = vr.get("videoId", "")
                if len(vid) == 11 and vid not in seen:
                    title = ""
                    try:
                        title = vr["title"]["runs"][0]["text"]
                    except Exception:
                        title = vr.get("title", {}).get("simpleText", "")
                    channel = ""
                    for k in ("ownerText", "longBylineText", "shortBylineText"):
                        try:
                            channel = vr[k]["runs"][0]["text"]
                            break
                        except Exception:
                            pass
                    if title and channel:
                        seen.add(vid)
                        out.append({"vid": vid, "title": title, "channel": channel})
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    return out[:num_keep]

if __name__ == "__main__":
    batch_file, out_file = sys.argv[1], sys.argv[2]
    items = json.load(open(batch_file))
    results = {}
    for it in items:
        key = it["key"]
        try:
            cands = fetch_search(it["query"])
        except Exception as e:
            cands = []
            print(f"  !! {key}: ERROR {e}", flush=True)
        results[key] = cands
        print(f"  {key}: {len(cands)} candidates | top: {cands[0]['channel'] if cands else '-'} | {(cands[0]['title'][:60] if cands else '-')}", flush=True)
    json.dump(results, open(out_file, "w"), ensure_ascii=False, indent=1)
    print("saved", out_file)
