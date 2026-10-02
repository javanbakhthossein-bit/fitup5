#!/usr/bin/env python3
"""Select best candidate per exercise (channel whitelist + title keywords), then oEmbed-verify via curl, dedupe video IDs."""
import json, subprocess, urllib.parse, sys

WHITELIST = ["athlean", "fitnessblender", "madfit", "hasfit", "fitnessprogramer",
             "bob & brad", "bob and brad", "tone and tighten", "popsugar", "bowflex",
             "scott herman", "critical bench", "jeff nippard", "dark horse", "concept2",
             "training tall", "natacha oceane", "red delta", "buff dudes",
             "muscle & strength", "muscleandstrength", "livestrong", "howcast", "nasm",
             "askdoctorjo", "doctor jo", "well+good", "men's health", "mens health",
             "rehab hero", "baptist health", "cleveland clinic", "ucla health",
             "mayo clinic", "spinecare", "tone and tighten", "vive health", "ps fit",
             "self.com", "women's health", "womens health", "shape", "sparkpeople", "garage gym"]

def oembed(vid):
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote("https://www.youtube.com/watch?v=" + vid, safe="") + "&format=json"
    try:
        r = subprocess.run(["curl", "-s", "--max-time", "15", url], capture_output=True, text=True, timeout=25)
        data = json.loads(r.stdout)
        return {"vid": vid, "title": data.get("title", ""), "channel": data.get("author_name", "")}
    except Exception:
        return None

def main():
    queries = json.load(open("queries.json"))["queries"]
    cands = {}
    for i in range(1, 5):
        cands.update(json.load(open(f"cands{i}.json")))
    print(f"loaded candidates for {len(cands)} keys")

    used = set()
    out, failures = {}, []

    def pick(key, q):
        pool = cands.get(key, [])
        scored = []
        for idx, c in enumerate(pool):
            ch = c["channel"].lower()
            t = c["title"].lower()
            chan_hit = any(w in ch for w in WHITELIST)
            kw_hit = any(k in t for k in q["kw"])
            short_pen = -8 if "#short" in t or "shorts" in t else 0
            score = (1000 if chan_hit else 0) + (100 if kw_hit else 0) + short_pen - idx
            scored.append((score, idx, c))
        scored.sort(key=lambda x: (-x[0], x[1]))
        for score, idx, c in scored:
            if c["vid"] in used:
                continue
            v = oembed(c["vid"])
            if v and v["title"] and v["channel"]:
                used.add(v["vid"])
                return {"vid": v["vid"], "title": v["title"], "channel": v["channel"], "kwMatch": any(k in v["title"].lower() for k in q["kw"]), "chanMatch": any(w in v["channel"].lower() for w in WHITELIST)}
        return None

    for q in queries:
        sel = pick(q["key"], q)
        if sel:
            out[q["key"]] = sel
            flag = "" if sel["kwMatch"] else "  [NO KW MATCH]"
            print(f"{q['key']:28s} {sel['vid']}  {sel['channel'][:28]:28s} {sel['title'][:70]}{flag}", flush=True)
        else:
            failures.append(q["key"])
            print(f"{q['key']:28s} FAILED", flush=True)

    json.dump(out, open("verified.json", "w"), ensure_ascii=False, indent=1)
    print(f"\nverified: {len(out)} | failed: {len(failures)} {failures}")

if __name__ == "__main__":
    main()
