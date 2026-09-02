#!/usr/bin/env bash
# Turn a character's voice take into the black-frame .mp4 Seedance accepts as a
# video_references voice reference.
#
#   bin/voice-to-blackmp4.sh <slug> [story-root]
#
# Reads  assets/audio/voices/<slug>.mp3
# Writes assets/audio/voices/blackframe/<slug>.mp4
#
# Seedance takes a voice as a black-frame VIDEO in `video_references`, not as
# `audio_references` — that path is narrower and rejects mode "fast".
set -euo pipefail
SLUG="${1:?usage: voice-to-blackmp4.sh <slug> [story-root]}"
ROOT="${2:-$PWD}"
SRC="$ROOT/assets/audio/voices/$SLUG.mp3"
OUT="$ROOT/assets/audio/voices/blackframe/$SLUG.mp4"

[ -f "$SRC" ] || { echo "no voice take at $SRC" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")

ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=black:s=640x360:r=25:d=$DUR" \
  -i "$SRC" \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -tune stillimage \
  -c:a aac -b:a 192k -shortest "$OUT"

echo "$OUT  ($(printf '%.1f' "$DUR")s)"
