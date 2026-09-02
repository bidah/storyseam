#!/usr/bin/env bash
# Audit every reference shotlist/shotlist.json cites against what is on disk.
# Free. Run it before /render, always.
#
#   bin/asset-audit.sh [story-root]
set -euo pipefail
ROOT="${1:-$PWD}"
cd "$ROOT"
[ -f shotlist/shotlist.json ] || { echo "no shotlist/shotlist.json" >&2; exit 1; }

python3 - "$ROOT" <<'PY'
import json, os, sys, re
root = sys.argv[1]
sl = json.load(open(os.path.join(root, "shotlist/shotlist.json")))

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.strip().lower()).strip('-')

need = {}
for b in sl.get("blocks", []):
    for c in b.get("characters", []):
        need[f"assets/images/characters/{slug(c)}.png"] = ("character sheet", 2.5)
    for c in b.get("voices", []):
        need[f"assets/audio/voices/blackframe/{slug(c)}.mp4"] = ("voice (blackframe)", 15)
    if b.get("location"):
        need[f"assets/images/locations/{slug(b['location'])}.png"] = ("location plate", 2.5)
    for p in b.get("props", []):
        need[f"assets/images/props/{slug(p)}.png"] = ("prop plate", 2.5)
    for v in b.get("video_refs", []):
        need[f"assets/video_refs/{v}"] = ("video ref", 0)

try:
    cache = json.load(open(os.path.join(root, ".storyseam/media.json")))
except Exception:
    cache = {}

missing_cost = 0
unuploaded = 0
print(f"{'ASSET':<52} {'KIND':<20} {'STATUS':<12} {'MEDIA_ID'}")
print("-" * 100)
for path in sorted(need):
    kind, cost = need[path]
    full = os.path.join(root, path)
    if os.path.exists(full):
        mid = cache.get(path, {}).get("media_id")
        if mid and cache.get(path, {}).get("confirmed"):
            status, tail = "present", mid[:8] + "…"
        else:
            status, tail = "NOT UPLOADED", "—"; unuploaded += 1
    else:
        status, tail = "MISSING", "—"; missing_cost += cost
    print(f"{path:<52} {kind:<20} {status:<12} {tail}")

blocks = len(sl.get("blocks", []))
total_dur = sum(b.get("dur", 0) for b in sl.get("blocks", []))
print("-" * 100)
print(f"{blocks} blocks, {total_dur}s total  ->  {blocks * 75} credits, {blocks} runs to render")
if missing_cost:
    print(f"MISSING assets cost ~{missing_cost:g} credits to make. Run /cast.")
if unuploaded:
    print(f"{unuploaded} asset(s) exist but are not uploaded/confirmed. Run /cast.")
if not missing_cost and not unuploaded:
    print("All references present and confirmed. Ready to /render.")
PY
