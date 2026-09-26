#!/usr/bin/env python3
"""Batch2 final assembly: assign videos, oEmbed-verify ALL, enforce per-batch uniqueness."""
import json, os, time, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# item index -> videoId (from catalogs A-E, project mapping exercise-video-fixes.json, or fresh YT search)
ASSIGN = {
 0:"BxfKOyI8sUg", 1:"hPA98_r-6e4", 2:"uhLjADhUxFM", 3:"3UWi44yN-wM",
 4:"1VGxgArMM_U", 5:"E9ShwbwZ1zw", 6:"X-uFqWtjpGI", 7:"WqBE0punZ-4",
 8:"3VcKaXpzqRo", 9:"Sp8be0IFNvk", 10:"3VIhzCS7rCw", 11:"NNAs8jx_zJI",
 12:"dC7jhEk-29A", 13:"AChrml938t8", 14:"RuSfPEZyWOU", 15:"-t7fuZ0KhDA",
 16:"vtH93qBItdk", 17:"ris9tKqMwgU", 18:"mXRhpXwW-gs", 19:"cJRVVxmytaM",
 20:"M_MjF5Nm_h4", 21:"g00nZdE6_Ro", 22:"kwG2ipFRgfo", 23:"9WDQqgiwQEY",
 24:"sxA__DoLsgo", 25:"tJIFTI9wZOw", 26:"DCe8f6vMe9A", 27:"5GdwbgLL49o",
 28:"H8HLSRJCOlM", 29:"OfgQrQCLJsk", 30:"hW2XYiM8Kio", 31:"AaA7Yj3zHiU",
 32:"vSupPQiBkeY", 33:"gn8TDTaFHMI", 34:"j2c_EQiY_KM", 35:"-Vyt2QdsR7E",
 36:"e2Lx_py4CVQ", 37:"7syybBpYLLg", 38:"xvvN9HZvaBE", 39:"DvgvfUFjb4E",
 40:"PuzW73rVWkw", 41:"1u18yJELsh0", 42:"MO_03opCc0g", 43:"UYJsFzqdgK4",
 44:"d_KZxkY_0cM", 45:"2TLp_JSr-uU", 46:"luRruRjECm8", 47:"DfuvSn73Up4",
 48:"l6gDwf3xC6s", 49:"E2z5zK5V-MM", 50:"Y9Zgo8FiwnM", 51:"cGnhixvC8uA",
 52:"BAZkFGeUy5U", 53:"FeERX9UwspY", 54:"pDH_xiWkYE4", 55:"1Quc_tOv97I",
 56:"ZrpRBgswtHs", 57:"YOi0x2yXryA", 58:"krZ6pWGZ8xo", 59:"jJba8UFi-TU",
 60:"JtZ_iT8rn70", 61:"yS9VYcIhUxc", 62:"ke2shAeQ0O8", 63:"kfE9Plm8Hks",
 64:"Cp_bShvMY4c", 65:"o2HRy4ay4rE", 66:"m_UlDFNX4mk", 67:"Y3CDzx-oj3k",
 68:"v_c67Omje48", 69:"pYwL-C0aQ_w", 70:"jgKFttG0Z7I", 71:"_m_95uohKMk",
 72:"JLW4AVzdzTc", 73:"vLo49m8GUo4", 74:"SuOuMa2zxj8", 75:"iP2fjvG0g3w",
 76:"pvz7k5gO-DE", 77:"qgnynLzArYE", 78:"A3uK5TPzHq8", 79:"_nzyLUvtgvs",
 80:"NQYc8amhaxQ",
}
FALLBACKS = {77: ["_dniIwRqGaw", "ZZw7xrNyoF4", "qgnynLzArYE"]}  # only if primary fails

def oembed(vid):
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read().decode())
            return {"videoId": vid, "title": d.get("title", ""), "channel": d.get("author_name", "")}
    except Exception:
        return None

def main():
    items = json.load(open(os.path.join(BASE, "..", "video-fix-batch2.json")))
    assert len(items) == 81
    seen = {}
    out, problems = [], []
    for i, it in enumerate(items):
        vid = ASSIGN[i]
        info = oembed(vid)
        tries = 0
        while info is None and i in FALLBACKS and tries < len(FALLBACKS[i]):
            alt = FALLBACKS[i][tries]; tries += 1
            info = oembed(alt)
            if info: vid = alt
        if info is None:
            problems.append((i, it["name"], "OEMBED-FAIL " + vid))
            out.append({"name": it["name"], "unresolved": True, "reason": f"oEmbed failed for {vid}"})
            continue
        if info["videoId"] in seen:
            problems.append((i, it["name"], "DUPLICATE " + vid + " used by #" + str(seen[vid])))
        seen[info["videoId"]] = i
        out.append({"name": it["name"], **info})
        print(f"{i:2d} OK {vid} | {info['title'][:70]} | {info['channel'][:38]}")
        time.sleep(0.15)
    # uniqueness report
    dups = {v: k for v, k in seen.items()}
    ids = [o["videoId"] for o in out if "videoId" in o]
    dup_list = sorted({x for x in ids if ids.count(x) > 1})
    print("\n--- unique ids:", len(set(ids)), "/", len(ids))
    if dup_list: print("DUPLICATES:", dup_list)
    if problems: print("PROBLEMS:", problems)
    outpath = os.path.join(BASE, "..", "video-fix-pass", "batch2.json")
    os.makedirs(os.path.dirname(outpath), exist_ok=True)
    json.dump(out, open(outpath, "w"), ensure_ascii=False, indent=1)
    print("WROTE", outpath)

if __name__ == "__main__":
    main()
