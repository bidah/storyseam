#!/usr/bin/env bash
# Extract the final frame of a rendered block — the continuity anchor that becomes
# the next block's start_image.
#
#   bin/last-frame.sh renders/clips/block_01.mp4 [out.jpg]
set -euo pipefail
IN="${1:?usage: last-frame.sh <clip.mp4> [out.jpg]}"
OUT="${2:-$(dirname "$(dirname "$IN")")/frames/$(basename "${IN%.*}")_last.jpg}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -loglevel error -sseof -1 -i "$IN" -update 1 -q:v 2 "$OUT"
echo "$OUT"
