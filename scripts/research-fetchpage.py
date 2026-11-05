#!/usr/bin/env python3
"""Fetch a URL and dump readable text (strip scripts/styles)."""
import sys, re, urllib.request, html

url = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/page.txt"
req = urllib.request.Request(url, headers={
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read().decode("utf-8", "ignore")
except Exception as e:
    print(f"FETCH_ERROR: {e}", file=sys.stderr)
    sys.exit(1)

# strip scripts/styles/noscript
raw = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
# tags -> space
txt = re.sub(r"<[^>]+>", " ", raw)
txt = html.unescape(txt)
txt = re.sub(r"[ \t\r\f\v]+", " ", txt)
txt = re.sub(r"\n\s*\n+", "\n", txt)
with open(out, "w") as f:
    f.write(txt)
print(f"OK {len(txt)} chars -> {out}")
