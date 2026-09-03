#!/usr/bin/env bash
# Audit every reference shotlist/shotlist.json cites against what is on disk and
# what is uploaded. Free. Run it before /render, always.
#
#   bin/asset-audit.sh [story-root]
#
# Exit codes: 0 ready, 1 something missing/stale/unuploaded, 2 bad input.
set -euo pipefail
ROOT="${1:-${STORYSEAM_ROOT:-$PWD}}"
command -v python3 >/dev/null || { echo "asset-audit: python3 is required" >&2; exit 2; }
[ -f "$ROOT/shotlist/shotlist.json" ] || { echo "asset-audit: no shotlist/shotlist.json in $ROOT — run /shotlist first" >&2; exit 2; }

python3 - "$ROOT" <<'PY'
import json, os, sys, re
root = sys.argv[1]

def load(path, default=None, required=False):
    full = os.path.join(root, path)
    try:
        with open(full) as f:
            return json.load(f)
    except FileNotFoundError:
        if required: sys.exit(f"asset-audit: {path} not found")
        return default
    except json.JSONDecodeError as e:
        sys.exit(f"asset-audit: {path} is not valid JSON ({e}) — fix it before spending anything")

sl = load("shotlist/shotlist.json", required=True)
cache = load(".storyseam/media.json", default={}) or {}
cfg = load("config.json", default={}) or {}
block_seconds = int(cfg.get("block_seconds", 30))
costs = cfg.get("costs") or {}
CREDITS_PER_BLOCK = float(costs.get("block_30s", 75))
CREDITS_PER_VOICE = float(costs.get("voice", 15))
CREDITS_PER_STILL = float(costs.get("still", 2.5))

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.strip().lower()).strip('-')

blocks = sl.get("blocks", [])
if not isinstance(blocks, list) or not blocks:
    sys.exit("asset-audit: shotlist.json has no blocks")

need = {}
for b in blocks:
    for c in b.get("characters", []):
        need[f"assets/images/characters/{slug(c)}.png"] = ("character sheet", CREDITS_PER_STILL)
    for c in b.get("voices", []):
        need[f"assets/audio/voices/blackframe/{slug(c)}.mp4"] = ("voice (blackframe)", CREDITS_PER_VOICE)
    if b.get("location"):
        need[f"assets/images/locations/{slug(b['location'])}.png"] = ("location plate", CREDITS_PER_STILL)
    for p in b.get("props", []):
        need[f"assets/images/props/{slug(p)}.png"] = ("prop plate", CREDITS_PER_STILL)
    for v in b.get("video_refs", []):
        need[f"assets/video_refs/{v}"] = ("video ref", 0)
    # an explicit ordered reference list names the exact files the prompt numbers
    for r in b.get("references") or []:
        if r.get("kind") == "anchor":
            continue
        kind = r.get("kind", "reference")
        cost = CREDITS_PER_VOICE if kind == "voice" else (0 if kind == "video" else CREDITS_PER_STILL)
        need.setdefault(r["path"], (kind, cost))

# the anchor frame: a reference /render itself produces, cited by the next chained block
state = load(".storyseam/state.json", default={}) or {}
done = {bid for bid, s in (state.get("blocks") or {}).items() if s.get("status") == "done"}
for prev, cur in zip(blocks, blocks[1:]):
    if cur.get("start_from_previous_last_frame") and prev.get("id") in done:
        need[f"renders/frames/{prev['id']}_last.jpg"] = ("anchor frame", 0)

missing_cost, unuploaded, stale, over = 0, 0, 0, []
print(f"{'ASSET':<52} {'KIND':<20} {'STATUS':<15} {'REGISTERED AS'}")
print("-" * 100)
for path in sorted(need):
    kind, cost = need[path]
    full = os.path.join(root, path)
    entry = cache.get(path) or {}
    mid = entry.get("media_id") or entry.get("url")
    registered = (entry.get("media_id") and entry.get("confirmed")) or entry.get("url")
    if not os.path.exists(full):
        status, tail = "MISSING", "—"; missing_cost += cost
    elif not registered:
        status, tail = "NOT REGISTERED", "—"; unuploaded += 1
    elif entry.get("mtime") is not None and os.path.getmtime(full) > float(entry["mtime"]) + 1:
        status, tail = "STALE", mid[:8] + "…"; stale += 1
    else:
        status, tail = "present", (mid[:8] + "…" if len(mid) > 9 else mid)
    print(f"{path:<52} {kind:<20} {status:<15} {tail}")

for b in blocks:
    d = b.get("dur", 0)
    if d > block_seconds:
        over.append(f"{b.get('id','?')} is {d}s (max {block_seconds}s — Seedance clamps silently)")

total_dur = sum(b.get("dur", 0) for b in blocks)
render_cost = sum(CREDITS_PER_BLOCK * (b.get("dur", 0) / 30) for b in blocks)
print("-" * 100)
print(f"{len(blocks)} blocks, {total_dur}s total  ->  ~{render_cost:g} credits, {len(blocks)} runs to render")
for o in over:
    print(f"OVER LENGTH: {o}")
if missing_cost:
    print(f"MISSING assets cost ~{missing_cost:g} credits to make. Run /cast.")
if unuploaded:
    print(f"{unuploaded} asset(s) exist but are not registered with the provider. Run /cast.")
if stale:
    print(f"{stale} asset(s) changed on disk after upload — re-upload before rendering against them.")
if not (missing_cost or unuploaded or stale or over):
    print("All references present and confirmed. Ready to /render.")
    sys.exit(0)
sys.exit(1)
PY
