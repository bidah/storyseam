#!/usr/bin/env bash
# Extract the final frame of a rendered block — the anchor frame the next block cites
# first in image_references and declares in prose as its first frame (ADR-0001).
#
#   bin/last-frame.sh renders/clips/block_01.mp4 [out.jpg]
set -euo pipefail
command -v ffmpeg >/dev/null || { echo "last-frame: ffmpeg is required (brew install ffmpeg)" >&2; exit 2; }
IN="${1:?usage: last-frame.sh <clip.mp4> [out.jpg]}"
[ -f "$IN" ] || { echo "last-frame: no clip at $IN" >&2; exit 1; }
OUT="${2:-$(dirname "$(dirname "$IN")")/frames/$(basename "${IN%.*}")_last.jpg}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error -sseof -1 -i "$IN" -update 1 -q:v 2 "$OUT"
[ -s "$OUT" ] || { echo "last-frame: ffmpeg wrote nothing for $IN — is the clip shorter than 1s or corrupt?" >&2; exit 1; }
echo "$OUT"
